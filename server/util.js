import { db } from './db.js';

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export const wrap = (fn) => (req, res, next) => {
  try {
    const r = fn(req, res, next);
    if (r && typeof r.catch === 'function') r.catch(next);
  } catch (e) {
    next(e);
  }
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const YM_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

export function isDate(s) {
  if (typeof s !== 'string' || !DATE_RE.test(s)) return false;
  const d = new Date(s + 'T00:00:00Z');
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}
export function assertDate(s, field = 'date') {
  if (!isDate(s)) throw new HttpError(400, `تاريخ غير صحيح: ${field}`);
  return s;
}
export function assertYm(s) {
  if (typeof s !== 'string' || !YM_RE.test(s)) throw new HttpError(400, 'شهر غير صحيح');
  return s;
}
export function monthRange(ym) {
  const [y, m] = ym.split('-').map(Number);
  const start = `${ym}-01`;
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { start, end: `${ym}-${String(last).padStart(2, '0')}` };
}
export function todayBerlin() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin' }).format(new Date());
}
export function addDays(date, days) {
  const d = new Date(date + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + Number(days || 0));
  return d.toISOString().slice(0, 10);
}

export function str(v, max = 500) {
  if (v === undefined || v === null) return '';
  return String(v).slice(0, max).trim();
}
export function toCents(v) {
  if (typeof v === 'number') return Math.round(v * 100);
  if (typeof v === 'string') {
    let s = v.trim().replace(/\s|€/g, '');
    if (s.includes(',') && s.includes('.')) s = s.replace(/\./g, '').replace(',', '.');
    else s = s.replace(',', '.');
    const n = Number(s);
    if (Number.isFinite(n)) return Math.round(n * 100);
  }
  return 0;
}
export function intOrNull(v) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : null;
}

export function fmtEur(cents, lang = 'de') {
  const v = (cents || 0) / 100;
  return new Intl.NumberFormat(lang === 'en' ? 'en-IE' : 'de-DE', { style: 'currency', currency: 'EUR' }).format(v);
}
export function fmtNum(cents) {
  return new Intl.NumberFormat('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format((cents || 0) / 100);
}
export function fmtDate(iso, lang = 'de') {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return lang === 'en' ? `${d}/${m}/${y}` : `${d}.${m}.${y}`;
}

export function audit(req, action, entity, entityId, details = '') {
  db.prepare('INSERT INTO audit_log (user_id, user_name, action, entity, entity_id, details) VALUES (?,?,?,?,?,?)')
    .run(req?.user?.id ?? null, req?.user?.name ?? null, action, entity, entityId ?? null,
      typeof details === 'string' ? details : JSON.stringify(details));
}

export function safeFileName(s, max = 60) {
  return String(s || '')
    .normalize('NFKD')
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/Ä/g, 'Ae').replace(/Ö/g, 'Oe').replace(/Ü/g, 'Ue').replace(/ß/g, 'ss')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\w\-.,؀-ۿ ]+/g, '')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^[_.]+|[_.]+$/g, '')
    .slice(0, max) || 'Beleg';
}

export function validIban(iban) {
  const s = String(iban || '').replace(/\s/g, '').toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(s)) return false;
  const r = s.slice(4) + s.slice(0, 4);
  let rem = 0;
  for (const ch of r) {
    const code = /[A-Z]/.test(ch) ? String(ch.charCodeAt(0) - 55) : ch;
    for (const c of code) rem = (rem * 10 + Number(c)) % 97;
  }
  return rem === 1;
}
