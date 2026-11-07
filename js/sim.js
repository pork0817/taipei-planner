import {
  CELL, ll, DISTRICTS, SEED_ROADS, SEED_RAIL, SEED_SPECIALS, SEED_SPOTS, DEMAND, JOB_RATIO, SHARE_IND, SHARE_OFF,
  PRODUCTIVITY, SHOCKS, ERA_MAX_LEVEL, EVENTS, START_YEAR, END_YEAR, interp,
} from './data/taipei.js';
import { G, bus, clamp, MONTHS } from './state.js';
import { createWorld, T_LAND, T_MTN, T_WATER, Z, S, SPECIALS, buildable, cellAt } from './world.js';
import { newNet, buildRoad, defaultCfg, updateAccess, nearestNode, costPerKm, terrainMult } from './roads.js';
import { newTransit, addStation, addLine, lineVehicles, TRANSIT, recomputeAllRoutes } from './transit.js';
import { assess, SUSTAINABLE } from './traffic.js';
import { BSTYLES, styleIndex } from './bstyles.js';

export const CAP = {
  res: [0, 150, 500, 1000, 1700, 2700, 4000],
  com: [0, 60, 200, 500, 1000, 1800, 3000],
  off: [0, 100, 300, 800, 2000, 4000, 7000],
  ind: [0, 100, 300, 600, 900, 900, 900],
};
// returns [residents, commercial jobs, office jobs, industrial jobs]
export function cellCaps(zone, lvl) {
  switch (zone) {
    case Z.R: return [CAP.res[lvl], 0, 0, 0];
    case Z.C: return [0, CAP.com[lvl], 0, 0];
    case Z.M: return [CAP.res[lvl] * 0.7, CAP.com[lvl] * 0.45, 0, 0];
    case Z.O: return [0, CAP.com[lvl] * 0.1, CAP.off[lvl], 0];
    case Z.I: return [0, 0, 0, CAP.ind[lvl]];
  }
  return [0, 0, 0, 0];
}

/** Building style index used by a cell (its own, or its district's default). */
export function cellStyle(k) {
  const g = G.grid;
  if (g.bstyle[k]) return g.bstyle[k] - 1;
  const d = g.district[k];
  return d >= 0 ? styleIndex(G.districts[d].law.style || 'taipei') : 0;
}

export const yearFrac = () => G.year + G.month / 12;
export const eraMaxLevel = (yr = yearFrac()) => Math.floor(interp(ERA_MAX_LEVEL, yr));

export function maxLevelFor(k) {
  const g = G.grid;
  const law = G.districts[g.district[k]].law;
  let m = Math.min(law.maxLevel, eraMaxLevel());
  if (g.hcap[k]) m = Math.min(m, g.hcap[k]);
  if (g.terrain[k] === T_MTN) m = Math.min(m, 2);
  if (g.noise[k] & 2) m = Math.min(m, 4);   // airport height restrictions
  if (g.zone[k] === Z.I) m = Math.min(m, 4);
  return m;
}

// ------------------------------------------------------------ new game
export function newGame(opts = {}) {
  for (const k of Object.keys(G)) delete G[k];
  G.year = START_YEAR; G.month = 0; G.tick = 0;
  G.sandbox = !!opts.sandbox;
  G.funds = G.sandbox ? Infinity : 1500;
  G.speed = 0;
  G.attract = 1;
  G.occ = { r: 0.92, c: 0.92, o: 0.92, i: 0.92 };
  G.history = [];
  G.news = [];
  G.firedEvents = {};
  G.finance = { revenue: 0, expenses: 0, roadValue: 0, lastYear: null, month: {} };
  createWorld(G);
  G.net = newNet();
  G.transit = newTransit();
  seedSpecials();
  seedBuildings();
  seedRoads();
  seedRail();
  updateAccess(G);
  G.finance.roadValue = Object.values(G.net.roads).reduce((s, r) => s + Object.values(G.net.edges).filter(e => e.road === r.id).reduce((a, e) => a + e.len * costPerKm(r.type, r.cfg) * terrainMult(e), 0), 0);
  refreshDerived(true);
  for (let i = 0; i < 4; i++) assess(G);
  economy(true);
  recordYear();
  news(`January ${START_YEAR}. Welcome, Mayor. Taipei has about ${(G.pop / 1e3).toFixed(0)}K residents. Plan the city through to ${END_YEAR}.`);
}

