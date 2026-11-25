// ─────────────────────────────────────────────────────────────────────────────
// Power grid. Roads, zone tiles (any level) and building tiles conduct.
// Each 4-connected conductor component pools the output of its online plants;
// when demand exceeds supply, power is handed out in BFS order outward from
// the plants, so the brownout hits the far end of the grid first.
//
// Story hooks (§10.6): plant supply × mods.powerSupplyMul, every draw (zones,
// buildings and growth reservations) × mods.powerDemandMul; building numbers
// come from buildingStats() (stage-aware Stratablocks).
//
// Expansion (docs/EXPANSION.md §3.1, §4.4): every ground road kind conducts
// (skyways do not); a zone tile's draw follows its wealth tier
// (zonePowerMul: richer homes and shops draw more, a clean $$$ fab less).
//
// Megacity (docs/MEGACITY.md §3.3, O2), specified exactly:
//   - component labels are cached on world.conductorVersion (as the grid last
//     scanned it) and rebuilt by a resumable flood fill over owned land;
//   - every tick, supply and demand per component (a banded sweep);
//   - supply 0: the component is dark, no BFS; supply ≥ demand > 0 (or no
//     demand): every tile is lit and remain = supply − demand, so tryReserve
//     and canFeed see the true headroom; only 0 < supply < demand runs the
//     allocation BFS (resumable), seeded exactly as before;
//   - tile flags are rewritten only for components whose state changed (and
//     every brownout), building footprints every tick.
// The result equals the old whole-map BFS: powered, compDeficit and
// building.powered exactly, remain up to the order of float subtraction.
// ─────────────────────────────────────────────────────────────────────────────

import { blankStats, buildingStats } from '../buildingStats';
import { SLICE } from '../config';
import type { Building } from '../types';
import type { World } from '../world';
import type { SimGrid } from './grid';
import { K, drain, type Unit } from './slice';
import * as Tiers from './tiers';

// Imported bindings are copied into module locals: under Vite's SSR/test
// transform every imported identifier becomes a getter call, which is very
// slow inside hot per-tile loops. The frame (N, area) is per world (MEGACITY
// §3.1), copied at construction and into locals per call.

/** Power draw per zone × level × tier (sim/tiers.ts, index z * 12 + l * 3 + t). */
const DRAW_T = Tiers.DRAW_T;
const BAND = SLICE.bandRows;

/** Component states. */
const DARK = 0;
const LIT = 1;
const BROWN = 2;
/** No state yet (forces a rewrite). */
const NEW = 3;

/** Power draw of a zone tile at its level and wealth tier (0 for lots and abandoned shells). */
export function zoneDraw(zone: number, level: number, abandoned: number, tier = 0): number {
  return abandoned || level === 0 ? 0 : DRAW_T[zone * 12 + level * 3 + tier];
}

export class PowerGrid {
  /** The frame (MEGACITY §3.1): side and tile count of the world this grid serves. */
  readonly N: number;
  readonly area: number;
  /** Component label per tile, -1 = not a conductor. */
  readonly comp: Int32Array;
  /** 1 = energised this tick. */
  readonly powered: Uint8Array;
  /** Per-component totals (indexed by label). */
  readonly compSupply: Float64Array;
  readonly compDemand: Float64Array;
  /** 1 = the component's demand exceeds its supply. */
  readonly compDeficit: Uint8Array;
  compCount = 0;

  /** City-wide totals from the last compute(). */
  supply = 0;
  demand = 0;
  /** Developed (level ≥ 1, not abandoned) tiles without power. */
  unpoweredTiles = 0;
  /** Developed zone tiles + consumer buildings connected to no plant at all. */
  disconnected = 0;
  /** Number of power plants (online or not). */
  plants = 0;
  /** True if some grid that has plants draws more than they make (a real brownout). */
  overloaded = false;
  /** mods.powerDemandMul at the last compute(): growth reservations scale by it too. */
  demandMul = 1;
  /** Relabels so far (tests: labels are cached). */
  relabels = 0;

  private readonly queue: Int32Array;
  /** BFS visit stamps (== stamp: visited this tick). */
  private readonly seen: Uint32Array;
  private stamp = 0;
  private readonly remain: Float64Array;
  private readonly brown: Uint8Array;
  private readonly allocated = new Set<number>();
  /** Scratch for buildingStats() (no per-tick allocation). */
  private readonly st = blankStats();

