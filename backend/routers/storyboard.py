"""Storyboard routes: split B/C script, generate 3x3 image grids, compose B/C videos."""
import json
from pathlib import Path

from fastapi import APIRouter, BackgroundTasks, HTTPException
from pydantic import BaseModel

from ..services import storyboard, storyboard_video

router = APIRouter()
DATA_ROOT = Path(__file__).parent.parent.parent / "data" / "tasks"


class PrepareRequest(BaseModel):
    mode: str = "9:16"
    source: str = "rewrite"
    image_count: int | None = None  # 手动指定分镜图张数；None=按对标自动检测


class GenerateRequest(BaseModel):
    grid_index: int
    book_title: str = ""
    book_author: str = ""
    mode: str = "9:16"
    style: str = "hybrid"  # ai | hybrid | real：是否启用真名画库


class VariantRequest(BaseModel):
    variant: str


@router.get("/{task_id}/storyboard")
def get_storyboard(task_id: str):
    return _load(task_id)


@router.post("/{task_id}/storyboard/prepare")
def prepare(task_id: str, req: PrepareRequest):
    if req.source not in {"rewrite", "dedup"}:
        raise HTTPException(400, "Storyboard source must be B(rewrite) or C(dedup)")
    wenan = _read_json(DATA_ROOT / task_id / "wenan.json") or {}
    script = (wenan.get(req.source) or "").strip()
    if not script:
        label = "B rewrite" if req.source == "rewrite" else "C dedup"
        raise HTTPException(400, f"Please finish {label} in Wenan Workshop first")

    # 按对标镜头数（或用户手改值）决定分镜图张数
    target = storyboard.resolve_target_beats(DATA_ROOT / task_id, req.image_count, lambda m: None)
    batches = storyboard.split_briefs(script, target_beats=target or None)
    data = _load(task_id)
    data["batches"] = batches
    data["source"] = req.source
    data["mode"] = req.mode
    data["grids"] = {}
    if target:
        data["image_count"] = target
    _save(task_id, data)
    return data


@router.post("/{task_id}/storyboard/generate")
def generate(task_id: str, req: GenerateRequest, background_tasks: BackgroundTasks):
    data = _load(task_id)
    batches = data.get("batches") or []
    if not (1 <= req.grid_index <= len(batches)):
        raise HTTPException(400, "Grid index out of range. Prepare storyboard first.")
    grids = data.setdefault("grids", {})
    grids[str(req.grid_index)] = {"status": "generating"}
    _save(task_id, data)
    background_tasks.add_task(
        _run_generate, task_id, req.grid_index,
        batches[req.grid_index - 1], req.book_title, req.book_author,
        req.mode or data.get("mode", "9:16"), len(batches), req.style,
    )
    return {"status": "started", "grid_index": req.grid_index}


@router.get("/{task_id}/storyboard/videos")
def get_storyboard_videos(task_id: str):
    return storyboard_video.list_variants(DATA_ROOT / task_id)


@router.post("/{task_id}/storyboard/videos/generate")
def generate_storyboard_video(task_id: str, req: VariantRequest):
    try:
        return storyboard_video.compose_variant(DATA_ROOT / task_id, req.variant, lambda m: None)
    except FileNotFoundError as exc:
        raise HTTPException(400, str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc


def _run_generate(task_id, grid_index, briefs, book_title, book_author, mode, total, style="hybrid"):
    task_dir = DATA_ROOT / task_id
    try:
        res = storyboard.generate_grid(
            task_dir, briefs, book_title, book_author, grid_index, total, mode,
            lambda m: None, style)
        _update_grid(task_id, grid_index, {"status": "done", **res})
    except Exception as exc:
        _update_grid(task_id, grid_index, {"status": "error", "error": str(exc)})


def _update_grid(task_id: str, grid_index: int, value: dict) -> None:
    data = _load(task_id)
    data.setdefault("grids", {})[str(grid_index)] = value
    _save(task_id, data)


def _load(task_id: str) -> dict:
    return _read_json(DATA_ROOT / task_id / "storyboard.json") or {}


def _read_json(path: Path) -> dict | None:
    if path.exists():
        return json.loads(path.read_text(encoding="utf-8"))
    return None


def _save(task_id: str, data: dict) -> None:
    path = DATA_ROOT / task_id / "storyboard.json"
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
