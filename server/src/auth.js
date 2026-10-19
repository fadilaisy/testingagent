import crypto from 'node:crypto';
import { nowIso } from './db.js';

const SESSION_DAYS = 30;
const SCRYPT_KEYLEN = 64;

export class HttpError extends Error {
  constructor(status, message, extra) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

export function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, SCRYPT_KEYLEN);
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export function verifyPassword(password, stored) {
  const [scheme, saltB64, hashB64] = String(stored).split('$');
  if (scheme !== 'scrypt' || !saltB64 || !hashB64) return false;
  const expected = Buffer.from(hashB64, 'base64');
  const actual = crypto.scryptSync(password, Buffer.from(saltB64, 'base64'), expected.length);
  return crypto.timingSafeEqual(expected, actual);
}

export function createSession(db, userId) {
  const token = crypto.randomBytes(32).toString('base64url');
  const expires = new Date(Date.now() + SESSION_DAYS * 864e5).toISOString();
  db.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)').run(token, userId, expires);
  return { token, expires };
}

export function destroySession(db, token) {
  if (token) db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
}

export function createResetToken(db, userId) {
  const token = crypto.randomBytes(24).toString('base64url');
  const expires = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  db.prepare('INSERT INTO password_resets (token, user_id, expires_at) VALUES (?, ?, ?)').run(token, userId, expires);
  return token;
}

export function consumeResetToken(db, token) {
  const row = db
    .prepare('SELECT user_id FROM password_resets WHERE token = ? AND expires_at > ?')
    .get(String(token ?? ''), nowIso());
  db.prepare('DELETE FROM password_resets WHERE token = ?').run(String(token ?? ''));
  return row?.user_id ?? null;
}

export function sessionCookieOptions(secure) {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure,
    path: '/',
    maxAge: SESSION_DAYS * 864e5,
  };
}

// Attaches req.user (or null) from the session cookie.
export function loadUser(db) {
  const stmt = db.prepare(
    `SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token = ? AND s.expires_at > ? AND u.suspended = 0`,
  );
  return (req, _res, next) => {
    const token = req.cookies?.sid;
    req.user = token ? stmt.get(token, nowIso()) ?? null : null;
    next();
  };
}

export function requireUser(req, _res, next) {
  if (!req.user) return next(new HttpError(401, 'Please log in first'));
  next();
}

export function requireAdmin(req, _res, next) {
  if (!req.user?.is_admin) return next(new HttpError(403, 'Admins only'));
  next();
}

export function isPremium(db, userId) {
  return Boolean(
    db
      .prepare(
        `SELECT 1 FROM subscriptions WHERE user_id = ? AND status = 'active' AND end_date > ? LIMIT 1`,
      )
      .get(userId, nowIso()),
  );
}

// Small fixed-window limiter for auth endpoints (PRD §42 rate limiting).
export function rateLimit({ windowMs, max }) {
  const hits = new Map();
  return (req, _res, next) => {
    const key = req.ip ?? 'unknown';
    const now = Date.now();
    const entry = hits.get(key);
    if (!entry || now - entry.start > windowMs) {
      hits.set(key, { start: now, count: 1 });
      return next();
    }
    entry.count += 1;
    if (entry.count > max) return next(new HttpError(429, 'Too many attempts, try again in a few minutes'));
    next();
  };
}
