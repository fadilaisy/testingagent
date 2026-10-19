import { Router } from 'express';
import { ACTIVITY_KEYS, DIFFICULTIES } from '../activities.js';
import { HttpError, isPremium, requireUser } from '../auth.js';
import { transaction } from '../db.js';
import { haversine } from '../geo.js';
import {
  COMMUNITY_SELECT,
  EVENT_SELECT,
  communitySummary,
  eventSummary,
  routeSummary,
  ROUTE_SELECT,
} from '../serialize.js';
import * as v from '../validate.js';

export const NOTIFICATION_RADII_KM = [5, 10, 25, 50];
// Communities whose owner is not premium keep working but are limited
// (PRD §21: unlimited events and nearby notifications are premium).
export const FREE_UPCOMING_EVENT_LIMIT = 2;

export function communityRouter({ db, notifier }) {
  const router = Router();

  const loadCommunity = (id, viewerId = 0) => {
    const c = db.prepare(`${COMMUNITY_SELECT} WHERE c.id = ?`).get(viewerId, viewerId, id);
    if (!c || c.hidden) throw new HttpError(404, 'Community not found');
    return c;
  };
  const isMember = (c) => c.my_status === 'member';
  const isAdmin = (c) => isMember(c) && c.my_role === 'admin';

  const memberIds = (communityId) =>
    db
      .prepare("SELECT user_id FROM community_members WHERE community_id = ? AND status = 'member'")
      .all(communityId)
      .map((r) => r.user_id);

  // ---- Communities -------------------------------------------------------

  router.get('/communities', (req, res) => {
    const q = req.query;
    const viewerId = req.user?.id ?? 0;
    const where = ['c.hidden = 0'];
    const params = [viewerId, viewerId];
    if (q.mine === '1') {
      where.push("EXISTS (SELECT 1 FROM community_members m WHERE m.community_id = c.id AND m.user_id = ? AND m.status = 'member')");
      params.push(viewerId);
    }
    if (q.activity) {
      where.push('c.activity_type = ?');
      params.push(v.oneOf(q.activity, 'Activity', ACTIVITY_KEYS));
    }
    if (q.q) {
      const like = `%${v.text(q.q, 'Search', { max: 80 })}%`;
      where.push('(c.name LIKE ? OR c.description LIKE ? OR c.location_name LIKE ?)');
      params.push(like, like, like);
    }
    const rows = db.prepare(`${COMMUNITY_SELECT} WHERE ${where.join(' AND ')} LIMIT 300`).all(...params);
    const lat = v.lat(q.lat, 'Latitude');
    const lng = v.lng(q.lng, 'Longitude');
    if (q.sort === 'nearby' && lat != null && lng != null) {
      const dist = (c) => (c.lat != null ? haversine(lat, lng, c.lat, c.lng) : Infinity);
      rows.sort((a, b) => dist(a) - dist(b));
    } else {
      rows.sort((a, b) => b.member_count - a.member_count);
    }
    const limit = v.int(q.limit, 'Limit', { min: 1, max: 100, fallback: 30 });
    res.json({ communities: rows.slice(0, limit).map(communitySummary) });
  });

  router.post('/communities', requireUser, (req, res) => {
    if (!isPremium(db, req.user.id)) {
      throw new HttpError(402, 'Creating a community needs the Premium Community Creator plan', { premiumRequired: true });
    }
    const b = req.body;
    const name = v.text(b.name, 'Name', { max: 80, required: true });
    if (db.prepare('SELECT 1 FROM communities WHERE name = ? COLLATE NOCASE AND hidden = 0').get(name)) {
      throw new HttpError(409, 'A community with this name already exists', { field: 'Name' });
    }
    const id = transaction(db, () => {
      const { id } = db
        .prepare(
          `INSERT INTO communities (owner_id, name, description, activity_type, location_name, lat, lng, rules, privacy)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
        )
        .get(
          req.user.id, name, v.text(b.description, 'Description', { max: 2000 }),
          v.oneOf(b.activityType, 'Activity', ACTIVITY_KEYS, { required: true }),
          v.text(b.locationName, 'Location', { max: 80 }) || null, v.lat(b.lat, 'Latitude'), v.lng(b.lng, 'Longitude'),
          v.text(b.rules, 'Rules', { max: 2000 }), v.oneOf(b.privacy ?? 'public', 'Privacy', ['public', 'private']),
        );
      db.prepare("INSERT INTO community_members (community_id, user_id, role, status) VALUES (?, ?, 'admin', 'member')").run(id, req.user.id);
      return id;
    });
    res.status(201).json({ community: communitySummary(loadCommunity(id, req.user.id)) });
  });

  router.get('/communities/:id', (req, res) => {
    const viewerId = req.user?.id ?? 0;
    const c = loadCommunity(v.idParam(req.params.id), viewerId);
    const canSeeInside = c.privacy === 'public' || isMember(c);
    const admins = db
      .prepare(
        `SELECT u.id, u.name FROM community_members m JOIN users u ON u.id = m.user_id
         WHERE m.community_id = ? AND m.role = 'admin' AND m.status = 'member'`,
      )
      .all(c.id);
    const events = canSeeInside
      ? db
          .prepare(`${EVENT_SELECT} WHERE e.community_id = ? AND e.hidden = 0 AND e.starts_at > ? ORDER BY e.starts_at LIMIT 20`)
          .all(viewerId, c.id, new Date(Date.now() - 6 * 3600 * 1000).toISOString())
          .map(eventSummary)
      : [];
    const pastEvents = canSeeInside
      ? db
          .prepare(`${EVENT_SELECT} WHERE e.community_id = ? AND e.hidden = 0 AND e.starts_at <= ? ORDER BY e.starts_at DESC LIMIT 10`)
          .all(viewerId, c.id, new Date(Date.now() - 6 * 3600 * 1000).toISOString())
          .map(eventSummary)
      : [];
    const members = canSeeInside
      ? db
          .prepare(
            `SELECT u.id, u.name, m.role FROM community_members m JOIN users u ON u.id = m.user_id
             WHERE m.community_id = ? AND m.status = 'member' ORDER BY m.role = 'admin' DESC, m.joined_at LIMIT 24`,
          )
          .all(c.id)
      : [];
    const requests = isAdmin(c)
      ? db
          .prepare(
            `SELECT u.id, u.name, m.joined_at AS requestedAt FROM community_members m JOIN users u ON u.id = m.user_id
             WHERE m.community_id = ? AND m.status = 'requested'`,
          )
          .all(c.id)
      : [];
    const ownerPremium = isPremium(db, c.owner_id);
    res.json({
      community: {
        ...communitySummary(c),
        rules: c.rules,
        admins,
        isAdmin: isAdmin(c),
        isOwner: viewerId === c.owner_id,
        premiumFeatures: ownerPremium,
      },
      events,
      pastEvents,
      members,
      requests,
    });
  });

  router.post('/communities/:id/join', requireUser, (req, res) => {
    const c = loadCommunity(v.idParam(req.params.id), req.user.id);
    if (c.my_status) return res.json({ status: c.my_status });
    const status = c.privacy === 'private' ? 'requested' : 'member';
    db.prepare('INSERT INTO community_members (community_id, user_id, role, status) VALUES (?, ?, ?, ?)').run(
      c.id, req.user.id, 'member', status,
    );
    if (status === 'requested') {
      notifier.notify(c.owner_id, {
        type: 'community',
        title: `${req.user.name} asked to join ${c.name}`,
        link: `/communities/${c.id}`,
      });
    }
    res.json({ status });
  });

  router.post('/communities/:id/leave', requireUser, (req, res) => {
    const c = loadCommunity(v.idParam(req.params.id), req.user.id);
    if (c.owner_id === req.user.id) throw new HttpError(409, 'The owner cannot leave their own community');
    db.prepare('DELETE FROM community_members WHERE community_id = ? AND user_id = ?').run(c.id, req.user.id);
    res.json({ status: null });
  });

  router.post('/communities/:id/members/:userId/:action', requireUser, (req, res) => {
    const c = loadCommunity(v.idParam(req.params.id), req.user.id);
    if (!isAdmin(c)) throw new HttpError(403, 'Only community admins can manage members');
    const userId = v.idParam(req.params.userId);
    const action = v.oneOf(req.params.action, 'Action', ['approve', 'remove', 'promote', 'demote'], { required: true });
    const m = db.prepare('SELECT * FROM community_members WHERE community_id = ? AND user_id = ?').get(c.id, userId);
    if (!m) throw new HttpError(404, 'Member not found');
    if (userId === c.owner_id) throw new HttpError(409, 'The owner cannot be changed here');
    if ((action === 'promote' || action === 'demote') && req.user.id !== c.owner_id) {
      throw new HttpError(403, 'Only the owner can change admin roles');
    }
    if (action === 'approve') {
      db.prepare("UPDATE community_members SET status = 'member' WHERE community_id = ? AND user_id = ?").run(c.id, userId);
      notifier.notify(userId, { type: 'community', title: `Welcome to ${c.name}`, link: `/communities/${c.id}` });
    } else if (action === 'remove') {
      db.prepare('DELETE FROM community_members WHERE community_id = ? AND user_id = ?').run(c.id, userId);
    } else {
      db.prepare('UPDATE community_members SET role = ? WHERE community_id = ? AND user_id = ?').run(
        action === 'promote' ? 'admin' : 'member', c.id, userId,
      );
    }
    res.json({ ok: true });
  });

  router.post('/communities/:id/announcements', requireUser, (req, res) => {
    const c = loadCommunity(v.idParam(req.params.id), req.user.id);
    if (!isAdmin(c)) throw new HttpError(403, 'Only community admins can send announcements');
    if (!isPremium(db, c.owner_id)) {
      throw new HttpError(402, 'Announcements need the Premium Community Creator plan', { premiumRequired: true });
    }
    const title = v.text(req.body.title, 'Title', { max: 100, required: true });
    const body = v.text(req.body.body, 'Message', { max: 500 });
    const sent = notifier.notifyMany(
      memberIds(c.id).filter((id) => id !== req.user.id),
      { type: 'community', title: `${c.name}: ${title}`, body, link: `/communities/${c.id}` },
    );
    res.json({ sent });
  });

  // ---- Events ------------------------------------------------------------

  const visibleEventWhere = `e.hidden = 0 AND c.hidden = 0 AND (c.privacy = 'public' OR EXISTS (
    SELECT 1 FROM community_members m WHERE m.community_id = c.id AND m.user_id = ? AND m.status = 'member'))`;

  const loadEvent = (id, viewerId = 0) => {
    const e = db.prepare(`${EVENT_SELECT} WHERE e.id = ? AND ${visibleEventWhere}`).get(viewerId, id, viewerId);
    if (!e) throw new HttpError(404, 'Event not found');
    return e;
  };

  router.get('/events', (req, res) => {
    const q = req.query;
    const viewerId = req.user?.id ?? 0;
    const where = [visibleEventWhere, 'e.starts_at > ?'];
    const params = [viewerId, viewerId, v.isoDate(q.from, 'From') ?? new Date(Date.now() - 6 * 3600 * 1000).toISOString()];
    if (q.to) {
      where.push('e.starts_at < ?');
      params.push(v.isoDate(q.to, 'To'));
    }
    if (q.activity) {
      where.push('e.activity_type = ?');
      params.push(v.oneOf(q.activity, 'Activity', ACTIVITY_KEYS));
    }
    if (q.difficulty) {
      where.push('e.difficulty = ?');
      params.push(v.oneOf(q.difficulty, 'Difficulty', DIFFICULTIES));
    }
    if (q.communityId) {
      where.push('e.community_id = ?');
      params.push(v.idParam(q.communityId));
    }
    if (q.mine === '1' && req.user) {
      where.push('EXISTS (SELECT 1 FROM event_participants p WHERE p.event_id = e.id AND p.user_id = ?)');
      params.push(viewerId);
    }
    let rows = db.prepare(`${EVENT_SELECT} WHERE ${where.join(' AND ')} ORDER BY e.starts_at LIMIT 300`).all(...params);
    const lat = v.lat(q.lat, 'Latitude');
    const lng = v.lng(q.lng, 'Longitude');
    if (lat != null && lng != null) {
      rows = rows.map((e) => ({ ...e, distance_from_you_m: Math.round(haversine(lat, lng, e.lat, e.lng)) }));
      const radiusKm = v.num(q.radiusKm, 'Radius', { min: 1, max: 500 });
      if (radiusKm) rows = rows.filter((e) => e.distance_from_you_m <= radiusKm * 1000);
    }
    const limit = v.int(q.limit, 'Limit', { min: 1, max: 100, fallback: 30 });
    res.json({ events: rows.slice(0, limit).map(eventSummary), total: rows.length });
  });

  router.post('/events', requireUser, (req, res) => {
    const b = req.body;
    const c = loadCommunity(v.int(b.communityId, 'Community', { min: 1, required: true }), req.user.id);
    if (!isAdmin(c)) throw new HttpError(403, 'Only community admins can create events');
    const premium = isPremium(db, c.owner_id);

    const routeId = v.int(b.routeId, 'Route', { min: 1 });
    const route = routeId ? db.prepare('SELECT * FROM routes WHERE id = ? AND hidden = 0').get(routeId) : null;
    if (routeId && !route) throw new HttpError(400, 'Route not found', { field: 'Route' });
    const lat = v.lat(b.lat, 'Latitude') ?? route?.start_lat;
    const lng = v.lng(b.lng, 'Longitude') ?? route?.start_lng;
    if (lat == null || lng == null) {
      throw new HttpError(400, 'Pick a meeting location on the map or choose a route', { field: 'Location' });
    }
    const startsAt = v.isoDate(b.startsAt, 'Start time', { required: true });
    if (Date.parse(startsAt) < Date.now()) throw new HttpError(400, 'Pick a start time in the future', { field: 'Start time' });
    const endsAt = v.isoDate(b.endsAt, 'End time');
    if (endsAt && Date.parse(endsAt) <= Date.parse(startsAt)) {
      throw new HttpError(400, 'End time must be after the start time', { field: 'End time' });
    }
    const radius = b.notificationRadiusKm ? v.oneOf(Number(b.notificationRadiusKm), 'Notification radius', NOTIFICATION_RADII_KM) : null;
    if (radius && !premium) {
      throw new HttpError(402, 'Nearby notifications need the Premium Community Creator plan', { premiumRequired: true });
    }
    if (!premium) {
      const upcoming = db
        .prepare('SELECT COUNT(*) AS n FROM events WHERE community_id = ? AND hidden = 0 AND starts_at > ?')
        .get(c.id, new Date().toISOString()).n;
      if (upcoming >= FREE_UPCOMING_EVENT_LIMIT) {
        throw new HttpError(402, `Without premium a community can have ${FREE_UPCOMING_EVENT_LIMIT} upcoming events`, { premiumRequired: true });
      }
    }

    const e = db
      .prepare(
        `INSERT INTO events (community_id, route_id, created_by, title, description, cover_url, activity_type, starts_at,
           ends_at, meeting_point, lat, lng, max_participants, difficulty, pace, notification_radius_km)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`,
      )
      .get(
        c.id, routeId, req.user.id, v.text(b.title, 'Title', { max: 100, required: true }),
        v.text(b.description, 'Description', { max: 3000 }), v.text(b.coverUrl, 'Cover photo URL', { max: 500 }) || null,
        v.oneOf(b.activityType, 'Activity', ACTIVITY_KEYS) ?? c.activity_type, startsAt, endsAt,
        v.text(b.meetingPoint, 'Meeting point', { max: 120, required: true }), lat, lng,
        v.int(b.maxParticipants, 'Maximum participants', { min: 2, max: 10000 }),
        v.oneOf(b.difficulty, 'Difficulty', DIFFICULTIES) ?? route?.difficulty ?? null,
        v.text(b.pace, 'Pace', { max: 40 }) || null, radius,
      );

    const members = memberIds(c.id).filter((id) => id !== req.user.id);
    notifier.notifyMany(members, {
      type: 'community',
      title: `New event from ${c.name}`,
      body: e.title,
      link: `/events/${e.id}`,
    });
    // Nearby notifications only go to public-community events and skip
    // people who already heard about it as members.
    const notified =
      radius && c.privacy === 'public'
        ? notifier.notifyNearbyEvent(e, { excludeUserIds: [req.user.id, ...members] })
        : 0;
    db.prepare('UPDATE events SET notified_count = ? WHERE id = ?').run(notified, e.id);
    db.prepare('INSERT INTO event_participants (event_id, user_id) VALUES (?, ?)').run(e.id, req.user.id);
    res.status(201).json({ event: eventSummary(loadEvent(e.id, req.user.id)), notifiedNearby: notified, notifiedMembers: members.length });
  });

  router.get('/events/:id', (req, res) => {
    const viewerId = req.user?.id ?? 0;
    const e = loadEvent(v.idParam(req.params.id), viewerId);
    const c = loadCommunity(e.community_id, viewerId);
    const route = e.route_id ? db.prepare(`${ROUTE_SELECT} WHERE r.id = ?`).get(e.route_id) : null;
    const participants = db
      .prepare(
        `SELECT u.id, u.name FROM event_participants p JOIN users u ON u.id = p.user_id
         WHERE p.event_id = ? ORDER BY p.created_at LIMIT 50`,
      )
      .all(e.id);
    res.json({
      event: {
        ...eventSummary(e),
        canManage: isAdmin(c),
        communityPrivacy: c.privacy,
        isCommunityMember: isMember(c),
      },
      route: route ? { ...routeSummary(route), geometry: JSON.parse(route.geometry) } : null,
      participants,
    });
  });

  router.post('/events/:id/register', requireUser, (req, res) => {
    const e = loadEvent(v.idParam(req.params.id), req.user.id);
    if (Date.parse(e.starts_at) < Date.now()) throw new HttpError(409, 'This event has already started');
    if (!e.registered) {
      transaction(db, () => {
        const n = db.prepare('SELECT COUNT(*) AS n FROM event_participants WHERE event_id = ?').get(e.id).n;
        if (e.max_participants && n >= e.max_participants) throw new HttpError(409, 'This event is full');
        db.prepare('INSERT INTO event_participants (event_id, user_id) VALUES (?, ?)').run(e.id, req.user.id);
      });
    }
    res.json({ event: eventSummary(loadEvent(e.id, req.user.id)) });
  });

  router.post('/events/:id/unregister', requireUser, (req, res) => {
    const e = loadEvent(v.idParam(req.params.id), req.user.id);
    db.prepare('DELETE FROM event_participants WHERE event_id = ? AND user_id = ?').run(e.id, req.user.id);
    res.json({ event: eventSummary(loadEvent(e.id, req.user.id)) });
  });

  return router;
}
