import { artOffset } from './districts/slots';
import { buildingStats } from './buildingStats';
import {
  BUILDINGS,
  BULLDOZE_COST,
  DISTRICTS,
  PORT_LIMITS,
  RUINS,
  CROWNS,
  CURRENCY,
  FACTION_LABELS,
  RIBBON,
  ROAD_KINDS,
  SAFETY,
  SEAPORT,
  SKYWAY,
  STACK_COST_SCALE,
  STACK_STAGES,
  STANDING,
  TRACE,
  TURF,
  TURF_OWNER,
  UNLOCK_FALLBACK_POP,
  ZONES,
  isBuildingTool,
  isZoneTool,
} from './config';
import { districtName } from './news';
import { isBerthTile, noiseReach, shoreFacing } from './ports';
import { ROAD_TOOL_KIND, dragResult, isRoadTool, lostAccess, roadPrice, type RoadTool } from './roads';
import {
  SKY_MASK,
  SKY_RAMP,
  isSkyAnchorAt,
  planSkyway,
  skyNeighbour,
  skyOpposite,
  skyRampActive,
  skyRampGround,
  skywayDocks,
} from './skyway';
import { standing, tier } from './story/factions';
import * as turf from './story/turf';
import type { ActionResult, BuildingGate, CrownId, CrownOption, FactionId, GangId, Tier, Unlockable } from './story/types';
import * as vertical from './story/vertical';
import { scratchFor } from './frame';
import { Ground, RoadKind, Terrain, ZoneType, type ActionPlan, type Building, type BuildingType, type DistrictKind, type SlotId, type ToolId } from './types';
import type { World } from './world';


export interface Point {
  x: number;
  y: number;
}

const fmt = (n: number) => `${Math.round(n).toLocaleString('en-US')} ${CURRENCY}`;
const num = (n: number) => Math.round(n).toLocaleString('en-US');

/**
 * Tiles of an L-shaped road path from a to b: runs along the dominant axis
 * first, then turns. A single tap (a == b) yields one tile.
 */
export function roadPath(a: Point, b: Point): Point[] {
  const out: Point[] = [];
  const dx = Math.sign(b.x - a.x);
  const dy = Math.sign(b.y - a.y);
  const horizontalFirst = Math.abs(b.x - a.x) >= Math.abs(b.y - a.y);
  let x = a.x;
  let y = a.y;
  out.push({ x, y });
  if (horizontalFirst) {
    while (x !== b.x) {
      x += dx;
      out.push({ x, y });
    }
    while (y !== b.y) {
      y += dy;
      out.push({ x, y });
    }
  } else {
    while (y !== b.y) {
      y += dy;
      out.push({ x, y });
    }
    while (x !== b.x) {
      x += dx;
      out.push({ x, y });
    }
  }
  return out;
}

/** Inclusive rectangle of tiles spanned by a and b, clipped to the map. */
export function rectTiles(world: World, a: Point, b: Point): Point[] {
  const out: Point[] = [];
  const x0 = Math.max(0, Math.min(a.x, b.x));
  const x1 = Math.min(world.N - 1, Math.max(a.x, b.x));
  const y0 = Math.max(0, Math.min(a.y, b.y));
  const y1 = Math.min(world.N - 1, Math.max(a.y, b.y));
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) out.push({ x, y });
  return out;
}

/** Footprint top-left for a building of `size` centred on the tile under the finger. */
export function footprintOrigin(at: Point, size: number): Point {
  const off = Math.floor((size - 1) / 2);
  return { x: at.x - off, y: at.y - off };
}

// ── Gates and unlocks (§4.5, §5.0) ──────────────────────────────────────────

/** True if a story unlock is owned, or its population fallback (§5.0) has been reached. */
export function isUnlocked(world: World, what: Unlockable): boolean {
  if (world.story.unlocks.includes(what)) return true;
  const pop = UNLOCK_FALLBACK_POP[what];
  return pop !== undefined && world.maxPopulation >= pop;
}

const TIER_RANK: Record<Tier, number> = { hostile: 0, cold: 1, neutral: 2, friendly: 3, allied: 4 };

/** Is the faction at `need` or better? */
export function tierAtLeast(world: World, f: FactionId, need: 'friendly' | 'allied' = 'friendly'): boolean {
  return TIER_RANK[tier(world, f)] >= TIER_RANK[need];
}

/**
 * Gate rule (§4.5): open when (unlock owned) OR (faction at tier or better) OR
 * (maxPop ≥ fallbackPop), counting only the parts the gate defines. The turf
 * part depends on the footprint and is checked by planAction (turfGateReason).
 * Megacity (MEGACITY §6.3, §9.2): `district`, `lobby`, `districts`, `chapter` and
 * `ending` are further AND terms (the footprint part of `district` is checked by
 * planAction). Returns the first missing part, e.g. "Locked: Basalt Friendly",
 * "Needs the Shoals", "Needs a Sky Lobby of 5 towers".
 */
function gateReason(world: World, gate: BuildingGate, type?: BuildingType): string | null {
  const orPart = gate.unlock !== undefined || gate.faction !== undefined || gate.fallbackPop !== undefined;
  if (orPart) {
    const open =
      (gate.unlock && isUnlocked(world, gate.unlock)) ||
      (gate.faction && tierAtLeast(world, gate.faction, gate.tier)) ||
      (gate.fallbackPop !== undefined && world.maxPopulation >= gate.fallbackPop) ||
      (type !== undefined && patronRoute(world, type));
    if (!open) {
      if (gate.faction) return `Locked: ${FACTION_LABELS[gate.faction].short} ${gate.tier === 'allied' ? 'Allied' : 'Friendly'}`;
      if (gate.fallbackPop !== undefined) return `Locked: reach ${num(gate.fallbackPop)} residents`;
      return 'Locked: not yet';
    }
  }
  return gateAndReason(world, gate);
}

/** The Megacity AND terms of a gate (§6.3, §9.2), footprint aside. */
function gateAndReason(world: World, gate: BuildingGate): string | null {
  if (gate.district && !ownsKind(world, gate.district)) return `Needs ${districtLabel(gate.district)}`;
  if (gate.districts !== undefined && world.districts.owned.length < gate.districts) return `Needs ${gate.districts} districts`;
  if (gate.chapter !== undefined && chaptersDone(world) < gate.chapter) return `Needs Chapter ${ROMAN[gate.chapter] ?? gate.chapter} done`;
  if (gate.lobby !== undefined && largestLobby(world) < gate.lobby) return `Needs a Sky Lobby of ${gate.lobby} towers`;
  if (gate.ending !== undefined && world.story.ending !== gate.ending) return 'Opens with its ending';
  return null;
}

const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII'];

/** Chapters the story has completed (the epilogue counts all six). */
export function chaptersDone(world: World): number {
  const st = world.story;
  return st.ending ? 6 : Math.max(0, (st.chapter | 0) - 1);
}

/** The largest Sky Lobby's tower count (0 when none). */
export function largestLobby(world: World): number {
  let k = 0;
  for (const l of world.vertical.lobbies ?? []) k = Math.max(k, l.anchors.length);
  return k;
}

/** Does the city own a district of this kind (the kind's own or a 5×5 repeat)? */
export function ownsKind(world: World, kind: DistrictKind): boolean {
  const d = world.districts;
  for (const s of d.owned) if (d.kinds[s] === kind) return true;
  return false;
}

/** "the Shoals", "Kessel Flats" (§6.3 reasons: "Needs the Shoals"). */
export function districtLabel(kind: DistrictKind): string {
  const SHORT: Partial<Record<DistrictKind, string>> = { shoals: 'the Shoals', sunk: 'the Sunk', terraces: 'the Terraces', reedmere: 'Reedmere', bazaar: 'the Bazaar' };
  return SHORT[kind] ?? DISTRICTS[kind]?.name ?? kind;
}

