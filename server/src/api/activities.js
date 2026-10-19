import { Router } from 'express';
import { ACTIVITY_KEYS, ACTIVITY_TYPES } from '../activities.js';
import { HttpError, requireUser } from '../auth.js';
import { transaction } from '../db.js';
import { distanceToLine, haversine } from '../geo.js';
import { ACTIVITY_SELECT, activitySummary, chatMessage, publicUser } from '../serialize.js';
import * as v from '../validate.js';

// Check-in geofence (PRD §18): near the meeting point, or on the route itself.
export const CHECKIN_MEETING_RADIUS_M = 500;
export const CHECKIN_ROUTE_RADIUS_M = 300;
const CHECKIN_OPENS_BEFORE_MS = 2 * 3600 * 1000;
const CHECKIN_CLOSES_AFTER_MS = 3 * 3600 * 1000;

export function activitiesRouter({ db, hub, notifier, config }) {
  const router = Router();

  const load = (id, viewerId = 0) => {
    const a = db.prepare(`${ACTIVITY_SELECT} WHERE a.id = ?`).get(viewerId, id);
    if (!a) throw new HttpError(404, 'Activity not found');
    return a;
  };

  const memberIds = (activityId) =>
    db
      .prepare("SELECT user_id FROM activity_participants WHERE activity_id = ? AND status = 'joined'")
      .all(activityId)
      .map((r) => r.user_id);

  const requireMember = (activityId, userId) => {
    const p = db
      .prepare("SELECT * FROM activity_participants WHERE activity_id = ? AND user_id = ? AND status = 'joined'")
      .get(activityId, userId);
    if (!p) throw new HttpError(403, 'Join this activity to see the group chat');
    return p;
  };

  // Inserts a chat message and pushes it to every member's open tabs.
  function post(activityId, userId, kind, body, data = null, userName = null) {
    const m = db
      .prepare('INSERT INTO chat_messages (activity_id, user_id, kind, body, data) VALUES (?, ?, ?, ?, ?) RETURNING *')
      .get(activityId, userId, kind, body, data ? JSON.stringify(data) : null);
    const message = chatMessage({ ...m, user_name: userName });
    hub.send(memberIds(activityId), 'chat', message);
    return message;
  }

  function detail(id, viewer) {
    const a = load(id, viewer?.id ?? 0);
    const route = db.prepare('SELECT geometry, start_lat, start_lng, end_lat, end_lng, est_duration_s FROM routes WHERE id = ?').get(a.route_id);
    const participants = db
      .prepare(
        `SELECT p.*, u.name, u.photo_url, u.privacy, u.bio, u.location_name, u.experience, u.activities
         FROM activity_participants p JOIN users u ON u.id = p.user_id
         WHERE p.activity_id = ? ORDER BY p.joined_at`,
      )
      .all(a.id);
    const isHost = viewer?.id === a.creator_id;
    const joined = participants
      .filter((p) => p.status === 'joined')
      .map((p) => ({
        ...publicUser({ ...p, id: p.user_id, photo_url: p.photo_url }, { viewerId: viewer?.id }),
        checkedIn: Boolean(p.checked_in_at),
        isHost: p.user_id === a.creator_id,
      }));
    const requests = isHost
      ? participants
          .filter((p) => p.status === 'requested')
          .map((p) => ({ id: p.user_id, name: p.name, requestedAt: p.joined_at }))
      : [];
    const mine = participants.find((p) => p.user_id === viewer?.id);
    return {
      activity: {
        ...activitySummary(a),
        estDurationS: route.est_duration_s,
        geometry: JSON.parse(route.geometry),
        routeStart: [route.start_lat, route.start_lng],
        routeEnd: [route.end_lat, route.end_lng],
        isHost,
        checkedInAt: mine?.checked_in_at ?? null,
      },
      participants: joined,
      requests,
    };
  }

  router.get('/activities', (req, res) => {
    const q = req.query;
    const viewerId = req.user?.id ?? 0;
    const where = [];
    const params = [viewerId];
    if (q.mine === '1') {
      if (!req.user) throw new HttpError(401, 'Please log in first');
      where.push('EXISTS (SELECT 1 FROM activity_participants p WHERE p.activity_id = a.id AND p.user_id = ?)');
      params.push(viewerId);
    } else {
      where.push(
        `(a.visibility = 'public' OR EXISTS (SELECT 1 FROM activity_participants p WHERE p.activity_id = a.id AND p.user_id = ?))`,
        "a.status = 'open'",
        'r.hidden = 0',
      );
      params.push(viewerId);
    }
    if (q.when === 'past') {
      where.push('a.starts_at < ?');
      params.push(new Date().toISOString());
    } else {
      where.push('a.starts_at > ?');
      params.push(new Date(Date.now() - 3 * 3600 * 1000).toISOString());
    }
    if (q.routeId) {
      where.push('a.route_id = ?');
      params.push(v.idParam(q.routeId));
    }
    if (q.activity) {
      where.push('a.activity_type = ?');
      params.push(v.oneOf(q.activity, 'Activity', ACTIVITY_KEYS));
    }
    const order = q.when === 'past' ? 'DESC' : 'ASC';
    let rows = db.prepare(`${ACTIVITY_SELECT} WHERE ${where.join(' AND ')} ORDER BY a.starts_at ${order} LIMIT 300`).all(...params);
    const lat = v.lat(q.lat, 'Latitude');
    const lng = v.lng(q.lng, 'Longitude');
    if (lat != null && lng != null) {
      rows = rows.map((a) => ({ ...a, distance_from_you_m: Math.round(haversine(lat, lng, a.meeting_lat, a.meeting_lng)) }));
      const radiusKm = v.num(q.radiusKm, 'Radius', { min: 1, max: 500 });
      if (radiusKm) rows = rows.filter((a) => a.distance_from_you_m <= radiusKm * 1000);
    }
    const limit = v.int(q.limit, 'Limit', { min: 1, max: 100, fallback: 30 });
    res.json({ activities: rows.slice(0, limit).map(activitySummary), total: rows.length });
  });

  router.post('/activities', requireUser, (req, res) => {
    const b = req.body;
    const routeId = v.int(b.routeId, 'Route', { min: 1, required: true });
    const route = db.prepare('SELECT * FROM routes WHERE id = ? AND hidden = 0').get(routeId);
    if (!route) throw new HttpError(400, 'Choose a route for this activity', { field: 'Route' });
    const activityType = v.oneOf(b.activityType, 'Activity', ACTIVITY_KEYS) ?? route.activity_type;
    const startsAt = v.isoDate(b.startsAt, 'Date and time', { required: true });
    if (Date.parse(startsAt) < Date.now()) throw new HttpError(400, 'Pick a time in the future', { field: 'Date and time' });
    const title =
      v.text(b.title, 'Title', { max: 100 }) || `${ACTIVITY_TYPES[activityType].label} · ${route.name}`;
    const meetingPoint = v.text(b.meetingPoint, 'Meeting point', { max: 120, required: true });
    const meetingLat = v.lat(b.meetingLat, 'Meeting point latitude') ?? route.start_lat;
    const meetingLng = v.lng(b.meetingLng, 'Meeting point longitude') ?? route.start_lng;
    const participantLimit = v.int(b.participantLimit, 'Participant limit', { min: 2, max: 500 });
    const pace = v.text(b.pace, 'Pace', { max: 40 }) || null;
    const description = v.text(b.description, 'Description', { max: 1000 });
    const visibility = v.oneOf(b.visibility ?? 'public', 'Visibility', ['public', 'private']);

    const id = transaction(db, () => {
      const { id } = db
        .prepare(
          `INSERT INTO activity_plans (route_id, creator_id, title, activity_type, starts_at, meeting_point, meeting_lat,
             meeting_lng, participant_limit, pace, description, visibility)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
        )
        .get(routeId, req.user.id, title, activityType, startsAt, meetingPoint, meetingLat, meetingLng,
          participantLimit, pace, description, visibility);
      db.prepare("INSERT INTO activity_participants (activity_id, user_id, status) VALUES (?, ?, 'joined')").run(id, req.user.id);
      return id;
    });
    post(id, null, 'system', `${req.user.name} created this activity`);
    res.status(201).json(detail(id, req.user));
  });

  router.get('/activities/:id', (req, res) => {
    res.json(detail(v.idParam(req.params.id), req.user));
  });

  router.patch('/activities/:id', requireUser, (req, res) => {
    const a = load(v.idParam(req.params.id), req.user.id);
    if (a.creator_id !== req.user.id) throw new HttpError(403, 'Only the host can change this activity');
    const status = v.oneOf(req.body.status, 'Status', ['cancelled', 'completed'], { required: true });
    if (a.status !== 'open') throw new HttpError(409, `This activity is already ${a.status}`);
    db.prepare('UPDATE activity_plans SET status = ? WHERE id = ?').run(status, a.id);
    post(a.id, null, 'system', `${req.user.name} marked this activity as ${status}`);
    if (status === 'cancelled') {
      notifier.notifyMany(memberIds(a.id).filter((id) => id !== req.user.id), {
        type: 'activity_update',
        title: `${a.title} was cancelled`,
        body: `Planned for ${a.starts_at}`,
        link: `/activities/${a.id}`,
      });
    }
    res.json(detail(a.id, req.user));
  });

  router.post('/activities/:id/join', requireUser, (req, res) => {
    const a = load(v.idParam(req.params.id), req.user.id);
    if (a.status !== 'open') throw new HttpError(409, 'This activity is no longer open');
    if (Date.parse(a.starts_at) < Date.now() - 3600 * 1000) throw new HttpError(409, 'This activity has already started');
    if (a.my_status === 'joined') return res.json(detail(a.id, req.user));
    if (a.my_status === 'requested') throw new HttpError(409, 'Your request is waiting for the host');

    if (a.visibility === 'private') {
      db.prepare("INSERT INTO activity_participants (activity_id, user_id, status) VALUES (?, ?, 'requested')").run(a.id, req.user.id);
      notifier.notify(a.creator_id, {
        type: 'activity_join',
        title: `${req.user.name} asked to join ${a.title}`,
        link: `/activities/${a.id}`,
      });
      return res.json(detail(a.id, req.user));
    }

    // Capacity check and insert in one transaction so two people can't take
    // the last spot at the same time.
    transaction(db, () => {
      const count = db
        .prepare("SELECT COUNT(*) AS n FROM activity_participants WHERE activity_id = ? AND status = 'joined'")
        .get(a.id).n;
      if (a.participant_limit && count >= a.participant_limit) throw new HttpError(409, 'This activity is full');
      db.prepare("INSERT INTO activity_participants (activity_id, user_id, status) VALUES (?, ?, 'joined')").run(a.id, req.user.id);
    });
    post(a.id, null, 'system', `${req.user.name} joined`);
    notifier.notify(a.creator_id, {
      type: 'activity_join',
      title: `${req.user.name} joined ${a.title}`,
      link: `/activities/${a.id}`,
    });
    res.json(detail(a.id, req.user));
  });

  router.post('/activities/:id/leave', requireUser, (req, res) => {
    const a = load(v.idParam(req.params.id), req.user.id);
    if (a.creator_id === req.user.id) throw new HttpError(409, 'Hosts cancel the activity instead of leaving it');
    const wasJoined = a.my_status === 'joined';
    db.prepare('DELETE FROM activity_participants WHERE activity_id = ? AND user_id = ?').run(a.id, req.user.id);
    if (wasJoined) post(a.id, null, 'system', `${req.user.name} left`);
    res.json(detail(a.id, req.user));
  });

  router.post('/activities/:id/requests/:userId/:decision', requireUser, (req, res) => {
    const a = load(v.idParam(req.params.id), req.user.id);
    if (a.creator_id !== req.user.id) throw new HttpError(403, 'Only the host can answer join requests');
    const userId = v.idParam(req.params.userId);
    const decision = v.oneOf(req.params.decision, 'Decision', ['approve', 'decline'], { required: true });
    const reqRow = db
      .prepare("SELECT 1 FROM activity_participants WHERE activity_id = ? AND user_id = ? AND status = 'requested'")
      .get(a.id, userId);
    if (!reqRow) throw new HttpError(404, 'Request not found');
    const user = db.prepare('SELECT name FROM users WHERE id = ?').get(userId);
    if (decision === 'approve') {
      transaction(db, () => {
        const count = db
          .prepare("SELECT COUNT(*) AS n FROM activity_participants WHERE activity_id = ? AND status = 'joined'")
          .get(a.id).n;
        if (a.participant_limit && count >= a.participant_limit) throw new HttpError(409, 'This activity is full');
        db.prepare("UPDATE activity_participants SET status = 'joined' WHERE activity_id = ? AND user_id = ?").run(a.id, userId);
      });
      post(a.id, null, 'system', `${user.name} joined`);
    } else {
      db.prepare('DELETE FROM activity_participants WHERE activity_id = ? AND user_id = ?').run(a.id, userId);
    }
    notifier.notify(userId, {
      type: 'activity_update',
      title: decision === 'approve' ? `You're in: ${a.title}` : `Your request for ${a.title} was declined`,
      link: `/activities/${a.id}`,
    });
    res.json(detail(a.id, req.user));
  });

  router.get('/activities/:id/messages', requireUser, (req, res) => {
    const id = v.idParam(req.params.id);
    load(id, req.user.id);
    requireMember(id, req.user.id);
    const before = v.int(req.query.before, 'Before', { min: 1 });
    const rows = db
      .prepare(
        `SELECT m.*, u.name AS user_name FROM chat_messages m LEFT JOIN users u ON u.id = m.user_id
         WHERE m.activity_id = ? AND (? IS NULL OR m.id < ?) ORDER BY m.id DESC LIMIT 100`,
      )
      .all(id, before, before);
    res.json({ messages: rows.reverse().map(chatMessage), hasMore: rows.length === 100 });
  });

  router.post('/activities/:id/messages', requireUser, (req, res) => {
    const id = v.idParam(req.params.id);
    const a = load(id, req.user.id);
    requireMember(id, req.user.id);
    if (a.status === 'cancelled') throw new HttpError(409, 'This activity was cancelled');
    const loc = req.body.location;
    if (loc) {
      const lat = v.lat(loc.lat, 'Latitude', { required: true });
      const lng = v.lng(loc.lng, 'Longitude', { required: true });
      const body = v.text(req.body.body, 'Message', { max: 200 }) || `${req.user.name} shared a location`;
      return res.status(201).json({ message: post(id, req.user.id, 'location', body, { lat, lng }, req.user.name) });
    }
    const body = v.text(req.body.body, 'Message', { max: 1000, required: true });
    res.status(201).json({ message: post(id, req.user.id, 'text', body, null, req.user.name) });
  });

  router.post('/activities/:id/checkin', requireUser, (req, res) => {
    const id = v.idParam(req.params.id);
    const a = load(id, req.user.id);
    const p = requireMember(id, req.user.id);
    if (a.status === 'cancelled') throw new HttpError(409, 'This activity was cancelled');
    if (p.checked_in_at) return res.json({ checkedInAt: p.checked_in_at, alreadyCheckedIn: true });
    const lat = v.lat(req.body.lat, 'Latitude', { required: true });
    const lng = v.lng(req.body.lng, 'Longitude', { required: true });

    const route = db.prepare('SELECT geometry, est_duration_s FROM routes WHERE id = ?').get(a.route_id);
    const start = Date.parse(a.starts_at);
    const now = Date.now();
    if (!config.demoMode) {
      if (now < start - CHECKIN_OPENS_BEFORE_MS) {
        throw new HttpError(409, 'Check-in opens 2 hours before the start time');
      }
      if (now > start + route.est_duration_s * 1000 + CHECKIN_CLOSES_AFTER_MS) {
        throw new HttpError(409, 'Check-in for this activity has closed');
      }
    }
    const toMeeting = haversine(lat, lng, a.meeting_lat, a.meeting_lng);
    const toRoute = distanceToLine(lat, lng, JSON.parse(route.geometry));
    if (toMeeting > CHECKIN_MEETING_RADIUS_M && toRoute > CHECKIN_ROUTE_RADIUS_M) {
      const km = (Math.min(toMeeting, toRoute) / 1000).toFixed(1);
      throw new HttpError(409, `You're ${km} km away. Check in at the meeting point or on the route.`, {
        distanceM: Math.round(Math.min(toMeeting, toRoute)),
      });
    }
    const at = new Date().toISOString();
    db.prepare(
      'UPDATE activity_participants SET checked_in_at = ?, check_in_lat = ?, check_in_lng = ? WHERE activity_id = ? AND user_id = ?',
    ).run(at, lat, lng, id, req.user.id);
    post(id, null, 'system', `${req.user.name} checked in`);
    res.json({ checkedInAt: at });
  });

  // SOS (PRD §30): shares the member's position with the group, alerts every
  // member regardless of notification settings, and returns the user's own
  // emergency contact so the client can offer to call it.
  router.post('/activities/:id/sos', requireUser, (req, res) => {
    const id = v.idParam(req.params.id);
    const a = load(id, req.user.id);
    requireMember(id, req.user.id);
    const lat = v.lat(req.body.lat, 'Latitude');
    const lng = v.lng(req.body.lng, 'Longitude');
    const note = v.text(req.body.note, 'Note', { max: 200 });
    const hasLocation = lat != null && lng != null;
    const message = post(
      id,
      req.user.id,
      'sos',
      `SOS from ${req.user.name}${note ? `: ${note}` : ''}`,
      hasLocation ? { lat, lng } : null,
      req.user.name,
    );
    notifier.notifyMany(memberIds(id).filter((uid) => uid !== req.user.id), {
      type: 'sos',
      title: `SOS from ${req.user.name}`,
      body: `${a.title}${hasLocation ? ` · ${lat.toFixed(5)}, ${lng.toFixed(5)}` : ''}`,
      link: `/activities/${id}`,
    });
    res.json({
      message,
      emergencyContact: req.user.emergency_phone
        ? { name: req.user.emergency_name, phone: req.user.emergency_phone }
        : null,
    });
  });

  return router;
}
