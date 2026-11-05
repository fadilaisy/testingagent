import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { api } from './api.js';

const SessionContext = createContext(null);

// Holds the signed-in user, app metadata, unread notification count and the
// live event stream (chat messages + notifications pushed by the server).
export function SessionProvider({ children }) {
  const [user, setUser] = useState(undefined); // undefined = still loading
  const [meta, setMeta] = useState(null);
  const [unread, setUnread] = useState(0);
  const [toast, setToast] = useState(null);
  const listeners = useRef(new Set());

  const refresh = useCallback(async () => {
    const { user } = await api.get('/me');
    setUser(user);
    return user;
  }, []);

  useEffect(() => {
    api.get('/meta').then(setMeta).catch(() => setMeta(null));
    refresh().catch(() => setUser(null));
  }, [refresh]);

  const refreshUnread = useCallback(async () => {
    if (!user) return setUnread(0);
    try {
      const { unread } = await api.get('/notifications');
      setUnread(unread);
    } catch {
      /* offline; keep the old count */
    }
  }, [user]);

  useEffect(() => {
    refreshUnread();
  }, [refreshUnread]);

  // One stream per tab; EventSource reconnects on its own. Proxies (Vercel,
  // Fly) and deploys can drop the stream, so after a reconnect listeners get
  // a 'reconnect' event to refetch anything they may have missed.
  useEffect(() => {
    if (!user) return undefined;
    const es = new EventSource('/api/stream');
    const emit = (type, data) => {
      for (const fn of listeners.current) fn(type, data);
    };
    const dispatch = (type) => (e) => emit(type, JSON.parse(e.data));
    let opened = false;
    es.addEventListener('open', () => {
      if (opened) {
        emit('reconnect', null);
        refreshUnread();
      }
      opened = true;
    });
    es.addEventListener('chat', dispatch('chat'));
    es.addEventListener('notification', (e) => {
      dispatch('notification')(e);
      const n = JSON.parse(e.data);
      setUnread((u) => u + 1);
      setToast({ title: n.title, link: n.link, urgent: n.type === 'sos' });
    });
    return () => es.close();
  }, [user, refreshUnread]);

  const subscribe = useCallback((fn) => {
    listeners.current.add(fn);
    return () => listeners.current.delete(fn);
  }, []);

  const value = useMemo(
    () => ({ user, setUser, refresh, meta, unread, setUnread, refreshUnread, subscribe, toast, setToast }),
    [user, refresh, meta, unread, refreshUnread, subscribe, toast],
  );
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession() {
  return useContext(SessionContext);
}

// Small data-loading hook: returns { data, error, loading, reload, setData }.
export function useLoad(loader, deps) {
  const [state, setState] = useState({ data: null, error: null, loading: true });
  const counter = useRef(0);
  const run = useCallback(() => {
    const id = ++counter.current;
    setState((s) => ({ ...s, loading: true, error: null }));
    Promise.resolve()
      .then(loader)
      .then(
        (data) => id === counter.current && setState({ data, error: null, loading: false }),
        (error) => id === counter.current && setState({ data: null, error, loading: false }),
      );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(run, [run]);
  const setData = useCallback((fn) => setState((s) => ({ ...s, data: typeof fn === 'function' ? fn(s.data) : fn })), []);
  return { ...state, reload: run, setData };
}

// Browser geolocation as a promise.
export function getPosition() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error('Location is not available in this browser'));
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }),
      (err) => reject(new Error(err.code === 1 ? 'Location permission was denied' : 'Could not get your location')),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 },
    );
  });
}
