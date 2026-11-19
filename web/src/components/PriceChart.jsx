import { useMemo, useState } from 'react';
import { compactRupees, date, pct, rupees } from '../format.js';
import { niceTicks } from '../stats.js';
import { useWidth } from '../hooks.js';
import { T } from '../theme.js';

// The mandi price chart, drawn as plain SVG (no charting library): price in ink, forecast and likely range in marigold,
// the usual range for the season in grey, and arrivals as bars underneath on the same time axis. One hover line runs
// through both, with every value at that week in a tooltip.
const C = { ink: T.ink, fc: T.forecast, ctx: T.context, grid: T.grid, axis: T.ink3, surface: T.panel };
const DAY = 864e5;
const ts = s => new Date(s).getTime();
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// One tick per month (or every 2/3/6/12 months on long ranges), with the year on January and the first tick.
function monthTicks(t0, t1, maxTicks = 8) {
  const start = new Date(t0); start.setDate(1); start.setHours(0, 0, 0, 0);
  if (start.getTime() < t0) start.setMonth(start.getMonth() + 1);
  const all = [];
  for (const d = new Date(start); d.getTime() <= t1; d.setMonth(d.getMonth() + 1)) all.push(d.getTime());
  const step = [1, 2, 3, 6, 12, 24].find(k => all.length / k <= maxTicks) ?? 24;
  const ticks = all.filter(t => step === 1 || (new Date(t).getMonth() % Math.min(step, 12) === 0
    && (step < 24 || new Date(t).getFullYear() % 2 === 0)));
  return ticks.map((t, i) => {
    const d = new Date(t);
    const label = step >= 12 ? String(d.getFullYear())
      : d.getMonth() === 0 || i === 0 ? `${MONTHS[d.getMonth()]} ${d.getFullYear()}` : MONTHS[d.getMonth()];
    return { t, label };
  });
}

// One number style per axis: all in lakh, all in thousands, or all in full.
const axisRupeesFor = ticks => {
  const max = Math.max(...ticks);
  if (max >= 100000) return v => `₹${(v / 100000).toLocaleString('en-IN', { maximumFractionDigits: 2 })}L`;
  if (max >= 10000) return v => `₹${(v / 1000).toLocaleString('en-IN', { maximumFractionDigits: 1 })}k`;
  return v => `₹${v.toLocaleString('en-IN')}`;
};

// "M x y L x y …" through the points that have a value, starting a new piece wherever a value is missing (unless joined).
function linePath(rows, x, y, get, join = false) {
  let d = '', open = false;
  for (const r of rows) {
    const v = get(r);
    if (v == null) { if (!join) open = false; continue; }
    d += `${open ? 'L' : 'M'}${x(r.t).toFixed(1)} ${y(v).toFixed(1)}`;
    open = true;
  }
  return d;
}
// A band between two edges, over the rows that have it.
function bandPath(rows, x, y, get) {
  const pts = rows.filter(r => get(r));
  if (pts.length < 2) return '';
  const top = pts.map((r, i) => `${i ? 'L' : 'M'}${x(r.t).toFixed(1)} ${y(get(r)[1]).toFixed(1)}`).join('');
  const bottom = pts.slice().reverse().map(r => `L${x(r.t).toFixed(1)} ${y(get(r)[0]).toFixed(1)}`).join('');
  return `${top}${bottom}Z`;
}
const halo = { paintOrder: 'stroke', stroke: C.surface, strokeWidth: 4, strokeLinejoin: 'round' };

const seasonWord = t => `${['early', 'mid', 'late'][Math.min(2, Math.floor((new Date(t).getDate() - 1) / 10))]} ${MONTHS[new Date(t).getMonth()]}`;
const weekOfYear = d => Math.floor((d - new Date(d.getFullYear(), 0, 1)) / (7 * DAY));

// Seasonal context: for each date, the 10th-90th percentile of prices in the same weeks (±1) of the previous
// 5 years. Needs at least 3 such weeks.
function seasonalBands(rows, full) {
  const pts = full.filter(h => h.price != null).map(h => {
    const d = new Date(h.week);
    return { y: d.getFullYear(), k: weekOfYear(d), p: h.price };
  });
  const cache = new Map();
  rows.forEach(r => {
    const d = new Date(r.t), y = d.getFullYear(), k = weekOfYear(d);
    const key = `${y}-${k}`;
    if (!cache.has(key)) {
      const near = pts.filter(x => x.y < y && x.y >= y - 5 && Math.min(Math.abs(x.k - k), 52 - Math.abs(x.k - k)) <= 1)
        .map(x => x.p).sort((a, b) => a - b);
      const q = f => near[Math.min(near.length - 1, Math.max(0, Math.round((near.length - 1) * f)))];
      cache.set(key, near.length >= 3 ? [q(0.1), q(0.9)] : null);
    }
    r.season = cache.get(key);
  });
}

