import { G, bus, fmt, MONTHS, clamp } from './state.js';
import { CELL, DEMAND, interp } from './data/taipei.js';
import { ZONES, SPECIALS, S, Z, T_WATER, T_MTN, T_LAND, buildable, cellAt, cellX, cellY } from './world.js';
import {
  ROAD_TYPES, STYLES, BIKE_LANES, defaultCfg, costPerKm, terrainMult, nearestNode, nearestEdge, buildRoad, removeEdge,
  cleanupNodes, roadEdges, roadLength, splitEdge, roadWidthM,
} from './roads.js';
import {
  TRANSIT, LINE_COLORS, addStation, addLine, lineLength, lineVehicles, lineCapacity, trackCostPerKm, addStop, addRoute,
  computeRoutePath, removeStation, stationLines, stopPos,
} from './transit.js';
import { MODES, MODE_INFO, SUSTAINABLE } from './traffic.js';
import {
  newGame, spend, afterNetworkChange, requestAssess, refreshDerived, news, CAP, cellCaps, maxLevelFor, eraMaxLevel, annualOps,
  computeScore, runAssessment, economy, wageIndex,
} from './sim.js';
import { OVERLAYS, vcColor } from './render.js';
import { lineChart, stackedArea, shareBar } from './charts.js';
import { saveGame, loadGame, hasSave } from './save.js';
import { BSTYLES, styleIndex as styleIdx } from './bstyles.js';

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const MODE_COLORS = Object.fromEntries(MODES.map(m => [m, MODE_INFO[m].color]));
const MODE_LABELS = Object.fromEntries(MODES.map(m => [m, MODE_INFO[m].label]));

export const UI = {
  tool: 'inspect',
  road: { type: 'avenue', style: 'JP', cfg: defaultCfg('avenue', 'JP'), pts: [] },
  zone: { z: Z.R, brush: 3, hcap: 0, bstyle: 0 },
  build: { s: S.PARK },
  transit: { draft: null, headway: null, elevated: false },
  sel: null,
};
let R, V;   // renderer, vehicles

const TOOLS = [
  { id: 'inspect', icon: '🔍', label: 'Inspect', key: 'q' },
  { id: 'road', icon: '🛣️', label: 'Roads', key: 'r' },
  { id: 'zone', icon: '▦', label: 'Zoning', key: 'z' },
  { id: 'build', icon: '🏛️', label: 'Buildings', key: 'b' },
  { id: 'bus', icon: '🚌', label: 'Bus', key: 'u' },
  { id: 'metro', icon: 'Ⓜ️', label: 'Metro', key: 'm' },
  { id: 'lrt', icon: '🚋', label: 'Light rail', key: 'l' },
  { id: 'rail', icon: '🚆', label: 'Rail', key: 't' },
  { id: 'bulldoze', icon: '🧨', label: 'Bulldoze', key: 'x' },
];

export function initUI(renderer, vehicles) {
  R = renderer; V = vehicles;
  buildToolbar();
  buildOverlayBar();
  bindMap();
  bindTopbar();
  bindKeys();
  bus.on('tick', () => { updateTopbar(); if (UI.tool === 'zone') renderDemand(); });
  bus.on('assessed', () => { updateTopbar(); refreshInspectorStats(); V.rebuild(); R.ovDirty = true; if ($('#modal').classList.contains('open')) renderStats(); });
  bus.on('cells', () => { R.baseDirty = true; R.ovDirty = true; });
  bus.on('news', item => toast(item.text, item.kind));
  bus.on('speed', () => updateSpeedButtons());
  setTool('inspect');
}

// ===================================================================== topbar
function bindTopbar() {
  $$('#speed button').forEach(b => b.onclick = () => { G.speed = +b.dataset.speed; updateSpeedButtons(); });
  $('#btn-stats').onclick = () => openStats();
  $('#btn-save').onclick = () => { saveGame(); toast('Game saved to this browser.', 'good'); };
  $('#btn-load').onclick = () => { if (loadGame()) { afterLoad(); toast('Game loaded.', 'good'); } else toast('No saved game found.', 'warn'); };
  $('#btn-new').onclick = () => showWelcome();
  $('#btn-help').onclick = () => showHelp();
}
export function updateSpeedButtons() {
  $$('#speed button').forEach(b => b.classList.toggle('on', +b.dataset.speed === G.speed));
}
export function updateTopbar() {
  if (!G.stats) return;
  $('#date').textContent = `${MONTHS[G.month]} ${G.year}`;
  $('#k-pop').textContent = fmt.num(G.pop);
  $('#k-gdp').textContent = 'NT$' + fmt.num(G.econ.gdp * 1e9);
  const f = $('#k-funds');
  f.textContent = fmt.money(G.funds);
  f.classList.toggle('neg', G.funds < 0);
  const net = (G.econ.revenueY - G.econ.expenseY);
  $('#k-flow').textContent = (net >= 0 ? '+' : '') + fmt.money(net) + '/yr';
  $('#k-flow').classList.toggle('neg', net < 0);
  const sc = G.score || computeScore();
  $('#k-grade').textContent = sc.grade;
  $('#k-grade').dataset.grade = sc.grade;
  $('#k-score').textContent = Math.round(sc.total);
  shareBar($('#k-modal'), MODES, MODE_COLORS, G.stats.modal, MODE_LABELS);
  $('#k-commute').textContent = G.stats.commute.toFixed(0) + ' min';
  $('#k-cong').textContent = '+' + Math.round(G.stats.congestion * 100) + '%';
}

// ===================================================================== toolbar
function buildToolbar() {
  const tb = $('#toolbar');
  tb.innerHTML = TOOLS.map(t => `<button data-tool="${t.id}" title="${t.label} (${t.key.toUpperCase()})"><span class="ic">${t.icon}</span><span class="lb">${t.label}</span></button>`).join('');
  $$('#toolbar button').forEach(b => b.onclick = () => setTool(b.dataset.tool));
}

function buildOverlayBar() {
  const ob = $('#overlaybar');
  ob.innerHTML = '<span class="ttl">Overlay</span>' + Object.entries(OVERLAYS).map(([k, o]) => `<button data-ov="${k}">${o.label}</button>`).join('');
  $$('#overlaybar button').forEach(b => b.onclick = () => setOverlay(b.dataset.ov));
  setOverlay('none');
}
export function setOverlay(k) {
  R.overlay = k; R.ovDirty = true;
  $$('#overlaybar button').forEach(b => b.classList.toggle('on', b.dataset.ov === k));
  const lg = $('#legend');
  const o = OVERLAYS[k];
  if (k === 'districts') lg.innerHTML = G.districts.map(d => `<span><i style="background:${d.color}"></i>${d.name}</span>`).join('');
  else lg.innerHTML = (o.legend || []).map(([c, t]) => `<span><i style="background:${c}"></i>${t}</span>`).join('');
  lg.style.display = lg.innerHTML ? '' : 'none';
}

export function setTool(id) {
  cancelDraft();
  UI.tool = id;
  $$('#toolbar button').forEach(b => b.classList.toggle('on', b.dataset.tool === id));
  renderToolOptions();
  R.cv.style.cursor = id === 'inspect' ? 'default' : 'crosshair';
  R.transitTool = ['bus', 'metro', 'lrt', 'rail'].includes(id);
  R.ovDirty = true;
  if (id === 'zone' && R.overlay === 'none') { /* hint */ }
}

function cancelDraft() {
  UI.road.pts = [];
  UI.road.corner = null;
  UI.transit.draft = null;
  R.preview = null;
}

function hint(html) { $('#hint').innerHTML = html; $('#hint').style.display = html ? '' : 'none'; }

// ===================================================================== tool options
function renderToolOptions() {
  const el = $('#toolopts');
  const t = UI.tool;
  el.style.display = t === 'inspect' ? 'none' : '';
  if (t === 'road') return renderRoadOptions(el);
  if (t === 'zone') {
    el.innerHTML = `<h3>Zoning</h3>
      <div class="btngrid z">${[1, 2, 3, 4, 5].map(z => `<button data-z="${z}" style="--c:${ZONES[z].color}"><i></i>${ZONES[z].label}</button>`).join('')}<button data-z="0" style="--c:#999"><i></i>Dezone</button></div>
      <button data-z="-1" class="restyle ${UI.zone.z === -1 ? 'on' : ''}">🎨 Style &amp; height only (keep zone)</button>
      <label class="row">Brush <span class="seg">${[1, 3, 5, 9].map(b => `<button data-b="${b}">${b}×${b}</button>`).join('')}</span></label>
      <h4>Max building height</h4>
      <div class="seg full heights">${[0, 1, 2, 3, 4, 5, 6].map(h => `<button data-h="${h}" title="${h ? levelLabel(h) : 'Use the district zoning law'}">${h ? HEIGHT_SHORT[h] : 'District law'}</button>`).join('')}</div>
      <h4>Building style</h4>
      <div class="btngrid styles"><button data-bs="0">🏙 District default</button>${BSTYLES.map((b, i) => `<button data-bs="${i + 1}" title="${esc(b.desc)}"><i style="background:${b.walls[0]}"></i>${b.label} <small>${b.zh}</small></button>`).join('')}</div>
      <p class="note">${UI.zone.bstyle ? esc(BSTYLES[UI.zone.bstyle - 1].desc) : 'Each district has a default style (set it in the district panel).'}</p>
      <p class="note">Drag on the map to paint. Buildings grow on zoned land that has <b>road access</b> and enough demand. Each district's zoning law limits which zones and heights are allowed. Click a district with the Inspect tool to change its law.</p>
      <div id="demand"></div>`;
    $$('[data-z]', el).forEach(b => b.onclick = () => { UI.zone.z = +b.dataset.z; renderToolOptions(); });
    $$('[data-b]', el).forEach(b => b.onclick = () => { UI.zone.brush = +b.dataset.b; renderToolOptions(); });
    $$('[data-z]', el).forEach(b => b.classList.toggle('on', +b.dataset.z === UI.zone.z));
    $$('[data-b]', el).forEach(b => b.classList.toggle('on', +b.dataset.b === UI.zone.brush));
    $$('[data-h]', el).forEach(b => { b.classList.toggle('on', +b.dataset.h === UI.zone.hcap); b.onclick = () => { UI.zone.hcap = +b.dataset.h; renderToolOptions(); }; });
    $$('[data-bs]', el).forEach(b => { b.classList.toggle('on', +b.dataset.bs === UI.zone.bstyle); b.onclick = () => { UI.zone.bstyle = +b.dataset.bs; renderToolOptions(); }; });
    renderDemand();
    hint('Drag to paint zones · right-drag to rotate · Esc to stop');
    return;
  }
  if (t === 'build') {
    el.innerHTML = `<h3>Public buildings</h3><div class="btngrid">${[1, 2, 3, 4, 6, 5].map(s => `<button data-s="${s}" style="--c:${SPECIALS[s].color}"><i></i>${SPECIALS[s].label}<small>${fmt.money(SPECIALS[s].cost)}</small></button>`).join('')}</div>
      <p class="note">${{ 1: 'Parks raise nearby land value and make areas more attractive to live in.', 2: 'Schools raise residential desirability nearby.', 3: 'Hospitals add jobs and raise desirability.', 4: 'Night markets create walkable shopping streets and pedestrian trips.', 5: 'Airports (7×2 cells) add GDP from air passengers. Noise lowers nearby residential value and caps building height within about 1.6 km.', 6: 'Universities (2×2) add many jobs and student trips.' }[UI.build.s]}</p>`;
    $$('[data-s]', el).forEach(b => { b.classList.toggle('on', +b.dataset.s === UI.build.s); b.onclick = () => { UI.build.s = +b.dataset.s; renderToolOptions(); }; });
    hint('Click to place · Esc to cancel');
    return;
  }
  if (t === 'bus' || t === 'metro' || t === 'lrt' || t === 'rail') return renderTransitOptions(el, t);
  if (t === 'bulldoze') {
    el.innerHTML = `<h3>Bulldoze</h3><p class="note">Click to remove a station, bus stop, road segment, public building or zone. Hold <kbd>Shift</kbd> to remove an entire road. Drag to clear zones.</p>`;
    hint('Click to demolish · Shift+click removes a whole road');
    return;
  }
  hint('');
}

function renderDemand() {
  const el = $('#demand');
  if (!el || !G.cap) return;
  const d = (t, c) => clamp(t / Math.max(1, c), 0, 1.6);
  const rows = [
    ['Residential', d(G.targetPop, G.cap.r), ZONES[1].color],
    ['Commercial', d(G.targetJobs.c, G.cap.c), ZONES[2].color],
    ['Office', d(G.targetJobs.o, G.cap.o), ZONES[4].color],
    ['Industrial', d(G.targetJobs.i, G.cap.i), ZONES[5].color],
  ];
  el.innerHTML = `<h4>Demand (target ÷ capacity)</h4>` + rows.map(([n, v, c]) => `<div class="dem"><span>${n}</span><b style="width:${Math.min(100, v / 1.6 * 100)}%;background:${c}"></b><em>${(v * 100).toFixed(0)}%</em></div>`).join('') +
    `<p class="note">Above 100% means more is needed. Max height allowed in this era: level ${eraMaxLevel()}.</p>`;
}

