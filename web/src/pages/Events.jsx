import { useMemo, useState } from 'react';
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api, qs } from '../api.js';
import { MapView } from '../components/MapView.jsx';
import { ReportButton } from '../components/ReportButton.jsx';
import { ActivityPill, Avatar, DifficultyPill, Empty, ErrorBox, Field, Loaded, SignInPrompt, Spinner } from '../components/ui.jsx';
import { WeatherPanel } from '../components/WeatherPanel.jsx';
import { ACTIVITY_EMOJI, km, longDate, time, toLocalInput } from '../format.js';
import { useLoad, useSession } from '../session.jsx';
import { PremiumCard } from './Communities.jsx';

export function EventDetail() {
  const { id } = useParams();
  const { user } = useSession();
  const location = useLocation();
  const state = useLoad(() => api.get(`/events/${id}`), [id]);
  const [error, setError] = useState(null);
  const created = location.state?.created;

  const markers = useMemo(() => {
    if (!state.data) return [];
    const e = state.data.event;
    return [{ lat: e.location[0], lng: e.location[1], emoji: '📍', title: 'Meeting point', subtitle: e.meetingPoint }];
  }, [state.data]);

  async function act(path) {
    setError(null);
    try {
      await api.post(`/events/${id}${path}`);
      state.reload();
    } catch (err) {
      setError(err);
    }
  }

  return (
    <Loaded state={state}>
      {({ event: e, route, participants }) => {
        const full = e.maxParticipants && e.participantCount >= e.maxParticipants;
        const past = new Date(e.startsAt).getTime() < Date.now();
        return (
          <>
            {created && (
              <div className="alert ok" style={{ marginBottom: 12 }}>
                Event published. {created.notifiedMembers} community {created.notifiedMembers === 1 ? 'member' : 'members'} notified
                {e.notificationRadiusKm
                  ? `, plus ${created.notifiedNearby} ${created.notifiedNearby === 1 ? 'person' : 'people'} within ${e.notificationRadiusKm} km`
                  : ''}
                .
              </div>
            )}
            {e.coverUrl && <img src={e.coverUrl} alt="" style={{ borderRadius: 14, maxHeight: 280, width: '100%', objectFit: 'cover' }} />}
            <div className="spread" style={{ alignItems: 'flex-start', marginTop: 8 }}>
              <div>
                <div className="row" style={{ marginBottom: 6 }}>
                  <ActivityPill type={e.activityType} label={e.activityLabel} />
                  <DifficultyPill value={e.difficulty} />
                </div>
                <h1>{e.title}</h1>
                <p className="strong" style={{ color: 'var(--brand)', margin: 0 }}>
                  {longDate(e.startsAt)}
                  {e.endsAt ? ` – ${time(e.endsAt)}` : ''}
                </p>
                <p className="muted small" style={{ margin: 0 }}>
                  Organized by <Link to={`/communities/${e.community.id}`}>{e.community.name}</Link>
                </p>
              </div>
              <ReportButton targetType="event" targetId={e.id} />
            </div>

            <div className="grid-2" style={{ marginTop: 16 }}>
              <div className="stack">
                <div className="card stack">
                  <div>
                    <div className="small muted">Meeting point</div>
                    <div className="strong">📍 {e.meetingPoint}</div>
                  </div>
                  <div className="row">
                    {route && (
                      <span>
                        🗺 <Link to={`/routes/${route.id}`}>{route.name}</Link> · {km(route.distanceM)}
                      </span>
                    )}
                    {e.pace && <span>⏱ {e.pace}</span>}
                    <span>
                      🎟 {e.participantCount}
                      {e.maxParticipants ? ` / ${e.maxParticipants}` : ''} registered
                    </span>
                  </div>
                  {e.description && <p style={{ whiteSpace: 'pre-line', margin: 0 }}>{e.description}</p>}
                  <ErrorBox error={error} />
                  {!user && !past && <SignInPrompt>to register</SignInPrompt>}
                  {user && !past && !e.registered && (
                    <button type="button" className="btn primary block" disabled={full} onClick={() => act('/register')}>
                      {full ? 'Event is full' : 'Register'}
                    </button>
                  )}
                  {user && e.registered && (
                    <div className="spread">
                      <span className="pill brand">✓ You&apos;re registered</span>
                      {!past && (
                        <button type="button" className="btn small" onClick={() => act('/unregister')}>
                          Cancel registration
                        </button>
                      )}
                    </div>
                  )}
                </div>
                <MapView geometry={route?.geometry} markers={markers} label="Event map" />
                {route && (
                  <div className="card">
                    <h2>Weather for this event</h2>
                    <WeatherPanel routeId={route.id} startsAt={e.startsAt} />
                  </div>
                )}
              </div>
              <div className="stack">
                <div className="card">
                  <h2>Who&apos;s coming</h2>
                  {participants.length ? (
                    <div className="list">
                      {participants.map((p) => (
                        <Link key={p.id} to={`/users/${p.id}`} className="row">
                          <Avatar name={p.name} /> {p.name}
                        </Link>
                      ))}
                    </div>
                  ) : (
                    <p className="muted" style={{ margin: 0 }}>
                      Be the first to register.
                    </p>
                  )}
                </div>
                {e.canManage && e.notificationRadiusKm && (
                  <div className="card">
                    <h2>Reach</h2>
                    <p className="muted" style={{ margin: 0 }}>
                      {e.notifiedCount} nearby people were notified within {e.notificationRadiusKm} km.
                    </p>
                  </div>
                )}
              </div>
            </div>
          </>
        );
      }}
    </Loaded>
  );
}

