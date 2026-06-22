import asyncio
import hashlib
import json
import shutil
import subprocess
from pathlib import Path
from typing import Callable

from . import tts_gen, wenan, subtitle_gen

VIDEO_VARIANTS = {
    "rewrite": {
        "script_key": "rewrite",
        "label": "B · 口播改写版",
        "output": "storyboard_rewrite.mp4",
        "duration": 3.2,
        "zoom": "zoom+0.0008",
    },
    "dedup": {
        "script_key": "dedup",
        "label": "C · 二创改写版",
        "output": "storyboard_dedup.mp4",
        "duration": 2.45,
        "zoom": "zoom+0.0014",
    },
}


def compose_variant(task_dir: Path, variant: str, log: Callable[[str], None]) -> dict:
    if variant not in VIDEO_VARIANTS:
        raise ValueError("variant 仅支持 rewrite 或 dedup")

    storyboard_data = _load_storyboard(task_dir)
    if storyboard_data.get("source") != variant:
        label = "B 口播改写" if variant == "rewrite" else "C 二创改写"
        raise FileNotFoundError(f"请先在 E 九宫格成片里选择「{label}」并重新准备分段、生成九宫格图片")

    config = VIDEO_VARIANTS[variant]
    script = _load_variant_script(task_dir, str(config["script_key"]))
    cells = _load_content_cells(task_dir, storyboard_data)
    if not cells:
        raise FileNotFoundError("还没有可用的九宫格分镜图片，请先生成图片")
    # 用分镜首图替换任务封面（参考视频封面 → 本次 AI 生成图），供画廊缩略图显示
    shutil.copy2(str(cells[0]), str(task_dir / "cover.jpg"))

    out_dir = task_dir / "variants"
    out_dir.mkdir(parents=True, exist_ok=True)
    tts_dir = out_dir / f"{variant}_tts"
    tts_dir.mkdir(parents=True, exist_ok=True)

    if not _reuse_task_tts(task_dir, tts_dir, variant, log):
        log(f"开始生成 {config['label']}：使用该版本文稿重新配音")
        asyncio.run(tts_gen.synthesize(script, tts_dir, log))
    audio = tts_dir / "tts.mp3"
    if not audio.exists():
        raise FileNotFoundError("版本配音失败：未生成 tts.mp3")

    audio_duration = _duration(audio)

    # beat 感知时长：让图片切换与口播内容同步
    durations = _beat_durations(task_dir, tts_dir, storyboard_data)
    if not durations or len(durations) != len(cells):
        # fallback: 均匀分配
        per_image = audio_duration / len(cells)
        durations = [per_image] * len(cells)
        log(f"音频 {audio_duration:.1f}s ÷ {len(cells)} 张图 = 每张 {per_image:.2f}s（均匀）")
    else:
        log(f"音频 {audio_duration:.1f}s, {len(cells)} 张图, beat-synced 计时")

    segment_dir = out_dir / f"{variant}_segments"
    segment_dir.mkdir(parents=True, exist_ok=True)

    log("生成对标风格字幕（大白字居中、烧录）...")
    ass_name = _build_subtitles(tts_dir, task_dir, variant, log)

    # 书籍图画中画：在"提到书"的拍上叠加真实书封（data/books 无对应图则自动跳过）
    book_title = (_load_wenan(task_dir).get("book") or {}).get("book_title", "")
    book_img = _book_image(book_title)
    all_beats = [b for batch in storyboard_data.get("batches", []) for b in batch]
    book_beats = _book_beats(all_beats) if book_img else set()
    if book_img and book_beats:
        log(f"书籍图画中画：{book_img.name} 叠加在第 {sorted(i + 1 for i in book_beats)} 拍")
    elif book_title and not book_img:
        log(f"未找到《{book_title}》书封图（data/books/），跳过画中画")

    log(f"使用 {len(cells)} 张九宫格分镜图片生成画面")
    segments = []
    for index, (image, dur) in enumerate(zip(cells, durations), 1):
        segment = segment_dir / f"{index:03d}.mp4"
        overlay = book_img if (index - 1) in book_beats else None
        _make_image_segment(image, segment, dur, str(config["zoom"]),
                            overlay_image=overlay, beat_index=index - 1)
        segments.append(segment)

    looped = out_dir / f"{variant}_visual.mp4"
    log(f"拼接 {len(segments)} 个片段（{_XFADE_TRANSITION} 水墨转场 {_XFADE_DUR}s）...")
    _concat_with_xfade(segments, durations, looped)

    output = task_dir / str(config["output"])
    _mux_audio(looped, audio, output, ass_name, task_dir)

    metadata = _expected_metadata(task_dir, variant, script)
    metadata.update({"duration": _duration(output), "image_count": len(cells)})
    _metadata_path(task_dir, variant).write_text(json.dumps(metadata, ensure_ascii=False, indent=2), encoding="utf-8")

    log(f"{config['label']} 已生成：{output.name}（{metadata['duration']:.1f}s）")
    return {
        "variant": variant,
        "label": config["label"],
        "file": output.name,
        "duration": metadata["duration"],
        "image_count": len(cells),
        "script_chars": len(script),
        "audio_file": f"variants/{variant}_tts/tts.mp3",
    }


