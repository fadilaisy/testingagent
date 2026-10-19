import { Activity, Bell, Compass, House, Mountain, Plus, User, Users } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, NavLink, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { Avatar, NotFound, RequireAuth, Spinner } from './components/ui.jsx';
import { ForgotPassword, Login, Onboarding, Register, ResetPassword } from './pages/Account.jsx';
import { ActivityDetail } from './pages/ActivityDetail.jsx';
import { ActivityNew } from './pages/ActivityNew.jsx';
import { Admin } from './pages/Admin.jsx';
import { CommunityDetail, CommunityList, CommunityNew } from './pages/Communities.jsx';
import { CreateHub } from './pages/Create.jsx';
import { EventDetail, EventNew } from './pages/Events.jsx';
import { Explore } from './pages/Explore.jsx';
import { Home } from './pages/Home.jsx';
import { MyActivities } from './pages/MyActivities.jsx';
import { Notifications } from './pages/Notifications.jsx';
import { Profile, Settings } from './pages/Profile.jsx';
import { RouteDetail } from './pages/RouteDetail.jsx';
import { RouteUpload } from './pages/RouteUpload.jsx';
import { Search } from './pages/Search.jsx';
import { useSession } from './session.jsx';

function TopBar() {
  const { user, unread } = useSession();
  const navigate = useNavigate();
  const location = useLocation();
  const [q, setQ] = useState('');
  useEffect(() => {
    if (location.pathname === '/search') setQ(new URLSearchParams(location.search).get('q') ?? '');
  }, [location]);

  return (
    <header className="topbar">
      <Brand className="topbar-brand" />
      <form
        className="search-form"
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          if (q.trim()) navigate(`/search?q=${encodeURIComponent(q.trim())}`);
        }}
      >
        <input type="search" aria-label="Search routes, communities, events and people" placeholder="Search “Puncak”" value={q} onChange={(e) => setQ(e.target.value)} />
      </form>
      <Link to="/create" className="icon-btn create-btn" aria-label="Create">
        <Plus size={22} strokeWidth={2.4} />
      </Link>
      {user ? (
        <>
          <Link to="/notifications" className="icon-btn" aria-label={`Notifications${unread ? `, ${unread} unread` : ''}`}>
            <Bell size={20} />
            {unread > 0 && <span className="badge">{unread > 99 ? '99+' : unread}</span>}
          </Link>
          <Link to={`/users/${user.id}`} aria-label="Your profile" className="topnav-avatar">
            <Avatar name={user.name} />
          </Link>
        </>
      ) : (
        user === null && (
          <Link to="/login" className="btn small primary">
            Log In
          </Link>
        )
      )}
    </header>
  );
}

function Brand({ className = '' }) {
  return (
    <Link to="/" className={`brand ${className}`} aria-label="Jalur home">
      <span className="brand-mark" aria-hidden="true">
        <Mountain size={22} />
      </span>
      <span>Jalur</span>
    </Link>
  );
}

// Tabs only navigate (Apple HIG, tab bars); Create is an action, so it lives
// in the top bar on phones and as a button above the sidebar on desktop.
function useTabs() {
  const { user } = useSession();
  return [
    { to: '/', label: 'Home', Icon: House, end: true },
    { to: '/explore', label: 'Explore', Icon: Compass },
    { to: '/activities', label: 'Activity', Icon: Activity },
    { to: '/communities', label: 'Community', Icon: Users },
    { to: user ? `/users/${user.id}` : '/login', label: 'Profile', Icon: User },
  ];
}

function Sidebar() {
  const tabs = useTabs();
  return (
    <aside className="sidebar">
      <Brand />
      <Link to="/create" className="btn primary block side-create">
        <Plus size={20} aria-hidden="true" /> Create Activity
      </Link>
      <nav className="side-nav" aria-label="Main">
        {tabs.map(({ to, label, Icon, end }) => (
          <NavLink key={label} to={to} end={end}>
            <Icon size={20} aria-hidden="true" />
            {label}
          </NavLink>
        ))}
      </nav>
    </aside>
  );
}

