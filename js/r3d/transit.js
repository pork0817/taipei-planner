// 3D transit: underground metro shown as a faint coloured trace (bright in the
// transit view), elevated metro on a viaduct, light rail and rail tracks on the
// ground, station buildings and bus shelters.
import * as THREE from '../../vendor/three.module.min.js';
import { routePolyline, stopPos } from '../transit.js';
import { widen } from './roads.js';

export const VIADUCT_H = 0.012;

function ribbon(pts, hw, yFn, out) {
  const base = out.pos.length / 3;
  for (let q = 0; q < pts.length; q++) {
    const [x, y] = pts[q];
    const [px, py] = pts[Math.max(0, q - 1)], [nx, ny] = pts[Math.min(pts.length - 1, q + 1)];
    let dx = nx - px, dy = ny - py; const L = Math.hypot(dx, dy) || 1; dx /= L; dy /= L;
    const h = yFn(x, y, q);
    out.pos.push(x, h, y, x, h, y);
    (out.side ||= []).push(-dy * hw, 0, dx * hw, dy * hw, 0, -dx * hw);
    out.nrm.push(0, 1, 0, 0, 1, 0);
    if (q < pts.length - 1) { const v = base + q * 2; out.idx.push(v, v + 2, v + 1, v + 1, v + 2, v + 3); }
  }
}
/** Resample a polyline every `step` km. */
export function densify(pts, step = 0.03) {
  const out = [];
  for (let q = 0; q < pts.length - 1; q++) {
    const [ax, ay] = pts[q], [bx, by] = pts[q + 1];
    const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / step));
    for (let s = 0; s < n; s++) out.push([ax + (bx - ax) * s / n, ay + (by - ay) * s / n]);
  }
  if (pts.length) out.push(pts[pts.length - 1]);
  return out;
}

export class Transit3D {
  constructor(G, terrain, shared) {
    this.G = G; this.terrain = terrain; this.shared = shared;
    this.group = new THREE.Group();
    this.objs = [];
    this.lines = new Map();   // line id -> { pts (dense), heights }
    this.sig = '';
    this.highlight = false;
  }
  signature() {
    const T = this.G.transit;
    return Object.values(T.lines).map(l => l.id + ':' + l.stations.join(',') + l.color + (l.elevated ? 'e' : '')).join(';') + '|' +
      Object.values(T.routes).map(r => r.id + ':' + r.path.length + r.color).join(';') + '|' + Object.keys(T.stations).length + '|' + Object.keys(T.stops).length;
  }
  clear() { for (const o of this.objs) { this.group.remove(o); o.geometry?.dispose(); o.material?.dispose?.(); } this.objs = []; }
  add(o) { this.group.add(o); this.objs.push(o); return o; }

