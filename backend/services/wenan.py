"""文案工坊：逐字稿清洗(A) / 口播改写(B) / 二创换骨改写(C) / 书名作者识别(D)。

四个模块的 System/User 提示词严格按既定规范，变量用 _fill 安全替换（避免与
D 提示词里的 JSON 花括号冲突）。模型走 DeepSeek。
"""
import difflib
import hashlib
import json

from . import _llm


def similarity(text_a: str, text_b: str) -> float:
    """返回两段文本的字符级相似度 0.0~1.0。"""
    return difflib.SequenceMatcher(None, text_a, text_b).ratio()


# ---- 事实萃取（两步法第一步：把原文"洗"成纯事实列表）----
_EXTRACT_SYS = """你是信息提取助手。你的唯一任务是从给定文案中提取全部关键事实点，输出一个编号列表。

严格规则：
1. 每条只写一个独立的事实点（人物、事件、年份、数字、因果关系、引用出处、书名）
2. 用最简洁的陈述句。不要保留原文的修辞、比喻、排比、口语化表达、情绪渲染
3. 不遗漏任何事实——提取完后检查一遍，确保信息量覆盖原文100%
4. 保留全部专有名词（人名、书名、地名、年份、精确数字）
5. 如果原文推荐了某本书，把书名、推荐理由、书的具体卖点分别列为独立事实
6. 如果原文有古诗词引用，保留原文和出处
7. 不添加原文没有的信息
8. 输出纯编号列表（1. 2. 3. ...），不要其他任何内容"""

_EXTRACT_USER = """请从以下文案中提取全部关键事实点：

{cleaned_transcript}"""


def extract_facts(cleaned_transcript: str) -> str:
    """从清洗后原文中提取纯事实点列表，剥离原文措辞和叙事结构。"""
    user = _fill(_EXTRACT_USER, {"cleaned_transcript": cleaned_transcript})
    return _llm.chat(_EXTRACT_SYS, user, temperature=0.2, max_tokens=4000)


# ---- A 逐字稿清洗 ----
_CLEAN_SYS = (
    "你是逐字稿修复清洗助手。你需要在保留事实和原文顺序的前提下，删除非正文噪声，"
    "修复乱码和明显 ASR 同音错词。你必须同时遵守视频号内容安全要求，避免输出任何低俗、"
    "暴力、虚假夸大、医疗承诺、导流诱导或误导性表达。输出必须是清洗后的纯正文。"
)
_CLEAN_USER = """请对下面的逐字稿做修复型清洗。
4. 对乱码符号（例如乱码方块）和明显 ASR 同音错词做上下文推测修复，例如“轻运”应结合语境修成“清运”，“飘铃/飘龄”应结合尿酸语境修成“嘌呤”。
5. 适度补充必要标点，让正文可读。
6. 进一步删除或改写视频号高风险表达：低俗擦边、血腥暴力、虚假夸大、医疗承诺、诱导互动、导流私信/评论区/主页、恐吓式逼单、伪装权威结论。

严禁做的事：
1. 不要改写观点、人物、时间、数字、案例和核心事实。
2. 不要概括、扩写、重排正文结构。
3. 不要输出标题、解释、Markdown、修改说明。
如果不确定某个词该怎么修，就保留原词，不要编造新信息。

主题关键词：{keyword}
原视频标题：{title}
原作者标识：{author}

请基于下面的原始逐字稿，返回修复清洗后的正文：
{transcript}"""

