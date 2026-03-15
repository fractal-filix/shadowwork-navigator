import { test, before, beforeEach, afterEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { Miniflare } from 'miniflare';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';

const JWT_SECRET = 'test-jwt-secret';
const MEMBER_ID = 'member-123';
const SUPABASE_ISSUER = 'https://supabase.test/auth/v1';
const SUPABASE_AUDIENCE = 'authenticated';
const SUPABASE_KID = 'supabase-test-kid';
const { privateKey: supabasePrivateKey, publicKey: supabasePublicKey } = crypto.generateKeyPairSync('rsa', {
  modulusLength: 2048,
});
const MOCK_KMS_KEY_ID = 'arn:aws:kms:ap-southeast-2:555569220922:key/test-kms-key';
const mockKmsPublicKeyDerBase64 = Buffer.from(
  supabasePublicKey.export({ type: 'spki', format: 'der' })
).toString('base64');
const supabasePublicJwk = {
  ...(supabasePublicKey.export({ format: 'jwk' })),
  kid: SUPABASE_KID,
  alg: 'RS256',
  use: 'sig',
};
let ddlSql = '';
let mf = null;
let db = null;
let mockServer = null;
let mockBaseUrl = '';
let stripeSessionStatus = 'paid';
let lastCheckoutBody = '';
let stripeCheckoutCreateStatus = 200;
let openAiResponsesMode = 'ok';
let openAiResponsesRequestCount = 0;
let lastOpenAiResponsesRequestJson = null;
let openAiEmbeddingsMode = 'ok';
let openAiEmbeddingsRequestCount = 0;
let lastOpenAiEmbeddingsRequestJson = null;
let qdrantUpsertRequestCount = 0;
let lastQdrantUpsertRequestJson = null;
let qdrantSearchMode = 'ok';
let qdrantSearchRequestCount = 0;
let lastQdrantSearchRequestJson = null;
let qdrantSearchHits = [];
let mockKmsDecryptMode = 'ok';
let mockAwsRequests = [];

const MOCK_SESSION_ID = 'cs_test_123';
const STRIPE_EVENT_ID = 'evt_test_123';

// --------------------------------------------------
// テスト用ユーティリティ群
// --------------------------------------------------
function base64UrlEncode(input) {
  return Buffer.from(input)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function createJwtToken(memberId, overrides = {}) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'HS256', typ: 'JWT' };
  const payload = {
    sub: memberId,
    iss: 'test-issuer',
    aud: 'test-audience',
    iat: now,
    exp: now + 60 * 60,
    ...overrides,
  };

  const headerPart = base64UrlEncode(JSON.stringify(header));
  const payloadPart = base64UrlEncode(JSON.stringify(payload));
  const data = `${headerPart}.${payloadPart}`;

  const signature = crypto
    .createHmac('sha256', JWT_SECRET)
    .update(data)
    .digest('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');

  return `${data}.${signature}`;
}

function createSupabaseAccessToken(memberId, payloadOverrides = {}, headerOverrides = {}) {
  const now = Math.floor(Date.now() / 1000);
  const header = {
    alg: 'RS256',
    typ: 'JWT',
    kid: SUPABASE_KID,
    ...headerOverrides,
  };
  const payload = {
    sub: memberId,
    iss: SUPABASE_ISSUER,
    aud: SUPABASE_AUDIENCE,
    iat: now,
    exp: now + 60 * 60,
    ...payloadOverrides,
  };

  const headerPart = base64UrlEncode(JSON.stringify(header));
  const payloadPart = base64UrlEncode(JSON.stringify(payload));
  const data = `${headerPart}.${payloadPart}`;

  const signature = crypto
    .createSign('RSA-SHA256')
    .update(data)
    .end()
    .sign(supabasePrivateKey)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');

  return `${data}.${signature}`;
}

function formatPemFromBase64(base64Body) {
  const lines = base64Body.match(/.{1,64}/g) || [];
  return `-----BEGIN PUBLIC KEY-----\n${lines.join('\n')}\n-----END PUBLIC KEY-----\n`;
}

function buildEnvBindings() {
  return {
    APP_ENV: 'test',
    OPENAI_API_KEY: 'test-openai-key',
    OPENAI_API_BASE_URL: mockBaseUrl,
    OPENAI_EMBEDDING_MODEL: 'text-embedding-3-small',
    STRIPE_SECRET_KEY: 'sk_test_123',
    STRIPE_WEBHOOK_SECRET: 'whsec_test_123',
    STRIPE_API_BASE_URL: mockBaseUrl,
    PAID_ADMIN_TOKEN: 'admin-token',
    STRIPE_PRICE_ID: 'price_test',
    CHECKOUT_SUCCESS_URL: 'https://example.com/success',
    CHECKOUT_CANCEL_URL: 'https://example.com/cancel',
    JWT_SIGNING_SECRET: JWT_SECRET,
    JWT_ISSUER: 'test-issuer',
    JWT_AUDIENCE: 'test-audience',
    ACCESS_TOKEN_TTL_SECONDS: '3600',
    SUPABASE_URL: 'https://supabase.test',
    SUPABASE_PUBLISHABLE_KEY: 'supabase-anon-key',
    SUPABASE_SERVICE_ROLE_KEY: 'supabase-service-role-key',
    SUPABASE_JWKS_URL: `${mockBaseUrl}/auth/v1/.well-known/jwks.json`,
    SUPABASE_ISSUER,
    SUPABASE_AUDIENCE,
    QDRANT_URL: mockBaseUrl,
    QDRANT_API_KEY: 'test-qdrant-api-key',
    QDRANT_COLLECTION: 'shadowwork_chunks',
    ALLOWED_ORIGINS: 'http://localhost:3000',
    ADMIN_MEMBER_IDS: 'member-admin',
    AWS_REGION: 'ap-southeast-2',
    AWS_ACCESS_KEY_ID: 'test-aws-access-key',
    AWS_SECRET_ACCESS_KEY: 'test-aws-secret-key',
    KMS_KEY_ID: MOCK_KMS_KEY_ID,
    AWS_KMS_BASE_URL: `${mockBaseUrl}/kms`,
    ASSUME_ROLE_ARN: 'arn:aws:iam::000000000000:role/test-assume-role',
  };
}

function buildAuthHeaders(memberId) {
  const token = createJwtToken(memberId);
  return {
    Authorization: `Bearer ${token}`,
  };
}

async function applyDdl(targetDb) {
  let execRes;
  try {
    execRes = await targetDb.exec(ddlSql);
    if (!execRes) throw new Error('db.exec returned falsy');
    console.log('applyDdl: Applied full DDL', { execRes });
  } catch (err) {
    console.warn('applyDdl: db.exec failed, attempting to apply DDL statements one-by-one:', err?.message ?? String(err));

    const lines = ddlSql.split(/\r?\n/);
    const statements = [];
    let cur = [];
    let inTrigger = false;

    for (let rawLine of lines) {
      const line = rawLine;
      const t = line.trim();
      if (t.startsWith('--') && cur.length === 0) continue;

      const up = t.toUpperCase();
      if (!inTrigger && up.startsWith('CREATE TRIGGER')) inTrigger = true;

      cur.push(line);

      if (inTrigger) {
        if (/END;$/i.test(t)) {
          statements.push(cur.join('\n'));
          cur = [];
          inTrigger = false;
        }
      } else if (/;\s*$/.test(t)) {
        statements.push(cur.join('\n'));
        cur = [];
      }
    }
    if (cur.length) statements.push(cur.join('\n'));

    let ran = 0;
    for (const s of statements) {
      const sql = s.trim();
      if (!sql) continue;
      try {
        await targetDb.prepare(sql).run();
        ran++;
      } catch (e) {
        console.warn('applyDdl: failed to run statement (skipping)', e.message, { snippet: sql.slice(0, 120) });
      }
    }

    execRes = { fallback: true, statementsRun: ran };
    console.log('applyDdl: fallback DDL applied (statements run)', execRes);
  }

  return execRes;
}

