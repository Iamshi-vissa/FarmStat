import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react';
import { pct } from '../format.js';

// Direction is shown by icon + sign + colour, never colour alone.
export default function Delta({ value, flatBelow = 0.005, title }) {
  if (value == null) return <span className="delta flat">–</span>;
  const dir = value > flatBelow ? 'up' : value < -flatBelow ? 'down' : 'flat';
  const Icon = dir === 'up' ? ArrowUpRight : dir === 'down' ? ArrowDownRight : Minus;
  return (
    <span className={`delta ${dir} num`} title={title}>
      <Icon size={13} aria-hidden="true" />
      {pct(value)}
    </span>
  );
}
