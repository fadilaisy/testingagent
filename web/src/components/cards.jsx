import { BadgeCheck, Check, Clock, Lock, MapPin, Megaphone, TriangleAlert, Users } from 'lucide-react';
import { Link } from 'react-router-dom';
import { ago, conditionLabel, distanceAway, duration, elevation, km, rupiah, when } from '../format.js';
import { Ico, SeverityDot, severityTone } from './icons.jsx';
import { ActIcon, DifficultyPill } from './ui.jsx';

// Pills are kept for things that change what you can do: your own status,
// a warning, or scarcity. Plain facts go in the meta line as text.

export function RouteCard({ route }) {
  return (
    <Link className="card tight" to={`/routes/${route.id}`}>
      <div className="card-row">
        <ActIcon type={route.activityType} />
        <div className="card-main">
          <h3 className="truncate">{route.name}</h3>
          <div className="small muted num">
            {km(route.distanceM)} · {elevation(route.elevationGain)} · ~{duration(route.estDurationS)}
          </div>
        </div>
        <DifficultyPill value={route.difficulty} />
      </div>
      <div className="meta tiny muted card-foot num">
        {route.locationName && <span>{route.locationName}</span>}
        {route.upcomingCount > 0 && (
          <span>
            <Ico icon={Users} /> {route.upcomingCount} upcoming
          </span>
        )}
        {route.reportCount > 0 && (
          <span>
            <Ico icon={Megaphone} /> {route.reportCount} {route.reportCount === 1 ? 'report' : 'reports'}
          </span>
        )}
        {route.distanceFromYouM != null && (
          <span>
            <Ico icon={MapPin} /> {distanceAway(route.distanceFromYouM)}
          </span>
        )}
        {route.flaggedUnsafe && (
          <span className="pill extreme">
            <Ico icon={TriangleAlert} /> Flagged unsafe
          </span>
        )}
      </div>
    </Link>
  );
}

export function ActivityCard({ activity, featured = false }) {
  const spots = activity.participantLimit ? activity.participantLimit - (activity.participantCount ?? 0) : null;
  return (
    <Link className={`card tight${featured ? ' featured' : ''}`} to={`/activities/${activity.id}`}>
      <div className="card-row">
        <ActIcon type={activity.activityType} size={featured ? 48 : 40} />
        <div className="card-main">
          <div className="card-when num">
            <Ico icon={Clock} /> {when(activity.startsAt)}
          </div>
          <h3>{activity.title}</h3>
        </div>
      </div>
      <div className="small muted card-foot num">
        {activity.route.name} · {km(activity.route.distanceM)}
        {activity.pace ? ` · ${activity.pace}` : ''}
      </div>
      <div className="meta small card-foot num">
        <span>
          <Ico icon={Users} /> {activity.participantCount ?? 0}
          {activity.participantLimit ? ` / ${activity.participantLimit}` : ''} going
        </span>
        {activity.distanceFromYouM != null && (
          <span className="muted">
            <Ico icon={MapPin} /> {distanceAway(activity.distanceFromYouM)}
          </span>
        )}
        {activity.visibility === 'private' && (
          <span className="muted">
            <Ico icon={Lock} /> Private
          </span>
        )}
        <span className="meta-end">
          {activity.myStatus === 'joined' && (
            <span className="pill brand">
              <Ico icon={Check} /> Joined
            </span>
          )}
          {activity.myStatus === 'requested' && <span className="pill">Requested</span>}
          {!activity.myStatus && spots != null && spots > 0 && spots <= 4 && (
            <span className="pill accent">
              {spots} {spots === 1 ? 'spot' : 'spots'} left
            </span>
          )}
          {!activity.myStatus && spots === 0 && <span className="pill extreme">Full</span>}
        </span>
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
          <div className="small muted num">
            {when(event.startsAt)} · {event.community.name}
            {event.route?.distanceM ? ` · ${km(event.route.distanceM)}` : ''}
          </div>
          <div className="meta small card-foot num">
            <span className="strong">{event.kind === 'paid' ? rupiah(event.priceIdr) : 'Free'}</span>
            <span>
              <Ico icon={Users} /> {event.participantCount ?? 0}
              {event.maxParticipants ? ` / ${event.maxParticipants}` : ''}
            </span>
            {event.distanceFromYouM != null && (
              <span className="muted">
                <Ico icon={MapPin} /> {distanceAway(event.distanceFromYouM)}
              </span>
            )}
            {event.registered && (
              <span className="pill brand">
                <Ico icon={Check} /> Registered
              </span>
            )}
            {event.myRegistration === 'pending' && <span className="pill accent">Payment pending</span>}
          </div>
        </div>
        <DifficultyPill value={event.difficulty} />
      </div>
    </Link>
  );
}

export function EventKindPill({ event }) {
  return event.kind === 'paid' ? <span className="pill accent num">{rupiah(event.priceIdr)}</span> : <span className="pill">Free</span>;
}

export function CommunityCard({ community }) {
  return (
    <Link className="card tight" to={`/communities/${community.id}`}>
      <div className="card-row">
        <ActIcon type={community.activityType} size={48} />
        <div className="card-main">
          <h3 className="truncate">
            {community.name}
            {community.verifiedOrganizer && (
              <>
                {' '}
                <Ico icon={BadgeCheck} aria-hidden={undefined} aria-label="Verified organizer" className="ico verified" />
              </>
            )}
          </h3>
          <div className="small muted num">
            {community.memberCount?.toLocaleString()} {community.memberCount === 1 ? 'member' : 'members'}
            {community.locationName ? ` · ${community.locationName}` : ''}
          </div>
        </div>
        {community.myStatus === 'member' && (
          <span className="pill brand">
            <Ico icon={Check} /> Member
          </span>
        )}
        {community.myStatus === 'requested' && <span className="pill">Requested</span>}
        {!community.myStatus && community.privacy === 'private' && (
          <span className="muted small nowrap">
            <Ico icon={Lock} /> Private
          </span>
        )}
      </div>
    </Link>
  );
}

export function ConditionItem({ report, showRoute = false }) {
  return (
    <div className="condition">
      <span className={`condition-icon ${severityTone(report.severity)}`}>
        <SeverityDot severity={report.severity} />
      </span>
      <div className="card-main">
        <div>
          <span className="strong">{report.categoryLabel}:</span> {conditionLabel(report.value)}
          {report.km != null && <span className="muted num"> · KM {report.km}</span>}
        </div>
        {report.description && <div className="small">{report.description}</div>}
        <div className="tiny muted num">
          {showRoute && report.routeName && (
            <>
              <Link to={`/routes/${report.routeId}`}>{report.routeName}</Link> ·{' '}
            </>
          )}
          {ago(report.createdAt)} · {report.user.name}
        </div>
      </div>
    </div>
  );
}
