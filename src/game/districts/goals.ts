// ─────────────────────────────────────────────────────────────────────────────
// District goals (docs/MEGACITY.md §3.7; WP-2). Each owned district carries its
// kind's goals (minus `once` goals on a repeat, minus its variant's `skipGoals`)
// plus its variant's own goal. Checked on the month tick; each pays once, posts
// one ticker line and emits 'districtGoal'. A goal completed after an ending pays
// max(reward, GOAL_LATE_SHARE × districtPrice(owned)): a fixed rule by districts
// owned, never by funds. Every check reads only its own district.
// ─────────────────────────────────────────────────────────────────────────────

import { lockedReason } from '../actions';
import { buildingStats, blankStats } from '../buildingStats';
import { BUILDINGS, DISTRICTS, GOAL_LATE_SHARE, districtPrice, type DistrictGoal } from '../config';
import { tierCapacity } from '../sim/tiers';
import { Ground, RoadKind, SLOT, Terrain, ZoneType, type Building, type BuildingType, type SlotId } from '../types';
import type { World } from '../world';
import { brownfieldSites, framesOf, isRuin } from './annex';
import { countGround, isWildReed } from './effects';
import { slotRect } from './slots';

/** Labels shown on the City map: the kind's goals that apply to this district, then its variant's goal. */
export function goalsOf(world: World, slot: SlotId): DistrictGoal[] {
  const kind = world.districts.kinds[slot];
  const def = DISTRICTS[kind];
  if (!def) return [];
  const v = world.variantOf(slot);
  const vdef = v > 0 ? def.variants[v - 1] : undefined;
  const skip = new Set(vdef?.skipGoals ?? []);
  const out = def.goals.filter((g) => !(g.once && v > 0) && !skip.has(g.id));
  if (vdef) out.push(vdef.goal);
  return out;
}

/** A goal that names a building type stays hidden while that type is hidden or locked (§3.7). */
export function goalVisible(world: World, g: DistrictGoal): boolean {
  if (!g.needs) return true;
  if (BUILDINGS[g.needs]?.hidden) return false;
  return lockedReason(world, g.needs) === null;
}

/** The saved key of a goal in a district ("goalId@slot", §3.2). */
export const goalKey = (id: string, slot: SlotId): string => `${id}@${slot}`;

export function goalDone(world: World, id: string, slot: SlotId): boolean {
  return (world.districts.goalsDone ?? []).includes(goalKey(id, slot));
}

/** What a goal pays now (§3.7): its reward, or after an ending the larger of it and the late share. */
export function goalPay(world: World, reward: number): number {
  if (!world.story.ending) return reward;
  return Math.max(reward, Math.round(GOAL_LATE_SHARE * districtPrice(world.districts.owned.length)));
}

/** A district's head counts and developed lots by zone (read from its tiles and buildings). */
export interface SlotCensus {
  residents: number;
  jobs: number;
  /** Developed (level ≥ 1, not abandoned) tiles by ZoneType. */
  developed: number[];
  /** Developed Market tiles at $$ or better. */
  marketRich: number;
  /** Residents on terrace step 3. */
  residentsTop: number;
  /** Level-3 zone tiles on the district's highest step. */
  l3TopStep: number;
}

const STATS = blankStats();

/** Is a building in this slot (its footprint's centre tile)? */
export function buildingInSlot(world: World, b: Building, slot: SlotId): boolean {
  const c = (b.size - 1) >> 1;
  return world.slotAt(b.x + c, b.y + c) === slot;
}

export function countIn(world: World, slot: SlotId, type: BuildingType, test?: (b: Building) => boolean): number {
  let n = 0;
  for (const b of buildingsIn(world, slot)) if (b.type === type && (!test || test(b))) n++;
  return n;
}

