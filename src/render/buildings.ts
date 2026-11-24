// ─────────────────────────────────────────────────────────────────────────────
// Procedural building art: zone buildings, service buildings and placement
// ghosts, drawn in WORLD px (the renderer has already set the world transform).
//
// Pipeline per building
//   1. Pick a *model*: a deterministic recipe (art/zones.ts, art/services.ts,
//      art/ports.ts) + colour scheme + seed. tile.variant selects the
//      silhouette (8 forms) and an accent palette (2) per zone and level, and
//      tile.wealth the tier ($ / $$ / $$$: palette, material restyle and props,
//      EXPANSION §4.5). A model's first use runs its recipe in RECORD mode to
//      measure bounds and collect live-fx anchors.
//   2. Fetch the static body sprite from the SpriteCache, keyed by
//      (body, night bucket, scale bucket, LOD). Bodies bake walls, windows,
//      signs and neon glow, so the per-frame cost is one drawImage.
//   3. Draw the few animated parts live on top (art/fx.ts): billboards, beacons,
//      smoke, strobes, flickering windows, data beams...
//
// Special looks: level-0 lots get subtle props; abandoned buildings are grimy
// with broken windows and no neon; unpowered ones go dark; buildings younger
// than BUILD_TICKS are drawn under construction (rising walls, scaffold, crane).
// ─────────────────────────────────────────────────────────────────────────────

import { BUILDINGS, BUILDING_ORDER } from '../game/config';
import type { Building, BuildingType, Tile } from '../game/types';
import { ZoneType } from '../game/types';
import { drawFx, drawAbandonedLight, type Fx, type FxState } from './art/fx';
import { Painter, type ArtPal } from './art/painter';
import { PORT_PALS, drawPortLive, portRecipe, portVariant, seaportGhostFacing } from './art/ports';
import { SERVICE_PALS, SERVICE_RECIPES } from './art/services';
import { STORY_PALS, STORY_RECIPES } from './art/story';
import { STACK_PAL, STACK_VARIANTS, stackRecipe, stackVariant } from './art/vertical';
import { NIGHT_STEPS, SpriteCache, nightBucket, nightOfBucket, scaleBucket, scaleOfBucket, type Sprite } from './art/sprites';
import { FORMS, LOT_RECIPES, ZONE_PALS, ZONE_RECIPES, dressBase, dressTier, type Recipe } from './art/zones';
import { css, glowSprite } from './palette';

export interface ArtEnv {
  /** Seconds, for animation. */
  time: number;
  /** 0 day .. 1 night (= 1 - game.daylight). */
  night: number;
  /** Camera zoom, for level-of-detail. */
  zoom: number;
  quality: 'low' | 'high';
  /** Draw as translucent placement ghost. */
  ghost?: boolean;
}

/** Below this camera zoom buildings use simplified far-LOD sprites and skip fine fx. */
export const LOD_ZOOM = 0.55;
/** Ticks a freshly (re)built zone building spends under construction. */
export const BUILD_TICKS = 24;

// ── Models ─────────────────────────────────────────────────────────────────

interface Model {
  id: number;
  recipe: Recipe;
  pal: ArtPal;
  seed: number;
  size: number;
  /** Drawn bounds in world px relative to the footprint top corner. */
  bx0: number;
  by0: number;
  bx1: number;
  by1: number;
  /** Highest drawn point above the ground (px). */
  top: number;
  fx: Fx[];
  /** True if the recipe draws nothing (empty lots). */
  empty: boolean;
  /** Developed zone body: its zone (1..3), level (1..3) and wealth tier; zone 0 for lots and services. */
  zone: number;
  level: number;
  tier: 0 | 1 | 2;
}

const painter = new Painter(ZONE_PALS[0][1][0]);
const models = new Map<number, Model>();
/** Zone bodies: 3 zones × 3 levels × 8 forms × 3 tiers × 2 palettes = 432 ids (0..431). */
export const ZONE_BODIES = 432;
/** Lots: 440..463. */
const LOT_BASE = 440;
/** Service, story and port buildings: 480 + type index × STACK_VARIANTS + variant. */
const SERVICE_BASE = 480;

