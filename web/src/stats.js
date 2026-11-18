// Descriptive statistics for one mandi's weekly price history (computed in the browser from /api/series), and chart ticks.
const DAY = 864e5;
const ts = s => new Date(s).getTime();

export function quantile(sorted, q) {
  if (!sorted.length) return null;
  const i = (sorted.length - 1) * q, lo = Math.floor(i), hi = Math.ceil(i);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
}
const median = xs => quantile([...xs].sort((a, b) => a - b), 0.5);

// The price reported nearest to time t, if one is within `tol` days.
function near(pts, t, tol = 10) {
  let best = null;
  for (const x of pts) if (Math.abs(x.t - t) <= tol * DAY && (!best || Math.abs(x.t - t) < Math.abs(best.t - t))) best = x;
  return best;
}

export function priceStats(history, latestWeek, price) {
  const end = ts(latestWeek);
  const pts = history.filter(h => h.price != null).map(h => ({ t: ts(h.week), p: h.price })).sort((a, b) => a.t - b.t);
  if (pts.length < 8) return null;

  // 52-week range and where today sits in it
  const year = pts.filter(x => x.t > end - 364 * DAY);
  const yp = year.map(x => x.p);
  const lo = Math.min(...yp), hi = Math.max(...yp);
  const rank = yp.filter(p => p < price).length / yp.length;

  // vs the same week a year ago
  const ago = near(pts, end - 364 * DAY);
  const yoy = ago ? price / ago.p - 1 : null;

  // typical weekly move: median absolute change between consecutive weekly reports, last 26 weeks
  const recent = pts.filter(x => x.t > end - 26 * 7 * DAY);
  const moves = [];
  for (let i = 1; i < recent.length; i++) {
    if (recent[i].t - recent[i - 1].t <= 10 * DAY) moves.push(Math.abs(recent[i].p / recent[i - 1].p - 1));
  }
  const typicalMove = moves.length >= 6 ? median(moves) : null;

  // seasonal base rate: how prices moved over the same 4 weeks in earlier years
  const past = [];
  for (let y = 1; y <= 6; y++) {
    const a = near(pts, end - y * 364 * DAY), b = near(pts, end - y * 364 * DAY + 28 * DAY);
    if (a && b) past.push({ year: new Date(a.t).getFullYear(), change: b.p / a.p - 1 });
  }
  const seasonal4w = past.length >= 2
    ? { median: median(past.map(x => x.change)), min: Math.min(...past.map(x => x.change)), max: Math.max(...past.map(x => x.change)), years: past }
    : null;

  return { lo, hi, rank, yoy, yearAgo: ago?.p ?? null, typicalMove, seasonal4w };
}

// Round, evenly spaced y-ticks (1 / 2 / 2.5 / 5 × 10^k)
export function niceTicks(lo, hi, count = 5) {
  if (!(hi > lo)) return { domain: [lo * 0.9, hi * 1.1 || 1], ticks: undefined };
  const raw = (hi - lo) / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map(m => m * mag).find(s => s >= raw);
  const start = Math.floor(lo / step) * step, end = Math.ceil(hi / step) * step;
  const ticks = [];
  for (let v = start; v <= end + step / 2; v += step) ticks.push(Math.round(v));
  return { domain: [start, end], ticks };
}
