// ─────────────────────────────────────────────────────────────────────────────
// Mark decals (docs/MEGACITY.md §9.2, §9.3): what the city's choices look like
// on the map, drawn from game.story.visual.marks (game/marks.ts derives them).
//
//   draw     the ground pass (the frozen call site in render/story.ts, after
//            the ground, before the buildings): short street props that the
//            bodies in front cover by themselves. The ending's street look
//            (Ironwork's sodium lamps, the Low Crown's string lights and
//            corner lamps, Open Ledger's Board flags on avenues, the Quiet
//            Hand's pennants in every faction's colour in turn, Lamplight's
//            lamps on causeways), the patron's livery on Charter Shore's lamps,
//            the nets and string lights over the Seam, the vote's banner, the
//            brass plaques, the old pump hall's lamps, fence, guard box and
//            door, the Lower Wards memorial's glow on the water.
//   drawSky  after the buildings (render/story.ts drawSkyFx): tall or facade
//            decals, each skipped when a body in front hides its anchor
//            (festival.ts' rule): lark's kite and the new kids' second one, the
//            Clean Glass mast and its sweeping searchlight, the dead relay
//            mast, the Truce Wall's tags on the Seam's facades, the dark
//            blocks and their moth stencil, the answering balcony, the Board
//            archive's flag, fen's kites by day.
//
// Cheap (§11.1 "faction signatures and marks ≤ 0.3 ms"): the street props are
// listed once per view rect (refreshed at most every 0.5 s while the world
// changes), capped, and drawn as a few rects and cached glow sprites; marks are
// a handful. Nothing below the street view's zoom, glows only at night, half the
// props at Low quality.
// ─────────────────────────────────────────────────────────────────────────────

import { BUILDINGS } from '../../game/config';
import { artOffset, slotRect, startSlotOf } from '../../game/districts/slots';
import { heightOf } from '../../game/heights';
import { bindMarks } from '../../game/marks';
import { hash2 } from '../../game/rng';
import { isActive } from '../../game/story/factions';
import type { FactionId, Mark, Marks } from '../../game/story/types';
import { RoadKind, Terrain, ZoneType } from '../../game/types';
import type { World } from '../../game/world';
import type { ArtEnv } from '../buildings';
import { HALF_H, HALF_W } from '../camera';
import type { Rect } from '../ground';
import { css, glowSprite, type RGB } from '../palette';
import { sigilSprite } from './sigils';

const LIME: RGB = [182, 255, 46];
const LILAC: RGB = [201, 162, 255];
const SODIUM: RGB = [255, 160, 70];
const WARM: RGB = [255, 222, 150];
const PEARL: RGB = [255, 198, 241];
const BASALT: RGB = [255, 123, 46];
const BOARD: RGB = [150, 200, 255];
const COLD: RGB = [215, 235, 255];
const FACTION_RGB: Record<FactionId, RGB> = {
  board: BOARD,
  basalt: BASALT,
  nacre: PEARL,
  undertow: LIME,
  kites: LILAC,
  tuning: WARM,
};

/** Zoom below which no mark or street prop draws (the skyline view keeps its roof tints only). */
export const MARKS_MIN_ZOOM = 0.3;
/** Street props only from this zoom (they are a few px tall). */
const PROPS_MIN_ZOOM = 0.42;
/** Caps per frame. */
const CAP = { lamps: 72, corners: 48, avenues: 56, bridges: 56, livery: 56 } as const;

/** Per-frame cost counters (tests and the measurement script). */
export const MARKS_STATS = { props: 0, decals: 0, skyDecals: 0 };

// ── The street props of the view, listed once per rect ─────────────────────

interface Props {
  key: string;
  at: number;
  lamps: number[];
  corners: number[];
  avenues: number[];
  bridges: number[];
}

const props: Props = { key: '', at: -1e9, lamps: [], corners: [], avenues: [], bridges: [] };
let clock = 0;

function listProps(world: World, b: Rect, quality: ArtEnv['quality']): Props {
  const key = `${b.x0},${b.y0},${b.x1},${b.y1},${quality}`;
  // The view moved: list again at once; the world changed: at most every 0.5 s.
  if (props.key === key && (clock - props.at < 0.5 || props.ver === world.version)) return props;
  props.key = key;
  props.at = clock;
  props.ver = world.version;
  const lamps = (props.lamps.length = 0, props.lamps);
  const corners = (props.corners.length = 0, props.corners);
  const avenues = (props.avenues.length = 0, props.avenues);
  const bridges = (props.bridges.length = 0, props.bridges);
  const N = world.N;
  const ao = artOffset(world);
  const half = quality === 'low' ? 0.5 : 1;
  for (let y = b.y0; y <= b.y1; y++)
    for (let x = b.x0; x <= b.x1; x++) {
      const i = y * N + x;
      const t = world.tiles[i];
      if (!t.road || !world.ownedAt(i)) continue;
      const h = hash2(x - ao, y - ao, 0x1a3b);
      if (t.terrain === Terrain.Water) {
        if (bridges.length < CAP.bridges * half && (x + y) % 2 === 0) bridges.push(i);
        continue;
      }
      if (t.roadKind === RoadKind.Highway || t.roadKind === RoadKind.Ramp) continue;
      const m = world.roadMask(x, y);
      const links = (m & 1) + ((m >> 1) & 1) + ((m >> 2) & 1) + ((m >> 3) & 1);
      if (links >= 3 && corners.length < CAP.corners * half) corners.push(i);
      else if (t.roadKind === RoadKind.Avenue && (x + y) % 3 === 0 && avenues.length < CAP.avenues * half) avenues.push(i);
      if (h < 0.3 && lamps.length < CAP.lamps * half) lamps.push(i);
    }
  return props;
}
interface Props {
  ver?: number;
}

