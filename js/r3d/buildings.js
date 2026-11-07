// 3D buildings, public buildings and trees, all instanced. Each 200 m parcel is
// split into a 4x4 grid of 50 m lots; lots crossed by roads stay empty so
// buildings line the streets instead of sitting on them.
import * as THREE from '../../vendor/three.module.min.js';
import { CELL } from '../data/taipei.js';
import { Z, S, T_MTN, T_LAND, T_OUT } from '../world.js';
import { roadWidthM } from '../roads.js';
import { BSTYLES } from '../bstyles.js';
import { cellStyle } from '../sim.js';
import { NOISE_GLSL } from './terrain.js';

const LOT = CELL / 4;               // 50 m
const FLOOR = 0.0032;               // 3.2 m per storey
const FLOORS = [[0, 0], [1, 2], [3, 4], [5, 6], [7, 12], [13, 25], [26, 60]];

function hash(a, b = 0) { let x = (a * 2654435761 + b * 97531) >>> 0; x ^= x >>> 15; x = Math.imul(x, 2246822519) >>> 0; x ^= x >>> 13; return ((x >>> 0) % 10000) / 10000; }

/** Facade material: floors, bays and windows drawn procedurally from world position,
 *  with a parapet, darker ground floor, contact shadow at the base and sky reflections. */
