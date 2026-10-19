import { Clock, Lock, MapPin, Megaphone, Ticket, TriangleAlert, Users } from 'lucide-react';
import { Link } from 'react-router-dom';
import { ago, conditionLabel, distanceAway, duration, elevation, km, when } from '../format.js';
import { ActIcon, DifficultyPill, SEVERITY } from './ui.jsx';

export function RouteCard({ route }) {
  return (
    <Link className="card tight" to={`/routes/${route.id}`}>
      <div className="card-row">
        <ActIcon type={route.activityType} />
        <div className="card-main">
          <h3 className="truncate">{route.name}</h3>
          <div className="small muted">
            {km(route.distanceM)} · {elevation(route.elevationGain)} · ~{duration(route.estDurationS)}
          </div>
        </div>
        <DifficultyPill value={route.difficulty} />
      </div>
      <div className="row tiny muted card-foot">
        <span>
          {route.activityLabel}
          {route.locationName ? ` · ${route.locationName}` : ''}
        </span>
        {route.upcomingCount > 0 && <span><Users className="glyph" size="1em" aria-hidden="true" /> {route.upcomingCount} upcoming</span>}
        {route.reportCount > 0 && <span><Megaphone className="glyph" size="1em" aria-hidden="true" /> {route.reportCount} recent reports</span>}
        {route.distanceFromYouM != null && <span><MapPin className="glyph" size="1em" aria-hidden="true" /> {distanceAway(route.distanceFromYouM)}</span>}
        {route.flaggedUnsafe && <span className="pill extreme"><TriangleAlert className="glyph" size="1em" aria-hidden="true" /> Flagged unsafe</span>}
      </div>
    </Link>
  );
}

export function ActivityCard({ activity }) {
  const spots = activity.participantLimit ? activity.participantLimit - (activity.participantCount ?? 0) : null;
  return (
    <Link className="card tight" to={`/activities/${activity.id}`}>
      <div className="spread">
        <ActIcon type={activity.activityType} />
        <div className="row">
          {activity.visibility === 'private' && <span className="pill"><Lock className="glyph" size="1em" aria-hidden="true" /> Private</span>}
          {activity.myStatus === 'joined' && <span className="pill brand">✓ Joined</span>}
          {activity.myStatus === 'requested' && <span className="pill">Requested</span>}
          {spots != null && spots > 0 && <span className={`pill ${spots <= 4 ? 'earth' : 'brand'}`}>{spots} spots left</span>}
          {spots === 0 && <span className="pill extreme">Full</span>}
        </div>
      </div>
      <h3 className="card-title">{activity.title}</h3>
      <div className="small muted">
        <Clock className="glyph" size="1em" aria-hidden="true" /> {when(activity.startsAt)}
        {activity.distanceFromYouM != null ? ` · ${distanceAway(activity.distanceFromYouM)}` : ''}
      </div>
      <div className="small muted" style={{ marginTop: 2 }}>
        {activity.route.name} · {km(activity.route.distanceM)}
        {activity.pace ? ` · ${activity.pace}` : ''}
      </div>
      <div className="small card-foot">
        <Users className="glyph" size="1em" aria-hidden="true" /> {activity.participantCount ?? 0}
        {activity.participantLimit ? ` / ${activity.participantLimit}` : ''} going
      </div>
    </Link>
  );
}

const monthFmt = new Intl.DateTimeFormat(undefined, { month: 'short' });

export function EventCard({ event }) {
  const d = new Date(event.startsAt);
  return (
    <Link className="card tight" to={`/events/${event.id}`}>
      <div className="card-row">
        <div className="date-tile" aria-hidden="true">
          <span>{monthFmt.format(d)}</span>
          <strong>{d.getDate()}</strong>
        </div>
        <div className="card-main">
          <h3 className="truncate">{event.title}</h3>
          <div className="small muted">
            {when(event.startsAt)} · by {event.community.name}
            {event.route?.distanceM ? ` · ${km(event.route.distanceM)}` : ''}
          </div>
          <div className="row small" style={{ marginTop: 4 }}>
            <span>
              <Ticket className="glyph" size="1em" aria-hidden="true" /> {event.participantCount ?? 0}
              {event.maxParticipants ? ` / ${event.maxParticipants}` : ''} registered
            </span>
            {event.distanceFromYouM != null && <span className="muted"><MapPin className="glyph" size="1em" aria-hidden="true" /> {distanceAway(event.distanceFromYouM)}</span>}
            {event.registered && <span className="pill brand">✓ Registered</span>}
          </div>
        </div>
        <DifficultyPill value={event.difficulty} />
      </div>
    </Link>
  );
}

export function CommunityCard({ community }) {
  return (
    <Link className="card tight" to={`/communities/${community.id}`}>
      <div className="card-row">
        <ActIcon type={community.activityType} size={48} />
        <div className="card-main">
          <h3 className="truncate">{community.name}</h3>
          <div className="small muted">
            {community.memberCount?.toLocaleString()} members
            {community.locationName ? ` · ${community.locationName}` : ''}
          </div>
        </div>
      </div>
      <div className="row small card-foot">
        <span className="muted">{community.activityLabel}</span>
        {community.privacy === 'private' && <span className="pill"><Lock className="glyph" size="1em" aria-hidden="true" /> Private</span>}
        {community.myStatus === 'member' && <span className="pill brand">✓ Member</span>}
        {community.myStatus === 'requested' && <span className="pill">Requested</span>}
      </div>
    </Link>
  );
}

function SeverityIcon({ severity }) {
  const s = SEVERITY[severity] ?? SEVERITY[0];
  return (
    <span className={`condition-icon ${s.tone}`} role="img" aria-label={s.label}>
      <s.Icon size={22} aria-hidden="true" />
    </span>
  );
}

export function ConditionItem({ report, showRoute = false }) {
  return (
    <div className="condition">
      <SeverityIcon severity={report.severity} />
      <div style={{ flex: 1, minWidth: 0 }}>
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
