import crypto from 'node:crypto';
import { Router } from 'express';
import { NO_PASSWORD, createSession, rateLimit, sessionCookieOptions } from '../auth.js';
import { nowIso, transaction } from '../db.js';
import { GoogleAuthError, pkcePair } from '../google.js';

const STATE_COOKIE = 'g_state';
const STATE_MINUTES = 10;

// Where the browser lands after a failed Google sign-in. The login page turns
// the code into a message.
const failure = (code) => `/login?google_error=${encodeURIComponent(code)}`;

// Same rule as the web app: only same-site, non-auth paths.
export function safeNextPath(next) {
  if (typeof next !== 'string' || !next.startsWith('/') || next.startsWith('//') || next.includes('\\')) return '/';
  if (/^\/(login|register|onboarding|forgot-password|reset-password|api)\b/.test(next)) return '/';
  return next.slice(0, 300);
}

// Finds or creates the user for a verified Google identity. Throws
// GoogleAuthError for sign-ins that must not go through.
export function signInWithGoogle(db, config, identity, { inviteCode = null } = {}) {
  return transaction(db, () => {
    const bySub = db.prepare('SELECT * FROM users WHERE google_sub = ?').get(identity.sub);
    if (bySub) {
      if (bySub.suspended) throw new GoogleAuthError('suspended', 'This account is suspended');
      return { user: bySub, created: false, passwordCleared: false };
    }

    const byEmail = db.prepare('SELECT * FROM users WHERE email = ?').get(identity.email);
    if (byEmail) {
      if (byEmail.google_sub) throw new GoogleAuthError('linked_elsewhere', 'This email is linked to a different Google account');
      if (byEmail.suspended) throw new GoogleAuthError('suspended', 'This account is suspended');
      // Password sign-ups never proved they own the email. If someone else
      // registered this address first, they would know the password and keep
      // access after the real owner links Google ("pre-account takeover").
      // So the unproven password is removed and every session is ended; the
      // owner can set a new password with "Forgot password".
      const clearPassword = !byEmail.email_verified && byEmail.password_hash !== NO_PASSWORD;
      if (clearPassword) db.prepare('DELETE FROM sessions WHERE user_id = ?').run(byEmail.id);
      const user = db
        .prepare(
          `UPDATE users SET google_sub = ?, email_verified = 1, password_hash = CASE WHEN ? THEN ? ELSE password_hash END,
             photo_url = COALESCE(photo_url, ?) WHERE id = ? RETURNING *`,
        )
        .get(identity.sub, clearPassword ? 1 : 0, NO_PASSWORD, identity.picture, byEmail.id);
      return { user, created: false, passwordCleared: clearPassword };
    }

    if (config.signupCode && String(inviteCode ?? '').trim() !== config.signupCode) {
      throw new GoogleAuthError('invite_required', 'An invite code is needed to create an account');
    }
    // Same admin rule as email sign-up.
    const adminEmails = config.adminEmails ?? [];
    const isAdmin = adminEmails.length ? adminEmails.includes(identity.email) : !db.prepare('SELECT 1 FROM users LIMIT 1').get();
    const name = (identity.name || identity.email.split('@')[0]).slice(0, 60);
    const user = db
      .prepare(
        `INSERT INTO users (email, password_hash, name, photo_url, is_admin, google_sub, email_verified)
         VALUES (?, ?, ?, ?, ?, ?, 1) RETURNING *`,
      )
      .get(identity.email, NO_PASSWORD, name, identity.picture, isAdmin ? 1 : 0, identity.sub);
    return { user, created: true, passwordCleared: false };
  });
}

export function googleRouter({ db, config, google, notifier }) {
  const router = Router();
  const limit = rateLimit({ windowMs: 10 * 60 * 1000, max: config.authRateLimit ?? 30 });
  const stateCookie = {
    httpOnly: true,
    sameSite: 'lax', // must survive the top-level redirect back from Google
    secure: Boolean(config.secureCookies),
    path: '/api/auth/google',
    maxAge: STATE_MINUTES * 60e3,
  };

  // Step 1: send the browser to Google.
  router.get('/auth/google', limit, (req, res) => {
    if (!google) return res.redirect(failure('not_configured'));
    const state = crypto.randomBytes(24).toString('base64url');
    const nonce = crypto.randomBytes(24).toString('base64url');
    const { verifier, challenge } = pkcePair();
    db.prepare('DELETE FROM oauth_states WHERE expires_at <= ?').run(nowIso());
    db.prepare(
      'INSERT INTO oauth_states (state, nonce, code_verifier, invite_code, next_path, expires_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(
      state, nonce, verifier,
      typeof req.query.invite === 'string' ? req.query.invite.slice(0, 100) : null,
      safeNextPath(req.query.next),
      new Date(Date.now() + STATE_MINUTES * 60e3).toISOString(),
    );
    res.cookie(STATE_COOKIE, state, stateCookie);
    res.set('cache-control', 'no-store').redirect(google.authorizationUrl({ state, nonce, codeChallenge: challenge }));
  });

  // Step 2: Google sends the browser back here.
  router.get('/auth/google/callback', limit, async (req, res) => {
    res.set('cache-control', 'no-store');
    // Express 5 drops maxAge here; the other attributes must match for the browser to clear it.
    res.clearCookie(STATE_COOKIE, stateCookie);
    if (!google) return res.redirect(failure('not_configured'));

    // Everything below can throw (database included); the browser expects a
    // redirect, never the JSON error handler.
    try {
      const state = typeof req.query.state === 'string' ? req.query.state : '';
      const cookieState = req.cookies?.[STATE_COOKIE] ?? '';
      // The state must match the cookie this browser got in step 1 (stops
      // someone from logging a victim into the attacker's account) and is
      // used up straight away.
      const pending = state ? db.prepare('DELETE FROM oauth_states WHERE state = ? RETURNING *').get(state) : null;
      db.prepare('DELETE FROM oauth_states WHERE expires_at <= ?').run(nowIso());
      const sameBrowser =
        cookieState.length === state.length && state && crypto.timingSafeEqual(Buffer.from(cookieState), Buffer.from(state));
      if (!pending || !sameBrowser || pending.expires_at <= nowIso()) return res.redirect(failure('expired'));

      if (req.query.error) {
        return res.redirect(failure(req.query.error === 'access_denied' ? 'cancelled' : 'failed'));
      }
      if (typeof req.query.code !== 'string' || !req.query.code) return res.redirect(failure('failed'));

      const idToken = await google.exchangeCode(req.query.code, pending.code_verifier);
      const identity = await google.verifyIdToken(idToken, { nonce: pending.nonce });
      const { user, created, passwordCleared } = signInWithGoogle(db, config, identity, { inviteCode: pending.invite_code });
      const { token } = createSession(db, user.id);
      res.cookie('sid', token, sessionCookieOptions(config.secureCookies));
      if (passwordCleared) {
        notifier.notify(user.id, {
          type: 'account',
          title: 'Google is now linked to your account',
          body: 'For your safety the old password was removed. Use "Forgot password" if you want to log in with a password too.',
          link: '/forgot-password',
        });
      }
      const next = pending.next_path ?? '/';
      res.redirect(created || !user.onboarded ? `/onboarding?next=${encodeURIComponent(next)}` : next);
    } catch (err) {
      const code = err instanceof GoogleAuthError ? err.code : 'failed';
      console.error(`[google] sign-in failed (${code}): ${err.message}`);
      res.redirect(failure(code === 'exchange_failed' || code === 'google_unreachable' || code === 'invalid_token' ? 'failed' : code));
    }
  });

  return router;
}
