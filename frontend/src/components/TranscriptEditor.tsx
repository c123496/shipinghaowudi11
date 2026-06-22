import { useState } from "react";
import { Transcript } from "../api/client";

export default function TranscriptEditor({
  taskId,
  transcript,
}: {
  taskId: string;
  transcript: Transcript;
}) {
  const [text] = useState(
    transcript.full_text || transcript.segments.map((s) => s.text).join(" ")
  );

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs text-gray-500">
          {transcript.segments.length} 段 · {transcript.duration.toFixed(0)}s · 语言：{transcript.language}
        </span>
      </div>
      <div className="bg-gray-800 rounded-lg p-4 text-sm text-gray-200 leading-relaxed max-h-60 overflow-y-auto whitespace-pre-wrap">
        {text}
      </div>
      <p className="text-xs text-gray-600 mt-2">逐字稿（只读）。如需修改，请在「AI 改写」步骤的候选中直接编辑。</p>
    </div>
  );
}
