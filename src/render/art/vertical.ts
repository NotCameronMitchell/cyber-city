// ─────────────────────────────────────────────────────────────────────────────
// Vertical megastructures (docs/STORY.md §4, §9):
//
//   Stratablock   4×4 megablock drawn per stage: Plinth (shop neon bands, ~56 px),
//                 Hab Core (interlocking slabs with a dense window field, ~150 px),
//                 Crown (~210 px): Foundry (orange stack + smoke), Glare (pink
//                 holo halo), Kite Nest (lilac antennae + string lights) or
//                 Commons (green terraces). The stage under construction shows
//                 as a scaffold cage with a tower crane. Recipes are cached as
//                 body sprites like every other building (one model per
//                 complete-stage × scaffold × crown variant).
//   Skybridge     a glass tube 10 px below the lower anchor's roof, walking light
//                 dots at night; sealed bridges go dark; kite-wing glow paint
//                 when the mural flag is set. Drawn live per gap tile.
//   Ribbon Rail   a pylon on every land tile and a glowing ribbon 28 px up;
//                 light-pulse trains run on live lines (pods by day); dead lines
//                 are grey. Drawn live per rail tile.
//
// The live segment painters are allocation-free: colours are cached per night
// bucket and glow sprites come from palette.glowSprite.
// ─────────────────────────────────────────────────────────────────────────────

import type { CrownId } from '../../game/story/types';
import type { DistrictKind } from '../../game/types';
import { HALF_H, HALF_W } from '../camera';
import { NEON, css, glowSprite, mix, type RGB } from '../palette';
import { mat, type ArtPal, type Mat, type Painter, type WinSpec } from './painter';
import type { Recipe } from './zones';
import type { ArtEnv } from '../buildings';
import { CROWN_LOOKS } from './faction';
import { STYLES } from './styles';

// ── Stratablock recipes ───────────────────────────────────────────────────

export const STACK_PAL: ArtPal = { neon: [169, 184, 255], neon2: NEON.cyan, up: [130, 140, 255], warm: 0.55, cool: 0.3 };

const CROWN_IDS: (CrownId | null)[] = [null, 'foundry', 'glare', 'nest', 'commons', 'salvage', 'lamp'];
/** Variant code for a Stratablock model: complete stage 0..3, scaffold flag, crown. */
export function stackVariant(complete: number, building: boolean, crown: CrownId | undefined): number {
  const k = crown ? CROWN_IDS.indexOf(crown) : 0;
  return Math.max(0, Math.min(3, complete)) + (building ? 4 : 0) + Math.max(0, k) * 8;
}
/** Number of distinct variant codes (model id stride). */
export const STACK_VARIANTS = 64;

/** Top of each stage volume (px). */
export const STACK_Z = [1.2, 56, 150, 210] as const;

const PODIUM = mat([128, 122, 132]);
const PODIUM2 = mat([104, 102, 118]);
const HAB = mat([150, 138, 150]);
const HAB2 = mat([118, 126, 142]);
const ROOF = mat([104, 100, 112]);
const ROOF_DARK = mat([74, 72, 86]);
const IRON = mat([98, 86, 80]);
const W_SHOP: WinSpec = { style: 'band', floor: 8, col: 6, w: 1, h: 0.5, margin: 2, lit: 1.7 };
const W_POD: WinSpec = { style: 'grid', floor: 7, col: 6, w: 0.55, h: 0.5, lit: 1.4 };
const W_HAB: WinSpec = { style: 'grid', floor: 5.5, col: 5, w: 0.55, h: 0.55, lit: 1.75 };
const W_HAB2: WinSpec = { style: 'capsule', floor: 6, col: 5.5, w: 0.6, h: 0.55, margin: 1.5, lit: 1.6 };

const ORANGE: RGB = [255, 123, 46];
const PINK: RGB = [255, 198, 241];
const LILAC: RGB = [201, 162, 255];
const GREEN: RGB = [77, 255, 154];
const WARM: RGB = [255, 214, 150];

/** Plinth and Hab Core materials: today's in Charter Shore, the district style's elsewhere (MEGACITY §6.2). */
interface StackMats {
  podium: Mat;
  podium2: Mat;
  hab: Mat;
  hab2: Mat;
  roof: Mat;
}
const TODAY: StackMats = { podium: PODIUM, podium2: PODIUM2, hab: HAB, hab2: HAB2, roof: ROOF };
const styleMats = new Map<string, StackMats>();
function matsOf(style: DistrictKind): StackMats {
  if (style === 'shore') return TODAY;
  let m = styleMats.get(style);
  if (!m) {
    const st = STYLES[style];
    const w = st.walls;
    m = { podium: w[0], podium2: w[1 % w.length], hab: w[2 % w.length], hab2: w[3 % w.length], roof: st.roofs[0] };
    styleMats.set(style, m);
  }
  return m;
}
let M: StackMats = TODAY;

function plinth(p: Painter) {
  const N = p.pal.neon;
  const N2 = p.pal.neon2;
  const PODIUM = M.podium;
  const PODIUM2 = M.podium2;
  const ROOF = M.roof;
  p.box(0.12, 0.12, 3.88, 3.88, 1.2, 30, PODIUM, { win: W_SHOP, top: ROOF, trim: N2 });
  // Shop neon bands around the two street faces.
  p.neon([0.12, 3.9, 11, 3.9, 3.9, 11, 3.9, 0.12, 11], N, 1.2);
  p.neon([0.12, 3.9, 21, 3.9, 3.9, 21, 3.9, 0.12, 21], [255, 43, 214], 0.8);
  p.awning(0.3, 3.88, 1.9, 3.88, 8, 0.12, N2);
  p.awning(2.2, 3.88, 3.7, 3.88, 8, 0.12, [255, 43, 214]);
  p.awning(3.88, 2.2, 3.88, 3.7, 8, 0.12, N);
  p.wallSign(0.12, 3.88, 3.88, 3.88, 0.06, 0.4, 13, 27, [255, 43, 214]);
  p.wallSign(3.88, 0.12, 3.88, 3.88, 0.1, 0.45, 13, 27, N2);
  p.blade(3.88, 1.7, 'u', 0.14, 4, 28, NEON.yellow);
  p.door(0.12, 3.88, 3.88, 3.88, 0.46, 0.56, 1.2, 8, WARM);
  p.door(3.88, 0.12, 3.88, 3.88, 0.62, 0.72, 1.2, 8, WARM);
  // Upper podium with the ribbon station deck.
  p.box(0.35, 0.35, 3.65, 3.65, 30, 56, PODIUM2, { win: W_POD, top: ROOF, trim: N });
  p.neon([0.35, 3.67, 43, 3.67, 3.67, 43, 3.67, 0.35, 43], N2, 0.7);
  // Station sign: a lit band with the ribbon glyph.
  p.ticker(0.35, 3.65, 3.65, 3.65, 0.55, 0.95, 33, 39, NEON.cyan);
}

