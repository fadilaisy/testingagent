import { cumulativeDistances, pointAtDistance } from './geo.js';

// Weather via Open-Meteo (free, no API key). The provider is created with an
// injectable fetch so tests can run offline.

const WMO = {
  0: ['Clear', '☀️'],
  1: ['Mostly clear', '🌤'],
  2: ['Partly cloudy', '⛅'],
  3: ['Cloudy', '☁️'],
  45: ['Fog', '🌫'],
  48: ['Fog', '🌫'],
  51: ['Light drizzle', '🌦'],
  53: ['Drizzle', '🌦'],
  55: ['Heavy drizzle', '🌧'],
  61: ['Light rain', '🌦'],
  63: ['Rain', '🌧'],
  65: ['Heavy rain', '🌧'],
  80: ['Rain showers', '🌦'],
  81: ['Rain showers', '🌧'],
  82: ['Violent showers', '⛈'],
  95: ['Thunderstorm', '⛈'],
  96: ['Thunderstorm with hail', '⛈'],
  99: ['Thunderstorm with hail', '⛈'],
};

export function describeWeatherCode(code) {
  const [label, emoji] = WMO[code] ?? ['Unknown', '❔'];
  return { label, emoji };
}

const SEVERE_CODES = new Set([65, 82, 95, 96, 99]);
const RAIN_ALERT_PROBABILITY = 60;
const CACHE_MS = 30 * 60 * 1000;

export function createWeatherProvider({ fetchImpl = fetch, baseUrl = 'https://api.open-meteo.com/v1/forecast' } = {}) {
  const cache = new Map();

  async function forecast(points) {
    const key = points.map((p) => `${p.lat.toFixed(2)},${p.lng.toFixed(2)}`).join('|');
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < CACHE_MS) return hit.data;

    const params = new URLSearchParams({
      latitude: points.map((p) => p.lat.toFixed(4)).join(','),
      longitude: points.map((p) => p.lng.toFixed(4)).join(','),
      current: 'temperature_2m,relative_humidity_2m,wind_speed_10m,weather_code',
      hourly: 'temperature_2m,precipitation_probability,weather_code,wind_speed_10m,relative_humidity_2m',
      daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max',
      timezone: 'auto',
      forecast_days: '7',
    });
    const res = await fetchImpl(`${baseUrl}?${params}`, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error(`Weather service responded ${res.status}`);
    const body = await res.json();
    const list = Array.isArray(body) ? body : [body];
    const data = list.map(normalizeLocation);
    cache.set(key, { at: Date.now(), data });
    return data;
  }

  return { forecast };
}

// Open-Meteo returns local wall-clock times plus a UTC offset; convert every
// timestamp to UTC epoch ms so it can be compared with activity start times.
function normalizeLocation(loc) {
  const offsetMs = (loc.utc_offset_seconds ?? 0) * 1000;
  const toUtc = (t) => Date.parse(`${t}${t.length === 10 ? 'T00:00' : ''}Z`) - offsetMs;
  const h = loc.hourly ?? {};
  const hourly = (h.time ?? []).map((t, i) => ({
    time: new Date(toUtc(t)).toISOString(),
    temp: h.temperature_2m?.[i] ?? null,
    precipProb: h.precipitation_probability?.[i] ?? null,
    code: h.weather_code?.[i] ?? null,
    wind: h.wind_speed_10m?.[i] ?? null,
    humidity: h.relative_humidity_2m?.[i] ?? null,
  }));
  const d = loc.daily ?? {};
  const daily = (d.time ?? []).map((t, i) => ({
    date: t,
    code: d.weather_code?.[i] ?? null,
    max: d.temperature_2m_max?.[i] ?? null,
    min: d.temperature_2m_min?.[i] ?? null,
    precipProb: d.precipitation_probability_max?.[i] ?? null,
  }));
  const c = loc.current ?? {};
  const nowHour = closestHour(hourly, Date.now());
  return {
    timezone: loc.timezone ?? null,
    current: {
      temp: c.temperature_2m ?? null,
      humidity: c.relative_humidity_2m ?? null,
      wind: c.wind_speed_10m ?? null,
      code: c.weather_code ?? null,
      precipProb: nowHour?.precipProb ?? null,
    },
    hourly,
    daily,
  };
}

