/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          DEFAULT: "#f97316",
          dark: "#ea580c",
        },
        ink: "#070708", // 落地页专用近黑（neon 风格），不影响其余页面
        // —— 全站中性深灰阶梯（重定义默认 gray）——
        // 解决「死黑 + 灰字看不清」：背景不再纯黑、卡片浮起、文字提亮去蓝调。
        // 落地页用 bg-ink，背景不受影响。
        gray: {
          50: "#f7f8f8",
          100: "#f2f3f5", // 标题
          200: "#e4e6ea", // 强调正文
          300: "#ced2d8", // 主要正文
          400: "#adb2ba", // 常规正文（原 #9ca3af 提亮去蓝）
          500: "#8e929a", // 次要说明
          600: "#71747b", // 最弱：时间戳 / 占位 / 页脚
          700: "#3c3f45", // 次级边框 / 分隔线 / hover 边框
          800: "#2c2e33", // 边框 / 输入底（叠在面板上清晰可见）
          900: "#202125", // 卡片 / 面板 / 侧栏（浮在背景上）
          950: "#17181a", // 页面背景（中性深灰，不死黑）
        },
      },
      fontFamily: {
        // 本地等宽字体（Windows 自带 Consolas / Cascadia），承载技术感标签，无需联网加载
        mono: [
          "Cascadia Code",
          "Cascadia Mono",
          "Consolas",
          "SFMono-Regular",
          "ui-monospace",
          "monospace",
        ],
      },
      keyframes: {
        // 入场：自下而上淡入
        rise: {
          "0%": { opacity: "0", transform: "translateY(16px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        // 流水线脉冲：橙色光点沿竖线自上而下流动
        flow: {
          "0%": { top: "-12%", opacity: "0" },
          "12%": { opacity: "1" },
          "88%": { opacity: "1" },
          "100%": { top: "108%", opacity: "0" },
        },
        // 呼吸光点
        breathe: {
          "0%,100%": { opacity: "1", transform: "scale(1)" },
          "50%": { opacity: "0.4", transform: "scale(0.85)" },
        },
        // 能力字幕条：无缝横向滚动（氛围装饰）
        marquee: {
          "0%": { transform: "translateX(0)" },
          "100%": { transform: "translateX(-50%)" },
        },
        // 滚动暗示：向下轻轻点动
        nudge: {
          "0%,100%": { transform: "translateY(0)", opacity: "0.5" },
          "50%": { transform: "translateY(6px)", opacity: "1" },
        },
      },
      animation: {
        rise: "rise 0.7s cubic-bezier(0.22,1,0.36,1) both",
        flow: "flow 3.2s cubic-bezier(0.45,0,0.55,1) infinite",
        breathe: "breathe 2.4s ease-in-out infinite",
        marquee: "marquee 34s linear infinite",
        nudge: "nudge 1.8s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};