export function buildRows({ history, full = history, forecast, showLastYear, showSeason }) {
  const byT = new Map(full.map(h => [ts(h.week), h.price]));
  const rows = history.map((h, i) => {
    const prev = history[i - 1]?.price;
    return { t: ts(h.week), price: h.price, wow: prev ? h.price / prev - 1 : null, arrivals: h.arrivals_t ?? null };
  });
  forecast.forEach(f => {
    const t = ts(f.week);
    let row = rows.find(r => r.t === t);
    if (!row) { row = { t, future: true }; rows.push(row); }
    Object.assign(row, { p50: f.p50, band: [f.p10, f.p90], isNow: f.h === 0 });
  });
  if (showLastYear) rows.forEach(r => { r.lastYear = byT.get(r.t - 364 * DAY) ?? null; });
  // break the line where reports stop for more than 3 weeks, instead of drawing a straight bridge
  const real = rows.filter(r => r.price != null).sort((a, b) => a.t - b.t);
  for (let i = 1; i < real.length; i++) {
    if (real[i].t - real[i - 1].t > 21 * DAY) rows.push({ t: (real[i].t + real[i - 1].t) / 2, gap: [real[i - 1].t, real[i].t] });
  }
  rows.sort((a, b) => a.t - b.t);
  if (showSeason) seasonalBands(rows, full);
  return { rows };
}

