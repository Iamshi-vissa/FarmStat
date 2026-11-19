import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ChevronDown, Info, Pin, PinOff, X } from 'lucide-react';
import { api } from '../api.js';
import { PANEL } from '../events.js';
import { date } from '../format.js';
import { useAppEvent, useDesktop } from '../hooks.js';
import { readFlag, writeFlag } from '../storage.js';

const NOTICE_KEY = 'farmstat-notice-v1';
const PIN_KEY = 'farmstat-panel-pinned';
const PEEK_GRACE = 220;   // ms the panel stays while the pointer travels from the rail into it
const PEEK_INTENT = 140;  // ms the pointer must rest on the rail before the panel opens (passing over it does nothing)

// The logo, drawn as if by hand with a felt pen: an onion with its sprout on a wobbly white tile, and a marigold
// squiggle under the name. Every line is a little uneven and the bulb is gone over twice, like a sketch.
export function LogoMark({ size = 32 }) {
  return (
    <svg className="logo-mark" width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <path d="M5.2 3.6C11.4 2.5 20.6 2.9 27.3 3.9 29.1 10.2 29.5 20.8 28.3 27.7 21.1 29.3 10.7 29.4 4.3 28.4 2.7 21.2 2.8 10.4 5.2 3.6Z"
        className="logo-tile" />
      <g fill="none" strokeLinecap="round" strokeLinejoin="round">
        <path d="M16.1 11.8C11.3 12.6 8.7 16.4 9.3 20.6 10 24.9 13.5 26.5 16.3 26.4 19.8 26.2 23 23.7 22.8 19.5 22.6 15.5 19.9 12.7 16.1 11.8Z"
          className="logo-bulb" strokeWidth="1.9" />
        <path d="M15.7 12.3C11.9 13.4 9.9 16.8 10.2 20.3 10.6 24 13.4 25.8 16 25.9" className="logo-ink" strokeWidth=".9" opacity=".55" />
        <path d="M16 12.4C13.8 15.6 13.5 21.4 15.8 25.9M16.4 12.5C18.5 15.9 18.7 21.6 16.8 25.8" className="logo-ink" strokeWidth="1.2" />
        <path d="M16 11.9C15.7 9.1 14.2 6.9 11.7 5.8M16.2 11.7C16.7 8.8 18.4 6.7 21.3 6.1M16.1 11.8C16.3 9.6 16.2 7.5 15.6 5.3"
          className="logo-leaf" strokeWidth="1.8" />
        <path d="M14.4 26.6 13.8 28M16.3 26.8 16.4 28.3M18.1 26.3 18.9 27.6" className="logo-ink" strokeWidth="1.1" />
      </g>
    </svg>
  );
}

// The name, which also leads back to the home page (the crop choice).
export function Brand() {
  return (
    <a className="brand" href="#view=home" aria-label="FarmStat home: choose a crop">
      <LogoMark />
      <span>
        <span className="brand-mark">FarmStat
          <svg className="brand-swash" viewBox="0 0 100 8" preserveAspectRatio="none" aria-hidden="true">
            <path d="M1.5 5.2C14 3.1 27 6.4 40.5 4.3 54 2.4 66.5 5.9 80 4 87.5 3 93.5 3.6 98.5 2.6" fill="none" strokeWidth="2.2" strokeLinecap="round" />
          </svg>
        </span>
        <span className="brand-sub">mandi price forecasts</span>
      </span>
    </a>
  );
}

function SideLinks() {
  return (
    <nav className="side-links" aria-label="Policies">
      <a href="#view=about&section=terms">Terms</a>
      <a href="#view=about&section=risks">Risks</a>
      <a href="#view=about&section=privacy">Privacy</a>
      <a href="#view=about&section=data">Data</a>
    </nav>
  );
}

// When the live feed last brought in prices (shared by every sidebar; fetched once).
let statusPromise = null;
function LiveStatus() {
  const [s, setS] = useState(null);
  useEffect(() => {
    statusPromise ??= api('live/status').catch(() => ({ available: false }));
    statusPromise.then(setS);
  }, []);
  if (!s) return null;
  if (!s.available || !s.latest_price_date) return <div className="live-status off">Live feed: not reachable right now</div>;
  const at = s.last_fetch?.finished_at ?? s.last_fetch?.started_at;
  const time = at ? new Date(at).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' }) : null;
  return (
    <div className="live-status"><i aria-hidden="true" />Live feed: prices to {date(s.latest_price_date)}
      {at && <>, checked {date(at)}{time ? ` at ${time}` : ''}</>}</div>
  );
}

