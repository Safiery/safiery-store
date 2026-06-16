/* =============================================================================
 * Netlify Function: create-checkout-session
 * Creates a Stripe Checkout Session. Prices are recomputed HERE from the same
 * catalog the front-end uses, so the client can never dictate the amount.
 * The B2B tier is resolved from the (demo) account on the server too.
 *
 * Env required:  STRIPE_SECRET_KEY   (sk_test_… or sk_live_…)
 * Env optional:  URL                 (Netlify sets this automatically)
 * ========================================================================== */
const CATALOG = require("../../data/catalog.js");

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};
const json = (statusCode, body) => ({ statusCode, headers: { ...CORS, "Content-Type": "application/json" }, body: JSON.stringify(body) });

const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
const cents = (n) => Math.round(n * 100);

function tierForEmail(email) {
  if (!email) return null;
  const acct = CATALOG.demoAccounts.find((a) => a.email.toLowerCase() === String(email).toLowerCase());
  if (!acct) return null;
  return CATALOG.b2bTiers.find((t) => t.id === acct.tier) || null;
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: CORS, body: "" };
  if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed" });

  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    return json(400, { error: "Stripe is not configured. Set STRIPE_SECRET_KEY in your Netlify environment (Site settings → Environment variables)." });
  }

  let payload;
  try { payload = JSON.parse(event.body || "{}"); }
  catch (e) { return json(400, { error: "Invalid request body" }); }

  const requested = Array.isArray(payload.items) ? payload.items : [];
  if (!requested.length) return json(400, { error: "Cart is empty" });

  const tier = tierForEmail(payload.accountEmail);
  const discount = tier ? tier.discount : 0;

  // Build authoritative line items (ex-GST) from the trusted catalog.
  const productIndex = {};
  CATALOG.products.forEach((p) => { productIndex[p.id] = p; });

  let subtotalExGst = 0;
  const line_items = [];
  for (const row of requested) {
    const p = productIndex[row.id];
    const qty = Math.max(1, Math.min(999, parseInt(row.qty, 10) || 1));
    if (!p) continue;          // silently drop unknown ids — never trust client prices
    if (p.variable) continue;  // quote-only items can't be transacted at the floor price
    const unitExGst = round2(p.price * (1 - discount));
    subtotalExGst += unitExGst * qty;
    line_items.push({
      quantity: qty,
      price_data: {
        currency: (CATALOG.currency || "AUD").toLowerCase(),
        unit_amount: cents(unitExGst),
        product_data: {
          name: p.name,
          metadata: { sku: p.sku || p.id, tier: tier ? tier.id : "retail" }
        }
      }
    });
  }
  if (!line_items.length) return json(400, { error: "No valid items in cart" });

  // GST as its own line so the Stripe total exactly matches the cart (inc GST).
  // Round the subtotal first so the GST base is identical to the client's (avoids 1c drift).
  const gst = round2(round2(subtotalExGst) * (CATALOG.gstRate || 0.1));
  line_items.push({
    quantity: 1,
    price_data: {
      currency: (CATALOG.currency || "AUD").toLowerCase(),
      unit_amount: cents(gst),
      product_data: { name: `GST (${Math.round((CATALOG.gstRate || 0.1) * 100)}%)` }
    }
  });

  const base =
    process.env.URL ||
    process.env.DEPLOY_PRIME_URL ||
    (event.headers && event.headers.host ? `https://${event.headers.host}` : "");
  if (!base) return json(500, { error: "Site URL not configured (set the URL environment variable)." });

  // Only pass a syntactically valid email to Stripe — a malformed one would make the session throw.
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
      metadata: { tier: tier ? tier.id : "retail", trade_discount: String(discount) },
      success_url: `${base}/checkout-success.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${base}/checkout-cancel.html`
    });
    return json(200, { id: session.id, url: session.url });
  } catch (err) {
    return json(500, { error: err && err.message ? err.message : "Stripe error creating session" });
  }
};
