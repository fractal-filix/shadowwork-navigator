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
