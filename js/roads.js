import { CELL } from './data/taipei.js';
import { distSeg, T_WATER, T_MTN } from './world.js';

export const ROAD_TYPES = {
  street:     { label: 'Street',         rank: 1, sat: 1500, speed: 30, lanes: 1, maxLanes: 2, sidewalk: 2.5, signal: false, cycle: 90,  green: 0.5,  cost: 6,  surface: true,  laneW: 3.0, minPx: 1.8, fill: '#ffffff', casing: '#9a9486' },
  avenue:     { label: 'Avenue',         rank: 2, sat: 1800, speed: 50, lanes: 2, maxLanes: 4, sidewalk: 3.5, signal: true,  cycle: 120, green: 0.55, cost: 9,  surface: true,  laneW: 3.3, minPx: 2.6, fill: '#fff4cf', casing: '#c4b384' },
  boulevard:  { label: 'Boulevard',      rank: 3, sat: 1800, speed: 60, lanes: 3, maxLanes: 5, sidewalk: 5,   signal: true,  cycle: 150, green: 0.6,  cost: 13, surface: true,  laneW: 3.4, minPx: 3.4, fill: '#ffe39a', casing: '#c39d45' },
  highway:    { label: 'Highway',        rank: 4, sat: 1900, speed: 70, lanes: 2, maxLanes: 4, sidewalk: 1,   signal: true,  cycle: 150, green: 0.65, cost: 16, surface: true,  laneW: 3.5, minPx: 3.6, fill: '#ffcf75', casing: '#b3852a' },
  expressway: { label: 'Expressway',     rank: 5, sat: 2000, speed: 90, lanes: 3, maxLanes: 5, sidewalk: 0,   signal: false, cycle: 0,   green: 1,    cost: 90, surface: false, laneW: 3.6, minPx: 4.2, fill: '#f49a55', casing: '#9c521b' },
  pedestrian: { label: 'Pedestrian St.', rank: 0, sat: 0,    speed: 5,  lanes: 0, maxLanes: 0, sidewalk: 8,   signal: false, cycle: 0,   green: 1,    cost: 8,  surface: true,  laneW: 0,   minPx: 1.8, fill: '#f6dcc6', casing: '#c9a386' },
};

export const STYLES = {
  NL: { label: 'Dutch',    flag: '🇳🇱', cap: 0.92, speed: 0.9,  walk: 0.35, bike: 1.0,  car: -0.35, bus: 0.1,  transit: 0.1,  retail: 1.15, sigDelay: 0.85, bikeColor: '#c0392b', desc: 'Protected cycle tracks, traffic calming, people-first streets. Big boost to cycling and shops, slower cars.' },
  JP: { label: 'Japanese', flag: '🇯🇵', cap: 1.0,  speed: 0.95, walk: 0.45, bike: 0.3,  car: -0.2,  bus: 0.1,  transit: 0.25, retail: 1.12, sigDelay: 0.8,  bikeColor: '#2b7bc0', desc: 'Narrow, efficient streets with excellent sidewalks and tight transit integration.' },
  UK: { label: 'British',  flag: '🇬🇧', cap: 0.97, speed: 1.0,  walk: 0.25, bike: 0.2,  car: -0.1,  bus: 0.35, transit: 0.1,  retail: 1.05, sigDelay: 0.75, bikeColor: '#27ae60', desc: 'Bus priority, roundabouts at unsignalised junctions. Strong bus ridership.' },
  US: { label: 'American', flag: '🇺🇸', cap: 1.15, speed: 1.1,  walk: -0.35, bike: -0.3, car: 0.45,  bus: -0.15, transit: -0.1, retail: 0.9,  sigDelay: 1.1,  bikeColor: '#16a085', desc: 'Wide lanes and high capacity for cars, weaker walking, cycling and retail streets.' },
};

export const BIKE_LANES = {
  none: { label: 'None', q: 0, cost: 0, w: 0 },
  painted: { label: 'Painted', q: 0.5, cost: 2, w: 1.5 },
  protected: { label: 'Protected', q: 1, cost: 8, w: 2.2 },
};

