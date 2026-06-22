from fastapi import APIRouter, BackgroundTasks
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from ..database import SessionLocal
from ..models import Task, StepRun
from .. import services
from pathlib import Path
from datetime import datetime
import asyncio
import json
import shutil
import uuid

router = APIRouter()

DATA_ROOT = Path(__file__).parent.parent.parent / "data" / "tasks"

STEPS = [
    "parse",
    "transcribe",
    "clean",
    "rewrite",
    "identify_book",
    "tts",
    "storyboard",
    "subtitle",
    "compose",
]

# 一键全程跑到 identify_book 后暂停，等用户选稿再继续
_AUTO_STOP_BEFORE = "tts"

# Per-run broadcast, keyed by "{task_id}:{step}" or "{task_id}:__all__"
_broadcasts: dict[str, "_Broadcast"] = {}


class _Broadcast:
    def __init__(self, loop: asyncio.AbstractEventLoop):
        self._loop = loop
        self.history: list[str] = []
        self.done = False
        self._subscribers: list[asyncio.Queue] = []

    # Called from any thread
    def send(self, msg: str) -> None:
        self.history.append(msg)
        self._loop.call_soon_threadsafe(self._push, msg)

    def finish(self) -> None:
        self.done = True
        self._loop.call_soon_threadsafe(self._push_done)

    # Called only on event-loop thread
    def _push(self, msg: str) -> None:
        for q in self._subscribers:
            q.put_nowait(msg)

    def _push_done(self) -> None:
        for q in self._subscribers:
            q.put_nowait(None)

    def subscribe(self) -> "asyncio.Queue[str | None]":
        q: asyncio.Queue = asyncio.Queue()
        for msg in self.history:
            q.put_nowait(msg)
        if self.done:
            q.put_nowait(None)
        self._subscribers.append(q)
        return q


class RunStepBody(BaseModel):
    # 仅 storyboard 步用：手动指定生成几组九宫格（1 组=1 次生图调用）。None=按对标自动检测。
    grid_count: int | None = None
    # 仅 tts 步用：本次配音后端（qwen=本地免费 / cosyvoice=云端付费）。None=跟随 .env。
    tts_backend: str | None = None
    # 仅 transcribe 步用：本次转写后端（whisper=本地免费 / qwen=云端付费）。None=跟随 .env。
    asr_backend: str | None = None


class RunAllBody(BaseModel):
    # 一键全程时对转写/配音步骤生效，None=跟随 .env
    asr_backend: str | None = None
    tts_backend: str | None = None


@router.post("/{task_id}/steps/{step}/run")
async def run_step(task_id: str, step: str, background_tasks: BackgroundTasks,
                   body: RunStepBody = RunStepBody()):
    key = f"{task_id}:{step}"
    broadcast = _Broadcast(asyncio.get_event_loop())
    _broadcasts[key] = broadcast
    background_tasks.add_task(
        _execute_step, task_id, step, broadcast, body.grid_count, body.tts_backend,
        body.asr_backend)
    return {"status": "started"}


@router.get("/{task_id}/steps/{step}/sse")
async def step_sse(task_id: str, step: str):
    return _sse_response(f"{task_id}:{step}")


@router.get("/{task_id}/steps/{step}/logs")
def step_logs(task_id: str, step: str):
    """读取落盘的步骤日志（运行中可反复轮询，结束后仍可查历史）。"""
    path = DATA_ROOT / task_id / "logs" / f"{step}.log"
    if not path.exists():
        return {"logs": []}
    return {"logs": path.read_text(encoding="utf-8").splitlines()}


@router.post("/{task_id}/run-all")
async def run_all(task_id: str, background_tasks: BackgroundTasks,
                  body: RunAllBody = RunAllBody()):
    key = f"{task_id}:__all__"
    broadcast = _Broadcast(asyncio.get_event_loop())
    _broadcasts[key] = broadcast
    background_tasks.add_task(_execute_all, task_id, broadcast,
                              body.asr_backend, body.tts_backend)
    return {"status": "started"}


@router.get("/{task_id}/run-all/sse")
async def run_all_sse(task_id: str):
    return _sse_response(f"{task_id}:__all__")


