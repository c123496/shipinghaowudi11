'use client';

import { useState, useEffect, useCallback } from 'react';

interface VideoData {
  aweme_id: string;
  platform: string;
  desc: string;
  author: { nickname: string; follower_count: number; is_followed: boolean };
  statistics: { like_count: number; comment_count: number; share_count: number };
  classification: { grade: string; grade_reason: string; is_book_track: boolean; has_product_link: boolean; has_purchase_guidance: boolean };
  timing: { create_time: string; hours_since_publish: number };
  source: string;
  share_url: string;
  has_product_link: boolean;
  content_tags: string[];
  likes_per_hour: number;
}

interface PlatformStatus {
  state: string;
  current_phase: string;
  updated_at: string;
  pid: number;
  running: boolean;
  stats?: { S: number; A: number; B: number; unclassified: number; total: number };
}

interface CombinedStatus {
  douyin: PlatformStatus;
  wechat: PlatformStatus;
}

interface RunData {
  run_id: string;
  start_time: string;
  end_time: string | null;
  status: string;
  following_checked: number;
  new_videos: number;
  graded_s: number;
  graded_a: number;
  graded_b: number;
}

const GRADE_COLORS: Record<string, string> = {
  S: 'bg-red-100 text-red-800 border-red-300',
  A: 'bg-amber-100 text-amber-800 border-amber-300',
  B: 'bg-blue-100 text-blue-800 border-blue-300',
  unclassified: 'bg-gray-100 text-gray-600 border-gray-300',
};

const PHASE_LABELS: Record<string, string> = {
  loading_cookies: '加载 Cookie',
  fetching_following: '获取关注列表',
  scraping_following: '抓取关注账号视频',
  scraping_feed: '抓取推荐 Feed',
  classifying: '分类中',
  completed: '已完成',
  waiting: '等待下一轮',
};

type Platform = 'douyin' | 'wechat';