export function defaultCfg(type, style = 'JP') {
  const t = ROAD_TYPES[type];
  const c = {
    lanes: t.lanes, oneWay: false, sidewalk: t.sidewalk, arcade: false, trees: type === 'boulevard',
    busLane: false, bikeLane: 'none', signal: { on: t.signal, cycle: t.cycle || 90, green: t.green || 0.5 },
    speed: t.speed, style,
  };
  if (type !== 'expressway' && type !== 'pedestrian') {
    if (style === 'NL') { c.bikeLane = type === 'street' ? 'painted' : 'protected'; c.speed = Math.min(c.speed, type === 'street' ? 30 : 50); c.trees = true; }
    if (style === 'JP') { c.sidewalk += 0.5; }
    if (style === 'UK') { if (type === 'avenue' || type === 'boulevard') c.busLane = true; if (type === 'street') c.signal.on = false; }
    if (style === 'US') { if (type !== 'street') c.lanes = Math.min(t.maxLanes, c.lanes + 1); c.sidewalk = Math.max(1, c.sidewalk - 1.5); c.speed += 10; }
  }
  if (type === 'expressway') { c.sidewalk = 0; c.signal.on = false; c.bikeLane = 'none'; }
  if (type === 'pedestrian') { c.lanes = 0; c.signal.on = false; c.trees = true; }
  if (c.busLane && c.lanes < 2) c.busLane = false;
  return c;
}

export function roadWidthM(type, c) {
  const t = ROAD_TYPES[type];
  const dirs = c.oneWay ? 1 : 2;
  return c.lanes * dirs * t.laneW + c.sidewalk * 2 + BIKE_LANES[c.bikeLane].w * dirs + (type === 'pedestrian' ? 4 : 0);
}

export function costPerKm(type, c) {
  const t = ROAD_TYPES[type];
  if (type === 'pedestrian') return t.cost + c.sidewalk * 0.5 + (c.trees ? 1 : 0);
  const dirs = c.oneWay ? 1 : 2;
  return t.cost * Math.max(1, c.lanes * dirs) + c.sidewalk * 1.2 + BIKE_LANES[c.bikeLane].cost * dirs +
    (c.trees ? 1 : 0) + (c.arcade ? 2 : 0) + (c.busLane ? 2 : 0) + (c.signal.on ? 1 : 0);
}
export const terrainMult = e => 1 + (e.water || 0) * 5 + (e.mtn || 0) * 1.5;

// ---------------------------------------------------------------- network
export function newNet() { return { nodes: {}, edges: {}, roads: {}, nextId: 1, ver: 0 }; }

export function addNode(net, x, y) {
  const id = net.nextId++;
  return (net.nodes[id] = { id, x, y, e: [] });
}

function edgeFlags(G, e, A, B) {
  const g = G.grid;
  let w = 0, m = 0;
  for (let s = 0; s < 6; s++) {
    const t = (s + 0.5) / 6, x = A.x + (B.x - A.x) * t, y = A.y + (B.y - A.y) * t;
    const i = Math.floor(x / CELL), j = Math.floor(y / CELL);
    if (i < 0 || j < 0 || i >= g.w || j >= g.h) continue;
    const tr = g.terrain[j * g.w + i];
    if (tr === T_WATER) w++; else if (tr === T_MTN) m++;
  }
  e.water = w / 6; e.mtn = m / 6;
  e.len = Math.hypot(B.x - A.x, B.y - A.y);
  const mx = (A.x + B.x) / 2, my = (A.y + B.y) / 2;
  const i = Math.floor(mx / CELL), j = Math.floor(my / CELL);
  e.dist = (i >= 0 && j >= 0 && i < g.w && j < g.h) ? g.district[j * g.w + i] : -1;
}

