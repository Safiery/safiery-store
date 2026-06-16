/* =============================================================================
 * Netlify Function: stripe-webhook
 * The reliable paid-order capture hook. Stripe calls this on
 * checkout.session.completed; we verify the signature, rebuild the order from the
 * session line items (SKU + ERP id live in product metadata) and customer/shipping
 * details, and POST it to the Quasar ERP (store-order-ingest) which creates the PAID
 * Xero invoice and the order-book row.
 *
 * We return 200 ONLY when the ERP has definitively accepted (or it is a dead-letter
 * we should not retry). Any other failure returns 500 so Stripe retries later; the
 * ERP is idempotent on the Stripe session id, so retries never double-create.
 *
 * Env required:  STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, ERP_BASE_URL, STORE_SHARED_SECRET
 * ========================================================================== */

function splitName(name) {
  const parts = String(name || "").trim().split(/\s+/);
  return { first: parts[0] || "", last: parts.slice(1).join(" ") || "" };
}

// Stripe address {line1,line2,city,state,postal_code,country} -> our wooAddr shape.
function mapAddr(addr, name, email, phone) {
  addr = addr || {};
  const n = splitName(name);
  return {
    first_name: n.first, last_name: n.last, company: "",
    address_1: addr.line1 || "", address_2: addr.line2 || "",
    city: addr.city || "", state: addr.state || "", postcode: addr.postal_code || "",
    country: addr.country || "", phone: phone || "", email: email || ""
  };
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return { statusCode: 405, body: "POST only" };

  const key = process.env.STRIPE_SECRET_KEY;
  const whsec = process.env.STRIPE_WEBHOOK_SECRET;
  if (!key || !whsec) {
    console.error("[stripe-webhook] missing STRIPE_SECRET_KEY or STRIPE_WEBHOOK_SECRET");
    return { statusCode: 500, body: "not configured" };
  }
  const stripe = require("stripe")(key);

  // Verify the signature against the RAW body (never the parsed object).
  const sig = event.headers["stripe-signature"] || event.headers["Stripe-Signature"];
  const raw = event.isBase64Encoded ? Buffer.from(event.body || "", "base64").toString("utf8") : (event.body || "");
  let evt;
  try {
    evt = stripe.webhooks.constructEvent(raw, sig, whsec);
  } catch (err) {
    console.error("[stripe-webhook] signature verification failed:", err && err.message);
    return { statusCode: 400, body: "bad signature" };
  }

  if (evt.type !== "checkout.session.completed") return { statusCode: 200, body: "ignored" };
  const session = evt.data.object;
  if (session.payment_status !== "paid") return { statusCode: 200, body: "not paid" };
  if (!session.metadata || session.metadata.store_order !== "1") return { statusCode: 200, body: "not a store order" };

  try {
    // Rebuild the order lines from the session (SKU + woo id are on product.metadata).
    const li = await stripe.checkout.sessions.listLineItems(session.id, { expand: ["data.price.product"], limit: 100 });
    const lines = [];
    for (const item of (li.data || [])) {
      const product = item.price && item.price.product;
      const meta = (product && product.metadata) || {};
      if (meta.gst === "1") continue;                       // skip the synthetic GST line
      const unitExGst = (item.price && item.price.unit_amount != null) ? item.price.unit_amount / 100 : 0;
      lines.push({
        sku: meta.sku || "",
        wooId: meta.wooId || null,
        description: (product && product.name) || meta.sku || "Item",
        qty: item.quantity || 1,
        unitPriceExGst: Math.round(unitExGst * 100) / 100
      });
    }
    if (!lines.length) { console.warn("[stripe-webhook] no product lines for session", session.id); return { statusCode: 200, body: "no lines" }; }

    const cd = session.customer_details || {};
    const ship = (session.collected_information && session.collected_information.shipping_details) || session.shipping_details || null;
    const order = {
      stripeSessionId: session.id,
      paymentRef: typeof session.payment_intent === "string" ? session.payment_intent : (session.payment_intent && session.payment_intent.id) || session.id,
      email: cd.email || "",
      name: (ship && ship.name) || cd.name || "",
      phone: cd.phone || "",
      currency: (session.currency || "aud").toUpperCase(),
      amountTotal: (session.amount_total || 0) / 100,
      paidAt: new Date((session.created || Math.floor(Date.now() / 1000)) * 1000).toISOString(),
      billing: mapAddr(cd.address, cd.name, cd.email, cd.phone),
      shipping: ship ? mapAddr(ship.address, ship.name, cd.email, cd.phone) : mapAddr(cd.address, cd.name, cd.email, cd.phone),
      lines
    };

    const base = (process.env.ERP_BASE_URL || "").replace(/\/+$/, "");
    const secret = process.env.STORE_SHARED_SECRET || "";
    if (!base || !secret) { console.error("[stripe-webhook] ERP_BASE_URL/STORE_SHARED_SECRET not set"); return { statusCode: 500, body: "erp not configured" }; }

    const res = await fetch(base + "/.netlify/functions/store-order-ingest", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Store-Secret": secret },
      body: JSON.stringify(order)
    });
    let body = null; try { body = await res.json(); } catch (e) { body = null; }

    if (res.ok && body && (body.ok || body.alreadyDone)) {
      if (body.dryRun) console.warn("[stripe-webhook] ERP in DRY-RUN; order acknowledged but NOT ingested (set XERO_PUSH_ENABLED) for session", session.id);
      return { statusCode: 200, body: JSON.stringify({ received: true, ingested: !body.dryRun }) };
    }
    if (res.ok && body && body.deadLetter) {
      // A deterministic problem (e.g. total mismatch) the ERP has logged for review;
      // retrying will not help, so acknowledge to stop Stripe re-sending.
      console.error("[stripe-webhook] ERP dead-letter for session", session.id, ":", body.code || body.error);
      return { statusCode: 200, body: JSON.stringify({ received: true, deadLetter: true }) };
    }
    // Anything else (config missing, 5xx, network): let Stripe retry later.
    console.error("[stripe-webhook] ERP did not accept session", session.id, "status", res.status, body && (body.code || body.error));
    return { statusCode: 500, body: "erp not accepted, will retry" };
  } catch (err) {
    console.error("[stripe-webhook] error for session", session.id, ":", err && err.message);
    return { statusCode: 500, body: "error, will retry" };
  }
};