/** Buildings by the slot of their footprint's centre tile, rebuilt when a conductor changed (every building add or remove bumps it). */
const BY_SLOT = new WeakMap<World, { v: number; n: number; m: Map<SlotId, Building[]> }>();
const NO_BUILDINGS: readonly Building[] = [];

/** The buildings of a slot (buildingInSlot), from an index cached on world.conductorVersion. */
export function buildingsIn(world: World, slot: SlotId): readonly Building[] {
  let c = BY_SLOT.get(world);
  if (!c || c.v !== world.conductorVersion || c.n !== world.buildings.size) {
    const m = new Map<SlotId, Building[]>();
    for (const b of world.buildings.values()) {
      const k = (b.size - 1) >> 1;
      const s = world.slotAt(b.x + k, b.y + k);
      const a = m.get(s);
      if (a) a.push(b);
      else m.set(s, [b]);
    }
    c = { v: world.conductorVersion, n: world.buildings.size, m };
    BY_SLOT.set(world, c);
  }
  return c.m.get(slot) ?? NO_BUILDINGS;
}

export function slotCensus(world: World, slot: SlotId): SlotCensus {
  const r = slotRect(world, slot);
  const N = world.N;
  const out: SlotCensus = { residents: 0, jobs: 0, developed: [0, 0, 0, 0], marketRich: 0, residentsTop: 0, l3TopStep: 0 };
  let top = 0;
  for (let y = r.y0; y <= r.y1; y++) for (let x = r.x0; x <= r.x1; x++) top = Math.max(top, world.tiles[y * N + x].elev);
  const alley = world.fields.alleyNear;
  for (let y = r.y0; y <= r.y1; y++)
    for (let x = r.x0; x <= r.x1; x++) {
      const i = y * N + x;
      const t = world.tiles[i];
      if (t.zone === ZoneType.None || t.level < 1 || t.abandoned) continue;
      out.developed[t.zone]++;
      const cap = tierCapacity(t.zone, t.level, t.wealth, alley[i]);
      if (t.zone === ZoneType.Residential) {
        out.residents += cap;
        if (t.elev === 3) out.residentsTop += cap;
      } else out.jobs += cap;
      if (t.zone === ZoneType.Commercial && t.wealth >= 1) out.marketRich++;
      if (t.level === 3 && top > 0 && t.elev === top) out.l3TopStep++;
    }
  for (const b of buildingsIn(world, slot)) {
    buildingStats(b, STATS);
    out.residents += STATS.residents;
    out.jobs += STATS.jobsCom + STATS.jobsInd;
  }
  return out;
}

/** The smallest land piece that counts as an island (tiles). */
export const ISLAND_MIN = 4;

/**
 * Islands of a district (§3.7, Shoals): its land pieces of at least ISLAND_MIN (4) tiles, 4-connected inside the slot, other than a
 * piece that runs on into the start slot's land (the city's own shore). A piece that runs on into another district
 * counts: it reads the terrain only, so annexing a neighbour never takes an island away. `linked`: it holds a road joined to the start
 * slot's road network (bridges count).
 */
