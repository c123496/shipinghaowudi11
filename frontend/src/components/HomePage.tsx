import { useEffect, useRef, useState } from "react";
import { TaskSummary } from "../api/client";

// 流水线节点：既是产品本身，也是首屏的差异化视觉
const PIPELINE = [
  { zh: "链接", en: "LINK" },
  { zh: "解析", en: "PARSE" },
  { zh: "改写", en: "REWRITE" },
  { zh: "配音", en: "VOICE" },
  { zh: "字幕", en: "SUBTITLE" },
];

// 能力字幕条内容（氛围装饰，缓慢横向滚动）
const CAPS = [
  "本地运行",
  "全程离线",
  "DeepSeek 改写",
  "Whisper 转写",
  "三国克隆声配音",
  "历史写实风配图",
  "逐句字幕",
  "FFmpeg 合成",
];

// 差异化卖点
const FEATURES = [
  {
    no: "01",
    title: "一条链接，全自动到底",
    desc: "解析、改写、配音、字幕、合成一气呵成，中途零手工切换。你只管贴链接，等成片。",
  },
  {
    no: "02",
    title: "本地运行，隐私无忧",
    desc: "所有处理都在你自己的电脑上完成，文案与素材不上传任何服务器，断网也能跑。",
  },
  {
    no: "03",
    title: "独家声音与画面",
    desc: "三国克隆音色配音 + 历史写实风格配图，气质和满屏「AI 味」的带货号天然不一样。",
  },
];

// 滚动渐显容器
function Reveal({
  children,
  delay = 0,
  className = "",
}: {
  children: React.ReactNode;
  delay?: number;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting) {
          setShown(true);
          io.disconnect();
        }
      },
      { threshold: 0.18 }
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    <div
      ref={ref}
      className={`transition-all duration-700 ease-out ${
        shown ? "translate-y-0 opacity-100" : "translate-y-6 opacity-0"
      } ${className}`}
      style={{ transitionDelay: `${delay}ms` }}
    >
      {children}
    </div>
  );
}

