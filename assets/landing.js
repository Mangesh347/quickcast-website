// landing.js — app bar lift, hero mock demo, scroll reveal (moved out of index.html for CSP).
// Top app bar: tonal lift once content scrolls under it
const topbar = document.getElementById("topbar");
const onScroll = () => topbar.classList.toggle("scrolled", window.scrollY > 8);
addEventListener("scroll", onScroll, { passive: true }); onScroll();

// Hero mock: the selector quietly steps Tab → Screen → Window to show the three modes
const seg = document.getElementById("mock-seg");
if (seg && !matchMedia("(prefers-reduced-motion: reduce)").matches) {
  const opts = [...seg.children];
  let i = 0;
  setInterval(() => {
    if (document.hidden) return;
    i = (i + 1) % opts.length;
    seg.style.setProperty("--qm-i", i);
    opts.forEach((o, n) => o.classList.toggle("on", n === i));
  }, 2600);
}

// Scroll reveal with gentle stagger
const io = "IntersectionObserver" in window && new IntersectionObserver((entries) => {
  entries.forEach((en) => {
    if (!en.isIntersecting) return;
    const sibs = [...en.target.parentElement.children].filter((c) => c.hasAttribute("data-reveal"));
    en.target.style.transitionDelay = Math.max(0, sibs.indexOf(en.target)) * 70 + "ms";
    en.target.classList.add("in");
    io.unobserve(en.target);
  });
}, { threshold: 0.12 });
document.querySelectorAll("[data-reveal]").forEach((el) => io ? io.observe(el) : el.classList.add("in"));