function renderRoadOptions(el) {
  const st = UI.road;
  st.mode ||= 'draw'; st.spacing ||= 0.4;
  el.innerHTML = `<h3>Road builder</h3>
    <div class="seg full" style="margin-bottom:8px"><button data-mode="draw">✏️ Draw road</button><button data-mode="grid">▦ Street grid</button></div>
    ${st.mode === 'grid' ? `<label class="row">Block spacing <span class="seg">${[0.2, 0.3, 0.4, 0.6, 0.8].map(s => `<button data-sp="${s}" class="${s === st.spacing ? 'on' : ''}">${s * 1000}m</button>`).join('')}</span></label>
    <p class="note">Click two opposite corners to lay a grid of the selected road type. Rivers are skipped and the grid joins existing roads.</p>` : ''}
    <div class="btngrid roads">${Object.entries(ROAD_TYPES).map(([k, t]) => `<button data-rt="${k}"><i style="background:${t.fill};border-color:${t.casing}"></i>${t.label}</button>`).join('')}</div>
    <h4>Design style</h4>
    <div class="seg full">${Object.entries(STYLES).map(([k, s]) => `<button data-st="${k}" title="${esc(s.desc)}">${s.flag} ${s.label}</button>`).join('')}</div>
    <p class="note">${esc(STYLES[st.style].desc)}</p>
    <div id="road-cfg"></div>
    <p class="note">Click to add points, <b>double-click</b> or <kbd>Enter</kbd> to finish, <kbd>Esc</kbd> to cancel. Green ring: snaps to a junction. Orange ring: joins an existing road. Surface roads create intersections automatically. Expressways are grade-separated: interchanges are added automatically where they cross avenues, boulevards or highways (at least 800 m apart), and streets pass underneath.</p>`;
  $$('[data-mode]', el).forEach(b => { b.classList.toggle('on', b.dataset.mode === st.mode); b.onclick = () => { st.mode = b.dataset.mode; st.pts = []; st.corner = null; R.preview = null; renderRoadOptions(el); }; });
  $$('[data-sp]', el).forEach(b => b.onclick = () => { st.spacing = +b.dataset.sp; renderRoadOptions(el); });
  $$('[data-rt]', el).forEach(b => { b.classList.toggle('on', b.dataset.rt === st.type); b.onclick = () => { st.type = b.dataset.rt; st.cfg = defaultCfg(st.type, st.style); renderRoadOptions(el); }; });
  $$('[data-st]', el).forEach(b => { b.classList.toggle('on', b.dataset.st === st.style); b.onclick = () => { st.style = b.dataset.st; st.cfg = defaultCfg(st.type, st.style); renderRoadOptions(el); }; });
  roadCfgEditor($('#road-cfg', el), st.type, st.cfg, () => { updateRoadPreview(); renderCostLine(); });
  const cl = document.createElement('div'); cl.id = 'costline'; cl.className = 'costline'; el.appendChild(cl);
  renderCostLine();
  hint('Click to place road points · double-click to finish');
}
function renderCostLine() {
  const el = $('#costline');
  if (!el) return;
  const st = UI.road;
  el.innerHTML = `Cost ≈ <b>${fmt.money(costPerKm(st.type, st.cfg))}</b>/km · width ${roadWidthM(st.type, st.cfg).toFixed(0)} m`;
}

/** Shared editor for a road configuration. onChange(cfg, field) called after any edit. */
function roadCfgEditor(el, type, c, onChange) {
  const T = ROAD_TYPES[type];
  const car = type !== 'pedestrian';
  const surf = T.surface && type !== 'pedestrian';
  el.innerHTML = `
    ${car ? `<label class="row">Lanes per direction <span class="stepper"><button data-a="lanes-">−</button><b>${c.lanes}</b><button data-a="lanes+">+</button></span></label>
    <label class="row"><span>One-way</span><input type="checkbox" data-f="oneWay" ${c.oneWay ? 'checked' : ''}></label>
    <label class="row">Speed limit <span><input type="range" min="20" max="${type === 'expressway' ? 120 : 90}" step="5" data-f="speed" value="${c.speed}"><em>${c.speed} km/h</em></span></label>` : ''}
    ${type !== 'expressway' ? `<label class="row">Sidewalk width <span><input type="range" min="0" max="8" step="0.5" data-f="sidewalk" value="${c.sidewalk}"><em>${c.sidewalk} m</em></span></label>
    <label class="row"><span>Arcade (騎樓) covered walkway</span><input type="checkbox" data-f="arcade" ${c.arcade ? 'checked' : ''}></label>
    <label class="row"><span>Street trees</span><input type="checkbox" data-f="trees" ${c.trees ? 'checked' : ''}></label>` : ''}
    ${surf ? `<label class="row">Bike lane <select data-f="bikeLane">${Object.entries(BIKE_LANES).map(([k, b]) => `<option value="${k}" ${c.bikeLane === k ? 'selected' : ''}>${b.label}</option>`).join('')}</select></label>
    <label class="row"><span>Bus lane ${c.lanes < 2 ? '<small>(needs 2+ lanes)</small>' : ''}</span><input type="checkbox" data-f="busLane" ${c.busLane ? 'checked' : ''} ${c.lanes < 2 ? 'disabled' : ''}></label>
    <label class="row"><span>Traffic signals</span><input type="checkbox" data-f="signal.on" ${c.signal.on ? 'checked' : ''}></label>
    ${c.signal.on ? `<label class="row">Cycle length <span><input type="range" min="40" max="200" step="10" data-f="signal.cycle" value="${c.signal.cycle}"><em>${c.signal.cycle} s</em></span></label>
    <label class="row">Green for this road <span><input type="range" min="0.2" max="0.85" step="0.05" data-f="signal.green" value="${c.signal.green}"><em>${Math.round(c.signal.green * 100)}%</em></span></label>` : `<p class="note small">Unsignalised junctions use ${c.style === 'UK' ? 'roundabouts (UK style: smoother flow)' : 'priority/stop control (lower capacity)'}.</p>`}` : ''}
    <label class="row">Style <select data-f="style">${Object.entries(STYLES).map(([k, s]) => `<option value="${k}" ${c.style === k ? 'selected' : ''}>${s.flag} ${s.label}</option>`).join('')}</select></label>`;
  const rerender = () => roadCfgEditor(el, type, c, onChange);
  $$('[data-a]', el).forEach(b => b.onclick = () => {
    const d = b.dataset.a === 'lanes+' ? 1 : -1;
    c.lanes = clamp(c.lanes + d, 1, T.maxLanes);
    if (c.lanes < 2) c.busLane = false;
    rerender(); onChange(c, 'lanes');
  });
  $$('[data-f]', el).forEach(inp => {
    const f = inp.dataset.f;
    const set = (v) => { if (f.startsWith('signal.')) c.signal[f.slice(7)] = v; else c[f] = v; };
    const ev = inp.type === 'range' ? 'input' : 'change';
    inp.addEventListener(ev, () => {
      const v = inp.type === 'checkbox' ? inp.checked : inp.type === 'range' ? +inp.value : inp.value;
      set(v);
      if (inp.type === 'range') { inp.nextElementSibling.textContent = f === 'signal.green' ? Math.round(v * 100) + '%' : f === 'speed' ? v + ' km/h' : f === 'sidewalk' ? v + ' m' : v + ' s'; onChange(c, f); }
      else { rerender(); onChange(c, f); }
    });
  });
}

function renderTransitOptions(el, t) {
  const spec = TRANSIT[t];
  const tr = UI.transit;
  if (!tr.headway || tr.type !== t) { tr.headway = spec.headway; tr.type = t; }
  const d = tr.draft;
  const ext = d?.extend ? (t === 'bus' ? G.transit.routes[d.extend] : G.transit.lines[d.extend]) : null;
  el.innerHTML = `<h3>${spec.label}</h3>
    <p class="note">${t === 'bus' ? 'Click road junctions to place stops in order. The route follows the road network. Bus lanes on its roads speed it up.' : `Click to place stations in order (or click existing ${spec.label.toLowerCase()} stations to share them). Lines within 300 m of each other allow transfers.`} Double-click or <kbd>Enter</kbd> to finish.</p>
    ${ext ? `<p class="note warn">Extending <b>${esc(ext.name)}</b> from its last stop.</p>` : ''}
    <label class="row">Headway <span><input type="range" min="${t === 'bus' ? 3 : t === 'rail' ? 5 : 2}" max="${t === 'bus' ? 60 : 30}" step="1" id="hw" value="${tr.headway}"><em>every ${tr.headway} min</em></span></label>
    ${t === 'metro' ? `<label class="row"><span>Elevated (cheaper, ${fmt.money(spec.elevCost)}/km)</span><input type="checkbox" id="elev" ${tr.elevated ? 'checked' : ''}></label>` : ''}
    <table class="kv">
      <tr><td>Station cost</td><td>${fmt.money(spec.stationCost)}</td></tr>
      ${t !== 'bus' ? `<tr><td>Track cost</td><td>${fmt.money(trackCostPerKm(t, tr.elevated))}/km</td></tr>` : ''}
      <tr><td>Vehicle capacity</td><td>${spec.cap} pax</td></tr>
      <tr><td>Avg speed</td><td>${spec.speed} km/h</td></tr>
      <tr><td>Capacity at this headway</td><td>${fmt.num(60 / tr.headway * spec.cap)} pax/h/dir</td></tr>
    </table>
    <div class="costline" id="tcost"></div>
    ${d ? `<div class="btnrow"><button class="primary" id="tfinish">Finish line</button><button id="tcancel">Cancel</button></div>` : ''}`;
  $('#hw', el).oninput = e => { tr.headway = +e.target.value; e.target.nextElementSibling.textContent = `every ${tr.headway} min`; };
  $('#hw', el).onchange = () => renderTransitOptions(el, t);
  if ($('#elev', el)) $('#elev', el).onchange = e => { tr.elevated = e.target.checked; renderTransitOptions(el, t); };
  if ($('#tfinish', el)) $('#tfinish', el).onclick = () => finishTransit();
  if ($('#tcancel', el)) $('#tcancel', el).onclick = () => { cancelDraft(); renderToolOptions(); };
  updateTransitPreview();
  hint(t === 'bus' ? 'Click junctions to add stops · double-click to finish' : 'Click to add stations · double-click to finish');
}

// ===================================================================== map interaction
let mouse = { down: false, btn: 0, sx: 0, sy: 0, x: 0, y: 0, moved: false, pan: false, painted: false };

function bindMap() {
  const cv = R.cv;
  cv.addEventListener('contextmenu', e => e.preventDefault());
  cv.addEventListener('mousedown', e => {
    // left drag = grab-pan (paint for zoning), right drag = orbit/tilt, middle drag = pan
    mouse = { down: true, btn: e.button, sx: e.offsetX, sy: e.offsetY, lx: e.offsetX, ly: e.offsetY, moved: false, pan: e.button === 1, orbit: e.button === 2, painted: false, px: e.offsetX, py: e.offsetY };
    R.grabStart(e.offsetX, e.offsetY);
    if (e.button === 0 && (UI.tool === 'zone' || (UI.tool === 'bulldoze' && e.altKey))) { paintAt(e.offsetX, e.offsetY); mouse.painted = true; }
  });
  window.addEventListener('mousemove', e => {
    const rect = cv.getBoundingClientRect();
    const px = e.clientX - rect.left, py = e.clientY - rect.top;
    if (mouse.down) {
      const dx = px - mouse.sx, dy = py - mouse.sy;
      if (!mouse.moved && Math.hypot(dx, dy) > 5) {
        mouse.moved = true;
        if (UI.tool !== 'zone' && mouse.btn === 0) mouse.pan = true;
      }
      if (mouse.orbit && mouse.moved) {
        R.orbit(px - mouse.lx, py - mouse.ly);
      } else if (mouse.pan && mouse.moved) {
        R.grabMove(px, py);
      } else if (UI.tool === 'zone' && mouse.btn === 0) {
        // interpolate so fast drags don't leave gaps
        const lx = mouse.lpx ?? mouse.sx, ly = mouse.lpy ?? mouse.sy;
        const step = Math.max(2, CELL * R.cam.scale * 0.5);
        const n = Math.ceil(Math.hypot(px - lx, py - ly) / step);
        for (let q = 1; q <= n; q++) paintAt(lx + (px - lx) * q / n, ly + (py - ly) * q / n);
        mouse.lpx = px; mouse.lpy = py;
      }
    }
    mouse.lx = px; mouse.ly = py;
    if (e.target === cv && !(mouse.down && (mouse.pan || mouse.orbit) && mouse.moved)) hover(px, py, e);
  });
  window.addEventListener('mouseup', e => {
    if (!mouse.down) return;
    const wasClick = !mouse.moved && mouse.btn === 0;
    mouse.down = false;
    if (UI.tool === 'zone' && mouse.painted || (UI.tool === 'zone' && mouse.moved)) { requestAssess(); renderDemand(); }
    if (wasClick && e.target === cv) click(e.offsetX, e.offsetY, e);
  });
  cv.addEventListener('dblclick', e => {
    if (UI.tool === 'road') finishRoad();
    else if (['bus', 'metro', 'lrt', 'rail'].includes(UI.tool)) finishTransit();
  });
  cv.addEventListener('wheel', e => {
    e.preventDefault();
    R.zoomAt(e.offsetX, e.offsetY, Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0018)));
  }, { passive: false });
  cv.addEventListener('mouseleave', () => { if (UI.tool === 'zone' || UI.tool === 'build') R.preview = null; });
}

