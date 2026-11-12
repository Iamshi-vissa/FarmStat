import { useEffect, useMemo, useState } from 'react';
import RubberSegment from './components/reactbits/RubberSegment.jsx';
import Sidebar from './components/Sidebar.jsx';
import MarketView from './components/MarketView.jsx';
import CompareView from './components/CompareView.jsx';
import AccuracyView from './components/AccuracyView.jsx';
import CashewView from './components/CashewView.jsx';
import SugarcaneView from './components/SugarcaneView.jsx';
import AboutView from './components/AboutView.jsx';
import { api } from './api.js';
import { date, monthLabel, rupees } from './format.js';

const DEFAULTS = { Onion: ['Maharashtra', 'Lasalgaon'], Tomato: ['Karnataka', 'Kolar'], Potato: ['West Bengal', null],
  Arecanut: ['Karnataka', 'Sirsi (Rashi)'] };

const readHash = () => Object.fromEntries(new URLSearchParams(window.location.hash.slice(1)));

export default function App() {
  const [meta, setMeta] = useState(null);
  const [error, setError] = useState(null);
  const init = readHash();
  const [crop, setCrop] = useState(init.crop || 'Onion');
  const [state, setState] = useState(init.state || null);
  const [market, setMarket] = useState(init.mandi || null);
  const [view, setView] = useState(init.view || 'market');
  const [mandis, setMandis] = useState([]);
  const [extra, setExtra] = useState({});   // cashew / sugarcane payloads

  useEffect(() => { api('meta').then(setMeta).catch(e => setError(e.message)); }, []);
  useEffect(() => {   // follow links that only change the #… part of the address
    const onHash = () => {
      const h = readHash();
      if (h.crop) setCrop(h.crop);
      if (h.state) setState(h.state);
      if (h.mandi) setMarket(h.mandi);
      if (h.view) setView(h.view);
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  const cropMeta = useMemo(() => meta?.crops.find(c => c.id === crop), [meta, crop]);

  // pick a sensible state when the crop changes
  useEffect(() => {
    if (!cropMeta) return;
    if (cropMeta.kind === 'weekly') {
      const names = cropMeta.states.map(s => s.name);
      if (!names.includes(state)) setState(names.includes(DEFAULTS[crop]?.[0]) ? DEFAULTS[crop][0] : names[0]);
    } else {
      const key = crop.toLowerCase();
      if (!extra[key]) api(key).then(d => setExtra(x => ({ ...x, [key]: d })));
      if (crop === 'Cashew' && extra.cashew && !extra.cashew.states.some(s => s.state === state)) setState(extra.cashew.states[0].state);
      if (!['overview', 'accuracy', 'about'].includes(view)) setView('overview');
    }
  }, [cropMeta, crop, extra]); // eslint-disable-line react-hooks/exhaustive-deps

  // load the mandi list for the chosen state
  useEffect(() => {
    if (cropMeta?.kind !== 'weekly' || !state || !cropMeta.states.some(s => s.name === state)) return;
    let live = true;
    api('mandis', { crop, state }).then(rows => {
      if (!live) return;
      setMandis(rows);
      if (!rows.some(r => r.market === market)) {
        const pref = DEFAULTS[crop]?.[1];
        setMarket(rows.some(r => r.market === pref) ? pref : [...rows].sort((a, b) => (b.arrivals ?? 0) - (a.arrivals ?? 0))[0].market);
      }
    });
    if (!['market', 'compare', 'accuracy', 'about'].includes(view)) setView('market');
    return () => { live = false; };
  }, [crop, state, cropMeta]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const p = new URLSearchParams({ crop, view, ...(state ? { state } : {}), ...(market && cropMeta?.kind === 'weekly' ? { mandi: market } : {}) });
    window.history.replaceState(null, '', `#${p}`);
  }, [crop, state, market, view, cropMeta]);

  if (error) return <div className="loading"><p>Couldn’t reach the FarmStat API: {error}.</p><p>Start it with <code>python -m uvicorn api.main:app</code> and reload.</p></div>;
  if (!meta || !cropMeta) return <div className="loading">Loading FarmStat…</div>;

  const weekly = cropMeta.kind === 'weekly';
  // only render a mandi once the list for this crop and state has arrived (avoids a mismatched request)
  const ready = weekly && market && mandis.length > 0 && mandis[0].crop === crop && mandis[0].state === state
    && mandis.some(m => m.market === market);
  const tabs = weekly
    ? [['market', 'Market'], ['compare', 'Compare mandis'], ['accuracy', 'Model accuracy'], ['about', 'About']]
    : [['overview', crop === 'Cashew' ? 'Prices by state' : 'FRP and prices'], ['accuracy', 'Model accuracy'], ['about', 'About']];

  let side;
  if (weekly) {
    side = <Sidebar crop={crop} states={cropMeta.states} state={state} onState={s => { setState(s); setMarket(null); }}
      mandis={mandis} market={market} onMarket={setMarket} unit={crop === 'Arecanut' ? 'mandi-varieties' : 'mandis'}
      footer={<>Prices to the week of {date(cropMeta.data_until)}. Source: Agmarknet, Government of India.</>} />;
  } else if (crop === 'Cashew') {
    const d = extra.cashew;
    side = (
      <aside className="side" aria-label="Choose a state">
        <div className="brand"><span className="brand-mark">FarmStat</span><span className="brand-sub">mandi price intelligence</span></div>
        <nav className="mandi-list" aria-label="Cashew states">
          {d?.states.map(s => (
            <button key={s.state} className="mandi-row" aria-current={s.state === state} onClick={() => setState(s.state)}>
              <span className="mandi-name">{s.state}</span><span className="mandi-price num">{rupees(s.price)}</span>
              <span className="mandi-dist">{s.product}, {monthLabel(s.month)}</span><span />
            </button>
          ))}
        </nav>
        <div className="side-foot">Monthly state averages from Agmarknet. No mandi-level cashew history is available.</div>
      </aside>
    );
  } else {
    side = (
      <aside className="side">
        <div className="brand"><span className="brand-mark">FarmStat</span><span className="brand-sub">mandi price intelligence</span></div>
        <div className="side-controls"><p className="note" style={{ margin: 0 }}>Most sugarcane is sold to sugar mills at the Fair and
          Remunerative Price (FRP) set by the Government of India, so FarmStat shows the FRP instead of a forecast.</p></div>
        <div style={{ flex: 1 }} />
        <div className="side-foot">FRP: Cabinet Committee on Economic Affairs. Mandi prices: Agmarknet.</div>
      </aside>
    );
  }

  return (
    <div className="app">
      {side}
      <main className="main">
        <div className="topbar">
          <RubberSegment aria-label="Crop" items={meta.crops.map(c => ({ value: c.id, label: c.id }))} value={crop}
            onChange={v => { setCrop(v); }} trackColor="#dfe5de" thumbColor="#12382e" textColor="#15232b"
            activeTextColor="#f1e8cf" size="md" radius={10} draggable={false} />
          <div className="tabs" role="tablist" aria-label="View">
            {tabs.map(([id, label]) => (
              <button key={id} role="tab" className="tab" aria-selected={view === id} onClick={() => setView(id)}>{label}</button>
            ))}
          </div>
        </div>
        {view === 'about' && <AboutView meta={meta} />}
        {view === 'accuracy' && <AccuracyView />}
        {weekly && !ready && <div className="loading">Loading {crop.toLowerCase()} mandis…</div>}
        {ready && view === 'market' && <MarketView crop={crop} state={state} market={market} meta={meta} />}
        {ready && view === 'compare' && <CompareView crop={crop} state={state} market={market} mandis={mandis} />}
        {crop === 'Cashew' && view === 'overview' && (extra.cashew ? <CashewView data={extra.cashew} state={state} /> : <div className="loading">Loading cashew prices…</div>)}
        {crop === 'Sugarcane' && view === 'overview' && (extra.sugarcane ? <SugarcaneView data={extra.sugarcane} /> : <div className="loading">Loading…</div>)}
      </main>
    </div>
  );
}
