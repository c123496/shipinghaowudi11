import { NextRequest, NextResponse } from 'next/server';
import { v4 as uuid } from 'uuid';
import { getAllScripts, getScriptById, saveScript, deleteScript } from '@/lib/storage';
import { callClaude } from '@/lib/claude';
import { TAG_EXTRACT_SYSTEM } from '@/lib/prompts/generate';
import { Script } from '@/lib/storage';

export async function GET() {
  try {
    const scripts = getAllScripts();
    return NextResponse.json(scripts);
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { content, title: inputTitle, source } = body as { content: string; title?: string; source?: string };

    if (!content || content.trim().length < 10) {
      return NextResponse.json({ error: '文案内容不能为空且不少于10字' }, { status: 400 });
    }

    let title = inputTitle || '';
    let tags: string[] = [];
    let emotionTone = '';
    let bookName = '';

    try {
      const metaRaw = await callClaude(TAG_EXTRACT_SYSTEM, content);
      const metaJson = JSON.parse(metaRaw.match(/\{[\s\S]*\}/)?.[0] || '{}');
      title = title || metaJson.title || '未命名文案';
      tags = metaJson.tags || [];
      emotionTone = metaJson.emotionTone || '未分析';
      bookName = metaJson.bookName || '';
    } catch {
      title = title || '未命名文案';
      tags = ['待分析'];
      emotionTone = '待分析';
      bookName = '';
    }

    const script: Script = {
      id: uuid(),
      title,
      content: content.trim(),
      wordCount: content.trim().replace(/\s/g, '').length,
      tags,
      emotionTone,
      bookName,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      source: source || '',
    };

    saveScript(script);
    return NextResponse.json(script, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  try {
    const body = await req.json();
    const { id, title, content, tags, emotionTone, bookName, source } = body as Partial<Script> & { id: string };

    const existing = getScriptById(id);
    if (!existing) {
      return NextResponse.json({ error: '文案不存在' }, { status: 404 });
    }

    const updated: Script = {
      ...existing,
      title: title ?? existing.title,
      content: content ?? existing.content,
      tags: tags ?? existing.tags,
      emotionTone: emotionTone ?? existing.emotionTone,
      bookName: bookName ?? existing.bookName,
      source: source ?? existing.source,
      wordCount: (content ?? existing.content).trim().replace(/\s/g, '').length,
      updatedAt: new Date().toISOString(),
    };

    saveScript(updated);
    return NextResponse.json(updated);
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');
    if (!id) {
      return NextResponse.json({ error: '缺少 id 参数' }, { status: 400 });
    }
    deleteScript(id);
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
