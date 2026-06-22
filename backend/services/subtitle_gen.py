from pathlib import Path
from typing import Callable

# 句末标点：遇到立即断句
_PUNCT_END = "。！？!?；;…"
# 句中软标点：达到最小字数后允许断句
_PUNCT_SOFT = "，、：,:"
# 仅在每条字幕的行首/行尾裁掉的句读/成对标点（保留书名号《》，它常是作品名的一部分）
_PUNCT_TRIM = "，。、；：,.;:!?！？…""\"'‘'（）()【】 "
# 到达 max_chars 硬限时，往前回退多少字寻找软标点做优雅断句
_LOOKBACK = 5
# 短语结尾语气词（的/了/得等），找不到软标点时退而求其次在此处断开
_PHRASE_END = "的了得地着过"


def generate(words: list[dict], task_dir: Path, log: Callable[[str], None]) -> None:
    groups = _group_words(words, max_chars=16, min_chars=6, max_duration=5.0)
    srt = _groups_to_srt(groups)
    (task_dir / "subtitles.srt").write_text(srt, encoding="utf-8")
    log(f"字幕生成完成，共 {len(groups)} 条（按标点断句）")


def _group_words(
    words: list[dict], max_chars: int, min_chars: int, max_duration: float
) -> list[list[dict]]:
    """按标点自然分句：句末标点必断，逗号类达到下限可断，过长/过久兜底切。"""
    groups: list[list[dict]] = []
    current: list[dict] = []
    chars = 0

    for word in words:
        current.append(word)
        chars += len(word["text"])

        has_end = any(c in _PUNCT_END for c in word["text"])
        has_soft = any(c in _PUNCT_SOFT for c in word["text"])
        too_long = chars >= max_chars
        too_slow = (word["end"] - current[0]["start"]) > max_duration

        if has_end:
            groups.append(current)
            current = []
            chars = 0
        elif too_long or too_slow:
            # 回退找最近的软标点，避免劈断自然短语
            split = _lookback_soft(current)
            if split is not None:
                groups.append(current[: split + 1])
                current = current[split + 1 :]
                chars = sum(len(w["text"]) for w in current)
            else:
                groups.append(current)
                current = []
                chars = 0
        elif has_soft and chars >= min_chars:
            groups.append(current)
            current = []
            chars = 0

    if current:
        groups.append(current)

    return groups


def _lookback_soft(items: list[dict], window: int = _LOOKBACK) -> int | None:
    """从 items 尾部往前找最近的软标点，返回其下标。找不到返回 None。"""
    for j in range(len(items) - 2, max(0, len(items) - window - 1), -1):
        if any(c in _PUNCT_SOFT for c in items[j].get("text", "")):
            return j
    return None


def _groups_to_srt(groups: list[list[dict]]) -> str:
    entries = []
    index = 1
    for group in groups:
        text = "".join(w["text"] for w in group).strip().strip(_PUNCT_TRIM).strip()
        if not text:
            continue
        start = _fmt(group[0]["start"])
        end = _fmt(group[-1]["end"])
        entries.append(f"{index}\n{start} --> {end}\n{text}")
        index += 1
    return "\n\n".join(entries)


