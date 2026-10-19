import { useMemo, useState } from 'react';
import { cumulative } from '../geo.js';

const W = 1000;
const H = 100;

export function ElevationChart({ geometry }) {
  const [hover, setHover] = useState(null);
  const data = useMemo(() => {
    const pts = geometry.filter((p) => p[2] != null);
    if (pts.length < 2) return null;
    const cum = cumulative(geometry);
    const series = geometry.map((p, i) => [cum[i] / 1000, p[2]]).filter(([, e]) => e != null);
    const total = cum.at(-1) / 1000;
    const eles = series.map(([, e]) => e);
    let min = Math.min(...eles);
    let max = Math.max(...eles);
    if (max - min < 20) {
      max += 10;
      min -= 10;
    }
    const x = (d) => (d / total) * W;
    const y = (e) => H - ((e - min) / (max - min)) * (H - 6) - 3;
    const line = series.map(([d, e], i) => `${i ? 'L' : 'M'}${x(d).toFixed(1)},${y(e).toFixed(1)}`).join(' ');
    return { series, total, min, max, line, area: `${line} L${W},${H} L0,${H} Z`, x, y };
  }, [geometry]);

  if (!data) return <p className="muted small">This GPX file has no elevation data.</p>;

  const onMove = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const d = ((e.clientX - rect.left) / rect.width) * data.total;
    let best = data.series[0];
    for (const p of data.series) if (Math.abs(p[0] - d) < Math.abs(best[0] - d)) best = p;
    setHover(best);
  };

  return (
    <div className="elevation">
      <div className="spread tiny muted">
        <span>{Math.round(data.max)} m</span>
        <span>{hover ? `KM ${hover[0].toFixed(1)} · ${Math.round(hover[1])} m` : 'Hover or tap the profile'}</span>
      </div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        onMouseMove={onMove}
        onTouchMove={(e) => onMove(e.touches[0] ? { ...e, clientX: e.touches[0].clientX, currentTarget: e.currentTarget } : e)}
        onMouseLeave={() => setHover(null)}
        role="img"
        aria-label={`Elevation profile from ${Math.round(data.min)} to ${Math.round(data.max)} metres over ${data.total.toFixed(1)} km`}
      >
        <line className="grid" x1="0" x2={W} y1={H / 2} y2={H / 2} />
        <path className="area" d={data.area} />
        <path className="line" d={data.line} />
        {hover && <line x1={data.x(hover[0])} x2={data.x(hover[0])} y1="0" y2={H} stroke="currentColor" strokeOpacity="0.4" vectorEffect="non-scaling-stroke" />}
      </svg>
      <div className="spread tiny muted">
        <span>{Math.round(data.min)} m · KM 0</span>
        <span>KM {data.total.toFixed(1)}</span>
      </div>
    </div>
  );
}