before(async () => {
  const ddlPath = path.resolve('database', 'DDL.sql');
  ddlSql = await fs.readFile(ddlPath, 'utf8');

  mockServer = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');

    if (req.method === 'GET' && url.pathname === '/auth/v1/.well-known/jwks.json') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ keys: [supabasePublicJwk] }));
      return;
    }

    if (req.method === 'POST' && url.pathname === '/v1/checkout/sessions') {
      let raw = '';
      req.on('data', (chunk) => {
        raw += String(chunk);
      });
      req.on('end', () => {
        lastCheckoutBody = raw;
        if (stripeCheckoutCreateStatus !== 200) {
          res.writeHead(stripeCheckoutCreateStatus, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: { message: 'mock stripe create error' } }));
          return;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ id: MOCK_SESSION_ID, url: 'http://example.com/checkout' }));
      });
      return;
    }

    if (req.method === 'GET' && url.pathname.startsWith('/v1/checkout/sessions/')) {
      const sessionId = url.pathname.split('/').pop();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        id: sessionId,
        payment_status: stripeSessionStatus,
        client_reference_id: MEMBER_ID,
        livemode: false,
        line_items: {
          data: [
            {
              price: { id: 'price_test' },
              quantity: 1,
            }
          ]
        }
      }));
      return;
    }

    if (req.method === 'POST' && url.pathname === '/sts') {
      // Simple mock of AssumeRole for tests
      let raw = '';
      req.on('data', (chunk) => { raw += String(chunk); });
      req.on('end', () => {
        mockAwsRequests.push({
          path: '/sts',
          method: req.method,
          query: Object.fromEntries(url.searchParams.entries()),
          headers: {
            authorization: req.headers.authorization,
            'x-amz-date': req.headers['x-amz-date'],
            'x-amz-content-sha256': req.headers['x-amz-content-sha256'],
            'content-type': req.headers['content-type'],
          },
          body: raw,
        });

        const now = new Date();
        const exp = new Date(now.getTime() + 15 * 60 * 1000).toISOString();
        const accessKey = 'ASIA_TEST_ACCESS_KEY';
        const secretKey = 'TEST_SECRET_KEY';
        const sessionToken = 'TEST_SESSION_TOKEN';

        const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<AssumeRoleResponse xmlns="https://sts.amazonaws.com/doc/2011-06-15/">\n  <AssumeRoleResult>\n    <Credentials>\n      <AccessKeyId>${accessKey}</AccessKeyId>\n      <SecretAccessKey>${secretKey}</SecretAccessKey>\n      <SessionToken>${sessionToken}</SessionToken>\n      <Expiration>${exp}</Expiration>\n    </Credentials>\n  </AssumeRoleResult>\n</AssumeRoleResponse>`;

        res.writeHead(200, { 'Content-Type': 'text/xml' });
        res.end(xml);
      });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/v1/responses') {
      let raw = '';
      req.on('data', (chunk) => {
        raw += String(chunk);
      });
      req.on('end', () => {
        openAiResponsesRequestCount += 1;

        lastOpenAiResponsesRequestJson = null;
        try {
          lastOpenAiResponsesRequestJson = JSON.parse(raw || '{}');
        } catch {
          lastOpenAiResponsesRequestJson = null;
        }

        if (openAiResponsesMode === 'network_error') {
          req.socket.destroy();
          return;
        }

        if (openAiResponsesMode === 'slow_ok') {
          setTimeout(() => {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ output_text: 'mock reply' }));
          }, 200);
          return;
        }

        if (openAiResponsesMode === 'non_json') {
          res.writeHead(200, { 'Content-Type': 'text/plain' });
          res.end('not-json-response');
          return;
        }

        if (openAiResponsesMode === 'error_json') {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: { message: 'mock openai error' } }));
          return;
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ output_text: 'mock reply' }));
      });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/v1/embeddings') {
      let raw = '';
      req.on('data', (chunk) => {
        raw += String(chunk);
      });
      req.on('end', () => {
        openAiEmbeddingsRequestCount += 1;
        lastOpenAiEmbeddingsRequestJson = null;
        try {
          lastOpenAiEmbeddingsRequestJson = JSON.parse(raw || '{}');
        } catch {
          lastOpenAiEmbeddingsRequestJson = null;
        }

        if (openAiEmbeddingsMode === 'network_error') {
          req.socket.destroy();
          return;
        }

        if (openAiEmbeddingsMode === 'error_json') {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: { message: 'mock embeddings error' } }));
          return;
        }

        const inputs = Array.isArray(lastOpenAiEmbeddingsRequestJson?.input)
          ? lastOpenAiEmbeddingsRequestJson.input
          : [];

        const data = inputs.map((_, index) => ({
          object: 'embedding',
          index,
          embedding: [index + 0.1, index + 0.2, index + 0.3],
        }));

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          object: 'list',
          data,
          model: 'text-embedding-3-small',
        }));
      });
      return;
    }

    if (req.method === 'PUT' && url.pathname === '/collections/shadowwork_chunks/points') {
      let raw = '';
      req.on('data', (chunk) => {
        raw += String(chunk);
      });
      req.on('end', () => {
        qdrantUpsertRequestCount += 1;
        lastQdrantUpsertRequestJson = null;
        try {
          lastQdrantUpsertRequestJson = JSON.parse(raw || '{}');
        } catch {
          lastQdrantUpsertRequestJson = null;
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          status: 'ok',
          result: { operation_id: 777 },
        }));
      });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/collections/shadowwork_chunks/points/search') {
      let raw = '';
      req.on('data', (chunk) => {
        raw += String(chunk);
      });
      req.on('end', () => {
        qdrantSearchRequestCount += 1;
        lastQdrantSearchRequestJson = null;
        try {
          lastQdrantSearchRequestJson = JSON.parse(raw || '{}');
        } catch {
          lastQdrantSearchRequestJson = null;
        }

        if (qdrantSearchMode === 'error_json') {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: { message: 'mock qdrant search error' } }));
          return;
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          status: 'ok',
          result: qdrantSearchHits,
        }));
      });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/kms') {
      const target = req.headers['x-amz-target'];

      if (target === 'TrentService.GetPublicKey') {
        mockAwsRequests.push({
          path: '/kms',
          method: req.method,
          target,
          headers: {
            authorization: req.headers.authorization,
            'x-amz-date': req.headers['x-amz-date'],
            'x-amz-content-sha256': req.headers['x-amz-content-sha256'],
            'x-amz-security-token': req.headers['x-amz-security-token'],
            'content-type': req.headers['content-type'],
          },
        });

        res.writeHead(200, { 'Content-Type': 'application/x-amz-json-1.1' });
        res.end(JSON.stringify({
          KeyId: MOCK_KMS_KEY_ID,
          KeySpec: 'RSA_2048',
          KeyUsage: 'ENCRYPT_DECRYPT',
          EncryptionAlgorithms: ['RSAES_OAEP_SHA_1', 'RSAES_OAEP_SHA_256'],
          PublicKey: mockKmsPublicKeyDerBase64,
        }));
        return;
      }

      if (target === 'TrentService.Decrypt') {
        let raw = '';
        req.on('data', (chunk) => { raw += String(chunk); });
        req.on('end', () => {
          mockAwsRequests.push({
            path: '/kms',
            method: req.method,
            target,
            body: raw,
            headers: {
              authorization: req.headers.authorization,
              'x-amz-date': req.headers['x-amz-date'],
              'x-amz-content-sha256': req.headers['x-amz-content-sha256'],
              'x-amz-security-token': req.headers['x-amz-security-token'],
              'content-type': req.headers['content-type'],
            },
          });

          try {
            const payload = JSON.parse(raw || '{}');
            if (mockKmsDecryptMode === 'sensitive_error') {
              const leakedDekBase64 = Buffer.from('dek-plaintext').toString('base64');
              res.writeHead(500, { 'Content-Type': 'application/x-amz-json-1.1' });
              res.end(JSON.stringify({
                message: `kms mock failure plaintext=${leakedDekBase64}`,
                CiphertextBlob: payload.CiphertextBlob,
                Plaintext: leakedDekBase64,
              }));
              return;
            }
            // テストでは CiphertextBlob をそのまま受け取り、固定の平文DEKを返す
            const dekPlaintext = Buffer.from('dek-plaintext').toString('base64');
            res.writeHead(200, { 'Content-Type': 'application/x-amz-json-1.1' });
            res.end(JSON.stringify({
              KeyId: MOCK_KMS_KEY_ID,
              Plaintext: dekPlaintext,
            }));
          } catch (e) {
            res.writeHead(400, { 'Content-Type': 'application/x-amz-json-1.1' });
            res.end(JSON.stringify({ message: 'bad request' }));
          }
        });
        return;
      }

      res.writeHead(400, { 'Content-Type': 'application/x-amz-json-1.1' });
      res.end(JSON.stringify({ message: 'unsupported x-amz-target' }));
      return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'not found' }));
  });

  await new Promise((resolve) => {
    mockServer.listen(0, '127.0.0.1', resolve);
  });

  const address = mockServer.address();
  if (!address || typeof address === 'string') {
    throw new Error('Failed to start mock server');
  }
  mockBaseUrl = `http://127.0.0.1:${address.port}`;
});

beforeEach(async () => {
  try {
    lastCheckoutBody = '';
    stripeCheckoutCreateStatus = 200;
    openAiResponsesMode = 'ok';
    openAiResponsesRequestCount = 0;
    lastOpenAiResponsesRequestJson = null;
    openAiEmbeddingsMode = 'ok';
    openAiEmbeddingsRequestCount = 0;
    lastOpenAiEmbeddingsRequestJson = null;
    qdrantUpsertRequestCount = 0;
    lastQdrantUpsertRequestJson = null;
    qdrantSearchMode = 'ok';
    qdrantSearchRequestCount = 0;
    lastQdrantSearchRequestJson = null;
    qdrantSearchHits = [];
    mockKmsDecryptMode = 'ok';
    mockAwsRequests = [];
    const workerPath = path.resolve('dist', 'worker.js');

    mf = new Miniflare({
      scriptPath: workerPath,
      modules: true,
      d1Databases: {
        DB: 'test-db'
      },
      bindings: buildEnvBindings()
    });

    if (!mf) throw new Error('Miniflare のインスタンス作成に失敗しました');

    db = await mf.getD1Database('DB');
    if (!db) throw new Error('D1 binding "DB" が取得できませんでした (mf.getD1Database が undefined を返しました)');

    if (!ddlSql || ddlSql.trim().length === 0) throw new Error('DDL.sql が読み込まれていません');

    await applyDdl(db);

  } catch (err) {
    console.error('beforeEach のセットアップで失敗:', err?.message ?? String(err));
    throw err; // テストを失敗させて詳細を表示させる
  }
});

afterEach(async () => {
  if (mf) {
    await mf.dispose();
    mf = null;
  }
  db = null;
});

after(async () => {
  if (mockServer) {
    await new Promise((resolve) => mockServer.close(resolve));
    mockServer = null;
  }
});

// --------------------------------------------------
// 統合テスト本体
// --------------------------------------------------

test('DDL schema excludes legacy cards table and indexes', async () => {
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS cards (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      thread_id TEXT,
      user_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      content TEXT NOT NULL,
      content_iv TEXT NOT NULL,
      content_alg TEXT NOT NULL,
      content_v INTEGER NOT NULL DEFAULT 1,
      content_kid TEXT,
      created_at TEXT NOT NULL DEFAULT (DATETIME('now')),
      updated_at TEXT NOT NULL DEFAULT (DATETIME('now'))
    )
  `).run();
  await db.prepare(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_cards_thread_kind
      ON cards(thread_id, kind)
  `).run();
  await db.prepare(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_cards_run_kind
      ON cards(run_id, kind)
  `).run();
  await db.prepare(`
    CREATE INDEX IF NOT EXISTS idx_cards_user_created
      ON cards(user_id, created_at)
  `).run();

  await applyDdl(db);

  const result = await db
    .prepare(`
      SELECT name
      FROM sqlite_master
      WHERE name = 'cards' OR name LIKE 'idx_cards_%'
      ORDER BY name
    `)
    .all();

  assert.deepEqual(result.results, []);
});

// 短い検証: テストで生成するJWTがローカルで検証できるか確認する（切り分け用）
test('local JWT verify works', async () => {
  const token = createJwtToken(MEMBER_ID);
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('invalid token structure');
  const [header, payload, signature] = parts;

  // Node側でHMACを再計算して照合する（createJwtTokenと同じアルゴリズム）
  const data = `${header}.${payload}`;
  const expectedSig = crypto
    .createHmac('sha256', JWT_SECRET)
    .update(data)
    .digest('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');

  assert.equal(signature, expectedSig);

  // payload の base64url デコードと中身の確認
  const payloadJson = Buffer.from(payload.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
  const obj = JSON.parse(payloadJson);
  assert.equal(obj.sub, MEMBER_ID);
});

test('JWT with wrong issuer is rejected', async () => {
  const badToken = createJwtToken(MEMBER_ID, { iss: 'other-issuer' });
  const res = await mf.dispatchFetch('http://localhost/api/paid', {
    headers: { Authorization: `Bearer ${badToken}` },
  });

  assert.equal(res.status, 401);
});

test('JWT with wrong audience is rejected', async () => {
  const badToken = createJwtToken(MEMBER_ID, { aud: 'other-audience' });
  const res = await mf.dispatchFetch('http://localhost/api/paid', {
    headers: { Authorization: `Bearer ${badToken}` },
  });

  assert.equal(res.status, 401);
});

test('POST /api/auth/exchange returns standardized error for invalid json', async () => {
  const res = await mf.dispatchFetch('http://localhost/api/auth/exchange', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{invalid-json',
  });

  assert.equal(res.status, 400);
  const body = await res.json();
  assert.equal(body.ok, false);
  assert.equal(body.error?.code, 'BAD_REQUEST');
  assert.equal(typeof body.error?.message, 'string');
});

test('POST /api/auth/exchange succeeds and sets JWT cookie', async () => {
  const supabaseToken = createSupabaseAccessToken('mem_test_auth');
  const res = await mf.dispatchFetch('http://localhost/api/auth/exchange', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: supabaseToken }),
  });

  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(body.member_id, 'mem_test_auth');
  assert.equal(body.token_type, 'Bearer');
  assert.equal(body.expires_in, 3600);
  assert.equal(typeof body.expires_in, 'number');

  const contentType = res.headers.get('Content-Type') || '';
  assert.match(contentType, /application\/json;\s*charset=utf-8/i);

  const setCookie = res.headers.get('Set-Cookie') || '';
  assert.match(setCookie, /access_token=/);
  assert.match(setCookie, /HttpOnly/);
  assert.match(setCookie, /Secure/);
  assert.match(setCookie, /SameSite=Strict/);
  assert.match(setCookie, /Path=\//);
});

test('POST /api/auth/exchange uses sub claim as member_id', async () => {
  const supabaseToken = createSupabaseAccessToken('mem_test_auth_nested');
  const res = await mf.dispatchFetch('http://localhost/api/auth/exchange', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: supabaseToken }),
  });

  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(body.member_id, 'mem_test_auth_nested');
});

test('POST /api/auth/exchange returns unauthorized for invalid supabase token', async () => {
  const res = await mf.dispatchFetch('http://localhost/api/auth/exchange', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: 'invalid-supabase-token' }),
  });

  assert.equal(res.status, 401);
  const body = await res.json();
  assert.equal(body.ok, false);
  assert.equal(body.error?.code, 'UNAUTHORIZED');
  assert.equal(typeof body.error?.message, 'string');
});

test('POST /api/auth/exchange returns standardized internal error with details when jwks fetch fails', async () => {
  const workerPath = path.resolve('dist', 'worker.js');
  const localMf = new Miniflare({
    scriptPath: workerPath,
    modules: true,
    d1Databases: { DB: 'test-db-auth-exchange-fetch-fail' },
    bindings: {
      ...buildEnvBindings(),
      SUPABASE_JWKS_URL: 'http://127.0.0.1:9/auth/v1/.well-known/jwks.json',
    },
  });

  try {
    const res = await localMf.dispatchFetch('http://localhost/api/auth/exchange', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: createSupabaseAccessToken('mem_test_auth') }),
    });

    assert.equal(res.status, 502);
    const body = await res.json();
    assert.equal(body.ok, false);
    assert.equal(body.error?.code, 'INTERNAL_ERROR');
    assert.equal(typeof body.error?.message, 'string');
    assert.equal(typeof body.error?.details?.message, 'string');
  } finally {
    await localMf.dispose();
  }
});

test('CORS blocks request when Origin is not in allowlist', async () => {
  const res = await mf.dispatchFetch('http://localhost/', {
    method: 'GET',
    headers: {
      Origin: 'https://evil.example.com',
    },
  });

  assert.equal(res.status, 403);
  const body = await res.json();
  assert.equal(body.ok, false);
  assert.equal(body.error?.code, 'FORBIDDEN');
  assert.equal(res.headers.get('Access-Control-Allow-Origin'), null);
});

test('CORS echoes allowed Origin and allows credentials', async () => {
  const res = await mf.dispatchFetch('http://localhost/', {
    method: 'GET',
    headers: {
      Origin: 'http://localhost:3000',
    },
  });

  assert.equal(res.status, 200);
  assert.equal(res.headers.get('Access-Control-Allow-Origin'), 'http://localhost:3000');
  assert.equal(res.headers.get('Access-Control-Allow-Credentials'), 'true');
});

test('OPTIONS preflight for allowed Origin returns CORS headers', async () => {
  const res = await mf.dispatchFetch('http://localhost/api/paid', {
    method: 'OPTIONS',
    headers: {
      Origin: 'http://localhost:3000',
    },
  });

  assert.equal(res.status, 204);
  assert.equal(res.headers.get('Access-Control-Allow-Origin'), 'http://localhost:3000');
  assert.equal(res.headers.get('Access-Control-Allow-Credentials'), 'true');
  assert.match(res.headers.get('Access-Control-Allow-Methods') || '', /OPTIONS/);
});

test('CORS fails closed when ALLOWED_ORIGINS is empty', async () => {
  const workerPath = path.resolve('dist', 'worker.js');
  const localMf = new Miniflare({
    scriptPath: workerPath,
    modules: true,
    d1Databases: { DB: 'test-db-cors-empty' },
    bindings: {
      ...buildEnvBindings(),
      ALLOWED_ORIGINS: '',
    },
  });

  try {
    const res = await localMf.dispatchFetch('http://localhost/', {
      method: 'GET',
      headers: {
        Origin: 'http://localhost:3000',
      },
    });

    assert.equal(res.status, 403);
    const body = await res.json();
    assert.equal(body.ok, false);
    assert.equal(body.error?.code, 'FORBIDDEN');
    assert.equal(res.headers.get('Access-Control-Allow-Origin'), null);
  } finally {
    await localMf.dispose();
  }
});

test('POST /api/checkout/session returns standardized unauthorized error without JWT', async () => {
  const res = await mf.dispatchFetch('http://localhost/api/checkout/session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });

  assert.equal(res.status, 401);
  const body = await res.json();
  assert.equal(body.ok, false);
  assert.equal(body.error?.code, 'UNAUTHORIZED');
  assert.equal(typeof body.error?.message, 'string');
});

test('POST /api/checkout/session rejects JWT when sub is empty string', async () => {
  const token = createJwtToken('ignored-member', { sub: '' });
  const res = await mf.dispatchFetch('http://localhost/api/checkout/session', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({}),
  });

  assert.equal(res.status, 401);
  const body = await res.json();
  assert.equal(body.ok, false);
  assert.equal(body.error?.code, 'UNAUTHORIZED');
  assert.equal(typeof body.error?.message, 'string');
});

test('POST /api/checkout/session rejects JWT when sub is blank spaces', async () => {
  const token = createJwtToken('ignored-member', { sub: '   ' });
  const res = await mf.dispatchFetch('http://localhost/api/checkout/session', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({}),
  });

  assert.equal(res.status, 401);
  const body = await res.json();
  assert.equal(body.ok, false);
  assert.equal(body.error?.code, 'UNAUTHORIZED');
  assert.equal(typeof body.error?.message, 'string');
});

test('GET /api/paid rejects test header without JWT cookie', async () => {
  const res = await mf.dispatchFetch('http://localhost/api/paid', {
    headers: {
      'X-TEST-MEMBER-ID': MEMBER_ID,
    },
  });

  assert.equal(res.status, 401);
  const body = await res.json();
  assert.equal(body.ok, false);
  assert.equal(body.error?.code, 'UNAUTHORIZED');
  assert.equal(typeof body.error?.message, 'string');
});

test('POST /api/checkout/session accepts non-memberstack subject id from JWT', async () => {
  const memberId = '3f9c5f71-4764-4ab2-9e6b-50f29ed8360e';
  const res = await mf.dispatchFetch('http://localhost/api/checkout/session', {
    method: 'POST',
    headers: {
      ...buildAuthHeaders(memberId),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({}),
  });

  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);

  const params = new URLSearchParams(lastCheckoutBody);
  assert.equal(params.get('client_reference_id'), memberId);
});

test('POST /api/checkout/session creates payment checkout session with client_reference_id', async () => {
  const memberId = 'mem_test_123';
  const res = await mf.dispatchFetch('http://localhost/api/checkout/session', {
    method: 'POST',
    headers: {
      ...buildAuthHeaders(memberId),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({}),
  });

  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(body.id, MOCK_SESSION_ID);
  assert.equal(body.url, 'http://example.com/checkout');

  const params = new URLSearchParams(lastCheckoutBody);
  assert.equal(params.get('mode'), 'payment');
  assert.equal(params.get('client_reference_id'), memberId);
  assert.equal(params.get('line_items[0][price]'), 'price_test');
  assert.equal(params.get('line_items[0][quantity]'), '1');
});

test('POST /api/checkout/session binds client_reference_id to JWT sub even when body has user_id', async () => {
  const memberId = 'jwt-sub-user';
  const res = await mf.dispatchFetch('http://localhost/api/checkout/session', {
    method: 'POST',
    headers: {
      ...buildAuthHeaders(memberId),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ user_id: 'tampered-user-id' }),
  });

  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);

  const params = new URLSearchParams(lastCheckoutBody);
  assert.equal(params.get('client_reference_id'), memberId);
});

test('POST /api/checkout/session returns standardized internal error for invalid checkout mode', async () => {
  const workerPath = path.resolve('dist', 'worker.js');
  const localMf = new Miniflare({
    scriptPath: workerPath,
    modules: true,
    d1Databases: { DB: 'test-db-mode' },
    bindings: {
      ...buildEnvBindings(),
      STRIPE_CHECKOUT_MODE: 'invalid_mode',
    },
  });

  try {
    const res = await localMf.dispatchFetch('http://localhost/api/checkout/session', {
      method: 'POST',
      headers: {
        ...buildAuthHeaders('mem_test_123'),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({}),
    });

    assert.equal(res.status, 500);
    const body = await res.json();
    assert.equal(body.ok, false);
    assert.equal(body.error?.code, 'INTERNAL_ERROR');
    assert.equal(typeof body.error?.message, 'string');
  } finally {
    await localMf.dispose();
  }
});

test('POST /api/checkout/session returns standardized internal error when Stripe create fails', async () => {
  stripeCheckoutCreateStatus = 400;

  const res = await mf.dispatchFetch('http://localhost/api/checkout/session', {
    method: 'POST',
    headers: {
      ...buildAuthHeaders('mem_test_123'),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({}),
  });

  assert.equal(res.status, 502);
  const body = await res.json();
  assert.equal(body.ok, false);
  assert.equal(body.error?.code, 'INTERNAL_ERROR');
  assert.equal(typeof body.error?.message, 'string');
  assert.equal(body.error?.details, undefined);
});

test('POST /api/llm/ping returns standardized internal error when OpenAI returns non-JSON', async () => {
  openAiResponsesMode = 'non_json';

  await db
    .prepare('INSERT INTO user_flags (user_id, paid) VALUES (?, 1)')
    .bind(MEMBER_ID)
    .run();

  const res = await mf.dispatchFetch('http://localhost/api/llm/ping', {
    method: 'POST',
    headers: buildAuthHeaders(MEMBER_ID),
  });

  assert.equal(res.status, 502);
  const body = await res.json();
  assert.equal(body.ok, false);
  assert.equal(body.error?.code, 'INTERNAL_ERROR');
  assert.equal(typeof body.error?.message, 'string');
  assert.equal(body.error?.details, undefined);
});

test('POST /api/llm/ping returns standardized internal error when OpenAI returns error', async () => {
  openAiResponsesMode = 'error_json';

  await db
    .prepare('INSERT INTO user_flags (user_id, paid) VALUES (?, 1)')
    .bind(MEMBER_ID)
    .run();

  const res = await mf.dispatchFetch('http://localhost/api/llm/ping', {
    method: 'POST',
    headers: buildAuthHeaders(MEMBER_ID),
  });

  assert.equal(res.status, 502);
  const body = await res.json();
  assert.equal(body.ok, false);
  assert.equal(body.error?.code, 'INTERNAL_ERROR');
  assert.equal(typeof body.error?.message, 'string');
  assert.equal(body.error?.details, undefined);
});

test('POST /api/llm/ping returns standardized internal error when OpenAI fetch fails', async () => {
  openAiResponsesMode = 'network_error';

  await db
    .prepare('INSERT INTO user_flags (user_id, paid) VALUES (?, 1)')
    .bind(MEMBER_ID)
    .run();

  const res = await mf.dispatchFetch('http://localhost/api/llm/ping', {
    method: 'POST',
    headers: buildAuthHeaders(MEMBER_ID),
  });

  assert.equal(res.status, 502);
  const body = await res.json();
  assert.equal(body.ok, false);
  assert.equal(body.error?.code, 'INTERNAL_ERROR');
  assert.equal(typeof body.error?.message, 'string');
});

test('POST /api/llm/ping uses OPENAI_API_BASE_URL and returns mock pong', async () => {
  await db
    .prepare('INSERT INTO user_flags (user_id, paid) VALUES (?, 1)')
    .bind(MEMBER_ID)
    .run();

  const res = await mf.dispatchFetch('http://localhost/api/llm/ping', {
    method: 'POST',
    headers: buildAuthHeaders(MEMBER_ID),
  });

  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(body.pong, 'mock reply');
});

test('POST /api/llm/respond returns standardized internal error when OpenAI returns non-JSON', async () => {
  openAiResponsesMode = 'non_json';

  await db
    .prepare('INSERT INTO user_flags (user_id, paid) VALUES (?, 1)')
    .bind(MEMBER_ID)
    .run();

  const res = await mf.dispatchFetch('http://localhost/api/llm/respond', {
    method: 'POST',
    headers: {
      ...buildAuthHeaders(MEMBER_ID),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ input: 'こんにちは' }),
  });

  assert.equal(res.status, 502);
  const body = await res.json();
  assert.equal(body.ok, false);
  assert.equal(body.error?.code, 'INTERNAL_ERROR');
  assert.equal(typeof body.error?.message, 'string');
  assert.equal(body.error?.details, undefined);
});

test('POST /api/auth/exchange returns unauthorized when supabase token has wrong audience', async () => {
  const token = createSupabaseAccessToken('mem_test_auth', { aud: 'wrong-audience' });
  const workerPath = path.resolve('dist', 'worker.js');
  const localMf = new Miniflare({
    scriptPath: workerPath,
    modules: true,
    d1Databases: { DB: 'test-db-supabase-aud' },
    bindings: buildEnvBindings(),
  });

  try {
    const res = await localMf.dispatchFetch('http://localhost/api/auth/exchange', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    });

    assert.equal(res.status, 401);
    const body = await res.json();
    assert.equal(body.ok, false);
    assert.equal(body.error?.code, 'UNAUTHORIZED');
  } finally {
    await localMf.dispose();
  }
});

test('POST /api/llm/respond returns standardized internal error when OpenAI returns error', async () => {
  openAiResponsesMode = 'error_json';

  await db
    .prepare('INSERT INTO user_flags (user_id, paid) VALUES (?, 1)')
    .bind(MEMBER_ID)
    .run();

  const res = await mf.dispatchFetch('http://localhost/api/llm/respond', {
    method: 'POST',
    headers: {
      ...buildAuthHeaders(MEMBER_ID),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ input: 'こんにちは' }),
  });

  assert.equal(res.status, 502);
  const body = await res.json();
  assert.equal(body.ok, false);
  assert.equal(body.error?.code, 'INTERNAL_ERROR');
  assert.equal(typeof body.error?.message, 'string');
  assert.equal(body.error?.details, undefined);
});

test('POST /api/llm/respond returns standardized internal error when OpenAI fetch fails', async () => {
  openAiResponsesMode = 'network_error';

  await db
    .prepare('INSERT INTO user_flags (user_id, paid) VALUES (?, 1)')
    .bind(MEMBER_ID)
    .run();

  const res = await mf.dispatchFetch('http://localhost/api/llm/respond', {
    method: 'POST',
    headers: {
      ...buildAuthHeaders(MEMBER_ID),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ input: 'こんにちは' }),
  });

  assert.equal(res.status, 502);
  const body = await res.json();
  assert.equal(body.ok, false);
  assert.equal(body.error?.code, 'INTERNAL_ERROR');
  assert.equal(typeof body.error?.message, 'string');
});

test('POST /api/llm/respond returns bad request when input is too long', async () => {
  await db
    .prepare('INSERT INTO user_flags (user_id, paid) VALUES (?, 1)')
    .bind(MEMBER_ID)
    .run();

  const res = await mf.dispatchFetch('http://localhost/api/llm/respond', {
    method: 'POST',
    headers: {
      ...buildAuthHeaders(MEMBER_ID),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ input: 'a'.repeat(2001) }),
  });

  assert.equal(res.status, 400);
  const body = await res.json();
  assert.equal(body.ok, false);
  assert.equal(body.error?.code, 'BAD_REQUEST');
  assert.equal(typeof body.error?.message, 'string');
});

test('POST /api/thread/chat returns standardized internal error when OpenAI returns non-JSON', async () => {
  openAiResponsesMode = 'non_json';

  await db
    .prepare('INSERT INTO user_flags (user_id, paid) VALUES (?, 1)')
    .bind(MEMBER_ID)
    .run();

  const runRes = await mf.dispatchFetch('http://localhost/api/run/start', {
    method: 'POST',
    headers: buildAuthHeaders(MEMBER_ID),
  });
  assert.equal(runRes.status, 200);

  const threadStartRes = await mf.dispatchFetch('http://localhost/api/thread/start', {
    method: 'POST',
    headers: buildAuthHeaders(MEMBER_ID),
  });
  assert.equal(threadStartRes.status, 200);

  const res = await mf.dispatchFetch('http://localhost/api/thread/chat', {
    method: 'POST',
    headers: {
      ...buildAuthHeaders(MEMBER_ID),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ message: 'hello' }),
  });

  assert.equal(res.status, 502);
  const body = await res.json();
  assert.equal(body.ok, false);
  assert.equal(body.error?.code, 'INTERNAL_ERROR');
  assert.equal(typeof body.error?.message, 'string');
});

test('POST /api/thread/chat returns standardized internal error when OpenAI returns error', async () => {
  openAiResponsesMode = 'error_json';

  await db
    .prepare('INSERT INTO user_flags (user_id, paid) VALUES (?, 1)')
    .bind(MEMBER_ID)
    .run();

  const runRes = await mf.dispatchFetch('http://localhost/api/run/start', {
    method: 'POST',
    headers: buildAuthHeaders(MEMBER_ID),
  });
  assert.equal(runRes.status, 200);

  const threadStartRes = await mf.dispatchFetch('http://localhost/api/thread/start', {
    method: 'POST',
    headers: buildAuthHeaders(MEMBER_ID),
  });
  assert.equal(threadStartRes.status, 200);

  const res = await mf.dispatchFetch('http://localhost/api/thread/chat', {
    method: 'POST',
    headers: {
      ...buildAuthHeaders(MEMBER_ID),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ message: 'hello' }),
  });

  assert.equal(res.status, 502);
  const body = await res.json();
  assert.equal(body.ok, false);
  assert.equal(body.error?.code, 'INTERNAL_ERROR');
  assert.equal(typeof body.error?.message, 'string');
});

test('POST /api/thread/chat returns standardized internal error when OpenAI fetch fails', async () => {
  openAiResponsesMode = 'network_error';

  await db
    .prepare('INSERT INTO user_flags (user_id, paid) VALUES (?, 1)')
    .bind(MEMBER_ID)
    .run();

  const runRes = await mf.dispatchFetch('http://localhost/api/run/start', {
    method: 'POST',
    headers: buildAuthHeaders(MEMBER_ID),
  });
  assert.equal(runRes.status, 200);

  const threadStartRes = await mf.dispatchFetch('http://localhost/api/thread/start', {
    method: 'POST',
    headers: buildAuthHeaders(MEMBER_ID),
  });
  assert.equal(threadStartRes.status, 200);

  const res = await mf.dispatchFetch('http://localhost/api/thread/chat', {
    method: 'POST',
    headers: {
      ...buildAuthHeaders(MEMBER_ID),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ message: 'hello' }),
  });

  assert.equal(res.status, 502);
  const body = await res.json();
  assert.equal(body.ok, false);
  assert.equal(body.error?.code, 'INTERNAL_ERROR');
  assert.equal(typeof body.error?.message, 'string');
});

test('POST /api/thread/chat returns bad request when message is too long', async () => {
  await db
    .prepare('INSERT INTO user_flags (user_id, paid) VALUES (?, 1)')
    .bind(MEMBER_ID)
    .run();

  const runRes = await mf.dispatchFetch('http://localhost/api/run/start', {
    method: 'POST',
    headers: buildAuthHeaders(MEMBER_ID),
  });
  assert.equal(runRes.status, 200);

  const threadStartRes = await mf.dispatchFetch('http://localhost/api/thread/start', {
    method: 'POST',
    headers: buildAuthHeaders(MEMBER_ID),
  });
  assert.equal(threadStartRes.status, 200);

  const res = await mf.dispatchFetch('http://localhost/api/thread/chat', {
    method: 'POST',
    headers: {
      ...buildAuthHeaders(MEMBER_ID),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ message: 'a'.repeat(2001) }),
  });

  assert.equal(res.status, 400);
  const body = await res.json();
  assert.equal(body.ok, false);
  assert.equal(body.error?.code, 'BAD_REQUEST');
  assert.equal(typeof body.error?.message, 'string');
});

test('POST /api/thread/chat accepts action=next and skips OpenAI call', async () => {
  await db
    .prepare('INSERT INTO user_flags (user_id, paid) VALUES (?, 1)')
    .bind(MEMBER_ID)
    .run();

  const runRes = await mf.dispatchFetch('http://localhost/api/run/start', {
    method: 'POST',
    headers: buildAuthHeaders(MEMBER_ID),
  });
  assert.equal(runRes.status, 200);

  const threadStartRes = await mf.dispatchFetch('http://localhost/api/thread/start', {
    method: 'POST',
    headers: buildAuthHeaders(MEMBER_ID),
  });
  assert.equal(threadStartRes.status, 200);

  const res = await mf.dispatchFetch('http://localhost/api/thread/chat', {
    method: 'POST',
    headers: {
      ...buildAuthHeaders(MEMBER_ID),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ action: 'next' }),
  });

  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(typeof body.reply, 'string');
  assert.equal(openAiResponsesRequestCount, 0);
});

test('POST /api/thread/chat does not persist plaintext message', async () => {
  await db
    .prepare('INSERT INTO user_flags (user_id, paid) VALUES (?, 1)')
    .bind(MEMBER_ID)
    .run();

  const runRes = await mf.dispatchFetch('http://localhost/api/run/start', {
    method: 'POST',
    headers: buildAuthHeaders(MEMBER_ID),
  });
  assert.equal(runRes.status, 200);

  const threadStartRes = await mf.dispatchFetch('http://localhost/api/thread/start', {
    method: 'POST',
    headers: buildAuthHeaders(MEMBER_ID),
  });
  assert.equal(threadStartRes.status, 200);
  const threadStartBody = await threadStartRes.json();
  const threadId = threadStartBody.thread?.id;
  assert.equal(typeof threadId, 'string');

  const res = await mf.dispatchFetch('http://localhost/api/thread/chat', {
    method: 'POST',
    headers: {
      ...buildAuthHeaders(MEMBER_ID),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ message: 'hello from chat' }),
  });

  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(body.reply, 'mock reply');

  const countRow = await db
    .prepare('SELECT COUNT(*) AS count FROM messages WHERE thread_id = ?')
    .bind(threadId)
    .first();
  assert.equal(countRow?.count, 0);
});

test('POST /api/thread/chat accepts message without legacy card fields', async () => {
  await db
    .prepare('INSERT INTO user_flags (user_id, paid) VALUES (?, 1)')
    .bind(MEMBER_ID)
    .run();

  const runRes = await mf.dispatchFetch('http://localhost/api/run/start', {
    method: 'POST',
    headers: buildAuthHeaders(MEMBER_ID),
  });
  assert.equal(runRes.status, 200);

  const threadStartRes = await mf.dispatchFetch('http://localhost/api/thread/start', {
    method: 'POST',
    headers: buildAuthHeaders(MEMBER_ID),
  });
  assert.equal(threadStartRes.status, 200);

  const res = await mf.dispatchFetch('http://localhost/api/thread/chat', {
    method: 'POST',
    headers: {
      ...buildAuthHeaders(MEMBER_ID),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ message: 'hello' }),
  });

  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(body.reply, 'mock reply');
});

test('POST /api/thread/chat ignores legacy card fields when calling OpenAI', async () => {
  await db
    .prepare('INSERT INTO user_flags (user_id, paid) VALUES (?, 1)')
    .bind(MEMBER_ID)
    .run();

  const runRes = await mf.dispatchFetch('http://localhost/api/run/start', {
    method: 'POST',
    headers: buildAuthHeaders(MEMBER_ID),
  });
  assert.equal(runRes.status, 200);

  const threadStartRes = await mf.dispatchFetch('http://localhost/api/thread/start', {
    method: 'POST',
    headers: buildAuthHeaders(MEMBER_ID),
  });
  assert.equal(threadStartRes.status, 200);

  const res = await mf.dispatchFetch('http://localhost/api/thread/chat', {
    method: 'POST',
    headers: {
      ...buildAuthHeaders(MEMBER_ID),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      message: 'hello',
      context_card: 'あ'.repeat(201),
      step2_meta_card: 'legacy meta card',
    }),
  });

  assert.equal(res.status, 200);
  assert.equal(openAiResponsesRequestCount, 1);
  assert.ok(lastOpenAiResponsesRequestJson);

  const input = lastOpenAiResponsesRequestJson.input;
  assert.ok(Array.isArray(input));
  const hasLegacyCard = input.some((item) => item.role === 'system' && typeof item.content === 'string' && item.content.includes('あ'.repeat(201)));
  const hasLegacyMetaCard = input.some((item) => item.role === 'system' && typeof item.content === 'string' && item.content.includes('legacy meta card'));
  assert.equal(hasLegacyCard, false);
  assert.equal(hasLegacyMetaCard, false);
});

test('POST /api/thread/chat sends only system prompt and user message to OpenAI', async () => {
  await db
    .prepare('INSERT INTO user_flags (user_id, paid) VALUES (?, 1)')
    .bind(MEMBER_ID)
    .run();

  const runRes = await mf.dispatchFetch('http://localhost/api/run/start', {
    method: 'POST',
    headers: buildAuthHeaders(MEMBER_ID),
  });
  assert.equal(runRes.status, 200);

  const threadStartRes = await mf.dispatchFetch('http://localhost/api/thread/start', {
    method: 'POST',
    headers: buildAuthHeaders(MEMBER_ID),
  });
  assert.equal(threadStartRes.status, 200);

  const res = await mf.dispatchFetch('http://localhost/api/thread/chat', {
    method: 'POST',
    headers: {
      ...buildAuthHeaders(MEMBER_ID),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ message: 'hello' }),
  });

  assert.equal(res.status, 200);
  assert.equal(openAiResponsesRequestCount, 1);
  assert.ok(lastOpenAiResponsesRequestJson);

  const input = lastOpenAiResponsesRequestJson.input;
  assert.ok(Array.isArray(input));
  assert.equal(input.length, 2);
  assert.equal(input[0]?.role, 'system');
  assert.equal(input[1]?.role, 'user');
  assert.equal(input[1]?.content, 'hello');
});

test('POST /api/thread/chat embeds the query, searches Qdrant, and injects top chunks into OpenAI context', async () => {
  qdrantSearchHits = [
    {
      id: 'msg-1#0',
      score: 0.99,
      payload: { text: '最上位チャンク', chunk_no: 0, message_id: 'msg-1' },
    },
    {
      id: 'msg-2#0',
      score: 0.97,
      payload: { text: '二番目チャンク', chunk_no: 0, message_id: 'msg-2' },
    },
    {
      id: 'msg-3#1',
      score: 0.95,
      payload: { text: '三番目チャンク', chunk_no: 1, message_id: 'msg-3' },
    },
    {
      id: 'msg-4#2',
      score: 0.93,
      payload: { text: '四番目チャンク', chunk_no: 2, message_id: 'msg-4' },
    },
  ];

  await db
    .prepare('INSERT INTO user_flags (user_id, paid) VALUES (?, 1)')
    .bind(MEMBER_ID)
    .run();

  const runRes = await mf.dispatchFetch('http://localhost/api/run/start', {
    method: 'POST',
    headers: buildAuthHeaders(MEMBER_ID),
  });
  assert.equal(runRes.status, 200);

  const threadStartRes = await mf.dispatchFetch('http://localhost/api/thread/start', {
    method: 'POST',
    headers: buildAuthHeaders(MEMBER_ID),
  });
  assert.equal(threadStartRes.status, 200);

  const res = await mf.dispatchFetch('http://localhost/api/thread/chat', {
    method: 'POST',
    headers: {
      ...buildAuthHeaders(MEMBER_ID),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ message: '過去の文脈も踏まえて教えて' }),
  });

  assert.equal(res.status, 200);
  assert.equal(openAiEmbeddingsRequestCount, 1);
  assert.deepEqual(lastOpenAiEmbeddingsRequestJson?.input, ['過去の文脈も踏まえて教えて']);
  assert.equal(qdrantSearchRequestCount, 1);
  assert.deepEqual(lastQdrantSearchRequestJson?.vector, [0.1, 0.2, 0.3]);
  assert.equal(lastQdrantSearchRequestJson?.limit, 3);
  assert.deepEqual(lastQdrantSearchRequestJson?.filter, {
    must: [
      {
        key: 'user_id',
        match: { value: MEMBER_ID },
      },
    ],
  });
  assert.ok(lastOpenAiResponsesRequestJson);

  const input = lastOpenAiResponsesRequestJson.input;
  assert.ok(Array.isArray(input));
  assert.equal(input.length, 3);
  assert.equal(input[0]?.role, 'system');
  assert.equal(input[1]?.role, 'system');
  assert.match(input[1]?.content, /関連チャンク/);
  assert.match(input[1]?.content, /最上位チャンク/);
  assert.match(input[1]?.content, /二番目チャンク/);
  assert.match(input[1]?.content, /三番目チャンク/);
  assert.doesNotMatch(input[1]?.content, /四番目チャンク/);
  assert.equal(input[2]?.role, 'user');
  assert.equal(input[2]?.content, '過去の文脈も踏まえて教えて');
});

test('POST /api/thread/chat returns standardized internal error when RAG context lookup fails', async () => {
  qdrantSearchMode = 'error_json';

  await db
    .prepare('INSERT INTO user_flags (user_id, paid) VALUES (?, 1)')
    .bind(MEMBER_ID)
    .run();

  const runRes = await mf.dispatchFetch('http://localhost/api/run/start', {
    method: 'POST',
    headers: buildAuthHeaders(MEMBER_ID),
  });
  assert.equal(runRes.status, 200);

  const threadStartRes = await mf.dispatchFetch('http://localhost/api/thread/start', {
    method: 'POST',
    headers: buildAuthHeaders(MEMBER_ID),
  });
  assert.equal(threadStartRes.status, 200);

  const res = await mf.dispatchFetch('http://localhost/api/thread/chat', {
    method: 'POST',
    headers: {
      ...buildAuthHeaders(MEMBER_ID),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ message: 'help' }),
  });

  assert.equal(res.status, 502);
  assert.equal(openAiEmbeddingsRequestCount, 1);
  assert.equal(qdrantSearchRequestCount, 1);
  assert.equal(openAiResponsesRequestCount, 0);

  const body = await res.json();
  assert.deepEqual(body, {
    ok: false,
    error: {
      code: 'INTERNAL_ERROR',
      message: 'RAG context lookup failed',
    },
  });
});

test('POST /api/thread/chat ignores legacy step2_meta_card on step2', async () => {
  await db
    .prepare('INSERT INTO user_flags (user_id, paid) VALUES (?, 1)')
    .bind(MEMBER_ID)
    .run();

  const runRes = await mf.dispatchFetch('http://localhost/api/run/start', {
    method: 'POST',
    headers: buildAuthHeaders(MEMBER_ID),
  });
  assert.equal(runRes.status, 200);
  const runBody = await runRes.json();
  const runId = runBody.run?.id;
  assert.equal(typeof runId, 'string');

  await db
    .prepare('INSERT INTO threads (id, run_id, user_id, step, question_no, session_no, status) VALUES (?, ?, ?, 2, NULL, 1, ? )')
    .bind('thread-step2-active-1', runId, MEMBER_ID, 'active')
    .run();

  const metaCard = '- Step2洞察: 怒りの下に恐れがある';

  const res = await mf.dispatchFetch('http://localhost/api/thread/chat', {
    method: 'POST',
    headers: {
      ...buildAuthHeaders(MEMBER_ID),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      message: 'session2 を進めたい',
      step2_meta_card: metaCard,
    }),
  });

  assert.equal(res.status, 200);
  assert.equal(openAiResponsesRequestCount, 1);
  assert.ok(lastOpenAiResponsesRequestJson);

  const input = lastOpenAiResponsesRequestJson.input;
  assert.ok(Array.isArray(input));
  const hasMetaCard = input.some((item) => item.role === 'system' && typeof item.content === 'string' && item.content.includes(metaCard));
  assert.equal(hasMetaCard, false);
});

test('POST /api/thread/message persists encrypted payload and GET /api/thread/messages returns encrypted fields', async () => {
  await db
    .prepare('INSERT INTO user_flags (user_id, paid) VALUES (?, 1)')
    .bind(MEMBER_ID)
    .run();

  const runRes = await mf.dispatchFetch('http://localhost/api/run/start', {
    method: 'POST',
    headers: buildAuthHeaders(MEMBER_ID),
  });
  assert.equal(runRes.status, 200);

  const threadStartRes = await mf.dispatchFetch('http://localhost/api/thread/start', {
    method: 'POST',
    headers: buildAuthHeaders(MEMBER_ID),
  });
  assert.equal(threadStartRes.status, 200);
  const threadStartBody = await threadStartRes.json();
  const threadId = threadStartBody.thread?.id;
  assert.equal(typeof threadId, 'string');

  const saveRes = await mf.dispatchFetch('http://localhost/api/thread/message', {
    method: 'POST',
    headers: {
      ...buildAuthHeaders(MEMBER_ID),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      thread_id: threadId,
      role: 'user',
      client_message_id: 'cm-1',
      ciphertext: 'cipher-text-base64',
      iv: 'iv-base64',
      alg: 'AES-256-GCM',
      v: 1,
      kid: 'k1',
      wrapped_key: 'wrapped-key-base64',
      wrapped_key_alg: 'RSAES_OAEP_SHA_256',
      wrapped_key_kid: 'kms-key-1',
    }),
  });

  assert.equal(saveRes.status, 200);
  const saveBody = await saveRes.json();
  assert.equal(saveBody.ok, true);

  const raw = await db
    .prepare('SELECT content, content_iv, content_alg, content_v, content_kid, content_wrapped_key, content_wrapped_key_alg, content_wrapped_key_kid FROM messages WHERE thread_id = ? LIMIT 1')
    .bind(threadId)
    .first();

  assert.equal(raw?.content, 'cipher-text-base64');
  assert.equal(raw?.content_iv, 'iv-base64');
  assert.equal(raw?.content_alg, 'AES-256-GCM');
  assert.equal(raw?.content_v, 1);
  assert.equal(raw?.content_kid, 'k1');
  assert.equal(raw?.content_wrapped_key, 'wrapped-key-base64');
  assert.equal(raw?.content_wrapped_key_alg, 'RSAES_OAEP_SHA_256');
  assert.equal(raw?.content_wrapped_key_kid, 'kms-key-1');

  const listRes = await mf.dispatchFetch(`http://localhost/api/thread/messages?thread_id=${threadId}`, {
    method: 'GET',
    headers: buildAuthHeaders(MEMBER_ID),
  });

  assert.equal(listRes.status, 200);
  const listBody = await listRes.json();
  assert.equal(listBody.ok, true);
  assert.equal(listBody.messages.length, 1);
  assert.equal(listBody.messages[0].ciphertext, 'cipher-text-base64');
  assert.equal(listBody.messages[0].iv, 'iv-base64');
  assert.equal(listBody.messages[0].alg, 'AES-256-GCM');
  assert.equal(listBody.messages[0].v, 1);
  assert.equal(listBody.messages[0].kid, 'k1');
  assert.equal(listBody.messages[0].wrapped_key, 'wrapped-key-base64');
  assert.equal(listBody.messages[0].wrapped_key_alg, 'RSAES_OAEP_SHA_256');
  assert.equal(listBody.messages[0].wrapped_key_kid, 'kms-key-1');
  assert.equal(listBody.messages[0].content, undefined);
});

