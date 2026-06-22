# -*- coding: utf-8 -*-
"""
BuilderPulse 每日海报生成器
抓取 https://github.com/BuilderPulse/BuilderPulse 当天更新的「今日构建机会」，
渲染成一张竖版海报 PNG（适合视频号 / 小红书 / 朋友圈）。

用法:
    python builderpulse_poster.py
输出:
    output/BuilderPulse-YYYY-MM-DD.png
"""

import os
import re
import sys
import textwrap
import datetime
import urllib.request

from PIL import Image, ImageDraw, ImageFont

# Windows 控制台默认 GBK，强制 stdout/stderr 用 UTF-8，避免 emoji/中文打印报错
for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8")
    except Exception:
        pass

# ---------------------------------------------------------------------------
# 配置
# ---------------------------------------------------------------------------
RAW_BASE = "https://raw.githubusercontent.com/BuilderPulse/BuilderPulse/main"
README_URL = f"{RAW_BASE}/README.md"
REPO_URL = "https://github.com/BuilderPulse/BuilderPulse"

HERE = os.path.dirname(os.path.abspath(__file__))
OUT_DIR = os.path.join(HERE, "output")

FONT_REG = r"C:\Windows\Fonts\msyh.ttc"    # 微软雅黑
FONT_BOLD = r"C:\Windows\Fonts\msyhbd.ttc"  # 微软雅黑 Bold

# 画布
W, H = 1080, 1440
MARGIN = 90
BG = (251, 247, 240)       # 米白
CARD = (255, 255, 255)
INK = (43, 33, 24)         # 深咖
SUB = (138, 127, 114)      # 暖灰
ACCENT = (234, 106, 30)    # 橙
ACCENT2 = (200, 148, 31)   # 琥珀


# ---------------------------------------------------------------------------
# 抓取 + 解析
# ---------------------------------------------------------------------------
def fetch(url: str) -> str:
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.read().decode("utf-8", "replace")


def parse_readme(md: str) -> dict:
    """从 README 的中文区块解析出当日内容。"""
    # 只取中文段
    zh = md.split('id="chinese"', 1)[-1]

    date = _search(r"今日建议\s*·\s*([^\n]+)", zh)
    idea = _search(r">\s*\*\*(.+?)\*\*", zh)
    why = _search(r"\*\*为什么是现在[:：]\*\*\s*(.+)", zh)
    report = _search(r"(zh/\d{4}/\d{4}-\d{2}-\d{2}\.md)", zh)

    return {
        "date": (date or "").strip(),
        "idea": (idea or "").strip(),
        "why": _clean(why or ""),
        "report_path": (report or "").strip(),
    }


def parse_daily(md: str) -> dict:
    """从当日 zh 报告里解析 2 小时构建名 + Top 信号。"""
    build_name = _search(r"今日 2 小时构建\s*\n+\s*\*\*(.+?)\*\*", md)
    # Top 3 信号第一条
    top1 = _search(r"今日 Top 3 信号\s*\n+\s*1\.\s*(.+)", md)
    return {
        "build_name": (build_name or "").strip(),
        "top1": _clean(top1 or ""),
    }


def _search(pattern: str, text: str):
    m = re.search(pattern, text)
    return m.group(1) if m else None


def _clean(s: str) -> str:
    """去掉 markdown 链接/反引号/强调标记，保留纯文本。"""
    s = re.sub(r"\[([^\]]+)\]\([^)]+\)", r"\1", s)  # [text](url) -> text
    s = s.replace("`", "").replace("**", "").replace("*", "")
    return s.strip()


# ---------------------------------------------------------------------------
# 渲染辅助
# ---------------------------------------------------------------------------
def font(path: str, size: int) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(path, size)


def wrap_cjk(draw, text: str, fnt, max_w: int):
    """按像素宽度对中英文混排做断行。"""
    lines, line = [], ""
    for ch in text:
        if ch == "\n":
            lines.append(line)
            line = ""
            continue
        if draw.textlength(line + ch, font=fnt) <= max_w:
            line += ch
        else:
            lines.append(line)
            line = ch
    if line:
        lines.append(line)
    return lines


def draw_block(draw, text, fnt, x, y, max_w, fill, line_gap=14, max_lines=None):
    lines = wrap_cjk(draw, text, fnt, max_w)
    if max_lines and len(lines) > max_lines:
        lines = lines[:max_lines]
        lines[-1] = lines[-1][:-1] + "…"
    lh = fnt.size + line_gap
    for i, ln in enumerate(lines):
        draw.text((x, y + i * lh), ln, font=fnt, fill=fill)
    return y + len(lines) * lh