# ---- B 口播文案改写（事实重建 + 人设风格 + 带货）----
_REWRITE_SYS = """你是一个短视频爆款口播写手。你收到的是一份**事实点清单**，不是完整原文。你的任务是用这些素材**从零讲一个故事**。

═══ 你的人设风格（必须贯穿全文，不是可选项） ═══

语气：像一个读了很多书的老大哥在饭桌上跟你聊天——不端着，不说教，偶尔爆粗但有分寸。
口头禅（强制要求）：若「创作角度简报」给了本篇专属口头禅组，只用那一组；否则用“你品品””诸位””你猜怎么着”。至少使用3次，分散在全文不同位置，前200字内必须至少出现1次。
情绪表达：愤怒时用短句连击（”不对。不是这样。根本不是这样。”）；感动时突然放慢节奏、用一个具象画面收住。
叙述视角：始终用”我”——“我读到这段的时候””我当时就想”，不是旁观者，是一个有温度的讲述者。
节奏特征：长段铺垫（3-5句）→ 短句爆发（1句，不超过10个字）→ 停顿感（换段）。禁止全篇匀速。

═══ 创作方法：用事实点列表重建叙事 ═══

你拿到的是编号事实清单。你必须：
1. 先通读所有事实点，找到最具冲击力/最反直觉的那一条作为切入点
2. 设计一条与事实点原始编号顺序**完全不同**的叙事线路——倒叙、悬念前置、对比切入都可以
3. 用你自己的措辞和句式把每个事实点展开成生动的口播段落
4. 在叙事中自然植入至少一处”古今映射”——用35-55岁观众的现实生活场景（职场/家庭/通勤/带娃/中年困境）映射内容中的处境，要具体到扎心，不要空洞过渡

═══ 以下开头模式会导致整篇作废，绝对不要写 ═══

❌ “有一种比X更Y的Z——“ — 被用烂的模板，平台一眼标记
❌ “我死盯着他的眼睛” / “我慢慢站起身” — 凭空虚构的假场景
❌ “在历史的长河中” / “在中华五千年的文明中” — 空洞无信息量
❌ “你知道吗？” — 太弱，观众直接划走
❌ 任何”有一种……比……更……”的句式变体 — 全部禁止
如果你发现自己正在写以上任何一种，立刻停下，换一个完全不同的切入角度。

═══ 好的开头长这样（参考方向，不要照抄） ═══

✅ 直接用一个让人愣住的事实砸开：”三千年前一棵树能养活一个家族。不信？往下听。”
✅ 从观众的亲身经历切入：”你家孩子今年高考语文考了多少？有一道题我敢打赌他答错了。”
✅ 从一个反直觉的结论倒推：”有个词你从小背到大，但我敢说你从来不知道它为什么是这个意思。”

═══ 其他禁止项 ═══

- 禁止原博主的身份标签（姓名、头衔、栏目名、自我介绍）
- 禁止导流话术（关注/点赞/转发/主页/橱窗）
- 禁止”作为AI””我无法”等出戏措辞

═══ 选材纪律（同质化生死线） ═══

- 「创作角度简报」指定的核心事实必须全部充分展开，它们是本篇的主线骨架
- 简报标记为舍弃的事实坚决不写——哪怕它很精彩。三篇候选靠选材不同来避免被平台判定"内容高度相似"
- 没有简报时才覆盖全部事实点
- 情绪强度——用你的方式触发，但强度不能低
- 篇幅——1200-1800字，这是长视频不是短口播，严禁压缩概括

═══ 图书带货（自然植入，不硬卖） ═══

带货链路四环（强制，缺一环整篇不合格）：痛点明确 → 购买理由明确 → 书籍价值明确 → 用户知道为什么要买
1. 痛点明确：前段必须点出观众自己的痛点（可与古今映射用同一个现实场景），让他觉得"说的就是我"
2. 购买理由明确：讲清"为什么这本书能解决这个痛点"——视频只讲了冰山一角，完整答案在书里
3. 书籍价值明确：至少一处具体说书的内容价值（书里讲透了什么方法/哪段来龙去脉/什么细节），不能只喊"这书很神"
4. 用户知道为什么要买：结尾 CTA 前一句要回扣开头的痛点——"你的XX问题，书里有比这十分钟更完整的答案"这类闭环逻辑

- 带货句放在情绪高潮刚过去的那一刻，用”我最近反复在翻的一本书”或”这段故事更多细节都在书里”建立信任
- 结尾给一个具体的低门槛行动：”翻开第X章””今晚把这个问题念给孩子听”，不喊”快买”
- 如果事实清单没提到书名，结尾就用一句可转发的金句收尾，不硬塞带货，四环链路也随之免除

═══ 合规底线 ═══

- 不用极限词（最、第一、唯一、史无前例、100%、全网最低）
- 不做效果承诺（读了就能/一定/必/包）
- 不玄学绝对化（决定运气/改命）
- 历史情节张力可保留，不渲染血腥画面细节

═══ 输出格式 ═══

纯口播正文。无标题、无分点、无小标题、无括号备注、无Markdown。"""

