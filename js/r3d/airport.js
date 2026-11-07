// Airports: generated for every connected airport footprint on the grid
// (Songshan, plus any the player builds): runway with real markings, taxiway,
// apron with stands, terminal, control tower, hangars and modelled airliners,
// with one aircraft taking off / landing on a loop.
import * as THREE from '../../vendor/three.module.min.js';
import { CELL } from '../data/taipei.js';
import { S } from '../world.js';

function canvasTex(w, h, draw) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return t;
}

function runwayTexture(lenM, widM) {
  const W = 2048, H = Math.round(W * widM / lenM * 4);   // stretched later; keep markings crisp
  return canvasTex(W, Math.max(64, H), (x, w, h) => {
    const px = w / lenM, py = h / widM;
    x.fillStyle = '#3c3e42'; x.fillRect(0, 0, w, h);
    for (let q = 0; q < w * h * 0.01; q++) { x.fillStyle = Math.random() < 0.5 ? 'rgba(0,0,0,0.15)' : 'rgba(255,255,255,0.05)'; x.fillRect(Math.random() * w, Math.random() * h, 2, 1); }
    x.fillStyle = '#f2f2f2';
    x.fillRect(0, 1 * py, w, 0.9 * py); x.fillRect(0, h - 1.9 * py, w, 0.9 * py);             // side stripes
    for (let m = 400; m < lenM - 400; m += 60) x.fillRect(m * px, h / 2 - 0.45 * py, 30 * px, 0.9 * py);   // centreline
    const ends = [[0, 1], [w, -1]];
    for (const [x0, dir] of ends) {
      // threshold piano keys
      for (let k = 0; k < 12; k++) { const y = (4 + k * (widM - 8) / 12) * py; x.fillRect(x0 + dir * 6 * px - (dir < 0 ? 30 * px : 0), y, 30 * px, 1.8 * py); }
      // touchdown zone and aiming point markings
      for (const [d, l, n] of [[150, 22, 3], [300, 22, 2], [450, 22, 2], [600, 22, 1], [400, 45, 0]]) {
        const lw = n ? 1.8 : 9;
        for (let k = 0; k < Math.max(1, n); k++) for (const side of [-1, 1]) {
          const y = h / 2 + side * (n ? 6 + k * 3 : 9) * py - (side < 0 ? lw * py : 0);
          x.fillRect(x0 + dir * d * px - (dir < 0 ? l * px : 0), y, l * px, lw * py);
        }
      }
      // runway designators (10 at the west end, 28 at the east end)
      x.save();
      x.translate(x0 + dir * 70 * px, h / 2);
      x.rotate(dir > 0 ? Math.PI / 2 : -Math.PI / 2);
      x.font = `bold ${Math.round(22 * py)}px sans-serif`;
      x.textAlign = 'center'; x.textBaseline = 'middle';
      x.scale(1, px / py);
      x.fillText(dir > 0 ? '10' : '28', 0, 0);
      x.restore();
    }
  });
}

function airlinerGeometry() {
  const parts = [];
  const add = (geo, color, mat4) => { if (mat4) geo.applyMatrix4(mat4); const n = geo.attributes.position.count; const c = new THREE.Color(color); const col = new Float32Array(n * 3); for (let i = 0; i < n; i++) col.set([c.r, c.g, c.b], i * 3); geo.setAttribute('color', new THREE.BufferAttribute(col, 3)); parts.push(geo.toNonIndexed()); };
  const M = () => new THREE.Matrix4();
  // fuselage along +x (metres; scaled to km at the end): 44 m long A321-like
  add(new THREE.CylinderGeometry(2, 2, 34, 12), '#f4f6f8', M().makeRotationZ(Math.PI / 2));
  add(new THREE.SphereGeometry(2, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), '#f4f6f8', M().makeRotationZ(-Math.PI / 2).setPosition(17, 0, 0));
  add(new THREE.ConeGeometry(2, 9, 12), '#f4f6f8', M().makeRotationZ(Math.PI / 2).setPosition(-21.5, 0.4, 0));
  add(new THREE.BoxGeometry(34.5, 0.5, 4.2), '#2f6db3', M().setPosition(0, -0.6, 0).multiply(M().makeScale(1, 1, 1.02)));  // cheat line
  // wings: tapered swept boxes
  for (const s of [-1, 1]) {
    const wg = new THREE.BoxGeometry(6, 0.5, 15);
    const p = wg.attributes.position;
    for (let i = 0; i < p.count; i++) { const z = p.getZ(i); const t = (z + 7.5) / 15; p.setX(i, p.getX(i) * (1 - 0.55 * (s > 0 ? t : 1 - t)) - (s > 0 ? t : 1 - t) * 5); }
    add(wg, '#dfe3e8', M().setPosition(-1, -1.2, s * 9.5));
    add(new THREE.CylinderGeometry(1.1, 1.0, 4.5, 10), '#c9ced6', M().makeRotationZ(Math.PI / 2).setPosition(1.5, -2.2, s * 5.8));
    // horizontal stabiliser
    add(new THREE.BoxGeometry(3.5, 0.35, 6), '#dfe3e8', M().setPosition(-21, 1.0, s * 3.5));
  }
  // tail fin
  const fin = new THREE.BoxGeometry(6, 7, 0.4);
  const fp = fin.attributes.position;
  for (let i = 0; i < fp.count; i++) { const y = fp.getY(i); if (y > 0) fp.setX(i, fp.getX(i) - 3.2); }
  add(fin, '#2f6db3', M().setPosition(-20, 4.8, 0));
  const all = parts.reduce((acc, g) => { acc.push(g); return acc; }, []);
  const pos = [], nrm = [], col = [];
  for (const g of all) { g.computeVertexNormals(); pos.push(...g.attributes.position.array); nrm.push(...g.attributes.normal.array); col.push(...g.attributes.color.array); }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos.map(v => v / 1000), 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.translate(0, 0.0034, 0);   // gear height
  return geo;
}

