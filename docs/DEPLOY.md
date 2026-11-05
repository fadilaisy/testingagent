# Deploying the Roamr alpha

Roamr runs as **one container**: the Node server serves both the API (`/api`) and the built web app, so there is no CORS or API base URL to configure. The browser always talks to the same origin. Data lives in one SQLite file on a persistent volume.

## Recommended host: Railway

- **Region close to users.** Railway's Southeast Asia region (Singapore) is about 15–25 ms from Jakarta.
- **Persistent volumes.** SQLite needs a disk that survives deploys; Railway attaches one to a service in a few clicks.
- **Builds the repo's `Dockerfile` directly** and reads `railway.json` (health check, one replica, restart policy).
- **HTTPS and a `*.up.railway.app` domain out of the box**, plus custom domains.

Fly.io (region `sin`) also fits, with the same Dockerfile and a volume mounted at `/data`. Hosts without persistent disks (Vercel, Netlify, serverless functions) do **not** fit, because SQLite and the live chat stream need one long-running process.

## What the alpha needs

| Setting | Value | Why |
|---|---|---|
| `NODE_ENV` | `production` (set in the image) | Secure cookies; demo data and demo mode off |
| `DATABASE_FILE` | `/data/roamr.db` (set in the image) | Must sit on the volume. The server refuses to start in production without it |
| `PORT` | set by Railway | The image defaults to 8080 |
| `TRUST_PROXY` | `1` | Railway's proxy sits in front; without it every user shares one IP and hits the login rate limit together |
| `ADMIN_EMAILS` | your email | Gets the `/admin` moderation dashboard, whoever registers first |
| `SIGNUP_CODE` | a code you choose | Closed alpha: sign-up needs it. Share `https://<domain>/register?invite=<code>` |

See `.env.example` for every variable. **No secrets are needed beyond `SIGNUP_CODE`**: sessions are random tokens stored in the database (no signing key), premium is simulated, and there is no email or push provider yet.

**Demo data stays out of the alpha.** In production the server never seeds the `@roamr.test` accounts unless `SEED=1`, and it refuses to start if the database already contains them (for example a copy of a local database), because they share the public password `password123`.

## Steps (Railway dashboard)

1. **New Project → Deploy from GitHub repo →** `fadilaisy/testingagent`, branch with this setup (after merge, `main`).
2. In the service: **Settings → Region →** Southeast Asia (Singapore).
3. **Add a volume** to the service with mount path **`/data`**.
4. **Variables:** add `TRUST_PROXY=1`, `ADMIN_EMAILS=<your email>`, `SIGNUP_CODE=<your code>`.
5. **Settings → Networking → Generate Domain** (or add your own domain and point a CNAME at it).
6. Deploy. The health check at `/api/health` must pass before traffic switches over.
7. Open the domain, register with your admin email and the invite code, and check `/admin` loads.

With the CLI instead: `railway login`, `railway init`, `railway up`, then add the volume and variables in the dashboard.

## Running the image yourself

```bash
docker build -t roamr .
docker run -p 8080:8080 -v roamr-data:/data \
  -e TRUST_PROXY=1 -e ADMIN_EMAILS=you@example.com -e SIGNUP_CODE=alpha-1 roamr
```

Without Docker: `npm ci && npm run build`, then `NODE_ENV=production DATABASE_FILE=/var/lib/roamr/roamr.db npm start` behind an HTTPS reverse proxy.

## Things to know during the alpha

- **One instance only.** SQLite and the live chat hub are in-process. Keep replicas at 1 (`railway.json` sets this). A deploy restarts the app, so expect a few seconds of downtime and testers' chat reconnecting by itself.
- **Back up the volume.** Turn on volume backups in Railway if your plan has them, and take a manual copy before risky deploys. The database is a single file (`/data/roamr.db` plus its `-wal` file).
- **Password resets have no email.** The reset link is written to the server log (`[password reset] email: /reset-password?token=…`). Find it in Railway's logs and send it to the tester yourself. Links expire.
- **Check-in uses real rules.** Demo mode is off, so testers must be within 500 m of the meeting point (or 300 m of the route) from 2 hours before the start. Set `DEMO_MODE=1` only for a remote demo session.
- **External services need no keys:** map tiles come from OpenStreetMap, weather from Open-Meteo, nearby places from the Overpass API. Their free tiers are fine for an alpha; heavy traffic would need a tile provider.
