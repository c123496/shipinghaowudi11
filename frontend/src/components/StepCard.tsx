import { useState, useEffect, useRef } from "react";
import { api, StepStatus } from "../api/client";
import MetaPreview from "./MetaPreview";
import TranscriptEditor from "./TranscriptEditor";
import RewriteSelector from "./RewriteSelector";
import AudioPlayer from "./AudioPlayer";
import SubtitleEditor from "./SubtitleEditor";
import VideoPlayer from "./VideoPlayer";

const STATUS_CONFIG = {
  pending: {
    badge: "border-gray-700 bg-gray-800 text-gray-400",
    dot: "bg-gray-500",
    label: "等待中",
    tone: "border-gray-800 bg-gray-900/80",
  },
  running: {
    badge: "border-blue-400/30 bg-blue-400/10 text-blue-300",
    dot: "bg-blue-400 animate-pulse",
    label: "运行中",
    tone: "border-blue-400/30 bg-blue-950/20",
  },
  done: {
    badge: "border-green-400/30 bg-green-400/10 text-green-300",
    dot: "bg-green-400",
    label: "已完成",
    tone: "border-green-400/20 bg-green-950/10",
  },
  error: {
    badge: "border-red-400/30 bg-red-400/10 text-red-300",
    dot: "bg-red-400",
    label: "需处理",
    tone: "border-red-400/30 bg-red-950/20",
  },
};

