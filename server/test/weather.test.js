import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createWeatherProvider, routeWeather, weatherSamplePoints } from '../src/weather.js';

// Builds an Open-Meteo style response in local time (UTC+7).
function openMeteoBody(rainLocalHour) {
  const base = new Date();
  base.setUTCHours(0, 0, 0, 0);
  const time = [];
  const precip = [];
  const code = [];
  for (let i = 0; i < 72; i++) {
    const local = new Date(base.getTime() + i * 3600e3 + 7 * 3600e3);
    time.push(local.toISOString().slice(0, 16));
    const rainy = local.getUTCHours() === rainLocalHour;
    precip.push(rainy ? 85 : 5);
    code.push(rainy ? 63 : 2);
  }
  return {
    timezone: 'Asia/Jakarta',
    utc_offset_seconds: 7 * 3600,
    current: { temperature_2m: 27, relative_humidity_2m: 75, wind_speed_10m: 9, weather_code: 2 },
    hourly: {
      time,
      temperature_2m: time.map(() => 24),
      precipitation_probability: precip,
      weather_code: code,
      wind_speed_10m: time.map(() => 8),
      relative_humidity_2m: time.map(() => 70),
    },
    daily: { time: [time[0].slice(0, 10)], weather_code: [63], temperature_2m_max: [31], temperature_2m_min: [22], precipitation_probability_max: [85] },
  };
}

const line = Array.from({ length: 200 }, (_, i) => [-6.3 + i * 0.003, 106.65 + i * 0.003, 100]);

test('samples start, intermediate points and finish', () => {
  const samples = weatherSamplePoints(line, 80000);
  assert.equal(samples[0].label, 'Start');
  assert.equal(samples.at(-1).label, 'Finish');
  assert.equal(samples.length, 5);
  assert.equal(weatherSamplePoints(line, 10000).length, 2);
});

test('converts local forecast times to UTC and raises a rain alert at the right point', async () => {
  let calls = 0;
  const provider = createWeatherProvider({
    fetchImpl: async (url) => {
      calls++;
      assert.match(url, /latitude=/);
      const n = new URL(url).searchParams.get('latitude').split(',').length;
      const body = Array.from({ length: n }, () => openMeteoBody(8));
      return { ok: true, json: async () => (n === 1 ? body[0] : body) };
    },
  });

  // Start tomorrow 06:00 WIB (23:00 UTC today); ~4h ride means the finish
  // is reached around 10:00 WIB and the 08:00 WIB rain hits mid-route.
  const start = new Date();
  start.setUTCHours(23, 0, 0, 0);
  const w = await routeWeather(provider, { points: line, distanceM: 80000, estDurationS: 4 * 3600, startsAt: start.toISOString() });
  assert.equal(w.current.temp, 27);
  assert.equal(w.points[0].eta, start.toISOString());
  const rainy = w.points.filter((p) => p.precipProb === 85);
  assert.equal(rainy.length, 1);
  assert.equal(rainy[0].eta, new Date(start.getTime() + 2 * 3600e3).toISOString());
  assert.equal(w.alerts.length, 1);
  assert.equal(w.alerts[0].level, 'warning');

  // Second call with the same points is served from cache.
  await routeWeather(provider, { points: line, distanceM: 80000, estDurationS: 4 * 3600, startsAt: start.toISOString() });
  assert.equal(calls, 1);
});

test('marks points beyond the forecast window as unavailable', async () => {
  const provider = createWeatherProvider({
    fetchImpl: async () => ({ ok: true, json: async () => [openMeteoBody(8), openMeteoBody(8)] }),
  });
  const farFuture = new Date(Date.now() + 20 * 864e5).toISOString();
  const w = await routeWeather(provider, { points: line.slice(0, 20), distanceM: 10000, estDurationS: 3600, startsAt: farFuture });
  assert.equal(w.beyondForecast, true);
  assert.equal(w.points[0].available, false);
});

test('surfaces HTTP errors from the weather service', async () => {
  const provider = createWeatherProvider({ fetchImpl: async () => ({ ok: false, status: 500 }) });
  await assert.rejects(provider.forecast([{ lat: 1, lng: 1 }]), /500/);
});