  // ── Label cache (O2) ──────────────────────────────────────────────────────
  /** Conductor tiles in label order: component c owns members[start[c] .. start[c + 1]). */
  private readonly members: Int32Array;
  private readonly start: Int32Array;
  /** The grid's conductor version the labels were built for (−1: never). */
  private labelVersion = -1;
  private labelOwn = -1;
  /** Per component: state last tick and now, developed zone tiles, consumers with a draw. */
  private readonly lastState: Uint8Array;
  private readonly state: Uint8Array;
  private readonly devCount: Int32Array;
  private readonly useCount: Int32Array;
  /** Every tile flag must be rewritten (after a relabel or for a fresh grid). */
  private fullRewrite = true;
  /** Bounding box of flag flips this compute. */
  private fx0 = 0;
  private fy0 = 0;
  private fx1 = -1;
  private fy1 = -1;

  constructor(world: Pick<World, 'N' | 'area'>) {
    const area = world.area;
    this.N = world.N;
    this.area = area;
    this.comp = new Int32Array(area).fill(-1);
    this.powered = new Uint8Array(area);
    this.compSupply = new Float64Array(area);
    this.compDemand = new Float64Array(area);
    this.compDeficit = new Uint8Array(area);
    this.queue = new Int32Array(area);
    this.seen = new Uint32Array(area);
    this.remain = new Float64Array(area);
    this.brown = new Uint8Array(area);
    this.members = new Int32Array(area);
    this.start = new Int32Array((area >> 1) + 2);
    this.lastState = new Uint8Array((area >> 1) + 1).fill(NEW);
    this.state = new Uint8Array((area >> 1) + 1);
    this.devCount = new Int32Array((area >> 1) + 1);
    this.useCount = new Int32Array((area >> 1) + 1);
  }

  /** Recompute the grid, write tile.powered / building.powered. Returns true if any tile flipped. */
  compute(world: World, g: SimGrid): boolean {
    drain(this.computeUnit(world, g, false));
    return this.flipped;
  }

  /** Did the last compute flip any tile flag? */
  flipped = false;

