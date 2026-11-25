// ─────────────────────────────────────────────────────────────────────────────
// District effects (docs/MEGACITY.md §3.3, §3.7, §8.4; WP-2).
//
// The district layer part (`world.layerParts.district`): land value, crime,
// park and pollution terms read from DISTRICTS[kind].mods, per owned district.
// It is rebuilt per slot, inside the sim day (unit C1, one slot a step), only
// where an input changed: a tile input the terms read (ground, the step, a wild
// reed, a developed brownfield lot, a frame), terrain, an annex, a tide starting
// or ending, a new sim year; each slot's window merges with composeLayersRect.
// Annex, load and story effects rewrite it whole (`force`). Plus the
// story effects that name a district (§8.4): clearBrownfield, clearRuins,
// drainReeds and apron, which story/effects.ts calls (WP-7 wires the verbs).
// ─────────────────────────────────────────────────────────────────────────────

import { DISTRICTS, type DistrictMods } from '../config';
import { composeLayers, composeLayersRect, resetLayers } from '../story/mods';
import { DAYS_PER_MONTH, Ground, SLOT, Terrain, ZoneType, type DistrictKind, type SlotId } from '../types';
import type { World } from '../world';
import { isRuin, slotPreset, tarmacSites, waterDistance } from './annex';
import { slotOffset, slotRect, type TileRect } from './slots';

const S2 = SLOT * SLOT;
const MONTHS_PER_YEAR = 12;
/**
 * The farthest a district term reaches past its own tile (reedPark r1, frameCrime r3, the water distance cap 2): a
 * slot's rebuild rewrites its rect ⊕ this, and every owned slot whose terms reach that window writes into it again.
 */
export const PART_REACH = 3;
/** A 'tiles' rect up to this many tiles is checked tile by tile (the per-tile input codes); a larger one dirties its slots. */
const CHECK_TILES = 1024;

/** What the district part last read (MEGACITY §3.3): rebuilt per slot, only where an input changed. */
interface PartState {
  slotsVersion: number;
  terrainVersion: number;
  tide: boolean;
  tideCoverage: number;
  year: number;
  /** Per slot: its part needs rewriting (its rect ⊕ PART_REACH). */
  dirty: Uint8Array;
  /** Per tile: the inputs the part reads there (inputCode), so growth's level changes elsewhere cost nothing. */
  code: Uint8Array;
  /** Water distance per slot, cached on terrainVersion. */
  wd: Map<SlotId, { tv: number; d: Uint8Array }>;
}
const STATE = new WeakMap<World, PartState>();

/** Kinds whose terms read tiles that change in play (rubble, brownfield development, reeds, frames). */
const TILE_KINDS: ReadonlySet<DistrictKind> = new Set<DistrictKind>(['sunk', 'flats', 'reedmere', 'skeleton']);

/**
 * The inputs the district part reads on a tile, as one byte: land, ground, the terrace step, and for the kinds that
 * read development, a reed tile left wild, a developed brownfield lot or a frame standing on it.
 */
function inputCode(world: World, i: number, mods: DistrictMods | undefined): number {
  const t = world.tiles[i];
  if (t.terrain !== Terrain.Land) return 0;
  let c = 1 | (t.ground << 1) | (Math.min(7, t.elev) << 3);
  if (mods?.reedPark && isWildReed(world, i)) c |= 64;
  if (mods?.brownfield && t.ground === Ground.Brownfield && t.zone !== ZoneType.None && t.level >= 1 && !t.abandoned) c |= 64;
  if (mods?.frameCrime && t.buildingId >= 0 && world.buildings.get(t.buildingId)?.type === 'frame') c |= 128;
  return c;
}

