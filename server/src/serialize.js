import { ACTIVITY_TYPES, CONDITION_CATEGORIES, conditionSeverity } from './activities.js';
import { isPremium } from './auth.js';
import { userSettings } from './notify.js';
import { parseJson } from './validate.js';

export function publicUser(u, { viewerId } = {}) {
  if (!u) return null;
  const base = { id: u.id, name: u.name, photoUrl: u.photo_url ?? null };
  if (u.privacy === 'private' && viewerId !== u.id) return { ...base, private: true };
  return {
    ...base,
    bio: u.bio,
    locationName: u.location_name,
    experience: u.experience,
    activities: parseJson(u.activities, []),
    private: false,
  };
}

export function me(db, u) {
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    bio: u.bio,
    photoUrl: u.photo_url ?? null,
    locationName: u.location_name,
    lat: u.lat,
    lng: u.lng,
    experience: u.experience,
    activities: parseJson(u.activities, []),
    privacy: u.privacy,
    emergencyName: u.emergency_name,
    emergencyPhone: u.emergency_phone,
    notifySettings: userSettings(u),
    onboarded: Boolean(u.onboarded),
    isAdmin: Boolean(u.is_admin),
    isPremium: isPremium(db, u.id),
  };
}

export function routeSummary(r) {
  return {
    id: r.id,
    name: r.name,
    activityType: r.activity_type,
    activityLabel: ACTIVITY_TYPES[r.activity_type]?.label ?? r.activity_type,
    locationName: r.location_name,
    distanceM: r.distance_m,
    elevationGain: r.elevation_gain,
    difficulty: r.difficulty,
    estDurationS: r.est_duration_s,
    start: [r.start_lat, r.start_lng],
    end: [r.end_lat, r.end_lng],
    flaggedUnsafe: Boolean(r.flagged_unsafe),
    creator: r.creator_name ? { id: r.creator_id, name: r.creator_name } : { id: r.creator_id },
    upcomingCount: r.upcoming_count ?? undefined,
    completedCount: r.completed_count ?? undefined,
    reportCount: r.report_count ?? undefined,
    distanceFromYouM: r.distance_from_you_m ?? undefined,
    createdAt: r.created_at,
  };
}

// Joins a route row with creator name and popularity counters.
export const ROUTE_SELECT = `
  SELECT r.*, u.name AS creator_name,
    (SELECT COUNT(*) FROM activity_plans a WHERE a.route_id = r.id AND a.status = 'open'
       AND a.visibility = 'public' AND a.starts_at > strftime('%Y-%m-%dT%H:%M:%fZ','now')) AS upcoming_count,
    (SELECT COUNT(DISTINCT p.user_id) FROM activity_participants p JOIN activity_plans a ON a.id = p.activity_id
       WHERE a.route_id = r.id AND p.checked_in_at IS NOT NULL) AS completed_count,
    (SELECT COUNT(*) FROM track_reports t WHERE t.route_id = r.id
       AND t.created_at > strftime('%Y-%m-%dT%H:%M:%fZ','now','-7 days')) AS report_count
  FROM routes r JOIN users u ON u.id = r.creator_id`;

export function trackReport(t) {
  const category = CONDITION_CATEGORIES[t.category];
  return {
    id: t.id,
    routeId: t.route_id,
    activityId: t.activity_id,
    category: t.category,
    categoryLabel: category?.label ?? t.category,
    value: t.value,
    severity: conditionSeverity(t.category, t.value) ?? 0,
    km: t.km,
    description: t.description,
    user: t.user_name ? { id: t.user_id, name: t.user_name } : { id: t.user_id },
    routeName: t.route_name ?? undefined,
    createdAt: t.created_at,
  };
}

export function activitySummary(a) {
  return {
    id: a.id,
    title: a.title,
    activityType: a.activity_type,
    activityLabel: ACTIVITY_TYPES[a.activity_type]?.label ?? a.activity_type,
    startsAt: a.starts_at,
    meetingPoint: a.meeting_point,
    meeting: [a.meeting_lat, a.meeting_lng],
    participantLimit: a.participant_limit,
    pace: a.pace,
    description: a.description,
    visibility: a.visibility,
    status: a.status,
    participantCount: a.participant_count ?? undefined,
    route: a.route_name
      ? {
          id: a.route_id,
          name: a.route_name,
          distanceM: a.route_distance_m,
          elevationGain: a.route_elevation_gain,
          difficulty: a.route_difficulty,
          estDurationS: a.route_est_duration_s,
        }
      : { id: a.route_id },
    host: a.host_name ? { id: a.creator_id, name: a.host_name } : { id: a.creator_id },
    myStatus: a.my_status ?? null,
    distanceFromYouM: a.distance_from_you_m ?? undefined,
    createdAt: a.created_at,
  };
}

