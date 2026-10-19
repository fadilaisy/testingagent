import { Router } from 'express';
import multer from 'multer';
import {
  ACTIVITY_KEYS,
  CONDITION_CATEGORIES,
  DIFFICULTIES,
  estimateDifficulty,
  estimateDurationSeconds,
} from '../activities.js';
import { HttpError, requireUser } from '../auth.js';
import { transaction } from '../db.js';
import { haversine, trimEnds } from '../geo.js';
import { GpxError, compactPoints, computeStats, parseGpx, simplify, toGpx } from '../gpx.js';
import { PLACE_CATEGORIES } from '../places.js';
import {
  ACTIVITY_SELECT,
  ROUTE_SELECT,
  activitySummary,
  chatMessage,
  routeSummary,
  trackReport,
} from '../serialize.js';
import * as v from '../validate.js';
import { routeWeather } from '../weather.js';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 1 },
});

const PRIVACY_TRIM_OPTIONS = [0, 200, 500];
const CONDITION_WINDOW_HOURS = 24;
const REPORTS_PER_HOUR = 10;

function readGpx(req) {
  if (!req.file) throw new HttpError(400, 'Choose a .gpx file to upload', { field: 'GPX file' });
  try {
    return parseGpx(req.file.buffer.toString('utf8'));
  } catch (err) {
    if (err instanceof GpxError) throw new HttpError(400, err.message, { field: 'GPX file' });
    throw err;
  }
}

// Summarises the latest report per category within the window, plus safety
// warnings when several people report the same serious problem (PRD §30).
export function summarizeConditions(reports) {
  const cutoff = Date.now() - CONDITION_WINDOW_HOURS * 3600 * 1000;
  const recent = reports.filter((r) => Date.parse(r.createdAt) >= cutoff);
  const latest = {};
  for (const r of recent) {
    if (!latest[r.category] || Date.parse(r.createdAt) > Date.parse(latest[r.category].createdAt)) {
      latest[r.category] = r;
    }
  }
  const warnings = [];
  for (const [category, meta] of Object.entries(CONDITION_CATEGORIES)) {
    const serious = recent.filter((r) => r.category === category && r.severity >= 2);
    const reporters = new Set(serious.map((r) => r.user.id));
    if (reporters.size >= 2) {
      const values = [...new Set(serious.map((r) => r.value.replace('_', ' ')))].join(' / ');
      warnings.push({ category, message: `${reporters.size} people reported ${values} (${meta.label.toLowerCase()}) in the last ${CONDITION_WINDOW_HOURS} hours` });
    }
  }
  return { latest, warnings };
}

