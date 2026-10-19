import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api.js';
import { ChatPanel } from '../components/ChatPanel.jsx';
import { ConditionsSummary } from '../components/Conditions.jsx';
import { MapView } from '../components/MapView.jsx';
import { PlacesPanel } from '../components/PlacesPanel.jsx';
import { ReportButton } from '../components/ReportButton.jsx';
import { ActivityPill, Avatar, DifficultyPill, ErrorBox, Loaded, Modal, SignInPrompt } from '../components/ui.jsx';
import { WeatherPanel } from '../components/WeatherPanel.jsx';
import { duration, km, longDate, time } from '../format.js';
import { getPosition, useLoad, useSession } from '../session.jsx';
import { routeMarkers } from './RouteDetail.jsx';

function CheckIn({ activity, onDone }) {
  const { meta } = useSession();
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  async function checkIn(position) {
    setBusy(true);
    setError(null);
    try {
      const pos = position ?? (await getPosition());
      await api.post(`/activities/${activity.id}/checkin`, pos);
      onDone();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  if (activity.checkedInAt) {
    return (
      <div className="stack">
        <div className="alert ok">✓ You checked in at {time(activity.checkedInAt)}. Have a great one!</div>
        <h3 style={{ margin: 0 }}>Where do you want to finish?</h3>
        <PlacesPanel routeId={activity.route.id} />
      </div>
    );
  }
  return (
    <div className="stack">
      <p className="small muted" style={{ margin: 0 }}>
        When you arrive at the meeting point or on the route, check in so the group knows you&apos;re here. We&apos;ll suggest places to finish.
      </p>
      <button type="button" className="btn primary" onClick={() => checkIn()} disabled={busy}>
        📍 {busy ? 'Checking location…' : "I'm here, check in"}
      </button>
      {meta.demoMode && (
        <button type="button" className="btn small" onClick={() => checkIn({ lat: activity.meeting[0], lng: activity.meeting[1] })} disabled={busy}>
          Demo: check in as if at the meeting point
        </button>
      )}
      {error && <div className="field-error">{error}</div>}
    </div>
  );
}

// Emergency button (PRD §30): shares position with the group and shows the
// user's emergency contact plus the national emergency number.
function Sos({ activityId }) {
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  async function send() {
    setBusy(true);
    setError(null);
    let pos = {};
    try {
      pos = await getPosition();
    } catch {
      /* send without a location rather than not at all */
    }
    try {
      setResult(await api.post(`/activities/${activityId}/sos`, pos));
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button type="button" className="btn sos block" onClick={() => setOpen(true)}>
        🆘 SOS
      </button>
      {open && (
        <Modal title="Emergency" onClose={() => setOpen(false)}>
          <div className="stack">
            <a className="btn danger block" href="tel:112">
              📞 Call 112 (emergency services)
            </a>
            {result ? (
              <>
                <div className="alert ok">Your group was alerted{result.message.data ? ' with your location' : ''}.</div>
                {result.emergencyContact ? (
                  <a className="btn block" href={`tel:${result.emergencyContact.phone.replace(/\s/g, '')}`}>
                    📞 Call {result.emergencyContact.name ?? 'emergency contact'} ({result.emergencyContact.phone})
                  </a>
                ) : (
                  <p className="small muted">
                    Add an emergency contact in <Link to="/settings">settings</Link> so it&apos;s one tap away next time.
                  </p>
                )}
              </>
            ) : (
              <button type="button" className="btn sos block" onClick={send} disabled={busy}>
                {busy ? 'Alerting…' : 'Alert my group with my location'}
              </button>
            )}
            {error && <div className="field-error">{error}</div>}
          </div>
        </Modal>
      )}
    </>
  );
}

export function ActivityDetail() {
  const { id } = useParams();
  const { user } = useSession();
  const state = useLoad(() => api.get(`/activities/${id}`), [id]);
  const routeId = state.data?.activity.route.id;
  const conditions = useLoad(() => (routeId ? api.get(`/routes/${routeId}/conditions`) : null), [routeId]);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const markers = useMemo(() => {
    if (!state.data) return [];
    const a = state.data.activity;
    const reports = (conditions.data?.reports ?? []).filter((r) => r.km != null).slice(0, 10);
    return [...routeMarkers(a.geometry, reports), { lat: a.meeting[0], lng: a.meeting[1], emoji: '📍', title: 'Meeting point', subtitle: a.meetingPoint }];
  }, [state.data, conditions.data]);

  async function act(path, body) {
    setBusy(true);
    setError(null);
    try {
      state.setData(await api.post(`/activities/${id}${path}`, body));
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  async function setStatus(status) {
    const msg = status === 'cancelled' ? 'Cancel this activity? Everyone who joined will be notified.' : 'Mark this activity as completed?';
    if (!window.confirm(msg)) return;
    setError(null);
    try {
      state.setData(await api.patch(`/activities/${id}`, { status }));
    } catch (err) {
      setError(err);
    }
  }

  return (
    <Loaded state={state}>
      {({ activity: a, participants, requests }) => {
        const member = a.myStatus === 'joined';
        const open = a.status === 'open';
        const full = a.participantLimit && a.participantCount >= a.participantLimit;
        const started = new Date(a.startsAt).getTime() < Date.now();
        return (
          <>
            {a.status === 'cancelled' && <div className="alert danger">This activity was cancelled.</div>}
            {a.status === 'completed' && <div className="alert ok">This activity is completed.</div>}
            <div className="spread" style={{ alignItems: 'flex-start', marginTop: 8 }}>
              <div>
                <div className="row" style={{ marginBottom: 6 }}>
                  <ActivityPill type={a.activityType} label={a.activityLabel} />
                  <DifficultyPill value={a.route.difficulty} />
                  {a.visibility === 'private' && <span className="pill">🔒 Private</span>}
                </div>
                <h1>{a.title}</h1>
                <p className="strong" style={{ color: 'var(--brand)', margin: 0 }}>
                  {longDate(a.startsAt)}
                </p>
                <p className="muted small" style={{ margin: 0 }}>
                  Hosted by <Link to={`/users/${a.host.id}`}>{a.host.name}</Link>
                </p>
              </div>
              <ReportButton targetType="activity" targetId={a.id} />
            </div>

            <div className="stats" style={{ margin: '16px 0' }}>
              <div className="stat">
                <div className="v">{km(a.route.distanceM)}</div>
                <div className="l">Distance</div>
              </div>
              <div className="stat">
                <div className="v">{duration(a.estDurationS)}</div>
                <div className="l">Estimated</div>
              </div>
              <div className="stat">
                <div className="v">{a.pace ?? '–'}</div>
                <div className="l">Pace</div>
              </div>
              <div className="stat">
                <div className="v">
                  {a.participantCount}
                  {a.participantLimit ? ` / ${a.participantLimit}` : ''}
                </div>
                <div className="l">Participants</div>
              </div>
            </div>

            <div className="grid-2">
              <div className="stack">
                <div className="card stack">
                  <div>
                    <div className="small muted">Route</div>
                    <Link to={`/routes/${a.route.id}`} className="strong">
                      {a.route.name} →
                    </Link>
                  </div>
                  <div>
                    <div className="small muted">Meeting point</div>
                    <div className="strong">📍 {a.meetingPoint}</div>
                  </div>
                  {a.description && <p style={{ whiteSpace: 'pre-line', margin: 0 }}>{a.description}</p>}
                  <ErrorBox error={error} />
                  {!user && open && <SignInPrompt />}
                  {user && open && !a.myStatus && !started && (
                    <button type="button" className="btn primary block" disabled={busy || full} onClick={() => act('/join')}>
                      {full ? 'Full' : a.visibility === 'private' ? 'Request to join' : 'Join'}
                    </button>
                  )}
                  {a.myStatus === 'requested' && (
                    <div className="spread">
                      <span className="muted">Waiting for the host to approve your request.</span>
                      <button type="button" className="btn small" onClick={() => act('/leave')}>
                        Withdraw
                      </button>
                    </div>
                  )}
                  {member && !a.isHost && open && (
                    <button type="button" className="btn small" style={{ alignSelf: 'flex-start' }} onClick={() => act('/leave')} disabled={busy}>
                      Leave activity
                    </button>
                  )}
                  {a.isHost && open && (
                    <div className="row">
                      <button type="button" className="btn small" onClick={() => setStatus('completed')}>
                        Mark completed
                      </button>
                      <button type="button" className="btn small" onClick={() => setStatus('cancelled')}>
                        Cancel activity
                      </button>
                    </div>
                  )}
                </div>

                {a.isHost && requests.length > 0 && (
                  <div className="card">
                    <h2>Join requests</h2>
                    <div className="list">
                      {requests.map((r) => (
                        <div key={r.id} className="spread">
                          <span className="row">
                            <Avatar name={r.name} /> <Link to={`/users/${r.id}`}>{r.name}</Link>
                          </span>
                          <span className="row">
                            <button type="button" className="btn small primary" onClick={() => act(`/requests/${r.id}/approve`)}>
                              Approve
                            </button>
                            <button type="button" className="btn small" onClick={() => act(`/requests/${r.id}/decline`)}>
                              Decline
                            </button>
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <MapView geometry={a.geometry} markers={markers} label="Activity map" />

                {member && a.status !== 'cancelled' && (
                  <div className="card">
                    <h2>Check in</h2>
                    <CheckIn activity={a} onDone={state.reload} />
                  </div>
                )}

                <div className="card">
                  <h2>Weather for this activity</h2>
                  <WeatherPanel routeId={a.route.id} startsAt={a.startsAt} />
                </div>
              </div>

              <div className="stack">
                <div className="card">
                  <h2>Group chat</h2>
                  {member ? (
                    <ChatPanel
                      activityId={a.id}
                      routeId={a.route.id}
                      maxKm={Math.ceil(a.route.distanceM / 1000)}
                      disabled={a.status === 'cancelled'}
                      onReported={conditions.reload}
                    />
                  ) : (
                    <p className="muted" style={{ margin: 0 }}>
                      Join to chat with the group and get live track updates.
                    </p>
                  )}
                </div>

                {member && open && <Sos activityId={a.id} />}

                <div className="card">
                  <h2>Latest track updates</h2>
                  {conditions.data ? (
                    <>
                      <ConditionsSummary conditions={conditions.data.conditions} />
                      {conditions.data.reports.length > 0 && (
                        <Link className="small" to={`/routes/${a.route.id}`} style={{ display: 'inline-block', marginTop: 8 }}>
                          All {conditions.data.reports.length} reports from the last 7 days →
                        </Link>
                      )}
                    </>
                  ) : (
                    <p className="muted small">Loading…</p>
                  )}
                </div>

                <div className="card">
                  <h2>Who&apos;s going ({participants.length})</h2>
                  <div className="list">
                    {participants.map((p) => (
                      <div key={p.id} className="spread">
                        <span className="row">
                          <Avatar name={p.name} />
                          <Link to={`/users/${p.id}`}>{p.name}</Link>
                          {p.isHost && <span className="pill brand">Host</span>}
                        </span>
                        <span className="small muted">
                          {p.checkedIn ? '✓ Checked in' : p.experience ? p.experience[0].toUpperCase() + p.experience.slice(1) : ''}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </>
        );
      }}
    </Loaded>
  );
}
