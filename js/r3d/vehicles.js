// Decorative 3D traffic: instanced cars, scooters, buses and trains. The pool is
// small and most vehicles are spawned near the camera, so it stays cheap.
import * as THREE from '../../vendor/three.module.min.js';
import { G } from '../state.js';
import { Vehicles } from '../vehicles.js';
import { routePolyline, lineVehicles } from '../transit.js';
import { densify } from './transit.js';

const MAX_CARS = 700;

function cum(pts) { const c = [0]; for (let i = 1; i < pts.length; i++) c.push(c[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1])); return c; }
function at(pts, c, d) {
  const L = c[c.length - 1]; d = Math.max(0, Math.min(L, d));
  let lo = 1, hi = c.length - 1;
  while (lo < hi) { const m = (lo + hi) >> 1; if (c[m] < d) lo = m + 1; else hi = m; }
  const i = lo, seg = c[i] - c[i - 1] || 1, f = (d - c[i - 1]) / seg;
  return [i - 1, f];
}

export class Vehicles3D extends Vehicles {
  constructor(scene) {
    super();
    this.scene = scene;
    // vehicles are unit-sized along x (length); parts carry baked shades that
    // multiply the per-instance colour (dark glass, light roofs, wheels)
    const part = (w, h, d, x, y, z, shade) => {
      const g = new THREE.BoxGeometry(w, h, d); g.translate(x, y, z);
      const n = g.attributes.position.count, c = new Float32Array(n * 3).fill(shade);
      g.setAttribute('color', new THREE.BufferAttribute(c, 3));
      return g;
    };
    const merge = parts => {
      const pos = [], nrm = [], col = [], idx = [];
      let off = 0;
      for (const g of parts) {
        pos.push(...g.attributes.position.array); nrm.push(...g.attributes.normal.array); col.push(...g.attributes.color.array);
        for (const i of g.index.array) idx.push(i + off);
        off += g.attributes.position.count;
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
      g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
      g.setIndex(idx);
      return g;
    };
    const carGeo = merge([
      part(1, 0.42, 1, 0, 0.27, 0, 1),               // body
      part(0.55, 0.36, 0.88, -0.05, 0.62, 0, 0.28),  // cabin (tinted glass)
      part(0.5, 0.04, 0.8, -0.05, 0.81, 0, 1.15),    // roof
      part(0.22, 0.2, 1.04, 0.3, 0.1, 0, 0.12), part(0.22, 0.2, 1.04, -0.32, 0.1, 0, 0.12),  // wheels
    ]);
    const busGeo = merge([
      part(1, 0.8, 1, 0, 0.5, 0, 1),
      part(1.01, 0.28, 1.02, 0, 0.62, 0, 0.25),      // window band
      part(0.95, 0.05, 0.9, 0, 0.92, 0, 1.2),        // roof
      part(0.12, 0.16, 1.04, 0.32, 0.08, 0, 0.12), part(0.12, 0.16, 1.04, -0.32, 0.08, 0, 0.12),
    ]);
    const trainGeo = merge([
      part(1, 0.85, 1, 0, 0.45, 0, 1),
      part(0.96, 0.3, 1.02, 0, 0.55, 0, 0.22),       // windows
      part(0.06, 0.82, 1.03, 0.48, 0.45, 0, 0.5), part(0.06, 0.82, 1.03, -0.48, 0.45, 0, 0.5),  // car ends
    ]);
    this.geos = { car: carGeo, bus: busGeo, train: trainGeo };
    const mk = (n, color, geo = carGeo) => {
      const m = new THREE.InstancedMesh(geo, new THREE.MeshLambertMaterial({ color, vertexColors: true }), n);
      m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3);
      m.count = 0; m.frustumCulled = false; m.castShadow = false;
      scene.add(m);
      return m;
    };
    this.carMesh = mk(MAX_CARS, 0xffffff);
    this.busMesh = mk(400, 0xffffff, busGeo);
    this.trainMesh = mk(1200, 0xffffff, trainGeo);
    this._m = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._v = new THREE.Vector3(); this._s = new THREE.Vector3(); this._c = new THREE.Color();
    this.near = []; this.nearT = 0;
  }

