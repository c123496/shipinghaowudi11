import { NextRequest, NextResponse } from 'next/server';
import { callAI } from '@/lib/claude';
import {
  HUMANIZE_SYSTEM,
  buildHumanizeUserPrompt,
  HumanizeSettings,
} from '@/lib/prompts/humanize';
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
  let opens = 0;
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

    const userPrompt = buildHumanizeUserPrompt(
      content,
      effectiveSettings,
      complianceSummary,
      preCheck,
      currentMode,
      body.previousResult
    );

    const rawResult = await callAI(HUMANIZE_SYSTEM, userPrompt, {
      maxTokens: 8192,
      timeout: parseInt(process.env.DEEPSEEK_TIMEOUT_MS || '120000', 10),
    });

    // Try to parse JSON from the result — multi-layer fallback
    let parsed: Record<string, unknown>;

    // Step 1: Clean markdown code block wrapping (```json ... ``` or ``` ... ```)
    let cleaned = rawResult.trim();
    const mdMatch = cleaned.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?\s*```$/);
    if (mdMatch) {
      cleaned = mdMatch[1].trim();
    }

    try {
      parsed = JSON.parse(cleaned);
    } catch {
      // Step 2: Extract the largest balanced { ... } block
      const jsonMatch = extractBalancedJson(cleaned);
      if (jsonMatch) {
        try {
          parsed = JSON.parse(jsonMatch);
        } catch {
          // Step 3: Try to fix truncated JSON
          const fixed = tryFixTruncatedJson(jsonMatch);
          if (fixed) {
            try {
              parsed = JSON.parse(fixed);
            } catch {
              return NextResponse.json({
                rawText: rawResult,
                parseFailed: true,
                error: '结构化解析失败，但内容已生成',
              });
            }
          } else {
            return NextResponse.json({
              rawText: rawResult,
              parseFailed: true,
              error: '结构化解析失败，但内容已生成',
            });
          }
        }
      } else {
        return NextResponse.json({
          rawText: rawResult,
          parseFailed: true,
          error: '结构化解析失败，但内容已生成',
        });
      }
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
