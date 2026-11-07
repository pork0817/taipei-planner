// 3D road meshes: one merged ribbon mesh per road design (texture), following the
// terrain, with bridges over rivers, elevated expressways with pillars and ramps
// down to interchanges, junction patches, and street trees.
import * as THREE from '../../vendor/three.module.min.js';
import { CELL } from '../data/taipei.js';
import { T_WATER } from '../world.js';
import { ROAD_TYPES, STYLES, BIKE_LANES, roadWidthM } from '../roads.js';
import { vcColor } from '../render.js';
import { isWaterAt } from './water.js';

export const ROAD_LIFT = 0.0007;    // road surface above ground (km)
export const EXPWY_H = 0.014;       // elevated expressway deck height
export const CURB = 0.00015;         // raised sidewalk / median height (15 cm)
const PXM = 8;                       // texture pixels per metre
const REPEAT_M = 8;                  // texture repeats every 8 m along the road

const ASPHALT = { NL: '#4b4b4e', JP: '#44474c', UK: '#46484c', US: '#525458' };

// ---------------------------------------------------------------- textures
const texCache = new Map();
function roadKey(type, c) {
  return [type, c.lanes, c.oneWay ? 1 : 0, c.sidewalk, c.arcade ? 1 : 0, c.trees ? 1 : 0, c.bikeLane, c.busLane ? 1 : 0, c.style, c.median || 0].join('|');
}

export function layout(type, c) {
  // cross-section from left to right as [kind, metres]
  const T = ROAD_TYPES[type];
  const side = [];
  if (c.sidewalk > 0) side.push(['walk', c.sidewalk]);
  const bl = BIKE_LANES[c.bikeLane].w;
  const half = (rev) => {
    const parts = [];
    if (c.sidewalk > 0) parts.push(['walk', c.sidewalk]);
    if (bl) parts.push(['bike', bl]);
    for (let q = 0; q < c.lanes; q++) parts.push([c.busLane && q === 0 && c.lanes >= 2 ? 'bus' : 'lane', T.laneW]);
    return rev ? parts : parts.reverse();
  };
  if (type === 'pedestrian') return [['plaza', roadWidthM(type, c)]];
  if (c.oneWay) {
    const p = [];
    if (c.sidewalk > 0) p.push(['walk', c.sidewalk]);
    for (let q = 0; q < c.lanes; q++) p.push([q === c.lanes - 1 && c.busLane && c.lanes >= 2 ? 'bus' : 'lane', T.laneW]);
    if (bl) p.push(['bike', bl]);
    if (c.sidewalk > 0) p.push(['walk', c.sidewalk]);
    return p;
  }
  return [...half(false), (c.median || 0) > 0 ? ['median', c.median] : ['center', 0], ...half(true)];
}

