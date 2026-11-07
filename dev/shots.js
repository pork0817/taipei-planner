// Dev helper: build a mature test city and frame fixed camera shots for visual checks.
// In the browser console on the game page:  const s = await import('/dev/shots.js'); await s.setup(); s.shot('xinyi');
import { G } from '../js/state.js';
import * as sim from '../js/sim.js';
import { ll } from '../js/data/taipei.js';
import { STRATEGIES } from './scenarios.js';

export async function setup(year = 2015) {
  document.getElementById('w-sandbox')?.click();
  await new Promise(r => setTimeout(r, 800));
  G.speed = 0;
  const plan = STRATEGIES.historical.slice().sort((a, b) => a[0] - b[0]);
  let ai = 0;
  while (G.year < year) {
    let ch = false;
    while (ai < plan.length && plan[ai][0] <= G.year) { plan[ai][1](); ai++; ch = true; }
    if (ch) { sim.afterNetworkChange(); sim.refreshDerived(); }
    sim.monthlyTick();
  }
  window.R.baseDirty = true; window.R.lastBuild = 0;
}

export const SHOTS = {
  overview: [121.545, 25.075, 22, 0.95, -0.25],
  city: [121.535, 25.045, 4, 0.7, -0.5],
  xinyi: [121.565, 25.036, 1.4, 0.45, -0.9],
  street: [121.528, 25.040, 0.35, 0.38, -0.7],
  river: [121.505, 25.060, 1.2, 0.4, 0.6],
  hills: [121.545, 25.150, 6, 0.45, 2.6],
  expwy: [121.540, 25.085, 0.8, 0.45, -0.3],
  junction: [121.549, 25.0412, 0.16, 0.5, -0.75],
};

export function shot(name) {
  const R = window.R, [lon, lat, d, pitch, yaw] = SHOTS[name];
  const [x, y] = ll(lon, lat);
  R.flyTo(x, y, d); R.pitch = pitch; R.yaw = yaw;
  for (let i = 0; i < 4; i++) R.frame(16);
  return R.gl.info.render;
}
