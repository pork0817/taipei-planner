import { CELL, RIVERS, llp } from './data/taipei.js';
import { G } from './state.js';
import { T_OUT, T_LAND, T_WATER, T_MTN, ZONES, SPECIALS, S } from './world.js';
import { ROAD_TYPES, STYLES, BIKE_LANES, roadWidthM } from './roads.js';
import { TRANSIT, routePolyline, stopPos } from './transit.js';
import { MODE_INFO } from './traffic.js';

const BP = 8; // base layer pixels per cell
const ROAD_VIS = 1.7; // roads are drawn wider than true scale so their details stay legible
const FLOORS = [[0, 0], [1, 2], [3, 4], [5, 6], [7, 12], [13, 25], [26, 60]];
const COL = {
  bg: '#cfd8cc', outLand: '#d6dccf', land: '#ebe7d6', water: '#93c6e6', waterDeep: '#86bde0',
};

function hash(k) { let x = (k * 2654435761) >>> 0; x ^= x >>> 13; return (x % 1000) / 1000; }

function shade(hex, f) {
  const n = parseInt(hex.slice(1), 16);
  let r = n >> 16, g = (n >> 8) & 255, b = n & 255;
  if (f < 0) { r *= 1 + f; g *= 1 + f; b *= 1 + f; } else { r += (255 - r) * f; g += (255 - g) * f; b += (255 - b) * f; }
  return `rgb(${r | 0},${g | 0},${b | 0})`;
}
const LEVEL_SHADE = [0.55, 0.25, 0.1, -0.05, -0.18, -0.3, -0.42];

export const OVERLAYS = {
  none: { label: 'None' },
  traffic: { label: 'Traffic', legend: [['#3fbf5a', 'Free flow'], ['#f2d13d', 'Busy (V/C 0.7)'], ['#f08c2e', 'Congested (0.9)'], ['#d9342b', 'Over capacity'], ['#7a1010', 'Gridlock']] },
  density: { label: 'Density', legend: [['#fff5c0', 'Low'], ['#fd8d3c', 'Medium'], ['#bd0026', 'High']] },
  landvalue: { label: 'Land value', legend: [['#2c7bb6', 'Low'], ['#ffffbf', 'Average'], ['#d7191c', 'High']] },
  coverage: { label: 'Transit coverage', legend: [['#8e24aa', 'Metro'], ['#6d4c41', 'Rail'], ['#00acc1', 'Light rail'], ['#1e88e5', 'Bus only'], ['#e0e0e0', 'None']] },
  access: { label: 'Road access', legend: [['#ffffff', 'Street'], ['#ffd27a', 'Avenue'], ['#f08c2e', 'Major road'], ['#e57373', 'No access']] },
  districts: { label: 'Districts', legend: [] },
  modal: { label: 'Green trips', legend: [['#d73027', '<30%'], ['#fee08b', '50%'], ['#1a9850', '>70%']] },
};

function ramp(stops, t) {
  t = Math.max(0, Math.min(1, t));
  for (let i = 1; i < stops.length; i++) {
    if (t <= stops[i][0]) {
      const [t0, c0] = stops[i - 1], [t1, c1] = stops[i];
      const f = (t - t0) / (t1 - t0);
      return [0, 1, 2].map(q => Math.round(c0[q] + (c1[q] - c0[q]) * f));
    }
  }
  return stops[stops.length - 1][1];
}
const RAMP_DENS = [[0, [255, 245, 192]], [0.5, [253, 141, 60]], [1, [189, 0, 38]]];
const RAMP_LV = [[0, [44, 123, 182]], [0.5, [255, 255, 191]], [1, [215, 25, 28]]];
const RAMP_GREEN = [[0, [215, 48, 39]], [0.5, [254, 224, 139]], [1, [26, 152, 80]]];

export function vcColor(vc) {
  if (vc < 0.5) return '#3fbf5a';
  if (vc < 0.75) return '#a5cf3a';
  if (vc < 0.9) return '#f2d13d';
  if (vc < 1.0) return '#f08c2e';
  if (vc < 1.25) return '#d9342b';
  return '#7a1010';
}

