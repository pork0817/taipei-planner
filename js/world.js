import { GW, GH, CELL, ll, llp, DISTRICTS, OUTLINE, RIVERS, MOUNTAINS, SONGSHAN_AIRPORT } from './data/taipei.js';

export const T_OUT = 0, T_LAND = 1, T_WATER = 2, T_MTN = 3;
export const Z = { NONE: 0, R: 1, C: 2, M: 3, O: 4, I: 5 };
export const ZONES = [
  null,
  { key: 'R', label: 'Residential', color: '#5fae62', ground: '#d3ead0' },
  { key: 'C', label: 'Commercial', color: '#3d86d6', ground: '#d0e0f4' },
  { key: 'M', label: 'Mixed-use', color: '#9c6ad6', ground: '#e5d8f5' },
  { key: 'O', label: 'Office', color: '#2a4f9e', ground: '#cdd5ec' },
  { key: 'I', label: 'Industrial', color: '#d9a531', ground: '#f3e6c0' },
];
export const S = { NONE: 0, PARK: 1, SCHOOL: 2, HOSPITAL: 3, MARKET: 4, AIRPORT: 5, UNIVERSITY: 6 };
export const SPECIALS = [
  null,
  { key: 'park', label: 'Park', color: '#73b562', cost: 20, upkeep: 1, jobs: 5, size: [1, 1] },
  { key: 'school', label: 'School', color: '#f2c063', cost: 120, upkeep: 6, jobs: 80, size: [1, 1] },
  { key: 'hospital', label: 'Hospital', color: '#ec8080', cost: 600, upkeep: 30, jobs: 500, size: [1, 1] },
  { key: 'market', label: 'Night Market', color: '#ff9f43', cost: 30, upkeep: 1, jobs: 200, size: [1, 1] },
  { key: 'airport', label: 'Airport', color: '#a9adb3', cost: 25000, upkeep: 120, jobs: 150, size: [7, 2] },
  { key: 'university', label: 'University', color: '#a991d4', cost: 900, upkeep: 40, jobs: 600, size: [2, 2] },
];

export function pip(x, y, poly) {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0], yi = poly[i][1], xj = poly[j][0], yj = poly[j][1];
    if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) c = !c;
  }
  return c;
}

export function distSeg(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
  let t = l2 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

export function distPolyline(px, py, pts, closed) {
  let best = Infinity;
  const n = pts.length;
  for (let i = 0; i < n - (closed ? 0 : 1); i++) {
    const a = pts[i], b = pts[(i + 1) % n];
    const d = distSeg(px, py, a[0], a[1], b[0], b[1]);
    if (d < best) best = d;
  }
  return best;
}

export function allocDerived(grid) {
  const N = grid.n;
  grid.pop = new Float32Array(N);
  grid.jobs = new Float32Array(N);
  grid.jC = new Float32Array(N);
  grid.jO = new Float32Array(N);
  grid.jI = new Float32Array(N);
  grid.access = new Uint8Array(N);   // 0 none, 1 street, 2 avenue, 3 major
  grid.noise = new Uint8Array(N);    // bit1 expressway, bit2 airport
  grid.cov = new Uint8Array(N);      // bit1 bus, 2 metro, 4 lrt, 8 rail
  grid.shop = new Uint8Array(N);
  grid.lv = new Float32Array(N).fill(1);
}

export function createWorld(G) {
  const W = GW, H = GH, N = W * H;
  const grid = {
    w: W, h: H, n: N, cell: CELL,
    district: new Int8Array(N).fill(-1), terrain: new Uint8Array(N),
    zone: new Uint8Array(N), level: new Uint8Array(N), special: new Uint8Array(N), seeded: new Uint8Array(N),
    hcap: new Uint8Array(N),    // per-parcel height limit (0 = district law)
    bstyle: new Uint8Array(N),  // building style index + 1 (0 = district default)
  };
  allocDerived(grid);
  G.grid = grid;

  const outline = OUTLINE.map(llp);
  const polys = DISTRICTS.map(d => d.poly.map(llp));
  const mts = MOUNTAINS.map(m => m.map(llp));
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    const k = j * W + i, x = (i + 0.5) * CELL, y = (j + 0.5) * CELL;
    if (!pip(x, y, outline)) { grid.terrain[k] = T_OUT; continue; }
    grid.terrain[k] = T_LAND;
    let d = -1;
    for (let p = 0; p < polys.length; p++) if (pip(x, y, polys[p])) { d = p; break; }
    if (d < 0) {
      let best = Infinity;
      for (let p = 0; p < polys.length; p++) {
        const dd = distPolyline(x, y, polys[p], true);
        if (dd < best) { best = dd; d = p; }
      }
    }
    grid.district[k] = d;
    for (const m of mts) if (pip(x, y, m)) { grid.terrain[k] = T_MTN; break; }
  }
  for (const r of RIVERS) {
    if (!r.cells) continue;
    const pts = r.pts.map(llp);
    const half = Math.max(r.width / 2, 0.12);
    for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
      const x = (i + 0.5) * CELL, y = (j + 0.5) * CELL;
      if (distPolyline(x, y, pts, false) < half) grid.terrain[j * W + i] = T_WATER;
    }
  }
  // Songshan airport footprint
  const [ax0, ay0] = ll(SONGSHAN_AIRPORT.lon0, SONGSHAN_AIRPORT.lat0);
  const [ax1, ay1] = ll(SONGSHAN_AIRPORT.lon1, SONGSHAN_AIRPORT.lat1);
  for (let j = Math.floor(ay0 / CELL); j <= Math.floor(ay1 / CELL); j++)
    for (let i = Math.floor(ax0 / CELL); i <= Math.floor(ax1 / CELL); i++) {
      const k = j * W + i;
      if (grid.terrain[k] === T_LAND || grid.terrain[k] === T_WATER) { grid.terrain[k] = T_LAND; grid.special[k] = S.AIRPORT; }
    }

  G.districts = DISTRICTS.map((d, id) => ({
    id, key: d.key, name: d.name, zh: d.zh, color: d.color,
    law: { allow: [false, true, true, true, true, true], maxLevel: 6, parkingMin: false, organic: true, style: 'taipei' },
    cells: 0, area: 0, lx: 0, ly: 0, stats: {},
  }));
  computeDistrictGeometry(G);
}

