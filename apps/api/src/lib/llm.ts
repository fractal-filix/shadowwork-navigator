import type { Env } from '../types/env.js';

export function getOpenAiModel(env: Env): string {
  const raw = (env as Record<string, unknown>).OPENAI_MODEL;
  if (typeof raw === 'string' && raw.trim()) {
    return raw;
  }
  return 'gpt-5.2';
}

export function extractOutputText(respJson: unknown): string | null {
  const obj = respJson as Record<string, unknown>;

  if (typeof obj?.output_text === 'string' && obj.output_text.length) {
    return obj.output_text;
  }

  const out = obj?.output;
  if (!Array.isArray(out)) return null;

  for (const item of out) {
    const content = item?.content;
    if (!Array.isArray(content)) continue;
    for (const c of content) {
      if (c?.type === 'output_text' && typeof c?.text === 'string') return c.text;
      if (typeof c?.text === 'string') return c.text;
    }
  }

  return null;
}
