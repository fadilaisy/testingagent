import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../api.js';
import { CommunityCard, EventCard, RouteCard } from '../components/cards.jsx';
import { Avatar, Empty, Loaded } from '../components/ui.jsx';
import { useLoad } from '../session.jsx';

// Global search (PRD §28): routes, communities, events, people and places.
export function Search() {
  const [params] = useSearchParams();
  const q = params.get('q') ?? '';
  const state = useLoad(() => api.get(`/search?q=${encodeURIComponent(q)}`), [q]);

  return (
    <>
      <h1>Results for “{q}”</h1>
      <Loaded state={state}>
        {(d) => {
          const total = d.routes.length + d.communities.length + d.events.length + d.users.length + d.places.length;
          if (!total) return <Empty>Nothing found. Try a place name like “Sentul” or “Puncak”.</Empty>;
          return (
            <div className="stack">
              {d.routes.length > 0 && (
                <section>
                  <h2>Routes</h2>
                  <div className="grid-cards">
                    {d.routes.map((r) => (
                      <RouteCard key={r.id} route={r} />
                    ))}
                  </div>
                </section>
              )}
              {d.events.length > 0 && (
                <section>
                  <h2>Events</h2>
                  <div className="grid-cards">
                    {d.events.map((e) => (
                      <EventCard key={e.id} event={e} />
                    ))}
                  </div>
                </section>
              )}
              {d.communities.length > 0 && (
                <section>
                  <h2>Communities</h2>
                  <div className="grid-cards">
                    {d.communities.map((c) => (
                      <CommunityCard key={c.id} community={c} />
                    ))}
                  </div>
                </section>
              )}
              {d.users.length > 0 && (
                <section>
                  <h2>People</h2>
                  <div className="card list">
                    {d.users.map((u) => (
                      <Link key={u.id} to={`/users/${u.id}`} className="row">
                        <Avatar name={u.name} /> {u.name} <span className="muted small">{u.locationName}</span>
                      </Link>
                    ))}
                  </div>
                </section>
              )}
              {d.places.length > 0 && (
                <section>
                  <h2>Places</h2>
                  <div className="card list">
                    {d.places.map((p) => (
                      <a key={p.id} href={`https://www.openstreetmap.org/?mlat=${p.lat}&mlon=${p.lng}#map=17/${p.lat}/${p.lng}`} target="_blank" rel="noreferrer">
                        {p.emoji} {p.name} <span className="muted small">{p.label}</span>
                      </a>
                    ))}
                  </div>
                </section>
              )}
            </div>
          );
        }}
      </Loaded>
    </>
  );
}
