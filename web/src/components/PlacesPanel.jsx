import { Star } from 'lucide-react';
import { useState } from 'react';
import { api, qs } from '../api.js';
import { distanceAway } from '../format.js';
import { useLoad, useSession } from '../session.jsx';
import { Ico, placeIcon } from './icons.jsx';
import { SkeletonText } from './ui.jsx';

const FINISH_CATEGORIES = ['coffee', 'food', 'recovery', 'bike_shop', 'convenience'];

// "Where do you want to finish?" (PRD §19) – nearby places at the route's
// finish (or start), ranked by distance and relevance to the activity.
export function PlacesPanel({ routeId, near = 'finish', onPlaces }) {
  const { meta } = useSession();
  const [category, setCategory] = useState('');
  const state = useLoad(async () => {
    const data = await api.get(`/routes/${routeId}/places${qs({ near, category })}`);
    onPlaces?.(data.places);
    return data;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeId, near, category]);

  const cats = meta?.placeCategories ?? {};
  return (
    <div className="stack">
      <div className="chips">
        <button type="button" className={`chip${!category ? ' on' : ''}`} onClick={() => setCategory('')}>
          All
        </button>
        {FINISH_CATEGORIES.map((c) => (
          <button type="button" key={c} className={`chip${category === c ? ' on' : ''}`} onClick={() => setCategory(c)}>
            <Ico icon={placeIcon(c)} /> {cats[c]?.label}
          </button>
        ))}
      </div>
      {state.loading && !state.data && <SkeletonText lines={4} />}
      {state.error && <p className="muted small">{state.error.message}</p>}
      {state.data && state.data.places.length === 0 && <p className="muted small">Nothing found within 1.5 km.</p>}
      {state.data && state.data.places.length > 0 && (
        <div className="list">
          {state.data.places.slice(0, 8).map((p) => (
            <div key={p.id} className="spread" style={{ flexWrap: 'nowrap' }}>
              <div>
                <div>
                  <Ico icon={placeIcon(p.category)} /> <strong>{p.name}</strong>
                </div>
                <div className="tiny muted num">
                  {p.label}
                  {p.openingHours ? ` · ${p.openingHours}` : ''}
                  {p.rating && (
                    <>
                      {' · '}
                      <Ico icon={Star} /> {p.rating}
                    </>
                  )}
                  {p.cyclistFriendly ? ' · Cyclist friendly' : ''}
                </div>
              </div>
              <div className="stack" style={{ gap: 0, alignItems: 'flex-end' }}>
                <span className="small nowrap num">{distanceAway(p.distanceM)}</span>
                <a className="small tap" href={`https://www.openstreetmap.org/directions?to=${p.lat}%2C${p.lng}`} target="_blank" rel="noreferrer">
                  Directions
                </a>
              </div>
            </div>
          ))}
        </div>
      )}
      {state.data && (
        <p className="tiny muted" style={{ margin: 0 }}>
          {state.data.source === 'openstreetmap' ? 'Places from © OpenStreetMap contributors' : 'Places from the ROAMR directory'}
        </p>
      )}
    </div>
  );
}
