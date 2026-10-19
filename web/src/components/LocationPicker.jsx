import { useState } from 'react';
import { getPosition, useSession } from '../session.jsx';

// Pick a home area from preset cities or share GPS. Only an approximate
// position is stored; it powers "near you" and nearby-event notifications.
export function LocationPicker({ value, onChange }) {
  const { meta } = useSession();
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  if (!meta) return null;

  async function useGps() {
    setBusy(true);
    setError(null);
    try {
      const pos = await getPosition();
      onChange({ locationName: value?.locationName || 'My area', ...pos });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const selected = meta.cities.find((c) => c.name === value?.locationName);
  return (
    <div className="stack" style={{ gap: 8 }}>
      <select
        aria-label="Home area"
        value={selected ? selected.name : value?.locationName ? '__custom' : ''}
        onChange={(e) => {
          const c = meta.cities.find((x) => x.name === e.target.value);
          if (c) onChange({ locationName: c.name, lat: c.lat, lng: c.lng });
        }}
      >
        <option value="">Choose your area</option>
        {meta.cities.map((c) => (
          <option key={c.name} value={c.name}>
            {c.name}
          </option>
        ))}
        {value?.locationName && !selected && <option value="__custom">{value.locationName} (from GPS)</option>}
      </select>
      <div className="row">
        <button type="button" className="btn small" onClick={useGps} disabled={busy}>
          📍 {busy ? 'Locating…' : 'Use my current location'}
        </button>
        {value?.lat != null && <span className="tiny muted">Saved as an approximate area, never shown to others.</span>}
      </div>
      {error && <span className="field-error">{error}</span>}
    </div>
  );
}
