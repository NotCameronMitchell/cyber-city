// ─────────────────────────────────────────────────────────────────────────────
// Choices that last, the art (docs/MEGACITY.md §9.2): the five ending landmarks
// with their "past" looks, and the skyline takeover's tower bodies.
//
// Ending landmarks: Foreman's Gantry (Ironwork), The Glass Smile (Pearlescence),
// Bread Pier (The Low Crown), Record Tower (Open Ledger), The Still Square (The
// Quiet Hand; the Lamp Square under Lamplight). Each wakes while its ending is
// current and keeps a dormant "past" look after a Charter Review changes it:
// the quota board dark, the smile screen off, the stalls shuttered, the ledger
// frozen, the scales still level.
//
// Takeover bodies (`marks.skylineLang` picks the language per tower): per
// language a Hab L3 single, a Market L3 single and an L3 quad body (15 bodies),
// plus the Lamplight lantern roof (a roof variant on Hab L2–L3, not a body).
// Each body's mass reaches the tile's height truth T like every kit body.
// ─────────────────────────────────────────────────────────────────────────────

import type { EndingId } from '../../game/story/types';
import { NEON, css, type RGB } from '../palette';
import { antennaForest, charterBlock, crucible, FACTION_PALS, gantrySpine, haloAtrium, hexColumn, hullStack, netLoft, openBelfry, pearlDrop, ribbonTwins, ropeRoost, sailCanopy, spiral, steppedTower, craneHab, buttressHall, type Design } from './faction';
import { mat, type ArtPal, type Mat, type Painter, type Roof, type WinSpec } from './painter';
import { ball, crane, lampString, lanternRoof, lattice, pole, sail } from './parts';
import type { Recipe } from './zones';

const PAD = mat([96, 98, 110]);
const STEEL = mat([140, 144, 152]);
const DARK = mat([72, 70, 84]);
const STONE = mat([214, 214, 206], [44, 44, 52]);
const PEARL = mat([232, 226, 236], [46, 40, 56]);
const YELLOW = mat([230, 190, 40], [60, 46, 14]);
const W_GRID: WinSpec = { style: 'grid', floor: 7, col: 6, w: 0.55, h: 0.5 };

function slab(p: Painter, s: number, m: Mat = PAD, z = 1.2) {
  p.box(0.04, 0.04, s - 0.04, s - 0.04, 0, z, m, { uplight: false });
}
function warn(p: Painter, u: number, v: number, z: number) {
  const [x, y] = p.pt(u, v, z);
  p.addFx({ k: 'warn', x, y, ph: p.rng.next() });
  p.track(x - 9, y - 9);
}

/** The ending each landmark belongs to. */
export const LANDMARK_ENDING: Record<string, EndingId> = { gantry: 'ironwork', glasssmile: 'pearl', breadpier: 'lowcrown', recordtower: 'ledger', stillsquare: 'quiet' };

// ════════════════════════════════════════════════════════════════════════════
// ENDING LANDMARKS (variant 0 current, 1 past; the Still Square 2 = the Lamp Square)
// ════════════════════════════════════════════════════════════════════════════