function nearestCells(x, y, n, pred) {
  const g = G.grid, out = [];
  const ci = Math.floor(x / CELL), cj = Math.floor(y / CELL);
  for (let r = 0; r < 30 && out.length < n; r++) {
    const ring = [];
    for (let j = cj - r; j <= cj + r; j++) for (let i = ci - r; i <= ci + r; i++) {
      if (Math.max(Math.abs(i - ci), Math.abs(j - cj)) !== r) continue;
      if (i < 0 || j < 0 || i >= g.w || j >= g.h) continue;
      const k = j * g.w + i;
      if (pred(k)) ring.push(k);
    }
    ring.sort((a, b) => Math.hypot((a % g.w) - ci, Math.floor(a / g.w) - cj) - Math.hypot((b % g.w) - ci, Math.floor(b / g.w) - cj));
    for (const k of ring) { if (out.length < n) out.push(k); }
  }
  return out;
}

function seedSpecials() {
  const g = G.grid;
  for (const s of SEED_SPECIALS) {
    const [x, y] = ll(...s.at);
    for (const k of nearestCells(x, y, s.n, k => buildable(G, k) && !g.special[k])) { g.special[k] = s.s; g.seeded[k] = 1; }
  }
}

function seedBuildings() {
  const g = G.grid;
  const free = k => buildable(G, k) && !g.special[k] && !g.zone[k] && g.terrain[k] === T_LAND;
  for (const s of SEED_SPOTS) {
    const [x, y] = ll(...s.at);
    for (const k of nearestCells(x, y, s.n, free)) { g.zone[k] = s.zone; g.level[k] = s.level; g.seeded[k] = 1; }
  }
  const inner = new Set(['zhongzheng', 'datong', 'wanhua', 'zhongshan', 'daan', 'songshan']);
  DISTRICTS.forEach((D, d) => {
    const [cx, cy] = ll(...D.core);
    const cells = [];
    for (let k = 0; k < g.n; k++) if (g.district[k] === d && free(k)) cells.push(k);
    const dist = k => Math.hypot((k % g.w + 0.5) * CELL - cx, (Math.floor(k / g.w) + 0.5) * CELL - cy);
    cells.sort((a, b) => dist(a) + Math.random() * 0.4 - dist(b) - Math.random() * 0.4);
    // residents already provided by seed spots in this district
    let have = 0;
    for (let k = 0; k < g.n; k++) if (g.district[k] === d && g.zone[k]) have += cellCaps(g.zone[k], g.level[k])[0] * 0.92;
    const isInner = inner.has(D.key);
    for (const k of cells) {
      if (have >= D.pop1949) break;
      const r = dist(k);
      let zone, lvl;
      if (isInner) {
        if (r < 1.3) { zone = Math.random() < 0.55 ? Z.M : Z.R; lvl = 3; } else if (r < 2.2) { zone = Math.random() < 0.4 ? Z.M : Z.R; lvl = Math.random() < 0.4 ? 3 : 2; } else { zone = Z.R; lvl = r < 3 ? 2 : 1; }
      } else {
        if (r < 0.4) { zone = Z.M; lvl = 2; } else { if (Math.random() < 0.35) continue; zone = Z.R; lvl = 1; }
      }
      g.zone[k] = zone; g.level[k] = lvl; g.seeded[k] = 1;
      have += cellCaps(zone, lvl)[0] * 0.92;
    }
  });
}

function seedRoads() {
  for (const r of SEED_ROADS) {
    const pts = r.pts.map(p => { const [x, y] = ll(...p); const n = nearestNode(G.net, x, y, 0.03); return n ? { x, y, node: n.id } : { x, y }; });
    const cfg = defaultCfg(r.type, 'JP');
    cfg.sidewalk = r.type === 'street' ? 1.5 : 2.5;
    cfg.arcade = r.type === 'street';
    cfg.signal.on = false;
    buildRoad(G, G.net, pts, r.type, cfg, r.name);
  }
}

function seedRail() {
  const byName = {};
  for (const L of SEED_RAIL) {
    const ids = L.stations.map(([name, lon, lat]) => {
      if (byName[name]) return byName[name];
      const [x, y] = ll(lon, lat);
      return (byName[name] = addStation(G, 'rail', x, y, name).id);
    });
    addLine(G, 'rail', ids, { name: L.name, color: L.color, headway: L.headway });
  }
}