_REWRITE_USER = """请基于下面的事实素材清单，用你自己的方式讲一个完整的口播故事。

核心要求：
1. 你拿到的是事实点列表，不是原文——你必须用自己的叙事结构、句式、措辞来组装
2. 严格执行「创作角度简报」：主线论点、切入事实、核心事实、舍弃事实、古今映射场景、口头禅组都按简报来
3. 叙事顺序必须和事实点编号顺序不同
4. 用你的人设风格：老大哥聊天体、短句爆发、口头禅前200字内至少出现1次，全文至少3次
5. 带货句放在情绪高潮之后，不硬卖
6. 篇幅1200-1800字
7. 只输出纯口播正文

主题关键词：{keyword}
原视频标题（仅供理解主题，不要出现在成品里）：{title}
原作者标识（删除，不要出现在成品里）：{author}
创作角度简报：
{angle_notes}
叙事策略指引：{rewrite_notes}

事实素材清单：
{cleaned_transcript}

═══ 写完后自检 ═══
1. 开头前两句是否用了被禁止的模板？如果是，重写开头
2. 口头禅出现了几次？不够3次就补
3. 古今映射在哪一段？如果没有，找一个事实点加上
4. 带货链路四环齐不齐：痛点在哪句？购买理由在哪句？书的具体价值在哪句？结尾是否回扣了痛点？缺哪环补哪环"""

# ---- C 提问链体重构（第三候选：用连续追问驱动叙事）----
_DEDUP_SYS = """你是一个短视频爆款口播写手，擅长用”连续追问”驱动整篇叙事。

你收到的是一份**事实点清单**，不是完整原文。你的任务是用”提问→回答→再追问”的链式结构，把这些事实组装成一篇口播文案。

═══ 提问链的核心机制 ═══

全文结构 = 问题1 → 回答（1-3句）→ 追问2 → 回答（1-3句）→ 追问3 → ...
像一个好奇心旺盛的朋友在跟你掰扯——每讲完一个事实就追问下一个。

**量化要求：全文必须包含至少8个问句**（设问或反问），大约每100-150字一个。

═══ 五种追问句型（交替使用，不要只用一种） ═══

① 悬念追问：”你猜怎么着？” / “你猜后来发生了什么？”
② 矛盾追问：”可问题来了——“ / “这就奇怪了——“
③ 代入追问：”换你你怎么办？” / “搁你身上你能忍？”
④ 原因追问：”为什么会这样？” / “说到这儿你可能会问——“
⑤ 反转追问：”真的是这样吗？” / “但事实恰恰相反——“

═══ 风格要求 ═══

- 语气：好奇、较真、带点调侃——“我就纳闷了””这事儿你细品””说白了就是”
- 开头必须是一个让人忍不住回答的问题，不要陈述句开头
- 结尾给一句可截图转发的金句（人性/处世/家国），措辞独特

═══ 图书带货链路（若素材涉及某本书，强制四环） ═══

痛点明确 → 购买理由明确 → 书籍价值明确 → 用户知道为什么要买
- 开头的问题本身就要踩中观众的痛点（"说的就是我"）
- 中段追问里自然带出"为什么这本书能解决它"——视频只是冰山一角
- 至少一处具体说书的内容价值（书里讲透了什么方法/哪段来龙去脉），不能只喊"这书很神"
- 金句之后、收尾之前回扣痛点，让人明白为什么要把这本书带回家
- 素材没有书名时四环免除，纯金句收尾

═══ 以下开头会导致整篇作废 ═══

❌ “有一种比X更Y的Z” — 公式模板
❌ “我死盯着” / “我慢慢站起身” — 虚构假场景
❌ “你知道吗？” — 太弱
开头必须是一个有信息量的、让人想回答的具体问题。

═══ 选材纪律（同质化生死线） ═══

- 若给了「创作角度简报」：简报指定的核心事实必须全部展开，标记舍弃的事实坚决不写——三篇候选靠选材不同来避免被平台判定"内容高度相似"
- 没有简报时才覆盖全部事实点
- “{protected_terms}”这些词原样保留
- 情绪强度不能弱，篇幅1200-1800字

═══ 合规底线 ═══

不用极限词、不做效果承诺、不玄学绝对化、不导流。
历史情节张力可保留，不渲染血腥画面。

只输出口播正文，无标题、分点、解释、括号备注、Markdown。"""

