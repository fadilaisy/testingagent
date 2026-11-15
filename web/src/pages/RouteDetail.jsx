import { Download, Plus } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api.js';
import { ActivityCard } from '../components/cards.jsx';
import { ConditionsSummary, ReportConditionButton, ReportList } from '../components/Conditions.jsx';
import { ElevationChart } from '../components/ElevationChart.jsx';
import { MapView } from '../components/MapView.jsx';
import { PlacesPanel } from '../components/PlacesPanel.jsx';
import { ReportButton } from '../components/ReportButton.jsx';
import { CONDITION_ICON, placeIcon } from '../components/icons.jsx';
import { ActivityPill, DifficultyPill, ErrorBox, Loaded, SkeletonDetail } from '../components/ui.jsx';
import { WeatherPanel } from '../components/WeatherPanel.jsx';
import { duration, km } from '../format.js';
import { pointAtKm } from '../geo.js';
import { useLoad, useSession } from '../session.jsx';

export function routeMarkers(geometry, reports = [], places = []) {
  if (!geometry?.length) return [];
  const start = geometry[0];
  const end = geometry.at(-1);
  const out = [
    { lat: start[0], lng: start[1], color: '#14402b', title: 'Start' },
    { lat: end[0], lng: end[1], color: '#d2432f', title: 'Finish' },
  ];
  for (const r of reports) {
    const p = pointAtKm(geometry, r.km);
    if (p) out.push({ lat: p[0], lng: p[1], icon: CONDITION_ICON[r.category], color: ['#157a41', '#8a5f00', '#a92f1d'][r.severity], title: `${r.categoryLabel}: ${r.value.replace('_', ' ')}`, subtitle: `KM ${r.km} · ${r.user.name}` });
  }
  for (const pl of places.slice(0, 8)) out.push({ lat: pl.lat, lng: pl.lng, icon: placeIcon(pl.category), color: '#5a6a62', title: pl.name, subtitle: pl.label });
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
    <Loaded state={state} skeleton={<SkeletonDetail />}>
      {({ route, reports, conditions, activities }) => {
        const going = activities.reduce((s, a) => s + (a.participantCount ?? 0), 0);
        return (
          <>
            <div className="spread page-head">
              <div>
                <div className="row eyebrow">
                  <ActivityPill type={route.activityType} label={route.activityLabel} />
                  <DifficultyPill value={route.difficulty} />
                  {route.visibility === 'unlisted' && <span className="pill">Unlisted</span>}
                </div>
                <h1>{route.name}</h1>
                <p className="muted small" style={{ margin: 0 }}>
                  {route.locationName ? `${route.locationName} · ` : ''}by <Link to={`/users/${route.creator.id}`}>{route.creator.name}</Link>
                  {route.completedCount > 0 && ` · done by ${route.completedCount} ${route.completedCount === 1 ? 'person' : 'people'}`}
                </p>
              </div>
              <div className="row">
                <a className="btn small" href={`/api/routes/${route.id}/gpx`}>
                  <Download size={16} aria-hidden="true" /> GPX
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

            <div className="stats">
              <div className="stat">
                <div className="v">{km(route.distanceM)}</div>
                <div className="l">Distance</div>
              </div>
              <div className="stat">
                <div className="v">{route.elevationGain != null ? `+${route.elevationGain} m` : '–'}</div>
                <div className="l">Climbing</div>
              </div>
              <div className="stat">
                <div className="v">{route.elevationLoss != null ? `−${route.elevationLoss} m` : '–'}</div>
                <div className="l">Descent</div>
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
                  <h2>Coffee and food at the finish</h2>
                  <PlacesPanel routeId={route.id} onPlaces={setPlaces} />
                </div>
              </div>

              <div className="stack">
                <div className="card">
                  <div className="spread card-head">
                    <h2>Track conditions, last 24 hours</h2>
                    {user && <ReportConditionButton routeId={route.id} maxKm={Math.ceil(route.distanceM / 1000)} onReported={state.reload} label="Report" />}
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
                  <h2>Weather along the route now</h2>
                  <WeatherPanel routeId={route.id} />
                </div>

                <div className="card">
                  <h2 className="num">
                    {activities.length ? `${going} ${going === 1 ? 'person is' : 'people are'} planning this route` : 'Nobody is planning this route yet'}
                  </h2>
                  <Link className="btn primary block card-cta" to={`/activities/new?route=${route.id}`}>
                    <Plus size={20} aria-hidden="true" /> Plan an activity here
                  </Link>
                  {activities.length ? (
                    <>
                      <div className="stack">
                        {activities.map((a) => (
                          <ActivityCard key={a.id} activity={a} />
                        ))}
                      </div>
                    </>
                  ) : (
                    <p className="muted small" style={{ margin: 0 }}>
                      Announce a plan and others can join you.
                    </p>
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
