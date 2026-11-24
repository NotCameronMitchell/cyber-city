// ─────────────────────────────────────────────────────────────────────────────
// Painter: the small isometric drawing kit every building recipe is written
// against.
//
// Coordinates
//   u, v  tile units relative to the footprint's top corner (0..size)
//   z     height above the ground in world px (zoom-1 pixels)
//   A point projects to world px  x = (u - v) * 32,  y = (u + v) * 16 - z.
//
// Two passes
//   Recipes are plain functions `(p: Painter) => void`. They run once in
//   RECORD mode (no canvas: the painter only tracks the drawn bounds and
//   collects the live `Fx` anchors) and again in PAINT mode, once per cached
//   sprite (night bucket × scale bucket × LOD). Recipes must therefore be
//   deterministic: all randomness comes from `p.rng`, reseeded before each pass.
//
// Lighting
//   Vertical faces are shaded by their outward normal (left face darkest,
//   right face mid, roofs lightest). Materials carry a day and a night colour.
//   At night windows light up progressively, neon glows (baked with additive
//   blending inside the sprite) and faces pick up a coloured street uplight.
// ─────────────────────────────────────────────────────────────────────────────

import { hash2, Rng } from '../../game/rng';
import { HALF_H, HALF_W } from '../camera';
import { css, glowSprite, mix, shade, type RGB } from '../palette';
import type { Fx } from './fx';

export interface Mat {
  day: RGB;
  night: RGB;
  /**
   * Role of a zone-recipe material, so the wealth tier can restyle it (EXPANSION §4.5):
   * walls get cleaner or glassier, tarps and rust tidy up. Unset = never restyled.
   */
  kind?: MatKind;
}

export type MatKind = 'wall' | 'roof' | 'tarp' | 'rust';

/** Night colour derived from a day colour: dark, slightly violet. */
export function nightOf(c: RGB): RGB {
  return [c[0] * 0.2 + 7, c[1] * 0.17 + 5, c[2] * 0.25 + 15];
}

export function mat(day: RGB, night?: RGB, kind?: MatKind): Mat {
  return kind ? { day, night: night ?? nightOf(day), kind } : { day, night: night ?? nightOf(day) };
}

/** Face brightness factors. */
export const K_TOP = 1.1;
export const K_RIGHT = 0.84;
export const K_LEFT = 0.6;

/** Shade factor for a vertical face with outward tile-space normal (nu, nv). */
export function faceK(nu: number, nv: number): number {
  const a = Math.atan2(nv, nu); // 0 = right face, PI/2 = left face
  return K_RIGHT + (K_LEFT - K_RIGHT) * (a / (Math.PI / 2));
}

/** Shade factor for the visible side of a vertical face along edge (du, dv). */
export function visK(du: number, dv: number): number {
  let nu = dv;
  let nv = -du;
  if (nu + nv < 0) {
    nu = -nu;
    nv = -nv;
  }
  return faceK(nu, nv);
}

export type WinStyle = 'grid' | 'band' | 'curtain' | 'slit' | 'capsule';

export interface WinSpec {
  style: WinStyle;
  /** Floor height (px). */
  floor: number;
  /** Column pitch along the face (px). */
  col: number;
  /** Window width / height as a fraction of the column / floor. */
  w: number;
  h: number;
  /** Bottom + top margin (px). */
  margin?: number;
  /** Multiplier on the lit fraction at night. */
  lit?: number;
  /** Skip the lowest n floors (shop fronts etc). */
  skip?: number;
}

export interface PrismOpts {
  win?: WinSpec;
  /** Roof material (defaults to the wall material). */
  top?: Mat;
  /** Neon outline around the roof edge. */
  trim?: RGB;
  /** Don't draw the top face (something sits flush on it). */
  noTop?: boolean;
  /** Draw the coloured base uplight / day ambient occlusion (default true). */
  uplight?: boolean;
  /** Override for the glass colour used by windows. */
  glass?: Mat;
}

/** Per-recipe colour scheme. */
export interface ArtPal {
  /** Signature neon. */
  neon: RGB;
  /** Secondary neon accent. */
  neon2: RGB;
  /** Street uplight tint at night. */
  up: RGB;
  /** Lit-window palette weights: warm, cool, accent (sum ≤ 1, rest = white). */
  warm: number;
  cool: number;
  /** Curtain-wall glass for this palette ($$$ zone palettes); default GLASS. */
  glass?: Mat;
}

/** A flat roof a recipe drew (zone sprites only; dressTier places props on it). */
export interface Roof {
  /** Bounding box of the roof polygon in tile units. */
  u0: number;
  v0: number;
  u1: number;
  v1: number;
  z: number;
  /** Polygon area in tile units² (π r² for round roofs). */
  area: number;
  round: boolean;
}

/** A visible wall face a recipe drew (zone sprites only), edge A→B from z0 to z1. */
export interface Face {
  au: number;
  av: number;
  bu: number;
  bv: number;
  z0: number;
  z1: number;
  /** Faces +v (the screen-left face), else +u (screen-right). */
  left: boolean;
}

/** Tier restyle targets per [tier][zone][kind]: [colour, amount]. Tier 0 keeps today's look. */
type Tint = readonly [Mat, number] | null;
const T_CLEAN = mat([206, 206, 214]);
const T_ROOF1 = mat([140, 138, 150]);
const T_MEMBRANE = mat([128, 132, 142]);
const T_STEEL = mat([170, 176, 186]);
const T_PLAT = mat([200, 208, 222]);
const T_SLEEK = mat([64, 70, 88]);
const T_GLASSY = mat([90, 140, 170], [12, 20, 38]);
const T_WHITE = mat([220, 224, 228], [40, 44, 58]);
const T_WROOF = mat([196, 200, 206], [36, 40, 54]);
const T_SOLAR = mat([44, 64, 116], [10, 14, 34]);
const KINDS: MatKind[] = ['wall', 'roof', 'tarp', 'rust'];
function tints(rows: Record<MatKind, Tint>): Tint[] {
  return KINDS.map((k) => rows[k]);
}
const TINTS: Tint[][][] = [
  // $: today's materials.
  [[], [], [], []].map(() => tints({ wall: null, roof: null, tarp: null, rust: null })),
  // $$: a little cleaner and lighter; tarps become neat membranes.
  [[], [], [], []].map(() => tints({ wall: [T_CLEAN, 0.14], roof: [T_ROOF1, 0.4], tarp: [T_MEMBRANE, 0.6], rust: [T_STEEL, 0.25] })),
  // $$$: platinum and glass for homes and shops, a white clean fab for industry.
  [
    tints({ wall: null, roof: null, tarp: null, rust: null }),
    tints({ wall: [T_PLAT, 0.5], roof: [T_SLEEK, 0.55], tarp: [T_GLASSY, 0.8], rust: [T_STEEL, 0.7] }),
    tints({ wall: [T_PLAT, 0.4], roof: [T_SLEEK, 0.55], tarp: [T_GLASSY, 0.8], rust: [T_STEEL, 0.7] }),
    tints({ wall: [T_WHITE, 0.75], roof: [T_WROOF, 0.7], tarp: [T_SOLAR, 0.85], rust: [T_WHITE, 0.8] }),
  ],
];
const KIND_INDEX: Record<MatKind, number> = { wall: 0, roof: 1, tarp: 2, rust: 3 };
/** Cleanroom ribbon glazing of a $$$ Fab District. */
const CLEAN_GLASS: Mat = { day: [120, 170, 182], night: [10, 26, 34] };

// ── Colours ────────────────────────────────────────────────────────────────

const WARM: RGB = [255, 196, 118];
const COOL: RGB = [150, 214, 255];
const WHITE: RGB = [232, 236, 255];
const BLACK: RGB = [0, 0, 0];
export const GLASS: Mat = { day: [78, 112, 138], night: [12, 16, 34] };
const GLASS_SKY: RGB = [150, 178, 196];
const PANEL_BG: Mat = { day: [34, 32, 48], night: [8, 7, 16] };
const TUBE_DAY: RGB = [150, 150, 164];
const GRIME: RGB = [72, 64, 58];
const TANK_TIDY = mat([150, 150, 158]);
const TANK_TIDY_TOP = mat([128, 128, 138]);
const TANK_LUXE = mat([206, 212, 220], [40, 44, 60]);
const TANK_LUXE_TOP = mat([180, 186, 196], [34, 38, 52]);

// ── Invented script glyphs (3 × 4 bit cells, top row first) ────────────────
// Original shapes; they only have to read as "signage" at a glance.
const GLYPH_ROWS = [
  ['111', '010', '110', '011'],
  ['101', '111', '001', '111'],
  ['110', '011', '110', '010'],
  ['111', '101', '010', '111'],
  ['010', '111', '101', '101'],
  ['100', '111', '011', '110'],
  ['011', '110', '011', '111'],
  ['111', '001', '111', '100'],
  ['101', '010', '111', '001'],
  ['110', '100', '111', '011'],
  ['010', '110', '011', '010'],
  ['111', '110', '001', '011'],
  ['001', '111', '100', '111'],
  ['101', '111', '010', '110'],
  ['011', '001', '111', '101'],
  ['111', '010', '101', '111'],
];
/** Glyph bitmasks: bit (r * 3 + c) set = cell on. */
export const GLYPHS: number[] = GLYPH_ROWS.map((rows) => {
  let m = 0;
  rows.forEach((row, r) => {
    for (let c = 0; c < 3; c++) if (row[c] === '1') m |= 1 << (r * 3 + c);
  });
  return m;
});