/** Hexworks and the Pearl Atrium also open for their corp as patron at 300,000 residents (§6.3). */
function patronRoute(world: World, type: BuildingType): boolean {
  const corp = type === 'hexworks' ? 'basalt' : type === 'pearlatrium' ? 'nacre' : null;
  return corp !== null && world.story.flags.patron === corp && world.maxPopulation >= LANDMARK_PATRON_POP;
}
const LANDMARK_PATRON_POP = 300000;

/**
 * §6.3's unlocks that are an OR of districts (the rows carry their population part): Floodwatch at 15,000 residents
 * or with the Shoals, the Sunk or Reedmere owned; Reclaim Works at 50,000 or with Kessel Flats; the Tidal Turbine
 * and the Pump House with the Shoals, the Sunk or Reedmere; the Grand Terminal also needs a live ribbon of 4 stations.
 * Null when the type has no such rule (the ordinary gate decides).
 */
function districtUnlock(world: World, type: BuildingType): string | null | undefined {
  const wet = ownsKind(world, 'shoals') || ownsKind(world, 'sunk') || ownsKind(world, 'reedmere');
  switch (type) {
    case 'floodwatch':
      return wet || world.maxPopulation >= BUILDINGS.floodwatch.unlockPop ? null : `Locked: reach ${num(BUILDINGS.floodwatch.unlockPop)} residents`;
    case 'reclaim':
      return ownsKind(world, 'flats') || world.maxPopulation >= BUILDINGS.reclaim.unlockPop ? null : `Locked: reach ${num(BUILDINGS.reclaim.unlockPop)} residents`;
    case 'tidal':
    case 'pumphouse':
      return wet ? null : 'Needs the Shoals, the Sunk or Reedmere';
    default:
      return undefined;
  }
}

/** Turf part of a gate (§4.5): enough footprint tiles on the gang's turf. Null when it holds. */
export function turfGateReason(world: World, gate: BuildingGate | undefined, x: number, y: number, size: number): string | null {
  if (!gate?.turf) return null;
  const code = TURF_OWNER[gate.turf];
  const need = gate.minTurfTiles ?? 1;
  let n = 0;
  for (let dy = 0; dy < size; dy++)
    for (let dx = 0; dx < size; dx++) {
      if (!world.inBounds(x + dx, y + dy)) continue;
      if (world.turf.owner[world.idx(x + dx, y + dy)] === code) n++;
    }
  return n >= need ? null : `Must sit on ${FACTION_LABELS[gate.turf].short} turf`;
}

/** Is the tool unlocked for this world? Returns the unlock requirement if locked. */
export function lockedReason(world: World, tool: ToolId): string | null {
  // Expansion (EXPANSION §2.8, §3.4): road kinds and the skyway unlock on population only.
  if (isRoadTool(tool)) {
    const pop = ROAD_KINDS[ROAD_TOOL_KIND[tool]].unlockPop;
    return world.maxPopulation >= pop ? null : `Locked: reach ${num(pop)} residents`;
  }
  if (tool === 'skyway') return world.maxPopulation >= SKYWAY.unlockPop ? null : `Locked: reach ${num(SKYWAY.unlockPop)} residents`;
  if (tool === 'skybridge' || tool === 'rail') {
    if (isUnlocked(world, tool)) return null;
    return `Locked: reach ${num(UNLOCK_FALLBACK_POP[tool] ?? 0)} residents`;
  }
  if (!isBuildingTool(tool)) return null;
  const def = BUILDINGS[tool];
  // Hidden types (frames, the pump hall, any dropped optional type) are never in a tray (MEGACITY §3.2, §6.3).
  if (def.hidden) return 'Locked: not yet';
  const special = districtUnlock(world, tool);
  if (special !== undefined) return special;
  if (def.gate) {
    const g = gateReason(world, def.gate, tool);
    if (g) return g;
    if (tool === 'terminal' && world.vertical.metrics.railMaxStations < 4) return 'Needs a live ribbon of 4 stations';
    return null;
  }
  if (world.maxPopulation >= def.unlockPop) return null;
  return `Locked: reach ${num(def.unlockPop)} residents`;
}

// ── Costs (§10.6: buildCostMul × costMul × credit × 1.15ⁿ for stacks) ───────

/** Multiplier of the next build's credit for this type (1 when none). */
export function creditMul(world: World, type: BuildingType): number {
  for (const c of world.story.credits) if (c.what === type && c.n > 0) return c.mul;
  return 1;
}

function consumeCredit(world: World, type: BuildingType): void {
  const credits = world.story.credits;
  const k = credits.findIndex((c) => c.what === type && c.n > 0);
  if (k < 0) return;
  credits[k].n--;
  if (credits[k].n <= 0) credits.splice(k, 1);
}

/** Number of Stratablocks on the map (each scales the next plinth by STACK_COST_SCALE). */
function stackCount(world: World): number {
  let n = 0;
  for (const b of world.buildings.values()) if (b.type === 'stack') n++;
  return n;
}

/**
 * Current price of placing one building of this type, with every modifier. With a footprint `at`, a district's
 * `buildCostMul` applies when the whole footprint lies inside a district of that kind (MEGACITY §3.7).
 */
export function buildingCost(world: World, type: BuildingType, at?: { x: number; y: number; size: number }): number {
  const m = world.mods;
  let c = BUILDINGS[type].cost * m.buildCostMul * (m.costMul[type] ?? 1) * creditMul(world, type);
  if (type === 'stack') c *= Math.pow(STACK_COST_SCALE, stackCount(world));
  if (at) c *= districtBuildMul(world, type, at.x, at.y, at.size);
  return Math.round(c);
}

// ── Districts (MEGACITY §3.4, §3.5, §3.7, §6.3) ─────────────────────────────

/** The refusal on a locked tile (§3.4, §5.3). */
export const NOT_ANNEXED = 'Not annexed yet';

/** The slot of a locked in-bounds tile, else −1. */
export function lockedSlotAt(world: World, x: number, y: number): SlotId {
  if (!world.inBounds(x, y) || world.isOwned(x, y)) return -1;
  return world.slotAt(x, y);
}

/** The district kind every tile of a footprint lies in, or null when it straddles kinds or locked land. */
export function footprintKind(world: World, x: number, y: number, size: number): DistrictKind | null {
  let kind: DistrictKind | null = null;
  for (let dy = 0; dy < size; dy++)
    for (let dx = 0; dx < size; dx++) {
      if (!world.isOwned(x + dx, y + dy)) return null;
      const k = world.kindAt(x + dx, y + dy);
      if (kind === null) kind = k;
      else if (k !== kind) return null;
    }
  return kind;
}

/** A district's buildCostMul for a type when the footprint lies inside one district of a kind (§3.7). */
export function districtBuildMul(world: World, type: BuildingType, x: number, y: number, size: number): number {
  const k = footprintKind(world, x, y, size);
  return (k && DISTRICTS[k]?.mods.buildCostMul?.[type]) ?? 1;
}

/** A road tile next to a different terrace step (§3.7 Terraces: roads cost double on slopes). */
export function onSlope(world: World, x: number, y: number): boolean {
  const t = world.tileAt(x, y);
  if (!t || t.terrain !== Terrain.Land) return false;
  for (const [dx, dy] of [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ]) {
    const n = world.tileAt(x + dx, y + dy);
    if (n && n.terrain === Terrain.Land && n.elev !== t.elev) return true;
  }
  return false;
}

/** The district multiplier on a road tile's price (§3.7): roads (land), bridges (water) and slopes. */
export function districtRoadMul(world: World, x: number, y: number, water: boolean): number {
  const mods = DISTRICTS[world.kindAt(x, y)]?.mods;
  if (!mods) return 1;
  if (water) return mods.bridgeCostMul ?? 1;
  let m = mods.roadCostMul ?? 1;
  if (mods.slopeRoadMul && onSlope(world, x, y)) m *= mods.slopeRoadMul;
  return m;
}

