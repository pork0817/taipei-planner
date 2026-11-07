// Purely decorative moving vehicles. Kept deliberately light: a fixed pool of
// dots that wander the road graph weighted by assigned traffic, plus a few
// trains / buses per line moving back and forth along their alignment.
import { G } from './state.js';
import { routePolyline, lineVehicles } from './transit.js';

const CAR_COLORS = ['#ffffff', '#e53935', '#cfd8dc', '#263238', '#1e88e5', '#9e9e9e'];

function polyLen(pts) {
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  return cum;
}
function polyAt(pts, cum, d) {
  const L = cum[cum.length - 1];
  d = Math.max(0, Math.min(L, d));
  let i = 1;
  while (i < cum.length - 1 && cum[i] < d) i++;
  const seg = cum[i] - cum[i - 1] || 1, f = (d - cum[i - 1]) / seg;
  const a = pts[i - 1], b = pts[i];
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, b[0] - a[0], b[1] - a[1]];
}

export class Vehicles {
  constructor() { this.cars = []; this.movers = []; this.weights = null; this.enabled = true; }

  rebuild() {
    const net = G.net;
    const edges = Object.values(net.edges).filter(e => net.roads[e.road].type !== 'pedestrian');
    this.edges = edges;
    const cum = new Float64Array(edges.length);
    let s = 0;
    edges.forEach((e, i) => { s += (e.vol[0] + e.vol[1] + 20) * e.len; cum[i] = s; });
    this.cum = cum; this.total = s;
    const st = G.stats;
    const vehShare = st ? st.modal.car + st.modal.scooter : 0.1;
    this.target = Math.round(Math.min(260, Math.max(25, 40 + 600 * vehShare * Math.min(1, (st?.vkm || 0) / 60000 + 0.2))));
    this.scooterShare = st ? st.modal.scooter / Math.max(0.01, st.modal.car + st.modal.scooter) : 0.5;
    this.cars = this.cars.filter(c => net.edges[c.e.id] === c.e);
    while (this.cars.length > this.target) this.cars.pop();
    // transit movers
    const movers = [];
    for (const l of Object.values(G.transit.lines)) {
      const pts = l.stations.map(id => G.transit.stations[id]).filter(Boolean).map(s => [s.x, s.y]);
      if (pts.length < 2) continue;
      const cum2 = polyLen(pts), L = cum2[cum2.length - 1];
      const n = Math.min(8, Math.max(1, Math.round(lineVehicles(G, l) / 2)));
      for (let q = 0; q < n; q++) movers.push({ pts, cum: cum2, L, u: (q / n) * 2 * L, type: l.type, color: l.color, speed: l.type === 'metro' ? 0.55 : l.type === 'rail' ? 0.7 : 0.35 });
    }
    for (const r of Object.values(G.transit.routes)) {
      if (r.broken) continue;
      const pts = routePolyline(G, r);
      if (pts.length < 2) continue;
      const cum2 = polyLen(pts), L = cum2[cum2.length - 1];
      const n = Math.min(4, Math.max(1, Math.round(lineVehicles(G, r) / 3)));
      for (let q = 0; q < n; q++) movers.push({ pts, cum: cum2, L, u: (q / n) * 2 * L, type: 'bus', color: r.color, speed: 0.25 });
    }
    this.movers = movers;
  }

  spawn() {
    if (!this.edges || !this.edges.length) return null;
    const r = Math.random() * this.total;
    let lo = 0, hi = this.cum.length - 1;
    while (lo < hi) { const m = (lo + hi) >> 1; if (this.cum[m] < r) lo = m + 1; else hi = m; }
    const e = this.edges[lo];
    const oneWay = G.net.roads[e.road].cfg.oneWay;
    const dir = oneWay ? 0 : (Math.random() < 0.5 ? 0 : 1);
    const scooter = Math.random() < this.scooterShare;
    return { e, dir, p: Math.random(), scooter, col: scooter ? '#ff7043' : CAR_COLORS[(Math.random() * CAR_COLORS.length) | 0], life: 20 + Math.random() * 40 };
  }

  next(c) {
    const net = G.net;
    const nodeId = c.dir === 0 ? c.e.b : c.e.a;
    const node = net.nodes[nodeId];
    if (!node) return false;
    const opts = [];
    for (const id of node.e) {
      const e = net.edges[id];
      if (!e || e === c.e) continue;
      const r = net.roads[e.road];
      if (r.type === 'pedestrian') continue;
      if (e.a === nodeId) opts.push([e, 0]);
      else if (!r.cfg.oneWay) opts.push([e, 1]);
    }
    if (!opts.length) return false;
    let s = 0;
    for (const o of opts) s += o[0].vol[o[1]] + 10;
    let r = Math.random() * s;
    for (const o of opts) { r -= o[0].vol[o[1]] + 10; if (r <= 0) { c.e = o[0]; c.dir = o[1]; c.p = 0; return true; } }
    c.e = opts[0][0]; c.dir = opts[0][1]; c.p = 0;
    return true;
  }

