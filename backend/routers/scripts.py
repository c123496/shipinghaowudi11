"""全局文案库接口 —— 聚合所有任务的 rewrite / wenan 文案，供前端列表展示。"""

import json
from difflib import SequenceMatcher
from pathlib import Path

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import Task

router = APIRouter()

DATA_ROOT = Path(__file__).parent.parent.parent / "data" / "tasks"

# 相似度计算只在截断后的文本上做，避免 O(n²) 对长文本爆炸
_SIM_MAX_CHARS = 400


def _fast_similarity(a: str, b: str) -> float:
    """截断后计算相似度，足够给出合理百分比且快几十倍。"""
    return round(SequenceMatcher(None, a[:_SIM_MAX_CHARS], b[:_SIM_MAX_CHARS]).ratio(), 3)


@router.get("")
def list_scripts(db: Session = Depends(get_db)):
    """返回所有有文案的任务摘要，按创建时间倒序。"""
    # 单次查询拿到所有任务元信息
    tasks = db.query(Task).all()
    titles = {t.id: t.title for t in tasks}
    created_at_map = {t.id: t.created_at.isoformat() for t in tasks}

    items: list[dict] = []
    if not DATA_ROOT.exists():
        return items

    for directory in DATA_ROOT.iterdir():
        if not directory.is_dir():
            continue
        task_id = directory.name

        # 快速探测：至少有一个文案文件才往下读
        has_rewrite = (directory / "rewrite.json").exists()
        has_wenan = (directory / "wenan.json").exists()
        if not has_rewrite and not has_wenan:
            continue

        source = _meta_title(directory) or titles.get(task_id) or task_id
        created_at = created_at_map.get(task_id, "")

        rewrite_data = _read_json(directory / "rewrite.json") if has_rewrite else None
        wenan_data = _read_json(directory / "wenan.json") if has_wenan else None

        # 优先取 wenan 里的 book，fallback 到 rewrite 里的
        book = None
        if wenan_data and wenan_data.get("book"):
            book = wenan_data["book"]
        elif rewrite_data and rewrite_data.get("book"):
            book = rewrite_data["book"]

        # 口播改写（rewrite.json 里的 candidates）
        rewrite_summary = None
        if rewrite_data and rewrite_data.get("candidates"):
            candidates = rewrite_data["candidates"]
            sel = rewrite_data.get("selected", 0)
            sel_text = candidates[sel] if 0 <= sel < len(candidates) else ""
            rewrite_summary = {
                "candidates_count": len(candidates),
                "selected_index": sel,
                "candidates": candidates,
                "preview": _truncate(sel_text, 200),
                "full_text": sel_text,
            }

        # 二创换骨（wenan.json 里的 dedup）
        dedup_text = ""
        if wenan_data and wenan_data.get("dedup"):
            dedup_text = wenan_data["dedup"]

        # 文案工坊改写（wenan.json 里的 rewrite）
        wenan_rewrite_text = ""
        if wenan_data and wenan_data.get("rewrite"):
            wenan_rewrite_text = wenan_data["rewrite"]

        has_rewrite_flag = rewrite_summary is not None
        has_dedup = bool(dedup_text.strip())
        has_wenan_rewrite = bool(wenan_rewrite_text.strip())

        # 原始逐字稿——只有存在改写/二创时才读（用于搜索和相似度）
        original_text = ""
        transcript_preview = None
        if has_rewrite_flag or has_dedup or has_wenan_rewrite:
            transcript_data = _read_json(directory / "transcript.json")
            original_text = _transcript_full_text(transcript_data)
            if original_text.strip():
                transcript_preview = {
                    "preview": _truncate(original_text, 200),
                    "full_text": original_text,
                }

        # 相似度：截断后计算，快几十倍
        rewrite_sim = None
        wenan_rewrite_sim = None
        dedup_sim = None
        if original_text:
            if rewrite_summary and rewrite_summary.get("full_text"):
                rewrite_sim = _fast_similarity(original_text, rewrite_summary["full_text"])
            if wenan_rewrite_text:
                wenan_rewrite_sim = _fast_similarity(original_text, wenan_rewrite_text)
            if dedup_text:
                dedup_sim = _fast_similarity(original_text, dedup_text)

        items.append(
            {
                "task_id": task_id,
                "source": source,
                "created_at": created_at,
                "book": book,
                "transcript": transcript_preview,
                "rewrite": rewrite_summary,
                "wenan_rewrite": {
                    "preview": _truncate(wenan_rewrite_text, 200),
                    "full_text": wenan_rewrite_text,
                }
                if has_wenan_rewrite
                else None,
                "dedup": {
                    "preview": _truncate(dedup_text, 200),
                    "full_text": dedup_text,
                }
                if has_dedup
                else None,
                "has_rewrite": has_rewrite_flag,
                "has_dedup": has_dedup,
                "has_wenan_rewrite": has_wenan_rewrite,
                "rewrite_similarity": rewrite_sim,
                "wenan_rewrite_similarity": wenan_rewrite_sim,
                "dedup_similarity": dedup_sim,
            }
        )

    items.sort(key=lambda x: x["created_at"], reverse=True)
    return items


def _meta_title(directory: Path) -> str | None:
    meta = directory / "meta.json"
    if not meta.exists():
        return None
    try:
        data = json.loads(meta.read_text(encoding="utf-8"))
        title = str(data.get("title", "")).strip()
        return title or None
    except Exception:
        return None


def _read_json(path: Path) -> dict | None:
    if path.exists():
        try:
            return json.loads(path.read_text(encoding="utf-8"))
        except Exception:
            return None
    return None


def _truncate(text: str, limit: int = 200) -> str:
    text = text.strip()
    if len(text) <= limit:
        return text
    return text[:limit] + "…"


def _transcript_full_text(data: dict | None) -> str:
    """从 transcript.json 提取完整逐字稿文本。"""
    if not data:
        return ""
    return data.get("full_text") or " ".join(
        s.get("text", "") for s in data.get("segments", [])
    )
