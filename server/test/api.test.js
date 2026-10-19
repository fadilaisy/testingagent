import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { seed } from '../src/seed.js';
import { gpxForm, gpxTrack, inHours, startTestApp } from './helpers.js';

const JAKARTA = { locationName: 'Jakarta Selatan', lat: -6.2615, lng: 106.8106 };

async function createRoute(c, fields = {}, gpxOpts = {}) {
  const r = await c.post('/api/routes', gpxForm(gpxTrack(gpxOpts), { activityType: 'road_cycling', name: 'Test Route', ...fields }));
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return r.body.route;
}

async function createActivity(c, routeId, fields = {}) {
  const r = await c.post('/api/activities', {
    routeId,
    startsAt: inHours(24),
    meetingPoint: 'Main gate',
    ...fields,
  });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return r.body.activity;
}

describe('accounts', () => {
  let t;
  before(async () => (t = await startTestApp()));
  after(() => t.close());

  test('register, read profile, log out and log back in', async () => {
    const c = t.client();
    const reg = await c.post('/api/auth/register', { email: 'Kevin@Test.dev', password: 'secret-pass', name: 'Kevin' });
    assert.equal(reg.status, 201);
    assert.equal(reg.body.user.email, 'kevin@test.dev');
    assert.equal(reg.body.user.isAdmin, true, 'first account becomes admin');

    assert.equal((await c.get('/api/me')).body.user.name, 'Kevin');
    await c.post('/api/auth/logout');
    assert.equal((await c.get('/api/me')).body.user, null);

    assert.equal((await c.post('/api/auth/login', { email: 'kevin@test.dev', password: 'wrong-pass' })).status, 401);
    const login = await c.post('/api/auth/login', { email: 'kevin@test.dev', password: 'secret-pass' });
    assert.equal(login.status, 200);
    assert.equal((await c.get('/api/me')).body.user.name, 'Kevin');
  });

  test('rejects duplicate emails and weak passwords', async () => {
    const c = t.client();
    assert.equal((await c.post('/api/auth/register', { email: 'kevin@test.dev', password: 'secret-pass', name: 'K' })).status, 409);
    const weak = await c.post('/api/auth/register', { email: 'new@test.dev', password: 'short', name: 'N' });
    assert.equal(weak.status, 400);
    assert.equal(weak.body.field, 'Password');
  });

  test('updates profile, activities and notification settings', async () => {
    const c = await t.signup('Budi');
    const r = await c.patch('/api/me', {
      ...JAKARTA,
      lat: -6.261537,
      activities: ['road_cycling', 'running'],
      experience: 'advanced',
      notifySettings: { nearby_event: false, nearby_radius_km: 10 },
      onboarded: true,
    });
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.user.activities, ['road_cycling', 'running']);
    assert.equal(r.body.user.lat, -6.26, 'home location is stored coarsely');
    assert.equal(r.body.user.notifySettings.nearby_event, false);
    assert.equal(r.body.user.notifySettings.nearby_radius_km, 10);
    assert.equal((await c.patch('/api/me', { activities: ['skydiving'] })).status, 400);
  });

  test('password reset flow', async () => {
    const c = await t.signup('Resetter');
    const forgot = await t.client().post('/api/auth/forgot', { email: c.email });
    const token = new URL(forgot.body.devResetLink, 'http://x').searchParams.get('token');
    const anon = t.client();
    assert.equal((await anon.post('/api/auth/reset', { token, password: 'brand-new-pass' })).status, 200);
    assert.equal((await anon.post('/api/auth/reset', { token, password: 'again-new-pass' })).status, 400, 'token is single use');
    assert.equal((await t.client().post('/api/auth/login', { email: c.email, password: 'brand-new-pass' })).status, 200);
  });

  test('private profiles hide details from others', async () => {
    const c = await t.signup('Private', { privacy: 'private', bio: 'secret bio' });
    const other = await t.signup('Other');
    const seen = await other.get(`/api/users/${c.user.id}`);
    assert.equal(seen.body.user.private, true);
    assert.equal(seen.body.user.bio, undefined);
    assert.equal((await c.get(`/api/users/${c.user.id}`)).body.user.bio, 'secret bio');
  });
});