/** A district's zoning price multiplier on a tile (§3.7: Kessel Flats Fab zoning half price). */
export function districtZoneMul(world: World, x: number, y: number, tool: 'res' | 'com' | 'ind'): number {
  return DISTRICTS[world.kindAt(x, y)]?.mods.zoneCostMul?.[tool] ?? 1;
}

/** How many of a port type the city may have at its district count (§3.5); undefined for other types. */
export function portLimit(world: World, type: BuildingType): number | undefined {
  const owned = world.districts.owned.length;
  if (type === 'seaport') return PORT_LIMITS.seaport(owned);
  if (type === 'airport') return PORT_LIMITS.airport(owned);
  if (type === 'spaceport') return PORT_LIMITS.spaceport(owned);
  return undefined;
}

const ORDINAL = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh'];

/** "A third Seaport needs 4 districts", or "Only 4 Seaports per city" when no district count lifts it (§3.5). */
export function portLimitReason(world: World, type: BuildingType, have: number): string {
  const def = BUILDINGS[type];
  const R = world.region;
  const cap = portLimit(world, type) ?? 0;
  for (let o = world.districts.owned.length + 1; o <= R * R; o++) {
    const next = type === 'seaport' ? PORT_LIMITS.seaport(o) : type === 'airport' ? PORT_LIMITS.airport(o) : PORT_LIMITS.spaceport(o);
    if (next > cap) {
      const word = ORDINAL[have] ?? `${have + 1}th`;
      return `A ${word} ${def.name} needs ${o} districts`;
    }
  }
  return cap === 1 ? `One ${def.name} per city` : `Only ${cap} ${def.plural ?? `${def.name}s`} per city`;
}

/** Open water a berth may use (§3.5): in the city, water, no bridge, no rail. */
function ownedOpenWater(world: World, x: number, y: number): boolean {
  if (!world.isOwned(x, y)) return false;
  const i = y * world.N + x;
  const t = world.tiles[i];
  return t.terrain === Terrain.Water && !t.road && world.rail[i] === 0;
}

/**
 * shoreFacing with the berth on owned water (§3.5: a Seaport's berth tiles must be owned open water; the ship's
 * approach may cross locked water). Sides tested S, E, N, W as ports.shoreFacing.
 */
export function ownedShoreFacing(world: World, x: number, y: number, size: number): 0 | 1 | 2 | 3 | -1 {
  for (const face of [2, 1, 0, 3] as const) {
    let ok = true;
    for (let k = 0; k < size && ok; k++)
      for (let d = 1; d <= SEAPORT.berthDepth; d++) {
        const bx = face === 1 ? x + size - 1 + d : face === 3 ? x - d : x + k;
        const by = face === 0 ? y - d : face === 2 ? y + size - 1 + d : y + k;
        if (!ownedOpenWater(world, bx, by)) {
          ok = false;
          break;
        }
      }
    if (ok) return face;
  }
  return -1;
}

/** The Tidal Turbine's site (§6.3): every footprint tile owned open water, not a berth, and 2 sides facing water. */
function waterSiteReason(world: World, x: number, y: number, size: number): string | null {
  for (let dy = 0; dy < size; dy++)
    for (let dx = 0; dx < size; dx++) {
      if (!ownedOpenWater(world, x + dx, y + dy)) return 'Needs open water';
      if (isBerthTile(world, x + dx, y + dy)) return 'Keep the berth clear';
      if (world.tiles[(y + dy) * world.N + x + dx].buildingId >= 0) return 'Site is occupied';
    }
  let sides = 0;
  for (const face of [0, 1, 2, 3]) {
    let all = true;
    for (let k = 0; k < size && all; k++) {
      const bx = face === 1 ? x + size : face === 3 ? x - 1 : x + k;
      const by = face === 0 ? y - 1 : face === 2 ? y + size : y + k;
      const t = world.tileAt(bx, by);
      all = !!t && t.terrain === Terrain.Water;
    }
    if (all) sides++;
  }
  return sides >= 2 ? null : 'Needs 2 sides on open water';
}

/** Pump Houses per district (§6.3) and their distance from the old pump hall. */
export const PUMP_RULES = { maxPerDistrict: 16, hallRadius: 6, days: 90 } as const;

/** Chebyshev gap between two footprints (0 when they touch or overlap). */
function footprintGap(ax: number, ay: number, as: number, bx: number, by: number, bs: number): number {
  const gx = Math.max(0, bx - (ax + as - 1), ax - (bx + bs - 1));
  const gy = Math.max(0, by - (ay + as - 1), ay - (by + bs - 1));
  return Math.max(gx, gy);
}

/** The district-specific site rules of a building (§6.3, §3.5, §3.7), or null when the site is fine. */
function districtSiteReason(world: World, type: BuildingType, x: number, y: number, size: number): string | null {
  const def = BUILDINGS[type];
  // Every building footprint stands on one terrace step (§3.7: "Buildings need flat ground").
  const e0 = world.tileAt(x, y)?.elev ?? 0;
  for (let dy = 0; dy < size; dy++)
    for (let dx = 0; dx < size; dx++) if ((world.tileAt(x + dx, y + dy)?.elev ?? 0) !== e0) return 'Needs flat ground';
  const kind = footprintKind(world, x, y, size);
  if (def.gate?.district && kind !== def.gate.district) return `Must stand in ${districtLabel(def.gate.district)}`;
  if (type === 'geothermal' && e0 < 1) return 'Needs a terrace step';
  if (type === 'pumphouse') {
    if (kind !== 'sunk' && kind !== 'shoals' && kind !== 'reedmere') return 'Needs the Shoals, the Sunk or Reedmere';
    for (const b of world.buildings.values())
      if (b.type === 'pumphall' && footprintGap(x, y, size, b.x, b.y, b.size) <= PUMP_RULES.hallRadius) return 'Too close to the old pump hall';
    const slot = world.slotAt(x, y);
    let n = 0;
    for (const b of world.buildings.values()) if (b.type === 'pumphouse' && world.slotAt(b.x, b.y) === slot) n++;
    if (n >= PUMP_RULES.maxPerDistrict) return `This district has its ${PUMP_RULES.maxPerDistrict} Pump Houses`;
  }
  // A second (and third) Airport stands in a Tarmac district (§3.5).
  if (type === 'airport' && countBuildings(world, 'airport') >= 1 && kind !== 'tarmac') return 'Another Airport needs Tarmac Reach';
  return null;
}

/** Ruin pay this sim month (§3.7: RUINS.payCapMonth), per world. */
const RUIN_PAY = new WeakMap<World, { month: number; paid: number }>();

/**
 * A ruin came back (§3.3, WP-1's growth calls this when a ruin recovers): its ground turns Plain, the city's
 * `ruinsRestored` grows by one and, in a district with `restorePay` (the Sunk), the city is paid up to
 * RUINS.payCapMonth a sim month. Returns the credits paid.
 */
export function ruinRestored(world: World, x: number, y: number): number {
  const t = world.tileAt(x, y);
  if (!t || !world.isOwned(x, y)) return 0;
  world.setGround(x, y, Ground.Plain);
  world.districts.ruinsRestored = (world.districts.ruinsRestored ?? 0) + 1;
  const pay = DISTRICTS[world.kindAt(x, y)]?.mods.restorePay ?? 0;
  if (!pay) return 0;
  const month = Math.floor(world.tick / 30);
  let s = RUIN_PAY.get(world);
  if (!s || s.month !== month) RUIN_PAY.set(world, (s = { month, paid: 0 }));
  const v = Math.max(0, Math.min(pay, RUINS.payCapMonth - s.paid));
  s.paid += v;
  world.funds += v;
  return v;
}

/** Cost of raising a Stratablock to `stage` (no credit, no plinth scaling). */
export function stageCost(world: World, stage: 2 | 3): number {
  const m = world.mods;
  return Math.round(STACK_STAGES[stage - 1].cost * m.buildCostMul * (m.costMul.stack ?? 1));
}

