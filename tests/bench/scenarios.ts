// ─────────────────────────────────────────────────────────────────────────────
// Device-check scenarios (docs/MEGACITY.md §12 Step 0b "Device check", §11.6).
// Not a test and not in the shipped build: bench.html (browser) and node.ts
// (the Node reference) run these same functions on today's code, so a device's
// factor is its time divided by the Node time for the same scenario.
//
// The fill is §2.1's method (the prototype scripts' fill.ts) on real regions:
// owned slots are annexed (centre first, then ring 1, then ring 2) and built as
// a road every 4 tiles with 3×3 blocks zoned at levels 1-3 with tiers, a
// reactor every 9th block and a service every 7th.
// ─────────────────────────────────────────────────────────────────────────────

import { benchWork, measureBench, timerResolution, BENCH_NODE_MS } from '../../src/game/device';
import { ringOf, slotRect } from '../../src/game/districts/slots';
import { Game } from '../../src/game/game';
import { Simulation } from '../../src/game/sim';
import { Terrain, type BuildingType, type Region } from '../../src/game/types';
import { World } from '../../src/game/world';

export interface ScenarioSpec {
  id: string;
  region: Region;
  /** Owned and built slots (centre first, then rings). */
  slots: number;
}

/** The §2.8 scenarios at 192 and 320. */
export const SCENARIOS: ScenarioSpec[] = [
  { id: 'r3-1', region: 3, slots: 1 },
  { id: 'r3-9', region: 3, slots: 9 },
  { id: 'r5-1', region: 5, slots: 1 },
  { id: 'r5-9', region: 5, slots: 9 },
  { id: 'r5-25', region: 5, slots: 25 },
];

/** How long each measure runs. `quick` is for a throttled phone proxy or a slow device. */
export interface BenchSize {
  warmSteps: number;
  batches: number;
  batchSteps: number;
  recomputes: number;
  warmDays: number;
  days: number;
  restores: number;
}
export const FULL: BenchSize = { warmSteps: 60, batches: 6, batchSteps: 30, recomputes: 2, warmDays: 30, days: 360, restores: 3 };
export const QUICK: BenchSize = { warmSteps: 20, batches: 4, batchSteps: 12, recomputes: 1, warmDays: 15, days: 180, restores: 2 };

export interface Stat {
  p50: number;
  p95: number;
  max: number;
  n: number;
}

export interface ScenarioResult {
  id: string;
  region: Region;
  slots: number;
  residents: number;
  buildings: number;
  fillMs: number;
  /** Whole-day `sim.step()`, best and median of the batch means. */
  step: { min: number; med: number };
  recomputeAll: { min: number; med: number };
  /**
   * One game day as Game.update runs it (`stepSlice` + `story.onDay`), month ends excluded. Until WP-1 cuts the day
   * into units, `stepSlice` runs one whole day, so this is also the sliced frame's sim work at speed 3.
   */
  day: Stat;
  /** The month-end frame: the day whose step fired `month` (settlement and the story's onMonth). */
  monthEnd: Stat;
  /** Autosave: serialize + stringify, then setItem of that string (when a storage is given). */
  serialize: Stat;
  setItem: Stat | null;
  autosave: Stat;
  saveChars: number;
  /** JSON.parse + Game.restore (deserialize, locked slots, Simulation, recomputeAll, director). */
  restore: { min: number; med: number };
}

export interface BenchEnv {
  now: () => number;
  /** A Storage-like object for the setItem measures (browser localStorage); null in Node. */
  storage: { setItem(k: string, v: string): void; removeItem(k: string): void } | null;
  /** Called between phases (the page yields to paint its log). */
  pause?: () => Promise<void>;
  log?: (s: string) => void;
}

const BENCH_KEY = 'cybercity.bench.tmp';

