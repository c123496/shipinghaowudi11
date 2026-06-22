import base64
import json
import os
import re
import subprocess
import time
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Callable

import edge_tts

VOICE = "zh-CN-XiaoxiaoNeural"
QWEN_DEFAULT_MODEL = "Qwen/Qwen3-TTS-12Hz-0.6B-Base"
_QWEN_MODEL = None
_QWEN_PROMPT_CACHE: dict[tuple[str, str, str], object] = {}


def _bypass_proxy_for_dashscope() -> None:
    """把阿里云百炼域名加入 no_proxy。

    本机若开了全局代理（Clash 等），DashScope 的 WebSocket 长连接（CosyVoice）会
    被代理卡死，报 "websocket connection could not established within 5s"。
    DashScope 是国内服务，直连即可，故将其域名列入 no_proxy 让其绕过代理。
    """
    hosts = "dashscope.aliyuncs.com,.aliyuncs.com,aliyuncs.com"
    for key in ("no_proxy", "NO_PROXY"):
        existing = os.environ.get(key, "")
        merged = ",".join(p for p in [existing, hosts] if p)
        # 去重保序
        seen, parts = set(), []
        for p in merged.split(","):
            p = p.strip()
            if p and p not in seen:
                seen.add(p)
                parts.append(p)
        os.environ[key] = ",".join(parts)


def _load_project_env() -> None:
    env_file = Path(__file__).resolve().parents[2] / ".env"
    if not env_file.exists():
        return
    for line in env_file.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            key, value = line.split("=", 1)
            os.environ.setdefault(key.strip(), value.strip())

@dataclass(frozen=True)
class TTSBackendConfig:
    backend: str
    model_id: str = QWEN_DEFAULT_MODEL
    device_map: str = "cpu"
    language: str = "Chinese"
    ref_audio: Path | None = None
    ref_text: str = ""
    x_vector_only_mode: bool = False
    max_chunk_chars: int = 120
    cosyvoice_voice_id: str = ""
    cosyvoice_model: str = "cosyvoice-v2"
    cosyvoice_concurrency: int = 6
    qwen_api_model: str = "qwen3-tts-flash"
    qwen_api_voice: str = "Cherry"


