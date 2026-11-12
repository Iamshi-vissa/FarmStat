import { useMemo } from 'react';
import {
  Area, Bar, BarChart, CartesianGrid, Cell, ComposedChart, Line, ReferenceArea, ReferenceDot, ReferenceLine,
  ResponsiveContainer, Tooltip, XAxis, YAxis
} from 'recharts';
import { compactRupees, date, monthLabel, rupees } from '../format.js';
import { T } from '../theme.js';

// Chart tokens (validated pair: ink for actual price, blue for forecast; grey for context)
const C = { ink: T.ink, fc: T.forecast, ctx: T.context, grid: T.grid, axis: T.ink3, surface: T.panel };
const AXIS = { fontSize: 12, fill: C.axis };
const MARGIN = { top: 26, right: 112, bottom: 4, left: 4 };
const MARGIN_COMPACT = { top: 26, right: 70, bottom: 4, left: 0 };
const Y_WIDTH = 64;
const Y_WIDTH_COMPACT = 50;
const DAY = 864e5;
const ts = s => new Date(s).getTime();

// Round, evenly spaced y-ticks (1 / 2 / 2.5 / 5 × 10^k)
export function niceTicks(lo, hi, count = 5) {
  if (!(hi > lo)) return { domain: [lo * 0.9, hi * 1.1 || 1], ticks: undefined };
  const raw = (hi - lo) / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map(m => m * mag).find(s => s >= raw);
  const start = Math.floor(lo / step) * step, end = Math.ceil(hi / step) * step;
  const ticks = [];
  for (let v = start; v <= end + step / 2; v += step) ticks.push(Math.round(v));
  return { domain: [start, end], ticks };
}

// One tick per month (or every 2/3/6/12 months on long ranges), labelled "Mar", with the year on January and the first tick.
export function monthTicks(t0, t1, maxTicks = 8) {
  const start = new Date(t0); start.setDate(1); start.setHours(0, 0, 0, 0);
  if (start.getTime() < t0) start.setMonth(start.getMonth() + 1);
  const all = [];
  for (const d = new Date(start); d.getTime() <= t1; d.setMonth(d.getMonth() + 1)) all.push(d.getTime());
  const step = [1, 2, 3, 6, 12, 24].find(k => all.length / k <= maxTicks) ?? 24;
  const ticks = all.filter(t => step === 1 || (new Date(t).getMonth() % Math.min(step, 12) === 0
    && (step < 24 || new Date(t).getFullYear() % 2 === 0)));
  ticks.yearly = step >= 12;
  return ticks;
}
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const monthTickFor = ticks => (t, i) => {
  const d = new Date(t);
  if (ticks.yearly) return String(d.getFullYear());
  return d.getMonth() === 0 || i === 0 ? `${MONTHS[d.getMonth()]} ${d.getFullYear()}` : MONTHS[d.getMonth()];
};

// One number style per axis: all in lakh, all in thousands, or all in full.
export const axisRupeesFor = ticks => {
  const max = Math.max(...(ticks ?? [0]));
  if (max >= 100000) return v => `₹${(v / 100000).toLocaleString('en-IN', { maximumFractionDigits: 2 })}L`;
  if (max >= 10000) return v => `₹${(v / 1000).toLocaleString('en-IN', { maximumFractionDigits: 1 })}k`;
  return v => `₹${v.toLocaleString('en-IN')}`;
};

// Text on the plot gets a surface-coloured halo so it stays legible over lines and the band.
function EndLabel({ viewBox, lines, align = 'start' }) {
  if (!viewBox) return null;
  const x = viewBox.x + (align === 'start' ? 10 : -10);
  return (
    <text x={x} y={viewBox.y} textAnchor={align} dominantBaseline="middle" style={{ paintOrder: 'stroke' }}
      stroke={C.surface} strokeWidth={4} strokeLinejoin="round">
      {lines.map((l, i) => (
        <tspan key={i} x={x} dy={i === 0 ? (lines.length > 1 ? '-0.55em' : 0) : '1.2em'}
          fontSize={i === 0 ? 13 : 11} fontWeight={i === 0 ? 600 : 400} fill={i === 0 ? C.ink : C.axis}>{l}</tspan>
      ))}
    </text>
  );
}

// Label at the top of a vertical reference line, right-aligned to it.
function TopLabel({ viewBox, lines }) {
  if (!viewBox) return null;
  const x = viewBox.x - 8, y = viewBox.y - 14;
  return (
    <text x={x} y={y} textAnchor="end" style={{ paintOrder: 'stroke' }} stroke={C.surface} strokeWidth={4} strokeLinejoin="round">
      <tspan fontSize={13} fontWeight={600} fill={C.ink}>{lines[0]}</tspan>
      <tspan dx={6} fontSize={11} fill={C.axis}>{lines[1]}</tspan>
    </text>
  );
}

