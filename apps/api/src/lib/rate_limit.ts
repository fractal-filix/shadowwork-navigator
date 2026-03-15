import type { Env } from '../types/env.js';
import { authenticateRequest } from './auth.js';
import { rateLimited } from './http.js';

type RateLimitKeyStrategy = 'user-or-ip' | 'ip';

interface RateLimitRule {
  id: string;
  maxRequests: number;
  windowSeconds: number;
  keyStrategy: RateLimitKeyStrategy;
}

interface RateLimitBucket {
  count: number;
  resetAt: number;
}

const RATE_LIMIT_RULES = new Map<string, RateLimitRule>([
  ['POST /api/admin/set_paid', { id: 'admin_set_paid', maxRequests: 3, windowSeconds: 60, keyStrategy: 'user-or-ip' }],
  ['POST /api/crypto/dek/unseal', { id: 'dek_unseal', maxRequests: 10, windowSeconds: 60, keyStrategy: 'user-or-ip' }],
  ['POST /api/llm/ping', { id: 'llm_ping', maxRequests: 10, windowSeconds: 60, keyStrategy: 'user-or-ip' }],
  ['POST /api/llm/respond', { id: 'llm_respond', maxRequests: 5, windowSeconds: 60, keyStrategy: 'user-or-ip' }],
  ['POST /api/rag/chunks', { id: 'rag_chunks', maxRequests: 10, windowSeconds: 60, keyStrategy: 'user-or-ip' }],
  ['POST /api/run/restart', { id: 'run_restart', maxRequests: 6, windowSeconds: 60, keyStrategy: 'user-or-ip' }],
  ['POST /api/run/start', { id: 'run_start', maxRequests: 6, windowSeconds: 60, keyStrategy: 'user-or-ip' }],
  ['POST /api/thread/chat', { id: 'thread_chat', maxRequests: 5, windowSeconds: 60, keyStrategy: 'user-or-ip' }],
  ['POST /api/thread/message', { id: 'thread_message', maxRequests: 20, windowSeconds: 60, keyStrategy: 'user-or-ip' }],
  ['POST /api/thread/start', { id: 'thread_start', maxRequests: 10, windowSeconds: 60, keyStrategy: 'user-or-ip' }],
]);

const rateLimitBuckets = new Map<string, RateLimitBucket>();

function cleanupExpiredBuckets(now: number): void {
  for (const [key, bucket] of rateLimitBuckets.entries()) {
    if (bucket.resetAt <= now) {
      rateLimitBuckets.delete(key);
    }
  }
}

function getClientIp(request: Request): string | null {
  const cfConnectingIp = request.headers.get('CF-Connecting-IP') || request.headers.get('cf-connecting-ip');
  if (cfConnectingIp && cfConnectingIp.trim()) {
    return cfConnectingIp.trim();
  }

  const xForwardedFor = request.headers.get('X-Forwarded-For') || request.headers.get('x-forwarded-for');
  if (xForwardedFor && xForwardedFor.trim()) {
    const firstIp = xForwardedFor.split(',')[0]?.trim();
    if (firstIp) {
      return firstIp;
    }
  }

  const xRealIp = request.headers.get('X-Real-IP') || request.headers.get('x-real-ip');
  if (xRealIp && xRealIp.trim()) {
    return xRealIp.trim();
  }

  return null;
}

async function resolveRateLimitSubject(rule: RateLimitRule, request: Request, env: Env): Promise<string | null> {
  if (rule.keyStrategy === 'ip') {
    const ip = getClientIp(request);
    return ip ? `ip:${ip}` : null;
  }

  const authContext = await authenticateRequest(request, env.JWT_SIGNING_SECRET, env);
  if (authContext?.memberId) {
    return `user:${authContext.memberId}`;
  }

  const ip = getClientIp(request);
  return ip ? `ip:${ip}` : null;
}

export async function applyRateLimit(request: Request, env: Env): Promise<Response | null> {
  const url = new URL(request.url);
  const rule = RATE_LIMIT_RULES.get(`${request.method} ${url.pathname}`);
  if (!rule) {
    return null;
  }

  const subject = await resolveRateLimitSubject(rule, request, env);
  if (!subject) {
    return null;
  }

  const now = Date.now();
  cleanupExpiredBuckets(now);

  const bucketKey = `${rule.id}:${subject}`;
  const currentBucket = rateLimitBuckets.get(bucketKey);

  if (!currentBucket || currentBucket.resetAt <= now) {
    rateLimitBuckets.set(bucketKey, {
      count: 1,
      resetAt: now + (rule.windowSeconds * 1000),
    });
    return null;
  }

  if (currentBucket.count >= rule.maxRequests) {
    const retryAfterSeconds = Math.max(1, Math.ceil((currentBucket.resetAt - now) / 1000));
    return rateLimited('Too many requests. Please retry later.', {
      'Retry-After': String(retryAfterSeconds),
    });
  }

  currentBucket.count += 1;
  rateLimitBuckets.set(bucketKey, currentBucket);
  return null;
}