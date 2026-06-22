"""主管线「改写」步骤——已统一到文案工坊(wenan)标准。

旧版是独立的 DeepSeek 3 候选改写、无合规约束、CTA 泛泛。现统一为：
清洗(A) → 爆款口播改写(B，设问钩子+史实+可转发金句+合规) → 自然引导购书(CTA)。

保留旧数据契约：输出 rewrite.json = {"candidates": [...], "selected": 0, "book": {...}}，
供 tts 步骤与前端候选选择继续消费。
"""
import json
from pathlib import Path
from typing import Callable

from . import baokuan_patterns, compliance, wenan

_N_CANDIDATES = 3

# 3 个候选 = 3 个互斥创作角度 × 3 种叙事策略，确保候选之间语义和结构都不同：
# 角度由 wenan.generate_angles 产出（主线论点/选材/切入点/古今映射互不重叠）
# ①② 走爆款套路库的不同「开头×中段×结尾」策略组合（拆解重构体）
# ③ 提问链体（用连续追问驱动叙事，和前两个完全不同的文体）
_STRATEGIES = [
    {"label": "拆解重构·策略A", "kind": "rewrite"},
    {"label": "拆解重构·策略B", "kind": "rewrite"},
    {"label": "提问链体重构", "kind": "dedup"},
]


_SIM_THRESHOLD = 0.5
_CROSS_SIM_THRESHOLD = 0.45
_OPENING_SIM_THRESHOLD = 0.6
_OPENING_CHECK_LEN = 100


def rewrite(transcript: dict, task_dir: Path, log: Callable[[str], None]) -> dict:
    source_text = transcript.get("full_text") or _concat_segments(transcript)
    meta = _read_meta(task_dir)
    title, author, desc = meta.get("title", ""), meta.get("uploader", ""), meta.get("description", "")

    log(f"原文 {len(source_text)} 字，清洗中（文案工坊标准）...")
    cleaned = wenan.clean(source_text, "", title, author) or source_text

    log("提取事实素材（脱离原文措辞）...")
    facts = wenan.extract_facts(cleaned)
    log(f"事实萃取完成，{len(facts)} 字")

    log("识别书名作者（用于结尾引导购书）...")
    book = wenan.identify_book(cleaned, "", title, desc)
    has_book = float(book.get("confidence", 0) or 0) >= 0.5 and book.get("book_title")
    if has_book:
        log(f"识别到《{book['book_title']}》，结尾将自然引导购书")
    else:
        log("未可靠识别到书名，跳过购书引导（可在文案工坊 D 手动指定后重跑）")

    log("设计三个互斥创作角度（主线/选材/切入点互不重叠）...")
    angles = wenan.generate_angles(facts, _N_CANDIDATES)
    if angles:
        log("角度分化：" + " ｜ ".join(a.get("name", "?") for a in angles))
    else:
        log("警告：角度分化失败，本次退回全事实覆盖模式（三候选语义可能偏近）")

    n_rewrite = sum(1 for s in _STRATEGIES if s["kind"] == "rewrite")
    combos = iter(baokuan_patterns.sample_distinct_combos(n_rewrite))

    candidates, reports = [], []
    for i, strat in enumerate(_STRATEGIES):
        angle_notes = wenan.render_angle_notes(angles[i]) if i < len(angles) else ""
        if strat["kind"] == "dedup":
            log(f"生成候选 {i + 1}/{_N_CANDIDATES}（{strat['label']}）...")
            body = _generate_with_gate(
                lambda t, _a=angle_notes: wenan.dedup(
                    facts, source_text, "", title, author, temperature=t, angle_notes=_a),
                cleaned, candidates, log, i, default_temp=0.85,
            )
        else:
            combo = next(combos, None)
            notes = baokuan_patterns.render_notes(combo) if combo else ""
            log(f"生成候选 {i + 1}/{_N_CANDIDATES}（{strat['label']}：{_combo_names(combo)}）...")
            body = _generate_with_gate(
                lambda t, _n=notes, _a=angle_notes: wenan.rewrite(
                    facts, "", title, author, rewrite_notes=_n, temperature=t, angle_notes=_a),
                cleaned, candidates, log, i, default_temp=0.7,
            )

        rep = compliance.ensure_compliant(body, log=log)
        body = rep["text"]
        highs = sum(1 for x in rep["issues"] if x.get("severity") == "high")
        log(f"候选 {i + 1} 合规：{'通过' if rep['passed'] else f'仍有 {highs} 处高风险待人工确认'}")
        reports.append({"passed": rep["passed"], "issues": rep["issues"]})

        if has_book:
            cta = wenan.book_cta(book["book_title"], book.get("book_author", ""), variant=i)
            if cta and cta not in body:
                body = f"{body}\n{cta}"
        candidates.append(body)
        log(f"候选 {i + 1} 完成，{len(body)} 字")

    _check_opening_diversity(candidates, log)

    selected = next((i for i, r in enumerate(reports) if r["passed"]), 0)
    result = {"candidates": candidates, "selected": selected, "book": book,
              "compliance": reports}
    (task_dir / "rewrite.json").write_text(
        json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    log("改写完成（事实重建 + 引导购书）")
    return result


def _generate_with_gate(gen_fn, cleaned: str, prev: list[str], log, idx: int,
                        default_temp: float) -> str:
    """生成文案并检测与原文、与已生成候选的相似度，超阈值则提温重试一次。"""
    body = gen_fn(default_temp)
    problem = _sim_problem(body, cleaned, prev)
    if problem:
        retry_temp = min(default_temp + 0.15, 1.0)
        log(f"候选 {idx + 1} {problem}，提温至 {retry_temp} 重试...")
        body = gen_fn(retry_temp)
        problem = _sim_problem(body, cleaned, prev)
        if problem:
            log(f"候选 {idx + 1} 重试后仍{problem}，标记警告")
        else:
            log(f"候选 {idx + 1} 重试成功，相似度已达标")
    else:
        log(f"候选 {idx + 1} 相似度检查通过（对原文与已生成候选）")
    return body


def _sim_problem(body: str, cleaned: str, prev: list[str]) -> str:
    """返回相似度问题描述；无问题返回空串。"""
    sim = wenan.similarity(cleaned, body)
    if sim > _SIM_THRESHOLD:
        return f"与原文相似度 {sim:.0%} 过高"
    for j, p in enumerate(prev):
        s = wenan.similarity(p, body)
        if s > _CROSS_SIM_THRESHOLD:
            return f"与候选 {j + 1} 相似度 {s:.0%} 过高（同质化风险）"
    return ""


def _check_opening_diversity(candidates: list[str], log) -> None:
    """检查三候选开头是否足够不同。"""
    for i in range(len(candidates)):
        for j in range(i + 1, len(candidates)):
            a = candidates[i][:_OPENING_CHECK_LEN]
            b = candidates[j][:_OPENING_CHECK_LEN]
            sim = wenan.similarity(a, b)
            if sim > _OPENING_SIM_THRESHOLD:
                log(f"警告：候选 {i + 1} 和候选 {j + 1} 开头相似度 {sim:.0%}，建议手动检查")


def _combo_names(combo: dict) -> str:
    if not combo:
        return "默认套路"
    cats = ("openings", "middles", "endings")
    return " / ".join(combo[c]["name"] for c in cats if c in combo)


def _read_meta(task_dir: Path) -> dict:
    path = task_dir / "meta.json"
    if not path.exists():
        return {}
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return {}


def _concat_segments(transcript: dict) -> str:
    return " ".join(s["text"] for s in transcript.get("segments", []))
