import { NextResponse } from 'next/server';
import { getScraperStatus, getGradeStats } from '@/lib/scraper-storage';
import { getProcessStatus, isScraperRunning } from '@/lib/scraper-process';

export async function GET() {
  const douyinStatus = getScraperStatus();
  const douyinStats = getGradeStats();
  const douyinRaw = getProcessStatus('douyin');
  const douyinRunning = isScraperRunning('douyin');

  const wechatRaw = getProcessStatus('wechat');
  const wechatRunning = isScraperRunning('wechat');

  return NextResponse.json({
    douyin: {
      ...douyinStatus,
      state: douyinRaw.state,
      pid: douyinRaw.pid,
      running: douyinRunning,
      stats: douyinStats,
    },
    wechat: {
      state: wechatRunning ? 'running' : (wechatRaw.state || 'stopped'),
      current_phase: '',
      updated_at: '',
      pid: wechatRaw.pid,
      running: wechatRunning,
    },
  });
}
