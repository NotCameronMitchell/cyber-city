# Story layer: Step 0 contract

Read this first, then the STORY.md sections for your package. Step 0 landed the shared
interfaces from STORY.md §12. The story is **inert**: every new field defaults to an identity,
and the sandbox plays exactly as before. From now on, shared interfaces change **additively
only**, with a note to every package.

## Files and owners

| File | Owner | Step 0 state |
|---|---|---|
| `src/game/types.ts` | B | New `BuildingType`s (`stack foundry glarewall tidemarket roost commons memorial`), `ToolId` `skybridge`/`rail`, `OverlayId` `turf`, `Building.stage?/buildDays?/crown?`, `SaveData.story?` |
| `src/game/story/types.ts` | shared (B keeps) | **All** story types: ids, `Metric`, `Condition`, `Effect`, `SimMods`/`ModPatch`/`ModKey`, `SimLayers`/`LayerParts`, content types, `StoryState`, `TurfMap`, `SkyLink`, `StorySave`, `StorySignal`, `VerticalCache`, `BuildingStats`, `ActionResult`, `InspectAction`, `StoryView`, `VisualState` |
| `src/game/story/mods.ts` | B | **Done**, tested: `DEFAULT_MODS`, `cloneMods`, `resetMods`, `combine`, `clampMods`, `makeLayers`, `resetLayers`, `makeLayerParts`, `composeLayers`, `MOD_CLAMPS`, key lists |
| `src/game/story/state.ts` | B | **Done**: `newStoryState(seed)`, `emptyTurf()`, `emptyVertical()`, `emptyLedger()`, `emptyStoryView()`, `coherenceFor()`, `NEVER_TICK`, `CHAPTER_NUMERALS` |
| `src/game/story/resolve.ts` | A | Stub: timed mods + `turfPatch` + `verticalPatch`, clamped. A adds sources 2–4 and 8 |
| `src/game/story/director.ts` | A | Stub with the final API; inert; skeleton `onDay`/`onMonth` order |
| `src/game/story/factions.ts` | A | Stub: `standing(world,f)` (favor only), `tier(world,f)`, `tierOf(n)` |
| `src/game/story/turf.ts` | C | Stub: `update(world)`, `refreshStats(world)`, `turfPatch(world)` |
| `src/game/story/vertical.ts` | C | Stub: `refresh(world)`, `onDay(world)`, `upkeep(world)`, `verticalPatch(world)` |
| `src/game/buildingStats.ts` | B | **Done**: `buildingStats(b, out?)`, `completeStage(b)` |
| `src/game/config.ts` | B | New buildings + every §14 table (below) |
| `src/game/events.ts` | B | Story events (below) |
| `src/game/world.ts` | B | Story fields + mutators; v1/v2 load accepted (`story` not decoded yet) |
| `src/game/actions.ts`, `game.ts` | C | Gate-aware `lockedReason`, `isUnlocked`; `raiseStage`/`crackdown` stubs; Game story forwards |
| `src/render/art/services.ts` | D | Placeholder recipes/palettes for the 7 new types (replace with `art/story.ts`, `art/vertical.ts`) |
| `tests/story/mods.test.ts`, `tests/story/contract.test.ts` | Step 0 | Keep passing; extend freely |

Not created (owners write them): `story/encode.ts` (B), `story/{conditions,effects,pacing}.ts`,
`story/content/*` (A), `src/ui/story/*`, `art/story.ts`, `art/vertical.ts` (D).

## World fields (`src/game/world.ts`)

| Field | Written by | Read by |
|---|---|---|
| `story: StoryState` | director (A) | everyone (read-only outside A) |
| `turf: TurfMap` (+ derived `turf.stats`) | turf.ts (C); `addBuilding` clears footprint turf | sim (gangSurge), render, A metrics |
| `rail: Uint8Array` (N1 E2 S4 W8) | `setRail` / `clearRail` (C) | render, vertical |
| `links: SkyLink[]`, `nextLinkId` | `addLink` / `removeLinksAt` (C) | render, vertical |
| `vertical: VerticalCache` | vertical.ts (C) | A metrics, render (`activeLinks`, `railLive`) |
| `mods: SimMods` | director via `resolveMods` (replaced each time: **never cache it**) | sim, actions, game |
| `layerParts.{turf,vertical,local}` | turf.ts / vertical.ts / director, each only its own | `composeLayers` |
| `layers: SimLayers` | `composeLayers` only | sim |
| `ledger: StoryLedger` (positive amounts) | director, monthly | budget (B appends lines) |
| `signals: StorySignal[]` | sim + actions via `world.pushSignal()` (capped 256) | drained by `director.onDay()` |

Mutators: `setRail(x,y,mask)`, `clearRail(x,y)` (unhooks neighbours), `addLink({ax,ay,bx,by})`
→ `SkyLink`, `removeLinksAt(x,y)` → count, `setStage(b, stage, buildDays, crown?)`,
`pushSignal(s)`. `clearTile` and `removeBuilding` also clear rail and drop links on their tiles.

Layer rule: an owner `resetLayers(world.layerParts.X)`, writes its part, then calls
`composeLayers(world)` (≈0.1 ms). The sim reads only `world.mods`, `world.layers`,
`world.ledger` (and plain `world.turf` for gangSurge). **The sim never imports `story/*`
logic** (`story/mods.ts` and `story/state.ts` are pure leaves and are fine).

## Events added to `GameEventMap`

