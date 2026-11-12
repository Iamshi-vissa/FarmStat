// Tiny trend line for list rows: last 12 weekly prices, de-emphasised ink, latest point marked.
export default function Sparkline({ values = [], width = 64, height = 22 }) {
  const v = values.filter(x => x != null);
  if (v.length < 2) return <svg width={width} height={height} aria-hidden="true" />;
  const min = Math.min(...v), max = Math.max(...v), span = max - min || 1;
  const pts = v.map((y, i) => [(i / (v.length - 1)) * (width - 6) + 3, height - 3 - ((y - min) / span) * (height - 6)]);
  const [lx, ly] = pts[pts.length - 1];
  return (
    <svg width={width} height={height} aria-hidden="true">
      <polyline points={pts.map(p => p.join(',')).join(' ')} fill="none" stroke="#a3a9b5" strokeWidth="1.5"
        strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={lx} cy={ly} r="2.5" fill="#1c2230" />
    </svg>
  );
}
