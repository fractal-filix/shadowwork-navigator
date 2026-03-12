export function createPurchasePageController({ elements, deps, navigate }) {
  const {
    status,
    goCheckoutBtn,
    checkPaidBtn,
    toDashboardBtn,
    memberBox,
    loginRow,
  } = elements;

  const moveTo = navigate || ((url) => {
    window.location.href = url;
  });

  function setStatus(text, kind) {
    status.className = kind === "ok" ? "ok" : kind === "ng" ? "ng" : "muted";
    status.textContent = text;
  }

  function showLoggedOutUI() {
    memberBox.innerHTML = "未ログインです。<br>下の「ログイン」からログインしてください。";
    loginRow.style.display = "flex";
    goCheckoutBtn.disabled = true;
    checkPaidBtn.disabled = true;
    toDashboardBtn.disabled = true;
  }

  async function boot() {
    setStatus("status: checking login...", "muted");
    goCheckoutBtn.disabled = true;

    const member = await deps.getSupabaseUser();
    if (!member) {
      setStatus("status: not logged in", "ng");
      showLoggedOutUI();
      return;
    }

    const memberId = (member.id || member["id"] || "").trim();
    if (!memberId) {
      setStatus("status: member id not found", "ng");
      memberBox.textContent = "ログイン情報は取得できましたが、member.id が取得できませんでした。";
      goCheckoutBtn.disabled = true;
      checkPaidBtn.disabled = true;
      toDashboardBtn.disabled = true;
      return;
    }

    memberBox.innerHTML = `ログイン済み：<code>${memberId}</code>`;
    loginRow.style.display = "none";
    goCheckoutBtn.disabled = false;
    checkPaidBtn.disabled = false;
    toDashboardBtn.disabled = false;

    setStatus("status: checking paid...", "muted");
    const paidResult = await deps.apiPaid();
    if (!paidResult.ok) {
      setStatus(`status: paid check failed: ${JSON.stringify(paidResult.data)}`, "ng");
      return;
    }
    if (paidResult.data?.paid === true) {
      setStatus("status: 支払い済みです。Dashboardへ移動します。", "ok");
      moveTo("/dashboard.html");
      return;
    }

    setStatus("status: 未払いです。決済を完了してください。", "ng");
  }

  async function handleGoCheckout() {
    if (goCheckoutBtn.disabled) return;

    setStatus("status: checkout session を作成中...", "muted");
    const checkoutResult = await deps.apiCreateCheckoutSession();
    if (!checkoutResult.ok || !checkoutResult.data?.url) {
      setStatus(`status: checkout session failed: ${JSON.stringify(checkoutResult.data)}`, "ng");
      return;
    }

    moveTo(checkoutResult.data.url);
  }

  async function handleCheckPaid() {
    checkPaidBtn.disabled = true;
    try {
      const paidResult = await deps.apiPaid();
      if (!paidResult.ok) {
        setStatus(`status: paid check failed: ${JSON.stringify(paidResult.data)}`, "ng");
        return;
      }
      if (paidResult.data?.paid === true) {
        setStatus("status: 支払い確認OK。Dashboardへ移動します。", "ok");
        moveTo("/dashboard.html");
      } else {
        setStatus("status: 未払いです。決済を完了してください。", "ng");
      }
    } finally {
      checkPaidBtn.disabled = false;
    }
  }

  function handleToDashboard() {
    moveTo("/dashboard.html");
  }

  return {
    boot,
    handleGoCheckout,
    handleCheckPaid,
    handleToDashboard,
  };
}