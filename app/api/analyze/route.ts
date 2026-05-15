import { NextRequest, NextResponse } from 'next/server';
import { callClaude } from '@/lib/claude';
import { getScriptById, saveAnalysis, getAllAnalyses, getStyleReport, saveStyleReport, AnalysisResult, StyleReport } from '@/lib/storage';
import { ANALYZE_SYSTEM, buildAnalyzeUserPrompt, BATCH_REPORT_SYSTEM } from '@/lib/prompts/analyze';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { scriptId, generateReport } = body as { scriptId: string; generateReport?: boolean };

    const script = getScriptById(scriptId);
    if (!script) {
      return NextResponse.json({ error: '文案不存在' }, { status: 404 });
    }

    const userPrompt = buildAnalyzeUserPrompt(script.content, script.title);
    const raw = await callClaude(ANALYZE_SYSTEM, userPrompt);
    const parsed = JSON.parse(raw.match(/\{[\s\S]*\}/)?.[0] || '{}');

    const analysis: AnalysisResult = {
      scriptId,
      openHook: parsed.openHook || '',
      narrativeRhythm: parsed.narrativeRhythm || '',
      emotionCurve: parsed.emotionCurve || '',
      culturalReferences: parsed.culturalReferences || [],
      resonancePoints: parsed.resonancePoints || [],
      endingPattern: parsed.endingPattern || '',
      styleFingerprint: parsed.styleFingerprint || '',
      analyzedAt: new Date().toISOString(),
    };

    saveAnalysis(analysis);

    if (generateReport) {
      const report = await generateStyleReportFn();
      return NextResponse.json({ analysis, report });
    }

    return NextResponse.json({ analysis });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

export async function PUT() {
  try {
    const report = await generateStyleReportFn();
    return NextResponse.json({ report });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

export async function GET() {
  try {
    const analyses = getAllAnalyses();
    const report = getStyleReport();
    return NextResponse.json({ analyses, report });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

async function generateStyleReportFn(): Promise<StyleReport> {
  const analyses = getAllAnalyses();
  if (analyses.length === 0) {
    throw new Error('没有已分析的文案，无法生成报告');
  }

  const summaries = analyses.map(a => `
【文案ID: ${a.scriptId}】
- 风格指纹: ${a.styleFingerprint}
- 情感曲线: ${a.emotionCurve}
- 共鸣点: ${a.resonancePoints.join('、')}
- 文化引用: ${a.culturalReferences.join('、')}
  `).join('\n');

  const raw = await callClaude(BATCH_REPORT_SYSTEM, `以下是 ${analyses.length} 篇文案的风格分析结果：\n${summaries}`);
  const parsed = JSON.parse(raw.match(/\{[\s\S]*\}/)?.[0] || '{}');

  const report: StyleReport = {
    id: 'report',
    totalAnalyzed: analyses.length,
    commonPatterns: parsed.commonPatterns || [],
    avgWordCount: 0,
    topTags: parsed.topTags || [],
    topCulturalRefs: parsed.topCulturalRefs || [],
    topResonancePoints: parsed.topResonancePoints || [],
    summary: parsed.summary || '',
    createdAt: new Date().toISOString(),
  };

  saveStyleReport(report);
  return report;
}
