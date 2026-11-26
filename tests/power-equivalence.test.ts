// O2 (docs/MEGACITY.md §3.3, §11.5 WP-1): the cached-label power grid equals today's whole-map BFS exactly
// (powered, compDeficit, building.powered, the counts; remain up to the order of float subtraction), whole or
// resumed across steps, on 50 random cities with disconnected consumers, zero-supply components and brownouts.

import { describe, expect, it } from 'vitest';
import { blankStats, buildingStats } from '../src/game/buildingStats';
import { Rng } from '../src/game/rng';
import { SimGrid } from '../src/game/sim/grid';
import { PowerGrid, zoneDraw } from '../src/game/sim/power';
import { LEGACY_REGION, ZoneType, type BuildingType, type FrameRegion } from '../src/game/types';
import { World } from '../src/game/world';

/** Today's PowerGrid.compute (Step 0b, dc82c92) as a pure reference over a scanned grid. */
function reference(world: World, g: SimGrid) {
  const N = world.N;
  const area = world.area;
  const { zone, level, abandoned, road, wealth, bld } = g;
  const supplyMul = world.mods.powerSupplyMul;
  const demandMul = world.mods.powerDemandMul;
  const comp = new Int32Array(area).fill(-1);
  const queue = new Int32Array(area);
  const st = blankStats();
  const conductor = (j: number) => road[j] || zone[j] || bld[j] >= 0;
  let count = 0;
  const supply: number[] = [];
  const demand: number[] = [];
  for (let s = 0; s < area; s++) {
    if (comp[s] !== -1 || !conductor(s)) continue;
    const label = count++;
    supply[label] = 0;
    demand[label] = 0;
    let head = 0;
    let tail = 0;
    queue[tail++] = s;
    comp[s] = label;
    while (head < tail) {
      const i = queue[head++];
      const x = i % N;
      for (const j of [x > 0 ? i - 1 : -1, x < N - 1 ? i + 1 : -1, i >= N ? i - N : -1, i < area - N ? i + N : -1]) {
        if (j < 0 || comp[j] !== -1 || !conductor(j)) continue;
        comp[j] = label;
        queue[tail++] = j;
      }
    }
  }
  let totalSupply = 0;
  let totalDemand = 0;
  for (let k = 0; k < g.zonedCount; k++) {
    const z = g.zoned[k];
    const d = zoneDraw(zone[z], level[z], abandoned[z], wealth[z]) * demandMul;
    if (d > 0) {
      demand[comp[z]] += d;
      totalDemand += d;
    }
  }
  for (const b of g.buildings) {
    buildingStats(b, st);
    const c = comp[b.y * N + b.x];
    if (st.powerSupply > 0) {
      if (b.offline === 0) {
        supply[c] += st.powerSupply * supplyMul;
        totalSupply += st.powerSupply * supplyMul;
      }
    } else if (st.powerUse > 0) {
      demand[c] += st.powerUse * demandMul;
      totalDemand += st.powerUse * demandMul;
    }
  }
  const deficit = new Uint8Array(count);
  const remain = new Float64Array(count);
  const brown = new Uint8Array(count);
  let overloaded = false;
  for (let c = 0; c < count; c++) {
    deficit[c] = supply[c] < demand[c] ? 1 : 0;
    if (deficit[c] && supply[c] > 0) overloaded = true;
    remain[c] = supply[c];
  }
  const visited = new Uint8Array(area);
  const powered = new Uint8Array(area);
  const allocated = new Set<number>();
  const bPowered = new Map<number, boolean>();
  let head = 0;
  let tail = 0;
  for (const b of g.buildings) {
    if (b.offline > 0 || buildingStats(b, st).powerSupply <= 0) continue;
    for (let dy = 0; dy < b.size; dy++)
      for (let dx = 0; dx < b.size; dx++) {
        const i = (b.y + dy) * N + b.x + dx;
        if (!visited[i]) {
          visited[i] = 1;
          queue[tail++] = i;
        }
      }
  }
  while (head < tail) {
    const i = queue[head++];
    const c = comp[i];
    const bid = bld[i];
    if (bid >= 0) {
      if (!allocated.has(bid)) {
        allocated.add(bid);
        const b = world.buildings.get(bid)!;
        buildingStats(b, st);
        if (st.powerSupply <= 0) {
          const use = st.powerUse * demandMul;
          if (use <= 0 || remain[c] >= use) {
            remain[c] -= use;
            bPowered.set(b.id, true);
          } else {
            brown[c] = 1;
            bPowered.set(b.id, false);
          }
        }
      }
    } else {
      const d = zoneDraw(zone[i], level[i], abandoned[i], wealth[i]) * demandMul;
      if (d > 0) {
        if (remain[c] >= d) {
          remain[c] -= d;
          powered[i] = 1;
        } else brown[c] = 1;
      } else if (!deficit[c] || (remain[c] > 0 && !brown[c])) powered[i] = 1;
    }
    const x = i % N;
    for (const j of [x > 0 ? i - 1 : -1, x < N - 1 ? i + 1 : -1, i >= N ? i - N : -1, i < area - N ? i + N : -1]) {
      if (j < 0 || visited[j] || comp[j] < 0) continue;
      visited[j] = 1;
      queue[tail++] = j;
    }
  }
  let disconnected = 0;
  for (const b of g.buildings) {
    buildingStats(b, st);
    const plant = st.powerSupply > 0;
    if (plant) bPowered.set(b.id, true);
    else if (!allocated.has(b.id)) {
      bPowered.set(b.id, false);
      if (st.powerUse > 0) disconnected++;
    }
    const on = plant ? b.offline === 0 : bPowered.get(b.id)!;
    for (let dy = 0; dy < b.size; dy++) for (let dx = 0; dx < b.size; dx++) powered[(b.y + dy) * N + b.x + dx] = on ? 1 : 0;
  }
  let unpowered = 0;
  for (let i = 0; i < area; i++) {
    if (zone[i] && level[i] > 0 && !abandoned[i] && !powered[i]) {
      unpowered++;
      if (!visited[i]) disconnected++;
    }
  }
  return { comp, powered, deficit, remain, bPowered, totalSupply, totalDemand, overloaded, unpowered, disconnected };
}

