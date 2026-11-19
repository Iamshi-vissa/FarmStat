import { Fragment, useEffect, useRef } from 'react';

// React Bits VariableProximity (David Haz, MIT + Commons Clause; see LICENSE.md): letters near the pointer move along
// the variable font's axes. FarmStat uses Archivo's weight and width axes, so the headline thickens and widens under
// the pointer like a freshly painted signboard letter. Changes: each letter keeps the width it has at rest (measured,
// then fixed), so a wider letter spills a little into its neighbours instead of pushing the line into a second line;
// one requestAnimationFrame per pointer move; nothing at all on touch screens or with reduced motion; and screen
// readers get the plain text.
const settings = axes => Object.entries(axes).map(([k, v]) => `'${k}' ${v}`).join(', ');

export default function VariableProximity({ text, as: Tag = 'span', from, to, radius = 150, className = '' }) {
  const ref = useRef(null);
  useEffect(() => {
    const root = ref.current;
    if (!root || !window.matchMedia?.('(hover: hover) and (pointer: fine)').matches
      || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return undefined;
    const letters = [...root.querySelectorAll('.vp-letter')];
    const axes = Object.keys(from);
    let raf = 0, px = 0, py = 0, active = false;
    const fix = () => {   // measure every letter at rest, then pin its width (the headline's size follows the window)
      letters.forEach(l => { l.style.width = ''; l.style.fontVariationSettings = ''; });
      const widths = letters.map(l => l.getBoundingClientRect().width);
      letters.forEach((l, i) => { l.style.width = `${widths[i]}px`; });
      active = false;
    };
    const paint = () => {
      raf = 0;
      const boxes = letters.map(l => l.getBoundingClientRect());
      boxes.forEach((b, i) => {
        const d = Math.hypot(px - (b.left + b.width / 2), py - (b.top + b.height / 2));
        const t = active ? Math.max(0, 1 - d / radius) : 0;
        letters[i].style.fontVariationSettings = t
          ? settings(Object.fromEntries(axes.map(a => [a, +(from[a] + (to[a] - from[a]) * t).toFixed(1)]))) : '';
      });
    };
    const onMove = e => {
      const b = root.getBoundingClientRect();
      const near = e.clientX > b.left - radius && e.clientX < b.right + radius && e.clientY > b.top - radius && e.clientY < b.bottom + radius;
      if (!near && !active) return;
      active = near; px = e.clientX; py = e.clientY;
      raf ||= requestAnimationFrame(paint);
    };
    fix();
    document.fonts?.ready.then(fix);
    root.classList.add('vp-live');
    window.addEventListener('resize', fix);
    window.addEventListener('pointermove', onMove, { passive: true });
    return () => {
      window.removeEventListener('resize', fix);
      window.removeEventListener('pointermove', onMove);
      cancelAnimationFrame(raf);
      root.classList.remove('vp-live');
      letters.forEach(l => { l.style.width = ''; l.style.fontVariationSettings = ''; });
    };
  }, [from, to, radius]);

  const words = text.split(' ');
  return (
    <Tag ref={ref} className={`vp ${className}`.trim()} aria-label={text}>
      {words.map((w, i) => (
        <Fragment key={i}>
          <span className="vp-word" aria-hidden="true">{[...w].map((c, j) => <span key={j} className="vp-letter">{c}</span>)}</span>
          {i < words.length - 1 ? ' ' : null}
        </Fragment>
      ))}
    </Tag>
  );
}
