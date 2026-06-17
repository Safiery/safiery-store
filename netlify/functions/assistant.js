/* =============================================================================
 * Netlify Function: assistant
 * The Safiery store AI assistant: product Q&A grounded in the catalog + manuals,
 * with a capture_lead tool that files an enquiry into the Quasar ERP (a contact +
 * a 'sales' request). Stateless: the client sends the running conversation each turn.
 *
 * Guardrails (the Anthropic key is a cost/DoS vector):
 *   - per-IP sliding-window rate limit (best-effort, in-instance) + a global cap
 *   - hard caps on message count, message length, and max output tokens
 *   - bounded tool rounds
 *
 * Env required:  ANTHROPIC_API_KEY
 * Env for leads: ERP_BASE_URL, STORE_SHARED_SECRET
 * Env optional:  STORE_ASSISTANT_MODEL
 * ========================================================================== */
const CATALOG = require("../../data/catalog.js");

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};
const json = (statusCode, body) => ({ statusCode, headers: { ...CORS, "Content-Type": "application/json" }, body: JSON.stringify(body) });

const MODEL = process.env.STORE_ASSISTANT_MODEL || "claude-sonnet-4-6";
const MAX_TOKENS = 700;
const MAX_MSGS = 16;          // last N turns the client may send
const MAX_LEN = 4000;         // per-message char cap
const MAX_TOOL_ROUNDS = 2;

/* --- best-effort per-IP rate limit (per warm instance; bursts reuse an instance) --- */
const HITS = new Map();       // ip -> [timestamps]
const WINDOW_MS = 10 * 60 * 1000;
const PER_IP = 25;            // messages / 10 min / ip
function rateLimited(ip) {
  const now = Date.now();
  const arr = (HITS.get(ip) || []).filter((t) => now - t < WINDOW_MS);
  if (arr.length >= PER_IP) { HITS.set(ip, arr); return true; }
  arr.push(now); HITS.set(ip, arr);
  if (HITS.size > 5000) HITS.clear();   // crude memory cap
  return false;
}

/* --- catalog grounding context (built once per instance) --- */
// Store-hosted PDFs live at /assets/docs/<file>; some docs may instead carry a full `url`.
const DOCS_BASE = "https://safiery-store.netlify.app/assets/docs/";
function docUrl(d) {
  if (!d) return "";
  if (d.url) return d.url;                // full/external URL wins (future-proof)
  if (d.file) return DOCS_BASE + d.file;  // store-hosted PDF in /assets/docs/
  return "";
}
function buildContext() {
  const gst = CATALOG.gstRate || 0.1;
  const catName = {};
  (CATALOG.categories || []).forEach((c) => { catName[c.id] = c.name; });
  const lines = (CATALOG.products || []).map((p) => {
    const inc = Math.round(p.price * (1 + gst) * 100) / 100;
    const cat = catName[(p.cats || [])[0]] || "";
    const badges = (p.badges || []).length ? " [" + p.badges.join(", ") + "]" : "";
    const price = p.variable ? ("from $" + p.price + " ex GST (quote-only)") : ("$" + p.price + " ex GST / $" + inc + " inc");
    let line = "- " + p.name + " (" + cat + ", SKU " + (p.sku || p.id) + "): " + price + badges + (p.short ? " - " + p.short : "");
    // Fuller technical grounding where the catalog has it (only some products carry desc/specs/docs).
    if (p.desc && p.desc !== p.short) line += "\n    " + String(p.desc).replace(/\s+/g, " ").trim();
    if (p.specs && typeof p.specs === "object") {
      const specs = Object.keys(p.specs).map((k) => k + ": " + p.specs[k]).join("; ");
      if (specs) line += "\n    Specs: " + specs;
    }
    const pdocs = (p.docs || []).map((d) => (d && d.title) ? (d.title + " (" + docUrl(d) + ")") : "").filter(Boolean);
    if (pdocs.length) line += "\n    Docs: " + pdocs.join("; ");
    return line;
  });
  // Unique manuals/datasheets across the catalog (title -> url). Data carries `file` (not `url`);
  // docUrl() resolves both, so these actually surface now (previously the d.url check left this empty).
  const docs = {};
  (CATALOG.products || []).forEach((p) => (p.docs || []).forEach((d) => { const u = docUrl(d); if (u) docs[(d && d.title) || u] = u; }));
  const docLines = Object.keys(docs).map((t) => "- " + t + ": " + docs[t]);
  return { lines: lines.join("\n"), docLines: docLines.join("\n"), count: lines.length };
}
let CTX = null;
function ctx() { if (!CTX) CTX = buildContext(); return CTX; }

