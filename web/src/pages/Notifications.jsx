import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { notificationIcon } from '../components/icons.jsx';
import { Empty, Loaded, SkeletonText } from '../components/ui.jsx';
import { ago } from '../format.js';
import { useLoad, useSession } from '../session.jsx';

export function Notifications() {
  const { setUnread, subscribe } = useSession();
  const state = useLoad(() => api.get('/notifications'), []);
  const { setData } = state;

  // Opening the page marks everything read.
  useEffect(() => {
    if (state.data?.unread) {
      api.post('/notifications/read', {}).then(() => setUnread(0));
    }
  }, [state.data?.unread, setUnread]);

  useEffect(
    () =>
      subscribe((type, n) => {
        if (type !== 'notification') return;
        setData((d) => (d ? { ...d, notifications: [{ ...n, read: false, createdAt: n.created_at }, ...d.notifications] } : d));
      }),
    [subscribe, setData],
  );

  return (
    <div style={{ maxWidth: 720, margin: '0 auto' }}>
      <div className="spread page-head">
        <h1>Notifications</h1>
        <Link to="/settings#notifications" className="small">
          Settings
        </Link>
      </div>
      <div className="card" style={{ marginTop: 12 }}>
        <Loaded state={state} skeleton={<SkeletonText lines={6} />}>
          {(d) =>
            d.notifications.length ? (
              <div className="list">
                {d.notifications.map((n) => {
                  const Icon = notificationIcon(n.type);
                  const body = (
                    <div className="row" style={{ alignItems: 'flex-start', flexWrap: 'nowrap' }}>
                      <span className={`condition-icon${n.type === 'sos' ? ' bad' : ''}`} aria-hidden="true">
                        <Icon size={20} />
                      </span>
                      <div style={{ flex: 1 }}>
                        <div className={n.read ? '' : 'strong'}>{n.title}</div>
                        {n.body && <div className="small muted">{n.body}</div>}
                        <div className="tiny muted num">{ago(n.createdAt)}</div>
                      </div>
                    </div>
                  );
                  return n.link ? (
                    <Link key={n.id} to={n.link} style={{ color: 'inherit', fontWeight: 'inherit' }}>
                      {body}
                    </Link>
                  ) : (
                    <div key={n.id}>{body}</div>
                  );
                })}
              </div>
            ) : (
              <Empty>You&apos;re all caught up.</Empty>
            )
          }
        </Loaded>
      </div>
    </div>
  );
}