test('POST /api/thread/message rejects payload without wrapped key fields', async () => {
  await db
    .prepare('INSERT INTO user_flags (user_id, paid) VALUES (?, 1)')
    .bind(MEMBER_ID)
    .run();

  const runRes = await mf.dispatchFetch('http://localhost/api/run/start', {
    method: 'POST',
    headers: buildAuthHeaders(MEMBER_ID),
  });
  assert.equal(runRes.status, 200);

  const threadStartRes = await mf.dispatchFetch('http://localhost/api/thread/start', {
    method: 'POST',
    headers: buildAuthHeaders(MEMBER_ID),
  });
  assert.equal(threadStartRes.status, 200);
  const threadStartBody = await threadStartRes.json();
  const threadId = threadStartBody.thread?.id;
  assert.equal(typeof threadId, 'string');

  const basePayload = {
    thread_id: threadId,
    role: 'assistant',
    client_message_id: 'cm-without-wrapped-key',
    ciphertext: 'cipher-no-wrap',
    iv: 'iv-no-wrap',
    alg: 'AES-256-GCM',
    v: 1,
    wrapped_key: 'wrapped-key-base64',
    wrapped_key_alg: 'RSAES_OAEP_SHA_256',
    wrapped_key_kid: 'kms-key-1',
  };

  for (const [missingField, expectedMessage] of [
    ['wrapped_key', 'wrapped_key is required'],
    ['wrapped_key_alg', 'wrapped_key_alg is required'],
    ['wrapped_key_kid', 'wrapped_key_kid is required'],
  ]) {
    const payload = { ...basePayload };
    delete payload[missingField];

    const saveRes = await mf.dispatchFetch('http://localhost/api/thread/message', {
      method: 'POST',
      headers: {
        ...buildAuthHeaders(MEMBER_ID),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    assert.equal(saveRes.status, 400);
    const saveBody = await saveRes.json();
    assert.equal(saveBody.error?.code, 'BAD_REQUEST');
    assert.equal(saveBody.error?.message, expectedMessage);
  }

  const raw = await db
    .prepare('SELECT COUNT(*) AS count FROM messages WHERE thread_id = ?')
    .bind(threadId)
    .first();

  assert.equal(raw?.count, 0);
});

test('POST /api/rag/chunks requires paid user', async () => {
  const res = await mf.dispatchFetch('http://localhost/api/rag/chunks', {
    method: 'POST',
    headers: {
      ...buildAuthHeaders(MEMBER_ID),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      thread_id: 'thread-1',
      message_id: 'msg-1',
      chunks: [{ chunk_no: 0, text: 'first chunk' }],
    }),
  });

  assert.equal(res.status, 403);
  const body = await res.json();
  assert.equal(body.ok, false);
  assert.equal(body.error?.code, 'FORBIDDEN');
});

test('POST /api/rag/chunks accepts chunks for an owned message', async () => {
  await db
    .prepare('INSERT INTO user_flags (user_id, paid) VALUES (?, 1)')
    .bind(MEMBER_ID)
    .run();

  const runRes = await mf.dispatchFetch('http://localhost/api/run/start', {
    method: 'POST',
    headers: buildAuthHeaders(MEMBER_ID),
  });
  assert.equal(runRes.status, 200);

  const threadStartRes = await mf.dispatchFetch('http://localhost/api/thread/start', {
    method: 'POST',
    headers: buildAuthHeaders(MEMBER_ID),
  });
  assert.equal(threadStartRes.status, 200);
  const threadStartBody = await threadStartRes.json();
  const threadId = threadStartBody.thread?.id;
  assert.equal(typeof threadId, 'string');

  const clientMessageId = 'cm-rag-upsert-1';
  const saveRes = await mf.dispatchFetch('http://localhost/api/thread/message', {
    method: 'POST',
    headers: {
      ...buildAuthHeaders(MEMBER_ID),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      thread_id: threadId,
      role: 'user',
      client_message_id: clientMessageId,
      ciphertext: 'cipher-text-base64',
      iv: 'iv-base64',
      alg: 'AES-256-GCM',
      v: 1,
      wrapped_key: 'wrapped-key-base64',
      wrapped_key_alg: 'RSAES_OAEP_SHA_256',
      wrapped_key_kid: 'kms-key-1',
    }),
  });
  assert.equal(saveRes.status, 200);

  const messageRow = await db
    .prepare('SELECT id FROM messages WHERE thread_id = ? AND user_id = ? AND client_message_id = ? LIMIT 1')
    .bind(threadId, MEMBER_ID, clientMessageId)
    .first();
  const messageId = messageRow?.id;
  assert.equal(typeof messageId, 'string');

  const ragRes = await mf.dispatchFetch('http://localhost/api/rag/chunks', {
    method: 'POST',
    headers: {
      ...buildAuthHeaders(MEMBER_ID),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      thread_id: threadId,
      message_id: messageId,
      chunks: [
        { chunk_no: 0, text: '最初のチャンク' },
        { chunk_no: 1, text: '二つ目のチャンク' },
      ],
    }),
  });

  assert.equal(ragRes.status, 200);
  const ragBody = await ragRes.json();
  assert.equal(ragBody.ok, true);
  assert.equal(ragBody.thread_id, threadId);
  assert.equal(ragBody.message_id, messageId);
  assert.equal(ragBody.chunk_count, 2);
  assert.equal(ragBody.status, 'accepted');

  assert.equal(openAiEmbeddingsRequestCount, 1);
  assert.deepEqual(lastOpenAiEmbeddingsRequestJson, {
    model: 'text-embedding-3-small',
    input: ['最初のチャンク', '二つ目のチャンク'],
  });

  assert.equal(qdrantUpsertRequestCount, 1);
  assert.deepEqual(lastQdrantUpsertRequestJson, {
    points: [
      {
        id: `${messageId}#0`,
        vector: [0.1, 0.2, 0.3],
        payload: {
          schema: 'rag_chunk_v1',
          user_id: MEMBER_ID,
          thread_id: threadId,
          message_id: messageId,
          chunk_no: 0,
          text: '最初のチャンク',
        },
      },
      {
        id: `${messageId}#1`,
        vector: [1.1, 1.2, 1.3],
        payload: {
          schema: 'rag_chunk_v1',
          user_id: MEMBER_ID,
          thread_id: threadId,
          message_id: messageId,
          chunk_no: 1,
          text: '二つ目のチャンク',
        },
      },
    ],
  });
});

