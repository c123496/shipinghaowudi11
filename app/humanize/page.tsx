'use client';

import { useState, useCallback } from 'react';
import {
  HumanizeSettings,
  DEFAULT_SETTINGS,
} from '@/lib/prompts/humanize';

// ─── Types ────────────────────────────────────────────────────────
interface DiagnosisItem {
  problem: string;
  reason: string;
  suggestion: string;
}

interface ViralAnalysis {
  hook: string;
  conflict: string;
  emotion: string;
  turningPoint: string;
  conversionLogic: string;
  bestRetainedElements: string[];
}

interface RewriteStrategy {
  angle: string;
  structure: string;
  tone: string;
  antiAiMethods: string[];
  antiRepeatMethods: string[];
}

interface MainScript {
  spokenVersion: string;
  structureVersion: {
    hook: string;
    setup: string;
    conflict: string;
    insight: string;
    emotion: string;
    conversion: string;
  };
}

interface ShotSuggestion {
  scene: string;
  visual: string;
  emotion: string;
}

interface RiskWarning {
  level: 'low' | 'medium' | 'high';
  type: string;
  text: string;
  reason: string;
  suggestion: string;
}

interface ImagePrompt {
  scene: string;
  cn: string;
  en: string;
  style: string;
}

interface HumanizeResult {
  contentType?: string;
  aiScoreBefore?: number;
  aiScoreAfterEstimate?: number;
  dimensionScores?: {
    languageNaturalness: number;
    structureHumanLike: number;
    emotionalDepth: number;
    lifeDetails: number;
    conversionNaturalness: number;
    repeatRisk: number;
  };
  diagnosis?: DiagnosisItem[];
  viralAnalysis?: ViralAnalysis;
  rewriteStrategy?: RewriteStrategy;
  mainScript?: MainScript;
  titles?: string[];
  hooks?: string[];
  endings?: string[];
  conversionBlocks?: string[];
  goldenLines?: string[];
  shotSuggestions?: ShotSuggestion[];
  riskWarnings?: RiskWarning[];
  nextOptimizationTips?: string[];
  imagePrompts?: ImagePrompt[];
  rawText?: string;
  parseFailed?: boolean;
  error?: string;
}

interface ComplianceOptimizeResult {
  optimizedScript?: string;
  optimizedTitles?: string[];
  optimizedHooks?: string[];
  optimizedEndings?: string[];
  optimizedConversionBlocks?: string[];
  optimizedGoldenLines?: string[];
  changes?: Array<{ original: string; optimized: string; reason: string }>;
  rawText?: string;
  parseFailed?: boolean;
  error?: string;
}

type Version = 'original' | 'compliance';

interface HistoryRecord {
  id: string;
  original: string;
  settings: HumanizeSettings;
  contentType?: string;
  aiScoreBefore?: number;
  aiScoreAfterEstimate?: number;
  result: HumanizeResult | null;
  complianceResult: ComplianceOptimizeResult | null;
  finalVersion: Version | null;
  riskLevel: string;
  wordCount: number;
  createdAt: string;
}

// ─── Helpers ──────────────────────────────────────────────────────
function countWords(text: string): number {
  return text.replace(/\s/g, '').length;
}

function getRiskLevel(warnings?: RiskWarning[]): string {
  if (!warnings || warnings.length === 0) return 'low';
  if (warnings.some(w => w.level === 'high')) return 'high';
  if (warnings.some(w => w.level === 'medium')) return 'medium';
  return 'low';
}

function riskBadgeColor(level: string) {
  if (level === 'high') return 'bg-red-100 text-red-700 border-red-200';
  if (level === 'medium') return 'bg-yellow-100 text-yellow-700 border-yellow-200';
  return 'bg-green-100 text-green-700 border-green-200';
}

function riskLabel(level: string) {
  if (level === 'high') return '高风险';
  if (level === 'medium') return '中风险';
  return '低风险';
}

function copyToClipboard(text: string) {
  navigator.clipboard.writeText(text).catch(() => {});
}

const STORAGE_KEY = 'humanize_history';
const MAX_HISTORY = 20;

function loadHistory(): HistoryRecord[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveHistory(records: HistoryRecord[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(records.slice(0, MAX_HISTORY)));
  } catch { /* ignore quota errors */ }
}

// ─── Progress Steps ───────────────────────────────────────────────
const PROGRESS_STEPS = [
  '正在识别题材',
  '正在诊断 AI 味',
  '正在拆解爆款结构',
  '正在重写成长视频口播',
  '正在整理标题、开头、结尾和分镜',
];