function habCore(p: Painter) {
  const N = p.pal.neon;
  const HAB = M.hab;
  const HAB2 = M.hab2;
  const ROOF = M.roof;
  // Interlocking slabs: a long one, a short one and a stacked module.
  p.box(0.6, 0.6, 2.2, 3.4, 56, 150, HAB, { win: W_HAB, top: ROOF, trim: N });
  p.box(2.2, 0.6, 3.4, 2.0, 56, 128, HAB2, { win: W_HAB2, top: ROOF, trim: p.pal.neon2 });
  p.box(2.2, 2.3, 3.2, 3.4, 56, 96, HAB2, { win: W_HAB, top: ROOF, trim: [255, 43, 214] });
  // Vertical light strips on the front corners.
  p.neon([2.2, 3.4, 60, 2.2, 3.4, 146], N, 1);
  p.neon([3.4, 2.0, 60, 3.4, 2.0, 124], p.pal.neon2, 0.9);
  // Balcony ledges every few floors on the long slab's left face.
  for (let z = 70; z < 146; z += 16) p.box(0.6, 3.4, 2.2, 3.47, z - 1, z, ROOF_DARK, { uplight: false, top: ROOF_DARK });
  // Sky garden on the stacked module, laundry on the short slab.
  p.greens(2.3, 2.4, 3.1, 3.3, 96, 6);
  p.laundry(2.4, 0.8, 3.2, 0.8, 128);
  p.ac(2.6, 1.3, 128);
  p.ac(2.9, 1.5, 128, 0.09);
  p.wallSign(2.2, 0.6, 2.2, 2.0, 0.15, 0.85, 110, 122, [255, 43, 214]);
  p.blinker(3.35, 0.65, 129, NEON.red, 1.7, 12);
}

function crownTop(p: Painter, crown: CrownId | null, look = 0, banners = true) {
  const z0 = 150;
  // Looks (MEGACITY §6.2): look 0 of the four old crowns is today's crown; every other look is a faction design.
  const design = crown ? CROWN_LOOKS[crown]?.[Math.min(2, look)] ?? null : null;
  if (design) {
    p.box(0.8, 0.9, 2.0, 3.1, z0, z0 + 4, ROOF_DARK, { uplight: false });
    design(p, { b: [0.75, 0.85, 2.05, 3.15], z0: z0 + 4, h: 78, banners });
    return;
  }
  switch (crown) {
    case 'foundry': {
      p.box(0.8, 0.9, 2.0, 3.1, z0, z0 + 24, IRON, { win: { style: 'slit', floor: 8, col: 6, w: 0.3, h: 0.6, lit: 1.2 }, top: ROOF_DARK, trim: ORANGE });
      p.saw(0.8, 0.9, 2.0, 3.1, z0 + 24, 5, 3, ROOF, ORANGE);
      p.stack(1.35, 1.6, 0.16, z0 + 24, 34);
      p.stack(1.6, 2.4, 0.11, z0 + 24, 24);
      p.glow(1.4, 2.0, z0 + 12, ORANGE, 90, p.glowA() * 0.5);
      const [x, y] = p.pt(1.35, 1.6, z0 + 58);
      p.addFx({ k: 'flame', x, y, ph: p.rng.next() });
      p.track(x - 12, y - 50);
      break;
    }
    case 'glare': {
      const glass: Mat = { day: [176, 150, 196], night: [26, 12, 36] };
      p.chamfer(0.8, 0.9, 2.0, 3.1, 0.25, z0, z0 + 40, mat([210, 196, 214], [40, 30, 52]), { win: { style: 'curtain', floor: 6, col: 6, w: 1, h: 0.82, margin: 1 }, glass, top: ROOF_DARK, trim: PINK });
      p.board(0.8, 3.1, 2.0, 3.1, 0.12, 0.88, z0 + 8, z0 + 32, 1, PINK, [255, 43, 214]);
      p.neonRing(1.4, 2.0, 0.75, z0 + 52, PINK, 1.4, true);
      p.neonRing(1.4, 2.0, 0.5, z0 + 58, [255, 43, 214], 1, true);
      p.glow(1.4, 2.0, z0 + 52, PINK, 130, p.glowA() * 0.55);
      const [x, y] = p.pt(1.4, 2.0, z0 + 52);
      p.addFx({ k: 'pulse', x, y, size: 110, c: PINK, period: 2.8, ph: 0 });
      p.addFx({ k: 'ring', x, y: y - 6, rx: 30, ry: 15, c: PINK, ph: 0 });
      p.track(x - 60, y - 60);
      break;
    }
    case 'nest': {
      p.box(0.9, 1.0, 1.9, 3.0, z0, z0 + 12, mat([100, 96, 120]), { win: { style: 'grid', floor: 6, col: 6, w: 0.5, h: 0.45, lit: 1.5 }, top: ROOF, trim: LILAC });
      const masts: [number, number, number][] = [
        [1.1, 1.2, 64],
        [1.7, 1.3, 52],
        [1.2, 2.7, 58],
        [1.75, 2.6, 46],
      ];
      for (const [u, v, h] of masts) p.antenna(u, v, z0 + 12, h, LILAC);
      // String lights between the masts.
      for (let m = 0; m < masts.length; m++) {
        const a = masts[m];
        const b = masts[(m + 1) % masts.length];
        for (let i = 1; i < 7; i++) {
          const t = i / 7;
          const sag = Math.sin(t * Math.PI) * 7;
          p.lamp(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, z0 + 12 + Math.min(a[2], b[2]) * 0.8 - sag, i % 2 ? LILAC : WARM, 7);
        }
      }
      // A kite flying off the nest.
      const k: [number, number, number] = [0.3, 1.0, z0 + 92];
      p.neon([k[0], k[1], k[2], k[0] + 0.09, k[1] - 0.09, k[2] - 7, k[0], k[1], k[2] - 16, k[0] - 0.09, k[1] + 0.09, k[2] - 7, k[0], k[1], k[2]], LILAC, 0.9);
      p.glow(k[0], k[1], k[2] - 7, LILAC, 26, p.glowA() * 0.7);
      break;
    }
    case 'commons': {
      const tiers: [number, number, number, number][] = [
        [0.7, 0.8, 2.1, 3.2],
        [0.85, 1.0, 1.95, 3.0],
        [1.0, 1.2, 1.8, 2.8],
      ];
      let z = z0;
      for (const [u0, v0, u1, v1] of tiers) {
        p.box(u0, v0, u1, v1, z, z + 14, mat([170, 180, 168], [34, 44, 44]), { win: { style: 'band', floor: 7, col: 6, w: 1, h: 0.45, lit: 1.5 }, top: mat([80, 140, 90], [14, 40, 30]), trim: GREEN });
        z += 14;
        p.greens(u0 + 0.05, v0 + 0.05, u1 - 0.05, v1 - 0.05, z, 7);
      }
      p.lamp(1.4, 2.0, z + 8, WARM, 22);
      p.glow(1.4, 2.0, z, GREEN, 70, p.glowA() * 0.35);
      break;
    }
    default: {
      p.chamfer(0.9, 1.0, 1.9, 3.0, 0.2, z0, z0 + 36, HAB2, { win: W_HAB, top: ROOF_DARK, trim: p.pal.neon });
      p.antenna(1.4, 2.0, z0 + 36, 20);
    }
  }
}