const r2 = (v: number) => Math.round(v * 100) / 100;
function stat(a: number[]): Stat {
  const s = [...a].sort((x, y) => x - y);
  const q = (p: number) => (s.length ? s[Math.min(s.length - 1, Math.floor(s.length * p))] : 0);
  return { p50: r2(q(0.5)), p95: r2(q(0.95)), max: r2(s.length ? s[s.length - 1] : 0), n: s.length };
}
const minMed = (a: number[]) => {
  const s = [...a].sort((x, y) => x - y);
  return { min: r2(s[0]), med: r2(s[Math.floor(s.length / 2)]) };
};

/** Build one 64×64 slot like the prototype scripts' fill.ts. */
function buildSlot(w: World, x0: number, y0: number, salt: number): void {
  const s = 64;
  for (let y = y0; y < y0 + s; y++) for (let x = x0; x < x0 + s; x++) if ((x - x0) % 4 === 0 || (y - y0) % 4 === 0) w.setRoad(x, y);
  const services: BuildingType[] = ['precinct', 'clinic', 'datahub', 'maglev', 'plaza', 'spire'];
  let k = salt;
  for (let by = 0; by < s / 4; by++)
    for (let bx = 0; bx < s / 4; bx++) {
      const x = x0 + bx * 4 + 1;
      const y = y0 + by * 4 + 1;
      if (x + 2 >= x0 + s || y + 2 >= y0 + s) continue;
      k++;
      if (k % 9 === 0) {
        w.addBuilding('reactor', x, y);
        continue;
      }
      if (k % 7 === 0) {
        w.addBuilding(services[k % services.length], x, y);
        continue;
      }
      const zone = k % 3 === 0 ? 3 : k % 3 === 1 ? 1 : 2;
      for (let dy = 0; dy < 3; dy++)
        for (let dx = 0; dx < 3; dx++) {
          const t = w.tileAt(x + dx, y + dy);
          if (!t || t.terrain !== Terrain.Land || t.buildingId >= 0) continue;
          w.setZone(x + dx, y + dy, zone);
          w.setLevel(x + dx, y + dy, 1 + ((dx + dy + k) % 3), false, ((dx * 7 + dy * 3 + k) % 3) as 0 | 1 | 2);
        }
    }
}

/** A world of the region with `slots` slots owned and built: centre first, then ring 1, then ring 2. */
export function benchWorld(region: Region, slots: number): World {
  const w = new World(99, 'Bench City', undefined, region);
  w.funds = 1e9;
  w.maxPopulation = 1e9;
  const order = Array.from({ length: region * region }, (_, s) => s).sort((a, b) => ringOf(region, a) - ringOf(region, b) || a - b);
  const pick = order.slice(0, slots);
  for (const s of pick) if (!w.slotOwned[s]) w.annex(s);
  pick.forEach((s, i) => {
    const r = slotRect(w, s);
    buildSlot(w, r.x0, r.y0, i * 3);
  });
  return w;
}

