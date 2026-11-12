import { useMemo, useState } from 'react';
import { Info, LineChart, Table2 } from 'lucide-react';
import PriceChart, { ArrivalsChart, ChartTable, buildRows } from './PriceChart.jsx';
import { useNarrow } from '../useNarrow.js';
import { weeks } from '../format.js';

const RANGES = [[13, '3M'], [26, '6M'], [52, '1Y'], [104, '2Y'], [260, '5Y']];

// Price history + forecast for one mandi, with range, last-year and table toggles, and arrivals underneath.
export default function MarketChart({ crop, market, data, maxHold }) {
  const narrow = useNarrow();
  const [range, setRange] = useState(26);
  const [lastYear, setLastYear] = useState(false);
  const [asTable, setAsTable] = useState(false);
  const naive = data.latest.naive;

  const chart = useMemo(() => {
    const cutoff = new Date(data.latest.week); cutoff.setDate(cutoff.getDate() - range * 7);
    const history = data.history.filter(h => new Date(h.week) >= cutoff);
    return buildRows({ history, full: data.history, forecast: data.forecast, naive, showLastYear: lastYear });
  }, [data, range, lastYear, naive]);
  const hasArrivals = chart.rows.some(r => r.arrivals != null);

  return (
    <section className="panel chart-panel" style={{ marginTop: 16 }} aria-labelledby="chart-title">
      <div className="panel-head">
        <div>
          <h2 id="chart-title">{crop} price at {market}</h2>
          <p className="sub">Weekly modal price in ₹ per quintal{naive ? ', with the usual range of movement over the next 4 weeks'
            : ', with the forecast and its likely range for the next 4 weeks'}.</p>
        </div>
      </div>
      <div className="chart-toolbar">
        <div className="seg" role="group" aria-label="Time range">
          {RANGES.map(([w, l]) => <button key={w} aria-pressed={range === w} onClick={() => setRange(w)}>{l}</button>)}
        </div>
        <label className="check"><input type="checkbox" checked={lastYear} onChange={e => setLastYear(e.target.checked)} />
          Same weeks last year</label>
        <div className="legend">
          <span className="key"><i />Weekly price</span>
          {!naive && <span className="key"><i className="fc" />Forecast</span>}
          <span className="key"><i className="band" />{naive ? 'Usual range' : 'Likely range'}</span>
          {lastYear && <span className="key"><i className="ctx" />A year earlier</span>}
        </div>
        <div className="seg" role="group" aria-label="View as" style={{ marginLeft: 'auto' }}>
          <button aria-pressed={!asTable} onClick={() => setAsTable(false)} title="Chart"><LineChart size={15} aria-hidden="true" /><span className="sr">Chart</span></button>
          <button aria-pressed={asTable} onClick={() => setAsTable(true)} title="Table"><Table2 size={15} aria-hidden="true" /><span className="sr">Table</span></button>
        </div>
      </div>
      {asTable ? <ChartTable rows={chart.rows} naive={naive} period="week" /> : (
        <>
          <PriceChart rows={chart.rows} naive={naive} syncId="mandi" horizonLabel="in 4 weeks" height={narrow ? 260 : 340} compact={narrow} />
          {hasArrivals && (
            <div className="subchart">
              <div className="subchart-title">Arrivals, tonnes per week <span>darker bars = heavier than usual, which tends to push prices down</span></div>
              <ArrivalsChart rows={chart.rows} syncId="mandi" height={narrow ? 100 : 130} compact={narrow} />
            </div>
          )}
        </>
      )}
      {crop === 'Tomato' && <p className="note">Tomatoes spoil quickly, so advice never suggests holding longer than {weeks(maxHold ?? 1)}.</p>}
      {naive && (
        <div className="callout"><Info size={16} aria-hidden="true" />
          In testing on 2023–2026, no model forecast arecanut better than “no change”, so FarmStat shows today’s price with
          the range real prices moved in 8 of 10 past weeks. Use the variety comparison to find the best mandi.
        </div>
      )}
    </section>
  );
}
