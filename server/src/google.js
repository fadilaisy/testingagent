import crypto from 'node:crypto';

// Sign in with Google (OAuth 2.0 authorization code flow + OpenID Connect).
//
// The browser is sent to Google with a random `state` (ties the callback to
// the browser that started it), a `nonce` (ties the ID token to this sign-in)
// and a PKCE challenge. Google sends the browser back with a code, which the
// server exchanges for an ID token using the client secret. The ID token's
// signature is checked against Google's published keys, then its issuer,
// audience, expiry, nonce and email_verified claim. Nothing the browser says
// about who the user is gets trusted.
//
// Only active when GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and
// GOOGLE_CALLBACK_URL are all set.

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs';
export const GOOGLE_ISSUERS = ['https://accounts.google.com', 'accounts.google.com'];
// Allowed clock difference between us and Google.
const CLOCK_SKEW_S = 60;

export class GoogleAuthError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

const b64url = (buf) => Buffer.from(buf).toString('base64url');

export function pkcePair() {
  const verifier = b64url(crypto.randomBytes(32));
  const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
  return { verifier, challenge };
}

function decodePart(part) {
  try {
    return JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));
  } catch {
    throw new GoogleAuthError('invalid_token', 'ID token is not valid JSON');
  }
}

// Returns null when Google login is not configured.
export function createGoogleAuth({ clientId, clientSecret, callbackUrl, fetchImpl = fetch, now = () => Date.now(), timeoutMs = 10000 } = {}) {
  if (!clientId || !clientSecret || !callbackUrl) return null;

  let keys = new Map();
  let keysExpireAt = 0;
  let lastFetch = 0;

  async function loadKeys(force = false) {
    if (!force && keys.size && now() < keysExpireAt) return;
    // A token signed with a key we don't know triggers a refetch, but not
    // more than once a minute, so bad tokens can't make us hammer Google.
    if (force && now() - lastFetch < 60e3) return;
    lastFetch = now();
    let res;
    try {
      res = await fetchImpl(JWKS_URL, { signal: AbortSignal.timeout(timeoutMs) });
    } catch (err) {
      throw new GoogleAuthError('google_unreachable', `Could not fetch Google signing keys: ${err.message}`);
    }
    if (!res.ok) throw new GoogleAuthError('google_unreachable', `Google signing keys: HTTP ${res.status}`);
    const body = await res.json();
    const next = new Map();
    for (const jwk of body.keys ?? []) {
      if (jwk.kty === 'RSA' && jwk.kid) next.set(jwk.kid, crypto.createPublicKey({ key: jwk, format: 'jwk' }));
    }
    keys = next;
    const maxAge = Number(/max-age=(\d+)/.exec(res.headers?.get?.('cache-control') ?? '')?.[1] ?? 3600);
    keysExpireAt = now() + Math.min(maxAge, 24 * 3600) * 1000;
  }

  return {
    authorizationUrl({ state, nonce, codeChallenge }) {
      const url = new URL(AUTH_URL);
      url.search = new URLSearchParams({
        client_id: clientId,
        redirect_uri: callbackUrl,
        response_type: 'code',
        scope: 'openid email profile',
        state,
        nonce,
        code_challenge: codeChallenge,
        code_challenge_method: 'S256',
        prompt: 'select_account',
      }).toString();
      return url.toString();
    },

    // Exchanges the authorization code for an ID token (server to server).
    async exchangeCode(code, codeVerifier) {
      let res;
      try {
        res = await fetchImpl(TOKEN_URL, {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
          body: new URLSearchParams({
            code,
            client_id: clientId,
            client_secret: clientSecret,
            redirect_uri: callbackUrl,
            grant_type: 'authorization_code',
            code_verifier: codeVerifier,
          }).toString(),
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (err) {
        throw new GoogleAuthError('google_unreachable', `Google token endpoint unreachable: ${err.message}`);
      }
      const body = await res.json().catch(() => ({}));
      if (!res.ok || typeof body.id_token !== 'string') {
        throw new GoogleAuthError('exchange_failed', `Google refused the code: ${body.error ?? `HTTP ${res.status}`}`);
      }
      return body.id_token;
    },

    // Verifies an ID token and returns the identity in it.
    async verifyIdToken(idToken, { nonce }) {
      const parts = String(idToken).split('.');
      if (parts.length !== 3) throw new GoogleAuthError('invalid_token', 'ID token is malformed');
      const header = decodePart(parts[0]);
      if (header.alg !== 'RS256') throw new GoogleAuthError('invalid_token', `Unexpected ID token algorithm ${header.alg}`);
      await loadKeys();
      if (!keys.has(header.kid)) await loadKeys(true);
      const key = keys.get(header.kid);
      if (!key) throw new GoogleAuthError('invalid_token', 'ID token is signed with an unknown key');
      const ok = crypto.verify('RSA-SHA256', Buffer.from(`${parts[0]}.${parts[1]}`), key, Buffer.from(parts[2], 'base64url'));
      if (!ok) throw new GoogleAuthError('invalid_token', 'ID token signature is invalid');

      const c = decodePart(parts[1]);
      const nowS = Math.floor(now() / 1000);
      if (!GOOGLE_ISSUERS.includes(c.iss)) throw new GoogleAuthError('invalid_token', 'ID token issuer is not Google');
      const aud = Array.isArray(c.aud) ? c.aud : [c.aud];
      if (!aud.includes(clientId)) throw new GoogleAuthError('invalid_token', 'ID token is for another app');
      if (aud.length > 1 && c.azp !== clientId) throw new GoogleAuthError('invalid_token', 'ID token is for another app');
      if (typeof c.exp !== 'number' || c.exp + CLOCK_SKEW_S < nowS) throw new GoogleAuthError('invalid_token', 'ID token has expired');
      if (typeof c.iat === 'number' && c.iat - CLOCK_SKEW_S > nowS) throw new GoogleAuthError('invalid_token', 'ID token is from the future');
      if (!nonce || c.nonce !== nonce) throw new GoogleAuthError('invalid_token', 'ID token nonce does not match');
      if (typeof c.sub !== 'string' || !c.sub) throw new GoogleAuthError('invalid_token', 'ID token has no subject');
      if (typeof c.email !== 'string' || !c.email) throw new GoogleAuthError('unverified_email', 'Google did not share an email address');
      if (c.email_verified !== true && c.email_verified !== 'true') {
        throw new GoogleAuthError('unverified_email', 'This Google account email is not verified');
      }
      return {
        sub: c.sub,
        email: c.email.trim().toLowerCase(),
        name: typeof c.name === 'string' ? c.name.trim() : '',
        picture: typeof c.picture === 'string' && c.picture.startsWith('https://') ? c.picture : null,
      };
    },
  };
}
