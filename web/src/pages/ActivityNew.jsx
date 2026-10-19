import { useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api, qs } from '../api.js';
import { MapView } from '../components/MapView.jsx';
import { ErrorBox, Field, Loaded } from '../components/ui.jsx';
import { ACTIVITY_EMOJI, duration, km, toLocalInput } from '../format.js';
import { useLoad } from '../session.jsx';

function nextMorning() {
  const d = new Date();
  d.setDate(d.getDate() + (d.getHours() >= 5 ? 1 : 0));
  d.setHours(6, 0, 0, 0);
  return toLocalInput(d);
}

// Activity announcement (PRD §13, Flow A).
export function ActivityNew() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [routeId, setRouteId] = useState(params.get('route') ?? '');
  const [search, setSearch] = useState('');
  const routes = useLoad(() => api.get(`/routes${qs({ q: search, limit: 50, sort: 'popular' })}`), [search]);
  const route = useLoad(() => (routeId ? api.get(`/routes/${routeId}`) : null), [routeId]);
  const [form, setForm] = useState({
    title: '',
    startsAt: nextMorning(),
    meetingPoint: '',
    participantLimit: '',
    pace: '',
    description: '',
    visibility: 'public',
  });
  const [meeting, setMeeting] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const update = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const r = route.data?.route;
  const markers = useMemo(() => {
    if (!r) return [];
    const m = meeting ?? { lat: r.start[0], lng: r.start[1] };
    return [{ ...m, emoji: '📍', title: 'Meeting point' }];
  }, [r, meeting]);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { activity } = await api.post('/activities', {
        routeId: Number(routeId),
        ...form,
        startsAt: new Date(form.startsAt).toISOString(),
        participantLimit: form.participantLimit || undefined,
        meetingLat: meeting?.lat,
        meetingLng: meeting?.lng,
      });
      navigate(`/activities/${activity.id}`);
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  }

  return (
    <div style={{ maxWidth: 760, margin: '0 auto' }}>
      <h1>Plan an activity</h1>
      <p className="muted">Announce when you&apos;re going. Others can join, and everyone who joins gets the group chat.</p>
      <form className="card stack" onSubmit={submit}>
        <Field label="Route" error={error?.field === 'Route' && error.message}>
          {r ? (
            <div className="spread card tight">
              <div>
                <strong>
                  {ACTIVITY_EMOJI[r.activityType]} {r.name}
                </strong>
                <div className="small muted">
                  {km(r.distanceM)} · +{r.elevationGain ?? 0} m · ~{duration(r.estDurationS)}
                </div>
              </div>
              <button type="button" className="btn small" onClick={() => setRouteId('')}>
                Change
              </button>
            </div>
          ) : (
            <div className="stack" style={{ gap: 8 }}>
              <input type="search" placeholder="Search routes" value={search} onChange={(e) => setSearch(e.target.value)} />
              <Loaded state={routes}>
                {(d) => (
                  <select required value={routeId} onChange={(e) => setRouteId(e.target.value)} size={Math.min(8, Math.max(2, d.routes.length))}>
                    {d.routes.map((x) => (
                      <option key={x.id} value={x.id}>
                        {ACTIVITY_EMOJI[x.activityType]} {x.name} · {km(x.distanceM)}
                      </option>
                    ))}
                  </select>
                )}
              </Loaded>
              <span className="small muted">
                Not listed? <Link to="/routes/new">Upload a GPX first</Link>.
              </span>
            </div>
          )}
        </Field>

        {r && (
          <>
            <div className="field">
              <span>
                Meeting point <span className="hint">· tap the map to move the pin (defaults to the route start)</span>
              </span>
              <MapView geometry={r.geometry} markers={markers} onPick={setMeeting} label="Pick the meeting point" />
            </div>
            <Field label="Meeting point description" error={error?.field === 'Meeting point' && error.message}>
              <input type="text" required maxLength={120} value={form.meetingPoint} onChange={update('meetingPoint')} placeholder="Green Office Park, main gate" />
            </Field>
            <Field label="Title" hint="optional">
              <input type="text" maxLength={100} value={form.title} onChange={update('title')} placeholder={`${r.activityLabel} · ${r.name}`} />
            </Field>
            <div className="form-row">
              <Field label="Date & time" error={error?.field === 'Date and time' && error.message}>
                <input type="datetime-local" required value={form.startsAt} onChange={update('startsAt')} />
              </Field>
              <Field label="Participant limit" hint="optional">
                <input type="number" min="2" max="500" value={form.participantLimit} onChange={update('participantLimit')} placeholder="No limit" />
              </Field>
              <Field label="Pace" hint="optional">
                <input type="text" maxLength={40} value={form.pace} onChange={update('pace')} placeholder="25–28 km/h" />
              </Field>
            </div>
            <Field label="Description" hint="optional">
              <textarea maxLength={1000} value={form.description} onChange={update('description')} placeholder="No-drop ride, coffee at the top." />
            </Field>
            <Field label="Who can join">
              <select value={form.visibility} onChange={update('visibility')}>
                <option value="public">Public: anyone can join</option>
                <option value="private">Private: people ask, you approve</option>
              </select>
            </Field>
          </>
        )}
        {error && !error.field && <ErrorBox error={error} />}
        <button className="btn primary" disabled={busy || !r}>
          {busy ? 'Publishing…' : 'Publish activity'}
        </button>
      </form>
    </div>
  );
}
