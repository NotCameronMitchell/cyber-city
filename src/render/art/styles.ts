// ─────────────────────────────────────────────────────────────────────────────
// District styles (docs/MEGACITY.md §6.1 "District styles", §3.7 variant accents).
//
// A style is what a district's buildings are made of: wall and roof materials,
// window habits, sign colours and density, roof kinds and street props, plus a
// handful of its own silhouettes (art/kit.ts, forms 24..31) that appear only in
// that district. Charter Shore is today's look exactly: no tint, no props, no
// accent, so a migrated city keeps every body it had.
//
// Today's 72 hand-built forms keep their mass in every style; a style restyles
// their materials (Painter.sty, a tint on the zone materials by role) and adds
// props after the recipe (styleDress), the way the wealth tier does (zones.ts
// dressTier). Kit templates read the style's materials directly.
//
// Every variant of a kind on a 5×5 region (§3.7) brings its own accent colour
// (config DISTRICTS[kind].variants[v − 1].accent; variant 0 the kind's colour):
// roof trims and signs use it, so two Shoals districts side by side read apart.
// ─────────────────────────────────────────────────────────────────────────────

import { DISTRICTS } from '../../game/config';
import { DISTRICT_KINDS, type DistrictKind } from '../../game/types';
import { css, hexToRgb, mix, type RGB } from '../palette';
import { arch, hip, pyramid } from './parts';
import { mat, type ArtPal, type Mat, type Painter, type Roof, type WinSpec } from './painter';

/** Roof habits a kit template may draw on its top (§6.1 parameters). */
export type RoofKind = 'plant' | 'gable' | 'saw' | 'garden' | 'helipad' | 'antenna' | 'tower' | 'solar' | 'dome' | 'pyramid' | 'tarp' | 'hip' | 'arch' | 'thatch';

/** A tint target for one material role: day colour, night colour, amount. */
export type RoleTint = readonly [RGB, RGB, number];

export interface StyleDef {
  id: DistrictKind;
  index: number;
  /** Kit wall materials (role 'wall', so the wealth tier still restyles them). */
  walls: Mat[];
  /** Kit roof materials. */
  roofs: Mat[];
  /** Tarps, canvas and awnings. */
  tarps: Mat[];
  /** Trim metal (rails, frames). */
  metal: Mat;
  /** Tint of today's forms by material role (null = untouched). */
  tint: Partial<Record<'wall' | 'roof' | 'tarp' | 'rust', RoleTint>> | null;
  /** Window habits, most typical first. */
  wins: WinSpec[];
  /** Glass for curtain walls. */
  glass?: Mat;
  /** Roof habits, most typical first. */
  roofKinds: RoofKind[];
  /** Sign colours; empty = the zone palette's neon. */
  signs: RGB[];
  /** Sign chance per body 0..1. */
  signRate: number;
  /** Window light hue bias at night (warm share added). */
  warm: number;
  /** Street lamp / prop light colour. */
  lamp: RGB;
  /** Night window light: the warm and cool hues (shore: today's). */
  win?: readonly [RGB, RGB];
  /** Share of lit windows at night (× today's). */
  lit?: number;
  /** Share of a district's bodies whose signature neon is the district accent (the rest pick a style sign colour). */
  accShare?: number;
  /** Share of the other bodies that still wear a roof neon (quiet styles few, the Bazaar all). */
  trimRate?: number;
}

const wall = (c: RGB, n?: RGB) => mat(c, n, 'wall');
const roof = (c: RGB, n?: RGB) => mat(c, n, 'roof');
const tarp = (c: RGB) => mat(c, undefined, 'tarp');
const W = (style: WinSpec['style'], floor: number, col: number, w: number, h: number, extra: Partial<WinSpec> = {}): WinSpec => ({ style, floor, col, w, h, ...extra });