export function addEdge(G, net, a, b, road) {
  if (a === b) return null;
  const A = net.nodes[a], B = net.nodes[b];
  const id = net.nextId++;
  const e = { id, a, b, road, len: 0, vol: [0, 0], cap: [0, 0], t0: [0, 0], t: [0, 0] };
  edgeFlags(G, e, A, B);
  net.edges[id] = e;
  A.e.push(id); B.e.push(id);
  net.ver++;
  return e;
}

export function removeEdge(net, id) {
  const e = net.edges[id];
  if (!e) return;
  for (const n of [e.a, e.b]) {
    const N = net.nodes[n];
    if (N) N.e = N.e.filter(x => x !== id);
  }
  delete net.edges[id];
  net.ver++;
}

export function cleanupNodes(net, keep = new Set()) {
  for (const n of Object.values(net.nodes)) if (!n.e.length && !keep.has(n.id)) delete net.nodes[n.id];
  const used = new Set(Object.values(net.edges).map(e => e.road));
  for (const r of Object.keys(net.roads)) if (!used.has(+r)) delete net.roads[r];
}

export function splitEdge(G, net, eid, x, y) {
  const e = net.edges[eid];
  const n = addNode(net, x, y);
  const oldB = e.b;
  const B = net.nodes[oldB];
  B.e = B.e.filter(i => i !== eid);
  e.b = n.id; n.e.push(eid);
  edgeFlags(G, e, net.nodes[e.a], n);
  const e2 = addEdge(G, net, n.id, oldB, e.road);
  e2.vol = [...e.vol];
  net.ver++;
  return n;
}

export function edgeExists(net, a, b) {
  const A = net.nodes[a];
  return A.e.some(id => { const e = net.edges[id]; return (e.a === a && e.b === b) || (e.a === b && e.b === a); });
}

export function nearestNode(net, x, y, r, filter) {
  let best = null, bd = r;
  for (const n of Object.values(net.nodes)) {
    const d = Math.hypot(n.x - x, n.y - y);
    if (d < bd && (!filter || filter(n))) { bd = d; best = n; }
  }
  return best;
}

export function nearestEdge(net, x, y, r, filter) {
  let best = null, bd = r;
  for (const e of Object.values(net.edges)) {
    if (filter && !filter(e)) continue;
    const A = net.nodes[e.a], B = net.nodes[e.b];
    const d = distSeg(x, y, A.x, A.y, B.x, B.y);
    if (d < bd) { bd = d; best = e; }
  }
  if (!best) return null;
  const A = net.nodes[best.a], B = net.nodes[best.b];
  const dx = B.x - A.x, dy = B.y - A.y, l2 = dx * dx + dy * dy || 1;
  const t = Math.max(0, Math.min(1, ((x - A.x) * dx + (y - A.y) * dy) / l2));
  return { edge: best, t, x: A.x + dx * t, y: A.y + dy * t, d: bd };
}

function segInter(A, B, P, Q) {
  const rx = B.x - A.x, ry = B.y - A.y, sx = Q.x - P.x, sy = Q.y - P.y;
  const den = rx * sy - ry * sx;
  if (Math.abs(den) < 1e-12) return null;
  const t = ((P.x - A.x) * sy - (P.y - A.y) * sx) / den;
  const u = ((P.x - A.x) * ry - (P.y - A.y) * rx) / den;
  if (t > 1e-6 && t < 1 - 1e-6 && u > 1e-6 && u < 1 - 1e-6) return { t, u };
  return null;
}

const isSurface = (net, e) => ROAD_TYPES[net.roads[e.road].type].surface;

/**
 * Build a road through a list of points. Each point may carry `node` (snap to
 * an existing node) or `edge` (split that edge). Surface roads automatically
 * create intersections with other surface roads they cross. Expressways are
 * grade-separated: they get interchanges where they cross avenues, boulevards
 * or highways (at least IC_SPACING apart); streets pass underneath.
 */
