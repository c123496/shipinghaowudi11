import type { Metadata } from "next";
import "./globals.css";
import Link from "next/link";

export const metadata: Metadata = {
  title: "文案工坊 | 视频号文案创新平台",
  description: "基于风格克隆的视频号深度文案创作工具",
};

const navItems = [
  { href: "/quickgen", label: "一键成稿" },
  { href: "/", label: "控制台" },
  { href: "/scraper", label: "爆款监控" },
  { href: "/library", label: "文案库" },
  { href: "/analyze", label: "风格分析" },
  { href: "/generate", label: "文案生成" },
  { href: "/humanize", label: "人性化改写" },
];

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" className="h-full antialiased">
      <body className="min-h-full flex flex-col" suppressHydrationWarning>
        <nav className="sticky top-0 z-50 bg-surface/80 backdrop-blur-md border-b border-border">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex items-center justify-between h-14">
              <Link href="/" className="text-lg font-bold text-primary tracking-wide">
                文案工坊
              </Link>
              <div className="flex gap-1">
                {navItems.map(item => (
                  <Link
                    key={item.href}
                    href={item.href}
                    className="px-3 py-1.5 text-sm rounded-md text-muted hover:text-foreground hover:bg-surface-hover transition-colors"
                  >
                    {item.label}
                  </Link>
                ))}
              </div>
            </div>
          </div>
        </nav>
        <main className="flex-1 max-w-7xl mx-auto w-full px-4 sm:px-6 lg:px-8 py-6">
          {children}
        </main>
      </body>
    </html>
  );
}
