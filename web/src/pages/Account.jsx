import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../api.js';
import { LocationPicker } from '../components/LocationPicker.jsx';
import { ActivityMultiSelect, ErrorBox, Field } from '../components/ui.jsx';
import { useSession } from '../session.jsx';

// Only same-site, non-auth paths are allowed as post-login destinations.
function safeNext(params) {
  const next = params.get('next');
  if (!next || !next.startsWith('/') || next.startsWith('//')) return '/';
  if (/^\/(login|register|onboarding|forgot-password|reset-password)\b/.test(next)) return '/';
  return next;
}

const GOOGLE_ERRORS = {
  cancelled: 'Google sign-in was cancelled.',
  expired: 'That Google sign-in took too long or was opened in another browser. Please try again.',
  failed: "We couldn't complete the Google sign-in. Please try again.",
  unverified_email: 'Your Google account email is not verified yet. Verify it with Google, or use email and password.',
  linked_elsewhere: 'This email is already linked to a different Google account.',
  suspended: 'This account is suspended.',
  invite_required: 'ROAMR is in closed alpha: open your invite link and choose "Continue with Google" there.',
  not_configured: 'Google sign-in is not available right now.',
};

// Full-page navigation: the server redirects to Google and back.
function GoogleButton({ next, invite, label = 'Continue with Google' }) {
  const params = new URLSearchParams();
  if (next && next !== '/') params.set('next', next);
  if (invite) params.set('invite', invite);
  const qs = params.toString();
  return (
    <>
      <a className="btn block" href={`/api/auth/google${qs ? `?${qs}` : ''}`}>
        <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
          <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
          <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
          <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z" />
          <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
        </svg>
        {label}
      </a>
      <div className="spread small muted" aria-hidden="true">
        <hr className="divider" style={{ flex: 1 }} />
        <span style={{ padding: '0 8px' }}>or</span>
        <hr className="divider" style={{ flex: 1 }} />
      </div>
    </>
  );
}

function AuthCard({ title, children }) {
  return (
    <div style={{ maxWidth: 420, margin: '24px auto' }}>
      <div className="card">
        <h1>{title}</h1>
        {children}
      </div>
    </div>
  );
}

export function Login() {
  const { setUser, meta } = useSession();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [form, setForm] = useState({ email: '', password: '' });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { user } = await api.post('/auth/login', form);
      setUser(user);
      navigate(safeNext(params), { replace: true });
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  const googleError = params.get('google_error');

  return (
    <AuthCard title="Welcome back">
      <div className="stack">
        {googleError && <div className="alert danger small">{GOOGLE_ERRORS[googleError] ?? GOOGLE_ERRORS.failed}</div>}
        {meta?.googleLogin && <GoogleButton next={safeNext(params)} />}
      </div>
      <form className="stack" onSubmit={submit}>
        <Field label="Email">
          <input type="email" autoComplete="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
        </Field>
        <Field label="Password">
          <input type="password" autoComplete="current-password" required value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
        </Field>
        <ErrorBox error={error} />
        <button className="btn primary" disabled={busy}>
          {busy ? 'Logging in…' : 'Log in'}
        </button>
        <div className="spread small">
          <Link to="/forgot-password">Forgot password?</Link>
          <Link to={`/register?next=${encodeURIComponent(safeNext(params))}`}>Create an account</Link>
        </div>
        {meta?.demoMode && (
          <div className="alert small">
            Demo accounts: <strong>kevin@roamr.test</strong> (rider), <strong>sarah@roamr.test</strong> (premium community leader),{' '}
            <strong>admin@roamr.test</strong> (admin). Password <strong>password123</strong>.
          </div>
        )}
      </form>
    </AuthCard>
  );
}

