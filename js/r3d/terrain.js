// Terrain: heightmap from the grid (hills rise smoothly inside hill areas,
// rivers sit in shallow channels) and the ground mesh draped with the base texture.
import * as THREE from '../../vendor/three.module.min.js';
import { CELL } from '../data/taipei.js';
import { T_MTN, T_WATER } from '../world.js';

function hash2(i, j) { let h = (i * 374761393 + j * 668265263) >>> 0; h = (h ^ (h >>> 13)) * 1274126177 >>> 0; return (h & 0xffff) / 0xffff; }
function vnoise(x, y) {
  const i = Math.floor(x), j = Math.floor(y), fx = x - i, fy = y - j;
  const s = t => t * t * (3 - 2 * t);
  const a = hash2(i, j), b = hash2(i + 1, j), c = hash2(i, j + 1), d = hash2(i + 1, j + 1);
  return a + (b - a) * s(fx) + (c - a) * s(fy) + (a - b - c + d) * s(fx) * s(fy);
}
const fbm = (x, y) => 0.6 * vnoise(x, y) + 0.3 * vnoise(x * 2.1, y * 2.1) + 0.1 * vnoise(x * 4.3, y * 4.3);
// ridged noise: sharp crests and valleys
const ridge = (x, y) => { const a = 1 - Math.abs(2 * vnoise(x, y) - 1), b = 1 - Math.abs(2 * vnoise(x * 2.3 + 7, y * 2.3 + 3) - 1); return a * a * 0.65 + b * b * 0.35; };

export const WATER_Y = -0.0015;

// value noise for shaders
export const NOISE_GLSL = `
float h21(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float vnoise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2(1,0)), f.x), mix(h21(i + vec2(0,1)), h21(i + vec2(1,1)), f.x), f.y); }
`;

export class Terrain {
  constructor(G) {
    this.G = G;
    this.computeHeights();
  }

