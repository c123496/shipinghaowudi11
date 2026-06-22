from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import RedirectResponse
from .database import init_db, SessionLocal
from .models import StepRun
from .routers import tasks, pipeline, wenan, storyboard, gallery, scripts, discover
from datetime import datetime
from pathlib import Path
import os

DATA_TASKS = Path(__file__).parent.parent / "data" / "tasks"
# 必须在 StaticFiles 挂载前创建（挂载发生在模块导入时，早于 startup 事件）
DATA_TASKS.mkdir(parents=True, exist_ok=True)

app = FastAPI(title="视频号爆款")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def startup() -> None:
    DATA_TASKS.mkdir(parents=True, exist_ok=True)
    init_db()
    _load_env()
    _reset_stale_runs()


def _reset_stale_runs() -> None:
    """清理滞留的 running 步骤。

    进程死在步骤中途（重启/崩溃）时，step_runs 的 running 永远不会自己结束，
    前端会一直显示假"运行中"。启动时统一标记为 error，提示用户重跑。
    """
    db = SessionLocal()
    try:
        stale = db.query(StepRun).filter(StepRun.status == "running").all()
        for sr in stale:
            sr.status = "error"
            sr.finished_at = datetime.utcnow()
            sr.error_msg = "后端重启导致中断，请重新运行该步骤"
        if stale:
            db.commit()
    finally:
        db.close()


def _load_env() -> None:
    env_file = Path(__file__).parent.parent / ".env"
    if env_file.exists():
        for line in env_file.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                # 用 .env 覆盖（而非 setdefault），否则改了 .env 重启也不生效
                os.environ[k.strip()] = v.strip()


app.include_router(tasks.router, prefix="/api/tasks", tags=["tasks"])
app.include_router(pipeline.router, prefix="/api/tasks", tags=["pipeline"])
app.include_router(wenan.router, prefix="/api/tasks", tags=["wenan"])
app.include_router(storyboard.router, prefix="/api/tasks", tags=["storyboard"])
app.include_router(gallery.router, prefix="/api/gallery", tags=["gallery"])
app.include_router(scripts.router, prefix="/api/scripts", tags=["scripts"])
app.include_router(discover.router, prefix="/api/discover", tags=["discover"])


@app.get("/api/{placeholder}/storyboard/videos", include_in_schema=False)
def redirect_bad_storyboard_placeholder_url(placeholder: str):
    if placeholder == "...":
        return RedirectResponse(url="http://localhost:5173/")
    return RedirectResponse(url="http://localhost:5173/")

app.mount("/api/files", StaticFiles(directory=str(DATA_TASKS)), name="files")