export function Register() {
  const { setUser, meta } = useSession();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [form, setForm] = useState({ name: '', email: '', password: '', inviteCode: params.get('invite') ?? '' });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { user } = await api.post('/auth/register', form);
      setUser(user);
      navigate(`/onboarding?next=${encodeURIComponent(safeNext(params))}`, { replace: true });
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthCard title="Join ROAMR">
      <p className="muted">Find routes, find people to ride and run with, and share what the trail is like today.</p>
      {meta?.googleLogin && (
        <div className="stack">
          <GoogleButton next={safeNext(params)} invite={form.inviteCode} label="Sign up with Google" />
        </div>
      )}
      <form className="stack" onSubmit={submit}>
        <Field label="Name" error={error?.field === 'Name' && error.message}>
          <input type="text" autoComplete="name" required maxLength={60} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </Field>
        <Field label="Email" error={error?.field === 'Email' && error.message}>
          <input type="email" autoComplete="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
        </Field>
        <Field label="Password" hint="at least 8 characters" error={error?.field === 'Password' && error.message}>
          <input type="password" autoComplete="new-password" required minLength={8} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
        </Field>
        {meta?.inviteRequired && (
          <Field label="Invite code" hint="ROAMR is in closed alpha" error={error?.field === 'Invite code' && error.message}>
            <input type="text" autoComplete="off" required value={form.inviteCode} onChange={(e) => setForm({ ...form, inviteCode: e.target.value })} />
          </Field>
        )}
        {error && !error.field && <ErrorBox error={error} />}
        <button className="btn primary" disabled={busy}>
          {busy ? 'Creating account…' : 'Create account'}
        </button>
        <p className="small" style={{ margin: 0 }}>
          Already have an account? <Link to="/login">Log in</Link>
        </p>
      </form>
    </AuthCard>
  );
}

export function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  async function submit(e) {
    e.preventDefault();
    setError(null);
    try {
      setResult(await api.post('/auth/forgot', { email }));
    } catch (err) {
      setError(err);
    }
  }

  return (
    <AuthCard title="Reset your password">
      {result ? (
        <div className="stack">
          <div className="alert ok">If an account exists for {email}, a reset link is on its way.</div>
          {result.devResetLink && (
            <div className="alert small">
              Development mode has no email service. Use this link: <Link to={result.devResetLink}>reset password</Link>
            </div>
          )}
        </div>
      ) : (
        <form className="stack" onSubmit={submit}>
          <Field label="Email">
            <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <ErrorBox error={error} />
          <button className="btn primary">Send reset link</button>
        </form>
      )}
    </AuthCard>
  );
}

export function ResetPassword() {
  const [params] = useSearchParams();
  const { refresh } = useSession();
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);

  async function submit(e) {
    e.preventDefault();
    setError(null);
    try {
      await api.post('/auth/reset', { token: params.get('token'), password });
      await refresh();
      navigate('/', { replace: true });
    } catch (err) {
      setError(err);
    }
  }

  return (
    <AuthCard title="Choose a new password">
      <form className="stack" onSubmit={submit}>
        <Field label="New password" hint="at least 8 characters">
          <input type="password" autoComplete="new-password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        <ErrorBox error={error} />
        <button className="btn primary">Save password</button>
      </form>
    </AuthCard>
  );
}

// PRD §9: pick activities and an area so the home feed and nearby
// notifications are personalised.
export function Onboarding() {
  const { user, setUser } = useSession();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [activities, setActivities] = useState(user.activities ?? []);
  const [experience, setExperience] = useState(user.experience ?? 'beginner');
  const [location, setLocation] = useState(user.lat != null ? { locationName: user.locationName, lat: user.lat, lng: user.lng } : null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  async function save(skip = false) {
    setBusy(true);
    setError(null);
    try {
      const { user: updated } = await api.patch('/me', {
        ...(skip ? {} : { activities, experience, ...(location ?? {}) }),
        onboarded: true,
      });
      setUser(updated);
      navigate(safeNext(params), { replace: true });
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  }

  return (
    <div style={{ maxWidth: 640, margin: '0 auto' }}>
      <div className="card stack">
        <h1>What do you like to do, {user.name}?</h1>
        <p className="muted" style={{ margin: 0 }}>
          We use this to suggest routes, activities, communities and events near you.
        </p>
        <ActivityMultiSelect value={activities} onChange={setActivities} />
        <Field label="Experience">
          <select value={experience} onChange={(e) => setExperience(e.target.value)}>
            <option value="beginner">Beginner</option>
            <option value="intermediate">Intermediate</option>
            <option value="advanced">Advanced</option>
          </select>
        </Field>
        <div className="field">
          <span>Where are you based?</span>
          <LocationPicker value={location} onChange={setLocation} />
        </div>
        <ErrorBox error={error} />
        <div className="row">
          <button type="button" className="btn primary" disabled={busy || !activities.length} onClick={() => save(false)}>
            Continue
          </button>
          <button type="button" className="btn ghost" disabled={busy} onClick={() => save(true)}>
            Skip for now
          </button>
        </div>
      </div>
    </div>
  );
}