export default function ScraperPage() {
  const [platform, setPlatform] = useState<Platform>('douyin');
  const [status, setStatus] = useState<CombinedStatus | null>(null);
  const [videos, setVideos] = useState<VideoData[]>([]);
  const [runs, setRuns] = useState<RunData[]>([]);
  const [gradeFilter, setGradeFilter] = useState<string>('');
  const [starting, setStarting] = useState(false);
  const [douyinConfig, setDouyinConfig] = useState({ mode: 'full', passes: 3, platform: 'douyin' });
  const [wechatConfig] = useState({ mode: 'all', platform: 'wechat' });

  const fetchStatus = useCallback(async () => {
    try {
      const r = await fetch('/api/scraper/status');
      setStatus(await r.json());
    } catch { /* ignore */ }
  }, []);

  const fetchVideos = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (gradeFilter) params.set('grade', gradeFilter);
      params.set('platform', platform);
      params.set('limit', '100');
      const r = await fetch(`/api/scraper/videos?${params}`);
      setVideos(await r.json());
    } catch { /* ignore */ }
  }, [gradeFilter, platform]);

  const fetchRuns = useCallback(async () => {
    try {
      const r = await fetch('/api/scraper/runs');
      setRuns(await r.json());
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    const initialTimer = window.setTimeout(() => {
      void fetchStatus();
      void fetchVideos();
      void fetchRuns();
    }, 0);
    const timer = setInterval(() => {
      void fetchStatus();
      void fetchVideos();
    }, 10000);
    return () => {
      window.clearTimeout(initialTimer);
      clearInterval(timer);
    };
  }, [fetchStatus, fetchVideos, fetchRuns]);

  const currentStatus = platform === 'douyin' ? status?.douyin : status?.wechat;
  const isRunning = currentStatus?.running || false;

  const handleStart = async () => {
    setStarting(true);
    try {
      const body = platform === 'douyin'
        ? douyinConfig
        : wechatConfig;
      await fetch('/api/scraper/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      setTimeout(() => { fetchStatus(); fetchVideos(); fetchRuns(); }, 2000);
    } finally {
      setStarting(false);
    }
  };

  const handleStop = async () => {
    await fetch('/api/scraper/stop', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ platform }),
    });
    setTimeout(fetchStatus, 2000);
  };

  const stats = currentStatus?.stats;

  return (
    <div className="space-y-6">
      {/* 标题 + 平台选择 */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">爆款监控</h1>
          <p className="text-sm text-muted mt-1">抖音 / 视频号 读书卖书赛道素材自动抓取与分级</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex border rounded-lg overflow-hidden">
            <button
              onClick={() => { setPlatform('douyin'); setGradeFilter(''); }}
              className={`px-4 py-2 text-sm ${platform === 'douyin' ? 'bg-primary text-white' : 'bg-white hover:bg-gray-50'}`}
            >
              抖音
            </button>
            <button
              onClick={() => { setPlatform('wechat'); setGradeFilter(''); }}
              className={`px-4 py-2 text-sm ${platform === 'wechat' ? 'bg-green-600 text-white' : 'bg-white hover:bg-gray-50'}`}
            >
              视频号
            </button>
          </div>
          {isRunning ? (
            <button onClick={handleStop} className="px-4 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600 text-sm">
              停止抓取
            </button>
          ) : (
            <button onClick={handleStart} disabled={starting} className="px-4 py-2 bg-primary text-white rounded-lg hover:opacity-90 text-sm disabled:opacity-50">
              {starting ? '启动中...' : '开始抓取'}
            </button>
          )}
          <button onClick={() => { fetchStatus(); fetchVideos(); fetchRuns(); }} className="px-3 py-2 border rounded-lg text-sm hover:bg-surface-hover">
            刷新
          </button>
        </div>
      </div>

      {/* 状态栏 */}
      <div className="grid grid-cols-4 gap-4">
        <StatusCard label={`${platform === 'douyin' ? '抖音' : '视频号'}状态`} value={
          <span className="flex items-center gap-2">
            <span className={`w-2 h-2 rounded-full ${isRunning ? 'bg-green-500 animate-pulse' : 'bg-gray-400'}`} />
            {isRunning ? (PHASE_LABELS[currentStatus?.current_phase || ''] || currentStatus?.current_phase || '运行中') : '已停止'}
          </span>
        } />
        <StatusCard label="S级素材" value={stats?.S ?? 0} className={gradeFilter === 'S' ? 'ring-2 ring-red-300 cursor-pointer' : 'cursor-pointer'} onClick={() => setGradeFilter(gradeFilter === 'S' ? '' : 'S')} />
        <StatusCard label="A级素材" value={stats?.A ?? 0} className={gradeFilter === 'A' ? 'ring-2 ring-amber-300 cursor-pointer' : 'cursor-pointer'} onClick={() => setGradeFilter(gradeFilter === 'A' ? '' : 'A')} />
        <StatusCard label="B级素材" value={stats?.B ?? 0} className={gradeFilter === 'B' ? 'ring-2 ring-blue-300 cursor-pointer' : 'cursor-pointer'} onClick={() => setGradeFilter(gradeFilter === 'B' ? '' : 'B')} />
      </div>

      {/* 配置 */}
      {!isRunning && platform === 'douyin' && (
        <div className="flex items-center gap-4 text-sm">
          <label className="flex items-center gap-2">
            模式:
            <select value={douyinConfig.mode} onChange={e => setDouyinConfig(c => ({ ...c, mode: e.target.value }))} className="border rounded px-2 py-1 text-sm">
              <option value="full">全部（关注+推荐）</option>
              <option value="following_only">仅关注列表</option>
              <option value="feed_only">仅推荐Feed</option>
            </select>
          </label>
          <label className="flex items-center gap-2">
            Feed轮次:
            <input type="number" min={1} max={10} value={douyinConfig.passes} onChange={e => setDouyinConfig(c => ({ ...c, passes: parseInt(e.target.value) || 3 }))} className="border rounded px-2 py-1 w-16 text-sm" />
          </label>
        </div>
      )}

      {!isRunning && platform === 'wechat' && (
        <div className="text-sm text-muted bg-green-50 border border-green-200 rounded-lg p-3">
          视频号抓取使用后台 SendMessage + PrintWindow，不影响正常使用电脑。请确保微信已打开且视频号页面已进入。
        </div>
      )}

      {/* 视频表格 */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold">
            素材列表 {gradeFilter && <span className="text-sm text-muted">（筛选: {gradeFilter}级）</span>}
          </h2>
          <span className="text-sm text-muted">共 {videos.length} 条</span>
        </div>

        {videos.length === 0 ? (
          <div className="text-center py-12 text-muted">
            {isRunning ? '抓取中，请稍候...' : `暂无${platform === 'douyin' ? '抖音' : '视频号'}数据，点击"开始抓取"启动监控`}
          </div>
        ) : (
          <div className="space-y-2">
            {videos.map(v => (
              <div key={v.aweme_id} className="border rounded-lg p-4 hover:bg-surface-hover transition-colors">
                <div className="flex items-start justify-between">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className={`px-2 py-0.5 rounded text-xs font-bold border ${GRADE_COLORS[v.classification.grade] || GRADE_COLORS.unclassified}`}>
                        {v.classification.grade}级
                      </span>
                      <span className="text-xs bg-gray-100 text-gray-600 px-1.5 rounded">{v.platform === 'wechat_channels' ? '视频号' : '抖音'}</span>
                      <span className="text-sm font-medium">{v.author.nickname}</span>
                      <span className="text-xs text-muted">粉丝 {v.author.follower_count?.toLocaleString()}</span>
                      {v.author.is_followed && <span className="text-xs bg-green-100 text-green-700 px-1.5 rounded">已关注</span>}
                      {v.has_product_link && <span className="text-xs bg-yellow-100 text-yellow-700 px-1.5 rounded">挂书</span>}
                      {v.classification.has_purchase_guidance && <span className="text-xs bg-orange-100 text-orange-700 px-1.5 rounded">购买引导</span>}
                    </div>
                    <p className="text-sm text-foreground/80 line-clamp-2">{v.desc}</p>
                    {v.content_tags?.length > 0 && (
                      <div className="flex gap-1 mt-1">
                        {v.content_tags.slice(0, 5).map((t, i) => (
                          <span key={i} className="text-xs bg-surface px-1.5 py-0.5 rounded">#{t}</span>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="text-right text-sm ml-4 shrink-0">
                    <div className="font-bold text-red-500">{v.statistics.like_count?.toLocaleString()} {v.platform === 'wechat_channels' ? '心' : '赞'}</div>
                    <div className="text-xs text-muted">{v.timing.hours_since_publish?.toFixed(1)}小时前</div>
                    <div className="text-xs text-muted">{v.likes_per_hour?.toFixed(0)} {v.platform === 'wechat_channels' ? '心' : '赞'}/时</div>
                  </div>
                </div>
                <div className="flex items-center justify-between mt-2">
                  <p className="text-xs text-muted">{v.classification.grade_reason}</p>
                  {v.share_url && (
                    <a href={v.share_url} target="_blank" rel="noopener noreferrer" className="text-xs text-primary hover:underline">
                      {v.platform === 'wechat_channels' ? '在视频号打开' : '在抖音打开'} &rarr;
                    </a>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 运行历史 */}
      {runs.length > 0 && (
        <div>
          <h2 className="text-lg font-semibold mb-3">运行历史</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-muted">
                  <th className="pb-2 pr-4">运行ID</th>
                  <th className="pb-2 pr-4">开始时间</th>
                  <th className="pb-2 pr-4">状态</th>
                  <th className="pb-2 pr-4">关注检查</th>
                  <th className="pb-2 pr-4">新视频</th>
                  <th className="pb-2 pr-4">S</th>
                  <th className="pb-2 pr-4">A</th>
                  <th className="pb-2 pr-4">B</th>
                </tr>
              </thead>
              <tbody>
                {runs.slice(0, 20).map(r => (
                  <tr key={r.run_id} className="border-b">
                    <td className="py-2 pr-4 font-mono text-xs">{r.run_id}</td>
                    <td className="py-2 pr-4 text-xs">{new Date(r.start_time).toLocaleString('zh-CN')}</td>
                    <td className="py-2 pr-4">
                      <span className={`text-xs px-1.5 py-0.5 rounded ${r.status === 'completed' ? 'bg-green-100 text-green-700' : r.status === 'error' ? 'bg-red-100 text-red-700' : 'bg-yellow-100 text-yellow-700'}`}>
                        {r.status}
                      </span>
                    </td>
                    <td className="py-2 pr-4">{r.following_checked}</td>
                    <td className="py-2 pr-4">{r.new_videos}</td>
                    <td className="py-2 pr-4 text-red-600 font-bold">{r.graded_s}</td>
                    <td className="py-2 pr-4 text-amber-600 font-bold">{r.graded_a}</td>
                    <td className="py-2 pr-4 text-blue-600 font-bold">{r.graded_b}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function StatusCard({ label, value, className = '', onClick }: {
  label: string;
  value: React.ReactNode;
  className?: string;
  onClick?: () => void;
}) {
  return (
    <div onClick={onClick} className={`border rounded-lg p-4 ${onClick ? 'hover:bg-surface-hover' : ''} ${className}`}>
      <div className="text-xs text-muted mb-1">{label}</div>
      <div className="text-lg font-bold">{value}</div>
    </div>
  );
}
