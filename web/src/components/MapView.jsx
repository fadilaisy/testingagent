import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';

const TILE_URL = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
const ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

function markerIcon(m) {
  if (m.emoji) {
    return L.divIcon({ className: '', html: `<div class="map-emoji">${m.emoji}</div>`, iconSize: [24, 24], iconAnchor: [12, 12] });
  }
  return L.divIcon({
    className: '',
    html: `<div class="map-pin" style="background:${m.color ?? '#1f7a4d'}"></div>`,
    iconSize: [14, 14],
    iconAnchor: [7, 7],
  });
}

/**
 * Leaflet map with OpenStreetMap tiles.
 * - geometry: [[lat, lng, ele], ...] drawn as the route polyline
 * - markers: [{ lat, lng, emoji?, color?, title, subtitle?, link? }]
 * - onPick: when set, clicking the map calls onPick({ lat, lng })
 */
export function MapView({ geometry, markers = [], center, zoom = 12, tall = false, onPick, label = 'Map' }) {
  const el = useRef(null);
  const map = useRef(null);
  const layer = useRef(null);
  const navigate = useNavigate();
  const pickRef = useRef(onPick);
  pickRef.current = onPick;

  useEffect(() => {
    const m = L.map(el.current, { scrollWheelZoom: false, zoomControl: true });
    L.tileLayer(TILE_URL, { attribution: ATTRIBUTION, maxZoom: 18 }).addTo(m);
    layer.current = L.layerGroup().addTo(m);
    m.on('click', (e) => pickRef.current?.({ lat: e.latlng.lat, lng: e.latlng.lng }));
    // Enable scroll zoom only after the user interacts, so the page scrolls normally.
    m.once('focus click', () => m.scrollWheelZoom.enable());
    map.current = m;
    return () => {
      m.stop();
      m.off();
      m.remove();
    };
  }, []);

  useEffect(() => {
    const m = map.current;
    const group = layer.current;
    group.clearLayers();
    const bounds = [];

    if (geometry?.length) {
      const latlngs = geometry.map(([lat, lng]) => [lat, lng]);
      L.polyline(latlngs, { color: '#ffffff', weight: 8, opacity: 0.9 }).addTo(group);
      L.polyline(latlngs, { color: '#1f7a4d', weight: 4 }).addTo(group);
      bounds.push(...latlngs);
    }

    for (const mk of markers) {
      const marker = L.marker([mk.lat, mk.lng], { icon: markerIcon(mk), title: mk.title, keyboard: true }).addTo(group);
      if (mk.title) {
        const box = document.createElement('div');
        const strong = document.createElement('strong');
        strong.textContent = mk.title;
        box.appendChild(strong);
        if (mk.subtitle) {
          const sub = document.createElement('div');
          sub.textContent = mk.subtitle;
          sub.style.fontSize = '12px';
          box.appendChild(sub);
        }
        if (mk.link) {
          const btn = document.createElement('a');
          btn.href = mk.link;
          btn.textContent = 'Open →';
          btn.style.display = 'inline-block';
          btn.style.marginTop = '4px';
          btn.addEventListener('click', (e) => {
            e.preventDefault();
            navigate(mk.link);
          });
          box.appendChild(btn);
        }
        marker.bindPopup(box);
      }
      bounds.push([mk.lat, mk.lng]);
    }

    // No animation: a zoom animation still running when the component
    // unmounts makes Leaflet throw (`_leaflet_pos` of undefined).
    const opts = { animate: false };
    if (bounds.length > 1) m.fitBounds(bounds, { padding: [24, 24], maxZoom: 15, ...opts });
    else if (bounds.length === 1) m.setView(bounds[0], Math.max(zoom, 13), opts);
    else if (center) m.setView(center, zoom, opts);
    else m.setView([-6.2, 106.82], 10, opts);
  }, [geometry, markers, center, zoom, navigate]);

  return <div ref={el} className={`map${tall ? ' tall' : ''}`} role="region" aria-label={label} />;
}
