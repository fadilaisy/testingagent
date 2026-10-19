// Demo data so a fresh install shows the full loop: routes, people planning
// activities, group chat, track conditions, communities and events.
// Routes are synthetic tracks drawn through real place coordinates around
// Jakarta, Bogor, Sentul and Puncak; places and people are fictional.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { estimateDifficulty, estimateDurationSeconds } from './activities.js';
import { hashPassword } from './auth.js';
import { openDb, transaction } from './db.js';
import { haversine } from './geo.js';
import { compactPoints, computeStats, simplify, toGpx } from './gpx.js';

export const DEMO_PASSWORD = 'password123';

function prng(seed) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Interpolates [lat, lng, ele] waypoints every ~40 m with gentle sideways
// wiggle and elevation noise so the result looks like a recorded track.
export function synthTrack(waypoints, seed = 1) {
  const rand = prng(seed);
  const out = [];
  for (let i = 0; i < waypoints.length - 1; i++) {
    const [aLat, aLng, aEle] = waypoints[i];
    const [bLat, bLng, bEle] = waypoints[i + 1];
    const d = haversine(aLat, aLng, bLat, bLng);
    const steps = Math.max(2, Math.round(d / 40));
    const wiggle = (rand() - 0.5) * 0.004;
    for (let s = 0; s < steps; s++) {
      const t = s / steps;
      const bend = Math.sin(t * Math.PI) * wiggle + Math.sin(t * Math.PI * 6) * 0.0002;
      const lat = aLat + (bLat - aLat) * t + bend * (bLng - aLng > 0 ? 1 : -1) * 0.5;
      const lng = aLng + (bLng - aLng) * t - bend * (bLat - aLat > 0 ? 1 : -1) * 0.5;
      const ele = aEle + (bEle - aEle) * t + (rand() - 0.5) * 2;
      out.push([lat, lng, Math.round(ele * 10) / 10]);
    }
  }
  out.push(waypoints.at(-1));
  return out;
}

