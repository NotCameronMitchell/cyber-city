// ─────────────────────────────────────────────────────────────────────────────
// Procedural building art: zone buildings, service buildings and placement
// ghosts, drawn in WORLD px (the renderer has already set the world transform).
//
// Pipeline per building
//   1. Pick a *model*: a deterministic recipe + colour scheme + seed.
//      Zone bodies (MEGACITY §6.1): the tile (or its merged parcel's head)
//      picks a body with art/kit.ts pickForm: one of today's 8 hand-built
//      forms (zones.ts), a parametric kit template or the district style's own
//      silhouette, drawn in the district's style and variant accent; the wealth
//      tier ($ / $$ / $$$) restyles it (EXPANSION §4.5); under an ending's
//      skyline takeover a tower draws in that ending's language (art/legacy.ts).
//      Every body's main mass reaches the tile's height truth (heights.ts).
//      Service models: today's recipe for look 0, the faction designs, district
//      looks and landmarks of art/faction.ts, services.ts, landmarks.ts and
//      legacy.ts for the rest (MEGACITY §6.2, §6.3, §9.2), standing lit.
//      A model's first use runs its recipe in RECORD mode to measure bounds and
//      collect live-fx and signature anchors.
//   2. Fetch the static body sprite from the SpriteCache, keyed by
//      (body, night bucket, scale bucket, LOD). Bodies bake walls, windows,
//      signs and neon glow, so the per-frame cost is one drawImage. A kit body
//      never painted yet shows its classic body until its turn in the budget.
//   3. Draw the few animated parts live on top (art/fx.ts) and the faction
//      signatures (art/faction.ts drawSigs).
//
// Special looks: level-0 lots get subtle props; abandoned buildings are grimy
// with broken windows and no neon; unpowered ones go dark; buildings younger
// than BUILD_TICKS are drawn under construction (rising walls, scaffold, crane).
// ─────────────────────────────────────────────────────────────────────────────

import { BUILDINGS, BUILDING_ORDER } from '../game/config';
import { CLASSIC_TOPS, classicId } from '../game/heights';
import { hash2 } from '../game/rng';
import { skylineLang } from '../game/marks';
import { standing } from '../game/story/factions';
import type { EndingId, FactionId } from '../game/story/types';
import type { Building, BuildingType, DistrictKind, Parcel, Tile } from '../game/types';
import { ZoneType } from '../game/types';
import type { World } from '../game/world';
import { HALF_H, HALF_W } from './camera';
import { BANNERS, CROWN_FACTION, DESIGNS, FACTION_BUILDING_LOOKS, FACTION_PALS, FAMILY_FACTION, SPIRE_LOOKS, drawSigs, type Design, type SigState } from './art/faction';
import { drawFx, drawAbandonedLight, type Fx, type FxState } from './art/fx';
import { KIT_FIRST, classicDress, drawKit, lodBody, pickForm, type Body, type KitCtx } from './art/kit';
import { LANDMARK_PALS, PUMP_GARDEN, pumphallRecipe } from './art/landmarks';
import { ENDING_PALS, LANDMARK_ENDING, LEGACY_LANGS, drawLegacy, endingLandmarkRecipe, lanternDress, legacyLang, legacyPal, type LegacyLang } from './art/legacy';
import { Painter, mat, type ArtPal, type Sig } from './art/painter';
import { PORT_PALS, drawPortLive, portRecipe, portVariant, seaportGhostFacing } from './art/ports';
import { SERVICE_PALS, SERVICE_RECIPES, STYLED_SERVICES, arcologyRecipe, serviceStyleRecipe } from './art/services';
import { NIGHT_STEPS, SpriteCache, nightBucket, nightOfBucket, scaleBucket, scaleOfBucket, type Sprite } from './art/sprites';
import { STORY_PALS, STORY_RECIPES, memorialLowerWards } from './art/story';
import { STYLES, accentBody, serviceLookGroup, styleCap, styleDress, styleIndex, stylePal, tintFor, topOf, variantAccent, type StyleDef } from './art/styles';
import { STACK_PAL, stackRecipe, stackVariant } from './art/vertical';
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
  /**
   * The world's art offset (MEGACITY §3.2, `artOffset(world)`): per-tile phases hash art coordinates (x − o, y − o),
   * so a migrated start slot blinks, builds and lights its shells exactly as on the 64 map. 0 (the default) = tile
   * coordinates.
   */
  artOffset?: number;
  /**
   * The world being drawn (MEGACITY §6.1, §6.2, §9): district styles and variant accents per tile, faction standing
   * (Allied / Hostile light), the ending (takeover, ending landmarks) and the pump hall's look. Absent: every body
   * draws in the Charter Shore style with neutral standing.
   */
  world?: World;
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
  /** Faction signature anchors (MEGACITY §6.2). */
  sig: Sig[];
  /** True if the recipe draws nothing (empty lots). */
  empty: boolean;
  /** Developed zone body: its zone (1..3), level (1..3) and wealth tier; zone 0 for lots and services. */
  zone: number;
  level: number;
  tier: 0 | 1 | 2;
  /** Zone footprint in tiles (a parcel's W × H). */
  W: number;
  H: number;
  /** District style tint of today's forms (null = today's materials). */
  sty: StyleDef['tint'];
  /** Dressing after the recipe (style props, the classic parameter sets, Lamplight's lantern roof); never raises the top. */
  post: ((p: Painter) => void) | null;
  /** Standing light: 0 as today, 1 Allied (brighter, banners out), 2 Hostile (half light, banners down). */
  standing: 0 | 1 | 2;
  /** Kit bodies: the classic model drawn until this one is painted (-1 none). */
  fallback: number;
}

