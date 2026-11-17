import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import { Link, Navigate, useLocation } from 'react-router-dom';
import { DIFFICULTY_LABEL } from '../format.js';
import { ACTIVITY_STYLE, Ico, activityIcon } from './icons.jsx';
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

// Placeholder shaped like the content that is on its way, so the page
// doesn't jump when the data arrives.
export function Skeleton({ width = '100%', height = '1em', style }) {
  return <span className="skel" style={{ width, height, ...style }} aria-hidden="true" />;
}

export function SkeletonText({ lines = 3 }) {
  return (
    <div className="stack skel-text" role="status">
      <span className="sr-only">Loading</span>
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} width={`${[92, 78, 60, 85][i % 4]}%`} />
      ))}
    </div>
  );
}

export function SkeletonCards({ count = 3 }) {
  return (
    <div className="grid-cards" role="status">
      <span className="sr-only">Loading</span>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="card tight skel-card" aria-hidden="true">
          <div className="card-row">
            <Skeleton width={40} height={40} style={{ borderRadius: 12 }} />
            <div className="card-main stack" style={{ gap: 8 }}>
              <Skeleton width="70%" height="1.1em" />
              <Skeleton width="90%" height="0.8em" />
            </div>
          </div>
          <Skeleton width="45%" height="0.8em" style={{ marginTop: 16 }} />
        </div>
      ))}
    </div>
  );
}

// Detail pages: title, stat tiles, then the two-column body.
export function SkeletonDetail() {
  return (
    <div className="stack" role="status">
      <span className="sr-only">Loading</span>
      <Skeleton width="30%" height="1em" />
      <Skeleton width="65%" height="2em" />
      <div className="stats">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} height={68} style={{ borderRadius: 16 }} />
        ))}
      </div>
      <div className="grid-2">
        <Skeleton height={320} style={{ borderRadius: 28 }} />
        <Skeleton height={320} style={{ borderRadius: 28 }} />
      </div>
    </div>
  );
}

// Renders loading / error / content for a useLoad() result. The first load
// shows `skeleton`; a reload keeps the old content on screen, dimmed.
export function Loaded({ state, children, skeleton = <SkeletonCards /> }) {
  if (state.loading && !state.data) return skeleton;
  if (state.error) {
    if (state.error.status === 404) return <NotFound />;
    return (
      <ErrorBox>
        <div className="spread">
          <span>{state.error.message}</span>
          {state.reload && (
            <button type="button" className="btn small" onClick={state.reload}>
              Try again
            </button>
          )}
        </div>
      </ErrorBox>
    );
  }
  if (!state.data) return null;
  return (
    <div className={`loaded${state.loading ? ' refreshing' : ''}`} aria-busy={state.loading}>
      {children(state.data)}
    </div>
  );
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

const AVATAR_COLORS = ['#14402b', '#2f8fd8', '#b5682f', '#d2432f', '#8a6a2f', '#1d5a3c'];
export function Avatar({ name = '?', size }) {
  const n = [...name].reduce((s, c) => s + c.charCodeAt(0), 0);
  return (
    <span className={`avatar${size === 'lg' ? ' lg' : ''}`} style={{ background: AVATAR_COLORS[n % AVATAR_COLORS.length] }} aria-hidden="true">
      {name.trim().charAt(0).toUpperCase()}
    </span>
  );
}

export function ActIcon({ type, size = 40 }) {
  const { Icon, color } = ACTIVITY_STYLE[type] ?? ACTIVITY_STYLE.other;
  return (
    <span className="act-icon" style={{ width: size, height: size, color, background: `${color}1a` }} aria-hidden="true">
      <Icon size={size * 0.52} strokeWidth={2} />
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
      <Ico icon={activityIcon(type)} /> {label}
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
          <Ico icon={activityIcon(a.key)} /> {a.label}
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
          <Ico icon={activityIcon(a.key)} /> {a.label}
        </button>
      ))}
    </div>
  );
}

// Closes on Escape, on a click outside and on the X. Focus moves into the
// dialog when it opens and goes back to the opener when it closes.
export function Modal({ title, onClose, children }) {
  const box = useRef(null);
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  useEffect(() => {
    const opener = document.activeElement;
    box.current?.focus();
    // Keep the page behind the sheet from scrolling (iOS scrolls it otherwise).
    const { overflow } = document.body.style;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = overflow;
      opener?.focus?.();
    };
  }, []);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="card modal" role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} ref={box}>
        <div className="spread modal-head">
          <h2>{title}</h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
            <X size={20} aria-hidden="true" />
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
