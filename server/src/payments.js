import crypto from 'node:crypto';

// Payments for paid events.
//
// Two methods:
// - 'gateway': Midtrans Snap. The participant pays on Midtrans' hosted page
//   (QRIS, e-wallets, virtual accounts, cards). Midtrans tells us the result
//   through the HTTP notification webhook; the signature on it is checked
//   before anything changes.
// - 'manual': no gateway. The organizer gives an email address and payment
//   instructions (e.g. a bank account); the participant pays, sends proof to
//   that email and the organizer confirms the payment in the app.
//
// The gateway is only offered when MIDTRANS_SERVER_KEY is set.

export const PAYMENT_METHODS = ['gateway', 'manual'];
export const MIN_PRICE_IDR = 10_000;
export const MAX_PRICE_IDR = 50_000_000;
// How long a participant has to finish paying on Midtrans before the spot is
// released again. Midtrans sends an 'expire' notification at the same time.
export const GATEWAY_EXPIRY_MINUTES = 60;
// Manual payments wait for the organizer, so they keep the spot longer.
export const MANUAL_EXPIRY_HOURS = 72;

const SNAP_URL = {
  sandbox: 'https://app.sandbox.midtrans.com/snap/v1/transactions',
  production: 'https://app.midtrans.com/snap/v1/transactions',
};
const CORE_URL = {
  sandbox: 'https://api.sandbox.midtrans.com',
  production: 'https://api.midtrans.com',
};

// Maps a Midtrans transaction status to ours: 'paid', 'pending', 'failed' or
// 'refunded'. See https://docs.midtrans.com/docs/https-notification-webhooks
export function mapMidtransStatus(transactionStatus, fraudStatus) {
  switch (transactionStatus) {
    case 'settlement':
      return 'paid';
    case 'capture':
      // Card payments: 'challenge' needs a manual review in the Midtrans
      // dashboard, so keep the spot reserved until it is accepted or denied.
      if (fraudStatus === 'accept' || fraudStatus == null) return 'paid';
      return fraudStatus === 'challenge' ? 'pending' : 'failed';
    case 'pending':
    case 'authorize':
      return 'pending';
    case 'refund':
    case 'partial_refund':
    case 'chargeback':
    case 'partial_chargeback':
      return 'refunded';
    default:
      // deny, cancel, expire, failure
      return 'failed';
  }
}

export function midtransSignature({ orderId, statusCode, grossAmount, serverKey }) {
  return crypto.createHash('sha512').update(`${orderId}${statusCode}${grossAmount}${serverKey}`).digest('hex');
}

// Returns null when no server key is configured.
export function createMidtrans({ serverKey, production = false, fetchImpl = fetch, timeoutMs = 15000 } = {}) {
  if (!serverKey) return null;
  const env = production ? 'production' : 'sandbox';
  const auth = `Basic ${Buffer.from(`${serverKey}:`).toString('base64')}`;

  async function call(url, init = {}) {
    let res;
    try {
      res = await fetchImpl(url, {
        ...init,
        headers: { accept: 'application/json', 'content-type': 'application/json', authorization: auth },
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      throw new Error(`Midtrans unreachable: ${err.message}`);
    }
    const body = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, body };
  }

  return {
    name: 'midtrans',
    environment: env,

    // Creates a Snap transaction and returns the hosted payment page URL.
    async createTransaction({ orderId, amountIdr, itemName, customer, finishUrl }) {
      const { ok, status, body } = await call(SNAP_URL[env], {
        method: 'POST',
        body: JSON.stringify({
          transaction_details: { order_id: orderId, gross_amount: amountIdr },
          item_details: [{ id: orderId, price: amountIdr, quantity: 1, name: itemName.slice(0, 50) }],
          customer_details: { first_name: customer.name.slice(0, 50), email: customer.email },
          callbacks: finishUrl ? { finish: finishUrl } : undefined,
          expiry: { unit: 'minutes', duration: GATEWAY_EXPIRY_MINUTES },
        }),
      });
      if (!ok || !body.redirect_url) {
        const reason = Array.isArray(body.error_messages) ? body.error_messages.join('; ') : `HTTP ${status}`;
        throw new Error(`Midtrans rejected the transaction: ${reason}`);
      }
      return { token: body.token, redirectUrl: body.redirect_url };
    },

    // Asks Midtrans for the current status of an order. Returns null if
    // Midtrans doesn't know the order yet (the participant never opened the
    // payment page).
    async getStatus(orderId) {
      const { status, body } = await call(`${CORE_URL[env]}/v2/${encodeURIComponent(orderId)}/status`);
      if (status === 404 || body.status_code === '404') return null;
      if (!body.transaction_status) throw new Error(`Midtrans status check failed: HTTP ${status}`);
      return body;
    },

    verifyNotification(n) {
      if (!n || typeof n.signature_key !== 'string') return false;
      const expected = midtransSignature({
        orderId: n.order_id,
        statusCode: n.status_code,
        grossAmount: n.gross_amount,
        serverKey,
      });
      const a = Buffer.from(expected);
      const b = Buffer.from(n.signature_key);
      return a.length === b.length && crypto.timingSafeEqual(a, b);
    },
  };
}

// Midtrans sends gross_amount as a string like "150000.00".
export function sameAmount(grossAmount, amountIdr) {
  return Math.round(Number(grossAmount)) === amountIdr;
}

export function newOrderId(eventId) {
  return `RMR-${eventId}-${Date.now().toString(36)}-${crypto.randomBytes(4).toString('hex')}`.toUpperCase();
}
