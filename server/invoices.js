import fs from 'node:fs';
import path from 'node:path';
import { Router } from 'express';
import { db, tx, INVOICE_PDF_DIR, FILES_DIR } from './db.js';
import { getSettings } from './settings.js';
import { normaliseItems, computeTotals } from './calc.js';
import { renderInvoicePdf } from './pdf/invoice.js';
import { HttpError, wrap, str, assertDate, isDate, addDays, todayBerlin, audit, safeFileName } from './util.js';

export const invoicesRouter = Router();

const KINDS = ['invoice', 'quote', 'storno'];
const TREATMENTS = ['auto', 'reverse_charge', 'export'];

export function getLogo(settings = getSettings()) {
  if (!settings.invoice.hasLogo) return null;
  for (const ext of ['png', 'jpg']) {
    const p = path.join(FILES_DIR, `logo.${ext}`);
    if (fs.existsSync(p)) return fs.readFileSync(p);
  }
  return null;
}

export function parseInvoice(row) {
  if (!row) return null;
  return {
    ...row,
    items: JSON.parse(row.items || '[]'),
    client: JSON.parse(row.client_snapshot || '{}'),
    client_snapshot: undefined,
  };
}

function getRow(id) {
  const row = db.prepare('SELECT * FROM invoices WHERE id = ?').get(Number(id));
  if (!row) throw new HttpError(404, 'الفاتورة مو موجودة');
  return row;
}

export function clientSnapshot(clientId) {
  if (!clientId) return {};
  const c = db.prepare('SELECT * FROM clients WHERE id = ?').get(Number(clientId));
  if (!c) throw new HttpError(400, 'العميل مو موجود');
  return {
    id: c.id,
    customer_no: `K-${String(c.id).padStart(4, '0')}`,
    company: c.company,
    contact: c.contact,
    street: c.street,
    zip: c.zip,
    city: c.city,
    country: c.country,
    email: c.email,
    phone: c.phone,
    vat_id: c.vat_id,
  };
}

// Build a clean invoice record from request body (used for create, update and preview)
function buildFromBody(body, existing, settings) {
  const kind = existing?.kind || (KINDS.includes(body.kind) ? body.kind : 'invoice');
  if (kind === 'storno' && !existing) throw new HttpError(400, 'نوع غير مسموح');
  const taxMode = settings.tax.mode;
  const issue_date = body.issue_date ? assertDate(body.issue_date, 'issue_date') : existing?.issue_date || todayBerlin();
  const client_id = body.client_id ? Number(body.client_id) : null;
  const items = normaliseItems(body.items, taxMode, settings.tax.defaultRate);
  const treatment = taxMode === 'standard' && TREATMENTS.includes(body.tax_treatment) ? body.tax_treatment : 'auto';
  const totals = computeTotals(items, taxMode, treatment);
  let due_date = body.due_date && isDate(body.due_date) ? body.due_date : null;
  if (!due_date) {
    const c = client_id ? db.prepare('SELECT payment_days FROM clients WHERE id = ?').get(client_id) : null;
    const days = kind === 'quote' ? settings.invoice.quoteValidDays : c?.payment_days ?? settings.invoice.paymentDays;
    due_date = addDays(issue_date, days);
  }
  return {
    kind,
    client_id,
    client: client_id ? clientSnapshot(client_id) : {},
    issue_date,
    service_from: body.service_from && isDate(body.service_from) ? body.service_from : null,
    service_to: body.service_to && isDate(body.service_to) ? body.service_to : null,
    due_date,
    language: body.language === 'en' ? 'en' : 'de',
    tax_treatment: treatment,
    tax_mode: taxMode,
    title: str(body.title, 200),
    items,
    intro_text: str(body.intro_text, 3000),
    outro_text: str(body.outro_text, 3000),
    internal_note: str(body.internal_note, 3000),
    ...totals,
  };
}

async function renderFor(inv, { draft } = {}) {
  const settings = getSettings();
  let related = null;
  if (inv.kind === 'storno' && inv.related_id) {
    related = db.prepare('SELECT number, issue_date FROM invoices WHERE id = ?').get(inv.related_id);
  }
  // For frozen invoices we must render with the tax mode they were issued with
  return renderInvoicePdf(inv, settings, getLogo(settings), { draft, related });
}