export function shoalsIslands(world: World, slot: SlotId): { x: number; y: number; size: number; linked: boolean }[] {
  // Islands read the terrain and the road network only: both move conductorVersion (as an annex does).
  let cache = ISLANDS.get(world);
  if (!cache || cache.v !== world.conductorVersion) ISLANDS.set(world, (cache = { v: world.conductorVersion, by: new Map() }));
  const hit = cache.by.get(slot);
  if (hit) return hit.map((i) => ({ ...i }));
  const r = slotRect(world, slot);
  const N = world.N;
  const start = (world.region * world.region - 1) >> 1;
  const seen = startRoadReach(world);
  // A land mask of the slot plus a 1-tile ring (2 = land in the start slot: the city's own shore).
  const W = SLOT + 2;
  const land = new Uint8Array(W * W);
  for (let ly = -1; ly <= SLOT; ly++)
    for (let lx = -1; lx <= SLOT; lx++) {
      const x = r.x0 + lx;
      const y = r.y0 + ly;
      if (x < 0 || y < 0 || x >= N || y >= N || world.tiles[y * N + x].terrain !== Terrain.Land) continue;
      const inside = lx >= 0 && ly >= 0 && lx < SLOT && ly < SLOT;
      land[(ly + 1) * W + lx + 1] = inside ? 1 : world.slotAt(x, y) === start ? 2 : 0;
    }
  const comp = new Uint8Array(W * W);
  const stack = new Int32Array(SLOT * SLOT);
  const out: { x: number; y: number; size: number; linked: boolean }[] = [];
  for (let ly = 0; ly < SLOT; ly++)
    for (let lx = 0; lx < SLOT; lx++) {
      const k0 = (ly + 1) * W + lx + 1;
      if (comp[k0] || land[k0] !== 1) continue;
      let size = 0;
      let mainland = false;
      let linked = false;
      let sp = 0;
      stack[sp++] = k0;
      comp[k0] = 1;
      while (sp > 0) {
        const k = stack[--sp];
        size++;
        const kx = (k % W) - 1;
        const ky = ((k / W) | 0) - 1;
        if (seen[(r.y0 + ky) * N + r.x0 + kx]) linked = true;
        for (let d = 0; d < 4; d++) {
          const nk = d === 0 ? k + 1 : d === 1 ? k - 1 : d === 2 ? k + W : k - W;
          const v = land[nk];
          // Land running on into the start slot is the city's own shore, not an island.
          if (v === 2) mainland = true;
          if (v !== 1 || comp[nk]) continue;
          comp[nk] = 1;
          stack[sp++] = nk;
        }
      }
      if (!mainland && size >= ISLAND_MIN) out.push({ x: r.x0 + lx, y: r.y0 + ly, size, linked });
    }
  cache.by.set(slot, out);
  return out.map((i) => ({ ...i }));
}
const ISLANDS = new WeakMap<World, { v: number; by: Map<SlotId, { x: number; y: number; size: number; linked: boolean }[]> }>();

/** Road tiles joined to the start slot's road network (bridges count), cached on world.conductorVersion (roads, annex). */
const REACH = new WeakMap<World, { v: number; seen: Uint8Array }>();
function startRoadReach(world: World): Uint8Array {
  const c = REACH.get(world);
  if (c && c.v === world.conductorVersion) return c.seen;
  const u = startRoadReachUnit(world);
  while (!u.next().done);
  return REACH.get(world)!.seen;
}

/** Road tiles a step of the reach search visits (each reads its 4 neighbours: ≈ 0.5 ms). */
const REACH_STEP = 4096;

/** startRoadReach's search as steps (the month-end goal check runs it before the Shoals' islands): REACH_STEP tiles each. */
function* startRoadReachUnit(world: World): Generator<void, void, void> {
  const v = world.conductorVersion;
  const N = world.N;
  const R = world.region;
  const own = world.slotOwned;
  const tiles = world.tiles;
  const start = (R * R - 1) >> 1;
  const sr = slotRect(world, start);
  const seen = new Uint8Array(world.area);
  const q = new Int32Array(world.area);
  let n = 0;
  for (let y = sr.y0; y <= sr.y1; y++)
    for (let x = sr.x0; x <= sr.x1; x++) {
      const i = y * N + x;
      if (tiles[i].road) {
        seen[i] = 1;
        q[n++] = i;
      }
    }
  const visit = (j: number, x: number, y: number) => {
    if (seen[j] || own[(y >> 6) * R + (x >> 6)] !== 1 || !tiles[j].road) return;
    seen[j] = 1;
    q[n++] = j;
  };
  for (let h = 0; h < n; h++) {
    if (h > 0 && h % REACH_STEP === 0) yield;
    const i = q[h];
    const x = i % N;
    const y = (i / N) | 0;
    if (x + 1 < N) visit(i + 1, x + 1, y);
    if (x > 0) visit(i - 1, x - 1, y);
    if (y + 1 < N) visit(i + N, x, y + 1);
    if (y > 0) visit(i - N, x, y - 1);
  }
  // A road changed while the search ran: keep it under the version it started from (the next read searches again).
  REACH.set(world, { v, seen });
}

