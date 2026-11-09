import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const DEFAULT_DATABASE_FILE = path.join(here, '..', 'data', 'roamr.db');

// Reads server settings from environment variables (see .env.example).
// Throws on settings that would lose data or leave the app open by mistake,
// so a bad deploy fails at start instead of later.
export function loadConfig(env = process.env) {
  const production = env.NODE_ENV === 'production';
  const flag = (name, fallback) => (env[name] ? env[name] === '1' : fallback);

  if (production && !env.DATABASE_FILE) {
    throw new Error('DATABASE_FILE must be set in production (point it at a persistent volume, e.g. /data/roamr.db)');
  }

  const port = Number(env.PORT ?? 3001);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`PORT is not a valid port: ${env.PORT}`);

  const midtransKey = env.MIDTRANS_SERVER_KEY?.trim() || null;
  const midtransProduction = env.MIDTRANS_PRODUCTION === '1';
  if (midtransKey && midtransProduction && midtransKey.startsWith('SB-')) {
    throw new Error('MIDTRANS_PRODUCTION=1 needs the production server key, not the sandbox one (SB-...)');
  }
  const publicUrl = env.PUBLIC_URL?.trim().replace(/\/+$/, '') || null;
  if (publicUrl && !/^https?:\/\//.test(publicUrl)) throw new Error(`PUBLIC_URL must start with https://: ${publicUrl}`);
  if (production && midtransKey && !publicUrl) {
    throw new Error('PUBLIC_URL must be set when MIDTRANS_SERVER_KEY is, so Midtrans can send participants back to the event page');
  }

  return {
    production,
    port,
    databaseFile: env.DATABASE_FILE ?? DEFAULT_DATABASE_FILE,
    // Demo data and demo mode are for local development and demos only.
    // In production both stay off unless explicitly turned on.
    seed: flag('SEED', !production),
    demoMode: flag('DEMO_MODE', !production),
    secureCookies: production && env.INSECURE_COOKIES !== '1',
    trustProxy: parseTrustProxy(env.TRUST_PROXY),
    adminEmails: list(env.ADMIN_EMAILS).map((e) => e.toLowerCase()),
    signupCode: env.SIGNUP_CODE?.trim() || null,
    publicUrl,
    midtrans: midtransKey ? { serverKey: midtransKey, production: midtransProduction } : null,
  };
}

// Express treats any string as a list of trusted addresses, so "1" would
// trust nobody. Hop counts and booleans need converting first.
export function parseTrustProxy(value) {
  if (value == null || value === '') return undefined;
  if (/^\d+$/.test(value)) return Number(value);
  if (value === 'true') return true;
  if (value === 'false') return false;
  return value;
}

function list(value) {
  return (value ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}
