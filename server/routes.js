import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { Router } from 'express';
import multer from 'multer';
import { fileTypeFromFile } from 'file-type';
import { db, tx, FILES_DIR } from './db.js';
import { getSettings, saveSettings } from './settings.js';
import {
  HttpError, wrap, str, toCents, assertDate, assertYm, monthRange, todayBerlin, audit, intOrNull, validIban,
} from './util.js';

export const router = Router();

const FOLDERS = ['purchase', 'subscription', 'other', 'income', 'bank'];
const METHODS = ['card', 'bank', 'cash', 'paypal', 'other'];
const ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'application/pdf'];

// ───────────── Upload handling ─────────────
const upload = multer({
  storage: multer.diskStorage({
    destination: FILES_DIR,
    filename: (_req, _file, cb) => cb(null, `${Date.now()}_${crypto.randomBytes(8).toString('hex')}.upload`),
  }),
  limits: { fileSize: 25 * 1024 * 1024, files: 12 },
  defParamCharset: 'utf8',
});

function sha256File(p) {
  return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
}

async function storeUploadedFiles(entryId, files) {
  const stored = [];
  const duplicates = [];
  for (const f of files || []) {
    const type = await fileTypeFromFile(f.path).catch(() => null);
    const mime = type?.mime;
    if (!mime || !ALLOWED_MIME.includes(mime)) {
      fs.rmSync(f.path, { force: true });
      throw new HttpError(400, `نوع الملف مو مدعوم: ${f.originalname}. المسموح: صور أو PDF`);
    }
    const ext = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/heic': 'heic', 'image/heif': 'heif', 'application/pdf': 'pdf' }[mime];
    const finalName = f.filename.replace(/\.upload$/, `.${ext}`);
    fs.renameSync(f.path, path.join(FILES_DIR, finalName));
    const hash = sha256File(path.join(FILES_DIR, finalName));
    const dup = db.prepare(`SELECT f.entry_id, e.date, e.vendor FROM files f JOIN entries e ON e.id = f.entry_id
      WHERE f.sha256 = ? AND e.deleted_at IS NULL AND f.entry_id != ? LIMIT 1`).get(hash, entryId);
    if (dup) duplicates.push({ file: f.originalname, ...dup });
    const original = f.originalname;
    const info = db.prepare('INSERT INTO files (entry_id, original_name, stored_name, mime, size, sha256) VALUES (?,?,?,?,?,?)')
      .run(entryId, str(original, 200) || `beleg.${ext}`, finalName, mime, f.size, hash);
    stored.push(Number(info.lastInsertRowid));
  }
  return { stored, duplicates };
}

function cleanupTemp(files) {
  for (const f of files || []) if (f.path && fs.existsSync(f.path)) fs.rmSync(f.path, { force: true });
}

// ───────────── Entries (Belege) ─────────────
function filesFor(entryIds) {
  if (!entryIds.length) return {};
  const rows = db.prepare(`SELECT id, entry_id, original_name, mime, size, created_at FROM files WHERE entry_id IN (${entryIds.map(() => '?').join(',')}) ORDER BY id`).all(...entryIds);
  const map = {};
  for (const r of rows) (map[r.entry_id] ||= []).push(r);
  return map;
}
function withFiles(rows) {
  const map = filesFor(rows.map((r) => r.id));
  return rows.map((r) => ({ ...r, files: map[r.id] || [] }));
}
function getEntry(id, includeDeleted = false) {
  const row = db.prepare(`SELECT * FROM entries WHERE id = ? ${includeDeleted ? '' : 'AND deleted_at IS NULL'}`).get(Number(id));
  if (!row) throw new HttpError(404, 'الإيصال مو موجود');
  return withFiles([row])[0];
}
function entryFields(body, existing = {}) {
  const folder = FOLDERS.includes(body.folder) ? body.folder : existing.folder || 'purchase';
  const date = body.date !== undefined ? assertDate(body.date) : existing.date || todayBerlin();
  const subId = body.subscription_id !== undefined ? intOrNull(body.subscription_id) : existing.subscription_id ?? null;
  return {
    folder,
    date,
    vendor: body.vendor !== undefined ? str(body.vendor, 150) : existing.vendor || '',
    description: body.description !== undefined ? str(body.description, 500) : existing.description || '',
    amount_cents: body.amount !== undefined ? Math.abs(toCents(body.amount)) : existing.amount_cents || 0,
    payment_method: METHODS.includes(body.payment_method) ? body.payment_method : existing.payment_method || 'card',
    notes: body.notes !== undefined ? str(body.notes, 2000) : existing.notes || '',
    subscription_id: subId,
  };
}