export const IC_SPACING = 0.8;
function isInterchange(net, n) {
  let ex = false, su = false;
  for (const id of n.e) { const t = net.roads[net.edges[id].road].type; if (ROAD_TYPES[t].surface) su = true; else ex = true; }
  return ex && su;
}
function nearInterchange(net, x, y, r) {
  for (const n of Object.values(net.nodes)) if (Math.abs(n.x - x) < r && Math.abs(n.y - y) < r && Math.hypot(n.x - x, n.y - y) < r && isInterchange(net, n)) return true;
  return false;
}
export function buildRoad(G, net, pts, type, cfg, name) {
  const road = { id: net.nextId++, type, name: name || autoName(net, type), cfg: JSON.parse(JSON.stringify(cfg)) };
  net.roads[road.id] = road;
  const surface = ROAD_TYPES[type].surface;
  const nodeIds = [];
  for (const p of pts) {
    let id;
    if (p.node && net.nodes[p.node]) id = p.node;
    else if (p.edge && net.edges[p.edge]) id = splitEdge(G, net, p.edge, p.x, p.y).id;
    else id = addNode(net, p.x, p.y).id;
    if (nodeIds[nodeIds.length - 1] !== id) nodeIds.push(id);
  }
  const created = [];
  const newMajor = surface && ROAD_TYPES[type].rank >= 2;
  const ics = [];  // interchanges created by this build
  for (let s = 0; s < nodeIds.length - 1; s++) {
    const A = net.nodes[nodeIds[s]], B = net.nodes[nodeIds[s + 1]];
    const chain = [A.id];
    {
      const hits = [];
      for (const e of Object.values(net.edges)) {
        if (e.road === road.id) continue;
        if (e.a === A.id || e.b === A.id || e.a === B.id || e.b === B.id) continue;
        const et = ROAD_TYPES[net.roads[e.road].type];
        let ic;
        if (surface && et.surface) ic = false;
        else if (surface && !et.surface && newMajor) ic = true;
        else if (!surface && et.surface && et.rank >= 2) ic = true;
        else continue;
        const r = segInter(A, B, net.nodes[e.a], net.nodes[e.b]);
        if (r) hits.push({ t: r.t, e: e.id, ic });
      }
      hits.sort((a, b) => a.t - b.t);
      for (const h of hits) {
        const e = net.edges[h.e];
        if (!e) continue;
        const P = net.nodes[e.a], Q = net.nodes[e.b];
        const x = A.x + (B.x - A.x) * h.t, y = A.y + (B.y - A.y) * h.t;
        if (h.ic) {
          if (ics.some(p => Math.hypot(p.x - x, p.y - y) < IC_SPACING) || nearInterchange(net, x, y, IC_SPACING)) continue;
          ics.push({ x, y });
        }
        let nid;
        if (Math.hypot(P.x - x, P.y - y) < 0.015) nid = P.id;
        else if (Math.hypot(Q.x - x, Q.y - y) < 0.015) nid = Q.id;
        else nid = splitEdge(G, net, e.id, x, y).id;
        if (chain[chain.length - 1] !== nid) chain.push(nid);
      }
    }
    chain.push(B.id);
    for (let c = 0; c < chain.length - 1; c++) {
      if (chain[c] === chain[c + 1] || edgeExists(net, chain[c], chain[c + 1])) continue;
      const e = addEdge(G, net, chain[c], chain[c + 1], road.id);
      if (e) created.push(e);
    }
  }
  if (!created.length) { delete net.roads[road.id]; return null; }
  return { road, edges: created };
}

let nameCounter = 1;
function autoName(net, type) {
  const base = { street: 'Lane', avenue: 'Rd', boulevard: 'Blvd', highway: 'Hwy', expressway: 'Expwy', pedestrian: 'Walk' }[type];
  return `${base} ${Object.keys(net.roads).length + nameCounter++}`;
}

export function roadEdges(net, roadId) { return Object.values(net.edges).filter(e => e.road === roadId); }
export function roadLength(net, roadId) { return roadEdges(net, roadId).reduce((s, e) => s + e.len, 0); }
export function roadCost(net, road) {
  return roadEdges(net, road.id).reduce((s, e) => s + e.len * costPerKm(road.type, road.cfg) * terrainMult(e), 0);
}