export default function PriceChart({ rows, naive = false, height = 340, horizonLabel, compact = false }) {
  const [ref, width] = useWidth();
  const [hover, setHover] = useState(null);
  const now = rows.find(r => r.isNow);
  const last = rows[rows.length - 1];
  const points = useMemo(() => rows.filter(r => !r.gap), [rows]);

  const arr = useMemo(() => {
    const vals = rows.filter(r => !r.future && r.arrivals != null).map(r => r.arrivals);
    if (!vals.length) return null;
    const sorted = [...vals].sort((a, b) => a - b);
    return { median: sorted[Math.floor(sorted.length / 2)], ...niceTicks(0, Math.max(...vals), 2) };
  }, [rows]);
  const { domain, ticks } = useMemo(() => {
    const vals = rows.flatMap(r => [r.price, r.lastYear, r.p50, ...(r.band ?? []), ...(r.season ?? [])]).filter(v => v != null);
    return niceTicks(Math.min(...vals), Math.max(...vals));
  }, [rows]);

  const m = compact ? { l: 46, r: 66, t: 30, b: 24 } : { l: 64, r: 104, t: 30, b: 24 };
  const arrH = arr ? (compact ? 72 : 96) : 0;
  const arrTop = height + 40;                     // the arrivals panel starts under the price axis and its title
  const total = arr ? arrTop + arrH + m.b : height;
  const pw = Math.max(10, width - m.l - m.r), ph = height - m.t - m.b;
  const t0 = rows[0]?.t ?? 0, t1 = last?.t ?? 1;
  const x = t => m.l + ((t - t0) / (t1 - t0 || 1)) * pw;
  const y = v => m.t + (1 - (v - domain[0]) / (domain[1] - domain[0] || 1)) * ph;
  const ya = v => arrTop + (1 - v / (arr?.domain[1] || 1)) * arrH;
  const yTicks = ticks ?? [];
  const fmtY = axisRupeesFor(yTicks.length ? yTicks : [domain[1]]);
  const xTicks = monthTicks(t0, t1, compact ? 4 : 8);
  const barW = Math.max(1.5, Math.min(8, (pw / Math.max(1, points.length)) * 0.6));

  // nearest week to the pointer (rows are sorted by time)
  const onMove = e => {
    const box = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - box.left) / box.width) * width;
    if (px < m.l - 8 || px > m.l + pw + 8) { setHover(null); return; }
    const t = t0 + ((px - m.l) / pw) * (t1 - t0);
    let best = points[0];
    for (const r of points) if (Math.abs(r.t - t) < Math.abs(best.t - t)) best = r;
    setHover(h => (h === best ? h : best));
  };

  const summary = now ? `Price ${rupees(now.price)} in the latest week${last?.future && !naive ? `, forecast ${rupees(last.p50)} ${horizonLabel ?? ''}` : ''}.`
    : 'Weekly price chart.';
  const tipLeft = hover ? x(hover.t) : 0;

  return (
    <div className="pchart" ref={ref}>
      <svg width={width} height={total} viewBox={`0 0 ${width} ${total}`} role="img" aria-label={summary}
        onPointerMove={onMove} onPointerDown={onMove} onPointerLeave={() => setHover(null)}>
        {/* grid and axes */}
        {yTicks.map(v => (
          <g key={v}>
            <line x1={m.l} x2={m.l + pw} y1={y(v)} y2={y(v)} stroke={C.grid} />
            <text x={m.l - 8} y={y(v)} dy="0.32em" textAnchor="end" className="ax">{fmtY(v)}</text>
          </g>
        ))}
        {xTicks.map(k => <text key={k.t} x={x(k.t)} y={height - 6} textAnchor="middle" className="ax">{k.label}</text>)}

        {/* weeks with no reports, and the forecast zone */}
        {rows.filter(r => r.gap).map(r => (
          <g key={r.t}>
            <rect x={x(r.gap[0])} y={m.t} width={Math.max(0, x(r.gap[1]) - x(r.gap[0]))} height={ph} fill={C.ctx} opacity={0.1} />
            {x(r.gap[1]) - x(r.gap[0]) > 90 && <text x={(x(r.gap[0]) + x(r.gap[1])) / 2} y={m.t + 14} textAnchor="middle" className="ax">
              No reports for {Math.round((r.gap[1] - r.gap[0]) / (7 * DAY))} weeks</text>}
          </g>
        ))}
        {now && last.t > now.t && <>
          <rect x={x(now.t)} y={m.t} width={x(last.t) - x(now.t)} height={ph} fill={C.fc} opacity={0.05} />
          <text x={x(now.t) + 6} y={m.t - 8} className="ax">{naive ? 'Next 4 weeks' : 'Forecast'}</text>
        </>}

        {/* context first, then the range, then the lines on top */}
        <path d={bandPath(rows, x, y, r => r.season)} fill={C.ctx} opacity={0.16} />
        <path d={linePath(rows, x, y, r => r.lastYear, true)} fill="none" stroke={C.ctx} strokeWidth={2} />
        <path d={bandPath(rows, x, y, r => r.band)} fill={C.fc} opacity={0.24} />
        <path d={linePath(rows, x, y, r => r.price)} fill="none" stroke={C.ink} strokeWidth={2} strokeLinejoin="round" />
        {!naive && <path d={linePath(rows, x, y, r => r.p50, true)} fill="none" stroke={C.fc} strokeWidth={2} strokeDasharray="5 4" />}
        {!naive && rows.filter(r => r.future).map(r => (
          <circle key={r.t} cx={x(r.t)} cy={y(r.p50)} r={3.5} fill={C.fc} stroke={C.surface} strokeWidth={2} />
        ))}

        {/* today and the furthest forecast, labelled directly */}
        {now && <>
          <line x1={x(now.t)} x2={x(now.t)} y1={m.t} y2={m.t + ph} stroke={C.axis} />
          <circle cx={x(now.t)} cy={y(now.price)} r={5} fill={C.ink} stroke={C.surface} strokeWidth={2} />
          <text x={x(now.t) - 8} y={m.t - 8} textAnchor="end" style={halo}>
            <tspan fontSize={13} fontWeight={700} fill={C.ink}>{rupees(now.price)}</tspan>
            {!compact && <tspan dx={6} className="ax">latest week</tspan>}
          </text>
        </>}
        {last?.future && (
          <text x={x(last.t) + 10} y={y(naive ? now?.price ?? last.band[0] : last.p50)} style={halo}>
            <tspan x={x(last.t) + 10} dy="-0.2em" fontSize={13} fontWeight={700} fill={C.ink}>
              {naive ? `${compactRupees(last.band[0])}–${compactRupees(last.band[1])}` : rupees(last.p50)}</tspan>
            <tspan x={x(last.t) + 10} dy="1.25em" className="ax">{horizonLabel}</tspan>
          </text>
        )}

        {/* arrivals under the price, same time axis */}
        {arr && <g>
          <text x={m.l} y={arrTop - 12} className="ax-title">Arrivals, tonnes per week
            {!compact && <tspan className="ax" dx={8}>darker bars are heavier than usual, which tends to push prices down</tspan>}</text>
          {arr.ticks?.map(v => (
            <g key={v}>
              <line x1={m.l} x2={m.l + pw} y1={ya(v)} y2={ya(v)} stroke={C.grid} />
              <text x={m.l - 8} y={ya(v)} dy="0.32em" textAnchor="end" className="ax">
                {v >= 1000 ? `${(v / 1000).toLocaleString('en-IN')}k t` : `${v} t`}</text>
            </g>
          ))}
          {points.filter(r => !r.future && r.arrivals != null).map(r => (
            <rect key={r.t} x={x(r.t) - barW / 2} y={ya(r.arrivals)} width={barW} height={Math.max(0, arrTop + arrH - ya(r.arrivals))}
              rx={Math.min(2, barW / 2)} fill={r.arrivals > arr.median * 1.3 ? T.arrivalsHeavy : T.arrivals} />
          ))}
          <line x1={m.l} x2={m.l + pw} y1={ya(arr.median)} y2={ya(arr.median)} stroke={C.axis} />
          <text x={m.l + pw + 6} y={ya(arr.median)} dy="0.32em" className="ax">typical</text>
        </g>}

        {/* hover line through both panels */}
        {hover && <g pointerEvents="none">
          <line x1={x(hover.t)} x2={x(hover.t)} y1={m.t} y2={arr ? arrTop + arrH : m.t + ph} stroke={C.ink} strokeOpacity={0.35} />
          {hover.price != null && <circle cx={x(hover.t)} cy={y(hover.price)} r={4.5} fill={C.ink} stroke={C.surface} strokeWidth={2} />}
          {hover.future && !naive && <circle cx={x(hover.t)} cy={y(hover.p50)} r={4.5} fill={C.fc} stroke={C.surface} strokeWidth={2} />}
        </g>}
      </svg>
      {hover && (
        <div className="chart-tip pchart-tip" style={tipLeft > m.l + pw / 2 ? { right: width - tipLeft + 14 } : { left: tipLeft + 14 }}>
          <Tip d={hover} naive={naive} median={arr?.median} />
        </div>
      )}
    </div>
  );
}

