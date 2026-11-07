// Headless calibration harness: scripted "players" run through the simulation
// without the UI so the model can be compared against real Taipei history.
// Usage (browser console on dev/calibrate.html):  await runScenario('historical', 2030)
import { G } from '../js/state.js';
import * as sim from '../js/sim.js';
import * as Rd from '../js/roads.js';
import * as tr from '../js/transit.js';
import { ll } from '../js/data/taipei.js';
import { cellAt, T_LAND, T_WATER, S, Z } from '../js/world.js';
import { SUSTAINABLE } from '../js/traffic.js';

const P = (lon, lat) => { const [x, y] = ll(lon, lat); return { x, y }; };
let spent = 0;
const pay = m => { spent += m; if (isFinite(G.funds)) G.funds -= m; };

function snap(p) { const n = Rd.nearestNode(G.net, p.x, p.y, 0.05); return n ? { x: n.x, y: n.y, node: n.id } : p; }

export function roadXY(pts, type, style = 'JP', over = {}, name) {
  const cfg = Rd.defaultCfg(type, style);
  for (const [k, v] of Object.entries(over)) { if (k === 'signal') Object.assign(cfg.signal, v); else cfg[k] = v; }
  const res = Rd.buildRoad(G, G.net, pts.map(snap), type, cfg, name);
  if (res) pay(res.edges.reduce((s, e) => s + e.len * Rd.costPerKm(type, cfg) * Rd.terrainMult(e), 0));
  return res?.road;
}
export const road = (pts, type, style, over, name) => roadXY(pts.map(p => P(...p)), type, style, over, name);

/** Street grid inside a lon/lat box, skipping water and land outside the city. */
export function grid(lon0, lat0, lon1, lat1, sp, type, style = 'JP', over = {}) {
  const a = P(lon0, lat0), b = P(lon1, lat1);
  const ax = Math.min(a.x, b.x), bx = Math.max(a.x, b.x), ay = Math.min(a.y, b.y), by = Math.max(a.y, b.y);
  const g = G.grid;
  const ok = (x, y) => { const k = cellAt(G, x, y); return k >= 0 && g.district[k] >= 0 && g.terrain[k] !== T_WATER && g.special[k] !== S.AIRPORT; };
  const lines = [];
  for (let x = Math.ceil(ax / sp) * sp; x <= bx; x += sp) lines.push([x, ay, x, by]);
  for (let y = Math.ceil(ay / sp) * sp; y <= by; y += sp) lines.push([ax, y, bx, y]);
  let km = 0;
  for (const [x0, y0, x1, y1] of lines) {
    const n = Math.max(1, Math.round(Math.hypot(x1 - x0, y1 - y0) / 0.05));
    let st = null;
    for (let s = 0; s <= n; s++) {
      const x = x0 + (x1 - x0) * s / n, y = y0 + (y1 - y0) * s / n, good = ok(x, y);
      if (good && !st) st = { x, y };
      if ((!good || s === n) && st) {
        if (Math.hypot(x - st.x, y - st.y) > 0.15) { roadXY([st, { x, y }], type, style, over); km += Math.hypot(x - st.x, y - st.y); }
        st = null;
      }
    }
  }
  return km;
}

/** Zone land in a box. mode 'empty' only touches unzoned land, 'all' overwrites zoned land too. */
export function zone(lon0, lat0, lon1, lat1, z, mode = 'empty') {
  const a = P(lon0, lat0), b = P(lon1, lat1), g = G.grid;
  let n = 0;
  for (let k = 0; k < g.n; k++) {
    const x = (k % g.w + 0.5) * 0.2, y = (Math.floor(k / g.w) + 0.5) * 0.2;
    if (x < Math.min(a.x, b.x) || x > Math.max(a.x, b.x) || y < Math.min(a.y, b.y) || y > Math.max(a.y, b.y)) continue;
    if (g.district[k] < 0 || g.terrain[k] !== T_LAND || g.special[k]) continue;
    if (mode === 'empty' && g.zone[k]) continue;
    if (!G.districts[g.district[k]].law.allow[z]) continue;
    if (g.zone[k] !== z) { g.zone[k] = z; if (mode === 'all' && !(z === Z.M && (g.zone[k] === Z.R || g.zone[k] === Z.C))) g.level[k] = Math.min(g.level[k], 1); n++; }
  }
  return n;
}