router.get('/entries', (req, res) => {
  const where = ['deleted_at IS NULL'];
  const params = [];
  if (req.query.ym) {
    const { start, end } = monthRange(assertYm(req.query.ym));
    where.push('date BETWEEN ? AND ?');
    params.push(start, end);
  }
  if (FOLDERS.includes(req.query.folder)) { where.push('folder = ?'); params.push(req.query.folder); }
  if (req.query.q) {
    where.push('(vendor LIKE ? OR description LIKE ? OR notes LIKE ?)');
    const q = `%${String(req.query.q).slice(0, 80)}%`;
    params.push(q, q, q);
  }
  const rows = db.prepare(`SELECT * FROM entries WHERE ${where.join(' AND ')} ORDER BY date DESC, id DESC LIMIT 2000`).all(...params);
  res.json(withFiles(rows));
});

router.get('/vendors', (_req, res) => {
  // Most recent folder / method per vendor → used for autocomplete and smart defaults
  res.json(db.prepare(`SELECT vendor, folder, payment_method, MAX(date) AS last, COUNT(*) AS n FROM entries
    WHERE deleted_at IS NULL AND vendor != '' GROUP BY vendor COLLATE NOCASE ORDER BY n DESC, last DESC LIMIT 300`).all());
});

router.get('/entries/:id', (req, res) => res.json(getEntry(req.params.id)));

router.post('/entries', upload.array('files', 12), wrap(async (req, res) => {
  try {
    const f = entryFields(req.body);
    const info = db.prepare(`INSERT INTO entries (folder, date, vendor, description, amount_cents, payment_method, notes, subscription_id)
      VALUES (@folder, @date, @vendor, @description, @amount_cents, @payment_method, @notes, @subscription_id)`).run(f);
    const id = Number(info.lastInsertRowid);
    let result;
    try {
      result = await storeUploadedFiles(id, req.files);
    } catch (e) {
      db.prepare('DELETE FROM entries WHERE id = ?').run(id);
      throw e;
    }
    audit(req, 'create', 'entry', id, { folder: f.folder, amount: f.amount_cents, files: result.stored.length });
    res.json({ entry: getEntry(id), duplicates: result.duplicates });
  } finally {
    cleanupTemp(req.files);
  }
}));

router.put('/entries/:id', wrap((req, res) => {
  const existing = getEntry(req.params.id);
  const f = entryFields(req.body, existing);
  db.prepare(`UPDATE entries SET folder=@folder, date=@date, vendor=@vendor, description=@description, amount_cents=@amount_cents,
    payment_method=@payment_method, notes=@notes, subscription_id=@subscription_id, updated_at=datetime('now') WHERE id=@id`).run({ ...f, id: existing.id });
  audit(req, 'update', 'entry', existing.id, f);
  res.json(getEntry(existing.id));
}));

router.post('/entries/:id/files', upload.array('files', 12), wrap(async (req, res) => {
  try {
    const existing = getEntry(req.params.id);
    const result = await storeUploadedFiles(existing.id, req.files);
    db.prepare("UPDATE entries SET updated_at = datetime('now') WHERE id = ?").run(existing.id);
    audit(req, 'add_files', 'entry', existing.id, { files: result.stored.length });
    res.json({ entry: getEntry(existing.id), duplicates: result.duplicates });
  } finally {
    cleanupTemp(req.files);
  }
}));

