import { Router } from 'express';
import { ACTIVITY_KEYS, ACTIVITY_TYPES } from '../activities.js';
import {
  HttpError,
  consumeResetToken,
  createResetToken,
  createSession,
  destroySession,
  hashPassword,
  rateLimit,
  requireUser,
  sessionCookieOptions,
  verifyPassword,
} from '../auth.js';
import { coarse } from '../geo.js';
import { NOTIFICATION_TYPES, userSettings } from '../notify.js';
import { me, publicUser, routeSummary, ROUTE_SELECT } from '../serialize.js';
import * as v from '../validate.js';

const EXPERIENCE = ['beginner', 'intermediate', 'advanced'];
const PREMIUM_PLAN = 'community_creator';

export function accountRouter({ db, config }) {
  const router = Router();
  const authLimit = rateLimit({ windowMs: 10 * 60 * 1000, max: config.authRateLimit ?? 30 });

  function startSession(res, userId) {
    const { token } = createSession(db, userId);
    res.cookie('sid', token, sessionCookieOptions(config.secureCookies));
  }

  router.post('/auth/register', authLimit, (req, res) => {
    const email = v.email(req.body.email);
    const password = v.password(req.body.password);
    const name = v.text(req.body.name, 'Name', { max: 60, required: true });
    if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(email)) {
      throw new HttpError(409, 'An account with this email already exists', { field: 'Email' });
    }
    // The first account on a fresh install becomes the admin.
    const isFirst = !db.prepare('SELECT 1 FROM users LIMIT 1').get();
    const user = db
      .prepare('INSERT INTO users (email, password_hash, name, is_admin) VALUES (?, ?, ?, ?) RETURNING *')
      .get(email, hashPassword(password), name, isFirst ? 1 : 0);
    startSession(res, user.id);
    res.status(201).json({ user: me(db, user) });
  });

  router.post('/auth/login', authLimit, (req, res) => {
    const email = String(req.body.email ?? '').trim().toLowerCase();
    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
    if (!user || !verifyPassword(String(req.body.password ?? ''), user.password_hash)) {
      throw new HttpError(401, 'Email or password is incorrect');
    }
    if (user.suspended) throw new HttpError(403, 'This account is suspended');
    startSession(res, user.id);
    res.json({ user: me(db, user) });
  });

  router.post('/auth/logout', (req, res) => {
    destroySession(db, req.cookies?.sid);
    res.clearCookie('sid', { path: '/' });
    res.json({ ok: true });
  });

  // No email service in the MVP: the reset link is logged on the server and,
  // outside production, returned in the response so the flow can be tested.
  router.post('/auth/forgot', authLimit, (req, res) => {
    const email = String(req.body.email ?? '').trim().toLowerCase();
    const user = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
    let devResetLink;
    if (user) {
      const token = createResetToken(db, user.id);
      const link = `/reset-password?token=${token}`;
      console.log(`[password reset] ${email}: ${link}`);
      if (!config.production) devResetLink = link;
    }
    res.json({ ok: true, devResetLink });
  });

  router.post('/auth/reset', authLimit, (req, res) => {
    const password = v.password(req.body.password);
    const userId = consumeResetToken(db, req.body.token);
    if (!userId) throw new HttpError(400, 'This reset link is invalid or has expired');
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(password), userId);
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
    startSession(res, userId);
    res.json({ ok: true });
  });

  router.get('/me', (req, res) => {
    res.json({ user: req.user ? me(db, req.user) : null });
  });

  router.patch('/me', requireUser, (req, res) => {
    const b = req.body;
    const u = req.user;
    const next = {
      name: b.name !== undefined ? v.text(b.name, 'Name', { max: 60, required: true }) : u.name,
      bio: b.bio !== undefined ? v.text(b.bio, 'Bio', { max: 280 }) : u.bio,
      photo_url: b.photoUrl !== undefined ? v.text(b.photoUrl, 'Photo URL', { max: 500 }) || null : u.photo_url,
      location_name:
        b.locationName !== undefined ? v.text(b.locationName, 'Location', { max: 80 }) || null : u.location_name,
      // Home location is stored rounded to ~1 km; it is only used for
      // "near you" lists and nearby-event matching, never shown to others.
      lat: b.lat !== undefined ? coarse(v.lat(b.lat, 'Latitude')) : u.lat,
      lng: b.lng !== undefined ? coarse(v.lng(b.lng, 'Longitude')) : u.lng,
      experience: b.experience !== undefined ? v.oneOf(b.experience, 'Experience', EXPERIENCE, { required: true }) : u.experience,
      privacy: b.privacy !== undefined ? v.oneOf(b.privacy, 'Privacy', ['public', 'private'], { required: true }) : u.privacy,
      emergency_name:
        b.emergencyName !== undefined ? v.text(b.emergencyName, 'Emergency contact name', { max: 80 }) || null : u.emergency_name,
      emergency_phone:
        b.emergencyPhone !== undefined ? v.text(b.emergencyPhone, 'Emergency contact phone', { max: 30 }) || null : u.emergency_phone,
      onboarded: b.onboarded !== undefined ? (b.onboarded ? 1 : 0) : u.onboarded,
      activities: u.activities,
      notify_settings: u.notify_settings,
    };
    if (b.activities !== undefined) {
      if (!Array.isArray(b.activities) || b.activities.some((a) => !ACTIVITY_KEYS.includes(a))) {
        throw new HttpError(400, 'Choose activities from the list', { field: 'Activities' });
      }
      next.activities = JSON.stringify([...new Set(b.activities)]);
    }
    if (b.notifySettings !== undefined) {
      const current = userSettings(u);
      const merged = { ...current };
      for (const key of Object.keys(NOTIFICATION_TYPES)) {
        if (b.notifySettings[key] !== undefined) merged[key] = Boolean(b.notifySettings[key]);
      }
      if (b.notifySettings.nearby_radius_km !== undefined) {
        merged.nearby_radius_km = v.oneOf(Number(b.notifySettings.nearby_radius_km), 'Nearby radius', [5, 10, 25, 50]);
      }
      next.notify_settings = JSON.stringify(merged);
    }
    const updated = db
      .prepare(
        `UPDATE users SET name = ?, bio = ?, photo_url = ?, location_name = ?, lat = ?, lng = ?, experience = ?,
           privacy = ?, emergency_name = ?, emergency_phone = ?, onboarded = ?, activities = ?, notify_settings = ?
         WHERE id = ? RETURNING *`,
      )
      .get(
        next.name, next.bio, next.photo_url, next.location_name, next.lat, next.lng, next.experience,
        next.privacy, next.emergency_name, next.emergency_phone, next.onboarded, next.activities,
        next.notify_settings, u.id,
      );
    res.json({ user: me(db, updated) });
  });

  // Simulated subscription: there is no payment provider in the MVP, so this
  // grants 30 days of the premium community-creator plan (PRD §21, §32).
  router.post('/me/premium', requireUser, (req, res) => {
    const start = new Date();
    const end = new Date(start.getTime() + 30 * 864e5);
    db.prepare("UPDATE subscriptions SET status = 'cancelled' WHERE user_id = ? AND status = 'active'").run(req.user.id);
    db.prepare("INSERT INTO subscriptions (user_id, plan, status, start_date, end_date) VALUES (?, ?, 'active', ?, ?)").run(
      req.user.id, PREMIUM_PLAN, start.toISOString(), end.toISOString(),
    );
    res.json({ user: me(db, req.user), premiumUntil: end.toISOString() });
  });

  router.delete('/me/premium', requireUser, (req, res) => {
    db.prepare("UPDATE subscriptions SET status = 'cancelled' WHERE user_id = ? AND status = 'active'").run(req.user.id);
    res.json({ user: me(db, req.user) });
  });

  router.get('/users/:id', (req, res) => {
    const id = v.idParam(req.params.id);
    const u = db.prepare('SELECT * FROM users WHERE id = ? AND suspended = 0').get(id);
    if (!u) throw new HttpError(404, 'User not found');
    const viewerId = req.user?.id ?? 0;
    const profile = publicUser(u, { viewerId });
    if (profile.private) return res.json({ user: profile });

    const routes = db
      .prepare(`${ROUTE_SELECT} WHERE r.creator_id = ? AND r.hidden = 0 AND r.visibility = 'public' ORDER BY r.created_at DESC LIMIT 50`)
      .all(id)
      .map(routeSummary);
    const communities = db
      .prepare(
        `SELECT c.id, c.name, c.activity_type FROM community_members m JOIN communities c ON c.id = m.community_id
         WHERE m.user_id = ? AND m.status = 'member' AND c.hidden = 0 AND c.privacy = 'public' ORDER BY c.name`,
      )
      .all(id)
      .map((c) => ({ id: c.id, name: c.name, activityType: c.activity_type }));
    // History: past activities the user checked in to (PRD §26).
    const history = db
      .prepare(
        `SELECT a.id, a.title, a.activity_type, a.starts_at, r.distance_m
         FROM activity_participants p JOIN activity_plans a ON a.id = p.activity_id JOIN routes r ON r.id = a.route_id
         WHERE p.user_id = ? AND p.checked_in_at IS NOT NULL AND a.status != 'cancelled'
         ORDER BY a.starts_at DESC LIMIT 100`,
      )
      .all(id)
      .map((a) => ({
        id: a.id,
        title: a.title,
        activityType: a.activity_type,
        activityLabel: ACTIVITY_TYPES[a.activity_type]?.label,
        date: a.starts_at,
        distanceM: a.distance_m,
      }));
    const stats = {
      activities: history.length,
      routes: routes.length,
      communities: communities.length,
      totalDistanceM: history.reduce((s, h) => s + h.distanceM, 0),
    };
    res.json({ user: { ...profile, memberSince: u.created_at }, stats, routes, communities, history });
  });

  return router;
}
