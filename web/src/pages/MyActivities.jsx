import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { ActivityCard, EventCard } from '../components/cards.jsx';
import { Empty, Loaded } from '../components/ui.jsx';
import { useLoad } from '../session.jsx';

export function MyActivities() {
  const [tab, setTab] = useState('upcoming');
  const state = useLoad(async () => {
    if (tab === 'events') return { events: (await api.get('/events?mine=1&limit=50')).events };
    return api.get(`/activities?mine=1&limit=50${tab === 'past' ? '&when=past' : ''}`);
  }, [tab]);

  return (
    <>
      <div className="spread">
        <h1 style={{ margin: 0 }}>My activities</h1>
        <Link className="btn primary small" to="/activities/new">
          + Plan an activity
        </Link>
      </div>
      <div className="tabs" role="tablist" style={{ margin: '12px 0' }}>
        {[
          ['upcoming', 'Upcoming'],
          ['events', 'My events'],
          ['past', 'Past'],
        ].map(([k, l]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>
            {l}
          </button>
        ))}
      </div>
      <Loaded state={state}>
        {(d) => {
          const list = d.activities ?? d.events;
          if (!list.length) {
            return (
              <Empty>
                {tab === 'upcoming' && (
                  <>
                    You haven&apos;t joined anything yet. <Link to="/explore?tab=activities">Find people to go with</Link> or{' '}
                    <Link to="/activities/new">plan your own</Link>.
                  </>
                )}
                {tab === 'events' && (
                  <>
                    No events yet. <Link to="/explore?tab=events">Browse events</Link>.
                  </>
                )}
                {tab === 'past' && 'Your past activities will show up here.'}
              </Empty>
            );
          }
          return (
            <div className="grid-cards">
              {d.activities ? list.map((a) => <ActivityCard key={a.id} activity={a} />) : list.map((e) => <EventCard key={e.id} event={e} />)}
            </div>
          );
        }}
      </Loaded>
    </>
  );
}