/** One face (or sign) plane: origin + tangent along t, z goes straight up. */
interface Plane {
  ou: number;
  ov: number;
  oz: number;
  tu: number;
  tv: number;
}

export class Painter {
  /** Null in record mode. */
  g: CanvasRenderingContext2D | null = null;
  /** Night amount 0..1 of the sprite being painted. */
  n = 0;
  /** Windows + neon may light (powered and not abandoned / under construction). */
  lights = true;
  abandoned = false;
  /** Simplified far-zoom rendering. */
  lod = false;
  /** Multiplier on the lit-window fraction at night (low-rise zone blocks light up more). */
  litBoost = 1;
  /** Multiplier on emissive glow strength at night. */
  glowBoost = 1;
  /**
   * Zone of the sprite being painted (1 Hab Blocks, 2 Market Strip, 3 Fab District), or 0 for
   * every other sprite. Only zone sprites are restyled by `tier`.
   */
  zone = 0;
  /** Wealth tier of a zone sprite: 0 $, 1 $$, 2 $$$ (EXPANSION §4.5). */
  tier: 0 | 1 | 2 = 0;
  /** Record roofs and faces while a zone recipe runs (dressTier reads them; props never register). */
  dressRec = false;
  /** Flat and round roofs the recipe drew (this pass). */
  readonly roofs: Roof[] = [];
  /** Visible wall faces the recipe drew (this pass). */
  readonly faces: Face[] = [];
  rng = new Rng(1);
  seed = 1;
  pal: ArtPal;
  /** Collected live effects (record mode). */
  fx: Fx[] = [];
  recording = false;

  // Bounds of everything drawn, world px relative to the footprint top corner.
  bx0 = 0;
  by0 = 0;
  bx1 = 0;
  by1 = 0;
  maxZ = 0;

  /** Running face counter so window lighting is stable between passes. */
  private faceId = 0;

  constructor(pal: ArtPal) {
    this.pal = pal;
  }

  /** Reset per-pass state. */
  begin(seed: number, pal: ArtPal) {
    this.seed = seed;
    this.rng = new Rng(seed);
    this.pal = pal;
    this.faceId = 0;
    this.fx = [];
    this.bx0 = this.by0 = Infinity;
    this.bx1 = this.by1 = -Infinity;
    this.maxZ = 0;
    this.roofs.length = 0;
    this.faces.length = 0;
  }

  /** True while a $$ or $$$ zone sprite is painted (tidy and luxe variants of recipe props). */
  private get tidy(): boolean {
    return this.zone > 0 && this.tier > 0;
  }
  /** True while a $$$ zone sprite is painted. */
  private get luxe(): boolean {
    return this.zone > 0 && this.tier === 2;
  }

  /** A zone material restyled for the wealth tier (identity for $ and for non-zone sprites). */
  private tint(c: RGB, kind: MatKind): RGB {
    const t = TINTS[this.tier][this.zone]?.[KIND_INDEX[kind]];
    if (!t) return c;
    return mix(c, mix(t[0].day, t[0].night, this.n), t[1]);
  }

  /** Window spec restyled for the wealth tier: $$$ homes and shops go curtain glass, a $$$ fab gets ribbon glazing. */
  private tierWin(w: WinSpec): WinSpec {
    if (!this.luxe) return w;
    if (this.zone === 3) return w.style === 'slit' ? { style: 'band', floor: w.floor, col: w.col, w: 1, h: 0.4, margin: w.margin, lit: (w.lit ?? 1) * 0.9, skip: w.skip } : w;
    if (w.style === 'curtain') return w;
    return { style: 'curtain', floor: Math.max(5, w.floor), col: Math.max(5, w.col), w: 1, h: 0.82, margin: 1, lit: w.lit, skip: w.skip };
  }

  // ── Projection + path helpers ────────────────────────────────────────────
  X(u: number, v: number): number {
    return (u - v) * HALF_W;
  }
  Y(u: number, v: number, z: number): number {
    return (u + v) * HALF_H - z;
  }
  /** Track a world-px point in the bounds (always; cheap). */
  track(x: number, y: number, pad = 0) {
    if (x - pad < this.bx0) this.bx0 = x - pad;
    if (x + pad > this.bx1) this.bx1 = x + pad;
    if (y - pad < this.by0) this.by0 = y - pad;
    if (y + pad > this.by1) this.by1 = y + pad;
  }
  private tz(z: number) {
    if (z > this.maxZ) this.maxZ = z;
  }
  m(u: number, v: number, z: number) {
    const x = this.X(u, v);
    const y = this.Y(u, v, z);
    this.track(x, y);
    this.tz(z);
    this.g?.moveTo(x, y);
  }
  l(u: number, v: number, z: number) {
    const x = this.X(u, v);
    const y = this.Y(u, v, z);
    this.track(x, y);
    this.tz(z);
    this.g?.lineTo(x, y);
  }
  begin_() {
    this.g?.beginPath();
  }
  fill(style: string | CanvasGradient) {
    const g = this.g;
    if (!g) return;
    g.fillStyle = style;
    g.fill();
  }
  stroke(style: string, w: number) {
    const g = this.g;
    if (!g) return;
    g.strokeStyle = style;
    g.lineWidth = w;
    g.stroke();
  }
  quad(au: number, av: number, az: number, bu: number, bv: number, bz: number, cu: number, cv: number, cz: number, du: number, dv: number, dz: number) {
    this.m(au, av, az);
    this.l(bu, bv, bz);
    this.l(cu, cv, cz);
    this.l(du, dv, dz);
    this.g?.closePath();
  }

  // ── Colour helpers ───────────────────────────────────────────────────────
  rgb(m: Mat, k = 1): RGB {
    let c = mix(m.day, m.night, this.n);
    if (m.kind && this.zone) c = this.tint(c, m.kind);
    // Abandoned: grimy, desaturated, darker.
    return this.abandoned ? shade(mix(c, GRIME, 0.4), k * 0.78) : shade(c, k);
  }
  col(m: Mat, k = 1, a = 1): string {
    return this.g ? css(this.rgb(m, k), a) : '';
  }
  /** Colour of an emissive element (neon tube / screen) for the current state. */
  emissive(c: RGB, boost = 0.3): RGB {
    const on = this.lights && !this.abandoned;
    if (on) return mix(mix(c, TUBE_DAY, 0.45), mix(c, WHITE, boost * this.n), Math.min(1, this.n * 1.6));
    return mix(shade(mix(c, TUBE_DAY, 0.6), 0.75), shade(c, 0.12), this.n);
  }
  /** Glow strength for emissive elements (0 by day / unlit). */
  glowA(): number {
    return this.lights && !this.abandoned ? this.n * this.glowBoost : 0;
  }

  // ── Solids ───────────────────────────────────────────────────────────────

  /** Extruded convex polygon (flat u,v pairs) from z0 to z1. */
  prism(poly: ArrayLike<number>, z0: number, z1: number, m: Mat, o: PrismOpts = {}) {
    const cnt = poly.length / 2;
    let cu = 0;
    let cv = 0;
    for (let i = 0; i < cnt; i++) {
      cu += poly[i * 2];
      cv += poly[i * 2 + 1];
    }
    cu /= cnt;
    cv /= cnt;
    for (let i = 0; i < cnt; i++) {
      const j = (i + 1) % cnt;
      const au = poly[i * 2];
      const av = poly[i * 2 + 1];
      const bu = poly[j * 2];
      const bv = poly[j * 2 + 1];
      let nu = bv - av;
      let nv = -(bu - au);
      if (nu * ((au + bu) / 2 - cu) + nv * ((av + bv) / 2 - cv) < 0) {
        nu = -nu;
        nv = -nv;
      }
      this.faceId++;
      if (nu + nv <= 1e-6) continue;
      const k = faceK(nu, nv);
      if (this.dressRec && z1 - z0 >= 6) this.faces.push({ au, av, bu, bv, z0, z1, left: nv > nu });
      this.wall(au, av, bu, bv, z0, z1, m, k, o);
    }
    if (this.dressRec && !o.noTop) {
      let u0 = Infinity;
      let v0 = Infinity;
      let u1 = -Infinity;
      let v1 = -Infinity;
      let area = 0;
      for (let i = 0; i < cnt; i++) {
        const j = (i + 1) % cnt;
        const pu = poly[i * 2];
        const pv = poly[i * 2 + 1];
        if (pu < u0) u0 = pu;
        if (pu > u1) u1 = pu;
        if (pv < v0) v0 = pv;
        if (pv > v1) v1 = pv;
        area += pu * poly[j * 2 + 1] - poly[j * 2] * pv;
      }
      this.roofs.push({ u0, v0, u1, v1, z: z1, area: Math.abs(area) / 2, round: false });
    }
    if (!o.noTop) {
      const tm = o.top ?? m;
      this.begin_();
      for (let i = 0; i < cnt; i++) {
        if (i === 0) this.m(poly[0], poly[1], z1);
        else this.l(poly[i * 2], poly[i * 2 + 1], z1);
      }
      this.g?.closePath();
      this.fill(this.col(tm, K_TOP));
      // Crisp lighter lip on the roof edge.
      if (this.g && !this.lod) this.stroke(this.col(tm, K_TOP * 1.18, 0.9), 0.6);
    }
    // $$$ homes and shops: a thin gold or platinum edge trim on every main volume.
    const trim = o.trim ?? (this.luxe && this.zone !== 3 && !o.noTop && z1 - z0 >= 18 ? this.pal.neon2 : undefined);
    if (trim) {
      const pts: number[] = [];
      for (let i = 0; i <= cnt; i++) {
        const k = i % cnt;
        pts.push(poly[k * 2], poly[k * 2 + 1], z1);
      }
      this.neon(pts, trim, o.trim ? 0.9 : 0.55);
    }
  }