function stateOf(world: World): PartState {
  let s = STATE.get(world);
  if (!s) {
    const R = world.region;
    const st: PartState = {
      slotsVersion: -1,
      terrainVersion: world.terrainVersion,
      tide: world.tide > 0,
      tideCoverage: world.coverageVersion,
      year: yearOf(world),
      dirty: new Uint8Array(R * R).fill(1),
      code: new Uint8Array(world.area),
      wd: new Map(),
    };
    s = st;
    STATE.set(world, st);
    world.events.on('tiles', (r) => tilesChanged(world, st, r));
    world.events.on('terrain', (r) => {
      // Land and water move: the water distance (cap 2) and every term on land within reach of the rect.
      dirtyAround(world, st, { x0: r.x0 - PART_REACH, y0: r.y0 - PART_REACH, x1: r.x1 + PART_REACH, y1: r.y1 + PART_REACH });
    });
  }
  return s;
}

const yearOf = (world: World): number => Math.floor(world.tick / (DAYS_PER_MONTH * MONTHS_PER_YEAR));

/** Mark every owned slot a rect touches dirty. */
function dirtyAround(world: World, st: PartState, r: TileRect): void {
  const R = world.region;
  const sx0 = Math.max(0, r.x0 >> 6);
  const sy0 = Math.max(0, r.y0 >> 6);
  const sx1 = Math.min(R - 1, r.x1 >> 6);
  const sy1 = Math.min(R - 1, r.y1 >> 6);
  for (let sy = sy0; sy <= sy1; sy++) for (let sx = sx0; sx <= sx1; sx++) if (world.slotOwned[sy * R + sx]) st.dirty[sy * R + sx] = 1;
}

/** A 'tiles' event: in a district whose terms read tiles, dirty its slot only if an input there really changed. */
function tilesChanged(world: World, st: PartState, r: TileRect): void {
  const R = world.region;
  const N = world.N;
  const sx0 = Math.max(0, r.x0 >> 6);
  const sy0 = Math.max(0, r.y0 >> 6);
  const sx1 = Math.min(R - 1, r.x1 >> 6);
  const sy1 = Math.min(R - 1, r.y1 >> 6);
  const big = (r.x1 - r.x0 + 1) * (r.y1 - r.y0 + 1) > CHECK_TILES;
  for (let sy = sy0; sy <= sy1; sy++)
    for (let sx = sx0; sx <= sx1; sx++) {
      const slot = sy * R + sx;
      if (st.dirty[slot] || !world.slotOwned[slot]) continue;
      const kind = world.districts.kinds[slot];
      if (!TILE_KINDS.has(kind)) continue;
      if (big) {
        st.dirty[slot] = 1;
        continue;
      }
      const mods = DISTRICTS[kind]?.mods;
      const x0 = Math.max(r.x0, sx << 6);
      const x1 = Math.min(r.x1, (sx << 6) + 63);
      const y0 = Math.max(r.y0, sy << 6);
      const y1 = Math.min(r.y1, (sy << 6) + 63);
      for (let y = y0; y <= y1 && !st.dirty[slot]; y++)
        for (let x = x0; x <= x1; x++) {
          const i = y * N + x;
          if (inputCode(world, i, mods) !== st.code[i]) {
            st.dirty[slot] = 1;
            break;
          }
        }
    }
}

/** Chebyshev water distance of every tile of a slot (cap 2), cached until the terrain changes. */
function waterDist(world: World, slot: SlotId): Uint8Array {
  const st = stateOf(world);
  const c = st.wd.get(slot);
  if (c && c.tv === world.terrainVersion) return c.d;
  const d = waterDistance(world, slotRect(world, slot), 2);
  st.wd.set(slot, { tv: world.terrainVersion, d });
  return d;
}

/** Owned slots of a kind (annex order). */
export function ownedOfKind(world: World, kind: DistrictKind): SlotId[] {
  return world.districts.owned.filter((s) => world.districts.kinds[s] === kind);
}

/** Does any owned district carry this mod? */
function anyOwnedWith(world: World, test: (kind: DistrictKind) => boolean): boolean {
  return world.districts.owned.some((s) => test(world.districts.kinds[s]));
}

/**
 * Dirty the slots whose terms changed without a tile event: an annex (every owned slot: terms reach across the new
 * border), a tide starting or ending (king-tide districts), a Floodwatch's reach changing mid-tide (coverage), a new
 * sim year (the Sunk's crime decay).
 */