// ── Small cached sprites ───────────────────────────────────────────────────

const sprites = new Map<string, HTMLCanvasElement | null>();

function sprite(key: string, w: number, h: number, paint: (g: CanvasRenderingContext2D) => void): HTMLCanvasElement | null {
  let c = sprites.get(key);
  if (c !== undefined) return c;
  c = null;
  if (typeof document !== 'undefined') {
    c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const g = c.getContext('2d');
    if (g) paint(g);
    else c = null;
  }
  sprites.set(key, c);
  return c;
}

/** lark's moth-wing kite: two lilac wings, a pale body (28×22). */
const mothKite = () =>
  sprite('mothkite', 28, 22, (g) => {
    g.fillStyle = css([170, 130, 240]);
    for (const s of [-1, 1]) {
      g.beginPath();
      g.moveTo(14, 4);
      g.lineTo(14 + s * 13, 2);
      g.lineTo(14 + s * 11, 12);
      g.lineTo(14 + s * 4, 19);
      g.closePath();
      g.fill();
    }
    g.fillStyle = css([226, 210, 255]);
    for (const s of [-1, 1]) {
      g.beginPath();
      g.arc(14 + s * 7, 8, 2.2, 0, Math.PI * 2);
      g.fill();
    }
    g.fillStyle = css([250, 244, 255]);
    g.fillRect(13, 3, 2, 17);
  });

/** A diamond kite (fen's, the High Line's) in a colour (12×14). */
const diamondKite = (c: RGB) =>
  sprite(`kite${c.join()}`, 12, 14, (g) => {
    g.fillStyle = css(c);
    g.beginPath();
    g.moveTo(6, 0);
    g.lineTo(12, 6);
    g.lineTo(6, 14);
    g.lineTo(0, 6);
    g.closePath();
    g.fill();
    g.strokeStyle = css([255, 255, 255], 0.7);
    g.lineWidth = 0.8;
    g.beginPath();
    g.moveTo(6, 0);
    g.lineTo(6, 14);
    g.moveTo(0, 6);
    g.lineTo(12, 6);
    g.stroke();
  });

/** The Truce Wall's tag pair: an Undertow hook-wave and a Kites diamond meeting on one strip (22×10). */
const truceTags = () =>
  sprite('trucetags', 22, 10, (g) => {
    g.lineWidth = 1.6;
    g.lineCap = 'round';
    g.strokeStyle = css(LIME);
    g.beginPath();
    g.moveTo(1, 7);
    g.quadraticCurveTo(4, 1, 7, 6);
    g.quadraticCurveTo(9, 9, 11, 4);
    g.stroke();
    g.strokeStyle = css(LILAC);
    g.beginPath();
    g.moveTo(11, 5);
    g.lineTo(15, 1);
    g.lineTo(19, 5);
    g.lineTo(15, 9);
    g.closePath();
    g.stroke();
    g.fillStyle = css([255, 255, 255], 0.85);
    g.fillRect(10, 4, 2, 2);
  });

// ── Geometry helpers ───────────────────────────────────────────────────────

/** World px of a tile point (u, v in tile units, z px above the ground). */
const wx = (u: number, v: number) => (u - v) * HALF_W;
const wy = (u: number, v: number, z = 0) => (u + v) * HALF_H - z;

const inRect = (m: Mark, b: Rect, pad = 2) => m.x + m.w + pad >= b.x0 && m.x - pad <= b.x1 && m.y + m.h + pad >= b.y0 && m.y - pad <= b.y1;

/** Is a point `lift` px over tile (x, y) hidden behind a body in front of it (festival.ts' rule)? */
function hidden(world: World, x: number, y: number, lift: number): boolean {
  for (let k = 1; k <= 6; k++) {
    const d = lift + 2 * k * HALF_H;
    if (heightOf(world, x + k, y + k) > d - HALF_H) return true;
    if (heightOf(world, x + k, y + k - 1) > d - HALF_H / 2 || heightOf(world, x + k - 1, y + k) > d - HALF_H / 2) return true;
  }
  return false;
}

/** The roof height of the tallest tile of a mark's rect (the host a kite flies over), and that tile. */
function hostTop(world: World, m: Mark): { x: number; y: number; h: number } {
  let best = { x: m.x, y: m.y, h: heightOf(world, m.x, m.y) };
  if (m.w * m.h > 1)
    for (let y = m.y; y < m.y + m.h; y++)
      for (let x = m.x; x < m.x + m.w; x++) {
        const h = heightOf(world, x, y);
        if (h > best.h) best = { x, y, h };
      }
  return best;
}

/** Glow sprites by colour, looked up once (glowSprite builds a key string per call). */
const glows = new Map<RGB, HTMLCanvasElement>();
function glow(ctx: CanvasRenderingContext2D, c: RGB, x: number, y: number, r: number, a: number): void {
  if (a <= 0.01) return;
  let g = glows.get(c);
  if (!g) {
    g = glowSprite(c, 32);
    glows.set(c, g);
  }
  ctx.globalAlpha = Math.min(1, a);
  ctx.drawImage(g, x - r, y - r, r * 2, r * 2);
}

