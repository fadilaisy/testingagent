import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.js';
import { openDb } from './db.js';
import { seedIfEmpty } from './seed.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const production = process.env.NODE_ENV === 'production';
const port = Number(process.env.PORT ?? 3001);
const dbFile = process.env.DATABASE_FILE ?? path.join(here, '..', 'data', 'jalur.db');
// Demo mode relaxes the check-in time window and enables "use the meeting
// point as my location", so the core loop can be tried away from Jakarta.
const demoMode = process.env.DEMO_MODE ? process.env.DEMO_MODE === '1' : !production;

const db = openDb(dbFile);
if (process.env.SEED !== '0') seedIfEmpty(db);

const app = createApp({
  db,
  config: {
    production,
    demoMode,
    secureCookies: production && process.env.INSECURE_COOKIES !== '1',
    trustProxy: process.env.TRUST_PROXY,
    staticDir: path.join(here, '..', '..', 'web', 'dist'),
  },
});

const server = app.listen(port, () => {
  console.log(`Jalur API listening on http://localhost:${port}${demoMode ? ' (demo mode)' : ''}`);
});

function shutdown() {
  app.locals.hub.closeAll();
  server.close(() => {
    db.close();
    process.exit(0);
  });
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
