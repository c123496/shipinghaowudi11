import { useState, useEffect } from "react";
import { api, StoryboardData, StoryboardVideoVariant } from "../api/client";

export default function StoryboardPanel({ taskId }: { taskId: string }) {
  const [data, setData] = useState<StoryboardData>({});
  const [bookTitle, setBookTitle] = useState("");
  const [bookAuthor, setBookAuthor] = useState("");
  const [mode, setMode] = useState("9:16");
  const [style, setStyle] = useState<"hybrid" | "ai" | "real">("hybrid");
  const [source, setSource] = useState<"rewrite" | "dedup">("rewrite");
  const [imageCount, setImageCount] = useState<number | "">("");
  const [open, setOpen] = useState(false);
  const [tick, setTick] = useState(0);
  const [videos, setVideos] = useState<Record<string, StoryboardVideoVariant>>({});
  const [videoBusy, setVideoBusy] = useState<"rewrite" | "dedup" | "">("");

  useEffect(() => {
    api.getStoryboard(taskId).then((d) => {
      setData(d || {});
      if (d?.mode) setMode(d.mode);
      if (d?.source === "rewrite" || d?.source === "dedup") setSource(d.source);
      const n = d?.image_count ?? d?.ref_image_count;
      if (n) setImageCount(n);
    });
    api.getWenan(taskId).then((w) => {
      if (w?.book?.book_title) setBookTitle(w.book.book_title);
      if (w?.book?.book_author) setBookAuthor(w.book.book_author);
    });
    api.getStoryboardVideos(taskId).then(setVideos);
  }, [taskId]);

  // 有任务在生成时轮询
  useEffect(() => {
    const generating = Object.values(data.grids || {}).some((g) => g.status === "generating");
    if (!generating) return;
    const iv = setInterval(async () => {
      setData(await api.getStoryboard(taskId));
      setTick((t) => t + 1);
    }, 5000);
    return () => clearInterval(iv);
  }, [data, taskId]);

  const prepare = async () => {
    const d = await api.prepareStoryboard(
      taskId, mode, source, typeof imageCount === "number" ? imageCount : undefined
    );
    setData(d);
    const n = d?.image_count ?? d?.ref_image_count;
    if (n) setImageCount(n);
  };

  const generate = async (idx: number) => {
    await api.generateStoryboard(taskId, { grid_index: idx, book_title: bookTitle, book_author: bookAuthor, mode, style });
    setData(await api.getStoryboard(taskId));
  };

  const generateVideo = async (variant: "rewrite" | "dedup") => {
    setVideoBusy(variant);
    try {
      await api.generateStoryboardVideo(taskId, variant);
      setVideos(await api.getStoryboardVideos(taskId));
    } catch (error) {
      alert(`生成视频失败：${error}`);
    } finally {
      setVideoBusy("");
    }
  };

  const batches = data.batches || [];
  const doneGridCount = Object.values(data.grids || {}).filter((grid) => grid.status === "done").length;

  return (
    <div className="mt-6 bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
      <div className="flex items-center gap-3 px-5 py-4 cursor-pointer hover:bg-gray-800/50" onClick={() => setOpen((v) => !v)}>
        <span className="font-semibold text-gray-100">E · 九宫格成片</span>
        <span className="text-xs text-gray-500">只能使用 B 口播改写 或 C 二创改写 的文稿</span>
        <span className="ml-auto text-gray-500 text-sm">{open ? "▾" : "▸"}</span>
      </div>

      {open && (
        <div className="border-t border-gray-800 p-5 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="block text-xs text-gray-400 mb-1.5">书名（用于风格主题）</span>
              <input className="input" value={bookTitle} onChange={(e) => setBookTitle(e.target.value)} placeholder="可从「文案工坊 D」识别后自动带入" />
            </label>
            <label className="block">
              <span className="block text-xs text-gray-400 mb-1.5">作者</span>
              <input className="input" value={bookAuthor} onChange={(e) => setBookAuthor(e.target.value)} />
            </label>
          </div>

          <div className="rounded-xl border border-gray-800 bg-gray-950/50 p-4 space-y-3">
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-xs text-gray-400">文稿来源</span>
              {[
                { key: "rewrite", label: "B 口播改写" },
                { key: "dedup", label: "C 二创改写" },
              ].map((item) => (
                <button key={item.key} onClick={() => setSource(item.key as "rewrite" | "dedup")}
                  className={`text-xs px-3 py-1 rounded-full border ${source === item.key ? "border-amber-400 text-amber-200 bg-amber-400/10" : "border-gray-700 text-gray-400"}`}>
                  {item.label}
                </button>
              ))}
            </div>
            <p className="text-xs text-gray-500">选 B 就用口播改写生成九宫格和视频；选 C 就用二创改写稿生成。A 清洗稿、原逐字稿、旧 pipeline 改写都不会进入成片。</p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <span className="text-xs text-gray-400">裁切比例</span>
            {["9:16", "16:9"].map((m) => (
              <button key={m} onClick={() => setMode(m)}
                className={`text-xs px-3 py-1 rounded-full border ${mode === m ? "border-brand text-brand" : "border-gray-700 text-gray-400"}`}>
                {m}
              </button>
            ))}
            <label className="ml-auto flex items-center gap-2 text-xs text-gray-400">
              分镜图张数
              <input
                type="number"
                min={1}
                max={36}
                value={imageCount}
                onChange={(e) => setImageCount(e.target.value === "" ? "" : Number(e.target.value))}
                placeholder="自动"
                className="w-16 bg-gray-800 border border-gray-700 rounded px-2 py-1 text-center text-gray-100"
              />
            </label>
            <button className="btn-run" onClick={prepare}>
              {batches.length ? "重新分段" : "准备分段"}
            </button>
          </div>
          <p className="text-xs text-gray-500">
            留空＝自动按对标视频检测的画面张数；也可手填想要的张数（越少越省钱）。
            {data.ref_image_count ? `当前对标检测约 ${data.ref_image_count} 张。` : ""}
          </p>

          <div className="flex flex-wrap items-center gap-3">
            <span className="text-xs text-gray-400">画面风格</span>
            {[
              { key: "hybrid", label: "混合（真名画+AI史诗）" },
              { key: "real", label: "尽量真名画" },
              { key: "ai", label: "纯 AI 史诗" },
            ].map((item) => (
              <button key={item.key} onClick={() => setStyle(item.key as "hybrid" | "ai" | "real")}
                className={`text-xs px-3 py-1 rounded-full border ${style === item.key ? "border-amber-400 text-amber-200 bg-amber-400/10" : "border-gray-700 text-gray-400"}`}>
                {item.label}
              </button>
            ))}
            <span className="text-xs text-gray-500 w-full">命中历史题材的格子用真实传世名画（零 AI 痕迹），其余用 AI 史诗风。纯古画画面更稳、更易过审。</span>
          </div>

          {batches.length > 0 && (
            <p className="text-xs text-gray-500">
              当前来源：{data.source === "dedup" ? "C 二创改写" : "B 口播改写"}；共 {batches.length} 组九宫格（成片实际用约 {data.image_count ?? batches.length * 9} 张图）。逐组生成，每组约 1-5 分钟、约 $0.04（medium 画质）。
            </p>
          )}

          <div className="space-y-4">
            {batches.map((briefs, i) => (
              <Batch key={i} taskId={taskId} index={i + 1} briefs={briefs}
                grid={data.grids?.[String(i + 1)]} tick={tick} onGenerate={() => generate(i + 1)} />
            ))}
          </div>

          <VideoVariantBuilder
            taskId={taskId}
            doneGridCount={doneGridCount}
            videos={videos}
            busy={videoBusy}
            onGenerate={generateVideo}
          />
        </div>
      )}
    </div>
  );
}