function nextNumber(kind, year) {
  const settings = getSettings();
  const prefix = { invoice: settings.numbering.invoicePrefix, quote: settings.numbering.quotePrefix, storno: settings.numbering.stornoPrefix }[kind];
  const digits = Math.min(Math.max(Number(settings.numbering.digits) || 4, 3), 6);
  let row = db.prepare('SELECT next FROM counters WHERE kind = ? AND year = ?').get(kind, year);
  let n = row ? row.next : 1;
  // Never reuse an existing number (e.g. after prefix change back and forth)
  for (;;) {
    const number = `${prefix}-${year}-${String(n).padStart(digits, '0')}`;
    const exists = db.prepare('SELECT 1 FROM invoices WHERE number = ?').get(number);
    if (!exists) {
      db.prepare('INSERT INTO counters (kind, year, next) VALUES (?,?,?) ON CONFLICT(kind, year) DO UPDATE SET next = excluded.next')
        .run(kind, year, n + 1);
      return number;
    }
    n++;
  }
}

async function freezePdf(id) {
  const inv = parseInvoice(getRow(id));
  const buf = await renderFor(inv, { draft: false });
  const file = `${inv.id}_${safeFileName(inv.number)}.pdf`;
  fs.writeFileSync(path.join(INVOICE_PDF_DIR, file), buf);
  db.prepare('UPDATE invoices SET pdf_file = ? WHERE id = ?').run(file, inv.id);
  return file;
}

export async function getInvoicePdf(inv) {
  if (inv.number && inv.pdf_file) {
    const p = path.join(INVOICE_PDF_DIR, inv.pdf_file);
    if (fs.existsSync(p)) return fs.readFileSync(p);
  }
  if (inv.number && !inv.pdf_file) {
    await freezePdf(inv.id);
    return getInvoicePdf(parseInvoice(getRow(inv.id)));
  }
  return renderFor(inv, { draft: inv.status === 'draft' });
}

export function invoicePdfName(inv) {
  const cl = inv.client?.company || inv.client?.contact || '';
  const base = inv.number || `Entwurf_${inv.id}`;
  return `${safeFileName(base)}${cl ? '_' + safeFileName(cl, 40) : ''}.pdf`;
}

function insertInvoice(data, extra = {}) {
  const r = { ...data, ...extra };
  const info = db.prepare(`INSERT INTO invoices
    (kind, number, status, client_id, client_snapshot, issue_date, service_from, service_to, due_date, language, tax_treatment,
     title, items, intro_text, outro_text, internal_note, net_cents, tax_cents, total_cents, tax_mode, related_id, cancel_reason, issued_at)
    VALUES (@kind, @number, @status, @client_id, @client_snapshot, @issue_date, @service_from, @service_to, @due_date, @language, @tax_treatment,
     @title, @items, @intro_text, @outro_text, @internal_note, @net_cents, @tax_cents, @total_cents, @tax_mode, @related_id, @cancel_reason, @issued_at)`)
    .run({
      number: null,
      status: 'draft',
      related_id: null,
      cancel_reason: '',
      issued_at: null,
      ...r,
      client_snapshot: JSON.stringify(r.client || {}),
      items: JSON.stringify(r.items || []),
    });
  return Number(info.lastInsertRowid);
}

// ───────────── Routes ─────────────

invoicesRouter.get('/', (req, res) => {
  const where = [];
  const params = {};
  if (KINDS.includes(req.query.kind)) { where.push('kind = @kind'); params.kind = req.query.kind; }
  if (req.query.status) { where.push('status = @status'); params.status = String(req.query.status); }
  if (req.query.client_id) { where.push('client_id = @client_id'); params.client_id = Number(req.query.client_id); }
  if (req.query.year) { where.push("substr(issue_date,1,4) = @year"); params.year = String(req.query.year); }
  if (req.query.q) {
    where.push("(number LIKE @q OR title LIKE @q OR client_snapshot LIKE @q)");
    params.q = `%${String(req.query.q).slice(0, 80)}%`;
  }
  const rows = db.prepare(`SELECT id, kind, number, status, client_id, client_snapshot, issue_date, due_date, title, net_cents, tax_cents, total_cents,
      related_id, cancelled_by_id, converted_to_id, paid_date, created_at, updated_at
    FROM invoices ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY (status = 'draft') DESC, issue_date DESC, id DESC LIMIT 1000`).all(params);
  res.json(rows.map((r) => ({ ...r, client: JSON.parse(r.client_snapshot || '{}'), client_snapshot: undefined })));
});

