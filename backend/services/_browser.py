"""经 CDP 操控专用 Chrome（--remote-debugging-port=9222，已登录抖音）。

抖音 web 反爬严重，yt-dlp 提取器拿到空白页。改由登录态浏览器打开视频页，
从其 aweme 详情接口取 play_addr 与元数据，再带 cookies 直接下载。
"""
import asyncio
import base64
import json
import re
import time
import urllib.request

import websockets

CDP = "http://localhost:9222"
_DETAIL_API = "/aweme/v1/web/aweme/detail"
_UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
       "(KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36")


def is_running() -> bool:
    try:
        _targets()
        return True
    except Exception:
        return False


def _resolve_short_url(url: str) -> str:
    """解析 v.douyin.com 短链，拿到跳转后的真实 URL。

    短链会触发 HTTP 302 → 浏览器 Page.navigate 时二次跳转，
    跳转过程中旧页面的网络请求资源会被浏览器回收，
    导致 Network.getResponseBody 返回 'No resource'。
    预先解析掉短链即可规避。
    """
    if "v.douyin.com" not in url:
        return url
    try:
        req = urllib.request.Request(url, method="HEAD", headers={"User-Agent": _UA})
        resp = urllib.request.urlopen(req, timeout=10)
        return resp.url
    except Exception:
        return url


def fetch_aweme_detail(video_url: str, log) -> dict:
    """打开视频页并返回抖音 aweme_detail 字典。"""
    return asyncio.run(_fetch_detail(video_url, log))


def cookie_header(domain_filter: str = "douyin") -> str:
    """把浏览器里该域的 cookies 拼成 HTTP Cookie 头。"""
    cookies = asyncio.run(_all_cookies())
    return "; ".join(f"{c['name']}={c['value']}" for c in cookies if domain_filter in c["domain"])


# ---- 内部：CDP 原语 ----

def _targets() -> list[dict]:
    return json.load(urllib.request.urlopen(CDP + "/json", timeout=5))


def _page_ws() -> str:
    for p in _targets():
        if p.get("type") == "page":
            return p["webSocketDebuggerUrl"]
    raise RuntimeError("专用浏览器没有可用页面")


def _browser_ws() -> str:
    info = json.load(urllib.request.urlopen(CDP + "/json/version", timeout=5))
    return info["webSocketDebuggerUrl"]


async def _fetch_detail(video_url: str, log) -> dict:
    # ① 预解析短链，避免 HTTP 302 导致浏览器回收网络请求资源
    actual_url = _resolve_short_url(video_url)
    if actual_url != video_url:
        log(f"短链解析：{video_url} → {actual_url}")

    # ② 最多尝试 2 轮（首次 + 重载重试）
    for attempt in range(1, 3):
        async with websockets.connect(_page_ws(), max_size=None) as ws:
            send = _sender(ws)
            await send("Network.enable")
            await send("Page.enable")

            if attempt == 1:
                await send("Page.navigate", {"url": actual_url})
                log(f"浏览器打开视频页：{actual_url}")
            else:
                log("重载页面重试…")
                await send("Page.reload")

            rid = await _wait_for_detail(ws, timeout=25)
            if rid is None:
                if attempt == 1:
                    log("首次未捕获到详情接口，尝试重载…")
                    continue
                raise RuntimeError("未捕获到抖音视频详情接口（登录是否失效/被风控？）")

            try:
                body = await _response_body(ws, send, rid)
            except RuntimeError as e:
                if attempt == 1:
                    log(f"取响应体失败（{e}），尝试重载重试…")
                    continue
                raise

            data = json.loads(body)
            aweme = data.get("aweme_detail") or (data.get("aweme_list") or [{}])[0]
            if not aweme.get("video"):
                raise RuntimeError("详情接口未返回视频信息")
            return aweme

    raise RuntimeError("fetch_aweme_detail: 不应到达此处")


def _sender(ws):
    counter = {"n": 0}

    async def send(method: str, params: dict | None = None) -> int:
        counter["n"] += 1
        await ws.send(json.dumps({"id": counter["n"], "method": method, "params": params or {}}))
        return counter["n"]

    return send


async def _wait_for_detail(ws, timeout: float) -> str | None:
    """等到详情接口的响应体加载完成（loadingFinished）再返回其 requestId。"""
    end = time.time() + timeout
    detail_rid: str | None = None
    while time.time() < end:
        try:
            msg = json.loads(await asyncio.wait_for(ws.recv(), timeout=end - time.time()))
        except (asyncio.TimeoutError, Exception):
            return None
        method = msg.get("method")
        if method == "Network.responseReceived" and _DETAIL_API in msg["params"]["response"]["url"]:
            detail_rid = msg["params"]["requestId"]
        elif method == "Network.loadingFinished" and msg["params"]["requestId"] == detail_rid:
            return detail_rid
    return None


async def _response_body(ws, send, rid: str) -> str:
    want = await send("Network.getResponseBody", {"requestId": rid})
    while True:
        msg = json.loads(await ws.recv())
        if msg.get("id") == want:
            res = msg.get("result")
            if not res:
                raise RuntimeError(f"取响应体失败：{msg.get('error')}")
            body = res.get("body", "")
            if res.get("base64Encoded"):
                return base64.b64decode(body).decode("utf-8", "replace")
            return body


async def _all_cookies() -> list[dict]:
    async with websockets.connect(_browser_ws(), max_size=None) as ws:
        await ws.send(json.dumps({"id": 1, "method": "Storage.getCookies"}))
        while True:
            resp = json.loads(await ws.recv())
            if resp.get("id") == 1:
                return resp["result"]["cookies"]