`card {id}|null` · `incoming {id}` · `pending {id}|null` · `chapter {n,title}` · `goal {id,done}` ·
`standing {faction,delta,value}` · `trace {value}` · `log {n}` · `ending {id}` ·
`unlock {what}` · `charterNight` · `turf` · `vertical` · `story` (view changed; re-read
`game.story.view()`). `pending`, `unlock`, `charterNight` and `story` are Step 0 additions.
No new `sfx` kinds (audio keys a `Record` on them); reuse the existing ones.

## Game API (`src/game/game.ts`)

`game.story: StoryDirector` is rebuilt with `world` and `sim` (never cache it). Order on
new/load/restore: `new Simulation` → `new StoryDirector(game)` (derives turf, vertical, mods and
layers; `game.sim` exists but has not run yet) → `sim.recomputeAll()`. `update(dt)` calls `story.update(dt, paused)`,
`story.onDay()` after each `sim.step()`, stops the step loop when `story.blocking`, and pauses /
restores speed around blocking cards. Forwards: `choose(i)`, `openPending()`, `later()`,
`raiseStage(id, crown?)`, `crackdown(precinctId)`, `signPact(g)`, `takeDeal(f)`, `sendSalt(f)`,
`nudge(f)`, `chooseEnding(id)`, `recount()` → `ActionResult {ok, reason?, cost}`. On success
they emit sfx, `story.markDirty()`, `sim.recomputeAll()`, `stats`; on failure toast the reason.
`inspectActions(x,y): InspectAction[]` (stub `[]`; `buildingId`, `radius`, `days`, `crowns`
rows). Instance `toolCost(tool)` (× `buildCostMul` × `costMul`); static `Game.toolCost` kept.
`setTax` clamps to `mods.taxCap`. `newCity` caps names at `CITY_NAME_MAX` (24).

## Director API (`src/game/story/director.ts`, A)

`constructor(game)`, `update(dt, paused)`, `onDay()`, `onMonth()`, `choose(i)`, `openPending()`,
`later()`, `takeDeal(f)`, `signPact(g)`, `sendSalt(f)`, `nudge(f)`, `chooseEnding(id)` → `Result`,
`recount()`, `markDirty()`, `view(): StoryView` (cached), `readonly visual: VisualState`,
`get blocking()`, `activeSec`. D renders only from `view()`, `visual`, `inspectActions`,
world data and `buildingStats`.

## Cross-package functions (final signatures; owners fill bodies)

- A → C: `factions.ts` `standing(world, f)`, `tier(world, f)`, `tierOf(standing)`.
- C → A: `turf.update(world)`, `turf.refreshStats(world)`, `turfPatch(world)`;
  `vertical.refresh(world)`, `vertical.onDay(world)`, `vertical.upkeep(world) → {skybridges, rail}`,
  `verticalPatch(world)`. Import as `import * as turf from './turf'`.
- C → B: `actions.raiseStage(world, id, crown?)`, `actions.crackdown(world, precinctId)`.
- B → all: `buildingStats(b, out?)` (pass `out` in hot loops). Stack rules: complete stage =
  `buildDays > 0 ? stage − 1 : stage` (no stage field = 1 complete); residents, jobs, trips
  and upkeep count only while powered and not offline; `powerUse` always counts (so the grid
  can power it); crown jobs / residents / pollution at stage 3; `tall` from stage 2.

## Config tables (`src/game/config.ts`)

`BuildingDef` gains `category 'vertical'|'faction'`, `gate?: BuildingGate`, `tall?`, `station?`
(spire/arcology/glarewall tall; maglev/stack stations). Tables: `FACTION_LABELS`, `FACTION_IDS`,
`GANG_IDS`, `CORP_IDS`, `TURF_OWNER`/`TURF_GANG`, `GANG_NEWS_NAME`, `START_FAVOR`, `STANDING`,
`TRACE`, `COHERENCE`, `STORY_PACING`, `UNLOCK_FALLBACK_POP`, `TURF` (incl. `affinity`,
`crackdown`, `pact`, `surge`, `truce`, `protect`), `STACK_STAGES`, `STACK_COST_SCALE`,
`STACK_INTERNAL`, `STACK_SHADESIDE`, `CROWNS`, `SKYBRIDGE`, `RIBBON`, `SALT`, `PATRON_PERK`,
`POWER_WEIGHTS`, `FACTION_BUILD_REACTIONS`, `BUILD_REACTION_LIMIT(_BY_TYPE)`,
`OTHER_REACTIONS`, `GALLERY_KEY`. `SAVE_VERSION = 2`, `SAVE_VERSIONS_SUPPORTED = [1, 2]`,
`SAVE_KEY` unchanged.

## Save status (B finishes)

`deserialize` accepts v1 and v2, keeps well-formed stage fields, and marks a save without
`story` with `flags.migrated`. `serialize` writes v2 **without** `story` until `encode.ts`
lands (a valid v2 save per §10.8). Turf, rail and links are not saved yet.

## Defaults and conventions

- "Never" ticks are `NEVER_TICK = −100000`; `turf.lowSince` −1 = not low;
  `turf.stats.strongest` −1 = none; `story.rng` is seeded from the city seed.
- `lockedReason`: gated types open on `story.unlocks` or `gate.fallbackPop`; the faction-tier
  and turf parts are C's TODO (until then they read "Locked: Basalt Friendly" etc.).
  `skybridge`/`rail` tools open on unlock or `UNLOCK_FALLBACK_POP`. `isUnlocked(world, what)`.
- `clampMods` extras beyond §10.4: `outageChance` [0, 1], `upkeepMulType` [0.25, 4],
  non-finite values reset to identity. `composeLayers` keeps additive layers ±1, transit 0..1,
  multipliers ≥ 0.
- New tools/overlay are **not** in the toolbar or overlay picker yet (D adds the Sky/Deals
  groups and Turf).
