import {
  BRIDGE_COST,
  BUILDINGS,
  BULLDOZE_COST,
  CURRENCY,
  FACTION_LABELS,
  ROAD_COST,
  UNLOCK_FALLBACK_POP,
  ZONES,
  isBuildingTool,
  isZoneTool,
} from './config';
import type { ActionResult, BuildingGate, CrownId, Unlockable } from './story/types';
import { Terrain, ZoneType, type ActionPlan, type ToolId } from './types';
import type { World } from './world';

export interface Point {
  x: number;
  y: number;
}

const fmt = (n: number) => `${Math.round(n).toLocaleString('en-US')} ${CURRENCY}`;

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
  const x1 = Math.min(world.size - 1, Math.max(a.x, b.x));
  const y0 = Math.max(0, Math.min(a.y, b.y));
  const y1 = Math.min(world.size - 1, Math.max(a.y, b.y));
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) out.push({ x, y });
  return out;
}

/** Footprint top-left for a building of `size` centred on the tile under the finger. */
export function footprintOrigin(at: Point, size: number): Point {
  const off = Math.floor((size - 1) / 2);
  return { x: at.x - off, y: at.y - off };
}

/** True if a story unlock is owned, or its population fallback (§5.0) has been reached. */
export function isUnlocked(world: World, what: Unlockable): boolean {
  if (world.story.unlocks.includes(what)) return true;
  const pop = UNLOCK_FALLBACK_POP[what];
  return pop !== undefined && world.maxPopulation >= pop;
}

/**
 * Step 0 gate check (§4.5): open when the unlock is owned or maxPop ≥ fallbackPop.
 * TODO(WP-C): OR the faction-tier part via factions.ts tier(world, f), and check
 * the footprint turf rule in planAction ("Must sit on Undertow turf").
 */
function gateReason(world: World, gate: BuildingGate): string | null {
  if (gate.unlock && world.story.unlocks.includes(gate.unlock)) return null;
  if (gate.fallbackPop !== undefined && world.maxPopulation >= gate.fallbackPop) return null;
  if (gate.faction) return `Locked: ${FACTION_LABELS[gate.faction].short} ${gate.tier === 'allied' ? 'Allied' : 'Friendly'}`;
  if (gate.fallbackPop !== undefined) return `Locked: reach ${gate.fallbackPop.toLocaleString('en-US')} residents`;
  return 'Locked: not yet';
}

/** Is the tool unlocked for this world? Returns the unlock requirement if locked. */
export function lockedReason(world: World, tool: ToolId): string | null {
  if (tool === 'skybridge' || tool === 'rail') {
    if (isUnlocked(world, tool)) return null;
    return `Locked: reach ${(UNLOCK_FALLBACK_POP[tool] ?? 0).toLocaleString('en-US')} residents`;
  }
  if (!isBuildingTool(tool)) return null;
  const def = BUILDINGS[tool];
  if (def.gate) return gateReason(world, def.gate);
  if (world.maxPopulation >= def.unlockPop) return null;
  return `Locked: reach ${def.unlockPop.toLocaleString('en-US')} residents`;
}

/**
 * Raise a Stratablock to its next stage (§4.2), or start its Crown with `crown`.
 * TODO(WP-C): Step 0 stub, always refuses.
 */
export function raiseStage(_world: World, _id: number, _crown?: CrownId): ActionResult {
  return { ok: false, reason: 'Not available yet', cost: 0 };
}

/**
 * Crackdown from a powered precinct (§3.6).
 * TODO(WP-C): Step 0 stub, always refuses.
 */
export function crackdown(_world: World, _precinctId: number): ActionResult {
  return { ok: false, reason: 'Not available yet', cost: 0 };
}

/** Bulldoze cost of a single tile (0 when empty). */
function bulldozeTileCost(world: World, x: number, y: number): number {
  const t = world.tileAt(x, y);
  if (!t) return 0;
  if (t.road) return BULLDOZE_COST;
  if (t.zone !== ZoneType.None) return t.level > 0 ? BULLDOZE_COST * 2 * t.level : 0;
  return 0;
}

/**
 * Plan what `tool` would do for a gesture from `from` to `to` (tile coords).
 * Pure: never mutates the world. Used for live previews and by applyPlan.
 */
