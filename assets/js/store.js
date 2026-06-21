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
  var LS_PRICES = "safiery_prices_v1";

  // Quasar HQ (ERP) origin - source of B2B auth + pricing. Override with
  // window.SAFIERY_ERP_BASE before store.js if it ever changes.
  var ERP_BASE = (window.SAFIERY_ERP_BASE || "https://quasar-safiery-967.netlify.app").replace(/\/+$/, "");
  // Store product id -> ERP catalog link ({wooId, wooCategory, confidence}). Generated
  // by the catalog reconciliation; include data/catalog-links.js before store.js.
  var LINKS = (window.SAFIERY_CATALOG_LINKS && window.SAFIERY_CATALOG_LINKS.links) || {};
  // Pure merge helper (data/catalog-merge.js) - overlays the live ERP feed onto the
  // curated static catalogue by wooId. Include catalog-merge.js before store.js.
  var MERGE = window.SAFIERY_CATALOG_MERGE;

  /* ---------------- lookups ---------------- */
  var prodIndex = {};
  function rebuildIndex() { prodIndex = {}; C.products.forEach(function (p) { prodIndex[p.id] = p; }); }
  rebuildIndex();
  var catIndex = {};  C.categories.forEach(function (c) { catIndex[c.id] = c; });
  // NB: B2B tiers are now resolved by the ERP (not from C.b2bTiers); tier()/pricing()
  // read the cached ERP price map. C.b2bTiers/demoAccounts in the catalog are legacy.

  function byId(id) { return prodIndex[id] || null; }
  function category(id) { return catIndex[id] || null; }
  function productsIn(catId) { return C.products.filter(function (p) { return p.cats.indexOf(catId) !== -1; }); }
  function categoryCount(catId) { return productsIn(catId).length; }
  function featured() { return C.products.filter(function (p) { return p.featured; }); }

  /* ---------------- catalogue source (ERP feed -> overlay onto static) ---------------- */
  // The bundled static catalogue is the curated overlay AND the offline fallback. On load
  // we fetch the ERP `store-catalog` feed and overlay the live name/price/stock/images/desc
  // by wooId (data/catalog-merge.js). If the feed is unavailable the static catalogue
  // stands, so the store always renders. Pages await Store.ready() before rendering product
  // data so they never paint stale prices/photos before the overlay lands.
  var _readyDone = false, _readyResolve;
  var _ready = new Promise(function (res) { _readyResolve = res; });
  function _finishReady() { if (!_readyDone) { _readyDone = true; _readyResolve(true); } }

  function applyFeed(feed) {
    if (!MERGE || !feed || feed.ok === false || !Array.isArray(feed.products)) return false;
    var merged = MERGE.mergeCatalog(C.products, feed, LINKS);
    // Mutate C.products in place so the exported Store.catalog / Store.categories
    // references already held by a page stay valid; then rebuild the id index.
    C.products.length = 0;
    for (var i = 0; i < merged.length; i++) C.products.push(merged[i]);
    rebuildIndex();
    return true;
  }

  function loadCatalog() {
    // Bounded so a slow/hung ERP can never block the storefront: on timeout or error we
    // resolve ready() with the static fallback (already in place) and the store renders.
    var timeout = new Promise(function (res) { setTimeout(function () { res(null); }, 4000); });
    var fetchP = fetch(ERP_BASE + "/.netlify/functions/store-catalog", { headers: { "Accept": "application/json" } })
      .then(function (r) { return r.ok ? r.json() : null; })
      .catch(function () { return null; });
    return Promise.race([fetchP, timeout]).then(function (feed) {
      try {
        if (applyFeed(feed)) emit("catalog:change");
        else console.info("[store] ERP catalogue feed unavailable - using the bundled catalogue.");
      } catch (e) { console.warn("[store] catalogue merge failed, using bundled catalogue:", e && e.message); }
      _finishReady();
      return true;
    });
  }
  function ready() { return _ready; }

  /* ---------------- money ---------------- */
  function formatAUD(n) {
    return "$" + Number(n).toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function round2(n) { return Math.round((n + Number.EPSILON) * 100) / 100; }

  /* ---------------- session / auth (magic-link via the ERP) ---------------- */
  // Session = { token (ERP store-session JWT), contactId, name, company, email, tier }.
  // The B2B price list is fetched from the ERP and cached in LS_PRICES (store id -> ex-GST $).
  function getSession() {
    try { return JSON.parse(localStorage.getItem(LS_SESSION)) || null; } catch (e) { return null; }
  }
  function priceMap() {
    try { return JSON.parse(localStorage.getItem(LS_PRICES)) || {}; } catch (e) { return {}; }
  }
  function tier() {
    var s = getSession();
    if (!s || !s.tier) return null;
    return { id: s.tier, name: String(s.tier).charAt(0).toUpperCase() + String(s.tier).slice(1) };
  }
  function isTrade() { return !!(getSession() && getSession().token); }

  // Step 1: request a magic link (always resolves ok - the ERP never reveals whether
  // the email exists; the link is emailed to the address owner).
  function requestLogin(email) {
    return fetch(ERP_BASE + "/.netlify/functions/customer-login-request", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: (email || "").trim().toLowerCase() })
    }).then(function () { return { ok: true }; }).catch(function () { return { ok: true }; });
  }

  // Step 2: exchange the emailed token for a store session, then load B2B prices.
  function verifyLogin(token) {
    return fetch(ERP_BASE + "/.netlify/functions/customer-login-verify", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: token })
    }).then(function (r) { return r.json().then(function (j) { return { ok: r.ok, body: j }; }); })
      .then(function (res) {
        if (!res.ok || !res.body || !res.body.ok) return { ok: false, error: (res.body && res.body.error) || "Sign-in failed" };
        var p = res.body.profile || {};
        var sess = { token: res.body.token, contactId: p.contactId, name: p.name, company: p.company, email: p.email, tier: p.tier || null };
        localStorage.setItem(LS_SESSION, JSON.stringify(sess));
        syncTradeMode(); emit("session:change");
        return fetchPrices().then(function () { return { ok: true, profile: p }; });
      }).catch(function (e) { return { ok: false, error: String((e && e.message) || e) }; });
  }

  // Fetch the customer's full B2B price list from the ERP and cache it. The ERP applies
  // the contact's tier/category discounts off each product's RRP (authoritative).
  function fetchPrices() {
    var s = getSession();
    if (!s || !s.token) return Promise.resolve(false);
    var items = [];
    C.products.forEach(function (p) {
      if (p.variable) return;
      var link = LINKS[p.id];
      if (!link || !link.wooId) return;          // unlinked product -> retail only
      items.push({ storeId: p.id, wooId: link.wooId, sku: p.sku, rrp: p.price, qty: 1 });
    });
    if (!items.length) return Promise.resolve(false);
    return fetch(ERP_BASE + "/.netlify/functions/resolve-prices", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": "Bearer " + s.token },
      body: JSON.stringify({ items: items.map(function (i) { return { wooId: i.wooId, sku: i.sku, rrp: i.rrp, qty: 1 }; }) })
    }).then(function (r) { if (!r.ok) throw new Error("prices " + r.status); return r.json(); })
      .then(function (j) {
        if (!j || !j.ok || !Array.isArray(j.items)) throw new Error("bad prices");
        var map = {};
        items.forEach(function (it, idx) { var u = j.items[idx] && +j.items[idx].unitPrice; if (u >= 0) map[it.storeId] = round2(u); });
        try { localStorage.setItem(LS_PRICES, JSON.stringify(map)); } catch (e) {}
        var sess = getSession(); if (sess) { sess.tier = (j.tier != null ? j.tier : sess.tier) || null; localStorage.setItem(LS_SESSION, JSON.stringify(sess)); }
        emit("session:change");
        return true;
      }).catch(function (e) { console.warn("[store] fetchPrices failed:", e && e.message); return false; });
  }

  function logout() {
    localStorage.removeItem(LS_SESSION); localStorage.removeItem(LS_PRICES);
    syncTradeMode(); emit("session:change");
  }

  /* ---------------- pricing engine ---------------- */
  // base = ex-GST retail sell price (the store's RRP). The B2B effective price comes from
  // the ERP-resolved price map (cached on login); retail when guest or product unlinked.
  function pricing(product) {
    var base = product.price;
    var listPrice = product.listPrice || null;
    var pm = priceMap();
    var b2b = (pm && pm[product.id] != null) ? +pm[product.id] : null;
    var out = {
      base: base,
      effective: (b2b != null && b2b >= 0) ? b2b : base,
      listPrice: listPrice,
      onSale: !!product.sale && !!listPrice,
      isTrade: isTrade(),
      tier: tier(),
      discountPct: 0,
      saving: 0,
      variable: !!product.variable
    };
    if (b2b != null && base > 0 && out.effective < base) {
      out.discountPct = Math.round((1 - out.effective / base) * 100);
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
    "12v-lithium": "#3E78BD", "48v-lithium": "#2c5a91", "scotty": "#4a90c2",
    "bmg": "#5b6470", "star-switching": "#3E78BD", "star-buttons": "#8c9198",
    "tank": "#4a90c2", "cooktops": "#6b7787", "hot-water": "#3E78BD",
    "jupiter": "#2c5a91", "accessories": "#8c9198"
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
            '<stop offset="0" stop-color="#f6f9fc"/><stop offset="1" stop-color="#e6edf4"/>' +
          '</linearGradient>' +
          '<radialGradient id="gl" cx="50%" cy="42%" r="55%">' +
            '<stop offset="0" stop-color="' + col + '" stop-opacity="0.22"/>' +
            '<stop offset="1" stop-color="' + col + '" stop-opacity="0"/>' +
          '</radialGradient>' +
          '<pattern id="grid" width="26" height="26" patternUnits="userSpaceOnUse">' +
            '<path d="M26 0H0V26" fill="none" stroke="#1b2a3f" stroke-opacity="0.05" stroke-width="1"/>' +
          '</pattern>' +
        '</defs>' +
        '<rect width="400" height="300" fill="url(#bg)"/>' +
        '<rect width="400" height="300" fill="url(#grid)"/>' +
        '<rect width="400" height="300" fill="url(#gl)"/>' +
        '<g transform="translate(150 75) scale(4.2)" fill="none" stroke="' + col + '" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">' + glyph + '</g>' +
        '<text x="20" y="280" fill="' + col + '" font-family="IBM Plex Mono, monospace" font-size="13" letter-spacing="1.5">' + esc(tag) + '</text>' +
        '<text x="380" y="280" text-anchor="end" fill="#9aa3ad" font-family="IBM Plex Mono, monospace" font-size="11" letter-spacing="2">SAFIERY</text>' +
      '</svg>';
    return "data:image/svg+xml," + encodeURIComponent(svg);
  }
  // Real ERP product photo when present (overlaid from the feed), else the generated
  // SVG art so a product without a photo still renders cleanly.
  function productImage(product) {
    var img = product && product.images && product.images[0];
    return (img && img.src) ? img.src : productArt(product);
  }

  /* ---------------- price + card HTML ---------------- */
  var CUR = '<span class="cur">AUD</span>';
  function priceHTML(product, opts) {
    opts = opts || {};
    var pr = pricing(product);
    var pre = pr.variable ? '<span style="font-size:11px;color:var(--text-mut)">from </span>' : "";
    var sizeCls = opts.lg ? " lg" : "";
    var html = '<div class="price' + sizeCls + '">';
    if (pr.isTrade && pr.saving > 0) {
      html += '<span class="now b2b">' + pre + CUR + formatAUD(pr.effective).slice(1) + '</span>';
      html += '<span class="retail-strike">' + (pr.listPrice ? 'RRP ' + formatAUD(pr.listPrice) : 'List ' + formatAUD(pr.base)) + '</span>';
      html += '<span class="save">−' + pr.discountPct + '% · save ' + formatAUD(pr.saving) + '</span>';
    } else {
      html += '<span class="now">' + pre + CUR + formatAUD(pr.effective).slice(1) + '</span>';
      if (pr.onSale) html += '<span class="was">' + formatAUD(pr.listPrice) + '</span>';
      html += '<span class="gst">ex GST · ' + formatAUD(round2(pr.effective * (1 + C.gstRate))) + ' inc</span>';
    }
    html += '</div>';
    return html;
  }

  var STOCK_LABEL = { in_stock: "In stock", backorder: "Backorder", made_to_order: "Made to order", out_of_stock: "Out of stock" };
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
          '<img src="' + productImage(product) + '" alt="' + esc(product.name) + '" loading="lazy">' +
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
    '<div class="header-main"><div class="wrap">' +
      '<a class="brand" href="index.html" aria-label="Safiery — home"><img class="brand-logo" src="assets/img/safiery-logo.webp" alt="Safiery" width="350" height="293"></a>' +
      '<nav class="nav" aria-label="Primary">' + navlinks + '</nav>' +
      '<div class="header-actions">' +
        '<span class="trade-pill"><span class="blip"></span><span data-trade-label>Account</span></span>' +
        '<a class="icon-btn" href="account.html" aria-label="Account">' + icon("user") + '</a>' +
        '<a class="icon-btn" href="cart.html" aria-label="Cart">' + icon("cart") + '<span class="cart-count" data-cart-count>0</span></a>' +
        '<button class="icon-btn menu-toggle" aria-label="Open menu" aria-expanded="false" aria-controls="nav-drawer">' + icon("menu") + '</button>' +
      '</div>' +
    '</div></div>';
  }
  function drawerHTML() {
    var links = NAV.map(function (n) { return '<a href="' + n.href + '">' + n.label + '</a>'; }).join("");
    return '<button class="icon-btn close" aria-label="Close">' + icon("close") + '</button>' + links +
      '<a href="account.html">Account</a><a href="cart.html">Cart</a>';
  }
  function footerHTML() {
    var catLinks = C.categories.slice(0, 6).map(function (c) { return '<li><a href="shop.html?cat=' + c.id + '">' + c.name + '</a></li>'; }).join("");
    return '<div class="wrap"><div class="footer-grid">' +
      '<div>' +
        '<a class="brand" href="index.html" aria-label="Safiery — home"><img class="brand-logo" src="assets/img/safiery-logo.webp" alt="Safiery" width="350" height="293"></a>' +
        '<p class="footer-tagline">Power, energy and switching products so people enjoy adventure travel globally — on land or water — without a genset.</p>' +
      '</div>' +
      '<div><h4>Shop</h4><ul>' + catLinks + '</ul></div>' +
      '<div><h4>Company</h4><ul>' +
        '<li><a href="account.html">Become a Partner</a></li><li><a href="mailto:sales@safiery.com">About Us</a></li>' +
        '<li><a href="mailto:sales@safiery.com?subject=Warranty%20%2F%20RMA">Warranty &amp; RMA</a></li><li><a href="account.html">Resellers</a></li>' +
        '<li><a href="account.html">Account login</a></li></ul></div>' +
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
      el.textContent = (s && s.company) || "Account";
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
      body: JSON.stringify({ items: items, accountToken: s ? s.token : null, accountEmail: s ? s.email : null })
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
    loadCatalog();   // start the ERP catalogue fetch immediately (resolves Store.ready())
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
    pricing: pricing, priceHTML: priceHTML, productCard: productCard, renderGrid: renderGrid,
    productArt: productArt, productImage: productImage, ready: ready,
    getSession: getSession, tier: tier, isTrade: isTrade, logout: logout,
    requestLogin: requestLogin, verifyLogin: verifyLogin, fetchPrices: fetchPrices, priceMap: priceMap,
    cartItems: cartItems, cartCount: cartCount, cartTotals: cartTotals,
    addToCart: addToCart, setQty: setQty, removeFromCart: removeFromCart, clearCart: clearCart,
    checkout: checkout, toast: toast, refreshChrome: refreshChrome,
    STOCK_LABEL: STOCK_LABEL
  };
})();