/** Bulldoze cost of a single tile (0 when empty). Rail on it costs RIBBON.bulldozeCost more. */
function bulldozeTileCost(world: World, x: number, y: number): number {
  const t = world.tileAt(x, y);
  if (!t) return 0;
  const rail = world.rail[world.idx(x, y)] ? RIBBON.bulldozeCost : 0;
  if (t.road) return BULLDOZE_COST + rail;
  if (t.zone !== ZoneType.None) return (t.level > 0 ? BULLDOZE_COST * 2 * t.level : 0) + rail;
  return rail;
}

/** Buildings of a type on the map. */
function countBuildings(world: World, type: BuildingType): number {
  let n = 0;
  for (const b of world.buildings.values()) if (b.type === type) n++;
  return n;
}

/** "One Airport per city" / "Only 2 Seaports per city" (§5.4). */
function maxCountReason(type: BuildingType): string {
  const def = BUILDINGS[type];
  const n = def.maxCount ?? 0;
  return n === 1 ? `One ${def.name} per city` : `Only ${n} ${def.plural ?? `${def.name}s`} per city`;
}

// ── Road drags (EXPANSION §3.4) ─────────────────────────────────────────────

/**
 * Plan a road drag of `tool` along roadPath(from, to) into `plan` (tiles, roadKinds,
 * upgrades, ramps, base cost, reason; for highways also lostAccess, lostTiles, note and
 * confirm). Returns the number of tiles that change. The caller applies buildCostMul and
 * the funds check.
 *
 * - The tile where a Street or Avenue drag steps onto a highway, and the one where it steps
 *   off, become On-ramps; the highway tile itself is passed through.
 * - Existing roads change by dragResult (smaller tools never shrink a road); an upgrade costs
 *   the price difference (bridge prices on water).
 * - Alleys and ramps can't sit on water; no new bridge on a seaport's berth.
 */
function planRoad(world: World, tool: RoadTool, from: Point, to: Point, plan: ActionPlan): number {
  const toolKind = ROAD_TOOL_KIND[tool];
  const tiles = world.tiles;
  const N = world.N;
  const path = roadPath(from, to).filter((p) => world.inBounds(p.x, p.y));
  const highwayAt = (p: Point | undefined, q: Point): boolean => {
    if (!p || Math.abs(p.x - q.x) + Math.abs(p.y - q.y) !== 1) return false;
    const t = tiles[p.y * N + p.x];
    return t.road && t.roadKind === RoadKind.Highway;
  };
  const makesRamps = toolKind === RoadKind.Street || toolKind === RoadKind.Avenue;
  const kinds: number[] = [];
  let changes = 0;
  let upgrades = 0;
  let ramps = 0;
  let reason: string | null = null;
  /** Existing roads this highway drag turns into Highway (what it can cut or strand). */
  const converted: number[] = [];
  for (let k = 0; k < path.length; k++) {
    const p = path[k];
    const t = tiles[p.y * N + p.x];
    const water = t.terrain === Terrain.Water;
    if (!world.isOwned(p.x, p.y)) {
      // Locked land (MEGACITY §3.4): refused tile by tile, the pill names the district.
      plan.tiles.push({ x: p.x, y: p.y, ok: false });
      kinds.push(toolKind);
      reason ??= NOT_ANNEXED;
      if (plan.slot === undefined) plan.slot = world.slotAt(p.x, p.y);
      continue;
    }
    const dmul = districtRoadMul(world, p.x, p.y, water);
    if (t.road && t.roadKind === RoadKind.Highway && toolKind !== RoadKind.Highway) {
      // The drag passes "through" the highway: this is what makes crossings work.
      plan.tiles.push({ x: p.x, y: p.y, ok: true });
      kinds.push(RoadKind.Highway);
      continue;
    }
    const ramp = makesRamps && (highwayAt(path[k - 1], p) || highwayAt(path[k + 1], p));
    const target = ramp ? RoadKind.Ramp : toolKind;
    if (t.road) {
      const result = dragResult(target, t.roadKind);
      if (result === null) {
        plan.tiles.push({ x: p.x, y: p.y, ok: true });
        kinds.push(t.roadKind);
        continue;
      }
      const price = roadPrice(result, water);
      if (price === null) {
        plan.tiles.push({ x: p.x, y: p.y, ok: false });
        kinds.push(result);
        reason ??= 'Ramps need land';
        continue;
      }
      plan.tiles.push({ x: p.x, y: p.y, ok: true });
      kinds.push(result);
      changes++;
      upgrades++;
      if (result === RoadKind.Ramp) ramps++;
      if (result === RoadKind.Highway) converted.push(p.y * N + p.x);
      plan.cost += Math.max(0, price - (roadPrice(t.roadKind, water) ?? 0)) * dmul;
      continue;
    }
    let ok = t.buildingId < 0 && !(t.zone !== ZoneType.None && t.level > 0);
    let why = 'Blocked by buildings';
    const price = roadPrice(target, water);
    if (ok && price === null) {
      ok = false;
      why = target === RoadKind.Alley ? "Alleys can't cross water" : 'Ramps need land';
    }
    if (ok && water && isBerthTile(world, p.x, p.y)) {
      ok = false;
      why = 'Keep the berth clear';
    }
    plan.tiles.push({ x: p.x, y: p.y, ok });
    kinds.push(target);
    if (!ok) {
      reason ??= why;
      continue;
    }
    changes++;
    if (target === RoadKind.Ramp) ramps++;
    plan.cost += (price ?? 0) * dmul;
  }
  plan.roadKinds = kinds;
  plan.upgrades = upgrades;
  plan.ramps = ramps;
  if (reason) plan.reason = reason;

  if (toolKind === RoadKind.Highway) {
    // What the highway cuts (§3.4 step 4): stranded lots first, then closed sky ramps, then cross streets.
    const lost: number[] = [];
    const n = lostAccess(world, converted, lost);
    plan.lostAccess = n;
    plan.lostTiles = lost;
    const onPath = new Set<number>();
    for (const p of path) onPath.add(p.y * N + p.x);
    const cuts = new Set<number>();
    let rampsClosed = 0;
    for (const i of converted) {
      if (skyRampActive(world, i)) rampsClosed++;
      for (let d = 1; d <= 8; d <<= 1) {
        const j = skyNeighbour(i, d, N);
        if (j < 0 || onPath.has(j)) continue;
        const nt = tiles[j];
        if (nt.road && (nt.roadKind === RoadKind.Street || nt.roadKind === RoadKind.Avenue || nt.roadKind === RoadKind.Alley)) cuts.add(j);
      }
    }
    if (n > 0) {
      plan.note = `${num(n)} ${n === 1 ? 'block loses' : 'blocks lose'} road access`;
      plan.confirm = true;
    } else if (rampsClosed > 0) plan.note = `Closes ${rampsClosed} skyway ${rampsClosed === 1 ? 'ramp' : 'ramps'}`;
    else if (cuts.size > 0) plan.note = `Cuts ${cuts.size} cross ${cuts.size === 1 ? 'street' : 'streets'}`;
  }
  return changes;
}

// ── Seaport sites and skyway networks (helpers for input, inspect and render) ──

/**
 * Seaport snap (§5.1): the finger tile whose footprint is the nearest valid shore site within
 * SEAPORT.snapRadius tiles (Chebyshev, nearest by distance, then lowest index) of the natural
 * footprint at `at`, or `at` itself when it is already valid or nothing is near. `marks` comes
 * from ports.shoreSites (1 = a valid top-left) on a world of side `N`.
 */
export function snapSeaport(at: Point, marks: Uint8Array, N: number): Point {
  const size = BUILDINGS.seaport.size;
  const off = Math.floor((size - 1) / 2);
  const o = footprintOrigin(at, size);
  const valid = (x: number, y: number) => x >= 0 && y >= 0 && x < N && y < N && marks[y * N + x] === 1;
  if (valid(o.x, o.y)) return { x: at.x, y: at.y };
  const R = SEAPORT.snapRadius;
  let best: Point | null = null;
  let bestD = Infinity;
  for (let dy = -R; dy <= R; dy++)
    for (let dx = -R; dx <= R; dx++) {
      if (!valid(o.x + dx, o.y + dy)) continue;
      const d = dx * dx + dy * dy;
      if (d < bestD) {
        bestD = d;
        best = { x: o.x + dx, y: o.y + dy };
      }
    }
  return best ? { x: best.x + off, y: best.y + off } : { x: at.x, y: at.y };
}