// Sidebar frame.
// Desktop: a slim icon rail (the mandi panel and search; pages live in the tabs). Hovering or focusing it slides the panel with the state picker and
// mandi list out over the page; pinning docks the panel beside the page instead. Ported from the 21st.dev "Rail Panel
// Sidebar" by dhxwhy (hover peek with a grace period, pin to dock, Escape and click-outside to close, a sliding active
// marker on the rail, arrow keys between rail buttons), rebuilt with FarmStat's tokens and CSS transitions.
// Phones: a compact header with a button showing the current choice; the panel opens below it.
export function SideShell({ label, current, placeholder, footer, rail = [], children }) {
  const [open, setOpen] = useState(false);          // phone drop-down
  const [peek, setPeek] = useState(false);          // desktop hover panel
  const [pinned, setPinned] = useState(() => readFlag(PIN_KEY));
  const aside = useRef(null);
  const timer = useRef(0);
  const over = useRef(false);   // the pointer is over the rail or the panel
  const marker = useRef(null);
  const buttons = useRef({});
  const desktop = useDesktop();

  const clear = () => { window.clearTimeout(timer.current); timer.current = 0; };
  const show = useCallback(() => { clear(); setPeek(true); }, []);
  const hide = useCallback(() => { clear(); setPeek(false); }, []);
  const showSoon = () => { clear(); timer.current = window.setTimeout(() => { timer.current = 0; setPeek(true); }, PEEK_INTENT); };
  const hideSoon = () => {
    // a native drop-down (the state picker) draws outside the page, so the pointer "leaves" while choosing: stay open
    if (document.activeElement?.tagName === 'SELECT' && aside.current?.contains(document.activeElement)) return;
    if (over.current) return;   // still over the panel (focus moved, the pointer didn't): stay open
    clear();
    timer.current = window.setTimeout(() => { timer.current = 0; setPeek(false); }, PEEK_GRACE);
  };

  // A mandi was chosen: get out of the way. Choosing a state clears the mandi, and the panel must stay open for the
  // visitor to pick one, so only a new mandi closes it.
  useEffect(() => { if (current) { setOpen(false); setPeek(false); } }, [current]);
  useAppEvent(PANEL, useCallback(() => { setOpen(true); setPeek(true); }, []));
  useEffect(() => () => window.clearTimeout(timer.current), []);
  // A tap or click outside, or Escape from anywhere on the page, closes the desktop peek and the phone drop-down.
  const floating = desktop ? peek && !pinned : open;
  useEffect(() => {
    if (!floating) return undefined;
    const close = () => { hide(); setOpen(false); };
    const onDown = e => { if (aside.current && !aside.current.contains(e.target)) close(); };
    const onKey = e => { if (e.key === 'Escape' && !document.querySelector('.cmdk')) close(); };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('pointerdown', onDown); document.removeEventListener('keydown', onKey); };
  }, [floating, hide]);
  useEffect(() => { document.documentElement.dataset.panel = pinned ? 'pinned' : 'rail'; }, [pinned]);

  const togglePin = () => {
    const next = !pinned;
    setPinned(next);
    setPeek(false);
    writeFlag(PIN_KEY, next);
  };

  const active = rail.find(r => r.active)?.id;
  useLayoutEffect(() => {   // slide the marker to the active rail button
    const b = buttons.current[active];
    if (!marker.current) return;
    marker.current.style.opacity = b ? '1' : '0';
    if (b) marker.current.style.transform = `translateY(${b.offsetTop}px)`;
  }, [active, rail.length]);

  const onRailKeys = e => {
    const ids = rail.map(r => r.id);
    const at = ids.indexOf(e.target.dataset?.rail);
    if (at < 0) return;
    const next = { ArrowDown: at + 1, ArrowUp: at - 1, Home: 0, End: ids.length - 1 }[e.key];
    if (next == null) return;
    e.preventDefault();
    buttons.current[ids[(next + ids.length) % ids.length]]?.focus();
  };

  const hidden = desktop && !(pinned || peek);   // on phones the panel is the header, always there
  return (
    <aside className="side" aria-label={label} ref={aside} data-open={open} data-peek={peek && !pinned} data-pinned={pinned}
      onPointerEnter={e => { if (e.pointerType === 'touch') return; over.current = true; if (!pinned && peek) show(); }}
      // Open only when the pointer moves over the rail. A rail that appears under a still pointer (after Back, or after
      // leaving the About page) must not open the panel over what the visitor was about to click.
      onPointerMove={e => { if (e.pointerType !== 'touch' && !pinned && !peek && !timer.current) showSoon(); }}
      onPointerLeave={e => { if (e.pointerType === 'touch') return; over.current = false; if (!pinned) hideSoon(); }}
      onFocus={e => { if (!pinned && e.target.matches?.('.side-panel :focus-visible, .rail-btn[data-panel]:focus-visible')) show(); }}
      // Close when keyboard focus moves to something outside. Focus that just drops (the chosen state's chip disappears,
      // the drop-down is closed) has no new target, and must not close the panel.
      onBlur={e => { if (!pinned && e.relatedTarget && !aside.current?.contains(e.relatedTarget)) hideSoon(); }}
      onKeyDown={e => { if (e.key === 'Escape' && peek && !pinned && aside.current?.contains(document.activeElement)) buttons.current[active]?.focus(); }}>
      <nav className="rail" aria-label="Mandis and search" onKeyDown={onRailKeys}>
        <div className="rail-list">
          <span className="rail-marker" ref={marker} aria-hidden="true" />
          {rail.map(r => (
            <button key={r.id} type="button" className="rail-btn" data-rail={r.id} data-panel={r.panel ? '' : undefined}
              ref={n => { buttons.current[r.id] = n; }} aria-label={r.label} title={r.label}
              aria-current={r.active ? 'page' : undefined} tabIndex={r.active || (!active && r === rail[0]) ? 0 : -1}
              onClick={() => { if (r.panel) show(); r.onClick?.(); }}>
              {r.icon}
              <span className="rail-tip" aria-hidden="true">{r.label}</span>
            </button>
          ))}
        </div>
        <button type="button" className="rail-btn rail-pin" aria-pressed={pinned} onClick={togglePin}
          aria-label={pinned ? 'Unpin the side panel' : 'Pin the side panel open'} title={pinned ? 'Unpin panel' : 'Pin panel open'}>
          {pinned ? <Pin size={18} aria-hidden="true" /> : <PinOff size={18} aria-hidden="true" />}
        </button>
      </nav>
      <div className="side-panel" aria-hidden={hidden ? 'true' : undefined} inert={hidden}>
        <div className="side-head">
          <Brand />
          <span className="side-title">{label}</span>
          {!pinned && (
            <button type="button" className="side-close" onClick={hide} aria-label="Close the panel" title="Close (Esc)">
              <X size={18} aria-hidden="true" />
            </button>
          )}
          <button type="button" className="side-toggle" aria-expanded={open} onClick={() => setOpen(o => !o)}>
            <span>{current || placeholder || 'Choose'}</span><ChevronDown size={16} aria-hidden="true" />
          </button>
        </div>
        <div className="side-body">
          {children}
          <div className="side-foot">{footer}<LiveStatus /><SideLinks /></div>
        </div>
      </div>
    </aside>
  );
}

// Shown once: forecasts are estimates, with a link to the risks. Closing it is remembered in this browser.
export function Notice() {
  const [open, setOpen] = useState(() => !readFlag(NOTICE_KEY));
  if (!open) return null;
  const close = () => { writeFlag(NOTICE_KEY, true); setOpen(false); };
  return (
    <div className="notice" role="note">
      <Info size={16} aria-hidden="true" />
      <p>FarmStat’s prices are estimates from past data, not guarantees or official rates. Check the day’s rate at the mandi
        before you sell. <a href="#view=about&section=risks">Read the risks</a> and <a href="#view=about&section=terms">terms of use</a>.</p>
      <button type="button" onClick={close}>Got it</button>
    </div>
  );
}
