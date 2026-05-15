import Link from "next/link";

const modules = [
  {
    href: "/library",
    title: "文案库",
    desc: "上传、管理、浏览你的视频号文案收藏。支持粘贴文本和文件上传，自动提取标签。",
    icon: "📚",
  },
  {
    href: "/analyze",
    title: "风格分析",
    desc: "深度分析每篇文案的写作 DNA——开篇钩子、叙事节奏、情感曲线、文化引用、受众共鸣点。",
    icon: "🔬",
  },
  {
    href: "/generate",
    title: "文案生成",
    desc: "输入主题，选择风格参考，基于你的文案风格 DNA 生成新文案，支持多角度版本。",
    icon: "✍️",
  },
  {
    href: "/humanize",
    title: "人性化改写",
    desc: "消除 AI 写作痕迹——过度排比、模板过渡词、结尾说教，让文案读起来像人写的。",
    icon: "🎭",
  },
];

export default function Home() {
  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-foreground">文案工坊</h1>
        <p className="text-muted mt-1">视频号深度文案的一站式创作平台</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {modules.map(m => (
          <Link
            key={m.href}
            href={m.href}
            className="group block p-6 bg-surface rounded-xl border border-border hover:border-primary-light hover:shadow-md transition-all"
          >
            <div className="flex items-start gap-4">
              <span className="text-3xl">{m.icon}</span>
              <div>
                <h2 className="text-lg font-semibold text-foreground group-hover:text-primary transition-colors">
                  {m.title}
                </h2>
                <p className="mt-1 text-sm text-muted leading-relaxed">{m.desc}</p>
              </div>
            </div>
          </Link>
        ))}
      </div>

      <div className="mt-10 p-5 bg-surface rounded-xl border border-border">
        <h3 className="font-semibold text-foreground mb-2">快速开始</h3>
        <ol className="text-sm text-muted space-y-1.5 list-decimal list-inside">
          <li>进入<strong>文案库</strong>，粘贴或上传你的第一篇文案</li>
          <li>在<strong>风格分析</strong>中，对该文案运行分析，获取风格指纹</li>
          <li>到<strong>文案生成</strong>，输入主题词（如&ldquo;钱锺书的学人风骨&rdquo;），生成新文案</li>
          <li>最后用<strong>人性化改写</strong>对生成内容进行去 AI 味处理</li>
        </ol>
      </div>
    </div>
  );
}
