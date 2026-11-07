import { CELL } from './data/taipei.js';
import { buildGraph, dijkstra, ROAD_TYPES } from './roads.js';
import { cellAt } from './world.js';

export const TRANSIT = {
  bus:   { label: 'Bus',           speed: 18, cap: 70,   fare: 15, opsPerVeh: 2.5, vehCost: 3,   stationCost: 0.3,  trackCost: 0,    radius: 0.4, headway: 10, bit: 1, color: '#1e88e5' },
  metro: { label: 'Metro',         speed: 34, cap: 1800, fare: 25, opsPerVeh: 45,  vehCost: 300, stationCost: 1200, trackCost: 2500, elevCost: 1100, radius: 0.8, headway: 5,  bit: 2, color: '#8e24aa' },
  lrt:   { label: 'Light Rail',    speed: 20, cap: 260,  fare: 20, opsPerVeh: 10,  vehCost: 80,  stationCost: 60,   trackCost: 400,  radius: 0.5, headway: 8,  bit: 4, color: '#00acc1' },
  rail:  { label: 'Commuter Rail', speed: 45, cap: 1200, fare: 30, opsPerVeh: 40,  vehCost: 250, stationCost: 200,  trackCost: 500,  radius: 0.9, headway: 20, bit: 8, color: '#6d4c41' },
};
export const LINE_COLORS = ['#e3002c', '#0070bd', '#008659', '#f8b61c', '#c48c31', '#8246af', '#e4007f', '#00a0e9', '#7cb342', '#ff6f00', '#5d4037', '#00897b'];

export function newTransit() { return { stations: {}, lines: {}, stops: {}, routes: {}, nextId: 1 }; }

export function addStation(G, type, x, y, name) {
  const T = G.transit;
  const id = T.nextId++;
  const k = cellAt(G, x, y);
  const d = k >= 0 ? G.grid.district[k] : -1;
  const n = Object.values(T.stations).filter(s => s.type === type && s.district === d).length + 1;
  const dn = d >= 0 ? G.districts[d].name : 'Outer';
  T.stations[id] = { id, type, x, y, district: d, name: name || `${dn} ${n}` };
  return T.stations[id];
}

export function addLine(G, type, stationIds, opts = {}) {
  const T = G.transit;
  const id = T.nextId++;
  const count = Object.values(T.lines).filter(l => l.type === type).length;
  const line = {
    id, type, stations: stationIds.slice(),
    name: opts.name || `${TRANSIT[type].label} Line ${count + 1}`,
    color: opts.color || LINE_COLORS[(Object.keys(T.lines).length) % LINE_COLORS.length],
    headway: opts.headway || TRANSIT[type].headway,
    elevated: !!opts.elevated,
    ridership: 0, lf: 0, crowdPen: 0,
  };
  T.lines[id] = line;
  return line;
}

export function lineLength(G, line) {
  let L = 0;
  for (let i = 1; i < line.stations.length; i++) {
    const a = G.transit.stations[line.stations[i - 1]], b = G.transit.stations[line.stations[i]];
    if (a && b) L += Math.hypot(a.x - b.x, a.y - b.y);
  }
  return L;
}

export function lineVehicles(G, line) {
  const spec = TRANSIT[line.type];
  const len = line.type === 'bus' ? (line.len || 0) : lineLength(G, line);
  const cycle = 2 * len / spec.speed * 60 + 6;
  return Math.max(1, Math.ceil(cycle / line.headway));
}

/** Hourly one-direction capacity (passengers per hour per direction). */
export const lineCapacity = line => 60 / line.headway * TRANSIT[line.type].cap;

export function trackCostPerKm(type, elevated) {
  const s = TRANSIT[type];
  return type === 'metro' && elevated ? s.elevCost : s.trackCost;
}

/** Capital cost of a new segment between two points (km). */
export function segmentCost(G, type, a, b, elevated) {
  const len = Math.hypot(a.x - b.x, a.y - b.y);
  return len * trackCostPerKm(type, elevated);
}

export function stationLines(G, sid) {
  return Object.values(G.transit.lines).filter(l => l.stations.includes(sid));
}

export function removeStation(G, sid) {
  const T = G.transit;
  for (const l of Object.values(T.lines)) {
    l.stations = l.stations.filter(s => s !== sid);
    if (l.stations.length < 2) delete T.lines[l.id];
  }
  delete T.stations[sid];
}

// ---------------------------------------------------------------- buses
export function addStop(G, nodeId) {
  const T = G.transit;
  const existing = Object.values(T.stops).find(s => s.node === nodeId);
  if (existing) return existing;
  const id = T.nextId++;
  const n = G.net.nodes[nodeId];
  const k = cellAt(G, n.x, n.y);
  T.stops[id] = { id, node: nodeId, district: k >= 0 ? G.grid.district[k] : -1 };
  return T.stops[id];
}