/** Foreman's Gantry: a colossal gantry crane over a works yard; its cab is a lit quota board, one window never lights. */
function gantry(past: boolean): Recipe {
  return (p) => {
    slab(p, 4, mat([90, 86, 80]), 1.2);
    // The works yard under it.
    for (let i = 0; i < 3; i++) p.box(0.5 + i * 1.05, 1.2, 1.3 + i * 1.05, 2.8, 1.2, 14 + i * 3, mat([70, 66, 70], [16, 14, 18]), { win: { style: 'slit', floor: 9, col: 7, w: 0.3, h: 0.55 }, top: mat([120, 80, 60]) });
    for (let i = 0; i < 3; i++) p.container(0.6 + i * 1.0, 3.2, 1.4 + i * 1.0, 3.6, 1.2, 8, [[150, 70, 58], [56, 110, 116], [166, 128, 60]][i] as RGB);
    // Four legs and the girder.
    const top = 150;
    for (const [u, v] of [
      [0.15, 0.3],
      [3.75, 0.3],
      [0.15, 3.7],
      [3.75, 3.7],
    ] as const)
      lattice(p, u, v - 0.1, u + 0.12, v + 0.02, 1.2, top, YELLOW, 12, 0.9);
    p.box(0.1, 0.18, 3.9, 0.42, top, top + 10, YELLOW, { uplight: false });
    p.box(0.1, 3.58, 3.9, 3.82, top, top + 10, YELLOW, { uplight: false });
    p.box(0.1, 0.18, 0.4, 3.82, top, top + 8, YELLOW, { uplight: false });
    p.box(3.6, 0.18, 3.9, 3.82, top, top + 8, YELLOW, { uplight: false });
    // The cab: the quota board (a live ticker), one window that never lights.
    p.box(1.4, 3.3, 2.6, 3.82, top - 26, top, mat([60, 60, 70], [14, 14, 22]), { top: DARK });
    if (!past) {
      p.ticker(1.4, 3.82, 2.6, 3.82, 0.08, 0.92, top - 22, top - 10, [255, 123, 46]);
      p.glow(2, 3.82, top - 16, [255, 123, 46], 70, p.glowA() * 0.7);
    } else p.wallSign(1.4, 3.82, 2.6, 3.82, 0.08, 0.92, top - 22, top - 10, [90, 80, 70], false);
    p.door(1.4, 3.82, 2.6, 3.82, 0.8, 0.9, top - 8, top - 3, null);
    // Hoist and hook over the yard.
    pole(p, 2.4, 2.0, 60, top, mat([60, 60, 60]), 0.5);
    p.box(2.35, 1.95, 2.45, 2.05, 56, 60, YELLOW, { uplight: false });
    p.blinker(0.2, 0.3, top + 12, NEON.red, 1.4, 14);
    p.blinker(3.8, 3.7, top + 12, NEON.red, 1.8, 14);
    if (!past) {
      const [x, y] = p.pt(3.0, 1.6, 30);
      p.addFx({ k: 'smoke', x, y, r: 12, ph: p.rng.next() });
    }
    warn(p, 2, 2, 40);
  };
}

/** The Glass Smile: a pearl sphere on a slim stem; by night its face is one screen showing MOTH's smile. */
function glasssmile(past: boolean): Recipe {
  return (p) => {
    slab(p, 3, mat([200, 190, 206], [40, 30, 50]), 1.2);
    p.cyl(1.5, 1.5, 0.9, 1.2, 10, PEARL, mat([214, 176, 206], [40, 26, 48]), 0.6);
    p.cyl(1.5, 1.5, 0.14, 10, 120, PEARL, PEARL, 0.1);
    p.neon([1.64, 1.5, 12, 1.6, 1.5, 118], [255, 198, 241], 0.8);
    // The sphere.
    const R = 0.85;
    const z = 120 + R * 45;
    ball(p, 1.5, 1.5, z, R, past ? mat([170, 166, 176], [30, 28, 36]) : PEARL);
    if (!past) {
      const [x, y] = p.pt(1.5, 1.5, z);
      p.addSig({ k: 'smile', x, y, r: R * 45, c: [255, 198, 241] });
      p.glow(1.5, 1.5, z, [255, 198, 241], 160, p.glowA() * 0.45);
    }
    p.neonRing(1.5, 1.5, 0.9, 10, [255, 198, 241], 1.2, true);
    p.reach(z + R * 45);
    warn(p, 1.5, 1.5, 20);
  };
}

