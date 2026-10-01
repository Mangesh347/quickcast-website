// auth.js — QuickCast website session + data helpers (dashboard, settings, landing).
// Google sign-in through Supabase (same provider the extension uses), token refresh,
// and recording preferences stored on the account so the extension picks them up.
(() => {
  const SUPABASE_URL = "https://kocnkdnnhgduynzpshvp.supabase.co";
  const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtvY25rZG5uaGdkdXluenBzaHZwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTA1Mjg5OTMsImV4cCI6MjEwNjEwNDk5M30.oDDqzz97ofsaysSn6u2IswuA3AWRovvNFoXlkUocqi0";
  const KEY = "qc_session";
  const NEXT_KEY = "qc_next";
  const FREE_PER_MONTH = 15; // fallback only; the real limit comes from /api/account (lib/plans.js)

  // Keep in sync with DEFAULT_PREFS in extension/background.js.
  const DEFAULT_PREFS = {
    resolution: "1080", fps: 30, countdown: false, autoCopy: true, openViewer: false,
    micDefault: true, noiseSuppression: true, tabAudio: true, bubbleSize: "medium", bubblePosition: "br",
  };

  const read = () => { try { return JSON.parse(localStorage.getItem(KEY)); } catch { return null; } };
  const write = (s) => { try { s ? localStorage.setItem(KEY, JSON.stringify(s)) : localStorage.removeItem(KEY); } catch {} };

  async function authFetch(path, opts = {}, token) {
    const r = await fetch(`${SUPABASE_URL}/${path}`, {
      ...opts,
      headers: {
        "Content-Type": "application/json",
        apikey: SUPABASE_ANON_KEY,
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(opts.headers || {}),
      },
    });
    const text = await r.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    return { ok: r.ok, status: r.status, data };
  }

  // Finish a Google sign-in: Supabase returns the tokens in the URL fragment.
  async function consumeRedirect() {
    if (!location.hash.includes("access_token=")) return false;
    const p = new URLSearchParams(location.hash.slice(1));
    history.replaceState(null, "", location.pathname + location.search);
    const access_token = p.get("access_token");
    const u = await authFetch("auth/v1/user", {}, access_token);
    if (!u.ok) return false;
    write({
      access_token,
      refresh_token: p.get("refresh_token"),
      expires_at: Date.now() + Number(p.get("expires_in") || 3600) * 1000,
      user: u.data,
    });
    return true;
  }

  // Returns a session with a valid access token, refreshing it when it's close to expiry.
  async function session() {
    const s = read();
    if (!s?.access_token) return null;
    if (s.expires_at && s.expires_at - 60_000 > Date.now()) return s;
    if (!s.refresh_token) { write(null); return null; }
    const r = await authFetch("auth/v1/token?grant_type=refresh_token", {
      method: "POST", body: JSON.stringify({ refresh_token: s.refresh_token }),
    }).catch(() => ({ ok: false }));
    if (!r.ok) {
      // Offline or a blip: keep the session and let the next call retry. Rejected: sign out.
      if (r.status === 400 || r.status === 401) { write(null); return null; }
      return s;
    }
    const next = {
      access_token: r.data.access_token,
      refresh_token: r.data.refresh_token,
      expires_at: Date.now() + (r.data.expires_in || 3600) * 1000,
      user: r.data.user || s.user,
    };
    write(next);
    return next;
  }

  // Supabase REST/Auth call as the signed-in user. 401 → session is gone.
  async function supa(path, opts = {}) {
    const s = await session();
    if (!s) return { ok: false, status: 401, data: null };
    const r = await authFetch(path, opts, s.access_token);
    if (r.status === 401) write(null);
    return r;
  }

  function user() {
    const s = read();
    if (!s?.user) return null;
    const m = s.user.user_metadata || {};
    return {
      id: s.user.id,
      email: s.user.email,
      name: m.display_name || m.full_name || m.name || s.user.email || "You",
      picture: m.avatar_url || m.picture || null,
      prefs: { ...DEFAULT_PREFS, ...(m.qc_prefs || {}) },
    };
  }

  // Plan, limits, usage and subscription from the server (same source the extension uses).
  async function account() {
    const s = await session();
    if (!s) return null;
    const r = await fetch("/api/account", { headers: { Authorization: `Bearer ${s.access_token}` } }).catch(() => null);
    if (!r || !r.ok) return null;
    return r.json();
  }

  // "pro" | "free" (kept for older callers).
  async function plan() {
    const a = await account();
    if (a) return a.plan;
    const u = user();
    if (!u) return "free";
    const r = await supa(`rest/v1/entitlements?user_id=eq.${u.id}&select=status&limit=1`);
    return Array.isArray(r.data) && r.data[0]?.status === "lifetime" ? "lifetime" : "free";
  }

  // Merge into user_metadata (display name, recording preferences).
  async function updateUser(data) {
    const r = await supa("auth/v1/user", { method: "PUT", body: JSON.stringify({ data }) });
    if (r.ok) { const s = read(); if (s) { s.user = r.data; write(s); } }
    return r;
  }

  function signIn(next = location.pathname) {
    try { sessionStorage.setItem(NEXT_KEY, next); } catch {}
    const redirect = `${location.origin}/dashboard`;
    location.href = `${SUPABASE_URL}/auth/v1/authorize?provider=google&redirect_to=${encodeURIComponent(redirect)}`;
  }

  function signOut() {
    const s = read();
    if (s?.access_token) authFetch("auth/v1/logout", { method: "POST" }, s.access_token).catch(() => {});
    write(null);
  }

  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  // Resolves once any sign-in redirect has been handled. Pages await this first.
  const ready = consumeRedirect().then((signedIn) => {
    let next = null;
    try { next = sessionStorage.getItem(NEXT_KEY); sessionStorage.removeItem(NEXT_KEY); } catch {}
    // Supabase falls back to its Site URL when /dashboard isn't allow-listed; route onward.
    if (signedIn && next && next !== location.pathname) { location.replace(next); return new Promise(() => {}); }
    if (signedIn && !location.pathname.startsWith("/dashboard")) { location.replace("/dashboard"); return new Promise(() => {}); }
  }).catch(() => {});

  window.QC = { ready, session, supa, user, plan, account, updateUser, signIn, signOut, esc, DEFAULT_PREFS, FREE_PER_MONTH, WEB_BASE: location.origin };
})();
