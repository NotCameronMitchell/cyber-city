// ─────────────────────────────────────────────────────────────────────────────
// The modular building kit (docs/MEGACITY.md §6.1 "The kit").
//
// Forms 0..7 are today's 72 hand-built recipes (zones.ts, singles only). Forms
// 8..23 are parametric templates (16 Hab Blocks, 16 Market Strip, 12 Fab Yards)
// with an eligibility matrix over zone × level × parcel shape (S single, P pair,
// Q quad). Forms 24..31 are the district styles' own silhouettes (only in their
// district). Each template has 4 parameter sets (`seed` 0..3: setbacks, roof,
// windows, signage, clutter), drawn with the Painter primitives.
//
// Height truth: a body's main mass reaches exactly `T`, the classic top of the
// tile (heights.ts CLASSIC_TOPS through heightOf), so the skybridge rule, inspect
// floors and the renderer's culling agree with what is drawn whatever form the
// picker chose. Roof clutter (antennas, tanks, cranes) may rise ≤ 16 px above.
//
// Picking (`pickForm`): uniform over every eligible body of the cell, with the
// style's silhouettes taking ≥ 25% of the picks where they are eligible, and no
// identical body within r = 2 by construction: a tile's art coordinates fall in
// one of nine residue classes ((x mod 3) + 3 (y mod 3)), two tiles within r = 2
// are never in the same class, and each class draws from its own disjoint share
// of the cell's bodies.
// ─────────────────────────────────────────────────────────────────────────────

import { hash2 } from '../../game/rng';
import type { DistrictKind } from '../../game/types';
import { NEON, mix, type RGB } from '../palette';
import { GLASS, mat, type Mat, type Painter, type WinSpec } from './painter';
import { arch, crane, hip, lampString, lattice, pole, pyramid } from './parts';
import { STYLES, type StyleDef } from './styles';

/** What a kit body draws from (§6.1 `kitRecipe(spec)`): the cell, the style and the parameter set. */
export interface KitCtx {
  /** Footprint in tiles (1 or 2 each way). */
  W: number;
  H: number;
  /** The main mass top (world px, heights.ts truth). */
  T: number;
  /** Parameter set 0..3. */
  s: number;
  lv: number;
  zone: number;
  tier: number;
  st: StyleDef;
  /** Variant accent (roof trims, signs) or null (Charter Shore). */
  acc: RGB | null;
}

export type KitDraw = (p: Painter, k: KitCtx) => void;

/** A template or a style silhouette. */
export interface Tpl {
  name: string;
  zone: 1 | 2 | 3;
  /** Style silhouettes: every zone it serves (default [zone]). */
  zones?: number[];
  /** Eligible cells: shape letter + level, e.g. 'S1', 'P2', 'Q3'; '*' = every cell ($$$ only, the cleanroom). */
  cells: string[];
  draw: KitDraw;
  /** Only at this wealth tier (the cleanroom block: $$$). */
  tier?: 2;
}

// ── Shared helpers ────────────────────────────────────────────────────────

const CONC = mat([124, 126, 140], undefined, 'wall');
const STEEL = mat([140, 144, 152]);
const RUST = mat([132, 84, 60], undefined, 'rust');
const DARK = mat([64, 64, 76], undefined, 'roof');
const GREEN_ROOF = mat([86, 140, 96], [16, 36, 30], 'roof');
const SOLAR_M = mat([44, 64, 116], [10, 14, 34]);
const LAWN = mat([86, 150, 96], [14, 38, 30]);

const r01 = (p: Painter) => p.rng.next();

/** Style wall i for this body. */
function wl(p: Painter, k: KitCtx, i = 0): Mat {
  const w = k.st.walls;
  return w[(Math.floor(p.seed / 7) + i + k.s) % w.length];
}
function rf(k: KitCtx, i = 0): Mat {
  const r = k.st.roofs;
  return r[(k.s + i) % r.length];
}
function tp(k: KitCtx, i = 0): Mat {
  const t = k.st.tarps;
  return t[(k.s + i) % t.length];
}
/** A window spec for this body: the style's habits, curtain glass for tall shops, slits for fabs. */
function wn(k: KitCtx, i = 0): WinSpec {
  const ws = k.st.wins;
  const w = ws[(k.s + i) % ws.length];
  if (k.zone === 3 && w.style === 'curtain') return { style: 'band', floor: 9, col: 8, w: 1, h: 0.4 };
  return w;
}
/** Trim neon: the district accent, else the palette's. */
const trim = (p: Painter, k: KitCtx, second = false): RGB => k.acc ?? (second ? p.pal.neon2 : p.pal.neon);
/** Sign colour: style signs, else the palette. */
function sc(p: Painter, k: KitCtx, i = 0): RGB {
  if (k.acc && (i + k.s) % 2 === 0) return k.acc;
  const s = k.st.signs;
  return s.length ? s[(i + k.s) % s.length] : i % 2 ? p.pal.neon2 : p.pal.neon;
}
const glassOf = (k: KitCtx): Mat => k.st.glass ?? GLASS;

/** Left (+v) face edge of a box and right (+u) face edge. */
const LF = (u0: number, v0: number, u1: number, v1: number): [number, number, number, number] => [u0, v1, u1, v1];
const RT = (u0: number, v0: number, u1: number, v1: number): [number, number, number, number] => [u1, v0, u1, v1];

/** A main volume. */
function vol(p: Painter, k: KitCtx, u0: number, v0: number, u1: number, v1: number, z0: number, z1: number, m: Mat, win?: WinSpec, trimmed = false, top?: Mat) {
  p.box(u0, v0, u1, v1, z0, z1, m, { win, top: top ?? rf(k), trim: trimmed ? trim(p, k) : undefined, glass: win?.style === 'curtain' ? glassOf(k) : undefined });
}

/** Ground-floor door on the left face. */
function door(p: Painter, u0: number, u1: number, v: number, t: number, lit: RGB | null) {
  p.door(u0, v, u1, v, t, t + 0.16, 0, 5.5, lit);
}

/** Roof clutter on a flat top at z (≤ 16 px), chosen by the style's habits and the parameter set. */
function clutter(p: Painter, k: KitCtx, u0: number, v0: number, u1: number, v1: number, z: number, n = 2) {
  if (p.lod) return;
  const du = u1 - u0;
  const dv = v1 - v0;
  if (du < 0.12 || dv < 0.12) return;
  const kinds = k.st.roofKinds;
  const kind = kinds[(k.s + Math.floor(p.seed / 3)) % kinds.length];
  const cu = (u0 + u1) / 2;
  const cv = (v0 + v1) / 2;
  switch (kind) {
    case 'garden':
      p.greens(u0 + du * 0.1, v0 + dv * 0.1, u1 - du * 0.1, v1 - dv * 0.1, z, 3 + n);
      break;
    case 'helipad':
      if (du > 0.4 && dv > 0.4) p.padMark(cu, cv, Math.min(du, dv) * 0.32, z, trim(p, k));
      else p.ac(u0 + du * 0.3, v0 + dv * 0.3, z);
      break;
    case 'antenna':
      p.antenna(u0 + du * 0.3, v0 + dv * 0.3, z, Math.min(16, 8 + k.lv * 3));
      if (n > 1) p.dish(u1 - du * 0.3, v0 + dv * 0.5, z);
      break;
    case 'tower':
      p.tank(u0 + du * 0.35, v0 + dv * 0.4, z, 0.06, 6);
      break;
    case 'solar':
      p.box(u0 + du * 0.15, v0 + dv * 0.15, u1 - du * 0.15, v1 - dv * 0.15, z, z + 1.2, SOLAR_M, { uplight: false, top: SOLAR_M });
      break;
    case 'tarp':
      p.shed(u0 + du * 0.15, v0 + dv * 0.2, u0 + du * 0.6, v1 - dv * 0.2, z + 4, 2.5, tp(k), 'v');
      p.box(u0 + du * 0.16, v0 + dv * 0.21, u0 + du * 0.59, v1 - dv * 0.21, z, z + 4, wl(p, k, 2), { uplight: false, noTop: true });
      break;
    default:
      p.ac(u0 + du * 0.25, v0 + dv * 0.3, z);
      if (n > 1) p.ac(u0 + du * 0.6, v0 + dv * 0.55, z, 0.06);
      if (n > 2) p.tank(u1 - du * 0.25, v1 - dv * 0.3, z, 0.05, 5);
  }
}

/** Signage on a body's left face (§6.1: none, blade, wall sign, billboard, holo panel; billboards only Market L2+, 0.4). */
function signs(p: Painter, k: KitCtx, u0: number, v0: number, u1: number, v1: number, z0: number, z1: number) {
  const roll = r01(p);
  if (roll > k.st.signRate + (k.zone === 2 ? 0.2 : 0)) return;
  const h = z1 - z0;
  const kind = (k.s + Math.floor(roll * 7)) % 4;
  const [au, av, bu, bv] = LF(u0, v0, u1, v1);
  if (kind === 0 && h > 10) {
    p.blade(u1, v1 - (v1 - v0) * 0.3, 'u', 0.1, z0 + 3, z0 + Math.min(h - 2, 6 + k.lv * 6), sc(p, k, 1));
  } else if (kind === 1 && h > 12) {
    p.wallSign(au, av, bu, bv, 0.2, 0.75, z0 + h * 0.55, z0 + h * 0.55 + Math.min(9, h * 0.25), sc(p, k));
  } else if (kind === 2 && k.zone === 2 && k.lv >= 2 && h > 30 && r01(p) < 0.4) {
    const [ru, rv, su, sv] = RT(u0, v0, u1, v1);
    p.board(ru, rv, su, sv, 0.15, 0.85, z0 + h * 0.45, z0 + h * 0.45 + Math.min(28, h * 0.35), k.s, sc(p, k), sc(p, k, 1));
  } else if (h > 14) {
    p.wallSign(au, av, bu, bv, 0.55, 0.9, z0 + 4, z0 + Math.min(h - 3, 12), sc(p, k, 1), false);
  }
}

/** Vertical neon edge on the front corner of a box. */
function edge(p: Painter, k: KitCtx, u1: number, v1: number, z0: number, z1: number, second = false) {
  p.neon([u1, v1, z0 + 2, u1, v1, z1 - 2], trim(p, k, second), 0.8);
}

/** Balcony ledges on the left face every `every` floors. */
function balc(p: Painter, u0: number, u1: number, v1: number, z0: number, z1: number, step: number, depth = 0.05) {
  for (let z = z0 + step; z < z1 - 3; z += step) p.box(u0 + 0.03, v1, u1 - 0.03, v1 + depth, z - 1, z, CONC, { uplight: false });
}

/** Rising roofs (gable / hip / pyramid / arch / dome / saw) that end exactly at T: the walls stop `rise` below. */
function riseRoof(p: Painter, k: KitCtx, kind: 'gable' | 'hip' | 'pyramid' | 'arch' | 'dome' | 'saw' | 'thatch', u0: number, v0: number, u1: number, v1: number, z: number, rise: number, m: Mat, alongU = true) {
  switch (kind) {
    case 'gable':
      p.gable(u0, v0, u1, v1, z, rise, m, alongU ? 'u' : 'v');
      break;
    case 'thatch':
      p.gable(u0 - 0.03, v0 - 0.03, u1 + 0.03, v1 + 0.03, z, rise, mat([176, 150, 90], [36, 30, 20], 'roof'), alongU ? 'u' : 'v');
      break;
    case 'hip':
      hip(p, u0, v0, u1, v1, z, rise, m);
      break;
    case 'pyramid':
      pyramid(p, u0, v0, u1, v1, z, rise, m);
      break;
    case 'arch':
      arch(p, u0, v0, u1, v1, z, rise, m, alongU ? 'u' : 'v');
      break;
    case 'dome':
      p.box(u0, v0, u1, v1, z - 0.5, z, m, { uplight: false });
      p.dome((u0 + u1) / 2, (v0 + v1) / 2, Math.min(u1 - u0, v1 - v0) * 0.42, z, rise, m);
      break;
    case 'saw':
      p.saw(u0, v0, u1, v1, z, rise, Math.max(2, Math.round((u1 - u0) * 4)), m, p.pal.neon);
      break;
  }
}

/** The style's favourite rising roof for low bodies, if it has one. */
function lowRoof(k: KitCtx): 'gable' | 'hip' | 'pyramid' | 'arch' | 'thatch' | null {
  for (const r of k.st.roofKinds) if (r === 'gable' || r === 'hip' || r === 'pyramid' || r === 'arch' || r === 'thatch') return r;
  return null;
}

/** Setback tiers from z0 to T: returns the boxes drawn (u0,v0,u1,v1,z0,z1). */
function setbacks(p: Painter, k: KitCtx, u0: number, v0: number, u1: number, v1: number, z0: number, T: number, n: number, step: number, m: Mat[], win: WinSpec, tr = true): number[][] {
  const out: number[][] = [];
  const total = T - z0;
  // Tier heights: the base takes the most, each tier above a little less.
  const w = [1, 0.62, 0.42, 0.3].slice(0, n + 1);
  const sum = w.reduce((a, b) => a + b, 0);
  let z = z0;
  for (let i = 0; i <= n; i++) {
    const h = i === n ? T - z : Math.round((total * w[i]) / sum);
    const ins = i * step;
    const b = [u0 + ins, v0 + ins, u1 - ins * 0.6, v1 - ins * 0.6, z, z + h];
    if (b[2] - b[0] < 0.12 || b[3] - b[1] < 0.12) break;
    vol(p, k, b[0], b[1], b[2], b[3], z, z + h, m[i % m.length], win, tr && i === n);
    out.push(b);
    z += h;
  }
  return out;
}

// ════════════════════════════════════════════════════════════════════════════
// HAB BLOCKS (forms 8..23)
// ════════════════════════════════════════════════════════════════════════════