router.delete('/entries/:id/files/:fileId', wrap((req, res) => {
  const entry = getEntry(req.params.id);
  const file = db.prepare('SELECT * FROM files WHERE id = ? AND entry_id = ?').get(Number(req.params.fileId), entry.id);
  if (!file) throw new HttpError(404, 'الملف مو موجود');
  db.prepare('DELETE FROM files WHERE id = ?').run(file.id);
  fs.rmSync(path.join(FILES_DIR, file.stored_name), { force: true });
  audit(req, 'delete_file', 'entry', entry.id, file.original_name);
  res.json(getEntry(entry.id));
}));

router.delete('/entries/:id', wrap((req, res) => {
  const entry = getEntry(req.params.id);
  db.prepare("UPDATE entries SET deleted_at = datetime('now') WHERE id = ?").run(entry.id);
  audit(req, 'trash', 'entry', entry.id);
  res.json({ ok: true });
}));

router.post('/entries/:id/restore', wrap((req, res) => {
  const entry = getEntry(req.params.id, true);
  db.prepare('UPDATE entries SET deleted_at = NULL WHERE id = ?').run(entry.id);
  audit(req, 'restore', 'entry', entry.id);
  res.json(getEntry(entry.id));
}));

router.delete('/entries/:id/permanent', wrap((req, res) => {
  const entry = getEntry(req.params.id, true);
  if (!entry.deleted_at) throw new HttpError(400, 'لازم تنحذف لسلة المحذوفات أول');
  tx(() => {
    for (const f of entry.files) {
      const st = db.prepare('SELECT stored_name FROM files WHERE id = ?').get(f.id);
      if (st) fs.rmSync(path.join(FILES_DIR, st.stored_name), { force: true });
    }
    db.prepare('DELETE FROM entries WHERE id = ?').run(entry.id);
  });
  audit(req, 'delete_permanent', 'entry', entry.id, { vendor: entry.vendor, amount: entry.amount_cents, date: entry.date });
  res.json({ ok: true });
}));

router.get('/trash', (_req, res) => {
  const rows = db.prepare('SELECT * FROM entries WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC LIMIT 500').all();
  res.json(withFiles(rows));
});

router.get('/files/:id', wrap((req, res) => {
  const file = db.prepare('SELECT * FROM files WHERE id = ?').get(Number(req.params.id));
  if (!file) throw new HttpError(404, 'الملف مو موجود');
  const p = path.join(FILES_DIR, file.stored_name);
  if (!fs.existsSync(p)) throw new HttpError(404, 'الملف مو موجود');
  res.type(file.mime);
  res.setHeader('Cache-Control', 'private, max-age=86400');
  const safe = encodeURIComponent(file.original_name);
  res.setHeader('Content-Disposition', `${req.query.download ? 'attachment' : 'inline'}; filename*=UTF-8''${safe}`);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  fs.createReadStream(p).pipe(res);
}));

// ───────────── Clients ─────────────
function clientFields(b, existing = {}) {
  const pick = (k, max = 200) => (b[k] !== undefined ? str(b[k], max) : existing[k] ?? '');
  const f = {
    company: pick('company'),
    contact: pick('contact'),
    street: pick('street'),
    zip: pick('zip', 20),
    city: pick('city', 100),
    country: pick('country', 80) || 'Deutschland',
    email: pick('email', 150),
    phone: pick('phone', 60),
    vat_id: pick('vat_id', 40).toUpperCase().replace(/\s/g, ''),
    payment_days: b.payment_days !== undefined ? intOrNull(b.payment_days) : existing.payment_days ?? null,
    language: (b.language ?? existing.language) === 'en' ? 'en' : 'de',
    notes: pick('notes', 2000),
  };
  if (!f.company && !f.contact) throw new HttpError(400, 'اكتب اسم الشركة أو اسم الشخص');
  if (f.payment_days !== null && (f.payment_days < 0 || f.payment_days > 365)) f.payment_days = null;
  return f;
}