  rebuild() {
    super.rebuild();
    this.target = Math.round(Math.min(MAX_CARS, Math.max(60, 120 + 900 * ((G.stats?.modal.car || 0) + (G.stats?.modal.scooter || 0)))));
    // trains follow the 3D alignment built by the transit renderer
    this.trains = [];
    for (const l of Object.values(G.transit.lines)) {
      const info = this.r3?.transit.lines.get(l.id);
      if (!info || info.under) continue;
      const c = cum(info.pts), L = c[c.length - 1];
      const n = Math.min(6, Math.max(1, Math.round(lineVehicles(G, l) / 2)));
      for (let q = 0; q < n; q++) this.trains.push({ info, c, L, u: q / n * 2 * L, cars: l.type === 'lrt' ? 3 : l.type === 'rail' ? 8 : 6, carLen: l.type === 'lrt' ? 0.009 : 0.02, color: l.color, speed: l.type === 'rail' ? 0.03 : 0.024 });
    }
    this.buses = [];
    for (const r of Object.values(G.transit.routes)) {
      if (r.broken) continue;
      const pts = densify(routePolyline(G, r), 0.02);
      if (pts.length < 2) continue;
      const c = cum(pts), L = c[c.length - 1];
      const n = Math.min(6, Math.max(1, Math.round(lineVehicles(G, r) / 2)));
      for (let q = 0; q < n; q++) this.buses.push({ pts, c, L, u: q / n * 2 * L, color: r.color });
    }
  }

  /** Mostly spawn near the camera so the visible streets look busy. */
  spawn() {
    if (this.near.length && Math.random() < 0.8) {
      const e = this.near[(Math.random() * this.near.length) | 0];
      if (G.net.edges[e.id] === e) {
        const scooter = Math.random() < this.scooterShare;
        return { e, dir: G.net.roads[e.road].cfg.oneWay ? 0 : (Math.random() < 0.5 ? 0 : 1), p: Math.random(), scooter, col: scooter ? '#ff7043' : ['#ffffff', '#e53935', '#cfd8dc', '#263238', '#1e88e5', '#9e9e9e', '#f2c94c'][(Math.random() * 7) | 0], life: 15 + Math.random() * 30 };
      }
    }
    return super.spawn();
  }

  updateNear(cx, cy, radius) {
    const net = G.net;
    const out = [];
    for (const e of Object.values(net.edges)) {
      const r = net.roads[e.road];
      if (r.type === 'pedestrian') continue;
      const A = net.nodes[e.a];
      if (Math.abs(A.x - cx) < radius && Math.abs(A.y - cy) < radius) {
        const w = 1 + Math.min(6, (e.vol[0] + e.vol[1]) / 400);
        for (let q = 0; q < w; q++) out.push(e);
      }
    }
    this.near = out;
  }

