import { createApp } from '../src/app.js';
import { openDb } from '../src/db.js';
import { createPlacesProvider } from '../src/places.js';

// Weather stub: every location reports the same hourly forecast, with rain
// likely in the hours listed in `rainyHoursUtc`.
export function fakeWeather({ rainyHoursUtc = [] } = {}) {
  return {
    async forecast(points) {
      const start = new Date();
      start.setUTCMinutes(0, 0, 0);
      const hourly = Array.from({ length: 7 * 24 }, (_, i) => {
        const t = new Date(start.getTime() + i * 3600e3);
        const rainy = rainyHoursUtc.includes(t.getUTCHours());
        return { time: t.toISOString(), temp: 24, precipProb: rainy ? 80 : 10, code: rainy ? 63 : 1, wind: 8, humidity: 70 };
      });
      return points.map(() => ({
        timezone: 'Asia/Jakarta',
        current: { temp: 25, humidity: 70, wind: 6, code: 1, precipProb: 10 },
        hourly,
        daily: [],
      }));
    },
  };
}

export async function startTestApp({ demoMode = true } = {}) {
  const db = openDb(':memory:');
  const offlineFetch = async () => {
    throw new Error('offline');
  };
  const app = createApp({
    db,
    config: { demoMode, authRateLimit: 1000 },
    weather: fakeWeather({ rainyHoursUtc: [0, 1] }),
    places: createPlacesProvider({ db, fetchImpl: offlineFetch }),
  });
  const server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const base = `http://127.0.0.1:${server.address().port}`;

  // A client keeps its own session cookie, like a separate browser.
  function client() {
    let cookie = '';
    async function request(method, path, body, { raw = false } = {}) {
      const headers = {};
      if (cookie) headers.cookie = cookie;
      let payload;
      if (body instanceof FormData) payload = body;
      else if (body !== undefined) {
        headers['content-type'] = 'application/json';
        payload = JSON.stringify(body);
      }
      const res = await fetch(base + path, { method, headers, body: payload });
      const set = res.headers.get('set-cookie');
      if (set) cookie = set.split(';')[0];
      if (raw) return res;
      const text = await res.text();
      let json = null;
      try {
        json = text ? JSON.parse(text) : null;
      } catch {
        json = { text };
      }
      return { status: res.status, body: json };
    }
    return {
      get: (p, o) => request('GET', p, undefined, o),
      post: (p, b, o) => request('POST', p, b, o),
      patch: (p, b) => request('PATCH', p, b),
      del: (p) => request('DELETE', p),
      cookie: () => cookie,
    };
  }

  async function signup(name, extra = {}) {
    const c = client();
    const email = `${name.toLowerCase().replace(/[^a-z0-9]+/g, '')}-${Math.random().toString(36).slice(2, 8)}@test.dev`;
    const r = await c.post('/api/auth/register', { email, password: 'secret-pass', name });
    if (r.status !== 201) throw new Error(`signup failed: ${JSON.stringify(r.body)}`);
    if (Object.keys(extra).length) await c.patch('/api/me', extra);
    c.user = r.body.user;
    c.email = email;
    return c;
  }

  async function close() {
    app.locals.hub.closeAll();
    await new Promise((resolve) => server.close(resolve));
    db.close();
  }

  return { db, base, client, signup, close };
}

// A straight-ish GPX track heading north-east from `start`, with a climb.
export function gpxTrack({ start = [-6.3, 106.65], points = 60, stepDeg = 0.002, climbPerPoint = 5, name = 'Test Track', tag = 'trk' } = {}) {
  const pts = Array.from({ length: points }, (_, i) => {
    const lat = (start[0] + i * stepDeg).toFixed(6);
    const lng = (start[1] + i * stepDeg).toFixed(6);
    const ele = 100 + i * climbPerPoint;
    return tag === 'trk'
      ? `<trkpt lat="${lat}" lon="${lng}"><ele>${ele}</ele></trkpt>`
      : `<rtept lat="${lat}" lon="${lng}"><ele>${ele}</ele></rtept>`;
  }).join('');
  const body = tag === 'trk' ? `<trk><name>${name}</name><trkseg>${pts}</trkseg></trk>` : `<rte><name>${name}</name>${pts}</rte>`;
  return `<?xml version="1.0"?><gpx version="1.1" xmlns="http://www.topografix.com/GPX/1/1">${body}</gpx>`;
}

export function gpxForm(gpx, fields = {}) {
  const form = new FormData();
  form.set('gpx', new Blob([gpx], { type: 'application/gpx+xml' }), 'track.gpx');
  for (const [k, v] of Object.entries(fields)) form.set(k, String(v));
  return form;
}

export const inHours = (h) => new Date(Date.now() + h * 3600e3).toISOString();