test('POST /api/rag/chunks returns 502 when embeddings generation fails', async () => {
  openAiEmbeddingsMode = 'error_json';

  await db
    .prepare('INSERT INTO user_flags (user_id, paid) VALUES (?, 1)')
    .bind(MEMBER_ID)
    .run();

  const runRes = await mf.dispatchFetch('http://localhost/api/run/start', {
    method: 'POST',
    headers: buildAuthHeaders(MEMBER_ID),
  });
  assert.equal(runRes.status, 200);

  const threadStartRes = await mf.dispatchFetch('http://localhost/api/thread/start', {
    method: 'POST',
    headers: buildAuthHeaders(MEMBER_ID),
  });
  assert.equal(threadStartRes.status, 200);
  const threadStartBody = await threadStartRes.json();
  const threadId = threadStartBody.thread?.id;
  assert.equal(typeof threadId, 'string');

  const saveRes = await mf.dispatchFetch('http://localhost/api/thread/message', {
    method: 'POST',
    headers: {
      ...buildAuthHeaders(MEMBER_ID),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      thread_id: threadId,
      role: 'assistant',
      client_message_id: 'cm-rag-embed-fail-1',
      ciphertext: 'cipher-text-base64',
      iv: 'iv-base64',
      alg: 'AES-256-GCM',
      v: 1,
      wrapped_key: 'wrapped-key-base64',
      wrapped_key_alg: 'RSAES_OAEP_SHA_256',
      wrapped_key_kid: 'kms-key-1',
    }),
  });
  assert.equal(saveRes.status, 200);

  const res = await mf.dispatchFetch('http://localhost/api/rag/chunks', {
    method: 'POST',
    headers: {
      ...buildAuthHeaders(MEMBER_ID),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      thread_id: threadId,
      client_message_id: 'cm-rag-embed-fail-1',
      chunks: [{ chunk_no: 0, text: 'test chunk' }],
    }),
  });

  assert.equal(res.status, 502);
  const body = await res.json();
  assert.equal(body.ok, false);
  assert.equal(body.error?.code, 'INTERNAL_ERROR');
  assert.equal(body.error?.message, 'Embedding generation failed');
  assert.equal(qdrantUpsertRequestCount, 0);
});

