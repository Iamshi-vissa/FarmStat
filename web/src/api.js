// Small fetch helper for the FarmStat API (same origin in production, proxied in development).
// Responses are kept for the visit, and a request already on its way is shared rather than sent twice.
const cache = new Map();

export function api(path, params = {}) {
  const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v != null && v !== ''));
  const url = `/api/${path}${qs.toString() ? `?${qs}` : ''}`;
  if (!cache.has(url)) {
    const request = fetch(url).then(async res => {
      if (!res.ok) {
        let detail = `${res.status} ${res.statusText}`;
        try { detail = (await res.json()).detail || detail; } catch { /* keep status text */ }
        throw new Error(detail);
      }
      return res.json();
    });
    request.catch(() => cache.delete(url));   // a failed request can be tried again
    cache.set(url, request);
  }
  return cache.get(url);
}
