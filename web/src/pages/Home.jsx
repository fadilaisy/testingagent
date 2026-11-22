import { ArrowRight, CalendarClock, LocateFixed, MapPin, Plus } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, qs } from '../api.js';
import { ConditionItem } from '../components/cards.jsx';
import { FinishedFeedCard, PlanFeedCard } from '../components/feed.jsx';
import { ACTIVITY_STYLE, activityIcon } from '../components/icons.jsx';
import { MapView } from '../components/MapView.jsx';
import { ActIcon, ActivityChips, Avatar, Empty, Loaded, Skeleton } from '../components/ui.jsx';
import { elevation, km, rupiah, when } from '../format.js';
import { getPosition, useLoad, useSession } from '../session.jsx';

// Home is a dashboard in three columns on wide screens: you on the left,
// the feed of plans and finished outings in the middle, and things to go
// to on the right. Phones stack them with the feed first.

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

function SideBlock({ title, link, linkLabel = 'See all', children }) {
  return (
    <section className="card side-block">
      <div className="side-block-head">
        <h2>{title}</h2>
        {link && <Link to={link}>{linkLabel}</Link>}
      </div>
      {children}
    </section>
  );
}

const monthFmt = new Intl.DateTimeFormat(undefined, { month: 'short' });

// Events in the narrow column: the date, the name, the time and price.
function SideEvent({ event: e }) {
  const date = new Date(e.startsAt);
  return (
    <Link className="side-row" to={`/events/${e.id}`}>
      <span className="date-tile" aria-hidden="true">
        <span>{monthFmt.format(date)}</span>
        <strong>{date.getDate()}</strong>
      </span>
      <span className="card-main">
        <span className="strong truncate">{e.title}</span>
        <span className="tiny muted truncate num">
          {e.community.name} · {e.kind === 'paid' ? rupiah(e.priceIdr) : 'Free'}
          {e.registered ? ' · Registered' : ''}
        </span>
      </span>
    </Link>
  );
}

function MeCard({ me }) {
  const s = me.stats;
  return (
    <section className="card me-card" aria-label="You">
      <div className="me-id">
        <Link to={`/users/${me.id}`} aria-label="Your profile">
          <Avatar name={me.name} size="lg" />
        </Link>
        <div className="card-main">
          <h2 className="truncate">{me.name}</h2>
          {me.locationName && <div className="small muted truncate">{me.locationName}</div>}
        </div>
      </div>
      <dl className="me-totals num">
        <div>
          <dt>Outings</dt>
          <dd>{s.outings}</dd>
        </div>
        <div>
          <dt>Distance</dt>
          <dd>{km(s.totalDistanceM, 0)}</dd>
        </div>
        <div>
          <dt>Communities</dt>
          <dd>{s.communities}</dd>
        </div>
      </dl>
      <div className="me-week">
        <h3>Last 7 days</h3>
        <p className="num">
          <strong>{km(s.weekDistanceM)}</strong>
          <span className="muted">
            {' '}
            in {s.weekOutings} {s.weekOutings === 1 ? 'outing' : 'outings'} · {elevation(s.weekElevationM)}
          </span>
        </p>
      </div>
      {me.next && (
        <Link className="me-row" to={`/activities/${me.next.id}`}>
          <span className="me-row-label">Your next plan</span>
          <span className="strong truncate">{me.next.title}</span>
          <span className="tiny muted num">
            <CalendarClock className="ico" size="1em" aria-hidden="true" /> {when(me.next.startsAt)}
          </span>
        </Link>
      )}
      {me.latest && (
        <Link className="me-row" to={`/activities/${me.latest.id}`}>
          <span className="me-row-label">Latest outing</span>
          <span className="strong truncate">{me.latest.title}</span>
          <span className="tiny muted num">
            {when(me.latest.date)} · {km(me.latest.distanceM)}
          </span>
        </Link>
      )}
      <Link className="me-more" to={`/users/${me.id}`}>
        Your history <ArrowRight className="ico" size="1em" aria-hidden="true" />
      </Link>
    </section>
  );
}

function GuestCard() {
  return (
    <section className="card me-card">
      <h2>Ride and run with people near you</h2>
      <p className="small muted">Find a route, see who is going, check the weather and the latest track conditions, then finish somewhere good.</p>
      <Link className="btn primary block" to="/register">
        Join ROAMR
      </Link>
      <p className="small" style={{ margin: 'var(--space-3) 0 0', textAlign: 'center' }}>
        <Link to="/login">I have an account</Link>
      </p>
    </section>
  );
}