export default function HomePage({
  tasks,
  onStart,
  onBrowse,
  onScripts,
  onDiscover,
}: {
  tasks: TaskSummary[];
  onStart: () => void;
  onBrowse: () => void;
  onScripts: () => void;
  onDiscover: () => void;
}) {
  const latest = tasks[0];

  const scrollToMore = () => {
    document.getElementById("more")?.scrollIntoView({ behavior: "smooth" });
  };

  return (
    <div className="relative h-screen w-full overflow-y-auto bg-ink text-gray-100">
      {/* ============ 首屏（约 92vh，刻意露出下方内容一角） ============ */}
      <section className="relative flex min-h-[92vh] flex-col overflow-hidden">
        {/* 背景：极简，仅一束橙色光晕 + 极淡网格 */}
        <div className="pointer-events-none absolute left-1/2 top-[-10%] h-[560px] w-[560px] -translate-x-1/2 rounded-full bg-brand/[0.14] blur-[160px]" />
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.025]"
          style={{
            backgroundImage:
              "linear-gradient(#fff 1px,transparent 1px),linear-gradient(90deg,#fff 1px,transparent 1px)",
            backgroundSize: "56px 56px",
            maskImage: "radial-gradient(ellipse 80% 60% at 50% 40%,#000 40%,transparent 100%)",
            WebkitMaskImage:
              "radial-gradient(ellipse 80% 60% at 50% 40%,#000 40%,transparent 100%)",
          }}
        />
        {/* 底部渐隐，暗示下方还有内容 */}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-32 bg-gradient-to-t from-ink to-transparent" />

        {/* 顶栏 */}
        <header className="relative z-10 mx-auto flex w-full max-w-6xl items-center justify-between px-8 py-6">
          <div className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-amber-400 to-orange-600 text-sm shadow-lg shadow-orange-900/30">
              🎬
            </span>
            <span className="text-[15px] font-bold tracking-tight text-gray-50">视频号爆款</span>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={onDiscover}
              className="rounded-full px-3.5 py-1.5 font-mono text-[13px] text-gray-400 transition hover:text-white"
            >
              🔥 找爆款
            </button>
            <button
              onClick={onScripts}
              className="rounded-full px-3.5 py-1.5 font-mono text-[13px] text-gray-400 transition hover:text-white"
            >
              文案库
            </button>
            <button
              onClick={onBrowse}
              className="rounded-full px-3.5 py-1.5 font-mono text-[13px] text-gray-400 transition hover:text-white"
            >
              我的作品
              {tasks.length > 0 && <span className="ml-1 text-brand">{tasks.length}</span>}
            </button>
          </div>
        </header>

        {/* 主体 */}
        <div className="relative z-10 mx-auto grid w-full max-w-6xl flex-1 grid-cols-1 items-center gap-16 px-8 lg:grid-cols-[1fr_360px]">
          {/* 左：一句话讲清「做什么」+ 唯一主 CTA */}
          <div>
            <div
              className="mb-7 inline-flex animate-rise items-center gap-2 font-mono text-[12px] uppercase tracking-[0.18em] text-brand"
              style={{ animationDelay: "0ms" }}
            >
              <span className="h-1.5 w-1.5 animate-breathe rounded-full bg-brand" />
              AI 图书带货视频流水线
            </div>

            <h1
              className="animate-rise text-[3.25rem] font-black leading-[1.06] tracking-tight text-gray-50 lg:text-[4.25rem]"
              style={{ animationDelay: "80ms" }}
            >
              把一条链接，
              <br />
              变成
              <span className="relative whitespace-nowrap">
                <span className="bg-gradient-to-r from-amber-300 via-orange-400 to-orange-500 bg-clip-text text-transparent">
                  带货爆款
                </span>
              </span>
              视频
            </h1>

            <p
              className="mt-6 max-w-md animate-rise text-[15px] leading-relaxed text-gray-400"
              style={{ animationDelay: "160ms" }}
            >
              粘贴抖音 / 视频号链接，自动完成解析、文案改写、AI 配音、字幕与合成——
              <span className="text-gray-300">全程不用切换任何软件。</span>
            </p>

            <div
              className="mt-10 flex animate-rise flex-wrap items-center gap-5"
              style={{ animationDelay: "240ms" }}
            >
              <button
                onClick={onStart}
                className="group relative flex items-center gap-2 overflow-hidden rounded-xl bg-gradient-to-r from-amber-400 to-orange-500 px-7 py-3.5 text-[16px] font-bold text-ink shadow-[0_8px_30px_-6px_rgba(249,115,22,0.55)] transition hover:shadow-[0_10px_36px_-6px_rgba(249,115,22,0.7)] active:scale-[0.98]"
              >
                <span className="absolute inset-0 -translate-x-full bg-white/30 transition-transform duration-500 group-hover:translate-x-full" />
                <span className="relative">一键制作爆款</span>
                <span className="relative transition-transform group-hover:translate-x-0.5">→</span>
              </button>
              <button
                onClick={onBrowse}
                className="rounded-xl border border-white/10 px-6 py-3.5 text-[15px] text-gray-300 transition hover:border-white/25 hover:text-white"
              >
                浏览作品
              </button>
            </div>

            {latest && (
              <button
                onClick={onBrowse}
                className="mt-5 animate-rise font-mono text-[13px] text-gray-500 transition hover:text-gray-300"
                style={{ animationDelay: "320ms" }}
              >
                ↳ 继续上次：{latest.title.slice(0, 16)}…
              </button>
            )}
          </div>

          {/* 右：竖版 9:16 框里的「自动流水线」——差异化视觉 */}
          <div
            className="hidden animate-rise justify-center lg:flex"
            style={{ animationDelay: "200ms" }}
          >
            <div className="relative">
              <div className="absolute -inset-6 rounded-[2.4rem] bg-gradient-to-b from-brand/15 to-transparent blur-2xl" />
              <div className="relative aspect-[9/16] w-[320px] overflow-hidden rounded-[1.8rem] border border-white/10 bg-gradient-to-b from-gray-900/80 to-ink shadow-2xl shadow-black/60">
                <div className="flex items-center justify-between border-b border-white/5 px-5 py-4 font-mono text-[11px] text-gray-500">
                  <span className="flex items-center gap-1.5">
                    <span className="h-1.5 w-1.5 animate-breathe rounded-full bg-brand" />
                    AUTO PIPELINE
                  </span>
                  <span>9:16</span>
                </div>

                <div className="relative px-6 py-6">
                  <div className="absolute bottom-6 left-[2.45rem] top-6 w-px bg-white/10">
                    <span className="absolute left-1/2 h-16 w-px -translate-x-1/2 animate-flow bg-gradient-to-b from-transparent via-brand to-transparent shadow-[0_0_8px_2px_rgba(249,115,22,0.5)]" />
                  </div>

                  <div className="relative space-y-3.5">
                    {PIPELINE.map((step, i) => (
                      <div key={step.en} className="flex items-center gap-3.5">
                        <span className="z-10 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full border border-white/15 bg-ink font-mono text-[10px] text-gray-400">
                          {i + 1}
                        </span>
                        <div className="flex flex-1 items-baseline justify-between border-b border-white/5 pb-2">
                          <span className="text-[14px] text-gray-200">{step.zh}</span>
                          <span className="font-mono text-[10px] uppercase tracking-wider text-gray-600">
                            {step.en}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="relative mt-5 flex items-center gap-3.5">
                    <span className="z-10 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-amber-400 to-orange-500 font-mono text-[10px] text-ink shadow-[0_0_12px_2px_rgba(249,115,22,0.6)]">
                      ✓
                    </span>
                    <div className="flex-1 overflow-hidden rounded-xl border border-brand/30 bg-brand/[0.08] p-3">
                      <div className="flex items-center justify-between">
                        <span className="text-[14px] font-semibold text-amber-200">成片</span>
                        <span className="font-mono text-[10px] uppercase tracking-wider text-brand">
                          EXPORT
                        </span>
                      </div>
                      <div className="mt-2.5 rounded-md bg-black/50 px-2.5 py-1.5 text-center text-[12px] font-medium text-white">
                        这本书，我一口气读完了
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* 滚动暗示：设计语言告诉用户「下面还有好东西」 */}
        <button
          onClick={scrollToMore}
          className="relative z-10 mx-auto mb-7 mt-4 flex flex-col items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.2em] text-gray-600 transition hover:text-gray-300"
        >
          往下看
          <svg
            className="h-4 w-4 animate-nudge"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="m6 9 6 6 6-6" />
          </svg>
        </button>
      </section>

      {/* ============ 能力字幕条（缓慢滚动的氛围装饰） ============ */}
      <div className="relative overflow-hidden border-y border-white/5 bg-white/[0.015] py-4">
        <div
          className="flex w-max animate-marquee gap-3 [animation-play-state:running] hover:[animation-play-state:paused]"
          aria-hidden
        >
          {[...CAPS, ...CAPS].map((c, i) => (
            <span
              key={i}
              className="flex items-center gap-2 whitespace-nowrap rounded-full border border-white/5 px-4 py-1.5 font-mono text-[12px] text-gray-500"
            >
              <span className="h-1 w-1 rounded-full bg-brand/60" />
              {c}
            </span>
          ))}
        </div>
        {/* 两侧渐隐遮罩，避免突兀 */}
        <div className="pointer-events-none absolute inset-y-0 left-0 w-24 bg-gradient-to-r from-ink to-transparent" />
        <div className="pointer-events-none absolute inset-y-0 right-0 w-24 bg-gradient-to-l from-ink to-transparent" />
      </div>

      {/* ============ 差异化卖点 ============ */}
      <section id="more" className="mx-auto max-w-6xl px-8 py-24">
        <Reveal>
          <p className="font-mono text-[12px] uppercase tracking-[0.18em] text-brand">
            为什么不一样
          </p>
          <h2 className="mt-3 max-w-xl text-[2rem] font-black leading-tight tracking-tight text-gray-50 lg:text-[2.5rem]">
            别人在拼命剪辑，
            <br />
            你只是<span className="text-amber-300">贴了一条链接</span>。
          </h2>
        </Reveal>

        <div className="mt-14 grid grid-cols-1 gap-5 md:grid-cols-3">
          {FEATURES.map((f, i) => (
            <Reveal key={f.no} delay={i * 110}>
              <div className="group h-full rounded-2xl border border-white/8 bg-white/[0.02] p-7 transition hover:border-brand/30 hover:bg-white/[0.04]">
                <div className="font-mono text-[13px] text-brand/70">{f.no}</div>
                <h3 className="mt-4 text-[18px] font-bold text-gray-50">{f.title}</h3>
                <p className="mt-3 text-[14px] leading-relaxed text-gray-400">{f.desc}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      {/* ============ 底部 CTA ============ */}
      <section className="relative overflow-hidden border-t border-white/5 px-8 py-24">
        <div className="pointer-events-none absolute left-1/2 top-1/2 h-[400px] w-[700px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-brand/[0.10] blur-[150px]" />
        <Reveal className="relative mx-auto max-w-2xl text-center">
          <h2 className="text-[2.25rem] font-black tracking-tight text-gray-50 lg:text-[3rem]">
            一条链接，现在就开始。
          </h2>
          <p className="mx-auto mt-5 max-w-md text-[15px] leading-relaxed text-gray-400">
            从解析到成片，全程本地、全程自动。下一条爆款，可能就差这一次粘贴。
          </p>
          <button
            onClick={onStart}
            className="group relative mt-10 inline-flex items-center gap-2 overflow-hidden rounded-xl bg-gradient-to-r from-amber-400 to-orange-500 px-9 py-4 text-[17px] font-bold text-ink shadow-[0_10px_36px_-6px_rgba(249,115,22,0.6)] transition hover:shadow-[0_14px_44px_-6px_rgba(249,115,22,0.75)] active:scale-[0.98]"
          >
            <span className="absolute inset-0 -translate-x-full bg-white/30 transition-transform duration-500 group-hover:translate-x-full" />
            <span className="relative">一键制作爆款</span>
            <span className="relative transition-transform group-hover:translate-x-0.5">→</span>
          </button>
        </Reveal>

        <p className="relative mt-16 text-center font-mono text-[11px] tracking-wide text-gray-600">
          本地运行 · 全程离线 · DeepSeek 改写 · Whisper 转写 · Edge / 克隆配音 · FFmpeg 合成
        </p>
      </section>
    </div>
  );
}