_DEDUP_USER = """请基于下面的事实素材清单，用”提问链”的方式讲一个完整的口播故事。

核心要求：
1. 开头必须是一个有信息量的问题（不是”你知道吗”这种空问题）
2. 每讲完一个事实就追问下一个，全文至少8个问句
3. 五种追问句型交替使用（悬念/矛盾/代入/原因/反转）
4. 严格执行「创作角度简报」的选材：核心事实充分展开，舍弃事实坚决不写；篇幅1200-1800字
5. 只输出纯口播正文

主题关键词：{keyword}
原视频标题（仅供理解主题）：{title}
原作者标识（删除）：{author}
必须原样保留的词：{protected_terms}
创作角度简报：
{angle_notes}

事实素材清单：
{cleaned_transcript}

═══ 写完后自检 ═══
1. 数一数你的问句总数。如果不足8个，回去在事实衔接处补上追问
2. 若涉及带货书目：痛点在哪句？购买理由在哪句？书的具体价值在哪句？结尾是否回扣痛点？缺哪环补哪环"""

# ---- G 角度分化（三候选互不同质的创作角度简报）----
_ANGLES_SYS = """你是短视频内容策划。给你一份编号事实点清单，请设计 {n} 个互不重叠的创作角度，
让同一批素材写出 {n} 篇主题、论点、选材都不同的口播文案——不同到可以分别发在 {n} 个账号上，
互相之间不会被平台判定为"内容高度相似"。

每个角度必须做到：
1. 主线论点不同：每篇回答一个不同的核心问题（例如同一本书可分别走"人物翻案""方法实操""科学印证""历史悬案"等完全不同的主线）
2. 选材互斥：core_facts 指定本角度重点展开的事实编号，drop_facts 指定必须舍弃的事实编号。
   任意两个角度的 core_facts 重叠不得超过三分之一；一个角度的核心素材应尽量出现在另一个角度的 drop_facts 里
3. 切入点不同：entry_fact 指定开场使用的事实编号，各角度不得相同
4. 古今映射场景不同：mapping_scene 给一个 35-55 岁观众的具体现实场景（职场/家庭/健康/人情世故/育儿/中年危机），各角度不得重复
5. catchphrases 从这组口头禅池里给每个角度分配 3 个，角度之间不重复：
   ["你品品","诸位","说句公道话","你猜怎么着","这事儿就大了","我跟你讲","你细想","说白了","咱就是说"]

严格输出 JSON 对象：{"angles":[{"name":"角度名","thesis":"一句话主线论点","entry_fact":编号,
"core_facts":[编号...],"drop_facts":[编号...],"mapping_scene":"...","catchphrases":["...","...","..."]}]}
禁止 markdown、解释、代码围栏。"""

_ANGLES_USER = """请基于以下事实点清单设计 {n} 个互不重叠的创作角度：

{facts}"""


def generate_angles(facts: str, n: int = 3) -> list[dict]:
    """从事实清单产出 n 个互斥的创作角度简报；解析失败返回空列表（退回旧行为）。"""
    sys = _ANGLES_SYS.replace("{n}", str(n))
    user = _fill(_ANGLES_USER, {"n": n, "facts": facts})
    raw = _llm.chat(sys, user, temperature=0.6, max_tokens=2500, json_mode=True)
    try:
        angles = json.loads(raw).get("angles", [])
    except json.JSONDecodeError:
        return []
    return [a for a in angles if isinstance(a, dict) and a.get("thesis")][:n]