  /** The whole compute as a resumable unit (unit A2 of the sliced day): relabel, sweep, BFS, flags. */
  *computeUnit(world: World, g: SimGrid, banded: boolean): Unit {
    const supplyMul = world.mods.powerSupplyMul;
    const demandMul = world.mods.powerDemandMul;
    this.demandMul = demandMul;
    this.flipped = false;
    this.fx0 = this.N;
    this.fy0 = this.N;
    this.fx1 = -1;
    this.fy1 = -1;

    // 1. Labels: only when the conductor set changed since they were built.
    if (g.conductorSeen !== this.labelVersion || g.layout.version !== this.labelOwn || this.labelVersion < 0)
      yield* this.relabel(g, banded);

    // 2. Per-component supply and demand (zones in bands, then buildings).
    const { comp, compSupply, compDemand, devCount, useCount, st } = this;
    const { zone, level, abandoned, wealth } = g;
    const count = this.compCount;
    for (let c = 0; c < count; c++) {
      compSupply[c] = 0;
      compDemand[c] = 0;
      devCount[c] = 0;
      useCount[c] = 0;
    }
    let totalSupply = 0;
    let totalDemand = 0;
    let plants = 0;
    const zc = g.zonedCount;
    const zl = g.zoned;
    const zstep = banded ? BAND * this.N : zc + 1;
    for (let k0 = 0; k0 < zc; k0 += zstep) {
      yield K.Sweep;
      const k1 = Math.min(zc, k0 + zstep);
      for (let k = k0; k < k1; k++) {
        const z = zl[k];
        const lv = level[z];
        if (lv === 0 || abandoned[z]) continue;
        const c = comp[z];
        devCount[c]++;
        const d = DRAW_T[zone[z] * 12 + lv * 3 + wealth[z]] * demandMul;
        if (d > 0) {
          compDemand[c] += d;
          totalDemand += d;
        }
      }
    }
    yield K.SweepBld;
    const N = this.N;
    for (const b of g.buildings) {
      buildingStats(b, st);
      const c = comp[b.y * N + b.x];
      if (st.powerSupply > 0) {
        plants++;
        if (b.offline === 0) {
          const s = st.powerSupply * supplyMul;
          compSupply[c] += s;
          totalSupply += s;
        }
      } else if (st.powerUse > 0) {
        const d = st.powerUse * demandMul;
        compDemand[c] += d;
        totalDemand += d;
        useCount[c]++;
      }
    }

    // 3. Classify: dark (no supply), lit (supply covers demand), brownout (0 < supply < demand).
    yield K.Classify;
    const { compDeficit, remain, brown, state } = this;
    let overloaded = false;
    let anyBrown = false;
    for (let c = 0; c < count; c++) {
      const s = compSupply[c];
      const d = compDemand[c];
      const deficit = s < d;
      compDeficit[c] = deficit ? 1 : 0;
      brown[c] = 0;
      if (s <= 0) {
        state[c] = DARK;
        remain[c] = s;
      } else if (!deficit) {
        state[c] = LIT;
        remain[c] = s - d;
      } else {
        state[c] = BROWN;
        remain[c] = s;
        overloaded = true;
        anyBrown = true;
      }
    }

    // 4. Brownouts only: today's multi-source BFS from every online plant tile in them, allocating as it goes.
    this.allocated.clear();
    if (anyBrown) yield* this.brownBfs(world, g, banded);

    // 5. Tile flags of every component whose state changed, and of every brownout (non-building tiles).
    yield* this.rewrite(world, g, banded);

    // 6. Buildings: plants are always "powered"; consumers powered by their component; footprints every tick.
    yield K.Flags;
    let disconnected = 0;
    let unpowered = 0;
    const tiles = world.tiles;
    const powered = this.powered;
    let changedPower = false;
    for (const b of g.buildings) {
      buildingStats(b, st);
      const plant = st.powerSupply > 0;
      const c = comp[b.y * N + b.x];
      const was = b.powered;
      if (plant) b.powered = true;
      else {
        const s = c >= 0 ? state[c] : DARK;
        if (s === BROWN) {
          if (!this.allocated.has(b.id)) b.powered = false;
        } else b.powered = s === LIT;
        if (s === DARK && st.powerUse > 0) disconnected++;
      }
      if (b.powered !== was) changedPower = true;
      const on = plant ? b.offline === 0 : b.powered;
      const v = on ? 1 : 0;
      for (let dy = 0; dy < b.size; dy++)
        for (let dx = 0; dx < b.size; dx++) {
          const i = (b.y + dy) * N + b.x + dx;
          powered[i] = v;
          const t = tiles[i];
          if (t.powered !== on) {
            t.powered = on;
            this.flip(i);
          }
        }
    }
    if (changedPower) world.coverageVersion++;

    // 7. Counts: developed tiles without power, and those connected to no plant at all.
    for (let c = 0; c < count; c++) {
      const s = state[c];
      if (s === DARK) {
        unpowered += devCount[c];
        disconnected += devCount[c];
      } else if (s === BROWN) unpowered += this.brownUnpowered[c];
    }
    this.lastState.set(state.subarray(0, count));
    this.supply = totalSupply;
    this.demand = totalDemand;
    this.plants = plants;
    this.overloaded = overloaded;
    this.unpoweredTiles = unpowered;
    this.disconnected = disconnected;
    if (this.fx1 >= 0) {
      world.markChanged(this.fx0, this.fy0, this.fx1, this.fy1);
      this.flipped = true;
    }
  }

  /** Developed tiles left unpowered per brownout component (from the last rewrite). */
  private brownUnpowered = new Int32Array(0);

  private flip(i: number): void {
    const N = this.N;
    const x = i % N;
    const y = (i / N) | 0;
    if (x < this.fx0) this.fx0 = x;
    if (x > this.fx1) this.fx1 = x;
    if (y < this.fy0) this.fy0 = y;
    if (y > this.fy1) this.fy1 = y;
  }