/** Scaffold cage over a stage volume, with a crane while it rises. */
function scaffold(p: Painter, u0: number, v0: number, u1: number, v1: number, z0: number, z1: number) {
  const col = p.col(mat([214, 170, 70], [90, 70, 34]), 1, 0.9);
  // A half-built core inside the cage.
  const zc = z0 + (z1 - z0) * 0.35;
  p.box(u0 + 0.25, v0 + 0.25, u1 - 0.25, v1 - 0.25, z0, zc, mat([120, 120, 130]), { top: mat([110, 110, 120]), uplight: false });
  p.begin_();
  for (const [u, v] of [
    [u1, v0],
    [u1, v1],
    [u0, v1],
    [(u0 + u1) / 2, v1],
    [u1, (v0 + v1) / 2],
  ]) {
    p.m(u, v, z0);
    p.l(u, v, z1);
  }
  for (let z = z0 + 6; z <= z1; z += 7) {
    p.m(u0, v1, z);
    p.l(u1, v1, z);
    p.l(u1, v0, z);
  }
  for (let z = z0; z + 7 <= z1; z += 14) {
    p.m(u0, v1, z);
    p.l((u0 + u1) / 2, v1, z + 7);
    p.l(u1, v1, z);
    p.m(u1, v1, z);
    p.l(u1, (v0 + v1) / 2, z + 7);
    p.l(u1, v0, z);
  }
  if (p.g) {
    p.g.strokeStyle = col;
    p.g.lineWidth = 0.6;
    p.g.stroke();
  }
  // Tower crane at the back corner.
  const top = z1 + 26;
  const crane = p.col(mat([236, 196, 60], [110, 90, 40]), 1);
  p.begin_();
  p.m(u0 + 0.1, v0 + 0.1, z0);
  p.l(u0 + 0.1, v0 + 0.1, top);
  p.m(u0 - 0.6, v0 + 0.1, top);
  p.l(u1 + 0.4, v0 + 0.1, top);
  p.m(u1 - 0.3, v0 + 0.1, top);
  p.l(u1 - 0.3, v0 + 0.1, zc + 12);
  if (p.g) {
    p.g.strokeStyle = crane;
    p.g.lineWidth = 1.1;
    p.g.stroke();
  }
  p.blinker(u0 + 0.1, v0 + 0.1, top + 1, NEON.red, 1.2, 14);
  p.lamp((u0 + u1) / 2, (v0 + v1) / 2, zc + 6, WARM, 30);
  p.reach(top);
}

/**
 * Recipe for a Stratablock variant: `look` the crown's look (0..2, §6.2), `style` the district whose materials the
 * Plinth and Hab Core take (today's in Charter Shore), `banners` false while the crown's faction is Hostile.
 */
export function stackRecipe(variant: number, look = 0, style: DistrictKind = 'shore', banners = true): Recipe {
  const complete = variant & 3;
  const building = (variant & 4) !== 0;
  const crown = CROWN_IDS[(variant >> 3) & 7] ?? null;
  return (p) => {
    M = matsOf(style);
    p.box(0.04, 0.04, 3.96, 3.96, 0, 1.2, mat([92, 94, 106]), { uplight: false });
    if (complete >= 1) plinth(p);
    if (complete >= 2) habCore(p);
    if (complete >= 3) crownTop(p, crown, look, banners);
    M = TODAY;
    if (building) {
      if (complete === 0) scaffold(p, 0.12, 0.12, 3.88, 3.88, 1.2, 56);
      else if (complete === 1) scaffold(p, 0.6, 0.6, 3.4, 3.4, 56, 150);
      else if (complete === 2) scaffold(p, 0.8, 0.9, 2.0, 3.1, 150, 205);
    }
    // Offline / unpowered warning.
    const [x, y] = p.pt(2, 2, (STACK_Z[Math.min(3, complete)] ?? 56) + 6);
    p.addFx({ k: 'warn', x, y, ph: p.rng.next() });
    if (complete === 0 && !building) p.reach(20);
  };
}

// ── Live segments: shared colours ─────────────────────────────────────────

