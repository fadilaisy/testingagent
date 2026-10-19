import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { Empty, Loaded } from '../components/ui.jsx';
import { ago } from '../format.js';
import { useLoad, useSession } from '../session.jsx';

const ICON = {
  activity_join: '🙋',
  activity_update: '📅',
  track_update: '📣',
  weather: '🌧',
  nearby_event: '📍',
  community: '👥',
  sos: '🆘',
};

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
      <div className="spread">
        <h1 style={{ margin: 0 }}>Notifications</h1>
        <Link to="/settings#notifications" className="small">
          Settings
        </Link>
      </div>
      <div className="card" style={{ marginTop: 12 }}>
        <Loaded state={state}>
          {(d) =>
            d.notifications.length ? (
              <div className="list">
                {d.notifications.map((n) => {
                  const body = (
                    <div className="row" style={{ alignItems: 'flex-start', flexWrap: 'nowrap' }}>
                      <span style={{ fontSize: '1.3rem' }} aria-hidden="true">
                        {ICON[n.type] ?? '🔔'}
                      </span>
                      <div style={{ flex: 1 }}>
                        <div className={n.read ? '' : 'strong'}>{n.title}</div>
                        {n.body && <div className="small muted">{n.body}</div>}
                        <div className="tiny muted">{ago(n.createdAt)}</div>
                      </div>
                    </div>
                  );
                  return n.link ? (
                    <Link key={n.id} to={n.link} style={{ color: 'inherit' }}>
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