def list_variants(task_dir: Path) -> dict:
    result = {}
    wenan_data = _load_wenan(task_dir)
    storyboard_source = _load_storyboard(task_dir).get("source")
    for key, config in VIDEO_VARIANTS.items():
        output = task_dir / str(config["output"])
        raw = str(wenan_data.get(config["script_key"], "") or "").strip()
        script = _with_book_cta(raw, wenan_data) if raw else ""
        metadata_ok = output.exists() and _metadata_matches(task_dir, key, script)
        result[key] = {
            "label": config["label"],
            "file": output.name,
            "exists": bool(metadata_ok),
            "stale": output.exists() and not metadata_ok,
            "duration": _duration(output) if metadata_ok else None,
            "script_ready": bool(script),
            "script_chars": len(script),
            "storyboard_ready": storyboard_source == key,
            "storyboard_source": storyboard_source,
        }
    return result


def _expected_metadata(task_dir: Path, variant: str, script: str) -> dict:
    cfg = tts_gen.get_tts_backend_config(task_dir)
    return {
        "variant": variant,
        "script_sha256": hashlib.sha256(script.encode("utf-8")).hexdigest(),
        "ref_audio": str(cfg.ref_audio) if cfg.ref_audio else "",
        "ref_text_sha256": hashlib.sha256(cfg.ref_text.encode("utf-8")).hexdigest(),
    }




def _reuse_task_tts(task_dir: Path, tts_dir: Path, variant: str, log: Callable[[str], None]) -> bool:
    if variant != "rewrite":
        return False
    src_audio = task_dir / "tts.mp3"
    src_words = task_dir / "tts_words.json"
    src_segs = task_dir / "tts_segments.json"
    src_wav = task_dir / "tts.wav"
    if not src_audio.exists() or not src_words.exists():
        return False
    shutil.copyfile(src_audio, tts_dir / "tts.mp3")
    shutil.copyfile(src_words, tts_dir / "tts_words.json")
    if src_segs.exists():
        shutil.copyfile(src_segs, tts_dir / "tts_segments.json")
    if src_wav.exists():
        shutil.copyfile(src_wav, tts_dir / "tts.wav")
    log("复用第 6 步已生成的 TTS，跳过二次配音扣费")
    return True

def _metadata_matches(task_dir: Path, variant: str, script: str) -> bool:
    path = _metadata_path(task_dir, variant)
    if not path.exists() or not script:
        return False
    try:
        actual = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return False
    expected = _expected_metadata(task_dir, variant, script)
    return all(actual.get(key) == value for key, value in expected.items())


def _metadata_path(task_dir: Path, variant: str) -> Path:
    return task_dir / "variants" / f"{variant}_video.json"


def _load_variant_script(task_dir: Path, key: str) -> str:
    data = _load_wenan(task_dir)
    script = str(data.get(key, "") or "").strip()
    if not script:
        if key == "rewrite":
            raise FileNotFoundError("缺少 B 口播改写文稿，请先在文案工坊运行 B")
        raise FileNotFoundError("缺少 C 二创改写文稿，请先在文案工坊运行 C")
    return _with_book_cta(script, data)


def _with_book_cta(script: str, wenan_data: dict) -> str:
    """在配音文稿末尾自然衔接一句合规的引导购书 CTA（识别到书名才追加）。"""
    book = wenan_data.get("book") or {}
    cta = wenan.book_cta(book.get("book_title", ""), book.get("book_author", ""))
    if not cta or cta in script:
        return script
    return f"{script}\n{cta}"


