// Run with: npm test   (all data below is made up)
const test = require('node:test');
const assert = require('node:assert');
const planFix = require('../src/plan-fix-archived.js');

const archivedLine = { id: 100, order_id: [1, 'S1'], product_id: [2, 'Amazon Sale'], product_template_id: [2, 'Amazon Sale'],
  name: '[UG-Bane-Vest-XL] Mens Military Vest', amazon_asin: 'B000TEST01', amazon_seller_sku: 'UG-Bane-Vest-XL', price_unit: 105, tax_id: [] };
const otherOrderLine = { id: 200, order_id: [9, 'S9'], product_id: [77, 'Bane Vest (Medium, Faux)'], product_template_id: [15, 'Bane Vest'], amazon_asin: 'B000TEST01' };
const variants = [
  { id: 77, display_name: '[A1] Bane Vest (Medium, Faux)', product_tmpl_id: [15, 'Bane Vest'] },
  { id: 78, display_name: '[A2] Bane Vest (XL, Faux)', product_tmpl_id: [15, 'Bane Vest'] },
];
const order = { id: 1, name: 'S1', has_archived_products: true, note: false };

test('takes the product from another order with the same ASIN and the size from the SKU', () => {
  const [p] = planFix([order], [archivedLine], [2], [otherOrderLine], [77, 78], variants);
  assert.equal(p.fixes.length, 1);
  assert.equal(p.fixes[0].product_id, 78);            // XL from the SKU, not Medium from the other order
  assert.equal(p.fixes[0].price_unit, 105);           // original price kept
  assert.equal(p.note, null);
});

test('no other order with that ASIN -> "Order Not Found"', () => {
  const [p] = planFix([order], [archivedLine], [2], [], [], []);
  assert.equal(p.fails[0].status, 'order_not_found');
  assert.match(p.note, /Order Not Found/);
});

test('size not available for that product -> "Product Not Found"', () => {
  const l = { ...archivedLine, amazon_seller_sku: 'UG-Bane-Vest-3XL' };
  const [p] = planFix([order], [l], [2], [otherOrderLine], [77, 78], variants);
  assert.equal(p.fails[0].status, 'product_not_found');
  assert.match(p.note, /Product Not Found/);
});
