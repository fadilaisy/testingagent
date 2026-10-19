export function km(meters, digits = 1) {
  if (meters == null) return '–';
  const v = meters / 1000;
  return `${v >= 100 ? Math.round(v) : v.toFixed(digits)} km`;
}

export function distanceAway(meters) {
  if (meters == null) return '';
  return meters < 1000 ? `${Math.round(meters / 10) * 10} m away` : `${km(meters)} away`;
}

export function elevation(m) {
  return m == null ? '–' : `+${m.toLocaleString()} m`;
}

export function duration(seconds) {
  if (seconds == null) return '–';
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  if (!h) return `${m}m`;
  return m ? `${h}h ${m}m` : `${h}h`;
}

const dayFmt = new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
const timeFmt = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' });
const longFmt = new Intl.DateTimeFormat(undefined, { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });

export const time = (iso) => timeFmt.format(new Date(iso));
export const longDate = (iso) => longFmt.format(new Date(iso));

// "Today 06:00", "Tomorrow 05:30", "Sat 25 Oct · 06:00"
export function when(iso) {
  const d = new Date(iso);
  const today = new Date();
  const startOf = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diffDays = Math.round((startOf(d) - startOf(today)) / 864e5);
  const t = timeFmt.format(d);
  if (diffDays === 0) return `Today ${t}`;
  if (diffDays === 1) return `Tomorrow ${t}`;
  if (diffDays === -1) return `Yesterday ${t}`;
  return `${dayFmt.format(d)} · ${t}`;
}

export function ago(iso) {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
}

// For <input type="datetime-local">, in the browser's timezone.
export function toLocalInput(date) {
  const d = new Date(date);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export const DIFFICULTY_LABEL = { easy: 'Easy', moderate: 'Moderate', hard: 'Hard', extreme: 'Extreme' };

export const ACTIVITY_EMOJI = {
  road_cycling: '🚴',
  gravel: '🚵',
  mtb: '🚵',
  running: '🏃',
  trail_running: '⛰',
  hiking: '🥾',
  other: '🧭',
};

export function conditionLabel(value) {
  return value.replace('_', ' ').replace(/^./, (c) => c.toUpperCase());
}

export const SEVERITY_DOT = ['🟢', '🟡', '🔴'];
