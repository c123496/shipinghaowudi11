import { useState, useEffect } from "react";
import { api, WenanData, WenanOp } from "../api/client";

export default function WenanWorkshop({ taskId }: { taskId: string }) {
  const [kw, setKw] = useState("");
  const [notes, setNotes] = useState("");
  const [terms, setTerms] = useState("");
  const [data, setData] = useState<WenanData>({});
  const [busy, setBusy] = useState<WenanOp | "">("");
  const [open, setOpen] = useState(true);

  useEffect(() => {
    api.getWenan(taskId).then((d) => {
      setData(d || {});
      setKw(d?.inputs?.keyword ?? "");
      setNotes(d?.inputs?.rewrite_notes ?? "");
      setTerms(d?.inputs?.protected_terms ?? "");
    });
  }, [taskId]);

  const run = async (op: WenanOp, extra: Record<string, string> = {}) => {
    setBusy(op);
    try {
      const res = await api.runWenan(taskId, op, { keyword: kw, ...extra });
      setData((prev) => ({ ...prev, ...res }));
    } catch (e) {
      alert(`运行失败：${e}`);
    } finally {
      setBusy("");
    }
  };

  const setField = (k: keyof WenanData, v: string) =>
    setData((prev) => ({ ...prev, [k]: v }));

  return (
    <div className="mt-6 bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
      <div
        className="flex items-center gap-3 px-5 py-4 cursor-pointer hover:bg-gray-800/50"
        onClick={() => setOpen((v) => !v)}
      >
        <span className="font-semibold text-gray-100">📝 文案工坊</span>
        <span className="text-xs text-gray-500">清洗 → 改写 / 去重，识别书籍</span>
        <span className="ml-auto text-gray-500 text-sm">{open ? "▾" : "▸"}</span>
      </div>

      {open && (
        <div className="border-t border-gray-800 p-5 space-y-5">
          <Field label="主题关键词（强烈建议填，帮模型修对专业词，如「嘌呤 / 胰岛素」）">
            <input
              className="input"
              placeholder="例如：杨慎 三国演义 临江仙 历史"
              value={kw}
              onChange={(e) => setKw(e.target.value)}
            />
          </Field>

          <OpBlock
            title="A · 逐字稿清洗"
            desc="修复 ASR 错字、去营销噪声，输出纯正文"
            running={busy === "clean"}
            onRun={() => run("clean")}
            value={data.cleaned ?? ""}
            onChange={(v) => setField("cleaned", v)}
            placeholder="点「运行清洗」生成；可直接编辑，下游改写/去重会用编辑后的版本"
          />

          {/* B 口播改写 与 C 二创换骨改写 并排，方便同屏对比挑选 */}
          <div className="grid lg:grid-cols-2 gap-4 items-start">
            <OpBlock
              title="B · 口播改写"
              desc="基于清洗稿改写成口播正文，保留爆点、过查重（温度 0.7）"
              running={busy === "rewrite"}
              onRun={() => run("rewrite", { rewrite_notes: notes, cleaned: data.cleaned ?? "" })}
              value={data.rewrite ?? ""}
              onChange={(v) => setField("rewrite", v)}
              placeholder="点「运行改写」（需先有清洗稿）"
              similarity={data.rewrite_similarity}
              extra={
                <Field label="补充要求（可选）">
                  <input
                    className="input"
                    placeholder="例如：开头加悬念、结尾引导收藏"
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                  />
                </Field>
              }
            />

            <OpBlock
              title="C · 二创换骨改写"
              desc="同素材二发用：彻底重写表达、事实不变、保留爆点，过文本去重"
              running={busy === "dedup"}
              onRun={() => run("dedup", { protected_terms: terms, cleaned: data.cleaned ?? "" })}
              value={data.dedup ?? ""}
              onChange={(v) => setField("dedup", v)}
              placeholder="点「运行去重」（需先有清洗稿）"
              similarity={data.dedup_similarity}
              extra={
                <Field label="必须原样保留的词（逗号分隔，可选）">
                  <input
                    className="input"
                    placeholder="例如：杨慎,临江仙,罗贯中"
                    value={terms}
                    onChange={(e) => setTerms(e.target.value)}
                  />
                </Field>
              }
            />
          </div>

          <BookBlock running={busy === "identify-book"} onRun={() => run("identify-book")} book={data.book} />
        </div>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-xs text-gray-400 mb-1.5">{label}</span>
      {children}
    </label>
  );
}

function OpBlock({
  title, desc, running, onRun, value, onChange, placeholder, extra, similarity: sim,
}: {
  title: string; desc: string; running: boolean; onRun: () => void;
  value: string; onChange: (v: string) => void; placeholder: string;
  extra?: React.ReactNode; similarity?: number;
}) {
  return (
    <div className="bg-gray-950/60 border border-gray-800 rounded-lg p-4 space-y-3">
      <div className="flex items-start gap-3">
        <div className="flex-1">
          <div className="text-sm font-medium text-gray-100">{title}</div>
          <div className="text-xs text-gray-500 mt-0.5">{desc}</div>
        </div>
        <button className="btn-run" disabled={running} onClick={onRun}>
          {running ? "运行中…" : "运行"}
        </button>
      </div>
      {extra}
      {sim != null && (
        <SimBar value={sim} />
      )}
      {(value || running) && (
        <div className="relative">
          <textarea
            className="input font-normal leading-relaxed min-h-[120px] max-h-72"
            value={value}
            onChange={(e) => onChange(e.target.value)}
          />
          <div className="flex justify-between text-xs text-gray-500 mt-1">
            <span>{value.length} 字</span>
            <button className="hover:text-brand" onClick={() => navigator.clipboard.writeText(value)}>
              复制
            </button>
          </div>
        </div>
      )}
      {!value && !running && <p className="text-xs text-gray-600">{placeholder}</p>}
    </div>
  );
}

function BookBlock({
  running, onRun, book,
}: {
  running: boolean; onRun: () => void;
  book?: { book_title: string; book_author: string; confidence: number; evidence: string };
}) {
  return (
    <div className="bg-gray-950/60 border border-gray-800 rounded-lg p-4 space-y-3">
      <div className="flex items-start gap-3">
        <div className="flex-1">
          <div className="text-sm font-medium text-gray-100">D · 书名 + 作者识别</div>
          <div className="text-xs text-gray-500 mt-0.5">从逐字稿反推真实书籍（JSON，温度 0.05）</div>
        </div>
        <button className="btn-run" disabled={running} onClick={onRun}>
          {running ? "识别中…" : "识别"}
        </button>
      </div>
      {book && (
        <div className="text-sm text-gray-200 space-y-1">
          <div>书名：<span className="text-brand font-medium">{book.book_title || "—"}</span></div>
          <div>作者：<span className="text-brand font-medium">{book.book_author || "—"}</span></div>
          <div className="text-xs text-gray-400">
            置信度 {Math.round((book.confidence ?? 0) * 100)}% · {book.evidence}
          </div>
        </div>
      )}
    </div>
  );
}

function SimBar({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  const color =
    pct >= 85 ? { text: "text-green-400", bg: "bg-green-500", ring: "ring-green-500/30", label: "轻调" } :
    pct >= 60 ? { text: "text-amber-400", bg: "bg-amber-500", ring: "ring-amber-500/30", label: "中度改写" } :
                { text: "text-red-400", bg: "bg-red-500", ring: "ring-red-500/30", label: "大幅改写" };
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className={`font-medium ${color.text}`}>与清洗稿相似度 {pct}%</span>
      <span className={`rounded px-1.5 py-0.5 ${color.text} ring-1 ${color.ring}`}>
        {color.label}
      </span>
      <div className="h-1.5 flex-1 max-w-[100px] rounded-full bg-gray-800 overflow-hidden">
        <div className={`h-full rounded-full ${color.bg} transition-all`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