const emptyRecipe = LOT_RECIPES[0][0];

/** Run a model's recipe in the painter's current mode, with the wealth-tier lot plate and props around a zone body. */
function runRecipe(p: Painter, m: Pick<Model, 'recipe' | 'zone' | 'level' | 'tier'>) {
  p.zone = m.zone;
  p.tier = m.tier;
  if (m.zone > 0) {
    dressBase(p);
    p.dressRec = true;
    m.recipe(p);
    p.dressRec = false;
  } else m.recipe(p);
}

function buildModel(id: number, recipe: Recipe, pal: ArtPal, seed: number, size: number, zone = 0, level = 0, tier: 0 | 1 | 2 = 0): Model {
  const p = painter;
  p.g = null;
  p.recording = true;
  p.n = 1;
  p.lights = true;
  p.abandoned = false;
  p.lod = false;
  p.begin(seed, pal);
  runRecipe(p, { recipe, zone, level, tier });
  // The recorded top excludes the tier props, so heights, picking and skybridge checks are tier-independent.
  const top = p.maxZ;
  if (zone > 0) dressTier(p, zone, level);
  p.recording = false;
  p.zone = 0;
  p.tier = 0;
  const empty = recipe === emptyRecipe || !isFinite(p.bx0);
  const m: Model = {
    id,
    recipe,
    pal,
    seed,
    size,
    bx0: empty ? 0 : p.bx0,
    by0: empty ? 0 : p.by0,
    bx1: empty ? 0 : p.bx1,
    by1: empty ? 0 : p.by1,
    top,
    fx: p.fx,
    empty,
    zone,
    level,
    tier,
  };
  p.fx = [];
  models.set(id, m);
  return m;
}

/**
 * Zone model id (EXPANSION §4.5): ((((zone − 1) × 3 + level − 1) × 8 + form) × 3 + tier) × 2 + palBit,
 * 0..431. Decoding: zone = ⌊id / 144⌋ + 1, level = ⌊id / 48⌋ mod 3 + 1, tier = ⌊id / 2⌋ mod 3.
 */
export function zoneModelId(zone: number, level: number, variant: number, tier: number): number {
  const form = variant & (FORMS - 1);
  const palBit = (variant >> 3) & 1;
  const t = tier === 1 || tier === 2 ? tier : 0;
  return ((((zone - 1) * 3 + level - 1) * 8 + form) * 3 + t) * 2 + palBit;
}

function zoneModel(zone: number, level: number, variant: number, tier = 0): Model {
  const form = variant & (FORMS - 1);
  const palBit = (variant >> 3) & 1;
  if (level <= 0) {
    const id = LOT_BASE + (zone - 1) * FORMS + form;
    return models.get(id) ?? buildModel(id, LOT_RECIPES[zone - 1][form], ZONE_PALS[zone - 1][1][palBit], 9000 + id - LOT_BASE + 200, 1);
  }
  const t: 0 | 1 | 2 = tier === 1 || tier === 2 ? tier : 0;
  const id = zoneModelId(zone, level, variant, t);
  const hit = models.get(id);
  if (hit) return hit;
  // Seeded from the pre-tier id, so every tier keeps the same silhouette, heights and wall colours.
  const legacy = ((zone - 1) * 3 + (level - 1)) * 16 + form * 2 + palBit;
  return buildModel(id, ZONE_RECIPES[zone - 1][level - 1][form], ZONE_PALS[zone - 1][t][palBit], 7919 * (legacy + 1) + 13, 1, zone, level, t);
}

const SERVICE_INDEX = new Map<BuildingType, number>(BUILDING_ORDER.map((t, i) => [t, i]));
/** The building fields that pick a model variant (Building satisfies it). */
type VariantKey = Pick<Building, 'type' | 'stage' | 'buildDays' | 'crown'> & Partial<Pick<Building, 'id' | 'facing' | 'waitSec'>>;
/**
 * Model variant of a building: Stratablocks get one per complete stage × scaffold × crown
 * (art/vertical.ts); a Seaport one per facing, a Spaceport one per construction stage (art/ports.ts).
 */