def get_tts_backend_config(task_dir: Path, backend_override: str | None = None) -> TTSBackendConfig:
    _load_project_env()
    backend = (backend_override or os.getenv("TTS_BACKEND", "edge")).strip().lower()
    if backend not in {"edge", "qwen", "cosyvoice", "qwen_api"}:
        raise ValueError("TTS_BACKEND 仅支持 edge / qwen / cosyvoice / qwen_api")
    if backend == "edge":
        return TTSBackendConfig(backend="edge")

    if backend == "cosyvoice":
        if not os.getenv("DASHSCOPE_API_KEY", "").strip():
            raise ValueError("已选择 CosyVoice，但缺少 DASHSCOPE_API_KEY（请在 .env 设置）")
        voice_id = os.getenv("COSYVOICE_VOICE_ID", "").strip()
        if not voice_id:
            raise ValueError(
                "已选择 CosyVoice，但缺少 COSYVOICE_VOICE_ID。"
                "请先用声音复刻创建三国音色，并把 voice_id 写入 .env。"
            )
        return TTSBackendConfig(
            backend="cosyvoice",
            cosyvoice_voice_id=voice_id,
            cosyvoice_model=os.getenv("COSYVOICE_MODEL", "cosyvoice-v2").strip() or "cosyvoice-v2",
            cosyvoice_concurrency=int(os.getenv("COSYVOICE_CONCURRENCY", "6")),
            max_chunk_chars=int(os.getenv("COSYVOICE_MAX_CHUNK_CHARS", "200")),
        )

    if backend == "qwen_api":
        if not os.getenv("DASHSCOPE_API_KEY", "").strip():
            raise ValueError("已选择 Qwen API TTS，但缺少 DASHSCOPE_API_KEY（请在 .env 设置）")
        return TTSBackendConfig(
            backend="qwen_api",
            qwen_api_model=os.getenv("QWEN_API_TTS_MODEL", "qwen3-tts-flash").strip() or "qwen3-tts-flash",
            qwen_api_voice=os.getenv("QWEN_API_TTS_VOICE", "Cherry").strip() or "Cherry",
            max_chunk_chars=int(os.getenv("QWEN_API_TTS_MAX_CHUNK_CHARS", "1800")),
        )

    ref_audio_value = os.getenv("QWEN_TTS_REF_AUDIO", "").strip()
    ref_audio = Path(ref_audio_value) if ref_audio_value else _find_task_ref_audio(task_dir)
    if not ref_audio:
        ref_audio = _prepare_task_reference(task_dir)
    if not ref_audio:
        raise ValueError(
            "已选择 Qwen TTS，但缺少参考音频。请设置 QWEN_TTS_REF_AUDIO，"
            "或把 voice.wav/ref.wav 放到任务目录。"
        )
    if not ref_audio.exists():
        raise FileNotFoundError(f"QWEN_TTS_REF_AUDIO 不存在：{ref_audio}")

    ref_text = os.getenv("QWEN_TTS_REF_TEXT", "").strip() or _read_task_ref_text(task_dir)
    x_vector_only = os.getenv("QWEN_TTS_X_VECTOR_ONLY", "0").strip().lower() in {"1", "true", "yes", "on"}
    if not ref_text and not x_vector_only:
        raise ValueError(
            "Qwen 声音克隆需要参考音频对应文本。请设置 QWEN_TTS_REF_TEXT，"
            "或在任务目录写入 qwen_ref.txt；若只想用音色向量，可设置 QWEN_TTS_X_VECTOR_ONLY=1。"
        )

    return TTSBackendConfig(
        backend="qwen",
        model_id=os.getenv("QWEN_TTS_MODEL_ID", QWEN_DEFAULT_MODEL).strip() or QWEN_DEFAULT_MODEL,
        device_map=os.getenv("QWEN_TTS_DEVICE_MAP", "cpu").strip() or "cpu",
        language=os.getenv("QWEN_TTS_LANGUAGE", "Chinese").strip() or "Chinese",
        ref_audio=ref_audio,
        ref_text=ref_text,
        x_vector_only_mode=x_vector_only,
        max_chunk_chars=int(os.getenv("QWEN_TTS_MAX_CHUNK_CHARS", "120")),
    )


_BACKEND_LABEL = {
    "qwen": "本地 Qwen3-TTS 克隆（免费，慢）",
    "cosyvoice": "云端 CosyVoice 克隆（付费，快）",
    "qwen_api": "云端 Qwen API（付费）",
    "edge": "edge-tts（免费，无克隆）",
}


async def synthesize(text: str, task_dir: Path, log: Callable[[str], None],
                     backend: str | None = None) -> None:
    cleaned = _clean_for_tts(text)
    if len(cleaned) != len(text):
        log(f"已清洗文案：去掉制作标注，{len(text)} → {len(cleaned)} 字")
    config = get_tts_backend_config(task_dir, backend)
    source = "本次手动指定" if backend else "跟随 .env 配置"
    log(f"配音后端：{_BACKEND_LABEL.get(config.backend, config.backend)}（{source}）")
    if config.backend == "cosyvoice":
        await _synthesize_cosyvoice(cleaned, task_dir, log, config)
        return
    if config.backend == "qwen_api":
        await _synthesize_qwen_api(cleaned, task_dir, log, config)
        return
    if config.backend == "qwen":
        await _synthesize_qwen(cleaned, task_dir, log, config)
        return
    await _synthesize_edge(cleaned, task_dir, log)


def _clean_for_tts(text: str) -> str:
    """配音前清洗：去掉「（开头5秒）」这类括号制作标注，避免被念出来。"""
    text = re.sub(r"[（(][^（）()]*[)）]", "", text)
    return text.strip()


