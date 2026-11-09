import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { loadConfig } from '../src/config.js';
import { migrate, openDb } from '../src/db.js';
import { createMidtrans, mapMidtransStatus, midtransSignature } from '../src/payments.js';
import { inHours, startTestApp } from './helpers.js';

const SERVER_KEY = 'SB-Mid-server-test-key';
const JAKARTA = { locationName: 'Jakarta Selatan', lat: -6.2615, lng: 106.8106 };

// A stand-in for the Midtrans API, driven through the real client so the
// request format and auth header are tested too.
function fakeMidtransApi() {
  const orders = new Map();
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url, init });
    const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
    if (init.headers?.authorization !== `Basic ${Buffer.from(`${SERVER_KEY}:`).toString('base64')}`) return json(401, {});
    if (url.endsWith('/snap/v1/transactions')) {
      const body = JSON.parse(init.body);
      if (api.failNext) {
        api.failNext = false;
        return json(500, { error_messages: ['boom'] });
      }
      orders.set(body.transaction_details.order_id, { request: body, status: null });
      return json(201, { token: 'tok', redirect_url: `https://app.sandbox.midtrans.com/snap/v4/redirection/${body.transaction_details.order_id}` });
    }
    const m = url.match(/\/v2\/([^/]+)\/status$/);
    if (m) {
      const order = orders.get(decodeURIComponent(m[1]));
      if (!order?.status) return json(404, { status_code: '404' });
      return json(200, order.status);
    }
    return json(404, {});
  };
  const api = { orders, calls, fetchImpl, failNext: false };
  return api;
}

function notification(orderId, amount, transactionStatus, extra = {}) {
  const statusCode = transactionStatus === 'settlement' || transactionStatus === 'capture' ? '200' : '201';
  const grossAmount = `${amount}.00`;
  return {
    order_id: orderId,
    status_code: statusCode,
    gross_amount: grossAmount,
    transaction_status: transactionStatus,
    transaction_id: `trx-${orderId}`,
    signature_key: midtransSignature({ orderId, statusCode, grossAmount, serverKey: SERVER_KEY }),
    ...extra,
  };
}

async function setupCommunity(t, name) {
  const leader = await t.signup(`${name} Leader`, JAKARTA);
  await leader.post('/api/me/premium');
  const c = await leader.post('/api/communities', { name: `${name} Club`, activityType: 'road_cycling', kind: 'organizer', ...JAKARTA });
  t.db.prepare("UPDATE communities SET organizer_status = 'approved' WHERE id = ?").run(c.body.community.id);
  return { leader, community: c.body.community };
}

const eventBody = (communityId, extra = {}) => ({
  communityId, title: 'Gran Fondo Sentul', startsAt: inHours(72), meetingPoint: 'Sentul Circuit', lat: -6.54, lng: 106.86, ...extra,
});

