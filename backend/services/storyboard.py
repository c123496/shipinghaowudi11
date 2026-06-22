"""九宫格分镜生图：清洗稿分段 → 每 9 段一组 → gpt-image-2 生成 3×3 总图 → 裁成 9 格。

System/User/style_bible 严格按既定规范。安全约束：医疗等敏感词转译为明亮生活方式隐喻。
"""
import json
import os
import re
import subprocess
from pathlib import Path
from typing import Callable

from . import _evolink, guhua

GRID_SIZE = "1792x1024"  # 16:9 总画布
_GUHUA_DIR = Path(__file__).resolve().parents[2] / "古画库"

# 通用 system（构图/安全约束），{continuity}/{tone} 由 .env 选中的风格 preset 注入。
_SYSTEM_BASE = """你是中文文化历史短视频口播的视觉分镜导演，负责把逐字稿内容转译成统一、有质感、紧扣每段内容、适合公开视频平台发布的画面。

- 9 个格子必须按从左到右、从上到下的顺序，对应用户提供的 9 段 brief。
- 格子之间只允许极细、低存在感的深色分隔线。
- 不要生成大白边、宽边框、相册拼贴、漫画分镜框、UI 界面或海报排版。
- 图片里禁止出现任何可读文字、字幕、标题、书名、品牌、水印、二维码、按钮、弹窗、账号名。
- 每个格子的画面主体，由该段 brief 的实际内容决定：讲器物就画器物，讲节俗或场景就画那个场景，讲某个动作就直接把那个动作画出来，讲人物故事才画人物。
- 画面要直白好懂、单一主体、信息集中：观众一眼就能看出"这一段在讲什么"。优先画该段最具体、最有代表性的动作或事物，不要用抽象空镜、不要堆砌多个互不相关的元素、不要含糊的纯氛围图。
- 出现人物时清晰露脸、五官端正自然、神态沉稳，不做背影或纯剪影；但不要每格都硬塞人物——场景、器物、活动同样是合格主体。
- 用构图、光线、时代器物烘托段落情绪，画面之间保持同一套美术风格的连续感。

统一风格硬约束：
本任务可能会生成多张九宫格总图，用来裁出多张候选图。所有九宫格总图必须保持同一套视觉风格，{continuity}。不能每张图换画风，不能每个格子换画风。同一条视频的服饰、建筑、器物、质感必须统一为同一套美术风格。

安全表达硬约束：
不出现血腥、断肢、尸体、刑具特写、惊悚或过度暴力画面；战争场面以远景剪影、旌旗、烟尘、光影氛围表现，不做血腥特写。即使逐字稿出现疾病、死亡、酷刑、战乱等词，也转译为含蓄克制的氛围隐喻，例如残烛、空城、落雪、孤舟、风中的旌旗。

整体基调：
{tone}

只生成图片，不要解释，不要输出文字说明。"""

