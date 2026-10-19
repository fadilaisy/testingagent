import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api.js';
import { ActivityCard } from '../components/cards.jsx';
import { ConditionsSummary, ReportConditionButton, ReportList } from '../components/Conditions.jsx';
import { ElevationChart } from '../components/ElevationChart.jsx';
import { MapView } from '../components/MapView.jsx';
import { PlacesPanel } from '../components/PlacesPanel.jsx';
import { ReportButton } from '../components/ReportButton.jsx';
import { ActivityPill, DifficultyPill, Empty, ErrorBox, Loaded } from '../components/ui.jsx';
import { WeatherPanel } from '../components/WeatherPanel.jsx';
import { duration, km } from '../format.js';
import { pointAtKm } from '../geo.js';
import { useLoad, useSession } from '../session.jsx';

const CATEGORY_EMOJI = { road: '🚧', traffic: '🚗', weather: '🌧', trail: '🥾', crowd: '👥' };

export function routeMarkers(geometry, reports = [], places = []) {
  if (!geometry?.length) return [];
  const start = geometry[0];
  const end = geometry.at(-1);
  const out = [
    { lat: start[0], lng: start[1], color: '#1f7a4d', title: 'Start' },
    { lat: end[0], lng: end[1], color: '#c0392b', title: 'Finish' },
  ];
  for (const r of reports) {
    const p = pointAtKm(geometry, r.km);
    if (p) out.push({ lat: p[0], lng: p[1], emoji: CATEGORY_EMOJI[r.category], title: `${r.categoryLabel}: ${r.value.replace('_', ' ')}`, subtitle: `KM ${r.km} · ${r.user.name}` });
  }
  for (const pl of places.slice(0, 8)) out.push({ lat: pl.lat, lng: pl.lng, emoji: pl.emoji, title: pl.name, subtitle: pl.label });
  return out;
}

export function RouteDetail() {
  const { id } = useParams();
  const { user } = useSession();
  const navigate = useNavigate();
  const state = useLoad(() => api.get(`/routes/${id}`), [id]);
  const [places, setPlaces] = useState([]);
  const [error, setError] = useState(null);

  const markers = useMemo(
    () => (state.data ? routeMarkers(state.data.route.geometry, state.data.reports.filter((r) => r.km != null).slice(0, 15), places) : []),
    [state.data, places],
  );

  async function remove() {
    if (!window.confirm('Delete this route? This cannot be undone.')) return;
    try {
      await api.del(`/routes/${id}`);
      navigate('/explore', { replace: true });
    } catch (err) {
      setError(err);
    }
  }

  return (
    <Loaded state={state}>
      {({ route, reports, conditions, activities }) => {
        const going = activities.reduce((s, a) => s + (a.participantCount ?? 0), 0);
        return (
          <>
            <div className="spread" style={{ alignItems: 'flex-start' }}>
              <div>
                <div className="row" style={{ marginBottom: 6 }}>
                  <ActivityPill type={route.activityType} label={route.activityLabel} />
                  <DifficultyPill value={route.difficulty} />
                  {route.visibility === 'unlisted' && <span className="pill">Unlisted</span>}
                </div>
                <h1>{route.name}</h1>
                <p className="muted small" style={{ margin: 0 }}>
                  {route.locationName ? `${route.locationName} · ` : ''}by <Link to={`/users/${route.creator.id}`}>{route.creator.name}</Link>
                  {route.completedCount > 0 && ` · ${route.completedCount} people have done this route`}
                </p>
              </div>
              <div className="row">
                <a className="btn small" href={`/api/routes/${route.id}/gpx`}>
                  ⬇ GPX
                </a>
                {route.isOwner && (
                  <button type="button" className="btn small" onClick={remove}>
                    Delete
                  </button>
                )}
                <ReportButton targetType="route" targetId={route.id} />
              </div>
            </div>
            <ErrorBox error={error} />

            <div className="stats" style={{ margin: '16px 0' }}>
              <div className="stat">
                <div className="v">{km(route.distanceM)}</div>
                <div className="l">Distance</div>
              </div>
              <div className="stat">
                <div className="v">{route.elevationGain != null ? `+${route.elevationGain} m` : '–'}</div>
                <div className="l">Elevation gain</div>
              </div>
              <div className="stat">
                <div className="v">{route.elevationLoss != null ? `−${route.elevationLoss} m` : '–'}</div>
                <div className="l">Elevation loss</div>
              </div>
              <div className="stat">
                <div className="v">{route.maxElevation != null ? `${route.maxElevation} m` : '–'}</div>
                <div className="l">Highest point</div>
              </div>
              <div className="stat">
                <div className="v">{duration(route.estDurationS)}</div>
                <div className="l">Estimated time</div>
              </div>
            </div>

            <div className="grid-2">
              <div className="stack">
                <MapView geometry={route.geometry} markers={markers} label="Route map" />
                <div className="card">
                  <h2>Elevation profile</h2>
                  <ElevationChart geometry={route.geometry} />
                </div>
                {route.description && (
                  <div className="card">
                    <h2>About this route</h2>
                    <p style={{ whiteSpace: 'pre-line', margin: 0 }}>{route.description}</p>
                  </div>
                )}
                <div className="card">
                  <h2>☕ Where to finish</h2>
                  <PlacesPanel routeId={route.id} onPlaces={setPlaces} />
                </div>
              </div>

              <div className="stack">
                <div className="card">
                  <div className="spread" style={{ marginBottom: 8 }}>
                    <h2 style={{ margin: 0 }}>Current conditions</h2>
                    {user && <ReportConditionButton routeId={route.id} maxKm={Math.ceil(route.distanceM / 1000)} onReported={state.reload} label="📣 Report" />}
                  </div>
                  <ConditionsSummary conditions={conditions} />
                  {reports.length > 0 && (
                    <details style={{ marginTop: 10 }}>
                      <summary className="small muted">All reports from the last 7 days ({reports.length})</summary>
                      <ReportList reports={reports} />
                    </details>
                  )}
                </div>

                <div className="card">
                  <h2>Weather</h2>
                  <WeatherPanel routeId={route.id} />
                </div>

                <div className="card">
                  <div className="spread" style={{ marginBottom: 8 }}>
                    <h2 style={{ margin: 0 }}>Who&apos;s going</h2>
                    <Link className="btn small primary" to={`/activities/new?route=${route.id}`}>
                      + Plan an activity
                    </Link>
                  </div>
                  {activities.length ? (
                    <>
                      <p className="muted small">
                        {going} {going === 1 ? 'person is' : 'people are'} planning to do this route soon.
                      </p>
                      <div className="stack">
                        {activities.map((a) => (
                          <ActivityCard key={a.id} activity={a} />
                        ))}
                      </div>
                    </>
                  ) : (
                    <Empty>Nobody has announced a plan yet. Be the first and others can join you.</Empty>
                  )}
                </div>
              </div>
            </div>
          </>
        );
      }}
    </Loaded>
  );
}
