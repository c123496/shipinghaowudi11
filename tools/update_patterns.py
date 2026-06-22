"""半自动更新爆款套路库。

喂入一条新爆款的原文（--task / --file / --text），让 DeepSeek 对照现有套路库，
判断它的开头/中段/结尾各命中哪个已有套路（给证据句），以及是否出现库里没有的新套路。
默认只产出建议（dry-run），加 --apply 才并入 data/baokuan_patterns.json。

用法（项目根目录执行）：
  python tools/update_patterns.py --task d98f2ea4          # 看建议
  python tools/update_patterns.py --task d98f2ea4 --apply  # 确认后入库
  python tools/update_patterns.py --file 某新爆款.txt --apply
"""
import argparse
import hashlib
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

try:  # Windows 终端默认 GBK，强制 UTF-8 避免中文输出乱码
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

from backend.services import _llm  # noqa: E402

LIB_PATH = ROOT / "data" / "baokuan_patterns.json"
SUGGEST_PATH = ROOT / "data" / "_patterns_suggestion.json"
_CATS = ("openings", "middles", "endings")
_CAT_CN = {"openings": "开头", "middles": "中段", "endings": "结尾"}
_PREFIX = {"openings": "o", "middles": "m", "endings": "e"}
_WEIGHT_CAP = 6

_SYS = (
    "你是中文爆款短视频文案的结构拆解专家。你的任务是把一条新爆款拆成"
    "开头/中段/结尾三部分，对照给定的现有套路库，判断每部分命中哪个已有套路，"
    "并指出是否存在库里没有的新套路。只依据原文，不臆造。"
    '严格输出 JSON：{"openings":{...},"middles":{...},"endings":{...}}，'
    "每个类目对象含字段："
    'matched_id（命中的套路id，没有就空串）、evidence（原文里最能代表该手法的一句，原样摘录）、'
    'new_pattern（库里没有合适套路时给出，对象含 name/trigger/template/example；否则给 null）。'
    "禁止 markdown、解释、代码围栏。"
)


def _srt_to_text(raw: str) -> str:
    out = []
    for ln in raw.splitlines():
        ln = ln.strip()
        if not ln or ln.isdigit() or "-->" in ln:
            continue
        out.append(ln)
    return "".join(out)


def get_source(args) -> str:
    if args.text:
        return args.text
    if args.task:
        tasks = ROOT / "data" / "tasks"
        d = tasks / args.task
        if not d.exists():  # 支持只输 task_id 前缀
            matches = [p for p in tasks.glob(args.task + "*") if p.is_dir()]
            if not matches:
                raise SystemExit(f"找不到任务：{args.task}")
            d = matches[0]
        srt = d / "source.srt"
        return _srt_to_text(srt.read_text(encoding="utf-8", errors="ignore"))
    path = Path(args.file)
    raw = path.read_text(encoding="utf-8", errors="ignore")
    return _srt_to_text(raw) if path.suffix.lower() == ".srt" else raw


def build_catalog(lib: dict) -> str:
    lines = []
    for cat in _CATS:
        lines.append(f"[{_CAT_CN[cat]} {cat}]")
        for x in lib.get(cat, []):
            lines.append(f"  {x['id']} | {x['name']} | {x.get('trigger', '')}")
    return "\n".join(lines)


def classify(text: str, lib: dict) -> dict:
    user = (
        f"现有套路库（只能从对应类目的 id 里选，选不到才提 new_pattern）：\n"
        f"{build_catalog(lib)}\n\n"
        f"待拆解的新爆款原文：\n{text[:6000]}"
    )
    raw = _llm.chat(_SYS, user, temperature=0.2, json_mode=True)
    return json.loads(raw)


def _new_id(cat: str, name: str, lib: dict) -> str:
    h = hashlib.md5(name.encode("utf-8")).hexdigest()[:6]
    cand = f"{_PREFIX[cat]}_{h}"
    existing = {x["id"] for x in lib.get(cat, [])}
    return cand if cand not in existing else f"{cand}x"


def _find(lib: dict, cat: str, pid: str) -> dict | None:
    return next((x for x in lib.get(cat, []) if x["id"] == pid), None)


def apply_suggestion(lib: dict, sug: dict) -> list[str]:
    changes = []
    for cat in _CATS:
        item = sug.get(cat) or {}
        mid, ev = item.get("matched_id", ""), (item.get("evidence") or "").strip()
        new = item.get("new_pattern")
        if mid and (pat := _find(lib, cat, mid)):
            exs = pat.setdefault("examples", [])
            if ev and not any(ev in e or e in ev for e in exs):
                exs.append(ev)
                pat["weight"] = min(_WEIGHT_CAP, int(pat.get("weight", 1)) + 1)
                changes.append(f"强化 [{_CAT_CN[cat]}]{pat['name']}：+1例句 +权重")
        elif new and new.get("name"):
            nid = _new_id(cat, new["name"], lib)
            lib[cat].append({
                "id": nid, "name": new["name"], "trigger": new.get("trigger", ""),
                "template": new.get("template", ""),
                "examples": [new["example"]] if new.get("example") else [],
                "genres": ["通用"], "weight": 1,
            })
            changes.append(f"新增 [{_CAT_CN[cat]}]{new['name']}（{nid}）")
    return changes


def print_suggestion(sug: dict) -> None:
    for cat in _CATS:
        item = sug.get(cat) or {}
        print(f"\n■ {_CAT_CN[cat]}")
        if item.get("matched_id"):
            print(f"  命中已有套路：{item['matched_id']}")
            print(f"  证据句：{item.get('evidence', '')}")
        if item.get("new_pattern"):
            np = item["new_pattern"]
            print(f"  ★ 发现新套路：{np.get('name')} —— {np.get('trigger', '')}")


def main() -> None:
    ap = argparse.ArgumentParser(description="半自动更新爆款套路库")
    src = ap.add_mutually_exclusive_group(required=True)
    src.add_argument("--task", help="data/tasks/<id>/source.srt")
    src.add_argument("--file", help="原文文件路径（.srt 或 .txt）")
    src.add_argument("--text", help="直接传入原文")
    ap.add_argument("--apply", action="store_true", help="把建议并入套路库（默认只建议不改库）")
    args = ap.parse_args()

    text = get_source(args)
    print(f"原文 {len(text)} 字，对照套路库分析中（DeepSeek）...")
    lib = json.loads(LIB_PATH.read_text(encoding="utf-8"))
    sug = classify(text, lib)

    SUGGEST_PATH.write_text(json.dumps(sug, ensure_ascii=False, indent=2), encoding="utf-8")
    print_suggestion(sug)
    print(f"\n完整建议已写入：{SUGGEST_PATH}")

    if not args.apply:
        print("\n这是 dry-run。确认无误后加 --apply 入库。")
        return
    changes = apply_suggestion(lib, sug)
    LIB_PATH.write_text(json.dumps(lib, ensure_ascii=False, indent=2), encoding="utf-8")
    print("\n已入库：" + ("；".join(changes) if changes else "无新增/强化（均已覆盖）"))


if __name__ == "__main__":
    main()