test('POST /api/rag/chunks rejects duplicate chunk_no', async () => {
  await db
    .prepare('INSERT INTO user_flags (user_id, paid) VALUES (?, 1)')
    .bind(MEMBER_ID)
    .run();

  const runRes = await mf.dispatchFetch('http://localhost/api/run/start', {
    method: 'POST',
    headers: buildAuthHeaders(MEMBER_ID),
  });
  assert.equal(runRes.status, 200);

  const threadStartRes = await mf.dispatchFetch('http://localhost/api/thread/start', {
    method: 'POST',
    headers: buildAuthHeaders(MEMBER_ID),
  });
  assert.equal(threadStartRes.status, 200);
  const threadStartBody = await threadStartRes.json();
  const threadId = threadStartBody.thread?.id;
  assert.equal(typeof threadId, 'string');

  const saveRes = await mf.dispatchFetch('http://localhost/api/thread/message', {
    method: 'POST',
    headers: {
      ...buildAuthHeaders(MEMBER_ID),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      thread_id: threadId,
      role: 'assistant',
      client_message_id: 'cm-rag-dup-1',
      ciphertext: 'cipher-text-base64',
      iv: 'iv-base64',
      alg: 'AES-256-GCM',
      v: 1,
      wrapped_key: 'wrapped-key-base64',
      wrapped_key_alg: 'RSAES_OAEP_SHA_256',
      wrapped_key_kid: 'kms-key-1',
    }),
  });
  assert.equal(saveRes.status, 200);

  const res = await mf.dispatchFetch('http://localhost/api/rag/chunks', {
    method: 'POST',
    headers: {
      ...buildAuthHeaders(MEMBER_ID),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      thread_id: threadId,
      client_message_id: 'cm-rag-dup-1',
      chunks: [
        { chunk_no: 0, text: 'a' },
        { chunk_no: 0, text: 'b' },
      ],
    }),
  });

  assert.equal(res.status, 400);
  const body = await res.json();
  assert.equal(body.ok, false);
  assert.equal(body.error?.code, 'BAD_REQUEST');
  assert.equal(body.error?.message, 'chunk_no must be unique within chunks');
});

