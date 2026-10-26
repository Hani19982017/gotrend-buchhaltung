import fs from 'node:fs';
import path from 'node:path';
import { Router } from 'express';
import { ZipArchive } from 'archiver';
import PDFDocument from 'pdfkit';
import { db, FILES_DIR, INVOICE_PDF_DIR, DATA_DIR, BACKUP_DIR } from './db.js';
import { getSettings } from './settings.js';
import { monthData } from './routes.js';
import { getInvoicePdf, parseInvoice } from './invoices.js';
import { registerFonts, pdfToBuffer, safeHex } from './pdf/common.js';
import { wrap, assertYm, fmtEur, fmtNum, fmtDate, safeFileName, audit, todayBerlin } from './util.js';

export const exportRouter = Router();

const MONTHS_DE = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
const FOLDER_DIRS = {
  invoices: '01_Ausgangsrechnungen',
  income: '01_Ausgangsrechnungen',
  purchase: '02_Einkaeufe',
  subscription: '03_Abonnements_Fixkosten',
  other: '04_Sonstige_Ausgaben',
  bank: '05_Kontoauszug',
};
const FOLDER_LABEL = {
  income: 'Einnahme (extern)',
  purchase: 'Einkauf',
  subscription: 'Abo / Fixkosten',
  other: 'Sonstige Ausgabe',
  bank: 'Kontoauszug',
};
const METHOD_DE = { card: 'Karte', bank: 'Überweisung', cash: 'Bar', paypal: 'PayPal', other: 'Sonstige' };

export function monthLabel(ym) {
  const [y, m] = ym.split('-').map(Number);
  return `${MONTHS_DE[m - 1]} ${y}`;
}