/** Bread Pier: a long pier market under one canopy, half nets and green lamps, half kites and string lights, one long table. */
function breadpier(past: boolean): Recipe {
  return (p) => {
    // Pier deck on piles.
    for (let i = 0; i <= 8; i++) for (const v of [0.4, 3.6]) p.box(0.2 + i * 0.45, v - 0.04, 0.26 + i * 0.45, v + 0.04, 0, 4, mat([96, 80, 62], [20, 16, 16]), { uplight: false });
    p.box(0.1, 0.3, 3.9, 3.7, 3, 4.5, mat([150, 124, 92], [30, 24, 22]), { uplight: false });
    // The one long table.
    p.box(0.4, 1.9, 3.6, 2.1, 4.5, 7, mat([120, 90, 60], [26, 20, 16]), { uplight: false });
    // Stalls on both sides; shuttered when past.
    for (let i = 0; i < 6; i++) {
      const u = 0.35 + i * 0.55;
      const undertow = i < 3;
      p.box(u, 0.5, u + 0.42, 1.2, 4.5, 14, undertow ? mat([132, 84, 60], [30, 18, 16]) : mat([150, 140, 180], [30, 28, 42]), { top: DARK });
      p.door(u, 1.2, u + 0.42, 1.2, 0.1, 0.9, 4.5, 11, past ? null : undertow ? [182, 255, 46] : [255, 214, 150]);
      p.box(u, 2.8, u + 0.42, 3.5, 4.5, 14, undertow ? mat([56, 92, 80], [12, 22, 22]) : mat([201, 162, 255], [40, 30, 56]), { top: DARK });
    }
    // The canopy: a long shallow roof on posts.
    for (let i = 0; i <= 4; i++) for (const v of [0.45, 3.55]) pole(p, 0.2 + i * 0.9, v, 4.5, 24, mat([120, 110, 100]), 0.8);
    p.shed(0.1, 0.4, 3.9, 3.6, 24, 4, mat([200, 196, 186], [40, 38, 44]), 'v');
    if (!past) {
      lampString(p, [0.2, 3.6, 22], [1.9, 3.6, 22], 8, [182, 255, 46], 3, 8);
      lampString(p, [2.0, 3.6, 22], [3.8, 3.6, 22], 8, [255, 214, 150], 3, 8);
      p.laundry(0.3, 0.42, 1.7, 0.42, 18);
      sail(p, 3.4, 0.3, 40, 0.4, 16, mat([201, 162, 255], [40, 30, 56]), [201, 162, 255]);
      sail(p, 2.8, 0.2, 48, 0.3, 12, mat([236, 236, 246], [52, 50, 70]), [201, 162, 255]);
    }
    warn(p, 2, 2, 30);
  };
}

/** Record Tower: a stone tower whose faces scroll the city's accounts, a public reading hall at its foot. */
function recordtower(past: boolean): Recipe {
  return (p) => {
    slab(p, 3, mat([190, 190, 182], [40, 40, 48]), 1.2);
    // The reading hall.
    p.box(0.1, 1.8, 2.9, 2.9, 1.2, 18, STONE, { win: { style: 'grid', floor: 9, col: 7, w: 0.6, h: 0.65, lit: 1.6 }, top: mat([120, 180, 160], [22, 40, 40]) });
    for (let i = 0; i < 7; i++) p.box(0.25 + i * 0.4, 2.88, 0.29 + i * 0.4, 2.94, 1.2, 16, STONE, { uplight: false });
    p.door(0.1, 2.9, 2.9, 2.9, 0.44, 0.56, 1.2, 12, [255, 220, 160]);
    // The tower.
    p.box(0.6, 0.4, 2.4, 1.8, 1.2, 180, STONE, { win: { style: 'slit', floor: 10, col: 8, w: 0.3, h: 0.6, lit: 1.3 }, top: mat([96, 104, 120]) });
    // Ledger faces on the two visible sides.
    const lines: [number, number, number, number][] = [
      [0.6, 1.8, 2.4, 1.8],
      [2.4, 0.4, 2.4, 1.8],
    ];
    for (const [au, av, bu, bv] of lines) {
      p.begin_();
      p.quad(au + (bu - au) * 0.1, av + (bv - av) * 0.1, 60, au + (bu - au) * 0.9, av + (bv - av) * 0.9, 60, au + (bu - au) * 0.9, av + (bv - av) * 0.9, 168, au + (bu - au) * 0.1, av + (bv - av) * 0.1, 168);
      p.fill(p.col(mat([20, 24, 34], [6, 8, 14]), 0.9));
      const [ox, oy] = p.pt(au + (bu - au) * 0.1, av + (bv - av) * 0.1, 60);
      const [x1, y1] = p.pt(au + (bu - au) * 0.9, av + (bv - av) * 0.9, 60);
      p.addSig({ k: 'ledger', ox, oy, ex: x1 - ox, ey: y1 - oy, h: 108, c: [150, 220, 255], frozen: past });
      // Static lines baked in (what far zoom and low quality show; the live fx scrolls over them).
      const g = p.g;
      if (g) {
        g.fillStyle = css(p.emissive([150, 220, 255], 0.3), past ? 0.35 : 0.7);
        for (let r = 0; r < 14; r++)
          for (let c = 0; c < 4; c++) {
            const t0 = 0.14 + c * 0.19 + ((r * 7 + c * 3) % 5) * 0.01;
            const t1 = t0 + 0.08 + ((r + c) % 3) * 0.03;
            const z = 64 + r * 7.4;
            const [xa, ya] = p.pt(au + (bu - au) * t0, av + (bv - av) * t0, z);
            const [xb, yb] = p.pt(au + (bu - au) * t1, av + (bv - av) * t1, z);
            g.beginPath();
            g.moveTo(xa, ya);
            g.lineTo(xb, yb);
            g.lineTo(xb, yb - 1.6);
            g.lineTo(xa, ya - 1.6);
            g.closePath();
            g.fill();
          }
      }
    }
    p.box(0.8, 0.6, 2.2, 1.6, 180, 194, mat([96, 104, 120], [20, 22, 32]), { top: mat([120, 180, 160]) });
    pole(p, 1.5, 1.1, 194, 214, STEEL, 0.8);
    p.lamp(1.5, 1.1, 214, [255, 220, 160], 12);
    warn(p, 1.5, 1.1, 40);
  };
}