export function routesRouter({ db, hub, notifier, weather, places }) {
  const router = Router();

  const getRoute = (id, viewer) => {
    const r = db.prepare(`${ROUTE_SELECT} WHERE r.id = ?`).get(id);
    if (!r || (r.hidden && !viewer?.is_admin && viewer?.id !== r.creator_id)) throw new HttpError(404, 'Route not found');
    return r;
  };

  const reportsFor = (routeId, sinceHours = 24 * 7) =>
    db
      .prepare(
        `SELECT t.*, u.name AS user_name FROM track_reports t JOIN users u ON u.id = t.user_id
         WHERE t.route_id = ? AND t.created_at > ? ORDER BY t.created_at DESC LIMIT 100`,
      )
      .all(routeId, new Date(Date.now() - sinceHours * 3600 * 1000).toISOString())
      .map(trackReport);

  router.get('/routes', (req, res) => {
    const q = req.query;
    const where = ["r.hidden = 0", "r.visibility = 'public'"];
    const params = [];
    if (q.activity) {
      where.push('r.activity_type = ?');
      params.push(v.oneOf(q.activity, 'Activity', ACTIVITY_KEYS));
    }
    if (q.difficulty) {
      where.push('r.difficulty = ?');
      params.push(v.oneOf(q.difficulty, 'Difficulty', DIFFICULTIES));
    }
    if (q.minKm) {
      where.push('r.distance_m >= ?');
      params.push(v.num(q.minKm, 'Min distance', { min: 0 }) * 1000);
    }
    if (q.maxKm) {
      where.push('r.distance_m <= ?');
      params.push(v.num(q.maxKm, 'Max distance', { min: 0 }) * 1000);
    }
    if (q.q) {
      where.push('(r.name LIKE ? OR r.location_name LIKE ? OR r.description LIKE ?)');
      const like = `%${v.text(q.q, 'Search', { max: 80 })}%`;
      params.push(like, like, like);
    }
    let rows = db.prepare(`${ROUTE_SELECT} WHERE ${where.join(' AND ')} ORDER BY r.created_at DESC LIMIT 500`).all(...params);

    const lat = v.lat(q.lat, 'Latitude');
    const lng = v.lng(q.lng, 'Longitude');
    if (lat != null && lng != null) {
      rows = rows.map((r) => ({ ...r, distance_from_you_m: Math.round(haversine(lat, lng, r.start_lat, r.start_lng)) }));
      const radiusKm = v.num(q.radiusKm, 'Radius', { min: 1, max: 500 });
      if (radiusKm) rows = rows.filter((r) => r.distance_from_you_m <= radiusKm * 1000);
    }
    const sort = v.oneOf(q.sort, 'Sort', ['popular', 'recent', 'nearby'], { fallback: 'popular' });
    if (sort === 'popular') {
      rows.sort((a, b) => b.completed_count + b.upcoming_count * 2 - (a.completed_count + a.upcoming_count * 2));
    } else if (sort === 'nearby' && rows[0]?.distance_from_you_m != null) {
      rows.sort((a, b) => a.distance_from_you_m - b.distance_from_you_m);
    }
    const limit = v.int(q.limit, 'Limit', { min: 1, max: 100, fallback: 30 });
    res.json({ routes: rows.slice(0, limit).map(routeSummary), total: rows.length });
  });

  router.post('/routes/preview', requireUser, upload.single('gpx'), (req, res) => {
    const { name, points } = readGpx(req);
    const stats = computeStats(points);
    res.json({ name, stats, geometry: compactPoints(simplify(points, 500)) });
  });

  router.post('/routes', requireUser, upload.single('gpx'), (req, res) => {
    const { name: gpxName, points } = readGpx(req);
    const b = req.body;
    const activityType = v.oneOf(b.activityType, 'Activity', ACTIVITY_KEYS, { required: true });
    const name = v.text(b.name, 'Route name', { max: 100 }) || gpxName;
    if (!name) throw new HttpError(400, 'Route name is required', { field: 'Route name' });
    const privacyTrim = v.oneOf(Number(b.privacyTrim ?? 0), 'Privacy zone', PRIVACY_TRIM_OPTIONS);
    const visibility = v.oneOf(b.visibility ?? 'public', 'Visibility', ['public', 'unlisted']);

    // Stats describe the whole ride; the stored geometry may have its ends
    // trimmed so the start/finish (often someone's home) isn't published.
    const stats = computeStats(points);
    const geometry = compactPoints(trimEnds(simplify(points), privacyTrim));
    const shown = computeStats(geometry);
    const difficulty =
      v.oneOf(b.difficulty, 'Difficulty', DIFFICULTIES) ??
      estimateDifficulty(activityType, stats.distanceM, stats.elevationGain);

    const row = db
      .prepare(
        `INSERT INTO routes (creator_id, activity_type, name, description, location_name, gpx_text, geometry,
           distance_m, elevation_gain, elevation_loss, max_elevation, est_duration_s, difficulty,
           start_lat, start_lng, end_lat, end_lng, min_lat, max_lat, min_lng, max_lng, privacy_trim_m, visibility)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
      )
      .get(
        req.user.id, activityType, name, v.text(b.description, 'Description', { max: 2000 }),
        v.text(b.locationName, 'Location', { max: 80 }) || null, req.file.buffer.toString('utf8'),
        JSON.stringify(geometry), stats.distanceM, stats.elevationGain, stats.elevationLoss, stats.maxElevation,
        estimateDurationSeconds(activityType, stats.distanceM, stats.elevationGain), difficulty,
        shown.start[0], shown.start[1], shown.end[0], shown.end[1],
        shown.bbox.minLat, shown.bbox.maxLat, shown.bbox.minLng, shown.bbox.maxLng, privacyTrim, visibility,
      );
    res.status(201).json({ route: routeSummary(getRoute(row.id, req.user)) });
  });

  router.get('/routes/:id', (req, res) => {
    const r = getRoute(v.idParam(req.params.id), req.user);
    const reports = reportsFor(r.id);
    const activities = db
      .prepare(
        `${ACTIVITY_SELECT} WHERE a.route_id = ? AND a.status = 'open' AND a.starts_at > ?
           AND (a.visibility = 'public' OR a.creator_id = ? OR EXISTS (
             SELECT 1 FROM activity_participants p WHERE p.activity_id = a.id AND p.user_id = ?))
         ORDER BY a.starts_at LIMIT 20`,
      )
      .all(req.user?.id ?? 0, r.id, new Date(Date.now() - 2 * 3600 * 1000).toISOString(), req.user?.id ?? 0, req.user?.id ?? 0)
      .map(activitySummary);
    const conditions = summarizeConditions(reports);
    if (r.flagged_unsafe) {
      conditions.warnings.unshift({ category: 'admin', message: 'This route was flagged as unsafe by moderators' });
    }
    res.json({
      route: {
        ...routeSummary(r),
        description: r.description,
        elevationLoss: r.elevation_loss,
        maxElevation: r.max_elevation,
        privacyTrimM: r.privacy_trim_m,
        visibility: r.visibility,
        geometry: JSON.parse(r.geometry),
        isOwner: req.user?.id === r.creator_id,
      },
      reports,
      conditions,
      activities,
    });
  });

  router.get('/routes/:id/gpx', (req, res) => {
    const r = getRoute(v.idParam(req.params.id), req.user);
    const body = req.user?.id === r.creator_id ? r.gpx_text : toGpx(r.name, JSON.parse(r.geometry));
    const filename = r.name.replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-') || `route-${r.id}`;
    res.set('content-type', 'application/gpx+xml');
    res.set('content-disposition', `attachment; filename="${filename}.gpx"`);
    res.send(body);
  });

  router.delete('/routes/:id', requireUser, (req, res) => {
    const r = getRoute(v.idParam(req.params.id), req.user);
    if (r.creator_id !== req.user.id && !req.user.is_admin) throw new HttpError(403, 'Only the creator can delete this route');
    const others = db
      .prepare(
        `SELECT COUNT(*) AS n FROM activity_plans WHERE route_id = ? AND creator_id != ? AND status = 'open' AND starts_at > ?`,
      )
      .get(r.id, r.creator_id, new Date().toISOString()).n;
    if (others > 0 && !req.user.is_admin) {
      throw new HttpError(409, 'Other people have upcoming activities on this route, so it cannot be deleted');
    }
    db.prepare('DELETE FROM routes WHERE id = ?').run(r.id);
    res.json({ ok: true });
  });

  router.get('/routes/:id/weather', async (req, res) => {
    const r = getRoute(v.idParam(req.params.id), req.user);
    const startsAt = v.isoDate(req.query.startsAt, 'Start time');
    try {
      const data = await routeWeather(weather, {
        points: JSON.parse(r.geometry),
        distanceM: r.distance_m,
        estDurationS: r.est_duration_s,
        startsAt,
      });
      res.json(data);
    } catch (err) {
      console.warn(`[weather] route ${r.id}: ${err.message}`);
      throw new HttpError(503, 'Weather is unavailable right now');
    }
  });

  router.get('/routes/:id/places', async (req, res) => {
    const r = getRoute(v.idParam(req.params.id), req.user);
    const near = v.oneOf(req.query.near ?? 'finish', 'Near', ['start', 'finish']);
    const categories = req.query.category
      ? String(req.query.category).split(',').filter((c) => Object.hasOwn(PLACE_CATEGORIES, c))
      : null;
    const radiusM = v.int(req.query.radius, 'Radius', { min: 200, max: 5000, fallback: 1500 });
    const [lat, lng] = near === 'start' ? [r.start_lat, r.start_lng] : [r.end_lat, r.end_lng];
    res.json(await places.nearby({ lat, lng, radiusM, activityType: r.activity_type, categories }));
  });

  router.get('/routes/:id/conditions', (req, res) => {
    const r = getRoute(v.idParam(req.params.id), req.user);
    const reports = reportsFor(r.id);
    res.json({ reports, conditions: summarizeConditions(reports) });
  });

  router.post('/routes/:id/conditions', requireUser, (req, res) => {
    const r = getRoute(v.idParam(req.params.id), req.user);
    const b = req.body;
    const category = v.oneOf(b.category, 'Category', Object.keys(CONDITION_CATEGORIES), { required: true });
    const value = v.oneOf(b.value, 'Condition', Object.keys(CONDITION_CATEGORIES[category].values), { required: true });
    const km = v.num(b.km, 'KM', { min: 0, max: Math.ceil(r.distance_m / 1000) });
    const description = v.text(b.description, 'Description', { max: 280 });
    const activityId = v.int(b.activityId, 'Activity', { min: 1 });

    const recentCount = db
      .prepare('SELECT COUNT(*) AS n FROM track_reports WHERE user_id = ? AND created_at > ?')
      .get(req.user.id, new Date(Date.now() - 3600 * 1000).toISOString()).n;
    if (recentCount >= REPORTS_PER_HOUR) throw new HttpError(429, 'You have sent a lot of reports; try again later');

    if (activityId) {
      const member = db
        .prepare(
          `SELECT 1 FROM activity_participants p JOIN activity_plans a ON a.id = p.activity_id
           WHERE p.activity_id = ? AND p.user_id = ? AND p.status = 'joined' AND a.route_id = ?`,
        )
        .get(activityId, req.user.id, r.id);
      if (!member) throw new HttpError(403, 'You can only report into activities you joined on this route');
    }

    const { report, message } = transaction(db, () => {
      const t = db
        .prepare(
          `INSERT INTO track_reports (route_id, user_id, activity_id, category, value, km, description)
           VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING *`,
        )
        .get(r.id, req.user.id, activityId, category, value, km, description);
      const report = trackReport({ ...t, user_name: req.user.name });
      let message = null;
      if (activityId) {
        const text = `${CONDITION_CATEGORIES[category].label}: ${value.replace('_', ' ')}${km != null ? ` at KM ${km}` : ''}${description ? ` — ${description}` : ''}`;
        const m = db
          .prepare(
            `INSERT INTO chat_messages (activity_id, user_id, kind, body, data) VALUES (?, ?, 'condition', ?, ?) RETURNING *`,
          )
          .get(activityId, req.user.id, text, JSON.stringify({ reportId: t.id, category, value, km, severity: report.severity }));
        message = chatMessage({ ...m, user_name: req.user.name });
      }
      return { report, message };
    });

    if (message) {
      const members = db
        .prepare("SELECT user_id FROM activity_participants WHERE activity_id = ? AND status = 'joined'")
        .all(activityId)
        .map((m) => m.user_id);
      hub.send(members, 'chat', message);
    }

    // Tell people with an activity on this route in the next 48 hours.
    const soon = db
      .prepare(
        `SELECT DISTINCT p.user_id, a.id AS activity_id, a.title FROM activity_participants p
         JOIN activity_plans a ON a.id = p.activity_id
         WHERE a.route_id = ? AND a.status = 'open' AND p.status = 'joined' AND p.user_id != ?
           AND a.starts_at BETWEEN ? AND ?`,
      )
      .all(r.id, req.user.id, new Date(Date.now() - 6 * 3600 * 1000).toISOString(), new Date(Date.now() + 48 * 3600 * 1000).toISOString());
    const seen = new Set();
    for (const s of soon) {
      if (seen.has(s.user_id)) continue;
      seen.add(s.user_id);
      notifier.notify(s.user_id, {
        type: 'track_update',
        title: `New condition on ${r.name}`,
        body: `${report.categoryLabel}: ${value.replace('_', ' ')}${km != null ? ` at KM ${km}` : ''}`,
        link: `/activities/${s.activity_id}`,
      });
    }
    res.status(201).json({ report });
  });

  return router;
}
