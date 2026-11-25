import { XMLParser } from 'fast-xml-parser';
import { cumulativeDistances, isValidLatLng } from './geo.js';

export class GpxError extends Error {}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '',
  removeNSPrefix: true,
  parseAttributeValue: false,
  isArray: (name) => ['trk', 'trkseg', 'trkpt', 'rte', 'rtept', 'wpt'].includes(name),
});

// GPS elevation is noisy; ignore climbs/descents smaller than this between
// confirmed points so a flat ride doesn't report hundreds of metres of gain.
const ELEVATION_HYSTERESIS_M = 3;
const MAX_STORED_POINTS = 1500;
// A 10-hour ride logged every second with heart rate, cadence and power is
// around 15 MB of GPX.
export const MAX_GPX_BYTES = 25 * 1024 * 1024;

function toPoint(pt) {
  const lat = Number(pt.lat);
  const lng = Number(pt.lon);
  // 0,0 is what some devices write before they have a GPS fix; keeping it
  // would add a line to the Gulf of Guinea and thousands of kilometres.
  if (!isValidLatLng(lat, lng) || (lat === 0 && lng === 0)) return null;
  const ele = pt.ele != null && pt.ele !== '' ? Number(pt.ele) : null;
  return [lat, lng, Number.isFinite(ele) ? ele : null];
}

// Decodes an uploaded file to text. Most GPX files are UTF-8, but some
// Windows tools save UTF-16, which reads as garbage when decoded as UTF-8.
export function decodeGpx(buffer) {
  const b = Buffer.from(buffer);
  if (b[0] === 0xff && b[1] === 0xfe) return b.subarray(2).toString('utf16le');
  if (b[0] === 0xfe && b[1] === 0xff) return Buffer.from(b.subarray(2)).swap16().toString('utf16le');
  if (b.length > 1 && b[0] === 0x3c && b[1] === 0x00) return b.toString('utf16le');
  return b.toString('utf8').replace(/^﻿/, '');
}

function notGpxMessage(text) {
  const head = text.slice(0, 2000);
  if (/<TrainingCenterDatabase/i.test(head)) return 'This is a TCX file. Export the activity as GPX instead.';
  if (/<kml/i.test(head)) return 'This is a KML file. Export the route as GPX instead.';
  if (/\.FIT/.test(text.slice(8, 12))) return 'This is a FIT file. Export the activity as GPX instead.';
  return 'File is not a GPX document';
}

// Parses GPX text into a list of [lat, lng, ele|null] points, preferring track
// points, then route points, then waypoints.
export function parseGpx(text) {
  if (typeof text !== 'string' || !text.includes('<gpx')) {
    throw new GpxError(typeof text === 'string' ? notGpxMessage(text) : 'File is not a GPX document');
  }
  let doc;
  try {
    doc = parser.parse(text);
  } catch {
    throw new GpxError('GPX file could not be read');
  }
  const gpx = doc?.gpx;
  if (!gpx) throw new GpxError('GPX file has no <gpx> root element');

  const trackPoints = (gpx.trk ?? []).flatMap((trk) =>
    (trk.trkseg ?? []).flatMap((seg) => seg.trkpt ?? []),
  );
  const routePoints = (gpx.rte ?? []).flatMap((rte) => rte.rtept ?? []);
  const raw = trackPoints.length ? trackPoints : routePoints.length ? routePoints : gpx.wpt ?? [];
  const points = raw.map(toPoint).filter(Boolean);
  if (points.length < 2) throw new GpxError('GPX file needs at least two valid points');

  const name =
    (gpx.trk?.[0]?.name ?? gpx.rte?.[0]?.name ?? gpx.metadata?.name ?? '').toString().trim() || null;
  return { name, points };
}