function Tip({ active, payload, period, naive }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  const when = period === 'month' ? monthLabel(d.t) : `Week of ${date(d.t)}`;
  const Row = ({ color, dash, value, label }) => (
    <div className="tip-row">
      <svg width="14" height="8" aria-hidden="true"><line x1="0" y1="4" x2="14" y2="4" stroke={color} strokeWidth="2" strokeDasharray={dash} /></svg>
      <strong className="num">{value}</strong><span>{label}</span>
    </div>
  );
  return (
    <div className="chart-tip">
      <div className="tip-when">{when}{d.future ? ' (forecast)' : ''}{d.gap ? ' (no reports)' : ''}</div>
      {d.price != null && <Row color={C.ink} value={rupees(d.price)} label={d.wow != null ? `${d.wow >= 0 ? '+' : ''}${(d.wow * 100).toFixed(1)}% vs previous` : 'price'} />}
      {d.p50 != null && !d.isNow && !naive && <Row color={C.fc} dash="4 3" value={rupees(d.p50)} label="forecast" />}
      {d.band && !d.isNow && <Row color="rgba(42,120,214,0.35)" value={`${rupees(d.band[0])} – ${rupees(d.band[1])}`} label={naive ? 'usual range' : 'likely range'} />}
      {d.lastYear != null && <Row color={C.ctx} value={rupees(d.lastYear)} label="a year earlier" />}
      {d.season && <Row color="rgba(163,166,158,0.6)" value={`${rupees(d.season[0])} – ${rupees(d.season[1])}`} label={`usual in ${seasonWord(d.t, period)}`} />}
    </div>
  );
}

const seasonWord = (t, period) => period === 'month' ? 'this month'
  : `${['early', 'mid', 'late'][Math.min(2, Math.floor((new Date(t).getDate() - 1) / 10))]} ${new Date(t).toLocaleString('en-IN', { month: 'short' })}`;

// Seasonal context: for each date, the 10th-90th percentile of prices in the same weeks (±1) of the previous
// 5 years. Needs at least 3 such weeks.
function seasonalBands(rows, full, dateKey, period) {
  const pts = full.filter(h => h.price != null).map(h => {
    const d = new Date(h[dateKey]);
    return { y: d.getFullYear(), k: period === 'month' ? d.getMonth() : Math.floor((d - new Date(d.getFullYear(), 0, 1)) / (7 * DAY)), p: h.price };
  });
  const span = period === 'month' ? 0 : 1, wrap = period === 'month' ? 12 : 52;
  const cache = new Map();
  rows.forEach(r => {
    const d = new Date(r.t), y = d.getFullYear();
    const k = period === 'month' ? d.getMonth() : Math.floor((d - new Date(y, 0, 1)) / (7 * DAY));
    const key = `${y}-${k}`;
    if (!cache.has(key)) {
      const near = pts.filter(x => x.y < y && x.y >= y - 5 && Math.min(Math.abs(x.k - k), wrap - Math.abs(x.k - k)) <= span)
        .map(x => x.p).sort((a, b) => a - b);
      const q = f => near[Math.min(near.length - 1, Math.max(0, Math.round((near.length - 1) * f)))];
      cache.set(key, near.length >= 3 ? [q(0.1), q(0.9)] : null);
    }
    r.season = cache.get(key);
  });
}

export function buildRows({ history, full = history, forecast, naive, dateKey = 'week', showLastYear, showSeason }) {
  const period = dateKey === 'month' ? 'month' : 'week';
  const byT = new Map(full.map(h => [ts(h[dateKey]), h.price]));
  const shift = t => {   // same period one year earlier
    if (period === 'month') { const d = new Date(t); d.setFullYear(d.getFullYear() - 1); return d.getTime(); }
    return t - 364 * DAY;
  };
  const rows = history.map((h, i) => {
    const t = ts(h[dateKey]);
    const prev = history[i - 1]?.price;
    return { t, price: h.price, wow: prev ? h.price / prev - 1 : null, arrivals: h.arrivals_t ?? null };
  });
  forecast.forEach(f => {
    const t = ts(f[dateKey]);
    let row = rows.find(r => r.t === t);
    if (!row) { row = { t, future: true }; rows.push(row); }
    Object.assign(row, { p50: f.p50, band: [f.p10, f.p90], isNow: f.h === 0 });
  });
  if (showLastYear) rows.forEach(r => { r.lastYear = byT.get(shift(r.t)) ?? null; });
  // break the line where reports stop for more than 3 weeks (or 2 months), instead of drawing a straight bridge
  const maxGap = (period === 'month' ? 62 : 21) * DAY;
  const real = rows.filter(r => r.price != null).sort((a, b) => a.t - b.t);
  for (let i = 1; i < real.length; i++) {
    if (real[i].t - real[i - 1].t > maxGap) rows.push({ t: (real[i].t + real[i - 1].t) / 2, gap: [real[i - 1].t, real[i].t] });
  }
  rows.sort((a, b) => a.t - b.t);
  if (showSeason) seasonalBands(rows, full, dateKey, period);
  return { rows, period };
}

