"""语音转写：双后端可切（ASR_BACKEND）。

- whisper：本机 faster-whisper（medium/CPU），离线但慢（13min 视频约 15min）。
- qwen：阿里云百炼 Qwen3-ASR-Flash-Filetrans 云端录音文件识别，快、带句级/词级时间戳。
  流程：抽音频 → 传公网直链 → 异步提交 → 轮询 → 下载结果 JSON → 对齐 transcript.json。
"""
import json
import os
import subprocess
import time
from pathlib import Path
from typing import Callable

try:
    from zhconv import convert as _zh_convert
except ImportError:
    _zh_convert = None


def _load_env() -> None:
    env_file = Path(__file__).resolve().parents[2] / ".env"
    if not env_file.exists():
        return
    for line in env_file.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            key, value = line.split("=", 1)
            os.environ.setdefault(key.strip(), value.strip())


def _bypass_proxy_for_dashscope() -> None:
    """把阿里云百炼域名加入 no_proxy，避免全局代理(Clash)干扰 dashscope ASR。

    本机开全局代理时，dashscope(aliyuncs.com，国内服务)会被代理卡出 SSLError、
    只能靠反复重试硬扛。把其域名列入 no_proxy 让它直连即可。海外图床(litterbox)
    上传不在白名单内，仍走代理，互不影响。
    """
    hosts = "dashscope.aliyuncs.com,.aliyuncs.com,aliyuncs.com"
    for key in ("no_proxy", "NO_PROXY"):
        existing = os.environ.get(key, "")
        seen, parts = set(), []
        for p in (existing + "," + hosts).split(","):
            p = p.strip()
            if p and p not in seen:
                seen.add(p)
                parts.append(p)
        os.environ[key] = ",".join(parts)


def transcribe(video_path: Path, task_dir: Path, log: Callable[[str], None],
               backend: str | None = None) -> dict:
    if not video_path.exists():
        raise FileNotFoundError(f"视频文件不存在：{video_path}")
    _load_env()
    chosen = (backend or os.getenv("ASR_BACKEND", "whisper")).strip().lower()
    if chosen not in {"whisper", "qwen"}:
        raise ValueError(f"未知 ASR 后端：{chosen!r}（可选 whisper / qwen）")
    source = "本次手动指定" if backend else "跟随 .env 配置"
    label = "云端 Qwen3-ASR（付费，快）" if chosen == "qwen" else "本地 faster-whisper（免费，慢）"
    log(f"转写后端：{label}（{source}）")
    if chosen == "qwen":
        return _transcribe_qwen(video_path, task_dir, log)
    return _transcribe_whisper(video_path, task_dir, log)


# ============ 云端：Qwen3-ASR ============

def _transcribe_qwen(video_path: Path, task_dir: Path, log: Callable[[str], None]) -> dict:
    key = os.getenv("DASHSCOPE_API_KEY", "").strip()
    if not key:
        raise EnvironmentError("ASR_BACKEND=qwen 但缺少 DASHSCOPE_API_KEY，请在 .env 设置")
    model = os.getenv("QWEN_ASR_MODEL", "qwen3-asr-flash-filetrans").strip()

    audio = task_dir / "_asr_audio.mp3"
    log("抽取音频（16k 单声道）...")
    result = subprocess.run(
        ["ffmpeg", "-y", "-i", str(video_path), "-vn", "-ar", "16000", "-ac", "1",
         "-codec:a", "libmp3lame", "-q:a", "5", str(audio)],
        capture_output=True, text=True, encoding="utf-8", errors="replace",
    )
    if result.returncode != 0:
        raise RuntimeError(f"抽取音频失败：\n{result.stderr[-1000:]}")

    import dashscope

    _bypass_proxy_for_dashscope()
    dashscope.api_key = key

    log("上传音频到 DashScope OSS（国内直连）...")
    file_url = _upload_oss(model, audio, key, log)
    log(f"OSS 直链就绪，提交 {model} 云端转写...")
    task = _submit_qwen(model, file_url, log)
    result_url = _poll_qwen(task, log)

    log("下载转写结果...")
    data = _download_json(result_url)
    transcript = _parse_qwen(data)

    _write_transcript(task_dir, transcript)
    try:
        audio.unlink(missing_ok=True)
    except OSError:
        log("（临时音频文件被占用，跳过清理，不影响结果）")
    log(f"云端转写完成，{len(transcript['segments'])} 句，共 {len(transcript['full_text'])} 字")
    return transcript


def _upload_oss(model: str, path: Path, key: str, log: Callable[[str], None], retries: int = 3) -> str:
    """上传到 DashScope 临时 OSS（dashscope-instant），返回 oss:// 直链。

    取代旧的海外图床(litterbox/0x0.st)——海外上传必走代理(Clash)，3MB 音频 POST
    极易被掐成 SSL UNEXPECTED_EOF，是转写步反复失败的根因。OSS 是国内 aliyuncs
    域名、已在 no_proxy 白名单直连，秒传且无需翻墙。配 _OSS_RESOLVE_HEADER 让
    云端把 oss:// 解析为可读直链。"""
    from dashscope.utils.oss_utils import OssUtils
    last = None
    for attempt in range(1, retries + 1):
        try:
            file_url, _ = OssUtils.upload(model=model, file_path=str(path), api_key=key)
            if file_url:
                return file_url
            raise RuntimeError("OSS 返回空直链")
        except Exception as exc:  # 取凭证/上传瞬时抖动 → 退避重试
            last = exc
            if attempt >= retries:
                raise RuntimeError(f"音频上传 OSS 失败：{exc}")
            log(f"  OSS 上传重试 {attempt}/{retries}（{type(exc).__name__}）")
            time.sleep(3)


