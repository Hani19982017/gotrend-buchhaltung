import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { db } from './db.js';
import { HttpError, wrap, str, audit } from './util.js';

const COOKIE = 'gt_session';
const SESSION_DAYS = 60;

const hashToken = (t) => crypto.createHash('sha256').update(t).digest('hex');

function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function setSessionCookie(req, res, token) {
  const parts = [
    `${COOKIE}=${token}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${SESSION_DAYS * 86400}`,
  ];
  if (req.secure) parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}

function createSession(req, res, userId) {
  const ua = req.get('user-agent');
  const token = crypto.randomBytes(32).toString('base64url');
  const expires = new Date(Date.now() + SESSION_DAYS * 86400 * 1000).toISOString();
  db.prepare('INSERT INTO sessions (id, user_id, expires_at, user_agent) VALUES (?,?,?,?)')
    .run(hashToken(token), userId, expires, str(ua, 200));
  setSessionCookie(req, res, token);
}

export function loadUser(req, _res, next) {
  const token = parseCookies(req.headers.cookie)[COOKIE];
  if (token) {
    const row = db.prepare(`SELECT u.id, u.name, u.email, s.expires_at FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = ?`)
      .get(hashToken(token));
    if (row && row.expires_at > new Date().toISOString()) {
      req.user = { id: row.id, name: row.name, email: row.email };
      req.sessionId = hashToken(token);
    }
  }
  next();
}

export function requireAuth(req, _res, next) {
  if (!req.user) return next(new HttpError(401, 'يرجى تسجيل الدخول'));
  next();
}

// Simple CSRF guard: state-changing requests must carry a custom header,
// which cross-site forms cannot set.
export function csrfGuard(req, _res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (req.get('x-gt') !== '1') return next(new HttpError(403, 'طلب مرفوض'));
  next();
}

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'محاولات كتيرة، جرّب بعد ربع ساعة' },
});

function validatePassword(pw) {
  if (typeof pw !== 'string' || pw.length < 8) throw new HttpError(400, 'كلمة السر لازم تكون ٨ أحرف على الأقل');
}

export const authRouter = Router();

authRouter.get('/state', (req, res) => {
  const count = db.prepare('SELECT COUNT(*) AS c FROM users').get().c;
  res.json({ setupNeeded: count === 0, setupCodeRequired: !!process.env.SETUP_CODE, user: req.user || null });
});

authRouter.post('/setup', loginLimiter, wrap((req, res) => {
  const count = db.prepare('SELECT COUNT(*) AS c FROM users').get().c;
  if (count > 0) throw new HttpError(400, 'الحساب موجود مسبقاً');
  const code = process.env.SETUP_CODE;
  if (code && str(req.body.setupCode) !== code) throw new HttpError(403, 'رمز الإعداد غلط');
  const name = str(req.body.name, 80);
  const email = str(req.body.email, 120).toLowerCase();
  if (!name || !email.includes('@')) throw new HttpError(400, 'الاسم والإيميل مطلوبين');
  validatePassword(req.body.password);
  const hash = bcrypt.hashSync(req.body.password, 12);
  const info = db.prepare('INSERT INTO users (name, email, password_hash) VALUES (?,?,?)').run(name, email, hash);
  createSession(req, res, info.lastInsertRowid);
  audit({ user: { id: info.lastInsertRowid, name } }, 'setup', 'user', info.lastInsertRowid);
  res.json({ ok: true });
}));

authRouter.post('/login', loginLimiter, wrap((req, res) => {
  const email = str(req.body.email, 120).toLowerCase();
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  const ok = user && bcrypt.compareSync(String(req.body.password || ''), user.password_hash);
  if (!ok) throw new HttpError(401, 'الإيميل أو كلمة السر غلط');
  db.prepare("DELETE FROM sessions WHERE expires_at < ?").run(new Date().toISOString());
  createSession(req, res, user.id);
  res.json({ ok: true });
}));

authRouter.post('/logout', (req, res) => {
  if (req.sessionId) db.prepare('DELETE FROM sessions WHERE id = ?').run(req.sessionId);
  res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
  res.json({ ok: true });
});

authRouter.post('/password', requireAuth, wrap((req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!bcrypt.compareSync(String(req.body.current || ''), user.password_hash)) throw new HttpError(400, 'كلمة السر الحالية غلط');
  validatePassword(req.body.password);
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(bcrypt.hashSync(req.body.password, 12), user.id);
  // sign out all other sessions
  db.prepare('DELETE FROM sessions WHERE user_id = ? AND id != ?').run(user.id, req.sessionId);
  audit(req, 'password_change', 'user', user.id);
  res.json({ ok: true });
}));

authRouter.get('/users', requireAuth, (_req, res) => {
  res.json(db.prepare('SELECT id, name, email, created_at FROM users ORDER BY id').all());
});

authRouter.post('/users', requireAuth, wrap((req, res) => {
  const name = str(req.body.name, 80);
  const email = str(req.body.email, 120).toLowerCase();
  if (!name || !email.includes('@')) throw new HttpError(400, 'الاسم والإيميل مطلوبين');
  validatePassword(req.body.password);
  if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(email)) throw new HttpError(400, 'هالإيميل مستعمل');
  const info = db.prepare('INSERT INTO users (name, email, password_hash) VALUES (?,?,?)')
    .run(name, email, bcrypt.hashSync(req.body.password, 12));
  audit(req, 'create', 'user', info.lastInsertRowid, email);
  res.json({ id: info.lastInsertRowid });
}));

authRouter.delete('/users/:id', requireAuth, wrap((req, res) => {
  const id = Number(req.params.id);
  if (id === req.user.id) throw new HttpError(400, 'ما فيك تحذف حسابك');
  db.prepare('DELETE FROM users WHERE id = ?').run(id);
  audit(req, 'delete', 'user', id);
  res.json({ ok: true });
}));