const painter = new Painter(ZONE_PALS[0][1][0]);
const models = new Map<number, Model>();
/** Zone bodies: 3 zones × 3 levels × 8 forms × 3 tiers × 2 palettes = 432 ids (0..431). */
export const ZONE_BODIES = 432;
/** Lots: 440..463. */
const LOT_BASE = 440;
/** Below this, zone and lot ids (0..479); the zone height table is sized by it. */
const SERVICE_BASE = 480;
/**
 * Service model ids (MEGACITY §6.1, frozen in Step 0b): SERVICE_KIT_BASE + ((typeIndex × 16 + look) × 10 + style) × 64
 * + variant (look = sponsor × 4 + look for Spires, < 16; style 0..9; variant < 64), below 2,600,000 for up to 57
 * types. Ids are cache keys, never saved. Kit zone ids (KIT_BASE 1,000,000) and SKY_BASE 4,000 / BRIDGE_BASE 5,000
 * stay disjoint from it.
 */
export const SERVICE_KIT_BASE = 2_000_000;
/**
 * Kit zone bodies (MEGACITY §6.1): ids are handed out from KIT_BASE in the order bodies are first used (a cache key,
 * never saved), so they stay below 1,210,000 however large the body space is.
 */
export const KIT_BASE = 1_000_000;
export const KIT_ID_CAP = 210_000;
export function serviceModelId(typeIndex: number, look: number, style: number, variant: number): number {
  return SERVICE_KIT_BASE + ((typeIndex * 16 + look) * 10 + style) * 64 + variant;
}

const emptyRecipe = LOT_RECIPES[0][0];

/** Run a model's recipe in the painter's current mode: lot plate, recipe, then its dressing (not the tier props). */
function runRecipe(p: Painter, m: Pick<Model, 'recipe' | 'zone' | 'level' | 'tier' | 'W' | 'H' | 'sty' | 'standing'>) {
  p.zone = m.zone;
  p.tier = m.tier;
  p.sty = m.sty;
  BANNERS.on = m.standing !== 2;
  if (m.zone > 0) {
    dressBase(p, m.W, m.H);
    p.dressRec = true;
    m.recipe(p);
    p.dressRec = false;
  } else m.recipe(p);
  p.sty = null;
  BANNERS.on = true;
}

interface ModelOpts {
  W?: number;
  H?: number;
  sty?: StyleDef['tint'];
  post?: ((p: Painter) => void) | null;
  standing?: 0 | 1 | 2;
  fallback?: number;
}

function buildModel(id: number, recipe: Recipe, pal: ArtPal, seed: number, size: number, zone = 0, level = 0, tier: 0 | 1 | 2 = 0, o: ModelOpts = {}): Model {
  const p = painter;
  p.g = null;
  p.recording = true;
  p.n = 1;
  p.lights = true;
  p.abandoned = false;
  p.lod = false;
  p.begin(seed, pal);
  const spec = { recipe, zone, level, tier, W: o.W ?? 1, H: o.H ?? 1, sty: o.sty ?? null, standing: o.standing ?? 0 };
  runRecipe(p, spec);
  // The recorded top excludes the dressing and the tier props, so heights, picking and skybridge checks agree.
  const top = p.maxZ;
  if (o.post) {
    p.sty = spec.sty;
    o.post(p);
    p.sty = null;
  }
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
    sig: p.sig,
    empty,
    zone,
    level,
    tier,
    W: spec.W,
    H: spec.H,
    sty: spec.sty,
    post: o.post ?? null,
    standing: spec.standing,
    fallback: o.fallback ?? -1,
  };
  p.fx = [];
  p.sig = [];
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

/** Today's body of a zone tile (Charter Shore, parameter set 0): look 0, exactly today's art. */
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
  return buildModel(id, ZONE_RECIPES[zone - 1][level - 1][form], ZONE_PALS[zone - 1][t][palBit], classicSeed(zone, level, form, palBit), 1, zone, level, t);
}
/** Seeded from the pre-tier id, so every tier keeps the same silhouette, heights and wall colours. */
function classicSeed(zone: number, level: number, form: number, palBit: number): number {
  const legacy = ((zone - 1) * 3 + (level - 1)) * 16 + form * 2 + palBit;
  return 7919 * (legacy + 1) + 13;
}

// ── The art frame: the world being drawn ───────────────────────────────────

/** The world of the current frame (env.world), its standings, ending and pump hall look. */
const art = {
  world: null as World | null,
  /** Standing band per faction: 0 as today, 1 Allied, 2 Hostile. */
  bands: { board: 0, basalt: 0, nacre: 0, undertow: 0, kites: 0, tuning: 0 } as Record<FactionId, 0 | 1 | 2>,
  ending: null as EndingId | null,
  lamplight: false,
  pumphall: 0,
};
const FACTIONS: FactionId[] = ['board', 'basalt', 'nacre', 'undertow', 'kites', 'tuning'];

/** Refresh the frame's world facts (once a frame; six standing reads). */
function bindWorld(world: World | null) {
  art.world = world;
  if (!world) {
    for (const f of FACTIONS) art.bands[f] = 0;
    art.ending = null;
    art.lamplight = false;
    art.pumphall = 0;
    return;
  }
  const st = world.story;
  for (const f of FACTIONS) {
    let v = 0;
    try {
      v = st ? standing(world, f) : 0;
    } catch {
      v = 0;
    }
    art.bands[f] = v >= 60 ? 1 : v <= -60 ? 2 : 0;
  }
  art.ending = st?.ending ?? null;
  art.lamplight = !!st && st.ending === 'quiet' && st.endingVariant === 'lamplight';
  art.pumphall = pumphallLook(world);
}

