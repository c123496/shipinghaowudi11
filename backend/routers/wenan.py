"""文案工坊路由：对任务逐字稿做 清洗/改写/去重/书籍识别，结果存 wenan.json。"""
import json
from pathlib import Path

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from ..services import wenan

router = APIRouter()
DATA_ROOT = Path(__file__).parent.parent.parent / "data" / "tasks"


class WenanRequest(BaseModel):
    keyword: str = ""
    rewrite_notes: str = ""
    protected_terms: str = ""
    existing_title: str = ""
    existing_author: str = ""
    # 可选：前端传入手改过的清洗稿，覆盖 wenan.json 里的
    cleaned: str | None = None


@router.get("/{task_id}/wenan")
def get_wenan(task_id: str):
    return _load(task_id)


@router.post("/{task_id}/wenan/clean")
def run_clean(task_id: str, req: WenanRequest):
    full, meta = _source(task_id)
    result = wenan.clean(full, req.keyword, meta["title"], meta["uploader"])
    return _save(task_id, "cleaned", result, req)


@router.post("/{task_id}/wenan/rewrite")
def run_rewrite(task_id: str, req: WenanRequest):
    _, meta = _source(task_id)
    cleaned = _cleaned_text(task_id, req)
    result = wenan.rewrite(cleaned, req.keyword, meta["title"], meta["uploader"], req.rewrite_notes)
    return _save(task_id, "rewrite", result, req)


@router.post("/{task_id}/wenan/dedup")
def run_dedup(task_id: str, req: WenanRequest):
    full, meta = _source(task_id)
    cleaned = _cleaned_text(task_id, req)
    result = wenan.dedup(cleaned, full, req.keyword, meta["title"], meta["uploader"], req.protected_terms)
    return _save(task_id, "dedup", result, req)


@router.post("/{task_id}/wenan/segment")
def run_segment(task_id: str, req: WenanRequest):
    full, meta = _source(task_id)
    saved = _load(task_id)
    # 最终配音文案优先级：前端传入 > 去重 > 改写 > 清洗 > 原始逐字稿
    script = (req.cleaned or "").strip() or saved.get("dedup") or saved.get("rewrite") \
        or saved.get("cleaned") or full
    segs = wenan.segment(script, req.keyword, meta["title"], meta["uploader"])
    return _save(task_id, "segments", segs, req)


@router.post("/{task_id}/wenan/identify-book")
def run_identify(task_id: str, req: WenanRequest):
    full, meta = _source(task_id)
    result = wenan.identify_book(
        full, req.keyword, meta["title"], meta.get("description", ""),
        req.existing_title, req.existing_author,
    )
    return _save(task_id, "book", result, req)


# ---- helpers ----

def _source(task_id: str) -> tuple[str, dict]:
    task_dir = DATA_ROOT / task_id
    tpath = task_dir / "transcript.json"
    mpath = task_dir / "meta.json"
    if not tpath.exists():
        raise HTTPException(400, "请先完成「语音转录」步骤")
    transcript = json.loads(tpath.read_text(encoding="utf-8"))
    meta = json.loads(mpath.read_text(encoding="utf-8")) if mpath.exists() else {}
    meta.setdefault("title", "")
    meta.setdefault("uploader", "")
    full = transcript.get("full_text") or " ".join(
        s.get("text", "") for s in transcript.get("segments", [])
    )
    return full, meta


def _cleaned_text(task_id: str, req: WenanRequest) -> str:
    if req.cleaned is not None and req.cleaned.strip():
        return req.cleaned
    saved = _load(task_id).get("cleaned")
    if saved:
        return saved
    # 没有清洗稿就用原始逐字稿兜底
    return _source(task_id)[0]


def _load(task_id: str) -> dict:
    path = DATA_ROOT / task_id / "wenan.json"
    if path.exists():
        return json.loads(path.read_text(encoding="utf-8"))
    return {}


def _save(task_id: str, key: str, result, req: WenanRequest) -> dict:
    data = _load(task_id)
    data[key] = result
    data["inputs"] = {
        "keyword": req.keyword, "rewrite_notes": req.rewrite_notes,
        "protected_terms": req.protected_terms,
    }
    # rewrite/dedup 用到的清洗稿若是前端手改过的，回写
    if req.cleaned is not None and req.cleaned.strip():
        data["cleaned"] = req.cleaned
    # 改写/去重结果自动计算与清洗稿的相似度
    if key in ("rewrite", "dedup") and isinstance(result, str):
        cleaned = data.get("cleaned") or _source(task_id)[0]
        data[f"{key}_similarity"] = round(wenan.similarity(cleaned, result), 3)
    path = DATA_ROOT / task_id / "wenan.json"
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    out = {key: result}
    if f"{key}_similarity" in data:
        out[f"{key}_similarity"] = data[f"{key}_similarity"]
    return out
