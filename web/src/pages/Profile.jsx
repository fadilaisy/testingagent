import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api.js';
import { RouteCard } from '../components/cards.jsx';
import { LocationPicker } from '../components/LocationPicker.jsx';
import { ReportButton } from '../components/ReportButton.jsx';
import { ActGlyph, ActivityMultiSelect, Avatar, Empty, ErrorBox, Field, Loaded } from '../components/ui.jsx';
import { km } from '../format.js';
import { useLoad, useSession } from '../session.jsx';
import { PremiumCard } from './Communities.jsx';

export function Profile() {
  const { id } = useParams();
  const { user: me, meta } = useSession();
  const state = useLoad(() => api.get(`/users/${id}`), [id]);
  const isMe = me?.id === Number(id);

  return (
    <Loaded state={state}>
      {(d) => {
        const u = d.user;
        const labels = Object.fromEntries(meta.activityTypes.map((a) => [a.key, a.label]));
        return (
          <>
            <div className="card">
              <div className="spread">
                <div className="row" style={{ gap: 16 }}>
                  <Avatar name={u.name} size="lg" />
                  <div>
                    <h1 style={{ margin: 0 }}>{u.name}</h1>
                    {!u.private && (
                      <>
                        {u.bio && <p style={{ margin: '2px 0' }}>{u.bio}</p>}
                        <p className="muted small" style={{ margin: 0 }}>
                          {u.locationName}
                          {u.experience ? ` · ${u.experience[0].toUpperCase()}${u.experience.slice(1)}` : ''}
                        </p>
                      </>
                    )}
                    {u.private && <p className="muted small">🔒 This profile is private.</p>}
                  </div>
                </div>
                <div className="row">
                  {isMe ? (
                    <>
                      <Link className="btn small" to="/settings">
                        Edit profile
                      </Link>
                      {me.isAdmin && (
                        <Link className="btn small" to="/admin">
                          Admin
                        </Link>
                      )}
                    </>
                  ) : (
                    <ReportButton targetType="user" targetId={u.id} />
                  )}
                </div>
              </div>
              {!u.private && u.activities?.length > 0 && (
                <div className="row" style={{ marginTop: 12 }}>
                  {u.activities.map((a) => (
                    <span key={a} className="pill brand">
                      <ActGlyph type={a} /> {labels[a]}
                    </span>
                  ))}
                </div>
              )}
              {d.stats && (
                <div className="stats" style={{ marginTop: 16 }}>
                  <div className="stat">
                    <div className="v">{d.stats.activities}</div>
                    <div className="l">Activities</div>
                  </div>
                  <div className="stat">
                    <div className="v">{d.stats.routes}</div>
                    <div className="l">Routes</div>
                  </div>
                  <div className="stat">
                    <div className="v">{d.stats.communities}</div>
                    <div className="l">Communities</div>
                  </div>
                  <div className="stat">
                    <div className="v">{km(d.stats.totalDistanceM, 0)}</div>
                    <div className="l">Total distance</div>
                  </div>
                </div>
              )}
            </div>

            {!u.private && (
              <div className="grid-2" style={{ marginTop: 16 }}>
                <div className="stack">
                  <div className="card">
                    <h2>Activity history</h2>
                    {d.history.length ? (
                      <table className="table">
                        <thead>
                          <tr>
                            <th>Date</th>
                            <th>Activity</th>
                            <th style={{ textAlign: 'right' }}>Distance</th>
                          </tr>
                        </thead>
                        <tbody>
                          {d.history.map((h) => (
                            <tr key={h.id}>
                              <td className="nowrap">{new Date(h.date).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}</td>
                              <td>
                                <Link to={`/activities/${h.id}`}>
                                  <ActGlyph type={h.activityType} /> {h.title}
                                </Link>
                              </td>
                              <td style={{ textAlign: 'right' }} className="nowrap">
                                {km(h.distanceM, 0)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    ) : (
                      <p className="muted" style={{ margin: 0 }}>
                        Activities show up here after checking in.
                      </p>
                    )}
                  </div>
                  <div>
                    <h2>Routes</h2>
                    {d.routes.length ? (
                      <div className="grid-cards">
                        {d.routes.map((r) => (
                          <RouteCard key={r.id} route={r} />
                        ))}
                      </div>
                    ) : (
                      <Empty>No public routes yet.</Empty>
                    )}
                  </div>
                </div>
                <div className="card">
                  <h2>Communities</h2>
                  {d.communities.length ? (
                    <div className="list">
                      {d.communities.map((c) => (
                        <Link key={c.id} to={`/communities/${c.id}`}>
                          <ActGlyph type={c.activityType} /> {c.name}
                        </Link>
                      ))}
                    </div>
                  ) : (
                    <p className="muted" style={{ margin: 0 }}>
                      Not in any public communities yet.
                    </p>
                  )}
                </div>
              </div>
            )}
          </>
        );
      }}
    </Loaded>
  );
}

export function Settings() {
  const { user, setUser, meta } = useSession();
  const navigate = useNavigate();
  const [form, setForm] = useState({
    name: user.name,
    bio: user.bio ?? '',
    experience: user.experience,
    privacy: user.privacy,
    emergencyName: user.emergencyName ?? '',
    emergencyPhone: user.emergencyPhone ?? '',
  });
  const [activities, setActivities] = useState(user.activities);
  const [location, setLocation] = useState(user.lat != null ? { locationName: user.locationName, lat: user.lat, lng: user.lng } : null);
  const [notify, setNotify] = useState(user.notifySettings);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState(null);
  const update = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  async function save(e) {
    e.preventDefault();
    setError(null);
    setSaved(false);
    try {
      const { user: updated } = await api.patch('/me', { ...form, activities, ...(location ?? {}), notifySettings: notify });
      setUser(updated);
      setSaved(true);
    } catch (err) {
      setError(err);
    }
  }

  async function cancelPremium() {
    if (!window.confirm('End your premium plan? Your communities keep working with free limits.')) return;
    const { user: updated } = await api.del('/me/premium');
    setUser(updated);
  }

  async function logout() {
    await api.post('/auth/logout');
    setUser(null);
    navigate('/');
  }

  return (
    <div style={{ maxWidth: 720, margin: '0 auto' }} className="stack">
      <h1>Settings</h1>
      <form className="stack" onSubmit={save}>
        <div className="card stack">
          <h2 style={{ margin: 0 }}>Profile</h2>
          <Field label="Name" error={error?.field === 'Name' && error.message}>
            <input type="text" required maxLength={60} value={form.name} onChange={update('name')} />
          </Field>
          <Field label="Bio">
            <input type="text" maxLength={280} value={form.bio} onChange={update('bio')} placeholder="Weekend cyclist" />
          </Field>
          <div className="field">
            <span>Activities</span>
            <ActivityMultiSelect value={activities} onChange={setActivities} />
          </div>
          <div className="form-row">
            <Field label="Experience">
              <select value={form.experience} onChange={update('experience')}>
                <option value="beginner">Beginner</option>
                <option value="intermediate">Intermediate</option>
                <option value="advanced">Advanced</option>
              </select>
            </Field>
            <Field label="Profile visibility">
              <select value={form.privacy} onChange={update('privacy')}>
                <option value="public">Public</option>
                <option value="private">Private: only your name is visible</option>
              </select>
            </Field>
          </div>
          <div className="field">
            <span>Home area</span>
            <LocationPicker value={location} onChange={setLocation} />
          </div>
        </div>

        <div className="card stack">
          <h2 style={{ margin: 0 }}>Emergency contact</h2>
          <p className="small muted" style={{ margin: 0 }}>
            Shown only to you when you press SOS during an activity.
          </p>
          <div className="form-row">
            <Field label="Name">
              <input type="text" maxLength={80} value={form.emergencyName} onChange={update('emergencyName')} />
            </Field>
            <Field label="Phone">
              <input type="tel" maxLength={30} value={form.emergencyPhone} onChange={update('emergencyPhone')} placeholder="+62 812…" />
            </Field>
          </div>
        </div>

        <div className="card stack" id="notifications">
          <h2 style={{ margin: 0 }}>Notifications</h2>
          {Object.entries(meta.notificationTypes).map(([key, label]) => (
            <label key={key} className="check">
              <input type="checkbox" checked={notify[key] !== false} onChange={(e) => setNotify({ ...notify, [key]: e.target.checked })} />
              {label}
            </label>
          ))}
          <Field label="“Near you” means within">
            <select value={notify.nearby_radius_km} onChange={(e) => setNotify({ ...notify, nearby_radius_km: Number(e.target.value) })}>
              {meta.notificationRadii.map((r) => (
                <option key={r} value={r}>
                  {r} km
                </option>
              ))}
            </select>
          </Field>
          <p className="tiny muted" style={{ margin: 0 }}>
            SOS alerts from your group are always delivered. Nearby-event notifications are limited to one a day and three a week.
          </p>
        </div>

        <ErrorBox error={error && !error.field ? error : null} />
        {saved && <div className="alert ok">Saved.</div>}
        <button className="btn primary">Save changes</button>
      </form>

      {user.isPremium ? (
        <div className="card spread">
          <div>
            <h2 style={{ margin: 0 }}>Premium Community Creator</h2>
            <p className="small muted" style={{ margin: 0 }}>
              Active (demo plan).
            </p>
          </div>
          <button type="button" className="btn small" onClick={cancelPremium}>
            End premium
          </button>
        </div>
      ) : (
        <PremiumCard />
      )}

      <button type="button" className="btn" onClick={logout}>
        Log out
      </button>
    </div>
  );
}
