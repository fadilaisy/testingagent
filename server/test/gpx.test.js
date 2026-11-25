import assert from 'node:assert/strict';
import { test } from 'node:test';
import { estimateDifficulty, estimateDurationSeconds } from '../src/activities.js';
import { cumulativeDistances, haversine, pointAtDistance, trimEnds } from '../src/geo.js';
import { GpxError, computeStats, decodeGpx, parseGpx, simplify } from '../src/gpx.js';
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

// Distance (m) from p to segment a-b, in flat metres; fine at route scale.
function offsetFromSegment(p, a, b) {
  const k = 111320 * Math.cos((p[0] * Math.PI) / 180);
  const [px, py, ax, ay, bx, by] = [p[1] * k, p[0] * 110540, a[1] * k, a[0] * 110540, b[1] * k, b[0] * 110540];
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2)) : 0;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

test('simplify keeps hairpins on the road instead of cutting corners', () => {
  // 200 switchbacks, 100 points each, 0.005° (~550 m) wide.
  const points = Array.from({ length: 20000 }, (_, i) => {
    const leg = Math.floor(i / 100);
    const t = (i % 100) / 100;
    return [-6.6 + leg * 0.0005, 106.9 + (leg % 2 ? 1 - t : t) * 0.005, 0];
  });
  const out = simplify(points, 1500);
  assert.ok(out.length <= 1500);
  let worst = 0;
  for (const p of points) {
    let best = Infinity;
    for (let k = 1; k < out.length; k++) best = Math.min(best, offsetFromSegment(p, out[k - 1], out[k]));
    worst = Math.max(worst, best);
  }
  assert.ok(worst < 5, `line strays ${worst.toFixed(1)} m from the track`);
});

test('long rides (200k points) parse, measure and simplify quickly', () => {
  const pts = Array.from(
    { length: 200000 },
    (_, i) => `<trkpt lat="${(-6.3 + Math.sin(i / 50) * 0.001 + i * 1e-6).toFixed(6)}" lon="${(106.65 + i * 2e-6).toFixed(6)}"><ele>${100 + (i % 40)}</ele></trkpt>`,
  ).join('');
  const { points } = parseGpx(`<gpx><trk><trkseg>${pts}</trkseg></trk></gpx>`);
  const started = Date.now();
  const stats = computeStats(points);
  const out = simplify(points);
  assert.equal(points.length, 200000);
  assert.ok(stats.distanceM > 40000 && stats.maxElevation === 139);
  assert.ok(out.length <= 1500);
  assert.ok(Date.now() - started < 3000, 'took too long');
});

test('ignores 0,0 points written before the GPS had a fix', () => {
  const pt = (lat, lng) => `<trkpt lat="${lat}" lon="${lng}"/>`;
  const { points } = parseGpx(`<gpx><trk><trkseg>${pt(0, 0)}${pt(-6.2, 106.8)}${pt(0, 0)}${pt(-6.201, 106.801)}</trkseg></trk></gpx>`);
  assert.equal(points.length, 2);
  assert.ok(computeStats(points).distanceM < 200);
});

test('reads UTF-8 with a BOM and UTF-16 files', () => {
  const gpx = gpxTrack({ points: 4, name: 'Café Loop' });
  const utf16le = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(gpx, 'utf16le')]);
  const utf16be = Buffer.concat([Buffer.from([0xfe, 0xff]), Buffer.from(gpx, 'utf16le').swap16()]);
  const bom = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(gpx)]);
  for (const buf of [utf16le, utf16be, bom]) {
    const { name, points } = parseGpx(decodeGpx(buf));
    assert.equal(name, 'Café Loop');
    assert.equal(points.length, 4);
  }
});

test('reads Strava/Garmin style files with namespaces, extensions and CDATA names', () => {
  const gpx = `<?xml version="1.0" encoding="UTF-8"?>
<gpx creator="StravaGPX" version="1.1" xmlns="http://www.topografix.com/GPX/1/1" xmlns:gpxtpx="http://www.garmin.com/xmlschemas/TrackPointExtension/v1">
 <metadata><time>2026-11-01T22:00:00Z</time></metadata>
 <trk><name><![CDATA[Morning Ride & Coffee]]></name><type>cycling</type>
  <trkseg>
   <trkpt lat="-6.3000000" lon="106.6500000"><ele>40.2</ele><time>2026-11-01T22:00:00Z</time><extensions><gpxtpx:TrackPointExtension><gpxtpx:hr>120</gpxtpx:hr></gpxtpx:TrackPointExtension></extensions></trkpt>
   <trkpt lat="-6.3010000" lon="106.6510000"><ele>41.0</ele><time>2026-11-01T22:00:05Z</time></trkpt>
  </trkseg>
  <trkseg>
   <trkpt lat="-6.3020000" lon="106.6520000"><ele>42.4</ele></trkpt>
  </trkseg>
 </trk>
</gpx>`;
  const { name, points } = parseGpx(gpx);
  assert.equal(name, 'Morning Ride & Coffee');
  assert.deepEqual(points, [[-6.3, 106.65, 40.2], [-6.301, 106.651, 41], [-6.302, 106.652, 42.4]]);
});

test('explains TCX and KML uploads instead of a generic error', () => {
  assert.throws(() => parseGpx('<?xml version="1.0"?><TrainingCenterDatabase/>'), /TCX file/);
  assert.throws(() => parseGpx('<?xml version="1.0"?><kml xmlns="http://www.opengis.net/kml/2.2"/>'), /KML file/);
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