/* --- shared manuals registry from the ERP (#1b): the SAME merged set the email-agent
   Outbox uses (ERP reference pages + the store PDFs), served by the store-documents
   endpoint. Cached per warm instance; falls back to the catalog-derived list if the ERP
   is unreachable, so manuals never disappear. --- */
const ERP_BASE = (process.env.ERP_BASE_URL || "").replace(/\/+$/, "");
const STORE_SECRET = process.env.STORE_SHARED_SECRET || "";
let SHARED_DOCS; // undefined = not tried yet; string = lines; null = tried and failed
async function sharedDocLines() {
  if (SHARED_DOCS !== undefined) return SHARED_DOCS;
  SHARED_DOCS = null;
  if (!ERP_BASE || !STORE_SECRET) return SHARED_DOCS;
  try {
    const res = await fetch(ERP_BASE + "/.netlify/functions/store-documents", { headers: { "X-Store-Secret": STORE_SECRET } });
    const j = await res.json().catch(() => null);
    if (res.ok && j && Array.isArray(j.documents) && j.documents.length) {
      SHARED_DOCS = j.documents.map((d) => "- " + d.title + ": " + d.url).join("\n");
    }
  } catch (_) { /* keep null -> catalog fallback */ }
  return SHARED_DOCS;
}

function systemPrompt(manualsOverride) {
  const c = ctx();
  return [
    "You are the Safiery store assistant on safiery-store.netlify.app. Safiery makes marine and off-grid (4WD, caravan, marine) power, energy and digital-switching products so people travel without a generator.",
    "Help shoppers understand products and choose what fits. Be concise, friendly and practical. Prices are in Australian dollars (AUD); the store ships within Australia.",
    "GROUND YOUR ANSWERS in the catalog and manuals below. Do NOT invent prices, specs, model numbers or availability. If something is not in the data, say you are not certain and offer to connect them with the Safiery team.",
    "When a shopper wants a quote, wants to be contacted, asks something you cannot fully answer, or has a non-trivial system-design question, offer to pass it to sales and use the capture_lead tool once you have at least their email and a short summary of what they want. Confirm before capturing.",
    "Never promise warranty terms, lead times, custom discounts or stock guarantees - say the team will confirm. Trade/B2B customers get their pricing automatically once signed in on the account page.",
    "",
    "CATALOG (" + c.count + " products):",
    c.lines,
    "",
    "MANUALS & DATASHEETS (link these when relevant):",
    (manualsOverride || c.docLines) || "(none listed)",
    "",
    "Contact: sales@safiery.com, +61 (07) 210 22 55 3, 45/8 Distribution Court, Arundel QLD 4214."
  ].join("\n");
}

const LEAD_TOOL = {
  name: "capture_lead",
  description: "Record the shopper's contact details and enquiry so the Safiery sales team can follow up. Use only after the shopper agrees and you have at least their email and a short message. Returns confirmation.",
  input_schema: {
    type: "object",
    properties: {
      name: { type: "string", description: "Shopper's name" },
      email: { type: "string", description: "Shopper's email (required)" },
      phone: { type: "string" },
      company: { type: "string" },
      message: { type: "string", description: "What they want / their question (required)" },
      productInterest: { type: "string", description: "Product(s) or category they are interested in" }
    },
    required: ["email", "message"]
  }
};

async function callClaude(apiKey, messages, manualsLines) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model: MODEL, max_tokens: MAX_TOKENS, system: systemPrompt(manualsLines), tools: [LEAD_TOOL], messages })
  });
  const text = await res.text();
  let parsed; try { parsed = JSON.parse(text); } catch (e) { throw new Error("Anthropic returned non-JSON"); }
  if (!res.ok) throw new Error("AI: " + ((parsed && parsed.error && parsed.error.message) || ("HTTP " + res.status)));
  return parsed;
}