function noteTriggers(world: World, st: PartState): void {
  const owned = world.districts.owned;
  const mark = (test: (m: DistrictMods) => boolean) => {
    for (const s of owned) {
      const m = DISTRICTS[world.districts.kinds[s]]?.mods;
      if (m && test(m)) st.dirty[s] = 1;
    }
  };
  if (st.slotsVersion !== world.slotsVersion) {
    st.slotsVersion = world.slotsVersion;
    for (const s of owned) st.dirty[s] = 1;
  }
  if (st.terrainVersion !== world.terrainVersion) st.terrainVersion = world.terrainVersion; // the 'terrain' events dirtied
  const tide = world.tide > 0;
  if (tide !== st.tide || (tide && world.coverageVersion !== st.tideCoverage)) mark((m) => !!m.kingTide);
  st.tide = tide;
  st.tideCoverage = world.coverageVersion;
  const year = yearOf(world);
  if (year !== st.year) mark((m) => !!m.crime);
  st.year = year;
}

/**
 * Rebuild the district layer part where what it reads changed (a tile input in a district whose terms read tiles, an
 * annex, a terrain change, a tide starting or ending, a new sim year), slot by slot, merging each slot's window into
 * the layers. `force` (annex, story effects, load) rewrites the whole part and composes it. Returns true when it
 * rebuilt anything.
 */
export function updateDistrictLayers(world: World, force = false): boolean {
  if (force) {
    writeDistrictPart(world);
    composeLayers(world);
    return true;
  }
  let any = false;
  const u = districtPartUnit(world);
  for (let r = u.next(); !r.done; r = u.next()) any = true;
  return any;
}

/**
 * The district part's daily upkeep as steps (MEGACITY §3.3, unit C1): one dirty slot per step (its window rewritten
 * and merged, ≈ 0.3 ms), so no step comes near SLICE.unitMaxNodeMs at 25 districts. Yields after each slot rebuilt.
 */
export function* districtPartUnit(world: World): Generator<void, void, void> {
  const st = stateOf(world);
  noteTriggers(world, st);
  for (const slot of world.districts.owned) {
    if (!st.dirty[slot]) continue;
    rebuildSlot(world, st, slot);
    yield;
  }
}

/** Rewrite the part over a slot's rect ⊕ PART_REACH (every owned slot reaching it writes again, in owned order) and merge it. */
function rebuildSlot(world: World, st: PartState, slot: SlotId): void {
  st.dirty[slot] = 0;
  const N = world.N;
  const r = slotRect(world, slot);
  const win: TileRect = {
    x0: Math.max(0, r.x0 - PART_REACH),
    y0: Math.max(0, r.y0 - PART_REACH),
    x1: Math.min(N - 1, r.x1 + PART_REACH),
    y1: Math.min(N - 1, r.y1 + PART_REACH),
  };
  const part = world.layerParts.district;
  for (let y = win.y0; y <= win.y1; y++) {
    const lo = y * N + win.x0;
    const hi = y * N + win.x1 + 1;
    part.lvAdd.fill(0, lo, hi);
    part.crimeAdd.fill(0, lo, hi);
    part.parkAdd.fill(0, lo, hi);
    part.pollutionAdd.fill(0, lo, hi);
  }
  for (const s of world.districts.owned) {
    const sr = slotRect(world, s);
    if (sr.x1 + PART_REACH < win.x0 || sr.x0 - PART_REACH > win.x1 || sr.y1 + PART_REACH < win.y0 || sr.y0 - PART_REACH > win.y1) continue;
    writeSlot(world, s, win, st);
  }
  composeLayersRect(world, win);
}

/** Write `world.layerParts.district` from every owned district's mods (§3.3): the whole part, reset first. */
export function writeDistrictPart(world: World): void {
  const st = stateOf(world);
  noteTriggers(world, st);
  resetLayers(world.layerParts.district);
  for (const slot of world.districts.owned) writeSlot(world, slot, null, st);
  st.dirty.fill(0);
}

/**
 * One district's terms into the part: per-tile terms on its own land, stamps (reed park, frame crime) around their
 * sources. With `clip`, only tiles inside it are written (a slot's rebuild window), so the result there equals the
 * whole rebuild's. Refreshes the slot's input codes.
 */