const CLIENT_STATS = `
  SELECT c.*,
    (SELECT COUNT(*) FROM invoices i WHERE i.client_id = c.id AND i.kind = 'invoice' AND i.status != 'draft') AS invoice_count,
    (SELECT COALESCE(SUM(total_cents),0) FROM invoices i WHERE i.client_id = c.id AND i.kind IN ('invoice','storno') AND i.status != 'draft') AS revenue_cents,
    (SELECT COALESCE(SUM(total_cents),0) FROM invoices i WHERE i.client_id = c.id AND i.kind = 'invoice' AND i.status = 'issued') AS open_cents,
    (SELECT MAX(issue_date) FROM invoices i WHERE i.client_id = c.id AND i.status != 'draft') AS last_invoice
  FROM clients c`;

router.get('/clients', (req, res) => {
  const archived = req.query.archived === '1' ? 1 : 0;
  const q = req.query.q ? `%${String(req.query.q).slice(0, 80)}%` : null;
  const rows = db.prepare(`${CLIENT_STATS} WHERE c.archived = ? ${q ? 'AND (c.company LIKE ? OR c.contact LIKE ? OR c.city LIKE ? OR c.email LIKE ?)' : ''}
    ORDER BY COALESCE(NULLIF(c.company,''), c.contact) COLLATE NOCASE`).all(...(q ? [archived, q, q, q, q] : [archived]));
  res.json(rows);
});

router.get('/clients/:id', wrap((req, res) => {
  const row = db.prepare(`${CLIENT_STATS} WHERE c.id = ?`).get(Number(req.params.id));
  if (!row) throw new HttpError(404, 'العميل مو موجود');
  res.json(row);
}));

router.post('/clients', wrap((req, res) => {
  const f = clientFields(req.body);
  const info = db.prepare(`INSERT INTO clients (company, contact, street, zip, city, country, email, phone, vat_id, payment_days, language, notes)
    VALUES (@company, @contact, @street, @zip, @city, @country, @email, @phone, @vat_id, @payment_days, @language, @notes)`).run(f);
  audit(req, 'create', 'client', info.lastInsertRowid, f.company || f.contact);
  res.json({ id: Number(info.lastInsertRowid) });
}));

router.put('/clients/:id', wrap((req, res) => {
  const existing = db.prepare('SELECT * FROM clients WHERE id = ?').get(Number(req.params.id));
  if (!existing) throw new HttpError(404, 'العميل مو موجود');
  const f = clientFields(req.body, existing);
  const archived = req.body.archived !== undefined ? (req.body.archived ? 1 : 0) : existing.archived;
  db.prepare(`UPDATE clients SET company=@company, contact=@contact, street=@street, zip=@zip, city=@city, country=@country, email=@email,
    phone=@phone, vat_id=@vat_id, payment_days=@payment_days, language=@language, notes=@notes, archived=@archived, updated_at=datetime('now') WHERE id=@id`)
    .run({ ...f, archived, id: existing.id });
  audit(req, 'update', 'client', existing.id);
  res.json({ ok: true });
}));

router.delete('/clients/:id', wrap((req, res) => {
  const id = Number(req.params.id);
  const used = db.prepare('SELECT COUNT(*) AS c FROM invoices WHERE client_id = ?').get(id).c;
  if (used > 0) {
    db.prepare("UPDATE clients SET archived = 1, updated_at = datetime('now') WHERE id = ?").run(id);
    audit(req, 'archive', 'client', id);
    return res.json({ archived: true });
  }
  db.prepare('DELETE FROM clients WHERE id = ?').run(id);
  audit(req, 'delete', 'client', id);
  res.json({ deleted: true });
}));

