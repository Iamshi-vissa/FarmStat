import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Search } from 'lucide-react';

// Search-anywhere palette (Ctrl/⌘ K). Ported from the 21st.dev "Command Palette" by ddoemonn: the fuzzy ranking
// (prefix and word-boundary bonuses, streaks), arrow/Home/End/Enter/Escape keys, pointer hover that ignores scroll,
// a polite result count for screen readers, scroll lock and click-outside to close. Restyled with FarmStat tokens and
// animated with CSS (no motion library). Items: { id, label, hint, keywords, group, aside }.
const BOUNDARY = /[\s\-_/.:(),]/;
const MAX = 60;

function scoreOne(text, query) {
  const t = text.toLowerCase();
  let cursor = 0, total = 0, streak = 0;
  for (let i = 0; i < query.length; i += 1) {
    const at = t.indexOf(query[i], cursor);
    if (at < 0) return -1;
    streak = at === cursor && i > 0 ? streak + 1 : 0;
    total += 2 + streak * 4;
    if (at === 0) total += 12;
    else if (BOUNDARY.test(t[at - 1])) total += 8;
    cursor = at + 1;
  }
  return total;
}

export function rank(items, query) {
  // every word of the query must match the label or the keywords ("kolar tom" = Kolar district, tomato)
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return items.slice(0, MAX);
  const scored = [];
  for (let i = 0; i < items.length; i += 1) {
    const it = items[i];
    let total = 0;
    for (const w of words) {
      const best = Math.max(scoreOne(it.label, w), it.keywords ? scoreOne(it.keywords, w) - 3 : -1);
      if (best < 0) { total = -1; break; }
      total += best;
    }
    if (total < 0) continue;
    scored.push({ it, score: total - it.label.length * 0.05, i });
  }
  scored.sort((a, b) => b.score - a.score || a.i - b.i);
  return scored.slice(0, MAX).map(s => s.it);
}

export default function CommandPalette({ open, items, onSelect, onClose, placeholder = 'Search', emptyLabel = 'Nothing matches', loading }) {
  const uid = useId();
  const [query, setQuery] = useState('');
  const [pinned, setPinned] = useState(null);
  const listRef = useRef(null);
  const inputRef = useRef(null);
  const pointer = useRef({ x: -1, y: -1 });
  const returnFocus = useRef(null);

  const results = useMemo(() => rank(items, query), [items, query]);
  const activeId = results.some(r => r.id === pinned) ? pinned : results[0]?.id ?? null;
  const activeIndex = results.findIndex(r => r.id === activeId);

  useEffect(() => {
    if (!open) return undefined;
    returnFocus.current = document.activeElement;
    setQuery('');
    setPinned(null);
    requestAnimationFrame(() => inputRef.current?.focus({ preventScroll: true }));
    const root = document.documentElement;
    const prev = [root.style.overflow, root.style.paddingRight];
    const gutter = window.innerWidth - root.clientWidth;
    root.style.overflow = 'hidden';
    if (gutter > 0) root.style.paddingRight = `${gutter}px`;
    return () => {
      [root.style.overflow, root.style.paddingRight] = prev;
      returnFocus.current?.focus?.({ preventScroll: true });
    };
  }, [open]);

  useEffect(() => { if (listRef.current) listRef.current.scrollTop = 0; }, [query]);

  const reveal = i => {
    const list = listRef.current;
    const row = list?.children[i];
    if (!list || !(row instanceof HTMLElement)) return;
    if (row.offsetTop - 6 < list.scrollTop) list.scrollTop = row.offsetTop - 6;
    else if (row.offsetTop + row.offsetHeight + 6 > list.scrollTop + list.clientHeight) list.scrollTop = row.offsetTop + row.offsetHeight + 6 - list.clientHeight;
  };
  const jump = i => {
    if (!results.length) return;
    const n = Math.max(0, Math.min(results.length - 1, i));
    setPinned(results[n].id);
    reveal(n);
  };
  const onKeyDown = e => {
    const from = activeIndex < 0 ? 0 : activeIndex;
    const go = {
      ArrowDown: () => jump((from + 1) % Math.max(1, results.length)),
      ArrowUp: () => jump((from - 1 + results.length) % Math.max(1, results.length)),
      Home: () => jump(0), End: () => jump(results.length - 1),
      Enter: () => { const t = results[activeIndex]; if (t) onSelect(t); },
      Escape: () => onClose(),
    }[e.key];
    if (!go) return;
    e.preventDefault();
    go();
  };
  const hover = (id, e) => {
    const { x, y } = pointer.current;
    if (e.clientX === x && e.clientY === y) return;   // the list scrolled under a still pointer
    pointer.current = { x: e.clientX, y: e.clientY };
    if (id !== activeId) setPinned(id);
  };

  if (!open) return null;
  return createPortal(
    <div className="cmdk-layer" onPointerDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="cmdk" role="dialog" aria-modal="true" aria-label="Search FarmStat">
        <div className="cmdk-input">
          <Search size={16} aria-hidden="true" />
          <input ref={inputRef} type="text" role="combobox" aria-expanded="true" aria-controls={`${uid}-list`}
            aria-autocomplete="list" aria-activedescendant={activeId ? `${uid}-${activeId}` : undefined}
            autoComplete="off" spellCheck={false} value={query} placeholder={placeholder}
            onChange={e => setQuery(e.target.value)} onKeyDown={onKeyDown} />
          <kbd>Esc</kbd>
        </div>
        <ul ref={listRef} id={`${uid}-list`} role="listbox" aria-label="Results" className="cmdk-list"
          onMouseDown={e => e.preventDefault()}>
          {results.map((it, i) => {
            const on = it.id === activeId;
            const head = it.group && it.group !== results[i - 1]?.group;
            return (
              <li key={it.id} id={`${uid}-${it.id}`} role="option" aria-selected={on} data-group={head ? it.group : undefined}
                className={head ? 'cmdk-row cmdk-head' : 'cmdk-row'}
                onPointerMove={e => hover(it.id, e)} onClick={() => onSelect(it)}>
                <span className="cmdk-label">{it.label}</span>
                {it.hint && <span className="cmdk-hint">{it.hint}</span>}
                {it.aside && <span className="cmdk-aside num">{it.aside}</span>}
              </li>
            );
          })}
        </ul>
        {results.length === 0 && <p className="cmdk-empty">{loading ? 'Loading every mandi…' : emptyLabel}</p>}
        <div className="cmdk-foot" aria-hidden="true"><span><kbd>↑</kbd><kbd>↓</kbd> move</span><span><kbd>Enter</kbd> open</span>
          <span className="cmdk-count">{results.length}{results.length === MAX ? '+' : ''} shown</span></div>
        <span role="status" aria-live="polite" className="sr">{results.length ? `${results.length} results` : emptyLabel}</span>
      </div>
    </div>,
    document.body,
  );
}
