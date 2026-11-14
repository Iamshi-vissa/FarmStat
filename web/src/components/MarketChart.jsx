import Tabs from './ui/Tabs.jsx';
import { useMemo, useState } from 'react';
import { Info, LineChart, Table2 } from 'lucide-react';
import PriceChart, { ArrivalsChart, ChartTable, buildRows } from './PriceChart.jsx';
import PriceStats from './PriceStats.jsx';
import LiveReports from './LiveReports.jsx';
import { useNarrow } from '../hooks.js';
import { placeName, weeks } from '../format.js';

const RANGES = [[13, '3M'], [26, '6M'], [52, '1Y'], [104, '2Y'], [260, '5Y']];

// Price history + forecast for one mandi, with range, last-year and table toggles, and arrivals underneath.
export default function MarketChart({ crop, state, market, data, maxHold }) {
  const narrow = useNarrow();
  const [range, setRange] = useState(26);
  const [lastYear, setLastYear] = useState(false);
  const [season, setSeason] = useState(true);
  const [asTable, setAsTable] = useState(false);
  const naive = data.latest.naive;

  const chart = useMemo(() => {
    const cutoff = new Date(data.latest.week); cutoff.setDate(cutoff.getDate() - range * 7);
    const history = data.history.filter(h => new Date(h.week) >= cutoff);
    return buildRows({ history, full: data.history, forecast: data.forecast, showLastYear: lastYear, showSeason: season });
  }, [data, range, lastYear, season]);
  const hasArrivals = chart.rows.some(r => r.arrivals != null);

  return (
    <>
    <LiveReports crop={crop} state={state} market={market} narrow={narrow} />
    <section className="panel chart-panel" aria-labelledby="chart-title">
      <div className="panel-head">
        <div>
          <h2 id="chart-title">{crop} price at {placeName(market)}</h2>
          <p className="sub">Weekly modal price in ₹ per quintal{naive ? ', with the usual range of movement over the next 4 weeks'
            : ', with the forecast and its likely range for the next 4 weeks'}.</p>
        </div>
      </div>
      <div className="chart-toolbar">
        <Tabs variant="pill" role="group" label="Time range" items={RANGES.map(([w, l]) => ({ value: w, label: l }))}
          value={range} onChange={setRange} />
        <label className="check"><input type="checkbox" checked={season} onChange={e => setSeason(e.target.checked)} />
          Usual for the season</label>
        <label className="check"><input type="checkbox" checked={lastYear} onChange={e => setLastYear(e.target.checked)} />
          Same weeks last year</label>
        <div className="seg seg-end" role="group" aria-label="View as">
          <button aria-pressed={!asTable} onClick={() => setAsTable(false)} title="Chart"><LineChart size={15} aria-hidden="true" /><span className="sr">Chart</span></button>
          <button aria-pressed={asTable} onClick={() => setAsTable(true)} title="Table"><Table2 size={15} aria-hidden="true" /><span className="sr">Table</span></button>
        </div>
      </div>
        <div className="legend chart-legend" aria-label="Legend">
          <span className="key"><i />Weekly price</span>
          {!naive && <span className="key"><i className="fc" />Forecast</span>}
          <span className="key"><i className="band" />{naive ? 'Usual range' : 'Likely range'}</span>
          {lastYear && <span className="key"><i className="ctx" />A year earlier</span>}
          {season && <span className="key"><i className="season" />Usual range, same weeks of the past 5 years</span>}
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
      {naive && crop === 'Arecanut' && (
        <div className="callout"><Info size={16} aria-hidden="true" />
          In testing on 2023–2026, no model forecast arecanut better than “no change”, so FarmStat shows today’s price with
          the range real prices moved in 8 of 10 past weeks. Use the variety comparison to find the best mandi.
        </div>
      )}
    </section>
    <PriceStats crop={crop} market={market} data={data} />
    </>
  );
}