// ───────────── Subscriptions (recurring receipts) ─────────────
function subFields(b, existing = {}) {
  const name = b.name !== undefined ? str(b.name, 120) : existing.name;
  if (!name) throw new HttpError(400, 'اكتب اسم الاشتراك');
  const start = b.start_ym !== undefined ? assertYm(b.start_ym) : existing.start_ym || todayBerlin().slice(0, 7);
  const end = b.end_ym !== undefined ? (b.end_ym ? assertYm(b.end_ym) : null) : existing.end_ym ?? null;
  return {
    name,
    vendor: b.vendor !== undefined ? str(b.vendor, 150) : existing.vendor || '',
    amount_cents: b.amount !== undefined ? Math.abs(toCents(b.amount)) : existing.amount_cents || 0,
    payment_method: METHODS.includes(b.payment_method) ? b.payment_method : existing.payment_method || 'card',
    folder: ['subscription', 'other'].includes(b.folder) ? b.folder : existing.folder || 'subscription',
    interval: ['monthly', 'quarterly', 'yearly'].includes(b.interval) ? b.interval : existing.interval || 'monthly',
    start_ym: start,
    end_ym: end,
    active: b.active !== undefined ? (b.active ? 1 : 0) : existing.active ?? 1,
    notes: b.notes !== undefined ? str(b.notes, 1000) : existing.notes || '',
  };
}

router.get('/subscriptions', (_req, res) => {
  res.json(db.prepare('SELECT * FROM subscriptions ORDER BY active DESC, name COLLATE NOCASE').all());
});
router.post('/subscriptions', wrap((req, res) => {
  const f = subFields(req.body);
  const info = db.prepare(`INSERT INTO subscriptions (name, vendor, amount_cents, payment_method, folder, interval, start_ym, end_ym, active, notes)
    VALUES (@name, @vendor, @amount_cents, @payment_method, @folder, @interval, @start_ym, @end_ym, @active, @notes)`).run(f);
  audit(req, 'create', 'subscription', info.lastInsertRowid, f.name);
  res.json({ id: Number(info.lastInsertRowid) });
}));
router.put('/subscriptions/:id', wrap((req, res) => {
  const existing = db.prepare('SELECT * FROM subscriptions WHERE id = ?').get(Number(req.params.id));
  if (!existing) throw new HttpError(404, 'الاشتراك مو موجود');
  const f = subFields(req.body, existing);
  db.prepare(`UPDATE subscriptions SET name=@name, vendor=@vendor, amount_cents=@amount_cents, payment_method=@payment_method, folder=@folder,
    interval=@interval, start_ym=@start_ym, end_ym=@end_ym, active=@active, notes=@notes WHERE id=@id`).run({ ...f, id: existing.id });
  audit(req, 'update', 'subscription', existing.id);
  res.json({ ok: true });
}));
router.delete('/subscriptions/:id', wrap((req, res) => {
  db.prepare('DELETE FROM subscriptions WHERE id = ?').run(Number(req.params.id));
  audit(req, 'delete', 'subscription', Number(req.params.id));
  res.json({ ok: true });
}));

export function subscriptionsDue(ym) {
  const subs = db.prepare('SELECT * FROM subscriptions WHERE active = 1 AND start_ym <= ? AND (end_ym IS NULL OR end_ym >= ?)').all(ym, ym);
  const [y, m] = ym.split('-').map(Number);
  return subs.filter((s) => {
    const [sy, sm] = s.start_ym.split('-').map(Number);
    const diff = (y - sy) * 12 + (m - sm);
    if (s.interval === 'quarterly') return diff % 3 === 0;
    if (s.interval === 'yearly') return diff % 12 === 0;
    return true;
  });
}