function variantOf(b: VariantKey): number {
  if (b.type !== 'stack') return portVariant(b);
  const stage = b.stage ?? 1;
  const building = (b.buildDays ?? 0) > 0;
  return stackVariant(building ? stage - 1 : stage, building, b.crown);
}
function serviceModel(type: BuildingType, variant = 0): Model {
  const id = SERVICE_BASE + (SERVICE_INDEX.get(type) ?? 0) * STACK_VARIANTS + variant;
  const hit = models.get(id);
  if (hit) return hit;
  const story = (STORY_RECIPES as Partial<Record<BuildingType, Recipe>>)[type];
  const port = portRecipe(type, variant);
  const recipe = type === 'stack' ? stackRecipe(variant) : port ?? story ?? SERVICE_RECIPES[type];
  const pal =
    type === 'stack' ? STACK_PAL : (PORT_PALS as Partial<Record<BuildingType, ArtPal>>)[type] ?? (STORY_PALS as Partial<Record<BuildingType, ArtPal>>)[type] ?? SERVICE_PALS[type];
  return buildModel(id, recipe, pal, 31337 + SERVICE_BASE + (SERVICE_INDEX.get(type) ?? 0), BUILDINGS[type].size);
}

// ── Sprite painting ────────────────────────────────────────────────────────

const cache = new SpriteCache();
const PAD = 3;
const MAX_CANVAS = 2048;
/** States baked into a body sprite. */
const ST_ON = 0;
const ST_DARK = 1;
const ST_ABANDONED = 2;
const ST_GHOST_OK = 3;
const ST_GHOST_BAD = 4;
const STATES = 5;

/** Paint a body sprite at `scale` device px per world px. */
function paintSprite(m: Model, state: number, nb: number, scale: number, lod: boolean): Sprite | null {
  if (typeof document === 'undefined') return null;
  const ox = Math.floor(m.bx0 - PAD);
  const oy = Math.floor(m.by0 - PAD);
  const w0 = Math.ceil(m.bx1 + PAD) - ox;
  const h0 = Math.ceil(m.by1 + PAD) - oy;
  scale = Math.min(scale, MAX_CANVAS / Math.max(w0, h0));
  const cw = Math.max(1, Math.ceil(w0 * scale));
  const ch = Math.max(1, Math.ceil(h0 * scale));
  const canvas = document.createElement('canvas');
  canvas.width = cw;
  canvas.height = ch;
  const g = canvas.getContext('2d');
  if (!g) return null;
  g.setTransform(scale, 0, 0, scale, -ox * scale, -oy * scale);
  const p = painter;
  p.g = g;
  p.recording = false;
  p.n = nightOfBucket(nb);
  p.lights = state === ST_ON || state >= ST_GHOST_OK;
  p.abandoned = state === ST_ABANDONED;
  p.lod = lod;
  // Low and mid-rise zone blocks light more windows and glow brighter at night, so an
  // ordinary mid-size city reads as vibrant as the dense L3 core.
  const level = m.level;
  p.litBoost = level === 1 ? 1.7 : level === 2 ? 1.45 : 1;
  p.glowBoost = level === 1 ? 1.55 : level === 2 ? 1.35 : 1;
  p.begin(m.seed, m.pal);
  runRecipe(p, m);
  if (m.zone > 0) dressTier(p, m.zone, m.level);
  p.zone = 0;
  p.tier = 0;
  p.g = null;
  if (state >= ST_GHOST_OK) {
    // Placement ghost: flatten to a translucent green / red hologram.
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalCompositeOperation = 'source-atop';
    g.fillStyle = state === ST_GHOST_OK ? 'rgba(60,255,170,0.55)' : 'rgba(255,60,90,0.6)';
    g.fillRect(0, 0, cw, ch);
    g.globalCompositeOperation = 'source-over';
  }
  return { canvas, ox, oy, w: cw / scale, h: ch / scale, scale, bytes: cw * ch * 4, used: 0, key: 0, family: 0 };
}

// ── Per-frame state ────────────────────────────────────────────────────────

