// Descriptive statistics for one mandi's weekly price history (all computed in the browser from /api/series).
const DAY = 864e5;
const ts = s => new Date(s).getTime();
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

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

// A "nice" bin width for a histogram of about `target` bins.
function niceStep(span, target) {
  const raw = span / target, mag = 10 ** Math.floor(Math.log10(raw));
  return [1, 2, 2.5, 5, 10].map(m => m * mag).find(s => s >= raw) ?? 10 * mag;
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

  // seasonal pattern by month: each month vs its year's average, averaged over years with enough reports
  const byYear = new Map();
  for (const x of pts) {
    const d = new Date(x.t), y = d.getFullYear(), m = d.getMonth();
    if (!byYear.has(y)) byYear.set(y, new Map());
    const ym = byYear.get(y);
    ym.set(m, [...(ym.get(m) ?? []), x.p]);
  }
  const rel = Array.from({ length: 12 }, () => []);
  for (const ym of byYear.values()) {
    if (ym.size < 8) continue;
    const means = [...ym.entries()].map(([m, ps]) => [m, ps.reduce((s, v) => s + v, 0) / ps.length]);
    const avg = means.reduce((s, [, v]) => s + v, 0) / means.length;
    for (const [m, v] of means) rel[m].push(v / avg - 1);
  }
  const yearsUsed = Math.max(...rel.map(r => r.length));
  const season = yearsUsed >= 2 && rel.every(r => r.length >= 1)
    ? rel.map((r, m) => ({ month: MONTHS[m], pct: Math.round(median(r) * 1000) / 10, years: r.length }))
    : null;

  // distribution of weekly prices over the last 3 years
  const dist = pts.filter(x => x.t > end - 3 * 364 * DAY).map(x => x.p);
  const dlo = Math.min(...dist), dhi = Math.max(...dist);
  const step = niceStep(dhi - dlo || 1, 14);
  const start = Math.floor(dlo / step) * step;
  const bins = [];
  for (let b = start; b <= dhi; b += step) bins.push({ from: b, to: b + step, n: 0 });
  for (const p of dist) bins[Math.min(bins.length - 1, Math.floor((p - start) / step))].n += 1;
  const todayBin = Math.min(bins.length - 1, Math.max(0, Math.floor((price - start) / step)));
  const distRank = dist.filter(p => p < price).length / dist.length;

  return {
    lo, hi, rank, yoy, yearAgo: ago?.p ?? null, typicalMove, seasonal4w, season, yearsUsed,
    bins: bins.map((b, i) => ({ ...b, today: i === todayBin })), distRank, distWeeks: dist.length,
    currentMonth: MONTHS[new Date(end).getMonth()]
  };
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
