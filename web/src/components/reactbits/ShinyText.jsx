import { useEffect, useRef } from 'react';
import './ShinyText.css';

// React Bits ShinyText (David Haz, MIT + Commons Clause; see LICENSE.md): a band of light sweeps across the text.
// FarmStat runs the sweep once, when the text first scrolls into view (give it a new `key` to run it again), with a CSS
// animation; with reduced motion the text is simply shown in its colour.
export default function ShinyText({ text, color, shineColor, speed = 1.6, className = '' }) {
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const io = new IntersectionObserver(entries => {
      if (entries.some(e => e.isIntersecting)) { el.classList.add('shiny-text--run'); io.disconnect(); }
    });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    <span ref={ref} className={`shiny-text ${className}`.trim()}
      style={{ '--shiny-base': color, '--shiny-light': shineColor, '--shiny-speed': `${speed}s` }}>
      {text}
    </span>
  );
}
