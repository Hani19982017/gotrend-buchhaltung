export type Folder = 'purchase' | 'subscription' | 'other' | 'income' | 'bank';
export type PaymentMethod = 'card' | 'bank' | 'cash' | 'paypal' | 'other';
export type InvoiceKind = 'invoice' | 'quote' | 'storno';
export type InvoiceStatus = 'draft' | 'issued' | 'paid' | 'cancelled' | 'accepted' | 'declined';

export interface FileInfo {
  id: number;
  entry_id: number;
  original_name: string;
  mime: string;
  size: number;
  created_at: string;
}

export interface Entry {
  id: number;
  folder: Folder;
  date: string;
  vendor: string;
  description: string;
  amount_cents: number;
  payment_method: PaymentMethod;
  notes: string;
  subscription_id: number | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  files: FileInfo[];
}

export interface Client {
  id: number;
  company: string;
  contact: string;
  street: string;
  zip: string;
  city: string;
  country: string;
  email: string;
  phone: string;
  vat_id: string;
  payment_days: number | null;
  language: 'de' | 'en';
  notes: string;
  archived: number;
  invoice_count?: number;
  revenue_cents?: number;
  open_cents?: number;
  last_invoice?: string | null;
}

export interface ClientSnapshot {
  id?: number;
  customer_no?: string;
  company?: string;
  contact?: string;
  street?: string;
  zip?: string;
  city?: string;
  country?: string;
  email?: string;
  vat_id?: string;
}

export interface InvoiceItem {
  id: string;
  description: string;
  qty: number;
  unit: string;
  price_cents: number;
  tax_rate: number;
  total_cents: number;
}

export interface InvoiceListItem {
  id: number;
  kind: InvoiceKind;
  number: string | null;
  status: InvoiceStatus;
  client_id: number | null;
  client: ClientSnapshot;
  issue_date: string;
  due_date: string | null;
  title: string;
  net_cents: number;
  tax_cents: number;
  total_cents: number;
  related_id: number | null;
  cancelled_by_id: number | null;
  converted_to_id: number | null;
  paid_date: string | null;
}

export interface Invoice extends InvoiceListItem {
  service_from: string | null;
  service_to: string | null;
  language: 'de' | 'en';
  tax_treatment: 'auto' | 'reverse_charge' | 'export';
  tax_mode: 'kleinunternehmer' | 'standard';
  items: InvoiceItem[];
  intro_text: string;
  outro_text: string;
  internal_note: string;
  cancel_reason: string;
  issued_at: string | null;
  pdf_file?: string | null;
  related: { id: number; kind: InvoiceKind; number: string | null; issue_date: string } | null;
  cancelledBy: { id: number; number: string; issue_date: string } | null;
  convertedTo: { id: number; number: string | null; status: InvoiceStatus } | null;
}

export interface Subscription {
  id: number;
  name: string;
  vendor: string;
  amount_cents: number;
  payment_method: PaymentMethod;
  folder: 'subscription' | 'other';
  interval: 'monthly' | 'quarterly' | 'yearly';
  start_ym: string;
  end_ym: string | null;
  active: number;
  notes: string;
}

export interface MonthData {
  ym: string;
  done_at: string | null;
  exported_at: string | null;
  invoices: InvoiceListItem[];
  entries: Record<Folder, Entry[]>;
  subscriptions: (Subscription & { entry_id: number | null; has_file: boolean })[];
  totals: {
    income_cents: number;
    income_invoices_cents: number;
    income_net_cents: number;
    income_manual_cents: number;
    expenses_cents: number;
    purchase_cents: number;
    subscription_cents: number;
    other_cents: number;
    profit_cents: number;
  };
  checks: { drafts: number; missingFiles: number; missingSubs: number; bankStatement: boolean };
  openInvoices: { id: number; number: string; client: ClientSnapshot; issue_date: string; due_date: string; total_cents: number; overdue: boolean }[];
}

export interface Settings {
  company: {
    name: string; owner: string; street: string; zip: string; city: string; country: string; phone: string; email: string;
    website: string; vatId: string; taxNumber: string; bankName: string; accountHolder: string; iban: string; bic: string;
  };
  tax: { mode: 'kleinunternehmer' | 'standard'; defaultRate: number };
  invoice: {
    template: 'modern' | 'classic' | 'minimal';
    accentColor: string;
    font: 'inter' | 'manrope' | 'serif';
    logoPosition: 'left' | 'right' | 'center';
    logoSize: number;
    hasLogo: boolean;
    showQr: boolean;
    showBank: boolean;
    paymentDays: number;
    quoteValidDays: number;
    defaultLanguage: 'de' | 'en';
    introDe: string; outroDe: string; quoteIntroDe: string; quoteOutroDe: string;
    introEn: string; outroEn: string; quoteIntroEn: string; quoteOutroEn: string;
    footerNote: string;
  };
  numbering: { invoicePrefix: string; quotePrefix: string; stornoPrefix: string; digits: number };
  units: string[];
  counters: { invoice: number; quote: number; storno: number };
  counterYear: number;
}

export interface User {
  id: number;
  name: string;
  email: string;
}
