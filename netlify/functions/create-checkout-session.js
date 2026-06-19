/* =============================================================================
 * Netlify Function: create-checkout-session
 * Creates a Stripe Checkout Session. Prices are recomputed HERE from the trusted
 * catalog, and B2B pricing is resolved AUTHORITATIVELY from the Quasar ERP
 * (resolve-prices) using the customer's store-session token - the client can never
 * dictate the amount or the discount tier.
 *
 * Each line carries its SKU + ERP catalog id (woo:<id>) in Stripe product metadata
 * so the stripe-webhook can rebuild the order for the ERP.
 *
 * Env required:  STRIPE_SECRET_KEY
 * Env for B2B:   ERP_BASE_URL (the Quasar HQ origin), STORE_SHARED_SECRET
 * Env optional:  URL (Netlify sets it automatically)
 * ========================================================================== */
const CATALOG = require("../../data/catalog.js");
let LINKS = {};
try { LINKS = require("../../data/catalog-links.js").links || {}; } catch (e) { LINKS = {}; }
const MERGE = require("../../data/catalog-merge.js");

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};
const json = (statusCode, body) => ({ statusCode, headers: { ...CORS, "Content-Type": "application/json" }, body: JSON.stringify(body) });

const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
const cents = (n) => Math.round(n * 100);

// Ask the ERP for authoritative B2B unit prices for these items (ex-GST), using the
// customer's store-session token. Returns { ok, status, tier, prices: number[] } where
// prices aligns by index with `items`. ok=false + status=401 => not really logged in
// (treat as retail); ok=false + other => ERP problem (caller should NOT overcharge).
async function erpPrices(items, token) {
  const base = (process.env.ERP_BASE_URL || "").replace(/\/+$/, "");
  const secret = process.env.STORE_SHARED_SECRET || "";
  if (!base || !token) return { ok: false, status: 0, reason: "no_erp_or_token" };
  try {
    const res = await fetch(base + "/.netlify/functions/resolve-prices", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": "Bearer " + token, "X-Store-Secret": secret },
      body: JSON.stringify({ items: items.map((i) => ({ wooId: i.wooId, sku: i.sku, rrp: i.rrp, qty: i.qty })) })
    });
    if (res.status === 401) return { ok: false, status: 401 };
    if (!res.ok) return { ok: false, status: res.status };
    const j = await res.json();
    if (!j || !j.ok || !Array.isArray(j.items)) return { ok: false, status: res.status };
    return { ok: true, status: 200, tier: j.tier || null, prices: j.items.map((x) => +x.unitPrice) };
  } catch (e) {
    return { ok: false, status: 0, reason: String((e && e.message) || e) };
  }
}

