// Builds server/src/seed-tracks.json: the demo routes as real tracks that
// follow roads and paths, so they line up with the map tiles.
//
// Each route is a list of via points. OSRM (routing.openstreetmap.de, bike or
// foot profile on OpenStreetMap data) joins them along the road network, and
// Open-Meteo's elevation API adds heights. Run it only when the demo routes
// change; the seed itself reads the JSON and never calls the network.
//
//   node server/scripts/build-seed-tracks.js

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compactPoints, simplify } from '../src/gpx.js';

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'seed-tracks.json');
const MAX_POINTS = 1000;

// [lat, lng] via points, taken from named OpenStreetMap places. Few points
// work best: OSRM snaps each one to the nearest way, and a point beside the
// road adds a dead-end detour. Profiles: bike and foot (routing.openstreetmap.de)
// or road (car routing, which keeps a car-free-day run on the main road
// instead of cutting through side streets; check it avoids toll roads).
export const VIAS = {
  // BSD Green Office Park → Parung → Bogor → Puncak Pass (saddle).
  puncak: {
    profile: 'bike',
    via: [[-6.30177, 106.65116], [-6.42430, 106.73250], [-6.59550, 106.79750], [-6.70501, 106.99400]],
  },
  // Sentul City roundabout → Bukit Pelangi (Rainbow Hills) gate and back.
  sentul: {
    profile: 'bike',
    via: [[-6.56483, 106.86075], [-6.60959, 106.87556], [-6.56483, 106.86075]],
  },
  // GBK Gate 5 South → Bundaran HI along Jl. Sudirman and back.
  sudirman: {
    profile: 'road',
    via: [[-6.22342, 106.80384], [-6.19499, 106.82307], [-6.22342, 106.80384]],
  },
  // Around Green Office Park and the BSD Grand Boulevard.
  bsdrun: {
    profile: 'foot',
    via: [[-6.30177, 106.65116], [-6.29982, 106.66379], [-6.30750, 106.66350], [-6.30177, 106.65116]],
  },
  // Gunung Pancar hot springs → summit and back.
  pancar: {
    profile: 'foot',
    via: [[-6.58259, 106.90680], [-6.59167, 106.91194], [-6.58259, 106.90680]],
  },
  // Leuwi Asih → the Leuwi Hejo / Leuwi Barong pools.
  leuwihejo: {
    profile: 'foot',
    via: [[-6.58966, 106.93206], [-6.59502, 106.95470]],
  },
  // Sentul City → Babakan Madang villages → Bukit Pelangi → back.
  gravel: {
    profile: 'bike',
    via: [[-6.56483, 106.86075], [-6.58966, 106.93206], [-6.60081, 106.90645], [-6.60959, 106.87556], [-6.56483, 106.86075]],
  },
  // Gunung Pancar → Pondok Pemburu camp and back.
  mtb: {
    profile: 'bike',
    via: [[-6.58259, 106.90680], [-6.62530, 106.93071], [-6.58259, 106.90680]],
  },
};

const OSRM = {
  bike: 'https://routing.openstreetmap.de/routed-bike/route/v1/bike',
  foot: 'https://routing.openstreetmap.de/routed-foot/route/v1/foot',
  road: 'https://router.project-osrm.org/route/v1/driving',
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getJson(url, tries = 4) {
  for (let i = 0; ; i++) {
    const res = await fetch(url, { headers: { 'user-agent': 'roamr-seed-builder' } });
    if (res.ok) return res.json();
    if (i >= tries - 1) throw new Error(`${res.status} from ${url}`);
    await sleep(res.status === 429 ? 61000 : 1500 * (i + 1));
  }
}

async function routeLine(profile, via) {
  const coords = via.map(([lat, lng]) => `${lng},${lat}`).join(';');
  const url = `${OSRM[profile]}/${coords}?overview=full&geometries=geojson`;
  const data = await getJson(url);
  if (data.code !== 'Ok') throw new Error(`OSRM: ${data.code} ${data.message ?? ''}`);
  return data.routes[0].geometry.coordinates.map(([lng, lat]) => [lat, lng, null]);
}

// Looks up at most ELEVATION_SAMPLES heights (the API is rate limited) and
// interpolates the points in between.
const ELEVATION_SAMPLES = 200;

async function addElevation(points) {
  const step = Math.max(1, Math.ceil(points.length / ELEVATION_SAMPLES));
  const idx = [];
  for (let i = 0; i < points.length; i += step) idx.push(i);
  if (idx.at(-1) !== points.length - 1) idx.push(points.length - 1);
  for (let i = 0; i < idx.length; i += 100) {
    const batch = idx.slice(i, i + 100).map((k) => points[k]);
    const lat = batch.map((p) => p[0].toFixed(5)).join(',');
    const lng = batch.map((p) => p[1].toFixed(5)).join(',');
    const { elevation } = await getJson(`https://api.open-meteo.com/v1/elevation?latitude=${lat}&longitude=${lng}`);
    batch.forEach((p, j) => (p[2] = elevation[j]));
    await sleep(1000);
  }
  // The elevation model includes buildings and tree tops; a short moving
  // average keeps a flat city run from showing 100 m of climbing.
  const raw = idx.map((k) => points[k][2]);
  idx.forEach((k, s) => {
    const win = raw.slice(Math.max(0, s - 2), s + 3);
    points[k][2] = win.reduce((a, b) => a + b, 0) / win.length;
  });
  for (let s = 0; s < idx.length - 1; s++) {
    const [a, b] = [idx[s], idx[s + 1]];
    for (let k = a + 1; k < b; k++) {
      points[k][2] = points[a][2] + ((points[b][2] - points[a][2]) * (k - a)) / (b - a);
    }
  }
  return points;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const only = process.argv.slice(2);
  const out = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : {};
  for (const [key, { profile, via }] of Object.entries(VIAS)) {
    if (only.length && !only.includes(key)) continue;
    const line = simplify(await routeLine(profile, via), MAX_POINTS);
    out[key] = compactPoints(await addElevation(line));
    console.log(`${key}: ${out[key].length} points`);
    fs.writeFileSync(OUT, JSON.stringify(out) + '\n');
  }
  console.log(`Wrote ${OUT}`);
}
