import { Link } from 'react-router-dom';
import { useSession } from '../session.jsx';

const OPTIONS = [
  { to: '/routes/new', emoji: '🗺', title: 'Upload GPX', text: 'Turn a .gpx file into a route page with map, climbing, weather and conditions.' },
  { to: '/activities/new', emoji: '📣', title: 'Plan an activity', text: 'Announce a ride, run or hike on a route so others can join you.' },
  { to: '/events/new?kind=community', emoji: '🎟', title: 'Community event', text: 'For community admins: a free event for your members and riders and runners nearby.' },
  { to: '/events/new?kind=paid', emoji: '💳', title: 'Paid event', text: 'For community admins: sell spots for a supported ride, race or clinic. Participants pay online or by transfer.' },
  { to: '/communities/new', emoji: '👥', title: 'Create a community', text: 'Premium: start your own club with events, announcements and members.' },
];

export function CreateHub() {
  const { user } = useSession();
  return (
    <>
      <h1>Create</h1>
      <div className="grid-cards">
        {OPTIONS.map((o) => (
          <Link key={o.to} className="card" to={user ? o.to : `/login?next=${encodeURIComponent(o.to)}`}>
            <div style={{ fontSize: '2rem' }} aria-hidden="true">
              {o.emoji}
            </div>
            <h3>{o.title}</h3>
            <p className="muted small" style={{ margin: 0 }}>
              {o.text}
            </p>
          </Link>
        ))}
      </div>
    </>
  );
}