# ---------------------------------------------------------------------------
# 主流程
# ---------------------------------------------------------------------------
def build_poster(data: dict, daily: dict) -> str:
    os.makedirs(OUT_DIR, exist_ok=True)

    img = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(img)

    f_brand = font(FONT_BOLD, 40)
    f_date = font(FONT_REG, 30)
    f_kicker = font(FONT_BOLD, 30)
    f_idea = font(FONT_BOLD, 60)
    f_label = font(FONT_BOLD, 34)
    f_body = font(FONT_REG, 36)
    f_foot = font(FONT_REG, 26)

    # 顶部品牌条
    d.rectangle([0, 0, W, 150], fill=INK)
    d.text((MARGIN, 52), "BuilderPulse", font=f_brand, fill=(255, 255, 255))
    date_txt = data["date"] or datetime.date.today().strftime("%m月%d日")
    dw = d.textlength(date_txt, font=f_date)
    d.text((W - MARGIN - dw, 60), date_txt, font=f_date, fill=(190, 178, 160))

    # 卡片
    cx0, cy0, cx1, cy1 = MARGIN, 210, W - MARGIN, H - 150
    d.rounded_rectangle([cx0, cy0, cx1, cy1], radius=28, fill=CARD)

    inner_x = cx0 + 56
    inner_w = (cx1 - cx0) - 112
    y = cy0 + 56

    # kicker（用实心圆点代替 emoji，微软雅黑不含彩色 emoji 会显示豆腐块）
    d.ellipse([inner_x, y + 6, inner_x + 20, y + 26], fill=ACCENT)
    d.text((inner_x + 34, y), "今日构建机会", font=f_kicker, fill=ACCENT)
    y += 56

    # 今日 build idea（主标题）
    idea = data["idea"] or daily.get("build_name") or "（今日内容获取失败）"
    y = draw_block(d, idea, f_idea, inner_x, y, inner_w, INK, line_gap=18, max_lines=4)
    y += 30

    # 英文构建名（副标题）
    if daily.get("build_name"):
        y = draw_block(d, daily["build_name"], font(FONT_REG, 32),
                       inner_x, y, inner_w, SUB, line_gap=10, max_lines=2)
        y += 24

    # 分隔线
    d.line([inner_x, y, inner_x + inner_w, y], fill=(232, 235, 240), width=2)
    y += 40

    # 为什么是现在
    d.text((inner_x, y), "为什么是现在", font=f_label, fill=ACCENT2)
    y += 52
    if data["why"]:
        y = draw_block(d, data["why"], f_body, inner_x, y, inner_w, INK,
                       line_gap=16, max_lines=5)
    y += 36

    # 关键信号
    if daily.get("top1"):
        d.text((inner_x, y), "关键信号", font=f_label, fill=ACCENT)
        y += 52
        y = draw_block(d, daily["top1"], f_body, inner_x, y, inner_w, INK,
                       line_gap=16, max_lines=5)

    # 底部信号源（控制成单行，避免与网址重叠）
    foot1 = "信号源 · 横扫 Hacker News / Product Hunt / GitHub / Reddit 等 10+ 来源"
    d.text((MARGIN, H - 100), foot1, font=f_foot, fill=SUB)
    d.text((MARGIN, H - 56), REPO_URL, font=f_foot, fill=ACCENT)

    fname = f"BuilderPulse-{datetime.date.today().isoformat()}.png"
    out = os.path.join(OUT_DIR, fname)
    img.save(out, "PNG")
    return out


def main():
    try:
        readme = fetch(README_URL)
    except Exception as e:
        print(f"[ERROR] 抓取 README 失败: {e}", file=sys.stderr)
        sys.exit(1)

    data = parse_readme(readme)

    daily = {}
    if data["report_path"]:
        try:
            daily = parse_daily(fetch(f"{RAW_BASE}/{data['report_path']}"))
        except Exception as e:
            print(f"[WARN] 抓取当日报告失败，仅用 README 内容: {e}", file=sys.stderr)

    print("解析结果:")
    print("  日期:", data["date"])
    print("  今日建议:", data["idea"])
    print("  为什么是现在:", data["why"][:60], "...")
    print("  构建名:", daily.get("build_name"))

    out = build_poster(data, daily)
    print(f"\n✅ 海报已生成: {out}")


if __name__ == "__main__":
    main()