test('GET /api/crypto/kms_public_key returns kid and PEM public key', async () => {
  const res = await mf.dispatchFetch('http://localhost/api/crypto/kms_public_key');

  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(body.kid, MOCK_KMS_KEY_ID);
  assert.equal(body.public_key_pem, formatPemFromBase64(mockKmsPublicKeyDerBase64));

  const kmsRequest = mockAwsRequests.find((entry) => entry.target === 'TrentService.GetPublicKey');
  assert.ok(kmsRequest);
  assert.match(kmsRequest.headers.authorization, /^AWS4-HMAC-SHA256 /);
  assert.match(kmsRequest.headers.authorization, /Credential=test-aws-access-key\/\d{8}\/ap-southeast-2\/kms\/aws4_request/);
  assert.equal(kmsRequest.headers['x-amz-security-token'], undefined);
  assert.match(String(kmsRequest.headers['x-amz-date']), /^\d{8}T\d{6}Z$/);
  assert.equal(kmsRequest.headers['x-amz-content-sha256'], 'bf0bc0d63f1aff5d0c4ca250b32b55624a4ae3d6f5f947d8308ac6bde3d8f4f0');
});

test('GET /api/crypto/kms_public_key returns standardized internal error when KMS_KEY_ID is missing', async () => {
  const workerPath = path.resolve('dist', 'worker.js');
  const localMf = new Miniflare({
    scriptPath: workerPath,
    modules: true,
    d1Databases: { DB: 'test-db-kms-public-key-missing-key-id' },
    bindings: {
      ...buildEnvBindings(),
      KMS_KEY_ID: '',
    },
  });

  try {
    const res = await localMf.dispatchFetch('http://localhost/api/crypto/kms_public_key');

    assert.equal(res.status, 500);
    const body = await res.json();
    assert.equal(body.ok, false);
    assert.equal(body.error?.code, 'INTERNAL_ERROR');
    assert.equal(body.error?.message, 'KMS public key not available: missing KMS_KEY_ID');
  } finally {
    await localMf.dispose();
  }
});

