/* =============================================================================
   Safiery Store — core engine
   Pricing (B2C + B2B tiers), cart, demo auth, render helpers, generated SVG
   product art, shared header/footer, and the Stripe checkout call.
   Exposes a single global: window.Store
   ========================================================================== */
window.Store = (function () {
  "use strict";

  var C = window.SAFIERY_CATALOG;
  if (!C) { console.error("SAFIERY_CATALOG missing — include data/catalog.js before store.js"); C = { products: [], categories: [], b2bTiers: [], demoAccounts: [], gstRate: 0.1, currency: "AUD" }; }

  var LS_CART = "safiery_cart_v1";
  var LS_SESSION = "safiery_session_v1";

  /* ---------------- lookups ---------------- */
  var prodIndex = {}; C.products.forEach(function (p) { prodIndex[p.id] = p; });
  var catIndex = {};  C.categories.forEach(function (c) { catIndex[c.id] = c; });
  var tierIndex = {}; C.b2bTiers.forEach(function (t) { tierIndex[t.id] = t; });

  function byId(id) { return prodIndex[id] || null; }
  function category(id) { return catIndex[id] || null; }
  function productsIn(catId) { return C.products.filter(function (p) { return p.cats.indexOf(catId) !== -1; }); }
  function categoryCount(catId) { return productsIn(catId).length; }
  function featured() { return C.products.filter(function (p) { return p.featured; }); }

  /* ---------------- money ---------------- */
  function formatAUD(n) {
    return "$" + Number(n).toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function round2(n) { return Math.round((n + Number.EPSILON) * 100) / 100; }

  /* ---------------- session / auth ---------------- */
  function getSession() {
    try { return JSON.parse(localStorage.getItem(LS_SESSION)) || null; } catch (e) { return null; }
  }
  function tier() {
    var s = getSession();
    return s && s.tier ? (tierIndex[s.tier] || null) : null;
  }
  function isTrade() { return !!tier(); }

  function login(email, password) {
    email = (email || "").trim().toLowerCase();
    var acct = C.demoAccounts.filter(function (a) { return a.email.toLowerCase() === email; })[0];
    if (!acct) return { ok: false, error: "No trade account found for that email." };
    if (password !== C.demoPassword) return { ok: false, error: "Incorrect password." };
    localStorage.setItem(LS_SESSION, JSON.stringify({ email: acct.email, company: acct.company, tier: acct.tier }));
    syncTradeMode(); emit("session:change");
    return { ok: true, account: acct };
  }
  function logout() { localStorage.removeItem(LS_SESSION); syncTradeMode(); emit("session:change"); }

  /* ---------------- pricing engine ---------------- */
  // base = current ex-GST sell price. B2B tier % comes off the base.
  function pricing(product) {
    var t = tier();
    var base = product.price;                 // ex-GST retail sell price
    var listPrice = product.listPrice || null; // RRP for sale strike (B2C)
    var out = {
      base: base,
      effective: base,
      listPrice: listPrice,
      onSale: !!product.sale && !!listPrice,
      isTrade: !!t,
      tier: t,
      discountPct: 0,
      saving: 0,
      variable: !!product.variable
    };
    if (t) {
      out.effective = round2(base * (1 - t.discount));
      out.discountPct = Math.round(t.discount * 100);
      out.saving = round2(base - out.effective);
    }
    return out;
  }

  /* ---------------- cart ---------------- */
  function getCartRaw() {
    try { return JSON.parse(localStorage.getItem(LS_CART)) || []; } catch (e) { return []; }
  }
  function saveCartRaw(arr) { localStorage.setItem(LS_CART, JSON.stringify(arr)); emit("cart:change"); }

  function cartItems() {
    return getCartRaw().map(function (l) {
      var p = byId(l.id); if (!p) return null;
      return { product: p, qty: l.qty, pricing: pricing(p) };
    }).filter(Boolean);
  }
  function cartCount() { return getCartRaw().reduce(function (s, l) { return s + l.qty; }, 0); }

  function addToCart(id, qty) {
    qty = qty || 1; var p0 = byId(id); if (!p0) return;
    if (p0.variable) { toast("Quote-only item — contact sales for pricing"); return; }
    var cart = getCartRaw(); var found = cart.filter(function (l) { return l.id === id; })[0];
    if (found) found.qty += qty; else cart.push({ id: id, qty: qty });
    saveCartRaw(cart);
    var p = byId(id);
    toast((qty > 1 ? qty + "× " : "") + p.name.split("—")[0].trim() + " added");
  }
  function setQty(id, qty) {
    var cart = getCartRaw();
    if (qty <= 0) { cart = cart.filter(function (l) { return l.id !== id; }); }
    else { var f = cart.filter(function (l) { return l.id === id; })[0]; if (f) f.qty = qty; }
    saveCartRaw(cart);
  }
  function removeFromCart(id) { saveCartRaw(getCartRaw().filter(function (l) { return l.id !== id; })); }
  function clearCart() { saveCartRaw([]); }

  function cartTotals() {
    var items = cartItems();
    var subBase = 0, subEffective = 0;
    items.forEach(function (it) {
      subBase += it.pricing.base * it.qty;
      subEffective += it.pricing.effective * it.qty;
    });
    subBase = round2(subBase); subEffective = round2(subEffective);
    var saving = round2(subBase - subEffective);
    var gst = round2(subEffective * C.gstRate);
    var total = round2(subEffective + gst);
    return { count: cartCount(), subtotalRetail: subBase, subtotal: subEffective, saving: saving, gst: gst, total: total, trade: isTrade() };
  }

  /* ---------------- events ---------------- */
  function emit(name) { window.dispatchEvent(new CustomEvent(name)); }
  function syncTradeMode() {
    if (isTrade()) document.body.classList.add("trade"); else document.body.classList.remove("trade");
  }

  /* ---------------- icons ---------------- */
  var ICONS = {
    battery: '<rect x="3" y="8" width="15" height="9" rx="2"/><path d="M18 11h2a1 1 0 0 1 1 1v1a1 1 0 0 1-1 1h-2"/><path d="M7 11v3M11 11v3"/>',
    converter: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M7 9l3 3-3 3M17 9l-3 3 3 3"/>',
    alternator: '<circle cx="12" cy="12" r="8"/><path d="M12 4v3M12 17v3M4 12h3M17 12h3"/><circle cx="12" cy="12" r="2.5"/>',
    switch: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M8 8h.01M8 12h.01M8 16h.01M12 8h5M12 12h5M12 16h5"/>',
    button: '<rect x="4" y="4" width="16" height="16" rx="3"/><circle cx="12" cy="12" r="3"/>',
    tank: '<path d="M5 8a7 3 0 0 1 14 0v8a7 3 0 0 1-14 0z"/><path d="M5 12a7 3 0 0 0 14 0"/>',
    cooktop: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="2.5"/><circle cx="15.5" cy="15.5" r="2.5"/>',
    water: '<path d="M12 3s6 6.5 6 10.5A6 6 0 0 1 6 13.5C6 9.5 12 3 12 3z"/>',
    pack: '<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 7h6M9 11h6M9 15h3"/>',
    accessory: '<circle cx="12" cy="12" r="3"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1"/>',
    cart: '<circle cx="9" cy="20" r="1.5"/><circle cx="18" cy="20" r="1.5"/><path d="M2 3h3l2.4 12.5a1 1 0 0 0 1 .8h8.8a1 1 0 0 0 1-.8L21 7H6"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
    menu: '<path d="M3 6h18M3 12h18M3 18h18"/>',
    close: '<path d="M6 6l12 12M18 6L6 18"/>',
    check: '<path d="M20 6L9 17l-5-5"/>',
    bolt: '<path d="M13 2L3 14h7l-1 8 10-12h-7z"/>',
    shield: '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/>',
    cycle: '<path d="M21 12a9 9 0 1 1-3-6.7M21 4v4h-4"/>',
    truck: '<rect x="1" y="5" width="14" height="11" rx="1"/><path d="M15 9h4l3 3v4h-7z"/><circle cx="6" cy="18" r="1.6"/><circle cx="18" cy="18" r="1.6"/>',
    anchor: '<circle cx="12" cy="5" r="2"/><path d="M12 7v13M5 12a7 7 0 0 0 14 0M5 12H3M19 12h2"/>',
    chip: '<rect x="6" y="6" width="12" height="12" rx="2"/><path d="M9 3v3M15 3v3M9 18v3M15 18v3M3 9h3M3 15h3M18 9h3M18 15h3"/>'
  };
  function icon(name, cls) {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" focusable="false" aria-hidden="true" class="' + (cls || "") + '">' + (ICONS[name] || "") + '</svg>';
  }

  /* ---------------- generated product art ---------------- */
  var CAT_COLOR = {
    "12v-lithium": "#f6a623", "48v-lithium": "#f6a623", "scotty": "#34d6c6",
    "bmg": "#6ea8fe", "star-switching": "#f6a623", "star-buttons": "#9fb0c3",
    "tank": "#34d6c6", "cooktops": "#ff8a5b", "hot-water": "#46b6d1",
    "jupiter": "#f6a623", "accessories": "#9fb0c3"
  };
  function esc(s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
  function productArt(product) {
    var cat = category(product.cats[0]) || { glyph: "accessory", tag: "" };
    var col = CAT_COLOR[product.cats[0]] || "#f6a623";
    var glyph = ICONS[cat.glyph] || ICONS.accessory;
    var tag = (product.sku || cat.tag || "").toUpperCase();
    var svg =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300">' +
        '<defs>' +
          '<linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">' +
            '<stop offset="0" stop-color="#16222f"/><stop offset="1" stop-color="#0a0f16"/>' +
          '</linearGradient>' +
          '<radialGradient id="gl" cx="50%" cy="42%" r="55%">' +
            '<stop offset="0" stop-color="' + col + '" stop-opacity="0.30"/>' +
            '<stop offset="1" stop-color="' + col + '" stop-opacity="0"/>' +
          '</radialGradient>' +
          '<pattern id="grid" width="26" height="26" patternUnits="userSpaceOnUse">' +
            '<path d="M26 0H0V26" fill="none" stroke="#ffffff" stroke-opacity="0.05" stroke-width="1"/>' +
          '</pattern>' +
        '</defs>' +
        '<rect width="400" height="300" fill="url(#bg)"/>' +
        '<rect width="400" height="300" fill="url(#grid)"/>' +
        '<rect width="400" height="300" fill="url(#gl)"/>' +
        '<g transform="translate(150 75) scale(4.2)" fill="none" stroke="' + col + '" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">' + glyph + '</g>' +
        '<text x="20" y="280" fill="' + col + '" font-family="IBM Plex Mono, monospace" font-size="13" letter-spacing="1.5">' + esc(tag) + '</text>' +
        '<text x="380" y="280" text-anchor="end" fill="#5f7185" font-family="IBM Plex Mono, monospace" font-size="11" letter-spacing="2">SAFIERY</text>' +
      '</svg>';
    return "data:image/svg+xml," + encodeURIComponent(svg);
  }

  /* ---------------- price + card HTML ---------------- */
  var CUR = '<span class="cur">AUD</span>';
  function priceHTML(product, opts) {
    opts = opts || {};
    var pr = pricing(product);
    var pre = pr.variable ? '<span style="font-size:11px;color:var(--text-mut)">from </span>' : "";
    var sizeCls = opts.lg ? " lg" : "";
    var html = '<div class="price' + sizeCls + '">';
    if (pr.isTrade) {
      html += '<span class="now b2b">' + pre + CUR + formatAUD(pr.effective).slice(1) + '</span>';
      html += '<span class="retail-strike">' + (pr.listPrice ? 'RRP ' + formatAUD(pr.listPrice) : 'List ' + formatAUD(pr.base)) + '</span>';
      html += '<span class="save">Trade −' + pr.discountPct + '% · save ' + formatAUD(pr.saving) + '</span>';
    } else {
      html += '<span class="now">' + pre + CUR + formatAUD(pr.effective).slice(1) + '</span>';
      if (pr.onSale) html += '<span class="was">' + formatAUD(pr.listPrice) + '</span>';
      html += '<span class="gst">ex GST · ' + formatAUD(round2(pr.effective * (1 + C.gstRate))) + ' inc</span>';
    }
    html += '</div>';
    return html;
  }

  var STOCK_LABEL = { in_stock: "In stock", backorder: "Backorder", made_to_order: "Made to order" };
  function productCard(product) {
    var pr = pricing(product);
    var cat = category(product.cats[0]);
    var flags = "";
    if (pr.onSale) flags += '<span class="flag sale">Sale</span>';
    if (product.featured) flags += '<span class="flag feat">Featured</span>';
    var badges = (product.badges || []).slice(0, 3).map(function (b) { return '<span class="minibadge">' + esc(b) + '</span>'; }).join("");
    return '' +
      '<article class="pcard">' +
        '<a class="pcard-img" href="product.html?id=' + product.id + '" aria-label="' + esc(product.name) + '">' +
          '<img src="' + productArt(product) + '" alt="' + esc(product.name) + '" loading="lazy">' +
          (flags ? '<div class="pcard-flags">' + flags + '</div>' : "") +
          '<span class="stock-led"><span class="led ' + product.stock + '"></span>' + (STOCK_LABEL[product.stock] || "") + '</span>' +
        '</a>' +
        '<div class="pcard-body">' +
          '<span class="pcat">' + esc(cat ? cat.name : "") + '</span>' +
          '<h3><a href="product.html?id=' + product.id + '">' + esc(product.name) + '</a></h3>' +
          (badges ? '<div class="pbadges">' + badges + '</div>' : "") +
          '<div class="pcard-foot">' +
            priceHTML(product) +
            '<button class="btn btn-primary btn-sm" data-add="' + product.id + '" aria-label="Add ' + esc(product.name) + ' to cart">' + icon("cart") + '</button>' +
          '</div>' +
        '</div>' +
      '</article>';
  }
  function renderGrid(el, list) {
    el.innerHTML = list.length ? list.map(productCard).join("") : '<p class="muted">No products match.</p>';
  }

  /* ---------------- toast ---------------- */
  function toast(msg) {
    var wrap = document.querySelector(".toast-wrap");
    if (!wrap) {
      wrap = document.createElement("div"); wrap.className = "toast-wrap";
      wrap.setAttribute("role", "status"); wrap.setAttribute("aria-live", "polite"); wrap.setAttribute("aria-atomic", "true");
      document.body.appendChild(wrap);
    }
    var t = document.createElement("div"); t.className = "toast";
    t.innerHTML = '<span class="ti">' + icon("check") + '</span><span>' + esc(msg) + '</span>';
    wrap.appendChild(t);
    setTimeout(function () { t.style.opacity = "0"; t.style.transform = "translateX(20px)"; t.style.transition = ".3s"; }, 2200);
    setTimeout(function () { t.remove(); }, 2600);
  }

  /* ---------------- header / footer ---------------- */
  var NAV = [
    { href: "shop.html", label: "Shop" },
    { href: "shop.html?cat=12v-lithium", label: "Batteries" },
    { href: "shop.html?cat=scotty", label: "Scotty AI" },
    { href: "shop.html?cat=bmg", label: "BMG" },
    { href: "shop.html?cat=star-switching", label: "STAR Switching" },
    { href: "shop.html?cat=jupiter", label: "Jupiter Packs" }
  ];
  function headerHTML(active) {
    var navlinks = NAV.map(function (n) {
      var on = (active && n.href === active) ? " active" : "";
      return '<a class="' + on.trim() + '"' + (on ? ' aria-current="page"' : '') + ' href="' + n.href + '">' + n.label + '</a>';
    }).join("");
    return '' +
    '<a class="skip-link" href="#main">Skip to content</a>' +
    '<div class="topstrip"><div class="wrap">' +
      '<span><span class="dot">●</span> Genset-free power for land &amp; water · Ships AU-wide</span>' +
      '<span class="hide-sm">AUD · GST registered · sales@safiery.com</span>' +
    '</div></div>' +
    '<div class="header-main"><div class="wrap">' +
      '<a class="brand" href="index.html"><span class="mark">' + icon("bolt") + '</span> Safiery</a>' +
      '<nav class="nav" aria-label="Primary">' + navlinks + '</nav>' +
      '<div class="header-actions">' +
        '<span class="trade-pill"><span class="blip"></span><span data-trade-label>TRADE</span></span>' +
        '<a class="icon-btn" href="account.html" aria-label="Account">' + icon("user") + '</a>' +
        '<a class="icon-btn" href="cart.html" aria-label="Cart">' + icon("cart") + '<span class="cart-count" data-cart-count>0</span></a>' +
        '<button class="icon-btn menu-toggle" aria-label="Open menu" aria-expanded="false" aria-controls="nav-drawer">' + icon("menu") + '</button>' +
      '</div>' +
    '</div></div>';
  }
  function drawerHTML() {
    var links = NAV.map(function (n) { return '<a href="' + n.href + '">' + n.label + '</a>'; }).join("");
    return '<button class="icon-btn close" aria-label="Close">' + icon("close") + '</button>' + links +
      '<a href="account.html">Account / Trade Login</a><a href="cart.html">Cart</a>';
  }
  function footerHTML() {
    var catLinks = C.categories.slice(0, 6).map(function (c) { return '<li><a href="shop.html?cat=' + c.id + '">' + c.name + '</a></li>'; }).join("");
    return '<div class="wrap"><div class="footer-grid">' +
      '<div>' +
        '<a class="brand" href="index.html"><span class="mark">' + icon("bolt") + '</span> Safiery</a>' +
        '<p class="footer-tagline">Power, energy and switching products so people enjoy adventure travel globally — on land or water — without a genset.</p>' +
      '</div>' +
      '<div><h4>Shop</h4><ul>' + catLinks + '</ul></div>' +
      '<div><h4>Company</h4><ul>' +
        '<li><a href="account.html">Become a Partner</a></li><li><a href="mailto:sales@safiery.com">About Us</a></li>' +
        '<li><a href="mailto:sales@safiery.com?subject=Warranty%20%2F%20RMA">Warranty &amp; RMA</a></li><li><a href="account.html">Resellers</a></li>' +
        '<li><a href="account.html">Trade Login</a></li></ul></div>' +
      '<div><h4>Get in touch</h4><ul>' +
        '<li>QLD HO: 45/8 Distribution Court, Arundel QLD 4214</li>' +
        '<li><a href="mailto:sales@safiery.com">sales@safiery.com</a></li>' +
        '<li><a href="tel:+61721022553">+61 (07) 210 22 55 3</a></li></ul></div>' +
    '</div><div class="footer-bottom">' +
      '<span>© Safiery Pty Ltd 2026 · ABN 00 000 000 000</span>' +
      '<span>Privacy · Returns · Terms &amp; Conditions</span>' +
    '</div></div>';
  }

  function mountChrome() {
    if (document.querySelector(".nav-drawer")) { refreshChrome(); return; } // idempotent
    var active = (document.body.dataset.nav || "");
    var header = document.querySelector("[data-header]");
    if (header) { header.className = "site-header"; header.innerHTML = headerHTML(active); }
    var footer = document.querySelector("[data-footer]");
    if (footer) { footer.className = "site-footer"; footer.innerHTML = footerHTML(); }

    // accessible mobile drawer
    if (header) {
      var scrim = document.createElement("div"); scrim.className = "scrim"; document.body.appendChild(scrim);
      var drawer = document.createElement("nav"); drawer.className = "nav-drawer"; drawer.id = "nav-drawer";
      drawer.setAttribute("aria-label", "Mobile"); drawer.setAttribute("role", "dialog"); drawer.setAttribute("aria-modal", "true");
      drawer.innerHTML = drawerHTML(); document.body.appendChild(drawer);
      try { drawer.inert = true; } catch (e) {}
      var lastFocus = null;
      function focusables() { return drawer.querySelectorAll('a[href], button:not([disabled])'); }
      function openD() {
        lastFocus = document.activeElement;
        drawer.classList.add("open"); scrim.classList.add("open");
        try { drawer.inert = false; } catch (e) {}
        var t = header.querySelector(".menu-toggle"); if (t) t.setAttribute("aria-expanded", "true");
        var f = focusables()[0]; if (f) f.focus();
      }
      function closeD() {
        drawer.classList.remove("open"); scrim.classList.remove("open");
        try { drawer.inert = true; } catch (e) {}
        var t = header.querySelector(".menu-toggle"); if (t) { t.setAttribute("aria-expanded", "false"); if (lastFocus === t || (lastFocus && lastFocus.closest && lastFocus.closest(".menu-toggle"))) t.focus(); }
      }
      header.addEventListener("click", function (e) { if (e.target.closest(".menu-toggle")) openD(); });
      drawer.addEventListener("click", function (e) { if (e.target.closest(".close") || e.target.tagName === "A") closeD(); });
      scrim.addEventListener("click", closeD);
      drawer.addEventListener("keydown", function (e) {
        if (e.key === "Escape") { closeD(); return; }
        if (e.key !== "Tab") return;
        var f = focusables(); if (!f.length) return;
        var first = f[0], last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      });
    }
    refreshChrome();
  }
  function refreshChrome() {
    document.querySelectorAll("[data-cart-count]").forEach(function (el) {
      var c = cartCount(); el.textContent = c; el.style.display = c ? "grid" : "none";
    });
    var s = getSession();
    document.querySelectorAll("[data-trade-label]").forEach(function (el) {
      var t = tier(); el.textContent = t ? (s.company ? s.company + " · " + t.name : t.name) : "TRADE";
    });
    syncTradeMode();
  }

  /* ---------------- delegated add-to-cart ---------------- */
  function wireGlobal() {
    document.addEventListener("click", function (e) {
      var add = e.target.closest("[data-add]");
      if (add) { e.preventDefault(); addToCart(add.getAttribute("data-add"), 1); }
    });
    window.addEventListener("cart:change", refreshChrome);
    window.addEventListener("session:change", function () { refreshChrome(); rerenderPrices(); });
  }
  // re-render any price/grid regions live when trade mode toggles
  function rerenderPrices() {
    document.querySelectorAll("[data-grid]").forEach(function (el) {
      if (el._list) renderGrid(el, el._list);
    });
    if (window.__pageRerender) window.__pageRerender();
  }

  /* ---------------- Stripe checkout ---------------- */
  function checkout(btn) {
    var items = getCartRaw();
    if (!items.length) { toast("Your cart is empty"); return; }
    var s = getSession();
    if (btn) { btn.disabled = true; btn._t = btn.innerHTML; btn.innerHTML = "Redirecting to secure checkout…"; }
    fetch("/.netlify/functions/create-checkout-session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items: items, accountEmail: s ? s.email : null })
    }).then(function (r) { return r.json().then(function (j) { return { ok: r.ok, body: j }; }); })
      .then(function (res) {
        if (res.ok && res.body.url) { window.location.href = res.body.url; return; }
        throw new Error(res.body && res.body.error ? res.body.error : "Checkout unavailable");
      })
      .catch(function (err) {
        if (btn) { btn.disabled = false; btn.innerHTML = btn._t; }
        toast("Checkout: " + err.message);
        var note = document.querySelector("[data-checkout-note]");
        if (note) {
          note.style.display = "block";
          note.innerHTML = "Stripe checkout needs the serverless function running. Locally use <span class='mono'>netlify dev</span>, and set <span class='mono'>STRIPE_SECRET_KEY</span> in your environment. (" + esc(err.message) + ")";
        }
      });
  }

  /* ---------------- boot ---------------- */
  function init() {
    syncTradeMode();
    document.addEventListener("DOMContentLoaded", function () {
      mountChrome(); wireGlobal();
    });
  }
  init();

  /* ---------------- public API ---------------- */
  return {
    catalog: C, byId: byId, category: category, categories: C.categories,
    productsIn: productsIn, categoryCount: categoryCount, featured: featured,
    formatAUD: formatAUD, round2: round2, esc: esc, icon: icon,
    pricing: pricing, priceHTML: priceHTML, productCard: productCard, renderGrid: renderGrid, productArt: productArt,
    getSession: getSession, tier: tier, isTrade: isTrade, login: login, logout: logout,
    cartItems: cartItems, cartCount: cartCount, cartTotals: cartTotals,
    addToCart: addToCart, setQty: setQty, removeFromCart: removeFromCart, clearCart: clearCart,
    checkout: checkout, toast: toast, refreshChrome: refreshChrome,
    STOCK_LABEL: STOCK_LABEL
  };
})();