// ------------------------------------------------------------ rasters
function stamp(arr, k, r, fn) {
  const g = G.grid, ci = k % g.w, cj = Math.floor(k / g.w);
  for (let j = cj - r; j <= cj + r; j++) for (let i = ci - r; i <= ci + r; i++) {
    if (i < 0 || j < 0 || i >= g.w || j >= g.h) continue;
    fn(j * g.w + i, Math.hypot(i - ci, j - cj));
  }
}

let parkInf, servInf, indInf;
/** Recomputes population/jobs per cell, shop proximity, airport noise and land value. */
export function refreshDerived(full = false) {
  const g = G.grid, N = g.n;
  if (!parkInf || parkInf.length !== N) { parkInf = new Float32Array(N); servInf = new Float32Array(N); indInf = new Float32Array(N); }
  parkInf.fill(0); servInf.fill(0); indInf.fill(0); g.shop.fill(0);
  for (let k = 0; k < N; k++) g.noise[k] &= ~2;
  let capR = 0, capC = 0, capO = 0, capI = 0, pub = 0;
  for (let k = 0; k < N; k++) {
    const s = g.special[k], z = g.zone[k], l = g.level[k];
    if (s) {
      pub += SPECIALS[s].jobs;
      if (s === S.PARK) stamp(parkInf, k, 3, (q, d) => { parkInf[q] = Math.max(parkInf[q], 1 - d / 4); });
      else if (s === S.AIRPORT) stamp(null, k, 8, (q, d) => { if (d <= 8) g.noise[q] |= 2; });
      else { stamp(servInf, k, 5, (q, d) => { servInf[q] = Math.min(1.5, servInf[q] + 0.3 * (1 - d / 6)); }); if (s === S.MARKET) stamp(null, k, 2, q => { g.shop[q] = 1; }); }
    }
    if (!z || !l) continue;
    const c = cellCaps(z, l);
    capR += c[0]; capC += c[1]; capO += c[2]; capI += c[3];
    if (z === Z.C || z === Z.M) stamp(null, k, z === Z.M ? 1 : 2, q => { g.shop[q] = 1; });
    if (z === Z.I) stamp(indInf, k, 2, (q, d) => { indInf[q] = Math.max(indInf[q], 1 - d / 3); });
  }
  G.cap = { r: capR, c: capC, o: capO, i: capI, pub };

  // targets
  const yr = yearFrac();
  const shock = interp(SHOCKS, yr);
  const T = interp(DEMAND, yr) * 1e6 * G.attract;
  G.targetPop = T;
  const jobsT = T * interp(JOB_RATIO, yr) * shock;
  const sI = interp(SHARE_IND, yr), sO = interp(SHARE_OFF, yr);
  G.targetJobs = { c: Math.max(0, jobsT * (1 - sI - sO) - pub), o: jobsT * sO, i: jobsT * sI };
  const step = full ? 1 : 0.08;
  const occT = (t, c) => c > 0 ? Math.min(0.97, t / c) : 0.97;
  G.occ.r += (occT(T, capR) - G.occ.r) * step;
  G.occ.c += (occT(G.targetJobs.c, capC) - G.occ.c) * step;
  G.occ.o += (occT(G.targetJobs.o, capO) - G.occ.o) * step;
  G.occ.i += (occT(G.targetJobs.i, capI) - G.occ.i) * step;

  let pop = 0, jobs = 0;
  const vit = G.stats?.districts;
  for (let k = 0; k < N; k++) {
    const s = g.special[k], z = g.zone[k], l = g.level[k];
    let p = 0, jc = 0, jo = 0, ji = 0;
    if (z && l) {
      const c = cellCaps(z, l);
      p = c[0] * G.occ.r; jc = c[1] * G.occ.c; jo = c[2] * G.occ.o; ji = c[3] * G.occ.i;
    }
    if (s) jc += SPECIALS[s].jobs;
    g.pop[k] = p; g.jC[k] = jc; g.jO[k] = jo; g.jI[k] = ji; g.jobs[k] = jc + jo + ji;
    pop += p; jobs += jc + jo + ji;

    // land value / desirability
    if (g.district[k] < 0) { g.lv[k] = 0; continue; }
    const cov = g.cov[k];
    let v = 1;
    v += (cov & 2 ? 0.6 : 0) + (cov & 8 ? 0.4 : 0) + (cov & 4 ? 0.35 : 0) + (cov & 1 ? 0.15 : 0);
    v += 0.12 * g.access[k];
    v += 0.35 * parkInf[k] + 0.2 * servInf[k];
    if (z === Z.R || z === Z.M || z === 0) {
      v -= 0.45 * indInf[k];
      if (g.noise[k] & 2) v -= 0.35;
      if (g.noise[k] & 1) v -= 0.25;
    }
    if ((z === Z.C || z === Z.M) && vit) v += 0.4 * ((vit[g.district[k]]?.vitality ?? 1) - 1);
    if (g.terrain[k] === T_MTN) v -= 0.35;
    if (z) { const bs = BSTYLES[cellStyle(k)]; v += bs.lv[z] || 0; }
    g.lv[k] = Math.max(0.1, v);
  }
  // centrality bonus based on job centre of gravity
  let jx = 0, jy = 0, jw = 0;
  for (let k = 0; k < N; k++) { const j = g.jobs[k]; if (j) { jx += (k % g.w) * j; jy += Math.floor(k / g.w) * j; jw += j; } }
  if (jw) {
    jx /= jw; jy /= jw;
    for (let k = 0; k < N; k++) {
      if (g.district[k] < 0) continue;
      const d = Math.hypot(k % g.w - jx, Math.floor(k / g.w) - jy) * CELL;
      g.lv[k] += 0.7 * Math.exp(-d / 4) * (g.zone[k] === Z.O ? 1.6 : 1);
    }
    G.cbd = { x: (jx + 0.5) * CELL, y: (jy + 0.5) * CELL };
  }
  G.pop = pop; G.jobs = jobs;
}

