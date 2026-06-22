"""EvoLink gpt-image-2 生图客户端（异步任务：创建 → 轮询 → 下载）。"""
import json
import os
import time
import urllib.error
import urllib.request
from typing import Callable

_BASE = "https://api.evolink.ai/v1"
_MODEL = "gpt-image-2"
# 下载图片用浏览器头（files.evolink.ai 不接受 Bearer）
_DL_HDR = {"User-Agent": "Mozilla/5.0", "Referer": "https://evolink.ai/"}


def _key() -> str:
    key = os.environ.get("EVOLINK_API_KEY", "")
    if not key:
        raise EnvironmentError("缺少 EVOLINK_API_KEY，请在 .env 文件中设置")
    return key


def _fetch(req: urllib.request.Request, timeout: float, retries: int = 4) -> bytes:
    """带退避重试的请求。海外接口走代理，SSL 握手瞬断常见，单次失败不应打挂整步。"""
    last: Exception | None = None
    for attempt in range(retries):
        try:
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return r.read()
        except urllib.error.HTTPError as exc:
            if exc.code < 500:
                raise  # 4xx 是业务错误（如 402 余额不足），重试无意义
            last = exc
        except (urllib.error.URLError, TimeoutError, OSError) as exc:
            last = exc
        time.sleep(2.0 * (attempt + 1))
    raise RuntimeError(f"EvoLink 请求重试 {retries} 次仍失败：{last}")


def _post(path: str, body: dict) -> dict:
    req = urllib.request.Request(
        _BASE + path, data=json.dumps(body).encode(), method="POST",
        headers={"Authorization": "Bearer " + _key(), "Content-Type": "application/json"},
    )
    return json.loads(_fetch(req, timeout=60))


def _get(path: str) -> dict:
    req = urllib.request.Request(_BASE + path, headers={"Authorization": "Bearer " + _key()})
    return json.loads(_fetch(req, timeout=30))


def generate_image(prompt: str, size: str, log: Callable[[str], None],
                   image_urls: list[str] | None = None) -> bytes:
    """提交生图任务、轮询直到完成、下载并返回图片字节。"""
    body = {"model": _MODEL, "prompt": prompt, "size": size, "n": 1}
    # 画质档位：high/medium/low/auto。默认 medium——九宫格裁出的每格最终只有
    # ~340px 高再塞进竖屏视频，high 的精细度看不出来，medium 单价约便宜 3-4 倍。
    quality = os.environ.get("EVOLINK_IMAGE_QUALITY", "medium").strip().lower()
    if quality and quality != "auto":
        body["quality"] = quality
    if image_urls:
        body["image_urls"] = image_urls
    task = _post("/images/generations", body)
    tid = task["id"]
    estimated = task.get("task_info", {}).get("estimated_time")
    log(f"生图任务已提交（{tid}，预计 {estimated or '?'}s）")

    # 轮询上限跟随平台预估时间放宽（预估 474s 时旧上限 420s 必然误报超时）
    try:
        poll_timeout = max(420.0, float(estimated) * 1.5)
    except (TypeError, ValueError):
        poll_timeout = 420.0
    url = _poll(tid, log, timeout=poll_timeout)
    log("下载生成图片...")
    req = urllib.request.Request(url, headers=_DL_HDR)
    return _fetch(req, timeout=120)


def _poll(task_id: str, log: Callable[[str], None], timeout: float = 420) -> str:
    end = time.time() + timeout
    last = -1
    while time.time() < end:
        d = _get(f"/tasks/{task_id}")
        status = d.get("status")
        prog = d.get("progress", 0)
        if prog != last:
            log(f"生图中… {prog}%")
            last = prog
        if status in ("completed", "succeeded", "success"):
            results = d.get("results") or [r.get("url") for r in d.get("result_data", [])]
            if not results:
                raise RuntimeError("生图完成但无结果地址")
            return results[0]
        if status in ("failed", "error"):
            raise RuntimeError(f"生图失败：{json.dumps(d, ensure_ascii=False)[:200]}")
        time.sleep(8)
    raise RuntimeError("生图超时")