interface SegCols {
  nb: number;
  deck: string;
  deckSide: string;
  deckDead: string;
  pylon: string;
  pylonSide: string;
  tubeTop: string;
  tubeGlass: string;
  tubeDark: string;
  frame: string;
  /** Ribbon edge neon: live core, live glow, dead core. */
  liveCore: string;
  liveGlow: string;
  deadCore: string;
  train: string;
  trainDay: string;
}
let cols: SegCols | null = null;
function segCols(night: number): SegCols {
  const nb = Math.round(night * 8);
  if (cols && cols.nb === nb) return cols;
  const n = nb / 8;
  const k = (day: RGB, nite: RGB, a = 1) => css(mix(day, nite, n), a);
  cols = {
    nb,
    deck: k([150, 156, 170], [40, 44, 66]),
    deckSide: k([96, 100, 116], [20, 22, 38]),
    deckDead: k([118, 118, 126], [34, 34, 44]),
    pylon: k([132, 136, 150], [32, 34, 52]),
    pylonSide: k([92, 96, 110], [18, 20, 34]),
    tubeTop: k([170, 190, 210], [40, 52, 80], 0.95),
    tubeGlass: k([110, 150, 180], [16, 26, 50], 0.85),
    tubeDark: k([70, 74, 86], [12, 12, 20], 0.95),
    frame: k([190, 196, 210], [60, 64, 90]),
    liveCore: css(mix(mix([94, 242, 200], [150, 160, 170], 0.5), [94, 242, 200], Math.min(1, n * 1.4))),
    liveGlow: css([94, 242, 200], 0.26 * n),
    deadCore: css([120, 120, 140], 0.8),
    train: css([190, 255, 240], 0.95),
    trainDay: css([236, 240, 250], 0.9),
  };
  return cols;
}

const RIBBON_Z = 28;
const TRAIN: RGB = [190, 255, 240];
let trainGlow: HTMLCanvasElement | null = null;
const glowCache = new Map<RGB, HTMLCanvasElement>();
/** glowSprite with a per-colour-object cache (no key string per call). */
function glow32(c: RGB): HTMLCanvasElement {
  let g = glowCache.get(c);
  if (!g) {
    g = glowSprite(c, 32);
    glowCache.set(c, g);
  }
  return g;
}

/** World x of tile-space (u, v) relative to the tile top corner (wx, wy). */
const PX = (wx: number, u: number, v: number) => wx + (u - v) * HALF_W;
const PY = (wy: number, u: number, v: number, z: number) => wy + (u + v) * HALF_H - z;

/** Edge midpoints for N, E, S, W (rail mask bits 1, 2, 4, 8). */
const ARM_U = [0.5, 1, 0.5, 0];
const ARM_V = [0, 0.5, 1, 0.5];

export interface RailEnv {
  time: number;
  night: number;
  zoom: number;
  lod: boolean;
  quality: 'low' | 'high';
}

/**
 * One Ribbon Rail tile (tile top corner at world (wx, wy)): pylon (land only),
 * deck arms towards each connected neighbour, edge neon, and the moving light
 * trains on live lines. `seed` = x + y keeps trains continuous along the track.
 */
export function drawRailTile(ctx: CanvasRenderingContext2D, wx: number, wy: number, mask: number, live: boolean, land: boolean, seed: number, e: RailEnv, ghost = false): void {
  const c = segCols(e.night);
  const z = RIBBON_Z;
  const hw = 0.15;
  // Pylon.
  if (land && !ghost) {
    const x = PX(wx, 0.5, 0.5);
    const y0 = PY(wy, 0.5, 0.5, 0);
    ctx.fillStyle = c.pylonSide;
    ctx.fillRect(x - 2.2, y0 - z + 2, 2.2, z - 2);
    ctx.fillStyle = c.pylon;
    ctx.fillRect(x, y0 - z + 2, 2.2, z - 2);
    ctx.fillStyle = c.pylonSide;
    ctx.beginPath();
    ctx.moveTo(x - 6, y0 - z + 2);
    ctx.lineTo(x, y0 - z + 5);
    ctx.lineTo(x + 6, y0 - z + 2);
    ctx.lineTo(x, y0 - z - 1);
    ctx.closePath();
    ctx.fill();
  }
  // Deck: centre pad + arms (top face, then a 3 px side for depth).
  ctx.beginPath();
  const cx0 = 0.5 - hw;
  const cx1 = 0.5 + hw;
  quadTile(ctx, wx, wy, cx0, cx0, cx1, cx0, cx1, cx1, cx0, cx1, z);
  for (let d = 0; d < 4; d++) {
    if (!(mask & (1 << d))) continue;
    if (d === 0) quadTile(ctx, wx, wy, cx0, 0, cx1, 0, cx1, cx0, cx0, cx0, z);
    else if (d === 1) quadTile(ctx, wx, wy, cx1, cx0, 1, cx0, 1, cx1, cx1, cx1, z);
    else if (d === 2) quadTile(ctx, wx, wy, cx0, cx1, cx1, cx1, cx1, 1, cx0, 1, z);
    else quadTile(ctx, wx, wy, 0, cx0, cx0, cx0, cx0, cx1, 0, cx1, z);
  }
  if (ghost) {
    ctx.fillStyle = live ? 'rgba(60,255,170,0.45)' : 'rgba(255,60,90,0.5)';
    ctx.fill();
  } else {
    // Side faces (front-facing edges only): drop the top by 3 px.
    ctx.save();
    ctx.translate(0, 3);
    ctx.fillStyle = c.deckSide;
    ctx.fill();
    ctx.restore();
    ctx.fillStyle = live ? c.deck : c.deckDead;
    ctx.fill();
  }
  // Edge neon lines along each arm.
  const glowOn = e.night > 0.2 && !e.lod;
  ctx.lineCap = 'round';
  for (let pass = glowOn && live ? 0 : 1; pass < 2; pass++) {
    ctx.beginPath();
    for (let d = 0; d < 4; d++) {
      if (!(mask & (1 << d))) continue;
      const au = ARM_U[d];
      const av = ARM_V[d];
      // Two rails parallel to the arm, offset ±hw perpendicular to it.
      const du = d === 1 || d === 3 ? 0 : hw;
      const dv = d === 1 || d === 3 ? hw : 0;
      ctx.moveTo(PX(wx, 0.5 - du, 0.5 - dv), PY(wy, 0.5 - du, 0.5 - dv, z + 0.4));
      ctx.lineTo(PX(wx, au - du, av - dv), PY(wy, au - du, av - dv, z + 0.4));
      ctx.moveTo(PX(wx, 0.5 + du, 0.5 + dv), PY(wy, 0.5 + du, 0.5 + dv, z + 0.4));
      ctx.lineTo(PX(wx, au + du, av + dv), PY(wy, au + du, av + dv, z + 0.4));
    }
    if (pass === 0) {
      ctx.globalCompositeOperation = 'lighter';
      ctx.strokeStyle = c.liveGlow;
      ctx.lineWidth = 3.6;
      ctx.stroke();
      ctx.globalCompositeOperation = 'source-over';
    } else {
      ctx.strokeStyle = live ? c.liveCore : c.deadCore;
      ctx.lineWidth = e.lod ? 1.4 : 1;
      ctx.stroke();
    }
  }
  if (!live || ghost) return;
  // Trains: light pulses travelling along increasing x + y (continuous across tiles).
  const t = e.time * 0.55;
  for (let d = 0; d < 4; d++) {
    if (!(mask & (1 << d))) continue;
    const au = ARM_U[d];
    const av = ARM_V[d];
    // Position along the track in tiles: centre = seed, arm end = seed ± 0.5.
    const sgn = d === 1 || d === 2 ? 1 : -1;
    for (let s = 0.12; s < 0.5; s += 0.19) {
      const pos = seed + sgn * s;
      const ph = (((pos / 7 - t) % 1) + 1) % 1;
      if (ph > 0.14) continue;
      const k = 1 - ph / 0.14;
      const u = 0.5 + (au - 0.5) * (s / 0.5);
      const v = 0.5 + (av - 0.5) * (s / 0.5);
      const x = PX(wx, u, v);
      const y = PY(wy, u, v, z + 2);
      if (e.night > 0.25) {
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = Math.min(1, k * (0.4 + 0.6 * e.night));
        const g = (trainGlow ??= glowSprite(TRAIN, 32));
        ctx.drawImage(g, x - 9, y - 6, 18, 12);
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = 'source-over';
      }
      ctx.globalAlpha = e.night > 0.5 ? 0.25 + 0.75 * k : 1;
      ctx.fillStyle = e.night > 0.5 ? c.train : c.trainDay;
      ctx.fillRect(x - 2, y - 2.2, 4, 2.6);
      ctx.globalAlpha = 1;
    }
  }
}

