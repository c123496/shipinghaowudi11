import { NextRequest, NextResponse } from 'next/server';
import { exec } from 'child_process';
import { promisify } from 'util';
import { mkdtemp, readdir, readFile, rm, access } from 'fs/promises';
import path from 'path';
import os from 'os';

const execAsync = promisify(exec);
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY || '';
const DEEPSEEK_BASE_URL = process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com';
const DEEPSEEK_MODEL = process.env.DEEPSEEK_MODEL || 'deepseek-chat';

// cookies.txt 路径：项目根目录下的 cookies/douyin.txt，或通过环境变量自定义
const COOKIES_FILE =
  process.env.DOUYIN_COOKIES_PATH ||
  path.join(process.cwd(), 'cookies', 'douyin.txt');

/** 从分享文字或直接 URL 中提取链接 */
function extractUrl(input: string): string {
  const match = input.match(/https?:\/\/[^\s一-龥，。！？、）\)]+/);
  return match ? match[0].replace(/[）\)\.]+$/, '').trim() : input.trim();
}

/** 判断平台 */
function detectPlatform(url: string): 'douyin' | 'weixin' | 'unknown' {
  if (/douyin\.com|v\.douyin\.com|iesdouyin\.com/i.test(url)) return 'douyin';
  if (/weixin\.qq\.com|channels\.weixin\.qq\.com|finder\.video\.qq\.com|weixin\.qq\.com\/sph\//i.test(url)) return 'weixin';
  return 'unknown';
}

/** 检查 cookies.txt 文件是否存在 */
async function cookiesFileExists(): Promise<boolean> {
  try {
    await access(COOKIES_FILE);
    return true;
  } catch {
    return false;
  }
}

/** 解析 SRT/VTT 字幕，只保留文字 */
function parseSRT(content: string): string {
  return content
    .split('\n')
    .filter(line => {
      const t = line.trim();
      if (!t) return false;
      if (/^\d+$/.test(t)) return false;
      if (/\d{2}:\d{2}:\d{2}/.test(t)) return false;
      if (t.startsWith('WEBVTT') || t.startsWith('NOTE') || t.startsWith('X-TIMESTAMP')) return false;
      return true;
    })
    .join('\n')
    .replace(/<[^>]+>/g, '')
    .replace(/\n{2,}/g, '\n')
    .trim();
}

/** 用 DeepSeek 整理字幕原文为可读文案 */
async function cleanupWithAI(rawText: string): Promise<string> {
  if (!DEEPSEEK_API_KEY) return rawText;
  try {
    const res = await fetch(`${DEEPSEEK_BASE_URL}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${DEEPSEEK_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: DEEPSEEK_MODEL,
        messages: [
          {
            role: 'system',
            content: '你是文案整理助手。将以下视频字幕原文整理成干净的口播文案：去掉语气词（嗯、啊、那个）、字幕断行造成的碎句，合并成完整段落，保留所有原始内容和语气，不要增删观点，不要改写，只做整理清洗。直接输出整理好的文案，不要任何解释。',
          },
          { role: 'user', content: rawText },
        ],
        temperature: 0.3,
        max_tokens: 4000,
      }),
      signal: AbortSignal.timeout(60000),
    });
    const data = await res.json();
    return data.choices?.[0]?.message?.content?.trim() || rawText;
  } catch {
    return rawText;
  }
}

/** 用 yt-dlp 提取字幕 */
async function extractWithYtDlp(url: string): Promise<string> {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'vidext-'));
  const hasCookies = await cookiesFileExists();
  const cookieFlag = hasCookies ? `--cookies "${COOKIES_FILE}"` : '';

  try {
    // 尝试提取字幕（自动字幕 + 手动字幕，优先中文）
    const subtitleCmd = [
      'yt-dlp',
      '--skip-download',
      '--write-auto-sub',
      '--write-sub',
      '--sub-lang', 'zh-Hans,zh,zh-CN,en',
      '--convert-subs', 'srt',
      '--no-warnings',
      cookieFlag,
      '--output', `"${path.join(tmpDir, '%(id)s')}"`,
      `"${url}"`,
    ].filter(Boolean).join(' ');

    await execAsync(subtitleCmd, { timeout: 60000 }).catch(() => null);

    // 读取字幕文件
    const files = await readdir(tmpDir);
    const subFile = files.find(f => f.endsWith('.srt') || f.endsWith('.vtt'));
    if (subFile) {
      const raw = await readFile(path.join(tmpDir, subFile), 'utf-8');
      const parsed = parseSRT(raw);
      if (parsed.length > 20) {
        return await cleanupWithAI(parsed);
      }
    }

    // 没有字幕 — 尝试获取视频描述
    const metaCmd = ['yt-dlp', '--skip-download', '--print-json', '--no-warnings', cookieFlag, `"${url}"`]
      .filter(Boolean).join(' ');
    const { stdout } = await execAsync(metaCmd, { timeout: 30000 });
    const meta = JSON.parse(stdout.trim());
    const desc = [meta.title, meta.description].filter(Boolean).join('\n\n');
    if (desc) {
      return `【视频标题/描述，无字幕，请手动补充正文】\n\n${desc}`;
    }

    throw new Error('NO_SUBTITLE');
  } finally {
    await rm(tmpDir, { recursive: true, force: true }).catch(() => null);
  }
}

export async function POST(req: NextRequest) {
  try {
    const { url: rawInput } = await req.json() as { url: string };
    if (!rawInput?.trim()) {
      return NextResponse.json({ error: '请输入视频链接' }, { status: 400 });
    }

    const url = extractUrl(rawInput);
    const platform = detectPlatform(url);

    if (platform === 'weixin') {
      return NextResponse.json({
        error: 'WEIXIN_NOT_SUPPORTED',
      }, { status: 400 });
    }

    if (platform === 'unknown') {
      return NextResponse.json({
        error: '暂不支持该链接格式，目前仅支持抖音链接（douyin.com / v.douyin.com）',
      }, { status: 400 });
    }

    // 执行提取
    try {
      const script = await extractWithYtDlp(url);
      return NextResponse.json({ script, platform });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);

      // 需要 cookie
      if (msg.includes('cookies') || msg.includes('Fresh cookies') || msg.includes('login')) {
        const hasCookies = await cookiesFileExists();
        if (!hasCookies) {
          return NextResponse.json({ error: 'NEED_COOKIES' }, { status: 401 });
        }
      }

      if (msg === 'NO_SUBTITLE') {
        return NextResponse.json({
          error: '该视频暂无字幕，无法自动提取文案。\n请手动复制视频文案后粘贴进来。',
        }, { status: 400 });
      }

      return NextResponse.json({ error: msg }, { status: 500 });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
