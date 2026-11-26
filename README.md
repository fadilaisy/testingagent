# ROAMR

A community-powered outdoor activity platform: discover routes, find people to ride, run or hike with, plan together, share live track conditions, check the weather, check in, and find somewhere to finish.

This is the MVP for the *Outdoor Activity Community & Route Discovery Platform* PRD, built around its core loop:

> Find a route → Find people → Plan together → Meet → Share conditions → Finish together

To change the app name, edit `server/src/app.js` (`appName`), `web/index.html` and `web/src/App.jsx`.

## Quick start

Requires Node.js 22.13 or newer. There is no database to install: locally the server runs Postgres in-process with [PGlite](https://pglite.dev) (Postgres compiled to WebAssembly); production uses a real PostgreSQL server.

```bash
npm install
npm run dev
```

Open http://localhost:5173. The API runs on port 3001, and Vite proxies `/api` to it.

On first start the database (`server/data/pglite/`) is created and filled with demo data around Jakarta, Bogor, Sentul and Puncak. Every demo account uses the password `password123`:

| Account | Role |
|---|---|
| `kevin@roamr.test` | Rider and runner, has upcoming rides and history |
| `sarah@roamr.test` | Premium community leader (Jakarta Cycling Club) |
| `rina@roamr.test` | Premium leader of a private trail-running community |
| `budi@roamr.test` | Beginner cyclist in Depok, receives nearby-event notifications |
| `admin@roamr.test` | Admin (moderation dashboard at `/admin`) |

`npm run seed` wipes the local database and reseeds it.

### Other commands

```bash
npm test          # server test suite (node:test, runs offline)
npm run build     # build the web app into web/dist
npm start         # serve API + built web app on port 3001
```

## Production

```bash
npm install && npm run build
NODE_ENV=production DATABASE_URL=postgres://roamr:password@localhost:5432/roamr npm start
```

In production the server also serves `web/dist`. Run it behind HTTPS: session cookies are `Secure` in production. The alpha runs on one AWS Lightsail server with Postgres next to the app (`deploy/aws/`); see [docs/DEPLOY-AWS.md](docs/DEPLOY-AWS.md) for the guide and `.env.example` for a template. The earlier Vercel + Fly.io setup is in [docs/DEPLOY.md](docs/DEPLOY.md).

Settings are environment variables; [`.env.example`](.env.example) lists every one the server reads. To use them locally, copy it to `.env` in the repo root and fill in what you need (empty means default or off): `npm run dev`, `npm start` and `npm run seed` load `.env` when it exists, and variables set in the shell take precedence. `.env` is git-ignored. The web app reads no environment variables.

| Variable | Default | Purpose |
|---|---|---|
| `NODE_ENV` | unset | `production` turns on Secure cookies, requires a `postgres://` `DATABASE_URL` and turns off demo data and demo mode |
| `PORT` | `3001` | HTTP port |
| `DATABASE_URL` | `server/data/pglite`; a `postgres://` URL is **required** in production | PostgreSQL connection URL, or a folder for an embedded PGlite database |
| `DEMO_MODE` | on in development, off in production | Relaxes the check-in time window and adds a "check in at the meeting point" button |
| `SEED` | on in development, off in production | `1` loads demo data on an empty database, `0` skips it. Production refuses to start on a database with demo accounts unless `SEED=1` |
| `TRUST_PROXY` | unset | Express `trust proxy` setting when behind a load balancer (`1` = one hop) |
| `ADMIN_EMAILS` | unset | Comma-separated emails that are admins. Unset: the first account registered becomes the admin |
| `SIGNUP_CODE` | unset | Invite code required to register (closed alpha). Link: `/register?invite=<code>` |
| `PUBLIC_URL` | unset | Site address, e.g. `https://roamr.id`. Used in Midtrans return links and reset emails; required in production when either is configured |
| `MIDTRANS_SERVER_KEY` | unset | Turns on online payment for paid events (Midtrans Snap). Unset: manual confirmation only. See docs/DEPLOY.md |
| `MIDTRANS_PRODUCTION` | `0` | `1` uses the Midtrans production environment (needs the production key, not `SB-...`) |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_CALLBACK_URL` | unset | All three turn on "Continue with Google". See docs/DEPLOY.md |
| `RESEND_API_KEY`, `EMAIL_FROM` | unset | Send password-reset emails through Resend. Unset: the link is only logged |
| `INSECURE_COOKIES` | unset | `1` allows non-Secure cookies in production (local testing only) |

`GET /api/health` returns `{ "ok": true }` for host health checks.

## What's in the MVP

Mapped to the PRD's MVP table (§34):

| PRD feature | Status |
|---|---|
| Registration, login, logout, reset password, edit profile | ✅ Email and password, plus Google sign-in (OIDC, linked by verified email) when configured. Reset links are emailed through Resend when configured; otherwise logged on the server, and outside production also shown on screen |
| Activity categories and onboarding | ✅ Road cycling, gravel, MTB, running, trail running, hiking, other |
| GPX upload, parse, distance, elevation gain/loss, highest point, estimated time, difficulty | ✅ With a preview before publishing and a GPS-noise filter on elevation |
| Route map and elevation profile | ✅ Leaflet + OpenStreetMap tiles |
| Route discovery | ✅ Filter by activity, distance, difficulty, text and distance from you; sort by popularity, newest or nearest |
| Weather along the route | ✅ Open-Meteo (no API key). Up to 5 points along the route, forecast for when the group reaches each one, rain and storm alerts |
| Activity announcement, join, request to join, participant limit | ✅ Public and private plans; host approves requests |
| Automatic group chat | ✅ Live updates over server-sent events. Text, shared location, condition reports, system messages |
| Track condition reports | ✅ Road, traffic, weather, trail, crowd, with KM marker. Shown on the route, posted to the chat, and sent to people riding the route in the next 48 h. A safety warning appears when 2+ people report the same serious problem |
| Check-in | ✅ GPS geofence: within 500 m of the meeting point or 300 m of the route, from 2 h before the start |
| Nearby coffee, food and more | ✅ OpenStreetMap Overpass API, falling back to the local `places` table |
| Communities (basic and premium) | ✅ Public and private communities, member management, announcements |
| Premium subscription | ⚠️ Simulated: "Start 30-day premium" grants the plan without payment |
| Events | ✅ Route, meeting pin, capacity, registration, weather. Two types: free community events (run by communities) and paid events (run by verified organizers and sponsors, with a "What you get" list such as a finisher medal) |
| Paid events | ✅ Only organizer profiles approved by a site admin (Admin page) can sell them. Price in rupiah. Online payment through Midtrans Snap when `MIDTRANS_SERVER_KEY` is set (signed webhook, status check on return, unpaid spots released after 1 hour), or manual transfer confirmed by the organizer, with receipts sent to the organizer's payment email. See docs/DEPLOY.md |
| Nearby event notifications | ✅ Radius 5/10/25/50 km. Respects activity preference, the user's own radius and opt-out, and is capped at 1 per day and 3 per week |
| SOS | ✅ Alerts the group with your location (cannot be muted), plus a call button for 112 and your emergency contact |
| Notifications and settings | ✅ In-app with live badge and toasts, with per-type opt-out |
| Global search | ✅ Routes, events, communities, people, places |
| Content reporting and admin moderation | ✅ Report queue; remove, flag a route unsafe, or suspend a user. Weekly-active-participants metric |
| Privacy | ✅ Private profiles, an optional privacy zone that trims the first/last 200–500 m of a published route, and a home location stored only to ~1 km |

### Not built yet

- Apple sign-in
- Real payments for premium (paid events already use Midtrans; premium could reuse it)
- Automatic payouts to paid-event organizers (paid totals are shown; payout is manual)
- Email notifications and Web Push; notifications are in-app only (password-reset email is supported)
- Photo upload in chat and event covers (cover is a URL field)
- Map rotation (Leaflet supports zoom and pan only; MapLibre GL would add rotation)
- Phase 2/3 items: follows, feed, leaderboards, Strava/Garmin, AI recommendations

## Architecture

```
server/            Express 5 API (ES modules)
  src/app.js       app factory; providers are injectable for tests
  src/db.js        Postgres schema and the small async query layer (pg / PGlite)
  src/migrate-sqlite.js  one-time copy of an old SQLite database into Postgres
  src/geo.js       haversine, bounding boxes, privacy trimming
  src/gpx.js       GPX parsing and route statistics
  src/weather.js   Open-Meteo client and route weather
  src/places.js    Overpass client with a local fallback
  src/notify.js    notifications and nearby-event fan-out
  src/realtime.js  server-sent events hub
  src/payments.js  Midtrans client, signature check, status mapping
  src/eventPayments.js  paid-event registration and payment state
  src/api/         routers: account, routes, activities, community (+events), payments, misc
  src/seed.js      demo data
  src/seed-tracks.json  demo route tracks along real roads and trails
  scripts/build-seed-tracks.js  rebuilds them from OpenStreetMap routing (run only when demo routes change)
  test/            node:test suites
web/               React 19 + Vite + React Router + Leaflet
  src/pages/       one file per screen
  src/components/  map, elevation chart, chat, weather, conditions, places…
```

**Database.** PostgreSQL, as the PRD specifies. Locally and in tests the same schema runs in PGlite, so `npm run dev` and `npm test` still need no database server. Queries are plain SQL with `?` placeholders through `db.prepare(sql).get/all/run`, all async. Geo queries prefilter with a bounding box and then filter by exact distance in JavaScript (`geo.js`); PostGIS can take that over later without changing the tables, which follow the PRD's entities (§44). Timestamps are stored as ISO-8601 text.

**Realtime.** Clients send with plain POSTs and receive chat messages and notifications over a single SSE stream per tab (`/api/stream`). This works behind most proxies without WebSocket configuration. A multi-server deployment would need a shared pub/sub (for example Redis) behind `realtime.js`.

**Security.** Passwords use scrypt. Sessions are random tokens in an httpOnly, SameSite=Lax cookie. API writes must be JSON or multipart. Login, registration and reset are rate-limited, and so are condition reports. Every input is validated server-side.

## Tests

```bash
npm test
```

The 44 tests cover GPX parsing and statistics, weather time-zone handling and alerts, and API flows: auth, routes and privacy trimming, activities (limits, private requests, chat access), condition reports and warnings, check-in geofence and time window, SOS, live chat over SSE, the premium gate, nearby-event targeting and frequency limits, search, and moderation. External services are stubbed, so the suite runs offline.