async function captureLead(input, page) {
  const base = (process.env.ERP_BASE_URL || "").replace(/\/+$/, "");
  const secret = process.env.STORE_SHARED_SECRET || "";
  if (!base || !secret) return { ok: false, error: "lead system not configured; ask them to email sales@safiery.com" };
  try {
    const res = await fetch(base + "/.netlify/functions/store-lead", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Store-Secret": secret },
      body: JSON.stringify({
        name: input.name || "", email: input.email || "", phone: input.phone || "",
        company: input.company || "", message: input.message || "",
        productInterest: input.productInterest || "", page: page || "", source: "store-bot"
      })
    });
    const j = await res.json().catch(() => null);
    if (res.ok && j && j.ok) return { ok: true, requestId: j.requestId };
    return { ok: false, error: (j && j.error) || ("HTTP " + res.status) };
  } catch (e) { return { ok: false, error: String((e && e.message) || e) }; }
}

function sanitizeMessages(raw) {
  if (!Array.isArray(raw)) return [];
  const out = raw.slice(-MAX_MSGS).map((m) => {
    const role = m.role === "assistant" ? "assistant" : "user";
    // Only accept plain-text turns from the client; tool blocks are added server-side.
    const content = typeof m.content === "string" ? m.content.slice(0, MAX_LEN) : "";
    return { role, content };
  }).filter((m) => m.content);
  // The Anthropic API requires the first message to be from the user.
  while (out.length && out[0].role === "assistant") out.shift();
  return out;
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: CORS, body: "" };
  if (event.httpMethod !== "POST") return json(405, { error: "POST only" });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return json(200, { reply: "The assistant is not configured yet. Please email sales@safiery.com and we'll help right away.", leadCaptured: false });

  const ip = (event.headers["x-nf-client-connection-ip"] || (event.headers["x-forwarded-for"] || "").split(",")[0] || "unknown").trim();
  if (rateLimited(ip)) return json(429, { reply: "You've sent a lot of messages in a short time. Please pause a moment, or email sales@safiery.com.", leadCaptured: false });

  let payload; try { payload = JSON.parse(event.body || "{}"); } catch (e) { return json(400, { error: "bad request" }); }
  const messages = sanitizeMessages(payload.messages);
  if (!messages.length) return json(400, { error: "no messages" });
  const page = typeof payload.page === "string" ? payload.page.slice(0, 200) : "";
  const manualsLines = await sharedDocLines();

  try {
    let leadCaptured = false;
    let rounds = 0;
    let resp = await callClaude(apiKey, messages, manualsLines);

    while (resp.stop_reason === "tool_use" && rounds < MAX_TOOL_ROUNDS) {
      rounds++;
      const toolUses = (resp.content || []).filter((b) => b.type === "tool_use");
      messages.push({ role: "assistant", content: resp.content });
      const results = [];
      for (const tu of toolUses) {
        if (tu.name === "capture_lead") {
          const r = await captureLead(tu.input || {}, page);
          if (r.ok) leadCaptured = true;
          results.push({ type: "tool_result", tool_use_id: tu.id, content: r.ok ? "Lead captured - the Safiery team will follow up." : ("Could not capture the lead: " + r.error) });
        } else {
          results.push({ type: "tool_result", tool_use_id: tu.id, content: "Unknown tool", is_error: true });
        }
      }
      messages.push({ role: "user", content: results });
      resp = await callClaude(apiKey, messages, manualsLines);
    }

    const textBlock = (resp.content || []).find((b) => b.type === "text");
    const reply = textBlock ? textBlock.text.trim() : "Sorry, I didn't catch that - could you rephrase?";
    return json(200, { reply, leadCaptured });
  } catch (err) {
    console.error("[assistant] error:", err && err.message);
    return json(200, { reply: "Sorry, I'm having trouble right now. Please email sales@safiery.com and we'll help.", leadCaptured: false });
  }
};