// ------------------------------------------------------------ growth
function growth() {
  const g = G.grid, N = g.n, cap = G.cap;
  const yr = yearFrac();
  const lists = { r: [], c: [], o: [], i: [], organic: [] };
  for (let k = 0; k < N; k++) {
    const d = g.district[k];
    if (d < 0) continue;
    const z = g.zone[k];
    const law = G.districts[d].law;
    if (z) {
      // enforce zoning law changes gradually
      if (!law.allow[z] || g.level[k] > law.maxLevel) {
        if (Math.random() < 1 / 18) {
          if (g.level[k] > 0) g.level[k]--;
          if (!law.allow[z] && g.level[k] === 0) g.zone[k] = 0;
        }
        continue;
      }
      if (!g.access[k] && !g.seeded[k]) continue;
      if (g.level[k] >= maxLevelFor(k)) continue;
      if (z === Z.R || z === Z.M) lists.r.push(k);
      if (z === Z.C || z === Z.M) lists.c.push(k);
      if (z === Z.O) lists.o.push(k);
      if (z === Z.I) lists.i.push(k);
    } else if (law.organic && g.access[k] && !g.special[k] && g.terrain[k] === T_LAND && (law.allow[Z.R] || law.allow[Z.M])) {
      lists.organic.push(k);
    }
  }
  const T = G.targetPop, tj = G.targetJobs;
  const plan = [
    { key: 'r', need: T * 1.06 - cap.r, capOf: c => c[0], total: cap.r },
    { key: 'c', need: tj.c * 1.08 - cap.c, capOf: c => c[1], total: cap.c },
    { key: 'o', need: tj.o * 1.08 - cap.o, capOf: c => c[2], total: cap.o },
    { key: 'i', need: tj.i * 1.08 - cap.i, capOf: c => c[3], total: cap.i },
  ];
  let changed = 0;
  for (const p of plan) {
    const list = lists[p.key];
    if (p.need > 0) {
      let budget = Math.min(p.need, Math.max(p.total * 0.03, 3000));
      let maxLv = 0.5;
      for (const k of list) if (g.lv[k] > maxLv) maxLv = g.lv[k];
      let tries = 0;
      while (budget > 0 && list.length && tries++ < 4000) {
        const ix = Math.floor(Math.random() * list.length), k = list[ix];
        if (Math.random() > (g.lv[k] / maxLv) ** 2) continue;
        const before = p.capOf(cellCaps(g.zone[k], g.level[k]));
        g.level[k]++;
        budget -= p.capOf(cellCaps(g.zone[k], g.level[k])) - before;
        changed++;
        if (g.level[k] >= maxLevelFor(k)) { list[ix] = list[list.length - 1]; list.pop(); }
      }
      // informal / organic growth on unzoned land along roads when housing is short
      if (p.key === 'r' && budget > 0 && p.need > T * 0.03 && lists.organic.length) {
        let n = Math.min(40, Math.ceil(budget / 300));
        while (n-- > 0 && lists.organic.length) {
          const ix = Math.floor(Math.random() * lists.organic.length), k = lists.organic[ix];
          lists.organic[ix] = lists.organic[lists.organic.length - 1]; lists.organic.pop();
          const law = G.districts[g.district[k]].law;
          g.zone[k] = law.allow[Z.M] && Math.random() < 0.4 ? Z.M : (law.allow[Z.R] ? Z.R : Z.M);
          g.level[k] = 1; changed++;
        }
      }
    } else if (p.total > 0 && -p.need > p.total * 0.35) {
      // decline: abandon some low-value buildings
      let excess = (-p.need - p.total * 0.35) * 0.02;
      let tries = 0;
      while (excess > 0 && tries++ < 400) {
        const k = Math.floor(Math.random() * N);
        if (!g.level[k] || !g.zone[k]) continue;
        const c = p.capOf(cellCaps(g.zone[k], g.level[k]));
        if (!c || g.lv[k] > 1.4) continue;
        g.level[k]--;
        excess -= c - p.capOf(cellCaps(g.zone[k], g.level[k]));
        changed++;
      }
    }
  }
  return changed;
}