// ─── Copy Button ──────────────────────────────────────────────────
function CopyBtn({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => { copyToClipboard(text); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
      className="text-xs px-2 py-1 rounded border border-border text-muted hover:text-foreground hover:border-primary-light transition-colors shrink-0"
    >
      {copied ? '已复制' : '复制'}
    </button>
  );
}

// ─── Card Wrapper ─────────────────────────────────────────────────
function Card({ title, children, action, className = '' }: { title: string; children: React.ReactNode; action?: React.ReactNode; className?: string }) {
  return (
    <div className={`p-4 bg-surface rounded-xl border border-border ${className}`}>
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        {action}
      </div>
      {children}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────
export default function HumanizePage() {
  const [original, setOriginal] = useState('');
  const [settings, setSettings] = useState<HumanizeSettings>({ ...DEFAULT_SETTINGS });
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [loading, setLoading] = useState(false);
  const [progressStep, setProgressStep] = useState(0);
  const [result, setResult] = useState<HumanizeResult | null>(null);
  const [complianceResult, setComplianceResult] = useState<ComplianceOptimizeResult | null>(null);
  const [complianceLoading, setComplianceLoading] = useState(false);
  const [finalVersion, setFinalVersion] = useState<Version | null>(null);
  const [error, setError] = useState('');
  const [showHistory, setShowHistory] = useState(false);
  const [history, setHistory] = useState<HistoryRecord[]>(loadHistory);

  const hasResult = result !== null;
  const overallRisk = getRiskLevel(result?.riskWarnings);
  const needComplianceOpt = overallRisk === 'medium' || overallRisk === 'high';
  const spokenVersion = result?.mainScript?.spokenVersion || '';
  const wordCount = countWords(spokenVersion);
  const targetMin = settings.videoDuration === '8-12' ? 2200 : 1200;
  const wordCountWarn = spokenVersion && wordCount < targetMin;

  // ── Generate ──
  const handleGenerate = useCallback(async () => {
    if (!original.trim() || original.trim().length < 10) {
      setError('请输入至少10个字的文案');
      return;
    }
    setLoading(true);
    setError('');
    setResult(null);
    setComplianceResult(null);
    setFinalVersion(null);
    setProgressStep(0);

    const stepInterval = setInterval(() => {
      setProgressStep(prev => Math.min(prev + 1, PROGRESS_STEPS.length - 1));
    }, 4000);

    try {
      const res = await fetch('/api/humanize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: original, settings, mode: 'humanize' }),
      });
      const data = await res.json();
      if (data.error && !data.rawText) {
        setError(data.error);
      } else {
        setResult(data);
        // Save to history
        const record: HistoryRecord = {
          id: Date.now().toString(),
          original,
          settings: { ...settings },
          contentType: data.contentType,
          aiScoreBefore: data.aiScoreBefore,
          aiScoreAfterEstimate: data.aiScoreAfterEstimate,
          result: data,
          complianceResult: null,
          finalVersion: null,
          riskLevel: getRiskLevel(data.riskWarnings),
          wordCount: countWords(data.mainScript?.spokenVersion || ''),
          createdAt: new Date().toISOString(),
        };
        const updated = [record, ...history].slice(0, MAX_HISTORY);
        setHistory(updated);
        saveHistory(updated);
      }
    } catch (err) {
      setError('网络请求失败：' + (err instanceof Error ? err.message : String(err)));
    } finally {
      clearInterval(stepInterval);
      setProgressStep(PROGRESS_STEPS.length - 1);
      setLoading(false);
    }
  }, [original, settings, history]);

  // ── Compliance Optimize ──
  const handleComplianceOptimize = useCallback(async () => {
    if (!result) return;
    setComplianceLoading(true);
    setError('');
    try {
      const scriptData = {
        spokenVersion: result.mainScript?.spokenVersion || '',
        titles: result.titles || [],
        hooks: result.hooks || [],
        endings: result.endings || [],
        conversionBlocks: result.conversionBlocks || [],
        goldenLines: result.goldenLines || [],
      };
      const res = await fetch('/api/humanize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: original,
          settings,
          mode: 'compliance-optimize',
          previousResult: JSON.stringify(scriptData),
        }),
      });
      const data = await res.json();
      if (data.error && !data.rawText) {
        setError(data.error);
      } else {
        setComplianceResult(data);
        // Update history
        setHistory(prev => {
          const updated = [{ ...prev[0], complianceResult: data } as HistoryRecord, ...prev.slice(1)];
          saveHistory(updated);
          return updated;
        });
      }
    } catch (err) {
      setError('合规优化失败：' + (err instanceof Error ? err.message : String(err)));
    } finally {
      setComplianceLoading(false);
    }
  }, [result, original, settings]);

  // ── Restore from history ──
  const handleRestore = useCallback((record: HistoryRecord) => {
    setOriginal(record.original);
    setSettings(record.settings);
    setResult(record.result);
    setComplianceResult(record.complianceResult);
    setFinalVersion(record.finalVersion);
    setShowHistory(false);
  }, []);

  // ── Delete from history ──
  const handleDeleteHistory = useCallback((id: string) => {
    setHistory(prev => {
      const updated = prev.filter(r => r.id !== id);
      saveHistory(updated);
      return updated;
    });
  }, []);

  // ── Get display script by version ──
  const getDisplayScript = () => {
    if (finalVersion === 'compliance' && complianceResult?.optimizedScript) {
      return complianceResult.optimizedScript;
    }
    return spokenVersion;
  };

  const getDisplayTitles = () => {
    if (finalVersion === 'compliance' && complianceResult?.optimizedTitles) {
      return complianceResult.optimizedTitles;
    }
    return result?.titles || [];
  };

  const getDisplayHooks = () => {
    if (finalVersion === 'compliance' && complianceResult?.optimizedHooks) {
      return complianceResult.optimizedHooks;
    }
    return result?.hooks || [];
  };

  const getDisplayEndings = () => {
    if (finalVersion === 'compliance' && complianceResult?.optimizedEndings) {
      return complianceResult.optimizedEndings;
    }
    return result?.endings || [];
  };

  const getDisplayConversion = () => {
    if (finalVersion === 'compliance' && complianceResult?.optimizedConversionBlocks) {
      return complianceResult.optimizedConversionBlocks;
    }
    return result?.conversionBlocks || [];
  };

  const getDisplayGoldenLines = () => {
    if (finalVersion === 'compliance' && complianceResult?.optimizedGoldenLines) {
      return complianceResult.optimizedGoldenLines;
    }
    return result?.goldenLines || [];
  };

  // ─── Render ────────────────────────────────────────────────────
  return (
    <div className="flex flex-col lg:flex-row gap-6 -mx-4 sm:-mx-6 lg:-mx-8 px-4 sm:px-6 lg:px-0">
      {/* ─── Left: Input Panel ─── */}
      <div className="lg:w-[420px] lg:shrink-0 lg:sticky lg:top-20 lg:self-start space-y-4">
        <h1 className="text-xl font-bold text-foreground">人性化改写工作台</h1>

        {/* Original Input */}
        <div>
          <label className="text-sm font-medium text-foreground mb-1.5 block">粘贴爆款原文</label>
          <textarea
            value={original}
            onChange={e => setOriginal(e.target.value)}
            placeholder="粘贴需要人性化改写的文案...&#10;&#10;支持任意长度的视频号口播文案、公众号文章、AI生成内容等"
            rows={14}
            className="w-full px-3 py-2.5 border border-border rounded-lg text-sm bg-surface focus:outline-none focus:border-primary resize-y leading-7"
          />
          <div className="flex justify-between mt-1 text-xs text-muted">
            <span>{original.replace(/\s/g, '').length} 字</span>
            <span>{original.trim().length < 10 ? '至少10字' : '可以生成'}</span>
          </div>
        </div>

        {/* Generate Button */}
        <button
          onClick={handleGenerate}
          disabled={loading || original.trim().length < 10}
          className="w-full py-3 bg-primary text-white rounded-lg text-sm font-semibold hover:bg-primary-light disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {loading ? '生成中...' : '开始人性化改写'}
        </button>

        {/* Advanced Settings Toggle */}
        <button
          onClick={() => setShowAdvanced(!showAdvanced)}
          className="text-sm text-muted hover:text-foreground flex items-center gap-1 transition-colors"
        >
          <span className={`transition-transform ${showAdvanced ? 'rotate-90' : ''}`}>▶</span>
          高级设置
        </button>

        {showAdvanced && (
          <div className="space-y-3 p-4 bg-surface rounded-xl border border-border">
            {/* Video Duration */}
            <div>
              <label className="text-xs font-medium text-foreground block mb-1">视频时长</label>
              <select
                value={settings.videoDuration}
                onChange={e => setSettings(s => ({ ...s, videoDuration: e.target.value as '5-8' | '8-12' }))}
                className="w-full px-2.5 py-1.5 text-sm border border-border rounded-lg bg-surface focus:outline-none focus:border-primary"
              >
                <option value="5-8">5-8分钟（1500-2200字）</option>
                <option value="8-12">8-12分钟（2500-3500字）</option>
              </select>
            </div>

            {/* Genre */}
            <div>
              <label className="text-xs font-medium text-foreground block mb-1">题材类型</label>
              <select
                value={settings.genre}
                onChange={e => setSettings(s => ({ ...s, genre: e.target.value as HumanizeSettings['genre'] }))}
                className="w-full px-2.5 py-1.5 text-sm border border-border rounded-lg bg-surface focus:outline-none focus:border-primary"
              >
                <option value="auto">自动识别</option>
                <option value="history">历史人物</option>
                <option value="health">健康养生</option>
                <option value="education">教育家庭</option>
                <option value="business">商业认知</option>
                <option value="book">书籍带货</option>
                <option value="other">其他</option>
              </select>
            </div>

            {/* Target Audience */}
            <div>
              <label className="text-xs font-medium text-foreground block mb-1">目标人群</label>
              <input
                type="text"
                value={settings.targetAudience}
                onChange={e => setSettings(s => ({ ...s, targetAudience: e.target.value }))}
                className="w-full px-2.5 py-1.5 text-sm border border-border rounded-lg bg-surface focus:outline-none focus:border-primary"
              />
            </div>

            {/* Persona */}
            <div>
              <label className="text-xs font-medium text-foreground block mb-1">账号人设</label>
              <input
                type="text"
                value={settings.persona}
                onChange={e => setSettings(s => ({ ...s, persona: e.target.value }))}
                className="w-full px-2.5 py-1.5 text-sm border border-border rounded-lg bg-surface focus:outline-none focus:border-primary"
              />
            </div>

            {/* Commerce */}
            <div className="flex items-center gap-3">
              <label className="text-xs font-medium text-foreground">是否带货</label>
              <label className="flex items-center gap-1 text-xs text-muted">
                <input type="radio" checked={settings.isCommerce} onChange={() => setSettings(s => ({ ...s, isCommerce: true }))} /> 是
              </label>
              <label className="flex items-center gap-1 text-xs text-muted">
                <input type="radio" checked={!settings.isCommerce} onChange={() => setSettings(s => ({ ...s, isCommerce: false }))} /> 否
              </label>
            </div>

            {settings.isCommerce && (
              <div>
                <label className="text-xs font-medium text-foreground block mb-1">书名/产品名</label>
                <input
                  type="text"
                  value={settings.productName}
                  onChange={e => setSettings(s => ({ ...s, productName: e.target.value }))}
                  placeholder="如：《南渡北归》"
                  className="w-full px-2.5 py-1.5 text-sm border border-border rounded-lg bg-surface focus:outline-none focus:border-primary"
                />
              </div>
            )}

            {/* Banned Words */}
            <div>
              <label className="text-xs font-medium text-foreground block mb-1">禁用词（逗号或换行分隔）</label>
              <textarea
                value={settings.bannedWords}
                onChange={e => setSettings(s => ({ ...s, bannedWords: e.target.value }))}
                placeholder="如：底层逻辑,认知升级"
                rows={2}
                className="w-full px-2.5 py-1.5 text-sm border border-border rounded-lg bg-surface focus:outline-none focus:border-primary resize-none"
              />
            </div>

            {/* Retain Viral Points */}
            <div className="flex items-center gap-3">
              <label className="text-xs font-medium text-foreground">保留原文爆点</label>
              <label className="flex items-center gap-1 text-xs text-muted">
                <input type="checkbox" checked={settings.retainViralPoints} onChange={e => setSettings(s => ({ ...s, retainViralPoints: e.target.checked }))} />
                保留爆款功能位，换表达路径
              </label>
            </div>

            {/* Conversion Strength */}
            <div>
              <label className="text-xs font-medium text-foreground block mb-1">转化强度</label>
              <select
                value={settings.conversionStrength}
                onChange={e => setSettings(s => ({ ...s, conversionStrength: e.target.value as 'weak' | 'medium' | 'strong' }))}
                className="w-full px-2.5 py-1.5 text-sm border border-border rounded-lg bg-surface focus:outline-none focus:border-primary"
              >
                <option value="weak">弱</option>
                <option value="medium">中</option>
                <option value="strong">强</option>
              </select>
            </div>

            {/* Tone */}
            <div>
              <label className="text-xs font-medium text-foreground block mb-1">口播语气</label>
              <select
                value={settings.toneStyle}
                onChange={e => setSettings(s => ({ ...s, toneStyle: e.target.value }))}
                className="w-full px-2.5 py-1.5 text-sm border border-border rounded-lg bg-surface focus:outline-none focus:border-primary"
              >
                <option value="chat+steady">老友聊天 + 稳重</option>
                <option value="steady">稳重</option>
                <option value="chat">老友聊天</option>
                <option value="emotion">情绪共鸣</option>
                <option value="deep">深度认知</option>
              </select>
            </div>

            {/* Platform */}
            <div>
              <label className="text-xs font-medium text-foreground block mb-1">平台类型</label>
              <input
                type="text"
                value={settings.platform}
                readOnly
                className="w-full px-2.5 py-1.5 text-sm border border-border rounded-lg bg-surface-hover text-muted"
              />
            </div>
          </div>
        )}

        {/* History Button */}
        <button
          onClick={() => setShowHistory(!showHistory)}
          className="text-sm text-muted hover:text-foreground flex items-center gap-1.5 transition-colors"
        >
          <span>📋</span> 历史记录 ({history.length})
        </button>
      </div>

      {/* ─── Right: Results Panel ─── */}
      <div className="flex-1 min-w-0 space-y-4">
        {/* Progress */}
        {loading && (
          <div className="p-4 bg-surface rounded-xl border border-border">
            <div className="flex items-center gap-2 mb-3">
              <div className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
              <span className="text-sm font-medium text-foreground">{PROGRESS_STEPS[progressStep]}</span>
            </div>
            <div className="flex gap-1">
              {PROGRESS_STEPS.map((_, i) => (
                <div key={i} className={`h-1.5 flex-1 rounded-full ${i <= progressStep ? 'bg-primary' : 'bg-border'}`} />
              ))}
            </div>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="p-4 bg-red-50 border border-red-200 rounded-xl">
            <p className="text-sm text-red-700">{error}</p>
            <button onClick={handleGenerate} className="mt-2 text-xs px-3 py-1.5 bg-red-100 text-red-700 rounded-lg hover:bg-red-200 transition-colors">
              重新生成
            </button>
          </div>
        )}

        {/* Raw text fallback — try client-side recovery first */}
        {result?.parseFailed && result.rawText && (() => {
          // Client-side JSON recovery attempt
          let recovered: HumanizeResult | null = null;
          try {
            let cleaned = result.rawText.trim();
            const mdM = cleaned.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?\s*```$/);
            if (mdM) cleaned = mdM[1].trim();
            const jsonM = cleaned.match(/\{[\s\S]*\}/);
            if (jsonM) recovered = JSON.parse(jsonM[0]);
          } catch { /* recovery failed */ }

          if (recovered && !recovered.parseFailed) {
            // Successfully recovered on client — replace result
            setResult(recovered);
            return null;
          }

          return (
            <Card title="生成内容（结构化解析失败，展示原始文本）" action={<CopyBtn text={result.rawText!} />}>
              <div className="p-2 mb-2 bg-yellow-50 border border-yellow-200 rounded-lg text-xs text-yellow-700">
                AI 返回的内容格式异常，无法自动解析为结构化数据。你可以复制下方内容手动使用，或重新生成。
              </div>
              <div className="text-sm text-foreground whitespace-pre-wrap leading-7 max-h-[600px] overflow-y-auto">{result.rawText}</div>
            </Card>
          );
        })()}

        {/* ── Version Tabs ── */}
        {hasResult && !result.parseFailed && (
          <>
            {/* Version Selector */}
            {complianceResult && (
              <div className="flex gap-2 items-center">
                <button
                  onClick={() => setFinalVersion(null)}
                  className={`px-3 py-1.5 text-xs rounded-lg border transition-colors ${!finalVersion ? 'bg-primary text-white border-primary' : 'border-border text-muted hover:text-foreground'}`}
                >
                  原始生成版
                </button>
                <button
                  onClick={() => setFinalVersion('compliance')}
                  className={`px-3 py-1.5 text-xs rounded-lg border transition-colors ${finalVersion === 'compliance' ? 'bg-primary text-white border-primary' : 'border-border text-muted hover:text-foreground'}`}
                >
                  合规优化版
                </button>
                {(finalVersion === 'compliance' || finalVersion === null) && complianceResult && (
                  <button
                    onClick={() => setFinalVersion(finalVersion === 'compliance' ? 'compliance' : null)}
                    className="ml-auto px-3 py-1.5 text-xs bg-green-100 text-green-700 rounded-lg border border-green-200 hover:bg-green-200 transition-colors"
                  >
                    设为最终稿
                  </button>
                )}
              </div>
            )}

            {/* AI Score */}
            {result.aiScoreBefore !== undefined && (
              <Card title="AI 味评分">
                <div className="grid grid-cols-2 gap-4">
                  <div className="text-center">
                    <div className="text-3xl font-bold text-accent">{result.aiScoreBefore}</div>
                    <div className="text-xs text-muted mt-1">改写前 AI 味</div>
                  </div>
                  <div className="text-center">
                    <div className="text-3xl font-bold text-green-600">{result.aiScoreAfterEstimate}</div>
                    <div className="text-xs text-muted mt-1">改写后预估</div>
                  </div>
                </div>
                {result.dimensionScores && (
                  <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                    {Object.entries(result.dimensionScores).map(([k, v]) => (
                      <div key={k} className="flex justify-between">
                        <span className="text-muted">{k === 'languageNaturalness' ? '语言自然度' : k === 'structureHumanLike' ? '结构人味' : k === 'emotionalDepth' ? '情感深度' : k === 'lifeDetails' ? '生活细节' : k === 'conversionNaturalness' ? '转化自然度' : '重复风险'}</span>
                        <div className="flex items-center gap-1">
                          <div className="w-16 h-1.5 bg-border rounded-full overflow-hidden">
                            <div className={`h-full rounded-full ${k === 'repeatRisk' ? 'bg-accent' : 'bg-green-500'}`} style={{ width: `${Math.min(v, 100)}%` }} />
                          </div>
                          <span className="text-foreground w-6 text-right">{v}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </Card>
            )}

            {/* Risk Warnings */}
            {result.riskWarnings && result.riskWarnings.length > 0 && (
              <Card title="视频号合规风险诊断" action={
                <span className={`px-2 py-0.5 text-xs rounded-full border ${riskBadgeColor(overallRisk)}`}>
                  {riskLabel(overallRisk)}
                </span>
              }>
                <div className="space-y-2">
                  {result.riskWarnings.map((w, i) => (
                    <div key={i} className={`p-3 rounded-lg border ${riskBadgeColor(w.level)}`}>
                      <div className="flex justify-between items-start">
                        <span className="text-xs font-medium">{w.type}</span>
                        <span className={`px-1.5 py-0.5 text-[10px] rounded ${riskBadgeColor(w.level)}`}>{riskLabel(w.level)}</span>
                      </div>
                      <p className="text-xs mt-1 opacity-80">命中：「{w.text}」</p>
                      <p className="text-xs mt-0.5 opacity-70">{w.reason}</p>
                      <p className="text-xs mt-0.5 opacity-70">建议：{w.suggestion}</p>
                    </div>
                  ))}
                </div>
                {needComplianceOpt && !complianceResult && (
                  <button
                    onClick={handleComplianceOptimize}
                    disabled={complianceLoading}
                    className="mt-3 w-full py-2 bg-accent text-white rounded-lg text-sm font-medium hover:opacity-90 disabled:opacity-50 transition-opacity"
                  >
                    {complianceLoading ? '合规优化中...' : '合规二次优化'}
                  </button>
                )}
              </Card>
            )}

            {/* Diagnosis */}
            {result.diagnosis && result.diagnosis.length > 0 && (
              <Card title="问题诊断">
                <div className="space-y-2">
                  {result.diagnosis.map((d, i) => (
                    <div key={i} className="p-2.5 bg-background rounded-lg">
                      <p className="text-sm text-foreground">{d.problem}</p>
                      <p className="text-xs text-muted mt-1">原因：{d.reason}</p>
                      <p className="text-xs text-primary mt-0.5">建议：{d.suggestion}</p>
                    </div>
                  ))}
                </div>
              </Card>
            )}

            {/* Viral Analysis */}
            {result.viralAnalysis && (
              <Card title="爆点拆解">
                <div className="space-y-2 text-sm">
                  {result.viralAnalysis.hook && <p><span className="text-muted">钩子：</span>{result.viralAnalysis.hook}</p>}
                  {result.viralAnalysis.conflict && <p><span className="text-muted">冲突点：</span>{result.viralAnalysis.conflict}</p>}
                  {result.viralAnalysis.emotion && <p><span className="text-muted">情绪点：</span>{result.viralAnalysis.emotion}</p>}
                  {result.viralAnalysis.turningPoint && <p><span className="text-muted">转折点：</span>{result.viralAnalysis.turningPoint}</p>}
                  {result.viralAnalysis.conversionLogic && <p><span className="text-muted">转化逻辑：</span>{result.viralAnalysis.conversionLogic}</p>}
                  {result.viralAnalysis.bestRetainedElements?.length > 0 && (
                    <div>
                      <span className="text-muted">保留爆款位：</span>
                      <div className="flex flex-wrap gap-1 mt-1">
                        {result.viralAnalysis.bestRetainedElements.map((el, i) => (
                          <span key={i} className="px-2 py-0.5 bg-primary-light/20 text-primary text-xs rounded">{el}</span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </Card>
            )}

            {/* Rewrite Strategy */}
            {result.rewriteStrategy && (
              <Card title="改写策略">
                <div className="space-y-2 text-sm">
                  <p><span className="text-muted">新角度：</span>{result.rewriteStrategy.angle}</p>
                  <p><span className="text-muted">结构：</span>{result.rewriteStrategy.structure}</p>
                  <p><span className="text-muted">语气：</span>{result.rewriteStrategy.tone}</p>
                  {result.rewriteStrategy.antiAiMethods?.length > 0 && (
                    <div><span className="text-muted">去AI味：</span>{result.rewriteStrategy.antiAiMethods.join('；')}</div>
                  )}
                  {result.rewriteStrategy.antiRepeatMethods?.length > 0 && (
                    <div><span className="text-muted">降重复感：</span>{result.rewriteStrategy.antiRepeatMethods.join('；')}</div>
                  )}
                </div>
              </Card>
            )}

            {/* Main Script - Spoken Version */}
            {getDisplayScript() && (
              <Card title="完整口播稿" action={<CopyBtn text={getDisplayScript()} />}>
                <div className="relative">
                  <div className="text-sm text-foreground whitespace-pre-wrap leading-8">{getDisplayScript()}</div>
                </div>
                <div className="mt-3 flex items-center gap-3 text-xs text-muted">
                  <span>{countWords(getDisplayScript())} 字</span>
                  {wordCountWarn && <span className="text-yellow-600">文案可能偏短，建议重新生成或扩写</span>}
                </div>
              </Card>
            )}

            {/* Structure Version */}
            {result.mainScript?.structureVersion && !finalVersion && (
              <Card title="结构拆解版" action={<CopyBtn text={Object.values(result.mainScript.structureVersion).join('\n\n')} />}>
                <div className="space-y-3 text-sm">
                  {Object.entries(result.mainScript.structureVersion).map(([key, val]) => {
                    if (!val) return null;
                    const labels: Record<string, string> = { hook: '开头钩子', setup: '故事铺垫', conflict: '冲突转折', insight: '认知落点', emotion: '情绪共鸣', conversion: '自然转化' };
                    return (
                      <div key={key} className="flex gap-2">
                        <span className="shrink-0 px-2 py-0.5 bg-primary-light/20 text-primary text-xs rounded h-fit">{labels[key] || key}</span>
                        <div className="flex-1">
                          <p className="text-foreground leading-7">{val}</p>
                          <CopyBtn text={val} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </Card>
            )}

            {/* Titles */}
            {getDisplayTitles().length > 0 && (
              <Card title="标题建议" action={<CopyBtn text={getDisplayTitles().join('\n')} />}>
                <div className="space-y-1.5">
                  {getDisplayTitles().map((t, i) => (
                    <div key={i} className="flex items-center gap-2 text-sm">
                      <span className="text-xs text-muted w-4">{i + 1}.</span>
                      <span className="text-foreground flex-1">{t}</span>
                      <CopyBtn text={t} />
                    </div>
                  ))}
                </div>
              </Card>
            )}

            {/* Hooks */}
            {getDisplayHooks().length > 0 && (
              <Card title="开头钩子" action={<CopyBtn text={getDisplayHooks().join('\n')} />}>
                <div className="space-y-1.5">
                  {getDisplayHooks().map((h, i) => (
                    <div key={i} className="flex items-start gap-2 text-sm">
                      <span className="text-xs text-muted w-4">{i + 1}.</span>
                      <span className="text-foreground flex-1 leading-7">{h}</span>
                      <CopyBtn text={h} />
                    </div>
                  ))}
                </div>
              </Card>
            )}

            {/* Endings */}
            {getDisplayEndings().length > 0 && (
              <Card title="结尾" action={<CopyBtn text={getDisplayEndings().join('\n')} />}>
                <div className="space-y-1.5">
                  {getDisplayEndings().map((e, i) => (
                    <div key={i} className="flex items-start gap-2 text-sm">
                      <span className="text-xs text-muted w-4">{i + 1}.</span>
                      <span className="text-foreground flex-1 leading-7">{e}</span>
                      <CopyBtn text={e} />
                    </div>
                  ))}
                </div>
              </Card>
            )}

            {/* Conversion Blocks */}
            {getDisplayConversion().length > 0 && (
              <Card title="自然转化段" action={<CopyBtn text={getDisplayConversion().join('\n\n')} />}>
                <div className="space-y-2">
                  {getDisplayConversion().map((c, i) => (
                    <div key={i} className="flex items-start gap-2 text-sm">
                      <span className="text-xs text-muted w-4">{i + 1}.</span>
                      <span className="text-foreground flex-1 leading-7">{c}</span>
                      <CopyBtn text={c} />
                    </div>
                  ))}
                </div>
              </Card>
            )}

            {/* Golden Lines */}
            {getDisplayGoldenLines().length > 0 && (
              <Card title="金句" action={<CopyBtn text={getDisplayGoldenLines().join('\n')} />}>
                <div className="space-y-1.5">
                  {getDisplayGoldenLines().map((g, i) => (
                    <div key={i} className="flex items-center gap-2 text-sm">
                      <span className="text-accent">✦</span>
                      <span className="text-foreground flex-1">{g}</span>
                      <CopyBtn text={g} />
                    </div>
                  ))}
                </div>
              </Card>
            )}

            {/* Shot Suggestions */}
            {result.shotSuggestions && result.shotSuggestions.length > 0 && (
              <Card title="分镜建议">
                <div className="space-y-2">
                  {result.shotSuggestions.map((s, i) => (
                    <div key={i} className="p-2.5 bg-background rounded-lg text-sm">
                      <p className="text-foreground">{s.scene}</p>
                      <p className="text-xs text-muted mt-1">画面：{s.visual} · 情绪：{s.emotion}</p>
                    </div>
                  ))}
                </div>
              </Card>
            )}

            {/* Image Prompts */}
            {result.imagePrompts && result.imagePrompts.length > 0 && (
              <Card title="配图提示词" action={<span className="text-xs text-muted">可直接粘贴至 Midjourney / DALL·E / SD</span>}>
                <div className="space-y-3">
                  {result.imagePrompts.map((p, i) => (
                    <div key={i} className="p-3 bg-background rounded-lg border border-border">
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="text-xs font-medium text-primary">{p.scene}</span>
                        <span className="text-xs text-muted border border-border rounded px-1.5 py-0.5">{p.style}</span>
                      </div>
                      <p className="text-xs text-muted mb-2">{p.cn}</p>
                      <div className="flex items-start gap-2">
                        <p className={`flex-1 text-xs font-mono leading-5 rounded px-2 py-1.5 break-all min-h-[2.5rem] ${p.en ? 'text-foreground bg-surface' : 'text-muted bg-surface italic'}`}>
                          {p.en || '英文提示词未生成，请重新生成'}
                        </p>
                        {p.en && <CopyBtn text={p.en} />}
                      </div>
                    </div>
                  ))}
                </div>
              </Card>
            )}

            {/* Next Optimization Tips */}
            {result.nextOptimizationTips && result.nextOptimizationTips.length > 0 && (
              <Card title="下一步优化建议">
                <ul className="space-y-1.5">
                  {result.nextOptimizationTips.map((t, i) => (
                    <li key={i} className="text-sm text-muted flex gap-2">
                      <span className="text-primary">•</span>
                      {t}
                    </li>
                  ))}
                </ul>
              </Card>
            )}

            {/* Compliance optimize changes */}
            {finalVersion === 'compliance' && complianceResult?.changes && (
              <Card title="合规优化变更记录">
                <div className="space-y-2">
                  {complianceResult.changes.map((c, i) => (
                    <div key={i} className="p-2.5 bg-background rounded-lg text-sm">
                      <p className="text-accent line-through text-xs">{c.original}</p>
                      <p className="text-green-700 text-xs mt-0.5">{c.optimized}</p>
                      <p className="text-muted text-xs mt-0.5">{c.reason}</p>
                    </div>
                  ))}
                </div>
              </Card>
            )}
          </>
        )}

        {/* Empty State */}
        {!hasResult && !loading && !error && (
          <div className="flex items-center justify-center h-80 bg-surface rounded-xl border border-border text-muted text-sm">
            改写结果将显示在这里
          </div>
        )}
      </div>

      {/* ─── History Drawer ─── */}
      {showHistory && (
        <div className="fixed inset-0 z-50 flex">
          <div className="absolute inset-0 bg-black/30" onClick={() => setShowHistory(false)} />
          <div className="relative ml-auto w-full max-w-md bg-surface h-full overflow-y-auto shadow-xl">
            <div className="sticky top-0 bg-surface p-4 border-b border-border flex items-center justify-between">
              <h2 className="text-lg font-semibold text-foreground">历史记录</h2>
              <button onClick={() => setShowHistory(false)} className="text-muted hover:text-foreground text-lg">✕</button>
            </div>
            {history.length === 0 ? (
              <div className="p-8 text-center text-muted text-sm">暂无记录</div>
            ) : (
              <div className="divide-y divide-border">
                {history.map(record => (
                  <div key={record.id} className="p-4 hover:bg-surface-hover transition-colors">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-foreground truncate">{record.original.slice(0, 60)}...</p>
                        <div className="flex gap-2 mt-1 text-xs text-muted">
                          <span>{record.contentType || '未知题材'}</span>
                          <span>AI味 {record.aiScoreBefore ?? '-'}</span>
                          <span>{record.wordCount} 字</span>
                          <span className={`px-1 rounded ${riskBadgeColor(record.riskLevel)}`}>{riskLabel(record.riskLevel)}</span>
                        </div>
                        <p className="text-xs text-muted mt-0.5">{new Date(record.createdAt).toLocaleString('zh-CN')}</p>
                      </div>
                      <div className="flex gap-1 shrink-0">
                        <button onClick={() => handleRestore(record)} className="px-2 py-1 text-xs border border-border rounded text-muted hover:text-foreground">恢复</button>
                        <button onClick={() => copyToClipboard(record.result?.mainScript?.spokenVersion || '')} className="px-2 py-1 text-xs border border-border rounded text-muted hover:text-foreground">复制</button>
                        <button onClick={() => handleDeleteHistory(record.id)} className="px-2 py-1 text-xs border border-red-200 rounded text-red-400 hover:text-red-600">删除</button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
