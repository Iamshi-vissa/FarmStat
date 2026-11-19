import { useCallback, useEffect, useRef } from 'react';
import './LineSidebar.css';

// React Bits LineSidebar (David Haz, MIT + Commons Clause; see LICENSE.md): a list of sections on a ruled margin; the
// items near the pointer slide out and take the accent colour. FarmStat keeps the look it uses (index numbers, markers,
// growing ticks) and drops the other options; the active item is controlled by the page, and with reduced motion the
// items don't follow the pointer.
const SMOOTHING = 0.1;                       // seconds for the effect to settle
const smooth = p => p * p * (3 - 2 * p);

export default function LineSidebar({ items, activeIndex, onItemClick, label = 'Sections', accentColor, textColor, markerColor,
  markerLength = 22, markerGap = 10, tickScale = 0.4, maxShift = 6, itemGap = 11, fontSize = 0.875, proximityRadius = 60 }) {
  const listRef = useRef(null);
  const itemRefs = useRef([]);
  const targets = useRef([]);
  const current = useRef([]);
  const raf = useRef(0);
  const last = useRef(0);
  const active = useRef(activeIndex);
  active.current = activeIndex;

  // one animation loop eases every item's --effect (0 to 1) toward its target, then stops
  const frame = useCallback(now => {
    const k = 1 - Math.exp(-Math.min((now - last.current) / 1000, 0.05) / SMOOTHING);
    last.current = now;
    let moving = false;
    itemRefs.current.forEach((el, i) => {
      if (!el) return;
      const target = Math.max(targets.current[i] || 0, active.current === i ? 1 : 0);
      const next = (current.current[i] || 0) + (target - (current.current[i] || 0)) * k;
      const value = Math.abs(target - next) < 0.0015 ? target : next;
      if (value !== target) moving = true;
      current.current[i] = value;
      el.style.setProperty('--effect', value.toFixed(4));
    });
    raf.current = moving ? requestAnimationFrame(frame) : 0;
  }, []);
  const start = useCallback(() => {
    cancelAnimationFrame(raf.current);
    last.current = performance.now();
    raf.current = requestAnimationFrame(frame);
  }, [frame]);

  useEffect(() => { start(); }, [activeIndex, start]);
  useEffect(() => () => cancelAnimationFrame(raf.current), []);

  const onPointerMove = e => {
    if (e.pointerType === 'touch' || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    const y = e.clientY - listRef.current.getBoundingClientRect().top;
    itemRefs.current.forEach((el, i) => {
      if (el) targets.current[i] = smooth(Math.max(0, 1 - Math.abs(y - (el.offsetTop + el.offsetHeight / 2)) / proximityRadius));
    });
    start();
  };
  const onPointerLeave = () => { targets.current = []; start(); };

  return (
    <nav aria-label={label} className="line-sidebar"
      style={{ '--accent-color': accentColor, '--text-color': textColor, '--marker-color': markerColor,
        '--marker-length': `${markerLength}px`, '--marker-gap': `${markerGap}px`, '--tick-scale': tickScale,
        '--max-shift': `${maxShift}px`, '--item-gap': `${itemGap}px`, '--font-size': `${fontSize}rem` }}>
      <ul ref={listRef} className="line-sidebar__list" onPointerMove={onPointerMove} onPointerLeave={onPointerLeave}>
        {items.map((text, i) => (
          <li key={text} ref={el => { itemRefs.current[i] = el; }} className="line-sidebar__item">
            <span className="line-sidebar__marker" aria-hidden="true" />
            <button type="button" className="line-sidebar__label" aria-current={activeIndex === i ? 'true' : undefined}
              onClick={() => onItemClick?.(i)}>
              <span className="line-sidebar__index">{String(i + 1).padStart(2, '0')}</span>
              <span className="line-sidebar__text">{text}</span>
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}
