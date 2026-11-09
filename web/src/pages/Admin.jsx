import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { Empty, ErrorBox, Loaded, NotFound } from '../components/ui.jsx';
import { ago } from '../format.js';
import { useLoad, useSession } from '../session.jsx';

// Moderation dashboard (PRD §29): platform numbers and the report queue.
export function Admin() {
  const { user } = useSession();
  const [status, setStatus] = useState('open');
  const overview = useLoad(() => (user.isAdmin ? api.get('/admin/overview') : null), []);
  const reports = useLoad(() => (user.isAdmin ? api.get(`/admin/reports?status=${status}`) : null), [status]);
  const organizers = useLoad(() => (user.isAdmin ? api.get('/admin/organizers') : null), []);
  const [error, setError] = useState(null);

  if (!user.isAdmin) return <NotFound />;

  async function resolve(id, action) {
    setError(null);
    try {
      await api.post(`/admin/reports/${id}`, { action });
      reports.reload();
      overview.reload();
    } catch (err) {
      setError(err);
    }
  }

  async function review(id, action) {
    setError(null);
    try {
      await api.post(`/admin/organizers/${id}`, { action });
      organizers.reload();
      overview.reload();
    } catch (err) {
      setError(err);
    }
  }

  return (
    <>
      <h1>Admin</h1>
      <Loaded state={overview}>
        {(o) => (
          <div className="stats">
            {[
              ['Weekly active participants', o.weeklyActiveParticipants],
              ['Users', o.users],
              ['Routes', o.routes],
              ['Activities', o.activities],
              ['Communities', o.communities],
              ['Events', o.events],
              ['Open reports', o.openReports],
              ['Organizers to review', o.pendingOrganizers],
            ].map(([l, v]) => (
              <div key={l} className="stat">
                <div className="v">{v.toLocaleString()}</div>
                <div className="l">{l}</div>
              </div>
            ))}
          </div>
        )}
      </Loaded>

      <div className="section-head section">
        <h2>Organizers to review</h2>
      </div>
      <p className="muted small" style={{ marginTop: 0 }}>
        Approved organizers can sell paid events. Check that the organization is real before approving.
      </p>
      <Loaded state={organizers}>
        {(d) =>
          d.organizers.length ? (
            <div className="stack">
              {d.organizers.map((o) => (
                <div key={o.id} className="card">
                  <div className="spread">
                    <Link to={`/communities/${o.id}`} className="strong">
                      {o.name}
                    </Link>
                    <span className="tiny muted">{ago(o.createdAt)}</span>
                  </div>
                  <p style={{ margin: '8px 0' }} className="small">
                    {o.activityLabel}
                    {o.locationName ? ` · ${o.locationName}` : ''} · owner <Link to={`/users/${o.owner.id}`}>{o.owner.name}</Link> ({o.ownerEmail})
                  </p>
                  {o.description && <p className="small muted" style={{ margin: '0 0 8px', whiteSpace: 'pre-line' }}>{o.description}</p>}
                  <div className="row">
                    <button type="button" className="btn small primary" onClick={() => review(o.id, 'approve')}>
                      Approve
                    </button>
                    <button type="button" className="btn small danger" onClick={() => review(o.id, 'reject')}>
                      Reject
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <Empty>No organizers waiting for review.</Empty>
          )
        }
      </Loaded>

      <div className="section-head section">
        <h2>Reports</h2>
        <div className="tabs">
          {['open', 'resolved'].map((s) => (
            <button key={s} type="button" className={status === s ? 'on' : ''} onClick={() => setStatus(s)}>
              {s[0].toUpperCase() + s.slice(1)}
            </button>
          ))}
        </div>
      </div>
      <ErrorBox error={error} />
      <Loaded state={reports}>
        {(d) =>
          d.reports.length ? (
            <div className="stack">
              {d.reports.map((r) => (
                <div key={r.id} className="card">
                  <div className="spread">
                    <div>
                      <span className="pill">{r.targetType}</span>{' '}
                      {r.target.link ? <Link to={r.target.link}>{r.target.label}</Link> : r.target.label}
                    </div>
                    <span className="tiny muted">{ago(r.createdAt)}</span>
                  </div>
                  <p style={{ margin: '8px 0' }}>
                    <strong>{r.reasonLabel}</strong> · reported by <Link to={`/users/${r.reporter.id}`}>{r.reporter.name}</Link>
                    {r.details && <span className="muted"> — {r.details}</span>}
                  </p>
                  {r.status === 'open' && (
                    <div className="row">
                      <button type="button" className="btn small danger" onClick={() => resolve(r.id, 'remove')}>
                        {r.targetType === 'user' ? 'Suspend user' : r.targetType === 'activity' ? 'Cancel activity' : 'Remove'}
                      </button>
                      {r.targetType === 'route' && (
                        <button type="button" className="btn small" onClick={() => resolve(r.id, 'flag_unsafe')}>
                          Flag as unsafe
                        </button>
                      )}
                      <button type="button" className="btn small" onClick={() => resolve(r.id, 'dismiss')}>
                        Dismiss
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <Empty>No {status} reports.</Empty>
          )
        }
      </Loaded>
    </>
  );
}