  update3d(dtMs, R) {
    if (!this.enabled) return;
    const dt = Math.min(0.1, dtMs / 1000);
    const net = G.net, roads = R.roads;
    const running = G.speed > 0 ? 1 + G.speed * 0.5 : 0.35;
    this.nearT -= dt;
    if (this.nearT <= 0) { this.nearT = 1; this.updateNear(R.cam.x, R.cam.y, Math.max(0.6, R.dist * 1.2)); }
    while (this.cars.length < this.target) { const c = this.spawn(); if (!c) break; this.cars.push(c); }
    const M = this._m, Q = this._q, V = this._v, Sc = this._s, C = this._c;
    const up = new THREE.Vector3(0, 1, 0);
    let n = 0;
    for (let i = 0; i < this.cars.length; i++) {
      let c = this.cars[i];
      if (!net.edges[c.e.id]) { c = this.cars[i] = this.spawn() || c; if (!net.edges[c.e.id]) continue; }
      const e = c.e, r = net.roads[e.road];
      const slow = e.t0 && e.t[c.dir] < Infinity ? Math.max(0.15, Math.min(1, e.t0[c.dir] / e.t[c.dir])) : 1;
      const v = (r.cfg.speed / 3600) * 3 * slow * running * (c.scooter ? 1.05 : 1);   // 3x real speed
      c.p += v * dt / Math.max(0.005, e.len);
      c.life -= dt;
      if (c.p >= 1) { if (c.life <= 0 || !this.next(c)) { this.cars[i] = this.spawn() || c; continue; } }
      const A = net.nodes[c.dir === 0 ? e.a : e.b], B = net.nodes[c.dir === 0 ? e.b : e.a];
      const x = A.x + (B.x - A.x) * c.p, y = A.y + (B.y - A.y) * c.p;
      const dx = B.x - A.x, dy = B.y - A.y, L = Math.hypot(dx, dy) || 1;
      const lanes = r.cfg.oneWay ? 0 : Math.min(r.cfg.lanes, 3);
      const off = r.cfg.oneWay ? 0 : (0.0018 + ((i % Math.max(1, lanes)) * 0.0033));
      const h = roads.heightOn(e.id, c.dir === 0 ? c.p : 1 - c.p);
      // right-hand traffic: offset to the right of the travel direction
      V.set(x - dy / L * off, h, y + dx / L * off);
      Q.setFromAxisAngle(up, Math.atan2(-dy, dx));
      if (c.scooter) Sc.set(0.0019, 0.0016, 0.0007); else Sc.set(0.0044, 0.0015, 0.0018);
      M.compose(V, Q, Sc);
      this.carMesh.setMatrixAt(n, M);
      this.carMesh.setColorAt(n, C.set(c.col));
      n++;
    }
    this.carMesh.count = n;
    this.carMesh.instanceMatrix.needsUpdate = true;
    if (this.carMesh.instanceColor) this.carMesh.instanceColor.needsUpdate = true;

    // buses
    let b = 0;
    for (const bus of this.buses || []) {
      bus.u = (bus.u + 0.006 * 3 * running * dt) % (2 * bus.L);
      const d = bus.u <= bus.L ? bus.u : 2 * bus.L - bus.u;
      const [i, f] = at(bus.pts, bus.c, d);
      const a = bus.pts[i], p2 = bus.pts[i + 1] || a;
      const x = a[0] + (p2[0] - a[0]) * f, y = a[1] + (p2[1] - a[1]) * f;
      let dx = p2[0] - a[0], dy = p2[1] - a[1]; if (bus.u > bus.L) { dx = -dx; dy = -dy; }
      const L = Math.hypot(dx, dy) || 1;
      V.set(x - dy / L * 0.0022, Math.max(R.terrain.heightAt(x, y), 0) + 0.0008, y + dx / L * 0.0022);
      Q.setFromAxisAngle(up, Math.atan2(-dy, dx));
      Sc.set(0.012, 0.0032, 0.0025);
      M.compose(V, Q, Sc);
      this.busMesh.setMatrixAt(b, M); this.busMesh.setColorAt(b, C.set(bus.color));
      if (++b >= 400) break;
    }
    this.busMesh.count = b;
    this.busMesh.instanceMatrix.needsUpdate = true;
    if (this.busMesh.instanceColor) this.busMesh.instanceColor.needsUpdate = true;

    // trains: several cars following the alignment
    let t = 0;
    for (const tr of this.trains || []) {
      tr.u = (tr.u + tr.speed * running * dt) % (2 * tr.L);
      const fwd = tr.u <= tr.L, d0 = fwd ? tr.u : 2 * tr.L - tr.u;
      for (let k = 0; k < tr.cars; k++) {
        const d = fwd ? d0 - k * tr.carLen * 1.05 : d0 + k * tr.carLen * 1.05;
        if (d < 0 || d > tr.L) continue;
        const [i, f] = at(tr.info.pts, tr.c, d);
        const a = tr.info.pts[i], p2 = tr.info.pts[i + 1] || a;
        const x = a[0] + (p2[0] - a[0]) * f, y = a[1] + (p2[1] - a[1]) * f;
        const h = tr.info.heights[i] + ((tr.info.heights[i + 1] ?? tr.info.heights[i]) - tr.info.heights[i]) * f;
        V.set(x, h + 0.0002, y);
        Q.setFromAxisAngle(up, Math.atan2(-(p2[1] - a[1]), p2[0] - a[0]));
        Sc.set(tr.carLen, 0.0036, 0.003);
        M.compose(V, Q, Sc);
        this.trainMesh.setMatrixAt(t, M); this.trainMesh.setColorAt(t, C.set(k === 0 ? tr.color : '#eceff1'));
        if (++t >= 1200) break;
      }
    }
    this.trainMesh.count = t;
    this.trainMesh.instanceMatrix.needsUpdate = true;
    if (this.trainMesh.instanceColor) this.trainMesh.instanceColor.needsUpdate = true;
  }

  // the 2D renderer used draw(); the 3D renderer calls update3d instead
  draw() {}
}