/** A short lamp post at the tile's lamp spot (its south-west sidewalk), with an optional collar band. */
function post(ctx: CanvasRenderingContext2D, x: number, y: number, collar: RGB | null): [number, number] {
  const px = wx(x + 0.18, y + 0.82);
  const py = wy(x + 0.18, y + 0.82);
  ctx.fillStyle = '#4a5068';
  ctx.fillRect(px - 0.7, py - 13, 1.4, 13);
  ctx.fillRect(px - 0.7, py - 13, 3.5, 1.2);
  if (collar) {
    ctx.fillStyle = css(collar);
    ctx.fillRect(px - 1.6, py - 9, 3.2, 2.6);
  }
  return [px + 2.8, py - 12];
}

// ── The ending's street look (§9.2 "Street look", the props off the buildings) ──

function streetLook(ctx: CanvasRenderingContext2D, world: World, p: Props, env: ArtEnv): void {
  const st = world.story;
  const e = st.ending;
  const n = env.night;
  const N = world.N;
  const lit = n > 0.3 && env.quality !== 'low';
  if (e === 'ironwork') {
    // Sodium-orange street lights.
    for (const i of p.lamps) {
      const [lx, ly] = post(ctx, i % N, (i / N) | 0, null);
      ctx.fillStyle = css(n > 0.3 ? [255, 200, 120] : [150, 130, 110]);
      ctx.fillRect(lx - 1.6, ly - 0.2, 3.2, 1.8);
      MARKS_STATS.props++;
    }
    if (lit) {
      ctx.globalCompositeOperation = 'lighter';
      for (const i of p.lamps) {
        const x = i % N;
        const y = (i / N) | 0;
        glow(ctx, SODIUM, wx(x + 0.3, y + 0.72) + 1.5, wy(x + 0.3, y + 0.72, 6), 18, n * 0.7);
      }
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
    }
  } else if (e === 'lowcrown') {
    // String lights and both crews' banners on every corner, a lamp on every corner light.
    for (const i of p.corners) {
      const x = i % N;
      const y = (i / N) | 0;
      ctx.strokeStyle = css([60, 60, 70], 0.8);
      ctx.lineWidth = 0.5;
      ctx.beginPath();
      ctx.moveTo(wx(x, y + 0.1), wy(x, y + 0.1, 9));
      ctx.quadraticCurveTo(wx(x + 0.5, y + 0.5), wy(x + 0.5, y + 0.5, 5), wx(x + 1, y + 0.9), wy(x + 1, y + 0.9, 9));
      ctx.stroke();
      for (let k = 1; k < 8; k++) {
        const u = x + k / 8;
        const v = y + 0.1 + (k / 8) * 0.8;
        const sag = 9 - Math.sin((k / 8) * Math.PI) * 4;
        ctx.fillStyle = css(k % 2 ? LIME : LILAC, n > 0.3 ? 1 : 0.85);
        ctx.fillRect(wx(u, v) - 1, wy(u, v, sag) - 1, 2, 2);
      }
      // The two banners at the corner.
      const bx = wx(x + 0.12, y + 0.12);
      const by = wy(x + 0.12, y + 0.12);
      ctx.fillStyle = '#3a3f52';
      ctx.fillRect(bx - 0.6, by - 17, 1.2, 17);
      ctx.fillStyle = css(LIME, 0.95);
      ctx.fillRect(bx + 0.6, by - 17, 5.5, 4);
      ctx.fillStyle = css(LILAC, 0.95);
      ctx.fillRect(bx + 0.6, by - 12.5, 5.5, 4);
      MARKS_STATS.props++;
    }
    if (lit) {
      ctx.globalCompositeOperation = 'lighter';
      for (const i of p.corners) {
        const x = i % N;
        const y = (i / N) | 0;
        glow(ctx, LIME, wx(x + 0.5, y + 0.5), wy(x + 0.5, y + 0.5, 6), 16, n * 0.6);
        glow(ctx, LILAC, wx(x + 0.12, y + 0.12), wy(x + 0.12, y + 0.12, 14), 8, n * 0.7);
      }
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
    }
  } else if (e === 'ledger') {
    // Board flags on avenues.
    for (const i of p.avenues) {
      const x = i % N;
      const y = (i / N) | 0;
      const fx = wx(x + 0.5, y + 0.5);
      const fy = wy(x + 0.5, y + 0.5);
      ctx.fillStyle = '#5a6074';
      ctx.fillRect(fx - 0.5, fy - 15, 1, 15);
      const wave = Math.sin(env.time * 2 + x * 0.7 + y) * 0.6;
      ctx.fillStyle = css(BOARD);
      ctx.fillRect(fx + 0.5, fy - 15 + wave, 5, 3.2);
      ctx.fillStyle = css([240, 246, 255]);
      ctx.fillRect(fx + 0.5, fy - 12 + wave, 5, 1);
      MARKS_STATS.props++;
    }
  } else if (e === 'quiet') {
    // Pennants in each active faction's colour, once in turn, never one more than another.
    const fs = (['board', 'basalt', 'nacre', 'undertow', 'kites', 'tuning'] as FactionId[]).filter((f) => isActive(world, f));
    if (fs.length) {
      let k = 0;
      for (const i of p.avenues) {
        const x = i % N;
        const y = (i / N) | 0;
        const c = FACTION_RGB[fs[k++ % fs.length]];
        const fx = wx(x + 0.5, y + 0.5);
        const fy = wy(x + 0.5, y + 0.5);
        ctx.fillStyle = '#5a6074';
        ctx.fillRect(fx - 0.5, fy - 14, 1, 14);
        ctx.fillStyle = css(c);
        ctx.beginPath();
        ctx.moveTo(fx + 0.5, fy - 14);
        ctx.lineTo(fx + 6.5, fy - 12.5 + Math.sin(env.time * 2 + k) * 0.5);
        ctx.lineTo(fx + 0.5, fy - 11);
        ctx.closePath();
        ctx.fill();
        MARKS_STATS.props++;
      }
    }
    // Lamplight: lamps along every causeway (the bridges) and stair.
    if (st.endingVariant === 'lamplight' && lit) {
      ctx.globalCompositeOperation = 'lighter';
      for (const i of p.bridges) {
        const x = i % N;
        const y = (i / N) | 0;
        glow(ctx, WARM, wx(x + 0.2, y + 0.8), wy(x + 0.2, y + 0.8, 6), 8, n * 0.8);
        glow(ctx, WARM, wx(x + 0.8, y + 0.2), wy(x + 0.8, y + 0.2, 6), 8, n * 0.8);
      }
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
    }
  }
}

