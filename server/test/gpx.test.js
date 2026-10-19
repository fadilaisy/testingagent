import assert from 'node:assert/strict';
import { test } from 'node:test';
import { estimateDifficulty, estimateDurationSeconds } from '../src/activities.js';
import { cumulativeDistances, haversine, pointAtDistance, trimEnds } from '../src/geo.js';
import { GpxError, computeStats, parseGpx, simplify } from '../src/gpx.js';
import { gpxTrack } from './helpers.js';

test('haversine matches known distances', () => {
  // One degree of latitude is ~111.2 km.
  assert.ok(Math.abs(haversine(0, 0, 1, 0) - 111195) < 50);
  assert.equal(haversine(-6.2, 106.8, -6.2, 106.8), 0);
});

test('parses track points with elevation and the track name', () => {
  const { name, points } = parseGpx(gpxTrack({ points: 10, name: 'Morning Loop' }));
  assert.equal(name, 'Morning Loop');
  assert.equal(points.length, 10);
  assert.deepEqual(points[0], [-6.3, 106.65, 100]);
});

test('falls back to route points when there is no track', () => {
  const { points } = parseGpx(gpxTrack({ points: 5, tag: 'rte' }));
  assert.equal(points.length, 5);
});

test('rejects files that are not usable GPX', () => {
  assert.throws(() => parseGpx('hello'), GpxError);
  assert.throws(() => parseGpx('<gpx><trk><trkseg><trkpt lat="1" lon="1"/></trkseg></trk></gpx>'), /at least two/);
  assert.throws(() => parseGpx('<gpx><trk><trkseg><trkpt lat="999" lon="1"/><trkpt lat="998" lon="1"/></trkseg></trk></gpx>'), /at least two/);
});

test('computes distance, elevation gain/loss and extremes', () => {
  const points = [
    [0, 0, 100],
    [0.001, 0, 110],
    [0.002, 0, 105],
    [0.003, 0, 130],
  ];
  const s = computeStats(points);
  assert.ok(Math.abs(s.distanceM - 334) <= 1);
  assert.equal(s.elevationGain, 35);
  assert.equal(s.elevationLoss, 5);
  assert.equal(s.maxElevation, 130);
  assert.equal(s.minElevation, 100);
});

test('ignores GPS elevation jitter below the hysteresis threshold', () => {
  const points = Array.from({ length: 50 }, (_, i) => [i * 0.0001, 0, 50 + (i % 2 ? 1 : -1)]);
  assert.equal(computeStats(points).elevationGain, 0);
});

test('reports null elevation when the track has none', () => {
  const s = computeStats([
    [0, 0, null],
    [0.01, 0, null],
  ]);
  assert.equal(s.elevationGain, null);
});

test('simplify caps point count and keeps both ends', () => {
  const points = Array.from({ length: 5000 }, (_, i) => [i * 0.00005, 0, 0]);
  const out = simplify(points, 500);
  assert.ok(out.length <= 500);
  assert.deepEqual(out[0], points[0]);
  assert.deepEqual(out.at(-1), points.at(-1));
});

test('trimEnds hides the first and last stretch of a route', () => {
  const points = Array.from({ length: 101 }, (_, i) => [i * 0.0001, 0, 0]); // ~1.1 km
  const trimmed = trimEnds(points, 200);
  const cum = cumulativeDistances(points);
  assert.ok(haversine(points[0][0], 0, trimmed[0][0], 0) >= 200);
  assert.ok(haversine(points.at(-1)[0], 0, trimmed.at(-1)[0], 0) >= 200);
  assert.ok(trimmed.length < points.length && cum.at(-1) > 1000);
});

test('pointAtDistance interpolates along the line', () => {
  const points = [
    [0, 0, 0],
    [0.01, 0, 100],
  ];
  const [lat, , ele] = pointAtDistance(points, haversine(0, 0, 0.01, 0) / 2);
  assert.ok(Math.abs(lat - 0.005) < 1e-6);
  assert.ok(Math.abs(ele - 50) < 1e-6);
});

test('difficulty and duration scale with distance and climbing', () => {
  assert.equal(estimateDifficulty('road_cycling', 30000, 100), 'easy');
  assert.equal(estimateDifficulty('road_cycling', 80000, 1200), 'hard');
  assert.equal(estimateDifficulty('running', 42195, 0), 'extreme');
  // 25 km/h for 50 km plus 800 m of climbing at 800 m/h = 3 h.
  assert.equal(estimateDurationSeconds('road_cycling', 50000, 800), 3 * 3600);
});
