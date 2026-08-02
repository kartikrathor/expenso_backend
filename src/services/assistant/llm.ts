/**
 * Cheap LLM helpers — Gemini → Groq → Hugging Face.
 * Used only for unknown fallback + offline pattern expansion (not every chat).
 */

type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string };

async function postJson(url: string, headers: Record<string, string>, body: unknown, timeoutMs = 20000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = (data as any)?.error?.message || (data as any)?.error || `HTTP ${res.status}`;
      throw new Error(String(msg));
    }
    return data as any;
  } finally {
    clearTimeout(timer);
  }
}

async function callGemini(messages: ChatMessage[]): Promise<string> {
  const key = process.env.GEMINI_API_KEY?.trim();
  if (!key) throw new Error('GEMINI_API_KEY missing');

  const system = messages.filter(m => m.role === 'system').map(m => m.content).join('\n');
  const userParts = messages.filter(m => m.role !== 'system');

  const model = process.env.GEMINI_MODEL || 'gemini-2.0-flash';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`;

  const contents = userParts.map(m => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }],
  }));

  const body: Record<string, unknown> = {
    contents,
    generationConfig: {
      temperature: 0.4,
      maxOutputTokens: 400,
    },
  };
  if (system) {
    body.systemInstruction = { parts: [{ text: system }] };
  }

  const data = await postJson(url, {}, body);

  const text = data?.candidates?.[0]?.content?.parts?.map((p: any) => p.text).join('') || '';
  if (!text.trim()) throw new Error('Gemini empty response');
  return text.trim();
}

async function callGroq(messages: ChatMessage[]): Promise<string> {
  const key = process.env.GROQ_API_KEY?.trim();
  if (!key) throw new Error('GROQ_API_KEY missing');

  const model = process.env.GROQ_MODEL || 'llama-3.1-8b-instant';
  const data = await postJson(
    'https://api.groq.com/openai/v1/chat/completions',
    { Authorization: `Bearer ${key}` },
    {
      model,
      temperature: 0.4,
      max_tokens: 400,
      messages,
    },
  );

  const text = data?.choices?.[0]?.message?.content || '';
  if (!text.trim()) throw new Error('Groq empty response');
  return text.trim();
}

async function callHuggingFace(messages: ChatMessage[]): Promise<string> {
  const key = (process.env.HUGGINGFACE_API_KEY || process.env.HF_TOKEN)?.trim();
  if (!key) throw new Error('HUGGINGFACE_API_KEY missing');

  const model = process.env.HF_MODEL || 'meta-llama/Llama-3.1-8B-Instruct';
  const data = await postJson(
    'https://router.huggingface.co/v1/chat/completions',
    { Authorization: `Bearer ${key}` },
    {
      model,
      temperature: 0.4,
      max_tokens: 400,
      messages,
    },
  );

  const text = data?.choices?.[0]?.message?.content || '';
  if (!text.trim()) throw new Error('Hugging Face empty response');
  return text.trim();
}

export type LlmProvider = 'gemini' | 'groq' | 'huggingface';

export async function completeChat(
  messages: ChatMessage[],
): Promise<{ text: string; provider: LlmProvider }> {
  const errors: string[] = [];

  if (process.env.GEMINI_API_KEY?.trim()) {
    try {
      return { text: await callGemini(messages), provider: 'gemini' };
    } catch (e: any) {
      errors.push(`gemini: ${e?.message || e}`);
    }
  }

  if (process.env.GROQ_API_KEY?.trim()) {
    try {
      return { text: await callGroq(messages), provider: 'groq' };
    } catch (e: any) {
      errors.push(`groq: ${e?.message || e}`);
    }
  }

  if (process.env.HUGGINGFACE_API_KEY?.trim() || process.env.HF_TOKEN?.trim()) {
    try {
      return { text: await callHuggingFace(messages), provider: 'huggingface' };
    } catch (e: any) {
      errors.push(`hf: ${e?.message || e}`);
    }
  }

  throw new Error(errors.length ? errors.join(' | ') : 'No LLM API keys configured');
}

export function hasAnyLlmKey(): boolean {
  return !!(
    process.env.GEMINI_API_KEY?.trim() ||
    process.env.GROQ_API_KEY?.trim() ||
    process.env.HUGGINGFACE_API_KEY?.trim() ||
    process.env.HF_TOKEN?.trim()
  );
}