// ── The marks: ground pass ─────────────────────────────────────────────────

/** Road tiles inside a mark's rect (the Seam's streets), memoised per mark list version. */
const roadMemo = new Map<string, number[]>();
let roadMemoVer = -1;
function roadsIn(world: World, m: Mark, version: number): number[] {
  if (version !== roadMemoVer) {
    roadMemo.clear();
    roadMemoVer = version;
  }
  const key = `${m.id}:${m.x},${m.y}`;
  let out = roadMemo.get(key);
  if (!out) {
    out = [];
    for (let y = m.y; y < m.y + m.h; y++) for (let x = m.x; x < m.x + m.w; x++) if (world.tileAt(x, y)?.road) out.push(y * world.N + x);
    roadMemo.set(key, out);
  }
  return out;
}

/** Road tiles inside a mark's rect, memoised by the mark (its place changes only with a new mark list). */
function roadsAt(world: World, m: Mark): number[] {
  return roadsIn(world, m, roadMemoVer);
}

function groundMark(ctx: CanvasRenderingContext2D, world: World, m: Mark, env: ArtEnv, version: number): void {
  const n = env.night;
  const N = world.N;
  const t = env.time;
  const [kind, arg, extra] = m.decal.split(':');
  const fx = m.x + m.w; // the footprint's front (south) corner
  const fy = m.y + m.h;
  switch (kind) {
    case 'plaque': {
      // A brass plaque at the front corner, catching the light.
      const px = wx(fx, fy) - 3;
      const py = wy(fx, fy) - 2;
      ctx.fillStyle = css([196, 156, 74]);
      ctx.fillRect(px, py, 6, 3.5);
      ctx.fillStyle = css([255, 236, 170], 0.5 + 0.5 * Math.max(0, Math.sin(t * 1.3 + m.x)));
      ctx.fillRect(px + 1, py + 0.8, 1.5, 0.8);
      break;
    }
    case 'banner':
      // Drawn after the buildings (skyMark): a tall pole shows over the block it stands in.
      break;
    case 'livery': {
      // Charter Shore's street lamps wear the patron's collar (a Basalt band, a Nacre pearl ring).
      const c = arg === 'basalt' ? BASALT : PEARL;
      const r = slotRect(world, startSlotOf(world));
      const p = props;
      let k = 0;
      for (const i of p.lamps) {
        const x = i % N;
        const y = (i / N) | 0;
        if (x < r.x0 || y < r.y0 || x > r.x1 || y > r.y1 || k >= CAP.livery) continue;
        k++;
        const [lx, ly] = post(ctx, x, y, c);
        ctx.fillStyle = css(c);
        ctx.fillRect(lx - 1.6, ly - 0.2, 3.2, 1.8);
        if (n > 0.3 && env.quality !== 'low') {
          ctx.globalCompositeOperation = 'lighter';
          glow(ctx, c, lx - 1, ly + 4, 14, n * 0.85);
          ctx.globalCompositeOperation = 'source-over';
          ctx.globalAlpha = 1;
        }
      }
      MARKS_STATS.props += k;
      break;
    }
    case 'nets': {
      // Low Water: nets and green lamps hung over the Seam's streets.
      for (const i of roadsIn(world, m, version)) {
        const x = i % N;
        const y = (i / N) | 0;
        ctx.strokeStyle = css([60, 110, 80], 0.85);
        ctx.lineWidth = 0.5;
        ctx.beginPath();
        for (let k = 0; k <= 4; k++) {
          const u = x + k / 4;
          ctx.moveTo(wx(u, y + 0.15), wy(u, y + 0.15, 10));
          ctx.lineTo(wx(u, y + 0.85), wy(u, y + 0.85, 8));
        }
        ctx.moveTo(wx(x, y + 0.5), wy(x, y + 0.5, 9));
        ctx.lineTo(wx(x + 1, y + 0.5), wy(x + 1, y + 0.5, 9));
        ctx.stroke();
        if (n > 0.3) {
          ctx.globalCompositeOperation = 'lighter';
          glow(ctx, LIME, wx(x + 0.5, y + 0.5), wy(x + 0.5, y + 0.5, 9), 7, n * 0.7);
          ctx.globalCompositeOperation = 'source-over';
          ctx.globalAlpha = 1;
        }
      }
      break;
    }
    case 'highline':
    case 'mural': {
      // String lights over the Seam (the High Line's, and the Truce Wall's once the crews' shared night is lit).
      if (kind === 'mural' && arg !== 'lit') break;
      for (const i of roadsIn(world, m, version)) {
        const x = i % N;
        const y = (i / N) | 0;
        for (let k = 0; k < 5; k++) {
          const u = x + 0.1 + k * 0.2;
          const v = y + 0.9 - k * 0.2;
          ctx.fillStyle = css(k % 2 ? LILAC : kind === 'mural' ? LIME : [255, 250, 230]);
          ctx.fillRect(wx(u, v) - 0.7, wy(u, v, 9 - Math.sin(k * 0.8) * 2) - 0.7, 1.4, 1.4);
        }
        if (n > 0.3) {
          ctx.globalCompositeOperation = 'lighter';
          glow(ctx, LILAC, wx(x + 0.5, y + 0.5), wy(x + 0.5, y + 0.5, 8), 9, n * 0.45);
          ctx.globalCompositeOperation = 'source-over';
          ctx.globalAlpha = 1;
        }
      }
      break;
    }
    case 'memorial': {
      // The Lower Wards look: the names wall lit from the canal side, a glow on the water.
      const c = [m.x + m.w / 2, m.y + m.h / 2] as const;
      const a = 0.25 + 0.6 * n;
      ctx.globalCompositeOperation = 'lighter';
      glow(ctx, COLD, wx(c[0] + 0.4, c[1] + 0.9), wy(c[0] + 0.4, c[1] + 0.9, 2), 18, a * 0.6);
      glow(ctx, COLD, wx(fx + 0.4, fy + 0.4), wy(fx + 0.4, fy + 0.4), 14, a * 0.5);
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
      break;
    }
    case 'hall': {
      // The old pump hall (§9.3): its own look is the building's (art/landmarks.ts); the marks add the street.
      if (arg === 'open') {
        // Lamps line the causeway out of the hall; a wall of names glows from below.
        const all = extra === 'lit' || !!world.story.flags.fullRecall;
        for (let k = 0; k < 6; k++) {
          const u = fx + 0.3 + k * 0.6;
          const v = m.y + m.h / 2;
          const px = wx(u, v);
          const py = wy(u, v);
          ctx.fillStyle = '#3a3f52';
          ctx.fillRect(px - 0.5, py - 8, 1, 8);
          const on = all || hash2(k, Math.floor(t / 7), m.x) > 0.35;
          if (on && n > 0.2) {
            ctx.globalCompositeOperation = 'lighter';
            glow(ctx, WARM, px, py - 8, 6, n * (all ? 0.95 : 0.7));
            ctx.globalCompositeOperation = 'source-over';
            ctx.globalAlpha = 1;
          }
        }
        ctx.globalCompositeOperation = 'lighter';
        glow(ctx, WARM, wx(fx - 0.2, fy - 0.2), wy(fx - 0.2, fy - 0.2, 3), 16, 0.2 + 0.5 * n);
        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = 1;
      } else if (arg === 'fence') {
        // Fenced and dark; a faded sign.
        ctx.strokeStyle = css([110, 110, 120], 0.9);
        ctx.lineWidth = 0.6;
        ctx.beginPath();
        const pts: [number, number][] = [
          [m.x - 0.2, m.y - 0.2],
          [fx + 0.2, m.y - 0.2],
          [fx + 0.2, fy + 0.2],
          [m.x - 0.2, fy + 0.2],
        ];
        for (let k = 0; k < 4; k++) {
          const [u0, v0] = pts[k];
          const [u1, v1] = pts[(k + 1) % 4];
          ctx.moveTo(wx(u0, v0), wy(u0, v0, 5));
          ctx.lineTo(wx(u1, v1), wy(u1, v1, 5));
          ctx.moveTo(wx(u0, v0), wy(u0, v0, 2));
          ctx.lineTo(wx(u1, v1), wy(u1, v1, 2));
          for (let s = 0; s <= 6; s++) {
            const u = u0 + ((u1 - u0) * s) / 6;
            const v = v0 + ((v1 - v0) * s) / 6;
            ctx.moveTo(wx(u, v), wy(u, v));
            ctx.lineTo(wx(u, v), wy(u, v, 6));
          }
        }
        ctx.stroke();
        const sx = wx(fx + 0.2, fy + 0.2);
        const sy = wy(fx + 0.2, fy + 0.2, 9);
        ctx.fillStyle = css(world.story.flags.patron === 'basalt' ? [150, 96, 70] : [170, 150, 166], 0.8);
        ctx.fillRect(sx - 5, sy - 3, 10, 4);
      } else if (arg === 'archive') {
        // A guard box with one lit window.
        const gx = wx(fx + 0.5, fy - 0.3);
        const gy = wy(fx + 0.5, fy - 0.3);
        ctx.fillStyle = '#4b5168';
        ctx.fillRect(gx - 3, gy - 7, 6, 7);
        ctx.fillStyle = n > 0.3 ? css(WARM) : '#2a2e3c';
        ctx.fillRect(gx - 1.5, gy - 5.5, 3, 2);
        if (n > 0.3) {
          ctx.globalCompositeOperation = 'lighter';
          glow(ctx, WARM, gx, gy - 4.5, 5, n * 0.7);
          ctx.globalCompositeOperation = 'source-over';
          ctx.globalAlpha = 1;
        }
      } else if (arg === 'door' || arg === 'lamps') {
        // Ohm's door: lamps ring it. Every lamp lit: a small figure with a lamp at the door.
        const dx = wx(fx - 0.5, fy);
        const dy = wy(fx - 0.5, fy);
        if (arg === 'door') {
          for (let k = 0; k < 5; k++) {
            const a = Math.PI * (0.15 + k * 0.175);
            const px = dx + Math.cos(a) * 9;
            const py = dy - Math.sin(a) * 6 - 2;
            ctx.fillStyle = css(WARM, 0.9);
            ctx.fillRect(px - 0.8, py - 0.8, 1.6, 1.6);
            if (n > 0.2) {
              ctx.globalCompositeOperation = 'lighter';
              glow(ctx, WARM, px, py, 4, n * 0.8);
              ctx.globalCompositeOperation = 'source-over';
              ctx.globalAlpha = 1;
            }
          }
        } else {
          ctx.fillStyle = '#2c2a36';
          ctx.fillRect(dx + 6, dy - 5, 1.6, 5);
          ctx.beginPath();
          ctx.arc(dx + 6.8, dy - 5.8, 1, 0, Math.PI * 2);
          ctx.fill();
          ctx.globalCompositeOperation = 'lighter';
          glow(ctx, WARM, dx + 8.5, dy - 4, 6, 0.4 + 0.6 * n);
          ctx.globalCompositeOperation = 'source-over';
          ctx.globalAlpha = 1;
        }
      }
      break;
    }
  }
}

