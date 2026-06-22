import { useState, useEffect, useMemo, useRef } from "react";
import { TaskDetail } from "../api/client";
import { api } from "../api/client";
import StepCard from "./StepCard";
import WenanWorkshop from "./WenanWorkshop";
import StoryboardPanel from "./StoryboardPanel";

const STEPS = [
  { key: "parse", label: "1 · 抖音选题采集", desc: "解析链接、下载原视频、提取标题/封面/作者信息", phase: "入口" },
  { key: "transcribe", label: "2 · 逐字稿生成", desc: "把原视频口播转成可清洗的逐字稿", phase: "文本" },
  { key: "clean", label: "3 · 文案清洗", desc: "修复 ASR 错字、重新断句、去除营销噪声", phase: "文本" },
  { key: "rewrite", label: "4 · 口播改写", desc: "沿用我们的提示词生成爆款口播候选", phase: "文案" },
  { key: "identify_book", label: "5 · 书籍识别", desc: "反推真实书名和作者，用于结尾引导", phase: "商品" },
  { key: "tts", label: "6 · TTS 配音", desc: "按选中口播稿合成音频并生成字级时间轴", phase: "声音" },
  { key: "storyboard", label: "7 · 九宫格配图", desc: "按文案分段批量生成并裁切分镜图", phase: "画面" },
  { key: "subtitle", label: "8 · 字幕对齐", desc: "根据 TTS 字级时间轴生成字幕文件", phase: "字幕" },
  { key: "compose", label: "9 · 竖版成片", desc: "合成分镜、配音和字幕，导出 final.mp4", phase: "成片" },
];

const WORKFLOW_STEPS = [
  { code: "1", title: "抖音选题采集", desc: "高赞图书视频、评论购买意向" },
  { code: "2", title: "逐字稿生成", desc: "ASR 转写原始口播" },
  { code: "3", title: "清洗 + 改写", desc: "提示词仍沿用我们的文案体系" },
  { code: "4", title: "书籍识别", desc: "确认书名、作者和承接信息" },
  { code: "5", title: "TTS + 字幕", desc: "生成配音、时间轴和字幕" },
  { code: "6", title: "九宫格配图", desc: "批量生图、裁切分镜" },
  { code: "7", title: "竖版成片", desc: "合成并导出 final.mp4" },
];

const STATUS_LABEL: Record<string, string> = {
  pending: "等待中",
  running: "运行中",
  done: "已完成",
  error: "需处理",
};

// 一键流程的最终结果：全部完成 / 某步失败 / 停在选稿前
type PipelineResult = { state: "completed" | "failed" | "stopped"; failedStep?: string };