// Price history (ink + soft wash), forecast median (blue dashed), likely range (blue band) in a shaded forecast zone,
// optional "same weeks last year" context line, and direct labels for today's price and the furthest forecast.
export default function PriceChart({ rows, period = 'week', naive = false, height = 340, syncId, horizonLabel, compact = false }) {
  const now = rows.find(r => r.isNow);
  const last = rows[rows.length - 1];
  const { domain, ticks } = useMemo(() => {
    const vals = rows.flatMap(r => [r.price, r.lastYear, ...(r.band ?? []), ...(r.season ?? [])]).filter(v => v != null);
    return niceTicks(Math.min(...vals), Math.max(...vals));
  }, [rows]);
  const xDomain = [rows[0]?.t, last?.t];
  const xt = monthTicks(...xDomain, compact ? 4 : period === 'month' ? 6 : 8);

  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart data={rows} margin={compact ? MARGIN_COMPACT : MARGIN} syncId={syncId}>
        <defs>
          <linearGradient id="priceWash" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={C.ink} stopOpacity={0.1} />
            <stop offset="100%" stopColor={C.ink} stopOpacity={0} />
          </linearGradient>
        </defs>
        {rows.filter(r => r.gap).map(r => (
          <ReferenceArea key={r.t} x1={r.gap[0]} x2={r.gap[1]} fill={C.ctx} fillOpacity={0.08} stroke="none" ifOverflow="hidden"
            label={{ value: `No reports for ${Math.round((r.gap[1] - r.gap[0]) / (7 * DAY))} weeks`, position: 'insideTop', fontSize: 11, fill: C.axis }} />
        ))}
        {now && last && last.t > now.t && (
          <ReferenceArea x1={now.t} x2={last.t} fill={C.fc} fillOpacity={0.05} stroke="none" ifOverflow="visible"
            label={{ value: naive ? 'Next 4 weeks' : 'Forecast', position: 'insideTopLeft', dx: 6, dy: -20, fontSize: 11, fill: C.axis }} />
        )}
        <CartesianGrid stroke={C.grid} vertical={false} />
        <XAxis dataKey="t" type="number" scale="time" domain={xDomain} ticks={xt} tickFormatter={monthTickFor(xt)}
          tick={AXIS} tickLine={false} axisLine={{ stroke: C.grid }} interval={0} />
        <YAxis domain={domain} ticks={ticks} tickFormatter={axisRupeesFor(ticks)} tick={AXIS} tickLine={false} axisLine={false}
          width={compact ? Y_WIDTH_COMPACT : Y_WIDTH} allowDataOverflow />
        <Tooltip content={<Tip period={period} naive={naive} />} cursor={{ stroke: C.axis, strokeWidth: 1 }} isAnimationActive={false} />
        <Area dataKey="season" stroke={C.ctx} strokeOpacity={0.35} strokeDasharray="2 3" fill={C.ctx} fillOpacity={0.14}
          isAnimationActive={false} connectNulls activeDot={false} />
        <Area dataKey="price" stroke="none" fill="url(#priceWash)" isAnimationActive={false} connectNulls={false} activeDot={false} />
        <Line dataKey="lastYear" stroke={C.ctx} strokeWidth={2} dot={false} isAnimationActive={false} connectNulls activeDot={false} />
        <Area dataKey="band" stroke="none" fill={C.fc} fillOpacity={0.16} isAnimationActive={false} connectNulls activeDot={false} />
        <Line dataKey="price" stroke={C.ink} strokeWidth={2} dot={false} isAnimationActive={false} connectNulls={false}
          activeDot={{ r: 4.5, fill: C.ink, stroke: C.surface, strokeWidth: 2 }} />
        {!naive && (
          <Line dataKey="p50" stroke={C.fc} strokeWidth={2} strokeDasharray="5 4" connectNulls isAnimationActive={false}
            dot={{ r: 4, fill: C.fc, stroke: C.surface, strokeWidth: 2 }} activeDot={{ r: 5, stroke: C.surface, strokeWidth: 2 }} />
        )}
        {now && (
          <ReferenceLine x={now.t} stroke={C.axis} strokeWidth={1}
            label={<TopLabel lines={[rupees(now.price), compact ? '' : period === 'month' ? 'latest month' : 'latest week']} />} />
        )}
        {now && <ReferenceDot x={now.t} y={now.price} r={5} fill={C.ink} stroke={C.surface} strokeWidth={2} ifOverflow="visible" />}
        {last && last.future && (
          <ReferenceDot x={last.t} y={naive ? now?.price : last.p50} r={naive ? 0 : 5} fill={C.fc} stroke={C.surface}
            strokeWidth={2} ifOverflow="visible"
            label={<EndLabel lines={naive
              ? [`${compactRupees(last.band[0])}–${compactRupees(last.band[1])}`, horizonLabel ?? '']
              : [rupees(last.p50), horizonLabel ?? '']} />} />
        )}
      </ComposedChart>
    </ResponsiveContainer>
  );
}

