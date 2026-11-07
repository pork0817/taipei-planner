import { G } from './state.js';
import { createWorld } from './world.js';
import { refreshDerived, economy, computeScore } from './sim.js';
import { assess } from './traffic.js';
import { updateAccess } from './roads.js';
import { recomputeAllRoutes } from './transit.js';

const KEY = 'taipei-planner-save-v1';

const b64 = arr => { let s = ''; for (let i = 0; i < arr.length; i += 8192) s += String.fromCharCode.apply(null, arr.subarray(i, i + 8192)); return btoa(s); };
const unb64 = (str, n) => { const s = atob(str); const a = new Uint8Array(n); for (let i = 0; i < n; i++) a[i] = s.charCodeAt(i); return a; };

export function hasSave() { try { return !!localStorage.getItem(KEY); } catch { return false; } }

export function saveGame() {
  const g = G.grid;
  const data = {
    v: 1, year: G.year, month: G.month, tick: G.tick, sandbox: G.sandbox, funds: isFinite(G.funds) ? G.funds : null,
    attract: G.attract, occ: G.occ, history: G.history, news: G.news, firedEvents: G.firedEvents, finance: G.finance,
    grid: { zone: b64(g.zone), level: b64(g.level), special: b64(g.special), seeded: b64(g.seeded), hcap: b64(g.hcap), bstyle: b64(g.bstyle) },
    laws: G.districts.map(d => d.law),
    net: G.net, transit: G.transit,
  };
  try {
    localStorage.setItem(KEY, JSON.stringify(data, (k, v) => (k[0] === '_' ? undefined : v)));
    return true;
  } catch (e) { console.error(e); return false; }
}

export function loadGame() {
  let data;
  try { data = JSON.parse(localStorage.getItem(KEY)); } catch { return false; }
  if (!data) return false;
  for (const k of Object.keys(G)) delete G[k];
  Object.assign(G, {
    year: data.year, month: data.month, tick: data.tick, sandbox: data.sandbox, funds: data.sandbox ? Infinity : data.funds,
    attract: data.attract, occ: data.occ, history: data.history, news: data.news || [], firedEvents: data.firedEvents || {},
    finance: data.finance, speed: 0,
  });
  createWorld(G);
  const g = G.grid;
  g.zone.set(unb64(data.grid.zone, g.n)); g.level.set(unb64(data.grid.level, g.n));
  g.special.set(unb64(data.grid.special, g.n)); g.seeded.set(unb64(data.grid.seeded, g.n));
  if (data.grid.hcap) g.hcap.set(unb64(data.grid.hcap, g.n));
  if (data.grid.bstyle) g.bstyle.set(unb64(data.grid.bstyle, g.n));
  data.laws.forEach((l, i) => { G.districts[i].law = l; });
  G.net = data.net;
  G.transit = data.transit;
  for (const e of Object.values(G.net.edges)) { e.vol ||= [0, 0]; e.cap ||= [0, 0]; e.t0 ||= [0, 0]; e.t ||= [0, 0]; }
  G.net.ver = (G.net.ver || 0) + 1;
  updateAccess(G);
  recomputeAllRoutes(G);
  refreshDerived();
  for (let i = 0; i < 3; i++) assess(G);
  economy(true);
  computeScore();
  return true;
}
