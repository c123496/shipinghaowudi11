import { useState } from "react";
import { ComplianceReport, RewriteData, api } from "../api/client";

// 候选头部的合规徽标：✅已过审 / ⚠️有可注意项 / ⛔仍有高风险（hover 看详情）
function ComplianceBadge({ rep }: { rep?: ComplianceReport }) {
  if (!rep) return null;
  const highs = rep.issues.filter((x) => x.severity === "high").length;
  const others = rep.issues.length - highs;
  const tip = rep.issues
    .map((x) => `[${x.severity}] ${x.rule}：${x.quote}`)
    .join("\n");
  if (rep.passed && rep.issues.length === 0)
    return <span className="text-xs px-2 py-0.5 rounded bg-green-900/40 text-green-400">✅ 已过审</span>;
  if (rep.passed)
    return (
      <span title={tip} className="text-xs px-2 py-0.5 rounded bg-yellow-900/40 text-yellow-300 cursor-help">
        ⚠️ {others} 处可注意
      </span>
    );
  return (
    <span title={tip} className="text-xs px-2 py-0.5 rounded bg-red-900/40 text-red-300 cursor-help">
      ⛔ {highs} 处高风险
    </span>
  );
}

// 后端固定生成 3 个 AI 候选（rewriter._N_CANDIDATES）。
// 约定：若 candidates 多出第 4 项，则末项是「我自己写」的自定义文案。
const AI_COUNT = 3;

export default function RewriteSelector({
  taskId,
  rewrite,
  onSave,
}: {
  taskId: string;
  rewrite: RewriteData;
  onSave: () => void;
}) {
  const [aiCandidates, setAiCandidates] = useState(rewrite.candidates.slice(0, AI_COUNT));
  const [customText, setCustomText] = useState(
    rewrite.candidates.length > AI_COUNT
      ? rewrite.candidates[rewrite.candidates.length - 1]
      : ""
  );
  const [mode, setMode] = useState<"ai" | "custom">(
    rewrite.selected >= AI_COUNT ? "custom" : "ai"
  );
  const [selected, setSelected] = useState(
    rewrite.selected >= AI_COUNT ? 0 : rewrite.selected
  );
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const canSave = mode === "ai" || customText.trim().length > 0;

  const handleSave = async () => {
    setSaving(true);
    // 自定义稿作为末位候选追加，selected 指向它；TTS 读 candidates[selected] 即可。
    const payload =
      mode === "custom"
        ? { selected: aiCandidates.length, candidates: [...aiCandidates, customText] }
        : { selected, candidates: aiCandidates };
    await api.updateRewrite(taskId, payload);
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
    onSave();
  };

  return (
    <div>
      <p className="text-xs text-gray-500 mb-4">
        选一个 AI 候选（可直接编辑），或在最下方「我自己写」里粘自己的文案。保存后 TTS → 配图 → 字幕 → 成片都用选中的这一版。
      </p>
      <div className="space-y-4">
        {aiCandidates.map((text, i) => {
          const active = mode === "ai" && selected === i;
          return (
            <div
              key={i}
              onClick={() => {
                setMode("ai");
                setSelected(i);
              }}
              className={`rounded-xl border-2 transition-all cursor-pointer ${
                active
                  ? "border-brand bg-orange-950/20"
                  : "border-gray-700 bg-gray-800/50 hover:border-gray-600"
              }`}
            >
              <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-700/50">
                <div
                  className={`w-4 h-4 rounded-full border-2 flex-shrink-0 ${
                    active ? "border-brand bg-brand" : "border-gray-500"
                  }`}
                />
                <span className="text-sm font-medium text-gray-300">候选 {i + 1}</span>
                <ComplianceBadge rep={rewrite.compliance?.[i]} />
                <span className="text-xs text-gray-500 ml-auto">{text.length} 字</span>
              </div>
              <textarea
                value={text}
                onChange={(e) => {
                  const next = [...aiCandidates];
                  next[i] = e.target.value;
                  setAiCandidates(next);
                  setMode("ai");
                  setSelected(i);
                }}
                onClick={(e) => e.stopPropagation()}
                className="w-full bg-transparent text-sm text-gray-200 leading-relaxed p-4 focus:outline-none resize-none"
                rows={8}
              />
            </div>
          );
        })}

        {/* 我自己写：忽略 AI 候选，直接手填最终口播稿 */}
        <div
          onClick={() => setMode("custom")}
          className={`rounded-xl border-2 transition-all cursor-pointer ${
            mode === "custom"
              ? "border-brand bg-orange-950/20"
              : "border-dashed border-gray-600 bg-gray-800/30 hover:border-gray-500"
          }`}
        >
          <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-700/50">
            <div
              className={`w-4 h-4 rounded-full border-2 flex-shrink-0 ${
                mode === "custom" ? "border-brand bg-brand" : "border-gray-500"
              }`}
            />
            <span className="text-sm font-medium text-gray-300">✍️ 我自己写</span>
            <span className="text-xs text-gray-500 ml-auto">{customText.length} 字</span>
          </div>
          <textarea
            value={customText}
            placeholder="忽略上面的 AI 改写，直接把你自己的口播文案粘到这里。选中并保存后，TTS、配图、字幕、成片都用这一版。"
            onChange={(e) => {
              setCustomText(e.target.value);
              setMode("custom");
            }}
            onClick={(e) => e.stopPropagation()}
            className="w-full bg-transparent text-sm text-gray-200 leading-relaxed p-4 focus:outline-none resize-none placeholder:text-gray-600"
            rows={8}
          />
        </div>
      </div>

      <div className="flex justify-end mt-4">
        <button
          onClick={handleSave}
          disabled={saving || !canSave}
          className="px-5 py-2 bg-brand hover:bg-brand-dark text-white text-sm rounded-lg disabled:opacity-50 transition-colors"
        >
          {saving ? "保存中..." : saved ? "已保存 ✓" : "保存选择"}
        </button>
      </div>
    </div>
  );
}