function FeedSkeleton() {
  return (
    <div className="stack" role="status">
      <span className="sr-only">Loading</span>
      {[0, 1].map((i) => (
        <div key={i} className="card feed-card" aria-hidden="true">
          <div className="feed-head">
            <Skeleton width={44} height={44} style={{ borderRadius: 12 }} />
            <div className="card-main stack" style={{ gap: 8 }}>
              <Skeleton width="50%" height="0.9em" />
              <Skeleton width="70%" height="0.7em" />
            </div>
          </div>
          <Skeleton width="60%" height="1.3em" style={{ marginTop: 16 }} />
          <Skeleton height={180} style={{ marginTop: 16, borderRadius: 'var(--inner)' }} />
        </div>
      ))}
    </div>
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
  const explore = `/explore${activity ? `?activity=${activity}` : ''}`;

  return (
    <div className="dash">
      <aside className="dash-me">{user ? d?.me ? <MeCard me={d.me} /> : <Skeleton height={360} style={{ borderRadius: 'var(--radius)' }} /> : <GuestCard />}</aside>

      <div className="dash-feed">
        <div className="feed-intro">
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
          {locError && <p className="field-error">{locError}</p>}
          <div className="feed-tools">
            <ActivityChips value={activity} onChange={setActivity} />
            {user && (
              <Link className="btn primary" to="/activities/new">
                <Plus size={20} aria-hidden="true" /> Plan an activity
              </Link>
            )}
          </div>
        </div>

        <Loaded state={state} skeleton={<FeedSkeleton />}>
          {(d) => (
            <>
              <Section title="Next up near you" link={`/explore?tab=activities${activity ? `&activity=${activity}` : ''}`} linkLabel="All plans">
                {d.nearbyActivities.length ? (
                  <div className="feed">
                    {d.nearbyActivities.map((a) => (
                      <PlanFeedCard key={a.id} activity={a} />
                    ))}
                  </div>
                ) : (
                  <Empty>
                    Nothing planned within 50 km yet. <Link to={explore}>Pick a route</Link> and announce your own plan.
                  </Empty>
                )}
              </Section>
              {d.finishedActivities.length > 0 && (
                <Section title="Finished together, last 30 days">
                  <div className="feed">
                    {d.finishedActivities.map((a) => (
                      <FinishedFeedCard key={a.id} activity={a} />
                    ))}
                  </div>
                </Section>
              )}
            </>
          )}
        </Loaded>
      </div>

      <aside className="dash-side" aria-label="Around you">
        {d && (
          <>
            <section className="card side-block side-map">
              <MapView markers={markers} center={d.center} label="Map of plans near you" />
            </section>
            <SideBlock title="Events, next 30 days" link="/explore?tab=events">
              {d.upcomingEvents.length ? (
                <div className="stack tight">
                  {d.upcomingEvents.map((e) => (
                    <SideEvent key={e.id} event={e} />
                  ))}
                </div>
              ) : (
                <p className="small muted">No events from communities near you in the next 30 days.</p>
              )}
            </SideBlock>
            <SideBlock title="Track reports, 24 hours">
              {d.recentConditions.length ? (
                <div className="list">
                  {d.recentConditions.slice(0, 3).map((r) => (
                    <ConditionItem key={r.id} report={r} showRoute />
                  ))}
                </div>
              ) : (
                <p className="small muted">No reports from riders and runners in the last 24 hours.</p>
              )}
            </SideBlock>
            <SideBlock title="Popular routes" link={explore}>
              <div className="stack tight">
                {d.popularRoutes.slice(0, 4).map((r) => (
                  <Link key={r.id} className="side-row" to={`/routes/${r.id}`}>
                    <ActIcon type={r.activityType} size={44} />
                    <span className="card-main">
                      <span className="strong truncate">{r.name}</span>
                      <span className="tiny muted truncate num">
                        {km(r.distanceM)} · {elevation(r.elevationGain)}
                        {r.upcomingCount ? ` · ${r.upcomingCount} upcoming` : ''}
                      </span>
                    </span>
                  </Link>
                ))}
              </div>
            </SideBlock>
            <SideBlock title="Communities to join" link="/communities">
              <div className="stack tight">
                {d.popularCommunities.map((c) => (
                  <Link key={c.id} className="side-row" to={`/communities/${c.id}`}>
                    <ActIcon type={c.activityType} size={44} />
                    <span className="card-main">
                      <span className="strong truncate">{c.name}</span>
                      <span className="tiny muted truncate num">
                        {c.myStatus === 'member' ? 'Member · ' : ''}
                        {c.memberCount?.toLocaleString()} {c.memberCount === 1 ? 'member' : 'members'}
                        {c.locationName ? ` · ${c.locationName}` : ''}
                      </span>
                    </span>
                  </Link>
                ))}
              </div>
            </SideBlock>
          </>
        )}
      </aside>
    </div>
  );
}