const HAB: Tpl[] = [
  {
    name: 'walk-up with stair and water tank',
    zone: 1,
    cells: ['S1', 'S2'],
    draw: (p, k) => {
      const i = 0.1 + k.s * 0.025;
      const top = k.T - 6;
      vol(p, k, i, i + 0.06, 1 - i - 0.12, 1 - i, 0, top, wl(p, k), wn(k), k.s === 2);
      // External stair tower on the right face.
      p.box(1 - i - 0.12, 0.3, 1 - i, 0.62, 0, top + 2, CONC, { win: { style: 'slit', floor: 7, col: 4, w: 0.35, h: 0.6 }, top: DARK });
      door(p, i, 1 - i - 0.12, 1 - i, 0.3, p.pal.neon2);
      if (k.lv >= 2) balc(p, i, 1 - i - 0.12, 1 - i, 0, top, 7 * (2 + (k.s & 1)));
      p.tank(i + 0.25, i + 0.3, top, 0.07, 6);
      clutter(p, k, i + 0.4, i + 0.1, 1 - i - 0.14, 1 - i - 0.1, top, 1);
      signs(p, k, i, i + 0.06, 1 - i - 0.12, 1 - i, 0, top);
    },
  },
  {
    name: 'row houses with chimneys',
    zone: 1,
    cells: ['P1', 'P2'],
    draw: (p, k) => {
      const alongU = k.W >= k.H;
      const n = 3 + (k.s & 1);
      const len = alongU ? k.W : k.H;
      const rise = Math.min(8, Math.max(4, k.T * 0.18));
      const roofK = lowRoof(k) ?? 'gable';
      for (let j = 0; j < n; j++) {
        const a = 0.06 + (j * (len - 0.12)) / n;
        const b = a + (len - 0.12) / n - 0.02;
        const hz = k.T - rise - (j % 2 === k.s % 2 ? 0 : Math.min(4, k.T * 0.1));
        const m = wl(p, k, j);
        const box = alongU ? [a, 0.18, b, 0.86] : [0.18, a, 0.86, b];
        p.box(box[0], box[1], box[2], box[3], 0, hz, m, { win: wn(k), noTop: true });
        riseRoof(p, k, roofK === 'arch' ? 'gable' : roofK, box[0] - 0.01, box[1] - 0.01, box[2] + 0.01, box[3] + 0.01, hz, k.T - hz, rf(k, j), !alongU);
        if (alongU) door(p, box[0], box[2], box[3], 0.35, j % 2 ? p.pal.neon2 : null);
        else p.door(box[2], box[1], box[2], box[3], 0.35, 0.55, 0, 5.5, null);
        const cu = alongU ? box[0] + 0.08 : box[0] + 0.12;
        const cv = alongU ? box[1] + 0.12 : box[1] + 0.08;
        p.box(cu, cv, cu + 0.06, cv + 0.06, hz, k.T + 4, CONC, { uplight: false });
      }
      if (k.s >= 2) p.laundry(alongU ? 0.3 : 0.92, alongU ? 0.92 : 0.3, alongU ? len - 0.3 : 0.92, alongU ? 0.92 : len - 0.3, 6);
    },
  },
  {
    name: 'capsule cluster',
    zone: 1,
    cells: ['S1', 'S2', 'P2'],
    draw: (p, k) => {
      const core = [k.W * 0.32, k.H * 0.32, k.W * 0.68, k.H * 0.68];
      p.box(core[0], core[1], core[2], core[3], 0, k.T, CONC, { win: { style: 'slit', floor: 8, col: 5, w: 0.4, h: 0.6 }, top: DARK, trim: trim(p, k) });
      const pods = [wl(p, k), wl(p, k, 1), wl(p, k, 2)];
      const ph = 7;
      for (let z = 1; z + ph <= k.T - 2; z += ph + 0.5) {
        for (let j = 0; j < 4; j++) {
          if (hash2(j, Math.round(z), p.seed + k.s) < 0.25) continue;
          const m = pods[(j + Math.round(z)) % 3];
          const win: WinSpec = { style: 'capsule', floor: ph, col: 4.5, w: 0.6, h: 0.5, margin: 1.5 };
          if (j === 0) p.box(core[0] + 0.02, core[3], core[0] + (core[2] - core[0]) * 0.48, core[3] + 0.18, z, z + ph, m, { win, uplight: false });
          if (j === 1) p.box(core[0] + (core[2] - core[0]) * 0.52, core[3], core[2] - 0.02, core[3] + 0.18, z, z + ph, m, { win, uplight: false });
          if (j === 2) p.box(core[2], core[1] + 0.02, core[2] + 0.18, core[1] + (core[3] - core[1]) * 0.48, z, z + ph, m, { win, uplight: false });
          if (j === 3) p.box(core[2], core[1] + (core[3] - core[1]) * 0.52, core[2] + 0.18, core[3] - 0.02, z, z + ph, m, { win, uplight: false });
        }
      }
      p.antenna((core[0] + core[2]) / 2, (core[1] + core[3]) / 2, k.T, 8 + k.s * 2);
      p.neon([core[2] + 0.18, core[3] + 0.18, 2, core[2] + 0.18, core[3] + 0.18, Math.max(4, k.T - 4)], trim(p, k, true), 0.6);
    },
  },
  {
    name: 'courtyard block',
    zone: 1,
    cells: ['Q1', 'Q2'],
    draw: (p, k) => {
      const i = 0.1;
      const d = 0.55 + k.s * 0.05;
      const z = k.T;
      const m = wl(p, k);
      const w = wn(k);
      // Back two wings, the court, then the front two wings (back to front).
      vol(p, k, i, i, 2 - i, i + d, 0, z, m, w);
      vol(p, k, i, i + d, i + d, 2 - i - d, 0, z - (k.s & 1 ? 0 : 4), wl(p, k, 1), w);
      p.box(i + d, i + d, 2 - i - d, 2 - i - d, 0, 0.6, LAWN, { uplight: false, top: LAWN });
      p.greens(i + d + 0.1, i + d + 0.1, 2 - i - d - 0.1, 2 - i - d - 0.1, 0.6, 6);
      vol(p, k, 2 - i - d, i + d, 2 - i, 2 - i, 0, z, m, w, true);
      vol(p, k, i, 2 - i - d, 2 - i - d, 2 - i, 0, z, wl(p, k, 1), w, true);
      // Arched gate in the front wing.
      p.door(i, 2 - i, 2 - i - d, 2 - i, 0.42, 0.58, 0, 7, p.pal.neon2);
      if (k.lv >= 2) balc(p, i, 2 - i - d, 2 - i, 0, z, 14);
      clutter(p, k, 2 - i - d, i + d, 2 - i, 2 - i, z, 2);
      clutter(p, k, i, i, 2 - i, i + d, z, 1);
      signs(p, k, i, 2 - i - d, 2 - i - d, 2 - i, 0, z);
    },
  },
  {
    name: 'slab with balcony bands',
    zone: 1,
    cells: ['S2', 'P2', 'P3'],
    draw: (p, k) => {
      const i = 0.1;
      const alongU = k.W >= k.H;
      const u1 = k.W - i;
      const v1 = k.H - i;
      const thin = 0.34 + k.s * 0.04;
      const box = alongU ? [i, k.H / 2 - thin / 2 - 0.05, u1, k.H / 2 + thin / 2 + 0.05] : [k.W / 2 - thin / 2 - 0.05, i, k.W / 2 + thin / 2 + 0.05, v1];
      if (k.W === 1 && k.H === 1) {
        box[0] = i;
        box[1] = 0.22;
        box[2] = 1 - i;
        box[3] = 0.78;
      }
      vol(p, k, box[0], box[1], box[2], box[3], 0, k.T, wl(p, k), wn(k), true);
      // Continuous balcony bands: every floor or every other.
      const step = k.lv >= 3 ? 6.5 * (1 + (k.s & 1)) : 7 * (1 + (k.s & 1));
      for (let z = step; z < k.T - 3; z += step) {
        p.box(box[0] + 0.02, box[3], box[2] - 0.02, box[3] + 0.07, z - 1.2, z, CONC, { uplight: false });
        if (!p.lod && k.s === 3) p.neon([box[0] + 0.02, box[3] + 0.07, z, box[2] - 0.02, box[3] + 0.07, z], trim(p, k, true), 0.4);
      }
      door(p, box[0], box[2], box[3], 0.45, p.pal.neon2);
      clutter(p, k, box[0], box[1], box[2], box[3], k.T, 3);
      edge(p, k, box[2], box[3], 0, k.T);
    },
  },
  {
    name: 'tenement around a laundry yard',
    zone: 1,
    cells: ['P1', 'Q1', 'Q2'],
    draw: (p, k) => {
      const i = 0.08;
      const quad = k.W === 2 && k.H === 2;
      const m = wl(p, k);
      const w = k.lv >= 2 ? wn(k) : { style: 'grid' as const, floor: 6, col: 7, w: 0.45, h: 0.5, margin: 2 };
      if (quad) {
        vol(p, k, i, i, 2 - i, 0.62, 0, k.T, m, w);
        vol(p, k, i, 0.62, 0.62, 2 - i, 0, k.T - 3, wl(p, k, 1), w);
        p.laundry(0.8, 0.9, 1.7, 1.3, 9);
        p.laundry(0.8, 1.3, 1.7, 1.7, 7);
        vol(p, k, 1.4, 0.62, 2 - i, 2 - i, 0, k.T - 6, wl(p, k, 2), w, true);
      } else {
        const alongU = k.W > k.H;
        const L = alongU ? k.W : k.H;
        if (alongU) {
          vol(p, k, i, i, L - i, 0.45, 0, k.T, m, w);
          p.laundry(0.3, 0.7, L - 0.3, 0.7, 8);
          vol(p, k, L - 0.5, 0.45, L - i, 1 - i, 0, k.T - 4, wl(p, k, 1), w, true);
        } else {
          vol(p, k, i, i, 0.45, L - i, 0, k.T, m, w);
          p.laundry(0.7, 0.3, 0.7, L - 0.3, 8);
          vol(p, k, 0.45, L - 0.5, 1 - i, L - i, 0, k.T - 4, wl(p, k, 1), w, true);
        }
      }
      p.tank(0.3, 0.3, k.T, 0.06, 5);
      clutter(p, k, i, i, 0.6, 0.45, k.T, 1);
      signs(p, k, i, i, k.W - i, k.H - i, 0, Math.min(20, k.T));
    },
  },
  {
    name: 'point tower',
    zone: 1,
    cells: ['S3', 'Q3'],
    draw: (p, k) => {
      const c = (k.W + k.H) / 4;
      const r = k.W === 2 ? 0.55 : 0.33;
      const n = k.s % 3;
      const w = wn(k);
      if (k.W === 2) {
        // A podium under the point tower.
        vol(p, k, 0.08, 0.08, 1.92, 1.92, 0, 18, wl(p, k, 2), { style: 'band', floor: 8, col: 6, w: 1, h: 0.5, margin: 2 }, false);
        p.greens(0.15, 1.5, 1.85, 1.85, 18, 5);
      }
      setbacks(p, k, c - r, c - r, c + r, c + r, k.W === 2 ? 18 : 0, k.T, n, 0.05, [wl(p, k), wl(p, k, 1)], w);
      edge(p, k, c + r, c + r, k.W === 2 ? 18 : 0, k.T * 0.7, true);
      if (k.s === 3) p.antenna(c, c, k.T, 16);
      else clutter(p, k, c - r + 0.1, c - r + 0.1, c + r - 0.1, c + r - 0.1, k.T, 2);
      door(p, c - r, c + r, c + r, 0.4, p.pal.neon2);
    },
  },
  {
    name: 'stepped setback tower',
    zone: 1,
    cells: ['S3', 'P3'],
    draw: (p, k) => {
      const i = 0.1;
      const n = 1 + (k.s % 3);
      const alongU = k.W > k.H;
      const tiers = setbacks(p, k, i, i, k.W - i, k.H - i, 0, k.T, n, alongU || k.H > k.W ? 0.12 : 0.08, [wl(p, k), wl(p, k, 1), wl(p, k, 2)], wn(k));
      // Terrace greens on every setback.
      for (let j = 0; j + 1 < tiers.length; j++) {
        const [u0, v0, u1, v1, , z1] = tiers[j];
        const nx = tiers[j + 1];
        p.greens(nx[2] + 0.01, v0 + 0.05, u1 - 0.03, v1 - 0.05, z1, 2);
        p.greens(u0 + 0.05, nx[3] + 0.01, nx[2], v1 - 0.03, z1, 2);
      }
      const t = tiers[tiers.length - 1];
      if (t) {
        edge(p, k, t[2], t[3], t[4], t[5]);
        clutter(p, k, t[0], t[1], t[2], t[3], k.T, 2);
      }
      door(p, i, k.W - i, k.H - i, 0.3, p.pal.neon2);
    },
  },
  {
    name: 'twin towers on a podium',
    zone: 1,
    cells: ['P3', 'Q3'],
    draw: (p, k) => {
      const pod = 16 + k.s * 3;
      vol(p, k, 0.06, 0.06, k.W - 0.06, k.H - 0.06, 0, pod, wl(p, k, 2), { style: 'band', floor: 8, col: 6, w: 1, h: 0.5, margin: 2 });
      const alongU = k.W >= k.H;
      const r = k.W === 2 && k.H === 2 ? 0.42 : 0.3;
      const a = alongU ? [0.5, k.H / 2] : [k.W / 2, 0.5];
      const b = alongU ? [k.W - 0.5, k.H / 2] : [k.W / 2, k.H - 0.5];
      const ta = k.T - 10 - k.s * 4;
      vol(p, k, a[0] - r, a[1] - r, a[0] + r, a[1] + r, pod, ta, wl(p, k), wn(k), true);
      // A sky bridge between the two at mid-height.
      const zb = pod + (ta - pod) * 0.55;
      if (alongU) p.box(a[0] + r, a[1] - 0.08, b[0] - r, a[1] + 0.08, zb, zb + 6, mat([90, 110, 130]), { trim: trim(p, k, true), uplight: false });
      else p.box(a[0] - 0.08, a[1] + r, a[0] + 0.08, b[1] - r, zb, zb + 6, mat([90, 110, 130]), { trim: trim(p, k, true), uplight: false });
      vol(p, k, b[0] - r, b[1] - r, b[0] + r, b[1] + r, pod, k.T, wl(p, k, 1), wn(k), true);
      edge(p, k, b[0] + r, b[1] + r, pod, k.T);
      clutter(p, k, b[0] - r, b[1] - r, b[0] + r, b[1] + r, k.T, 2);
      p.greens(0.1, k.H - 0.4, k.W - 0.1, k.H - 0.1, pod, 4);
    },
  },
  {
    name: 'pencil tower with a crown',
    zone: 1,
    cells: ['S3'],
    draw: (p, k) => {
      const r = 0.22 + k.s * 0.02;
      const crownH = 10 + k.s * 2;
      p.box(0.2, 0.2, 0.8, 0.8, 0, 8, CONC, { top: DARK });
      vol(p, k, 0.5 - r, 0.5 - r, 0.5 + r, 0.5 + r, 8, k.T - crownH, wl(p, k), wn(k));
      edge(p, k, 0.5 + r, 0.5 + r, 8, k.T - crownH);
      // Crown: a lit drum (s 0, 2) or a stepped cap (s 1, 3).
      if (k.s % 2 === 0) {
        p.cyl(0.5, 0.5, r * 0.95, k.T - crownH, k.T, DARK, rf(k));
        p.neonRing(0.5, 0.5, r * 0.95, k.T - crownH + 3, trim(p, k), 1.1);
        p.neonRing(0.5, 0.5, r * 0.95, k.T - 2, trim(p, k, true), 0.8);
      } else {
        p.box(0.5 - r * 0.8, 0.5 - r * 0.8, 0.5 + r * 0.8, 0.5 + r * 0.8, k.T - crownH, k.T - crownH / 2, DARK, { trim: trim(p, k) });
        p.box(0.5 - r * 0.5, 0.5 - r * 0.5, 0.5 + r * 0.5, 0.5 + r * 0.5, k.T - crownH / 2, k.T, DARK, { trim: trim(p, k, true) });
      }
      p.glow(0.5, 0.5, k.T, trim(p, k), 40, p.glowA() * 0.5);
      pole(p, 0.5, 0.5, k.T, k.T + 14, STEEL);
      p.blinker(0.5, 0.5, k.T + 14, NEON.red, 1.4, 12);
    },
  },
  {
    name: 'stacked terrace villas',
    zone: 1,
    cells: ['P2', 'Q2', 'P3'],
    draw: (p, k) => {
      const floors = Math.max(2, Math.round(k.T / 13));
      const fh = k.T / floors;
      const alongU = k.W >= k.H;
      for (let f = 0; f < floors; f++) {
        const shift = (f % 2 ? 0.1 : 0) * (k.s & 1 ? -1 : 1);
        const ins = 0.06 + f * (0.25 / floors);
        const u0 = ins + (alongU ? shift : 0);
        const v0 = ins + (alongU ? 0 : shift);
        const u1 = k.W - ins * 0.4 + (alongU ? shift : 0) - 0.06;
        const v1 = k.H - ins * 0.4 + (alongU ? 0 : shift) - 0.06;
        const m = wl(p, k, f);
        p.box(Math.max(0.04, u0), Math.max(0.04, v0), Math.min(k.W - 0.04, u1), Math.min(k.H - 0.04, v1), f * fh, (f + 1) * fh, m, {
          win: { style: 'grid', floor: Math.max(5, fh / 2), col: 8, w: 0.6, h: 0.55, margin: 1, lit: 1.2 },
          top: f === floors - 1 ? rf(k) : GREEN_ROOF,
          trim: f === floors - 1 ? trim(p, k) : undefined,
        });
        if (f < floors - 1 && !p.lod) p.greens(Math.min(k.W - 0.3, u1 - 0.25), Math.max(0.06, v0), Math.min(k.W - 0.05, u1), Math.min(k.H - 0.06, v1), (f + 1) * fh, 2);
      }
      clutter(p, k, 0.4, 0.4, k.W - 0.4, k.H - 0.4, k.T, 1);
    },
  },
  {
    name: 'perimeter block with a garden roof',
    zone: 1,
    cells: ['Q1', 'Q2', 'Q3'],
    draw: (p, k) => {
      const i = 0.08;
      const m = wl(p, k);
      const tall = k.lv >= 3;
      const z = tall ? Math.round(k.T * 0.32) : k.T;
      vol(p, k, i, i, 2 - i, 2 - i, 0, z, m, wn(k), !tall, GREEN_ROOF);
      if (!tall) {
        p.greens(0.2, 0.2, 1.8, 1.8, z, 9);
        if (k.s & 1) p.box(0.7, 0.7, 1.3, 1.3, z, z + 4, mat([150, 200, 220], [20, 40, 60]), { uplight: false });
      } else {
        // A garden roof over the block, a tower rising from one corner.
        p.greens(0.2, 0.2, 1.2, 1.8, z, 7);
        const c = k.s & 1 ? [1.0, 0.18, 1.82, 1.0] : [0.18, 1.0, 1.0, 1.82];
        setbacks(p, k, c[0], c[1], c[2], c[3], z, k.T, k.s % 2, 0.08, [wl(p, k, 1), wl(p, k, 2)], wn(k, 1));
        edge(p, k, c[2], c[3], z, k.T);
        clutter(p, k, c[0] + 0.1, c[1] + 0.1, c[2] - 0.2, c[3] - 0.2, k.T, 2);
      }
      door(p, i, 2 - i, 2 - i, 0.42, p.pal.neon2);
      signs(p, k, i, i, 2 - i, 2 - i, 0, Math.min(z, 24));
    },
  },
  {
    name: 'tower cluster on one podium',
    zone: 1,
    cells: ['Q3'],
    draw: (p, k) => {
      const pod = 14 + k.s * 2;
      vol(p, k, 0.05, 0.05, 1.95, 1.95, 0, pod, wl(p, k, 2), { style: 'band', floor: 7, col: 6, w: 1, h: 0.5, margin: 2 });
      const towers: [number, number, number, number][] = [
        [0.5, 0.5, 0.3, 0.78],
        [1.45, 0.55, 0.28, 0.9],
        [0.55, 1.45, 0.28, 0.86],
        [1.4, 1.4, 0.34, 1],
      ];
      for (let j = 0; j < 4; j++) {
        const [cu, cv, r, f] = towers[j];
        const z1 = j === 3 ? k.T : Math.round(pod + (k.T - pod) * (f - 0.1 * ((j + k.s) % 3)));
        const m = wl(p, k, j);
        if (j % 2 === k.s % 2) p.chamfer(cu - r, cv - r, cu + r, cv + r, r * 0.3, pod, z1, m, { win: wn(k, j), top: rf(k), trim: j === 3 ? trim(p, k) : undefined });
        else vol(p, k, cu - r, cv - r, cu + r, cv + r, pod, z1, m, wn(k, j), j === 3);
      }
      edge(p, k, 1.74, 1.74, pod, k.T);
      clutter(p, k, 1.1, 1.1, 1.7, 1.7, k.T, 2);
    },
  },
  {
    name: 'cut-corner tower',
    zone: 1,
    cells: ['S2', 'S3'],
    draw: (p, k) => {
      const i = 0.12 + (k.s & 1) * 0.04;
      const c = 0.16 + k.s * 0.03;
      p.chamfer(i, i, 1 - i, 1 - i, c, 0, k.T, wl(p, k), { win: wn(k), top: rf(k), trim: trim(p, k) });
      // Balcony slots on the cut corners every few floors.
      const step = 7 * (2 + (k.s % 2));
      for (let z = step; z < k.T - 4; z += step) p.chamfer(i - 0.02, i - 0.02, 1 - i + 0.02, 1 - i + 0.02, c, z - 1.2, z, CONC, { uplight: false, noTop: true });
      p.neon([1 - i, 1 - i - c, 3, 1 - i, 1 - i - c, k.T - 3], trim(p, k, true), 0.7);
      clutter(p, k, i + 0.12, i + 0.12, 1 - i - 0.12, 1 - i - 0.12, k.T, 2);
      p.door(i + c, 1 - i, 1 - i - c, 1 - i, 0.3, 0.7, 0, 6, p.pal.neon2);
    },
  },
  {
    name: 'bungalow court',
    zone: 1,
    cells: ['P1', 'Q1'],
    draw: (p, k) => {
      const n = k.W === 2 && k.H === 2 ? 4 : 2;
      const spots: [number, number][] = n === 4 ? [[0.1, 0.1], [1.05, 0.1], [0.1, 1.05], [1.05, 1.05]] : k.W > k.H ? [[0.08, 0.15], [1.08, 0.15]] : [[0.15, 0.08], [0.15, 1.08]];
      p.box(0.04, 0.04, k.W - 0.04, k.H - 0.04, 0, 0.4, LAWN, { uplight: false, top: LAWN });
      const roofK = lowRoof(k) ?? 'hip';
      spots.forEach(([u, v], j) => {
        const s = 0.72 - ((j + k.s) % 2) * 0.1;
        const rise = Math.min(7, k.T * 0.3);
        const hz = k.T - rise;
        p.box(u, v, u + s, v + s, 0.4, hz, wl(p, k, j), { win: { style: 'grid', floor: 6, col: 9, w: 0.55, h: 0.5, margin: 2 }, noTop: true });
        riseRoof(p, k, roofK === 'arch' ? 'hip' : roofK, u - 0.02, v - 0.02, u + s + 0.02, v + s + 0.02, hz, rise, rf(k, j), j % 2 === 0);
        p.door(u, v + s, u + s, v + s, 0.4, 0.62, 0.4, 5, j % 2 ? p.pal.neon2 : null);
      });
      p.greens(0.1, k.H - 0.25, k.W - 0.1, k.H - 0.06, 0.4, 3);
      p.lamp(k.W - 0.1, k.H - 0.1, 6, k.st.lamp, 10);
    },
  },
  {
    name: 'shophouse homes over shutters',
    zone: 1,
    cells: ['S1', 'P1'],
    draw: (p, k) => {
      const alongU = k.W >= k.H;
      const L = alongU ? k.W : k.H;
      const n = Math.round(L * 2);
      for (let j = 0; j < n; j++) {
        const a = 0.06 + (j * (L - 0.12)) / n;
        const b = a + (L - 0.12) / n - 0.015;
        const box = alongU ? [a, 0.12, b, 0.9] : [0.12, a, 0.9, b];
        const hz = j === 0 ? k.T : k.T - ((j + k.s) % 3) * Math.min(3, k.T * 0.08);
        p.box(box[0], box[1], box[2], box[3], 0, 7, CONC, { top: DARK });
        const fv = alongU ? box[3] : box[3];
        if (alongU) p.door(box[0], fv, box[2], fv, 0.12, 0.88, 0, 5.5, j % 2 ? sc(p, k, j) : null);
        else p.door(box[2], box[1], box[2], box[3], 0.12, 0.88, 0, 5.5, j % 2 ? sc(p, k, j) : null);
        p.box(box[0], box[1], box[2], box[3], 7, hz, wl(p, k, j), { win: { style: 'grid', floor: 6.5, col: 6, w: 0.55, h: 0.5, margin: 1.5 }, top: rf(k, j) });
        if (alongU && j % 2 === k.s % 2) p.awning(box[0], fv, box[2], fv, 7, 0.08, sc(p, k, j), true);
      }
      p.blade(alongU ? L * 0.5 : 0.9, alongU ? 0.9 : L * 0.5, alongU ? 'v' : 'u', 0.08, 8, Math.max(10, k.T - 2), sc(p, k, 1));
      clutter(p, k, 0.15, 0.15, alongU ? L - 0.15 : 0.85, alongU ? 0.85 : L - 0.15, k.T - 4, 1);
    },
  },
];

