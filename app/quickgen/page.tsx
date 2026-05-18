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

export default function QuickGenPage() {
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState(0);
  const [script, setScript] = useState('');
  const [imagePrompts, setImagePrompts] = useState<ImagePrompt[]>([]);
  const [generatedImages, setGeneratedImages] = useState<Record<number, GeneratedImage>>({});
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');

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
      <div className="lg:w-[400px] lg:shrink-0 flex flex-col gap-4 lg:sticky lg:top-20 lg:self-start">
        <div>
          <h1 className="text-xl font-bold text-foreground">一键成稿</h1>
          <p className="text-sm text-muted mt-1">粘贴原文，直接生成口播稿 + 配图提示词</p>
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium text-foreground">粘贴原文</label>
          <textarea
            value={input}
            onChange={e => setInput(e.target.value)}
            placeholder="粘贴需要改写的文案…&#10;&#10;可以是 AI 生成稿、公众号文章、爆款参考稿等"
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
              <span className="text-xs text-muted">共 {imagePrompts.length} 张，可直接粘贴至 Midjourney / DALL·E / SD</span>
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
                    {/* 生成图片区域 */}
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
            <p className="text-sm text-muted">生成的口播稿和配图提示词将显示在这里</p>
          </div>
        )}
      </div>
    </div>
  );
}