const PLANTS: BuildingType[] = ['solar', 'reactor', 'solar'];
const USERS: BuildingType[] = ['precinct', 'clinic', 'plaza', 'datahub', 'maglev'];

/**
 * A random city: a road grid every 4 tiles over part of the owned land with random cuts (cut-off pieces are dark
 * grids), 3×3 blocks zoned at random levels and tiers (some abandoned), a few plants (some offline) and consumer
 * buildings, and sometimes story power mods. Few plants for the demand, so many grids brown out.
 */
function randomCity(seed: number, region: FrameRegion): World {
  const rng = new Rng(seed);
  const w = new World(seed, 'Grid', undefined, region);
  w.funds = 1e9;
  w.maxPopulation = 1e9;
  // A second owned slot (east of the start), so components cross the slot border.
  if (region !== LEGACY_REGION && rng.next() < 0.6) w.annex(w.region === 3 ? 5 : 13);
  const box = w.ownedBox;
  const pick = (lo: number, hi: number) => lo + Math.floor(rng.next() * (hi - lo + 1));
  const x0 = box.x0 + pick(0, 8);
  const y0 = box.y0 + pick(0, 8);
  const x1 = Math.min(box.x1, x0 + pick(24, 90));
  const y1 = Math.min(box.y1, y0 + pick(24, 56));
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++) {
      if (!w.isOwned(x, y) || w.tileAt(x, y)!.terrain !== 0) continue;
      if ((x - x0) % 4 === 0 || (y - y0) % 4 === 0) {
        if (rng.next() > 0.04) w.setRoad(x, y);
      } else if (rng.next() < 0.7) {
        w.setZone(x, y, (1 + Math.floor(rng.next() * 3)) as ZoneType);
        if (rng.next() < 0.85) w.setLevel(x, y, 1 + Math.floor(rng.next() * 3), rng.next() < 0.05, Math.floor(rng.next() * 3) as 0 | 1 | 2);
      }
    }
  const plants = Math.floor(rng.next() * 5);
  for (let k = 0; k < plants; k++) {
    const x = pick(x0, x1 - 3);
    const y = pick(y0, y1 - 3);
    for (let dy = 0; dy < 3; dy++) for (let dx = 0; dx < 3; dx++) w.clearTile(x + dx, y + dy);
    const b = w.addBuilding(PLANTS[Math.floor(rng.next() * PLANTS.length)], x, y);
    if (b && rng.next() < 0.25) b.offline = 30;
  }
  for (let k = 0; k < 6; k++) {
    const x = pick(x0, x1 - 2);
    const y = pick(y0, y1 - 2);
    for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) w.clearTile(x + dx, y + dy);
    w.addBuilding(USERS[Math.floor(rng.next() * USERS.length)], x, y);
  }
  if (rng.next() < 0.3) w.mods.powerDemandMul = 1 + rng.next();
  if (rng.next() < 0.2) w.mods.powerSupplyMul = rng.next() < 0.5 ? 0.5 : 1.3;
  return w;
}