// ════════════════════════════════════════════════════════════════════════════
// MARKET STRIP (forms 8..23)
// ════════════════════════════════════════════════════════════════════════════

const COM: Tpl[] = [
  {
    name: 'stall row under cables',
    zone: 2,
    cells: ['S1', 'P1', 'Q1'],
    draw: (p, k) => {
      const n = Math.max(2, Math.round((k.W + k.H) * 1.2));
      const alongU = k.W >= k.H;
      const L = alongU ? k.W : k.H;
      const D = alongU ? k.H : k.W;
      const rows = D > 1.5 ? 2 : 1;
      for (let r = 0; r < rows; r++)
        for (let j = 0; j < n; j++) {
          const a = 0.08 + (j * (L - 0.16)) / n;
          const b = a + (L - 0.16) / n - 0.04;
          const c0 = 0.15 + r * 1.0;
          const c1 = c0 + 0.55;
          const box = alongU ? [a, c0, b, c1] : [c0, a, c1, b];
          const hz = Math.max(6, k.T - 4 - ((j + r) % 2) * 2);
          p.box(box[0], box[1], box[2], box[3], 0, hz - 2, wl(p, k, j), { uplight: true, top: DARK });
          p.shed(box[0] - 0.03, box[1] - 0.03, box[2] + 0.03, box[3] + 0.03, hz - 2, 2, tp(k, j), alongU ? 'v' : 'u');
          if (alongU) p.door(box[0], box[3], box[2], box[3], 0.1, 0.9, 0, Math.min(5, hz - 3), sc(p, k, j));
          else p.door(box[2], box[1], box[2], box[3], 0.1, 0.9, 0, Math.min(5, hz - 3), sc(p, k, j));
          if (!p.lod) p.crate(alongU ? box[0] + 0.04 : box[2] + 0.02, alongU ? box[3] + 0.02 : box[1] + 0.04, 0);
        }
      // Cables with bulbs over the lane.
      lampString(p, [0.05, 0.05, k.T + 2], [k.W - 0.05, k.H - 0.05, k.T + 2], 6, [sc(p, k), sc(p, k, 1), [255, 220, 150]], 4, 7);
      pole(p, 0.05, 0.05, 0, k.T + 2, STEEL);
      pole(p, k.W - 0.05, k.H - 0.05, 0, k.T + 2, STEEL);
    },
  },
  {
    name: 'corner shop with blade sign',
    zone: 2,
    cells: ['S1', 'S2'],
    draw: (p, k) => {
      const i = 0.12;
      p.box(i, i, 1 - i, 1 - i, 0, 8, CONC, { top: DARK });
      // Glazed corner shopfront on both street faces.
      p.door(i, 1 - i, 1 - i, 1 - i, 0.15, 0.85, 0, 6.5, sc(p, k));
      p.door(1 - i, i, 1 - i, 1 - i, 0.2, 0.8, 0, 6.5, sc(p, k, 1));
      p.awning(i, 1 - i, 1 - i, 1 - i, 7.5, 0.1, sc(p, k), true);
      vol(p, k, i + 0.03, i + 0.03, 1 - i - 0.03, 1 - i - 0.03, 8, k.T, wl(p, k), wn(k), true);
      p.blade(1 - i, 1 - i - 0.08, 'u', 0.13, 6, Math.min(k.T - 1, 8 + k.lv * 10), sc(p, k, 2));
      if (k.lv >= 2) p.wallSign(i, 1 - i, 1 - i, 1 - i, 0.15, 0.8, k.T - 12, k.T - 4, sc(p, k, 1));
      clutter(p, k, i + 0.1, i + 0.1, 1 - i - 0.1, 1 - i - 0.1, k.T, 2);
    },
  },
  {
    name: 'arcade with awnings',
    zone: 2,
    cells: ['P1', 'P2', 'Q1'],
    draw: (p, k) => {
      const i = 0.08;
      const u1 = k.W - i;
      const v1 = k.H - i;
      vol(p, k, i, i, u1, v1, 0, k.T, wl(p, k), k.lv >= 2 ? wn(k) : undefined, true);
      // Arcade: dark arches along both street faces with awnings above.
      const arches = Math.round((u1 - i) * 3);
      for (let j = 0; j < arches; j++) p.door(i, v1, u1, v1, (j + 0.15) / arches, (j + 0.85) / arches, 0, 6, j % 2 ? sc(p, k) : [255, 214, 150]);
      const arches2 = Math.round((v1 - i) * 3);
      for (let j = 0; j < arches2; j++) p.door(u1, i, u1, v1, (j + 0.15) / arches2, (j + 0.85) / arches2, 0, 6, j % 2 ? [255, 214, 150] : sc(p, k, 1));
      p.awning(i, v1, u1, v1, 7, 0.1, sc(p, k), true);
      p.awning(u1, i, u1, v1, 7, 0.1, sc(p, k, 1), true);
      p.neon([i, v1, Math.min(k.T - 2, 12), u1, v1, Math.min(k.T - 2, 12), u1, i, Math.min(k.T - 2, 12)], trim(p, k, true), 0.9);
      if (k.lv >= 2) p.wallSign(i, v1, u1, v1, 0.1, 0.4, k.T - 14, k.T - 4, sc(p, k, 2));
      clutter(p, k, i + 0.1, i + 0.1, u1 - 0.1, v1 - 0.1, k.T, 2);
    },
  },
  {
    name: 'mall box with a glass atrium',
    zone: 2,
    cells: ['P2', 'Q2'],
    draw: (p, k) => {
      const i = 0.06;
      const u1 = k.W - i;
      const v1 = k.H - i;
      const z = k.T - 8;
      vol(p, k, i, i, u1, v1, 0, z, wl(p, k), { style: 'band', floor: 10, col: 8, w: 1, h: 0.35, margin: 3 }, true);
      // Glass atrium: a barrel vault (s even) or a glass pyramid (s odd).
      const g = mat([120, 170, 200], [20, 40, 70]);
      const a = [k.W * 0.25, k.H * 0.25, k.W * 0.75, k.H * 0.75];
      if (k.s % 2 === 0) arch(p, a[0], a[1], a[2], a[3], z, 8, g, k.W >= k.H ? 'u' : 'v');
      else pyramid(p, a[0], a[1], a[2], a[3], z, 8, g);
      p.glow((a[0] + a[2]) / 2, (a[1] + a[3]) / 2, z + 4, trim(p, k), 60, p.glowA() * 0.6);
      p.door(i, v1, u1, v1, 0.4, 0.6, 0, 8, [255, 230, 190]);
      p.wallSign(i, v1, u1, v1, 0.08, 0.36, z - 12, z - 3, sc(p, k));
      p.wallSign(u1, i, u1, v1, 0.6, 0.92, z - 12, z - 3, sc(p, k, 1));
      p.ac(i + 0.15, i + 0.15, z);
      p.ac(u1 - 0.3, i + 0.15, z);
    },
  },
  {
    name: 'office slab',
    zone: 2,
    cells: ['S2', 'P2', 'P3'],
    draw: (p, k) => {
      const i = 0.1;
      const alongU = k.W >= k.H;
      const box = k.W === 1 && k.H === 1 ? [0.15, 0.25, 0.85, 0.75] : alongU ? [i, 0.25, k.W - i, k.H - 0.25] : [0.25, i, k.W - 0.25, k.H - i];
      const w: WinSpec = k.s % 2 ? { style: 'band', floor: 6.5, col: 7, w: 1, h: 0.45 } : { style: 'curtain', floor: 6, col: 6, w: 1, h: 0.82, margin: 1 };
      p.box(box[0] - 0.04, box[1] - 0.04, box[2] + 0.04, box[3] + 0.04, 0, 8, CONC, { top: DARK });
      p.door(box[0], box[3] + 0.04, box[2], box[3] + 0.04, 0.3, 0.7, 0, 7, [220, 240, 255]);
      vol(p, k, box[0], box[1], box[2], box[3], 8, k.T, wl(p, k), w, true);
      // Vertical fins on the long face.
      if (!p.lod && k.s >= 2) {
        const n = Math.round((box[2] - box[0]) * 6);
        for (let j = 1; j < n; j++) {
          const u = box[0] + ((box[2] - box[0]) * j) / n;
          p.box(u - 0.01, box[3], u + 0.01, box[3] + 0.03, 9, k.T - 1, CONC, { uplight: false });
        }
      }
      clutter(p, k, box[0] + 0.05, box[1] + 0.05, box[2] - 0.05, box[3] - 0.05, k.T, 2);
      signs(p, k, box[0], box[1], box[2], box[3], 8, k.T);
    },
  },
  {
    name: 'glass tower with a crown',
    zone: 2,
    cells: ['S3', 'P3'],
    draw: (p, k) => {
      const pair = k.W !== k.H;
      const c = [k.W / 2, k.H / 2];
      const r = pair ? 0.4 : 0.32;
      const crown = 14 + k.s * 3;
      const w: WinSpec = { style: 'curtain', floor: 6, col: 6, w: 1, h: 0.82, margin: 1 };
      p.box(0.08, 0.08, k.W - 0.08, k.H - 0.08, 0, 12, CONC, { win: { style: 'band', floor: 8, col: 6, w: 1, h: 0.5, margin: 2 }, top: DARK, trim: trim(p, k, true) });
      const ru = pair && k.W > k.H ? r * 1.6 : r;
      const rv = pair && k.H > k.W ? r * 1.6 : r;
      p.chamfer(c[0] - ru, c[1] - rv, c[0] + ru, c[1] + rv, 0.08 + k.s * 0.03, 12, k.T - crown, wl(p, k), { win: w, glass: glassOf(k), top: DARK, trim: trim(p, k) });
      // Crown: a tapering glass cap with a lit band.
      p.chamfer(c[0] - ru * 0.75, c[1] - rv * 0.75, c[0] + ru * 0.75, c[1] + rv * 0.75, 0.06, k.T - crown, k.T - crown / 2, DARK, { win: w, glass: glassOf(k), trim: trim(p, k, true) });
      p.chamfer(c[0] - ru * 0.45, c[1] - rv * 0.45, c[0] + ru * 0.45, c[1] + rv * 0.45, 0.04, k.T - crown / 2, k.T, DARK, { trim: trim(p, k) });
      p.glow(c[0], c[1], k.T - crown / 2, trim(p, k), 60, p.glowA() * 0.6);
      pole(p, c[0], c[1], k.T, k.T + 14, STEEL);
      p.blinker(c[0], c[1], k.T + 14, NEON.red, 1.2, 14);
      p.neon([c[0] + ru, c[1] + rv - 0.08, 14, c[0] + ru, c[1] + rv - 0.08, k.T - crown - 2], trim(p, k), 0.8);
    },
  },
  {
    name: 'hotel tower with a vertical sign',
    zone: 2,
    cells: ['S3', 'P3'],
    draw: (p, k) => {
      const i = 0.14;
      const alongU = k.W >= k.H;
      const u1 = k.W - i;
      const v1 = k.H - i;
      const podZ = 14;
      p.box(0.06, 0.06, k.W - 0.06, k.H - 0.06, 0, podZ, CONC, { win: { style: 'band', floor: 7, col: 6, w: 1, h: 0.5 }, top: DARK });
      p.awning(0.06, k.H - 0.06, k.W - 0.06, k.H - 0.06, 7, 0.12, [255, 214, 150], false);
      const slabV = alongU ? [i, 0.3, u1, v1 - 0.1] : [0.3, i, u1 - 0.1, v1];
      vol(p, k, slabV[0], slabV[1], slabV[2], slabV[3], podZ, k.T, wl(p, k), wn(k), true);
      // The tall vertical sign on the front edge.
      const sz0 = podZ + 6;
      const sz1 = Math.min(k.T - 6, sz0 + 40 + k.s * 12);
      p.blade(slabV[2], slabV[3] - 0.12, 'u', 0.16, sz0, sz1, sc(p, k));
      // Rooftop letters frame.
      if (!p.lod) {
        pole(p, slabV[0] + 0.1, slabV[1] + 0.1, k.T, k.T + 8, STEEL);
        pole(p, slabV[2] - 0.1, slabV[1] + 0.1, k.T, k.T + 8, STEEL);
      }
      p.wallSign(slabV[0], slabV[1] + 0.12, slabV[2], slabV[1] + 0.12, 0, 1, k.T + 4, k.T + 12, sc(p, k, 1));
    },
  },
  {
    name: 'podium tower with a holo billboard',
    zone: 2,
    cells: ['P3', 'Q3'],
    draw: (p, k) => {
      const pod = 20 + k.s * 3;
      vol(p, k, 0.05, 0.05, k.W - 0.05, k.H - 0.05, 0, pod, wl(p, k, 1), { style: 'band', floor: 8, col: 6, w: 1, h: 0.5, margin: 2 }, true);
      p.awning(0.05, k.H - 0.05, k.W - 0.05, k.H - 0.05, 8, 0.12, sc(p, k), true);
      const t = k.W === 2 && k.H === 2 ? [0.25, 0.25, 1.35, 1.35] : k.W > k.H ? [0.2, 0.15, 1.2, 0.85] : [0.15, 0.2, 0.85, 1.2];
      vol(p, k, t[0], t[1], t[2], t[3], pod, k.T, wl(p, k), { style: 'curtain', floor: 6, col: 6, w: 1, h: 0.82, margin: 1 }, true);
      // Billboard on the podium roof facing the street.
      const bu = Math.min(k.W - 0.15, t[2] + 0.5);
      p.board(t[2] + 0.05, k.H - 0.2, bu, k.H - 0.2, 0, 1, pod + 2, pod + 26, k.s, sc(p, k), sc(p, k, 1));
      pole(p, t[2] + 0.1, k.H - 0.2, pod, pod + 2, STEEL);
      edge(p, k, t[2], t[3], pod, k.T, true);
      clutter(p, k, t[0], t[1], t[2], t[3], k.T, 2);
    },
  },
  {
    name: 'night-market hall',
    zone: 2,
    cells: ['P1', 'Q1'],
    draw: (p, k) => {
      const i = 0.06;
      const u1 = k.W - i;
      const v1 = k.H - i;
      const rise = Math.min(9, k.T * 0.35);
      const wz = k.T - rise;
      p.box(i, i, u1, v1, 0, wz, wl(p, k), { noTop: true });
      // Open sides lit at night.
      p.door(i, v1, u1, v1, 0.05, 0.95, 0, wz - 2, sc(p, k));
      p.door(u1, i, u1, v1, 0.05, 0.95, 0, wz - 2, sc(p, k, 1));
      const roofK = k.s % 2 ? 'gable' : 'arch';
      riseRoof(p, k, roofK, i - 0.03, i - 0.03, u1 + 0.03, v1 + 0.03, wz, rise, rf(k), k.W >= k.H);
      lampString(p, [i, v1 + 0.1, wz], [u1, v1 + 0.1, wz], 8, [sc(p, k), sc(p, k, 1), [255, 220, 150]], 2, 7);
      p.wallSign(i, v1, u1, v1, 0.3, 0.7, wz - 8, wz - 2, sc(p, k, 2));
    },
  },
  {
    name: 'department store (stepped glass)',
    zone: 2,
    cells: ['S2', 'Q2'],
    draw: (p, k) => {
      const tiers = 3 + (k.s & 1);
      const fh = k.T / tiers;
      for (let j = 0; j < tiers; j++) {
        const ins = 0.06 + j * (k.W === 2 ? 0.16 : 0.07);
        p.box(ins, ins, k.W - ins * 0.5 - 0.04, k.H - ins * 0.5 - 0.04, j * fh, (j + 1) * fh, j % 2 ? wl(p, k) : mat([120, 160, 190], [16, 30, 56]), {
          win: j % 2 ? wn(k) : { style: 'curtain', floor: fh / 2, col: 6, w: 1, h: 0.8, margin: 1 },
          glass: glassOf(k),
          top: rf(k),
          trim: trim(p, k, j % 2 === 1),
        });
      }
      p.door(0.06, k.H - 0.07, k.W - 0.07, k.H - 0.07, 0.4, 0.6, 0, 7, [255, 230, 190]);
      p.wallSign(0.06, k.H - 0.07, k.W - 0.07, k.H - 0.07, 0.08, 0.32, fh * 0.4, fh * 0.9, sc(p, k));
      clutter(p, k, 0.4, 0.4, k.W - 0.4, k.H - 0.4, k.T, 1);
    },
  },
  {
    name: 'twin offices with an atrium',
    zone: 2,
    cells: ['Q3'],
    draw: (p, k) => {
      const ta = k.T - 8 - k.s * 6;
      vol(p, k, 0.1, 0.1, 0.85, 1.9, 0, ta, wl(p, k), { style: 'curtain', floor: 6, col: 6, w: 1, h: 0.82, margin: 1 }, true);
      // Glass atrium between them.
      p.box(0.85, 0.3, 1.15, 1.7, 0, Math.round(ta * 0.45), mat([120, 170, 200], [20, 40, 70]), { win: { style: 'curtain', floor: 8, col: 5, w: 1, h: 0.85, margin: 1 }, glass: glassOf(k), top: mat([150, 190, 210], [24, 44, 70]) });
      vol(p, k, 1.15, 0.1, 1.9, 1.9, 0, k.T, wl(p, k, 1), { style: k.s % 2 ? 'band' : 'curtain', floor: 6, col: 6, w: 1, h: k.s % 2 ? 0.45 : 0.82, margin: 1 }, true);
      edge(p, k, 1.9, 1.9, 2, k.T);
      clutter(p, k, 1.2, 0.2, 1.85, 1.0, k.T, 2);
      p.padMark(0.48, 0.6, 0.22, ta, trim(p, k));
      p.door(0.85, 1.7, 1.15, 1.7, 0.1, 0.9, 0, 9, [220, 240, 255]);
    },
  },
  {
    name: 'split tower with a garden break',
    zone: 2,
    cells: ['S3', 'Q3'],
    draw: (p, k) => {
      const q = k.W === 2;
      const c = q ? 1 : 0.5;
      const r = q ? 0.5 : 0.3;
      const zb = Math.round(k.T * (0.45 + k.s * 0.05));
      if (q) vol(p, k, 0.06, 0.06, 1.94, 1.94, 0, 16, wl(p, k, 1), { style: 'band', floor: 8, col: 6, w: 1, h: 0.5 });
      const z0 = q ? 16 : 0;
      vol(p, k, c - r, c - r, c + r, c + r, z0, zb, wl(p, k), wn(k));
      // Open garden storey: columns, trees and a lit soffit.
      for (const [u, v] of [
        [c - r + 0.04, c + r - 0.04],
        [c + r - 0.04, c + r - 0.04],
        [c + r - 0.04, c - r + 0.04],
      ] as const)
        p.box(u - 0.03, v - 0.03, u + 0.03, v + 0.03, zb, zb + 10, CONC, { uplight: false });
      p.greens(c - r + 0.05, c - r + 0.05, c + r - 0.05, c + r - 0.05, zb, 6);
      p.glow(c, c, zb + 8, [255, 230, 170], 50, p.glowA() * 0.6);
      vol(p, k, c - r, c - r, c + r, c + r, zb + 10, k.T, wl(p, k, 2), wn(k, 1), true);
      edge(p, k, c + r, c + r, zb + 10, k.T, true);
      clutter(p, k, c - r + 0.08, c - r + 0.08, c + r - 0.08, c + r - 0.08, k.T, 2);
    },
  },
  {
    name: 'food-court podium with a roof screen',
    zone: 2,
    cells: ['Q1', 'Q2'],
    draw: (p, k) => {
      const z = k.T - (k.lv >= 2 ? 16 : 8);
      vol(p, k, 0.06, 0.06, 1.94, 1.94, 0, z, wl(p, k), k.lv >= 2 ? { style: 'band', floor: 9, col: 7, w: 1, h: 0.4 } : undefined, true);
      for (let j = 0; j < 6; j++) p.door(0.06, 1.94, 1.94, 1.94, (j + 0.1) / 6, (j + 0.9) / 6, 0, 6, sc(p, k, j));
      for (let j = 0; j < 6; j++) p.awning(0.06 + (j * 1.88) / 6, 1.94, 0.06 + ((j + 0.9) * 1.88) / 6, 1.94, 7, 0.08, sc(p, k, j), false);
      // The roof screen on a frame (a holo board), tables on the roof.
      const sh = k.T - z;
      pole(p, 0.4, 0.5, z, k.T, STEEL);
      pole(p, 1.5, 0.5, z, k.T, STEEL);
      p.board(0.35, 0.5, 1.55, 0.5, 0, 1, z + 2, z + sh, k.s, sc(p, k), sc(p, k, 1));
      if (!p.lod) for (let j = 0; j < 4; j++) p.box(0.4 + j * 0.35, 1.2, 0.5 + j * 0.35, 1.3, z, z + 2, wl(p, k, 2), { uplight: false });
    },
  },
  {
    name: 'conference drum with a ring sign',
    zone: 2,
    cells: ['P2', 'Q3'],
    draw: (p, k) => {
      const q = k.W === 2 && k.H === 2;
      const cu = k.W / 2;
      const cv = k.H / 2;
      const r = q ? 0.78 : 0.48;
      const pod = q ? 10 : 0;
      if (q) p.box(0.05, 0.05, 1.95, 1.95, 0, pod, CONC, { top: DARK, trim: trim(p, k, true) });
      p.cyl(cu, cv, r, pod, k.T - 4, wl(p, k), rf(k));
      p.cylBands(cu, cv, r, pod, k.T - 4, 7);
      p.cyl(cu, cv, r * 0.7, k.T - 4, k.T, DARK, rf(k));
      p.neonRing(cu, cv, r * 1.03, pod + (k.T - pod) * 0.62, trim(p, k), 1.4);
      p.neonRing(cu, cv, r * 1.03, k.T - 6, trim(p, k, true), 0.9);
      p.glow(cu, cv, k.T, trim(p, k), 70, p.glowA() * 0.4);
      if (!q) {
        // A side block for the pair.
        const side = k.W > k.H ? [k.W - 0.45, 0.1, k.W - 0.05, 0.9] : [0.1, k.H - 0.45, 0.9, k.H - 0.05];
        vol(p, k, side[0], side[1], side[2], side[3], 0, Math.round(k.T * 0.5), wl(p, k, 1), wn(k), true);
      }
    },
  },
  {
    name: 'kiosk cluster',
    zone: 2,
    cells: ['S1', 'P1'],
    draw: (p, k) => {
      const spots = k.W === 1 && k.H === 1 ? 4 : 7;
      for (let j = 0; j < spots; j++) {
        const u = 0.12 + hash2(j, 1, p.seed) * (k.W - 0.42);
        const v = 0.12 + hash2(j, 2, p.seed) * (k.H - 0.42);
        const s = 0.18 + hash2(j, 3, p.seed) * 0.1;
        const h = Math.max(5, k.T - 3 - hash2(j, 4, p.seed) * 6);
        const roofKs = ['dome', 'pyramid'] as const;
        if (j % 3 === 2 && !p.lod) {
          p.cyl(u + s / 2, v + s / 2, s * 0.5, 0, h - 2, wl(p, k, j), rf(k, j));
          p.dome(u + s / 2, v + s / 2, s * 0.5, h - 2, 3, rf(k, j));
        } else {
          p.box(u, v, u + s, v + s, 0, h - 3, wl(p, k, j), { top: rf(k, j) });
          riseRoof(p, k, roofKs[j % 2], u - 0.02, v - 0.02, u + s + 0.02, v + s + 0.02, h - 3, 3, tp(k, j));
        }
        p.door(u, v + s, u + s, v + s, 0.15, 0.85, 0, Math.min(4, h - 4), sc(p, k, j));
      }
      p.blade(k.W - 0.12, k.H - 0.3, 'u', 0.1, 3, Math.max(8, k.T), sc(p, k, 1));
    },
  },
  {
    name: 'tech campus around a lawn',
    zone: 2,
    cells: ['Q2'],
    draw: (p, k) => {
      p.box(0.04, 0.04, 1.96, 1.96, 0, 0.5, LAWN, { uplight: false, top: LAWN });
      const w: WinSpec = { style: 'curtain', floor: 7, col: 7, w: 1, h: 0.8, margin: 1 };
      // An L of glass pavilions and a ring walk round the lawn.
      vol(p, k, 0.1, 0.1, 1.9, 0.6, 0.5, k.T, wl(p, k), w, true);
      vol(p, k, 0.1, 0.6, 0.6, 1.9, 0.5, k.T - 8 - k.s * 3, wl(p, k, 1), w, true);
      p.ring(1.25, 1.25, 0.45, 1, mat([200, 200, 210]), 1.2);
      p.greens(0.8, 0.8, 1.8, 1.8, 0.5, 6);
      p.cyl(1.55, 1.55, 0.16, 0.5, 10, mat([200, 210, 220], [30, 40, 56]), DARK);
      p.neonRing(1.55, 1.55, 0.16, 9, trim(p, k), 0.8, true);
      const zs = k.T - 8 - k.s * 3;
      p.box(0.18, 0.8, 0.52, 1.8, zs, zs + 1, SOLAR_M, { uplight: false, top: SOLAR_M });
    },
  },
];

