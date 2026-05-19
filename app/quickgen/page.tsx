'use client';

import { useState, useCallback } from 'react';
import { DEFAULT_SETTINGS } from '@/lib/prompts/humanize';

const STEPS = ['识别题材', '诊断AI味', '拆解爆款结构', '重写口播稿', '生成配图提示词'];

interface ImagePrompt {
  scene: string;
  cn: string;
  en: string;
  style: string;
}

function copyToClipboard(text: string) {
  navigator.clipboard.writeText(text).catch(() => {});
}

function CopyBtn({ text, label = '复制' }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => { copyToClipboard(text); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
      className="text-xs px-2 py-1 rounded border border-border text-muted hover:text-foreground hover:border-primary-light transition-colors shrink-0"
    >
      {copied ? '✓ 已复制' : label}
    </button>
  );
}

interface GeneratedImage {
  url: string;
  loading: boolean;
  error: string;
}

async function downloadImage(url: string, filename: string) {
  try {
    const res = await fetch(url);
    const blob = await res.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    URL.revokeObjectURL(a.href);
  } catch {
    window.open(url, '_blank');
  }
}

/** Cookie 设置引导卡片 */
function CookieSetupGuide() {
  return (
    <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl space-y-3">
      <div className="flex items-center gap-2">
        <span className="text-amber-600 text-base">🍪</span>
        <p className="text-sm font-semibold text-amber-800">需要一次性设置 Cookie，才能提取抖音文案</p>
      </div>
      <div className="space-y-2 text-xs text-amber-700 leading-6">
        <p className="font-medium">操作步骤（只需做一次）：</p>
        <ol className="list-decimal list-inside space-y-1 pl-1">
          <li>在 Chrome 浏览器安装扩展：<span className="font-mono bg-amber-100 px-1 rounded">Get cookies.txt LOCALLY</span></li>
          <li>打开 <span className="font-mono">douyin.com</span> 并确保已登录抖音</li>
          <li>点击扩展图标 → <strong>Export</strong> → 保存为 <span className="font-mono">douyin.txt</span></li>
          <li>
            把文件放到项目目录：
            <span className="block font-mono bg-amber-100 px-2 py-0.5 rounded mt-0.5 break-all">
              D:\图片\视频号爆款文案\cookies\douyin.txt
            </span>
          </li>
          <li>刷新此页面，重新粘贴链接即可</li>
        </ol>
      </div>
      <a
        href="https://chromewebstore.google.com/detail/get-cookiestxt-locally/cclelndahbckbenkjhflpdbgdldlbecc"
        target="_blank"
        rel="noopener noreferrer"
        className="inline-block text-xs px-3 py-1.5 bg-amber-500 text-white rounded-lg hover:bg-amber-600 transition-colors"
      >
        打开 Chrome 扩展商店 →
      </a>
    </div>
  );
}

/** 视频号说明卡片 */
function WeixinGuide() {
  return (
    <div className="p-4 bg-blue-50 border border-blue-200 rounded-xl space-y-2">
      <div className="flex items-center gap-2">
        <span className="text-blue-600 text-base">📱</span>
        <p className="text-sm font-semibold text-blue-800">视频号暂不支持自动提取</p>
      </div>
      <div className="text-xs text-blue-700 leading-6 space-y-1">
        <p>视频号内容在微信内网，无法通过外部工具访问。</p>
        <p className="font-medium">替代方法：</p>
        <ol className="list-decimal list-inside pl-1 space-y-1">
          <li>在视频号中打开视频并播放</li>
          <li>开启视频字幕（点击右下角字幕按钮）</li>
          <li>手动记录或截图后整理文案</li>
          <li>切回「粘贴文案」选项卡粘贴进来</li>
        </ol>
      </div>
    </div>
  );
}

type ExtractErrorType = 'NEED_COOKIES' | 'WEIXIN_NOT_SUPPORTED' | 'GENERIC' | null;