function bindKeys() {
  document.addEventListener('click', e => { const b = e.target.closest('button'); if (b) b.blur(); });
  window.addEventListener('keydown', e => {
    if (e.target.matches('input:not([type=range]):not([type=checkbox]):not([type=color]), select, textarea')) return;
    if (e.target.matches('input[type=range]') && e.key.startsWith('Arrow')) return;
    if (e.key === 'Escape') { if (UI.road.pts.length || UI.road.corner || UI.transit.draft) { cancelDraft(); renderToolOptions(); } else if (UI.tool !== 'inspect') setTool('inspect'); else select(null); closeModal(); return; }
    if (e.key === 'Enter') { if (UI.tool === 'road') finishRoad(); else finishTransit(); return; }
    if (e.key === ' ') { e.preventDefault(); G.speed = G.speed ? 0 : (UI.lastSpeed || 1); if (G.speed) UI.lastSpeed = G.speed; updateSpeedButtons(); return; }
    if (e.key >= '0' && e.key <= '4') { G.speed = +e.key; if (G.speed) UI.lastSpeed = G.speed; updateSpeedButtons(); return; }
    if (e.key === 'Backspace' && UI.tool === 'road' && UI.road.pts.length) { UI.road.pts.pop(); updateRoadPreview(); return; }
    const t = TOOLS.find(t => t.key === e.key.toLowerCase());
    if (t && !e.metaKey && !e.ctrlKey) setTool(t.id);
    if (e.key === 's' && !e.metaKey && !e.ctrlKey) openStats();
    if (e.key === 'f') R.fit();
  });
}

// km per screen pixel at the cursor (varies with depth in the 3D view)
const pxToKm = px => {
  if (mouse.px === undefined) return px / R.cam.scale;
  const a = R.s2w(mouse.px, mouse.py), b = R.s2w(mouse.px + 10, mouse.py);
  return px * Math.max(1e-5, Math.hypot(b[0] - a[0], b[1] - a[1]) / 10);
};

function hover(px, py, e) {
  const [x, y] = R.s2w(px, py);
  mouse.wx = x; mouse.wy = y; mouse.px = px; mouse.py = py;
  if (UI.tool === 'road') updateRoadPreview(e);
  else if (UI.tool === 'zone') {
    const b = UI.zone.brush, k = cellAt(G, x, y);
    if (k < 0) { R.preview = null; return; }
    const i = k % G.grid.w, j = (k / G.grid.w) | 0, h = (b - 1) / 2;
    R.preview = { rect: [(i - h) * CELL, (j - h) * CELL, (i + h + 1) * CELL, (j + h + 1) * CELL], fill: UI.zone.z > 0 ? ZONES[UI.zone.z].color + '55' : 'rgba(120,120,120,0.35)', stroke: UI.zone.z > 0 ? ZONES[UI.zone.z].color : UI.zone.z === -1 ? '#ff9800' : '#555', height: 0.004 + (UI.zone.hcap || 0) * 0.008 };
  } else if (UI.tool === 'build') {
    const sp = SPECIALS[UI.build.s], k = cellAt(G, x, y);
    if (k < 0) { R.preview = null; return; }
    const i = k % G.grid.w, j = (k / G.grid.w) | 0;
    const ok = canPlace(i, j, sp.size[0], sp.size[1]);
    R.preview = { rect: [i * CELL, j * CELL, (i + sp.size[0]) * CELL, (j + sp.size[1]) * CELL], fill: ok ? 'rgba(76,175,80,0.35)' : 'rgba(229,57,53,0.35)', stroke: ok ? '#2e7d32' : '#c62828', label: `${sp.label} · ${fmt.money(sp.cost)}`, at: [x, y] };
  } else if (['bus', 'metro', 'lrt', 'rail'].includes(UI.tool)) updateTransitPreview();
  else if (UI.tool === 'bulldoze') {
    const hit = pick(px, py, true);
    R.preview = hit ? { label: 'Remove ' + hit.label, at: [x, y], labelColor: '#ff8a80' } : null;
  } else R.preview = null;
}

function click(px, py, e) {
  const [x, y] = R.s2w(px, py);
  switch (UI.tool) {
    case 'inspect': { const h = pick(px, py); select(h ? h.sel : null); break; }
    case 'road': roadClick(x, y, e); break;
    case 'zone': break;
    case 'build': placeSpecial(x, y); break;
    case 'bus': busClick(x, y); break;
    case 'metro': case 'lrt': case 'rail': railClick(x, y); break;
    case 'bulldoze': bulldoze(px, py, e); break;
  }
}

/** Find the thing under the cursor. */
function pick(px, py, forBulldoze = false) {
  const [x, y] = R.s2w(px, py);
  const T = G.transit, net = G.net;
  const r12 = pxToKm(12);
  let best = null, bd = r12;
  for (const s of Object.values(T.stations)) { const d = Math.hypot(s.x - x, s.y - y); if (d < bd) { bd = d; best = s; } }
  if (best) return { sel: { kind: 'station', id: best.id }, label: `${TRANSIT[best.type].label} station ${best.name}` };
  if (R.cam.scale > 60) {
    bd = pxToKm(8); best = null;
    for (const s of Object.values(T.stops)) { const p = stopPos(G, s); if (!p) continue; const d = Math.hypot(p.x - x, p.y - y); if (d < bd) { bd = d; best = s; } }
    if (best) return { sel: { kind: 'stop', id: best.id }, label: 'bus stop' };
  }
  if (!forBulldoze) {
    // transit line segments
    let bl = null; bd = pxToKm(6);
    for (const l of Object.values(T.lines)) {
      for (let i = 1; i < l.stations.length; i++) {
        const a = T.stations[l.stations[i - 1]], b = T.stations[l.stations[i]];
        if (!a || !b) continue;
        const d = distSegKm(x, y, a, b);
        if (d < bd) { bd = d; bl = { kind: 'line', id: l.id }; }
      }
    }
    if (bl) return { sel: bl };
  }
  const ne = nearestEdge(net, x, y, pxToKm(7));
  if (ne) {
    const r = net.roads[ne.edge.road];
    const w = Math.max(pxToKm(7), roadWidthM(r.type, r.cfg) / 2000);
    if (ne.d <= w) return { sel: { kind: 'road', id: r.id, edge: ne.edge.id }, label: `${r.name} segment`, edge: ne.edge };
  }
  if (!forBulldoze && R.cam.scale > 22 && Object.values(T.routes).length) {
    // bus routes: test against their polylines
    for (const r of Object.values(T.routes)) {
      for (const [eid] of r.path) {
        const e = net.edges[eid];
        if (!e) continue;
        const A = net.nodes[e.a], B = net.nodes[e.b];
        if (distSegKm(x, y, A, B) < pxToKm(5)) return { sel: { kind: 'route', id: r.id } };
      }
    }
  }
  const k = cellAt(G, x, y);
  if (k < 0 || G.grid.district[k] < 0) return null;
  const g = G.grid;
  if (forBulldoze) {
    if (g.special[k]) return { sel: { kind: 'cell', id: k }, label: SPECIALS[g.special[k]].label, cell: k };
    if (g.zone[k]) return { sel: { kind: 'cell', id: k }, label: `${ZONES[g.zone[k]].label} zone`, cell: k };
    return null;
  }
  if (R.cam.scale < 45 && !g.special[k]) return { sel: { kind: 'district', id: g.district[k] } };
  return { sel: { kind: 'cell', id: k } };
}
function distSegKm(x, y, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy || 1;
  const t = clamp(((x - a.x) * dx + (y - a.y) * dy) / l2, 0, 1);
  return Math.hypot(x - a.x - t * dx, y - a.y - t * dy);
}

// ---------------------------------------------------------- road tool
function snapRoad(x, y, free) {
  const net = G.net, r = pxToKm(11);
  if (!free) {
    const n = nearestNode(net, x, y, r);
    if (n) return { kind: 'node', x: n.x, y: n.y, node: n.id };
    const e = nearestEdge(net, x, y, r);
    if (e) return { kind: 'edge', x: e.x, y: e.y, edge: e.edge.id };
  }
  return { kind: 'free', x, y };
}
function estimateCost(pts, type, cfg) {
  let c = 0, len = 0;
  const g = G.grid;
  for (let i = 1; i < pts.length; i++) {
    const A = pts[i - 1], B = pts[i];
    const L = Math.hypot(B.x - A.x, B.y - A.y);
    let w = 0, m = 0;
    for (let s = 0; s < 8; s++) {
      const k = cellAt(G, A.x + (B.x - A.x) * (s + 0.5) / 8, A.y + (B.y - A.y) * (s + 0.5) / 8);
      if (k < 0) continue;
      if (g.terrain[k] === T_WATER) w++; else if (g.terrain[k] === T_MTN) m++;
    }
    len += L;
    c += L * costPerKm(type, cfg) * terrainMult({ water: w / 8, mtn: m / 8 });
  }
  return { cost: c, len };
}
// ---- street grid
function gridRuns(x0, y0, x1, y1, sp) {
  const ax = Math.min(x0, x1), bx = Math.max(x0, x1), ay = Math.min(y0, y1), by = Math.max(y0, y1);
  const g = G.grid;
  const ok = (x, y) => { const k = cellAt(G, x, y); return k >= 0 && g.district[k] >= 0 && g.terrain[k] !== T_WATER && g.special[k] !== S.AIRPORT; };
  const lines = [];
  for (let x = Math.ceil(ax / sp) * sp; x <= bx + 1e-9; x += sp) lines.push([x, ay, x, by]);
  for (let y = Math.ceil(ay / sp) * sp; y <= by + 1e-9; y += sp) lines.push([ax, y, bx, y]);
  const runs = [];
  const step = 0.05;
  for (const [lx0, ly0, lx1, ly1] of lines) {
    const L = Math.hypot(lx1 - lx0, ly1 - ly0), n = Math.max(1, Math.round(L / step));
    let start = null;
    for (let s = 0; s <= n; s++) {
      const x = lx0 + (lx1 - lx0) * s / n, y = ly0 + (ly1 - ly0) * s / n;
      const good = ok(x, y);
      if (good && !start) start = { x, y };
      if ((!good || s === n) && start) {
        const end = good ? { x, y } : { x: lx0 + (lx1 - lx0) * (s - 1) / n, y: ly0 + (ly1 - ly0) * (s - 1) / n };
        if (Math.hypot(end.x - start.x, end.y - start.y) > 0.12) runs.push([start, end]);
        start = null;
      }
    }
  }
  return runs;
}
function gridPreview() {
  const st = UI.road;
  if (mouse.wx === undefined) return;
  if (!st.corner) { R.preview = { snap: { kind: 'free', x: mouse.wx, y: mouse.wy }, label: 'Street grid: click the first corner', at: [mouse.wx, mouse.wy] }; return; }
  const runs = gridRuns(st.corner.x, st.corner.y, mouse.wx, mouse.wy, st.spacing);
  let cost = 0, len = 0;
  for (const [a, b] of runs) { const est = estimateCost([a, b], st.type, st.cfg); cost += est.cost; len += est.len; }
  R.preview = {
    rect: [Math.min(st.corner.x, mouse.wx), Math.min(st.corner.y, mouse.wy), Math.max(st.corner.x, mouse.wx), Math.max(st.corner.y, mouse.wy)],
    fill: 'rgba(255,210,122,0.12)', stroke: '#c39d45', gridRuns: runs, label: `${runs.length} streets · ${len.toFixed(1)} km · ${fmt.money(cost)}`, at: [mouse.wx, mouse.wy],
    labelColor: isFinite(G.funds) && cost > G.funds + 5000 ? '#ff8a80' : '#fff',
  };
}
function gridClick(x, y) {
  const st = UI.road;
  if (!st.corner) { st.corner = { x, y }; gridPreview(); return; }
  const runs = gridRuns(st.corner.x, st.corner.y, x, y, st.spacing);
  st.corner = null;
  if (!runs.length) { R.preview = null; return; }
  let cost = 0, len = 0;
  for (const [a, b] of runs) { const est = estimateCost([a, b], st.type, st.cfg); cost += est.cost; len += est.len; }
  if (!spend(cost, 'this street grid')) return;
  const net = G.net;
  for (const [a, b] of runs) {
    const pts = [a, b].map(p => { const n = nearestNode(net, p.x, p.y, 0.04); return n ? { x: n.x, y: n.y, node: n.id } : { x: p.x, y: p.y }; });
    buildRoad(G, net, pts, st.type, st.cfg);
  }
  news(`Laid out a ${st.spacing * 1000} m street grid: ${len.toFixed(1)} km of ${ROAD_TYPES[st.type].label.toLowerCase()}s for ${fmt.money(cost)}.`);
  R.preview = null;
  afterNetworkChange();
}

