import assert from 'node:assert/strict';
import { test } from 'node:test';
import { thumbLine } from '../src/geo.js';
import { seed } from '../src/seed.js';
import { startTestApp } from './helpers.js';

test('thumbLine keeps start and end and caps the point count', () => {
  const line = Array.from({ length: 500 }, (_, i) => [-6.5 + i / 1000, 106.8 + i / 2000, 300 + i]);
  const thumb = thumbLine(line, 48);
  assert.equal(thumb.length, 48);
  assert.deepEqual(thumb[0], [line[0][0], line[0][1]]);
  assert.deepEqual(thumb.at(-1), [line.at(-1)[0], line.at(-1)[1]]);
  assert.equal(thumb[10].length, 2, 'elevation is dropped');
  assert.deepEqual(thumbLine([[1, 2, 3]]), [[1, 2]]);
  assert.deepEqual(thumbLine([]), []);
});

test('home gives the viewer a stats column and a feed of finished outings', async () => {
  const t = await startTestApp();
  try {
    await seed(t.db);
    const kevin = t.client();
    await kevin.post('/api/auth/login', { email: 'kevin@roamr.test', password: 'password123' });
    const home = (await kevin.get('/api/home')).body;

    // Kevin checked in to the seeded Puncak Ride and Car-free Day Run.
    assert.equal(home.me.name, 'Kevin');
    assert.equal(home.me.stats.outings, 2);
    assert.equal(home.me.stats.weekOutings, 2);
    assert.ok(home.me.stats.weekDistanceM > 0);
    assert.equal(home.me.latest.title, 'Car-free Day Run');
    assert.ok(home.me.next, 'Kevin has joined upcoming plans');
    assert.ok(new Date(home.me.next.startsAt) > Date.now() - 3600e3);

    const ride = home.finishedActivities.find((a) => a.title === 'Puncak Ride');
    assert.ok(ride, 'finished public outings appear in the feed');
    assert.equal(ride.finishedCount, 3);
    assert.equal(ride.finishers.length, 3);
    assert.ok(ride.routeLine.length >= 2 && ride.routeLine.length <= 48);
    assert.ok(home.finishedActivities.every((a) => new Date(a.startsAt) < Date.now()));

    assert.ok(home.nearbyActivities.every((a) => Array.isArray(a.routeLine) && a.routeLine.length >= 2));
  } finally {
    await t.close();
  }
});

test('home feed hides private profiles, private plans and anonymous stats', async () => {
  const t = await startTestApp();
  try {
    await seed(t.db);
    const sarah = await t.db.prepare("SELECT id FROM users WHERE email = 'sarah@roamr.test'").get();
    await t.db.prepare("UPDATE users SET privacy = 'private' WHERE id = ?").run(sarah.id);
    const ride = await t.db.prepare("SELECT id FROM activity_plans WHERE title = 'Car-free Day Run' AND status = 'completed'").get();
    await t.db.prepare("UPDATE activity_plans SET visibility = 'private' WHERE id = ?").run(ride.id);

    const guest = t.client();
    const home = (await guest.get('/api/home')).body;
    assert.equal(home.me, null);
    assert.ok(!home.finishedActivities.some((a) => a.id === ride.id), 'private plans stay out of the feed');
    const puncak = home.finishedActivities.find((a) => a.title === 'Puncak Ride');
    assert.equal(puncak.finishedCount, 3);
    assert.equal(puncak.finishers.length, 2, 'private profiles are counted, not named');
    assert.ok(!puncak.finishers.some((u) => u.id === sarah.id));
  } finally {
    await t.close();
  }
});