  computeHeights() {
    const g = this.G.grid, W = g.w, H = g.h;
    // chamfer distance (in cells) to the nearest non-hill cell
    const dist = new Float32Array(g.n);
    for (let k = 0; k < g.n; k++) dist[k] = g.terrain[k] === T_MTN ? 1e6 : 0;
    const D1 = 1, D2 = 1.414;
    for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
      const k = j * W + i; let d = dist[k];
      if (i > 0) d = Math.min(d, dist[k - 1] + D1);
      if (j > 0) { d = Math.min(d, dist[k - W] + D1); if (i > 0) d = Math.min(d, dist[k - W - 1] + D2); if (i < W - 1) d = Math.min(d, dist[k - W + 1] + D2); }
      dist[k] = d;
    }
    for (let j = H - 1; j >= 0; j--) for (let i = W - 1; i >= 0; i--) {
      const k = j * W + i; let d = dist[k];
      if (i < W - 1) d = Math.min(d, dist[k + 1] + D1);
      if (j < H - 1) { d = Math.min(d, dist[k + W] + D1); if (i < W - 1) d = Math.min(d, dist[k + W + 1] + D2); if (i > 0) d = Math.min(d, dist[k + W - 1] + D2); }
      dist[k] = d;
    }
    const cellH = new Float32Array(g.n);
    for (let k = 0; k < g.n; k++) {
      const i = k % W, j = (k / W) | 0;
      if (g.terrain[k] === T_WATER) { cellH[k] = -0.006; continue; }
      if (g.terrain[k] !== T_MTN) { cellH[k] = 0; continue; }
      const yang = j * CELL < 12.7;              // Yangmingshan is much higher than the other hills
      const peak = yang ? 0.72 : 0.28, ramp = yang ? 14 : 6;
      const t = Math.min(1, dist[k] / ramp);
      const sm = t * t * (3 - 2 * t);
      // relief is exaggerated ~1.35x so the hills read clearly from the usual camera angles
      cellH[k] = 1.35 * (peak * sm * (0.25 + 0.45 * fbm(i * 0.09, j * 0.09) + 0.55 * ridge(i * 0.21, j * 0.21)) + 0.01 * sm);
    }
    // vertex heights at cell corners
    const VW = W + 1, VH = H + 1;
    const vh = new Float32Array(VW * VH);
    for (let j = 0; j < VH; j++) for (let i = 0; i < VW; i++) {
      let s = 0, n = 0, water = 0;
      for (const [a, b] of [[i - 1, j - 1], [i, j - 1], [i - 1, j], [i, j]]) {
        if (a < 0 || b < 0 || a >= W || b >= H) continue;
        const k = b * W + a;
        if (g.terrain[k] === T_WATER) water++;
        s += cellH[k]; n++;
      }
      let h = n ? s / n : 0;
      if (water && water === n) h = -0.006; else if (water) h = Math.min(h, -0.002);
      vh[j * VW + i] = h;
    }
    this.vh = vh; this.VW = VW; this.VH = VH;
  }

  /** Ground height (km) at world x (east) and y (south). */
  heightAt(x, y) {
    const fx = x / CELL, fy = y / CELL;
    if (fx < 0 || fy < 0 || fx >= this.VW - 1 || fy >= this.VH - 1) return 0;
    const i = Math.floor(fx), j = Math.floor(fy), tx = fx - i, ty = fy - j, VW = this.VW, v = this.vh;
    const a = v[j * VW + i], b = v[j * VW + i + 1], c = v[(j + 1) * VW + i], d = v[(j + 1) * VW + i + 1];
    return a + (b - a) * tx + (c - a) * ty + (a - b - c + d) * tx * ty;
  }

  buildMesh(baseCanvas, timeU) {
    const VW = this.VW, VH = this.VH;
    const pos = new Float32Array(VW * VH * 3), uv = new Float32Array(VW * VH * 2);
    for (let j = 0; j < VH; j++) for (let i = 0; i < VW; i++) {
      const q = j * VW + i;
      pos[q * 3] = i * CELL; pos[q * 3 + 1] = this.vh[q]; pos[q * 3 + 2] = j * CELL;
      uv[q * 2] = i / (VW - 1); uv[q * 2 + 1] = 1 - j / (VH - 1);
    }
    const idx = new Uint32Array((VW - 1) * (VH - 1) * 6);
    let p = 0;
    for (let j = 0; j < VH - 1; j++) for (let i = 0; i < VW - 1; i++) {
      const a = j * VW + i, b = a + 1, c = a + VW, d = c + 1;
      idx[p++] = a; idx[p++] = c; idx[p++] = b; idx[p++] = b; idx[p++] = c; idx[p++] = d;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    geo.computeVertexNormals();
    this.geo = geo;
    const tex = new THREE.CanvasTexture(baseCanvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    this.tex = tex;
    const mat = new THREE.MeshLambertMaterial({ map: tex });
    mat.onBeforeCompile = sh => {
      sh.vertexShader = 'varying vec3 vTW; varying vec3 vTN;\n' + sh.vertexShader.replace('#include <project_vertex>', '#include <project_vertex>\n vTW = (modelMatrix * vec4(transformed,1.0)).xyz; vTN = normalize(mat3(modelMatrix) * objectNormal);');
      sh.fragmentShader = 'varying vec3 vTW; varying vec3 vTN;\n' + NOISE_GLSL + sh.fragmentShader.replace('#include <map_fragment>', `#include <map_fragment>
        float n1 = vnoise(vTW.xz * 90.0), n2 = vnoise(vTW.xz * 11.0);
        diffuseColor.rgb *= 0.88 + 0.12 * n1 + 0.1 * (n2 - 0.5);
        float hgt = vTW.y;
        float forest = smoothstep(0.015, 0.2, hgt);
        float canopy = vnoise(vTW.xz * 420.0) * 0.6 + vnoise(vTW.xz * 160.0) * 0.4;
        vec3 forestCol = mix(vec3(0.07, 0.15, 0.06), vec3(0.17, 0.27, 0.10), canopy) * (0.85 + 0.3 * n2);
        diffuseColor.rgb = mix(diffuseColor.rgb, forestCol, forest * 0.85);
        float steep = smoothstep(0.12, 0.45, 1.0 - vTN.y);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.42, 0.40, 0.33) * (0.85 + 0.3 * n1), steep * 0.7);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.55, 0.62, 0.66), smoothstep(0.95, 1.3, hgt) * 0.12);`);
    };
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
    this.mesh = mesh;

    // overlay drape (info views)
    const ogeo = geo.clone();
    const op = ogeo.attributes.position.array;
    for (let q = 1; q < op.length; q += 3) op[q] += 0.0012;
    this.ovTex = null;
    this.ovMesh = new THREE.Mesh(ogeo, new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, opacity: 0.85 }));
    this.ovMesh.visible = false;
    this.ovMesh.renderOrder = 2;

    // water and surrounding land
    const W = (VW - 1) * CELL, H = (VH - 1) * CELL;
    const wmat = new THREE.MeshPhongMaterial({ color: 0x2f6a94, shininess: 180, specular: 0x7fa6c4 });
    wmat.onBeforeCompile = sh => {
      sh.uniforms.uTime = timeU || { value: 0 };
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
    const water = new THREE.Mesh(new THREE.PlaneGeometry(W + 40, H + 40), wmat);
    water.receiveShadow = true;
    water.rotation.x = -Math.PI / 2; water.position.set(W / 2, WATER_Y, H / 2);
    const outer = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), new THREE.MeshLambertMaterial({ color: 0x9aae80 }));
    outer.rotation.x = -Math.PI / 2; outer.position.set(W / 2, -0.004, H / 2);
    outer.receiveShadow = true;
    // keep the outer land below the grid edge and the sea of water only inside the grid
    water.scale.set(W / (W + 40), H / (H + 40), 1);
    this.extras = [water, outer];
  }

  setOverlay(canvas) {
    if (!canvas) { this.ovMesh.visible = false; return; }
    if (!this.ovTex || this.ovTex.image !== canvas) {
      this.ovTex = new THREE.CanvasTexture(canvas);
      this.ovTex.magFilter = THREE.NearestFilter;
      this.ovTex.colorSpace = THREE.SRGBColorSpace;
      this.ovMesh.material.map = this.ovTex;
      this.ovMesh.material.needsUpdate = true;
    }
    this.ovTex.needsUpdate = true;
    this.ovMesh.visible = true;
  }
}