function updateRoadPreview(e) {
  const st = UI.road;
  if (mouse.wx === undefined) return;
  if (st.mode === 'grid') return gridPreview();
  const snap = snapRoad(mouse.wx, mouse.wy, e?.altKey);
  const pts = [...st.pts, snap];
  const T = ROAD_TYPES[st.type];
  const est = estimateCost(pts, st.type, st.cfg);
  R.preview = {
    poly: pts.map(p => [p.x, p.y]), fixed: st.pts.length, snap: snap.kind !== 'free' ? snap : null,
    color: T.casing, width: Math.max(3, roadWidthM(st.type, st.cfg) / 1000 * R.cam.scale),
    label: st.pts.length ? `${fmt.km(est.len)} · ${fmt.money(est.cost)}` : `${T.label}: click to start`, at: [mouse.wx, mouse.wy],
    labelColor: isFinite(G.funds) && est.cost > G.funds + 5000 ? '#ff8a80' : '#fff',
  };
}
function roadClick(x, y, e) {
  const st = UI.road;
  if (st.mode === 'grid') return gridClick(x, y);
  const snap = snapRoad(x, y, e.altKey);
  const last = st.pts[st.pts.length - 1];
  if (last && Math.hypot(last.x - snap.x, last.y - snap.y) < pxToKm(4)) { finishRoad(); return; }
  st.pts.push(snap);
  updateRoadPreview(e);
}
function finishRoad() {
  const st = UI.road;
  if (st.pts.length < 2) { st.pts = []; R.preview = null; return; }
  const est = estimateCost(st.pts, st.type, st.cfg);
  if (!spend(est.cost, 'this road')) return;
  const res = buildRoad(G, G.net, st.pts, st.type, st.cfg);
  st.pts = [];
  R.preview = null;
  if (res) {
    news(`Built ${ROAD_TYPES[st.type].label.toLowerCase()} "${res.road.name}" (${fmt.km(est.len)}) for ${fmt.money(est.cost)}.`);
    afterNetworkChange();
    R.baseDirty = true;
  }
}

// ---------------------------------------------------------- zoning
let lawWarned = 0;
function paintAt(px, py) {
  const [x, y] = R.s2w(px, py);
  const k0 = cellAt(G, x, y);
  if (k0 < 0) return;
  const g = G.grid, b = UI.zone.brush, h = (b - 1) / 2;
  const i0 = k0 % g.w, j0 = (k0 / g.w) | 0;
  let changed = false, cost = 0;
  const z = UI.tool === 'bulldoze' ? 0 : UI.zone.z;
  for (let j = j0 - h; j <= j0 + h; j++) for (let i = i0 - h; i <= i0 + h; i++) {
    if (i < 0 || j < 0 || i >= g.w || j >= g.h) continue;
    const k = j * g.w + i;
    if (!buildable(G, k) || g.special[k]) continue;
    if (UI.tool === 'zone') {
      // height limit and building style travel with the brush
      if (g.hcap[k] !== UI.zone.hcap) { g.hcap[k] = UI.zone.hcap; changed = true; }
      if (g.bstyle[k] !== UI.zone.bstyle) { g.bstyle[k] = UI.zone.bstyle; changed = true; }
      if (UI.zone.hcap && g.level[k] > UI.zone.hcap) { g.level[k] = UI.zone.hcap; changed = true; }
      if (z === -1) continue;
    }
    if (g.zone[k] === z) continue;
    if (z && !G.districts[g.district[k]].law.allow[z]) {
      if (performance.now() - lawWarned > 4000) { lawWarned = performance.now(); toast(`${G.districts[g.district[k]].name}'s zoning law does not allow ${ZONES[z].label}. Change it in the district panel.`, 'warn'); }
      continue;
    }
    // compatible re-zoning keeps buildings (R<->M, C<->M), otherwise demolish
    const keep = (g.zone[k] === Z.M && (z === Z.R || z === Z.C)) || (z === Z.M && (g.zone[k] === Z.R || g.zone[k] === Z.C));
    if (g.level[k] && !keep) { cost += g.level[k] ** 2 * 2; g.level[k] = 0; }
    g.zone[k] = z;
    if (!z) g.level[k] = 0;
    changed = true;
  }
  if (cost && isFinite(G.funds)) G.funds -= cost;
  if (changed) { R.baseDirty = true; R.ovDirty = true; }
}

// ---------------------------------------------------------- specials
function canPlace(i, j, w, h) {
  const g = G.grid;
  for (let b = j; b < j + h; b++) for (let a = i; a < i + w; a++) {
    if (a >= g.w || b >= g.h) return false;
    const k = b * g.w + a;
    if (!buildable(G, k) || g.special[k] || g.terrain[k] !== T_LAND) return false;
  }
  return true;
}
function placeSpecial(x, y) {
  const s = UI.build.s, sp = SPECIALS[s], g = G.grid;
  const k = cellAt(G, x, y);
  if (k < 0) return;
  const i = k % g.w, j = (k / g.w) | 0;
  if (!canPlace(i, j, sp.size[0], sp.size[1])) { toast('Cannot build here (needs flat, buildable land without other public buildings).', 'warn'); return; }
  if (!spend(sp.cost, sp.label)) return;
  for (let b = j; b < j + sp.size[1]; b++) for (let a = i; a < i + sp.size[0]; a++) {
    const q = b * g.w + a;
    g.special[q] = s; g.zone[q] = 0; g.level[q] = 0;
  }
  news(`${sp.label} built in ${G.districts[g.district[k]].name}.`);
  R.baseDirty = true;
  refreshDerived(); requestAssess();
}

// ---------------------------------------------------------- transit tools
function railClick(x, y) {
  const t = UI.tool, tr = UI.transit;
  const r = pxToKm(12);
  let hit = null, bd = r;
  for (const s of Object.values(G.transit.stations)) {
    if (s.type !== t) continue;
    const d = Math.hypot(s.x - x, s.y - y);
    if (d < bd) { bd = d; hit = s; }
  }
  if (!tr.draft) tr.draft = { type: t, pts: [] };
  const pts = tr.draft.pts;
  const p = hit ? { id: hit.id, x: hit.x, y: hit.y } : { x, y };
  const last = pts[pts.length - 1];
  if (last && Math.hypot(last.x - p.x, last.y - p.y) < pxToKm(5)) { finishTransit(); return; }
  if (hit && pts.some(q => q.id === hit.id)) { toast('This station is already on the line.', 'warn'); return; }
  pts.push(p);
  renderTransitOptions($('#toolopts'), t);
}

function busClick(x, y) {
  const tr = UI.transit, net = G.net, r = pxToKm(12);
  let node = nearestNode(net, x, y, r, n => n.e.some(id => net.roads[net.edges[id].road].type !== 'pedestrian'));
  if (!node) {
    const e = nearestEdge(net, x, y, r, e => net.roads[e.road].type !== 'pedestrian');
    if (!e) { toast('Bus stops must be placed on a road.', 'warn'); return; }
    node = splitEdge(G, net, e.edge.id, e.x, e.y);
    afterNetworkChange();
  }
  if (!tr.draft) tr.draft = { type: 'bus', pts: [] };
  const pts = tr.draft.pts;
  const last = pts[pts.length - 1];
  if (last && last.node === node.id) { finishTransit(); return; }
  pts.push({ node: node.id, x: node.x, y: node.y });
  renderTransitOptions($('#toolopts'), 'bus');
}

function transitDraftCost() {
  const tr = UI.transit, d = tr.draft;
  if (!d) return { cost: 0, len: 0, newSt: 0 };
  const spec = TRANSIT[d.type];
  let pts = d.pts;
  if (d.extend) {
    const base = d.type === 'bus' ? G.transit.routes[d.extend] : G.transit.lines[d.extend];
    if (base) {
      if (d.type === 'bus') { const s = G.transit.stops[base.stops[base.stops.length - 1]]; const p = s && stopPos(G, s); if (p) pts = [{ node: s.node, x: p.x, y: p.y, existing: true }, ...pts]; }
      else { const s = G.transit.stations[base.stations[base.stations.length - 1]]; if (s) pts = [{ id: s.id, x: s.x, y: s.y }, ...pts]; }
    }
  }
  let len = 0;
  for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
  let cost, newSt;
  if (d.type === 'bus') {
    newSt = pts.filter(p => !p.existing && !Object.values(G.transit.stops).some(s => s.node === p.node)).length;
    const veh = Math.max(1, Math.ceil((2 * len * 1.3 / spec.speed * 60 + 6) / tr.headway));
    cost = newSt * spec.stationCost + veh * spec.vehCost;
  } else {
    newSt = pts.filter(p => !p.id).length;
    let track = 0;
    const g = G.grid;
    for (let i = 1; i < pts.length; i++) {
      const L = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
      let w = 0;
      for (let s = 0; s < 8; s++) { const k = cellAt(G, pts[i - 1].x + (pts[i].x - pts[i - 1].x) * (s + 0.5) / 8, pts[i - 1].y + (pts[i].y - pts[i - 1].y) * (s + 0.5) / 8); if (k >= 0 && g.terrain[k] === T_WATER) w++; }
      track += L * trackCostPerKm(d.type, tr.elevated) * (1 + (d.type === 'metro' ? 0.3 : 1.5) * w / 8);
    }
    const veh = Math.max(1, Math.ceil((2 * len / spec.speed * 60 + 6) / tr.headway));
    cost = newSt * spec.stationCost + track + veh * spec.vehCost;
  }
  return { cost, len, newSt, pts };
}

function updateTransitPreview() {
  const tr = UI.transit;
  const d = tr.draft;
  const t = UI.tool;
  const col = t === 'bus' ? '#1e88e5' : t === 'metro' ? '#8e24aa' : t === 'lrt' ? '#00acc1' : '#5d4037';
  const est = transitDraftCost();
  const pts = d ? est.pts.map(p => [p.x, p.y]) : [];
  if (mouse.wx !== undefined) pts.push([mouse.wx, mouse.wy]);
  R.preview = { poly: pts, fixed: pts.length - 1, color: col, width: t === 'metro' ? 5 : 3, label: d ? `${d.pts.length} new stop${d.pts.length === 1 ? '' : 's'} · ${fmt.km(est.len)} · ${fmt.money(est.cost)}` : `${TRANSIT[t].label}: click to place first ${t === 'bus' ? 'stop' : 'station'}`, at: mouse.wx !== undefined ? [mouse.wx, mouse.wy] : null };
  const el = $('#tcost');
  if (el) el.innerHTML = d ? `Estimated cost: <b>${fmt.money(est.cost)}</b> (${est.newSt} new ${t === 'bus' ? 'stops' : 'stations'}, ${fmt.km(est.len)})` : '';
}

function finishTransit() {
  const tr = UI.transit, d = tr.draft;
  if (!d) return;
  const est = transitDraftCost();
  const total = est.pts.length;
  if (total < 2) { toast(`A line needs at least two ${d.type === 'bus' ? 'stops' : 'stations'}.`, 'warn'); return; }
  if (!spend(est.cost, 'this line')) return;
  if (d.type === 'bus') {
    const stopIds = d.pts.map(p => addStop(G, p.node).id);
    if (d.extend && G.transit.routes[d.extend]) {
      const r = G.transit.routes[d.extend];
      r.stops.push(...stopIds);
      computeRoutePath(G, r);
      news(`${r.name} extended (${fmt.money(est.cost)}).`);
      select({ kind: 'route', id: r.id });
    } else {
      const r = addRoute(G, stopIds, { headway: tr.headway });
      if (r.broken) toast('Some stops could not be connected by road. Check one-way streets.', 'warn');
      news(`New bus route ${r.name}: ${stopIds.length} stops, every ${r.headway} min.`);
      select({ kind: 'route', id: r.id });
    }
  } else {
    const ids = d.pts.map(p => p.id || addStation(G, d.type, p.x, p.y).id);
    if (d.extend && G.transit.lines[d.extend]) {
      const l = G.transit.lines[d.extend];
      l.stations.push(...ids);
      news(`${l.name} extended by ${ids.length} station(s) (${fmt.money(est.cost)}).`);
      select({ kind: 'line', id: l.id });
    } else {
      const l = addLine(G, d.type, ids, { headway: tr.headway, elevated: tr.elevated });
      news(`${l.name} opens with ${ids.length} stations (${fmt.km(est.len)}, ${fmt.money(est.cost)}).`, 'good');
      select({ kind: 'line', id: l.id });
    }
  }
  tr.draft = null;
  R.preview = null;
  renderToolOptions();
  requestAssess();
}

