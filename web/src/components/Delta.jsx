import { ArrowDownRight, ArrowRight, ArrowUpRight } from 'lucide-react';
import { pct } from '../format.js';

// Direction is shown by icon + sign + colour, never colour alone.
export default function Delta({ value, flatBelow = 0.005, title, big = false }) {
  if (value == null) return <span className="delta flat">–</span>;
  const dir = value > flatBelow ? 'up' : value < -flatBelow ? 'down' : 'flat';
  const Icon = dir === 'up' ? ArrowUpRight : dir === 'down' ? ArrowDownRight : ArrowRight;
  return (
    <span className={`delta ${dir} num${big ? ' big' : ''}`} title={title}>
      <Icon size={big ? 22 : 13} aria-hidden="true" />
      {pct(value, big ? 0 : 1)}
    </span>
  );
}
