"""抖音同类爆款发现：经登录态专用 Chrome（CDP 9222）搜索并筛选。

筛选链路：搜索关键词 → 点赞 ≥ min_likes 的候选 → 逐条打开视频页抓评论，
评论区有人「求书名」即判定符合（qualified）。同时标记 AI 生成标识与历史题材，
供结果页排序展示。声音相似度无法自动判断，结果附原视频链接供试听。
"""
import asyncio
import json
import re
import time
import urllib.parse

import websockets

from . import _browser

# 视频 Tab 走 search/item，综合 Tab 走 general/search，两者都认
_SEARCH_APIS = ("/aweme/v1/web/search/item/", "/aweme/v1/web/general/search/")
_COMMENT_APIS = ("/aweme/v1/web/comment/list/",)
_DETAIL_APIS = ("/aweme/v1/web/aweme/detail/",)

BOOK_ASK_RE = re.compile(
    r"书名|什么书|哪本书|哪一本|求书|啥书|书叫|叫什么书|书的名字|这是什么书"
    r"|名字叫|叫什么名字|求链接|有没有链接|链接呢|哪里买|在哪买|怎么买|想买这本|哪里有卖"
    r"|哪个版本|什么版本|哪一版|什么出版社|哪个出版社|全套多少|买哪种|买哪个")
HISTORY_RE = re.compile(r"历史|王朝|皇帝|三国|春秋|战国|秦|汉|唐|宋|元|明|清|史记|资治通鉴|古人|帝王|权谋")
AI_HINT_RE = re.compile(r"AI|ai生成|数字人|虚拟主播")


def discover(keyword: str, min_likes: int, max_check: int, log,
             stop_after_hits: int = 3) -> list[dict]:
    """搜索 → 过滤 → 逐条验评论。返回所有已检查项（含 qualified 标记）。

    keyword 支持逗号分隔多个关键词（抖音 web 搜索每个词只给一批结果，
    多词合并去重才能凑够候选）。
    """
    if not _browser.is_running():
        raise RuntimeError(
            "专用 Chrome 未运行。请用 --remote-debugging-port=9222 启动并登录抖音。"
        )
    items: list[dict] = []
    for kw in re.split(r"[,，;；]", keyword):
        if kw.strip():
            items += _search(kw.strip(), log)
    if not items:
        raise RuntimeError("所有关键词均未捕获到搜索结果（抖音登录是否失效/被风控？）")
    candidates = _filter_candidates(items, min_likes)
    log(f"搜索到 {len(items)} 条，点赞 ≥ {min_likes} 的候选 {len(candidates)} 条")

    results: list[dict] = []
    hits = 0
    for cand in candidates[:max_check]:
        result = _check_candidate(cand, log)
        results.append(result)
        if result["qualified"]:
            hits += 1
            log(f"  ✅ 符合：评论区 {len(result['book_comments'])} 条求书名")
            if hits >= stop_after_hits:
                log(f"已找到 {hits} 条符合条件，提前结束")
                break
    return results


# ---- 搜索 ----

def _search(keyword: str, log) -> list[dict]:
    url = "https://www.douyin.com/search/" + urllib.parse.quote(keyword) + "?type=video"
    log(f"打开搜索页：{keyword}")
    bodies = asyncio.run(_capture(url, _SEARCH_APIS, scrolls=2, settle=6))
    items: list[dict] = []
    for body in bodies:
        items += _extract_awemes(body)
    if not items:
        log(f"  ⚠️ 「{keyword}」未捕获到搜索结果（被风控或无结果），跳过")
    else:
        log(f"  「{keyword}」捕获 {len(items)} 条")
    return items


def _extract_awemes(body: str) -> list[dict]:
    try:
        data = json.loads(body)
    except ValueError:
        return []
    out = []
    for card in data.get("data") or []:
        if card.get("aweme_info"):
            out.append(card["aweme_info"])
        out += card.get("aweme_list") or []  # 合集卡内的视频
    return out


def _filter_candidates(items: list[dict], min_likes: int) -> list[dict]:
    seen: dict[str, dict] = {}
    for a in items:
        aid = a.get("aweme_id")
        likes = (a.get("statistics") or {}).get("digg_count", 0)
        if aid and aid not in seen and likes >= min_likes:
            seen[aid] = a
    # 带 AI 生成标识的优先检查（更贴合"找 AI 同行"的目标），同档按点赞降序
    def _sort_key(a: dict):
        ai = bool((a.get("aigc_info") or {}).get("aigc_label_type"))
        likes = (a.get("statistics") or {}).get("digg_count", 0)
        return (not ai, -likes)

    return sorted(seen.values(), key=_sort_key)


# ---- 逐条验证 ----

def _check_candidate(aweme: dict, log) -> dict:
    item = _summarize(aweme)
    log(f"检查《{item['title'][:24]}》 点赞 {item['like_count']}")
    comments, detail = _visit_video(item["aweme_id"], log)
    if detail:  # 搜索结果不带 aigc_info，AI 标识以详情接口为准
        item["ai_label"] = item["ai_label"] or \
            bool((detail.get("aigc_info") or {}).get("aigc_label_type"))
    item["comment_checked"] = len(comments)
    item["book_comments"] = [c for c in comments if BOOK_ASK_RE.search(c)][:5]
    item["qualified"] = bool(item["book_comments"])
    if item["ai_label"]:
        log("  🤖 详情页带 AI 生成标识")
    return item


