# Cyber City — architecture & module contracts

An original isometric city builder with a neon cyberpunk look, built for phones
first (touch, portrait + landscape, notch-safe) and playable on desktop.
Vanilla TypeScript + Vite + Canvas 2D. No runtime dependencies.

**IP rule:** everything is original. Do not use names, places, corporations,
characters, slang, logos or UI likenesses from existing games or franchises
(e.g. no "Night City", "Arasaka", "Militech", "netrunner", "ripperdoc",
"eddies", "braindance", "preem", "choom", "chrome" as slang, SimCity names like
"Sims"/"Simoleons"/"Reticulating splines"). Invent our own.

## Layout

```
src/
  main.ts              boot + frame loop (integration)
  game/
    types.ts           shared data model            (additive changes only; see STORY-CONTRACT.md)
    config.ts          all balance numbers + content  (tune values freely, keep exports)
    rng.ts             Rng, hash2, valueNoise, fbm
    events.ts          Emitter + GameEventMap
    world.ts           World: tiles, buildings, fields, low-level mutators, save/load
    actions.ts         planAction / applyAction: player-facing rules + costs
    game.ts            Game controller: tool, speed, overlay, preview, settings, save
    sim.ts             Simulation (power, fields, demand, growth, budget, events)
    buildingStats.ts   stage-aware building numbers (Stratablocks)
    story/             story layer: director, conditions, effects, pacing, factions,
                       resolve, mods, turf, vertical, encode, state, types; content/
                       holds the cards and copy (see docs/STORY-CONTRACT.md)
  render/
    camera.ts          iso projection + Camera   (FROZEN API)
    palette.ts         colours, day/night blend, glow sprites
    renderer.ts        Renderer: terrain, roads, overlays, previews, depth-sorted objects
    buildings.ts       procedural art for zone buildings + service buildings
    effects.ts         Effects: street traffic, flying cars, rain, screen FX
  input/input.ts       InputController: touch / mouse / keyboard gestures
  ui/                  DOM HUD, toolbar, panels, dialogs (+ ui.css); ui/story/ story surfaces
  audio/audio.ts       AudioEngine: synthesized SFX + optional ambient music
tests/                 vitest unit tests (sim + actions + save)
```

Read `src/game/types.ts`, `src/game/config.ts`, `src/game/world.ts`,
`src/game/actions.ts`, `src/game/game.ts`, `src/render/camera.ts` and
`src/render/palette.ts` before writing code: they are the contract.

## Story layer

The campaign ("Who Holds the Charter", `docs/STORY.md`) sits on top of the
sandbox. `docs/STORY-CONTRACT.md` is its module contract: world fields, mutators,
events, the director API and who writes what. In short:

* `game.story` (`StoryDirector`) is rebuilt with every world; never cache it.
  `Game.update` calls `story.update(dt, paused)` each frame and `story.onDay()`
  after each sim step, and pauses while `story.blocking` (a card or Charter
  Night is open). It registers `story/content` when its module loads.
* The sim reads only `world.mods`, `world.layers` and `world.ledger` (plus
  `world.turf` for gang surges) and reports back through `world.pushSignal()`.
  The director owns `world.story`; `story/turf.ts` and `story/vertical.ts` own
  turf, rail, skybridges and Stratablock stages.
* UI and render read `game.story.view()` (cached, rebuilt on change), the
  `story` event, `game.story.visual`, `game.inspectActions(x, y)` and world data.
* Saves are version 3 (see "Expansion layer" below) with an optional `story`
  block (`story/encode.ts`); version 1 saves load with a fresh story at
  Chapter I (`flags.migrated`), version 2 saves keep theirs.

## Expansion layer

Road kinds, skyways, wealth tiers and ports (`docs/EXPANSION.md`, the binding
spec; numbers in `config.ts` §2.8 are tuning knobs, names and shapes are
contract). Everything is additive: a streets-only city plays exactly as before.

**Save v3 and save safety** (`game.ts`, `world.ts`, EXPANSION §2.3-§2.5).

* `SAVE_VERSION = 3`, `SAVE_VERSIONS_SUPPORTED = [1, 2, 3]`, `SAVE_KEY` unchanged.
  v3 adds tile bits (`roadKind`, `wealth`), `sky` (RLE of `world.sky`),
  `moments`, and the seaport `facing`, spaceport `buildDays` / `waitSec` /
  `launches` on buildings. Every field is sanitised on load and never throws;
  a v1 / v2 save loads all-Street, all-$, no skyways (`world.loadedVersion`).