/** The pump hall's look after ch4.brine (§9.3): 0 sealed, 1 open, 2 private works, 3 archive, 4 poured, 5 every lamp lit, 6 Ohm's door. */
function pumphallLook(world: World): number {
  const f = world.story?.flags ?? {};
  const on = (k: string) => !!f[k];
  if (on('fullRecall')) return 5;
  if (on('hallPoured')) return 4;
  if (on('published') || on('hallOpened')) return on('hiddenByTuning') ? 6 : 1;
  if (on('buried')) return 2;
  if (on('leashed')) return on('unleashed') ? 1 : 3;
  if (on('hiddenByTuning')) return 6;
  return 0;
}

/** District style and variant accent at a tile (Charter Shore without a world). */
function styleAt(x: number, y: number): { kind: DistrictKind; variant: number } {
  const w = art.world;
  if (!w || !w.inBounds(x, y)) return { kind: 'shore', variant: 0 };
  return { kind: w.kindAt(x, y), variant: w.variantOf(w.slotAt(x, y)) };
}

// ── Kit zone bodies ────────────────────────────────────────────────────────

const kitIds = new Map<number, number>();
let kitNext = 0;

/** The parameters of a zone body draw (one tile or a parcel head). */
interface ZoneSpec {
  zone: number;
  level: number;
  tier: 0 | 1 | 2;
  /** 0 single, 1 pair, 2 quad. */
  shape: number;
  W: number;
  H: number;
  /** The tile's variant (today's form and palette, the height truth). */
  variant: number;
  kind: DistrictKind;
  dvar: number;
  body: Body;
  /** Takeover language, or null. */
  lang: LegacyLang | null;
  /** Lamplight's lantern roof. */
  lantern: boolean;
}

/** Height truth of a body: the classic top of the tile's form at the drawn level (heights.ts heightOf). */
function truthTop(zone: number, level: number, variant: number, tier: number): number {
  return CLASSIC_TOPS[classicId(zone, level, variant, tier)] ?? 24;
}

function kitModel(sp: ZoneSpec): Model {
  const { zone, level, tier, shape, W, H, variant, kind, dvar, body, lang, lantern } = sp;
  const palBit = (variant >> 3) & 1;
  const hc = variant & 7;
  const st = STYLES[kind];
  const styleKey = lang ? 9 + LEGACY_LANGS.indexOf(lang) : st.index;
  // Charter Shore, a today's form, parameter set 0, no lantern: exactly today's model.
  if (!lang && !lantern && body.form < KIT_FIRST && body.form === hc && body.seed === 0 && kind === 'shore') return zoneModel(zone, level, variant, tier);
  const key = ((((((((((zone * 4 + level) * 3 + tier) * 16 + styleKey) * 4 + (dvar & 3)) * 32 + body.form) * 3 + shape) * 2 + palBit) * 4 + body.seed) * 8 + hc) * 2 + (lantern ? 1 : 0));
  let id = kitIds.get(key);
  if (id !== undefined) {
    const hit = models.get(id);
    if (hit) return hit;
  } else {
    id = KIT_BASE + (kitNext++ % KIT_ID_CAP);
    kitIds.set(key, id);
  }
  const T = truthTop(zone, level, variant, tier);
  const acc = variantAccent(kind, dvar);
  // The body's neon pick (§3.7, §6.1): the district accent on a share of the bodies, a style sign colour on the rest.
  const pick = hash2(body.form * 7 + body.seed * 3 + shape, hc * 5 + palBit * 2 + level * 13, 0x5a1e + st.index);
  const accBody = accentBody(st, pick);
  const pal = lang ? legacyPal(lang) : stylePal(ZONE_PALS[zone - 1][tier][palBit], st, acc, pick);
  const seed = classicSeed(zone, level, hc, palBit) + body.form * 131 + body.seed * 17 + styleKey * 1009;
  const fallback = zoneModelId(zone, level, variant, tier);
  let recipe: Recipe;
  let sty: StyleDef['tint'] = null;
  if (lang) {
    recipe = (p) => drawLegacy(p, lang, zone, shape, W, H, T, body.seed);
  } else if (body.form < KIT_FIRST) {
    recipe = ZONE_RECIPES[zone - 1][level - 1][body.form];
    sty = tintFor(st, hc + body.seed * 3 + palBit);
  } else {
    const k: KitCtx = { W, H, T, s: body.seed, lv: level, zone, tier, st, acc };
    recipe = (p) => drawKit(p, zone, body.form, k);
  }
  const classic = !lang && body.form < KIT_FIRST;
  const post = (p: Painter) => {
    if (classic) classicDress(p, body.seed, zone, level, acc);
    if (!lang) styleDress(p, st, acc, zone, level, W, H, accBody);
    if (classic && !lang) styleCap(p, st, body.seed + hc, level);
    if (lantern) lanternDress(p, topOf(p));
  };
  return buildModel(id, recipe, pal, classic ? classicSeed(zone, level, body.form, palBit) : seed, Math.max(W, H), zone, level, tier, { W, H, sty, post, fallback: classic && kind === 'shore' ? -1 : fallback });
}