test('POST /api/thread/message is idempotent with client_message_id', async () => {
  await db
    .prepare('INSERT INTO user_flags (user_id, paid) VALUES (?, 1)')
    .bind(MEMBER_ID)
    .run();

  const runRes = await mf.dispatchFetch('http://localhost/api/run/start', {
    method: 'POST',
    headers: buildAuthHeaders(MEMBER_ID),
  });
  assert.equal(runRes.status, 200);

  const threadStartRes = await mf.dispatchFetch('http://localhost/api/thread/start', {
    method: 'POST',
    headers: buildAuthHeaders(MEMBER_ID),
  });
  assert.equal(threadStartRes.status, 200);
  const threadStartBody = await threadStartRes.json();
  const threadId = threadStartBody.thread?.id;
  assert.equal(typeof threadId, 'string');

  const payload = {
    thread_id: threadId,
    role: 'assistant',
    client_message_id: 'cm-idempotent-1',
    ciphertext: 'cipher-1',
    iv: 'iv-1',
    alg: 'AES-256-GCM',
    v: 1,
    wrapped_key: 'wrapped-key-1',
    wrapped_key_alg: 'RSAES_OAEP_SHA_256',
    wrapped_key_kid: 'kms-key-1',
  };

  const first = await mf.dispatchFetch('http://localhost/api/thread/message', {
    method: 'POST',
    headers: {
      ...buildAuthHeaders(MEMBER_ID),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
  assert.equal(first.status, 200);

  const second = await mf.dispatchFetch('http://localhost/api/thread/message', {
    method: 'POST',
    headers: {
      ...buildAuthHeaders(MEMBER_ID),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
  assert.equal(second.status, 200);

  const countRow = await db
    .prepare('SELECT COUNT(*) AS count FROM messages WHERE thread_id = ? AND client_message_id = ?')
    .bind(threadId, 'cm-idempotent-1')
    .first();
  assert.equal(countRow?.count, 1);
});

test('POST /api/thread/message does not reject large ciphertext for cost control reasons', async () => {
  await db
    .prepare('INSERT INTO user_flags (user_id, paid) VALUES (?, 1)')
    .bind(MEMBER_ID)
    .run();

  const runRes = await mf.dispatchFetch('http://localhost/api/run/start', {
    method: 'POST',
    headers: buildAuthHeaders(MEMBER_ID),
  });
  assert.equal(runRes.status, 200);

  const threadStartRes = await mf.dispatchFetch('http://localhost/api/thread/start', {
    method: 'POST',
    headers: buildAuthHeaders(MEMBER_ID),
  });
  assert.equal(threadStartRes.status, 200);
  const threadStartBody = await threadStartRes.json();
  const threadId = threadStartBody.thread?.id;
  assert.equal(typeof threadId, 'string');

  const res = await mf.dispatchFetch('http://localhost/api/thread/message', {
    method: 'POST',
    headers: {
      ...buildAuthHeaders(MEMBER_ID),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      thread_id: threadId,
      role: 'user',
      client_message_id: 'cm-large-ciphertext',
      ciphertext: 'x'.repeat(20001),
      iv: 'i'.repeat(513),
      alg: 'a'.repeat(65),
      v: 1,
      wrapped_key: 'wrapped-key-large',
      wrapped_key_alg: 'RSAES_OAEP_SHA_256',
      wrapped_key_kid: 'kms-key-large',
    }),
  });

  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
});

test('POST /api/thread/message returns 400 when id fields exceed max length', async () => {
  await db
    .prepare('INSERT INTO user_flags (user_id, paid) VALUES (?, 1)')
    .bind(MEMBER_ID)
    .run();

  const runRes = await mf.dispatchFetch('http://localhost/api/run/start', {
    method: 'POST',
    headers: buildAuthHeaders(MEMBER_ID),
  });
  assert.equal(runRes.status, 200);

  const threadStartRes = await mf.dispatchFetch('http://localhost/api/thread/start', {
    method: 'POST',
    headers: buildAuthHeaders(MEMBER_ID),
  });
  assert.equal(threadStartRes.status, 200);
  const threadStartBody = await threadStartRes.json();
  const threadId = threadStartBody.thread?.id;
  assert.equal(typeof threadId, 'string');

  const oversizedCases = [
    { field: 'client_message_id', value: 'c'.repeat(129) },
    { field: 'kid', value: 'k'.repeat(129) },
  ];

  for (const testCase of oversizedCases) {
    const payload = {
      thread_id: threadId,
      role: 'user',
      client_message_id: 'cm-len-test',
      ciphertext: 'cipher-ok',
      iv: 'iv-ok',
      alg: 'AES-256-GCM',
      v: 1,
      kid: 'kid-ok',
      wrapped_key: 'wrapped-key-ok',
      wrapped_key_alg: 'RSAES_OAEP_SHA_256',
      wrapped_key_kid: 'kms-key-ok',
    };
    payload[testCase.field] = testCase.value;

    const res = await mf.dispatchFetch('http://localhost/api/thread/message', {
      method: 'POST',
      headers: {
        ...buildAuthHeaders(MEMBER_ID),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.ok, false);
    assert.equal(body.error?.code, 'BAD_REQUEST');
  }
});

test('POST/GET /api/thread/context_card returns 404 after endpoint removal', async () => {
  await db
    .prepare('INSERT INTO user_flags (user_id, paid) VALUES (?, 1)')
    .bind(MEMBER_ID)
    .run();

  const runRes = await mf.dispatchFetch('http://localhost/api/run/start', {
    method: 'POST',
    headers: buildAuthHeaders(MEMBER_ID),
  });
  assert.equal(runRes.status, 200);

  const threadStartRes = await mf.dispatchFetch('http://localhost/api/thread/start', {
    method: 'POST',
    headers: buildAuthHeaders(MEMBER_ID),
  });
  assert.equal(threadStartRes.status, 200);
  const threadStartBody = await threadStartRes.json();
  const threadId = threadStartBody.thread?.id;
  assert.equal(typeof threadId, 'string');

  const saveRes = await mf.dispatchFetch('http://localhost/api/thread/context_card', {
    method: 'POST',
    headers: {
      ...buildAuthHeaders(MEMBER_ID),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      thread_id: threadId,
      ciphertext: 'ctx-cipher-1',
      iv: 'ctx-iv-1',
      alg: 'AES-256-GCM',
      v: 1,
      kid: 'k-ctx-1',
    }),
  });

  assert.equal(saveRes.status, 404);

  const getRes = await mf.dispatchFetch(`http://localhost/api/thread/context_card?thread_id=${threadId}`, {
    method: 'GET',
    headers: buildAuthHeaders(MEMBER_ID),
  });

  assert.equal(getRes.status, 404);
});

test('POST/GET /api/run/step2_meta_card returns 404 after endpoint removal', async () => {
  await db
    .prepare('INSERT INTO user_flags (user_id, paid) VALUES (?, 1)')
    .bind(MEMBER_ID)
    .run();

  const runRes = await mf.dispatchFetch('http://localhost/api/run/start', {
    method: 'POST',
    headers: buildAuthHeaders(MEMBER_ID),
  });
  assert.equal(runRes.status, 200);

  const saveRes = await mf.dispatchFetch('http://localhost/api/run/step2_meta_card', {
    method: 'POST',
    headers: {
      ...buildAuthHeaders(MEMBER_ID),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      ciphertext: 'meta-cipher-1',
      iv: 'meta-iv-1',
      alg: 'AES-256-GCM',
      v: 1,
      kid: 'k-meta-1',
    }),
  });

  assert.equal(saveRes.status, 404);

  const getRes = await mf.dispatchFetch('http://localhost/api/run/step2_meta_card', {
    method: 'GET',
    headers: buildAuthHeaders(MEMBER_ID),
  });

  assert.equal(getRes.status, 404);
});

test('API type definitions exclude legacy card contracts', async () => {
  const apiTypesPath = path.resolve(process.cwd(), 'src/types/api.ts');
  const databaseTypesPath = path.resolve(process.cwd(), 'src/types/database.ts');
  const [apiTypesSource, databaseTypesSource] = await Promise.all([
    fs.readFile(apiTypesPath, 'utf8'),
    fs.readFile(databaseTypesPath, 'utf8'),
  ]);

  assert.equal(apiTypesSource.includes('EncryptedCardPayload'), false);
  assert.equal(apiTypesSource.includes('ThreadContextCardResponse'), false);
  assert.equal(apiTypesSource.includes('RunStep2MetaCardResponse'), false);
  assert.equal(databaseTypesSource.includes('CardKind'), false);
  assert.equal(databaseTypesSource.includes('CardRow'), false);
});

test('API specification excludes legacy card endpoints and request fields', async () => {
  const apiSpecPath = path.resolve(process.cwd(), 'documents/基本設計書/20_API仕様.md');
  const apiSpecSource = await fs.readFile(apiSpecPath, 'utf8');

  assert.equal(apiSpecSource.includes('/api/thread/context_card'), false);
  assert.equal(apiSpecSource.includes('/api/run/step2_meta_card'), false);
  assert.equal(apiSpecSource.includes('`context_card` は必須'), false);
  assert.equal(apiSpecSource.includes('`step2_meta_card` は Step2 の thread では必須'), false);
  assert.equal(apiSpecSource.includes('"context_card":'), false);
  assert.equal(apiSpecSource.includes('"step2_meta_card":'), false);
});

test('GET /api/thread/state returns encrypted last_message when message exists', async () => {
  await db
    .prepare('INSERT INTO user_flags (user_id, paid) VALUES (?, 1)')
    .bind(MEMBER_ID)
    .run();

  const runRes = await mf.dispatchFetch('http://localhost/api/run/start', {
    method: 'POST',
    headers: buildAuthHeaders(MEMBER_ID),
  });
  assert.equal(runRes.status, 200);

  const threadStartRes = await mf.dispatchFetch('http://localhost/api/thread/start', {
    method: 'POST',
    headers: buildAuthHeaders(MEMBER_ID),
  });
  assert.equal(threadStartRes.status, 200);
  const threadStartBody = await threadStartRes.json();
  const threadId = threadStartBody.thread?.id;
  assert.equal(typeof threadId, 'string');

  const saveRes = await mf.dispatchFetch('http://localhost/api/thread/message', {
    method: 'POST',
    headers: {
      ...buildAuthHeaders(MEMBER_ID),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      thread_id: threadId,
      role: 'assistant',
      client_message_id: 'cm-state-1',
      ciphertext: 'cipher-state-1',
      iv: 'iv-state-1',
      alg: 'AES-256-GCM',
      v: 1,
      kid: 'k-state-1',
      wrapped_key: 'wrapped-key-state-1',
      wrapped_key_alg: 'RSAES_OAEP_SHA_256',
      wrapped_key_kid: 'kms-key-state-1',
    }),
  });
  assert.equal(saveRes.status, 200);

  const stateRes = await mf.dispatchFetch('http://localhost/api/thread/state', {
    method: 'GET',
    headers: buildAuthHeaders(MEMBER_ID),
  });
  assert.equal(stateRes.status, 200);

  const stateBody = await stateRes.json();
  assert.equal(stateBody.ok, true);
  assert.equal(stateBody.thread?.id, threadId);
  assert.equal(stateBody.last_message?.role, 'assistant');
  assert.equal(stateBody.last_message?.client_message_id, 'cm-state-1');
  assert.equal(stateBody.last_message?.ciphertext, 'cipher-state-1');
  assert.equal(stateBody.last_message?.iv, 'iv-state-1');
  assert.equal(stateBody.last_message?.alg, 'AES-256-GCM');
  assert.equal(stateBody.last_message?.v, 1);
  assert.equal(stateBody.last_message?.kid, 'k-state-1');
  assert.equal(stateBody.last_message?.content, undefined);
});


test('GET /api/paid returns false when unpaid', async () => {
  const res = await mf.dispatchFetch('http://localhost/api/paid', {
    headers: buildAuthHeaders(MEMBER_ID),
  });

  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(body.paid, false);
});

test('POST /api/run/start returns 403 when unpaid', async () => {
  const res = await mf.dispatchFetch('http://localhost/api/run/start', {
    method: 'POST',
    headers: buildAuthHeaders(MEMBER_ID),
  });

  assert.equal(res.status, 403);
  const body = await res.json();
  assert.equal(body.ok, false);
  assert.equal(body.error?.code, 'FORBIDDEN');
});

test('POST /api/run/start succeeds when paid', async () => {
  await db
    .prepare('INSERT INTO user_flags (user_id, paid) VALUES (?, 1)')
    .bind(MEMBER_ID)
    .run();

  const res = await mf.dispatchFetch('http://localhost/api/run/start', {
    method: 'POST',
    headers: buildAuthHeaders(MEMBER_ID),
  });

  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(body.run?.run_no, 1);
});

test('POST /api/thread/start returns standardized bad request when run is completed', async () => {
  await db
    .prepare('INSERT INTO user_flags (user_id, paid) VALUES (?, 1)')
    .bind(MEMBER_ID)
    .run();

  const runRes = await mf.dispatchFetch('http://localhost/api/run/start', {
    method: 'POST',
    headers: buildAuthHeaders(MEMBER_ID),
  });
  assert.equal(runRes.status, 200);
  const runBody = await runRes.json();
  const runId = runBody?.run?.id;
  assert.equal(typeof runId, 'string');

  await db
    .prepare('INSERT INTO threads (id, run_id, user_id, step, question_no, session_no, status) VALUES (?, ?, ?, 1, 5, NULL, ? )')
    .bind(crypto.randomUUID(), runId, MEMBER_ID, 'completed')
    .run();

  await db
    .prepare('INSERT INTO threads (id, run_id, user_id, step, question_no, session_no, status) VALUES (?, ?, ?, 2, NULL, 30, ? )')
    .bind(crypto.randomUUID(), runId, MEMBER_ID, 'completed')
    .run();

  const res = await mf.dispatchFetch('http://localhost/api/thread/start', {
    method: 'POST',
    headers: buildAuthHeaders(MEMBER_ID),
  });

  assert.equal(res.status, 400);
  const body = await res.json();
  assert.equal(body.ok, false);
  assert.equal(body.error?.code, 'BAD_REQUEST');
  assert.equal(typeof body.error?.message, 'string');
});

test('POST /api/thread/start returns same active thread when called twice', async () => {
  await db
    .prepare('INSERT INTO user_flags (user_id, paid) VALUES (?, 1)')
    .bind(MEMBER_ID)
    .run();

  const runRes = await mf.dispatchFetch('http://localhost/api/run/start', {
    method: 'POST',
    headers: buildAuthHeaders(MEMBER_ID),
  });
  assert.equal(runRes.status, 200);

  const firstRes = await mf.dispatchFetch('http://localhost/api/thread/start', {
    method: 'POST',
    headers: buildAuthHeaders(MEMBER_ID),
  });
  assert.equal(firstRes.status, 200);
  const firstBody = await firstRes.json();
  assert.equal(firstBody.ok, true);

  const secondRes = await mf.dispatchFetch('http://localhost/api/thread/start', {
    method: 'POST',
    headers: buildAuthHeaders(MEMBER_ID),
  });
  assert.equal(secondRes.status, 200);
  const secondBody = await secondRes.json();
  assert.equal(secondBody.ok, true);

  assert.equal(secondBody.thread?.id, firstBody.thread?.id);
});

test('GET /api/thread/state returns null state when no run exists', async () => {
  await db
    .prepare('INSERT INTO user_flags (user_id, paid) VALUES (?, 1)')
    .bind(MEMBER_ID)
    .run();

  const res = await mf.dispatchFetch('http://localhost/api/thread/state', {
    method: 'GET',
    headers: buildAuthHeaders(MEMBER_ID),
  });

  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(body.run, null);
  assert.equal(body.thread, null);
  assert.equal(body.last_message, null);
});

test('GET /api/thread/state returns completed run with null thread', async () => {
  await db
    .prepare('INSERT INTO user_flags (user_id, paid) VALUES (?, 1)')
    .bind(MEMBER_ID)
    .run();

  const completedRunId = crypto.randomUUID();
  await db
    .prepare('INSERT INTO runs (id, user_id, run_no, status) VALUES (?, ?, ?, ?)')
    .bind(completedRunId, MEMBER_ID, 1, 'completed')
    .run();

  const res = await mf.dispatchFetch('http://localhost/api/thread/state', {
    method: 'GET',
    headers: buildAuthHeaders(MEMBER_ID),
  });

  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(body.run?.id, completedRunId);
  assert.equal(body.run?.status, 'completed');
  assert.equal(body.thread, null);
  assert.equal(body.last_message, null);
});

test('GET /api/threads/list returns standardized bad request for invalid run_no', async () => {
  await db
    .prepare('INSERT INTO user_flags (user_id, paid) VALUES (?, 1)')
    .bind(MEMBER_ID)
    .run();

  const res = await mf.dispatchFetch('http://localhost/api/threads/list?run_no=abc', {
    method: 'GET',
    headers: buildAuthHeaders(MEMBER_ID),
  });

  assert.equal(res.status, 400);
  const body = await res.json();
  assert.equal(body.ok, false);
  assert.equal(body.error?.code, 'BAD_REQUEST');
  assert.equal(typeof body.error?.message, 'string');
});

// --------------------------------------------------
// Stripe Webhook 統合テスト
// - 正しい署名で checkout.session.completed を投げると user_flags.paid が 1 になる
// - 誤った署名だと 400 エラーで何も反映されない
// --------------------------------------------------

test('POST /api/stripe/webhook sets paid when signature valid', async () => {
  stripeSessionStatus = 'paid';
  const ts = Math.floor(Date.now() / 1000);
  const payload = JSON.stringify({
    id: STRIPE_EVENT_ID,
    type: 'checkout.session.completed',
    data: { object: { id: MOCK_SESSION_ID } }
  });
  const toSign = `${ts}.${payload}`;

  const secret = buildEnvBindings().STRIPE_WEBHOOK_SECRET;
  const sig = crypto.createHmac('sha256', secret).update(toSign).digest('hex');

  const res = await mf.dispatchFetch('http://localhost/api/stripe/webhook', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Stripe-Signature': `t=${ts},v1=${sig}`,
    },
    body: payload,
  });

  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);

  const row = await db.prepare('SELECT paid FROM user_flags WHERE user_id = ? LIMIT 1').bind(MEMBER_ID).first();
  assert.equal(row?.paid, 1);
});

test('POST /api/stripe/webhook rejects invalid signature', async () => {
  const ts = Math.floor(Date.now() / 1000);
  const payload = JSON.stringify({
    id: 'evt_bad_sig',
    type: 'checkout.session.completed',
    data: { object: { client_reference_id: MEMBER_ID } }
  });

  const res = await mf.dispatchFetch('http://localhost/api/stripe/webhook', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Stripe-Signature': `t=${ts},v1=00deadbeef`,
    },
    body: payload,
  });

  assert.equal(res.status, 400);
  const body = await res.json();
  assert.equal(body.ok, false);
  assert.equal(body.error?.code, 'BAD_REQUEST');
  assert.equal(body.error?.message, 'signature verification failed');

  const row = await db.prepare('SELECT paid FROM user_flags WHERE user_id = ? LIMIT 1').bind(MEMBER_ID).first();
  // should be absent or 0
  assert.ok(!row || row.paid === 0);
});

test('main flow: webhook -> paid -> run -> thread -> chat -> encrypted save -> close', async () => {
  stripeSessionStatus = 'paid';

  const ts = Math.floor(Date.now() / 1000);
  const payload = JSON.stringify({
    id: 'evt_main_flow',
    type: 'checkout.session.completed',
    data: { object: { id: MOCK_SESSION_ID } }
  });
  const toSign = `${ts}.${payload}`;

  const secret = buildEnvBindings().STRIPE_WEBHOOK_SECRET;
  const sig = crypto.createHmac('sha256', secret).update(toSign).digest('hex');

  const hookRes = await mf.dispatchFetch('http://localhost/api/stripe/webhook', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Stripe-Signature': `t=${ts},v1=${sig}`,
    },
    body: payload,
  });

  assert.equal(hookRes.status, 200);

  const runRes = await mf.dispatchFetch('http://localhost/api/run/start', {
    method: 'POST',
    headers: buildAuthHeaders(MEMBER_ID),
  });

  assert.equal(runRes.status, 200);
  const runBody = await runRes.json();
  assert.equal(runBody.ok, true);

  const threadStartRes = await mf.dispatchFetch('http://localhost/api/thread/start', {
    method: 'POST',
    headers: buildAuthHeaders(MEMBER_ID),
  });

  assert.equal(threadStartRes.status, 200);
  const threadStartBody = await threadStartRes.json();
  assert.equal(threadStartBody.ok, true);

  const messageRes = await mf.dispatchFetch('http://localhost/api/thread/chat', {
    method: 'POST',
    headers: {
      ...buildAuthHeaders(MEMBER_ID),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ message: 'hello' }),
  });

  assert.equal(messageRes.status, 200);
  const messageBody = await messageRes.json();
  assert.equal(messageBody.ok, true);
  assert.equal(messageBody.reply, 'mock reply');

  const saveRes = await mf.dispatchFetch('http://localhost/api/thread/message', {
    method: 'POST',
    headers: {
      ...buildAuthHeaders(MEMBER_ID),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      thread_id: threadStartBody.thread.id,
      role: 'user',
      client_message_id: 'main-flow-cm-1',
      ciphertext: 'main-flow-cipher',
      iv: 'main-flow-iv',
      alg: 'AES-256-GCM',
      v: 1,
      wrapped_key: 'main-flow-wrapped-key',
      wrapped_key_alg: 'RSAES_OAEP_SHA_256',
      wrapped_key_kid: 'main-flow-kms-key',
    }),
  });

  assert.equal(saveRes.status, 200);
  const saveBody = await saveRes.json();
  assert.equal(saveBody.ok, true);

  const closeRes = await mf.dispatchFetch('http://localhost/api/thread/close', {
    method: 'POST',
    headers: buildAuthHeaders(MEMBER_ID),
  });

  assert.equal(closeRes.status, 200);
  const closeBody = await closeRes.json();
  assert.equal(closeBody.ok, true);
});