describe('routes and GPX', () => {
  let t;
  let owner;
  before(async () => {
    t = await startTestApp();
    owner = await t.signup('Owner');
  });
  after(() => t.close());

  test('upload requires login', async () => {
    const r = await t.client().post('/api/routes', gpxForm(gpxTrack(), { activityType: 'road_cycling' }));
    assert.equal(r.status, 401);
  });

  test('preview parses stats without saving', async () => {
    const r = await owner.post('/api/routes/preview', gpxForm(gpxTrack({ points: 30 })));
    assert.equal(r.status, 200);
    assert.ok(r.body.stats.distanceM > 7000);
    assert.equal(r.body.stats.elevationGain, 145);
    assert.equal((await owner.get('/api/routes')).body.total, 0);
  });

  test('upload creates a route page with stats, geometry and estimate', async () => {
    const route = await createRoute(owner, { name: 'BSD Sprint', locationName: 'BSD' });
    const r = await t.client().get(`/api/routes/${route.id}`);
    assert.equal(r.status, 200);
    assert.equal(r.body.route.name, 'BSD Sprint');
    assert.equal(r.body.route.elevationGain, 295);
    assert.ok(r.body.route.geometry.length > 10);
    assert.ok(r.body.route.estDurationS > 0);
    assert.ok(['easy', 'moderate', 'hard', 'extreme'].includes(r.body.route.difficulty));
  });

  test('rejects invalid GPX with a field error', async () => {
    const r = await owner.post('/api/routes', gpxForm('not a gpx', { activityType: 'road_cycling', name: 'x' }));
    assert.equal(r.status, 400);
    assert.equal(r.body.field, 'GPX file');
  });

  test('privacy zone trims the published start but keeps full-route stats', async () => {
    const plain = await createRoute(owner, { name: 'Plain' }, { start: [-6.5, 106.5] });
    const trimmed = await createRoute(owner, { name: 'Trimmed', privacyTrim: 500 }, { start: [-6.5, 106.5] });
    assert.equal(plain.distanceM, trimmed.distanceM);
    assert.deepEqual(plain.start, [-6.5, 106.5]);
    assert.notDeepEqual(trimmed.start, plain.start);
    // Others download the trimmed geometry; the owner gets the original file.
    const publicGpx = await (await t.client().get(`/api/routes/${trimmed.id}/gpx`, { raw: true })).text();
    assert.ok(!publicGpx.includes('lat="-6.500000"'));
    const ownerGpx = await (await owner.get(`/api/routes/${trimmed.id}/gpx`, { raw: true })).text();
    assert.ok(ownerGpx.includes('lat="-6.500000"'));
  });

  test('discovery filters by activity, distance, difficulty, text and location', async () => {
    const other = await t.signup('Runner');
    await createRoute(other, { name: 'Senayan Run', activityType: 'running' }, { start: [-6.2185, 106.8022], points: 20, stepDeg: 0.0005, climbPerPoint: 0 });
    const running = await t.client().get('/api/routes?activity=running');
    assert.deepEqual(running.body.routes.map((r) => r.name), ['Senayan Run']);
    const near = await t.client().get('/api/routes?lat=-6.22&lng=106.80&radiusKm=5&sort=nearby');
    assert.deepEqual(near.body.routes.map((r) => r.name), ['Senayan Run']);
    assert.ok(near.body.routes[0].distanceFromYouM < 1000);
    assert.equal((await t.client().get('/api/routes?q=sprint')).body.routes[0].name, 'BSD Sprint');
    assert.equal((await t.client().get('/api/routes?minKm=100')).body.total, 0);
    assert.equal((await t.client().get('/api/routes?difficulty=bogus')).status, 400);
  });

  test('weather and places endpoints respond (with local fallback for places)', async () => {
    const route = await createRoute(owner, { name: 'Weather Route' });
    const w = await t.client().get(`/api/routes/${route.id}/weather?startsAt=${encodeURIComponent(inHours(5))}`);
    assert.equal(w.status, 200);
    assert.equal(w.body.points[0].name, 'Start');
    t.db.prepare("INSERT INTO places (name, category, lat, lng) VALUES ('Finish Coffee', 'coffee', ?, ?)").run(route.end[0], route.end[1] + 0.001);
    const p = await t.client().get(`/api/routes/${route.id}/places`);
    assert.equal(p.body.source, 'local');
    assert.equal(p.body.places[0].name, 'Finish Coffee');
    assert.ok(p.body.places[0].distanceM < 200);
  });

  test('only the creator can delete a route', async () => {
    const route = await createRoute(owner, { name: 'Disposable' });
    const other = await t.signup('Stranger');
    assert.equal((await other.del(`/api/routes/${route.id}`)).status, 403);
    assert.equal((await owner.del(`/api/routes/${route.id}`)).status, 200);
    assert.equal((await owner.get(`/api/routes/${route.id}`)).status, 404);
  });
});