/** The zone spec of a tile (or a parcel head) at (x, y). */
function zoneSpec(tile: Tile, x: number, y: number, parcel: Parcel | null, env: ArtEnv, lodPick: boolean): ZoneSpec {
  const zone = tile.zone;
  const level = parcel ? parcel.level : tile.level;
  const tierN = parcel ? parcel.tier : tile.wealth;
  const tier: 0 | 1 | 2 = tierN === 1 || tierN === 2 ? tierN : 0;
  const shape = parcel ? (parcel.w === 2 && parcel.h === 2 ? 2 : 1) : 0;
  const W = parcel ? parcel.w : 1;
  const H = parcel ? parcel.h : 1;
  const { kind, variant: dvar } = styleAt(x, y);
  const ao = env.artOffset ?? 0;
  const ax = x - ao;
  const ay = y - ao;
  let lang: LegacyLang | null = null;
  let lantern = false;
  if (level === 3 && (shape > 0 || zone !== ZoneType.Industrial)) {
    const e = skylineLang(ax, ay);
    if (e) lang = legacyLang(e, ax, ay);
  }
  if (!lang && art.lamplight && zone === ZoneType.Residential && level >= 2) {
    const e = skylineLang(ax, ay);
    lantern = e === 'quiet';
  }
  let body: Body;
  if (lang) body = { form: 0, seed: (ax * 3 + ay) & 3 };
  else {
    body = pickForm(zone, level, shape, tier, kind, ax, ay, tile.variant, tile.variant & 7, (tile.variant >> 3) & 1);
    if (lodPick) body = lodBody(zone, level, shape, tier, kind, body);
  }
  return { zone, level, tier, shape, W, H, variant: tile.variant, kind, dvar, body, lang, lantern };
}

/** The body a zone tile draws (tests, contact sheets, inspect): its spec's form and parameter set. */
export function zoneBodyAt(tile: Tile, x: number, y: number, parcel: Parcel | null, env: Pick<ArtEnv, 'artOffset' | 'world' | 'zoom'>): { form: number; seed: number; kind: DistrictKind; lang: string | null; id: number } {
  const prev = art.world;
  bindWorld(env.world ?? null);
  const sp = zoneSpec(tile, x, y, parcel, { time: 0, night: 0, quality: 'high', ...env }, (env.zoom ?? 1) < LOD_ZOOM);
  const m = kitModel(sp);
  bindWorld(prev);
  return { form: sp.body.form, seed: sp.body.seed, kind: sp.kind, lang: sp.lang, id: m.id };
}

// ── Service models ─────────────────────────────────────────────────────────

const SERVICE_INDEX = new Map<BuildingType, number>(BUILDING_ORDER.map((t, i) => [t, i]));
/**
 * Art seeds keep today's per-type index (EXPANSION's BUILDING_ORDER without the Megacity types), so look 0 is exactly
 * today's art (MEGACITY §6.2); the Megacity types (floodwatch … pumphall) seed after them.
 */
const MEGA_FIRST = BUILDING_ORDER.indexOf('floodwatch');
const MEGA_LAST = BUILDING_ORDER.indexOf('pumphall');
const SEED_INDEX = new Map<BuildingType, number>(
  BUILDING_ORDER.map((t, i) => [t, i < MEGA_FIRST ? i : i > MEGA_LAST ? i - (MEGA_LAST - MEGA_FIRST + 1) : 100 + i]),
);
/** The building fields that pick a model (Building satisfies it). */
type VariantKey = Pick<Building, 'type' | 'stage' | 'buildDays' | 'crown'> & Partial<Pick<Building, 'id' | 'facing' | 'waitSec' | 'x' | 'y' | 'sponsor' | 'look' | 'reclaim'>>;
/**
 * Stratablock and port variant of a building: Stratablocks get one per complete stage × scaffold × crown
 * (art/vertical.ts); a Seaport one per facing, a Spaceport one per construction stage (art/ports.ts).
 */
function variantOf(b: VariantKey): number {
  if (b.type !== 'stack') return portVariant(b);
  const stage = b.stage ?? 1;
  const building = (b.buildDays ?? 0) > 0;
  return stackVariant(building ? stage - 1 : stage, building, b.crown);
}
/** The art seed of a service model (tests: look 0 keeps today's seeds, MEGACITY §11.2 item 10). */
export function serviceSeed(type: BuildingType): number {
  return 31337 + SERVICE_BASE + (SEED_INDEX.get(type) ?? 0);
}

const SPONSORS = ['nacre', 'basalt', 'none'] as const;
const NEUTRAL_PAL: ArtPal = { neon: [200, 230, 255], neon2: [255, 255, 255], up: [170, 200, 255], warm: 0.25, cool: 0.55 };

/** Heights each faction building's looks 1–2 reach (close to today's look 0). */
// The Tidemarket's and Roost's designs need height to read (a hull on stacked containers, a crane, masts): they rise to
// ≤ 96 px, under any skybridge tube (a tube's clearance never drops below 98 px: the lowest anchor is an L3 body ≥ 128).
const FACTION_LOOK_H: Partial<Record<BuildingType, number>> = { foundry: 168, glarewall: 136, tidemarket: 86, roost: 96, commons: 58 };

/** A faction design as a whole building: a slab, the design over the footprint, the offline warning. */
function designRecipe(d: Design, size: number, h: number, inset = 0.08): Recipe {
  return (p) => {
    p.box(0.04, 0.04, size - 0.04, size - 0.04, 0, 1.2, PAD_M, { uplight: false });
    d(p, { b: [inset, inset, size - inset, size - inset], z0: 1.2, h, banners: true });
    const [x, y] = p.pt(size / 2, size / 2, Math.min(40, h * 0.3));
    p.addFx({ k: 'warn', x, y, ph: p.rng.next() });
  };
}
const PAD_M = mat([96, 98, 110]);

