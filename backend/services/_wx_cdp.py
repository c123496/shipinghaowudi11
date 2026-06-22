"""经专用 Chrome（CDP）完成视频号链接解析：

1. 在登录态的元宝(yuanbao.tencent.com)页面上下文调用解析接口，拿到 playable_url（含 token+eid）；
2. 打开 playable_url（channels finder-preview 页），捕获其 get_feed_info 响应，得到含 decodeKey 的 feed。
"""
import asyncio
import base64
import json
import os
import shutil
import subprocess
import time
from pathlib import Path
from urllib.parse import quote
import urllib.request

import websockets

CDP = "http://127.0.0.1:9222"
YUANBAO_URL = "https://yuanbao.tencent.com"
_FEED_API = "/finder-preview/api/feed/get_feed_info"


def is_yuanbao_ready() -> bool:
    """专用 Chrome 在运行、且有已登录元宝的标签页。

    仅供 preflight 健康检查使用。解析流程不再调用此函数，
    而是直接调 yuanbao_parse() 让 _find_tab() 给出精确错误。
    """
    try:
        return _find_tab("yuanbao.tencent.com") is not None
    except Exception:
        return False


def _cdp_diagnosis() -> str:
    """返回 CDP 连接状态的诊断文字，用于错误提示。"""
    try:
        pages = _pages()
    except Exception as exc:
        return f"CDP 9222 连接失败（{type(exc).__name__}: {exc}），请确认专用 Chrome 已启动"
    yuanbao_tabs = [p for p in pages
                    if p.get("type") == "page" and "yuanbao.tencent.com" in p.get("url", "")]
    if not yuanbao_tabs:
        total = sum(1 for p in pages if p.get("type") == "page")
        return f"CDP 正常（{total} 个标签页），但未找到 yuanbao.tencent.com 页面，请登录元宝"
    return f"元宝就绪（{len(yuanbao_tabs)} 个标签页）"


def yuanbao_parse(share_url: str) -> dict:
    """返回元宝解析结果 data（含 wx_export_id、playable_url）。需先登录元宝。"""
    tab = _ensure_yuanbao_tab()
    if not tab:
        raise RuntimeError(f"元宝解析失败：{_cdp_diagnosis()}")
    js = (
        "(async()=>{"
        "const m=document.cookie.match(/hy_user=([^;]+)/);const uid=m?m[1]:'';"
        "const resp=await fetch('/api/weixin/get_parse_result',{method:'POST',"
        "headers:{'content-type':'application/json','t-userid':uid,'x-id':uid,"
        "'x-source':'web','x-requested-with':'XMLHttpRequest'},"
        "body:JSON.stringify({type:'video_channel_url',url:" + json.dumps(share_url) + ",scene:1})});"
        "return await resp.text();})()"
    )
    try:
        # 元宝解析接口实测可达 35s+，40s 默认超时太临界，放宽到 90s
        raw = asyncio.run(_eval(tab["webSocketDebuggerUrl"], js, timeout=90))
    except (TimeoutError, asyncio.TimeoutError):
        # 元宝标签页被 Chrome 休眠/丢弃时，脚本注入会挂起到超时。
        # 自愈：关掉僵尸页，开全新元宝页（登录态在 profile 里不丢）重试一次。
        _close_tab(tab.get("id", ""))
        fresh = _ensure_yuanbao_tab()
        if not fresh:
            raise RuntimeError(f"元宝解析失败：{_cdp_diagnosis()}")
        time.sleep(5)  # 等元宝页面加载出登录态
        try:
            raw = asyncio.run(_eval(fresh["webSocketDebuggerUrl"], js, timeout=90))
        except (TimeoutError, asyncio.TimeoutError) as exc:
            raise RuntimeError(
                "元宝解析超时：页面对脚本无响应（已自动重开元宝页重试仍失败）。"
                "请到专用 Chrome 检查元宝是否还在登录状态。"
            ) from exc
    obj = json.loads(raw)
    if obj.get("code") not in (0, None) and obj.get("msg") != "success":
        raise RuntimeError(f"元宝解析失败：{raw[:200]}")
    return obj.get("data") or {}


def feed_info(playable_url: str, log) -> dict:
    """打开 playable_url 并捕获 get_feed_info 响应，返回其 JSON。"""
    return asyncio.run(_capture_feed(playable_url, log))


# ---- CDP 基础 ----

def _pages() -> list[dict]:
    return _open_json(CDP + "/json", timeout=5)


def _ensure_yuanbao_tab() -> dict | None:
    try:
        tab = _find_tab("yuanbao.tencent.com")
    except Exception:
        tab = None
    if tab:
        return tab

    try:
        _open_tab(YUANBAO_URL)
    except Exception:
        _launch_debug_chrome(YUANBAO_URL)

    for _ in range(30):
        try:
            tab = _find_tab("yuanbao.tencent.com")
        except Exception:
            tab = None
        if tab:
            return tab
        time.sleep(0.5)
    return None


def _find_tab(substr: str) -> dict | None:
    """查找包含指定子串的标签页。带一次重试，扛住 CDP 瞬断。"""
    for attempt in range(2):
        try:
            for p in _pages():
                if p.get("type") == "page" and substr in p.get("url", ""):
                    return p
            return None
        except Exception:
            if attempt == 0:
                time.sleep(0.5)
            else:
                raise


