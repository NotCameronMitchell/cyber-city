// Headless measurement of the expansion's balance targets (docs/EXPANSION.md §10.3, §10.4).
//
// Skipped unless MEASURE=1:   MEASURE=1 npx vitest run tests/expansion-measure.test.ts
// Optional: SEEDS=2091,7,31 (default), ONLY=M1,M2,... (default: every scenario), YEARS=8.
//
// Prints one table per scenario for each seed, then one line per target with the measured
// values. It asserts nothing: the regular suite holds the targets that are cheap enough to
// run every time (tests/expansion-balance.test.ts); §10.5 records what this prints.

import { describe, expect, it } from 'vitest';
import { BUILDINGS, POWER_WEIGHTS } from '../src/game/config';
import { Simulation } from '../src/game/sim';
import { powerWeight } from '../src/game/story/factions';
import { DAYS_PER_MONTH, LEGACY_SIZE, RoadKind, Terrain, ZoneType, type Building } from '../src/game/types';
import { World } from '../src/game/world';
import { expansionFixture, fabUpShare, playScenario, resComSplit, type ExpansionMayorOptions, type ScenarioResult } from './expansion-fixture';
import { flatWorld, fullyBuiltWorld } from './helpers';

const N = LEGACY_SIZE;
/** Node's environment (no @types/node in this project). */
const env: Record<string, string | undefined> = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};
const SEEDS = (env.SEEDS ?? '2091,7,31').split(',').map(Number);
const YEARS = Number(env.YEARS ?? 8);
const ONLY = env.ONLY ? new Set(env.ONLY.split(',')) : null;
const want = (id: string) => !ONLY || ONLY.has(id);

const pct = (v: number) => `${v.toFixed(0)}%`;
const f3 = (v: number) => v.toFixed(3);
const signed = (v: number, d = 0) => `${v >= 0 ? '+' : ''}${v.toFixed(d)}`;

function row(name: string, r: ScenarioResult): string {
  const [a, b, c] = resComSplit(r);
  const zs = r.split.map((z) => {
    const t = z[0] + z[1] + z[2] || 1;
    return `${pct((100 * z[0]) / t)}/${pct((100 * z[1]) / t)}/${pct((100 * z[2]) / t)}`;
  });
  return [
    name.padEnd(5),
    `pop ${String(r.pop).padStart(6)}`,
    `appr ${r.approval}`,
    `traffic ${f3(r.avgTraffic)}`,
    `noise ${f3(r.avgNoise)}`,
    `crime ${f3(r.avgCrime)}`,
    `lv ${f3(r.avgLandValue)}`,
    `res+com ${pct(a)}/${pct(b)}/${pct(c)}`,
    `res ${zs[0]} com ${zs[1]} ind ${zs[2]}`,
    `fab$$+ ${pct(fabUpShare(r))}`,
    `jobsInd ${r.jobsInd}`,
    `jobsCom ${r.jobsCom}`,
    `net ${Math.round(r.net)}/mo`,
    `visitors ${r.visitors}`,
    `hw ${f3(r.highwayLoad)}`,
    `sky ${f3(r.skyLoad)}`,
    `tierΔ/tile/yr ${r.tierChangesPerTileYear.toFixed(3)} (max ${r.maxTierChanges2y} in 2y)`,
    `tierFx ${r.tierEffect.residents}/${r.tierEffect.tax >= 0 ? '+' : ''}${r.tierEffect.tax}`,
    `30k@${r.reach[30000]} 70k@${r.reach[70000]}`,
  ].join(' · ');
}

const results = new Map<string, ScenarioResult>();
const key = (id: string, seed: number) => `${id}:${seed}`;

function scenario(id: string, seed: number, make: () => World, opts: ExpansionMayorOptions, years = YEARS): ScenarioResult {
  const k = key(id, seed);
  const hit = results.get(k);
  if (hit) return hit;
  const w = make();
  const r = playScenario(w, years, opts);
  (r as ScenarioResult & { world?: World }).world = w;
  results.set(k, r);
  console.log(`${seed} ${row(id, r)}`);
  return r;
}
const worldOf = (r: ScenarioResult) => (r as ScenarioResult & { world: World }).world;

