import test from "node:test";
import assert from "node:assert/strict";

import { createPurchasePageController } from "../pages/lib/purchase_page.js";

function createElements() {
  return {
    status: { className: "", textContent: "" },
    goCheckoutBtn: { disabled: false },
    checkPaidBtn: { disabled: true },
    toDashboardBtn: { disabled: true },
    memberBox: { innerHTML: "", textContent: "" },
    loginRow: { style: { display: "none" } },
  };
}

test("未ログイン時は購入操作を無効化する", async () => {
  const elements = createElements();

  const controller = createPurchasePageController({
    elements,
    deps: {
      getSupabaseUser: async () => null,
      apiPaid: async () => ({ ok: true, data: { paid: false } }),
      apiCreateCheckoutSession: async () => ({ ok: true, data: { url: "https://example.com" } }),
    },
    navigate: () => {},
  });

  await controller.boot();

  assert.equal(elements.goCheckoutBtn.disabled, true);
  assert.equal(elements.checkPaidBtn.disabled, true);
  assert.equal(elements.toDashboardBtn.disabled, true);
  assert.equal(elements.loginRow.style.display, "flex");
  assert.equal(elements.status.textContent, "status: not logged in");
});

test("ログイン済み時は購入操作を有効化する", async () => {
  const elements = createElements();

  const controller = createPurchasePageController({
    elements,
    deps: {
      getSupabaseUser: async () => ({ id: "user-123", email: "u@example.com" }),
      apiPaid: async () => ({ ok: true, data: { paid: false } }),
      apiCreateCheckoutSession: async () => ({ ok: true, data: { url: "https://example.com" } }),
    },
    navigate: () => {},
  });

  await controller.boot();

  assert.equal(elements.goCheckoutBtn.disabled, false);
  assert.equal(elements.checkPaidBtn.disabled, false);
  assert.equal(elements.toDashboardBtn.disabled, true);
  assert.equal(elements.loginRow.style.display, "none");
  assert.equal(elements.status.textContent, "status: 未払いです。決済を完了してください。");
});

test("支払い済みの場合は Dashboard へ遷移する", async () => {
  const elements = createElements();
  let movedTo = "";

  const controller = createPurchasePageController({
    elements,
    deps: {
      getSupabaseUser: async () => ({ id: "user-123", email: "u@example.com" }),
      apiPaid: async () => ({ ok: true, data: { paid: true } }),
      apiCreateCheckoutSession: async () => ({ ok: true, data: { url: "https://example.com" } }),
    },
    navigate: (url) => {
      movedTo = url;
    },
  });

  await controller.boot();

  assert.equal(elements.toDashboardBtn.disabled, false);
  assert.equal(elements.status.textContent, "status: 支払い済みです。Dashboardへ移動します。");
  assert.equal(movedTo, "/dashboard.html");
});

test("支払い確認で未払いのままなら Dashboard は無効のまま", async () => {
  const elements = createElements();

  const controller = createPurchasePageController({
    elements,
    deps: {
      getSupabaseUser: async () => ({ id: "user-123", email: "u@example.com" }),
      apiPaid: async () => ({ ok: true, data: { paid: false } }),
      apiCreateCheckoutSession: async () => ({ ok: true, data: { url: "https://example.com" } }),
    },
    navigate: () => {},
  });

  await controller.boot();
  await controller.handleCheckPaid();

  assert.equal(elements.toDashboardBtn.disabled, true);
  assert.equal(elements.status.textContent, "status: 未払いです。決済を完了してください。");
});