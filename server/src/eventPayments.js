import { HttpError } from './auth.js';
import { nowIso, transaction } from './db.js';
import { GATEWAY_EXPIRY_MINUTES, MANUAL_EXPIRY_HOURS, mapMidtransStatus, newOrderId, sameAmount } from './payments.js';

// Registration and payment state for paid events. A paid registration is a
// pending event_participants row (it holds the spot) plus a pending
// event_payments row. When the payment is confirmed (by Midtrans or by the
// organizer) the participant becomes 'confirmed'; when it fails, expires or
// is rejected both are released.

const GATEWAY_GRACE_MINUTES = 15;

export function paymentSummary(p, event) {
  return {
    id: p.id,
    orderId: p.order_id,
    method: p.method,
    amountIdr: p.amount_idr,
    status: p.status,
    redirectUrl: p.status === 'pending' ? p.redirect_url : null,
    payerNote: p.payer_note,
    paidAt: p.paid_at,
    createdAt: p.created_at,
    // Where to send proof of a manual payment.
    paymentEmail: p.method === 'manual' ? event?.payment_email ?? null : undefined,
    paymentInstructions: p.method === 'manual' ? event?.payment_instructions ?? null : undefined,
  };
}

export function createEventPayments({ db, notifier, payments, config = {} }) {
  const latestPayment = (eventId, userId) =>
    db.prepare('SELECT * FROM event_payments WHERE event_id = ? AND user_id = ? ORDER BY id DESC LIMIT 1').get(eventId, userId);

  // Releases spots held by payments that were never finished.
  function releaseExpired(eventId) {
    const gatewayCutoff = new Date(Date.now() - (GATEWAY_EXPIRY_MINUTES + GATEWAY_GRACE_MINUTES) * 60e3).toISOString();
    const manualCutoff = new Date(Date.now() - MANUAL_EXPIRY_HOURS * 3600e3).toISOString();
    const stale = db
      .prepare(
        `SELECT * FROM event_payments WHERE event_id = ? AND status = 'pending'
           AND ((method = 'gateway' AND created_at < ?) OR (method = 'manual' AND created_at < ?))`,
      )
      .all(eventId, gatewayCutoff, manualCutoff);
    for (const p of stale) setStatus(p, 'expired', { quiet: true });
    return stale.length;
  }

  // Moves a payment to a new status and keeps the participant row in step.
  // Returns the updated payment row.
  function setStatus(payment, status, { providerStatus = null, providerRef = null, quiet = false } = {}) {
    if (payment.status === status) return payment;
    // A payment that has been paid only moves on to refunded.
    if (payment.status === 'paid' && status !== 'refunded') return payment;
    const event = db.prepare('SELECT id, title, created_by FROM events WHERE id = ?').get(payment.event_id);
    const updated = transaction(db, () => {
      const row = db
        .prepare(
          `UPDATE event_payments SET status = ?, provider_status = COALESCE(?, provider_status),
             provider_ref = COALESCE(?, provider_ref), paid_at = CASE WHEN ? = 'paid' THEN ? ELSE paid_at END, updated_at = ?
           WHERE id = ? RETURNING *`,
        )
        .get(status, providerStatus, providerRef, status, nowIso(), nowIso(), payment.id);
      if (status === 'paid') {
        // Paid late after the spot was released? They paid, so they're in.
        db.prepare(
          `INSERT INTO event_participants (event_id, user_id, status) VALUES (?, ?, 'confirmed')
           ON CONFLICT (event_id, user_id) DO UPDATE SET status = 'confirmed'`,
        ).run(payment.event_id, payment.user_id);
      } else if (status !== 'pending') {
        // Only drop the participant if this payment was what held their spot.
        const newer = db
          .prepare("SELECT 1 FROM event_payments WHERE event_id = ? AND user_id = ? AND id > ? AND status IN ('pending', 'paid')")
          .get(payment.event_id, payment.user_id, payment.id);
        if (!newer) db.prepare('DELETE FROM event_participants WHERE event_id = ? AND user_id = ?').run(payment.event_id, payment.user_id);
      }
      return row;
    });
    if (!quiet && event) {
      const link = `/events/${event.id}`;
      const messages = {
        paid: `Payment received: you're registered for ${event.title}`,
        failed: `Payment for ${event.title} didn't go through`,
        rejected: `The organizer couldn't confirm your payment for ${event.title}`,
        refunded: `Your payment for ${event.title} was refunded`,
        expired: `Your spot at ${event.title} was released because payment wasn't finished`,
      };
      if (messages[status]) notifier.notify(payment.user_id, { type: 'payment', title: messages[status], link });
      if (status === 'paid' && payment.method === 'gateway') {
        const who = db.prepare('SELECT name FROM users WHERE id = ?').get(payment.user_id);
        notifier.notify(event.created_by, { type: 'payment', title: `${who?.name ?? 'Someone'} paid for ${event.title}`, link });
      }
    }
    return updated;
  }

  // Starts a paid registration. `event` is a row from EVENT_SELECT.
  async function register(event, user, { note = '' } = {}) {
    releaseExpired(event.id);
    const existing = db.prepare('SELECT status FROM event_participants WHERE event_id = ? AND user_id = ?').get(event.id, user.id);
    if (existing?.status === 'confirmed') return latestPayment(event.id, user.id) ?? null;
    if (existing?.status === 'pending') {
      const p = latestPayment(event.id, user.id);
      if (p?.status === 'pending') return p;
    }
    if (event.payment_method === 'gateway' && !payments) {
      throw new HttpError(503, 'Online payment is not available right now. Please try again later.');
    }

    const orderId = newOrderId(event.id);
    const payment = transaction(db, () => {
      const n = db.prepare('SELECT COUNT(*) AS n FROM event_participants WHERE event_id = ?').get(event.id).n;
      if (event.max_participants && n >= event.max_participants && !existing) throw new HttpError(409, 'This event is full');
      db.prepare(
        `INSERT INTO event_participants (event_id, user_id, status) VALUES (?, ?, 'pending')
         ON CONFLICT (event_id, user_id) DO UPDATE SET status = 'pending'`,
      ).run(event.id, user.id);
      return db
        .prepare(
          `INSERT INTO event_payments (order_id, event_id, user_id, method, amount_idr, payer_note)
           VALUES (?, ?, ?, ?, ?, ?) RETURNING *`,
        )
        .get(orderId, event.id, user.id, event.payment_method, event.price_idr, note || null);
    });

    if (payment.method === 'manual') {
      notifier.notify(event.created_by, {
        type: 'payment',
        title: `${user.name} registered for ${event.title} and will pay by transfer`,
        body: 'Confirm the payment on the event page once it arrives.',
        link: `/events/${event.id}`,
      });
      return payment;
    }

    try {
      const { redirectUrl } = await payments.createTransaction({
        orderId,
        amountIdr: payment.amount_idr,
        itemName: event.title,
        customer: { name: user.name, email: user.email },
        finishUrl: config.publicUrl ? `${config.publicUrl}/events/${event.id}?payment=finish` : undefined,
      });
      return db.prepare('UPDATE event_payments SET redirect_url = ? WHERE id = ? RETURNING *').get(redirectUrl, payment.id);
    } catch (err) {
      console.error(`[payments] ${orderId}: ${err.message}`);
      setStatus(payment, 'failed', { quiet: true });
      throw new HttpError(502, 'Could not start the payment. Please try again in a moment.');
    }
  }

  // Applies a Midtrans notification or status response.
  function applyMidtrans(body) {
    const payment = db.prepare('SELECT * FROM event_payments WHERE order_id = ?').get(String(body.order_id ?? ''));
    if (!payment) return { ok: false, reason: 'unknown order' };
    if (payment.method !== 'gateway') return { ok: false, reason: 'not a gateway payment' };
    if (!sameAmount(body.gross_amount, payment.amount_idr)) {
      console.error(`[payments] ${payment.order_id}: amount ${body.gross_amount} does not match ${payment.amount_idr}`);
      return { ok: false, reason: 'amount mismatch' };
    }
    const status = mapMidtransStatus(body.transaction_status, body.fraud_status);
    const updated = setStatus(payment, status, { providerStatus: body.transaction_status, providerRef: body.transaction_id ?? null });
    return { ok: true, payment: updated };
  }

  // Asks Midtrans directly, for when the webhook hasn't arrived (e.g. local
  // development, where Midtrans can't reach the server).
  async function refresh(payment) {
    if (payment.method !== 'gateway' || payment.status !== 'pending' || !payments) return payment;
    let body;
    try {
      body = await payments.getStatus(payment.order_id);
    } catch (err) {
      console.error(`[payments] ${payment.order_id}: ${err.message}`);
      throw new HttpError(502, 'Could not check the payment right now. Please try again in a moment.');
    }
    if (!body) return payment;
    return applyMidtrans(body).payment ?? payment;
  }

  return { latestPayment, releaseExpired, setStatus, register, applyMidtrans, refresh };
}
