import { useState } from 'react';
import { api } from '../api.js';
import { ago, rupiah } from '../format.js';
import { useLoad } from '../session.jsx';
import { Avatar, ErrorBox, Field } from './ui.jsx';

const STATUS_LABEL = {
  pending: 'Waiting for payment',
  paid: 'Paid',
  failed: 'Payment failed',
  rejected: 'Not confirmed by the organizer',
  expired: 'Expired',
  cancelled: 'Cancelled',
  refunded: 'Refunded',
};

// Register / pay box on a paid event page.
export function PaidRegistration({ event: e, past, full, onChange }) {
  const p = e.myPayment;
  const [note, setNote] = useState(p?.payerNote ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function run(fn) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      onChange();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  const register = () =>
    run(async () => {
      const res = await api.post(`/events/${e.id}/register`, {});
      // Online payment: continue on Midtrans' payment page.
      if (res.payment?.method === 'gateway' && res.payment.redirectUrl) window.location.assign(res.payment.redirectUrl);
    });

  if (e.registered) {
    return (
      <div className="stack">
        <div className="spread">
          <span className="pill brand">✓ You&apos;re registered{p?.status === 'paid' ? ` · paid ${rupiah(p.amountIdr)}` : ''}</span>
        </div>
        {!past && e.paymentEmail && (
          <p className="muted small" style={{ margin: 0 }}>
            Need to cancel? Ask the organizer about a refund at <a href={`mailto:${e.paymentEmail}`}>{e.paymentEmail}</a>.
          </p>
        )}
      </div>
    );
  }

  if (e.myRegistration === 'pending' && p?.status === 'pending') {
    return (
      <div className="stack">
        <div className="alert warning" role="status">
          Your spot is reserved. It&apos;s confirmed once {rupiah(p.amountIdr)} is paid.
        </div>
        {p.method === 'gateway' ? (
          <div className="row">
            {p.redirectUrl && (
              <a className="btn primary" href={p.redirectUrl}>
                Continue payment
              </a>
            )}
            <button type="button" className="btn" disabled={busy} onClick={() => run(() => api.post(`/events/${e.id}/payment/refresh`))}>
              I&apos;ve paid, check again
            </button>
          </div>
        ) : (
          <>
            <div className="card tight" style={{ background: 'var(--surface-2)' }}>
              <div className="small muted">How to pay</div>
              <p style={{ whiteSpace: 'pre-line', margin: '4px 0 8px' }}>{p.paymentInstructions}</p>
              <div className="small">
                Then email your receipt to{' '}
                <a href={`mailto:${p.paymentEmail}?subject=${encodeURIComponent(`Payment ${p.orderId} – ${e.title}`)}`}>{p.paymentEmail}</a>{' '}
                with reference <strong>{p.orderId}</strong>.
              </div>
            </div>
            <form
              className="stack"
              onSubmit={(ev) => {
                ev.preventDefault();
                run(() => api.post(`/events/${e.id}/payment/sent`, { note }));
              }}
            >
              <Field label="Tell the organizer you've paid" hint="bank, sender name, time">
                <input type="text" required maxLength={300} value={note} onChange={(ev) => setNote(ev.target.value)} placeholder="BCA a/n Kevin, 10:15" />
              </Field>
              <button className="btn" disabled={busy}>
                {p.payerNote ? 'Update payment details' : 'I’ve transferred'}
              </button>
            </form>
          </>
        )}
        <ErrorBox error={error} />
        <button type="button" className="btn small" disabled={busy} onClick={() => run(() => api.post(`/events/${e.id}/unregister`))}>
          Cancel registration
        </button>
      </div>
    );
  }

  if (past) return null;
  const lastFailed = p && ['failed', 'rejected', 'expired'].includes(p.status);
  return (
    <div className="stack">
      {lastFailed && <div className="alert warning">{STATUS_LABEL[p.status]}. You can try again.</div>}
      <ErrorBox error={error} />
      <button type="button" className="btn primary block" disabled={full || busy} onClick={register}>
        {full ? 'Event is full' : busy ? 'Starting payment…' : `Register · ${rupiah(e.priceIdr)}`}
      </button>
      <p className="muted small" style={{ margin: 0 }}>
        {e.paymentMethod === 'gateway'
          ? 'Pay securely with QRIS, e-wallets, virtual account or card via Midtrans.'
          : 'Pay by transfer; the organizer confirms your spot after checking it.'}
      </p>
    </div>
  );
}

// Organizer list of payments, with confirm / reject for manual transfers.
export function PaymentsPanel({ eventId, onChange }) {
  const state = useLoad(() => api.get(`/events/${eventId}/payments`), [eventId]);
  const [error, setError] = useState(null);

  async function act(paymentId, action) {
    setError(null);
    try {
      await api.post(`/events/${eventId}/payments/${paymentId}/${action}`);
      state.reload();
      onChange();
    } catch (err) {
      setError(err);
    }
  }

  const d = state.data;
  return (
    <div className="card stack">
      <div className="spread">
        <h2 style={{ margin: 0 }}>Payments</h2>
        {d && (
          <span className="small muted">
            {d.totals.paidCount} paid · {rupiah(d.totals.paidIdr)}
          </span>
        )}
      </div>
      <ErrorBox error={error ?? state.error} />
      {d && !d.payments.length && (
        <p className="muted" style={{ margin: 0 }}>
          No registrations yet.
        </p>
      )}
      {d && d.payments.length > 0 && (
        <div className="list">
          {d.payments.map((p) => (
            <div key={p.id} className="stack" style={{ gap: 4 }}>
              <div className="spread">
                <span className="row">
                  <Avatar name={p.user.name} /> {p.user.name}
                </span>
                <span className={`pill ${p.status === 'paid' ? 'brand' : 'earth'}`}>{STATUS_LABEL[p.status] ?? p.status}</span>
              </div>
              <div className="small muted">
                {p.user.email} · {p.orderId} · {rupiah(p.amountIdr)} · {p.method === 'gateway' ? 'online' : 'transfer'} · {ago(p.createdAt)}
              </div>
              {p.payerNote && <div className="small">“{p.payerNote}”</div>}
              {p.method === 'manual' && p.status === 'pending' && (
                <div className="row">
                  <button type="button" className="btn small primary" onClick={() => act(p.id, 'confirm')}>
                    Confirm payment
                  </button>
                  <button type="button" className="btn small" onClick={() => act(p.id, 'reject')}>
                    Not received
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
