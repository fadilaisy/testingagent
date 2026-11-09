import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { test } from 'node:test';
import { signInWithGoogle } from '../src/api/google.js';
import { NO_PASSWORD, consumeResetToken, createResetToken } from '../src/auth.js';
import { loadConfig } from '../src/config.js';
import { createGoogleAuth } from '../src/google.js';
import { startTestApp } from './helpers.js';

const CLIENT_ID = 'roamr-test.apps.googleusercontent.com';
const CALLBACK = 'http://127.0.0.1/api/auth/google/callback';

// A stand-in for Google: its own RSA key, a JWKS endpoint and a token
// endpoint that hands out whatever ID token the test queued.
function fakeGoogle() {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const kid = 'test-key-1';
  const jwk = { ...publicKey.export({ format: 'jwk' }), kid, alg: 'RS256', use: 'sig' };
  let nextToken = null;
  const calls = { token: [], jwks: 0 };

  function sign(claims, { key = privateKey, headerKid = kid, alg = 'RS256' } = {}) {
    const enc = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const head = enc({ alg, kid: headerKid, typ: 'JWT' });
    const body = enc(claims);
    const sig = crypto.sign('RSA-SHA256', Buffer.from(`${head}.${body}`), key).toString('base64url');
    return `${head}.${body}.${sig}`;
  }

  function claims(overrides = {}) {
    const now = Math.floor(Date.now() / 1000);
    return {
      iss: 'https://accounts.google.com',
      aud: CLIENT_ID,
      sub: '1100000000000001',
      email: 'rider@gmail.com',
      email_verified: true,
      name: 'Rider Google',
      picture: 'https://lh3.googleusercontent.com/a/photo',
      iat: now,
      exp: now + 3600,
      ...overrides,
    };
  }

  async function fetchImpl(url, init = {}) {
    if (url.startsWith('https://www.googleapis.com/oauth2/v3/certs')) {
      calls.jwks += 1;
      return new Response(JSON.stringify({ keys: [jwk] }), { headers: { 'cache-control': 'public, max-age=3600' } });
    }
    if (url === 'https://oauth2.googleapis.com/token') {
      const form = new URLSearchParams(init.body);
      calls.token.push(Object.fromEntries(form));
      if (form.get('code') === 'bad-code') return new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400 });
      const token = typeof nextToken === 'function' ? nextToken(form) : nextToken;
      return new Response(JSON.stringify({ id_token: token, access_token: 'x', token_type: 'Bearer' }));
    }
    throw new Error(`unexpected fetch ${url}`);
  }

  const auth = createGoogleAuth({ clientId: CLIENT_ID, clientSecret: 'shh-secret', callbackUrl: CALLBACK, fetchImpl });
  return {
    auth,
    sign,
    claims,
    calls,
    queue: (t) => {
      nextToken = t;
    },
  };
}