def _load_wenan(task_dir: Path) -> dict:
    path = task_dir / "wenan.json"
    if not path.exists():
        return {}
    return json.loads(path.read_text(encoding="utf-8"))


_BOOKS_DIR = Path(__file__).resolve().parents[2] / "data" / "books"
_BOOK_MARKERS = ("《", "这本书", "这种书", "本书", "书里", "书中")


def _book_image(book_title: str) -> Path | None:
    """在 data/books/ 找文件名包含书名的封面图，无则 None。"""
    key = (book_title or "").strip().strip("《》")
    if not key or not _BOOKS_DIR.exists():
        return None
    for p in sorted(_BOOKS_DIR.iterdir()):
        if p.suffix.lower() in (".jpg", ".jpeg", ".png", ".webp") and key in p.stem:
            return p
    return None


def _book_beats(all_beats: list[str]) -> set[int]:
    """返回口播里"提到书"的拍下标（用于叠加书封画中画）。"""
    return {i for i, b in enumerate(all_beats) if any(m in b for m in _BOOK_MARKERS)}


def _load_storyboard(task_dir: Path) -> dict:
    path = task_dir / "storyboard.json"
    if not path.exists():
        return {}
    return json.loads(path.read_text(encoding="utf-8"))


def _load_storyboard_cells(task_dir: Path, data: dict) -> list[Path]:
    cells: list[Path] = []
    for key in sorted((data.get("grids") or {}).keys(), key=lambda value: int(value)):
        grid = data["grids"].get(key) or {}
        if grid.get("status") != "done":
            continue
        for rel in grid.get("cells") or []:
            path = task_dir / rel
            if path.exists():
                cells.append(path)
    return cells


def _load_content_cells(task_dir: Path, data: dict) -> list[Path]:
    """加载内容单元格（跳过末尾 PAD 空镜），数量等于 beats 数。"""
    all_beats: list[str] = []
    for batch in data.get("batches", []):
        all_beats.extend(batch)
    content_count = len(all_beats)
    all_cells = _load_storyboard_cells(task_dir, data)
    return all_cells[:content_count]


def _beat_durations(task_dir: Path, tts_dir: Path, storyboard_data: dict) -> list[float]:
    """把 storyboard beats 映射到 TTS 时间轴，返回每张内容图片的持续时长。

    用 tts_words.json 的逐字时间戳做文本对齐，让图片切换与口播内容同步。
    """
    words_path = tts_dir / "tts_words.json"
    if not words_path.exists():
        return []

    words = json.loads(words_path.read_text(encoding="utf-8"))
    tts_text = "".join(w["text"] for w in words)
    audio_duration = words[-1]["end"]

    # 展平所有 beats
    all_beats: list[str] = []
    for batch in storyboard_data.get("batches", []):
        all_beats.extend(batch)

    # 对每个 beat，在 tts_text 中找到对应位置 → 取起止时间
    durations: list[float] = []
    cursor = 0
    for beat in all_beats:
        beat_clean = beat.strip()
        idx = tts_text.find(beat_clean, cursor)
        if idx == -1 or idx + len(beat_clean) > len(words):
            # fallback: 按字数比例分配剩余时间
            remaining = audio_duration - (durations[-1] + sum(durations[:-1]) if durations else 0)
            remaining_beats = len(all_beats) - len(durations)
            durations.append(remaining / max(1, remaining_beats))
            continue
        start_time = words[idx]["start"]
        end_time = words[min(idx + len(beat_clean) - 1, len(words) - 1)]["end"]
        durations.append(end_time - start_time)
        cursor = idx + len(beat_clean)

    return _enforce_min_duration(durations, audio_duration, min_dur=2.0)


def _enforce_min_duration(durations: list[float], total: float,
                          min_dur: float = 2.0) -> list[float]:
    """确保每项 ≥ min_dur，超出总额的部分从最长项按比例扣除。"""
    result = [max(d, min_dur) for d in durations]
    overshoot = sum(result) - total
    if overshoot <= 0:
        return result

    total_above_min = sum(r - min_dur for r in result)
    if total_above_min <= 0:
        # 全部都是 min_dur，无法再扣——等比缩放
        scale = total / sum(result)
        return [d * scale for d in result]

    for i in range(len(result)):
        if result[i] > min_dur:
            share = (result[i] - min_dur) / total_above_min
            result[i] -= overshoot * share
    return result


