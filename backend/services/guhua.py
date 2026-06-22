"""真名画库（古画）：用真实传世名画做实景配图，零 AI 痕迹、零违规风险。

来源：维基共享资源（Wikimedia Commons，公有领域 / CC0）。按画名检索拿到正确文件，
下载高清图缓存到本地 `古画库/`，再按文案题材匹配、裁切区域或做 Ken Burns 运镜。

与 AI 生图（storyboard.py）互补：讲座/市井/文人/山水题材优先用真名画；
战争/戏剧化大场面再走 AI 史诗风。
"""
import json
import subprocess
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Callable

_API = "https://commons.wikimedia.org/w/api.php"
_HDR = {"User-Agent": "Mozilla/5.0 guhua-lib/1.0 (video pipeline; local use)"}
_TIMEOUT = 60

# 题材 → 传世名画。keywords 用于和文案 brief 做关键词匹配；search 是维基共享检索词。
MANIFEST: list[dict] = [
    # 盛世 / 经济 / 市井 / 王朝兴衰
    {"id": "qingming", "name": "清明上河图", "dynasty": "北宋·张择端",
     "keywords": ["市井", "繁华", "盛世", "经济", "王朝", "百姓", "城", "商", "富", "民生", "汴京"],
     "search": "清明上河图 Along the River During the Qingming Festival"},
    {"id": "gusu", "name": "姑苏繁华图", "dynasty": "清·徐扬",
     "keywords": ["盛世", "繁华", "江南", "市井", "苏州", "太平", "民生"],
     "search": "姑苏繁华图 Prosperous Suzhou"},
    # 文人 / 谋士 / 读书 / 雅集 / 智慧
    {"id": "hanxizai", "name": "韩熙载夜宴图", "dynasty": "五代·顾闳中",
     "keywords": ["文人", "谋士", "权谋", "宴", "夜", "雅集", "智慧", "处世", "人性"],
     "search": "韩熙载夜宴图 Night Revels of Han Xizai"},
    {"id": "wenhui", "name": "文会图", "dynasty": "北宋·赵佶",
     "keywords": ["文人", "读书", "雅集", "学问", "诗词", "君子", "智慧"],
     "search": "文会图 赵佶 Literary Gathering"},
    # 山水 / 绝境 / 胸怀 / 隐逸 / 江山
    {"id": "qianli", "name": "千里江山图", "dynasty": "北宋·王希孟",
     "keywords": ["江山", "山水", "胸怀", "天下", "格局", "隐逸", "绝境", "气象"],
     "search": "千里江山图 A Thousand Li of Rivers and Mountains"},
    {"id": "fuchun", "name": "富春山居图", "dynasty": "元·黄公望",
     "keywords": ["山水", "隐逸", "归隐", "淡泊", "晚年", "胸怀", "孤"],
     "search": "富春山居图 Dwelling in the Fuchun Mountains"},
    {"id": "xishan", "name": "溪山行旅图", "dynasty": "北宋·范宽",
     "keywords": ["山水", "行旅", "绝境", "渺小", "天地", "孤", "敬畏"],
     "search": "溪山行旅图 Travelers among Mountains and Streams"},
    # 帝王 / 朝堂 / 权谋
    {"id": "didi", "name": "历代帝王图", "dynasty": "唐·阎立本",
     "keywords": ["帝王", "皇帝", "朝堂", "权谋", "君主", "天子", "江山", "权力"],
     "search": "历代帝王图 Thirteen Emperors"},
    {"id": "bunian", "name": "步辇图", "dynasty": "唐·阎立本",
     "keywords": ["帝王", "朝堂", "外交", "联姻", "君臣", "权力"],
     "search": "步辇图 阎立本 Bunian tu"},
    # 仕女 / 家庭 / 婚姻
    {"id": "zanhua", "name": "内人双陆图（周昉仕女）", "dynasty": "唐·周昉",
     "keywords": ["仕女", "女子", "婚姻", "家庭", "宫廷", "美人", "贵妇"],
     "search": "Zhou Fang Court Ladies"},
    {"id": "daolian", "name": "捣练图", "dynasty": "唐·张萱",
     "keywords": ["仕女", "女子", "家庭", "劳作", "日常", "妇人"],
     "search": "捣练图 Court Ladies Preparing Newly Woven Silk"},
]


def _urlopen(req: urllib.request.Request, timeout: int, retries: int = 4) -> bytes:
    """带退避重试的请求，自动应对维基共享的 429 限流。"""
    for i in range(retries):
        try:
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return r.read()
        except urllib.error.HTTPError as e:
            if e.code == 429 and i < retries - 1:
                time.sleep(3 * (i + 1))
                continue
            raise
    raise RuntimeError("unreachable")


def _api_get(params: dict) -> dict:
    url = _API + "?" + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, headers=_HDR)
    return json.loads(_urlopen(req, _TIMEOUT))


