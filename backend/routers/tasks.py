from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel
from ..database import get_db
from ..models import Task, StepRun
from .pipeline import STEPS
from pathlib import Path
from datetime import datetime
import uuid
import json

router = APIRouter()

DATA_ROOT = Path(__file__).parent.parent.parent / "data" / "tasks"


class CreateTaskRequest(BaseModel):
    douyin_url: str = ""
    # 手动文案模式：直接给定稿口播文案，跳过 解析/转写/清洗/改写，从识书起全自动到成片
    script_text: str = ""


class UpdateArtifactRequest(BaseModel):
    content: dict | str | None = None


# 手动文案任务没有原视频，这四步建任务时直接置 done
_SCRIPT_SKIP_STEPS = ("parse", "transcribe", "clean", "rewrite")


@router.post("")
def create_task(req: CreateTaskRequest, db: Session = Depends(get_db)):
    script = req.script_text.strip()
    if script:
        return _create_script_task(script, db)
    if not req.douyin_url.strip():
        raise HTTPException(400, "douyin_url 与 script_text 至少填一个")

    task_id = str(uuid.uuid4())
    task = Task(id=task_id, title=req.douyin_url[:80], douyin_url=req.douyin_url)
    db.add(task)

    for step in STEPS:
        db.add(StepRun(id=str(uuid.uuid4()), task_id=task_id, step=step))

    db.commit()
    (DATA_ROOT / task_id).mkdir(parents=True, exist_ok=True)
    return _task_to_dict(task, db)


def _create_script_task(script: str, db: Session) -> dict:
    """用定稿文案建任务：前四步置 done，文案写入 rewrite/wenan 供 TTS 直接读取。

    rewrite.json 的 source="manual" 是流水线识别手动任务的标记
    （pipeline._execute_all 据此跳过 TTS 前的选稿暂停）。
    """
    task_id = str(uuid.uuid4())
    title = script.replace("\n", " ")[:80]
    task = Task(id=task_id, title=title, douyin_url="✍️ 手动输入文案")
    db.add(task)

    now = datetime.utcnow()
    for step in STEPS:
        sr = StepRun(id=str(uuid.uuid4()), task_id=task_id, step=step)
        if step in _SCRIPT_SKIP_STEPS:
            sr.status = "done"
            sr.started_at = now
            sr.finished_at = now
        db.add(sr)
    db.commit()

    task_dir = DATA_ROOT / task_id
    task_dir.mkdir(parents=True, exist_ok=True)
    _write_json(task_dir / "rewrite.json",
                {"candidates": [script], "selected": 0, "source": "manual"})
    _write_json(task_dir / "wenan.json", {"rewrite": script, "inputs": {}})
    return _task_to_dict(task, db)


@router.get("")
def list_tasks(db: Session = Depends(get_db)):
    tasks = db.query(Task).order_by(Task.created_at.desc()).all()
    return [
        {
            "id": t.id,
            "title": t.title,
            "status": t.status,
            "created_at": t.created_at.isoformat(),
        }
        for t in tasks
    ]


@router.get("/{task_id}")
def get_task(task_id: str, db: Session = Depends(get_db)):
    task = db.query(Task).filter(Task.id == task_id).first()
    if not task:
        raise HTTPException(404, "Task not found")
    return _task_to_dict(task, db)


@router.patch("/{task_id}/artifacts/rewrite")
def update_rewrite(task_id: str, body: dict, db: Session = Depends(get_db)):
    path = DATA_ROOT / task_id / "rewrite.json"
    if not path.exists():
        raise HTTPException(404, "rewrite.json not found")
    existing = json.loads(path.read_text(encoding="utf-8"))
    existing.update(body)
    path.write_text(json.dumps(existing, ensure_ascii=False, indent=2), encoding="utf-8")

    # 同步选中的候选到 wenan.json["rewrite"]——TTS 优先读取该字段，
    # 否则用户在此处改了选择，配音仍会沿用旧文案。
    candidates = existing.get("candidates") or []
    selected = int(existing.get("selected", 0) or 0)
    if candidates:
        chosen = str(candidates[min(selected, len(candidates) - 1)]).strip()
        wenan_path = DATA_ROOT / task_id / "wenan.json"
        wenan = json.loads(wenan_path.read_text(encoding="utf-8")) if wenan_path.exists() else {}
        if wenan.get("rewrite") != chosen:
            wenan["rewrite"] = chosen
            wenan_path.write_text(json.dumps(wenan, ensure_ascii=False, indent=2), encoding="utf-8")

    return {"status": "updated"}


@router.patch("/{task_id}/artifacts/subtitles")
def update_subtitles(task_id: str, body: dict):
    content = body.get("content", "")
    (DATA_ROOT / task_id / "subtitles.srt").write_text(content, encoding="utf-8")
    return {"status": "updated"}


@router.patch("/{task_id}/title")
def update_title(task_id: str, body: dict, db: Session = Depends(get_db)):
    task = db.query(Task).filter(Task.id == task_id).first()
    if not task:
        raise HTTPException(404, "Task not found")
    task.title = body.get("title", task.title)[:80]
    db.commit()
    return {"status": "updated"}


def _task_to_dict(task: Task, db: Session) -> dict:
    task_dir = DATA_ROOT / task.id
    step_runs = db.query(StepRun).filter(StepRun.task_id == task.id).all()
    steps = {}

    for sr in step_runs:
        entry: dict = {
            "status": sr.status,
            "started_at": sr.started_at.isoformat() if sr.started_at else None,
            "finished_at": sr.finished_at.isoformat() if sr.finished_at else None,
            "error_msg": sr.error_msg,
        }
        if sr.status == "done":
            entry.update(_load_artifact(sr.step, task_dir))
        steps[sr.step] = entry

    for step in STEPS:
        steps.setdefault(
            step,
            {
                "status": "pending",
                "started_at": None,
                "finished_at": None,
                "error_msg": None,
            },
        )

    return {
        "id": task.id,
        "title": task.title,
        "douyin_url": task.douyin_url,
        "status": task.status,
        "created_at": task.created_at.isoformat(),
        "steps": steps,
    }


def _load_artifact(step: str, task_dir: Path) -> dict:
    loaders = {
        "parse": lambda d: {"meta": _read_json(d / "meta.json")},
        "transcribe": lambda d: {"transcript": _read_json(d / "transcript.json")},
        "clean": lambda d: {"wenan": _read_json(d / "wenan.json")},
        "rewrite": lambda d: {"rewrite": _read_json(d / "rewrite.json")},
        "identify_book": lambda d: {"wenan": _read_json(d / "wenan.json")},
        "subtitle": lambda d: {"subtitles": _read_text(d / "subtitles.srt")},
        "storyboard": lambda d: {"storyboard": _read_json(d / "storyboard.json")},
    }
    fn = loaders.get(step)
    if fn:
        try:
            return fn(task_dir)
        except Exception:
            return {}
    return {}


def _read_json(path: Path) -> dict | None:
    if path.exists():
        return json.loads(path.read_text(encoding="utf-8"))
    return None


def _write_json(path: Path, content: dict) -> None:
    path.write_text(json.dumps(content, ensure_ascii=False, indent=2), encoding="utf-8")


def _read_text(path: Path) -> str | None:
    if path.exists():
        return path.read_text(encoding="utf-8")
    return None