describe('activities, chat, conditions and check-in', () => {
  let t;
  let host;
  let rider;
  let route;
  before(async () => {
    t = await startTestApp({ demoMode: false });
    host = await t.signup('Host');
    rider = await t.signup('Rider');
    route = await createRoute(host, { name: 'Group Route' });
  });
  after(() => t.close());

  test('create, list and join an activity; the group chat opens on join', async () => {
    const a = await createActivity(host, route.id, { title: 'Sunday Ride', participantLimit: 3, pace: '25 km/h' });
    assert.equal(a.participantCount, 1);
    assert.deepEqual(a.meeting, route.start, 'meeting point defaults to route start');

    const list = await t.client().get(`/api/activities?routeId=${route.id}`);
    assert.equal(list.body.activities[0].title, 'Sunday Ride');

    assert.equal((await rider.get(`/api/activities/${a.id}/messages`)).status, 403, 'chat is members-only');
    const join = await rider.post(`/api/activities/${a.id}/join`);
    assert.equal(join.status, 200);
    assert.equal(join.body.activity.myStatus, 'joined');

    const msgs = await rider.get(`/api/activities/${a.id}/messages`);
    assert.deepEqual(msgs.body.messages.map((m) => m.body), ['Host created this activity', 'Rider joined']);
    const sent = await rider.post(`/api/activities/${a.id}/messages`, { body: 'See you at 05:45' });
    assert.equal(sent.status, 201);

    const notes = await host.get('/api/notifications');
    assert.ok(notes.body.notifications.some((n) => n.title === 'Rider joined Sunday Ride'));
  });

  test('participant limit is enforced', async () => {
    const a = await createActivity(host, route.id, { participantLimit: 2 });
    assert.equal((await rider.post(`/api/activities/${a.id}/join`)).status, 200);
    const third = await t.signup('Third');
    const r = await third.post(`/api/activities/${a.id}/join`);
    assert.equal(r.status, 409);
    assert.match(r.body.error, /full/);
  });

  test('private activities need host approval', async () => {
    const a = await createActivity(host, route.id, { visibility: 'private' });
    assert.equal((await t.client().get('/api/activities')).body.activities.some((x) => x.id === a.id), false, 'not listed publicly');
    const req = await rider.post(`/api/activities/${a.id}/join`);
    assert.equal(req.body.activity.myStatus, 'requested');
    assert.equal((await rider.get(`/api/activities/${a.id}/messages`)).status, 403);
    const hostView = await host.get(`/api/activities/${a.id}`);
    assert.equal(hostView.body.requests[0].name, 'Rider');
    await host.post(`/api/activities/${a.id}/requests/${rider.user.id}/approve`);
    assert.equal((await rider.get(`/api/activities/${a.id}/messages`)).status, 200);
  });

  test('track reports appear on the route, post to chat, warn on repeats and notify riders', async () => {
    const a = await createActivity(host, route.id, { startsAt: inHours(20) });
    await rider.post(`/api/activities/${a.id}/join`);
    const r1 = await rider.post(`/api/routes/${route.id}/conditions`, {
      category: 'traffic', value: 'heavy', km: 3, description: 'Jam at the market', activityId: a.id,
    });
    assert.equal(r1.status, 201);
    assert.equal(r1.body.report.severity, 2);

    const chat = await host.get(`/api/activities/${a.id}/messages`);
    assert.equal(chat.body.messages.at(-1).kind, 'condition');

    const hostNotes = await host.get('/api/notifications');
    assert.ok(hostNotes.body.notifications.some((n) => n.type === 'track_update'));

    let cond = await t.client().get(`/api/routes/${route.id}/conditions`);
    assert.equal(cond.body.conditions.latest.traffic.value, 'heavy');
    assert.equal(cond.body.conditions.warnings.length, 0, 'one report is not a warning yet');

    await host.post(`/api/routes/${route.id}/conditions`, { category: 'traffic', value: 'heavy', km: 4 });
    cond = await t.client().get(`/api/routes/${route.id}/conditions`);
    assert.equal(cond.body.conditions.warnings.length, 1);
    assert.match(cond.body.conditions.warnings[0].message, /2 people reported heavy/);

    const bad = await rider.post(`/api/routes/${route.id}/conditions`, { category: 'traffic', value: 'flooded' });
    assert.equal(bad.status, 400);
  });

  test('check-in is limited to the time window and the geofence', async () => {
    const later = await createActivity(host, route.id, { startsAt: inHours(5) });
    const early = await host.post(`/api/activities/${later.id}/checkin`, { lat: route.start[0], lng: route.start[1] });
    assert.equal(early.status, 409);
    assert.match(early.body.error, /opens 2 hours before/);

    const soon = await createActivity(host, route.id, { startsAt: inHours(1) });
    const far = await host.post(`/api/activities/${soon.id}/checkin`, { lat: -6.9, lng: 107.6 });
    assert.equal(far.status, 409);
    assert.ok(far.body.distanceM > 10000);

    const ok = await host.post(`/api/activities/${soon.id}/checkin`, { lat: route.start[0] + 0.001, lng: route.start[1] });
    assert.equal(ok.status, 200);
    assert.ok(ok.body.checkedInAt);
    const again = await host.post(`/api/activities/${soon.id}/checkin`, { lat: route.start[0], lng: route.start[1] });
    assert.equal(again.body.alreadyCheckedIn, true);

    const profile = await t.client().get(`/api/users/${host.user.id}`);
    assert.equal(profile.body.history.length, 1);
  });

  test('SOS alerts the group and returns the emergency contact', async () => {
    await rider.patch('/api/me', { emergencyName: 'Mum', emergencyPhone: '+62 811 111' });
    const a = await createActivity(host, route.id);
    await rider.post(`/api/activities/${a.id}/join`);
    const sos = await rider.post(`/api/activities/${a.id}/sos`, { lat: -6.3, lng: 106.65 });
    assert.equal(sos.status, 200);
    assert.deepEqual(sos.body.emergencyContact, { name: 'Mum', phone: '+62 811 111' });
    const notes = await host.get('/api/notifications');
    assert.equal(notes.body.notifications[0].type, 'sos');
  });

  test('cancelling notifies members and blocks new joins', async () => {
    const a = await createActivity(host, route.id);
    await rider.post(`/api/activities/${a.id}/join`);
    assert.equal((await rider.patch(`/api/activities/${a.id}`, { status: 'cancelled' })).status, 403);
    assert.equal((await host.patch(`/api/activities/${a.id}`, { status: 'cancelled' })).status, 200);
    const notes = await rider.get('/api/notifications');
    assert.ok(notes.body.notifications.some((n) => n.title.endsWith('was cancelled')));
    const late = await t.signup('Late');
    assert.equal((await late.post(`/api/activities/${a.id}/join`)).status, 409);
  });

  test('chat messages are pushed live over the event stream', async () => {
    const a = await createActivity(host, route.id);
    await rider.post(`/api/activities/${a.id}/join`);
    const stream = await rider.get('/api/stream', { raw: true });
    assert.equal(stream.headers.get('content-type'), 'text/event-stream');
    const reader = stream.body.getReader();
    await host.post(`/api/activities/${a.id}/messages`, { body: 'Live hello' });
    let text = '';
    const decoder = new TextDecoder();
    while (!text.includes('Live hello')) {
      const { value, done } = await reader.read();
      if (done) break;
      text += decoder.decode(value);
    }
    await reader.cancel();
    assert.match(text, /event: chat/);
    assert.match(text, /Live hello/);
  });
});

