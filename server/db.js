import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

export const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(process.cwd(), 'data'));
export const FILES_DIR = path.join(DATA_DIR, 'files');
export const INVOICE_PDF_DIR = path.join(DATA_DIR, 'invoices');
export const BACKUP_DIR = path.join(DATA_DIR, 'backups');

for (const d of [DATA_DIR, FILES_DIR, INVOICE_PDF_DIR, BACKUP_DIR]) fs.mkdirSync(d, { recursive: true });

export const db = new Database(path.join(DATA_DIR, 'gotrend.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 5000');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL,
  user_agent TEXT
);
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS counters (
  kind TEXT NOT NULL,
  year INTEGER NOT NULL,
  next INTEGER NOT NULL,
  PRIMARY KEY (kind, year)
);
CREATE TABLE IF NOT EXISTS clients (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company TEXT NOT NULL DEFAULT '',
  contact TEXT NOT NULL DEFAULT '',
  street TEXT NOT NULL DEFAULT '',
  zip TEXT NOT NULL DEFAULT '',
  city TEXT NOT NULL DEFAULT '',
  country TEXT NOT NULL DEFAULT 'Deutschland',
  email TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  vat_id TEXT NOT NULL DEFAULT '',
  payment_days INTEGER,
  language TEXT NOT NULL DEFAULT 'de',
  notes TEXT NOT NULL DEFAULT '',
  archived INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS invoices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL CHECK (kind IN ('invoice','quote','storno')),
  number TEXT UNIQUE,
  status TEXT NOT NULL,
  client_id INTEGER REFERENCES clients(id) ON DELETE SET NULL,
  client_snapshot TEXT NOT NULL DEFAULT '{}',
  issue_date TEXT NOT NULL,
  service_from TEXT,
  service_to TEXT,
  due_date TEXT,
  language TEXT NOT NULL DEFAULT 'de',
  tax_treatment TEXT NOT NULL DEFAULT 'auto',
  title TEXT NOT NULL DEFAULT '',
  items TEXT NOT NULL DEFAULT '[]',
  intro_text TEXT NOT NULL DEFAULT '',
  outro_text TEXT NOT NULL DEFAULT '',
  internal_note TEXT NOT NULL DEFAULT '',
  net_cents INTEGER NOT NULL DEFAULT 0,
  tax_cents INTEGER NOT NULL DEFAULT 0,
  total_cents INTEGER NOT NULL DEFAULT 0,
  tax_mode TEXT NOT NULL DEFAULT 'kleinunternehmer',
  related_id INTEGER REFERENCES invoices(id),
  cancelled_by_id INTEGER REFERENCES invoices(id),
  converted_to_id INTEGER REFERENCES invoices(id),
  cancel_reason TEXT NOT NULL DEFAULT '',
  paid_date TEXT,
  pdf_file TEXT,
  issued_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_invoices_date ON invoices(issue_date);
CREATE TABLE IF NOT EXISTS subscriptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  vendor TEXT NOT NULL DEFAULT '',
  amount_cents INTEGER NOT NULL DEFAULT 0,
  payment_method TEXT NOT NULL DEFAULT 'card',
  folder TEXT NOT NULL DEFAULT 'subscription',
  interval TEXT NOT NULL DEFAULT 'monthly',
  start_ym TEXT NOT NULL,
  end_ym TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  folder TEXT NOT NULL CHECK (folder IN ('purchase','subscription','other','income','bank')),
  date TEXT NOT NULL,
  vendor TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  amount_cents INTEGER NOT NULL DEFAULT 0,
  payment_method TEXT NOT NULL DEFAULT 'card',
  notes TEXT NOT NULL DEFAULT '',
  subscription_id INTEGER REFERENCES subscriptions(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_entries_date ON entries(date);
CREATE TABLE IF NOT EXISTS files (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entry_id INTEGER NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
  original_name TEXT NOT NULL,
  stored_name TEXT NOT NULL,
  mime TEXT NOT NULL,
  size INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_files_entry ON files(entry_id);
CREATE INDEX IF NOT EXISTS idx_files_sha ON files(sha256);
CREATE TABLE IF NOT EXISTS months (
  ym TEXT PRIMARY KEY,
  done_at TEXT,
  exported_at TEXT,
  note TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL DEFAULT (datetime('now')),
  user_id INTEGER,
  user_name TEXT,
  action TEXT NOT NULL,
  entity TEXT NOT NULL,
  entity_id INTEGER,
  details TEXT NOT NULL DEFAULT ''
);
`);

export function tx(fn) {
  return db.transaction(fn)();
}
