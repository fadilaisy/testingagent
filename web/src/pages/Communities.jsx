import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, qs } from '../api.js';
import { CommunityCard, EventCard } from '../components/cards.jsx';
import { LocationPicker } from '../components/LocationPicker.jsx';
import { ReportButton } from '../components/ReportButton.jsx';
import { ActivityChips, ActivityPill, Avatar, Empty, ErrorBox, Field, Loaded, Modal, SignInPrompt } from '../components/ui.jsx';
import { ACTIVITY_EMOJI } from '../format.js';
import { useLoad, useSession } from '../session.jsx';

export function PremiumCard({ onUpgraded }) {
  const { setUser } = useSession();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  async function upgrade() {
    setBusy(true);
    setError(null);
    try {
      const { user } = await api.post('/me/premium');
      setUser(user);
      onUpgraded?.();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="card premium-card stack">
      <h2 style={{ margin: 0 }}>Premium Community Creator</h2>
      <p style={{ margin: 0 }}>
        Create communities, run unlimited events, send announcements and notify riders and runners near your events.
      </p>
      <p className="muted small" style={{ margin: 0 }}>
        Planned price Rp49.000–99.000 / month. Payments aren&apos;t connected yet, so this demo grants 30 days free.
      </p>
      <ErrorBox error={error} />
      <button type="button" className="btn" onClick={upgrade} disabled={busy} style={{ alignSelf: 'flex-start' }}>
        {busy ? 'Activating…' : 'Start 30-day premium (demo)'}
      </button>
    </div>
  );
}

export function CommunityList() {
  const { user } = useSession();
  const [activity, setActivity] = useState('');
  const [q, setQ] = useState('');
  const [mine, setMine] = useState(false);
  const state = useLoad(() => api.get(`/communities${qs({ activity, q, mine: mine ? 1 : '' })}`), [activity, q, mine]);
  return (
    <>
      <div className="spread">
        <h1 style={{ margin: 0 }}>Communities</h1>
        {user && (
          <Link className="btn small primary" to="/communities/new">
            + Create community
          </Link>
        )}
      </div>
      <div className="stack" style={{ margin: '12px 0' }}>
        <ActivityChips value={activity} onChange={setActivity} />
        <div className="row">
          <input type="search" aria-label="Search communities" placeholder="Search communities" value={q} onChange={(e) => setQ(e.target.value)} style={{ maxWidth: 260 }} />
          {user && (
            <label className="check">
              <input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} /> Only mine
            </label>
          )}
        </div>
      </div>
      <Loaded state={state}>
        {(d) =>
          d.communities.length ? (
            <div className="grid-cards">
              {d.communities.map((c) => (
                <CommunityCard key={c.id} community={c} />
              ))}
            </div>
          ) : (
            <Empty>No communities match.</Empty>
          )
        }
      </Loaded>
    </>
  );
}

function Announce({ communityId }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ title: '', body: '' });
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  async function submit(e) {
    e.preventDefault();
    setError(null);
    try {
      setResult(await api.post(`/communities/${communityId}/announcements`, form));
    } catch (err) {
      setError(err);
    }
  }
  return (
    <>
      <button type="button" className="btn small" onClick={() => setOpen(true)}>
        📢 Announcement
      </button>
      {open && (
        <Modal title="Send an announcement" onClose={() => setOpen(false)}>
          {result ? (
            <div className="alert ok">Sent to {result.sent} members.</div>
          ) : (
            <form className="stack" onSubmit={submit}>
              <Field label="Title">
                <input type="text" required maxLength={100} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
              </Field>
              <Field label="Message">
                <textarea maxLength={500} value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} />
              </Field>
              <ErrorBox error={error} />
              <button className="btn primary">Send to all members</button>
            </form>
          )}
        </Modal>
      )}
    </>
  );
}