/** Islands of a district bridged to the city (the Shoals' "Bridge 3 islands to the city"). */
export function bridgedIslands(world: World, slot: SlotId): number {
  return shoalsIslands(world, slot).filter((i) => i.linked).length;
}


/** Frames of a Skeleton Row district finished into Stratablocks (a `stack` stands on a frame site). */
export function framesFinished(world: World, slot: SlotId): number {
  let n = 0;
  for (const f of framesOf(world, slot)) {
    const b = world.buildingAt(f.x, f.y);
    if (b && b.type === 'stack' && b.x === f.x && b.y === f.y) n++;
  }
  return n;
}

/** A Sky Lobby with an anchor in this district (vertical cache; §5.5). */
export function lobbyIn(world: World, slot: SlotId): boolean {
  const N = world.N;
  for (const l of world.vertical.lobbies ?? []) for (const a of l.anchors) if (world.slotAt(a % N, (a / N) | 0) === slot) return true;
  return false;
}

/** Is a goal met in this district now? Unknown ids never complete. */
export function goalMet(world: World, slot: SlotId, id: string): boolean {
  const c = () => slotCensus(world, slot);
  switch (id) {
    case 'shoals.islands': {
      // Three islands, or every island a district has when its terrain holds fewer (a rare seed): always reachable.
      const isl = shoalsIslands(world, slot);
      return isl.length > 0 && isl.filter((i) => i.linked).length >= Math.min(3, isl.length);
    }
    case 'shoals.beacon':
      return countIn(world, slot, 'beacon') >= 1;
    case 'shoals.residents':
      return c().residents >= 150000;
    case 'sunk.ruins':
      return (world.districts.ruinsRestored ?? 0) >= 40;
    case 'sunk.gardens':
      return countIn(world, slot, 'pumphouse', (b) => b.reclaim === 0) >= 3;
    case 'sunk.memorial':
      return countIn(world, slot, 'memorial', (b) => byWater(world, b)) >= 1;
    case 'flats.brownfield':
      return brownfieldCleared(world, slot) >= 300;
    case 'flats.seaports':
      return countIn(world, slot, 'seaport') >= 2;
    case 'flats.reclaim':
      return countIn(world, slot, 'reclaim') >= 1;
    case 'terraces.top':
      return c().l3TopStep >= 10;
    case 'terraces.bore':
      return countIn(world, slot, 'geothermal') >= 1;
    case 'reedmere.wild':
      return world.stats.population >= 100000 && wildReeds(world, slot) >= 300;
    case 'reedmere.floodwatch':
      return countIn(world, slot, 'floodwatch') >= 1;
    case 'skeleton.frames':
      return framesFinished(world, slot) >= 2;
    case 'skeleton.lobby':
    case 'bazaar.v2':
      return lobbyIn(world, slot);
    case 'tarmac.airport':
      return countIn(world, slot, 'airport') >= 1;
    case 'tarmac.residents':
      return c().residents >= 100000;
    case 'bazaar.markets':
      return c().marketRich >= 40;
    case 'bazaar.hall':
      return countIn(world, slot, 'markethall') >= 1;
    // Variant goals (§3.7).
    case 'shoals.v1':
      return countIn(world, slot, 'floodwatch') >= 1;
    case 'shoals.v2':
      return c().residents >= 120000;
    case 'shoals.v3':
      return c().developed[ZoneType.Commercial] >= 80;
    case 'terraces.v1':
      return c().residentsTop >= 20000;
    case 'terraces.v2':
      return countIn(world, slot, 'canopypark') >= 1;
    case 'terraces.v3':
      return countIn(world, slot, 'plaza') >= 3;
    case 'reedmere.v1':
      return countIn(world, slot, 'metro') >= 1;
    case 'reedmere.v2':
      return countIn(world, slot, 'tidal') >= 1;
    case 'flats.v1':
      return c().developed[ZoneType.Industrial] >= 200;
    case 'flats.v2':
      return countIn(world, slot, 'maglev') >= 1;
    case 'skeleton.v1':
      return framesFinished(world, slot) >= 4;
    case 'skeleton.v2':
      return countIn(world, slot, 'stack') >= 3;
    case 'tarmac.v1':
      return c().developed[ZoneType.Commercial] >= 100;
    case 'tarmac.v2':
      return countIn(world, slot, 'reclaim') >= 1;
    case 'bazaar.v1':
      return bazaarVisitors(world, slot) >= 5000;
    default:
      return false;
  }
}

