// ─────────────────────────────────────────────────────────────────────────────
// Power grid. Roads, zone tiles (any level) and building tiles conduct.
// Each 4-connected conductor component pools the output of its online plants;
// when demand exceeds supply, power is handed out in BFS order outward from
// the plants, so the brownout hits the far end of the grid first.
// ─────────────────────────────────────────────────────────────────────────────

import { BUILDINGS, ZONES } from '../config';
import { MAP_SIZE, type Building } from '../types';
import type { World } from '../world';
import type { SimGrid } from './grid';

// Imported bindings are copied into module locals: under Vite's SSR/test
// transform every imported identifier becomes a getter call, which is very
// slow inside hot per-tile loops.
const N = MAP_SIZE;
const AREA = N * N;

/** Power draw of a zone tile (0 for lots and abandoned shells). Index = ZoneType. */
const ZONE_DRAW: readonly (readonly number[])[] = [
  [0, 0, 0, 0],
  ZONES.res.power,
  ZONES.com.power,
  ZONES.ind.power,
];

export function zoneDraw(zone: number, level: number, abandoned: number): number {
  return abandoned || level === 0 ? 0 : ZONE_DRAW[zone][level];
}

export class PowerGrid {
  /** Component label per tile, -1 = not a conductor. */
  readonly comp = new Int32Array(AREA);
  /** 1 = energised this tick. */
  readonly powered = new Uint8Array(AREA);
  /** Per-component totals (indexed by label). */
  readonly compSupply = new Float64Array(AREA);
  readonly compDemand = new Float64Array(AREA);
  /** 1 = the component's demand exceeds its supply. */
  readonly compDeficit = new Uint8Array(AREA);
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

  private readonly queue = new Int32Array(AREA);
  private readonly visited = new Uint8Array(AREA);
  private readonly remain = new Float64Array(AREA);
  private readonly brown = new Uint8Array(AREA);
  private readonly allocated = new Set<number>();

