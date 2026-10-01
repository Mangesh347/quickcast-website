// motion.js — QuickCast Material You motion helpers. Mirrored in extension/motion.js.
// Everything here uses the Web Animations API (independent of calm.css's CSS
// animation reset) and does nothing under prefers-reduced-motion.
(() => {
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
  const EMPH = "cubic-bezier(.2,0,0,1)";
  const DECEL = "cubic-bezier(.05,.7,.1,1)";

  // ── Ripple: soft M3 touch feedback (12% of the content color) ──────────
  const RIPPLE_HOSTS = [
    ".btn", ".source-opt", ".icon-btn", ".filter-tab", ".card-btn", ".nav-item",
    ".settings-nav-item", ".toggle-label", ".btn-perm-allow", ".qc-nav-link",
    ".upgrade-chip", ".faq-q", ".setup-skip",
  ].join(",");

  document.addEventListener("pointerdown", (e) => {
    if (reduce.matches || e.button > 0) return;
    const host = e.target.closest(RIPPLE_HOSTS);
    if (!host || host.disabled || !host.animate) return;
    const r = host.getBoundingClientRect();
    const size = Math.hypot(r.width, r.height) * 2;
    const cs = getComputedStyle(host);
    if (cs.position === "static") host.style.position = "relative";
    if (cs.overflow === "visible") host.style.overflow = "hidden";
    const s = document.createElement("span");
    s.setAttribute("aria-hidden", "true");
    s.style.cssText = `position:absolute;pointer-events:none;border-radius:50%;background:currentColor;opacity:.12;z-index:0;
      width:${size}px;height:${size}px;left:${e.clientX - r.left - size / 2}px;top:${e.clientY - r.top - size / 2}px;`;
    host.appendChild(s);
    const grow = s.animate([{ transform: "scale(0)" }, { transform: "scale(1)" }], { duration: 450, easing: DECEL, fill: "forwards" });
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      Promise.race([grow.finished, new Promise((z) => setTimeout(z, 160))]).then(() => {
        s.animate([{ opacity: 0.12 }, { opacity: 0 }], { duration: 250, easing: "linear", fill: "forwards" });
        setTimeout(() => s.remove(), 300);
      });
    };
    host.addEventListener("pointerup", release, { once: true });
    host.addEventListener("pointerleave", release, { once: true });
    setTimeout(release, 1500); // safety net if pointerup never arrives
  }, { passive: true });

  // ── Glide: one selection indicator that moves between items ────────────
  // qcGlide(container, activeItem) — positions container's .qm-indicator over the item.
  window.qcGlide = (container, item, instant = false) => {
    if (!container || !item) return;
    let ind = container.querySelector(":scope > .qm-indicator");
    if (!ind) {
      ind = document.createElement("span");
      ind.className = "qm-indicator";
      ind.setAttribute("aria-hidden", "true");
      container.prepend(ind);
      instant = true;
    }
    const c = container.getBoundingClientRect();
    const b = item.getBoundingClientRect();
    if (!b.width) return; // hidden (e.g. collapsed layout) — try again next time
    const x = b.left - c.left + container.scrollLeft;
    const y = b.top - c.top + container.scrollTop;
    // Inline !important beats calm.css's !important transition, for the first (instant) placement.
    if (instant || reduce.matches) ind.style.setProperty("transition", "none", "important");
    else ind.style.removeProperty("transition");
    ind.style.width = `${b.width}px`;
    ind.style.height = `${b.height}px`;
    ind.style.transform = `translate(${x}px, ${y}px)`;
  };

  // ── Container motion for list changes (sort, filter, delete) ──────────
  // qcTransition(update) runs `update` inside a View Transition when available.
  // kind "list": items glide to new spots and the page itself holds still (no fade-through).
  window.qcTransition = (update, kind = "screen") => {
    if (reduce.matches || !document.startViewTransition) { update(); return Promise.resolve(); }
    const root = document.documentElement;
    root.classList.toggle("qm-list", kind === "list");
    const vt = document.startViewTransition(update);
    vt.ready.catch(() => {}); // a newer transition can skip this one — that is fine
    return vt.finished.catch(() => {}).then(() => root.classList.remove("qm-list"));
  };

  // Kept as a no-op so older callers keep working.
  window.qcConfetti = () => {};
  window.qcMotion = { EMPH, DECEL, reduced: () => reduce.matches };
})();
