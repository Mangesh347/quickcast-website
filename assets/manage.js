// manage.js — the Dashboard's per-recording dialog: Insights, Trim, Privacy, Download.
// window.qcManage.open(video, { onSaved }) — video is a row from the videos table.
(() => {
  const $ = (id) => document.getElementById(id);
  const esc = QC.esc;
  const fmt = (s) => { s = Math.max(0, Math.floor(s || 0)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };
  const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const dlg = $("manage");
  let video = null;
  let meta = null; // from /api/video-meta (owner view: signed URL + settings)
  let onSaved = () => {};

  async function api(path, body) {
    const s = await QC.session();
    const r = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(s ? { Authorization: `Bearer ${s.access_token}` } : {}) },
      body: JSON.stringify(body),
    }).catch(() => null);
    if (!r) return { ok: false, data: { error: "You're offline. Check your connection." } };
    return { ok: r.ok, status: r.status, data: await r.json().catch(() => ({})) };
  }

  let snackTimer;
  function snack(text) {
    const el = $("snackbar");
    el.replaceChildren(document.createTextNode(text));
    el.classList.add("show");
    clearTimeout(snackTimer);
    snackTimer = setTimeout(() => el.classList.remove("show"), 2600);
  }

  // ── Tabs ─────────────────────────────────────────────────────────────
  function openTab(name) {
    dlg.querySelectorAll(".m-tab").forEach((t) => {
      const on = t.dataset.tab === name;
      t.classList.toggle("active", on);
      t.setAttribute("aria-selected", String(on));
      $(`m-${t.dataset.tab}`).hidden = !on;
    });
    window.qcGlide?.(dlg.querySelector(".m-tabs"), dlg.querySelector(".m-tab.active"));
    if (name === "trim") setupTrim();
  }
  dlg.querySelectorAll(".m-tab").forEach((t) => t.addEventListener("click", () => openTab(t.dataset.tab)));

  // ── Open / close (M3 dialog: fades in and settles from 92%) ──────────
  async function open(v, opts = {}) {
    video = v;
    meta = null;
    onSaved = opts.onSaved || (() => {});
    $("m-title").textContent = v.title || "Untitled Recording";
    $("m-sub").textContent = `${v.duration_seconds ? fmt(v.duration_seconds) + " · " : ""}${new Date(v.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`;
    $("m-insights-body").innerHTML = `<div class="m-loading"><div class="m3-loader"></div></div>`;
    dlg.showModal();
    if (!reduceMotion) dlg.animate([{ opacity: 0, transform: "scale(.92)" }, { opacity: 1, transform: "none" }], { duration: 300, easing: "cubic-bezier(.05,.7,.1,1)" });
    openTab(opts.tab || "insights");
    loadInsights();
    const r = await api("/api/video-meta", { token: v.share_token, noview: true });
    if (r.ok) { meta = r.data; fillPrivacy(); if (!$("m-trim").hidden) setupTrim(); }
    else snack(r.data?.error || "Couldn't load this recording.");
  }
  function close() {
    const v = $("m-video");
    v.pause();
    if (reduceMotion || !dlg.animate) return dlg.close();
    dlg.animate([{ opacity: 1 }, { opacity: 0, transform: "scale(.96)" }], { duration: 150, easing: "cubic-bezier(.3,0,.8,.15)" }).finished.then(() => dlg.close());
  }
  $("m-close").addEventListener("click", close);
  dlg.addEventListener("cancel", (e) => { e.preventDefault(); close(); });
  dlg.addEventListener("click", (e) => { if (e.target === dlg) close(); }); // scrim click

  // ── Insights ─────────────────────────────────────────────────────────
  async function loadInsights() {
    const r = await api("/api/engage", { action: "insights", token: video.share_token });
    const box = $("m-insights-body");
    if (!r.ok) {
      box.innerHTML = `<p class="m-note">${esc(r.data?.error || "Couldn't load insights.")}</p>`;
      return;
    }
    const d = r.data;
    const stat = (n, label) => `<div class="m-stat"><b>${n ?? "—"}</b><span>${label}</span></div>`;
    const rows = d.viewers.map((v) => `
      <li class="m-viewer">
        <span class="m-avatar" aria-hidden="true">${esc((v.name || "?")[0].toUpperCase())}</span>
        <div class="m-viewer-info"><b>${esc(v.name)}</b><span>${new Date(v.at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</span></div>
        <div class="m-watch" title="${v.percent ?? 0}% watched">
          <div class="m-watch-bar"><i style="width:${v.percent ?? 0}%"></i></div>
          <span>${v.percent != null ? v.percent + "%" : fmt(v.watched)}</span>
        </div>
      </li>`).join("");
    box.innerHTML = `
      <div class="m-stats">
        ${stat(d.totalViews, "Viewers")}
        ${stat(d.avgPercent != null ? d.avgPercent + "%" : "—", "Avg. watched")}
        ${stat(d.completed, "Watched to the end")}
        ${stat(d.reactions, "Reactions")}
        ${stat(d.comments, "Comments")}
      </div>
      ${d.proOnly
        ? `<div class="m-lock"><b>See who watched and how much</b><span>Viewer names and watch time are part of Pro.</span><a class="btn btn-primary btn-sm" href="/pricing/">Upgrade to Pro</a></div>`
        : d.viewers.length ? `<ol class="m-viewers">${rows}</ol>` : `<p class="m-note">No one has watched yet. Share the link and views will show up here, with how much each person watched.</p>`}
      <p class="m-fine">Viewers signed in to QuickCast show by name. Others appear as "Anonymous viewer" unless they left a comment.</p>`;
  }

  // ── Trim (non-destructive: viewers see only the chosen part) ─────────
  let trimReady = false;
  function setupTrim() {
    if (!meta) return;
    const v = $("m-video");
    if (!trimReady) {
      v.src = meta.videoUrl;
      trimReady = true;
    }
    v.onloadedmetadata = () => {
      const dur = isFinite(v.duration) ? v.duration : (meta.duration || video.duration_seconds || 0);
      for (const id of ["m-start", "m-end"]) { $(id).max = dur; $(id).step = 0.1; }
      $("m-start").value = meta.trimStart || 0;
      $("m-end").value = meta.trimEnd || dur;
      paintTrim();
    };
    v.onerror = () => v.onloadedmetadata(); // can't preview — still let them trim by the saved length
    if (v.readyState >= 1) v.onloadedmetadata();
  }
  function paintTrim() {
    const s = Number($("m-start").value), e = Number($("m-end").value), max = Number($("m-end").max) || 1;
    $("m-start-label").textContent = fmt(s);
    $("m-end-label").textContent = fmt(e);
    $("m-length").textContent = `Viewers will see ${fmt(Math.max(0, e - s))}`;
    const fill = $("m-range-fill");
    fill.style.left = `${(s / max) * 100}%`;
    fill.style.width = `${Math.max(0, (e - s) / max) * 100}%`;
  }
  $("m-start").addEventListener("input", () => {
    if (Number($("m-start").value) > Number($("m-end").value) - 1) $("m-start").value = Number($("m-end").value) - 1;
    $("m-video").currentTime = Number($("m-start").value);
    paintTrim();
  });
  $("m-end").addEventListener("input", () => {
    if (Number($("m-end").value) < Number($("m-start").value) + 1) $("m-end").value = Number($("m-start").value) + 1;
    $("m-video").currentTime = Number($("m-end").value);
    paintTrim();
  });
  $("m-set-start").addEventListener("click", () => { $("m-start").value = $("m-video").currentTime; $("m-start").dispatchEvent(new Event("input")); });
  $("m-set-end").addEventListener("click", () => { $("m-end").value = $("m-video").currentTime; $("m-end").dispatchEvent(new Event("input")); });
  $("m-preview").addEventListener("click", () => {
    const v = $("m-video");
    v.currentTime = Number($("m-start").value);
    v.play().catch(() => {});
    const stopAt = Number($("m-end").value);
    v.ontimeupdate = () => { if (v.currentTime >= stopAt) { v.pause(); v.ontimeupdate = null; } };
  });
  $("m-trim-reset").addEventListener("click", () => {
    $("m-start").value = 0;
    $("m-end").value = $("m-end").max;
    paintTrim();
  });
  $("m-trim-save").addEventListener("click", async () => {
    if (!meta) return snack("Still loading — try again in a second.");
    const s = Number($("m-start").value), e = Number($("m-end").value), max = Number($("m-end").max);
    const btn = $("m-trim-save");
    btn.disabled = true;
    const r = await api("/api/engage", { action: "settings", token: video.share_token, trimStart: s > 0.2 ? s : null, trimEnd: e < max - 0.2 ? e : null });
    btn.disabled = false;
    if (!r.ok) return snack(r.data?.error || "Couldn't save the trim.");
    meta.trimStart = s > 0.2 ? s : null;
    meta.trimEnd = e < max - 0.2 ? e : null;
    snack("Trim saved — viewers now see only this part");
    onSaved();
  });

  // ── Privacy ──────────────────────────────────────────────────────────
  // Password + expiry are Pro: lock those rows on Free (downloads stay available to everyone).
  let isPro = false;
  QC.account().then((a) => { isPro = !!a && a.plan !== "free"; lockPrivacy(); });
  function lockPrivacy() {
    for (const id of ["m-pass-on", "m-exp"]) $(id).disabled = !isPro;
    $("m-pro-note").hidden = isPro;
  }

  function fillPrivacy() {
    $("m-pass-on").checked = !!meta.hasPassword;
    $("m-pass").value = "";
    $("m-pass").placeholder = meta.hasPassword ? "Password is set — type to change it" : "Choose a password";
    $("m-pass-row").hidden = !meta.hasPassword;
    $("m-dl").checked = meta.allowDownloadSetting !== false;
    const exp = meta.expiresAt ? new Date(meta.expiresAt) : null;
    $("m-exp").value = exp ? "custom" : "never";
    $("m-exp-date").hidden = !exp;
    if (exp) $("m-exp-date").value = new Date(exp.getTime() - exp.getTimezoneOffset() * 60e3).toISOString().slice(0, 16);
    $("m-exp-note").textContent = exp ? (exp < new Date() ? "This link has expired." : `Link works until ${exp.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}.`) : "";
  }
  $("m-pass-on").addEventListener("change", () => { $("m-pass-row").hidden = !$("m-pass-on").checked; if ($("m-pass-on").checked) $("m-pass").focus(); });
  $("m-exp").addEventListener("change", () => {
    const v = $("m-exp").value;
    $("m-exp-date").hidden = v !== "custom";
    if (v === "custom" && !$("m-exp-date").value) {
      const d = new Date(Date.now() + 7 * 864e5);
      $("m-exp-date").value = new Date(d.getTime() - d.getTimezoneOffset() * 60e3).toISOString().slice(0, 16);
    }
  });
  $("m-privacy-save").addEventListener("click", async () => {
    if (!meta) return snack("Still loading — try again in a second.");
    const body = { action: "settings", token: video.share_token, allowDownload: $("m-dl").checked };
    if (!$("m-pass-on").checked) body.password = null;
    else if ($("m-pass").value) body.password = $("m-pass").value;
    else if (!meta.hasPassword) return snack("Type a password, or turn password protection off.");
    const exp = $("m-exp").value;
    body.expiresAt = exp === "never" ? null
      : exp === "custom" ? ($("m-exp-date").value ? new Date($("m-exp-date").value).toISOString() : null)
      : new Date(Date.now() + Number(exp) * 864e5).toISOString();
    const btn = $("m-privacy-save");
    btn.disabled = true;
    const r = await api("/api/engage", body);
    btn.disabled = false;
    if (!r.ok) return snack(r.data?.error || "Couldn't save privacy settings.");
    meta.hasPassword = body.password === null ? false : (body.password ? true : meta.hasPassword);
    meta.allowDownloadSetting = body.allowDownload;
    meta.expiresAt = body.expiresAt;
    fillPrivacy();
    snack("Privacy saved");
    onSaved();
  });

  // ── Download (owner: always allowed) ─────────────────────────────────
  $("m-download").addEventListener("click", async () => {
    if (!meta) return snack("Still loading — try again in a second.");
    const label = $("m-download-label");
    $("m-download").disabled = true;
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
        label.textContent = total ? `${Math.round((got / total) * 100)}%` : `${(got / 1048576).toFixed(1)} MB`;
      }
      const ext = (meta.mimeType || "").includes("mp4") ? "mp4" : "webm";
      const name = `${(video.title || "QuickCast recording").replace(/[\\/:*?"<>|]+/g, " ").trim().slice(0, 80) || "QuickCast recording"}.${ext}`;
      const url = URL.createObjectURL(new Blob(parts, { type: meta.mimeType || "video/webm" }));
      const a = Object.assign(document.createElement("a"), { href: url, download: name });
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      snack("Downloaded");
    } catch {
      snack("Couldn't download. Try again.");
    } finally {
      label.textContent = "Download";
      $("m-download").disabled = false;
    }
  });

  window.qcManage = { open };
})();
