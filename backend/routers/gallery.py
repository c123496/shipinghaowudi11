import json
import subprocess
from pathlib import Path

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import Task

router = APIRouter()
DATA_ROOT = Path(__file__).parent.parent.parent / "data" / "tasks"


# 成片文件名 → 版本标签。只收录真正的九宫格成片（B/C）。
# 旧管线的 final.mp4 多为开发测试片，不进作品页（文件仍保留在磁盘，需要可手动取用）。
_VARIANTS = [
    ("storyboard_rewrite.mp4", "B · 口播改写版"),
    ("storyboard_dedup.mp4", "C · 二创改写版"),
]


@router.get("")
def list_gallery(db: Session = Depends(get_db)):
    """扫描所有已生成的成片（九宫格 B/C 版 + 旧 final.mp4），供「我的作品」直接播放。"""
    titles = {t.id: t.title for t in db.query(Task).all()}
    items = []
    if not DATA_ROOT.exists():
        return items

    for directory in DATA_ROOT.iterdir():
        if not directory.is_dir():
            continue
        title = titles.get(directory.name) or _meta_title(directory) or directory.name
        cover = directory / "cover.jpg"
        cover_url = f"/api/files/{directory.name}/cover.jpg" if cover.exists() else None

        for fname, label in _VARIANTS:
            video = directory / fname
            if not video.exists():
                continue
            items.append(
                {
                    "id": f"{directory.name}:{fname}",
                    "task_id": directory.name,
                    "title": title,
                    "label": label,
                    "video_url": f"/api/files/{directory.name}/{fname}",
                    "cover_url": cover_url,
                    "duration": _duration(video),
                    "mtime": video.stat().st_mtime,
                }
            )

    items.sort(key=lambda item: item["mtime"], reverse=True)
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


def _duration(video: Path) -> float | None:
    try:
        result = subprocess.run(
            [
                "ffprobe", "-v", "error",
                "-show_entries", "format=duration",
                "-of", "default=noprint_wrappers=1:nokey=1",
                str(video),
            ],
            capture_output=True, text=True, timeout=20,
        )
        if result.returncode == 0:
            return round(float(result.stdout.strip()), 1)
    except Exception:
        pass
    return None