/** The Still Square: a quiet plaza around a great balance whose pans always hang level; the Lamp Square under Lamplight. */
function stillsquare(state: 0 | 1 | 2): Recipe {
  return (p) => {
    const lamp = state === 2;
    slab(p, 3, mat([170, 166, 160], [34, 32, 40]), 1);
    // Steps around a raised centre.
    for (let s = 0; s < 3; s++) p.box(0.3 + s * 0.2, 0.3 + s * 0.2, 2.7 - s * 0.2, 2.7 - s * 0.2, 1 + s * 1.5, 2.5 + s * 1.5, STONE, { uplight: false });
    // The balance: a column, a beam, two level pans on chains.
    p.box(1.42, 1.42, 1.58, 1.58, 5.5, 46, mat([150, 130, 90], [34, 28, 20]), { top: DARK });
    p.box(0.75, 1.46, 2.25, 1.54, 44, 47, mat([170, 150, 100], [40, 32, 22]), { uplight: false });
    for (const u of [0.85, 2.15]) {
      pole(p, u, 1.5, 30, 44, mat([80, 70, 50]), 0.4);
      p.cyl(u, 1.5, 0.22, 28, 30, mat([180, 160, 110], [40, 34, 24]), mat([200, 180, 130]));
    }
    p.glow(1.5, 1.5, 6, [255, 230, 180], 120, p.glowA() * (state === 1 ? 0.35 : 0.8));
    for (const [u, v] of [
      [0.4, 0.4],
      [2.6, 0.4],
      [0.4, 2.6],
      [2.6, 2.6],
    ] as const)
      p.lamp(u, v, 3, [255, 230, 180], 14);
    if (lamp) {
      // Candles on every step and a lamp path to the water.
      for (let s = 0; s < 3; s++)
        for (let i = 0; i < 6; i++) {
          const t = (i + 0.5) / 6;
          p.lamp(0.32 + s * 0.2 + (2.36 - s * 0.4) * t, 2.68 - s * 0.2, 2.5 + s * 1.5, [255, 214, 140], 6);
          p.lamp(2.68 - s * 0.2, 0.32 + s * 0.2 + (2.36 - s * 0.4) * t, 2.5 + s * 1.5, [255, 214, 140], 6);
        }
      for (let i = 0; i < 5; i++) p.lamp(2.8, 0.3 + i * 0.6, 2, [255, 214, 140], 9);
      const [x, y] = p.pt(1.5, 1.5, 47);
      p.addSig({ k: 'lantern', x, y, c: [255, 214, 140], size: 60 });
    }
    warn(p, 1.5, 1.5, 50);
  };
}