# 两套视觉风格 preset，由 .env STORYBOARD_STYLE 选择：mohua=水墨（默认）/ epic=史诗写实。
_PRESETS = {
    "mohua": {
        "continuity": "像同一位画家的连续水墨册页",
        "tone": "中国传统水墨写意，古雅、空灵、有意境与笔墨韵味，宣纸毛笔质感，适合公开视频号/抖音发布。",
        "image_style": "hybrid",
        "style_bible": """统一风格手册（style_bible，所有批次必须一致）：
固定美术方向：中国传统水墨画 / 国画写意风格，宣纸质感、毛笔勾勒、墨分五色、浓淡干湿层次分明，接近经典国画与水墨纪录片插画的质感。不是照片写实，不是 3D 渲染，不是厚涂油画，不是动漫卡通。
固定色彩：以水墨黑灰为主调，辅以淡雅设色（淡赭石、花青、藤黄、淡朱），低饱和、清雅古朴；大量留白（宣纸本色），墨色透气不发死黑；避免高饱和数码塑料感与艳俗色。
固定光线：水墨不依赖强光影，靠墨色浓淡与留白营造空间与气韵；画面清透，主体墨线清晰可辨；仅下三分之一可略作淡墨晕染预留字幕区，主体始终清晰。
固定镜头：传统国画构图，讲究留白、虚实与意境，主体居中、占画面主要位置、清晰可辨，背景以淡墨远山、云气、留白衬托，不喧宾夺主。
题材物件：依据每段内容选取贴切的中式意象，用水墨写意表现。
人物气质：如内容涉及人物，着相应中式古装，以水墨人物画法表现，神态自然、清晰露脸、少用纯剪影背影；内容是器物或场景时则以器物场景为主体，不强行加人。
所有图片必须共享同一套水墨笔法、墨色层次、设色倾向、留白节奏与宣纸质感，像同一位画家的连续册页。""",
        "user_style": """- 中国传统水墨画 / 国画写意，宣纸质感、毛笔勾勒、墨分五色，淡雅设色、大量留白
- 以水墨黑灰为主、低饱和淡彩点染，古朴清雅，不发死黑；不要照片写实 / 3D / 油画 / 动漫
- 每格画面直白好懂、单一主体，一眼看出在讲什么
- 墨法、设色、留白统一，像同一位画家的连续册页，每一格都紧扣该段 brief 的内容""",
        "pad": "水墨写意的中式空镜（淡墨远山、云气、时令草木、窗前书卷），大量留白、宣纸质感，与整体水墨风格一致的留白画面",
    },
    "epic": {
        "continuity": "像同一部历史正剧的连续剧照",
        "tone": "电影级写实历史正剧质感，史诗厚重、有戏剧张力与光影氛围，影视概念美术与数字绘画质感，适合公开视频号/抖音发布。",
        "image_style": "ai",
        "style_bible": """统一风格手册（style_bible，所有批次必须一致）：
固定美术方向：电影级写实历史概念美术 / 厚涂数字绘画，质感厚重、细节丰富，接近历史正剧海报与游戏过场 CG 的质感。不是水墨，不是动漫卡通，不是 3D 塑料渲染，不是简笔插画。
固定色彩：低饱和，暖褐金与青灰为主调，沉稳厚重；高光集中在主体（人物面部、兵器、铠甲），背景压暗，形成强烈明暗对比；避免高饱和艳俗色与塑料感。
固定光线：戏剧性侧逆光 / 顶光，主体边缘有轮廓光，光影对比强烈，营造史诗与命运感；下三分之一可略压暗预留字幕区，主体始终清晰。
固定镜头：电影感构图，主体居中、占画面主要位置、清晰可辨，背景以战场、烟尘、旌旗、宫阙、山河远景烘托，景深虚实分明。
题材物件：依据每段内容选取贴切的历史意象——披甲武将、长髯英雄、兵器战马、战旗城楼、营帐、江河战船、桃园等，用写实厚涂表现。
人物气质：着相应时代服饰甲胄，五官端正、神态沉稳坚毅、清晰露脸，不做纯剪影背影；面部刻画到位、有皮肤与须发质感。
所有图片必须共享同一套写实厚涂笔触、光影逻辑、色彩倾向与质感，像同一部历史正剧的连续剧照。""",
        "user_style": """- 电影级写实历史概念美术 / 厚涂数字绘画，质感厚重、细节丰富，戏剧性光影
- 低饱和暖褐金与青灰为主，强烈明暗对比，主体高光、背景压暗；不要水墨 / 动漫 / 3D 塑料 / 简笔
- 每格画面直白好懂、单一主体，一眼看出在讲什么
- 光影、笔触、色彩统一，像同一部历史正剧的连续剧照，每一格都紧扣该段 brief 的内容""",
        "pad": "电影级写实的历史空镜（烟尘弥漫的古战场、暮色城楼、江河战船、风中残旗），低饱和暖褐青灰、戏剧光影、厚涂质感，与整体史诗写实风格一致的画面",
    },
}


def _active_preset() -> dict:
    """按 .env STORYBOARD_STYLE 选风格 preset，未知值回退 mohua（水墨）。"""
    name = (os.environ.get("STORYBOARD_STYLE") or "mohua").strip().lower()
    return _PRESETS.get(name, _PRESETS["mohua"])


