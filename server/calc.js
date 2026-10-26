import { str, toCents } from './util.js';

export const VALID_RATES = [0, 7, 19];

// Normalise items coming from the client. Prices may arrive as euros (number|string)
// via `price`, or as integer cents via `price_cents`.
export function normaliseItems(rawItems, taxMode, defaultRate = 19) {
  const items = Array.isArray(rawItems) ? rawItems.slice(0, 200) : [];
  return items
    .map((it, i) => {
      const qty = Number(String(it.qty ?? 1).replace(',', '.'));
      const price_cents = it.price_cents !== undefined ? Math.round(Number(it.price_cents)) : toCents(it.price ?? 0);
      let rate = Number(it.tax_rate ?? defaultRate);
      if (!VALID_RATES.includes(rate)) rate = defaultRate;
      if (taxMode === 'kleinunternehmer') rate = 0;
      const q = Number.isFinite(qty) ? Math.round(qty * 1000) / 1000 : 1;
      const p = Number.isFinite(price_cents) ? price_cents : 0;
      return {
        id: str(it.id, 40) || `i${i + 1}`,
        description: str(it.description, 2000),
        qty: q,
        unit: str(it.unit, 20),
        price_cents: p,
        tax_rate: rate,
        total_cents: Math.round(q * p),
      };
    })
    .filter((it) => it.description || it.price_cents !== 0);
}

// treatment: 'auto' (normal VAT), 'reverse_charge', 'export'
export function computeTotals(items, taxMode, treatment = 'auto') {
  const net = items.reduce((s, it) => s + it.total_cents, 0);
  const groups = {};
  if (taxMode === 'standard' && treatment === 'auto') {
    for (const it of items) {
      if (!it.tax_rate) continue;
      groups[it.tax_rate] = (groups[it.tax_rate] || 0) + it.total_cents;
    }
  }
  const taxLines = Object.keys(groups)
    .map(Number)
    .sort((a, b) => b - a)
    .map((rate) => ({ rate, base_cents: groups[rate], tax_cents: Math.round((groups[rate] * rate) / 100) }));
  const tax = taxLines.reduce((s, l) => s + l.tax_cents, 0);
  return { net_cents: net, tax_cents: tax, total_cents: net + tax, taxLines };
}