// ------------------------------------------------------------ economy
// Wages and fares were far lower in the 1950s; operating costs and fares scale with productivity.
export const wageIndex = (yr = yearFrac()) => clamp(Math.pow(interp(PRODUCTIVITY, yr) / 2400, 0.6), 0.15, 1.5);

export function countAirports() {
  const g = G.grid, seen = new Uint8Array(g.n);
  let n = 0;
  for (let k = 0; k < g.n; k++) {
    if (g.special[k] !== S.AIRPORT || seen[k]) continue;
    n++;
    const stack = [k]; seen[k] = 1;
    while (stack.length) {
      const q = stack.pop(), i = q % g.w, j = (q / g.w) | 0;
      for (const [a, b] of [[i + 1, j], [i - 1, j], [i, j + 1], [i, j - 1]]) {
        if (a < 0 || b < 0 || a >= g.w || b >= g.h) continue;
        const m = b * g.w + a;
        if (!seen[m] && g.special[m] === S.AIRPORT) { seen[m] = 1; stack.push(m); }
      }
    }
  }
  return n;
}

export function annualOps() {
  let ops = 0, fares = 0;
  const wi = wageIndex();
  for (const l of [...Object.values(G.transit.lines), ...Object.values(G.transit.routes)]) {
    if (l.type === 'bus' && l.broken) continue;
    const spec = TRANSIT[l.type];
    ops += lineVehicles(G, l) * spec.opsPerVeh * wi;
    fares += (l.ridership || 0) * spec.fare * wi * 330 / 1e6;
  }
  let services = 0;
  const g = G.grid;
  for (let k = 0; k < g.n; k++) {
    const s = g.special[k];
    if (s && s !== S.AIRPORT) services += SPECIALS[s].upkeep / (SPECIALS[s].size[0] * SPECIALS[s].size[1]);
  }
  services = services * wi + countAirports() * SPECIALS[S.AIRPORT].upkeep * wi;
  const roads = G.finance.roadValue * 0.012;
  return { ops, fares, services, roads };
}

export const TAX_SHARE = 0.03, CITY_SERVICES_SHARE = 0.025;

