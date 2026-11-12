import { useEffect, useState } from 'react';

// True on phone-width screens; charts use it to shrink margins, heights and labels.
export function useNarrow(query = '(max-width: 640px)') {
  const get = () => typeof window !== 'undefined' && window.matchMedia(query).matches;
  const [narrow, setNarrow] = useState(get);
  useEffect(() => {
    const m = window.matchMedia(query);
    const on = () => setNarrow(m.matches);
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, [query]);
  return narrow;
}