// ════════════════════════════════════════════════════════════════════════════
// FAB YARDS (forms 8..19)
// ════════════════════════════════════════════════════════════════════════════

const IND: Tpl[] = [
  {
    name: 'shed with roller doors',
    zone: 3,
    cells: ['S1', 'P1', 'Q1'],
    draw: (p, k) => {
      const i = 0.08;
      const u1 = k.W - i;
      const v1 = k.H - i;
      const rise = Math.min(6, k.T * 0.25);
      const wz = k.T - rise;
      const m = wl(p, k);
      p.box(i, i, u1, v1, 0, wz, m, { noTop: true });
      p.ribs(i, v1, u1, v1, 0, wz, Math.round((u1 - i) * 18), m);
      const doors = Math.max(1, Math.round((u1 - i) * 2));
      for (let j = 0; j < doors; j++) p.door(i, v1, u1, v1, (j + 0.2) / doors, (j + 0.75) / doors, 0, Math.min(wz - 2, 9), j === k.s % doors ? [255, 200, 120] : null);
      const roofK = k.st.roofKinds.includes('arch') ? 'arch' : k.s % 2 ? 'gable' : 'saw';
      riseRoof(p, k, roofK, i - 0.02, i - 0.02, u1 + 0.02, v1 + 0.02, wz, rise, rf(k), k.W >= k.H);
      p.lamp(u1, v1 - 0.1, Math.min(wz - 1, 8), [255, 190, 110], 10);
      if (!p.lod) p.container(u1 - 0.32, v1 + 0.02, u1 - 0.02, v1 + 0.14, 0, 4, [150, 70, 58]);
    },
  },
  {
    name: 'container yard',
    zone: 3,
    cells: ['S1', 'P1', 'Q1'],
    draw: (p, k) => {
      const cols: RGB[] = [
        [150, 70, 58],
        [56, 110, 116],
        [62, 82, 136],
        [166, 128, 60],
        [96, 120, 70],
      ];
      const ch = Math.max(4, Math.min(8, k.T / 3));
      const layers = Math.max(1, Math.min(4, Math.round(k.T / ch)));
      const rows = Math.round(k.H * 2);
      for (let r = 0; r < rows; r++)
        for (let L = 0; L < layers; L++) {
          const v0 = 0.12 + (r * (k.H - 0.24)) / rows;
          const v1 = v0 + (k.H - 0.24) / rows - 0.06;
          const n = Math.max(1, Math.round(k.W * 2) - (L > 0 && hash2(r, L, p.seed) < 0.4 ? 1 : 0));
          for (let j = 0; j < n; j++) {
            if (L > 0 && hash2(r * 7 + j, L, p.seed + 3) < 0.25) continue;
            const u0 = 0.1 + (j * (k.W - 0.2)) / Math.max(1, Math.round(k.W * 2));
            const u1 = u0 + (k.W - 0.2) / Math.max(1, Math.round(k.W * 2)) - 0.04;
            p.container(u0, v0, u1, v1, L * ch, ch - 0.3, cols[Math.floor(hash2(r * 13 + j, L * 5 + k.s, p.seed) * cols.length)]);
          }
        }
      // A gantry crane over the stacks.
      crane(p, 0.06, 0.06, 0, Math.max(k.T, layers * ch) + 6, k.W - 0.2, mat([236, 196, 60]));
    },
  },
  {
    name: 'sawtooth hall',
    zone: 3,
    cells: ['S2', 'P2', 'Q1', 'Q2'],
    draw: (p, k) => {
      const i = 0.06;
      const u1 = k.W - i;
      const v1 = k.H - i;
      const rise = Math.min(9, 5 + k.lv * 1.5);
      const wz = k.T - rise;
      const m = wl(p, k);
      p.box(i, i, u1, v1, 0, wz, m, { win: { style: 'band', floor: 9, col: 8, w: 1, h: 0.35 }, noTop: true });
      p.saw(i, i, u1, v1, wz, rise, Math.round((u1 - i) * (3 + (k.s & 1))), rf(k), p.pal.neon);
      p.door(i, v1, u1, v1, 0.1, 0.3, 0, Math.min(10, wz - 2), [255, 200, 120]);
      p.door(u1, i, u1, v1, 0.6, 0.85, 0, Math.min(10, wz - 2), null);
      if (k.s >= 2) p.stack(u1 - 0.25, i + 0.25, 0.07, 0, Math.min(k.T + 12, wz + rise + 14));
      p.wallSign(i, v1, u1, v1, 0.55, 0.9, wz - 8, wz - 2, sc(p, k), true);
    },
  },
  {
    name: 'tank farm',
    zone: 3,
    cells: ['S2', 'P2', 'Q2'],
    draw: (p, k) => {
      const m = mat([196, 196, 190], [40, 40, 50]);
      const n = Math.max(2, Math.round(k.W * k.H * 2));
      const spots: [number, number, number][] = [];
      for (let j = 0; j < n; j++) {
        const gu = j % Math.round(k.W * 2);
        const gv = Math.floor(j / Math.round(k.W * 2));
        spots.push([0.27 + gu * 0.48, 0.27 + gv * 0.48, 0.2 + (j % 2) * 0.03]);
      }
      p.box(0.04, 0.04, k.W - 0.04, k.H - 0.04, 0, 1, mat([96, 96, 100]), { uplight: false });
      for (const [u, v, r] of spots) {
        if (u + r > k.W - 0.02 || v + r > k.H - 0.02) continue;
        const h = k.T - (hash2(Math.round(u * 10), Math.round(v * 10), p.seed) < 0.5 ? 0 : Math.min(8, k.T * 0.2));
        p.cyl(u, v, r, 1, h, m, mat([170, 170, 166], [34, 34, 42]));
        if (!p.lod) p.neonRing(u, v, r, h * 0.5, k.acc ?? NEON.amber, 0.6);
      }
      p.pipe(0.1, k.H - 0.1, 3, k.W - 0.1, k.H - 0.1, 3, 1.8, STEEL);
      p.pipe(k.W - 0.1, 0.1, 3, k.W - 0.1, k.H - 0.1, 3, 1.8, STEEL);
      p.blinker(spots[0][0], spots[0][1], k.T + 1, NEON.red, 2, 10);
    },
  },
  {
    name: 'silo cluster',
    zone: 3,
    cells: ['S2', 'S3', 'P3'],
    draw: (p, k) => {
      const alongU = k.W >= k.H;
      const n = k.W === 1 && k.H === 1 ? 3 : 5;
      const m = wl(p, k, 1);
      for (let j = 0; j < n; j++) {
        const t = (j + 0.5) / n;
        const u = alongU ? 0.12 + t * (k.W - 0.24) : 0.32 + (j % 2) * 0.32;
        const v = alongU ? 0.32 + (j % 2) * 0.32 : 0.12 + t * (k.H - 0.24);
        const r = 0.17;
        const h = k.T - (j % 2 ? 0 : Math.min(10, k.T * 0.12));
        p.cyl(u, v, r, 0, h - 4, m, rf(k));
        p.dome(u, v, r, h - 4, 4, rf(k));
      }
      // Elevator head house on top.
      const hu = alongU ? k.W * 0.5 : 0.48;
      const hv = alongU ? 0.48 : k.H * 0.5;
      p.box(hu - 0.12, hv - 0.12, hu + 0.12, hv + 0.12, k.T - 12, k.T, wl(p, k), { win: { style: 'slit', floor: 6, col: 4, w: 0.4, h: 0.6 }, top: DARK, trim: trim(p, k) });
      p.pipe(hu, hv, k.T - 6, alongU ? k.W - 0.05 : hu, alongU ? hv : k.H - 0.05, 4, 1.4, STEEL);
    },
  },
  {
    name: 'stack hall with chimneys',
    zone: 3,
    cells: ['S3', 'P3', 'Q3'],
    draw: (p, k) => {
      const i = 0.08;
      const u1 = k.W - i;
      const v1 = k.H - i;
      const hz = Math.round(k.T * 0.42);
      vol(p, k, i, i, u1, v1, 0, hz, wl(p, k), { style: 'slit', floor: 10, col: 8, w: 0.3, h: 0.55 }, true);
      p.saw(i, i, u1, v1 * 0.6, hz, 6, Math.round((u1 - i) * 3), rf(k), NEON.amber);
      const n = 2 + (k.s % 2) + (k.W === 2 && k.H === 2 ? 1 : 0);
      for (let j = 0; j < n; j++) {
        const u = i + 0.2 + ((u1 - i - 0.4) * (j + 0.5)) / n;
        const v = v1 - 0.25 - (j % 2) * 0.2;
        p.stack(u, v, 0.08 + (j % 2) * 0.02, hz, k.T - hz - (j % 2) * 6);
      }
      p.door(i, v1, u1, v1, 0.1, 0.3, 0, 10, [255, 170, 80]);
      p.wallSign(i, v1, u1, v1, 0.4, 0.9, hz - 10, hz - 3, sc(p, k), true);
    },
  },
  {
    name: 'crane warehouse',
    zone: 3,
    cells: ['P2', 'Q2', 'Q3'],
    draw: (p, k) => {
      const i = 0.06;
      const u1 = k.W - i;
      const v1 = k.H - i;
      const tall = k.lv >= 3;
      const hz = tall ? Math.round(k.T * 0.6) : k.T - 6;
      const m = wl(p, k);
      p.box(i, i, u1, v1, 0, hz, m, { win: { style: 'band', floor: 10, col: 8, w: 1, h: 0.3 }, top: rf(k), trim: trim(p, k) });
      p.ribs(i, v1, u1, v1, 0, hz, Math.round((u1 - i) * 14), m);
      for (let j = 0; j < 3; j++) p.door(i, v1, u1, v1, (j + 0.15) / 3, (j + 0.7) / 3, 0, 10, j === 1 ? [255, 190, 110] : null);
      // Gantry crane across the roof (portal legs), reaching T.
      const ch = tall ? k.T - hz : 6;
      const top = hz + ch;
      p.box(i + 0.1, i + 0.1, i + 0.18, i + 0.18, hz, top, mat([236, 196, 60]), { uplight: false });
      p.box(u1 - 0.18, i + 0.1, u1 - 0.1, i + 0.18, hz, top, mat([236, 196, 60]), { uplight: false });
      p.box(i + 0.1, i + 0.1, u1 - 0.1, i + 0.22, top - 3, top, mat([236, 196, 60]), { uplight: false });
      p.box(k.W * 0.55, i + 0.1, k.W * 0.55 + 0.12, i + 0.3, top - 6, top - 3, mat([60, 60, 70]), { uplight: false });
      p.blinker(i + 0.14, i + 0.14, top + 1, NEON.red, 1.8, 10);
    },
  },
  {
    name: 'drone hangar',
    zone: 3,
    cells: ['P1', 'P2', 'Q1', 'Q2'],
    draw: (p, k) => {
      const i = 0.06;
      const u1 = k.W - i;
      const v1 = k.H - i;
      const rise = Math.min(k.T * 0.55, 16);
      const wz = k.T - rise;
      const alongU = k.W >= k.H;
      p.box(i, i, u1, v1, 0, wz, wl(p, k), { noTop: true });
      arch(p, i - 0.02, i - 0.02, u1 + 0.02, v1 + 0.02, wz, rise, rf(k), alongU ? 'u' : 'v');
      // Wide lit bay door at the open end.
      if (alongU) p.door(u1 + 0.02, i, u1 + 0.02, v1, 0.12, 0.88, 0, wz + rise * 0.6, [150, 220, 255]);
      else p.door(i, v1 + 0.02, u1, v1 + 0.02, 0.12, 0.88, 0, wz + rise * 0.6, [150, 220, 255]);
      p.padMark(alongU ? u1 + 0.0 : k.W * 0.5, alongU ? k.H * 0.5 : v1, 0.18, 0.3, trim(p, k));
      const [dx, dy] = p.pt(k.W * 0.6, k.H * 0.6, k.T + 10);
      p.addFx({ k: 'drone', x: dx, y: dy, r: 10, ph: p.rng.next() });
      p.track(dx - 14, dy - 12);
    },
  },
  {
    name: 'vat farm with gantries',
    zone: 3,
    cells: ['S3', 'P3', 'Q3'],
    draw: (p, k) => {
      const vat = mat([160, 170, 160], [30, 40, 40]);
      const n = Math.max(2, Math.round(k.W * k.H * 2));
      const per = Math.round(k.W * 2);
      for (let j = 0; j < n; j++) {
        const u = 0.27 + (j % per) * 0.48;
        const v = 0.27 + Math.floor(j / per) * 0.48;
        if (u > k.W - 0.2 || v > k.H - 0.2) continue;
        const h = k.T - 14 - (j % 3) * 6;
        p.cyl(u, v, 0.19, 0, h, vat, DARK);
        p.neonRing(u, v, 0.19, h - 6, trim(p, k), 0.9);
        p.glow(u, v, h, k.acc ?? [140, 255, 120], 24, p.glowA() * 0.6);
      }
      // Gantry walkway on top, lattice tower to T.
      lattice(p, 0.08, 0.08, 0.3, 0.3, 0, k.T, STEEL, 9);
      p.box(0.1, 0.1, k.W - 0.1, 0.2, k.T - 14, k.T - 12, STEEL, { uplight: false });
      p.box(0.1, 0.1, 0.2, k.H - 0.1, k.T - 14, k.T - 12, STEEL, { uplight: false });
      p.blinker(0.19, 0.19, k.T + 1, NEON.red, 1.6, 12);
    },
  },
  {
    name: 'conveyor works',
    zone: 3,
    cells: ['P3', 'Q3'],
    draw: (p, k) => {
      const alongU = k.W >= k.H;
      const a = alongU ? [0.08, 0.15, 0.85, 0.85] : [0.15, 0.08, 0.85, 0.85];
      const b = alongU ? [1.15, 0.15, k.W - 0.08, k.H - 0.1] : [0.15, 1.15, k.W - 0.1, k.H - 0.08];
      const ha = Math.round(k.T * 0.62);
      vol(p, k, a[0], a[1], a[2], a[3], 0, ha, wl(p, k), { style: 'slit', floor: 10, col: 8, w: 0.3, h: 0.55 }, true);
      // Inclined conveyor bridge between the halls.
      p.pipe(alongU ? a[2] : (a[0] + a[2]) / 2, alongU ? (a[1] + a[3]) / 2 : a[3], ha - 6, alongU ? b[0] : (b[0] + b[2]) / 2, alongU ? (b[1] + b[3]) / 2 : b[1], k.T - 10, 4, mat([150, 140, 120]));
      vol(p, k, b[0], b[1], b[2], b[3], 0, k.T, wl(p, k, 1), { style: 'band', floor: 10, col: 8, w: 1, h: 0.3 }, true);
      p.stack(b[2] - 0.2, b[1] + 0.2, 0.07, k.T, 14);
      p.wallSign(b[0], b[3], b[2], b[3], 0.15, 0.6, k.T - 16, k.T - 6, sc(p, k), true);
    },
  },
  {
    name: 'print shop with roof vents',
    zone: 3,
    cells: ['S1', 'S2', 'P1'],
    draw: (p, k) => {
      const i = 0.1;
      const u1 = k.W - i;
      const v1 = k.H - i;
      vol(p, k, i, i, u1, v1, 0, k.T - 4, wl(p, k), { style: 'grid', floor: 8, col: 9, w: 0.6, h: 0.45 }, true);
      // Rows of mushroom vents and a skylight strip.
      const n = Math.max(3, Math.round((u1 - i) * 5));
      for (let j = 0; j < n; j++) {
        const u = i + 0.08 + ((u1 - i - 0.16) * j) / Math.max(1, n - 1);
        p.cyl(u, i + 0.25, 0.04, k.T - 4, k.T, STEEL, DARK);
        if (k.H > 1.5 || j % 2) p.cyl(u, v1 - 0.25, 0.04, k.T - 4, k.T, STEEL, DARK);
      }
      p.box(i + 0.1, (i + v1) / 2 - 0.06, u1 - 0.1, (i + v1) / 2 + 0.06, k.T - 4, k.T - 3, mat([150, 190, 210], [40, 60, 90]), { uplight: false });
      p.door(i, v1, u1, v1, 0.2, 0.55, 0, 7, [255, 200, 140]);
      p.wallSign(i, v1, u1, v1, 0.6, 0.92, 3, Math.min(k.T - 6, 12), sc(p, k), true);
    },
  },
  {
    name: 'cleanroom block',
    zone: 3,
    cells: ['*'],
    tier: 2,
    draw: (p, k) => {
      const i = 0.08;
      const u1 = k.W - i;
      const v1 = k.H - i;
      const white = mat([226, 230, 234], [44, 48, 62], 'wall');
      p.box(i, i, u1, v1, 0, k.T - 3, white, { win: { style: 'band', floor: 8, col: 8, w: 1, h: 0.3 }, glass: { day: [120, 170, 182], night: [10, 26, 34] }, top: mat([206, 210, 216], [38, 42, 56]), trim: [70, 245, 200] });
      p.box(i + 0.15, i + 0.15, u1 - 0.15, v1 - 0.15, k.T - 3, k.T, mat([196, 200, 206], [34, 38, 52]), { uplight: false });
      for (let j = 0; j < 3; j++) p.cyl(i + 0.25 + j * ((u1 - i - 0.5) / 2), i + 0.3, 0.05, k.T, k.T + 6, white, mat([200, 204, 210]));
      p.neon([i, v1, 4, u1, v1, 4, u1, i, 4], [70, 245, 200], 1);
      p.door(i, v1, u1, v1, 0.4, 0.6, 0, 7, [200, 255, 240]);
    },
  },
];