function writeSlot(world: World, slot: SlotId, clip: TileRect | null, st: PartState): void {
  const part = world.layerParts.district;
  const N = world.N;
  const res = world.fields.resilience;
  const kind = world.districts.kinds[slot];
  const mods = DISTRICTS[kind]?.mods;
  if (!mods || kind === 'shore') return;
  const r = slotRect(world, slot);
  // Sources that can reach the clip window.
  const lx0 = clip ? Math.max(0, clip.x0 - PART_REACH - r.x0) : 0;
  const ly0 = clip ? Math.max(0, clip.y0 - PART_REACH - r.y0) : 0;
  const lx1 = clip ? Math.min(SLOT - 1, clip.x1 + PART_REACH - r.x0) : SLOT - 1;
  const ly1 = clip ? Math.min(SLOT - 1, clip.y1 + PART_REACH - r.y0) : SLOT - 1;
  if (lx0 > lx1 || ly0 > ly1) return;
  const inClip = (x: number, y: number) => !clip || (x >= clip.x0 && x <= clip.x1 && y >= clip.y0 && y <= clip.y1);
  const wd = mods.lvShore || mods.kingTide ? waterDist(world, slot) : null;
  // Sunk crime decays from the annex day (half-life in days), stepped by sim year (the part is rebuilt on the
  // first day of each year).
  let crime = 0;
  if (mods.crime) {
    const at = world.districts.annexedAt[slot] ?? world.tick;
    const yearDays = DAYS_PER_MONTH * MONTHS_PER_YEAR;
    crime = mods.crime.v * halfLifeShare(Math.floor(Math.max(0, world.tick - at) / yearDays) * yearDays, mods.crime.halfLifeDays);
  }
  const tide = mods.kingTide && world.tide > 0 ? mods.kingTide.lv : 0;
  const codes = TILE_KINDS.has(kind) ? st.code : null;
  for (let ly = ly0; ly <= ly1; ly++) {
    const y = r.y0 + ly;
    const row = y * N + r.x0;
    for (let lx = lx0; lx <= lx1; lx++) {
      const i = row + lx;
      const x = r.x0 + lx;
      const own = inClip(x, y);
      if (own && codes) codes[i] = inputCode(world, i, mods);
      const t = world.tiles[i];
      if (t.terrain !== Terrain.Land) continue;
      if (own) {
        let lv = 0;
        if (mods.lvAll) lv += kind === 'sunk' ? (t.ground === Ground.Rubble ? mods.lvAll : 0) : mods.lvAll;
        if (mods.lvShore && wd && wd[ly * SLOT + lx] <= 2) lv += mods.lvShore;
        if (mods.lvPerElev) lv += mods.lvPerElev * t.elev;
        if (tide && wd && wd[ly * SLOT + lx] <= 1 && !(res[i] > 0)) lv += tide;
        if (lv) part.lvAdd[i] += lv;
        if (crime) part.crimeAdd[i] += crime;
        if (mods.brownfield && t.ground === Ground.Brownfield) {
          const developed = t.zone !== ZoneType.None && t.level >= 1 && !t.abandoned;
          part.pollutionAdd[i] += developed ? mods.brownfield.developedPollution : mods.brownfield.pollution;
        }
      }
      if (mods.reedPark && isWildReed(world, i)) stamp(part.parkAdd, world, x, y, mods.reedPark.r, mods.reedPark.v, clip);
    }
  }
  const fc: { v: number; r: number } | undefined = mods.frameCrime;
  if (fc) {
    for (const b of world.buildings.values()) {
      if (b.type !== 'frame' || world.slotAt(b.x, b.y) !== slot) continue;
      for (let y: number = b.y - fc.r; y < b.y + b.size + fc.r; y++)
        for (let x: number = b.x - fc.r; x < b.x + b.size + fc.r; x++) {
          if (!world.isOwned(x, y) || !inClip(x, y)) continue;
          const i = y * N + x;
          if (world.tiles[i].terrain !== Terrain.Land) continue;
          // Max-combined between frames: two frames side by side are no worse than one.
          if (part.crimeAdd[i] < crime + fc.v) part.crimeAdd[i] = crime + fc.v;
        }
    }
  }
}