  /**
   * Label conductor components (4-neighbour flood fill over owned land, seeds in index order, so labels equal the
   * old whole-map labels), recording each component's members. Resumable: the queue survives across steps.
   */
  private *relabel(g: SimGrid, banded: boolean): Unit {
    yield K.Label;
    const { comp, members, start, N } = this;
    const area = this.area;
    const version = g.conductorSeen;
    const own = g.layout.version;
    comp.fill(-1);
    const { road, zone, bld } = g;
    const { ck, rowAt } = g.layout.all;
    const end = rowAt[N];
    const budget = banded ? BAND * N * 2 : Infinity;
    let count = 0;
    let tail = 0;
    let work = 0;
    for (let c = 0; c < end; c += 3)
      for (let s = ck[c], e = ck[c + 1]; s < e; s++) {
        if (comp[s] !== -1 || !(road[s] || zone[s] || bld[s] >= 0)) continue;
        const label = count++;
        start[label] = tail;
        let head = tail;
        members[tail++] = s;
        comp[s] = label;
        while (head < tail) {
          const i = members[head++];
          const x = i % N;
          if (x > 0) {
            const j = i - 1;
            if (comp[j] === -1 && (road[j] || zone[j] || bld[j] >= 0)) {
              comp[j] = label;
              members[tail++] = j;
            }
          }
          if (x < N - 1) {
            const j = i + 1;
            if (comp[j] === -1 && (road[j] || zone[j] || bld[j] >= 0)) {
              comp[j] = label;
              members[tail++] = j;
            }
          }
          if (i >= N) {
            const j = i - N;
            if (comp[j] === -1 && (road[j] || zone[j] || bld[j] >= 0)) {
              comp[j] = label;
              members[tail++] = j;
            }
          }
          if (i < area - N) {
            const j = i + N;
            if (comp[j] === -1 && (road[j] || zone[j] || bld[j] >= 0)) {
              comp[j] = label;
              members[tail++] = j;
            }
          }
          if (++work >= budget) {
            work = 0;
            yield K.Label;
          }
        }
      }
    start[count] = tail;
    this.compCount = count;
    this.labelVersion = version;
    this.labelOwn = own;
    this.relabels++;
    this.fullRewrite = true;
    if (this.brownUnpowered.length < count + 1) this.brownUnpowered = new Int32Array(Math.max(count + 1, this.brownUnpowered.length * 2));
  }

  /** The allocation BFS of brownout components (seeded like the old whole-map BFS), resumable. */
  private *brownBfs(world: World, g: SimGrid, banded: boolean): Unit {
    yield K.Brown;
    const { comp, powered, queue, seen, remain, brown, compDeficit, state, members, start, st, N } = this;
    const area = this.area;
    const { zone, level, abandoned, wealth, bld } = g;
    const demandMul = this.demandMul;
    let stamp = (this.stamp = (this.stamp + 1) >>> 0);
    if (stamp === 0) {
      seen.fill(0);
      stamp = this.stamp = 1;
    }
    // Brownout tiles start unlit; the BFS lights what it can feed.
    for (let c = 0; c < this.compCount; c++) {
      if (state[c] !== BROWN) continue;
      for (let k = start[c]; k < start[c + 1]; k++) powered[members[k]] = 0;
    }
    let head = 0;
    let tail = 0;
    for (const b of g.buildings) {
      if (b.offline > 0 || buildingStats(b, st).powerSupply <= 0) continue;
      const c0 = comp[b.y * N + b.x];
      if (c0 < 0 || state[c0] !== BROWN) continue;
      for (let dy = 0; dy < b.size; dy++)
        for (let dx = 0; dx < b.size; dx++) {
          const i = (b.y + dy) * N + b.x + dx;
          if (seen[i] !== stamp) {
            seen[i] = stamp;
            queue[tail++] = i;
          }
        }
    }
    const budget = banded ? BAND * N * 2 : Infinity;
    let work = 0;
    while (head < tail) {
      const i = queue[head++];
      const c = comp[i];
      const bid = bld[i];
      if (bid >= 0) {
        // Building tile: allocate the whole building on first contact.
        if (!this.allocated.has(bid)) {
          this.allocated.add(bid);
          const b = world.buildings.get(bid);
          if (b) this.allocateBuilding(b, c);
        }
      } else {
        const lv = level[i];
        const d = lv === 0 || abandoned[i] ? 0 : DRAW_T[zone[i] * 12 + lv * 3 + wealth[i]] * demandMul;
        if (d > 0) {
          if (remain[c] >= d) {
            remain[c] -= d;
            powered[i] = 1;
          } else brown[c] = 1;
        } else if (!compDeficit[c] || (remain[c] > 0 && !brown[c])) {
          // Roads, empty lots and shells light up while the grid has headroom.
          powered[i] = 1;
        }
      }
      const x = i % N;
      if (x > 0 && seen[i - 1] !== stamp && comp[i - 1] >= 0) {
        seen[i - 1] = stamp;
        queue[tail++] = i - 1;
      }
      if (x < N - 1 && seen[i + 1] !== stamp && comp[i + 1] >= 0) {
        seen[i + 1] = stamp;
        queue[tail++] = i + 1;
      }
      if (i >= N && seen[i - N] !== stamp && comp[i - N] >= 0) {
        seen[i - N] = stamp;
        queue[tail++] = i - N;
      }
      if (i < area - N && seen[i + N] !== stamp && comp[i + N] >= 0) {
        seen[i + N] = stamp;
        queue[tail++] = i + N;
      }
      if (++work >= budget) {
        work = 0;
        yield K.Brown;
      }
    }
  }

