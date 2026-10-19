import { XMLParser } from 'fast-xml-parser';
import { cumulativeDistances, haversine, isValidLatLng } from './geo.js';

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

function toPoint(pt) {
  const lat = Number(pt.lat);
  const lng = Number(pt.lon);
  if (!isValidLatLng(lat, lng)) return null;
  const ele = pt.ele != null && pt.ele !== '' ? Number(pt.ele) : null;
  return [lat, lng, Number.isFinite(ele) ? ele : null];
}

// Parses GPX text into a list of [lat, lng, ele|null] points, preferring track
// points, then route points, then waypoints.
export function parseGpx(text) {
  if (typeof text !== 'string' || !text.includes('<gpx')) {
    throw new GpxError('File is not a GPX document');
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

  const elevations = points.map((p) => p[2]).filter((e) => e != null);
  const hasElevation = elevations.length >= points.length * 0.5;
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
    maxEle = Math.max(...elevations);
    minEle = Math.min(...elevations);
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
      minLat: Math.min(...lats),
      maxLat: Math.max(...lats),
      minLng: Math.min(...lngs),
      maxLng: Math.max(...lngs),
    },
  };
}

// Reduces a dense track to at most MAX_STORED_POINTS for storage and maps,
// always keeping the first and last point.
export function simplify(points, maxPoints = MAX_STORED_POINTS) {
  if (points.length <= maxPoints) return points;
  const total = cumulativeDistances(points).at(-1);
  const step = total / (maxPoints - 1);
  const out = [points[0]];
  let since = 0;
  for (let i = 1; i < points.length - 1; i++) {
    since += haversine(points[i - 1][0], points[i - 1][1], points[i][0], points[i][1]);
    if (since >= step) {
      out.push(points[i]);
      since = 0;
    }
  }
  out.push(points.at(-1));
  return out;
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
<gpx version="1.1" creator="Jalur" xmlns="http://www.topografix.com/GPX/1/1">
  <trk>
    <name>${esc(name)}</name>
    <trkseg>
${pts}
    </trkseg>
  </trk>
</gpx>
`;
}