export function planAction(world: World, tool: ToolId, from: Point, to: Point): ActionPlan {
  const plan: ActionPlan = { tool, tiles: [], cost: 0, valid: false };
  let changes = 0;
  let blocked = 0;

  if (tool === 'inspect') {
    plan.tiles.push({ x: to.x, y: to.y, ok: world.inBounds(to.x, to.y) });
    return plan;
  }

  if (tool === 'road') {
    for (const p of roadPath(from, to)) {
      const t = world.tileAt(p.x, p.y);
      if (!t) continue;
      if (t.road) {
        plan.tiles.push({ ...p, ok: true });
        continue;
      }
      const ok = t.buildingId < 0 && !(t.zone !== ZoneType.None && t.level > 0);
      plan.tiles.push({ ...p, ok });
      if (ok) {
        changes++;
        plan.cost += t.terrain === Terrain.Water ? BRIDGE_COST : ROAD_COST;
      } else blocked++;
    }
    if (blocked) plan.reason = 'Blocked by buildings';
  } else if (isZoneTool(tool)) {
    const zone = ZONES[tool].zone;
    for (const p of rectTiles(world, from, to)) {
      const t = world.tileAt(p.x, p.y)!;
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
        plan.cost += ZONES[tool].cost;
      } else blocked++;
    }
    if (blocked) plan.reason = 'Some tiles are occupied';
  } else if (tool === 'bulldoze') {
    const seenBuildings = new Set<number>();
    for (const p of rectTiles(world, from, to)) {
      const t = world.tileAt(p.x, p.y)!;
      if (t.buildingId >= 0) {
        plan.tiles.push({ ...p, ok: true });
        if (!seenBuildings.has(t.buildingId)) {
          seenBuildings.add(t.buildingId);
          const b = world.buildings.get(t.buildingId);
          if (b) {
            changes++;
            plan.cost += Math.round(BUILDINGS[b.type].cost * 0.05);
          }
        }
        continue;
      }
      const has = t.road || t.zone !== ZoneType.None;
      plan.tiles.push({ ...p, ok: has });
      if (has) {
        changes++;
        plan.cost += bulldozeTileCost(world, p.x, p.y);
      }
    }
    if (!changes) plan.reason = 'Nothing to demolish';
  } else if (isBuildingTool(tool)) {
    const def = BUILDINGS[tool];
    const o = footprintOrigin(to, def.size);
    plan.footprint = { x: o.x, y: o.y, size: def.size };
    let allOk = true;
    let water = false;
    for (let dy = 0; dy < def.size; dy++)
      for (let dx = 0; dx < def.size; dx++) {
        const x = o.x + dx;
        const y = o.y + dy;
        const t = world.tileAt(x, y);
        const ok =
          !!t &&
          t.terrain === Terrain.Land &&
          !t.road &&
          t.buildingId < 0 &&
          (t.zone === ZoneType.None || t.level === 0);
        if (t && t.terrain === Terrain.Water) water = true;
        if (!ok) allOk = false;
        plan.tiles.push({ x, y, ok });
      }
    const locked = lockedReason(world, tool);
    if (locked) {
      plan.reason = locked;
      plan.tiles.forEach((t) => (t.ok = false));
      return plan;
    }
    if (!allOk) {
      plan.reason = water ? "Can't build on water" : 'Site is occupied';
      return plan;
    }
    changes = 1;
    plan.cost = def.cost;
  }

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
 * Charges funds. Returns the executed plan (valid=false means nothing happened).
 */
export function applyAction(world: World, tool: ToolId, from: Point, to: Point): ActionPlan {
  const plan = planAction(world, tool, from, to);
  if (!plan.valid) return plan;

  if (tool === 'road') {
    for (const p of plan.tiles) {
      const t = world.tileAt(p.x, p.y)!;
      if (p.ok && !t.road) world.setRoad(p.x, p.y);
    }
  } else if (isZoneTool(tool)) {
    const zone = ZONES[tool].zone;
    for (const p of plan.tiles) {
      const t = world.tileAt(p.x, p.y)!;
      if (p.ok && t.zone !== zone) world.setZone(p.x, p.y, zone);
    }
  } else if (tool === 'bulldoze') {
    for (const p of plan.tiles) if (p.ok) world.clearTile(p.x, p.y);
  } else if (isBuildingTool(tool) && plan.footprint) {
    const b = world.addBuilding(tool, plan.footprint.x, plan.footprint.y);
    if (!b) {
      plan.valid = false;
      plan.reason = 'Site is occupied';
      return plan;
    }
  }
  world.funds -= plan.cost;
  return plan;
}