const GRID = W('grid', 7, 7, 0.5, 0.5);
const GRID_S = W('grid', 6, 8, 0.45, 0.5, { margin: 2 });
const BAND = W('band', 7, 7, 1, 0.42);
const CURT = W('curtain', 6, 6, 1, 0.82, { margin: 1 });
const SLIT = W('slit', 10, 9, 0.28, 0.55, { lit: 1.1 });
const CAPS = W('capsule', 6, 6.5, 0.6, 0.55, { margin: 1.5 });

/** The nine styles (one per district kind, §3.7 "Style" column). */
export const STYLES: Record<DistrictKind, StyleDef> = {
  shore: {
    id: 'shore',
    index: 0,
    walls: [wall([142, 116, 140]), wall([112, 126, 136]), wall([98, 116, 140]), wall([150, 154, 168]), wall([128, 122, 142]), wall([124, 136, 150])],
    roofs: [roof([104, 100, 112]), roof([78, 76, 88])],
    tarps: [tarp([60, 120, 140]), tarp([150, 70, 70]), tarp([90, 90, 150])],
    metal: mat([140, 144, 152]),
    tint: null,
    wins: [GRID, BAND, CURT, CAPS],
    roofKinds: ['plant', 'antenna', 'tower', 'helipad', 'garden', 'solar'],
    signs: [],
    signRate: 0.6,
    warm: 0,
    lamp: [255, 214, 160],
  },
  shoals: {
    id: 'shoals',
    index: 1,
    walls: [wall([226, 222, 214], [44, 46, 62]), wall([214, 196, 206], [42, 36, 54]), wall([190, 214, 214], [32, 44, 56]), wall([222, 210, 176], [46, 40, 44]), wall([176, 150, 120], [36, 30, 34])],
    roofs: [roof([200, 204, 210], [40, 44, 58]), roof([150, 186, 196], [28, 40, 56])],
    tarps: [tarp([236, 236, 240]), tarp([120, 200, 214]), tarp([240, 190, 170])],
    metal: mat([200, 204, 208]),
    tint: { wall: [[222, 216, 208], [44, 44, 60], 0.72], roof: [[196, 200, 206], [40, 44, 58], 0.68], tarp: [[226, 230, 236], [44, 48, 62], 0.55] },
    wins: [BAND, CURT, GRID],
    glass: { day: [110, 170, 190], night: [12, 22, 40] },
    roofKinds: ['plant', 'dome', 'garden', 'solar'],
    signs: [
      [140, 255, 230],
      [255, 190, 220],
      [190, 220, 255],
    ],
    signRate: 0.35,
    warm: 0.05,
    lamp: [220, 240, 255],
    win: [[255, 226, 176], [178, 232, 255]],
    accShare: 0.4,
    trimRate: 0.45,
  },
  sunk: {
    id: 'sunk',
    index: 2,
    walls: [wall([128, 82, 66], [30, 18, 22]), wall([110, 100, 86], [24, 22, 26]), wall([92, 104, 96], [18, 26, 28]), wall([138, 110, 84], [32, 24, 22])],
    roofs: [roof([86, 92, 86], [18, 22, 24]), roof([110, 84, 70], [24, 18, 20])],
    tarps: [tarp([60, 120, 110]), tarp([70, 96, 140]), tarp([120, 110, 70])],
    metal: mat([110, 112, 104]),
    tint: { wall: [[120, 92, 76], [28, 20, 24], 0.72], roof: [[90, 94, 86], [18, 22, 24], 0.68], rust: [[132, 84, 60], [30, 18, 16], 0.5] },
    wins: [CAPS, GRID_S, GRID],
    roofKinds: ['tarp', 'plant', 'tower', 'antenna'],
    signs: [
      [182, 255, 46],
      [120, 255, 160],
      [200, 255, 120],
    ],
    signRate: 0.5,
    warm: 0.1,
    lamp: [182, 255, 46],
    win: [[255, 186, 104], [196, 255, 140]],
    lit: 0.85,
    accShare: 0.45,
    trimRate: 0.55,
  },
  flats: {
    id: 'flats',
    index: 3,
    walls: [wall([118, 104, 92], [26, 22, 24]), wall([100, 102, 108], [22, 22, 30]), wall([132, 96, 74], [30, 20, 20]), wall([88, 86, 84], [18, 18, 22])],
    roofs: [roof([92, 92, 98], [20, 20, 26]), roof([118, 96, 80], [26, 20, 20])],
    tarps: [tarp([150, 120, 60]), tarp([110, 110, 120])],
    metal: mat([128, 126, 120]),
    tint: { wall: [[110, 100, 92], [24, 22, 26], 0.72], roof: [[96, 94, 98], [20, 20, 26], 0.68] },
    wins: [SLIT, GRID, BAND],
    roofKinds: ['saw', 'gable', 'plant', 'antenna'],
    signs: [
      [255, 176, 46],
      [255, 220, 120],
    ],
    signRate: 0.3,
    warm: 0.2,
    lamp: [255, 170, 70],
    win: [[255, 150, 56], [255, 204, 120]],
    lit: 0.9,
    accShare: 0.4,
    trimRate: 0.35,
  },
  terraces: {
    id: 'terraces',
    index: 4,
    walls: [wall([196, 184, 164], [40, 36, 40]), wall([214, 200, 176], [44, 40, 42]), wall([172, 160, 150], [36, 32, 38]), wall([206, 178, 150], [42, 34, 36])],
    roofs: [roof([150, 100, 80], [32, 22, 22]), roof([120, 140, 104], [24, 34, 28])],
    tarps: [tarp([200, 120, 80]), tarp([120, 150, 100])],
    metal: mat([160, 150, 140]),
    tint: { wall: [[200, 188, 168], [40, 36, 40], 0.72], roof: [[146, 104, 84], [32, 22, 22], 0.68] },
    wins: [GRID, W('grid', 7, 6, 0.55, 0.5, { lit: 1.1 }), BAND],
    roofKinds: ['garden', 'gable', 'hip', 'plant'],
    signs: [
      [255, 214, 150],
      [255, 190, 120],
    ],
    signRate: 0.3,
    warm: 0.25,
    lamp: [255, 214, 150],
    win: [[255, 222, 160], [255, 238, 206]],
    lit: 0.8,
    accShare: 0.4,
    trimRate: 0.2,
  },
  reedmere: {
    id: 'reedmere',
    index: 5,
    walls: [wall([138, 110, 80], [30, 24, 22]), wall([96, 128, 100], [20, 30, 26]), wall([160, 136, 100], [34, 28, 24]), wall([110, 132, 120], [22, 30, 30])],
    roofs: [roof([92, 140, 90], [16, 34, 26]), roof([150, 130, 80], [30, 26, 20])],
    tarps: [tarp([120, 150, 90]), tarp([170, 150, 100])],
    metal: mat([120, 112, 96]),
    tint: { wall: [[132, 116, 88], [28, 26, 24], 0.72], roof: [[96, 138, 92], [16, 34, 26], 0.68] },
    wins: [GRID, W('grid', 7, 7, 0.6, 0.35), BAND],
    roofKinds: ['garden', 'gable', 'thatch', 'plant'],
    signs: [
      [255, 226, 150],
      [160, 255, 200],
      [255, 200, 120],
    ],
    signRate: 0.15,
    warm: 0.2,
    lamp: [220, 255, 200],
    win: [[255, 210, 136], [238, 236, 214]],
    lit: 0.6,
    accShare: 0.28,
    trimRate: 0.12,
  },
  skeleton: {
    id: 'skeleton',
    index: 6,
    walls: [wall([140, 140, 136], [30, 30, 36]), wall([120, 122, 124], [26, 26, 32]), wall([156, 152, 144], [34, 32, 36])],
    roofs: [roof([110, 110, 112], [24, 24, 30]), roof([90, 92, 98], [20, 20, 26])],
    tarps: [tarp([70, 110, 150]), tarp([160, 90, 60]), tarp([130, 130, 140])],
    metal: mat([120, 96, 80]),
    tint: { wall: [[138, 138, 134], [30, 30, 36], 0.72], roof: [[108, 108, 110], [24, 24, 30], 0.68] },
    wins: [GRID, GRID_S, BAND],
    roofKinds: ['tarp', 'plant', 'antenna'],
    signs: [
      [201, 162, 255],
      [255, 80, 200],
      [120, 230, 255],
    ],
    signRate: 0.45,
    warm: 0,
    lamp: [255, 214, 150],
    win: [[226, 234, 255], [176, 150, 255]],
    lit: 0.62,
    accShare: 0.35,
    trimRate: 0.4,
  },
  tarmac: {
    id: 'tarmac',
    index: 7,
    walls: [wall([150, 156, 160], [32, 34, 42]), wall([176, 168, 150], [38, 34, 36]), wall([120, 136, 140], [24, 30, 36]), wall([190, 186, 176], [40, 40, 44])],
    roofs: [roof([130, 136, 140], [28, 30, 36]), roof([110, 118, 120], [24, 26, 30])],
    tarps: [tarp([210, 120, 50]), tarp([200, 200, 210])],
    metal: mat([170, 174, 180]),
    tint: { wall: [[160, 162, 160], [34, 34, 40], 0.72], roof: [[130, 136, 140], [28, 30, 36], 0.68] },
    wins: [BAND, W('band', 8, 8, 1, 0.35), GRID],
    roofKinds: ['arch', 'plant', 'helipad', 'antenna'],
    signs: [
      [255, 210, 80],
      [255, 255, 255],
      [255, 70, 90],
    ],
    signRate: 0.35,
    warm: 0,
    lamp: [255, 220, 170],
    win: [[255, 238, 204], [150, 204, 255]],
    accShare: 0.4,
    trimRate: 0.45,
  },
  bazaar: {
    id: 'bazaar',
    index: 8,
    walls: [wall([200, 152, 88], [40, 30, 24]), wall([222, 212, 190], [44, 42, 46]), wall([190, 128, 118], [40, 26, 30]), wall([104, 156, 140], [22, 32, 34]), wall([176, 100, 70], [36, 22, 20]), wall([96, 108, 150], [22, 24, 40]), wall([206, 176, 120], [42, 34, 26])],
    roofs: [roof([86, 156, 132], [16, 36, 34]), roof([184, 115, 51], [36, 22, 16]), roof([164, 86, 62], [34, 18, 16]), roof([84, 86, 98], [18, 18, 26])],
    tarps: [tarp([200, 60, 60]), tarp([60, 140, 120]), tarp([220, 170, 60]), tarp([120, 60, 140])],
    metal: mat([150, 110, 70]),
    tint: { wall: [[192, 148, 96], [40, 30, 24], 0.72], roof: [[92, 156, 132], [16, 36, 34], 0.68], tarp: [[200, 80, 60], [40, 18, 18], 0.55] },
    wins: [GRID_S, GRID, CAPS],
    roofKinds: ['pyramid', 'hip', 'dome', 'plant'],
    signs: [
      [255, 43, 214],
      [34, 229, 255],
      [255, 225, 77],
      [77, 255, 154],
      [255, 123, 46],
    ],
    signRate: 0.9,
    warm: 0.25,
    lamp: [255, 200, 120],
    win: [[255, 172, 92], [255, 120, 168]],
    lit: 1.1,
    accShare: 0.3,
    trimRate: 1,
  },
};

