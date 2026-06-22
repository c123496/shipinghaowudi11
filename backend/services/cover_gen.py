"""自动封面：DeepSeek 按「人群 / 痛点 / 结果」三层提炼文案 → Pillow 排版导出封面图。

封面不照搬标题，要在一秒内回答：这条讲给谁、讲他的什么问题、点进去能得到什么。
独立产物（cover_final.jpg），不写入视频。
"""
import json
from pathlib import Path
from typing import Callable

from PIL import Image, ImageDraw, ImageFont

from . import _llm

_FONT_BOLD = "C:/Windows/Fonts/msyhbd.ttf"
W, H = 1080, 1440  # 3:4 主页封面通用比例

_SYS = """你是短视频封面文案策划。把口播主题压缩成"一秒看懂"的封面，分三层，禁止照搬原标题。
封面要在一秒内回答三个问题：这条讲给谁、讲的是他的什么问题/场景、点进去能得到什么结果或悬念。
输出 JSON：{"audience":"目标人群","painpoint":"具体痛点或场景","result":"结果、原因或悬念"}
要求：
- audience：点名人群或身份，≤12字（如"家有孩子的父母""人到五十"）。
- painpoint：戳中的具体痛点/尴尬场景，≤16字，要扎心、口语（如"孩子问传统，你答不上来"）。
- result：点进去能得到的结果或一个勾人悬念，≤16字（如"3句话讲透老规矩""原来藏着这层意思"）。
- 三层不重复、不空话，像信息流里让人想点进去的钩子。只输出 JSON。"""


def extract_cover_text(script: str, book_title: str, log: Callable[[str], None]) -> dict:
    user = f"书：《{book_title}》\n口播全文：\n{script[:2000]}\n\n请输出三层封面文案 JSON。"
    raw = _llm.chat(_SYS, user, temperature=0.8, json_mode=True)
    data = json.loads(raw)
    layers = {
        "audience": str(data.get("audience", "")).strip(),
        "painpoint": str(data.get("painpoint", "")).strip(),
        "result": str(data.get("result", "")).strip(),
    }
    log(f"封面三层文案：{layers['audience']} / {layers['painpoint']} / {layers['result']}")
    return layers


def _font(size: int) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(_FONT_BOLD, size)


def _wrap(text: str, n: int) -> list[str]:
    return [text[i:i + n] for i in range(0, len(text), n)] or [""]


def _draw_center(draw: ImageDraw.ImageDraw, text: str, y: int, font: ImageFont.FreeTypeFont,
                 fill, stroke: int = 0, stroke_fill="black") -> None:
    w = draw.textlength(text, font=font)
    draw.text(((W - w) / 2, y), text, font=font, fill=fill,
              stroke_width=stroke, stroke_fill=stroke_fill)


def _make_bg(bg_image: Path | None) -> Image.Image:
    """主配图 cover 填充 1080×1440，叠暖调暗化遮罩保证文字可读。"""
    if bg_image and Path(bg_image).exists():
        im = Image.open(bg_image).convert("RGB")
        scale = max(W / im.width, H / im.height)
        im = im.resize((int(im.width * scale), int(im.height * scale)))
        x, y = (im.width - W) // 2, (im.height - H) // 2
        im = im.crop((x, y, x + W, y + H))
    else:
        im = Image.new("RGB", (W, H), (46, 32, 20))
    return Image.blend(im, Image.new("RGB", (W, H), (24, 14, 7)), 0.46)


def _paste_book(canvas: Image.Image, book_image: Path, book_title: str) -> None:
    """右下角贴真实书封缩略 + 白边 + 书名小字。"""
    bk = Image.open(book_image).convert("RGB")
    bw = 236
    bh = int(bk.height * bw / bk.width)
    bk = bk.resize((bw, bh))
    bordered = Image.new("RGB", (bw + 12, bh + 12), "white")
    bordered.paste(bk, (6, 6))
    px, py = W - bw - 52, H - bh - 64
    canvas.paste(bordered, (px, py))
    d = ImageDraw.Draw(canvas)
    label = f"《{book_title}》"
    lw = d.textlength(label, font=_font(30))
    d.text((px + (bw - lw) / 2, py - 40), label, font=_font(30), fill="white",
           stroke_width=3, stroke_fill="black")


def render_cover(out_path: Path, layers: dict, bg_image: Path | None,
                 book_image: Path | None, book_title: str = "") -> Path:
    canvas = _make_bg(bg_image)
    draw = ImageDraw.Draw(canvas)

    # 顶部：目标人群（亮黄中字）
    y = 96
    for line in _wrap(layers["audience"], 14):
        _draw_center(draw, line, y, _font(60), "#FFD23F", 4, "#4a2f00")
        y += 76

    # 中部：痛点（特大白字粗黑边，视觉核心）
    y = 430
    for line in _wrap(layers["painpoint"], 9):
        _draw_center(draw, line, y, _font(104), "white", 10, "black")
        y += 132

    # 底部：结果/悬念（橙红圆角块衬底白字）
    rb = layers["result"]
    rf = _font(58)
    lines = _wrap(rb, 12)
    block_h = len(lines) * 76 + 36
    top = H - 360
    draw.rounded_rectangle([90, top, W - 90, top + block_h], radius=28, fill="#E8501E")
    yy = top + 18
    for line in lines:
        _draw_center(draw, line, yy, rf, "white")
        yy += 76

    if book_image and Path(book_image).exists():
        _paste_book(canvas, book_image, book_title)

    canvas.convert("RGB").save(out_path, quality=92)
    return out_path
