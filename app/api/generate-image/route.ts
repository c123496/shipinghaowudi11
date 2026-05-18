import { NextRequest, NextResponse } from 'next/server';

const BASE_URL = process.env.IMAGE_API_BASE_URL || 'https://api.evolink.ai';
const API_KEY = process.env.IMAGE_API_KEY || '';
const MODEL = 'gpt-image-1';
const POLL_INTERVAL = 3000;
const MAX_POLLS = 40; // 最多等 120 秒

async function createTask(prompt: string, size: string): Promise<string> {
  const res = await fetch(`${BASE_URL}/v1/images/generations`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ model: MODEL, prompt, n: 1, size }),
  });
  const data = await res.json();
  if (!data.id) throw new Error(data.error?.message || '创建图片任务失败');
  return data.id as string;
}

async function pollTask(taskId: string): Promise<string> {
  for (let i = 0; i < MAX_POLLS; i++) {
    await new Promise(r => setTimeout(r, POLL_INTERVAL));
    const res = await fetch(`${BASE_URL}/v1/tasks/${taskId}`, {
      headers: { 'Authorization': `Bearer ${API_KEY}` },
    });
    const data = await res.json();
    if (data.status === 'completed') {
      const url = data.results?.[0] || data.result_data?.[0]?.url;
      if (!url) throw new Error('图片 URL 为空');
      return url as string;
    }
    if (data.status === 'failed') {
      throw new Error(data.error?.message || '图片生成失败');
    }
  }
  throw new Error('图片生成超时，请重试');
}

export async function POST(req: NextRequest) {
  if (!API_KEY) {
    return NextResponse.json({ error: 'IMAGE_API_KEY 未配置' }, { status: 500 });
  }
  try {
    const { prompt, size = '1024x1024' } = await req.json() as { prompt: string; size?: string };
    if (!prompt?.trim()) {
      return NextResponse.json({ error: '提示词不能为空' }, { status: 400 });
    }
    const taskId = await createTask(prompt.trim(), size);
    const imageUrl = await pollTask(taskId);
    return NextResponse.json({ url: imageUrl });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