// ---------------------------------------------------------- bulldoze
function bulldoze(px, py, e) {
  const hit = pick(px, py, true);
  if (!hit) return;
  const s = hit.sel, T = G.transit, net = G.net, g = G.grid;
  if (s.kind === 'station') {
    const st = T.stations[s.id];
    removeStation(G, s.id);
    news(`Removed station ${st.name}.`);
  } else if (s.kind === 'stop') {
    for (const r of Object.values(T.routes)) { r.stops = r.stops.filter(x => x !== s.id); if (r.stops.length < 2) delete T.routes[r.id]; else computeRoutePath(G, r); }
    delete T.stops[s.id];
  } else if (s.kind === 'road') {
    if (e.shiftKey) { for (const ed of roadEdges(net, s.id)) removeEdge(net, ed.id); }
    else removeEdge(net, s.edge);
    const keep = new Set(Object.values(T.stops).map(x => x.node));
    cleanupNodes(net, keep);
    afterNetworkChange();
  } else if (s.kind === 'cell') {
    const k = hit.cell;
    if (g.special[k]) {
      const sp = g.special[k];
      // flood-remove connected footprint of the same special
      const stack = [k], seen = new Set([k]);
      while (stack.length) {
        const q = stack.pop();
        g.special[q] = 0;
        if (sp !== S.AIRPORT && sp !== S.UNIVERSITY) continue;
        const i = q % g.w, j = (q / g.w) | 0;
        for (const [a, b] of [[i + 1, j], [i - 1, j], [i, j + 1], [i, j - 1]]) {
          const n = b * g.w + a;
          if (a >= 0 && b >= 0 && a < g.w && b < g.h && !seen.has(n) && g.special[n] === sp) { seen.add(n); stack.push(n); }
        }
      }
      news(`Demolished ${SPECIALS[sp].label}.`);
    } else { g.zone[k] = 0; g.level[k] = 0; }
    R.baseDirty = true;
    refreshDerived();
  }
  if (UI.sel && (UI.sel.kind === s.kind) && UI.sel.id === s.id) select(null);
  requestAssess();
}

// ===================================================================== inspector
export function select(sel) {
  UI.sel = sel;
  R.selection = sel;
  renderInspector();
}

function panel(html) {
  const el = $('#inspector');
  el.innerHTML = html;
  el.classList.toggle('open', !!html);
  return el;
}

function renderInspector() {
  const s = UI.sel;
  if (!s) return panel('');
  if (s.kind === 'district') return inspectDistrict(s.id);
  if (s.kind === 'cell') return inspectCell(s.id);
  if (s.kind === 'road') return inspectRoad(s.id, s.edge);
  if (s.kind === 'station') return inspectStation(s.id);
  if (s.kind === 'line') return inspectLine(G.transit.lines[s.id], 'line');
  if (s.kind === 'route') return inspectLine(G.transit.routes[s.id], 'route');
  if (s.kind === 'stop') return inspectStop(s.id);
}
function refreshInspectorStats() {
  const s = UI.sel;
  if (!s) return;
  const el = $('#insp-stats');
  if (!el) return renderInspector();
  if (document.activeElement && $('#inspector').contains(document.activeElement) && document.activeElement.type === 'text') return;
  if (s.kind === 'district') { el.innerHTML = districtStatsHTML(s.id); shareBar($('#d-modal'), MODES, MODE_COLORS, G.stats.districts[s.id].modal, MODE_LABELS); drawDistrictChart(s.id); }
  else if (s.kind === 'road') el.innerHTML = roadStatsHTML(s.id);
  else if (s.kind === 'line' || s.kind === 'route') { const l = s.kind === 'line' ? G.transit.lines[s.id] : G.transit.routes[s.id]; if (l) el.innerHTML = lineStatsHTML(l); }
  else if (s.kind === 'cell') el.innerHTML = cellStatsHTML(s.id);
  else if (s.kind === 'station') el.innerHTML = stationStatsHTML(s.id);
}
const close = '<button class="close" id="insp-close" title="Close">✕</button>';
function bindClose(el) { $('#insp-close', el).onclick = () => select(null); }

// ---------------- district
function districtStatsHTML(id) {
  const ds = G.stats.districts[id], D = G.districts[id];
  const pct = fmt.pct;
  const sus = SUSTAINABLE.reduce((s, m) => s + ds.modal[m], 0);
  return `
    <div class="kpis3">
      <div><b>${fmt.num(ds.pop)}</b><span>residents</span></div>
      <div><b>${fmt.num(ds.density)}</b><span>per km²</span></div>
      <div><b>${fmt.num(ds.jobs)}</b><span>jobs</span></div>
    </div>
    <h4>Modal share (trips from ${esc(D.name)})</h4>
    <div class="sharebar" id="d-modal"></div>
    <div class="legend-inline">${MODES.filter(m => ds.modal[m] > 0.005).map(m => `<span><i style="background:${MODE_COLORS[m]}"></i>${MODE_LABELS[m]} ${pct(ds.modal[m])}</span>`).join('')}</div>
    <table class="kv">
      <tr><td>Avg trip time</td><td>${ds.commute.toFixed(1)} min</td></tr>
      <tr><td>Walk, bike and transit share</td><td>${pct(sus)}</td></tr>
      <tr><td>Road congestion</td><td style="color:${vcColor(ds.congestion + 0.5)}">+${pct(ds.congestion)} travel time</td></tr>
      <tr><td>Retail vitality (shops)</td><td>${meter(ds.vitality / 2)} ${ds.vitality.toFixed(2)}</td></tr>
      <tr><td>Land-use mix</td><td>${meter(ds.mix)} ${pct(ds.mix)}</td></tr>
      <tr><td>Walkability</td><td>${meter(ds.walkQ / 1.6)} ${ds.walkQ.toFixed(2)}</td></tr>
      <tr><td>Cycling infrastructure</td><td>${meter(ds.bikeQ)} ${pct(ds.bikeQ)}</td></tr>
      <tr><td>Jobs: commercial / office / industry</td><td>${fmt.num(ds.jC)} / ${fmt.num(ds.jO)} / ${fmt.num(ds.jI)}</td></tr>
      <tr><td>Roads (lane-km)</td><td>${ds.roadKm.toFixed(1)} km (${ds.laneKm.toFixed(0)})</td></tr>
      <tr><td>Bus lanes</td><td>${ds.busLaneKm.toFixed(1)} km</td></tr>
      <tr><td>Transit coverage</td><td>${pct(ds.cov.any)} of residents</td></tr>
      <tr><td class="sub">Metro / Rail / LRT / Bus</td><td>${pct(ds.cov.metro)} / ${pct(ds.cov.rail)} / ${pct(ds.cov.lrt)} / ${pct(ds.cov.bus)}</td></tr>
      <tr><td>Street style mix</td><td>${Object.entries(ds.styleMix).filter(([, v]) => v > 0.01).map(([k, v]) => `${STYLES[k].flag}${Math.round(v * 100)}%`).join(' ') || '—'}</td></tr>
    </table>`;
}
function meter(v) { return `<span class="meter"><b style="width:${clamp(v, 0, 1) * 100}%"></b></span>`; }

function inspectDistrict(id) {
  const D = G.districts[id], law = D.law;
  const el = panel(`${close}
    <div class="ihead" style="--c:${D.color}"><small>District</small><h2>${esc(D.name)} <span>${D.zh}</span></h2><small>${D.area.toFixed(1)} km²</small></div>
    <div id="insp-stats">${districtStatsHTML(id)}</div>
    <h4>Population history</h4><canvas class="chart small" id="d-chart"></canvas>
    <h3>Zoning law</h3>
    <div class="presets">
      <button data-p="mixed">Mixed-use (Taipei style)</button><button data-p="res">Residential only</button>
      <button data-p="euclid">Separated uses</button><button data-p="tod">Transit-oriented, tall</button>
    </div>
    <div class="zonelaw">${[1, 2, 3, 4, 5].map(z => `<label style="--c:${ZONES[z].color}"><input type="checkbox" data-zl="${z}" ${law.allow[z] ? 'checked' : ''}><i></i>${ZONES[z].label}</label>`).join('')}</div>
    <label class="row">Max building height <span><input type="range" min="1" max="6" step="1" id="zl-max" value="${law.maxLevel}"><em>${levelLabel(law.maxLevel)}</em></span></label>
    <label class="row"><span>Parking minimums <small>(more car use)</small></span><input type="checkbox" id="zl-park" ${law.parkingMin ? 'checked' : ''}></label>
    <label class="row"><span>Allow informal growth along roads</span><input type="checkbox" id="zl-org" ${law.organic ? 'checked' : ''}></label>
    <label class="row">Default building style <select id="zl-style">${BSTYLES.map(b => `<option value="${b.key}" ${(law.style || 'taipei') === b.key ? 'selected' : ''}>${b.label} ${b.zh}</option>`).join('')}</select></label>
    <p class="note">Disallowed zones and buildings over the height limit are phased out gradually. Mixed-use districts keep trips short and local, so walking, cycling and shops benefit. Single-use districts push people into longer trips by car.</p>`);
  bindClose(el);
  shareBar($('#d-modal', el), MODES, MODE_COLORS, G.stats.districts[id].modal, MODE_LABELS);
  drawDistrictChart(id);
  const apply = () => { R.baseDirty = true; requestAssess(); };
  $$('[data-zl]', el).forEach(cb => cb.onchange = () => { law.allow[+cb.dataset.zl] = cb.checked; apply(); });
  $('#zl-max', el).oninput = e => { law.maxLevel = +e.target.value; e.target.nextElementSibling.textContent = levelLabel(law.maxLevel); };
  $('#zl-max', el).onchange = apply;
  $('#zl-park', el).onchange = e => { law.parkingMin = e.target.checked; apply(); };
  $('#zl-org', el).onchange = e => { law.organic = e.target.checked; };
  $('#zl-style', el).onchange = e => { law.style = e.target.value; R.baseDirty = true; requestAssess(); };
  $$('[data-p]', el).forEach(b => b.onclick = () => {
    const p = b.dataset.p;
    if (p === 'mixed') { law.allow = [false, true, true, true, true, true]; law.maxLevel = 6; law.parkingMin = false; }
    if (p === 'res') { law.allow = [false, true, false, false, false, false]; law.maxLevel = 3; law.parkingMin = true; }
    if (p === 'euclid') { law.allow = [false, true, true, false, true, true]; law.maxLevel = 5; law.parkingMin = true; }
    if (p === 'tod') { law.allow = [false, true, true, true, true, false]; law.maxLevel = 6; law.parkingMin = false; }
    news(`${D.name} adopts a new zoning law.`);
    apply(); inspectDistrict(id);
  });
}
function drawDistrictChart(id) {
  const cv = $('#d-chart');
  if (!cv) return;
  lineChart(cv, [{ name: 'pop', color: G.districts[id].color, data: G.history.map(h => [h.year, h.dpop?.[id] || 0]) }]);
}
const HEIGHT_SHORT = ['', '≤2F', '≤4F', '≤6F', '≤12F', '≤25F', '60F'];
const levelLabel = l => ['', 'L1: 1–2 floors', 'L2: 3–4 floors', 'L3: 5–6 floors', 'L4: 7–12 floors', 'L5: 13–25 floors', 'L6: towers 25+'][l];

