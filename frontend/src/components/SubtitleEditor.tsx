import { useState } from "react";
import { api } from "../api/client";

export default function SubtitleEditor({
  taskId,
  initialContent,
  onSave,
}: {
  taskId: string;
  initialContent: string;
  onSave: () => void;
}) {
  const [content, setContent] = useState(initialContent);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    await api.updateSubtitles(taskId, content);
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
    onSave();
  };

  const lineCount = content.split("\n\n").filter(Boolean).length;

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs text-gray-500">{lineCount} 条字幕（SRT 格式，可直接编辑）</span>
        <button
          onClick={handleSave}
          disabled={saving}
          className="text-sm px-4 py-1.5 bg-brand hover:bg-brand-dark text-white rounded-lg disabled:opacity-50 transition-colors"
        >
          {saving ? "保存中..." : saved ? "已保存 ✓" : "保存"}
        </button>
      </div>
      <textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        className="w-full bg-gray-800 border border-gray-700 rounded-lg p-4 font-mono text-xs text-gray-200 focus:outline-none focus:border-brand resize-none"
        rows={16}
        spellCheck={false}
      />
    </div>
  );
}