// Overlay the live ERP retail price (ex-GST) onto each trusted cart line, matched by
// wooId, so the server charges the SAME retail base the storefront displayed (the store
// now reads its catalogue from the same ERP store-catalog feed). Best-effort: if the feed
// is unavailable the bundled catalog price stands. The client price is never trusted.
async function applyErpRetail(cart) {
  const base = (process.env.ERP_BASE_URL || "").replace(/\/+$/, "");
  if (!base) return;
  try {
    const res = await fetch(base + "/.netlify/functions/store-catalog", { headers: { "Accept": "application/json" } });
    if (!res.ok) return;
    const feed = await res.json();
    if (!feed || feed.ok === false) return;
    const byWoo = MERGE.wooIndex(feed);
    for (const c of cart) {
      const wid = MERGE.normWooId(c.wooId);
      const fp = wid ? byWoo[wid] : null;
      if (fp && +fp.price > 0) c.rrp = round2(+fp.price);
    }
  } catch (e) { /* ERP feed down -> keep the bundled retail price */ }
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: CORS, body: "" };
  if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed" });

  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    return json(400, { error: "Stripe is not configured. Set STRIPE_SECRET_KEY in your Netlify environment (Site settings -> Environment variables)." });
  }

  let payload;
  try { payload = JSON.parse(event.body || "{}"); }
  catch (e) { return json(400, { error: "Invalid request body" }); }

  const requested = Array.isArray(payload.items) ? payload.items : [];
  if (!requested.length) return json(400, { error: "Cart is empty" });
  const token = typeof payload.accountToken === "string" ? payload.accountToken : null;

  // Build the trusted cart (server reads its own catalog; client only sent id + qty).
  const productIndex = {};
  CATALOG.products.forEach((p) => { productIndex[p.id] = p; });
  const cart = [];
  for (const row of requested) {
    const p = productIndex[row.id];
    if (!p || p.variable) continue;          // unknown / quote-only -> never transact
    const qty = Math.max(1, Math.min(999, parseInt(row.qty, 10) || 1));
    const link = LINKS[p.id] || {};
    cart.push({ storeId: p.id, sku: p.sku || p.id, name: p.name, rrp: round2(p.price), qty, wooId: link.wooId || null });
  }
  if (!cart.length) return json(400, { error: "No valid items in cart" });

  // Retail base comes from the ERP catalogue feed (same source the storefront shows),
  // so displayed retail == charged retail. B2B discount is then applied off this base.
  await applyErpRetail(cart);

  // Authoritative B2B pricing from the ERP (falls back to retail when not logged in).
  let unit = cart.map((c) => c.rrp);   // default: retail RRP ex-GST
  let tier = "retail";
  if (token) {
    const r = await erpPrices(cart, token);
    if (r.ok) {
      unit = cart.map((c, i) => (r.prices[i] >= 0 ? round2(r.prices[i]) : c.rrp));
      tier = r.tier || "retail";
    } else if (r.status === 401) {
      // Token expired/invalid -> behave as a guest (retail). The store UI would also
      // have shown retail, so this is consistent and never overcharges.
    } else {
      // ERP unreachable: a logged-in customer may have been shown trade prices. Do NOT
      // silently charge retail (overcharge) - fail so they retry.
      return json(503, { error: "Trade pricing is temporarily unavailable. Please try again in a moment." });
    }
  }

  let subtotalExGst = 0;
  const line_items = [];
  cart.forEach((c, i) => {
    const u = unit[i];
    subtotalExGst += u * c.qty;
    line_items.push({
      quantity: c.qty,
      price_data: {
        currency: (CATALOG.currency || "AUD").toLowerCase(),
        unit_amount: cents(u),
        product_data: { name: c.name, metadata: { sku: c.sku, wooId: c.wooId || "", storeId: c.storeId, tier } }
      }
    });
  });

  // GST as its own line so the Stripe total matches the cart (inc GST). Round the
  // subtotal first so the GST base matches the client's (avoids 1c drift).
  const gst = round2(round2(subtotalExGst) * (CATALOG.gstRate || 0.1));
  line_items.push({
    quantity: 1,
    price_data: {
      currency: (CATALOG.currency || "AUD").toLowerCase(),
      unit_amount: cents(gst),
      product_data: { name: `GST (${Math.round((CATALOG.gstRate || 0.1) * 100)}%)`, metadata: { gst: "1" } }
    }
  });

  const base =
    process.env.URL ||
    process.env.DEPLOY_PRIME_URL ||
    (event.headers && event.headers.host ? `https://${event.headers.host}` : "");
  if (!base) return json(500, { error: "Site URL not configured (set the URL environment variable)." });

  const rawEmail = typeof payload.accountEmail === "string" ? payload.accountEmail.trim() : "";
  const customerEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(rawEmail) ? rawEmail : undefined;

  try {
    const stripe = require("stripe")(key);
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items,
      customer_email: customerEmail,
      billing_address_collection: "required",
      shipping_address_collection: { allowed_countries: ["AU"] },
      phone_number_collection: { enabled: true },
      // store_order=1 marks sessions the stripe-webhook should push to the ERP.
      metadata: { store_order: "1", tier },
      success_url: `${base}/checkout-success.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${base}/checkout-cancel.html`
    });
    return json(200, { id: session.id, url: session.url });
  } catch (err) {
    return json(500, { error: err && err.message ? err.message : "Stripe error creating session" });
  }
};
