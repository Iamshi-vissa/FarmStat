import { Suspense, lazy, useEffect, useMemo, useRef, useState } from 'react';
import { Info, MapPin, Search, Store } from 'lucide-react';
import CropSwitch from './components/CropSwitch.jsx';
import Sidebar, { CashewSidebar, SugarcaneSidebar } from './components/Sidebar.jsx';
import MarketView, { MarketSkeleton, loadMarketChart } from './components/MarketView.jsx';
import { Brand, Notice } from './components/Chrome.jsx';
import Tabs from './components/ui/Tabs.jsx';
import SearchButton from './components/SearchAnywhere.jsx';
import { api } from './api.js';
import { openSearch, openSidePanel } from './events.js';
import { date, placeName } from './format.js';
import { useScrollEnd } from './hooks.js';

// Pages other than the mandi page load on demand, so the first screen only downloads what it needs.
const CompareView = lazy(() => import('./components/CompareView.jsx'));
const AccuracyView = lazy(() => import('./components/AccuracyView.jsx'));
const CashewView = lazy(() => import('./components/CashewView.jsx'));
const SugarcaneView = lazy(() => import('./components/SugarcaneView.jsx'));
const AboutView = lazy(() => import('./components/AboutView.jsx'));
const loadOverview = () => import('./components/OverviewView.jsx');
const OverviewView = lazy(loadOverview);

const DEFAULT_CROP = 'Onion';
const WEEKLY = ['Onion', 'Tomato', 'Potato', 'Arecanut'];   // crops with a weekly mandi panel (meta confirms)
const SHARED_VIEWS = ['overview', 'accuracy', 'about'];       // the pages every crop has
const readHash = () => Object.fromEntries(new URLSearchParams(window.location.hash.slice(1)));
const Wait = ({ label = 'Loading…' }) => <div className="loading" role="status">{label}</div>;

