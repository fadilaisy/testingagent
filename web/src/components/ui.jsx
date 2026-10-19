import { useEffect } from 'react';
import { Link, Navigate, useLocation } from 'react-router-dom';
import { ACTIVITY_EMOJI, DIFFICULTY_LABEL } from '../format.js';
import { useSession } from '../session.jsx';

export function Spinner() {
  return (
    <div className="center" role="status">
      <span className="spinner" />
      <span className="sr-only">Loading</span>
    </div>
  );
}

export function ErrorBox({ error, children }) {
  if (!error && !children) return null;
  return (
    <div className="alert danger" role="alert">
      {children ?? error.message}
    </div>
  );
}

// Renders loading / error / content for a useLoad() result.
export function Loaded({ state, children }) {
  if (state.loading && !state.data) return <Spinner />;
  if (state.error) {
    if (state.error.status === 404) return <NotFound />;
    return <ErrorBox error={state.error} />;
  }
  if (!state.data) return null;
  return children(state.data);
}

export function NotFound() {
  return (
    <div className="empty">
      <h1>Not found</h1>
      <p>This page doesn&apos;t exist or was removed.</p>
      <Link className="btn" to="/">
        Go home
      </Link>
    </div>
  );
}

export function Empty({ children }) {
  return <div className="empty">{children}</div>;
}

export function Field({ label, hint, error, children }) {
  return (
    <label className={`field${error ? ' error' : ''}`}>
      <span>
        {label} {hint && <span className="hint">· {hint}</span>}
      </span>
      {children}
      {error && <span className="field-error">{error}</span>}
    </label>
  );
}

const AVATAR_COLORS = ['#1f7a4d', '#2a6f97', '#a44a3f', '#7b5ea7', '#c97c1d', '#3d7068', '#b5485d'];
export function Avatar({ name = '?', size }) {
  const n = [...name].reduce((s, c) => s + c.charCodeAt(0), 0);
  return (
    <span className={`avatar${size === 'lg' ? ' lg' : ''}`} style={{ background: AVATAR_COLORS[n % AVATAR_COLORS.length] }} aria-hidden="true">
      {name.trim().charAt(0).toUpperCase()}
    </span>
  );
}

export function DifficultyPill({ value }) {
  if (!value) return null;
  return <span className={`pill ${value}`}>{DIFFICULTY_LABEL[value] ?? value}</span>;
}

export function ActivityPill({ type, label }) {
  return (
    <span className="pill brand">
      {ACTIVITY_EMOJI[type] ?? '🧭'} {label}
    </span>
  );
}

// Horizontal single-select chips for activity types, with an "All" option.
export function ActivityChips({ value, onChange, includeAll = true }) {
  const { meta } = useSession();
  if (!meta) return null;
  return (
    <div className="chips" role="group" aria-label="Activity">
      {includeAll && (
        <button type="button" className={`chip${!value ? ' on' : ''}`} onClick={() => onChange('')}>
          All
        </button>
      )}
      {meta.activityTypes.map((a) => (
        <button
          type="button"
          key={a.key}
          className={`chip${value === a.key ? ' on' : ''}`}
          aria-pressed={value === a.key}
          onClick={() => onChange(value === a.key && includeAll ? '' : a.key)}
        >
          {ACTIVITY_EMOJI[a.key]} {a.label}
        </button>
      ))}
    </div>
  );
}

// Multi-select version used in onboarding and settings.
export function ActivityMultiSelect({ value, onChange }) {
  const { meta } = useSession();
  if (!meta) return null;
  const toggle = (k) => onChange(value.includes(k) ? value.filter((x) => x !== k) : [...value, k]);
  return (
    <div className="chip-grid" role="group" aria-label="Preferred activities">
      {meta.activityTypes.map((a) => (
        <button
          type="button"
          key={a.key}
          className={`chip${value.includes(a.key) ? ' on' : ''}`}
          aria-pressed={value.includes(a.key)}
          onClick={() => toggle(a.key)}
        >
          {ACTIVITY_EMOJI[a.key]} {a.label}
        </button>
      ))}
    </div>
  );
}

export function Modal({ title, onClose, children }) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="card modal" role="dialog" aria-modal="true" aria-label={title}>
        <div className="spread" style={{ marginBottom: 12 }}>
          <h2 style={{ margin: 0 }}>{title}</h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

// Redirects to /login (and back afterwards) when signed out.
export function RequireAuth({ children }) {
  const { user } = useSession();
  const location = useLocation();
  if (user === undefined) return <Spinner />;
  if (!user) return <Navigate to={`/login?next=${encodeURIComponent(location.pathname + location.search)}`} replace />;
  return children;
}

export function SignInPrompt({ children = 'to join' }) {
  const location = useLocation();
  return (
    <Link className="btn primary block" to={`/login?next=${encodeURIComponent(location.pathname)}`}>
      Log in {children}
    </Link>
  );
}