// `?` placeholder is the viewer id (or 0 when signed out) for my_status.
export const ACTIVITY_SELECT = `
  SELECT a.*, r.name AS route_name, r.distance_m AS route_distance_m,
    r.elevation_gain AS route_elevation_gain, r.difficulty AS route_difficulty,
    r.est_duration_s AS route_est_duration_s, u.name AS host_name,
    (SELECT COUNT(*) FROM activity_participants p WHERE p.activity_id = a.id AND p.status = 'joined') AS participant_count,
    (SELECT p.status FROM activity_participants p WHERE p.activity_id = a.id AND p.user_id = ?) AS my_status
  FROM activity_plans a JOIN routes r ON r.id = a.route_id JOIN users u ON u.id = a.creator_id`;

export function chatMessage(m) {
  return {
    id: m.id,
    activityId: m.activity_id,
    kind: m.kind,
    body: m.body,
    data: parseJson(m.data, null),
    user: m.user_id ? { id: m.user_id, name: m.user_name ?? null } : null,
    createdAt: m.created_at,
  };
}

export function communitySummary(c) {
  return {
    id: c.id,
    name: c.name,
    description: c.description,
    activityType: c.activity_type,
    activityLabel: ACTIVITY_TYPES[c.activity_type]?.label ?? c.activity_type,
    locationName: c.location_name,
    location: c.lat != null ? [c.lat, c.lng] : null,
    privacy: c.privacy,
    memberCount: c.member_count ?? undefined,
    myRole: c.my_role ?? null,
    myStatus: c.my_status ?? null,
    owner: c.owner_name ? { id: c.owner_id, name: c.owner_name } : { id: c.owner_id },
    createdAt: c.created_at,
  };
}

export const COMMUNITY_SELECT = `
  SELECT c.*, u.name AS owner_name,
    (SELECT COUNT(*) FROM community_members m WHERE m.community_id = c.id AND m.status = 'member') AS member_count,
    (SELECT m.role FROM community_members m WHERE m.community_id = c.id AND m.user_id = ?) AS my_role,
    (SELECT m.status FROM community_members m WHERE m.community_id = c.id AND m.user_id = ?) AS my_status
  FROM communities c JOIN users u ON u.id = c.owner_id`;

export function eventSummary(e) {
  return {
    id: e.id,
    title: e.title,
    description: e.description,
    coverUrl: e.cover_url,
    activityType: e.activity_type,
    activityLabel: ACTIVITY_TYPES[e.activity_type]?.label ?? e.activity_type,
    startsAt: e.starts_at,
    endsAt: e.ends_at,
    meetingPoint: e.meeting_point,
    location: [e.lat, e.lng],
    maxParticipants: e.max_participants,
    difficulty: e.difficulty,
    pace: e.pace,
    notificationRadiusKm: e.notification_radius_km,
    notifiedCount: e.notified_count,
    participantCount: e.participant_count ?? undefined,
    registered: Boolean(e.registered),
    community: { id: e.community_id, name: e.community_name ?? null },
    route: e.route_id ? { id: e.route_id, name: e.route_name ?? null, distanceM: e.route_distance_m ?? null } : null,
    distanceFromYouM: e.distance_from_you_m ?? undefined,
    createdAt: e.created_at,
  };
}

export const EVENT_SELECT = `
  SELECT e.*, c.name AS community_name, r.name AS route_name, r.distance_m AS route_distance_m,
    (SELECT COUNT(*) FROM event_participants p WHERE p.event_id = e.id) AS participant_count,
    (SELECT 1 FROM event_participants p WHERE p.event_id = e.id AND p.user_id = ?) AS registered
  FROM events e JOIN communities c ON c.id = e.community_id LEFT JOIN routes r ON r.id = e.route_id`;

export function notification(n) {
  return {
    id: n.id,
    type: n.type,
    title: n.title,
    body: n.body,
    link: n.link,
    read: Boolean(n.read_at),
    createdAt: n.created_at,
  };
}