function quadTile(ctx: CanvasRenderingContext2D, wx: number, wy: number, au: number, av: number, bu: number, bv: number, cu: number, cv: number, du: number, dv: number, z: number) {
  ctx.moveTo(PX(wx, au, av), PY(wy, au, av, z));
  ctx.lineTo(PX(wx, bu, bv), PY(wy, bu, bv, z));
  ctx.lineTo(PX(wx, cu, cv), PY(wy, cu, cv, z));
  ctx.lineTo(PX(wx, du, dv), PY(wy, du, dv, z));
  ctx.closePath();
}

const LINK_LIT: RGB = [143, 227, 255];
const MURAL: RGB = [201, 162, 255];

/**
 * Skybridge skins (MEGACITY §5.6): 0 glass, 1 truss box, 2 pearl ribbon, 3 civic arcade, 4 container chain, 5 cable
 * span, 6 lamp gallery, 7 its timber variant (Reedmere).
 */
export const SKIN_GLASS = 0;
export const SKIN_COUNT = 8;
const SKIN_NAMES: Record<string, number> = { plain: 0, glass: 0, basalt: 1, truss: 1, nacre: 2, pearl: 2, board: 3, arcade: 3, undertow: 4, container: 4, kites: 5, cable: 5, tuning: 6, lamp: 6, timber: 7 };
export function skinIndex(skin: SkybridgeSkin | number | undefined): number {
  if (typeof skin === 'number') return Math.max(0, Math.min(SKIN_COUNT - 1, skin | 0));
  return SKIN_NAMES[skin ?? 'plain'] ?? 0;
}

interface SkinCols {
  nb: number;
  face: string[];
  top: string[];
  frame: string[];
  light: RGB[];
}
let skinCols: SkinCols | null = null;
const SKIN_FACE: [RGB, RGB][] = [
  [[110, 150, 180], [16, 26, 50]],
  [[70, 66, 70], [14, 12, 18]],
  [[232, 214, 230], [52, 36, 60]],
  [[214, 212, 200], [44, 44, 52]],
  [[132, 84, 60], [30, 18, 16]],
  [[150, 150, 160], [30, 30, 40]],
  [[176, 130, 80], [36, 26, 20]],
  [[128, 104, 70], [28, 22, 18]],
];
const SKIN_TOP: [RGB, RGB][] = [
  [[170, 190, 210], [40, 52, 80]],
  [[96, 90, 92], [20, 18, 24]],
  [[246, 236, 246], [70, 52, 80]],
  [[160, 200, 220], [30, 44, 70]],
  [[60, 120, 140], [12, 26, 34]],
  [[120, 112, 104], [24, 22, 22]],
  [[184, 115, 51], [40, 24, 14]],
  [[96, 140, 90], [18, 34, 26]],
];
const SKIN_FRAME: [RGB, RGB][] = [
  [[230, 236, 246], [70, 76, 100]],
  [[255, 123, 46], [255, 123, 46]],
  [[255, 198, 241], [255, 198, 241]],
  [[240, 236, 224], [80, 78, 84]],
  [[182, 255, 46], [182, 255, 46]],
  [[40, 40, 48], [20, 20, 28]],
  [[90, 60, 36], [30, 20, 14]],
  [[90, 70, 46], [26, 20, 14]],
];
const SKIN_LIGHT: RGB[] = [LINK_LIT, [255, 150, 70], [255, 198, 241], [255, 220, 160], [182, 255, 46], [255, 214, 150], [255, 214, 140], [255, 214, 140]];
function skinColsOf(night: number): SkinCols {
  const nb = Math.round(night * 8);
  if (skinCols && skinCols.nb === nb) return skinCols;
  const n = nb / 8;
  const k = ([d, nn]: [RGB, RGB]) => css(mix(d, nn, n));
  skinCols = { nb, face: SKIN_FACE.map(k), top: SKIN_TOP.map(k), frame: SKIN_FRAME.map(([d, nn]) => css(mix(d, nn, n * 0.7))), light: SKIN_LIGHT };
  return skinCols;
}

/** Tube geometry (§5.6): 0.32 tile wide, 14 px tall, a 3 px floor slab. */
const TUBE_W0 = 0.34;
const TUBE_W1 = 0.66;
const TUBE_H = 14;

/**
 * One gap tile of a skybridge: a tube along `axisX` (true: along x / u) centred at height z, tile top corner at world
 * (wx, wy). `k` = position of the tile along the span 0..1 (walking lights, the cable sag), `skin` the §5.6 skin (0
 * glass by default), `walkers` 0..4 figures on this tile (zoom ≥ 0.6 only). `a0` / `a1` < 0 / > 1 reach into an anchor:
 * the end collar (and a red lamp on a dark bridge) sits there.
 */