/** Ending landmark recipe by type and state (0 current, 1 past; the Still Square 2 = the Lamp Square). */
export function endingLandmarkRecipe(type: string, state: number): Recipe | null {
  const past = state === 1;
  switch (type) {
    case 'gantry':
      return gantry(past);
    case 'glasssmile':
      return glasssmile(past);
    case 'breadpier':
      return breadpier(past);
    case 'recordtower':
      return recordtower(past);
    case 'stillsquare':
      return stillsquare(state === 2 ? 2 : past ? 1 : 0);
  }
  return null;
}

export const ENDING_PALS: Record<string, ArtPal> = {
  gantry: FACTION_PALS.basalt,
  glasssmile: FACTION_PALS.nacre,
  breadpier: FACTION_PALS.undertow,
  recordtower: FACTION_PALS.board,
  stillsquare: FACTION_PALS.tuning,
};

// ════════════════════════════════════════════════════════════════════════════
// TAKEOVER BODIES
// ════════════════════════════════════════════════════════════════════════════

/** The takeover languages: Ironwork → Basalt, Pearlescence → Nacre, Low Crown → Undertow and Kites (alternating), Ledger → Board. */
export type LegacyLang = 'basalt' | 'nacre' | 'undertow' | 'kites' | 'board';

/** Language index 0..4 (the art style key adds it after the nine district styles). */
export const LEGACY_LANGS: LegacyLang[] = ['basalt', 'nacre', 'undertow', 'kites', 'board'];

/** The language an ending's takeover draws in at art coords (ax, ay): the Low Crown alternates Undertow and Kites. */
export function legacyLang(ending: EndingId, ax: number, ay: number): LegacyLang | null {
  switch (ending) {
    case 'ironwork':
      return 'basalt';
    case 'pearl':
      return 'nacre';
    case 'lowcrown':
      return ((ax + ay) & 1) === 0 ? 'undertow' : 'kites';
    case 'ledger':
      return 'board';
    default:
      return null;
  }
}

/** Per language: [Hab L3 single, Market L3 single, L3 quad] designs. */
const BODIES: Record<LegacyLang, [Design, Design, Design]> = {
  basalt: [hexColumn, crucible, gantrySpine],
  nacre: [pearlDrop, spiral, ribbonTwins],
  undertow: [netLoft, hullStack, craneHab],
  kites: [ropeRoost, sailCanopy, antennaForest],
  board: [steppedTower, openBelfry, charterBlock],
};

/** A podium for the quad bodies, in the language's material. */
const PODIUM: Record<LegacyLang, Mat> = {
  basalt: mat([52, 50, 56], [12, 11, 16]),
  nacre: PEARL,
  undertow: mat([132, 84, 60], [30, 18, 16]),
  kites: mat([110, 104, 130], [22, 20, 32]),
  board: STONE,
};

/**
 * Draw a takeover body: shape 0 single, 2 quad (a pair draws the quad body on its footprint). `zone` 1 Hab / 2 Market
 * picks the single's design; the mass reaches T, the seed (0..3) varies the podium and banners.
 */
