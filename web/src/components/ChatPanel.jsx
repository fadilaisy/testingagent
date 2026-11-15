import { MapPin, Megaphone, Send, Siren } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import { time } from '../format.js';
import { getPosition, useLoad, useSession } from '../session.jsx';
import { ReportConditionButton } from './Conditions.jsx';
import { Ico } from './icons.jsx';
import { SkeletonText } from './ui.jsx';

function osmLink({ lat, lng }) {
  return `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=16/${lat}/${lng}`;
}

function Message({ m, mine }) {
  if (m.kind === 'system') return <div className="msg system">{m.body}</div>;
  return (
    <div className={`msg ${m.kind}${mine ? ' mine' : ''}`}>
      {!mine && <div className="who">{m.user?.name ?? 'Someone'}</div>}
      <div>
        {m.kind === 'condition' && (
          <>
            <Ico icon={Megaphone} />{' '}
          </>
        )}
        {m.kind === 'sos' && (
          <>
            <Ico icon={Siren} />{' '}
          </>
        )}
        {m.body}
      </div>
      {m.data?.lat != null && (
        <a className="small mono" href={osmLink(m.data)} target="_blank" rel="noreferrer">
          <Ico icon={MapPin} /> {m.data.lat.toFixed(5)}, {m.data.lng.toFixed(5)}
        </a>
      )}
      <div className="tiny msg-time num">{time(m.createdAt)}</div>
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
        if (type === 'reconnect') {
          // Pick up messages sent while the live stream was down.
          api
            .get(`/activities/${activityId}/messages`)
            .then((fresh) => setData((d) => (d ? { ...d, messages: fresh.messages } : fresh)))
            .catch(() => {});
          return;
        }
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
        {state.loading && !state.data && <SkeletonText lines={4} />}
        {state.error && <p className="muted small">{state.error.message}</p>}
        {state.data?.messages.map((m) => (
          <Message key={m.id} m={m} mine={m.user?.id === user?.id} />
        ))}
      </div>
      {error && <div className="field-error">{error}</div>}
      {!disabled && (
        <>
          <div className="row chat-actions">
            <ReportConditionButton routeId={routeId} activityId={activityId} maxKm={maxKm} onReported={onReported} />
            <button type="button" className="btn" onClick={shareLocation}>
              <Ico icon={MapPin} /> Share location
            </button>
          </div>
          <form className="chat-input" onSubmit={send}>
            <label className="sr-only" htmlFor="chat-text">
              Message
            </label>
            <input id="chat-text" type="text" value={text} maxLength={1000} onChange={(e) => setText(e.target.value)} placeholder="Message the group" autoComplete="off" />
            <button className="btn primary" disabled={busy || !text.trim()} aria-busy={busy} aria-label="Send">
              <Send size={20} aria-hidden="true" />
            </button>
          </form>
        </>
      )}
    </div>
  );
}
