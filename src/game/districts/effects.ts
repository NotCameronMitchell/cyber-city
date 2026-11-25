// ─────────────────────────────────────────────────────────────────────────────
// District effects (docs/MEGACITY.md §3.3, §3.7, §8.4; WP-2).
//
// The district layer part (`world.layerParts.district`): land value, crime,
// park and pollution terms read from DISTRICTS[kind].mods, per owned district,
// rebuilt at most once per sim day (and on annex, at tide start and end and on
// the first day of each sim year), then merged by `composeLayers`. Plus the
// story effects that name a district (§8.4): clearBrownfield, clearRuins,
// drainReeds and apron, which story/effects.ts calls (WP-7 wires the verbs).
// ─────────────────────────────────────────────────────────────────────────────

import { DISTRICTS } from '../config';
import { composeLayers, resetLayers } from '../story/mods';
import { DAYS_PER_MONTH, Ground, SLOT, Terrain, ZoneType, type DistrictKind, type SlotId } from '../types';
import type { World } from '../world';
import { isRuin, slotPreset, tarmacSites, waterDistance } from './annex';
import { slotOffset, slotRect, type TileRect } from './slots';

const S2 = SLOT * SLOT;
const MONTHS_PER_YEAR = 12;

/** What the district part last read (rebuilt only when it changes, at most once a sim day). */
interface PartState {
  key: string;
  day: number;
  /** A tile changed in a district whose terms read tiles (ground, development, frames). */
  dirty: boolean;
  /** Water distance per slot, cached on terrainVersion. */
  wd: Map<SlotId, { tv: number; d: Uint8Array }>;
}
const STATE = new WeakMap<World, PartState>();

/** Kinds whose terms read tiles that change in play (rubble, brownfield development, reeds, frames). */
const TILE_KINDS: ReadonlySet<DistrictKind> = new Set<DistrictKind>(['sunk', 'flats', 'reedmere', 'skeleton']);

function stateOf(world: World): PartState {
  let s = STATE.get(world);
  if (!s) {
    const st: PartState = { key: '', day: -1, dirty: true, wd: new Map() };
    s = st;
    STATE.set(world, st);
    world.events.on('tiles', (r) => {
      if (st.dirty) return;
      const R = world.region;
      const sx0 = Math.max(0, r.x0 >> 6);
      const sy0 = Math.max(0, r.y0 >> 6);
      const sx1 = Math.min(R - 1, r.x1 >> 6);
      const sy1 = Math.min(R - 1, r.y1 >> 6);
      for (let sy = sy0; sy <= sy1; sy++)
        for (let sx = sx0; sx <= sx1; sx++) {
          const slot = sy * R + sx;
          if (world.slotOwned[slot] && TILE_KINDS.has(world.districts.kinds[slot])) st.dirty = true;
        }
    });
  }
  return s;
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
 * The key the part depends on besides tile changes: slots, terrain, the tide, the year (Sunk crime decay) and, while a
 * king tide runs, coverage (a Floodwatch built mid-tide lifts the tide's land-value term where it reaches).
 */
function partKey(world: World): string {
  const year = Math.floor(world.tick / (DAYS_PER_MONTH * MONTHS_PER_YEAR));
  return `${world.slotsVersion}|${world.terrainVersion}|${world.tide > 0 ? world.coverageVersion : -1}|${year}`;
}

/**
 * Rebuild the district layer part when what it reads changed (a tile in a district whose terms read tiles, an annex,
 * a terrain change, a tide starting or ending, a new sim year), at most once per sim day unless `force` (annex, story
 * effects). Returns true when it rebuilt (and composed the layers).
 */
export function updateDistrictLayers(world: World, force = false): boolean {
  const st = stateOf(world);
  const key = partKey(world);
  if (!force && ((key === st.key && !st.dirty) || st.day === world.tick)) return false;
  st.key = key;
  st.day = world.tick;
  st.dirty = false;
  writeDistrictPart(world);
  composeLayers(world);
  return true;
}

/** Write `world.layerParts.district` from every owned district's mods (§3.3). */
export function writeDistrictPart(world: World): void {
  const part = world.layerParts.district;
  resetLayers(part);
  const N = world.N;
  const res = world.fields.resilience;
  for (const slot of world.districts.owned) {
    const kind = world.districts.kinds[slot];
    const mods = DISTRICTS[kind]?.mods;
    if (!mods || kind === 'shore') continue;
    const r = slotRect(world, slot);
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
    for (let ly = 0; ly < SLOT; ly++) {
      const row = (r.y0 + ly) * N + r.x0;
      for (let lx = 0; lx < SLOT; lx++) {
        const i = row + lx;
        const t = world.tiles[i];
        if (t.terrain !== Terrain.Land) continue;
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
        if (mods.reedPark && isWildReed(world, i)) stamp(part.parkAdd, world, r.x0 + lx, r.y0 + ly, mods.reedPark.r, mods.reedPark.v, r);
      }
    }
    const fc: { v: number; r: number } | undefined = mods.frameCrime;
    if (fc) {
      for (const b of world.buildings.values()) {
        if (b.type !== 'frame' || world.slotAt(b.x, b.y) !== slot) continue;
        for (let y: number = b.y - fc.r; y < b.y + b.size + fc.r; y++)
          for (let x: number = b.x - fc.r; x < b.x + b.size + fc.r; x++) {
            if (!world.isOwned(x, y)) continue;
            const i = y * N + x;
            if (world.tiles[i].terrain !== Terrain.Land) continue;
            // Max-combined between frames: two frames side by side are no worse than one.
            if (part.crimeAdd[i] < crime + fc.v) part.crimeAdd[i] = crime + fc.v;
          }
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

/** Max-combine `v` over the Chebyshev r-neighbourhood of (x, y), owned land only, clipped to the slot ± r. */
function stamp(arr: Float32Array, world: World, x: number, y: number, r: number, v: number, _slot: TileRect): void {
  const N = world.N;
  for (let dy = -r; dy <= r; dy++)
    for (let dx = -r; dx <= r; dx++) {
      const xx = x + dx;
      const yy = y + dy;
      if (!world.isOwned(xx, yy)) continue;
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
