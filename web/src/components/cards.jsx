import { Link } from 'react-router-dom';
import { ACTIVITY_EMOJI, SEVERITY_DOT, ago, conditionLabel, distanceAway, duration, elevation, km, when } from '../format.js';
import { DifficultyPill } from './ui.jsx';

export function RouteCard({ route }) {
  return (
    <Link className="card tight" to={`/routes/${route.id}`}>
      <div className="spread">
        <span className="small muted">
          {ACTIVITY_EMOJI[route.activityType]} {route.activityLabel}
          {route.locationName ? ` · ${route.locationName}` : ''}
        </span>
        <DifficultyPill value={route.difficulty} />
      </div>
      <h3 style={{ marginTop: 6 }}>{route.name}</h3>
      <div className="row small">
        <span className="strong">{km(route.distanceM)}</span>
        <span className="muted">{elevation(route.elevationGain)}</span>
        <span className="muted">~{duration(route.estDurationS)}</span>
      </div>
      <div className="row tiny muted" style={{ marginTop: 6 }}>
        {route.upcomingCount > 0 && <span>👥 {route.upcomingCount} upcoming</span>}
        {route.reportCount > 0 && <span>📣 {route.reportCount} recent reports</span>}
        {route.distanceFromYouM != null && <span>📍 {distanceAway(route.distanceFromYouM)}</span>}
        {route.flaggedUnsafe && <span className="pill extreme">⚠️ Flagged unsafe</span>}
      </div>
    </Link>
  );
}

export function ActivityCard({ activity }) {
  const spots = activity.participantLimit ? activity.participantLimit - (activity.participantCount ?? 0) : null;
  return (
    <Link className="card tight" to={`/activities/${activity.id}`}>
      <div className="spread">
        <span className="small strong" style={{ color: 'var(--brand)' }}>
          {when(activity.startsAt)}
        </span>
        {activity.visibility === 'private' && <span className="pill">🔒 Private</span>}
        {activity.myStatus === 'joined' && <span className="pill brand">✓ Joined</span>}
        {activity.myStatus === 'requested' && <span className="pill">Requested</span>}
      </div>
      <h3 style={{ marginTop: 4 }}>
        {ACTIVITY_EMOJI[activity.activityType]} {activity.title}
      </h3>
      <div className="small muted">
        {activity.route.name} · {km(activity.route.distanceM)}
        {activity.pace ? ` · ${activity.pace}` : ''}
      </div>
      <div className="row small" style={{ marginTop: 6 }}>
        <span>👥 {activity.participantCount ?? 0}{activity.participantLimit ? ` / ${activity.participantLimit}` : ''} going</span>
        {spots != null && spots > 0 && <span className="muted">{spots} spots left</span>}
        {spots === 0 && <span className="pill">Full</span>}
        {activity.distanceFromYouM != null && <span className="muted">📍 {distanceAway(activity.distanceFromYouM)}</span>}
      </div>
    </Link>
  );
}

export function EventCard({ event }) {
  return (
    <Link className="card tight" to={`/events/${event.id}`}>
      <div className="spread">
        <span className="small strong" style={{ color: 'var(--brand)' }}>
          {when(event.startsAt)}
        </span>
        <DifficultyPill value={event.difficulty} />
      </div>
      <h3 style={{ marginTop: 4 }}>
        {ACTIVITY_EMOJI[event.activityType]} {event.title}
      </h3>
      <div className="small muted">
        by {event.community.name}
        {event.route?.distanceM ? ` · ${km(event.route.distanceM)}` : ''}
      </div>
      <div className="row small" style={{ marginTop: 6 }}>
        <span>🎟 {event.participantCount ?? 0}{event.maxParticipants ? ` / ${event.maxParticipants}` : ''} registered</span>
        {event.distanceFromYouM != null && <span className="muted">📍 {distanceAway(event.distanceFromYouM)}</span>}
        {event.registered && <span className="pill brand">✓ Registered</span>}
      </div>
    </Link>
  );
}

export function CommunityCard({ community }) {
  return (
    <Link className="card tight" to={`/communities/${community.id}`}>
      <div className="spread">
        <span className="small muted">
          {ACTIVITY_EMOJI[community.activityType]} {community.activityLabel}
          {community.locationName ? ` · ${community.locationName}` : ''}
        </span>
        {community.privacy === 'private' && <span className="pill">🔒 Private</span>}
      </div>
      <h3 style={{ marginTop: 6 }}>{community.name}</h3>
      <div className="row small">
        <span>👥 {community.memberCount?.toLocaleString()} members</span>
        {community.myStatus === 'member' && <span className="pill brand">✓ Member</span>}
        {community.myStatus === 'requested' && <span className="pill">Requested</span>}
      </div>
    </Link>
  );
}

export function ConditionItem({ report, showRoute = false }) {
  return (
    <div className="row" style={{ alignItems: 'flex-start', flexWrap: 'nowrap' }}>
      <span aria-hidden="true">{SEVERITY_DOT[report.severity] ?? '⚪'}</span>
      <div style={{ flex: 1 }}>
        <div>
          <span className="strong">{report.categoryLabel}:</span> {conditionLabel(report.value)}
          {report.km != null && <span className="muted"> · KM {report.km}</span>}
        </div>
        {report.description && <div className="small">{report.description}</div>}
        <div className="tiny muted">
          {showRoute && report.routeName && (
            <>
              <Link to={`/routes/${report.routeId}`}>{report.routeName}</Link> ·{' '}
            </>
          )}
          {ago(report.createdAt)} · by {report.user.name}
        </div>
      </div>
    </div>
  );
}