function compare(world: World, g: SimGrid, p: PowerGrid, label: string) {
  const r = reference(world, g);
  const N = world.N;
  let bad = 0;
  for (let i = 0; i < world.area; i++) {
    if (!world.ownedAt(i)) continue;
    if (p.powered[i] !== r.powered[i] || world.tiles[i].powered !== (r.powered[i] === 1)) bad++;
  }
  expect([label, 'powered tiles differing', bad]).toEqual([label, 'powered tiles differing', 0]);
  for (const b of world.buildings.values()) expect([label, b.type, b.powered]).toEqual([label, b.type, r.bPowered.get(b.id)]);
  // Component labels equal (seeds in index order), so the per-component arrays compare directly.
  for (let i = 0; i < world.area; i++) if (world.ownedAt(i) && p.comp[i] !== r.comp[i]) throw new Error(`${label}: label at ${i % N},${(i / N) | 0}`);
  const first = new Int32Array(p.compCount).fill(-1);
  for (let i = 0; i < world.area; i++) if (p.comp[i] >= 0 && first[p.comp[i]] < 0) first[p.comp[i]] = i;
  for (let c = 0; c < p.compCount; c++) {
    if (p.compDeficit[c] !== r.deficit[c]) throw new Error(`${label}: deficit of component ${c}`);
    const d = Math.abs(p.headroom(first[c]) - r.remain[c]);
    if (d > 1e-9 * Math.max(1, Math.abs(r.remain[c]))) throw new Error(`${label}: remain of component ${c}: ${p.headroom(first[c])} vs ${r.remain[c]}`);
  }
  expect([label, p.supply, p.demand, p.overloaded, p.unpoweredTiles, p.disconnected]).toEqual([
    label,
    r.totalSupply,
    r.totalDemand,
    r.overloaded,
    r.unpowered,
    r.disconnected,
  ]);
}

describe('O2 power: cached labels and the exact supply / demand classes (§3.3)', () => {
  it('50 random cities (legacy frame and 3×3 regions, brownouts, dark grids, offline plants): equal to the whole-map BFS', () => {
    let brownouts = 0;
    let dark = 0;
    for (let k = 0; k < 50; k++) {
      const region: FrameRegion = k % 3 === 0 ? 3 : LEGACY_REGION;
      const w = randomCity(1000 + k, region);
      const g = new SimGrid(w);
      g.scan(w, true);
      const p = new PowerGrid(w);
      p.compute(w, g);
      compare(w, g, p, `city ${k}`);
      for (let c = 0; c < p.compCount; c++) {
        if (p.compDeficit[c] && p.compSupply[c] > 0) brownouts++;
        if (p.compSupply[c] === 0 && p.compDemand[c] > 0) dark++;
      }
      // Change the conductor set (a road removed, a zone added) and the supply (a plant offline): still equal.
      const box = w.ownedBox;
      for (let y = box.y0; y <= box.y1 && y < box.y0 + 40; y += 7) w.clearTile(box.x0 + 20, y);
      const plant = [...w.buildings.values()].find((b) => b.type !== 'precinct' && buildingStats(b, blankStats()).powerSupply > 0);
      if (plant) plant.offline = plant.offline > 0 ? 0 : 20;
      g.scan(w);
      p.compute(w, g);
      compare(w, g, p, `city ${k} after edits`);
    }
    expect(brownouts).toBeGreaterThan(3);
    expect(dark).toBeGreaterThan(10);
  });

  it('labels are rebuilt only when the conductor set changes, and a relabel resumed across steps equals a whole one', () => {
    const w = randomCity(77, LEGACY_REGION);
    const g = new SimGrid(w);
    g.scan(w, true);
    const p = new PowerGrid(w);
    p.compute(w, g);
    const n0 = p.relabels;
    g.scan(w);
    p.compute(w, g);
    expect(p.relabels).toBe(n0);
    // A plant going offline changes supply, not conductors: no relabel, still exact.
    const plant = [...w.buildings.values()].find((b) => buildingStats(b, blankStats()).powerSupply > 0);
    if (plant) plant.offline = 10;
    g.scan(w);
    p.compute(w, g);
    expect(p.relabels).toBe(n0);
    compare(w, g, p, 'offline');
    // A new road is a conductor change: one relabel, resumed in banded steps.
    w.setRoad(10, 10);
    w.setRoad(11, 10);
    g.scan(w);
    const u = p.computeUnit(w, g, true);
    let steps = 0;
    for (let r = u.next(); !r.done; r = u.next()) steps++;
    expect(p.relabels).toBe(n0 + 1);
    expect(steps).toBeGreaterThan(3);
    compare(w, g, p, 'banded');
  });
});