async def _synthesize_edge(text: str, task_dir: Path, log: Callable[[str], None]) -> None:
    mp3_path = task_dir / "tts.mp3"
    words_path = task_dir / "tts_words.json"

    log(f"TTS 合成中，音色：{VOICE}，文本 {len(text)} 字")

    # boundary 默认是 SentenceBoundary（整句一条），需显式指定 WordBoundary 才有词级时间戳
    communicate = edge_tts.Communicate(text, VOICE, boundary="WordBoundary")
    submaker = edge_tts.SubMaker()

    with open(mp3_path, "wb") as f:
        async for chunk in communicate.stream():
            if chunk["type"] == "audio":
                f.write(chunk["data"])
            elif chunk["type"] == "WordBoundary":
                submaker.feed(chunk)

    # edge-tts 7.x：词级时间戳来自 submaker.cues（srt.Subtitle 列表，
    # start/end 为 timedelta），旧版的 sub_metadata 已移除。
    words = [
        {
            "text": cue.content,
            "start": round(cue.start.total_seconds(), 3),
            "end": round(cue.end.total_seconds(), 3),
        }
        for cue in submaker.cues
    ]

    words_path.write_text(json.dumps(words, ensure_ascii=False, indent=2), encoding="utf-8")
    log(f"TTS 完成，{len(words)} 个词，音频已保存")


