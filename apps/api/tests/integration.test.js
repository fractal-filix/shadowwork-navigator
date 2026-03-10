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

function buildEnvBindings() {
  return {
    APP_ENV: 'test',
    OPENAI_API_KEY: 'test-openai-key',
    OPENAI_API_BASE_URL: mockBaseUrl,
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
    ALLOWED_ORIGINS: 'http://localhost:3000',
    ADMIN_MEMBER_IDS: 'member-admin'
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

test('POST /api/thread/message accepts payload without wrapped key fields', async () => {
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
      client_message_id: 'cm-without-wrapped-key',
      ciphertext: 'cipher-no-wrap',
      iv: 'iv-no-wrap',
      alg: 'AES-256-GCM',
      v: 1,
    }),
  });

  assert.equal(saveRes.status, 200);

  const listRes = await mf.dispatchFetch(`http://localhost/api/thread/messages?thread_id=${threadId}`, {
    method: 'GET',
    headers: buildAuthHeaders(MEMBER_ID),
  });

  assert.equal(listRes.status, 200);
  const listBody = await listRes.json();
  assert.equal(listBody.messages[0].wrapped_key ?? null, null);
  assert.equal(listBody.messages[0].wrapped_key_alg ?? null, null);
  assert.equal(listBody.messages[0].wrapped_key_kid ?? null, null);
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