  draw(ctx, R, dtMs) {
    if (!this.enabled) return;
    const dt = Math.min(0.1, dtMs / 1000);
    const s = R.cam.scale;
    const net = G.net;
    const running = G.speed > 0 ? 1 : 0.15;
    while (this.cars.length < this.target) { const c = this.spawn(); if (!c) break; this.cars.push(c); }
    const [vx0, vy0] = R.s2w(-10, -10), [vx1, vy1] = R.s2w(R.W + 10, R.H + 10);
    const size = Math.max(1.6, Math.min(5.5, s * 0.0065));
    const oriented = s > 180;
    for (let i = 0; i < this.cars.length; i++) {
      const c = this.cars[i];
      if (!net.edges[c.e.id]) { this.cars[i] = this.spawn() || c; continue; }
      const e = c.e;
      const vc = e.vc ? e.vc[c.dir] : 0;
      const slow = e.t0 && e.t[c.dir] < Infinity ? Math.max(0.12, Math.min(1, e.t0[c.dir] / e.t[c.dir])) : 1;
      const v = 0.18 * slow * running * (c.scooter ? 1.15 : 1);
      c.p += v * dt / Math.max(0.02, e.len);
      c.life -= dt * running;
      if (c.p >= 1) {
        if (c.life <= 0 || !this.next(c)) { this.cars[i] = this.spawn() || c; continue; }
      }
      const A = net.nodes[c.dir === 0 ? e.a : e.b], B = net.nodes[c.dir === 0 ? e.b : e.a];
      const x = A.x + (B.x - A.x) * c.p, y = A.y + (B.y - A.y) * c.p;
      if (x < vx0 || x > vx1 || y < vy0 || y > vy1) continue;
      // keep right: offset to the right-hand side of travel direction
      const dx = B.x - A.x, dy = B.y - A.y, L = Math.hypot(dx, dy) || 1;
      const cfg = net.roads[e.road].cfg;
      const off = cfg.oneWay ? 0 : Math.min(14, Math.max(1, s * 0.0045 * Math.min(cfg.lanes, 3)));
      const [sx, sy] = R.w2s(x, y);
      const ux = dx / L, uy = dy / L;
      const ox = -uy * off, oy = ux * off;
      if (oriented) {
        const len = c.scooter ? size * 0.9 : size * 1.9, wid = c.scooter ? size * 0.5 : size;
        ctx.save();
        ctx.translate(sx + ox, sy + oy); ctx.rotate(Math.atan2(uy, ux));
        ctx.fillStyle = 'rgba(20,20,20,0.85)'; ctx.fillRect(-len / 2 - 0.7, -wid / 2 - 0.7, len + 1.4, wid + 1.4);
        ctx.fillStyle = c.col; ctx.fillRect(-len / 2, -wid / 2, len, wid);
        ctx.restore();
      } else {
        ctx.fillStyle = 'rgba(20,20,20,0.8)';
        ctx.fillRect(sx + ox - size / 2 - 0.6, sy + oy - size / 2 - 0.6, size + 1.2, size + 1.2);
        ctx.fillStyle = c.col;
        ctx.fillRect(sx + ox - size / 2, sy + oy - size / 2, size, size);
      }
    }
    // transit movers
    for (const m of this.movers) {
      m.u = (m.u + m.speed * dt * running) % (2 * m.L);
      const d = m.u <= m.L ? m.u : 2 * m.L - m.u;
      const [x, y, dx, dy] = polyAt(m.pts, m.cum, d);
      if (x < vx0 || x > vx1 || y < vy0 || y > vy1) continue;
      const [sx, sy] = R.w2s(x, y);
      const ang = Math.atan2(dy, dx);
      const len = m.type === 'bus' ? Math.max(4, s * 0.012) : Math.max(7, s * (m.type === 'lrt' ? 0.03 : 0.08));
      const wid = m.type === 'bus' ? 3 : m.type === 'lrt' ? 3.5 : 4.5;
      ctx.save();
      ctx.translate(sx, sy); ctx.rotate(ang);
      ctx.fillStyle = '#111';
      ctx.fillRect(-len / 2 - 0.8, -wid / 2 - 0.8, len + 1.6, wid + 1.6);
      ctx.fillStyle = m.type === 'bus' ? m.color : '#f5f5f5';
      ctx.fillRect(-len / 2, -wid / 2, len, wid);
      if (m.type !== 'bus') { ctx.fillStyle = m.color; ctx.fillRect(-len / 2, -wid / 2 + wid * 0.35, len, wid * 0.3); }
      ctx.restore();
    }
  }
}