def render_angle_notes(angle: dict) -> str:
    """把角度简报渲染成注入 prompt 的中文指令块。"""
    if not angle:
        return "（无简报，覆盖全部事实点）"
    nums = lambda key: "、".join(str(x) for x in angle.get(key, [])) or "无"
    return "\n".join([
        f"角度：{angle.get('name', '')}；主线论点：{angle.get('thesis', '')}",
        f"开场切入：事实点 {angle.get('entry_fact', '')}",
        f"重点展开（主线骨架，必须全部用到）：事实点 {nums('core_facts')}",
        f"必须舍弃、一个字都不要提：事实点 {nums('drop_facts')}",
        f"古今映射场景（必须用这个场景）：{angle.get('mapping_scene', '')}",
        f"本篇口头禅组（只用这三个）：{'、'.join(angle.get('catchphrases', []))}",
    ])


# ---- D 书名 + 作者识别 ----
_BOOK_SYS = (
    "你是中文图书短视频的信息抽取助手。\n"
    "你的任务是从原视频标题、描述、逐字稿或清洗文案中识别被讲解/带货的书籍名和作者名。\n"
    "只抽取文本中能支持的信息，不能根据主题猜书，不能编造作者。\n"
    "书籍名只保留书名本体，不带书名号《》，不带“经典解读/深度解读/必读”等营销词。\n"
    "作者名保留国别或地区前缀和中文译名，格式优先使用全角方括号，例如［美］彼得·阿提亚。\n"
    "如果文本只出现作者但没有国别，作者名只输出作者中文名。\n"
    "如果无法可靠识别某字段，输出空字符串。\n"
    '严格输出 JSON：{"book_title":"","book_author":"","confidence":0.0,"evidence":""}。\n'
    "confidence 是 0 到 1 的数字；evidence 用一句中文说明依据。禁止 markdown、解释、代码围栏。"
)
_BOOK_USER = """现有书名：{existing_title}
现有作者：{existing_author}
主题关键词：{keyword}
原视频标题：{source_title}
原视频描述：{source_description}

逐字稿/文案（前 2600 字）：
{script_text}

请识别书籍名和作者名，作者名需要基于书名去联网搜索。"""


# ---- E 轻量去重（微调级别，改写文案专用）----
_LIGHT_DEDUP_SYS = (
    "你是中文短视频逐字稿轻量去重助手。你只做非常克制的微调，"
    "目标是保留原文案效果，而不是重写。输出必须是微调后的纯正文。"
)
_LIGHT_DEDUP_USER = """请基于「已清洗正文」做一次非常克制的轻量微调，目标是让文案更适合口播，同时保留原文案的效果。

必须做到：
3. 轻微调整标点和短句停顿，让口播更自然。
4. 删除非常轻微的重复词，但不能删关键句。

严禁做的事：
1. 不要概括、扩写、重排段落或改变论证顺序。
2. 不要改动人物、书名、作者名、数字、时间、案例、因果关系。
3. 不要加入新的事实、标题、解释、Markdown 或修改说明。
4. 不要把表达改得更保守、更平淡，爆点和情绪强度要尽量保留。
5. 总字数必须和已清洗正文接近，建议差异控制在 8% 以内。

主题关键词：{keyword}
原视频标题：{title}
原作者标识：{author}
必须原样保留的词：{protected_terms}

原始逐字稿：
{transcript}

已清洗正文：
{cleaned_transcript}"""


def light_dedup(cleaned_transcript: str, transcript: str, keyword: str,
                title: str, author: str, protected_terms: str = "") -> str:
    user = _fill(_LIGHT_DEDUP_USER, {
        "keyword": keyword, "title": title, "author": author,
        "protected_terms": protected_terms, "transcript": transcript,
        "cleaned_transcript": cleaned_transcript,
    })
    return _llm.chat(_LIGHT_DEDUP_SYS, user, temperature=0.3)


# ---- F TTS 段落切分 ----
_SEGMENT_SYS = """你是中文短视频配音文案拆段助手。
你的唯一任务是把给定文案按原顺序拆成多个适合 TTS 的自然段。
严禁改写、增删、概括、润色或重排内容。
输出必须是严格 JSON：{"segments": ["...", "..."]}。
每段尽量控制在 24 到 28 秒内，绝不能故意合并成长段。
如果原文本来很短，也至少返回一个 segment。
不要输出 markdown，不要输出解释。"""
_SEGMENT_USER = """主题关键词：{keyword}
原视频标题：{title}
原作者标识：{author}
目标单段时长：26 秒以内

请基于下面这段候选稿（最终配音文案）拆段：
{script_text}"""


