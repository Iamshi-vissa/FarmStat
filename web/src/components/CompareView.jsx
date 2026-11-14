import { useEffect, useMemo, useState } from 'react';
import { ArrowDownUp } from 'lucide-react';
import { Bar, BarChart, Cell, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import Delta from './Delta.jsx';
import DotStrip from './DotStrip.jsx';
import { api } from '../api.js';
import { quantile } from '../stats.js';
import { compactRupees, date, pct0, placeName, rupees, weeks } from '../format.js';
import { T } from '../theme.js';

const varietyOf = m => (m.includes('(') ? m.slice(m.lastIndexOf('(') + 1, -1) : null);

function SortTh({ id, label, sort, setSort, right, className = '' }) {
  const on = sort.id === id;
  return (
    <th className={`${right ? 'r ' : ''}${className}`.trim() || undefined} aria-sort={on ? (sort.desc ? 'descending' : 'ascending') : 'none'}>
      <button onClick={() => setSort({ id, desc: on ? !sort.desc : true })}>{label}<ArrowDownUp size={12} aria-hidden="true" /></button>
    </th>
  );
}

export default function CompareView({ crop, state, market, mandis, onMarket, onOpen }) {
  const variety = crop === 'Arecanut' ? varietyOf(market) : null;
  const [nat, setNat] = useState(null);
  const [sort, setSort] = useState({ id: 'price', desc: true });
  useEffect(() => { api('national', { crop, variety }).then(setNat).catch(() => setNat(null)); }, [crop, variety]);

  const naive = mandis.every(m => m.naive);
  const h = mandis[0]?.horizon ?? 2;
  const rows = useMemo(() => {
    const r = variety ? mandis.filter(m => varietyOf(m.market) === variety) : mandis;
    const k = sort.id;
    return [...r].sort((a, b) => {
      const x = a[k], y = b[k];
      const c = typeof x === 'string' ? x.localeCompare(y) : (x ?? -1e9) - (y ?? -1e9);
      return sort.desc ? -c : c;
    });
  }, [mandis, variety, sort]);
  const me = rows.find(r => r.market === market);
  const best = [...rows].sort((a, b) => b.price - a.price)[0];
  const median = quantile(rows.map(r => r.price).sort((a, b) => a - b), 0.5);   // same median as the dot strip
  const sameWeek = rows.every(r => r.week === rows[0]?.week);   // usually true: then the week goes in the subtitle, not a column
  const here = market ? placeName(market) : null;
  let lead = '';
  if (best && me && best.market !== market) {
    lead = `${placeName(best.market)} paid the most in ${state} in its latest report: ${rupees(best.price)}, ${rupees(best.price - me.price)} more than ${here}. Count transport costs before you decide.`;
  } else if (best && me) {
    lead = `${here} has the highest latest price in ${state} for this crop.`;
  } else if (best) {
    lead = `${placeName(best.market)} paid the most in ${state} in its latest report: ${rupees(best.price)}. The median across its ${rows.length} mandis is ${rupees(median)}.`;
  }

  return (
    <>
      <div className="page-head">
        <h1>Where to sell {crop.toLowerCase()}{variety ? ` (${variety})` : ''}</h1>
        <p>
          {lead}
          {variety && ' Arecanut varieties have very different prices, so only the same variety is compared.'}
        </p>
      </div>

      {rows.length >= 3 && (
        <section className="panel" aria-labelledby="spread-title">
          <div className="panel-head"><div><h2 id="spread-title">Price spread across {state}</h2>
            <p className="sub">Each dot is one mandi’s latest weekly price. The shaded band holds the middle half of mandis.
              {here ? ` ${here} is highlighted.` : ''} Select a dot to highlight a mandi.</p></div>
            <div className="legend">{here && <span className="key"><i className="dot me" />{here}</span>}
              <span className="key"><i className="dot" />{here ? 'Other mandis' : 'Mandis'}</span>
              <span className="key"><i className="iqr" />Middle half</span></div></div>
          <DotStrip rows={rows} market={market} onPick={onMarket} />
        </section>
      )}

      <section className="panel">
        <div className="panel-head"><div><h2>Mandis in {state}</h2>
          <p className="sub">Latest weekly price{sameWeek && rows[0] ? ` (week of ${date(rows[0].week)})` : ''}{naive ? '' : `, expected price in ${weeks(h)} and the model’s advice`}.
            Select a mandi’s name to open it, or a column heading to sort.</p></div></div>
        <div className="table-wrap">
          <table className="table">
            <thead><tr>
              <SortTh id="market" label="Mandi" sort={sort} setSort={setSort} />
              <SortTh id="district" label="District" sort={sort} setSort={setSort} className="wide-cell" />
              {!sameWeek && <th>Week</th>}
              <SortTh id="price" label="Price" sort={sort} setSort={setSort} right />
              {!naive && <SortTh id={`p50_${h}`} label={`In ${weeks(h)}`} sort={sort} setSort={setSort} right />}
              {!naive && <SortTh id="change" label="Change" sort={sort} setSort={setSort} right />}
              {!naive && <SortTh id="prob_rise" label="Chance of 5%+ rise" sort={sort} setSort={setSort} right />}
              {!naive && <th>Advice</th>}
            </tr></thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.market} className={r.market === market ? 'me' : ''}>
                  <td><button type="button" className="cell-link" onClick={() => onOpen(r.market)}
                    aria-current={r.market === market ? 'true' : undefined}>{placeName(r.market)}</button>
                    <div className="mandi-dist narrow-cell">{r.district}</div></td>
                  <td className="wide-cell">{r.district}</td>{!sameWeek && <td className="num">{date(r.week)}</td>}
                  <td className="r num">{rupees(r.price)}</td>
                  {!naive && <td className="r num">{rupees(r[`p50_${h}`])}</td>}
                  {!naive && <td className="r"><Delta value={r.change} /></td>}
                  {!naive && <td className="r num">{pct0(r.prob_rise)}</td>}
                  {!naive && <td>{r.advice === 'Hold' ? `Hold ~${weeks(r.hold_weeks)}` : r.advice}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {nat && (
        <div className="grid-2">
          <section className="panel">
            <div className="panel-head"><div><h2>Median price by state</h2>
              <p className="sub">Mandis reporting in the last 2 weeks of data, ₹ per quintal. {state} is darker.</p></div></div>
            <ResponsiveContainer width="100%" height={Math.max(160, nat.states.length * 30 + 20)}>
              <BarChart data={nat.states} layout="vertical" margin={{ top: 0, right: 64, bottom: 0, left: 8 }} barCategoryGap={6}>
                <XAxis type="number" hide />
                <YAxis type="category" dataKey="state" width={130} tick={{ fontSize: 12, fill: T.ink2 }} tickLine={false} axisLine={false} />
                <Tooltip cursor={{ fill: 'rgba(22,24,19,0.05)' }} formatter={(v, _n, p) => [`${rupees(v)} (${p.payload.mandis} mandis)`, 'Median']} />
                <Bar dataKey="median" radius={[0, 4, 4, 0]} maxBarSize={18} isAnimationActive={false}>
                  {nat.states.map(s => <Cell key={s.state} fill={s.state === state ? T.forest : T.forestLight} />)}
                  <LabelList dataKey="median" position="right" formatter={compactRupees} fontSize={12} fill={T.ink} />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </section>
          <section className="panel">
            <div className="panel-head"><div><h2>Highest-paying mandis in India</h2>
              <p className="sub">Latest reports, last 2 weeks of data.</p></div></div>
            <table className="table">
              <thead><tr><th>Mandi</th><th>State</th><th className="r">Price</th></tr></thead>
              <tbody>{nat.top.map(t => (
                <tr key={`${t.state}-${t.market}`}><td>{placeName(t.market)}<div className="mandi-dist">{t.district}</div></td>
                  <td>{t.state}</td><td className="r num">{rupees(t.price)}</td></tr>
              ))}</tbody>
            </table>
          </section>
        </div>
      )}
    </>
  );
}
