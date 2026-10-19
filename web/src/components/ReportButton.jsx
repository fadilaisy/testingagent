import { useState } from 'react';
import { api } from '../api.js';
import { useSession } from '../session.jsx';
import { ErrorBox, Field, Modal } from './ui.jsx';

const SUGGESTED = {
  route: ['dangerous_route', 'wrong_gpx', 'spam', 'inappropriate', 'other'],
  activity: ['fake_activity', 'spam', 'harassment', 'inappropriate', 'other'],
  event: ['unsafe_event', 'fake_activity', 'spam', 'inappropriate', 'other'],
  community: ['spam', 'harassment', 'inappropriate', 'other'],
  user: ['harassment', 'spam', 'fake_activity', 'inappropriate', 'other'],
};

// Lets users flag content for moderators (FR-18, PRD §30 user reporting).
export function ReportButton({ targetType, targetId }) {
  const { user, meta } = useSession();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [details, setDetails] = useState('');
  const [done, setDone] = useState(false);
  const [error, setError] = useState(null);
  if (!user || !meta) return null;

  async function submit(e) {
    e.preventDefault();
    setError(null);
    try {
      await api.post('/reports', { targetType, targetId, reason, details });
      setDone(true);
    } catch (err) {
      setError(err);
    }
  }

  return (
    <>
      <button type="button" className="btn ghost small" onClick={() => setOpen(true)}>
        ⚑ Report
      </button>
      {open && (
        <Modal title={`Report this ${targetType}`} onClose={() => setOpen(false)}>
          {done ? (
            <div className="stack">
              <div className="alert ok">Thanks. A moderator will review it.</div>
              <button type="button" className="btn" onClick={() => setOpen(false)}>
                Close
              </button>
            </div>
          ) : (
            <form className="stack" onSubmit={submit}>
              <Field label="Reason">
                <select required value={reason} onChange={(e) => setReason(e.target.value)}>
                  <option value="">Choose a reason</option>
                  {(SUGGESTED[targetType] ?? Object.keys(meta.reportReasons)).map((r) => (
                    <option key={r} value={r}>
                      {meta.reportReasons[r]}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Details" hint="optional">
                <textarea maxLength={1000} value={details} onChange={(e) => setDetails(e.target.value)} />
              </Field>
              <ErrorBox error={error} />
              <button className="btn danger" disabled={!reason}>
                Send report
              </button>
            </form>
          )}
        </Modal>
      )}
    </>
  );
}
