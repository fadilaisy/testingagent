# Deploying the ROAMR alpha (Vercel + Fly.io)

```
browser ──► Vercel (roamr.vercel.app or your domain)
              ├─ /assets, /index.html …  static web app (web/dist)
              └─ /api/*  ── rewrite ──► Fly.io (testingagent.fly.dev)
                                          Node server + SQLite on a volume
```

- **Vercel** builds and serves the React app from `web/`. It proxies every `/api/*` request to Fly with a rewrite (`web/vercel.json`), so the browser only ever talks to one domain. That means **no CORS, no API base URL in the web build, and first-party cookies**.
- **Fly.io** runs the server from the repo's `Dockerfile` in Singapore (`sin`, close to Jakarta) with a volume at `/data` for the SQLite file (`fly.toml`). The Fly app also serves a copy of the web app, so `https://testingagent.fly.dev` works on its own if Vercel is down.

## Settings

| Setting | Where | Value |
|---|---|---|
| `NODE_ENV`, `PORT`, `DATABASE_FILE` | `fly.toml` | `production`, `3001`, `/data/jalur.db` (the volume and file keep their original names so existing data stays put) |
| `TRUST_PROXY` | `fly.toml` | `2` (Vercel, then Fly's proxy) so the login rate limit sees each tester's real IP |
| `ADMIN_EMAILS` | `fly secrets set` | your email: gets `/admin` |
| `SIGNUP_CODE` | `fly secrets set` | the invite code. Share `https://<domain>/register?invite=<code>` |
| `MIDTRANS_SERVER_KEY` | `fly secrets set` | optional: turns on online payment for paid events (see below) |
| `MIDTRANS_PRODUCTION`, `PUBLIC_URL` | `fly secrets set` | `1` with the production key; your site address, e.g. `https://roamr.id` |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_CALLBACK_URL` | `fly secrets set` | optional: "Continue with Google" (see below). All three or none |
| `RESEND_API_KEY`, `EMAIL_FROM` | `fly secrets set` | optional: emails password-reset links (see below). Needs `PUBLIC_URL` |
| Fly hostname | `web/vercel.json` | `testingagent.fly.dev`; change it here and in `fly.toml` if that name is taken |

No other secrets exist: sessions are random tokens in the database and premium is simulated. Vercel needs **no environment variables**: the web app calls `/api` on its own domain.

**Demo data stays out of the alpha.** In production the server never seeds the `@roamr.test` accounts unless `SEED=1`, and refuses to start if the database already contains them, because they share the public password `password123`.

## 1. Fly.io (API and database)

From the repo root, with [flyctl](https://fly.io/docs/flyctl/install/) installed:

```bash
fly auth login
fly launch --no-deploy --copy-config --name testingagent --region sin
fly volumes create jalur_data --region sin --size 1
fly secrets set ADMIN_EMAILS=you@example.com SIGNUP_CODE=pick-a-code
fly deploy
fly scale count 1          # one machine only: SQLite and live chat are in-process
```

Check it: `curl https://testingagent.fly.dev/api/health` should return `{"ok":true}`. Fly also polls that URL every 30 seconds (`[[http_service.checks]]` in `fly.toml`) and shows the result in `fly checks list`.

**Use the existing volume.** `jalur_data` already holds `/data/jalur.db`. Don't create a second volume or delete this one: the app would start with an empty database on the new one. To start the alpha from a clean database instead, take a snapshot first (`fly volumes snapshots create <volume-id>`), then ask before removing anything.

## 2. Vercel (web app)

1. **Add New → Project →** import `fadilaisy/testingagent`.
2. **Root Directory: `web`**. Vercel picks up `web/vercel.json` (Vite, output `dist`).
3. Deploy, then optionally add your domain under **Settings → Domains**.
4. Open the site, register with your admin email and the invite code, and check that `/admin` loads.

Each push to the production branch redeploys Vercel automatically. Fly deploys when you run `fly deploy` (or add the Fly GitHub Action later).

## Things to know during the alpha

- **One Fly machine, always on.** `fly.toml` turns auto-stop off, because a stopped machine would drop everyone's live chat. Don't scale above 1. A deploy restarts it, so expect a few seconds of downtime.
- **Live chat goes through Vercel's proxy.** If Vercel or a deploy cuts the stream, the browser reconnects within seconds and the chat refetches its messages, so nothing is missed. If live updates turn out unreliable through Vercel, the fallback is serving everything from Fly with a custom domain.
- **Back up the volume.** Fly takes daily volume snapshots (`fly volumes snapshots list`). Take one manually before risky deploys: `fly volumes snapshots create <volume-id>`.
- **Password resets without an email provider.** Until `RESEND_API_KEY` is set, the reset link is only written to the log (`[password reset] email: /reset-password?token=…`) and the server warns about it at start. Find it with `fly logs` and send it yourself.
- **Check-in uses real rules.** Demo mode is off, so testers must be within 500 m of the meeting point (or 300 m of the route) from 2 hours before the start. `fly secrets set DEMO_MODE=1` only for a remote demo.
- **External services need no keys:** OpenStreetMap tiles, Open-Meteo weather and the Overpass API are free for alpha traffic.

## Domain

1. Buy the domain, then in Vercel **Settings → Domains** add it (e.g. `roamr.id` and `www.roamr.id`) and create the DNS records Vercel shows (an `A` record for the apex, a `CNAME` for `www`). Vercel issues the HTTPS certificate.
2. `fly secrets set PUBLIC_URL=https://roamr.id` (used in Midtrans return links and reset emails).
3. Update the Google callback and Midtrans notification URLs below to the new domain.

**API URL, CORS and cookies.** The browser only ever talks to the Vercel domain; `/api/*` is rewritten to Fly (`web/vercel.json`), so there is no cross-origin request and no CORS to configure. The session cookie `sid` is first-party on that domain: `HttpOnly`, `SameSite=Lax`, `Secure` in production (`NODE_ENV=production`), 30 days, and deleted on logout. If you ever serve the web app and API from different domains, this has to be revisited (CORS with credentials and `SameSite=None`); keep them on one domain instead.

## Google login

"Continue with Google" appears on the login and sign-up pages when all three `GOOGLE_*` settings are set. The server runs the OAuth 2.0 authorization-code flow with PKCE: it sends the browser to Google, exchanges the returned code for an ID token using the client secret (which never leaves the server), and checks the token's signature against Google's keys plus its issuer, audience, expiry, nonce and `email_verified`. A random `state` in a short-lived HttpOnly cookie ties the callback to the browser that started it.

Accounts are matched by Google account id, then by verified email:

- **New email** → a new account (needs the invite code when `SIGNUP_CODE` is set: open the invite link and press "Sign up with Google" there). `ADMIN_EMAILS` applies as usual.
- **Existing account with that email** → Google is linked to it; profile, role, communities and payments stay. If that account's email was never proven (it signed up with a password and never completed a password reset), its password is removed and its sessions end, because whoever created it may not own the address. The user gets a notification and can set a password again with "Forgot password".
- **Email already linked to another Google account**, **suspended account**, **unverified Google email**, **cancelled consent**, **expired or replayed sign-in** → back to the login page with a message.

Set it up in [Google Cloud Console](https://console.cloud.google.com/):

1. Create (or pick) a project. **APIs & Services → OAuth consent screen** (Google Auth Platform → Branding/Audience): app name `ROAMR`, support email, your domain under *Authorized domains*, links to privacy policy and terms. User type **External**. Scopes: `openid`, `email`, `profile` only (no verification review is needed for these). While the app is in *Testing*, only listed test users can sign in; press **Publish app** for the alpha.
2. **Credentials → Create credentials → OAuth client ID → Web application.**
   - *Authorized JavaScript origins*: `https://roamr.id` (your domain), plus `http://localhost:5173` for local testing.
   - *Authorized redirect URIs*: `https://roamr.id/api/auth/google/callback`, plus `http://localhost:5173/api/auth/google/callback` for local testing.
3. Copy the client ID and secret, then:

```bash
fly secrets set GOOGLE_CLIENT_ID=….apps.googleusercontent.com GOOGLE_CLIENT_SECRET=GOCSPX-… \
  GOOGLE_CALLBACK_URL=https://roamr.id/api/auth/google/callback
```

The callback must be on the same domain people open the site on (the Vercel domain), because the state cookie lives there; sign-ins started on `testingagent.fly.dev` directly will fail with "took too long". In production the server refuses to start with a non-https callback or one that doesn't end in `/api/auth/google/callback`.

## Password reset email

Reset emails go through [Resend](https://resend.com) (HTTP API, no SDK). Create an account, verify your domain (add the DNS records Resend shows), create an API key with *Sending access*, then:

```bash
fly secrets set RESEND_API_KEY=re_… EMAIL_FROM="ROAMR <no-reply@roamr.id>" PUBLIC_URL=https://roamr.id
```

Reset links are valid for one hour and work once; only a hash of the token is stored, and asking for a new link cancels the previous one. The answer to "Forgot password" is the same whether or not the email has an account, and the link is never written to the log once email is on. Another provider can replace `server/src/email.js` without touching the rest.

## Paid events and Midtrans

Events come in two types: **community events** (free) and **paid events** (a price in rupiah). A paid event uses one of two payment methods, chosen by the organizer:

- **Manual (works with no setup).** The organizer enters a payment email and transfer instructions. A participant who registers holds a spot for 72 hours, transfers the money, emails the receipt and taps "I've transferred". The organizer confirms or rejects each payment in the Payments card on the event page.
- **Online through Midtrans** (only offered when `MIDTRANS_SERVER_KEY` is set). The participant pays on Midtrans' page with QRIS, e-wallets, virtual accounts or cards and is confirmed automatically by Midtrans' notification. Unpaid spots are released after an hour.

To turn on Midtrans:

1. Create a Midtrans account and, under **Settings → Access Keys** in the *Sandbox* dashboard, copy the server key (`SB-Mid-server-…`).
2. `fly secrets set MIDTRANS_SERVER_KEY=SB-Mid-server-… PUBLIC_URL=https://<your-domain>`
3. In **Settings → Payment → Notification URL** set `https://<your-domain>/api/payments/midtrans/notification`. Notifications are checked against the SHA-512 signature and the expected amount before anything changes.
4. Test with a paid event and Midtrans' [sandbox payment simulator](https://simulator.sandbox.midtrans.com/). Check that the registration flips to confirmed, and in `fly logs` that no `[payments] rejected notification` lines appear. Repeated notifications for the same order are ignored once it is paid.
   **Don't switch to production keys until this sandbox run works end to end.**
5. When Midtrans activates your production account: `fly secrets set MIDTRANS_SERVER_KEY=Mid-server-… MIDTRANS_PRODUCTION=1` and set the same notification URL in the production dashboard.

**Money flow.** With Midtrans, all payments land in the Roamr merchant account, not the organizer's. Paying organizers out (minus any fee) is a manual step for now: the Payments card shows each event's paid total. Before taking real money, check with Midtrans whether collecting on behalf of organizers needs their marketplace / split-payment setup, and put refund rules in the terms. Registrants can't cancel a paid spot themselves; refunds go through the organizer (and the Midtrans dashboard for online payments, which then notifies Roamr and releases the spot).

## Running the image yourself

```bash
docker build -t roamr .
docker run -p 3001:3001 -v roamr-data:/data -e TRUST_PROXY=1 \
  -e ADMIN_EMAILS=you@example.com -e SIGNUP_CODE=alpha-1 roamr
```