function extOf(mime) {
  return { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/heic': 'heic', 'image/heif': 'heif', 'application/pdf': 'pdf' }[mime] || 'bin';
}

// Decide file names for every entry file so CSV, PDF and ZIP agree
function planFiles(data) {
  const plan = [];
  const used = new Set();
  const unique = (dir, name) => {
    let candidate = name;
    let i = 2;
    while (used.has(`${dir}/${candidate}`)) {
      candidate = name.replace(/(\.[a-z0-9]+)$/i, `_${i}$1`);
      i++;
    }
    used.add(`${dir}/${candidate}`);
    return candidate;
  };
  for (const inv of data.invoices) {
    const cl = inv.client?.company || inv.client?.contact || '';
    const name = unique(FOLDER_DIRS.invoices, `${safeFileName(inv.number)}_${safeFileName(cl, 40)}.pdf`);
    plan.push({ type: 'invoice', id: inv.id, dir: FOLDER_DIRS.invoices, name });
    inv.zipName = name;
  }
  for (const folder of ['income', 'purchase', 'subscription', 'other', 'bank']) {
    for (const e of data.entries[folder]) {
      e.zipNames = [];
      const amount = e.amount_cents ? `_${fmtNum(e.amount_cents)}EUR` : '';
      const base = `${e.date}_${safeFileName(e.vendor || FOLDER_LABEL[folder], 40)}${amount}`;
      e.files.forEach((f, idx) => {
        const suffix = e.files.length > 1 ? `_Teil${idx + 1}` : '';
        const name = unique(FOLDER_DIRS[folder], `${base}${suffix}.${extOf(f.mime)}`);
        plan.push({ type: 'file', id: f.id, dir: FOLDER_DIRS[folder], name });
        e.zipNames.push(name);
      });
    }
  }
  return plan;
}

function csvEscape(v) {
  const s = String(v ?? '');
  return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function buildCsv(data) {
  const head = ['Datum', 'Belegnummer', 'Art', 'Geschäftspartner', 'Beschreibung', 'Netto', 'USt', 'Einnahme (brutto)', 'Ausgabe (brutto)', 'Zahlungsart', 'Status', 'Datei'];
  const rows = [head];
  for (const inv of data.invoices) {
    const kind = inv.kind === 'storno' ? 'Stornorechnung' : 'Ausgangsrechnung';
    const status = inv.kind === 'storno' ? 'Storno' : inv.status === 'paid' ? `Bezahlt ${fmtDate(inv.paid_date)}` : inv.status === 'cancelled' ? 'Storniert' : 'Offen';
    rows.push([fmtDate(inv.issue_date), inv.number, kind, inv.client?.company || inv.client?.contact || '', inv.title || '',
      fmtNum(inv.net_cents), fmtNum(inv.tax_cents), fmtNum(inv.total_cents), '', 'Überweisung', status, inv.zipName]);
  }
  for (const folder of ['income', 'purchase', 'subscription', 'other', 'bank']) {
    for (const e of data.entries[folder]) {
      const isIncome = folder === 'income';
      const isBank = folder === 'bank';
      rows.push([fmtDate(e.date), '', FOLDER_LABEL[folder], e.vendor, [e.description, e.notes].filter(Boolean).join(' – '),
        '', '', isIncome ? fmtNum(e.amount_cents) : '', !isIncome && !isBank ? fmtNum(e.amount_cents) : '',
        METHOD_DE[e.payment_method] || '', e.files.length ? 'Beleg vorhanden' : 'BELEG FEHLT', e.zipNames.join(', ')]);
    }
  }
  rows.push([]);
  rows.push(['', '', 'Summe Einnahmen', '', '', '', '', fmtNum(data.totals.income_cents), '', '', '', '']);
  rows.push(['', '', 'Summe Ausgaben', '', '', '', '', '', fmtNum(data.totals.expenses_cents), '', '', '']);
  return '﻿' + rows.map((r) => r.map(csvEscape).join(';')).join('\r\n');
}

async function buildSummaryPdf(data, settings) {
  const doc = new PDFDocument({ size: 'A4', margins: { top: 50, bottom: 40, left: 50, right: 50 }, bufferPages: true,
    info: { Title: `Monatsübersicht ${monthLabel(data.ym)}`, Author: settings.company.name } });
  registerFonts(doc, 'inter');
  const accent = safeHex(settings.invoice.accentColor);
  const W = 595.28 - 100;
  const dark = '#111827';
  const mid = '#6b7280';
  let y = 50;
  const text = (s, x, yy, o = {}) => {
    doc.font(o.font || 'R').fontSize(o.size || 9).fillColor(o.color || dark).text(String(s ?? ''), x, yy, { width: o.width, align: o.align || 'left', lineBreak: o.lineBreak ?? true });
  };
  const ensure = (h) => { if (y + h > 790) { doc.addPage(); y = 50; } };

  text(settings.company.name, 50, y, { font: 'B', size: 11, color: accent });
  text(`Erstellt am ${fmtDate(todayBerlin())}`, 50, y, { size: 8, color: mid, width: W, align: 'right' });
  y += 22;
  text(`Buchhaltungsunterlagen ${monthLabel(data.ym)}`, 50, y, { font: 'B', size: 18 });
  y += 28;
  const c = settings.company;
  text([c.owner && `Inhaberin/Inhaber: ${c.owner}`, `${c.street}, ${c.zip} ${c.city}`, c.vatId && `USt-IdNr.: ${c.vatId}`, c.taxNumber && `Steuernr.: ${c.taxNumber}`,
    settings.tax.mode === 'kleinunternehmer' ? 'Besteuerung: Kleinunternehmer gem. § 19 UStG' : 'Besteuerung: Regelbesteuerung'].filter(Boolean).join('\n'), 50, y, { size: 8.5, color: mid, width: W });
  y = doc.y + 16;

  // Totals boxes
  const boxes = [
    ['Einnahmen', data.totals.income_cents],
    ['Ausgaben', data.totals.expenses_cents],
    ['Ergebnis (vorläufig)', data.totals.profit_cents],
  ];
  const bw = (W - 20) / 3;
  boxes.forEach(([label, cents], i) => {
    const x = 50 + i * (bw + 10);
    doc.save().roundedRect(x, y, bw, 52, 6).fill(i === 2 ? accent : '#f3f4f6').restore();
    text(label, x + 12, y + 10, { size: 8.5, color: i === 2 ? '#ffffff' : mid, width: bw - 24 });
    text(fmtEur(cents), x + 12, y + 25, { font: 'B', size: 14, color: i === 2 ? '#ffffff' : dark, width: bw - 24 });
  });
  y += 70;

  const missing = [];
  for (const f of ['purchase', 'subscription', 'other', 'income']) for (const e of data.entries[f]) if (!e.files.length) missing.push(e);
  const missSubs = data.subscriptions.filter((s) => !s.entry_id);
  if (missing.length || missSubs.length || !data.checks.bankStatement) {
    const lines = [];
    if (!data.checks.bankStatement) lines.push('• Kontoauszug für diesen Monat fehlt noch.');
    for (const e of missing) lines.push(`• Beleg fehlt: ${fmtDate(e.date)} ${e.vendor || ''} ${fmtEur(e.amount_cents)}`);
    for (const s of missSubs) lines.push(`• Abo ohne Beleg: ${s.name} (${fmtEur(s.amount_cents)})`);
    const h = lines.length * 12 + 26;
    ensure(h);
    doc.save().roundedRect(50, y, W, h, 6).fill('#fef3c7').restore();
    text('Hinweise', 62, y + 9, { font: 'B', size: 9, color: '#92400e' });
    text(lines.join('\n'), 62, y + 23, { size: 8.5, color: '#78350f', width: W - 24 });
    y += h + 14;
  }

  const section = (title, rows, cols, sumLabel, sumCents) => {
    ensure(60);
    text(title, 50, y, { font: 'B', size: 11.5 });
    y += 18;
    let x = 50;
    doc.save().rect(50, y - 3, W, 16).fill('#f3f4f6').restore();
    for (const col of cols) { text(col.h, x + 4, y, { font: 'M', size: 7.8, color: mid, width: col.w - 8, align: col.a }); x += col.w; }
    y += 17;
    if (!rows.length) { text('Keine Einträge', 54, y, { size: 8.5, color: mid }); y += 16; }
    for (const r of rows) {
      doc.font('R').fontSize(8.3);
      const h = Math.max(...cols.map((col, i) => doc.heightOfString(String(r[i] ?? ''), { width: col.w - 8 }))) + 6;
      ensure(h);
      x = 50;
      cols.forEach((col, i) => { text(r[i], x + 4, y, { size: 8.3, width: col.w - 8, align: col.a, color: String(r[i]).includes('FEHLT') ? '#b91c1c' : dark }); x += col.w; });
      y += h;
      doc.save().moveTo(50, y - 2).lineTo(50 + W, y - 2).lineWidth(0.4).strokeColor('#e5e7eb').stroke().restore();
    }
    if (sumLabel) {
      text(sumLabel, 50, y + 2, { font: 'B', size: 9, width: W - 110 });
      text(fmtEur(sumCents), 50 + W - 110, y + 2, { font: 'B', size: 9, width: 106, align: 'right' });
      y += 18;
    }
    y += 12;
  };

  const invCols = [{ h: 'Datum', w: 60 }, { h: 'Nummer', w: 82 }, { h: 'Kunde', w: 150 }, { h: 'Status', w: 93 }, { h: 'Betrag', w: W - 385, a: 'right' }];
  const invRows = data.invoices.map((i) => [fmtDate(i.issue_date), i.number, i.client?.company || i.client?.contact || '',
    i.kind === 'storno' ? 'Stornorechnung' : i.status === 'paid' ? 'Bezahlt' : i.status === 'cancelled' ? 'Storniert' : 'Offen', fmtEur(i.total_cents)]);
  for (const e of data.entries.income) invRows.push([fmtDate(e.date), 'extern', e.vendor, e.files.length ? 'Beleg anbei' : 'BELEG FEHLT', fmtEur(e.amount_cents)]);
  section('Einnahmen – Ausgangsrechnungen', invRows, invCols, 'Summe Einnahmen', data.totals.income_cents);

  const eCols = [{ h: 'Datum', w: 60 }, { h: 'Lieferant', w: 120 }, { h: 'Beschreibung', w: 140 }, { h: 'Zahlung', w: 65 }, { h: 'Beleg', w: 45 }, { h: 'Betrag', w: W - 430, a: 'right' }];
  const eRows = (list) => list.map((e) => [fmtDate(e.date), e.vendor, e.description, METHOD_DE[e.payment_method] || '', e.files.length ? `${e.files.length} Datei${e.files.length > 1 ? 'en' : ''}` : 'FEHLT', fmtEur(e.amount_cents)]);
  section('Ausgaben – Einkäufe', eRows(data.entries.purchase), eCols, 'Summe Einkäufe', data.totals.purchase_cents);
  section('Ausgaben – Abonnements & Fixkosten', eRows(data.entries.subscription), eCols, 'Summe Abonnements', data.totals.subscription_cents);
  section('Ausgaben – Sonstige', eRows(data.entries.other), eCols, 'Summe Sonstige', data.totals.other_cents);
  section('Kontoauszug', data.entries.bank.map((e) => [fmtDate(e.date), e.vendor || 'Kontoauszug', e.description, '', e.files.length ? 'anbei' : 'FEHLT', '']), eCols);

  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(range.start + i);
    doc.page.margins.bottom = 0;
    doc.font('R').fontSize(7).fillColor(mid).text(`${settings.company.name} · ${monthLabel(data.ym)} · Seite ${i + 1} von ${range.count}`, 50, 815, { width: W, align: 'center', lineBreak: false });
  }
  return pdfToBuffer(doc);
}

exportRouter.get('/months/:ym/export', wrap(async (req, res) => {
  const ym = assertYm(req.params.ym);
  const settings = getSettings();
  const data = monthData(ym);
  const plan = planFiles(data);
  const root = `GoTrend_Buchhaltung_${ym}`;
  const summary = await buildSummaryPdf(data, settings);
  const csv = buildCsv(data);

  // Generate invoice PDFs before streaming so errors can still return JSON
  const invoicePdfs = {};
  for (const item of plan.filter((p) => p.type === 'invoice')) {
    const inv = parseInvoice(db.prepare('SELECT * FROM invoices WHERE id = ?').get(item.id));
    invoicePdfs[item.id] = await getInvoicePdf(inv);
  }

  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="${root}.zip"`);
  res.setHeader('Cache-Control', 'no-store');
  const zip = new ZipArchive({ zlib: { level: 6 } });
  zip.on('error', (e) => { console.error(e); res.destroy(e); });
  zip.pipe(res);
  zip.append(summary, { name: `${root}/00_Monatsuebersicht_${ym}.pdf` });
  zip.append(csv, { name: `${root}/00_Buchungsliste_${ym}.csv` });
  for (const item of plan) {
    if (item.type === 'invoice') {
      zip.append(invoicePdfs[item.id], { name: `${root}/${item.dir}/${item.name}` });
    } else {
      const f = db.prepare('SELECT stored_name FROM files WHERE id = ?').get(item.id);
      const p = f && path.join(FILES_DIR, f.stored_name);
      if (p && fs.existsSync(p)) zip.file(p, { name: `${root}/${item.dir}/${item.name}` });
    }
  }
  await zip.finalize();
  db.prepare("INSERT INTO months (ym, exported_at) VALUES (?, datetime('now')) ON CONFLICT(ym) DO UPDATE SET exported_at = excluded.exported_at").run(ym);
  audit(req, 'export', 'month', null, ym);
}));

exportRouter.get('/months/:ym/summary.pdf', wrap(async (req, res) => {
  const ym = assertYm(req.params.ym);
  const data = monthData(ym);
  planFiles(data);
  const buf = await buildSummaryPdf(data, getSettings());
  res.type('application/pdf').setHeader('Content-Disposition', `inline; filename="Monatsuebersicht_${ym}.pdf"`);
  res.send(buf);
}));

// ───────────── Backups ─────────────
export async function snapshotDb(target) {
  await db.backup(target);
}

export async function runDailyBackup() {
  const name = `gotrend_${todayBerlin()}.db`;
  const target = path.join(BACKUP_DIR, name);
  if (!fs.existsSync(target)) {
    await snapshotDb(target);
    console.log(`[backup] ${name}`);
  }
  const all = fs.readdirSync(BACKUP_DIR).filter((f) => f.endsWith('.db')).sort();
  for (const old of all.slice(0, Math.max(0, all.length - 30))) fs.rmSync(path.join(BACKUP_DIR, old), { force: true });
}

exportRouter.get('/backup', wrap(async (req, res) => {
  const tmp = path.join(DATA_DIR, `export_${Date.now()}.db`);
  await snapshotDb(tmp);
  const name = `GoTrend_Sicherung_${todayBerlin()}`;
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="${name}.zip"`);
  const zip = new ZipArchive({ zlib: { level: 6 } });
  zip.on('error', (e) => res.destroy(e));
  res.on('close', () => fs.rmSync(tmp, { force: true }));
  zip.pipe(res);
  zip.file(tmp, { name: `${name}/gotrend.db` });
  zip.directory(FILES_DIR, `${name}/files`);
  zip.directory(INVOICE_PDF_DIR, `${name}/invoices`);
  zip.append('Wiederherstellen: Inhalt dieses Ordners in das Datenverzeichnis (DATA_DIR) kopieren und den Server neu starten.\n', { name: `${name}/LIESMICH.txt` });
  await zip.finalize();
  audit(req, 'backup_download', 'system', null);
}));
