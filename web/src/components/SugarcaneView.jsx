import { CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import RateBoard from './RateBoard.jsx';
import { axisDate, monthLabel, rupees } from '../format.js';
import { T } from '../theme.js';

export default function SugarcaneView({ data }) {
  const c = data.current;
  const frpAt = t => [...data.frp].reverse().find(f => new Date(f.start).getTime() <= t)?.price ?? null;
  const rows = data.chhattisgarh.map(r => { const t = new Date(r.month).getTime(); return { t, price: r.price, frp: frpAt(t) }; });
  return (
    <>
      <RateBoard title="Sugarcane FRP" where={`Sugar season ${c.season}, from 1 October 2026`} priceLabel={`at ${c.recovery}% sugar recovery`}
        price={c.price} advice={{ action: 'Information', headline: 'Sold to mills, not forecast',
          footnote: 'Set by the Government of India.', detail: `Mills pay ₹${c.step} more per quintal for every 0.1% recovery above ${c.recovery}%, and ₹${c.step} less below it. Below ${c.floor_below}% there is no further cut, so the minimum is ₹${c.floor}.` }} />
      <div className="grid-2">
        <section className="panel">
          <div className="panel-head"><div><h2>Chhattisgarh mandi price vs FRP</h2>
            <p className="sub">The only state that reports sugarcane mandi prices regularly. Its price tracks the FRP closely.</p></div>
            <div className="legend"><span className="key"><i />Mandi average</span><span className="key"><i className="fc" />FRP</span></div></div>
          <ResponsiveContainer width="100%" height={300}>
            <ComposedChart data={rows} margin={{ top: 8, right: 12, bottom: 0, left: 4 }}>
              <CartesianGrid stroke={T.grid} vertical={false} />
              <XAxis dataKey="t" type="number" scale="time" domain={['dataMin', 'dataMax']} tickFormatter={axisDate}
                tick={{ fontSize: 12, fill: T.ink3 }} tickLine={false} minTickGap={40} />
              <YAxis tick={{ fontSize: 12, fill: T.ink3 }} tickLine={false} axisLine={false} tickFormatter={v => `₹${v}`} width={52}
                domain={[d => Math.floor((d - 30) / 50) * 50, d => Math.ceil((d + 30) / 50) * 50]} allowDecimals={false} />
              <Tooltip labelFormatter={t => monthLabel(t)} formatter={(v, n) => [rupees(v), n === 'frp' ? 'FRP' : 'Mandi average']} />
              <Line dataKey="price" stroke={T.ink} strokeWidth={2} dot={false} activeDot={{ r: 4, stroke: T.panel, strokeWidth: 2 }} isAnimationActive={false} />
              <Line dataKey="frp" stroke={T.forecast} strokeWidth={2} type="stepAfter" dot={false} isAnimationActive={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </section>
        <section className="panel">
          <div className="panel-head"><div><h2>FRP by season</h2><p className="sub">₹ per quintal, set by the Government of India.</p></div></div>
          <table className="table">
            <thead><tr><th>Season</th><th className="r">FRP</th><th className="r">Change</th></tr></thead>
            <tbody>{[...data.frp].reverse().map((f, i, a) => (
              <tr key={f.season} className={f.season === c.season ? 'me' : ''}><td>{f.season}</td><td className="r num">{rupees(f.price)}</td>
                <td className="r num">{a[i + 1] ? `+₹${f.price - a[i + 1].price}` : '–'}</td></tr>
            ))}</tbody>
          </table>
          <p className="note">Some states, such as Uttar Pradesh, pay a higher State Advised Price on top of the FRP.</p>
        </section>
      </div>
    </>
  );
}
