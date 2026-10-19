import { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import { time } from '../format.js';
import { getPosition, useLoad, useSession } from '../session.jsx';
import { ReportConditionButton } from './Conditions.jsx';

function osmLink({ lat, lng }) {
  return `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=16/${lat}/${lng}`;
}

function Message({ m, mine }) {
  if (m.kind === 'system') return <div className="msg system">{m.body}</div>;
  return (
    <div className={`msg ${m.kind}${mine ? ' mine' : ''}`}>
      {!mine && <div className="who">{m.user?.name ?? 'Someone'}</div>}
      <div>
        {m.kind === 'condition' && '📣 '}
        {m.kind === 'sos' && '🆘 '}
        {m.body}
      </div>
      {m.data?.lat != null && (
        <a className="small" href={osmLink(m.data)} target="_blank" rel="noreferrer">
          📍 {m.data.lat.toFixed(5)}, {m.data.lng.toFixed(5)}
        </a>
      )}
      <div className="tiny muted" style={{ textAlign: 'right' }}>
        {time(m.createdAt)}
      </div>
    </div>
  );
}

// Activity group chat (PRD §15). New messages arrive over the session's
// event stream; sending is a plain POST.
export function ChatPanel({ activityId, routeId, maxKm, disabled, onReported }) {
  const { user, subscribe } = useSession();
  const state = useLoad(() => api.get(`/activities/${activityId}/messages`), [activityId]);
  const [text, setText] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const log = useRef(null);
  const { setData } = state;

  useEffect(
    () =>
      subscribe((type, data) => {
        if (type !== 'chat' || data.activityId !== activityId) return;
        setData((d) => (d && !d.messages.some((m) => m.id === data.id) ? { ...d, messages: [...d.messages, data] } : d));
      }),
    [subscribe, activityId, setData],
  );

  const count = state.data?.messages.length ?? 0;
  useEffect(() => {
    if (log.current) log.current.scrollTop = log.current.scrollHeight;
  }, [count]);

  const add = (message) =>
    setData((d) => (d.messages.some((m) => m.id === message.id) ? d : { ...d, messages: [...d.messages, message] }));

  async function send(e) {
    e.preventDefault();
    if (!text.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const { message } = await api.post(`/activities/${activityId}/messages`, { body: text });
      add(message);
      setText('');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function shareLocation() {
    setError(null);
    try {
      const pos = await getPosition();
      const { message } = await api.post(`/activities/${activityId}/messages`, { location: pos });
      add(message);
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className="chat">
      <div className="chat-log" ref={log} aria-live="polite">
        {state.loading && <p className="muted small">Loading messages…</p>}
        {state.error && <p className="muted small">{state.error.message}</p>}
        {state.data?.messages.map((m) => (
          <Message key={m.id} m={m} mine={m.user?.id === user?.id} />
        ))}
      </div>
      {error && <div className="field-error">{error}</div>}
      {!disabled && (
        <>
          <div className="row" style={{ paddingTop: 8 }}>
            <ReportConditionButton routeId={routeId} activityId={activityId} maxKm={maxKm} onReported={onReported} />
            <button type="button" className="btn" onClick={shareLocation}>
              📍 Share location
            </button>
          </div>
          <form className="chat-input" onSubmit={send}>
            <label className="sr-only" htmlFor="chat-text">
              Message
            </label>
            <input id="chat-text" type="text" value={text} maxLength={1000} onChange={(e) => setText(e.target.value)} placeholder="Message the group" autoComplete="off" />
            <button className="btn primary" disabled={busy || !text.trim()}>
              Send
            </button>
          </form>
        </>
      )}
    </div>
  );
}