  rebuild() {
    this.clear();
    this.lines.clear();
    const G = this.G, T = G.transit, Hgt = (x, y) => Math.max(this.terrain.heightAt(x, y), 0);
    const pillars = [];
    for (const l of Object.values(T.lines)) {
      const st = l.stations.map(id => T.stations[id]).filter(Boolean);
      if (st.length < 2) continue;
      const pts = densify(st.map(s => [s.x, s.y]));
      const elev = l.type === 'metro' && l.elevated;
      const under = l.type === 'metro' && !l.elevated;
      const heights = pts.map(([x, y]) => Hgt(x, y) + (elev ? VIADUCT_H : under ? -0.02 : 0.0009));
      this.lines.set(l.id, { pts, heights, type: l.type, color: l.color, under });
      const out = { pos: [], nrm: [], idx: [] };
      if (under) {
        ribbon(pts, 0.0035, (x, y) => Hgt(x, y) + 0.0016, out);
        const m = this.add(this.mesh(out, new THREE.MeshBasicMaterial({ color: l.color, transparent: true, opacity: 0.35, depthWrite: false })));
        m.userData.under = true; m.renderOrder = 3;
        continue;
      }
      // track bed + rails
      ribbon(pts, elev ? 0.0045 : 0.0032, (x, y, q) => heights[q], out);
      this.add(this.mesh(out, new THREE.MeshLambertMaterial({ color: elev ? 0xb9b5ab : l.type === 'rail' ? 0x6f6a60 : 0x8d8a83, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -3 }))).receiveShadow = true;
      const stripe = { pos: [], nrm: [], idx: [] };
      ribbon(pts, 0.0012, (x, y, q) => heights[q] + 0.0002, stripe);
      this.add(this.mesh(stripe, new THREE.MeshLambertMaterial({ color: l.type === 'rail' ? 0x3b3b3b : l.color, polygonOffset: true, polygonOffsetFactor: -4 })));
      if (elev) pts.forEach(([x, y], q) => { if (q % 2 === 0) pillars.push([x, y, Hgt(x, y), heights[q]]); });
    }
    if (pillars.length) {
      const geo = new THREE.BoxGeometry(1, 1, 1); geo.translate(0, 0.5, 0);
      const inst = new THREE.InstancedMesh(geo, new THREE.MeshLambertMaterial({ color: 0xbab6ad }), pillars.length);
      const m4 = new THREE.Matrix4();
      pillars.forEach(([x, y, g, top], q) => { m4.makeScale(0.0032, top - g - 0.0005, 0.0032); m4.setPosition(x, g, y); inst.setMatrixAt(q, m4); });
      inst.castShadow = true;
      this.add(inst);
    }
    // stations
    const box = new THREE.BoxGeometry(1, 1, 1); box.translate(0, 0.5, 0);
    const stCount = Object.keys(T.stations).length;
    if (stCount) {
      const body = new THREE.InstancedMesh(box, new THREE.MeshLambertMaterial(), stCount * 2);
      body.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(stCount * 6), 3);
      const m4 = new THREE.Matrix4(), c = new THREE.Color();
      let q = 0;
      for (const s of Object.values(T.stations)) {
        const line = Object.values(T.lines).find(l => l.stations.includes(s.id));
        const col = line ? line.color : '#9e9e9e';
        const h = Hgt(s.x, s.y);
        if (s.type === 'metro' && !(line && line.elevated)) {
          m4.makeScale(0.012, 0.004, 0.008); m4.setPosition(s.x, h, s.y); body.setMatrixAt(q, m4); body.setColorAt(q++, c.set('#d9dde2'));
          m4.makeScale(0.014, 0.0008, 0.01); m4.setPosition(s.x, h + 0.004, s.y); body.setMatrixAt(q, m4); body.setColorAt(q++, c.set(col));
        } else {
          const top = s.type === 'metro' ? h + VIADUCT_H : h;
          const w = s.type === 'rail' ? 0.05 : s.type === 'lrt' ? 0.022 : 0.04;
          m4.makeScale(w, s.type === 'metro' ? VIADUCT_H + 0.006 : 0.005, 0.012); m4.setPosition(s.x, h, s.y); body.setMatrixAt(q, m4); body.setColorAt(q++, c.set(s.type === 'rail' ? '#c9b79a' : '#dfe3e6'));
          m4.makeScale(w * 1.05, 0.0009, 0.014); m4.setPosition(s.x, top + (s.type === 'metro' ? 0.006 : 0.005), s.y); body.setMatrixAt(q, m4); body.setColorAt(q++, c.set(col));
        }
      }
      body.count = q;
      body.castShadow = true;
      this.add(body);
    }
    // bus stops (shelters)
    const used = new Set();
    for (const r of Object.values(T.routes)) r.stops.forEach(id => used.add(id));
    const stops = Object.values(T.stops).filter(s => used.has(s.id));
    if (stops.length) {
      const sh = new THREE.InstancedMesh(box, new THREE.MeshLambertMaterial({ color: 0x1e88e5 }), stops.length);
      const m4 = new THREE.Matrix4();
      stops.forEach((s, q) => { const p = stopPos(G, s); if (!p) return; m4.makeScale(0.004, 0.0028, 0.0016); m4.setPosition(p.x + 0.006, Hgt(p.x, p.y), p.y + 0.006); sh.setMatrixAt(q, m4); });
      this.add(sh);
    }
    this.sig = this.signature();
    this.setHighlight(this.highlight);
  }

  mesh(out, mat) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(out.pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(out.nrm, 3));
    if (out.side) { geo.setAttribute('aSide', new THREE.Float32BufferAttribute(out.side, 3)); widen(mat, this.shared); }
    geo.setIndex(out.idx);
    const m = new THREE.Mesh(geo, mat);
    m.frustumCulled = false;
    return m;
  }

  /** Show underground lines strongly (transit tools / coverage view) or faintly. */
  setHighlight(on) {
    this.highlight = on;
    for (const o of this.objs) if (o.userData.under) { o.material.opacity = on ? 0.9 : 0.13; o.material.depthTest = !on; }
  }
}
