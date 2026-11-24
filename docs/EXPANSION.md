# Cyber City: expansion spec, "Roads, Wealth and Ports"

This is the binding implementation spec for the owner's expansion request:

> "I'd also like to add different road types, different levels to zoning ($, $$, $$$), and airports/spaceports/ports in general, and any other things that could fit in."

It covers road tiers (Street, Avenue, Highway, Back Alley, On-ramp) and Skyways; wealth tiers that the city decides; the Seaport, Airport and Spaceport; three small optional extras; the phone UI, including confirm, undo and refund for costly actions; story hooks; audio; performance, saves and balance; and the work packages that build it. Every new cadence is set in real seconds (§1.3), because the owner's first line was "Pace of play feels way too fast". Appendix C lists the review points this revision rejected or changed, with reasons.

**Precedence.** `docs/DESIGN.md` (owner decisions) wins over this doc. `docs/STORY.md` stays the binding story spec; this doc only adds deck cards, mood rows, power terms, spot rules and build reactions to it. `docs/CONTRACTS.md`, `docs/STORY-CONTRACT.md` and `docs/PACING.md` still hold; §2 lists the additive changes to them.

**Owner decisions this doc implements (interview):**

| Topic | Decision |
|---|---|
| Wealth | "City decides": the $ / $$ / $$$ tier **emerges** from land value and conditions. It shows as a lens; the player steers it with services, parks, transit, schools and back alleys and never paints it. Density (level 1..3) keeps growing over time exactly as today. |
| Roads | Street, Avenue, Highway (rising cost and capacity; nothing fronts a highway; on-ramps connect it), Back Alleys (cheap, narrow, low capacity, more crime, gangs like them), Elevated Skyways (raised roads over streets, water and districts that link to megastructures). **No one-way streets.** |
| Ports | Seaport (cargo docks on the bay shore; industry; Undertow smuggling), Airport (large, noisy; commerce and tourism; planes), Spaceport (late-game megaproject; night launches; huge prestige; a faction wants to control it). **No aircar skyports.** |
| Extras | A small curated set, each optional and justified (§6). |
| Standing decisions | No losing. Late-game money is the player's reward (no levies, no treasury-scaled prices). Calendar and growth speed are fine. |
| Pace | "Pace of play feels way too fast." The story pace is handled by docs/PACING.md. This expansion adds no fast loops: every new cadence is in unpaused real seconds (§1.3), new unlocks sit on the existing population milestones (§2.8), and story additions are relaxed-cadence deck cards. |
| Story cadence | Another workflow slowed the story down. Nothing here depends on pacing numbers. Story additions are **deck cards and hooks** that suit a relaxed cadence, never new chapter beats. |

**Preconditions.** Implementation starts after the story-pacing workflow (story pacing, card `brief`, `Settings.storyPace`, glossary, `docs/PACING.md`) has merged. If it has not, Step 0 rebases its additive edits on top of it. Every edit in this expansion to a file that workflow touches (`types.ts`, `config.ts`, `game.ts`, `story/types.ts`, `story/director.ts`, `content/factions.ts`, `cards/index.ts`, `content-lint.test.ts`, `menu.ts`) is **additive**: new union members, new rows, new keys, one new director method. Nothing is renamed or reordered there.

**IP and copy.** Every name here is a generic term (Street, Avenue, Highway, Back Alley, On-ramp, Skyway, Seaport, Airport, Spaceport, Academy, $ / $$ / $$$). Wealth is always written as bare `$`, `$$`, `$$$`, never prefixed with a zone letter, and the lens is titled "Wealth". Player-facing copy in any file follows the STORY.md §1.4 voice and banned-term list; story speakers never use the `$` symbols (they say "glass towers", "top-rent floors"); the symbols stay in briefs, choice summaries and UI. Internal code and art words used in this doc (deck, ghost, shell…) never reach the screen.

**Notation.** CR is credits, d is sim days (1 tick = 1 day, 30 d = 1 month), r is a radius in tiles. "Within r" means Chebyshev distance ≤ r unless the text says Euclidean. Speed 1 runs 2 d per real second, speed 2 runs 6, speed 3 runs 16 (`SPEED_TICKS_PER_SEC`); the visual clock (`Game.clock`, day/night) runs ×1, ×1.6, ×2.4 (`Game.clockRate`, §2.7). Story effect notation is STORY.md §0 (`Board +5`, `[demandInd +0.1, 360d]`, `↻ +200/mo ×12mo "Label"`).

---

## 1. Overview and player fantasy

### 1.1 Features

| Feature | Player fantasy | What the player does |
|---|---|---|
| **Road tiers** | "I'm laying out a real city: quiet side streets, lit boulevards, a roaring expressway, and the back alleys where rents stay low." | Pick a road type from the Road tray and drag. Drag a bigger road over a smaller one to widen it. Drag a street across a highway to make on-ramps. |
| **Skyways** | "My megastructures are joined by roads in the sky, headlights streaming over the river and the old districts." | Drag a Skyway from the Sky tray, like the Ribbon Rail. Start or end it on a street to land a ramp; run it into a Stratablock, Spire, Arcology or the Airport to dock it. |
| **Wealth tiers** | "Neighbourhoods have character. Where I put schools, parks and transit, blocks turn glassy and gold. Next to the runway they stay rough. Behind the back alleys, rents stay low and more people fit. I shape it, I don't paint it." | Build services and transit, keep noise and crime down, or keep a quarter affordable with back alleys; watch the Wealth lens and the block art change. Inspect a block to see its score, what lifts it and what holds it back. |
| **Seaport** | "Cranes, container ships at night, Fab trade pouring in, and Old Brine's divers under the hulls." | Place a 4×4 port on one of the highlighted straight shores. |
| **Airport** | "A runway with planes landing over the city lights. A business district a few blocks out. Noise." | Place a 6×6 airport on open land, away from homes; the ghost shows which homes it would make loud. |
| **Spaceport** | "The megaproject. A launch tower rises over several minutes; then, on clear nights, a column of light leaves the city. Every faction wants the keys." | Place it late (30,000 residents, 150,000 CR, with a confirm step), watch it rise, decide who holds the launch rights from its inspect sheet, then watch the launches. |
| **Extras (optional)** | Academy (schools steer wealth), regional links (roads at the map edge bring trade), tourism (visitors pay). | §6. |

### 1.2 How they interlock

```
         ┌──────────── capacity ─────────────┐
 Road tiers ──► traffic field ──► localTraffic, noise ──► land value ──► WEALTH TIER ──► capacity, tax, power
   │  ▲             ▲                                ▲      ▲                │
   │  └ on-ramps    └ Skyways divert trips           │      └ Academy,     ├─► art, Wealth lens, inspect meter
   │                  (docks: megastructures, Airport)│        transit, parks │    ("lifted by" / "next tier")
   ├─ alleys: crime +, gang affinity +, affordable quarter (more homes, capped at $$)
   └─ roads that run off the map edge ──► regional trade (X2) ──► demand
 Ports ──► demand (Seaport: Fab, Airport/Spaceport: Market), noise, jobs, income lines, visitors (X3)
   │        Airport: Market tiles 6-16 tiles out score higher (business district); Seaport: Fab tiles within 12 score higher
   └─► story: build reactions, power terms, mood rows, deck cards (smuggling, night convoys, priced out, launch rights)
```

The three loops the player feels:

1. **Traffic loop.** More density → more trips → congestion lowers land value and blocks upgrades. Fix: widen to Avenues, add a Highway with on-ramps, divert to Skyways, or add transit.
2. **Wealth loop.** Services, transit and schools raise the wealth score; noise and crime lower it. Richer blocks pay clearly more tax per tile, draw more power and hold slightly fewer people. Back alleys keep a quarter affordable: homes beside them hold more people but stay at most $$ and bring crime. The Board frets when glass towers take over (story, §8). There is no hidden sandbox penalty for a rich city: money is the reward.
3. **Port loop.** Ports raise demand and income but bring noise. Where the player puts them decides which districts stay $ and which turn $$$.

### 1.3 Pace in real time

Every new cadence, in **unpaused real seconds**. Speed 1 = 2 d/s and clock ×1; speed 3 = 16 d/s and clock ×2.4. "Clock-scaled" means it advances with `Game.clockRate` (frozen while paused), the same factor that drives day and night.

| What | Rule | Speed 1 | Speed 3 | Reads as |
|---|---|---|---|---|
| Wealth score after the player builds | `recomputeAll` after every action | at once | at once | the inspect meter and the lens pips move immediately |
| One tier step of one block | 5 sampled evaluations (≈ 30 d), §4.3 | ≈ 15 s | ≈ 2 s | like a density level-up; palette and props change, no construction animation |
| $ → $$$ climb | two steps (≈ 60 d) | ≈ 30 s | ≈ 4 s | a neighbourhood changing over a minute of play |
| Seaport ship cycle | 80 clock-s; the first ship arrives at opening | 80 s | 33 s | one ship, ambient |
| Airport plane cycle | 36 clock-s; the first landing at opening | 36 s | 15 s | one plane, ambient |
| Spaceport construction | `max(240 d, SPACEPORT.minBuildSec 240 s)` | 240 s | 240 s | a project the player watches rise |
| Spaceport launch | night and ≥ `launchGapSec` 180 s since the last | ≈ 240 s (one a night) | ≈ 200 s (every other night) | an event; the news line posts at liftoff |
| Launch sequence / rumble | 14 s visual, 3 s sound; a cut-scene, not sped up | 14 s | 14 s | the headline moment, with a Watch button the first time |
| Undo window (road, skyway, zone drags) | 10 s wall clock | 10 s | 10 s | — |
| Refund window (any building) | 30 s wall clock after placing | 30 s | 30 s | — |
| Port opening banner | once per city per port type | — | — | a celebration |
| Wealth highlight news | once each per session | — | — | — |
| Expansion deck cards | the pace setting's deck gaps (PACING.md); 8 of 11 are `once` | — | — | rare |

Speed 3 is fast-forward: growth already moves this fast there, and the owner called the growth speed fine. Nothing in the expansion depends on speed 3 being readable moment to moment except launches, which are real-time.

---

## 2. Data model

Everything here is additive. v1 and v2 saves keep loading. Step 0 (§11) lands all of it in one commit.

### 2.1 `src/game/types.ts`

```ts
/** Ground road kinds. Stored in Tile.roadKind (save bits 15-17). 0 must stay Street (old saves decode as 0). */
export enum RoadKind {
  Street = 0,
  Avenue = 1,
  Highway = 2,
  Alley = 3,
  /** On-ramp: joins a highway to the street grid. Created only by the drag rule in §3.4. */
  Ramp = 4,
}

/** Wealth tier of a zone tile: 0 = $, 1 = $$, 2 = $$$. Set by the sim only. */
export type WealthTier = 0 | 1 | 2;

export type BuildingType =
  | /* …existing… */
  | 'academy'    // X1 (optional extra, §6.1)
  | 'seaport'
  | 'airport'
  | 'spaceport';

/** 'road' stays the Street tool id (the Ch1 boot, the coach CTA and KeyR depend on it). */
export type ToolId = /* …existing… */ | 'avenue' | 'highway' | 'alley' | 'skyway';

export type OverlayId = /* …existing… */ | 'wealth' | 'noise';

export type ServiceEffect = /* …existing… */ | 'education';

export interface Tile {
  /* …existing… */
  /** Ground road kind. 0 (Street) whenever `road` is false. */
  roadKind: RoadKind;
  /** Wealth tier. 0 whenever zone = None or level = 0. */
  wealth: WealthTier;
}

export interface Building {
  /* …existing… */
  /** Seaport only: the side that faces open water. 0 = N (y−1), 1 = E, 2 = S, 3 = W. */
  facing?: 0 | 1 | 2 | 3;
  // buildDays (existing) is now also used by the Spaceport (§5.3).
  /** Spaceport only: unpaused real seconds of construction still required (§5.3). Saved. */
  waitSec?: number;
  /** Spaceport only: launches seen so far (0 = the next one is the first). Saved. */
  launches?: number;
}

export interface Fields {
  /* …existing… */
  /** 0..1, from highways, skyways and ports (§3.9). */
  noise: Float32Array;
  /** 0..1, Academy coverage (X1; all zeros when X1 is cut). */
  education: Float32Array;
  /** 0..1, congestion of the skyway network over each skyway tile, 0 elsewhere. */
  skyTraffic: Float32Array;
  /** 0..1, the wealth score of each zone tile (§4.2), 0 elsewhere. */
  wealth: Float32Array;
  /** 0..1, Airport business-district proximity (§3.9). */
  hub: Float32Array;
  /** 0..1, Seaport proximity (§3.9). */
  sea: Float32Array;
  /** 1 where a Back Alley lies within Chebyshev 1 (§4.4), else 0. */
  alleyNear: Uint8Array;
}

export interface CityStats {
  /* …existing… */
  /** Developed (level ≥ 1, not abandoned) zone tiles by tier, all zones: [$, $$, $$$]. */
  wealth: [number, number, number];
  /** What tiers change against an all-$ city: residents (negative = fewer) and tax CR per month. */
  tierEffect: { residents: number; tax: number };
  /** Mean noise over developed tiles. */
  avgNoise: number;
  /** Ground road tiles by kind (bridges included) and skyway tiles. */
  roads: { street: number; avenue: number; highway: number; alley: number; ramp: number; skyway: number };
  /** Regional link points (X2; 0 when cut). */
  edgeLinks: number;
  /** Visitors per month (X3; 0 when cut). */
  visitors: number;
}

export interface ActionPlan {
  /* …existing… */
  /** Road tools: the resulting RoadKind of each entry in `tiles` (ramps included), for the ghost. */
  roadKinds?: number[];
  /** Road tools: tiles that change kind (not new). */
  upgrades?: number;
  /** Road tools: on-ramp tiles this plan creates or converts. */
  ramps?: number;
  /** Skyway: the resulting sky bits (mask | ramp << 4) of each entry in `tiles`. */
  skyMasks?: number[];
  /** Highway drags: developed lots and needsRoad buildings that would lose road access (§3.4), and their tile indices for the ghost. */
  lostAccess?: number;
  lostTiles?: number[];
  /** Noisy buildings: developed Hab Block tiles inside the noise reach (§5.4). */
  loudTiles?: number[];
  /** Bulldoze: which layer this drag works on (§3.6). */
  layer?: 'ground' | 'sky';
  /** Bulldoze: credits returned for buildings placed under SAFETY.refundSec ago (Game fills it, §7.7). */
  refund?: number;
  /** The player must tap ✓ before this plan builds (costly building or lost access, §7.7). */
  confirm?: boolean;
  /** A non-blocking note for the action pill, ≤ 32 characters ("Cuts 2 cross streets"). `reason` stays for invalid or skipped tiles. */
  note?: string;
}

export interface Selection {
  x: number;
  y: number;
  /** The player tapped the skyway deck over this tile, not the ground (§3.7). */
  sky?: true;
}

/** Version 1, 2 and 3 all load. */
export interface SaveData {
  /* …existing… */
  /** v3: world.sky as [value, run] RLE pairs (story/encode.ts encodeRle), values 0..31. Missing → no skyways. */
  sky?: number[];
  /** v3: once-per-city moments already shown ('seaport', 'airport', 'spaceport', 'launch'). Missing → none. */
  moments?: string[];
}
```

`emptyStats()` (world.ts) initialises the new `CityStats` fields to zeros. `blankTile()` sets `roadKind: 0, wealth: 0`. `makeFields()` adds the seven arrays.

**World additions (not saved unless stated):** `sky` and `skyVersion` (§2.4); `wealthStreak: Int8Array(4096)`, written by GrowthSystem and read by `wealthInfo` for the ▲/▼ arrows; `loadedVersion: number` (the save version this world was decoded from; `SAVE_VERSION` for a new world), read once by `Game` (§4.3); `moments: Set<string>` (saved as `SaveData.moments`).

**Mutator invariants** (Step 0 enforces them in every mutator, and a contract test runs every mutator in random order and checks them after each call):

- `roadKind === 0` whenever `road` is false;
- `wealth === 0` whenever `zone === None` or `level === 0`;
- Alley and Ramp never sit on water (written as Street).

Signatures: `setRoad(x, y, kind = RoadKind.Street)` (existing callers and tests keep calling `setRoad(x, y)`), `setRoadKind(x, y, kind)` (no variant reroll, no age reset), `setLevel(x, y, level, abandoned = false, wealth?)`, `setWealth(x, y, tier)`, `restoreTile(i, snap: TileSnap)` (undo only, §7.7: writes `road`, `roadKind`, `zone`, `level`, `sky` back and touches the tile). `setZone`, `clearTile` and `addBuilding` reset `wealth` (and `clearTile` the road kind) as the invariants require.

### 2.2 `src/game/story/types.ts` and the director

The closed `Metric` union grows:

```ts
  /** Share 0..1 of developed zone tiles at $$$ / at $. */
  | 'wealth.high' | 'wealth.low'
  /** Ground road tiles of that kind. */
  | 'roads.highway' | 'roads.alley'
  /** Skyway tiles. */
  | 'skyway.tiles'
```

Step 0 also adds them to `PLAIN_METRICS` (content/vocab.ts), `STAT_METRICS` plus `metric()` cases (conditions.ts: `wealth.high = stats.wealth[2] / max(1, Σ stats.wealth)`, `wealth.low` likewise with `[0]`, the counts from `stats.roads`), and `PCT_METRICS` for the two shares. `count.academy|seaport|airport|spaceport` work automatically.

Other additive story types:

- `SpotRule` gains `'highway'` (the developed Hab Block within 3 of a Highway tile with the highest noise), `'alley'` (the Alley tile with the highest Undertow turf strength, else the lowest-index Alley tile) and `'shore'` (the developed Hab Block within 2 of water with the highest land value). WP-6 implements them in `story/effects.ts` (`spotAvailable`, `findSpot`).
- `Card.onDemand?: boolean`: the player may open this card from a button (§8.3 `ex.rights`).
- `InspectAction.id` gains `'rights'` (Spaceport: open the launch-rights card) and `'skyway'` (skyway sheet: demolish this segment).

Director (Step 0, additive, after the pacing merge): `openOnDemand(id: string): Result`. It opens a card with `onDemand` when nothing is open, Charter Night is not up, its `when` holds and it is not a spent `once`. If that card is already the pending COMMS card it calls `openPending()` instead. It never takes a deck slot: it leaves `deckSec`, `frontSec`, the chain counter, the beat gap and the pending slot as they were, and choosing it counts as a direct reply (no gap reset). It blocks like any open card. Game forwards it as `openLaunchRights(buildingId)`. If this cannot be done without changing pacing internals, the fallback is §8.3's: the Spaceport build reaction queues `ex.rights` at +0d.

### 2.3 Tile bit layout (save)

| Bits | Field | Notes |
|---|---|---|
| 0 | terrain | unchanged |
| 1 | road | unchanged ("a ground road exists", any kind) |
| 2-3 | zone | unchanged |
| 4-5 | level | unchanged |
| 6 | abandoned | unchanged |
| 7-14 | variant | unchanged |
| **15-17** | **roadKind** | 0..4. Written as 0 when `road` is false. |
| **18-19** | **wealth** | 0..2. Written as 0 unless zone ≠ None and level ≥ 1. |
| 20-30 | reserved | Write 0, ignore on read. |
| 31 | never used | `| 0` and `>>` would go negative. |

Decode (World.deserialize), applied to every version:

```ts
let kind = (p >> 15) & 7;
if (!road || kind > 4) kind = RoadKind.Street;
if (road && water && (kind === RoadKind.Alley || kind === RoadKind.Ramp)) kind = RoadKind.Street; // neither may sit on water
let wealth = (p >> 18) & 3;
if (wealth > 2) wealth = 2;
if (zone === ZoneType.None || level === 0) wealth = 0;
```

v1/v2 saves have zeros in bits 15+, so they load as all-Street, all-$. On that first load `Game` calls `sim.settleWealth()` once (§4.3), so an old city takes its tiers in one batch instead of a wave of single steps.

### 2.4 The skyway layer (`world.sky`)

