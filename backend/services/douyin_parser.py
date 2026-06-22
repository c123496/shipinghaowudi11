"""抖音视频解析下载：经登录态专用浏览器取 play_addr 与元数据后直接下载。

抖音 web 反爬严重，yt-dlp 提取器失效，因此走 CDP（见 _browser.py）。
专用 Chrome 需以 --remote-debugging-port=9222 启动并登录抖音。
"""
import json
import re
import urllib.request
from pathlib import Path
from typing import Callable

from . import _browser

_UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
       "(KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36")
_URL_RE = re.compile(r"https?://[^\s]+")


def parse_and_download(url: str, task_dir: Path, log: Callable[[str], None]) -> dict:
    clean = _extract_url(url)
    log(f"解析链接：{clean}")

    if not _browser.is_running():
        raise RuntimeError(
            "专用 Chrome 未运行。请用 --remote-debugging-port=9222 启动 Chrome 并登录抖音。"
        )

    aweme = _browser.fetch_aweme_detail(clean, log)
    meta = _build_meta(aweme, clean)
    (task_dir / "meta.json").write_text(
        json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    log(f"获取信息：《{meta['title'][:30]}》 作者 {meta['uploader']} 时长 {meta['duration']}s")

    cookie = _browser.cookie_header()
    _download_video(aweme, task_dir, cookie, log)
    _download_cover(aweme, task_dir, cookie, log)
    return meta


def _extract_url(text: str) -> str:
    m = _URL_RE.search(text)
    if not m:
        raise ValueError("分享文本中未找到有效链接")
    return m.group(0).rstrip("，。、）)】")


def _build_meta(aweme: dict, url: str) -> dict:
    video = aweme.get("video", {})
    stats = aweme.get("statistics", {})
    return {
        "title": aweme.get("desc", "") or "抖音视频",
        "uploader": aweme.get("author", {}).get("nickname", ""),
        "view_count": stats.get("play_count", 0),
        "like_count": stats.get("digg_count", 0),
        "duration": round(video.get("duration", 0) / 1000),
        "description": aweme.get("desc", "")[:500],
        "webpage_url": url,
    }


def _play_urls(aweme: dict) -> list[str]:
    video = aweme.get("video", {})
    urls = list(video.get("play_addr", {}).get("url_list", []))
    for br in video.get("bit_rate", []):
        urls += br.get("play_addr", {}).get("url_list", [])
    # 优先 progressive，排除 dash 分片地址
    progressive = [u for u in urls if "/play/dash" not in u]
    return list(dict.fromkeys(progressive or urls))


def _download_video(aweme: dict, task_dir: Path, cookie: str, log: Callable[[str], None]) -> None:
    last_err: Exception | None = None
    for u in _play_urls(aweme):
        try:
            _download(u, task_dir / "video.mp4", cookie, log, "视频")
            return
        except Exception as exc:  # noqa: BLE001 - 逐个候选地址重试
            last_err = exc
    raise RuntimeError(f"视频下载失败（已试所有 play_addr）：{last_err}")


def _download_cover(aweme: dict, task_dir: Path, cookie: str, log: Callable[[str], None]) -> None:
    video = aweme.get("video", {})
    urls = (video.get("cover") or video.get("origin_cover") or {}).get("url_list", [])
    for u in urls:
        try:
            _download(u, task_dir / "cover.jpg", cookie, log, "封面")
            return
        except Exception:  # noqa: BLE001
            continue
    log("未获取到封面，compose 将用纯色背景兜底")


def _download(url: str, dst: Path, cookie: str, log: Callable[[str], None], label: str) -> None:
    req = urllib.request.Request(
        url, headers={"User-Agent": _UA, "Referer": "https://www.douyin.com/", "Cookie": cookie}
    )
    with urllib.request.urlopen(req, timeout=120) as resp, open(dst, "wb") as f:
        while chunk := resp.read(1 << 20):
            f.write(chunk)
    log(f"{label}下载完成：{dst.name}（{dst.stat().st_size / 1_048_576:.1f} MB）")
