import { Router } from 'express';
import { HttpError, requireUser } from '../auth.js';
import { paymentSummary } from '../eventPayments.js';
import { EVENT_SELECT } from '../serialize.js';
import * as v from '../validate.js';

// Payment endpoints for paid events. Registration itself starts at
// POST /events/:id/register (community.js).
export function paymentsRouter({ db, notifier, payments, eventPayments }) {
  const router = Router();

  const loadEvent = (id, viewerId) => {
    const e = db.prepare(`${EVENT_SELECT} WHERE e.id = ? AND e.hidden = 0`).get(viewerId, id);
    if (!e) throw new HttpError(404, 'Event not found');
    if (e.kind !== 'paid') throw new HttpError(409, 'This is a free community event');
    return e;
  };
  const isEventAdmin = (e, userId) =>
    Boolean(
      db
        .prepare("SELECT 1 FROM community_members WHERE community_id = ? AND user_id = ? AND role = 'admin' AND status = 'member'")
        .get(e.community_id, userId),
    );
  const myPayment = (e, userId) => {
    const p = eventPayments.latestPayment(e.id, userId);
    if (!p) throw new HttpError(404, 'You have no payment for this event');
    return p;
  };

  // Midtrans HTTP notification. Configure in the Midtrans dashboard as
  // https://<domain>/api/payments/midtrans/notification
  router.post('/payments/midtrans/notification', (req, res) => {
    if (!payments) throw new HttpError(404, 'Not found');
    if (!payments.verifyNotification(req.body)) {
      console.error(`[payments] rejected notification with a bad signature for ${req.body?.order_id}`);
      throw new HttpError(401, 'Invalid signature');
    }
    const result = eventPayments.applyMidtrans(req.body);
    // Midtrans retries anything that isn't 2xx; an order we don't know will
    // never become known, so acknowledge it.
    res.json({ ok: result.ok, reason: result.reason });
  });

  // The participant's own payment for an event.
  router.get('/events/:id/payment', requireUser, (req, res) => {
    const e = loadEvent(v.idParam(req.params.id), req.user.id);
    res.json({ payment: paymentSummary(myPayment(e, req.user.id), e) });
  });

  // Back from Midtrans: check the status directly in case the webhook is late.
  router.post('/events/:id/payment/refresh', requireUser, async (req, res) => {
    const e = loadEvent(v.idParam(req.params.id), req.user.id);
    const p = await eventPayments.refresh(myPayment(e, req.user.id));
    res.json({ payment: paymentSummary(p, e) });
  });

  // Manual payments: the participant says they've paid and adds a reference
  // (bank, sender name, time) so the organizer can find the transfer.
  router.post('/events/:id/payment/sent', requireUser, (req, res) => {
    const e = loadEvent(v.idParam(req.params.id), req.user.id);
    const p = myPayment(e, req.user.id);
    if (p.method !== 'manual' || p.status !== 'pending') throw new HttpError(409, 'There is no pending transfer to confirm');
    const note = v.text(req.body.note, 'Payment details', { max: 300, required: true });
    const updated = db
      .prepare('UPDATE event_payments SET payer_note = ?, updated_at = ? WHERE id = ? RETURNING *')
      .get(note, new Date().toISOString(), p.id);
    notifier.notify(e.created_by, {
      type: 'payment',
      title: `${req.user.name} says they paid for ${e.title}`,
      body: note,
      link: `/events/${e.id}`,
    });
    res.json({ payment: paymentSummary(updated, e) });
  });

  // Organizer view of payments.
  router.get('/events/:id/payments', requireUser, (req, res) => {
    const e = loadEvent(v.idParam(req.params.id), req.user.id);
    if (!isEventAdmin(e, req.user.id)) throw new HttpError(403, 'Only community admins can see payments');
    eventPayments.releaseExpired(e.id);
    const rows = db
      .prepare(
        `SELECT p.*, u.name AS user_name, u.email AS user_email FROM event_payments p JOIN users u ON u.id = p.user_id
         WHERE p.event_id = ? AND p.status IN ('pending', 'paid', 'refunded') ORDER BY p.status = 'pending' DESC, p.id DESC LIMIT 500`,
      )
      .all(e.id);
    const paid = rows.filter((p) => p.status === 'paid');
    res.json({
      payments: rows.map((p) => ({ ...paymentSummary(p, e), user: { id: p.user_id, name: p.user_name, email: p.user_email } })),
      totals: { paidCount: paid.length, paidIdr: paid.reduce((sum, p) => sum + p.amount_idr, 0) },
    });
  });

  // Organizer confirms or rejects a manual transfer. Gateway payments are
  // only ever confirmed by Midtrans.
  router.post('/events/:id/payments/:paymentId/:action', requireUser, (req, res) => {
    const e = loadEvent(v.idParam(req.params.id), req.user.id);
    if (!isEventAdmin(e, req.user.id)) throw new HttpError(403, 'Only community admins can confirm payments');
    const action = v.oneOf(req.params.action, 'Action', ['confirm', 'reject'], { required: true });
    const p = db.prepare('SELECT * FROM event_payments WHERE id = ? AND event_id = ?').get(v.idParam(req.params.paymentId), e.id);
    if (!p) throw new HttpError(404, 'Payment not found');
    if (p.method !== 'manual') throw new HttpError(409, 'Online payments are confirmed automatically by the payment gateway');
    if (p.status !== 'pending') throw new HttpError(409, `This payment is already ${p.status}`);
    const updated = eventPayments.setStatus(p, action === 'confirm' ? 'paid' : 'rejected', { providerRef: `confirmed-by:${req.user.id}` });
    res.json({ payment: paymentSummary(updated, e) });
  });

  return router;
}