// Arrivals as small bars under the price chart: same x-scale and margins, hover synced with the price chart.
export function ArrivalsChart({ rows, syncId, height = 130, compact = false }) {
  const data = rows.map(r => ({ t: r.t, arrivals: r.future ? null : r.arrivals }));
  if (!data.some(d => d.arrivals != null)) return null;
  const vals = data.map(d => d.arrivals).filter(v => v != null);
  const sorted = [...vals].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  const { ticks, domain } = niceTicks(0, Math.max(...vals), 2);
  const xa = monthTicks(data[0].t, data[data.length - 1].t, compact ? 4 : 8);
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ ...(compact ? MARGIN_COMPACT : MARGIN), top: 6 }} syncId={syncId} barCategoryGap={1}>
        <CartesianGrid stroke={C.grid} vertical={false} />
        <XAxis dataKey="t" type="number" scale="time" domain={[data[0].t, data[data.length - 1].t]}
          ticks={xa} tickFormatter={monthTickFor(xa)} interval={0}
          tick={AXIS} tickLine={false} axisLine={{ stroke: C.grid }} />
        <YAxis domain={domain} ticks={ticks} tick={AXIS} tickLine={false} axisLine={false} width={compact ? Y_WIDTH_COMPACT : Y_WIDTH}
          tickFormatter={v => (v >= 1000 ? `${(v / 1000).toLocaleString('en-IN')}k t` : `${v} t`)} />
        <Tooltip cursor={{ fill: 'rgba(22,24,19,0.06)' }} isAnimationActive={false}
          content={({ active, payload }) => active && payload?.[0]?.value != null ? (
            <div className="chart-tip"><div className="tip-when">Week of {date(payload[0].payload.t)}</div>
              <div className="tip-row"><strong className="num">{Math.round(payload[0].value).toLocaleString('en-IN')} t</strong>
                <span>{payload[0].value > median * 1.3 ? 'heavier than usual' : payload[0].value < median * 0.7 ? 'lighter than usual' : 'arrivals'}</span></div></div>
          ) : null} />
        <ReferenceLine y={median} stroke={C.axis} strokeDasharray="0" strokeWidth={1}
          label={{ value: 'typical', position: 'right', fontSize: 11, fill: C.axis }} />
        <Bar dataKey="arrivals" maxBarSize={8} radius={[3, 3, 0, 0]} isAnimationActive={false}>
          {data.map(d => <Cell key={d.t} fill={d.arrivals > median * 1.3 ? T.arrivalsHeavy : T.arrivals} />)}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

// The same numbers as a table, for screen readers and anyone who prefers rows to lines.
export function ChartTable({ rows, naive, period }) {
  const list = rows.filter(r => !r.gap).reverse().slice(0, 30);
  return (
    <div className="table-wrap" style={{ maxHeight: 340 }}>
      <table className="table">
        <thead><tr><th>{period === 'month' ? 'Month' : 'Week of'}</th><th className="r">Price</th><th className="r">Change</th>
          <th className="r">{naive ? 'Usual range' : 'Forecast (likely range)'}</th>{rows.some(r => r.season) && <th className="r">Usual for the season</th>}{rows.some(r => r.arrivals != null) && <th className="r">Arrivals</th>}</tr></thead>
        <tbody>{list.map(r => (
          <tr key={r.t}>
            <td className="num">{period === 'month' ? monthLabel(r.t) : date(r.t)}</td>
            <td className="r num">{r.price != null ? rupees(r.price) : '–'}</td>
            <td className="r num">{r.wow != null ? `${r.wow >= 0 ? '+' : ''}${(r.wow * 100).toFixed(1)}%` : '–'}</td>
            <td className="r num">{r.band && !r.isNow ? `${naive ? '' : `${rupees(r.p50)} (`}${rupees(r.band[0])} – ${rupees(r.band[1])}${naive ? '' : ')'}` : '–'}</td>
            {rows.some(x => x.season) && <td className="r num">{r.season ? `${rupees(r.season[0])} – ${rupees(r.season[1])}` : '–'}</td>}
            {rows.some(x => x.arrivals != null) && <td className="r num">{r.arrivals != null ? `${Math.round(r.arrivals).toLocaleString('en-IN')} t` : '–'}</td>}
          </tr>
        ))}</tbody>
      </table>
    </div>
  );
}
