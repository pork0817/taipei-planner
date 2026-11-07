// Rivers drawn as smooth ribbons from the river polylines (not the 200 m grid),
// with a sandy bank, plus a distance query so buildings and bridges match them.
import * as THREE from '../../vendor/three.module.min.js';
import { RIVERS, llp } from '../data/taipei.js';
import { NOISE_GLSL } from './terrain.js';

const rivers = RIVERS.map(r => ({ ...r, P: r.pts.map(llp) }));

/** How far (km) a point is inside the nearest river (positive = in water). */
export function waterDepth(x, y) {
  let best = -Infinity;
  for (const r of rivers) {
    const half = r.width / 2;
    for (let i = 0; i < r.P.length - 1; i++) {
      const [ax, ay] = r.P[i], [bx, by] = r.P[i + 1];
      if (x < Math.min(ax, bx) - half - 0.05 || x > Math.max(ax, bx) + half + 0.05 || y < Math.min(ay, by) - half - 0.05 || y > Math.max(ay, by) + half + 0.05) continue;
      const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy || 1;
      let t = ((x - ax) * dx + (y - ay) * dy) / l2; t = t < 0 ? 0 : t > 1 ? 1 : t;
      const d = Math.hypot(x - ax - dx * t, y - ay - dy * t);
      if (half - d > best) best = half - d;
    }
  }
  return best;
}
export const isWaterAt = (x, y, margin = 0) => waterDepth(x, y) > -margin;

function smooth(P, iters = 3) {
  let p = P;
  for (let k = 0; k < iters; k++) {
    const q = [p[0]];
    for (let i = 0; i < p.length - 1; i++) {
      const [ax, ay] = p[i], [bx, by] = p[i + 1];
      q.push([ax * 0.75 + bx * 0.25, ay * 0.75 + by * 0.25], [ax * 0.25 + bx * 0.75, ay * 0.25 + by * 0.75]);
    }
    q.push(p[p.length - 1]);
    p = q;
  }
  return p;
}

function ribbonGeo(P, half, y) {
  const pos = [], uv = [], idx = [];
  let acc = 0;
  for (let i = 0; i < P.length; i++) {
    const [x, z] = P[i];
    const [px, pz] = P[Math.max(0, i - 1)], [nx, nz] = P[Math.min(P.length - 1, i + 1)];
    let dx = nx - px, dz = nz - pz; const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
    if (i) acc += Math.hypot(x - P[i - 1][0], z - P[i - 1][1]);
    pos.push(x - dz * half, y, z + dx * half, x + dz * half, y, z - dx * half);
    uv.push(0, acc, 1, acc);
    if (i < P.length - 1) { const v = i * 2; idx.push(v, v + 1, v + 2, v + 1, v + 3, v + 2); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

export function buildRivers(timeU) {
  const group = new THREE.Group();
  const water = new THREE.MeshPhongMaterial({ color: 0x2f6a94, shininess: 180, specular: 0x7fa6c4, polygonOffset: true, polygonOffsetFactor: -1 });
  water.onBeforeCompile = sh => {
    sh.uniforms.uTime = timeU;
    sh.vertexShader = 'varying vec3 vWW;\n' + sh.vertexShader.replace('#include <project_vertex>', '#include <project_vertex>\n vWW = (modelMatrix * vec4(transformed,1.0)).xyz;');
    sh.fragmentShader = 'varying vec3 vWW; uniform float uTime;\n' + NOISE_GLSL + sh.fragmentShader
      .replace('#include <normal_fragment_begin>', `#include <normal_fragment_begin>
        vec2 q = vWW.xz * 260.0;
        float wa = sin(q.x * 0.9 + uTime * 1.3) + sin(q.y * 1.3 - uTime * 1.1) + 0.6 * sin((q.x + q.y) * 2.1 + uTime * 2.0);
        float wb = cos(q.y * 0.8 + uTime * 1.2) + cos(q.x * 1.6 - uTime * 0.9) + 0.6 * cos((q.x - q.y) * 2.3 - uTime * 1.7);
        normal = normalize(normal + (viewMatrix * vec4(wa * 0.02, 0.0, wb * 0.02, 0.0)).xyz);`)
      .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
        float fres = pow(1.0 - max(dot(normalize(vViewPosition), -normal), 0.0), 3.0);
        reflectedLight.indirectDiffuse += vec3(0.5, 0.64, 0.78) * (0.04 + 0.32 * fres);`);
  };
  const bank = new THREE.MeshLambertMaterial({ color: 0xb9ad8c, polygonOffset: true, polygonOffsetFactor: -0.5 });
  const grass = new THREE.MeshLambertMaterial({ color: 0x8faa6a, polygonOffset: true, polygonOffsetFactor: -0.3 });
  for (const r of rivers) {
    const P = smooth(r.P, 3);
    const half = r.width / 2;
    const levee = new THREE.Mesh(ribbonGeo(P, half + 0.03, 0.0002), grass);       // riverside park strip
    const sand = new THREE.Mesh(ribbonGeo(P, half + 0.008, 0.0003), bank);
    const w = new THREE.Mesh(ribbonGeo(P, half, 0.0005), water);
    levee.receiveShadow = sand.receiveShadow = w.receiveShadow = true;
    if (r.width > 0.1) group.add(levee);
    group.add(sand, w);
  }
  return group;
}
