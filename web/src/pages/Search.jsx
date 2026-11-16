import { Link, useSearchParams } from 'react-router-dom';
import { Ico, placeIcon } from '../components/icons.jsx';
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
      <div className="spread page-head">
        <h1>Results for “{q}”</h1>
        <Link className="btn small" to="/explore">
          Clear search
        </Link>
      </div>
      <p className="muted small">Search covers routes, events, communities, people and places.</p>
      <Loaded state={state}>
        {(d) => {
          const total = d.routes.length + d.communities.length + d.events.length + d.users.length + d.places.length;
          if (!total) {
            return (
              <Empty>
                <p>Nothing matches “{q}”. Try a place name like “Sentul” or “Puncak”, or a shorter word.</p>
                <Link className="btn" to="/explore">
                  Clear search and browse routes
                </Link>
              </Empty>
            );
          }
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
                        <Ico icon={placeIcon(p.category)} /> {p.name} <span className="muted small">{p.label}</span>
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
