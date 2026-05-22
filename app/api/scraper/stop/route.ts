import { NextResponse } from 'next/server';
import { stopScraper } from '@/lib/scraper-process';

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const platform = body.platform || 'douyin';
  stopScraper(platform);
  return NextResponse.json({ ok: true, platform, message: '停止信号已发送' });
}