async def _synthesize_qwen_api(text: str, task_dir: Path, log: Callable[[str], None], config: TTSBackendConfig) -> None:
    try:
        from dashscope.audio.qwen_tts import SpeechSynthesizer
    except ImportError as exc:
        raise RuntimeError("缺少 dashscope qwen_tts 依赖，请先安装或升级 dashscope") from exc

    api_key = os.getenv("DASHSCOPE_API_KEY", "").strip()
    if not api_key:
        raise ValueError("缺少 DASHSCOPE_API_KEY，无法调用 Qwen API TTS")

    mp3_path = task_dir / "tts.mp3"
    words_path = task_dir / "tts_words.json"
    parts_dir = task_dir / "_qwen_api_tts_parts"
    parts_dir.mkdir(parents=True, exist_ok=True)

    chunks = _split_text(text, config.max_chunk_chars)
    log(
        f"Qwen API TTS 合成中：{config.qwen_api_model} / {config.qwen_api_voice}，"
        f"文本 {len(text)} 字，分 {len(chunks)} 段"
    )

    part_files: list[Path] = []
    segments: list[dict] = []
    cursor = 0.0

    for index, chunk in enumerate(chunks, 1):
        log(f"Qwen API TTS 第 {index}/{len(chunks)} 段，{len(chunk)} 字")
        response = SpeechSynthesizer.call(
            model=config.qwen_api_model,
            text=chunk,
            voice=config.qwen_api_voice,
            api_key=api_key,
        )
        status_code = int(_response_field(response, "status_code", 0) or 0)
        if status_code != 200:
            message = _response_field(response, "message", "") or _response_field(response, "error_message", "")
            raise RuntimeError(f"Qwen API TTS 调用失败：{status_code} {message}")

        audio = _response_field(_response_field(response, "output"), "audio")
        if audio is None:
            raise RuntimeError("Qwen API TTS 响应缺少音频数据")

        raw_path = parts_dir / f"{index:03d}.audio"
        data = _response_field(audio, "data")
        url = _response_field(audio, "url")
        if data:
            raw_path.write_bytes(base64.b64decode(data))
        elif url:
            with urllib.request.urlopen(url, timeout=120) as response_body:
                raw_path.write_bytes(response_body.read())
        else:
            raise RuntimeError("Qwen API TTS 响应缺少 audio.data 或 audio.url")

        part_path = parts_dir / f"{index:03d}.mp3"
        _convert_audio(raw_path, part_path)
        raw_path.unlink(missing_ok=True)
        part_files.append(part_path)

        duration = _audio_duration(part_path)
        segments.append(
            {
                "index": index,
                "text": chunk,
                "start": round(cursor, 3),
                "end": round(cursor + duration, 3),
                "duration": round(duration, 3),
                "audio": part_path.name,
            }
        )
        cursor += duration

    if len(part_files) == 1:
        part_files[0].replace(mp3_path)
    else:
        concat_file = parts_dir / "concat.txt"
        concat_file.write_text(
            "\n".join(f"file '{path.resolve().as_posix()}'" for path in part_files),
            encoding="utf-8",
        )
        result = subprocess.run(
            [
                "ffmpeg",
                "-y",
                "-f",
                "concat",
                "-safe",
                "0",
                "-i",
                str(concat_file),
                "-c",
                "copy",
                str(mp3_path),
            ],
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
        )
        if result.returncode != 0:
            raise RuntimeError(f"Qwen API TTS 音频拼接失败：\n{result.stderr[-2000:]}")

    (task_dir / "tts_segments.json").write_text(
        json.dumps(segments, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    duration = _audio_duration(mp3_path)
    words = _asr_word_timestamps(mp3_path, segments, log)
    words_path.write_text(json.dumps(words, ensure_ascii=False, indent=2), encoding="utf-8")
    log(f"Qwen API TTS 完成，音频时长 {duration:.1f}s，字幕时间戳 {len(words)} 项")


def _response_field(response_part, field_name: str, default=None):
    if response_part is None:
        return default
    if isinstance(response_part, dict):
        return response_part.get(field_name, default)
    try:
        return getattr(response_part, field_name)
    except (AttributeError, KeyError):
        return default


async def _synthesize_cosyvoice(
    text: str, task_dir: Path, log: Callable[[str], None], config: TTSBackendConfig
) -> None:
    """阿里云百炼 CosyVoice 云端克隆合成：长文切段 + 并发，毫秒级、不吃本机 CPU。"""
    import asyncio
    from concurrent.futures import ThreadPoolExecutor

    try:
        import dashscope
        from dashscope.audio.tts_v2 import SpeechSynthesizer
    except ImportError as exc:
        raise RuntimeError("缺少 dashscope。请安装：python -m pip install -U dashscope") from exc

    _bypass_proxy_for_dashscope()
    dashscope.api_key = os.getenv("DASHSCOPE_API_KEY", "").strip()
    mp3_path = task_dir / "tts.mp3"
    words_path = task_dir / "tts_words.json"

    chunks = _split_text(text, config.max_chunk_chars)
    log(f"CosyVoice 云端合成（{config.cosyvoice_model}，音色 {config.cosyvoice_voice_id[:24]}…）"
        f"，{len(chunks)} 段 × {config.cosyvoice_concurrency} 并发")

    def _synth(chunk: str) -> bytes:
        last_err: Exception | None = None
        for attempt in range(5):
            try:
                synthesizer = SpeechSynthesizer(
                    model=config.cosyvoice_model, voice=config.cosyvoice_voice_id)
                audio = synthesizer.call(chunk)
                if audio:
                    return audio
                last_err = RuntimeError(f"空音频 {synthesizer.get_last_request_id()}")
            except Exception as exc:  # 并发被限/连接关闭等，退避重试
                last_err = exc
            time.sleep(1.5 * (attempt + 1))
        raise RuntimeError(f"CosyVoice 合成失败（已重试5次）：{last_err}")

    loop = asyncio.get_event_loop()
    with ThreadPoolExecutor(max_workers=config.cosyvoice_concurrency) as pool:
        audios = await loop.run_in_executor(None, lambda: list(pool.map(_synth, chunks)))

    parts_dir = task_dir / "_cosy_parts"
    parts_dir.mkdir(parents=True, exist_ok=True)
    part_files = []
    for index, audio in enumerate(audios):
        part = parts_dir / f"{index:03d}.mp3"
        part.write_bytes(audio)
        part_files.append(part)

    # 量每段真实时长，得到精确的分段时间戳（供字幕对齐）
    segments = []
    cursor = 0.0
    for chunk, part in zip(chunks, part_files):
        seg_dur = _audio_duration(part)
        segments.append({"text": chunk, "start": round(cursor, 3), "end": round(cursor + seg_dur, 3)})
        cursor += seg_dur
    (task_dir / "tts_segments.json").write_text(
        json.dumps(segments, ensure_ascii=False, indent=2), encoding="utf-8")

    list_file = parts_dir / "concat.txt"
    list_file.write_text("\n".join(f"file '{p.as_posix()}'" for p in part_files), encoding="utf-8")
    result = subprocess.run(
        ["ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i", str(list_file),
         "-codec:a", "libmp3lame", "-q:a", "2", str(mp3_path)],
        capture_output=True, text=True, encoding="utf-8", errors="replace",
    )
    if result.returncode != 0:
        raise RuntimeError(f"CosyVoice 音频拼接失败：\n{result.stderr[-1500:]}")
    for part in part_files:
        part.unlink(missing_ok=True)
    list_file.unlink(missing_ok=True)

    duration = _audio_duration(mp3_path)
    words = _asr_word_timestamps(mp3_path, segments, log)
    words_path.write_text(json.dumps(words, ensure_ascii=False, indent=2), encoding="utf-8")
    log(f"CosyVoice 完成，音频 {duration:.1f}s，字幕时间戳 {len(words)} 项")


async def _synthesize_qwen(
    text: str, task_dir: Path, log: Callable[[str], None], config: TTSBackendConfig
) -> None:
    wav_path = task_dir / "tts.wav"
    mp3_path = task_dir / "tts.mp3"
    words_path = task_dir / "tts_words.json"

    log(f"Qwen3-TTS CPU 合成中：{config.model_id}，文本 {len(text)} 字")
    chunks = _split_text(text, config.max_chunk_chars)
    log(f"长文本已切分为 {len(chunks)} 段")

    # CPU 重计算放工作线程：不堵事件循环，SSE 日志和其余接口保持响应
    import asyncio
    wavs, sample_rate = await asyncio.to_thread(_generate_qwen_wav, chunks, config, log)

    # 按每段真实音频时长写分段时间戳（与 CosyVoice 路径一致），避免字幕漂移
    import numpy as np
    segments, cursor = [], 0.0
    for chunk, wav in zip(chunks, wavs):
        seg_dur = len(wav) / sample_rate
        segments.append({"text": chunk, "start": round(cursor, 3), "end": round(cursor + seg_dur, 3)})
        cursor += seg_dur
    (task_dir / "tts_segments.json").write_text(
        json.dumps(segments, ensure_ascii=False, indent=2), encoding="utf-8")

    _write_wav(wav_path, np.concatenate(wavs), sample_rate)
    _convert_audio(wav_path, mp3_path)

    duration = _audio_duration(mp3_path)
    words = _asr_word_timestamps(mp3_path, segments, log)
    words_path.write_text(json.dumps(words, ensure_ascii=False, indent=2), encoding="utf-8")
    log(f"Qwen3-TTS 完成，音频 {duration:.1f}s，字幕时间戳 {len(words)} 项")


def _generate_qwen_wav(chunks: list[str], config: TTSBackendConfig, log: Callable[[str], None]):
    _ensure_sox_path()

    try:
        import numpy as np
        import torch
        from qwen_tts import Qwen3TTSModel
    except ImportError as exc:
        raise RuntimeError(
            "缺少 Qwen3-TTS 依赖。请在后端 Python 环境安装：pip install -U qwen-tts soundfile"
        ) from exc

    global _QWEN_MODEL
    if _QWEN_MODEL is None:
        dtype = torch.float32 if config.device_map == "cpu" else torch.bfloat16
        log(f"首次加载 Qwen3-TTS 模型（{config.device_map}，可能较慢）...")
        _QWEN_MODEL = Qwen3TTSModel.from_pretrained(
            config.model_id,
            device_map=config.device_map,
            dtype=dtype,
            attn_implementation=os.getenv("QWEN_TTS_ATTN", "eager"),
        )

    assert config.ref_audio is not None
    prompt_key = (str(config.ref_audio.resolve()), config.ref_text, str(config.x_vector_only_mode))
    if prompt_key not in _QWEN_PROMPT_CACHE:
        log("提取参考音频音色特征...")
        _QWEN_PROMPT_CACHE[prompt_key] = _QWEN_MODEL.create_voice_clone_prompt(
            ref_audio=str(config.ref_audio),
            ref_text=config.ref_text,
            x_vector_only_mode=config.x_vector_only_mode,
        )

    generated = []
    sample_rate = None
    start = time.time()
    total_chars = sum(len(c) for c in chunks)
    done_chars = 0
    for index, chunk in enumerate(chunks, 1):
        log(f"Qwen3-TTS 生成第 {index}/{len(chunks)} 段，{len(chunk)} 字...")
        wavs, sr = _QWEN_MODEL.generate_voice_clone(
            text=chunk,
            language=config.language,
            voice_clone_prompt=_QWEN_PROMPT_CACHE[prompt_key],
        )
        sample_rate = sr
        generated.append(wavs[0])
        done_chars += len(chunk)
        elapsed = time.time() - start
        remain = elapsed / done_chars * (total_chars - done_chars)
        log(f"第 {index}/{len(chunks)} 段完成（已用 {elapsed / 60:.1f} 分钟，预计还需 {remain / 60:.0f} 分钟）")

    if sample_rate is None:
        raise RuntimeError("Qwen3-TTS 未生成音频")
    return generated, sample_rate


def _ensure_sox_path() -> None:
    if _which("sox"):
        return
    candidates = [
        Path.home()
        / "AppData"
        / "Local"
        / "Microsoft"
        / "WinGet"
        / "Packages"
        / "ChrisBagwell.SoX_Microsoft.Winget.Source_8wekyb3d8bbwe"
        / "sox-14.4.2",
    ]
    for directory in candidates:
        if (directory / "sox.exe").exists():
            os.environ["PATH"] = f"{directory}{os.pathsep}{os.environ.get('PATH', '')}"
            return


def _which(command: str) -> str | None:
    suffixes = [".exe", ""] if os.name == "nt" else [""]
    for directory in os.environ.get("PATH", "").split(os.pathsep):
        if not directory:
            continue
        for suffix in suffixes:
            path = Path(directory) / f"{command}{suffix}"
            try:
                if path.exists():
                    return str(path)
            except OSError:
                # PATH 里可能有损坏/不可访问的条目（如失效的重定向路径），跳过
                continue
    return None

def _write_wav(path: Path, wav, sample_rate: int) -> None:
    try:
        import soundfile as sf
    except ImportError as exc:
        raise RuntimeError("缺少 soundfile 依赖。请安装：pip install soundfile") from exc
    sf.write(path, wav, sample_rate)


def _find_task_ref_audio(task_dir: Path) -> Path | None:
    for name in ("voice.wav", "ref.wav", "qwen_ref.wav", "voice.mp3", "ref.mp3", "qwen_ref.mp3"):
        path = task_dir / name
        if path.exists():
            return path
    return None


def _prepare_task_reference(task_dir: Path) -> Path | None:
    video = _find_video(task_dir)
    transcript = _read_transcript_reference(task_dir)
    if not video or not transcript:
        return None

    ref_audio = task_dir / "qwen_ref.wav"
    ref_text = task_dir / "qwen_ref.txt"
    if not ref_audio.exists():
        result = subprocess.run(
            [
                "ffmpeg",
                "-y",
                "-i",
                str(video),
                "-t",
                "15",
                "-vn",
                "-ac",
                "1",
                "-ar",
                "16000",
                str(ref_audio),
            ],
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
        )
        if result.returncode != 0:
            raise RuntimeError(f"提取 Qwen 参考音频失败：\n{result.stderr[-2000:]}")
    if not ref_text.exists():
        ref_text.write_text(transcript, encoding="utf-8")
    return ref_audio


def _find_video(task_dir: Path) -> Path | None:
    for ext in ("mp4", "webm", "mkv", "m4v", "mov"):
        path = task_dir / f"video.{ext}"
        if path.exists():
            return path
    return None


def _read_transcript_reference(task_dir: Path) -> str:
    transcript_path = task_dir / "transcript.json"
    if not transcript_path.exists():
        return ""
    data = json.loads(transcript_path.read_text(encoding="utf-8"))
    texts = []
    for segment in data.get("segments", []):
        if segment.get("start", 0) >= 15:
            break
        text = str(segment.get("text", "")).strip()
        if text:
            texts.append(text)
    return "".join(texts).strip() or str(data.get("full_text", "")).strip()[:80]


def _read_task_ref_text(task_dir: Path) -> str:
    for name in ("qwen_ref.txt", "voice.txt", "ref.txt"):
        path = task_dir / name
        if path.exists():
            return path.read_text(encoding="utf-8").strip()
    return ""


def _split_text(text: str, max_chars: int) -> list[str]:
    normalized = re.sub(r"\s+", " ", text).strip()
    if not normalized:
        raise ValueError("TTS 文本为空")

    parts = [p for p in re.split(r"(?<=[。！？!?；;])", normalized) if p]
    chunks: list[str] = []
    current = ""
    for part in parts:
        if current and len(current) + len(part) > max_chars:
            chunks.append(current.strip())
            current = ""
        if len(part) > max_chars:
            chunks.extend(part[i : i + max_chars].strip() for i in range(0, len(part), max_chars))
        else:
            current += part
    if current.strip():
        chunks.append(current.strip())
    return [chunk for chunk in chunks if chunk]


def _estimate_word_timings(text: str, duration: float) -> list[dict]:
    tokens = [char for char in text if not char.isspace()]
    if not tokens:
        return []
    unit = duration / len(tokens)
    return [
        {
            "text": token,
            "start": round(index * unit, 3),
            "end": round((index + 1) * unit, 3),
        }
        for index, token in enumerate(tokens)
    ]


def _words_from_segments(segments: list[dict]) -> list[dict]:
    """按每段真实音频时长分段对齐，段内再按字数均匀分配。

    比全局均匀估算 (_estimate_word_timings) 准得多：每段边界用真实起止时间，
    误差被锁在单段(≤max_chunk_chars字)内，不会跨段累积——根治"字幕落后于语音"。
    """
    out: list[dict] = []
    for seg in segments:
        tokens = [c for c in str(seg.get("text", "")) if not c.isspace()]
        if not tokens:
            continue
        start = float(seg.get("start", 0.0))
        end = float(seg.get("end", start))
        unit = (end - start) / len(tokens)
        for i, ch in enumerate(tokens):
            out.append({
                "text": ch,
                "start": round(start + i * unit, 3),
                "end": round(start + (i + 1) * unit, 3),
            })
    return out


def _asr_raw_timing(mp3_path: Path, log: Callable[[str], None]) -> list[dict]:
    """用 faster-whisper tiny 获取 TTS 音频词级时间戳（仅时间，不含 ASR 识别文字）。

    返回 [{"start": float, "end": float}, ...] — 只有时间区间，无 text 字段。
    段内均匀分配无法感知逗号后的自然停顿（实测 CosyVoice 逗号停顿约 500-900ms），
    导致字幕超前。tiny 模型在 CPU 上约 0.1-0.2 倍实时，8 分钟音频约 1-2 分钟。
    """
    try:
        from faster_whisper import WhisperModel
    except ImportError:
        log("（faster_whisper 未安装，降级为分段均匀分配）")
        return []
    log("对 TTS 音频做词级时间戳对齐（whisper-tiny，约 1-2 分钟）...")
    model = WhisperModel("tiny", device="cpu", compute_type="int8")
    segs_iter, _ = model.transcribe(
        str(mp3_path), language="zh", word_timestamps=True, beam_size=1,
    )
    slots = []
    for seg in segs_iter:
        for w in (seg.words or []):
            if str(w.word).strip():
                slots.append({"start": round(w.start, 3), "end": round(w.end, 3)})
    log(f"ASR 时间戳获取完成，共 {len(slots)} 个时间块")
    return slots


def _align_original_text_to_asr(segments: list[dict], asr_slots: list[dict]) -> list[dict]:
    """将原稿字符逐字映射到 ASR 词级时间槽（只用 ASR 的时间，字幕文字始终用原稿）。

    解决两个字幕错误：
    1. ASR 把普通话读音识别为繁体字（如"畜生"→"畜生"或繁体变体）
    2. ASR 把方言/专名识别错（如"畜生"→"出处身"）
    原稿文字来自 tts_segments.json，经用户确认，必然是简体且正确。
    """
    result = []
    for seg in segments:
        seg_start = float(seg.get("start", 0))
        seg_end = float(seg.get("end", seg_start))
        orig_chars = [c for c in str(seg.get("text", "")) if not c.isspace()]
        if not orig_chars:
            continue

        # 找该段时间范围内的 ASR 时间槽（允许 0.5s 边界误差）
        seg_slots = [w for w in asr_slots
                     if w["start"] < seg_end + 0.5 and w["end"] > seg_start - 0.5]

        if not seg_slots:
            # 无 ASR 覆盖 → 退回段内均匀分配
            unit = (seg_end - seg_start) / len(orig_chars)
            for i, ch in enumerate(orig_chars):
                result.append({
                    "text": ch,
                    "start": round(seg_start + i * unit, 3),
                    "end": round(seg_start + (i + 1) * unit, 3),
                })
            continue

        # 按 ASR 槽数比例将原稿字符切块，每块映射到对应槽的时间区间
        n, m = len(orig_chars), len(seg_slots)
        for wi, slot in enumerate(seg_slots):
            char_from = round(wi * n / m)
            char_to = round((wi + 1) * n / m)
            chars = orig_chars[char_from:char_to]
            if not chars:
                continue
            t0 = max(slot["start"], seg_start)
            t1 = min(slot["end"], seg_end)
            if t1 <= t0:
                t1 = t0 + 0.05
            unit = (t1 - t0) / len(chars)
            for j, ch in enumerate(chars):
                result.append({
                    "text": ch,
                    "start": round(t0 + j * unit, 3),
                    "end": round(t0 + (j + 1) * unit, 3),
                })
    return result


def _asr_word_timestamps(mp3_path: Path, segments: list[dict],
                          log: Callable[[str], None]) -> list[dict]:
    """对 TTS 音频做词级时间戳对齐，字幕文字用原稿（不含 ASR 识别结果）。

    同时修复：(1) ASR 繁体字问题；(2) ASR 识别错误（如"畜生"→"出处身"）。
    内部调用 _asr_raw_timing 获取时间槽，再用 _align_original_text_to_asr 填入原稿字符。
    """
    asr_slots = _asr_raw_timing(mp3_path, log)
    if len(asr_slots) < 10:
        return _words_from_segments(segments)
    return _align_original_text_to_asr(segments, asr_slots)


def _convert_audio(input_path: Path, output_path: Path) -> None:
    result = subprocess.run(
        [
            "ffmpeg",
            "-y",
            "-i",
            str(input_path),
            "-codec:a",
            "libmp3lame",
            "-q:a",
            "2",
            str(output_path),
        ],
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    if result.returncode != 0:
        raise RuntimeError(f"ffmpeg 转 MP3 失败：\n{result.stderr[-2000:]}")


def _audio_duration(audio_path: Path) -> float:
    result = subprocess.run(
        [
            "ffprobe",
            "-v",
            "error",
            "-show_entries",
            "format=duration",
            "-of",
            "default=noprint_wrappers=1:nokey=1",
            str(audio_path),
        ],
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        raise RuntimeError(f"ffprobe 失败：{result.stderr}")
    return float(result.stdout.strip())