function Tip({ d, naive, median }) {
  const Row = ({ color, dash, value, label, band }) => (
    <div className="tip-row">
      <svg width="14" height="10" aria-hidden="true">{band
        ? <rect x="0" y="1" width="14" height="8" rx="2" fill={color} opacity={0.35} />
        : <line x1="0" y1="5" x2="14" y2="5" stroke={color} strokeWidth="2" strokeDasharray={dash} />}</svg>
      <strong className="num">{value}</strong><span>{label}</span>
    </div>
  );
  const heavy = median && d.arrivals != null ? (d.arrivals > median * 1.3 ? 'heavier than usual' : d.arrivals < median * 0.7 ? 'lighter than usual' : 'arrivals') : 'arrivals';
  return (
    <>
      <div className="tip-when">Week of {date(d.t)}{d.future ? ' (forecast)' : ''}</div>
      {d.price != null && <Row color={C.ink} value={rupees(d.price)} label={d.wow != null ? `${pct(d.wow)} vs previous` : 'price'} />}
      {d.p50 != null && !d.isNow && !naive && <Row color={C.fc} dash="4 3" value={rupees(d.p50)} label="forecast" />}
      {d.band && !d.isNow && <Row band color={C.fc} value={`${rupees(d.band[0])} – ${rupees(d.band[1])}`} label={naive ? 'usual range' : 'likely range'} />}
      {d.lastYear != null && <Row color={C.ctx} value={rupees(d.lastYear)} label="a year earlier" />}
      {d.season && <Row band color={C.ctx} value={`${rupees(d.season[0])} – ${rupees(d.season[1])}`} label={`usual in ${seasonWord(d.t)}`} />}
      {d.arrivals != null && !d.future && <Row color={T.arrivalsHeavy} value={`${Math.round(d.arrivals).toLocaleString('en-IN')} t`} label={heavy} />}
    </>
  );
}

// The same numbers as a table, for screen readers and anyone who prefers rows to lines.
export function ChartTable({ rows, naive }) {
  const list = rows.filter(r => !r.gap).reverse().slice(0, 30);
  const season = rows.some(r => r.season), arrivals = rows.some(r => r.arrivals != null);
  return (
    <div className="table-wrap" style={{ maxHeight: 340 }}>
      <table className="table">
        <thead><tr><th>Week of</th><th className="r">Price</th><th className="r">Change</th>
          <th className="r">{naive ? 'Usual range' : 'Forecast (likely range)'}</th>{season && <th className="r">Usual for the season</th>}
          {arrivals && <th className="r">Arrivals</th>}</tr></thead>
        <tbody>{list.map(r => (
          <tr key={r.t}>
            <td className="num">{date(r.t)}</td>
            <td className="r num">{r.price != null ? rupees(r.price) : '–'}</td>
            <td className="r num">{r.wow != null ? pct(r.wow) : '–'}</td>
            <td className="r num">{r.band && !r.isNow ? `${naive ? '' : `${rupees(r.p50)} (`}${rupees(r.band[0])} – ${rupees(r.band[1])}${naive ? '' : ')'}` : '–'}</td>
            {season && <td className="r num">{r.season ? `${rupees(r.season[0])} – ${rupees(r.season[1])}` : '–'}</td>}
            {arrivals && <td className="r num">{r.arrivals != null ? `${Math.round(r.arrivals).toLocaleString('en-IN')} t` : '–'}</td>}
          </tr>
        ))}</tbody>
      </table>
    </div>
  );
}