// ---------------- cell
function cellStatsHTML(k) {
  const g = G.grid;
  const z = g.zone[k], l = g.level[k], sp = g.special[k];
  const cov = g.cov[k];
  const covs = [cov & 2 && 'Metro', cov & 8 && 'Rail', cov & 4 && 'LRT', cov & 1 && 'Bus'].filter(Boolean).join(', ') || 'none';
  const caps = z ? cellCaps(z, l) : [0, 0, 0, 0];
  return `<table class="kv">
    ${sp ? `<tr><td>Public building</td><td>${SPECIALS[sp].label}</td></tr>` : ''}
    <tr><td>Zone</td><td>${z ? ZONES[z].label : (g.terrain[k] === T_MTN ? 'Hillside (unzoned)' : 'Unzoned')}</td></tr>
    ${z ? `<tr><td>Building</td><td>${l ? levelLabel(l) : 'Vacant lot'}</td></tr><tr><td>Max level here</td><td>${maxLevelFor(k)}${g.noise[k] & 2 ? ' (airport height limit)' : ''}</td></tr>` : ''}
    <tr><td>Residents</td><td>${fmt.num(g.pop[k])}${caps[0] ? ` / ${fmt.num(caps[0])}` : ''}</td></tr>
    <tr><td>Jobs</td><td>${fmt.num(g.jobs[k])}</td></tr>
    <tr><td>Land value</td><td>${meter(g.lv[k] / 3)} ${g.lv[k].toFixed(2)}</td></tr>
    <tr><td>Road access</td><td>${['<span class="bad">None: cannot grow</span>', 'Street', 'Avenue', 'Major road'][g.access[k]]}${g.seeded[k] && !g.access[k] ? ' (old alleys)' : ''}</td></tr>
    <tr><td>Transit within walking distance</td><td>${covs}</td></tr>
    <tr><td>Nuisance</td><td>${[(g.noise[k] & 1) && 'Expressway noise', (g.noise[k] & 2) && 'Aircraft noise'].filter(Boolean).join(', ') || 'none'}</td></tr>
    <tr><td>Terrain</td><td>${['Outside city', 'Flat land', 'River', 'Hillside'][g.terrain[k]]}</td></tr>
  </table>`;
}
function inspectCell(k) {
  const g = G.grid, d = g.district[k];
  const sp = g.special[k];
  const el = panel(`${close}
    <div class="ihead" style="--c:${sp ? SPECIALS[sp].color : g.zone[k] ? ZONES[g.zone[k]].color : '#aaa'}"><small>${sp ? 'Public building' : 'Parcel'} · ${(cellX(G, k)).toFixed(1)}, ${(cellY(G, k)).toFixed(1)} km</small>
    <h2>${sp ? SPECIALS[sp].label : g.zone[k] ? ZONES[g.zone[k]].label : 'Land'}</h2>
    <a href="#" id="to-district">${esc(G.districts[d].name)} ${G.districts[d].zh} ›</a></div>
    <div id="insp-stats">${cellStatsHTML(k)}</div>
    ${sp === S.AIRPORT ? airportHTML() : ''}
    ${!sp && buildable(G, k) ? `<h3>This parcel</h3>
    <label class="row">Height limit <select id="c-h">${[0, 1, 2, 3, 4, 5, 6].map(h => `<option value="${h}" ${g.hcap[k] === h ? 'selected' : ''}>${h ? levelLabel(h) : 'District law'}</option>`).join('')}</select></label>
    <label class="row">Building style <select id="c-s"><option value="0">District default (${BSTYLES[styleIdx(G.districts[d].law.style)].label})</option>${BSTYLES.map((b, i) => `<option value="${i + 1}" ${g.bstyle[k] === i + 1 ? 'selected' : ''}>${b.label} ${b.zh}</option>`).join('')}</select></label>` : ''}`);
  if ($('#c-h', el)) {
    $('#c-h', el).onchange = e => { g.hcap[k] = +e.target.value; if (g.hcap[k] && g.level[k] > g.hcap[k]) g.level[k] = g.hcap[k]; R.baseDirty = true; refreshDerived(); requestAssess(); };
    $('#c-s', el).onchange = e => { g.bstyle[k] = +e.target.value; R.baseDirty = true; requestAssess(); };
  }
  bindClose(el);
  $('#to-district', el).onclick = e => { e.preventDefault(); select({ kind: 'district', id: d }); };
}
function airportHTML() {
  const e = G.econ;
  return `<h3>Airport</h3><table class="kv">
    <tr><td>Passengers / year</td><td>${fmt.num(e.pax)}</td></tr>
    <tr><td>Airports in the city</td><td>${e.airports}</td></tr>
    <tr><td>Capacity</td><td>${fmt.num(e.airports * 8e6)} pax/yr</td></tr>
    <tr><td>GDP contribution</td><td>NT$${fmt.num(e.pax * 4000)}</td></tr></table>
    <p class="note">Passenger numbers grow with city GDP. From 1979 to 2008 most international flights use Taoyuan instead.</p>`;
}

// ---------------- road
function roadAgg(id) {
  const net = G.net;
  const es = roadEdges(net, id);
  let len = 0, cap = Infinity, vmax = 0, vc = 0, t = 0, t0 = 0;
  for (const e of es) {
    len += e.len;
    for (let d = 0; d < 2; d++) {
      if (e.cap[d] > 0) cap = Math.min(cap, e.cap[d]);
      vmax = Math.max(vmax, e.vol[d]);
      vc = Math.max(vc, e.vc?.[d] || 0);
    }
    if (e.t[0] < Infinity) { t += e.t[0]; t0 += e.t0[0]; }
  }
  return { es, len, cap, vmax, vc, t, t0 };
}
function roadStatsHTML(id) {
  const r = G.net.roads[id];
  if (!r) return '';
  const a = roadAgg(id);
  const car = r.type !== 'pedestrian';
  const spd = a.t > 0 ? a.len / (a.t / 60) : 0;
  return `<table class="kv">
    <tr><td>Length</td><td>${fmt.km(a.len)} (${a.es.length} segments)</td></tr>
    <tr><td>Cross-section width</td><td>${roadWidthM(r.type, r.cfg).toFixed(1)} m</td></tr>
    ${car ? `<tr><td>Capacity (bottleneck)</td><td>${fmt.num(a.cap)} veh/h per direction</td></tr>
    <tr><td>Peak volume (max)</td><td>${fmt.num(a.vmax)} veh/h</td></tr>
    <tr><td>Volume ÷ capacity</td><td><b style="color:${vcColor(a.vc)}">${a.vc.toFixed(2)}</b> ${a.vc > 1 ? '(over capacity)' : a.vc > 0.85 ? '(congested)' : ''}</td></tr>
    <tr><td>Travel time end to end</td><td>${a.t.toFixed(1)} min (free ${a.t0.toFixed(1)})</td></tr>
    <tr><td>Delay</td><td>${(a.t - a.t0).toFixed(1)} min · avg ${spd.toFixed(0)} km/h</td></tr>` : '<tr><td>Traffic</td><td>Pedestrians only</td></tr>'}
    <tr><td>Build value</td><td>${fmt.money(a.es.reduce((s, e) => s + e.len * costPerKm(r.type, r.cfg) * terrainMult(e), 0))}</td></tr>
  </table>`;
}
function inspectRoad(id, edgeId) {
  const net = G.net, r = net.roads[id];
  if (!r) return panel('');
  const T = ROAD_TYPES[r.type];
  const el = panel(`${close}
    <div class="ihead" style="--c:${T.casing}"><small>${T.label} · ${STYLES[r.cfg.style].flag} ${STYLES[r.cfg.style].label} style</small>
    <h2><input id="rname" value="${esc(r.name)}"></h2></div>
    <div id="insp-stats">${roadStatsHTML(id)}</div>
    <h3>Configuration</h3>
    <label class="row">Road type <select id="rtype">${Object.entries(ROAD_TYPES).map(([k, t]) => `<option value="${k}" ${k === r.type ? 'selected' : ''}>${t.label}</option>`).join('')}</select></label>
    <div id="rcfg"></div>
    <div class="costline" id="rcost"></div>
    <div class="btnrow">${r.cfg.oneWay ? '<button id="rrev">⇄ Reverse direction</button>' : ''}<button id="rdel" class="danger">Demolish road</button></div>`);
  bindClose(el);
  $('#rname', el).onchange = e => { r.name = e.target.value; };
  let lastCost = 0;
  const value = () => roadEdges(net, id).reduce((s, e) => s + e.len * costPerKm(r.type, r.cfg) * terrainMult(e), 0);
  let before = value();
  const onChange = () => {
    const after = value();
    const diff = after - before;
    if (diff > 0) {
      if (!spend(diff * 1.05, 'the upgrade')) { /* revert not tracked; allow debt check */ }
      lastCost += diff * 1.05;
    }
    before = after;
    $('#rcost', el).innerHTML = lastCost > 0 ? `Upgrade works so far: <b>${fmt.money(lastCost)}</b>` : 'Downgrades are free.';
    afterNetworkChange();
  };
  roadCfgEditor($('#rcfg', el), r.type, r.cfg, onChange);
  $('#rtype', el).onchange = e => {
    const nt = e.target.value;
    const nc = defaultCfg(nt, r.cfg.style);
    nc.oneWay = r.cfg.oneWay && nt !== 'pedestrian';
    r.type = nt; r.cfg = nc;
    onChange();
    inspectRoad(id, edgeId);
  };
  if ($('#rrev', el)) $('#rrev', el).onclick = () => {
    for (const e of roadEdges(net, id)) { const t = e.a; e.a = e.b; e.b = t; e.vol = [e.vol[1], e.vol[0]]; }
    net.ver++;
    afterNetworkChange();
    toast('Direction reversed.');
  };
  $('#rdel', el).onclick = () => {
    for (const e of roadEdges(net, id)) removeEdge(net, e.id);
    cleanupNodes(net, new Set(Object.values(G.transit.stops).map(s => s.node)));
    afterNetworkChange();
    select(null);
  };
}

// ---------------- station / stop
function stationStatsHTML(id) {
  const st = G.transit.stations[id];
  if (!st) return '';
  const ls = stationLines(G, id);
  let board = 0;
  for (const l of ls) board += (l.ridership || 0) / Math.max(1, l.stations.length);
  const g = G.grid, r = TRANSIT[st.type].radius;
  let pop = 0, jobs = 0;
  for (let k = 0; k < g.n; k++) { const dx = cellX(G, k) - st.x, dy = cellY(G, k) - st.y; if (dx * dx + dy * dy <= r * r) { pop += g.pop[k]; jobs += g.jobs[k]; } }
  return `<table class="kv">
    <tr><td>Lines</td><td>${ls.map(l => `<a href="#" data-line="${l.id}" class="chip" style="--c:${l.color}">${esc(l.name)}</a>`).join(' ') || '<span class="bad">Not on any line</span>'}</td></tr>
    <tr><td>Est. daily boardings</td><td>${fmt.num(board)}</td></tr>
    <tr><td>Walk catchment (${r * 1000} m)</td><td>${fmt.num(pop)} residents · ${fmt.num(jobs)} jobs</td></tr>
  </table>`;
}
function inspectStation(id) {
  const st = G.transit.stations[id];
  if (!st) return panel('');
  const el = panel(`${close}
    <div class="ihead" style="--c:${TRANSIT[st.type].color}"><small>${TRANSIT[st.type].label} station · ${st.district >= 0 ? esc(G.districts[st.district].name) : 'outside city'}</small>
    <h2><input id="sname" value="${esc(st.name)}"></h2></div>
    <div id="insp-stats">${stationStatsHTML(id)}</div>
    <div class="btnrow"><button id="sdel" class="danger">Demolish station</button></div>`);
  bindClose(el);
  $('#sname', el).onchange = e => { st.name = e.target.value; };
  el.addEventListener('click', e => { const a = e.target.closest('[data-line]'); if (a) { e.preventDefault(); select({ kind: 'line', id: +a.dataset.line }); } });
  $('#sdel', el).onclick = () => { removeStation(G, id); select(null); requestAssess(); };
}
function inspectStop(id) {
  const s = G.transit.stops[id];
  if (!s) return panel('');
  const rs = Object.values(G.transit.routes).filter(r => r.stops.includes(id));
  const el = panel(`${close}<div class="ihead" style="--c:#1e88e5"><small>Bus stop</small><h2>Stop #${id}</h2></div>
    <table class="kv"><tr><td>Routes</td><td>${rs.map(r => `<a href="#" data-route="${r.id}" class="chip" style="--c:${r.color}">${esc(r.name)}</a>`).join(' ') || 'none'}</td></tr>
    <tr><td>District</td><td>${s.district >= 0 ? G.districts[s.district].name : '—'}</td></tr></table>`);
  bindClose(el);
  el.addEventListener('click', e => { const a = e.target.closest('[data-route]'); if (a) { e.preventDefault(); select({ kind: 'route', id: +a.dataset.route }); } });
}

