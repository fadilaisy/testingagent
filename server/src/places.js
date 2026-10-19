import { boundingBox, haversine } from './geo.js';

// Nearby places (PRD §18-19). Tries OpenStreetMap's Overpass API first and
// falls back to the local `places` table (seeded demo data or merchant
// partners) when Overpass is unreachable.

export const PLACE_CATEGORIES = {
  coffee: { label: 'Coffee', emoji: '☕' },
  food: { label: 'Food', emoji: '🍜' },
  bakery: { label: 'Bakery', emoji: '🥐' },
  bike_shop: { label: 'Bike shop', emoji: '🔧' },
  convenience: { label: 'Convenience store', emoji: '🛒' },
  parking: { label: 'Parking', emoji: '🅿️' },
  rest_area: { label: 'Rest area', emoji: '🛑' },
  recovery: { label: 'Shower / Recovery', emoji: '🚿' },
};

function categorize(tags = {}) {
  if (tags.amenity === 'cafe') return 'coffee';
  if (['restaurant', 'fast_food', 'food_court'].includes(tags.amenity)) return 'food';
  if (tags.shop === 'bakery') return 'bakery';
  if (tags.shop === 'bicycle') return 'bike_shop';
  if (['convenience', 'supermarket'].includes(tags.shop)) return 'convenience';
  if (tags.amenity === 'parking') return 'parking';
  if (['rest_area', 'services'].includes(tags.highway)) return 'rest_area';
  if (tags.amenity === 'shower' || tags.leisure === 'fitness_centre') return 'recovery';
  return null;
}

// Categories that matter more for a given activity, used to break ties.
const ACTIVITY_BOOST = {
  road_cycling: ['coffee', 'bike_shop'],
  gravel: ['coffee', 'bike_shop'],
  mtb: ['bike_shop', 'food'],
  running: ['coffee', 'convenience'],
  trail_running: ['food', 'convenience'],
  hiking: ['food', 'rest_area'],
};

const CACHE_MS = 24 * 60 * 60 * 1000;

export function createPlacesProvider({ db, fetchImpl = fetch, overpassUrl = 'https://overpass-api.de/api/interpreter' }) {
  const cache = new Map();

  async function fromOverpass(lat, lng, radiusM) {
    const around = `(around:${radiusM},${lat.toFixed(5)},${lng.toFixed(5)})`;
    const query = `[out:json][timeout:10];(
      nwr${around}[amenity~"^(cafe|restaurant|fast_food|food_court|parking|shower)$"][name];
      nwr${around}[shop~"^(bakery|bicycle|convenience|supermarket)$"][name];
      nwr${around}[highway~"^(rest_area|services)$"];
      nwr${around}[leisure=fitness_centre][name];
    );out center 120;`;
    const res = await fetchImpl(overpassUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ data: query }),
      signal: AbortSignal.timeout(12000),
    });
    if (!res.ok) throw new Error(`Overpass responded ${res.status}`);
    const body = await res.json();
    return (body.elements ?? [])
      .map((el) => {
        const category = categorize(el.tags);
        const pLat = el.lat ?? el.center?.lat;
        const pLng = el.lon ?? el.center?.lon;
        if (!category || pLat == null || pLng == null) return null;
        return {
          id: `osm-${el.type}-${el.id}`,
          name: el.tags?.name ?? PLACE_CATEGORIES[category].label,
          category,
          lat: pLat,
          lng: pLng,
          address: [el.tags?.['addr:street'], el.tags?.['addr:housenumber']].filter(Boolean).join(' ') || null,
          openingHours: el.tags?.opening_hours ?? null,
          rating: null,
          cyclistFriendly: false,
        };
      })
      .filter(Boolean);
  }

  function fromLocal(lat, lng, radiusM) {
    const b = boundingBox(lat, lng, radiusM);
    return db
      .prepare('SELECT * FROM places WHERE lat BETWEEN ? AND ? AND lng BETWEEN ? AND ?')
      .all(b.minLat, b.maxLat, b.minLng, b.maxLng)
      .map((p) => ({
        id: `local-${p.id}`,
        name: p.name,
        category: p.category,
        lat: p.lat,
        lng: p.lng,
        address: p.address,
        openingHours: p.opening_hours,
        rating: p.rating,
        cyclistFriendly: Boolean(p.cyclist_friendly),
      }));
  }

  async function nearby({ lat, lng, radiusM = 1500, activityType, categories }) {
    const key = `${lat.toFixed(3)},${lng.toFixed(3)},${radiusM}`;
    let source = 'openstreetmap';
    let list;
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < CACHE_MS) {
      ({ list, source } = hit);
    } else {
      try {
        list = await fromOverpass(lat, lng, radiusM);
        cache.set(key, { at: Date.now(), list, source });
      } catch {
        source = 'local';
        list = fromLocal(lat, lng, radiusM);
      }
    }

    const boost = ACTIVITY_BOOST[activityType] ?? [];
    return {
      source,
      places: list
        .filter((p) => !categories?.length || categories.includes(p.category))
        .map((p) => ({ ...p, distanceM: Math.round(haversine(lat, lng, p.lat, p.lng)) }))
        .filter((p) => p.distanceM <= radiusM)
        .map((p) => ({
          ...p,
          // Lower is better: distance, minus a bonus for activity-relevant
          // categories, cyclist-friendly partners and good ratings.
          score:
            p.distanceM -
            (boost.includes(p.category) ? 250 : 0) -
            (p.cyclistFriendly ? 200 : 0) -
            (p.rating ? (p.rating - 3) * 100 : 0),
        }))
        .sort((a, b) => a.score - b.score)
        .slice(0, 40)
        .map(({ score, ...p }) => ({ ...p, ...PLACE_CATEGORIES[p.category] })),
    };
  }

  return { nearby };
}
