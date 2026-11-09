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
| Fly hostname | `web/vercel.json` | `testingagent.fly.dev`; change it here and in `fly.toml` if that name is taken |

No other secrets exist: sessions are random tokens in the database, premium is simulated, and there is no email or push provider yet. Vercel needs **no environment variables**.

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

Check it: `curl https://testingagent.fly.dev/api/health` should return `{"ok":true}`.

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
- **Password resets have no email.** The reset link is written to the log (`[password reset] email: /reset-password?token=…`). Find it with `fly logs` and send it to the tester yourself.
- **Check-in uses real rules.** Demo mode is off, so testers must be within 500 m of the meeting point (or 300 m of the route) from 2 hours before the start. `fly secrets set DEMO_MODE=1` only for a remote demo.
- **External services need no keys:** OpenStreetMap tiles, Open-Meteo weather and the Overpass API are free for alpha traffic.

## Running the image yourself

```bash
docker build -t roamr .
docker run -p 3001:3001 -v roamr-data:/data -e TRUST_PROXY=1 \
  -e ADMIN_EMAILS=you@example.com -e SIGNUP_CODE=alpha-1 roamr
```