export const STYLE_LIST: StyleDef[] = DISTRICT_KINDS.map((k) => STYLES[k]);

/** Style index (0..8) of a district kind. */
export function styleIndex(kind: DistrictKind): number {
  return STYLES[kind]?.index ?? 0;
}

const accents = new Map<number, RGB | null>();
/**
 * The accent of a district (§3.7): roof trims and signs. Charter Shore has none (today's look). Variant 0 uses the kind's
 * City map colour, a repeat its own `accent`.
 */
export function variantAccent(kind: DistrictKind, variant: number): RGB | null {
  if (kind === 'shore') return null;
  const key = styleIndex(kind) * 4 + (variant & 3);
  let a = accents.get(key);
  if (a === undefined) {
    const d = DISTRICTS[kind];
    const hex = variant > 0 ? d?.variants[variant - 1]?.accent ?? d?.color : d?.color;
    // The art leans on the accent more than the City map's soft tint: saturate it so a roofscape reads at zoom 0.5.
    if (hex) {
      const c = hexToRgb(hex);
      const grey = (c[0] + c[1] + c[2]) / 3;
      a = c.map((v) => Math.max(0, Math.min(255, grey + (v - grey) * 1.6))) as RGB;
    } else a = null;
    accents.set(key, a);
  }
  return a;
}