  /** Recompute the grid, write tile.powered / building.powered. Returns true if any tile flipped. */
  compute(world: World, g: SimGrid): boolean {
    const { comp, powered, compSupply, compDemand, compDeficit, queue, visited, remain, brown } = this;
    const { zone, level, abandoned, road, bld } = g;

    // 1. Label conductor components (4-neighbour flood fill).
    comp.fill(-1);
    let count = 0;
    for (let s = 0; s < AREA; s++) {
      if (comp[s] !== -1 || !(road[s] || zone[s] || bld[s] >= 0)) continue;
      const label = count++;
      compSupply[label] = 0;
      compDemand[label] = 0;
      let head = 0;
      let tail = 0;
      queue[tail++] = s;
      comp[s] = label;
      while (head < tail) {
        const i = queue[head++];
        const x = i % N;
        if (x > 0) tail = this.join(i - 1, label, tail, g);
        if (x < N - 1) tail = this.join(i + 1, label, tail, g);
        if (i >= N) tail = this.join(i - N, label, tail, g);
        if (i < AREA - N) tail = this.join(i + N, label, tail, g);
      }
    }
    this.compCount = count;

    // 2. Per-component supply and demand.
    let totalSupply = 0;
    let totalDemand = 0;
    let plants = 0;
    for (let k = 0; k < g.zonedCount; k++) {
      const z = g.zoned[k];
      const d = zoneDraw(zone[z], level[z], abandoned[z]);
      if (d > 0) {
        compDemand[comp[z]] += d;
        totalDemand += d;
      }
    }
    for (const b of g.buildings) {
      const def = BUILDINGS[b.type];
      const c = comp[b.y * N + b.x];
      if (def.powerSupply > 0) {
        plants++;
        if (b.offline === 0) {
          compSupply[c] += def.powerSupply;
          totalSupply += def.powerSupply;
        }
      } else if (def.powerUse > 0) {
        compDemand[c] += def.powerUse;
        totalDemand += def.powerUse;
      }
    }
    let overloaded = false;
    for (let c = 0; c < count; c++) {
      const deficit = compSupply[c] < compDemand[c];
      compDeficit[c] = deficit ? 1 : 0;
      if (deficit && compSupply[c] > 0) overloaded = true;
      remain[c] = compSupply[c];
      brown[c] = 0;
    }

    // 3. Multi-source BFS from every online plant tile, allocating as we go.
    visited.fill(0);
    powered.fill(0);
    this.allocated.clear();
    let head = 0;
    let tail = 0;
    for (const b of g.buildings) {
      if (BUILDINGS[b.type].powerSupply <= 0 || b.offline > 0) continue;
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
        // Building tile: allocate the whole building on first contact.
        if (!this.allocated.has(bid)) {
          this.allocated.add(bid);
          const b = world.buildings.get(bid);
          if (b) this.allocateBuilding(b, c);
        }
      } else {
        const d = zoneDraw(zone[i], level[i], abandoned[i]);
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
      if (x > 0) tail = this.visit(i - 1, tail);
      if (x < N - 1) tail = this.visit(i + 1, tail);
      if (i >= N) tail = this.visit(i - N, tail);
      if (i < AREA - N) tail = this.visit(i + N, tail);
    }

    // 4. Buildings: plants are always "powered"; consumers never reached have no power.
    let disconnected = 0;
    for (const b of g.buildings) {
      const def = BUILDINGS[b.type];
      if (def.powerSupply > 0) b.powered = true;
      else if (!this.allocated.has(b.id)) {
        b.powered = false;
        if (def.powerUse > 0) disconnected++;
      }
      const on = def.powerSupply > 0 ? b.offline === 0 : b.powered;
      for (let dy = 0; dy < b.size; dy++)
        for (let dx = 0; dx < b.size; dx++) powered[(b.y + dy) * N + b.x + dx] = on ? 1 : 0;
    }

    // 5. Write tile flags, count unpowered development, track the changed area.
    const tiles = world.tiles;
    let unpowered = 0;
    let x0 = N;
    let y0 = N;
    let x1 = -1;
    let y1 = -1;
    for (let i = 0; i < AREA; i++) {
      const p = powered[i] === 1;
      if (zone[i] && level[i] > 0 && !abandoned[i] && !p) {
        unpowered++;
        if (!visited[i]) disconnected++;
      }
      const t = tiles[i];
      if (t.powered !== p) {
        t.powered = p;
        const x = i % N;
        const y = (i / N) | 0;
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
    this.supply = totalSupply;
    this.demand = totalDemand;
    this.plants = plants;
    this.overloaded = overloaded;
    this.unpoweredTiles = unpowered;
    this.disconnected = disconnected;
    if (x1 >= 0) {
      world.markChanged(x0, y0, x1, y1);
      return true;
    }
    return false;
  }

  /** True if new development on this tile can be fed: energised and the grid isn't in deficit. */
  canFeed(i: number): boolean {
    const c = this.comp[i];
    return this.powered[i] === 1 && c >= 0 && !this.compDeficit[c];
  }

  private allocateBuilding(b: Building, c: number): void {
    const def = BUILDINGS[b.type];
    if (def.powerSupply > 0) return; // plants handled separately
    const use = def.powerUse;
    if (use <= 0 || this.remain[c] >= use) {
      this.remain[c] -= use;
      b.powered = true;
    } else {
      this.brown[c] = 1;
      b.powered = false;
    }
  }

  private join(j: number, label: number, tail: number, g: SimGrid): number {
    if (this.comp[j] !== -1 || !(g.road[j] || g.zone[j] || g.bld[j] >= 0)) return tail;
    this.comp[j] = label;
    this.queue[tail] = j;
    return tail + 1;
  }

  private visit(j: number, tail: number): number {
    if (this.visited[j] || this.comp[j] < 0) return tail;
    this.visited[j] = 1;
    this.queue[tail] = j;
    return tail + 1;
  }
}
