import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { after, before, describe, test } from 'node:test';
import { hashPassword } from '../src/auth.js';
import { copySqliteToPostgres } from '../src/migrate-sqlite.js';
import { startTestApp, testDb } from './helpers.js';

const OLD_SCHEMA = readFileSync(new URL('./fixtures/sqlite-schema.sql', import.meta.url), 'utf8');

let dir;
before(() => (dir = mkdtempSync(path.join(tmpdir(), 'roamr-migrate-'))));
after(() => rmSync(dir, { recursive: true, force: true }));

// An old-format file with a little of everything, as the live site has it.
function oldSite(name) {
  const file = path.join(dir, `${name}.db`);
  const s = new DatabaseSync(file);
  s.exec(OLD_SCHEMA);
  s.prepare("INSERT INTO users (id, email, password_hash, name, is_admin, lat, lng) VALUES (1, 'fadil@roamr.app', ?, 'Fadil', 1, -6.2, 106.8)")
    .run(hashPassword('old-password'));
  s.prepare("INSERT INTO users (id, email, password_hash, name) VALUES (7, 'rider@roamr.app', 'h', 'Rider')").run();
  s.prepare("INSERT INTO sessions (token, user_id, expires_at) VALUES ('tok', 1, '2099-01-01T00:00:00.000Z')").run();
  s.prepare(
    `INSERT INTO routes (id, creator_id, activity_type, name, gpx_text, geometry, distance_m, est_duration_s, difficulty,
       start_lat, start_lng, end_lat, end_lng, min_lat, max_lat, min_lng, max_lng)
     VALUES (3, 1, 'road_cycling', 'Sentul loop', '<gpx/>', '[[-6.5,106.8],[-6.6,106.9]]', 42000, 7200, 'moderate',
       -6.5, 106.8, -6.6, 106.9, -6.6, -6.5, 106.8, 106.9)`,
  ).run();
  s.prepare(
    `INSERT INTO activity_plans (id, route_id, creator_id, title, activity_type, starts_at, meeting_point, meeting_lat, meeting_lng)
     VALUES (5, 3, 1, 'Sunday ride', 'road_cycling', '2026-12-01T00:00:00.000Z', 'Gate', -6.5, 106.8)`,
  ).run();
  s.prepare("INSERT INTO activity_participants (activity_id, user_id, status) VALUES (5, 1, 'joined'), (5, 7, 'joined')").run();
  s.prepare("INSERT INTO chat_messages (activity_id, user_id, body) VALUES (5, 7, 'See you there')").run();
  s.prepare("INSERT INTO communities (id, owner_id, name, activity_type) VALUES (2, 1, 'Sentul Riders', 'road_cycling')").run();
  s.prepare("INSERT INTO community_members (community_id, user_id, role) VALUES (2, 1, 'admin')").run();
  s.prepare(
    `INSERT INTO events (id, community_id, created_by, title, activity_type, starts_at, meeting_point, lat, lng)
     VALUES (4, 2, 1, 'Night ride', 'road_cycling', '2026-12-05T12:00:00.000Z', 'Gate', -6.5, 106.8)`,
  ).run();
  s.prepare('INSERT INTO event_participants (event_id, user_id) VALUES (4, 7)').run();
  s.prepare("INSERT INTO notifications (user_id, type, title) VALUES (7, 'activity_join', 'Hi')").run();
  s.close();
  return file;
}

describe('SQLite to Postgres migration', () => {
  test('copies every row, keeps ids and passwords, and new rows continue after the old ids', async () => {
    const db = await testDb();
    const counts = await copySqliteToPostgres(oldSite('full'), db);
    assert.equal(counts.users, 2);
    assert.equal(counts.activity_participants, 2);
    assert.equal(counts.chat_messages, 1);
    assert.equal(counts.events, 1);
    assert.equal((await db.prepare('SELECT name FROM routes WHERE id = 3').get()).name, 'Sentul loop');
    assert.equal((await db.prepare('SELECT lat FROM users WHERE id = 1').get()).lat, -6.2);

    const t = await startTestApp({ db });
    try {
      const login = await t.client().post('/api/auth/login', { email: 'fadil@roamr.app', password: 'old-password' });
      assert.equal(login.status, 200, 'old password hashes still work');
      assert.equal(login.body.user.isAdmin, true);
      const fresh = await t.signup('Newcomer');
      assert.equal(fresh.user.id, 8, 'new accounts get ids after the copied ones');
    } finally {
      await t.close();
    }
  });

  test('columns that old files lack get their defaults', async () => {
    const file = path.join(dir, 'oldest.db');
    const s = new DatabaseSync(file);
    s.exec(OLD_SCHEMA);
    // A file from before organizers and paid events.
    s.exec('DROP TABLE events; DROP TABLE communities;');
    s.exec('CREATE TABLE communities (id INTEGER PRIMARY KEY, owner_id INTEGER, name TEXT, activity_type TEXT)');
    s.exec(`CREATE TABLE events (id INTEGER PRIMARY KEY, community_id INTEGER, created_by INTEGER, title TEXT, activity_type TEXT,
      starts_at TEXT, meeting_point TEXT, lat REAL, lng REAL)`);
    s.prepare("INSERT INTO users (id, email, password_hash, name) VALUES (1, 'a@roamr.app', 'h', 'A')").run();
    s.prepare("INSERT INTO communities VALUES (1, 1, 'Old Club', 'running')").run();
    s.prepare("INSERT INTO events VALUES (1, 1, 1, 'Old Run', 'running', '2026-01-01T00:00:00.000Z', 'Park', -6.2, 106.8)").run();
    s.close();

    const db = await testDb();
    await copySqliteToPostgres(file, db);
    assert.deepEqual({ ...(await db.prepare('SELECT kind, organizer_status FROM communities').get()) }, { kind: 'community', organizer_status: null });
    assert.deepEqual({ ...(await db.prepare('SELECT kind, perks, hidden FROM events').get()) }, { kind: 'community', perks: '[]', hidden: 0 });
    await db.close();
  });

  test('refuses a target that already has users, and leaves it untouched', async () => {
    const db = await testDb();
    await db.prepare("INSERT INTO users (email, password_hash, name) VALUES ('x@roamr.app', 'h', 'X')").run();
    await assert.rejects(copySqliteToPostgres(oldSite('again'), db), /already has users/);
    assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM users').get()).n, 1);
    assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM routes').get()).n, 0);
    await db.close();
  });
});
