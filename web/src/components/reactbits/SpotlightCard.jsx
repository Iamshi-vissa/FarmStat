import { useRef } from 'react';
import './SpotlightCard.css';

// React Bits SpotlightCard (David Haz, MIT + Commons Clause; see LICENSE.md): a soft light follows the pointer across
// the card. FarmStat keeps only that light: no card chrome (the board's rules are the frame), the position goes into
// two CSS variables without re-rendering, and touch screens get nothing (there is no pointer to follow).
export default function SpotlightCard({ as: Tag = 'div', className = '', color = 'rgba(198, 119, 0, 0.22)', size = 240, children }) {
  const ref = useRef(null);
  const onPointerMove = e => {
    if (e.pointerType === 'touch') return;
    const el = ref.current;
    const box = el.getBoundingClientRect();
    el.style.setProperty('--spot-x', `${e.clientX - box.left}px`);
    el.style.setProperty('--spot-y', `${e.clientY - box.top}px`);
  };
  return (
    <Tag ref={ref} className={`spotlight ${className}`.trim()} onPointerMove={onPointerMove}
      style={{ '--spot-color': color, '--spot-size': `${size}px` }}>
      {children}
    </Tag>
  );
}
