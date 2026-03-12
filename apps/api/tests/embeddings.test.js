import { before, afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { build } from 'esbuild';

let embeddingsModule = null;
let originalFetch = null;

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

function createEnv(overrides = {}) {
  return {
    APP_ENV: 'test',
    OPENAI_API_KEY: 'test-openai-key',
    OPENAI_API_BASE_URL: 'https://api.openai.test',
    EXTERNAL_API_TIMEOUT_MS: '5000',
    ...overrides,
  };
}

before(async () => {
  embeddingsModule = await loadTsModule(path.resolve('src', 'lib', 'embeddings.ts'));
  originalFetch = globalThis.fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

test('createEmbeddings sends OpenAI embeddings request and returns vectors', async () => {
  let capturedUrl = '';
  let capturedInit = null;

  globalThis.fetch = async (input, init) => {
    capturedUrl = String(input);
    capturedInit = init;
    return new Response(
      JSON.stringify({
        data: [
          { index: 0, embedding: [0.11, 0.22] },
          { index: 1, embedding: [0.33, 0.44] },
        ],
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  };

  const vectors = await embeddingsModule.createEmbeddings(createEnv(), ['chunk-a', 'chunk-b']);

  assert.equal(capturedUrl, 'https://api.openai.test/v1/embeddings');
  assert.equal(capturedInit.method, 'POST');
  assert.equal(capturedInit.headers.Authorization, 'Bearer test-openai-key');
  assert.deepEqual(JSON.parse(capturedInit.body), {
    model: 'text-embedding-3-small',
    input: ['chunk-a', 'chunk-b'],
  });
  assert.deepEqual(vectors, [
    [0.11, 0.22],
    [0.33, 0.44],
  ]);
});

test('createEmbeddings throws on non-JSON response', async () => {
  globalThis.fetch = async () => new Response('not-json', { status: 200 });

  await assert.rejects(
    () => embeddingsModule.createEmbeddings(createEnv(), ['chunk-a']),
    /OpenAI embeddings returned non-JSON response/,
  );
});

test('createEmbeddings throws when OpenAI returns an error status', async () => {
  globalThis.fetch = async () => new Response(JSON.stringify({ error: { message: 'oops' } }), { status: 500 });

  await assert.rejects(
    () => embeddingsModule.createEmbeddings(createEnv(), ['chunk-a']),
    /OpenAI embeddings request failed with HTTP 500/,
  );
});