def _summarize(a: dict) -> dict:
    stats = a.get("statistics") or {}
    desc = a.get("desc") or ""
    cover_urls = ((a.get("video") or {}).get("cover") or {}).get("url_list") or []
    return {
        "aweme_id": a.get("aweme_id", ""),
        "url": f"https://www.douyin.com/video/{a.get('aweme_id', '')}",
        "title": desc[:120] or "（无标题）",
        "author": (a.get("author") or {}).get("nickname", ""),
        "like_count": stats.get("digg_count", 0),
        "comment_count": stats.get("comment_count", 0),
        "duration": round((a.get("video") or {}).get("duration", 0) / 1000),
        "cover": cover_urls[0] if cover_urls else None,
        "ai_label": bool((a.get("aigc_info") or {}).get("aigc_label_type")),
        "ai_hint": bool(AI_HINT_RE.search(desc)),
        "history_hit": bool(HISTORY_RE.search(desc)),
    }


def _visit_video(aweme_id: str, log) -> tuple[list[str], dict]:
    """打开视频页，一次导航同时捕获评论列表与视频详情（取 aigc 标识）。"""
    url = f"https://www.douyin.com/video/{aweme_id}"
    bodies = asyncio.run(_capture(url, _COMMENT_APIS + _DETAIL_APIS, scrolls=3, settle=6))
    texts: list[str] = []
    detail: dict = {}
    for body in bodies:
        try:
            data = json.loads(body)
        except ValueError:
            continue
        texts += [c.get("text", "") for c in data.get("comments") or []]
        detail = data.get("aweme_detail") or detail
    log(f"  捕获评论 {len(texts)} 条")
    return texts, detail


# ---- CDP：导航并捕获指定接口的所有响应体 ----

async def _capture(url: str, api_substrs: tuple[str, ...], *,
                   scrolls: int, settle: float, stop_after: int | None = None) -> list[str]:
    async with websockets.connect(_browser._page_ws(), max_size=None) as ws:
        send = _browser._sender(ws)
        await send("Network.enable")
        await send("Page.enable")
        await send("Page.navigate", {"url": url})
        bodies: list[str] = []
        for round_no in range(scrolls + 1):
            bodies += await _collect_round(ws, send, api_substrs, settle, stop_after)
            if stop_after and len(bodies) >= stop_after:
                break
            if round_no < scrolls:
                await _wheel_down(send)
        return bodies


_SCROLL_ALL_JS = (
    "[document.scrollingElement,...document.querySelectorAll('div')]"
    ".filter(e=>e&&e.scrollHeight>e.clientHeight+200)"
    ".forEach(e=>{e.scrollTop+=2600})"
)


async def _wheel_down(send) -> None:
    """触发懒加载：合成滚动手势 + 把所有可滚容器（含评论面板）往下推。"""
    await send("Input.synthesizeScrollGesture",
               {"x": 600, "y": 400, "yDistance": -3200, "speed": 1600})
    await send("Runtime.evaluate", {"expression": _SCROLL_ALL_JS})
    await asyncio.sleep(0.8)


async def _collect_round(ws, send, api_substrs: tuple[str, ...], window: float,
                         stop_after: int | None = None) -> list[str]:
    """监听 window 秒内加载完成的目标接口响应，窗口结束后统一取响应体。

    stop_after：捕到指定条数后提前结束本轮监听（评论页只需首批）。
    """
    end = time.time() + window
    matched: dict[str, str] = {}  # requestId → 完整 URL（带签名，供重放兜底）
    finished: list[str] = []
    while time.time() < end:
        try:
            msg = json.loads(await asyncio.wait_for(ws.recv(), timeout=max(0.1, end - time.time())))
        except asyncio.TimeoutError:
            break
        method = msg.get("method")
        if method == "Network.responseReceived" \
                and any(s in msg["params"]["response"]["url"] for s in api_substrs):
            matched[msg["params"]["requestId"]] = msg["params"]["response"]["url"]
        elif method == "Network.loadingFinished" \
                and msg["params"]["requestId"] in matched:
            finished.append(msg["params"]["requestId"])
            if stop_after and len(finished) >= stop_after:
                break

    bodies = []
    for rid in finished:
        body = await _fetch_body(ws, send, rid, matched[rid])
        if body:
            bodies.append(body)
    return bodies


async def _fetch_body(ws, send, rid: str, url: str) -> str | None:
    """取响应体；worker 发出的请求 getResponseBody 会报 No resource，
    此时在页面上下文重放原始带签名 URL 兜底。"""
    try:
        return await _browser._response_body(ws, send, rid)
    except RuntimeError:
        pass
    expr = f"fetch({json.dumps(url)},{{credentials:'include'}}).then(r=>r.text())"
    want = await send("Runtime.evaluate",
                      {"expression": expr, "awaitPromise": True, "returnByValue": True})
    while True:
        msg = json.loads(await ws.recv())
        if msg.get("id") == want:
            return (msg.get("result", {}).get("result") or {}).get("value")
