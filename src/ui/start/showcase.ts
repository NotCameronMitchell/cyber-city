// ─────────────────────────────────────────────────────────────────────────────
// First-launch backdrop. With no city to continue, the title would sit over a
// bare map, so it shows a small lit city instead, built in a few ms for the
// title only. It never touches the game: its own World (laid out tile by tile,
// no sim steps), one Simulation recompute for the fields the art reads
// (traffic, power, residents), its own Camera and a second Renderer on the same
// canvas. The renderer sees a view of the game that lends only the visual
// clock and the settings. Dropped (destroy) when the player leaves the title.
// ─────────────────────────────────────────────────────────────────────────────

import { hash2 } from '../../game/rng';
import type { Game } from '../../game/game';
import { Simulation } from '../../game/sim';
import { Terrain, ZoneType, type BuildingType } from '../../game/types';
import { World } from '../../game/world';
import { Camera, HALF_H, HALF_W } from '../../render/camera';
import { Renderer } from '../../render/renderer';

/** A seed whose coast and river frame the centre well (bay to one side, a river crossing). */
export const SHOWCASE_SEED = 20931;
/** Road grid pitch (tiles): 3 × 3 blocks between roads, as players build. */
const PITCH = 4;
/** Ticks the showcase pretends have passed (older than any construction animation). */
const AGE = 400;

/**
 * Lay out a dense, lit city around the map centre: towers in the core, mixed
 * blocks around it, houses and a little industry at the edge, a few landmarks.
 * Deterministic for a seed. Exported for tests.
 */
export function buildShowcase(seed = SHOWCASE_SEED): World {
  const w = World.generate(seed, 'Showcase');
  const N = w.N;
  w.funds = 1e9;
  const c = N / 2;
  const R = 4.8; // radius in blocks
  const at = (x: number, y: number) => w.tileAt(x, y);
  const land = (x: number, y: number) => at(x, y)?.terrain === Terrain.Land;

  type Block = { x: number; y: number; d: number; a: number };
  const blocks: Block[] = [];
  for (let by = -6; by <= 6; by++)
    for (let bx = -6; bx <= 6; bx++) {
      const x = c + bx * PITCH + 1;
      const y = c + by * PITCH + 1;
      if (x < 2 || y < 2 || x + 3 > N - 2 || y + 3 > N - 2) continue;
      // A ragged edge: the limit wobbles per block.
      const d = Math.hypot(bx + 0.5, by + 0.5);
      if (d > R + (hash2(bx, by, seed) - 0.5) * 1.6) continue;
      let dry = 0;
      for (let dy = 0; dy < 3; dy++) for (let dx = 0; dx < 3; dx++) if (land(x + dx, y + dy)) dry++;
      if (dry < 6) continue;
      blocks.push({ x, y, d, a: Math.atan2(by + 0.5, bx + 0.5) });
    }

  // Roads around every block (a tile shared by two blocks is laid once; water becomes a bridge).
  for (const b of blocks) {
    for (let i = -1; i <= 3; i++) {
      w.setRoad(b.x + i, b.y - 1);
      w.setRoad(b.x + i, b.y + 3);
      w.setRoad(b.x - 1, b.y + i);
      w.setRoad(b.x + 3, b.y + i);
    }
  }

  // Landmarks, nearest the centre first: a spire and a data hub in the core, services around it.
  blocks.sort((p, q) => p.d - q.d);
  const landmarks: { type: BuildingType; ring: number }[] = [
    { type: 'spire', ring: 0 },
    { type: 'datahub', ring: 1 },
    { type: 'plaza', ring: 1 },
    { type: 'maglev', ring: 2 },
    { type: 'clinic', ring: 3 },
    { type: 'precinct', ring: 3 },
    { type: 'plaza', ring: 3 },
    { type: 'reactor', ring: 4 },
  ];
  const used = new Set<Block>();
  for (const lm of landmarks) {
    const b = blocks.find((k) => !used.has(k) && k.d >= lm.ring && (lm.type !== 'reactor' || k.a > 0.6));
    if (!b) continue;
    if (w.addBuilding(lm.type, b.x, b.y)) used.add(b);
  }

  // Zones: a few towers in the core, mostly mid and low blocks around it (streets stay
  // visible between them), houses and a little industry at the edge, the odd empty lot.
  for (const b of blocks) {
    for (let dy = 0; dy < 3; dy++)
      for (let dx = 0; dx < 3; dx++) {
        const x = b.x + dx;
        const y = b.y + dy;
        const t = at(x, y);
        if (!t || t.terrain !== Terrain.Land || t.buildingId >= 0 || t.road) continue;
        const r = hash2(x, y, seed + 17);
        const h = hash2(x, y, seed + 29);
        const edge = b.d > R - 1.4;
        let zone: ZoneType;
        if (edge && b.a > 0.6 && b.a < 2.4) zone = ZoneType.Industrial;
        else if (b.d < 1.4) zone = r < 0.6 ? ZoneType.Commercial : ZoneType.Residential;
        else if (b.d < 2.8) zone = r < 0.3 ? ZoneType.Commercial : ZoneType.Residential;
        else zone = r < 0.1 ? ZoneType.Commercial : ZoneType.Residential;
        w.setZone(x, y, zone);
        let level: number;
        if (b.d < 1.4) level = h < 0.45 ? 3 : h < 0.9 ? 2 : 1;
        else if (b.d < 2.8) level = h < 0.14 ? 3 : h < 0.6 ? 2 : h < 0.94 ? 1 : 0;
        else level = h < 0.3 ? 2 : h < 0.9 ? 1 : 0;
        if (level > 0) w.setLevel(x, y, level);
      }
  }

  // Settled: no construction scaffolds, everything lit.
  w.tick = AGE * 4;
  const sim = new Simulation(w);
  sim.options.events = false;
  sim.recomputeAll();
  for (const t of w.tiles) {
    t.age = AGE;
    t.abandoned = false;
    if (t.road || t.zone !== ZoneType.None || t.buildingId >= 0) t.powered = true;
  }
  for (const b of w.buildings.values()) {
    b.powered = true;
    b.offline = 0;
  }
  return w;
}