export class Renderer {
  constructor(canvas) {
    this.cv = canvas;
    this.ctx = canvas.getContext('2d');
    this.cam = { x: 11.5, y: 15.5, scale: 30 };
    this.base = document.createElement('canvas');
    this.ov = document.createElement('canvas');
    this.baseDirty = true; this.ovDirty = true;
    this.overlay = 'none';
    this.dpr = window.devicePixelRatio || 1;
    this.preview = null;          // set by UI tools
    this.selection = null;
    this.hover = null;
    this.vehicles = null;
    this.resize();
  }
  resize() {
    const r = this.cv.getBoundingClientRect();
    this.dpr = window.devicePixelRatio || 1;
    this.W = r.width; this.H = r.height;
    this.cv.width = Math.round(r.width * this.dpr); this.cv.height = Math.round(r.height * this.dpr);
  }
  w2s(x, y) { const c = this.cam; return [(x - c.x) * c.scale + this.W / 2, (y - c.y) * c.scale + this.H / 2]; }
  s2w(px, py) { const c = this.cam; return [(px - this.W / 2) / c.scale + c.x, (py - this.H / 2) / c.scale + c.y]; }
  zoomAt(px, py, f) {
    const [wx, wy] = this.s2w(px, py);
    this.cam.scale = Math.max(14, Math.min(900, this.cam.scale * f));
    const [nx, ny] = this.s2w(px, py);
    this.cam.x += wx - nx; this.cam.y += wy - ny;
  }
  fit() {
    const g = G.grid;
    this.cam.x = g.w * CELL / 2; this.cam.y = g.h * CELL / 2 + 0.5;
    this.cam.scale = Math.min(this.W / (g.w * CELL), this.H / (g.h * CELL)) * 1.05;
  }

  // ------------------------------------------------ base layer
  drawBase() {
    const g = G.grid;
    const c = this.base;
    if (c.width !== g.w * BP) { c.width = g.w * BP; c.height = g.h * BP; }
    const x = c.getContext('2d');
    for (let k = 0; k < g.n; k++) {
      const i = k % g.w, j = (k / g.w) | 0;
      x.fillStyle = this.cellColor(k);
      x.fillRect(i * BP, j * BP, BP, BP);
    }
    this.baseDirty = false;
  }
  cellColor(k) {
    const g = G.grid, t = g.terrain[k];
    if (t === T_WATER) return this.groundMode ? (hash(k) < 0.5 ? '#9fb57f' : '#9ab17a') : COL.water;
    if (t === T_OUT) return this.groundMode ? (hash(k) < 0.5 ? '#a9b98d' : '#a4b588') : (hash(k) < 0.5 ? '#d3d9cb' : '#d0d7c8');
    const s = g.special[k];
    const z = g.zone[k], l = g.level[k];
    if (this.groundMode) {
      // 3D ground texture: buildings are real meshes, so only paint the ground
      if (s === S.PARK) return hash(k) < 0.5 ? '#7fb36a' : '#78ad63';
      if (s === S.AIRPORT) return '#8ea86e';
      if (s) return '#d9d4ca';
      if (z) {
        if (!l) return ZONES[z].ground;                 // zoned but empty: show the zone colour
        const zc = parseInt(ZONES[z].ground.slice(1), 16), pv = l >= 3 ? [168, 166, 160] : [178, 176, 162];
        const mix = (q, sh) => Math.round(pv[q] * 0.8 + ((zc >> sh) & 255) * 0.2);
        return `rgb(${mix(0, 16)},${mix(1, 8)},${mix(2, 0)})`;
      }
      // hills use the normal ground colour: the terrain shader darkens forest smoothly by height
      const h = hash(k);
      return h < 0.5 ? '#b9c98f' : '#b2c488';
    }
    if (s) return SPECIALS[s].color;
    if (z) return l ? shade(ZONES[z].color, LEVEL_SHADE[l]) : ZONES[z].ground;
    if (t === T_MTN) { const h = hash(k); return h < 0.33 ? '#9fbf8a' : h < 0.66 ? '#a7c492' : '#98b884'; }
    const h = hash(k);
    return h < 0.5 ? '#e7e6cf' : '#e3e4c9';
  }