* Game runs `sim.settleWealth()` once after loading a world with
  `loadedVersion < 3`, then `recomputeAll()`: an old city takes its tiers in one batch.
* Keys beside `SAVE_KEY`: `.future` (a newer build's save, copied once; while
  it is the stored save `game.saveBlocked` is true and `save()` writes nothing
  until an explicit New City; the start screen shows `FUTURE_SAVE_TEXT` instead
  of Continue), `.unreadable` (any other load failure), `.v2` (the first v1 / v2
  save a v3 build loads, never overwritten), `.prev` (the city New City
  replaced), `.mirror` (every v3+ `save()` also writes here; a pre-expansion
  build never touches it) and `.stale` (an older-version main found next to a
  v3+ mirror: the mirror is restored and the overwrite kept here, with one toast).
* `public/sw.js` `VERSION` is bumped with each release that changes the save.

**Invariants.** `recomputeAll()` never changes the structural tile fields
(`terrain, road, roadKind, zone, level, wealth, abandoned, variant, buildingId,
age`). Tiers move only inside `step()` (5-sample hysteresis, §4.3) and in
`settleWealth()`. `world.setWealth` emits no `tiles` event (tier art lives in
the zone sprite). `computeAccess` (`roads.ts`) is the one access rule: SimGrid,
`RoadAccessMap` and `World.hasRoadAccess` agree on mixed maps. Every new cadence
runs in unpaused real seconds or on `game.clockRate`; nothing sped up by speed 3
is meant to be read moment to moment except launches, which are real-time.

**New modules.**

| Module | What |
|---|---|
| `game/roads.ts` | `RoadKind` helpers: `ROAD_TOOLS`, `roadLinks`, `frontable`, `roadPrice`, `dragResult`, `fillKinds`, `computeAccess`, `lostAccess` |
| `game/wealth.ts` | tier tables (`zoneCapacity`, `zoneTaxMul`, `zonePowerMul`, `zonePollution`), `wealthScoreAt`, `wealthTerms`, `tierCap`, `potentialTier`, `stepTarget`, `wealthInfo` |
| `game/ports.ts` | `shoreFacing`, `shoreSites`, `berthTiles`, `noiseDef`, `noiseReach` |
| `game/skyway.ts` | sky bits (`SKY_N/E/S/W`, `SKY_RAMP`), `skyRampActive`, `skywayDocks`, `planSkyway` |
| `game/sim/ports.ts` | `PortSystem` behind the `PortView` interface (`sim.ports`, `game.ports`): visitors, trade, demand adds, `buildProgress` |
| `game/sim/tiers.ts` | flat tier tables for the hot loops |
| `game/story/content/cards/expansion.ts` | the eleven expansion deck cards (`EXPANSION_CARDS`), incl. on-demand `ex.rights` |
| `render/art/skyway.ts` | `SkywayLayer` (deck sprites from `SKY_BASE` 4000, own 6 MB `SpriteCache`), `drawSkywayGhost` |
| `render/art/ports.ts` | academy and port sprites, `PortFx` (ships, planes, launches; owned by `Effects` as `effects.ports`) |
| `ui/tips.ts` | first-use and sim-hint tips, one at a time (`Tips`) |

**World and fields.** `Tile.roadKind` (Street when `!road`), `Tile.wealth`
(0..2); `world.sky` (`Uint8Array`, link bits + ramp bit) and `skyVersion` (not
saved), `wealthStreak`, `loadedVersion`, `moments`. Mutators: `setRoad(x, y,
kind = Street)`, `setRoadKind`, `setLevel(x, y, level, abandoned, wealth?)`,
`setWealth`, `setSky`, `clearSky`, `clearTile(x, y, withSky = false)`,
`restoreTile(i, snap)`. `roadMask` is kind-aware, `roadAdjMask` raw.
`world.fields` gains `noise`, `education`, `skyTraffic`, `wealth` (score),
`hub`, `sea`, `alleyNear`; `world.stats` gains `wealth [$, $$, $$$]`,
`tierEffect`, `avgNoise`, `roads` (per kind + skyway), `edgeLinks`, `visitors`.