/** A skyway network: tiles, active and closed ramps, and the buildings it docks. */
export interface SkywayNetwork {
  tiles: number;
  /** Ramps that carry traffic (ground is a Street, Avenue or Ramp). */
  ramps: number;
  /** Ramps whose ground no longer qualifies (a highway, an alley or nothing below). */
  closed: number;
  /** skyAnchor buildings with a deck tile over their footprint. */
  docks: number;
}

/** skywayNetwork's BFS scratch (stamped, no clearing per call), one set per frame size. */
const netScratch = scratchFor((area) => ({ stamp: new Uint32Array(area), queue: new Int32Array(area), gen: 0 }));

/**
 * The skyway network through tile `i` (mutual links only; §3.7), for the skyway inspect sheet
 * and planner notes. All zeros when tile `i` carries no skyway.
 */
export function skywayNetwork(world: World, i: number): SkywayNetwork {
  const out: SkywayNetwork = { tiles: 0, ramps: 0, closed: 0, docks: 0 };
  const sky = world.sky;
  const N = world.N;
  if (!(i >= 0 && i < world.area) || (sky[i] & SKY_MASK) === 0) return out;
  const sc = netScratch(world.area);
  const { stamp: netStamp, queue: netQueue } = sc;
  sc.gen = (sc.gen + 1) >>> 0;
  if (sc.gen === 0) {
    netStamp.fill(0);
    sc.gen = 1;
  }
  const netGen = sc.gen;
  const docks = new Set<number>();
  let head = 0;
  let tail = 0;
  netStamp[i] = netGen;
  netQueue[tail++] = i;
  while (head < tail) {
    const j = netQueue[head++];
    out.tiles++;
    const m = sky[j];
    if (m & SKY_RAMP) {
      if (skyRampGround(world.tiles[j])) out.ramps++;
      else out.closed++;
    }
    const bid = world.tiles[j].buildingId;
    if (bid >= 0 && isSkyAnchorAt(world, j % N, (j / N) | 0)) docks.add(bid);
    for (let d = 1; d <= 8; d <<= 1) {
      if ((m & d) === 0) continue;
      const n = skyNeighbour(j, d, N);
      if (n < 0 || netStamp[n] === netGen || (sky[n] & skyOpposite(d)) === 0) continue;
      netStamp[n] = netGen;
      netQueue[tail++] = n;
    }
  }
  out.docks = docks.size;
  return out;
}

// ── Plan / apply ────────────────────────────────────────────────────────────

/** Options for a bulldoze plan (EXPANSION §3.6, §7.7). */
export interface PlanOpts {
  /** 'ground': never the sky layer, even when the first tile carries a deck (the inspect sheet's Demolish). */
  layer?: 'ground';
  /** Building ids whose demolition fee is waived (Game's full refund for buildings placed under SAFETY.refundSec ago). */
  waive?: ReadonlySet<number>;
  /** Corp Spire: who pays for it (MEGACITY §6.2). Missing → Nacre (today's numbers). */
  sponsor?: 'basalt' | 'nacre' | 'none';
  /** Faction buildings and Spires: the design picked in the confirm pill (0 = today's art). Missing → a hash of the id. */
  look?: 0 | 1 | 2 | 3;
}

/** Designs per family (§6.2): Spires by sponsor, the five faction buildings. Look 0 is today's art. */
export function lookCount(b: Pick<Building, 'type' | 'sponsor'>): number {
  if (b.type === 'spire') return b.sponsor === 'basalt' || b.sponsor === 'none' ? 3 : 4;
  if (b.type === 'foundry' || b.type === 'glarewall' || b.type === 'tidemarket' || b.type === 'roost' || b.type === 'commons') return 3;
  return 1;
}

/** A new placement that skipped the picker gets a hash of its id (§3.2). */
export function lookHash(id: number, n: number): number {
  let h = Math.imul(id | 0, 0x9e3779b1) >>> 0;
  h ^= h >>> 15;
  return n > 0 ? h % n : 0;
}

/**
 * Plan what `tool` would do for a gesture from `from` to `to` (tile coords).
 * Pure: never mutates the world. Used for live previews and by applyPlan.
 * Skybridge plans carry `span`, rail plans `railMasks`, for the renderer.
 */
