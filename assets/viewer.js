// viewer.js — /v/:token. Playback (trim, speed, download), password-protected and
// expiring links, emoji reactions, timestamped comments and view insights.
(() => {
  const $ = (id) => document.getElementById(id);
  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const fmt = (s) => { s = Math.max(0, Math.floor(s || 0)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };
  const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const store = { get: (k) => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch {} } };

  // /v/<token> normally; /v/?t=<token> when the link-preview function hands off to the static player.
  const lastSeg = decodeURIComponent(location.pathname.split("/").filter(Boolean).pop() || "");
  const token = new URLSearchParams(location.search).get("t") || (lastSeg && lastSeg !== "v" && lastSeg !== "index.html" ? lastSeg : "");
  const shareUrl = `${location.origin}/v/${encodeURIComponent(token)}`;
  const player = $("player");
  let meta = null;
  let password = null;
  let authHeader = {};
  let signedIn = false;

  const sessionId = (() => {
    const k = `qc_vs_${token}`;
    let id = null;
    try { id = sessionStorage.getItem(k); } catch {}
    if (!id) { id = (crypto.randomUUID?.() || String(Math.random()).slice(2)); try { sessionStorage.setItem(k, id); } catch {} }
    return id;
  })();

  let snackTimer;
  function snack(text) {
    const el = $("snackbar");
    el.textContent = text;
    el.classList.add("show");
    clearTimeout(snackTimer);
    snackTimer = setTimeout(() => el.classList.remove("show"), 2600);
  }

  function show(which) {
    for (const id of ["error-wrap", "lock-wrap", "content"]) $(id).classList.toggle("hidden", id !== which);
  }
  function showError(title, text) {
    $("error-wrap").querySelector("h2").textContent = title;
    $("error-wrap").querySelector("p").textContent = text;
    show("error-wrap");
  }

  const engage = (action, data = {}) => fetch("/api/engage", {
    method: "POST",
    keepalive: action === "view",
    headers: { "Content-Type": "application/json", ...authHeader },
    body: JSON.stringify({ action, token, password, ...data }),
  }).then(async (r) => ({ ok: r.ok, status: r.status, data: await r.json().catch(() => ({})) }));

  // ── Load (with password when locked) ─────────────────────────────────
  async function load() {
    const res = await fetch("/api/video-meta", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeader },
      body: JSON.stringify({ token, password }),
    }).catch(() => null);
    if (!res) return showError("Couldn't load this video", "Check your connection and refresh the page.");
    const data = await res.json().catch(() => ({}));

    if (res.status === 401 || res.status === 403 || res.status === 429) {
      show("lock-wrap");
      $("lock-err").textContent = res.status === 429 ? data.error : res.status === 403 ? "That password isn't right. Try again." : "";
      $("lock-btn").disabled = false;
      $("lock-btn").textContent = "Watch video";
      $("lock-pass").focus();
      return;
    }
    if (res.status === 410) return showError("This link has expired", "Ask the sender for a new link.");
    if (!res.ok) return showError("Video not found", "This link may have expired or been deleted.");

    meta = data;
    render();
  }

  $("lock-form").addEventListener("submit", (e) => {
    e.preventDefault();
    password = $("lock-pass").value;
    $("lock-btn").disabled = true;
    $("lock-btn").textContent = "Checking…";
    load();
  });

  // ── Render ───────────────────────────────────────────────────────────
  const trimStart = () => meta?.trimStart || 0;
  const trimEnd = () => meta?.trimEnd || null;

  function render() {
    document.title = `${meta.title} — QuickCast`;
    $("video-title").textContent = meta.title;
    $("video-date").textContent = new Date(meta.createdAt).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
    const full = meta.duration || 0;
    const shown = (trimEnd() || full) - trimStart();
    if (shown > 0) { $("video-duration").textContent = fmt(shown); $("video-duration").classList.remove("hidden"); }
    if (meta.views != null) {
      $("video-views").textContent = `${meta.views} view${meta.views !== 1 ? "s" : ""}`;
      $("video-views").classList.remove("hidden");
    }
    $("owner-bar").classList.toggle("hidden", !meta.isOwner);
    $("share-input").value = shareUrl;
    $("btn-download").classList.toggle("hidden", !meta.allowDownload);
    if (!meta.allowDownload) player.setAttribute("controlsList", "nodownload");
    if (meta.thumbUrl) player.poster = meta.thumbUrl;

    player.src = meta.videoUrl;
    player.addEventListener("canplay", () => $("loading-overlay").classList.add("hidden"), { once: true });
    player.addEventListener("error", () => {
      $("loading-overlay").innerHTML = '<p style="color:#FFB4AB;font-size:15px;padding:20px;text-align:center">Couldn\'t play this video. Refresh the page, or ask the sender for a new link.</p>';
    });
    show("content");
    setupSpeed();
    loadEngagement();
  }

  // ── Trim: play only the chosen part ──────────────────────────────────
  player.addEventListener("loadedmetadata", () => { if (trimStart()) player.currentTime = trimStart(); });
  player.addEventListener("timeupdate", () => {
    const end = trimEnd();
    if (end && player.currentTime >= end) { player.pause(); player.currentTime = end; }
    if (trimStart() && player.currentTime < trimStart() - 0.3) player.currentTime = trimStart();
    $("c-time").textContent = fmt(player.currentTime - trimStart());
  });
  player.addEventListener("play", () => {
    const end = trimEnd();
    if (end && player.currentTime >= end - 0.2) player.currentTime = trimStart();
  });

  // ── Playback speed ───────────────────────────────────────────────────
  const SPEEDS = [0.75, 1, 1.25, 1.5, 1.75, 2];
  function setupSpeed() {
    const menu = $("speed-menu");
    const btn = $("btn-speed");
    const apply = (v) => {
      player.playbackRate = v;
      btn.textContent = `${v}×`;
      menu.querySelectorAll("button").forEach((b) => b.setAttribute("aria-checked", String(Number(b.dataset.v) === v)));
      store.set("qc_speed", String(v));
    };
    menu.innerHTML = SPEEDS.map((v) => `<button role="menuitemradio" data-v="${v}" aria-checked="false">${v}×</button>`).join("");
    const saved = Number(store.get("qc_speed"));
    apply(SPEEDS.includes(saved) ? saved : 1);
    player.addEventListener("loadedmetadata", () => { player.playbackRate = Number(store.get("qc_speed")) || 1; });
    const close = () => { menu.classList.add("hidden"); btn.setAttribute("aria-expanded", "false"); };
    btn.addEventListener("click", () => {
      const open = menu.classList.toggle("hidden") === false;
      btn.setAttribute("aria-expanded", String(open));
      if (open) {
        menu.querySelector('[aria-checked="true"]')?.focus();
        if (!reduceMotion) menu.animate([{ opacity: 0, transform: "translateY(6px) scale(.96)" }, { opacity: 1, transform: "none" }], { duration: 200, easing: "cubic-bezier(.05,.7,.1,1)" });
      }
    });
    menu.addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) { apply(Number(b.dataset.v)); close(); btn.focus(); } });
    menu.addEventListener("keydown", (e) => {
      const items = [...menu.querySelectorAll("button")];
      const i = items.indexOf(document.activeElement);
      if (e.key === "ArrowDown") { e.preventDefault(); items[(i + 1) % items.length].focus(); }
      if (e.key === "ArrowUp") { e.preventDefault(); items[(i - 1 + items.length) % items.length].focus(); }
      if (e.key === "Escape") { close(); btn.focus(); }
    });
    document.addEventListener("click", (e) => { if (!e.target.closest(".speed-wrap")) close(); });
  }

  // ── Download (with progress) ─────────────────────────────────────────
  $("btn-download").addEventListener("click", async () => {
    const btn = $("btn-download");
    const label = $("download-label");
    btn.disabled = true;
    try {
      const res = await fetch(meta.videoUrl);
      if (!res.ok || !res.body) throw new Error();
      const total = Number(res.headers.get("content-length")) || 0;
      const reader = res.body.getReader();
      const parts = [];
      let got = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        parts.push(value);
        got += value.length;
        label.textContent = total ? `Downloading ${Math.round((got / total) * 100)}%` : `Downloading ${(got / 1048576).toFixed(1)} MB`;
      }
      const ext = (meta.mimeType || "").includes("mp4") ? "mp4" : "webm";
      const name = `${(meta.title || "QuickCast recording").replace(/[\\/:*?"<>|]+/g, " ").trim().slice(0, 80) || "QuickCast recording"}.${ext}`;
      const url = URL.createObjectURL(new Blob(parts, { type: meta.mimeType || "video/webm" }));
      const a = Object.assign(document.createElement("a"), { href: url, download: name });
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      snack("Downloaded");
    } catch {
      snack("Couldn't download. Refresh the page and try again.");
    } finally {
      label.textContent = "Download";
      btn.disabled = false;
    }
  });

  // ── Reactions + comments ─────────────────────────────────────────────
  const counts = {};
  let mineSet = new Set();
  async function loadEngagement() {
    const r = await engage("list").catch(() => null);
    if (!r?.ok) return; // not set up yet (migration 002) — the page still plays fine
    Object.assign(counts, r.data.reactions || {});
    mineSet = new Set(r.data.mine || []);
    renderReactions(r.data.emoji || []);
    renderComments(r.data.comments || []);
    $("comments").classList.remove("hidden");
  }

  function renderReactions(emoji) {
    const box = $("reactions");
    box.innerHTML = emoji.map((e) => `<button class="react-btn${mineSet.has(e) ? " mine" : ""}" data-e="${e}" aria-pressed="${mineSet.has(e)}" aria-label="React ${e}"><span class="e">${e}</span><span class="n">${counts[e] || ""}</span></button>`).join("");
    box.classList.remove("hidden");
    box.addEventListener("click", async (ev) => {
      const b = ev.target.closest(".react-btn");
      if (!b) return;
      const e = b.dataset.e;
      if (b.disabled) return;
      b.disabled = true;
      // Toggle: one of each emoji per viewer; tap again to take it back.
      const adding = !mineSet.has(e);
      const paint = (on) => {
        counts[e] = Math.max(0, (counts[e] || 0) + (on ? 1 : -1));
        b.querySelector(".n").textContent = counts[e] || "";
        b.classList.toggle("mine", on === adding ? adding : !adding);
        b.setAttribute("aria-pressed", String(mineSet.has(e)));
      };
      if (adding) { mineSet.add(e); floatEmoji(b, e); } else mineSet.delete(e);
      paint(adding);
      const res = await engage("react", { emoji: e, t: Math.max(0, player.currentTime - trimStart()), sessionId }).catch(() => null);
      if (!res?.ok) {
        if (adding) mineSet.delete(e); else mineSet.add(e);
        paint(!adding);
        snack(res?.data?.error || "Couldn't send that reaction.");
      }
      b.disabled = false;
    });
  }

  // The emoji rises from the button and fades — a small, one-shot celebration.
  function floatEmoji(btn, e) {
    if (reduceMotion) return;
    const r = btn.getBoundingClientRect();
    const el = Object.assign(document.createElement("span"), { className: "react-float", textContent: e });
    el.style.left = `${r.left + r.width / 2 - 14}px`;
    el.style.top = `${r.top - 8}px`;
    document.body.append(el);
    const drift = (Math.random() - 0.5) * 40;
    el.animate([
      { transform: "translate(0, 0) scale(.6)", opacity: 0 },
      { transform: `translate(${drift * 0.3}px, -24px) scale(1.1)`, opacity: 1, offset: 0.25 },
      { transform: `translate(${drift}px, -90px) scale(.9)`, opacity: 0 },
    ], { duration: 1100, easing: "cubic-bezier(.05,.7,.1,1)" }).finished.finally(() => el.remove());
  }

  function commentHtml(c) {
    const initial = esc((c.name || "?").trim()[0]?.toUpperCase() || "?");
    const when = new Date(c.createdAt);
    return `<li class="c-item">
      <span class="c-avatar" aria-hidden="true">${initial}</span>
      <div>
        <div class="c-head"><b>${esc(c.name)}</b>${c.t != null ? `<button class="c-jump" data-t="${Number(c.t)}" aria-label="Jump to ${fmt(c.t)}">${fmt(c.t)}</button>` : ""}<time datetime="${esc(c.createdAt)}">${when.toLocaleDateString("en-US", { month: "short", day: "numeric" })}</time></div>
        <div class="c-text">${esc(c.body)}</div>
      </div>
    </li>`;
  }

  let commentTotal = 0;
  function renderComments(list) {
    commentTotal = list.length;
    $("c-list").innerHTML = list.map(commentHtml).join("");
    updateCommentCount();
  }
  function updateCommentCount() {
    $("c-count").textContent = commentTotal ? `· ${commentTotal}` : "";
    $("c-empty").classList.toggle("hidden", commentTotal > 0);
  }

  $("c-list").addEventListener("click", (e) => {
    const b = e.target.closest(".c-jump");
    if (!b) return;
    player.currentTime = trimStart() + Number(b.dataset.t);
    player.play().catch(() => {});
    player.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "center" });
  });

  $("c-name").value = store.get("qc_viewer_name") || "";
  $("c-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const body = $("c-body").value.trim();
    if (!body) return;
    const name = $("c-name").value.trim();
    if (name) store.set("qc_viewer_name", name);
    $("c-send").disabled = true;
    $("c-err").textContent = "";
    const r = await engage("comment", { body, name, t: $("c-at").checked ? Math.max(0, player.currentTime - trimStart()) : null }).catch(() => null);
    $("c-send").disabled = false;
    if (!r?.ok) { $("c-err").textContent = r?.data?.error || "Couldn't post that. Try again."; return; }
    $("c-body").value = "";
    $("c-list").insertAdjacentHTML("beforeend", commentHtml(r.data.comment));
    commentTotal += 1;
    updateCommentCount();
    const li = $("c-list").lastElementChild;
    if (!reduceMotion) li.animate([{ opacity: 0, transform: "translateY(8px)" }, { opacity: 1, transform: "none" }], { duration: 320, easing: "cubic-bezier(.05,.7,.1,1)" });
  });

  // ── View insights: how much of the video this session watched ────────
  let watched = 0;
  let lastT = null;
  let sentOnce = false;
  player.addEventListener("timeupdate", () => {
    if (!player.paused && lastT != null) {
      const d = player.currentTime - lastT;
      if (d > 0 && d < 2) watched += d;
    }
    lastT = player.currentTime;
  });
  player.addEventListener("seeking", () => { lastT = null; });
  const sendView = () => {
    if (!meta || meta.isOwner || (!sentOnce && watched < 1)) return;
    sentOnce = true;
    const len = (trimEnd() || meta.duration || player.duration || 0) - trimStart();
    engage("view", { sessionId, watched: Math.min(watched, len || watched), duration: len || null, name: store.get("qc_viewer_name") || undefined }).catch(() => {});
  };
  player.addEventListener("play", () => { if (!sentOnce) setTimeout(sendView, 1500); });
  setInterval(() => { if (!player.paused) sendView(); }, 15_000);
  addEventListener("pagehide", sendView);
  document.addEventListener("visibilitychange", () => { if (document.hidden) sendView(); });

  // ── Copy link ────────────────────────────────────────────────────────
  $("btn-copy").addEventListener("click", async () => {
    await navigator.clipboard.writeText(shareUrl).catch(() => {});
    const btn = $("btn-copy");
    const html = btn.innerHTML;
    btn.textContent = "Copied!";
    btn.classList.add("copied");
    setTimeout(() => { btn.innerHTML = html; btn.classList.remove("copied"); }, 2000);
  });

  // ── Start ────────────────────────────────────────────────────────────
  (async () => {
    if (!token) return showError("Video not found", "This link may have expired or been deleted.");
    try {
      await window.QC?.ready;
      const s = await window.QC?.session();
      if (s?.access_token) {
        authHeader = { Authorization: `Bearer ${s.access_token}` };
        signedIn = true;
        $("c-name").classList.add("hidden"); // comments use the account name
      }
    } catch {}
    load();
  })();
})();
