import { db } from './db.js';

export const DEFAULT_SETTINGS = {
  company: {
    name: 'Go Trend Marketing Agency',
    owner: 'Fedaa Alsamra',
    street: 'Im Lörenkamp 24',
    zip: '45879',
    city: 'Gelsenkirchen',
    country: 'Deutschland',
    phone: '+49 176 66694939',
    email: 'info@go-trend-marketing.de',
    website: 'www.go-trend-marketing.de',
    vatId: 'DE461739271',
    taxNumber: '',
    bankName: 'Qonto',
    accountHolder: 'Go Trend Marketing Agency',
    iban: 'DE10100101235503903845',
    bic: 'QNTODEB2XXX',
  },
  tax: {
    // 'kleinunternehmer' = § 19 UStG (no VAT), 'standard' = normal VAT
    mode: 'kleinunternehmer',
    defaultRate: 19,
  },
  invoice: {
    template: 'modern', // modern | classic | minimal
    accentColor: '#4f46e5',
    font: 'inter', // inter | manrope | serif
    logoPosition: 'left', // left | right | center
    logoSize: 150, // width in pt (max)
    hasLogo: false,
    showQr: true,
    showBank: true,
    paymentDays: 14,
    quoteValidDays: 30,
    defaultLanguage: 'de',
    introDe: 'Vielen Dank für Ihr Vertrauen. Hiermit stellen wir Ihnen folgende Leistungen in Rechnung:',
    outroDe: 'Bitte überweisen Sie den Rechnungsbetrag unter Angabe der Rechnungsnummer bis zum {due} auf das unten angegebene Konto.\nWir freuen uns auf die weitere Zusammenarbeit!',
    quoteIntroDe: 'Vielen Dank für Ihre Anfrage. Gerne unterbreiten wir Ihnen folgendes Angebot:',
    quoteOutroDe: 'Dieses Angebot ist gültig bis zum {valid}. Wir freuen uns auf Ihre Auftragserteilung!',
    introEn: 'Thank you for your trust. We hereby invoice the following services:',
    outroEn: 'Please transfer the invoice amount, quoting the invoice number, by {due} to the account below.\nWe look forward to continuing our cooperation!',
    quoteIntroEn: 'Thank you for your inquiry. We are pleased to offer the following:',
    quoteOutroEn: 'This offer is valid until {valid}. We look forward to your order!',
    footerNote: '',
  },
  numbering: {
    invoicePrefix: 'RE',
    quotePrefix: 'AN',
    stornoPrefix: 'ST',
    digits: 4,
  },
  units: ['Stk.', 'Std.', 'Pauschal', 'Monat', 'Tag'],
};

function deepMerge(base, over) {
  if (Array.isArray(base)) return Array.isArray(over) ? over : base;
  if (typeof base !== 'object' || base === null) return over === undefined ? base : over;
  const out = { ...base };
  for (const k of Object.keys(over || {})) {
    out[k] = k in base ? deepMerge(base[k], over[k]) : over[k];
  }
  return out;
}

export function getSettings() {
  const row = db.prepare("SELECT value FROM settings WHERE key = 'app'").get();
  const stored = row ? JSON.parse(row.value) : {};
  return deepMerge(DEFAULT_SETTINGS, stored);
}

export function saveSettings(partial) {
  const merged = deepMerge(getSettings(), partial);
  db.prepare("INSERT INTO settings (key, value) VALUES ('app', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    .run(JSON.stringify(merged));
  return merged;
}
