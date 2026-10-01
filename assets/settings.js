// settings.js — /dashboard/settings. Every control saves as soon as it changes:
// recording preferences go to the account (user_metadata.qc_prefs), where the
// extension reads them; theme stays on this device.
(() => {
  const $ = (id) => document.getElementById(id);
  const panels = $("settings-panels");

  // ── Snackbar ───────────────────────────────────────────────────────────
  let snackTimer;
  function snack(text, action) {
    const el = $("snackbar");
    el.textContent = "";
    el.append(document.createTextNode(text));
    if (action) {
      const b = document.createElement("button");
      b.textContent = action.label;
      b.onclick = () => { el.classList.remove("show"); action.run(); };
      el.append(b);
    }
    el.classList.add("show");
    clearTimeout(snackTimer);
    snackTimer = setTimeout(() => el.classList.remove("show"), action ? 6000 : 2400);
  }

  // ── Section nav (also reachable as /dashboard/settings#audio) ────────────
  function openPanel(name) {
    const btn = document.querySelector(`.settings-nav-item[data-panel="${name}"]`);
    if (!btn) return;
    document.querySelectorAll(".settings-nav-item").forEach((b) => { b.classList.remove("active"); b.setAttribute("aria-selected", "false"); });
    document.querySelectorAll(".settings-panel").forEach((p) => p.classList.remove("active"));
    btn.classList.add("active");
    btn.setAttribute("aria-selected", "true");
    $("panel-" + name).classList.add("active");
    window.qcGlide?.(document.querySelector(".settings-nav"), btn);
  }
  addEventListener("resize", () => window.qcGlide?.(document.querySelector(".settings-nav"), document.querySelector(".settings-nav-item.active"), true));
  document.querySelectorAll(".settings-nav-item").forEach((btn) => {
    btn.setAttribute("role", "tab");
    btn.addEventListener("click", () => {
      openPanel(btn.dataset.panel);
      history.replaceState(null, "", "#" + btn.dataset.panel);
    });
  });
  if (location.hash.length > 1) openPanel(location.hash.slice(1));
  else window.qcGlide?.(document.querySelector(".settings-nav"), document.querySelector(".settings-nav-item.active"), true);

  // ── Theme (this device only) ─────────────────────────────────────────────
  const themeSelect = $("theme-select");
  try { themeSelect.value = localStorage.getItem("qc_theme") || "system"; } catch {}
  themeSelect.addEventListener("change", () => {
    const v = themeSelect.value;
    try { v === "system" ? localStorage.removeItem("qc_theme") : localStorage.setItem("qc_theme", v); } catch {}
    if (v === "system") delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = v;
    const note = $("theme-saved");
    note.textContent = "Saved";
    note.classList.add("show");
    setTimeout(() => note.classList.remove("show"), 1600);
  });

  // Account deletion isn't self-serve yet — route to support instead of a dead button
  $("btn-delete-account").addEventListener("click", () => {
    if (confirm("To delete your account and all recordings, we'll open an email to support. Continue?")) {
      location.href = "mailto:team@quickcast.app?subject=Delete%20my%20QuickCast%20account";
    }
  });

  $("btn-signin").addEventListener("click", () => QC.signIn("/dashboard/settings"));
  $("btn-sign-out").addEventListener("click", () => { QC.signOut(); location.href = "/"; });

  // ── Account-synced preferences ───────────────────────────────────────────
  const controls = [...document.querySelectorAll("[data-pref]")];
  let prefs = { ...QC.DEFAULT_PREFS };

  function paintPrefs() {
    for (const el of controls) {
      const v = prefs[el.dataset.pref];
      if (el.type === "checkbox") el.checked = !!v;
      else el.value = String(v);
    }
  }

  let saveChain = Promise.resolve();
  function savePref(el) {
    const key = el.dataset.pref;
    const before = prefs[key];
    const value = el.type === "checkbox" ? el.checked : key === "fps" ? Number(el.value) : el.value;
    prefs = { ...prefs, [key]: value };
    // Serialize saves so quick toggling can't land out of order.
    saveChain = saveChain.then(async () => {
      const r = await QC.updateUser({ qc_prefs: prefs }).catch(() => ({ ok: false }));
      if (r.ok) return snack("Saved — the extension will use this next time you record");
      if (r.status === 401) return showSignedOut();
      prefs = { ...prefs, [key]: before };
      paintPrefs();
      snack("Couldn't save. Check your connection.", { label: "Retry", run: () => { el.type === "checkbox" ? (el.checked = value) : (el.value = String(value)); savePref(el); } });
    });
  }
  controls.forEach((el) => el.addEventListener("change", () => savePref(el)));

  // Display name
  const nameInput = $("display-name-input");
  const nameBtn = $("btn-save-name");
  let savedName = "";
  nameInput.addEventListener("input", () => { nameBtn.disabled = !nameInput.value.trim() || nameInput.value.trim() === savedName; });
  nameInput.addEventListener("keydown", (e) => { if (e.key === "Enter" && !nameBtn.disabled) nameBtn.click(); });
  nameBtn.addEventListener("click", async () => {
    const name = nameInput.value.trim();
    nameBtn.disabled = true;
    nameBtn.textContent = "Saving…";
    const r = await QC.updateUser({ display_name: name }).catch(() => ({ ok: false }));
    nameBtn.textContent = "Save";
    if (r.ok) {
      savedName = name;
      renderUser(QC.user());
      snack("Name saved");
    } else if (r.status === 401) {
      showSignedOut();
    } else {
      nameBtn.disabled = false;
      snack("Couldn't save your name. Try again.");
    }
  });

  // ── Render ───────────────────────────────────────────────────────────────
  function setAvatar(wrap, fallbackEl, user) {
    if (user.picture) {
      const img = document.createElement("img");
      img.src = user.picture;
      img.alt = "";
      img.referrerPolicy = "no-referrer";
      wrap.replaceChildren(img);
    } else {
      fallbackEl.textContent = (user.name || "?")[0].toUpperCase();
    }
  }

  function renderUser(user) {
    setAvatar($("user-avatar-wrap"), $("user-initial"), user);
    setAvatar($("account-avatar"), $("account-initial"), user);
    $("user-name").textContent = user.name || user.email;
    $("account-name").textContent = user.name || "—";
    $("account-email").textContent = user.email || "—";
  }

  function formatBytes(n) {
    if (!n) return "0 MB";
    const mb = n / 1048576;
    return mb >= 1024 ? `${(mb / 1024).toFixed(mb >= 10240 ? 0 : 1)} GB` : `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
  }
  const fmtDate = (iso) => new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });

  // Plan, renewal and usage — all from the server (/api/account).
  function renderAccount(a) {
    const pro = a.plan !== "free";
    const planName = a.planName || "Pro";
    const sub = a.subscription;
    $("user-plan-label").textContent = pro ? planName : "Free plan";
    const badge = $("plan-badge");
    badge.textContent = pro ? planName : "Free";
    badge.className = "plan-badge " + (pro ? "pro" : "free");
    $("billing-plan-name").textContent = pro ? planName : "Free";
    let desc = `${a.limits.recordingsPerMonth} recordings a month · ${a.limits.maxMinutes} min each · ${formatBytes(a.limits.storageBytes)} storage`;
    if (pro) {
      desc = `Unlimited recordings · ${a.limits.maxMinutes} min each · ${formatBytes(a.limits.storageBytes)} storage${a.limits.maxResolution === "2160" ? " · 4K" : ""}`;
      if (a.planSource === "lifetime") desc += " · lifetime access";
      else if (sub?.cancel_at_period_end && a.expiresAt) desc += ` · ends ${fmtDate(sub.current_period_end || a.expiresAt)}`;
      else if (sub?.current_period_end) desc += ` · renews ${fmtDate(sub.current_period_end)}`;
    }
    $("billing-plan-desc").textContent = desc;
    $("billing-cta").classList.toggle("hidden", pro);
    $("billing-cancel").classList.toggle("hidden", !(pro && sub?.status === "active" && !sub.cancel_at_period_end));

    const u = a.usage;
    $("storage-used").textContent = `${u.videoCount} recording${u.videoCount === 1 ? "" : "s"} · ${formatBytes(u.storageBytes)} of ${formatBytes(a.limits.storageBytes)}`;
    $("storage-pct").textContent = `${Math.min(100, Math.round((u.storageBytes / a.limits.storageBytes) * 100))}%`;
    const bar = $("quota-bar-fill");
    if (a.limits.recordingsPerMonth == null) {
      $("quota-desc").textContent = `${u.recordingsThisMonth} this month · unlimited`;
      bar.style.width = "100%";
      bar.parentElement.classList.remove("warn");
    } else {
      const lim = a.limits.recordingsPerMonth;
      const pct = Math.min(100, Math.round((u.recordingsThisMonth / lim) * 100));
      $("quota-desc").textContent = `${u.recordingsThisMonth} of ${lim} used · resets ${fmtDate(a.resetsAt)}. Deleting videos frees storage, not recordings.`;
      bar.style.width = pct + "%";
      bar.parentElement.classList.toggle("warn", pct >= 80);
    }
  }

  $("billing-cancel").addEventListener("click", async () => {
    if (!confirm("Cancel Pro? You keep Pro until the end of the period you've paid for, then move to Free. Your videos stay.")) return;
    const btn = $("billing-cancel");
    btn.disabled = true;
    btn.textContent = "Cancelling…";
    const s2 = await QC.session();
    const r = await fetch("/api/billing", { method: "POST", headers: { "Content-Type": "application/json", ...(s2 ? { Authorization: `Bearer ${s2.access_token}` } : {}) }, body: JSON.stringify({ action: "cancel" }) }).catch(() => null);
    const data = r ? await r.json().catch(() => ({})) : {};
    btn.disabled = false;
    btn.textContent = "Cancel subscription";
    if (!r?.ok) return snack(data.error || "Couldn't cancel. Try again or contact support.");
    renderAccount(data.account);
    snack(`Cancelled. You keep Pro until ${fmtDate(data.until || data.account.expiresAt)}.`);
  });

  function showSignedOut() {
    $("settings-layout").classList.add("hidden");
    $("signin-wall").classList.remove("hidden");
  }

  async function main() {
    await QC.ready;
    const s = await QC.session();
    const user = s && QC.user();
    if (!user) return showSignedOut();

    renderUser(user);
    savedName = user.name || "";
    nameInput.value = savedName;
    prefs = user.prefs;
    paintPrefs();
    panels.removeAttribute("aria-busy");

    const acct = await QC.account();
    if (acct) renderAccount(acct);
    else {
      $("storage-used").textContent = "Couldn't load usage right now.";
      $("quota-desc").textContent = "Couldn't load usage right now.";
    }
  }
  main();
})();
