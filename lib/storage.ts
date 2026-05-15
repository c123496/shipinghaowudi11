import fs from 'fs';
import path from 'path';

const DATA_DIR = path.join(process.cwd(), 'data');
const SCRIPTS_DIR = path.join(DATA_DIR, 'scripts');
const ANALYSIS_DIR = path.join(DATA_DIR, 'analysis');

export interface Script {
  id: string;
  title: string;
  content: string;
  wordCount: number;
  tags: string[];
  emotionTone: string;
  bookName: string;
  createdAt: string;
  updatedAt: string;
  source?: string;
}

export interface AnalysisResult {
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

export interface StyleReport {
  id: string;
  totalAnalyzed: number;
  commonPatterns: string[];
  avgWordCount: number;
  topTags: string[];
  topCulturalRefs: string[];
  topResonancePoints: string[];
  summary: string;
  createdAt: string;
}

function ensureDir(dir: string) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

export function getAllScripts(): Script[] {
  ensureDir(SCRIPTS_DIR);
  const files = fs.readdirSync(SCRIPTS_DIR).filter(f => f.endsWith('.json'));
  return files.map(f => {
    const raw = fs.readFileSync(path.join(SCRIPTS_DIR, f), 'utf-8');
    const script = JSON.parse(raw) as Script;
    if (!script.bookName) script.bookName = '';
    return script;
  }).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

export function getScriptById(id: string): Script | null {
  const filePath = path.join(SCRIPTS_DIR, `${id}.json`);
  if (!fs.existsSync(filePath)) return null;
  const script = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as Script;
  if (!script.bookName) script.bookName = '';
  return script;
}

export function saveScript(script: Script): void {
  ensureDir(SCRIPTS_DIR);
  fs.writeFileSync(path.join(SCRIPTS_DIR, `${script.id}.json`), JSON.stringify(script, null, 2), 'utf-8');
  saveScriptAsMarkdown(script);
}

export function deleteScript(id: string): void {
  const filePath = path.join(SCRIPTS_DIR, `${id}.json`);
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  const mdPath = path.join(SCRIPTS_DIR, `${id}.md`);
  if (fs.existsSync(mdPath)) fs.unlinkSync(mdPath);
}

function saveScriptAsMarkdown(script: Script): void {
  const frontmatter = [
    '---',
    `title: "${script.title}"`,
    `id: ${script.id}`,
    `wordCount: ${script.wordCount}`,
    `tags: [${script.tags.map(t => `"${t}"`).join(', ')}]`,
    `emotionTone: "${script.emotionTone}"`,
    `source: "${script.source || ''}"`,
    `bookName: "${script.bookName || ''}"`,
    `createdAt: ${script.createdAt}`,
    `updatedAt: ${script.updatedAt}`,
    '---',
    '',
  ].join('\n');
  fs.writeFileSync(path.join(SCRIPTS_DIR, `${script.id}.md`), frontmatter + script.content, 'utf-8');
}

export function getAnalysis(scriptId: string): AnalysisResult | null {
  const filePath = path.join(ANALYSIS_DIR, `${scriptId}.json`);
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
}

export function saveAnalysis(analysis: AnalysisResult): void {
  ensureDir(ANALYSIS_DIR);
  fs.writeFileSync(path.join(ANALYSIS_DIR, `${analysis.scriptId}.json`), JSON.stringify(analysis, null, 2), 'utf-8');
}

export function getAllAnalyses(): AnalysisResult[] {
  ensureDir(ANALYSIS_DIR);
  const files = fs.readdirSync(ANALYSIS_DIR).filter(f => f.endsWith('.json') && !f.startsWith('_'));
  return files.map(f => {
    const raw = fs.readFileSync(path.join(ANALYSIS_DIR, f), 'utf-8');
    return JSON.parse(raw) as AnalysisResult;
  });
}

export function getStyleReport(): StyleReport | null {
  const filePath = path.join(ANALYSIS_DIR, '_report.json');
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
}

export function saveStyleReport(report: StyleReport): void {
  ensureDir(ANALYSIS_DIR);
  fs.writeFileSync(path.join(ANALYSIS_DIR, '_report.json'), JSON.stringify(report, null, 2), 'utf-8');
}
