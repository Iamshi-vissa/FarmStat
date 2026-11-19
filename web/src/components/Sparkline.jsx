import { T } from '../theme.js';

// Tiny trend line for list rows: last 12 weekly prices, de-emphasised ink, latest point marked.
export default function Sparkline({ values = [], width = 64, height = 22 }) {
  const v = values.filter(x => x != null);
  if (v.length < 2) return <svg width={width} height={height} aria-hidden="true" />;
  const min = Math.min(...v), max = Math.max(...v), span = max - min || 1;
  const pts = v.map((y, i) => [(i / (v.length - 1)) * (width - 6) + 3, height - 3 - ((y - min) / span) * (height - 6)]);
  const [lx, ly] = pts[pts.length - 1];
  return (
    <svg width={width} height={height} aria-hidden="true">
      <polyline points={pts.map(p => p.join(',')).join(' ')} fill="none" stroke={T.context} strokeWidth="1.5"
        strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={lx} cy={ly} r="2.5" fill={T.ink} />
    </svg>
  );
}

// A wider trend under a big figure (the India median's last weeks): stretches to its box, ends on a dot.
export function TrendLine({ values = [], label, className = '' }) {
  const v = values.filter(x => x != null);
  if (v.length < 3) return null;
  const w = 220, h = 40, min = Math.min(...v), max = Math.max(...v), span = max - min || 1;
  const xy = v.map((y, i) => [(i / (v.length - 1)) * (w - 8) + 4, h - 4 - ((y - min) / span) * (h - 8)]);
  const [lx, ly] = xy[xy.length - 1];
  const inr = n => `₹${Math.round(n).toLocaleString('en-IN')}`;
  return (
    <svg className={`trendline ${className}`.trim()} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" role="img"
      aria-label={`${label}: from ${inr(v[0])} to ${inr(v[v.length - 1])}`}>
      <polyline points={xy.map(p => p.join(',')).join(' ')} fill="none" stroke={T.ink} strokeWidth="1.5"
        vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
      {/* a zero-length round-capped line rather than a circle, so the stretched box can't squash the dot */}
      <line x1={lx} y1={ly} x2={lx} y2={ly} stroke={T.ink} strokeWidth="6" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
