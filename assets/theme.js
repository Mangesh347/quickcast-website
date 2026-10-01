// theme.js — applies the saved light/dark choice before the page paints (loaded in <head>).
try {
  var t = localStorage.getItem("qc_theme");
  if (t === "light" || t === "dark") document.documentElement.dataset.theme = t;
} catch (e) {}
document.documentElement.classList.add("js");
