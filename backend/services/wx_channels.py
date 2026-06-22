"""视频号视频解析下载：元宝解析 → finder-preview get_feed_info → 直接下载预览版 mp4。

finder-preview 接口返回的 videoUrl 是未加密的可播放 mp4（网页预览版），
直接下载即可，无需 decodeKey 解密。下载产物 video.mp4 之后走 transcribe 转出文案。
依赖专用 Chrome（CDP 9222）且已登录元宝 yuanbao.tencent.com。
"""
import json
import re
import urllib.request
from pathlib import Path
from typing import Callable

from . import _wx_cdp

_UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
       "(KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36")
_HDR = {"User-Agent": _UA, "Referer": "https://channels.weixin.qq.com/"}
_URL_RE = re.compile(r"https?://(?:weixin\.qq\.com/sph/\w+|channels\.weixin\.qq\.com/\S+)")


def is_wx_channels_url(text: str) -> bool:
    return bool(_URL_RE.search(text))


def parse_and_download(share_text: str, task_dir: Path, log: Callable[[str], None]) -> dict:
    url = _extract_url(share_text)
    log(f"视频号链接：{url}")

    # 不再前置检查 is_yuanbao_ready()——它吞掉所有异常导致误报。
    # yuanbao_parse() 自身会调 _find_tab()，找不到时抛出清晰的错误。
    log("元宝解析分享链接...")
    parsed = _wx_cdp.yuanbao_parse(url)
    playable = parsed.get("playable_url") or ""
    if not playable:
        raise RuntimeError("元宝未解析出视频（链接失效/受限，或分享文案不完整）")

    log("获取视频详情...")
    feed = _wx_cdp.feed_info(playable, log)
    info = _feed_info(feed)
    author = _author(feed)

    meta = _build_meta(info, author, url)
    (task_dir / "meta.json").write_text(
        json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    log(f"《{meta['title'][:30]}》 作者 {meta['uploader']}")

    _download(_video_url(info), task_dir / "video.mp4", log, "视频")
    cover = info.get("coverUrl")
    if cover:
        try:
            _download(cover, task_dir / "cover.jpg", log, "封面")
        except Exception:  # noqa: BLE001
            log("封面下载失败，compose 用纯色背景兜底")
    return meta


def _extract_url(text: str) -> str:
    m = _URL_RE.search(text)
    if not m:
        raise ValueError("未找到视频号链接（应包含 weixin.qq.com/sph/...）")
    return m.group(0)


def _feed_info(feed: dict) -> dict:
    info = (feed.get("data") or {}).get("feedInfo")
    if not info:
        raise RuntimeError(f"feed 结构异常：{json.dumps(feed, ensure_ascii=False)[:200]}")
    return info


def _author(feed: dict) -> dict:
    return (feed.get("data") or {}).get("authorInfo") or {}


def _video_url(info: dict) -> str:
    url = (info.get("h264VideoInfo") or {}).get("videoUrl") \
        or (info.get("h265VideoInfo") or {}).get("videoUrl") \
        or info.get("videoUrl")
    if not url:
        raise RuntimeError("feedInfo 中没有 videoUrl")
    return url


def _build_meta(info: dict, author: dict, url: str) -> dict:
    desc = info.get("description", "") or "视频号视频"
    return {
        "title": desc.split("\n")[0][:80] or "视频号视频",
        "uploader": author.get("nickname", ""),
        "view_count": 0,
        "like_count": _num(info.get("likeCountFmt")),
        "duration": 0,
        "description": desc[:500],
        "webpage_url": url,
    }


def _num(s) -> int:
    """把 "4.3万" / "1.2亿" / "948" 这类格式化计数转成整数。"""
    text = str(s)
    mult = 10000 if "万" in text else (100_000_000 if "亿" in text else 1)
    m = re.search(r"[\d.]+", text)
    return int(float(m.group()) * mult) if m else 0


def _download(url: str, dst: Path, log: Callable[[str], None], label: str) -> None:
    req = urllib.request.Request(url, headers=_HDR)
    with urllib.request.urlopen(req, timeout=300) as resp, open(dst, "wb") as f:
        total = 0
        while chunk := resp.read(1 << 20):
            f.write(chunk)
            total += len(chunk)
    log(f"{label}下载完成：{dst.name}（{total / 1_048_576:.1f} MB）")
