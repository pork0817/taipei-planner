import { G } from './state.js';
import { Renderer3D } from './r3d/index.js';
import { Vehicles3D } from './r3d/vehicles.js';
import { initUI, showWelcome, afterLoad } from './ui.js';
import { newGame, monthlyTick } from './sim.js';

const canvas = document.getElementById('map');
newGame();                                   // a live 1949 city behind the welcome screen
const R = new Renderer3D(canvas);
const V = new Vehicles3D(R.scene);
R.vehicles = V;
V.r3 = R;
R.initWorld();
initUI(R, V);
afterLoad();
showWelcome(true);

window.addEventListener('resize', () => R.resize());

// game months simulated per real second for each speed setting
const RATES = [0, 0.75, 2, 4, 8];
let last = performance.now(), acc = 0;
function loop(now) {
  const dt = Math.min(250, now - last);
  last = now;
  if (G.speed > 0) {
    acc += dt / 1000 * RATES[G.speed];
    let n = 0;
    while (acc >= 1 && n < 2) { monthlyTick(); acc -= 1; n++; }
    if (acc > 2) acc = 0;
  }
  R.frame(dt);
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

window.G = G; window.R = R; // handy for debugging in the console