def active_image_style() -> str:
    """当前风格对应的生图模式：mohua→hybrid（命中题材用古画库）/ epic→ai（纯 AI 史诗）。"""
    return _active_preset()["image_style"]


_USER_TMPL = """风格要求：
{style_lines}

内容来源限制：
只参考逐字稿正文和下面的 9 段 brief，不引用原视频标题、账号、作者或来源信息。

整条视频主题：{book_title}
书籍作者：{book_author}
当前九宫格批次：第 {grid_index}/{grid_total} 组

九格画面 brief：
1. {cell_1_text}
2. {cell_2_text}
3. {cell_3_text}
4. {cell_4_text}
5. {cell_5_text}
6. {cell_6_text}
7. {cell_7_text}
8. {cell_8_text}
9. {cell_9_text}

请直接生成九宫格总图。
不要在图片里放任何文字。
不要输出解释。"""

# 喂给生图的画面 brief 里的高危描写 → 安全的视觉隐喻。
# 只清洗"生图提示词"，口播稿/字幕原文不受影响。OpenAI 图像安全过滤器会扫输入
# 提示词原文，血腥/暴力字样会被整组拒绝（content_policy_violation），故先替换。
# 顺序：长词在前，避免被短词先替换掉。
_SAFE_REPLACE = [
    ("一鞭一鞭", "一程一程"), ("鞭子沾了水", "风雨交加"), ("沾水的鞭子", "风雨"),
    ("挨鞭子", "受磨难"), ("鞭打", "磨砺"), ("鞭子", "风雨"), ("抽在你身上", "落在身上"),
    ("血顺着嘴角往下淌", "神情坚毅、面带风霜"), ("血浸透", "风尘浸透"),
    ("血人", "风尘仆仆的身影"), ("血迹", "风尘"), ("鲜血", "风霜"), ("流血", "带伤"), ("血", "风霜"),
    ("尸体堆", "战后余烬的战场"), ("死人堆", "战后余烬的战场"), ("尸横遍野", "战后萧瑟"),
    ("尸体", "战后余烬"), ("尸", "战后余烬"),
    ("杀红了眼", "奋勇无畏"), ("厮杀", "奋战"), ("横冲直撞", "奋勇向前"),
    ("追着剩下的敌人砍", "乘胜追击"), ("砍", "挥兵"), ("杀进", "冲入"), ("杀", "征战"),
    ("死伤惨重", "战事惨烈"), ("闻风丧胆", "威名远扬"),
    ("绑在马桩上", "被困缚于木桩"), ("绑在柱子上", "被困缚于木柱"), ("绑在马桩", "被困缚"),
    ("绑起来", "押解"), ("罪犯", "落难之人"), ("拿命抵", "以身相抵"),
]


def _sanitize_brief(text: str) -> str:
    """把单格画面 brief 里的血腥/暴力字样替换成安全隐喻，避开图像安全过滤器。"""
    for bad, safe in _SAFE_REPLACE:
        if bad in text:
            text = text.replace(bad, safe)
    return text