/** Tiles at Chebyshev distance in [lo, hi] from a building's footprint. */
function ring(b: Building, lo: number, hi: number): number[] {
  const out: number[] = [];
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      const dx = x < b.x ? b.x - x : x >= b.x + b.size ? x - (b.x + b.size - 1) : 0;
      const dy = y < b.y ? b.y - y : y >= b.y + b.size ? y - (b.y + b.size - 1) : 0;
      const d = Math.max(dx, dy);
      if (d >= lo && d <= hi) out.push(y * N + x);
    }
  return out;
}

function first(w: World, type: string): Building | null {
  for (const b of w.buildings.values()) if (b.type === type) return b;
  return null;
}

const flat = (seed: number) => () => flatWorld(seed);
const generated = (seed: number) => () => World.generate(seed, 'Measure Bay');
const lift = (year: number, pop: number) => [{ year, pop }];

describe.skipIf(!env.MEASURE)('expansion measurement (§10.4)', () => {
  it('prints the scenario tables and the §10.3 lines', { timeout: 3_600_000 }, () => {
    const lines: string[] = [];
    for (const seed of SEEDS) {
      const m1 = scenario('M1', seed, flat(seed), {});
      if (want('M2')) {
        const m2 = scenario('M2', seed, flat(seed), { richServices: true });
        const [a, b, c] = resComSplit(m2);
        const [a1, b1, c1] = resComSplit(m1);
        lines.push(`${seed} B2 M1 res+com $ ${pct(a1)} $$ ${pct(b1)} $$$ ${pct(c1)} (target 55-80 / 20-40 / ≤8)`);
        lines.push(`${seed} B3 M2 res+com $ ${pct(a)} $$ ${pct(b)} $$$ ${pct(c)}, fab $$+ ${pct(fabUpShare(m2))} (target ≤45 / 35-60 / 12-30, fab ≥25)`);
        const late = (g: number) => (m2.reach[g] < 0 ? 'never' : m1.reach[g] < 0 ? `${m2.reach[g]} (M1 never)` : signed(m2.reach[g] - m1.reach[g]) + ' d');
        lines.push(
          `${seed} B4 M2 vs M1: net ${signed((100 * (m2.net - m1.net)) / Math.abs(m1.net || 1))}% (≥ +20), pop ${signed((100 * (m2.pop - m1.pop)) / m1.pop, 1)}% (≥ −3), ` +
            `approval ${signed(m2.approval - m1.approval)} (≥ −2), 30k ${late(30000)}, 70k ${late(70000)} (≤ +30 d)`,
        );
        lines.push(`${seed} B10 max tier changes per tile in years ${YEARS - 1}-${YEARS}: M1 ${m1.maxTierChanges2y}, M2 ${m2.maxTierChanges2y} (≤ 4)`);
      }
      if (want('M3')) {
        const m3 = scenario('M3', seed, flat(seed), { avenues: true });
        lines.push(`${seed} B5 M3 avgTraffic ${f3(m3.avgTraffic)} = M1 × ${(m3.avgTraffic / m1.avgTraffic).toFixed(3)} (≤ 0.88)`);
      }
      if (want('M4')) {
        const m4 = scenario('M4', seed, flat(seed), { highwayRing: true });
        // "The same ring with no ramps": the M4 city with every ramp (the ring's and those the mayor's
        // later street drags made where they crossed it) turned back into a street.
        const w4 = worldOf(m4);
        const ramps = w4.stats.roads.ramp;
        const sim4 = (m4 as ScenarioResult & { sim: Simulation }).sim;
        for (let i = 0; i < N * N; i++) if (w4.tiles[i].road && w4.tiles[i].roadKind === RoadKind.Ramp) w4.setRoadKind(i % N, (i / N) | 0, RoadKind.Street);
        sim4.recomputeAll();
        let load = 0;
        for (let i = 0; i < N * N; i++) if (w4.tiles[i].road && w4.tiles[i].roadKind === RoadKind.Highway) load += w4.fields.traffic[i];
        lines.push(
          `${seed} B6 M4 avgTraffic ${f3(m4.avgTraffic)} = M1 × ${(m4.avgTraffic / m1.avgTraffic).toFixed(3)} (≤ 0.82); highway load ${f3(m4.highwayLoad)} with ${ramps} ramps (> 0); ` +
            `the same ring with its ramps made streets carries ${load} (= 0)`,
        );
      }
      if (want('M5')) {
        const m5 = scenario('M5', seed, flat(seed), { alleys: true });
        lines.push(
          `${seed} B7 M5 crime by alleys ${f3(m5.alleyCrime)} − city ${f3(m5.avgCrime)} = ${signed(m5.alleyCrime - m5.avgCrime, 3)} (0.04-0.10); pop ${signed((100 * (m5.pop - m1.pop)) / m1.pop, 1)}% vs M1 (≥ 0)`,
        );
      }
      if (want('M6')) {
        const base = scenario('M6base', seed, generated(seed), {});
        const m6 = scenario('M6', seed, generated(seed), { seaport: true });
        if (m6.portMonth < 0) lines.push(`${seed} B8 M6: no seaport placed (no shore site, or the scripted grid on this generated map never reaches 5,000: pop ${base.pop})`);
        else {
          const at = Math.min(m6.portMonth + 36, m6.monthly.length - 1);
          const dj = m6.monthly[at].jobsInd - base.monthly[at].jobsInd;
          lines.push(
            `${seed} B8 M6 seaport at month ${m6.portMonth}: jobsInd ${signed(dj)} at +${at - m6.portMonth} mo vs no port (+150..+400); Port trade ${m6.monthly[at].trade}/mo (≥ 150)`,
          );
        }
      }
      if (want('M7')) {
        const opts = { liftLocks: lift(3, BUILDINGS.airport.unlockPop) };
        const base = scenario('M7base', seed, flat(seed), opts);
        const m7 = scenario('M7', seed, flat(seed), { ...opts, airport: 3 });
        const air = first(worldOf(m7), 'airport');
        if (!air) lines.push(`${seed} B9 M7: no airport placed`);
        else {
          const wb = worldOf(base);
          const wa = worldOf(m7);
          const lvRing = ring(air, 3, 3).filter((i) => wa.tiles[i].terrain === Terrain.Land);
          let dl = 0;
          for (const i of lvRing) dl += wa.fields.landValue[i] - wb.fields.landValue[i];
          dl /= Math.max(1, lvRing.length);
          const share = (w: World) => {
            let n = 0;
            let up = 0;
            for (const i of ring(air, 8, 16)) {
              const t = w.tiles[i];
              if (t.zone !== ZoneType.Commercial || t.level === 0 || t.abandoned) continue;
              n++;
              if (t.wealth >= 1) up++;
            }
            return { n, share: n ? (100 * up) / n : 0 };
          };
          const sa = share(wa);
          const sb = share(wb);
          lines.push(
            `${seed} B9 M7 airport at (${air.x},${air.y}): jobsCom ${signed(m7.jobsCom - base.jobsCom)} (+150..+500); land value 3 out ${signed(dl, 3)} (−0.08..−0.20)`,
          );
          lines.push(`${seed} B9b M7 Market 8-16 out at $$+: ${pct(sa.share)} of ${sa.n} vs ${pct(sb.share)} of ${sb.n} without = ${signed(sa.share - sb.share)} pts (≥ +15)`);
        }
      }
    }
    if (want('M8')) lines.push(...measureFixture());
    console.log('\n' + lines.join('\n'));
    expect(lines.length).toBeGreaterThan(0);
  });
});