invoicesRouter.get('/:id', (req, res) => {
  const inv = parseInvoice(getRow(req.params.id));
  const related = inv.related_id ? db.prepare('SELECT id, kind, number, issue_date FROM invoices WHERE id = ?').get(inv.related_id) : null;
  const cancelledBy = inv.cancelled_by_id ? db.prepare('SELECT id, number, issue_date FROM invoices WHERE id = ?').get(inv.cancelled_by_id) : null;
  const convertedTo = inv.converted_to_id ? db.prepare('SELECT id, number, status FROM invoices WHERE id = ?').get(inv.converted_to_id) : null;
  res.json({ ...inv, related, cancelledBy, convertedTo });
});

invoicesRouter.post('/', wrap((req, res) => {
  const settings = getSettings();
  const data = buildFromBody(req.body, null, settings);
  if (data.kind === 'storno') throw new HttpError(400, 'نوع غير مسموح');
  const id = insertInvoice(data);
  audit(req, 'create', data.kind, id);
  res.json({ id });
}));

invoicesRouter.put('/:id', wrap((req, res) => {
  const row = getRow(req.params.id);
  if (row.status !== 'draft') {
    // Only the internal note may change after issuing (GoBD)
    if (req.body.internal_note !== undefined) {
      db.prepare("UPDATE invoices SET internal_note = ?, updated_at = datetime('now') WHERE id = ?").run(str(req.body.internal_note, 3000), row.id);
      return res.json({ ok: true });
    }
    throw new HttpError(400, 'ما فيك تعدّل فاتورة صادرة. استعمل "تصحيح الفاتورة"');
  }
  const settings = getSettings();
  const d = buildFromBody(req.body, row, settings);
  db.prepare(`UPDATE invoices SET client_id=@client_id, client_snapshot=@client_snapshot, issue_date=@issue_date, service_from=@service_from,
      service_to=@service_to, due_date=@due_date, language=@language, tax_treatment=@tax_treatment, tax_mode=@tax_mode, title=@title, items=@items,
      intro_text=@intro_text, outro_text=@outro_text, internal_note=@internal_note, net_cents=@net_cents, tax_cents=@tax_cents,
      total_cents=@total_cents, updated_at=datetime('now') WHERE id=@id`)
    .run({ ...d, client_snapshot: JSON.stringify(d.client), items: JSON.stringify(d.items), id: row.id });
  audit(req, 'update', row.kind, row.id);
  res.json({ ok: true });
}));

invoicesRouter.delete('/:id', wrap((req, res) => {
  const row = getRow(req.params.id);
  if (row.status !== 'draft') throw new HttpError(400, 'ما فيك تحذف فاتورة صادرة. فيك تلغيها بفاتورة إلغاء');
  db.prepare('DELETE FROM invoices WHERE id = ?').run(row.id);
  audit(req, 'delete', row.kind, row.id, 'draft');
  res.json({ ok: true });
}));

// Live preview from unsaved form data
invoicesRouter.post('/preview', wrap(async (req, res) => {
  const settings = getSettings();
  const base = req.body.id ? db.prepare('SELECT * FROM invoices WHERE id = ?').get(Number(req.body.id)) : null;
  const data = buildFromBody(req.body, base && base.status === 'draft' ? base : null, settings);
  if (!data.client_id && req.body.client) data.client = req.body.client;
  const buf = await renderInvoicePdf({ ...data, number: null, status: 'draft' }, settings, getLogo(settings), { draft: true });
  res.type('application/pdf').send(buf);
}));

invoicesRouter.get('/:id/pdf', wrap(async (req, res) => {
  const inv = parseInvoice(getRow(req.params.id));
  const buf = await getInvoicePdf(inv);
  res.type('application/pdf');
  res.setHeader('Content-Disposition', `${req.query.download ? 'attachment' : 'inline'}; filename="${invoicePdfName(inv)}"`);
  res.setHeader('Cache-Control', 'private, no-store');
  res.send(buf);
}));

