import { useCallback, useEffect, useRef, useState } from "react";
import { api, DiscoverItem, DiscoverStatus, TaskDetail } from "../api/client";

// 抖音 web 搜索每个词只给一批结果，多个关键词（逗号分隔）合并去重凑候选
const PRESET_KEYWORDS = [
  "历史书 解说，资治通鉴 解读，史记 讲解，历史 好书推荐",
  "资治通鉴 解读，帝王权谋 书",
  "三国 书 解说，明朝那些事 解说",
  "历史 听书，历史书单",
];

export default function DiscoverPanel({
  onHome,
  onCreated,
}: {
  onHome: () => void;
  onCreated: (task: TaskDetail) => void;
}) {
  const [keyword, setKeyword] = useState(PRESET_KEYWORDS[0]);
  const [status, setStatus] = useState<DiscoverStatus | null>(null);
  const [starting, setStarting] = useState(false);
  const [creatingId, setCreatingId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const logRef = useRef<HTMLDivElement>(null);

  const refresh = useCallback(async () => {
    try {
      setStatus(await api.discoverStatus());
    } catch {
      /* 后端未启动时静默，开始按钮会报错 */
    }
  }, []);

  // 首次加载上次结果；运行中每 2s 轮询
  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    if (!status?.running) return;
    const timer = setInterval(refresh, 2000);
    return () => clearInterval(timer);
  }, [status?.running, refresh]);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [status?.logs?.length]);

  const handleStart = async () => {
    setStarting(true);
    setError("");
    try {
      await api.discoverRun({ keyword, min_likes: 10000, max_check: 12, stop_after_hits: 3 });
      await refresh();
    } catch (e) {
      setError(String(e));
    } finally {
      setStarting(false);
    }
  };

  const handleUse = async (item: DiscoverItem) => {
    setCreatingId(item.aweme_id);
    setError("");
    try {
      const task = await api.createTask(item.url);
      onCreated(task);
    } catch (e) {
      setError(String(e));
    } finally {
      setCreatingId(null);
    }
  };

  const results = status?.results ?? [];
  const qualified = results.filter((r) => r.qualified);
  const others = results.filter((r) => !r.qualified);

  return (
    <div className="h-screen overflow-y-auto bg-ink text-gray-100">
      <div className="mx-auto max-w-4xl px-8 py-8">
        {/* 顶栏 */}
        <div className="mb-8 flex items-center justify-between">
          <button
            onClick={onHome}
            className="flex items-center gap-1.5 text-lg font-bold text-brand transition-colors hover:text-amber-300"
          >
            <span className="text-base">←</span> 找同类爆款
          </button>
          <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-gray-600">
            点赞≥1万 · AI 标识 · 评论求书名
          </span>
        </div>

        {/* 搜索条 */}
        <div className="rounded-2xl border border-white/8 bg-white/[0.02] p-5">
          <label className="mb-2 block text-sm text-gray-400">
            抖音搜索关键词（多个用逗号分隔，会合并结果）
          </label>
          <div className="flex gap-3">
            <input
              className="flex-1 rounded-lg border border-gray-700 bg-gray-800 p-3 text-sm text-gray-100 focus:border-brand focus:outline-none"
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && !status?.running && handleStart()}
            />
            <button
              onClick={handleStart}
              disabled={starting || status?.running}
              className="rounded-lg bg-gradient-to-r from-amber-400 to-orange-500 px-6 py-3 text-sm font-bold text-ink transition disabled:opacity-50"
            >
              {status?.running ? "寻找中…" : "🔍 开始寻找"}
            </button>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {PRESET_KEYWORDS.map((k) => (
              <button
                key={k}
                onClick={() => setKeyword(k)}
                className={`rounded-full border px-3 py-1 text-xs transition ${
                  k === keyword
                    ? "border-brand/60 text-amber-300"
                    : "border-white/10 text-gray-500 hover:text-gray-300"
                }`}
              >
                {k}
              </button>
            ))}
          </div>
          <p className="mt-3 text-xs leading-relaxed text-amber-400/80">
            ⚠️ 需要专用 Chrome（9222 端口）在运行且已登录抖音。声音是否像你的三国克隆声，
            机器判不准——点结果卡片的「试听原片」自己听 10 秒最靠谱。
          </p>
          {error && <p className="mt-2 text-sm text-red-400">{error}</p>}
        </div>

        {/* 运行日志 */}
        {(status?.running || (status?.logs?.length ?? 0) > 0) && (
          <div
            ref={logRef}
            className="mt-5 max-h-44 overflow-y-auto rounded-xl border border-white/8 bg-black/40 p-4 font-mono text-[12px] leading-relaxed text-gray-400"
          >
            {status?.logs.map((l, i) => (
              <div key={i}>{l}</div>
            ))}
            {status?.running && <div className="animate-pulse text-brand">▍</div>}
          </div>
        )}

        {/* 结果 */}
        {qualified.length > 0 && (
          <Section title={`✅ 符合条件（${qualified.length}）`}>
            {qualified.map((r) => (
              <ResultCard key={r.aweme_id} item={r} creatingId={creatingId} onUse={handleUse} />
            ))}
          </Section>
        )}
        {others.length > 0 && (
          <Section title={`已检查但评论区未见求书名（${others.length}）`} dim>
            {others.map((r) => (
              <ResultCard key={r.aweme_id} item={r} creatingId={creatingId} onUse={handleUse} />
            ))}
          </Section>
        )}
      </div>
    </div>
  );
}