test('POST /api/stripe/webhook is idempotent per event id', async () => {
  stripeSessionStatus = 'paid';
  const ts = Math.floor(Date.now() / 1000);
  const payload = JSON.stringify({
    id: 'evt_idempotent',
    type: 'checkout.session.completed',
    data: { object: { id: MOCK_SESSION_ID } }
  });
  const toSign = `${ts}.${payload}`;

  const secret = buildEnvBindings().STRIPE_WEBHOOK_SECRET;
  const sig = crypto.createHmac('sha256', secret).update(toSign).digest('hex');

  const first = await mf.dispatchFetch('http://localhost/api/stripe/webhook', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Stripe-Signature': `t=${ts},v1=${sig}`,
    },
    body: payload,
  });

  assert.equal(first.status, 200);
  const firstBody = await first.json();
  assert.equal(firstBody.ok, true);

  const second = await mf.dispatchFetch('http://localhost/api/stripe/webhook', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Stripe-Signature': `t=${ts},v1=${sig}`,
    },
    body: payload,
  });

  assert.equal(second.status, 200);
  const secondBody = await second.json();
  assert.equal(secondBody.ok, true);

  const row = await db.prepare('SELECT COUNT(*) AS count FROM stripe_webhook_events WHERE event_id = ?')
    .bind('evt_idempotent')
    .first();

  assert.equal(row?.count, 1);
});

// --------------------------------------------------
// 管理API（/api/admin/set_paid）保護の統合テスト
// - 管理者 allowlist に加えて管理トークン（PAID_ADMIN_TOKEN）が必須
// --------------------------------------------------

test('POST /api/admin/set_paid requires admin token even for admin', async () => {
  const res = await mf.dispatchFetch('http://localhost/api/admin/set_paid', {
    method: 'POST',
    headers: {
      ...buildAuthHeaders('member-admin'),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ user_id: MEMBER_ID, paid: true }),
  });

  assert.equal(res.status, 403);
  const body = await res.json();
  assert.equal(body.ok, false);
  assert.equal(body.error?.code, 'FORBIDDEN');
});

test('POST /api/admin/set_paid rejects wrong admin token', async () => {
  const res = await mf.dispatchFetch('http://localhost/api/admin/set_paid', {
    method: 'POST',
    headers: {
      ...buildAuthHeaders('member-admin'),
      'Content-Type': 'application/json',
      'X-PAID-ADMIN-TOKEN': 'wrong-token',
    },
    body: JSON.stringify({ user_id: MEMBER_ID, paid: 1 }),
  });

  assert.equal(res.status, 403);
  const body = await res.json();
  assert.equal(body.ok, false);
  assert.equal(body.error?.code, 'FORBIDDEN');
});

test('POST /api/admin/set_paid rejects non-admin even with correct admin token', async () => {
  const res = await mf.dispatchFetch('http://localhost/api/admin/set_paid', {
    method: 'POST',
    headers: {
      ...buildAuthHeaders(MEMBER_ID),
      'Content-Type': 'application/json',
      'X-PAID-ADMIN-TOKEN': buildEnvBindings().PAID_ADMIN_TOKEN,
    },
    body: JSON.stringify({ user_id: MEMBER_ID, paid: 1 }),
  });

  assert.equal(res.status, 403);
  const body = await res.json();
  assert.equal(body.ok, false);
  assert.equal(body.error?.code, 'FORBIDDEN');
});

test('POST /api/admin/set_paid succeeds for admin with correct admin token', async () => {
  const targetUserId = MEMBER_ID;
  const res = await mf.dispatchFetch('http://localhost/api/admin/set_paid', {
    method: 'POST',
    headers: {
      ...buildAuthHeaders('member-admin'),
      'Content-Type': 'application/json',
      'X-PAID-ADMIN-TOKEN': buildEnvBindings().PAID_ADMIN_TOKEN,
    },
    body: JSON.stringify({ user_id: targetUserId, paid: 1 }),
  });

  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(body.user_id, targetUserId);
  assert.equal(body.paid, 1);

  const row = await db.prepare('SELECT paid FROM user_flags WHERE user_id = ? LIMIT 1').bind(targetUserId).first();
  assert.equal(row?.paid, 1);
});

test('POST /api/admin/set_paid returns standardized internal error when PAID_ADMIN_TOKEN is not set', async () => {
  const workerPath = path.resolve('dist', 'worker.js');
  const localMf = new Miniflare({
    scriptPath: workerPath,
    modules: true,
    d1Databases: { DB: 'test-db-admin-misconfig' },
    bindings: {
      ...buildEnvBindings(),
      PAID_ADMIN_TOKEN: '',
    },
  });

  try {
    const res = await localMf.dispatchFetch('http://localhost/api/admin/set_paid', {
      method: 'POST',
      headers: {
        ...buildAuthHeaders('member-admin'),
        'Content-Type': 'application/json',
        'X-PAID-ADMIN-TOKEN': 'any-token',
      },
      body: JSON.stringify({ user_id: MEMBER_ID, paid: 1 }),
    });

    assert.equal(res.status, 500);
    const body = await res.json();
    assert.equal(body.ok, false);
    assert.equal(body.error?.code, 'INTERNAL_ERROR');
    assert.equal(typeof body.error?.message, 'string');
  } finally {
    await localMf.dispose();
  }
});

// --------------------------------------------------
// KMS Unseal (dek_unseal) 統合テスト
// --------------------------------------------------

test('POST /api/crypto/dek/unseal returns dek_base64 when paid and request valid', async () => {
  await db
    .prepare('INSERT INTO user_flags (user_id, paid) VALUES (?, 1)')
    .bind(MEMBER_ID)
    .run();

  const wrappedKey = Buffer.from('wrapped-by-client').toString('base64');

  const res = await mf.dispatchFetch('http://localhost/api/crypto/dek/unseal', {
    method: 'POST',
    headers: {
      ...buildAuthHeaders(MEMBER_ID),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      wrapped_key: wrappedKey,
      wrapped_key_kid: MOCK_KMS_KEY_ID,
      wrapped_key_alg: 'RSAES_OAEP_SHA_256',
      thread_id: 'thread-for-unseal',
      message_id: 'msg-for-unseal',
      reason: 'test-unseal',
    }),
  });

  if (res.status !== 200) {
    const txt = await res.text();
    console.error('dek_unseal response body (non-200):', txt);
  }
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(body.wrapped_key_kid, MOCK_KMS_KEY_ID);
  assert.equal(body.wrapped_key_alg, 'RSAES_OAEP_SHA_256');
  assert.equal(body.dek_base64, Buffer.from('dek-plaintext').toString('base64'));

  const auditRow = await db
    .prepare('SELECT operator_user_id, target_user_id, thread_id, message_id, wrapped_key_kid, wrapped_key_alg, reason, outcome, error_code FROM decrypt_audit_logs ORDER BY created_at DESC LIMIT 1')
    .first();

  assert.equal(auditRow?.operator_user_id, MEMBER_ID);
  assert.equal(auditRow?.target_user_id, MEMBER_ID);
  assert.equal(auditRow?.thread_id, 'thread-for-unseal');
  assert.equal(auditRow?.message_id, 'msg-for-unseal');
  assert.equal(auditRow?.wrapped_key_kid, MOCK_KMS_KEY_ID);
  assert.equal(auditRow?.wrapped_key_alg, 'RSAES_OAEP_SHA_256');
  assert.equal(auditRow?.reason, 'test-unseal');
  assert.equal(auditRow?.outcome, 'success');
  assert.equal(auditRow?.error_code, null);

  const stsRequest = mockAwsRequests.find((entry) => entry.path === '/sts');
  assert.ok(stsRequest);
  assert.match(stsRequest.headers.authorization, /^AWS4-HMAC-SHA256 /);
  assert.match(stsRequest.headers.authorization, /Credential=test-aws-access-key\/\d{8}\/ap-southeast-2\/sts\/aws4_request/);
  assert.match(String(stsRequest.headers['x-amz-date']), /^\d{8}T\d{6}Z$/);
  assert.equal(stsRequest.headers['x-amz-content-sha256'], 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  assert.equal(stsRequest.query.Action, 'AssumeRole');
  assert.equal(stsRequest.query.RoleArn, 'arn:aws:iam::000000000000:role/test-assume-role');

  const kmsRequest = mockAwsRequests.find((entry) => entry.target === 'TrentService.Decrypt');
  assert.ok(kmsRequest);
  assert.match(kmsRequest.headers.authorization, /^AWS4-HMAC-SHA256 /);
  assert.match(kmsRequest.headers.authorization, /Credential=ASIA_TEST_ACCESS_KEY\/\d{8}\/ap-southeast-2\/kms\/aws4_request/);
  assert.equal(kmsRequest.headers['x-amz-security-token'], 'TEST_SESSION_TOKEN');
  assert.match(String(kmsRequest.headers['x-amz-date']), /^\d{8}T\d{6}Z$/);
  assert.equal(kmsRequest.headers['x-amz-content-sha256'], 'cfa4c668421f2a3e5a8d4249727b6fe0aa1369a0ad5577ff2a3857108b069cf9');
});

test('POST /api/crypto/dek/unseal returns 403 when user is not paid', async () => {
  // ensure no paid flag exists for MEMBER_ID
  const res = await mf.dispatchFetch('http://localhost/api/crypto/dek/unseal', {
    method: 'POST',
    headers: {
      ...buildAuthHeaders(MEMBER_ID),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      wrapped_key: Buffer.from('x').toString('base64'),
      wrapped_key_kid: MOCK_KMS_KEY_ID,
      wrapped_key_alg: 'RSAES_OAEP_SHA_256',
      thread_id: 't-unpaid',
      message_id: 'm-unpaid',
    }),
  });

  assert.equal(res.status, 403);
  const body = await res.json();
  assert.equal(body.ok, false);
  assert.equal(body.error?.code, 'FORBIDDEN');
});

test('POST /api/crypto/dek/unseal does not log plaintext dek when KMS decrypt fails', async () => {
  await db
    .prepare('INSERT INTO user_flags (user_id, paid) VALUES (?, 1)')
    .bind(MEMBER_ID)
    .run();

  mockKmsDecryptMode = 'sensitive_error';
  const wrappedKey = Buffer.from('wrapped-by-client').toString('base64');
  const leakedDekBase64 = Buffer.from('dek-plaintext').toString('base64');
  const originalConsoleError = console.error;
  const capturedLogs = [];

  console.error = (...args) => {
    capturedLogs.push(args.map((arg) => {
      if (typeof arg === 'string') return arg;
      try {
        return JSON.stringify(arg);
      } catch {
        return String(arg);
      }
    }).join(' '));
  };

  try {
    const res = await mf.dispatchFetch('http://localhost/api/crypto/dek/unseal', {
      method: 'POST',
      headers: {
        ...buildAuthHeaders(MEMBER_ID),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        wrapped_key: wrappedKey,
        wrapped_key_kid: MOCK_KMS_KEY_ID,
        wrapped_key_alg: 'RSAES_OAEP_SHA_256',
        thread_id: 'thread-sensitive-error',
        message_id: 'msg-sensitive-error',
        reason: 'sensitive-error-test',
      }),
    });

    assert.equal(res.status, 500);
    const body = await res.json();
    assert.equal(body.ok, false);
    assert.equal(body.error?.code, 'INTERNAL_ERROR');

    const combinedLogs = capturedLogs.join('\n');
    assert.equal(combinedLogs.includes(leakedDekBase64), false);
    assert.equal(combinedLogs.includes('dek-plaintext'), false);
    assert.equal(combinedLogs.includes(wrappedKey), false);
  } finally {
    console.error = originalConsoleError;
    mockKmsDecryptMode = 'ok';
  }
});