export function drawSkybridgeTile(
  ctx: CanvasRenderingContext2D,
  wx: number,
  wy: number,
  axisX: boolean,
  z: number,
  active: boolean,
  mural: boolean,
  k: number,
  e: RailEnv,
  ghost: 0 | 1 | 2 = 0,
  a0 = 0,
  a1 = 1,
  skin: SkybridgeSkin | number = 0,
  walkers = 0,
): void {
  const c = segCols(e.night);
  const sk = skinIndex(skin);
  const w0 = TUBE_W0;
  const w1 = TUBE_W1;
  const cable = sk === 5;
  const sag = cable ? Math.sin(Math.max(0, Math.min(1, k)) * Math.PI) * 6 : 0;
  const h = cable ? 5 : TUBE_H;
  const zc = z - sag;
  const zb = zc - TUBE_H / 2;
  const zt = zb + h;
  // u along the axis, v across; map to tile space.
  const P = (a: number, b: number, zz: number): [number, number] => {
    const u = axisX ? a : b;
    const v = axisX ? b : a;
    return [PX(wx, u, v), PY(wy, u, v, zz)];
  };
  const face = (pa0: number, pb0: number, pa1: number, pb1: number, z0: number, z1: number) => {
    const p0 = P(pa0, pb0, z0);
    const p1 = P(pa1, pb1, z0);
    const p2 = P(pa1, pb1, z1);
    const p3 = P(pa0, pb0, z1);
    ctx.beginPath();
    ctx.moveTo(p0[0], p0[1]);
    ctx.lineTo(p1[0], p1[1]);
    ctx.lineTo(p2[0], p2[1]);
    ctx.lineTo(p3[0], p3[1]);
    ctx.closePath();
  };
  const topQuad = (zz: number) => {
    const t0 = P(a0, w0, zz);
    const t1 = P(a1, w0, zz);
    const t2 = P(a1, w1, zz);
    const t3 = P(a0, w1, zz);
    ctx.beginPath();
    ctx.moveTo(t0[0], t0[1]);
    ctx.lineTo(t1[0], t1[1]);
    ctx.lineTo(t2[0], t2[1]);
    ctx.lineTo(t3[0], t3[1]);
    ctx.closePath();
  };
  if (ghost) {
    face(a0, w1, a1, w1, zb, zb + TUBE_H);
    ctx.fillStyle = ghost === 1 ? 'rgba(60,255,170,0.5)' : 'rgba(255,60,90,0.55)';
    ctx.fill();
    topQuad(zb + TUBE_H);
    ctx.fill();
    return;
  }
  const sc = skinColsOf(e.night);
  const lit = active && e.night > 0.15;
  const light = mural ? MURAL : sc.light[sk];
  // Floor slab (3 px) under every skin.
  face(a0, w1, a1, w1, zb - 3, zb);
  ctx.fillStyle = c.deckSide;
  ctx.fill();
  topQuad(zb);
  ctx.fillStyle = c.deck;
  ctx.fill();
  if (cable) {
    // A light walkway hung on cables: posts at the ends, the two cables, diamond banners, string lights.
    ctx.strokeStyle = sc.frame[5];
    ctx.lineWidth = 0.6;
    ctx.beginPath();
    for (const b of [w0, w1]) {
      const q0 = P(a0, b, z + 8 - Math.sin(Math.max(0, k - 0.5 / 8) * Math.PI) * 6);
      const q1 = P(a1, b, z + 8 - Math.sin(Math.min(1, k + 0.5 / 8) * Math.PI) * 6);
      ctx.moveTo(q0[0], q0[1]);
      ctx.lineTo(q1[0], q1[1]);
    }
    for (const a of [0.25, 0.75]) {
      const q0 = P(a, w1, zb);
      const q1 = P(a, w1, z + 8 - sag);
      ctx.moveTo(q0[0], q0[1]);
      ctx.lineTo(q1[0], q1[1]);
    }
    ctx.stroke();
    if (!e.lod) {
      const bp = P(0.5, w1, zb + 6);
      ctx.fillStyle = css(mix([201, 162, 255], [120, 90, 170], e.night));
      ctx.beginPath();
      ctx.moveTo(bp[0], bp[1] - 3);
      ctx.lineTo(bp[0] + 2, bp[1]);
      ctx.lineTo(bp[0], bp[1] + 3);
      ctx.lineTo(bp[0] - 2, bp[1]);
      ctx.closePath();
      ctx.fill();
    }
  } else {
    // The tube body: front face (towards +v), then its roof.
    face(a0, w1, a1, w1, zb, zt);
    if (!active) ctx.fillStyle = c.tubeDark;
    else if (sk === 2) {
      const pTop = P((a0 + a1) / 2, w1, zt);
      const pBot = P((a0 + a1) / 2, w1, zb);
      const g = ctx.createLinearGradient(0, pTop[1], 0, pBot[1]);
      g.addColorStop(0, sc.top[2]);
      g.addColorStop(1, sc.face[2]);
      ctx.fillStyle = g;
    } else ctx.fillStyle = sk === 0 ? c.tubeGlass : sc.face[sk];
    ctx.fill();
    topQuad(zt);
    ctx.fillStyle = active ? (sk === 0 ? c.tubeTop : sc.top[sk]) : c.tubeDark;
    ctx.fill();
    // Skin detail on the face.
    ctx.strokeStyle = active ? sc.frame[sk] : c.frame;
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    const b0 = P(a0, w1, zb);
    const b1 = P(a1, w1, zb);
    const t3 = P(a0, w1, zt);
    const t2 = P(a1, w1, zt);
    ctx.moveTo(b0[0], b0[1]);
    ctx.lineTo(b1[0], b1[1]);
    ctx.moveTo(t3[0], t3[1]);
    ctx.lineTo(t2[0], t2[1]);
    if (sk === 0 || sk === 6 || sk === 7) {
      // Mullions every 0.25 tile (glass) or timber posts (gallery).
      for (const a of [0, 0.25, 0.5, 0.75]) {
        const q0 = P(a, w1, zb);
        const q1 = P(a, w1, zt);
        ctx.moveTo(q0[0], q0[1]);
        ctx.lineTo(q1[0], q1[1]);
      }
    } else if (sk === 1) {
      // X-bracing.
      for (const [x0, x1] of [
        [0, 0.5],
        [0.5, 1],
      ]) {
        const q0 = P(x0, w1, zb);
        const q1 = P(x1, w1, zt);
        const q2 = P(x0, w1, zt);
        const q3 = P(x1, w1, zb);
        ctx.moveTo(q0[0], q0[1]);
        ctx.lineTo(q1[0], q1[1]);
        ctx.moveTo(q2[0], q2[1]);
        ctx.lineTo(q3[0], q3[1]);
      }
    }
    ctx.stroke();
    if (sk === 3 && !e.lod) {
      // Civic arcade: three stone arches with warm windows.
      for (const a of [0.17, 0.5, 0.83]) {
        const q = P(a, w1, zb + 1);
        const r = 3.2;
        ctx.beginPath();
        ctx.moveTo(q[0] - r, q[1]);
        ctx.lineTo(q[0] - r, q[1] - 6);
        ctx.arc(q[0], q[1] - 6, r, Math.PI, 0);
        ctx.lineTo(q[0] + r, q[1]);
        ctx.closePath();
        ctx.fillStyle = active && e.night > 0.2 ? css(mix([40, 34, 30], [255, 220, 160], 0.4 + 0.5 * e.night)) : 'rgba(60,62,74,0.9)';
        ctx.fill();
      }
      if (k > 0.4 && k < 0.6) {
        const f = P(0.5, (w0 + w1) / 2, zt);
        ctx.strokeStyle = 'rgba(200,200,210,0.9)';
        ctx.beginPath();
        ctx.moveTo(f[0], f[1]);
        ctx.lineTo(f[0], f[1] - 7);
        ctx.stroke();
        ctx.fillStyle = css([80, 140, 255]);
        ctx.fillRect(f[0], f[1] - 7, 4, 2.5);
      }
    } else if (sk === 4 && !e.lod) {
      // Container chain: each tile a container, cut windows, a net and a green lamp underneath.
      const alt = Math.round(k * 16) % 2 === 0;
      face(0.06, w1, 0.94, w1, zb + 0.5, zt - 0.5);
      ctx.fillStyle = active ? css(mix(alt ? [132, 84, 60] : [60, 120, 140], alt ? [30, 18, 16] : [12, 26, 34], e.night)) : c.tubeDark;
      ctx.fill();
      for (const a of [0.3, 0.7]) {
        face(a - 0.08, w1, a + 0.08, w1, zb + 4, zt - 4);
        ctx.fillStyle = lit ? css(mix([40, 50, 30], [182, 255, 46], 0.5 * e.night)) : 'rgba(30,32,40,0.9)';
        ctx.fill();
      }
      const nq = P(0.5, w1, zb - 3);
      ctx.strokeStyle = 'rgba(150,150,146,0.6)';
      ctx.beginPath();
      ctx.moveTo(nq[0] - 8, nq[1]);
      ctx.quadraticCurveTo(nq[0], nq[1] + 5, nq[0] + 8, nq[1]);
      ctx.stroke();
      if (lit && Math.round(k * 8) % 2 === 0) {
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = 0.8 * e.night;
        ctx.drawImage(glow32([182, 255, 46]), nq[0] - 5, nq[1] + 1, 10, 10);
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = 'source-over';
      }
    }
  }
  // End collar where the tube meets a facade.
  if (a0 < 0 || a1 > 1) {
    const ea = a0 < 0 ? a0 : a1;
    const q0 = P(ea, w1 + 0.03, zb - 3);
    const q1 = P(ea, w1 + 0.03, zt + 1);
    ctx.strokeStyle = active ? sc.frame[sk] : c.frame;
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(q0[0], q0[1]);
    ctx.lineTo(q1[0], q1[1]);
    ctx.stroke();
    if (!active) {
      // A dark bridge: a red lamp at each end.
      const r = P(ea, w1, zt);
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.5 + 0.5 * e.night;
      ctx.drawImage(glow32([255, 59, 92]), r[0] - 4, r[1] - 4, 8, 8);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    }
  }
  if (!active) return;
  // Walkers (§5.6): tiny figures on the floor strip by day, moving light dots by night; zoom ≥ 0.6 only.
  const nW = Math.max(0, Math.min(4, walkers | 0));
  if (nW > 0 && e.zoom >= 0.6 && !e.lod) {
    for (let i = 0; i < nW; i++) {
      const dir = i % 2 ? 1 : -1;
      const a = (((k * 3 + i * 0.37 + dir * e.time * 0.12) % 1) + 1) % 1;
      const q = P(a, w1 - 0.06, zb + 0.5);
      if (e.night > 0.45) {
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = 0.8 * e.night;
        ctx.drawImage(glow32(light), q[0] - 3, q[1] - 4, 6, 6);
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = 'source-over';
      } else {
        ctx.fillStyle = i % 3 === 0 ? 'rgba(60,50,70,0.95)' : i % 3 === 1 ? 'rgba(200,80,90,0.95)' : 'rgba(40,90,140,0.95)';
        ctx.fillRect(q[0] - 1, q[1] - 3, 2, 3);
      }
    }
  }
  if (!lit) return;
  // Lit interior glowing through, roof edge neon, the floor strip and the walking lights.
  ctx.globalCompositeOperation = 'lighter';
  if (!cable) {
    face(a0, w1, a1, w1, zb, zt);
    ctx.fillStyle = css(light, (sk === 2 ? 0.28 : 0.2) * e.night);
    ctx.fill();
    const t3 = P(a0, w1, zt);
    const t2 = P(a1, w1, zt);
    ctx.strokeStyle = css(light, 0.7 * e.night);
    ctx.lineWidth = sk === 2 ? 1.4 : 0.8;
    ctx.beginPath();
    ctx.moveTo(t3[0], t3[1]);
    ctx.lineTo(t2[0], t2[1]);
    ctx.stroke();
  }
  const f0 = P(a0, w1, zb + 1);
  const f1 = P(a1, w1, zb + 1);
  ctx.strokeStyle = css(light, 0.55 * e.night);
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(f0[0], f0[1]);
  ctx.lineTo(f1[0], f1[1]);
  ctx.stroke();
  if (!e.lod) {
    const g = glow32(light);
    if (sk === 5 || sk === 6 || sk === 7) {
      // String lights (cable) or hanging lanterns (gallery) along the span.
      for (const a of [0.15, 0.5, 0.85]) {
        const q = P(a, w1, sk === 5 ? z + 6 - sag : zt - 3);
        ctx.globalAlpha = 0.85 * e.night;
        ctx.drawImage(g, q[0] - 4, q[1] - 4, 8, 8);
      }
    } else if (nW === 0) {
      for (let i = 0; i < 3; i++) {
        const a = (((k + i / 3 + e.time * 0.18 * (i % 2 ? 1 : -1)) % 1) + 1) % 1;
        const pnt = P(a, w1 - 0.02, zb + 6.5);
        ctx.globalAlpha = 0.7 * e.night;
        ctx.drawImage(g, pnt[0] - 4, pnt[1] - 4, 8, 8);
      }
    }
    if (sk === 2) {
      // Pearl ribbon: a soft halo glow at night.
      const q = P(0.5, (w0 + w1) / 2, zc);
      ctx.globalAlpha = 0.35 * e.night;
      ctx.drawImage(g, q[0] - 22, q[1] - 12, 44, 24);
    }
    if (mural) {
      // Kite-wing glow paint on the roof.
      const m0 = P(0.15, (w0 + w1) / 2, zt);
      const m1 = P(0.5, w0, zt);
      const m2 = P(0.85, (w0 + w1) / 2, zt);
      ctx.globalAlpha = 0.8 * e.night;
      ctx.strokeStyle = css(MURAL, 0.9);
      ctx.lineWidth = 0.9;
      ctx.beginPath();
      ctx.moveTo(m0[0], m0[1]);
      ctx.lineTo(m1[0], m1[1]);
      ctx.lineTo(m2[0], m2[1]);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }
  ctx.globalCompositeOperation = 'source-over';
}

// ── Skybridges v2 (MEGACITY §5.6): the frozen span draw call (Step 0b); WP-4 draws the tubes, skins and walkers. ──

/** One skybridge span in world px: anchor tiles, gap and the tube's top (heights.ts roofOf − SKYBRIDGE.tubeBelowRoof). */
export interface SkybridgeSpan {
  ax: number;
  ay: number;
  bx: number;
  by: number;
  gap: number;
  /** Tube top above the ground, world px. */
  top: number;
  /** Lit (both anchors tall and powered) or dark. */
  active: boolean;
}

/** A span's skin: the builder faction or the district style that dresses the tube (§5.6). */
export type SkybridgeSkin = 'plain' | 'basalt' | 'nacre' | 'board' | 'undertow' | 'kites' | 'tuning' | string;

/**
 * Draw a whole skybridge span (WP-4): every gap tile back to front with its skin, the tube top at `span.top`. The sweep
 * draws bridges tile by tile at each tile's depth (render/story.ts) with drawSkybridgeTile; this whole-span call is
 * for previews, thumbnails and tests.
 */
export function drawSkybridgeSpan(ctx: CanvasRenderingContext2D, span: SkybridgeSpan, skin: SkybridgeSkin, env: ArtEnv): void {
  const axisX = span.ay === span.by;
  const flip = axisX ? span.bx < span.ax : span.by < span.ay;
  const ax = flip ? span.bx : span.ax;
  const ay = flip ? span.by : span.ay;
  const n = Math.max(1, span.gap + 1);
  const e: RailEnv = { time: env.time, night: env.night, zoom: env.zoom, lod: env.zoom < 0.55, quality: env.quality };
  const zc = span.top - TUBE_H / 2;
  for (let k = 1; k < n; k++) {
    const x = axisX ? ax + k : ax;
    const y = axisX ? ay : ay + k;
    drawSkybridgeTile(ctx, (x - y) * HALF_W, (x + y) * HALF_H, axisX, zc, span.active, false, k / n, e, 0, k === 1 ? -0.1 : 0, k === n - 1 ? 1.1 : 1, skin, 0);
  }
}

/** Minimal views of the world skinOf reads (render code passes the World). */
interface SkinWorld {
  tileAt(x: number, y: number): { buildingId: number } | undefined | null;
  buildings: Map<number, { type: string; crown?: string; sponsor?: string }>;
  kindAt(x: number, y: number): DistrictKind;
}
const CROWN_SKIN: Record<string, number> = { foundry: 1, glare: 2, commons: 3, salvage: 4, nest: 5, lamp: 6 };
const FACTION_TYPE_SKIN: Record<string, number> = {
  foundry: 1,
  hexworks: 1,
  gantry: 1,
  glarewall: 2,
  pearlatrium: 2,
  glasssmile: 2,
  commons: 3,
  charterhall: 3,
  recordtower: 3,
  tidemarket: 4,
  hullhouse: 4,
  roost: 5,
  kitemast: 5,
  lampchoir: 6,
};
const STYLE_SKIN: Partial<Record<DistrictKind, number>> = { flats: 1, tarmac: 1, sunk: 4, skeleton: 5, bazaar: 5, reedmere: 7 };

/**
 * A skybridge's skin (§5.6), first that applies: a faction crown on either end; a faction exclusive building or
 * landmark; a Spire's sponsor; the lower anchor's district style; glass. `lowerEnd` 0 / 1 names the lower anchor.
 */
export function skinOf(world: SkinWorld, l: { ax: number; ay: number; bx: number; by: number }, lowerEnd: 0 | 1 = 0): number {
  const ends: [number, number][] = [
    [l.ax, l.ay],
    [l.bx, l.by],
  ];
  const bld = ends.map(([x, y]) => {
    const t = world.tileAt(x, y);
    return t && t.buildingId >= 0 ? world.buildings.get(t.buildingId) ?? null : null;
  });
  for (const b of bld) if (b && b.type === 'stack' && b.crown && CROWN_SKIN[b.crown] !== undefined) return CROWN_SKIN[b.crown];
  for (const b of bld) if (b && FACTION_TYPE_SKIN[b.type] !== undefined) return FACTION_TYPE_SKIN[b.type];
  for (const b of bld) if (b && b.type === 'spire') return (b.sponsor ?? 'nacre') === 'basalt' ? 1 : (b.sponsor ?? 'nacre') === 'nacre' ? 2 : 0;
  const [x, y] = ends[lowerEnd];
  return STYLE_SKIN[world.kindAt(x, y)] ?? SKIN_GLASS;
}