  drawOverlayLayer() {
    const g = G.grid;
    const c = this.ov;
    if (c.width !== g.w) { c.width = g.w; c.height = g.h; }
    const x = c.getContext('2d');
    const img = x.createImageData(g.w, g.h);
    const d = img.data;
    const ov = this.overlay;
    const st = G.stats;
    let maxD = 1;
    if (ov === 'density') for (let k = 0; k < g.n; k++) maxD = Math.max(maxD, g.pop[k] + g.jobs[k]);
    for (let k = 0; k < g.n; k++) {
      let rgb = null, a = 0;
      if (g.district[k] < 0) { d[k * 4 + 3] = 0; continue; }
      if (ov === 'density') { const v = g.pop[k] + g.jobs[k]; if (v > 0) { rgb = ramp(RAMP_DENS, Math.sqrt(v / Math.min(maxD, 6000))); a = 200; } }
      else if (ov === 'landvalue') { rgb = ramp(RAMP_LV, (g.lv[k] - 0.6) / 2.2); a = 170; }
      else if (ov === 'coverage') {
        const cv = g.cov[k];
        rgb = cv & 2 ? [142, 36, 170] : cv & 8 ? [109, 76, 65] : cv & 4 ? [0, 172, 193] : cv & 1 ? [30, 136, 229] : [210, 210, 210];
        a = cv ? 150 : 90;
      } else if (ov === 'access') {
        const ac = g.access[k];
        rgb = ac === 0 ? [229, 115, 115] : ac === 1 ? [255, 255, 255] : ac === 2 ? [255, 210, 122] : [240, 140, 46];
        a = ac ? 120 : (g.zone[k] ? 200 : 60);
      } else if (ov === 'districts') { const col = G.districts[g.district[k]].color; rgb = [1, 3, 5].map(q => parseInt(col.slice(q, q + 2), 16)); a = 130; }
      else if (ov === 'modal' && st) { const ds = st.districts[g.district[k]]; const sus = ds ? ['walk', 'bike', 'bus', 'metro', 'lrt', 'rail'].reduce((s, m) => s + ds.modal[m], 0) : 0; rgb = ramp(RAMP_GREEN, (sus - 0.3) / 0.4); a = 140; }
      if (rgb) { d[k * 4] = rgb[0]; d[k * 4 + 1] = rgb[1]; d[k * 4 + 2] = rgb[2]; d[k * 4 + 3] = a; }
    }
    x.putImageData(img, 0, 0);
    this.ovDirty = false;
  }

  // ------------------------------------------------ frame
  frame(dt) {
    const ctx = this.ctx, cam = this.cam, s = cam.scale;
    if (this.baseDirty) this.drawBase();
    if (this.ovDirty && this.overlay !== 'none' && this.overlay !== 'traffic') this.drawOverlayLayer();
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = COL.bg;
    ctx.fillRect(0, 0, this.W, this.H);
    const g = G.grid;
    const [ox, oy] = this.w2s(0, 0);
    const cellPx = CELL * s;
    ctx.imageSmoothingEnabled = cellPx < BP;
    ctx.drawImage(this.base, ox, oy, g.w * cellPx, g.h * cellPx);
    this.drawRivers();
    if (cellPx >= 14) this.drawBuildings(cellPx);
    if (this.overlay !== 'none' && this.overlay !== 'traffic') {
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(this.ov, ox, oy, g.w * cellPx, g.h * cellPx);
    }
    this.drawBoundaries();
    if (cellPx >= 14) this.drawAirportRunways(cellPx);
    this.drawRoads();
    this.drawTransit();
    if (this.vehicles) this.vehicles.draw(ctx, this, dt);
    this.drawSelection();
    this.drawPreview();
    this.drawLabels();
  }

  visibleCells() {
    const g = G.grid;
    const [x0, y0] = this.s2w(0, 0), [x1, y1] = this.s2w(this.W, this.H);
    return [Math.max(0, Math.floor(x0 / CELL)), Math.max(0, Math.floor(y0 / CELL)), Math.min(g.w - 1, Math.floor(x1 / CELL)), Math.min(g.h - 1, Math.floor(y1 / CELL))];
  }

  drawRivers() {
    const ctx = this.ctx;
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    ctx.strokeStyle = COL.water;
    for (const r of RIVERS) {
      ctx.lineWidth = Math.max(r.cells ? 3 : 1.2, r.width * this.cam.scale);
      ctx.beginPath();
      r.pts.forEach((p, i) => { const [x, y] = llp(p); const [sx, sy] = this.w2s(x, y); i ? ctx.lineTo(sx, sy) : ctx.moveTo(sx, sy); });
      ctx.stroke();
    }
  }