export default function PipelineView({
  task,
  onRefresh,
  onTitleChange,
}: {
  task: TaskDetail;
  onRefresh: () => void;
  onTitleChange: (title: string) => void;
}) {
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState(task.title);
  const [runningAll, setRunningAll] = useState(false);
  const [allAsrBackend, setAllAsrBackend] = useState("");  // 一键出片的转写后端，空=跟随 .env
  const [allTtsBackend, setAllTtsBackend] = useState("");  // 一键出片的配音后端，空=跟随 .env
  const [allLogs, setAllLogs] = useState<string[]>([]);
  const [smartBusy, setSmartBusy] = useState(false);
  const [finalVideo, setFinalVideo] = useState("");
  const [expandTrigger, setExpandTrigger] = useState(0);
  const allLogRef = useRef<HTMLDivElement>(null);
  const allEsRef = useRef<EventSource | null>(null);
  const pollAllTimerRef = useRef<number | null>(null);

  const stepStats = useMemo(() => {
    const statuses = STEPS.map((step) => task.steps[step.key]?.status ?? "pending");
    const done = statuses.filter((status) => status === "done").length;
    const error = statuses.filter((status) => status === "error").length;
    const running = statuses.some((status) => status === "running") || runningAll;
    const next = STEPS.find((step) => task.steps[step.key]?.status !== "done") ?? STEPS[STEPS.length - 1];
    return { done, total: STEPS.length, error, running, next };
  }, [runningAll, task.steps]);

  const progressPercent = Math.round((stepStats.done / stepStats.total) * 100);

  useEffect(() => {
    setTitleDraft(task.title);
  }, [task.id, task.title]);

  useEffect(() => {
    return () => {
      allEsRef.current?.close();
      if (pollAllTimerRef.current) clearInterval(pollAllTimerRef.current);
    };
  }, [task.id]);

  useEffect(() => {
    if (allLogRef.current) {
      allLogRef.current.scrollTop = allLogRef.current.scrollHeight;
    }
  }, [allLogs]);


  const pushLog = (m: string) => setAllLogs((prev) => [...prev, m]);

  // SSE 仅用于实时日志（经 Vite 代理可能收不到，不作为结果判定依据）
  const streamPipelineLogs = () => {
    const es = new EventSource(api.allSseUrl(task.id));
    allEsRef.current = es;
    es.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.type === "log") pushLog(String(data.msg || ""));
    };
    es.onerror = () => es.close(); // 日志流断开不影响结果判定
  };

  // 轮询任务状态直到一键流程稳定，返回最终结果（不依赖 SSE）
  const waitForPipelineSettled = (): Promise<PipelineResult> =>
    new Promise((resolve) => {
      let stalls = 0;
      let lastDone = -1;
      const settle = (result: PipelineResult) => {
        if (pollAllTimerRef.current) {
          clearInterval(pollAllTimerRef.current);
          pollAllTimerRef.current = null;
        }
        resolve(result);
      };
      pollAllTimerRef.current = window.setInterval(async () => {
        let detail: TaskDetail;
        try {
          detail = await api.getTask(task.id);
        } catch {
          return; // 忽略单次轮询失败，下一拍再试
        }
        const statuses = STEPS.map((step) => detail.steps[step.key]?.status ?? "pending");
        const doneCount = statuses.filter((s) => s === "done").length;
        const anyRunning = statuses.some((s) => s === "running");
        const failedStep = STEPS.find((step) => detail.steps[step.key]?.status === "error");

        if (failedStep) return settle({ state: "failed", failedStep: failedStep.label });
        if (doneCount === STEPS.length) return settle({ state: "completed" });

        // 无运行中的步骤且进度不再前进 → 视为停在选稿前（一键流程会在 TTS 前自动暂停）
        stalls = !anyRunning && doneCount === lastDone ? stalls + 1 : 0;
        lastDone = doneCount;
        if (stalls >= 3) settle({ state: "stopped" });
      }, 1500);
    });

  // 一键出片：先启动后端，再轮询直到稳定（SSE 仅辅助显示日志）
  const handleOneClick = async () => {
    setSmartBusy(true);
    setRunningAll(true);
    setAllLogs([]);
    setFinalVideo("");
    pushLog("开始一键出片：选题采集 → 逐字稿 → 清洗改写 → 识书 → TTS → 九宫格配图 → 字幕 → 竖版成片");

    try {
      await api.runAll(task.id, {
        asr_backend: allAsrBackend || undefined,
        tts_backend: allTtsBackend || undefined,
      });
    } catch (error) {
      pushLog(`❌ 启动失败：${error}`);
      setSmartBusy(false);
      setRunningAll(false);
      return;
    }

    streamPipelineLogs();
    const result = await waitForPipelineSettled();
    allEsRef.current?.close();

    if (result.state === "completed") {
      pushLog("✅ 成片完成：final.mp4");
      setFinalVideo(api.fileUrl(task.id, "final.mp4"));
    } else if (result.state === "failed") {
      pushLog(`❌ 在「${result.failedStep}」中止，请在下方修复后从该步续跑`);
    } else {
      pushLog("⏸ 选稿前的步骤已完成，请在下方选择口播文案版本，再从「6 · TTS 配音」继续");
    }
    try { await onRefresh(); } catch { /* ignore refresh failure */ }
    setExpandTrigger((t) => t + 1);
    setSmartBusy(false);
    setRunningAll(false);
  };

  const saveTitle = async () => {
    const trimmed = titleDraft.trim();
    if (!trimmed || trimmed === task.title) {
      setEditingTitle(false);
      return;
    }
    await api.updateTitle(task.id, trimmed);
    onTitleChange(trimmed);
    setEditingTitle(false);
  };

  return (
    <div className="mx-auto w-full max-w-6xl px-6 py-6 lg:px-8">
      <section className="relative overflow-hidden rounded-3xl border border-gray-800 bg-[radial-gradient(circle_at_top_left,rgba(245,158,11,0.20),transparent_34%),linear-gradient(135deg,rgba(17,24,39,0.98),rgba(3,7,18,0.98))] p-6 shadow-2xl shadow-black/30">
        <div className="absolute right-0 top-0 h-40 w-40 rounded-full bg-brand/10 blur-3xl" />
        <div className="relative grid gap-6 lg:grid-cols-[1fr_280px]">
          <div>
            <div className="mb-3 flex flex-wrap items-center gap-2 text-xs text-gray-400">
              <span className="rounded-full border border-amber-400/30 bg-amber-400/10 px-3 py-1 text-amber-200">
                当前任务
              </span>
              <span>{stepStats.done}/{stepStats.total} 步完成</span>
              {stepStats.error > 0 && <span className="text-red-300">{stepStats.error} 个步骤需要处理</span>}
            </div>

            {editingTitle ? (
              <input
                className="w-full rounded-xl border border-brand bg-gray-950/70 px-4 py-3 text-2xl font-semibold text-gray-50 outline-none"
                value={titleDraft}
                onChange={(e) => setTitleDraft(e.target.value)}
                onBlur={saveTitle}
                onKeyDown={(e) => e.key === "Enter" && saveTitle()}
                autoFocus
              />
            ) : (
              <h2
                className="max-w-3xl cursor-pointer text-2xl font-semibold leading-snug text-gray-50 transition-colors hover:text-amber-200"
                title="点击编辑标题"
                onClick={() => {
                  setTitleDraft(task.title);
                  setEditingTitle(true);
                }}
              >
                {task.title}
              </h2>
            )}
            <p className="mt-3 max-w-3xl break-all font-mono text-xs leading-relaxed text-gray-500">
              {task.douyin_url}
            </p>
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
            <div className="mb-3 flex items-center justify-between text-sm">
              <span className="text-gray-400">制作进度</span>
              <span className="font-semibold text-amber-200">{progressPercent}%</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-gray-800">
              <div
                className="h-full rounded-full bg-gradient-to-r from-amber-400 to-orange-500 transition-all"
                style={{ width: `${progressPercent}%` }}
              />
            </div>
            <div className="mt-4 rounded-xl bg-gray-950/70 p-3">
              <p className="text-xs text-gray-500">下一步</p>
              <p className="mt-1 text-sm font-medium text-gray-100">{stepStats.next.label}</p>
              <p className="mt-1 text-xs text-gray-500">{stepStats.next.desc}</p>
            </div>
          </div>
        </div>
      </section>

      <section className="mt-5 grid gap-5 lg:grid-cols-[320px_1fr]">
        <aside className="space-y-5">
          <div className="rounded-2xl border border-gray-800 bg-gray-900/80 p-4">
            <p className="text-sm font-semibold text-gray-100">一键出片</p>
            <p className="mt-1 text-xs leading-relaxed text-gray-500">
              自动串跑：选题采集 → 逐字稿 → 清洗改写 → 识书 → TTS → 九宫格配图 → 字幕 → 竖版成片。提示词仍沿用我们的文案体系。
            </p>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <label className="block">
                <span className="text-xs text-gray-500">转写</span>
                <select
                  value={allAsrBackend}
                  onChange={(e) => setAllAsrBackend(e.target.value)}
                  title="逐字稿转写后端：本地免费但慢（约2.2倍实时），云端付费但快（几分钟）"
                  className="mt-1 w-full rounded-lg border border-gray-700 bg-gray-950 px-2 py-1.5 text-xs text-gray-200 focus:border-brand focus:outline-none"
                >
                  <option value="">默认(.env)</option>
                  <option value="whisper">本地·免费(慢)</option>
                  <option value="qwen">云端·付费(快)</option>
                </select>
              </label>
              <label className="block">
                <span className="text-xs text-gray-500">配音</span>
                <select
                  value={allTtsBackend}
                  onChange={(e) => setAllTtsBackend(e.target.value)}
                  title="TTS 配音后端：本地免费但慢（约1小时），云端付费但快（约2分钟）"
                  className="mt-1 w-full rounded-lg border border-gray-700 bg-gray-950 px-2 py-1.5 text-xs text-gray-200 focus:border-brand focus:outline-none"
                >
                  <option value="">默认(.env)</option>
                  <option value="qwen">本地·免费(慢)</option>
                  <option value="cosyvoice">云端·付费(快)</option>
                </select>
              </label>
            </div>
            <button
              onClick={handleOneClick}
              disabled={smartBusy}
              className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 py-3 text-sm font-semibold text-white shadow-lg shadow-amber-950/30 transition hover:from-amber-400 hover:to-orange-400 disabled:opacity-50"
            >
              {smartBusy ? (
                <>
                  <span className="h-2 w-2 animate-pulse rounded-full bg-white" />
                  出片中…（可关页面前先等完成）
                </>
              ) : (
                <>🎬 一键出片</>
              )}
            </button>
            {finalVideo && (
              <a
                href={finalVideo}
                target="_blank"
                rel="noreferrer"
                className="mt-3 block rounded-xl border border-green-500/30 bg-green-500/10 px-3 py-2 text-center text-xs font-medium text-green-300 hover:bg-green-500/15"
              >
                ✅ 成片已生成，点击查看
              </a>
            )}
          </div>

          <div className="rounded-2xl border border-gray-800 bg-gray-900/70 p-4">
            <p className="text-sm font-semibold text-gray-100">页面逻辑</p>
            <div className="mt-4 space-y-3">
              {WORKFLOW_STEPS.map((step, index) => {
                const doneCount = STEPS.filter((item) => task.steps[item.key]?.status === "done").length;
                const active = index <= Math.min(doneCount, WORKFLOW_STEPS.length - 1);
                return (
                  <div key={step.code} className="flex items-center gap-3 text-xs">
                    <span
                      className={`flex h-7 w-7 items-center justify-center rounded-full border text-[11px] ${
                        index < Math.floor((doneCount / STEPS.length) * WORKFLOW_STEPS.length)
                          ? "border-green-400 bg-green-400/15 text-green-300"
                          : active
                            ? "border-amber-400 bg-amber-400/10 text-amber-200"
                            : "border-gray-700 bg-gray-800 text-gray-500"
                      }`}
                    >
                      {step.code}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-gray-200">{step.title}</p>
                      <p className="text-gray-600">{step.desc}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </aside>

        <main className="space-y-5">
          {(runningAll || allLogs.length > 0) && (
            <div className="rounded-2xl border border-amber-500/20 bg-gray-950 p-4">
              <div className="mb-3 flex items-center justify-between">
                <p className="text-sm font-semibold text-amber-200">一键出片 · 实时日志</p>
                <button className="text-xs text-gray-500 hover:text-gray-300" onClick={() => setAllLogs([])}>
                  清空
                </button>
              </div>
              <div ref={allLogRef} className="max-h-48 overflow-y-auto font-mono text-xs text-amber-300">
                {allLogs.map((l, i) => (
                  <div key={i} className="leading-relaxed">
                    {l}
                  </div>
                ))}
                {runningAll && <span className="animate-pulse">▋</span>}
              </div>
            </div>
          )}

          <section className="rounded-2xl border border-gray-800 bg-gray-900/50 p-4">
            <div className="mb-4 flex items-end justify-between gap-4">
              <div>
                <p className="text-sm font-semibold text-gray-100">文章式全流程</p>
                <p className="mt-1 text-xs text-gray-500">从抖音链接到 final.mp4 全部挂在同一任务下，所有中间产物可见、可改、可重跑。</p>
              </div>
              <span className="rounded-full bg-gray-800 px-3 py-1 text-xs text-gray-400">
                {stepStats.running ? "运行中" : "可继续"}
              </span>
            </div>
            <div className="space-y-3">
              {STEPS.map((step, idx) => (
                <StepCard
                  key={step.key}
                  taskId={task.id}
                  stepKey={step.key}
                  stepLabel={step.label}
                  stepDesc={`${step.phase} · ${step.desc}`}
                  stepIndex={idx + 1}
                  stepStatus={task.steps[step.key]}
                  onStepComplete={onRefresh}
                  expandTrigger={expandTrigger}
                />
              ))}
            </div>
          </section>

          {task.steps.transcribe?.status === "done" && (
            <section className="rounded-2xl border border-gray-800 bg-gray-900/50 p-4">
              <div className="mb-4">
                <p className="text-sm font-semibold text-gray-100">人工复核区</p>
                <p className="mt-1 text-xs text-gray-500">一键流程失败或需要精修时，在这里复核清洗稿、改写稿、书籍识别和九宫格分镜；提示词不改，用我们的版本。</p>
              </div>
              <WenanWorkshop taskId={task.id} />
              <StoryboardPanel taskId={task.id} />
            </section>
          )}
        </main>
      </section>
    </div>
  );
}


