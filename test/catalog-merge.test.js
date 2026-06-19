'use strict';

// Pure merge of the ERP store-catalog feed onto the curated static catalogue
// (data/catalog-merge.js). DB/network-free. Guards Approach A: the static catalogue
// owns the set/ids/categories/specs/badges/featured/variable; the ERP feed overlays the
// live {name, price, stock, images, short, desc} by wooId. The ERP path itself cannot be
// e2e-tested here (the store-catalog endpoint is not deployed yet) - this pins the merge.

const test = require('node:test');
const assert = require('node:assert/strict');

const MERGE = require('../data/catalog-merge.js');

test('normWooId: accepts woo:<id>, number, string; rejects blank', () => {
  assert.equal(MERGE.normWooId('woo:60981'), '60981');
  assert.equal(MERGE.normWooId(60981), '60981');
  assert.equal(MERGE.normWooId('60981'), '60981');
  assert.equal(MERGE.normWooId(null), null);
  assert.equal(MERGE.normWooId(''), null);
  assert.equal(MERGE.normWooId('woo:'), null);
});

test('wooIndex: indexes feed products by normalised wooId, first wins', () => {
  const by = MERGE.wooIndex({ products: [
    { wooId: 60981, name: 'A' }, { wooId: 76844, name: 'B' }, { wooId: 60981, name: 'dupe' }
  ] });
  assert.equal(by['60981'].name, 'A');
  assert.equal(by['76844'].name, 'B');
  assert.deepEqual(MERGE.wooIndex(null), {});
  assert.deepEqual(MERGE.wooIndex({}), {});
});

function staticSet() {
  return [
    { id: 'ss-12v-217', sku: 'SS-12V-217', name: 'Static name', price: 2440, cats: ['12v-lithium'],
      featured: true, stock: 'in_stock', badges: ['217Ah'], specs: { V: '12V' }, short: 'static short', desc: 'static desc' },
    { id: 'tie-down', sku: 'STRAP-TIEDOWN', name: 'Tie Down', price: 132, cats: ['12v-lithium'], stock: 'in_stock' },
    { id: 'scotty-upgrade', sku: 'SCOTTY-UP', name: 'Scotty Upgrade', price: 500, cats: ['scotty'], variable: true, stock: 'made_to_order' },
    { id: 'orphan', sku: 'ORPH', name: 'No link product', price: 99, cats: ['accessories'], stock: 'in_stock' }
  ];
}
const LINKS = {
  'ss-12v-217': { wooId: 'woo:60981' },
  'tie-down': { wooId: 'woo:76844' },
  'scotty-upgrade': { wooId: 'woo:70000' }
  // 'orphan' intentionally has no link
};

test('mergeCatalog: overlays ERP live fields, keeps curated fields + set shape', () => {
  const feed = { ok: true, products: [
    { wooId: 60981, name: 'ERP 12V 217Ah', price: 2500, stock: 'out_of_stock',
      images: [{ src: 'https://safiery.com/a.jpg', alt: 'a' }], short: 'erp short', desc: 'erp desc' },
    { wooId: 76844, name: 'ERP Tie Down', price: 0 }   // $0/POA price must NOT override
  ] };
  const out = MERGE.mergeCatalog(staticSet(), feed, LINKS);
  assert.equal(out.length, 4, 'set count + order preserved');

  const ss = out[0];
  assert.equal(ss.id, 'ss-12v-217', 'id is curated/stable');
  assert.equal(ss.name, 'ERP 12V 217Ah', 'name from ERP');
  assert.equal(ss.price, 2500, 'price from ERP');
  assert.equal(ss.stock, 'out_of_stock', 'stock from ERP');
  assert.equal(ss.images[0].src, 'https://safiery.com/a.jpg', 'photo from ERP');
  assert.equal(ss.short, 'erp short');
  assert.equal(ss.desc, 'erp desc');
  assert.deepEqual(ss.cats, ['12v-lithium'], 'categories stay curated');
  assert.deepEqual(ss.badges, ['217Ah'], 'badges stay curated');
  assert.deepEqual(ss.specs, { V: '12V' }, 'specs stay curated');
  assert.equal(ss.featured, true, 'featured stays curated');
  assert.equal(ss.fromErp, true, 'provenance flag set');

  const tie = out[1];
  assert.equal(tie.name, 'ERP Tie Down', 'name still overlaid');
  assert.equal(tie.price, 132, '$0 ERP price did NOT clobber the static price');
});

test('mergeCatalog: unmatched + variable products keep their static data', () => {
  const feed = { ok: true, products: [] };   // empty feed
  const out = MERGE.mergeCatalog(staticSet(), feed, LINKS);
  // variable/POA product: untouched, flag preserved
  const scotty = out.find((p) => p.id === 'scotty-upgrade');
  assert.equal(scotty.variable, true);
  assert.equal(scotty.price, 500);
  assert.equal(scotty.fromErp, undefined, 'no ERP match -> not flagged');
  // product with no link: untouched
  const orphan = out.find((p) => p.id === 'orphan');
  assert.equal(orphan.price, 99);
  assert.equal(orphan.name, 'No link product');
});

test('mergeCatalog: missing/failed feed degrades to the static catalogue unchanged', () => {
  for (const bad of [null, undefined, {}, { ok: false }, { products: null }]) {
    const out = MERGE.mergeCatalog(staticSet(), bad, LINKS);
    assert.equal(out.length, 4);
    assert.equal(out[0].name, 'Static name');
    assert.equal(out[0].price, 2440);
  }
});

test('mergeCatalog: does not mutate the input static products', () => {
  const set = staticSet();
  const before = JSON.stringify(set);
  MERGE.mergeCatalog(set, { ok: true, products: [{ wooId: 60981, name: 'X', price: 1 }] }, LINKS);
  assert.equal(JSON.stringify(set), before, 'static products untouched (overlay returns new objects)');
});

// Integration: the REAL bundled catalogue + links normalise against a numeric feed wooId.
test('mergeCatalog: real catalog.js + catalog-links.js join a numeric feed wooId', () => {
  const CATALOG = require('../data/catalog.js');
  const LINKS_REAL = require('../data/catalog-links.js').links || {};
  // Pick a real linked product and build a one-item feed from its numeric wooId.
  const entry = Object.keys(LINKS_REAL).find((id) => LINKS_REAL[id] && LINKS_REAL[id].wooId);
  assert.ok(entry, 'expected at least one linked product');
  const wid = MERGE.normWooId(LINKS_REAL[entry].wooId);
  const feed = { ok: true, products: [{ wooId: Number(wid), name: 'FEED NAME', price: 1234,
    images: [{ src: 'https://safiery.com/x.jpg', alt: '' }] }] };
  const out = MERGE.mergeCatalog(CATALOG.products, feed, LINKS_REAL);
  const merged = out.find((p) => p.id === entry);
  assert.equal(merged.name, 'FEED NAME', 'real link "woo:<id>" matched the numeric feed wooId');
  assert.equal(merged.price, 1234);
  assert.equal(merged.images[0].src, 'https://safiery.com/x.jpg');
});