export const HAB_TEMPLATES = HAB;
export const COM_TEMPLATES = COM;
export const IND_TEMPLATES = IND;
/** Templates by zone (forms 8.. in order). */
export const TEMPLATES: Tpl[][] = [HAB, COM, IND];

// ════════════════════════════════════════════════════════════════════════════
// STYLE SILHOUETTES (forms 24..31; only in their district)
// ════════════════════════════════════════════════════════════════════════════

const PILE = mat([96, 80, 62], [20, 16, 16]);
const DECK = mat([150, 124, 92], [30, 24, 22]);
const ROPE = mat([200, 180, 140], [40, 36, 30]);

/** Stilts under a raised floor at z on the footprint corners and edges. */
function stilts(p: Painter, u0: number, v0: number, u1: number, v1: number, z: number) {
  const n = Math.max(2, Math.round((u1 - u0) * 3));
  for (let j = 0; j <= n; j++) {
    const u = u0 + ((u1 - u0) * j) / n;
    p.box(u - 0.02, v1 - 0.04, u + 0.02, v1, 0, z, PILE, { uplight: false });
  }
  const m = Math.max(2, Math.round((v1 - v0) * 3));
  for (let j = 0; j < m; j++) {
    const v = v0 + ((v1 - v0) * j) / m;
    p.box(u1 - 0.04, v - 0.02, u1, v + 0.02, 0, z, PILE, { uplight: false });
  }
}

