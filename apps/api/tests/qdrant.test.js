import { before, afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { build } from 'esbuild';

let qdrantModule = null;
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
    QDRANT_URL: 'https://qdrant.example.com/',
    QDRANT_API_KEY: 'test-qdrant-api-key',
    QDRANT_COLLECTION: 'shadowwork_chunks',
    EXTERNAL_API_TIMEOUT_MS: '5000',
    ...overrides,
  };
}

before(async () => {
  qdrantModule = await loadTsModule(path.resolve('src', 'lib', 'qdrant.ts'));
  originalFetch = globalThis.fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

test('normalizeQdrantBaseUrl rejects non-TLS endpoints', () => {
  assert.throws(
    () => qdrantModule.normalizeQdrantBaseUrl('http://qdrant.example.com'),
    /QDRANT_URL must use https:\/\//,
  );
});

test('normalizeQdrantBaseUrl allows localhost HTTP only in test env', () => {
  assert.equal(
    qdrantModule.normalizeQdrantBaseUrl('http://127.0.0.1:8787/', 'test'),
    'http://127.0.0.1:8787',
  );
  assert.throws(
    () => qdrantModule.normalizeQdrantBaseUrl('http://qdrant.example.com', 'test'),
    /QDRANT_URL must use https:\/\//,
  );
});

test('qdrantUpsert sends points to the collection endpoint', async () => {
  let capturedUrl = '';
  let capturedInit = null;

  globalThis.fetch = async (input, init) => {
    capturedUrl = String(input);
    capturedInit = init;
    return new Response(JSON.stringify({ status: 'ok', result: { operation_id: 99 } }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };

  const result = await qdrantModule.qdrantUpsert(
    createEnv(),
    [
      {
        id: 'msg-1#0',
        vector: [0.12, 0.34, 0.56],
        payload: qdrantModule.buildQdrantChunkPayload({
          userId: 'user-1',
          threadId: 'thread-1',
          messageId: 'msg-1',
          clientMessageId: ' client-msg-1 ',
          chunkNo: 0,
          text: 'hello',
        }),
      },
    ],
  );

  assert.equal(capturedUrl, 'https://qdrant.example.com/collections/shadowwork_chunks/points?wait=true');
  assert.equal(capturedInit.method, 'PUT');
  assert.equal(capturedInit.headers['api-key'], 'test-qdrant-api-key');
  assert.deepEqual(JSON.parse(capturedInit.body), {
    points: [
      {
        id: 'msg-1#0',
        vector: [0.12, 0.34, 0.56],
        payload: {
          schema: 'rag_chunk_v1',
          user_id: 'user-1',
          thread_id: 'thread-1',
          message_id: 'msg-1',
          client_message_id: 'client-msg-1',
          chunk_no: 0,
          text: 'hello',
        },
      },
    ],
  });
  assert.deepEqual(result, { operationId: 99 });
});

test('buildQdrantChunkPayload fixes the message-chunk payload contract', () => {
  assert.deepEqual(
    qdrantModule.buildQdrantChunkPayload({
      userId: 'user-1',
      threadId: 'thread-1',
      messageId: 'msg-1',
      clientMessageId: 'client-msg-1',
      chunkNo: 3,
      text: 'chunk text',
    }),
    {
      schema: 'rag_chunk_v1',
      user_id: 'user-1',
      thread_id: 'thread-1',
      message_id: 'msg-1',
      client_message_id: 'client-msg-1',
      chunk_no: 3,
      text: 'chunk text',
    },
  );
});

test('buildQdrantChunkPayload omits blank client_message_id', () => {
  assert.deepEqual(
    qdrantModule.buildQdrantChunkPayload({
      userId: 'user-1',
      threadId: 'thread-1',
      messageId: 'msg-1',
      clientMessageId: '   ',
      chunkNo: 0,
      text: 'chunk text',
    }),
    {
      schema: 'rag_chunk_v1',
      user_id: 'user-1',
      thread_id: 'thread-1',
      message_id: 'msg-1',
      chunk_no: 0,
      text: 'chunk text',
    },
  );
});

test('qdrantSearch posts vector queries and returns hits', async () => {
  let capturedUrl = '';
  let capturedInit = null;

  globalThis.fetch = async (input, init) => {
    capturedUrl = String(input);
    capturedInit = init;
    return new Response(JSON.stringify({
      status: 'ok',
      result: [
        {
          id: 'msg-1#0',
          version: 3,
          score: 0.987,
          payload: { user_id: 'user-1', text: 'hello' },
          vector: [0.12, 0.34, 0.56],
        },
      ],
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };

  const result = await qdrantModule.qdrantSearch(createEnv(), {
    vector: [0.21, 0.43, 0.65],
    limit: 3,
    filter: {
      must: [
        {
          key: 'user_id',
          match: { value: 'user-1' },
        },
      ],
    },
    withPayload: true,
    withVector: false,
  });

  assert.equal(capturedUrl, 'https://qdrant.example.com/collections/shadowwork_chunks/points/search');
  assert.equal(capturedInit.method, 'POST');
  assert.deepEqual(JSON.parse(capturedInit.body), {
    vector: [0.21, 0.43, 0.65],
    limit: 3,
    filter: {
      must: [
        {
          key: 'user_id',
          match: { value: 'user-1' },
        },
      ],
    },
    with_payload: true,
    with_vector: false,
  });
  assert.deepEqual(result, [
    {
      id: 'msg-1#0',
      version: 3,
      score: 0.987,
      payload: { user_id: 'user-1', text: 'hello' },
      vector: [0.12, 0.34, 0.56],
    },
  ]);
});

test('qdrantUpsert surfaces HTTP failures with endpoint context', async () => {
  globalThis.fetch = async () => new Response('upsert failed', { status: 500, statusText: 'Internal Server Error' });

  await assert.rejects(
    () => qdrantModule.qdrantUpsert(createEnv(), [{ id: 'msg-1#0', vector: [1, 2, 3] }]),
    /Qdrant request failed: HTTP 500 Internal Server Error \/collections\/shadowwork_chunks\/points\?wait=true \/ upsert failed/,
  );
});