def _open_tab(url: str) -> dict:
    req = urllib.request.Request(CDP + "/json/new?" + quote(url, safe=":/?.=&%#"), method="PUT")
    return _open_json(req, timeout=10)


def _close_tab(tab_id: str) -> None:
    """关闭标签页（尽力而为）。/json/close 返回纯文本，不能走 _open_json。"""
    if not tab_id:
        return
    try:
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        req = urllib.request.Request(CDP + f"/json/close/{tab_id}", method="PUT")
        opener.open(req, timeout=5).read()
    except Exception:  # noqa: BLE001
        pass


def _launch_debug_chrome(url: str) -> None:
    chrome = _find_chrome_exe()
    if not chrome:
        raise RuntimeError("未找到 Chrome，无法自动打开元宝解析页")

    profile = Path(__file__).resolve().parents[2] / ".chrome-profile"
    profile.mkdir(parents=True, exist_ok=True)
    subprocess.Popen(
        [
            chrome,
            "--remote-debugging-port=9222",
            f"--user-data-dir={profile}",
            "--disable-background-timer-throttling",
            "--disable-backgrounding-occluded-windows",
            "--disable-renderer-backgrounding",
            "--disable-features=CalculateNativeWinOcclusion,TabHoverCardImages",
            url,
        ],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        start_new_session=True,
    )

    end = time.time() + 20
    while time.time() < end:
        try:
            _pages()
            return
        except Exception:
            time.sleep(0.5)


def _find_chrome_exe() -> str | None:
    for name in ("chrome", "chrome.exe"):
        found = shutil.which(name)
        if found:
            return found
    candidates = [
        os.environ.get("CHROME_PATH"),
        r"C:\Program Files\Google\Chrome\Application\chrome.exe",
        r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
        str(Path.home() / r"AppData\Local\Google\Chrome\Application\chrome.exe"),
    ]
    for candidate in candidates:
        if candidate and Path(candidate).exists():
            return candidate
    return None


def _open_json(url_or_request, timeout: int) -> dict | list[dict]:
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    with opener.open(url_or_request, timeout=timeout) as response:
        return json.load(response)


async def _eval(ws_url: str, expression: str, timeout: float = 40) -> str:
    async with websockets.connect(ws_url, max_size=None) as ws:
        await ws.send(json.dumps({"id": 1, "method": "Runtime.enable"}))
        await ws.send(json.dumps({
            "id": 2, "method": "Runtime.evaluate",
            "params": {"expression": expression, "awaitPromise": True, "returnByValue": True},
        }))
        while True:
            r = json.loads(await asyncio.wait_for(ws.recv(), timeout))
            if r.get("id") == 2:
                if "error" in r:
                    raise RuntimeError(f"CDP 错误：{r['error']}")
                res = r.get("result", {})
                if res.get("exceptionDetails"):
                    raise RuntimeError(f"页面执行异常：{res['exceptionDetails'].get('text')}")
                return res.get("result", {}).get("value")


async def _capture_feed(playable_url: str, log) -> dict:
    # 先开空白页并连上监听，再导航，避免请求早于 Network.enable 的竞态
    tab = _open_tab("about:blank")
    try:
        return await _capture_feed_in_tab(tab, playable_url, log)
    finally:
        # 用完即关：标签页泄漏会让 Chrome 把后台元宝页休眠，导致下次解析挂死
        _close_tab(tab.get("id", ""))


async def _capture_feed_in_tab(tab: dict, playable_url: str, log) -> dict:
    async with websockets.connect(tab["webSocketDebuggerUrl"], max_size=None) as ws:
        n = 0
        async def call(m, p=None):
            nonlocal n; n += 1
            await ws.send(json.dumps({"id": n, "method": m, "params": p or {}}))
            return n
        await call("Network.enable")
        await call("Page.enable")
        await call("Page.navigate", {"url": playable_url})
        log("浏览器打开播放页，等待 get_feed_info ...")

        feed_rid = None
        end = time.time() + 30
        while time.time() < end:
            try:
                msg = json.loads(await asyncio.wait_for(ws.recv(), timeout=end - time.time()))
            except (asyncio.TimeoutError, Exception):
                break
            method = msg.get("method")
            if method == "Network.responseReceived" and _FEED_API in msg["params"]["response"]["url"]:
                feed_rid = msg["params"]["requestId"]
            elif method == "Network.loadingFinished" and msg["params"]["requestId"] == feed_rid:
                break

        if feed_rid is None:
            raise RuntimeError("未捕获到 get_feed_info（播放页可能仍无权播放）")
        want = await call("Network.getResponseBody", {"requestId": feed_rid})
        while True:
            msg = json.loads(await ws.recv())
            if msg.get("id") == want:
                res = msg.get("result")
                if not res:
                    raise RuntimeError(f"取 feed 响应体失败：{msg.get('error')}")
                body = res.get("body", "")
                if res.get("base64Encoded"):
                    body = base64.b64decode(body).decode("utf-8", "replace")
                return json.loads(body)