  /** Axis-aligned box. */
  box(u0: number, v0: number, u1: number, v1: number, z0: number, z1: number, m: Mat, o: PrismOpts = {}) {
    this.prism([u0, v0, u1, v0, u1, v1, u0, v1], z0, z1, m, o);
  }

  /** Box with chamfered corners (octagonal footprint). */
  chamfer(u0: number, v0: number, u1: number, v1: number, c: number, z0: number, z1: number, m: Mat, o: PrismOpts = {}) {
    this.prism([u0 + c, v0, u1 - c, v0, u1, v0 + c, u1, v1 - c, u1 - c, v1, u0 + c, v1, u0, v1 - c, u0, v0 + c], z0, z1, m, o);
  }

  /** One vertical wall face A→B with optional windows and uplight. */
  private wall(au: number, av: number, bu: number, bv: number, z0: number, z1: number, m: Mat, k: number, o: PrismOpts) {
    const win = o.win && this.zone ? this.tierWin(o.win) : o.win;
    const curtain = win?.style === 'curtain';
    const glassM = o.glass ?? (this.luxe ? (this.zone === 3 ? CLEAN_GLASS : this.pal.glass) : undefined) ?? GLASS;
    const base = curtain ? glassM : m;
    this.begin_();
    this.quad(au, av, z0, bu, bv, z0, bu, bv, z1, au, av, z1);
    if (this.recording && win && z1 - z0 > 14) this.maybeFlicker(au, av, bu, bv, z0, z1, win);
    const g = this.g;
    if (!g) return;
    g.fillStyle = this.col(base, curtain ? k * 1.05 : k);
    g.fill();
    if (win && z1 - z0 > 5) this.windows(au, av, bu, bv, z0, z1, win, k, glassM, m);
    if (o.uplight !== false && z0 < 4) {
      // Day: soft ambient occlusion at the foot. Night: coloured street glow.
      const yb = Math.max(this.Y(au, av, z0), this.Y(bu, bv, z0));
      const top = yb - Math.min(z1 - z0, 22 + 18 * this.n) - 16;
      const grad = g.createLinearGradient(0, yb, 0, top);
      const c = mix(BLACK, this.pal.up, this.abandoned ? 0.25 : this.n);
      grad.addColorStop(0, css(c, (0.2 + 0.12 * this.n) * (this.lights ? 1 : 0.45)));
      grad.addColorStop(1, css(c, 0));
      this.begin_();
      this.quad(au, av, z0, bu, bv, z0, bu, bv, z1, au, av, z1);
      g.fillStyle = grad;
      g.fill();
    }
    if (!this.lod) {
      // Thin dark seam on the vertical edges reads as crisp geometry.
      this.begin_();
      this.m(au, av, z0);
      this.l(au, av, z1);
      this.stroke(this.col(base, k * 0.7, 0.6), 0.5);
    }
    if (this.abandoned && !this.lod && z0 < 2) this.graffiti(au, av, bu, bv, Math.min(z1, 16));
  }

  /** Window grid on the face A→B. */
  private windows(au: number, av: number, bu: number, bv: number, z0: number, z1: number, w: WinSpec, k: number, glass: Mat, wallM: Mat) {
    const g = this.g!;
    const du = bu - au;
    const dv = bv - av;
    const L = Math.hypot((du - dv) * HALF_W, (du + dv) * HALF_H);
    const lod = this.lod;
    const colPitch = lod ? w.col * 2 : w.col;
    const floorH = lod ? w.floor * 2 : w.floor;
    const cols = Math.max(1, Math.round(L / colPitch));
    const mz = w.margin ?? 3;
    const rows = Math.max(0, Math.floor((z1 - z0 - mz * 2 + floorH * (1 - w.h)) / floorH));
    if (rows === 0) return;
    const fid = this.faceId;
    const n = this.n;
    const on = this.lights && !this.abandoned;
    // Night lighting comes on progressively; curtain walls stay calmer.
    const litFrac = on ? Math.min(0.92, (0.03 + n * 0.5) * (w.lit ?? 1) * this.litBoost * (w.style === 'curtain' ? 0.6 : 1)) : 0;
    const style = w.style;
    const P = this.pal;
    const curtain = style === 'curtain';

    // Glass for unlit windows: reflects the sky by day, near-black at night.
    const glassRGB = mix(shade(mix(glass.day, GLASS_SKY, 0.25), k * 1.1), shade(glass.night, k), n);
    const glassCol = css(glassRGB);
    const glassHi = css(mix(glassRGB, [255, 255, 255], 0.18 * (1 - n)));

    // Lit colours: 3 hues × 2 intensities.
    const litT = Math.min(1, 0.35 + n * 0.9) * (curtain ? 0.82 : 1);
    // $$$ zone sprites: gold or platinum accents instead of the signature neon.
    const hues: RGB[] = [WARM, COOL, this.luxe ? P.neon2 : P.neon, WHITE];
    const litCols: string[] = [];
    for (const h of hues) {
      litCols.push(css(mix(glassRGB, h, litT)), css(mix(glassRGB, shade(h, 0.62), litT)));
    }

    const tw = w.w;
    const paths: Path2D[] = [];
    const getPath = (i: number) => (paths[i] ??= new Path2D());
    // Index 0 = glass, 1 = glass highlight row, 2.. = lit colours, 10 = broken, 11 = boards.
    const add = (pi: number, t0: number, t1: number, za: number, zb: number) => {
      const p = getPath(pi);
      const x0 = this.X(au + du * t0, av + dv * t0);
      const y0 = this.Y(au + du * t0, av + dv * t0, 0);
      const x1 = this.X(au + du * t1, av + dv * t1);
      const y1 = this.Y(au + du * t1, av + dv * t1, 0);
      p.moveTo(x0, y0 - za);
      p.lineTo(x1, y1 - za);
      p.lineTo(x1, y1 - zb);
      p.lineTo(x0, y0 - zb);
      p.closePath();
    };

    if (curtain && !lod) {
      // Mullions: thin vertical and horizontal lines across the glass.
      const mull = new Path2D();
      for (let c = 1; c < cols; c++) {
        const t = c / cols;
        const x = this.X(au + du * t, av + dv * t);
        const y = this.Y(au + du * t, av + dv * t, 0);
        mull.moveTo(x, y - z0);
        mull.lineTo(x, y - z1);
      }
      for (let r = 1; r * floorH < z1 - z0; r++) {
        const z = z0 + r * floorH;
        mull.moveTo(this.X(au, av), this.Y(au, av, z));
        mull.lineTo(this.X(bu, bv), this.Y(bu, bv, z));
      }
      g.strokeStyle = this.col(wallM, k * 0.9, 0.55);
      g.lineWidth = 0.5;
      g.stroke(mull);
      // Sky reflection streak by day.
      if (n < 0.7) {
        const grad = g.createLinearGradient(this.X(au, av), 0, this.X(bu, bv), 0);
        grad.addColorStop(0, 'rgba(255,255,255,0)');
        grad.addColorStop(0.55, css([255, 255, 255], 0.13 * (1 - n)));
        grad.addColorStop(0.75, 'rgba(255,255,255,0)');
        g.fillStyle = grad;
        const p = new Path2D();
        p.moveTo(this.X(au, av), this.Y(au, av, z0));
        p.lineTo(this.X(bu, bv), this.Y(bu, bv, z0));
        p.lineTo(this.X(bu, bv), this.Y(bu, bv, z1));
        p.lineTo(this.X(au, av), this.Y(au, av, z1));
        p.closePath();
        g.fill(p);
      }
    }

    for (let r = 0; r < rows; r++) {
      if (w.skip && r < w.skip) continue;
      // Occupancy varies per floor so lights cluster in bands, not confetti.
      const rowLit = litFrac * (0.25 + 1.5 * hash2(fid * 3 + r, 77, this.seed));
      const za = z0 + mz + r * floorH + (floorH * (1 - w.h)) / 2;
      const zb = za + floorH * w.h;
      if (zb > z1 - 1) break;
      if (style === 'band' && !on && !this.abandoned) {
        // Continuous ribbon window.
        add(r % 3 === 2 ? 1 : 0, 0.04, 0.96, za, zb);
        continue;
      }
      for (let c = 0; c < cols; c++) {
        const h = hash2(fid * 131 + c, r, this.seed);
        let t0: number;
        let t1: number;
        if (style === 'band' || curtain) {
          t0 = c / cols + (curtain ? 0.04 / cols : 0);
          t1 = (c + 1) / cols - (curtain ? 0.04 / cols : 0);
        } else {
          t0 = (c + (1 - tw) / 2) / cols;
          t1 = (c + (1 + tw) / 2) / cols;
        }
        if (this.abandoned) {
          const b = hash2(fid * 17 + c, r * 3 + 1, this.seed + 5);
          add(b < 0.22 ? 10 : b < 0.34 ? 11 : 0, t0, t1, za, zb);
          continue;
        }
        if (h < rowLit) {
          const hh = hash2(fid * 7 + c * 3, r, this.seed + 99);
          const hue = hh < P.warm ? 0 : hh < P.warm + P.cool ? 1 : hh < P.warm + P.cool + 0.07 ? 2 : 3;
          const dim = hash2(c, r * 7 + fid, this.seed + 3) < 0.35 ? 1 : 0;
          if (lod) {
            add(2 + hue * 2, t0, t1, za, zb);
          } else add(2 + hue * 2 + dim, t0, t1, za, zb);
        } else if (!curtain) {
          add(r === rows - 1 || (h > 0.92 && n < 0.5) ? 1 : 0, t0, t1, za, zb);
        }
      }
    }
    if (paths[0]) {
      g.fillStyle = glassCol;
      g.fill(paths[0]);
    }
    if (paths[1]) {
      g.fillStyle = glassHi;
      g.fill(paths[1]);
    }
    for (let i = 2; i < 10; i++) {
      if (!paths[i]) continue;
      g.fillStyle = litCols[i - 2];
      g.fill(paths[i]);
    }
    if (paths[10]) {
      g.fillStyle = this.col(mat([120, 122, 132]), k * 0.8);
      g.fill(paths[10]);
    }
    if (paths[11]) {
      g.fillStyle = this.col(mat([96, 74, 52]), k);
      g.fill(paths[11]);
    }
  }