describe('communities, events and nearby notifications', () => {
  let t;
  let leader;
  before(async () => {
    t = await startTestApp();
    leader = await t.signup('Leader', { ...JAKARTA, activities: ['road_cycling'] });
  });
  after(() => t.close());

  test('creating a community requires premium', async () => {
    const denied = await leader.post('/api/communities', { name: 'Jakarta Riders', activityType: 'road_cycling' });
    assert.equal(denied.status, 402);
    assert.equal(denied.body.premiumRequired, true);
    const up = await leader.post('/api/me/premium');
    assert.equal(up.body.user.isPremium, true);
    const ok = await leader.post('/api/communities', { name: 'Jakarta Riders', activityType: 'road_cycling', ...JAKARTA });
    assert.equal(ok.status, 201);
    assert.equal(ok.body.community.myRole, 'admin');
  });

  test('events notify members and matching users nearby, with a frequency limit', async () => {
    const community = (await leader.get('/api/communities?mine=1')).body.communities[0];
    const member = await t.signup('Member', { ...JAKARTA, activities: ['road_cycling'] });
    await member.post(`/api/communities/${community.id}/join`);

    const nearbyCyclist = await t.signup('NearCyclist', { lat: -6.25, lng: 106.82, activities: ['road_cycling'] });
    const nearbyRunner = await t.signup('NearRunner', { lat: -6.25, lng: 106.82, activities: ['running'] });
    const farCyclist = await t.signup('FarCyclist', { lat: -6.9175, lng: 107.6191, activities: ['road_cycling'] });
    const optedOut = await t.signup('OptedOut', { lat: -6.25, lng: 106.82, activities: ['road_cycling'], notifySettings: { nearby_event: false } });

    const create = (title, startH) =>
      leader.post('/api/events', {
        communityId: community.id, title, startsAt: inHours(startH), meetingPoint: 'GBK', lat: -6.2185, lng: 106.8022,
        notificationRadiusKm: 25,
      });
    const e1 = await create('Sunrise Ride', 48);
    assert.equal(e1.status, 201, JSON.stringify(e1.body));
    assert.equal(e1.body.notifiedNearby, 1);
    assert.equal(e1.body.notifiedMembers, 1);

    const titles = async (c) => (await c.get('/api/notifications')).body.notifications.map((n) => n.type);
    assert.deepEqual(await titles(nearbyCyclist), ['nearby_event']);
    assert.deepEqual(await titles(nearbyRunner), []);
    assert.deepEqual(await titles(farCyclist), []);
    assert.deepEqual(await titles(optedOut), []);
    assert.deepEqual(await titles(member), ['community'], 'members get the community notice, not a nearby one');

    const e2 = await create('Second Ride', 72);
    assert.equal(e2.body.notifiedNearby, 0, 'daily limit stops a second nearby notification');
  });

  test('registration respects capacity, discovery filters by distance', async () => {
    const community = (await leader.get('/api/communities?mine=1')).body.communities[0];
    const e = await leader.post('/api/events', {
      communityId: community.id, title: 'Small Group', startsAt: inHours(30), meetingPoint: 'GBK', lat: -6.2185, lng: 106.8022, maxParticipants: 2,
    });
    const a = await t.signup('A');
    const b = await t.signup('B');
    assert.equal((await a.post(`/api/events/${e.body.event.id}/register`)).status, 200);
    assert.equal((await b.post(`/api/events/${e.body.event.id}/register`)).status, 409);
    const near = await t.client().get('/api/events?lat=-6.22&lng=106.80&radiusKm=10');
    assert.ok(near.body.events.length >= 1);
    const far = await t.client().get('/api/events?lat=-7.79&lng=110.36&radiusKm=10');
    assert.equal(far.body.events.length, 0);
  });

  test('non-premium communities lose nearby notifications and unlimited events', async () => {
    const community = (await leader.get('/api/communities?mine=1')).body.communities[0];
    await leader.del('/api/me/premium');
    const r = await leader.post('/api/events', {
      communityId: community.id, title: 'Free', startsAt: inHours(50), meetingPoint: 'GBK', lat: -6.2, lng: 106.8, notificationRadiusKm: 10,
    });
    assert.equal(r.status, 402);
    // The community already has 3 upcoming events, above the free limit.
    const r2 = await leader.post('/api/events', { communityId: community.id, title: 'Free', startsAt: inHours(50), meetingPoint: 'GBK', lat: -6.2, lng: 106.8 });
    assert.equal(r2.status, 402);
  });

  test('private communities hold join requests for an admin', async () => {
    await leader.post('/api/me/premium');
    const c = await leader.post('/api/communities', { name: 'Secret Trail Club', activityType: 'trail_running', privacy: 'private' });
    const runner = await t.signup('TrailRunner');
    assert.equal((await runner.post(`/api/communities/${c.body.community.id}/join`)).body.status, 'requested');
    const view = await leader.get(`/api/communities/${c.body.community.id}`);
    assert.equal(view.body.requests[0].name, 'TrailRunner');
    await leader.post(`/api/communities/${c.body.community.id}/members/${runner.user.id}/approve`);
    const after = await runner.get(`/api/communities/${c.body.community.id}`);
    assert.equal(after.body.community.myStatus, 'member');
  });
});