export function economy(init = false) {
  const yr = yearFrac();
  const st = G.stats;
  const prod = interp(PRODUCTIVITY, yr) * interp(SHOCKS, yr);
  const g = G.grid;
  let jC = 0, jO = 0, jI = 0;
  for (let k = 0; k < g.n; k++) { jC += g.jC[k]; jO += g.jO[k]; jI += g.jI[k]; }
  const accBonus = clamp(0.25 * ((st.access || 0.3) / 0.3 - 1), -0.2, 0.3);
  const retail = jC * prod * 0.15 * ((st.vitality || 1) - 1);
  const officeBonus = jO * prod * 0.25;  // office jobs are higher value
  // airports
  const airports = countAirports();
  let gdpB = ((jC + jO + jI) * prod * (1 + accBonus) + retail + officeBonus) / 1e6;
  let pax = 0;
  if (airports) {
    pax = gdpB * 1600 * (yr >= 1979 && yr < 2008 ? 0.6 : 1);
    pax = Math.min(pax, airports * 8e6);
    gdpB += pax * 4 / 1e6;
  }
  const valueOfTime = 0.25 * prod / 2400;  // thousand NT$ per hour
  const congCost = (st.delayVehH || 0) * 4 * 250 * valueOfTime / 1e6;
  gdpB = Math.max(0, gdpB - congCost);
  const ops = annualOps();
  const revenueY = gdpB * 1000 * TAX_SHARE + ops.fares;
  // everyday city services (schools, police, sanitation, administration) scale with the economy
  const cityServices = gdpB * 1000 * CITY_SERVICES_SHARE;
  ops.city = cityServices;
  const expenseY = ops.ops + ops.services + ops.roads + cityServices;
  G.econ = {
    gdp: gdpB, gdppc: G.pop > 0 ? gdpB * 1e9 / G.pop : 0, prod, accBonus, congCost, pax, airports,
    revenueY, expenseY, ops, jobsC: jC, jobsO: jO, jobsI: jI,
  };
  const benchPc = prod * 1000 * interp(JOB_RATIO, yr);
  G.econ.gdppcRatio = G.econ.gdppc / Math.max(1, benchPc);
  if (!init && isFinite(G.funds)) G.funds += (revenueY - expenseY) / 12;
}

// ------------------------------------------------------------ score
export function computeScore() {
  const st = G.stats, e = G.econ || {};
  const yr = yearFrac();
  const s = {};
  s.prosperity = clamp(62 * (e.gdppcRatio || 0), 0, 100);
  s.mobility = clamp(100 - (st.commute - 15) * 3, 0, 100);
  // congestion only hurts people who drive or ride: weight by the motorised share
  const motor = (st.modal.car || 0) + (st.modal.scooter || 0) + (st.modal.bus || 0) * 0.5;
  s.congestion = clamp(100 - st.congestion * 100 * clamp(motor / 0.45, 0.2, 2), 0, 100);
  s.sustainability = clamp((st.sustainable - 0.2) * 150, 0, 100);
  const tlf = transitLoadScore();
  s.transit = clamp(0.6 * st.transitCoverage * 100 + 0.4 * tlf, 0, 100);
  s.growth = clamp(G.pop / (interp(DEMAND, yr) * 1e6) * 75, 0, 100);
  const W = { prosperity: 0.2, mobility: 0.2, congestion: 0.15, sustainability: 0.2, transit: 0.1, growth: 0.15 };
  let total = 0;
  for (const k in W) total += W[k] * s[k];
  s.total = total;
  s.grade = total >= 85 ? 'S' : total >= 75 ? 'A' : total >= 65 ? 'B' : total >= 55 ? 'C' : total >= 45 ? 'D' : 'E';
  G.score = s;
  return s;
}
function transitLoadScore() {
  const ls = [...Object.values(G.transit.lines), ...Object.values(G.transit.routes)];
  if (!ls.length) return 0;
  let s = 0, w = 0;
  for (const l of ls) {
    const lf = l.lf || 0;
    const q = lf < 0.3 ? lf / 0.3 * 70 : lf <= 0.9 ? 100 : Math.max(0, 100 - (lf - 0.9) * 150);
    const wt = Math.max(1, l.capHour || 1);
    s += q * wt; w += wt;
  }
  return s / w;
}

// ------------------------------------------------------------ history / news
export function recordYear() {
  const st = G.stats, e = G.econ;
  computeScore();
  const rec = {
    year: G.year, pop: G.pop, jobs: G.jobs, gdp: e.gdp, gdppc: e.gdppc, funds: isFinite(G.funds) ? G.funds : null,
    modal: { ...st.modal }, ridership: { ...st.ridership }, capacity: { ...st.capacity },
    congestion: st.congestion, commute: st.commute, score: G.score.total, sustainable: st.sustainable,
    dpop: st.districts.map(d => d.pop), pax: e.pax, roadKm: st.roadKm,
  };
  const last = G.history[G.history.length - 1];
  if (last && last.year === rec.year) G.history[G.history.length - 1] = rec; else G.history.push(rec);
}