describe('payment helpers', () => {
  test('Midtrans statuses map to ours', () => {
    assert.equal(mapMidtransStatus('settlement'), 'paid');
    assert.equal(mapMidtransStatus('capture', 'accept'), 'paid');
    assert.equal(mapMidtransStatus('capture', 'challenge'), 'pending');
    assert.equal(mapMidtransStatus('capture', 'deny'), 'failed');
    assert.equal(mapMidtransStatus('pending'), 'pending');
    for (const s of ['deny', 'cancel', 'expire', 'failure']) assert.equal(mapMidtransStatus(s), 'failed');
    assert.equal(mapMidtransStatus('refund'), 'refunded');
  });

  test('notification signatures are verified', () => {
    const mt = createMidtrans({ serverKey: SERVER_KEY, fetchImpl: async () => new Response('{}') });
    const n = notification('RMR-1', 150000, 'settlement');
    assert.equal(mt.verifyNotification(n), true);
    assert.equal(mt.verifyNotification({ ...n, gross_amount: '1.00' }), false);
    assert.equal(mt.verifyNotification({ ...n, signature_key: 'x' }), false);
    assert.equal(mt.verifyNotification({}), false);
    assert.equal(createMidtrans({}), null, 'no key, no gateway');
  });

  test('config reads Midtrans settings and refuses a sandbox key in production mode', () => {
    assert.equal(loadConfig({}).midtrans, null);
    const cfg = loadConfig({ MIDTRANS_SERVER_KEY: SERVER_KEY, PUBLIC_URL: 'https://roamr.id/' });
    assert.deepEqual(cfg.midtrans, { serverKey: SERVER_KEY, production: false });
    assert.equal(cfg.publicUrl, 'https://roamr.id');
    assert.throws(() => loadConfig({ MIDTRANS_SERVER_KEY: SERVER_KEY, MIDTRANS_PRODUCTION: '1' }), /production server key/);
    assert.throws(
      () => loadConfig({ NODE_ENV: 'production', DATABASE_FILE: '/data/r.db', MIDTRANS_SERVER_KEY: SERVER_KEY }),
      /PUBLIC_URL/,
    );
  });

  test('older databases get the new event columns', () => {
    const db = openDb(':memory:');
    db.exec('DROP TABLE event_payments; DROP TABLE event_participants; DROP TABLE events;');
    db.exec(`CREATE TABLE events (id INTEGER PRIMARY KEY, title TEXT);
             CREATE TABLE event_participants (event_id INTEGER, user_id INTEGER);`);
    migrate(db);
    const cols = db.prepare('PRAGMA table_info(events)').all().map((c) => c.name);
    assert.ok(['kind', 'price_idr', 'payment_method', 'payment_email', 'payment_instructions'].every((c) => cols.includes(c)));
    assert.ok(db.prepare('PRAGMA table_info(event_participants)').all().some((c) => c.name === 'status'));
    migrate(db); // running twice is harmless
    db.close();
  });
});

