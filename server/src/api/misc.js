import { Router } from 'express';
import { ACTIVITY_KEYS, ACTIVITY_TYPES, CONDITION_CATEGORIES, DIFFICULTIES } from '../activities.js';
import { HttpError, requireAdmin, requireUser } from '../auth.js';
import { haversine } from '../geo.js';
import { DEFAULT_SETTINGS, NOTIFICATION_TYPES } from '../notify.js';
import { PLACE_CATEGORIES } from '../places.js';
import {
  ACTIVITY_SELECT,
  COMMUNITY_SELECT,
  EVENT_SELECT,
  ROUTE_SELECT,
  activitySummary,
  communitySummary,
  eventSummary,
  notification,
  routeSummary,
  trackReport,
} from '../serialize.js';
import { parseJson } from '../validate.js';
import * as v from '../validate.js';
import { NOTIFICATION_RADII_KM } from './community.js';

// Preset home locations for onboarding; users can also share GPS instead.
export const CITIES = [
  { name: 'Jakarta Pusat', lat: -6.1865, lng: 106.8341 },
  { name: 'Jakarta Selatan', lat: -6.2615, lng: 106.8106 },
  { name: 'BSD / Tangerang Selatan', lat: -6.302, lng: 106.6528 },
  { name: 'Tangerang', lat: -6.1783, lng: 106.6319 },
  { name: 'Depok', lat: -6.4025, lng: 106.7942 },
  { name: 'Bekasi', lat: -6.2383, lng: 106.9756 },
  { name: 'Bogor', lat: -6.595, lng: 106.8166 },
  { name: 'Bandung', lat: -6.9175, lng: 107.6191 },
  { name: 'Yogyakarta', lat: -7.7956, lng: 110.3695 },
  { name: 'Surabaya', lat: -7.2575, lng: 112.7521 },
  { name: 'Denpasar / Bali', lat: -8.6705, lng: 115.2126 },
];
const DEFAULT_CENTER = CITIES[0];

const REPORT_TARGETS = ['route', 'activity', 'user', 'community', 'event', 'message'];
export const REPORT_REASONS = {
  dangerous_route: 'Dangerous route',
  wrong_gpx: 'Wrong GPX',
  fake_activity: 'Fake activity',
  harassment: 'Harassment',
  spam: 'Spam',
  unsafe_event: 'Unsafe event',
  inappropriate: 'Inappropriate content',
  other: 'Other',
};

