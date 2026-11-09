// Transactional email (password resets) through Resend's HTTP API
// (https://resend.com/docs/api-reference/emails/send-email). No SDK needed.
//
// Only active when RESEND_API_KEY and EMAIL_FROM are set. Without it the
// reset link is written to the server log instead (see /auth/forgot).

const RESEND_URL = 'https://api.resend.com/emails';

// Returns null when no email provider is configured.
export function createMailer({ apiKey, from, fetchImpl = fetch, timeoutMs = 10000 } = {}) {
  if (!apiKey || !from) return null;
  return {
    name: 'resend',
    async send({ to, subject, text, html }) {
      let res;
      try {
        res = await fetchImpl(RESEND_URL, {
          method: 'POST',
          headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
          body: JSON.stringify({ from, to: [to], subject, text, html }),
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (err) {
        throw new Error(`Email provider unreachable: ${err.message}`);
      }
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(`Email provider refused the message: ${body.message ?? `HTTP ${res.status}`}`);
      }
      return true;
    },
  };
}

const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);

export function passwordResetEmail({ appName, name, link }) {
  const subject = `Reset your ${appName} password`;
  const text = [
    `Hi ${name},`,
    '',
    `Someone asked to reset the password for your ${appName} account. Open this link within an hour to choose a new one:`,
    link,
    '',
    "If it wasn't you, ignore this email. Your password stays the same.",
  ].join('\n');
  const html = `<p>Hi ${escapeHtml(name)},</p>
<p>Someone asked to reset the password for your ${escapeHtml(appName)} account. Open this link within an hour to choose a new one:</p>
<p><a href="${escapeHtml(link)}">Reset my password</a></p>
<p>If it wasn't you, ignore this email. Your password stays the same.</p>`;
  return { subject, text, html };
}