**Game additions.** `commit(from, to)` (confirm-aware: a plan with `confirm`
waits in `pendingConfirm` for `confirmPending()` / `cancelPending()`; `apply`
still applies directly), `undo()` / `undoLeft()` (one step, 10 s, road /
skyway / zone drags), `refundLeft(id)` (buildings, 30 s), `clockRate`,
`launchLead`, `launchStatus(id)`, `readyLaunches()` (test hook), `ports`,
`getTileInfo(x, y, sky?)` (rows plus `notes` and `meter`),
`inspectActions(x, y, sky?)` (adds `'rights'`, `'skyway'`),
`openLaunchRights(buildingId)`, `demolishSkySegment(x, y)`,
`toast(text, kind, action?)`. `select()` keeps `{x, y, sky: true}` apart from
`{x, y}`. `actions.ts` adds `snapSeaport` and `skywayNetwork`.

**Events.** `liftoff {id, first}` (a visible launch: at night, ≥ 180 unpaused
seconds apart; Effects and audio listen), `hint {id: 'wealth' | 'ramps' |
'noise'}` (advisor → tips), `moment {id, title, sub}` (once per city per port
and the first launch; the banner shows it), and `toast.action {id: 'undo' |
'watch', label, sec}`.

**Story.** `director.openOnDemand(id)` opens an `onDemand` card outside the
deck with no Later and no pacing-clock change (the Spaceport's "Launch
rights"). New metrics `wealth.high`, `wealth.low`, `roads.highway`,
`roads.alley`, `skyway.tiles`; spot rules `highway`, `alley`, `shore`; mood
drivers and capped power terms for alleys (≤ 60 Undertow) and skyways
(≤ 100 Kites). The deck gains 11 cards; there are no new chapter beats.

## Coordinates

* Tile (x, y), 0..63. Index `y * 64 + x`. "North" = y-1, "East" = x+1.
* World px (zoom 1): tile top corner `((x - y) * 32, (x + y) * 16)`; diamond is
  64 × 32. Height goes up (negative y). Helpers in `camera.ts`.
* Draw order back→front = ascending `x + y` (then ascending x). A multi-tile
  building at (bx, by, size) sorts at its front corner `bx+size-1 + by+size-1`.
* The renderer sets the canvas transform to world space
  (`ctx.setTransform(dpr*zoom, 0, 0, dpr*zoom, ...)`), so building art and
  world-space effects draw in **world px**, not screen px.

## Game (`src/game/game.ts`) — the hub

UI/input/renderer only talk to `Game` and read `game.world`:

* `game.tool`, `setTool(id)`; `game.speed` 0..3, `setSpeed`; `game.overlay`, `setOverlay`.
* `game.plan(from, to)` → `ActionPlan` (pure preview) · `game.setPreview(plan|null)` ·
  `game.apply(from, to)` executes (for `inspect` it selects the tile).
* `game.selected` + `select()`; `game.getTileInfo(x, y)` for the inspect panel.
* `game.timeOfDay` (0..1, 0 = midnight) and `game.daylight` (0 night … 1 day).
* `game.settings` + `updateSettings(patch)`; `game.setTax(rate)`.
* `game.newCity(name?)`, `save()`, `load()`, `hasSave()`, `snapshot()`, `restore(data)`.
* `game.update(dt)` runs sim ticks per `SPEED_TICKS_PER_SEC`.
* `game.events` (also `world.events` — same emitter): see `GameEventMap` in
  `events.ts`. `tiles` → invalidate render caches; `world` → whole world swapped
  (re-read `game.world`, drop all caches); `stats`, `news`, `toast`, `sfx`,
  `month`, `milestone`, `select`, `tool`, `speed`, `overlay`, `settings`.
* Note: `game.world` and `game.sim` are **replaced** on new game / load. Never cache them.

## Simulation (`src/game/sim.ts`)

```ts
export interface SimOptions { events: boolean }
export class Simulation {
  options: SimOptions;
  constructor(world: World);
  step(): void;          // advance one day (tick++), run systems, monthly budget
  recomputeAll(): void;  // rebuild power, coverage, fields, stats now; no time/money change
}
```

Responsibilities: power grid (BFS through roads, zone tiles and building tiles
from plants; brownouts allocate supply in BFS order from plants), coverage
fields from powered/online service buildings, pollution (sources + diffusion),
land value, crime, traffic (trips from developed zones onto nearby roads,
reduced by transit coverage), RCI demand (jobs↔residents balance + tax
pressure), zone growth/decline/abandonment (needs road access within 3, power,
positive demand, land-value thresholds from `ZONES[*].levelLandValue`),
monthly budget (`world.budget`, funds, 12-month history), milestones
(`MILESTONES`, grant once, emit `milestone` + news), random events when
`options.events`, flavor news, advisor warnings (rate-limited), `world.stats`
and `world.maxPopulation`. Emits via `world.events`. Sets `tile.powered`,
`building.powered`, increments `tile.age`. Use `world.setLevel()` for growth so
the renderer is notified. Deterministic given `world.rng`.

## Renderer (`src/render/renderer.ts`)

```ts
export class Renderer {
  constructor(canvas: HTMLCanvasElement, game: Game, camera: Camera);
  resize(): void;                    // read canvas CSS size + DPR, size backing store, camera.setViewport
  render(dt: number, time: number): void; // time = seconds since start
  readonly stats: { fps: number; drawMs: number };
}
```

## Building art (`src/render/buildings.ts`)

```ts
export interface ArtEnv {
  time: number;        // seconds, for animation
  night: number;       // 0 day .. 1 night (= 1 - game.daylight)
  zoom: number;        // camera zoom, for level-of-detail
  quality: 'low' | 'high';
  ghost?: boolean;     // draw as translucent placement ghost
}
/** Zone building on tile (tx,ty) whose top corner is world (wx,wy). Handles level 0 lot props, abandoned look and construction (tile.age small). */
export function drawZoneBuilding(ctx: CanvasRenderingContext2D, wx: number, wy: number, tile: Tile, tx: number, ty: number, env: ArtEnv): void;
/** Service building; (wx,wy) = world top corner of the footprint's (b.x,b.y) tile. */
export function drawServiceBuilding(ctx: CanvasRenderingContext2D, wx: number, wy: number, b: Building, env: ArtEnv): void;
/** Ghost for placement preview of a building type. */
export function drawBuildingGhost(ctx: CanvasRenderingContext2D, wx: number, wy: number, type: BuildingType, ok: boolean, env: ArtEnv): void;
/** Approx pixel height above the ground of what drawZoneBuilding draws (renderer uses it for culling + unpowered icons). */
export function zoneBuildingHeight(tile: Tile): number;
export function serviceBuildingHeight(type: BuildingType): number;
```

## Effects (`src/render/effects.ts`)

```ts
export class Effects {
  constructor(game: Game);
  update(dt: number): void;
  /** Street-level vehicles etc., world space, drawn after ground, before buildings. */
  drawGround(ctx: CanvasRenderingContext2D, bounds: {x0:number;y0:number;x1:number;y1:number}, env: ArtEnv): void;
  /** Flying vehicles, searchlights etc., world space, drawn after buildings. */
  drawSky(ctx: CanvasRenderingContext2D, bounds: {x0:number;y0:number;x1:number;y1:number}, env: ArtEnv): void;
  /** Screen-space FX (rain, vignette), identity transform scaled by DPR; width/height in CSS px. */
  drawScreen(ctx: CanvasRenderingContext2D, width: number, height: number, env: ArtEnv): void;
  /** Must cope with game.world being replaced (listen for 'world'). */
}
```

## Input (`src/input/input.ts`)

```ts
export class InputController {
  constructor(canvas: HTMLCanvasElement, game: Game, camera: Camera);
  update(dt: number): void;  // inertia, keyboard panning, edge auto-scroll
  destroy(): void;
}
```

## UI (`src/ui/ui.ts`, styles in `src/ui/ui.css`, imported by ui.ts)

```ts
export class UI {
  constructor(root: HTMLElement, game: Game, camera: Camera);
  update(dt: number): void; // per frame; throttle DOM writes internally
}
```

The UI root overlays the canvas with `pointer-events: none`; only real panels
take pointer events, so gestures on the map reach the canvas.
Never use `alert`, `confirm` or `prompt` (blocked in sandboxed frames); build
in-page dialogs.

## Audio (`src/audio/audio.ts`)

```ts
export class AudioEngine {
  constructor(game: Game);   // listens to 'sfx' + 'settings'; unlocks on first user gesture
}
```

## Platform constraints

* Must run as a normal site (GitHub Pages, relative base `./`) **and** as a
  single inlined HTML file inside a sandboxed iframe: there, service workers,
  `alert/confirm/prompt`, downloads and popups don't work, and `localStorage`
  may throw (always go through `storageGet/storageSet`: they live in the leaf module
  `src/game/storage.ts` and game.ts re-exports them).
* Phone performance budget: 60 fps target, ≥ 30 fps on a mid-range phone at
  default zoom with a fully built 64×64 map. Avoid `shadowBlur` in loops;
  use `glowSprite()` + `'lighter'`. Cache static layers. LOD by zoom.
* Touch targets ≥ 44 px. Respect `env(safe-area-inset-*)`.
