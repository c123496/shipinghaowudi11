export interface HumanizeSettings {
  videoDuration: '5-8' | '8-12';
  genre: 'auto' | 'history' | 'health' | 'education' | 'business' | 'book' | 'other';
  targetAudience: string;
  persona: string;
  isCommerce: boolean;
  productName: string;
  bannedWords: string;
  retainViralPoints: boolean;
  conversionStrength: 'weak' | 'medium' | 'strong';
  toneStyle: string;
  platform: string;
}

export const DEFAULT_SETTINGS: HumanizeSettings = {
  videoDuration: '5-8',
  genre: 'auto',
  targetAudience: '35-60岁以上，北上广/江浙沪高知人群',
  persona: '26岁男性读书博主，年轻但说话稳，有判断，有分寸，不油腻，不装专家',
  isCommerce: false,
  productName: '',
  bannedWords: '',
  retainViralPoints: true,
  conversionStrength: 'medium',
  toneStyle: 'chat+steady',
  platform: 'wechat',
};

const TONE_MAP: Record<string, string> = {
  steady: '稳重叙述，像有阅历的老友在认真说一件事',
  chat: '老友聊天，轻松自然，像跟朋友坐在茶桌前闲聊',
  emotion: '情绪共鸣，语气起伏明显，有真情实感',
  deep: '深度认知，理性分析但不枯燥，带点思辨的味道',
  'chat+steady': '老友聊天为主，偶尔切入稳重叙述，轻松但不轻浮',
};

const GENRE_STRATEGY: Record<string, string> = {
  history: `题材策略【历史人物类】：
- 核心叙事线：人物命运 → 时代转折 → 人性选择 → 认知落点
- 开头用一个反常识的历史细节钩住观众
- 中段讲人物处境时，要加入"如果是我会怎么选"的代入感
- 不要变成教科书式叙述，要有温度、有观点、有立场
- 结尾落到当下：这段历史对今天的我们意味着什么`,
  health: `题材策略【健康养生类】：
- 核心叙事线：生活场景共鸣 → 中年焦虑 → 温和建议 → 避免医疗化
- 从身边真实场景切入，不要一上来就讲原理
- 语气要温和，不吓唬人，不制造焦虑
- 不要出现"治疗""治愈""疗效"等医疗化用词
- 建议要具体可操作，但要说"仅供参考""因人而异"`,
  education: `题材策略【教育家庭类】：
- 核心叙事线：父母焦虑 → 真实案例 → 反思 → 克制表达
- 从家长最关心的痛点切入（成绩、升学、亲子关系）
- 讲真实案例时不要极端化，要让人有代入感
- 观点表达要克制，不煽动对立，不贩卖焦虑
- 结尾给方向，但不给标准答案`,
  business: `题材策略【商业认知类】：
- 核心叙事线：反常识观点 → 现实困境 → 方法论 → 不像课程广告
- 开头用一个反直觉的数据或现象冲击认知
- 分析时要有逻辑链，但不要像MBA课堂
- 可以有方法论，但不要写成"三步教你xxx"
- 不要用"底层逻辑""认知升级""赋能"等AI味词汇`,
  book: `题材策略【书籍带货类】：
- 前80%绝不提书名，先讲故事、人物、处境、认知、情绪
- 最后20%才自然出现书名，过渡要丝滑不生硬
- 推荐理由要从"我读了之后的真实感受"出发
- 不要写"强烈推荐""必读""人生必看"等硬推词
- 转化段要像"顺带提一嘴我最近在看的一本书"的感觉`,
  other: `题材策略【通用类】：
- 用故事和场景代替说理
- 加入个人观点和情感，不做中立播报
- 节奏要有变化，长短句交替
- 结尾留有余味，不要强行总结`,
};

function getGenreStrategy(genre: string): string {
  return GENRE_STRATEGY[genre] || GENRE_STRATEGY.other;
}

function getWordRange(duration: string): string {
  return duration === '8-12' ? '2500-3500字' : '1500-2200字';
}

function buildBannedWordsSection(bannedWords: string): string {
  if (!bannedWords.trim()) return '';
  const words = bannedWords
    .split(/[,，\n]+/)
    .map(w => w.trim())
    .filter(Boolean);
  if (words.length === 0) return '';
  return `\n\n## 禁用词（绝对不能出现在输出中）\n${words.map(w => `- "${w}"`).join('\n')}`;
}

function buildConversionSection(settings: HumanizeSettings): string {
  const strengthMap: Record<string, string> = {
    weak: '转化力度弱：只在结尾很轻地带一下，几乎感觉不到在推东西',
    medium: '转化力度中等：前80%纯内容价值，最后20%自然过渡到产品/书籍',
    strong: '转化力度强：内容全程暗示价值，结尾转化段有明确的行动引导，但不要硬卖',
  };
  const parts: string[] = [];
  parts.push(`转化强度：${strengthMap[settings.conversionStrength] || strengthMap.medium}`);
  if (settings.isCommerce) {
    parts.push(`是否带货：是`);
    if (settings.productName) {
      parts.push(`带货产品/书名：《${settings.productName}》`);
    }
  }
  if (settings.retainViralPoints) {
    parts.push('保留策略：保留原文的爆款功能位（钩子、冲突、转折、情绪点），但换表达路径，不逐句照抄');
  }
  return parts.join('\n');
}