/** A building with a footprint tile 4-adjacent to water. */
function byWater(world: World, b: Building): boolean {
  for (let y = b.y - 1; y <= b.y + b.size; y++)
    for (let x = b.x - 1; x <= b.x + b.size; x++) {
      const inside = x >= b.x && y >= b.y && x < b.x + b.size && y < b.y + b.size;
      const corner = (x === b.x - 1 || x === b.x + b.size) && (y === b.y - 1 || y === b.y + b.size);
      if (inside || corner) continue;
      const t = world.tileAt(x, y);
      if (t && t.terrain === Terrain.Water && !t.road) return true;
    }
  return false;
}

/** Brownfield lots cleared in a district since annex: the content's count minus what is left (§3.7). */
export function brownfieldCleared(world: World, slot: SlotId): number {
  // The content laid brownfield on a fixed share of the land; the count is recomputed from the generated sites.
  const placed = world.districts.kinds[slot] === 'flats' ? brownfieldPlaced(world, slot) : 0;
  return Math.max(0, placed - countGround(world, slot, Ground.Brownfield));
}

/** How many brownfield tiles annexing laid in this district (pure: from the generated terrain and the seed). */
export function brownfieldPlaced(world: World, slot: SlotId): number {
  const cache = PLACED.get(world);
  const key = `${slot}|${world.terrainVersion}`;
  const hit = cache?.get(key);
  if (hit !== undefined) return hit;
  const n = brownfieldSites(world, slot).length;
  if (cache) cache.set(key, n);
  else PLACED.set(world, new Map([[key, n]]));
  return n;
}
const PLACED = new WeakMap<World, Map<string, number>>();

/** Unbuilt reed tiles in a district. */
export function wildReeds(world: World, slot: SlotId): number {
  const r = slotRect(world, slot);
  let n = 0;
  for (let y = r.y0; y <= r.y1; y++) for (let x = r.x0; x <= r.x1; x++) if (isWildReed(world, y * world.N + x)) n++;
  return n;
}

/** A Bazaar district's visitors (§3.3: 600 per 10 developed Market tiles there, cap 30,000). */
export function bazaarVisitors(world: World, slot: SlotId): number {
  const m = DISTRICTS[world.districts.kinds[slot]]?.mods.visitorsPerMarket;
  if (!m) return 0;
  const tiles = slotCensus(world, slot).developed[ZoneType.Commercial];
  return Math.min(m.cap, Math.floor(tiles / m.tiles) * m.per);
}

/** Ruins standing in a district. */
export function ruinsIn(world: World, slot: SlotId): number {
  const r = slotRect(world, slot);
  let n = 0;
  for (let y = r.y0; y <= r.y1; y++) for (let x = r.x0; x <= r.x1; x++) if (isRuin(world.tiles[y * world.N + x])) n++;
  return n;
}