/** Run one scenario. */
export async function runScenario(spec: ScenarioSpec, size: BenchSize, env: BenchEnv): Promise<ScenarioResult> {
  const { now } = env;
  const pause = env.pause ?? (async () => {});
  const log = env.log ?? (() => {});
  let t = now();
  const w = benchWorld(spec.region, spec.slots);
  const fillMs = now() - t;

  // 1. Whole-day step and recomputeAll, best of batches.
  const sim = new Simulation(w);
  sim.options.events = true;
  sim.recomputeAll();
  for (let i = 0; i < size.warmSteps; i++) sim.step();
  const steps: number[] = [];
  const recs: number[] = [];
  for (let b = 0; b < size.batches; b++) {
    t = now();
    for (let i = 0; i < size.batchSteps; i++) sim.step();
    steps.push((now() - t) / size.batchSteps);
    t = now();
    for (let i = 0; i < size.recomputes; i++) sim.recomputeAll();
    recs.push((now() - t) / size.recomputes);
    await pause();
  }
  log(`${spec.id}: step ${minMed(steps).min} ms`);

  // 2. Game days as Game.update runs them, month ends apart; an autosave every 3 months.
  const json0 = JSON.stringify(w.serialize());
  const g = new Game();
  if (!g.restore(JSON.parse(json0))) throw new Error('restore failed');
  g.world.maxPopulation = 1e9;
  g.world.funds = 1e9;
  for (let i = 0; i < size.warmDays; i++) {
    g.sim.stepSlice(6);
    g.story.onDay();
  }
  await pause();
  const day: number[] = [];
  const monthEnd: number[] = [];
  const ser: number[] = [];
  const set: number[] = [];
  const save: number[] = [];
  let months = 0;
  let isMonth = false;
  const off = g.world.events.on('month', () => {
    isMonth = true;
  });
  for (let i = 0; i < size.days; i++) {
    isMonth = false;
    const t0 = now();
    g.sim.stepSlice(6);
    g.story.onDay();
    const t1 = now();
    if (!isMonth) {
      day.push(t1 - t0);
      continue;
    }
    monthEnd.push(t1 - t0);
    if (++months % 3 === 0) {
      const s0 = now();
      const str = JSON.stringify(g.world.serialize());
      const s1 = now();
      ser.push(s1 - s0);
      if (env.storage) {
        env.storage.setItem(BENCH_KEY, str);
        const s2 = now();
        set.push(s2 - s1);
        save.push(s2 - s0);
      } else save.push(s1 - s0);
    }
    if (months % 4 === 0) await pause();
  }
  off();
  env.storage?.removeItem(BENCH_KEY);

  // 3. Game.restore of the grown city, with JSON.parse.
  const json = JSON.stringify(g.world.serialize());
  const rest: number[] = [];
  for (let i = 0; i < size.restores; i++) {
    const g2 = new Game();
    await pause();
    const t0 = now();
    const ok = g2.restore(JSON.parse(json));
    rest.push(now() - t0);
    if (!ok) throw new Error('restore failed');
  }
  log(`${spec.id}: day p95 ${stat(day).p95} ms, restore ${minMed(rest).med} ms`);
  return {
    id: spec.id,
    region: spec.region,
    slots: spec.slots,
    residents: Math.round(g.world.stats.population),
    buildings: g.world.buildings.size,
    fillMs: r2(fillMs),
    step: minMed(steps),
    recomputeAll: minMed(recs),
    day: stat(day),
    monthEnd: stat(monthEnd),
    serialize: stat(ser),
    setItem: env.storage ? stat(set) : null,
    autosave: stat(save),
    saveChars: json.length,
    restore: minMed(rest),
  };
}

/** `localStorage.setItem` of strings of these lengths (JSON-like text), `reps` times each. */
export function measureSetItem(env: BenchEnv, lengths = [260_000, 600_000], reps = 7): Record<string, Stat> {
  const out: Record<string, Stat> = {};
  if (!env.storage) return out;
  const unit = '{"x":12,"y":34,"type":"spire","level":3},';
  for (const len of lengths) {
    const base = unit.repeat(Math.ceil(len / unit.length)).slice(0, len - 8);
    const times: number[] = [];
    for (let r = 0; r < reps; r++) {
      const s = base + String(r).padStart(8, '0'); // a different string each time (no same-value shortcut)
      const t0 = env.now();
      env.storage.setItem(BENCH_KEY, s);
      times.push(env.now() - t0);
    }
    env.storage.removeItem(BENCH_KEY);
    out[String(len)] = stat(times);
  }
  return out;
}

/** The §3.11 micro-benchmark: the timer step, the median ms per work unit and the factor against BENCH_NODE_MS. */
export function measureMicro(now: () => number): { timerMs: number; workMs: number; factor: number | null; nodeRefMs: number } {
  const timerMs = timerResolution(now);
  // ms per work unit, measured the way measureBench does (median of 3 runs of ≥ 50 ms), but unscaled.
  const workMs = (measureBench(now, benchWork, 1) ?? NaN) as number;
  const factor = measureBench(now);
  return { timerMs: r2(timerMs * 1000) / 1000, workMs: r2(workMs), factor: factor === null ? null : r2(factor), nodeRefMs: BENCH_NODE_MS };
}
