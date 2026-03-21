import test from "node:test";
import assert from "node:assert/strict";

function createStorage() {
  const store = new Map();
  return {
    getItem(key) {
      return store.has(key) ? store.get(key) : null;
    },
    setItem(key, value) {
      store.set(key, String(value));
    },
    removeItem(key) {
      store.delete(key);
    },
    clear() {
      store.clear();
    },
  };
}

test("apiPaid は user_id クエリを送らない", async () => {
  globalThis.localStorage = createStorage();
  globalThis.location = {
    search: "",
    origin: "https://shadowwork-navigator.com",
  };
  globalThis.SHADOWNAV_API_BASE = "https://api.shadowwork-navigator.com";

  let capturedUrl = "";
  globalThis.fetch = async (url) => {
    capturedUrl = String(url);
    return {
      ok: true,
      async json() {
        return { ok: true, paid: true };
      },
    };
  };

  const mod = await import(`../pages/lib/client.js?test=${Date.now()}`);
  const paid = await mod.apiPaid();

  assert.equal(paid, true);
  assert.equal(capturedUrl, "https://api.shadowwork-navigator.com/api/paid");
});

test("ensureApiSessionCookie は Supabase session の access_token で auth/exchange を呼ぶ", async () => {
  globalThis.localStorage = createStorage();
  globalThis.location = {
    search: "",
    origin: "https://shadowwork-navigator.com",
  };
  globalThis.window = globalThis;
  globalThis.SHADOWNAV_API_BASE = "https://api-staging.shadowwork-navigator.com";
  globalThis.SHADOWNAV_SUPABASE_URL = "https://example.supabase.co";
  globalThis.SHADOWNAV_SUPABASE_PUBLISHABLE_KEY = "pk_test_dummy";
  globalThis.__SUPABASE_CLIENT__ = undefined;

  let called = 0;
  let capturedUrl = "";
  let capturedInit = null;

  globalThis.supabase = {
    createClient() {
      return {
        auth: {
          async getSession() {
            return {
              data: {
                session: {
                  access_token: "supabase-access-token",
                },
              },
            };
          },
        },
      };
    },
  };

  globalThis.fetch = async (url, init = {}) => {
    called += 1;
    capturedUrl = String(url);
    capturedInit = init;
    return {
      ok: true,
      async json() {
        return { ok: true };
      },
    };
  };

  const mod = await import(`../pages/lib/client.js?test=${Date.now()}`);
  const exchanged = await mod.ensureApiSessionCookie();

  assert.equal(exchanged, true);
  assert.equal(called, 1);
  assert.equal(capturedUrl, "https://api-staging.shadowwork-navigator.com/api/auth/exchange");
  assert.equal(capturedInit.method, "POST");
  assert.equal(capturedInit.credentials, "include");
  assert.equal(capturedInit.headers["Content-Type"], "application/json");
  assert.equal(capturedInit.body, JSON.stringify({ token: "supabase-access-token" }));
});

test("ensureApiSessionCookie は session token が無ければ auth/exchange を呼ばない", async () => {
  globalThis.localStorage = createStorage();
  globalThis.location = {
    search: "",
    origin: "https://shadowwork-navigator.com",
  };
  globalThis.window = globalThis;
  globalThis.SHADOWNAV_API_BASE = "https://api-staging.shadowwork-navigator.com";
  globalThis.SHADOWNAV_SUPABASE_URL = "https://example.supabase.co";
  globalThis.SHADOWNAV_SUPABASE_PUBLISHABLE_KEY = "pk_test_dummy";
  globalThis.__SUPABASE_CLIENT__ = undefined;

  let called = 0;

  globalThis.supabase = {
    createClient() {
      return {
        auth: {
          async getSession() {
            return {
              data: {
                session: null,
              },
            };
          },
        },
      };
    },
  };

  globalThis.fetch = async () => {
    called += 1;
    return {
      ok: true,
      async json() {
        return { ok: true };
      },
    };
  };

  const mod = await import(`../pages/lib/client.js?test=${Date.now()}`);
  const exchanged = await mod.ensureApiSessionCookie();

  assert.equal(exchanged, false);
  assert.equal(called, 0);
});
