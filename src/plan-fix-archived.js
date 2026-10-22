// ===== Fix archived products: plan (shared by preview + real workflow) =====
// inputs: orders, lines (of those orders), archivedIds, candLines (other lines with same ASINs), activeIds, variants (of candidate templates)
function planFix(orders, lines, archivedIds, candLines, activeIds, variants, opts) {
  const SIZE = { 'xxs':'XXS','xx-small':'XXS','xxsmall':'XXS','xs':'XS','x-small':'XS','xsmall':'XS','s':'S','small':'S','m':'M','medium':'M','med':'M',
    'l':'L','large':'L','xl':'XL','x-large':'XL','xlarge':'XL','xxl':'2XL','2xl':'2XL','xx-large':'2XL','xxlarge':'2XL',
    'xxxl':'3XL','3xl':'3XL','xxx-large':'3XL','xxxlarge':'3XL','4xl':'4XL','xxxxl':'4XL','5xl':'5XL','6xl':'6XL' };
  const sz = s => SIZE[String(s || '').toLowerCase().trim()] || '';
  const archived = new Set(archivedIds), active = new Set(activeIds);
  const id0 = v => Array.isArray(v) ? v[0] : v;
  const parts = dn => { const m = String(dn || '').match(/\(([^()]*)\)\s*$/); return m ? m[1].split(',').map(x => x.trim()) : []; };
  const normMat = s => String(s || '').toLowerCase().replace(/[^a-z]/g, '');
  const varSize = v => parts(v.display_name).map(sz).find(Boolean) || '';
  const varMat = v => { const p = parts(v.display_name).filter(x => !sz(x) && !/^(male|female|men|women|unisex)$/i.test(x)); return p[p.length - 1] || ''; };

  const skuOf = l => String(l.amazon_seller_sku || (String(l.name || '').match(/^\s*\[([^\]]+)\]/) || [])[1] || '').trim();
  function sizeFrom(l) {
    const toks = skuOf(l).split(/[-_\s]+/).filter(Boolean);
    for (let i = toks.length - 1; i >= 0; i--) { const s = sz(toks[i]); if (s) return s; }
    const txt = String(l.name || '');
    const m = txt.match(/\b(XX-Small|X-Small|Small|Medium|Large|X-Large|XX-Large|XXX-Large|XXS|XS|XXXL|XXL|XL|[2-6]XL)\b/i);
    return m ? sz(m[1]) : '';
  }
  const variantsByTmpl = {};
  for (const v of variants) (variantsByTmpl[id0(v.product_tmpl_id)] ||= []).push(v);

  const linesByOrder = {};
  for (const l of lines) (linesByOrder[id0(l.order_id)] ||= []).push(l);

  const out = [];
  for (const o of orders) {
    if (!o.has_archived_products) continue;
    const archLines = (linesByOrder[o.id] || []).filter(l => l.product_id && archived.has(id0(l.product_id)) && !l.display_type);
    const results = [];
    for (const l of archLines) {
      const asins = [...new Set([l.asin, l.amazon_asin].map(a => String(a || '').trim()).filter(Boolean))];
      let cands = [];
      for (const a of asins) {           // first ASIN, then second ASIN
        cands = candLines.filter(c => id0(c.order_id) !== o.id && c.product_id && active.has(id0(c.product_id)) && id0(c.product_id) !== id0(l.product_id)
                                   && (String(c.asin || '').trim() === a || String(c.amazon_asin || '').trim() === a));
        if (cands.length) break;
      }
      if (!cands.length) { results.push({ line_id: l.id, status: 'order_not_found', asins: asins.join(','), sku: skuOf(l) }); continue; }
      // most common template among matching orders (tie -> most recent line)
      const byT = {};
      for (const c of cands) { const t = id0(c.product_template_id); (byT[t] ||= { t, n: 0, last: c, name: c.product_template_id[1] }); byT[t].n++; if (c.id > byT[t].last.id) byT[t].last = c; }
      const best = Object.values(byT).sort((a, b) => b.n - a.n || b.last.id - a.last.id)[0];
      const refVariant = variants.find(v => v.id === id0(best.last.product_id));
      const want = sizeFrom(l);
      const pool = (variantsByTmpl[best.t] || []).filter(v => active.has(v.id) || true);
      let pick = null;
      if (want) {
        let m = pool.filter(v => varSize(v) === want);
        if (m.length > 1 && refVariant) { const mm = m.filter(v => normMat(varMat(v)) === normMat(varMat(refVariant))); if (mm.length) m = mm; }
        if (m.length === 1) pick = m[0];
      }
      if (!pick) { results.push({ line_id: l.id, status: 'product_not_found', product: best.name, size: want || '?', from_order: best.last.order_id[1], sku: skuOf(l) }); continue; }
      results.push({ line_id: l.id, status: 'fix', product_id: pick.id, product: pick.display_name, size: want, from_order: best.last.order_id[1], sku: skuOf(l),
                     price_unit: l.price_unit, name: l.name, tax_ids: l.tax_id || [], discount: l.discount || 0 });
    }
    const fixes = results.filter(r => r.status === 'fix');
    const fails = results.filter(r => r.status !== 'fix');
    let note = null;
    if (fails.length) {
      const msg = fails.some(f => f.status === 'order_not_found') ? 'Order Not Found' : 'Product Not Found';
      const cur = String(o.note || '') === 'false' ? '' : String(o.note || '');
      if (!new RegExp(msg, 'i').test(cur.replace(/<[^>]+>/g, ' '))) note = cur + `<p>${msg}</p>`;
    }
    out.push({ order_id: o.id, order_name: o.name, fixes, fails, note });
  }
  return out;
}
if (typeof module !== 'undefined') module.exports = planFix;