export function addRoute(G, stopIds, opts = {}) {
  const T = G.transit;
  const id = T.nextId++;
  const count = Object.values(T.routes).length;
  const r = {
    id, type: 'bus', stops: stopIds.slice(), name: opts.name || `Bus ${count + 1}`,
    color: opts.color || LINE_COLORS[(count + 3) % LINE_COLORS.length],
    headway: opts.headway || 10, path: [], len: 0, broken: false, busLaneFrac: 0, ridership: 0, lf: 0, crowdPen: 0,
  };
  T.routes[id] = r;
  computeRoutePath(G, r);
  return r;
}

export function stopPos(G, stop) { const n = G.net.nodes[stop.node]; return n ? { x: n.x, y: n.y } : null; }

let cachedGraph = null;
export function routeGraph(G) {
  if (!cachedGraph || cachedGraph.ver !== G.net.ver || cachedGraph.net !== G.net) {
    cachedGraph = buildGraph(G.net);
    cachedGraph.net = G.net;
  }
  return cachedGraph;
}

const busCost = net => (e, dir) => {
  const r = net.roads[e.road];
  if (r.type === 'pedestrian') return Infinity;
  return e.len / Math.max(5, r.cfg.speed) * 60;
};

export function computeRoutePath(G, r) {
  const graph = routeGraph(G);
  const net = G.net;
  r.path = []; r.len = 0; r.broken = false;
  let blLen = 0;
  for (let i = 0; i < r.stops.length - 1; i++) {
    const a = G.transit.stops[r.stops[i]], b = G.transit.stops[r.stops[i + 1]];
    if (!a || !b) { r.broken = true; continue; }
    const ai = graph.index.get(a.node), bi = graph.index.get(b.node);
    if (ai === undefined || bi === undefined) { r.broken = true; continue; }
    const res = dijkstra(graph, ai, busCost(net));
    if (res.dist[bi] === Infinity) { r.broken = true; continue; }
    const seg = [];
    let v = bi;
    while (v !== ai) { const e = res.prevE[v]; seg.push([e.id, res.prevD[v]]); v = res.prevN[v]; }
    seg.reverse();
    for (const [eid] of seg) {
      const e = net.edges[eid];
      r.len += e.len;
      const rd = net.roads[e.road];
      if (rd.cfg.busLane) blLen += e.len;
    }
    r.path.push(...seg);
  }
  r.busLaneFrac = r.len ? blLen / r.len : 0;
}

export function recomputeAllRoutes(G) {
  for (const r of Object.values(G.transit.routes)) computeRoutePath(G, r);
}

export function routePolyline(G, r) {
  const net = G.net, pts = [];
  for (const [eid, dir] of r.path) {
    const e = net.edges[eid];
    if (!e) continue;
    const A = net.nodes[dir ? e.b : e.a], B = net.nodes[dir ? e.a : e.b];
    if (!pts.length) pts.push([A.x, A.y]);
    pts.push([B.x, B.y]);
  }
  return pts;
}

// ---------------------------------------------------------------- coverage
export function computeCoverage(G) {
  const g = G.grid, T = G.transit;
  g.cov.fill(0);
  const stamp = (x, y, r, bit) => {
    const ci = Math.floor(x / CELL), cj = Math.floor(y / CELL), rc = Math.ceil(r / CELL);
    for (let j = cj - rc; j <= cj + rc; j++) for (let i = ci - rc; i <= ci + rc; i++) {
      if (i < 0 || j < 0 || i >= g.w || j >= g.h) continue;
      const dx = (i + 0.5) * CELL - x, dy = (j + 0.5) * CELL - y;
      if (dx * dx + dy * dy <= r * r) g.cov[j * g.w + i] |= bit;
    }
  };
  const served = new Set();
  for (const l of Object.values(T.lines)) for (const s of l.stations) served.add(s);
  for (const s of Object.values(T.stations)) {
    if (!served.has(s.id)) continue;
    stamp(s.x, s.y, TRANSIT[s.type].radius, TRANSIT[s.type].bit);
  }
  // buses stop every ~400 m along their whole path (clicked stops are the key stops)
  for (const r of Object.values(T.routes)) {
    if (r.broken) continue;
    for (const [x, y] of routeSamples(G, r)) stamp(x, y, TRANSIT.bus.radius, 1);
  }
}

/** Implicit stop positions every `spacing` km along a bus route's path. */
export function routeSamples(G, r, spacing = 0.4) {
  const pts = routePolyline(G, r);
  const out = [];
  if (pts.length < 2) return out;
  out.push(pts[0]);
  let carry = 0;
  for (let i = 1; i < pts.length; i++) {
    const [ax, ay] = pts[i - 1], [bx, by] = pts[i];
    const L = Math.hypot(bx - ax, by - ay);
    let d = spacing - carry;
    while (d <= L) { out.push([ax + (bx - ax) * d / L, ay + (by - ay) * d / L]); d += spacing; }
    carry = L - (d - spacing);
  }
  out.push(pts[pts.length - 1]);
  return out;
}

export function allLines(G) {
  return [...Object.values(G.transit.lines), ...Object.values(G.transit.routes)];
}