// ---------------- line / route
function lineStatsHTML(l) {
  const spec = TRANSIT[l.type];
  const len = l.type === 'bus' ? l.len : lineLength(G, l);
  const veh = lineVehicles(G, l);
  const wi = wageIndex();
  const ops = veh * spec.opsPerVeh * wi, fares = (l.ridership || 0) * spec.fare * wi * 330 / 1e6;
  const lf = l.lf || 0;
  return `<div class="kpis3">
      <div><b>${fmt.num(l.ridership || 0)}</b><span>riders/day</span></div>
      <div><b>${fmt.num(lineCapacity(l))}</b><span>capacity pax/h/dir</span></div>
      <div><b style="color:${lf > 1 ? '#e53935' : lf > 0.85 ? '#fb8c00' : 'inherit'}">${Math.round(lf * 100)}%</b><span>peak load</span></div>
    </div>
    <div class="loadbar"><b style="width:${Math.min(100, lf * 100)}%;background:${lf > 1 ? '#e53935' : lf > 0.85 ? '#fb8c00' : '#43a047'}"></b></div>
    <table class="kv">
      <tr><td>Length</td><td>${fmt.km(len)} · ${l.type === 'bus' ? l.stops.length + ' stops' : l.stations.length + ' stations'}</td></tr>
      <tr><td>Vehicles in service</td><td>${veh} × ${spec.cap} pax</td></tr>
      <tr><td>Peak-hour load</td><td>${fmt.num(l.peakLoad || 0)} pax/h</td></tr>
      ${l.type === 'bus' ? `<tr><td>On bus lanes</td><td>${fmt.pct(l.busLaneFrac || 0)}</td></tr>` : ''}
      ${l.crowdPen > 0.5 ? `<tr><td>Crowding penalty</td><td class="bad">+${l.crowdPen.toFixed(1)} min</td></tr>` : ''}
      <tr><td>Operating cost</td><td>${fmt.money(ops)}/yr</td></tr>
      <tr><td>Fare revenue</td><td>${fmt.money(fares)}/yr (farebox ${fmt.pct(fares / Math.max(ops, 0.01))})</td></tr>
      ${l.broken ? '<tr><td colspan="2" class="bad">⚠ Route broken: stops are not connected by road.</td></tr>' : ''}
    </table>`;
}
function inspectLine(l, kind) {
  if (!l) return panel('');
  const spec = TRANSIT[l.type];
  const maxH = l.type === 'bus' ? 60 : 30;
  const el = panel(`${close}
    <div class="ihead" style="--c:${l.color}"><small>${spec.label}${l.elevated ? ' (elevated)' : ''}</small><h2><input id="lname" value="${esc(l.name)}"></h2></div>
    <div id="insp-stats">${lineStatsHTML(l)}</div>
    <label class="row">Colour <input type="color" id="lcol" value="${l.color}"></label>
    <label class="row">Headway <span><input type="range" min="2" max="${maxH}" step="1" id="lhw" value="${l.headway}"><em>every ${l.headway} min</em></span></label>
    <p class="note">More frequent service means shorter waits and more riders, but more vehicles (${fmt.money(spec.vehCost)} each) and higher operating cost.</p>
    ${kind === 'line' ? `<h4>Stations</h4><ol class="stations">${l.stations.map(id => G.transit.stations[id]).filter(Boolean).map(s => `<li><a href="#" data-st="${s.id}">${esc(s.name)}</a></li>`).join('')}</ol>` : ''}
    <div class="btnrow"><button id="lext">➕ Extend</button><button id="ldel" class="danger">Close ${kind === 'route' ? 'route' : 'line'}</button></div>`);
  bindClose(el);
  $('#lname', el).onchange = e => { l.name = e.target.value; };
  $('#lcol', el).oninput = e => { l.color = e.target.value; V.rebuild(); };
  let vehBefore = lineVehicles(G, l);
  $('#lhw', el).oninput = e => { l.headway = +e.target.value; e.target.nextElementSibling.textContent = `every ${l.headway} min`; };
  $('#lhw', el).onchange = () => {
    const v = lineVehicles(G, l);
    if (v > vehBefore) spend((v - vehBefore) * spec.vehCost, 'new vehicles');
    vehBefore = v;
    requestAssess();
  };
  el.addEventListener('click', e => { const a = e.target.closest('[data-st]'); if (a) { e.preventDefault(); select({ kind: 'station', id: +a.dataset.st }); } });
  $('#lext', el).onclick = () => {
    setTool(l.type === 'bus' ? 'bus' : l.type);
    UI.transit.draft = { type: l.type, pts: [], extend: l.id };
    UI.transit.headway = l.headway;
    renderToolOptions();
  };
  $('#ldel', el).onclick = () => {
    if (kind === 'route') delete G.transit.routes[l.id]; else delete G.transit.lines[l.id];
    news(`${l.name} closed.`);
    select(null); requestAssess(); V.rebuild();
  };
}

// ===================================================================== stats modal
let statsTab = 'overview';
export function openStats(tab) {
  if (tab) statsTab = tab;
  $('#modal').classList.add('open');
  renderStats();
}
function closeModal() { $('#modal').classList.remove('open'); }

function renderStats() {
  const m = $('#modal .box');
  const tabs = { overview: 'Overview', economy: 'Population & economy', mobility: 'Modal share', transit: 'Transit', roads: 'Roads', districts: 'Districts', news: 'News' };
  m.innerHTML = `<div class="mhead"><h2>City statistics · ${MONTHS[G.month]} ${G.year}</h2><button class="close" id="mclose">✕</button></div>
    <div class="tabs">${Object.entries(tabs).map(([k, v]) => `<button data-tab="${k}" class="${k === statsTab ? 'on' : ''}">${v}</button>`).join('')}</div>
    <div class="mbody" id="mbody"></div>`;
  $('#mclose').onclick = closeModal;
  $$('[data-tab]', m).forEach(b => b.onclick = () => { statsTab = b.dataset.tab; renderStats(); });
  const body = $('#mbody');
  ({ overview: statsOverview, economy: statsEconomy, mobility: statsMobility, transit: statsTransit, roads: statsRoads, districts: statsDistricts, news: statsNews })[statsTab](body);
}

function statsOverview(el) {
  const sc = computeScore(), st = G.stats, e = G.econ;
  const bars = [['Prosperity', sc.prosperity, 'GDP per capita compared with what the era could reach'], ['Mobility', sc.mobility, 'Average trip time'], ['Congestion', sc.congestion, 'Road delay at the peak hour'], ['Sustainability', sc.sustainability, 'Share of walk, bike and transit trips'], ['Transit', sc.transit, 'Coverage and a healthy load factor'], ['Growth', sc.growth, 'Population compared with historical demand']];
  const ops = annualOps();
  el.innerHTML = `<div class="ov">
    <div class="grade" data-grade="${sc.grade}"><b>${sc.grade}</b><span>${Math.round(sc.total)}/100</span><small>Planner rating</small></div>
    <div class="scorebars">${bars.map(([n, v, d]) => `<div title="${d}"><span>${n}</span><b><i style="width:${v}%"></i></b><em>${Math.round(v)}</em></div>`).join('')}</div>
  </div>
  <div class="grid2">
    <table class="kv">
      <tr><th colspan="2">City</th></tr>
      <tr><td>Population</td><td>${fmt.num(G.pop)} <small>(historical demand ${fmt.num(interp(DEMAND, G.year + G.month / 12) * 1e6)})</small></td></tr>
      <tr><td>Jobs</td><td>${fmt.num(G.jobs)}</td></tr>
      <tr><td>GDP</td><td>NT$${fmt.num(e.gdp * 1e9)}/yr</td></tr>
      <tr><td>GDP per capita</td><td>NT$${fmt.num(e.gdppc)}</td></tr>
      <tr><td>Agglomeration (access) effect</td><td>${(e.accBonus * 100).toFixed(1)}%</td></tr>
      <tr><td>Congestion cost</td><td>NT$${fmt.num(e.congCost * 1e9)}/yr</td></tr>
      <tr><td>Airport passengers</td><td>${fmt.num(e.pax)}/yr</td></tr>
      <tr><th colspan="2">Budget (per year)</th></tr>
      <tr><td>Treasury</td><td>${fmt.money(G.funds)}</td></tr>
      <tr><td>Tax revenue (3% of GDP)</td><td>${fmt.money(e.gdp * 30)}</td></tr>
      <tr><td>Fare revenue</td><td>${fmt.money(ops.fares)}</td></tr>
      <tr><td>Transit operations</td><td>−${fmt.money(ops.ops)}</td></tr>
      <tr><td>Road maintenance</td><td>−${fmt.money(ops.roads)}</td></tr>
      <tr><td>Public buildings & airports</td><td>−${fmt.money(ops.services)}</td></tr>
      <tr><td>City services (schools, police, admin)</td><td>−${fmt.money(e.ops.city || 0)}</td></tr>
    </table>
    <table class="kv">
      <tr><th colspan="2">Mobility</th></tr>
      <tr><td>Person trips per day</td><td>${fmt.num(st.trips)}</td></tr>
      <tr><td>Average trip time</td><td>${st.commute.toFixed(1)} min</td></tr>
      <tr><td>Average trip length</td><td>${st.tripKm.toFixed(1)} km</td></tr>
      <tr><td>Peak congestion</td><td>+${fmt.pct(st.congestion)} travel time</td></tr>
      <tr><td>Peak vehicle delay</td><td>${fmt.num(st.delayVehH)} veh·h</td></tr>
      <tr><td>Road network use</td><td>${fmt.pct(st.util)} of capacity</td></tr>
      <tr><td>Walk, bike and transit share</td><td>${fmt.pct(st.sustainable)}</td></tr>
      <tr><td>Residents near transit</td><td>${fmt.pct(st.transitCoverage)}</td></tr>
      <tr><td>Car / scooter ownership</td><td>${st.ownCar.toFixed(2)} / ${st.ownScooter.toFixed(2)} per person</td></tr>
      <tr><td>Retail vitality</td><td>${st.vitality.toFixed(2)}</td></tr>
      <tr><td>Model run time</td><td>${st.assessMs.toFixed(0)} ms</td></tr>
    </table>
  </div>
  <h3>Modal share</h3><div class="sharebar big" id="ov-modal"></div>
  <div class="legend-inline">${MODES.map(m => `<span><i style="background:${MODE_COLORS[m]}"></i>${MODE_LABELS[m]} ${fmt.pct(st.modal[m], 1)}</span>`).join('')}</div>
  <h3>Rating history</h3><canvas class="chart" id="c-score"></canvas>`;
  shareBar($('#ov-modal'), MODES, MODE_COLORS, st.modal, MODE_LABELS);
  lineChart($('#c-score'), [{ color: '#7e57c2', data: G.history.map(h => [h.year, h.score]) }], { yMax: 100 });
}

function statsEconomy(el) {
  el.innerHTML = `<div class="grid2">
    <div><h3>Population</h3><canvas class="chart" id="c-pop"></canvas><p class="note">Dashed line: historical demand for Taipei, based on the census.</p></div>
    <div><h3>GDP (NT$/yr, 2020 prices)</h3><canvas class="chart" id="c-gdp"></canvas></div>
    <div><h3>GDP per capita (NT$)</h3><canvas class="chart" id="c-gdppc"></canvas></div>
    <div><h3>Treasury (NT$ M)</h3><canvas class="chart" id="c-funds"></canvas></div>
    <div><h3>Population by district</h3><canvas class="chart" id="c-dpop"></canvas></div>
    <div><h3>Jobs</h3><canvas class="chart" id="c-jobs"></canvas></div>
  </div>`;
  const H = G.history;
  const hist = [];
  for (let y = 1949; y <= Math.max(G.year, 1960); y++) hist.push([y, interp(DEMAND, y) * 1e6]);
  lineChart($('#c-pop'), [{ color: '#bbb', dash: [4, 4], data: hist }, { color: '#1e88e5', data: H.map(h => [h.year, h.pop]) }]);
  lineChart($('#c-gdp'), [{ color: '#43a047', data: H.map(h => [h.year, h.gdp * 1e9]) }]);
  lineChart($('#c-gdppc'), [{ color: '#fb8c00', data: H.map(h => [h.year, h.gdppc]) }]);
  lineChart($('#c-funds'), [{ color: '#8e24aa', data: H.filter(h => h.funds != null).map(h => [h.year, h.funds]) }], { yMin: Math.min(0, ...H.map(h => h.funds ?? 0)) });
  lineChart($('#c-dpop'), G.districts.map(d => ({ color: d.color, data: H.map(h => [h.year, h.dpop?.[d.id] || 0]) })));
  lineChart($('#c-jobs'), [{ color: '#3949ab', data: H.map(h => [h.year, h.jobs]) }]);
}

function statsMobility(el) {
  const st = G.stats;
  el.innerHTML = `<h3>Modal share over time</h3><canvas class="chart tall" id="c-modal"></canvas>
    <div class="legend-inline">${MODES.map(m => `<span><i style="background:${MODE_COLORS[m]}"></i>${MODE_LABELS[m]} ${fmt.pct(st.modal[m], 1)}</span>`).join('')}</div>
    <div class="grid2"><div><h3>Average trip time (min)</h3><canvas class="chart" id="c-commute"></canvas></div>
    <div><h3>Peak congestion (+% travel time)</h3><canvas class="chart" id="c-cong"></canvas></div></div>
    <h3>Trips per day by mode</h3>
    <table class="tbl"><tr><th>Mode</th><th>Trips/day</th><th>Share</th></tr>${MODES.map(m => `<tr><td><i class="dot" style="background:${MODE_COLORS[m]}"></i>${MODE_LABELS[m]}</td><td>${fmt.num(st.modeTrips[m])}</td><td>${fmt.pct(st.modal[m], 1)}</td></tr>`).join('')}</table>`;
  const rows = G.history.map(h => ({ x: h.year, values: h.modal }));
  if (rows.length === 1) rows.push({ x: rows[0].x + 1, values: rows[0].values });
  stackedArea($('#c-modal'), MODES, MODE_COLORS, rows);
  lineChart($('#c-commute'), [{ color: '#00897b', data: G.history.map(h => [h.year, h.commute]) }]);
  lineChart($('#c-cong'), [{ color: '#e53935', data: G.history.map(h => [h.year, h.congestion * 100]) }]);
}