export function planAction(world: World, tool: ToolId, from: Point, to: Point, opts?: PlanOpts): ActionPlan {
  const plan: ActionPlan = { tool, tiles: [], cost: 0, valid: false };
  let changes = 0;
  let blocked = 0;
  /** Tools whose base cost is scaled by buildCostMul at the end (buildings price themselves). */
  let scaled = true;

  if (tool === 'inspect') {
    plan.tiles.push({ x: to.x, y: to.y, ok: world.inBounds(to.x, to.y) });
    return plan;
  }

  if (isRoadTool(tool)) {
    const locked = lockedReason(world, tool);
    if (locked) {
      for (const p of [from, to]) if (world.inBounds(p.x, p.y)) plan.tiles.push({ x: p.x, y: p.y, ok: false });
      plan.reason = locked;
      return plan;
    }
    changes = planRoad(world, tool, from, to, plan);
  } else if (tool === 'skyway') {
    const locked = lockedReason(world, tool);
    if (locked) {
      for (const p of [from, to]) if (world.inBounds(p.x, p.y)) plan.tiles.push({ x: p.x, y: p.y, ok: false });
      plan.reason = locked;
      return plan;
    }
    changes = planSkyway(world, roadPath(from, to), plan);
    const lockedTile = plan.tiles.find((p) => lockedSlotAt(world, p.x, p.y) >= 0);
    if (lockedTile) {
      // A skyway over locked land is refused whole, like a blocked tile (MEGACITY §3.4).
      plan.slot = world.slotAt(lockedTile.x, lockedTile.y);
      plan.reason = NOT_ANNEXED;
      plan.tiles.forEach((p) => (p.ok = false));
      changes = 0;
    }
  } else if (isZoneTool(tool)) {
    const zone = ZONES[tool].zone;
    let lockedTiles = 0;
    for (const p of rectTiles(world, from, to)) {
      const t = world.tileAt(p.x, p.y)!;
      if (!world.isOwned(p.x, p.y)) {
        plan.tiles.push({ ...p, ok: false });
        lockedTiles++;
        if (plan.slot === undefined) plan.slot = world.slotAt(p.x, p.y);
        continue;
      }
      if (t.zone === zone) {
        plan.tiles.push({ ...p, ok: true });
        continue;
      }
      const ok =
        t.terrain === Terrain.Land &&
        !t.road &&
        t.buildingId < 0 &&
        (t.zone === ZoneType.None || t.level === 0);
      plan.tiles.push({ ...p, ok });
      if (ok) {
        changes++;
        plan.cost += ZONES[tool].cost * districtZoneMul(world, p.x, p.y, tool);
      } else blocked++;
    }
    if (lockedTiles) plan.reason = NOT_ANNEXED;
    else if (blocked) plan.reason = 'Some tiles are occupied';
  } else if (tool === 'bulldoze' && opts?.layer !== 'ground' && world.inBounds(from.x, from.y) && world.sky[world.idx(from.x, from.y)] !== 0) {
    // Sky drag (§3.6): the first tile carries a skyway, so this drag removes skyway segments only.
    plan.layer = 'sky';
    for (const p of rectTiles(world, from, to)) {
      const has = world.sky[world.idx(p.x, p.y)] !== 0;
      plan.tiles.push({ ...p, ok: has });
      if (has) {
        changes++;
        plan.cost += SKYWAY.bulldozeCost;
      }
    }
    if (!changes) plan.reason = 'Nothing to demolish';
  } else if (tool === 'bulldoze') {
    // Ground drag (§3.6): roads, zones, buildings and rail; skyway decks keep spanning the cleared site.
    plan.layer = 'ground';
    const seenBuildings = new Set<number>();
    let fixedHit = false;
    for (const p of rectTiles(world, from, to)) {
      const t = world.tileAt(p.x, p.y)!;
      if (t.buildingId >= 0) {
        const fb = world.buildings.get(t.buildingId);
        if (fb && BUILDINGS[fb.type].fixed) {
          // Frames and the old pump hall stay (MEGACITY §3.2): a frame is finished, never demolished.
          plan.tiles.push({ ...p, ok: false });
          fixedHit = true;
          continue;
        }
        plan.tiles.push({ ...p, ok: true });
        if (!seenBuildings.has(t.buildingId)) {
          seenBuildings.add(t.buildingId);
          const b = world.buildings.get(t.buildingId);
          if (b) {
            changes++;
            if (!opts?.waive?.has(b.id)) plan.cost += Math.round(BUILDINGS[b.type].cost * 0.05);
          }
        }
        continue;
      }
      const has = t.road || t.zone !== ZoneType.None || world.rail[world.idx(p.x, p.y)] !== 0;
      plan.tiles.push({ ...p, ok: has });
      if (has) {
        changes++;
        plan.cost += bulldozeTileCost(world, p.x, p.y);
      }
    }
    if (!changes) plan.reason = fixedHit ? "This stays: it can't be demolished" : 'Nothing to demolish';
  } else if (tool === 'skybridge' || tool === 'rail') {
    const locked = lockedReason(world, tool);
    if (locked) {
      for (const p of [from, to]) if (world.inBounds(p.x, p.y)) plan.tiles.push({ x: p.x, y: p.y, ok: false });
      plan.reason = locked;
      return plan;
    }
    changes = tool === 'skybridge' ? vertical.planSkybridge(world, from, to, plan) : vertical.planRail(world, roadPath(from, to), plan);
  } else if (isBuildingTool(tool)) {
    scaled = false;
    const def = BUILDINGS[tool];
    const o = footprintOrigin(to, def.size);
    plan.footprint = { x: o.x, y: o.y, size: def.size };
    let allOk = true;
    let water = false;
    let onRail = false;
    let onSky = false;
    let access = false;
    const onWater = def.site === 'water';
    let lockedSlot = -1;
    for (let dy = 0; dy < def.size; dy++)
      for (let dx = 0; dx < def.size; dx++) {
        const x = o.x + dx;
        const y = o.y + dy;
        const t = world.tileAt(x, y);
        const owned = world.isOwned(x, y);
        if (t && !owned && lockedSlot < 0) lockedSlot = world.slotAt(x, y);
        const ok = onWater
          ? !!t && owned && t.terrain === Terrain.Water && !t.road && t.buildingId < 0
          : !!t &&
            owned &&
            t.terrain === Terrain.Land &&
            !t.road &&
            t.buildingId < 0 &&
            (t.zone === ZoneType.None || t.level === 0);
        if (t && t.terrain === Terrain.Water && !onWater) water = true;
        if (t && world.rail[world.idx(x, y)]) onRail = true;
        if (t && world.sky[world.idx(x, y)]) onSky = true;
        if (t && !access && world.hasRoadAccess(x, y)) access = true;
        if (!ok) allOk = false;
        plan.tiles.push({ x, y, ok });
      }
    // Noisy buildings show the homes they would make loud, valid or not (§5.4).
    if (def.noise && world.inBounds(o.x, o.y)) {
      const loud: number[] = [];
      noiseReach(world, tool, o.x, o.y, loud);
      plan.loudTiles = loud;
    }
    const bad = (reason: string) => {
      plan.reason = reason;
      plan.tiles.forEach((t) => (t.ok = false));
      return plan;
    };
    const locked = lockedReason(world, tool);
    if (locked) return bad(locked);
    if (lockedSlot >= 0) {
      // Locked land (MEGACITY §3.4): the pill names the district; the toast offers the City map.
      plan.slot = lockedSlot;
      return bad(NOT_ANNEXED);
    }
    const ports = portLimit(world, tool);
    if (ports !== undefined) {
      const have = countBuildings(world, tool);
      if (have >= ports) return bad(portLimitReason(world, tool, have));
    } else if (def.maxCount !== undefined && countBuildings(world, tool) >= def.maxCount) return bad(maxCountReason(tool));
    if (!allOk) {
      plan.reason = onWater ? 'Needs open water' : water ? "Can't build on water" : 'Site is occupied';
      return plan;
    }
    if (onRail && !def.station) return bad('Rail in the way');
    if (onSky && !def.skyAnchor) return bad('Skyway in the way');
    if (def.needsRoad && !access) return bad('Needs road access');
    const siteReason = onWater ? waterSiteReason(world, o.x, o.y, def.size) : districtSiteReason(world, tool, o.x, o.y, def.size);
    if (siteReason) return bad(siteReason);
    if (def.site === 'shore' && ownedShoreFacing(world, o.x, o.y, def.size) < 0)
      return bad(shoreFacing(world, o.x, o.y, def.size) >= 0 ? 'The berth must be in the city' : 'Needs a straight shore');
    const turfReason = turfGateReason(world, def.gate, o.x, o.y, def.size);
    if (turfReason) return bad(turfReason);
    changes = 1;
    plan.cost = buildingCost(world, tool, plan.footprint);
    // Costly placements wait for ✓ (§7.7); the note says what the player is buying into.
    if (plan.cost >= SAFETY.confirmCost) plan.confirm = true;
    const loud = plan.loudTiles?.length ?? 0;
    if (loud > 0) plan.note = `Loud over ${num(loud)} ${loud === 1 ? 'home' : 'homes'}`;
    else if (tool === 'spaceport') plan.note = 'Takes 4+ minutes to build';
  }

  if (scaled && plan.cost > 0) plan.cost = Math.round(plan.cost * world.mods.buildCostMul);
  if (changes > 0 && plan.cost > world.funds) {
    plan.reason = `Not enough credits (need ${fmt(plan.cost)})`;
    plan.valid = false;
  } else {
    plan.valid = changes > 0;
    if (!plan.valid && !plan.reason) plan.reason = 'Nothing to change';
  }
  return plan;
}

/**
 * Execute a plan produced by planAction (re-plans first so it is never stale).
 * Charges funds, consumes build credits, refreshes vertical / turf caches when
 * rail, links or buildings changed, and pushes story signals. Returns the
 * executed plan (valid=false means nothing happened).
 */