function Section({
  title,
  dim,
  children,
}: {
  title: string;
  dim?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className={`mt-8 ${dim ? "opacity-60" : ""}`}>
      <h2 className="mb-4 text-base font-bold text-gray-200">{title}</h2>
      <div className="space-y-4">{children}</div>
    </div>
  );
}

function ResultCard({
  item,
  creatingId,
  onUse,
}: {
  item: DiscoverItem;
  creatingId: string | null;
  onUse: (item: DiscoverItem) => void;
}) {
  return (
    <div className="rounded-2xl border border-white/8 bg-white/[0.02] p-5 transition hover:border-brand/30">
      <div className="flex gap-4">
        {item.cover && (
          <img
            src={item.cover}
            referrerPolicy="no-referrer"
            className="h-28 w-20 flex-shrink-0 rounded-lg object-cover"
            onError={(e) => ((e.target as HTMLImageElement).style.display = "none")}
          />
        )}
        <div className="min-w-0 flex-1">
          <p className="line-clamp-2 text-[15px] font-semibold text-gray-100">{item.title}</p>
          <p className="mt-1 text-xs text-gray-500">
            @{item.author} · 时长 {item.duration}s
          </p>
          <div className="mt-2 flex flex-wrap gap-2 text-xs">
            <Badge tone="hot">👍 {formatCount(item.like_count)}</Badge>
            <Badge>💬 {formatCount(item.comment_count)}</Badge>
            {item.ai_label && <Badge tone="ai">🤖 AI 生成标识</Badge>}
            {!item.ai_label && item.ai_hint && <Badge tone="ai">🤖 疑似 AI</Badge>}
            {item.history_hit && <Badge>📜 历史题材</Badge>}
          </div>
        </div>
        <div className="flex flex-shrink-0 flex-col justify-center gap-2">
          <a
            href={item.url}
            target="_blank"
            rel="noreferrer"
            className="rounded-lg border border-white/15 px-4 py-2 text-center text-xs text-gray-300 transition hover:border-white/30 hover:text-white"
          >
            🎧 试听原片
          </a>
          <button
            onClick={() => onUse(item)}
            disabled={creatingId !== null}
            className="rounded-lg bg-gradient-to-r from-amber-400 to-orange-500 px-4 py-2 text-xs font-bold text-ink transition disabled:opacity-50"
          >
            {creatingId === item.aweme_id ? "创建中…" : "♻️ 用此链接洗稿"}
          </button>
        </div>
      </div>
      {item.book_comments.length > 0 && (
        <div className="mt-4 rounded-xl border border-brand/20 bg-brand/[0.06] p-3">
          <p className="mb-1.5 text-xs font-semibold text-amber-300">
            评论区求书名（共检查 {item.comment_checked} 条评论）
          </p>
          {item.book_comments.map((c, i) => (
            <p key={i} className="text-xs leading-relaxed text-gray-300">
              「{c}」
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

function Badge({ children, tone }: { children: React.ReactNode; tone?: "hot" | "ai" }) {
  const cls =
    tone === "hot"
      ? "border-orange-500/40 text-orange-300"
      : tone === "ai"
        ? "border-sky-500/40 text-sky-300"
        : "border-white/10 text-gray-400";
  return <span className={`rounded-full border px-2.5 py-0.5 ${cls}`}>{children}</span>;
}

function formatCount(n: number): string {
  return n >= 10000 ? `${(n / 10000).toFixed(1)}万` : String(n);
}
