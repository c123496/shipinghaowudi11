"""爆款套路库读取 + 抽样 + 渲染。

库文件：data/baokuan_patterns.json（openings/middles/endings 三类）。
改写时为每个候选抽一套「开头×中段×结尾」组合，渲染成中文指令片段，
经 rewrite_notes 注入改写 prompt——只约束结构手法，不碰任何事实。
"""
import json
import random
from pathlib import Path

_PATH = Path(__file__).resolve().parents[2] / "data" / "baokuan_patterns.json"
_CATS = ("openings", "middles", "endings")


def load() -> dict:
    if not _PATH.exists():
        return {c: [] for c in _CATS}
    return json.loads(_PATH.read_text(encoding="utf-8"))


def _eligible(items: list, genre: str) -> list:
    if not genre:
        return items
    hit = [x for x in items if genre in x.get("genres", []) or "通用" in x.get("genres", [])]
    return hit or items


def _weighted_pick(items: list, rng: random.Random) -> dict:
    weights = [max(1, int(x.get("weight", 1))) for x in items]
    return rng.choices(items, weights=weights, k=1)[0]


def sample_combo(lib: dict, genre: str = "", rng: random.Random | None = None) -> dict:
    rng = rng or random.Random()
    combo = {}
    for cat in _CATS:
        items = _eligible(lib.get(cat, []), genre)
        if items:
            combo[cat] = _weighted_pick(items, rng)
    return combo


def sample_distinct_combos(n: int, genre: str = "",
                           rng: random.Random | None = None) -> list[dict]:
    """抽 n 套组合，尽量让各套的开头套路互不相同。"""
    rng = rng or random.Random()
    lib = load()
    combos, used_openings = [], set()
    for _ in range(n * 4):
        if len(combos) >= n:
            break
        c = sample_combo(lib, genre, rng)
        oid = c.get("openings", {}).get("id")
        if oid and oid in used_openings:
            continue
        used_openings.add(oid)
        combos.append(c)
    while len(combos) < n:  # 库太小时兜底，允许重复
        combos.append(sample_combo(lib, genre, rng))
    return combos


def render_notes(combo: dict) -> str:
    """把一套组合渲染成策略指引（不是填空模板）。

    只给策略方向和心理机制，让 AI 自由发挥措辞。
    末尾强制提醒禁用公式句。
    """
    o, m, e = combo.get("openings"), combo.get("middles"), combo.get("endings")
    lines = [
        "【叙事策略指引——只约束心理机制和结构方向，措辞必须你自己原创】",
    ]
    if o:
        lines.append(f"开头策略：「{o['name']}」")
        lines.append(f"  心理机制：{o.get('trigger', '')}")
        lines.append(f"  方向：{o['template']}")
    if m:
        lines.append(f"中段策略：「{m['name']}」")
        lines.append(f"  方向：{m['template']}")
    if e:
        lines.append(f"结尾策略：「{e['name']}」")
        lines.append(f"  方向：{e['template']}")
    lines.append('重要：严禁写出"有一种X比Y更Z""我死盯着"等公式句——写了就作废，换一个完全不同的切入。')
    return "\n".join(lines)