  /**
   * Write tile flags (powered[] and Tile.powered) of non-building tiles for every component whose state changed,
   * every brownout, or everything after a relabel; count each brownout's unpowered developed tiles.
   */
  private *rewrite(world: World, g: SimGrid, banded: boolean): Unit {
    const { comp, powered, state, lastState, members, start, N } = this;
    const tiles = world.tiles;
    const { zone, level, abandoned, bld } = g;
    const count = this.compCount;
    const budget = banded ? BAND * N * 2 : Infinity;
    let work = 0;
    yield K.Flags;
    if (this.fullRewrite) {
      // Non-conductors are unlit (a bulldozed tile goes dark).
      const { ck, rowAt } = g.layout.all;
      const end = rowAt[N];
      for (let c = 0; c < end; c += 3)
        for (let i = ck[c], e = ck[c + 1]; i < e; i++) {
          if (comp[i] >= 0) continue;
          powered[i] = 0;
          const t = tiles[i];
          if (t.powered) {
            t.powered = false;
            this.flip(i);
          }
        }
    }
    const bu = this.brownUnpowered;
    for (let c = 0; c < count; c++) {
      const s = state[c];
      if (s === BROWN) bu[c] = 0;
      if (!this.fullRewrite && s !== BROWN && s === lastState[c]) continue;
      const lit = s === LIT ? 1 : 0;
      for (let k = start[c]; k < start[c + 1]; k++) {
        const i = members[k];
        if (bld[i] >= 0) continue;
        let p: number;
        if (s === BROWN) {
          p = powered[i];
          if (!p && zone[i] && level[i] > 0 && !abandoned[i]) bu[c]++;
        } else {
          p = lit;
          powered[i] = lit;
        }
        const on = p === 1;
        const t = tiles[i];
        if (t.powered !== on) {
          t.powered = on;
          this.flip(i);
        }
        if (++work >= budget) {
          work = 0;
          yield K.Flags;
        }
      }
    }
    this.fullRewrite = false;
  }

  /** True if new development on this tile can be fed: energised and the grid isn't in deficit. */
  canFeed(i: number): boolean {
    const c = this.comp[i];
    return this.powered[i] === 1 && c >= 0 && !this.compDeficit[c];
  }

  /** Headroom left on tile i's component (supply − demand on a lit grid; what the BFS left on a brownout). */
  headroom(i: number): number {
    const c = this.comp[i];
    return c >= 0 ? this.remain[c] : 0;
  }

  /**
   * Reserve `extra` MW of headroom on this tile's grid for new development.
   * Growth calls this so a level-up never pushes its own grid into a brownout;
   * reservations accumulate within the tick and reset on the next compute().
   */
  tryReserve(i: number, extra: number): boolean {
    if (!this.canFeed(i)) return false;
    const c = this.comp[i];
    const need = extra * this.demandMul;
    if (this.remain[c] < need) return false;
    this.remain[c] -= need;
    return true;
  }

  private allocateBuilding(b: Building, c: number): void {
    const st = buildingStats(b, this.st);
    if (st.powerSupply > 0) return; // plants handled separately
    const use = st.powerUse * this.demandMul;
    if (use <= 0 || this.remain[c] >= use) {
      this.remain[c] -= use;
      b.powered = true;
    } else {
      this.brown[c] = 1;
      b.powered = false;
    }
  }
}