const tintCache = new Map<number, StyleDef['tint']>();
/**
 * The tint for today's forms in a style, varied per body (§6.1: a style restyles their materials): the wall role leans
 * towards one of the style's wall materials (`i` picks it), so a district keeps its character without one flat colour.
 */
export function tintFor(st: StyleDef, i: number): StyleDef['tint'] {
  if (!st.tint) return null;
  const k = st.index * 64 + (i % (st.walls.length * st.roofs.length));
  let t = tintCache.get(k);
  if (t === undefined) {
    const w = st.walls[i % st.walls.length];
    const base = st.tint.wall;
    const r = st.roofs[Math.floor(i / st.walls.length) % st.roofs.length];
    const rb = st.tint.roof;
    t = {
      ...st.tint,
      wall: [mix(w.day, base ? base[0] : w.day, 0.35), mix(w.night, base ? base[1] : w.night, 0.35), base ? base[2] * 0.92 : 0.65],
      roof: rb ? [mix(r.day, rb[0], 0.3), mix(r.night, rb[1], 0.3), rb[2]] : rb,
    };
    tintCache.set(k, t);
  }
  return t;
}

/**
 * A zone palette in a district's style (§6.1, §3.7): the district accent becomes the signature neon (trims, signs, the
 * accent windows), its lamps tint the street uplight and its habits warm or cool the window light, so districts read
 * apart at night too. Charter Shore keeps today's palettes (a migrated city keeps its colour mix).
 */