/** Boardwalk deck with a rope rail along the front edges. */
function boardwalk(p: Painter, u0: number, v0: number, u1: number, v1: number, z: number) {
  p.box(u0, v0, u1, v1, z - 1, z, DECK, { uplight: false });
  if (p.g && !p.lod) {
    p.begin_();
    p.m(u0, v1, z + 2.5);
    p.l(u1, v1, z + 2.5);
    p.l(u1, v0, z + 2.5);
    p.stroke(p.col(ROPE, 0.9), 0.5);
  }
}

const SIL: Partial<Record<DistrictKind, Tpl[]>> = {
  shoals: [
    {
      name: 'stilt houses',
      zone: 1,
      zones: [1, 2],
      cells: ['S1', 'S2', 'P1', 'P2'],
      draw: (p, k) => {
        const zf = 5;
        stilts(p, 0.1, 0.1, k.W - 0.1, k.H - 0.1, zf);
        boardwalk(p, 0.06, 0.06, k.W - 0.06, k.H - 0.06, zf);
        const n = k.W * k.H > 1 ? 2 : 1;
        for (let j = 0; j < n; j++) {
          const box = k.W >= k.H ? [0.15 + j, 0.15, 0.85 + j, 0.75] : [0.15, 0.15 + j, 0.75, 0.85 + j];
          const top = k.T - (k.lv >= 2 ? 0 : 5);
          p.box(box[0], box[1], box[2], box[3], zf, top, wl(p, k, j), { win: wn(k), top: rf(k), trim: trim(p, k) });
          if (k.lv < 2) pyramid(p, box[0] - 0.02, box[1] - 0.02, box[2] + 0.02, box[3] + 0.02, top, k.T - top, rf(k, 1));
          else if (k.s % 2) p.dome((box[0] + box[2]) / 2, (box[1] + box[3]) / 2, 0.2, k.T, 6, rf(k, 1));
          p.door(box[0], box[3], box[2], box[3], 0.35, 0.55, zf, zf + 5, null);
          if (!p.lod) pole(p, box[2] - 0.05, box[1] + 0.05, k.T, k.T + 9, STEEL);
          if (!p.lod) p.neon([box[2] - 0.05, box[1] + 0.05, k.T + 9, box[2] - 0.25, box[1] + 0.05, k.T + 4], [236, 236, 246], 0.6);
        }
      },
    },
    {
      name: 'boardwalk terraces',
      zone: 1,
      cells: ['P2', 'Q2', 'P3', 'Q3'],
      draw: (p, k) => {
        boardwalk(p, 0.04, 0.04, k.W - 0.04, k.H - 0.04, 2);
        const floors = Math.max(3, Math.round(k.T / 14));
        const fh = (k.T - 2) / floors;
        for (let f = 0; f < floors; f++) {
          const ins = 0.08 + f * Math.min(0.12, 0.7 / floors);
          const u1 = k.W - 0.08;
          const v1 = k.H - ins;
          p.box(ins, 0.08, u1 - f * 0.03, v1, 2 + f * fh, 2 + (f + 1) * fh, wl(p, k, f), { win: { style: 'band', floor: fh, col: 7, w: 1, h: 0.4, margin: 1.5 }, top: rf(k), trim: f === floors - 1 ? trim(p, k) : undefined });
          if (f < floors - 1 && !p.lod) p.box(ins, v1 - 0.01, u1 - f * 0.03, v1 + 0.08, 2 + (f + 1) * fh - 1, 2 + (f + 1) * fh, mat([236, 236, 240], [44, 46, 60]), { uplight: false });
        }
        p.greens(0.2, k.H - 0.3, k.W - 0.2, k.H - 0.08, 2, 3);
      },
    },
    {
      name: 'ferry-pier hall',
      zone: 2,
      zones: [2, 1],
      cells: ['P1', 'Q1', 'P2', 'Q2'],
      draw: (p, k) => {
        stilts(p, 0.06, 0.06, k.W - 0.06, k.H - 0.06, 4);
        boardwalk(p, 0.04, 0.04, k.W - 0.04, k.H - 0.04, 4);
        const rise = Math.min(10, k.T * 0.35);
        const wz = k.T - rise;
        p.box(0.15, 0.15, k.W - 0.15, k.H - 0.15, 4, wz, wl(p, k), { win: { style: 'band', floor: 7, col: 7, w: 1, h: 0.5 }, noTop: true });
        p.gable(0.1, 0.1, k.W - 0.1, k.H - 0.1, wz, rise, rf(k), k.W >= k.H ? 'u' : 'v');
        p.door(0.15, k.H - 0.15, k.W - 0.15, k.H - 0.15, 0.35, 0.65, 4, Math.min(wz, 12), [255, 230, 190]);
        p.wallSign(0.15, k.H - 0.15, k.W - 0.15, k.H - 0.15, 0.05, 0.3, wz - 7, wz - 2, sc(p, k));
        p.lamp(k.W - 0.06, k.H - 0.06, 8, [220, 240, 255], 12);
        flagPole(p, k.W - 0.1, 0.2, wz, sc(p, k, 1));
      },
    },
  ],
  sunk: [
    {
      name: 'hull-roof shacks',
      zone: 1,
      zones: [1, 2],
      cells: ['S1', 'P1', 'S2'],
      draw: (p, k) => {
        const n = k.W * k.H > 1 ? 2 : 1;
        for (let j = 0; j < n; j++) {
          const box = k.W >= k.H ? [0.1 + j, 0.15, 0.9 + j, 0.85] : [0.15, 0.1 + j, 0.85, 0.9 + j];
          const rise = Math.min(8, k.T * 0.3);
          const wz = k.T - rise;
          p.box(box[0], box[1], box[2], box[3], 0, wz, wl(p, k, j), { win: wn(k), noTop: true });
          hullRoof(p, box, wz, rise);
          p.door(box[0], box[3], box[2], box[3], 0.3, 0.5, 0, 5, [182, 255, 46]);
          p.lamp(box[2], box[3] - 0.2, Math.min(wz - 1, 8), [182, 255, 46], 9);
        }
        if (!p.lod) p.laundry(0.2, k.H - 0.05, k.W - 0.2, k.H - 0.05, 6);
      },
    },
    {
      name: 'canal-front lofts with boat doors',
      zone: 1,
      zones: [1, 2],
      cells: ['S2', 'P2', 'S1'],
      draw: (p, k) => {
        const i = 0.08;
        vol(p, k, i, i, k.W - i, k.H - i, 0, k.T, wl(p, k), wn(k), true);
        // Patched panels (≥ 3 materials on one wall) and the boat doors at the waterline.
        p.box(i, k.H - i, k.W * 0.45, k.H - i + 0.01, 8, Math.min(k.T - 2, 30), wl(p, k, 1), { uplight: false });
        p.door(i, k.H - i, k.W - i, k.H - i, 0.1, 0.45, 0, 7, null);
        p.door(i, k.H - i, k.W - i, k.H - i, 0.55, 0.9, 0, 7, [182, 255, 46]);
        p.box(k.W * 0.2, k.H - i + 0.02, k.W * 0.55, k.H - i + 0.16, 0, 2.2, mat([70, 96, 90], [14, 22, 22]), { uplight: false });
        p.lamp(k.W - i, k.H * 0.5, 9, [182, 255, 46], 10);
        clutter(p, k, i + 0.1, i + 0.1, k.W - i - 0.1, k.H - i - 0.1, k.T, 2);
      },
    },
    {
      name: 'causeway stair-tower',
      zone: 1,
      zones: [1, 2],
      cells: ['S3', 'P3'],
      draw: (p, k) => {
        const i = 0.12;
        p.box(0.05, 0.05, k.W - 0.05, k.H - 0.05, 0, 6, mat([110, 100, 86], [22, 20, 24]), { top: DARK });
        const core = k.W >= k.H ? [0.2, 0.2, k.W - 0.35, 0.8] : [0.2, 0.2, 0.8, k.H - 0.35];
        vol(p, k, core[0], core[1], core[2], core[3], 6, k.T, wl(p, k), wn(k), true);
        // A zig-zag stair cage climbing the right face.
        const su = core[2];
        p.box(su, core[1] + 0.1, su + 0.12, core[1] + 0.35, 6, k.T - 6, mat([110, 112, 104]), { win: { style: 'slit', floor: 8, col: 4, w: 0.5, h: 0.5 }, top: DARK });
        if (p.g && !p.lod) {
          p.begin_();
          for (let z = 10; z < k.T - 8; z += 8) {
            p.m(su + 0.12, core[1] + 0.1, z);
            p.l(su + 0.12, core[1] + 0.35, z + 4);
          }
          p.stroke(p.col(mat([182, 255, 46]), 0.9), 0.5);
        }
        for (let z = 20; z < k.T - 10; z += 30) p.lamp(su + 0.12, core[1] + 0.22, z, [182, 255, 46], 9);
        hullRoof(p, [core[0], core[1], core[2], core[3]], k.T - 1, 1);
        p.antenna(core[0] + 0.15, core[1] + 0.15, k.T, 14, [182, 255, 46]);
        void i;
      },
    },
  ],
  flats: [
    {
      name: 'gantry sheds',
      zone: 3,
      cells: ['P2', 'Q2', 'Q3', 'P3', 'S3'],
      draw: (p, k) => {
        const i = 0.06;
        const hz = Math.round(k.T * 0.45);
        p.box(i, i, k.W - i, k.H - i, 0, hz, wl(p, k), { win: { style: 'band', floor: 10, col: 8, w: 1, h: 0.3 }, noTop: true });
        p.saw(i, i, k.W - i, k.H - i, hz, 6, Math.round(k.W * 3), rf(k), NEON.amber);
        // Two portal gantries striding over the shed to T.
        const y = mat([236, 196, 60]);
        for (const v of [0.25, k.H - 0.25]) {
          p.box(i + 0.02, v - 0.04, i + 0.1, v + 0.04, 0, k.T, y, { uplight: false });
          p.box(k.W - i - 0.1, v - 0.04, k.W - i - 0.02, v + 0.04, 0, k.T, y, { uplight: false });
          p.box(i + 0.02, v - 0.05, k.W - i - 0.02, v + 0.05, k.T - 4, k.T, y, { uplight: false });
        }
        p.blinker(i + 0.06, 0.25, k.T + 1, NEON.red, 1.6, 10);
        p.lamp(k.W * 0.5, k.H - 0.25, k.T - 5, [255, 170, 70], 16);
      },
    },
    {
      name: 'coke-oven rows',
      zone: 3,
      cells: ['S1', 'P1', 'S2', 'Q1'],
      draw: (p, k) => {
        const brick = mat([132, 90, 70], [30, 20, 20], 'wall');
        const alongU = k.W >= k.H;
        const rows = 2;
        for (let r = 0; r < rows; r++) {
          const box = alongU ? [0.08, 0.12 + r * 0.42, k.W - 0.08, 0.46 + r * 0.42] : [0.12 + r * 0.42, 0.08, 0.46 + r * 0.42, k.H - 0.08];
          const h = k.T - 4 - r * 2;
          p.box(box[0], box[1], box[2], box[3], 0, h, brick, { top: DARK });
          // Oven doors glowing orange.
          const n = Math.round((alongU ? box[2] - box[0] : box[3] - box[1]) * 6);
          for (let j = 0; j < n; j++) {
            if (alongU) p.door(box[0], box[3], box[2], box[3], (j + 0.2) / n, (j + 0.7) / n, 1, Math.min(h - 2, 6), [255, 123, 46]);
            else p.door(box[2], box[1], box[2], box[3], (j + 0.2) / n, (j + 0.7) / n, 1, Math.min(h - 2, 6), [255, 123, 46]);
          }
        }
        p.stack(alongU ? k.W - 0.2 : 0.3, alongU ? 0.3 : k.H - 0.2, 0.08, 0, k.T + 10);
      },
    },
    {
      name: 'worker barracks with pipe racks',
      zone: 1,
      zones: [1, 2],
      cells: ['P2', 'P1', 'S1', 'S2', 'S3', 'P3'],
      draw: (p, k) => {
        const alongU = k.W >= k.H;
        const box = alongU ? [0.08, 0.2, k.W - 0.08, k.H - 0.2] : [0.2, 0.08, k.W - 0.2, k.H - 0.08];
        vol(p, k, box[0], box[1], box[2], box[3], 0, k.T - 6, wl(p, k), { style: 'grid', floor: 6.5, col: 6, w: 0.45, h: 0.5 }, true);
        // A rooftop pipe rack on trestles.
        const L = alongU ? box[2] - box[0] : box[3] - box[1];
        const n = Math.max(2, Math.round(L * 3));
        for (let j = 0; j <= n; j++) {
          const t = j / n;
          const u = alongU ? box[0] + 0.05 + (L - 0.1) * t : (box[0] + box[2]) / 2;
          const v = alongU ? (box[1] + box[3]) / 2 : box[1] + 0.05 + (L - 0.1) * t;
          pole(p, u, v, k.T - 6, k.T, STEEL, 0.7);
        }
        const a = alongU ? [box[0] + 0.05, (box[1] + box[3]) / 2] : [(box[0] + box[2]) / 2, box[1] + 0.05];
        const b = alongU ? [box[2] - 0.05, (box[1] + box[3]) / 2] : [(box[0] + box[2]) / 2, box[3] - 0.05];
        p.pipe(a[0], a[1], k.T - 1, b[0], b[1], k.T - 1, 2, RUST);
        p.pipe(a[0], a[1], k.T - 3, b[0], b[1], k.T - 3, 1.5, STEEL);
        for (let z = 7; z < k.T - 8; z += 7) p.box(box[0], box[3], box[2], box[3] + 0.04, z - 0.8, z, CONC, { uplight: false });
      },
    },
  ],
  terraces: [
    {
      name: 'stepped hillside houses',
      zone: 1,
      cells: ['S1', 'S2', 'P2', 'P1', 'Q1', 'Q2'],
      draw: (p, k) => {
        const steps = 3;
        const alongU = k.W >= k.H;
        for (let j = 0; j < steps; j++) {
          // Each house steps down towards the viewer.
          const t0 = (j / steps) * (alongU ? k.H : k.W);
          const t1 = ((j + 1) / steps) * (alongU ? k.H : k.W);
          const z0 = (steps - 1 - j) * Math.min(4, k.T * 0.12);
          const box = alongU ? [0.08, t0 + 0.04, k.W - 0.08, t1 - 0.02] : [t0 + 0.04, 0.08, t1 - 0.02, k.H - 0.08];
          const top = j === 0 ? k.T - 5 : k.T - 5 - j * Math.min(6, k.T * 0.15);
          p.box(box[0], box[1], box[2], box[3], 0, z0 + 0.1, mat([170, 160, 140], [34, 30, 30]), { uplight: false });
          p.box(box[0] + 0.02, box[1], box[2] - 0.02, box[3], z0, Math.max(z0 + 5, top), wl(p, k, j), { win: { style: 'grid', floor: 6.5, col: 7, w: 0.5, h: 0.5, lit: 1.2 }, noTop: true });
          hip(p, box[0], box[1] - 0.02, box[2], box[3] + 0.02, Math.max(z0 + 5, top), 5, rf(k, j));
          p.greens(box[0] + 0.05, box[3] - 0.08, box[2] - 0.05, box[3], z0, 2);
        }
        p.lamp(k.W - 0.06, k.H - 0.06, 7, [255, 214, 150], 10);
      },
    },
    {
      name: 'stair-street row',
      zone: 2,
      zones: [2, 1],
      cells: ['P1', 'P2', 'S1'],
      draw: (p, k) => {
        const alongU = k.W >= k.H;
        const L = alongU ? k.W : k.H;
        const n = Math.round(L * 2);
        for (let j = 0; j < n; j++) {
          const a = 0.06 + (j * (L - 0.12)) / n;
          const b = a + (L - 0.12) / n - 0.02;
          const z0 = j * Math.min(2.2, k.T * 0.08);
          const box = alongU ? [a, 0.1, b, 0.7] : [0.1, a, 0.7, b];
          p.box(box[0], box[1], box[2], box[3], 0, z0 + 0.2, mat([180, 170, 150], [36, 32, 30]), { uplight: false });
          const top = Math.max(z0 + 6, k.T - (n - 1 - j) * 1.5);
          p.box(box[0], box[1], box[2], box[3], z0, top, wl(p, k, j), { win: { style: 'grid', floor: 6.5, col: 6, w: 0.55, h: 0.5 }, top: rf(k, j) });
          if (alongU) p.awning(box[0], box[3], box[2], box[3], z0 + 6, 0.07, sc(p, k, j), false);
        }
        // The stair: risers climbing along the front with warm lamps.
        if (p.g && !p.lod) {
          p.begin_();
          for (let s = 0; s < 10; s++) {
            const t = s / 10;
            const u = alongU ? 0.08 + t * (L - 0.16) : 0.85;
            const v = alongU ? 0.85 : 0.08 + t * (L - 0.16);
            p.m(u, v, t * n * Math.min(2.2, k.T * 0.08));
            p.l(alongU ? u + 0.1 : u, alongU ? v : v + 0.1, t * n * Math.min(2.2, k.T * 0.08));
          }
          p.stroke(p.col(mat([200, 190, 170], [40, 36, 34]), 1), 0.8);
        }
        for (let s = 0; s < 3; s++) p.lamp(alongU ? 0.3 + s * 0.6 : 0.85, alongU ? 0.85 : 0.3 + s * 0.6, 5 + s * 2, [255, 214, 150], 10);
      },
    },
    {
      name: 'cliff-face apartments',
      zone: 1,
      zones: [1, 2],
      cells: ['S3', 'P3', 'Q3', 'S2'],
      draw: (p, k) => {
        // A rock base climbing the back, apartments stacked against it, each floor stepping out.
        const rock = mat([150, 140, 126], [30, 28, 30]);
        p.box(0.06, 0.06, k.W - 0.06, 0.4, 0, k.T, rock, { top: GREEN_ROOF });
        p.greens(0.1, 0.1, k.W - 0.1, 0.36, k.T, 4);
        const floors = Math.max(4, Math.round(k.T / 22));
        const fh = (k.T - 6) / floors;
        for (let f = 0; f < floors; f++) {
          const out = 0.92 - f * (0.45 / floors);
          p.box(0.1, 0.4, k.W - 0.1, Math.min(k.H - 0.06, out * k.H), f * fh, (f + 1) * fh, wl(p, k, f), { win: { style: 'grid', floor: 7, col: 6, w: 0.6, h: 0.5, lit: 1.2 }, top: GREEN_ROOF, trim: f === floors - 1 ? trim(p, k) : undefined });
          if (!p.lod) p.greens(0.12, Math.min(k.H - 0.06, out * k.H) - 0.1, k.W - 0.12, Math.min(k.H - 0.06, out * k.H), (f + 1) * fh, 2);
        }
        for (let z = 10; z < k.T; z += 26) p.lamp(k.W - 0.1, 0.42, z, [255, 214, 150], 10);
      },
    },
  ],
  reedmere: [
    {
      name: 'long houses on piles',
      zone: 1,
      zones: [1, 2],
      cells: ['P1', 'P2', 'S1', 'S2', 'Q1', 'Q2'],
      draw: (p, k) => {
        const alongU = k.W >= k.H;
        stilts(p, 0.1, 0.1, k.W - 0.1, k.H - 0.1, 4);
        boardwalk(p, 0.06, 0.06, k.W - 0.06, k.H - 0.06, 4);
        const box = alongU ? [0.12, 0.2, k.W - 0.12, k.H - 0.25] : [0.2, 0.12, k.W - 0.25, k.H - 0.12];
        const rise = Math.min(10, k.T * 0.32);
        const wz = k.T - rise;
        p.box(box[0], box[1], box[2], box[3], 4, wz, wl(p, k), { win: { style: 'grid', floor: 7, col: 8, w: 0.6, h: 0.35 }, noTop: true });
        riseRoof(p, k, k.s % 2 ? 'thatch' : 'gable', box[0] - 0.05, box[1] - 0.05, box[2] + 0.05, box[3] + 0.05, wz, rise, GREEN_ROOF, alongU);
        p.door(box[0], box[3], box[2], box[3], 0.42, 0.58, 4, 9, [255, 220, 150]);
        // Rain chains at the eaves.
        for (const t of [0.1, 0.9]) pole(p, box[0] + (box[2] - box[0]) * t, box[3] + 0.05, 5, wz, mat([150, 130, 90]), 0.4);
      },
    },
    {
      name: 'reed-thatched boathouses',
      zone: 2,
      zones: [2, 1, 3],
      cells: ['S1', 'S2', 'P1'],
      draw: (p, k) => {
        boardwalk(p, 0.04, 0.04, k.W - 0.04, k.H - 0.04, 1.5);
        const rise = Math.min(12, k.T * 0.45);
        const wz = k.T - rise;
        p.box(0.12, 0.12, k.W - 0.12, k.H - 0.12, 1.5, wz, wl(p, k), { noTop: true });
        p.door(0.12, k.H - 0.12, k.W - 0.12, k.H - 0.12, 0.2, 0.8, 1.5, Math.max(4, wz - 2), [255, 220, 150]);
        riseRoof(p, k, 'thatch', 0.06, 0.06, k.W - 0.06, k.H - 0.06, wz, rise, GREEN_ROOF, k.W < k.H);
        p.box(k.W * 0.3, k.H - 0.1, k.W * 0.7, k.H + 0.05, 0, 1.8, mat([80, 110, 96], [16, 24, 22]), { uplight: false });
        p.lamp(k.W - 0.08, k.H - 0.08, 6, [220, 255, 200], 10);
      },
    },
  ],
  skeleton: [
    {
      name: 'scaffold-wrapped half-tower',
      zone: 1,
      zones: [1, 2],
      cells: ['S3', 'P3', 'S2'],
      draw: (p, k) => {
        const i = 0.14;
        const done = Math.round(k.T * (0.55 + k.s * 0.05));
        vol(p, k, i, i, k.W - i, k.H - i, 0, done, wl(p, k), wn(k), true);
        // The unfinished upper floors: bare slabs, columns, a scaffold cage to T.
        for (let z = done + 8; z < k.T; z += 8) p.box(i, i, k.W - i, k.H - i, z - 1.5, z, mat([150, 150, 146], [32, 32, 38]), { uplight: false });
        for (const [u, v] of [
          [k.W - i, i],
          [k.W - i, k.H - i],
          [i, k.H - i],
        ] as const)
          p.box(u - 0.03, v - 0.03, u + 0.03, v + 0.03, done, k.T, mat([140, 140, 136]), { uplight: false });
        lattice(p, i - 0.05, i - 0.05, k.W - i + 0.05, k.H - i + 0.05, done - 20, k.T, mat([214, 170, 70], [90, 70, 34]), 7, 0.5);
        p.shed(i + 0.1, i + 0.1, k.W * 0.6, k.H * 0.6, k.T, 2, tp(k), 'v');
        crane(p, i + 0.05, i + 0.05, k.T, 14, k.W * 0.7, mat([236, 196, 60]));
        lampString(p, [i, k.H - i, k.T], [k.W - i, k.H - i, k.T], 6, [201, 162, 255], 3, 6);
      },
    },
    {
      name: 'bare-top tower',
      zone: 2,
      zones: [2, 1],
      cells: ['S3', 'Q3', 'P3'],
      draw: (p, k) => {
        const q = k.W === 2 && k.H === 2;
        const box = q ? [0.3, 0.3, 1.7, 1.7] : [0.16, 0.16, k.W - 0.16, k.H - 0.16];
        if (q) vol(p, k, 0.05, 0.05, 1.95, 1.95, 0, 14, wl(p, k, 1), { style: 'band', floor: 7, col: 6, w: 1, h: 0.5 });
        const z0 = q ? 14 : 0;
        vol(p, k, box[0], box[1], box[2], box[3], z0, k.T - 12, wl(p, k), wn(k), true);
        // A bare concrete top storey with open bays and rebar.
        p.box(box[0], box[1], box[2], box[3], k.T - 12, k.T, mat([156, 152, 144], [34, 32, 36]), { top: mat([130, 128, 124]) });
        const n = Math.round((box[2] - box[0]) * 5);
        for (let j = 0; j < n; j++) p.door(box[0], box[3], box[2], box[3], (j + 0.15) / n, (j + 0.85) / n, k.T - 11, k.T - 2, null);
        if (p.g && !p.lod) {
          p.begin_();
          for (let j = 1; j < 6; j++) {
            const u = box[0] + ((box[2] - box[0]) * j) / 6;
            p.m(u, box[3], k.T);
            p.l(u, box[3], k.T + 6);
          }
          p.stroke(p.col(mat([120, 70, 50]), 0.9), 0.5);
        }
        p.wallSign(box[0], box[3], box[2], box[3], 0.1, 0.5, 10 + z0, 18 + z0, [201, 162, 255]);
      },
    },
    {
      name: 'tarped stub block',
      zone: 1,
      zones: [1, 2, 3],
      cells: ['S1', 'S2', 'P1', 'P2', 'Q1', 'Q2'],
      draw: (p, k) => {
        // A block that stopped a floor or two short: the finished part, bare columns above it, tarps and rebar.
        const i = 0.1;
        const done = Math.max(6, Math.round(k.T * (0.62 + k.s * 0.05)));
        vol(p, k, i, i, k.W - i, k.H - i, 0, done, wl(p, k), wn(k), false);
        for (const [u, v] of [
          [k.W - i, i],
          [k.W - i, k.H - i],
          [i, k.H - i],
          [k.W / 2, k.H - i],
        ] as const)
          p.box(u - 0.03, v - 0.03, u + 0.03, v + 0.03, done, k.T, mat([150, 150, 146], [32, 32, 38]), { uplight: false });
        p.box(i, i, k.W - i, k.H - i, k.T - 1.5, k.T, mat([156, 152, 144], [34, 32, 36]), { uplight: false, top: mat([140, 138, 132]) });
        p.box(i + 0.02, k.H - i - 0.01, k.W * 0.55, k.H - i + 0.01, done, k.T - 2, tp(k), { uplight: false });
        if (p.g && !p.lod) {
          p.begin_();
          for (let j = 1; j < 6; j++) {
            const u = i + ((k.W - 2 * i) * j) / 6;
            p.m(u, k.H - i, k.T);
            p.l(u, k.H - i, k.T + 5);
          }
          p.stroke(p.col(mat([120, 70, 50]), 0.9), 0.5);
        }
        p.wallSign(i, k.H - i, k.W - i, k.H - i, 0.15, 0.55, 2, Math.max(4, Math.min(done - 2, 10)), sc(p, k), false);
        lampString(p, [i, k.H - i, k.T], [k.W - i, k.H - i, k.T], 5, [201, 162, 255], 2, 6);
      },
    },
  ],
  tarmac: [
    {
      name: 'hangar homes',
      zone: 1,
      zones: [1, 3],
      cells: ['S1', 'S2', 'P2', 'P1', 'Q1', 'Q2'],
      draw: (p, k) => {
        const alongU = k.W >= k.H;
        const rise = Math.min(k.T * 0.5, 14);
        const wz = k.T - rise;
        p.box(0.08, 0.08, k.W - 0.08, k.H - 0.08, 0, wz, wl(p, k), { win: wn(k), noTop: true });
        arch(p, 0.05, 0.05, k.W - 0.05, k.H - 0.05, wz, rise, rf(k), alongU ? 'u' : 'v');
        // The glazed end wall with home windows and a lit door.
        if (alongU) p.door(k.W - 0.05, 0.2, k.W - 0.05, k.H - 0.2, 0.3, 0.7, 0, wz + rise * 0.5, [255, 220, 170]);
        else p.door(0.2, k.H - 0.05, k.W - 0.2, k.H - 0.05, 0.3, 0.7, 0, wz + rise * 0.5, [255, 220, 170]);
        p.blinker(0.2, 0.2, k.T + 1, [255, 59, 92], 2.4, 10);
        if (!p.lod) {
          p.wallSign(0.08, k.H - 0.08, k.W - 0.08, k.H - 0.08, 0.05, 0.25, 2, Math.max(4, wz - 1), [255, 210, 80], false);
        }
      },
    },
    {
      name: 'control-tower block',
      zone: 2,
      zones: [2, 1],
      cells: ['S3', 'P3'],
      draw: (p, k) => {
        const pair = k.W !== k.H;
        p.box(0.08, 0.08, k.W - 0.08, k.H - 0.08, 0, 14, wl(p, k, 1), { win: { style: 'band', floor: 7, col: 7, w: 1, h: 0.45 }, top: rf(k) });
        const c = pair ? (k.W > k.H ? [1.4, 0.5] : [0.5, 1.4]) : [0.5, 0.5];
        const cabH = 14;
        p.cyl(c[0], c[1], 0.2, 14, k.T - cabH, wl(p, k), rf(k));
        p.cylBands(c[0], c[1], 0.2, 14, k.T - cabH, 9);
        // The flared glass cab and its lit band.
        p.cyl(c[0], c[1], 0.34, k.T - cabH, k.T - 4, mat([90, 140, 170], [14, 30, 50]), DARK, 0.4);
        p.neonRing(c[0], c[1], 0.36, k.T - cabH + 4, [255, 210, 80], 1.1);
        p.cyl(c[0], c[1], 0.38, k.T - 4, k.T, DARK, rf(k));
        p.glow(c[0], c[1], k.T - 8, [150, 220, 255], 50, p.glowA() * 0.6);
        pole(p, c[0], c[1], k.T, k.T + 12, STEEL);
        p.blinker(c[0], c[1], k.T + 12, [255, 59, 92], 2.4, 14);
        if (pair) vol(p, k, k.W > k.H ? 0.12 : 0.12, k.W > k.H ? 0.12 : 0.12, k.W > k.H ? 0.9 : 0.88, k.W > k.H ? 0.88 : 0.9, 14, Math.round(k.T * 0.5), wl(p, k), wn(k), true);
      },
    },
  ],
  bazaar: [
    {
      name: 'courtyard shophouses',
      zone: 2,
      zones: [2, 1],
      cells: ['S1', 'S2', 'P1', 'Q1', 'P2', 'Q2'],
      draw: (p, k) => {
        const i = 0.06;
        const m = wl(p, k);
        // Shophouses around a small court: back and side rows, a front row with shutters.
        const t = k.T;
        const roofK = k.s % 2 ? 'pyramid' : 'hip';
        const rows: number[][] = [
          [i, i, k.W - i, i + 0.32],
          [i, i + 0.32, i + 0.32, k.H - i],
          [k.W - i - 0.32, i + 0.32, k.W - i, k.H - i],
        ];
        rows.forEach((b, j) => {
          const rise = Math.min(6, t * 0.25);
          p.box(b[0], b[1], b[2], b[3], 0, t - rise, j === 1 ? wl(p, k, 1) : m, { win: { style: 'grid', floor: 6.5, col: 6, w: 0.5, h: 0.5, margin: 1.5 }, noTop: true });
          riseRoof(p, k, roofK, b[0] - 0.02, b[1] - 0.02, b[2] + 0.02, b[3] + 0.02, t - rise, rise, rf(k, j));
        });
        p.door(i + 0.32, k.H - i, k.W - i - 0.32, k.H - i, 0.15, 0.85, 0, 5, sc(p, k));
        for (let j = 0; j < 4; j++) p.lamp(i + 0.35 + j * ((k.W - 2 * i - 0.7) / 3), k.H - i, 7, sc(p, k, j), 7);
        p.awning(i, k.H - i, k.W - i, k.H - i, 6, 0.08, sc(p, k, 2), true);
        p.blade(k.W - i, k.H - i - 0.1, 'u', 0.08, 4, Math.max(8, t - 3), sc(p, k, 3));
        p.greens(i + 0.36, i + 0.36, k.W - i - 0.36, k.H - i - 0.1, 0.3, 2);
      },
    },
    {
      name: 'balconied market tower',
      zone: 2,
      zones: [2, 1],
      cells: ['S3', 'P3', 'S2', 'Q3'],
      draw: (p, k) => {
        const c = [k.W / 2, k.H / 2];
        const ru = k.W > k.H ? 0.6 : 0.32;
        const rv = k.H > k.W ? 0.6 : 0.32;
        const roofH = 12;
        vol(p, k, c[0] - ru, c[1] - rv, c[0] + ru, c[1] + rv, 0, k.T - roofH, wl(p, k), { style: 'grid', floor: 7, col: 6, w: 0.5, h: 0.5 });
        // A balcony on every floor, every other one with lanterns.
        const step = 7 * (2 + (k.s & 1));
        for (let z = step; z < k.T - roofH - 2; z += step) {
          p.box(c[0] - ru, c[1] + rv, c[0] + ru, c[1] + rv + 0.05, z - 0.8, z, mat([140, 96, 60], [30, 20, 14]), { uplight: false });
          p.box(c[0] + ru, c[1] - rv, c[0] + ru + 0.05, c[1] + rv, z - 0.8, z, mat([140, 96, 60], [30, 20, 14]), { uplight: false });
          if (Math.round(z / step) % 2 === 0 && !p.lod) p.lamp(c[0] + ru, c[1] + rv, z + 2, sc(p, k, z), 6);
        }
        pyramid(p, c[0] - ru - 0.04, c[1] - rv - 0.04, c[0] + ru + 0.04, c[1] + rv + 0.04, k.T - roofH, roofH, mat([86, 156, 132], [16, 36, 34], 'roof'));
        p.blade(c[0] + ru + 0.06, c[1] + rv - 0.1, 'u', 0.1, 6, Math.min(k.T - roofH - 2, 40), sc(p, k, 1));
        p.lamp(c[0], c[1], k.T + 2, [255, 200, 120], 14);
      },
    },
  ],
};