export function drawLegacy(p: Painter, lang: LegacyLang, zone: number, shape: number, W: number, H: number, T: number, seed: number): void {
  const set = BODIES[lang];
  if (shape === 0) {
    const d = zone === 2 ? set[1] : set[0];
    p.box(0.1, 0.1, 0.9, 0.9, 0, 6, PODIUM[lang], { top: DARK });
    d(p, { b: [0.12 + seed * 0.01, 0.12, 0.88, 0.88 - seed * 0.01], z0: 6, h: T - 6, banners: seed % 2 === 0 });
    return;
  }
  const pod = 12 + seed * 3;
  p.box(0.06, 0.06, W - 0.06, H - 0.06, 0, pod, PODIUM[lang], { win: W_GRID, top: DARK });
  if (lang === 'basalt' && seed % 2) buttressHall(p, { b: [0.06, 0.06, W - 0.06, H - 0.06], z0: pod, h: T * 0.35, banners: false });
  set[2](p, { b: [0.1, 0.1, W - 0.1, H - 0.1], z0: pod, h: T - pod, banners: seed < 2 });
  if (lang === 'nacre' && seed === 3) haloAtrium(p, { b: [W * 0.5, H * 0.5, W - 0.1, H - 0.1], z0: pod, h: T * 0.4, banners: false });
  if (lang === 'board' && seed === 1) charterBlock(p, { b: [0.1, 0.1, W - 0.1, H - 0.1], z0: pod, h: T - pod, banners: true });
  if (lang === 'undertow' && seed === 2) crane(p, W - 0.2, 0.2, pod, T - pod + 10, W * 0.5, YELLOW);
  if (lang === 'kites' && seed === 3) sail(p, W * 0.5, H * 0.5, T, 0.5, 18, mat([236, 236, 246], [52, 50, 70]), [201, 162, 255]);
}

/** The palette a takeover body paints with. */
export function legacyPal(lang: LegacyLang): ArtPal {
  return FACTION_PALS[lang];
}

/** Lamplight's lantern roof on a Hab L2–L3 body: after the recipe, on its top roof (§9.2, a roof variant). */
export function lanternDress(p: Painter, top: Roof | null): void {
  if (!top) return;
  const du = top.u1 - top.u0;
  const dv = top.v1 - top.v0;
  if (du < 0.18 || dv < 0.18) return;
  const r = Math.min(du, dv) * 0.3;
  lanternRoof(p, (top.u0 + top.u1) / 2, (top.v0 + top.v1) / 2, r, top.z, 6, 7, mat([184, 115, 51], [40, 24, 14]), [255, 214, 140]);
  const [x, y] = p.pt((top.u0 + top.u1) / 2, (top.v0 + top.v1) / 2, top.z + 3);
  p.addSig({ k: 'lantern', x, y, c: [255, 214, 140], size: 26 });
}

/** Light colours of the takeover street looks (§9.2 street look column), for the renderer's lamps. */
export const STREET_LIGHT: Record<EndingId, RGB> = {
  ironwork: [255, 160, 70],
  pearl: [255, 198, 241],
  lowcrown: [182, 255, 46],
  ledger: [150, 220, 255],
  quiet: [255, 230, 180],
};

// ── Ending street look on the buildings (§9.2 "Street look"): facade dressing while an ending is current ──

/** Ending ids in the order zone models key them (0 = none). */
export const ENDING_DRESS: readonly (EndingId | null)[] = [null, 'ironwork', 'pearl', 'lowcrown', 'ledger', 'quiet'];

/** A zone model's ending-dress key: 0 when no ending or the Quiet Hand (which dresses nothing). */
export function endingIndex(e: EndingId | null | undefined): number {
  return e && e !== 'quiet' ? Math.max(0, ENDING_DRESS.indexOf(e)) : 0;
}

const QUOTA: RGB = [255, 150, 56];
const SMILE_C: RGB = [255, 214, 246];
const TICKER: RGB = [140, 255, 200];

/** A round smile screen (MOTH's smile: a pearl disc, two dots and an arc) on the right (+u) face at (u, vc, zc). */
function smileScreen(p: Painter, u: number, vc: number, zc: number, r: number) {
  const g = p.g;
  if (!g) {
    p.m(u, vc - r, zc - r * 14);
    p.l(u, vc + r, zc + r * 14);
    return;
  }
  const rz = r * 28;
  p.begin_();
  for (let i = 0; i <= 16; i++) {
    const t = (i / 16) * Math.PI * 2;
    if (i === 0) p.m(u + 0.01, vc + Math.cos(t) * r, zc + Math.sin(t) * rz);
    else p.l(u + 0.01, vc + Math.cos(t) * r, zc + Math.sin(t) * rz);
  }
  g.closePath();
  const lit = 0.55 + 0.45 * p.n;
  p.fill(css([232 * lit + 20, 226 * lit + 20, 236 * lit + 18].map((v) => Math.min(255, v)) as RGB, 0.95));
  if (p.n > 0.2) p.glow(u, vc, zc, SMILE_C, 30 * r * 4, p.glowA() * 0.5);
  if (p.lod) return;
  // Two dots and the arc.
  p.begin_();
  for (const dv of [-0.35, 0.35]) {
    p.m(u + 0.012, vc + dv * r, zc + rz * 0.3);
    p.l(u + 0.012, vc + dv * r, zc + rz * 0.12);
  }
  for (let i = 0; i <= 8; i++) {
    const t = Math.PI * (1.15 + (i / 8) * 0.7);
    const fn = i === 0 ? p.m.bind(p) : p.l.bind(p);
    fn(u + 0.012, vc + Math.cos(t) * r * 0.6, zc + Math.sin(t) * rz * 0.6);
  }
  p.stroke(css([60, 40, 70], 0.9), 0.7);
}