// ---------------------------------------------------------------- graph
export function buildGraph(net) {
  const nodes = Object.values(net.nodes);
  const index = new Map();
  nodes.forEach((n, i) => index.set(n.id, i));
  const adj = nodes.map(() => []);
  const edges = Object.values(net.edges);
  const deg = new Int16Array(nodes.length);
  for (const e of edges) {
    const r = net.roads[e.road];
    const ai = index.get(e.a), bi = index.get(e.b);
    if (ROAD_TYPES[r.type].surface) { deg[ai]++; deg[bi]++; }
    adj[ai].push(e, bi, 0);
    if (!r.cfg.oneWay) adj[bi].push(e, ai, 1);
  }
  for (const n of nodes) n.deg = deg[index.get(n.id)];
  return { nodes, index, adj, edges, ver: net.ver };
}

class Heap {
  constructor() { this.k = []; this.v = []; }
  get size() { return this.k.length; }
  push(key, val) {
    const k = this.k, v = this.v;
    let i = k.length; k.push(key); v.push(val);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (k[p] <= key) break;
      k[i] = k[p]; v[i] = v[p]; i = p;
    }
    k[i] = key; v[i] = val;
  }
  pop() {
    const k = this.k, v = this.v;
    const topK = k[0], topV = v[0];
    const lk = k.pop(), lv = v.pop();
    const n = k.length;
    if (n) {
      let i = 0;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= n) break;
        if (c + 1 < n && k[c + 1] < k[c]) c++;
        if (k[c] >= lk) break;
        k[i] = k[c]; v[i] = v[c]; i = c;
      }
      k[i] = lk; v[i] = lv;
    }
    this.topK = topK;
    return topV;
  }
}

/** Dijkstra over the road graph. cost(e, dir) returns minutes (Infinity = blocked). */
export function dijkstra(graph, src, cost) {
  const n = graph.nodes.length;
  const dist = new Float64Array(n).fill(Infinity);
  const km = new Float64Array(n);
  const prevE = new Array(n);
  const prevD = new Int8Array(n);
  const prevN = new Int32Array(n).fill(-1);
  const h = new Heap();
  dist[src] = 0; h.push(0, src);
  while (h.size) {
    const u = h.pop(), d = h.topK;
    if (d > dist[u]) continue;
    const a = graph.adj[u];
    for (let q = 0; q < a.length; q += 3) {
      const e = a[q], v = a[q + 1], dir = a[q + 2];
      const c = cost(e, dir);
      if (c === Infinity) continue;
      const nd = d + c;
      if (nd < dist[v]) {
        dist[v] = nd; km[v] = km[u] + e.len; prevE[v] = e; prevD[v] = dir; prevN[v] = u;
        h.push(nd, v);
      }
    }
  }
  return { dist, km, prevE, prevD, prevN };
}

/** Recompute which cells have road access, and expressway noise. */
export function updateAccess(G) {
  const g = G.grid, net = G.net;
  g.access.fill(0);
  for (let k = 0; k < g.n; k++) g.noise[k] &= ~1;
  for (const e of Object.values(net.edges)) {
    const r = net.roads[e.road], T = ROAD_TYPES[r.type];
    const A = net.nodes[e.a], B = net.nodes[e.b];
    const steps = Math.max(1, Math.ceil(e.len / 0.1));
    const cls = T.surface ? (r.type === 'street' || r.type === 'pedestrian' ? 1 : r.type === 'avenue' ? 2 : 3) : 0;
    for (let s = 0; s <= steps; s++) {
      const x = A.x + (B.x - A.x) * s / steps, y = A.y + (B.y - A.y) * s / steps;
      const ci = Math.floor(x / CELL), cj = Math.floor(y / CELL);
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        const i = ci + di, j = cj + dj;
        if (i < 0 || j < 0 || i >= g.w || j >= g.h) continue;
        const k = j * g.w + i;
        if (cls) { if (g.access[k] < cls) g.access[k] = cls; }
        else g.noise[k] |= 1;
      }
    }
  }
}
