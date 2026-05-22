export interface HumanizeQualityOptions {
  minScriptChars?: number;
  requireImagePrompts?: boolean;
  requireCompletePackage?: boolean;
}

export interface HumanizeQualityResult {
  ok: boolean;
  reasons: string[];
  normalizedScript?: string;
  violations: string[];
}

export function countContentChars(text: string): number {
  return text.replace(/\s/g, '').length;
}

export function getHumanizeMinimumScriptChars(
  sourceText: string,
  videoDuration: string = '5-8'
): number {
  const sourceChars = countContentChars(sourceText);
  if (sourceChars <= 0) return 0;
  // 仅用于判定 AI 输出是否"明显截断"（如只生成了几句话）
  // 不再用于强制贴近原文长度，输出长度由 prompt 引导 AI 自然匹配
  const softFloor = Math.min(sourceChars, 80);
  const minimumRatio = videoDuration === '8-12' ? 0.35 : 0.4;
  return Math.max(softFloor, Math.floor(sourceChars * minimumRatio));
}

export function getHumanizeTargetWordRange(sourceText: string, videoDuration: string = '5-8'): string {
  const sourceChars = countContentChars(sourceText);
  if (sourceChars <= 0) {
    return videoDuration === '8-12'
      ? '贴近原文字数，可适度扩写，但不要为了时长硬凑字数'
      : '贴近原文字数，不要为了固定字数硬扩写';
  }

  // 给 AI 一个宽松的目标区间，强调"和原文字数接近"为准则，不卡硬指标
  const min = Math.max(120, Math.floor(sourceChars * 0.75));
  const maxRatio = videoDuration === '8-12' ? 1.3 : 1.2;
  const max = Math.max(min + 80, Math.ceil(sourceChars * maxRatio));
  return `参考字数：和原文 ${sourceChars} 字接近即可（约 ${min}-${max} 字之间都合理），不要为了凑字数硬扩写，也不要无故大幅缩减；字数贴近原文是首要目标`;
}

const PERSONAL_EXAMPLE_PATTERNS = [
  '我有个朋友',
  '我一个朋友',
  '我认识一个人',
  '我认识的一个人',
  '我叔叔',
  '我爸',
  '我父亲',
  '我妈',
  '我母亲',
  '我邻居',
  '楼上那个',
  '一个长辈问我',
  '长辈跟我说',
  '我同事',
  '我身边',
  '身边有个',
  '身边一个',
  '我举个例子',
  '举个我身边的例子',
];

export function normalizeOneParagraphScript(text: string): string {
  return text
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\n+/g, '')
    .replace(/[ \t\f\v]+/g, ' ')
    .replace(/[\u3000]+/g, '')
    .replace(/\s*([，。！？、；：,.!?;:])\s*/g, '$1')
    .trim();
}

export function findPersonalExampleViolations(text: string): string[] {
  const hits: string[] = [];
  for (const pattern of PERSONAL_EXAMPLE_PATTERNS) {
    if (text.includes(pattern)) {
      hits.push(pattern);
    }
  }
  return hits;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function getSpokenVersion(result: unknown): string {
  if (!isRecord(result) || !isRecord(result.mainScript)) return '';
  return typeof result.mainScript.spokenVersion === 'string'
    ? result.mainScript.spokenVersion
    : '';
}

function getArrayLength(result: Record<string, unknown>, key: string): number {
  const value = result[key];
  return Array.isArray(value) ? value.length : 0;
}

export function validateHumanizeResult(
  result: unknown,
  options: HumanizeQualityOptions = {}
): HumanizeQualityResult {
  const minScriptChars = options.minScriptChars ?? 1000;
  const requireImagePrompts = options.requireImagePrompts ?? options.requireCompletePackage ?? false;
  const requireCompletePackage = options.requireCompletePackage ?? false;
  const reasons: string[] = [];
  const spokenVersion = getSpokenVersion(result);
  const normalizedScript = normalizeOneParagraphScript(spokenVersion);
  const violations = findPersonalExampleViolations(normalizedScript);

  if (!normalizedScript) {
    reasons.push('主文案缺失，未生成 mainScript.spokenVersion');
  } else if (normalizedScript.length < minScriptChars) {
    reasons.push(`主文案不完整，当前 ${normalizedScript.length} 字，低于最低要求 ${minScriptChars} 字`);
  }

  if (/\n|\r/.test(spokenVersion)) {
    reasons.push('主文案包含换行，未按一整段可复制格式输出');
  }

  if (violations.length > 0) {
    reasons.push(`主文案包含身边普通人素材：${violations.join('、')}`);
  }

  if (requireCompletePackage && isRecord(result)) {
    const requiredArrays: Array<[string, string, number]> = [
      ['titles', '标题', 3],
      ['hooks', '开头钩子', 3],
      ['endings', '结尾', 3],
      ['conversionBlocks', '自然转化段', 2],
      ['goldenLines', '金句', 3],
      ['shotSuggestions', '分镜建议', 4],
    ];

    for (const [key, label, minLength] of requiredArrays) {
      const length = getArrayLength(result, key);
      if (length < minLength) {
        reasons.push(`${label}不完整，${key} 至少需要 ${minLength} 条，当前 ${length} 条`);
      }
    }
  }

  if (requireImagePrompts && isRecord(result)) {
    const imagePrompts = result.imagePrompts;
    if (!Array.isArray(imagePrompts) || imagePrompts.length < 4) {
      reasons.push('配图提示词不完整，必须输出 4 条 imagePrompts');
    }
  }

  return {
    ok: reasons.length === 0,
    reasons,
    normalizedScript,
    violations,
  };
}
