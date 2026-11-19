import { Suspense, lazy, useCallback, useEffect, useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { api } from '../api.js';
import { SEARCH } from '../events.js';
import { useAppEvent } from '../hooks.js';
import { placeName, rupees } from '../format.js';

// Search the chosen crop's mandis: one box that finds any of them in India by mandi, district or state name.
// The palette code and the mandi index (one compact list for all crops) load only when it is first opened.
const Palette = lazy(() => import('./ui/CommandPalette.jsx'));
let indexPromise;
const loadIndex = () => (indexPromise ??= api('index').catch(e => { indexPromise = null; throw e; }));

export default function SearchButton({ crop, onPick }) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState(null);
  const mac = useMemo(() => /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent), []);

  const show = useCallback(() => {
    setOpen(true);
    loadIndex().then(d => setRows(d.rows)).catch(() => setRows([]));
  }, []);
  useAppEvent(SEARCH, show);   // the rail's search button and other "search" links
  useEffect(() => {   // Ctrl K / ⌘ K
    const onKey = e => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); show(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [show]);

  const items = useMemo(() => (rows ?? []).filter(r => r[0] === crop).map(([, state, market, district, price]) => ({
    id: `m-${state}-${market}`, label: placeName(market), hint: `${district}, ${state}`,
    aside: rupees(price), keywords: `${market} ${district} ${state}`, state, market,
  })), [crop, rows]);
  const what = `${crop.toLowerCase()} mandis`;

  return (
    <>
      <button type="button" className="search-any" onClick={show} onPointerEnter={() => { loadIndex().catch(() => {}); import('./ui/CommandPalette.jsx'); }}
        aria-keyshortcuts={mac ? 'Meta+K' : 'Control+K'} aria-haspopup="dialog" aria-label={`Search ${what}`} title={`Search ${what}`}>
        <Search size={15} aria-hidden="true" /><span>Search {what}</span><kbd>{mac ? '⌘' : 'Ctrl'} K</kbd>
      </button>
      {open && (
        <Suspense fallback={null}>
          <Palette open={open} items={items} loading={rows === null} placeholder={`Search ${what} by mandi, district or state`}
            emptyLabel={`No ${crop.toLowerCase()} mandi matches. Try the district or state name.`}
            onClose={() => setOpen(false)} onSelect={it => { setOpen(false); onPick(it.state, it.market); }} />
        </Suspense>
      )}
    </>
  );
}
