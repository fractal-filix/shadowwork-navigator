// /lib/client.js
const DEFAULT_API_BASE = "https://api.shadowwork-navigator.com";

export const API_BASE =
  (globalThis.SHADOWNAV_API_BASE || localStorage.getItem("SHADOWNAV_API_BASE") || DEFAULT_API_BASE).trim();
export const SUPABASE_URL =
  (globalThis.SHADOWNAV_SUPABASE_URL || localStorage.getItem("SHADOWNAV_SUPABASE_URL") || "").trim();
export const SUPABASE_PUBLISHABLE_KEY =
  (
    globalThis.SHADOWNAV_SUPABASE_PUBLISHABLE_KEY ||
    localStorage.getItem("SHADOWNAV_SUPABASE_PUBLISHABLE_KEY") ||
    ""
  ).trim();
export const DEBUG_UI = false; // true にすると dbg が console に出す

export function dbg(...args) {
  if (DEBUG_UI) console.log(...args);
}

export function dbgErr(...args) {
  if (DEBUG_UI) console.error(...args);
}

function normalizeSupabaseUrl(rawValue) {
  const value = (rawValue || "").trim();
  if (!value) return "";

  let normalized = value;
  if (/^https\/\//i.test(normalized)) {
    normalized = normalized.replace(/^https\/\//i, "https://");
  } else if (/^http\/\//i.test(normalized)) {
    normalized = normalized.replace(/^http\/\//i, "http://");
  } else if (!/^https?:\/\//i.test(normalized)) {
    normalized = `https://${normalized.replace(/^\/+/, "")}`;
  }

  const url = new URL(normalized);
  return url.origin;
}

export async function apiPaid() {
  const url = `${API_BASE}/api/paid`;
  dbg("[api] paid ->", url);

  const res = await fetch(url, { credentials: "include" });
  const data = await res.json().catch(() => ({}));

  dbg("[api] paid <-", data);
  if (!res.ok || data.ok === false) {
    throw new Error(data?.error || "paid check failed");
  }
  return !!data.paid;
}

export async function ensureApiSessionCookie() {
  const client = createSupabaseClient();
  if (!client) return false;

  const sessionResult = await client.auth.getSession();
  const accessToken = sessionResult?.data?.session?.access_token;
  const token = typeof accessToken === "string" ? accessToken.trim() : "";
  if (!token) return false;

  const url = `${API_BASE}/api/auth/exchange`;
  dbg("[api] auth/exchange ->", url);

  const res = await fetch(url, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token }),
  });
  const data = await res.json().catch(() => ({}));

  dbg("[api] auth/exchange <-", data);
  if (!res.ok || data.ok === false) {
    throw new Error(data?.error?.message || data?.error || "auth exchange failed");
  }
  return true;
}

export function createSupabaseClient() {
  try {
    if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) return null;
    const normalizedSupabaseUrl = normalizeSupabaseUrl(SUPABASE_URL);
    if ((window).__SUPABASE_CLIENT__) return (window).__SUPABASE_CLIENT__;
    if (window.supabase && typeof window.supabase.createClient === "function") {
      (window).__SUPABASE_CLIENT__ = window.supabase.createClient(normalizedSupabaseUrl, SUPABASE_PUBLISHABLE_KEY);
      return (window).__SUPABASE_CLIENT__;
    }
    return null;
  } catch (e) {
    dbgErr('[supabase] create client failed', e);
    return null;
  }
}

export async function getSupabaseUser() {
  const client = createSupabaseClient();
  if (!client) return null;
  try {
    const r = await client.auth.getUser();
    return r?.data?.user ?? null;
  } catch (e) {
    dbgErr('[supabase] getUser failed', e);
    return null;
  }
}

export function hasSupabaseConfig() {
  return Boolean(SUPABASE_URL && SUPABASE_PUBLISHABLE_KEY);
}

export async function signInWithPassword(email, password) {
  const client = createSupabaseClient();
  if (!client) {
    throw new Error("supabase config missing");
  }

  const { data, error } = await client.auth.signInWithPassword({
    email,
    password,
  });

  if (error) throw error;
  return data;
}

export async function signOutSupabase() {
  const client = createSupabaseClient();
  if (!client) return;

  const { error } = await client.auth.signOut();
  if (error) throw error;
}