export function law(key, patch) {
  const d = G.districts.find(d => d.key === key);
  if (patch.allow) d.law.allow = patch.allow;
  Object.assign(d.law, { ...patch, allow: d.law.allow });
}
export const allLaws = patch => G.districts.forEach(d => law(d.key, patch));

/** Rail-type line from [name, lon, lat] stations; stations of the same type within 150 m are shared. */
export function line(type, stations, opts = {}) {
  const spec = tr.TRANSIT[type];
  const ids = [];
  for (const [name, lon, lat] of stations) {
    const p = P(lon, lat);
    let st = Object.values(G.transit.stations).find(s => s.type === type && Math.hypot(s.x - p.x, s.y - p.y) < 0.15);
    if (!st) { st = tr.addStation(G, type, p.x, p.y, name); pay(spec.stationCost); }
    ids.push(st.id);
  }
  const l = tr.addLine(G, type, ids, opts);
  pay(tr.lineLength(G, l) * tr.trackCostPerKm(type, opts.elevated) + tr.lineVehicles(G, l) * spec.vehCost);
  return l;
}

export function busRoute(pts, headway = 10, name) {
  const stops = [];
  for (const [lon, lat] of pts) {
    const p = P(lon, lat);
    const n = Rd.nearestNode(G.net, p.x, p.y, 0.8, n => n.e.some(id => G.net.roads[G.net.edges[id].road].type !== 'pedestrian' && G.net.roads[G.net.edges[id].road].type !== 'expressway'));
    if (!n) continue;
    const s = tr.addStop(G, n.id);
    if (stops[stops.length - 1] !== s.id) stops.push(s.id);
  }
  if (stops.length < 2) return null;
  const r = tr.addRoute(G, stops, { headway, name });
  pay(stops.length * tr.TRANSIT.bus.stationCost + tr.lineVehicles(G, r) * tr.TRANSIT.bus.vehCost);
  return r;
}

/** Patch the config of every road matching a filter (name prefix string or predicate), paying any increase. */
export function upgrade(filter, patch) {
  const net = G.net;
  const match = typeof filter === 'string' ? r => r.name.startsWith(filter) : filter;
  for (const r of Object.values(net.roads)) {
    if (!match(r)) continue;
    const before = Rd.roadCost(net, r);
    if (patch.type) { r.type = patch.type; r.cfg = Object.assign(Rd.defaultCfg(patch.type, patch.style || r.cfg.style), {}); }
    for (const [k, v] of Object.entries(patch)) { if (k === 'type') continue; if (k === 'signal') Object.assign(r.cfg.signal, v); else r.cfg[k] = v; }
    if (r.cfg.lanes < 2) r.cfg.busLane = false;
    pay(Math.max(0, Rd.roadCost(net, r) - before) * 1.05);
  }
}
export const isArterial = r => ['avenue', 'boulevard', 'highway'].includes(r.type);

export function metrics() {
  const st = G.stats, e = G.econ, sc = G.score || sim.computeScore();
  const m = st.modal;
  return {
    year: G.year,
    pop: Math.round(G.pop / 1e3), jobs: Math.round(G.jobs / 1e3),
    gdppc: Math.round(e.gdppc / 1e3),
    modal: Object.fromEntries(Object.entries(m).map(([k, v]) => [k, Math.round(v * 100)])),
    sus: Math.round(st.sustainable * 100),
    trip: +st.commute.toFixed(1), km: +st.tripKm.toFixed(1), cong: Math.round(st.congestion * 100),
    metro: Math.round(st.ridership.metro / 1e3), bus: Math.round(st.ridership.bus / 1e3),
    funds: isFinite(G.funds) ? Math.round(G.funds) : null, spent: Math.round(spent),
    score: Math.round(sc.total), grade: sc.grade,
    parts: Object.fromEntries(['prosperity', 'mobility', 'congestion', 'sustainability', 'transit', 'growth'].map(k => [k.slice(0, 4), Math.round(sc[k])])),
  };
}