export default function App() {
  const init = useMemo(readHash, []);
  const [meta, setMeta] = useState(null);
  const [error, setError] = useState(null);
  const [crop, setCrop] = useState(init.crop || DEFAULT_CROP);
  const [state, setState] = useState(init.state || null);
  const [market, setMarket] = useState(init.mandi || null);
  // Nothing is chosen for the visitor: the first screen is the crop across India, until they pick a state or mandi.
  const [view, setView] = useState(init.view || (init.mandi ? 'market' : 'overview'));
  const [section, setSection] = useState(init.section || null);   // About page section
  const [mandis, setMandis] = useState([]);                         // the chosen state's mandis for this crop
  const [extra, setExtra] = useState({});                           // cashew / sugarcane payloads
  const tabsRef = useRef(null);
  useScrollEnd(tabsRef);

  // First paint: fetch meta and, alongside it, the first screen's data and code. The chart code follows when idle.
  useEffect(() => {
    api('meta').then(setMeta).catch(e => setError(e.message));
    if (init.mandi) loadMarketChart();
    else if (WEEKLY.includes(init.crop || DEFAULT_CROP)) {
      api('overview', { crop: init.crop || DEFAULT_CROP }).catch(() => {});
      loadOverview();
    }
    (window.requestIdleCallback ?? (f => setTimeout(f, 1500)))(() => loadMarketChart());
  }, [init]);

  // Follow links that only change the #… part of the address (policy links, the About page's sections).
  useEffect(() => {
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
  const weekly = cropMeta?.kind === 'weekly';
  const extraKey = weekly || !cropMeta ? null : crop.toLowerCase();

  // A crop change keeps the visitor's state only if the new crop has it (never chooses one for them).
  useEffect(() => {
    if (!cropMeta) return;
    if (weekly) {
      if (state && !cropMeta.states.some(s => s.name === state)) { setState(null); setMarket(null); }
    } else {
      setView(v => (SHARED_VIEWS.includes(v) ? v : 'overview'));
    }
  }, [cropMeta]); // eslint-disable-line react-hooks/exhaustive-deps -- runs on crop change only, by design

  // Cashew and sugarcane have their own payloads, fetched once each.
  useEffect(() => {
    if (!extraKey || extra[extraKey]) return;
    api(extraKey).then(d => setExtra(x => ({ ...x, [extraKey]: d }))).catch(e => setError(e.message));
  }, [extraKey, extra]);
  useEffect(() => {   // a cashew state with no data drops back to the overview
    if (crop === 'Cashew' && state && extra.cashew && !extra.cashew.states.some(s => s.state === state)) setState(null);
  }, [crop, state, extra.cashew]);

  // The chosen state's mandi list (no mandi is picked automatically).
  useEffect(() => {
    if (!weekly || !state || !cropMeta.states.some(s => s.name === state)) { setMandis([]); return undefined; }
    let live = true;
    api('mandis', { crop, state }).then(rows => {
      if (!live) return;
      setMandis(rows);
      if (market && !rows.some(r => r.market === market)) {   // that mandi doesn't sell this crop: back to the overview
        setMarket(null);
        setView(v => (v === 'market' ? 'overview' : v));
      }
    });
    return () => { live = false; };
  }, [crop, state, cropMeta]); // eslint-disable-line react-hooks/exhaustive-deps -- `market` is checked, not a trigger

  // Keep the address in step, so any screen can be bookmarked or shared.
  useEffect(() => {
    const p = new URLSearchParams({ crop, view });
    if (state) p.set('state', state);
    if (market && weekly) p.set('mandi', market);
    if (view === 'about' && section) p.set('section', section);
    window.history.replaceState(null, '', `#${p}`);
  }, [crop, state, market, view, weekly, section]);

  // Start each page at the top, unless a link points into the About page.
  useEffect(() => { if (!section) window.scrollTo(0, 0); }, [view]); // eslint-disable-line react-hooks/exhaustive-deps

  const chooseState = s => { setState(s); setMarket(null); };
  const chooseMarket = m => { setMarket(m); if (m) setView(v => (v === 'compare' ? v : 'market')); };
  const openMarket = (s, m) => { setState(s); setMarket(m); setView('market'); };

  if (error) {
    return (
      <div className="loading" role="alert">
        <p>Couldn’t reach the FarmStat API: {error}.</p>
        <p>Start it with <code>python -m uvicorn api.main:app</code> and reload.</p>
      </div>
    );
  }
  if (!meta || !cropMeta) return <Wait label="Loading FarmStat…" />;

  const tabs = weekly
    ? [['overview', 'India overview'], ['market', 'Mandi'], ['compare', 'Compare mandis'], ['accuracy', 'Model accuracy'], ['about', 'About']]
    : [['overview', crop === 'Cashew' ? 'Prices by state' : 'FRP and prices'], ['accuracy', 'Model accuracy'], ['about', 'About']];

  // The icon rail on the left (desktop) holds only what the tabs don't: the side panel (which also opens on hover) and search.
  const icon = Icon => <Icon size={20} aria-hidden="true" />;
  const panelItem = weekly
    ? { id: 'mandis', label: market ? `Mandi: ${placeName(market)}` : 'Choose a mandi', icon: icon(Store),
      active: view === 'market' || view === 'compare', onClick: () => (market && view !== 'market' ? setView('market') : openSidePanel()) }
    : crop === 'Cashew'
      ? { id: 'states', label: state ? `State: ${state}` : 'Choose a state', icon: icon(MapPin), active: Boolean(state), onClick: openSidePanel }
      : { id: 'about-frp', label: 'About sugarcane prices', icon: icon(Info), onClick: openSidePanel };
  const rail = [{ ...panelItem, panel: true }, { id: 'search', label: 'Search all mandis', icon: icon(Search), onClick: openSearch }];

  let side;
  if (weekly) {
    side = <Sidebar crop={crop} states={cropMeta.states} state={state} onState={chooseState} rail={rail}
      mandis={mandis} market={market} onMarket={chooseMarket} unit={crop === 'Arecanut' ? 'mandi-varieties' : 'mandis'}
      footer={<>Prices to the week of {date(cropMeta.data_until)}. Source: Agmarknet, Government of India.</>} />;
  } else if (crop === 'Cashew') {
    side = <CashewSidebar states={extra.cashew?.states} state={state} onState={setState} rail={rail} />;
  } else {
    side = <SugarcaneSidebar rail={rail} />;
  }

  // The mandi list for this crop and state has arrived (it lags a state change by one request).
  const listReady = weekly && mandis.length > 0 && mandis[0].crop === crop && mandis[0].state === state;

  function page() {
    switch (view) {
      case 'about': return <AboutView meta={meta} section={section} onSection={setSection} />;
      case 'accuracy': return <AccuracyView />;
      case 'market':
        if (!weekly) return null;
        if (!market) return <ChooseFirst what="mandi" crop={crop} state={state} />;
        if (!listReady || !mandis.some(m => m.market === market)) return <MarketSkeleton label={`Loading ${market}`} />;
        return <MarketView crop={crop} state={state} market={market} meta={meta} />;
      case 'compare':
        if (!weekly) return null;
        if (!state) return <ChooseFirst what="state" crop={crop} states={cropMeta.states} onState={chooseState} />;
        if (!listReady) return <Wait label={`Loading ${crop.toLowerCase()} mandis…`} />;
        return <CompareView crop={crop} state={state} market={market} mandis={mandis} onMarket={chooseMarket}
          onOpen={m => openMarket(state, m)} />;
      default:
        if (weekly) return <OverviewView crop={crop} onState={chooseState} onPick={openMarket} />;
        if (!extra[extraKey]) return <MarketSkeleton label={`Loading ${crop.toLowerCase()} prices`} />;
        return crop === 'Cashew'
          ? <CashewView data={extra.cashew} state={state} onState={setState} />
          : <SugarcaneView data={extra.sugarcane} />;
    }
  }

  // The About page stands on its own: no crop switcher, side panel, search or notice, only the tabs to go back.
  const plain = view === 'about';
  const pageTabs = <Tabs items={tabs.map(([value, label]) => ({ value, label }))} value={view} onChange={setView} label="Page"
    className="tabs" tabRef={tabsRef} />;

  return (
    <div className={`app${plain ? ' app-plain' : ''}`}>
      <a className="skip" href="#main">Skip to content</a>
      {!plain && side}
      <main className="main" id="main">
        {plain ? (
          <div className="topbar topbar-plain"><Brand />{pageTabs}</div>
        ) : (
          <div className="topbar">
            <CropSwitch items={meta.crops.map(c => ({ value: c.id, label: c.id }))} value={crop} onChange={setCrop} />
            {pageTabs}
            <SearchButton crops={meta.crops} onPick={pick => {
              if (pick.crop) { setCrop(pick.crop); setState(pick.state ?? null); setMarket(pick.market ?? null); }
              setView(pick.view);
            }} />
          </div>
        )}
        {!plain && <Notice />}
        <div className="page">
          <Suspense fallback={view === 'market' || view === 'overview' ? <MarketSkeleton label="Loading" /> : <Wait />}>
            {page()}
          </Suspense>
        </div>
      </main>
    </div>
  );
}

// Shown when a page needs a choice the visitor hasn't made yet. Nothing is picked for them.
function ChooseFirst({ what, crop, state, states = [], onState }) {
  if (what === 'state') {
    return (
      <section className="panel choose-first">
        <h2>Choose a state to compare its mandis</h2>
        <p className="sub">Each state’s mandis are compared on their latest weekly price.</p>
        <div className="chips">{[...states].sort((a, b) => b.count - a.count).map(s => (
          <button key={s.name} type="button" className="chip" onClick={() => onState(s.name)}>{s.name}<span>{s.count}</span></button>
        ))}</div>
      </section>
    );
  }
  return (
    <section className="panel choose-first">
      <h2>Choose a {crop.toLowerCase()} mandi</h2>
      <p className="sub">{state
        ? `Pick one of the ${state} mandis from the list on the left, or search all of India.`
        : 'Choose a state and a mandi from the panel on the left, or search all of India.'}</p>
      <div className="choose-actions">
        <button type="button" className="btn primary" onClick={openSidePanel}>Open the mandi list</button>
        <button type="button" className="btn" onClick={openSearch}>Search all mandis</button>
      </div>
    </section>
  );
}
