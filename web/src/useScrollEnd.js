import { useEffect } from 'react';

// Marks a sideways-scrolling row with .at-end once it is scrolled to the end (or fits), to drop its edge fade.
export function useScrollEnd(ref) {
  const node = ref.current;   // re-attach when the element appears (e.g. after loading)
  useEffect(() => {
    const el = node;
    if (!el) return undefined;
    const update = () => el.classList.toggle('at-end', el.scrollLeft + el.clientWidth >= el.scrollWidth - 2);
    update();
    el.addEventListener('scroll', update, { passive: true });
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => { el.removeEventListener('scroll', update); ro.disconnect(); };
  }, [node]);
}