export function applyAction(world: World, tool: ToolId, from: Point, to: Point, opts?: PlanOpts): ActionPlan {
  const plan = planAction(world, tool, from, to, opts);
  if (!plan.valid) return plan;

  if (isRoadTool(tool)) {
    // New tiles are laid at their kind; existing ones change kind without a reroll (§3.4).
    const kinds = plan.roadKinds ?? [];
    plan.tiles.forEach((p, k) => {
      if (!p.ok) return;
      const t = world.tileAt(p.x, p.y)!;
      const kind = (kinds[k] ?? ROAD_TOOL_KIND[tool]) as RoadKind;
      if (!t.road) world.setRoad(p.x, p.y, kind);
      else if (t.roadKind !== kind) world.setRoadKind(p.x, p.y, kind);
    });
  } else if (tool === 'skyway' && plan.skyMasks) {
    const masks = plan.skyMasks;
    plan.tiles.forEach((p, k) => {
      if (world.sky[world.idx(p.x, p.y)] !== masks[k]) world.setSky(p.x, p.y, masks[k]);
    });
  } else if (tool === 'bulldoze' && plan.layer === 'sky') {
    // A sky drag removes skyway segments only: ground, zones and buildings stay.
    for (const p of plan.tiles) if (p.ok) world.clearSky(p.x, p.y);
  } else if (isZoneTool(tool)) {
    const zone = ZONES[tool].zone;
    for (const p of plan.tiles) {
      const t = world.tileAt(p.x, p.y)!;
      if (p.ok && t.zone !== zone) world.setZone(p.x, p.y, zone);
    }
  } else if (tool === 'bulldoze') {
    let fabTiles = 0;
    const links = world.links.length;
    let structural = false;
    for (const p of plan.tiles) {
      if (!p.ok) continue;
      const t = world.tileAt(p.x, p.y)!;
      if (t.zone === ZoneType.Industrial && t.level > 0 && !t.abandoned) fabTiles++;
      if (t.buildingId >= 0 || world.rail[world.idx(p.x, p.y)]) structural = true;
      world.clearTile(p.x, p.y);
    }
    if (world.links.length !== links) structural = true; // a cleared anchor dropped its bridges
    world.pushSignal({ t: 'bulldozed', fabTiles });
    if (structural) vertical.refresh(world);
  } else if (tool === 'skybridge' && plan.span) {
    const s = plan.span;
    world.addLink({ ax: s.ax, ay: s.ay, bx: s.bx, by: s.by });
    // A two-bridge route builds both (MEGACITY §5.4; the plan confirmed first).
    const r = plan.route?.second;
    if (r) world.addLink({ ax: r.ax, ay: r.ay, bx: r.bx, by: r.by });
    vertical.refresh(world);
  } else if (tool === 'rail' && plan.railMasks) {
    const masks = plan.railMasks;
    plan.tiles.forEach((p, k) => {
      if (world.rail[world.idx(p.x, p.y)] !== masks[k]) world.setRail(p.x, p.y, masks[k]);
    });
    vertical.refresh(world);
  } else if (isBuildingTool(tool) && plan.footprint) {
    const fp = plan.footprint;
    let hadTurf = false;
    for (let dy = 0; dy < fp.size && !hadTurf; dy++)
      for (let dx = 0; dx < fp.size; dx++) if (world.turf.owner[world.idx(fp.x + dx, fp.y + dy)]) hadTurf = true;
    const b = world.addBuilding(tool, fp.x, fp.y);
    if (!b) {
      plan.valid = false;
      plan.reason = 'Site is occupied';
      return plan;
    }
    if (tool === 'stack') world.setStage(b, 1, STACK_STAGES[0].days);
    const def = BUILDINGS[tool];
    if (def.site === 'shore') {
      const f = ownedShoreFacing(world, fp.x, fp.y, fp.size);
      b.facing = f === -1 ? 2 : f;
    }
    // Spire sponsor and faction looks (MEGACITY §6.2): the picker's choice, else Nacre and a hash of the id.
    if (tool === 'spire') b.sponsor = opts?.sponsor ?? 'nacre';
    const looks = lookCount(b);
    if (looks > 1) {
      const pick = opts?.look;
      b.look = (pick !== undefined && pick < looks ? pick : lookHash(b.id, looks)) as 0 | 1 | 2 | 3;
      if (b.look !== 0) world.coverageVersion++;
    }
    if (tool === 'pumphouse') b.reclaim = PUMP_RULES.days;
    // Spaceport (§5.3): the countdown in days; Game adds the real-time floor (waitSec).
    if (tool !== 'stack' && def.buildDays) b.buildDays = def.buildDays;
    consumeCredit(world, tool);
    world.pushSignal({ t: 'built', type: tool, id: b.id });
    vertical.refresh(world);
    if (hadTurf) turf.refreshStats(world);
  }
  world.funds -= plan.cost;
  world.pushSignal({ t: 'action', tool, x: to.x, y: to.y });
  return plan;
}

// ── Story-facing helpers (favor / Trace writes for C's actions) ─────────────

/**
 * Change a faction's favor (clamped ±100) and emit 'standing' if its standing
 * moved. The director owns standing; this is the minimal write C's actions need.
 */
export function addFavor(world: World, f: FactionId, v: number): void {
  if (!v) return;
  const s = world.story;
  const before = standing(world, f);
  const next = Math.max(STANDING.min, Math.min(STANDING.max, (s.favor[f] ?? 0) + v));
  s.favor[f] = next;
  const after = standing(world, f);
  if (after !== before) world.events.emit('standing', { faction: f, delta: after - before, value: after });
}

/** Raise or lower Trace (§2.5): ignored while revealed or traceFrozen; capped 0..100. */
export function addTrace(world: World, v: number): void {
  const s = world.story;
  if (!v || s.revealed || s.flags.traceFrozen) return;
  const next = Math.max(0, Math.min(TRACE.max, s.trace + v));
  if (v > 0) s.traceRaisedThisMonth = true;
  if (next === s.trace) return;
  s.trace = next;
  world.events.emit('trace', { value: next });
}

// ── Stratablock stages (§4.2) ───────────────────────────────────────────────

/** Average land value over a building's footprint. */
function footprintLandValue(world: World, b: Building): number {
  let s = 0;
  for (let dy = 0; dy < b.size; dy++)
    for (let dx = 0; dx < b.size; dx++) s += world.fields.landValue[world.idx(b.x + dx, b.y + dy)];
  return s / (b.size * b.size);
}

/**
 * Is the stack anchoring an active skybridge, a station on a live ribbon line, or docked by a
 * skyway whose network has at least one active ramp (EXPANSION §3.7)? (Crown requirement.)
 */
export function stackConnected(world: World, b: Building): boolean {
  if (world.vertical.liveStations.has(b.id)) return true;
  const dock = skywayDocks(world, b);
  if (dock.docked && dock.ramps >= 1) return true;
  for (const l of world.links) {
    if (!world.vertical.activeLinks.has(l.id)) continue;
    if (world.tiles[world.idx(l.ax, l.ay)].buildingId === b.id || world.tiles[world.idx(l.bx, l.by)].buildingId === b.id) return true;
  }
  return false;
}

/** Why a crown can't be picked right now (null = ok). */
function crownReason(world: World, c: CrownId): string | null {
  const req = CROWNS[c].requires;
  if (!req) return null;
  const s = standing(world, req.f);
  return s >= req.standing ? null : `Needs ${FACTION_LABELS[req.f].short} ${req.standing}+ (now ${s})`;
}

/** Crown picker rows (§8.8): summary, one-time favor chips, availability. */
export function crownOptions(world: World): CrownOption[] {
  return (Object.keys(CROWNS) as CrownId[]).filter((id) => !CROWNS[id].hidden).map((id) => {
    const c = CROWNS[id];
    const reason = crownReason(world, id);
    return {
      id,
      name: c.name,
      summary: c.summary,
      favor: (Object.entries(c.favor) as [FactionId, number][]).map(([f, v]) => ({ f, v })),
      enabled: !reason,
      ...(reason ? { reason } : {}),
    };
  });
}

/** Whether a stack can start its next stage: the stage, its cost and days, and the first failing requirement. */
export function stageStatus(
  world: World,
  b: Building,
): { next: 2 | 3 | null; cost: number; days: number; building: number; reason: string | null } {
  const stage = b.stage ?? 1;
  const building = b.buildDays ?? 0;
  if (stage >= 3) return { next: null, cost: 0, days: 0, building, reason: building > 0 ? `Building, ${building}d left` : 'Fully raised' };
  const next = (stage + 1) as 2 | 3;
  const def = STACK_STAGES[next - 1];
  const cost = stageCost(world, next);
  const out = { next, cost, days: def.days, building, reason: null as string | null };
  if (building > 0) out.reason = `Building, ${building}d left`;
  else if (def.unlock && !isUnlocked(world, def.unlock)) {
    const pop = UNLOCK_FALLBACK_POP[def.unlock];
    out.reason = pop ? `Locked: reach ${num(pop)} residents` : 'Locked: not yet';
  } else if (def.minLandValue !== undefined) {
    const lv = footprintLandValue(world, b);
    if (lv < def.minLandValue) {
      out.reason = `Needs land value ${Math.round(def.minLandValue * 100)}%, now ${Math.round(lv * 100)}%`;
    }
  }
  if (!out.reason && next === 3 && !stackConnected(world, b)) out.reason = 'Needs a live skybridge, ribbon station or skyway';
  if (!out.reason && world.funds < cost) out.reason = `Not enough credits (need ${fmt(cost)})`;
  return out;
}

