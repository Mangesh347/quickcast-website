// pricing.js — /pricing: region (INR via Razorpay / USD via PayPal), monthly/yearly,
// and checkout. The browser never decides a price: it asks /api/billing to start a
// checkout for a plan, and the server verifies the payment before upgrading.
(() => {
  const $ = (id) => document.getElementById(id);
  const store = { get: (k) => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch {} } };

  // Fallback copy of lib/plans.js prices, used until /api/account?catalog=1 answers.
  let catalog = {
    prices: {
      global: { region: "global", provider: "paypal", currency: "USD", month: { amount: 800, label: "$8" }, year: { amount: 7200, label: "$72", perMonth: "$6" } },
      india: { region: "india", provider: "razorpay", currency: "INR", month: { amount: 96000, label: "₹960" }, year: { amount: 864000, label: "₹8,640", perMonth: "₹720" } },
    },
    studio: {
      global: { month: { amount: 1400, label: "$14" }, year: { amount: 13200, label: "$132", perMonth: "$11" } },
      india: { month: { amount: 168000, label: "₹1,680" }, year: { amount: 1584000, label: "₹15,840", perMonth: "₹1,320" } },
    },
  };
  const STUDIO_FALLBACK = catalog.studio;
  // A region the visitor picked themselves wins; otherwise use the server's suggestion.
  const pickedRegion = store.get("qc_region");
  let region = pickedRegion || "global";
  let interval = "year";
  let chosenPlan = "pro";
  const priceFor = (plan) => (plan === "studio" ? (catalog.studio || STUDIO_FALLBACK) : catalog.prices)[region] || (plan === "studio" ? STUDIO_FALLBACK : catalog.prices).global;
  const setPrice = (key, p) => {
    if (interval === "year") {
      $(`${key}-price`).textContent = p.year.perMonth;
      $(`${key}-per`).textContent = "/month, billed yearly";
      $(`${key}-note`).textContent = `${p.year.label} billed once a year`;
    } else {
      $(`${key}-price`).textContent = p.month.label;
      $(`${key}-per`).textContent = "/month";
      $(`${key}-note`).textContent = "Billed monthly · cancel any time";
    }
  };

  function render() {
    $("region").value = region;
    document.querySelectorAll("#interval button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.interval === interval)));
    window.qcGlide?.($("interval"), document.querySelector(`#interval button[data-interval="${interval}"]`));
    const pro = priceFor("pro"), studio = priceFor("studio");
    setPrice("pro", pro);
    setPrice("studio", studio);
    // Comparison table header follows the toggle; yearly shows the saving vs paying monthly.
    const cur = region === "india" ? "₹" : "$";
    $("t-free-price").textContent = `${cur}0 forever`;
    for (const [key, p] of [["pro", pro], ["studio", studio]]) {
      $(`t-${key}-price`).textContent = interval === "year" ? `${p.year.perMonth}/month · ${p.year.label}/year` : `${p.month.label}/month`;
      const save = $(`t-${key}-save`);
      const pct = p.month.amount && p.year.amount ? Math.round((1 - p.year.amount / (p.month.amount * 12)) * 100) : 0;
      save.textContent = `Save ${pct}%`;
      save.classList.toggle("hidden", interval !== "year" || pct <= 0);
    }
    // How much more Studio costs than Pro, in the chosen period.
    const num = (label) => Number(String(label).replace(/[^0-9.]/g, ""));
    const gap = interval === "year" ? num(studio.year.perMonth) - num(pro.year.perMonth) : num(studio.month.label) - num(pro.month.label);
    $("studio-gap").textContent = gap > 0 ? `Only ${cur}${gap.toLocaleString("en-IN")} a month more than Pro for 4K, 2× the length and 5× the storage.` : "";
    document.querySelector(".plan .price b").textContent = region === "india" ? "₹0" : "$0";
    const t = catalog.tax;
    const taxEl = document.getElementById("tax-line");
    if (taxEl) {
      if (region === "india") taxEl.textContent = "Price includes 18% GST.";
      else if (t && t.rate > 0 && t.country !== "IN") taxEl.textContent = t.inclusive ? `Includes ${t.rate}% ${t.name} for your country.` : `+ ${t.rate}% ${t.name} for your country, added at checkout.`;
      else taxEl.textContent = "No sales tax is added for your country.";
      if ($("studio-tax")) $("studio-tax").textContent = taxEl.textContent;
    }
    $("pay-note").textContent = region === "india"
      ? "Secure checkout by Razorpay — UPI, cards and net banking. Prices include 18% GST."
      : "Secure checkout by PayPal — pay with PayPal or a card. Prices in USD; your bank converts to your currency.";
  }

  document.querySelectorAll("#interval button").forEach((b) => b.addEventListener("click", () => { interval = b.dataset.interval; render(); }));
  $("region").addEventListener("change", () => { region = $("region").value; store.set("qc_region", region); render(); });

  fetch("/api/account?catalog=1").then((r) => r.json()).then((c) => {
    if (c?.prices) catalog = c;
    $("test-banner")?.classList.toggle("hidden", !c?.testMode);
    if (!pickedRegion && c?.suggestedRegion) region = c.suggestedRegion;
    render();
  }).catch(() => render());
  render();

  // ── Checkout ────────────────────────────────────────────────────────────
  const dlg = $("checkout");
  const setErr = (t) => { $("co-err").textContent = t || ""; };
  const showOk = () => {
    if (chosenPlan === "studio") {
      $("ok-title").textContent = "You're on Studio 🎉";
      $("ok-desc").textContent = "4K, 2-hour videos and 500 GB of storage are ready. The QuickCast extension picks this up within a minute.";
    }
    dlg.querySelector(".state-pay").classList.add("hidden"); dlg.querySelector(".state-ok").classList.remove("hidden");
  };
  $("co-cancel").addEventListener("click", () => dlg.close());

  function loadScript(src) {
    return new Promise((ok, no) => {
      if (document.querySelector(`script[src="${src}"]`)) return ok();
      const s = Object.assign(document.createElement("script"), { src, async: true });
      s.onload = ok;
      s.onerror = () => no(new Error("Couldn't load the payment window. Check your connection or disable ad blockers for this page."));
      document.head.append(s);
    });
  }

  async function api(body) {
    const s = await QC.session();
    const res = await fetch("/api/billing", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(s ? { Authorization: `Bearer ${s.access_token}` } : {}) },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "Something went wrong with the payment. Please try again.");
    return data;
  }

  async function verify(body) {
    setErr("");
    $("co-sub").textContent = "Confirming your payment…";
    try {
      await api({ action: "verify", ...body });
      showOk();
    } catch (e) {
      setErr(e.message);
    }
  }

  async function startCheckout() {
    await QC.ready;
    if (!(await QC.session())) {
      try { sessionStorage.setItem("qc_intent", JSON.stringify({ region, interval, plan: chosenPlan })); } catch {}
      return QC.signIn("/pricing/");
    }
    const btn = $(chosenPlan === "studio" ? "studio-cta" : "pro-cta");
    const btnLabel = btn.textContent;
    btn.disabled = true;
    btn.textContent = "Starting checkout…";
    setErr("");
    try {
      const co = await api({ action: "checkout", region, interval, plan: chosenPlan });
      if (co.provider === "razorpay") {
        await loadScript("https://checkout.razorpay.com/v1/checkout.js");
        const rzp = new window.Razorpay({
          key: co.keyId,
          subscription_id: co.subscriptionId,
          name: "QuickCast",
          description: co.label,
          prefill: co.prefill,
          theme: { color: "#5646E0" },
          handler: (resp) => { dlg.showModal(); $("paypal-buttons").replaceChildren(); verify({ provider: "razorpay", ...resp }); },
        });
        rzp.on("payment.failed", (r) => { dlg.showModal(); setErr(r?.error?.description || "The payment didn't go through. You haven't been charged."); });
        rzp.open();
      } else {
        const gp = chosenPlan === "studio" ? (catalog.studio || STUDIO_FALLBACK).global : catalog.prices.global;
        $("co-sub").textContent = `QuickCast ${chosenPlan === "studio" ? "Studio" : "Pro"} — ${interval === "year" ? `${gp.year.label} a year` : `${gp.month.label} a month`}. Pay with PayPal or a card.`;
        dlg.querySelector(".state-pay").classList.remove("hidden");
        dlg.querySelector(".state-ok").classList.add("hidden");
        dlg.showModal();
        await loadScript(`https://www.paypal.com/sdk/js?client-id=${encodeURIComponent(co.clientId)}&vault=true&intent=subscription`);
        $("paypal-buttons").replaceChildren();
        window.paypal.Buttons({
          style: { shape: "pill", label: "subscribe" },
          createSubscription: () => co.subscriptionId, // created on our server
          onApprove: (d) => verify({ provider: "paypal", subscriptionID: d.subscriptionID }),
          onError: () => setErr("PayPal ran into a problem. You haven't been charged — please try again."),
        }).render("#paypal-buttons");
      }
    } catch (e) {
      dlg.showModal();
      setErr(e.message);
    } finally {
      btn.disabled = false;
      btn.textContent = btnLabel;
    }
  }
  for (const id of ["pro-cta", "studio-cta"]) {
    $(id).addEventListener("click", () => { chosenPlan = $(id).dataset.plan; startCheckout(); });
  }

  // Coming back from sign-in with a plan already chosen → continue to checkout.
  (async () => {
    await QC.ready;
    let intent = null;
    try { intent = JSON.parse(sessionStorage.getItem("qc_intent") || "null"); } catch {}
    if (intent && (await QC.session())) {
      try { sessionStorage.removeItem("qc_intent"); } catch {} // used only once signed in
      region = intent.region; interval = intent.interval; chosenPlan = intent.plan === "studio" ? "studio" : "pro"; render();
      startCheckout();
    }
  })();
})();