/** M8: fullyBuiltWorld + the expansion fixture: wealth split, spaceport (B11), step cost (B12), power caps (B13). */
function measureFixture(): string[] {
  const out: string[] = [];
  const build = (spaceportDays: number) => {
    const w = fullyBuiltWorld();
    expansionFixture(w, { spaceportDays });
    const sim = new Simulation(w);
    sim.options.events = false;
    sim.recomputeAll();
    sim.settleWealth();
    sim.recomputeAll();
    return { w, sim };
  };
  const months = 12;
  const done = build(0);
  const building = build(100_000);
  let stepMs = 0;
  let steps = 0;
  for (let m = 0; m < months; m++)
    for (let d = 0; d < DAYS_PER_MONTH; d++) {
      const t0 = performance.now();
      done.sim.step();
      stepMs += performance.now() - t0;
      steps++;
      building.sim.step();
    }
  const t0 = performance.now();
  for (let k = 0; k < 10; k++) done.sim.recomputeAll();
  const recompute = (performance.now() - t0) / 10;
  const w = done.w;
  const s = w.stats;
  const sp = first(w, 'spaceport')!;
  const mood = Math.min(1.3, Math.max(0.5, s.approval / 60));
  const tiers = s.wealth;
  const tot = tiers[0] + tiers[1] + tiers[2] || 1;
  const net = w.budget.history.slice(-3).reduce((a, b) => a + b, 0) / 3;
  const upkeep = BUILDINGS.spaceport.upkeep;
  out.push(
    `M8 fixture after ${months} mo: pop ${s.population}, wealth ${pct((100 * tiers[0]) / tot)}/${pct((100 * tiers[1]) / tot)}/${pct((100 * tiers[2]) / tot)}, ` +
      `sky load ${s.roads.skyway} tiles, step ${(stepMs / steps).toFixed(2)} ms, recomputeAll ${recompute.toFixed(2)} ms (B12: < 2 / < 10)`,
  );
  // Land value within the prestige radius (r20), complete vs still building: the city-wide mean is
  // diluted by the fixture's many Spires (prestige max-combines), §10.5.
  const near = ring(sp, 0, BUILDINGS.spaceport.radius);
  const lvNear = (wd: World) => near.reduce((a, i) => a + wd.fields.landValue[i], 0) / Math.max(1, near.length);
  out.push(
    `B11 spaceport ${sp.buildDays ? 'building' : 'complete'}: visitors ${s.visitors} vs 30,000 × mood ${mood.toFixed(2)} = ${Math.round(30000 * mood)}; ` +
      `land value within r${BUILDINGS.spaceport.radius} ${signed(lvNear(w) - lvNear(building.w), 3)}; ` +
      `avgLandValue ${signed(s.avgLandValue - building.w.stats.avgLandValue, 3)} vs still building (≥ +0.03); net ${Math.round(net)}/mo incl. its ${upkeep} upkeep ` +
      `(vs ${Math.round(building.w.budget.history.slice(-3).reduce((a, b) => a + b, 0) / 3)} building)`,
  );
  // B13: alley and skyway terms are capped.
  const probe = new World(5);
  const base = { u: powerWeight(probe, 'undertow'), k: powerWeight(probe, 'kites') };
  probe.stats.roads.alley = 100_000;
  probe.stats.roads.skyway = 100_000;
  out.push(
    `B13 power: 100,000 alleys add ${(powerWeight(probe, 'undertow') - base.u).toFixed(1)} Undertow (cap ${POWER_WEIGHTS.undertow.alleyMax}), ` +
      `100,000 skyway tiles add ${(powerWeight(probe, 'kites') - base.k).toFixed(1)} Kites (cap ${POWER_WEIGHTS.kites.skywayMax})`,
  );
  // Highway ring of the fixture: carries traffic through its 8 ramps.
  let hw = 0;
  let hwSum = 0;
  for (let i = 0; i < N * N; i++)
    if (w.tiles[i].road && w.tiles[i].roadKind === RoadKind.Highway) {
      hw++;
      hwSum += w.fields.traffic[i];
    }
  out.push(`M8 highway ring mean load ${f3(hwSum / Math.max(1, hw))} over ${hw} tiles after ${months} months`);
  return out;
}
