// Smooth district borders: the grid-edge boundary segments are linked into
// chains and rounded with Chaikin's algorithm, then draped on the terrain.
import * as THREE from '../../vendor/three.module.min.js';
import { CELL } from '../data/taipei.js';

/** Link unit grid edges into polylines (break at junction points). */
export function chains(segs) {
  const key = (x, y) => Math.round(x / CELL * 2) + ',' + Math.round(y / CELL * 2);
  const adj = new Map();
  segs.forEach((s, i) => {
    for (const k of [key(s[0], s[1]), key(s[2], s[3])]) { if (!adj.has(k)) adj.set(k, []); adj.get(k).push(i); }
  });
  const used = new Uint8Array(segs.length);
  const out = [];
  const other = (i, k) => (key(segs[i][0], segs[i][1]) === k ? [segs[i][2], segs[i][3]] : [segs[i][0], segs[i][1]]);
  const walk = (start, i) => {
    const pts = [start];
    let k = key(start[0], start[1]);
    while (i !== undefined && !used[i]) {
      used[i] = 1;
      const p = other(i, k);
      pts.push(p);
      k = key(p[0], p[1]);
      const nb = adj.get(k).filter(j => !used[j]);
      i = adj.get(k).length === 2 ? nb[0] : undefined;   // stop at junctions
    }
    return pts;
  };
  // start from junction / end points first, then remaining loops
  for (const [k, list] of adj) {
    if (list.length === 2) continue;
    for (const i of list) {
      if (used[i]) continue;
      const s = segs[i], st = key(s[0], s[1]) === k ? [s[0], s[1]] : [s[2], s[3]];
      out.push(walk(st, i));
    }
  }
  for (let i = 0; i < segs.length; i++) if (!used[i]) out.push(walk([segs[i][0], segs[i][1]], i));
  return out;
}

export function chaikin(p, iters = 4, closed = false) {
  for (let k = 0; k < iters; k++) {
    const q = closed ? [] : [p[0]];
    const n = p.length;
    for (let i = 0; i < (closed ? n : n - 1); i++) {
      const a = p[i], b = p[(i + 1) % n];
      q.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25], [a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]);
    }
    if (!closed) q.push(p[n - 1]);
    p = q;
  }
  return p;
}

/** Ribbon mesh following smoothed chains, draped on terrain. */
export function borderMesh(lines, heightAt, widthKm, color, opacity, lift = 0.004) {
  const pos = [], idx = [];
  for (const P of lines) {
    if (P.length < 2) continue;
    const base = pos.length / 3;
    for (let i = 0; i < P.length; i++) {
      const [x, z] = P[i];
      const [px, pz] = P[Math.max(0, i - 1)], [nx, nz] = P[Math.min(P.length - 1, i + 1)];
      let dx = nx - px, dz = nz - pz; const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
      const h = Math.max(heightAt(x, z), 0) + lift;
      pos.push(x - dz * widthKm / 2, h, z + dx * widthKm / 2, x + dz * widthKm / 2, h, z - dx * widthKm / 2);
      if (i < P.length - 1) { const v = base + i * 2; idx.push(v, v + 1, v + 2, v + 1, v + 3, v + 2); }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide }));
  m.renderOrder = 6;
  m.frustumCulled = false;
  return m;
}

/** Smoothed polylines for all district borders, or only those of one district. */
export function districtLines(G, only = -1) {
  const g = G.grid, segs = [];
  const W = g.w, H = g.h;
  const d = (i, j) => (i < 0 || j < 0 || i >= W || j >= H) ? -1 : g.district[j * W + i];
  for (let j = 0; j < H; j++) for (let i = 0; i <= W; i++) {
    const a = d(i - 1, j), b = d(i, j);
    if (a === b || (a < 0 && b < 0)) continue;
    if (only >= 0 && a !== only && b !== only) continue;
    segs.push([i * CELL, j * CELL, i * CELL, (j + 1) * CELL, a < 0 || b < 0]);
  }
  for (let i = 0; i < W; i++) for (let j = 0; j <= H; j++) {
    const a = d(i, j - 1), b = d(i, j);
    if (a === b || (a < 0 && b < 0)) continue;
    if (only >= 0 && a !== only && b !== only) continue;
    segs.push([i * CELL, j * CELL, (i + 1) * CELL, j * CELL, a < 0 || b < 0]);
  }
  const inner = chains(segs.filter(s => !s[4])).map(p => chaikin(p, 4));
  const outer = chains(segs.filter(s => s[4])).map(p => chaikin(p, 4));
  return { inner, outer };
}