/** Alley tiles in a district (tests and the City map's terrain line). */
export function alleysIn(world: World, slot: SlotId): number {
  const r = slotRect(world, slot);
  let n = 0;
  for (let y = r.y0; y <= r.y1; y++)
    for (let x = r.x0; x <= r.x1; x++) {
      const t = world.tiles[y * world.N + x];
      if (t.road && t.roadKind === RoadKind.Alley) n++;
    }
  return n;
}

/** One goal's state for the City map (§7.2). */
export interface GoalView {
  id: string;
  label: string;
  /** What it pays now (the late rule after an ending). */
  reward: number;
  done: boolean;
}

/** The visible goals of an owned district with their state. */
export function goalViews(world: World, slot: SlotId): GoalView[] {
  return goalsOf(world, slot)
    .filter((g) => goalDone(world, g.id, slot) || goalVisible(world, g))
    .map((g) => ({ id: g.id, label: g.label, reward: goalPay(world, g.reward), done: goalDone(world, g.id, slot) }));
}

/**
 * The month tick (§3.7): complete every met goal of every owned district once. Each pays (the late rule after an
 * ending), posts one ticker line ("Kessel Flats: two Seaports on the basin. +25,000 CR") and emits 'districtGoal'.
 * Returns the keys completed.
 */
export function checkDistrictGoals(world: World): string[] {
  const done: string[] = [];
  const u = checkDistrictGoalsUnit(world, done);
  while (!u.next().done);
  return done;
}

/**
 * checkDistrictGoals as steps (MEGACITY §3.3, unit C1 on the month tick): one district per step, so the month end
 * never checks 25 districts in one atomic step. Keys completed are pushed to `done`.
 */
export function* checkDistrictGoalsUnit(world: World, done: string[] = []): Generator<void, void, void> {
  const d = world.districts;
  d.goalsDone ??= [];
  // The Shoals' islands read the road reach of the start slot: searched in steps of its own when a road changed.
  const islands = d.owned.some((s) => goalsOf(world, s).some((g) => g.id === 'shoals.islands' && !goalDone(world, g.id, s)));
  const reach = REACH.get(world);
  if (islands && !(reach && reach.v === world.conductorVersion)) {
    yield* startRoadReachUnit(world);
    yield;
  }
  for (const slot of d.owned.slice()) {
    const kind = d.kinds[slot];
    if (kind === 'shore') continue;
    for (const g of goalsOf(world, slot)) {
      if (goalDone(world, g.id, slot) || !goalVisible(world, g)) continue;
      if (!goalMet(world, slot, g.id)) continue;
      const pay = goalPay(world, g.reward);
      d.goalsDone.push(goalKey(g.id, slot));
      world.funds += pay;
      world.addNews(`${districtTitle(world, slot)}: ${lowerFirst(g.label)}. +${pay.toLocaleString('en-US')} CR`, 'good');
      world.events.emit('districtGoal', { slot, id: g.id });
      done.push(goalKey(g.id, slot));
    }
    yield;
  }
}

/** A district's on-screen name (its variant's name for a repeat). */
export function districtTitle(world: World, slot: SlotId): string {
  const def = DISTRICTS[world.districts.kinds[slot]];
  const v = world.variantOf(slot);
  return v > 0 ? def.variants[v - 1]?.name ?? def.name : def.name;
}

/** A district's short name (12 chars, inspect values). */
export function districtShort(world: World, slot: SlotId): string {
  const def = DISTRICTS[world.districts.kinds[slot]];
  const v = world.variantOf(slot);
  return v > 0 ? def.variants[v - 1]?.short ?? def.short : def.short;
}

function lowerFirst(s: string): string {
  // Labels that start with a number or a proper noun keep their case ("Two Seaports" reads "two Seaports").
  if (/^[A-Z][a-z]/.test(s) && !/^(Harbour|Sky|Floodwatch|Metro|Market|Reclaim|Canopy|Geothermal|Tidal|Maglev|Sunk)/.test(s)) return s[0].toLowerCase() + s.slice(1);
  return s;
}