export default function QuickGenPage() {
  const [inputMode, setInputMode] = useState<'paste' | 'link'>('paste');
  const [input, setInput] = useState('');
  const [linkInput, setLinkInput] = useState('');
  const [extracting, setExtracting] = useState(false);
  const [extractErrorType, setExtractErrorType] = useState<ExtractErrorType>(null);
  const [extractErrorMsg, setExtractErrorMsg] = useState('');

  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState(0);
  const [script, setScript] = useState('');
  const [imagePrompts, setImagePrompts] = useState<ImagePrompt[]>([]);
  const [generatedImages, setGeneratedImages] = useState<Record<number, GeneratedImage>>({});
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');

  const handleExtract = useCallback(async () => {
    const val = linkInput.trim();
    if (!val) return;
    setExtracting(true);
    setExtractErrorType(null);
    setExtractErrorMsg('');
    try {
      const res = await fetch('/api/extract-script', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: val }),
      });
      const data = await res.json();
      if (data.error) {
        if (data.error === 'NEED_COOKIES') {
          setExtractErrorType('NEED_COOKIES');
        } else if (data.error === 'WEIXIN_NOT_SUPPORTED') {
          setExtractErrorType('WEIXIN_NOT_SUPPORTED');
        } else {
          setExtractErrorType('GENERIC');
          setExtractErrorMsg(data.error);
        }
      } else {
        setInput(data.script);
        setInputMode('paste');
        setLinkInput('');
      }
    } catch (e) {
      setExtractErrorType('GENERIC');
      setExtractErrorMsg('网络请求失败：' + (e instanceof Error ? e.message : String(e)));
    } finally {
      setExtracting(false);
    }
  }, [linkInput]);

  const handleGenerate = useCallback(async () => {
    if (input.trim().length < 10) return;
    setLoading(true);
    setError('');
    setScript('');
    setImagePrompts([]);
    setGeneratedImages({});
    setStep(0);
    setCopied(false);

    const timer = setInterval(() => setStep(s => Math.min(s + 1, STEPS.length - 1)), 4000);

    try {
      const res = await fetch('/api/humanize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: input, settings: DEFAULT_SETTINGS, mode: 'humanize' }),
      });
      const data = await res.json();
      const clean = (text: string) => text.replace(/\n{2,}/g, '\n').trim();
      if (data.error && !data.rawText) {
        setError(data.error);
      } else if (data.parseFailed && data.rawText) {
        setScript(clean(data.rawText));
      } else {
        setScript(clean(data.mainScript?.spokenVersion || data.rawText || ''));
        if (Array.isArray(data.imagePrompts)) setImagePrompts(data.imagePrompts);
      }
    } catch (e) {
      setError('请求失败：' + (e instanceof Error ? e.message : String(e)));
    } finally {
      clearInterval(timer);
      setLoading(false);
    }
  }, [input]);

  const handleGenerateImage = useCallback(async (index: number, prompt: string) => {
    setGeneratedImages(prev => ({ ...prev, [index]: { url: '', loading: true, error: '' } }));
    try {
      const res = await fetch('/api/generate-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt }),
      });
      const data = await res.json();
      if (data.error) {
        setGeneratedImages(prev => ({ ...prev, [index]: { url: '', loading: false, error: data.error } }));
      } else {
        setGeneratedImages(prev => ({ ...prev, [index]: { url: data.url, loading: false, error: '' } }));
      }
    } catch (e) {
      setGeneratedImages(prev => ({ ...prev, [index]: { url: '', loading: false, error: e instanceof Error ? e.message : '生成失败' } }));
    }
  }, []);

  const charCount = input.replace(/\s/g, '').length;
  const scriptCharCount = script.replace(/\s/g, '').length;

  return (
    <div className="flex flex-col lg:flex-row gap-6 min-h-[calc(100vh-6rem)]">

      {/* ── 左侧：输入 ── */}
      <div className="lg:w-[420px] lg:shrink-0 flex flex-col gap-4 lg:sticky lg:top-20 lg:self-start">
        <div>
          <h1 className="text-xl font-bold text-foreground">一键成稿</h1>
          <p className="text-sm text-muted mt-1">粘贴文案或抖音链接，直接生成口播稿 + 配图提示词</p>
        </div>

        {/* Tab 切换 */}
        <div className="flex rounded-xl border border-border overflow-hidden text-sm">
          <button
            onClick={() => setInputMode('paste')}
            className={`flex-1 py-2.5 font-medium transition-colors ${inputMode === 'paste' ? 'bg-primary text-white' : 'bg-surface text-muted hover:text-foreground'}`}
          >
            粘贴文案
          </button>
          <button
            onClick={() => { setInputMode('link'); setExtractErrorType(null); }}
            className={`flex-1 py-2.5 font-medium transition-colors ${inputMode === 'link' ? 'bg-primary text-white' : 'bg-surface text-muted hover:text-foreground'}`}
          >
            🎬 视频链接提取
          </button>
        </div>

        {/* ── 链接提取面板 ── */}
        {inputMode === 'link' && (
          <div className="flex flex-col gap-3">
            <textarea
              value={linkInput}
              onChange={e => { setLinkInput(e.target.value); setExtractErrorType(null); }}
              placeholder="粘贴抖音链接或分享文字…&#10;&#10;例：8.59 复制打开抖音，看看【xxx】https://v.douyin.com/xxxx/"
              rows={5}
              className="w-full px-3 py-2.5 border border-border rounded-xl text-sm bg-surface focus:outline-none focus:border-primary resize-none leading-7"
            />

            {/* 错误提示区域 */}
            {extractErrorType === 'NEED_COOKIES' && <CookieSetupGuide />}
            {extractErrorType === 'WEIXIN_NOT_SUPPORTED' && <WeixinGuide />}
            {extractErrorType === 'GENERIC' && (
              <div className="p-3 bg-red-50 border border-red-200 rounded-xl">
                <p className="text-xs text-red-700 whitespace-pre-wrap">{extractErrorMsg}</p>
              </div>
            )}

            <button
              onClick={handleExtract}
              disabled={extracting || !linkInput.trim()}
              className="w-full py-3 bg-primary text-white rounded-xl text-sm font-semibold hover:bg-primary-light disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {extracting ? (
                <span className="flex items-center justify-center gap-2">
                  <span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  提取中，约30-60秒…
                </span>
              ) : '提取文案'}
            </button>

            <p className="text-xs text-muted text-center">
              支持抖音 · 视频号请手动复制后切「粘贴文案」
            </p>
          </div>
        )}

        {/* ── 文案粘贴面板 ── */}
        {inputMode === 'paste' && (
          <>
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between">
                <label className="text-sm font-medium text-foreground">原始文案</label>
                {input && (
                  <button onClick={() => setInput('')} className="text-xs text-muted hover:text-accent transition-colors">
                    清空
                  </button>
                )}
              </div>
              <textarea
                value={input}
                onChange={e => setInput(e.target.value)}
                placeholder="粘贴需要改写的文案…&#10;&#10;可以是 AI 生成稿、公众号文章、爆款参考稿，或从视频链接自动提取的内容"
                rows={18}
                className="w-full px-3 py-2.5 border border-border rounded-xl text-sm bg-surface focus:outline-none focus:border-primary resize-y leading-7"
              />
              <div className="flex justify-between text-xs text-muted">
                <span>{charCount} 字</span>
                <span className={charCount < 10 ? 'text-accent' : 'text-primary'}>
                  {charCount < 10 ? '至少 10 字' : '✓ 可以生成'}
                </span>
              </div>
            </div>

            <button
              onClick={handleGenerate}
              disabled={loading || charCount < 10}
              className="w-full py-3 bg-primary text-white rounded-xl text-sm font-semibold hover:bg-primary-light disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {loading ? '生成中…' : '一键生成'}
            </button>
          </>
        )}
      </div>

      {/* ── 右侧：结果 ── */}
      <div className="flex-1 min-w-0 flex flex-col gap-4">

        {/* 进度条 */}
        {loading && (
          <div className="p-4 bg-surface rounded-xl border border-border">
            <div className="flex items-center gap-2 mb-3">
              <div className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin shrink-0" />
              <span className="text-sm font-medium text-foreground">{STEPS[step]}</span>
            </div>
            <div className="flex gap-1">
              {STEPS.map((_, i) => (
                <div key={i} className={`h-1.5 flex-1 rounded-full transition-colors duration-500 ${i <= step ? 'bg-primary' : 'bg-border'}`} />
              ))}
            </div>
          </div>
        )}

        {/* 错误 */}
        {error && (
          <div className="p-4 bg-red-50 border border-red-200 rounded-xl">
            <p className="text-sm text-red-700">{error}</p>
            <button onClick={handleGenerate} className="mt-2 text-xs px-3 py-1.5 bg-red-100 text-red-700 rounded-lg hover:bg-red-200 transition-colors">
              重新生成
            </button>
          </div>
        )}

        {/* 口播稿 */}
        {script && !loading && (
          <div className="flex flex-col p-5 bg-surface rounded-xl border border-border">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <h3 className="text-sm font-semibold text-foreground">口播稿</h3>
                <span className="text-xs text-muted">{scriptCharCount} 字</span>
              </div>
              <button
                onClick={() => { copyToClipboard(script); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
                className={`px-4 py-1.5 text-sm rounded-lg border transition-colors ${copied ? 'bg-primary text-white border-primary' : 'border-border text-muted hover:text-foreground hover:border-primary-light'}`}
              >
                {copied ? '✓ 已复制' : '复制全文'}
              </button>
            </div>
            <div className="text-sm text-foreground whitespace-pre-wrap leading-8">
              {script}
            </div>
          </div>
        )}

        {/* 配图提示词 */}
        {imagePrompts.length > 0 && !loading && (
          <div className="p-5 bg-surface rounded-xl border border-border">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-foreground">配图提示词</h3>
              <span className="text-xs text-muted">共 {imagePrompts.length} 张</span>
            </div>
            <div className="space-y-4">
              {imagePrompts.map((p, i) => {
                const img = generatedImages[i];
                return (
                  <div key={i} className="p-3 bg-background rounded-xl border border-border">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs font-medium text-primary">{p.scene}</span>
                      <span className="text-xs text-muted border border-border rounded px-1.5 py-0.5">{p.style}</span>
                    </div>
                    <p className="text-xs text-muted mb-2">{p.cn}</p>
                    <div className="flex items-start gap-2 mb-3">
                      <p className={`flex-1 text-xs font-mono leading-5 rounded-lg px-3 py-2 break-all min-h-[2.5rem] ${p.en ? 'text-foreground bg-surface-hover' : 'text-muted bg-surface-hover italic'}`}>
                        {p.en || '英文提示词未生成，请重新生成'}
                      </p>
                      {p.en && <CopyBtn text={p.en} label="复制" />}
                    </div>
                    {p.en && (
                      <>
                        {!img && (
                          <button
                            onClick={() => handleGenerateImage(i, p.en)}
                            className="w-full py-2 text-xs bg-primary text-white rounded-lg hover:bg-primary-light transition-colors"
                          >
                            生成配图
                          </button>
                        )}
                        {img?.loading && (
                          <div className="flex items-center justify-center gap-2 py-4 bg-surface-hover rounded-lg">
                            <div className="w-3.5 h-3.5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                            <span className="text-xs text-muted">生成中，约30-60秒…</span>
                          </div>
                        )}
                        {img?.error && (
                          <div className="p-2 bg-red-50 border border-red-200 rounded-lg flex items-center justify-between">
                            <span className="text-xs text-red-600">{img.error}</span>
                            <button onClick={() => handleGenerateImage(i, p.en)} className="text-xs text-red-600 underline ml-2">重试</button>
                          </div>
                        )}
                        {img?.url && !img.loading && (
                          <div className="space-y-2">
                            <img src={img.url} alt={p.scene} className="w-full rounded-lg border border-border" />
                            <div className="flex gap-2">
                              <button
                                onClick={() => downloadImage(img.url, `${p.scene}.png`)}
                                className="flex-1 py-1.5 text-xs bg-primary text-white rounded-lg hover:bg-primary-light transition-colors"
                              >
                                下载图片
                              </button>
                              <button
                                onClick={() => handleGenerateImage(i, p.en)}
                                className="px-3 py-1.5 text-xs border border-border text-muted rounded-lg hover:text-foreground transition-colors"
                              >
                                重新生成
                              </button>
                            </div>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* 空状态 */}
        {!loading && !script && !error && (
          <div className="flex-1 flex items-center justify-center min-h-[400px] bg-surface rounded-xl border border-dashed border-border">
            <div className="text-center space-y-2">
              <p className="text-sm text-muted">生成的口播稿和配图提示词将显示在这里</p>
              <p className="text-xs text-muted opacity-60">粘贴文案或抖音链接，点击一键生成</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
