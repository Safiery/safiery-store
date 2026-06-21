# Safiery Store — B2C + B2B Storefront

A self-contained, Netlify-deployable storefront for the Safiery range (solid-state
lithium, Scotty AI DC-DC, BMG alternators, STAR digital switching, tank monitoring,
induction cooktops, electric hot water and Jupiter packs).

- **B2C** — public retail browsing, search, filtering, cart, Stripe checkout.
- **B2B** — trade login applies the customer's **B2BKing tier discount (10–32%)**
  live across the catalogue, cart and checkout. No build step, no framework.

```
safiery-store/
├── index.html               Home (hero, categories, value props, featured)
├── shop.html                Catalogue with filters / search / sort
├── product.html             Product detail (?id=…) with spec tabs + related
├── cart.html                Cart with B2B pricing + Stripe checkout
├── account.html             Trade login → tier pricing dashboard
├── checkout-success.html    Stripe return (clears cart)
├── checkout-cancel.html     Stripe return
├── data/catalog.js          Curated OVERLAY + offline fallback (categories, specs, badges, featured, docs, ids)
├── data/catalog-merge.js    Pure merge: ERP store-catalog feed → overlaid onto the curated set by wooId
├── assets/css/store.css      Design system (instrument-panel / marine-tech)
├── assets/js/store.js        Engine: ERP catalogue load, pricing, cart, auth, render, Stripe call
├── netlify/functions/create-checkout-session.js   Stripe session (server-priced)
├── netlify/functions/verify-session.js             Confirms payment before clearing cart
├── netlify.toml · package.json · .env.example
```

## Run locally

```bash
cd safiery-store
npm install
cp .env.example .env        # then paste your Stripe TEST secret key
npm run dev                 # netlify dev → http://localhost:8888
```

> **Catalogue source.** Products, prices, stock and photos come live from the ERP
> (Quasar HQ `store-catalog` feed); `data/catalog.js` is the curated overlay (categories,
> specs, badges, featured selection, datasheet docs, `variable`/POA flags) AND the offline
> fallback. The pages fetch the feed at load (`Store.ready()`), overlay it onto the curated
> set by `wooId` (`data/catalog-merge.js`), and fall back to the bundled catalogue if the
> feed is unavailable — so the store always renders, even double-clicked from disk. Note: a
> brand-new product added in Woo appears once it is added to the curated overlay (deliberate
> for a curated storefront). **Stripe checkout** only works under `netlify dev` or a deploy.
>
> Tests: `npm test` (the pure merge). The live ERP path needs the `store-catalog` endpoint
> deployed (Quasar HQ PR) + the store origin in the ERP `CORS_ALLOW_ORIGIN` allowlist.

## Deploy to Netlify

1. Push this folder to a Git repo (or `netlify deploy` from the CLI).
2. In **Site settings → Build & deploy**: publish dir `.`, functions dir `netlify/functions`
   (already set in `netlify.toml`).
3. In **Site settings → Environment variables**, add `STRIPE_SECRET_KEY`.
4. Deploy. Checkout is live.

## B2B pricing

Tiers live in `data/catalog.js → b2bTiers` and mirror the live B2BKing groups:

| Tier | Discount |
|------|----------|
| Trade | 10% |
| Trade Plus | 12% |
| Reseller | 15% |
| Reseller Silver | 20% |
| Reseller Gold | 25% |
| Distributor | 30% |
| OEM / Distributor Plus | 32% |

**Demo trade accounts** (password `safiery2026`) — one per tier, listed on the login
page, e.g. `gold@demo.safiery.com`. Log in and every price flips to your tier rate;
the header turns cyan ("TRADE" mode) and the cart shows your saving.

### Going to production (real auth)

The demo auth is **client-side only** — fine for demonstrating tier pricing, not for
production. To harden it, wire it to your existing **Quasar JWT auth + Neon roster**:

1. Replace `Store.login()` in `assets/js/store.js` with a call to your auth endpoint
   that returns a signed JWT containing the customer's tier.
2. In `netlify/functions/create-checkout-session.js`, replace `tierForEmail()` with
   **JWT verification** and read the tier from the verified token — never from an
   email the client supplies. (Prices are already recomputed server-side, so the
   worst a spoofed email can do today is grant a discount; verifying the JWT closes that.)
3. Optionally pull the catalogue from WooCommerce instead of `catalog.js`.

## Pricing, GST & checkout rules

- All catalogue prices are **AUD, ex-GST** (matching the live Safiery cart). 10% GST is
  added as its own line at checkout, so the Stripe total equals the cart total inc GST
  to the cent (verified across 25k baskets).
- The Stripe function **recomputes every amount from `catalog.js`** — the browser never
  sends prices, and the B2B tier is resolved server-side.
- Checkout is **AU-only** (`shipping_address_collection: ["AU"]`). This is deliberate: the
  hand-rolled 10% GST line would wrongly tax GST-free exports. To sell internationally,
  switch to **Stripe Tax** (`automatic_tax`) so exports are zero-rated, then widen the
  allowed countries.
- **Freight is quoted by sales** (the cart says so) rather than auto-charged — right for
  gear ranging from a $2 button to a $15k under-chassis battery container. To charge
  freight automatically, add Stripe `shipping_options` to the session.
- **Quote-only items** (`variable: true`, e.g. the Scotty upgrade) can't be added to the
  cart or checked out at their floor price — they route to "Request a quote" instead.
- The success page only clears the cart after `verify-session` confirms the Stripe
  payment is `paid` (falls back gracefully in a static preview where the function isn't
  running), so a stray/bookmarked visit never wipes a cart.

## Notes / next steps

- Product imagery is generated on the fly as branded SVG placeholders. Drop real
  photos into `assets/img/` and add an `image` field per product in `catalog.js`
  (the renderer can prefer it over the generated art).
- Some catalogue categories on the live site have a second page of items not captured
  here; add them to `catalog.js` to reach 100% parity.
- "Convert to formal quote" (trade cart) and "Request a quote" (quote-only items) are
  stubbed to a toast — point them at your existing Quasar quote tool endpoint to go
  end-to-end.