  drawBuildings(cellPx) {
    const ctx = this.ctx, g = G.grid;
    const [i0, j0, i1, j1] = this.visibleCells();
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const k = j * g.w + i;
      const l = g.level[k], z = g.zone[k], sp = g.special[k];
      const [sx, sy] = this.w2s(i * CELL, j * CELL);
      if (sp && sp !== S.AIRPORT) { this.drawSpecial(sp, sx, sy, cellPx, k); continue; }
      if (!z) continue;
      // ground
      ctx.fillStyle = ZONES[z].ground;
      ctx.fillRect(sx, sy, cellPx + 0.5, cellPx + 0.5);
      if (!l) continue;
      const col = ZONES[z].color;
      const h = hash(k);
      const blocks = l <= 2 ? 4 : l <= 3 ? 2 : 1;
      const n = Math.sqrt(blocks) | 0 || 1;
      const pad = cellPx * 0.08;
      const bw = (cellPx - pad * (n + 1)) / n;
      const lift = Math.min(cellPx * 0.25, l * cellPx * 0.035);
      for (let a = 0; a < n; a++) for (let b = 0; b < n; b++) {
        const bh = hash(k * 7 + a * 3 + b);
        const w = bw * (0.75 + 0.25 * bh), hgt = bw * (0.75 + 0.25 * hash(k * 13 + a + b * 5));
        const x = sx + pad + a * (bw + pad), y = sy + pad + b * (bw + pad);
        ctx.fillStyle = 'rgba(0,0,0,0.18)';
        ctx.fillRect(x + lift, y + lift, w, hgt);
        ctx.fillStyle = shade(col, LEVEL_SHADE[l] + (bh - 0.5) * 0.12);
        ctx.fillRect(x, y, w, hgt);
        if (cellPx > 40) {
          ctx.fillStyle = shade(col, LEVEL_SHADE[l] + 0.25);
          ctx.fillRect(x + w * 0.15, y + hgt * 0.15, w * 0.7, hgt * 0.08);
        }
      }
      if (cellPx > 60 && l >= 4) {
        ctx.fillStyle = 'rgba(255,255,255,0.8)';
        ctx.font = `${Math.min(14, cellPx / 6)}px system-ui`;
        const [f0, f1] = FLOORS[l];
        ctx.fillText(`${f0 + Math.round(h * (f1 - f0))}F`, sx + 4, sy + cellPx - 4);
      }
    }
  }

  drawSpecial(sp, sx, sy, cellPx, k) {
    const ctx = this.ctx;
    ctx.fillStyle = SPECIALS[sp].color;
    ctx.fillRect(sx, sy, cellPx + 0.5, cellPx + 0.5);
    if (sp === S.PARK) {
      ctx.fillStyle = '#4f9a45';
      for (let q = 0; q < 6; q++) {
        const tx = sx + cellPx * (0.15 + 0.7 * hash(k * 11 + q)), ty = sy + cellPx * (0.15 + 0.7 * hash(k * 17 + q));
        ctx.beginPath(); ctx.arc(tx, ty, cellPx * 0.08, 0, 7); ctx.fill();
      }
    } else {
      ctx.fillStyle = 'rgba(0,0,0,0.2)';
      ctx.fillRect(sx + cellPx * 0.22, sy + cellPx * 0.22, cellPx * 0.6, cellPx * 0.6);
      ctx.fillStyle = shade(SPECIALS[sp].color, 0.3);
      ctx.fillRect(sx + cellPx * 0.18, sy + cellPx * 0.18, cellPx * 0.6, cellPx * 0.6);
      if (cellPx > 24) {
        ctx.fillStyle = '#333';
        ctx.font = `bold ${Math.min(18, cellPx * 0.35)}px system-ui`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText({ 2: '✎', 3: '✚', 4: '🏮', 6: '🎓' }[sp] || '', sx + cellPx * 0.48, sy + cellPx * 0.5);
        ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
      }
    }
  }

  drawAirportRunways(cellPx) {
    const ctx = this.ctx, g = G.grid;
    // runway along the middle row of each contiguous airport row band
    const rows = {};
    for (let k = 0; k < g.n; k++) if (g.special[k] === S.AIRPORT) {
      const j = (k / g.w) | 0, i = k % g.w;
      (rows[j] ||= [Infinity, -Infinity]);
      rows[j][0] = Math.min(rows[j][0], i); rows[j][1] = Math.max(rows[j][1], i);
    }
    const js = Object.keys(rows).map(Number).sort((a, b) => a - b);
    if (!js.length) return;
    ctx.strokeStyle = '#555'; ctx.lineWidth = Math.max(3, cellPx * 0.35);
    for (let q = 0; q < js.length; q += 2) {
      const j = js[q], [i0, i1] = rows[j];
      const y = (j + (js[q + 1] === j + 1 ? 1 : 0.5)) * CELL;
      const [ax, ay] = this.w2s((i0 + 0.3) * CELL, y), [bx, by] = this.w2s((i1 + 0.7) * CELL, y);
      ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
      ctx.save(); ctx.strokeStyle = '#fff'; ctx.lineWidth = 1; ctx.setLineDash([8, 8]);
      ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke(); ctx.restore();
    }
  }

  drawBoundaries() {
    const ctx = this.ctx;
    ctx.save();
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.strokeStyle = 'rgba(90,70,120,0.45)';
    ctx.setLineDash([4, 3]);
    for (const [x0, y0, x1, y1, outer] of G.boundarySegs) {
      if (outer) continue;
      const [a, b] = this.w2s(x0, y0), [c, d] = this.w2s(x1, y1);
      ctx.moveTo(a, b); ctx.lineTo(c, d);
    }
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(70,50,100,0.65)';
    for (const [x0, y0, x1, y1, outer] of G.boundarySegs) {
      if (!outer) continue;
      const [a, b] = this.w2s(x0, y0), [c, d] = this.w2s(x1, y1);
      ctx.moveTo(a, b); ctx.lineTo(c, d);
    }
    ctx.stroke();
    ctx.restore();
  }

  roadPx(r) {
    const T = ROAD_TYPES[r.type];
    const zoomF = Math.max(0.75, Math.min(1.8, this.cam.scale / 50));
    return Math.max(T.minPx * zoomF, roadWidthM(r.type, r.cfg) / 1000 * this.cam.scale * ROAD_VIS);
  }

  drawRoads() {
    const ctx = this.ctx, net = G.net, s = this.cam.scale;
    const edges = Object.values(net.edges);
    const [vx0, vy0] = this.s2w(-50, -50), [vx1, vy1] = this.s2w(this.W + 50, this.H + 50);
    const vis = [];
    for (const e of edges) {
      const A = net.nodes[e.a], B = net.nodes[e.b];
      if (Math.max(A.x, B.x) < vx0 || Math.min(A.x, B.x) > vx1 || Math.max(A.y, B.y) < vy0 || Math.min(A.y, B.y) > vy1) continue;
      vis.push(e);
    }
    vis.sort((a, b) => ROAD_TYPES[net.roads[a.road].type].rank - ROAD_TYPES[net.roads[b.road].type].rank);
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    const traffic = this.overlay === 'traffic';
    const detail = s > 120;
    // casing pass then fill pass
    for (let pass = 0; pass < 2; pass++) {
      for (const e of vis) {
        const r = net.roads[e.road], T = ROAD_TYPES[r.type];
        const A = net.nodes[e.a], B = net.nodes[e.b];
        const [ax, ay] = this.w2s(A.x, A.y), [bx, by] = this.w2s(B.x, B.y);
        const w = this.roadPx(r);
        ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by);
        if (pass === 0) {
          ctx.strokeStyle = e.water > 0.3 ? '#6d6d6d' : T.casing;
          ctx.lineWidth = w + (w > 3 ? 2 : 1.2);
          ctx.stroke();
        } else {
          let col = T.fill;
          if (traffic && r.type !== 'pedestrian') col = vcColor(Math.max(e.vc?.[0] || 0, e.vc?.[1] || 0));
          ctx.strokeStyle = col;
          ctx.lineWidth = w;
          ctx.stroke();
          if (detail) this.drawRoadDetail(e, r, ax, ay, bx, by, w);
        }
      }
    }
    // intersections with signals
    if (s > 220) {
      for (const e of vis) {
        const r = net.roads[e.road];
        if (!r.cfg.signal.on) continue;
        for (const nid of [e.a, e.b]) {
          const n = net.nodes[nid];
          if ((n.deg || 0) < 3) continue;
          const [x, y] = this.w2s(n.x, n.y);
          ctx.fillStyle = '#222'; ctx.fillRect(x - 3, y - 3, 6, 6);
          ctx.fillStyle = (Math.floor(performance.now() / 1000 / (r.cfg.signal.cycle / 20)) % 2) ? '#4caf50' : '#e53935';
          ctx.beginPath(); ctx.arc(x, y, 2, 0, 7); ctx.fill();
        }
      }
    }
  }

  drawRoadDetail(e, r, ax, ay, bx, by, w) {
    const ctx = this.ctx, c = r.cfg, s = this.cam.scale;
    const len = Math.hypot(bx - ax, by - ay) || 1;
    const nx = -(by - ay) / len, ny = (bx - ax) / len;
    const line = (off, col, lw, dash) => {
      ctx.save();
      ctx.strokeStyle = col; ctx.lineWidth = lw;
      if (dash) ctx.setLineDash(dash);
      ctx.beginPath(); ctx.moveTo(ax + nx * off, ay + ny * off); ctx.lineTo(bx + nx * off, by + ny * off); ctx.stroke();
      ctx.restore();
    };
    const m = s / 1000 * ROAD_VIS;  // px per metre (display scale)
    const half = w / 2;
    if (r.type === 'pedestrian') { line(0, 'rgba(180,130,90,0.5)', 1, [2, 4]); return; }
    // sidewalks
    if (c.sidewalk > 0) {
      const sw = c.sidewalk * m;
      line(half - sw / 2, c.arcade ? '#e0cfb5' : '#e8e2d6', sw);
      line(-half + sw / 2, c.arcade ? '#e0cfb5' : '#e8e2d6', sw);
      if (c.trees && sw > 2) { line(half - sw * 0.8, '#5fa055', Math.max(1.5, sw * 0.35), [2, 6]); line(-half + sw * 0.8, '#5fa055', Math.max(1.5, sw * 0.35), [2, 6]); }
    }
    const bl = BIKE_LANES[c.bikeLane];
    const sw = c.sidewalk * m;
    if (bl.w) {
      const bw = Math.max(1.2, bl.w * m);
      const col = STYLES[c.style].bikeColor;
      line(half - sw - bw / 2, col, bw);
      if (!c.oneWay) line(-half + sw + bw / 2, col, bw);
    }
    if (c.busLane) {
      const bw = Math.max(1.2, 3.3 * m);
      const off = half - sw - bl.w * m - bw / 2;
      line(off, 'rgba(200,60,40,0.55)', bw);
      if (!c.oneWay) line(-off, 'rgba(200,60,40,0.55)', bw);
    }
    if (!c.oneWay) line(0, r.type === 'expressway' || r.type === 'highway' ? '#f5f5f5' : (c.style === 'US' ? '#f2c230' : c.style === 'NL' ? '#ffffff' : '#ffffff'), 1, c.style === 'US' ? null : [6, 6]);
    else {
      // arrow for one-way
      const mx = (ax + bx) / 2, my = (ay + by) / 2, dx = (bx - ax) / len, dy = (by - ay) / len;
      ctx.fillStyle = '#555';
      ctx.beginPath(); ctx.moveTo(mx + dx * 6, my + dy * 6); ctx.lineTo(mx - dx * 4 + nx * 4, my - dy * 4 + ny * 4); ctx.lineTo(mx - dx * 4 - nx * 4, my - dy * 4 - ny * 4); ctx.fill();
    }
  }

  drawTransit() {
    const ctx = this.ctx, T = G.transit, s = this.cam.scale;
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    // bus routes
    if (s > 22) {
      let off = 0;
      for (const r of Object.values(T.routes)) {
        const pts = routePolyline(G, r);
        if (pts.length < 2) continue;
        const sel = this.selection?.kind === 'route' && this.selection.id === r.id;
        ctx.strokeStyle = r.broken ? '#999' : r.color;
        ctx.globalAlpha = sel ? 1 : 0.75;
        ctx.lineWidth = sel ? 4 : 2;
        const o = ((off++ % 4) - 1.5) * 1.6;
        ctx.beginPath();
        pts.forEach(([x, y], i) => { const [sx, sy] = this.w2s(x, y); i ? ctx.lineTo(sx + o, sy + o) : ctx.moveTo(sx + o, sy + o); });
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      if (s > 70) {
        const used = new Set();
        for (const r of Object.values(T.routes)) r.stops.forEach(x => used.add(x));
        for (const st of Object.values(T.stops)) {
          const p = stopPos(G, st);
          if (!p) continue;
          const [x, y] = this.w2s(p.x, p.y);
          ctx.fillStyle = used.has(st.id) ? '#1e88e5' : '#90a4ae';
          ctx.fillRect(x - 3, y - 3, 6, 6);
          ctx.strokeStyle = '#fff'; ctx.lineWidth = 1; ctx.strokeRect(x - 3, y - 3, 6, 6);
        }
      }
    }
    // rail lines
    const order = { rail: 0, lrt: 1, metro: 2 };
    const lines = Object.values(T.lines).sort((a, b) => order[a.type] - order[b.type]);
    for (const l of lines) {
      const pts = l.stations.map(id => T.stations[id]).filter(Boolean);
      if (pts.length < 2) continue;
      const sel = this.selection?.kind === 'line' && this.selection.id === l.id;
      const path = () => { ctx.beginPath(); pts.forEach((p, i) => { const [x, y] = this.w2s(p.x, p.y); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }); };
      const base = l.type === 'metro' ? 4 : l.type === 'lrt' ? 3 : 3.5;
      const w = Math.max(base, Math.min(10, s / 40 * (l.type === 'metro' ? 1.2 : 0.9))) + (sel ? 3 : 0);
      if (sel) { path(); ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.lineWidth = w + 5; ctx.stroke(); }
      if (l.type === 'rail') {
        path(); ctx.strokeStyle = '#333'; ctx.lineWidth = w; ctx.stroke();
        path(); ctx.strokeStyle = l.color === '#455a64' || l.color === '#8d6e63' ? '#fff' : l.color; ctx.lineWidth = w - 1.6; ctx.setLineDash([6, 6]); ctx.stroke(); ctx.setLineDash([]);
      } else if (l.type === 'lrt') {
        path(); ctx.strokeStyle = '#fff'; ctx.lineWidth = w + 1.5; ctx.stroke();
        path(); ctx.strokeStyle = l.color; ctx.lineWidth = w - 0.5; ctx.stroke();
      } else {
        path(); ctx.strokeStyle = l.elevated ? '#555' : '#fff'; ctx.lineWidth = w + 2; ctx.stroke();
        path(); ctx.strokeStyle = l.color; ctx.lineWidth = w; ctx.stroke();
      }
    }
    // stations
    const lineCount = {};
    for (const l of lines) for (const sid of l.stations) lineCount[sid] = (lineCount[sid] || 0) + 1;
    for (const st of Object.values(T.stations)) {
      const [x, y] = this.w2s(st.x, st.y);
      if (x < -20 || y < -20 || x > this.W + 20 || y > this.H + 20) continue;
      const n = lineCount[st.id] || 0;
      const r = (st.type === 'metro' ? 4 : st.type === 'rail' ? 3.6 : 3) * (s > 80 ? 1.4 : 1) + (n > 1 ? 1.5 : 0);
      ctx.fillStyle = n ? '#fff' : '#ddd';
      ctx.strokeStyle = n > 1 ? '#111' : st.type === 'rail' ? '#333' : st.type === 'lrt' ? '#00838f' : '#4a148c';
      ctx.lineWidth = n > 1 ? 2.2 : 1.6;
      ctx.beginPath();
      if (st.type === 'rail') ctx.rect(x - r, y - r, 2 * r, 2 * r); else ctx.arc(x, y, r, 0, 7);
      ctx.fill(); ctx.stroke();
      if (s > 75) {
        ctx.font = '600 11px system-ui';
        ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(255,255,255,0.9)';
        ctx.strokeText(st.name, x + r + 3, y - r - 1);
        ctx.fillStyle = '#222'; ctx.fillText(st.name, x + r + 3, y - r - 1);
      }
    }
  }

  drawSelection() {
    const sel = this.selection, ctx = this.ctx;
    if (!sel) return;
    ctx.save();
    if (sel.kind === 'road') {
      const net = G.net;
      ctx.strokeStyle = 'rgba(0,140,255,0.55)'; ctx.lineCap = 'round';
      const r = net.roads[sel.id];
      if (r) {
        ctx.lineWidth = this.roadPx(r) + 8;
        ctx.beginPath();
        for (const e of Object.values(net.edges)) {
          if (e.road !== sel.id) continue;
          const A = net.nodes[e.a], B = net.nodes[e.b];
          const [ax, ay] = this.w2s(A.x, A.y), [bx, by] = this.w2s(B.x, B.y);
          ctx.moveTo(ax, ay); ctx.lineTo(bx, by);
        }
        ctx.stroke();
      }
    } else if (sel.kind === 'district') {
      ctx.strokeStyle = '#1565c0'; ctx.lineWidth = 3;
      const g = G.grid;
      ctx.beginPath();
      for (let k = 0; k < g.n; k++) {
        if (g.district[k] !== sel.id) continue;
        const i = k % g.w, j = (k / g.w) | 0;
        const nb = [[i - 1, j, 0], [i + 1, j, 1], [i, j - 1, 2], [i, j + 1, 3]];
        for (const [a, b, side] of nb) {
          const o = (a < 0 || b < 0 || a >= g.w || b >= g.h) ? -1 : g.district[b * g.w + a];
          if (o === sel.id) continue;
          let x0, y0, x1, y1;
          if (side === 0) { x0 = i; y0 = j; x1 = i; y1 = j + 1; }
          else if (side === 1) { x0 = i + 1; y0 = j; x1 = i + 1; y1 = j + 1; }
          else if (side === 2) { x0 = i; y0 = j; x1 = i + 1; y1 = j; }
          else { x0 = i; y0 = j + 1; x1 = i + 1; y1 = j + 1; }
          const [p, q] = this.w2s(x0 * CELL, y0 * CELL), [u, v] = this.w2s(x1 * CELL, y1 * CELL);
          ctx.moveTo(p, q); ctx.lineTo(u, v);
        }
      }
      ctx.stroke();
    } else if (sel.kind === 'cell') {
      const g = G.grid, i = sel.id % g.w, j = (sel.id / g.w) | 0;
      const [x, y] = this.w2s(i * CELL, j * CELL);
      ctx.strokeStyle = '#1565c0'; ctx.lineWidth = 2.5;
      ctx.strokeRect(x, y, CELL * this.cam.scale, CELL * this.cam.scale);
    } else if (sel.kind === 'station') {
      const st = G.transit.stations[sel.id];
      if (st) { const [x, y] = this.w2s(st.x, st.y); ctx.strokeStyle = '#1565c0'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(x, y, 11, 0, 7); ctx.stroke(); }
    } else if (sel.kind === 'stop') {
      const st = G.transit.stops[sel.id];
      const p = st && stopPos(G, st);
      if (p) { const [x, y] = this.w2s(p.x, p.y); ctx.strokeStyle = '#1565c0'; ctx.lineWidth = 3; ctx.strokeRect(x - 8, y - 8, 16, 16); }
    }
    ctx.restore();
  }

  drawPreview() {
    const p = this.preview, ctx = this.ctx;
    if (!p) return;
    ctx.save();
    if (p.poly && p.poly.length) {
      ctx.strokeStyle = p.color || 'rgba(30,30,30,0.8)'; ctx.lineWidth = p.width || 3; ctx.setLineDash([8, 5]); ctx.lineCap = 'round';
      ctx.beginPath();
      p.poly.forEach(([x, y], i) => { const [sx, sy] = this.w2s(x, y); i ? ctx.lineTo(sx, sy) : ctx.moveTo(sx, sy); });
      ctx.stroke(); ctx.setLineDash([]);
      for (const [x, y] of p.poly.slice(0, p.fixed ?? p.poly.length)) {
        const [sx, sy] = this.w2s(x, y);
        ctx.fillStyle = '#fff'; ctx.strokeStyle = '#333'; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(sx, sy, 4, 0, 7); ctx.fill(); ctx.stroke();
      }
    }
    if (p.snap) {
      const [sx, sy] = this.w2s(p.snap.x, p.snap.y);
      ctx.strokeStyle = p.snap.kind === 'node' ? '#00c853' : p.snap.kind === 'edge' ? '#ffab00' : '#2962ff';
      ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.arc(sx, sy, 8, 0, 7); ctx.stroke();
    }
    if (p.rect) {
      const [x0, y0] = this.w2s(p.rect[0], p.rect[1]), [x1, y1] = this.w2s(p.rect[2], p.rect[3]);
      ctx.fillStyle = p.fill || 'rgba(33,150,243,0.25)';
      ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
      ctx.strokeStyle = p.stroke || '#1565c0'; ctx.lineWidth = 1.5;
      ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);
    }
    if (p.gridRuns) {
      ctx.strokeStyle = 'rgba(160,120,40,0.85)'; ctx.lineWidth = 2; ctx.setLineDash([5, 4]);
      ctx.beginPath();
      for (const [a, b] of p.gridRuns) { const [x0, y0] = this.w2s(a.x, a.y), [x1, y1] = this.w2s(b.x, b.y); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); }
      ctx.stroke(); ctx.setLineDash([]);
    }
    if (p.label && p.at) {
      const [sx, sy] = this.w2s(p.at[0], p.at[1]);
      ctx.font = '600 12px system-ui';
      const w = ctx.measureText(p.label).width + 12;
      ctx.fillStyle = 'rgba(20,24,33,0.85)';
      ctx.fillRect(sx + 14, sy + 10, w, 22);
      ctx.fillStyle = p.labelColor || '#fff';
      ctx.fillText(p.label, sx + 20, sy + 25);
    }
    ctx.restore();
  }

  drawLabels() {
    const ctx = this.ctx, s = this.cam.scale;
    if (s > 110) return;
    ctx.save();
    ctx.textAlign = 'center';
    const st = G.stats;
    for (const d of G.districts) {
      const [x, y] = this.w2s(d.lx, d.ly);
      ctx.font = `700 ${s < 40 ? 12 : 14}px system-ui`;
      ctx.lineWidth = 3.5; ctx.strokeStyle = 'rgba(255,255,255,0.85)';
      ctx.strokeText(d.name, x, y); ctx.fillStyle = '#3a2d55'; ctx.fillText(d.name, x, y);
      ctx.font = `600 ${s < 40 ? 11 : 12}px system-ui`;
      ctx.strokeText(d.zh, x, y + 14); ctx.fillStyle = '#5b4a7d'; ctx.fillText(d.zh, x, y + 14);
      if (st && s >= 30) {
        const ds = st.districts[d.id];
        const t = `${(ds.pop / 1000).toFixed(0)}K`;
        ctx.font = '500 11px system-ui';
        ctx.strokeText(t, x, y + 27); ctx.fillStyle = '#555'; ctx.fillText(t, x, y + 27);
      }
    }
    ctx.restore();
  }
}
