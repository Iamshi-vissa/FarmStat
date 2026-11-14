import { useMemo } from 'react';
import { Bar, BarChart, CartesianGrid, Cell, LabelList, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import Delta from './Delta.jsx';
import { priceStats } from '../stats.js';
import { compactRupees, pct, pct0, placeName, rupees } from '../format.js';
import { T } from '../theme.js';

const AXIS = { fontSize: 12, fill: T.ink3 };

// Price statistics for one mandi: where today's price sits, how it compares with last year, how much prices
// usually move, what happened in the same weeks of earlier years, the seasonal pattern and the price distribution.
export default function PriceStats({ crop, market, data }) {
  const L = data.latest;
  const s = useMemo(() => priceStats(data.history, L.week, L.price), [data, L.week, L.price]);
  if (!s) return null;
  const pos = s.hi > s.lo ? (L.price - s.lo) / (s.hi - s.lo) : 0.5;

  return (
    <section className="panel" aria-labelledby="stats-title">
      <div className="panel-head"><div>
        <h2 id="stats-title">Price statistics</h2>
        <p className="sub">How this week’s {crop.toLowerCase()} price at {placeName(market)} compares with its own history. Context for the
          forecast, worked out from past prices only.</p>
      </div></div>

      <div className="mini-stats">
        <div className="mini">
          <div className="mini-label">52-week range</div>
          <div className="mini-value">{compactRupees(s.lo)} – {compactRupees(s.hi)}</div>
          <div className="range52" role="img" aria-label={`Today ${rupees(L.price)}, ${pct0(pos)} of the way from low to high`}>
            <span className="range52-track" /><span className="range52-dot" style={{ left: `${pos * 100}%` }} />
          </div>
          <div className="mini-note">Higher than {pct0(s.rank)} of the past year’s weeks</div>
        </div>
        <div className="mini">
          <div className="mini-label">vs same week last year</div>
          <div className="mini-value">{s.yoy == null ? '–' : <Delta value={s.yoy} big />}</div>
          <div className="mini-note">{s.yearAgo ? `It was ${rupees(s.yearAgo)} a year ago` : 'No report a year ago'}</div>
        </div>
        <div className="mini">
          <div className="mini-label">Typical weekly move</div>
          <div className="mini-value">{s.typicalMove == null ? '–' : `±${(s.typicalMove * 100).toFixed(1)}%`}</div>
          <div className="mini-note">Median change from one week to the next, last 6 months</div>
        </div>
        <div className="mini">
          <div className="mini-label">Same 4 weeks in past years</div>
          <div className="mini-value">{s.seasonal4w ? <Delta value={s.seasonal4w.median} big /> : '–'}</div>
          <div className="mini-note">{s.seasonal4w
            ? `Median of ${s.seasonal4w.years.length} years; from ${pct(s.seasonal4w.min, 0)} to ${pct(s.seasonal4w.max, 0)}`
            : 'Needs at least 2 earlier years'}</div>
        </div>
      </div>

      <div className="stat-charts">
        {s.season && (
          <figure className="stat-chart">
            <figcaption><b>Seasonal pattern</b><span>Each month vs that year’s average, median of {s.yearsUsed} years.
              {' '}{s.currentMonth} is this month.</span></figcaption>
            <ResponsiveContainer width="100%" height={210}>
              <BarChart data={s.season} margin={{ top: 18, right: 4, bottom: 0, left: 0 }} barCategoryGap={3}>
                <CartesianGrid stroke={T.grid} vertical={false} />
                <XAxis dataKey="month" tick={AXIS} tickLine={false} axisLine={false} interval={0}
                  tickFormatter={m => m.slice(0, 1)} />
                <YAxis tick={AXIS} tickLine={false} axisLine={false} width={40} tickFormatter={v => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v)}%`} />
                <ReferenceLine y={0} stroke={T.context} />
                <Tooltip cursor={{ fill: 'rgba(22,24,19,0.05)' }} isAnimationActive={false}
                  content={({ active, payload }) => active && payload?.[0] ? (
                    <div className="chart-tip"><div className="tip-when">{payload[0].payload.month}, {payload[0].payload.years} years</div>
                      <div className="tip-row"><strong>{pct(payload[0].value / 100, 0)}</strong>
                        <span>vs the year’s average</span></div></div>) : null} />
                <Bar dataKey="pct" maxBarSize={20} isAnimationActive={false}>
                  {s.season.map(d => (
                    <Cell key={d.month} fill={d.pct >= 0 ? T.forecast : T.drop} fillOpacity={d.month === s.currentMonth ? 1 : 0.55}
                      radius={d.pct >= 0 ? [3, 3, 0, 0] : [0, 0, 3, 3]} />
                  ))}
                  <LabelList dataKey="month" content={({ x, y, width, height, value }) => value === s.currentMonth ? (
                    <text x={x + width / 2} y={height >= 0 ? y - 6 : y + 14} textAnchor="middle" fontSize={11} fontWeight={600} fill={T.ink}>now</text>
                  ) : null} />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </figure>
        )}
        <figure className="stat-chart">
          <figcaption><b>Where this week’s price sits</b><span>Weekly prices over the last 3 years ({s.distWeeks} weeks). This
            week is higher than {pct0(s.distRank)} of them.</span></figcaption>
          <ResponsiveContainer width="100%" height={210}>
            <BarChart data={s.bins} margin={{ top: 18, right: 4, bottom: 0, left: 0 }} barCategoryGap={1}>
              <CartesianGrid stroke={T.grid} vertical={false} />
              <XAxis dataKey="from" tick={AXIS} tickLine={false} axisLine={false} interval="preserveStartEnd" minTickGap={24}
                tickFormatter={compactRupees} />
              <YAxis tick={AXIS} tickLine={false} axisLine={false} width={40} allowDecimals={false} />
              <Tooltip cursor={{ fill: 'rgba(22,24,19,0.05)' }} isAnimationActive={false}
                content={({ active, payload }) => active && payload?.[0] ? (
                  <div className="chart-tip"><div className="tip-when">{rupees(payload[0].payload.from)} – {rupees(payload[0].payload.to)}</div>
                    <div className="tip-row"><strong>{payload[0].value} weeks</strong>
                      <span>{payload[0].payload.today ? 'includes this week' : ''}</span></div></div>) : null} />
              <Bar dataKey="n" isAnimationActive={false} radius={[3, 3, 0, 0]}>
                {s.bins.map(b => <Cell key={b.from} fill={b.today ? T.forest : T.arrivals} />)}
                <LabelList dataKey="today" content={({ x, y, width, value }) => value ? (
                  <text x={x + width / 2} y={y - 6} textAnchor="middle" fontSize={11} fontWeight={600} fill={T.forest}>this week</text>
                ) : null} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </figure>
      </div>
    </section>
  );
}
