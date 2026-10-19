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
