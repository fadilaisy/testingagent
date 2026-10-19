import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, qs } from '../api.js';
import { ActivityCard, EventCard, RouteCard } from '../components/cards.jsx';
import { MapView } from '../components/MapView.jsx';
import { ActivityChips, Empty, Loaded } from '../components/ui.jsx';
import { ACTIVITY_EMOJI, km, when } from '../format.js';
import { getPosition, useLoad, useSession } from '../session.jsx';

const DISTANCES = {
  '': 'Any distance',
  '0-10': 'Under 10 km',
  '10-30': '10–30 km',
  '30-60': '30–60 km',
  '60-100': '60–100 km',
  '100-': '100+ km',
};

export function Explore() {
  const { meta } = useSession();
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') ?? 'routes';
  const activity = params.get('activity') ?? '';
  const [distance, setDistance] = useState('');
  const [difficulty, setDifficulty] = useState('');
  const [sort, setSort] = useState('popular');
  const [text, setText] = useState('');
  const [pos, setPos] = useState(null);
  const [radius, setRadius] = useState('');
  const [showMap, setShowMap] = useState(true);
  const [locError, setLocError] = useState(null);

  const set = (key, value) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  };

  const [minKm, maxKm] = distance ? distance.split('-') : [];
  const near = pos ? { lat: pos.lat, lng: pos.lng, radiusKm: radius || undefined } : {};
  const state = useLoad(() => {
    if (tab === 'activities') return api.get(`/activities${qs({ activity, limit: 60, ...near })}`);
    if (tab === 'events') return api.get(`/events${qs({ activity, difficulty, limit: 60, ...near })}`);
    return api.get(`/routes${qs({ activity, minKm, maxKm, difficulty, q: text, sort: pos && sort === 'nearby' ? 'nearby' : sort, limit: 60, ...near })}`);
  }, [tab, activity, distance, difficulty, sort, text, pos, radius]);

  const items = state.data?.routes ?? state.data?.activities ?? state.data?.events ?? [];
  const markers = useMemo(() => {
    const list = state.data?.routes ?? state.data?.activities ?? state.data?.events ?? [];
    const out = list.map((x) => {
      if (state.data.routes) {
        return { lat: x.start[0], lng: x.start[1], emoji: ACTIVITY_EMOJI[x.activityType], title: x.name, subtitle: `${km(x.distanceM)} · ${x.difficulty}`, link: `/routes/${x.id}` };
      }
      if (state.data.activities) {
        return { lat: x.meeting[0], lng: x.meeting[1], emoji: ACTIVITY_EMOJI[x.activityType], title: x.title, subtitle: `${when(x.startsAt)} · ${x.participantCount} going`, link: `/activities/${x.id}` };
      }
      return { lat: x.location[0], lng: x.location[1], emoji: '🎟', title: x.title, subtitle: `${when(x.startsAt)} · ${x.community.name}`, link: `/events/${x.id}` };
    });
    if (pos) out.push({ lat: pos.lat, lng: pos.lng, color: '#2a6f97', title: 'You are here' });
    return out;
  }, [state.data, pos]);

  async function locate() {
    setLocError(null);
    try {
      setPos(await getPosition());
      setSort('nearby');
      setRadius('50');
    } catch (err) {
      setLocError(err.message);
    }
  }

  return (
    <>
      <div className="spread">
        <h1 style={{ margin: 0 }}>Explore</h1>
        <div className="row">
          <button type="button" className="btn small" onClick={() => setShowMap((s) => !s)}>
            {showMap ? '☰ List only' : '🗺 Show map'}
          </button>
          {tab === 'routes' && (
            <Link className="btn small primary" to="/routes/new">
              ⬆ Upload GPX
            </Link>
          )}
        </div>
      </div>

      <div className="stack" style={{ marginTop: 12 }}>
        <div className="tabs" role="tablist">
          {[
            ['routes', 'Routes'],
            ['activities', 'Activities'],
            ['events', 'Events'],
          ].map(([k, l]) => (
            <button key={k} type="button" role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => set('tab', k === 'routes' ? '' : k)}>
              {l}
            </button>
          ))}
        </div>
        <ActivityChips value={activity} onChange={(v) => set('activity', v)} />
        <div className="row">
          {tab === 'routes' && (
            <>
              <input type="search" aria-label="Search routes" placeholder="Search routes" value={text} onChange={(e) => setText(e.target.value)} style={{ maxWidth: 220 }} />
              <select aria-label="Distance" value={distance} onChange={(e) => setDistance(e.target.value)} style={{ width: 'auto' }}>
                {Object.entries(DISTANCES).map(([k, l]) => (
                  <option key={k} value={k}>
                    {l}
                  </option>
                ))}
              </select>
            </>
          )}
          {tab !== 'activities' && (
            <select aria-label="Difficulty" value={difficulty} onChange={(e) => setDifficulty(e.target.value)} style={{ width: 'auto' }}>
              <option value="">Any difficulty</option>
              {meta.difficulties.map((d) => (
                <option key={d} value={d}>
                  {d[0].toUpperCase() + d.slice(1)}
                </option>
              ))}
            </select>
          )}
          {tab === 'routes' && (
            <select aria-label="Sort" value={sort} onChange={(e) => setSort(e.target.value)} style={{ width: 'auto' }}>
              <option value="popular">Most popular</option>
              <option value="recent">Newest</option>
              {pos && <option value="nearby">Nearest</option>}
            </select>
          )}
          {pos ? (
            <select aria-label="Radius" value={radius} onChange={(e) => setRadius(e.target.value)} style={{ width: 'auto' }}>
              <option value="">Any distance from me</option>
              {[10, 25, 50, 100].map((r) => (
                <option key={r} value={r}>
                  Within {r} km
                </option>
              ))}
            </select>
          ) : (
            <button type="button" className="btn small" onClick={locate}>
              📍 Near me
            </button>
          )}
        </div>
        {locError && <p className="field-error">{locError}</p>}
      </div>

      <div className="stack" style={{ marginTop: 16 }}>
        {showMap && <MapView markers={markers} tall label={`Map of ${tab}`} />}
        <Loaded state={state}>
          {() =>
            items.length ? (
              <>
                <p className="muted small" style={{ margin: 0 }}>
                  {state.data.total} {tab}
                </p>
                <div className="grid-cards">
                  {tab === 'routes' && items.map((r) => <RouteCard key={r.id} route={r} />)}
                  {tab === 'activities' && items.map((a) => <ActivityCard key={a.id} activity={a} />)}
                  {tab === 'events' && items.map((e) => <EventCard key={e.id} event={e} />)}
                </div>
              </>
            ) : (
              <Empty>
                Nothing matches these filters.
                {tab === 'routes' && (
                  <>
                    {' '}
                    <Link to="/routes/new">Upload the first route</Link>
                  </>
                )}
              </Empty>
            )
          }
        </Loaded>
      </div>
    </>
  );
}
