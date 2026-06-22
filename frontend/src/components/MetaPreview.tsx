import { DyMeta } from "../api/client";
import { api } from "../api/client";

function fmt(n: number): string {
  if (n >= 10000) return `${(n / 10000).toFixed(1)}w`;
  return String(n);
}

export default function MetaPreview({ taskId, meta }: { taskId: string; meta: DyMeta }) {
  return (
    <div className="flex gap-5">
      <img
        src={api.fileUrl(taskId, "cover.jpg")}
        alt="封面"
        className="w-24 h-32 object-cover rounded-lg flex-shrink-0 bg-gray-800"
        onError={(e) => ((e.target as HTMLImageElement).style.display = "none")}
      />
      <div className="flex-1 min-w-0">
        <h3 className="font-medium text-gray-100 mb-2 leading-snug">{meta.title}</h3>
        <div className="flex gap-4 text-sm text-gray-400 mb-2">
          <span>👤 {meta.uploader}</span>
          <span>▶ {fmt(meta.view_count)}</span>
          <span>❤ {fmt(meta.like_count)}</span>
          <span>⏱ {meta.duration}s</span>
        </div>
        {meta.description && (
          <p className="text-xs text-gray-500 line-clamp-3 leading-relaxed">{meta.description}</p>
        )}
      </div>
    </div>
  );
}
