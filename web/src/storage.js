// On/off settings kept in this browser. Storage can be blocked (private modes, embedded views): then nothing is remembered.
export function readFlag(key) {
  try { return localStorage.getItem(key) === '1'; } catch { return false; }
}
export function writeFlag(key, on) {
  try { localStorage.setItem(key, on ? '1' : '0'); } catch { /* storage unavailable */ }
}
