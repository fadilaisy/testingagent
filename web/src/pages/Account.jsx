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

  return (
    <AuthCard title="Welcome back">
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
            Demo accounts: <strong>kevin@jalur.test</strong> (rider), <strong>sarah@jalur.test</strong> (premium community leader),{' '}
            <strong>admin@jalur.test</strong> (admin). Password <strong>password123</strong>.
          </div>
        )}
      </form>
    </AuthCard>
  );
}

export function Register() {
  const { setUser } = useSession();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [form, setForm] = useState({ name: '', email: '', password: '' });
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
    <AuthCard title="Join Jalur">
      <p className="muted">Find routes, find people to ride and run with, and share what the trail is like today.</p>
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
