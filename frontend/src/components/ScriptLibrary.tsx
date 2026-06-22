import { useEffect, useState, useMemo } from "react";
import { api, ScriptItem } from "../api/client";

type FilterKey = "all" | "rewrite" | "wenan_rewrite" | "dedup" | "book";

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: "all", label: "全部" },
  { key: "rewrite", label: "有口播" },
  { key: "wenan_rewrite", label: "有改写" },
  { key: "dedup", label: "有二创" },
  { key: "book", label: "有书名" },
];

export default function ScriptLibrary({
  onHome,
  onEnterTask,
}: {
  onHome: () => void;
  onEnterTask: (taskId: string) => void;
}) {
  const [items, setItems] = useState<ScriptItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<FilterKey>("all");
  const [detailItem, setDetailItem] = useState<ScriptItem | null>(null);

  useEffect(() => {
    api
      .listScripts()
      .then(setItems)
      .catch(() => setItems([]))
      .finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => {
    let list = items;

    // 筛选
    if (filter === "rewrite") list = list.filter((i) => i.has_rewrite);
    else if (filter === "wenan_rewrite") list = list.filter((i) => i.has_wenan_rewrite);
    else if (filter === "dedup") list = list.filter((i) => i.has_dedup);
    else if (filter === "book") list = list.filter((i) => i.book?.book_title);

    // 搜索
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        (i) =>
          i.source.toLowerCase().includes(q) ||
          i.book?.book_title?.toLowerCase().includes(q) ||
          i.transcript?.full_text?.toLowerCase().includes(q) ||
          i.rewrite?.full_text?.toLowerCase().includes(q) ||
          i.wenan_rewrite?.full_text?.toLowerCase().includes(q) ||
          i.dedup?.full_text?.toLowerCase().includes(q)
      );
    }

    return list;
  }, [items, filter, search]);

  return (
    <div className="min-h-screen bg-gray-950">
      <div className="mx-auto max-w-6xl px-8 py-6">
        {/* 顶栏 */}
        <header className="mb-6 flex items-center justify-between">
          <button
            onClick={onHome}
            className="flex items-center gap-1.5 text-lg font-bold text-brand transition-colors hover:text-amber-300"
          >
            <span className="text-base">←</span> 文案库
          </button>
          <span className="text-sm text-gray-500">
            共 {items.length} 条文案
          </span>
        </header>

        {/* 搜索 + 筛选 */}
        <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap gap-2">
            {FILTERS.map((f) => (
              <button
                key={f.key}
                onClick={() => setFilter(f.key)}
                className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                  filter === f.key
                    ? "bg-amber-500/20 text-amber-300 ring-1 ring-amber-500/40"
                    : "bg-white/5 text-gray-400 hover:bg-white/10 hover:text-gray-200"
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 text-sm">
              🔍
            </span>
            <input
              type="text"
              placeholder="搜索书名、文案内容…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full rounded-xl border border-gray-800 bg-gray-900/80 py-2 pl-9 pr-4 text-sm text-gray-200 placeholder-gray-600 outline-none transition focus:border-amber-500/50 focus:ring-1 focus:ring-amber-500/30 sm:w-72"
            />
          </div>
        </div>

        {/* 内容 */}
        {loading ? (
          <div className="flex h-60 items-center justify-center text-gray-500">
            加载中…
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex h-80 flex-col items-center justify-center text-gray-500">
            <div className="mb-4 text-5xl">📝</div>
            <p className="mb-1 text-gray-300">
              {items.length === 0 ? "还没有文案" : "没有匹配的文案"}
            </p>
            <p className="text-sm">
              {items.length === 0
                ? "先创建任务并运行文案改写流程"
                : "试试调整筛选条件或搜索关键词"}
            </p>
          </div>
        ) : (
          <div className="grid gap-4">
            {filtered.map((item) => (
              <ScriptCard
                key={item.task_id}
                item={item}
                onViewDetail={() => setDetailItem(item)}
                onEnter={() => onEnterTask(item.task_id)}
              />
            ))}
          </div>
        )}
      </div>

      {/* 全文弹窗 */}
      {detailItem && (
        <DetailModal
          item={detailItem}
          onClose={() => setDetailItem(null)}
          onEnter={() => {
            onEnterTask(detailItem.task_id);
            setDetailItem(null);
          }}
        />
      )}
    </div>
  );
}

/* ───────── 单条文案卡片 ───────── */

function ScriptCard({
  item,
  onViewDetail,
  onEnter,
}: {
  item: ScriptItem;
  onViewDetail: () => void;
  onEnter: () => void;
}) {
  return (
    <div className="group rounded-2xl border border-gray-800 bg-gray-900/60 p-5 transition hover:border-amber-500/30">
      {/* 头部：来源 + 书名 + 时间 */}
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium text-gray-200">
            {item.source.slice(0, 50)}
            {item.source.length > 50 ? "…" : ""}
          </span>
          {item.book?.book_title && (
            <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-2.5 py-0.5 text-xs text-amber-300 ring-1 ring-amber-500/30">
              📖 《{item.book.book_title}》
              {item.book.book_author && ` · ${item.book.book_author}`}
            </span>
          )}
        </div>
        <span className="flex-shrink-0 text-xs text-gray-600">
          {formatDate(item.created_at)}
        </span>
      </div>

      {/* 原文案预览 */}
      {item.transcript && (
        <div className="mb-3">
          <div className="mb-1 flex items-center gap-2">
            <span className="rounded bg-purple-500/20 px-1.5 py-0.5 text-[10px] font-medium text-purple-300">
              原文案
            </span>
          </div>
          <p className="mt-1 text-sm leading-relaxed text-gray-500">
            {item.transcript.preview}
          </p>
        </div>
      )}

      {/* 口播文案预览 */}
      {item.rewrite && (
        <div className="mb-3">
          <div className="mb-1 flex items-center gap-2">
            <span className="rounded bg-orange-500/20 px-1.5 py-0.5 text-[10px] font-medium text-orange-300">
              口播文案
            </span>
            <span className="text-[10px] text-gray-600">
              {item.rewrite.candidates_count} 版 · 已选第 {item.rewrite.selected_index + 1} 版
            </span>
          </div>
          <SimBar value={item.rewrite_similarity} />
          <p className="mt-1 text-sm leading-relaxed text-gray-400">
            {item.rewrite.preview}
          </p>
        </div>
      )}

      {/* 文案工坊改写预览 */}
      {item.wenan_rewrite && (
        <div className="mb-3">
          <div className="mb-1 flex items-center gap-2">
            <span className="rounded bg-blue-500/20 px-1.5 py-0.5 text-[10px] font-medium text-blue-300">
              改写文案
            </span>
          </div>
          <SimBar value={item.wenan_rewrite_similarity} />
          <p className="mt-1 text-sm leading-relaxed text-gray-400">
            {item.wenan_rewrite.preview}
          </p>
        </div>
      )}

      {/* 二创预览 */}
      {item.dedup && (
        <div className="mb-3">
          <div className="mb-1 flex items-center gap-2">
            <span className="rounded bg-green-500/20 px-1.5 py-0.5 text-[10px] font-medium text-green-300">
              二创换骨
            </span>
          </div>
          <SimBar value={item.dedup_similarity} />
          <p className="mt-1 text-sm leading-relaxed text-gray-400">
            {item.dedup.preview}
          </p>
        </div>
      )}

      {/* 底部操作 */}
      <div className="flex items-center justify-end gap-3 border-t border-gray-800/60 pt-3">
        <button
          onClick={onViewDetail}
          className="text-xs text-gray-400 transition hover:text-amber-300"
        >
          查看全文
        </button>
        <button
          onClick={onEnter}
          className="rounded-lg bg-white/5 px-3 py-1 text-xs text-gray-300 transition hover:bg-amber-500/15 hover:text-amber-300"
        >
          进入任务 →
        </button>
      </div>
    </div>
  );
}

/* ───────── 全文弹窗 ───────── */

function DetailModal({
  item,
  onClose,
  onEnter,
}: {
  item: ScriptItem;
  onClose: () => void;
  onEnter: () => void;
}) {
  // 版本切换状态
  const [verIdx, setVerIdx] = useState(item.rewrite?.selected_index ?? 0);
  const [saving, setSaving] = useState(false);
  const candidates = item.rewrite?.candidates ?? [];
  const currentText = candidates[verIdx] ?? item.rewrite?.full_text ?? "";

  const handleSelectVersion = async (idx: number) => {
    setVerIdx(idx);
    if (item.rewrite && idx !== item.rewrite.selected_index) {
      setSaving(true);
      try {
        await api.updateRewrite(item.task_id, { selected: idx });
      } catch { /* 忽略保存失败 */ }
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="relative mx-4 max-h-[85vh] w-full max-w-6xl overflow-hidden rounded-2xl border border-gray-800 bg-gray-900 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 头部 */}
        <div className="flex items-center justify-between border-b border-gray-800 px-6 py-4">
          <div>
            <h2 className="text-base font-semibold text-gray-100">
              {item.source.slice(0, 60)}
              {item.source.length > 60 ? "…" : ""}
            </h2>
            {item.book?.book_title && (
              <p className="mt-1 text-sm text-amber-300">
                📖 《{item.book.book_title}》
                {item.book.book_author && ` · ${item.book.book_author}`}
              </p>
            )}
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-gray-500 transition hover:bg-white/10 hover:text-gray-300"
          >
            ✕
          </button>
        </div>

        {/* 文案并排展示 */}
        <div className="grid max-h-[65vh] grid-cols-1 gap-0 overflow-y-auto md:grid-cols-3 md:divide-x md:divide-gray-800">
          {/* 左：原文案 */}
          <div className="p-6">
            <div className="mb-3 flex items-center gap-2">
              <span className="rounded bg-purple-500/20 px-2 py-0.5 text-xs font-medium text-purple-300">
                原文案
              </span>
            </div>
            <div className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-gray-400">
              {item.transcript?.full_text || (
                <span className="text-gray-600">暂无原文案</span>
              )}
            </div>
          </div>

          {/* 中：口播文案 + 版本切换 */}
          <div className="p-6">
            <div className="mb-3 flex items-center gap-2">
              <span className="rounded bg-orange-500/20 px-2 py-0.5 text-xs font-medium text-orange-300">
                口播文案
              </span>
              {saving && (
                <span className="text-[10px] text-amber-400">保存中…</span>
              )}
            </div>
            {/* 版本 tab */}
            {candidates.length > 1 && (
              <div className="mb-3 flex gap-1.5">
                {candidates.map((_, i) => (
                  <button
                    key={i}
                    onClick={() => handleSelectVersion(i)}
                    className={`rounded-md px-2.5 py-1 text-xs font-medium transition ${
                      verIdx === i
                        ? "bg-orange-500/25 text-orange-300 ring-1 ring-orange-500/40"
                        : "bg-white/5 text-gray-500 hover:bg-white/10 hover:text-gray-300"
                    }`}
                  >
                    版本 {i + 1}
                  </button>
                ))}
              </div>
            )}
            <SimBar value={item.rewrite_similarity} />
            <div className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-gray-300">
              {currentText || (
                <span className="text-gray-600">暂无口播文案</span>
              )}
            </div>
          </div>

          {/* 右：改写 + 二创 */}
          <div className="p-6">
            {item.wenan_rewrite && (
              <div className="mb-6">
                <div className="mb-3 flex items-center gap-2">
                  <span className="rounded bg-blue-500/20 px-2 py-0.5 text-xs font-medium text-blue-300">
                    改写文案
                  </span>
                </div>
                <SimBar value={item.wenan_rewrite_similarity} />
                <div className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-gray-300">
                  {item.wenan_rewrite.full_text}
                </div>
              </div>
            )}

            {item.dedup && (
              <div>
                <div className="mb-3 flex items-center gap-2">
                  <span className="rounded bg-green-500/20 px-2 py-0.5 text-xs font-medium text-green-300">
                    二创换骨
                  </span>
                </div>
                <SimBar value={item.dedup_similarity} />
                <div className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-gray-300">
                  {item.dedup.full_text}
                </div>
              </div>
            )}

            {!item.wenan_rewrite && !item.dedup && (
              <span className="text-gray-600 text-sm">暂无改写/二创文案</span>
            )}
          </div>
        </div>

        {/* 底部 */}
        <div className="flex items-center justify-end border-t border-gray-800 px-6 py-3">
          <button
            onClick={onEnter}
            className="rounded-xl bg-gradient-to-r from-amber-400 to-orange-500 px-5 py-2 text-sm font-semibold text-gray-950 transition hover:from-amber-300 hover:to-orange-400"
          >
            进入任务 →
          </button>
        </div>
      </div>
    </div>
  );
}

/* ───────── 工具 ───────── */

function formatDate(iso: string): string {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  } catch {
    return iso.slice(0, 10);
  }
}

function SimBar({ value }: { value: number | null | undefined }) {
  if (value == null) return null;
  const pct = Math.round(value * 100);
  const color =
    pct >= 85 ? { text: "text-green-400", bg: "bg-green-500", ring: "ring-green-500/30", label: "轻调" } :
    pct >= 60 ? { text: "text-amber-400", bg: "bg-amber-500", ring: "ring-amber-500/30", label: "中度改写" } :
                { text: "text-red-400", bg: "bg-red-500", ring: "ring-red-500/30", label: "大幅改写" };
  return (
    <div className="flex items-center gap-2 text-[10px]">
      <span className={`font-medium ${color.text}`}>与原文 {pct}%</span>
      <span className={`rounded px-1 py-0.5 ${color.text} ring-1 ${color.ring}`}>
        {color.label}
      </span>
      <div className="h-1.5 flex-1 max-w-[80px] rounded-full bg-gray-800 overflow-hidden">
        <div className={`h-full rounded-full ${color.bg} transition-all`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