// Community event creation (PRD §22-23, Flow E).
export function EventNew() {
  const { user, meta } = useSession();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const mine = useLoad(() => api.get('/communities?mine=1&limit=100'), []);
  const [communityId, setCommunityId] = useState(params.get('community') ?? '');
  const routes = useLoad(() => api.get(`/routes${qs({ limit: 100, sort: 'recent' })}`), []);
  const [routeId, setRouteId] = useState('');
  const route = useLoad(() => (routeId ? api.get(`/routes/${routeId}`) : null), [routeId]);
  const [pin, setPin] = useState(null);
  const [form, setForm] = useState(() => {
    const d = new Date(Date.now() + 7 * 864e5);
    d.setHours(5, 30, 0, 0);
    return { title: '', description: '', coverUrl: '', startsAt: toLocalInput(d), endsAt: '', meetingPoint: '', maxParticipants: '', difficulty: '', pace: '', notificationRadiusKm: '' };
  });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const update = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const adminOf = (mine.data?.communities ?? []).filter((c) => c.myRole === 'admin');
  const community = adminOf.find((c) => String(c.id) === String(communityId));
  const r = route.data?.route;
  const location = pin ?? (r ? { lat: r.start[0], lng: r.start[1] } : community?.location ? { lat: community.location[0], lng: community.location[1] } : null);
  const markers = useMemo(() => (location ? [{ ...location, emoji: '📍', title: 'Meeting point' }] : []), [location?.lat, location?.lng]); // eslint-disable-line react-hooks/exhaustive-deps

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await api.post('/events', {
        ...form,
        communityId: Number(communityId),
        routeId: routeId ? Number(routeId) : undefined,
        lat: location?.lat,
        lng: location?.lng,
        startsAt: new Date(form.startsAt).toISOString(),
        endsAt: form.endsAt ? new Date(form.endsAt).toISOString() : undefined,
        maxParticipants: form.maxParticipants || undefined,
        difficulty: form.difficulty || undefined,
        notificationRadiusKm: form.notificationRadiusKm || undefined,
      });
      navigate(`/events/${res.event.id}`, { state: { created: res } });
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  }

  if (mine.loading) return <Spinner />;
  if (!adminOf.length) {
    return (
      <div style={{ maxWidth: 680, margin: '0 auto' }} className="stack">
        <h1>Create an event</h1>
        <Empty>
          Events are run by communities. You aren&apos;t an admin of any community yet.{' '}
          <Link to="/communities/new">Create a community</Link> or ask an admin of your club to make you one.
        </Empty>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 760, margin: '0 auto' }} className="stack">
      <h1>Create an event</h1>
      {error?.premiumRequired && !user.isPremium && <PremiumCard onUpgraded={() => setError(null)} />}
      <form className="card stack" onSubmit={submit}>
        <Field label="Community">
          <select required value={communityId} onChange={(e) => setCommunityId(e.target.value)}>
            <option value="">Choose a community</option>
            {adminOf.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Title">
          <input type="text" required maxLength={100} value={form.title} onChange={update('title')} placeholder="Sunday Sunrise Ride" />
        </Field>
        <Field label="Route" hint="optional, adds map, distance and weather">
          <select value={routeId} onChange={(e) => setRouteId(e.target.value)}>
            <option value="">No route</option>
            {(routes.data?.routes ?? []).map((x) => (
              <option key={x.id} value={x.id}>
                {ACTIVITY_EMOJI[x.activityType]} {x.name} · {km(x.distanceM)}
              </option>
            ))}
          </select>
        </Field>
        <div className="field">
          <span>
            Meeting location <span className="hint">· tap the map to place the pin</span>
          </span>
          <MapView geometry={r?.geometry} markers={markers} onPick={setPin} center={location ? [location.lat, location.lng] : undefined} label="Pick the meeting location" />
          {error?.field === 'Location' && <span className="field-error">{error.message}</span>}
        </div>
        <Field label="Meeting point description">
          <input type="text" required maxLength={120} value={form.meetingPoint} onChange={update('meetingPoint')} placeholder="Sentul City roundabout" />
        </Field>
        <div className="form-row">
          <Field label="Starts" error={error?.field === 'Start time' && error.message}>
            <input type="datetime-local" required value={form.startsAt} onChange={update('startsAt')} />
          </Field>
          <Field label="Ends" hint="optional" error={error?.field === 'End time' && error.message}>
            <input type="datetime-local" value={form.endsAt} onChange={update('endsAt')} />
          </Field>
        </div>
        <div className="form-row">
          <Field label="Max participants" hint="optional">
            <input type="number" min="2" value={form.maxParticipants} onChange={update('maxParticipants')} />
          </Field>
          <Field label="Difficulty">
            <select value={form.difficulty} onChange={update('difficulty')}>
              <option value="">{r ? 'Same as route' : 'Not set'}</option>
              {meta.difficulties.map((d) => (
                <option key={d} value={d}>
                  {d[0].toUpperCase() + d.slice(1)}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Pace" hint="optional">
            <input type="text" maxLength={40} value={form.pace} onChange={update('pace')} placeholder="25 km/h" />
          </Field>
        </div>
        <Field label="Description">
          <textarea maxLength={3000} value={form.description} onChange={update('description')} />
        </Field>
        <Field label="Cover photo URL" hint="optional">
          <input type="url" maxLength={500} value={form.coverUrl} onChange={update('coverUrl')} placeholder="https://…" />
        </Field>
        <Field label="Notify people nearby" hint="premium · only people who like this activity, max 1 per day">
          <select value={form.notificationRadiusKm} onChange={update('notificationRadiusKm')}>
            <option value="">Don&apos;t notify nearby people</option>
            {meta.notificationRadii.map((r2) => (
              <option key={r2} value={r2}>
                Within {r2} km
              </option>
            ))}
          </select>
        </Field>
        {error && !error.field && <ErrorBox error={error} />}
        <button className="btn primary" disabled={busy}>
          {busy ? 'Publishing…' : 'Publish event'}
        </button>
      </form>
    </div>
  );
}
