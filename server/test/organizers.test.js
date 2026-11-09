import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { migrate, openDb } from '../src/db.js';
import { inHours, startTestApp } from './helpers.js';

const JAKARTA = { locationName: 'Jakarta Selatan', lat: -6.2615, lng: 106.8106 };

const paidEvent = (communityId, extra = {}) => ({
  communityId, kind: 'paid', title: 'Sentul 5K', startsAt: inHours(72), meetingPoint: 'Sentul Circuit', lat: -6.54, lng: 106.86,
  priceIdr: 150000, paymentEmail: 'bayar@race.id', paymentInstructions: 'BCA 123 a/n Race', ...extra,
});

describe('organizer profiles and paid events', () => {
  let t;
  let admin;
  let organizer;
  let clubLeader;
  let org;
  let club;
  before(async () => {
    t = await startTestApp({ demoMode: false });
    admin = await t.signup('Site Admin');
    organizer = await t.signup('Race Director', JAKARTA);
    clubLeader = await t.signup('Club Leader', JAKARTA);
    await organizer.post('/api/me/premium');
    await clubLeader.post('/api/me/premium');
    org = (await organizer.post('/api/communities', { name: 'Sentul Run Series', activityType: 'running', kind: 'organizer', ...JAKARTA })).body
      .community;
    club = (await clubLeader.post('/api/communities', { name: 'Jaksel Runners', activityType: 'running', ...JAKARTA })).body.community;
  });
  after(() => t.close());

  test('a new organizer starts pending and the site admins hear about it', async () => {
    assert.equal(org.kind, 'organizer');
    assert.equal(org.organizerStatus, 'pending');
    assert.equal(org.verifiedOrganizer, false);
    assert.equal(club.kind, 'community');
    assert.equal(club.organizerStatus, null);
    const notes = (await admin.get('/api/notifications')).body.notifications;
    assert.ok(notes.some((n) => n.title === 'Sentul Run Series wants to sell paid events'));
    const orgs = (await t.client().get('/api/communities?kind=organizer')).body.communities;
    assert.deepEqual(orgs.map((c) => c.id), [org.id]);
  });

  test('communities and unapproved organizers cannot sell paid events, but can run free ones', async () => {
    const fromClub = await clubLeader.post('/api/events', paidEvent(club.id));
    assert.equal(fromClub.status, 403);
    assert.equal(fromClub.body.field, 'Event type');
    assert.equal((await organizer.post('/api/events', paidEvent(org.id))).status, 403);
    const free = await clubLeader.post('/api/events', { ...paidEvent(club.id), kind: 'community', title: 'Easy 5K' });
    assert.equal(free.status, 201, JSON.stringify(free.body));
  });

  test('only site admins review organizers, and the owner is told the outcome', async () => {
    assert.equal((await organizer.get('/api/admin/organizers')).status, 403);
    assert.equal((await organizer.post(`/api/admin/organizers/${org.id}`, { action: 'approve' })).status, 403);
    const pending = await admin.get('/api/admin/organizers');
    assert.deepEqual(pending.body.organizers.map((o) => o.id), [org.id]);
    assert.equal((await admin.get('/api/admin/overview')).body.pendingOrganizers, 1);
    assert.equal((await admin.post(`/api/admin/organizers/${club.id}`, { action: 'approve' })).status, 404, 'plain communities are not organizers');

    const ok = await admin.post(`/api/admin/organizers/${org.id}`, { action: 'approve' });
    assert.equal(ok.body.status, 'approved');
    assert.equal((await admin.get('/api/admin/organizers')).body.organizers.length, 0);
    const notes = (await organizer.get('/api/notifications')).body.notifications;
    assert.ok(notes.some((n) => n.title === 'Sentul Run Series is a verified organizer'));
    assert.equal((await t.client().get(`/api/communities/${org.id}`)).body.community.verifiedOrganizer, true);
  });

  test('a verified organizer sells paid events that list what participants get', async () => {
    const perks = 'Finisher medal\n Race jersey \n\nFinisher medal\nRefreshments';
    const created = await organizer.post('/api/events', paidEvent(org.id, { perks }));
    assert.equal(created.status, 201, JSON.stringify(created.body));
    assert.deepEqual(created.body.event.perks, ['Finisher medal', 'Race jersey', 'Refreshments']);
    assert.equal(created.body.event.community.verifiedOrganizer, true);
    const view = await t.client().get(`/api/events/${created.body.event.id}`);
    assert.deepEqual(view.body.event.perks, ['Finisher medal', 'Race jersey', 'Refreshments']);

    const asArray = await organizer.post('/api/events', paidEvent(org.id, { perks: ['Medal', 'Shirt'] }));
    assert.deepEqual(asArray.body.event.perks, ['Medal', 'Shirt']);
    const tooMany = await organizer.post('/api/events', paidEvent(org.id, { perks: Array.from({ length: 11 }, (_, i) => `Perk ${i}`) }));
    assert.equal(tooMany.status, 400);
    const tooLong = await organizer.post('/api/events', paidEvent(org.id, { perks: ['x'.repeat(61)] }));
    assert.equal(tooLong.status, 400);
  });

  test('a rejected organizer cannot sell paid events', async () => {
    const other = (await organizer.post('/api/communities', { name: 'Shady Races', activityType: 'running', kind: 'organizer', ...JAKARTA }))
      .body.community;
    await admin.post(`/api/admin/organizers/${other.id}`, { action: 'reject' });
    assert.equal((await organizer.post('/api/events', paidEvent(other.id))).status, 403);
    const rejected = await admin.get('/api/admin/organizers?status=rejected');
    assert.deepEqual(rejected.body.organizers.map((o) => o.id), [other.id]);
  });
});

test('older databases get the organizer and perks columns', () => {
  const db = openDb(':memory:');
  db.exec('PRAGMA foreign_keys = OFF; DROP TABLE communities; DROP TABLE events;');
  db.exec('CREATE TABLE communities (id INTEGER PRIMARY KEY, name TEXT); CREATE TABLE events (id INTEGER PRIMARY KEY, title TEXT);');
  db.exec("INSERT INTO communities (name) VALUES ('Old Club'); INSERT INTO events (title) VALUES ('Old Ride');");
  migrate(db);
  assert.deepEqual({ ...db.prepare('SELECT kind, organizer_status FROM communities').get() }, { kind: 'community', organizer_status: null });
  assert.equal(db.prepare('SELECT perks FROM events').get().perks, '[]');
  db.close();
});