export function CommunityDetail() {
  const { id } = useParams();
  const { user } = useSession();
  const state = useLoad(() => api.get(`/communities/${id}`), [id]);
  const [error, setError] = useState(null);

  async function act(path) {
    setError(null);
    try {
      await api.post(`/communities/${id}${path}`);
      state.reload();
    } catch (err) {
      setError(err);
    }
  }

  return (
    <Loaded state={state}>
      {({ community: c, events, pastEvents, members, requests }) => {
        const isMember = c.myStatus === 'member';
        const canSeeInside = c.privacy === 'public' || isMember;
        return (
          <>
            <div className="spread" style={{ alignItems: 'flex-start' }}>
              <div>
                <div className="row" style={{ marginBottom: 6 }}>
                  <ActivityPill type={c.activityType} label={c.activityLabel} />
                  {c.privacy === 'private' && <span className="pill">🔒 Private</span>}
                </div>
                <h1>{c.name}</h1>
                <p className="muted" style={{ margin: 0 }}>
                  👥 {c.memberCount.toLocaleString()} members{c.locationName ? ` · ${c.locationName}` : ''}
                </p>
              </div>
              <div className="row">
                {!user && <SignInPrompt />}
                {user && !c.myStatus && (
                  <button type="button" className="btn primary" onClick={() => act('/join')}>
                    {c.privacy === 'private' ? 'Request to join' : 'Join community'}
                  </button>
                )}
                {c.myStatus === 'requested' && <span className="pill">Request pending</span>}
                {isMember && !c.isOwner && (
                  <button type="button" className="btn small" onClick={() => act('/leave')}>
                    Leave
                  </button>
                )}
                {c.isAdmin && (
                  <>
                    <Link className="btn small primary" to={`/events/new?community=${c.id}`}>
                      + Event
                    </Link>
                    {c.premiumFeatures && <Announce communityId={c.id} />}
                  </>
                )}
                <ReportButton targetType="community" targetId={c.id} />
              </div>
            </div>
            <ErrorBox error={error} />

            <div className="grid-2" style={{ marginTop: 16 }}>
              <div className="stack">
                {c.description && (
                  <div className="card">
                    <h2>About</h2>
                    <p style={{ whiteSpace: 'pre-line', margin: 0 }}>{c.description}</p>
                  </div>
                )}
                <div className="card">
                  <h2>Upcoming events</h2>
                  {!canSeeInside ? (
                    <p className="muted" style={{ margin: 0 }}>
                      Events are visible to members of this private community.
                    </p>
                  ) : events.length ? (
                    <div className="stack">
                      {events.map((e) => (
                        <EventCard key={e.id} event={e} />
                      ))}
                    </div>
                  ) : (
                    <p className="muted" style={{ margin: 0 }}>
                      No upcoming events.
                    </p>
                  )}
                </div>
                {canSeeInside && pastEvents.length > 0 && (
                  <div className="card">
                    <h2>Past events</h2>
                    <div className="list">
                      {pastEvents.map((e) => (
                        <Link key={e.id} to={`/events/${e.id}`}>
                          {e.title} · <span className="muted small">{new Date(e.startsAt).toLocaleDateString()}</span>
                        </Link>
                      ))}
                    </div>
                  </div>
                )}
              </div>
              <div className="stack">
                {c.isAdmin && requests.length > 0 && (
                  <div className="card">
                    <h2>Join requests</h2>
                    <div className="list">
                      {requests.map((r) => (
                        <div key={r.id} className="spread">
                          <span className="row">
                            <Avatar name={r.name} /> {r.name}
                          </span>
                          <span className="row">
                            <button type="button" className="btn small primary" onClick={() => act(`/members/${r.id}/approve`)}>
                              Approve
                            </button>
                            <button type="button" className="btn small" onClick={() => act(`/members/${r.id}/remove`)}>
                              Decline
                            </button>
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {c.rules && (
                  <div className="card">
                    <h2>Rules</h2>
                    <p style={{ whiteSpace: 'pre-line', margin: 0 }}>{c.rules}</p>
                  </div>
                )}
                <div className="card">
                  <h2>Admins</h2>
                  <div className="row">
                    {c.admins.map((a) => (
                      <Link key={a.id} to={`/users/${a.id}`} className="row">
                        <Avatar name={a.name} /> {a.name}
                      </Link>
                    ))}
                  </div>
                </div>
                {canSeeInside && (
                  <div className="card">
                    <h2>Members</h2>
                    <div className="list">
                      {members.map((m) => (
                        <div key={m.id} className="spread">
                          <Link to={`/users/${m.id}`} className="row">
                            <Avatar name={m.name} /> {m.name}
                            {m.role === 'admin' && <span className="pill brand">Admin</span>}
                          </Link>
                          {c.isAdmin && m.role !== 'admin' && (
                            <button type="button" className="btn ghost small" onClick={() => act(`/members/${m.id}/remove`)}>
                              Remove
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
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

export function CommunityNew() {
  const { user, meta } = useSession();
  const navigate = useNavigate();
  const [form, setForm] = useState({ name: '', description: '', activityType: user.activities?.[0] ?? 'road_cycling', rules: '', privacy: 'public' });
  const [location, setLocation] = useState(user.lat != null ? { locationName: user.locationName, lat: user.lat, lng: user.lng } : null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const update = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { community } = await api.post('/communities', { ...form, ...(location ?? {}) });
      navigate(`/communities/${community.id}`);
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  }

  return (
    <div style={{ maxWidth: 680, margin: '0 auto' }} className="stack">
      <h1>Create a community</h1>
      {!user.isPremium && <PremiumCard />}
      <form className="card stack" onSubmit={submit}>
        <Field label="Name" error={error?.field === 'Name' && error.message}>
          <input type="text" required maxLength={80} value={form.name} onChange={update('name')} placeholder="Jakarta Cycling Club" />
        </Field>
        <Field label="Main activity">
          <select value={form.activityType} onChange={update('activityType')}>
            {meta.activityTypes.map((a) => (
              <option key={a.key} value={a.key}>
                {ACTIVITY_EMOJI[a.key]} {a.label}
              </option>
            ))}
          </select>
        </Field>
        <div className="field">
          <span>Home area</span>
          <LocationPicker value={location} onChange={setLocation} />
        </div>
        <Field label="Description">
          <textarea maxLength={2000} value={form.description} onChange={update('description')} />
        </Field>
        <Field label="Rules" hint="optional">
          <textarea maxLength={2000} value={form.rules} onChange={update('rules')} placeholder="Helmets always. No-drop unless stated." />
        </Field>
        <Field label="Privacy">
          <select value={form.privacy} onChange={update('privacy')}>
            <option value="public">Public: anyone can join and see events</option>
            <option value="private">Private: admins approve members; events are members-only</option>
          </select>
        </Field>
        {error && !error.field && <ErrorBox error={error} />}
        <button className="btn primary" disabled={busy || !user.isPremium}>
          {busy ? 'Creating…' : 'Create community'}
        </button>
      </form>
    </div>
  );
}
