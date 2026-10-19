import { useEffect } from 'react';
import { Bike, CircleCheck, Compass, Footprints, Mountain, OctagonAlert, TreePine, TriangleAlert } from 'lucide-react';
import { Link, Navigate, useLocation } from 'react-router-dom';
import { DIFFICULTY_LABEL } from '../format.js';
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
        Go Home
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

// Tinted icon tile per activity type, from the Figma design.
export const ACTIVITY_STYLE = {
  road_cycling: { Icon: Bike, color: '#2f8fd8' },
  gravel: { Icon: Bike, color: '#b5682f' },
  mtb: { Icon: Bike, color: '#14402b' },
  running: { Icon: Footprints, color: '#d2432f' },
  trail_running: { Icon: Mountain, color: '#1d5a3c' },
  hiking: { Icon: TreePine, color: '#8a6a2f' },
  other: { Icon: Compass, color: '#5a6a62' },
};

export function ActIcon({ type, size = 40 }) {
  const { Icon, color } = ACTIVITY_STYLE[type] ?? ACTIVITY_STYLE.other;
  return (
    <span className="act-icon" style={{ width: size, height: size, color, background: `${color}1a` }} aria-hidden="true">
      <Icon size={size * 0.52} strokeWidth={2.2} />
    </span>
  );
}

// Inline activity icon at text size, replacing emoji so every interface icon
// shares one stroke style (Apple HIG, icons).
export function ActGlyph({ type, size = '1.1em' }) {
  const { Icon, color } = ACTIVITY_STYLE[type] ?? ACTIVITY_STYLE.other;
  return <Icon className="glyph" size={size} strokeWidth={2.2} style={{ color }} aria-hidden="true" />;
}

// Shape as well as color carries severity, so it never relies on color alone.
export const SEVERITY = [
  { tone: 'good', Icon: CircleCheck, label: 'Clear' },
  { tone: 'warn', Icon: TriangleAlert, label: 'Caution' },
  { tone: 'bad', Icon: OctagonAlert, label: 'Hazard' },
];

export function SeverityGlyph({ severity, size = '1.1em' }) {
  const s = SEVERITY[severity] ?? SEVERITY[0];
  return <s.Icon className={`glyph sev-${s.tone}`} size={size} role="img" aria-label={s.label} />;
}

export function DifficultyPill({ value }) {
  if (!value) return null;
  return <span className={`pill ${value}`}>{DIFFICULTY_LABEL[value] ?? value}</span>;
}

export function ActivityPill({ type, label }) {
  return (
    <span className="pill brand">
      <ActGlyph type={type} /> {label}
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
          <ActGlyph type={a.key} /> {a.label}
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
          <ActGlyph type={a.key} /> {a.label}
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

export function SignInPrompt({ children = 'to Join' }) {
  const location = useLocation();
  return (
    <Link className="btn primary block" to={`/login?next=${encodeURIComponent(location.pathname)}`}>
      Log In {children}
    </Link>
  );
}