export async function run(plan, to = 2030, every = 10) {
  sim.newGame({ sandbox: false });
  spent = 0;
  const acts = plan.slice().sort((a, b) => a[0] - b[0]);
  const out = [metrics()];
  let ai = 0;
  while (G.year < to) {
    let changed = false;
    while (ai < acts.length && acts[ai][0] <= G.year) { acts[ai][1](); ai++; changed = true; }
    if (changed) { sim.afterNetworkChange(); sim.refreshDerived(); }
    sim.monthlyTick();
    if (G.month === 0 && G.year % every === 0) out.push(metrics());
  }
  return out;
}

// ------------------------------------------------------------------ strategies
const TAMSUI_MRT = [['Taipei Main', 121.517, 25.046], ['Zhongshan', 121.520, 25.053], ['Shuanglian', 121.521, 25.058], ['Minquan W', 121.519, 25.062], ['Yuanshan', 121.520, 25.071], ['Jiantan', 121.525, 25.084], ['Shilin', 121.526, 25.093], ['Zhishan', 121.525, 25.103], ['Shipai', 121.515, 25.114], ['Qiyan', 121.507, 25.125], ['Beitou', 121.498, 25.132]];
const XINDIAN_MRT = [['Taipei Main', 121.517, 25.046], ['NTU Hospital', 121.516, 25.042], ['CKS Memorial', 121.518, 25.033], ['Guting', 121.523, 25.026], ['Gongguan', 121.534, 25.015], ['Wanlong', 121.539, 25.002], ['Jingmei', 121.541, 24.993]];
const BANNAN_MRT = [['Longshan Temple', 121.500, 25.035], ['Ximen', 121.508, 25.042], ['Taipei Main', 121.517, 25.046], ['Shandao Temple', 121.523, 25.045], ['Zhongxiao Xinsheng', 121.533, 25.042], ['Zhongxiao Fuxing', 121.544, 25.041], ['Zhongxiao Dunhua', 121.551, 25.041], ['SYS Memorial', 121.558, 25.041], ['City Hall', 121.565, 25.041], ['Yongchun', 121.576, 25.041], ['Houshanpi', 121.582, 25.045], ['Kunyang', 121.593, 25.050], ['Nangang', 121.607, 25.052]];
const WENHU_MRT = [['Taipei Zoo', 121.579, 24.998], ['Muzha', 121.574, 24.992], ['Wanfang', 121.568, 24.998], ['Xinhai', 121.557, 25.002], ['Liuzhangli', 121.553, 25.024], ['Technology Bldg', 121.543, 25.026], ['Daan', 121.543, 25.033], ['Zhongxiao Fuxing', 121.544, 25.041], ['Nanjing Fuxing', 121.544, 25.052], ['Zhongshan JHS', 121.544, 25.061], ['Songshan Airport', 121.551, 25.063], ['Dazhi', 121.547, 25.084], ['Jiannan Rd', 121.556, 25.085], ['Xihu', 121.567, 25.082], ['Gangqian', 121.575, 25.080], ['Wende', 121.585, 25.078], ['Neihu', 121.594, 25.084], ['Donghu', 121.616, 25.067], ['Nangang Exhibition', 121.618, 25.055]];
const SONGSHAN_MRT = [['Songshan', 121.578, 25.050], ['Nanjing Sanmin', 121.564, 25.052], ['Taipei Arena', 121.551, 25.052], ['Nanjing Fuxing', 121.544, 25.052], ['Songjiang Nanjing', 121.533, 25.052], ['Zhongshan', 121.520, 25.053], ['Beimen', 121.511, 25.049], ['Ximen', 121.508, 25.042], ['Xiaonanmen', 121.511, 25.035], ['CKS Memorial', 121.518, 25.033]];
const LUZHOU_MRT = [['Minquan W', 121.519, 25.062], ['Zhongshan Elem', 121.526, 25.063], ['Xingtian Temple', 121.533, 25.060], ['Songjiang Nanjing', 121.533, 25.052], ['Zhongxiao Xinsheng', 121.533, 25.042], ['Dongmen', 121.528, 25.034], ['Guting', 121.523, 25.026]];

