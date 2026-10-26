// API integration tests. Run: npm test
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import JSZip from 'jszip';

const PORT = 3999;
const BASE = `http://localhost:${PORT}`;
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'gt-test-'));
let proc;
let cookie = '';

async function api(method, url, body, { raw = false, form = null, headers = {} } = {}) {
  const h = { 'x-gt': '1', cookie, ...headers };
  let payload;
  if (form) payload = form;
  else if (body !== undefined) { h['content-type'] = 'application/json'; payload = JSON.stringify(body); }
  const res = await fetch(BASE + url, { method, headers: h, body: payload });
  const sc = res.headers.get('set-cookie');
  if (sc) cookie = sc.split(';')[0];
  if (raw) return res;
  const data = res.headers.get('content-type')?.includes('json') ? await res.json() : await res.text();
  return { status: res.status, data };
}

// Minimal valid JPEG and PDF payloads
const JPEG = Buffer.from('/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=', 'base64');
const PDF = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj 3 0 obj<</Type/Page/MediaBox[0 0 3 3]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF');

before(async () => {
  proc = spawn(process.execPath, ['server/index.js'], { env: { ...process.env, PORT: String(PORT), DATA_DIR: DATA, SETUP_CODE: 'abc123' }, stdio: 'pipe' });
  proc.stderr.on('data', (d) => process.stderr.write(d));
  for (let i = 0; i < 50; i++) {
    try { const r = await fetch(`${BASE}/api/health`); if (r.ok) return; } catch { /* wait */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('server did not start');
});
after(() => { proc.kill(); fs.rmSync(DATA, { recursive: true, force: true }); });

test('auth: setup requires code, then login works, CSRF enforced', async () => {
  let r = await api('GET', '/api/clients');
  assert.equal(r.status, 401);
  r = await api('GET', '/api/auth/state');
  assert.equal(r.data.setupNeeded, true);
  r = await api('POST', '/api/auth/setup', { name: 'Ahmad', email: 'a@b.de', password: 'geheim123', setupCode: 'wrong' });
  assert.equal(r.status, 403);
  r = await api('POST', '/api/auth/setup', { name: 'Ahmad', email: 'a@b.de', password: 'geheim123', setupCode: 'abc123' });
  assert.equal(r.status, 200);
  r = await api('POST', '/api/auth/setup', { name: 'X', email: 'x@b.de', password: 'geheim123', setupCode: 'abc123' });
  assert.equal(r.status, 400, 'second setup must fail');
  r = await api('POST', '/api/auth/logout');
  cookie = '';
  r = await api('POST', '/api/auth/login', { email: 'a@b.de', password: 'falsch' });
  assert.equal(r.status, 401);
  r = await api('POST', '/api/auth/login', { email: 'A@B.de', password: 'geheim123' });
  assert.equal(r.status, 200);
  const noCsrf = await fetch(`${BASE}/api/clients`, { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: '{}' });
  assert.equal(noCsrf.status, 403);
});

let clientId;
test('clients CRUD', async () => {
  let r = await api('POST', '/api/clients', { company: 'Elite Trade GmbH', contact: 'Tarek Mansour', street: 'Kettwiger Str. 18', zip: '45127', city: 'Essen', vat_id: 'de 312 984 512', payment_days: 30 });
  assert.equal(r.status, 200);
  clientId = r.data.id;
  r = await api('GET', `/api/clients/${clientId}`);
  assert.equal(r.data.vat_id, 'DE312984512');
  r = await api('POST', '/api/clients', { city: 'x' });
  assert.equal(r.status, 400);
});

let invId;
test('invoice: draft → issue assigns sequential number and freezes PDF', async () => {
  let r = await api('POST', '/api/invoices', { kind: 'invoice', client_id: clientId, issue_date: '2026-10-05', items: [{ description: 'Social Media', qty: 1, price: '1.200,00' }, { description: 'Ads', qty: 2, price: 325 }] });
  invId = r.data.id;
  r = await api('GET', `/api/invoices/${invId}`);
  assert.equal(r.data.total_cents, 185000);
  assert.equal(r.data.due_date, '2026-11-04', 'due date uses client payment days (30)');
  assert.equal(r.data.number, null);
  r = await api('POST', `/api/invoices/${invId}/issue`);
  assert.equal(r.status, 200);
  assert.equal(r.data.number, 'RE-2026-0001');
  r = await api('PUT', `/api/invoices/${invId}`, { items: [] });
  assert.equal(r.status, 400, 'issued invoice cannot be edited');
  r = await api('DELETE', `/api/invoices/${invId}`);
  assert.equal(r.status, 400, 'issued invoice cannot be deleted');
  const pdf = await api('GET', `/api/invoices/${invId}/pdf`, undefined, { raw: true });
  assert.equal(pdf.headers.get('content-type'), 'application/pdf');
  const buf = Buffer.from(await pdf.arrayBuffer());
  assert.equal(buf.subarray(0, 4).toString(), '%PDF');

  const r2 = await api('POST', '/api/invoices', { kind: 'invoice', client_id: clientId, issue_date: '2026-10-20', items: [{ description: 'SEO', qty: 1, price: 600 }] });
  const i2 = await api('POST', `/api/invoices/${r2.data.id}/issue`);
  assert.equal(i2.data.number, 'RE-2026-0002');
});

test('invoice: cannot issue without client or with zero amount', async () => {
  let r = await api('POST', '/api/invoices', { kind: 'invoice', items: [{ description: 'x', qty: 1, price: 10 }] });
  let i = await api('POST', `/api/invoices/${r.data.id}/issue`);
  assert.equal(i.status, 400);
  await api('DELETE', `/api/invoices/${r.data.id}`);
  r = await api('POST', '/api/invoices', { kind: 'invoice', client_id: clientId, items: [{ description: 'x', qty: 1, price: 0 }] });
  i = await api('POST', `/api/invoices/${r.data.id}/issue`);
  assert.equal(i.status, 400);
  const d = await api('DELETE', `/api/invoices/${r.data.id}`);
  assert.equal(d.status, 200, 'draft can be deleted');
});

test('invoice: paid / unpaid, storno and correction', async () => {
  let r = await api('POST', `/api/invoices/${invId}/paid`, { date: '2026-10-10' });
  r = await api('GET', `/api/invoices/${invId}`);
  assert.equal(r.data.status, 'paid');
  r = await api('POST', `/api/invoices/${invId}/cancel`, {});
  assert.equal(r.status, 400, 'reason required');
  r = await api('POST', `/api/invoices/${invId}/cancel`, { reason: 'Doppelt erstellt', date: '2026-10-25' });
  const st = await api('GET', `/api/invoices/${r.data.stornoId}`);
  assert.equal(st.data.number, 'ST-2026-0001');
  assert.equal(st.data.total_cents, -185000);
  r = await api('GET', `/api/invoices/${invId}`);
  assert.equal(r.data.status, 'cancelled');
  assert.equal(r.data.cancelledBy.number, 'ST-2026-0001');

  // correction of invoice 2
  const list = await api('GET', '/api/invoices?kind=invoice');
  const inv2 = list.data.find((x) => x.number === 'RE-2026-0002');
  r = await api('POST', `/api/invoices/${inv2.id}/correct`, { reason: 'Preis falsch' });
  assert.ok(r.data.newId && r.data.stornoId);
  const draft = await api('GET', `/api/invoices/${r.data.newId}`);
  assert.equal(draft.data.status, 'draft');
  assert.equal(draft.data.related.number, 'RE-2026-0002');
  await api('PUT', `/api/invoices/${r.data.newId}`, { client_id: clientId, issue_date: '2026-10-26', items: [{ description: 'SEO korrigiert', qty: 1, price: 650 }] });
  const iss = await api('POST', `/api/invoices/${r.data.newId}/issue`);
  assert.equal(iss.data.number, 'RE-2026-0003');
});

test('quote → invoice conversion', async () => {
  let r = await api('POST', '/api/invoices', { kind: 'quote', client_id: clientId, issue_date: '2026-10-02', items: [{ description: 'Website', qty: 1, price: 2400 }] });
  const q = await api('POST', `/api/invoices/${r.data.id}/issue`);
  assert.equal(q.data.number, 'AN-2026-0001');
  r = await api('POST', `/api/invoices/${q.data.id}/convert`);
  const inv = await api('GET', `/api/invoices/${r.data.id}`);
  assert.equal(inv.data.kind, 'invoice');
  assert.equal(inv.data.total_cents, 240000);
  const qq = await api('GET', `/api/invoices/${q.data.id}`);
  assert.equal(qq.data.status, 'accepted');
  assert.equal(qq.data.convertedTo.id, r.data.id);
});

let entryId;
test('entries: upload receipt, reject bad files, detect duplicates, trash & restore', async () => {
  const fd = new FormData();
  fd.append('folder', 'purchase');
  fd.append('date', '2026-10-16');
  fd.append('vendor', 'MediaMarkt');
  fd.append('amount', '389,00');
  fd.append('payment_method', 'card');
  fd.append('files', new Blob([JPEG], { type: 'image/jpeg' }), 'إيصال شاشة.jpg');
  let r = await api('POST', '/api/entries', undefined, { form: fd });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  entryId = r.data.entry.id;
  assert.equal(r.data.entry.amount_cents, 38900);
  assert.equal(r.data.entry.files[0].original_name, 'إيصال شاشة.jpg');

  const bad = new FormData();
  bad.append('folder', 'purchase');
  bad.append('date', '2026-10-16');
  bad.append('files', new Blob(['<script>alert(1)</script>'], { type: 'image/jpeg' }), 'evil.jpg');
  r = await api('POST', '/api/entries', undefined, { form: bad });
  assert.equal(r.status, 400);
  const all = await api('GET', '/api/entries?ym=2026-10');
  assert.equal(all.data.length, 1, 'failed upload leaves no entry');

  const dup = new FormData();
  dup.append('folder', 'other');
  dup.append('date', '2026-10-17');
  dup.append('files', new Blob([JPEG], { type: 'image/jpeg' }), 'same.jpg');
  r = await api('POST', '/api/entries', undefined, { form: dup });
  assert.equal(r.data.duplicates.length, 1);
  const dupId = r.data.entry.id;
  r = await api('DELETE', `/api/entries/${dupId}`);
  r = await api('GET', '/api/trash');
  assert.equal(r.data.length, 1);
  r = await api('POST', `/api/entries/${dupId}/restore`);
  assert.equal(r.data.id, dupId);
  await api('DELETE', `/api/entries/${dupId}`);
  r = await api('DELETE', `/api/entries/${dupId}/permanent`);
  assert.equal(r.status, 200);

  const file = await api('GET', `/api/files/${(await api('GET', `/api/entries/${entryId}`)).data.files[0].id}`, undefined, { raw: true });
  assert.equal(file.headers.get('content-type'), 'image/jpeg');
});

test('subscriptions checklist + month summary + bank statement', async () => {
  let r = await api('POST', '/api/subscriptions', { name: 'Google Cloud', vendor: 'Google', amount: 30, start_ym: '2026-01' });
  const subId = r.data.id;
  await api('POST', '/api/subscriptions', { name: 'Domain jährlich', amount: 15, start_ym: '2026-03', interval: 'yearly' });
  r = await api('GET', '/api/months/2026-10');
  assert.equal(r.data.subscriptions.length, 1, 'yearly sub not due in October');
  assert.equal(r.data.checks.missingSubs, 1);
  assert.equal(r.data.checks.bankStatement, false);

  const fd = new FormData();
  fd.append('folder', 'subscription');
  fd.append('date', '2026-10-03');
  fd.append('vendor', 'Google');
  fd.append('amount', '30');
  fd.append('subscription_id', String(subId));
  fd.append('files', new Blob([PDF], { type: 'application/pdf' }), 'gcp.pdf');
  await api('POST', '/api/entries', undefined, { form: fd });
  const bank = new FormData();
  bank.append('folder', 'bank');
  bank.append('date', '2026-10-31');
  bank.append('files', new Blob([PDF], { type: 'application/pdf' }), 'Kontoauszug.pdf');
  await api('POST', '/api/entries', undefined, { form: bank });

  r = await api('GET', '/api/months/2026-10');
  assert.equal(r.data.checks.missingSubs, 0);
  assert.equal(r.data.checks.bankStatement, true);
  // invoices in Oct: RE-1 (185000), ST-1 (-185000), RE-2 (60000, cancelled), ST-2 (-60000), RE-3 (65000)
  assert.equal(r.data.totals.income_cents, 65000);
  assert.equal(r.data.totals.expenses_cents, 38900 + 3000);
  r = await api('GET', '/api/months/2026-03');
  assert.equal(r.data.subscriptions.length, 2);
});

test('month export ZIP contains organised folders, CSV and summary', async () => {
  const res = await api('GET', '/api/months/2026-10/export', undefined, { raw: true });
  assert.equal(res.status, 200);
  const zip = await JSZip.loadAsync(Buffer.from(await res.arrayBuffer()));
  const names = Object.keys(zip.files).filter((n) => !zip.files[n].dir).sort();
  const root = 'GoTrend_Buchhaltung_2026-10/';
  assert.ok(names.includes(`${root}00_Monatsuebersicht_2026-10.pdf`));
  assert.ok(names.includes(`${root}00_Buchungsliste_2026-10.csv`));
  assert.ok(names.some((n) => n.startsWith(`${root}01_Ausgangsrechnungen/RE-2026-0001`)));
  assert.ok(names.some((n) => n.startsWith(`${root}01_Ausgangsrechnungen/ST-2026-0001`)));
  assert.ok(names.some((n) => n.startsWith(`${root}02_Einkaeufe/2026-10-16_MediaMarkt_389,00EUR`)));
  assert.ok(names.some((n) => n.startsWith(`${root}03_Abonnements_Fixkosten/`)));
  assert.ok(names.some((n) => n.startsWith(`${root}05_Kontoauszug/`)));
  assert.ok(!names.some((n) => n.includes('AN-2026')), 'quotes are not exported');
  const csv = await zip.file(`${root}00_Buchungsliste_2026-10.csv`).async('string');
  assert.ok(csv.includes('RE-2026-0003'));
  assert.ok(csv.includes('MediaMarkt'));
  fs.writeFileSync(path.join(os.tmpdir(), 'gt-export-test.zip'), Buffer.from(await zip.generateAsync({ type: 'uint8array' })));
});

test('settings: IBAN validation, counter cannot go backwards, logo upload', async () => {
  let r = await api('PUT', '/api/settings', { company: { iban: 'DE00123' } });
  assert.equal(r.status, 400);
  r = await api('PUT', '/api/settings', { invoice: { template: 'classic', accentColor: '#0f766e' }, tax: { mode: 'standard' } });
  assert.equal(r.data.invoice.template, 'classic');
  r = await api('PUT', '/api/settings/counter', { kind: 'invoice', year: 2026, next: 1 });
  assert.equal(r.status, 400);
  r = await api('PUT', '/api/settings/counter', { kind: 'invoice', year: 2026, next: 50 });
  assert.equal(r.status, 200);
  const d = await api('POST', '/api/invoices', { kind: 'invoice', client_id: clientId, issue_date: '2026-11-02', items: [{ description: 'x', qty: 1, price: 100, tax_rate: 19 }] });
  const iss = await api('POST', `/api/invoices/${d.data.id}/issue`);
  assert.equal(iss.data.number, 'RE-2026-0050');
  assert.equal(iss.data.total_cents, 11900, 'standard VAT applied');
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  const fd = new FormData();
  fd.append('logo', new Blob([png], { type: 'image/png' }), 'logo.png');
  r = await api('POST', '/api/settings/logo', undefined, { form: fd });
  assert.equal(r.status, 200);
  r = await api('GET', '/api/settings');
  assert.equal(r.data.invoice.hasLogo, true);
  await api('PUT', '/api/settings', { tax: { mode: 'kleinunternehmer' }, invoice: { template: 'modern', accentColor: '#4f46e5' } });
});

test('backup ZIP contains database and files', async () => {
  const res = await api('GET', '/api/backup', undefined, { raw: true });
  const zip = await JSZip.loadAsync(Buffer.from(await res.arrayBuffer()));
  const names = Object.keys(zip.files);
  assert.ok(names.some((n) => n.endsWith('/gotrend.db')));
  assert.ok(names.some((n) => n.includes('/files/') && n.endsWith('.jpg')));
  assert.ok(names.some((n) => n.includes('/invoices/') && n.endsWith('.pdf')));
  assert.ok(fs.readdirSync(path.join(DATA, 'backups')).length >= 1, 'daily backup created');
});

test('audit log records actions', async () => {
  const r = await api('GET', '/api/audit');
  const actions = r.data.map((a) => a.action);
  for (const a of ['issue', 'cancel', 'correct', 'export', 'trash', 'restore']) assert.ok(actions.includes(a), a);
});
