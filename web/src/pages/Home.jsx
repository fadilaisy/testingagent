import { ArrowRight, LocateFixed, MapPin, Plus } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, qs } from '../api.js';
import { ActivityCard, CommunityCard, ConditionItem, EventCard, RouteCard } from '../components/cards.jsx';
import { ACTIVITY_STYLE, activityIcon } from '../components/icons.jsx';
import { MapView } from '../components/MapView.jsx';
import { ActivityChips, Empty, Loaded, Skeleton } from '../components/ui.jsx';
import { when } from '../format.js';
import { getPosition, useLoad, useSession } from '../session.jsx';

function Section({ title, link, linkLabel = 'See all', children }) {
  return (
    <section className="section">
      <div className="section-head">
        <h2>{title}</h2>
        {link && (
          <Link to={link}>
            {linkLabel} <ArrowRight className="ico" size="1em" aria-hidden="true" />
          </Link>
        )}
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

  const place = pos ? 'you' : user?.locationName ?? 'Jakarta';
  const d = state.data;
  // The map is the product: every pin is a real plan you can open and join.
  const markers = useMemo(
    () =>
      (d?.nearbyActivities ?? []).map((a) => ({
        lat: a.meeting[0],
        lng: a.meeting[1],
        icon: activityIcon(a.activityType),
        color: ACTIVITY_STYLE[a.activityType]?.color,
        title: a.title,
        subtitle: `${when(a.startsAt)} · ${a.participantCount} going`,
        link: `/activities/${a.id}`,
      })),
    [d],
  );

  return (
    <>
      <div className="home-top">
        <div className="home-intro">
          <div className="home-place">
            <MapPin size={16} aria-hidden="true" /> {pos ? 'Near you' : user?.locationName ?? 'Jakarta'}
            {!pos && (
              <button type="button" className="btn ghost small" onClick={locate}>
                <LocateFixed size={16} aria-hidden="true" /> Use my location
              </button>
            )}
          </div>
          <h1 className="num">
            {!d ? (
              <Skeleton width="80%" height="1em" />
            ) : d.nearbyCount ? (
              `${d.nearbyCount} ${d.nearbyCount === 1 ? 'ride or run' : 'rides and runs'} planned near ${place}`
            ) : (
              `Nothing is planned near ${place} yet`
            )}
          </h1>
          <p className="muted">
            {user
              ? 'All within 50 km. Join one, or pick a route and announce your own.'
              : 'Find a route, see who is going, check the weather and the latest track conditions, then finish somewhere good.'}
          </p>
          {locError && <p className="field-error">{locError}</p>}
          <div className="row home-cta">
            <Link className="btn primary" to={user ? '/activities/new' : '/register'}>
              {user && <Plus size={20} aria-hidden="true" />} {user ? 'Plan an activity' : 'Join ROAMR'}
            </Link>
            <Link className="btn" to={`/explore${activity ? `?activity=${activity}` : ''}`}>
              Find a route
            </Link>
          </div>
        </div>
        <MapView markers={markers} center={d?.center} label="Map of activities near you" />
      </div>
      <div className="home-filter">
        <ActivityChips value={activity} onChange={setActivity} />
      </div>

      <Loaded state={state}>
        {(d) => (
          <>
            <Section title="Next up near you" link={`/explore?tab=activities${activity ? `&activity=${activity}` : ''}`} linkLabel="All activities">
              {d.nearbyActivities.length ? (
                <div className="grid-cards featured">
                  {d.nearbyActivities.map((a) => (
                    <ActivityCard key={a.id} activity={a} featured />
                  ))}
                </div>
              ) : (
                <Empty>
                  Nothing planned nearby yet. <Link to="/explore">Pick a route</Link> and announce your own plan.
                </Empty>
              )}
            </Section>

            <Section title="Routes people ride and run most" link={`/explore${activity ? `?activity=${activity}` : ''}`} linkLabel="All routes">
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
              <Section title="Events in the next 30 days" link="/explore?tab=events" linkLabel="All events">
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
              <Section title="Track reports, last 24 hours">
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

            <Section title="Communities to go out with" link="/communities" linkLabel="All communities">
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