def split_briefs(cleaned: str, min_beat_chars: int | None = None,
                 target_beats: int | None = None) -> list[list[str]]:
    """把清洗稿切成视觉 beat，每 9 个一组。

    target_beats：想要的总"拍"数（=想生成的分镜图张数，通常来自对标视频镜头检测）。
    给了正整数就按它反推每拍字数，让总拍数≈target_beats。优先级高于 min_beat_chars。

    min_beat_chars：每一"拍"的目标最小字数。上一拍没攒够就把后续句子并进去，
    拍数越少 → 九宫格组数越少 → 生图调用越少越省钱。默认读环境变量
    STORYBOARD_MIN_BEAT_CHARS（无则 48，约让 1800 字脚本出 4 组）。
    """
    if target_beats and target_beats > 0:
        # 按目标张数反推每拍字数：总字数 / 目标张数（向上取整）
        min_beat_chars = max(8, -(-len(cleaned) // target_beats))
    elif min_beat_chars is None:
        try:
            min_beat_chars = int(os.environ.get("STORYBOARD_MIN_BEAT_CHARS", "48") or 48)
        except ValueError:
            min_beat_chars = 48
    min_beat_chars = max(8, min_beat_chars)  # 至少 8，避免退化成逐句

    parts = re.split(r"(?<=[。！？!?\n])", cleaned)
    beats: list[str] = []
    for p in (x.strip() for x in parts):
        if not p:
            continue
        # 上一拍还没攒够目标字数，就把当前句并入上一拍（合并短句、压低拍数）
        if beats and len(beats[-1]) < min_beat_chars:
            beats[-1] = beats[-1] + p
        else:
            beats.append(p)
    return [beats[i:i + 9] for i in range(0, len(beats), 9)] or [[]]


_REF_COUNT_MIN, _REF_COUNT_MAX = 1, 36


def _find_task_video(task_dir: Path) -> Path | None:
    for ext in ("mp4", "webm", "mkv", "m4v", "mov"):
        p = task_dir / f"video.{ext}"
        if p.exists():
            return p
    return None


def detect_ref_image_count(video_path: Path, log: Callable[[str], None]) -> int:
    """用 ffmpeg 镜头检测，估算对标视频用了多少张不同画面。失败返回 0。"""
    try:
        r = subprocess.run(
            ["ffmpeg", "-i", str(video_path), "-filter:v",
             "select='gt(scene,0.3)',metadata=print", "-an", "-f", "null", "-"],
            capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=180,
        )
        cuts = (r.stdout + r.stderr).count("pts_time")
        n = cuts + 1  # 切换次数 + 1 = 不同画面数
        n = max(_REF_COUNT_MIN, min(_REF_COUNT_MAX, n))
        log(f"对标镜头检测：约 {n} 个不同画面")
        return n
    except Exception as exc:
        log(f"对标镜头检测失败（忽略，回退默认分段）：{exc}")
        return 0


def resolve_target_beats(task_dir: Path, override: int | None,
                         log: Callable[[str], None]) -> int:
    """决定本任务要生成多少张分镜图（=拍数）。

    override 优先（用户在界面手改）；否则读 storyboard.json 缓存的 ref_image_count；
    再没有就对 video.mp4 跑镜头检测并缓存。返回 0 表示未知（上游回退默认分段）。
    """
    sb_path = task_dir / "storyboard.json"
    data = {}
    if sb_path.exists():
        try:
            data = json.loads(sb_path.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            data = {}

    if override and override > 0:
        n = max(_REF_COUNT_MIN, min(_REF_COUNT_MAX, override))
        data["ref_image_count"] = data.get("ref_image_count") or n
        data["image_count"] = n
        sb_path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
        return n

    cached = data.get("ref_image_count")
    if cached:
        return int(cached)

    video = _find_task_video(task_dir)
    if not video:
        return 0
    n = detect_ref_image_count(video, log)
    if n:
        data["ref_image_count"] = n
        sb_path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    return n


def build_prompt(briefs: list[str], book_title: str, book_author: str,
                 grid_index: int, grid_total: int) -> str:
    preset = _active_preset()
    cells = [_sanitize_brief(c) for c in (briefs + [preset["pad"]] * 9)[:9]]
    values = {
        "book_title": book_title or "（未指定）",
        "book_author": book_author or "（未指定）",
        "grid_index": grid_index, "grid_total": grid_total,
        "style_lines": preset["user_style"],
    }
    for i, c in enumerate(cells, 1):
        values[f"cell_{i}_text"] = c
    system = _SYSTEM_BASE.replace("{continuity}", preset["continuity"]).replace("{tone}", preset["tone"])
    user = _USER_TMPL
    for k, v in values.items():
        user = user.replace("{" + k + "}", str(v))
    return f"{system}\n\n{preset['style_bible']}\n\n{user}"


def generate_grid(task_dir: Path, briefs: list[str], book_title: str, book_author: str,
                  grid_index: int, grid_total: int, mode: str, log: Callable[[str], None],
                  style: str = "hybrid") -> dict:
    """生成一组九宫格总图并裁成 9 格，返回相对路径。mode: '16:9' 或 '9:16'。

    style: 'ai' 纯 AI 史诗风；'hybrid' 命中题材的格子换成真名画、其余 AI（默认）；
           'real' 同 hybrid，尽量多用真名画。
    """
    prompt = build_prompt(briefs, book_title, book_author, grid_index, grid_total)
    log(f"第 {grid_index}/{grid_total} 组：生成九宫格总图...")
    try:
        img = _evolink.generate_image(prompt, GRID_SIZE, log)
    except Exception as exc:
        # 仍被内容安全过滤拦下：用纯安全空镜（无任何叙事文字）重试一次，
        # 保证整条视频不会因为某一组的敏感描写而全盘失败。
        msg = str(exc).lower()
        if "content_policy" in msg or "inappropriate" in msg or "policy" in msg:
            log("⚠️ 本组触发内容安全过滤，改用安全空镜重试...")
            pad = _active_preset()["pad"]
            safe_prompt = build_prompt([pad] * 9, book_title, book_author, grid_index, grid_total)
            img = _evolink.generate_image(safe_prompt, GRID_SIZE, log)
        else:
            raise

    out_dir = task_dir / "storyboard"
    out_dir.mkdir(parents=True, exist_ok=True)
    grid_path = out_dir / f"grid_{grid_index}.png"
    grid_path.write_bytes(img)
    log("裁切九宫格...")
    cells = _crop_cells(grid_path, grid_index, mode, log)
    real_cells = _apply_guhua(cells, briefs, style, log)
    return {
        "grid": f"storyboard/grid_{grid_index}.png",
        "cells": [f"storyboard/{c.name}" for c in cells],
        "real_cells": real_cells,  # 用了真名画的格子序号（1-9）
        "style": style,
    }


def _apply_guhua(cells: list[Path], briefs: list[str], style: str,
                 log: Callable[[str], None]) -> list[int]:
    """命中题材关键词的格子，用真名画裁切覆盖 AI 图。返回被替换的格子序号。"""
    if style == "ai":
        return []
    used: set[str] = set()
    replaced: list[int] = []
    for i, cell in enumerate(cells):
        brief = briefs[i] if i < len(briefs) else ""
        painting = guhua.pick(brief, used)
        if not painting:
            continue
        src = _GUHUA_DIR / f"{painting['id']}.jpg"
        if not src.exists():
            continue
        used.add(painting["id"])
        w, h = _dims(cell)
        x_frac = (len(used) * 0.17) % 0.8  # 错开取景，避免同画重复构图
        guhua.crop_still(src, cell, f"{w}x{h}", x_frac)
        replaced.append(i + 1)
        log(f"  格 {i + 1} → 真名画《{painting['name']}》")
    if replaced:
        log(f"本组 {len(replaced)} 格用真名画，其余 AI 史诗风")
    return replaced


def _crop_cells(grid_path: Path, grid_index: int, mode: str, log: Callable[[str], None]) -> list[Path]:
    w, h = _dims(grid_path)
    cw, ch = w // 3, h // 3
    out_dir = grid_path.parent
    paths: list[Path] = []
    for idx in range(9):
        r, c = divmod(idx, 3)
        x, y, tw, th = c * cw, r * ch, cw, ch
        if mode == "9:16":  # 从 16:9 格子中心裁出 9:16
            tw = int(ch * 9 / 16)
            x = c * cw + (cw - tw) // 2
        dst = out_dir / f"grid_{grid_index}_cell_{idx + 1}.png"
        _ffmpeg_crop(grid_path, dst, tw, th, x, y)
        paths.append(dst)
    return paths


def _dims(path: Path) -> tuple[int, int]:
    r = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "stream=width,height",
         "-of", "csv=p=0:s=x", str(path)], capture_output=True, text=True)
    w, h = r.stdout.strip().split("x")
    return int(w), int(h)


def _ffmpeg_crop(src: Path, dst: Path, w: int, h: int, x: int, y: int) -> None:
    subprocess.run(
        ["ffmpeg", "-y", "-i", str(src), "-vf", f"crop={w}:{h}:{x}:{y}", str(dst)],
        capture_output=True)