const ROUTES = [
  {
    key: 'puncak',
    name: 'BSD → Puncak Pass',
    activity: 'road_cycling',
    location: 'BSD – Bogor – Puncak',
    description: 'The classic weekend climb: flat roll out of BSD through Parung and Bogor, then the long drag up from Gadog to Puncak Pass. Leave early to beat the traffic.',
    creator: 'kevin',
    waypoints: [
      [-6.302, 106.6528, 40], [-6.35, 106.69, 70], [-6.42, 106.73, 110], [-6.5, 106.77, 180],
      [-6.595, 106.8166, 260], [-6.64, 106.835, 380], [-6.66, 106.85, 480], [-6.665, 106.88, 600],
      [-6.68, 106.93, 900], [-6.695, 106.97, 1200], [-6.703, 106.995, 1450],
    ],
  },
  {
    key: 'sentul',
    name: 'Sentul Rainbow Hills Loop',
    activity: 'road_cycling',
    location: 'Sentul, Bogor',
    description: 'Popular loop from Sentul City up to Rainbow Hills and back. Short but punchy climbs.',
    creator: 'daniel',
    waypoints: [
      [-6.565, 106.853, 150], [-6.575, 106.875, 220], [-6.585, 106.9, 320], [-6.6, 106.92, 600],
      [-6.615, 106.91, 480], [-6.605, 106.885, 300], [-6.585, 106.865, 200], [-6.565, 106.853, 150],
    ],
  },
  {
    key: 'sudirman',
    name: 'Sudirman–Thamrin Morning Run',
    activity: 'running',
    location: 'Senayan, Jakarta',
    description: 'Out-and-back from GBK Senayan to Bundaran HI along Sudirman. Best on car-free Sunday mornings.',
    creator: 'sarah',
    waypoints: [
      [-6.2185, 106.8022, 12], [-6.2125, 106.8155, 11], [-6.2035, 106.8215, 10], [-6.195, 106.823, 9],
      [-6.2035, 106.8219, 10], [-6.2128, 106.816, 11], [-6.2185, 106.8022, 12],
    ],
  },
  {
    key: 'bsdrun',
    name: 'BSD Green Office Park 5K',
    activity: 'running',
    location: 'BSD, Tangerang Selatan',
    description: 'Shaded, flat 5K loop around Green Office Park. Good for easy runs and intervals.',
    creator: 'andrew',
    waypoints: [
      [-6.3015, 106.65, 35], [-6.2965, 106.657, 36], [-6.3005, 106.665, 37], [-6.308, 106.6625, 36],
      [-6.31, 106.6545, 35], [-6.3015, 106.65, 35],
    ],
  },
  {
    key: 'pancar',
    name: 'Gunung Pancar Forest Trail',
    activity: 'trail_running',
    location: 'Babakan Madang, Bogor',
    description: 'Pine forest singletrack with a steady climb to the ridge. Slippery after rain.',
    creator: 'rina',
    waypoints: [
      [-6.583, 106.903, 320], [-6.588, 106.912, 450], [-6.593, 106.922, 640], [-6.598, 106.93, 800],
      [-6.592, 106.935, 720], [-6.585, 106.925, 520], [-6.583, 106.903, 320],
    ],
  },
  {
    key: 'leuwihejo',
    name: 'Curug Leuwi Hejo Hike',
    activity: 'hiking',
    location: 'Babakan Madang, Bogor',
    description: 'Easy hike through villages and rice fields to the turquoise Leuwi Hejo waterfall pools.',
    creator: 'rina',
    waypoints: [
      [-6.594, 106.94, 300], [-6.598, 106.947, 360], [-6.603, 106.953, 450], [-6.607, 106.958, 540],
    ],
  },
  {
    key: 'gravel',
    name: 'Babakan Madang Gravel Loop',
    activity: 'gravel',
    location: 'Sentul – Babakan Madang',
    description: 'Mixed tarmac and village gravel roads east of Sentul. Some loose sections after rain.',
    creator: 'michael',
    waypoints: [
      [-6.56, 106.87, 160], [-6.555, 106.905, 220], [-6.565, 106.94, 330], [-6.585, 106.965, 420],
      [-6.61, 106.95, 380], [-6.62, 106.92, 300], [-6.6, 106.89, 220], [-6.575, 106.875, 180], [-6.56, 106.87, 160],
    ],
  },
  {
    key: 'mtb',
    name: 'Pondok Pemburu MTB Descent',
    activity: 'mtb',
    location: 'Gunung Pancar, Bogor',
    description: 'Climb the fire road, then enjoy the flowy singletrack descent back to the trailhead.',
    creator: 'michael',
    waypoints: [
      [-6.578, 106.918, 420], [-6.585, 106.93, 560], [-6.592, 106.942, 760], [-6.6, 106.95, 900],
      [-6.595, 106.94, 700], [-6.587, 106.928, 520], [-6.578, 106.918, 420],
    ],
  },
];

const USERS = [
  { key: 'admin', name: 'Jalur Admin', email: 'admin@jalur.test', admin: true, activities: [], city: 'Jakarta Pusat', bio: 'Keeps the trails tidy.' },
  { key: 'kevin', name: 'Kevin', email: 'kevin@jalur.test', activities: ['road_cycling', 'running'], city: 'BSD / Tangerang Selatan', bio: 'Road cyclist & runner', experience: 'intermediate' },
  { key: 'daniel', name: 'Daniel', email: 'daniel@jalur.test', activities: ['road_cycling', 'gravel'], city: 'Bogor', bio: 'Weekend climber', experience: 'advanced' },
  { key: 'andrew', name: 'Andrew', email: 'andrew@jalur.test', activities: ['road_cycling', 'running'], city: 'BSD / Tangerang Selatan', bio: 'Runs BSD Runners', experience: 'intermediate', premium: true },
  { key: 'michael', name: 'Michael', email: 'michael@jalur.test', activities: ['road_cycling', 'mtb', 'gravel'], city: 'Bogor', bio: 'Gravel and MTB addict', experience: 'advanced' },
  { key: 'sarah', name: 'Sarah', email: 'sarah@jalur.test', activities: ['road_cycling', 'running'], city: 'Jakarta Selatan', bio: 'Organizer at Jakarta Cycling Club', experience: 'advanced', premium: true },
  { key: 'rina', name: 'Rina', email: 'rina@jalur.test', activities: ['trail_running', 'hiking'], city: 'Bogor', bio: 'Trail runner, Sentul Trail Runners', experience: 'advanced', premium: true },
  { key: 'budi', name: 'Budi', email: 'budi@jalur.test', activities: ['road_cycling'], city: 'Depok', bio: 'Just bought my first road bike', experience: 'beginner' },
];

