import type { Env } from '../types/env.js';
import { fetchExternalApi } from './external_api.js';

const DEFAULT_OPENAI_EMBEDDING_MODEL = 'text-embedding-3-small';

type EmbeddingsApiResponse = {
  data?: Array<{
    index?: number;
    embedding?: unknown;
  }>;
};

export function getOpenAiEmbeddingModel(env: Env): string {
  const raw = (env as Record<string, unknown>).OPENAI_EMBEDDING_MODEL;
  if (typeof raw === 'string' && raw.trim()) {
    return raw.trim();
  }
  return DEFAULT_OPENAI_EMBEDDING_MODEL;
}

export async function createEmbeddings(env: Env, input: string[]): Promise<number[][]> {
  if (!Array.isArray(input) || input.length === 0) {
    throw new Error('Embedding input must be a non-empty array');
  }

  const openAiBase = env.OPENAI_API_BASE_URL?.trim();
  const openAiBaseUrl = openAiBase && openAiBase.length > 0 ? openAiBase : 'https://api.openai.com';
  const model = getOpenAiEmbeddingModel(env);

  const response = await fetchExternalApi(
    `${openAiBaseUrl}/v1/embeddings`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model,
        input,
      }),
    },
    env,
  );

  const bodyText = await response.text();
  let payload: EmbeddingsApiResponse;
  try {
    payload = JSON.parse(bodyText) as EmbeddingsApiResponse;
  } catch {
    throw new Error('OpenAI embeddings returned non-JSON response');
  }

  if (!response.ok) {
    throw new Error(`OpenAI embeddings request failed with HTTP ${response.status}`);
  }

  const data = Array.isArray(payload.data) ? payload.data : [];
  if (data.length !== input.length) {
    throw new Error('OpenAI embeddings returned unexpected number of vectors');
  }

  const vectorsByIndex = new Map<number, number[]>();
  for (let i = 0; i < data.length; i += 1) {
    const item = data[i];
    const index = Number.isInteger(item?.index) ? Number(item.index) : i;
    if (!Array.isArray(item?.embedding) || item.embedding.length === 0) {
      throw new Error('OpenAI embeddings payload did not include embedding vectors');
    }
    const vector = (item.embedding as unknown[]).map((value) => Number(value));
    if (vector.some((value) => !Number.isFinite(value))) {
      throw new Error('OpenAI embeddings payload contained non-numeric vector value');
    }
    vectorsByIndex.set(index, vector);
  }

  return input.map((_, index) => {
    const vector = vectorsByIndex.get(index);
    if (!vector) {
      throw new Error('OpenAI embeddings payload was missing an indexed vector');
    }
    return vector;
  });
}
