import { Bike, Footprints, MapPin, Mountain } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, qs } from '../api.js';
import { ActivityCard, CommunityCard, ConditionItem, EventCard, RouteCard } from '../components/cards.jsx';
import { ActivityChips, Empty, Loaded } from '../components/ui.jsx';
import { getPosition, useLoad, useSession } from '../session.jsx';

const QUICK = [
  { key: 'road_cycling', label: 'Ride', Icon: Bike },
  { key: 'running', label: 'Run', Icon: Footprints },
  { key: 'trail_running', label: 'Trail', Icon: Mountain },
  { key: 'mtb', label: 'MTB', Icon: Bike },
];

function Section({ title, link, linkLabel = 'See all', children }) {
  return (
    <section className="section">
      <div className="section-head">
        <h2>{title}</h2>
        {link && <Link to={link}>{linkLabel}</Link>}
      </div>
      {children}
    </section>
  );
}

export function Home() {
  const { user } = useSession();
  const [activity, setActivity] = useState('');
  const [pos, setPos] = useState(null);
  const [locError, setLocError] = useState(null);
  const state = useLoad(() => api.get(`/home${qs({ activity, lat: pos?.lat, lng: pos?.lng })}`), [activity, pos]);

  async function locate() {
    setLocError(null);
    try {
      setPos(await getPosition());
    } catch (err) {
      setLocError(err.message);
    }
  }

  return (
    <>
      <div className="hero">
        <svg className="hero-contours" viewBox="0 0 400 200" preserveAspectRatio="none" aria-hidden="true">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <path
              key={i}
              d={`M-10,${30 + i * 28} C80,${i * 20} 150,${80 + i * 20} 250,${40 + i * 24} S360,${60 + i * 10} 420,${20 + i * 30}`}
            />
          ))}
        </svg>
        <div className="hero-body">
          <div className="hero-place">
            <MapPin size={16} aria-hidden="true" /> {pos ? 'Near you' : user?.locationName ?? 'Jakarta'}
          </div>
          <h1>What do you want to do today{user ? `, ${user.name}` : ''}?</h1>
          {!user && (
            <p>
              Find a route, see who&apos;s going, check the weather and the latest track conditions, then finish somewhere good.{' '}
              <Link to="/register">Join Jalur</Link>
            </p>
          )}
          <div className="big-choices" role="group" aria-label="Activity">
            {QUICK.map(({ key, label, Icon }) => (
              <button
                type="button"
                key={key}
                className={`big-choice${activity === key ? ' on' : ''}`}
                aria-pressed={activity === key}
                onClick={() => setActivity(activity === key ? '' : key)}
              >
                <Icon size={28} strokeWidth={2.2} aria-hidden="true" />
                <span>{label}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
      <div style={{ marginTop: 12 }}>
        <ActivityChips value={activity} onChange={setActivity} />
      </div>

      <Loaded state={state}>
        {(d) => (
          <>
            <Section title="Near you" link={`/explore?tab=activities${activity ? `&activity=${activity}` : ''}`}>
              <div className="spread" style={{ marginBottom: 10 }}>
                <p className="muted" style={{ margin: 0 }}>
                  <strong style={{ color: 'var(--text)' }}>{d.nearbyCount}</strong> {d.nearbyCount === 1 ? 'activity' : 'activities'} planned
                  within 50 km of {pos ? 'you' : user?.locationName ?? 'Jakarta'}
                </p>
                {!pos && (
                  <button type="button" className="btn ghost small" onClick={locate}>
                    📍 Use my location
                  </button>
                )}
              </div>
              {locError && <p className="field-error">{locError}</p>}
              {d.nearbyActivities.length ? (
                <div className="grid-cards">
                  {d.nearbyActivities.map((a) => (
                    <ActivityCard key={a.id} activity={a} />
                  ))}
                </div>
              ) : (
                <Empty>
                  Nothing planned nearby yet. <Link to="/explore">Pick a route</Link> and announce your own plan.
                </Empty>
              )}
            </Section>

            <Section title="Popular routes" link={`/explore${activity ? `?activity=${activity}` : ''}`}>
              {d.popularRoutes.length ? (
                <div className="grid-cards">
                  {d.popularRoutes.map((r) => (
                    <RouteCard key={r.id} route={r} />
                  ))}
                </div>
              ) : (
                <Empty>
                  No routes yet. <Link to="/routes/new">Upload a GPX</Link>
                </Empty>
              )}
            </Section>

            <div className="grid-2">
              <Section title="Upcoming events" link="/explore?tab=events">
                {d.upcomingEvents.length ? (
                  <div className="stack">
                    {d.upcomingEvents.map((e) => (
                      <EventCard key={e.id} event={e} />
                    ))}
                  </div>
                ) : (
                  <Empty>No events from communities near you in the next 30 days.</Empty>
                )}
              </Section>
              <Section title="Track conditions">
                <div className="card">
                  {d.recentConditions.length ? (
                    <div className="list">
                      {d.recentConditions.map((r) => (
                        <ConditionItem key={r.id} report={r} showRoute />
                      ))}
                    </div>
                  ) : (
                    <p className="muted" style={{ margin: 0 }}>
                      No reports from riders and runners in the last 24 hours.
                    </p>
                  )}
                </div>
              </Section>
            </div>

            <Section title="Communities" link="/communities">
              <div className="grid-cards">
                {d.popularCommunities.map((c) => (
                  <CommunityCard key={c.id} community={c} />
                ))}
              </div>
            </Section>
          </>
        )}
      </Loaded>
    </>
  );
}