function closestHour(hourly, atMs) {
  let best = null;
  let bestDiff = Infinity;
  for (const h of hourly) {
    const diff = Math.abs(Date.parse(h.time) - atMs);
    if (diff < bestDiff) {
      best = h;
      bestDiff = diff;
    }
  }
  return bestDiff <= 90 * 60 * 1000 ? best : null;
}

// Picks up to five sample points along a route: start, evenly spaced
// intermediate points roughly every 25 km, and finish (PRD §17).
export function weatherSamplePoints(points, distanceM) {
  const cumulative = cumulativeDistances(points);
  const intermediates = Math.min(3, Math.floor(distanceM / 25000));
  const fractions = [0];
  for (let i = 1; i <= intermediates; i++) fractions.push(i / (intermediates + 1));
  fractions.push(1);
  return fractions.map((f) => {
    const [lat, lng] = pointAtDistance(points, f * distanceM, cumulative);
    const km = Math.round((f * distanceM) / 100) / 10;
    const label = f === 0 ? 'Start' : f === 1 ? 'Finish' : `KM ${Math.round(km)}`;
    return { lat, lng, km, fraction: f, label };
  });
}

// Builds the route weather panel. With startsAt, each point shows the forecast
// for the estimated time the group reaches it; otherwise the current hour.
export async function routeWeather(provider, { points, distanceM, estDurationS, startsAt }) {
  const samples = weatherSamplePoints(points, distanceM);
  const forecasts = await provider.forecast(samples);
  const startMs = startsAt ? Date.parse(startsAt) : null;

  const rows = samples.map((s, i) => {
    const f = forecasts[i];
    const etaMs = startMs != null ? startMs + s.fraction * estDurationS * 1000 : null;
    const hour = etaMs != null ? closestHour(f.hourly, etaMs) : null;
    const src = hour ?? (etaMs == null ? f.current : null);
    const described = src?.code != null ? describeWeatherCode(src.code) : { label: null, emoji: null };
    return {
      name: s.label,
      km: s.km,
      lat: s.lat,
      lng: s.lng,
      eta: etaMs != null ? new Date(etaMs).toISOString() : null,
      available: Boolean(src),
      temp: src?.temp ?? null,
      precipProb: src?.precipProb ?? null,
      wind: src?.wind ?? null,
      humidity: src?.humidity ?? null,
      code: src?.code ?? null,
      condition: described.label,
      emoji: described.emoji,
    };
  });

  // Alerts carry the ETA separately so the client can format it in local time.
  const alerts = [];
  for (const r of rows) {
    if (!r.available) continue;
    if (SEVERE_CODES.has(r.code)) {
      alerts.push({ level: 'danger', km: r.km, eta: r.eta, message: `${r.condition} expected at ${r.name}` });
    } else if ((r.precipProb ?? 0) >= RAIN_ALERT_PROBABILITY) {
      alerts.push({ level: 'warning', km: r.km, eta: r.eta, message: `Rain likely (${r.precipProb}%) at ${r.name}` });
    }
  }

  const start = forecasts[0];
  const currentDesc = describeWeatherCode(start.current.code);
  return {
    timezone: start.timezone,
    current: { ...start.current, condition: currentDesc.label, emoji: currentDesc.emoji },
    daily: start.daily.map((d) => {
      const desc = describeWeatherCode(d.code);
      return { ...d, condition: desc.label, emoji: desc.emoji };
    }),
    points: rows,
    alerts,
    // True when the activity is further out than the 7-day forecast window.
    beyondForecast: startMs != null && rows.some((r) => !r.available),
  };
}
