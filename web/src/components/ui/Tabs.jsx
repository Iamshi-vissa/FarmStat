import { useCallback, useId, useLayoutEffect, useRef, useState } from 'react';

// Tabs with a sliding indicator. Ported from the 21st.dev "Tabs" component by ddoemonn (roving focus, arrow/Home/End keys,
// an indicator measured from the selected tab), re-styled with FarmStat's tokens and animated with a CSS transition
// instead of the motion library so the first screen stays light. `variant="pill"` gives the segmented-control look.
export default function Tabs({ items, value, onChange, label, variant = 'line', className = '', tabRef, role = 'tablist' }) {
  const base = useId();
  const rowRef = useRef(null);
  const nodes = useRef([]);
  const [bar, setBar] = useState(null);
  const index = items.findIndex(i => i.value === value);
  const isTabs = role === 'tablist';

  useLayoutEffect(() => {
    const node = nodes.current[index];
    const row = rowRef.current;
    if (!node || !row) { setBar(null); return undefined; }
    const read = () => setBar(b => (b && b.x === node.offsetLeft && b.w === node.offsetWidth ? b : { x: node.offsetLeft, w: node.offsetWidth }));
    read();
    const ro = new ResizeObserver(read);
    ro.observe(row);
    return () => ro.disconnect();
  }, [index, items]);

  const setRow = useCallback(n => { rowRef.current = n; if (typeof tabRef === 'function') tabRef(n); else if (tabRef) tabRef.current = n; }, [tabRef]);

  const step = (from, dir) => {
    const n = items.length;
    let i = from;
    for (let k = 0; k < n; k += 1) { i = (i + dir + n) % n; if (!items[i].disabled) return i; }
    return from;
  };
  const onKeyDown = e => {
    let to = null;
    if (e.key === 'ArrowRight') to = step(index, 1);
    else if (e.key === 'ArrowLeft') to = step(index, -1);
    else if (e.key === 'Home') to = step(-1, 1);
    else if (e.key === 'End') to = step(items.length, -1);
    if (to == null) return;
    e.preventDefault();
    onChange(items[to].value);
    nodes.current[to]?.focus();
    nodes.current[to]?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  };

  return (
    <div ref={setRow} role={isTabs ? 'tablist' : 'group'} aria-label={label} onKeyDown={onKeyDown}
      className={`ftabs ftabs-${variant} ${className}`}>
      {bar && <span className="ftabs-bar" aria-hidden="true" style={{ width: bar.w, transform: `translateX(${bar.x}px)` }} />}
      {items.map((item, i) => {
        const on = item.value === value;
        return (
          <button key={item.value} ref={n => { nodes.current[i] = n; }} type="button" id={`${base}-${item.value}`}
            {...(isTabs ? { role: 'tab', 'aria-selected': on } : { 'aria-pressed': on })}
            tabIndex={on ? 0 : -1} disabled={item.disabled} title={item.title}
            onClick={() => onChange(item.value)}>
            {/* the bold copy reserves width so the row doesn't shift when the weight changes */}
            <span className="ftabs-label"><span aria-hidden="true" className="ftabs-ghost">{item.label}</span><span>{item.label}</span></span>
          </button>
        );
      })}
    </div>
  );
}