describe('community and paid events', () => {
  let t;
  let leader;
  let community;
  before(async () => {
    t = await startTestApp();
    ({ leader, community } = await setupCommunity(t, 'Manual'));
  });
  after(() => t.close());

  test('events default to free community events and can be filtered by type', async () => {
    const free = await leader.post('/api/events', eventBody(community.id, { title: 'Free Ride' }));
    assert.equal(free.status, 201, JSON.stringify(free.body));
    assert.equal(free.body.event.kind, 'community');
    assert.equal(free.body.event.priceIdr, null);
    const meta = await t.client().get('/api/meta');
    assert.deepEqual(meta.body.eventKinds, ['community', 'paid']);
    assert.equal(meta.body.payments.gateway, null);
  });

  test('paid events validate price and payment details', async () => {
    const noPrice = await leader.post('/api/events', eventBody(community.id, { kind: 'paid' }));
    assert.equal(noPrice.status, 400);
    assert.equal(noPrice.body.field, 'Price');
    const cheap = await leader.post('/api/events', eventBody(community.id, { kind: 'paid', priceIdr: 500 }));
    assert.equal(cheap.body.field, 'Price');
    const noEmail = await leader.post('/api/events', eventBody(community.id, { kind: 'paid', priceIdr: 150000 }));
    assert.equal(noEmail.body.field, 'Payment email', 'without a gateway the method falls back to manual, which needs an email');
    const gateway = await leader.post('/api/events', eventBody(community.id, { kind: 'paid', priceIdr: 150000, paymentMethod: 'gateway' }));
    assert.equal(gateway.status, 400);
    assert.equal(gateway.body.field, 'Payment method');
    const badEmail = await leader.post('/api/events', eventBody(community.id, { kind: 'paid', priceIdr: 150000, paymentEmail: 'nope' }));
    assert.equal(badEmail.body.field, 'Payment email');
  });

  test('manual payment: participant reserves a spot, organizer confirms', async () => {
    const created = await leader.post('/api/events', eventBody(community.id, {
      kind: 'paid', priceIdr: 150000, paymentEmail: 'Bayar@Club.id', paymentInstructions: 'BCA 123456 a/n Club', maxParticipants: 3,
    }));
    assert.equal(created.status, 201, JSON.stringify(created.body));
    const id = created.body.event.id;
    assert.equal(created.body.event.kind, 'paid');
    assert.equal(created.body.event.paymentMethod, 'manual');

    const paid = await t.client().get('/api/events?kind=paid');
    assert.deepEqual(paid.body.events.map((e) => e.id), [id]);

    const rider = await t.signup('Rider');
    const reg = await rider.post(`/api/events/${id}/register`, {});
    assert.equal(reg.status, 200, JSON.stringify(reg.body));
    assert.equal(reg.body.payment.status, 'pending');
    assert.equal(reg.body.payment.amountIdr, 150000);
    assert.equal(reg.body.payment.paymentEmail, 'bayar@club.id');
    assert.equal(reg.body.payment.paymentInstructions, 'BCA 123456 a/n Club');
    assert.equal(reg.body.event.myRegistration, 'pending');
    assert.equal(reg.body.event.registered, false);
    assert.equal(reg.body.event.spotsTaken, 2, 'organizer + pending rider');
    assert.equal(reg.body.event.participantCount, 1, 'only confirmed people count as coming');

    const again = await rider.post(`/api/events/${id}/register`, {});
    assert.equal(again.body.payment.id, reg.body.payment.id, 'registering twice reuses the pending payment');

    const sent = await rider.post(`/api/events/${id}/payment/sent`, { note: 'Transfer BCA a/n Rider 10:15' });
    assert.equal(sent.body.payment.payerNote, 'Transfer BCA a/n Rider 10:15');
    const leaderNotes = (await leader.get('/api/notifications')).body.notifications.map((n) => n.title);
    assert.ok(leaderNotes.some((n) => /says they paid/.test(n)));

    const stranger = await t.signup('Stranger');
    assert.equal((await stranger.get(`/api/events/${id}/payments`)).status, 403);
    assert.equal((await stranger.post(`/api/events/${id}/payments/${reg.body.payment.id}/confirm`)).status, 403);

    const list = await leader.get(`/api/events/${id}/payments`);
    assert.equal(list.body.payments.length, 1);
    assert.equal(list.body.payments[0].user.name, 'Rider');
    assert.equal(list.body.payments[0].status, 'pending');

    const ok = await leader.post(`/api/events/${id}/payments/${reg.body.payment.id}/confirm`);
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    assert.equal(ok.body.payment.status, 'paid');
    const view = await rider.get(`/api/events/${id}`);
    assert.equal(view.body.event.registered, true);
    assert.equal(view.body.event.myPayment.status, 'paid');
    assert.ok(view.body.participants.some((p) => p.name === 'Rider'));
    const riderNotes = (await rider.get('/api/notifications')).body.notifications.map((n) => n.title);
    assert.ok(riderNotes.some((n) => /Payment received/.test(n)));
    assert.equal((await leader.get(`/api/events/${id}/payments`)).body.totals.paidIdr, 150000);

    assert.equal((await leader.post(`/api/events/${id}/payments/${reg.body.payment.id}/confirm`)).status, 409, 'only once');
    assert.equal((await rider.post(`/api/events/${id}/unregister`)).status, 409, 'paid spots are cancelled by the organizer');
  });

  test('rejected or cancelled payments free the spot', async () => {
    const created = await leader.post('/api/events', eventBody(community.id, {
      kind: 'paid', priceIdr: 50000, paymentEmail: 'pay@club.id', paymentInstructions: 'Mandiri 999', maxParticipants: 2,
    }));
    const id = created.body.event.id;
    const a = await t.signup('A');
    const b = await t.signup('B');
    const regA = await a.post(`/api/events/${id}/register`, {});
    assert.equal(regA.status, 200);
    assert.equal((await b.post(`/api/events/${id}/register`, {})).status, 409, 'a pending payment holds the last spot');

    await leader.post(`/api/events/${id}/payments/${regA.body.payment.id}/reject`);
    assert.equal((await a.get(`/api/events/${id}`)).body.event.myRegistration, null);
    const regB = await b.post(`/api/events/${id}/register`, {});
    assert.equal(regB.status, 200);
    const cancel = await b.post(`/api/events/${id}/unregister`);
    assert.equal(cancel.body.event.myRegistration, null);
    assert.equal(cancel.body.event.spotsTaken, 1);
  });

  test('manual payments that are never confirmed expire after 72 hours', async () => {
    const created = await leader.post('/api/events', eventBody(community.id, {
      kind: 'paid', priceIdr: 50000, paymentEmail: 'pay@club.id', paymentInstructions: 'Mandiri 999', maxParticipants: 2,
    }));
    const id = created.body.event.id;
    const slow = await t.signup('Slow');
    const reg = await slow.post(`/api/events/${id}/register`, {});
    t.db.prepare('UPDATE event_payments SET created_at = ? WHERE id = ?').run(new Date(Date.now() - 73 * 3600e3).toISOString(), reg.body.payment.id);
    const next = await t.signup('Next');
    assert.equal((await next.post(`/api/events/${id}/register`, {})).status, 200);
    assert.equal((await slow.get(`/api/events/${id}/payment`)).body.payment.status, 'expired');
  });
});

