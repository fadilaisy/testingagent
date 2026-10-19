// Geo helpers. Everything here works on plain [lat, lng] numbers so the
// same logic can later be swapped for PostGIS queries without touching callers.

const EARTH_RADIUS_M = 6371008.8;
const toRad = (deg) => (deg * Math.PI) / 180;

export function haversine(lat1, lng1, lat2, lng2) {
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(a)));
}

// Bounding box that fully contains a circle of radiusM around a point.
// Used to prefilter rows in SQL before the exact haversine check.
export function boundingBox(lat, lng, radiusM) {
  const dLat = radiusM / 111320;
  const dLng = radiusM / (111320 * Math.max(0.01, Math.cos(toRad(lat))));
  return { minLat: lat - dLat, maxLat: lat + dLat, minLng: lng - dLng, maxLng: lng + dLng };
}

// Cumulative distance (m) at each point of a [[lat, lng, ele?], ...] line.
export function cumulativeDistances(points) {
  const out = [0];
  for (let i = 1; i < points.length; i++) {
    const [aLat, aLng] = points[i - 1];
    const [bLat, bLng] = points[i];
    out.push(out[i - 1] + haversine(aLat, aLng, bLat, bLng));
  }
  return out;
}

// Point at distanceM along the line, linearly interpolated.
export function pointAtDistance(points, distanceM, cumulative = cumulativeDistances(points)) {
  if (!points.length) return null;
  if (distanceM <= 0) return points[0];
  const total = cumulative[cumulative.length - 1];
  if (distanceM >= total) return points[points.length - 1];
  let i = 1;
  while (cumulative[i] < distanceM) i++;
  const span = cumulative[i] - cumulative[i - 1] || 1;
  const t = (distanceM - cumulative[i - 1]) / span;
  const [aLat, aLng, aEle] = points[i - 1];
  const [bLat, bLng, bEle] = points[i];
  const ele = aEle != null && bEle != null ? aEle + (bEle - aEle) * t : undefined;
  return [aLat + (bLat - aLat) * t, aLng + (bLng - aLng) * t, ele];
}

// Drops the first and last trimM metres of a line so a route that starts at
// someone's home does not reveal the exact address (PRD §31 privacy radius).
export function trimEnds(points, trimM) {
  if (!trimM || points.length < 3) return points;
  const cumulative = cumulativeDistances(points);
  const total = cumulative[cumulative.length - 1];
  if (total <= trimM * 3) return points; // too short to trim meaningfully
  return points.filter((_, i) => cumulative[i] >= trimM && cumulative[i] <= total - trimM);
}

// Minimum distance from a point to any vertex of the line. Vertex distance is
// accurate enough for GPX tracks, which are densely sampled.
export function distanceToLine(lat, lng, points) {
  let best = Infinity;
  for (const [pLat, pLng] of points) {
    const d = haversine(lat, lng, pLat, pLng);
    if (d < best) best = d;
  }
  return best;
}

// Rounds coordinates for storage when only an approximate location is needed.
export function coarse(value, decimals = 2) {
  if (value == null || Number.isNaN(Number(value))) return null;
  const f = 10 ** decimals;
  return Math.round(Number(value) * f) / f;
}

export function isValidLatLng(lat, lng) {
  return (
    Number.isFinite(lat) && Number.isFinite(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180
  );
}
