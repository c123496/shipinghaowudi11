"""找同类爆款：后台线程跑 douyin_discover，前端轮询状态。

单用户单任务：同一时刻只允许一个寻找任务；结果落盘 data/discover/latest.json，
重启后端/刷新页面后仍可看到上次结果。
"""
import json
import threading
import time
from pathlib import Path

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from ..services import douyin_discover

router = APIRouter()

DATA_DIR = Path(__file__).parent.parent.parent / "data" / "discover"

_STATE: dict = {"running": False, "keyword": "", "logs": [], "results": [],
                "error": None, "started_at": None}
_LOCK = threading.Lock()


class RunRequest(BaseModel):
    keyword: str = "历史书 解说"
    min_likes: int = 10000
    max_check: int = 12
    stop_after_hits: int = 3


@router.post("/run")
def run(req: RunRequest):
    if not req.keyword.strip():
        raise HTTPException(400, "keyword 不能为空")
    with _LOCK:
        if _STATE["running"]:
            raise HTTPException(409, "已有寻找任务在进行中")
        _STATE.update(running=True, keyword=req.keyword, logs=[], results=[],
                      error=None, started_at=time.time())
    threading.Thread(target=_worker, args=(req,), daemon=True).start()
    return {"status": "started"}


@router.get("/status")
def status():
    if not _STATE["running"] and not _STATE["results"] and not _STATE["logs"]:
        saved = _load_latest()
        if saved:
            return {**_STATE, "keyword": saved.get("keyword", ""),
                    "results": saved.get("results", [])}
    return _STATE


def _worker(req: RunRequest) -> None:
    def log(msg: str) -> None:
        _STATE["logs"].append(msg)

    try:
        results = douyin_discover.discover(
            req.keyword, req.min_likes, req.max_check, log, req.stop_after_hits)
        _STATE["results"] = results
        _save_latest(req.keyword, results)
        log(f"完成：检查 {len(results)} 条，符合条件 "
            f"{sum(1 for r in results if r['qualified'])} 条")
    except Exception as exc:  # noqa: BLE001 - 后台线程兜底，错误透给前端
        _STATE["error"] = str(exc)
        log(f"失败：{exc}")
    finally:
        _STATE["running"] = False


def _save_latest(keyword: str, results: list[dict]) -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    (DATA_DIR / "latest.json").write_text(
        json.dumps({"keyword": keyword, "saved_at": time.time(), "results": results},
                   ensure_ascii=False, indent=2),
        encoding="utf-8")


def _load_latest() -> dict | None:
    path = DATA_DIR / "latest.json"
    if path.exists():
        try:
            return json.loads(path.read_text(encoding="utf-8"))
        except ValueError:
            return None
    return None