const BUSES_1950s = [
  [[121.500, 25.036], [121.517, 25.047], [121.522, 25.070], [121.526, 25.093], [121.502, 25.134]],
  [[121.507, 25.042], [121.533, 25.043], [121.553, 25.041], [121.578, 25.042]],
  [[121.517, 25.032], [121.533, 25.013], [121.542, 24.993], [121.578, 24.988]],
  [[121.511, 25.060], [121.548, 25.052], [121.578, 25.051], [121.615, 25.054]],
  [[121.495, 25.030], [121.517, 25.027], [121.555, 25.025]],
];

export const STRATEGIES = {
  nothing: [],

  // Roughly what Taipei actually built
  historical: [
    [1951, () => BUSES_1950s.forEach(b => busRoute(b, 12))],
    [1955, () => grid(121.505, 25.078, 121.556, 25.012, 0.4, 'street', 'JP', { arcade: true, signal: { on: false } })],
    [1958, () => { zone(121.528, 25.045, 121.556, 25.012, Z.R); zone(121.518, 25.078, 121.548, 25.048, Z.M); }],
    [1960, () => { road([[121.549, 25.082], [121.549, 25.018]], 'avenue'); road([[121.533, 25.062], [121.533, 25.015]], 'avenue'); road([[121.578, 25.042], [121.615, 25.050]], 'avenue'); }],
    [1962, () => { zone(121.585, 25.082, 121.605, 25.068, Z.I); zone(121.600, 25.058, 121.625, 25.048, Z.I); zone(121.507, 25.050, 121.523, 25.040, Z.C, 'all'); }],
    [1965, () => { grid(121.553, 25.066, 121.592, 25.022, 0.4, 'street', 'JP', { arcade: true }); grid(121.512, 25.108, 121.538, 25.084, 0.4, 'street'); zone(121.553, 25.066, 121.592, 25.022, Z.M); zone(121.512, 25.108, 121.538, 25.084, Z.R); }],
    [1968, () => { busRoute([[121.526, 25.093], [121.549, 25.080], [121.592, 25.080]], 10); busRoute([[121.560, 24.995], [121.549, 25.030], [121.565, 25.041]], 10); BUSES_1950s.forEach(b => busRoute(b, 8)); }],
    [1970, () => { zone(121.528, 25.056, 121.565, 25.049, Z.O, 'all'); upgrade('Zhongxiao', { lanes: 3 }); upgrade('Nanjing', { type: 'avenue' }); }],
    [1972, () => { grid(121.540, 25.010, 121.585, 24.985, 0.5, 'street'); zone(121.540, 25.010, 121.585, 24.985, Z.R); upgrade(r => r.type === 'street' && r.name.includes('Rd'), { signal: { on: true } }); }],
    [1977, () => { road([[121.537, 25.082], [121.537, 25.020]], 'expressway'); road([[121.470, 25.105], [121.520, 25.088], [121.560, 25.081], [121.600, 25.068], [121.640, 25.058]], 'expressway'); }],
    [1980, () => { grid(121.556, 25.042, 121.574, 25.028, 0.3, 'boulevard'); zone(121.556, 25.042, 121.574, 25.028, Z.O, 'all'); grid(121.565, 25.088, 121.602, 25.066, 0.4, 'avenue'); zone(121.565, 25.088, 121.602, 25.066, Z.M); }],
    [1983, () => { busRoute([[121.500, 25.036], [121.551, 25.041], [121.565, 25.035]], 6); busRoute([[121.522, 25.052], [121.549, 25.052], [121.594, 25.080]], 6); busRoute([[121.502, 25.134], [121.526, 25.093], [121.549, 25.060], [121.549, 25.020]], 6); }],
    [1985, () => { grid(121.490, 25.140, 121.520, 25.115, 0.5, 'street'); zone(121.490, 25.140, 121.520, 25.115, Z.R); }],
    [1990, () => { upgrade(r => r.type === 'avenue' && r.cfg.lanes >= 2, { lanes: Math.max(3, 0) }); upgrade(r => ['Zhongxiao', 'Xinyi', 'Roosevelt'].some(n => r.name.startsWith(n)) || r.name.startsWith('Rd'), { busLane: true }); }],
    [1993, () => road([[121.505, 25.044], [121.540, 25.045], [121.580, 25.046]], 'expressway', 'JP', {}, 'Civic Expwy')],
    [1996, () => line('metro', WENHU_MRT.slice(0, 10), { headway: 5, name: 'Wenhu' })],
    [1997, () => { line('metro', TAMSUI_MRT, { headway: 5, name: 'Tamsui' }); line('metro', XINDIAN_MRT, { headway: 5, name: 'Xindian' }); }],
    [1999, () => line('metro', BANNAN_MRT, { headway: 4, name: 'Bannan' })],
    [2009, () => { const l = Object.values(G.transit.lines).find(l => l.name === 'Wenhu'); line('metro', WENHU_MRT.slice(9), { headway: 5, name: 'Wenhu Neihu' }); upgrade(isArterial, { bikeLane: 'painted' }); }],
    [2012, () => line('metro', LUZHOU_MRT, { headway: 5, name: 'Luzhou' })],
    [2014, () => line('metro', SONGSHAN_MRT, { headway: 5, name: 'Songshan' })],
  ],

  // Transit-first, mixed-use, people-oriented streets
  transit: [
    [1950, () => { allLaws({ allow: [false, true, true, true, true, false], parkingMin: false }); BUSES_1950s.forEach(b => busRoute(b, 8)); }],
    [1954, () => { grid(121.505, 25.078, 121.556, 25.012, 0.4, 'street', 'NL', { arcade: true }); zone(121.505, 25.078, 121.556, 25.012, Z.M); }],
    [1960, () => { road([[121.549, 25.082], [121.549, 25.018]], 'avenue', 'UK'); road([[121.533, 25.062], [121.533, 25.015]], 'avenue', 'UK'); road([[121.578, 25.042], [121.615, 25.050]], 'avenue', 'UK'); }],
    [1965, () => { grid(121.553, 25.066, 121.592, 25.022, 0.4, 'street', 'NL', { arcade: true }); zone(121.553, 25.066, 121.592, 25.022, Z.M); grid(121.512, 25.108, 121.538, 25.084, 0.4, 'street', 'NL'); zone(121.512, 25.108, 121.538, 25.084, Z.M); }],
    [1966, () => { BUSES_1950s.forEach(b => busRoute(b, 5)); busRoute([[121.526, 25.093], [121.549, 25.080], [121.592, 25.080]], 6); busRoute([[121.560, 24.995], [121.549, 25.030], [121.565, 25.041]], 6); }],
    [1970, () => { zone(121.528, 25.056, 121.565, 25.049, Z.O, 'all'); line('lrt', [['a', 121.500, 25.036], ['b', 121.517, 25.047], ['c', 121.533, 25.043], ['d', 121.551, 25.041], ['e', 121.578, 25.042], ['f', 121.607, 25.052]], { headway: 5, name: 'LRT East-West' }); }],
    [1972, () => { grid(121.540, 25.010, 121.585, 24.985, 0.5, 'street', 'NL'); zone(121.540, 25.010, 121.585, 24.985, Z.M); upgrade(r => r.type === 'avenue' || r.type === 'street' && r.name.includes('Rd'), { busLane: true, lanes: 2, bikeLane: 'protected', style: 'NL' }); }],
    [1976, () => line('lrt', [['a', 121.517, 25.032], ['b', 121.533, 25.013], ['c', 121.542, 24.993], ['d', 121.560, 24.990], ['e', 121.578, 24.988]], { headway: 5, name: 'LRT South' })],
    [1980, () => { grid(121.565, 25.088, 121.602, 25.066, 0.4, 'avenue', 'NL'); zone(121.565, 25.088, 121.602, 25.066, Z.M); zone(121.556, 25.042, 121.574, 25.028, Z.O, 'all'); grid(121.490, 25.140, 121.520, 25.115, 0.5, 'street', 'NL'); zone(121.490, 25.140, 121.520, 25.115, Z.M); }],
    [1985, () => { line('metro', BANNAN_MRT, { headway: 4, name: 'Bannan' }); line('metro', TAMSUI_MRT, { headway: 4, name: 'Tamsui' }); }],
    [1990, () => { line('metro', WENHU_MRT, { headway: 4, name: 'Wenhu' }); line('metro', XINDIAN_MRT, { headway: 4, name: 'Xindian' }); }],
    [1995, () => { line('metro', SONGSHAN_MRT, { headway: 4, name: 'Songshan' }); line('metro', LUZHOU_MRT, { headway: 4, name: 'Luzhou' }); }],
  ],

  // American-style car city
  car: [
    [1955, () => { allLaws({ parkingMin: true }); ['neihu', 'wenshan', 'beitou', 'shilin', 'nangang'].forEach(k => law(k, { allow: [false, true, false, false, false, false], maxLevel: 3 })); grid(121.505, 25.078, 121.556, 25.012, 0.5, 'avenue', 'US'); }],
    [1958, () => { zone(121.528, 25.045, 121.556, 25.012, Z.R); zone(121.518, 25.078, 121.548, 25.048, Z.C); }],
    [1965, () => { grid(121.553, 25.066, 121.592, 25.022, 0.5, 'boulevard', 'US'); zone(121.553, 25.066, 121.592, 25.022, Z.R); grid(121.512, 25.108, 121.538, 25.084, 0.5, 'avenue', 'US'); zone(121.512, 25.108, 121.538, 25.084, Z.R); }],
    [1970, () => { zone(121.528, 25.056, 121.565, 25.049, Z.O, 'all'); road([[121.537, 25.082], [121.537, 25.010]], 'expressway', 'US'); road([[121.470, 25.105], [121.520, 25.088], [121.560, 25.081], [121.600, 25.068], [121.640, 25.058]], 'expressway', 'US'); }],
    [1975, () => { grid(121.540, 25.010, 121.585, 24.985, 0.6, 'avenue', 'US'); zone(121.540, 25.010, 121.585, 24.985, Z.R); road([[121.500, 25.045], [121.540, 25.045], [121.610, 25.050]], 'expressway', 'US'); }],
    [1980, () => { grid(121.565, 25.088, 121.602, 25.066, 0.5, 'boulevard', 'US'); zone(121.565, 25.088, 121.602, 25.066, Z.R); zone(121.556, 25.042, 121.574, 25.028, Z.O, 'all'); grid(121.490, 25.140, 121.520, 25.115, 0.6, 'avenue', 'US'); zone(121.490, 25.140, 121.520, 25.115, Z.R); }],
    [1985, () => { road([[121.520, 25.090], [121.520, 25.010]], 'expressway', 'US'); road([[121.565, 25.090], [121.565, 24.990]], 'expressway', 'US'); BUSES_1950s.slice(0, 2).forEach(b => busRoute(b, 20)); }],
  ],
};

export async function runScenario(name, to = 2030, every = 10) { return run(STRATEGIES[name], to, every); }
