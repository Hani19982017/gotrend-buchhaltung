import type { Folder, PaymentMethod, InvoiceStatus, InvoiceKind } from './types';
import { lang, tr } from './i18n';

/** Month names in the UI language (Levantine Arabic names or German). */
export const MONTHS_AR = [tr('كانون الثاني'), tr('شباط'), tr('آذار'), tr('نيسان'), tr('أيار'), tr('حزيران'), tr('تموز'), tr('آب'), tr('أيلول'), tr('تشرين الأول'), tr('تشرين الثاني'), tr('كانون الأول')];

const eur = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' });
export const fmtEur = (cents: number | null | undefined) => eur.format((cents || 0) / 100);
export const fmtDate = (iso?: string | null) => {
  if (!iso) return '';
  const [y, m, d] = iso.slice(0, 10).split('-');
  return `${d}.${m}.${y}`;
};
export const fmtDayMonth = (iso?: string | null) => {
  if (!iso) return '';
  const [, m, d] = iso.slice(0, 10).split('-');
  return lang === 'de' ? `${Number(d)}. ${MONTHS_AR[Number(m) - 1]}` : `${Number(d)} ${MONTHS_AR[Number(m) - 1]}`;
};

export function todayIso() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin' }).format(new Date());
}
export function currentYm() {
  return todayIso().slice(0, 7);
}
export function shiftYm(ym: string, delta: number) {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}
export function ymLabel(ym: string) {
  const [y, m] = ym.split('-').map(Number);
  return `${MONTHS_AR[m - 1]} ${y}`;
}
export function ymRange(ym: string) {
  const [y, m] = ym.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { start: `${ym}-01`, end: `${ym}-${String(last).padStart(2, '0')}` };
}
/** Default date for a new entry: today if inside the viewed month, otherwise the 1st. */
export function defaultDateFor(ym?: string | null) {
  const t = todayIso();
  if (!ym || t.startsWith(ym)) return t;
  return ymRange(ym).end < t ? ymRange(ym).end : `${ym}-01`;
}

export function parseAmount(v: string): number | null {
  let s = (v || '').trim().replace(/\s|€/g, '');
  if (!s) return null;
  // Arabic-Indic digits → Latin
  s = s.replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d))).replace(/٫/g, ',');
  if (s.includes(',') && s.includes('.')) s = s.replace(/\./g, '').replace(',', '.');
  else s = s.replace(',', '.');
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}
export const centsToInput = (c: number) => (c ? (c / 100).toFixed(2).replace('.', ',') : '');

export const FOLDERS: { key: Folder; label: string; short: string; hint: string }[] = [
  { key: 'purchase', label: tr('المشتريات'), short: tr('مشتريات'), hint: tr('كل شي اشتريتو بالبطاقة أو كاش') },
  { key: 'subscription', label: tr('الاشتراكات والمصاريف الثابتة'), short: tr('اشتراك'), hint: tr('كلاود، برامج، إيجار، هاتف') },
  { key: 'other', label: tr('مصاريف تانية'), short: tr('مصروف آخر'), hint: tr('بنزين، سفر، مطاعم عمل') },
  { key: 'income', label: tr('دخل من فاتورة خارجية'), short: tr('دخل خارجي'), hint: tr('فاتورة عملتها برا البرنامج') },
  { key: 'bank', label: tr('كشف حساب البنك'), short: tr('كشف بنك'), hint: tr('كشف الحساب الشهري') },
];
export const folderLabel = (f: Folder) => FOLDERS.find((x) => x.key === f)?.label || f;

export const METHODS: { key: PaymentMethod; label: string }[] = [
  { key: 'card', label: tr('بطاقة') },
  { key: 'bank', label: tr('تحويل') },
  { key: 'cash', label: tr('كاش') },
  { key: 'paypal', label: 'PayPal' },
  { key: 'other', label: tr('غير') },
];
export const methodLabel = (m: PaymentMethod) => METHODS.find((x) => x.key === m)?.label || m;

export const KIND_LABEL: Record<InvoiceKind, string> = { invoice: tr('فاتورة'), quote: tr('عرض سعر'), storno: tr('فاتورة إلغاء') };

export function statusInfo(kind: InvoiceKind, status: InvoiceStatus, overdue = false): { label: string; tone: 'gray' | 'blue' | 'green' | 'red' | 'amber' | 'violet' } {
  if (status === 'draft') return { label: tr('مسودة'), tone: 'gray' };
  if (kind === 'storno') return { label: tr('إلغاء|storno'), tone: 'violet' };
  if (kind === 'quote') {
    if (status === 'accepted') return { label: tr('مقبول'), tone: 'green' };
    if (status === 'declined') return { label: tr('مرفوض'), tone: 'red' };
    return { label: tr('مُرسل'), tone: 'blue' };
  }
  if (status === 'paid') return { label: tr('مدفوعة'), tone: 'green' };
  if (status === 'cancelled') return { label: tr('ملغاة'), tone: 'red' };
  if (overdue) return { label: tr('متأخرة'), tone: 'amber' };
  return { label: tr('بانتظار الدفع'), tone: 'blue' };
}

export const clientName = (c?: { company?: string; contact?: string } | null) => c?.company || c?.contact || '—';

export function fileSize(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