_XFADE_TRANSITION = "dissolve"
_XFADE_DUR = 0.35


def _build_kb_filter(duration: float, zoom_expr: str, beat_index: int) -> str:
    """4 方向循环 Ken-Burns，避免每拍方向相同导致画面单调。
    0=慢推进  1=慢拉出  2=右移扫  3=左移扫

    位移/缩放量按 on/frames 比例驱动，无论该拍多长都匀速铺满全程——
    长拍（单图撑数分钟）才不会"动几秒就卡死"。zoom_expr 仅保留兼容，不再使用。
    """
    frames = max(1, int(duration * 30))
    direction = beat_index % 4
    center = "x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'"
    if direction == 0:  # 慢推进：1.0 → 1.08 全程
        zp = (f"zoompan=z='min(1.0+0.08*on/{frames},1.08)':{center}"
              f":d={frames}:s=1080x1920:fps=30")
    elif direction == 1:  # 慢拉出：1.08 → 1.0 全程
        zp = (f"zoompan=z='max(1.08-0.08*on/{frames},1.0)':{center}"
              f":d={frames}:s=1080x1920:fps=30")
    elif direction == 2:  # 右移扫：轻微放大下横向匀速扫过
        zp = (f"zoompan=z='1.06':x='(iw-iw/zoom)*on/{frames}'"
              f":y='ih/2-(ih/zoom/2)':d={frames}:s=1080x1920:fps=30")
    else:  # 左移扫
        zp = (f"zoompan=z='1.06':x='(iw-iw/zoom)*(1-on/{frames})'"
              f":y='ih/2-(ih/zoom/2)':d={frames}:s=1080x1920:fps=30")
    return (
        "scale=1080:1920:force_original_aspect_ratio=increase,"
        "crop=1080:1920,"
        f"{zp},"
        "format=yuv420p"
    )


def _concat_with_xfade(segments: list[Path], durations: list[float],
                        output: Path) -> None:
    """xfade 水墨溶解转场拼接，替代 concat -c copy 的硬切。"""
    if len(segments) == 1:
        shutil.copy(str(segments[0]), str(output))
        return

    inputs: list[str] = []
    for seg in segments:
        inputs += ["-i", str(seg)]

    filter_parts: list[str] = []
    prev = "[0:v]"
    cumulative = 0.0
    n = len(segments)
    for i in range(n - 1):
        cumulative += durations[i]
        offset = max(0.0, cumulative - (i + 1) * _XFADE_DUR)
        next_in = f"[{i + 1}:v]"
        out = "[vout]" if i == n - 2 else f"[v{i}]"
        filter_parts.append(
            f"{prev}{next_in}"
            f"xfade=transition={_XFADE_TRANSITION}:duration={_XFADE_DUR}:offset={offset:.3f}"
            f"{out}"
        )
        prev = out

    cmd = [
        "ffmpeg", "-y",
        *inputs,
        "-filter_complex", ";".join(filter_parts),
        "-map", "[vout]",
        "-c:v", "libx264", "-preset", "fast", "-crf", "20",
        "-pix_fmt", "yuv420p",
        str(output),
    ]
    result = subprocess.run(
        cmd, capture_output=True, text=True, encoding="utf-8", errors="replace"
    )
    if result.returncode != 0:
        raise RuntimeError(f"拼接转场失败：\n{result.stderr[-2000:]}")


def _make_image_segment(image: Path, output: Path, duration: float, zoom_expr: str,
                        overlay_image: Path | None = None,
                        beat_index: int = 0) -> None:
    bg = _build_kb_filter(duration, zoom_expr, beat_index)
    if overlay_image and overlay_image.exists():
        cmd = _segment_with_book_cmd(image, overlay_image, output, duration, bg)
    else:
        cmd = [
            "ffmpeg", "-y", "-loop", "1", "-i", str(image), "-t", str(duration),
            "-vf", bg, "-an", "-c:v", "libx264", "-preset", "veryfast", "-crf", "20",
            str(output),
        ]
    result = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace")
    if result.returncode != 0:
        raise RuntimeError(f"生成分镜片段失败：\n{result.stderr[-1600:]}")


