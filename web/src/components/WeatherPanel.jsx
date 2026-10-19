import { api, qs } from '../api.js';
import { time } from '../format.js';
import { useLoad } from '../session.jsx';

// Weather along the route (PRD §17). With startsAt it shows the forecast for
// when the group is expected at each point; otherwise current conditions.
export function WeatherPanel({ routeId, startsAt }) {
  const state = useLoad(() => api.get(`/routes/${routeId}/weather${qs({ startsAt })}`), [routeId, startsAt]);

  if (state.loading) return <p className="muted small">Loading weather…</p>;
  if (state.error) return <p className="muted small">🌥 {state.error.message}. Try again later.</p>;
  const w = state.data;

  return (
    <div className="stack">
      {!startsAt && (
        <div className="row">
          <span style={{ fontSize: '2.2rem' }}>{w.current.emoji}</span>
          <div>
            <div className="strong" style={{ fontSize: '1.3rem' }}>
              {w.current.temp != null ? `${Math.round(w.current.temp)}°C` : '–'} · {w.current.condition}
            </div>
            <div className="small muted">
              Rain {w.current.precipProb ?? '–'}% · Wind {w.current.wind != null ? Math.round(w.current.wind) : '–'} km/h · Humidity{' '}
              {w.current.humidity ?? '–'}%
            </div>
          </div>
        </div>
      )}
      {w.alerts.map((a, i) => (
        <div key={i} className={`alert ${a.level === 'danger' ? 'danger' : 'warning'}`}>
          ⚠️ {a.message}
          {a.eta ? ` around ${time(a.eta)}` : ''}
        </div>
      ))}
      {w.beyondForecast && <div className="alert">Forecast is only available up to 7 days ahead.</div>}
      <div className="weather-strip">
        {w.points.map((p) => (
          <div key={p.name} className="weather-cell">
            <div className="tiny muted strong">{p.name}</div>
            {p.eta && <div className="tiny muted">{time(p.eta)}</div>}
            <div className="e" aria-hidden="true">
              {p.available ? p.emoji : '—'}
            </div>
            <div className="strong">{p.available && p.temp != null ? `${Math.round(p.temp)}°C` : '–'}</div>
            <div className="tiny muted">{p.available ? `💧 ${p.precipProb ?? '–'}%` : 'No forecast'}</div>
          </div>
        ))}
      </div>
      {!startsAt && w.daily.length > 0 && (
        <details>
          <summary className="small muted">7-day forecast at the start</summary>
          <div className="weather-strip" style={{ marginTop: 8 }}>
            {w.daily.map((d) => (
              <div key={d.date} className="weather-cell">
                <div className="tiny muted strong">{new Date(`${d.date}T12:00`).toLocaleDateString(undefined, { weekday: 'short' })}</div>
                <div className="e">{d.emoji}</div>
                <div className="small strong">
                  {Math.round(d.max)}° / {Math.round(d.min)}°
                </div>
                <div className="tiny muted">💧 {d.precipProb ?? '–'}%</div>
              </div>
            ))}
          </div>
        </details>
      )}
      <p className="tiny muted" style={{ margin: 0 }}>
        Weather data by Open-Meteo.com
      </p>
    </div>
  );
}
