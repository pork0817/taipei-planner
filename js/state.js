// Global game state + tiny event bus + formatting helpers.
export const G = {};

const listeners = {};
export const bus = {
  on(ev, fn) { (listeners[ev] ||= []).push(fn); },
  emit(ev, data) { (listeners[ev] || []).forEach(f => f(data)); },
};

export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export const fmt = {
  num(n) {
    if (!isFinite(n)) return '—';
    const a = Math.abs(n);
    if (a >= 1e9) return (n / 1e9).toFixed(2) + 'B';
    if (a >= 1e6) return (n / 1e6).toFixed(2) + 'M';
    if (a >= 1e4) return (n / 1e3).toFixed(1) + 'K';
    return Math.round(n).toLocaleString();
  },
  // amounts are stored in NT$ millions
  money(m) {
    if (!isFinite(m)) return '∞';
    const a = Math.abs(m), s = m < 0 ? '-' : '';
    if (a >= 1e6) return s + 'NT$' + (a / 1e6).toFixed(2) + 'T';
    if (a >= 1e3) return s + 'NT$' + (a / 1e3).toFixed(1) + 'B';
    return s + 'NT$' + a.toFixed(a < 10 ? 1 : 0) + 'M';
  },
  pct(x, d = 0) { return isFinite(x) ? (x * 100).toFixed(d) + '%' : '—'; },
  km(x) { return x < 1 ? Math.round(x * 1000) + ' m' : x.toFixed(2) + ' km'; },
};

export const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
export const rand = () => Math.random();