const palCache = new Map<string, ArtPal>();
/**
 * `pick` (0..1, a hash of the body) chooses the body's signature neon: the district accent for `accShare` of the bodies
 * (so two variants of a kind read apart), else one of the style's sign colours, so a district at night is many lights
 * in its own key rather than one outline repeated on every roof.
 */
export function stylePal(pal: ArtPal, st: StyleDef, acc: RGB | null, pick = 0): ArtPal {
  if (st.id === 'shore' || !acc) return pal;
  const share = st.accShare ?? 0.4;
  const own = pick < share;
  const signs = st.signs;
  const si = own || !signs.length ? -1 : Math.floor(((pick - share) / (1 - share)) * signs.length) % signs.length;
  const key = `${st.id}|${acc.join(',')}|${si}|${pal.neon.join(',')}|${pal.neon2.join(',')}|${pal.warm}|${pal.cool}`;
  let out = palCache.get(key);
  if (!out) {
    const warm = Math.max(0.03, Math.min(0.9, pal.warm + st.warm * 1.6 - (st.warm < 0.06 ? 0.25 : 0)));
    const cool = Math.max(0.03, Math.min(1 - warm, pal.cool + (st.warm < 0.06 ? 0.2 : -st.warm)));
    const neon = si < 0 ? mix(acc, pal.neon, 0.15) : mix(signs[si], pal.neon, 0.1);
    out = { neon, neon2: si < 0 ? pal.neon2 : mix(acc, pal.neon2, 0.5), up: mix(st.lamp, acc, 0.35), warm, cool, glass: pal.glass ?? st.glass, win: st.win, lit: st.lit };
    palCache.set(key, out);
  }
  return out;
}

