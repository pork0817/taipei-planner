// Four-step style transport model, aggregated to the 12 districts:
//   trip generation -> destination choice (gravity on mode logsums)
//   -> multinomial-logit mode choice -> peak-hour road assignment (MSA + BPR + signal delay)
// plus transit line loading, crowding feedback, retail vitality and accessibility.
import { interp, OWN_CAR, OWN_SCOOTER, OWN_BIKE, CELL } from './data/taipei.js';
import { ROAD_TYPES, STYLES, BIKE_LANES, dijkstra } from './roads.js';
import { TRANSIT, routeGraph, computeCoverage, lineCapacity, routeSamples } from './transit.js';
import { clamp } from './state.js';

export const MODES = ['walk', 'bike', 'scooter', 'car', 'bus', 'metro', 'lrt', 'rail'];
export const MODE_INFO = {
  walk: { label: 'Walk', color: '#8bc34a' }, bike: { label: 'Bike', color: '#2e7d32' },
  scooter: { label: 'Scooter', color: '#ffb300' }, car: { label: 'Car', color: '#e53935' },
  bus: { label: 'Bus', color: '#1e88e5' }, metro: { label: 'Metro', color: '#8e24aa' },
  lrt: { label: 'Light rail', color: '#00acc1' }, rail: { label: 'Rail', color: '#6d4c41' },
};
export const SUSTAINABLE = ['walk', 'bike', 'bus', 'metro', 'lrt', 'rail'];
const TRANSIT_MODES = ['bus', 'metro', 'lrt', 'rail'];
const STYLE_KEYS = ['NL', 'JP', 'UK', 'US'];
const PEAK = 0.08;          // share of daily trips in the peak hour
const TRIP_RATE = 2.2;        // person-trips per resident per day

// ------------------------------------------------------------ edge performance
export function updateEdgeTimes(G, graph) {
  const net = G.net;
  for (const e of graph.edges) {
    const r = net.roads[e.road], T = ROAD_TYPES[r.type], c = r.cfg, S = STYLES[c.style] || STYLES.JP;
    if (r.type === 'pedestrian') { e.cap[0] = e.cap[1] = 0; e.t0[0] = e.t0[1] = e.t[0] = e.t[1] = Infinity; continue; }
    const base = e.len / Math.max(5, c.speed * S.speed) * 60;
    for (let dir = 0; dir < 2; dir++) {
      if (dir === 1 && c.oneWay) { e.cap[1] = 0; e.t0[1] = e.t[1] = Infinity; continue; }
      const deg = net.nodes[dir === 0 ? e.b : e.a].deg || 0;
      let g = 1, cycle = 0, fixed = 0;
      if (T.surface) {
        if (deg >= 3) {
          if (c.signal.on) { g = c.signal.green; cycle = c.signal.cycle; }
          else { g = c.style === 'UK' ? 0.85 : 0.72; fixed = c.style === 'UK' ? 4 : 8; }  // UK: roundabouts
        } else g = 0.95;
      }
      const lanes = Math.max(1, c.lanes - (c.busLane && c.lanes >= 2 ? 1 : 0));
      const cap = Math.max(60, lanes * T.sat * S.cap * g);
      const x = Math.min(e.vol[dir] / cap, 2.2);
      let dSec = fixed, d0 = fixed;
      if (cycle) { d0 += 0.5 * cycle * (1 - g) ** 2; dSec += 0.5 * cycle * (1 - g) ** 2 / (1 - Math.min(x, 0.98) * g); }
      if (T.surface && deg >= 3 && x > 0.85) {
        const y = x - 1;
        dSec += Math.min(150, 225 * (y + Math.sqrt(y * y + 16 * x / cap)));
      }
      e.cap[dir] = cap;
      e.t0[dir] = base + d0 * S.sigDelay / 60;
      e.t[dir] = base * (1 + 0.15 * x ** 4) + dSec * S.sigDelay / 60;
    }
  }
}

