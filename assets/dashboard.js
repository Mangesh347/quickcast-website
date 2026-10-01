// dashboard.js — /dashboard: the signed-in user's recordings library.
(() => {
  const $ = (id) => document.getElementById(id);
  const esc = QC.esc;

  // ── Colorful geometric thumbnail generator ──────────────────────────────
  const PALETTES = [
    { bg:"#E1E0FF", c1:"#8083F2", c2:"#FFD9E1", c3:"#C0C1FF" },
    { bg:"#FFD9E1", c1:"#E0859D", c2:"#E1E0FF", c3:"#FFB1C4" },
    { bg:"#E2E0F9", c1:"#9C9AB8", c2:"#FFDF9E", c3:"#C6C4DD" },
    { bg:"#D8F0E2", c1:"#6FBF92", c2:"#E1E0FF", c3:"#A6F2C1" },
    { bg:"#FFE6D5", c1:"#F0A070", c2:"#E2E0F9", c3:"#FFCBA8" },
    { bg:"#DDE7FF", c1:"#6F92E6", c2:"#FFD9E1", c3:"#B5C8FF" },
    { bg:"#F4DAFF", c1:"#B879D8", c2:"#D8F0E2", c3:"#E6B5FF" },
    { bg:"#FFF1C9", c1:"#D6AE3A", c2:"#E1E0FF", c3:"#F5D57A" },
  ];
  const hashStr = (s) => [...s].reduce((a, c) => ((a * 31) + c.charCodeAt(0)) | 0, 0);
  function genThumb(id) {
    const h = Math.abs(hashStr(id || "default")), h2 = Math.abs(hashStr(id + "x")), h3 = Math.abs(hashStr(id + "y"));
    const p = PALETTES[h % PALETTES.length];
    const cx1 = 15 + (h % 45), cy1 = 10 + (h2 % 40), r1 = 28 + (h3 % 22);
    const cx2 = 55 + (h2 % 40), cy2 = 40 + (h % 45), rx3 = 50 + (h3 % 30), ry3 = 20 + (h % 30);
    return `<svg viewBox="0 0 300 180" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <rect width="300" height="180" fill="${p.bg}"/>
      <circle cx="${cx1}%" cy="${cy1}%" r="${r1}%" fill="${p.c1}" opacity=".45"/>
      <ellipse cx="${cx2}%" cy="${cy2}%" rx="${rx3 * 0.4}%" ry="${ry3 * 0.6}%" fill="${p.c2}" opacity=".55"/>
      <circle cx="${(cx1 + 35) % 95 + 5}%" cy="${(cy2 + 25) % 80 + 10}%" r="${r1 * 0.45}%" fill="${p.c3}" opacity=".35"/>
    </svg>`;
  }

  // ── Helpers ─────────────────────────────────────────────────────────────
  const shareUrlOf = (v) => (v.share_token ? `${QC.WEB_BASE}/v/${v.share_token}` : null);
  const formatDuration = (s) => (s ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}` : null);
  const formatDate = (iso) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  function formatBytes(n) {
    if (!n) return "0 MB";
    const mb = n / 1048576;
    return mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
  }
  function greetingText(name) {
    const h = new Date().getHours();
    const t = h < 12 ? "morning" : h < 17 ? "afternoon" : "evening";
    return name ? `Good ${t}, ${name.split(" ")[0]}` : `Good ${t}`;
  }
  const isThisMonth = (iso) => { const d = new Date(iso), n = new Date(); return d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth(); };

  const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
  // Stats count up once on first load (M3 emphasized-decelerate curve, 700 ms).
  let countedUp = false;
  // The newest value wins: a later update (e.g. the server's count) must never be
  // overwritten by an earlier count-up that is still finishing.
  function setNumber(el, value) {
    el.dataset.target = value;
    if (countedUp || reduceMotion || !value) { el.textContent = value; return; }
    const t0 = performance.now();
    const step = (t) => {
      if (el.dataset.target !== String(value)) return; // superseded
      const p = Math.min(1, (t - t0) / 700);
      el.textContent = Math.round(value * (1 - Math.pow(1 - p, 3)));
      if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
    // Frames pause in background tabs; make sure the latest number always lands.
    setTimeout(() => { el.textContent = el.dataset.target; }, 760);
  }

  let snackTimer;
  function snack(text, action) {
    const el = $("snackbar");
    el.replaceChildren(document.createTextNode(text));
    if (action) {
      const b = document.createElement("button");
      b.textContent = action.label;
      b.onclick = () => { el.classList.remove("show"); action.run(); };
      el.append(b);
    }
    el.classList.add("show");
    clearTimeout(snackTimer);
    snackTimer = setTimeout(() => { el.classList.remove("show"); action?.onTimeout?.(); }, action ? 6000 : 2400);
  }

  const ICON_LINK = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>`;

  // Unique, CSS-safe name per card so View Transitions can glide it to its new spot.
  const vtName = (id) => "qcv-" + String(id).replace(/[^a-zA-Z0-9_-]/g, "_");

  // Sort / filter / delete re-flow the grid with container motion (skipped for huge lists).
  function animateList(update) {
    if (allVideos.length > 60 || !window.qcTransition) return update();
    $("videos-grid").classList.add("settled"); // no entrance stagger on re-renders
    return window.qcTransition(update, "list");
  }
  function glideFilter() {
    window.qcGlide?.(document.querySelector(".filter-tabs"), document.querySelector(".filter-tab.active"));
  }
  addEventListener("resize", () => glideFilter());

  function renderCard(v, idx) {
    const shareUrl = shareUrlOf(v);
    const dur = formatDuration(v.duration_seconds);
    const title = esc(v.title || "Untitled Recording");
    const viewLink = esc(shareUrl || "#");
    return `
      <div class="video-card" style="view-transition-name:${vtName(v.id)}" data-id="${esc(v.id)}">
        <a class="card-thumb" href="${viewLink}" target="_blank" rel="noopener" title="${title}" aria-label="Play ${title}">
          ${v.thumb_path ? `<img src="/api/og?thumb=${esc(v.share_token)}" alt="" loading="lazy" />` : genThumb(v.id)}
          <div class="card-play-overlay"><div class="card-play-btn"><svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><polygon points="5 3 19 12 5 21 5 3"/></svg></div></div>
        </a>
        <div class="card-body">
          <div class="card-title-row">
            <div class="card-title">${title}</div>
            <button class="card-rename" data-act="rename" title="Rename" aria-label="Rename ${title}">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>
            </button>
          </div>
          <div class="card-meta">
            ${dur ? `<span>${dur}</span><span class="meta-dot">·</span>` : ""}
            <span>${formatDate(v.created_at)}</span>
            ${v.views ? `<span class="meta-dot">·</span><span>${v.views} view${v.views !== 1 ? "s" : ""}</span>` : ""}
          </div>
          <div class="card-actions">
            <button class="card-btn btn-copy-link" data-act="copy" ${shareUrl ? "" : "disabled"}>${ICON_LINK} Copy</button>
            <button class="card-btn" data-act="manage" aria-label="Manage ${title}: insights, trim, privacy, download">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/></svg>
              Manage
            </button>
            <a class="card-btn" href="${viewLink}" target="_blank" rel="noopener">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
              Open
            </a>
            <button class="card-btn danger" data-act="delete" title="Delete" aria-label="Delete ${title}">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/></svg>
              Delete
            </button>
          </div>
        </div>
      </div>`;
  }

  // ── State ───────────────────────────────────────────────────────────────
  let user = null;
  let plan = "free";
  let acct = null; // /api/account: server-side plan, limits and usage
  let allVideos = [];
  let currentFilter = "all";
  const byId = (id) => allVideos.find((v) => v.id === id);

  const SORTS = {
    new: (a, b) => new Date(b.created_at) - new Date(a.created_at),
    old: (a, b) => new Date(a.created_at) - new Date(b.created_at),
    views: (a, b) => (b.views || 0) - (a.views || 0),
    long: (a, b) => (b.duration_seconds || 0) - (a.duration_seconds || 0),
  };
  try { $("sort-select").value = localStorage.getItem("qc_sort") || "new"; } catch {}

  function applyFilter() {
    const query = $("search-input").value.toLowerCase().trim();
    let list = allVideos;
    if (currentFilter === "recent") {
      const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
      list = list.filter((v) => new Date(v.created_at).getTime() > cutoff);
    } else if (currentFilter === "shared") {
      list = list.filter((v) => v.share_token);
    }
    if (query) list = list.filter((v) => (v.title || "untitled recording").toLowerCase().includes(query));
    renderGrid([...list].sort(SORTS[$("sort-select").value] || SORTS.new));
  }

  function renderGrid(videos) {
    const grid = $("videos-grid");
    const empty = $("empty-state");
    if (videos.length === 0) {
      grid.classList.add("hidden");
      empty.classList.remove("hidden");
      const filtered = allVideos.length > 0;
      empty.querySelector("h3").textContent = filtered ? "No matches" : "No recordings yet";
      empty.querySelector("p").textContent = filtered
        ? "Nothing matches this search or filter. Try a different word, or switch to All."
        : "Use the QuickCast Chrome extension to record your screen and share instantly with a link.";
      empty.querySelector(".btn").classList.toggle("hidden", filtered);
    } else {
      empty.classList.add("hidden");
      grid.classList.remove("hidden");
      grid.innerHTML = videos.map(renderCard).join("");
    }
  }

  function renderStats() {
    const total = allVideos.length;
    const views = allVideos.reduce((s, v) => s + (v.views || 0), 0);
    // The server's count: recordings made this month (deleting doesn't lower it).
    const month = acct ? acct.usage.recordingsThisMonth : allVideos.filter((v) => isThisMonth(v.created_at)).length;
    const limit = acct ? acct.limits.recordingsPerMonth : QC.FREE_PER_MONTH;
    const bytes = allVideos.reduce((s, v) => s + (v.size_bytes || 0), 0);
    setNumber($("stat-total"), total);
    setNumber($("stat-views"), views);
    setNumber($("stat-month"), month);
    countedUp = true;
    $("stat-month-sub").textContent = plan !== "free" ? `Unlimited on ${acct?.planName || "Pro"}` : `${Math.max(0, limit - month)} of ${limit} free left`;
    const latest = [...allVideos].sort(SORTS.new)[0];
    $("stat-latest").textContent = latest ? latest.title || "Untitled" : "None yet";
    $("stat-latest-sub").textContent = latest ? `${formatDate(latest.created_at)} · ${formatBytes(bytes)} stored` : "";
    $("recording-count").textContent = total === 0 ? "No recordings yet"
      : `${total} recording${total !== 1 ? "s" : ""} · ${views} total view${views !== 1 ? "s" : ""}`;

    // Sidebar: both limits from the server — recordings this month and storage.
    const q = $("quota-mini");
    q.classList.remove("hidden");
    if (plan !== "free") {
      $("quota-mini-label").textContent = `${month} this month`;
      $("quota-mini-count").textContent = "Unlimited";
      $("quota-mini-fill").style.width = "100%";
    } else {
      const used = Math.min(month, limit);
      $("quota-mini-label").textContent = `${used} / ${limit} this month`;
      $("quota-mini-count").textContent = `${limit - used} left`;
      $("quota-mini-fill").style.width = Math.round((used / limit) * 100) + "%";
    }
    const storeUsed = acct ? acct.usage.storageBytes : bytes;
    const storeLimit = acct ? acct.limits.storageBytes : 1024 ** 3;
    const storePct = Math.min(100, Math.round((storeUsed / storeLimit) * 100));
    $("quota-store-label").textContent = `${formatBytes(storeUsed)} of ${formatBytes(storeLimit)}`;
    $("quota-store-count").textContent = storePct >= 100 ? "Full" : `${storePct}%`;
    $("quota-store-fill").style.width = storePct + "%";

    $("workspace-sub").textContent = total > 0
      ? `${total} recording${total !== 1 ? "s" : ""} saved — share any with a link.`
      : "Install the extension to start recording your screen.";
    const cta = $("workspace-cta");
    if (total > 0) {
      // Web pages can't open an extension popup, so say where it lives instead of a dead link.
      cta.textContent = "How to record";
      cta.href = "/#how-it-works";
    }
  }

  // ── Card actions (delegated) ────────────────────────────────────────────
  $("videos-grid").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-act]");
    if (!btn) return;
    const card = btn.closest(".video-card");
    const v = byId(card.dataset.id);
    if (!v) return;
    if (btn.dataset.act === "copy") copyLink(btn, shareUrlOf(v));
    if (btn.dataset.act === "delete") deleteVideo(card, v);
    if (btn.dataset.act === "rename") startRename(card, v);
    if (btn.dataset.act === "manage") window.qcManage?.open(v, { onSaved: () => {} });
  });

  async function copyLink(btn, url) {
    if (!url) return;
    await navigator.clipboard.writeText(url).catch(() => {});
    btn.classList.add("copied");
    btn.textContent = "Copied!";
    setTimeout(() => { btn.classList.remove("copied"); btn.innerHTML = `${ICON_LINK} Copy`; }, 2000);
  }

  async function setDeleted(id, deleted) {
    const r = await QC.supa(`rest/v1/videos?id=eq.${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({ deleted_at: deleted ? new Date().toISOString() : null }),
    }).catch(() => ({ ok: false }));
    // RLS silently matches zero rows for someone else's video; treat that as a failure too.
    return r.ok && Array.isArray(r.data) && r.data.length > 0;
  }

  // Delete hides the card right away with an Undo; nothing is lost on a mis-click.
  async function deleteVideo(card, v) {
    card.style.opacity = "0.4";
    card.style.pointerEvents = "none";
    if (!(await setDeleted(v.id, true))) {
      card.style.opacity = "";
      card.style.pointerEvents = "";
      return snack("Couldn't delete that recording. Try again.");
    }
    // Leave gracefully: fade + slight shrink, then the grid re-flows.
    if (!reduceMotion && card.animate) {
      card.animate([{ opacity: 0.4, transform: "none" }, { opacity: 0, transform: "scale(.96)" }],
        { duration: 200, easing: "cubic-bezier(.3,0,.8,.15)", fill: "forwards" });
      // Never let the exit animation hold up the delete (frames can be paused).
      await new Promise((r) => setTimeout(r, 200));
    }
    allVideos = allVideos.filter((x) => x.id !== v.id);
    renderStats();
    animateList(applyFilter);
    snack("Recording deleted", {
      label: "Undo",
      run: async () => {
        if (await setDeleted(v.id, false)) {
          allVideos.push(v);
          renderStats();
          animateList(applyFilter);
          snack("Recording restored");
        } else {
          snack("Couldn't restore it. Try again from support.");
        }
      },
    });
  }

  function startRename(card, v) {
    const row = card.querySelector(".card-title-row");
    const input = document.createElement("input");
    input.className = "title-input";
    input.value = v.title || "";
    input.maxLength = 120;
    input.setAttribute("aria-label", "Recording title");
    row.replaceChildren(input);
    input.focus();
    input.select();
    let done = false;
    const finish = async (save) => {
      if (done) return;
      done = true;
      const title = input.value.trim();
      if (save && title && title !== v.title) {
        const old = v.title;
        v.title = title;
        const r = await QC.supa(`rest/v1/videos?id=eq.${encodeURIComponent(v.id)}`, {
          method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ title }),
        }).catch(() => ({ ok: false }));
        if (r.ok) snack("Renamed");
        else { v.title = old; snack("Couldn't rename. Try again."); }
      }
      renderStats();
      applyFilter();
    };
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") finish(true);
      if (e.key === "Escape") finish(false);
    });
    input.addEventListener("blur", () => finish(true));
  }

  // ── Filters, sort, search, "/" shortcut ─────────────────────────────────
  document.querySelectorAll(".filter-tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      document.querySelectorAll(".filter-tab").forEach((t) => { t.classList.remove("active"); t.setAttribute("aria-pressed", "false"); });
      tab.classList.add("active");
      tab.setAttribute("aria-pressed", "true");
      currentFilter = tab.dataset.filter;
      glideFilter();
      animateList(applyFilter);
    });
  });
  $("search-input").addEventListener("input", applyFilter);
  $("sort-select").addEventListener("change", () => {
    try { localStorage.setItem("qc_sort", $("sort-select").value); } catch {}
    animateList(applyFilter);
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "/" && !/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName)) {
      e.preventDefault();
      $("search-input").focus();
    }
  });

  $("btn-signin").addEventListener("click", () => QC.signIn("/dashboard"));
  $("btn-retry").addEventListener("click", () => { $("load-error").classList.add("hidden"); load(); });

  function showSignedOut(expired) {
    $("main-content").classList.add("hidden");
    $("auth-wall").classList.remove("hidden");
    if (expired) {
      $("auth-title").textContent = "Your session ended";
      $("auth-sub").textContent = "Sign in again to see your recordings.";
    }
  }

  function renderUser() {
    $("greeting").textContent = greetingText(user.name);
    const wrap = $("user-avatar-wrap");
    if (user.picture) {
      const img = document.createElement("img");
      img.src = user.picture;
      img.alt = "";
      img.referrerPolicy = "no-referrer";
      wrap.replaceChildren(img);
    } else {
      $("user-initial").textContent = (user.name || "?")[0].toUpperCase();
    }
    $("user-name").textContent = user.name || user.email;
    $("user-plan-label").textContent = plan !== "free" ? (acct?.planName || "Pro") : "Free plan";
  }

  async function load() {
    const q = (cols) => QC.supa(`rest/v1/videos?user_id=eq.${user.id}&deleted_at=is.null&order=created_at.desc&select=${cols}`).catch(() => ({ ok: false }));
    const base = "id,title,duration_seconds,size_bytes,share_token,views,created_at";
    let r = await q(`${base},thumb_path`);
    if (!r.ok && r.status === 400) r = await q(base); // before database update 002
    $("skeleton-grid")?.remove();
    if (r.status === 401) return showSignedOut(true);
    if (!r.ok || !Array.isArray(r.data)) {
      $("videos-grid").classList.add("hidden");
      $("load-error").classList.remove("hidden");
      return;
    }
    allVideos = r.data;
    renderStats();
    applyFilter();
  }

  async function main() {
    await QC.ready;
    const session = await QC.session();
    user = session && QC.user();
    if (!user) return showSignedOut(false);
    $("main-content").classList.remove("hidden");
    renderUser();
    glideFilter();
    QC.account().then((a) => { acct = a; plan = a?.plan || "free"; renderUser(); if (allVideos.length || !$("skeleton-grid")) renderStats(); });
    await load();
  }
  main();
})();