def _sse_response(key: str) -> StreamingResponse:
    async def stream():
        # Wait briefly for broadcast to appear if run was just triggered
        for _ in range(50):
            if key in _broadcasts:
                break
            await asyncio.sleep(0.1)

        broadcast = _broadcasts.get(key)
        if not broadcast:
            yield f"data: {json.dumps({'type': 'error', 'msg': 'No active run'})}\n\n"
            return

        queue = broadcast.subscribe()
        while True:
            msg = await queue.get()
            if msg is None:
                yield f"data: {json.dumps({'type': 'done'})}\n\n"
                break
            yield f"data: {json.dumps({'type': 'log', 'msg': msg})}\n\n"

    # 关闭中间层缓冲，确保事件实时下发（X-Accel-Buffering 对 nginx 生效）
    return StreamingResponse(
        stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


async def _run_one_step(
    db, task: Task, step: str, broadcast: _Broadcast, prefix: str = "",
    grid_count: int | None = None, tts_backend: str | None = None,
    asr_backend: str | None = None,
) -> bool:
    """执行单个步骤：置 running → 调用 _run → 置 done/error，并写库。

    成功返回 True，失败返回 False。不负责 broadcast.finish()（由调用方控制，
    以便一键全程能用同一个 broadcast 连续跑多步）。
    """
    sr = db.query(StepRun).filter(
        StepRun.task_id == task.id, StepRun.step == step
    ).first()
    if not sr:
        sr = StepRun(id=str(uuid.uuid4()), task_id=task.id, step=step)
        db.add(sr)
        db.commit()

    sr.status = "running"
    sr.started_at = datetime.utcnow()
    sr.error_msg = None
    db.commit()

    task_dir = DATA_ROOT / task.id
    log = _make_step_logger(task_dir, step, broadcast, prefix)

    try:
        await _run(step, task, task_dir, log, grid_count, tts_backend, asr_backend)
        sr.status = "done"
        sr.finished_at = datetime.utcnow()
        db.commit()
        return True
    except Exception as exc:
        sr.status = "error"
        sr.finished_at = datetime.utcnow()
        # TimeoutError 等异常 str() 为空，回退 repr 保证错误可见
        sr.error_msg = str(exc) or repr(exc)
        db.commit()
        log(f"ERROR: {sr.error_msg}")
        return False


def _make_step_logger(task_dir: Path, step: str, broadcast: _Broadcast, prefix: str = ""):
    """日志双写：SSE 实时推送 + 落盘 logs/<step>.log。

    落盘让页面刷新、SSE 断流、后端重启后日志仍可查（配套 GET .../steps/{step}/logs）。
    """
    log_path = task_dir / "logs" / f"{step}.log"
    log_path.parent.mkdir(parents=True, exist_ok=True)
    log_path.write_text("", encoding="utf-8")  # 每次运行重新记录

    def log(msg: str) -> None:
        broadcast.send(f"{prefix}{msg}")
        try:
            with log_path.open("a", encoding="utf-8") as f:
                f.write(f"{msg}\n")
        except OSError:
            pass  # 落盘失败不阻断步骤本身

    return log


async def _execute_step(task_id: str, step: str, broadcast: _Broadcast,
                        grid_count: int | None = None,
                        tts_backend: str | None = None,
                        asr_backend: str | None = None) -> None:
    db = SessionLocal()
    try:
        task = db.query(Task).filter(Task.id == task_id).first()
        if not task:
            broadcast.send(f"找不到任务: {task_id}")
            return
        await _run_one_step(db, task, step, broadcast, grid_count=grid_count,
                            tts_backend=tts_backend, asr_backend=asr_backend)
    finally:
        db.close()
        broadcast.finish()


async def _execute_all(task_id: str, broadcast: _Broadcast,
                       asr_backend: str | None = None,
                       tts_backend: str | None = None) -> None:
    db = SessionLocal()
    try:
        task = db.query(Task).filter(Task.id == task_id).first()
        if not task:
            broadcast.send(f"找不到任务: {task_id}")
            return
        for step in STEPS:
            # 跑到 identify_book 后暂停，等用户在前端选候选文案；
            # 手动文案任务的文案即定稿，无需选稿，不暂停直接跑到成片
            if step == _AUTO_STOP_BEFORE and not _is_manual_script_task(task.id):
                # 如果 tts 还没跑过，停下来等用户选稿
                tts_run = db.query(StepRun).filter(
                    StepRun.task_id == task.id, StepRun.step == step
                ).first()
                if not tts_run or tts_run.status not in ("done", "running"):
                    broadcast.send(
                        "===== 前序步骤已完成，请先选择口播文案版本，再手动运行「TTS → 成片」 ====="
                    )
                    break

            existing = db.query(StepRun).filter(
                StepRun.task_id == task.id, StepRun.step == step
            ).first()
            if existing and existing.status == "done":
                broadcast.send(f"===== 跳过：{step}（已完成，避免重复扣费；需要重跑请点单步重新生成） =====")
                continue
            broadcast.send(f"===== 开始：{step} =====")
            ok = await _run_one_step(db, task, step, broadcast, prefix=f"[{step}] ",
                                     tts_backend=tts_backend, asr_backend=asr_backend)
            if not ok:
                broadcast.send(f"===== 中止于：{step}（请修复后从该步续跑） =====")
                break
        else:
            broadcast.send("===== 一键全程完成 🎉 =====")
    finally:
        db.close()
        broadcast.finish()


async def _run(step: str, task: Task, task_dir: Path, log,
               grid_count: int | None = None,
               tts_backend: str | None = None,
               asr_backend: str | None = None) -> None:
    loop = asyncio.get_event_loop()

    if step == "parse":
        # 按链接类型分发：视频号 → wx_channels，否则抖音
        if services.wx_channels.is_wx_channels_url(task.douyin_url):
            parser = services.wx_channels.parse_and_download
        else:
            parser = services.douyin_parser.parse_and_download
        await loop.run_in_executor(
            None,
            lambda: parser(task.douyin_url, task_dir, log),
        )
    elif step == "transcribe":
        video = _find_video(task_dir)
        await loop.run_in_executor(
            None,
            lambda: services.transcriber.transcribe(video, task_dir, log, backend=asr_backend),
        )
    elif step == "clean":
        transcript = json.loads((task_dir / "transcript.json").read_text(encoding="utf-8"))
        await loop.run_in_executor(
            None,
            lambda: _run_clean(transcript, task_dir, log),
        )
    elif step == "rewrite":
        transcript = json.loads((task_dir / "transcript.json").read_text(encoding="utf-8"))
        await loop.run_in_executor(
            None,
            lambda: _run_rewrite(transcript, task_dir, log),
        )
    elif step == "identify_book":
        await loop.run_in_executor(
            None,
            lambda: _run_identify_book(task_dir, log),
        )
    elif step == "tts":
        # 手动定稿文案已自带 CTA，不再追加模板 CTA（避免结尾重复）
        text = _selected_rewrite_text(task_dir, with_cta=not _is_manual_script_task(task.id))
        await services.tts_gen.synthesize(text, task_dir, log, backend=tts_backend)
    elif step == "storyboard":
        await loop.run_in_executor(
            None,
            lambda: _run_storyboard(task_dir, log, grid_count),
        )
    elif step == "subtitle":
        words = json.loads((task_dir / "tts_words.json").read_text(encoding="utf-8"))
        await loop.run_in_executor(
            None,
            lambda: services.subtitle_gen.generate(words, task_dir, log),
        )
    elif step == "compose":
        await loop.run_in_executor(
            None,
            lambda: _run_compose(task_dir, log),
        )
    else:
        raise ValueError(f"未知步骤: {step!r}")


def _find_video(task_dir: Path) -> Path:
    for ext in ("mp4", "webm", "mkv", "m4v", "mov"):
        p = task_dir / f"video.{ext}"
        if p.exists():
            return p
    raise FileNotFoundError(f"在 {task_dir} 中找不到视频文件")


def _run_clean(transcript: dict, task_dir: Path, log) -> dict:
    source_text = transcript.get("full_text") or _concat_segments(transcript)
    meta = _read_json(task_dir / "meta.json")
    log(f"清洗逐字稿：{len(source_text)} 字")
    cleaned = services.wenan.clean(
        source_text,
        "",
        meta.get("title", ""),
        meta.get("uploader", ""),
    ) or source_text
    data = _read_json(task_dir / "wenan.json")
    data["cleaned"] = cleaned
    data.setdefault("inputs", {})
    _write_json(task_dir / "wenan.json", data)
    log(f"清洗完成：{len(cleaned)} 字")
    return data


def _run_rewrite(transcript: dict, task_dir: Path, log) -> dict:
    result = services.rewriter.rewrite(transcript, task_dir, log)
    selected = int(result.get("selected", 0) or 0)
    candidates = result.get("candidates") or []
    if candidates:
        data = _read_json(task_dir / "wenan.json")
        data["rewrite"] = candidates[min(selected, len(candidates) - 1)]
        if result.get("book"):
            data["book"] = result["book"]
        data.setdefault("inputs", {})
        _write_json(task_dir / "wenan.json", data)
        log("已同步 B 口播改写到文案工坊")
    return result


def _run_identify_book(task_dir: Path, log) -> dict:
    data = _read_json(task_dir / "wenan.json")
    meta = _read_json(task_dir / "meta.json")
    script_text = str(data.get("cleaned") or data.get("rewrite") or "").strip()
    if not script_text:
        transcript = _read_json(task_dir / "transcript.json")
        script_text = transcript.get("full_text") or _concat_segments(transcript)

    log("识别书名与作者，用于结尾引导和成片声明")
    book = services.wenan.identify_book(
        script_text,
        "",
        meta.get("title", ""),
        meta.get("description", ""),
    )
    data["book"] = book
    data.setdefault("inputs", {})
    _write_json(task_dir / "wenan.json", data)

    rewrite_path = task_dir / "rewrite.json"
    if rewrite_path.exists():
        rewrite_data = _read_json(rewrite_path)
        rewrite_data["book"] = book
        _write_json(rewrite_path, rewrite_data)

    title = book.get("book_title") or "未识别"
    confidence = float(book.get("confidence", 0) or 0)
    log(f"书籍识别完成：{title}（置信度 {confidence:.0%}）")
    return book


def _run_storyboard(task_dir: Path, log, grid_count: int | None = None) -> dict:
    data = _read_json(task_dir / "wenan.json")
    script = _selected_rewrite_text(task_dir, with_cta=False)
    if script and not data.get("rewrite"):
        data["rewrite"] = script
        _write_json(task_dir / "wenan.json", data)
    if not script:
        raise FileNotFoundError("缺少 B 口播改写文稿，无法生成九宫格分镜")

    if grid_count and grid_count > 0:
        # 用户在第 7 步手动指定组数：每组最多 9 格，按 组数×9 反推拍数再裁到 N 组
        batches = services.storyboard.split_briefs(script, target_beats=grid_count * 9)[:grid_count]
        log(f"按手动指定生成 {len(batches)} 组九宫格")
    else:
        # 按对标镜头数自动决定分镜图张数（与手动 prepare 一致）
        target = services.storyboard.resolve_target_beats(task_dir, None, log)
        batches = services.storyboard.split_briefs(script, target_beats=target or None)
        log(f"九宫格分镜准备完成：共 {len(batches)} 组（对标约 {target or '默认'} 张图）")

    book = data.get("book") or {}
    # 保留对标自动检测缓存（resolve_target_beats 已写入），手动组数不覆盖它
    ref_cached = (_read_json(task_dir / "storyboard.json") or {}).get("ref_image_count")
    storyboard_data = {
        "batches": batches,
        "mode": "9:16",
        "source": "rewrite",
        "grids": {},
        "image_count": sum(len(b) for b in batches),
    }
    if ref_cached:
        storyboard_data["ref_image_count"] = ref_cached
    _write_json(task_dir / "storyboard.json", storyboard_data)

    image_style = services.storyboard.active_image_style()
    for index, briefs in enumerate(batches, 1):
        res = services.storyboard.generate_grid(
            task_dir,
            briefs,
            book.get("book_title", ""),
            book.get("book_author", ""),
            index,
            len(batches),
            "9:16",
            log,
            style=image_style,
        )
        storyboard_data["grids"][str(index)] = {"status": "done", **res}
        _write_json(task_dir / "storyboard.json", storyboard_data)
    log("九宫格分镜全部生成完成")
    return storyboard_data


def _run_compose(task_dir: Path, log) -> None:
    try:
        result = services.storyboard_video.compose_variant(task_dir, "rewrite", log)
        src = task_dir / result["file"]
        dst = task_dir / "final.mp4"
        if src.exists() and src != dst:
            shutil.copyfile(src, dst)
            log("已同步为最终成片 final.mp4")
        return
    except Exception as exc:
        log(f"九宫格成片不可用，回退旧合成流程：{exc}")
        services.composer.compose(task_dir, log)


def _read_json(path: Path) -> dict:
    if not path.exists():
        return {}
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return {}


def _write_json(path: Path, data: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def _is_manual_script_task(task_id: str) -> bool:
    """手动输入文案创建的任务（tasks._create_script_task 写入的标记）。"""
    return _read_json(DATA_ROOT / task_id / "rewrite.json").get("source") == "manual"


def _concat_segments(transcript: dict) -> str:
    return " ".join(str(s.get("text", "")) for s in transcript.get("segments", []))


def _selected_rewrite_text(task_dir: Path, with_cta: bool = False) -> str:
    data = _read_json(task_dir / "wenan.json")
    script = str(data.get("rewrite") or "").strip()
    if not script:
        rewrite_data = _read_json(task_dir / "rewrite.json")
        candidates = rewrite_data.get("candidates") or []
        selected = int(rewrite_data.get("selected", 0) or 0)
        if candidates:
            script = str(candidates[min(selected, len(candidates) - 1)]).strip()
    if not script or not with_cta:
        return script
    book = data.get("book") or _read_json(task_dir / "rewrite.json").get("book") or {}
    cta = services.wenan.book_cta(book.get("book_title", ""), book.get("book_author", ""))
    if cta and cta not in script:
        return f"{script}\n{cta}"
    return script
