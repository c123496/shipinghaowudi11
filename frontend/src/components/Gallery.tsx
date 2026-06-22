import { useEffect, useState } from "react";
import { api, GalleryItem } from "../api/client";

export default function Gallery({
  onHome,
  onNew,
}: {
  onHome: () => void;
  onNew: () => void;
}) {
  const [items, setItems] = useState<GalleryItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .listGallery()
      .then(setItems)
      .catch(() => setItems([]))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="min-h-screen bg-gray-950">
      <div className="mx-auto max-w-6xl px-8 py-6">
        {/* 顶栏 */}
        <header className="mb-8 flex items-center justify-between">
          <button
            onClick={onHome}
            className="flex items-center gap-1.5 text-lg font-bold text-brand transition-colors hover:text-amber-300"
          >
            <span className="text-base">←</span> 我的作品
          </button>
          <button
            onClick={onNew}
            className="rounded-xl bg-gradient-to-r from-amber-400 to-orange-500 px-5 py-2 text-sm font-semibold text-gray-950 transition hover:from-amber-300 hover:to-orange-400"
          >
            ⚡ 一键制作爆款
          </button>
        </header>

        {loading ? (
          <div className="flex h-60 items-center justify-center text-gray-500">加载中…</div>
        ) : items.length === 0 ? (
          <div className="flex h-80 flex-col items-center justify-center text-gray-500">
            <div className="mb-4 text-5xl">🎬</div>
            <p className="mb-1 text-gray-300">还没有成片</p>
            <p className="text-sm">点右上角「一键制作爆款」开始制作</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-5 sm:grid-cols-3 lg:grid-cols-4">
            {items.map((item) => (
              <GalleryCard key={item.id} item={item} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function GalleryCard({ item }: { item: GalleryItem }) {
  return (
    <div className="group overflow-hidden rounded-2xl border border-gray-800 bg-gray-900/60 transition hover:border-amber-500/40">
      <div className="relative aspect-[9/16] bg-black">
        <video
          src={item.video_url}
          poster={item.cover_url ?? undefined}
          controls
          preload="metadata"
          className="h-full w-full object-contain"
        >
          您的浏览器不支持视频播放
        </video>
        {item.duration != null && (
          <span className="pointer-events-none absolute bottom-2 right-2 rounded bg-black/70 px-1.5 py-0.5 text-xs text-white">
            {formatDuration(item.duration)}
          </span>
        )}
        {item.label && (
          <span className="pointer-events-none absolute left-2 top-2 rounded bg-amber-500/90 px-1.5 py-0.5 text-xs font-medium text-gray-950">
            {item.label}
          </span>
        )}
      </div>
      <div className="flex items-center justify-between gap-2 px-3 py-2.5">
        <p className="truncate text-sm text-gray-200" title={item.title}>
          {item.title}
        </p>
        <a
          href={item.video_url}
          download={`${item.title}.mp4`}
          className="flex-shrink-0 text-xs text-gray-500 transition hover:text-amber-300"
          title="下载成片"
        >
          ⬇
        </a>
      </div>
    </div>
  );
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}
