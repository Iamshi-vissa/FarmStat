import { useEffect, useState } from 'react';
import { MousePointerClick, Search } from 'lucide-react';
import RateBoard, { Count, Price, Verdict, priceWeek } from './RateBoard.jsx';
import Delta from './Delta.jsx';
import { MarketSkeleton } from './MarketView.jsx';
import { openSearch, openSidePanel } from '../events.js';
import { api } from '../api.js';
import { pct, pct0, placeName, rupees, weeks } from '../format.js';
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
  const cells = [
    { key: 'now', label: 'Median price this week', value: <Price v={d.median} />, valueLabel: `${rupees(d.median)} per quintal`,
      sub: d.median_prev ? <><Delta value={d.median / d.median_prev - 1} /><span>vs last week ({rupees(d.median_prev)})</span></> : null,
      extra: d.trend ? <Trend points={d.trend} /> : null, note: priceWeek(d.week) },
    { key: 'yoy', label: 'Compared with a year ago', value: d.median_year_ago ? <Count to={d.median / d.median_year_ago - 1} format={v => pct(v, 0)} /> : '–',
      note: d.median_year_ago ? `The median was ${rupees(d.median_year_ago)} in the same week last year` : 'Not enough history a year back' },
    // a crop with no forecast (arecanut) gets no forecast cells, rather than cells that say so
    ...(d.naive ? [] : [
      { key: 'move', label: `Expected in ${weeks(d.horizon)}`, value: <Count to={d.move} format={v => pct(v)} />, note: 'Median expected change across mandis with a forecast' },
      { key: 'rise', label: 'Likely to rise 5% or more', value: <Count to={d.rise_share} format={pct0} />, note: 'Share of mandis where the chance is 50% or higher' },
    ]),
  ];
  const total = (calls.Hold ?? 0) + (calls['Your call'] ?? 0) + (calls['Sell now'] ?? 0);
  const verdict = d.naive ? (
    <Verdict action="Your call" word="No forecast" label="This week across India" headline="Today’s price is the best guide"
      detail={`No model beat “no change” for ${crop.toLowerCase()}, so each mandi shows the usual range of movement instead of a forecast.`}
      footnote="Choose a mandi to see its own range." />
  ) : (
    <Verdict action="Your call" label="This week’s calls across India" word={`${calls.Hold ?? 0} say hold`}
      headline={`${calls['Sell now'] ?? 0} say sell now, ${calls['Your call'] ?? 0} have no clear signal.`}
      detail="Choose a mandi for its own call and the reasons behind it." footnote="Estimates, not guarantees.">
      {total > 0 && <CallsBar calls={calls} total={total} />}
    </Verdict>
  );

  return (
    <>
      <RateBoard title={`${crop} across India`} cells={cells} verdict={verdict}
        where={[`Median of ${d.series.toLocaleString('en-IN')} ${unit} in ${d.states_count} states`]} />

      <p className="start-hint">
        <MousePointerClick size={16} aria-hidden="true" />
        <span>To see one mandi’s forecast, choose a state below or{' '}
          <button type="button" className="linklike" onClick={openSearch}><Search size={14} aria-hidden="true" />search {crop.toLowerCase()} mandis</button>.</span>
      </p>

      <section className="panel" aria-labelledby="states-title">
        <div className="panel-head"><div><h2 id="states-title">Prices by state</h2>
          <p className="sub">Median modal price of mandis that reported in the last 3 weeks{d.naive ? '' : ', and the median expected change'}.
            Select a state to see its mandis.</p></div></div>
        <StateBars rows={d.states} onPick={chooseState} noMove={d.naive} />
      </section>

      <div className="grid-3">
        {!d.naive && <MoverList title={`Likely to rise in ${weeks(d.horizon)}`} rows={d.rises} onPick={pick} />}
        {!d.naive && <MoverList title={`Likely to fall in ${weeks(d.horizon)}`} rows={d.falls} onPick={pick} />}
        <MoverList title="Highest prices this week" rows={d.top} onPick={pick} noMove={d.naive} />
      </div>
    </>
  );
}

// The week's calls as one bar: hold, no clear signal and sell now, with the counts written out beside it.
function CallsBar({ calls, total }) {
  const parts = [['hold', 'Hold', calls.Hold ?? 0], ['call', 'No clear signal', calls['Your call'] ?? 0], ['sell', 'Sell now', calls['Sell now'] ?? 0]];
  return (
    <>
      <div className="calls-bar" role="img" aria-label={parts.map(([, l, n]) => `${l}: ${n}`).join(', ')}>
        {parts.map(([k, , n]) => n > 0 && <span key={k} className={k} style={{ flex: n / total }} />)}
      </div>
      <div className="calls-legend" aria-hidden="true">
        {parts.map(([k, l, n]) => <span key={k}><i className={k} />{l} <b>{n}</b></span>)}
      </div>
    </>
  );
}

// The national median over the past 26 weeks, under the price.
function Trend({ points }) {
  const v = points.map(p => p.price).filter(x => x != null);
  if (v.length < 3) return null;
  const w = 220, h = 40, min = Math.min(...v), max = Math.max(...v), span = max - min || 1;
  const xy = v.map((y, i) => [(i / (v.length - 1)) * (w - 8) + 4, h - 4 - ((y - min) / span) * (h - 8)]);
  const [lx, ly] = xy[xy.length - 1];
  return (
    <svg className="board-trend" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" role="img"
      aria-label={`Weekly median over ${v.length} weeks, from ${rupees(v[0])} to ${rupees(v[v.length - 1])}`}>
      <polyline points={xy.map(p => p.join(',')).join(' ')} fill="none" stroke={T.ink} strokeWidth="1.5"
        vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
      <circle cx={lx} cy={ly} r="3" fill={T.ink} />
    </svg>
  );
}

function StateBars({ rows, onPick, noMove = false }) {
  const [all, setAll] = useState(false);
  const max = Math.max(...rows.map(r => r.median ?? 0));
  const shown = all ? rows : rows.slice(0, 10);
  return (
    <>
    <ol className={`state-bars${noMove ? ' no-move' : ''}`}>
      {shown.map(r => (
        <li key={r.state}>
          <button type="button" onClick={() => onPick(r.state)}
            aria-label={`${r.state}: median ${rupees(r.median)} across ${r.mandis} mandis. Show its mandis`}>
            <span className="sb-name">{r.state}<small>{r.mandis} {r.mandis === 1 ? 'mandi' : 'mandis'}</small></span>
            <span className="sb-track"><span className="sb-fill" style={{ width: `${((r.median ?? 0) / max) * 100}%` }} /></span>
            <span className="sb-value num">{rupees(r.median)}</span>
            {!noMove && <span className="sb-move">{r.move != null ? <Delta value={r.move} title="Median expected change" /> : <span className="delta flat">–</span>}</span>}
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
              <span className="mv-name">
                <span>{placeName(r.market)}{r.new_mandi && <span className="badge" title="Less than 3 years of price history">new</span>}</span>
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
