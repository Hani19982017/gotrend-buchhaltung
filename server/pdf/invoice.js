import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';
import { registerFonts, tint, safeHex, pdfToBuffer } from './common.js';
import { computeTotals } from '../calc.js';
import { fmtEur, fmtDate } from '../util.js';

const L = {
  de: {
    invoice: 'Rechnung', quote: 'Angebot', storno: 'Stornorechnung',
    number: { invoice: 'Rechnungsnr.', quote: 'Angebotsnr.', storno: 'Stornonr.' },
    date: { invoice: 'Rechnungsdatum', quote: 'Angebotsdatum', storno: 'Datum' },
    service: 'Leistungszeitraum', serviceDate: 'Leistungsdatum', due: 'Fällig am', valid: 'Gültig bis',
    customerNo: 'Kundennr.', customerVat: 'USt-IdNr. Kunde',
    pos: 'Pos.', desc: 'Beschreibung', qty: 'Menge', unit: 'Einheit', price: 'Einzelpreis', vat: 'USt.', amount: 'Gesamt',
    subtotal: 'Zwischensumme (netto)', vatOn: (r, b) => `zzgl. ${r} % USt. auf ${b}`, totalGross: 'Gesamtbetrag (brutto)', total: 'Gesamtbetrag',
    netTotal: 'Gesamtbetrag (netto)',
    kleinunternehmer: 'Gemäß § 19 UStG wird keine Umsatzsteuer berechnet.',
    reverseCharge: 'Steuerschuldnerschaft des Leistungsempfängers (Reverse Charge, § 13b UStG / Art. 196 MwStSystRL).',
    export: 'Nicht im Inland steuerbare Leistung (Leistungsort außerhalb Deutschlands).',
    stornoRef: (n, d) => `Storno zur Rechnung ${n} vom ${d}`,
    stornoText: 'Hiermit stornieren wir die oben genannte Rechnung vollständig.',
    reason: 'Grund',
    payTitle: 'Zahlungsinformationen',
    holder: 'Kontoinhaber', bank: 'Bank', iban: 'IBAN', bic: 'BIC', ref: 'Verwendungszweck',
    scan: 'Scannen & bezahlen',
    page: (a, b) => `Seite ${a} von ${b}`,
    owner: 'Inh.', tel: 'Tel.', vatId: 'USt-IdNr.', taxNo: 'Steuernr.',
    draft: 'ENTWURF',
    units: {},
  },
  en: {
    invoice: 'Invoice', quote: 'Quotation', storno: 'Cancellation Invoice',
    number: { invoice: 'Invoice no.', quote: 'Quote no.', storno: 'Cancellation no.' },
    date: { invoice: 'Invoice date', quote: 'Quote date', storno: 'Date' },
    service: 'Service period', serviceDate: 'Service date', due: 'Due date', valid: 'Valid until',
    customerNo: 'Customer no.', customerVat: 'Customer VAT ID',
    pos: 'No.', desc: 'Description', qty: 'Qty', unit: 'Unit', price: 'Unit price', vat: 'VAT', amount: 'Amount',
    subtotal: 'Subtotal (net)', vatOn: (r, b) => `plus ${r}% VAT on ${b}`, totalGross: 'Total (gross)', total: 'Total',
    netTotal: 'Total (net)',
    kleinunternehmer: 'In accordance with § 19 UStG (German VAT Act), no VAT is charged (small business).',
    reverseCharge: 'Reverse charge: VAT is payable by the recipient of the service (Art. 196 EU VAT Directive).',
    export: 'Not taxable in Germany (place of supply outside Germany).',
    stornoRef: (n, d) => `Cancellation of invoice ${n} dated ${d}`,
    stornoText: 'We hereby fully cancel the invoice referenced above.',
    reason: 'Reason',
    payTitle: 'Payment details',
    holder: 'Account holder', bank: 'Bank', iban: 'IBAN', bic: 'BIC/SWIFT', ref: 'Reference',
    scan: 'Scan to pay',
    page: (a, b) => `Page ${a} of ${b}`,
    owner: 'Owner:', tel: 'Phone', vatId: 'VAT ID', taxNo: 'Tax no.',
    draft: 'DRAFT',
    units: { 'Stk.': 'pcs', 'Std.': 'hrs', Pauschal: 'flat', Monat: 'month', Tag: 'day', 'Monate': 'months', 'Tage': 'days' },
  },
};

