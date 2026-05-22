import { NextRequest, NextResponse } from 'next/server';
import { callAIWithMeta } from '@/lib/claude';
import {
  HUMANIZE_SYSTEM,
  buildHumanizeUserPrompt,
  HumanizeSettings,
} from '@/lib/prompts/humanize';
import {
  getHumanizeMinimumScriptChars,
  normalizeOneParagraphScript,
  validateHumanizeResult,
} from '@/lib/script-quality';
import { readFileSync } from 'fs';
import { join } from 'path';

interface ComplianceRule {
  id: string;
  name: string;
  riskLevel: string;
  keywords: string[];
  patterns: string[];
  suggestion: string;
}

interface ComplianceData {
  summaryForPrompt: string;
  categories: ComplianceRule[];
}

function extractBalancedJson(text: string): string | null {
  const firstBrace = text.indexOf('{');
  if (firstBrace === -1) return null;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = firstBrace; i < text.length; i++) {
    const ch = text[i];
    if (escape) { escape = false; continue; }
    if (ch === '\\' && inString) { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return text.substring(firstBrace, i + 1);
    }
  }
  // Unbalanced — return from first { to end
  return text.substring(firstBrace);
}

function tryFixTruncatedJson(text: string): string | null {
  let fixed = text.trimEnd();
  // Remove trailing comma after last array/object element
  fixed = fixed.replace(/,\s*$/, '');
  // Count unclosed brackets
  let inStr = false;
  let esc = false;
  const stack: string[] = [];
  for (let i = 0; i < fixed.length; i++) {
    const ch = fixed[i];
    if (esc) { esc = false; continue; }
    if (ch === '\\' && inStr) { esc = true; continue; }
    if (ch === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (ch === '{' || ch === '[') stack.push(ch === '{' ? '}' : ']');
    else if (ch === '}' || ch === ']') {
      if (stack.length > 0) stack.pop();
    }
  }
  // If inside a string, close it
  if (inStr) fixed += '"';
  // Close unclosed brackets
  while (stack.length > 0) {
    fixed += stack.pop();
  }
  return fixed;
}

function parseAIJson(rawResult: string): Record<string, unknown> | null {
  let cleaned = rawResult.trim();
  const mdMatch = cleaned.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?\s*```$/);
  if (mdMatch) {
    cleaned = mdMatch[1].trim();
  }

  cleaned = cleaned.replace(/"((?:[^"\\]|\\.)*)"/g, (_match, inner) => {
    const fixed = inner
      .replace(/\r\n/g, '\\n')
      .replace(/\r/g, '\\n')
      .replace(/\n/g, '\\n');
    return `"${fixed}"`;
  });

  try {
    return JSON.parse(cleaned) as Record<string, unknown>;
  } catch {
    const jsonMatch = extractBalancedJson(cleaned);
    if (!jsonMatch) return null;
    try {
      return JSON.parse(jsonMatch) as Record<string, unknown>;
    } catch {
      const fixed = tryFixTruncatedJson(jsonMatch);
      if (!fixed) return null;
      try {
        return JSON.parse(fixed) as Record<string, unknown>;
      } catch {
        return null;
      }
    }
  }
}

function normalizeParsedScript(parsed: Record<string, unknown>): void {
  if (!parsed.mainScript || typeof parsed.mainScript !== 'object') return;
  const mainScript = parsed.mainScript as Record<string, unknown>;
  if (typeof mainScript.spokenVersion === 'string') {
    mainScript.spokenVersion = normalizeOneParagraphScript(mainScript.spokenVersion);
  }
}

function loadComplianceRules(): ComplianceData | null {
  try {
    const raw = readFileSync(
      join(process.cwd(), 'data', 'compliance', 'compliance-rules.json'),
      'utf-8'
    );
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function preCheckRisks(text: string, rules: ComplianceRule[]): string {
  const hits: string[] = [];
  for (const rule of rules) {
    for (const kw of rule.keywords) {
      if (text.includes(kw)) {
        hits.push(`[${rule.name}] 命中关键词"${kw}"（风险等级：${rule.riskLevel}）`);
      }
    }
  }
  return hits.length > 0
    ? `检测到 ${hits.length} 个风险点：\n${hits.join('\n')}`
    : '未检测到明显风险';
}

function postCheckRisks(text: string, rules: ComplianceRule[]): Array<{
  level: string;
  type: string;
  text: string;
  reason: string;
  suggestion: string;
}> {
  const warnings: Array<{
    level: string;
    type: string;
    text: string;
    reason: string;
    suggestion: string;
  }> = [];
  for (const rule of rules) {
    for (const kw of rule.keywords) {
      if (text.includes(kw)) {
        warnings.push({
          level: rule.riskLevel,
          type: rule.name,
          text: kw,
          reason: `命中"${kw}"，属于${rule.name}类风险`,
          suggestion: rule.suggestion,
        });
      }
    }
  }
  return warnings;
}

export async function POST(req: NextRequest) {
  if (!process.env.DEEPSEEK_API_KEY) {
    return NextResponse.json(
      { error: 'DeepSeek API Key 未配置，请在 .env.local 中设置 DEEPSEEK_API_KEY' },
      { status: 500 }
    );
  }

  try {
    const body = await req.json();
    const { content, settings, mode } = body as {
      content: string;
      settings?: HumanizeSettings;
      mode?: 'humanize' | 'compliance-optimize';
      previousResult?: string;
    };

    if (!content || content.trim().length < 10) {
      return NextResponse.json(
        { error: '文案内容不能为空且不少于10字' },
        { status: 400 }
      );
    }

    const complianceData = loadComplianceRules();
    const complianceSummary = complianceData?.summaryForPrompt || '注意遵守微信视频号内容规范，避免绝对化用语和医疗化表述。';
    const rules = complianceData?.categories || [];

    const effectiveSettings = settings || {
      videoDuration: '5-8',
      genre: 'auto',
      targetAudience: '35-60岁以上高知人群',
      persona: '26岁男性读书博主',
      isCommerce: false,
      productName: '',
      bannedWords: '',
      retainViralPoints: true,
      conversionStrength: 'medium',
      toneStyle: 'chat+steady',
      platform: 'wechat',
    } as HumanizeSettings;

    const currentMode = mode || 'humanize';
    const preCheck = currentMode === 'humanize' ? preCheckRisks(content, rules) : '';

    const baseUserPrompt = buildHumanizeUserPrompt(
      content,
      effectiveSettings,
      complianceSummary,
      preCheck,
      currentMode,
      body.previousResult
    );

    let parsed: Record<string, unknown> | null = null;
    let lastFailureReasons: string[] = [];
    const maxAttempts = currentMode === 'humanize' ? 2 : 1;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const retryInstruction = lastFailureReasons.length > 0
        ? `\n\n## 上一次生成未通过系统质量门禁，必须修正\n失败原因：\n${lastFailureReasons.map(reason => `- ${reason}`).join('\n')}\n\n请重新生成完整 JSON。尤其注意：mainScript.spokenVersion 必须是一整段完整口播稿，不能换行，不能出现叔叔/朋友/邻居/我认识的人/我举个例子等身边普通人素材，案例必须来自历史事件、公共时代经验、公开新闻或书中材料。`
        : '';

      const aiResult = await callAIWithMeta(HUMANIZE_SYSTEM, baseUserPrompt + retryInstruction, {
        maxTokens: 8192,
        timeout: parseInt(process.env.DEEPSEEK_TIMEOUT_MS || '120000', 10),
      });

      if (aiResult.finishReason === 'length') {
        lastFailureReasons = ['AI 输出被长度限制截断，结果不完整'];
        continue;
      }

      const candidate = parseAIJson(aiResult.content);
      if (!candidate) {
        lastFailureReasons = ['AI 返回内容不是完整合法 JSON'];
        continue;
      }

      if (currentMode !== 'humanize') {
        parsed = candidate;
        break;
      }

      normalizeParsedScript(candidate);
      const quality = validateHumanizeResult(candidate, {
        minScriptChars: getHumanizeMinimumScriptChars(content, effectiveSettings.videoDuration),
        requireCompletePackage: true,
      });

      if (quality.ok) {
        candidate.qualityWarnings = [];
        candidate.retryCount = attempt - 1;
        parsed = candidate;
        break;
      }

      lastFailureReasons = quality.reasons;
    }

    if (!parsed) {
      return NextResponse.json(
        {
          error: `生成结果不完整，已自动重试仍未通过：${lastFailureReasons.join('；')}`,
          qualityWarnings: lastFailureReasons,
        },
        { status: 502 }
      );
    }

    // Post-check compliance on generated content
    if (currentMode === 'humanize' && parsed.mainScript) {
      const mainScript = parsed.mainScript as Record<string, unknown>;
      const spokenText = (mainScript.spokenVersion as string) || '';
      const titles = (parsed.titles as string[])?.join(' ') || '';
      const postWarnings = postCheckRisks(spokenText + ' ' + titles, rules);
      const existingWarnings = (parsed.riskWarnings as unknown[]) || [];
      parsed.riskWarnings = [...(existingWarnings as unknown[]), ...postWarnings];
    }

    return NextResponse.json(parsed);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[/api/humanize] Error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
