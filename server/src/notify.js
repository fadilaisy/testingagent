import { boundingBox, haversine } from './geo.js';
import { parseJson } from './validate.js';

// Notification types users can switch off (PRD §27, FR-17).
export const NOTIFICATION_TYPES = {
  activity_join: 'Someone joins or asks to join your activity',
  activity_update: 'Changes to activities you joined',
  track_update: 'New track conditions on routes you are about to do',
  weather: 'Weather alerts for your upcoming activities',
  nearby_event: 'New events near you',
  community: 'New events from your communities',
};

export const DEFAULT_SETTINGS = {
  ...Object.fromEntries(Object.keys(NOTIFICATION_TYPES).map((k) => [k, true])),
  nearby_radius_km: 25,
};

// Anti-spam limits for nearby-event notifications (PRD §23 "tidak boleh
// dikirim secara berlebihan").
export const NEARBY_LIMIT_PER_DAY = 1;
export const NEARBY_LIMIT_PER_WEEK = 3;

export function userSettings(user) {
  return { ...DEFAULT_SETTINGS, ...parseJson(user.notify_settings, {}) };
}

export function createNotifier({ db, hub }) {
  const insert = db.prepare(
    'INSERT INTO notifications (user_id, type, title, body, link) VALUES (?, ?, ?, ?, ?) RETURNING *',
  );
  const getUser = db.prepare('SELECT id, notify_settings FROM users WHERE id = ?');

  function notify(userId, { type, title, body = '', link = null }) {
    const user = getUser.get(userId);
    if (!user) return null;
    if (NOTIFICATION_TYPES[type] && userSettings(user)[type] === false) return null;
    const row = insert.get(userId, type, title, body, link);
    hub.send([userId], 'notification', row);
    return row;
  }

  function notifyMany(userIds, payload) {
    return userIds.map((id) => notify(id, payload)).filter(Boolean).length;
  }

  // Finds users who live within the event's radius, like its activity type,
  // allow nearby notifications and have not hit the frequency limit.
  function notifyNearbyEvent(event, { excludeUserIds = [] } = {}) {
    if (!event.notification_radius_km) return 0;
    const radiusM = event.notification_radius_km * 1000;
    const b = boundingBox(event.lat, event.lng, radiusM);
    const candidates = db
      .prepare(
        `SELECT id, lat, lng, activities, notify_settings FROM users
         WHERE suspended = 0 AND lat BETWEEN ? AND ? AND lng BETWEEN ? AND ?`,
      )
      .all(b.minLat, b.maxLat, b.minLng, b.maxLng);

    const recent = db.prepare(
      `SELECT
         SUM(created_at > ?) AS day,
         COUNT(*) AS week
       FROM notifications WHERE user_id = ? AND type = 'nearby_event' AND created_at > ?`,
    );
    const dayAgo = new Date(Date.now() - 864e5).toISOString();
    const weekAgo = new Date(Date.now() - 7 * 864e5).toISOString();
    const excluded = new Set(excludeUserIds);

    let sent = 0;
    for (const u of candidates) {
      if (excluded.has(u.id)) continue;
      const settings = userSettings(u);
      if (settings.nearby_event === false) continue;
      if (!parseJson(u.activities, []).includes(event.activity_type)) continue;
      const distance = haversine(event.lat, event.lng, u.lat, u.lng);
      const userRadiusM = (Number(settings.nearby_radius_km) || DEFAULT_SETTINGS.nearby_radius_km) * 1000;
      if (distance > Math.min(radiusM, userRadiusM)) continue;
      const counts = recent.get(dayAgo, u.id, weekAgo);
      if ((counts.day ?? 0) >= NEARBY_LIMIT_PER_DAY || (counts.week ?? 0) >= NEARBY_LIMIT_PER_WEEK) continue;
      const km = Math.max(1, Math.round(distance / 1000));
      if (
        notify(u.id, {
          type: 'nearby_event',
          title: `A new event is happening ${km} km from you`,
          body: event.title,
          link: `/events/${event.id}`,
        })
      ) {
        sent++;
      }
    }
    return sent;
  }

  return { notify, notifyMany, notifyNearbyEvent };
}