def _fmt(seconds: float) -> str:
    h = int(seconds // 3600)
    m = int((seconds % 3600) // 60)
    s = int(seconds % 60)
    ms = int((seconds % 1) * 1000)
    return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"


# ============ 对标风格烧录字幕（ASS）============
# 大号黄字、居中、底部偏中、黑色描边，一句短口播一行——对标账号样式。

def build_ass(units: list[dict], ass_path: Path, *, width: int = 1080, height: int = 1920,
              max_chars: int = 11, fontsize: int = 120, margin_v: int = 350,
              fontname: str = "Microsoft YaHei") -> int:
    """units: [{text,start,end}]（cosyvoice 的分段 或 词级时间戳均可）。生成对标风格 ASS。"""
    chars = _chars_with_time(units)
    lines = _group_chars(chars, max_chars)
    events = []
    for line in lines:
        text = line["text"].strip().strip(_PUNCT_TRIM).strip()
        if not text:
            continue
        events.append(
            f"Dialogue: 0,{_ass_time(line['start'])},{_ass_time(line['end'])},Default,,0,0,0,,{text}"
        )
    ass = _ASS_HEADER.format(w=width, h=height, font=fontname, size=fontsize, mv=margin_v) + "\n".join(events) + "\n"
    ass_path.write_text(ass, encoding="utf-8")
    return len(events)


_ASS_HEADER = """[Script Info]
ScriptType: v4.00+
PlayResX: {w}
PlayResY: {h}
WrapStyle: 2
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,{font},{size},&H0000FFFF,&H000000FF,&H00000000,&H80000000,-1,0,0,0,100,100,1,0,1,5,1,2,80,80,{mv},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""


def _chars_with_time(units: list[dict]) -> list[dict]:
    """把任意 {text,start,end} 单元摊成逐字时间线（段内按字数均匀分布）。"""
    out: list[dict] = []
    for unit in units:
        text = str(unit.get("text", ""))
        start = float(unit.get("start", 0))
        end = float(unit.get("end", start))
        n = len(text) or 1
        step = (end - start) / n
        for i, ch in enumerate(text):
            out.append({"ch": ch, "start": start + i * step, "end": start + (i + 1) * step})
    return out


def _lookback_soft_char(chars: list[dict], window: int = _LOOKBACK) -> int | None:
    """从 chars 尾部往前找最近的软标点或短语结尾字，返回其下标。找不到返回 None。"""
    # 优先找软标点（逗号/顿号），其次找短语结尾字（的/了/得）
    for j in range(len(chars) - 2, max(0, len(chars) - window - 1), -1):
        if chars[j]["ch"] in _PUNCT_SOFT:
            return j
    for j in range(len(chars) - 2, max(0, len(chars) - window - 1), -1):
        if chars[j]["ch"] in _PHRASE_END:
            return j
    return None


def _group_chars(chars: list[dict], max_chars: int) -> list[dict]:
    """逐字时间线 → 对标风格短行（按标点断句，超长回退找软标点优雅断句）。"""
    lines: list[dict] = []
    buf: list[dict] = []
    for i, c in enumerate(chars):
        buf.append(c)
        ch = c["ch"]
        end_punct = ch in _PUNCT_END
        soft_punct = ch in _PUNCT_SOFT
        too_long = len(buf) >= max_chars

        if end_punct:
            lines.append({"text": "".join(x["ch"] for x in buf),
                          "start": buf[0]["start"], "end": buf[-1]["end"]})
            buf = []
        elif too_long:
            # 下一个是句末标点 → 等它进来再断，避免"布了一个"|"局。"孤行
            if i + 1 < len(chars) and chars[i + 1]["ch"] in _PUNCT_END:
                continue
            # 回退找最近的软标点或短语结尾字
            split = _lookback_soft_char(buf)
            if split is not None:
                lines.append({"text": "".join(x["ch"] for x in buf[:split + 1]),
                              "start": buf[0]["start"], "end": buf[split]["end"]})
                buf = buf[split + 1:]
            else:
                lines.append({"text": "".join(x["ch"] for x in buf),
                              "start": buf[0]["start"], "end": buf[-1]["end"]})
                buf = []
        elif soft_punct and len(buf) >= max(4, max_chars // 2):
            lines.append({"text": "".join(x["ch"] for x in buf),
                          "start": buf[0]["start"], "end": buf[-1]["end"]})
            buf = []

    if buf:
        lines.append({"text": "".join(x["ch"] for x in buf),
                      "start": buf[0]["start"], "end": buf[-1]["end"]})
    return lines


def _ass_time(seconds: float) -> str:
    h = int(seconds // 3600)
    m = int(seconds % 3600 // 60)
    s = seconds % 60
    return f"{h:d}:{m:02d}:{s:05.2f}"