// ───────────── Month summary ─────────────
export function monthData(ym) {
  const { start, end } = monthRange(ym);
  const invoices = db.prepare(`SELECT id, kind, number, status, client_snapshot, issue_date, due_date, title, net_cents, tax_cents, total_cents,
      related_id, cancelled_by_id, paid_date, pdf_file
    FROM invoices WHERE kind IN ('invoice','storno') AND status != 'draft' AND issue_date BETWEEN ? AND ?
    ORDER BY issue_date, number`).all(start, end)
    .map((r) => ({ ...r, client: JSON.parse(r.client_snapshot || '{}'), client_snapshot: undefined }));
  const drafts = db.prepare(`SELECT COUNT(*) AS c FROM invoices WHERE kind = 'invoice' AND status = 'draft' AND issue_date BETWEEN ? AND ?`).get(start, end).c;
  const entries = withFiles(db.prepare('SELECT * FROM entries WHERE deleted_at IS NULL AND date BETWEEN ? AND ? ORDER BY date, id').all(start, end));
  const byFolder = Object.fromEntries(FOLDERS.map((f) => [f, entries.filter((e) => e.folder === f)]));
  const subs = subscriptionsDue(ym).map((s) => {
    const e = entries.find((x) => x.subscription_id === s.id);
    return { ...s, entry_id: e?.id ?? null, has_file: !!e?.files.length };
  });
  const sum = (arr, k = 'amount_cents') => arr.reduce((s, x) => s + (x[k] || 0), 0);
  const incomeInvoices = sum(invoices, 'total_cents');
  const incomeNet = sum(invoices, 'net_cents');
  const incomeManual = sum(byFolder.income);
  const expenses = sum(byFolder.purchase) + sum(byFolder.subscription) + sum(byFolder.other);
  const missingFiles = entries.filter((e) => e.folder !== 'bank' && !e.files.length).length;
  const month = db.prepare('SELECT * FROM months WHERE ym = ?').get(ym) || { ym, done_at: null, exported_at: null, note: '' };
  return {
    ym,
    ...month,
    invoices,
    entries: byFolder,
    subscriptions: subs,
    totals: {
      income_cents: incomeInvoices + incomeManual,
      income_invoices_cents: incomeInvoices,
      income_net_cents: incomeNet + incomeManual,
      income_manual_cents: incomeManual,
      expenses_cents: expenses,
      purchase_cents: sum(byFolder.purchase),
      subscription_cents: sum(byFolder.subscription),
      other_cents: sum(byFolder.other),
      profit_cents: incomeInvoices + incomeManual - expenses,
    },
    checks: {
      drafts,
      missingFiles,
      missingSubs: subs.filter((s) => !s.entry_id || !s.has_file).length,
      bankStatement: byFolder.bank.some((e) => e.files.length > 0),
    },
  };
}

router.get('/months/:ym', (req, res) => {
  const ym = assertYm(req.params.ym);
  const data = monthData(ym);
  const today = todayBerlin();
  const open = db.prepare(`SELECT id, number, client_snapshot, issue_date, due_date, total_cents FROM invoices
    WHERE kind = 'invoice' AND status = 'issued' ORDER BY due_date`).all()
    .map((r) => ({ ...r, client: JSON.parse(r.client_snapshot || '{}'), client_snapshot: undefined, overdue: r.due_date && r.due_date < today }));
  res.json({ ...data, openInvoices: open });
});

router.post('/months/:ym/done', wrap((req, res) => {
  const ym = assertYm(req.params.ym);
  db.prepare("INSERT INTO months (ym, done_at) VALUES (?, CASE WHEN ? THEN datetime('now') END) ON CONFLICT(ym) DO UPDATE SET done_at = excluded.done_at")
    .run(ym, req.body.done ? 1 : 0);
  audit(req, req.body.done ? 'month_done' : 'month_reopen', 'month', null, ym);
  res.json({ ok: true });
}));

router.get('/overview', (req, res) => {
  const year = /^\d{4}$/.test(String(req.query.year)) ? String(req.query.year) : todayBerlin().slice(0, 4);
  const inc = db.prepare(`SELECT substr(issue_date,6,2) AS m, SUM(total_cents) AS s FROM invoices
    WHERE kind IN ('invoice','storno') AND status != 'draft' AND substr(issue_date,1,4) = ? GROUP BY m`).all(year);
  const ent = db.prepare(`SELECT substr(date,6,2) AS m, folder, SUM(amount_cents) AS s, COUNT(*) AS c FROM entries
    WHERE deleted_at IS NULL AND substr(date,1,4) = ? GROUP BY m, folder`).all(year);
  const months = db.prepare('SELECT * FROM months WHERE substr(ym,1,4) = ?').all(year);
  const out = [];
  for (let i = 1; i <= 12; i++) {
    const m = String(i).padStart(2, '0');
    const income = (inc.find((r) => r.m === m)?.s || 0) + (ent.find((r) => r.m === m && r.folder === 'income')?.s || 0);
    const expenses = ent.filter((r) => r.m === m && ['purchase', 'subscription', 'other'].includes(r.folder)).reduce((s, r) => s + r.s, 0);
    const count = ent.filter((r) => r.m === m).reduce((s, r) => s + r.c, 0);
    const mm = months.find((x) => x.ym === `${year}-${m}`);
    out.push({ ym: `${year}-${m}`, income_cents: income, expenses_cents: expenses, entries: count, done_at: mm?.done_at || null, exported_at: mm?.exported_at || null });
  }
  res.json(out);
});

