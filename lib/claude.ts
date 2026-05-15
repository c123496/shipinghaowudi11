import OpenAI from 'openai';

const client = new OpenAI({
  apiKey: process.env.DEEPSEEK_API_KEY,
  baseURL: process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com',
});

const DEFAULT_MODEL = process.env.DEEPSEEK_MODEL || 'deepseek-chat';
const DEFAULT_TIMEOUT = parseInt(process.env.DEEPSEEK_TIMEOUT_MS || '120000', 10);

export async function callAI(
  systemPrompt: string,
  userPrompt: string,
  options?: { maxTokens?: number; timeout?: number }
): Promise<string> {
  const maxTokens = options?.maxTokens || 8192;
  const timeout = options?.timeout || DEFAULT_TIMEOUT;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await client.chat.completions.create(
      {
        model: DEFAULT_MODEL,
        max_tokens: maxTokens,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
      },
      { signal: controller.signal }
    );
    return response.choices[0]?.message?.content || '';
  } catch (error: unknown) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('AI 请求超时，请稍后重试');
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export async function callClaude(systemPrompt: string, userPrompt: string): Promise<string> {
  return callAI(systemPrompt, userPrompt, { maxTokens: 4096 });
}

export async function callClaudeLong(systemPrompt: string, userPrompt: string): Promise<string> {
  return callAI(systemPrompt, userPrompt, { maxTokens: 8192 });
}
