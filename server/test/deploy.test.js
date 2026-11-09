import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { promoteAdmins } from '../src/auth.js';
import { DEFAULT_DATABASE_FILE, loadConfig, parseTrustProxy } from '../src/config.js';
import { openDb } from '../src/db.js';
import { hasDemoData, seed } from '../src/seed.js';
import { startTestApp } from './helpers.js';

const register = (c, email, extra = {}) =>
  c.post('/api/auth/register', { email, password: 'secret-pass', name: 'Tester', ...extra });

describe('config', () => {
  test('development defaults seed demo data and use the local database', () => {
    const cfg = loadConfig({});
    assert.equal(cfg.production, false);
    assert.equal(cfg.seed, true);
    assert.equal(cfg.demoMode, true);
    assert.equal(cfg.port, 3001);
    assert.equal(cfg.databaseFile, DEFAULT_DATABASE_FILE);
    assert.equal(cfg.signupCode, null);
  });

  test('production needs a database path and keeps demo data off', () => {
    assert.throws(() => loadConfig({ NODE_ENV: 'production' }), /DATABASE_FILE/);
    const cfg = loadConfig({ NODE_ENV: 'production', DATABASE_FILE: '/data/roamr.db', PORT: '8080' });
    assert.equal(cfg.seed, false);
    assert.equal(cfg.demoMode, false);
    assert.equal(cfg.secureCookies, true);
    assert.equal(cfg.port, 8080);
  });

  test('explicit flags override the defaults', () => {
    const cfg = loadConfig({ NODE_ENV: 'production', DATABASE_FILE: '/d.db', SEED: '1', DEMO_MODE: '1', INSECURE_COOKIES: '1' });
    assert.equal(cfg.seed, true);
    assert.equal(cfg.demoMode, true);
    assert.equal(cfg.secureCookies, false);
    assert.equal(loadConfig({ SEED: '0' }).seed, false);
  });

  test('admin emails and invite code are parsed', () => {
    const cfg = loadConfig({ ADMIN_EMAILS: ' Fadil@Example.com, ops@example.com ,', SIGNUP_CODE: ' alpha-1 ' });
    assert.deepEqual(cfg.adminEmails, ['fadil@example.com', 'ops@example.com']);
    assert.equal(cfg.signupCode, 'alpha-1');
  });

  test('rejects a bad port', () => {
    assert.throws(() => loadConfig({ PORT: 'abc' }), /PORT/);
  });

  test('trust proxy hop counts become numbers', () => {
    assert.equal(parseTrustProxy(undefined), undefined);
    assert.equal(parseTrustProxy('1'), 1);
    assert.equal(parseTrustProxy('true'), true);
    assert.equal(parseTrustProxy('loopback'), 'loopback');
  });
});

describe('demo data detection and admin promotion', () => {
  test('hasDemoData spots seeded accounts', () => {
    const db = openDb(':memory:');
    assert.equal(hasDemoData(db), false);
    seed(db);
    assert.equal(hasDemoData(db), true);
    db.close();
  });

  test('promoteAdmins grants admin to listed accounts once', () => {
    const db = openDb(':memory:');
    db.prepare("INSERT INTO users (email, password_hash, name) VALUES ('a@x.dev', 'h', 'A'), ('b@x.dev', 'h', 'B')").run();
    assert.equal(promoteAdmins(db, ['a@x.dev', 'missing@x.dev']), 1);
    assert.equal(promoteAdmins(db, ['a@x.dev']), 0);
    assert.equal(db.prepare("SELECT is_admin FROM users WHERE email = 'b@x.dev'").get().is_admin, 0);
    db.close();
  });
});

describe('health check', () => {
  let t;
  before(async () => (t = await startTestApp()));
  after(() => t.close());

  test('answers ok without signing in', async () => {
    const r = await t.client().get('/api/health');
    assert.equal(r.status, 200);
    assert.deepEqual(r.body, { ok: true });
  });
});

describe('closed alpha sign-up', () => {
  let t;
  before(async () => (t = await startTestApp({ config: { signupCode: 'alpha-1', adminEmails: ['fadil@roamr.app'] } })));
  after(() => t.close());

  test('meta tells the client an invite code is needed', async () => {
    assert.equal((await t.client().get('/api/meta')).body.inviteRequired, true);
  });

  test('registration needs the invite code', async () => {
    const missing = await register(t.client(), 'nocode@test.dev');
    assert.equal(missing.status, 403);
    assert.equal(missing.body.field, 'Invite code');
    assert.equal((await register(t.client(), 'wrong@test.dev', { inviteCode: 'nope' })).status, 403);
    assert.equal((await register(t.client(), 'ok@test.dev', { inviteCode: ' alpha-1 ' })).status, 201);
  });

  test('with ADMIN_EMAILS set, only listed accounts become admin', async () => {
    // ok@test.dev registered first above but is not listed.
    const first = await t.client().post('/api/auth/login', { email: 'ok@test.dev', password: 'secret-pass' });
    assert.equal(first.body.user.isAdmin, false);
    const admin = await register(t.client(), 'Fadil@Roamr.app', { inviteCode: 'alpha-1' });
    assert.equal(admin.status, 201);
    assert.equal(admin.body.user.isAdmin, true);
  });
});

describe('open sign-up', () => {
  let t;
  before(async () => (t = await startTestApp()));
  after(() => t.close());

  test('no invite code needed when SIGNUP_CODE is unset', async () => {
    assert.equal((await t.client().get('/api/meta')).body.inviteRequired, false);
    const r = await register(t.client(), 'open@test.dev');
    assert.equal(r.status, 201);
    assert.equal(r.body.user.isAdmin, true, 'first account is still admin');
  });
});
