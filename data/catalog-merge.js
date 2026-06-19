/* =============================================================================
 * Safiery Store - catalogue merge (UMD)
 *
 * Approach A: the storefront catalogue, product data, pricing and photos come from
 * the ERP (Quasar HQ `store-catalog` feed), while the curated storefront is kept as a
 * thin local OVERLAY. The static `data/catalog.js` defines the SET, the stable product
 * `id`, the 11 curated categories, and the curated extras Woo does not hold (specs,
 * badges, featured selection, datasheet docs, the `variable`/POA flag). The ERP feed,
 * matched by `wooId`, overlays the LIVE fields: { name, price, stock, images, short, desc }.
 *
 * Pure + side-effect free so the same logic runs in three places: the browser
 * (store.js), the checkout function (server-side retail price, so displayed == charged),
 * and the unit tests. UMD: sets window.SAFIERY_CATALOG_MERGE in a browser; module.exports
 * under Node/require().
 * ========================================================================== */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.SAFIERY_CATALOG_MERGE = factory();
}(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // Normalise any wooId form to a bare digit string for matching.
  //   "woo:60981" | 60981 | "60981" -> "60981"   |   null/blank -> null
  function normWooId(v) {
    if (v == null) return null;
    var m = String(v).match(/(\d+)/);
    return m ? m[1] : null;
  }

  // Index an ERP feed ({ products: [{ wooId, ... }] }) by normalised wooId.
  function wooIndex(feed) {
    var by = {};
    var items = (feed && Array.isArray(feed.products)) ? feed.products : [];
    for (var i = 0; i < items.length; i++) {
      var id = normWooId(items[i] && items[i].wooId);
      if (id && !by[id]) by[id] = items[i];
    }
    return by;
  }

  // Overlay one ERP feed product (fp) onto one static product (sp). Returns a NEW
  // object; the static product is never mutated. With no feed match, returns sp as-is.
  function overlay(sp, fp) {
    if (!fp) return sp;
    var m = {};
    for (var k in sp) if (Object.prototype.hasOwnProperty.call(sp, k)) m[k] = sp[k];
    if (fp.name) m.name = fp.name;
    // Never let a $0 / POA feed price blank a real static price (the ERP feed already
    // drops $0 items, but guard anyway so variable/POA products keep their starting price).
    if (fp.price != null && +fp.price > 0) m.price = +fp.price;
    if (fp.stock) m.stock = fp.stock;
    if (Array.isArray(fp.images) && fp.images.length) m.images = fp.images;
    if (fp.short) m.short = fp.short;
    if (fp.desc) m.desc = fp.desc;
    if (fp.wooId != null) m.wooId = fp.wooId;
    m.fromErp = true;             // provenance flag (handy for debugging / UI badges)
    return m;
  }

  // Merge the full static set against an ERP feed. `links` maps a static product id to
  // its ERP catalog link ({ wooId }); when absent we also try the product's own wooId.
  // Order, ids, count and every curated field are preserved - only the live fields move.
  function mergeCatalog(staticProducts, feed, links) {
    var by = wooIndex(feed);
    links = links || {};
    return (staticProducts || []).map(function (sp) {
      var link = links[sp.id];
      var wid = link ? normWooId(link.wooId) : normWooId(sp.wooId);
      var fp = wid ? by[wid] : null;
      return overlay(sp, fp);
    });
  }

  return {
    normWooId: normWooId,
    wooIndex: wooIndex,
    overlay: overlay,
    mergeCatalog: mergeCatalog
  };
}));