function statsTransit(el) {
  const st = G.stats;
  const all = [...Object.values(G.transit.lines), ...Object.values(G.transit.routes)].sort((a, b) => (b.ridership || 0) - (a.ridership || 0));
  const types = ['metro', 'rail', 'lrt', 'bus'];
  el.innerHTML = `<div class="kpis4">${types.map(t => `<div><b>${fmt.num(st.ridership[t])}</b><span>${TRANSIT[t].label} riders/day</span><small>capacity ${fmt.num(st.capacity[t])} pax/h/dir</small></div>`).join('')}</div>
    <h3>Daily ridership by mode</h3><canvas class="chart" id="c-rider"></canvas>
    <h3>Lines</h3>
    <table class="tbl"><tr><th>Line</th><th>Type</th><th>Length</th><th>Stops</th><th>Headway</th><th>Vehicles</th><th>Riders/day</th><th>Capacity/h/dir</th><th>Peak load</th></tr>
    ${all.map(l => `<tr data-sel="${l.type === 'bus' ? 'route' : 'line'}:${l.id}" class="clickable"><td><i class="dot" style="background:${l.color}"></i>${esc(l.name)}</td><td>${TRANSIT[l.type].label}</td><td>${(l.type === 'bus' ? l.len : lineLength(G, l)).toFixed(1)} km</td><td>${(l.stops || l.stations).length}</td><td>${l.headway} min</td><td>${lineVehicles(G, l)}</td><td>${fmt.num(l.ridership || 0)}</td><td>${fmt.num(lineCapacity(l))}</td><td style="color:${(l.lf || 0) > 1 ? '#e53935' : 'inherit'}">${fmt.pct(l.lf || 0)}</td></tr>`).join('') || '<tr><td colspan="9">No lines yet.</td></tr>'}</table>`;
  lineChart($('#c-rider'), types.map(t => ({ color: TRANSIT[t].color, data: G.history.map(h => [h.year, h.ridership[t]]) })));
  $$('[data-sel]', el).forEach(tr => tr.onclick = () => { const [k, id] = tr.dataset.sel.split(':'); closeModal(); select({ kind: k, id: +id }); });
}

function statsRoads(el) {
  const st = G.stats, net = G.net;
  const byType = {};
  for (const e of Object.values(net.edges)) { const r = net.roads[e.road]; byType[r.type] = (byType[r.type] || 0) + e.len; }
  const roads = Object.values(net.roads).map(r => ({ r, ...roadAgg(r.id) })).filter(x => x.len > 0).sort((a, b) => b.vc - a.vc).slice(0, 15);
  const styleKm = {};
  for (const e of Object.values(net.edges)) { const r = net.roads[e.road]; styleKm[r.cfg.style] = (styleKm[r.cfg.style] || 0) + e.len; }
  el.innerHTML = `<div class="kpis4">
      <div><b>${st.roadKm.toFixed(0)} km</b><span>road network</span></div>
      <div><b>${st.laneKm.toFixed(0)}</b><span>lane-km</span></div>
      <div><b>${fmt.num(st.capKm)}</b><span>peak capacity (veh·km/h)</span></div>
      <div><b>${fmt.pct(st.util)}</b><span>network utilisation</span></div></div>
    <div class="grid2"><table class="tbl"><tr><th>Type</th><th>Length</th></tr>${Object.entries(byType).map(([k, v]) => `<tr><td>${ROAD_TYPES[k].label}</td><td>${v.toFixed(1)} km</td></tr>`).join('')}</table>
    <table class="tbl"><tr><th>Design style</th><th>Length</th></tr>${Object.entries(styleKm).map(([k, v]) => `<tr><td>${STYLES[k].flag} ${STYLES[k].label}</td><td>${v.toFixed(1)} km</td></tr>`).join('')}</table></div>
    <h3>Most congested roads</h3>
    <table class="tbl"><tr><th>Road</th><th>Type</th><th>Length</th><th>V/C</th><th>Peak veh/h</th><th>Delay</th></tr>
    ${roads.map(x => `<tr class="clickable" data-road="${x.r.id}"><td>${esc(x.r.name)}</td><td>${ROAD_TYPES[x.r.type].label}</td><td>${x.len.toFixed(2)} km</td><td style="color:${vcColor(x.vc)}"><b>${x.vc.toFixed(2)}</b></td><td>${fmt.num(x.vmax)}</td><td>${(x.t - x.t0).toFixed(1)} min</td></tr>`).join('')}</table>`;
  $$('[data-road]', el).forEach(tr => tr.onclick = () => { closeModal(); select({ kind: 'road', id: +tr.dataset.road }); });
}

function statsDistricts(el) {
  const st = G.stats;
  el.innerHTML = `<table class="tbl"><tr><th>District</th><th>Population</th><th>Density /km²</th><th>Jobs</th><th>Green trips</th><th>Car+scooter</th><th>Trip time</th><th>Congestion</th><th>Shops</th><th>Transit coverage</th><th>Zoning</th></tr>
    ${G.districts.map(d => { const ds = st.districts[d.id]; const sus = SUSTAINABLE.reduce((s, m) => s + ds.modal[m], 0); return `<tr class="clickable" data-d="${d.id}"><td><i class="dot" style="background:${d.color}"></i>${d.name} ${d.zh}</td><td>${fmt.num(ds.pop)}</td><td>${fmt.num(ds.density)}</td><td>${fmt.num(ds.jobs)}</td><td>${fmt.pct(sus)}</td><td>${fmt.pct(ds.modal.car + ds.modal.scooter)}</td><td>${ds.commute.toFixed(0)} min</td><td>+${fmt.pct(ds.congestion)}</td><td>${ds.vitality.toFixed(2)}</td><td>${fmt.pct(ds.cov.any)}</td><td>${[1, 2, 3, 4, 5].filter(z => d.law.allow[z]).map(z => ZONES[z].key).join('')} ≤L${d.law.maxLevel}</td></tr>`; }).join('')}</table>`;
  $$('[data-d]', el).forEach(tr => tr.onclick = () => { closeModal(); select({ kind: 'district', id: +tr.dataset.d }); });
}

function statsNews(el) {
  el.innerHTML = `<ul class="newslog">${G.news.map(n => `<li class="${n.kind}"><small>${n.date}</small>${esc(n.text)}</li>`).join('')}</ul>`;
}

// ===================================================================== toasts & dialogs
export function toast(text, kind = 'info') {
  const box = $('#toasts');
  const t = document.createElement('div');
  t.className = 'toast ' + kind;
  t.textContent = text;
  box.prepend(t);
  while (box.children.length > 4) box.lastChild.remove();
  setTimeout(() => t.classList.add('fade'), 6000);
  setTimeout(() => t.remove(), 7000);
}

export function showWelcome(first = false) {
  const m = $('#modal .box');
  $('#modal').classList.add('open');
  m.innerHTML = `<div class="welcome">
    <h1>臺北 Taipei Planner <span>1949 – 2100</span></h1>
    <p>It is 1949. Taipei is a dense, low-rise city of about 700,000 people, getting around mostly on foot, by bicycle and by pedicab. A wave of migration is about to arrive. Over the next 150 years you will shape its streets, zoning, transit and economy.</p>
    <ul>
      <li><b>Roads</b>: design every street in 3D. Set lanes, one-way, sidewalks, bike and bus lanes, signal timing, and a Dutch, Japanese, British or American design style. Expressways rise onto viaducts with automatic interchanges.</li>
      <li><b>Buildings</b>: set height limits and architectural styles (Taipei, modern glass, Japanese, Dutch, British, American) and watch the skyline grow.</li>
      <li><b>Zoning</b>: paint residential, commercial, mixed-use, office and industrial zones, and set each district's zoning law.</li>
      <li><b>Transit</b>: bus routes, metro, light rail and commuter rail. Ridership, capacity and crowding are modelled.</li>
      <li><b>Results</b>: a transport model recomputes trips, modal share, congestion, shop vitality and GDP every quarter.</li>
    </ul>
    <div class="btnrow center">
      <button class="primary big" id="w-new">Start in 1949</button>
      <button class="big" id="w-sandbox">Sandbox (unlimited funds)</button>
      ${hasSave() ? '<button class="big" id="w-load">Continue saved game</button>' : ''}
      ${!first ? '<button class="big" id="w-close">Back to game</button>' : ''}
    </div>
    <p class="note center">3D controls: left-drag pan · right-drag rotate and tilt · scroll zoom · arrow keys move · <kbd>[</kbd> <kbd>]</kbd> rotate<br><kbd>Space</kbd> pause · <kbd>1</kbd>–<kbd>4</kbd> speed · <kbd>S</kbd> statistics · <kbd>F</kbd> whole city · <kbd>Esc</kbd> cancel</p>
  </div>`;
  const start = sandbox => { newGame({ sandbox }); afterLoad(); closeModal(); G.speed = 1; updateSpeedButtons(); };
  $('#w-new').onclick = () => start(false);
  $('#w-sandbox').onclick = () => start(true);
  if ($('#w-load')) $('#w-load').onclick = () => { if (loadGame()) { afterLoad(); closeModal(); } };
  if ($('#w-close')) $('#w-close').onclick = closeModal;
}

function showHelp() {
  const m = $('#modal .box');
  $('#modal').classList.add('open');
  m.innerHTML = `<div class="mhead"><h2>How the city works</h2><button class="close" id="mclose">✕</button></div><div class="mbody help">
    <h3>Controls</h3><p>Left-drag to pan (you grab the ground), right-drag to rotate and tilt the camera, scroll to zoom toward the cursor. Arrow keys move the camera, <kbd>[</kbd> and <kbd>]</kbd> rotate it. <kbd>Space</kbd> pauses, <kbd>1</kbd>–<kbd>4</kbd> set the speed. Tool shortcuts: <kbd>Q</kbd> inspect, <kbd>R</kbd> roads, <kbd>Z</kbd> zoning, <kbd>B</kbd> buildings, <kbd>U</kbd> bus, <kbd>M</kbd> metro, <kbd>L</kbd> light rail, <kbd>T</kbd> rail, <kbd>X</kbd> bulldoze, <kbd>F</kbd> fit map, <kbd>S</kbd> statistics.</p>
    <h3>Growth</h3><p>Regional demand follows Taipei's real population history. Housing and jobs grow on zoned land with road access when demand is higher than capacity. Building height is limited by the era's technology, each district's zoning law, hillsides and airport height limits. When housing is short, informal low-rise housing appears along roads unless the district forbids it.</p>
    <h3>Transport model</h3><p>Every three months (and right after you edit), the model generates about 2.2 trips per resident, sends them to destinations with a gravity model, and splits them between walking, cycling, scooter, car, bus, metro, light rail and rail using a logit model. Car and scooter trips are then assigned to the road network at the peak hour, and congested speeds are found with BPR curves plus signal delay.</p>
    <ul>
      <li><b>Lanes and bus lanes</b> set capacity. A bus lane takes one general lane but makes buses faster and more popular.</li>
      <li><b>Signals</b>: the green split gives capacity to this road, and a longer cycle adds waiting time. Unsignalised junctions use priority control, or roundabouts in UK style.</li>
      <li><b>Sidewalks, arcades and trees</b> raise walkability, which helps walking and retail vitality.</li>
      <li><b>Bike lanes</b> (painted or protected) raise cycling, and Dutch style multiplies the effect.</li>
      <li><b>Styles</b>: NL is bike- and shop-friendly, JP is walk- and transit-friendly, UK favours buses and roundabouts, US gives high car capacity but weaker walking and shops.</li>
      <li><b>Mixed-use zoning</b> shortens trips and keeps them inside the district, which favours walking. Single-use districts generate long car trips. Parking minimums raise car ownership.</li>
      <li><b>Transit</b> is chosen when stations are within walking distance at both ends (bus 400 m, LRT 500 m, metro 800 m, rail 900 m). Headway sets waiting time, and lines over capacity get a crowding penalty.</li>
    </ul>
    <h3>Economy</h3><p>GDP = jobs × era productivity, plus an agglomeration bonus when jobs are reachable quickly, plus retail vitality and office premiums, minus the cost of congestion. The city collects about 3% of GDP as revenue plus fares, and pays for transit operations, road maintenance and services.</p>
    <h3>Rating</h3><p>Prosperity, mobility (trip time), congestion, sustainability (green trip share), transit (coverage and load) and growth make up a 0–100 rating with a grade from S to E.</p></div>`;
  $('#mclose').onclick = closeModal;
}

export function afterLoad() {
  select(null);
  cancelDraft();
  R.baseDirty = true; R.ovDirty = true;
  R.fit();
  V.cars = [];
  V.rebuild();
  updateTopbar(); updateSpeedButtons();
  renderToolOptions();
}
