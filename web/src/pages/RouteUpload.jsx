import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { ElevationChart } from '../components/ElevationChart.jsx';
import { MapView } from '../components/MapView.jsx';
import { ErrorBox, Field } from '../components/ui.jsx';
import { ACTIVITY_EMOJI, km } from '../format.js';
import { useSession } from '../session.jsx';

// GPX upload & route creation (PRD §10, FR-03..06).
export function RouteUpload() {
  const { meta, user } = useSession();
  const navigate = useNavigate();
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [form, setForm] = useState({
    name: '',
    activityType: user.activities?.[0] ?? 'road_cycling',
    difficulty: '',
    description: '',
    locationName: '',
    privacyTrim: '0',
    visibility: 'public',
  });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const update = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  async function choose(e) {
    const f = e.target.files?.[0];
    setFile(f ?? null);
    setPreview(null);
    setError(null);
    if (!f) return;
    const body = new FormData();
    body.set('gpx', f);
    try {
      const p = await api.post('/routes/preview', body);
      setPreview(p);
      setForm((s) => ({ ...s, name: s.name || p.name || f.name.replace(/\.gpx$/i, '') }));
    } catch (err) {
      setError(err);
    }
  }

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const body = new FormData();
    body.set('gpx', file);
    for (const [k, v] of Object.entries(form)) if (v !== '') body.set(k, v);
    try {
      const { route } = await api.post('/routes', body);
      navigate(`/routes/${route.id}`);
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  }

  return (
    <div style={{ maxWidth: 760, margin: '0 auto' }}>
      <h1>Upload a GPX route</h1>
      <p className="muted">Export a .gpx from Strava, Komoot, Garmin or any GPS app. We read the distance, climbing and profile, and build a route page others can plan around.</p>
      <form className="card stack" onSubmit={submit}>
        <Field label="GPX file" error={error?.field === 'GPX file' && error.message}>
          <input type="file" accept=".gpx,application/gpx+xml" onChange={choose} required />
        </Field>

        {preview && (
          <div className="stack">
            <div className="stats">
              <div className="stat">
                <div className="v">{km(preview.stats.distanceM)}</div>
                <div className="l">Distance</div>
              </div>
              <div className="stat">
                <div className="v">{preview.stats.elevationGain != null ? `+${preview.stats.elevationGain} m` : '–'}</div>
                <div className="l">Climbing</div>
              </div>
              <div className="stat">
                <div className="v">{preview.stats.maxElevation != null ? `${preview.stats.maxElevation} m` : '–'}</div>
                <div className="l">Highest</div>
              </div>
            </div>
            <MapView geometry={preview.geometry} label="Route preview" />
            <ElevationChart geometry={preview.geometry} />
          </div>
        )}

        <Field label="Route name" error={error?.field === 'Route name' && error.message}>
          <input type="text" required maxLength={100} value={form.name} onChange={update('name')} placeholder="BSD → Puncak" />
        </Field>
        <div className="form-row">
          <Field label="Activity">
            <select value={form.activityType} onChange={update('activityType')}>
              {meta.activityTypes.map((a) => (
                <option key={a.key} value={a.key}>
                  {ACTIVITY_EMOJI[a.key]} {a.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Difficulty">
            <select value={form.difficulty} onChange={update('difficulty')}>
              <option value="">Estimate for me</option>
              {meta.difficulties.map((d) => (
                <option key={d} value={d}>
                  {d[0].toUpperCase() + d.slice(1)}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Area" hint="optional">
            <input type="text" maxLength={80} value={form.locationName} onChange={update('locationName')} placeholder="Sentul, Bogor" />
          </Field>
        </div>
        <Field label="Description" hint="optional">
          <textarea maxLength={2000} value={form.description} onChange={update('description')} placeholder="Where to park, tricky sections, best time to go…" />
        </Field>
        <div className="form-row">
          <Field label="Privacy zone" hint="hides where the track starts and ends">
            <select value={form.privacyTrim} onChange={update('privacyTrim')}>
              <option value="0">Show the whole track</option>
              <option value="200">Hide first & last 200 m</option>
              <option value="500">Hide first & last 500 m</option>
            </select>
          </Field>
          <Field label="Visibility">
            <select value={form.visibility} onChange={update('visibility')}>
              <option value="public">Public: listed in Explore</option>
              <option value="unlisted">Unlisted: only people with the link</option>
            </select>
          </Field>
        </div>
        {error && !error.field && <ErrorBox error={error} />}
        <button className="btn primary" disabled={busy || !file || !preview}>
          {busy ? 'Publishing…' : 'Publish route'}
        </button>
      </form>
    </div>
  );
}
