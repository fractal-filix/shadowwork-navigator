// /lib/client.js
export const API_BASE = "https://filix-shadowwork-api.xxxhideyoxxx.workers.dev";
export const DEBUG_UI = false; // true にすると dbg が console に出す

export function dbg(...args) {
  if (DEBUG_UI) console.log(...args);
}

export function dbgErr(...args) {
  if (DEBUG_UI) console.error(...args);
}

export function getUserId() {
  const qs = new URLSearchParams(location.search);
  const q = qs.get("user_id");
  if (q && q.trim()) {
    const v = q.trim();
    localStorage.setItem("user_id", v);
    return v;
  }
  const stored = localStorage.getItem("user_id");
  return stored && stored.trim() ? stored.trim() : "test";
}

export function setUserId(v) {
  const val = (v || "").trim();
  if (!val) return;
  localStorage.setItem("user_id", val);
}

export function qsUserIdUrl(path, userId) {
  const u = new URL(path, location.origin);
  u.searchParams.set("user_id", userId);
  return u.toString();
}

export async function apiPaid(userId) {
  const url = `${API_BASE}/api/paid?user_id=${encodeURIComponent(userId)}`;
  dbg("[api] paid ->", url);

  const res = await fetch(url);
  const data = await res.json().catch(() => ({}));

  dbg("[api] paid <-", data);
  if (!res.ok || data.ok === false) {
    throw new Error(data?.error || "paid check failed");
  }
  return !!data.paid;
}