/** What a building draws as: its model id parts and how to build the model. */
interface ServiceArt {
  look: number;
  style: number;
  variant: number;
  standing: 0 | 1 | 2;
  recipe: () => Recipe;
  pal: () => ArtPal;
}

function serviceArt(type: BuildingType, b: VariantKey | null, variantOverride?: number): ServiceArt {
  const def = BUILDINGS[type];
  const size = def?.size ?? 1;
  const bx = b?.x ?? -1;
  const by = b?.y ?? -1;
  const kind: DistrictKind = bx >= 0 ? styleAt(bx, by).kind : 'shore';
  const look = Math.max(0, Math.min(3, b?.look ?? 0));
  const today = (): Recipe => (STORY_RECIPES as Partial<Record<BuildingType, Recipe>>)[type] ?? portRecipe(type, b ? variantOf(b) : 0) ?? SERVICE_RECIPES[type];
  const todayPal = (): ArtPal => (PORT_PALS as Partial<Record<BuildingType, ArtPal>>)[type] ?? (STORY_PALS as Partial<Record<BuildingType, ArtPal>>)[type] ?? SERVICE_PALS[type];
  switch (type) {
    case 'stack': {
      const variant = variantOverride ?? (b ? variantOf(b) : stackVariant(1, false, undefined));
      const crown = b?.crown;
      const crownLook = Math.min(2, look);
      const f = crown ? CROWN_FACTION[crown] : undefined;
      const band = f ? art.bands[f] : 0;
      const si = styleIndex(kind);
      return { look: crownLook + 4 * band, style: si, variant, standing: band, recipe: () => stackRecipe(variant, crownLook, kind, band !== 2), pal: () => STACK_PAL };
    }
    case 'spire': {
      const sponsor = b?.sponsor ?? 'nacre';
      const si = Math.max(0, SPONSORS.indexOf(sponsor));
      const looks = SPIRE_LOOKS[sponsor];
      const lk = Math.min(looks.length - 1, look);
      const band = sponsor === 'none' ? 0 : art.bands[sponsor];
      const design = looks[lk];
      return {
        look: si * 4 + lk,
        style: 0,
        variant: band,
        standing: band,
        recipe: () => (design ? designRecipe(design, 2, 286, 0.1) : SERVICE_RECIPES.spire),
        pal: () => (design ? (sponsor === 'none' ? NEUTRAL_PAL : FACTION_PALS[sponsor]) : SERVICE_PALS.spire),
      };
    }
    case 'foundry':
    case 'glarewall':
    case 'tidemarket':
    case 'roost':
    case 'commons': {
      const f = FAMILY_FACTION[type]!;
      const band = art.bands[f];
      const lk = Math.min(2, look);
      const designs = FACTION_BUILDING_LOOKS[type]!;
      return {
        look: lk,
        style: 0,
        variant: band,
        standing: band,
        recipe: () => (lk === 0 ? today() : designRecipe(designs[lk - 1], size, FACTION_LOOK_H[type] ?? 60)),
        pal: () => (lk === 0 ? todayPal() : FACTION_PALS[f]),
      };
    }
    case 'charterhall':
    case 'hexworks':
    case 'pearlatrium':
    case 'hullhouse':
    case 'kitemast':
    case 'lampchoir': {
      const band = art.bands[FAMILY_FACTION[type]!];
      return { look: 0, style: 0, variant: band, standing: band, recipe: today, pal: todayPal };
    }
    case 'gantry':
    case 'glasssmile':
    case 'breadpier':
    case 'recordtower':
    case 'stillsquare': {
      const own = LANDMARK_ENDING[type];
      const cur = art.ending;
      let state = cur === null || cur === own ? 0 : 1;
      if (type === 'stillsquare' && state === 0 && art.lamplight) state = 2;
      return { look: 0, style: 0, variant: state, standing: 0, recipe: () => endingLandmarkRecipe(type, state)!, pal: () => ENDING_PALS[type] };
    }
    case 'pumphall': {
      const lk = art.pumphall;
      return { look: lk, style: 0, variant: 0, standing: 0, recipe: () => pumphallRecipe(lk), pal: () => LANDMARK_PALS.pumphall! };
    }
    case 'pumphouse': {
      const garden = b?.reclaim === 0;
      return { look: garden ? 1 : 0, style: 0, variant: 0, standing: 0, recipe: () => (garden ? PUMP_GARDEN : today()), pal: todayPal };
    }
    case 'memorial': {
      const sunk = kind === 'sunk';
      return { look: 0, style: sunk ? styleIndex('sunk') : 0, variant: 0, standing: 0, recipe: () => (sunk ? memorialLowerWards : today()), pal: todayPal };
    }
    case 'arcology': {
      const r = arcologyRecipe(kind);
      const g = r ? 1 + ['flats', 'terraces', 'shoals', 'bazaar'].indexOf(kind === 'tarmac' ? 'flats' : kind === 'reedmere' ? 'terraces' : kind === 'sunk' ? 'shoals' : kind === 'skeleton' ? 'bazaar' : kind) : 0;
      return { look: 0, style: g, variant: 0, standing: 0, recipe: () => r ?? today(), pal: todayPal };
    }
  }
  if (STYLED_SERVICES.has(type)) {
    const g = serviceLookGroup(kind);
    return { look: 0, style: g, variant: 0, standing: 0, recipe: () => serviceStyleRecipe(type, g) ?? today(), pal: todayPal };
  }
  const variant = variantOverride ?? (b ? variantOf(b) : portVariant({ type }));
  return { look: 0, style: 0, variant, standing: 0, recipe: () => portRecipe(type, variant) ?? SERVICE_RECIPES[type], pal: todayPal };
}