// ------------------------------------------------------------ district aggregates
function aggregates(G) {
  const g = G.grid, Dn = G.districts.length, net = G.net;
  const z = () => new Float64Array(Dn);
  const A = {
    pop: z(), jobs: z(), jC: z(), jO: z(), jI: z(), dev: z(), cx: z(), cy: z(), w: z(), shopRes: z(),
    cov: { bus: z(), metro: z(), lrt: z(), rail: z() }, anyCov: z(), parks: z(),
    roadKm: z(), laneKm: z(), walkQ: z(), bikeQ: z(), busLaneKm: z(), pedKm: z(),
    style: { NL: z(), JP: z(), UK: z(), US: z() },
  };
  for (let k = 0; k < g.n; k++) {
    const d = g.district[k];
    if (d < 0) continue;
    const p = g.pop[k], j = g.jobs[k];
    A.pop[d] += p; A.jobs[d] += j; A.jC[d] += g.jC[k]; A.jO[d] += g.jO[k]; A.jI[d] += g.jI[k];
    if (g.level[k] > 0 || g.special[k]) A.dev[d]++;
    const w = p + j;
    if (w > 0) {
      A.cx[d] += (k % g.w + 0.5) * CELL * w; A.cy[d] += (Math.floor(k / g.w) + 0.5) * CELL * w; A.w[d] += w;
    }
    if (g.shop[k]) A.shopRes[d] += p;
    const c = g.cov[k];
    if (c & 1) A.cov.bus[d] += p;
    if (c & 2) A.cov.metro[d] += p;
    if (c & 4) A.cov.lrt[d] += p;
    if (c & 8) A.cov.rail[d] += p;
    if (c) A.anyCov[d] += p;
    if (g.special[k] === 1) A.parks[d]++;
  }
  for (let d = 0; d < Dn; d++) {
    if (A.w[d] > 0) { A.cx[d] /= A.w[d]; A.cy[d] /= A.w[d]; }
    else { A.cx[d] = G.districts[d].lx; A.cy[d] = G.districts[d].ly; }
  }
  for (const e of Object.values(net.edges)) {
    const d = e.dist;
    if (d < 0) continue;
    const r = net.roads[e.road], c = r.cfg, L = e.len;
    if (r.type === 'expressway') continue;
    A.roadKm[d] += L;
    A.style[c.style][d] += L;
    if (r.type === 'pedestrian') { A.pedKm[d] += L; A.walkQ[d] += L * 2.2; A.bikeQ[d] += L * 0.5; continue; }
    const totalLanes = c.lanes * (c.oneWay ? 1 : 2);
    A.laneKm[d] += L * totalLanes;
    let wq = Math.min(c.sidewalk / 3.5, 1.4) + (c.arcade ? 0.35 : 0) + (c.trees ? 0.15 : 0);
    if (totalLanes >= 6) wq -= 0.3;
    if (c.speed > 60) wq -= 0.3;
    A.walkQ[d] += L * wq;
    A.bikeQ[d] += L * BIKE_LANES[c.bikeLane].q * (c.speed <= 30 ? 1.1 : 1);
    if (c.busLane) A.busLaneKm[d] += L;
  }
  A.mix = z(); A.devArea = z(); A.dens = z(); A.sm = [];
  for (let d = 0; d < Dn; d++) {
    const rk = A.roadKm[d];
    A.walkQ[d] = rk > 0 ? A.walkQ[d] / rk : 0.4;
    A.bikeQ[d] = rk > 0 ? Math.min(1, A.bikeQ[d] / rk) : 0;
    const balance = clamp(1 - Math.abs(Math.log((A.jobs[d] + 1) / (0.6 * A.pop[d] + 1))) / 2, 0, 1);
    A.mix[d] = clamp(0.6 * (A.pop[d] > 0 ? A.shopRes[d] / A.pop[d] : 0) + 0.4 * balance, 0, 1);
    A.devArea[d] = Math.max(A.dev[d], 4) * CELL * CELL;
    A.dens[d] = clamp((A.pop[d] + A.jobs[d]) / A.devArea[d] / 50000, 0, 1);
    const sm = { walk: 0, bike: 0, car: 0, bus: 0, transit: 0, retail: 1 };
    if (rk > 0) {
      sm.retail = 0;
      for (const s of STYLE_KEYS) {
        const sh = A.style[s][d] / rk, S = STYLES[s];
        sm.walk += sh * S.walk; sm.bike += sh * S.bike; sm.car += sh * S.car; sm.bus += sh * S.bus;
        sm.transit += sh * S.transit; sm.retail += sh * S.retail;
      }
    }
    A.sm[d] = sm;
  }
  return A;
}

// ------------------------------------------------------------ connectors & skims
function connectors(G, graph, A) {
  const Dn = G.districts.length, g = G.grid, net = G.net;
  const buckets = Array.from({ length: Dn }, () => []);
  graph.nodes.forEach((n, i) => {
    const ci = Math.floor(n.x / CELL), cj = Math.floor(n.y / CELL);
    if (ci < 0 || cj < 0 || ci >= g.w || cj >= g.h) return;
    const d = g.district[cj * g.w + ci];
    if (d < 0) return;
    const a = graph.adj[i];
    for (let q = 0; q < a.length; q += 3) {
      const t = net.roads[a[q].road].type;
      if (t !== 'pedestrian' && t !== 'expressway') { buckets[d].push(i); return; }
    }
  });
  const out = [];
  for (let d = 0; d < Dn; d++) {
    const b = buckets[d];
    if (!b.length) { out.push([]); continue; }
    const r = 0.35 * Math.sqrt(A.devArea[d] + 1);
    const anchors = [[A.cx[d], A.cy[d]]];
    const ring = graph.nodes.length > 1500 ? 5 : graph.nodes.length > 800 ? 8 : 12;
    for (let q = 0; q < ring; q++) anchors.push([A.cx[d] + r * Math.cos(q * 2 * Math.PI / ring), A.cy[d] + r * Math.sin(q * 2 * Math.PI / ring)]);
    const chosen = [];
    for (const [ax, ay] of anchors) {
      let best = -1, bd = Infinity;
      for (const i of b) {
        const n = graph.nodes[i], dd = (n.x - ax) ** 2 + (n.y - ay) ** 2;
        if (dd < bd) { bd = dd; best = i; }
      }
      if (best >= 0 && !chosen.includes(best)) chosen.push(best);
    }
    out.push(chosen);
  }
  return out;
}