const CITY = {
  'Jakarta Pusat': [-6.1865, 106.8341],
  'Jakarta Selatan': [-6.2615, 106.8106],
  'BSD / Tangerang Selatan': [-6.302, 106.6528],
  Bogor: [-6.595, 106.8166],
  Depok: [-6.4025, 106.7942],
};

const PLACES = [
  // Puncak Pass (finish of the Puncak climb)
  ['Kedai Kopi Tanjakan', 'coffee', -6.7022, 106.9935, 4.6, 1, '06:00-20:00'],
  ['Warung Sate Gadog', 'food', -6.7041, 106.9962, 4.4, 0, '07:00-21:00'],
  ['Rest Area Puncak Pass', 'rest_area', -6.7035, 106.9941, null, 0, '24/7'],
  ['Minimarket Puncak 24 Jam', 'convenience', -6.7015, 106.9978, null, 0, '24/7'],
  ['Bengkel Sepeda Puncak', 'bike_shop', -6.6998, 106.9921, 4.2, 1, '08:00-17:00'],
  // BSD
  ['Kopi Kayuh BSD', 'coffee', -6.3008, 106.6541, 4.7, 1, '06:00-22:00'],
  ['Roti Pagi Bakery', 'bakery', -6.3029, 106.6552, 4.3, 0, '06:00-18:00'],
  ['BSD Bike Service', 'bike_shop', -6.2996, 106.6512, 4.5, 1, '09:00-18:00'],
  ['Bubur Ayam Pak Joko', 'food', -6.3032, 106.6519, 4.4, 0, '05:30-11:00'],
  ['Parkir Green Office Park', 'parking', -6.3021, 106.6534, null, 0, '24/7'],
  // Sentul
  ['Sentul Cycling Café', 'coffee', -6.5658, 106.8541, 4.6, 1, '05:30-21:00'],
  ['Warung Nasi Uduk Sentul', 'food', -6.5641, 106.8522, 4.2, 0, '05:00-12:00'],
  ['Sentul Velo Workshop', 'bike_shop', -6.5672, 106.8557, 4.8, 1, '08:00-18:00'],
  ['Minimarket Sentul City', 'convenience', -6.5649, 106.8549, null, 0, '24/7'],
  // Senayan
  ['Kopi Lari Senayan', 'coffee', -6.2191, 106.8031, 4.5, 0, '05:00-22:00'],
  ['GBK Runners Shower Point', 'recovery', -6.2179, 106.8015, null, 0, '05:00-21:00'],
  ['Soto Betawi Senayan', 'food', -6.2201, 106.8042, 4.3, 0, '06:00-15:00'],
  // Gunung Pancar / Leuwi Hejo
  ['Warung Kopi Pinus', 'coffee', -6.5838, 106.9041, 4.5, 0, '06:00-18:00'],
  ['Warung Nasi Liwet Pancar', 'food', -6.5822, 106.9022, 4.4, 0, '07:00-19:00'],
  ['Parkir Gunung Pancar', 'parking', -6.5831, 106.9029, null, 0, '06:00-18:00'],
  ['Warung Leuwi Hejo', 'food', -6.6068, 106.9574, 4.1, 0, '07:00-17:00'],
  ['Kopi Curug', 'coffee', -6.6061, 106.9582, 4.3, 0, '08:00-17:00'],
];

// Date helper: `days` from today at a wall-clock time in Jakarta (UTC+7).
function wib(days, hour, minute = 0) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  d.setUTCHours(hour - 7, minute, 0, 0);
  return d.toISOString();
}
const minutesAgo = (m) => new Date(Date.now() - m * 60000).toISOString();

