import { Suspense, lazy, useEffect, useMemo, useRef, useState } from 'react';
import { useScrollEnd } from './useScrollEnd.js';
import CropSwitch from './components/CropSwitch.jsx';
import Sidebar from './components/Sidebar.jsx';
import MarketView, { MarketSkeleton, loadMarketChart } from './components/MarketView.jsx';
import { Notice, SideShell } from './components/Chrome.jsx';
import Tabs from './components/ui/Tabs.jsx';
import SearchButton from './components/SearchAnywhere.jsx';
import { api } from './api.js';
import { date, monthLabel, rupees } from './format.js';

// Views other than the mandi page load on demand, so the first screen only downloads what it needs.
const CompareView = lazy(() => import('./components/CompareView.jsx'));
const AccuracyView = lazy(() => import('./components/AccuracyView.jsx'));
const CashewView = lazy(() => import('./components/CashewView.jsx'));
const SugarcaneView = lazy(() => import('./components/SugarcaneView.jsx'));
const AboutView = lazy(() => import('./components/AboutView.jsx'));

const DEFAULTS = { Onion: ['Maharashtra', 'Lasalgaon'], Tomato: ['Karnataka', 'Kolar'], Potato: ['West Bengal', null],
  Arecanut: ['Karnataka', 'Sirsi (Rashi)'] };
const readHash = () => Object.fromEntries(new URLSearchParams(window.location.hash.slice(1)));
const Wait = ({ label = 'Loading…' }) => <div className="loading" role="status">{label}</div>;

export default function App() {
  const init = useMemo(readHash, []);
  const [meta, setMeta] = useState(null);
  const [error, setError] = useState(null);
  const [crop, setCrop] = useState(init.crop || 'Onion');
  const [state, setState] = useState(init.state || null);
  const [market, setMarket] = useState(init.mandi || null);
  const [view, setView] = useState(init.view || 'market');
  const [section, setSection] = useState(init.section || null);   // About page section
  const [mandis, setMandis] = useState([]);
  const [extra, setExtra] = useState({});                          // cashew / sugarcane payloads
  const tabsRef = useRef(null);
  useScrollEnd(tabsRef);

  useEffect(() => { api('meta').then(setMeta).catch(e => setError(e.message)); loadMarketChart(); }, []);   // fetch chart code early
  useEffect(() => {   // follow links that only change the #… part of the address
    const onHash = () => {
      const h = readHash();
      if (h.crop) setCrop(h.crop);
      if (h.state) setState(h.state);
      if (h.mandi) setMarket(h.mandi);
      if (h.view) setView(h.view);
      setSection(h.section || null);
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
    if (cropMeta?.kind !== 'weekly' || !state || !cropMeta.states.some(s => s.name === state)) return undefined;
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
    const p = new URLSearchParams({ crop, view, ...(state ? { state } : {}), ...(market && cropMeta?.kind === 'weekly' ? { mandi: market } : {}),
      ...(view === 'about' && section ? { section } : {}) });
    window.history.replaceState(null, '', `#${p}`);
  }, [crop, state, market, view, cropMeta, section]);

  // start each view at the top, unless a link points into the About page
  useEffect(() => { if (!(view === 'about' && section)) window.scrollTo(0, 0); }, [view]); // eslint-disable-line react-hooks/exhaustive-deps

  if (error) return <div className="loading"><p>Couldn’t reach the FarmStat API: {error}.</p><p>Start it with <code>python -m uvicorn api.main:app</code> and reload.</p></div>;
  if (!meta || !cropMeta) return <Wait label="Loading FarmStat…" />;

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
    side = (
      <SideShell label="Choose a state" current={state} footer="Monthly state averages from Agmarknet. No mandi-level cashew history is available.">
        <nav className="mandi-list" aria-label="Cashew states">
          {extra.cashew?.states.map(s => (
            <button key={s.state} className="mandi-row" aria-current={s.state === state} onClick={() => setState(s.state)}>
              <span className="mandi-name">{s.state}</span><span className="mandi-price">{rupees(s.price)}</span>
              <span className="mandi-dist">{s.product}, {monthLabel(s.month)}</span><span />
            </button>
          ))}
        </nav>
      </SideShell>
    );
  } else {
    side = (
      <SideShell label="About sugarcane prices" footer="FRP: Cabinet Committee on Economic Affairs. Mandi prices: Agmarknet.">
        <div className="side-controls"><p className="note" style={{ margin: 0 }}>Most sugarcane is sold to sugar mills at the Fair and
          Remunerative Price (FRP) set by the Government of India, so FarmStat shows the FRP instead of a forecast.</p></div>
        <div style={{ flex: 1 }} />
      </SideShell>
    );
  }

  return (
    <div className="app">
      <a className="skip" href="#main">Skip to content</a>
      {side}
      <main className="main" id="main">
        <div className="topbar">
          <CropSwitch items={meta.crops.map(c => ({ value: c.id, label: c.id }))} value={crop} onChange={setCrop} />
          <Tabs items={tabs.map(([value, label]) => ({ value, label }))} value={view} onChange={setView} label="View"
            className="tabs" tabRef={tabsRef} />
          <SearchButton crops={meta.crops} onPick={pick => {
            if (pick.crop) { setCrop(pick.crop); if (pick.state) setState(pick.state); if (pick.market) setMarket(pick.market); }
            setView(pick.view);
          }} />
        </div>
        <Notice />
        <Suspense fallback={view === 'market' || view === 'overview' ? <MarketSkeleton label="Loading" /> : <Wait />}>
          {view === 'about' && <AboutView meta={meta} section={section} onSection={setSection} />}
          {view === 'accuracy' && <AccuracyView />}
          {weekly && !ready && view === 'market' && <MarketSkeleton label={`Loading ${crop.toLowerCase()} mandis`} />}
          {weekly && !ready && view === 'compare' && <Wait label={`Loading ${crop.toLowerCase()} mandis…`} />}
          {ready && view === 'market' && <MarketView crop={crop} state={state} market={market} meta={meta} />}
          {ready && view === 'compare' && <CompareView crop={crop} state={state} market={market} mandis={mandis} onMarket={setMarket} />}
          {crop === 'Cashew' && view === 'overview' && (extra.cashew ? <CashewView data={extra.cashew} state={state} /> : <MarketSkeleton label="Loading cashew prices" />)}
          {crop === 'Sugarcane' && view === 'overview' && (extra.sugarcane ? <SugarcaneView data={extra.sugarcane} /> : <MarketSkeleton label="Loading" />)}
        </Suspense>
      </main>
    </div>
  );
}