const carCost = net => (e, dir) => {
  const t = e.t[dir];
  return t;
};

function runSkims(G, graph, conns) {
  const Dn = conns.length;
  const res = conns.map(cs => cs.map(c => dijkstra(graph, c, carCost(G.net))));
  const time = new Float64Array(Dn * Dn).fill(Infinity), km = new Float64Array(Dn * Dn).fill(Infinity);
  for (let i = 0; i < Dn; i++) for (let j = 0; j < Dn; j++) {
    if (i === j) continue;
    let st = 0, sk = 0, n = 0;
    for (const r of res[i]) for (const c of conns[j]) {
      if (r.dist[c] < Infinity) { st += r.dist[c]; sk += r.km[c]; n++; }
    }
    if (n) { time[i * Dn + j] = st / n; km[i * Dn + j] = sk / n; }
  }
  return { res, time, km };
}

// ------------------------------------------------------------ transit network
function transitNetwork(G) {
  const T = G.transit;
  const lines = Object.values(T.lines).filter(l => l.stations.length >= 2 && l.stations.every(s => T.stations[s]));
  for (const l of lines) {
    l._d = new Map();
    for (const s of l.stations) { const d = T.stations[s].district; if (d >= 0) l._d.set(d, (l._d.get(d) || 0) + 1); }
    l._b = 0;
  }
  const adj = lines.map(() => []);
  for (let a = 0; a < lines.length; a++) for (let b = a + 1; b < lines.length; b++) {
    let link = false;
    outer: for (const sa of lines[a].stations) for (const sb of lines[b].stations) {
      if (sa === sb) { link = true; break outer; }
      const A = T.stations[sa], B = T.stations[sb];
      if (Math.hypot(A.x - B.x, A.y - B.y) < 0.3) { link = true; break outer; }
    }
    if (link) { adj[a].push(b); adj[b].push(a); }
  }
  const routes = Object.values(T.routes).filter(r => !r.broken && r.stops.length >= 2);
  const g = G.grid;
  for (const r of routes) {
    r._d = new Map();
    for (const [x, y] of routeSamples(G, r)) {
      const i = Math.floor(x / CELL), j = Math.floor(y / CELL);
      if (i < 0 || j < 0 || i >= g.w || j >= g.h) continue;
      const d = g.district[j * g.w + i];
      if (d >= 0) r._d.set(d, (r._d.get(d) || 0) + 1);
    }
    r._b = 0;
  }
  return { lines, adj, routes };
}

function railPath(tn, type, i, j) {
  const L = tn.lines;
  const starts = [];
  for (let x = 0; x < L.length; x++) if (L[x].type === type && L[x]._d.has(i)) starts.push(x);
  if (!starts.length) return null;
  if (i === j) {
    const alts = starts.filter(x => L[x]._d.get(i) >= 2);
    return alts.length ? { lines: [alts[0]], alts } : null;
  }
  const direct = starts.filter(x => L[x]._d.has(j));
  if (direct.length) return { lines: [direct[0]], alts: direct };
  const prev = new Map();
  let frontier = starts;
  for (const s of starts) prev.set(s, -1);
  for (let depth = 0; depth < 2; depth++) {
    const next = [];
    for (const u of frontier) for (const v of tn.adj[u]) {
      if (prev.has(v)) continue;
      prev.set(v, u);
      if (L[v]._d.has(j)) {
        const path = [v];
        let w = u;
        while (w !== -1) { path.unshift(w); w = prev.get(w); }
        return { lines: path, alts: [path[0]] };
      }
      next.push(v);
    }
    frontier = next;
  }
  return null;
}

