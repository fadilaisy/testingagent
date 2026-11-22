import { Building2, CalendarPlus, Medal, Ticket, Upload, Users } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useSession } from '../session.jsx';

const OPTIONS = [
  { to: '/activities/new', Icon: CalendarPlus, title: 'Plan an activity', text: 'Announce a ride, run or hike on a route so others can join you.' },
  { to: '/routes/new', Icon: Upload, title: 'Upload GPX', text: 'Turn a .gpx file into a route page with map, climbing, weather and conditions.' },
  { to: '/events/new?kind=community', Icon: Ticket, title: 'Community event', text: 'Run by people: a free event for your community members and riders and runners nearby.' },
  { to: '/events/new?kind=paid', Icon: Medal, title: 'Paid event', text: 'For verified organizers and sponsors: sell spots for a race or supported ride, with perks like a finisher medal.' },
  { to: '/communities/new', Icon: Users, title: 'Create a community', text: 'Premium: start your own club with events, announcements and members.' },
  { to: '/communities/new?kind=organizer', Icon: Building2, title: 'Become an organizer', text: 'Premium: for organizations and sponsors. A ROAMR admin approves you before you sell paid events.' },
];

export function CreateHub() {
  const { user } = useSession();
  return (
    <>
      <h1>What do you want to start?</h1>
      <div className="grid-cards">
        {OPTIONS.map((o) => (
          <Link key={o.to} className={`card${o.to === '/activities/new' ? ' featured' : ''}`} to={user ? o.to : `/login?next=${encodeURIComponent(o.to)}`}>
            <span className="act-icon tile" aria-hidden="true">
              <o.Icon size={22} />
            </span>
            <h3 className="card-title">{o.title}</h3>
            <p className="muted small" style={{ margin: 0 }}>
              {o.text}
            </p>
          </Link>
        ))}
      </div>
    </>
  );
}