// A browser that does not follow redirects and keeps every cookie.
function browser(base) {
  const jar = new Map();
  async function go(path, init = {}) {
    const headers = { ...(init.headers ?? {}) };
    if (jar.size) headers.cookie = [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
    const res = await fetch(base + path, { ...init, headers, redirect: 'manual' });
    for (const c of res.headers.getSetCookie()) {
      const [pair, ...attrs] = c.split(';');
      const [k, v] = pair.split('=');
      if (!v || attrs.some((a) => /expires=Thu, 01 Jan 1970/i.test(a))) jar.delete(k);
      else jar.set(k, v);
    }
    return res;
  }
  return { go, jar };
}

// Runs the whole redirect dance and returns where the callback sent the browser.
async function googleSignIn(t, g, b, { claims = {}, query = '', tamper } = {}) {
  const start = await b.go(`/api/auth/google${query}`);
  assert.equal(start.status, 302);
  const to = new URL(start.headers.get('location'));
  const nonce = to.searchParams.get('nonce');
  const state = to.searchParams.get('state');
  g.queue(g.sign(g.claims({ nonce, ...claims })));
  const cb = await b.go(`/api/auth/google/callback?code=good-code&state=${tamper?.state ?? state}`);
  assert.equal(cb.status, 302);
  return cb.headers.get('location');
}

test('the redirect to Google carries state, nonce and a PKCE challenge, and the code exchange sends the verifier', async (t) => {
  const g = fakeGoogle();
  const app = await startTestApp({ google: g.auth });
  t.after(() => app.close());
  const b = browser(app.base);

  const start = await b.go('/api/auth/google?next=/events');
  const to = new URL(start.headers.get('location'));
  assert.equal(to.origin + to.pathname, 'https://accounts.google.com/o/oauth2/v2/auth');
  assert.equal(to.searchParams.get('client_id'), CLIENT_ID);
  assert.equal(to.searchParams.get('redirect_uri'), CALLBACK);
  assert.equal(to.searchParams.get('scope'), 'openid email profile');
  assert.equal(to.searchParams.get('code_challenge_method'), 'S256');
  assert.ok(to.searchParams.get('state').length >= 32);
  assert.ok(to.searchParams.get('nonce').length >= 32);
  assert.ok(!to.toString().includes('shh-secret'), 'client secret never goes to the browser');
  const cookie = start.headers.getSetCookie().find((c) => c.startsWith('g_state='));
  assert.match(cookie, /HttpOnly/i);
  assert.match(cookie, /SameSite=Lax/i);

  g.queue(g.sign(g.claims({ nonce: to.searchParams.get('nonce') })));
  const cb = await b.go(`/api/auth/google/callback?code=good-code&state=${to.searchParams.get('state')}`);
  assert.equal(cb.headers.get('location'), '/onboarding?next=%2Fevents');
  const sent = g.calls.token[0];
  assert.equal(sent.client_secret, 'shh-secret');
  assert.equal(sent.grant_type, 'authorization_code');
  const challenge = crypto.createHash('sha256').update(sent.code_verifier).digest('base64url');
  assert.equal(challenge, to.searchParams.get('code_challenge'));
});

test('a new Google account creates one verified user and signs them in', async (t) => {
  const g = fakeGoogle();
  const app = await startTestApp({ google: g.auth });
  t.after(() => app.close());
  const b = browser(app.base);

  assert.match(await googleSignIn(t, g, b), /^\/onboarding/);
  assert.ok(b.jar.get('sid'), 'session cookie set');
  const me = await (await b.go('/api/me')).json();
  assert.equal(me.user.email, 'rider@gmail.com');
  assert.equal(me.user.name, 'Rider Google');
  assert.equal(me.user.googleLinked, true);
  const row = app.db.prepare('SELECT * FROM users WHERE email = ?').get('rider@gmail.com');
  assert.equal(row.email_verified, 1);
  assert.equal(row.password_hash, NO_PASSWORD);

  // Signing in again finds the same account.
  const again = browser(app.base);
  await googleSignIn(t, g, again);
  assert.equal(app.db.prepare('SELECT COUNT(*) AS n FROM users').get().n, 1);
  const me2 = await (await again.go('/api/me')).json();
  assert.equal(me2.user.id, me.user.id);

  // A Google-only account can't be logged into with a password.
  const login = await fetch(`${app.base}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'rider@gmail.com', password: NO_PASSWORD }),
  });
  assert.equal(login.status, 401);
});

test('the callback refuses a state from another browser, a reused state and a missing cookie', async (t) => {
  const g = fakeGoogle();
  const app = await startTestApp({ google: g.auth });
  t.after(() => app.close());

  // Attacker starts a sign-in and sends the victim the callback link.
  const attacker = browser(app.base);
  const start = await attacker.go('/api/auth/google');
  const to = new URL(start.headers.get('location'));
  g.queue(g.sign(g.claims({ nonce: to.searchParams.get('nonce') })));
  const victim = browser(app.base);
  const cb = await victim.go(`/api/auth/google/callback?code=good-code&state=${to.searchParams.get('state')}`);
  assert.equal(cb.headers.get('location'), '/login?google_error=expired');
  assert.equal(victim.jar.get('sid'), undefined);
  assert.equal(g.calls.token.length, 0, 'code is never exchanged');

  // The state was used up, so the attacker can't replay it either.
  const replay = await attacker.go(`/api/auth/google/callback?code=good-code&state=${to.searchParams.get('state')}`);
  assert.equal(replay.headers.get('location'), '/login?google_error=expired');
  assert.equal(app.db.prepare('SELECT COUNT(*) AS n FROM users').get().n, 0);
});

test('cancelling on Google and a refused code end on the login page with a message', async (t) => {
  const g = fakeGoogle();
  const app = await startTestApp({ google: g.auth });
  t.after(() => app.close());

  const b = browser(app.base);
  const to = new URL((await b.go('/api/auth/google')).headers.get('location'));
  const cancel = await b.go(`/api/auth/google/callback?error=access_denied&state=${to.searchParams.get('state')}`);
  assert.equal(cancel.headers.get('location'), '/login?google_error=cancelled');

  const b2 = browser(app.base);
  const to2 = new URL((await b2.go('/api/auth/google')).headers.get('location'));
  const bad = await b2.go(`/api/auth/google/callback?code=bad-code&state=${to2.searchParams.get('state')}`);
  assert.equal(bad.headers.get('location'), '/login?google_error=failed');
});

test('ID tokens are checked for signature, issuer, audience, expiry, nonce and verified email', async () => {
  const g = fakeGoogle();
  const nonce = 'n-123';
  const ok = await g.auth.verifyIdToken(g.sign(g.claims({ nonce })), { nonce });
  assert.equal(ok.email, 'rider@gmail.com');
  assert.equal(ok.sub, '1100000000000001');

  const other = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey;
  const bad = [
    ['forged signature', g.sign(g.claims({ nonce }), { key: other })],
    ['unknown key id', g.sign(g.claims({ nonce }), { headerKid: 'nope' })],
    ['wrong issuer', g.sign(g.claims({ nonce, iss: 'https://evil.example' }))],
    ['wrong audience', g.sign(g.claims({ nonce, aud: 'someone-else.apps.googleusercontent.com' }))],
    ['expired', g.sign(g.claims({ nonce, exp: Math.floor(Date.now() / 1000) - 600 }))],
    ['wrong nonce', g.sign(g.claims({ nonce: 'other' }))],
    ['unverified email', g.sign(g.claims({ nonce, email_verified: false }))],
    ['no email', g.sign(g.claims({ nonce, email: undefined }))],
  ];
  for (const [label, token] of bad) {
    await assert.rejects(g.auth.verifyIdToken(token, { nonce }), label);
  }
  // alg=none and garbage are rejected.
  const none = `${Buffer.from('{"alg":"none"}').toString('base64url')}.${Buffer.from(JSON.stringify(g.claims({ nonce }))).toString('base64url')}.`;
  await assert.rejects(g.auth.verifyIdToken(none, { nonce }));
  await assert.rejects(g.auth.verifyIdToken('not-a-token', { nonce }));
  // Google's keys are cached: the unknown-kid refetch is the only extra call.
  assert.ok(g.calls.jwks <= 2);
});

test('an unverified email is refused at the callback', async (t) => {
  const g = fakeGoogle();
  const app = await startTestApp({ google: g.auth });
  t.after(() => app.close());
  const where = await googleSignIn(t, g, browser(app.base), { claims: { email_verified: false } });
  assert.equal(where, '/login?google_error=unverified_email');
  assert.equal(app.db.prepare('SELECT COUNT(*) AS n FROM users').get().n, 0);
});

test('linking an existing password account keeps the user, role and data, and removes an unproven password', async (t) => {
  const g = fakeGoogle();
  const app = await startTestApp({ google: g.auth });
  t.after(() => app.close());

  const first = await app.signup('First Admin'); // first account = admin
  const pw = app.client();
  const reg = await pw.post('/api/auth/register', { email: 'Rider@Gmail.com', password: 'secret-pass', name: 'Rider Pw' });
  assert.equal(reg.status, 201);
  await pw.patch('/api/me', { bio: 'Gravel every Sunday' });
  app.db.prepare('UPDATE users SET is_admin = 1 WHERE id = ?').run(reg.body.user.id);

  const b = browser(app.base);
  const where = await googleSignIn(t, g, b);
  assert.equal(where, '/onboarding?next=%2F', 'not onboarded yet, so onboarding next');
  assert.equal(app.db.prepare('SELECT COUNT(*) AS n FROM users').get().n, 2, 'no duplicate user');
  const me = await (await b.go('/api/me')).json();
  assert.equal(me.user.id, reg.body.user.id);
  assert.equal(me.user.name, 'Rider Pw', 'profile kept');
  assert.equal(me.user.bio, 'Gravel every Sunday');
  assert.equal(me.user.isAdmin, true, 'role kept');
  assert.equal(me.user.googleLinked, true);

  // The password nobody proved they owned no longer works, and the old
  // session (possibly someone else's) is gone.
  assert.equal((await pw.get('/api/me')).body.user, null);
  const login = await app.client().post('/api/auth/login', { email: 'rider@gmail.com', password: 'secret-pass' });
  assert.equal(login.status, 401);
  const note = app.db.prepare("SELECT * FROM notifications WHERE user_id = ? AND type = 'account'").get(reg.body.user.id);
  assert.ok(note, 'user is told why their password stopped working');
  assert.ok(first.user.isAdmin);
});

test('linking an account whose email was already proven keeps its password', async (t) => {
  const g = fakeGoogle();
  const app = await startTestApp({ google: g.auth });
  t.after(() => app.close());

  const pw = app.client();
  const reg = await pw.post('/api/auth/register', { email: 'rider@gmail.com', password: 'secret-pass', name: 'Rider' });
  // A completed password reset proves the inbox.
  const forgot = await app.client().post('/api/auth/forgot', { email: 'rider@gmail.com' });
  const token = new URL(forgot.body.devResetLink, app.base).searchParams.get('token');
  assert.equal((await app.client().post('/api/auth/reset', { token, password: 'new-secret-pass' })).status, 200);

  await googleSignIn(t, g, browser(app.base));
  const login = await app.client().post('/api/auth/login', { email: 'rider@gmail.com', password: 'new-secret-pass' });
  assert.equal(login.status, 200);
  assert.equal(login.body.user.id, reg.body.user.id);
});

test('an email linked to one Google account cannot be taken by another, and suspended accounts stay out', async (t) => {
  const g = fakeGoogle();
  const app = await startTestApp({ google: g.auth });
  t.after(() => app.close());

  await googleSignIn(t, g, browser(app.base));
  const other = await googleSignIn(t, g, browser(app.base), { claims: { sub: '2200000000000002' } });
  assert.equal(other, '/login?google_error=linked_elsewhere');

  app.db.prepare('UPDATE users SET suspended = 1').run();
  const b = browser(app.base);
  assert.equal(await googleSignIn(t, g, b), '/login?google_error=suspended');
  assert.equal(b.jar.get('sid'), undefined);
});

test('invite-only sign-up applies to new Google accounts but not to existing ones', async (t) => {
  const g = fakeGoogle();
  const app = await startTestApp({ google: g.auth, config: { signupCode: 'alpha-1' } });
  t.after(() => app.close());

  assert.equal(await googleSignIn(t, g, browser(app.base)), '/login?google_error=invite_required');
  assert.equal(await googleSignIn(t, g, browser(app.base), { query: '?invite=wrong' }), '/login?google_error=invite_required');
  assert.match(await googleSignIn(t, g, browser(app.base), { query: '?invite=alpha-1' }), /^\/onboarding/);
  // Existing account: no code needed.
  app.db.prepare('UPDATE users SET onboarded = 1').run();
  assert.equal(await googleSignIn(t, g, browser(app.base)), '/');
});

test('ADMIN_EMAILS decides admin for Google sign-ups too', async (t) => {
  const g = fakeGoogle();
  const app = await startTestApp({ google: g.auth, config: { adminEmails: ['boss@gmail.com'] } });
  t.after(() => app.close());
  const b = browser(app.base);
  await googleSignIn(t, g, b);
  assert.equal((await (await b.go('/api/me')).json()).user.isAdmin, false);
  const boss = browser(app.base);
  await googleSignIn(t, g, boss, { claims: { sub: '3300000000000003', email: 'boss@gmail.com' } });
  assert.equal((await (await boss.go('/api/me')).json()).user.isAdmin, true);
});

test('only safe same-site paths are used after sign-in', async (t) => {
  const g = fakeGoogle();
  const app = await startTestApp({ google: g.auth });
  t.after(() => app.close());
  for (const next of ['https://evil.example', '//evil.example', '/\\evil.example', '/login']) {
    app.db.prepare('DELETE FROM users').run();
    const where = await googleSignIn(t, g, browser(app.base), { query: `?next=${encodeURIComponent(next)}` });
    assert.equal(where, '/onboarding?next=%2F', next);
  }
});

test('without Google settings the button is hidden and the endpoints say so', async (t) => {
  const app = await startTestApp({ google: null });
  t.after(() => app.close());
  const meta = await (await fetch(`${app.base}/api/meta`)).json();
  assert.equal(meta.googleLogin, false);
  const res = await fetch(`${app.base}/api/auth/google`, { redirect: 'manual' });
  assert.equal(res.headers.get('location'), '/login?google_error=not_configured');
});

test('signInWithGoogle never creates a second user for the same email', async (t) => {
  const app = await startTestApp({ google: null });
  t.after(() => app.close());
  const identity = { sub: 's-1', email: 'x@gmail.com', name: 'X', picture: null };
  const a = signInWithGoogle(app.db, {}, identity);
  const b = signInWithGoogle(app.db, {}, identity);
  assert.equal(a.created, true);
  assert.equal(b.created, false);
  assert.equal(a.user.id, b.user.id);
});

test('Google settings must be complete and use the right callback path', () => {
  const base = { NODE_ENV: 'production', DATABASE_FILE: '/data/x.db' };
  assert.throws(() => loadConfig({ ...base, GOOGLE_CLIENT_ID: 'id' }), /all of GOOGLE_CLIENT_ID/);
  const all = { GOOGLE_CLIENT_ID: 'id', GOOGLE_CLIENT_SECRET: 's' };
  assert.throws(() => loadConfig({ ...base, ...all, GOOGLE_CALLBACK_URL: 'http://roamr.id/api/auth/google/callback' }), /https/);
  assert.throws(() => loadConfig({ ...base, ...all, GOOGLE_CALLBACK_URL: 'https://roamr.id/callback' }), /\/api\/auth\/google\/callback/);
  const cfg = loadConfig({ ...base, ...all, GOOGLE_CALLBACK_URL: 'https://roamr.id/api/auth/google/callback' });
  assert.equal(cfg.google.clientId, 'id');
  assert.equal(loadConfig(base).google, null);
});

// Password reset emails.

function fakeMailer() {
  const sent = [];
  return { sent, mailer: { name: 'test', send: async (m) => sent.push(m) } };
}

test('with an email provider, reset links are emailed with the site address and not shown or logged', async (t) => {
  const { sent, mailer } = fakeMailer();
  const app = await startTestApp({ mailer, config: { publicUrl: 'https://roamr.example' } });
  t.after(() => app.close());
  const user = await app.signup('Reset Me');

  const logs = [];
  const orig = console.log;
  console.log = (...a) => logs.push(a.join(' '));
  let r;
  try {
    r = await app.client().post('/api/auth/forgot', { email: user.email });
  } finally {
    console.log = orig;
  }
  assert.equal(r.status, 200);
  assert.equal(r.body.devResetLink, undefined);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, user.email);
  const link = /https:\/\/roamr\.example\/reset-password\?token=([\w-]+)/.exec(sent[0].text);
  assert.ok(link, 'absolute link in the email');
  assert.ok(!logs.some((l) => l.includes(link[1])), 'token not in the logs');

  // Unknown emails get the same answer and no email.
  const unknown = await app.client().post('/api/auth/forgot', { email: 'nobody@test.dev' });
  assert.deepEqual(unknown.body, { ok: true });
  assert.equal(sent.length, 1);

  // The link works once.
  const c = app.client();
  assert.equal((await c.post('/api/auth/reset', { token: link[1], password: 'brand-new-pass' })).status, 200);
  assert.equal((await app.client().post('/api/auth/reset', { token: link[1], password: 'another-pass' })).status, 400);
});

test('reset tokens expire, are stored hashed, and a new link replaces the old one', async (t) => {
  const app = await startTestApp();
  t.after(() => app.close());
  const user = await app.signup('Token User');
  const id = user.user.id;

  const t1 = createResetToken(app.db, id);
  assert.equal(app.db.prepare('SELECT 1 FROM password_resets WHERE token = ?').get(t1), undefined, 'raw token not stored');
  const t2 = createResetToken(app.db, id);
  assert.equal(consumeResetToken(app.db, t1), null, 'older link no longer works');
  app.db.prepare('UPDATE password_resets SET expires_at = ?').run(new Date(Date.now() - 1000).toISOString());
  assert.equal(consumeResetToken(app.db, t2), null, 'expired');
  const t3 = createResetToken(app.db, id);
  assert.equal(consumeResetToken(app.db, t3), id);
  assert.equal(consumeResetToken(app.db, t3), null, 'single use');
});

test('a failing email provider does not reveal whether the account exists', async (t) => {
  const mailer = { name: 'down', send: async () => { throw new Error('boom'); } };
  const app = await startTestApp({ mailer });
  t.after(() => app.close());
  const user = await app.signup('Mail Down');
  const orig = console.error;
  console.error = () => {};
  try {
    const r = await app.client().post('/api/auth/forgot', { email: user.email });
    assert.deepEqual(r.body, { ok: true });
  } finally {
    console.error = orig;
  }
});

test('email settings must come in pairs', () => {
  const base = { NODE_ENV: 'production', DATABASE_FILE: '/data/x.db' };
  assert.throws(() => loadConfig({ ...base, RESEND_API_KEY: 're_x' }), /RESEND_API_KEY and EMAIL_FROM/);
  assert.throws(() => loadConfig({ ...base, RESEND_API_KEY: 're_x', EMAIL_FROM: 'ROAMR <no-reply@roamr.id>' }), /PUBLIC_URL/);
  const cfg = loadConfig({ ...base, RESEND_API_KEY: 're_x', EMAIL_FROM: 'a@b.c', PUBLIC_URL: 'https://roamr.id' });
  assert.equal(cfg.email.from, 'a@b.c');
});