export function miscRouter({ db, hub, config }) {
  const router = Router();

  router.get('/meta', (_req, res) => {
    res.json({
      appName: config.appName,
      demoMode: config.demoMode,
      activityTypes: ACTIVITY_KEYS.map((key) => ({ key, label: ACTIVITY_TYPES[key].label })),
      difficulties: DIFFICULTIES,
      conditionCategories: Object.fromEntries(
        Object.entries(CONDITION_CATEGORIES).map(([k, c]) => [k, { label: c.label, values: c.values }]),
      ),
      placeCategories: PLACE_CATEGORIES,
      notificationTypes: NOTIFICATION_TYPES,
      defaultNotifySettings: DEFAULT_SETTINGS,
      notificationRadii: NOTIFICATION_RADII_KM,
      reportReasons: REPORT_REASONS,
      cities: CITIES,
      defaultCenter: DEFAULT_CENTER,
    });
  });

  router.get('/home', (req, res) => {
    const viewerId = req.user?.id ?? 0;
    const qLat = v.lat(req.query.lat, 'Latitude');
    const qLng = v.lng(req.query.lng, 'Longitude');
    const center =
      qLat != null && qLng != null
        ? { lat: qLat, lng: qLng }
        : req.user?.lat != null
          ? { lat: req.user.lat, lng: req.user.lng }
          : DEFAULT_CENTER;
    const activity = v.oneOf(req.query.activity, 'Activity', ACTIVITY_KEYS);
    const preferred = activity ? [activity] : parseJson(req.user?.activities, []);
    const matches = (type) => !preferred.length || preferred.includes(type);
    const dist = (lat, lng) => Math.round(haversine(center.lat, center.lng, lat, lng));

    const nearby = db
      .prepare(
        `${ACTIVITY_SELECT} WHERE a.status = 'open' AND a.visibility = 'public' AND r.hidden = 0 AND a.starts_at > ?
         ORDER BY a.starts_at LIMIT 500`,
      )
      .all(viewerId, new Date(Date.now() - 3600 * 1000).toISOString())
      .map((a) => ({ ...a, distance_from_you_m: dist(a.meeting_lat, a.meeting_lng) }))
      .filter((a) => a.distance_from_you_m <= 50000 && matches(a.activity_type));

    const routes = db
      .prepare(`${ROUTE_SELECT} WHERE r.hidden = 0 AND r.visibility = 'public'`)
      .all()
      .filter((r) => matches(r.activity_type))
      .map((r) => ({ ...r, distance_from_you_m: dist(r.start_lat, r.start_lng) }))
      .sort((a, b) => b.completed_count + b.upcoming_count * 2 - (a.completed_count + a.upcoming_count * 2));

    const events = db
      .prepare(
        `${EVENT_SELECT} WHERE e.hidden = 0 AND c.hidden = 0 AND c.privacy = 'public' AND e.starts_at > ? AND e.starts_at < ?
         ORDER BY e.starts_at LIMIT 200`,
      )
      .all(viewerId, new Date().toISOString(), new Date(Date.now() + 30 * 864e5).toISOString())
      .map((e) => ({ ...e, distance_from_you_m: dist(e.lat, e.lng) }))
      .filter((e) => e.distance_from_you_m <= 100000 && matches(e.activity_type));

    const conditions = db
      .prepare(
        `SELECT t.*, u.name AS user_name, r.name AS route_name, r.activity_type FROM track_reports t
         JOIN users u ON u.id = t.user_id JOIN routes r ON r.id = t.route_id
         WHERE r.hidden = 0 AND r.visibility = 'public' AND t.created_at > ? ORDER BY t.created_at DESC LIMIT 50`,
      )
      .all(new Date(Date.now() - 864e5).toISOString())
      .filter((t) => matches(t.activity_type))
      .slice(0, 6)
      .map(trackReport);

    const communities = db
      .prepare(`${COMMUNITY_SELECT} WHERE c.hidden = 0`)
      .all(viewerId, viewerId)
      .filter((c) => matches(c.activity_type))
      .sort((a, b) => b.member_count - a.member_count)
      .slice(0, 4)
      .map(communitySummary);

    res.json({
      center,
      nearbyCount: nearby.length,
      nearbyActivities: nearby.slice(0, 6).map(activitySummary),
      popularRoutes: routes.slice(0, 6).map(routeSummary),
      upcomingEvents: events.slice(0, 4).map(eventSummary),
      recentConditions: conditions,
      popularCommunities: communities,
    });
  });

  router.get('/search', (req, res) => {
    const term = v.text(req.query.q, 'Search', { max: 80 });
    if (term.length < 2) return res.json({ routes: [], communities: [], events: [], users: [], places: [] });
    const like = `%${term}%`;
    const viewerId = req.user?.id ?? 0;
    res.json({
      routes: db
        .prepare(`${ROUTE_SELECT} WHERE r.hidden = 0 AND r.visibility = 'public' AND (r.name LIKE ? OR r.location_name LIKE ?) LIMIT 8`)
        .all(like, like)
        .map(routeSummary),
      communities: db
        .prepare(`${COMMUNITY_SELECT} WHERE c.hidden = 0 AND (c.name LIKE ? OR c.location_name LIKE ? OR c.description LIKE ?) LIMIT 8`)
        .all(viewerId, viewerId, like, like, like)
        .map(communitySummary),
      events: db
        .prepare(
          `${EVENT_SELECT} WHERE e.hidden = 0 AND c.hidden = 0 AND c.privacy = 'public' AND e.starts_at > ?
             AND (e.title LIKE ? OR e.meeting_point LIKE ? OR c.name LIKE ?) ORDER BY e.starts_at LIMIT 8`,
        )
        .all(viewerId, new Date().toISOString(), like, like, like)
        .map(eventSummary),
      users: db
        .prepare("SELECT id, name, location_name FROM users WHERE suspended = 0 AND privacy = 'public' AND name LIKE ? LIMIT 8")
        .all(like)
        .map((u) => ({ id: u.id, name: u.name, locationName: u.location_name })),
      places: db
        .prepare('SELECT id, name, category, lat, lng, address FROM places WHERE name LIKE ? OR address LIKE ? LIMIT 8')
        .all(like, like)
        .map((p) => ({ ...p, ...PLACE_CATEGORIES[p.category] })),
    });
  });

  // ---- Notifications -----------------------------------------------------

  router.get('/notifications', requireUser, (req, res) => {
    const rows = db
      .prepare('SELECT * FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT 100')
      .all(req.user.id)
      .map(notification);
    const unread = db
      .prepare('SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND read_at IS NULL')
      .get(req.user.id).n;
    res.json({ notifications: rows, unread });
  });

  router.post('/notifications/read', requireUser, (req, res) => {
    const now = new Date().toISOString();
    if (Array.isArray(req.body.ids) && req.body.ids.length) {
      const ids = req.body.ids.map((id) => v.idParam(id)).slice(0, 200);
      db.prepare(
        `UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL AND id IN (${ids.map(() => '?').join(',')})`,
      ).run(now, req.user.id, ...ids);
    } else {
      db.prepare('UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL').run(now, req.user.id);
    }
    res.json({ ok: true });
  });

  router.get('/stream', requireUser, (req, res) => {
    hub.subscribe(req.user.id, res);
  });

  // ---- Content reports (FR-18) and moderation (PRD §29) ------------------

  router.post('/reports', requireUser, (req, res) => {
    const targetType = v.oneOf(req.body.targetType, 'Type', REPORT_TARGETS, { required: true });
    const targetId = v.int(req.body.targetId, 'Target', { min: 1, required: true });
    const reason = v.oneOf(req.body.reason, 'Reason', Object.keys(REPORT_REASONS), { required: true });
    const details = v.text(req.body.details, 'Details', { max: 1000 });
    const table = { route: 'routes', activity: 'activity_plans', user: 'users', community: 'communities', event: 'events', message: 'chat_messages' }[targetType];
    if (!db.prepare(`SELECT 1 FROM ${table} WHERE id = ?`).get(targetId)) throw new HttpError(404, 'That item no longer exists');
    const dup = db
      .prepare("SELECT 1 FROM content_reports WHERE reporter_id = ? AND target_type = ? AND target_id = ? AND status = 'open'")
      .get(req.user.id, targetType, targetId);
    if (!dup) {
      db.prepare('INSERT INTO content_reports (reporter_id, target_type, target_id, reason, details) VALUES (?, ?, ?, ?, ?)').run(
        req.user.id, targetType, targetId, reason, details,
      );
    }
    res.status(201).json({ ok: true });
  });

  const describeTarget = (type, id) => {
    const q = {
      route: 'SELECT name AS label FROM routes WHERE id = ?',
      activity: 'SELECT title AS label FROM activity_plans WHERE id = ?',
      user: 'SELECT name AS label FROM users WHERE id = ?',
      community: 'SELECT name AS label FROM communities WHERE id = ?',
      event: 'SELECT title AS label FROM events WHERE id = ?',
      message: 'SELECT body AS label, activity_id FROM chat_messages WHERE id = ?',
    }[type];
    const row = db.prepare(q).get(id);
    if (!row) return { label: '(deleted)', link: null };
    const link = {
      route: `/routes/${id}`,
      activity: `/activities/${id}`,
      user: `/users/${id}`,
      community: `/communities/${id}`,
      event: `/events/${id}`,
      message: row.activity_id ? `/activities/${row.activity_id}` : null,
    }[type];
    return { label: row.label, link };
  };

  router.get('/admin/overview', requireUser, requireAdmin, (_req, res) => {
    const count = (sql) => db.prepare(sql).get().n;
    const weekAgo = new Date(Date.now() - 7 * 864e5).toISOString();
    res.json({
      users: count('SELECT COUNT(*) AS n FROM users'),
      routes: count('SELECT COUNT(*) AS n FROM routes'),
      activities: count('SELECT COUNT(*) AS n FROM activity_plans'),
      communities: count('SELECT COUNT(*) AS n FROM communities'),
      events: count('SELECT COUNT(*) AS n FROM events'),
      openReports: count("SELECT COUNT(*) AS n FROM content_reports WHERE status = 'open'"),
      // North-star metric (PRD §45): users with at least one social/outdoor
      // action in the last 7 days.
      weeklyActiveParticipants: db
        .prepare(
          `SELECT COUNT(DISTINCT user_id) AS n FROM (
             SELECT user_id FROM activity_participants WHERE joined_at > ?1 OR checked_in_at > ?1
             UNION SELECT creator_id FROM activity_plans WHERE created_at > ?1
             UNION SELECT user_id FROM track_reports WHERE created_at > ?1
             UNION SELECT user_id FROM event_participants WHERE created_at > ?1)`,
        )
        .get(weekAgo).n,
    });
  });

  router.get('/admin/reports', requireUser, requireAdmin, (req, res) => {
    const status = v.oneOf(req.query.status ?? 'open', 'Status', ['open', 'resolved']);
    const rows = db
      .prepare(
        `SELECT r.*, u.name AS reporter_name FROM content_reports r JOIN users u ON u.id = r.reporter_id
         WHERE r.status = ? ORDER BY r.created_at DESC LIMIT 200`,
      )
      .all(status);
    res.json({
      reports: rows.map((r) => ({
        id: r.id,
        targetType: r.target_type,
        targetId: r.target_id,
        target: describeTarget(r.target_type, r.target_id),
        reason: r.reason,
        reasonLabel: REPORT_REASONS[r.reason] ?? r.reason,
        details: r.details,
        status: r.status,
        reporter: { id: r.reporter_id, name: r.reporter_name },
        createdAt: r.created_at,
      })),
    });
  });

  router.post('/admin/reports/:id', requireUser, requireAdmin, (req, res) => {
    const r = db.prepare('SELECT * FROM content_reports WHERE id = ?').get(v.idParam(req.params.id));
    if (!r) throw new HttpError(404, 'Report not found');
    const action = v.oneOf(req.body.action, 'Action', ['dismiss', 'remove', 'flag_unsafe'], { required: true });
    if (action === 'remove') {
      const sql = {
        route: 'UPDATE routes SET hidden = 1 WHERE id = ?',
        activity: "UPDATE activity_plans SET status = 'cancelled' WHERE id = ?",
        user: 'UPDATE users SET suspended = 1 WHERE id = ? AND is_admin = 0',
        community: 'UPDATE communities SET hidden = 1 WHERE id = ?',
        event: 'UPDATE events SET hidden = 1 WHERE id = ?',
        message: "UPDATE chat_messages SET body = '[removed by moderator]', data = NULL WHERE id = ?",
      }[r.target_type];
      db.prepare(sql).run(r.target_id);
      if (r.target_type === 'user') db.prepare('DELETE FROM sessions WHERE user_id = ?').run(r.target_id);
    } else if (action === 'flag_unsafe') {
      if (r.target_type !== 'route') throw new HttpError(400, 'Only routes can be flagged unsafe');
      db.prepare('UPDATE routes SET flagged_unsafe = 1 WHERE id = ?').run(r.target_id);
    }
    // Resolve every open report about the same item at once.
    db.prepare("UPDATE content_reports SET status = 'resolved' WHERE target_type = ? AND target_id = ? AND status = 'open'").run(
      r.target_type, r.target_id,
    );
    res.json({ ok: true });
  });

  return router;
}
