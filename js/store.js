// ---- Persistence ----------------------------------------------------------
// localStorage, namespaced. Storage can be unavailable (private mode, blocked
// site data), so every access is guarded and the app keeps working in memory.
const Store = (() => {
  const PREFIX = "econocal:";
  function get(key, fallback) {
    try {
      const raw = localStorage.getItem(PREFIX + key);
      return raw == null ? fallback : JSON.parse(raw);
    } catch { return fallback; }
  }
  function set(key, value) {
    try { localStorage.setItem(PREFIX + key, JSON.stringify(value)); return true; }
    catch { return false; }
  }
  return { get, set };
})();
