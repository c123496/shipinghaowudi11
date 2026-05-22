'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';

interface Script {
  id: string;
  title: string;
  content: string;
  wordCount: number;
  tags: string[];
  emotionTone: string;
  createdAt: string;
  source: string;
}

interface Analysis {
  scriptId: string;
  openHook: string;
  narrativeRhythm: string;
  emotionCurve: string;
  culturalReferences: string[];
  resonancePoints: string[];
  endingPattern: string;
  styleFingerprint: string;
  analyzedAt: string;
}

export default function ScriptDetailPage() {
  const params = useParams();
  const id = params.id as string;

  const [script, setScript] = useState<Script | null>(null);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [loading, setLoading] = useState(true);

  const fetchScript = useCallback(async () => {
    const res = await fetch(`/api/scripts`);
    const data: Script[] = await res.json();
    const found = data.find(s => s.id === id);
    setScript(found || null);
    setLoading(false);
  }, [id]);

  const checkAnalysis = useCallback(async () => {
    const res = await fetch(`/api/analyze`);
    const data = await res.json();
    const found = data.analyses?.find((a: Analysis) => a.scriptId === id);
    if (found) setAnalysis(found);
  }, [id]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void fetchScript();
      void checkAnalysis();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [fetchScript, checkAnalysis]);

  async function runAnalysis() {
    if (!script) return;
    setAnalyzing(true);
    try {
      const res = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scriptId: id }),
      });
      const data = await res.json();
      if (data.analysis) setAnalysis(data.analysis);
      else alert(data.error || '分析失败');
    } catch (e) {
      alert('分析失败：' + String(e));
    }
    setAnalyzing(false);
  }

  if (loading) return <p className="text-muted">加载中...</p>;
  if (!script) return <p className="text-muted">文案不存在</p>;

  return (
    <div>
      <Link href="/library" className="text-sm text-muted hover:text-primary">&larr; 返回文案库</Link>

      <div className="mt-4 flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">{script.title}</h1>
          <div className="flex items-center gap-3 mt-1 text-sm text-muted">
            <span>{script.wordCount} 字</span>
            <span>{script.emotionTone}</span>
            <span>{new Date(script.createdAt).toLocaleDateString('zh-CN')}</span>
          </div>
          <div className="flex flex-wrap gap-1.5 mt-2">
            {script.tags.map(tag => (
              <span key={tag} className="px-2 py-0.5 text-xs bg-surface-hover rounded text-muted">{tag}</span>
            ))}
          </div>
        </div>
        <button
          onClick={runAnalysis}
          disabled={analyzing}
          className="px-4 py-2 bg-primary text-white rounded-lg text-sm font-medium hover:bg-primary-light disabled:opacity-50"
        >
          {analyzing ? '分析中...' : analysis ? '重新分析' : '风格分析'}
        </button>
      </div>

      <div className="mt-6 p-5 bg-surface rounded-xl border border-border">
        <div className="whitespace-pre-wrap text-sm leading-7 text-foreground">{script.content}</div>
      </div>

      {analysis && (
        <div className="mt-6">
          <h2 className="text-lg font-semibold text-foreground mb-3">风格指纹</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {[
              { label: '开篇钩子', value: analysis.openHook },
              { label: '叙事节奏', value: analysis.narrativeRhythm },
              { label: '情感曲线', value: analysis.emotionCurve },
              { label: '结尾升华', value: analysis.endingPattern },
            ].map(item => (
              <div key={item.label} className="p-4 bg-surface rounded-xl border border-border">
                <dt className="text-xs font-medium text-muted mb-1">{item.label}</dt>
                <dd className="text-sm text-foreground">{item.value}</dd>
              </div>
            ))}
            <div className="p-4 bg-surface rounded-xl border border-border">
              <dt className="text-xs font-medium text-muted mb-1">文化引用</dt>
              <dd className="flex flex-wrap gap-1.5">
                {analysis.culturalReferences.map(ref => (
                  <span key={ref} className="px-2 py-0.5 text-xs bg-primary-light/20 text-primary rounded">{ref}</span>
                ))}
              </dd>
            </div>
            <div className="p-4 bg-surface rounded-xl border border-border">
              <dt className="text-xs font-medium text-muted mb-1">受众共鸣点</dt>
              <dd className="flex flex-wrap gap-1.5">
                {analysis.resonancePoints.map(p => (
                  <span key={p} className="px-2 py-0.5 text-xs bg-accent/10 text-accent rounded">{p}</span>
                ))}
              </dd>
            </div>
          </div>
          <div className="mt-4 p-4 bg-primary/5 rounded-xl border border-primary-light/30">
            <p className="text-xs font-medium text-primary mb-1">风格指纹摘要</p>
            <p className="text-sm text-foreground">{analysis.styleFingerprint}</p>
          </div>
        </div>
      )}
    </div>
  );
}