function facadeMaterial(glassy) {
  const m = glassy
    ? new THREE.MeshPhongMaterial({ shininess: 70, specular: 0x6a7480 })
    : new THREE.MeshLambertMaterial();
  m.onBeforeCompile = sh => {
    sh.vertexShader = 'varying vec3 vWPos; varying vec3 vWN; varying float vBase; varying float vTop; varying float vSeed;\n' + sh.vertexShader.replace('#include <project_vertex>', `#include <project_vertex>
      vec4 wp = vec4(transformed, 1.0);
      vec3 wn = objectNormal;
      vBase = 0.0; vTop = 1.0; vSeed = 0.5;
      #ifdef USE_INSTANCING
        wp = instanceMatrix * wp; wn = mat3(instanceMatrix) * wn;
        vBase = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).y;
        vTop = (modelMatrix * instanceMatrix * vec4(0.0, 1.0, 0.0, 1.0)).y;
        vec3 t0 = (instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
        vSeed = fract(sin(dot(t0.xz * 1000.0, vec2(12.9898, 78.233))) * 43758.5453);
      #endif
      vWPos = (modelMatrix * wp).xyz; vWN = normalize(mat3(modelMatrix) * wn);`);
    sh.fragmentShader = 'varying vec3 vWPos; varying vec3 vWN; varying float vBase; varying float vTop; varying float vSeed;\n' + NOISE_GLSL + sh.fragmentShader
      .replace('#include <color_fragment>', `#include <color_fragment>
      float gWin = 0.0;
      float above = vWPos.y - vBase, toTop = vTop - vWPos.y;
      float ao = mix(0.55, 1.0, smoothstep(0.0, 0.008, above));
      if (abs(vWN.y) < 0.5) {
        float FL = ${FLOOR.toFixed(4)};
        float fl = fract(above / FL), fIdx = floor(above / FL);
        float along = abs(vWN.x) > 0.5 ? vWPos.z : vWPos.x;
        float bayW = ${glassy ? '0.0026' : '0.0031'} + vSeed * ${glassy ? '0.0006' : '0.0014'};
        float bay = fract(along / bayW), bIdx = floor(along / bayW);
        float wx0 = ${glassy ? '0.06' : '0.2'} + vSeed * 0.06, wy0 = ${glassy ? '0.1' : '0.3'};
        float win = smoothstep(wy0, wy0 + 0.04, fl) * (1.0 - smoothstep(0.82, 0.86, fl))
                  * smoothstep(wx0, wx0 + 0.03, bay) * (1.0 - smoothstep(1.0 - wx0 - 0.03, 1.0 - wx0, bay));
        win *= step(0.0013, toTop);                       // parapet without windows
        float gf = 1.0 - step(FL, above);                 // ground floor
        float rnd = h21(vec2(bIdx, fIdx) + vSeed * 31.0);
        vec3 glass = mix(vec3(0.09, 0.12, 0.17), vec3(0.30, 0.36, 0.42), rnd * 0.7);
        glass = mix(glass, vec3(0.55, 0.45, 0.30), step(0.93, rnd) * 0.6);      // a few curtained windows
        gWin = win * ${glassy ? '0.9' : '0.75'};
        diffuseColor.rgb = mix(diffuseColor.rgb, glass, gWin);
        diffuseColor.rgb *= 1.0 - 0.1 * (1.0 - smoothstep(0.0, 0.08, fl)) * (1.0 - gWin);   // floor slab lines
        diffuseColor.rgb *= mix(1.0, 0.78, gf);
        diffuseColor.rgb *= 0.94 + 0.12 * vnoise(vec2(along, vWPos.y) * 900.0);
        diffuseColor.rgb *= ao;
      } else if (vWN.y > 0.5) {
        diffuseColor.rgb *= 0.8 + 0.12 * vnoise(vWPos.xz * 2500.0);
      }`)
      .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
      float fres = pow(1.0 - abs(dot(normalize(vViewPosition), normal)), 2.5);
      reflectedLight.indirectDiffuse += vec3(0.58, 0.70, 0.84) * gWin * (${glassy ? '0.12 + 0.6' : '0.04 + 0.3'} * fres);`);
  };
  return m;
}

function prismGeometry() {
  // unit gable roof: base 1x1 at y=0, ridge along x at height 1
  const g = new THREE.BufferGeometry();
  const p = [-0.5, 0, -0.5, 0.5, 0, -0.5, 0.5, 1, 0, -0.5, 1, 0, -0.5, 0, 0.5, 0.5, 0, 0.5];
  const v = [];
  const tri = (a, b, c) => v.push(...p.slice(a * 3, a * 3 + 3), ...p.slice(b * 3, b * 3 + 3), ...p.slice(c * 3, c * 3 + 3));
  tri(0, 3, 2); tri(0, 2, 1);           // north slope
  tri(4, 5, 2); tri(4, 2, 3);           // south slope
  tri(0, 4, 3); tri(1, 2, 5);           // gables
  g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
  g.computeVertexNormals();
  return g;
}

export class Buildings3D {
  constructor(G, terrain) {
    this.G = G; this.terrain = terrain;
    this.group = new THREE.Group();
    this.mask = null;
    const box = new THREE.BoxGeometry(1, 1, 1); box.translate(0, 0.5, 0);
    this.box = box;
    this.prism = prismGeometry();
    const cyl = new THREE.CylinderGeometry(0.5, 0.5, 1, 8); cyl.translate(0, 0.5, 0);
    const canopy = new THREE.IcosahedronGeometry(0.5, 0); canopy.translate(0, 0.5, 0);
    const trunkGeo = new THREE.CylinderGeometry(0.5, 0.5, 1, 5, 1, true); trunkGeo.translate(0, 0.5, 0);
    const pine = new THREE.ConeGeometry(0.5, 1, 7); pine.translate(0, 0.5, 0);
    this.meshDefs = {
      wall: { geo: box, mat: facadeMaterial(false), cast: true, max: 120000 },
      glass: { geo: box, mat: facadeMaterial(true), cast: true, max: 30000 },
      plain: { geo: box, mat: new THREE.MeshLambertMaterial(), cast: true, max: 60000 },
      roof: { geo: this.prism, mat: new THREE.MeshLambertMaterial(), cast: true, max: 60000 },
      tank: { geo: cyl, mat: new THREE.MeshLambertMaterial(), cast: false, max: 40000 },
      trunk: { geo: trunkGeo, mat: new THREE.MeshLambertMaterial({ color: 0x6b4f3a }), cast: false, max: 40000 },
      canopy: { geo: canopy, mat: new THREE.MeshLambertMaterial({ flatShading: true }), cast: true, max: 40000 },
      pine: { geo: pine, mat: new THREE.MeshLambertMaterial({ flatShading: true }), cast: false, max: 40000 },
    };
    this.meshes = {};
    for (const [k, d] of Object.entries(this.meshDefs)) {
      const m = new THREE.InstancedMesh(d.geo, d.mat, d.max);
      m.count = 0; m.castShadow = d.cast; m.receiveShadow = true;
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(d.max * 3), 3);
      m.frustumCulled = false;
      this.meshes[k] = m;
      this.group.add(m);
    }
    this._m = new THREE.Matrix4(); this._c = new THREE.Color(); this._q = new THREE.Quaternion(); this._e = new THREE.Euler();
  }

  /** Mark 50 m lots that roads pass over. */
  computeMask() {
    const G = this.G, g = G.grid, net = G.net;
    const mask = new Uint16Array(g.n);
    for (const e of Object.values(net.edges)) {
      const r = net.roads[e.road];
      const A = net.nodes[e.a], B = net.nodes[e.b];
      const hw = roadWidthM(r.type, r.cfg) / 2000 + 0.004 + LOT * 0.42;
      const i0 = Math.max(0, Math.floor((Math.min(A.x, B.x) - hw) / CELL)), i1 = Math.min(g.w - 1, Math.floor((Math.max(A.x, B.x) + hw) / CELL));
      const j0 = Math.max(0, Math.floor((Math.min(A.y, B.y) - hw) / CELL)), j1 = Math.min(g.h - 1, Math.floor((Math.max(A.y, B.y) + hw) / CELL));
      const dx = B.x - A.x, dy = B.y - A.y, l2 = dx * dx + dy * dy || 1;
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const k = j * g.w + i;
        for (let q = 0; q < 16; q++) {
          const px = i * CELL + (q % 4 + 0.5) * LOT, py = j * CELL + ((q >> 2) + 0.5) * LOT;
          let t = ((px - A.x) * dx + (py - A.y) * dy) / l2; t = t < 0 ? 0 : t > 1 ? 1 : t;
          const ex = A.x + dx * t - px, ey = A.y + dy * t - py;
          if (ex * ex + ey * ey < hw * hw) mask[k] |= 1 << q;
        }
      }
    }
    this.mask = mask;
  }

  rebuild(treesFromRoads = []) {
    const G = this.G, g = G.grid;
    if (!this.mask) this.computeMask();
    const cnt = {}; for (const k in this.meshes) cnt[k] = 0;
    const M = this._m, C = this._c, Q = this._q, E = this._e;
    const put = (kind, x, y, z, sx, sy, sz, color, rot = 0) => {
      const mesh = this.meshes[kind];
      const q = cnt[kind];
      if (q >= this.meshDefs[kind].max) return;
      E.set(0, rot, 0); Q.setFromEuler(E);
      M.compose(new THREE.Vector3(x, y, z), Q, new THREE.Vector3(sx, sy, sz));
      mesh.setMatrixAt(q, M);
      C.set(color); mesh.instanceColor.setXYZ(q, C.r, C.g, C.b);
      cnt[kind] = q + 1;
    };
    const GREENS = ['#4f7f3a', '#5d8f43', '#6a9a4a', '#4a7a40', '#76a254', '#587f3c'];
    const pineTree = (x, y, h, s) => {
      put('trunk', x, h, y, 0.0006 * s, 0.002 * s, 0.0006 * s, '#5a4330');
      put('pine', x, h + 0.0012 * s, y, 0.0055 * s, 0.011 * s, 0.0055 * s, hash(x * 1e4, y * 1e4) < 0.5 ? '#2f5a2c' : '#3b6a33');
    };
    const tree = (x, y, h, s = 1, color) => {
      color ||= GREENS[Math.floor(hash(x * 1e4, y * 1e4) * GREENS.length)];
      const c = color || (hash(x * 1e3, y * 1e3) < 0.5 ? '#4f7f3a' : '#5d8f43');
      put('trunk', x, h, y, 0.0006 * s, 0.003 * s, 0.0006 * s, '#6b4f3a');
      put('canopy', x, h + 0.0022 * s, y, 0.0055 * s, 0.006 * s, 0.0055 * s, c);
    };
    const H = (x, y) => Math.max(this.terrain.heightAt(x, y), 0);

    for (let k = 0; k < g.n; k++) {
      const z = g.zone[k], lvl = g.level[k], sp = g.special[k];
      const i = k % g.w, j = (k / g.w) | 0;
      const cx = i * CELL, cy = j * CELL;
      const free = ~this.mask[k] & 0xffff;
      if (sp) { this.special(sp, k, cx, cy, free, put, tree, H); continue; }
      if (!z || !lvl) {
        // farmland hamlet trees and hill forest
        const t = g.terrain[k];
        if (t === T_MTN && hash(k, 7) < 0.85) for (let q = 0; q < 6; q++) {
          const x = cx + hash(k, q) * CELL, y = cy + hash(k, q + 9) * CELL, hh = this.terrain.heightAt(x, y);
          if (hh > 0.12 && hash(k, q + 21) < 0.6) pineTree(x, y, hh, 2.4 + 1.6 * hash(k, q + 3)); else tree(x, y, hh, 2.4 + 1.6 * hash(k, q + 3), hash(k, q + 5) < 0.5 ? '#3f6b30' : '#4a7838');
        }
        else if (t === T_LAND && g.district[k] >= 0 && hash(k, 3) < 0.12) { const x = cx + hash(k, 1) * CELL, y = cy + hash(k, 2) * CELL; tree(x, y, H(x, y), 1.2); }
        continue;
      }
      const bs = BSTYLES[cellStyle(k)];
      const [f0, f1] = FLOORS[lvl];
      const pick = (arr, s) => arr[Math.floor(hash(k, s) * arr.length) % arr.length];
      const lotFree = q => (free >> q) & 1;
      const used = new Uint8Array(16);
      const base = H(cx + CELL / 2, cy + CELL / 2);
      const isInd = z === Z.I, isOff = z === Z.O, isCom = z === Z.C, isMix = z === Z.M;
      const glassTall = (isOff || isCom) && lvl >= 4 || bs.glassy && lvl >= 3;
      const roofType = bs.roof;
      const building = (x, y, w, d, floors, seed) => {
        const h = Math.max(1, floors) * FLOOR;
        const glass = glassTall && floors >= 7;
        const col = glass ? pick(bs.glass, seed) : isInd ? pick(['#a9adb0', '#9aa3a8', '#b8b2a5', '#8d9599'], seed) : pick(bs.walls, seed);
        if (isMix && floors <= 8 && bs.key === 'taipei') {
          // shophouse arcade podium
          put('plain', x, base, y, w * 1.04, FLOOR * 1.1, d * 1.04, pick(['#b7a58d', '#a8988a', '#c1b29b'], seed + 3));
          put(glass ? 'glass' : 'wall', x, base + FLOOR * 1.1, y, w, h - FLOOR, d, col);
        } else put(glass ? 'glass' : (isInd ? 'plain' : 'wall'), x, base, y, w, h, d, col);
        const top = base + (isMix && floors <= 8 && bs.key === 'taipei' ? h + FLOOR * 0.1 : h);
        if ((roofType === 'gable' || roofType === 'steep') && floors <= 6 && !isInd && !glass) {
          const rh = Math.min(w, d) * (roofType === 'steep' ? 0.85 : 0.42);
          // roof ridge along the long side; the prism's ridge runs along its local x
          put('roof', x, top, y, (w > d ? w : d) * 1.06, rh, (w > d ? d : w) * 1.06, pick(bs.roofCol || ['#555'], seed + 1), w > d ? 0 : Math.PI / 2);
          if (bs.chimney && hash(seed, 4) < 0.6) put('plain', x + w * 0.3, top, y, w * 0.1, rh * 1.1, w * 0.1, '#7d4c3b');
        } else {
          const m = Math.min(w, d);
          if (bs.tank && floors <= 12 && hash(seed, 2) < 0.35)
            put('tank', x + w * 0.2, top, y - d * 0.15, Math.min(0.0038, m * 0.22), 0.0025, Math.min(0.0038, m * 0.22), hash(seed, 6) < 0.5 ? '#d7dbe0' : '#3f6fb0');
          if (bs.key === 'taipei' && floors >= 3 && floors <= 8 && hash(seed, 8) < 0.22)
            // rooftop addition (頂樓加蓋) in corrugated iron
            put('plain', x - w * 0.15, top, y + d * 0.1, w * 0.55, FLOOR * 0.9, d * 0.6, pick(['#5c7fa3', '#8b8f94', '#a0623e', '#6f8f6a'], seed + 9));
          if (floors >= 4) put('plain', x + w * 0.22, top, y + d * 0.2, m * 0.18, 0.0018, m * 0.14, '#b3b6b9');   // stair housing
          if (floors >= 7) put('plain', x - w * 0.2, top, y - d * 0.22, m * 0.12, 0.0012, m * 0.1, '#c5c8cb');    // AC plant
          if (floors >= 13) put('plain', x, top, y, w * 0.35, 0.004, d * 0.35, '#9aa1a8');                        // rooftop plant room
        }
      };
      // pass 1: towers on 2x2 groups for high levels
      if (lvl >= 5 && !isInd) {
        for (const [a, b] of [[0, 0], [2, 0], [0, 2], [2, 2]]) {
          const qs = [b * 4 + a, b * 4 + a + 1, (b + 1) * 4 + a, (b + 1) * 4 + a + 1];
          if (!qs.every(lotFree)) continue;
          qs.forEach(q => used[q] = 1);
          const seed = k * 16 + qs[0];
          if (hash(seed, 11) < 0.25 && lvl === 5) {                // a landscaped plaza here and there
            const px = cx + (a + 1) * LOT, py = cy + (b + 1) * LOT;
            put('plain', px, base, py, LOT * 1.7, 0.0003, LOT * 1.7, '#7da862');
            for (let t = 0; t < 6; t++) tree(px + (hash(seed, t + 30) - 0.5) * LOT * 1.5, py + (hash(seed, t + 40) - 0.5) * LOT * 1.5, base, 1.1);
            continue;
          }
          const floors = f0 + Math.round(hash(seed, 1) * (f1 - f0));
          const w = LOT * (lvl === 6 ? 1.15 : 1.4) * (0.85 + 0.15 * hash(seed, 2));
          const x = cx + (a + 1) * LOT, y = cy + (b + 1) * LOT;
          if (lvl === 6 && floors > 35) {
            // stepped skyscraper with a podium
            put('plain', x, base, y, LOT * 1.8, FLOOR * 4, LOT * 1.8, pick(bs.walls, seed));
            building(x, y, w, w, Math.round(floors * 0.7), seed);
            const h1 = Math.round(floors * 0.7) * FLOOR;
            put('glass', x, base + h1, y, w * 0.72, (floors - Math.round(floors * 0.7)) * FLOOR, w * 0.72, pick(bs.glass, seed + 5));
            put('plain', x, base + floors * FLOOR, y, 0.0008, 0.02, 0.0008, '#c9ccd0');      // spire
          } else building(x, y, w, w * (0.8 + 0.3 * hash(seed, 3)), floors, seed);
        }
      }
      // pass 2: individual lots
      for (let q = 0; q < 16; q++) {
        if (used[q] || !lotFree(q)) continue;
        if (lvl >= 3 && !isInd && hash(k * 16 + q, 13) < (lvl >= 5 ? 0.22 : 0.08)) {
          // pocket park / courtyard garden
          const lx = cx + (q % 4 + 0.5) * LOT, ly = cy + ((q >> 2) + 0.5) * LOT;
          put('plain', lx, base, ly, LOT * 0.85, 0.0003, LOT * 0.85, '#82ab66');
          for (let t = 0; t < 3; t++) tree(lx + (hash(k * 16 + q, t + 50) - 0.5) * LOT * 0.7, ly + (hash(k * 16 + q, t + 60) - 0.5) * LOT * 0.7, base, 1);
          continue;
        }
        const seed = k * 16 + q;
        const lx = cx + (q % 4 + 0.5) * LOT, ly = cy + ((q >> 2) + 0.5) * LOT;
        const L = Math.min(lvl, 4);
        if (isInd) {
          if (hash(seed, 1) < 0.15) continue;
          const w = LOT * (0.7 + 0.25 * hash(seed, 2)), d = LOT * (0.55 + 0.3 * hash(seed, 3));
          building(lx, ly, w, d, 2 + Math.round(hash(seed, 4) * (lvl >= 3 ? 2 : 1)), seed);
          if (hash(seed, 5) < 0.25) put('tank', lx + w * 0.4, base, ly, 0.004, 0.01 + 0.01 * hash(seed, 6), 0.004, '#c0c4c8');
          continue;
        }
        if (bs.suburban && lvl <= 2 && z === Z.R) {
          const w = LOT * 0.35, d = LOT * 0.3;
          building(lx + (hash(seed, 1) - 0.5) * LOT * 0.3, ly + (hash(seed, 2) - 0.5) * LOT * 0.3, w, d, 1 + (hash(seed, 3) < 0.4 ? 1 : 0), seed);
          tree(lx + LOT * 0.32, ly - LOT * 0.3, base, 1);
          continue;
        }
        if (L <= 2) {
          // small houses / rowhouses: 2 to 4 per lot
          const n = bs.key === 'dutch' || bs.key === 'british' || isMix ? 4 : 2 + (hash(seed, 1) < 0.5 ? 1 : 0);
          const rows = bs.key === 'dutch' || bs.key === 'british';
          for (let u = 0; u < n; u++) {
            const s2 = seed * 7 + u;
            const floors = f0 + Math.round(hash(s2, 1) * (f1 - f0));
            if (rows) building(lx - LOT * 0.36 + (u + 0.5) * LOT * 0.18, ly, LOT * 0.17, LOT * 0.55, floors, s2);
            else {
              const ox = (u % 2 - 0.5) * LOT * 0.46, oy = ((u >> 1) - 0.5) * LOT * 0.46 * (n > 2 ? 1 : 0);
              building(lx + ox, ly + oy, LOT * (0.34 + 0.1 * hash(s2, 2)), LOT * (0.3 + 0.12 * hash(s2, 3)), floors, s2);
            }
          }
          continue;
        }
        const floors = FLOORS[L][0] + Math.round(hash(seed, 1) * (FLOORS[L][1] - FLOORS[L][0]));
        const w = LOT * (0.72 + 0.16 * hash(seed, 2)), d = LOT * (0.6 + 0.25 * hash(seed, 3));
        building(lx, ly, w, d, floors, seed);
      }
    }
    for (const [x, y, h] of treesFromRoads) tree(x, y, h, 0.9);
    for (const k in this.meshes) {
      const m = this.meshes[k];
      m.count = cnt[k];
      m.instanceMatrix.needsUpdate = true;
      m.instanceColor.needsUpdate = true;
    }
    this.counts = cnt;
  }

  special(sp, k, cx, cy, free, put, tree, H) {
    const g = this.G.grid;
    const x = cx + CELL / 2, y = cy + CELL / 2, h = H(x, y);
    const seed = k * 31;
    if (sp === S.PARK) {
      for (let q = 0; q < 14; q++) tree(cx + (0.08 + 0.84 * hash(seed, q)) * CELL, cy + (0.08 + 0.84 * hash(seed, q + 50)) * CELL, h, 1 + hash(seed, q + 9));
      return;
    }
    if (sp === S.SCHOOL) {
      put('wall', x - 0.03, h, y - 0.04, 0.12, FLOOR * 4, 0.035, '#e8d6a8');
      put('wall', x + 0.05, h, y + 0.01, 0.035, FLOOR * 4, 0.1, '#e8d6a8');
      put('plain', x - 0.02, h, y + 0.05, 0.1, 0.0004, 0.06, '#b5523b');   // running track
      return;
    }
    if (sp === S.HOSPITAL) {
      put('wall', x, h, y, 0.1, FLOOR * 10, 0.06, '#f1f1ee');
      put('plain', x, h + FLOOR * 10, y, 0.04, 0.0012, 0.01, '#d32f2f');
      put('plain', x, h + FLOOR * 10, y, 0.01, 0.0012, 0.04, '#d32f2f');
      return;
    }
    if (sp === S.MARKET) {
      for (let q = 0; q < 24; q++) {
        const sx = cx + 0.03 + (q % 6) * 0.025, sy = cy + 0.06 + Math.floor(q / 6) * 0.025;
        put('plain', sx, h, sy, 0.014, 0.0035, 0.012, ['#d84a3a', '#e7b13c', '#c0392b', '#f0e2c0'][q % 4]);
      }
      return;
    }
    if (sp === S.UNIVERSITY) {
      const n = 3;
      for (let q = 0; q < n; q++) put('wall', cx + (0.2 + 0.6 * hash(seed, q)) * CELL, h, cy + (0.2 + 0.6 * hash(seed, q + 5)) * CELL, 0.05, FLOOR * (4 + Math.round(hash(seed, q + 2) * 4)), 0.03, '#a85a44');
      tree(x, y, h, 1.3);
      return;
    }
    if (sp === S.AIRPORT) {
      // runway handled as a strip across airport rows; terminal and hangars on the top row
      const up = k - g.w, isTop = up < 0 || g.special[up] !== S.AIRPORT;
      const left = g.special[k - 1] !== S.AIRPORT;
      if (isTop) {
        if (hash(seed, 1) < 0.5) put('glass', x, h, cy + 0.04, CELL * 0.9, 0.012, 0.035, '#7f97ab');
        else put('plain', x, h, cy + 0.04, CELL * 0.6, 0.014, 0.05, '#c8cbcf');
        if (left) { put('plain', x, h, cy + 0.1, 0.008, 0.04, 0.008, '#e0e0e0'); put('glass', x, h + 0.04, cy + 0.1, 0.014, 0.006, 0.014, '#4f6f8f'); }
        if (hash(seed, 3) < 0.6) { // parked plane: fuselage + wings
          const px = x + (hash(seed, 4) - 0.5) * 0.1, py = cy + 0.1;
          put('plain', px, h + 0.002, py, 0.004, 0.004, 0.04, '#f4f4f4');
          put('plain', px, h + 0.0035, py + 0.002, 0.036, 0.0008, 0.008, '#e8e8e8');
        }
      } else {
        // runway pavement with centre markings
        put('plain', x, h, y, CELL, 0.0003, 0.05, '#55595d');
        put('plain', x, h + 0.0003, y, 0.03, 0.0001, 0.0015, '#f5f5f5');
      }
    }
  }
}