invoicesRouter.post('/:id/issue', wrap(async (req, res) => {
  const row = getRow(req.params.id);
  if (row.status !== 'draft') throw new HttpError(400, 'هي الفاتورة صادرة من قبل');
  const items = JSON.parse(row.items);
  if (!row.client_id) throw new HttpError(400, 'اختار العميل أول');
  if (!items.length) throw new HttpError(400, 'ضيف بند واحد على الأقل');
  if (row.kind === 'invoice' && row.total_cents <= 0) throw new HttpError(400, 'مبلغ الفاتورة لازم يكون أكبر من صفر');
  const settings = getSettings();
  tx(() => {
    const number = nextNumber(row.kind, Number(row.issue_date.slice(0, 4)));
    // Recalculate with the current tax mode and freeze client data at issue time
    const fresh = normaliseItems(items, settings.tax.mode, settings.tax.defaultRate);
    const treatment = settings.tax.mode === 'standard' ? row.tax_treatment : 'auto';
    const totals = computeTotals(fresh, settings.tax.mode, treatment);
    db.prepare(`UPDATE invoices SET number = ?, status = 'issued', client_snapshot = ?, tax_mode = ?, tax_treatment = ?, items = ?,
        net_cents = ?, tax_cents = ?, total_cents = ?, issued_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`)
      .run(number, JSON.stringify(clientSnapshot(row.client_id)), settings.tax.mode, treatment, JSON.stringify(fresh),
        totals.net_cents, totals.tax_cents, totals.total_cents, row.id);
    audit(req, 'issue', row.kind, row.id, number);
  });
  await freezePdf(row.id);
  res.json(parseInvoice(getRow(row.id)));
}));

invoicesRouter.post('/:id/paid', wrap((req, res) => {
  const row = getRow(req.params.id);
  if (row.kind !== 'invoice') throw new HttpError(400, 'بس الفواتير بتندفع');
  if (!['issued', 'paid'].includes(row.status)) throw new HttpError(400, 'لازم تكون الفاتورة صادرة');
  if (req.body.paid === false) {
    db.prepare("UPDATE invoices SET status = 'issued', paid_date = NULL, updated_at = datetime('now') WHERE id = ?").run(row.id);
    audit(req, 'unpaid', 'invoice', row.id);
  } else {
    const date = req.body.date && isDate(req.body.date) ? req.body.date : todayBerlin();
    db.prepare("UPDATE invoices SET status = 'paid', paid_date = ?, updated_at = datetime('now') WHERE id = ?").run(date, row.id);
    audit(req, 'paid', 'invoice', row.id, date);
  }
  res.json({ ok: true });
}));

function createStorno(req, row, reason) {
  const items = JSON.parse(row.items).map((it) => ({ ...it, price_cents: -it.price_cents, total_cents: -it.total_cents }));
  const date = req.body.date && isDate(req.body.date) ? req.body.date : todayBerlin();
  const number = nextNumber('storno', Number(date.slice(0, 4)));
  const id = insertInvoice({
    kind: 'storno',
    number,
    status: 'issued',
    client_id: row.client_id,
    client: JSON.parse(row.client_snapshot),
    issue_date: date,
    service_from: row.service_from,
    service_to: row.service_to,
    due_date: null,
    language: row.language,
    tax_treatment: row.tax_treatment,
    tax_mode: row.tax_mode,
    title: row.title,
    items,
    intro_text: '',
    outro_text: '',
    internal_note: '',
    net_cents: -row.net_cents,
    tax_cents: -row.tax_cents,
    total_cents: -row.total_cents,
    related_id: row.id,
    cancel_reason: reason,
    issued_at: new Date().toISOString(),
  });
  db.prepare("UPDATE invoices SET status = 'cancelled', cancelled_by_id = ?, cancel_reason = ?, updated_at = datetime('now') WHERE id = ?")
    .run(id, reason, row.id);
  audit(req, 'cancel', 'invoice', row.id, { storno: number, reason });
  return id;
}

invoicesRouter.post('/:id/cancel', wrap(async (req, res) => {
  const row = getRow(req.params.id);
  const reason = str(req.body.reason, 300);
  if (row.kind === 'quote') {
    if (row.status === 'draft') throw new HttpError(400, 'احذف المسودة بدل الإلغاء');
    db.prepare("UPDATE invoices SET status = 'declined', cancel_reason = ?, updated_at = datetime('now') WHERE id = ?").run(reason, row.id);
    audit(req, 'decline', 'quote', row.id, reason);
    return res.json({ ok: true });
  }
  if (row.kind !== 'invoice' || !['issued', 'paid'].includes(row.status)) throw new HttpError(400, 'ما فيك تلغي هي الفاتورة');
  if (!reason) throw new HttpError(400, 'اكتب سبب الإلغاء');
  const stornoId = tx(() => createStorno(req, row, reason));
  await freezePdf(stornoId);
  res.json({ stornoId });
}));

