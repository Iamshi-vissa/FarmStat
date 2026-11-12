import { useLayoutEffect, useRef, useState } from 'react';
import { useScrollEnd } from '../useScrollEnd.js';

// Crop switcher: a segmented control whose forest-green thumb slides to the chosen crop (CSS transition only).
export default function CropSwitch({ items, value, onChange }) {
  const ref = useRef(null);
  const [thumb, setThumb] = useState(null);
  useScrollEnd(ref);
  useLayoutEffect(() => {
    const place = () => {
      const b = ref.current?.querySelector('[aria-checked="true"]');
      if (b) setThumb({ x: b.offsetLeft, w: b.offsetWidth });
    };
    place();
    const ro = new ResizeObserver(place);
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, [value, items.length]);
  useLayoutEffect(() => {   // keep the chosen crop in view when the bar scrolls on phones
    ref.current?.querySelector('[aria-checked="true"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [value]);
  const onKey = e => {
    const i = items.findIndex(x => x.value === value);
    const j = e.key === 'ArrowRight' ? i + 1 : e.key === 'ArrowLeft' ? i - 1 : null;
    if (j == null) return;
    e.preventDefault();
    const next = items[(j + items.length) % items.length].value;
    onChange(next);
    requestAnimationFrame(() => ref.current?.querySelector('[aria-checked="true"]')?.focus());
  };
  return (
    <div className="crops" role="radiogroup" aria-label="Crop" ref={ref} onKeyDown={onKey}>
      {thumb && <span className="crops-thumb" aria-hidden="true" style={{ width: thumb.w, transform: `translateX(${thumb.x - 3}px)` }} />}
      {items.map(it => (
        <button key={it.value} type="button" role="radio" aria-checked={it.value === value} tabIndex={it.value === value ? 0 : -1}
          onClick={() => onChange(it.value)}>{it.label}</button>
      ))}
    </div>
  );
}