/**
 * The current ending's facade dressing on a zone body (after the recipe; the recorded top excludes it): Ironwork quota
 * boards on Fab L2+ and a tower crane on 1 in 8 L3 roofs; Pearlescence smile screens on Market L2+ and a pearl halo over
 * every tall tower; Open Ledger tickers scrolling budget lines on Market facades and open glass ground floors; the Low
 * Crown both crews' banners on the corner; the Quiet Hand nothing (the district styles stay pure).
 */
export function endingDress(p: Painter, ending: EndingId | null, zone: number, level: number, W: number, H: number, h: number): void {
  if (!ending || ending === 'quiet' || level < 1) return;
  let top: Roof | null = null;
  for (const r of p.roofs) {
    if (r.round || r.area < 0.02) continue;
    if (!top || r.z > top.z + 0.5) top = r;
  }
  if (!top) return;
  const fu = W - 0.04;
  const fv = H - 0.04;
  const zTop = top.z;
  switch (ending) {
    case 'ironwork':
      if (zone === 3 && level >= 2) {
        // The quota board: a dark board with orange tallies on the left face.
        const z1 = Math.min(zTop - 3, 26);
        if (z1 > 10) p.wallSign(0.1, fv, fu - 0.1, fv, 0.15, 0.85, z1 - 8, z1, QUOTA, true);
      }
      if (level === 3 && h % 8 === 0 && !p.lod) crane(p, top.u0 + (top.u1 - top.u0) * 0.3, top.v0 + (top.v1 - top.v0) * 0.4, zTop, 16, 0.7, mat([230, 190, 40], [60, 46, 14]));
      break;
    case 'pearl':
      if (zone === 2 && level >= 2) {
        const r = Math.min(0.22, (top.v1 - top.v0) * 0.3);
        const zc = Math.min(zTop - 10, 30);
        if (zc > 10 && r > 0.08) smileScreen(p, top.u1, (top.v0 + top.v1) / 2, zc, r);
      }
      if (level === 3) p.neonRing((top.u0 + top.u1) / 2, (top.v0 + top.v1) / 2, Math.min(top.u1 - top.u0, top.v1 - top.v0) * 0.55, zTop + 6, SMILE_C, 1.1);
      break;
    case 'ledger':
      if (zone === 2) {
        const z1 = Math.min(zTop - 2, level >= 2 ? 22 : 12);
        if (z1 > 7) p.ticker(0.08, fv, fu - 0.08, fv, 0.05, 0.95, z1 - 4, z1, TICKER);
      }
      if (level >= 2 && zone !== 3) {
        // The open glass ground floor.
        p.box(0.1, fv - 0.02, fu - 0.1, fv + 0.01, 0.5, 6, mat([150, 200, 220], [60, 90, 110]), { uplight: false });
      }
      break;
    case 'lowcrown':
      if (!p.lod && level >= 2) {
        // Both crews' banners on the corner: an Undertow green and a Kites lilac.
        p.neon([fu, fv, Math.min(zTop - 2, 20), fu, fv, Math.min(zTop - 2, 20) - 8], [182, 255, 46], 1.4);
        p.neon([fu - 0.12, fv, Math.min(zTop - 2, 20), fu - 0.12, fv, Math.min(zTop - 2, 20) - 8], [201, 162, 255], 1.4);
      }
      break;
  }
}
