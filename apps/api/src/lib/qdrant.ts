import type { Env } from '../types/env.js';
import { fetchExternalApi } from './external_api.js';

type QdrantEnv = Pick<Env, 'QDRANT_URL' | 'QDRANT_API_KEY' | 'QDRANT_COLLECTION' | 'EXTERNAL_API_TIMEOUT_MS' | 'APP_ENV'>;

export type QdrantPoint = {
  id: string | number;
  vector: number[];
  payload?: Record<string, unknown>;
};

export type QdrantChunkPayload = {
  schema: 'rag_chunk_v1';
  user_id: string;
  thread_id: string;
  message_id: string;
  client_message_id?: string;
  chunk_no: number;
  text: string;
};

export type BuildQdrantChunkPayloadParams = {
  userId: string;
  threadId: string;
  messageId: string;
  clientMessageId?: string | null;
  chunkNo: number;
  text: string;
};

export type QdrantUpsertResult = {
  operationId: number | string | null;
};

export type QdrantSearchParams = {
  vector: number[];
  limit?: number;
  filter?: Record<string, unknown>;
  withPayload?: boolean;
  withVector?: boolean;
  scoreThreshold?: number;
};

export type QdrantSearchHit = {
  id: string | number;
  version?: number;
  score: number;
  payload?: Record<string, unknown>;
  vector?: number[];
};

type QdrantResponse<T> = {
  result?: T;
};

function readRequired(value: string | undefined, name: string): string {
  const normalized = value?.trim();
  if (!normalized) {
    throw new Error(`missing required env: ${name}`);
  }
  return normalized;
}

export function normalizeQdrantBaseUrl(rawUrl: string, appEnv?: string): string {
  const url = new URL(rawUrl);
  const isTestEnv = appEnv === 'test';
  const isLoopbackHttp =
    url.protocol === 'http:' &&
    (url.hostname === '127.0.0.1' || url.hostname === 'localhost');

  if (url.protocol !== 'https:' && !(isTestEnv && isLoopbackHttp)) {
    throw new Error('QDRANT_URL must use https:// (TLS required)');
  }
  return url.toString().replace(/\/$/, '');
}

export function getQdrantConfig(env: QdrantEnv): {
  baseUrl: string;
  apiKey: string;
  collection: string;
} {
  return {
    baseUrl: normalizeQdrantBaseUrl(readRequired(env.QDRANT_URL, 'QDRANT_URL'), env.APP_ENV),
    apiKey: readRequired(env.QDRANT_API_KEY, 'QDRANT_API_KEY'),
    collection: readRequired(env.QDRANT_COLLECTION, 'QDRANT_COLLECTION'),
  };
}

function buildQdrantPath(collection: string, suffix: string): string {
  return `/collections/${encodeURIComponent(collection)}${suffix}`;
}

function truncateForError(bodyText: string): string {
  return bodyText.length > 300 ? `${bodyText.slice(0, 300)}...` : bodyText;
}

export function buildQdrantChunkPayload(params: BuildQdrantChunkPayloadParams): QdrantChunkPayload {
  const payload: QdrantChunkPayload = {
    schema: 'rag_chunk_v1',
    user_id: params.userId,
    thread_id: params.threadId,
    message_id: params.messageId,
    chunk_no: params.chunkNo,
    text: params.text,
  };

  const normalizedClientMessageId = params.clientMessageId?.trim();
  if (normalizedClientMessageId) {
    payload.client_message_id = normalizedClientMessageId;
  }

  return payload;
}

async function qdrantJsonRequest<T>(env: QdrantEnv, path: string, init: RequestInit): Promise<T> {
  const { baseUrl, apiKey } = getQdrantConfig(env);
  const response = await fetchExternalApi(
    `${baseUrl}${path}`,
    {
      ...init,
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'api-key': apiKey,
        ...(init.headers ?? {}),
      },
    },
    env as Env,
  );

  const bodyText = await response.text();
  if (!response.ok) {
    throw new Error(
      `Qdrant request failed: HTTP ${response.status} ${response.statusText} ${path} / ${truncateForError(bodyText)}`,
    );
  }

  try {
    return JSON.parse(bodyText) as T;
  } catch {
    throw new Error(`Qdrant response was not valid JSON: ${path}`);
  }
}

export async function qdrantUpsert(env: QdrantEnv, points: QdrantPoint[]): Promise<QdrantUpsertResult> {
  if (!Array.isArray(points) || points.length === 0) {
    throw new Error('Qdrant upsert requires at least one point');
  }

  const { collection } = getQdrantConfig(env);
  const path = buildQdrantPath(collection, '/points?wait=true');
  const response = await qdrantJsonRequest<QdrantResponse<{ operation_id?: number | string }>>(
    env,
    path,
    {
      method: 'PUT',
      body: JSON.stringify({ points }),
    },
  );

  return {
    operationId: response.result?.operation_id ?? null,
  };
}

export async function qdrantSearch(env: QdrantEnv, params: QdrantSearchParams): Promise<QdrantSearchHit[]> {
  const { collection } = getQdrantConfig(env);
  const path = buildQdrantPath(collection, '/points/search');
  const requestBody: Record<string, unknown> = {
    vector: params.vector,
    limit: params.limit ?? 5,
    with_payload: params.withPayload ?? true,
    with_vector: params.withVector ?? false,
  };

  if (params.filter) {
    requestBody.filter = params.filter;
  }
  if (typeof params.scoreThreshold === 'number') {
    requestBody.score_threshold = params.scoreThreshold;
  }

  const response = await qdrantJsonRequest<QdrantResponse<Array<Record<string, unknown>>>>(
    env,
    path,
    {
      method: 'POST',
      body: JSON.stringify(requestBody),
    },
  );

  if (!Array.isArray(response.result)) {
    return [];
  }

  return response.result.map((hit) => ({
    id: hit.id as string | number,
    version: typeof hit.version === 'number' ? hit.version : undefined,
    score: Number(hit.score),
    payload: hit.payload && typeof hit.payload === 'object' ? (hit.payload as Record<string, unknown>) : undefined,
    vector: Array.isArray(hit.vector) ? (hit.vector as number[]) : undefined,
  }));
}