export class Airports3D {
  constructor(G, terrain, time) {
    this.G = G; this.terrain = terrain; this.time = time;
    this.group = new THREE.Group();
    this.sig = '';
    this.planeGeo = airlinerGeometry();
    this.flights = [];
  }

  footprints() {
    const g = this.G.grid, seen = new Uint8Array(g.n), out = [];
    for (let k = 0; k < g.n; k++) {
      if (g.special[k] !== S.AIRPORT || seen[k]) continue;
      let i0 = 1e9, i1 = -1, j0 = 1e9, j1 = -1;
      const st = [k]; seen[k] = 1;
      while (st.length) {
        const q = st.pop(), i = q % g.w, j = (q / g.w) | 0;
        i0 = Math.min(i0, i); i1 = Math.max(i1, i); j0 = Math.min(j0, j); j1 = Math.max(j1, j);
        for (const [a, b] of [[i + 1, j], [i - 1, j], [i, j + 1], [i, j - 1]]) {
          if (a < 0 || b < 0 || a >= g.w || b >= g.h) continue;
          const m = b * g.w + a;
          if (!seen[m] && g.special[m] === S.AIRPORT) { seen[m] = 1; st.push(m); }
        }
      }
      out.push({ x0: i0 * CELL, x1: (i1 + 1) * CELL, y0: j0 * CELL, y1: (j1 + 1) * CELL });
    }
    return out;
  }

  rebuild() {
    for (const o of [...this.group.children]) { this.group.remove(o); o.geometry?.dispose(); }
    this.flights = [];
    const fps = this.footprints();
    this.sig = JSON.stringify(fps);
    for (const f of fps) this.buildOne(f);
  }