/**
 * What is left of a term with half-life `h` days after `t` days: halves every h days, linear between the halvings
 * (exact arithmetic, the same on every engine; within 6% of 0.5^(t/h) everywhere).
 */
export function halfLifeShare(t: number, h: number): number {
  if (!(h > 0) || !(t > 0)) return 1;
  const n = Math.floor(t / h);
  let v = 1;
  for (let k = 0; k < n && v > 1e-9; k++) v *= 0.5;
  return v * (1 - (0.5 * (t - n * h)) / h);
}

/** Max-combine `v` over the Chebyshev r-neighbourhood of (x, y), owned land only (and inside `clip` when given). */
function stamp(arr: Float32Array, world: World, x: number, y: number, r: number, v: number, clip: TileRect | null): void {
  const N = world.N;
  for (let dy = -r; dy <= r; dy++)
    for (let dx = -r; dx <= r; dx++) {
      const xx = x + dx;
      const yy = y + dy;
      if (!world.isOwned(xx, yy)) continue;
      if (clip && (xx < clip.x0 || xx > clip.x1 || yy < clip.y0 || yy > clip.y1)) continue;
      const i = yy * N + xx;
      if (arr[i] < v) arr[i] = v;
    }
}

/** An unbuilt reed tile: Reed ground with no road, zone or building (§3.7: free park while left be). */
export function isWildReed(world: World, i: number): boolean {
  const t = world.tiles[i];
  return t.terrain === Terrain.Land && t.ground === Ground.Reed && !t.road && t.zone === ZoneType.None && t.buildingId < 0;
}

/**
 * Reedmere floodplain (§3.3, §3.7): land within 1 of water in a marsh district (Reedmere Marsh or a variant). Its lots
 * stay at level 2 or below while `resilience` is 0 there (WP-1's growth rule reads this; inspect shows the note).
 */
export function isFloodplain(world: World, x: number, y: number): boolean {
  const t = world.tileAt(x, y);
  if (!t || t.terrain !== Terrain.Land || !world.isOwned(x, y)) return false;
  if (DISTRICTS[world.kindAt(x, y)]?.mods.floodplainMaxLevel === undefined) return false;
  for (let dy = -1; dy <= 1; dy++)
    for (let dx = -1; dx <= 1; dx++) {
      const n = world.tileAt(x + dx, y + dy);
      if (n && n.terrain === Terrain.Water) return true;
    }
  return false;
}

/** The highest level a lot may reach here (3 unless a floodplain without Floodwatch cover, §3.3). */
export function maxLevelAt(world: World, x: number, y: number): number {
  if (!isFloodplain(world, x, y)) return 3;
  if (world.fields.resilience[y * world.N + x] > 0) return 3;
  return DISTRICTS[world.kindAt(x, y)].mods.floodplainMaxLevel ?? 3;
}

/** Owned Shoals land within 1 of open water during a king tide, where no Floodwatch covers it (§3.7). */
export function kingTideAt(world: World, x: number, y: number): boolean {
  if (world.tide <= 0 || !world.isOwned(x, y)) return false;
  const mods = DISTRICTS[world.kindAt(x, y)]?.mods;
  if (!mods?.kingTide) return false;
  const i = y * world.N + x;
  if (world.tiles[i].terrain !== Terrain.Land || world.fields.resilience[i] > 0) return false;
  for (let dy = -1; dy <= 1; dy++)
    for (let dx = -1; dx <= 1; dx++) {
      const n = world.tileAt(x + dx, y + dy);
      if (n && n.terrain === Terrain.Water) return true;
    }
  return false;
}

// ── Story effects that name a district (§8.4) ────────────────────────────────

