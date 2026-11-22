// THROWAWAY UI harness.
import { Game } from '../src/game/game';
import { Camera } from '../src/render/camera';
import { UI } from '../src/ui/ui';
import { AudioEngine } from '../src/audio/audio';
import { ZoneType } from '../src/game/types';
import { hash2 } from '../src/game/rng';

const q = new URLSearchParams(location.search);
if (q.get('fresh') === '1') { try { localStorage.clear(); } catch {} }
const canvas = document.getElementById('game') as HTMLCanvasElement;
const game = new Game();
const camera = new Camera();
camera.setViewport(innerWidth, innerHeight);
if (q.get('fresh') !== '1') {
  game.newCity('Halcyon Reach', 987654);
  const w = game.world;
  w.funds = 48250; w.maxPopulation = 1800;
  const R = (x0: number, y0: number, x1: number, y1: number) => { for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++) for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) w.setRoad(x, y); };
  const xs = [22, 28, 34, 40];
  for (const y of xs) R(20, y, 42, y);
  for (const x of xs) R(x, 20, x, 42);
  const zones = [ZoneType.Residential, ZoneType.Commercial, ZoneType.Industrial];
  for (let bi = 0; bi < 3; bi++) for (let bj = 0; bj < 3; bj++) {
    const z = zones[(bi * 2 + bj) % 3];
    for (let y = xs[bj] + 1; y < xs[bj + 1]; y++) for (let x = xs[bi] + 1; x < xs[bi + 1]; x++) {
      const t = w.tileAt(x, y)!; if (t.terrain !== 0 || t.road) continue;
      w.setZone(x, y, z); w.setLevel(x, y, 1 + Math.floor(hash2(x, y, 3) * 3));
    }
  }
  w.addBuilding('solar', 18, 24); w.addBuilding('precinct', 29, 29);
  game.sim.recomputeAll();
  for (let i = 0; i < 40; i++) game.sim.step();
  w.budget.history = [420, 610, -380, 880, 1240, 990, -150, 1320, 1610, 1480, 1890, 2105];
  w.tick = 400;
  game.events.emit('stats');
}
game.setSpeed(Number(q.get('speed') ?? '1'));
const ui = new UI(document.getElementById('ui')!, game, camera);
new AudioEngine(game);
let renderer: { render(dt: number, t: number): void; resize(): void } | null = null;
if (q.get('r') === '1') {
  import('../src/render/renderer').then((m) => {
    try { renderer = new m.Renderer(canvas, game, camera); renderer.resize(); camera.zoom = Number(q.get('zoom') ?? '1.1'); camera.centerOnTile(31, 33); } catch (e) { console.error(e); }
  });
} else {
  const ctx = canvas.getContext('2d')!;
  const draw = () => {
    canvas.width = innerWidth; canvas.height = innerHeight;
    const g = ctx.createRadialGradient(innerWidth * 0.5, innerHeight * 0.45, 10, innerWidth * 0.5, innerHeight * 0.5, Math.max(innerWidth, innerHeight) * 0.7);
    g.addColorStop(0, '#2a1640'); g.addColorStop(0.5, '#120c24'); g.addColorStop(1, '#07060d');
    ctx.fillStyle = g; ctx.fillRect(0, 0, innerWidth, innerHeight);
    ctx.strokeStyle = 'rgba(34,229,255,.12)';
    for (let i = -40; i < 40; i++) { ctx.beginPath(); ctx.moveTo(innerWidth / 2 + i * 32, 0); ctx.lineTo(innerWidth / 2 + i * 32 + innerHeight, innerHeight); ctx.stroke(); ctx.beginPath(); ctx.moveTo(innerWidth / 2 + i * 32, 0); ctx.lineTo(innerWidth / 2 + i * 32 - innerHeight, innerHeight); ctx.stroke(); }
  };
  draw();
}
let last = performance.now(); const t0 = last;
function frame(now: number) {
  const dt = Math.min(0.1, (now - last) / 1000); last = now;
  game.update(dt);
  if (renderer) renderer.render(dt, (now - t0) / 1000);
  ui.update(dt);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
(window as any).__h = { game, camera, ui };
