import { before, afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { build } from 'esbuild';

let safeLogModule = null;
let originalConsoleError = null;

async function loadTsModule(entryPath) {
  const result = await build({
    entryPoints: [entryPath],
    bundle: true,
    format: 'esm',
    platform: 'browser',
    target: 'esnext',
    write: false,
  });

  const [{ text }] = result.outputFiles;
  return import(`data:text/javascript;base64,${Buffer.from(text).toString('base64')}`);
}

before(async () => {
  safeLogModule = await loadTsModule(path.resolve('src', 'lib', 'safe_log.ts'));
  originalConsoleError = console.error;
});

afterEach(() => {
  console.error = originalConsoleError;
});

test('sanitizeForLog redacts plaintext, chunk text, and wrapped key fields', () => {
  const input = {
    wrapped_key: 'YWJjMTIz',
    chunk_text: 'this is a plaintext chunk',
    text: 'raw message plaintext',
    message_id: 'msg-1',
    nested: {
      authorization: 'Bearer secret-token',
      safe_field: 'ok',
    },
  };

  const sanitized = safeLogModule.sanitizeForLog(input);

  assert.deepEqual(sanitized, {
    wrapped_key: '[REDACTED]',
    chunk_text: '[REDACTED]',
    text: '[REDACTED]',
    message_id: 'msg-1',
    nested: {
      authorization: '[REDACTED]',
      safe_field: 'ok',
    },
  });
});

test('logError does not emit sensitive values in metadata', () => {
  const logs = [];
  const wrapped = Buffer.from('wrapped-material').toString('base64');
  const plain = 'very sensitive plaintext';

  console.error = (...args) => {
    logs.push(args.map((arg) => {
      if (typeof arg === 'string') return arg;
      return JSON.stringify(arg);
    }).join(' '));
  };

  safeLogModule.logError('test error', {
    wrapped_key: wrapped,
    content: plain,
    thread_id: 'thread-1',
  });

  const joined = logs.join('\n');
  assert.equal(joined.includes(wrapped), false);
  assert.equal(joined.includes(plain), false);
  assert.match(joined, /\[REDACTED\]/);
  assert.match(joined, /thread-1/);
});

test('sanitizeForLog hides error message to avoid secret leakage', () => {
  const err = new Error('OPENAI key leak should not appear');
  const sanitized = safeLogModule.sanitizeForLog(err);

  assert.deepEqual(sanitized, {
    name: 'Error',
    message: '[REDACTED]',
  });
});