let frameTime = NaN;
let frameCtx: CanvasRenderingContext2D | null = null;
let frameNightB = 0;
/** Current world → device transform (uniform scale + translation). */
let tA = 1;
let tE = 0;
let tF = 0;
/** Sprite scale code for this frame: a ladder bucket while zooming, else the exact scale. */
let frameScaleCode = 0;
let frameScale = 1;
let lastScale = 0;
let lastScaleChange = -1e9;
/** Seconds the zoom must hold still before sprites are re-painted at the exact scale. */
const SETTLE = 0.2;
/** Max device px per world px a sprite is painted at (memory guard for deep zoom on high-DPR screens). */
const MAX_SPRITE_SCALE = 3.2;
const fxState: FxState = { time: 0, night: 0, lit: true, offline: false, lod: false, phase: 0 };

/** Detect a new frame (time advanced or a different target) and refresh frame constants. */
function sync(ctx: CanvasRenderingContext2D, env: ArtEnv) {
  if (env.time === frameTime && ctx === frameCtx) return;
  frameTime = env.time;
  frameCtx = ctx;
  cache.newFrame();
  cache.budgetMs = env.quality === 'low' ? 2 : 3.5;
  const t = ctx.getTransform();
  tA = t.a;
  tE = t.e;
  tF = t.f;
  const scale = Math.hypot(t.a, t.b);
  if (Math.abs(scale - lastScale) > 1e-6) {
    // The very first frame counts as settled: paint exact sprites straight away.
    if (lastScale !== 0) lastScaleChange = env.time;
    lastScale = scale;
  }
  if (env.time - lastScaleChange >= SETTLE || env.time < lastScaleChange) {
    // Settled: exact-scale sprites, blitted 1:1 (crisp, and the fastest path everywhere).
    frameScale = Math.min(scale, MAX_SPRITE_SCALE);
    frameScaleCode = 64 + Math.round(frameScale * 256);
  } else {
    const b = scaleBucket(scale);
    frameScale = scaleOfBucket(b);
    frameScaleCode = b;
  }
  frameNightB = nightBucket(env.night);
}

function sprite(m: Model, state: number, lod: boolean): Sprite | null {
  const body = m.id * STATES + state;
  // Ghosts always use the bright day palette so the hologram reads at night too.
  const nb = state >= ST_GHOST_OK ? 0 : frameNightB;
  const key = ((body * NIGHT_STEPS + nb) * 4096 + frameScaleCode) * 2 + (lod ? 1 : 0);
  return cache.get(key, body, () => paintSprite(m, state, nb, frameScale, lod));
}

function blit(ctx: CanvasRenderingContext2D, s: Sprite, wx: number, wy: number) {
  if (Math.abs(s.scale - tA) < tA * 0.004) {
    // 1:1 device-pixel blit, no resampling.
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(s.canvas, Math.round(tA * (wx + s.ox) + tE), Math.round(tA * (wy + s.oy) + tF));
    ctx.setTransform(tA, 0, 0, tA, tE, tF);
  } else ctx.drawImage(s.canvas, wx + s.ox, wy + s.oy, s.w, s.h);
}

/** Stable 0..1 phase per tile so neighbouring buildings don't blink in sync. */
function tilePhase(tx: number, ty: number): number {
  return (((tx * 73856093) ^ (ty * 19349663)) >>> 0) % 1000 / 1000;
}

// ── Construction ───────────────────────────────────────────────────────────

let scaffoldCol = '';
let scaffoldNight = -1;
let craneCol = '';
function constructionColours(n: number) {
  const b = Math.round(n * 10);
  if (b === scaffoldNight) return;
  scaffoldNight = b;
  const k = 1 - n * 0.55;
  scaffoldCol = css([214 * k, 170 * k, 70 * k], 0.9);
  craneCol = css([236 * k, 196 * k, 60 * k]);
}

