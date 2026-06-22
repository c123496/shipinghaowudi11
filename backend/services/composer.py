import subprocess
import json
from pathlib import Path
from typing import Callable


def compose(task_dir: Path, log: Callable[[str], None]) -> None:
    audio = task_dir / "tts.mp3"
    srt = task_dir / "subtitles.srt"
    ass = task_dir / "subtitles.ass"
    output = task_dir / "final.mp4"
    cover = _find_cover(task_dir)

    if not audio.exists():
        raise FileNotFoundError("tts.mp3 不存在，请先完成 TTS 步骤")
    if not srt.exists():
        raise FileNotFoundError("subtitles.srt 不存在，请先完成字幕步骤")

    log("转换字幕为 ASS 格式...")
    _srt_to_ass(srt, ass)

    log("获取音频时长...")
    duration = _audio_duration(audio)
    log(f"音频时长：{duration:.1f}s")

    # Use forward slashes in FFmpeg filter paths (Windows compatibility)
    ass_for_filter = str(ass).replace("\\", "/").replace(":", "\\:")

    if cover and cover.exists():
        log(f"使用封面图：{cover.name}")
        input_args = ["-loop", "1", "-i", str(cover)]
        scale_filter = "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920"
        vf = f"{scale_filter},ass='{ass_for_filter}'"
    else:
        log("未找到封面图，使用纯色背景")
        input_args = ["-f", "lavfi", "-i", "color=c=#1a1a2e:size=1080x1920:rate=30"]
        vf = f"ass='{ass_for_filter}'"

    cmd = [
        "ffmpeg", "-y",
        *input_args,
        "-i", str(audio),
        "-vf", vf,
        "-c:v", "libx264", "-crf", "18", "-preset", "fast",
        "-c:a", "aac", "-b:a", "192k",
        "-t", str(duration),
        "-pix_fmt", "yuv420p",
        str(output),
    ]

    log("FFmpeg 合成中...")
    result = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace")

    if result.returncode != 0:
        raise RuntimeError(f"FFmpeg 失败：\n{result.stderr[-2000:]}")

    size_mb = output.stat().st_size / 1_048_576
    log(f"成片完成：final.mp4（{size_mb:.1f} MB）")


def _find_cover(task_dir: Path) -> Path | None:
    for name in ("cover.jpg", "cover.jpeg", "cover.png", "cover.webp"):
        p = task_dir / name
        if p.exists():
            return p
    return None


def _audio_duration(audio_path: Path) -> float:
    result = subprocess.run(
        [
            "ffprobe", "-v", "error",
            "-show_entries", "format=duration",
            "-of", "default=noprint_wrappers=1:nokey=1",
            str(audio_path),
        ],
        capture_output=True, text=True,
    )
    if result.returncode != 0:
        raise RuntimeError(f"ffprobe 失败：{result.stderr}")
    return float(result.stdout.strip())


def _srt_to_ass(srt_path: Path, ass_path: Path) -> None:
    header = """\
[Script Info]
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Microsoft YaHei,120,&H0000FFFF,&H000000FF,&H00000000,&H80000000,1,0,0,0,100,100,0,0,1,5,1,2,10,10,350,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""
    lines = [header.rstrip()]
    for entry in srt_path.read_text(encoding="utf-8").strip().split("\n\n"):
        parts = entry.strip().split("\n")
        if len(parts) < 3:
            continue
        start, end = parts[1].split(" --> ")
        text = " ".join(parts[2:])
        lines.append(f"Dialogue: 0,{_to_ass_ts(start)},{_to_ass_ts(end)},Default,,0,0,0,,{text}")

    ass_path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def _to_ass_ts(srt_ts: str) -> str:
    # "00:00:01,500" → "0:00:01.50"
    srt_ts = srt_ts.strip().replace(",", ".")
    h, m, rest = srt_ts.split(":")
    s, ms_str = rest.split(".")
    cs = int(ms_str[:3]) // 10
    return f"{int(h)}:{int(m):02d}:{int(s):02d}.{cs:02d}"
