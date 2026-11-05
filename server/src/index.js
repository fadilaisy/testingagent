import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.js';
import { promoteAdmins } from './auth.js';
import { loadConfig } from './config.js';
import { openDb } from './db.js';
import { hasDemoData, seedIfEmpty } from './seed.js';

const here = path.dirname(fileURLToPath(import.meta.url));

let settings;
try {
  settings = loadConfig();
} catch (err) {
  console.error(`[config] ${err.message}`);
  process.exit(1);
}
const { production, port, databaseFile, seed, demoMode } = settings;

const db = openDb(databaseFile);
if (seed) seedIfEmpty(db);
// Demo accounts share a known password, so a production database that has
// them (e.g. copied from a laptop) must not go live by accident.
if (production && !seed && hasDemoData(db)) {
  console.error('[config] This database contains demo accounts (@roamr.test). Use a fresh DATABASE_FILE, or set SEED=1 for a public demo.');
  process.exit(1);
}
const promoted = promoteAdmins(db, settings.adminEmails);
if (promoted) console.log(`Granted admin to ${promoted} account(s) from ADMIN_EMAILS.`);

const app = createApp({
  db,
  config: {
    production,
    demoMode,
    secureCookies: settings.secureCookies,
    trustProxy: settings.trustProxy,
    adminEmails: settings.adminEmails,
    signupCode: settings.signupCode,
    staticDir: path.join(here, '..', '..', 'web', 'dist'),
  },
});

const server = app.listen(port, () => {
  const notes = [demoMode && 'demo mode', settings.signupCode && 'invite code required'].filter(Boolean);
  console.log(`Roamr API listening on http://localhost:${port}${notes.length ? ` (${notes.join(', ')})` : ''}`);
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
