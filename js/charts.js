// Minimal canvas charts (line, stacked area, horizontal stacked bar).
function setup(canvas) {
  const dpr = window.devicePixelRatio || 1;
  const r = canvas.getBoundingClientRect();
  canvas.width = Math.round(r.width * dpr); canvas.height = Math.round(r.height * dpr);
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return [ctx, r.width, r.height];
}
const css = v => getComputedStyle(document.documentElement).getPropertyValue(v).trim() || '#888';

function niceMax(v) {
  if (v <= 0) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  for (const m of [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (m * p >= v) return m * p;
  return 10 * p;
}

/** series: [{name,color,data:[[x,y],...]}] */
export function lineChart(canvas, series, opts = {}) {
  const [ctx, W, H] = setup(canvas);
  const pad = { l: 52, r: 10, t: 10, b: 22 };
  ctx.clearRect(0, 0, W, H);
  const all = series.flatMap(s => s.data);
  if (!all.length) { ctx.fillStyle = css('--muted'); ctx.font = '12px system-ui'; ctx.fillText('No data yet: let time run.', 12, 24); return; }
  let x0 = opts.x0 ?? Math.min(...all.map(p => p[0])), x1 = opts.x1 ?? Math.max(...all.map(p => p[0]));
  if (x1 === x0) x1 = x0 + 1;
  let y1 = opts.yMax ?? niceMax(Math.max(...all.map(p => p[1])) * 1.05);
  const y0 = opts.yMin ?? 0;
  const X = x => pad.l + (x - x0) / (x1 - x0) * (W - pad.l - pad.r);
  const Y = y => H - pad.b - (y - y0) / (y1 - y0) * (H - pad.t - pad.b);
  axes(ctx, W, H, pad, x0, x1, y0, y1, X, Y, opts.fmt);
  for (const s of series) {
    if (!s.data.length) continue;
    ctx.strokeStyle = s.color; ctx.lineWidth = s.width || 2; ctx.setLineDash(s.dash || []);
    ctx.beginPath();
    s.data.forEach(([x, y], i) => i ? ctx.lineTo(X(x), Y(y)) : ctx.moveTo(X(x), Y(y)));
    ctx.stroke();
  }
  ctx.setLineDash([]);
}

export function stackedArea(canvas, keys, colors, rows, opts = {}) {
  // rows: [{x, values:{key:share}}]
  const [ctx, W, H] = setup(canvas);
  const pad = { l: 40, r: 10, t: 10, b: 22 };
  ctx.clearRect(0, 0, W, H);
  if (rows.length < 1) return;
  let x0 = rows[0].x, x1 = rows[rows.length - 1].x;
  if (x1 === x0) x1 = x0 + 1;
  const X = x => pad.l + (x - x0) / (x1 - x0) * (W - pad.l - pad.r);
  const Y = y => H - pad.b - y * (H - pad.t - pad.b);
  const base = rows.map(() => 0);
  for (const k of keys) {
    ctx.fillStyle = colors[k];
    ctx.beginPath();
    rows.forEach((r, i) => { const y = base[i] + (r.values[k] || 0); i ? ctx.lineTo(X(r.x), Y(y)) : ctx.moveTo(X(r.x), Y(y)); });
    for (let i = rows.length - 1; i >= 0; i--) ctx.lineTo(X(rows[i].x), Y(base[i]));
    ctx.closePath(); ctx.fill();
    rows.forEach((r, i) => { base[i] += r.values[k] || 0; });
  }
  axes(ctx, W, H, pad, x0, x1, 0, 1, X, Y, v => Math.round(v * 100) + '%');
}

function axes(ctx, W, H, pad, x0, x1, y0, y1, X, Y, fmt) {
  ctx.strokeStyle = css('--grid'); ctx.lineWidth = 1;
  ctx.fillStyle = css('--muted'); ctx.font = '11px system-ui';
  ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
  for (let q = 0; q <= 4; q++) {
    const v = y0 + (y1 - y0) * q / 4;
    ctx.beginPath(); ctx.moveTo(pad.l, Y(v)); ctx.lineTo(W - pad.r, Y(v)); ctx.stroke();
    ctx.fillText(fmt ? fmt(v) : short(v), pad.l - 6, Y(v));
  }
  ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  const span = x1 - x0, step = span > 80 ? 20 : span > 40 ? 10 : span > 15 ? 5 : span > 6 ? 2 : 1;
  for (let x = Math.ceil(x0 / step) * step; x <= x1; x += step) ctx.fillText(String(x), X(x), H - pad.b + 5);
  ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
}

function short(v) {
  const a = Math.abs(v);
  if (a >= 1e9) return (v / 1e9).toFixed(1) + 'B';
  if (a >= 1e6) return (v / 1e6).toFixed(1) + 'M';
  if (a >= 1e3) return (v / 1e3).toFixed(0) + 'K';
  return a < 10 && a % 1 ? v.toFixed(1) : Math.round(v);
}

/** horizontal 100% bar into a div (HTML, crisp) */
export function shareBar(el, keys, colors, values, labels) {
  el.innerHTML = '';
  el.classList.add('sharebar');
  for (const k of keys) {
    const v = values[k] || 0;
    if (v < 0.004) continue;
    const s = document.createElement('span');
    s.style.width = (v * 100) + '%';
    s.style.background = colors[k];
    s.title = `${labels[k]}: ${(v * 100).toFixed(1)}%`;
    if (v > 0.07) s.textContent = Math.round(v * 100) + '%';
    el.appendChild(s);
  }
}
