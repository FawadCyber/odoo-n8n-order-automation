// ===== Plan: decide warehouse per order =====
// sources (priority order): Ameri Stock, Shipster Stock, Ameeri Return, Shipster Return, Faisal Return
// each source: { key, route, rows, cols:{product,size,mat,status,dispatchId,dispatchDate,oldId?}, label, warehouseId, kind:'stock'|'return' }
function planOrders(orders, lines, sources, cfg) {
  const norm = s => String(s ?? '').replace(/^\s*\[[^\]]*\]\s*/, '').toLowerCase().replace(/\s+/g, ' ').trim();
  const SIZE = { 'xxs':'XXS','xx-small':'XXS','xs':'XS','x-small':'XS','extra small':'XS','s':'S','small':'S','m':'M','medium':'M','l':'L','large':'L',
    'xl':'XL','x-large':'XL','extra large':'XL','xxl':'2XL','2xl':'2XL','xx-large':'2XL','xxxl':'3XL','3xl':'3XL','xxx-large':'3XL',
    '4xl':'4XL','xxxxl':'4XL','5xl':'5XL','6xl':'6XL' };
  const normSize = s => { const k = String(s ?? '').toLowerCase().replace(/\s+/g, ' ').trim(); return SIZE[k] || k.toUpperCase(); };
  const normMat = s => String(s ?? '').toLowerCase().replace(/laether/g, 'leather').replace(/[^a-z]/g, '').replace(/^cotto$/, 'cotton');
  const matOk = (a, b) => { a = normMat(a); b = normMat(b); return !a || !b || a === b || a.includes(b) || b.includes(a); };
  const parenParts = name => { const m = String(name || '').match(/\(([^()]*)\)\s*$/); return m ? m[1].split(',').map(x => x.trim()) : []; };

  const today = cfg.today; // m/d/yyyy
  const recentLimit = Date.now() - 14 * 864e5;
  const parseMDY = s => { const m = String(s || '').match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/); return m ? new Date(+m[3], +m[1] - 1, +m[2]).getTime() : NaN; };

  const mkStock = (rows, key) => rows.map(r => ({
    row_number: r.row_number, product: norm(r[key.product]), size: normSize(r[key.size]), mat: r[key.mat],
    status: String(r[key.status] || '').trim().toLowerCase(), dispatchId: String(r[key.dispatchId] || '').trim().toUpperCase(),
    dispatchDate: r[key.dispatchDate], used: false,
    skuBox: `${String(r['SKU'] || '').trim()} ${String(r['Box #'] || '').trim()}`.trim(),
    oldId: key.oldId ? String(r[key.oldId] ?? '').trim() : '',
  }));
  const WH = {};
  for (const s of sources) WH[s.key] = { ...s, stock: mkStock(s.rows, s.cols) };

  const linesByOrder = {};
  for (const l of lines) { const oid = Array.isArray(l.order_id) ? l.order_id[0] : l.order_id; (linesByOrder[oid] ||= []).push(l); }

  const isNonProduct = l => l.display_type || l.is_delivery || /^(amazon shipping)$/i.test(norm(Array.isArray(l.product_template_id) ? l.product_template_id[1] : '')) || !l.product_id;

  // try to allocate all needed units in one warehouse; returns rows or null
  function tryAlloc(wh, needs, orderName) {
    const picked = [];
    for (const n of needs) {
      for (let q = 0; q < n.qty; q++) {
        const fit = r => !r.used && r.product === n.product && r.size === n.size && matOk(r.mat, n.mat);
        // reuse rows already dispatched to this order (re-run safety)
        let r = wh.stock.find(r => fit(r) && r.status === 'out' && r.dispatchId === orderName.toUpperCase() && parseMDY(r.dispatchDate) >= recentLimit);
        let already = !!r;
        if (!r) r = wh.stock.find(r => fit(r) && r.status === 'in');
        if (!r) { picked.forEach(p => p.row.used = false); return null; }
        r.used = true; picked.push({ row: r, already });
      }
    }
    return picked;
  }

  const sorted = [...orders].filter(o => /united states/i.test(o.x_studio_country || ''))
    .sort((a, b) => String(a.create_date).localeCompare(String(b.create_date)) || a.id - b.id);

  const noteNow = o => (String(o.note || '') === 'false' ? '' : String(o.note || ''));
  const out = [];
  for (const o of sorted) {
    // "Warning: This quote contains archived product(s)" -> leave the order untouched
    if (o.has_archived_products) {
      out.push({ route: 'skip', order_id: o.id, order_name: o.name, items: '', reason: 'contains archived product(s)' });
      continue;
    }
    const prodLines = (linesByOrder[o.id] || []).filter(l => !isNonProduct(l));
    // orders with the "Amazon Sale" placeholder product (no real product mapped) are left untouched
    if (prodLines.some(l => norm(Array.isArray(l.product_template_id) ? l.product_template_id[1] : '') === 'amazon sale')) {
      out.push({ route: 'skip', order_id: o.id, order_name: o.name, items: 'Amazon Sale', reason: 'Amazon Sale placeholder product' });
      continue;
    }
    const needs = prodLines.map(l => {
      const tmpl = Array.isArray(l.product_template_id) ? l.product_template_id[1] : '';
      const parts = parenParts(Array.isArray(l.product_id) ? l.product_id[1] : '');
      const size = l.variant_size_value || parts.find(p => SIZE[p.toLowerCase()] || /^\d?x*l$|^\d?xs$/i.test(p)) || '';
      const mat = l.variant_material_value || (parts.length > 1 ? parts[parts.length - 1] : '');
      return { product: norm(tmpl), size: normSize(size), mat, qty: Math.max(1, Math.round(l.product_uom_qty || 1)), label: `${tmpl} / ${size} / ${mat}` };
    });
    let chosen = null, picked = null;
    if (needs.length && needs.every(n => n.product && n.size)) {
      for (const s of sources) { picked = tryAlloc(WH[s.key], needs, o.name); if (picked) { chosen = s.key; break; } }
    }
    const base = { order_id: o.id, order_name: o.name, items: needs.map(n => n.label).join(' | ') };
    if (chosen) {
      const wh = WH[chosen];
      for (const p of picked.filter(p => !p.already))
        out.push({ route: wh.route, ...base, row_number: p.row.row_number, dispatch_id: o.name, dispatch_date: today });
      // stock sheets: SKU + Box #   |   return sheets: OLD ID <Return ID>
      const detail = wh.kind === 'return' ? picked.map(p => `OLD ID ${p.row.oldId}`).join(', ') : picked.map(p => p.row.skuBox).join(', ');
      out.push({ route: 'ship', ...base, note: noteNow(o), warehouse: chosen, warehouse_id: wh.warehouseId,
        us_wh_sku: `Shipped From ${wh.label} ${today} ${detail}`.trim(), sheet_rows: picked.map(p => p.row.row_number).join(',') });
    } else {
      const note = String(o.note || '');
      if (!/warehouse not available/i.test(note.replace(/<[^>]+>/g, ' ')))
        out.push({ route: 'not_available', ...base, note: (note && note !== 'false' ? note : '') + '<p>Warehouse Not Available</p>' });
      else out.push({ route: 'skip', ...base, reason: 'already marked Warehouse Not Available' });
      // 10 AM run only: still not found after the 12 AM / 6 AM / 10 AM checks -> confirm as it is
      if (cfg.confirmNotAvailable) out.push({ route: 'confirm_not_available', ...base, note: noteNow(o) + (/warehouse not available/i.test(note.replace(/<[^>]+>/g, ' ')) ? '' : '<p>Warehouse Not Available</p>') });
    }
  }
  return out;
}
if (typeof module !== 'undefined') module.exports = planOrders;