/** Is a body's signature neon its district accent (stylePal's pick rule)? */
export function accentBody(st: StyleDef, pick: number): boolean {
  return st.id !== 'shore' && pick < (st.accShare ?? 0.4);
}

// ── Props for today's forms in a non-shore style (after the recipe, like dressTier) ──

/** Highest flat roof a recipe drew (painter.roofs). */
export function topOf(p: Painter): Roof | null {
  let best: Roof | null = null;
  for (const r of p.roofs) {
    if (r.round || r.area < 0.02) continue;
    if (!best || r.z > best.z + 0.5 || (Math.abs(r.z - best.z) <= 0.5 && r.area > best.area)) best = r;
  }
  return best;
}

/**
 * The district accent on a roof (§3.7: roof trims): a wash of the accent over the top roof and a neon trim on its two
 * front edges, so two districts of one kind read apart from above.
 */
export function roofTrim(p: Painter, r: Roof, c: RGB, accentBody = true, trimRate = 0.5) {
  const z = r.z + 0.3;
  const g = p.g;
  const own = accentBody || (p.seed >>> 3) % 3 === 0;
  // The accent wash (§3.7): on the accent bodies and a third of the rest, so two variants of a kind read apart by day.
  if (g && r.u1 - r.u0 > 0.1 && r.v1 - r.v0 > 0.1 && own) {
    p.begin_();
    p.quad(r.u0 + 0.02, r.v0 + 0.02, z, r.u1 - 0.02, r.v0 + 0.02, z, r.u1 - 0.02, r.v1 - 0.02, z, r.u0 + 0.02, r.v1 - 0.02, z);
    p.fill(css(mix(c, [40, 40, 50], p.n * 0.6), 0.46 - p.n * 0.26));
  }
  // The roof neon in the body's own sign colour, on about two bodies in three: lights, not a uniform outline.
  if (accentBody || ((p.seed >>> 5) % 97) / 97 < trimRate) p.neon([r.u0, r.v1, z, r.u1, r.v1, z, r.u1, r.v0, z], p.pal.neon, 0.65);
}

const STAIN = mat([60, 72, 64], [10, 14, 14]);
const PILE = mat([96, 80, 62], [20, 16, 16]);
const REBAR = mat([120, 70, 50], [30, 16, 14]);
const SOCK: RGB = [255, 130, 40];

/**
 * Style props on a today's-form body (zone recipes only, after the recipe; registers nothing). Footprint W × H
 * (1 × 1 for today's forms). Shore draws nothing.
 */
