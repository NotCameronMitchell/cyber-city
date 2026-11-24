// ─────────────────────────────────────────────────────────────────────────────
// Heights: the one height truth for the skybridge rule and the art (docs/MEGACITY.md
// §3.2, §5.3, §6.1). Interface and bounds frozen after Step 0b; WP-4 may only
// regenerate CLASSIC_TOPS (its art test keeps the table equal to the art).
//
// Heights are world px above the ground (the art's z). A zone body's main mass is
// drawn at kitTop(spec) (kit bodies) or CLASSIC_TOPS[id] (today's 72 hand-built
// forms); the skybridge rule uses the mass, never roof clutter.
// ─────────────────────────────────────────────────────────────────────────────

import { BUILDINGS } from './config';
import { completeStage } from './buildingStats';
import { parcelAt } from './parcels';
import { ZoneType, type DistrictKind } from './types';
import type { World } from './world';

/**
 * Today's zone body tops (EXPANSION §4.5 ids 0..431: ((((zone − 1) × 3 + level − 1) × 8 + form) × 3 + tier) × 2 + palBit),
 * generated once from the art (render/buildings.ts zoneModelInfo(…).top, rounded to 0.01 px) by Step 0b.
 */
export const CLASSIC_TOPS: readonly number[] = [
  31.08, 28.12, 31.08, 28.12, 31.08, 28.12, 29.14, 26.11, 29.14, 26.11, 29.14, 26.11,
  33, 33, 33, 33, 33, 33, 28, 28.1, 28, 28.1, 28, 28.1,
  26.13, 26.54, 26.13, 26.54, 26.13, 26.54, 24, 24, 24, 24, 24, 24,
  26.83, 24.72, 26.83, 24.72, 26.83, 24.72, 21.43, 19.09, 21.43, 19.09, 21.43, 19.09,
  67.56, 72.1, 67.56, 72.1, 67.56, 72.1, 65.46, 62.55, 65.46, 62.55, 65.46, 62.55,
  52.23, 54.95, 52.23, 54.95, 52.23, 54.95, 69.79, 73.09, 69.79, 73.09, 69.79, 73.09,
  80.66, 77.1, 80.66, 77.1, 80.66, 77.1, 74.52, 75.17, 74.52, 75.17, 74.52, 75.17,
  71.22, 75.23, 71.22, 75.23, 71.22, 75.23, 57.2, 58.09, 57.2, 58.09, 57.2, 58.09,
  146.48, 146.6, 146.48, 146.6, 146.48, 146.6, 157.29, 154.62, 157.29, 154.62, 157.29, 154.62,
  140.64, 145.73, 140.64, 145.73, 140.64, 145.73, 127.97, 132.28, 127.97, 132.28, 127.97, 132.28,
  151.17, 152.05, 151.17, 152.05, 151.17, 152.05, 130.6, 137.8, 130.6, 137.8, 130.6, 137.8,
  169.06, 163.68, 169.06, 163.68, 169.06, 163.68, 149.49, 146.95, 149.49, 146.95, 149.49, 146.95,
  22, 22, 22, 22, 22, 22, 12.48, 11.5, 12.48, 11.5, 12.48, 11.5,
  19.23, 20.71, 19.23, 20.71, 19.23, 20.71, 30.15, 28.78, 30.15, 28.78, 30.15, 28.78,
  16, 16, 16, 16, 16, 16, 20, 20, 20, 20, 20, 20,
  18.7, 17.87, 18.7, 17.87, 18.7, 17.87, 20.57, 20.3, 20.57, 20.3, 20.57, 20.3,
  50.85, 52.44, 50.85, 52.44, 50.85, 52.44, 51.31, 53.44, 51.31, 53.44, 51.31, 53.44,
  61.57, 61.57, 61.57, 61.57, 61.57, 61.57, 68.37, 66.47, 68.37, 66.47, 68.37, 66.47,
  50.22, 53.89, 50.22, 53.89, 50.22, 53.89, 61.37, 56.73, 61.37, 56.73, 61.37, 56.73,
  53.09, 56.69, 53.09, 56.69, 53.09, 56.69, 75.94, 76.25, 75.94, 76.25, 75.94, 76.25,
  172.24, 168.6, 172.24, 168.6, 172.24, 168.6, 207.79, 213.36, 207.79, 213.36, 207.79, 213.36,
  155.28, 163.24, 155.28, 163.24, 155.28, 163.24, 175.67, 172.27, 175.67, 172.27, 175.67, 172.27,
  197.75, 189.97, 197.75, 189.97, 197.75, 189.97, 138.49, 131.16, 138.49, 131.16, 138.49, 131.16,
  206.11, 204.25, 206.11, 204.25, 206.11, 204.25, 170.78, 166.84, 170.78, 166.84, 170.78, 166.84,
  23, 23, 23, 23, 23, 23, 24, 24, 24, 24, 24, 24,
  29, 29, 29, 29, 29, 29, 16.38, 15.27, 16.38, 15.27, 16.38, 15.27,
  15, 15, 15, 15, 15, 15, 17, 17, 17, 17, 17, 17,
  21.13, 20.27, 21.13, 20.27, 21.13, 20.27, 12, 12, 12, 12, 12, 12,
  37.67, 39.81, 37.67, 39.81, 37.67, 39.81, 39.72, 42.42, 39.72, 42.42, 39.72, 42.42,
  50, 50, 50, 50, 50, 50, 45.11, 45.91, 45.11, 45.91, 45.11, 45.91,
  39.38, 37.31, 39.38, 37.31, 39.38, 37.31, 41, 41, 41, 41, 41, 41,
  24, 24, 24, 24, 24, 24, 48, 48, 48, 48, 48, 48,
  76.73, 78.86, 76.73, 78.86, 76.73, 78.86, 118, 118, 118, 118, 118, 118,
  71.85, 68.63, 71.85, 68.63, 71.85, 68.63, 115.11, 109.47, 115.11, 109.47, 115.11, 109.47,
  101.69, 116.15, 101.69, 116.15, 101.69, 116.15, 110.02, 116.24, 110.02, 116.24, 110.02, 116.24,
  92, 92, 92, 92, 92, 92, 84.28, 91.76, 84.28, 91.76, 84.28, 91.76,
];