// ── The marks: after the buildings ─────────────────────────────────────────

function skyMark(ctx: CanvasRenderingContext2D, world: World, m: Mark, env: ArtEnv): void {
  const n = env.night;
  const t = env.time;
  const N = world.N;
  const [kind, arg] = m.decal.split(':');
  switch (kind) {
    case 'kite': {
      // lark's kite over the tallest building on Kites turf; by night its tail blinks. A second, smaller one after ep.kite.
      const h = hostTop(world, m);
      const cx = wx(h.x + 0.5, h.y + 0.5);
      const top = wy(h.x + 0.5, h.y + 0.5, h.h);
      if (hidden(world, h.x, h.y, h.h + 30)) return;
      const spr = mothKite();
      const n2 = arg === '2' ? 2 : 1;
      for (let k = 0; k < n2; k++) {
        const s = k ? 0.65 : 1;
        const kx = cx + (k ? -26 : 18) + Math.sin(t * 0.7 + k * 2) * 5;
        const ky = top - (k ? 34 : 46) + Math.sin(t * 1.1 + k) * 3;
        ctx.strokeStyle = css([235, 230, 245], 0.55);
        ctx.lineWidth = 0.5;
        ctx.beginPath();
        ctx.moveTo(cx, top);
        ctx.quadraticCurveTo(cx + (kx - cx) * 0.3, top - 6, kx, ky + 9 * s);
        ctx.stroke();
        if (spr) ctx.drawImage(spr, kx - 14 * s, ky - 11 * s, 28 * s, 22 * s);
        // The tail.
        for (let j = 1; j <= 4; j++) {
          const tx = kx + Math.sin(t * 2 + j + k) * 2.5 * j * 0.5;
          const ty = ky + 9 * s + j * 4 * s;
          const blink = n > 0.3 && Math.floor(t * 2 + j) % 4 === 0;
          ctx.fillStyle = css(blink ? [255, 240, 200] : LILAC, 0.9);
          ctx.fillRect(tx - 1, ty - 1, 2, 2);
          if (blink) {
            ctx.globalCompositeOperation = 'lighter';
            glow(ctx, LILAC, tx, ty, 5, n);
            ctx.globalCompositeOperation = 'source-over';
            ctx.globalAlpha = 1;
          }
        }
      }
      break;
    }
    case 'mast': {
      // The Clean Glass mast: a floodlit precinct mast at the Seam, its searchlight sweeping at night.
      const x = m.x + (m.w >> 1);
      const y = m.y + (m.h >> 1);
      if (hidden(world, x, y, 40)) return;
      const bx = wx(x + 0.5, y + 0.5);
      const by = wy(x + 0.5, y + 0.5);
      ctx.fillStyle = '#5c6378';
      ctx.fillRect(bx - 1, by - 62, 2, 62);
      ctx.fillStyle = '#7d869e';
      ctx.fillRect(bx - 5, by - 64, 10, 3);
      ctx.fillStyle = css(n > 0.3 ? COLD : [180, 190, 205]);
      ctx.fillRect(bx - 4, by - 63, 2, 1.5);
      ctx.fillRect(bx + 2, by - 63, 2, 1.5);
      if (n > 0.3) {
        const a = t * 0.6;
        const ex = bx + Math.cos(a) * 110;
        const ey = by + Math.sin(a) * 55 + 10;
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = 0.18 + 0.22 * n;
        ctx.fillStyle = css(COLD, 0.55);
        ctx.beginPath();
        ctx.moveTo(bx - 1, by - 63);
        ctx.lineTo(ex - 18, ey);
        ctx.lineTo(ex + 18, ey);
        ctx.lineTo(bx + 1, by - 63);
        ctx.closePath();
        ctx.fill();
        glow(ctx, COLD, ex, ey, 22, 0.5 * n);
        glow(ctx, COLD, bx, by - 63, 8, n);
        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = 1;
      }
      break;
    }
    case 'relay': {
      // The dead channel: one unlit relay mast at the old pump outfall.
      if (hidden(world, m.x, m.y, 20)) return;
      const bx = wx(m.x + 0.5, m.y + 0.5);
      const by = wy(m.x + 0.5, m.y + 0.5);
      ctx.fillStyle = '#3e4252';
      ctx.fillRect(bx - 0.8, by - 34, 1.6, 34);
      ctx.strokeStyle = '#3e4252';
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      ctx.moveTo(bx - 5, by - 22);
      ctx.lineTo(bx, by - 34);
      ctx.lineTo(bx + 5, by - 22);
      ctx.stroke();
      ctx.fillStyle = '#585c6c';
      ctx.beginPath();
      ctx.ellipse(bx + 3, by - 28, 3, 1.6, -0.5, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 'mural': {
      // The Truce Wall: both crews' tags meet on one long mural along the Seam's facades (each block's street face:
      // an Undertow-green and a Kites-lilac half, the two tags meeting in the middle).
      const spr = truceTags();
      for (let y = m.y; y < m.y + m.h; y++)
        for (let x = m.x; x < m.x + m.w; x++) {
          const tl = world.tiles[y * N + x];
          if (tl.road || (tl.zone === ZoneType.None && tl.buildingId < 0) || (tl.buildingId < 0 && tl.level === 0)) continue;
          if (hidden(world, x, y, 10)) continue;
          // The left (south-west) face, from its west corner to its south corner, a strip 3–12 px up.
          const ax = wx(x + 0.08, y + 0.92);
          const ay = wy(x + 0.08, y + 0.92);
          const bx = wx(x + 0.92, y + 0.92);
          const by = wy(x + 0.92, y + 0.92);
          const mx = (ax + bx) / 2;
          const my = (ay + by) / 2;
          const band = (x0: number, y0: number, x1: number, y1: number, c: RGB) => {
            ctx.fillStyle = css(c, 0.85);
            ctx.beginPath();
            ctx.moveTo(x0, y0 - 3);
            ctx.lineTo(x1, y1 - 3);
            ctx.lineTo(x1, y1 - 12);
            ctx.lineTo(x0, y0 - 12);
            ctx.closePath();
            ctx.fill();
          };
          band(ax, ay, mx, my, [52, 120, 40]);
          band(mx, my, bx, by, [104, 74, 150]);
          ctx.strokeStyle = css([255, 250, 235], 0.6);
          ctx.lineWidth = 0.6;
          ctx.beginPath();
          ctx.moveTo(ax, ay - 12);
          ctx.lineTo(bx, by - 12);
          ctx.stroke();
          if (spr) {
            ctx.save();
            ctx.transform(1, -0.5, 0, 1, mx, my - 7.5);
            if (n > 0.3) {
              ctx.globalCompositeOperation = 'lighter';
              ctx.globalAlpha = n;
              ctx.drawImage(spr, -12, -6, 24, 11);
              ctx.globalCompositeOperation = 'source-over';
              ctx.globalAlpha = 1;
            }
            ctx.drawImage(spr, -11, -5, 22, 10);
            ctx.restore();
          }
          MARKS_STATS.skyDecals++;
        }
      break;
    }
    case 'dark': {
      // Three developed blocks keep their windows dark at night; a lime moth stencil on one wall.
      if (n < 0.25) return;
      const ids = arg.split('.').map(Number);
      ids.forEach((i, k) => {
        const x = i % N;
        const y = (i / N) | 0;
        if (hidden(world, x, y, 8)) return;
        const h = Math.max(10, heightOf(world, x, y) - 4);
        const L = [wx(x + 0.12, y + 0.88), wy(x + 0.12, y + 0.88)];
        const B = [wx(x + 0.88, y + 0.88), wy(x + 0.88, y + 0.88)];
        const R = [wx(x + 0.88, y + 0.12), wy(x + 0.88, y + 0.12)];
        ctx.globalAlpha = 0.62 * Math.min(1, n * 1.4);
        ctx.fillStyle = '#0c0d16';
        ctx.beginPath();
        ctx.moveTo(L[0], L[1]);
        ctx.lineTo(B[0], B[1]);
        ctx.lineTo(R[0], R[1]);
        ctx.lineTo(R[0], R[1] - h);
        ctx.lineTo(B[0], B[1] - h);
        ctx.lineTo(L[0], L[1] - h);
        ctx.closePath();
        ctx.fill();
        ctx.globalAlpha = 1;
        if (k === 0) {
          const spr = sigilSprite('moth', css(LIME), 32);
          if (spr) {
            ctx.globalCompositeOperation = 'lighter';
            ctx.globalAlpha = 0.7;
            ctx.drawImage(spr, (L[0] + B[0]) / 2 - 5, (L[1] + B[1]) / 2 - h * 0.5 - 5, 10, 10);
            ctx.globalCompositeOperation = 'source-over';
            ctx.globalAlpha = 1;
          }
        }
        MARKS_STATS.skyDecals++;
      });
      break;
    }
    case 'balcony': {
      // The answering balcony: a lit balcony with a public terminal on the hall's front.
      const h = BUILDINGS[world.buildings.get(world.tiles[m.y * N + m.x].buildingId)?.type ?? 'charterhall']?.height ?? 40;
      if (hidden(world, m.x + m.w - 1, m.y + m.h - 1, h * 0.5)) return;
      const u = m.x + m.w;
      const v = m.y + m.h * 0.55;
      const bx = wx(u, v);
      const by = wy(u, v, h * 0.45);
      ctx.fillStyle = '#c8cbd8';
      ctx.fillRect(bx - 6, by, 12, 1.6);
      ctx.fillStyle = css(n > 0.3 ? WARM : [210, 200, 170]);
      ctx.fillRect(bx - 4, by - 6, 8, 6);
      ctx.fillStyle = css([120, 220, 255]);
      ctx.fillRect(bx + 4.5, by - 4, 2, 3);
      if (n > 0.25) {
        ctx.globalCompositeOperation = 'lighter';
        glow(ctx, WARM, bx, by - 3, 10, n * 0.8);
        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = 1;
      }
      break;
    }
    case 'banner': {
      // The vote's banner (Basalt orange, Nacre pearl, the Board's blue) on a tall pole at a street of the renamed cell.
      // At the building's front (south) corner, on the pavement; else at a street of its cell.
      let x = m.x + m.w - 1;
      let y = m.y + m.h - 1;
      if (m.w >= 8) {
        const r = roadsAt(world, m);
        const i = r.length ? r[(r.length >> 1) | 0] : (m.y + (m.h >> 1)) * N + m.x + (m.w >> 1);
        x = i % N;
        y = (i / N) | 0;
      }
      if (hidden(world, x, y, 22)) return;
      const c = m.id === 'patronBasalt' ? BASALT : m.id === 'patronNacre' ? PEARL : BOARD;
      const bx = wx(x + 1.1, y + 1.1);
      const by = wy(x + 1.1, y + 1.1);
      ctx.fillStyle = '#4a5064';
      ctx.fillRect(bx - 0.8, by - 30, 1.6, 30);
      const wave = Math.sin(t * 1.7 + x) * 0.8;
      ctx.fillStyle = css(c);
      ctx.beginPath();
      ctx.moveTo(bx + 0.8, by - 30);
      ctx.lineTo(bx + 8, by - 29 + wave);
      ctx.lineTo(bx + 8, by - 15 + wave);
      ctx.lineTo(bx + 0.8, by - 16);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = css([255, 255, 255], 0.8);
      ctx.fillRect(bx + 3, by - 25 + wave * 0.5, 2.6, 5);
      if (n > 0.3) {
        ctx.globalCompositeOperation = 'lighter';
        glow(ctx, c, bx + 4, by - 23, 12, n * 0.7);
        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = 1;
      }
      break;
    }
    case 'hall': {
      // The Board archive's flag over the old pump hall.
      if (arg !== 'archive') return;
      if (hidden(world, m.x, m.y, 30)) return;
      const bx = wx(m.x + 0.4, m.y + 0.4);
      const by = wy(m.x + 0.4, m.y + 0.4, 18);
      ctx.fillStyle = '#5a6074';
      ctx.fillRect(bx - 0.6, by - 22, 1.2, 22);
      const wave = Math.sin(t * 2 + m.x) * 0.6;
      ctx.fillStyle = css(BOARD);
      ctx.fillRect(bx + 0.6, by - 22 + wave, 7, 4.5);
      ctx.fillStyle = css([240, 246, 255]);
      ctx.fillRect(bx + 0.6, by - 18.5 + wave, 7, 1);
      break;
    }
    case 'fen': {
      // fen's kites off the Ribbon stations, by day.
      if (n > 0.55) return;
      const spr = diamondKite(LILAC);
      if (!spr) return;
      for (const id of arg.split('.').map(Number)) {
        const b = world.buildings.get(id);
        if (!b) continue;
        const s = BUILDINGS[b.type].size;
        const h = BUILDINGS[b.type].height ?? 30;
        const kx = wx(b.x + s / 2, b.y + s / 2) + Math.sin(t * 0.8 + id) * 8;
        const ky = wy(b.x + s / 2, b.y + s / 2, h + 34) + Math.sin(t * 1.2 + id) * 3;
        ctx.globalAlpha = 1 - n;
        ctx.drawImage(spr, kx - 6, ky - 7, 12, 14);
        ctx.globalAlpha = 1;
      }
      break;
    }
    case 'highline': {
      // The High Line: kites over the Seam.
      if (n > 0.6) return;
      const spr = diamondKite([255, 214, 120]);
      if (!spr) return;
      for (let k = 0; k < 3; k++) {
        const u = m.x + m.w * (0.25 + k * 0.25);
        const v = m.y + m.h * (0.7 - k * 0.2);
        const kx = wx(u, v) + Math.sin(t * 0.9 + k * 2) * 6;
        const ky = wy(u, v, 70 + k * 12) + Math.sin(t * 1.4 + k) * 3;
        ctx.globalAlpha = 1 - n * 0.8;
        ctx.drawImage(spr, kx - 6, ky - 7, 12, 14);
      }
      ctx.globalAlpha = 1;
      break;
    }
  }
}

// ── Entry points ───────────────────────────────────────────────────────────

/** Draw the visible marks' ground decals and the ending's street look (world transform, before the buildings). */
export function draw(ctx: CanvasRenderingContext2D, world: World, marks: Marks, tiles: Rect, env: ArtEnv): void {
  bindMarks(world);
  MARKS_STATS.props = 0;
  MARKS_STATS.decals = 0;
  MARKS_STATS.skyDecals = 0;
  clock = env.time;
  if (env.zoom < MARKS_MIN_ZOOM) return;
  const st = world.story;
  const p = env.zoom >= PROPS_MIN_ZOOM ? listProps(world, tiles, env.quality) : null;
  ctx.save();
  if (p && st.ending) streetLook(ctx, world, p, env);
  for (const m of marks.list) {
    if (!inRect(m, tiles, m.decal.startsWith('livery') ? 64 : 2)) continue;
    if (m.decal.startsWith('livery') && !p) continue;
    groundMark(ctx, world, m, env, marks.version);
    MARKS_STATS.decals++;
  }
  ctx.restore();
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
}

/** Draw the tall and facade decals after the buildings (render/story.ts drawSkyFx). */
export function drawSky(ctx: CanvasRenderingContext2D, world: World, marks: Marks, tiles: Rect, env: ArtEnv): void {
  if (env.zoom < MARKS_MIN_ZOOM || !marks.list.length) return;
  ctx.save();
  for (const m of marks.list) {
    if (!inRect(m, tiles, 3)) continue;
    skyMark(ctx, world, m, env);
  }
  ctx.restore();
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
}
