'use client';

import { useState, useEffect } from 'react';

interface Script {
  id: string;
  title: string;
  content: string;
  wordCount: number;
  tags: string[];
  emotionTone: string;
}

interface AnalysisResult {
  scriptId: string;
  styleFingerprint: string;
  emotionCurve: string;
  resonancePoints: string[];
  culturalReferences: string[];
  analyzedAt: string;
}

interface StyleReport {
  totalAnalyzed: number;
  commonPatterns: string[];
  topTags: string[];
  topCulturalRefs: string[];
  topResonancePoints: string[];
  summary: string;
}

export default function AnalyzePage() {
  const [scripts, setScripts] = useState<Script[]>([]);
  const [analyses, setAnalyses] = useState<AnalysisResult[]>([]);
  const [report, setReport] = useState<StyleReport | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [analyzing, setAnalyzing] = useState(false);
  const [generatingReport, setGeneratingReport] = useState(false);

  useEffect(() => {
    fetch('/api/scripts').then(r => r.json()).then(setScripts);
    fetch('/api/analyze').then(r => r.json()).then(data => {
      setAnalyses(data.analyses || []);
      setReport(data.report || null);
    });
  }, []);

  function toggleSelect(id: string) {
    setSelected(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  }

  async function batchAnalyze() {
    if (selected.length === 0) return;
    setAnalyzing(true);
    let newAnalyses = [...analyses];
    for (const id of selected) {
      try {
        const res = await fetch('/api/analyze', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ scriptId: id }),
        });
        const data = await res.json();
        if (data.analysis) {
          newAnalyses = newAnalyses.filter(a => a.scriptId !== id);
          newAnalyses.push(data.analysis);
        }
      } catch (e) {
        console.error('分析失败:', id, e);
      }
    }
    setAnalyses(newAnalyses);
    setSelected([]);
    setAnalyzing(false);
  }

  async function generateReport() {
    setGeneratingReport(true);
    try {
      const res = await fetch('/api/analyze', { method: 'PUT' });
      const data = await res.json();
      if (data.report) setReport(data.report);
      else alert(data.error || '生成报告失败');
    } catch (e) {
      alert('生成报告失败：' + String(e));
    }
    setGeneratingReport(false);
  }

  const analyzed = new Set(analyses.map(a => a.scriptId));

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground">风格分析</h1>
          <p className="text-muted text-sm mt-1">
            已分析 {analyses.length} / {scripts.length} 篇文案
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={batchAnalyze}
            disabled={analyzing || selected.length === 0}
            className="px-4 py-2 bg-primary text-white rounded-lg text-sm font-medium hover:bg-primary-light disabled:opacity-50"
          >
            {analyzing ? `分析中 (${selected.length}篇)...` : `分析选中 (${selected.length})`}
          </button>
          <button
            onClick={generateReport}
            disabled={generatingReport || analyses.length === 0}
            className="px-4 py-2 border border-primary text-primary rounded-lg text-sm font-medium hover:bg-primary hover:text-white disabled:opacity-50"
          >
            {generatingReport ? '生成中...' : '生成风格报告'}
          </button>
        </div>
      </div>

      {scripts.length === 0 ? (
        <div className="text-center py-16">
          <p className="text-muted">请先在文案库中添加文案</p>
        </div>
      ) : (
        <div className="space-y-2 mb-8">
          {scripts.map(script => {
            const isAnalyzed = analyzed.has(script.id);
            const isSelected = selected.includes(script.id);
            const analysis = analyses.find(a => a.scriptId === script.id);
            return (
              <div
                key={script.id}
                onClick={() => !isAnalyzed && toggleSelect(script.id)}
                className={`flex items-center gap-3 p-3 rounded-lg border transition-colors cursor-pointer ${
                  isSelected ? 'border-primary bg-primary/5' : isAnalyzed ? 'border-green-200 bg-green-50/50' : 'border-border hover:border-primary-light'
                }`}
              >
                <div className={`w-2 h-2 rounded-full ${isAnalyzed ? 'bg-green-500' : isSelected ? 'bg-primary' : 'bg-border'}`} />
                <span className="text-sm font-medium text-foreground flex-1">{script.title}</span>
                <span className="text-xs text-muted">{script.wordCount} 字</span>
                <span className={`text-xs ${isAnalyzed ? 'text-green-600' : 'text-muted'}`}>
                  {isAnalyzed ? '已分析' : '待分析'}
                </span>
                {analysis && (
                  <span className="text-xs text-muted max-w-[200px] truncate">{analysis.styleFingerprint}</span>
                )}
              </div>
            );
          })}
        </div>
      )}

      {report && (
        <div className="p-6 bg-surface rounded-xl border border-border">
          <h2 className="text-lg font-semibold text-foreground mb-4">整体风格报告</h2>
          <p className="text-xs text-muted mb-4">基于 {report.totalAnalyzed} 篇文案分析</p>

          <div className="space-y-4">
            <div>
              <h3 className="text-sm font-medium text-foreground mb-2">共同写作规律</h3>
              <ul className="space-y-1">
                {report.commonPatterns.map((p, i) => (
                  <li key={i} className="text-sm text-muted flex gap-2"><span className="text-primary">&#x2022;</span>{p}</li>
                ))}
              </ul>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <h3 className="text-sm font-medium text-foreground mb-2">高频主题</h3>
                <div className="flex flex-wrap gap-1.5">
                  {report.topTags.map(tag => (
                    <span key={tag} className="px-2 py-0.5 text-xs bg-primary-light/20 text-primary rounded">{tag}</span>
                  ))}
                </div>
              </div>
              <div>
                <h3 className="text-sm font-medium text-foreground mb-2">核心共鸣价值观</h3>
                <div className="flex flex-wrap gap-1.5">
                  {report.topResonancePoints.map(p => (
                    <span key={p} className="px-2 py-0.5 text-xs bg-accent/10 text-accent rounded">{p}</span>
                  ))}
                </div>
              </div>
            </div>

            <div className="p-4 bg-primary/5 rounded-xl border border-primary-light/30">
              <p className="text-xs font-medium text-primary mb-1">风格 DNA 概要</p>
              <p className="text-sm text-foreground leading-relaxed">{report.summary}</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
