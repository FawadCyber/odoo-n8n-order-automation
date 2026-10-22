// Run with: npm test   (uses Node's built-in test runner, no dependencies)
// All data below is made up.
const test = require('node:test');
const assert = require('node:assert');
const planOrders = require('../src/plan-orders.js');

const stockCols = { product: 'Products', size: 'Size', mat: 'Material', status: 'Status', dispatchId: 'Dispatch ID', dispatchDate: 'Dispatch Date' };
const returnCols = { ...stockCols, dispatchId: 'Remarks', oldId: 'Return ID' };

const row = (n, product, size, mat, status, extra = {}) => ({ row_number: n, Products: product, Size: size, Material: mat, Status: status, SKU: `${product}-${mat}-${size}`, 'Box #': 'Box # 7', ...extra });
const order = (id, name, extra = {}) => ({ id, name, x_studio_country: 'United States', create_date: `2026-10-20 0${id % 10}:00:00`, note: false, ...extra });
const line = (orderId, tmpl, size, mat, extra = {}) => ({ order_id: [orderId, 'x'], product_id: [orderId * 10, tmpl], product_template_id: [orderId * 10, tmpl],
  variant_size_value: size, variant_material_value: mat, product_uom_qty: 1, ...extra });

function sources(main, ret = []) {
  return [
    { key: 'MAIN', route: 'main_row', rows: main, label: 'Main', warehouseId: 1, kind: 'stock', cols: stockCols },
    { key: 'RETURN', route: 'return_row', rows: ret, label: 'Returns', warehouseId: 2, kind: 'return', cols: returnCols },
  ];
}
const cfg = { today: '10/22/2026' };

test('matches product + size + material and marks the sheet row', () => {
  const out = planOrders([order(1, 'S1')], [line(1, 'Bane Vest', 'Medium', 'Faux')], sources([row(5, 'Bane Vest', 'M', 'Faux', 'In')]), cfg);
  const ship = out.find(o => o.route === 'ship');
  assert.equal(ship.warehouse_id, 1);
  assert.equal(ship.us_wh_sku, 'Shipped From Main 10/22/2026 Bane Vest-Faux-M Box # 7');
  assert.deepEqual(out.find(o => o.route === 'main_row'), { route: 'main_row', order_id: 1, order_name: 'S1', items: 'Bane Vest / Medium / Faux', row_number: 5, dispatch_id: 'S1', dispatch_date: '10/22/2026' });
});

test('rows that are already Out are never used', () => {
  const out = planOrders([order(1, 'S1')], [line(1, 'Bane Vest', 'Medium', 'Faux')], sources([row(5, 'Bane Vest', 'M', 'Faux', 'Out')]), cfg);
  assert.equal(out[0].route, 'not_available');
});

test('material must match (Faux order does not take a Leather row)', () => {
  const out = planOrders([order(1, 'S1')], [line(1, 'Buffy Coat', 'XL', 'Faux')], sources([row(5, 'Buffy Coat', 'XL', 'Leather', 'In')]), cfg);
  assert.equal(out[0].route, 'not_available');
});

test('falls back to the return sheet and writes OLD ID', () => {
  const out = planOrders([order(1, 'S1')], [line(1, 'Tom Hardy', '3XL', 'Faux')], sources([], [row(9, 'Tom Hardy', '3XL', 'Faux', 'In', { 'Return ID': 'S11786' })]), cfg);
  const ship = out.find(o => o.route === 'ship');
  assert.equal(ship.warehouse_id, 2);
  assert.equal(ship.us_wh_sku, 'Shipped From Returns 10/22/2026 OLD ID S11786');
});

test('oldest order gets the only unit in stock', () => {
  const orders = [order(2, 'S2', { create_date: '2026-10-21 10:00:00' }), order(1, 'S1', { create_date: '2026-10-20 10:00:00' })];
  const lines = [line(1, 'Bane Vest', 'Medium', 'Faux'), line(2, 'Bane Vest', 'Medium', 'Faux')];
  const out = planOrders(orders, lines, sources([row(5, 'Bane Vest', 'M', 'Faux', 'In')]), cfg);
  assert.equal(out.find(o => o.route === 'ship').order_name, 'S1');
  assert.equal(out.find(o => o.order_name === 'S2').route, 'not_available');
});

test('re-running reuses rows already dispatched to the same order', () => {
  const r = row(5, 'Bane Vest', 'M', 'Faux', 'Out', { 'Dispatch ID': 'S1', 'Dispatch Date': new Date().toLocaleDateString('en-US') });
  const out = planOrders([order(1, 'S1')], [line(1, 'Bane Vest', 'Medium', 'Faux')], sources([r]), cfg);
  assert.ok(out.find(o => o.route === 'ship'));
  assert.equal(out.filter(o => o.route === 'main_row').length, 0, 'row is not written twice');
});

test('orders with archived products are skipped', () => {
  const out = planOrders([order(1, 'S1', { has_archived_products: true })], [line(1, 'Bane Vest', 'Medium', 'Faux')], sources([row(5, 'Bane Vest', 'M', 'Faux', 'In')]), cfg);
  assert.equal(out[0].route, 'skip');
});

test('remark is added once; confirm only on the 10 AM run', () => {
  const o = order(1, 'S1', { note: '<p>Warehouse Not Available</p>' });
  const normal = planOrders([o], [line(1, 'X', 'M', 'Faux')], sources([]), cfg);
  assert.deepEqual(normal.map(x => x.route), ['skip']);
  const tenAm = planOrders([o], [line(1, 'X', 'M', 'Faux')], sources([]), { ...cfg, confirmNotAvailable: true });
  assert.deepEqual(tenAm.map(x => x.route), ['skip', 'confirm_not_available']);
});
