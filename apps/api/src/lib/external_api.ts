import type { Env } from '../types/env.js';

const DEFAULT_EXTERNAL_API_TIMEOUT_MS = 10000;

export function getExternalApiTimeoutMs(env: Env): number {
  const raw = env.EXTERNAL_API_TIMEOUT_MS?.trim();
  if (!raw) return DEFAULT_EXTERNAL_API_TIMEOUT_MS;

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_EXTERNAL_API_TIMEOUT_MS;
  }

  return parsed;
}

export async function fetchExternalApi(
  input: string | URL | Request,
  init: RequestInit,
  env: Env
): Promise<Response> {
  const timeoutMs = getExternalApiTimeoutMs(env);
  const controller = new AbortController();
  const timerId = setTimeout(() => controller.abort(), timeoutMs);

  const initWithTimeout: RequestInit = {
    ...init,
    signal: controller.signal,
  };

  try {
    return await fetch(input, initWithTimeout);
  } finally {
    clearTimeout(timerId);
  }
}
