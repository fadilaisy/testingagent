import cookieParser from 'cookie-parser';
import express from 'express';
import multer from 'multer';
import fs from 'node:fs';
import path from 'node:path';
import { accountRouter } from './api/account.js';
import { activitiesRouter } from './api/activities.js';
import { communityRouter } from './api/community.js';
import { miscRouter } from './api/misc.js';
import { routesRouter } from './api/routes.js';
import { HttpError, loadUser } from './auth.js';
import { createNotifier } from './notify.js';
import { createPlacesProvider } from './places.js';
import { createHub } from './realtime.js';
import { createWeatherProvider } from './weather.js';

// Builds the Express app. Providers are injectable so tests run offline.
export function createApp({ db, config = {}, weather, places } = {}) {
  const cfg = {
    appName: 'Jalur',
    production: false,
    demoMode: false,
    secureCookies: false,
    staticDir: null,
    ...config,
  };
  const hub = createHub();
  const ctx = {
    db,
    hub,
    config: cfg,
    notifier: createNotifier({ db, hub }),
    weather: weather ?? createWeatherProvider(),
    places: places ?? createPlacesProvider({ db }),
  };

  const app = express();
  app.disable('x-powered-by');
  if (cfg.trustProxy) app.set('trust proxy', cfg.trustProxy);
  app.use((_req, res, next) => {
    res.set('x-content-type-options', 'nosniff');
    res.set('referrer-policy', 'same-origin');
    next();
  });
  app.use(express.json({ limit: '200kb' }));
  app.use(cookieParser());
  app.use(loadUser(db));

  // Reject cross-site form posts: state-changing API calls must be JSON or
  // multipart sent by our own client (SameSite=Lax cookies cover the rest).
  app.use('/api', (req, _res, next) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
    const type = req.headers['content-type'] ?? '';
    if (req.headers['content-length'] === '0' || !type) return next();
    if (type.startsWith('application/json') || type.startsWith('multipart/form-data')) return next();
    next(new HttpError(415, 'Unsupported content type'));
  });

  const api = express.Router();
  api.use(accountRouter(ctx));
  api.use(routesRouter(ctx));
  api.use(activitiesRouter(ctx));
  api.use(communityRouter(ctx));
  api.use(miscRouter(ctx));
  api.use((_req, _res, next) => next(new HttpError(404, 'Not found')));
  app.use('/api', api);

  // In production the server also serves the built web app.
  if (cfg.staticDir && fs.existsSync(cfg.staticDir)) {
    app.use(express.static(cfg.staticDir, { index: false, maxAge: '1h' }));
    app.get(/^(?!\/api\/).*/, (_req, res) => res.sendFile(path.join(cfg.staticDir, 'index.html')));
  }

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, _next) => {
    if (err instanceof HttpError) {
      return res.status(err.status).json({ error: err.message, ...err.extra });
    }
    if (err instanceof multer.MulterError) {
      const message = err.code === 'LIMIT_FILE_SIZE' ? 'File is too large (max 10 MB)' : err.message;
      return res.status(400).json({ error: message });
    }
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Request body is not valid JSON' });
    if (err.type === 'entity.too.large') return res.status(413).json({ error: 'Request is too large' });
    console.error(`[error] ${req.method} ${req.originalUrl}`, err);
    res.status(500).json({ error: 'Something went wrong on our side' });
  });

  app.locals.hub = hub;
  return app;
}
