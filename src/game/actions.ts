import { buildingStats } from './buildingStats';
import {
  BRIDGE_COST,
  BUILDINGS,
  BULLDOZE_COST,
  CROWNS,
  CURRENCY,
  FACTION_LABELS,
  RIBBON,
  ROAD_COST,
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
import { standing, tier } from './story/factions';
import * as turf from './story/turf';
import type { ActionResult, BuildingGate, CrownId, CrownOption, FactionId, GangId, Tier, Unlockable } from './story/types';
import * as vertical from './story/vertical';
import { Terrain, ZoneType, type ActionPlan, type Building, type BuildingType, type ToolId } from './types';
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
 * Returns the first missing part, e.g. "Locked: Basalt Friendly".
 */
function gateReason(world: World, gate: BuildingGate): string | null {
  if (gate.unlock && isUnlocked(world, gate.unlock)) return null;
  if (gate.faction && tierAtLeast(world, gate.faction, gate.tier)) return null;
  if (gate.fallbackPop !== undefined && world.maxPopulation >= gate.fallbackPop) return null;
  if (gate.faction) return `Locked: ${FACTION_LABELS[gate.faction].short} ${gate.tier === 'allied' ? 'Allied' : 'Friendly'}`;
  if (gate.fallbackPop !== undefined) return `Locked: reach ${num(gate.fallbackPop)} residents`;
  return 'Locked: not yet';
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
  if (tool === 'skybridge' || tool === 'rail') {
    if (isUnlocked(world, tool)) return null;
    return `Locked: reach ${num(UNLOCK_FALLBACK_POP[tool] ?? 0)} residents`;
  }
  if (!isBuildingTool(tool)) return null;
  const def = BUILDINGS[tool];
  if (def.gate) return gateReason(world, def.gate);
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

/** Current price of placing one building of this type, with every modifier. */
export function buildingCost(world: World, type: BuildingType): number {
  const m = world.mods;
  let c = BUILDINGS[type].cost * m.buildCostMul * (m.costMul[type] ?? 1) * creditMul(world, type);
  if (type === 'stack') c *= Math.pow(STACK_COST_SCALE, stackCount(world));
  return Math.round(c);
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

// ── Plan / apply ────────────────────────────────────────────────────────────

/**
 * Plan what `tool` would do for a gesture from `from` to `to` (tile coords).
 * Pure: never mutates the world. Used for live previews and by applyPlan.
 * Skybridge plans carry `span`, rail plans `railMasks`, for the renderer.
 */
export function planAction(world: World, tool: ToolId, from: Point, to: Point): ActionPlan {
  const plan: ActionPlan = { tool, tiles: [], cost: 0, valid: false };
  let changes = 0;
  let blocked = 0;
  /** Tools whose base cost is scaled by buildCostMul at the end (buildings price themselves). */
  let scaled = true;

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
      const has = t.road || t.zone !== ZoneType.None || world.rail[world.idx(p.x, p.y)] !== 0;
      plan.tiles.push({ ...p, ok: has });
      if (has) {
        changes++;
        plan.cost += bulldozeTileCost(world, p.x, p.y);
      }
    }
    if (!changes) plan.reason = 'Nothing to demolish';
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
    let access = false;
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
        if (t && world.rail[world.idx(x, y)]) onRail = true;
        if (t && !access && world.hasRoadAccess(x, y)) access = true;
        if (!ok) allOk = false;
        plan.tiles.push({ x, y, ok });
      }
    const bad = (reason: string) => {
      plan.reason = reason;
      plan.tiles.forEach((t) => (t.ok = false));
      return plan;
    };
    const locked = lockedReason(world, tool);
    if (locked) return bad(locked);
    if (!allOk) {
      plan.reason = water ? "Can't build on water" : 'Site is occupied';
      return plan;
    }
    if (onRail && !def.station) return bad('Rail in the way');
    if (tool === 'stack' && !access) return bad('Needs road access');
    const turfReason = turfGateReason(world, def.gate, o.x, o.y, def.size);
    if (turfReason) return bad(turfReason);
    changes = 1;
    plan.cost = buildingCost(world, tool);
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

/** Is the stack anchoring an active skybridge, or a station on a live ribbon line? (Crown requirement.) */
export function stackConnected(world: World, b: Building): boolean {
  if (world.vertical.liveStations.has(b.id)) return true;
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
  return (Object.keys(CROWNS) as CrownId[]).map((id) => {
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
  if (!out.reason && next === 3 && !stackConnected(world, b)) out.reason = 'Needs a live skybridge or ribbon station';
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
  world.addNews(`Wasps over ${districtName(Math.floor(x), Math.floor(y), world.seed)}. Doors kicked, tags scrubbed, nobody sleeps.`, 'info');
  world.pushSignal({ t: 'action', tool: 'crackdown', x: Math.floor(x), y: Math.floor(y) });
  turf.refreshStats(world);
  return { ok: true, cost: st.cost };
}
