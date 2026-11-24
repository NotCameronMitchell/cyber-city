// The O2–O4 prototype scenarios (docs/MEGACITY.md §2.4, §2.8; scratch src trees with MAP_SIZE patched to one frame)
// for the device check. Plain JS: the prototype trees are not in the repo. build.mjs bundles this file against a tree
// with `--proto <name>=<dir>` ('@proto' → <dir>/src). In a page it runs on load and fills #out; in Node it prints JSON.
import { World } from '@proto/game/world';
import { Simulation } from '@proto/game/sim';
import { Game } from '@proto/game/game';
import { MAP_SIZE, Terrain } from '@proto/game/types';

const N = MAP_SIZE;
const D = 64;
const r2 = (v) => Math.round(v * 100) / 100;
const stat = (a) => {
  const s = [...a].sort((x, y) => x - y);
  const q = (p) => (s.length ? s[Math.min(s.length - 1, Math.floor(s.length * p))] : 0);
  return { p50: r2(q(0.5)), p95: r2(q(0.95)), max: r2(s.length ? s[s.length - 1] : 0), n: s.length };
};
const minMed = (a) => {
  const s = [...a].sort((x, y) => x - y);
  return { min: r2(s[0]), med: r2(s[Math.floor(s.length / 2)]) };
};

function buildRegion(w, x0, y0, s, salt) {
  for (let y = y0; y < y0 + s; y++) for (let x = x0; x < x0 + s; x++) if ((x - x0) % 4 === 0 || (y - y0) % 4 === 0) w.setRoad(x, y);
  const services = ['precinct', 'clinic', 'datahub', 'maglev', 'plaza', 'spire'];
  let k = salt;
  for (let by = 0; by < s / 4; by++)
    for (let bx = 0; bx < s / 4; bx++) {
      const x = x0 + bx * 4 + 1;
      const y = y0 + by * 4 + 1;
      if (x + 2 >= x0 + s || y + 2 >= y0 + s) continue;
      k++;
      if (k % 9 === 0) { w.addBuilding('reactor', x, y); continue; }
      if (k % 7 === 0) { w.addBuilding(services[k % services.length], x, y); continue; }
      const zone = k % 3 === 0 ? 3 : k % 3 === 1 ? 1 : 2;
      for (let dy = 0; dy < 3; dy++)
        for (let dx = 0; dx < 3; dx++) {
          const t = w.tileAt(x + dx, y + dy);
          if (!t || t.terrain !== Terrain.Land || t.buildingId >= 0) continue;
          w.setZone(x + dx, y + dy, zone);
          w.setLevel(x + dx, y + dy, 1 + ((dx + dy + k) % 3), false, (dx * 7 + dy * 3 + k) % 3);
        }
    }
}

function slotsFor(mode) {
  const S = N / D;
  const c = Math.floor(S / 2);
  const out = [];
  if (mode === 'one') out.push([c, c]);
  else if (mode === 'nine') { for (let y = c - 1; y <= c + 1; y++) for (let x = c - 1; x <= c + 1; x++) out.push([x, y]); }
  else for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) out.push([x, y]);
  return out;
}

const SIZES = {
  full: { warmSteps: 60, batches: 6, batchSteps: 30, recomputes: 2, warmDays: 30, days: 360, restores: 3 },
  quick: { warmSteps: 20, batches: 4, batchSteps: 12, recomputes: 1, warmDays: 15, days: 180, restores: 2 },
};

async function runMode(mode, size, now, pause) {
  const w = new World(99, 'Bench City');
  w.funds = 1e9;
  w.maxPopulation = 1e9;
  let salt = 0;
  for (const [sx, sy] of slotsFor(mode)) buildRegion(w, sx * D, sy * D, D, salt++ * 3);
  const sim = new Simulation(w);
  sim.options.events = true;
  sim.recomputeAll();
  for (let i = 0; i < size.warmSteps; i++) sim.step();
  const steps = [];
  const recs = [];
  for (let b = 0; b < size.batches; b++) {
    let t = now();
    for (let i = 0; i < size.batchSteps; i++) sim.step();
    steps.push((now() - t) / size.batchSteps);
    t = now();
    for (let i = 0; i < size.recomputes; i++) sim.recomputeAll();
    recs.push((now() - t) / size.recomputes);
    await pause();
  }
  const g = new Game();
  if (!g.restore(JSON.parse(JSON.stringify(w.serialize())))) throw new Error('restore failed');
  g.world.maxPopulation = 1e9;
  g.world.funds = 1e9;
  for (let i = 0; i < size.warmDays; i++) { g.sim.step(); g.story.onDay(); }
  const day = [];
  const monthEnd = [];
  let isMonth = false;
  const off = g.world.events.on('month', () => { isMonth = true; });
  for (let i = 0; i < size.days; i++) {
    isMonth = false;
    const t0 = now();
    g.sim.step();
    g.story.onDay();
    const dt = now() - t0;
    (isMonth ? monthEnd : day).push(dt);
    if (i % 60 === 0) await pause();
  }
  off();
  return {
    id: `proto${N}-${mode}`, N, mode, residents: Math.round(g.world.stats.population),
    step: minMed(steps), recomputeAll: minMed(recs), day: stat(day), monthEnd: stat(monthEnd),
  };
}

async function runAll(modes, sizeName, now, pause, onResult) {
  const out = [];
  for (const m of modes) {
    const r = await runMode(m, SIZES[sizeName], now, pause);
    out.push(r);
    onResult?.(out);
  }
  return out;
}

const now = () => performance.now();
if (typeof document !== 'undefined') {
  const q = new URLSearchParams(location.search);
  const modes = (q.get('modes') ?? (N > 192 ? 'one,nine,full' : 'one,full')).split(',');
  const report = { env: 'browser', proto: N, ua: navigator.userAgent, quick: q.get('quick') === '1', results: [], done: false };
  window.benchReport = report;
  const out = document.getElementById('out');
  const status = document.getElementById('status');
  const pause = () => new Promise((r) => setTimeout(r, 0));
  const go = async () => {
    try {
      status.textContent = `prototype ${N}…`;
      await runAll(modes, report.quick ? 'quick' : 'full', now, pause, (r) => { report.results = r; out.textContent = JSON.stringify(report, null, 1); });
      report.done = true;
      status.textContent = 'done';
    } catch (e) {
      report.error = String(e && e.stack ? e.stack : e);
      status.textContent = 'failed';
    }
    out.textContent = JSON.stringify(report, null, 1);
  };
  document.getElementById('run').onclick = go;
  if (q.get('auto') === '1') go();
} else {
  const args = process.argv.slice(2);
  const quick = args.includes('--quick');
  const modes = args.filter((a) => !a.startsWith('--'));
  runAll(modes.length ? modes : N > 192 ? ['one', 'nine', 'full'] : ['one', 'full'], quick ? 'quick' : 'full', now, async () => {}).then((results) =>
    console.log(JSON.stringify({ env: 'node', proto: N, version: process.version, quick, results })),
  );
}