  /** Spray-paint scribbles near the foot of an abandoned wall. */
  private graffiti(au: number, av: number, bu: number, bv: number, zTop: number) {
    const g = this.g;
    if (!g) return;
    const cols: RGB[] = [
      [255, 60, 180],
      [60, 230, 255],
      [255, 210, 60],
      [120, 255, 120],
    ];
    const du = bu - au;
    const dv = bv - av;
    const cnt = 1 + Math.floor(hash2(this.faceId, 1, this.seed) * 2);
    for (let i = 0; i < cnt; i++) {
      const c = cols[Math.floor(hash2(this.faceId, i + 9, this.seed) * cols.length)];
      const t = 0.15 + hash2(this.faceId, i + 3, this.seed) * 0.6;
      g.beginPath();
      for (let s = 0; s < 6; s++) {
        const tt = t + s * 0.035;
        const z = 3 + ((s * 7 + i * 5) % 9) * (zTop - 5) / 9;
        const x = this.X(au + du * tt, av + dv * tt);
        const y = this.Y(au + du * tt, av + dv * tt, z);
        if (s === 0) g.moveTo(x, y);
        else g.lineTo(x, y);
      }
      g.strokeStyle = css(mix(shade(c, 0.7 - this.n * 0.45), [90, 84, 80], 0.35), 0.7);
      g.lineWidth = 1.1;
      g.stroke();
    }
  }

  /** Vertical cylinder. */
  cyl(cu: number, cv: number, r: number, z0: number, z1: number, m: Mat, top?: Mat, rTop = r) {
    const cx = this.X(cu, cv);
    const cy = this.Y(cu, cv, 0);
    const rx = r * HALF_W * Math.SQRT2;
    const ry = r * HALF_H * Math.SQRT2;
    const rxT = rTop * HALF_W * Math.SQRT2;
    const ryT = rTop * HALF_H * Math.SQRT2;
    this.track(cx - rx, cy - z0 + ry);
    this.track(cx + rx, cy - z1 - ryT);
    this.track(cx - rxT, cy - z1 - ryT);
    this.tz(z1);
    if (this.dressRec) this.roofs.push({ u0: cu - rTop, v0: cv - rTop, u1: cu + rTop, v1: cv + rTop, z: z1, area: Math.PI * rTop * rTop, round: true });
    const g = this.g;
    if (!g) return;
    g.beginPath();
    g.moveTo(cx - rx, cy - z0);
    g.ellipse(cx, cy - z0, rx, ry, 0, Math.PI, 0, true);
    g.lineTo(cx + rxT, cy - z1);
    g.ellipse(cx, cy - z1, rxT, ryT, 0, 0, Math.PI, true);
    g.closePath();
    g.fillStyle = this.cylGrad(cx, Math.max(rx, rxT), m);
    g.fill();
    g.beginPath();
    g.ellipse(cx, cy - z1, rxT, ryT, 0, 0, Math.PI * 2);
    g.fillStyle = this.col(top ?? m, K_TOP);
    g.fill();
  }

  /** Horizontal light-to-dark gradient for round shapes. */
  cylGrad(cx: number, rx: number, m: Mat): CanvasGradient {
    const g = this.g!;
    const grad = g.createLinearGradient(cx - rx, 0, cx + rx, 0);
    grad.addColorStop(0, this.col(m, K_LEFT * 0.85));
    grad.addColorStop(0.4, this.col(m, K_LEFT * 1.05));
    grad.addColorStop(0.78, this.col(m, K_RIGHT * 1.06));
    grad.addColorStop(1, this.col(m, K_RIGHT * 0.86));
    return grad;
  }

  /** Hyperboloid cooling tower (white at a $$$ clean fab). */
  coolingTower(cu: number, cv: number, r: number, h: number, m0: Mat) {
    const m = this.luxe && this.zone === 3 ? T_WHITE : m0;
    const cx = this.X(cu, cv);
    const cy = this.Y(cu, cv, 0);
    const rad = (z: number) => r * (1 - 0.34 * Math.sin(Math.min(1, z / h) * Math.PI * 0.78));
    const R = r * HALF_W * Math.SQRT2;
    this.track(cx - R, cy + R / 2);
    this.track(cx + R, cy - h - R / 2);
    this.tz(h);
    const g = this.g;
    if (!g) return;
    const steps = 10;
    g.beginPath();
    const rx0 = rad(0) * HALF_W * Math.SQRT2;
    g.moveTo(cx - rx0, cy);
    g.ellipse(cx, cy, rx0, rx0 / 2, 0, Math.PI, 0, true);
    for (let i = 1; i <= steps; i++) {
      const z = (h * i) / steps;
      g.lineTo(cx + rad(z) * HALF_W * Math.SQRT2, cy - z);
    }
    const rxT = rad(h) * HALF_W * Math.SQRT2;
    g.ellipse(cx, cy - h, rxT, rxT / 2, 0, 0, Math.PI, true);
    for (let i = steps - 1; i >= 0; i--) {
      const z = (h * i) / steps;
      g.lineTo(cx - rad(z) * HALF_W * Math.SQRT2, cy - z);
    }
    g.closePath();
    g.fillStyle = this.cylGrad(cx, R, m);
    g.fill();
    // Weathering bands.
    g.strokeStyle = this.col(m, 0.62, 0.35);
    g.lineWidth = 0.6;
    for (let i = 1; i < 4; i++) {
      const z = (h * i) / 4;
      const rx = rad(z) * HALF_W * Math.SQRT2;
      g.beginPath();
      g.ellipse(cx, cy - z, rx, rx / 2, 0, 0, Math.PI);
      g.stroke();
    }
    // Open top: rim + dark throat.
    g.beginPath();
    g.ellipse(cx, cy - h, rxT, rxT / 2, 0, 0, Math.PI * 2);
    g.fillStyle = this.col(m, K_TOP);
    g.fill();
    g.beginPath();
    g.ellipse(cx, cy - h + 0.6, rxT * 0.84, rxT * 0.4, 0, 0, Math.PI * 2);
    g.fillStyle = css(mix([30, 30, 36], this.pal.neon, 0.25 * this.glowA()));
    g.fill();
  }

  /** Dome (half ellipsoid) on the ground plane. */
  dome(cu: number, cv: number, r: number, z0: number, hz: number, m: Mat) {
    const cx = this.X(cu, cv);
    const cy = this.Y(cu, cv, 0) - z0;
    const rx = r * HALF_W * Math.SQRT2;
    this.track(cx - rx, cy + rx / 2);
    this.track(cx + rx, cy - hz);
    this.tz(z0 + hz);
    const g = this.g;
    if (!g) return;
    g.beginPath();
    g.moveTo(cx - rx, cy);
    g.ellipse(cx, cy, rx, rx / 2, 0, Math.PI, 0, true);
    g.ellipse(cx, cy, rx, hz, 0, 0, Math.PI, true);
    g.closePath();
    const grad = g.createRadialGradient(cx + rx * 0.3, cy - hz * 0.7, rx * 0.05, cx, cy - hz * 0.3, rx * 1.1);
    grad.addColorStop(0, this.col(m, 1.25));
    grad.addColorStop(0.6, this.col(m, 0.85));
    grad.addColorStop(1, this.col(m, 0.55));
    g.fillStyle = grad;
    g.fill();
  }

  // ── Emissive bits ────────────────────────────────────────────────────────