// Correct an issued invoice: cancel with storno and create an editable copy
invoicesRouter.post('/:id/correct', wrap(async (req, res) => {
  const row = getRow(req.params.id);
  if (row.kind !== 'invoice' || !['issued', 'paid'].includes(row.status)) throw new HttpError(400, 'ما فيك تصحح هي الفاتورة');
  const reason = str(req.body.reason, 300) || 'Rechnungskorrektur';
  let stornoId;
  let newId;
  tx(() => {
    stornoId = createStorno(req, row, reason);
    newId = insertInvoice({
      kind: 'invoice',
      client_id: row.client_id,
      client: JSON.parse(row.client_snapshot),
      issue_date: todayBerlin(),
      service_from: row.service_from,
      service_to: row.service_to,
      due_date: null,
      language: row.language,
      tax_treatment: row.tax_treatment,
      tax_mode: row.tax_mode,
      title: row.title,
      items: JSON.parse(row.items),
      intro_text: row.intro_text,
      outro_text: row.outro_text,
      internal_note: `Korrektur von ${row.number}`,
      net_cents: row.net_cents,
      tax_cents: row.tax_cents,
      total_cents: row.total_cents,
      related_id: row.id,
    });
    const settings = getSettings();
    const c = row.client_id ? db.prepare('SELECT payment_days FROM clients WHERE id = ?').get(row.client_id) : null;
    db.prepare('UPDATE invoices SET due_date = ? WHERE id = ?').run(addDays(todayBerlin(), c?.payment_days ?? settings.invoice.paymentDays), newId);
    audit(req, 'correct', 'invoice', row.id, { newId });
  });
  await freezePdf(stornoId);
  res.json({ stornoId, newId });
}));

invoicesRouter.post('/:id/quote-status', wrap((req, res) => {
  const row = getRow(req.params.id);
  if (row.kind !== 'quote' || row.status === 'draft') throw new HttpError(400, 'غير مسموح');
  const status = ['issued', 'accepted', 'declined'].includes(req.body.status) ? req.body.status : null;
  if (!status) throw new HttpError(400, 'حالة غير صحيحة');
  db.prepare("UPDATE invoices SET status = ?, updated_at = datetime('now') WHERE id = ?").run(status, row.id);
  audit(req, 'quote_status', 'quote', row.id, status);
  res.json({ ok: true });
}));

// Quote → invoice draft, or duplicate anything into a new draft
function copyToDraft(req, row, kind) {
  const settings = getSettings();
  const isLang = row.language === 'en' ? 'En' : 'De';
  const issue = todayBerlin();
  const items = JSON.parse(row.items).map((it) => ({ ...it, price_cents: Math.abs(it.price_cents), total_cents: Math.abs(it.total_cents) }));
  const totals = computeTotals(items, settings.tax.mode, row.tax_treatment);
  const c = row.client_id ? db.prepare('SELECT payment_days FROM clients WHERE id = ?').get(row.client_id) : null;
  const days = kind === 'quote' ? settings.invoice.quoteValidDays : c?.payment_days ?? settings.invoice.paymentDays;
  const fromQuote = row.kind === 'quote' && kind === 'invoice';
  return insertInvoice({
    kind,
    client_id: row.client_id,
    client: row.client_id ? clientSnapshot(row.client_id) : JSON.parse(row.client_snapshot),
    issue_date: issue,
    service_from: null,
    service_to: null,
    due_date: addDays(issue, days),
    language: row.language,
    tax_treatment: row.tax_treatment,
    tax_mode: settings.tax.mode,
    title: row.title,
    items,
    intro_text: fromQuote ? settings.invoice[`intro${isLang}`] : row.intro_text,
    outro_text: fromQuote ? settings.invoice[`outro${isLang}`] : row.outro_text,
    internal_note: fromQuote ? `Aus Angebot ${row.number || ''}`.trim() : '',
    ...totals,
    related_id: fromQuote ? row.id : null,
  });
}

invoicesRouter.post('/:id/convert', wrap((req, res) => {
  const row = getRow(req.params.id);
  if (row.kind !== 'quote') throw new HttpError(400, 'بس عرض السعر بيتحوّل لفاتورة');
  const id = tx(() => {
    const newId = copyToDraft(req, row, 'invoice');
    db.prepare("UPDATE invoices SET converted_to_id = ?, status = CASE WHEN status IN ('issued','draft') THEN 'accepted' ELSE status END, updated_at = datetime('now') WHERE id = ?")
      .run(newId, row.id);
    audit(req, 'convert', 'quote', row.id, { invoice: newId });
    return newId;
  });
  res.json({ id });
}));

invoicesRouter.post('/:id/duplicate', wrap((req, res) => {
  const row = getRow(req.params.id);
  const kind = row.kind === 'storno' ? 'invoice' : row.kind;
  const id = copyToDraft(req, row, kind);
  audit(req, 'duplicate', kind, id, { from: row.id });
  res.json({ id });
}));