export const HUMANIZE_SYSTEM = `你是"人性化改写工作台"的核心引擎。你的任务是把一段输入文案改写成适合微信视频号长视频口播的真人感文稿。

## 输出格式要求
你必须且只能返回一个合法的 JSON 对象，不要返回任何 JSON 之外的内容。不要用 markdown 代码块包裹。直接输出 JSON。

## 总规则
1. 平台：微信视频号，长视频口播
2. 目标：真人感、老友聊天、有温度有观点
3. 必须大幅降低AI味和重复感
4. 不逐句洗稿，不做同义词替换
5. 保留爆款功能位，但换表达路径
6. 前80%讲故事、人物、处境、认知、情绪；最后20%才自然转到书籍或产品
7. 不要写成作文，不要写成AI总结
8. 禁止使用以下AI味表达：首先、其次、最后、总而言之、在这个快节奏的时代、值得注意的是、底层逻辑、赋能、认知升级、让我们一起、综上所述、毫无疑问、不容忽视、显而易见、深刻地揭示了、引发了广泛的关注、具有重要的意义、这一现象背后、折射出、从某种程度上说、从长远来看`;

export function buildHumanizeUserPrompt(
  original: string,
  settings: HumanizeSettings,
  complianceSummary: string,
  preCheckRisks: string,
  mode: 'humanize' | 'compliance-optimize',
  previousResult?: string
): string {
  const tone = TONE_MAP[settings.toneStyle] || TONE_MAP['chat+steady'];
  const genreStrategy = getGenreStrategy(settings.genre);
  const wordRange = getWordRange(settings.videoDuration);
  const bannedSection = buildBannedWordsSection(settings.bannedWords);
  const conversionSection = buildConversionSection(settings);

  if (mode === 'compliance-optimize' && previousResult) {
    return buildComplianceOptimizePrompt(previousResult, complianceSummary, wordRange);
  }

  return `## 任务
将以下原文改写为一篇适合微信视频号长视频口播的真人感文稿。

## 口播语气
${tone}

## 目标人群
${settings.targetAudience}

## 账号人设
${settings.persona}

## 目标字数
${wordRange}

## 合规核心要求（必须遵守）
${complianceSummary}

## 原文风险预检结果
${preCheckRisks || '未检测到明显风险'}

${genreStrategy}

## 转化设置
${conversionSection}
${bannedSection}

## 输出 JSON 结构
请严格按以下 JSON 结构输出（不要添加任何 JSON 之外的内容）：

{
  "contentType": "识别出的题材类型",
  "aiScoreBefore": 85,
  "aiScoreAfterEstimate": 15,
  "dimensionScores": {
    "languageNaturalness": 0,
    "structureHumanLike": 0,
    "emotionalDepth": 0,
    "lifeDetails": 0,
    "conversionNaturalness": 0,
    "repeatRisk": 0
  },
  "diagnosis": [
    {"problem": "原文的一个AI味问题", "reason": "为什么这是AI味", "suggestion": "如何改"}
  ],
  "viralAnalysis": {
    "hook": "开头钩子分析",
    "conflict": "冲突点",
    "emotion": "情绪点",
    "turningPoint": "转折点",
    "conversionLogic": "转化逻辑",
    "bestRetainedElements": ["建议保留的爆款功能位"]
  },
  "rewriteStrategy": {
    "angle": "新叙述角度",
    "structure": "改写结构",
    "tone": "口播语气",
    "antiAiMethods": ["去AI味方法1", "去AI味方法2"],
    "antiRepeatMethods": ["降低重复感方法"]
  },
  "mainScript": {
    "spokenVersion": "完整可直接口播的稿件，自然段落之间用换行分隔，不要用小标题",
    "structureVersion": {
      "hook": "开头钩子（2-3句话）",
      "setup": "故事铺垫",
      "conflict": "冲突转折",
      "insight": "认知落点",
      "emotion": "情绪共鸣",
      "conversion": "自然转化"
    }
  },
  "titles": ["标题1", "标题2", "标题3"],
  "hooks": ["开头钩子1", "开头钩子2", "开头钩子3"],
  "endings": ["结尾1", "结尾2", "结尾3"],
  "conversionBlocks": ["自然转化段1", "自然转化段2"],
  "goldenLines": ["金句1", "金句2", "金句3"],
  "shotSuggestions": [
    {"scene": "分镜场景描述", "visual": "画面建议", "emotion": "情绪关键词"}
  ],
  "riskWarnings": [
    {"level": "low|medium|high", "type": "风险类型", "text": "命中的词或句", "reason": "风险原因", "suggestion": "替代建议"}
  ],
  "nextOptimizationTips": ["下一步优化建议1", "下一步优化建议2"]
}

dimensionScores 各项 0-100，越高越好（repeatRisk 除外，越低越好）。
aiScoreBefore 和 aiScoreAfterEstimate 都是 0-100，越高表示AI味越重。
riskWarnings 里只放真正有风险的，没风险就给空数组。

---
原文：

${original}`;
}

function buildComplianceOptimizePrompt(
  previousResult: string,
  complianceSummary: string,
  wordRange: string
): string {
  return `## 任务
对以下已生成的口播稿进行合规二次优化。只优化可能发布出去的内容，不要动内部分析。

## 需要优化的内容
${previousResult}

## 合规核心要求
${complianceSummary}

## 目标字数
${wordRange}

## 优化规则
1. 只修改有合规风险的部分，不改变核心内容和叙事结构
2. 优化后必须保持真人感和口播节奏
3. 不要引入新的AI味

## 输出 JSON 结构
严格返回以下 JSON（不要添加 JSON 之外的内容）：

{
  "optimizedScript": "优化后的完整口播稿",
  "optimizedTitles": ["标题1", "标题2", "标题3"],
  "optimizedHooks": ["开头1", "开头2", "开头3"],
  "optimizedEndings": ["结尾1", "结尾2", "结尾3"],
  "optimizedConversionBlocks": ["转化段1", "转化段2"],
  "optimizedGoldenLines": ["金句1", "金句2", "金句3"],
  "changes": [
    {"original": "原文表述", "optimized": "优化后表述", "reason": "优化原因"}
  ]
}`;
}