/** A flag on a short pole (shared). */
function flagPole(p: Painter, u: number, v: number, z: number, c: RGB) {
  pole(p, u, v, z, z + 10, STEEL, 0.5);
  p.neon([u, v, z + 10, u + 0.12, v - 0.06, z + 8.5, u, v, z + 7], c, 0.8);
}

/** An upturned-hull roof on a box. */
function hullRoof(p: Painter, b: number[], z: number, rise: number) {
  const m = mat([90, 110, 96], [18, 26, 24]);
  const alongU = b[2] - b[0] >= b[3] - b[1];
  if (alongU) {
    const vm = (b[1] + b[3]) / 2;
    p.begin_();
    p.m(b[0] - 0.04, b[3] + 0.03, z);
    p.l(b[2] + 0.06, b[3] + 0.03, z);
    p.l(b[2] + 0.1, vm, z + rise * 0.6);
    p.l(b[2], vm, z + rise);
    p.l(b[0], vm, z + rise);
    p.g?.closePath();
    p.fill(p.col(m, 1.0));
    p.begin_();
    p.m(b[2] + 0.06, b[3] + 0.03, z);
    p.l(b[2] + 0.1, vm, z + rise * 0.6);
    p.l(b[2] + 0.06, b[1] - 0.03, z);
    p.g?.closePath();
    p.fill(p.col(m, 0.78));
  } else {
    const um = (b[0] + b[2]) / 2;
    p.begin_();
    p.m(b[2] + 0.03, b[1] - 0.04, z);
    p.l(b[2] + 0.03, b[3] + 0.06, z);
    p.l(um, b[3] + 0.1, z + rise * 0.6);
    p.l(um, b[3], z + rise);
    p.l(um, b[1], z + rise);
    p.g?.closePath();
    p.fill(p.col(m, 0.9));
    p.begin_();
    p.m(b[0] - 0.03, b[3] + 0.06, z);
    p.l(um, b[3] + 0.1, z + rise * 0.6);
    p.l(b[2] + 0.03, b[3] + 0.06, z);
    p.g?.closePath();
    p.fill(p.col(m, 0.7));
  }
  if (p.g && !p.lod) {
    p.begin_();
    if (alongU) {
      p.m(b[0], (b[1] + b[3]) / 2, z + rise);
      p.l(b[2], (b[1] + b[3]) / 2, z + rise);
    } else {
      p.m((b[0] + b[2]) / 2, b[1], z + rise);
      p.l((b[0] + b[2]) / 2, b[3], z + rise);
    }
    p.stroke(p.col(mat([160, 170, 150]), 1, 0.8), 0.6);
  }
}

