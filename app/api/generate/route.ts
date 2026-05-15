import { NextRequest, NextResponse } from 'next/server';
import { callClaudeLong } from '@/lib/claude';
import { getScriptById } from '@/lib/storage';
import { GENERATE_SYSTEM, buildGenerateUserPrompt } from '@/lib/prompts/generate';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { topic, angle, referenceIds, requirements } = body as {
      topic: string;
      angle: string;
      referenceIds: string[];
      requirements?: string;
    };

    if (!topic) {
      return NextResponse.json({ error: '请提供主题' }, { status: 400 });
    }

    const referenceExcerpts: string[] = [];
    for (const id of referenceIds || []) {
      const script = getScriptById(id);
      if (script) {
        referenceExcerpts.push(script.content.substring(0, 500) + (script.content.length > 500 ? '...' : ''));
      }
    }

    const userPrompt = buildGenerateUserPrompt(topic, angle, referenceExcerpts, requirements);
    const generated = await callClaudeLong(GENERATE_SYSTEM, userPrompt);

    return NextResponse.json({ content: generated });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
