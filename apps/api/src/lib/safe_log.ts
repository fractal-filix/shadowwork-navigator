const MAX_LOG_STRING_LENGTH = 160;
const REDACTED = '[REDACTED]';

const SENSITIVE_KEY_PATTERN = /(token|secret|password|authorization|cookie|api[-_]?key|wrapped|cipher|plaintext|text|content|chunk|input|output|dek|key_material|private|public_key)/i;

function sanitizeString(value: string): string {
  if (value.length <= MAX_LOG_STRING_LENGTH) {
    return value;
  }
  return `${value.slice(0, MAX_LOG_STRING_LENGTH)}...`;
}

function sanitizeError(err: Error): Record<string, string> {
  return {
    name: err.name || 'Error',
    message: REDACTED,
  };
}

function sanitizeObject(value: Record<string, unknown>, seen: WeakSet<object>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value)) {
    if (SENSITIVE_KEY_PATTERN.test(key)) {
      out[key] = REDACTED;
      continue;
    }
    out[key] = sanitizeValue(val, seen);
  }
  return out;
}

function sanitizeValue(value: unknown, seen = new WeakSet<object>()): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') return sanitizeString(value);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'bigint') return value.toString();

  if (value instanceof Error) {
    return sanitizeError(value);
  }

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeValue(item, seen));
  }

  if (typeof value === 'object') {
    if (seen.has(value as object)) {
      return '[Circular]';
    }
    seen.add(value as object);
    return sanitizeObject(value as Record<string, unknown>, seen);
  }

  return String(value);
}

function writeLog(level: 'debug' | 'info' | 'warn' | 'error', message: string, meta?: unknown): void {
  if (meta === undefined) {
    console[level](message);
    return;
  }
  console[level](message, sanitizeValue(meta));
}

export function logDebug(message: string, meta?: unknown): void {
  writeLog('debug', message, meta);
}

export function logInfo(message: string, meta?: unknown): void {
  writeLog('info', message, meta);
}

export function logWarn(message: string, meta?: unknown): void {
  writeLog('warn', message, meta);
}

export function logError(message: string, meta?: unknown): void {
  writeLog('error', message, meta);
}

export function sanitizeForLog(value: unknown): unknown {
  return sanitizeValue(value);
}