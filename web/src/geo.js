const R = 6371008.8;
const rad = (d) => (d * Math.PI) / 180;

export function haversine(lat1, lng1, lat2, lng2) {
  const dLat = rad(lat2 - lat1);
  const dLng = rad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

export function cumulative(points) {
  const out = [0];
  for (let i = 1; i < points.length; i++) {
    out.push(out[i - 1] + haversine(points[i - 1][0], points[i - 1][1], points[i][0], points[i][1]));
  }
  return out;
}

// Position at `km` along the line, for placing condition reports on the map.
export function pointAtKm(points, kmValue) {
  if (!points?.length || kmValue == null) return null;
  const cum = cumulative(points);
  const target = kmValue * 1000;
  const i = cum.findIndex((d) => d >= target);
  return i === -1 ? points.at(-1) : points[i];
}