def resolve(search: str, width: int = 3000) -> dict | None:
    """按画名检索维基共享，返回最大那张位图的 {title, url, width, height}。"""
    d = _api_get({
        "action": "query", "format": "json", "generator": "search",
        "gsrsearch": f"filetype:bitmap {search}", "gsrnamespace": 6, "gsrlimit": 6,
        "prop": "imageinfo", "iiprop": "url|size", "iiurlwidth": width,
    })
    pages = (d.get("query") or {}).get("pages", {})
    best = None
    for p in pages.values():
        ii = (p.get("imageinfo") or [{}])[0]
        if not ii.get("width"):
            continue
        cand = {"title": p.get("title"), "url": ii.get("thumburl") or ii.get("url"),
                "width": ii["width"], "height": ii["height"]}
        # 取原始像素最大的（最清晰）
        if best is None or cand["width"] * cand["height"] > best["width"] * best["height"]:
            best = cand
    return best


def fetch(painting: dict, cache_dir: Path, width: int = 3000,
          log: Callable[[str], None] = print) -> Path | None:
    """下载某幅画到缓存目录，已存在则跳过。返回本地路径。"""
    cache_dir.mkdir(parents=True, exist_ok=True)
    dst = cache_dir / f"{painting['id']}.jpg"
    if dst.exists() and dst.stat().st_size > 10_000:
        return dst
    info = resolve(painting["search"], width)
    if not info or not info["url"]:
        log(f"× 未解析到《{painting['name']}》")
        return None
    req = urllib.request.Request(info["url"], headers=_HDR)
    dst.write_bytes(_urlopen(req, _TIMEOUT * 2))
    log(f"✓ 《{painting['name']}》{info['width']}×{info['height']} → {dst.name}")
    return dst


def sync_library(cache_dir: Path, log: Callable[[str], None] = print) -> list[Path]:
    """预拉取整库。建议跑一次，之后离线可用。"""
    out = []
    for p in MANIFEST:
        try:
            path = fetch(p, cache_dir, log=log)
            if path:
                out.append(path)
        except Exception as e:  # noqa: BLE001
            log(f"× {p['name']} 下载失败：{type(e).__name__} {e}")
        time.sleep(2)  # 给维基共享留间隔，避免 429
    log(f"古画库就绪：{len(out)}/{len(MANIFEST)} 幅")
    return out


def pick(brief: str, used: set[str] | None = None) -> dict | None:
    """按文案片段关键词匹配最合适的一幅画。used 用于同条视频内避免重复。"""
    used = used or set()
    scored = []
    for p in MANIFEST:
        hits = sum(1 for k in p["keywords"] if k in brief)
        penalty = 5 if p["id"] in used else 0
        scored.append((hits - penalty, p))
    scored.sort(key=lambda x: -x[0])
    best_score, best = scored[0]
    return best if best_score > 0 else None


def _dims(path: Path) -> tuple[int, int]:
    r = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "stream=width,height",
         "-of", "csv=p=0:s=x", str(path)], capture_output=True, text=True)
    w, h = r.stdout.strip().split("x")
    return int(w), int(h)


def crop_still(src: Path, dst: Path, size: str = "1792x1024", x_frac: float = 0.0) -> Path:
    """从古画里裁出一帧定格图，cover 填充保证输出严格等于目标尺寸。

    x_frac 0~1 控制横向取景位置（长卷取不同段落）。
    """
    tw, th = (int(v) for v in size.split("x"))
    w, h = _dims(src)
    scale = max(tw / w, th / h)  # cover：两边都不小于目标
    sw, sh = max(tw, round(w * scale)), max(th, round(h * scale))
    x = int((sw - tw) * max(0.0, min(1.0, x_frac)))
    y = (sh - th) // 2
    vf = f"scale={sw}:{sh},crop={tw}:{th}:{x}:{y}"
    subprocess.run(["ffmpeg", "-y", "-i", str(src), "-vf", vf, str(dst)],
                   capture_output=True)
    return dst


def ken_burns(src: Path, dst: Path, seconds: float = 4.0, size: str = "1792x1024",
              fps: int = 30) -> Path:
    """把古画做成缓慢横移（长卷）/推拉的运镜片段 mp4，对标账号的"古画动起来"效果。"""
    tw, th = (int(v) for v in size.split("x"))
    w, h = _dims(src)
    frames = int(seconds * fps)
    # 长卷横移：缩放到目标高度，从左到右平移
    scale_w = int(w * th / h)
    pan = max(0, scale_w - tw)
    vf = (f"scale=-1:{th},"
          f"crop={tw}:{th}:'min({pan},(iw-{tw})*n/{frames})':0,"
          f"format=yuv420p")
    subprocess.run(
        ["ffmpeg", "-y", "-loop", "1", "-i", str(src), "-t", str(seconds),
         "-r", str(fps), "-vf", vf, "-an", str(dst)], capture_output=True)
    return dst


if __name__ == "__main__":
    import sys
    sys.stdout.reconfigure(encoding="utf-8")
    lib = Path(__file__).resolve().parents[2] / "古画库"
    sync_library(lib)