function serviceModel(type: BuildingType, b: VariantKey | null, variantOverride?: number): Model {
  const sa = serviceArt(type, b, variantOverride);
  const id = serviceModelId(SERVICE_INDEX.get(type) ?? 0, sa.look, sa.style, sa.variant);
  const hit = models.get(id);
  if (hit) return hit;
  return buildModel(id, sa.recipe(), sa.pal(), serviceSeed(type), BUILDINGS[type].size, 0, 0, 0, { standing: sa.standing });
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
  // Standing shows at night (MEGACITY §6.2): Allied brighter, Hostile at half window light.
  if (m.standing === 1) {
    p.litBoost *= 1.5;
    p.glowBoost *= 1.35;
  } else if (m.standing === 2) {
    p.litBoost *= 0.5;
    p.glowBoost *= 0.6;
  }
  p.begin(m.seed, m.pal);
  runRecipe(p, m);
  if (m.post) {
    p.sty = m.sty;
    m.post(p);
    p.sty = null;
  }
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
const sigState: SigState = { time: 0, night: 0, lit: true, lod: false, phase: 0 };

/** Sprite cache size and paint budget (MEGACITY §3.9, §6.1): the renderer raises both on a PC. */
export interface SpriteLimits {
  capBytes: number;
  budgetMs: number;
}
let limits: SpriteLimits | null = null;
/** Set the sprite cache cap and per-frame paint budget; null = the defaults (32 MB / 3.5 ms high, 20 MB / 2 ms low). */
export function setSpriteLimits(l: SpriteLimits | null): void {
  limits = l ? { capBytes: l.capBytes, budgetMs: l.budgetMs } : null;
}

/**
 * Start of a Renderer frame: the next draw re-reads the transform even when the time has not
 * moved (the still title draws every frame at one time while the camera can still change).
 */
export function resetFrame(): void {
  frameTime = NaN;
  frameCtx = null;
}

/** Detect a new frame (time advanced or a different target) and refresh frame constants. */
function sync(ctx: CanvasRenderingContext2D, env: ArtEnv) {
  if (env.time === frameTime && ctx === frameCtx) {
    if ((env.world ?? null) !== art.world) bindWorld(env.world ?? null);
    return;
  }
  frameTime = env.time;
  frameCtx = ctx;
  cache.newFrame();
  const low = env.quality === 'low';
  cache.budgetMs = limits?.budgetMs ?? (low ? 2 : 3.5);
  cache.capBytes = limits?.capBytes ?? (low ? 20 : 32) * 1024 * 1024;
  bindWorld(env.world ?? null);
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
  // Below LOD_ZOOM sprites stay on the scale buckets (no exact-scale repaint on settle, §3.9 / §6.1).
  if (env.zoom >= LOD_ZOOM && (env.time - lastScaleChange >= SETTLE || env.time < lastScaleChange)) {
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

function spriteKey(m: Model, state: number, lod: boolean): number {
  const body = m.id * STATES + state;
  const nb = state >= ST_GHOST_OK ? 0 : frameNightB;
  return ((body * NIGHT_STEPS + nb) * 4096 + frameScaleCode) * 2 + (lod ? 1 : 0);
}

function sprite(m: Model, state: number, lod: boolean): Sprite | null {
  const body = m.id * STATES + state;
  // Ghosts always use the bright day palette so the hologram reads at night too.
  const nb = state >= ST_GHOST_OK ? 0 : frameNightB;
  const key = spriteKey(m, state, lod);
  // Kit bodies: the classic body of the same zone, level, tier and palette stands in until this one's turn (§6.1).
  const fb = m.fallback >= 0 ? models.get(m.fallback) : undefined;
  return cache.get(key, body, () => paintSprite(m, state, nb, frameScale, lod), fb ? () => sprite(fb, state, lod) : undefined);
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

function liveParts(ctx: CanvasRenderingContext2D, m: Model, wx: number, wy: number, env: ArtEnv, lit: boolean, offline: boolean, lod: boolean, phase: number) {
  if (env.quality !== 'high' || env.ghost) return;
  if (m.fx.length) {
    fxState.time = env.time;
    fxState.night = env.night;
    fxState.lit = lit;
    fxState.offline = offline;
    fxState.lod = lod;
    fxState.phase = phase;
    drawFx(ctx, m.fx, wx, wy, fxState);
  }
  if (m.sig.length) {
    sigState.time = env.time;
    sigState.night = env.night;
    sigState.lit = lit;
    sigState.lod = lod;
    sigState.phase = phase;
    drawSigs(ctx, m.sig, wx, wy, sigState);
  }
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
  const FW = m.W;
  const FH = m.H;
  const prog = Math.min(1, (tile.age + 0.5) / BUILD_TICKS);
  const H = Math.max(8, m.top);
  const zc = Math.max(2, H * prog * 0.92);
  // 1. Walls revealed up to zc: clip to everything below the raised footprint's front edges.
  if (s) {
    ctx.save();
    ctx.beginPath();
    const lx = wx - FH * 32 - 8;
    const rx = wx + FW * 32 + 8;
    ctx.moveTo(lx, wy + FH * 16 - zc);
    ctx.lineTo(wx + (FW - FH) * 32, wy + (FW + FH) * 16 - zc);
    ctx.lineTo(rx, wy + FW * 16 - zc);
    ctx.lineTo(rx, wy + (FW + FH) * 16 + 16);
    ctx.lineTo(lx, wy + (FW + FH) * 16 + 16);
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
  const P = (u: number, v: number, z: number) => [wx + (u * FW - v * FH) * 32, wy + (u * FW + v * FH) * 16 - z] as const;
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

/**
 * The parcel-aware zone draw call (MEGACITY §6.1, signature frozen in Step 0b): a parcel's head draws one body for the
 * whole parcel, its other members nothing; a single tile (parcel null, or a 1 × 1 parcel) draws its own body. `at`
 * carries the tile's world position and coordinates.
 */
export function drawZone(
  ctx: CanvasRenderingContext2D,
  tile: Tile,
  parcel: Parcel | null,
  env: ArtEnv,
  at: { wx: number; wy: number; x: number; y: number },
): void {
  if (tile.zone === ZoneType.None) return;
  if (parcel && parcel.w * parcel.h > 1) {
    if (at.x !== parcel.hx || at.y !== parcel.hy) return;
    // The parcel draws from its top corner tile.
    drawZoneAt(ctx, (parcel.x - parcel.y) * HALF_W, (parcel.x + parcel.y) * HALF_H, tile, at.x, at.y, parcel, env);
    return;
  }
  drawZoneAt(ctx, at.wx, at.wy, tile, at.x, at.y, null, env);
}

/** Zone building on tile (tx,ty) whose top corner is world (wx,wy). Handles level 0 lot props, abandoned look and construction (tile.age small). */
export function drawZoneBuilding(ctx: CanvasRenderingContext2D, wx: number, wy: number, tile: Tile, tx: number, ty: number, env: ArtEnv): void {
  if (tile.zone === ZoneType.None) return;
  drawZoneAt(ctx, wx, wy, tile, tx, ty, null, env);
}

function drawZoneAt(ctx: CanvasRenderingContext2D, wx: number, wy: number, tile: Tile, tx: number, ty: number, parcel: Parcel | null, env: ArtEnv): void {
  sync(ctx, env);
  const lod = env.zoom < LOD_ZOOM;
  const level = parcel ? parcel.level : tile.level;
  const m = level <= 0 ? zoneModel(tile.zone, 0, tile.variant, 0) : kitModel(zoneSpec(tile, tx, ty, parcel, env, lod));
  drawZoneModel(ctx, wx, wy, tile, tx, ty, m, env, lod);
}

function drawZoneModel(ctx: CanvasRenderingContext2D, wx: number, wy: number, tile: Tile, tx: number, ty: number, m: Model, env: ArtEnv, lod: boolean) {
  if (m.empty) return;
  const alpha0 = ctx.globalAlpha;
  if (env.ghost) ctx.globalAlpha = alpha0 * 0.5;

  if (m.level === 0) {
    const s = sprite(m, ST_ON, lod);
    if (s) blit(ctx, s, wx, wy);
    ctx.globalAlpha = alpha0;
    return;
  }

  const building = !tile.abandoned && tile.age < BUILD_TICKS;
  const state = tile.abandoned ? ST_ABANDONED : building || !tile.powered ? ST_DARK : ST_ON;
  const s = sprite(m, state, lod);
  const ao = env.artOffset ?? 0;
  const phase = tilePhase(tx - ao, ty - ao);
  if (building) {
    drawConstruction(ctx, s, m, wx, wy, tile, env, phase);
    ctx.globalAlpha = alpha0;
    return;
  }
  if (s) blit(ctx, s, wx, wy);

  if (env.quality === 'high' && !env.ghost) {
    if (state === ST_ON) liveParts(ctx, m, wx, wy, env, true, false, lod, phase);
    else if (state === ST_ABANDONED && !lod && env.night > 0.4 && phase < 0.35) {
      // A lone squatter's light in the dark shell.
      drawAbandonedLight(ctx, m.fx, wx, wy, env.time, env.night, phase);
    }
  }
  ctx.globalAlpha = alpha0;
}

/**
 * Draw an explicit zone body (tests and contact sheets): `body` the form (0..31) and parameter set, in `kind`'s style
 * and variant accent, as a single tile or a parcel of `shape` (W × H), optionally in a takeover language.
 */
export function drawZoneBody(
  ctx: CanvasRenderingContext2D,
  wx: number,
  wy: number,
  tile: Tile,
  body: Body,
  env: ArtEnv,
  o: { kind?: DistrictKind; variant?: number; shape?: number; W?: number; H?: number; lang?: LegacyLang | null; lantern?: boolean } = {},
): void {
  sync(ctx, env);
  const lod = env.zoom < LOD_ZOOM;
  const shape = o.shape ?? 0;
  const tier: 0 | 1 | 2 = tile.wealth === 1 || tile.wealth === 2 ? tile.wealth : 0;
  const sp: ZoneSpec = {
    zone: tile.zone,
    level: tile.level,
    tier,
    shape,
    W: o.W ?? (shape === 0 ? 1 : 2),
    H: o.H ?? (shape === 2 ? 2 : 1),
    variant: tile.variant,
    kind: o.kind ?? 'shore',
    dvar: o.variant ?? 0,
    body,
    lang: o.lang ?? null,
    lantern: !!o.lantern,
  };
  const m = tile.level <= 0 ? zoneModel(tile.zone, 0, tile.variant, 0) : kitModel(sp);
  drawZoneModel(ctx, wx, wy, tile, 0, 0, m, env, lod);
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
  const m = serviceModel(b.type, b);
  const on = b.offline <= 0 && (b.powered || def.powerSupply > 0);
  const lod = env.zoom < LOD_ZOOM;
  const s = sprite(m, on ? ST_ON : ST_DARK, lod);
  if (s) blit(ctx, s, wx, wy);
  if (env.quality === 'high') {
    const phase = tilePhase(b.x - (env.artOffset ?? 0), b.y - (env.artOffset ?? 0));
    if (m.fx.length) {
      fxState.time = env.time;
      fxState.night = env.night;
      fxState.lit = on;
      fxState.offline = !on;
      fxState.lod = lod;
      fxState.phase = phase;
      drawFx(ctx, m.fx, wx, wy, fxState);
    }
    if (m.sig.length && on) {
      sigState.time = env.time;
      sigState.night = env.night;
      sigState.lit = true;
      sigState.lod = lod;
      sigState.phase = phase;
      drawSigs(ctx, m.sig, wx, wy, sigState);
    }
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
  const m = serviceModel(type, null, variant);
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
/**
 * Approx pixel height above the ground of what drawZoneBuilding draws (renderer uses it for culling + unpowered icons).
 * Tier-independent. Every body's mass reaches the tile's height truth (heights.ts), whatever form it picked, so this is
 * the classic top; with a parcel, the parcel's drawn level.
 */
export function zoneBuildingHeight(tile: Tile, parcel?: Parcel | null): number {
  if (tile.zone === ZoneType.None) return 0;
  const level = parcel ? parcel.level : tile.level;
  if (level <= 0) return 8;
  const id = zoneModelId(tile.zone, level, tile.variant, tile.wealth);
  let h = zoneHeights[id];
  if (h < 0) {
    h = zoneModel(tile.zone, level, tile.variant, tile.wealth).top;
    zoneHeights[id] = h;
  }
  return h;
}

const serviceHeights = new Map<number, number>();
/**
 * Approx pixel height of a service building above the ground (culling, selection box,
 * status icons, skybridge height). Pass the building for stage-aware Stratablocks
 * (60 / 150 / 210 px by complete stage) and its look, sponsor and district.
 */
export function serviceBuildingHeight(type: BuildingType, b?: VariantKey): number {
  if (!BUILDINGS[type]) return 40;
  const sa = serviceArt(type, b ?? null, b ? undefined : type === 'stack' ? stackVariant(1, false, undefined) : portVariant({ type }));
  const id = serviceModelId(SERVICE_INDEX.get(type) ?? 0, sa.look, sa.style, sa.variant);
  let h = serviceHeights.get(id);
  if (h === undefined) {
    h = serviceModel(type, b ?? null, b ? undefined : sa.variant).top;
    serviceHeights.set(id, h);
  }
  return h;
}

/** Recorded facts of a zone body model (tests, harnesses): its id, seed, top and live-fx count. */
export function zoneModelInfo(zone: number, level: number, variant: number, tier: number): { id: number; seed: number; top: number; fx: number; zone: number; level: number; tier: number } {
  const m = zoneModel(zone, level, variant, tier);
  return { id: m.id, seed: m.seed, top: m.top, fx: m.fx.length, zone: m.zone, level: m.level, tier: m.tier };
}

/** Recorded facts of a kit or classic body in a style (tests): its id, top, height truth and signature count. */
export function zoneBodyInfo(
  zone: number,
  level: number,
  variant: number,
  tier: number,
  body: Body,
  o: { kind?: DistrictKind; variant?: number; shape?: number; lang?: LegacyLang | null; lantern?: boolean } = {},
): { id: number; top: number; truth: number; fx: number; sig: number; fallback: number } {
  const shape = o.shape ?? 0;
  const t: 0 | 1 | 2 = tier === 1 || tier === 2 ? tier : 0;
  const m = kitModel({ zone, level, tier: t, shape, W: shape === 0 ? 1 : 2, H: shape === 2 ? 2 : 1, variant, kind: o.kind ?? 'shore', dvar: o.variant ?? 0, body, lang: o.lang ?? null, lantern: !!o.lantern });
  return { id: m.id, top: m.top, truth: truthTop(zone, level, variant, t), fx: m.fx.length, sig: m.sig.length, fallback: m.fallback };
}

/** Recorded facts of a service model (tests): id, top, look, style, variant, standing and signature count. */
export function serviceModelInfo(type: BuildingType, b?: Partial<Building>, world?: World | null): { id: number; top: number; look: number; style: number; variant: number; standing: number; sig: number; seed: number } {
  const prev = art.world;
  if (world !== undefined) bindWorld(world);
  const key = { type, stage: 1, buildDays: 0, crown: undefined, ...b } as VariantKey;
  const sa = serviceArt(type, key);
  const m = serviceModel(type, key);
  if (world !== undefined) bindWorld(prev);
  return { id: m.id, top: m.top, look: sa.look, style: sa.style, variant: sa.variant, standing: m.standing, sig: m.sig.length, seed: m.seed };
}

/** The recipe a service model of `b` runs (tests: look 0 equals today's recipes, §11.2 item 10). */
export function serviceRecipeOf(type: BuildingType, b?: Partial<Building>, world?: World | null): Recipe {
  const prev = art.world;
  if (world !== undefined) bindWorld(world);
  const key = { type, stage: 1, buildDays: 0, crown: undefined, ...b } as VariantKey;
  const r = serviceArt(type, key).recipe();
  if (world !== undefined) bindWorld(prev);
  return r;
}

/** Drop every cached sprite (e.g. on context loss). Models are kept. */
export function clearBuildingCache() {
  cache.clear();
}

/** Debug stats for perf overlays / harnesses. */
export function buildingCacheStats() {
  return { sprites: cache.size, bytes: cache.bytes, builtThisFrame: cache.built, models: models.size, kitModels: kitIds.size, fallbacks: cache.fallbacks };
}

/** The design families the kit and the landmarks reuse (tests enumerate them). */
export const ART_FAMILIES = { DESIGNS, LEGACY_LANGS };
void glowSprite;