/** The classic body id of a zone tile (the same formula as render/buildings.ts zoneModelId). */
export function classicId(zone: number, level: number, variant: number, tier: number): number {
  const form = variant & 7;
  const palBit = (variant >> 3) & 1;
  const t = tier === 1 || tier === 2 ? tier : 0;
  return ((((zone - 1) * 3 + level - 1) * 8 + form) * 3 + t) * 2 + palBit;
}

/** Bounds every body keeps at any style (§6.1, the WP-4 test): L2 ≤ 84, Hab / Market L3 ≥ 128. */
export const HEIGHT_BOUNDS = {
  l1: [12, 36],
  l2: [40, 84],
  fabL3: [70, 120],
  l3Single: [128, 216],
  l3Pair: [150, 260],
  l3Quad: [180, 300],
} as const;

/** Style height multipliers (§6.1 District styles). */
export const STYLE_HEIGHT: Record<DistrictKind, number> = {
  shore: 1,
  shoals: 0.9,
  sunk: 0.85,
  flats: 1,
  terraces: 0.95,
  reedmere: 0.85,
  skeleton: 1.1,
  tarmac: 0.8,
  bazaar: 0.9,
};

/** The band (before style and seed) a kit body's mass is drawn at. */
const BAND = { l1: 24, l2: 62, fabL3: 95, l3Single: 160, l3Pair: 195, l3Quad: 230 } as const;

/** A kit body's spec (§6.1, `kitRecipe(spec)`); `parcel` 0 single, 1 pair, 2 quad; `seed` 0..3. */
export interface KitSpec {
  zone: number;
  level: number;
  tier: number;
  style: DistrictKind;
  form: number;
  parcel: 0 | 1 | 2;
  palBit: number;
  seed: number;
}

/** The formula every kit body's main mass is drawn at: band × style × (0.8 + 0.4 × seed / 3), clamped (§6.1). */
export function kitTop(spec: KitSpec): number {
  const lv = Math.max(1, Math.min(3, spec.level | 0));
  const fab = spec.zone === ZoneType.Industrial;
  const key = lv === 1 ? 'l1' : lv === 2 ? 'l2' : fab ? 'fabL3' : spec.parcel === 2 ? 'l3Quad' : spec.parcel === 1 ? 'l3Pair' : 'l3Single';
  const raw = BAND[key] * (STYLE_HEIGHT[spec.style] ?? 1) * (0.8 + (0.4 * Math.max(0, Math.min(3, spec.seed | 0))) / 3);
  const [lo, hi] = HEIGHT_BOUNDS[key];
  return Math.max(lo, Math.min(hi, raw));
}

/** Stratablock tops by complete stage (today's art, §3.2): 83 / 177 / 232, roof ≈ 160 from stage 2. */
const STACK_TOP = [0, 83, 177, 232] as const;

/**
 * A tile's or building's top in world px (parcel-aware): a building's `height` (the Stratablock's by complete stage),
 * a developed zone tile its body's mass (a parcel member reads its parcel's drawn level), 8 for a lot, 0 otherwise.
 * Step 0b: every zone body is a classic form (CLASSIC_TOPS); WP-4's kit bodies read kitTop through here.
 */
export function heightOf(world: World, x: number, y: number): number {
  const t = world.tileAt(x, y);
  if (!t) return 0;
  if (t.buildingId >= 0) {
    const b = world.buildings.get(t.buildingId);
    if (!b) return 0;
    if (b.type === 'stack') return STACK_TOP[completeStage(b)];
    return BUILDINGS[b.type].height ?? 40;
  }
  if (t.zone === ZoneType.None) return 0;
  if (t.level <= 0) return 8;
  const p = parcelAt(world, x, y);
  const level = p ? p.level : t.level;
  const tier = p ? p.tier : t.wealth;
  return CLASSIC_TOPS[classicId(t.zone, level, t.variant, tier)] ?? 0;
}

/**
 * An anchor's facade top where a skybridge tube attaches (§5.3): a building's `roof` (else 0.85 × its height), the
 * Stratablock's 160 from complete stage 2, a zone anchor's body top.
 */
export function roofOf(world: World, x: number, y: number): number {
  const t = world.tileAt(x, y);
  if (!t) return 0;
  if (t.buildingId >= 0) {
    const b = world.buildings.get(t.buildingId);
    if (!b) return 0;
    if (b.type === 'stack') return completeStage(b) >= 2 ? 160 : STACK_TOP[completeStage(b)];
    const d = BUILDINGS[b.type];
    return d.roof ?? Math.round((d.height ?? 40) * 0.85);
  }
  return heightOf(world, x, y);
}

/** Raised terrace steps (the optional package after Step 9): every layer drawn on a tile offsets by this. 0 until then. */
export function elevOffset(_world: World, _x: number, _y: number): number {
  return 0;
}