describe('search, reports and moderation', () => {
  let t;
  let admin;
  before(async () => {
    t = await startTestApp();
    admin = await t.signup('Admin');
  });
  after(() => t.close());

  test('global search covers routes, users and places', async () => {
    const u = await t.signup('Puncak Lover');
    await createRoute(u, { name: 'Puncak Climb' });
    t.db.prepare("INSERT INTO places (name, category, lat, lng) VALUES ('Kopi Puncak', 'coffee', -6.7, 106.99)").run();
    const r = await t.client().get('/api/search?q=puncak');
    assert.equal(r.body.routes[0].name, 'Puncak Climb');
    assert.equal(r.body.users[0].name, 'Puncak Lover');
    assert.equal(r.body.places[0].name, 'Kopi Puncak');
  });

  test('reported content can be removed by an admin', async () => {
    const u = await t.signup('Spammer');
    const route = await createRoute(u, { name: 'Spam Route' });
    const reporter = await t.signup('Reporter');
    assert.equal((await reporter.post('/api/reports', { targetType: 'route', targetId: route.id, reason: 'spam' })).status, 201);
    assert.equal((await reporter.get('/api/admin/reports')).status, 403);

    const list = await admin.get('/api/admin/reports');
    assert.equal(list.body.reports[0].target.label, 'Spam Route');
    await admin.post(`/api/admin/reports/${list.body.reports[0].id}`, { action: 'remove' });
    assert.equal((await reporter.get(`/api/routes/${route.id}`)).status, 404);
    assert.equal((await admin.get('/api/admin/reports')).body.reports.length, 0);
    const overview = await admin.get('/api/admin/overview');
    assert.equal(overview.status, 200);
    assert.ok(overview.body.users >= 3);
  });
});

test('demo seed produces a working home feed and a usable demo login', async () => {
  const t = await startTestApp();
  try {
    seed(t.db);
    const kevin = t.client();
    assert.equal((await kevin.post('/api/auth/login', { email: 'kevin@jalur.test', password: 'password123' })).status, 200);
    const home = await kevin.get('/api/home');
    assert.ok(home.body.nearbyActivities.length >= 3);
    assert.ok(home.body.popularRoutes.length >= 3);
    assert.ok(home.body.upcomingEvents.length >= 1);
    assert.ok(home.body.recentConditions.length >= 1);
    const puncak = (await kevin.get('/api/routes?q=Puncak')).body.routes[0];
    const detail = await kevin.get(`/api/routes/${puncak.id}`);
    assert.equal(detail.body.conditions.warnings.length, 1, 'seeded heavy-traffic reports trigger a warning');
  } finally {
    await t.close();
  }
});
