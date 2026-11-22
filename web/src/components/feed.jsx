import { CalendarClock, Check, Megaphone, Users } from 'lucide-react';
import { Link } from 'react-router-dom';
import { duration, elevation, km, when } from '../format.js';
import { ACTIVITY_STYLE, Ico } from './icons.jsx';
import { ActIcon, Avatar } from './ui.jsx';

// Home feed cards: who, when, the route as a line, then three numbers. The
// route is drawn as SVG from a cut-down copy of its geometry, so the feed
// loads no map tiles.

export function RouteLine({ points, type, label }) {
  if (!points || points.length < 2) return null;
  const W = 600;
  const H = 220;
  const pad = 22;
  const lats = points.map((p) => p[0]);
  const lngs = points.map((p) => p[1]);
  const midLat = (Math.min(...lats) + Math.max(...lats)) / 2;
  const kx = Math.cos((midLat * Math.PI) / 180); // longitude degrees shrink away from the equator
  const minX = Math.min(...lngs) * kx;
  const maxX = Math.max(...lngs) * kx;
  const minY = Math.min(...lats);
  const maxY = Math.max(...lats);
  const scale = Math.min((W - pad * 2) / (maxX - minX || 1e-6), (H - pad * 2) / (maxY - minY || 1e-6));
  const ox = (W - (maxX - minX) * scale) / 2;
  const oy = (H - (maxY - minY) * scale) / 2;
  const xy = points.map(([lat, lng]) => [ox + (lng * kx - minX) * scale, H - (oy + (lat - minY) * scale)]);
  const d = xy.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join('');
  const color = (ACTIVITY_STYLE[type] ?? ACTIVITY_STYLE.other).color;
  const [sx, sy] = xy[0];
  const [ex, ey] = xy.at(-1);
  return (
    <svg className="route-line" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet" role="img" aria-label={label}>
      <path d={d} className="route-line-halo" />
      <path d={d} className="route-line-path" style={{ stroke: color }} />
      <circle cx={ex} cy={ey} r="7" className="route-line-end" />
      <circle cx={sx} cy={sy} r="7" className="route-line-start" />
    </svg>
  );
}

function FeedStats({ items }) {
  return (
    <dl className="feed-stats num">
      {items.map(([label, value]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function Faces({ people, total }) {
  const shown = people.slice(0, 4);
  return (
    <span className="avatars" aria-hidden="true">
      {shown.map((p) => (
        <Avatar key={p.id} name={p.name} />
      ))}
      {total > shown.length && <span className="avatar more">+{total - shown.length}</span>}
    </span>
  );
}

function names(people, total) {
  const n = people.map((p) => p.name);
  const others = total - n.length;
  if (others > 0) n.push(`${others} ${others === 1 ? 'other' : 'others'}`);
  if (n.length <= 1) return n[0] ?? `${total} people`;
  return `${n.slice(0, -1).join(', ')} and ${n.at(-1)}`;
}

// A plan you can still join. The whole card opens the plan.
export function PlanFeedCard({ activity }) {
  const a = activity;
  const spots = a.participantLimit ? a.participantLimit - (a.participantCount ?? 0) : null;
  return (
    <article className="card feed-card">
      <header className="feed-head">
        <ActIcon type={a.activityType} size={44} />
        <div className="card-main">
          <div className="strong truncate">{a.host.name ?? 'Someone'} is hosting</div>
          <div className="tiny muted num">
            <Ico icon={CalendarClock} /> {when(a.startsAt)} · {a.meetingPoint}
          </div>
        </div>
      </header>
      <h3 className="feed-title">
        <Link className="stretch" to={`/activities/${a.id}`}>
          {a.title}
        </Link>
      </h3>
      <div className="small muted">
        {a.activityLabel} on {a.route.name}
        {a.pace ? ` · ${a.pace}` : ''}
      </div>
      <FeedStats
        items={[
          ['Distance', km(a.route.distanceM)],
          ['Elev. gain', elevation(a.route.elevationGain)],
          ['Est. time', duration(a.route.estDurationS)],
        ]}
      />
      <RouteLine points={a.routeLine} type={a.activityType} label={`Route of ${a.route.name}`} />
      <footer className="meta small feed-foot num">
        <span>
          <Ico icon={Users} /> {a.participantCount ?? 0}
          {a.participantLimit ? ` / ${a.participantLimit}` : ''} going
        </span>
        <span className="meta-end">
          {a.myStatus === 'joined' && (
            <span className="pill brand">
              <Ico icon={Check} /> Joined
            </span>
          )}
          {a.myStatus === 'requested' && <span className="pill">Requested</span>}
          {!a.myStatus && spots != null && spots > 0 && spots <= 4 && (
            <span className="pill accent">
              {spots} {spots === 1 ? 'spot' : 'spots'} left
            </span>
          )}
          {!a.myStatus && spots === 0 && <span className="pill extreme">Full</span>}
        </span>
      </footer>
    </article>
  );
}

// An outing people already finished together.
export function FinishedFeedCard({ activity }) {
  const a = activity;
  return (
    <article className="card feed-card">
      <header className="feed-head">
        <Faces people={a.finishers} total={a.finishedCount} />
        <div className="card-main">
          <div className="strong truncate">{names(a.finishers, a.finishedCount)}</div>
          <div className="tiny muted num">
            Finished together · {when(a.startsAt)}
          </div>
        </div>
      </header>
      <h3 className="feed-title">
        <Link className="stretch" to={`/activities/${a.id}`}>
          {a.title}
        </Link>
      </h3>
      <div className="small muted">
        {a.activityLabel} on {a.route.name}
      </div>
      <FeedStats
        items={[
          ['Distance', km(a.route.distanceM)],
          ['Elev. gain', elevation(a.route.elevationGain)],
          ['Finished', a.finishedCount],
        ]}
      />
      <RouteLine points={a.routeLine} type={a.activityType} label={`Route of ${a.route.name}`} />
      {a.reportCount > 0 && (
        <footer className="meta small feed-foot muted num">
          <span>
            <Ico icon={Megaphone} /> {a.reportCount} track {a.reportCount === 1 ? 'report' : 'reports'} from this outing
          </span>
        </footer>
      )}
    </article>
  );
}
