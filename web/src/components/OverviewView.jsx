import { useEffect, useState } from 'react';
import { MousePointerClick, Search } from 'lucide-react';
import RateBoard from './RateBoard.jsx';
import SpotlightCard from './reactbits/SpotlightCard.jsx';
import Delta from './Delta.jsx';
import { MarketSkeleton } from './MarketView.jsx';
import { openSidePanel } from './Chrome.jsx';
import { api } from '../api.js';
import { date, pct, pct0, rupees, weeks } from '../format.js';
import { T } from '../theme.js';

// The first screen for a weekly crop, before any state or mandi is chosen: the crop across India this week.
// Every row is a way in (a state opens its mandi list, a mandi opens its page).
export default function OverviewView({ crop, onState, onPick }) {
  const [d, setD] = useState(null);
  const [err, setErr] = useState(null);
  useEffect(() => {
    let on = true;
    setD(null); setErr(null);
    api('overview', { crop }).then(x => on && setD(x)).catch(e => on && setErr(e.message));
    return () => { on = false; };
  }, [crop]);

  if (err) return <div className="callout warn">Couldn’t load the India overview: {err}</div>;
  if (!d) return <MarketSkeleton label={`Loading ${crop.toLowerCase()} across India`} />;

  const calls = d.calls ?? {};
  const pick = r => onPick(r.state, r.market);
  const chooseState = s => { onState(s); openSidePanel(); };
  const unit = crop === 'Arecanut' ? 'mandi-varieties' : 'mandis';
  return (
    <>
      <RateBoard title={`${crop} across India`} where={`Median of ${d.series.toLocaleString('en-IN')} ${unit} in ${d.states_count} states`}
        priceLabel={`week of ${date(d.week)}`} price={d.median} slipKey={`overview-${crop}`}
        advice={d.naive
          ? { action: 'Information', label: 'This week across India', headline: 'Today’s price is the best guide',
              detail: `No model beat “no change” for ${crop.toLowerCase()}, so mandi pages show the usual range of movement instead of a forecast.`,
              footnote: 'Choose a mandi to see its own range.' }
          : { action: 'Information', label: 'Calls across India',
              headline: `${calls.Hold ?? 0} mandis say hold, ${calls['Sell now'] ?? 0} say sell now`,
              detail: `${calls['Your call'] ?? 0} have no clear signal either way. Choose a mandi for its own call and the reasons behind it.`,
              chance: d.rise_share, chanceLabel: `Mandis likely to rise 5%+ in ${weeks(d.horizon)}`,
              footnote: 'Estimates, not guarantees.' }} />

      <p className="start-hint">
        <MousePointerClick size={16} aria-hidden="true" />
        <span>Pick a state below, <span className="wide-only">hover the bar on the left</span><span className="narrow-only">tap “Choose a mandi” at the top</span> to choose a mandi, or
          <button type="button" className="linklike" onClick={() => window.dispatchEvent(new Event('farmstat:search'))}>
            <Search size={14} aria-hidden="true" /> search all mandis</button>.</span>
      </p>

      <div className="kpis">
        <Kpi label="Median price this week" value={rupees(d.median)} trend={d.trend}
          note={d.median_prev ? <><Delta value={d.median / d.median_prev - 1} /> <span>vs last week ({rupees(d.median_prev)})</span></> : null} />
        <Kpi label="Compared with a year ago" value={d.median_year_ago ? pct(d.median / d.median_year_ago - 1, 0) : '–'}
          note={d.median_year_ago ? `Median was ${rupees(d.median_year_ago)} in the same week last year` : 'Not enough history a year back'} />
        <Kpi label={`Expected in ${weeks(d.horizon)}`} value={d.move == null ? 'No forecast' : pct(d.move)}
          note={d.move == null ? 'Shown as the usual range at each mandi' : 'Median expected change across mandis with a forecast'} />
        <Kpi label="Likely to rise 5% or more" value={d.rise_share == null ? '–' : pct0(d.rise_share)}
          note={d.rise_share == null ? 'No rise warning for this crop' : `Share of mandis where the chance is 50% or higher`} />
      </div>

      <section className="panel" aria-labelledby="states-title">
        <div className="panel-head"><div><h2 id="states-title">Prices by state</h2>
          <p className="sub">Median modal price of mandis that reported in the last 3 weeks. Select a state to see its mandis.</p></div></div>
        <StateBars rows={d.states} onPick={chooseState} />
      </section>

      {!d.naive && (
        <div className="grid-3">
          <MoverList title={`Likely to rise in ${weeks(d.horizon)}`} rows={d.rises} onPick={pick} />
          <MoverList title={`Likely to fall in ${weeks(d.horizon)}`} rows={d.falls} onPick={pick} />
          <MoverList title="Highest prices this week" rows={d.top} onPick={pick} />
        </div>
      )}
      {d.naive && <div className="grid-3"><MoverList title="Highest prices this week" rows={d.top} onPick={pick} noMove /></div>}
    </>
  );
}