export function styleDress(p: Painter, st: StyleDef, acc: RGB | null, zone: number, level: number, W = 1, H = 1, accentBody = true): void {
  if (st.id === 'shore') return;
  const top = topOf(p);
  if (acc && top) roofTrim(p, top, acc, accentBody, st.trimRate);
  const g = p.g;
  const lod = p.lod;
  const fu = W - 0.04;
  const fv = H - 0.04;
  switch (st.id) {
    case 'shoals':
      // Stilts under the front edge and a rope rail.
      if (!lod && level <= 2) {
        for (let k = 0; k < 4; k++) {
          const t = 0.15 + k * 0.23;
          p.box(t * W, fv - 0.02, t * W + 0.03, fv + 0.02, 0, 2.4, PILE, { uplight: false });
          p.box(fu - 0.02, t * H, fu + 0.02, t * H + 0.03, 0, 2.4, PILE, { uplight: false });
        }
      }
      if (top && !lod && level >= 2) p.lamp(top.u1 - 0.08, top.v1 - 0.08, top.z + 3, st.lamp, 8);
      break;
    case 'sunk':
      // Waterline stain to 8 px on the two street faces, a green lamp by the door.
      if (g && !lod) {
        p.begin_();
        p.quad(0.06, fv, 0.2, fu, fv, 0.2, fu, fv, 8, 0.06, fv, 8);
        p.fill(p.col(STAIN, 0.7, 0.35));
        p.begin_();
        p.quad(fu, 0.06, 0.2, fu, fv, 0.2, fu, fv, 8, fu, 0.06, 8);
        p.fill(p.col(STAIN, 0.85, 0.3));
      }
      p.lamp(W * 0.35, fv + 0.03, 9, st.lamp, 9);
      break;
    case 'flats':
      if (top && !lod && level >= 1) {
        const u = top.u0 + (top.u1 - top.u0) * 0.25;
        const v = top.v0 + (top.v1 - top.v0) * 0.3;
        p.pipe(u, v, top.z + 2, top.u1 - 0.04, v, top.z + 2, 1.6, st.metal);
      }
      break;
    case 'terraces':
      // Planters on the top and a warm stair lamp.
      if (top && !lod) p.greens(top.u1 - 0.22, top.v1 - 0.18, top.u1 - 0.04, top.v1 - 0.04, top.z, 2);
      p.lamp(fu, fv * 0.5, 5, st.lamp, 9);
      break;
    case 'reedmere':
      if (!lod && level <= 2) {
        for (let k = 0; k < 3; k++) p.box(0.2 + k * 0.3, fv - 0.02, 0.23 + k * 0.3, fv + 0.02, 0, 2, PILE, { uplight: false });
      }
      if (top && !lod) p.greens(top.u0 + 0.04, top.v0 + 0.04, top.u1 - 0.04, top.v1 - 0.04, top.z, 2);
      break;
    case 'skeleton':
      // Exposed rebar on the top 12 px of mid and high towers.
      if (top && level >= 2 && g && !lod) {
        p.begin_();
        for (let k = 1; k < 6; k++) {
          const u = top.u0 + ((top.u1 - top.u0) * k) / 6;
          p.m(u, top.v1, top.z);
          p.l(u, top.v1, top.z + 7);
          const v = top.v0 + ((top.v1 - top.v0) * k) / 6;
          p.m(top.u1, v, top.z);
          p.l(top.u1, v, top.z + 7);
        }
        p.stroke(p.col(REBAR, 0.9), 0.5);
      }
      break;
    case 'tarmac':
      if (top) p.blinker(top.u1 - 0.06, top.v0 + 0.06, top.z + 2, [255, 59, 92], 2.4, 10);
      if (top && !lod && level <= 2) {
        p.begin_();
        p.m(top.u0 + 0.1, top.v0 + 0.1, top.z);
        p.l(top.u0 + 0.1, top.v0 + 0.1, top.z + 8);
        p.stroke(p.col(st.metal, 0.7), 0.5);
        p.neon([top.u0 + 0.1, top.v0 + 0.1, top.z + 8, top.u0 + 0.22, top.v0 + 0.1, top.z + 7], SOCK, 1.1);
      }
      break;
    case 'bazaar':
      // Lantern string across the front and an awning.
      if (!lod) {
        for (let k = 0; k < 5; k++) {
          const t = (k + 0.5) / 5;
          p.lamp(t * W, fv + 0.06, 9 - Math.sin(t * Math.PI) * 2, st.signs[k % st.signs.length], 7);
        }
      }
      break;
  }
}

