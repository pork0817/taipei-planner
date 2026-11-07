// Three.js renderer for Taipei Planner. Exposes the same small interface the UI
// used with the 2D renderer (cam, s2w, w2s, zoomAt, fit, preview, selection,
// overlay, baseDirty, ovDirty) plus camera controls (grab-pan, orbit, keys).
import * as THREE from '../../vendor/three.module.min.js';
import { G } from '../state.js';
import { CELL } from '../data/taipei.js';
import { S } from '../world.js';
import { Renderer as Renderer2D } from '../render.js';
import { Terrain } from './terrain.js';
import { Roads3D } from './roads.js';
import { Buildings3D } from './buildings.js';
import { Transit3D } from './transit.js';
import { ModelLibrary } from './models.js';
import { Airports3D } from './airport.js';
import { buildRivers } from './water.js';
import { districtLines, borderMesh } from './borders.js';

const FOV = 45;

const roadsDirtyFlag = r => false;

export class Renderer3D {
  constructor(canvas) {
    this.cv = canvas;
    this.gl = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.gl.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    this.gl.shadowMap.enabled = true;
    this.gl.shadowMap.type = THREE.PCFSoftShadowMap;
    this.gl.shadowMap.autoUpdate = false;   // re-render shadows only when something changed
    this.shadowDirty = true;
    this.gl.toneMapping = THREE.ACESFilmicToneMapping;
    this.gl.toneMappingExposure = 1.0;
    this.scene = new THREE.Scene();
    this.horizon = new THREE.Color(0xd6e3ec);
    this.scene.background = this.horizon.clone();
    this.scene.fog = new THREE.Fog(this.horizon, 10, 60);
    this.sunDir = new THREE.Vector3(-0.66, 0.5, -0.52).normalize();
    this.time = { value: 0 };
    this.sky = this.makeSky();
    this.scene.add(this.sky);
    this.camera = new THREE.PerspectiveCamera(FOV, 1, 0.001, 300);
    // camera rig: target on the ground, distance, yaw, pitch
    this.tx = 11; this.ty = 15; this.dist = 18; this.yaw = -0.3; this.pitch = 0.95;
    const self = this;
    this.cam = {
      get x() { return self.tx; }, set x(v) { self.tx = v; },
      get y() { return self.ty; }, set y(v) { self.ty = v; },
      get scale() { return self.H / (2 * self.dist * Math.tan(FOV * Math.PI / 360)); },
      set scale(v) { self.dist = Math.max(0.05, Math.min(45, self.H / (2 * v * Math.tan(FOV * Math.PI / 360)))); },
    };
    this.shared = { uWScale: { value: 1 } };
    // lights
    this.hemi = new THREE.HemisphereLight(0xcfe3ff, 0x7d725f, 0.95);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xffe7c4, 2.4);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.0003;
    this.sun.shadow.normalBias = 0.0002;
    this.sun.shadow.radius = 2.5;
    this.scene.add(this.sun, this.sun.target);
    // layers
    this.r2d = new Renderer2D(document.createElement('canvas'));
    this.r2d.groundMode = true;
    this.overlay = 'none';
    this.baseDirty = true; this.ovDirty = true;
    this.preview = null; this.selection = null;
    this.previewGroup = new THREE.Group(); this.scene.add(this.previewGroup);
    this.selGroup = new THREE.Group(); this.scene.add(this.selGroup);
    this.labels = document.getElementById('labels3d');
    this.keys = new Set();
    this.lastBuild = 0;
    this.world = null;
    this.lib = new ModelLibrary();
    this.lib.load(p => { this.loadProgress = p; const el = document.getElementById('loadbar'); if (el) { el.style.display = p < 1 ? '' : 'none'; el.firstElementChild.style.width = (p * 100).toFixed(0) + '%'; } })
      .then(() => { this.buildings?.setLibrary(this.lib); this.vehicles?.setLibrary?.(this.lib); });
    this.resize();
    window.addEventListener('keydown', e => { if (!e.target.matches('input,select,textarea')) this.keys.add(e.key); });
    window.addEventListener('keyup', e => this.keys.delete(e.key));
    window.addEventListener('blur', () => this.keys.clear());
  }

  makeSky() {
    const geo = new THREE.SphereGeometry(1, 32, 16);
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: { uSun: { value: this.sunDir }, uZen: { value: new THREE.Color(0x4f86c9) }, uHor: { value: this.horizon } },
      vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); vec4 p = modelViewMatrix * vec4(position,1.0); gl_Position = projectionMatrix * p; gl_Position.z = gl_Position.w * 0.9999; }',
      fragmentShader: `varying vec3 vDir; uniform vec3 uSun, uZen, uHor;
        void main(){
          float h = max(vDir.y, 0.0);
          vec3 c = mix(uHor, uZen, pow(h, 0.55));
          float s = max(dot(normalize(vDir), uSun), 0.0);
          c += vec3(1.0, 0.85, 0.6) * (pow(s, 64.0) * 0.9 + pow(s, 6.0) * 0.18);
          c = mix(c, uHor * 0.92, smoothstep(0.0, -0.15, vDir.y));
          gl_FragColor = vec4(c, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    const m = new THREE.Mesh(geo, mat);
    m.frustumCulled = false;
    m.renderOrder = -10;
    return m;
  }

  /** (Re)create all world layers for the current G (new game / load). */
  initWorld() {
    if (this.world === G.grid) return;
    if (this.layers) for (const o of this.layers) this.scene.remove(o);
    this.world = G.grid;
    this.terrain = new Terrain(G);
    this.r2d.drawBase();
    this.terrain.buildMesh(this.r2d.base, this.time);
    this.roads = new Roads3D(G, this.terrain, this.shared);
    this.buildings = new Buildings3D(G, this.terrain);
    this.transit = new Transit3D(G, this.terrain, this.shared);
    if (this.lib.ready) this.buildings.setLibrary(this.lib);
    this.rivers = buildRivers(this.time);
    this.airports = new Airports3D(G, this.terrain, this.time);
    this.airportSig = null;
    this.borderGroup = new THREE.Group();
    this.borderLines = districtLines(G);
    this._borderDist = 0;
    this.layers = [this.terrain.mesh, this.terrain.ovMesh, ...this.terrain.extras, this.rivers, this.borderGroup, this.airports.group, this.roads.group, this.buildings.group, this.transit.group];
    for (const o of this.layers) this.scene.add(o);
    this.netKey = null; this.transitSig = null;
    this.baseDirty = true; this.ovDirty = true;
    if (this.vehicles) { this.vehicles.r3 = this; }
  }

  resize() {
    const r = this.cv.getBoundingClientRect();
    this.W = r.width || 800; this.H = r.height || 600;
    this.gl.setSize(this.W, this.H, false);
    this.camera.aspect = this.W / this.H;
    this.camera.updateProjectionMatrix();
  }

  // -------------------------------------------------------------- camera
  updateCamera() {
    const gh = this.terrain ? Math.max(this.terrain.heightAt(this.tx, this.ty), 0) : 0;
    const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    let cx = this.tx + this.dist * cp * Math.sin(this.yaw), cz = this.ty + this.dist * cp * Math.cos(this.yaw), cy = gh + this.dist * sp;
    if (this.terrain) cy = Math.max(cy, Math.max(this.terrain.heightAt(cx, cz), 0) + 0.02);
    this.camera.position.set(cx, cy, cz);
    this.camera.lookAt(this.tx, gh, this.ty);
    this.camera.near = Math.max(0.0005, this.dist * 0.01);
    this.camera.far = Math.max(60, this.dist * 12);
    this.camera.updateProjectionMatrix();
    this.camera.updateMatrixWorld();
    this.scene.fog.near = this.dist * 2.2; this.scene.fog.far = this.dist * 7 + 20;
    // sun follows the view so shadows stay sharp near the camera
    this.sky.position.copy(this.camera.position);
    this.sky.scale.setScalar(this.camera.far * 0.9);
    const sr = Math.min(6, Math.max(0.25, this.dist * 0.9));
    const sd = this.sunDir;
    this.sun.position.set(this.tx + sd.x * sr * 3, gh + sd.y * sr * 3, this.ty + sd.z * sr * 3);
    this.sun.target.position.set(this.tx, gh, this.ty);
    const sc = this.sun.shadow.camera;
    sc.left = -sr * 1.3; sc.right = sr * 1.3; sc.top = sr * 1.3; sc.bottom = -sr * 1.3; sc.near = 0.01; sc.far = sr * 6;
    sc.updateProjectionMatrix();
    this.sun.castShadow = this.dist < 8;
    // roads widen when zoomed out so the network stays readable
    this.shared.uWScale.value = Math.min(3, Math.max(1, 2.2 / (this.cam.scale * 0.012)));
    const fine = this.shared.uWScale.value < 1.3;
    if (this.buildings) this.buildings.meshes.trunk.visible = this.dist < 5;
    if (this.roads) { if (this.roads.crossMesh) this.roads.crossMesh.visible = fine; for (const m of this.roads.lightMeshes || []) m.visible = this.dist < 2.5; }
  }

  fit() {
    const g = G.grid;
    this.tx = g.w * CELL / 2; this.ty = g.h * CELL / 2 + 1.5;
    this.dist = 26; this.yaw = -0.25; this.pitch = 0.98;
  }
  flyTo(x, y, dist) { this.tx = x; this.ty = y; if (dist) this.dist = dist; }

  /** Ground point under a screen pixel. */
  groundAt(px, py) {
    const ndc = new THREE.Vector2(px / this.W * 2 - 1, -(py / this.H) * 2 + 1);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, this.camera);
    const o = ray.ray.origin, d = ray.ray.direction;
    if (d.y > -1e-4) return null;
    let h = 0;
    let x = 0, z = 0;
    for (let it = 0; it < 4; it++) {
      const t = (h - o.y) / d.y;
      x = o.x + d.x * t; z = o.z + d.z * t;
      h = this.terrain ? Math.max(this.terrain.heightAt(x, z), 0) : 0;
    }
    return [x, z];
  }
  s2w(px, py) {
    const p = this.groundAt(px, py);
    if (p) return p;
    // above the horizon: project far along the view direction
    const dir = new THREE.Vector3(); this.camera.getWorldDirection(dir);
    return [this.tx + dir.x * 40, this.ty + dir.z * 40];
  }
  w2s(x, y, lift = 0) {
    const h = (this.terrain ? Math.max(this.terrain.heightAt(x, y), 0) : 0) + lift;
    const v = new THREE.Vector3(x, h, y).project(this.camera);
    if (v.z > 1) return [-9999, -9999];
    return [(v.x + 1) / 2 * this.W, (1 - v.y) / 2 * this.H];
  }
  zoomAt(px, py, f) {
    const p = this.groundAt(px, py);
    const nd = Math.max(0.05, Math.min(45, this.dist / f));
    if (p) { const k = nd / this.dist; this.tx = p[0] + (this.tx - p[0]) * k; this.ty = p[1] + (this.ty - p[1]) * k; }
    this.dist = nd;
  }
  grabStart(px, py) { this.grab = this.groundAt(px, py); }
  grabMove(px, py) {
    if (!this.grab) return;
    const p = this.groundAt(px, py);
    if (!p) return;
    this.tx += this.grab[0] - p[0]; this.ty += this.grab[1] - p[1];
    this.updateCamera();
  }
  orbit(dx, dy) {
    this.yaw -= dx * 0.006;
    this.pitch = Math.max(0.18, Math.min(1.5, this.pitch + dy * 0.005));
  }
  keyMove(dt) {
    const k = this.keys;
    if (!k.size) return;
    const sp = this.dist * 0.9 * dt;
    let fx = 0, fy = 0;
    if (k.has('ArrowUp') || k.has('w')) fy -= 1;
    if (k.has('ArrowDown')) fy += 1;
    if (k.has('ArrowLeft') || k.has('a')) fx -= 1;
    if (k.has('ArrowRight') || k.has('d')) fx += 1;
    if (fx || fy) {
      const s = Math.sin(this.yaw), c = Math.cos(this.yaw);
      this.tx += (fx * c + fy * s) * sp; this.ty += (-fx * s + fy * c) * sp;
    }
    if (k.has('e') || k.has(']')) this.yaw -= 1.4 * dt;
    if (k.has('q') && false) this.yaw += 1.4 * dt;
    if (k.has('[')) this.yaw += 1.4 * dt;
    if (k.has('PageUp') || k.has('=') || k.has('+')) this.dist = Math.max(0.05, this.dist * (1 - dt * 1.5));
    if (k.has('PageDown') || k.has('-')) this.dist = Math.min(45, this.dist * (1 + dt * 1.5));
  }

  /** Cheap hash of everything that changes how buildings look. */
  gridSignature() {
    const g = G.grid;
    let h = 2166136261;
    for (const arr of [g.zone, g.level, g.special, g.bstyle, g.hcap]) {
      for (let k = 0; k < arr.length; k += 1) { h ^= arr[k] + k * 31; h = Math.imul(h, 16777619); }
    }
    return h >>> 0;
  }

  // -------------------------------------------------------------- layer sync
  sync(now) {
    if (this.world !== G.grid) this.initWorld();
    const netKey = G.net.ver + ':' + (G.netVis || 0);
    let roadsChanged = false;
    if (netKey !== this.netKey) {
      this.netKey = netKey;
      this.roads.rebuild();
      this.buildings.mask = null;
      this.roads.colorize(this.overlay === 'traffic');
      roadsChanged = true;
      this.baseDirty = true;
      this.transitSig = null;
      this.shadowDirty = true;
    }
    const sig = this.transit.signature();
    if (sig !== this.transitSig) { this.transitSig = sig; this.transit.rebuild(); this.vehicles?.rebuild(); }
    // rebuild only when the grid really changed; back off when rebuilds are slow or the view is far
    const interval = Math.max(400, (this.buildMs || 0) * 10, this.dist > 8 ? 1500 : 0);
    if (this.baseDirty && (roadsChanged || now - this.lastBuild > interval)) {
      this.lastBuild = now;
      this.baseDirty = false;
      const gsig = this.gridSignature();
      if (roadsChanged || gsig !== this.gridSig) {
        this.gridSig = gsig;
        const t0 = performance.now();
        this.r2d.drawBase();
        this.terrain.tex.needsUpdate = true;
        this.buildings.rebuild(this.roads.trees);
        this.buildMs = performance.now() - t0;
        this.shadowDirty = true;
      }
      const asig = JSON.stringify(this.airports.footprints());
      if (asig !== this.airportSig) { this.airportSig = asig; this.airports.rebuild(); }
      this.ovDirty = true;
    }
    if (this.ovDirty) {
      this.ovDirty = false;
      const ov = this.overlay;
      if (ov !== 'none' && ov !== 'traffic') { this.r2d.overlay = ov; this.r2d.drawOverlayLayer(); this.terrain.setOverlay(this.r2d.ov); }
      else this.terrain.setOverlay(null);
      this.roads.colorize(ov === 'traffic');
      this.transit.setHighlight(ov === 'coverage' || this.transitTool);
    }
  }

  // -------------------------------------------------------------- frame
  frame(dt) {
    const now = performance.now();
    this.time.value = now / 1000;
    this.keyMove(Math.min(0.1, dt / 1000));
    this.sync(now);
    this.updateCamera();
    if (this.vehicles) { this.vehicles.r3 = this; this.vehicles.update3d(dt, this); }
    // detailed building models in a ring around the view centre
    const nearR = this.dist < 4.5 ? Math.min(1.3, Math.max(0.35, this.dist * 1.15)) : -1;
    if (nearR > 0 && this.buildings.repartition(this.tx, this.ty, nearR)) this.shadowDirty = true;
    else if (this.buildings.lodU.value.z > 0) { this.buildings.lodU.value.z = -1; for (const mm of this.buildings.modelMeshes.values()) mm.count = 0; this.buildings._part = null; }
    this.updateBorders();
    this.airports.update();
    const ck = [this.tx, this.ty, this.dist, this.yaw, this.pitch].map(v => v.toFixed(4)).join();
    if (ck !== this._camKey || this.shadowDirty || roadsDirtyFlag(this)) { this._camKey = ck; this.shadowDirty = false; this.gl.shadowMap.needsUpdate = true; }
    this.updatePreview();
    this.updateSelection();
    this.gl.render(this.scene, this.camera);
    this.updateLabels();
  }

  /** District borders as smooth lines; width follows zoom so they stay a couple of pixels wide. */
  updateBorders() {
    const show = this.dist > 1.2 || this.overlay === 'districts';
    this.borderGroup.visible = show;
    if (!show) return;
    if (this._borderDist && Math.abs(Math.log(this.dist / this._borderDist)) < 0.35) return;
    this._borderDist = this.dist;
    this.clearGroup(this.borderGroup);
    const w = Math.max(0.004, this.dist * 0.0016), H = (x, y) => this.terrain.heightAt(x, y);
    this.borderGroup.add(borderMesh(this.borderLines.inner, H, w, 0xf3eefc, 0.55, 0.006));
    this.borderGroup.add(borderMesh(this.borderLines.outer, H, w * 1.6, 0x6a4fa3, 0.6, 0.006));
  }

  // -------------------------------------------------------------- previews
  hY(x, y, lift = 0.002) { return Math.max(this.terrain.heightAt(x, y), 0) + lift; }
  clearGroup(g) { for (const o of [...g.children]) { g.remove(o); o.geometry?.dispose(); o.material?.dispose(); } }
  lineObj(pts, color, lift = 0.003, dashed = false) {
    const arr = [];
    for (let q = 0; q < pts.length - 1; q++) {
      const [ax, ay] = pts[q], [bx, by] = pts[q + 1];
      const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / 0.05));
      for (let s = 0; s < n; s++) {
        const t0 = s / n, t1 = (s + 1) / n;
        const x0 = ax + (bx - ax) * t0, y0 = ay + (by - ay) * t0, x1 = ax + (bx - ax) * t1, y1 = ay + (by - ay) * t1;
        arr.push(x0, this.hY(x0, y0, lift), y0, x1, this.hY(x1, y1, lift), y1);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3));
    const mat = dashed ? new THREE.LineDashedMaterial({ color, dashSize: 0.01, gapSize: 0.006, depthTest: false }) : new THREE.LineBasicMaterial({ color, depthTest: false });
    const l = new THREE.LineSegments(geo, mat);
    if (dashed) l.computeLineDistances();
    l.renderOrder = 10;
    return l;
  }
  bandObj(pts, widthKm, color, opacity = 0.45, lift = 0.0025) {
    const pos = [], idx = [];
    for (let q = 0; q < pts.length - 1; q++) {
      const [ax, ay] = pts[q], [bx, by] = pts[q + 1];
      const L = Math.hypot(bx - ax, by - ay) || 1, nx = -(by - ay) / L * widthKm / 2, ny = (bx - ax) / L * widthKm / 2;
      const n = Math.max(1, Math.ceil(L / 0.04));
      const base = pos.length / 3;
      for (let s = 0; s <= n; s++) {
        const x = ax + (bx - ax) * s / n, y = ay + (by - ay) * s / n, h = this.hY(x, y, lift);
        pos.push(x + nx, h, y + ny, x - nx, h, y - ny);
        if (s < n) { const v = base + s * 2; idx.push(v, v + 1, v + 2, v + 1, v + 3, v + 2); }
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setIndex(idx);
    const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide }));
    m.renderOrder = 9;
    return m;
  }
  ringObj(x, y, r, color) {
    const m = new THREE.Mesh(new THREE.RingGeometry(r * 0.75, r, 32), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.95, depthTest: false, side: THREE.DoubleSide }));
    m.rotation.x = -Math.PI / 2;
    m.position.set(x, this.hY(x, y, 0.004), y);
    m.renderOrder = 11;
    return m;
  }
  boxObj(x0, y0, x1, y1, color, opacity, height = 0.004) {
    const w = Math.abs(x1 - x0), d = Math.abs(y1 - y0);
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    const geo = new THREE.BoxGeometry(w, height, d);
    const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false }));
    m.position.set(cx, this.hY(cx, cy, height / 2), cy);
    m.renderOrder = 9;
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geo), new THREE.LineBasicMaterial({ color, depthTest: false }));
    edges.position.copy(m.position); edges.renderOrder = 10;
    return [m, edges];
  }

  updatePreview() {
    const p = this.preview;
    if (p === this._lastPreview) return;
    this._lastPreview = p;
    const g = this.previewGroup;
    this.clearGroup(g);
    this.previewLabel = null;
    if (!p) return;
    const px = 1 / Math.max(1e-6, this.cam.scale);   // km per pixel near the view centre
    if (p.poly && p.poly.length > 1) {
      const col = new THREE.Color(p.color || '#333');
      const width = Math.max((p.width || 3) * px, 0.004);
      g.add(this.bandObj(p.poly, width, col, 0.5));
      g.add(this.lineObj(p.poly, 0x111111, 0.004, true));
    }
    if (p.poly) for (const [x, y] of p.poly.slice(0, p.fixed ?? p.poly.length)) g.add(this.ringObj(x, y, 6 * px, 0xffffff));
    if (p.snap) g.add(this.ringObj(p.snap.x, p.snap.y, 10 * px, p.snap.kind === 'node' ? 0x00c853 : p.snap.kind === 'edge' ? 0xffab00 : 0x2962ff));
    if (p.rect) {
      const col = new THREE.Color((p.stroke || '#1565c0').slice(0, 7));
      for (const o of this.boxObj(p.rect[0], p.rect[1], p.rect[2], p.rect[3], col, 0.16, p.height || 0.006)) g.add(o);
    }
    if (p.gridRuns) {
      const segs = p.gridRuns.map(([a, b]) => [[a.x, a.y], [b.x, b.y]]);
      for (const s of segs) g.add(this.lineObj(s, 0xa07a28, 0.004, true));
    }
    if (p.label && p.at) this.previewLabel = p;
  }

  updateSelection() {
    const sel = this.selection;
    const key = sel ? sel.kind + ':' + sel.id + ':' + this.netKey : '';
    if (key === this._selKey) return;
    this._selKey = key;
    const g = this.selGroup;
    this.clearGroup(g);
    if (!sel) return;
    const net = G.net, px = 1 / this.cam.scale;
    if (sel.kind === 'road') {
      for (const e of Object.values(net.edges)) {
        if (e.road !== sel.id) continue;
        const A = net.nodes[e.a], B = net.nodes[e.b];
        const r = net.roads[e.road];
        const w = Math.max(0.03, (r.cfg.lanes * 2 * 3.4 + r.cfg.sidewalk * 2) / 1000 + 0.01);
        const m = this.bandObj([[A.x, A.y], [B.x, B.y]], w, new THREE.Color('#2196f3'), 0.35, (this.roads.nodeY.get(e.a) || 0) - Math.max(this.terrain.heightAt(A.x, A.y), 0) + 0.003);
        g.add(m);
      }
    } else if (sel.kind === 'district') {
      const L = districtLines(G, sel.id), H = (x, y) => this.terrain.heightAt(x, y);
      const w = Math.max(0.008, this.dist * 0.003);
      g.add(borderMesh([...L.inner, ...L.outer], H, w, 0x1e88e5, 0.9, 0.012));
    } else if (sel.kind === 'cell') {
      const gr = G.grid, i = sel.id % gr.w, j = (sel.id / gr.w) | 0;
      for (const o of this.boxObj(i * CELL, j * CELL, (i + 1) * CELL, (j + 1) * CELL, new THREE.Color('#1565c0'), 0.12, 0.01)) g.add(o);
    } else if (sel.kind === 'station') {
      const s = G.transit.stations[sel.id];
      if (s) g.add(this.ringObj(s.x, s.y, 0.03, 0x1565c0));
    } else if (sel.kind === 'line' || sel.kind === 'route') {
      const obj = sel.kind === 'line' ? G.transit.lines[sel.id] : G.transit.routes[sel.id];
      if (obj) {
        let pts;
        if (sel.kind === 'line') pts = obj.stations.map(id => G.transit.stations[id]).filter(Boolean).map(s => [s.x, s.y]);
        else { pts = []; for (const [eid, dir] of obj.path) { const e = net.edges[eid]; if (!e) continue; const A = net.nodes[dir ? e.b : e.a], B = net.nodes[dir ? e.a : e.b]; if (!pts.length) pts.push([A.x, A.y]); pts.push([B.x, B.y]); } }
        g.add(this.bandObj(pts, 0.018, new THREE.Color(obj.color), 0.6, 0.004));
      }
    } else if (sel.kind === 'stop') {
      const st = G.transit.stops[sel.id]; const n = st && net.nodes[st.node];
      if (n) g.add(this.ringObj(n.x, n.y, 0.02, 0x1565c0));
    }
  }

  // -------------------------------------------------------------- labels
  updateLabels() {
    const L = this.labels;
    if (!L) return;
    const items = [];
    const st = G.stats;
    if (this.dist > 3.5) {
      for (const d of G.districts) {
        const [x, y] = this.w2s(d.lx, d.ly, 0.05);
        if (x < -50 || y < -50 || x > this.W + 50 || y > this.H + 50) continue;
        items.push([x, y, `<b>${d.name}</b><i>${d.zh}</i>${st ? `<em>${Math.round(st.districts[d.id].pop / 1000)}K</em>` : ''}`, 'dl']);
      }
    }
    if (this.dist < 2.2) {
      // only the stations nearest the view centre, to avoid clutter
      const cand = [];
      for (const s of Object.values(G.transit.stations)) {
        const [x, y] = this.w2s(s.x, s.y, s.type === 'metro' ? 0.012 : 0.008);
        if (x < 0 || y < 40 || x > this.W || y > this.H) continue;
        cand.push([Math.hypot(x - this.W / 2, y - this.H / 2), x, y, s.name]);
      }
      cand.sort((a, b) => a[0] - b[0]);
      for (const [, x, y, name] of cand.slice(0, this.dist < 0.8 ? 14 : 8)) items.push([x, y, name, 'sl']);
    }
    const p = this.previewLabel;
    if (p) { const [x, y] = this.w2s(p.at[0], p.at[1]); items.push([x + 18, y + 14, p.label, 'pl' + (p.labelColor && p.labelColor !== '#fff' ? ' warn' : '')]); }
    // reuse label elements
    while (L.children.length < items.length) L.appendChild(document.createElement('div'));
    for (let q = 0; q < L.children.length; q++) {
      const el = L.children[q];
      const it = items[q];
      if (!it) { el.style.display = 'none'; continue; }
      el.style.display = '';
      if (el._h !== it[2]) { el.innerHTML = it[2]; el._h = it[2]; }
      if (el.className !== it[3]) el.className = it[3];
      el.style.transform = `translate(${it[0].toFixed(0)}px, ${it[1].toFixed(0)}px)`;
    }
  }
}