function busPath(tn, i, j) {
  const R = tn.routes;
  const si = [], sj = [];
  R.forEach((r, x) => { if (r._d.has(i)) si.push(x); if (r._d.has(j)) sj.push(x); });
  if (!si.length || !sj.length) return null;
  if (i === j) {
    const alts = si.filter(x => R[x]._d.get(i) >= 2);
    return alts.length ? { lines: [alts[0]], alts } : null;
  }
  const direct = si.filter(x => R[x]._d.has(j));
  if (direct.length) return { lines: [direct[0]], alts: direct };
  for (const a of si) for (const b of sj) {
    for (const d of R[a]._d.keys()) if (R[b]._d.has(d)) return { lines: [a, b], alts: [a] };
  }
  return null;
}

const comboHeadway = (objs, alts) => 1 / alts.reduce((s, x) => s + 1 / objs[x].headway, 0);

// ------------------------------------------------------------ main assessment
export function assess(G, opts = {}) {
  const tStart = performance.now();
  const yr = G.year + G.month / 12;
  const net = G.net, Dn = G.districts.length, DD = Dn * Dn;
  const graph = routeGraph(G);
  graph.edges.forEach((e, ix) => { e._gi = ix; });
  computeCoverage(G);
  const A = aggregates(G);
  const tn = transitNetwork(G);
  const conns = connectors(G, graph, A);
  updateEdgeTimes(G, graph);

  // intra-district congested speed
  const iSpd = new Float64Array(Dn), iLen = new Float64Array(Dn), iTime = new Float64Array(Dn);
  for (const e of graph.edges) {
    if (e.dist < 0 || !(e.t[0] < Infinity)) continue;
    iLen[e.dist] += e.len; iTime[e.dist] += e.t[0];
  }
  // local alley network (not drawn): capacity grows with built-up area
  const alleyCap = new Float64Array(Dn), roadCapKm = new Float64Array(Dn), roadShare = new Float64Array(Dn);
  for (const e of graph.edges) {
    if (e.dist < 0) continue;
    const t = net.roads[e.road].type;
    if (t === 'pedestrian' || t === 'expressway') continue;
    roadCapKm[e.dist] += (e.cap[0] + e.cap[1]) * e.len;
  }
  const prevAlleyX = G.stats?.alleyX || [];
  for (let d = 0; d < Dn; d++) {
    alleyCap[d] = A.dev[d] * 0.5 * 450;
    roadShare[d] = roadCapKm[d] + alleyCap[d] > 0 ? roadCapKm[d] / (roadCapKm[d] + alleyCap[d]) : 0;
    const roadSpd = iLen[d] > 0 ? clamp(iLen[d] / (iTime[d] / 60), 5, 60) : 12;
    const ax = Math.min(prevAlleyX[d] || 0, 3);
    const alleySpd = 16 / (1 + 0.15 * ax ** 4);
    iSpd[d] = clamp(1 / (roadShare[d] / roadSpd + (1 - roadShare[d]) / alleySpd), 4, 60);
  }

  const econ = G.econ || {};
  const gdpAdj = clamp(Math.sqrt(econ.gdppcRatio || 1), 0.6, 1.4);
  const own = {
    car: interp(OWN_CAR, yr) * gdpAdj, sc: interp(OWN_SCOOTER, yr) * clamp(gdpAdj, 0.8, 1.2), bike: interp(OWN_BIKE, yr),
  };
  let congRatio = G.stats?.congRatio || 1;

  let skim = runSkims(G, graph, conns);
  const M = MODES.length;
  const Tm = MODES.map(() => new Float64Array(DD));
  const Ttot = new Float64Array(DD);
  const tmode = MODES.map(() => new Float64Array(DD).fill(Infinity));
  const bestT = new Float64Array(DD).fill(Infinity);
  const tpaths = { bus: new Array(DD), metro: new Array(DD), lrt: new Array(DD), rail: new Array(DD) };
  const dIntra = new Float64Array(Dn);
  for (let d = 0; d < Dn; d++) dIntra[d] = Math.max(0.6, 0.5 * Math.sqrt(A.devArea[d]) * (1 - 0.4 * A.mix[d]));
  const cov = (kind, d) => A.pop[d] > 0 ? A.cov[kind][d] / A.pop[d] : 0;

  // share of residents with a car / only a scooter available, per origin district
  const segCar = new Float64Array(Dn), segSc = new Float64Array(Dn);
  for (let d = 0; d < Dn; d++) {
    // about a third of people never drive (children, elderly, non-drivers): cap motorised access
    const MOTOR_MAX = 0.66;
    segCar[d] = clamp(own.car * 1.3 * (G.districts[d].law.parkingMin ? 1.2 : 1) * (1 + A.sm[d].car * 0.3), 0, 0.5);
    segSc[d] = clamp(own.sc, 0, MOTOR_MAX - segCar[d]);
  }
  const U = new Float64Array(M);
  const shares = new Float64Array(Dn * M);
  const LS = new Float64Array(Dn);
  let totalTrips = 0;
  for (let i = 0; i < Dn; i++) {
    if (A.pop[i] < 1) continue;
    const P = A.pop[i] * TRIP_RATE;
    for (let j = 0; j < Dn; j++) {
      const ij = i * Dn + j;
      LS[j] = -Infinity;
      if (A.pop[j] + A.jobs[j] < 1) continue;
      const intra = i === j;
      const dE = intra ? dIntra[i] / 1.25 : Math.hypot(A.cx[i] - A.cx[j], A.cy[i] - A.cy[j]);
      const reach = intra || skim.time[ij] < Infinity;
      const dN = intra ? dIntra[i] : reach ? Math.max(skim.km[ij], dE) : dE * 1.35;
      const carT = intra ? dIntra[i] / iSpd[i] * 60 : reach ? skim.time[ij] : dE * 1.35 / 12 * 60;
      const carTfree = carT / Math.max(1, congRatio);
      const smO = A.sm[i], smD = A.sm[j];
      const sm = k => (smO[k] + smD[k]) / 2;
      U.fill(-Infinity);
      // walk
      if (dN <= 7) {
        const t = dN / 4.6 * 60;
        tmode[0][ij] = t;
        U[0] = -0.1 + 0.6 * (A.walkQ[i] + A.walkQ[j]) / 2 + sm('walk') + 0.4 * A.mix[j] - 0.085 * t;
      }
      // bike
      if (dN <= 16) {
        const bi = (A.bikeQ[i] + A.bikeQ[j]) / 2;
        const t = dN / (11 + 4 * bi) * 60 + 2;
        tmode[1][ij] = t;
        U[1] = -0.5 + 0.8 * Math.log(own.bike) + 1.5 * bi + sm('bike') * (0.3 + 0.7 * bi) - 0.075 * t;
      }
      // scooter (only for households that own one: see segments below)
      {
        const t = carT * 0.8 + 2 + 2 * A.dens[j];
        tmode[2][ij] = t;
        U[2] = 0.1 + sm('car') * 0.3 - 0.055 * t - 0.08 * Math.max(0, dN - 8) - (reach ? 0 : 0.5);
      }
      // car
      {
        const park = 1 + 9 * A.dens[j] - (G.districts[j].law.parkingMin ? 3 : 0);
        const t = carT + 2 + park;
        tmode[3][ij] = t;
        U[3] = 0.7 + sm('car') - 0.06 * t - (reach ? 0 : 1);
      }
      // bus
      const bp = busPath(tn, i, j);
      if (bp) {
        const R = tn.routes;
        const r0 = R[bp.lines[0]];
        const h = comboHeadway(R, bp.alts);
        const bl = r0.busLaneFrac || 0;
        const inveh = carT * (1 - bl) * 1.2 + carTfree * bl * 1.1 + dN * 0.3;
        let xfer = 0;
        for (let q = 1; q < bp.lines.length; q++) xfer += 5 + Math.min(R[bp.lines[q]].headway / 2, 15);
        const crowd = Math.max(...bp.lines.map(x => R[x].crowdPen || 0));
        const t = 3 + 12 * (1 - cov('bus', i)) + 3 + 12 * (1 - cov('bus', j)) + Math.min(h / 2, 20) * 1.5 + inveh + xfer + crowd;
        tmode[4][ij] = t;
        U[4] = 0.1 + sm('bus') + 0.4 * bl - 0.06 * t;
        tpaths.bus[ij] = bp;
      }
      // rail-based modes
      for (let m = 5; m < 8; m++) {
        const kind = MODES[m];
        const p = railPath(tn, kind, i, j);
        if (!p) continue;
        const L = tn.lines;
        const lastType = L[p.lines[p.lines.length - 1]].type;
        const h = comboHeadway(L, p.alts);
        let xfer = 0;
        for (let q = 1; q < p.lines.length; q++) xfer += 5 + Math.min(L[p.lines[q]].headway / 2, 15);
        const crowd = Math.max(...p.lines.map(x => L[x].crowdPen || 0));
        const inveh = dE * 1.2 / TRANSIT[kind].speed * 60;
        const t = 2 + 15 * (1 - cov(kind, i)) + 2 + 15 * (1 - cov(lastType, j)) + Math.min(h / 2, 20) * 1.5 + inveh + xfer + crowd;
        tmode[m][ij] = t;
        const asc = kind === 'metro' ? 0 : kind === 'lrt' ? 0.05 : -0.1;
        U[m] = asc + sm('transit') - 0.06 * t;
        tpaths[kind][ij] = p;
      }
      // three household segments: car available / scooter only / neither
      let mx = -Infinity;
      for (let m = 0; m < M; m++) if (U[m] > mx) mx = U[m];
      const ex = new Float64Array(M);
      for (let m = 0; m < M; m++) ex[m] = U[m] > -Infinity ? Math.exp(U[m] - mx) : 0;
      let sAll = 0;
      for (let m = 0; m < M; m++) sAll += ex[m];
      const sNoCar = sAll - ex[3], sNone = sNoCar - ex[2];
      const fC = segCar[i], fS = segSc[i], fN = 1 - fC - fS;
      let ls = 0;
      for (let m = 0; m < M; m++) {
        let sh = fC * ex[m] / sAll;
        if (m !== 3) sh += fS * ex[m] / sNoCar;
        if (m !== 3 && m !== 2 && sNone > 0) sh += fN * ex[m] / sNone;
        shares[j * M + m] = sh;
      }
      if (sNone <= 0) { // no non-motorised option: captive riders squeeze onto scooters
        shares[j * M + 2] += fN * ex[2] / sNoCar;
      }
      ls = fC * Math.log(sAll) + fS * Math.log(sNoCar) + fN * Math.log(Math.max(sNone, 1e-9));
      LS[j] = mx + ls;
      let bt = Infinity;
      for (let m = 0; m < M; m++) if (shares[j * M + m] > 0.01 && tmode[m][ij] < bt) bt = tmode[m][ij];
      bestT[ij] = bt;
    }
    // destination choice
    let wsum = 0;
    const wts = new Float64Array(Dn);
    for (let j = 0; j < Dn; j++) {
      if (LS[j] === -Infinity) continue;
      let attr = A.jobs[j] + 0.6 * A.pop[j];
      if (i === j) attr *= 0.6 + 0.8 * A.mix[i];
      wts[j] = attr * Math.exp(0.6 * LS[j]);
      wsum += wts[j];
    }
    if (wsum <= 0) continue;
    for (let j = 0; j < Dn; j++) {
      if (!wts[j]) continue;
      const ij = i * Dn + j, T = P * wts[j] / wsum;
      Ttot[ij] = T; totalTrips += T;
      for (let m = 0; m < M; m++) Tm[m][ij] = T * shares[j * M + m];
    }
  }

  // ---------------- road assignment (peak hour, PCU)
  const vehOD = new Float64Array(DD);
  // peak spreading: when the network is jammed, some trips shift out of the peak hour
  const spread = clamp(1 / (1 + 0.35 * Math.max(0, (G.stats?.congRatio || 1) - 1)), 0.6, 1);
  for (let ij = 0; ij < DD; ij++) vehOD[ij] = (Tm[3][ij] / 1.3 + Tm[2][ij] * 0.28) * PEAK * spread;
  const nE = graph.edges.length;
  const vol = new Float64Array(nE * 2);
  const prevVol = new Float64Array(nE * 2);
  for (const e of graph.edges) { prevVol[e._gi * 2] = e.vol[0]; prevVol[e._gi * 2 + 1] = e.vol[1]; }
  const hasPrev = !!G.stats && !opts.reset;
  // fixed loads: intra-district background + buses
  const fixed = new Float64Array(nE * 2);
  const dLane = new Float64Array(Dn);
  for (const e of graph.edges) {
    if (e.dist < 0) continue;
    const r = net.roads[e.road];
    if (r.type === 'pedestrian' || r.type === 'expressway') continue;
    dLane[e.dist] += e.len * r.cfg.lanes * (r.cfg.oneWay ? 1 : 2);
  }
  for (const e of graph.edges) {
    if (e.dist < 0 || !dLane[e.dist]) continue;
    const r = net.roads[e.road];
    if (r.type === 'pedestrian' || r.type === 'expressway') continue;
    const d = e.dist;
    const vehKm = vehOD[d * Dn + d] * dIntra[d] * roadShare[d];
    const lanesTot = r.cfg.lanes * (r.cfg.oneWay ? 1 : 2);
    const flow = vehKm * lanesTot / dLane[d];
    if (r.cfg.oneWay) fixed[e._gi * 2] += flow;
    else { fixed[e._gi * 2] += flow / 2; fixed[e._gi * 2 + 1] += flow / 2; }
  }
  for (const route of Object.values(G.transit.routes)) {
    if (route.broken) continue;
    const pcu = 2.5 * 60 / route.headway;
    for (const [eid, dir] of route.path) {
      const e = net.edges[eid];
      if (!e || net.roads[e.road].cfg.busLane) continue;
      fixed[e._gi * 2 + dir] += pcu;
      if (!net.roads[e.road].cfg.oneWay) fixed[e._gi * 2 + 1 - dir] += pcu;
    }
  }
  // large networks: one pass per assessment (damping across assessments does the averaging)
  const ITER = graph.nodes.length > 800 ? 1 : graph.nodes.length > 300 ? 2 : 3;
  for (let it = 1; it <= ITER; it++) {
    if (it > 1) skim = runSkims(G, graph, conns);
    const aon = fixed.slice();
    for (let i = 0; i < Dn; i++) {
      const ri = skim.res[i];
      if (!ri.length) continue;
      for (let j = 0; j < Dn; j++) {
        if (i === j) continue;
        const f = vehOD[i * Dn + j];
        if (f <= 0 || !conns[j].length) continue;
        const share = f / (ri.length * conns[j].length);
        for (let a = 0; a < ri.length; a++) {
          const r = ri[a], src = conns[i][a];
          for (const dst of conns[j]) {
            if (r.dist[dst] === Infinity) continue;
            let v = dst;
            while (v !== src && v >= 0) {
              const e = r.prevE[v];
              aon[e._gi * 2 + r.prevD[v]] += share;
              v = r.prevN[v];
            }
          }
        }
      }
    }
    const lam = 1 / it;
    for (let q = 0; q < vol.length; q++) vol[q] = (1 - lam) * vol[q] + lam * aon[q];
    for (const e of graph.edges) { e.vol[0] = vol[e._gi * 2]; e.vol[1] = vol[e._gi * 2 + 1]; }
    updateEdgeTimes(G, graph);
  }
  // damp between assessments so destination choice and congestion settle instead of oscillating
  if (hasPrev) {
    const a = 0.35;
    for (const e of graph.edges) {
      e.vol[0] = prevVol[e._gi * 2] * (1 - a) + e.vol[0] * a;
      e.vol[1] = prevVol[e._gi * 2 + 1] * (1 - a) + e.vol[1] * a;
    }
    updateEdgeTimes(G, graph);
  }

  // ---------------- road stats
  let vt = 0, vt0 = 0, delayH = 0, vkm = 0, capKm = 0, laneKm = 0, roadKm = 0;
  const dVT = new Float64Array(Dn), dVT0 = new Float64Array(Dn);
  for (const e of graph.edges) {
    const r = net.roads[e.road];
    roadKm += e.len;
    if (r.type === 'pedestrian') { e.vc = [0, 0]; continue; }
    laneKm += e.len * r.cfg.lanes * (r.cfg.oneWay ? 1 : 2);
    e.vc = [0, 0];
    for (let dir = 0; dir < 2; dir++) {
      if (!(e.cap[dir] > 0) || !(e.t[dir] < Infinity)) continue;
      const v = e.vol[dir];
      e.vc[dir] = v / e.cap[dir];
      vt += v * e.t[dir]; vt0 += v * e.t0[dir];
      delayH += v * (e.t[dir] - e.t0[dir]) / 60;
      vkm += v * e.len; capKm += e.cap[dir] * e.len;
      if (e.dist >= 0) { dVT[e.dist] += v * e.t[dir]; dVT0[e.dist] += v * e.t0[dir]; }
    }
  }
  congRatio = vt0 > 0 ? vt / vt0 : 1;

  // ---------------- transit loading
  const tlines = tn.lines, routes = tn.routes;
  for (const kind of TRANSIT_MODES) {
    const m = MODES.indexOf(kind);
    const objs = kind === 'bus' ? routes : tlines;
    for (let ij = 0; ij < DD; ij++) {
      const p = tpaths[kind][ij], trips = Tm[m][ij];
      if (!p || trips <= 0) continue;
      const hsum = p.alts.reduce((s, x) => s + 1 / objs[x].headway, 0);
      for (const x of p.alts) objs[x]._b += trips * (1 / objs[x].headway) / hsum;
      for (let q = 1; q < p.lines.length; q++) objs[p.lines[q]]._b += trips;
    }
  }
  const ridership = { bus: 0, metro: 0, lrt: 0, rail: 0 }, capacity = { bus: 0, metro: 0, lrt: 0, rail: 0 };
  const allT = [...Object.values(G.transit.lines), ...Object.values(G.transit.routes)];
  for (const l of allT) {
    const b = l._b || 0;
    l.ridership = b;
    const capH = lineCapacity(l);
    // load at the busiest point in the peak hour, one direction (bus trips are short relative to the route)
    const peakLoad = b * (l.type === 'bus' ? 0.022 : 0.03);
    l.peakLoad = peakLoad; l.capHour = capH;
    l.lf = capH > 0 ? peakLoad / capH : 0;
    // smoothed so overloaded lines settle at their capacity instead of oscillating
    l.crowdPen = (l.crowdPen || 0) * 0.7 + 0.3 * clamp((l.lf - 0.8) * 10, 0, 40);
    ridership[l.type] += b;
    capacity[l.type] += capH;
  }

  // ---------------- outputs
  const modeTot = {}, modal = {};
  MODES.forEach((m, mi) => { modeTot[m] = Tm[mi].reduce((s, v) => s + v, 0); });
  for (const m of MODES) modal[m] = totalTrips > 0 ? modeTot[m] / totalTrips : 0;
  let timeSum = 0, kmSum = 0;
  for (let ij = 0; ij < DD; ij++) {
    if (!Ttot[ij]) continue;
    const i = Math.floor(ij / Dn), j = ij % Dn;
    for (let m = 0; m < M; m++) if (Tm[m][ij] > 0 && tmode[m][ij] < Infinity) timeSum += Tm[m][ij] * tmode[m][ij];
    const dist = i === j ? dIntra[i] : Math.hypot(A.cx[i] - A.cx[j], A.cy[i] - A.cy[j]) * 1.25;
    kmSum += Ttot[ij] * dist;
  }
  const totJobs = A.jobs.reduce((s, v) => s + v, 0) || 1;
  const totPop = A.pop.reduce((s, v) => s + v, 0) || 1;
  const districts = [];
  let accCity = 0, spendCity = 0, comCity = 0;
  const footfall = new Float64Array(Dn);
  for (let ij = 0; ij < DD; ij++) {
    const j = ij % Dn;
    let f = 0;
    for (let m = 0; m < M; m++) f += Tm[m][ij] * (m === 2 || m === 3 ? 0.35 : 1);
    footfall[j] += f;
  }
  for (let d = 0; d < Dn; d++) {
    let trips = 0, tsum = 0;
    const mt = {};
    for (const m of MODES) mt[m] = 0;
    let acc = 0;
    for (let j = 0; j < Dn; j++) {
      const ij = d * Dn + j;
      trips += Ttot[ij];
      MODES.forEach((m, mi) => { mt[m] += Tm[mi][ij]; if (Tm[mi][ij] > 0 && tmode[mi][ij] < Infinity) tsum += Tm[mi][ij] * tmode[mi][ij]; });
      if (bestT[ij] < Infinity) acc += A.jobs[j] * Math.exp(-0.045 * bestT[ij]);
    }
    acc /= totJobs;
    accCity += acc * A.pop[d];
    const dm = {};
    for (const m of MODES) dm[m] = trips > 0 ? mt[m] / trips : 0;
    const com = A.jC[d] + 1;
    const spend = footfall[d] * clamp(0.6 + 0.4 * A.walkQ[d], 0.5, 1.4) * A.sm[d].retail;
    spendCity += spend; comCity += com;
    districts.push({
      pop: A.pop[d], jobs: A.jobs[d], jC: A.jC[d], jO: A.jO[d], jI: A.jI[d],
      density: A.pop[d] / Math.max(G.districts[d].area, 0.01),
      modal: dm, trips, commute: trips > 0 ? tsum / trips : 0,
      walkQ: A.walkQ[d], bikeQ: A.bikeQ[d], mix: A.mix[d], roadKm: A.roadKm[d], laneKm: A.laneKm[d], busLaneKm: A.busLaneKm[d],
      cov: { bus: cov('bus', d), metro: cov('metro', d), lrt: cov('lrt', d), rail: cov('rail', d), any: A.pop[d] > 0 ? A.anyCov[d] / A.pop[d] : 0 },
      access: acc, spend, com,
      congestion: dVT0[d] > 0 ? dVT[d] / dVT0[d] - 1 : 0,
      styleMix: Object.fromEntries(STYLE_KEYS.map(s => [s, A.roadKm[d] > 0 ? A.style[s][d] / A.roadKm[d] : 0])),
      parks: A.parks[d],
    });
  }
  const vitRef = spendCity / Math.max(1, comCity);
  for (const ds of districts) {
    const raw = ds.spend / ds.com;
    ds.vitality = clamp(raw / Math.max(vitRef, 1e-6) * clamp(vitRef / 6, 0.6, 1.3), 0.2, 2.5);
  }
  const prevHist = G.stats;
  G.stats = {
    trips: totalTrips, modal, modeTrips: modeTot,
    commute: totalTrips > 0 ? timeSum / totalTrips : 0, tripKm: totalTrips > 0 ? kmSum / totalTrips : 0,
    congestion: Math.max(0, congRatio - 1), congRatio, delayVehH: delayH, vkm, capKm, util: capKm > 0 ? vkm / capKm : 0,
    roadKm, laneKm, ridership, capacity,
    access: accCity / totPop, vitality: clamp(vitRef / 6, 0.4, 1.6),
    sustainable: SUSTAINABLE.reduce((s, m) => s + modal[m], 0),
    transitCoverage: A.anyCov.reduce((s, v) => s + v, 0) / totPop,
    alleyX: Array.from({ length: Dn }, (_, d) => alleyCap[d] > 0 ? vehOD[d * Dn + d] * dIntra[d] * (1 - roadShare[d]) / alleyCap[d] : 0),
    own, districts, assessMs: performance.now() - tStart,
    ownCar: own.car, ownScooter: own.sc,
  };
  return G.stats;
}
