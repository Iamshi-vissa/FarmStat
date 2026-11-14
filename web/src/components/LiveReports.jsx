import { useEffect, useState } from 'react';
import { Area, ComposedChart, CartesianGrid, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Radio } from 'lucide-react';
import Delta from './Delta.jsx';
import { niceTicks } from '../stats.js';
import { api } from '../api.js';
import { compactRupees, date, placeName, rupees } from '../format.js';
import { T } from '../theme.js';

const AXIS = { fontSize: 12, fill: T.ink3 };
const DAY = 864e5;
const short = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short' });

// The mandi's own daily reports from the live feed (Agmarknet via data.gov.in, stored in Supabase three times a
// day): latest modal price, the day's min-max spread, change since the previous report, and the last 45 days.
export default function LiveReports({ crop, state, market, narrow }) {
  const [live, setLive] = useState(null);
  useEffect(() => {
    let on = true;
    setLive(null);
    api('live', { crop, state, market }).then(d => on && setLive(d))
      .catch(() => on && setLive({ available: false, reason: 'live feed unreachable' }));
    return () => { on = false; };
  }, [crop, state, market]);

  if (!live) return null;
  if (!live.available) {
    return (
      <p className="live-note"><Radio size={14} aria-hidden="true" />
        <span>{/unreachable/.test(live.reason ?? '')
          ? 'The live daily feed couldn’t be reached just now, so this page shows the weekly data only.'
          : `No daily reports from ${placeName(market)} in the live feed yet. FarmStat checks data.gov.in three times a day.`}</span></p>
    );
  }
  const days = live.days.map(d => ({ ...d, t: new Date(d.date).getTime(), range: d.min != null && d.max != null ? [d.min, d.max] : null }));
  const L = days[days.length - 1];
  const prev = days.length > 1 ? days[days.length - 2] : null;
  const spread = L.range ? (L.range[1] - L.range[0]) / L.modal : null;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const ageDays = Math.round((today - new Date(`${L.date}T00:00:00`)) / DAY);   // calendar days, local time
  const { domain, ticks } = niceTicks(Math.min(...days.flatMap(d => d.range ?? [d.modal])), Math.max(...days.flatMap(d => d.range ?? [d.modal])), 4);

  return (
    <section className="panel live-panel" aria-labelledby="live-title">
      <div className="panel-head"><div>
        <h2 id="live-title"><span className="live-dot" aria-hidden="true" />Daily reports from {placeName(market)}</h2>
        <p className="sub">Live from Agmarknet (data.gov.in), collected into FarmStat’s cloud store three times a day. The
          weekly forecast above is rebuilt from these every evening.</p>
      </div></div>
      <div className="mini-stats">
        <div className="mini">
          <div className="mini-label">Latest report</div>
          <div className="mini-value">{rupees(L.modal)}</div>
          <div className="mini-note">{date(L.date)}{ageDays <= 0 ? ', today' : ageDays === 1 ? ', yesterday' : `, ${ageDays} days ago`}</div>
        </div>
        <div className="mini">
          <div className="mini-label">That day’s spread</div>
          <div className="mini-value">{L.range ? `${compactRupees(L.range[0])} – ${compactRupees(L.range[1])}` : '–'}</div>
          <div className="mini-note">{spread != null ? `Lowest to highest lot: ${Math.round(spread * 100)}% of the modal price` : 'Only one price reported'}</div>
        </div>
        <div className="mini">
          <div className="mini-label">Since the previous report</div>
          <div className="mini-value">{prev ? <Delta value={L.modal / prev.modal - 1} big /> : '–'}</div>
          <div className="mini-note">{prev ? `${rupees(prev.modal)} on ${date(prev.date)}` : 'First live report'}</div>
        </div>
        <div className="mini">
          <div className="mini-label">Reports in the feed</div>
          <div className="mini-value">{days.length}</div>
          <div className="mini-note">{L.varieties > 1 ? `${L.varieties} varieties or grades on the latest day; median shown` : 'Days with a price, last 45 days'}</div>
        </div>
      </div>
      {days.length >= 2 && (
        <figure className="stat-chart stat-chart-gap">
          <figcaption><b>Last {days.length} reports</b><span>Modal price (line) and the day’s lowest to highest lot (band).</span></figcaption>
          <ResponsiveContainer width="100%" height={narrow ? 170 : 200}>
            <ComposedChart data={days} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
              <CartesianGrid stroke={T.grid} vertical={false} />
              <XAxis dataKey="t" type="number" scale="time" domain={['dataMin', 'dataMax']} tick={AXIS} tickLine={false}
                axisLine={false} tickFormatter={t => short.format(new Date(t))} minTickGap={36} />
              <YAxis domain={domain} ticks={ticks} tick={AXIS} tickLine={false} axisLine={false} width={narrow ? 44 : 56}
                tickFormatter={compactRupees} />
              <Area dataKey="range" stroke="none" fill={T.forest} fillOpacity={0.14} isAnimationActive={false} activeDot={false} connectNulls />
              <Line dataKey="modal" stroke={T.ink} strokeWidth={2} dot={{ r: 2.5, fill: T.ink, strokeWidth: 0 }}
                isAnimationActive={false} activeDot={{ r: 4, stroke: T.panel, strokeWidth: 2 }} />
              <Tooltip isAnimationActive={false} cursor={{ stroke: T.ink3, strokeDasharray: '3 3' }}
                content={({ active, payload }) => active && payload?.[0] ? (
                  <div className="chart-tip"><div className="tip-when">{date(payload[0].payload.date)}</div>
                    <div className="tip-row"><strong>{rupees(payload[0].payload.modal)}</strong><span>modal</span></div>
                    {payload[0].payload.range && <div className="tip-row"><strong>{rupees(payload[0].payload.range[0])} – {rupees(payload[0].payload.range[1])}</strong><span>lowest to highest</span></div>}
                  </div>) : null} />
            </ComposedChart>
          </ResponsiveContainer>
        </figure>
      )}
    </section>
  );
}
