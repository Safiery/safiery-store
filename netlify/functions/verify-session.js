/* =============================================================================
 * Netlify Function: verify-session
 * Confirms a Stripe Checkout Session actually paid before the front-end clears
 * the cart. Prevents the success page from wiping a cart on a stray/bookmarked
 * visit or an abandoned payment.
 *   GET /.netlify/functions/verify-session?session_id=cs_...
 * ========================================================================== */
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS"
};
const json = (statusCode, body) => ({ statusCode, headers: { ...CORS, "Content-Type": "application/json" }, body: JSON.stringify(body) });

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: CORS, body: "" };

  const key = process.env.STRIPE_SECRET_KEY;
  const sid = event.queryStringParameters && event.queryStringParameters.session_id;
  if (!sid) return json(400, { error: "Missing session_id" });
  if (!key) return json(400, { error: "Stripe not configured" });

  try {
    const stripe = require("stripe")(key);
    const s = await stripe.checkout.sessions.retrieve(sid);
    return json(200, {
      paid: s.payment_status === "paid",
      payment_status: s.payment_status,
      amount_total: s.amount_total,
      currency: s.currency
    });
  } catch (err) {
    return json(404, { error: err && err.message ? err.message : "Session not found" });
  }
};