/** The showcase's camera and renderer (main.ts renders it while the first-launch title is up). */
export class Showcase {
  readonly world: World;
  readonly camera: Camera;
  readonly renderer: Renderer;
  private readonly off: () => void;

  constructor(game: Game, canvas: HTMLCanvasElement) {
    this.world = buildShowcase();
    this.camera = new Camera(this.world.N);
    // Quality changed in Settings over the title: the showcase renderer resizes like the game's.
    this.off = game.events.on('settings', () => this.world.events.emit('settings'));
    // The renderer reads world, events, story visuals, overlay, tool, preview and selection
    // from its game; everything else (visual clock, daylight, settings) comes from the real one.
    const view = Object.create(game, {
      world: { value: this.world },
      events: { value: this.world.events },
      story: { value: null },
      overlay: { value: 'none' },
      tool: { value: 'inspect' },
      preview: { value: null },
      selected: { value: null },
    }) as Game;
    this.renderer = new Renderer(canvas, view, this.camera);
    this.frame();
  }

  /** Centre the city a touch below the middle (the wordmark sits over the top of the screen). */
  frame(): void {
    const cam = this.camera;
    const phone = Math.min(cam.width, cam.height) < 640;
    const land = cam.width > cam.height * 1.2;
    cam.zoom = phone ? (land ? 0.6 : 0.64) : 0.85;
    const cx = this.world.N / 2;
    const cy = this.world.N / 2;
    cam.x = (cx - cy) * HALF_W;
    cam.y = (cx + cy) * HALF_H - (land ? 0 : 30);
    cam.clamp();
  }

  resize(): void {
    this.renderer.resize();
  }

  destroy(): void {
    this.off();
    this.renderer.destroy();
  }
}
