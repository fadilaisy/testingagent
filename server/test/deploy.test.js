import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { promoteAdmins } from '../src/auth.js';
import { DEFAULT_DATABASE_DIR, loadConfig, parseTrustProxy } from '../src/config.js';
import { hasDemoData, seed } from '../src/seed.js';
import { startTestApp, testDb } from './helpers.js';

const register = (c, email, extra = {}) =>
  c.post('/api/auth/register', { email, password: 'secret-pass', name: 'Tester', ...extra });

describe('config', () => {
  test('development defaults seed demo data and use the local database', () => {
    const cfg = loadConfig({});
    assert.equal(cfg.production, false);
    assert.equal(cfg.seed, true);
    assert.equal(cfg.demoMode, true);
    assert.equal(cfg.port, 3001);
    assert.equal(cfg.database, DEFAULT_DATABASE_DIR);
    assert.equal(cfg.signupCode, null);
  });

  test('production needs a database path and keeps demo data off', () => {
    assert.throws(() => loadConfig({ NODE_ENV: 'production' }), /DATABASE_URL/);
    assert.throws(() => loadConfig({ NODE_ENV: 'production', DATABASE_URL: '/data/pglite' }), /postgres:\/\//, 'no embedded database in production');
    const cfg = loadConfig({ NODE_ENV: 'production', DATABASE_URL: 'postgres://roamr:pw@db:5432/roamr', PORT: '8080' });
    assert.equal(cfg.database, 'postgres://roamr:pw@db:5432/roamr');
    assert.equal(cfg.seed, false);
    assert.equal(cfg.demoMode, false);
    assert.equal(cfg.secureCookies, true);
    assert.equal(cfg.port, 8080);
  });

  test('explicit flags override the defaults', () => {
    const cfg = loadConfig({ NODE_ENV: 'production', DATABASE_URL: 'postgres://roamr@db/roamr', SEED: '1', DEMO_MODE: '1', INSECURE_COOKIES: '1' });
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
  test('hasDemoData spots seeded accounts', async () => {
    const db = await testDb();
    assert.equal(await hasDemoData(db), false);
    await seed(db);
    assert.equal(await hasDemoData(db), true);
    db.close();
  });

  test('promoteAdmins grants admin to listed accounts once', async () => {
    const db = await testDb();
    await db.prepare("INSERT INTO users (email, password_hash, name) VALUES ('a@x.dev', 'h', 'A'), ('b@x.dev', 'h', 'B')").run();
    assert.equal(await promoteAdmins(db, ['a@x.dev', 'missing@x.dev']), 1);
    assert.equal(await promoteAdmins(db, ['a@x.dev']), 0);
    assert.equal((await db.prepare("SELECT is_admin FROM users WHERE email = 'b@x.dev'").get()).is_admin, 0);
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

describe('AWS single deployment (deploy/aws)', () => {
  const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');
  const compose = read('../../deploy/aws/compose.yml');
  const env = Object.fromEntries(
    [...compose.matchAll(/^ {6}([A-Z_]+): '?([^'\n]*)'?$/gm)].map(([, name, value]) => [name, value]),
  );

  // DATABASE_URL as setup-instance.sh writes it into /opt/roamr/.env.
  const setup = read('../../deploy/aws/setup-instance.sh');
  const databaseUrl = /^DATABASE_URL=(\S+)$/m.exec(setup)[1].replace('$pw', 'secret');

  test('compose settings make a valid production config with one proxy hop', () => {
    const cfg = loadConfig({ ...env, DATABASE_URL: databaseUrl });
    assert.equal(cfg.production, true);
    assert.equal(cfg.port, 3001);
    assert.equal(cfg.trustProxy, 1, 'Caddy is the only proxy in front of the app');
    assert.equal(cfg.secureCookies, true);
    assert.match(compose, /localhost:3001\/api\/health/);
  });

  test('the app reaches the compose Postgres with the user, database and password it is given', () => {
    const url = new URL(databaseUrl);
    assert.equal(url.hostname, 'db', 'the compose service name');
    assert.equal(url.port, '5432');
    assert.equal(url.username, env.POSTGRES_USER);
    assert.equal(url.pathname, `/${env.POSTGRES_DB}`);
    assert.match(setup, /POSTGRES_PASSWORD=\$pw/, 'Postgres and the app share one generated password');
    assert.match(compose, /image: postgres:17/);
    assert.match(compose, /- \/opt\/roamr\/postgres:\/var\/lib\/postgresql\/data$/m, 'data lives on the instance disk');
    assert.match(compose, /condition: service_healthy/, 'the app waits for the database');
    const dbService = compose.slice(compose.indexOf('  db:'), compose.indexOf('  app:'));
    assert.doesNotMatch(dbService, /^ +ports:/m, 'Postgres is not exposed outside the instance');
  });

  test('Caddy proxies the whole site to the app and keeps live chat streaming', () => {
    const caddy = read('../../deploy/aws/Caddyfile');
    assert.match(caddy, /reverse_proxy app:3001/);
    assert.match(caddy, /flush_interval -1/);
  });

  describe('one server answers the web app and the API', () => {
    let t;
    let dir;
    before(async () => {
      dir = mkdtempSync(path.join(tmpdir(), 'roamr-dist-'));
      mkdirSync(path.join(dir, 'assets'));
      writeFileSync(path.join(dir, 'index.html'), '<!doctype html><div id="root"></div>');
      writeFileSync(path.join(dir, 'assets', 'app-abc123.js'), 'console.log(1)');
      t = await startTestApp({ config: { staticDir: dir } });
    });
    after(() => {
      t.close();
      rmSync(dir, { recursive: true, force: true });
    });

    test('pages and client-side routes get index.html', async () => {
      for (const p of ['/', '/events/12', '/register?invite=alpha-1']) {
        const r = await t.client().get(p, { raw: true });
        assert.equal(r.status, 200, p);
        assert.match(await r.text(), /id="root"/, p);
      }
    });

    test('built assets and the API are served by the same origin', async () => {
      const asset = await t.client().get('/assets/app-abc123.js', { raw: true });
      assert.equal(asset.status, 200);
      assert.equal(await asset.text(), 'console.log(1)');
      assert.deepEqual((await t.client().get('/api/health')).body, { ok: true });
      assert.equal((await t.client().get('/api/nope')).status, 404, 'unknown API paths stay JSON 404s');
    });
  });
});
