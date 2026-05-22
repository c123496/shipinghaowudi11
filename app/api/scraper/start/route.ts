import { NextResponse } from 'next/server';
import { startScraper, isScraperRunning } from '@/lib/scraper-process';

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const platform = body.platform || 'douyin';

    if (isScraperRunning(platform)) {
      return NextResponse.json(
        { error: `${platform === 'wechat' ? '视频号' : '抖音'}抓取器已在运行中` },
        { status: 409 }
      );
    }

    const result = startScraper({
      platform,
      mode: body.mode || (platform === 'wechat' ? 'all' : 'full'),
      passes: body.passes || 3,
      cycles: body.cycles || 0,
    });

    return NextResponse.json({ ok: true, platform, ...result }, { status: 202 });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : '启动失败';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
