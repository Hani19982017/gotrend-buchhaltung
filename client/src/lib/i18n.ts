/**
 * Tiny i18n layer.
 *
 * The Arabic source text is the key: `tr('حفظ')` returns the Arabic text in Arabic mode
 * and the German translation from `de.ts` in German mode. Missing translations fall back
 * to Arabic, so nothing ever renders empty.
 *
 * Placeholders: `tr('{0} مصروف بدون إيصال', [n])`. A German entry may be a
 * `[singular, plural]` pair; the first param decides which one is used.
 *
 * The language is read once at startup. Switching stores the choice and reloads the page,
 * which keeps module-level label lists (folders, menus, …) consistent without extra wiring.
 */
import { DE, DE_PATTERNS } from './de';

export type Lang = 'ar' | 'de';
export const LANGS: { value: Lang; label: string }[] = [
  { value: 'ar', label: 'العربية' },
  { value: 'de', label: 'Deutsch' },
];

const KEY = 'gt-lang';

function readLang(): Lang {
  try {
    const v = localStorage.getItem(KEY);
    if (v === 'ar' || v === 'de') return v;
  } catch {
    /* storage blocked → default */
  }
  return 'ar';
}

export const lang: Lang = readLang();
export const isRtl = lang === 'ar';

if (typeof document !== 'undefined') {
  document.documentElement.lang = lang;
  document.documentElement.dir = isRtl ? 'rtl' : 'ltr';
}

export function setLang(next: Lang) {
  if (next === lang) return;
  try {
    localStorage.setItem(KEY, next);
  } catch {
    /* ignore */
  }
  window.location.reload();
}

type Params = (string | number | null | undefined)[];

function fill(s: string, params?: Params) {
  if (!params) return s;
  return s.replace(/\{(\d+)\}/g, (_, i) => String(params[Number(i)] ?? ''));
}

/**
 * `tr('إلغاء|storno')` — text after `|` is a context marker for words that need
 * different German translations (Abbrechen vs. Storno). It is never shown in Arabic.
 */
export function tr(ar: string, params?: Params): string {
  if (lang === 'ar') return fill(ar.split('|')[0], params);
  const hit = DE[ar];
  if (hit === undefined) {
    if (import.meta.env.DEV) console.warn('[i18n] missing German text:', ar);
    return fill(ar.split('|')[0], params);
  }
  if (Array.isArray(hit)) {
    const n = Number(params?.[0]);
    return fill(n === 1 ? hit[0] : hit[1], params);
  }
  return fill(hit, params);
}

/** Translates free text coming from the server (error messages), including dynamic ones. */
export function tServer(msg: string): string {
  if (lang === 'ar' || !msg) return msg;
  if (DE[msg] !== undefined) return tr(msg);
  for (const [re, out] of DE_PATTERNS) {
    const m = re.exec(msg);
    if (m) return out.replace(/\$(\d)/g, (_, i) => m[Number(i)] ?? '');
  }
  return msg;
}

/** BCP-47 locale for Intl formatting of UI text (numbers/money stay German-formatted). */
export const uiLocale = lang === 'de' ? 'de-DE' : 'ar';
