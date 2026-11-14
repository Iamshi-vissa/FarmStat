import { useEffect, useState } from 'react';

// True while a media query matches, e.g. useMedia('(max-width: 640px)').
export function useMedia(query) {
  const [on, setOn] = useState(() => typeof window !== 'undefined' && window.matchMedia(query).matches);
  useEffect(() => {
    const m = window.matchMedia(query);
    const update = () => setOn(m.matches);
    update();
    m.addEventListener('change', update);
    return () => m.removeEventListener('change', update);
  }, [query]);
  return on;
}

// Phone-width screens: charts shrink margins, heights and labels.
export const useNarrow = () => useMedia('(max-width: 640px)');
// Wide enough for the icon rail and the hover panel (below this the panel is the page header).
export const useDesktop = () => useMedia('(min-width: 861px)');

// Marks a sideways-scrolling row with .at-end once it is scrolled to the end (or fits), to drop its edge fade.
export function useScrollEnd(ref) {
  const node = ref.current;   // re-attach when the element appears (e.g. after loading)
  useEffect(() => {
    const el = node;
    if (!el) return undefined;
    const update = () => {
      el.classList.toggle('at-end', el.scrollLeft + el.clientWidth >= el.scrollWidth - 2);
      el.classList.toggle('scrolled', el.scrollLeft > 2);
    };
    update();
    el.addEventListener('scroll', update, { passive: true });
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => { el.removeEventListener('scroll', update); ro.disconnect(); };
  }, [node]);
}

// Listen to one of the app-wide events in events.js while a component is mounted.
export function useAppEvent(name, handler) {
  useEffect(() => {
    window.addEventListener(name, handler);
    return () => window.removeEventListener(name, handler);
  }, [name, handler]);
}