/**
 * Raise a Stratablock to its next stage (§4.2), or start its Crown with `crown`.
 * Charges the stage cost now; scaffolding counts down in vertical.onDay().
 * Picking a crown gives its one-time favor.
 */
export function raiseStage(world: World, id: number, crown?: CrownId): ActionResult {
  const b = world.buildings.get(id);
  if (!b || b.type !== 'stack') return { ok: false, reason: 'Not a Stratablock', cost: 0 };
  const st = stageStatus(world, b);
  if (st.next === null) return { ok: false, reason: st.reason ?? 'Fully raised', cost: 0 };
  if (st.reason) return { ok: false, reason: st.reason, cost: 0 };
  if (st.next === 3) {
    if (!crown || !CROWNS[crown]) return { ok: false, reason: 'Pick a crown', cost: 0 };
    const why = crownReason(world, crown);
    if (why) return { ok: false, reason: why, cost: 0 };
  }
  world.funds -= st.cost;
  world.setStage(b, st.next, st.days, st.next === 3 ? crown : undefined);
  if (st.next === 3 && crown) {
    for (const [f, v] of Object.entries(CROWNS[crown].favor) as [FactionId, number][]) addFavor(world, f, v);
  }
  world.pushSignal({ t: 'action', tool: 'raise', x: b.x, y: b.y });
  vertical.refresh(world);
  return { ok: true, cost: st.cost };
}

// ── Skeleton Row frames (MEGACITY §3.7) ─────────────────────────────────────

/** Share of the Stratablock plinth a frame costs to finish (§3.7). */
export const FRAME_FINISH_SHARE = 0.6;

/**
 * What finishing a frame costs and why it can't happen yet: 60% of the Stratablock plinth (STACK_STAGES[0].cost,
 * with the city's cost modifiers but not the per-stack 1.15 scale), and the Stratablock must be unlocked.
 */
export function frameStatus(world: World, id: number): { cost: number; reason: string | null } {
  const b = world.buildings.get(id);
  const m = world.mods;
  const cost = Math.round(STACK_STAGES[0].cost * FRAME_FINISH_SHARE * m.buildCostMul * (m.costMul.stack ?? 1));
  if (!b || b.type !== 'frame') return { cost, reason: 'Not a frame' };
  const locked = lockedReason(world, 'stack');
  if (locked) return { cost, reason: locked };
  if (world.funds < cost) return { cost, reason: `Not enough credits (need ${fmt(cost)})` };
  return { cost, reason: null };
}

/**
 * Finish a Skeleton Row frame (§3.7): the frame is replaced by a Stratablock at stage 1 complete (no plinth wait);
 * later stages as normal. Turf on the footprint clears as for any building.
 */
export function finishFrame(world: World, id: number): ActionResult {
  const st = frameStatus(world, id);
  if (st.reason) return { ok: false, reason: st.reason, cost: 0 };
  const f = world.buildings.get(id)!;
  const { x, y } = f;
  world.removeBuilding(id);
  const b = world.addBuilding('stack', x, y);
  if (!b) return { ok: false, reason: 'Site is occupied', cost: 0 };
  world.setStage(b, 1, 0);
  world.funds -= st.cost;
  world.pushSignal({ t: 'built', type: 'stack', id: b.id });
  world.pushSignal({ t: 'action', tool: 'raise', x, y });
  vertical.refresh(world);
  turf.refreshStats(world);
  return { ok: true, cost: st.cost };
}

// ── Crackdown (§3.6) ────────────────────────────────────────────────────────

/** Crackdown availability for a precinct: cost, zone and the first failing reason (null = ready). */
export function crackdownStatus(
  world: World,
  precinctId: number,
): { cost: number; x: number; y: number; r: number; reason: string | null; endsTruce: boolean } {
  const C = TURF.crackdown;
  const b = world.buildings.get(precinctId);
  const out = { cost: C.cost, x: 0, y: 0, r: 0, reason: null as string | null, endsTruce: world.turf.frozenUntil > world.tick };
  if (!b || b.type !== 'precinct') {
    out.reason = 'Not a precinct';
    return out;
  }
  out.x = b.x + b.size / 2;
  out.y = b.y + b.size / 2;
  out.r = buildingStats(b).radius;
  const ready = world.story.precinctReady[b.id] ?? 0;
  if (!isUnlocked(world, 'crackdown')) out.reason = `Locked: reach ${num(UNLOCK_FALLBACK_POP.crackdown ?? 0)} residents`;
  else if (ready > world.tick) out.reason = `Cooldown ${ready - world.tick}d`;
  else if (!b.powered || b.offline > 0) out.reason = 'Precinct has no power';
  else {
    const n = turf.tilesInDisc(world, out.x, out.y, out.r);
    if (n.undertow + n.kites === 0) out.reason = 'No turf in range';
    else if (world.funds < out.cost) out.reason = `Not enough credits (need ${fmt(out.cost)})`;
  }
  return out;
}

/**
 * Crackdown from a powered precinct (§3.6): every turf tile in its radius loses
 * 60 now (and 30/mo for 60 d via turf.update), street-fighting crime for 60 d,
 * favor hits and broken pacts for gangs with ≥ 5 tiles in the zone, Board +6,
 * Tuning −5, Trace +1, approval ±2 for 90 d, gangActions +1; ends the Seam Truce.
 * The caller (Game) then calls director.markDirty() and sim.recomputeAll().
 */
export function crackdown(world: World, precinctId: number): ActionResult {
  const st = crackdownStatus(world, precinctId);
  if (st.reason) return { ok: false, reason: st.reason, cost: 0 };
  const C = TURF.crackdown;
  const s = world.story;
  const tick = world.tick;
  const { x, y, r } = st;
  const before = turf.gangTiles(world);
  const inZone = turf.tilesInDisc(world, x, y, r);
  turf.hitDisc(world, x, y, r, C.hit);
  const hit = (Object.keys(inZone) as GangId[]).filter((g) => inZone[g] >= C.minTiles);
  s.crackdowns.push({ x, y, r, until: tick + C.days, scatterAt: tick + C.scatterDays, hit, base: before });
  s.locals.push({ id: `crackdown.${precinctId}.${tick}`, x, y, r, until: tick + C.days, crimeAdd: C.crime, lvAdd: 0 });
  for (const g of hit) {
    addFavor(world, g, C.favorHit);
    if (turf.breakPact(world, g)) addFavor(world, g, C.pactBreak);
  }
  addFavor(world, 'board', C.board);
  addFavor(world, 'tuning', C.tuning);
  addTrace(world, C.trace);
  const modId = `crackdown.${precinctId}`;
  const k = s.mods.findIndex((m) => m.id === modId);
  if (k >= 0) s.mods.splice(k, 1);
  const approval = world.stats.avgCrime >= C.approvalCrime ? C.approval : -C.approval;
  s.mods.push({ id: modId, label: 'Crackdown', until: tick + C.approvalDays, mods: { approvalAdd: approval } });
  s.gangActions++;
  s.lastCrackdownTick = tick;
  if (st.endsTruce) {
    world.turf.frozenUntil = tick;
    delete s.flags.truce;
    world.addNews('The Seam Truce is over. Both crews heard the wasps first.', 'bad');
  }
  s.precinctReady[precinctId] = tick + C.cooldown;
  world.funds -= st.cost;
  world.addNews(`Wasps over ${districtName(Math.floor(x), Math.floor(y), world.seed, artOffset(world))}. Doors kicked, tags scrubbed, nobody sleeps.`, 'info');
  world.pushSignal({ t: 'action', tool: 'crackdown', x: Math.floor(x), y: Math.floor(y) });
  turf.refreshStats(world);
  return { ok: true, cost: st.cost };
}
