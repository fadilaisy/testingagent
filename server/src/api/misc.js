import { Router } from 'express';
import { ACTIVITY_KEYS, ACTIVITY_TYPES, CONDITION_CATEGORIES, DIFFICULTIES } from '../activities.js';
import { HttpError, requireAdmin, requireUser } from '../auth.js';
import { haversine, thumbLine } from '../geo.js';
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
import { MAX_PRICE_IDR, MIN_PRICE_IDR } from '../payments.js';
import { EVENT_KINDS, NOTIFICATION_RADII_KM } from './community.js';

const ORGANIZER_STATUSES = ['pending', 'approved', 'rejected'];

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

export function miscRouter({ db, hub, config, payments, google, notifier }) {
  const router = Router();

  // Liveness check for the host: answers only when the database does.
  router.get('/health', async (_req, res) => {
    await db.prepare('SELECT 1').get();
    res.set('cache-control', 'no-store').json({ ok: true });
  });

  router.get('/meta', (_req, res) => {
    res.json({
      appName: config.appName,
      demoMode: config.demoMode,
      inviteRequired: Boolean(config.signupCode),
      googleLogin: Boolean(google),
      activityTypes: ACTIVITY_KEYS.map((key) => ({ key, label: ACTIVITY_TYPES[key].label })),
      difficulties: DIFFICULTIES,
      conditionCategories: Object.fromEntries(
        Object.entries(CONDITION_CATEGORIES).map(([k, c]) => [k, { label: c.label, values: c.values }]),
      ),
      placeCategories: PLACE_CATEGORIES,
      notificationTypes: NOTIFICATION_TYPES,
      defaultNotifySettings: DEFAULT_SETTINGS,
      notificationRadii: NOTIFICATION_RADII_KM,
      eventKinds: EVENT_KINDS,
      payments: {
        // Online payment (Midtrans) is only offered when the server has keys;
        // otherwise paid events use manual confirmation by email.
        gateway: payments ? { provider: payments.name, environment: payments.environment } : null,
        minPriceIdr: MIN_PRICE_IDR,
        maxPriceIdr: MAX_PRICE_IDR,
      },
      reportReasons: REPORT_REASONS,
      cities: CITIES,
      defaultCenter: DEFAULT_CENTER,
    });
  });

  // The viewer's own column on Home: totals, the last 7 days, and what is next.
  async function homeMe(u) {
    const outings = await db
      .prepare(
        `SELECT a.id, a.title, a.activity_type, a.starts_at, r.distance_m, r.elevation_gain
         FROM activity_participants p JOIN activity_plans a ON a.id = p.activity_id JOIN routes r ON r.id = a.route_id
         WHERE p.user_id = ? AND p.checked_in_at IS NOT NULL AND a.status != 'cancelled' ORDER BY a.starts_at DESC`,
      )
      .all(u.id);
    const weekAgo = new Date(Date.now() - 7 * 864e5).toISOString();
    const week = outings.filter((o) => o.starts_at > weekAgo);
    const next = await db
      .prepare(
        `${ACTIVITY_SELECT} WHERE a.status = 'open' AND a.starts_at > ?
           AND EXISTS (SELECT 1 FROM activity_participants p WHERE p.activity_id = a.id AND p.user_id = ? AND p.status = 'joined')
         ORDER BY a.starts_at LIMIT 1`,
      )
      .get(u.id, new Date(Date.now() - 3600 * 1000).toISOString(), u.id);
    const communities = (await db.prepare("SELECT COUNT(*) AS n FROM community_members WHERE user_id = ? AND status = 'member'").get(u.id)).n;
    const latest = outings[0];
    return {
      id: u.id,
      name: u.name,
      locationName: u.location_name,
      stats: {
        outings: outings.length,
        totalDistanceM: outings.reduce((s, o) => s + o.distance_m, 0),
        communities,
        weekOutings: week.length,
        weekDistanceM: week.reduce((s, o) => s + o.distance_m, 0),
        weekElevationM: week.reduce((s, o) => s + (o.elevation_gain ?? 0), 0),
      },
      latest: latest ? { id: latest.id, title: latest.title, activityType: latest.activity_type, date: latest.starts_at, distanceM: latest.distance_m } : null,
      next: next ? activitySummary(next) : null,
    };
  }

  router.get('/home', async (req, res) => {
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

    const nearby = (await db
      .prepare(
        `${ACTIVITY_SELECT} WHERE a.status = 'open' AND a.visibility = 'public' AND r.hidden = 0 AND a.starts_at > ?
         ORDER BY a.starts_at LIMIT 500`,
      )
      .all(viewerId, new Date(Date.now() - 3600 * 1000).toISOString()))
      .map((a) => ({ ...a, distance_from_you_m: dist(a.meeting_lat, a.meeting_lng) }))
      .filter((a) => a.distance_from_you_m <= 50000 && matches(a.activity_type));

    const routes = (await db
      .prepare(`${ROUTE_SELECT} WHERE r.hidden = 0 AND r.visibility = 'public'`)
      .all())
      .filter((r) => matches(r.activity_type))
      .map((r) => ({ ...r, distance_from_you_m: dist(r.start_lat, r.start_lng) }))
      .sort((a, b) => b.completed_count + b.upcoming_count * 2 - (a.completed_count + a.upcoming_count * 2));

    const events = (await db
      .prepare(
        `${EVENT_SELECT} WHERE e.hidden = 0 AND c.hidden = 0 AND c.privacy = 'public' AND e.starts_at > ? AND e.starts_at < ?
         ORDER BY e.starts_at LIMIT 200`,
      )
      .all(viewerId, new Date().toISOString(), new Date(Date.now() + 30 * 864e5).toISOString()))
      .map((e) => ({ ...e, distance_from_you_m: dist(e.lat, e.lng) }))
      .filter((e) => e.distance_from_you_m <= 100000 && matches(e.activity_type));

    const conditions = (await db
      .prepare(
        `SELECT t.*, u.name AS user_name, r.name AS route_name, r.activity_type FROM track_reports t
         JOIN users u ON u.id = t.user_id JOIN routes r ON r.id = t.route_id
         WHERE r.hidden = 0 AND r.visibility = 'public' AND t.created_at > ? ORDER BY t.created_at DESC LIMIT 50`,
      )
      .all(new Date(Date.now() - 864e5).toISOString()))
      .filter((t) => matches(t.activity_type))
      .slice(0, 6)
      .map(trackReport);

    const communities = (await db
      .prepare(`${COMMUNITY_SELECT} WHERE c.hidden = 0`)
      .all(viewerId, viewerId))
      .filter((c) => matches(c.activity_type))
      .sort((a, b) => b.member_count - a.member_count)
      .slice(0, 4)
      .map(communitySummary);

    // Feed cards draw each route as a small line, so they carry a cut-down copy.
    const lineOf = db.prepare('SELECT geometry FROM routes WHERE id = ?');
    const withLine = async (a) => ({
      ...activitySummary(a),
      routeLine: thumbLine(JSON.parse((await lineOf.get(a.route_id))?.geometry ?? '[]')),
    });

    // Finished together: public outings from the last 30 days that people
    // checked in to (PRD §26 history, "finish together" in the core loop).
    // Names are shown only for public profiles; the rest are counted.
    const finishersOf = db.prepare(
      `SELECT u.id, u.name, u.privacy FROM activity_participants p JOIN users u ON u.id = p.user_id
       WHERE p.activity_id = ? AND p.checked_in_at IS NOT NULL AND u.suspended = 0 ORDER BY p.checked_in_at`,
    );
    const reportsOf = db.prepare('SELECT COUNT(*) AS n FROM track_reports WHERE activity_id = ?');
    const finished = await Promise.all((await db
      .prepare(
        `${ACTIVITY_SELECT} WHERE a.status != 'cancelled' AND a.visibility = 'public' AND r.hidden = 0
           AND a.starts_at < ? AND a.starts_at > ?
           AND EXISTS (SELECT 1 FROM activity_participants p WHERE p.activity_id = a.id AND p.checked_in_at IS NOT NULL)
         ORDER BY a.starts_at DESC LIMIT 200`,
      )
      .all(viewerId, new Date().toISOString(), new Date(Date.now() - 30 * 864e5).toISOString()))
      .filter((a) => dist(a.meeting_lat, a.meeting_lng) <= 100000 && matches(a.activity_type))
      .slice(0, 8)
      .map(async (a) => {
        const people = await finishersOf.all(a.id);
        return {
          ...(await withLine(a)),
          finishedCount: people.length,
          finishers: people.filter((u) => u.privacy !== 'private' || u.id === viewerId).map((u) => ({ id: u.id, name: u.name })),
          reportCount: (await reportsOf.get(a.id)).n,
        };
      }));

    res.json({
      center,
      me: req.user ? await homeMe(req.user) : null,
      nearbyCount: nearby.length,
      nearbyActivities: await Promise.all(nearby.slice(0, 6).map(withLine)),
      finishedActivities: finished,
      popularRoutes: routes.slice(0, 6).map(routeSummary),
      upcomingEvents: events.slice(0, 4).map(eventSummary),
      recentConditions: conditions,
      popularCommunities: communities,
    });
  });

  router.get('/search', async (req, res) => {
    const term = v.text(req.query.q, 'Search', { max: 80 });
    if (term.length < 2) return res.json({ routes: [], communities: [], events: [], users: [], places: [] });
    const like = `%${term}%`;
    const viewerId = req.user?.id ?? 0;
    res.json({
      routes: (await db
        .prepare(`${ROUTE_SELECT} WHERE r.hidden = 0 AND r.visibility = 'public' AND (r.name ILIKE ? OR r.location_name ILIKE ?) LIMIT 8`)
        .all(like, like))
        .map(routeSummary),
      communities: (await db
        .prepare(`${COMMUNITY_SELECT} WHERE c.hidden = 0 AND (c.name ILIKE ? OR c.location_name ILIKE ? OR c.description ILIKE ?) LIMIT 8`)
        .all(viewerId, viewerId, like, like, like))
        .map(communitySummary),
      events: (await db
        .prepare(
          `${EVENT_SELECT} WHERE e.hidden = 0 AND c.hidden = 0 AND c.privacy = 'public' AND e.starts_at > ?
             AND (e.title ILIKE ? OR e.meeting_point ILIKE ? OR c.name ILIKE ?) ORDER BY e.starts_at LIMIT 8`,
        )
        .all(viewerId, new Date().toISOString(), like, like, like))
        .map(eventSummary),
      users: (await db
        .prepare("SELECT id, name, location_name FROM users WHERE suspended = 0 AND privacy = 'public' AND name ILIKE ? LIMIT 8")
        .all(like))
        .map((u) => ({ id: u.id, name: u.name, locationName: u.location_name })),
      places: (await db
        .prepare('SELECT id, name, category, lat, lng, address FROM places WHERE name ILIKE ? OR address ILIKE ? LIMIT 8')
        .all(like, like))
        .map((p) => ({ ...p, ...PLACE_CATEGORIES[p.category] })),
    });
  });

  // ---- Notifications -----------------------------------------------------

  router.get('/notifications', requireUser, async (req, res) => {
    const rows = (await db
      .prepare('SELECT * FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT 100')
      .all(req.user.id))
      .map(notification);
    const unread = (await db
      .prepare('SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND read_at IS NULL')
      .get(req.user.id)).n;
    res.json({ notifications: rows, unread });
  });

  router.post('/notifications/read', requireUser, async (req, res) => {
    const now = new Date().toISOString();
    if (Array.isArray(req.body.ids) && req.body.ids.length) {
      const ids = req.body.ids.map((id) => v.idParam(id)).slice(0, 200);
      await db.prepare(
        `UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL AND id IN (${ids.map(() => '?').join(',')})`,
      ).run(now, req.user.id, ...ids);
    } else {
      await db.prepare('UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL').run(now, req.user.id);
    }
    res.json({ ok: true });
  });

  router.get('/stream', requireUser, (req, res) => {
    hub.subscribe(req.user.id, res);
  });

  // ---- Content reports (FR-18) and moderation (PRD §29) ------------------

  router.post('/reports', requireUser, async (req, res) => {
    const targetType = v.oneOf(req.body.targetType, 'Type', REPORT_TARGETS, { required: true });
    const targetId = v.int(req.body.targetId, 'Target', { min: 1, required: true });
    const reason = v.oneOf(req.body.reason, 'Reason', Object.keys(REPORT_REASONS), { required: true });
    const details = v.text(req.body.details, 'Details', { max: 1000 });
    const table = { route: 'routes', activity: 'activity_plans', user: 'users', community: 'communities', event: 'events', message: 'chat_messages' }[targetType];
    if (!(await db.prepare(`SELECT 1 FROM ${table} WHERE id = ?`).get(targetId))) throw new HttpError(404, 'That item no longer exists');
    const dup = await db
      .prepare("SELECT 1 FROM content_reports WHERE reporter_id = ? AND target_type = ? AND target_id = ? AND status = 'open'")
      .get(req.user.id, targetType, targetId);
    if (!dup) {
      await db.prepare('INSERT INTO content_reports (reporter_id, target_type, target_id, reason, details) VALUES (?, ?, ?, ?, ?)').run(
        req.user.id, targetType, targetId, reason, details,
      );
    }
    res.status(201).json({ ok: true });
  });

  const describeTarget = async (type, id) => {
    const q = {
      route: 'SELECT name AS label FROM routes WHERE id = ?',
      activity: 'SELECT title AS label FROM activity_plans WHERE id = ?',
      user: 'SELECT name AS label FROM users WHERE id = ?',
      community: 'SELECT name AS label FROM communities WHERE id = ?',
      event: 'SELECT title AS label FROM events WHERE id = ?',
      message: 'SELECT body AS label, activity_id FROM chat_messages WHERE id = ?',
    }[type];
    const row = await db.prepare(q).get(id);
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

  router.get('/admin/overview', requireUser, requireAdmin, async (_req, res) => {
    const count = async (sql) => (await db.prepare(sql).get()).n;
    const weekAgo = new Date(Date.now() - 7 * 864e5).toISOString();
    res.json({
      users: await count('SELECT COUNT(*) AS n FROM users'),
      routes: await count('SELECT COUNT(*) AS n FROM routes'),
      activities: await count('SELECT COUNT(*) AS n FROM activity_plans'),
      communities: await count('SELECT COUNT(*) AS n FROM communities'),
      events: await count('SELECT COUNT(*) AS n FROM events'),
      openReports: await count("SELECT COUNT(*) AS n FROM content_reports WHERE status = 'open'"),
      pendingOrganizers: await count("SELECT COUNT(*) AS n FROM communities WHERE kind = 'organizer' AND organizer_status = 'pending' AND hidden = 0"),
      // North-star metric (PRD §45): users with at least one social/outdoor
      // action in the last 7 days.
      weeklyActiveParticipants: (await db
        .prepare(
          `SELECT COUNT(DISTINCT user_id) AS n FROM (
             SELECT user_id FROM activity_participants WHERE joined_at > ?1 OR checked_in_at > ?1
             UNION SELECT creator_id FROM activity_plans WHERE created_at > ?1
             UNION SELECT user_id FROM track_reports WHERE created_at > ?1
             UNION SELECT user_id FROM event_participants WHERE created_at > ?1)`,
        )
        .get(weekAgo)).n,
    });
  });

  router.get('/admin/organizers', requireUser, requireAdmin, async (req, res) => {
    const status = v.oneOf(req.query.status ?? 'pending', 'Status', ORGANIZER_STATUSES);
    const rows = await db
      .prepare(
        `SELECT c.*, u.name AS owner_name, u.email AS owner_email FROM communities c JOIN users u ON u.id = c.owner_id
         WHERE c.kind = 'organizer' AND c.organizer_status = ? AND c.hidden = 0 ORDER BY c.created_at LIMIT 200`,
      )
      .all(status);
    res.json({ organizers: rows.map((c) => ({ ...communitySummary(c), ownerEmail: c.owner_email })) });
  });

  router.post('/admin/organizers/:id', requireUser, requireAdmin, async (req, res) => {
    const c = await db
      .prepare("SELECT * FROM communities WHERE id = ? AND kind = 'organizer' AND hidden = 0")
      .get(v.idParam(req.params.id));
    if (!c) throw new HttpError(404, 'Organizer not found');
    const action = v.oneOf(req.body.action, 'Action', ['approve', 'reject'], { required: true });
    const status = action === 'approve' ? 'approved' : 'rejected';
    await db.prepare('UPDATE communities SET organizer_status = ? WHERE id = ?').run(status, c.id);
    await notifier.notify(c.owner_id, {
      type: 'community',
      title: action === 'approve' ? `${c.name} is a verified organizer` : `${c.name} was not approved as an organizer`,
      body: action === 'approve' ? 'You can now create paid events.' : 'You can still run free community events. Contact the ROAMR team if you think this is a mistake.',
      link: `/communities/${c.id}`,
    });
    res.json({ ok: true, status });
  });

  router.get('/admin/reports', requireUser, requireAdmin, async (req, res) => {
    const status = v.oneOf(req.query.status ?? 'open', 'Status', ['open', 'resolved']);
    const rows = await db
      .prepare(
        `SELECT r.*, u.name AS reporter_name FROM content_reports r JOIN users u ON u.id = r.reporter_id
         WHERE r.status = ? ORDER BY r.created_at DESC LIMIT 200`,
      )
      .all(status);
    res.json({
      reports: await Promise.all(rows.map(async (r) => ({
        id: r.id,
        targetType: r.target_type,
        targetId: r.target_id,
        target: await describeTarget(r.target_type, r.target_id),
        reason: r.reason,
        reasonLabel: REPORT_REASONS[r.reason] ?? r.reason,
        details: r.details,
        status: r.status,
        reporter: { id: r.reporter_id, name: r.reporter_name },
        createdAt: r.created_at,
      }))),
    });
  });

  router.post('/admin/reports/:id', requireUser, requireAdmin, async (req, res) => {
    const r = await db.prepare('SELECT * FROM content_reports WHERE id = ?').get(v.idParam(req.params.id));
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
      await db.prepare(sql).run(r.target_id);
      if (r.target_type === 'user') await db.prepare('DELETE FROM sessions WHERE user_id = ?').run(r.target_id);
    } else if (action === 'flag_unsafe') {
      if (r.target_type !== 'route') throw new HttpError(400, 'Only routes can be flagged unsafe');
      await db.prepare('UPDATE routes SET flagged_unsafe = 1 WHERE id = ?').run(r.target_id);
    }
    // Resolve every open report about the same item at once.
    await db.prepare("UPDATE content_reports SET status = 'resolved' WHERE target_type = ? AND target_id = ? AND status = 'open'").run(
      r.target_type, r.target_id,
    );
    res.json({ ok: true });
  });

  return router;
}