def _segment_with_book_cmd(bg_img: Path, book_img: Path, output: Path,
                           duration: float, bg_filter: str) -> list[str]:
    """在分镜背景上叠加居中书封画中画（白边 + 淡入），用于"提到书"的拍。

    书封缩放到宽约 660px（≈画面 61%）、水平居中、垂直偏上 y=340 避开底部字幕区。
    """
    fc = (
        f"[0:v]{bg_filter}[bg];"
        "[1:v]scale=660:-1,pad=iw+28:ih+28:14:14:white,format=yuva420p,"
        "fade=t=in:st=0:d=0.4:alpha=1[bk];"
        "[bg][bk]overlay=(W-w)/2:340[out]"
    )
    # 两路输入保持 -loop 1 无限（喂单帧给 zoompan），靠输出端 -t 截断总时长——与无叠加路径一致
    return [
        "ffmpeg", "-y",
        "-loop", "1", "-i", str(bg_img),
        "-loop", "1", "-i", str(book_img),
        "-filter_complex", fc,
        "-map", "[out]",
        "-t", str(duration),
        "-an", "-c:v", "libx264", "-preset", "veryfast", "-crf", "20",
        str(output),
    ]


def _concat_segments(concat_file: Path, output: Path) -> None:
    result = subprocess.run(
        [
            "ffmpeg", "-y",
            "-f", "concat",
            "-safe", "0",
            "-i", str(concat_file),
            "-c", "copy",
            str(output),
        ],
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    if result.returncode != 0:
        raise RuntimeError(f"拼接分镜片段失败：\n{result.stderr[-1600:]}")


def _build_subtitles(tts_dir: Path, task_dir: Path, variant: str,
                     log: Callable[[str], None]) -> str | None:
    """从配音时间戳生成对标风格 ASS 字幕，写到 task_dir，返回相对文件名（供烧录）。"""
    units = None
    word_path = tts_dir / "tts_words.json"
    seg_path = tts_dir / "tts_segments.json"
    # 优先 tts_words（精确逐字时间戳），次选 tts_segments（粗糙分段）
    if word_path.exists():
        units = json.loads(word_path.read_text(encoding="utf-8"))
    elif seg_path.exists():
        units = json.loads(seg_path.read_text(encoding="utf-8"))
    if not units:
        log("（无配音时间戳，跳过字幕）")
        return None
    ass_name = f"_subs_{variant}.ass"
    count = subtitle_gen.build_ass(units, task_dir / ass_name)
    log(f"字幕生成 {count} 行（对标样式）")
    return ass_name


def _mux_audio(video: Path, audio: Path, output: Path,
               ass_name: str | None = None, cwd: Path | None = None) -> None:
    audio_duration = _duration(audio)
    cmd = [
        "ffmpeg", "-y",
        "-stream_loop", "-1",
        "-i", str(video),
        "-i", str(audio),
        "-t", str(audio_duration),
        "-map", "0:v:0",
        "-map", "1:a:0",
    ]
    if ass_name:  # 烧录字幕（相对路径 + cwd，规避 Windows 路径转义）
        cmd += ["-vf", f"ass={ass_name}"]
    cmd += [
        "-c:v", "libx264",
        "-preset", "fast",
        "-crf", "20",
        "-c:a", "aac",
        "-b:a", "192k",
        "-ar", "44100",  # 标准化采样率：cosyvoice 原始 22050Hz 单声道在部分播放器/移动端无声
        "-ac", "2",      # 标准化为立体声，兼容微信视频号等播放环境
        "-shortest",
        "-pix_fmt", "yuv420p",
        str(output),
    ]
    result = subprocess.run(
        cmd, cwd=str(cwd) if cwd else None,
        capture_output=True, text=True, encoding="utf-8", errors="replace",
    )
    if result.returncode != 0:
        raise RuntimeError(f"合成分镜视频失败：\n{result.stderr[-2000:]}")


def _duration(path: Path) -> float:
    result = subprocess.run(
        [
            "ffprobe", "-v", "error",
            "-show_entries", "format=duration",
            "-of", "default=noprint_wrappers=1:nokey=1",
            str(path),
        ],
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        raise RuntimeError(f"ffprobe 失败：{result.stderr}")
    return float(result.stdout.strip())
