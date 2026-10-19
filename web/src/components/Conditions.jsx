import { useState } from 'react';
import { api } from '../api.js';
import { SEVERITY_DOT, ago, conditionLabel } from '../format.js';
import { useSession } from '../session.jsx';
import { ConditionItem } from './cards.jsx';
import { ErrorBox, Field, Modal } from './ui.jsx';

const CATEGORY_EMOJI = { road: '🚧', traffic: '🚗', weather: '🌧', trail: '🥾', crowd: '👥' };

// Current-conditions summary: the latest report per category in the last 24h.
export function ConditionsSummary({ conditions }) {
  const { meta } = useSession();
  const latest = Object.values(conditions.latest);
  return (
    <div className="stack">
      {conditions.warnings.map((w) => (
        <div key={w.category} className="alert danger">
          ⚠️ {w.message}
        </div>
      ))}
      {latest.length === 0 ? (
        <p className="muted small" style={{ margin: 0 }}>
          No reports in the last 24 hours. Been here recently? Share what it&apos;s like.
        </p>
      ) : (
        <div className="stack" style={{ gap: 6 }}>
          {Object.keys(meta?.conditionCategories ?? {})
            .filter((c) => conditions.latest[c])
            .map((c) => {
              const r = conditions.latest[c];
              return (
                <div key={c} className="spread">
                  <span>
                    {SEVERITY_DOT[r.severity]} {r.categoryLabel}: <strong>{conditionLabel(r.value)}</strong>
                    {r.km != null && <span className="muted small"> · KM {r.km}</span>}
                  </span>
                  <span className="tiny muted">{ago(r.createdAt)}</span>
                </div>
              );
            })}
        </div>
      )}
    </div>
  );
}

export function ReportList({ reports, limit = 8 }) {
  const [all, setAll] = useState(false);
  if (!reports.length) return null;
  const shown = all ? reports : reports.slice(0, limit);
  return (
    <div className="list">
      {shown.map((r) => (
        <ConditionItem key={r.id} report={r} />
      ))}
      {reports.length > limit && !all && (
        <button type="button" className="btn ghost small" onClick={() => setAll(true)}>
          Show all {reports.length} reports
        </button>
      )}
    </div>
  );
}

// "Report Track Condition" quick action (PRD §15-16, Flow C).
export function ReportConditionButton({ routeId, activityId, maxKm, onReported, label = '📣 Report condition' }) {
  const { meta } = useSession();
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState('road');
  const [value, setValue] = useState('');
  const [kmValue, setKm] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  if (!meta) return null;
  const categories = meta.conditionCategories;

  async function submit(e) {
    e.preventDefault();
    if (!value) return setError(new Error('Pick what it is like'));
    setBusy(true);
    setError(null);
    try {
      const { report } = await api.post(`/routes/${routeId}/conditions`, {
        category,
        value,
        km: kmValue === '' ? undefined : Number(kmValue),
        description,
        activityId,
      });
      setOpen(false);
      setValue('');
      setKm('');
      setDescription('');
      onReported?.(report);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button type="button" className="btn" onClick={() => setOpen(true)}>
        {label}
      </button>
      {open && (
        <Modal title="Report track condition" onClose={() => setOpen(false)}>
          <form className="stack" onSubmit={submit}>
            <div className="chips" role="group" aria-label="Category">
              {Object.entries(categories).map(([key, c]) => (
                <button
                  type="button"
                  key={key}
                  className={`chip${category === key ? ' on' : ''}`}
                  onClick={() => {
                    setCategory(key);
                    setValue('');
                  }}
                >
                  {CATEGORY_EMOJI[key]} {c.label}
                </button>
              ))}
            </div>
            <div className="chip-grid" role="group" aria-label="Condition">
              {Object.entries(categories[category].values).map(([v, severity]) => (
                <button type="button" key={v} className={`chip${value === v ? ' on' : ''}`} onClick={() => setValue(v)}>
                  {SEVERITY_DOT[severity]} {conditionLabel(v)}
                </button>
              ))}
            </div>
            <div className="form-row">
              <Field label="Where (KM)" hint="optional">
                <input type="number" min="0" max={maxKm} step="0.1" value={kmValue} onChange={(e) => setKm(e.target.value)} placeholder="e.g. 18" />
              </Field>
            </div>
            <Field label="Details" hint="optional">
              <input type="text" maxLength={280} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="One lane closed near the bridge" />
            </Field>
            <ErrorBox error={error} />
            <button className="btn primary" disabled={busy}>
              {busy ? 'Sending…' : 'Share with everyone'}
            </button>
            <p className="tiny muted" style={{ margin: 0 }}>
              Reports show on the route page with your name and the time{activityId ? ', and in your group chat' : ''}.
            </p>
          </form>
        </Modal>
      )}
    </>
  );
}