# oss:// 直链需此头，云端才会把它解析为可读资源。
_OSS_RESOLVE_HEADER = {"X-DashScope-OssResourceResolve": "enable"}


def _submit_qwen(model: str, file_url: str, log: Callable[[str], None], retries: int = 3):
    """提交云端转写任务；瞬时 SSL/网络抖动或网关错误自动重试。

    与 _poll_qwen 的重试对称——提交环节也会遇到 SSL UNEXPECTED_EOF 等瞬断。
    """
    from dashscope.audio.qwen_asr import QwenTranscription
    for attempt in range(1, retries + 1):
        try:
            task = QwenTranscription.async_call(
                model=model, file_url=file_url, enable_words=True,
                headers=_OSS_RESOLVE_HEADER)
            code = getattr(task, "status_code", 200)
            if code and code >= 400:
                raise RuntimeError(f"提交被拒 status_code={code}")
            return task
        except Exception as exc:  # 瞬时 SSL/网络抖动 → 退避后重试
            if attempt >= retries:
                raise
            log(f"  提交重试 {attempt}/{retries}（{type(exc).__name__}）")
            time.sleep(5)


def _poll_qwen(task, log: Callable[[str], None], timeout: float = 1200) -> str:
    from dashscope.audio.qwen_asr import QwenTranscription
    end = time.time() + timeout
    last = ""
    while time.time() < end:
        time.sleep(5)
        try:
            resp = QwenTranscription.fetch(task)
        except Exception as exc:  # 瞬时 SSL/网络抖动，重试
            log(f"  轮询重试（{type(exc).__name__}）")
            continue
        status = (resp.output or {}).get("task_status")
        if status != last:
            log(f"  云端转写：{status}")
            last = status
        if status == "SUCCEEDED":
            return resp.output["result"]["transcription_url"]
        if status == "FAILED":
            raise RuntimeError(f"云端转写失败：{json.dumps(resp.output, ensure_ascii=False)[:300]}")
    raise RuntimeError("云端转写超时")


def _download_json(url: str) -> dict:
    import requests
    resp = requests.get(url, timeout=90)
    resp.raise_for_status()
    return resp.json()


def _parse_qwen(data: dict) -> dict:
    transcripts = data.get("transcripts") or []
    if not transcripts:
        raise RuntimeError("云端转写结果为空")
    head = transcripts[0]
    segments = []
    for sent in head.get("sentences", []):
        segments.append({
            "id": sent.get("sentence_id", len(segments)),
            "start": round(sent.get("begin_time", 0) / 1000, 3),
            "end": round(sent.get("end_time", 0) / 1000, 3),
            "text": (sent.get("text") or "").strip(),
            "words": [
                {"word": w.get("text", ""),
                 "start": round(w.get("begin_time", 0) / 1000, 3),
                 "end": round(w.get("end_time", 0) / 1000, 3)}
                for w in sent.get("words", [])
            ],
        })
    full_text = (head.get("text") or "").strip() or " ".join(s["text"] for s in segments)
    duration = segments[-1]["end"] if segments else 0
    return {"language": "zh", "duration": duration, "full_text": full_text, "segments": segments}


# ============ 本机：faster-whisper ============

_model = None


def _to_simplified(text: str) -> str:
    return _zh_convert(text, "zh-cn") if _zh_convert else text


def _get_model():
    global _model
    if _model is None:
        from faster_whisper import WhisperModel
        _model = WhisperModel("medium", device="cpu", compute_type="int8")
    return _model


def _transcribe_whisper(video_path: Path, task_dir: Path, log: Callable[[str], None]) -> dict:
    log("加载 Whisper 模型（首次较慢）...")
    model = _get_model()
    log(f"开始转录：{video_path.name}")

    segments_iter, info = model.transcribe(
        str(video_path), language="zh", beam_size=5, word_timestamps=True,
    )

    segments = []
    for seg in segments_iter:
        text = _to_simplified(seg.text.strip())
        segments.append({
            "id": seg.id,
            "start": round(seg.start, 3),
            "end": round(seg.end, 3),
            "text": text,
            "words": [
                {"word": _to_simplified(w.word), "start": round(w.start, 3), "end": round(w.end, 3)}
                for w in (seg.words or [])
            ],
        })
        log(f"[{_srt_time(seg.start)}] {text[:40]}")

    transcript = {
        "language": info.language,
        "duration": round(info.duration or 0, 3),
        "full_text": " ".join(s["text"] for s in segments),
        "segments": segments,
    }
    _write_transcript(task_dir, transcript)
    log(f"转录完成，{len(segments)} 段，语言：{info.language}")
    return transcript


# ============ 公共：写盘 ============

def _write_transcript(task_dir: Path, transcript: dict) -> None:
    (task_dir / "transcript.json").write_text(
        json.dumps(transcript, ensure_ascii=False, indent=2), encoding="utf-8")
    srt_parts = [
        f"{i + 1}\n{_srt_time(s['start'])} --> {_srt_time(s['end'])}\n{s['text']}"
        for i, s in enumerate(transcript["segments"])
    ]
    (task_dir / "source.srt").write_text("\n\n".join(srt_parts), encoding="utf-8")


def _srt_time(seconds: float) -> str:
    h = int(seconds // 3600)
    m = int((seconds % 3600) // 60)
    s = int(seconds % 60)
    ms = int((seconds % 1) * 1000)
    return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"