export function news(text, kind = 'info') {
  const item = { date: `${MONTHS[G.month]} ${G.year}`, text, kind };
  G.news.unshift(item);
  if (G.news.length > 60) G.news.pop();
  bus.emit('news', item);
}

function fireEvents() {
  for (const ev of EVENTS) {
    const key = ev.y + '-' + ev.m;
    if (!G.firedEvents[key] && (G.year > ev.y || (G.year === ev.y && G.month >= ev.m))) {
      G.firedEvents[key] = 1;
      if (G.year - ev.y < 2) news(ev.t, 'history');
    }
  }
}

// ------------------------------------------------------------ main tick
let sinceAssess = 0;
export function monthlyTick() {
  if (G.year >= END_YEAR && G.month === 11) { G.speed = 0; news('You have reached the year 2100. The simulation is paused, but you can keep planning.', 'warn'); bus.emit('speed'); return; }
  G.month++; G.tick++;
  let newYear = false;
  if (G.month > 11) { G.month = 0; G.year++; newYear = true; }
  refreshDerived();
  const changed = growth();
  if (changed) bus.emit('cells');
  sinceAssess++;
  const ms = G.stats?.assessMs ?? 0;
  const every = ms < 25 ? 1 : ms < 60 ? 2 : ms < 120 ? 3 : 6;
  if (sinceAssess >= every || G.assessPending) { runAssessment(); }
  economy();
  // attractiveness drifts with planner rating
  const sc = G.score?.total ?? 50;
  G.attract += (clamp(1 + 0.006 * (sc - 50), 0.7, 1.35) - G.attract) * 0.03;
  if (newYear) {
    recordYear();
    yearlyNews();
  }
  fireEvents();
  if (isFinite(G.funds) && G.funds < -2000 && G.month === 0) news('The city is deep in debt. Cut spending or raise revenue by growing jobs and GDP.', 'warn');
  bus.emit('tick');
}

export function runAssessment() {
  sinceAssess = 0;
  G.assessPending = false;
  assess(G);
  computeScore();
  bus.emit('assessed');
}

const milestones = [1e6, 1.5e6, 2e6, 2.5e6, 3e6, 3.5e6];
function yearlyNews() {
  const h = G.history, cur = h[h.length - 1], prev = h[h.length - 2];
  if (!prev) return;
  for (const m of milestones) if (prev.pop < m && cur.pop >= m) news(`Population passes ${(m / 1e6).toFixed(1)} million!`, 'good');
  if (cur.congestion > 0.6 && prev.congestion <= 0.6) news('Traffic gridlock: peak travel times are 60% above free flow. Consider transit, bus lanes or more capacity.', 'warn');
  const mr = cur.ridership.metro;
  if (mr > 1e6 && prev.ridership.metro <= 1e6) news('Metro ridership tops 1 million trips a day!', 'good');
}

export function spend(amount, what) {
  if (!isFinite(G.funds)) return true;
  if (G.funds - amount < -5000) { news(`Not enough funds for ${what} (${Math.round(amount)}M needed). The city cannot borrow more.`, 'warn'); return false; }
  G.funds -= amount;
  return true;
}

export function afterNetworkChange() {
  G.netVis = (G.netVis || 0) + 1;
  updateAccess(G);
  recomputeAllRoutes(G);
  G.finance.roadValue = 0;
  for (const e of Object.values(G.net.edges)) {
    const r = G.net.roads[e.road];
    G.finance.roadValue += e.len * costPerKm(r.type, r.cfg) * terrainMult(e);
  }
  requestAssess();
}

let assessTimer = null;
export function requestAssess() {
  G.assessPending = true;
  clearTimeout(assessTimer);
  assessTimer = setTimeout(() => {
    if (!G.assessPending) return;
    refreshDerived();
    // a few damped passes so the effect of an edit shows immediately even while paused
    for (let i = 0; i < 3; i++) assess(G);
    runAssessment();
    economy(true);
    bus.emit('cells');
  }, 250);
}
