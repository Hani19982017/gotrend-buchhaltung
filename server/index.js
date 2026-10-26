import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import express from 'express';
import helmet from 'helmet';
import compression from 'compression';
import { DATA_DIR } from './db.js';
import { authRouter, loadUser, requireAuth, csrfGuard } from './auth.js';
import { router } from './routes.js';
import { invoicesRouter } from './invoices.js';
import { exportRouter, runDailyBackup } from './export.js';
import { HttpError } from './util.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.join(here, '..', 'client', 'dist');
const PORT = Number(process.env.PORT || 3000);

const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      'default-src': ["'self'"],
      'img-src': ["'self'", 'data:', 'blob:'],
      'script-src': ["'self'"],
      'style-src': ["'self'", "'unsafe-inline'"],
      'font-src': ["'self'", 'data:'],
      'worker-src': ["'self'", 'blob:'],
      'frame-src': ["'self'", 'blob:'],
      'object-src': ["'self'", 'blob:'],
      'connect-src': ["'self'"],
      'upgrade-insecure-requests': process.env.NODE_ENV === 'production' ? [] : null,
    },
  },
  crossOriginEmbedderPolicy: false,
}));
app.use(compression());
app.use(express.json({ limit: '2mb' }));
app.use(loadUser);

app.get('/api/health', (_req, res) => res.json({ ok: true }));
app.use('/api', csrfGuard);
app.use('/api/auth', authRouter);
app.use('/api', requireAuth);
app.use('/api/invoices', invoicesRouter);
app.use('/api', exportRouter);
app.use('/api', router);
app.use('/api', (_req, _res, next) => next(new HttpError(404, 'غير موجود')));

if (fs.existsSync(DIST)) {
  app.use(express.static(DIST, {
    index: false,
    setHeaders: (res, p) => {
      if (p.includes(`${path.sep}assets${path.sep}`)) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      else res.setHeader('Cache-Control', 'no-cache');
    },
  }));
  app.get(/^\/(?!api\/).*/, (_req, res) => {
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(path.join(DIST, 'index.html'));
  });
}

// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  if (err?.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: 'الملف كبير كتير (الحد ٢٥ ميغا)' });
  if (err?.type === 'entity.too.large') return res.status(413).json({ error: 'البيانات كبيرة كتير' });
  const status = err.status || 500;
  if (status >= 500) console.error(err);
  res.status(status).json({ error: status >= 500 ? 'صار خطأ بالخادم' : err.message });
});

const server = app.listen(PORT, () => {
  console.log(`Go.Trend Buchhaltung läuft auf http://localhost:${PORT} (Daten: ${DATA_DIR})`);
});

runDailyBackup().catch((e) => console.error('[backup]', e));
setInterval(() => runDailyBackup().catch((e) => console.error('[backup]', e)), 6 * 3600 * 1000).unref();

export default server;