describe('paid events through Midtrans', () => {
  let t;
  let mt;
  let leader;
  let community;
  before(async () => {
    mt = fakeMidtransApi();
    t = await startTestApp({
      payments: createMidtrans({ serverKey: SERVER_KEY, fetchImpl: mt.fetchImpl }),
      config: { publicUrl: 'https://roamr.test' },
    });
    ({ leader, community } = await setupCommunity(t, 'Gateway'));
  });
  after(() => t.close());

  const notify = (body) => t.client().post('/api/payments/midtrans/notification', body);

  test('registering opens a Snap payment and the webhook confirms it', async () => {
    const meta = await t.client().get('/api/meta');
    assert.deepEqual(meta.body.payments.gateway, { provider: 'midtrans', environment: 'sandbox' });
    const created = await leader.post('/api/events', eventBody(community.id, { kind: 'paid', priceIdr: 250000 }));
    assert.equal(created.status, 201, JSON.stringify(created.body));
    assert.equal(created.body.event.paymentMethod, 'gateway', 'gateway is the default when configured');
    const id = created.body.event.id;

    const rider = await t.signup('Payer');
    const reg = await rider.post(`/api/events/${id}/register`, {});
    assert.equal(reg.status, 200, JSON.stringify(reg.body));
    const { orderId, redirectUrl } = reg.body.payment;
    assert.match(redirectUrl, /^https:\/\/app\.sandbox\.midtrans\.com\//);
    const sentToMidtrans = mt.orders.get(orderId).request;
    assert.equal(sentToMidtrans.transaction_details.gross_amount, 250000);
    assert.equal(sentToMidtrans.customer_details.email, rider.email);
    assert.equal(sentToMidtrans.callbacks.finish, `https://roamr.test/events/${id}?payment=finish`);

    assert.equal((await notify({ ...notification(orderId, 250000, 'settlement'), signature_key: 'forged' })).status, 401);
    const wrongAmount = await notify(notification(orderId, 1000, 'settlement'));
    assert.equal(wrongAmount.body.ok, false);
    assert.equal((await rider.get(`/api/events/${id}`)).body.event.registered, false);

    assert.equal((await notify(notification(orderId, 250000, 'pending'))).body.ok, true);
    const done = await notify(notification(orderId, 250000, 'settlement'));
    assert.equal(done.status, 200);
    assert.equal(done.body.ok, true);
    const view = await rider.get(`/api/events/${id}`);
    assert.equal(view.body.event.registered, true);
    assert.equal(view.body.event.myPayment.status, 'paid');
    assert.equal(view.body.event.myPayment.redirectUrl, null);

    // Late or repeated notifications don't undo a payment.
    await notify(notification(orderId, 250000, 'expire'));
    assert.equal((await rider.get(`/api/events/${id}`)).body.event.registered, true);

    // Organizers can't confirm gateway payments by hand.
    const other = await t.signup('Other');
    const reg2 = await other.post(`/api/events/${id}/register`, {});
    assert.equal((await leader.post(`/api/events/${id}/payments/${reg2.body.payment.id}/confirm`)).status, 409);
    const leaderNotes = (await leader.get('/api/notifications')).body.notifications.map((n) => n.title);
    assert.ok(leaderNotes.some((n) => /Payer paid/.test(n)));
  });

  test('a failed payment releases the spot; refresh asks Midtrans when the webhook is missing', async () => {
    const created = await leader.post('/api/events', eventBody(community.id, { kind: 'paid', priceIdr: 100000, maxParticipants: 2 }));
    const id = created.body.event.id;
    const a = await t.signup('Late Webhook');
    const reg = await a.post(`/api/events/${id}/register`, {});
    const { orderId } = reg.body.payment;

    // Midtrans doesn't know the order yet: still pending.
    assert.equal((await a.post(`/api/events/${id}/payment/refresh`)).body.payment.status, 'pending');
    const n = notification(orderId, 100000, 'settlement');
    mt.orders.get(orderId).status = { ...n };
    const refreshed = await a.post(`/api/events/${id}/payment/refresh`);
    assert.equal(refreshed.body.payment.status, 'paid');

    const b = await t.signup('Declined');
    const regB = await b.post(`/api/events/${id}/register`, {});
    assert.equal(regB.status, 409, 'organizer + paid participant fill the event');

    const c2 = await leader.post('/api/events', eventBody(community.id, { kind: 'paid', priceIdr: 100000, maxParticipants: 2 }));
    const regC = await b.post(`/api/events/${c2.body.event.id}/register`, {});
    await notify(notification(regC.body.payment.orderId, 100000, 'deny'));
    const view = await b.get(`/api/events/${c2.body.event.id}`);
    assert.equal(view.body.event.myRegistration, null);
    assert.equal(view.body.event.myPayment.status, 'failed');
  });

  test('a gateway error leaves no reservation behind', async () => {
    const created = await leader.post('/api/events', eventBody(community.id, { kind: 'paid', priceIdr: 100000 }));
    const id = created.body.event.id;
    const a = await t.signup('Unlucky');
    mt.failNext = true;
    const reg = await a.post(`/api/events/${id}/register`, {});
    assert.equal(reg.status, 502);
    assert.equal((await a.get(`/api/events/${id}`)).body.event.myRegistration, null);
    const retry = await a.post(`/api/events/${id}/register`, {});
    assert.equal(retry.status, 200);
    assert.equal(retry.body.payment.status, 'pending');
  });

  test('stale gateway reservations are released', async () => {
    const created = await leader.post('/api/events', eventBody(community.id, { kind: 'paid', priceIdr: 100000, maxParticipants: 2 }));
    const id = created.body.event.id;
    const a = await t.signup('Walked Away');
    const reg = await a.post(`/api/events/${id}/register`, {});
    t.db.prepare('UPDATE event_payments SET created_at = ? WHERE id = ?').run(new Date(Date.now() - 2 * 3600e3).toISOString(), reg.body.payment.id);
    const b = await t.signup('Next In Line');
    assert.equal((await b.post(`/api/events/${id}/register`, {})).status, 200);
    // If Midtrans later says it was paid after all, they still get in.
    await notify(notification(reg.body.payment.orderId, 100000, 'settlement'));
    assert.equal((await a.get(`/api/events/${id}`)).body.event.registered, true);
  });
});