/** A style's rising caps for today's forms (§6.1 "Roofs" column): which kinds, on what share, in which materials. */
interface CapRule {
  rate: number;
  maxLevel: number;
  kinds: ('pyramid' | 'hip' | 'gable' | 'arch' | 'dome' | 'saw')[];
  mats: Mat[];
}
const STYLE_CAPS: Partial<Record<DistrictKind, CapRule>> = {
  bazaar: { rate: 0.5, maxLevel: 3, kinds: ['pyramid', 'hip', 'pyramid', 'dome'], mats: [roof([184, 115, 51], [36, 22, 16]), roof([86, 156, 132], [16, 36, 34]), roof([164, 86, 62], [34, 18, 16])] },
  terraces: { rate: 0.42, maxLevel: 3, kinds: ['hip', 'gable', 'hip'], mats: [roof([170, 96, 72], [34, 20, 18]), roof([150, 110, 86], [30, 22, 20]), roof([96, 100, 110], [20, 22, 28])] },
  shoals: { rate: 0.3, maxLevel: 3, kinds: ['dome', 'arch'], mats: [roof([232, 234, 238], [46, 48, 62]), roof([170, 206, 220], [30, 42, 58])] },
  reedmere: { rate: 0.42, maxLevel: 3, kinds: ['gable', 'gable', 'hip'], mats: [roof([92, 140, 90], [16, 34, 26]), roof([176, 150, 90], [36, 30, 20])] },
  tarmac: { rate: 0.34, maxLevel: 2, kinds: ['arch'], mats: [roof([156, 162, 168], [30, 32, 40]), roof([200, 200, 206], [40, 40, 48])] },
  flats: { rate: 0.34, maxLevel: 2, kinds: ['saw', 'gable'], mats: [roof([110, 110, 118], [22, 22, 28]), roof([132, 96, 74], [30, 20, 20])] },
  sunk: { rate: 0.3, maxLevel: 2, kinds: ['gable', 'hip'], mats: [roof([132, 84, 60], [30, 18, 16]), roof([70, 96, 120], [16, 22, 30])] },
};

/**
 * A rising cap on the top flat roof of a today's form in a district style (copper pyramids in the Bazaar, terracotta hips
 * on the Terraces, domes in the Shoals, hangar arcs on the Tarmac…), on a share of the bodies: the classic forms take
 * their district's roofline, not only its colours. Drawn after the recipe (dressing: the recorded top excludes it).
 */
export function styleCap(p: Painter, st: StyleDef, s: number, level: number): void {
  const rule = STYLE_CAPS[st.id];
  if (!rule || level > rule.maxLevel) return;
  const h = ((p.seed >>> 2) * 7 + s * 37) % 100;
  if (h >= rule.rate * 100) return;
  const top = topOf(p);
  if (!top) return;
  const du = top.u1 - top.u0;
  const dv = top.v1 - top.v0;
  if (du < 0.22 || dv < 0.22 || top.area < 0.06) return;
  const kind = rule.kinds[(s + (p.seed >>> 6)) % rule.kinds.length];
  const m = rule.mats[((p.seed >>> 4) + s) % rule.mats.length];
  const e = 0.015;
  const u0 = top.u0 + e;
  const v0 = top.v0 + e;
  const u1 = top.u1 - e;
  const v1 = top.v1 - e;
  const rise = Math.max(5, Math.min(level >= 3 ? 16 : 11, Math.min(du, dv) * 24));
  const z = top.z;
  switch (kind) {
    case 'pyramid':
      pyramid(p, u0, v0, u1, v1, z, rise, m);
      break;
    case 'hip':
      hip(p, u0, v0, u1, v1, z, rise * 0.8, m);
      break;
    case 'gable':
      p.gable(u0, v0, u1, v1, z, rise * 0.7, m, du >= dv ? 'u' : 'v');
      break;
    case 'arch':
      arch(p, u0, v0, u1, v1, z, rise * 0.75, m, du >= dv ? 'u' : 'v');
      break;
    case 'dome':
      p.dome((u0 + u1) / 2, (v0 + v1) / 2, Math.min(du, dv) * 0.4, z, rise * 0.8, m);
      break;
    case 'saw':
      p.saw(u0, v0, u1, v1, z, rise * 0.6, Math.max(2, Math.round(du * 4)), m, p.pal.neon);
      break;
  }
}

/** The style a building head tile's district asks for, as the service-look group (§6.1 "Service buildings by style"). */
export function serviceLookGroup(kind: DistrictKind): 0 | 1 | 2 {
  if (kind === 'flats' || kind === 'tarmac' || kind === 'skeleton') return 1;
  if (kind === 'shoals' || kind === 'sunk' || kind === 'reedmere') return 2;
  return 0;
}