function drawConstruction(ctx: CanvasRenderingContext2D, s: Sprite | null, m: Model, wx: number, wy: number, tile: Tile, env: ArtEnv, phase: number) {
  const prog = Math.min(1, (tile.age + 0.5) / BUILD_TICKS);
  const H = Math.max(8, m.top);
  const zc = Math.max(2, H * prog * 0.92);
  // 1. Walls revealed up to zc: clip to everything below the raised footprint's front edges.
  if (s) {
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(wx - 40, wy + 16 - zc);
    ctx.lineTo(wx, wy + 32 - zc);
    ctx.lineTo(wx + 40, wy + 16 - zc);
    ctx.lineTo(wx + 40, wy + 48);
    ctx.lineTo(wx - 40, wy + 48);
    ctx.closePath();
    ctx.clip();
    blit(ctx, s, wx, wy);
    ctx.restore();
  }
  // 2. Floor plate being poured at zc.
  const n = env.night;
  constructionColours(n);
  const i0 = 0.16;
  const i1 = 0.84;
  const P = (u: number, v: number, z: number) => [wx + (u - v) * 32, wy + (u + v) * 16 - z] as const;
  ctx.fillStyle = n > 0.5 ? '#2a2838' : '#8a8c98';
  ctx.beginPath();
  let q = P(i0, i0, zc);
  ctx.moveTo(q[0], q[1]);
  q = P(i1, i0, zc);
  ctx.lineTo(q[0], q[1]);
  q = P(i1, i1, zc);
  ctx.lineTo(q[0], q[1]);
  q = P(i0, i1, zc);
  ctx.lineTo(q[0], q[1]);
  ctx.closePath();
  ctx.fill();
  // 3. Scaffold cage a little above the work level.
  const zs = Math.min(H, zc + 9);
  const a = 0.1;
  const b = 0.9;
  ctx.strokeStyle = scaffoldCol;
  ctx.lineWidth = 0.6;
  ctx.beginPath();
  for (const [u, v] of [
    [b, a],
    [b, b],
    [a, b],
  ]) {
    const p0 = P(u, v, 0);
    const p1 = P(u, v, zs);
    ctx.moveTo(p0[0], p0[1]);
    ctx.lineTo(p1[0], p1[1]);
  }
  for (let z = 6; z <= zs; z += 7) {
    const l = P(a, b, z);
    const f = P(b, b, z);
    const r = P(b, a, z);
    ctx.moveTo(l[0], l[1]);
    ctx.lineTo(f[0], f[1]);
    ctx.lineTo(r[0], r[1]);
  }
  // Diagonal braces on the two visible faces.
  for (let z = 0; z + 7 <= zs; z += 14) {
    const l0 = P(a, b, z);
    const f1 = P(b, b, z + 7);
    const r0 = P(b, a, z);
    ctx.moveTo(l0[0], l0[1]);
    ctx.lineTo(f1[0], f1[1]);
    ctx.lineTo(r0[0], r0[1]);
  }
  ctx.stroke();
  // 4. Tower crane for mid/high-rise.
  if (tile.level >= 2) {
    const top = H + 16;
    const mast0 = P(0.08, 0.08, 0);
    const mast1 = P(0.08, 0.08, top);
    const jib = P(1.05, 0.08, top);
    const counter = P(-0.25, 0.08, top);
    const swing = Math.sin(env.time * 0.3 + phase * 6) * 0.25;
    const hook = P(0.6 + swing, 0.08 + swing * 0.5, zc + 10);
    const trolley = P(0.6 + swing, 0.08, top);
    ctx.strokeStyle = craneCol;
    ctx.lineWidth = 1.1;
    ctx.beginPath();
    ctx.moveTo(mast0[0], mast0[1]);
    ctx.lineTo(mast1[0], mast1[1]);
    ctx.moveTo(counter[0], counter[1]);
    ctx.lineTo(jib[0], jib[1]);
    ctx.stroke();
    ctx.lineWidth = 0.4;
    ctx.beginPath();
    ctx.moveTo(trolley[0], trolley[1]);
    ctx.lineTo(hook[0], hook[1]);
    ctx.stroke();
    ctx.fillStyle = craneCol;
    ctx.fillRect(hook[0] - 1.5, hook[1], 3, 2);
    ctx.fillRect(counter[0], counter[1] - 1, 5, 3);
    // Red tip light.
    if (env.quality === 'high' && (env.time * 1.2 + phase) % 1 < 0.2) {
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.5 + 0.5 * n;
      ctx.drawImage(glowSprite([255, 59, 92], 64), mast1[0] - 7, mast1[1] - 9, 14, 14);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    }
  }
  // 5. Welding sparks + work lamp at night.
  if (env.quality === 'high' && env.zoom >= LOD_ZOOM) {
    ctx.globalCompositeOperation = 'lighter';
    if (n > 0.25) {
      const lamp = P(0.5, 0.5, zc + 4);
      ctx.globalAlpha = n * 0.5;
      ctx.drawImage(glowSprite([255, 220, 150], 64), lamp[0] - 22, lamp[1] - 16, 44, 32);
    }
    const k = Math.floor(env.time * 9 + phase * 50);
    if (k % 3 !== 0) {
      const su = 0.2 + ((k * 37) % 60) / 100;
      const sp = P(su, 0.84, zc);
      ctx.globalAlpha = 0.9;
      ctx.fillStyle = '#fff3c0';
      ctx.fillRect(sp[0] - 0.6, sp[1] - 0.6, 1.2, 1.2);
      ctx.globalAlpha = 0.5;
      ctx.drawImage(glowSprite([120, 200, 255], 64), sp[0] - 5, sp[1] - 5, 10, 10);
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }
}

// ── Public API ─────────────────────────────────────────────────────────────

/** Zone building on tile (tx,ty) whose top corner is world (wx,wy). Handles level 0 lot props, abandoned look and construction (tile.age small). */
export function drawZoneBuilding(ctx: CanvasRenderingContext2D, wx: number, wy: number, tile: Tile, tx: number, ty: number, env: ArtEnv): void {
  const zone = tile.zone;
  if (zone === ZoneType.None) return;
  const m = zoneModel(zone, tile.level, tile.variant, tile.wealth);
  if (m.empty) return;
  sync(ctx, env);
  const lod = env.zoom < LOD_ZOOM;
  const alpha0 = ctx.globalAlpha;
  if (env.ghost) ctx.globalAlpha = alpha0 * 0.5;

  if (tile.level === 0) {
    const s = sprite(m, ST_ON, lod);
    if (s) blit(ctx, s, wx, wy);
    ctx.globalAlpha = alpha0;
    return;
  }

  const building = !tile.abandoned && tile.age < BUILD_TICKS;
  const state = tile.abandoned ? ST_ABANDONED : building || !tile.powered ? ST_DARK : ST_ON;
  const s = sprite(m, state, lod);
  const phase = tilePhase(tx, ty);
  if (building) {
    drawConstruction(ctx, s, m, wx, wy, tile, env, phase);
    ctx.globalAlpha = alpha0;
    return;
  }
  if (s) blit(ctx, s, wx, wy);

  if (env.quality === 'high' && !env.ghost) {
    if (state === ST_ON && m.fx.length) {
      fxState.time = env.time;
      fxState.night = env.night;
      fxState.lit = true;
      fxState.offline = false;
      fxState.lod = lod;
      fxState.phase = phase;
      drawFx(ctx, m.fx, wx, wy, fxState);
    } else if (state === ST_ABANDONED && !lod && env.night > 0.4 && phase < 0.35) {
      // A lone squatter's light in the dark shell.
      drawAbandonedLight(ctx, m.fx, wx, wy, env.time, env.night, phase);
    }
  }
  ctx.globalAlpha = alpha0;
}

/** Service building; (wx,wy) = world top corner of the footprint's (b.x,b.y) tile. */
export function drawServiceBuilding(ctx: CanvasRenderingContext2D, wx: number, wy: number, b: Building, env: ArtEnv): void {
  if (env.ghost) {
    drawBuildingGhost(ctx, wx, wy, b.type, true, env);
    return;
  }
  const def = BUILDINGS[b.type];
  if (!def) return;
  sync(ctx, env);
  const m = serviceModel(b.type, variantOf(b));
  const on = b.offline <= 0 && (b.powered || def.powerSupply > 0);
  const lod = env.zoom < LOD_ZOOM;
  const s = sprite(m, on ? ST_ON : ST_DARK, lod);
  if (s) blit(ctx, s, wx, wy);
  if (env.quality === 'high' && m.fx.length) {
    fxState.time = env.time;
    fxState.night = env.night;
    fxState.lit = on;
    fxState.offline = !on;
    fxState.lod = lod;
    fxState.phase = tilePhase(b.x, b.y);
    drawFx(ctx, m.fx, wx, wy, fxState);
  }
  // Port live parts drawn in the building's depth slot: crane trolleys and moored ships, the tower beacon, pad steam.
  if (def.category === 'transport') {
    drawPortLive(ctx, wx, wy, b, env, on);
    ctx.setTransform(tA, 0, 0, tA, tE, tF);
  }
}

/** Ghost for placement preview of a building type. */
export function drawBuildingGhost(ctx: CanvasRenderingContext2D, wx: number, wy: number, type: BuildingType, ok: boolean, env: ArtEnv): void {
  if (!BUILDINGS[type]) return;
  sync(ctx, env);
  const variant = type === 'stack' ? stackVariant(1, false, undefined) : type === 'seaport' ? seaportGhostFacing() : portVariant({ type });
  const m = serviceModel(type, variant);
  const s = sprite(m, ok ? ST_GHOST_OK : ST_GHOST_BAD, env.zoom < LOD_ZOOM);
  if (!s) return;
  const a0 = ctx.globalAlpha;
  const pulse = 0.5 + 0.5 * Math.sin(env.time * 5);
  ctx.globalAlpha = a0 * (0.5 + 0.1 * pulse);
  blit(ctx, s, wx, wy);
  // Additive second pass makes the hologram glow over dark ground.
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = a0 * (0.12 + 0.12 * pulse);
  blit(ctx, s, wx, wy);
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = a0;
}

const zoneHeights = new Float32Array(SERVICE_BASE).fill(-1);
/** Approx pixel height above the ground of what drawZoneBuilding draws (renderer uses it for culling + unpowered icons). Tier-independent. */
export function zoneBuildingHeight(tile: Tile): number {
  if (tile.zone === ZoneType.None) return 0;
  if (tile.level <= 0) return 8;
  const id = zoneModelId(tile.zone, tile.level, tile.variant, tile.wealth);
  let h = zoneHeights[id];
  if (h < 0) {
    h = zoneModel(tile.zone, tile.level, tile.variant, tile.wealth).top;
    zoneHeights[id] = h;
  }
  return h;
}

const serviceHeights = new Map<number, number>();
/**
 * Approx pixel height of a service building above the ground (culling, selection box,
 * status icons, skybridge height). Pass the building for stage-aware Stratablocks
 * (60 / 150 / 210 px by complete stage).
 */
export function serviceBuildingHeight(type: BuildingType, b?: VariantKey): number {
  if (!BUILDINGS[type]) return 40;
  const variant = b ? variantOf(b) : type === 'stack' ? stackVariant(1, false, undefined) : portVariant({ type });
  const key = (SERVICE_INDEX.get(type) ?? 0) * STACK_VARIANTS + variant;
  let h = serviceHeights.get(key);
  if (h === undefined) {
    h = serviceModel(type, variant).top;
    serviceHeights.set(key, h);
  }
  return h;
}

/** Recorded facts of a zone body model (tests, harnesses): its id, seed, top and live-fx count. */
export function zoneModelInfo(zone: number, level: number, variant: number, tier: number): { id: number; seed: number; top: number; fx: number; zone: number; level: number; tier: number } {
  const m = zoneModel(zone, level, variant, tier);
  return { id: m.id, seed: m.seed, top: m.top, fx: m.fx.length, zone: m.zone, level: m.level, tier: m.tier };
}

/** Drop every cached sprite (e.g. on context loss). Models are kept. */
export function clearBuildingCache() {
  cache.clear();
}

/** Debug stats for perf overlays / harnesses. */
export function buildingCacheStats() {
  return { sprites: cache.size, bytes: cache.bytes, builtThisFrame: cache.built };
}