// ───────────── Settings ─────────────
router.get('/settings', (_req, res) => {
  const s = getSettings();
  const year = Number(todayBerlin().slice(0, 4));
  const counters = {};
  for (const kind of ['invoice', 'quote', 'storno']) {
    const row = db.prepare('SELECT next FROM counters WHERE kind = ? AND year = ?').get(kind, year);
    counters[kind] = row ? row.next : 1;
  }
  res.json({ ...s, counters, counterYear: year });
});

router.put('/settings', wrap((req, res) => {
  const b = req.body || {};
  const patch = {};
  if (b.company) {
    patch.company = {};
    for (const k of ['name', 'owner', 'street', 'zip', 'city', 'country', 'phone', 'email', 'website', 'vatId', 'taxNumber', 'bankName', 'accountHolder', 'iban', 'bic']) {
      if (b.company[k] !== undefined) patch.company[k] = str(b.company[k], 200);
    }
    if (patch.company.iban) {
      patch.company.iban = patch.company.iban.replace(/\s/g, '').toUpperCase();
      if (!validIban(patch.company.iban)) throw new HttpError(400, 'رقم الآيبان مو صحيح');
    }
    if (patch.company.bic) patch.company.bic = patch.company.bic.replace(/\s/g, '').toUpperCase();
  }
  if (b.tax) {
    patch.tax = {};
    if (['kleinunternehmer', 'standard'].includes(b.tax.mode)) patch.tax.mode = b.tax.mode;
    if ([0, 7, 19].includes(Number(b.tax.defaultRate))) patch.tax.defaultRate = Number(b.tax.defaultRate);
  }
  if (b.invoice) {
    const i = b.invoice;
    patch.invoice = {};
    if (['modern', 'classic', 'minimal'].includes(i.template)) patch.invoice.template = i.template;
    if (/^#[0-9a-f]{6}$/i.test(i.accentColor || '')) patch.invoice.accentColor = i.accentColor;
    if (['inter', 'manrope', 'serif'].includes(i.font)) patch.invoice.font = i.font;
    if (['left', 'right', 'center'].includes(i.logoPosition)) patch.invoice.logoPosition = i.logoPosition;
    if (i.logoSize !== undefined) patch.invoice.logoSize = Math.max(60, Math.min(240, Number(i.logoSize) || 150));
    for (const k of ['showQr', 'showBank']) if (i[k] !== undefined) patch.invoice[k] = !!i[k];
    for (const k of ['paymentDays', 'quoteValidDays']) if (i[k] !== undefined) patch.invoice[k] = Math.max(0, Math.min(365, parseInt(i[k], 10) || 0));
    if (['de', 'en'].includes(i.defaultLanguage)) patch.invoice.defaultLanguage = i.defaultLanguage;
    for (const k of ['introDe', 'outroDe', 'quoteIntroDe', 'quoteOutroDe', 'introEn', 'outroEn', 'quoteIntroEn', 'quoteOutroEn', 'footerNote']) {
      if (i[k] !== undefined) patch.invoice[k] = str(i[k], 2000);
    }
  }
  if (b.numbering) {
    patch.numbering = {};
    for (const k of ['invoicePrefix', 'quotePrefix', 'stornoPrefix']) {
      if (b.numbering[k] !== undefined) {
        const v = str(b.numbering[k], 10).toUpperCase().replace(/[^A-Z0-9]/g, '');
        if (!v) throw new HttpError(400, 'البادئة لازم تكون حروف أو أرقام');
        patch.numbering[k] = v;
      }
    }
    if (b.numbering.digits !== undefined) patch.numbering.digits = Math.min(6, Math.max(3, parseInt(b.numbering.digits, 10) || 4));
  }
  if (Array.isArray(b.units)) patch.units = b.units.map((u) => str(u, 20)).filter(Boolean).slice(0, 20);
  const saved = saveSettings(patch);
  audit(req, 'update', 'settings', null, Object.keys(patch).join(','));
  res.json(saved);
}));

router.put('/settings/counter', wrap((req, res) => {
  const kind = ['invoice', 'quote', 'storno'].includes(req.body.kind) ? req.body.kind : null;
  const year = parseInt(req.body.year, 10);
  const next = parseInt(req.body.next, 10);
  if (!kind || !year || !next || next < 1) throw new HttpError(400, 'قيمة غير صحيحة');
  const current = db.prepare('SELECT next FROM counters WHERE kind = ? AND year = ?').get(kind, year)?.next || 1;
  const used = db.prepare("SELECT COUNT(*) AS c FROM invoices WHERE kind = ? AND number IS NOT NULL AND substr(issue_date,1,4) = ?").get(kind, String(year)).c;
  if (next < current && used > 0) throw new HttpError(400, `ما فيك ترجع الترقيم لورا. أصغر رقم مسموح: ${current}`);
  db.prepare('INSERT INTO counters (kind, year, next) VALUES (?,?,?) ON CONFLICT(kind, year) DO UPDATE SET next = excluded.next').run(kind, year, next);
  audit(req, 'counter', kind, null, { year, next });
  res.json({ ok: true });
}));

const logoUpload = multer({ dest: FILES_DIR, limits: { fileSize: 5 * 1024 * 1024, files: 1 } });
router.post('/settings/logo', logoUpload.single('logo'), wrap(async (req, res) => {
  try {
    if (!req.file) throw new HttpError(400, 'ما في ملف');
    const type = await fileTypeFromFile(req.file.path).catch(() => null);
    if (!type || !['image/png', 'image/jpeg'].includes(type.mime)) throw new HttpError(400, 'اللوغو لازم يكون PNG أو JPG');
    const ext = type.mime === 'image/png' ? 'png' : 'jpg';
    for (const e of ['png', 'jpg']) fs.rmSync(path.join(FILES_DIR, `logo.${e}`), { force: true });
    fs.renameSync(req.file.path, path.join(FILES_DIR, `logo.${ext}`));
    saveSettings({ invoice: { hasLogo: true } });
    audit(req, 'logo', 'settings', null);
    res.json({ ok: true });
  } finally {
    if (req.file && fs.existsSync(req.file.path)) fs.rmSync(req.file.path, { force: true });
  }
}));
router.delete('/settings/logo', wrap((req, res) => {
  for (const e of ['png', 'jpg']) fs.rmSync(path.join(FILES_DIR, `logo.${e}`), { force: true });
  saveSettings({ invoice: { hasLogo: false } });
  audit(req, 'logo_delete', 'settings', null);
  res.json({ ok: true });
}));
router.get('/settings/logo', (_req, res) => {
  for (const ext of ['png', 'jpg']) {
    const p = path.join(FILES_DIR, `logo.${ext}`);
    if (fs.existsSync(p)) {
      res.setHeader('Cache-Control', 'no-cache');
      return res.type(ext === 'png' ? 'image/png' : 'image/jpeg').sendFile(p);
    }
  }
  res.status(404).end();
});

// ───────────── Audit log ─────────────
router.get('/audit', (req, res) => {
  const limit = Math.min(500, parseInt(req.query.limit, 10) || 200);
  res.json(db.prepare('SELECT * FROM audit_log ORDER BY id DESC LIMIT ?').all(limit));
});