export default function StepCard({
  taskId,
  stepKey,
  stepLabel,
  stepDesc,
  stepIndex,
  stepStatus,
  onStepComplete,
  expandTrigger = 0,
}: {
  taskId: string;
  stepKey: string;
  stepLabel: string;
  stepDesc: string;
  stepIndex: number;
  stepStatus: StepStatus | undefined;
  onStepComplete: () => void;
  expandTrigger?: number;
}) {
  const [logs, setLogs] = useState<string[]>([]);
  const [running, setRunning] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [gridCount, setGridCount] = useState("");  // 仅 storyboard：手动指定生图组数，空=自动
  const [ttsBackend, setTtsBackend] = useState("");  // 仅 tts：本次配音后端，空=跟随 .env
  const [asrBackend, setAsrBackend] = useState("");  // 仅 transcribe：本次转写后端，空=跟随 .env
  const logRef = useRef<HTMLDivElement>(null);
  const esRef = useRef<EventSource | null>(null);
  const pollTimerRef = useRef<number | null>(null);

  const status = running ? "running" : stepStatus?.status ?? "pending";
  const cfg = STATUS_CONFIG[status] ?? STATUS_CONFIG.pending;
  const hasOutput = status === "done" && stepStatus;

  useEffect(() => {
    if (status === "done" || status === "error") setExpanded(true);
  }, [status, expandTrigger]);

  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [logs]);

  useEffect(() => {
    return () => {
      esRef.current?.close();
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
    };
  }, []);

  // 展开卡片时加载落盘的历史日志（页面刷新、后端重启后仍可见）
  useEffect(() => {
    if (!expanded || running || logs.length > 0) return;
    api
      .stepLogs(taskId, stepKey)
      .then((r) => r.logs.length && setLogs(r.logs))
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expanded]);

  // 进入页面时该步骤已在后端运行（如刷新页面回来）：自动续接日志和完成监听
  useEffect(() => {
    if (stepStatus?.status !== "running" || running || pollTimerRef.current) return;
    setRunning(true);
    setExpanded(true);
    watchRemote();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stepStatus?.status]);

  // 轮询模式：定期拉落盘日志 + 任务状态，不依赖 SSE（整段替换 logs，无重复）
  const watchRemote = () => {
    pollTimerRef.current = window.setInterval(async () => {
      try {
        const [detail, logsResp] = await Promise.all([
          api.getTask(taskId),
          api.stepLogs(taskId, stepKey),
        ]);
        setLogs(logsResp.logs);
        const stepState = detail.steps[stepKey]?.status;
        if (stepState === "done" || stepState === "error") {
          if (pollTimerRef.current) {
            clearInterval(pollTimerRef.current);
            pollTimerRef.current = null;
          }
          setRunning(false);
          onStepComplete();
        }
      } catch {
        /* 忽略单次轮询失败，下一拍再试 */
      }
    }, 2000);
  };

  const handleRun = async () => {
    setLogs([]);
    setRunning(true);
    setExpanded(true);

    // 1) 先确保后端真正启动该步骤，避免与 SSE 的“No active run”竞态
    const gc = stepKey === "storyboard" && gridCount.trim() ? Number(gridCount) : undefined;
    const tb = stepKey === "tts" && ttsBackend ? ttsBackend : undefined;
    const ab = stepKey === "transcribe" && asrBackend ? asrBackend : undefined;
    try {
      await api.runStep(taskId, stepKey, gc, tb, ab);
    } catch (err) {
      setLogs((prev) => [...prev, `启动失败: ${err}`]);
      setRunning(false);
      return;
    }

    // finish 幂等：SSE 的 done/error 与轮询谁先到都安全收尾
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }
      esRef.current?.close();
      esRef.current = null;
      setRunning(false);
      onStepComplete();
    };

    // 2) SSE 仅用于实时日志：经 Vite 代理可能收不到，不作为完成判定的唯一依据
    const es = new EventSource(api.sseUrl(taskId, stepKey));
    esRef.current = es;
    es.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.type === "log") setLogs((prev) => [...prev, data.msg]);
      else if (data.type === "done") finish();
      else if (data.type === "error") {
        setLogs((prev) => [...prev, `错误: ${data.msg}`]);
        finish();
      }
    };
    es.onerror = () => esRef.current?.close(); // 不直接判失败，交给轮询兜底

    // 3) 轮询任务状态兜底：即使 SSE 全程静默，也能感知真实的完成/失败并刷新 UI
    pollTimerRef.current = window.setInterval(async () => {
      try {
        const detail = await api.getTask(taskId);
        const stepState = detail.steps[stepKey]?.status;
        if (stepState === "done" || stepState === "error") finish();
      } catch {
        /* 忽略单次轮询失败，下一拍再试 */
      }
    }, 1200);
  };

  return (
    <div className={`overflow-hidden rounded-2xl border transition-colors ${cfg.tone}`}>
      <div
        className="grid cursor-pointer grid-cols-[44px_1fr_auto] items-center gap-4 px-4 py-4 hover:bg-white/[0.03]"
        onClick={() => setExpanded((value) => !value)}
      >
        <div className="relative flex h-11 w-11 items-center justify-center rounded-2xl border border-gray-700 bg-gray-950 font-mono text-sm text-gray-300">
          {String(stepIndex).padStart(2, "0")}
          <span className={`absolute -right-1 -top-1 h-3 w-3 rounded-full ring-4 ring-gray-950 ${cfg.dot}`} />
        </div>

        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium text-gray-100">{stepLabel}</span>
            <span className={`rounded-full border px-2.5 py-0.5 text-xs ${cfg.badge}`}>
              {cfg.label}
            </span>
            {hasOutput && <span className="text-xs text-green-400">已有产物</span>}
          </div>
          <p className="mt-1 text-xs leading-relaxed text-gray-500">{stepDesc}</p>
          {stepStatus?.error_msg && (
            <p className="mt-2 truncate text-xs text-red-300" title={stepStatus.error_msg}>
              {stepStatus.error_msg}
            </p>
          )}
        </div>

        <div className="flex items-center gap-2">
          {stepKey === "transcribe" && (
            <select
              value={asrBackend}
              onClick={(event) => event.stopPropagation()}
              onChange={(event) => setAsrBackend(event.target.value)}
              title="本次转写用哪个后端：本地免费但慢（约2.2倍实时），云端付费但快（几分钟）。默认跟随 .env 配置"
              className="rounded-xl border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-gray-200 focus:border-brand focus:outline-none"
            >
              <option value="">转写·默认</option>
              <option value="whisper">本地·免费(慢)</option>
              <option value="qwen">云端·付费(快)</option>
            </select>
          )}
          {stepKey === "tts" && (
            <select
              value={ttsBackend}
              onClick={(event) => event.stopPropagation()}
              onChange={(event) => setTtsBackend(event.target.value)}
              title="本次配音用哪个后端：本地免费但慢（约1小时），云端付费但快（约2分钟）。默认跟随 .env 配置"
              className="rounded-xl border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-gray-200 focus:border-brand focus:outline-none"
            >
              <option value="">声音·默认</option>
              <option value="qwen">本地·免费(慢)</option>
              <option value="cosyvoice">云端·付费(快)</option>
            </select>
          )}
          {stepKey === "storyboard" && (
            <input
              type="number"
              min={1}
              max={12}
              value={gridCount}
              onClick={(event) => event.stopPropagation()}
              onChange={(event) => setGridCount(event.target.value)}
              placeholder="组数·自动"
              title="生成几组九宫格（1 组=1 次生图调用）。留空=按对标自动"
              className="w-24 rounded-xl border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-gray-200 placeholder:text-gray-600 focus:border-brand focus:outline-none"
            />
          )}
          <button
            onClick={(event) => {
              event.stopPropagation();
              handleRun();
            }}
            disabled={running}
            className="rounded-xl bg-brand px-4 py-2 text-sm font-medium text-white transition hover:bg-brand-dark disabled:opacity-40"
          >
            {status === "done" ? "重新生成" : status === "error" ? "重试" : "运行"}
          </button>
          <span className="text-gray-600">{expanded ? "收起" : "展开"}</span>
        </div>
      </div>

      {expanded && (
        <div className="border-t border-gray-800/80 bg-gray-950/30">
          {(running || logs.length > 0) && (
            <div className="border-b border-gray-800/80 p-4">
              <div className="mb-2 flex items-center justify-between">
                <p className="text-xs font-medium text-gray-400">运行日志</p>
                {logs.length > 0 && (
                  <button className="text-xs text-gray-600 hover:text-gray-400" onClick={() => setLogs([])}>
                    清空
                  </button>
                )}
              </div>
              <div ref={logRef} className="max-h-48 overflow-y-auto rounded-xl bg-black/40 p-3 font-mono text-xs text-green-300">
                {logs.map((log, index) => (
                  <div key={index} className="leading-relaxed">
                    {log}
                  </div>
                ))}
                {running && <span className="animate-pulse">▋</span>}
              </div>
            </div>
          )}

          {hasOutput && (
            <div className="p-5">
              <div className="mb-4 flex items-center justify-between">
                <p className="text-sm font-semibold text-gray-100">步骤产物</p>
                <span className="rounded-full bg-gray-900 px-2.5 py-1 text-xs text-gray-500">{stepLabel}</span>
              </div>
              <StepOutput
                taskId={taskId}
                stepKey={stepKey}
                stepStatus={stepStatus}
                onUpdate={onStepComplete}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function StepOutput({
  taskId,
  stepKey,
  stepStatus,
  onUpdate,
}: {
  taskId: string;
  stepKey: string;
  stepStatus: StepStatus;
  onUpdate: () => void;
}) {
  switch (stepKey) {
    case "parse":
      return stepStatus.meta ? <MetaPreview taskId={taskId} meta={stepStatus.meta} /> : null;
    case "transcribe":
      return stepStatus.transcript ? (
        <TranscriptEditor taskId={taskId} transcript={stepStatus.transcript} />
      ) : null;
    case "clean":
      return stepStatus.wenan?.cleaned ? <TextPreview title="清洗稿" text={stepStatus.wenan.cleaned} /> : null;
    case "rewrite":
      return stepStatus.rewrite ? (
        <RewriteSelector taskId={taskId} rewrite={stepStatus.rewrite} onSave={onUpdate} />
      ) : null;
    case "identify_book":
      return stepStatus.wenan?.book ? <BookPreview book={stepStatus.wenan.book} /> : null;
    case "tts":
      return <AudioPlayer src={api.fileUrl(taskId, "tts.mp3")} />;
    case "storyboard":
      return stepStatus.storyboard ? <StoryboardPreview taskId={taskId} storyboard={stepStatus.storyboard} /> : null;
    case "subtitle":
      return stepStatus.subtitles !== undefined ? (
        <SubtitleEditor taskId={taskId} initialContent={stepStatus.subtitles ?? ""} onSave={onUpdate} />
      ) : null;
    case "compose":
      return <VideoPlayer src={api.fileUrl(taskId, "final.mp4")} taskId={taskId} />;
    default:
      return null;
  }
}

function TextPreview({ title, text }: { title: string; text: string }) {
  return (
    <div className="rounded-xl border border-gray-800 bg-gray-950/70 p-4">
      <div className="mb-2 flex items-center justify-between text-xs text-gray-500">
        <span>{title}</span>
        <span>{text.length} 字</span>
      </div>
      <p className="max-h-56 overflow-y-auto whitespace-pre-wrap text-sm leading-relaxed text-gray-300">
        {text}
      </p>
    </div>
  );
}

function BookPreview({ book }: { book: { book_title: string; book_author: string; confidence: number; evidence: string } }) {
  return (
    <div className="rounded-xl border border-gray-800 bg-gray-950/70 p-4 text-sm text-gray-200">
      <p>书名：<span className="font-medium text-brand">{book.book_title || "—"}</span></p>
      <p className="mt-1">作者：<span className="font-medium text-brand">{book.book_author || "—"}</span></p>
      <p className="mt-2 text-xs text-gray-500">
        置信度 {Math.round((book.confidence ?? 0) * 100)}% · {book.evidence || "无证据说明"}
      </p>
    </div>
  );
}

function StoryboardPreview({
  taskId,
  storyboard,
}: {
  taskId: string;
  storyboard: { batches?: string[][]; grids?: Record<string, { status: string; grid?: string; cells?: string[] }> };
}) {
  const grids = Object.entries(storyboard.grids ?? {}).filter(([, grid]) => grid.status === "done");
  const first = grids[0]?.[1];
  return (
    <div className="space-y-3 rounded-xl border border-gray-800 bg-gray-950/70 p-4">
      <div className="text-sm text-gray-200">
        已准备 {storyboard.batches?.length ?? 0} 组文案分段，已生成 {grids.length} 组九宫格。
      </div>
      {first?.grid && (
        <a href={api.fileUrl(taskId, first.grid)} target="_blank" rel="noreferrer">
          <img src={api.fileUrl(taskId, first.grid)} className="max-h-72 rounded-lg border border-gray-800 object-contain" />
        </a>
      )}
    </div>
  );
}
