const inr = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });

export const rupees = v => (v == null ? '–' : `₹${inr.format(Math.round(v))}`);
export const plain = v => (v == null ? '–' : inr.format(Math.round(v)));
export const compactRupees = v => {
  if (v == null) return '–';
  if (Math.abs(v) >= 100000) return `₹${(v / 100000).toFixed(1)}L`;
  if (Math.abs(v) >= 10000) return `₹${(v / 1000).toFixed(1)}k`;
  return rupees(v);
};
// Signed percentage with a real minus sign (−), and no sign on a value that rounds to zero.
export const pct = (v, digits = 1) => {
  if (v == null) return '–';
  const s = Math.abs(v * 100).toFixed(digits);
  return `${Number(s) === 0 ? '' : v > 0 ? '+' : '−'}${s}%`;
};
export const pct0 = v => (v == null ? '–' : `${Math.round(v * 100)}%`);
export const weeks = h => `${h} week${h > 1 ? 's' : ''}`;
export const months = h => `${h} month${h > 1 ? 's' : ''}`;

const dfmt = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
const mfmt = new Intl.DateTimeFormat('en-IN', { month: 'short', year: 'numeric' });
export const date = s => (s ? dfmt.format(new Date(s)) : '–');
export const monthLabel = s => (s ? mfmt.format(new Date(s)) : '–');
export const axisDate = s => mfmt.format(new Date(s));