/** `brownfield clear`: every brownfield tile in every owned Kessel Flats district turns Plain. Returns tiles cleared. */
export function clearBrownfield(world: World): number {
  let n = 0;
  for (const slot of ownedOfKind(world, 'flats')) {
    const r = slotRect(world, slot);
    for (let y = r.y0; y <= r.y1; y++)
      for (let x = r.x0; x <= r.x1; x++)
        if (world.tiles[y * world.N + x].ground === Ground.Brownfield) {
          world.setGround(x, y, Ground.Plain);
          n++;
        }
  }
  if (n) updateDistrictLayers(world, true);
  return n;
}

/** `ruins clear`: the Sunk's remaining ruins become empty zoned lots (zone kept, level 0, ground Plain). Returns how many. */
export function clearRuins(world: World): number {
  let n = 0;
  for (const slot of ownedOfKind(world, 'sunk')) {
    const r = slotRect(world, slot);
    for (let y = r.y0; y <= r.y1; y++)
      for (let x = r.x0; x <= r.x1; x++) {
        const t = world.tiles[y * world.N + x];
        if (!isRuin(t)) continue;
        world.setLevel(x, y, 0);
        world.setGround(x, y, Ground.Plain);
        n++;
      }
  }
  if (n) updateDistrictLayers(world, true);
  return n;
}

/**
 * `reeds drain`: reed ground turns Plain on the half of every owned marsh district nearer the start slot (the half
 * whose tiles lie toward the start along the slot's offset). Returns tiles drained.
 */
export function drainReeds(world: World): number {
  let n = 0;
  for (const slot of ownedOfKind(world, 'reedmere')) {
    const r = slotRect(world, slot);
    const [dx, dy] = slotOffset(world.region, slot);
    for (let ly = 0; ly < SLOT; ly++)
      for (let lx = 0; lx < SLOT; lx++) {
        // Toward the start: the component along the offset is negative.
        const along = (lx - 31.5) * dx + (ly - 31.5) * dy;
        if (along >= 0) continue;
        const x = r.x0 + lx;
        const y = r.y0 + ly;
        if (world.tiles[y * world.N + x].ground !== Ground.Reed) continue;
        world.setGround(x, y, Ground.Plain);
        n++;
      }
  }
  if (n) updateDistrictLayers(world, true);
  return n;
}

/**
 * `apron rehouse` / `apron clear` (§8.3, ds.tarmac): the apron families of every owned Tarmac Reach (variant 0 only).
 * Rehouse: their Hab tiles step to level 2 and tier $$. Clear: the block is bulldozed and its zoning removed (its
 * alley too). Returns the tiles changed.
 */
export function apron(world: World, mode: 'rehouse' | 'clear'): number {
  let n = 0;
  for (const slot of ownedOfKind(world, 'tarmac')) {
    if (slotPreset(world, slot) !== 'v0') continue;
    const f = tarmacSites(world, slot).families;
    if (!f) continue;
    for (let y = f.y0; y <= f.y1; y++)
      for (let x = f.x0; x <= f.x1; x++) {
        const t = world.tileAt(x, y);
        if (!t || !world.isOwned(x, y)) continue;
        if (mode === 'rehouse') {
          if (t.zone !== ZoneType.Residential) continue;
          world.setLevel(x, y, 2, false, 1);
          n++;
        } else if (t.zone !== ZoneType.None || t.road) {
          if (t.buildingId >= 0) continue;
          world.clearTile(x, y);
          n++;
        }
      }
  }
  return n;
}

/** Ground tiles of a kind in an owned slot (tests, goals, the City map's terrain line). */
export function countGround(world: World, slot: SlotId, g: Ground): number {
  const r = slotRect(world, slot);
  let n = 0;
  for (let y = r.y0; y <= r.y1; y++) for (let x = r.x0; x <= r.x1; x++) if (world.tiles[y * world.N + x].ground === g) n++;
  return n;
}

/** Does any owned district carry a king tide (Saltglass Shoals or a variant)? */
export function ownsTideDistrict(world: World): boolean {
  return anyOwnedWith(world, (k) => !!DISTRICTS[k]?.mods.kingTide);
}

/** The per-tile scratch size a slot uses (exported for tests). */
export const SLOT_TILES = S2;
