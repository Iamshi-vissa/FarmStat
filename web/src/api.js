// Small fetch helper for the FarmStat API (same origin in production, proxied in development).
const cache = new Map();

export async function api(path, params = {}) {
  const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v != null && v !== ''));
  const url = `/api/${path}${qs.toString() ? `?${qs}` : ''}`;
  if (cache.has(url)) return cache.get(url);
  const res = await fetch(url);
  if (!res.ok) {
    let detail = `${res.status} ${res.statusText}`;
    try { detail = (await res.json()).detail || detail; } catch { /* keep status text */ }
    throw new Error(detail);
  }
  const data = await res.json();
  cache.set(url, data);
  return data;
}