/** The style silhouettes of a district (forms 24 + index). */
export function silhouettes(style: DistrictKind): Tpl[] {
  return SIL[style] ?? [];
}

// ════════════════════════════════════════════════════════════════════════════
// ELIGIBILITY AND PICKING
// ════════════════════════════════════════════════════════════════════════════

export const KIT_FIRST = 8;
export const SIL_FIRST = 24;
export const FORM_COUNT = 32;
const SHAPES = ['S', 'P', 'Q'] as const;

/** A body of a cell: form (0..31) and parameter set (0..3; classic forms 0). */
export interface Body {
  form: number;
  seed: number;
}

/** Is template / silhouette `t` eligible for (shape, level, tier)? */
function eligible(t: Tpl, shape: number, level: number, tier: number): boolean {
  if (t.tier !== undefined && tier !== t.tier) return false;
  if (t.cells.includes('*')) return true;
  return t.cells.includes(SHAPES[shape] + level);
}

/** The template at a form number (8..23) of a zone, or a style silhouette (24..31), or null. */
export function tplOf(zone: number, form: number, style: DistrictKind): Tpl | null {
  if (form >= SIL_FIRST) return silhouettes(style)[form - SIL_FIRST] ?? null;
  if (form >= KIT_FIRST) return TEMPLATES[zone - 1]?.[form - KIT_FIRST] ?? null;
  return null;
}

interface CellBodies {
  /** Per residue class 0..8: template bodies and style bodies. */
  gen: Body[][];
  sty: Body[][];
  /** Chance a tile picks a style body when its class has one. */
  pStyle: number;
  /** Every body of the cell (tests, contact sheets): today's forms with their 4 dressings, templates, silhouettes. */
  all: Body[];
  styleCount: number;
}

const cells = new Map<number, CellBodies>();

/**
 * Every eligible body of a cell in a style: today's 8 forms (singles; each with 4 parameter sets: its dressings), the
 * templates and the style's silhouettes, each with its 4 parameter sets.
 */
export function cellBodies(zone: number, level: number, shape: number, tier: number, style: DistrictKind): { all: Body[]; styleCount: number } {
  const c = cellOf(zone, level, shape, tier, style);
  return { all: c.all, styleCount: c.styleCount };
}

function cellOf(zone: number, level: number, shape: number, tier: number, style: DistrictKind): CellBodies {
  const key = ((((zone * 4 + level) * 3 + shape) * 3 + tier) * 16 + STYLES[style].index) | 0;
  let c = cells.get(key);
  if (c) return c;
  const gen: Body[] = [];
  const sty: Body[] = [];
  const classic: Body[] = [];
  if (shape === 0) for (let f = 0; f < 8; f++) for (let s = 0; s < 4; s++) classic.push({ form: f, seed: s });
  TEMPLATES[zone - 1].forEach((t, i) => {
    if (eligible(t, shape, level, tier)) for (let s = 0; s < 4; s++) gen.push({ form: KIT_FIRST + i, seed: s });
  });
  silhouettes(style).forEach((t, i) => {
    if ((t.zones ?? [t.zone]).includes(zone) && eligible(t, shape, level, tier)) for (let s = 0; s < 4; s++) sty.push({ form: SIL_FIRST + i, seed: s });
  });
  // Deterministic shuffles, then deal round-robin into the nine residue classes.
  const shuffle = (a: Body[], salt: number) => {
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(hash2(i, key, salt) * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
  };
  shuffle(gen, 0x51e7);
  shuffle(sty, 0x7a11);
  const g: Body[][] = Array.from({ length: 9 }, () => []);
  const s: Body[][] = Array.from({ length: 9 }, () => []);
  gen.forEach((b, i) => g[i % 9].push(b));
  const off = Math.floor(hash2(key, 3, 0x2f) * 9);
  sty.forEach((b, i) => s[(i + off) % 9].push(b));
  const classesWithStyle = s.filter((x) => x.length > 0).length;
  // ≥ 25% of the district's picks overall: aim for ~45% inside the cells a style covers.
  const pStyle = classesWithStyle ? Math.min(0.92, (0.45 * 9) / classesWithStyle) : 0;
  c = { gen: g, sty: s, pStyle, all: [...classic, ...gen, ...sty], styleCount: sty.length };
  cells.set(key, c);
  return c;
}

/** Residue class of art coordinates (two tiles within r = 2 never share one). */
export function residue(ax: number, ay: number): number {
  return (((ax % 3) + 3) % 3) + 3 * (((ay % 3) + 3) % 3);
}

/** Chance a tile whose class admits its own today's form draws it (≈ a third of single picks). */
const P_CLASSIC = 0.8;

/**
 * The body a tile (or a parcel's head) draws (§6.1 `pickForm`). `ax, ay` are art coordinates, `h` the tile's free
 * hash (its variant, re-rolled on every rebuild), `classicForm` and `palBit` the tile's today's form and palette (its
 * height truth: a today's form can only be the tile's own). Deterministic; no neighbour reads.
 *
 * No identical body within r = 2: tiles within r = 2 have different residue classes; templates and silhouettes are dealt
 * to classes disjointly; a today's form is drawn only with the dressing `s` whose code (form + 8 palBit + 16 s) mod 9
 * equals the class, so two such tiles in different classes differ in form, palette or dressing.
 */
export function pickForm(zone: number, level: number, shape: number, tier: number, style: DistrictKind, ax: number, ay: number, h: number, classicForm = 0, palBit = 0): Body {
  const c = cellOf(zone, level, shape, tier, style);
  const cls = residue(ax, ay);
  const g = c.gen[cls];
  const s = c.sty[cls];
  const r1 = hash2(ax * 7 + h, ay * 13 - h, 0x6b1d);
  const r2 = hash2(ay * 5 + h * 3, ax * 11, 0x33c7);
  if (s.length && r1 < c.pStyle) return s[Math.floor(r2 * s.length)];
  if (shape === 0) {
    const code = (classicForm & 7) + 8 * (palBit & 1);
    for (let sd = 0; sd < 4; sd++) {
      if ((code + 16 * sd) % 9 !== cls) continue;
      if (hash2(ax * 3 - h, ay * 17 + h, 0x1c55) < P_CLASSIC || !g.length) return { form: classicForm & 7, seed: sd };
    }
  }
  if (g.length) return g[Math.floor(r2 * g.length)];
  if (s.length) return s[Math.floor(r2 * s.length)];
  return { form: classicForm & 7, seed: 0 };
}

/** Below LOD_ZOOM a kit body collapses to one of 4 silhouettes per cell and style (§6.1): form mod 4 of the cell's kit forms. */
export function lodBody(zone: number, level: number, shape: number, tier: number, style: DistrictKind, b: Body): Body {
  if (b.form < KIT_FIRST) return b;
  const c = cellOf(zone, level, shape, tier, style);
  const forms: number[] = [];
  for (const x of c.all) if (x.form >= KIT_FIRST && !forms.includes(x.form)) forms.push(x.form);
  forms.sort((a, z) => a - z);
  if (b.form >= SIL_FIRST) return { form: b.form, seed: 0 };
  const kitForms = forms.filter((f) => f < SIL_FIRST);
  const reps = kitForms.slice(0, 4);
  if (!reps.length) return b;
  return { form: reps[b.form % reps.length], seed: 0 };
}

/**
 * The four parameter sets of today's forms (§6.1: every body has 4): s 0 as drawn, 1 a roof garden, 2 an accent band and
 * a sign, 3 a cluster of roof plant. Drawn after the recipe; the recorded top excludes them.
 */
export function classicDress(p: Painter, s: number, zone: number, level: number, accent: RGB | null): void {
  if (s <= 0 || zone === 0) return;
  let top: { u0: number; v0: number; u1: number; v1: number; z: number } | null = null;
  for (const r of p.roofs) {
    if (r.round || r.area < 0.02) continue;
    if (!top || r.z > top.z + 0.5) top = r;
  }
  if (!top) return;
  const du = top.u1 - top.u0;
  const dv = top.v1 - top.v0;
  if (s === 1) {
    if (zone === 3) p.box(top.u0 + du * 0.15, top.v0 + dv * 0.15, top.u1 - du * 0.15, top.v1 - dv * 0.15, top.z, top.z + 1.2, SOLAR_M, { uplight: false, top: SOLAR_M });
    else p.greens(top.u0 + du * 0.12, top.v0 + dv * 0.12, top.u1 - du * 0.12, top.v1 - dv * 0.12, top.z, 3 + level);
  } else if (s === 2) {
    const c = accent ?? p.pal.neon2;
    p.neon([top.u0, top.v1, top.z - 2, top.u1, top.v1, top.z - 2, top.u1, top.v0, top.z - 2], c, 0.8);
    if (level >= 2) p.wallSign(top.u0, top.v1, top.u1, top.v1, 0.2, 0.6, Math.max(4, top.z - 14), Math.max(9, top.z - 6), c, true);
  } else if (!p.lod && du > 0.15 && dv > 0.15) {
    p.ac(top.u0 + du * 0.2, top.v0 + dv * 0.25, top.z);
    p.ac(top.u0 + du * 0.55, top.v0 + dv * 0.6, top.z, 0.06);
    p.tank(top.u1 - du * 0.25, top.v0 + dv * 0.3, top.z, 0.05, 5);
  }
}

/** Draw a kit body (template or silhouette) for the cell. */
export function drawKit(p: Painter, zone: number, form: number, k: KitCtx): void {
  const t = tplOf(zone, form, k.st.id);
  if (!t) return;
  t.draw(p, k);
}

/** A neutral fallback mix for a kit accent with the zone palette (signs that would vanish on pale walls). */
export function accentOn(c: RGB | null, base: RGB): RGB {
  return c ? mix(c, base, 0.15) : base;
}