export function seed(db) {
  return transaction(db, () => {
    const users = {};
    const passwordHash = hashPassword(DEMO_PASSWORD);
    for (const u of USERS) {
      const [lat, lng] = CITY[u.city];
      users[u.key] = db
        .prepare(
          `INSERT INTO users (email, password_hash, name, bio, location_name, lat, lng, experience, activities,
             is_admin, onboarded, emergency_name, emergency_phone, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?) RETURNING id`,
        )
        .get(u.email, passwordHash, u.name, u.bio, u.city, lat, lng, u.experience ?? 'beginner',
          JSON.stringify(u.activities), u.admin ? 1 : 0, u.admin ? null : 'Family', u.admin ? null : '+62 812 0000 0000',
          minutesAgo(60 * 24 * 60)).id;
      if (u.premium) {
        db.prepare("INSERT INTO subscriptions (user_id, plan, status, start_date, end_date) VALUES (?, 'community_creator', 'active', ?, ?)").run(
          users[u.key], minutesAgo(60 * 24 * 10), new Date(Date.now() + 20 * 864e5).toISOString(),
        );
      }
    }

    const routes = {};
    ROUTES.forEach((r, i) => {
      const points = synthTrack(r.waypoints, i + 7);
      const stats = computeStats(points);
      const geometry = compactPoints(simplify(points));
      routes[r.key] = db
        .prepare(
          `INSERT INTO routes (creator_id, activity_type, name, description, location_name, gpx_text, geometry,
             distance_m, elevation_gain, elevation_loss, max_elevation, est_duration_s, difficulty,
             start_lat, start_lng, end_lat, end_lng, min_lat, max_lat, min_lng, max_lng, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
        )
        .get(
          users[r.creator], r.activity, r.name, r.description, r.location, toGpx(r.name, geometry), JSON.stringify(geometry),
          stats.distanceM, stats.elevationGain, stats.elevationLoss, stats.maxElevation,
          estimateDurationSeconds(r.activity, stats.distanceM, stats.elevationGain),
          estimateDifficulty(r.activity, stats.distanceM, stats.elevationGain),
          stats.start[0], stats.start[1], stats.end[0], stats.end[1],
          stats.bbox.minLat, stats.bbox.maxLat, stats.bbox.minLng, stats.bbox.maxLng, minutesAgo(60 * 24 * (30 - i)),
        ).id;
    });

    const routeRow = (key) => db.prepare('SELECT * FROM routes WHERE id = ?').get(routes[key]);
    const plan = (o) => {
      const r = routeRow(o.route);
      const id = db
        .prepare(
          `INSERT INTO activity_plans (route_id, creator_id, title, activity_type, starts_at, meeting_point, meeting_lat,
             meeting_lng, participant_limit, pace, description, visibility, status)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
        )
        .get(routes[o.route], users[o.host], o.title, r.activity_type, o.startsAt, o.meetingPoint, r.start_lat, r.start_lng,
          o.limit ?? null, o.pace ?? null, o.description ?? '', o.visibility ?? 'public', o.status ?? 'open').id;
      for (const key of [o.host, ...(o.members ?? [])]) {
        db.prepare("INSERT INTO activity_participants (activity_id, user_id, status, checked_in_at) VALUES (?, ?, 'joined', ?)").run(
          id, users[key], o.checkedIn?.includes(key) ? o.startsAt : null,
        );
      }
      for (const key of o.requests ?? []) {
        db.prepare("INSERT INTO activity_participants (activity_id, user_id, status) VALUES (?, ?, 'requested')").run(id, users[key]);
      }
      const msg = db.prepare('INSERT INTO chat_messages (activity_id, user_id, kind, body, created_at) VALUES (?, ?, ?, ?, ?)');
      msg.run(id, null, 'system', `${USERS.find((u) => u.key === o.host).name} created this activity`, minutesAgo(60 * 24 * 2));
      for (const [who, body, ago] of o.chat ?? []) msg.run(id, users[who], 'text', body, minutesAgo(ago));
      return id;
    };

    const sundayRide = plan({
      route: 'puncak', host: 'kevin', title: 'Sunday Morning Ride', startsAt: wib(2, 6), meetingPoint: 'BSD Green Office Park, main gate',
      limit: 12, pace: '25–28 km/h', description: 'No-drop group ride to Puncak Pass. Coffee at the top.',
      members: ['daniel', 'andrew', 'michael', 'sarah'],
      chat: [
        ['kevin', 'See you guys at 05:45.', 300],
        ['daniel', 'Is the road near KM 30 okay?', 120],
        ['michael', 'Just passed there yesterday. Road is good, some road work around KM 32.', 90],
      ],
    });
    const lunchLoop = plan({
      route: 'sentul', host: 'michael', title: 'Sentul Lunch Loop', startsAt: new Date(Date.now() + 60 * 60000).toISOString(),
      meetingPoint: 'Sentul City, near the circuit roundabout', limit: 8, pace: '22–25 km/h',
      members: ['daniel', 'budi'],
      chat: [['michael', 'Rolling out in an hour, meet at the roundabout.', 20]],
    });
    plan({
      route: 'sentul', host: 'daniel', title: 'Sentul Sunrise Loop', startsAt: wib(1, 5, 30), meetingPoint: 'Sentul City, near the circuit roundabout',
      limit: 8, pace: '27–30 km/h', members: ['kevin'],
    });
    plan({
      route: 'sudirman', host: 'sarah', title: 'Car-free Day Run', startsAt: wib(3, 6), meetingPoint: 'GBK Senayan, Gate 5',
      pace: '6:00/km', description: 'Easy conversational pace, all levels welcome.', members: ['kevin', 'andrew'],
    });
    plan({
      route: 'bsdrun', host: 'andrew', title: 'BSD Tempo Tuesday', startsAt: wib(4, 18, 30), meetingPoint: 'Green Office Park lobby',
      pace: '5:15/km', members: [],
    });
    plan({
      route: 'pancar', host: 'rina', title: 'Pancar Trail Session', startsAt: wib(3, 6, 30), meetingPoint: 'Gunung Pancar parking lot',
      limit: 10, pace: 'Easy', visibility: 'private', description: 'Members of Sentul Trail Runners first, ask to join.',
      requests: ['budi'],
    });
    plan({
      route: 'gravel', host: 'michael', title: 'Gravel Saturday', startsAt: wib(5, 6), meetingPoint: 'Sentul Velo Workshop',
      limit: 6, pace: '20 km/h', members: ['daniel'],
    });
    // A finished ride so profiles have activity history.
    plan({
      route: 'puncak', host: 'kevin', title: 'Puncak Ride', startsAt: wib(-5, 6), meetingPoint: 'BSD Green Office Park, main gate',
      status: 'completed', members: ['daniel', 'sarah'], checkedIn: ['kevin', 'daniel', 'sarah'],
    });
    plan({
      route: 'sudirman', host: 'sarah', title: 'Car-free Day Run', startsAt: wib(-4, 6), meetingPoint: 'GBK Senayan, Gate 5',
      status: 'completed', members: ['kevin'], checkedIn: ['kevin', 'sarah'],
    });

    const report = db.prepare(
      'INSERT INTO track_reports (route_id, user_id, activity_id, category, value, km, description, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    );
    report.run(routes.puncak, users.daniel, null, 'road', 'road_work', 32, 'One lane closed near the bridge', minutesAgo(40));
    report.run(routes.puncak, users.michael, sundayRide, 'traffic', 'moderate', 30, '', minutesAgo(20));
    report.run(routes.puncak, users.andrew, null, 'traffic', 'heavy', 75, 'Weekend jam from Gadog upward', minutesAgo(180));
    report.run(routes.puncak, users.sarah, null, 'traffic', 'heavy', 77, '', minutesAgo(120));
    report.run(routes.puncak, users.kevin, null, 'weather', 'cloudy', 70, '', minutesAgo(60));
    report.run(routes.sentul, users.daniel, lunchLoop, 'road', 'good', null, 'Fresh asphalt on the climb', minutesAgo(65));
    report.run(routes.sentul, users.michael, null, 'crowd', 'medium', 8, '', minutesAgo(30));
    report.run(routes.pancar, users.rina, null, 'trail', 'muddy', 4, 'Rained last night, wear trail shoes', minutesAgo(300));
    report.run(routes.sudirman, users.sarah, null, 'crowd', 'high', 2, 'Car-free day crowds near HI', minutesAgo(600));

    const community = (o) => {
      const id = db
        .prepare(
          `INSERT INTO communities (owner_id, name, description, activity_type, location_name, lat, lng, rules, privacy)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
        )
        .get(users[o.owner], o.name, o.description, o.activity, o.location, o.lat, o.lng, o.rules, o.privacy ?? 'public').id;
      db.prepare("INSERT INTO community_members (community_id, user_id, role, status) VALUES (?, ?, 'admin', 'member')").run(id, users[o.owner]);
      for (const m of o.members) {
        db.prepare("INSERT INTO community_members (community_id, user_id, role, status) VALUES (?, ?, 'member', 'member')").run(id, users[m]);
      }
      return id;
    };
    const jcc = community({
      owner: 'sarah', name: 'Jakarta Cycling Club', activity: 'road_cycling', location: 'Jakarta', lat: -6.2088, lng: 106.8456,
      description: 'Weekly group rides around Jakarta, Sentul and Puncak for all levels.',
      rules: '1. Helmets always.\n2. No-drop unless stated.\n3. Respect traffic rules.',
      members: ['kevin', 'daniel', 'andrew', 'michael'],
    });
    const stc = community({
      owner: 'rina', name: 'Sentul Trail Runners', activity: 'trail_running', location: 'Sentul, Bogor', lat: -6.5658, lng: 106.8541,
      description: 'Trail running sessions in Gunung Pancar and around Babakan Madang.',
      rules: 'Bring water and a headlamp for early sessions.', privacy: 'private', members: [],
    });
    const bsdr = community({
      owner: 'andrew', name: 'BSD Runners', activity: 'running', location: 'BSD, Tangerang Selatan', lat: -6.302, lng: 106.6528,
      description: 'Easy runs, tempo sessions and long runs around BSD.', rules: 'Everyone is welcome.', members: ['kevin', 'sarah'],
    });

    const event = (o) => {
      const r = o.route ? routeRow(o.route) : null;
      const id = db
        .prepare(
          `INSERT INTO events (community_id, route_id, created_by, title, description, activity_type, starts_at, ends_at,
             meeting_point, lat, lng, max_participants, difficulty, pace, notification_radius_km)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
        )
        .get(o.community, r?.id ?? null, users[o.by], o.title, o.description, o.activity, o.startsAt, o.endsAt ?? null,
          o.meetingPoint, r?.start_lat ?? o.lat, r?.start_lng ?? o.lng, o.max ?? null, r?.difficulty ?? null, o.pace ?? null, o.radius ?? null).id;
      for (const k of o.registered ?? []) db.prepare('INSERT INTO event_participants (event_id, user_id) VALUES (?, ?)').run(id, users[k]);
      return id;
    };
    event({
      community: jcc, by: 'sarah', title: 'Sunday Sunrise Ride', route: 'sentul', activity: 'road_cycling', startsAt: wib(6, 5, 30), endsAt: wib(6, 8, 30),
      meetingPoint: 'Sentul City roundabout', max: 60, pace: '25 km/h', radius: 25,
      description: 'Our monthly sunrise loop. Two groups: social (25 km/h) and fast (30+ km/h). Breakfast after.',
      registered: ['sarah', 'kevin', 'daniel', 'michael'],
    });
    event({
      community: bsdr, by: 'andrew', title: 'BSD Night 5K', route: 'bsdrun', activity: 'running', startsAt: wib(4, 19, 30),
      meetingPoint: 'Green Office Park lobby', max: 100, pace: 'All paces', radius: 10,
      description: 'Relaxed 5K under the lights, followed by drinks at Kopi Kayuh.', registered: ['andrew', 'kevin'],
    });
    event({
      community: stc, by: 'rina', title: 'Pancar Trail Clinic', route: 'pancar', activity: 'trail_running', startsAt: wib(9, 6),
      meetingPoint: 'Gunung Pancar parking lot', max: 20, description: 'Downhill technique and footwork drills.', registered: ['rina'],
    });

    const place = db.prepare(
      'INSERT INTO places (name, category, lat, lng, rating, cyclist_friendly, opening_hours) VALUES (?, ?, ?, ?, ?, ?, ?)',
    );
    for (const p of PLACES) place.run(...p);

    const note = db.prepare('INSERT INTO notifications (user_id, type, title, body, link, created_at) VALUES (?, ?, ?, ?, ?, ?)');
    note.run(users.kevin, 'activity_join', 'Michael joined Sunday Morning Ride', '', `/activities/${sundayRide}`, minutesAgo(200));
    note.run(users.kevin, 'track_update', 'New condition on BSD → Puncak Pass', 'Road condition: road work at KM 32', `/activities/${sundayRide}`, minutesAgo(40));
    note.run(users.kevin, 'community', 'New event from Jakarta Cycling Club', 'Sunday Sunrise Ride', '/events/1', minutesAgo(600));

    return { users, routes };
  });
}

export function seedIfEmpty(db) {
  if (db.prepare('SELECT 1 FROM users LIMIT 1').get()) return false;
  seed(db);
  console.log(`Seeded demo data. Log in as kevin@jalur.test / ${DEMO_PASSWORD} (admin: admin@jalur.test).`);
  return true;
}

// `npm run seed` wipes the local database and reseeds it.
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const file = process.env.DATABASE_FILE ?? path.join(here, '..', 'data', 'jalur.db');
  if (process.argv.includes('--reset')) {
    for (const suffix of ['', '-wal', '-shm']) fs.rmSync(file + suffix, { force: true });
  }
  const db = openDb(file);
  if (!seedIfEmpty(db)) console.log('Database already has data; run with --reset to start over.');
  db.close();
}
