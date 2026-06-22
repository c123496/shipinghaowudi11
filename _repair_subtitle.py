"""修复任务字幕时间戳并重新生成视频（不重跑 TTS）。

用法：
    python _repair_subtitle.py [task_id] [variant]

默认 task_id = 54097fb9-2c80-49da-89b4-12e316815bfa，variant = rewrite
同时修复：
  - 繁体字字幕（ASR 识别的繁体 → 原稿简体）
  - ASR 识别错误（如"畜生"→"出处身" → 原稿正确字）
  - 封面图（参考视频封面 → 分镜首图）
"""
import shutil
import sys
import json
from pathlib import Path

ROOT = Path(__file__).parent
sys.path.insert(0, str(ROOT))

from backend.services.tts_gen import _asr_raw_timing, _align_original_text_to_asr, _words_from_segments
from backend.services import subtitle_gen
from backend.services.storyboard_video import _mux_audio


def log(msg: str) -> None:
    print(msg, flush=True)


def repair(task_id: str, variant: str = "rewrite") -> None:
    task_dir = ROOT / "data" / "tasks" / task_id
    tts_dir = task_dir / "variants" / f"{variant}_tts"

    # 优先用 variants/rewrite_tts/tts.mp3（与分镜视频完全对应）
    mp3_path = tts_dir / "tts.mp3" if (tts_dir / "tts.mp3").exists() else task_dir / "tts.mp3"
    if not mp3_path.exists():
        log(f"ERROR: 找不到 tts.mp3（查找路径：{tts_dir} / {task_dir}）")
        return

    log(f"=== 修复任务 {task_id[:8]}… 字幕 + 封面 ===")
    log(f"音频：{mp3_path}")

    # 1. 加载原稿分段（字幕文字来源，经用户确认、简体正确）
    seg_path = tts_dir / "tts_segments.json"
    if not seg_path.exists():
        seg_path = task_dir / "tts_segments.json"
    if not seg_path.exists():
        log("ERROR: 找不到 tts_segments.json")
        return
    segments = json.loads(seg_path.read_text(encoding="utf-8"))
    log(f"原稿分段：{len(segments)} 段，共 {sum(len(s.get('text','')) for s in segments)} 字")

    # 2. ASR 只取时间槽，字幕文字用原稿
    asr_slots = _asr_raw_timing(mp3_path, log)
    if len(asr_slots) >= 10:
        words = _align_original_text_to_asr(segments, asr_slots)
        log(f"原稿对齐完成：{len(words)} 字 × 时间槽（繁体字/识别错误已修复）")
    else:
        log("ASR 时间槽不足，降级为分段均匀分配（原稿文字）...")
        words = _words_from_segments(segments)

    # 3. 更新 tts_words.json
    words_json = json.dumps(words, ensure_ascii=False, indent=2)
    for p in [task_dir / "tts_words.json", tts_dir / "tts_words.json"]:
        if p.parent.exists():
            p.write_text(words_json, encoding="utf-8")
            log(f"已更新：{p.relative_to(ROOT)}")

    # 4. 重新生成 ASS 字幕
    ass_name = f"_subs_{variant}.ass"
    count = subtitle_gen.build_ass(words, task_dir / ass_name)
    log(f"重新生成字幕：{ass_name}（{count} 行）")

    # 5. 重新 mux 视频（复用已有 Ken-Burns 视觉轨）
    visual = task_dir / "variants" / f"{variant}_visual.mp4"
    audio_path = tts_dir / "tts.mp3"
    if not audio_path.exists():
        audio_path = task_dir / "tts.mp3"
    output = task_dir / f"storyboard_{variant}.mp4"

    if not visual.exists():
        log(f"ERROR: 视觉轨不存在：{visual}")
        return

    log(f"重新合成视频（{visual.name} + {audio_path.name} + {ass_name}）...")
    _mux_audio(visual, audio_path, output, ass_name=ass_name, cwd=task_dir)
    size_mb = output.stat().st_size / 1_048_576
    log(f"=== 完成！storyboard_{variant}.mp4（{size_mb:.1f} MB）===")

    # 6. 更新封面：用分镜首图替换参考视频封面
    first_cell = task_dir / "storyboard" / "grid_1_cell_1.png"
    if first_cell.exists():
        shutil.copy2(str(first_cell), str(task_dir / "cover.jpg"))
        log(f"封面已更新为分镜首图：{first_cell.name}")
    else:
        log("（未找到分镜首图，封面保持原样）")


if __name__ == "__main__":
    task_id = sys.argv[1] if len(sys.argv) > 1 else "54097fb9-2c80-49da-89b4-12e316815bfa"
    variant = sys.argv[2] if len(sys.argv) > 2 else "rewrite"
    repair(task_id, variant)