const PAGE = { w: 595.28, h: 841.89 };
const M = { l: 56.7, r: 50 }; // DIN 5008: 20 mm left
const CONTENT_W = PAGE.w - M.l - M.r;
const FOOTER_TOP = PAGE.h - 92;
const BOTTOM_LIMIT = FOOTER_TOP - 18;

function epcPayload({ bic, name, iban, cents, ref }) {
  return [
    'BCD', '002', '1', 'SCT',
    (bic || '').replace(/\s/g, ''),
    (name || '').slice(0, 70),
    (iban || '').replace(/\s/g, '').toUpperCase(),
    `EUR${(cents / 100).toFixed(2)}`,
    '', '',
    (ref || '').slice(0, 140),
  ].join('\n');
}

function qty(n, lang) {
  return new Intl.NumberFormat(lang === 'en' ? 'en-IE' : 'de-DE', { maximumFractionDigits: 3 }).format(n);
}

/**
 * @param {object} inv  invoice row with parsed `items` and `client` (snapshot)
 * @param {object} settings
 * @param {Buffer|null} logo
 * @param {object} [opts] { draft: boolean, related: {number, issue_date} }
 */
export async function renderInvoicePdf(inv, settings, logo, opts = {}) {
  const lang = inv.language === 'en' ? 'en' : 'de';
  const t = L[lang];
  const kind = inv.kind || 'invoice';
  const design = settings.invoice;
  const company = settings.company;
  const accent = safeHex(design.accentColor);
  const template = ['modern', 'classic', 'minimal'].includes(design.template) ? design.template : 'modern';
  const taxMode = inv.tax_mode || settings.tax.mode;
  const treatment = taxMode === 'standard' ? inv.tax_treatment || 'auto' : 'auto';
  const showVatCol = taxMode === 'standard' && treatment === 'auto';
  const totals = computeTotals(inv.items, taxMode, treatment);
  const client = inv.client || {};
  const dark = '#111827';
  const mid = '#4b5563';
  const light = '#9ca3af';
  const line = '#e5e7eb';

  const doc = new PDFDocument({
    size: 'A4',
    margins: { top: 40, bottom: 20, left: M.l, right: M.r },
    bufferPages: true,
    info: {
      Title: `${t[kind]} ${inv.number || ''}`.trim(),
      Author: company.name,
      Creator: 'Go.Trend Buchhaltung',
    },
  });
  registerFonts(doc, design.font);

  const text = (s, x, y, o = {}) => {
    doc.font(o.font || 'R').fontSize(o.size || 9).fillColor(o.color || dark);
    doc.text(String(s ?? ''), x, y, { width: o.width, align: o.align || 'left', lineGap: o.lineGap ?? 1.5, lineBreak: o.lineBreak, characterSpacing: o.cs || 0 });
    return doc.y;
  };
  const height = (s, width, o = {}) => {
    doc.font(o.font || 'R').fontSize(o.size || 9);
    return doc.heightOfString(String(s ?? ''), { width, lineGap: o.lineGap ?? 1.5 });
  };
  const hline = (y, x1 = M.l, x2 = PAGE.w - M.r, color = line, w = 0.7) => {
    doc.save().moveTo(x1, y).lineTo(x2, y).lineWidth(w).strokeColor(color).stroke().restore();
  };

  // ───────────── Header ─────────────
  let headerBottom = 120;
  if (template === 'modern') {
    doc.save().rect(0, 0, PAGE.w, 8).fill(accent).restore();
  }
  const logoW = Math.max(60, Math.min(Number(design.logoSize) || 150, 240));
  const logoH = 70;
  const pos = design.logoPosition || 'left';
  const companyLines = [
    company.name,
    company.owner ? `${t.owner} ${company.owner}` : '',
    company.street,
    `${company.zip} ${company.city}`.trim(),
    company.country && company.country !== 'Deutschland' && company.country !== 'Germany' ? company.country : (lang === 'en' ? 'Germany' : ''),
  ].filter(Boolean);
  const contactLines = [company.phone && `${t.tel} ${company.phone}`, company.email, company.website].filter(Boolean);

  const drawCompanyBlock = (x, y, align, width = 200) => {
    let yy = text(companyLines[0], x, y, { font: 'B', size: 10.5, width, align });
    yy = text(companyLines.slice(1).join('\n'), x, yy + 1, { size: 8.3, color: mid, width, align });
    text(contactLines.join('\n'), x, yy + 4, { size: 8.3, color: mid, width, align });
    return doc.y;
  };

  const top = 34;
  if (logo) {
    let lx = M.l;
    if (pos === 'right') lx = PAGE.w - M.r - logoW;
    if (pos === 'center') lx = (PAGE.w - logoW) / 2;
    try {
      doc.image(logo, lx, top, { fit: [logoW, logoH], align: pos === 'right' ? 'right' : pos === 'center' ? 'center' : 'left', valign: 'top' });
    } catch {
      /* ignore broken logo */
    }
    if (pos === 'center') {
      headerBottom = Math.max(headerBottom, top + logoH + 8);
    } else {
      const bx = pos === 'right' ? M.l : PAGE.w - M.r - 200;
      const by = drawCompanyBlock(bx, top, pos === 'right' ? 'left' : 'right');
      headerBottom = Math.max(headerBottom, by + 6);
    }
  } else {
    // No logo: company name as wordmark left, contact right
    text(company.name, M.l, top + 4, { font: 'B', size: 17, color: template === 'minimal' ? dark : accent, width: 280 });
    const by = drawCompanyBlock(PAGE.w - M.r - 200, top, 'right');
    headerBottom = Math.max(headerBottom, by + 6);
  }

  // ───────────── Address window (DIN 5008 B) + meta ─────────────
  const addrTop = Math.max(127, headerBottom + 4);
  const sender = [company.name, company.street, `${company.zip} ${company.city}`].filter(Boolean).join(' · ');
  text(sender, M.l, addrTop, { size: 6.8, color: light, width: 240, lineBreak: false });
  hline(addrTop + 10, M.l, M.l + 240, line, 0.5);
  const clientLines = [
    client.company,
    client.contact && client.contact !== client.company ? client.contact : '',
    client.street,
    `${client.zip || ''} ${client.city || ''}`.trim(),
    client.country && !['Deutschland', 'Germany', 'DE'].includes(client.country) ? client.country : '',
  ].filter(Boolean);
  text(clientLines.join('\n') || '—', M.l, addrTop + 16, { size: 10, width: 240, lineGap: 2 });
  const addrBottom = doc.y;

  // Meta table on the right
  const metaRows = [];
  metaRows.push([t.number[kind], inv.number || (lang === 'en' ? '(draft)' : '(Entwurf)')]);
  metaRows.push([t.date[kind], fmtDate(inv.issue_date, lang)]);
  if (kind !== 'storno') {
    if (inv.service_from && inv.service_to && inv.service_from !== inv.service_to) {
      metaRows.push([t.service, `${fmtDate(inv.service_from, lang)} – ${fmtDate(inv.service_to, lang)}`]);
    } else if (inv.service_from || inv.service_to) {
      metaRows.push([t.serviceDate, fmtDate(inv.service_from || inv.service_to, lang)]);
    } else if (kind === 'invoice') {
      metaRows.push([t.serviceDate, fmtDate(inv.issue_date, lang)]);
    }
  }
  if (kind === 'invoice' && inv.due_date) metaRows.push([t.due, fmtDate(inv.due_date, lang)]);
  if (kind === 'quote' && inv.due_date) metaRows.push([t.valid, fmtDate(inv.due_date, lang)]);
  if (client.customer_no) metaRows.push([t.customerNo, client.customer_no]);
  if (client.vat_id) metaRows.push([t.customerVat, client.vat_id]);

  const metaW = 210;
  const metaX = PAGE.w - M.r - metaW;
  let my = addrTop + 2;
  if (template === 'modern') {
    const boxH = metaRows.length * 15 + 14;
    doc.save().roundedRect(metaX - 10, my - 6, metaW + 10, boxH, 6).fill(tint(accent, 0.93)).restore();
  }
  for (const [k, v] of metaRows) {
    text(k, metaX, my, { size: 8.3, color: mid, width: 95 });
    text(v, metaX + 95, my, { size: 8.6, font: 'M', width: metaW - 100, align: 'right' });
    my += 15;
  }

  // ───────────── Title ─────────────
  let y = Math.max(addrBottom, my) + 30;
  const titleText = `${t[kind]}${inv.number ? ' ' + inv.number : ''}`;
  text(titleText, M.l, y, { font: 'B', size: template === 'minimal' ? 18 : 20, color: template === 'classic' ? dark : accent, width: CONTENT_W });
  y = doc.y + 3;
  if (inv.title) {
    text(inv.title, M.l, y, { font: 'M', size: 10.5, width: CONTENT_W });
    y = doc.y;
  }
  if (kind === 'storno' && opts.related) {
    text(t.stornoRef(opts.related.number, fmtDate(opts.related.issue_date, lang)), M.l, y + 2, { font: 'M', size: 9.5, color: mid, width: CONTENT_W });
    y = doc.y;
    if (inv.cancel_reason) {
      text(`${t.reason}: ${inv.cancel_reason}`, M.l, y + 2, { size: 9, color: mid, width: CONTENT_W });
      y = doc.y;
    }
  }
  y += 12;

  const fill = (s) => String(s || '')
    .replace(/\{due\}/g, fmtDate(inv.due_date, lang))
    .replace(/\{valid\}/g, fmtDate(inv.due_date, lang))
    .replace(/\{number\}/g, inv.number || '');

  const intro = kind === 'storno' ? t.stornoText : fill(inv.intro_text);
  if (intro) {
    text(intro, M.l, y, { size: 9.3, width: CONTENT_W, lineGap: 2.5, color: '#1f2937' });
    y = doc.y + 14;
  }

  // ───────────── Items table ─────────────
  const cols = [
    { key: 'pos', w: 28, align: 'left' },
    { key: 'desc', w: 0, align: 'left' },
    { key: 'qty', w: 74, align: 'right' },
    { key: 'price', w: 76, align: 'right' },
    ...(showVatCol ? [{ key: 'vat', w: 38, align: 'right' }] : []),
    { key: 'amount', w: 80, align: 'right' },
  ];
  const fixed = cols.reduce((s, c) => s + c.w, 0);
  cols.find((c) => c.key === 'desc').w = CONTENT_W - fixed;
  let cx = M.l;
  for (const c of cols) { c.x = cx; cx += c.w; }
  const PADX = 6;

  const drawTableHeader = () => {
    const hH = 22;
    if (template === 'modern') {
      doc.save().roundedRect(M.l, y, CONTENT_W, hH, 4).fill(accent).restore();
    } else if (template === 'classic') {
      doc.save().rect(M.l, y, CONTENT_W, hH).fill('#f3f4f6').restore();
      hline(y, M.l, PAGE.w - M.r, dark, 0.9);
      hline(y + hH, M.l, PAGE.w - M.r, dark, 0.6);
    } else {
      hline(y + hH, M.l, PAGE.w - M.r, dark, 0.8);
    }
    const hc = template === 'modern' ? '#ffffff' : template === 'minimal' ? mid : dark;
    for (const c of cols) {
      text(t[c.key], c.x + PADX, y + 7, { font: 'M', size: 7.8, color: hc, width: c.w - PADX * 2, align: c.align, cs: template === 'minimal' ? 0.3 : 0 });
    }
    y += hH + 4;
  };

  const newPage = () => {
    doc.addPage();
    text(`${t[kind]} ${inv.number || ''}`.trim(), M.l, 34, { size: 8, color: light, width: CONTENT_W });
    y = 56;
  };

  drawTableHeader();
  inv.items.forEach((it, idx) => {
    const lines = String(it.description || '').split('\n');
    const first = lines[0] || '';
    const rest = lines.slice(1).join('\n');
    const dW = cols.find((c) => c.key === 'desc').w - PADX * 2;
    const rowH = height(first, dW, { font: 'M', size: 9 }) + (rest ? height(rest, dW, { size: 8.3 }) + 2 : 0) + 12;
    if (y + rowH > BOTTOM_LIMIT) {
      newPage();
      drawTableHeader();
    }
    if (template === 'modern' && idx % 2 === 1) {
      doc.save().rect(M.l, y - 2, CONTENT_W, rowH).fill('#f9fafb').restore();
    }
    const unit = t.units[it.unit] || it.unit || '';
    const vals = {
      pos: String(idx + 1),
      qty: `${qty(it.qty, lang)}${unit ? ' ' + unit : ''}`,
      price: fmtEur(it.price_cents, lang),
      vat: `${it.tax_rate} %`,
      amount: fmtEur(it.total_cents, lang),
    };
    for (const c of cols) {
      if (c.key === 'desc') {
        text(first, c.x + PADX, y + 4, { font: 'M', size: 9, width: dW });
        if (rest) text(rest, c.x + PADX, doc.y + 1, { size: 8.3, color: mid, width: dW });
      } else {
        text(vals[c.key], c.x + PADX, y + 4, { size: 9, width: c.w - PADX * 2, align: c.align, font: c.key === 'amount' ? 'M' : 'R' });
      }
    }
    y += rowH;
    if (template !== 'modern') hline(y - 2, M.l, PAGE.w - M.r, line, 0.6);
  });

  // ───────────── Totals ─────────────
  const totW = 250;
  const totX = PAGE.w - M.r - totW;
  const totRows = [];
  if (showVatCol) {
    totRows.push([t.subtotal, fmtEur(totals.net_cents, lang)]);
    for (const tl of totals.taxLines) totRows.push([t.vatOn(tl.rate, fmtEur(tl.base_cents, lang)), fmtEur(tl.tax_cents, lang)]);
  } else if (taxMode === 'standard') {
    totRows.push([t.subtotal, fmtEur(totals.net_cents, lang)]);
    totRows.push([`${t.vat} 0 %`, fmtEur(0, lang)]);
  }
  const needed = totRows.length * 16 + 40;
  if (y + needed > BOTTOM_LIMIT) newPage();
  y += 8;
  for (const [k, v] of totRows) {
    text(k, totX, y, { size: 8.8, color: mid, width: totW - 90 });
    text(v, totX + totW - 100, y, { size: 8.8, width: 94, align: 'right' });
    y += 16;
  }
  const grandLabel = taxMode === 'standard' ? (treatment === 'auto' ? t.totalGross : t.netTotal) : t.total;
  y += 2;
  if (template === 'modern') {
    doc.save().roundedRect(totX - 8, y - 6, totW + 8, 30, 5).fill(accent).restore();
    text(grandLabel, totX, y + 3, { font: 'B', size: 10, color: '#ffffff', width: totW - 100 });
    text(fmtEur(totals.total_cents, lang), totX + totW - 110, y + 2, { font: 'B', size: 12, color: '#ffffff', width: 104, align: 'right' });
    y += 34;
  } else {
    hline(y - 4, totX, PAGE.w - M.r, dark, template === 'classic' ? 0.9 : 0.6);
    text(grandLabel, totX, y + 3, { font: 'B', size: 10, width: totW - 100 });
    text(fmtEur(totals.total_cents, lang), totX + totW - 110, y + 1, { font: 'B', size: 12, color: template === 'minimal' ? accent : dark, width: 104, align: 'right' });
    y += 22;
    if (template === 'classic') {
      hline(y, totX, PAGE.w - M.r, dark, 0.9);
      hline(y + 2.2, totX, PAGE.w - M.r, dark, 0.9);
    }
    y += 10;
  }

  // Tax note
  let taxNote = '';
  if (taxMode === 'kleinunternehmer') taxNote = t.kleinunternehmer;
  else if (treatment === 'reverse_charge') taxNote = t.reverseCharge;
  else if (treatment === 'export') taxNote = t.export;
  if (taxNote) {
    const h = height(taxNote, CONTENT_W, { size: 8.6 });
    if (y + h > BOTTOM_LIMIT) newPage();
    text(taxNote, M.l, y + 4, { size: 8.6, color: mid, width: CONTENT_W });
    y = doc.y + 6;
  }

  // Outro
  const outro = kind === 'storno' ? '' : fill(inv.outro_text);
  if (outro) {
    const h = height(outro, CONTENT_W, { size: 9.3, lineGap: 2.5 });
    if (y + h + 10 > BOTTOM_LIMIT) newPage();
    text(outro, M.l, y + 10, { size: 9.3, width: CONTENT_W, lineGap: 2.5, color: '#1f2937' });
    y = doc.y + 6;
  }

  // ───────────── Payment box ─────────────
  const wantsPayment = kind === 'invoice' && design.showBank && company.iban && totals.total_cents > 0;
  if (wantsPayment) {
    const boxH = 92;
    if (y + boxH + 14 > BOTTOM_LIMIT) newPage();
    y += 14;
    const showQr = design.showQr;
    doc.save().roundedRect(M.l, y, CONTENT_W, boxH, 6).fill(template === 'modern' ? tint(accent, 0.94) : '#f9fafb').restore();
    if (template !== 'modern') doc.save().roundedRect(M.l, y, CONTENT_W, boxH, 6).lineWidth(0.6).strokeColor(line).stroke().restore();
    text(t.payTitle, M.l + 14, y + 12, { font: 'B', size: 9.5, color: template === 'classic' ? dark : accent });
    const rows = [
      [t.bank, company.bankName],
      [t.iban, (company.iban || '').replace(/\s/g, '').replace(/(.{4})/g, '$1 ').trim()],
      [t.bic, company.bic],
      [t.ref, inv.number || '—'],
    ].filter((r) => r[1]);
    let ry = y + 28;
    for (const [k, v] of rows) {
      text(k, M.l + 14, ry, { size: 8.3, color: mid, width: 90 });
      text(v, M.l + 104, ry, { size: 8.6, font: k === t.iban || k === t.ref ? 'M' : 'R', width: 260 });
      ry += 12;
    }
    if (showQr) {
      try {
        const payload = epcPayload({ bic: company.bic, name: company.accountHolder || company.name, iban: company.iban, cents: totals.total_cents, ref: inv.number || '' });
        const png = await QRCode.toBuffer(payload, { errorCorrectionLevel: 'M', margin: 1, width: 360, color: { dark: '#111111', light: '#ffffff' } });
        const qs = 70;
        const qx = PAGE.w - M.r - qs - 14;
        doc.image(png, qx, y + 8, { width: qs, height: qs });
        text(t.scan, qx - 10, y + 8 + qs + 2, { size: 6.8, color: mid, width: qs + 20, align: 'center' });
      } catch {
        /* skip QR */
      }
    }
    y += boxH;
  }

  // ───────────── Footer on every page + watermark ─────────────
  const range = doc.bufferedPageRange();
  const total = range.count;
  const footerCols = [
    [company.name, company.owner ? `${t.owner} ${company.owner}` : '', company.street, `${company.zip} ${company.city}`].filter(Boolean),
    [company.phone && `${t.tel} ${company.phone}`, company.email, company.website].filter(Boolean),
    [company.bankName, company.iban && `IBAN ${(company.iban || '').replace(/\s/g, '').replace(/(.{4})/g, '$1 ').trim()}`, company.bic && `BIC ${company.bic}`].filter(Boolean),
    [company.vatId && `${t.vatId} ${company.vatId}`, company.taxNumber && `${t.taxNo} ${company.taxNumber}`, design.footerNote].filter(Boolean),
  ];
  const colWs = [0.25, 0.25, 0.31, 0.19].map((f) => f * CONTENT_W);
  for (let i = 0; i < total; i++) {
    doc.switchToPage(range.start + i);
    doc.page.margins.bottom = 0;
    if (opts.draft) {
      doc.save();
      doc.rotate(-35, { origin: [PAGE.w / 2, PAGE.h / 2] });
      doc.font('B').fontSize(96).fillColor('#000000').fillOpacity(0.045);
      doc.text(t.draft, 0, PAGE.h / 2 - 50, { width: PAGE.w, align: 'center', lineBreak: false });
      doc.restore();
      doc.fillOpacity(1);
    }
    hline(FOOTER_TOP, M.l, PAGE.w - M.r, template === 'modern' ? tint(accent, 0.6) : line, 0.7);
    let fx = M.l;
    footerCols.forEach((lines, ci) => {
      doc.font('R').fontSize(6.9).fillColor(mid);
      doc.text(lines.join('\n'), fx, FOOTER_TOP + 8, { width: colWs[ci] - 6, lineGap: 1.2, lineBreak: true, height: 50, ellipsis: true });
      fx += colWs[ci];
    });
    doc.font('R').fontSize(6.9).fillColor(light);
    doc.text(t.page(i + 1, total), M.l, PAGE.h - 26, { width: CONTENT_W, align: 'right', lineBreak: false });
    if (template === 'modern') doc.save().rect(0, PAGE.h - 6, PAGE.w, 6).fill(accent).restore();
  }

  return pdfToBuffer(doc);
}