  /** Neon polyline through (u,v,z) triples. */
  neon(pts: number[], c: RGB, w = 1) {
    const g = this.g;
    const cnt = pts.length / 3;
    if (!g) {
      for (let i = 0; i < cnt; i++) {
        this.track(this.X(pts[i * 3], pts[i * 3 + 1]), this.Y(pts[i * 3], pts[i * 3 + 1], pts[i * 3 + 2]), 4);
        this.tz(pts[i * 3 + 2]);
      }
      return;
    }
    g.beginPath();
    for (let i = 0; i < cnt; i++) {
      const x = this.X(pts[i * 3], pts[i * 3 + 1]);
      const y = this.Y(pts[i * 3], pts[i * 3 + 1], pts[i * 3 + 2]);
      if (i === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    g.lineJoin = 'round';
    g.lineCap = 'round';
    const ga = this.glowA();
    if (ga > 0.04 && !this.lod) {
      g.globalCompositeOperation = 'lighter';
      g.strokeStyle = css(c, 0.1 * ga);
      g.lineWidth = w * 6;
      g.stroke();
      g.strokeStyle = css(c, 0.22 * ga);
      g.lineWidth = w * 2.8;
      g.stroke();
      g.globalCompositeOperation = 'source-over';
    }
    g.strokeStyle = css(this.emissive(c, 0.45));
    g.lineWidth = this.lod ? w * 1.6 : w;
    g.stroke();
  }

  /** Soft additive glow blob centred on a 3D point. */
  glow(u: number, v: number, z: number, c: RGB, size: number, alpha: number) {
    const x = this.X(u, v);
    const y = this.Y(u, v, z);
    this.track(x, y, size / 2);
    const g = this.g;
    if (!g || alpha <= 0.02) return;
    g.globalCompositeOperation = 'lighter';
    g.globalAlpha = Math.min(1, alpha);
    g.drawImage(glowSprite(c, 64), x - size / 2, y - size / 2, size, size);
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'source-over';
  }

  /** A point light: small bright dot + glow (lit only at night when powered). */
  lamp(u: number, v: number, z: number, c: RGB, size = 10) {
    const x = this.X(u, v);
    const y = this.Y(u, v, z);
    this.track(x, y, size / 2);
    this.tz(z);
    const g = this.g;
    if (!g) return;
    g.fillStyle = css(this.emissive(c, 0.6));
    g.fillRect(x - 0.7, y - 0.7, 1.4, 1.4);
    this.glow(u, v, z, c, size, this.glowA() * 0.7);
  }

  private plane(ou: number, ov: number, oz: number, tu: number, tv: number): Plane {
    return { ou, ov, oz, tu, tv };
  }
  /** Rect in a plane's (t, z) coordinates appended to the current path. */
  private pRect(p: Plane, t0: number, t1: number, z0: number, z1: number) {
    const u0 = p.ou + p.tu * t0;
    const v0 = p.ov + p.tv * t0;
    const u1 = p.ou + p.tu * t1;
    const v1 = p.ov + p.tv * t1;
    this.quad(u0, v0, p.oz + z0, u1, v1, p.oz + z0, u1, v1, p.oz + z1, u0, v0, p.oz + z1);
  }

  /** Row/column of invented glyphs inside a plane rectangle. */
  private glyphs(p: Plane, t0: number, t1: number, z0: number, z1: number, vertical: boolean, seed: number, c: string) {
    const g = this.g;
    if (!g) return;
    const lenT = t1 - t0;
    const lenZ = z1 - z0;
    // Cell sizes in plane units: glyph = 3 × 4 cells + 1 cell gap.
    const worldPerT = Math.hypot((p.tu - p.tv) * HALF_W, (p.tu + p.tv) * HALF_H);
    const widthPx = lenT * worldPerT;
    const cellPx = vertical ? Math.max(0.7, Math.min(widthPx / 4, lenZ / 5.5)) : Math.max(0.7, Math.min(lenZ / 5, widthPx / 4.5));
    const cellT = cellPx / worldPerT;
    const count = vertical ? Math.max(1, Math.floor(lenZ / (cellPx * 5))) : Math.max(1, Math.floor(widthPx / (cellPx * 4)));
    g.beginPath();
    for (let i = 0; i < count; i++) {
      const gm = GLYPHS[Math.floor(hash2(seed, i, 77) * GLYPHS.length)];
      const gt0 = vertical ? t0 + (lenT - cellT * 3) / 2 : t0 + (lenT - count * cellT * 4 + cellT) / 2 + i * cellT * 4;
      const gz1 = vertical ? z1 - (lenZ - count * cellPx * 5 + cellPx) / 2 - i * cellPx * 5 : z1 - (lenZ - cellPx * 4) / 2;
      for (let r = 0; r < 4; r++)
        for (let cc = 0; cc < 3; cc++) {
          if (!(gm & (1 << (r * 3 + cc)))) continue;
          this.pRect(p, gt0 + cc * cellT, gt0 + (cc + 0.86) * cellT, gz1 - (r + 0.9) * cellPx, gz1 - r * cellPx);
        }
    }
    g.fillStyle = c;
    g.fill();
  }

  /**
   * Flat sign on a wall plane: face edge A→B (tile units), spanning t0..t1 and z0..z1.
   * `glyph` draws invented lettering, else a solid lit panel.
   */
  wallSign(au: number, av: number, bu: number, bv: number, t0: number, t1: number, z0: number, z1: number, c: RGB, glyph = true, vertical = false) {
    const p = this.plane(au, av, 0, bu - au, bv - av);
    const k = visK(bu - au, bv - av);
    this.signBody(p, t0, t1, z0, z1, c, glyph, vertical, k);
  }

  /** Blade sign sticking out of a wall at (u, v), extending `len` along +u ('u') or +v ('v'). */
  blade(u: number, v: number, dir: 'u' | 'v', len: number, z0: number, z1: number, c: RGB, glyph = true) {
    const p = dir === 'u' ? this.plane(u, v, 0, len, 0) : this.plane(u, v, 0, 0, len);
    // Plane along u faces +v (left shade); along v faces +u (right shade).
    const k = dir === 'u' ? K_LEFT : K_RIGHT;
    this.signBody(p, 0, 1, z0, z1, c, glyph, true, k);
  }

  private signBody(p: Plane, t0: number, t1: number, z0: number, z1: number, c: RGB, glyph: boolean, vertical: boolean, k: number) {
    const ga = this.glowA();
    const cu = p.ou + p.tu * (t0 + t1) / 2;
    const cv = p.ov + p.tv * (t0 + t1) / 2;
    const sz = Math.max(z1 - z0, Math.hypot((p.tu - p.tv) * 32, (p.tu + p.tv) * 16) * (t1 - t0));
    if (ga > 0.05 && !this.lod) this.glow(cu, cv, (z0 + z1) / 2, c, sz * 2.2, ga * 0.55);
    this.begin_();
    this.pRect(p, t0, t1, z0, z1);
    if (glyph) {
      this.fill(this.col(PANEL_BG, k));
      if (!this.g) return;
      if (!this.lod) {
        this.stroke(css(this.emissive(c, 0.2), 0.9), 0.55);
        const inset = 0.08 * (t1 - t0);
        this.glyphs(p, t0 + inset, t1 - inset, z0 + 1, z1 - 1, vertical, Math.floor(cu * 97 + cv * 31 + z0 + this.seed), css(this.emissive(c, 0.55)));
      } else {
        this.begin_();
        this.pRect(p, t0 + (t1 - t0) * 0.25, t1 - (t1 - t0) * 0.25, z0 + 1, z1 - 1);
        this.fill(css(this.emissive(c, 0.5)));
      }
    } else {
      this.fill(css(this.emissive(c, 0.35)));
    }
  }

  /** Awning sloping out from a wall edge A→B at height z, depth d along the outward normal. */
  awning(au: number, av: number, bu: number, bv: number, z: number, d: number, c: RGB, striped = true) {
    let nu = bv - av;
    let nv = -(bu - au);
    const len = Math.hypot(nu, nv) || 1;
    nu /= len;
    nv /= len;
    if (nu + nv < 0) {
      nu = -nu;
      nv = -nv;
    }
    const ga = this.glowA();
    if (ga > 0.05 && !this.lod) this.glow((au + bu) / 2 + nu * d, (av + bv) / 2 + nv * d, z - 6, c, 34, ga * 0.6);
    this.begin_();
    this.quad(au, av, z, bu, bv, z, bu + nu * d, bv + nv * d, z - 4, au + nu * d, av + nv * d, z - 4);
    this.fill(css(shade(this.emissive(c, 0.15), 0.85)));
    if (striped && this.g && !this.lod) {
      this.begin_();
      const n = 5;
      for (let i = 0; i < n; i += 1) {
        const t0 = (i + 0.5) / n - 0.05;
        const t1 = t0 + 0.1;
        const pu0 = au + (bu - au) * t0;
        const pv0 = av + (bv - av) * t0;
        const pu1 = au + (bu - au) * t1;
        const pv1 = av + (bv - av) * t1;
        this.quad(pu0, pv0, z, pu1, pv1, z, pu1 + nu * d, pv1 + nv * d, z - 4, pu0 + nu * d, pv0 + nv * d, z - 4);
      }
      this.fill(css(mix(this.emissive(c, 0.4), [255, 255, 255], 0.3), 0.55));
    }
    // Lit valance strip on the outer edge.
    this.neon([au + nu * d, av + nv * d, z - 4.2, bu + nu * d, bv + nv * d, z - 4.2], c, 0.7);
  }

  // ── Rooftop + street clutter ─────────────────────────────────────────────

  /** Small boxy AC unit / generator on a roof. */
  ac(u: number, v: number, z: number, s = 0.07) {
    if (this.lod) return;
    const m = mat([150, 152, 160]);
    this.box(u, v, u + s, v + s * 0.8, z, z + 3.2, m);
    if (!this.g) return;
    // Fan grille on the top.
    const cx = this.X(u + s / 2, v + s * 0.4);
    const cy = this.Y(u + s / 2, v + s * 0.4, z + 3.2);
    this.g.beginPath();
    this.g.ellipse(cx, cy, s * 16, s * 8, 0, 0, Math.PI * 2);
    this.g.fillStyle = this.col(mat([60, 62, 70]), 1);
    this.g.fill();
  }

  /** Water tank on short legs. */
  tank(u: number, v: number, z: number, r = 0.06, h = 6) {
    if (this.lod) return;
    const legs = mat([70, 66, 70]);
    this.begin_();
    this.m(u - r * 0.6, v, z);
    this.l(u - r * 0.6, v, z + 2);
    this.m(u + r * 0.6, v, z);
    this.l(u + r * 0.6, v, z + 2);
    this.stroke(this.col(legs, 0.8), 0.6);
    if (this.luxe) this.cyl(u, v, r, z + 2, z + 2 + h, TANK_LUXE, TANK_LUXE_TOP);
    else if (this.tidy) this.cyl(u, v, r, z + 2, z + 2 + h, TANK_TIDY, TANK_TIDY_TOP);
    else this.cyl(u, v, r, z + 2, z + 2 + h, mat([128, 112, 96]), mat([110, 96, 84]));
  }

  /** Antenna mast with cross bars; adds a blinking tip light. */
  antenna(u: number, v: number, z: number, h: number, light: RGB | null = [255, 59, 92]) {
    this.begin_();
    this.m(u, v, z);
    this.l(u, v, z + h);
    if (!this.lod) {
      for (let i = 1; i <= 2; i++) {
        const zz = z + (h * i) / 3;
        this.m(u - 0.04, v + 0.04, zz);
        this.l(u + 0.04, v - 0.04, zz);
      }
    }
    this.stroke(this.col(mat([140, 140, 150]), 0.7), this.lod ? 1 : 0.6);
    if (light) this.blinker(u, v, z + h, light, 1.2 + this.rng.next() * 0.8);
  }

  /** Register a blinking beacon light (live fx), with a dim static dot baked in. */
  blinker(u: number, v: number, z: number, c: RGB, period = 1.6, size = 14, lodOk = true) {
    const x = this.X(u, v);
    const y = this.Y(u, v, z);
    this.track(x, y, 3);
    this.tz(z);
    const ph = this.rng.next(); // consumed in both passes: keeps recipes deterministic
    if (this.recording) this.fx.push({ k: 'blink', x, y, c, period, ph, size, lodOk });
    const g = this.g;
    if (g) {
      g.fillStyle = css(shade(c, 0.45));
      g.fillRect(x - 0.6, y - 0.6, 1.2, 1.2);
    }
  }

  /** Satellite dish. */
  dish(u: number, v: number, z: number, r = 0.06) {
    if (this.lod) return;
    const x = this.X(u, v);
    const y = this.Y(u, v, z);
    this.track(x - r * 50, y - r * 50);
    this.track(x + r * 50, y + 2);
    const g = this.g;
    if (!g) return;
    g.strokeStyle = this.col(mat([110, 110, 120]), 0.7);
    g.lineWidth = 0.6;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x, y - r * 30);
    g.stroke();
    g.beginPath();
    g.ellipse(x, y - r * 34, r * 40, r * 22, -0.6, 0, Math.PI * 2);
    g.fillStyle = this.col(mat([196, 198, 206]), 0.95);
    g.fill();
    g.beginPath();
    g.ellipse(x + r * 4, y - r * 36, r * 30, r * 15, -0.6, 0, Math.PI * 2);
    g.fillStyle = this.col(mat([150, 152, 164]), 0.8);
    g.fill();
  }

  /** Laundry line between two roof points with hanging cloths. */
  laundry(u0: number, v0: number, u1: number, v1: number, z: number) {
    if (this.lod) return;
    this.begin_();
    this.m(u0, v0, z);
    this.l(u0, v0, z + 5);
    this.l(u1, v1, z + 5);
    this.l(u1, v1, z);
    // $$ and $$$ blocks take their washing in (the bounds and top stay the same).
    if (this.tidy) return;
    this.stroke(this.col(mat([150, 150, 160]), 0.7), 0.4);
    const g = this.g;
    if (!g) return;
    const cloths: RGB[] = [
      [230, 90, 150],
      [90, 200, 230],
      [240, 220, 120],
      [220, 220, 230],
      [150, 110, 230],
    ];
    const cnt = 4;
    for (let i = 0; i < cnt; i++) {
      const t = (i + 0.6) / (cnt + 0.4);
      const u = u0 + (u1 - u0) * t;
      const v = v0 + (v1 - v0) * t;
      const c = cloths[(i + Math.floor(this.seed % 5)) % cloths.length];
      const x = this.X(u, v);
      const y = this.Y(u, v, z + 5);
      g.fillStyle = this.col(mat(c), 0.9);
      g.fillRect(x - 1.1, y, 2.2, 2.4 + (i % 2));
    }
  }

  /** Clump of planter greenery (sky gardens, terraces). */
  greens(u0: number, v0: number, u1: number, v1: number, z: number, count = 5) {
    const leaf = mat([70, 140, 92], [12, 40, 34]);
    for (let i = 0; i < count; i++) {
      const u = u0 + (u1 - u0) * this.rng.next();
      const v = v0 + (v1 - v0) * this.rng.next();
      const r = 1.2 + this.rng.next() * 1.6;
      const x = this.X(u, v);
      const y = this.Y(u, v, z);
      this.track(x - r, y - r * 2);
      this.track(x + r, y + r);
      const g = this.g;
      if (!g) continue;
      g.beginPath();
      g.ellipse(x, y - r * 0.8, r * 1.2, r, 0, 0, Math.PI * 2);
      g.fillStyle = this.col(leaf, 0.9);
      g.fill();
      g.beginPath();
      g.ellipse(x + r * 0.3, y - r * 1.1, r * 0.6, r * 0.45, 0, 0, Math.PI * 2);
      g.fillStyle = this.col(leaf, 1.25);
      g.fill();
    }
    // Garden fairy lights at night.
    if (this.g && this.glowA() > 0.2 && !this.lod) {
      const g = this.g;
      g.fillStyle = css([255, 225, 150], this.glowA());
      for (let i = 0; i < count; i++) {
        const u = u0 + (u1 - u0) * hash2(i, 5, this.seed);
        const v = v0 + (v1 - v0) * hash2(i, 6, this.seed);
        g.fillRect(this.X(u, v) - 0.4, this.Y(u, v, z + 2.2) - 0.4, 0.8, 0.8);
      }
    }
  }

  /** Thick pipe between two 3D points. */
  pipe(u0: number, v0: number, z0: number, u1: number, v1: number, z1: number, w: number, m: Mat) {
    this.begin_();
    this.m(u0, v0, z0);
    this.l(u1, v1, z1);
    const g = this.g;
    if (!g) return;
    g.lineCap = 'butt';
    this.stroke(this.col(m, 0.72), w);
    if (!this.lod) {
      g.beginPath();
      g.moveTo(this.X(u0, v0), this.Y(u0, v0, z0) - w * 0.25);
      g.lineTo(this.X(u1, v1), this.Y(u1, v1, z1) - w * 0.25);
      this.stroke(this.col(m, 1.15, 0.8), w * 0.3);
    }
  }

  /** Smoke stack with hazard bands; registers a smoke plume fx. */
  stack(u: number, v: number, r: number, z0: number, h: number, smoke = true) {
    // A $$$ clean fab: white vent stacks, no hazard bands and no smoke.
    const clean = this.luxe && this.zone === 3;
    const m = clean ? T_WHITE : mat([150, 140, 130]);
    this.cyl(u, v, r, z0, z0 + h, m, clean ? T_WROOF : mat([60, 56, 54]));
    const g = this.g;
    if (g && !this.lod && !clean) {
      const cx = this.X(u, v);
      const cy = this.Y(u, v, 0);
      const rx = r * HALF_W * Math.SQRT2;
      for (const zb of [z0 + h - 6, z0 + h - 12]) {
        g.beginPath();
        g.moveTo(cx - rx, cy - zb);
        g.ellipse(cx, cy - zb, rx, rx / 2, 0, Math.PI, 0, true);
        g.lineTo(cx + rx, cy - zb - 2.5);
        g.ellipse(cx, cy - zb - 2.5, rx, rx / 2, 0, 0, Math.PI, false);
        g.closePath();
        g.fillStyle = this.col(mat([200, 70, 60]), 0.85);
        g.fill();
      }
    }
    this.blinker(u, v, z0 + h + 1, [255, 59, 92], 2.2, 12);
    const ph = this.rng.next();
    if (smoke && !clean && this.recording) this.fx.push({ k: 'smoke', x: this.X(u, v), y: this.Y(u, v, z0 + h), r: Math.max(2.5, r * 40), ph });
  }

  /** Low perimeter fence along a polyline at ground level. */
  fence(pts: number[], h = 3.5) {
    if (this.lod) return;
    const g = this.g;
    const cnt = pts.length / 2;
    this.begin_();
    for (let i = 0; i < cnt; i++) {
      if (i === 0) this.m(pts[0], pts[1], h);
      else this.l(pts[i * 2], pts[i * 2 + 1], h);
    }
    for (let i = 0; i < cnt; i++) {
      this.m(pts[i * 2], pts[i * 2 + 1], 0);
      this.l(pts[i * 2], pts[i * 2 + 1], h);
    }
    if (!g) return;
    this.stroke(this.col(mat([150, 150, 160]), 0.75, 0.9), 0.5);
    // Mesh: translucent fill.
    g.beginPath();
    for (let i = 0; i < cnt - 1; i++) {
      this.quad(pts[i * 2], pts[i * 2 + 1], 0, pts[i * 2 + 2], pts[i * 2 + 3], 0, pts[i * 2 + 2], pts[i * 2 + 3], h, pts[i * 2], pts[i * 2 + 1], h);
    }
    g.fillStyle = this.col(mat([140, 140, 150]), 0.7, 0.22);
    g.fill();
  }

  /** Record pass: some faces get one window that flickers (or glows like a screen) at night. */
  private maybeFlicker(au: number, av: number, bu: number, bv: number, z0: number, z1: number, w: WinSpec) {
    const h = hash2(this.faceId, 7, this.seed);
    if (h > 0.4) return;
    const du = bu - au;
    const dv = bv - av;
    const L = Math.hypot((du - dv) * HALF_W, (du + dv) * HALF_H);
    const cols = Math.max(1, Math.round(L / w.col));
    const mz = w.margin ?? 3;
    const rows = Math.max(0, Math.floor((z1 - z0 - mz * 2 + w.floor * (1 - w.h)) / w.floor));
    if (rows < 1) return;
    const r = Math.min(rows - 1, (w.skip ?? 0) + Math.floor(hash2(this.faceId, 8, this.seed) * (rows - (w.skip ?? 0))));
    const c = Math.floor(hash2(this.faceId, 9, this.seed) * cols);
    const za = z0 + mz + r * w.floor + (w.floor * (1 - w.h)) / 2;
    const zb = za + w.floor * w.h;
    if (zb > z1 - 1) return;
    const full = w.style === 'band' || w.style === 'curtain';
    const t0 = full ? c / cols : (c + (1 - w.w) / 2) / cols;
    const t1 = full ? (c + 1) / cols : (c + (1 + w.w) / 2) / cols;
    const q = [
      this.X(au + du * t0, av + dv * t0), this.Y(au + du * t0, av + dv * t0, za),
      this.X(au + du * t1, av + dv * t1), this.Y(au + du * t1, av + dv * t1, za),
      this.X(au + du * t1, av + dv * t1), this.Y(au + du * t1, av + dv * t1, zb),
      this.X(au + du * t0, av + dv * t0), this.Y(au + du * t0, av + dv * t0, zb),
    ];
    this.fx.push({ k: 'flicker', q, c: h < 0.2 ? this.pal.neon : WARM, tv: h < 0.12, ph: hash2(this.faceId, 10, this.seed) });
  }

  /** Single-slope roof on a box top at z. High edge at the back (u0 for 'u', v0 for 'v'). */
  shed(u0: number, v0: number, u1: number, v1: number, z: number, rise: number, m: Mat, axis: 'u' | 'v' = 'v') {
    const k = K_TOP * 0.95;
    if (axis === 'v') {
      this.begin_();
      this.quad(u0, v0, z + rise, u1, v0, z + rise, u1, v1, z, u0, v1, z);
      this.fill(this.col(m, k));
      this.begin_();
      this.m(u1, v0, z);
      this.l(u1, v0, z + rise);
      this.l(u1, v1, z);
      this.fill(this.col(m, K_RIGHT));
    } else {
      this.begin_();
      this.quad(u0, v0, z + rise, u1, v0, z, u1, v1, z, u0, v1, z + rise);
      this.fill(this.col(m, k));
      this.begin_();
      this.m(u0, v1, z);
      this.l(u0, v1, z + rise);
      this.l(u1, v1, z);
      this.fill(this.col(m, K_LEFT));
    }
    if (this.g && !this.lod) {
      this.begin_();
      if (axis === 'v') {
        this.m(u0, v0, z + rise);
        this.l(u1, v0, z + rise);
      } else {
        this.m(u0, v0, z + rise);
        this.l(u0, v1, z + rise);
      }
      this.stroke(this.col(m, 1.35, 0.8), 0.6);
    }
  }

  /** Gable roof with the ridge along u ('u') or v ('v'). */
  gable(u0: number, v0: number, u1: number, v1: number, z: number, rise: number, m: Mat, ridge: 'u' | 'v' = 'u') {
    if (ridge === 'u') {
      const vm = (v0 + v1) / 2;
      this.begin_();
      this.quad(u0, v0, z, u1, v0, z, u1, vm, z + rise, u0, vm, z + rise);
      this.fill(this.col(m, K_TOP * 0.82));
      this.begin_();
      this.quad(u0, vm, z + rise, u1, vm, z + rise, u1, v1, z, u0, v1, z);
      this.fill(this.col(m, K_TOP * 1.0));
      this.begin_();
      this.m(u1, v0, z);
      this.l(u1, vm, z + rise);
      this.l(u1, v1, z);
      this.fill(this.col(m, K_RIGHT * 0.95));
      if (this.g && !this.lod) {
        this.begin_();
        this.m(u0, vm, z + rise);
        this.l(u1, vm, z + rise);
        this.stroke(this.col(m, 1.35, 0.8), 0.6);
      }
    } else {
      const um = (u0 + u1) / 2;
      this.begin_();
      this.quad(u0, v0, z, um, v0, z + rise, um, v1, z + rise, u0, v1, z);
      this.fill(this.col(m, K_TOP * 0.8));
      this.begin_();
      this.quad(um, v0, z + rise, u1, v0, z, u1, v1, z, um, v1, z + rise);
      this.fill(this.col(m, K_TOP * 0.98));
      this.begin_();
      this.m(u0, v1, z);
      this.l(um, v1, z + rise);
      this.l(u1, v1, z);
      this.fill(this.col(m, K_LEFT * 0.95));
      if (this.g && !this.lod) {
        this.begin_();
        this.m(um, v0, z + rise);
        this.l(um, v1, z + rise);
        this.stroke(this.col(m, 1.35, 0.8), 0.6);
      }
    }
  }

  /** Sawtooth factory roof: `teeth` ridges along u, glazed vertical faces facing +u. */
  saw(u0: number, v0: number, u1: number, v1: number, z: number, rise: number, teeth: number, m: Mat, glow: RGB) {
    const w = (u1 - u0) / teeth;
    const on = this.lights && !this.abandoned;
    const glass = mix(shade(mix(GLASS.day, GLASS_SKY, 0.4), K_RIGHT * 1.15), on ? mix([40, 30, 30], glow, 0.85) : shade(GLASS.night, 0.8), this.n);
    for (let i = 0; i < teeth; i++) {
      const a = u0 + i * w;
      const b = a + w;
      // Sloped roof plane rising towards b.
      this.begin_();
      this.quad(a, v0, z, b, v0, z + rise, b, v1, z + rise, a, v1, z);
      this.fill(this.col(m, K_TOP * 0.92));
      // End triangle (left face).
      this.begin_();
      this.m(a, v1, z);
      this.l(b, v1, z + rise);
      this.l(b, v1, z);
      this.fill(this.col(m, K_LEFT));
      // Glazed vertical face at u = b.
      this.begin_();
      this.quad(b, v0 + 0.03, z, b, v1 - 0.03, z, b, v1 - 0.03, z + rise - 1, b, v0 + 0.03, z + rise - 1);
      this.fill(css(glass));
      if (on && this.n > 0.2 && !this.lod) this.glow(b, (v0 + v1) / 2, z + rise * 0.6, glow, 22, this.n * 0.4);
      if (this.g && !this.lod) {
        this.begin_();
        this.m(a, v1, z);
        this.l(b, v1, z + rise);
        this.l(b, v0, z + rise);
        this.stroke(this.col(m, 1.3, 0.7), 0.5);
      }
    }
  }

  /** Vertical corrugation / panel ribs on the face A→B. */
  ribs(au: number, av: number, bu: number, bv: number, z0: number, z1: number, count: number, m: Mat) {
    if (this.lod || !this.g) return;
    const k = visK(bu - au, bv - av);
    this.begin_();
    for (let i = 1; i < count; i++) {
      const t = i / count;
      this.m(au + (bu - au) * t, av + (bv - av) * t, z0 + 0.5);
      this.l(au + (bu - au) * t, av + (bv - av) * t, z1 - 0.5);
    }
    this.stroke(this.col(m, k * 0.72, 0.8), 0.45);
  }

  /** Roller shutter / door on a face: dark slab with horizontal slats. */
  door(au: number, av: number, bu: number, bv: number, t0: number, t1: number, z0: number, z1: number, lit: RGB | null = null) {
    const du = bu - au;
    const dv = bv - av;
    const k = visK(du, dv);
    const pu0 = au + du * t0;
    const pv0 = av + dv * t0;
    const pu1 = au + du * t1;
    const pv1 = av + dv * t1;
    this.begin_();
    this.quad(pu0, pv0, z0, pu1, pv1, z0, pu1, pv1, z1, pu0, pv0, z1);
    const on = lit && this.lights && !this.abandoned;
    if (on) {
      this.fill(css(mix(this.rgb(mat([70, 72, 82]), k), lit, 0.25 + 0.6 * this.n)));
      this.glow((pu0 + pu1) / 2, (pv0 + pv1) / 2, z0 + 2, lit, 26, this.n * 0.5);
      return;
    }
    this.fill(this.col(mat([88, 90, 100]), k));
    if (this.lod || !this.g) return;
    this.begin_();
    for (let z = z0 + 1.2; z < z1; z += 1.4) {
      this.m(pu0, pv0, z);
      this.l(pu1, pv1, z);
    }
    this.stroke(this.col(mat([60, 62, 72]), k, 0.9), 0.4);
  }

  /** Ellipse ring at height z (railings, platforms, torus hints). */
  ring(cu: number, cv: number, r: number, z: number, m: Mat, w = 0.8, front = false) {
    const cx = this.X(cu, cv);
    const cy = this.Y(cu, cv, z);
    const rx = r * HALF_W * Math.SQRT2;
    this.track(cx - rx, cy - rx / 2);
    this.track(cx + rx, cy + rx / 2);
    const g = this.g;
    if (!g) return;
    g.beginPath();
    if (front) g.ellipse(cx, cy, rx, rx / 2, 0, 0, Math.PI);
    else g.ellipse(cx, cy, rx, rx / 2, 0, 0, Math.PI * 2);
    g.strokeStyle = this.col(m, 0.9);
    g.lineWidth = w;
    g.stroke();
  }

  /** Emissive ring (front half by default) that glows at night and dims when unlit. */
  neonRing(cu: number, cv: number, r: number, z: number, c: RGB, w = 1, full = false) {
    const cx = this.X(cu, cv);
    const cy = this.Y(cu, cv, z);
    const rx = r * HALF_W * Math.SQRT2;
    this.track(cx - rx, cy - rx / 2, 4);
    this.track(cx + rx, cy + rx / 2, 4);
    this.tz(z);
    const g = this.g;
    if (!g) return;
    const a1 = full ? Math.PI * 2 : Math.PI;
    const ga = this.glowA();
    if (ga > 0.04 && !this.lod) {
      g.globalCompositeOperation = 'lighter';
      g.beginPath();
      g.ellipse(cx, cy, rx, rx / 2, 0, 0, a1);
      g.strokeStyle = css(c, 0.12 * ga);
      g.lineWidth = w * 6;
      g.stroke();
      g.strokeStyle = css(c, 0.25 * ga);
      g.lineWidth = w * 2.6;
      g.stroke();
      g.globalCompositeOperation = 'source-over';
    }
    g.beginPath();
    g.ellipse(cx, cy, rx, rx / 2, 0, 0, a1);
    g.strokeStyle = css(this.emissive(c, 0.45));
    g.lineWidth = w;
    g.stroke();
  }

  /** Window bands on the front half of a cylinder. */
  cylBands(cu: number, cv: number, r: number, z0: number, z1: number, floor: number) {
    const g = this.g;
    if (!g) return;
    const cx = this.X(cu, cv);
    const cy = this.Y(cu, cv, 0);
    const rx = r * HALF_W * Math.SQRT2 * 0.995;
    const on = this.lights && !this.abandoned;
    const litFrac = on ? 0.05 + this.n * 0.75 : 0;
    const glassC = css(mix(mix(GLASS.day, GLASS_SKY, 0.3), GLASS.night, this.n));
    const segs = this.lod ? 4 : 9;
    let row = 0;
    for (let z = z0 + floor * 0.6; z < z1 - floor * 0.4; z += floor, row++) {
      g.beginPath();
      g.ellipse(cx, cy - z, rx, rx / 2, 0, 0.12, Math.PI - 0.12);
      g.strokeStyle = glassC;
      g.lineWidth = floor * 0.45;
      g.stroke();
      if (litFrac <= 0) continue;
      for (let s = 0; s < segs; s++) {
        if (hash2(s, row, this.seed + 41) > litFrac) continue;
        const a0 = 0.15 + ((Math.PI - 0.3) * s) / segs;
        g.beginPath();
        g.ellipse(cx, cy - z, rx, rx / 2, 0, a0, a0 + (Math.PI - 0.3) / segs * 0.7);
        g.strokeStyle = css(mix(GLASS.night, hash2(s, row, this.seed) < this.pal.warm ? WARM : COOL, 0.4 + this.n * 0.6));
        g.stroke();
      }
    }
  }

  /** Shipping container: box with ribbed sides. */
  container(u0: number, v0: number, u1: number, v1: number, z: number, h: number, c: RGB) {
    const m = mat(c);
    this.box(u0, v0, u1, v1, z, z + h, m, { uplight: z < 1 });
    const along = u1 - u0 > v1 - v0;
    if (along) this.ribs(u0, v1, u1, v1, z, z + h, Math.round((u1 - u0) * 22), m);
    else this.ribs(u1, v0, u1, v1, z, z + h, Math.round((v1 - v0) * 22), m);
    if (along) this.ribs(u1, v0, u1, v1, z, z + h, 3, m);
    else this.ribs(u0, v1, u1, v1, z, z + h, 3, m);
  }

  /** Little stack of crates. */
  crate(u: number, v: number, z: number, s = 0.08) {
    const m = mat([150, 118, 78]);
    this.box(u, v, u + s, v + s, z, z + s * 50, m, { uplight: false });
    if (this.g && !this.lod) {
      this.begin_();
      this.m(u, v + s, z);
      this.l(u + s, v + s, z + s * 50);
      this.m(u + s, v, z);
      this.l(u + s, v + s, z + s * 50);
      this.stroke(this.col(m, 0.5, 0.7), 0.4);
    }
  }

  /** Parked hover-bike with a glowing under-light. */
  bike(u: number, v: number, c: RGB) {
    if (this.lod) return;
    this.glow(u + 0.06, v + 0.03, 0.5, c, 16, this.n * 0.8);
    const body = mat([46, 46, 58]);
    this.box(u, v, u + 0.14, v + 0.05, 1.6, 3.6, body, { uplight: false });
    this.box(u + 0.08, v + 0.005, u + 0.12, v + 0.045, 3.6, 5, mat([70, 72, 90]), { uplight: false });
    this.neon([u, v + 0.05, 1.8, u + 0.14, v + 0.05, 1.8], c, 0.6);
  }

  /** Bench on the ground. */
  bench(u: number, v: number, along: 'u' | 'v') {
    const m = mat([120, 96, 80]);
    if (along === 'u') this.box(u, v, u + 0.16, v + 0.04, 1.2, 2.2, m, { uplight: false });
    else this.box(u, v, u + 0.04, v + 0.16, 1.2, 2.2, m, { uplight: false });
  }

  /** Landing-pad marking (ring + chevrons) on a flat roof at z. */
  padMark(cu: number, cv: number, r: number, z: number, c: RGB) {
    const g = this.g;
    const cx = this.X(cu, cv);
    const cy = this.Y(cu, cv, z);
    const rx = r * HALF_W * Math.SQRT2;
    this.track(cx - rx, cy - rx / 2);
    this.track(cx + rx, cy + rx / 2);
    if (!g) return;
    g.beginPath();
    g.ellipse(cx, cy, rx, rx / 2, 0, 0, Math.PI * 2);
    g.fillStyle = this.col(mat([60, 62, 72]), 1.0);
    g.fill();
    g.beginPath();
    g.ellipse(cx, cy, rx * 0.82, rx * 0.41, 0, 0, Math.PI * 2);
    g.strokeStyle = css(this.emissive(c, 0.3));
    g.lineWidth = 0.9;
    g.stroke();
    g.beginPath();
    g.moveTo(cx - rx * 0.35, cy);
    g.lineTo(cx, cy - rx * 0.2);
    g.lineTo(cx + rx * 0.35, cy);
    g.moveTo(cx - rx * 0.35, cy + rx * 0.14);
    g.lineTo(cx, cy - rx * 0.06);
    g.lineTo(cx + rx * 0.35, cy + rx * 0.14);
    g.stroke();
    if (!this.lod) this.glow(cu, cv, z, c, rx * 2.4, this.glowA() * 0.35);
  }

  /** Point (world px rel. origin) of tile-space (u, v, z). */
  pt(u: number, v: number, z: number): [number, number] {
    return [this.X(u, v), this.Y(u, v, z)];
  }

  /**
   * Holo billboard on a face plane A→B (t0..t1, z0..z1): a static panel is baked
   * into the sprite (what 'low' quality shows) and an animated board fx on top.
   */
  board(au: number, av: number, bu: number, bv: number, t0: number, t1: number, z0: number, z1: number, style: number, c1: RGB, c2: RGB) {
    const du = bu - au;
    const dv = bv - av;
    const pu0 = au + du * t0;
    const pv0 = av + dv * t0;
    const pu1 = au + du * t1;
    const pv1 = av + dv * t1;
    const ph = this.rng.next();
    if (this.recording) {
      const [ox, oy] = this.pt(pu0, pv0, z0);
      const [x1, y1] = this.pt(pu1, pv1, z0);
      this.fx.push({ k: 'board', ox, oy, ex: x1 - ox, ey: y1 - oy, h: z1 - z0, style, c1, c2, ph });
    }
    // Frame + static content.
    const k = visK(du, dv);
    this.begin_();
    this.quad(pu0, pv0, z0 - 1, pu1, pv1, z0 - 1, pu1, pv1, z1 + 1, pu0, pv0, z1 + 1);
    this.fill(this.col(mat([40, 40, 52]), k));
    this.wallSign(au, av, bu, bv, t0, t1, z0, z1, style % 2 ? c1 : c2, true, (z1 - z0) > 30);
  }

  /** Scrolling ticker band on a face (static strip + live fx). */
  ticker(au: number, av: number, bu: number, bv: number, t0: number, t1: number, z0: number, z1: number, c: RGB) {
    const du = bu - au;
    const dv = bv - av;
    const pu0 = au + du * t0;
    const pv0 = av + dv * t0;
    const pu1 = au + du * t1;
    const pv1 = av + dv * t1;
    const ph = this.rng.next();
    if (this.recording) {
      const [ox, oy] = this.pt(pu0, pv0, z0);
      const [x1, y1] = this.pt(pu1, pv1, z0);
      this.fx.push({ k: 'ticker', ox, oy, ex: x1 - ox, ey: y1 - oy, h: z1 - z0, c1: c, ph });
    }
    const k = visK(du, dv);
    this.begin_();
    this.quad(pu0, pv0, z0, pu1, pv1, z0, pu1, pv1, z1, pu0, pv0, z1);
    this.fill(this.col(PANEL_BG, k));
    this.neon([pu0, pv0, z0, pu1, pv1, z0], c, 0.5);
    this.neon([pu0, pv0, z1, pu1, pv1, z1], c, 0.5);
  }

  /** Declare that something (e.g. a live hologram) reaches height z. */
  reach(z: number) {
    this.tz(z);
  }

  /** Register an arbitrary live effect (record mode only). A $$$ clean fab drops smoke and flares. */
  addFx(f: Fx) {
    if (!this.recording) return;
    if ((f.k === 'smoke' || f.k === 'flame') && this.luxe && this.zone === 3) return;
    this.fx.push(f);
  }
}