function Batch({
  taskId, index, briefs, grid, tick, onGenerate,
}: {
  taskId: string; index: number; briefs: string[];
  grid?: { status: string; grid?: string; cells?: string[]; error?: string };
  tick: number; onGenerate: () => void;
}) {
  const [show, setShow] = useState(false);
  const generating = grid?.status === "generating";
  const bust = `?t=${tick}`;

  return (
    <div className="bg-gray-950/60 border border-gray-800 rounded-lg p-4 space-y-3">
      <div className="flex items-center gap-3">
        <span className="text-sm font-medium text-gray-100">第 {index} 组</span>
        <button className="text-xs text-gray-500 hover:text-gray-300" onClick={() => setShow((v) => !v)}>
          {show ? "收起 briefs" : "看 9 段 briefs"}
        </button>
        <button className="btn-run ml-auto" disabled={generating} onClick={onGenerate}>
          {generating ? "生成中…" : grid?.status === "done" ? "重生成" : "生成"}
        </button>
      </div>

      {show && (
        <ol className="text-xs text-gray-400 list-decimal pl-5 space-y-0.5">
          {briefs.map((b, j) => <li key={j}>{b}</li>)}
        </ol>
      )}

      {grid?.status === "error" && <p className="text-xs text-red-400">生成失败：{grid.error}</p>}

      {grid?.status === "done" && grid.grid && (
        <div className="space-y-2">
          <a href={api.fileUrl(taskId, grid.grid) + bust} target="_blank" rel="noreferrer">
            <img src={api.fileUrl(taskId, grid.grid) + bust} className="w-full rounded-lg border border-gray-800" />
          </a>
          {grid.cells && (
            <div className="flex flex-wrap gap-2">
              {grid.cells.map((c, j) => (
                <a key={j} href={api.fileUrl(taskId, c) + bust} download className="block">
                  <img src={api.fileUrl(taskId, c) + bust} className="h-20 rounded border border-gray-800 hover:border-brand" />
                </a>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function VideoVariantBuilder({
  taskId,
  doneGridCount,
  videos,
  busy,
  onGenerate,
}: {
  taskId: string;
  doneGridCount: number;
  videos: Record<string, StoryboardVideoVariant>;
  busy: "rewrite" | "dedup" | "";
  onGenerate: (variant: "rewrite" | "dedup") => void;
}) {
  const disabled = doneGridCount === 0 || Boolean(busy);
  return (
    <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-amber-100">用九宫格生成两个成片版本</p>
          <p className="mt-1 text-xs leading-relaxed text-gray-500">
            逻辑：共用同一批分镜图片和当前配音；口播改写版节奏更稳，二创改写版镜头更快，方便同素材发布两个不一样的视频。
          </p>
        </div>
        <span className="rounded-full bg-gray-950 px-3 py-1 text-xs text-gray-400">
          已有 {doneGridCount} 组分镜
        </span>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <VariantCard
          taskId={taskId}
          title="A · 口播改写版"
          desc="使用 B 口播改写文稿重新配音，镜头停留更久，适合主号发布。"
          variant="rewrite"
          video={videos.rewrite}
          busy={busy === "rewrite"}
          disabled={disabled || videos.rewrite?.storyboard_ready === false || videos.rewrite?.script_ready === false}
          onGenerate={onGenerate}
        />
        <VariantCard
          taskId={taskId}
          title="B · 二创改写版"
          desc="使用 C 二创改写文稿重新配音，镜头切换更快，适合二发测试。"
          variant="dedup"
          video={videos.dedup}
          busy={busy === "dedup"}
          disabled={disabled || videos.dedup?.storyboard_ready === false || videos.dedup?.script_ready === false}
          onGenerate={onGenerate}
        />
      </div>

      {doneGridCount === 0 && (
        <p className="mt-3 text-xs text-red-300">请先至少生成一组九宫格图片，再生成两个视频版本。</p>
      )}
    </div>
  );
}

function VariantCard({
  taskId,
  title,
  desc,
  variant,
  video,
  busy,
  disabled,
  onGenerate,
}: {
  taskId: string;
  title: string;
  desc: string;
  variant: "rewrite" | "dedup";
  video?: StoryboardVideoVariant;
  busy: boolean;
  disabled: boolean;
  onGenerate: (variant: "rewrite" | "dedup") => void;
}) {
  return (
    <div className="rounded-lg border border-gray-800 bg-gray-950/70 p-4">
      <p className="text-sm font-medium text-gray-100">{title}</p>
      <p className="mt-1 min-h-9 text-xs leading-relaxed text-gray-500">{desc}</p>
      {video?.stale && (
        <p className="mt-3 rounded-lg border border-red-500/20 bg-red-500/10 p-2 text-xs text-red-300">
          文稿或配音已更新，当前视频已过期，请重新生成。
        </p>
      )}
      {video?.storyboard_ready === false && (
        <p className="mt-3 rounded-lg border border-amber-500/20 bg-amber-500/10 p-2 text-xs text-amber-200">
          当前九宫格不是这个版本，请先在上方切换文稿来源并重新准备、生成图片。
        </p>
      )}
      {video?.script_ready === false && (
        <p className="mt-3 rounded-lg border border-red-500/20 bg-red-500/10 p-2 text-xs text-red-300">
          缺少文稿，请先在文案工坊完成 B 口播改写 或 C 二创改写。
        </p>
      )}
      {video?.exists && (
        <div className="mt-3 space-y-2">
          <video
            key={video.file}
            src={api.fileUrl(taskId, video.file)}
            controls
            className="w-full rounded-lg border border-gray-800 bg-black"
            style={{ maxHeight: 360 }}
          />
          <div className="flex items-center justify-between text-xs text-gray-500">
            <span>{video.duration ? `时长 ${video.duration.toFixed(1)}s` : ""}{video.script_chars ? ` · ${video.script_chars} 字` : ""}</span>
            <a
              className="rounded-md border border-gray-700 px-2 py-1 text-brand hover:border-brand"
              href={api.fileUrl(taskId, video.file)}
              download
            >
              ⬇ 下载
            </a>
          </div>
        </div>
      )}
      <button
        className="btn-run mt-3 w-full"
        disabled={disabled}
        onClick={() => onGenerate(variant)}
      >
        {busy ? "生成中…" : video?.exists ? "重新生成" : "生成视频"}
      </button>
    </div>
  );
}