export function computeStats(points) {
  const cumulative = cumulativeDistances(points);
  const distanceM = cumulative[cumulative.length - 1];

  // Loops rather than Math.max(...arr): spreading a long ride's 100k+
  // points overflows the call stack.
  const elevations = points.map((p) => p[2]).filter((e) => e != null);
  const hasElevation = elevations.length >= points.length * 0.5;
  const max = (arr) => arr.reduce((m, x) => (x > m ? x : m), -Infinity);
  const min = (arr) => arr.reduce((m, x) => (x < m ? x : m), Infinity);
  let gain = null;
  let loss = null;
  let maxEle = null;
  let minEle = null;
  if (hasElevation) {
    gain = 0;
    loss = 0;
    let ref = null;
    for (const p of points) {
      const e = p[2];
      if (e == null) continue;
      if (ref == null) {
        ref = e;
        continue;
      }
      const diff = e - ref;
      if (diff >= ELEVATION_HYSTERESIS_M) {
        gain += diff;
        ref = e;
      } else if (diff <= -ELEVATION_HYSTERESIS_M) {
        loss -= diff;
        ref = e;
      }
    }
    maxEle = max(elevations);
    minEle = min(elevations);
  }

  const lats = points.map((p) => p[0]);
  const lngs = points.map((p) => p[1]);
  return {
    distanceM: Math.round(distanceM),
    elevationGain: gain == null ? null : Math.round(gain),
    elevationLoss: loss == null ? null : Math.round(loss),
    maxElevation: maxEle == null ? null : Math.round(maxEle),
    minElevation: minEle == null ? null : Math.round(minEle),
    start: points[0],
    end: points[points.length - 1],
    bbox: {
      minLat: min(lats),
      maxLat: max(lats),
      minLng: min(lngs),
      maxLng: max(lngs),
    },
  };
}

// Reduces a dense track to at most maxPoints for storage and maps, keeping
// the points that matter for its shape (Douglas–Peucker): bends and hairpins
// keep their points and straight stretches lose theirs, so the line stays on
// the road instead of cutting corners. First and last point are always kept.
export function simplify(points, maxPoints = MAX_STORED_POINTS) {
  const n = points.length;
  if (n <= maxPoints) return points;

  // Flat metre coordinates around the track's start; plenty accurate at the
  // scale of one route.
  const lat0 = points[0][0];
  const kx = 111320 * Math.cos((lat0 * Math.PI) / 180);
  const ky = 110540;
  const xs = new Float64Array(n);
  const ys = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    xs[i] = (points[i][1] - points[0][1]) * kx;
    ys[i] = (points[i][0] - lat0) * ky;
  }
  const offset = (i, a, b) => {
    const dx = xs[b] - xs[a];
    const dy = ys[b] - ys[a];
    const len2 = dx * dx + dy * dy;
    let t = len2 ? ((xs[i] - xs[a]) * dx + (ys[i] - ys[a]) * dy) / len2 : 0;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(xs[i] - (xs[a] + t * dx), ys[i] - (ys[a] + t * dy));
  };

  // Each point's importance is how far the line would move without it,
  // capped by its parent's so a point never outranks the one it hangs off.
  // The track is split into chunks first: on one long winding track a single
  // pass degrades to quadratic time (seconds for a long ride).
  const importance = new Float64Array(n);
  importance[0] = importance[n - 1] = Infinity;
  const chunk = Math.max(1000, Math.ceil(n / (maxPoints / 4)));
  const stack = [];
  for (let a = 0; a < n - 1; a += chunk) {
    const b = Math.min(a + chunk, n - 1);
    if (b < n - 1) importance[b] = 1e9;
    stack.push([a, b, 1e9]);
  }
  while (stack.length) {
    const [a, b, cap] = stack.pop();
    let best = -1;
    let bestD = -1;
    for (let i = a + 1; i < b; i++) {
      const d = offset(i, a, b);
      if (d > bestD) {
        bestD = d;
        best = i;
      }
    }
    // Below half a metre nothing would show on a map; stop splitting so a
    // smooth 100k-point track doesn't take seconds.
    if (best < 0 || bestD < 0.5) continue;
    const d = Math.min(bestD, cap);
    importance[best] = d;
    stack.push([a, best, d], [best, b, d]);
  }

  const keep = Array.from({ length: n }, (_, i) => i)
    .sort((a, b) => importance[b] - importance[a])
    .slice(0, maxPoints)
    .sort((a, b) => a - b);
  return keep.map((i) => points[i]);
}

// Rounds coordinates to ~1 m and elevation to 0.1 m to keep stored JSON small.
export function compactPoints(points) {
  return points.map(([lat, lng, ele]) => [
    Math.round(lat * 1e5) / 1e5,
    Math.round(lng * 1e5) / 1e5,
    ele == null ? null : Math.round(ele * 10) / 10,
  ]);
}

export function toGpx(name, points) {
  const esc = (s) => String(s).replace(/[<>&"']/g, (c) => `&#${c.charCodeAt(0)};`);
  const pts = points
    .map(([lat, lng, ele]) =>
      ele == null
        ? `      <trkpt lat="${lat}" lon="${lng}"/>`
        : `      <trkpt lat="${lat}" lon="${lng}"><ele>${ele}</ele></trkpt>`,
    )
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="ROAMR" xmlns="http://www.topografix.com/GPX/1/1">
  <trk>
    <name>${esc(name)}</name>
    <trkseg>
${pts}
    </trkseg>
  </trk>
</gpx>
`;
}