function TabBar() {
  const tabs = useTabs();
  return (
    <nav className="tabbar" aria-label="Main">
      {tabs.map(({ to, label, Icon, end }) => (
        <NavLink key={label} to={to} end={end}>
          <Icon size={24} aria-hidden="true" />
          <span>{label}</span>
        </NavLink>
      ))}
    </nav>
  );
}

function Toast() {
  const { toast, setToast } = useSession();
  useEffect(() => {
    if (!toast) return undefined;
    const t = setTimeout(() => setToast(null), toast.urgent ? 15000 : 6000);
    return () => clearTimeout(t);
  }, [toast, setToast]);
  if (!toast) return null;
  return (
    <div className={`toast${toast.urgent ? ' urgent' : ''}`} role="status">
      <span>{toast.title}</span>
      {toast.link && (
        <Link to={toast.link} onClick={() => setToast(null)}>
          View
        </Link>
      )}
      <button type="button" className="btn ghost small" style={{ color: 'inherit' }} onClick={() => setToast(null)} aria-label="Dismiss">
        ✕
      </button>
    </div>
  );
}

// New accounts go through onboarding (activities + area) once. Auth pages
// are skipped so they can finish their own redirect first.
const NO_ONBOARDING_REDIRECT = ['/onboarding', '/settings', '/login', '/register', '/forgot-password', '/reset-password'];
function OnboardingGate() {
  const { user } = useSession();
  const location = useLocation();
  if (user && !user.onboarded && !NO_ONBOARDING_REDIRECT.includes(location.pathname)) {
    return <Navigate to={`/onboarding?next=${encodeURIComponent(location.pathname)}`} replace />;
  }
  return null;
}

function MeRedirect() {
  const { user } = useSession();
  return <Navigate to={`/users/${user.id}`} replace />;
}

export function App() {
  const { user, meta } = useSession();
  const location = useLocation();
  // Braces matter: newer browsers return a Promise from scrollTo, and an
  // effect must return nothing or a cleanup function.
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [location.pathname]);

  if (user === undefined || !meta) {
    return (
      <div className="shell">
        <div className="content">
          <TopBar />
          <Spinner />
        </div>
      </div>
    );
  }

  const auth = (el) => <RequireAuth>{el}</RequireAuth>;
  return (
    <div className="shell">
      <Sidebar />
      <div className="content">
        <TopBar />
        <OnboardingGate />
        <main>
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/explore" element={<Explore />} />
            <Route path="/search" element={<Search />} />
            <Route path="/create" element={<CreateHub />} />
            <Route path="/routes/new" element={auth(<RouteUpload />)} />
            <Route path="/routes/:id" element={<RouteDetail />} />
            <Route path="/activities" element={auth(<MyActivities />)} />
            <Route path="/activities/new" element={auth(<ActivityNew />)} />
            <Route path="/activities/:id" element={<ActivityDetail />} />
            <Route path="/communities" element={<CommunityList />} />
            <Route path="/communities/new" element={auth(<CommunityNew />)} />
            <Route path="/communities/:id" element={<CommunityDetail />} />
            <Route path="/events/new" element={auth(<EventNew />)} />
            <Route path="/events/:id" element={<EventDetail />} />
            <Route path="/notifications" element={auth(<Notifications />)} />
            <Route path="/users/:id" element={<Profile />} />
            <Route path="/me" element={auth(<MeRedirect />)} />
            <Route path="/settings" element={auth(<Settings />)} />
            <Route path="/onboarding" element={auth(<Onboarding />)} />
            <Route path="/admin" element={auth(<Admin />)} />
            <Route path="/login" element={<Login />} />
            <Route path="/register" element={<Register />} />
            <Route path="/forgot-password" element={<ForgotPassword />} />
            <Route path="/reset-password" element={<ResetPassword />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </main>
      </div>
      <TabBar />
      <Toast />
    </div>
  );
}