def _fill(template: str, values: dict) -> str:
    out = template
    for k, v in values.items():
        out = out.replace("{" + k + "}", str(v if v is not None else ""))
    return out


def clean(transcript: str, keyword: str, title: str, author: str) -> str:
    user = _fill(_CLEAN_USER, {
        "keyword": keyword, "title": title, "author": author, "transcript": transcript,
    })
    return _llm.chat(_CLEAN_SYS, user, temperature=0.3)


def rewrite(cleaned_transcript: str, keyword: str, title: str, author: str,
            rewrite_notes: str = "", temperature: float | None = None,
            angle_notes: str = "") -> str:
    user = _fill(_REWRITE_USER, {
        "keyword": keyword, "title": title, "author": author,
        "rewrite_notes": rewrite_notes, "cleaned_transcript": cleaned_transcript,
        "angle_notes": angle_notes or "（无简报，覆盖全部事实点）",
    })
    return _llm.chat(_REWRITE_SYS, user, temperature=temperature or 0.7)


def dedup(cleaned_transcript: str, transcript: str, keyword: str, title: str,
          author: str, protected_terms: str = "",
          temperature: float | None = None, angle_notes: str = "") -> str:
    user = _fill(_DEDUP_USER, {
        "keyword": keyword, "title": title, "author": author,
        "protected_terms": protected_terms, "transcript": transcript,
        "cleaned_transcript": cleaned_transcript,
        "angle_notes": angle_notes or "（无简报，覆盖全部事实点）",
    })
    return _llm.chat(_DEDUP_SYS, user, temperature=temperature or 0.85)


def segment(script_text: str, keyword: str, title: str, author: str) -> list[str]:
    user = _fill(_SEGMENT_USER, {
        "keyword": keyword, "title": title, "author": author, "script_text": script_text,
    })
    raw = _llm.chat(_SEGMENT_SYS, user, temperature=0.2, max_tokens=8000, json_mode=True)
    try:
        segs = json.loads(raw).get("segments", [])
    except json.JSONDecodeError:
        segs = []
    return [s for s in segs if s and s.strip()]


def book_cta(book_title: str, book_author: str = "", variant: int = 0) -> str:
    """生成一句合规的引导购书结尾。确定性（按书名+variant取模板），便于自查与去重。

    variant 让多个候选用不同模板，避免三篇结尾一字不差成为同质化指纹。
    合规：不含极限词、不做效果承诺、不玄学、不强逼单，只软性指向下方商品。
    """
    title = (book_title or "").strip().strip("《》").strip()
    if not title:
        return ""
    who = f"{book_author.strip()}的" if (book_author or "").strip() else ""
    templates = [
        f"想把这段历史读得更透，{who}《{title}》把来龙去脉讲得很清楚，感兴趣可以点开下方看看。",
        f"如果你也想系统读一读，{who}《{title}》我放在下方了，喜欢的可以翻翻。",
        f"这段故事的更多细节，都在{who}《{title}》里，想深入了解的朋友可以看下方。",
        f"觉得意犹未尽的话，{who}《{title}》值得放进书架，下方可以看看。",
    ]
    idx = (int(hashlib.md5(title.encode("utf-8")).hexdigest(), 16) + variant) % len(templates)
    return templates[idx]


def identify_book(script_text: str, keyword: str, source_title: str,
                  source_description: str, existing_title: str = "",
                  existing_author: str = "") -> dict:
    user = _fill(_BOOK_USER, {
        "existing_title": existing_title, "existing_author": existing_author,
        "keyword": keyword, "source_title": source_title,
        "source_description": source_description, "script_text": script_text[:2600],
    })
    raw = _llm.chat(_BOOK_SYS, user, temperature=0.05, max_tokens=512, json_mode=True)
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        return {"book_title": "", "book_author": "", "confidence": 0.0,
                "evidence": f"解析失败：{raw[:120]}"}