export function computeDistrictGeometry(G) {
  const g = G.grid;
  for (const d of G.districts) { d.cells = 0; d.lx = 0; d.ly = 0; }
  for (let k = 0; k < g.n; k++) {
    const d = g.district[k];
    if (d < 0) continue;
    const D = G.districts[d];
    D.cells++;
    D.lx += (k % g.w + 0.5) * CELL;
    D.ly += (Math.floor(k / g.w) + 0.5) * CELL;
  }
  for (const D of G.districts) {
    D.area = D.cells * CELL * CELL;
    D.lx /= Math.max(1, D.cells); D.ly /= Math.max(1, D.cells);
  }
  // boundary segments between districts (for rendering), merged along rows/cols
  const segs = [];
  const W = g.w, H = g.h;
  for (let j = 0; j < H; j++) {
    let run = null;
    for (let i = 0; i <= W; i++) {
      const a = i > 0 ? g.district[j * W + i - 1] : -1, b = i < W ? g.district[j * W + i] : -1;
      // vertical edges at x=i between cells (i-1,j) and (i,j)
      const isB = a !== b && (a >= 0 || b >= 0);
      if (isB) segs.push([i * CELL, j * CELL, i * CELL, (j + 1) * CELL, a < 0 || b < 0]);
    }
  }
  for (let i = 0; i < W; i++) {
    for (let j = 0; j <= H; j++) {
      const a = j > 0 ? g.district[(j - 1) * W + i] : -1, b = j < H ? g.district[j * W + i] : -1;
      if (a !== b && (a >= 0 || b >= 0)) segs.push([i * CELL, j * CELL, (i + 1) * CELL, j * CELL, a < 0 || b < 0]);
    }
  }
  G.boundarySegs = segs;
}

export function cellAt(G, x, y) {
  const g = G.grid;
  const i = Math.floor(x / CELL), j = Math.floor(y / CELL);
  if (i < 0 || j < 0 || i >= g.w || j >= g.h) return -1;
  return j * g.w + i;
}
export const cellX = (G, k) => (k % G.grid.w + 0.5) * CELL;
export const cellY = (G, k) => (Math.floor(k / G.grid.w) + 0.5) * CELL;
export const buildable = (G, k) => k >= 0 && (G.grid.terrain[k] === T_LAND || G.grid.terrain[k] === T_MTN) && G.grid.district[k] >= 0;