  buildOne(f) {
    const H = (x, y) => Math.max(this.terrain.heightAt(x, y), 0);
    const L = f.x1 - f.x0, Wd = f.y1 - f.y0, cx = (f.x0 + f.x1) / 2;
    const gy = H(cx, (f.y0 + f.y1) / 2) + 0.0004;
    const flat = (w, d, color, x, y, z, map) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshLambertMaterial({ color, map: map || null, polygonOffset: true, polygonOffsetFactor: -2 }));
      m.rotation.x = -Math.PI / 2; m.position.set(x, z, y); m.receiveShadow = true;
      this.group.add(m); return m;
    };
    const box = (w, h, d, color, x, y, z, opts = {}) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshLambertMaterial({ color, ...opts }));
      m.position.set(x, z + h / 2, y); m.castShadow = true; m.receiveShadow = true;
      this.group.add(m); return m;
    };
    // grass infield
    flat(L, Wd, 0x8ea86e, cx, (f.y0 + f.y1) / 2, gy - 0.0002);
    // runway near the north side, taxiway and apron to the south (like Songshan)
    const rwLen = L * 0.93, rwW = Math.min(0.06, Wd * 0.12), ry = f.y0 + Wd * 0.3;
    flat(rwLen, rwW, 0xffffff, cx, ry, gy, runwayTexture(rwLen * 1000, rwW * 1000));
    const ty = ry + Math.max(0.09, Wd * 0.22), tw = rwW * 0.4;
    const taxTex = canvasTex(256, 32, (x, w, h) => { x.fillStyle = '#4a4c50'; x.fillRect(0, 0, w, h); x.fillStyle = '#e8c33a'; x.fillRect(0, h / 2 - 1, w, 2); x.fillStyle = '#d9d9d9'; x.fillRect(0, 1, w, 1); x.fillRect(0, h - 2, w, 1); });
    taxTex.wrapS = THREE.RepeatWrapping; taxTex.repeat.set(rwLen / 0.05, 1);
    flat(rwLen * 0.95, tw, 0xffffff, cx, ty, gy + 0.00005, taxTex);
    for (let k = 0; k < 5; k++) flat(tw, ty - ry, 0x4a4c50, f.x0 + L * (0.08 + 0.21 * k), (ry + ty) / 2, gy + 0.00003);
    // apron with stand markings
    const ax0 = f.x0 + L * 0.06, aw = L * 0.42, ay = ty + tw / 2 + Math.min(0.08, Wd * 0.18) / 2 + 0.004, ad = Math.min(0.08, Wd * 0.18);
    const apTex = canvasTex(512, 96, (x, w, h) => {
      x.fillStyle = '#b8b9b5'; x.fillRect(0, 0, w, h);
      x.strokeStyle = 'rgba(0,0,0,0.08)'; for (let i = 0; i < w; i += 16) { x.beginPath(); x.moveTo(i, 0); x.lineTo(i, h); x.stroke(); }
      x.strokeStyle = '#e8c33a'; x.lineWidth = 2;
      for (let i = 0; i < 8; i++) { const sx = (i + 0.5) * w / 8; x.beginPath(); x.moveTo(sx, h); x.lineTo(sx, h * 0.15); x.stroke(); }
    });
    flat(aw, ad, 0xffffff, ax0 + aw / 2, ay, gy + 0.00004, apTex);
    // terminal with glass facade, parking garage, control tower, hangars
    const tY = ay + ad / 2 + 0.018;
    box(aw * 0.8, 0.016, 0.03, 0xdfe5ea, ax0 + aw * 0.45, tY, gy);
    box(aw * 0.8, 0.0035, 0.034, 0x9fb2c2, ax0 + aw * 0.45, tY, gy + 0.016, { emissive: 0x111418 });   // roof canopy
    box(aw * 0.78, 0.011, 0.002, 0x5d7f9e, ax0 + aw * 0.45, tY - 0.016, gy + 0.002);                 // glass front
    box(0.06, 0.012, 0.04, 0xa9adb2, ax0 + aw * 0.95, tY + 0.01, gy);                                 // car park
    const twr = new THREE.Mesh(new THREE.CylinderGeometry(0.0028, 0.0034, 0.045, 12), new THREE.MeshLambertMaterial({ color: 0xe9e9e6 }));
    twr.position.set(ax0 + aw * 1.05, gy + 0.0225, ay); twr.castShadow = true; this.group.add(twr);
    const cab = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.0045, 0.006, 8), new THREE.MeshLambertMaterial({ color: 0x35546f, emissive: 0x0a1520 }));
    cab.position.set(ax0 + aw * 1.05, gy + 0.048, ay); cab.castShadow = true; this.group.add(cab);
    for (let k = 0; k < 3; k++) {
      const hx = f.x0 + L * (0.62 + k * 0.1), hy = ay + 0.01;
      const hg = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.05, 16, 1, false, 0, Math.PI), new THREE.MeshLambertMaterial({ color: 0xb6bcc2, side: THREE.DoubleSide }));
      hg.rotation.z = Math.PI / 2; hg.rotation.y = Math.PI / 2; hg.position.set(hx, gy, hy); hg.castShadow = true; this.group.add(hg);
    }
    // parked aircraft at the stands, nose towards the terminal
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
    const nStands = Math.max(2, Math.min(8, Math.floor(aw / 0.055)));
    const parked = new THREE.InstancedMesh(this.planeGeo, mat, nStands + 2);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
    let n = 0;
    for (let i = 0; i < nStands; i++) {
      if ((i * 7) % 5 === 3) continue;   // some stands empty
      q.setFromAxisAngle(up, -Math.PI / 2);   // fuselage +x -> facing +y (south, terminal)
      m4.compose(new THREE.Vector3(ax0 + (i + 0.5) * aw / 8 * (8 / nStands), gy, ay + 0.002), q, new THREE.Vector3(1, 1, 1));
      parked.setMatrixAt(n++, m4);
    }
    parked.count = n; parked.castShadow = true;
    this.group.add(parked);
    // one aircraft cycling: taxi, take off to the west, land from the east
    const mover = new THREE.Mesh(this.planeGeo, mat);
    mover.castShadow = true;
    this.group.add(mover);
    this.flights.push({ mesh: mover, f, ry, ty, gy, rwLen, cx, phase: Math.random() });
  }

  update() {
    const t = this.time.value;
    for (const fl of this.flights) {
      const cyc = 90;                       // seconds per take-off + landing cycle
      const p = ((t / cyc) + fl.phase) % 1;
      const m = fl.mesh, x0 = fl.cx + fl.rwLen / 2, x1 = fl.cx - fl.rwLen / 2;
      let x, y = fl.ry, h = fl.gy, pitch = 0, heading = Math.PI;   // heading PI = flying west (-x)
      if (p < 0.5) {
        // take-off roll westwards and climb out
        const u = p / 0.5;
        x = x0 + (x1 - x0) * Math.min(1, u * 1.6) - Math.max(0, u * 1.6 - 1) * 3;
        const air = Math.max(0, u * 1.6 - 0.55);
        h = fl.gy + air * air * 0.25; pitch = air > 0 ? 0.18 : 0;
      } else {
        // approach from the east and land westwards
        const u = (p - 0.5) / 0.5;
        x = x0 + 4 - u * 4 - u * (x0 - x1) * 0.4;
        const air = Math.max(0, 1 - u * 1.3);
        h = fl.gy + air * 0.35; pitch = air > 0 ? -0.05 : 0;
      }
      m.position.set(x, h, y);
      m.rotation.set(0, heading, pitch);
      m.visible = Math.abs(x - fl.cx) < 12;
    }
  }
}