// KPI tile: label, a big number, a plain-language note and (optionally) a 26-week trend line.
// Built on the React Bits SpotlightCard, following the 21st.dev KPI tile pattern (value, change, sparkline).
function Kpi({ label, value, note, trend }) {
  return (
    <SpotlightCard className="kpi" theme="light" spotlightColor="rgba(43,123,71,0.12)" intensity={0.45} spotlightSize={240} borderGlow={0.2} flare={false}>
      <div className="kpi-label">{label}</div>
      <div className="kpi-value num">{value}</div>
      {trend && <Trend points={trend} />}
      {note && <div className="kpi-note">{note}</div>}
    </SpotlightCard>
  );
}

function Trend({ points }) {
  const v = points.map(p => p.price).filter(x => x != null);
  if (v.length < 3) return null;
  const w = 220, h = 40, min = Math.min(...v), max = Math.max(...v), span = max - min || 1;
  const xy = v.map((y, i) => [(i / (v.length - 1)) * (w - 8) + 4, h - 4 - ((y - min) / span) * (h - 8)]);
  const [lx, ly] = xy[xy.length - 1];
  return (
    <svg className="kpi-trend" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" role="img"
      aria-label={`Weekly median over ${v.length} weeks, from ${rupees(v[0])} to ${rupees(v[v.length - 1])}`}>
      <polyline points={xy.map(p => p.join(',')).join(' ')} fill="none" stroke={T.forest} strokeWidth="1.75"
        vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
      <circle cx={lx} cy={ly} r="3" fill={T.forest} />
    </svg>
  );
}

function StateBars({ rows, onPick }) {
  const [all, setAll] = useState(false);
  const max = Math.max(...rows.map(r => r.median ?? 0));
  const shown = all ? rows : rows.slice(0, 10);
  return (
    <>
    <ol className="state-bars">
      {shown.map(r => (
        <li key={r.state}>
          <button type="button" onClick={() => onPick(r.state)}
            aria-label={`${r.state}: median ${rupees(r.median)} across ${r.mandis} mandis. Show its mandis`}>
            <span className="sb-name">{r.state}<small>{r.mandis} {r.mandis === 1 ? 'mandi' : 'mandis'}</small></span>
            <span className="sb-track"><span className="sb-fill" style={{ width: `${((r.median ?? 0) / max) * 100}%` }} /></span>
            <span className="sb-value num">{rupees(r.median)}</span>
            <span className="sb-move">{r.move != null ? <Delta value={r.move} title="Median expected change" /> : <span className="delta flat">–</span>}</span>
          </button>
        </li>
      ))}
    </ol>
    {rows.length > 10 && (
      <button type="button" className="btn show-all" aria-expanded={all} onClick={() => setAll(a => !a)}>
        {all ? 'Show the top 10' : `Show all ${rows.length} states`}</button>
    )}
    </>
  );
}

function MoverList({ title, rows, onPick, noMove = false }) {
  return (
    <section className="panel mover" aria-label={title}>
      <h3>{title}</h3>
      {rows.length === 0 && <p className="note">No mandis to show this week.</p>}
      <ol>
        {rows.map(r => (
          <li key={`${r.state}-${r.market}`}>
            <button type="button" onClick={() => onPick(r)}>
              <span className="mv-name">{r.market}{r.new_mandi && <span className="badge" title="Less than 3 years of price history">new</span>}
                <small>{r.district}, {r.state}</small></span>
              <span className="mv-value">
                <span className="num">{rupees(r.price)}</span>
                {!noMove && r.move != null && <Delta value={r.move} title="Expected change" />}
              </span>
            </button>
          </li>
        ))}
      </ol>
    </section>
  );
}
