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
import { HALF_H, HALF_W } from '../camera';
import { NEON, css, glowSprite, mix, type RGB } from '../palette';
import { mat, type ArtPal, type Mat, type Painter, type WinSpec } from './painter';
import type { Recipe } from './zones';

// ── Stratablock recipes ───────────────────────────────────────────────────

export const STACK_PAL: ArtPal = { neon: [169, 184, 255], neon2: NEON.cyan, up: [130, 140, 255], warm: 0.55, cool: 0.3 };

const CROWN_IDS: (CrownId | null)[] = [null, 'foundry', 'glare', 'nest', 'commons'];
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

function plinth(p: Painter) {
  const N = p.pal.neon;
  const N2 = p.pal.neon2;
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

function crownTop(p: Painter, crown: CrownId | null) {
  const z0 = 150;
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

/** Recipe for a Stratablock variant. */
export function stackRecipe(variant: number): Recipe {
  const complete = variant & 3;
  const building = (variant & 4) !== 0;
  const crown = CROWN_IDS[(variant >> 3) & 7] ?? null;
  return (p) => {
    p.box(0.04, 0.04, 3.96, 3.96, 0, 1.2, mat([92, 94, 106]), { uplight: false });
    if (complete >= 1) plinth(p);
    if (complete >= 2) habCore(p);
    if (complete >= 3) crownTop(p, crown);
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
 * One gap tile of a skybridge: a glass tube along `axisX` (true: along x / u) at
 * height z, tile top corner at world (wx, wy). `k` = index of the tile along
 * the span (walking lights move along it).
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
): void {
  const c = segCols(e.night);
  const w0 = 0.38;
  const w1 = 0.62;
  const h = 8;
  // u along the axis, v across; map to tile space.
  const P = (a: number, b: number, zz: number): [number, number] => {
    const u = axisX ? a : b;
    const v = axisX ? b : a;
    return [PX(wx, u, v), PY(wy, u, v, zz)];
  };
  const face = (a0: number, b0: number, a1: number, b1: number, z0: number, z1: number) => {
    const p0 = P(a0, b0, z0);
    const p1 = P(a1, b1, z0);
    const p2 = P(a1, b1, z1);
    const p3 = P(a0, b0, z1);
    ctx.beginPath();
    ctx.moveTo(p0[0], p0[1]);
    ctx.lineTo(p1[0], p1[1]);
    ctx.lineTo(p2[0], p2[1]);
    ctx.lineTo(p3[0], p3[1]);
    ctx.closePath();
  };
  if (ghost) {
    face(a0, w1, a1, w1, z - h / 2, z + h / 2);
    ctx.fillStyle = ghost === 1 ? 'rgba(60,255,170,0.5)' : 'rgba(255,60,90,0.55)';
    ctx.fill();
    const t0 = P(a0, w0, z + h / 2);
    const t1 = P(a1, w0, z + h / 2);
    const t2 = P(a1, w1, z + h / 2);
    const t3 = P(a0, w1, z + h / 2);
    ctx.beginPath();
    ctx.moveTo(t0[0], t0[1]);
    ctx.lineTo(t1[0], t1[1]);
    ctx.lineTo(t2[0], t2[1]);
    ctx.lineTo(t3[0], t3[1]);
    ctx.closePath();
    ctx.fill();
    return;
  }
  const lit = active && e.night > 0.15;
  // Front glass face (towards +v), then the roof.
  face(a0, w1, a1, w1, z - h / 2, z + h / 2);
  ctx.fillStyle = active ? c.tubeGlass : c.tubeDark;
  ctx.fill();
  const t0 = P(a0, w0, z + h / 2);
  const t1 = P(a1, w0, z + h / 2);
  const t2 = P(a1, w1, z + h / 2);
  const t3 = P(a0, w1, z + h / 2);
  ctx.beginPath();
  ctx.moveTo(t0[0], t0[1]);
  ctx.lineTo(t1[0], t1[1]);
  ctx.lineTo(t2[0], t2[1]);
  ctx.lineTo(t3[0], t3[1]);
  ctx.closePath();
  ctx.fillStyle = active ? c.tubeTop : c.tubeDark;
  ctx.fill();
  // Frame lines (bottom + roof edges) and ribs.
  const b0 = P(a0, w1, z - h / 2);
  const b1 = P(a1, w1, z - h / 2);
  ctx.beginPath();
  ctx.moveTo(b0[0], b0[1]);
  ctx.lineTo(b1[0], b1[1]);
  ctx.moveTo(t3[0], t3[1]);
  ctx.lineTo(t2[0], t2[1]);
  for (const a of [0.25, 0.75]) {
    const q0 = P(a, w1, z - h / 2);
    const q1 = P(a, w1, z + h / 2);
    ctx.moveTo(q0[0], q0[1]);
    ctx.lineTo(q1[0], q1[1]);
  }
  ctx.strokeStyle = c.frame;
  ctx.lineWidth = 0.5;
  ctx.stroke();
  if (!lit) return;
  const col = mural ? MURAL : LINK_LIT;
  // Lit interior glowing through the glass, roof edge neon, floor strip, walking lights.
  ctx.globalCompositeOperation = 'lighter';
  face(a0, w1, a1, w1, z - h / 2, z + h / 2);
  ctx.fillStyle = css(col, 0.2 * e.night);
  ctx.fill();
  ctx.strokeStyle = css(col, 0.7 * e.night);
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  ctx.moveTo(t3[0], t3[1]);
  ctx.lineTo(t2[0], t2[1]);
  ctx.stroke();
  const f0 = P(a0, w1, z - h / 2 + 1);
  const f1 = P(a1, w1, z - h / 2 + 1);
  ctx.strokeStyle = css(col, 0.55 * e.night);
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(f0[0], f0[1]);
  ctx.lineTo(f1[0], f1[1]);
  ctx.stroke();
  if (!e.lod) {
    const g = glow32(col);
    for (let i = 0; i < 3; i++) {
      const a = (((k + i / 3 + e.time * 0.18 * (i % 2 ? 1 : -1)) % 1) + 1) % 1;
      const pnt = P(a, w1 - 0.02, z - 0.5);
      ctx.globalAlpha = 0.7 * e.night;
      ctx.drawImage(g, pnt[0] - 4, pnt[1] - 4, 8, 8);
    }
    if (mural) {
      // Kite-wing glow paint on the roof.
      const m0 = P(0.15, (w0 + w1) / 2, z + h / 2);
      const m1 = P(0.5, w0, z + h / 2);
      const m2 = P(0.85, (w0 + w1) / 2, z + h / 2);
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