Modelled on `world.rail`, not on `Tile.road` (a road tile excludes zones and buildings, so it can't pass over districts).

```ts
// World
/** Skyway bits per tile: 0-3 link mask (N1 E2 S4 W8), bit 4 = ramp (touches down on the ground road below). Uint8Array(4096). */
sky = new Uint8Array(N * N);
/** ++ on every sky mutation (not saved). SimGrid compares it to rebuild its sky caches. */
skyVersion = 0;
setSky(x: number, y: number, bits: number): void;  // bits & 31; touch(); skyVersion++
clearSky(x: number, y: number): void;              // unhooks neighbours like clearRail; touch(); skyVersion++
```

- A **dock** (a skyway tile over the footprint of a `skyAnchor` building) is derived every scan, never stored (§3.7).
- A **ramp is active** only while the ground under it is a Street, Avenue or Ramp road (`skyRampActive`, §3.7). The bit itself stays, so a live city and a reloaded one behave the same.
- `clearTile` also calls `clearSky`. `removeBuilding` does **not** clear sky (the skyway stays as a span over the empty site).
- Bulldoze works on one layer per drag (§3.6).

### 2.5 SaveData version 3 and save safety

- `SAVE_VERSION = 3`, `SAVE_VERSIONS_SUPPORTED = [1, 2, 3]`, `SAVE_KEY` unchanged.
- `serialize()` writes the new tile bits, `sky: encodeRle(world.sky)`, `moments`, and the buildings array as now (`facing`, and the Spaceport's `buildDays`, `waitSec` and `launches` ride along).
- The story block is decoded for `version >= 2` as today (v3 included).
- `sky`: `decodeRle(data.sky, w.sky, 31)`. Missing or malformed → all zeros, never a throw. Then sanitise in one pass:
  1. clear any link bit that points off the map or at a neighbour that doesn't link back;
  2. keep the ramp bit only if exactly one link remains (the ground is **not** checked: an inactive ramp stays a ramp, §2.4);
  3. a tile left with mask 0 is cleared to 0.
- Buildings: `facing` is kept only on a seaport and only if 0..3; otherwise a seaport gets `shoreFacing()` (§5.1) and, if no side qualifies, 2. Non-seaports drop `facing`. `buildDays` is kept for `stack` (as now) and `spaceport` (clamped to 0..`BUILDINGS.spaceport.buildDays`); `waitSec` (clamped to 0..`SPACEPORT.minBuildSec`) and `launches` (a non-negative integer, else 0) are kept for `spaceport` only; `stage` and `crown` stay stack-only.
- `moments`: kept entries that are one of the four known ids; anything else is dropped.
- Size: a full v3 city must stay under 64 KB of JSON. Tile numbers grow from ≤ 5 to ≤ 7 digits (+8 KB worst case); `sky` RLE is tiny. A test builds the expansion fixture (§10.4) and checks it.

**Save safety (Step 0, game.ts).** Today an "Incompatible save" makes the `Game` constructor start a fresh city, and the next autosave (monthly, or `pagehide` in main.ts) overwrites the player's city. A stale cached build (the PWA serves the old `index.html` offline, or a second tab) would do exactly that to a v3 save. So:

1. `readSave` checks `data.version`. If it is above `max(SAVE_VERSIONS_SUPPORTED)`, Game copies the raw stored string to `${SAVE_KEY}.future` (if that key is empty), sets `saveBlocked = true`, starts a fresh city in memory and toasts "This city was saved by a newer version. Reload to update." While `saveBlocked`, `save()` writes nothing and returns false (so main.ts autosaves are harmless). Only an explicit **New City** or **Previous city** (restoring the backup slot) clears the block; `loadPrevious` saves the restored city before it changes the backup slot, and leaves the slot alone if that save fails.
2. Any other load failure copies the raw string to `${SAVE_KEY}.unreadable` before the fresh city starts (autosave is not blocked).
3. The first time a v1 or v2 save loads in a v3 build, Game copies its raw string to `${SAVE_KEY}.v2` (once; never overwritten), so a downgrade can recover it.
4. Step 7 bumps `public/sw.js` `VERSION` with the release so old caches drop.
5. **Mirror (Step 7).** Rules 1-3 protect a newer save from a build that has them; a *pre-expansion* build (v2) has none, so opened on a v3 save it starts a fresh city and autosaves over it (checked in the browser). So every `save()` of a v3+ build also writes the same string to `${SAVE_KEY}.mirror` (`MIRROR_SAVE_KEY`), a key no v1 / v2 build knows. At startup, before rule 1, a stored main whose `version` is below 3 next to a mirror whose `version` is 3 or more means an older build saved over the city: Game copies the main to `${SAVE_KEY}.stale` (`STALE_SAVE_KEY`), writes the mirror back into `SAVE_KEY` and toasts once "An older version saved over your city. It is back as you left it." A plain v1 / v2 save (no mirror yet) loads exactly as before. Tested in `tests/save-v3.test.ts` and in the browser (§10.5).

Tests (`tests/save-v3.test.ts`, with a stubbed `localStorage`): a v4 save leaves the stored string untouched, `.future` holds it, and `game.save()` returns false until `newCity()`; a v2 load writes `.v2` once.

### 2.6 Saved vs derived

| Saved (v3) | Derived (rebuilt by `recomputeAll`, never saved) |
|---|---|
| `Tile.roadKind`, `Tile.wealth` | `fields.noise`, `education`, `skyTraffic`, `wealth` (score), `hub`, `sea`, `alleyNear` |
| `world.sky` | Road caches: per-kind counts, highway components, ramp reach, sky components and sky tile list, roadLv / roadCrime, edge points (SimGrid); docks (recomputed every scan) |
| `Building.facing` (seaport), `Building.buildDays`, `waitSec`, `launches` (spaceport) | `world.wealthStreak` (reset on load, harmless) |
| `world.moments` | `CityStats` additions, visitors, trade, income lines |
| Story flag `launchRights` (inside the existing story block) | Game-side: undo snapshot, placement times for refunds, launch timers (§5.3, §7.7) |

**Invariant:** `recomputeAll()` runs after every player action and never changes the **structural** tile fields: `terrain`, `road`, `roadKind`, `zone`, `level`, `wealth`, `abandoned`, `variant`, `buildingId`, `age`. (`powered` is written by the power pass and may move with brownout allocation; it is not part of the invariant.) Tiers change only inside `step()` (§4.3) and in the one-time `settleWealth()`. A test pins this (§10.2).

### 2.7 New shared modules and frozen APIs

Pure game-side modules (no story imports):

| Module | Exports (final signatures; Step 0 writes them in full unless marked stub) |
|---|---|
| `src/game/roads.ts` | `ROAD_TOOL_KIND: Record<RoadTool, RoadKind>`, `type RoadTool = 'road' \| 'avenue' \| 'highway' \| 'alley'`, `isRoadTool(t)`, `roadDef(k)`, `roadLinks(a, b)`, `frontable(k)`, `accessRange(k)`, `roadPrice(k, water): number \| null`, `roadUpkeep(k, water)`, `dragResult(toolKind, current): RoadKind \| null`, `KIND_NONE = 255`, `fillKinds(world, out: Uint8Array)`, `computeAccess(kinds, dist, near, queue)`, `lostAccess(world, converted: number[], out: number[]): number` (§3.4) |
| `src/game/wealth.ts` | `TIER_LABEL = ['$', '$$', '$$$']`, `zoneCapacity(zone, level, tier, affordable = false)`, `zoneTaxMul(zone, tier)`, `zonePowerMul(zone, tier)`, `zonePollution(zone, level, tier)`, `wealthScoreAt(world, i)` (reads only `world.fields` and the tile), `wealthTerms(world, i, out)`, `tierCap(zone, crime, noise, pollution, alleyNear)`, `potentialTier(zone, score, cap)`, `stepTarget(zone, tier, score, cap): -1 \| 0 \| 1`, `wealthInfo(world, x, y): WealthInfo` (§4.5) |
| `src/game/ports.ts` | `shoreFacing(world, x, y, size): 0\|1\|2\|3\|-1`, `shoreSites(world, out: Uint8Array): number` (marks every valid top-left; §5.1), `berthTiles(b): number[]`, `isBerthTile(world, x, y)`, `noiseDef(type)`, `noiseReach(world, type, x, y, out: number[]): number` (developed Hab Block tiles inside the reach, §5.4) |
| `src/game/skyway.ts` | `isSkyAnchorAt(world, x, y)` (the tile's building has `skyAnchor`), `skyRampGround(t)` (a Street, Avenue or Ramp road tile), `skyRampActive(world, i)` (ramp bit and `skyRampGround`), `skyLinksBack(sky, i, dir)`, `skywayDocks(world, b): { docked: boolean; ramps: number }` (a pure BFS over `world.sky` from the footprint tiles, counting active ramps on that network) in full; `planSkyway(world, path, plan): number` **stub** (returns 0, reason "Not yet"), WP-2 fills it |

Frozen stubs Step 0 writes so the Wave 1 packages can run in parallel:

- **`src/game/sim/ports.ts`**: `export interface PortView { visitors: number; exportJobs: number; comJobs: number; indJobs: number; tradeFor(id: number): number; buildProgress(id: number): number /* 0..1, combines days and waitSec */ }` and `class PortSystem implements PortView` returning zeros; `Simulation.ports: PortView` (getter, sim.ts). WP-1 fills it.
- **`Simulation.settleWealth(): number`** (sim.ts): stub returning 0; WP-1 fills it (§4.3).
- **`world.wealthStreak`** (above).
- **`skywayDocks`** (above): `actions.stackConnected` (WP-2) calls it.
- **`Game.clockRate`** (game.ts): `0` while paused, else 1 / 1.6 / 2.4. Effects (WP-4) scales ambient port FX by it.
- **Events** (§2.9) and **`TileInfo`** additions (§7.4) are typed in Step 0.

`World.roadMask(x, y)` and `World.hasRoadAccess(x, y)` switch to `roadLinks` / `accessRange` in Step 0. The callers that become kind-aware through `roadMask` are the ground and bridge art and car routing (`chooseExit`). Not covered by that switch, and fixed explicitly: the Power overlay's `conduits()` (overlay.ts) uses a new raw `World.roadAdjMask(x, y)` (any adjacent road, because power conducts between any two adjacent roads), and `roadGhost` (overlay.ts) applies `roadLinks` to `plan.roadKinds` and the existing kinds itself (WP-3). The coach only checks `t.road` and needs no change.

### 2.8 `src/game/config.ts` additions (numbers are tuning knobs; names and shapes are contract)

```ts
// ── Expansion (docs/EXPANSION.md) ─────────────────────────────────────────────

export interface RoadKindDef {
  kind: RoadKind;
  /** Tool that lays it; null for ramps (made by the drag rule). */
  tool: 'road' | 'avenue' | 'highway' | 'alley' | null;
  name: string;
  /** CR per tile on land / on water (null = can't be on water). */
  cost: number;
  bridgeCost: number | null;
  /** CR per tile per month on land / on water. */
  upkeep: number;
  bridgeUpkeep: number;
  /** Trips at which the road reads ~63% congested (replaces the single TRAFFIC_SCALE per tile). */
  capacity: number;
  /** Car speed multiplier (art only). */
  speed: number;
  /** Lots within this Chebyshev range can develop from it; 0 = no frontage. */
  access: number;
  /** Drag-upgrade order (bigger rank replaces smaller); −1 = never by drag. */
  rank: number;
  /** Multiplier on ROAD_POLLUTION. */
  pollution: number;
  unlockPop: number;
  color: string;
  /** Tray card meta line on phones (≤ 22 chars). */
  meta: string;
  desc: string;
}

export const ROAD_KINDS: readonly RoadKindDef[] = [
  { kind: 0, tool: 'road',    name: 'Street',     cost: 15, bridgeCost: 90,   upkeep: 0.6, bridgeUpkeep: 3,  capacity: 220,  speed: 1,    access: 3, rank: 1,  pollution: 1,   unlockPop: 0,    color: '#c8d0f0', meta: 'Lots ≤ 3 tiles',        desc: 'Streets carry traffic and power. Lots within 3 tiles can grow.' },
  { kind: 1, tool: 'avenue',  name: 'Avenue',     cost: 40, bridgeCost: 200,  upkeep: 1.4, bridgeUpkeep: 6,  capacity: 480,  speed: 1.25, access: 3, rank: 2,  pollution: 1,   unlockPop: 1500, color: '#6f9bff', meta: '2× traffic · widens',   desc: "Wide and lit: twice a street's traffic. Drag over a street to widen it." },
  { kind: 2, tool: 'highway', name: 'Highway',    cost: 90, bridgeCost: 360,  upkeep: 3.5, bridgeUpkeep: 12, capacity: 1100, speed: 1.8,  access: 0, rank: 3,  pollution: 1.4, unlockPop: 5000, color: '#ffb547', meta: '5× traffic · no lots',  desc: 'Five streets of traffic, but no lot can use it. Cross it with a street for on-ramps.' },
  { kind: 3, tool: 'alley',   name: 'Back Alley', cost: 6,  bridgeCost: null, upkeep: 0.2, bridgeUpkeep: 0,  capacity: 90,   speed: 0.55, access: 1, rank: 0,  pollution: 0.6, unlockPop: 1200, color: '#a07cff', meta: 'Cheap homes · crime',   desc: 'Narrow and cheap. Homes beside it stay affordable and hold more people. Crews like the dark.' },
  { kind: 4, tool: null,      name: 'On-ramp',    cost: 60, bridgeCost: null, upkeep: 1.5, bridgeUpkeep: 0,  capacity: 480,  speed: 1,    access: 3, rank: -1, pollution: 1,   unlockPop: 5000, color: '#f4f7ff', meta: '',                      desc: 'Joins the street grid to a highway.' },
];
// ROAD_COST, BRIDGE_COST, ROAD_UPKEEP, BRIDGE_UPKEEP stay exported (= the Street row) for old callers.
// sim/tuning.ts: TRAFFIC_SCALE = ROAD_KINDS[RoadKind.Street].capacity (one source; WP-1).

/** Highway load: trips from frontable roads within `reach` (road steps) of an on-ramp move onto that highway. */
export const ROAD_FLOW = { highwayReach: 6, highwayDivert: 0.55 } as const;

/** Static road neighbourhood effects within `radius` (Chebyshev) of the road tile. */
export const ROAD_EFFECTS = { radius: 1, avenueLv: 0.03, avenueCrime: -0.03, alleyLv: -0.04, alleyCrime: 0.06 } as const;

export const SKYWAY = {
  perTile: 160, rampCost: 120, upkeep: 3, maxDrag: 24, bulldozeCost: 5, unlockPop: 12000,
  /** Deck height in world px (rail is 28). Pick slab z 46..56 (§3.7). */
  z: 52,
  capacity: 700, reach: 5, divert: 0.4,
  /** Share of a docked building's trips that use the skyway. */
  anchorShare: 0.5,
  lvUnder: -0.03, lvRamp: 0.04, lvRampRadius: 2,
  noise: 0.12, noiseRadius: 1,
  color: '#ff5fd2',
  meta: 'Cars · ramps',
  desc: 'A raised road for cars. Land it on a street, or dock it into a megastructure.',
} as const;

export const NOISE = { lv: 0.18, approval: 10, highway: 0.45, highwayRadius: 2 } as const;

export const WEALTH = {
  /** Score needed to step $→$$ and $$→$$$ (measured start points, §4.2; Step 7 tunes). */
  up: [0.32, 0.46],
  /** Score below which $$→$ and $$$→$$. */
  down: [0.27, 0.40],
  /** Consecutive sampled evaluations (~6 d apart) before a step (≈ 30 d, §1.3). */
  streak: 5,
  /** Index [ZoneType][tier]; row 0 unused. */
  capacity:  [[1, 1, 1], [1, 0.95, 0.9], [1, 1, 0.95], [1, 0.95, 0.9]],
  tax:       [[1, 1, 1], [1, 1.25, 1.6], [1, 1.25, 1.6], [1, 1.3, 1.8]],
  power:     [[1, 1, 1], [1, 1.1, 1.3],  [1, 1.1, 1.3],  [1, 1, 0.9]],
  pollution: [[1, 1, 1], [1, 1, 1],      [1, 1, 1],      [1, 0.7, 0.35]],
  /** Residents × for a $ Hab Block with alleyNear ("affordable quarter"). */
  affordable: 1.1,
  /** Caps. res/com: ≤ $$ while crime ≥ highMaxCrime, noise ≥ highMaxNoise or pollution ≥ highMaxPollution; ≤ $ while crime ≥ midMaxCrime. res with alleyNear: ≤ $$. ind: ≤ $$ while crime ≥ indHighMaxCrime. */
  caps: { midMaxCrime: 0.5, highMaxCrime: 0.35, highMaxNoise: 0.5, highMaxPollution: 0.3, indHighMaxCrime: 0.45, alleyMaxTier: 1 },
  score: {
    res: { edu: 0.10, transit: 0.06, noise: -0.20 },
    com: { edu: 0.08, transit: 0.08, hub: 0.12, noise: -0.10 },
    ind: { base: 0.22, edu: 0.35, net: 0.20, transit: 0.12, port: 0.10, crime: -0.30 },   // base 0.20 → 0.22 in Step 7 (§10.5)
  },
  /** Approval + prosperity × share of res developed at $$ or $$$ (no squeeze term; Appendix C). */
  approval: { prosperity: 6 },
  colors: ['#8a93b8', '#22e5ff', '#ffd84d'],
} as const;

/** Costly or destructive actions (§7.7). */
export const SAFETY = { confirmCost: 10000, undoSec: 10, refundSec: 30, noteMax: 32 } as const;

/** X2 regional links. */
export const EDGE_LINKS = { street: 1, avenue: 2, highway: 3, cap: 12, ind: 25, com: 12, stubs: 4 } as const;

/** X3 tourism. */
export const TOURISM = {
  airport: 1200, spaceport: 3000, perHighCom: 3, perEdgePoint: 40,
  landmark: { spire: 150, arcology: 100, memorial: 200 } as Partial<Record<BuildingType, number>>,
  spend: 0.35, comPerVisitor: 0.06, crimeHit: 0.8, approvalRef: 60, moodMin: 0.5, moodMax: 1.3,
} as const;

export const SEAPORT = { exportJobs: 260, maxCounted: 2, tradeRate: 0.12, tradeCap: 2000, berthDepth: 2, indScoreRadius: 12, shipCycleSec: 80, snapRadius: 2 } as const;
export const AIRPORT = { comJobs: 320, hubNear: 6, hubFar: 16, hubFade: 20, planeCycleSec: 36 } as const;   // comJobs 240 → 320 in Step 7 (§10.5)
export const SPACEPORT = {
  indJobs: 200, comJobs: 300, income: 1200,
  /** Construction needs both buildDays and this many unpaused real seconds (§5.3). */
  minBuildSec: 240,
  /** Launches: at night (daylight below nightBelow) and at least launchGapSec unpaused seconds apart. */
  launchGapSec: 180, nightBelow: 0.3,
  /** The first launch is announced this many seconds ahead, with a Watch button. */
  firstLeadSec: 10,
} as const;
```

`BuildingDef` gains optional fields (existing entries are untouched unless listed):

```ts
  category: /* …existing… */ | 'transport';
  /** Fab share of `jobs`; the rest are Market jobs. Default: all Fab for 'power', none otherwise. */
  jobsInd?: number;
  /** At most this many on the map ("One Airport per city"). */
  maxCount?: number;
  /** 'shore': one full side must face open water (§5.1). */
  site?: 'shore';
  /** Noise at the footprint, falling to 0 at `r` tiles from its edge (§3.9). */
  noise?: { v: number; r: number };
  /** Days under construction after placement; no effects until done (Spaceport). */
  buildDays?: number;
  /** Needs a frontable road within ROAD_ACCESS_RANGE of a footprint tile (replaces the `tool === 'stack'` special case). */
  needsRoad?: boolean;
  /** A skyway may pass over and dock into it (§3.7). */
  skyAnchor?: boolean;
  /** Budget line plural ("Academies"); default name + 's'. */
  plural?: string;
  /** Tray card meta line on phones (≤ 22 chars), replacing the generic size · jobs line. */
  meta?: string;
```

`stack` gets `needsRoad: true, skyAnchor: true`; `spire` and `arcology` get `skyAnchor: true`. New entries (inserted into `BUILDING_ORDER` **before `'stack'`**, after `'arcology'`, in this order: `academy`, `seaport`, `airport`, `spaceport`; the contract test keeps `slice(-7)` as the story types). Unlocks sit on the existing population milestones (`MILESTONES`: 1,500 Boomtown, 5,000 Neon Metro, 12,000 Megacity, 30,000 Thousand Lamps), so the milestone banner is their announcement:

| id | name | category | size | cost | upkeep | power use | effect, radius | jobs (Fab) | pollution | noise | unlockPop | meta | other |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `academy` (X1) | Academy | services | 2 | 3,200 | 140 | 8 | education r12 | 30 (0) | 0 | none | 1,500 | `2×2 · schools` | `plural: 'Academies'`, color `#ffd0a0` |
| `seaport` | Seaport | transport | 4 | 18,000 | 280 | 30 | none | 240 (240) | 0.3 | v 0.5 r6 | 5,000 | `4×4 · shore only` | `site: 'shore'`, `maxCount: 2`, `needsRoad`, color `#38c8ff` |
| `airport` | Airport | transport | 6 | 45,000 | 650 | 80 | none | 320 (0) | 0.15 | v 0.9 r10 | 12,000 | `6×6 · loud` | `maxCount: 1`, `needsRoad`, `skyAnchor`, color `#e9f0ff` |
| `spaceport` | Spaceport | transport | 6 | 150,000 | 1,800 | 300 | prestige r20 | 550 (250) | 0.2 | v 0.5 r8 (Step 7; was v 0.7 r12) | 30,000 | `6×6 · slow build` | `maxCount: 1`, `needsRoad`, `buildDays: 240`, color `#ff8f6b` |

Unlock order across the expansion: Back Alley 1,200 (when the Undertow arrives, `TURF.seedPop.undertow`), Avenue and Academy 1,500, Highway (with On-ramps) and Seaport 5,000, Airport and Skyway 12,000, Spaceport 30,000. Before 3,000 residents the expansion adds three unlocks, not five.

Descriptions (≤ 90 chars, shown on wide-screen tray cards and the inspect subtitle):

- Academy: "Night classes and drone labs. Lifts nearby blocks toward $$ and $$$."
- Seaport: "Cranes, containers and night ships. Fab trade, some noise, and a back door."
- Airport: "Runway and terminal. Business and visitors pour in. So does the noise."
- Spaceport: "A launch tower that takes minutes to raise. Then night launches and huge prestige."

Story-facing config rows (Step 0 adds them; story content and `story/factions.ts` read them):

```ts
// FACTION_BUILD_REACTIONS additions
academy:   { board: 2, tuning: 2 },
seaport:   { basalt: 4, undertow: 3 },
airport:   { nacre: 5, board: 2, kites: -3 },
spaceport: { nacre: 4, basalt: 4, board: 3, kites: 2, tuning: -2 },
// BUILD_REACTION_LIMIT_BY_TYPE additions
seaport: 2, airport: 1, spaceport: 1,
// POWER_WEIGHTS additions (alley and skyway terms are capped: weight = min(count × per, max))
board:    { …, launchRights: 150 },
basalt:   { …, perSeaport: 60, launchRights: 150 },
nacre:    { …, perAirport: 80, launchRights: 150 },
undertow: { …, perAlley: 0.25, alleyMax: 60 },
kites:    { …, perSkywayTile: 0.5, skywayMax: 100, launchRights: 150 },
// TURF.affinity additions (§8.4)
undertow: { …, alleyNear: 0.2, alleyRadius: 1, seaportNear: 0.2, seaportRadius: 6 },
kites:    { …, alleyNear: 0.1, alleyRadius: 1, skywayNear: 0.15, skywayRadius: 1 },
```

No new `Unlockable`. Every new tool and building is gated by population only (`ROAD_KINDS[k].unlockPop`, `SKYWAY.unlockPop`, `BuildingDef.unlockPop`), so `content/lines.ts` (UNLOCK_SOURCES, UNLOCK_NEWS) is untouched.

### 2.9 Events (`src/game/events.ts`)

```ts
liftoff: { id: number; first: boolean };   // game: a visible launch starts now (render, audio, news)
hint:    { id: 'wealth' | 'ramps' | 'noise' };  // sim → UI first-use tips (§7.6)
moment:  { id: 'seaport' | 'airport' | 'spaceport' | 'launch'; title: string; sub: string };  // once-per-city banner (§5.4)
// toast gains an optional action button:
toast:   { text: string; kind: 'info' | 'error' | 'good'; action?: { id: 'undo' | 'watch'; label: string; sec: number } };
```

There is no sim-side launch event: launches are scheduled in real time by `Game` (§5.3). No new `sfx` kinds (audio keys a `Record` on them; STORY-CONTRACT rule).

---
## 3. Roads

### 3.1 The five ground kinds

| | Street | Avenue | Highway | Back Alley | On-ramp |
|---|---|---|---|---|---|
| Tool | `road` (tray "Street") | `avenue` | `highway` | `alley` | made by dragging a street or avenue across a highway (§3.4) |
| Cost / tile (land / water) | 15 / 90 | 40 / 200 | 90 / 360 | 6 / not on water | 60 / not on water |
| Upkeep / tile / month (land / water) | 0.6 / 3 | 1.4 / 6 | 3.5 / 12 | 0.2 / – | 1.5 / – |
| Capacity (trips at ~63%) | 220 | 480 (2.2×) | 1,100 (5×) | 90 (0.4×) | 480 (a ramp never shrinks an avenue) |
| Lots it serves (access) | within 3 | within 3 | **none** | within **1**, only lots no street or avenue reaches (§3.3) | within 3 |
| Neighbourhood (within 1) | – | land value +0.03, crime −0.03 | noise 0.45 at the tile, r2 | land value −0.04, crime +0.06, gang affinity +, **affordable quarter**: $ Hab Blocks hold ×1.1 residents and stay at most $$ (§4.4) | – |
| Pollution multiplier | 1 | 1 | 1.4 | 0.6 | 1 |
| Car speed (art) | 1 | 1.25 | 1.8 | 0.55 (bikes and walkers only) | 1 |
| Unlock | start | 1,500 residents | 5,000 | 1,200 (the Undertow arrives) | with highways |
| Links to | all but highway | all but highway | highway, ramp | all but highway | everything |

All five conduct power (the existing rule "roads, zones and buildings conduct" is unchanged; `ui/grid.ts` needs no change). Skyways do not conduct.

### 3.2 Links (`roadLinks`)

Two 4-adjacent ground road tiles connect **unless exactly one of them is a Highway and the other is not a Ramp**:

```ts
export function roadLinks(a: RoadKind, b: RoadKind): boolean {
  const ha = a === RoadKind.Highway, hb = b === RoadKind.Highway;
  if (ha === hb) return true;                       // both highway, or neither
  return (ha ? b : a) === RoadKind.Ramp;            // highway ↔ ramp only
}
```

`World.roadMask(x, y)` sets a direction bit only when the neighbour is a road **and** `roadLinks(kindHere, kindThere)`. That one change makes the ground art, bridge art, car routing (`chooseExit`) and the sim's smoothing agree. A street laid beside a highway therefore stays visually and logically separate: a kerb and a barrier, no junction. (Power conduction ignores kinds; the Power overlay uses `roadAdjMask`, §2.7.)

**Interchange** = a highway tile with at least one Ramp 4-neighbour. That is the only place traffic can move between the highway network and the rest of the grid.

### 3.3 Access (one rule, three callers)

`computeAccess(kinds, dist, near, queue)` in `roads.ts` is the only implementation. `SimGrid` calls it with its arrays; `RoadAccessMap` (render/overlay.ts) calls it with its own; `World.hasRoadAccess(x, y)` is a local scan with the same semantics. Step 0 adds a property test that the three agree on 20 random maps.

```
kinds[i] = road kind of tile i, or KIND_NONE (255)
dist.fill(255); near.fill(-1)
Pass A (range 3): seed, in this order, every Avenue tile, then every Ramp tile, then every Street tile (each group in
  ascending index) with dist 0, near = itself. Multi-source 8-neighbour BFS over all tiles, first claim wins,
  stop expanding at depth ROAD_ACCESS_RANGE (3). Highway tiles are never seeds.
Pass B (range 1, alleys fill gaps only): for each Alley tile a (ascending index):
  if dist[a] === 255 → dist[a] = 0, near[a] = a;
  for each 8-neighbour j of a: if dist[j] === 255 → dist[j] = 1, near[j] = a.
Access: a tile has road access iff dist[i] !== 255.
```

- The seed order makes a lot that is equally close to an avenue and a street send its trips to the avenue (a free "prefer the big road" rule, no routing). With streets only, `near` is exactly today's.
- **Alleys never steal trips** from a lot a street, avenue or ramp already reaches. The common "street in front, alley behind" layout keeps its trips on the street; the alley adds only the affordable-quarter effect (§4.4). A lot reached only by an alley sends its trips to that alley (capacity 90), which is why alley-only blocks congest quickly.
- A lot beside **only** a highway has no access and shows the existing amber "no road" badge. Inspect explains it with a note: "Highway only: lots need a street or avenue" (§7.4).
- `World.hasRoadAccess(x, y)`: true iff a Street, Avenue or Ramp lies within Chebyshev 3, or an Alley within 1 (unchanged by Pass B's ordering, which only affects `near`).
- Buildings with `needsRoad` (Stratablock, ports) use the same rule: a highway alone never counts.
- WP-1 test: a lot 2 tiles from a street and 1 from an alley sends its trips to the street.
- The advisor's "roads" line (advisor.ts) is reworded: "Advisor: {n} zoned lots have no usable road. Streets reach 3 tiles, alleys 1, highways none."

### 3.4 Planning a road drag (`planAction`, tools `road | avenue | highway | alley`)

The path is `roadPath(from, to)` as today (L-shaped, no length cap). `toolKind = ROAD_TOOL_KIND[tool]`.

1. **Locked:** `lockedReason(world, tool)` → `"Locked: reach N residents"` while `maxPopulation < ROAD_KINDS[toolKind].unlockPop`; every endpoint tile is marked bad, like rail.
2. **Ramp positions** (Street and Avenue tools only): for each path index k whose tile is **not** a Highway, if `path[k−1]` or `path[k+1]` is a Highway tile, then k is a ramp position. In words: *the tile where the drag steps onto a highway, and the tile where it steps off, become on-ramps.* Alley and Highway drags never make ramps.
3. **Per tile:**

```
t = tile at path[k]; water = t.terrain === Water
if t.road && t.roadKind === Highway && tool !== 'highway':
    ok, no change (the drag passes "through" the highway; this is what makes crossings work)
target = rampPosition(k) ? Ramp : toolKind
if t.road:
    result = dragResult(target, t.roadKind)          // roads.ts, table below
    if result === null → ok, no change
    else if water && roadPrice(result, true) === null → bad ("Ramps need land")   // e.g. a street bridge at a ramp position
    else → ok, change; cost += roadPrice(result, water) − roadPrice(t.roadKind, water)   (never below 0)
else:
    ok = t.buildingId < 0 && !(t.zone !== None && t.level > 0)    // as today
    if water && roadPrice(target, true) === null → bad ("Alleys can't cross water" / "Ramps need land")
    if water && isBerthTile(world, x, y) → bad ("Keep the berth clear")
    cost += roadPrice(target, water)
plan.roadKinds.push(resulting kind or current kind)
```

`dragResult(target, current)`:

| target \ current | Alley | Street | Avenue | Highway | Ramp |
|---|---|---|---|---|---|
| Alley | – | – | – | – | – |
| Street | **Street** (+9) | – | – | (pass-through) | – |
| Avenue | **Avenue** | **Avenue** (+25) | – | (pass-through) | – |
| Highway | **Highway** | **Highway** | **Highway** | – | **Highway** |
| Ramp | **Ramp** | **Ramp** (+45) | **Ramp** (+20) | (pass-through) | – |

"–" means no change (ok, free). **Smaller tools never shrink a road** (Ramp and Avenue share capacity 480, so Avenue → Ramp loses nothing); to downgrade, bulldoze and re-lay. Re-laying the same kind stays free and invalid ("Nothing to change"), so tests/actions.test.ts:19-22 still holds.

4. **Highway drags: what they cut.** For each path tile that changes to Highway:
   - `cuts` = off-path 4-neighbours that are a Street, Avenue or Alley (links the highway severs);
   - `lostAccess(world, converted, out)` (roads.ts): the developed zone tiles (level ≥ 1, not abandoned) and the footprint tiles of `needsRoad` buildings within Chebyshev 3 of a converted tile that have access now (`World.hasRoadAccess`) and would not with the converted tiles read as Highway (the same local rule, with a scratch mark array; no allocation, ≈ 20k checks for a 60-tile drag). It returns the count of lots plus buildings and fills `out` with their tile indices;
   - `rampsClosed` = sky ramps over converted tiles (a highway is not ramp ground, §3.7).

   Then `plan.lostAccess`, `plan.lostTiles` are set, and `plan.note` is the first that applies: "{n} blocks lose road access" (n = lostAccess), "Closes {n} skyway ramp(s)", "Cuts {n} cross streets". When `lostAccess > 0`, `plan.confirm = true`: lifting the finger does not build; the pill shows ✓ / ✕ (§7.7) and the ghost tints the lost lots red. The plan stays valid.
5. `plan.upgrades` = tiles that change kind; `plan.ramps` = ramp tiles created or converted; cost × `buildCostMul` as today; the funds check as today.

`applyAction`: for each ok tile that changes, `world.setRoad(x, y, kind)` for a new road, or `world.setRoadKind(x, y, kind)` for an existing one (no variant reroll, no age reset). It pushes `{ t: 'action', tool, x, y }` as now (the Ch1 boot still fires only for `'road'`; Alley and Avenue unlock after the first street exists anyway).

**Worked examples** (tests in WP-2 pin each):

- Street dragged straight across a highway `S S H S S` → `S R H R S`: two ramps, the highway tile untouched, the H tile's mask gains both ramp arms (a four-way interchange).
- Street dragged from a highway's end tile outward → the first tile becomes a Ramp.
- Avenue dragged along an existing street → upgrade, cost 25 per tile (bridge tiles 110).
- Highway dragged along an existing street with Hab Blocks on both sides → those tiles become highway; `lostAccess` counts every lot whose only road it was; `confirm` is true; the note reads "14 blocks lose road access".
- Highway dragged across an existing grid where every lot keeps another street → no lost access, note "Cuts 4 cross streets", builds on lift.
- Street dragged into a highway **bridge** at a water tile → the ramp position is water → that tile is bad ("Ramps need land"), the rest lays.

### 3.5 Bridges

A road on water is a bridge of its kind (Street, Avenue or Highway). Alleys and Ramps can't be on water. Price and upkeep come from the `bridgeCost` / `bridgeUpkeep` columns; upgrading a bridge costs the bridge difference. Bridge art follows the kind's width (§3.11). Building a bridge on a seaport's berth tiles is refused (§5.1). Skyways ignore the berth.

### 3.6 Bulldoze

- Ground road tiles: `BULLDOZE_COST` 5 each, any kind (unchanged). Removing a highway tile next to a ramp leaves the ramp as a working street-like tile (it simply has no highway arm).
- **One layer per drag.** The first tile of the drag picks the layer for the whole drag (`plan.layer`):
  - it carries a skyway (`world.sky[from] !== 0`) → **sky drag**: removes only skyway segments in the rect (`clearSky`, `SKYWAY.bulldozeCost` 5 each); ground, zones and buildings are untouched. Pill: "DEMOLISH SKYWAY ×6".
  - otherwise → **ground drag**: as today (roads, zones, buildings, rail by its current rule); skyway segments are left untouched, so a deck keeps spanning a cleared site. Pill: "DEMOLISH ×6".
  The faint ground shadow under every deck (§3.11) shows which tiles carry one, so the player can start a sky drag on it. The skyway inspect sheet also has "Demolish segment" (§7.4).
- A building whose footprint lies partly in the rect is removed whole by a ground drag, as today; a sky drag never removes buildings.
- **Refund:** a building placed less than `SAFETY.refundSec` (30 s wall clock) ago is refunded in full when bulldozed (§7.7).
- `plan` `has` for bulldoze counts only tiles with something on the chosen layer.

### 3.7 Skyways

The Skyway lives in the **Sky** tray, next to the Skybridge and the Ribbon Rail, so the three raised links are compared side by side (§7.2): Skyway "Cars · ramps", Skybridge "Tower to tower", Ribbon Rail "Stations".

**Placement** (`planSkyway`, tool `skyway`, from `roadPath(from, to)`):

- At most `SKYWAY.maxDrag` (24) tiles per drag (truncate with reason "Max 24 tiles per drag", like rail); at least 2 tiles ("Drag to lay a skyway").
- **Allowed ground:** land, water, any ground road, any zone tile at any level, rail tiles, and building tiles **only** where `isSkyAnchorAt` (a building with `skyAnchor`: Stratablock, Spire, Arcology, Airport). Any other building → bad, reason "Blocked by buildings".
- **Not** on a skybridge gap tile → bad, "Skybridge in the way". (WP-2 also makes `vertical.planSkybridge` reject a gap tile that carries a skyway: "Skyway in the way".)
- Masks join onto existing sky exactly as `planRail` joins track.
- **Ramps:** a path **endpoint** (first or last tile) gets the ramp bit when its ground is a Street, Avenue or Ramp road (`skyRampGround`) and its resulting mask has exactly one link. When a later drag extends through an existing ramp tile, its mask gains a second link and the ramp bit is cleared (the touch-down moves to the new end).
- **Active ramps:** a ramp carries traffic only while `skyRampActive` (its ground is still a Street, Avenue or Ramp). A highway or alley drag, or a ground bulldoze, under a ramp closes it; the ramp art shows a barrier and inspect says "Ramp closed: needs a street below". The bit stays, so the rule is the same live and after a reload (§2.5).
- **Docks (derived):** a skyway tile over the footprint of a `skyAnchor` building docks that building. Zone towers never dock (a level change or abandonment would silently cut a working skyway). The sim recomputes docks on every scan (§3.8).
- **Cost:** `perTile` 160 per new tile (land or water; it's elevated), + `rampCost` 120 per new ramp; × `buildCostMul`.
- **Note:** if the finished network would have neither an active ramp nor a dock: `plan.note = "Lands nowhere"`.
- **Unlock:** 12,000 residents (Megacity, with the Airport, its first new anchor).
- **Upkeep:** 3 per tile per month, budget line "Skyways".
- **Building over sky:** placing a building on a tile with sky is refused ("Skyway in the way") unless the type has `skyAnchor`. Zoning and roads under a skyway are fine.

**Sim** (no frontage, no power):

- The skyway network is its own graph: tiles linked by mutual mask bits. SimGrid keeps, keyed by `world.skyVersion` **and** `roadSig`: the component labels, the list of sky tile indices, and the ramp-reach BFS. Its cached `skyVersion` starts at −1 (so a deserialized world, whose `sky` was filled without bumping `skyVersion`, always builds them), and `scan(w, true)` forces them.
- **Docks every scan:** walk the cached sky tile list (O(sky tiles)) and mark each component's docked buildings with `isSkyAnchorAt`. A Stratablock placed under an existing deck, or an Airport bulldozed from under one, takes effect on the next scan.
- **Ramp diversion:** a BFS over frontable ground roads (4-neighbour, `roadLinks`) seeded from the ground tile under each **active** sky ramp, depth ≤ `SKYWAY.reach` (5). Each reached tile j diverts `raw[j] × 0.4 × (1 − depth/6)` into its component's sky pool (after the highway diversion, §3.8).
- **Docks:** a docked building sends `anchorShare` (50%) of its trips to the sky pool of the docking component instead of the ground.
- **Load:** `skyTraffic[i] = 1 − exp(−(pool[c] / tiles(c)) / SKYWAY.capacity)` on every tile of component c. A component with no active ramp and no dock carries nothing.
- **Land value:** `lvUnder` −0.03 on tiles under a skyway (shade), `lvRamp` +0.04 within 2 of an active sky ramp (fast access). **Noise:** 0.12 at the tile, r1.
- **Megastructures:** the Stratablock crown requirement (actions.ts `stackConnected`) also passes when `skywayDocks(world, b)` reports `docked` and `ramps ≥ 1`. The reason copy becomes "Needs a live skybridge, ribbon station or skyway".

**Picking (input).** The deck is drawn 52 world px above its tile, about 1.6 tile rows "behind" what the finger sees, so the ground projection is the wrong target. `PickFootprint` gains an optional `base` (bottom height, default 0) and the lookup reports, for a tile with sky, a slab from z 46 to z 56; `pickTile` treats it like a building silhouette that starts at `base`, keeps the front-most hit, and reports `sky: true` when the slab won. An Inspect tap on the visible deck therefore selects `{ x, y, sky: true }` and opens the skyway sheet (§7.4). Build and bulldoze drags keep ground projection; the ground shadow strip (§3.11) is their visible target.

**Draw rules** (consistent with the rail layer):

- The deck is drawn in the `drawObjects` sweep at its tile's key, at `SKYWAY.z` = 52 world px (rail is 28, skybridge tubes sit at their anchors' roofs − 10).
- Same tile: rail first, then the skyway; a zone tower taller than z − 4 on that tile draws after the deck (the deck threads behind it); a lower one draws before.
- **Multi-tile buildings (deferred segments).** `drawObjects` draws a multi-tile building once, at its front corner, so a deck on a tile along its +x or +y face (within its span) would be painted over even though it is in front, and a low anchor (Airport terminal, Stratablock Plinth) would paint over segments on its own footprint. Rule: while sweeping, a segment on a footprint tile or on a tile touching the +x / +y faces of a building whose `serviceBuildingHeight` is below `SKYWAY.z − 4` is queued on that building and drawn right after the building's front-corner draw (the same deferral `drawSkybridges` uses at the end of a diagonal). Segments over or beside a taller building draw before it, so the building occludes them, which reads as the deck docking into it.
- **Dock portal:** where a deck enters a docked building's footprint, a lit portal (a warm-white rectangle with a magenta frame) is drawn on that facade at deck height.
- **Pillars:** on tiles where `((x + y) & 1) === 0` and the mask is straight (5 or 10), and on every junction (≥ 3 links); only where the ground is land without a building and without a zone of level ≥ 2, or water, or a ground road; never on a rail tile; never on a ramp tile.
- **Ramps:** when the ramp's linked neighbour is a straight segment, the slope spans two tiles (z 52 → 30 on the neighbour, 30 → 6 on the ramp tile); otherwise one tile. A bright touchdown chevron is painted on the street at the ramp tile (ground cache). A closed ramp draws a red-and-white barrier across its foot.
- Segments are cached sprites (§10.1). Vehicles are paired headlights and tail lights (§3.11).

### 3.8 Traffic field (capacity-aware)

`FieldSystem.traffic` becomes:

```
raw.fill(0); skyPool.fill(0); hwPool.fill(0)
1. Zone trips: trips = zoneCapacity(z, l, tier, affordable[i]) × TRIPS_PER_UNIT[z] × (1 − TRANSIT_TRIP_CUT·transit[i]) × trafficMul × tripMul[i]
   raw[near[i]] += trips                                   (near from computeAccess; frontable roads, or an alley for alley-only lots)
2. Building trips (buildingStats.trips): access tile = centre for size ≤ 2 (as today); for size ≥ 3 the footprint
   perimeter tile with the smallest roadDist (ties: lowest index) — fixes trips silently dropped for big footprints.
   Docked anchors send anchorShare to the sky pool first.
3. Highway diversion (caches from SimGrid, rebuilt when the road signature changes):
   for every frontable tile j with hwComp[j] ≥ 0:
       take = raw[j] × ROAD_FLOW.highwayDivert × (1 − hwDepth[j] / (highwayReach + 1)); raw[j] −= take; hwPool[hwComp[j]] += take
   for every highway component c: raw[h] += hwPool[c] / tiles(c) for each highway tile h in c
   hwComp/hwDepth: multi-source BFS over frontable ground roads (4-neighbour, roadLinks), seeded from every Ramp tile
   that touches a highway (carrying that highway's component id; the lowest id if it touches two), depth ≤ highwayReach.
   Highway components: 4-neighbour labelling over Highway tiles only. A highway with no ramps gets 0.
   Ramp tiles are frontable: they take their own lots' trips, divert like any street at depth 0, and smooth with the highway.
4. Sky diversion (§3.7), from what is left in raw.
5. Utilisation: u[i] = raw[i] / ROAD_KINDS[kind[i]].capacity on every ground road tile.
6. Two smoothing passes over u along linked neighbours (roadLinks), as today: u' = 0.5·u + 0.5·mean(linked u).
7. traffic[i] = 1 − exp(−u[i]) on road tiles; volume[i] = 1 − exp(−u[i] × capacity / TRAFFIC_SCALE) (kept for pollution).
   skyTraffic per §3.7.
8. localTraffic[i] = traffic[near[i]] (0 if none); the non-road spill for the overlay as today.
```

- **Why avenues help:** an avenue tile turns the same raw trips into half the congestion, the seed order sends equidistant lots to it, and smoothing over `u` lets it absorb neighbouring streets' congestion.
- **Why highways help:** they take up to 55% of the trips of every street within 6 road steps of a ramp, at 5× capacity. Their nuisance reaches land value through the noise field (§3.9), not through `localTraffic` (highways are never anyone's nearest road).
- **Pollution:** road source = `volume[i] × ROAD_POLLUTION × ROAD_KINDS[k].pollution` (identical to today for streets, volume-based for big roads).
- **Crime:** `fields.crime` adds `g.roadCrime[i]` after the mods (alley +0.06, avenue −0.03, within 1).
- **Land value:** `fields.landValue` adds `g.roadLv[i]` (avenue +0.03, alley −0.04, skyway under −0.03, active sky ramp +0.04 r2) and `− NOISE.lv × noise[i]`.
- `TRAFFIC_SCALE` (tuning.ts) becomes `ROAD_KINDS[Street].capacity`: one source for the Street capacity and the pollution reference.
- `roadSig` in `SimGrid.scan` hashes `(index, kind)` pairs, so a kind change rebuilds the access BFS and the road caches (and `alleyNear`); `world.skyVersion` and `roadSig` together key the sky caches.
- With streets only, the new maths gives today's numbers (u = raw / 220, `near` unchanged); a WP-1 test pins it.

### 3.9 Noise, hub, sea and alley fields (not saved)

Computed every phase-0 tick with traffic and pollution (≤ 0.1 ms), into `world.fields`, so `wealthScoreAt` and `wealthInfo` can read them:

- **noise** — Highway tiles: `0.45 × (1 − d/3)` for Chebyshev d ≤ 2, max-combined. Skyway tiles: `0.12 × (1 − d/2)` for d ≤ 1. Buildings with `noise` (not offline; a Spaceport only once complete): `v × (1 − d/(r + 1))` where d is the Chebyshev distance to the nearest footprint tile (0 inside), for d ≤ r.
- **hub** (online, powered Airport; d = Chebyshev distance to its footprint): `0` for d < `hubNear` (6), `1` for 6 ≤ d ≤ `hubFar` (16), `(hubFade − d) / (hubFade − hubFar)` for 16 < d < 20, else 0. A plateau outside the noise ring, so the business district really forms there (§4.2 works the numbers).
- **sea** (online, powered Seaport): `max(0, 1 − d/12)`.
- **alleyNear** — 1 where an Alley lies within Chebyshev 1. Rebuilt only when `roadSig` changes (SimGrid), copied into the field.

Effects of noise: land value −0.18 × noise; the wealth score (§4.2) and the $$$ cap; approval −10 × avgNoise (developed tiles).

### 3.10 Map-edge connections (X2, optional, §6.2)

A ground road tile on the map border (x or y ∈ {0, 63}) on land is a **regional link** when its inward 4-neighbour (perpendicular to that edge; either one at a corner) is a road it links to. Roads running *along* the border don't count. Points: Street 1, Avenue 2, Highway 3, Alley and Ramp 0, summed and capped at 12 (`EDGE_LINKS`). Computed in `SimGrid.scan` with the road caches. Effects: industrial demand target +25 jobs per point, commercial +12 per point, visitors +40 per point (X3).

**Discoverability:** at world generation nothing changes in the save; instead the ground art pre-paints `EDGE_LINKS.stubs` (4) faint "regional road" stubs with chevrons at land points on the border, chosen by hash of the seed (deterministic, art only). Any border point counts, but the stubs show where to aim. The Highway tip says "Run it to the map edge for regional trade" (Appendix A), the report has a row "Regional links 3/12", and inspect on a border road shows a note "Regional link: +n trade". Cars spawn and leave there (§3.11).

### 3.11 Road and vehicle art

Ground cache (`render/ground.ts`), all within `SPILL` 24:

| Kind | Asphalt half-width | Look |
|---|---|---|
| Street | 0.30 (as now) | unchanged |
| Avenue | 0.40, sidewalk 0.1 | blue-tinted asphalt edge line (`#6f9bff` at low alpha), a 0.06 median with planter dots (green) and a lamp post every second tile (cool-white halo in the glow pass), two lane dashes each way, crosswalks at junctions |
| Highway | 0.46, no sidewalk | **by day** pale concrete deck with an amber edge line both sides; **by night** dark deck, sodium lamps every second tile (amber halos); concrete jersey barriers and a median barrier, two lanes each way (dashes), no crosswalks; a ramp arm draws a curved slip lane |
| Alley | 0.16 | grimy, no lane marks, wet sheen, a dumpster or steam vent by hash, a flickering violet sign halo every ~4th tile (animated pass) |
| On-ramp | 0.30 | street art plus **white** chevrons pointing at the highway arm and a small amber-and-white gantry sign (no green, so it never reads as the avenue median) |
| Bridges | the kind's width (deck = asphalt + 0.06) | as now; highway bridges darker and heavier, with two pillar columns |
| Under a skyway | — | a faint dark shadow strip 0.5 tile wide along the deck's links (ground cache, repainted on sky edits through the normal `tiles` event); it shows the shade effect and gives drags a target |

Readability check (WP-3 acceptance): a side-by-side capture of all five kinds plus a skyway, at zoom 0.5 and 1, by day and by night, where each can be told apart by colour and width alone.

Street vehicles (`render/art/traffic.ts`): the road list includes every ground kind with a `Uint8Array` of kinds; spawn weight per visible tile × (Highway 1.6, Avenue 1.3, Street 1, Ramp 1, Alley 0.3); speed × `ROAD_KINDS[k].speed`; lanes Street ±0.15, Avenue ±0.12/±0.27, Highway ±0.16/±0.36 (lane picked by agent hash, kept while on that kind); trucks 35% on highways; alleys carry only bikes and walkers. X2: 15% of spawns start on visible border road tiles heading inward; a car whose only exit points off the map fades out instead of U-turning. The `StreetTraffic` public API (`reset()`, `invalidate()`, `update(dt, world, quality)`, `draw(ctx, b, zoom, night, quality, rain)`) is frozen; WP-3 changes only its internals.

**Skyway look** (it must not read as the cyan Skybridge or the teal Ribbon Rail): a deck about half a tile wide (the rail is a thin ribbon), dark asphalt with **white lane dashes**, a magenta (`#ff5fd2`) edge strip, and traffic drawn as **paired white headlights and red tail lights** moving in two directions, never generic light dots. Per visible sky tile, `round(skyTraffic × 3)` car pairs; the lights are small rects drawn with the segment; at night their glows are collected during the sweep and drawn in **one** additive (`'lighter'`) pass after `drawObjects`, capped at 200 per frame, skipped below zoom 0.5 and on low quality.

---
## 4. Wealth: $ / $$ / $$$ (the city decides)

### 4.1 What a tier is

Every developed zone tile has a density level (1..3, unchanged) **and** a wealth tier ($, $$, $$$). They are independent axes: a $ L3 tile is a tenement tower, a $$$ L1 tile is a townhouse or boutique. Density still rises with demand, age and the existing land-value gates (`levelLandValue`), so in practice dense areas with good land value also trend $$$, but noise, crime and back alleys can keep a dense block at $ or $$.

The player never paints a tier. The tier follows a **wealth score** with hysteresis, so it changes at the pace of density growth (one step takes about a month of sim time, §1.3) and never flaps. The score itself updates the moment the player builds, so the inspect meter and the lens give immediate feedback (§4.5).

### 4.2 Wealth score (per tile, `fields.wealth`)

Computed in one 4096-tile loop right after land value and crime (phase 1 of `FIELD_STAGGER`, and after the second land-value pass in `recomputeAll`). Inputs are 0..1 fields in `world.fields`, so `wealthScoreAt(world, i)` is a pure function of the world. Non-zone tiles get 0.

```
Hab Blocks (res):    s = landValue + 0.10·education + 0.06·transit − 0.20·noise
Market Strip (com):  s = landValue + 0.08·education + 0.08·transit + 0.12·hub − 0.10·noise
Fab District (ind):  s = 0.22 + 0.35·education + 0.20·net + 0.12·transit + 0.10·sea − 0.30·crime
score = clamp01(s)
```

Industry ignores land value (its own smog keeps that low); its tier is about skills, data and trade: a $$$ Fab District is a clean fab. Without X1 (no Academy) `education` is 0 and industry still reaches $$ with net, transit and a seaport.

**The Airport business district, worked through.** Land value already carries −0.18·noise, so a Market tile pays 0.28·noise in all. With the Airport's noise `0.9 × (1 − d/11)` and the hub plateau (§3.9), the net change against the same tile with no airport is: d 6 ≈ 0, d 8 +0.05, d 10 +0.10, d 11-16 +0.12, d 18 +0.06. That is a visible ring of better shops 8 to 18 tiles out, against tier thresholds 0.14 apart. Inspect names it ("Airport district +12%"). Homes pay 0.38·noise, so they stay rough near the runway, and no res or com tile within 4 of the footprint can reach $$$ (noise ≥ 0.5 cap).

**Caps** (`tierCap`): res and com can't exceed $$ while crime ≥ 0.35, noise ≥ 0.5 or pollution ≥ 0.3, and can't exceed $ while crime ≥ 0.5. Hab Blocks with `alleyNear` can't exceed $$ (affordable quarter, §4.4). Industry can't reach $$$ while crime ≥ 0.45.

**Potential** (`potentialTier`, no hysteresis, for lots and the lens): 2 if score ≥ `up[1]` (0.46), 1 if ≥ `up[0]` (0.32), else 0; then `min(cap)`.

**Where the thresholds come from (measured on the current sim, before the expansion).** The starter city in the balance test peaks at land value 0.27, so it stays all $. With `ScriptedMayor` on flat land (seeds 2091, 7, 31), after 8 years 17-21% of Hab Blocks and 23-28% of Market tiles reach land value 0.34, 1-4% and 5-10% reach 0.46, and none reach 0.60. On generated terrain the water bonus is strong: after one year 16-45% of homes and shops are already at 0.34 or more, so **waterfront blocks on generated maps reach $$ within the first year**; flat-land cities stay all $ for their first years. The first draft's `up [0.40, 0.60]` could not meet B2 or B3; `up [0.32, 0.46]`, `down [0.27, 0.40]` are the start points, and Step 7 tunes them against §10.3.

### 4.3 Hysteresis, cadence and cost

Tier changes happen only inside `GrowthSystem.run`, on the tiles it already samples (1/6 of zoned tiles per tick), so the cost is a few comparisons per sampled tile and no extra loop:

```
// for a sampled developed tile that is not abandoned, before the decline checks:
t = tile.wealth; s = fields.wealth[i]; cap = tierCap(...)
dir = (t < 2 && s >= WEALTH.up[t] && cap > t) ? +1
    : (t > 0 && (s < WEALTH.down[t - 1] || cap < t)) ? −1 : 0
streak = world.wealthStreak
streak[i] = dir === 0 ? 0 : (sign(streak[i]) === dir ? streak[i] + dir : dir)
if |streak[i]| ≥ WEALTH.streak (5):
    extra = zoneDraw(z, l, 0, t + dir) − zoneDraw(z, l, 0, t)
    if dir > 0 or extra > 0: need power.canFeed(i) and power.tryReserve(i, extra), else wait (streak stays)
        (a $$$ Fab stepping down to $$ draws more: it waits for headroom too, so a falling block never browns out its grid)
    world.setWealth(x, y, t + dir); streak[i] = 0; mark reachedWealth[z * 3 + t + dir] when stepping up
```

- **Latch at development:** when a lot develops (0 → 1), it takes `potentialTier` immediately, reserving that tier's power draw (falling back to lower tiers if the grid can't feed it; a WP-1 test covers the fallback under brownout). `world.setLevel(x, y, 1, false, tier)`.
- **Collapse to a lot** (level → 0) resets the tier to 0. Abandonment keeps the tier (shells look like what they were); recovery keeps it.
- **Old saves settle once.** `Simulation.settleWealth()`: for every developed, non-abandoned zone tile in index order, raise the tier one step at a time toward `min(potentialTier, cap)` while `power.tryReserve` accepts the extra draw; no rng, no streaks. `Game` calls it exactly once, after the first `recomputeAll` of a world whose `loadedVersion < 3`, then calls `recomputeAll` again. A v2 city therefore takes its tiers in one batch (no wave of hundreds of single steps at speed 3, no burst of power reservations), and its population changes once, visibly, at load. It is outside `recomputeAll`, so the §2.6 invariant holds.
- `setWealth` emits **no** `'tiles'` event: tier art lives entirely in the zone sprite (§4.5; the lot ground is tier-independent), sprites pick their model from the tile every frame, and the Wealth overlay already refreshes on `'stats'`. Gentrification never dirties ground chunks or the access map. It doesn't reroll the variant or reset `age`: no construction animation.
- One step takes about 30 sim days (5 samples ~6 d apart) and a $ → $$$ climb about 60; a falling block filters down one step at a time. **No tier change ever abandons a building.**
- No `world.rng` draws (deterministic, no shift in other rolls: `rng.chance` in growth comes before `tryReserve`, and `canFeed` ignores reservations).
- `recomputeAll` computes the score but never moves a tier (§2.6 invariant).

### 4.4 Effects per tier

| | $ | $$ | $$$ |
|---|---|---|---|
| Hab Blocks: residents per tile × | 1 (×1.1 in an affordable quarter) | 0.95 | 0.9 |
| Hab Blocks: tax per resident × | 1 | 1.25 | 1.6 |
| Market Strip: jobs × / tax per job × | 1 / 1 | 1 / 1.25 | 0.95 / 1.6 |
| Fab District: jobs × / tax per job × | 1 / 1 | 0.95 / 1.3 | 0.9 / 1.8 |
| Fab District pollution × | 1 | 0.7 | 0.35 |
| Power draw × (res, com / ind) | 1 / 1 | 1.1 / 1 | 1.3 / 0.9 |

- One table drives every consumer through `wealth.ts` (`zoneCapacity`, `zoneTaxMul`, `zonePowerMul`, `zonePollution`). The four duplicate capacity tables (census.ts `CAPACITY`, fields.ts `ZONE_CAPACITY`, budget.ts `CAPACITY`, game.ts inspect) and `power.ts ZONE_DRAW` / fields.ts `ZONE_POLLUTION` all switch to it. Hot loops precompute flat `Float32Array` tables indexed `z * 12 + l * 3 + t`, plus the affordable factor from `fields.alleyNear`.
- **Tax:** `base[z] += zoneCapacity(z, l, t, affordable) × yieldMul × zoneTaxMul(z, t)`; `yieldMul` keeps its land-value term. Net per tile at the same land value: res $$ 1.19×, $$$ 1.44×; com $$ 1.25×, $$$ 1.52×; ind $$ 1.24×, $$$ 1.62×; plus the higher land value that comes with the tier.
- **Population cost is small on purpose.** Chapter goals count current population (STORY.md: 3,000 / 7,000 / 12,000 / 18,000) and the HUD shows it, so a player who follows this spec's advice (schools, parks, transit) must not watch population fall. At most −10% per $$$ home (−5% at $$), carried by +44% tax, and the report says so in one line: "Tiers: −120 residents · +340 CR/mo" (`stats.tierEffect`, against an all-$ city, affordable quarters included). B4 and a WP-1/Step 7 test hold the well-served city to M1's population (§10.3).
- **Affordable quarter (back alleys).** A $ Hab Block with an Alley within 1 (`fields.alleyNear`) holds ×1.1 residents (and pays tax on them) and is capped at $$. This is the player's "keep it affordable" lever: more people per tile, more crime (alleys add +0.06), lower land value, and the Undertow likes it (§8). The Back Alley tray card says "Cheap homes · crime"; inspect shows a note "Affordable quarter: +10% residents".
- **Demand:** not split by tier. Fewer residents per rich tile raise residential demand, so the city keeps building homes elsewhere; this is the gentrification loop, and it self-balances.
- **Approval** (`census.approval`): `+ 6 × share(res developed at $$ or $$$) − 10 × avgNoise`. No squeeze term (Appendix C): the social cost of a rich city lives in the story (the Board's "Priced out" mood and the `ex.pricedout` card), where it is explained. A flat-land city without highways or ports keeps today's approval while it is all $; waterfront $$ blocks on generated maps add a point or two.
- **Abandonment:** none from tiers.
- **Starter balance:** the starter city stays all $ (peak land value 0.27 < 0.32) with no alleys, so every multiplier is 1 and the "starter profit 0..400/mo" test is unchanged.

### 4.5 Wealth lens, inspect and art direction

**Lens** (`OverlayId 'wealth'`, a discrete swatch overlay like Power; `imageSmoothing` off):

- developed tiles: $ `#8a93b8` slate, $$ `#22e5ff` cyan, $$$ `#ffd84d` gold, alpha 200 (luminance rises with the tier, so it reads without colour);
- lots: their potential tier at alpha 90;
- abandoned: `#3a3550`; everything else transparent;
- **pips:** on developed tiles whose potential differs from their tier, a small ▲ (potential higher) or ▼ (lower) drawn at the tile centre in a world-space pass over visible tiles, at zoom ≥ 0.6. After the player builds an Academy or a Plaza, the pips appear at once (the score is recomputed after every action), long before any tier steps.
- Legend: three swatches "$ · $$ · $$$", plus one line "▲ ▼ = about to change. Schools, transit, parks and quiet lift blocks."

**Inspect** (zone tiles; `wealthInfo(world, x, y)`):

```ts
export interface WealthInfo {
  tier: WealthTier; potential: WealthTier; lot: boolean;
  score: number;                       // 0..1
  ticks: readonly [number, number];    // WEALTH.up, drawn as ticks on the meter
  dir: -1 | 0 | 1;                     // sign of world.wealthStreak[i]
  affordable: boolean;
  next: string | null;                 // note, ≤ 40 chars
  lifted: string | null;               // note, ≤ 24 chars
}
```

`wealthTerms(world, i, out)` breaks the score into signed parts from the same formula: land value (with the noise part of land value moved out), education, transit, hub, sea, net, noise (score weight + `NOISE.lv`, so for a home it is 0.38·noise), crime. `wealthInfo` uses them:

| Row (§7.4 layout) | Value |
|---|---|
| **Wealth** (standard row, meter with ticks at `up[0]` and `up[1]`) | `$$ ▲ 52%` rising, `$$ 52%` steady, `$$ ▼ 38%` slipping; a lot shows `opens $$` |
| **Next** (note row; only below $$$) | first that applies: a cap ("Crime holds it back: add a Precinct", "Too noisy for $$$: keep homes back", "Smog holds it back", "Beside an alley: rents stay low"); else "Rising: steps up soon" when the score already clears the next tick; else the largest negative part ≥ 3 points ("Noise −17%: keep homes back", "Crime −9%: add a Precinct"); else the largest missing positive ("An Academy nearby adds up to +10%" once unlocked, "Transit adds up to +6%", ind "Needs an Academy, Data Hub or transit"); else "Needs land value: parks and services" |
| **Lifted by** (note row) | the largest positive part other than land value, ≥ 2 points: "Academy +8%", "Airport district +12%", "Transit +5%"; hidden if none |
| Residents / Jobs | from `zoneCapacity(z, l, tier, affordable)` |
| Noise, Education | shown when > 2% |
| Affordable (note) | "Affordable quarter: +10% residents" |

**Art direction** (tier = palette and dressing; the 72 recipes are not rewritten; a city's existing colour mix is kept):

| | $ | $$ | $$$ |
|---|---|---|---|
| Hab Blocks | **Today's look** plus light grime props: a tarp or water tank on some roofs, AC boxes, a laundry line on some balconies; window light leans sodium-orange. | Today's look plus tidy props: window boxes, lit balcony rails, clean signage. | Curtain-glass towers, sky gardens on setbacks, a rooftop pool (cyan rectangle) and a landing-pad mark at L3, crisp cool-white windows with gold accents, a thin neon edge trim, an antenna beacon. |
| Market Strip | Today's arcades plus stalls under tangled cable, hand-painted signs, vending machines. | Today's arcades and malls, cleaner signage. | Glass flagship stores and offices, one large clean holo panel per building, gold accents, a glowing lobby, a rooftop helipad mark. |
| Fab District | Today's fab halls plus container yards, hazard stripes, red warning lights. | Today's fab halls. | "Clean fab": white and steel cleanroom blocks, solar roofs, cooling fins, teal-green neon, **no smoke**. |
| Lot plate (sprite base, not ground) | cracked tint | as now | clean pavers with planter dots |

A $ city is today's city with a little grit, not a downgrade, so the owner's existing city looks the same after the update (and its qualifying blocks move up at load, §4.3).

**As built (WP-4, recorded in Step 7).** The $$$ palettes use window warmth 0.12 and cool 0.5 (not 0.25 / 0.6): with the spec values $$$ windows read warm at night, and the lower values give the crisp cool-white windows this section asks for; `neon2` and `up` are as specified. $$ walls get a 14% cleaner tint, a lighter roof and neat membranes instead of tarps, beyond "today's look plus tidy props", so $ and $$ can be told apart at zoom 1; $ keeps today's materials exactly. A v2 city's mean colour is unchanged at load (day 0.294/0.310/0.358 → 0.293/0.324/0.371; night 0.156/0.145/0.228 → 0.165/0.170/0.246 on WP-4's test save, where only the 38 of 205 tiles that settle to $$$ turn to glass).

Implementation shape (WP-4): the zone model id becomes `((((zone − 1) × 3 + level − 1) × 8 + form) × 3 + tier) × 2 + palBit` (0..431), **keeping** today's random `palBit` (`(variant >> 3) & 1`) as the variety bit inside each tier. Decoding: zone = ⌊id/144⌋ + 1, level = ⌊id/48⌋ mod 3 + 1, tier = ⌊id/2⌋ mod 3. `LOT_BASE` 200 → 440 (lots 440..463), `SERVICE_BASE` 400 → 480; `zoneBuildingHeight`, the `paintSprite` level read and `zoneHeights` (`Float32Array(SERVICE_BASE)`) use the new formula. Skyway segment sprites get their own range from `SKY_BASE = 4000` (§10.1), so their cache keys can never collide with buildings. `ZONE_PALS[zone]` becomes `[tier][palBit]`: tiers 0 and 1 reuse today's two palettes (tier 0 with a warmer window bias), tier 2 adds two luxe palettes (gold: neon2 `[255, 216, 77]`, up `[255, 200, 120]`, warm 0.25, cool 0.6; platinum: neon2 `[220, 235, 255]`). `Painter.tier` is set in `buildModel` and `paintSprite`, and one shared `dressTier(p, zone, level)` call runs after every zone recipe to add the tier props, placed from the model's recorded footprint and top. **Props never raise the model's recorded top**, so heights, picking and the skybridge "tall" checks are tier-independent. Bodies go 144 → 432 (painted on demand; paint-rate check in §10.1).

---
## 5. Ports

All three are `transport` buildings: square footprints, `needsRoad`, taxed jobs (the budget's landmark rule extends to `transport`), one budget upkeep line per type ("Seaports", "Airports", "Spaceports"). Their trips use the perimeter access tile (§3.8), so big footprints never drop trips. All three cost more than `SAFETY.confirmCost`, so placing one always takes a ✓ (§7.7).

### 5.1 Seaport (4×4, 18,000 CR, upkeep 280, 30 MW, 240 Fab jobs, unlock 5,000 residents, max 2)

**Placement** (planAction, in addition to the building rules):

- all 16 tiles clear land (as today), a frontable road within 3 of a footprint tile ("Needs road access");
- **shore rule** (`shoreFacing`): test sides in the order S, E, N, W; a side qualifies when, for each of the 4 tiles along it, the tiles 1 and 2 beyond it are in-bounds water **with no road (bridge) and no rail**. The first that qualifies is `facing`. None → bad, "Needs a straight shore". The ghost highlights the 4×2 berth in blue (ok) or red;
- `maxCount` 2 → "Only 2 Seaports per city".

**Finding a shore.** When the Seaport tool is selected, `shoreSites(world, marks)` evaluates every top-left once (a few thousand cheap checks, < 1 ms; again after a `tiles` event while the tool is active). Every valid site gets a faint blue outline on the map, and the ghost **snaps** to the nearest valid top-left within `SEAPORT.snapRadius` (2) tiles of the finger, so the player slides toward a highlight instead of hunting. Measured on the current generator: 26-66 valid top-left positions on each of 30 sampled seeds (WP-2 test: every sampled seed has at least 2 non-overlapping sites). Flat maps have none: the tray card then shows "No straight shore here" instead of a price, and tapping it toasts the same.

**Berth:** the 4×2 water tiles beyond `facing`. Bridges can't be built there ("Keep the berth clear"). Skyways may pass over.

**Effects** (while online and powered):

- industrial demand target +260 jobs per seaport (at most 2 count);
- income line **"Port trade"** = min(2,000, 0.12 × jobsInd × jobFill) per seaport per month;
- Fab tiles within 12 get `sea` (up to +0.10 on the industrial wealth score);
- noise 0.5, r6; pollution 0.3 on the footprint;
- story: Undertow affinity +0.2 within 6 (§8.4), Basalt and Undertow build reactions, smuggling and convoy cards.

**Art:** the quay apron is ground art (concrete, yellow lanes, bollards on the water edge, a rail spur). The sprite (one model per `facing`, 4 variants) holds two gantry cranes on the water edge with booms over the water, rows of container stacks, a reefer shed and two light masts. FX: a container ship (hull about 2.5 × 0.7 tiles, container blocks, a stern bridge, lights at night) sails in along the facing normal, moors, sails out, on an 80 clock-second cycle (`SEAPORT.shipCycleSec`, scaled by `Game.clockRate`: 80 s at speed 1, 33 s at speed 3, frozen while paused). The approach starts at the last continuous open-water tile up to 12 tiles out, stopping at the first bridge or rail tile (bridges count as land), so a hull never crosses land or slides "under" a bridge deck. Crane trolleys move while a ship is moored. Night: red crane beacons blink, mast floodlight halos.

**Opening:** the first ship starts its approach the moment the port opens (no empty berth after spending 18,000), and the once-per-city banner shows "SEAPORT OPEN · +260 Fab jobs" (§5.4).

### 5.2 Airport (6×6, 45,000 CR, upkeep 650, 80 MW, 320 Market jobs, unlock 12,000 residents, max 1)

**Placement:** 36 clear land tiles, road access, `maxCount` 1 ("One Airport per city"). The runway always runs along +x (the screen's down-right diagonal); no rotation, no `facing`.

**Effects** (online and powered):

- commercial demand target +320 jobs (Step 7: 240 → 320, §10.5 B9);
- Market tiles 6 to 16 tiles out get `hub` (fading to 0 at 20): up to +0.12 on the commercial wealth score, a business district that forms outside the noise (§4.2 works the numbers);
- noise 0.9, r10: land value near it drops, homes there stay $;
- visitors +1,200 per month (X3);
- it is a skyway anchor (a skyway can dock at the terminal);
- story: Nacre and Board like it, Kites dislike it; the lounge and no-fly cards.

**Layout and art:** footprint rows by dy: 0 grass strip and taxiway, 1-2 runway (centreline dashes, threshold stripes at dx 0 and 5, edge lights), 3 taxiway (yellow line), 4-5 apron. Runway, taxiways and apron are ground art. The sprite holds only the raised parts: a curved glass terminal on dx 1..4, dy 4..5, jet bridges, two parked planes, and the control tower at dx 5, dy 5 (~110 px, with a rotating beacon fx).

**Plane cycle** (one plane, `AIRPORT.planeCycleSec` 36 clock-seconds, scaled by `Game.clockRate`: 36 s at speed 1, 15 s at speed 3, frozen while paused; phases below in clock-seconds): 0-9 approach from 14 tiles west of the runway at z 180 descending to touchdown at dx 0.5; 9-13 roll-out to dx 4.5; 13-14 turn off; 14-22 at the gate (hidden); 22-26 take-off roll; 26-36 climb to z 220 heading +x, fading at the map edge. Phases with z < 6 draw in `Effects.drawGround` (before buildings); airborne phases in `drawSky`. Art: a procedural white and steel jet about 26 × 5 px, nav lights (red, green), a red strobe each clock-second; at night a white landing-light glow (`glowSprite`, `'lighter'`). Runway edge lights blink in the animated ground pass.

**Opening:** the first cycle starts at phase 0 (a landing) when the airport opens, and the banner shows "AIRPORT OPEN · +320 jobs" (with X3: "AIRPORT OPEN · +1,200 visitors a month").

### 5.3 Spaceport (6×6, 150,000 CR, upkeep 1,800, 300 MW, 550 jobs (250 Fab), prestige r20, unlock 30,000 residents, max 1)

**Placement:** like the airport, with the ✓ step; the pill note reads "Loud over {n} homes" or, when no homes are in reach, "Takes 4+ minutes to build". Cost is charged at placement. The spaceport is the late-game place to spend money for spectacle, prestige and income (owner decision: money is the reward).

**Construction (240 days and at least 4 minutes of play):**

- `applyAction` sets `buildDays = 240`. `Game.apply` also sets `waitSec = SPACEPORT.minBuildSec` (240) on the new spaceport, so headless sim tests see a plain 240-day build and real play gets the floor.
- `PortSystem.tick` (sim/ports.ts) counts `buildDays` down each day but **holds it at 1 while `waitSec > 0`**. `Game.update` decrements `waitSec` by the frame's `dt` on every unpaused frame (any speed). At 240 d / 240 s, speed 1 finishes both together; speed 3 finishes the days in 15 s and then waits for the clock.
- `buildingStats` returns zero residents, jobs, trips, power use, upkeep, effect and pollution while `buildDays > 0`.
- `ports.buildProgress(id)` = `min((240 − buildDays) / 240, (240 − waitSec) / 240)`. When it crosses ⅓ and ⅔ (checked each sim day) PortSystem calls `world.markChanged` on the footprint so the art steps through its three construction stages.
- Inspect: row "Building" `62%` (meter) and a note "Takes 240 days and at least 4 minutes of play."
- On completion: news "The {city} Spaceport is finished. The first launch goes up on the next clear night.", sfx `milestone`, the once-per-city banner "SPACEPORT COMPLETE".

**Effects once complete** (online and powered):

- prestige r20 (wide land-value lift), noise 0.5 r8 around it (Step 7: the first draft's 0.7 r12 cancelled the prestige it brings, §10.5 B11);
- industrial demand target +200, commercial +300;
- income line **"Launch contracts"** +1,200 per month (monthly, independent of launches);
- visitors +3,000 per month (X3, monthly);
- story: everyone wants the launch rights (below, and §8.3 `ex.rights`).

**Launches (real time, Game-side, WP-2).** Launches are a spectacle, not a sim mechanic, so they run on the visual clock and never flood the ticker:

- `Game` keeps, per complete, online, powered spaceport, `launchClock` (unpaused real seconds since its last liftoff; not saved). It starts at `launchGapSec` when the spaceport completes (the first launch waits only for night) and at `launchGapSec / 2` after a load or a world swap.
- A launch is **due** when `daylight < SPACEPORT.nightBelow` (0.3) and `launchClock ≥ launchGapSec` (180). With the Day/night setting off it is always night (`timeOfDay` 0.92), so a launch comes every 180 s; with it on, at most one per visual night (one a night at speed 1, every other night at speed 3, §1.3).
- **First launch** (`b.launches === 0`): Game toasts "First launch in 10 s" with a 44 px **Watch** action (`toast.action { id: 'watch' }`; the UI centres the camera on the pad with `camera.centerOnTile`), then lifts off `firstLeadSec` (10) unpaused seconds later, with the banner "FIRST LAUNCH".
- At liftoff Game emits `liftoff { id, first }`, posts one rotating news line (Appendix B), increments `b.launches` and resets `launchClock`. The news line is posted **only** at a visible liftoff. At most one launch in flight per spaceport; a pending one is dropped when the world is replaced.
- Render culls the rocket by its own screen box (it climbs to z 900), not by whether the pad is in view, so a launch seen from across the city still draws.

**Launch rights, decided when the player is ready.** From the moment it is placed, the Spaceport inspect sheet carries a 44 px action "Launch rights · Choose" (`InspectAction` id `'rights'`; disabled with a reason while another card is open). It opens `ex.rights` through `director.openOnDemand` (§2.2): no deck slot, not an interruption. Until a choice is made, launches run as public without setting the flag (the row reads "Rights: Open"). The card also stays in the deck at weight 30 for players who never tap the button, and it is `once`.

**Art:** a blast pad is ground art (concentric scorch rings, service road loop, hazard chevrons at the edge). The sprite has four variants: three construction stages (a foundation and crane; a half tower in scaffolding; a full tower in scaffolding) and complete (a launch tower ~260 px with a gantry arm, a rocket on the pad, fuel spheres, a control bunker). FX: steam venting from the pad and slow searchlights at night; on `liftoff` a 14 s sequence in real seconds (a cut-scene: not sped up, frozen while paused): 0-1.5 s ignition glow and 8 smoke puffs; 1.5-8 s the rocket rises on an accelerating curve to z 900 with an exhaust column of 12 glow sprites; 8-14 s a fading afterglow line. Low quality: rocket and one glow only.

### 5.4 Shared port rules

- `maxCount` is checked in `planAction` before cost.
- **Confirm:** every port costs more than `SAFETY.confirmCost`, so the ghost stays after the finger lifts and the pill shows ✓ / ✕ with the cost and the note (§7.7).
- **Noise reach the player can see:** while the ghost of a building with `noise` is shown, `plan.loudTiles` (from `noiseReach`) lists the developed Hab Block tiles inside its reach; the ghost tints them amber and the pill note says "Loud over 48 homes". The dashed amber Chebyshev ring (a diamond on screen) is still drawn around the footprint, for the ghost and for the selection highlight.
- **Zoom to fit:** selecting the Seaport, Airport or Spaceport tool zooms the camera out (animated, around the screen centre, clamped to the camera's minimum zoom) until footprint plus noise radius fits the shorter screen side; clearing the tool restores the previous zoom unless the player zoomed by hand meanwhile.
- Jobs: Fab via `jobsInd`, Market for the rest (`buildingStats` splits `jobs` by `def.jobsInd`).
- Ports never pollute or make noise while offline; the spaceport doesn't until complete.
- **Opening moments:** PortSystem emits `moment` once per city per id (`'seaport'`, `'airport'`, `'spaceport'`; Game emits `'launch'`), recorded in `world.moments` (saved). `MilestoneBanner` (feedback.ts) queues them like milestones. Effects starts the first ship or plane phase as soon as a new port id appears.

**As built (WP-4, recorded in Step 7).**

- *Ships:* a ship approaches bow-in along the berth normal, turns to moor alongside while the crane trolleys shuttle containers, then turns bow-out and leaves. The approach length comes from a swept-hull check every 0.1 tile that stops before land, bridges, rail or the map edge (a 2.5-tile hull must never touch land while it turns), not from the open-water tiles along the normal alone. Ships and planes are culled by their own screen box (a superset of "only when the port is in view"); S- and E-facing ships draw in the seaport's depth slot.
- *Spaceport:* a fifth model, complete with an **empty pad** (`SPACE_EMPTY_PAD` in `render/art/ports.ts`), shows from liftoff until 30 s later, so the sprite's rocket and the flying rocket never show together. Pad steam, searchlights and the tower beacon animate on the frame clock like other building fx; only ships, planes and launches follow `clockRate`.

---

## 6. Extras (small, curated, each optional)

Each extra can be cut on its own: its config table stays, its fields read zero, and nothing else breaks. All three are in the work packages because they are small and they give the core features a reason to exist.

### 6.1 X1 · Academy and education (optional)

*Why:* the owner wants the player to steer wealth with services. Parks, clinics and precincts already raise land value; schools are the one lever that is **only** about wealth, and the only way to make a clean $$$ Fab District, which in turn cuts smog. One building, no new system.

- Building `academy` (§2.8), Civic tray, unlock 1,500.
- `ServiceEffect 'education'`: `FieldSystem.coverage` clears and fills only the fields in its hard-coded `EFFECTS` list (fields.ts), so **WP-1 adds `'education'` to that list**. Without it the Academy's coverage would be max-combined into `fields.education` and never cleared: after the Academy is bulldozed, loses power or goes offline (director outages hit service buildings), the values would stay until reload. WP-1 test: place an Academy, `recomputeAll`, then bulldoze it (and separately set it offline), `recomputeAll`, expect `fields.education` all zeros.
- Education is **not** in land value; it feeds only the wealth score (res +0.10, com +0.08, ind +0.35).
- It joins the Services overlay as a 7th swatch "Schools" (`EFFECT_RGB.education = [255, 208, 160]`). No separate overlay.
- Cut: drop the building; the field stays zero; industry still reaches $$ via net, transit and the seaport.

### 6.2 X2 · Regional links (optional)

*Why:* gives highways a destination (a highway that runs off the map edge is a trade route) and makes the map edge part of the city. §3.10. It only works if players find it, so it gets three small surfaces: painted stubs with chevrons at 4 border points, one line in the Highway tip, and a report row "Regional links 3/12".

- Cut: `edgeLinks` stays 0, no demand change, no stubs, no tip line, no report row.

### 6.3 X3 · Visitors and tourism (optional)

*Why:* the owner asked for airports and spaceports for "commerce and tourism". Visitors turn that into one number and one income line, and reward $$$ Market Strips and landmarks.

```
raw = 1200 × airports + 3000 × complete spaceports + 3 × ($$$ Market tiles)
    + Σ TOURISM.landmark[type] over online landmarks + 40 × edgeLinks
mood = clamp(approval / 60, 0.5, 1.3) × (1 − 0.8 × avgCrime)
visitors = round(raw × mood)                         (monthly, computed daily by PortSystem)
```

- Income line **"Tourism"** = 0.35 × visitors per month.
- Commercial demand target + 0.06 × visitors.
- Shown in the report ("Visitors 2,340/mo") and on the Airport and Spaceport inspect rows.
- Cut: `visitors` stays 0; the Airport keeps its +240 commercial jobs and the Spaceport its income line.

**Considered and rejected** (scope or owner): one-way streets and aircar skyports (owner said no); buses, ferries, parking, freight rail, a cargo-route minigame, noise walls as a building, per-tier demand bars, wealth painting (owner said the city decides), a separate education overlay, a multi-step undo history.

---
## 7. UI on phones

### 7.1 Toolbar (still 9 buttons; nothing added)

| Button (short) | Change |
|---|---|
| Info, Demo | unchanged |
| **Road** | becomes a **hybrid**: tool + tray (§7.2). Items: Street, Back Alley, Avenue, Highway |
| Zone | unchanged |
| **Power → Infra** | keeps the "Power" label and bolt icon until the first port unlocks (Seaport, 5,000 residents). From then the short label is "Infra" (wide screens "Power & Ports") with a new combined icon (a bolt over a crane hull), so in landscape, where labels are hidden, the icon still says "ports". Items: Solar Farm, Fusion Reactor, Seaport, Airport, Spaceport. The id stays `'power'`; coach step 3 still calls `setTool('solar')` directly |
| Civic | adds the Academy (X1). Order by unlock: Plaza, Precinct, Clinic, Data Hub, Academy, Maglev, Memorial |
| **Sky** | adds the Skyway after the Ribbon Rail: Stratablock, Skybridge, Ribbon Rail, Skyway, Spire, Arcology |
| Deals | unchanged |
| **Data** | adds the Wealth and Noise views (§7.3) |

The 360-px width problem (40-px buttons once Deals shows) is not made worse.

**Where did it go?** The unused `.cc-tb-dot` becomes a "new" dot: it shows on a category button when one of its items unlocked since that tray was last opened, and opening the tray clears it (seen tool ids per device in `cybercity.ui.newdot.v1`; a storage failure only means a dot may show again). Unlock news and the milestone banner name the tray: "Unlocked: Avenue (Road). Wide and lit: twice a street's traffic." and "Now available: Seaport (Infra), Highway (Road)". The banner's list (feedback.ts) extends from buildings to road kinds and the Skyway; because the expansion's unlocks sit on milestone populations (§2.8), the banner is their announcement. The Back Alley (1,200) also gets its own unlock news when it opens.

### 7.2 Road tray (hybrid category)

`Category` gets both `tool: 'road'` and `items: ['road', 'alley', 'avenue', 'highway']`. Tapping the Road button:

1. **No road tool active:** select Street, or the last road tool used **this session** (kept in memory only, never stored, so a new session never starts on a 90 CR/tile highway; a locked one falls back to Street). If two or more road kinds are unlocked, the tray opens too. The player can drag at once: touching the map closes the tray (ui.ts `onDown`) and the drag proceeds, so laying a street stays one tap.
2. **A road tool active, tray closed:** open the tray (the same as Zone).
3. **A road tool active, tray open:** close the tray (the tool stays).

Leave road tools with the tool chip's ✕ or Info. Tapping a card selects that tool, remembers it for the session and closes the tray; tapping a locked card toasts its reason and shakes it (as today). The Road button takes the active item's colour.

`dock.ts` changes (WP-5): `openTray`'s guard `if (!cat || cat.tool) return` returns only for tool-only categories (`cat.tool && !cat.items`); `onBarClick` gets a hybrid branch for rules 1-3; `syncTool` sets both `aria-pressed` (a road tool is active) and `aria-expanded` (tray open) on the hybrid button; `buildCards` reads the hybrid's `items`.

**Landscape** (`max-height: 520px`): the Road tray is a compact single row about 64 px tall (icon, name and price per card, no meta line), so a phone at 844×390 keeps most of the map while dragging.

Card content (name, live price, meta line; locked cards show "Reach 1,500 pop" with the progress bar the dock already draws for population locks). Phones hide `.cc-card-desc` below 640 px, so the meta line is the only explanation and must carry the key rule. Meta comes from `ROAD_KINDS[k].meta`, `SKYWAY.meta` and `BuildingDef.meta` (§2.8); the generic "size · jobs" meta applies only where none is given.

| Tray | Card | Price label | Meta line |
|---|---|---|---|
| Road | Street | 15 CR/tile | Lots ≤ 3 tiles |
| Road | Back Alley | 6 CR/tile | Cheap homes · crime |
| Road | Avenue | 40 CR/tile | 2× traffic · widens |
| Road | Highway | 90 CR/tile | 5× traffic · no lots |
| Sky | Skyway | 160 CR/tile | Cars · ramps |
| Sky | Skybridge / Ribbon Rail | (as now) | Tower to tower / Stations |
| Infra | Seaport | 18,000 CR | 4×4 · shore only ("No straight shore here" on maps without one) |
| Infra | Airport | 45,000 CR | 6×6 · loud |
| Infra | Spaceport | 150,000 CR | 6×6 · slow build |
| Civic | Academy | 3,200 CR | 2×2 · schools |

The Road tray has 4 cards, which fits 390 px with the fourth peeking. Trays with 4 or more cards get a right-edge fade (CSS mask) while they can scroll, so later cards are discoverable (Road 4, Infra 5, Sky 6, Civic 7, Data 10).

`KeyR` selects Street; pressing it again while a road tool is active cycles through the unlocked road tools in tray order.

### 7.3 Data views

Order in the Data tray: Off, **Wealth**, Land Value, Traffic, **Noise**, Power, Crime, Pollution, Services, Turf (story-gated as now).

| View | Legend | Notes |
|---|---|---|
| Wealth | swatches `$ · $$ · $$$` + one line | §4.5, with ▲/▼ pips. New `LegendKind 'tiers'`, a branch in `Dock.syncOverlay`. |
| Noise | heat, "Quiet" → "Roaring" | reads `fields.noise` (id = Fields key, so the heat path works). |
| Traffic | unchanged | on a tile under a skyway it shows `max(traffic, skyTraffic)` at road alpha. |
| Services | 7 swatches with X1 ("Schools") | the legend wraps to two rows on phones. |

`OVERLAY_CYCLE` (keyboard) adds `wealth` and `noise`.

### 7.4 Inspect rows

**Layout rule.** Inspect rows are a two-column grid with `white-space: nowrap` and 14 px monospace values (`.cc-insp-row dd`), so after its label a value has room for about 12 characters at 360-390 px. Every standard row value in this expansion is ≤ 12 characters. Anything longer is a **note row**: it spans both columns, wraps, uses 12 px sans, and takes an optional tone. `TileInfo` (game.ts, typed in Step 0, filled by WP-2) gains:

```ts
  /** Full-width, wrapping lines under the rows (≤ 60 chars each; at most two lines at 360 px). */
  notes?: { text: string; tone?: 'good' | 'warn' | 'bad' }[];
  /** Ticks (0..1) drawn on the percent meter of row `row` (the Wealth row). */
  meter?: { row: number; ticks: number[] };
```

`Game.getTileInfo(x, y, sky?)` (WP-2). Percent values keep the existing meter. `HIGH_IS_GOOD` adds `'Education'`.

| Tile | Title / subtitle | Rows (values ≤ 12 chars) | Notes |
|---|---|---|---|
| Street | Street / "Lots within 3 tiles can grow here." | Traffic, Pollution | |
| Avenue | Avenue / "A wide, lit boulevard: twice a street's traffic." | Traffic, Pollution | |
| Highway | Highway / "Five streets of traffic. Streets join it at on-ramps." | Traffic, Noise, Ramps `2` | with no ramps: "No on-ramps: nothing can use it" (warn) |
| Back Alley | Back Alley / "Narrow and cheap. Crews like the dark." | Traffic, Crime | "Homes beside it stay affordable" |
| On-ramp | On-ramp / "Joins the street grid to the highway." | Traffic | |
| Any bridge | "{Kind} bridge" / "A road on piers over the water." (replaces "Elevated skyway over the water.") | as its kind | |
| Border road (X2) | | | "Regional link: +n trade" |
| **Skyway** (a tap on the deck, `Selection.sky`) | Skyway / "A raised road. Ramps land on streets; docks join megastructures." | Load `34%`, Ramps `2`, Docks `1` | "Lands nowhere: add a ramp or dock" (warn) when it carries nothing; "Ramp closed: needs a street below" on a closed ramp. Action "Demolish segment · 5 CR" (`InspectAction 'skyway'`) |
| Ground tile under a deck | as its ground | as its ground | "Skyway overhead: tap the deck" |
| Zone tile | as now / as now | + Wealth `$$ ▲ 52%` (meter with ticks), Noise, Education; Road access `none` when only a highway is near | Next, Lifted by (§4.5); "Affordable quarter: +10% residents" (good); "Highway only: lots need a street or avenue" (warn) |
| Seaport | | Jobs, Trade `+324/mo`, Exports `+260 jobs`, Noise `6 tiles` | |
| Airport | | Jobs, Visitors `1,250/mo` (X3), Business `+240 jobs`, Noise `10 tiles` | "Shops 8-16 tiles out do better business" |
| Spaceport | | Building `62%`, or Next launch `Tonight` / `2 min`; Jobs, Visitors, Noise `12 tiles`, Rights `Open` / `Public` / `Basalt` / `Nacre` / `Kites` | while building: "Takes 240 days and at least 4 minutes of play." Action "Launch rights · Choose" while Open (§5.3) |
| Academy | | Radius (generic) | "Lifts nearby blocks toward $$ and $$$" |

Game exposes `sim.ports` (read-only `PortView`) for the trade and visitor numbers. The inspect header kind label maps `transport` → "Transport".

Acceptance (WP-5): the visual harness opens every variant above at 360 and 390 px wide and asserts that no `dd` overflows (`scrollWidth ≤ clientWidth`) and every note wraps within two lines.

### 7.5 Action pill, previews and cost tag

- **Name with counts folded in**, so notes stay short: "STREET ×12", "AVENUE ×6 · 6 WIDENED", "HIGHWAY ×24 · 2 RAMPS", "SKYWAY ×8 · 1 RAMP", "DEMOLISH SKYWAY ×6". Then the cost, or a green "REFUND 18,000" for a refunded bulldoze.
- **Note:** `plan.note`, at most `SAFETY.noteMax` (32) characters: "Cuts 2 cross streets", "Lands nowhere", "Needs a straight shore", "12 blocks lose road access", "Loud over 48 homes", "Closes 1 skyway ramp". How-to sentences live in the first-use tips and the advisor, never in the pill. The pill turns `is-warn` when a note is present. A contract test fuzzes `planAction` for every new tool over the expansion fixture and checks every `note` and `reason` is ≤ 32 characters.
- **Confirm mode** (§7.7): the pill grows to 52 px and shows ✓ and ✕ buttons, each at least 44 × 44 px.
- **Ground ghost** (`roadGhost`): draws each tile at its **resulting** kind from `plan.roadKinds` (width and colour, links via `roadLinks`); ramp tiles pulse white with a chevron; upgrades tint gold; `plan.lostTiles` lots tint red.
- **Skyway ghost** (`drawPreviewTop`): raised quads at z 52 in the skyway's look, ramp ends sloped, dock ends with a ring, closed ramps red.
- **Building ghosts:** noisy buildings draw the noise ring and tint `plan.loudTiles` amber (§5.4); the seaport ghost draws its berth, and while the tool is active every valid shore site is outlined (§5.1).
- `changedTiles` (feedback.ts) counts by `plan.roadKinds` for road tools and by `plan.skyMasks` for skyways.

### 7.6 Making the new mechanics explain themselves

The owner's note on the story ("it lacked explanation") applies here: every new mechanic explains itself in the place the player meets it.

1. **First-use tips** (new `src/ui/tips.ts`): the first time a tool is selected, a small card in the gesture-hint slot shows one line, an icon and a **Got it** button (at least 44 × 44 px). **One item at a time:** the one-time gesture hint goes first, then the tip. A tip shows only when no tray is open, no drag or confirm is in progress, and no story banner or waiting-message banner is on screen; otherwise it waits (it is not dropped). It auto-hides after 8 s and remembers seen ids per device (`cybercity.ui.tips.v1`, a JSON array; storage failures just mean the tip may show again). Copy in Appendix A.
2. **Sim hints** (`hint` event, §2.9): `wealth` on the first $$ tile of the session, `ramps` when the advisor's no-ramp warning fires, `noise` when its noise warning fires. The UI shows each once per device, under the same one-at-a-time rule.
3. **Inspect** shows the wealth score as a meter with the two thresholds, what lifts a block and the single biggest thing holding it back, from the same formula the sim uses (§4.5).
4. **Planner notes** (short, §7.5) and the **lens pips** (▲/▼) appear as you build.
5. **Advisor lines** (Appendix B) when a feature is misused.
6. **Help** (menu.ts) gains two steps after step 7: "8 · Grow your roads" ("Avenues and Highways carry more traffic. Cross a highway with a street for on-ramps. Back alleys keep homes cheap.") and "9 · Read wealth" ("Blocks turn $, $$ or $$$ by themselves: land value, schools, transit and quiet lift them; noise, crime and alleys hold them back. Data → Wealth shows it."). Later steps renumber.
7. **Unlock news and the banner** name the tray (§7.1).

The 3-step onboarding coach is not changed.

### 7.7 Safety: confirm, undo, refund

The expansion adds the most expensive and destructive actions in the game, and today a building commits as soon as the finger lifts (`input.ts commitBuild`) with no undo and no refund (`BULLDOZE_COST`: "buildings refund nothing").

**Confirm (place, then ✓).**

- `planAction` sets `plan.confirm = true` for (a) any building tool whose cost (× `buildCostMul` × `costMul`) is at least `SAFETY.confirmCost` (10,000: all three ports, and any other building that expensive) and (b) a highway drag with `lostAccess > 0` (§3.4).
- Input (WP-5): when the finger lifts on a valid plan with `confirm`, nothing is built. The ghost stays (the preview keeps the plan), and the pill shows the name, the cost, the note ("Loud over 48 homes", "14 blocks lose road access") and ✓ / ✕. ✓ re-plans from the same points and applies (if the plan is no longer valid, for example funds changed, it toasts the reason). ✕, Esc, a tool change or a new drag clears it. Dragging again moves the ghost (the seaport snap still applies). Desktop: Enter = ✓. The sim keeps running meanwhile.

**Undo (one step, 10 seconds).**

- After a valid drag with a road tool, the skyway tool or a zone tool, `Game.apply` keeps **one** snapshot, replacing any older one: for every tile the apply changed (path tiles, and any neighbour whose sky mask gained a link) its before-state and after-state (`TileSnap { i, road, roadKind, zone, level, sky }`), the credits spent, and the wall time. It toasts a short line ("Street ×12", "Zoned 24 lots", "Skyway ×6") with an **Undo** action (`toast.action { id: 'undo', sec: 10 }`, a 44 px button) that disappears after `SAFETY.undoSec`.
- `Game.undo()` works only inside the window and only if every snapshot tile still equals its after-state (a lot that developed meanwhile blocks it: "Too late to undo"). It writes the before-states back with `world.restoreTile`, refunds the credits spent, runs `recomputeAll`, emits `stats` and toasts "Undone". There is no history; any other action clears the snapshot.
- Not undoable: bulldoze, buildings (they have the refund below), story tools.

**Refund (30 seconds).**

- Game records, for each building it places, the credits paid and the wall time (`placed: Map<id, { at, paid }>`, not saved). `Game.plan` for a bulldoze sets `plan.refund` to the sum paid for buildings in the plan placed less than `SAFETY.refundSec` (30 s) ago; `Game.apply` credits it after the demolition, and the pill shows it in green. Build reactions already given stay (their per-type limits cap any loop).

**As built (WP-5, recorded in Step 7).**

- The skyway pill counts **new** deck tiles (those with `world.sky === 0`), not every tile whose `skyMasks` bits change, so the count matches what is charged (`perTile` per new tile).
- **Watch** eases the camera to the pad (pad at 66% of the screen height, zoom eased to at most 0.85; a touch on the map stops it) instead of a hard `camera.centerOnTile`, so the climb stays in view.
- Tips (§7.6) also wait while the inspect sheet is open and keep a 2 s quiet gap between two tips. Tray cards are 104 px wide on portrait phones up to 419 px, so a fourth card peeks at 390 px. The action pill hides (keeping its plan) behind a chapter title, Charter Night or the ending, so its ✓ can't be tapped through them; action toasts sit on top and are evicted last; Demolish reads "Full refund" inside the refund window; the Spaceport "Building" row uses a neutral meter.
- The Spaceport's Power row reads "—" while it builds (it draws nothing yet), not "NO POWER" (Step 7). `Game.readyLaunches()` is a test and harness hook that makes a loaded complete Spaceport's next launch due at the next night.
- Toolbar buttons stay 43 px wide at 390 px and 40 px at 360 px with all 9 categories, as before this expansion (§7.1 "not made worse"); their short labels stay 10 px. Every new control is ≥ 44 px.

---
## 8. Story hooks

### 8.1 Who cares about what

| Feature | Board | Basalt | Nacre | Undertow | Kites | Tuning |
|---|---|---|---|---|---|---|
| Highways | dislike the cut through neighbourhoods (card) | want night convoys (card) | | | | |
| Back alleys | | | | love them (mood, affinity, capped power, card) | like them (affinity) | |
| Skyways | | | | | love them: no wasps up there (capped power, affinity, card) | |
| Glass-tower share ($$$) | worried when > 30% (mood, card) | | loves it (mood, card) | | | |
| Seaport | | builds it (reaction, mood, power, card) | | smuggles through it (reaction, affinity, card) | | |
| Airport | +2 | | +5, power, card | | −3, card | |
| Spaceport | +3, can keep it public | +4, wants cargo slots | +4, wants the broadcast | | +2, wants the uplink | −2 ("the roar drowns the hum") |
| Academy | +2 | | | | | +2, night school card |

Road kinds and skyways have no build reactions (reactions are buildings-only; no new signal, no director change beyond `openOnDemand`).

### 8.2 Data rows (numbers in config from Step 0)

**Mood drivers** (`content/factions.ts`, WP-6; every faction stays within the 4–6 lint range):

| Faction | Label | Driver |
|---|---|---|
| Board | Priced out | `m: 'wealth.high', offset: 0.3, mul: −40, min: −8, max: 0` |
| Basalt | Seaports | `m: 'count.seaport', mul: 3, min: 0, max: 6` |
| Nacre | Glass towers | `m: 'wealth.high', offset: 0.05, mul: 50, min: 0, max: 8` |
| Undertow | Back alleys | `m: 'roads.alley', mul: 1/15, min: 0, max: 5` |

Kites already have 6 drivers and Tuning 5; they get cards and power terms instead.

**Power terms.** Two places hold them and both get the same terms: `POWER_TERMS` in `content/factions.ts` (data, checked by content-lint; WP-6) and the live sums in `powerWeight` in `src/game/story/factions.ts` (WP-2), which today hard-codes each term. The terms: Board `launchRights === 'board'` → +150; Basalt `60 × count.seaport`, `launchRights === 'basalt'` → +150; Nacre `80 × count.airport`, `launchRights === 'nacre'` → +150; Undertow `min(0.25 × roads.alley, 60)`; Kites `min(0.5 × skyway.tiles, 100)`, `launchRights === 'kites'` → +150. The `{ m, mul }` PowerTerm variant gains an optional `max` so the data matches. The caps matter: alleys cost 6 CR, and `power.gangs ≥ 30%` is an ending claim (endings.ts), so an uncapped alley term would let the player buy the Balance of Power for under 2,000 CR. Tests (WP-2, `tests/story/conditions.test.ts`): 1,000 alley tiles add exactly 60 Undertow weight; 400 sky tiles add exactly 100 Kites weight. This is how "a faction wants to control the Spaceport" shows up in the Balance of Power bar.

**Build reactions** and limits: §2.8. STORY.md §2.6's table gains the four rows.

### 8.3 Deck cards (new file `src/game/story/content/cards/expansion.ts`)

Eleven faction cards. They are spread into `DECK` and `CARD_LIST` (the director draws from `CARD_LIST`) but **not** into `FACTION_DECKS`, so the per-faction counts in content-lint stay; only the `DECK` and `CARDS` totals grow, by 11 each, from whatever the merged pacing workflow leaves. `wealth.*` shares count every developed zone tile, industry included, which is why the thresholds below sit under the res + com targets of §10.3. Every card has `kind: 'faction'`, a `when`, `weight: 10` and `cooldown: 720` unless listed, exactly one default (‡), no ⚑, no beat, and a `brief`. **Eight are `once`**: they are about one physical decision, so they never ask again, and their lasting choices are `perm` (or a long `local` disc on the place they are about). Only `ex.manifest`, `ex.backway` and `ex.pricedout` recur. `{district}` appears only with a spot. Copy follows STORY.md §1.4 (Marrow in minutes, Sallow in arithmetic calling MOTH "Operations", Oduya delighted with the only exclamation marks, Brine in tides calling MOTH "little light", lark in lowercase calling MOTH "moth", Ohm hymn-like calling MOTH "the Hum"); speakers never use `$` symbols. All lengths were checked against the lint limits (title ≤ 28, body ≤ 280 and brief ≤ 220 after the worst-case token fill, labels ≤ 40 ending in a period) and the banned-term list; WP-6's lint run is the final check.

##### `ex.manifest` · Undertow · FALSE BOTTOMS
when `count.seaport >= 1 & turf.undertow >= 10` · recurring
> Brine's divers work your seaport after dark, resealing containers. Something rides under the frozen fish. 'Every hull has two bottoms, little light. The tide only reads the top one.'

Brief: "The Undertow is smuggling through your Seaport. Look away and take a cut (secret money raises Trace), search the containers with police drones, or fine the crates and let trade go on."
- **Look away. Take the cut.** → Undertow +10, Trace +2, `↻ +200/mo ×12mo "Dock skim"`
- **Scan every container.** [req `count.precinct >= 1`, hint "Needs an Enforcer Precinct"] → Undertow −10, Board +4, `[demandInd −0.03, 180d]`
- **Fine the crates.** ‡ → CR +1,500, Undertow −4, Basalt +2

##### `ex.backway` · Undertow · THE BACK WAY
when `roads.alley >= 30 & turf.undertow >= 10` · spot `alley` · recurring
> Every lamp in the back alleys of {district} is broken again. Brine's crews move through them like water through a hull. 'Light them and we find darker ones, little light. Rent them to me and they stay tidy.'

Brief: "The Undertow runs the back alleys in {district}. Relight them to cut crime there, leave them dark and the gang grows, or rent them to Old Brine for steady secret income."
- **Relight every alley: 1,500.** → CR −1,500, Undertow −8, `local(spot, r6, 360d) crime −0.06`
- **Leave them dark.** ‡ → Undertow +8, `local(spot, r6, 180d) crime +0.05`, `turf str undertow +15 (spot, r4)`
- **Rent her the alleys.** → Undertow +6, Trace +2, `↻ +150/mo ×12mo "Alley rent"`

##### `ex.convoy` · Basalt · NIGHT CONVOY
when `count.seaport >= 1 & roads.highway >= 20` · `once`
> Sallow: 'Forty trucks an hour off your docks, Operations, if the highways stay open all night. Thirty-one if they close at ten. I have done the arithmetic for you. The residents have not.'

Brief: "Basalt wants Seaport trucks on your highways all night. Industry grows but residents lose sleep. Keep the ten o'clock curfew, or charge a night toll and bank the money."
- **Open the night lanes.** → Basalt +8, `[demandInd +0.06 & approvalAdd −2, perm]`
- **Close them at ten.** ‡ → Basalt −4, Board +2
- **Charge a night toll.** → Basalt −5, `↻ +300/mo ×24mo "Night tolls"`

##### `ex.lounge` · Nacre · FIRST CLASS ONLY
when `count.airport >= 1` · `once`
> Oduya: 'Partner! Arrivals is the city's first impression! The shuttle stop for the cleaning crews is right in frame. We move it two blocks, they walk, and everyone else gets a lounge with a waterfall!'

Brief: "Nacre wants a luxury lounge at the Airport and the workers' shuttle stop moved out of sight. Land value rises but workers grumble. Refuse, or pay to do both properly."
- **Build the lounge. Move the stop.** → Nacre +8, Board −3, `[landValueAdd +0.01 & approvalAdd −1, perm]`
- **The stop stays.** ‡ → Nacre −5, Board +2
- **Do both properly: 4,000.** → CR −4,000, Nacre +3, Board +2, `[landValueAdd +0.01, perm]`

##### `ex.glassshore` · Nacre · THE GLASS SHORE
when `wealth.high >= 0.12` · spot `shore` · `once`
> Oduya: 'Your glass towers by the water are the best thing in my feed! Buyers want the whole {district} waterfront at that price. We'd only need the old tenements gone. Their people will love somewhere quieter, I promise!'

Brief: "Nacre's buyers want the {district} waterfront for $$$ homes. Selling pays and lifts land value but pushes poorer residents out. Cap rents to keep them, or make the buyers fund a plaza."
- **Sell the waterfront.** → CR +3,000, Nacre +10, Board −4, `local(spot, r5, 3600d) lv +0.04`, `[demandRes −0.04, 360d]`
- **Cap the rents.** ‡ → Nacre −6, Board +4, `local(spot, r5, 3600d) lv −0.02`, `[approvalAdd +2, perm]`
- **Make them pay for a plaza.** → CR +1,500, Nacre +4, Tuning +2, `credit plaza ×1 ×0`

##### `ex.pricedout` · Board · PRICED OUT
when `wealth.high >= 0.22` · recurring
> Marrow: 'Minutes. Item one: two hundred and twelve households left the city this quarter. Item two: their homes are now top-rent floors. The Board asks whether that is a policy. Noted: nobody answered.'

Brief: "As blocks turn $$$, poorer families leave. Fund affordable homes (costs money, keeps people happy), let the market decide (Nacre likes it, approval drops), or open new land for homes. Back alleys also keep rents low."
- **Fund affordable floors: 5,000.** → CR −5,000, Board +8, `[approvalAdd +3 & demandRes +0.04, 720d]`
- **Let the market sort it.** ‡ → Board −6, Nacre +4, `[approvalAdd −3, 360d]`
- **Open land for new homes.** → Board +3, Basalt +2, `[demandRes +0.06 & landValueAdd −0.01, 360d]`

##### `ex.thecut` · Board · THE CUT
when `roads.highway >= 30` · spot `highway` · `once`
> Marrow: 'Resolved: the highway through {district} is loud. Resolved: the people on both sides used to be one neighbourhood. Proposed: walls, a footbridge, or an apology. The Board will accept any of the three.'

Brief: "Your highway splits a neighbourhood in {district} and residents hate the noise. Noise walls cost the most and help most there, a footbridge helps a little, or just apologise."
- **Build noise walls: 3,000.** → CR −3,000, Board +6, `local(spot, r4, 3600d) lv +0.05`
- **Build a footbridge: 1,200.** → CR −1,200, Board +3, Tuning +2, `local(spot, r3, 3600d) lv +0.02`
- **Send the apology.** ‡ → Board −3, `[approvalAdd −1, 180d]`

(The walls are paid once and help where the noise is; `local` has no `perm`, so 3,600 d stands in for "for good".)

##### `ex.rights` · Board · LAUNCH RIGHTS
when `count.spaceport >= 1 & !launchRights` · weight 30 · `once` · `onDemand`
> Marrow: 'Item: the launch tower. Basalt wants the cargo slots. Nacre wants the broadcast. The Kites want the uplink, unofficially. The public wants to watch. One vote decides who holds the rights.'

Brief: "Your Spaceport needs an operator. Basalt boosts industry, Nacre pays you for broadcasts, the Board keeps launches public for approval, and the Kites (if friendly) help hide you."
- **Basalt gets the cargo slots.** → flag `launchRights=basalt`, Basalt +12, Nacre −6, `[demandInd +0.05, perm]`
- **Nacre gets the broadcast.** → flag `launchRights=nacre`, Nacre +12, Basalt −6, `↻ +600/mo ×36mo "Launch broadcasts"`
- **Keep the launches public.** ‡ → flag `launchRights=board`, Board +10, `[approvalAdd +4, perm]`
- **Let the Kites ride the uplink.** [req `standing.kites >= 20`, hint "Needs the Kites Friendly"] → flag `launchRights=kites`, Kites +15, Trace −5, Nacre −8, Basalt −4

The player opens it when ready from the Spaceport's inspect sheet ("Launch rights · Choose", §5.3), any time from placement on; that opening takes no deck slot and is not an interruption. The weight-30 deck entry only catches players who never tap the button. **Fallback** if `openOnDemand` turns out to break the STORY-CONTRACT pacing rules: the director's Spaceport build reaction queues `ex.rights` at +0d, so it arrives at queue priority as a COMMS card, and the inspect button opens that pending card.

##### `ex.stringlights` · Kites · STRING LIGHTS
when `skyway.tiles >= 20` · `once`
> lark: 'your skyways are the best roofs in the city, moth. no wasps up there. we wanna hang string lights and a couple of relays under the decks. tiny ones. nacre will say it's ugly. it isn't.'

Brief: "The Glass Kites want to hang lights and signal relays under your skyways. Saying yes pleases them and helps shops but annoys Nacre. Refuse, or charge them rent."
- **Let them string it.** → Kites +10, Nacre −4, `[demandCom +0.03, perm]`
- **Keep the decks clear.** ‡ → Kites −6
- **Charge them rent.** → Kites −2, Trace +1, `↻ +120/mo ×24mo "Relay rent"`

##### `ex.nofly` · Kites · NO-FLY
when `count.airport >= 1 & turf.kites >= 10` · `once`
> lark: 'your airport just drew a no-fly cone over half of shadeside. every kite drone we own is grounded. bend the flight path one degree, moth. one. the planes won't even notice.'

Brief: "The Airport's flight path grounds the Glass Kites' drones. Bending it pleases them but moves the noise onto other homes. Keep it, or share radar data with them (raises Trace)."
- **Bend the flight path.** → Kites +10, Nacre −5, `[approvalAdd −1, perm]`
- **Keep the corridor.** ‡ → Kites −8, Nacre +3
- **Share the radar feed.** → Kites +6, Trace +3

##### `ex.nightschool` · Tuning · NIGHT SCHOOL
when `count.academy >= 1 & tuningActive` · `once`
> Sister Ohm: 'Your Academy empties at ten. We fill it at eleven. We teach the old wiring by lamplight, and the children learn how the grid breathes. Leave the doors open, Hum. We lock up after.'

Brief: "The Tuning wants to teach in your Academy at night. Allowing it lifts approval and pleases them but raises Trace a little. Lock up, or fund proper night classes."
- **Leave the lights on.** → Tuning +8, Trace +1, `[approvalAdd +2, perm]`
- **Lock up at ten.** ‡ → Tuning −4
- **Fund night classes: 1,500.** → CR −1,500, Tuning +5, Board +3

(The hidden Tuning draws nothing until active, per §7.1, so `tuningActive` is belt and braces.)

**Cadence.** Eleven cards join the deck under the pace setting's real-second gaps; eight are `once` and the three recurring ones have 720 d cooldowns. They add variety, not frequency: the director's gates, not the deck size, set the rate. No card queues another (outside the `ex.rights` fallback); none is ⚑; none is a chapter beat.

**New spot rules** (WP-6, `story/effects.ts`): `highway`, `alley`, `shore` as defined in §2.2. A card with such a spot is drawable only while the spot resolves (`spotAvailable`), so `{district}` always names a real place.

**As built (WP-6, recorded in Step 7).** STORY.md §2.3 rule 3 ("every penalty is a timed modifier") wins over three permanent approval penalties above, so each became a permanent bonus plus a 720-day penalty (the cards' cooldown): `ex.convoy` "Open the night lanes." = `[demandInd +0.06, perm]` + `[approvalAdd −2, 720d]`; `ex.lounge` "Build the lounge. Move the stop." = `[landValueAdd +0.01, perm]` + `[approvalAdd −1, 720d]`; `ex.nofly` "Bend the flight path." = `[approvalAdd −1, 720d]`. The content lint now allows a perm modifier only as a pure bonus on a `once` card's choice. The briefs of `ex.pricedout`, `ex.thecut` and `ex.nofly` were lightly edited to name who is asking (the Board, the Board, the Glass Kites), and `ex.pricedout`'s to stay under 220 characters. The §8.5 glossary entry was skipped: the glossary is at its 20-entry lint cap.

### 8.4 Turf affinity (story/turf.ts, WP-2)

Added to STORY.md §3.3's formulas, using the `TURF.affinity` keys from §2.8 (indicators dilated with the same pattern as the ribbon term):

```
Undertow += 0.2·[alley within 1] + 0.2·[seaport footprint within 6]
Kites    += 0.1·[alley within 1] + 0.15·[skyway tile within 1]
```

- The Kites' existing `ak.traffic × traffic[i]` term reads 0 on Highway and Ramp tiles; otherwise every congested highway (0.6-1.0) would become a Kites turf magnet.
- `storyTool` (game.ts) includes the road-kind tools and the skyway, so the alley mood driver, power terms and turf eligibility update right after a drag, not at the next `markDirty`.
- Test (WP-2): affinities stay in [0, 1] with every new term at its maximum, and a congested highway tile gains no Kites affinity from traffic.

### 8.5 Glossary (optional)

If the glossary has room under its 20-entry lint cap, add one entry: "Launch rights: who operates your Spaceport's launches. Whoever holds them gains favor and weight in the Balance of Power." Otherwise skip it.

---

## 9. Audio

- Road kinds (all four tools, upgrades and ramps): the existing `road` sfx. Skyway, Academy and ports: `build` (on ✓ for confirmed placements). Spaceport completion: `milestone`. Undo: `click`. `Game.apply`'s sfx map lists the new tools explicitly so nothing falls through to `zone`.
- **Launch** (the only new sound): `AudioEngine` listens to `liftoff` directly, like the story cues (its own gap, not an sfx kind): a 3 s synthesized rumble (low-passed noise swelling, then fading) under a slow rising sine; muted with sound off. Launches are at least 180 s apart (§5.3), so it never becomes a drone. No sound for planes, ships or tier changes.

---

## 10. Performance, saves, balance

### 10.1 Budgets and how to meet them

| Area | Budget | How |
|---|---|---|
| `sim.step()` (Node, full map + expansion fixture) | < 2 ms average (today 0.74) | Road and sky caches (components, ramp and sky reach BFS, sky tile list, roadLv, roadCrime, alleyNear, edge points) rebuild only when `roadSig` or `skyVersion` changes; docks are re-derived every scan in O(sky tiles). Noise, hub and sea ≤ 0.1 ms per phase-0 tick. Wealth score one 4096 loop in phase 1. Tier steps ride the existing growth sample. No allocation in hot loops; flat precomputed tier tables. |
| `recomputeAll()` | < 10 ms (today 0.98) | same caches, forced. `settleWealth()` (once per old save) < 5 ms. |
| Planning previews | < 1 ms per finger move | `lostAccess` is a local scan with a scratch mark array (≈ 20k checks for a 60-tile highway drag); `shoreSites` < 1 ms once per tool select; `noiseReach` ≤ 30×30 tiles. |
| Frame, mid phone, default zoom, full map | ≥ 30 fps, 60 target | Road kinds and the deck shadows live in the cached ground chunks (repainted by dirty rect only; tier changes never dirty them, §4.3). Port aprons are ground art. Skyway segments are cached sprites keyed `(mask 0..15, ramp, closed, pillar, night bucket 0..6)` in the existing `SpriteCache` at the current scale bucket, with model ids from `SKY_BASE = 4000` (above every building id) so keys never collide. ≤ 0.8 ms for 300 visible sky tiles: car lights drawn with the segment, their night glows collected and drawn in **one** `'lighter'` pass after `drawObjects`, capped at 200, skipped below zoom 0.5 and on low quality. Planes, ships and a launch ≤ 0.3 ms total; ships and planes drawn only when their port is in view, the rocket culled by its own screen box. No `shadowBlur`. |
| Sprite cache | stays within 32 MB | 432 zone bodies (today 144), painted on demand. WP-4 measures painted sprites per second while panning a full mixed-tier map: ≤ 1.2× today. If over, lower `MAX_SPRITE_SCALE` for zone L1 bodies only. **Measured and decided in §10.5** (cold pan 2.6×, accepted). |
| Memory | + ~150 KB | Fields +6 × 16 KB + 4 KB, SimGrid caches ~60 KB. |
| Save | < 64 KB JSON for a full v3 city | §2.5; tested. |

### 10.2 Save, contract and migration tests (Step 0)

`tests/save-v3.test.ts`, `tests/expansion-contract.test.ts`, `tests/roads.test.ts`:

1. A v1 fixture and a v2 fixture load: every road is Street, every tier is $, `sky` is empty, `loadedVersion` is 1 / 2, story behaviour unchanged.
2. v3 round trip keeps every road kind, bridge kinds, tiers, sky masks and ramp bits, seaport `facing`, spaceport `buildDays`, `waitSec` and `launches`, and `moments`; `SAVE_VERSION` is 3.
3. Corrupt input never throws: kind 7 → Street; Alley or Ramp on water → Street; tier 3 → 2; tier on a lot → 0; `sky` not an array, odd length, bad values or wrong total → empty; a one-sided sky link is cleared; a ramp bit with two links is cleared; a ramp bit over a non-road tile is **kept**; a seaport with `facing: 9` gets its facing recomputed; a non-seaport loses `facing`; a spaceport `buildDays` of 5,000 clamps to 240 and `waitSec` of −3 to 0; unknown `moments` are dropped.
4. `World.deserialize` throws "Incompatible save" for a v4 save. Through `Game` (stubbed `localStorage`): the stored v4 string is left untouched, `${SAVE_KEY}.future` holds a copy, `save()` returns false until `newCity()`; a v2 load writes `${SAVE_KEY}.v2` once and never overwrites it.
5. `recomputeAll()` leaves the structural fields (`terrain, road, roadKind, zone, level, wealth, abandoned, variant, buildingId, age`) of every tile unchanged on a city mid-gentrification.
6. `computeAccess` agrees with `World.hasRoadAccess` and `RoadAccessMap` on 20 random mixed-kind maps.
7. Every World mutator, called in random order, keeps the §2.1 invariants; `setRoad(x, y)` still lays a Street.
8. The expansion fixture (§10.4) serializes under 64 KB.
9. Contract: `ROAD_KINDS[k].kind === k`; every new BuildingType sits in `BUILDING_ORDER` before `'stack'` (and `slice(-7)` is still the story types); `roadLinks` matches §3.2's matrix; the tile-bit round trip holds for every kind × tier; every new `meta` ≤ 22 characters.

Existing tests Step 0 updates: `save.test.ts` (version 3); `tests/story/contract.test.ts` (`SAVE_VERSION` is 3; the "unsupported version throws" case uses version 4).

The other packages' tests are listed with each package in §11.

### 10.3 Balance targets

Measured headless (§10.4). The integration step tunes only the expansion tables in config.ts (§2.8) to hit them, then writes the measured values into §10.5. Populations follow the new unlocks; where a scripted city never reaches an unlock (a flat `ScriptedMayor` city levels off near 10,000), the harness lifts the lock by raising `world.maxPopulation` at the stated year.

| # | Scenario | Target |
|---|---|---|
| B1 | Existing balance tests (starter city, 5 scripted years, generated terrain) | pass unchanged; the starter city stays all $ |
| B2 | Scripted mayor, 8 years, flat (M1): split of developed res + com | $ 55–80%, $$ 20–40%, $$$ ≤ 8% |
| B3 | Well-served mayor (M2: academies, plazas, clinics, precincts as they unlock) | $ ≤ 45%, $$ 35–60%, $$$ 12–30%; ≥ 25% of Fab tiles at $$ or better |
| B4 | M2 vs M1 | net monthly income ≥ +20%; population ≥ M1 − 3%; approval ≥ M1 − 2; M2 reaches every chapter population goal M1 reaches (3,000 and 7,000 on flat maps) no more than 30 d after M1 (this one also runs in the regular suite, `tests/expansion-balance.test.ts`, one seed) |
| B5 | Avenues (M3: the two central cross streets widened at 1,500 pop) | avgTraffic ≤ M1 × 0.88 |
| B6 | Highway ring with 4 ramps (M4, at 5,000 pop) | avgTraffic ≤ M1 × 0.82; highway congestion > 0; the same ring with no ramps carries exactly 0 |
| B7 | Alleys (M5) | mean crime within 1 of alleys exceeds the city mean by 0.04–0.10; population ≥ M1 (affordable quarters) |
| B8 | Seaport (M6, generated terrain, placed at 5,000 pop on the first valid site) | jobsInd +150..+400 after 3 years vs no port; "Port trade" ≥ 150/mo |
| B9 | Airport (M7, placed at year 3, lock lifted) | jobsCom +150..+500 vs none; land value 3 tiles from the footprint 0.08–0.20 below the same tiles without it |
| B9b | Airport business district (M7) | the share of Market tiles 8–16 tiles from the footprint at $$ or better is ≥ 15 points higher than on the same tiles in the no-airport run |
| B10 | Stability | at steady state no tile changes tier more than 4 times in 2 sim years |
| B11 | Spaceport (fixture city, lock lifted) | after completion: visitors ≥ 3,000 × mood, avgLandValue +0.03 or more, net income positive including its upkeep |
| B12 | Performance | §10.1 budgets with the expansion fixture |
| B13 | Power balance | alleys never add more than 60 Undertow weight, skyways never more than 100 Kites weight |

### 10.4 Headless measurement plan

`tests/expansion-measure.test.ts` (Step 7), skipped unless `MEASURE=1` (`describe.skipIf(!process.env.MEASURE)`), prints one table per scenario for seeds 2091, 7 and 31:

- **M1** `ScriptedMayor` 8 years (flat world). **M2** M1 with rich services. **M3** M1 plus avenues at 1,500. **M4** M1 plus a highway ring at 5,000. **M5** M1 with interior alleys behind homes. **M6** generated terrain plus a seaport at 5,000 on the first valid shore site. **M7** M1 plus an airport at year 3. **M8** `fullyBuiltWorld()` plus the expansion fixture (perf, wealth split, spaceport).
- Columns: pop, approval, avgTraffic, avgNoise, wealth split per zone, jobsInd, jobsCom, net income, visitors, highway mean congestion, sky mean load, tier changes per tile per year, `tierEffect`.
- **Fixture and mayors** live in a new `tests/expansion-fixture.ts` (created by WP-1, extended by Step 7; `tests/helpers.ts` is not edited): `expansionFixture(world)` adds, **with World mutators only** (so WP-1 doesn't depend on WP-2's tools), a 60-tile highway ring with 8 ramps, 300 sky tiles docked to anchors, two academies and one of each port; `ExpansionMayor` wraps `ScriptedMayor` and adds the options `richServices`, `avenues`, `highwayRing`, `alleys`, `seaport`, `airport`, `liftLocks`.

### 10.5 Measured

Step 7, `MEASURE=1 npx vitest run tests/expansion-measure.test.ts` (8 years, seeds 2091 / 7 / 31; M6 on `World.generate(seed)`, the rest on `flatWorld(seed)`; M8 on `fullyBuiltWorld()` + the fixture, 12 months). The regular suite holds B2, B3, B4, B10 and B13 for seed 2091 in `tests/expansion-balance.test.ts`.

**Tuned numbers.** Three §2.8 values changed; everything else is the spec's start point.

| Knob | Spec | Tuned | Why |
|---|---|---|---|
| `WEALTH.score.ind.base` | 0.20 | **0.22** | B4 money on seed 7 (M2 net +14% at 0.20, +42% at 0.22); B3's Fab share holds either way (71/38/49% at 0.20). Fab tiles only; the starter city stays all $. |
| `AIRPORT.comJobs` | 240 | **320** | B9: the flat scripted city is land-limited, so the Airport's noise costs Market density near it and +240 demand left jobsCom at +33 / +116 / +289. 320 (the terminal's own job count) gives +256 / +476 / +313. |
| Spaceport `noise` | v 0.7 r12 | **v 0.5 r8** | B11: the old ring cancelled the prestige it brings (land value within r20 +0.003); now +0.023 there. |

The fixture mayor M2 was rewritten (`RICH` rates in `tests/expansion-fixture.ts`): it packs its academies, plazas, clinics and precincts into the free cells of service blocks, where its services are missing, and takes a new block only while it has fewer service blocks than the plain mayor would. WP-1's M2 took a fresh 3×3 block for every plaza and trailed M1 by 9-12% in population for that reason alone (with tiers off it already trailed by 3-9%).

**Results** (2091 / 7 / 31):

| # | Target | Measured | Verdict |
|---|---|---|---|
| B1 | existing balance tests unchanged; starter city all $ | `tests/balance.test.ts` green, unchanged | met |
| B2 | M1 res+com $ 55-80%, $$ 20-40%, $$$ ≤ 8% | 59/35/7 · 58/36/6 · 63/32/5 | met |
| B3 | M2 $ ≤ 45%, $$ 35-60%, $$$ 12-30%; Fab $$+ ≥ 25% | 34/50/16, Fab 81% · 31/50/19, 39% · 30/51/19, 36% | met |
| B4 | M2 vs M1: net ≥ +20%, pop ≥ −3%, approval ≥ −2, 3k / 7k ≤ +30 d | net +33 / +42 / +33%; pop +22 / +25 / +25%; approval +7 / +10 / +8; 3k −136 / −126 / −116 d; 7k −22 / −181 / −149 d | met |
| B5 | M3 avgTraffic ≤ M1 × 0.88 | × 0.870 / 0.942 / 0.910 (8-seed mean 0.908) | **waived** (see below) |
| B6 | M4 ≤ M1 × 0.82; highway load > 0; no ramps → 0 | × 0.870 / 0.656 / 0.745 (mean 0.757); load 0.021 / 0.035 / 0.030; rampless ring 0 | load and rampless met; ratio met on the mean and 2 of 3 seeds (see below) |
| B7 | M5 alley crime − city 0.04-0.10; pop ≥ M1 | +0.076 / +0.047 / +0.074; pop −5.2 / −7.1 / −1.1% | crime met; **pop waived** (see below) |
| B8 | M6 jobsInd +150..+400 after 3 years; Port trade ≥ 150 | +486 (2091), n/a (7), +398 (31); trade 421 / — / 374 | trade met; jobs met on 31, 2091 above (see below) |
| B9 | M7 jobsCom +150..+500; land value 3 out −0.08..−0.20 | +256 / +476 / +313; −0.116 / −0.108 / −0.150 | met |
| B9b | Market 8-16 out at $$+ ≥ +15 pts | +30 / +26 / +44 pts | met |
| B10 | ≤ 4 tier changes per tile in the last 2 years | max 0 (M1 and M2, all seeds); tier steps happen in years 1-5 (M1 2091: 5, 0, 2, 11, 24, then 0 a year) | met |
| B11 | after completion: visitors ≥ 3,000 × mood; avgLandValue +0.03; net positive | visitors 2,996 vs 2,250; land value +0.023 within r20, **+0.009 city-wide**; net +16,591/mo (+16,408 while building) | visitors and net met; **land value waived** (see below) |
| B12 | §10.1 budgets on the fixture | step 0.86 ms, recomputeAll 1.17 ms (`tests/perf.test.ts` asserts the budgets); settleWealth 0.16-0.43 ms (WP-1) | met |
| B13 | alleys ≤ 60 Undertow, skyways ≤ 100 Kites | 60.0 and 100.0 at 100,000 each | met |

**Waivers and why.**

- **B5 (avenues).** Trips don't route in this sim: a lot sends its trips to its nearest road and smoothing spreads congestion one or two tiles. Widening the two central lines (88 of ~940 road tiles) only relieves the lots whose nearest road they are. The static effect on the finished M1 city is × 0.93 at capacity 480 and × 0.92 at 560; reaching × 0.88 in M3 needs about 3× a street (660: 8-seed mean 0.877), which would break the Avenue's "2× traffic" promise and crowd the Highway's 5×. Capacity stays 480. Seed 2091 meets it.
- **B6 (highway ring), honestly.** Seed 2091 misses (× 0.870). On the finished M1 city the same ring with only its 4 ramps *raises* avgTraffic × 1.11 (lots along the ring lose their frontage road and send their trips to the next street), so M4's lower means come from the 28-58 ramps the mayor's later street drags add across the ring and from a 6-9% smaller city; the highway does carry load (0.02-0.035) and a rampless ring carries exactly 0. No §2.8 number changed for it.
- **B7 population.** Added to a grown city, alleys raise population (+1.8 / +1.9 / +1.8% after 3 years on the M1 city: the ×1.1 affordable quarter). Built during growth (M5 from 1,200 residents), the alley rows densify less: L2 needs land value 0.35 and the rows beside an alley sit near 0.19 (alley −0.04, crime +0.06 through land value and the poverty feedback), and an L2 home holds 3.4× an L1 home, so the lost L2s outweigh +10% per tile. Removing the land-value term (`alleyLv` 0) moves the 12-seed mean from −3.5% to −0.3% with a ±7% spread between seeds, and no setting of `alleyLv` or `affordable` was ≥ M1 on every seed. Alleys are meant to be the cheap lever with a cost (§4.4), so the spec values stay.
- **B8 upper bound, seed 7.** Seed 7's generated map leaves the scripted grid mostly under water: it stalls at 1,414 residents and never reaches the Seaport unlock. On seeds 1-5 the Seaport adds +328 to +972 Fab jobs (land isn't scarce on generated maps); lowering `exportJobs` to 200 or 160 moved single seeds by ±300 without narrowing the spread, so it stays 260. A Seaport that brings more industry than the range is money for the player, not a hazard.
- **B11 city-wide land value.** Prestige max-combines with the fixture's other prestige buildings (5 Spires, 5 Arcologies), so a new r20 source moves the city mean little: +0.009 on the fixture, +0.010 on a flat M1 city with the Spaceport at its edge, even with the quieter ring. Within its radius it lifts land value by +0.023. Raising the radius to 28 still gives only +0.017 city-wide, so r20 stays.

**Performance and art (§10.1).**

- Sprite paint rate while panning (WP-4, instrumented builds, fixture save, DPR 1, zoom 1, a 12.6 s pan): cold cache 73 → 193 building sprites (5.7 → 15 per second, 33 → 92 ms in all), **2.6×**; a warm pass paints 0 → 0, so there is no cache thrash; cache memory 12 → 18 MB of 32 MB; fps unchanged. The cause is 3× the distinct bodies. **Accepted:** the paint is spread over the frame budget (`budgetMs`, with the previous sprite as fallback), happens once per body and scale bucket, and the spec's fallback (a lower `MAX_SPRITE_SCALE` for L1 bodies) changes neither the count nor anything at DPR 1 while it would blur small buildings on high-DPR phones.
- Skyway decks keep their own `SpriteCache` (6 MB cap, 1.5 ms paint budget) instead of the buildings' 32 MB one, because the two caches keep separate per-frame budgets (WP-3). Worst case 38 MB in all; measured 18 MB + under 1 MB.
- Frame (WP-3, headless software canvas, fixture): draw 2.4-5.8 ms against 2.6-4.1 ms before the expansion on the same save; the skyway layer 0.5 ms at 113 visible deck tiles, 0.8 ms at 198 at night (≈ 2.2-2.7 µs per tile, at the 0.8 ms / 300-tile line). Ports FX 0.07-0.12 ms. Not measured on a real phone.

**Saves and the single-file build** (`npm run build:single`, Chromium, 390×844 and 360×640 portrait, 844×390 landscape, touch): a fresh city from the start screen (one tap on Road lays streets; Chapter I title at day 20; the boot card answered by tap); a v1 and a v2 save through Continue (all Street, all $, then the settle: 81 / 48 / 31 developed tiles on the test city, `.v2` backup written once, re-saved as v3); a mid-game v3 save with every road kind, 300 skyway tiles and all three ports; a v4 save left intact (`.future` copy, the title says "This city was saved by a newer version. Reload to update.", no Continue, New City lifts the block). A **pre-expansion** build opened on a v3 save overwrites it (it predates rule 1 of §2.5); the mirror key (§2.5 rule 5) brings the city back on the next v3 load, checked in the browser with both builds on one origin. No console errors, no horizontal scroll.

---

## 11. Work packages

**Rules.** Step 0 lands first, alone. Then at most two agents run at once, in the waves below. Each package owns the files listed and edits nothing else. If a package needs a change in another package's file, it writes the request into its hand-off note and the integration step makes it. After Step 0 these are frozen: `types.ts`, `world.ts`, `events.ts`, `roads.ts`, `wealth.ts`, `ports.ts`, `skyway.ts` (except the `planSkyway` body), `buildingStats.ts`, the `PortView` interface in `sim/ports.ts`, `story/types.ts`, and the `TileInfo` shape. `config.ts` belongs to WP-1 (numbers only, no renames) and then to the integration step. Every package ends with `npm run typecheck` and `npm test` green.

### Step 0 · Shared contract (one agent)

**Owns:** `src/game/types.ts`, `src/game/config.ts`, `src/game/events.ts`, `src/game/world.ts`, `src/game/buildingStats.ts`; new `src/game/roads.ts`, `src/game/wealth.ts`, `src/game/ports.ts`, `src/game/skyway.ts` (helpers + `planSkyway` stub); new `src/game/sim/ports.ts` (`PortView` + zero stub) and, in `src/game/sim.ts`, only the `ports` getter and the `settleWealth` stub; in `src/game/game.ts`, only save safety (§2.5), `clockRate` and the `TileInfo` type; `src/game/story/types.ts` (Metric, SpotRule members, `Card.onDemand`, InspectAction ids); `src/game/story/director.ts` (`openOnDemand` only, §2.2); `src/game/story/content/vocab.ts` (PLAIN_METRICS); `src/game/story/conditions.ts` (metrics and formats); placeholder entries in `src/render/art/services.ts` (`SERVICE_PALS` / `SERVICE_RECIPES` for the 4 new types, reusing existing recipes) and `src/render/overlay.ts` (`EFFECT_RGB.education` only). Tests: new `tests/save-v3.test.ts`, `tests/roads.test.ts`, `tests/expansion-contract.test.ts`; updates to `tests/save.test.ts` and `tests/story/contract.test.ts` (§10.2).

**Builds:** everything in §2: types; config tables and building defs (with `meta`); `BUILDING_ORDER` insertion before `'stack'`; reactions, limits, power weights and turf affinity keys; `roads.ts` (`roadLinks`, `computeAccess` with the gap-only Pass B, `dragResult`, prices, `lostAccess`); `wealth.ts` (tables, `wealthScoreAt` from `world.fields`, `wealthTerms`, caps, `stepTarget`, `wealthInfo`); `ports.ts` (`shoreFacing` with the bridge/rail berth rule, `shoreSites`, berth, `noiseReach`); `skyway.ts` helpers incl. `skywayDocks` and `skyRampActive`; `World` (fields and mutators with the §2.1 invariants, `restoreTile`, `roadAdjMask`, `sky` / `skyVersion`, `wealthStreak`, `loadedVersion`, `moments`, kind-aware `roadMask` and `hasRoadAccess`, v3 serialize and the §2.3 / §2.5 decode rules); `buildingStats` (`jobsInd` split, construction zeroing for `buildDays` on non-stack types); the Game save guard and backups; `openOnDemand`; story metrics.

**Acceptance:** typecheck and all tests green; a streets-only sandbox plays exactly as before (balance tests unchanged); §10.2 tests 1–9 pass; the pace tests (`tests/story/pace.test.ts`, `pacing.test.ts`) still pass with `openOnDemand` present, and a test shows that opening and answering an `onDemand` card leaves `deckSec` and `frontSec` unchanged.

### Wave 1 (two agents)

#### WP-1 · Simulation
**Owns:** `src/game/sim.ts` (fills Step 0's stubs), `src/game/sim/*.ts` (grid, fields, growth, census, budget, power, advisor, tuning, incidents if needed, `ports.ts` body), `src/game/news.ts` (optional flavor lines), `src/game/config.ts` (numbers only). Tests: new `tests/sim-roads.test.ts`, `tests/wealth.test.ts`, `tests/ports-sim.test.ts`, new `tests/expansion-fixture.ts`; updates to `tests/budget.test.ts` (labels "Roads" and "Skyways"), `tests/fields.test.ts`, `tests/growth.test.ts`, `tests/perf.test.ts` (expansion fixture), `tests/sim-mods.test.ts` (:222, :224 assert the old "Roads & skyways" label).
**Builds:** SimGrid kinds, `computeAccess`, road signature with kinds, highway components and ramp reach, sky components, sky tile list, active-ramp reach and per-scan docks (cached `skyVersion` starts at −1, `scan(w, true)` forces), roadLv / roadCrime, `alleyNear`, edge points (inward links only), per-kind counts; FieldSystem traffic (§3.8), noise, hub (plateau) and sea (§3.9), `'education'` added to `EFFECTS`, wealth score (§4.2), road pollution by volume, crime and land value terms; `TRAFFIC_SCALE` from `ROAD_KINDS`; GrowthSystem tier latch and hysteresis with power reservation (§4.3), `wealthStreak`, `reachedWealth`; `settleWealth`; Census tier-aware counts with the affordable factor, `stats.wealth`, `tierEffect`, `avgNoise`, `roads`, `edgeLinks`, `visitors`, approval terms (§4.4); demand trade adds (ports, edges, visitors); budget tier-aware tax, "Roads", "Skyways", per-type plurals, `transport` jobs taxed, "Port trade", "Tourism", "Launch contracts"; power `zoneDraw(z, l, a, tier)`; `PortSystem` (counts, visitors, trade, spaceport countdown with the `waitSec` hold, `buildProgress`, art-step `markChanged`, completion news, `moment` events); advisor road-kind unlock news naming the tray, six wealth highlights, `hwnoramp` / `skyloose` / `noisehome` lines and `hint` events, the revised traffic and roads lines.
**Acceptance (each a test):** with streets only, traffic and `near` equal today's; a highway with no ramps carries 0 and one with ramps > 0, and streets near the ramp lose load; an avenue tile reads lower congestion than a street with the same trips; a lot 2 from a street and 1 from an alley sends its trips to the street; an alley-only lot two tiles away has no access; noise and hub values match §3.9; education is all zeros after its Academy is bulldozed or set offline; a dock goes away on the next step when its anchor is bulldozed, and appears when an anchor is placed under a deck (`skyTraffic` changes accordingly); hysteresis: a score oscillating inside the band never moves a tier; a new lot latches its potential tier and falls back under brownout; `settleWealth` raises a v2 city in one call and is deterministic; `recomputeAll` never changes structural fields; two identical runs of the expansion fixture give identical tiles, funds and stats; the spaceport holds at 1 day while `waitSec > 0`; ports add the specified demand and income lines; each `moment` fires once per city; perf within budget; all existing sim and balance tests green, and `tests/story/playthrough.test.ts`, `pacing.test.ts` and `pace.test.ts` still pass (population-driven chapter timing moves with tier capacity).

#### WP-2 · Actions, Game and story systems
**Owns:** `src/game/actions.ts`, `src/game/skyway.ts` (the `planSkyway` body), `src/game/game.ts` (everything but Step 0's parts), `src/game/story/vertical.ts` (skybridge vs skyway gap rule), `src/game/story/turf.ts` (§8.4), `src/game/story/factions.ts` (the new `powerWeight` terms only). Tests: new `tests/actions-roads.test.ts`, `tests/actions-ports.test.ts`, `tests/game-expansion.test.ts` (undo, refund, confirm flag, launches with a fake clock); updates to `tests/actions.test.ts`, `tests/fuzz.test.ts` (tool list), `tests/vertical.test.ts`, `tests/turf.test.ts`, `tests/story/conditions.test.ts` (powerWeight).
**Builds:** `planAction` / `applyAction` for the four road tools (§3.4: ramps, upgrades, cut notes, `lostAccess` and `confirm`, berth rule, water rules), the skyway tool (§3.7), the bulldoze layer rule (§3.6); `lockedReason` for road tools and skyway (population); building rules `needsRoad`, `maxCount`, `site: 'shore'` + `facing`, "Skyway in the way", `confirm` at `SAFETY.confirmCost`, `loudTiles`; `stackConnected` via `skywayDocks`; `Game`: sfx map, toasts with actions, `storyTool` (road kinds, skyway), `toolCost` (static and instance) for the new tools, `getTileInfo(x, y, sky?)` rows and notes (§7.4), `sim.ports` exposure, `inspectActions` `'rights'` and `'skyway'`, `openLaunchRights`, `demolishSkySegment`, undo and refund (§7.7), `waitSec` set at placement and counted down per unpaused frame, real-time launches and the first-launch lead (§5.3), the one-time `settleWealth` call for old saves; turf terms; power terms with caps.
**Acceptance (each a test):** every worked example in §3.4; converting a street with lots beside it reports `lostAccess` and `confirm`; upgrade costs equal price differences (land and water); smaller tools never shrink; ramps never on water; `plan.roadKinds`, `upgrades`, `ramps`, `skyMasks`, `layer` and `note` filled as specified, every note and reason ≤ 32 characters; skyway rules (24-tile cap, anchors only, gap tiles refused both ways, endpoint ramps only on Street/Avenue/Ramp ground, ramp bit cleared on extension); a highway drag under a sky ramp closes it, live and after a save round trip alike; bulldoze: a drag starting on a deck removes only sky, a drag starting on ground leaves sky; seaport facing order S, E, N, W, a berth with an existing bridge is refused, and every sampled generated seed has ≥ 2 shore sites; one airport and one spaceport max; locked tools refuse with "Locked: reach N residents"; undo restores tiles and credits inside 10 s and refuses after a tile changed; a building bulldozed within 30 s is refunded in full; no liftoff by day, launches ≥ 180 s apart, the first launch toasts 10 s ahead, a pending launch is dropped on world swap; Kites affinity ignores highway traffic; 1,000 alleys add exactly 60 Undertow weight; the Ch1 boot test still passes; fuzz test green with the new tools.

### Wave 2 (two agents)

Shared interfaces fixed before the wave: the `StreetTraffic` public API (§3.11) is frozen, so WP-4's `effects.ts` keeps driving WP-3's traffic unchanged; `serviceBuildingHeight` keeps its signature; skyway sprites use the existing `SpriteCache` with ids from `SKY_BASE`.

#### WP-3 · Ground, overlays, previews and street/sky vehicles
**Owns:** `src/render/ground.ts`, `src/render/overlay.ts`, `src/render/renderer.ts`, `src/render/art/traffic.ts`, new `src/render/art/skyway.ts`.
**Builds:** road kind art with the day/night highway look and the new colours, bridges per kind, ramps (white chevrons), touchdown chevrons, deck shadow strips, regional-road stubs (§3.10, §3.11); port aprons, the airport runway lights and the academy courtyard in `buildingPad`; glow passes (avenue, highway, alley flicker); `RoadAccessMap` via `computeAccess`; `conduits()` via `roadAdjMask`; Wealth (with pips) and Noise overlays (§7.3), traffic overlay under skyways; `roadGhost` from `plan.roadKinds` with `roadLinks`, lost-access red and loud-home amber tints, shore-site outlines, skyway ghost, berth and noise rings for ghosts and selection; the skyway segment sprite cache, the deferred-segment rule and dock portals in `drawObjects` (§3.7), headlight pairs and the single glow pass; car kinds, lanes, speeds and edge spawns.
**Acceptance:** visual check at 390×844 and 360×640, day and night, zoom 0.4 / 1 / 2.5: no seams, nothing clipped at `SPILL`; streets beside highways draw separate; a crossing with ramps draws an interchange; a scripted capture in the visual harness of a deck beside a 4×4 Stratablock and across the Airport shows the deck in front of the faces it passes and behind taller towers; the side-by-side capture of the five road kinds and a skyway is readable at zoom 0.5 by day and by night (§3.11); frame budget (§10.1) on the expansion fixture; no `shadowBlur`.

#### WP-4 · Building art and port FX
**Owns:** `src/render/buildings.ts`, `src/render/art/zones.ts`, `src/render/art/painter.ts`, `src/render/art/services.ts`, new `src/render/art/ports.ts`, `src/render/effects.ts`, `src/render/art/skytraffic.ts` (only if planes reuse its lanes).
**Builds:** the tier model ids with `palBit` kept, `LOT_BASE` / `SERVICE_BASE` rebase, the tier palettes, `Painter.tier` and `dressTier` (§4.5; props never raise a model's top); sprites for academy, seaport (4 facings), airport (terminal and tower only), spaceport (3 construction stages + complete), `serviceBuildingHeight` for each; ship, plane and launch FX wired into `Effects` (ground and sky phases), scaled by `game.clockRate`, the first ship or plane at opening, the rocket culled by its own screen box, listening to `liftoff`.
**Acceptance:** all 432 zone bodies render without errors in a sweep test; $ / $$ / $$$ are distinguishable at zoom 1 in a side-by-side capture, and a v2 city loaded before and after the update keeps its colour mix; sprite paint rate ≤ 1.2× today while panning a full map; ships never cross land or bridges; planes and launches pause with the sim; launches play only when `liftoff` fires.

### Wave 3 (two agents)

#### WP-5 · UI, input and audio
**Owns:** `src/ui/tools.ts`, `src/ui/dock.ts`, `src/ui/inspect.ts`, `src/ui/feedback.ts`, `src/ui/report.ts`, `src/ui/icons.ts`, `src/ui/ui.css`, `src/ui/ui.ts` (wiring), `src/ui/menu.ts` (help steps only), new `src/ui/tips.ts`, `src/ui/story/inspectStory.ts` (render the `'rights'` and `'skyway'` actions only; no other `src/ui/story` file, those belong to the pacing workflow), `src/input/input.ts`, `src/input/gestures.ts`, `src/input/keyboard.ts`, `src/audio/audio.ts`. Tests: new `tests/ui-catalogue.test.ts`; updates to `tests/input-gestures.test.ts` (the sky slab pick).
**Builds:** the hybrid Road category with the `dock.ts` changes (§7.2), the compact landscape tray, Infra relabel at the first port unlock with the new icon, the Civic and Sky orders, the "new" dots and tray names in unlock news and the banner (incl. road kinds and Skyway), the Data tray additions and `'tiers'` legend; `toolMeta` cases for avenue, highway, alley, skyway (never the Inspect fallback), per-tool meta lines and icons for the new tools, buildings and views (original SVG paths); the scroll fade; inspect note rows, the ticked Wealth meter, `HIGH_IS_GOOD` and the `transport` label; action-pill names, notes, refund and the ✓ / ✕ confirm flow in input (§7.7); toast action buttons (Undo, Watch → `camera.centerOnTile`); seaport site snap; zoom-to-fit for port tools; the sky slab pick (`PickFootprint.base`, `Selection.sky`); report rows (Wealth split, `tierEffect`, Visitors, Regional links); `moment` banners; first-use tips and `hint` tips with the one-at-a-time rule (§7.6, Appendix A); Help steps; `KeyR` cycling and `OVERLAY_CYCLE`; the launch audio cue.
**Acceptance:** every `ToolId` in `CATEGORIES` has its own `toolMeta` and icon; every `OverlayId` has an `OVERLAYS` entry; one tap on Road lays a street; switching Street → Avenue takes two taps (Road, Avenue) while a road tool is active; a costly building and a lost-access highway never build on lift; touch targets ≥ 44 px at 390 and 360 widths, portrait and landscape; no inspect row overflows at 360 px (§7.4); tips show one at a time and never over a tray, drag, story card or message banner; the help list reads correctly after the pacing workflow's menu changes.

#### WP-6 · Story content
**Owns:** new `src/game/story/content/cards/expansion.ts`, `cards/index.ts` (spreads), `content/factions.ts` (mood drivers, `POWER_TERMS` rows, PowerTerm `max`), `content/glossary.ts` (optional entry), `src/game/story/effects.ts` (the three new spot rules only), `tests/story/content-lint.test.ts` (the `DECK` and `CARDS` totals +11 each, `max` on power terms, the new spot rules), `docs/STORY.md` (§2.6 table rows and a short "Expansion cards" subsection pointing here).
**Builds:** §8.2 rows, the three spot rules and the eleven §8.3 cards, copy verbatim.
**Acceptance:** content lint green (lengths, banned terms, one default each, labels end in a period, `!` only in Nacre cards, no `$` in bodies, metrics in the closed list); each card is drawable in a test world that meets its `when` and spot; `ex.rights` opens through `openOnDemand` and through the deck; the playthrough test still reaches Ch6.

### Step 7 · Integration, balance and performance (one agent, last)

**Owns:** `src/game/config.ts` (expansion numbers), `tests/expansion-fixture.ts` (extends WP-1's), new `tests/expansion-measure.test.ts`, new `tests/expansion-balance.test.ts` (B4's population check in the regular suite), `public/sw.js` (`VERSION` bump), `docs/EXPANSION.md` §10.5, `docs/CONTRACTS.md` (an "Expansion layer" section: save v3 and save safety, the new modules, the new events, `openOnDemand`), `docs/DESIGN.md` (record the interview decisions in the table at the top of this doc), and small cross-package fixes from the hand-off notes.
**Builds:** runs §10.4, tunes §2.8 numbers to hit §10.3, records §10.5, checks `npm run build:single` and a single-file run, plays a v2 save and a fresh city on a phone-sized viewport.
**Acceptance:** every §10.3 target met or explicitly waived in §10.5 with a reason; all tests green; the single-file build loads a v1, a v2 and a v3 save, and a stale build opened on a v3 save leaves it intact.

### Order and dependencies

```
Step 0 ─► Wave 1: WP-1 Sim ∥ WP-2 Actions/Game ─► Wave 2: WP-3 Ground/overlays ∥ WP-4 Building art/FX
       ─► Wave 3: WP-5 UI/input/audio ∥ WP-6 Story content ─► Step 7 Integration
```

Inside Wave 1, WP-1 and WP-2 meet only through Step 0's frozen pieces (`PortView` and `Simulation.ports`, `settleWealth`, `world.wealthStreak`, `skywayDocks`, `TileInfo`), and WP-1's fixture uses World mutators only. WP-3 and WP-5 consume WP-2's plan fields; WP-3 and WP-4 consume WP-1's fields (`noise`, `skyTraffic`, `wealth`, `hub`) and events; WP-6 needs only Step 0's metrics, spot-rule types and `openOnDemand`, so it can swap into any wave if an agent slot frees early.

---

## Appendix A · Tip copy (one line each, ≤ 110 chars)

| id | Text |
|---|---|
| avenue | Avenues carry twice a street's traffic. Drag one over a street to widen it: you pay the difference. |
| highway | Highways carry 5× the traffic, but no lots. Cross one with a street for ramps; run it off the map for trade. |
| alley | Back alleys are cheap. Homes beside them stay affordable and hold more people, but crime rises. |
| skyway | Skyways carry cars over anything. End one on a street for a ramp, or run it into a megastructure. |
| seaport | Pick a highlighted shore: one side on open water. Ships bring Fab trade, and some noise. |
| airport | Runways are loud: keep homes back. Shops 8 to 16 tiles away do better business. |
| spaceport | The tower takes 240 days and at least 4 minutes to rise. Tap it to choose who holds launch rights. |
| academy | Schools lift nearby blocks toward $$ and $$$, and turn Fab Districts clean. |
| wealth (sim) | Blocks are getting richer. Data → Wealth shows $, $$ and $$$; tap a block to see what lifts it. |
| ramps (sim) | Your highway has no on-ramps, so nothing uses it. Drag a street across it. |
| noise (sim) | Noise from highways and runways is pulling homes down. Tap a block to see why. |

## Appendix B · News and advisor lines

| Key | Kind | Cooldown | Text |
|---|---|---|---|
| unlock (per road kind / skyway) | info | once | "Unlocked: {Name} ({Tray}). {desc}" |
| hwnoramp | warn | 120 d | "Advisor: a highway with no on-ramps carries nothing. Drag a street across it to add them." |
| skyloose | info | 180 d | "Advisor: a skyway that lands nowhere carries nothing. End it on a street or run it into a megastructure." |
| noisehome | warn | 150 d (when avgNoise over Hab Blocks > 0.35) | "Advisor: noise from highways and runways is dragging down nearby Hab Blocks. Keep homes back, or add Plazas." |
| roads (revised) | warn | 60 d | "Advisor: {n} zoned lots have no usable road. Streets reach 3 tiles, alleys 1, highways none." |
| traffic (revised) | warn | 75 d | "Advisor: gridlock on the main drags. Widen them into Avenues{, or run a Highway with on-ramps}." (each clause only once unlocked; the Maglev clause stays as a fallback before 1,500 pop) |
| first $$ res | good | once | "Window boxes and working lifts: the first $$ Hab Blocks in {city}." |
| first $$$ res | good | once | "Glass balconies, private lifts: the first $$$ Hab Blocks in {city}. Land value did that." |
| first $$ com | good | once | "The noodle bars get real chairs. First $$ Market Strip." |
| first $$$ com | good | once | "A boutique with no prices on anything: the first $$$ Market Strip." |
| first $$ ind | info | once | "Cleaner lines, better pay: the first $$ Fab District." |
| first $$$ ind | good | once | "A fab so clean it has a lobby: the first $$$ Fab District. The smog lifts a little." |
| spaceport done | good | once per spaceport | "The {city} Spaceport is finished. The first launch goes up on the next clear night." |
| launch (rotating) | info | at each visible liftoff (≥ 180 s apart) | "Launch night: a cargo lifter climbs out of {city} on a column of light." / "Another launch. Half of shadeside is on the roofs to watch it go." / "The spaceport lights the low clouds orange for eleven seconds. Then it's gone." |

The wealth highlights use the advisor's existing once-per-session `seen` set, primed from current tier counts so a loaded city doesn't replay them.

## Appendix C · Decisions on the review

Every high and medium review point is resolved in the sections above. These are the points this revision rejected or resolved differently, with the reason:

1. **Approval squeeze over 45% $$$ (dropped).** It was invisible in the report, and the only way to lower the $$$ share was to make districts worse. The owner's standing decision is that late-game money is the reward. The social cost of a rich city now lives in the story, where it is explained (Board mood "Priced out", `ex.pricedout`), and the player gets a positive lever instead: back alleys make affordable quarters (§4.4). This also gives alleys a sandbox reason to exist.
2. **B9b "≤ 10% of Market tiles at $$ with no airport" (rephrased).** Measured: 23-28% of a scripted city's Market tiles already have land value 0.34 or more with no airport, so that baseline is false. B9b compares the same tiles with and without the airport (+15 points).
3. **Seaport "or fill one off-tile per side at extra cost" (not needed).** Measured on 30 generated seeds: 26-66 valid top-left positions on every seed. Highlighting and snapping (§5.1) solve the finding problem; flat maps show "No straight shore here".
4. **Launch rhythm.** The review offered "one per visual night" with day/night on and "≥ 180 s" with it off. Both rules apply in both modes (night and ≥ 180 s), so speed 3's 100-second day cycle can't double the rate.
5. **Old saves gentrifying in a wave.** Chose the one-time batch (`settleWealth`) over a per-tick cap: deterministic, one visible change at load, no throttled backlog. Separately, `setWealth` no longer emits `'tiles'` (tier art is sprite-only), which removes the repaint cost for all tier steps.
6. **Sky ramps over converted ground.** Chose "a ramp is active only while its ground qualifies, and the bit is kept" over "refuse to change a tile under a ramp": a highway drag along a street should not be blocked by a ramp somewhere on it. The pill note "Closes 1 skyway ramp", the barrier art and inspect explain it.
7. **Launch-rights fallback.** The on-demand button is primary and the weight-30 deck entry catches players who never tap it. The +0d queue is kept only as the fallback if `openOnDemand` can't meet the pacing contract, because it would push an unprompted card at the moment of placement.
8. **Tier step speed.** Beyond the review's real-time table, the hysteresis streak goes from 3 to 5 samples (one step ≈ 15 s at speed 1), so tiers move at the pace of density growth. Feedback no longer depends on steps: the meter and pips move immediately.
9. **Skyway unlock at 12,000, not 15,000.** 12,000 is the Megacity milestone (so the banner announces it) and the Airport, its first new anchor, unlocks there too. It is still 3,000 after the Skybridge and Ribbon Rail fallback, and it now looks and lives elsewhere (Sky tray, magenta, car lights).
10. **Highway moved to 5,000 (not only the ports).** With Avenue at 1,500 the early game gets three expansion unlocks before 3,000 instead of five, matching the owner's "too fast".
11. **Kites skyway power cap (added).** Not in the review, but the same reasoning as the alley cap applies.
12. **No undo for bulldoze.** Buildings get the 30-second refund; bulldozed roads cost only their price to re-lay. A multi-step history was rejected as scope.