export function roadTexture(type, c) {
  const key = roadKey(type, c);
  if (texCache.has(key)) return texCache.get(key);
  const parts = layout(type, c);
  const widthM = parts.reduce((s, p) => s + p[1], 0) || 4;
  const W = Math.max(16, Math.min(512, Math.round(widthM * PXM))), H = REPEAT_M * PXM;
  const sx = W / widthM;
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const x = cv.getContext('2d');
  const st = STYLES[c.style] || STYLES.JP;
  const asphalt = type === 'expressway' ? '#3d3f43' : ASPHALT[c.style] || '#46484c';
  let pos = 0;
  const laneEdges = [];
  for (let q = 0; q < parts.length; q++) {
    const [kind, m] = parts[q];
    const x0 = pos * sx, w = m * sx;
    if (kind === 'walk') {
      x.fillStyle = c.arcade ? '#c9b99f' : '#cdc8bd'; x.fillRect(x0, 0, w, H);
      x.strokeStyle = 'rgba(0,0,0,0.12)'; x.lineWidth = 1;
      for (let y = 0; y < H; y += 8) { x.beginPath(); x.moveTo(x0, y + 0.5); x.lineTo(x0 + w, y + 0.5); x.stroke(); }
      x.fillStyle = '#9d988e';
      const curbLeft = parts[q + 1] && parts[q + 1][0] !== 'walk';
      x.fillRect(curbLeft ? x0 + w - 2 : x0, 0, 2, H);
      if (c.trees) { x.fillStyle = '#7a6a55'; for (let y = 4; y < H; y += 48) x.fillRect(x0 + w * 0.35, y, w * 0.3, 10); }
    } else if (kind === 'bike') {
      x.fillStyle = st.bikeColor; x.fillRect(x0, 0, w, H);
      x.fillStyle = 'rgba(255,255,255,0.85)'; x.fillRect(x0, 0, 1.5, H); x.fillRect(x0 + w - 1.5, 0, 1.5, H);
      if (c.bikeLane === 'protected') { x.fillStyle = '#bdb8ae'; x.fillRect(parts[q + 1]?.[0] === 'walk' ? x0 : x0 + w - 4, 0, 4, H); }
    } else if (kind === 'lane' || kind === 'bus') {
      x.fillStyle = kind === 'bus' ? '#8b3a2f' : asphalt; x.fillRect(x0, 0, w, H);
      laneEdges.push([x0, x0 + w, kind]);
    } else if (kind === 'median') {
      const planted = type === 'boulevard' || type === 'avenue';
      x.fillStyle = planted ? '#6f9a4f' : '#b2afa6'; x.fillRect(x0, 0, w, H);
      if (planted) { x.fillStyle = 'rgba(40,70,30,0.35)'; for (let y = 0; y < H; y += 6) x.fillRect(x0 + ((y * 7) % Math.max(1, w - 3)), y, 3, 3); }
      x.fillStyle = '#a8a49a'; x.fillRect(x0, 0, 2, H); x.fillRect(x0 + w - 2, 0, 2, H);
    } else if (kind === 'plaza') {
      x.fillStyle = '#d8c2a4'; x.fillRect(0, 0, W, H);
      x.strokeStyle = 'rgba(120,90,60,0.25)';
      for (let y = 0; y < H; y += 10) for (let xx = (y / 10) % 2 * 10; xx < W; xx += 20) x.strokeRect(xx + 0.5, y + 0.5, 20, 10);
    }
    pos += m;
  }
  // asphalt grain
  for (const [a0, a1] of laneEdges) {
    for (let q = 0; q < (a1 - a0) * H * 0.08; q++) {
      const gx = a0 + Math.random() * (a1 - a0), gy = Math.random() * H, v = Math.random();
      x.fillStyle = v < 0.5 ? 'rgba(0,0,0,0.12)' : 'rgba(255,255,255,0.06)';
      x.fillRect(gx, gy, 1, 1);
    }
  }
  // lane markings
  for (let q = 1; q < laneEdges.length; q++) {
    const xe = laneEdges[q][0];
    if (Math.abs(laneEdges[q - 1][1] - xe) > 1) continue;     // centre gap handled below
    x.fillStyle = 'rgba(240,240,240,0.9)';
    for (let y = 0; y < H; y += 64) x.fillRect(xe - 1, y, 2, 24);
  }
  if (!c.oneWay && type !== 'pedestrian' && !((c.median || 0) > 0)) {
    // centre line between the two directions
    let cx = 0, acc = 0;
    for (const [kind, m] of parts) { if (kind === 'center') { cx = acc * sx; break; } acc += m; }
    if (type === 'expressway' || type === 'highway') { x.fillStyle = '#b9b6ae'; x.fillRect(cx - 3, 0, 6, H); }
    else if (c.style === 'US') { x.fillStyle = '#e8b931'; x.fillRect(cx - 3, 0, 2, H); x.fillRect(cx + 1, 0, 2, H); }
    else if (type === 'street') { x.fillStyle = 'rgba(245,245,245,0.9)'; for (let y = 0; y < H; y += 64) x.fillRect(cx - 1, y, 2, 30); }
    else { x.fillStyle = c.style === 'JP' ? '#f2f2f2' : 'rgba(245,245,245,0.9)'; x.fillRect(cx - 1.5, 0, 3, H); }
  }
  if (type === 'expressway' || type === 'highway') {
    // edge lines
    const first = laneEdges[0], last = laneEdges[laneEdges.length - 1];
    if (first && last) { x.fillStyle = '#f2f2f2'; x.fillRect(first[0] + 2, 0, 2, H); x.fillRect(last[1] - 4, 0, 2, H); }
    if (type === 'expressway') { x.fillStyle = '#a7a59e'; x.fillRect(0, 0, 4, H); x.fillRect(W - 4, 0, 4, H); }
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 8;
  tex.generateMipmaps = true;
  texCache.set(key, tex);
  return tex;
}

// ---------------------------------------------------------------- materials
/** Make any material widen its ribbon (position + aSide * scale) when zoomed far out. */
export function widen(m, shared) {
  m.onBeforeCompile = sh => {
    sh.uniforms.uWScale = shared.uWScale;
    sh.vertexShader = 'attribute vec3 aSide;\nuniform float uWScale;\n' + sh.vertexShader.replace('#include <begin_vertex>', 'vec3 transformed = vec3(position) + aSide * uWScale;');
  };
  return m;
}
/** Lambert material whose ribbons widen when zoomed far out so roads stay visible. */
export function ribbonMaterial(opts, shared) {
  const m = widen(new THREE.MeshLambertMaterial({ side: THREE.DoubleSide, ...opts }), shared);
  m.polygonOffset = true; m.polygonOffsetFactor = -2; m.polygonOffsetUnits = -2;
  return m;
}

// ---------------------------------------------------------------- builder
export class Roads3D {
  constructor(G, terrain, shared) {
    this.G = G; this.terrain = terrain; this.shared = shared;
    this.group = new THREE.Group();
    this.edgeY = new Map();    // edge id -> { ys, n } heights along the edge for vehicles
    this.nodeY = new Map();
    this.meshes = [];
  }

  isWater(x, y) { return isWaterAt(x, y, 0.004); }

  nodeHeight(n) {
    const net = this.G.net;
    let ex = 0, su = 0;
    for (const id of n.e) { const e = net.edges[id]; if (!e) continue; if (ROAD_TYPES[net.roads[e.road].type].surface) su++; else ex++; }
    const gnd = Math.max(this.terrain.heightAt(n.x, n.y), 0);
    if (ex && !su) return gnd + EXPWY_H;
    if (this.isWater(n.x, n.y)) return gnd + 0.006;
    return gnd + ROAD_LIFT;
  }

  rebuild() {
    const G = this.G, net = G.net, T3 = this.terrain;
    for (const m of this.meshes) { this.group.remove(m); m.geometry.dispose(); m.material.dispose(); }
    this.meshes = [];
    this.edgeY.clear(); this.nodeY.clear();
    for (const n of Object.values(net.nodes)) this.nodeY.set(n.id, this.nodeHeight(n));
    const buckets = new Map();     // texture key -> arrays
    const bucket = (key, tex) => {
      if (!buckets.has(key)) buckets.set(key, { tex, pos: [], side: [], uv: [], col: [], idx: [], edges: [] });
      return buckets.get(key);
    };
    const concrete = { pos: [], nrm: [], idx: [] };
    const pillars = [];
    this.trees = [];
    const lights = [];
    const jr = new Map();     // junction radius per node
    const deg = new Map();
    for (const e of Object.values(net.edges)) {
      const r = net.roads[e.road];
      if (!ROAD_TYPES[r.type].surface) continue;
      deg.set(e.a, (deg.get(e.a) || 0) + 1); deg.set(e.b, (deg.get(e.b) || 0) + 1);
    }
    this.vertEdge = new Map();
    // junction trim radius: roads stop at the edge of the junction area
    const carriage = rd => (rd.cfg.lanes * (rd.cfg.oneWay ? 1 : 2) * ROAD_TYPES[rd.type].laneW + BIKE_LANES[rd.cfg.bikeLane].w * (rd.cfg.oneWay ? 1 : 2) + (rd.cfg.oneWay ? 0 : (rd.cfg.median || 0))) / 2000;
    for (const [nid, d] of deg) {
      if (d < 3) continue;
      let r = 0;
      for (const id of net.nodes[nid].e) {
        const rd = net.roads[net.edges[id].road];
        if (!ROAD_TYPES[rd.type].surface || rd.type === 'pedestrian') continue;
        r = Math.max(r, carriage(rd) + 0.0015);
      }
      if (r) jr.set(nid, r);
    }
    const curb = { pos: [], side: [], uv: [], col: [], idx: [] };
    for (const e of Object.values(net.edges)) {
      const r = net.roads[e.road], T = ROAD_TYPES[r.type], c = r.cfg;
      const A = net.nodes[e.a], B = net.nodes[e.b];
      const key = roadKey(r.type, c);
      const b = bucket(key, roadTexture(r.type, c));
      const hw = roadWidthM(r.type, c) / 2000;
      const len = e.len || 1e-6;
      const dx = (B.x - A.x) / len, dy = (B.y - A.y) / len;
      const sx = -dy, sy = dx;              // lateral unit (world x,y)
      const n = Math.max(1, Math.ceil(len / 0.04));
      const yA = this.nodeY.get(e.a), yB = this.nodeY.get(e.b);
      const ys = new Float32Array(n + 1);
      const water = new Float32Array(n + 1);
      for (let s = 0; s <= n; s++) { const t = s / n; water[s] = this.isWater(A.x + (B.x - A.x) * t, A.y + (B.y - A.y) * t) ? 1 : 0; }
      for (let s = 0; s <= n; s++) {
        const t = s / n, x = A.x + (B.x - A.x) * t, y = A.y + (B.y - A.y) * t;
        const gnd = Math.max(T3.heightAt(x, y), 0);
        let h;
        if (!T.surface) h = Math.max(yA + (yB - yA) * t, gnd + ROAD_LIFT);
        else {
          let br = 0;
          for (let q = -3; q <= 3; q++) { const w = water[Math.min(n, Math.max(0, s + q))]; if (w) br = Math.max(br, 1 - Math.abs(q) / 4); }
          const endBlend = Math.min(1, Math.min(t, 1 - t) * len / 0.03);
          h = gnd + ROAD_LIFT + 0.006 * br;
          // keep junction ends at the node height
          h = h * endBlend + (t < 0.5 ? yA : yB) * (1 - endBlend);
        }
        ys[s] = h;
      }
      this.edgeY.set(e.id, { ys, n });
      // trimmed extent along the edge (junctions draw the middle part)
      const t0 = jr.has(e.a) && T.surface ? Math.min(0.45, jr.get(e.a) / len) : 0;
      const t1 = jr.has(e.b) && T.surface ? Math.max(0.55, 1 - jr.get(e.b) / len) : 1;
      const yAt = t => { const f = t * n, i = Math.min(n - 1, Math.floor(f)); return ys[i] + (ys[i + 1] - ys[i]) * (f - i); };
      const m = Math.max(1, Math.ceil((t1 - t0) * len / 0.04));
      // cross-section strips: raised (sidewalk, median) or at road level
      const parts = layout(r.type, c), tot = parts.reduce((q, p) => q + p[1], 0) || 1;
      const strips = [];
      let acc = 0;
      for (const [kind, wm] of parts) {
        if (wm <= 0) continue;
        const raised = kind === 'walk' || kind === 'median';
        const o0 = acc / tot, o1 = (acc + wm) / tot;
        const last = strips[strips.length - 1];
        if (last && last.raised === raised) last.o1 = o1; else strips.push({ raised, o0, o1, kind });
        acc += wm;
      }
      const base = b.pos.length / 3;
      for (const st of strips) {
        const sb = b.pos.length / 3;
        for (let q = 0; q <= m; q++) {
          const t = t0 + (t1 - t0) * q / m, x = A.x + (B.x - A.x) * t, y = A.y + (B.y - A.y) * t;
          const h = yAt(t) + (st.raised && T.surface ? CURB : 0), v = t * len * 1000 / REPEAT_M;
          for (const o of [st.o0, st.o1]) {
            const off = (o * 2 - 1) * hw;
            b.pos.push(x, h, y); b.side.push(sx * off, 0, sy * off); b.uv.push(o, v); b.col.push(1, 1, 1);
          }
          if (q < m) { const v0 = sb + q * 2; b.idx.push(v0, v0 + 1, v0 + 2, v0 + 1, v0 + 3, v0 + 2); }
        }
      }
      // curb faces where raised strips meet the carriageway
      if (T.surface) for (let i = 0; i < strips.length - 1; i++) {
        if (strips[i].raised === strips[i + 1].raised) continue;
        const o = strips[i].o1, off = (o * 2 - 1) * hw, cb = curb.pos.length / 3;
        for (let q = 0; q <= m; q++) {
          const t = t0 + (t1 - t0) * q / m, x = A.x + (B.x - A.x) * t, y = A.y + (B.y - A.y) * t, h = yAt(t);
          curb.pos.push(x, h, y, x, h + CURB, y); curb.side.push(sx * off, 0, sy * off, sx * off, 0, sy * off);
          curb.uv.push(0, 0, 0, 1); curb.col.push(1, 1, 1, 1, 1, 1);
          if (q < m) { const v0 = cb + q * 2; curb.idx.push(v0, v0 + 1, v0 + 2, v0 + 1, v0 + 3, v0 + 2); }
        }
      }
      for (let q = 0; q <= n; q += 2) {
        const t = q / n, x = A.x + (B.x - A.x) * t, y = A.y + (B.y - A.y) * t;
        if (!T.surface && ys[q] - Math.max(T3.heightAt(x, y), 0) > 0.004) pillars.push([x, y, Math.max(T3.heightAt(x, y), WATERFLOOR), ys[q]]);
      }
      b.edges.push([e.id, base, b.pos.length / 3 - base]);
      // trees along planted medians
      if ((c.median || 0) >= 3 && !c.oneWay && (r.type === 'boulevard' || r.type === 'avenue')) {
        for (let d = 0.01; d < len - 0.006; d += 0.012) {
          const t = d / len;
          if (t < t0 || t > t1) continue;
          this.trees.push([A.x + dx * d, A.y + dy * d, yAt(t) - ROAD_LIFT + CURB]);
        }
      }
      // deck sides for elevated / bridge sections (concrete strip below the edge)
      if (!T.surface || water.some(w => w)) {
        for (const sgn of [-1, 1]) {
          const cb = concrete.pos.length / 3;
          for (let s = 0; s <= n; s++) {
            const t = s / n, x = A.x + (B.x - A.x) * t + sx * hw * sgn, y = A.y + (B.y - A.y) * t + sy * hw * sgn;
            concrete.pos.push(x, ys[s] + (T.surface ? 0.0004 : 0.0009), y, x, ys[s] - 0.0016, y);
            concrete.nrm.push(sx * sgn, 0, sy * sgn, sx * sgn, 0, sy * sgn);
            if (s < n) { const q = cb + s * 2; concrete.idx.push(q, q + 1, q + 2, q + 2, q + 1, q + 3); }
          }
        }
      }
      // streetlights along arterials, alternating sides
      if (T.surface && (r.type === 'avenue' || r.type === 'boulevard' || r.type === 'highway')) {
        const off = hw - Math.max(0.0008, c.sidewalk * 0.0002);
        let side = 1;
        for (let d = 0.012; d < len - 0.008; d += 0.032) {
          side = -side;
          const x = A.x + dx * d + sx * off * side, y = A.y + dy * d + sy * off * side;
          lights.push([x, y, ys[Math.round(d / len * n)] - ROAD_LIFT, Math.atan2(-(sy * -side), sx * -side)]);
        }
      }
      // street trees
      if (c.trees && T.surface) {
        const off = hw - Math.max(0.0012, c.sidewalk * 0.0004);
        for (let d = 0.008; d < len - 0.004; d += 0.014) {
          for (const sgn of [-1, 1]) {
            const x = A.x + dx * d + sx * off * sgn, y = A.y + dy * d + sy * off * sgn;
            this.trees.push([x, y, ys[Math.round(d / len * n)] - ROAD_LIFT + CURB]);
          }
        }
      }
    }
    // junction areas: paved corners (full width) with an asphalt core, as convex hulls
    const jb = { pos: [], side: [], uv: [], col: [], idx: [] }, jp = { pos: [], side: [], uv: [], col: [], idx: [] };
    const hull = pts => {
      pts = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
      const cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
      const lo = [], up = [];
      for (const p of pts) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p); }
      for (let i = pts.length - 1; i >= 0; i--) { const p = pts[i]; while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], p) <= 0) up.pop(); up.push(p); }
      return lo.slice(0, -1).concat(up.slice(0, -1));
    };
    const fan = (B2, node, y, P) => {
      if (P.length < 3) return;
      const base = B2.pos.length / 3;
      B2.pos.push(node.x, y, node.y); B2.side.push(0, 0, 0); B2.uv.push(0, 0); B2.col.push(1, 1, 1);
      for (const [ox, oy] of P) { B2.pos.push(node.x, y, node.y); B2.side.push(ox, 0, oy); B2.uv.push(0, 0); B2.col.push(1, 1, 1); }
      for (let i = 0; i < P.length; i++) B2.idx.push(base, base + 1 + ((i + 1) % P.length), base + 1 + i);
    };
    for (const [nid, r] of jr) {
      const node = net.nodes[nid];
      const full = [], core = [];
      for (const id of node.e) {
        const e = net.edges[id], rd = net.roads[e.road];
        if (!ROAD_TYPES[rd.type].surface) continue;
        const o = net.nodes[e.a === nid ? e.b : e.a], L = e.len || 1e-6;
        const ux = (o.x - node.x) / L, uy = (o.y - node.y) / L, px = -uy, py = ux;
        const fw = roadWidthM(rd.type, rd.cfg) / 2000, cw = rd.type === 'pedestrian' ? fw : carriage(rd);
        for (const sg of [-1, 1]) {
          full.push([ux * r + px * fw * sg, uy * r + py * fw * sg]);
          core.push([ux * r + px * cw * sg, uy * r + py * cw * sg]);
        }
      }
      const y = this.nodeY.get(nid);
      fan(jp, node, y + 0.00002, hull(full));
      fan(jb, node, y + 0.00006, hull(core));
    }
    const mk = (b, mat) => {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(b.pos, 3));
      geo.setAttribute('aSide', new THREE.Float32BufferAttribute(b.side, 3));
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(b.uv, 2));
      geo.setAttribute('color', new THREE.Float32BufferAttribute(b.col, 3));
      const nrm = new Float32Array(b.pos.length); for (let q = 1; q < nrm.length; q += 3) nrm[q] = 1;
      geo.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
      geo.setIndex(b.idx);
      const mesh = new THREE.Mesh(geo, mat);
      mesh.receiveShadow = true;
      mesh.frustumCulled = false;
      mesh.userData.edges = b.edges;
      this.group.add(mesh); this.meshes.push(mesh);
      return mesh;
    };
    for (const b of buckets.values()) {
      if (!b.idx.length) continue;
      const mat = ribbonMaterial({ map: b.tex, vertexColors: true }, this.shared);
      mk(b, mat);
    }
    if (jp.idx.length) {
      const m = mk(jp, ribbonMaterial({ color: 0xc9c4b8, vertexColors: true }, this.shared));
      m.material.polygonOffsetFactor = -3; m.material.polygonOffsetUnits = -3;
    }
    if (jb.idx.length) {
      const m = mk(jb, ribbonMaterial({ color: 0x46484c, vertexColors: true }, this.shared));
      m.material.polygonOffsetFactor = -4; m.material.polygonOffsetUnits = -4;
      m.renderOrder = 1;
    }
    if (curb.idx.length) mk(curb, ribbonMaterial({ color: 0xa9a59b, vertexColors: true }, this.shared));
    if (concrete.idx.length) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(concrete.pos, 3));
      geo.setAttribute('normal', new THREE.Float32BufferAttribute(concrete.nrm, 3));
      geo.setIndex(concrete.idx);
      const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color: 0xa9a59c, side: THREE.DoubleSide }));
      mesh.castShadow = true;
      this.group.add(mesh); this.meshes.push(mesh);
    }
    // zebra crossings on each approach to a junction
    const cw = { pos: [], side: [], uv: [], col: [], idx: [] };
    for (const [nid, r] of jr) {
      const node = net.nodes[nid];
      for (const id of node.e) {
        const e = net.edges[id], rd = net.roads[e.road], T = ROAD_TYPES[rd.type];
        if (!T.surface || rd.type === 'pedestrian' || e.len < 0.03) continue;
        const other = net.nodes[e.a === nid ? e.b : e.a];
        const ux = (other.x - node.x) / e.len, uy = (other.y - node.y) / e.len;
        const across = (rd.cfg.lanes * (rd.cfg.oneWay ? 1 : 2) * T.laneW) / 2000;
        const dist = r + 0.0017;
        const cx = node.x + ux * dist, cy = node.y + uy * dist;
        const h = (this.nodeY.get(nid) || 0) + 0.0001;
        const px = -uy, py = ux, dep = 0.0015;
        const base = cw.pos.length / 3, um = across * 2000 / 1.0;   // stripes every 1 m
        for (const [f, sgn, uu] of [[-1, -1, 0], [-1, 1, um], [1, -1, 0], [1, 1, um]]) {
          cw.pos.push(cx + ux * dep * f, h, cy + uy * dep * f);
          cw.side.push(px * across * sgn, 0, py * across * sgn);
          cw.uv.push(uu, f < 0 ? 0 : 1);
          cw.col.push(1, 1, 1);
        }
        cw.idx.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
      }
    }
    if (cw.idx.length) {
      const zc = document.createElement('canvas'); zc.width = 32; zc.height = 8;
      const zx = zc.getContext('2d'); zx.fillStyle = 'rgba(245,245,240,0.95)'; zx.fillRect(0, 0, 16, 8);
      const zt = new THREE.CanvasTexture(zc); zt.wrapS = THREE.RepeatWrapping; zt.colorSpace = THREE.SRGBColorSpace;
      const m = mk(cw, ribbonMaterial({ map: zt, transparent: true, alphaTest: 0.3, vertexColors: true }, this.shared));
      m.material.polygonOffsetFactor = -6; m.material.polygonOffsetUnits = -6;
      m.renderOrder = 2;
      this.crossMesh = m;
    } else this.crossMesh = null;
    if (lights.length) {
      const pole = new THREE.BoxGeometry(1, 1, 1); pole.translate(0, 0.5, 0);
      const arm = new THREE.BoxGeometry(1, 1, 1); arm.translate(0.5, 0, 0);
      const pm = new THREE.InstancedMesh(pole, new THREE.MeshLambertMaterial({ color: 0x6d7378 }), lights.length);
      const am = new THREE.InstancedMesh(arm, new THREE.MeshLambertMaterial({ color: 0x80868c, emissive: 0x222018 }), lights.length);
      const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
      lights.forEach(([x, y, h, ang], i) => {
        m4.compose(new THREE.Vector3(x, h, y), q.identity(), new THREE.Vector3(0.00028, 0.009, 0.00028)); pm.setMatrixAt(i, m4);
        q.setFromAxisAngle(up, ang);
        m4.compose(new THREE.Vector3(x, h + 0.0088, y), q, new THREE.Vector3(0.0022, 0.00025, 0.0004)); am.setMatrixAt(i, m4);
      });
      for (const m of [pm, am]) { m.frustumCulled = false; this.group.add(m); this.meshes.push(m); }
      this.lightMeshes = [pm, am];
    } else this.lightMeshes = [];
    if (pillars.length) {
      const geo = new THREE.BoxGeometry(1, 1, 1); geo.translate(0, 0.5, 0);
      const inst = new THREE.InstancedMesh(geo, new THREE.MeshLambertMaterial({ color: 0xb4b0a6 }), pillars.length);
      const m4 = new THREE.Matrix4();
      pillars.forEach(([x, y, g0, top], q) => { m4.makeScale(0.0028, top - 0.0016 - g0, 0.0028); m4.setPosition(x, g0, y); inst.setMatrixAt(q, m4); });
      inst.castShadow = true;
      this.group.add(inst); this.meshes.push(inst);
    }
  }

  /** Height of the road surface at fraction t along an edge (for vehicles). */
  heightOn(eid, t) {
    const d = this.edgeY.get(eid);
    if (!d) return 0;
    const f = t * d.n, i = Math.min(d.n - 1, Math.floor(f)), u = f - i;
    return d.ys[i] + (d.ys[i + 1] - d.ys[i]) * u;
  }

  /** Tint roads by volume/capacity (traffic view) or reset to white. */
  colorize(traffic) {
    const net = this.G.net;
    const c = new THREE.Color();
    for (const m of this.meshes) {
      const edges = m.userData.edges;
      if (!edges) continue;
      const col = m.geometry.attributes.color;
      for (const [eid, start, count] of edges) {
        const e = net.edges[eid];
        if (traffic && e && net.roads[e.road].type !== 'pedestrian') c.set(vcColor(Math.max(e.vc?.[0] || 0, e.vc?.[1] || 0))); else c.setRGB(1, 1, 1);
        for (let q = start; q < start + count; q++) col.setXYZ(q, c.r, c.g, c.b);
      }
      col.needsUpdate = true;
    }
  }
}
const WATERFLOOR = -0.004;
