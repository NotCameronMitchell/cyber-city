# Cyber City: Megacity spec, "Districts, Scale, Skybridges and Variety"

This is the binding implementation spec for the owner's feedback after a nearly full playthrough:

> "The map needs to be bigger, or you should be able to expand to a new area of your choosing (another grid like the starting one) after each chapter.
> Houses don't hold enough people, it doesn't feel realistic, businesses don't provide enough jobs, etc. just doesn't feel realistic.
> Skybridges feel clunky.
> I love the corp towers and the other similar structures but they need more personality, different architecture, etc.
> More variety is the biggest thing I think."

It covers **districts** (a 3×3 grid of 64×64 areas; the player annexes one after each chapter and can buy the last two in the sandbox), **megacity scale** (ten times the people and jobs per building, every threshold rescaled, per-tile economics unchanged), a **skybridge rework** (tap a tower, tap a partner; clear rules drawn on the map; visible payoff; faction skins; Sky Lobbies), and **variety** (merged parcels and a modular building kit with per-district styles, six faction architecture languages, new landmarks and civic buildings, crowds, weather, vehicles, city events). It ends with the phone UI, story hooks, performance, saves, balance and the work packages. Section 2 holds the measurements every size and budget decision rests on; Appendix C lists the alternatives this spec rejected, with reasons.

**Precedence.** `docs/DESIGN.md` (owner decisions) wins over this doc. `docs/STORY.md` stays the binding story spec, `docs/EXPANSION.md` the binding spec for roads, wealth and ports; this doc only adds to them (deck cards, metrics, effects, mood rows, build reactions, power terms) and rescales their population numbers (§4). `docs/CONTRACTS.md`, `docs/STORY-CONTRACT.md` and `docs/PACING.md` still hold; §3.2 and §11 list the additive changes.

**Owner decisions this doc implements (follow-up interview, binding):**

| Topic | Decision |
|---|---|
| Map | "Unlock new districts". After each chapter the player chooses an **adjacent** area the same size as the start map (64×64) to annex. Each district has its own terrain and character. In the sandbox the player can buy more districts with credits. |
| Scale | "Megacity". Dense blocks house thousands, megastructures tens of thousands, a big city reaches millions; jobs scale to match; every population goal, unlock, story threshold and price is rescaled to fit. |
| Skybridges | All four were clunky: placing them (fiddly drag), where they're allowed (confusing, strict), how they look, and why build them (unclear payoff). Rework all four, and make their relation to Skyways crystal clear. |
| Variety (the biggest thing) | No clone buildings; corp tower personality (each faction's towers, crowns and megastructures get distinct architecture; keep what works and deepen it); unique landmarks and more service/civic types; life and atmosphere (crowds, weather, more vehicles, district character, city events). |
| Standing decisions | No losing. Late-game money is the reward (no levies, no treasury-scaled prices). Story cadences are unpaused real seconds (docs/PACING.md) and nothing here adds an interruption. Calendar and growth speed are fine. Phone first (390×844, 360×640, 844×390; 44 px targets; one thumb; the toolbar keeps its 9 categories). Performance on mid-range phones is a hard constraint. |

**Preconditions.** Implementation starts after the expansion (docs/EXPANSION.md, save v3) has fully landed, including its Step 7. Every edit here to a file the expansion or the pacing workflow owns is **additive** (new union members, new rows, new keys, new optional fields) except the explicitly listed rescaled numbers (§4.4) and `MAP_SIZE` (§3.1). This update writes **save version 4**.

**IP and copy.** Every new name is original or a generic term (District, Charter, Skybridge, Sky Lobby, Pump House, Floodwatch Station, Metro Station, Arena, Beacon…). Player-facing copy in any file follows STORY.md §1.4 (voice and the banned-term list, which bans *deck*, *shell*, *ghost*, *construct*, *delta* and others as whole words, so no screen name uses them) and EXPANSION's copy rules (no `$` in story bodies). Internal art words in this doc (impostor, kit, skin, deck…) never reach the screen. **Spoiler guard:** no district, landmark, lobby or card text visible before Chapter V mentions gates, sealing, "complying" or the death toll (§8.6 adds a lint).

**Words.** On screen a **District** is one 64×64 area (owner's word) with a proper name ("Kessel Flats"); the existing `{district}` story token keeps naming the small 8×8 neighbourhoods ("Rivet Row") and is called a *neighbourhood* in this doc. Copy never says "a district" next to Fab District zoning without the proper name. In code the 64×64 unit is a **slot** (`SlotId`), its archetype a `DistrictKind`.

**Notation.** As EXPANSION: CR credits, d sim days (speed 1 = 2 d/s, speed 3 = 16 d/s), r a Chebyshev radius in tiles, story effects in STORY.md §0 notation. "×10 units" marks a number already multiplied by `POP_SCALE` (§4). Measured times are Node 22 on the shared 4-core dev container (§2.1); "phone" estimates multiply them by 3.5 (an assumption Step 9 checks on a device).

---

## 1. Overview and player fantasy

### 1.1 Features

| Feature | Player fantasy | What the player does |
|---|---|---|
| **Districts** | "My city spills over the bay onto the islands, down into the drowned quarter, up the lamplit hills. I chose each step, and every district feels like a different place." | After each chapter a **charter** arrives with the chapter reward. Open the **City map**, look at the districts next to the city (terrain preview, perks, hazards, who lobbies for it), tap **Annex**. The fog lifts and new land joins the city. In the sandbox, buy the last districts with credits. |
| **Megacity scale** | "A tower of 1,500 people, a 2×2 block of 6,000, a Stratablock of 20,000, a city of two million. The numbers finally sound like a city." | Nothing new to learn: every head count is ten times bigger, and taxes, traffic and power per building are exactly what they were. Inspect shows floors, homes and jobs per building; the City map shows each district's census. |
| **Skybridges v2** | "Glass walkways between my towers, crowded at night, each one built by a different faction. Three towers linked make a Sky Lobby and tourists come to walk it." | Pick Skybridge, tap a tower: the lanes it can bridge along light up and every valid partner glows with its price; tap a partner. Towers that don't line up get a two-bridge route through a tower between them. The pill and inspect show walkers, cars saved and land value. |
| **Building variety** | "No two blocks look alike. Dense corners merge into podium towers; each district has its own materials and roofs." | Nothing to do: zone tiles that match merge into 2×1, 1×2 and 2×2 parcels; a modular kit and a district style pick each building's silhouette, roof, facade and signs. |
| **Faction architecture** | "I can tell a Basalt tower from a Nacre tower from across the bay." | Choose a sponsor when placing a Corp Spire; pick a crown look when raising a Stratablock crown; faction buildings and landmarks come in several designs. |
| **Landmarks and civic** | "A lighthouse on the islands, an arena that fills on match nights, a lookout ring on my tallest towers." | Ten unique landmarks with unlock conditions; ten new repeatable service and utility types (§6.3). |
| **Life and atmosphere** | "Crowds under umbrellas, fog on the marsh at dawn, buses and water taxis, a night market lighting up the alleys." | Settings → Weather (Full / Light / Off) and Crowds; city events happen by themselves now and then, announced by one ticker line. |

### 1.2 How they interlock

```
 Chapter reward ──► +1 charter ──► City map: adjacent districts (terrain, perks, hazards, lobbyists)
                                         │ annex (favor to lobbyists, lease choices)
                                         ▼
   new land ──► more homes/jobs (×10 units) ──► money (per tile unchanged; more tiles = more income)
     │   │                                            │
     │   └─ district perks / hazards (layers, costs) ─┤
     │                                                ▼
     │                                   landmarks, megastructures, faction architecture
     ▼                                                │
 district style ──► building kit + parcels ───────────┤ (tall towers)
                                                      ▼
                                skybridges ──► Sky Lobbies ──► visitors, land value, fewer car trips
                                                      │
 crowds, vehicles, weather, city events ◄─────────────┘ (read the same city: Market tiles, plazas, arena, stations)
```

The loops the player feels:

1. **Growth loop.** Chapters give charters; charters give land; land gives people and money; money buys landmarks and megastructures; the sandbox sells the last districts.
2. **Character loop.** Each district changes what is cheap, what is hard and what the city looks like there. Where the player annexes decides who is pleased (lobbyists) and which landmarks open (the Beacon needs the Shoals, the Hullhouse the Sunk).
3. **Skyline loop.** Dense, well-served blocks reach level 3 and merge into tall parcels; tall towers become skybridge anchors; linked towers form Sky Lobbies that pay back in visitors and land value, which keeps blocks dense and rich.

### 1.3 The first ten minutes and the late game

| | First 10 minutes | Middle (Ch2–Ch5) | Late game and sandbox |
|---|---|---|---|
| Map | **Exactly today's start map** (Charter Shore, same generator). Just past each edge the neighbouring districts show as fog with a dashed border: there is more out there. | One charter per chapter: 5 more districts by the end of Ch5. | The ending grants a sixth charter (7 districts). Districts 8 and 9 cost 250,000 and 400,000 CR. |
| Numbers | ×10 units from the first lot: "Reach 6,000 residents", an L1 walk-up holds 140. Taxes, traffic, power and growth speed are unchanged. | Towers of 1,500, 2×2 parcels of 6,000, Stratablocks of 20,000. | 1–4 M residents; milestones Night Harbour (600k), Million Lamps (1M), Lantern Coast (2M). |
| Buildings | The kit and parcels from the first block; floors and homes in inspect. | Faction crowns with three looks each; Spire sponsors; district styles. | Faction landmarks (Charter Hall, Hexworks, Pearl Atrium, Kite Mast…), Arena, Halo Lookout. |
| Links | (Skybridges unlock at the Ch3 reward as today.) | Skybridge v2 tap flow, Sky Lobbies. | Lobby of 5+ unlocks the Halo Lookout. |
| Life | Crowds, more vehicle kinds, fog mornings and rain, from the start. | City events begin after 10 minutes of play (one ticker line each). | Arena nights, lantern festivals, boats in every canal. |
| Story | Unchanged. No new card or choice before the first charter. | District cards in the relaxed deck (once each); lobby lines on the City map. | Landmark cards; annex reactions. |

### 1.4 Pace in real time

Every new cadence, in unpaused real seconds unless it is a sim-world process (stated in sim days, like growth, which the owner called fine).

| What | Rule | Speed 1 | Speed 3 | Reads as |
|---|---|---|---|---|
| Charter arrival | with each chapter reward message (chapter floor 1,440 s on Relaxed) | ≥ 24 min apart | ≥ 24 min apart | a reward, waiting in the message the player opens |
| Annex | player-initiated; camera fly 1.2 s (tap skips), fog lift 1.5 s, then the once-per-district banner | — | — | a celebration, never an interruption |
| Pump House reclamation | 3 rings × 30 sim d | 45 s | 6 s | land rising out of the canals |
| King tides (Shoals) | 2 × a sim year, 20 d each | 10 s | 1.3 s | weather, like seasons |
| City events | first after 600 s; then every 420–900 s; 90–180 s each; at most one at a time; one ticker line | 7–15 min | 7–15 min | something happening in the city |
| District / landmark deck cards | the pace's deck gaps (PACING.md); all 11 are `once` | rare | rare | — |
| Sky Lobby banner | once per lobby, when it first reaches 3 towers | — | — | a small celebration |
| Fog mornings | visual clock 05:00–09:00, on 60% of days in a foggy district in view, 25% elsewhere | per visual day | per visual day | atmosphere |
| Skybridge undo | 10 s wall clock (EXPANSION §7.7 rule extended) | 10 s | 10 s | — |

---

## 2. Measurements (the numbers behind the decisions)

### 2.1 Method

Scripts in `/tmp/claude-megacity/` (Appendix D) copy `src/`, patch `MAP_SIZE` to 64, 128, 192 or 256, bundle with esbuild and run in Node 22. Worlds are filled like `fullyBuiltWorld()` per 64×64 slot (a road every 4 tiles, every 3×3 block zoned at levels 1–3, a reactor every 9th block, a service every 7th), either in **every** slot ("full"), only the **centre** slot ("1 of N", the other slots plain empty land, i.e. what a locked district costs today), or the centre and its 4 edge neighbours ("5 of 9"). The container is shared with other agents (load average 5–9 on 4 cores), so every timing is **best of 8 batches** (60 steps or 5 `recomputeAll` each), with the median alongside. Residents are in today's units (×1).

### 2.2 The current sim on bigger worlds

| World | Built | Residents (×1) | `step()` min / median ms | `recomputeAll()` min / median ms |
|---|---|---|---|---|
| 64×64 (today) | full | 48,374 | **0.78** / 1.05 | **1.32** / 1.89 |
| 128×128 | 1 of 4 | 48,743 | 1.56 / 2.25 | 3.13 / 3.58 |
| 128×128 | full | 193,668 | 3.03 / 4.46 | 4.95 / 5.24 |
| 192×192 | 1 of 9 | 48,839 | **3.65** / 3.92 | 7.00 / 9.55 |
| 192×192 | 5 of 9 | 241,626 | 5.38 / 6.58 | 9.74 / 10.14 |
| 192×192 | full | 435,882 | **6.87** / 7.50 | **11.90** / 12.36 |
| 256×256 | 1 of 16 | 48,459 | 5.74 / 5.91 | 13.34 / 13.78 |
| 256×256 | 5 of 16 | 241,779 | 7.41 / 8.43 | 14.82 / 16.56 |
| 256×256 | full | 775,450 | **13.94** / 14.97 | **22.97** / 24.54 |

Single-pass costs (ms, one call each, first run; the shape matters more than the digits):

| Pass | 64 full | 192, 1 of 9 | 192 full | Scales with |
|---|---|---|---|---|
| `grid.scan(force)` | 0.28 | 1.40 | 2.43 | area |
| `power.compute` | 0.20 | 0.53 | 1.56 | conductors (every tick) |
| `fields.coverage` | 0.05 | 0.14 | 0.49 | buildings × radius² (every tick) |
| `fields.traffic` | 0.10 | 0.44 | 0.82 | area + roads |
| `fields.pollution` | 0.11 | 0.87 | 0.85 | **area** (3 blur passes) |
| `fields.neighbourhood` | 0.08 | 0.73 | 0.67 | **area** (blurs) |
| `fields.landValue` | 0.08 | 0.65 | 0.52 | **area** |
| `fields.crime` | 0.05 | 0.43 | 0.31 | **area** |
| `fields.wealthScore`, `census.*`, budget | 0.07 | 0.07 | 0.73 | content |

Share of `step()` at 192 full (top-level systems wrapped): power 29%, coverage 10%, traffic 8%, pollution 8%, growth 8%, census 9%, scan 6%, neighbourhood 6%, land value 5%, crime 4%.

### 2.3 What locked land costs

A 192×192 world with one built slot costs **3.65 ms a step against 0.78** for the same city on today's map: 2.9 ms of pure empty area (the blur and per-tile passes run over all 36,864 tiles every other tick), and its `recomputeAll` 7.0 ms against 1.3. The story director's month end is area-bound too:

| `onMonth` part (best of 8) | 64 full | 192 full | 192, 1 of 9 (median of month ends) |
|---|---|---|---|
| `turf.update` | 0.84 | 7.07 | — |
| `turf.refreshStats` | 0.13 | 1.14 | — |
| `vertical.refresh` | 0.08 | 0.77 | — |
| `composeLayers` | 0.07 | 1.01 | — |
| whole `onMonth` | **1.24** | **9.43** | 9.73 |

So every O(area) loop in the sim and the story layer must skip locked slots (§3.3).

### 2.4 Prototype optimisations (measured)

A throwaway patch in the scratch copy (`/tmp/claude-megacity/opt`) did four things: label power components only when the conductor set changes (a signature over road/zone/building tiles); skip the brownout allocation BFS when no component is short of power; recompute coverage only when the set of powered, online service buildings changes; spread the field passes over 4 phases instead of 2 (traffic | pollution + noise | neighbourhood + land value | crime + wealth score).

| World | Built | `step()` min / median ms | vs today's code | `recomputeAll()` min / median |
|---|---|---|---|---|
| 64×64 | full | **0.41** / 0.53 | −47% | 1.12 / 1.26 |
| 192×192 | 1 of 9 | 2.00 / 2.29 | −45% | 6.63 / 6.87 |
| 192×192 | 5 of 9 | 3.33 / 3.69 | −38% | 9.08 / 9.69 |
| 192×192 | full | **4.11** / 4.86 | −40% | 9.85 / 11.13 |

Skipping locked slots (not prototyped; it removes exactly the empty-area cost of §2.3) brings "1 of 9" to the 64-full figure (≈ 0.45 ms with the caches) and "5 of 9" to about 5/9 of full.

### 2.5 Saves and the view

| | 64 full | 192 full (9 districts) |
|---|---|---|
| Save JSON | 31 KB | 254 KB |
| `serialize` + `stringify` | 0.3 ms | 2.3 ms |
| `parse` + `deserialize` | 1.3 ms | 8.9 ms |
| Alternative: structural RLE + base64 variant bytes | 25 KB | 210 KB (−17%: not worth a second format) |

Tiles the depth sweep (`drawObjects`, bounding box + 10-tile margin) iterates, and tiles actually on screen, from `camera.ts` itself:

| Zoom | 64 map, portrait 390×844 | 64 map, landscape 844×390 | 192 map, portrait | 192 map, landscape |
|---|---|---|---|---|
| 0.25 (today's min) | 4,096 / 2,614 | 4,096 / 3,775 | 23,104 / **5,431** | 15,376 / 5,297 |
| 0.4 | 4,096 / 1,840 | 4,096 / 2,109 | 10,816 / **2,195** | 7,396 / 2,111 |
| 0.55 (LOD) | 4,096 / 1,213 | 4,096 / 1,151 | 6,724 / 1,213 | 4,624 / 1,151 |
| 1 | 2,916 / 413 | 2,304 / 391 | 2,916 / 413 | 2,304 / 391 |

The ground cache's pinned whole-map overview bucket (`OVERVIEW_SCALE` 0.235 device px per world px) is about 963×481 px (2 chunks, ≈ 2 MB) on 64×64 and would be 2,888×1,444 px (18 chunks of 512 px, ≈ 19 MB) on 192×192: most of the 24 MB ground budget.

### 2.6 Decisions these numbers make

1. **The world is a fixed 3×3 grid of 64×64 slots, 192×192 tiles** (§3.1). Fully built (9 districts) the prototype sim takes 4.1–4.9 ms a step in Node, ≈ 15 ms on a phone: at speed 3 (16 steps a second) about 25% of a phone core. A 4×4 grid (256×256) costs 14–15 ms today and ≈ 8 ms optimised, ≈ 28 ms on a phone, 45% of a core at speed 3, plus 23 ms `recomputeAll`s: rejected.
2. **Locked slots cost nothing**: every O(area) loop in the sim, the turf and layer code iterates only the owned slots' row segments (§3.3, O1).
3. **Caches and staggering** as prototyped (O2–O4): −40 to −47%.
4. **`recomputeAround(rect)`** replaces `recomputeAll` after a player action (O5): `recomputeAll` stays 10–12 ms at 9 districts (35–40 ms on a phone), which would hitch every drag.
5. **Turf affinity only where it is read** (owned and frontier tiles) and layers composed over owned segments (O6): `onMonth` ≤ 3 ms at 9 districts.
6. **Saves keep today's number arrays** but store only owned slots: ≤ 320 KB for 9 districts, under 3 ms to write (§3.10).
7. **Render:** below zoom 0.4 a multi-district city switches to the **atlas** (one cached impostor per district) instead of drawing up to 5,400 tiles; 0.4 keeps on-screen tiles at 2,195, inside today's worst case (2,614–3,775 at 0.25). The overview bucket covers only the owned bounding box at a scale that keeps it near 2 MB (§3.9).
8. **Sleeping districts are not needed** at these numbers; they stay a documented fallback (O8) if the on-device check in Step 9 misses a budget.

---
## 3. Districts

### 3.1 World model: a fixed 3×3 grid of slots

The world is **3×3 slots of 64×64 tiles: `MAP_SIZE` = 192**, index `y * 192 + x` as today. The start district is the **centre slot** (slot 4, tiles 64..127 in both axes), so the first annex can go any of four ways and every slot is reachable through edge-adjacency. Slots the player does not own are **locked**: terrain only, generated from the seed, never saved, never simulated (§3.3), drawn as fog (§3.9).

Why this and not the alternatives (numbers from §2):

| Option | Verdict |
|---|---|
| **Fixed 3×3 grid, locked slots inert** (chosen) | Indices, saves and every `y * N + x` loop keep one stride for the life of a city; a migrated v3 city sits at a fixed offset (64, 64). With owned-segment loops (O1) a 1-district city costs what it costs today (0.41–0.78 ms a step); 9 fully built districts cost 4.1–4.9 ms in Node (≈ 15 ms phone). |
| Growing world (arrays resized on annex) | Every annex would change the stride: all typed arrays reallocated, every stored tile index (turf, rail, sky, story spots, seam, locals, railOut, links, buildings) remapped mid-game, every cache rebuilt. A migration bug would corrupt a live city. Rejected. |
| 4×4 grid (256×256), start off-centre | 16 slots = 7 story + 9 to buy, but 14–15 ms a step fully built today, ≈ 8 ms optimised (≈ 28 ms phone, 45% of a core at speed 3), 23 ms `recomputeAll`, 454 KB saves. Rejected for phones. |
| Slot-major indexing (each slot a contiguous 4096 block) | Old indices would map by a constant offset, but every neighbour access (i ± 1, i ± N) in the sim and renderer would need slot arithmetic. Rejected. |
| Separate 64×64 sims per district | Roads, power, services, traffic, turf and skybridges all cross borders; separate sims would need border exchange for each. Rejected. |

**Nine districts in all:** the start, five charters from chapters I–V, one from the ending, and **two bought in the sandbox**. The owner asked for "after each chapter"; Chapter VI ends in the ending, so its charter comes with the ending.

### 3.2 Data model (Step 0b)

#### `src/game/types.ts` (additive except `MAP_SIZE`)

```ts
/** District slots (MEGACITY §3.1). */
export const SLOT = 64;
export const SLOTS = 3;
/** World side in tiles (was 64). Index = y * MAP_SIZE + x. */
export const MAP_SIZE = SLOT * SLOTS; // 192
/** Map side of v1–v3 saves. */
export const LEGACY_SIZE = 64;
/** Slot id = sy * SLOTS + sx. */
export type SlotId = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
export const START_SLOT: SlotId = 4;

export type DistrictKind = 'shore' | 'shoals' | 'sunk' | 'flats' | 'terraces' | 'reedmere' | 'skeleton' | 'tarmac' | 'bazaar';
export const DISTRICT_KINDS: readonly DistrictKind[] = ['shore', 'shoals', 'sunk', 'flats', 'terraces', 'reedmere', 'skeleton', 'tarmac', 'bazaar'];

/** Ground feature of a land tile (tile bits 22-23). What it does depends on the district (§3.7). */
export enum Ground { Plain = 0, Reed = 1, Brownfield = 2, Rubble = 3 }

export interface Tile {
  /* …existing… */
  /** Terrace step 0..3 (Lantern Terraces; 0 elsewhere and on water). Saved in bits 20-21. */
  elev: number;
  /** Ground feature (bits 22-23). Plain on water. */
  ground: Ground;
}

export type BuildingType = /* …existing… */
  // Services and utilities (§6.3)
  | 'floodwatch' | 'pumphouse' | 'canopypark' | 'medtower' | 'reclaim' | 'metro' | 'markethall'
  | 'tidal' | 'geothermal' | 'datavault'
  // Landmarks, one each (§6.3)
  | 'charterhall' | 'hexworks' | 'pearlatrium' | 'hullhouse' | 'kitemast' | 'lampchoir'
  | 'beacon' | 'arena' | 'halolookout' | 'terminal'
  // Skeleton Row's unfinished frames (inert until finished)
  | 'frame';

export type ServiceEffect = /* …existing… */ | 'resilience' | 'filter';

export interface Building {
  /* …existing… */
  /** Corp Spire only: who paid for it (§6.2). Missing on old saves → 'nacre' (today's power weights). */
  sponsor?: 'basalt' | 'nacre' | 'none';
  /** Faction building, crown or landmark design 0..2 (0..3 on a Spire, §6.2). Missing → hash of the id. */
  look?: 0 | 1 | 2 | 3;
  /** Pump House only: reclamation days left (90 → 0), then it becomes a pump garden. */
  reclaim?: number;
}

export interface Fields {
  /* …existing… */
  /** 0..1 Floodwatch coverage (cancels king tides and floodplain caps). */
  resilience: Float32Array;
  /** 0..1 Reclaim Works coverage (pollution × (1 − 0.25 × filter)). */
  filter: Float32Array;
}

export interface DistrictCensus { slot: SlotId; kind: DistrictKind; residents: number; jobs: number; developed: number; avgLandValue: number }

export interface CityStats {
  /* …existing… */
  /** Owned districts, in annex order. */
  districts: DistrictCensus[];
  /** Skybridge clusters of ≥ 3 towers (§5.5). */
  skyLobbies: { count: number; largest: number; visitors: number };
}

export interface Selection { /* …existing… */ /** A skybridge tube was tapped (§5.4). */ link?: number }

export interface BridgePayoff {
  /** People a day walking the bridge: 0.2 × (residents + jobs of both anchors). */
  walkers: number;
  /** Car trips a day the two towers no longer make (20%, 25% inside a Sky Lobby). */
  tripsCut: number;
  /** Tiles that gain +5% land value. */
  lvTiles: number;
  /** The Sky Lobby this bridge forms or joins (k ≥ 3), else null. */
  lobby: { k: number; name: string; visitors: number } | null;
}

export interface ActionPlan {
  /* …existing… */
  /** Skybridge: what this bridge pays (§5.5). */
  bridge?: BridgePayoff;
  /** Skybridge: a two-bridge route through this tower (§5.4). */
  route?: { via: { x: number; y: number }; second: { ax: number; ay: number; bx: number; by: number; gap: number } };
  /** The first locked slot the plan touched (the pill's "Map" action, §3.4). */
  slot?: SlotId;
}

export interface DistrictSave {
  kinds: DistrictKind[];
  owned: SlotId[];
  charters: number;
  bought: number;
  annexedAt: number[];
  /** The annex-sheet lease (Tarmac Reach only, §3.7). */
  leases?: { tarmac?: 'nacre' | 'basalt' };
}

/** Version 1, 2, 3 and 4 all load. */
export interface SaveData {
  /* …existing… */
  /** POP_SCALE the head counts in this save are in (10). Missing → ×1 (v1–v3, multiplied at load). */
  scale?: number;
  /** World side (192). Missing → 64: a v1–v3 save, migrated (§3.10). */
  size?: number;
  /** v4 district state. */
  districts?: DistrictSave;
  // v4 meaning of `tiles`: 4096 numbers per owned slot, slot by slot in districts.owned order, row-major inside the slot.
}
```

`blankTile()` gains `elev: 0, ground: Ground.Plain`; `makeFields()` the two arrays; `emptyStats()` `districts: []`, `skyLobbies: { count: 0, largest: 0, visitors: 0 }`.

#### `src/game/world.ts` additions

```ts
/** District state (saved as SaveData.districts). Written by world.annex() and Game only. */
districts: DistrictSave;            // { kinds, owned, charters, bought, annexedAt, leases }
/** 1 = owned, index SlotId. */
slotOwned = new Uint8Array(9);
/** Owned row segments as [start, end) index pairs, ascending; owned slots side by side in a row merge into one segment. */
segs = new Int32Array(SLOTS * MAP_SIZE * 2);
segCount = 0;                       // number of ints used (2 per segment)
/** ++ on every annex (renderer, SimGrid and turf compare it). */
slotsVersion = 0;
/** ++ when road / zone / building presence changes (power labels, O2). setLevel and setWealth do not bump it. */
conductorVersion = 0;
/** Tile rect of the owned slots. */
ownedBox: { x0: number; y0: number; x1: number; y1: number };
/** Shoals king tide: days left (0 = none). */
tide = 0;

isOwned(x: number, y: number): boolean;     // in bounds and its slot is owned
ownedAt(i: number): boolean;
slotAt(x: number, y: number): SlotId;       // SLOT_OF[y * N + x]
kindAt(x: number, y: number): DistrictKind; // districts.kinds[slotAt]
/** Structural annex: mark owned, place the district's content (districts/annex.ts), rebuild segs and ownedBox, touch the slot, emit 'annex'. No cost, no rules. */
annex(slot: SlotId): void;
/** Pump House reclamation: water → land (a bridge becomes a road of its kind; Alley/Ramp rules hold). Touches the tile, bumps conductorVersion. */
setTerrain(x: number, y: number, terrain: Terrain): void;
setGround(x: number, y: number, g: Ground): void;
```

Static tables in new `src/game/districts/slots.ts`: `SLOT_OF: Uint8Array(36864)`, `slotRect(s)`, `slotNeighbours(s)` (4-adjacent), `adjacentLocked(world): SlotId[]` (the annex candidates), `rebuildSegments(world)`, `artXY(x, y)` (= `x − 64, y − 64`: render hashes and the start slot's neighbourhood names use it, so a migrated city keeps its puddles, cracks and names).

**Invariants** (Step 0b enforces them in every mutator; the contract test runs every mutator in random order, with random annexes, and checks after each call): no road, zone, building, rail, sky, link anchor or turf on a locked tile; `elev = 0` and `ground = Plain` on water; `segs` covers exactly the owned slots; EXPANSION §2.1's invariants still hold.

#### `src/game/config.ts` additions (names and shapes are contract; numbers are tuning knobs)

```ts
export const POP_SCALE = 10;   // §4

export interface DistrictMods {
  roadCostMul?: number;                 // all ground road kinds, land tiles
  bridgeCostMul?: number;
  bridgeUpkeepMul?: number;
  zoneCostMul?: Partial<Record<'res' | 'com' | 'ind', number>>;
  buildCostMul?: Partial<Record<BuildingType, number>>;  // the footprint must lie inside this district
  lvAll?: number;                       // static lvAdd on every land tile
  lvShore?: number;                     // land within 2 of water
  lvPerElev?: number;                   // per terrace step
  crime?: { v: number; halfLifeDays: number };   // decays from the annex day
  frameCrime?: { v: number; r: number };          // around unfinished frames
  reedPark?: { v: number; r: number };            // unbuilt reed tiles
  brownfield?: { pollution: number; developedPollution: number; clearDays: number; parkClearDays: number };
  floodplainMaxLevel?: number;          // land within 1 of a channel, unless resilience > 0
  recoverMul?: number;                  // abandoned recovery chance ×
  salvage?: number;                     // CR paid (instead of BULLDOZE_COST) per abandoned tile bulldozed
  slopeRoadMul?: number;                // road tile next to a different terrace step
  demandInd?: { jobs: number; whileFabBelow: number };  // ×10 units
  visitorsPerMarket?: { per: number; tiles: number; cap: number };
  kingTide?: { months: number[]; days: number; lv: number };
}

export interface DistrictDef {
  kind: DistrictKind;
  name: string;            // ≤ 18 chars
  short: string;           // ≤ 12 chars (inspect value width)
  tagline: string;         // ≤ 60 chars (City map)
  color: string;           // City map accent
  /** Who lobbies for it (§8.2). 'tuning' only once tuningActive; lobbyFallback before. */
  lobby: FactionId[];
  lobbyFallback?: FactionId;
  /** Lobby lines by speaker, ≤ 110 chars each, in voice (§8.2). */
  quote: Partial<Record<FactionId, string>>;
  /** An annex-sheet choice between two factions (Tarmac Reach only). */
  lease?: { options: ['nacre', 'basalt']; prompt: string };
  perks: string[];         // ≤ 3 lines ≤ 48 chars
  hazards: string[];       // ≤ 2 lines ≤ 48 chars
  water: [number, number]; // target water share
  fog: number;             // chance of a fog morning (§6.4)
  /** Building and ground style (§6.1); one style per kind, so the style id is the kind. */
  style: DistrictKind;
  neighbourhoods: string[];// 12 names ≤ 15 chars: the {district} token inside it
  mods: DistrictMods;
}

export const DISTRICTS: Record<DistrictKind, DistrictDef> = { /* §3.7 */ };

/** Sandbox price of the next district by districts owned (index 1..8). Fixed: never scales with funds. */
export const DISTRICT_PRICES: readonly number[] = [0, 60_000, 80_000, 100_000, 130_000, 160_000, 200_000, 250_000, 400_000];

export const ANNEX = {
  lobbyFavor: 6, rivalLobbyFavor: -2,
  leaseFavor: 8, leaseRivalFavor: -4,
  flyInSec: 1.2, fogLiftSec: 1.5,
  /** Tiles of locked land the camera may show past the owned box. */
  peek: 6,
} as const;
```

`BuildingDef` gains (optional; absent = today's behaviour): `height?: number` and `roof?: number` (game-side height class, upper and lower bound in world px, §5.3), `site?: 'shore' | 'water'` (`'water'`: the footprint is on water, Tidal Turbine), `hidden?: boolean` (never in a tray: `frame`, and any dropped optional type). `BuildingGate` (story/types.ts) gains `district?: DistrictKind`, `lobby?: number`, `districts?: number`, `chapter?: number` (§6.3). `EDGE_LINKS` gains `perDistrict: 4` (cap = 12 + 4 × (owned − 1)). Events (`events.ts`): `annex: { slot: SlotId; kind: DistrictKind }`, `charter: { charters: number; why: 'chapter' | 'ending' | 'migrated' }`, `cityEvent: { id: CityEventId; phase: 'start' | 'end'; slot?: SlotId }`; `toast.action.id` gains `'map'`.

### 3.3 The sim with districts

The world is one continuous city: roads, power, services, traffic, turf and skybridges cross slot borders with no special case, because the arrays are one 192×192 grid. Locked slots hold nothing, so they contribute nothing; what has to change is that today's code **visits** them. The optimisations, each with an owner (WP-1 unless stated) and its measured or expected effect:

| # | Change | Effect |
|---|---|---|
| **O1** | **Owned segments.** Every per-tile loop in `sim/*.ts`, `story/turf.ts`, `story/mods.ts` (`composeLayers`, `resetLayers`) and `story/vertical.ts` (`refresh`, WP-2) iterates `for (let s = 0; s < w.segCount; s += 2) for (let i = w.segs[s]; i < w.segs[s + 1]; i++)`. `blur3` gets a segment form: horizontal passes per segment (segment ends act like today's map edge), vertical passes per segment reading `i ± N` (a locked neighbour row reads 0: nothing writes locked tiles). The day's tile-age loop walks zoned, road and building tiles only. | removes the 2.9 ms of empty area (§2.3): "1 of 9" ≈ today |
| **O2** | **Power labels cached** on `world.conductorVersion`; supply/demand sums every tick; the allocation BFS only when some component is short; otherwise a linear fill. | power 29% of a step → ~10% |
| **O3** | **Coverage cached** on a building signature (id, type, powered, offline, complete stage) plus the `transitAdd` layer version. | coverage 10% → ~0 on quiet ticks |
| **O4** | **4-phase field stagger** (`FIELD_STAGGER` 4): 0 traffic; 1 pollution + noise; 2 neighbourhood + land value; 3 crime + wealth score. Field latency 4 days (2 s at speed 1). | −40% together with O2–O3 (§2.4) |
| **O5** | **`Simulation.recomputeAround(rect)`** after player actions: power (relabel only if conductors changed), coverage (if its signature changed), traffic in full (highway and sky pools are network-wide), then pollution, neighbourhood, land value, crime and wealth score on `rect ⊕ 12` rows clipped to owned segments, then census, averages and budget. `Game.apply` passes the plan's touched rect. `recomputeAll` stays for load, new city and annex. | an action costs ~4 ms in Node at 9 districts instead of 10–12 |
| **O6** | **Turf where it is read.** `turf.update` computes affinity only for owned tiles and their eligible 4-neighbours (the hold and spread candidates), its dilated indicators by local scans (radius ≤ 4) into a per-month scratch mark; `bestTile` (seeding, tagback) scans owned eligible tiles only when it is needed. `refreshStats` over owned segments. | `onMonth` 9.4 → ≤ 3 ms at 9 districts |
| **O7** | Budget projection every 3rd tick (the month-end tick always projects fresh before `settleMonth`). | −0.3 ms at 9 districts |
| **O8** | *Fallback only (not planned):* sleeping districts. A slot with no player action for 120 s and no level change for 60 d samples growth at ¼ rate and runs its local field passes every 4th cycle. Built only if Step 9's device check misses §10.1. | — |

**Frame guard** (`Game.update`, WP-2): sim work per frame is capped at 8 ms on coarse-pointer devices (12 ms otherwise); ticks over the cap carry to the next frames, and a backlog over 32 ticks is dropped. At 9 districts on a phone, speed 3 therefore becomes "up to 16 d/s" and the frame rate holds.

**District rules in the sim** (WP-1, reading `DISTRICTS[kind].mods`, tile `elev` / `ground` and the district layer part):

- **Layers.** `SimLayers` gains `parkAdd` and `pollutionAdd` (identity 0); `LayerParts` gains `district`. `districts/effects.ts` (WP-2) writes the district part: `lvAdd` (Shoals shore +0.04, Sunk rubble −0.04, Tarmac −0.03, Terraces +0.035 × elev, king-tide −0.03), `crimeAdd` (Sunk decay, frames), `parkAdd` (unbuilt reed tiles 0.5 r1), `pollutionAdd` (brownfield 0.15, developed 0.07). It rebuilds the part on annex, on every `ground` change, at tide start and end, and on the first day of each sim year (crime decay). `composeLayers` merges it like the story parts.
- **Fields.** Coverage max-combines `parkAdd` into `park`; pollution adds `pollutionAdd` to the sources and multiplies the diffused field by `1 − 0.25 × filter`; `resilience` and `filter` are ordinary coverage effects (added to `EFFECTS`).
- **Growth.** Reedmere floodplain tiles (land within 1 of water, marked at annex) cannot step to level 3 while `resilience` = 0; the Sunk's abandoned tiles recover at `RECOVER_CHANCE × 2`; a brownfield tile clears (`setGround(Plain)`) when a sampled tile is developed with `age ≥ 720`, or has `park ≥ 0.3` or `filter > 0` with `age ≥ 360`.
- **Demand.** `Simulation.setTrade` adds Kessel Flats' +2,000 industrial jobs while it has < 400 developed Fab tiles, the Tarmac lease (+2,000 Market or Fab jobs), and Copperline's visitors (`PortSystem` raw visitors) at 600 per 10 developed Market tiles there, cap 30,000.
- **Census** fills `stats.districts` in the same pass (residents, jobs, developed tiles and mean land value per owned slot).
- **Daily** (`districts/daily.ts`, WP-2, called by `Simulation.step` through a Step 0b hook): Pump House reclamation, king tides (`world.tide`), frame crime refresh on finish.

### 3.4 Locked slots

- **Building anything** on a locked tile is refused tile by tile: `ok: false`, reason "Not annexed yet", `plan.slot` set. The pill shows the reason; lifting the finger on such a plan toasts "Kessel Flats isn't part of the city yet" with a **Map** action (44 px) that opens the City map on that slot.
- Bulldoze and story tools ignore locked tiles. Turf never forms there; story spot rules only search owned tiles (they already search developed tiles, which locked slots never have).
- **Inspect** on a locked tile opens the district preview (name, tagline, perks, hazards, lobbyists) with "Open City map".
- Roads may run right up to the owned boundary; that is how regional links work (§3.5).

### 3.5 Map edge, regional links and ports

- **Boundary tile:** an owned tile with a 4-neighbour that is off the map or in a locked slot.
- **Regional link** (EXPANSION §3.10's rule with "map border" replaced by "boundary"): a ground road on a boundary tile, whose outward neighbour is off-map or locked and whose inward neighbour is a road it links to. Points as EXPANSION (Street 1, Avenue 2, Highway 3); cap `12 + 4 × (owned − 1)` (44 at 9 districts); demand per point in ×10 units (Fab 250 jobs, Market 120); visitors per point 400 (X3).
- **Annexing turns a shared border internal:** its links stop counting. The annex sheet says so ("3 regional links here become city streets"); the new district's outer boundary is where the next ones go. The world's outer edge (x or y = 0 or 191) is a permanent boundary.
- **Stubs:** each owned slot gets 2 painted regional-road stubs on its outer boundary (art, from the seed), redrawn when the boundary moves. Cars spawn and leave at boundary roads (EXPANSION §3.11 with the boundary).
- **Ports:** a Seaport's berth tiles must be owned open water; the ship's approach may cross locked water (art only). Airport, Spaceport and every footprint must be owned. Planes and launches ignore slots.

### 3.6 Terrain generation

#### 3.6.1 Pipeline (`src/game/districts/terrain.ts`, WP-2; Step 0b ships a plain-noise stub with the same signature)

1. **Start slot:** today's `generateTerrain` run in slot-local coordinates and written at +64, +64: **bit-identical** to today's map for the same seed (test), so new cities start exactly as before and the balance tests keep their terrain.
2. **Layout:** `assignKinds(seed, baySide, riverAxis, riverExits)` (§3.6.2) → `kinds[9]`.
3. **Edge slots** in the order 1, 5, 7, 3, then **corners** 0, 2, 6, 8, each with its kind's generator (§3.7) and **border blending** against every neighbour already generated: for depth d = 0..5 from the shared border, `w = (6 − d) / 6`; a tile is water when `w × p(k) + (1 − w) × own(k, d) > 0.5`, where `p(k)` is the neighbour's border tile (water 1, land 0) smoothed over k ± 1, and `own` is the generator's value scaled to 0..1 around its threshold. A water run of 2–4 tiles on the neighbour's border (a river mouth) is continued as a channel of the same width that meanders (`sin` + fbm, as today's river) to the opposite edge or into the kind's water body. Corners take the larger blend weight of their two neighbours.
4. Every generator uses `new Rng(seed ^ SALT[slot])` and `fbm(…, seed + 100 × slot)`, so locked slots regenerate identically at every load. Owned slots are saved (§3.10), so a later generator change only alters land nobody owns yet.

Cost: 32,768 tiles of fbm at world creation, < 25 ms in Node (once per new city or migration).

#### 3.6.2 Which district goes where

Relative to the start map's bay side (`side` in `generateTerrain`: 0 north, 1 east, 2 south, 3 west) and its river (`riverAxis`: crosses the west and east edges when 0, north and south when 1). Rng `new Rng(seed ^ 0x6d454741)` so no other roll shifts:

1. The edge slot across the bay → **Saltglass Shoals** (the bay continues into islands).
2. One of the two corners flanking it (rng) → **The Sunk** (the drowned lower wards lie along the old shore).
3. The river-exit edge slot that is not the Shoals (rng if two) → **Reedmere Marsh** (the river spreads into reeds).
4. The edge slot opposite the bay, if free, else the free corner on that side → **Lantern Terraces** (inland hills).
5. A free slot touching the bay side if any, else any free slot → **Kessel Flats** (it carves its own dock basin either way).
6. The rest → **Skeleton Row**, **Tarmac Reach**, **Copperline Bazaar**, shuffled.

A contract test runs 200 seeds: every kind appears once, the Shoals is always across the bay, every slot's land share is inside its kind's range, and every slot is buildable (≥ 35% land in one 4-connected component).

### 3.7 The nine districts

| Kind | Name (short) | Water | Lobby | Perks (City map lines) | Hazards | Style |
|---|---|---|---|---|---|---|
| `shore` | Charter Shore (Shore) | today | — | — | — | shore |
| `shoals` | Saltglass Shoals (Shoals) | 45–60% | Nacre | Bridges 40% cheaper · Waterfront land value +4% · Harbour Beacon site | King tides twice a year · Floodwatch stops them | shoals |
| `sunk` | The Sunk (The Sunk) | 25–35% | Undertow | Ruins come back as cheap homes · Salvage: clearing a ruin pays · Pump Houses raise new land | Crime +6%, fading over years · The Undertow is here first | sunk |
| `flats` | Kessel Flats (Kessel Flats) | 8–15% | Basalt | Fab zoning half price · Reactors and Seaports 15% off · Extra industrial demand | Brownfield smog until the soil clears | flats |
| `terraces` | Lantern Terraces (Terraces) | 3–8% | Tuning (once active), else Board | Views: +3.5% land value per step | Roads cost double on slopes · Buildings need flat ground | terraces |
| `reedmere` | Reedmere Marsh (Reedmere) | 25–40% | Board | Unbuilt reeds act as free parks · Tidal Turbine sites | Floodplain: level 2 at most without Floodwatch | reedmere |
| `skeleton` | Skeleton Row (Skeleton Row) | 5–10% | Kites | Finish a half-built tower for 60% of the price | Crime near the empty frames · The Kites live up there | skeleton |
| `tarmac` | Tarmac Reach (Tarmac Reach) | 5–15% | Nacre and Basalt (lease) | Roads 30% cheaper · Airport 25% and Spaceport 20% off · Lease the apron: +2,000 jobs demand | Windswept: land value −3% | tarmac |
| `bazaar` | Copperline Bazaar (Copperline) | 5–12% | Undertow and Kites | A ready-made alley quarter · Night markets draw visitors · Market Hall half price | Alleys bring crime · Both crews want it | bazaar |

Taglines (City map, ≤ 60 chars): Shore "Where the charter opened the shore. Your first streets."; Shoals "Islands and sandbars across the bay. Bridges come cheap."; Sunk "Drowned in the storm of 2084. People still live there."; Flats "Slag, rail yards and a long dock. Industry moves in fast."; Terraces "A stepped hillside. Views sell, slopes cost."; Reedmere "Reeds and channels. Free parkland while you leave it be."; Skeleton "Unfinished towers from a developer who went bust."; Tarmac "An old airfield. Flat, open and windy."; Bazaar "A tangle of alleys and night stalls under copper roofs."

#### Saltglass Shoals (`shoals`)

- **Terrain:** water by default; land where `fbm(x·0.06, y·0.06) > t` (islands, t starting at 0.52 and lowered by 0.01 until land ≥ 40%), plus sandbars where `|fbm2 − 0.5| < 0.02` (one-tile land strips joining some islands). The bay side continues open water for the first 8 tiles from the shared border except where the start map's coast pokes through.
- **Mods:** `bridgeCostMul 0.6`, `bridgeUpkeepMul 0.7`, `lvShore +0.04`, `kingTide { months: [3, 9], days: 20, lv: −0.03 }` (land within 1 of open water, cancelled where `resilience > 0`).
- **Content on annex:** none (terrain is the content); 2 stubs. The Harbour Beacon (§6.3) needs a Shoals shore tile.
- **Neighbourhoods:** Pelican Key, Gull Reef, Pearl Spit, Low Key, Brine Steps, Ferry Row, Sandbar, Lamp Key, Kelp Wharf, Glass Key, Tern Point, Salt Row.
- **Look:** white render and pastel walls on stilts, boardwalk edges, rope bollards, ferry piers; gulls (art) by day.

#### The Sunk (`sunk`)

- **Terrain:** the old street grid flooded: canals on every 8th local row and column (offset by `hash(seed)`), 2 tiles wide, except 30% of canal segments that survive as land causeways; 3–5 sunken plazas (3×3 pools). Water 25–35%.
- **Content on annex:** **ruins**: 35% of land tiles become zone tiles (Hab 60%, Market 40%), level 1 (70%) or 2, `abandoned`, tier $, a hashed variant. They are real dark lots: they recover when a road reaches within 3 and power arrives (`recoverMul 2`), and the normal collapse rule turns unrestored ruins into empty zoned lots over the years (still pre-zoned land). Rubble ground on 20% of the remaining land.
- **Mods:** `crime { v: 0.06, halfLifeDays: 1080 }`, `lvAll −0.04` on rubble tiles only, `salvage 30` (bulldozing an abandoned tile in the Sunk pays 30 CR instead of costing 5; at most 3,000 CR a month).
- **Story:** the Undertow seeds here on annex if it has seeded (else at its normal seeding, with the Sunk's best tile preferred); Brine lobbies for it. The Pump House (§6.3) raises canals into land.
- **Neighbourhoods:** Silt Row, Drowned Mile, Pump Lane, Old Ward, Hullside, Weir Street, Canal Nine, Mudlark, Cistern Row, Kelpmarket, Rope Walk, Low Tide.
- **Look:** waterline stains, patched brick and salvaged sheet metal, green-tinted lamps, mooring rings and boats tied to doorways.

#### Kessel Flats (`flats`)

- **Terrain:** almost all land; one straight dock basin 4 tiles wide along the slot edge farthest from the start (or through the middle if that edge is the world edge on the bay side), straight for ≥ 40 tiles so it offers ≥ 3 Seaport sites (`shoreSites` test).
- **Content on annex:** brownfield ground on 60% of land (blobs where `fbm > 0.4`), old rail-yard ground art on brownfield, 2 stubs (one aimed at the basin).
- **Mods:** `zoneCostMul { ind: 0.5 }`, `buildCostMul { reactor: 0.85, foundry: 0.85, seaport: 0.85, hexworks: 0.85 }`, `demandInd { jobs: 2000, whileFabBelow: 400 }`, `brownfield { pollution: 0.15, developedPollution: 0.07, clearDays: 720, parkClearDays: 360 }`.
- **Neighbourhoods:** Slag Hill, Rivet Row, Yard Nine, Coke Ovens, Kessel Cross, Sidings, Furnace End, Ash Lane, Gantry Row, Cinder Mile, Pressworks, Coal Wharf.
- **Look:** corrugated steel and soot brick, sawtooth roofs, chimneys, sodium light, oil-sheen puddles.

#### Lantern Terraces (`terraces`)

- **Terrain:** `elev = clamp(floor((fbm(x·0.05, y·0.05) − 0.3) × 6 + d/24), 0, 3)` where `d` is the distance from the shared border with the city (the hill rises away from it); cells of a step smaller than 3×3 are merged into the lower step; one stream (water 3–8%).
- **Mods:** `lvPerElev 0.035`, `slopeRoadMul 2` (a road tile with a 4-neighbour on a different step), and every building footprint must be flat (reason "Needs flat ground").
- **Render:** real terrace steps of 8 world px with retaining walls (§3.9); *optional* fallback: contour shading only (the numbers stay).
- **Story:** the Tuning lobbies once active (Ohm); before that the Board (Marrow). The Geothermal Bore (§6.3) needs a terrace step ≥ 1.
- **Neighbourhoods:** Lamp Steps, High Terrace, Vinehill, Stairwell, Overlook, Cistern Hill, Glimmer Rise, Tierside, Lookout, Quarry Steps, Ember Rise, Ridge Row.
- **Look:** stepped stone, terrace gardens, stairs between steps, warm lamps along every stair.

#### Reedmere Marsh (`reedmere`)

- **Terrain:** braided channels: the start map's river (if it exits here) splits into 3–5 channels of width 1–2 that wander and rejoin; otherwise 3 channels from the slot's edges. Water 25–40%.
- **Content on annex:** reed ground on 50% of land within 4 of water (`fbm > 0.35`); floodplain marks (land within 1 of water).
- **Mods:** `reedPark { v: 0.5, r: 1 }` (only while the reed tile has no road, zone or building), `floodplainMaxLevel 2` (unless `resilience > 0`).
- **Neighbourhoods:** Reedmere, Heron Flats, Wickfen, Sedge Row, Mere End, Willowcut, Fenlight, Eelbrook, Marsh End, Rushmoor, Cattail, Mudbank.
- **Look:** timber and green roofs, boardwalk paths, reeds swaying (animated tint), herons (art) by day, the foggiest district (`fog 0.6`).

#### Skeleton Row (`skeleton`)

- **Terrain:** mostly land; one small canal. Water 5–10%.
- **Content on annex:** 5 **frames** (`frame`, 4×4, inert: no power, upkeep, jobs or trips; not tall) on flat land ≥ 10 tiles apart, a broken street grid (Streets on 40% of a 6-tile grid's segments), rubble on 15% of land.
- **Finish a frame:** inspect action "Finish frame · 7,200 CR" (60% of the Stratablock plinth, `STACK_STAGES[0].cost × 0.6`, ignoring the per-stack 1.15 scale) replaces it with a `stack` at **stage 1 complete** (no 60-day plinth wait) in the Skeleton style; later stages as normal. Needs `unlock stack` (or its fallback).
- **Mods:** `frameCrime { v: 0.04, r: 3 }` around unfinished frames.
- **Story:** the Kites seed on a frame on annex (if seeded); lark lobbies.
- **Neighbourhoods:** Rebar Row, The Frames, Crane Yard, Hollow Tower, Scaffold Lane, Formwork, Skyhook, Bare Steel, Topping Out, Lift Shaft, Ninth Floor, Girder Park.
- **Look:** raw concrete and exposed rebar, tarps flapping, tower cranes frozen mid-swing, Kites' string lights on the frame tops at night.

#### Tarmac Reach (`tarmac`)

- **Terrain:** flat land, one shore edge or a lagoon (water 5–15%).
- **Content on annex:** an old runway strip (6×40) and apron (12×12) painted as ground art (brownfield bits, no pollution in this district), 2 stubs.
- **Mods:** `roadCostMul 0.7`, `buildCostMul { airport: 0.75, spaceport: 0.8 }`, `lvAll −0.03`.
- **Lease** (annex sheet, §7.2): "Lease the old apron to:" **Nacre** (+2,000 Market jobs of demand, Nacre +8, Basalt −4) or **Basalt** (+2,000 Fab jobs, Basalt +8, Nacre −4).
- **Neighbourhoods:** Apron Nine, Old Tower, Hangar Row, Taxiway, Windsock, Runway End, Beacon Hill, Jetwash, Holding Bay, Tarmac Cross, Radar Row, Hardstand.
- **Look:** low hangars, wide sheds, windsocks, faded runway numbers, blinking obstruction lights.

#### Copperline Bazaar (`bazaar`)

- **Terrain:** land with one canal (water 5–12%).
- **Content on annex:** a Back Alley tangle on a jittered 3-tile grid (≈ 18% of land), two Streets entering from each shared border, 1×1 empty squares at alley crossings.
- **Mods:** `visitorsPerMarket { per: 600, tiles: 10, cap: 30000 }`, `buildCostMul { markethall: 0.5 }`; both gangs' turf affinity +0.1 inside it (`TURF.affinity.*.bazaar`).
- **Story:** both gangs lobby for it (both +6 on annex); who runs its night markets is settled later in the card `ds.bazaar` (§8.3), not on the annex sheet.
- **Neighbourhoods:** Copperline, Paper Lane, Spice Row, Noodle Steps, Tin Market, Wireway, Brass Court, Silk Steps, Coil Street, Pawn Row, Charm Lane, Lamp Bridge.
- **Look:** copper and verdigris roofs, paper lanterns strung across alleys (animated glow), awnings, dense hand-painted signs in the invented glyph set.

### 3.8 Annexing

- **Charters.** Each chapter reward (Ch1–Ch5) and the ending carry the new effect `charter 1` (§8.4): `districts.charters` +1, event `charter`, the goal chip shows "✦ 1 charter" until spent. Charters never expire.
- **Candidates:** locked slots 4-adjacent to an owned slot (`adjacentLocked`). Non-adjacent locked slots show on the City map but cannot be annexed ("Not next to the city yet").
- **Price:** one charter while the player has any; otherwise, **only after an ending is chosen** (the sandbox), `DISTRICT_PRICES[owned]` credits (8th 250,000; 9th 400,000). Normal play reaches the sandbox with 7 districts or unspent charters; the lower rows only keep the table total for a city whose charters were lost (a damaged save). Before the ending without a charter: "Next charter: finish Chapter III".
- **`Game.annex(slot, lease?)`** (WP-2): checks; pays (charter, or funds and `bought` +1); `world.annex(slot)`; rebuilds the district layer part; `director.onAnnex(kind, lease)` (favor, §8.2); `sim.recomputeAll()`; emits `annex`; queues the once-per-kind moment banner ("DISTRICT ANNEXED · KESSEL FLATS" / "Fab zoning half price") in `MilestoneBanner`. Not undoable (it is confirmed on the sheet, §7.2).
- **Migration** (§3.10) grants the charters a v3 city has earned: completed chapters (at most 5), plus 1 if an ending was chosen.

### 3.9 The renderer with districts (WP-3)

- **Camera** (`camera.ts`, additive, the public API stays): `bounds: Rect | null` in tiles, used by `clamp()` instead of `0..MAP_SIZE` when set; `setBounds(r)`; `fitBox(r, insetBottomPx = 0)` (frames a tile rect above a bottom sheet: the City map frames the 3×3 world in the top half). Slot taps on the atlas and Annex pin taps are pure geometry (`camera.screenToTile` → `slotAt`; pin centres from `slotRect` → `camera.tileToScreen`), so input and UI never call into the renderer. The Renderer sets `bounds` to the owned box ± `ANNEX.peek` (6), sets `minZoom` to 0.25 while the owned box is one slot and 0.4 otherwise, and `fitMap()` fits the owned box. `visibleTileBounds` keeps clipping to the map.
- **Ground cache.** `OX` and the chunk grid are unchanged in form (N = 192). Locked tiles inside the peek margin paint in a **fog** style: terrain colour × 0.45 mixed 30% toward `[40, 26, 70]`, no props, no roads; a dashed boundary line (`#8f7bff`, 2 world px, alpha 0.6, dash 10/8) along the owned edge. **Annex pins**: a 44 px round screen-space button with "+" and the short name at the middle of each candidate slot's shared border, drawn after the ground; input hit-tests it and opens the City map on that slot.
- **Overview bucket:** covers the owned box + peek only, at `0.235 × 64 / max(boxW, boxH)` device px per world px, so it stays ≈ 2 MB at any size (§2.5).
- **Atlas mode** (`render/atlas.ts`): below zoom 0.4 with more than one district, or while the City map is open, the renderer draws one cached **impostor** per slot instead of the detail layers: canvas at 0.1 device px per world px (≈ 410×236 px, 0.39 MB; 3.5 MB for 9). Owned slots: ground colour per tile, a shaded prism per developed tile (height by level), prisms for buildings, lit-window dots in 3 night buckets; locked slots: fog terrain (water, land, terrace tints) with the kind's icon. Repaint only while the atlas is visible, at most one dirty slot per 400 ms. Frame cost: 9 blits and labels, ≤ 1 ms. Pinch-in past 0.4 returns to the detail view centred where the fingers are.
- **Sweep:** `drawObjects` iterates the visible box clipped to the owned box; at zoom ≥ 0.4 the on-screen count is ≤ 2,195 (portrait), inside today's worst case.
- **Terraces** (`elev`): ground plates raised 8 world px per step with retaining-wall faces on the +x / +y sides where the neighbour is lower and stairs on Streets between steps; every object on a tile (zone, building, rail, deck, car, crowd) offsets by `elev × 8`; picking tests the up to three tiles in front of the ground hit whose raised diamond contains the point (front-most wins). Optional: if dropped, Terraces draw contour shading in the ground cache and nothing is raised.
- **District ground character** (ground cache, per style): pavement tint and street furniture (Shoals boardwalks and bollards, Sunk canal walls and mooring rings, Kessel rail tracks on brownfield, Terraces stairs, Reedmere reeds and boardwalks, Skeleton rubble and cones, Tarmac runway numbers and windsocks, Copperline lantern strings over alleys, glowing in the animated pass).
- Budgets: ground chunks 24 MB (unchanged), sprite cache 32 MB (unchanged), atlas ≤ 4 MB.

### 3.10 Saves: version 4 and migration

- `SAVE_VERSION = 4`, `SAVE_VERSIONS_SUPPORTED = [1, 2, 3, 4]`, `SAVE_KEY` unchanged.
- **Tile bits:** EXPANSION §2.3 plus **20-21 elev** (0..3; written 0 on water) and **22-23 ground** (0..3; written 0 on water). Bits 24-30 reserved, written 0.
- **v4 layout:** `size: 192`, `scale: 10`, `districts` (§3.2), and `tiles` = 4096 numbers per owned slot in `districts.owned` order, row-major inside the slot (so the start slot's block has exactly the old layout). Buildings, sky, turf, rail and links are stored in world coordinates. Locked slots are not saved: `deserialize` first regenerates every slot from the seed (each blending against its *generated* neighbours, never against edited land, so a Pump House can't shift a locked coastline between sessions), then writes the owned blocks over it. `tiles.length !== owned.length × 4096`, a duplicate or out-of-range slot, or `owned` without `START_SLOT` → "Incompatible save" (raw string copied to `.unreadable`, EXPANSION §2.5).
- **Migration** `upgradeSave(data): SaveData` (new `src/game/districts/migrate.ts`, pure JSON → JSON, Step 0b), for any save without `size`:
  - offset (64, 64); `remap(i) = ((i >> 6) + 64) * 192 + (i & 63) + 64`;
  - `tiles` → the start slot's block verbatim;
  - buildings `x`, `y` += 64; `sky` (v3), story `turf` and `rail`: RLE-decode at 4096, place, RLE-encode at 36,864; `links` `ax ay bx by` += 64;
  - story tile indices through `remap` (−1 / null kept): `seam`, `pending.spot`, `open.spot`, `waiting.spot`, `railOut[].i`; coordinates += 64: `locals[].x/y`, `crackdowns[].x/y`. Step 0b lists them in `TILE_INDEX_FIELDS` / `TILE_XY_FIELDS`, and a contract test walks every `StoryState` key so a future field cannot be missed;
  - **scale:** a save without `scale` gets `maxPopulation × 10` and its `milestones` mapped to the ×10 thresholds; then `scale: 10`;
  - `districts`: `kinds` from §3.6.2 (the start terrain is regenerated from the seed and checked against the saved terrain bits; on a mismatch, e.g. a hand-edited save, the layout still comes from the seed), `owned [4]`, `charters` as §3.8, `bought 0`, `annexedAt` −1 except slot 4 = the save's tick.
  - The first v1–v3 load in a v4 build copies the raw string to `${SAVE_KEY}.v3` once (like EXPANSION's `.v2`). `loadedVersion` keeps the original version (EXPANSION's `settleWealth` still runs for < 3).
- **Size:** 9 districts fully built ≈ 254 KB measured (§2.5); budget **≤ 320 KB**, tested with the megacity fixture. Write 2.3 ms in Node. Total storage with backups (`.v3`, the previous-city slot, `.future`, `.unreadable`) ≤ 1 MB. A failed `storageSet` toasts "Couldn't save: storage is full" once a session.

---
## 4. Megacity scale

### 4.1 Approach: one unit change, then a few additions

**`POP_SCALE = 10` is a change of units for people.** Every head count (residents and jobs of every zone level, building, stage and crown; every population threshold) is multiplied by 10, and every rate *per head* (tax, trips, trade, visitor spending, the salt price slope, the power-share divisors) is divided by 10. Everything per tile and per building (taxes, traffic, power, pollution, growth, upkeep, prices) is therefore **bit-identical within rounding**, which a test pins (S1, §10.3). The story's pacing (PACING.md, measured on population gates) is unchanged because its gates move with the units.

Why ×10 and the same ratios between levels: an L1 walk-up of 140 people (≈ 58 homes on a ~40 m lot), an L2 slab of 480, an L3 tower of 1,500 (35–45 floors) and a Stratablock of 20,000 are realistic; a fully built district holds ≈ 480,000 (48,374 × 10 measured), nine districts ≈ 4.4 M. Changing the level ratios would re-tune growth gates, traffic and power for no gain the owner asked for. What makes the scale *felt* is added on top: 2×2 parcel towers (§6.1), megastructure and landmark numbers (§6.3), three new milestones (§4.5) and the realism surfaces (§4.6).

**Unchanged on purpose:** lore numbers (the 11,000 below the gates, the 90,212 above them, MOTH's `> lamps 4,112` telemetry), money (costs, upkeep, grants, chapter rewards, CR in cards), tile counts (`dev.*`, turf tiles, road and skyway tiles, `abandoned`), percentages, radii, MW, sim days and real seconds. There is no water utility (Appendix C).

### 4.2 Capacities

Zones, residents or jobs per tile (EXPANSION §4.4's tier multipliers and the affordable ×1.1 apply unchanged):

| | L1 | L2 | L3 | L3 $$$ | 2×2 parcel at L3 (four tiles, §6.1) |
|---|---|---|---|---|---|
| Hab Blocks (residents) | 140 | 480 | 1,500 | 1,350 | 6,000 |
| Market Strip (jobs) | 80 | 280 | 900 | 855 | 3,600 |
| Fab District (jobs) | 120 | 340 | 750 | 675 | 3,000 |

Buildings (×10; power, cost and upkeep unchanged):

| Building | Residents | Jobs | | Building | Residents | Jobs |
|---|---|---|---|---|---|---|
| Fusion Reactor | — | 400 | | Stratablock Plinth | — | 3,000 Market + 1,000 Fab |
| Enforcer Precinct | — | 200 | | + Hab Core | +16,000 | — |
| Med Clinic | — | 250 | | + Crown | +4,000 | +3,000 Market |
| Data Hub | — | 100 | | Crown: Foundry | — | +2,500 Fab |
| Maglev Station | — | 150 | | Crown: Commons | +6,000 | — |
| Corp Spire | — | 6,000 | | Crown: Salvage (new) | — | +3,000 (untaxed) |
| Arcology | 30,000 | 1,200 | | Foundry Spine | — | 2,500 |
| Academy | — | 300 | | Glarewall | — | 100 |
| Seaport | — | 2,400 | | Tidemarket | — | 1,500 (untaxed) |
| Airport | — | 3,200 | | Commons Hall | — | 300 |
| Spaceport | — | 5,500 (2,500 Fab) | | New types | §6.3 | §6.3 |

A full Stratablock is 20,000 residents and 7,000 jobs (26,000 with the Commons crown): "megastructures house tens of thousands". Service coverage radii are unchanged and services still have no capacity limit (Appendix C).

### 4.3 Per-head economics

| Constant | File | Old | New | Effect |
|---|---|---|---|---|
| `TAX_PER_RESIDENT` | sim/tuning.ts | 0.035 | 0.0035 | tax per tile unchanged |
| `TAX_PER_COM_JOB` | sim/tuning.ts | 0.045 | 0.0045 | 〃 |
| `TAX_PER_IND_JOB` | sim/tuning.ts | 0.04 | 0.004 | 〃 |
| `TRIPS_PER_UNIT` | sim/tuning.ts | [0, 1.0, 0.9, 0.8] | [0, 0.1, 0.09, 0.08] | trips per tile unchanged: traffic never saturates from the scale |
| `BUILDING_TRIPS` | sim/tuning.ts | 0.5 | 0.05 | 〃 for buildings |
| `SEAPORT.tradeRate` | config.ts | 0.12 | 0.012 | "Port trade" per seaport unchanged (cap 2,000 CR unchanged) |
| `TOURISM.spend` | config.ts | 0.35 | 0.035 | "Tourism" income unchanged |
| corp grant | sim/incidents.ts | `1500 + 0.4 × pop` (1,500–12,000) | `1500 + 0.04 × pop` | grants unchanged |
| `SALT.perPop` | config.ts | 0.08 | 0.008 | salt price unchanged for the same city |
| `POWER_WEIGHTS.basalt.jobsIndDiv`, `.nacre.jobsComDiv` | config.ts | 8 | 80 | Balance of Power unchanged |
| zone and building power draw | config.ts | per tile / per building | unchanged | power per resident falls 10× automatically |
| building and road upkeep | config.ts | per building / per tile | unchanged | upkeep per resident falls 10× with it |

### 4.4 Complete rescale table

Every other number with people in it, by file. "×10" means every entry multiplied by 10.

| File | Constant / place | Old → New |
|---|---|---|
| config.ts | `ZONES.*.capacity` | ×10 (§4.2) |
| config.ts | `BUILDINGS.*.residents`, `.jobs` | ×10 (§4.2) |
| config.ts | `BUILDINGS.*.unlockPop` | reactor 600 → 6,000; precinct 150 → 1,500; clinic 400 → 4,000; datahub 1,000 → 10,000; maglev 2,000 → 20,000; spire 5,000 → 50,000; arcology 12,000 → 120,000; academy 1,500 → 15,000; seaport 5,000 → 50,000; airport 12,000 → 120,000; spaceport 30,000 → 300,000 |
| config.ts | `BUILDINGS.*.desc` with numbers | Spire "6,000 office jobs"; Arcology "for 30,000 residents"; Foundry "2,500 Fab jobs" (MW unchanged) |
| config.ts | `BUILDINGS.stack.gate.fallbackPop` | 8,000 → 80,000 |
| config.ts | `MILESTONES[].pop` | ×10, plus three new rows (§4.5) |
| config.ts | `UNLOCK_FALLBACK_POP` | factions, comms 30,000; stack, deals 80,000; crackdown, pact, turfOverlay 60,000; skybridge, rail 90,000; crowns 200,000 |
| config.ts | `TURF.seedPop` | undertow 12,000; kites 25,000 |
| config.ts | `STACK_STAGES[].res`, `.jobsCom`, `.jobsInd` | ×10 |
| config.ts | `CROWNS.*.jobsInd`, `.residents`, `.summary` | ×10; summaries "+2,500 Fab jobs, smoke at the top." and "+6,000 residents in cheap floors, approval +3." |
| config.ts | `ROAD_KINDS[].unlockPop`, `SKYWAY.unlockPop` | avenue 15,000; highway and ramp 50,000; alley 12,000; skyway 120,000 |
| config.ts | `SEAPORT.exportJobs` | 260 → 2,600 |
| config.ts | `AIRPORT.comJobs` | 240 → 2,400 |
| config.ts | `SPACEPORT.indJobs`, `.comJobs` | 200 → 2,000; 300 → 3,000 |
| config.ts | `EDGE_LINKS.ind`, `.com` | 25 → 250; 12 → 120 |
| config.ts | `TOURISM.airport`, `.spaceport`, `.perHighCom`, `.perEdgePoint`, `.landmark` | 12,000; 30,000; 30; 400; spire 1,500, arcology 1,000, memorial 2,000 (`comPerVisitor` 0.06 unchanged: jobs and visitors both ×10) |
| sim/tuning.ts | `RES_STARTER`, `COM_BASE`, `IND_EXPORT_BASE` | 220 → 2,200; 25 → 250; 100 → 1,000 |
| sim/tuning.ts | new `RES_DEMAND_FLOOR`, `JOB_DEMAND_FLOOR` (the `Math.max(160, …)` and `Math.max(60, …)` in `census.demandTarget`) | 1,600; 600 |
| sim/tuning.ts | `UNEMPLOYMENT_FULL_POP`, `CRIME_TOWN_POP`, `CRIME_CITY_POP` | 8,000; 30,000; 200,000 |
| sim/tuning.ts | `EVENT_MIN_POP` | 60 → 600 |
| sim/incidents.ts | grid hack `population >= 300` | 3,000 |
| sim/advisor.ts | `pop > 120` (jobs), `pop > 60` (shops), `pop > 200` (tax) | 1,200; 600; 2,000 |
| news.ts | every `minPop` / `maxPop` | ×10 |
| render/art/traffic.ts | `pop / 1200` | `pop / 12000` |
| render/art/skytraffic.ts | `pop / 3000`, `pop > 600` | `pop / 30000`, `pop > 6000` |
| story/content/chapters.ts | triggers, fallbacks, goals, beat conditions, goal labels and `show.target` | Ch1 beats `pop ≥ 1,000` / `≥ 3,000`, goal 6,000; Ch2 trigger 15,000 (fallback 10,000), goals 30,000 and `pop ≥ 10,000` on `c2.jobs`; Ch3 50,000 (35,000), goal 70,000; Ch4 90,000 (60,000), goal 120,000; Ch5 150,000, goal 180,000; Ch6 220,000 |
| story/content/cards/undertow.ts | `ut.surge` `pop ≥ 2000` | 20,000 |
| story/content/cards/nacre.ts | `nc.census` `pop ≥ 3000` | 30,000 |
| story/content/cards/board.ts | `bd.ballot` `pop ≥ 3000` | 30,000 |
| world.ts / districts/migrate.ts | loaded `maxPopulation`, `milestones` (saves without `scale`) | ×10, mapped to the new thresholds |
| tests | every population expectation (balance, playthrough, story harness, expansion balance) | ×10 (Step 0a) |
| docs/STORY.md, docs/EXPANSION.md | tables quoting populations, jobs and residents | ×10, with a note pointing here (Step 9) |

A lint (`tests/megacity-scale.test.ts`, Step 0a) fails on any `m('pop', …)` threshold in story content that is not a multiple of 1,000 or whose goal label number differs from its condition, and on any `unlockPop` that is not a multiple of 10.

### 4.5 Milestones

| Residents | Title | Grant (CR, unchanged where it existed) |
|---|---|---|
| 1,000 | Settlement | 1,000 |
| 5,000 | Outpost | 2,000 |
| 15,000 | Boomtown | 4,000 |
| 50,000 | Neon Metro | 8,000 |
| 120,000 | Megacity | 15,000 |
| 300,000 | Thousand Lamps | 30,000 |
| **600,000** | **Night Harbour** (new) | 45,000 |
| **1,000,000** | **Million Lamps** (new) | 60,000 |
| **2,000,000** | **Lantern Coast** (new) | 90,000 |

The new rows need more than one district (a full district holds ≈ 480,000), so they are the sandbox's growth goals. Each still gives Board +3 (STORY.md §2.6).

### 4.6 Display and realism surfaces

- **Formatting** (`ui/format.ts`, unchanged functions): the HUD shows `groupInt` below 100,000 and `abbr` above ("482k", "1.24M": three significant digits, the owner's "1.2M" style); the City map census always `abbr`; inspect, goals and news `groupInt` ("1,500,000" fits the 12-character value column). No new formatter.
- **Inspect, zone tile** (WP-2 fills `TileInfo`, WP-5 renders): subtitle "{form} · {floors} floors" ("Point tower · 41 floors"); rows Residents `1,480` and Homes `617` (residents / 2.4) for Hab Blocks, Jobs `900` for shops and fabs; a merged parcel adds the note "Part of a 2×2 tower: 5,920 residents". `floors = max(1, round(top / 6.5))` from the model's recorded top, exported by `render/buildings.ts` as `zoneFloors(tile, parcel)` (WP-4) and read by `ui/inspect.ts` (WP-5): UI may import render, Game may not.
- **Inspect, megastructures:** "Stratablock · 61 floors"; rows Residents, Jobs, Stage.
- **City map census** per district: residents, jobs, "1 job per 1.7 residents", land value.
- **Report:** a "Districts" block (one compact row per district) and the city line "2.41M residents · 1.38M jobs · 7 districts".

---
## 5. Skybridges v2

### 5.1 The four complaints and their fixes

| Complaint | Today (STORY.md §4.3) | v2 |
|---|---|---|
| Placing (fiddly drag) | drag exactly from one tall tower to another, straight along x or y | **tap a tower, tap a partner**; lanes and partners light up; after a bridge, its far tower stays selected for the next one; towers that don't line up get a **two-bridge route**; drags still work and **snap** to the nearest valid partner within 2 tiles of the finger |
| Where they're allowed (confusing, strict) | gap 2..8; any tall tower in between blocks; no skyway under the gap; 2 bridges per anchor | gap **1..10** (bridge across a single street); only something **as tall as the lower tower** blocks; skyways, rail, roads and lower buildings pass under; 4 bridges per building (6 on the Kite Mast); crossings at different heights allowed; every rule is **drawn** on the map while the tool is active |
| How they look | an 8 px glass tube, 0.24 tile wide | a 14 px tube, 0.32 tile wide with a floor slab and end collars, **seven skins** by faction and district, walkers by day, moving lights by night |
| Why build them | effects hidden in the sim | numbers on the pill and in inspect (walkers a day, cars saved, land value); **Sky Lobbies**: 3+ linked towers pull visitors and raise land value; 5+ unlock the **Halo Lookout** |

### 5.2 Skybridge and Skyway: different jobs

They stay two things with two verbs, because they serve different users at different heights with different gestures; a merged tool could not be explained in one tray line (Appendix C).

| | **Skyway** (EXPANSION §3.7) | **Skybridge** (this section) |
|---|---|---|
| Carries | cars | people |
| Height | low: a 52 px deck, about three floors up | high: 10 px under the lower tower's roof (≈ 100–250 px) |
| Placed by | dragging, like a road (≤ 24 tiles) | tapping a tower, then a partner |
| Ends on | a street (ramp) or a megastructure (dock) | two tall towers |
| Path | any L-shaped drag | same row or column (a two-bridge route otherwise) |
| Pays off | takes car traffic off the streets near its ramps; docks feed megastructures | the towers make fewer car trips; land value near both ends; Sky Lobbies draw visitors |
| Looks | dark asphalt deck, magenta edge, headlights | glass or faction-built tube, walkers, lit floors |
| Tray meta (≤ 22) | "Cars · drag like a road" | "People · tap two towers" |
| Inspect subtitle | "A raised road for cars. Skybridges are for people." | "A walkway for people. Skyways carry cars." |

The two may now cross: a skyway may run under a skybridge's gap and a skybridge over a skyway (EXPANSION §3.7's "Skybridge in the way" / "Skyway in the way" rules are removed; their heights never meet).

### 5.3 Rules

1. **Both ends are tall towers:** a level-3 Hab or Market tile that is not abandoned, or a tall building (Corp Spire, Arcology, Glarewall, Stratablock with complete stage ≥ 2, Med Tower, Pearl Atrium, Hexworks, Kite Mast, Halo Lookout). Both must be in owned districts.
2. **They line up:** same row or same column.
3. **Gap:** 1 to 10 tiles between their facing edges (`SKYBRIDGE.minGap` 2 → 1, `maxGap` 8 → 10).
4. **Clear line:** nothing in the gap may reach within 6 px of the tube, which runs 10 px under the lower anchor's roof. Heights come from a **game-side height class** (`BUILDINGS[type].height`, new optional field, and `ZONE_HEIGHT[level] = [0, 40, 100, 260]` for zone tiles, upper bounds; 260 covers a 2×2 parcel tower); anchors use the lower bound (`ZONE_ROOF[3] = 120`, `BUILDINGS[type].roof`). The renderer draws the tube at this same game-side height, so the rule and the picture agree, and the art keeps every recipe inside its class (WP-4 test). In words: "nothing as tall as the lower tower may stand in between".
5. **Limits:** a zone tower takes 2 bridges, a building 4, the Kite Mast 6 (`maxPerAnchor`, `maxPerBuilding`, `maxPerMast`).
6. **Crossing:** two bridges may cross over one tile when their tubes are ≥ 16 px apart in height; otherwise "Another skybridge crosses here".
7. **Cost** 1,200 + 250 per gap tile (was 300); **upkeep** 15 + 3 per gap tile a month ("Skybridges" line). The most expensive bridge (gap 10) costs 3,700: below `SAFETY.confirmCost`, so one bridge builds on the second tap, with **Undo** (10 s, EXPANSION §7.7 extended to skybridges: removes the link and refunds).
8. **Sealed** as today: if an end stops being tall or loses power, the bridge goes dark, costs no upkeep and does nothing; it reopens by itself.

Reasons (≤ 32 chars, for the pill and red badges): "Start on a tall tower", "Not lined up with this tower", "Too far: 10 tiles at most", "Towers touch: no gap", "Blocked by a taller building", "This tower has its 2 bridges", "This building has 4 bridges", "Another skybridge crosses here", "Not annexed yet".

### 5.4 Placement flow

1. **Select the tool** (Sky → Skybridge). Every tall tower in view glows (today's `drawAnchors`); level-2 Hab and Market towers show a faint dotted roof outline, "grows tall at level 3" on tap.
2. **Tap a tower (A).** It gets a ring. Four **lanes** (ground strips 0.4 tile wide) run along its row and column for 10 tiles past each facing edge, green up to the first blocker and red beyond it. Every tall tower whose facing edge lies in a lane gets a **badge**: green with its price ("1,450") when valid, a red ✕ when not (tapping it shows the reason in the pill). Tall towers within 14 tiles that are not in A's lanes but reachable through one intermediate tower get a blue **"2"** badge (at most 12, nearest first).
3. **Tap a green partner (B):** the bridge builds at once, with the pill showing its payoff for 3 s ("SKYBRIDGE · 1,450 CR" / "600 walkers · cars −20%") and the Undo toast. **B becomes the selected tower**, so a Sky Lobby takes one tap per bridge.
4. **Tap a blue "2":** the pill shows "2 SKYBRIDGES · 3,100 CR" and the route ghost, with ✓ / ✕ (a compound action always confirms). ✓ builds both.
5. **Tap empty ground or A again:** deselect. The tool chip's ✕ leaves the tool.
6. **Drag** still works: press on A and drag; the ghost snaps to the nearest valid partner within 2 tiles of the finger; lift to build.
7. **Desktop:** click-click, the same flow; Esc deselects.

APIs (WP-2, `story/vertical.ts`; Game wraps them): `skybridgePartners(world, ax, ay): Partner[]` (`{ x, y, ok, reason?, cost, route?: { via: { x, y } } }`), `planSkybridge` (v2 rules, fills `plan.bridge`, `plan.route`), `skybridgePayoff(world, a, b): BridgePayoff`. Partner search scans 4 lanes × 11 tiles plus, for routes, the lanes of each valid partner: under 200 tile checks, recomputed on tap and on `tiles` events while a source is selected.

### 5.5 Payoff

Per active bridge (today's effects, now shown): both towers' car trips ×0.8 (`tripMul`); land value +5% within 3 of each end; Market demand +0.01 (cap +0.08).

**Sky Lobby:** a connected group of k ≥ 3 towers linked by active bridges (`vertical.refresh`, cached in `world.vertical.lobbies`):

| Term | Value |
|---|---|
| Car trips of every tower in it | ×0.75 (instead of ×0.8) |
| Land value on and within 2 of every tower in it | +0.02 × min(k, 4) (cap +0.08), on top of the +0.05 |
| Market demand | +0.02 × (k − 2), cap +0.06 (today's cluster term) |
| Visitors (X3) | +2,000 × (k − 2) a month, cap 16,000 per lobby |
| Name | "{A} {B}" from two lists, by a hash of its lowest anchor key: Glass, Lantern, Neon, High, Copper, Pearl, Hex, Cloud, Signal, Tide, Amber, Halo × Steps, Gallery, Walk, Arcade, Rise, Loop, Concourse, Crossing, Terrace, Promenade |
| k ≥ 5 | unlocks the Halo Lookout (§6.3) |

The first lobby a city forms shows the moment banner "SKY LOBBY · GLASS STEPS" / "3 towers linked: visitors and land value" (`MomentId` gains `'lobby'`); later lobbies post one news line.

**Shown numbers** (`BridgePayoff`): walkers a day = 0.2 × (residents + jobs of both towers): two L3 Hab towers 600, a Stratablock and a Spire 6,600. Cars: "−20%" (−25% in a lobby). Land: tiles that gain +5%.

**Inspect** (tap the tube: `Selection.link`, picked like EXPANSION's sky slab at the tube's height): title "Skybridge", subtitle "A walkway for people. Skyways carry cars."; rows Walkers `600/day`, Cars `−20%`, Land `+5%`, Lobby `5 towers` (when in one), Upkeep `30/mo`; notes "Part of Sky Lobby Glass Steps: +6,000 visitors a month" (good), "Sealed: a tower here is no longer tall" (warn); action "Remove skybridge" (no refund after the 10 s undo). Anchors' inspect gains the row Skybridges `2/4` and the lobby note.

### 5.6 Art

- **Scale:** tube 0.32 tile wide (was 0.24) and 14 px tall (was 8), a 3 px floor slab, an end collar where it meets each tower; ≥ 7 screen px tall at zoom 0.5.
- **Skin** (`skinOf(link)`), first that applies: a faction crown on either end; a faction exclusive building or landmark; a Spire's sponsor; the lower anchor's district style; glass.

| Skin | From | Look |
|---|---|---|
| Glass | Charter Shore, Shoals, Terraces, default | clear glass, white mullions every 0.25 tile, lit floor strip |
| Truss box | Basalt; Kessel Flats, Tarmac Reach | square orange-lit steel truss, X-bracing (`ribs`), riveted end plates |
| Pearl ribbon | Nacre | rounded pink-white tube with a soft vertical gradient, a halo glow at night, no mullions |
| Civic arcade | Board | pale stone arches under a glazed roof, warm windows, a small flag at mid-span |
| Container chain | Undertow; the Sunk | a row of rust and blue containers with cut windows, a net and a green lamp underneath |
| Cable span | Kites; Skeleton Row, Copperline Bazaar | a light walkway on cables with a 6 px sag at mid-span (gap ≥ 4), string lights, small diamond banners |
| Lamp gallery | Tuning (only once active); Reedmere uses its timber variant | a timber-framed gallery with a row of hanging lanterns, warm light only |

- **Walkers:** by day tiny figures (2×3 px) on the floor strip, by night moving light dots; one per 150 walkers per gap tile (max 4), at zoom ≥ 0.6 only. **Sealed:** dark glass, no walkers, a red lamp at each end.
- **Ghosts:** green or red tube along the lane, both spans for a route, the lanes and badges in `overlay.ts`.
- **Caching:** segment sprites keyed (skin 0..6, axis, end or middle piece, night bucket, scale bucket) in the existing `SpriteCache` with ids from `BRIDGE_BASE = 5000`; walkers drawn live. ≤ 0.4 ms for 60 visible gap tiles.
- **Depth:** unchanged (each gap tile at its sweep key after that diagonal's buildings, `drawSkybridges`); two tubes on one tile draw lower first.

### 5.7 Data, sim and story changes

- `SkyLink` keeps its shape (bridges stay axis-aligned); the skin is derived; links are saved in world coordinates (migrated +64).
- `SKYBRIDGE` gains `perTile 250`, `minGap 1`, `maxGap 10`, `maxPerBuilding 4`, `maxPerMast 6`, `tubeBelowRoof 10`, `clearance 6`, `crossGap 16`, `walkerShare 0.2`, `lobby: { min: 3, tripMul: 0.75, lvPer: 0.02, lvCap: 0.08, lvRadius: 2, visitorsPer: 2000, visitorsCap: 16000, halo: 5 }`. Existing links stay valid (every old gap 2..8 is inside 1..10).
- `vertical.refresh` (WP-2) computes lobbies and writes their trip and land-value terms into the vertical layer part; `world.vertical.lobbyVisitors` is added to raw visitors by `PortSystem` (WP-1). New metrics `skylobby.count`, `skylobby.max`.
- Kites keep "Skybridges +2 per active skybridge, max +8".
- Glossary "Skybridge" (WP-7, replaces today's text, 194 chars): "A walkway for people between two tall towers that line up along a street. It cuts car trips at both towers and lifts land value. Three or more linked towers form a Sky Lobby that draws visitors."

---

## 6. Variety

### 6.1 Buildings that don't repeat

Three layers, all render-side (the sim is untouched): **parcels** merge matching tiles into bigger buildings, a **modular kit** adds 16 parametric templates to the 8 hand-built forms per zone and level, and a **district style** picks materials, roofs, windows, signs and props. EXPANSION's wealth-tier dressing (`dressTier`) runs after every recipe as today.

#### Parcels (`src/render/parcels.ts`, WP-3; WP-4 draws them)

- For each **2×2 block aligned to even coordinates** (world coordinates; the start slot's offset 64 is even, so a migrated city aligns as before): if all four tiles are the same zone, developed, not abandoned, same level and same tier, and `hash(artX, artY, seed) < MERGE[level]` (L1 0.35, L2 0.5, L3 0.65, +0.1 at $$$), it is one **2×2 parcel**.
- Otherwise each aligned pair along x, then along y, with the same rule at 0.5 → a **2×1** or **1×2 parcel**. Otherwise single tiles.
- `ParcelMap` (`Uint8Array(AREA)`: bits 0-1 shape, bit 2 head, bit 3 member) is rebuilt for the aligned blocks a `tiles` event touches and on `world`. Tier changes emit no `tiles` event (EXPANSION §4.3), so the head re-checks its members' zone, level, tier and abandonment each draw (three reads) and draws singles while they disagree.
- The head (front corner) draws one sprite for the whole parcel; members draw nothing; the sweep treats the parcel like a multi-tile building (sort key at its front corner). A tap on any member selects it and highlights the parcel; inspect adds the parcel note (§4.6).
- Parcel L3 towers may be up to 1.6× the height of a 1×1 L3 tower ("towers on bigger lots go higher"), within the height class of §5.3 (`ZONE_HEIGHT[3]` = 260).

#### The kit (`src/render/art/kit.ts`, WP-4)

`kitRecipe(spec): Recipe`, spec `{ zone, level, tier, style, form, parcel, palBit }`. Forms 0..7 are today's 72 hand recipes (kept, they work); forms 8..23 are templates. Each template draws with the existing Painter primitives (`box`, `chamfer`, `prism`, `cyl`, `dome`, `saw`, `ribs`, `ring`, `stack`, `tank`, `antenna`, `dish`, `greens`, `laundry`, `awning`, `blade`, `board`, `ticker`, `container`…), with parameters from `p.rng`:

| Zone | Templates (level / parcel) |
|---|---|
| Hab Blocks | walk-up with external stair and water tank (L1); row houses with chimneys (L1, pair); capsule cluster (L1–L2); courtyard block (L2, quad); slab with balcony bands (L2); tenement around a laundry yard (L2, pair); point tower with 0–2 setbacks (L3); stepped setback tower (L3); twin towers on a podium (L3, quad) |
| Market Strip | stall row under cables (L1); corner shop with blade sign (L1); arcade with awnings (L2); mall box with glass atrium (L2, pair or quad); office slab (L2); glass tower with a crown (L3); hotel tower with a vertical sign (L3); podium tower with a holo billboard (L3, quad) |
| Fab District | shed with roller doors (L1); container yard (L1); sawtooth hall (L2); tank farm (L2); silo cluster (L2–L3); stack hall with chimneys (L3); cleanroom block ($$$ any level); crane warehouse (pair or quad) |

Parameters: height within the level's band × the style's multiplier, ±20%; footprint inset 0.05–0.2; setbacks 0–3; roof (flat with plant, gable, sawtooth, garden, helipad, antenna crown, water tower, solar, dome, pyramid); windows (grid, band, curtain, slit, capsule, louver, balcony stack, lattice); wall material from the style; neon trim from the palette; signage (none, blade, wall sign, billboard, holo panel; billboards only on Market L2+, probability 0.4); 0–4 roof clutter props. Signs use an **invented glyph set** (40 abstract glyphs on a 3×5 stroke grid; never a real letter, script or logo); billboards are colour blocks and shapes.

**Form choice:** `form = pickForm(hash(variant, artX, artY), style, zone, level, parcel)`, classic forms 40% and templates 60% by default (styles reweight). A migrated city re-picks too: that change is the variety the owner asked for, and its colour mix (palettes) stays.

#### District styles (`src/render/art/styles.ts`, WP-4; ground props in WP-3)

| Style | Walls | Roofs | Windows | Signs | Props | Height × |
|---|---|---|---|---|---|---|
| shore (Charter Shore) | today's sets | today's | today's | today's | today's | 1 |
| shoals | white and pastel render, pale timber | flat with railings, small domes | band, curtain | sparse, pastel neon | stilts under ground floors on shore tiles, rope rails, rooftop sails | 0.9 |
| sunk | patched brick, salvaged sheet metal, waterline stain to 8 px | tarps, upturned-hull roofs on L1 | capsule, grid with boarded panes | hand-painted, green neon | mooring rings, hanging lamps (green), boats at doorways | 0.85 |
| flats | corrugated steel, soot brick | sawtooth, gable | slit, grid | stencilled numbers | chimneys, pipe racks, conveyors | 1 |
| terraces | dressed stone, plaster | terrace gardens, gable | grid, balcony stack | small, warm | stair lamps, planters on every setback | 0.95 |
| reedmere | timber, green panels | green roofs, gable | grid, louver | few | boardwalks, reed planters, rain chains | 0.85 |
| skeleton | raw concrete, exposed rebar on the top 12 px | flat with tarps and a crane hook | grid with dark gaps | spray tags | scaffold on 30% of L2–L3 tops | 1.1 |
| tarmac | ribbed metal, painted concrete | wide flat, hangar arcs | band | big numbers | windsocks, obstruction lights | 0.8 |
| bazaar | copper and verdigris, ochre plaster | copper hips and pyramids | small grid | dense, every glyph colour | awnings, lantern strings between tiles, stall crates | 0.9 |

#### Ids, memory and paint budgets

- Model id: `KIT_BASE (1,000,000) + ((((((zone − 1)·3 + level − 1)·3 + tier)·10 + style)·24 + form)·4 + parcel)·2 + palBit` (< 1,052,000). Classic forms on single tiles in the `shore` style keep EXPANSION's ids (0..431). The sprite key formula is unchanged (ids up to 10¹¹ are safe).
- **Sprite cache** 32 MB on high quality (unchanged), 20 MB on low; paint budget 3 ms a frame (unchanged).
- **Generic fallback:** a kit body never painted yet draws the classic body of the same zone, level, tier and palBit while it waits its turn in the paint budget (classic bodies are painted first and stay warm), so a fast pan never hitches; the real body replaces it within 300 ms at zoom 1.
- **Targets** (WP-4 acceptance, measured with the megacity fixture and a scripted pan): distinct bodies on screen at zoom 1, portrait, full district ≤ 220; sprite memory there ≤ 26 MB at DPR 2; sprites painted per second while panning ≤ 1.5× v3; **adjacent-identical rate** (a tile and any of its 8 neighbours drawing the same body) ≤ 3% (v3 measured by the same test as the baseline); every kit template ≤ 1.2 ms to paint at scale 1.

### 6.2 Faction architecture languages

Each faction gets a design language an artist-programmer can apply with the Painter kit: palette (day RGB; night colours via `nightOf` unless given), shapes, rules, light, and **three variants** (a fourth where noted for the tallest uses). Variant 0..2 (0..3 for Spires) is `Building.look`: chosen by the player in the crown picker and the Spire sponsor step, by hash elsewhere.

| | **Basalt** "Hex and Furnace" | **Nacre** "Pearl and Spiral" | **Board** "Civic Stone" | **Undertow** "Salvage and Tide" | **Kites** "Rig and Sail" | **Tuning** "Lamp and Hymn" |
|---|---|---|---|---|---|---|
| Palette | basalt black [52, 50, 56], rust steel [120, 80, 60], hazard yellow [230, 190, 40] | pearl [232, 226, 236], blush glass [214, 176, 206] / night [40, 26, 48], ice [180, 230, 255] | limestone [214, 214, 206], slate [96, 104, 120], verdigris [120, 180, 160] | rust [132, 84, 60], hull green [56, 92, 80], tarp blue [60, 120, 140], net grey | lilac [201, 162, 255], sailcloth [236, 236, 246], cable black | candle cream [255, 243, 196], copper [184, 115, 51], night blue |
| Light | furnace orange [255, 123, 46], sodium | soft pink halos [255, 198, 241], no hard strips | warm windows [255, 220, 160], banner blue | green-tinted lamps [182, 255, 46] | string lights [255, 214, 150], UV mural glow | warm only: every window candle-lit |
| Shapes | hex prisms (`prism`, 6 sides), chamfered buttresses, riveted trusses (`ribs`), sawtooth roofs, flame stacks | cylinders and ellipses (`cyl`, `cylGrad`), stacked offset discs, domes, rings (`neonRing`), curtain glass | symmetric stepped blocks, colonnades (thin boxes), arcades (`door` arches), domes, clock faces (`ring` + hands), nine pennants | containers, upturned hulls (half-prism keel), scaffolds, nets (`laundry`), cranes (`pipe` + hook), patched faces (mixed materials on one wall) | antenna forests, diamond sails (quads on masts), platforms, ladders, dishes, murals (`board`) | pointed lantern roofs, copper coils (`cylBands`), bell domes, lantern rows, concentric ground rings |
| Rules | no curves except chimneys; the base ≥ 30% wider than the top; 2–3 tiers | no sharp roof corners (dome, ring or taper on top); vertical gradient pearl → blush | always bilateral symmetry; podium, body, crown; arcade at street level; never advertising | always asymmetric; ≥ 3 materials; something hangs (nets, lamps) | always light add-ons over something; diagonals; never heavy masonry | no cool light, no billboards |
| Variant 0 | **Hex Column**: three stacked hex prisms (radius 0.9 / 0.75 / 0.6 tile, 90 / 80 / 60 px), an orange slit band at each joint, a flame stack | **Spiral**: 12 discs each turned 15°, tapering | **Charter block**: colonnaded block with a verdigris dome and nine flags | **Hull Stack**: containers three high under an upturned boat hull | **Antenna Forest**: 8–12 masts of mixed height with blinking tips | **Lamp Chapel**: pointed roof with an open lantern |
| Variant 1 | **Buttress Hall**: a long block with four wedge buttresses a side and two stacks | **Pearl Drop**: a slim stem with a bulb top 1.4× as wide and a ring halo | **Stepped Tower**: three setbacks, a clock face on the top tier | **Net Loft**: a scaffold tower hung with drying nets and lanterns | **Sail Canopy**: four diamond sails on masts over the roof | **Coil Belfry**: a copper coil tower with a humming glow |
| Variant 2 | **Crucible**: a tower crowned by a glowing bowl (orange glow and embers) | **Ribbon Twins**: two slim towers joined by a curved ribbon at 70% height | **Lantern Belfry**: a slender tower with an open lit top | **Crane Hab**: a dock crane with cabins along the jib | **Rope Roost**: stacked platforms, ladders and nets | **Choir Ring**: a ring of lit windows around a court |
| Variant 3 (Spires only) | **Gantry Spine**: an open lattice core with a gantry crane on top | **Halo Atrium**: a wide dome with two floating rings | — | — | — | — |

**Where each language appears:**

| Structure | Rule |
|---|---|
| **Corp Spire** | placing one adds a **sponsor** step to its confirm pill (it costs ≥ 10,000): Basalt, Nacre or Independent, with a 44 px segmented control and the look (variant) shown in the ghost. Basalt: Basalt language, 40% of its 6,000 jobs are Fab, the build reaction is Basalt +6, Nacre +2, Undertow −2, and its power weight 120 counts for Basalt. Nacre: today's numbers (Nacre +6, Basalt +2, Undertow −2, weight to Nacre). Independent: today's faceted spire plus two new independent variants, Board +3, prestige r14 (instead of 16), no faction weight. Old spires without `sponsor` read as Nacre. |
| **Stratablock** | Plinth and Hab Core in the district style; the **crown** in its faction's language with three looks chosen in the crown picker (thumbnails): Foundry (Basalt: Crucible, Hex Column, Gantry), Glare (Nacre: Pearl Drop, Halo, Spiral), Kite Nest (Kites: Antenna Forest, Sail Canopy, Rope Roost), Commons (Board: Stepped, Lantern Belfry, terrace gardens), and two new crowns: **Salvage** (Undertow, needs Undertow Friendly: +3,000 untaxed jobs, ↻ "Off-ledger" +300/mo, Undertow turf protected r2; Undertow +8, Board −4, power +80) and **Lamp** (Tuning, needs the Tuning active and Friendly: approval +2, upkeep ×0.99 per crown, Tuning +8, Basalt −3). `CrownId` gains `'salvage' | 'lamp'`. |
| **Faction buildings** | Foundry Spine (Basalt 0–2), Glarewall (Nacre 0–2), Tidemarket (Undertow 0–2), Kite Roost (Kites 0–2), Commons Hall (Board 0–2): three looks each by hash. |
| **Arcology** | by district style: ziggurat (today's, Shore), Hive (honeycomb hex cells, Kessel and Tarmac), Hanging Gardens (stepped green terraces, Terraces and Reedmere), Pier Arcology (on stilts at the water's edge, Shoals and the Sunk), Ring (a circle of towers around a lit court, Copperline and Skeleton Row). Same numbers. |
| **Faction landmarks** | §6.3: Charter Hall (Board), Hexworks (Basalt), Pearl Atrium (Nacre), Hullhouse (Undertow), Kite Mast (Kites), Lamp Choir (Tuning), each a hero piece in its language. |
| **Skybridge skins** | §5.6. |
| **Turf decals** | unchanged (STORY.md §3.7). |

What works today stays: the reactor's dome and torus, the Spire's faceted glass and crown light, the Arcology's lit ziggurat, the Stratablock silhouette and its four crowns become variant 0 of their families.

### 6.3 Landmarks and new civic buildings

All new types go into `BUILDING_ORDER` **before `'stack'`** (the story types stay `slice(-7)`), with `meta` lines ≤ 22 chars, `plural` where needed and art in WP-4. Landmarks have `maxCount: 1`. New gate fields (`BuildingGate`, additive): `district?: DistrictKind` (owned, footprint inside it), `lobby?: number` (a Sky Lobby of at least n towers), `districts?: number` (owned count), `chapter?: number` (chapters completed). The gate rule of STORY.md §4.5 gains them as further **AND** terms; `lockedReason` names the first missing part ("Needs the Shoals", "Needs a Sky Lobby of 5 towers").

**Landmarks (one each):**

| id | Name | Size | Cost | Upkeep | Power | Unlock | Effect | Jobs (×10) | Core? |
|---|---|---|---|---|---|---|---|---|---|
| `charterhall` | Charter Hall | 3×3 | 30,000 | 300 | uses 20 | Board Friendly and Ch3 done (fallback 300,000 residents) | park r10; approval +3 while it stands; Board power +100 | 800 | core |
| `hexworks` | Hexworks | 4×4 | 60,000 | 600 | supplies 2,500 MW | Basalt Allied, or patron Basalt and 300,000 residents | pollution 0.35; Basalt power +120; tall | 6,000 Fab | core |
| `pearlatrium` | Pearl Atrium | 3×3 | 55,000 | 500 | uses 60 | Nacre Allied, or patron Nacre and 300,000 residents | prestige r18; visitors +20,000/mo; Nacre power +120; tall | 4,000 | core |
| `kitemast` | Kite Mast | 2×2 | 12,000 | 0 | uses 10 | Kites Allied | net r22; Trace −1 a month; tall, takes 6 skybridges; Kites power +100 | 0 | core |
| `beacon` | Harbour Beacon | 1×1 | 8,000 | 40 | uses 4 | the Shoals owned and 120,000 residents; a Shoals shore tile | prestige r10; visitors +5,000/mo; a sweeping beam at night | 50 | core |
| `arena` | Arc Arena | 4×4 | 80,000 | 700 | uses 80 | 300,000 residents | visitors +25,000/mo; hosts Arena Night (§6.4); noise 0.5 r6 only during an event | 1,500 | core |
| `halolookout` | Halo Lookout | 2×2 | 40,000 | 300 | uses 30 | a Sky Lobby of ≥ 5 towers | tall, takes 4 skybridges; works only while bridged into a Sky Lobby: visitors +15,000/mo, land value +0.06 r10 | 400 | core |
| `hullhouse` | Hullhouse | 3×3 | 15,000 | 0 | uses 8 | Undertow Allied; inside the Sunk | ↻ "Off-ledger" +600/mo; crime +0.05 r6; protects Undertow turf r5; Undertow power +100 | 2,500 (untaxed) | optional |
| `lampchoir` | Lamp Choir | 2×2 | 9,000 | 60 | uses 6 | the Tuning active and Friendly | approval +2 while it stands; upkeep ×0.98 city-wide | 100 | optional |
| `terminal` | Grand Terminal | 4×4 | 70,000 | 500 | uses 50 | 3 districts owned and a live ribbon with ≥ 4 stations | ribbon station counted twice; transit r16; joins every Metro Station into one network | 1,200 | optional |

**Civic and utility (repeatable):**

| id | Name | Size | Cost | Upkeep | Power | Unlock | Effect | Jobs (×10) | Core? |
|---|---|---|---|---|---|---|---|---|---|
| `floodwatch` | Floodwatch Station | 2×2 | 1,800 | 90 | uses 6 | 15,000 residents, or the Shoals, the Sunk or Reedmere owned | `resilience` r12: cancels king tides and the floodplain cap; incident outages in range last half as long | 150 | core |
| `pumphouse` | Pump House | 1×1 | 900 | 20 | uses 4 | a shore tile in the Sunk, the Shoals or Reedmere | reclaims water within r2 over 90 d, one ring per 30 d (never berths, bridges, rail, or water more than 3 tiles from land), then becomes a pump garden (park r3); 16 per district at most | 30 | core |
| `canopypark` | Canopy Park | 3×3 | 1,200 | 30 | uses 2 | 15,000 residents | park r12 | 20 | core |
| `medtower` | Med Tower | 3×3 | 9,000 | 380 | uses 30 | 120,000 residents | health r20; tall | 1,200 | core |
| `reclaim` | Reclaim Works | 2×2 | 3,000 | 140 | uses 12 | 50,000 residents, or Kessel Flats owned | `filter` r10; brownfield clears twice as fast | 400 Fab | core |
| `metro` | Metro Station | 1×1 | 4,000 | 160 | uses 10 | 120,000 residents and 2 districts | transit r9; with powered stations in ≥ 2 districts, every station gets transit r12 and trips ×0.9 within r4 | 60 | core |
| `markethall` | Market Hall | 2×2 | 1,500 | 60 | uses 6 | 15,000 residents | visitors +1,500/mo; Market demand +0.01 each (cap +0.05); approval +0.5 each (cap +2) | 120 | optional |
| `tidal` | Tidal Turbine | 2×2 on water | 6,000 | 120 | supplies 600 MW | the Shoals, the Sunk or Reedmere owned | clean power; 4 water tiles (not berths), 2 sides on water (`site: 'water'`) | 40 | optional |
| `geothermal` | Geothermal Bore | 2×2 | 9,000 | 180 | supplies 900 MW | Lantern Terraces owned; flat at step ≥ 1 | clean power | 60 | optional |
| `datavault` | Data Vault | 3×3 | 12,000 | 300 | uses 120 | 300,000 residents | net r18 | 600 | optional |

Unlocks sit on the milestone populations (15,000 Boomtown, 50,000 Neon Metro, 120,000 Megacity, 300,000 Thousand Lamps), so the milestone banner announces them, as in EXPANSION. `frame` (Skeleton Row) is never in a tray. Build reactions and power terms: §8.4. Descriptions (≤ 90 chars) and `meta` lines are in Appendix A.

### 6.4 Life and atmosphere

All of it lives in `Effects` and its art modules (WP-6), reads the world, and changes no rule except the small, labelled city-event terms. Low quality turns crowds, boats and fog patches off.

| Item | What | Budget | Core? |
|---|---|---|---|
| **Crowds** (`art/crowds.ts`) | 2×3 px figures (head dot and body, six colours) on the sidewalks of visible road tiles beside developed Market and Hab tiles; density by local Market level and time of day (evening peak); groups gather at plazas, Market Halls, stations and the Arena; umbrellas (a 3 px arc) in rain; walkers move along tile edges at 0.3 tiles/s and turn at corners | ≤ 300 figures, zoom ≥ 0.8, ≤ 0.6 ms | core |
| **Weather** (`art/weather.ts`) | `Settings.weather: 'full' \| 'light' \| 'off'` replaces the `rain` toggle (`rain: true` reads `'full'`, `false` reads `'off'`; `rain` is still written for old builds). Today's rain and storms stay; new: **fog** (two pre-rendered fog band canvases 512×256 drifting in screen space, alpha 0.25 Full / 0.12 Light, on fog mornings §1.4 and in storms, plus ≤ 40 ground fog patches over water and reed tiles at zoom ≥ 0.5), **neon reflections** (during rain at night, 1–2 tinted streak sprites on road tiles beside lit Market tiles L2+, ≤ 120 a frame, zoom ≥ 0.6), **haze** (a warm grey screen grade proportional to `avgPollution`, alpha ≤ 0.15). District bias: Reedmere and the Sunk fog `0.6`, Kessel haze ×1.5, the Shoals' rain angle steeper | ≤ 0.5 ms total | fog + reflections core; haze optional |
| **Vehicles** (`art/traffic.ts`) | new kinds on the EXPANSION car system: **buses** on avenues (12% of avenue spawns; a long lit body), **delivery vans** (everywhere), **cargo trucks** to the Seaport and Fab tiles (and the 35% on highways), **taxis** near the Airport, stations and $$+ Market tiles, **police cruisers** near precincts (blue and red at night) | the existing car cap and budget | core |
| **Boats** (`art/boats.ts`) | water taxis and barges on canals and channels (the Sunk, Reedmere, Shoals, harbour), routed over a cached water-tile graph per owned slot; ferries between Shoals islands without bridges; a wake trail | ≤ 24 visible, ≤ 0.2 ms | core |
| **Drones** (`art/skytraffic.ts`) | delivery drones (tiny blinking dots) over Market areas | the existing sky budget | optional |
| **District character** | ground props per style (§3.9), building styles (§6.1), weather bias above; *optional* district ambience loops (gulls, machinery, market chatter) in `audio.ts` | — | core (ambience optional) |
| **City events** | §6.4.1 | ≤ 0.4 ms while one runs | core (4), optional (2) |

#### 6.4.1 City events (`src/game/cityEvents.ts`, Game-side, WP-6)

Real-time and never interrupting: `CITY_EVENTS = { firstAfterSec: 600, gapSec: [420, 900], maxActive: 1 }` in unpaused real seconds (`Game.update` drives it with the frame's `dt`, frozen while paused). Each event posts **one ticker line** at its start (news `info`), never a toast, card or banner. Its gameplay is small, labelled and temporary, through one optional World field the sim reads (not saved: an event in progress simply ends on reload): `world.cityEvent: { id, until (unpaused seconds left), visitors, approval, demandCom, slot? } | null` (Step 0b adds the field and the two read sites: `census.approval` adds `approval`, `PortSystem` raw visitors add `visitors`; `demandTarget` adds `demandCom`).

| id | When (checked at each gap) | Lasts | Visual | Gameplay while it runs | Core? |
|---|---|---|---|---|---|
| `nightmarket` | a district with ≥ 40 developed Market tiles (Copperline first); night | 120 s | lantern strings over that district's streets and alleys, crowds ×2 near Market tiles, stalls on sidewalks | Market demand +0.03, visitors +3,000 | core |
| `lanterns` | sim month 10, ≥ 50,000 residents, once a sim year | 150 s | sky lanterns (≤ 60 glow sprites) rising from parks and plazas | approval +1 | core |
| `stormwatch` | the weather turns Storm | 90 s | flood barriers rise on Shoals and Sunk shores, Floodwatch beacons spin, signs flicker | none | core |
| `arenanight` | the Arena exists (every third slot) | 120 s | searchlights over the Arena, crowds streaming from stations | visitors +8,000; noise 0.5 r6 around it | core |
| `kiteday` | Kites Friendly, by day | 120 s | kites over Kites turf | none | optional |
| `parade` | approval ≥ 70 | 90 s | confetti and floats along the longest avenue | approval +1 | optional |

Ticker lines (Appendix B) name the place with `{district}` (a neighbourhood in the event's slot). Events never stack with an open story card's pause (paused time doesn't count). EXPANSION's launches are not city events and keep their own clock.

---
## 7. Phone UI

### 7.1 Toolbar: still 9 buttons; trays get section chips

| Button (short) | Change |
|---|---|
| Info, Demo, Road, Zone | unchanged |
| **Infra** | adds Tidal Turbine and Geothermal Bore (optional types); chips **Power · Ports** |
| **Civic** | chips **Safety** (Precinct, Floodwatch, Clinic, Med Tower) · **Parks** (Plaza, Canopy Park, Market Hall, Memorial) · **Learning** (Academy, Data Hub, Data Vault) · **Transit & works** (Maglev, Metro, Reclaim Works, Pump House) |
| **Sky** | chips **Towers** (Stratablock, Spire, Arcology) · **Links** (Skybridge, Ribbon Rail, Skyway) · **Landmarks** (Harbour Beacon, Arc Arena, Halo Lookout, Grand Terminal) |
| **Deals** | chips **Buildings** (Commons Hall, Foundry Spine, Glarewall, Tidemarket, Kite Roost) · **Landmarks** (Charter Hall, Hexworks, Pearl Atrium, Hullhouse, Kite Mast, Lamp Choir) |
| **Data** | first card **City map** (opens §7.2); then the views as EXPANSION §7.3 |

- **Section chips:** 44 px tall pills in a row at the top of the tray, at most 4 per tray, at most 6 cards per chip (so a 390 px tray shows 3½ cards and the scroll fade of EXPANSION §7.2 still hints the rest). The last chip per category is remembered for the session (memory only). EXPANSION's "new" dot also shows on the chip that holds the new card. Landscape compact tray (`max-height: 520px`): the chips are the first items of the single row (44×44 icon and short label).
- **Rumoured cards:** a locked landmark or district-bound type stays hidden until the player is one step away (its faction at Friendly for an Allied gate; 50% of its population unlock; its district owned or a candidate), then shows greyed with its condition ("Needs Basalt Allied", "Needs the Shoals"). Trays never fill with cards the player can't reach.
- **Meta lines** (≤ 22 chars, Appendix A): Skybridge "People · tap two towers", Skyway "Cars · drag like a road".

### 7.2 City map and annexing

**Entry points:** (1) the **map button** in the HUD's top-right cluster (44×44, a map icon with a gold dot and count while a charter waits; label "City map" on wide screens); (2) Data → City map; (3) pinching out past zoom 0.4 in a multi-district city shows the atlas (§3.9) with a "City map" chip; (4) an **Annex pin** on the boundary; (5) the **Map** action on a "Not annexed yet" toast. The sim keeps running (it is a panel like the budget, not an interruption).

**Portrait (390×844, 360×640):**

```
┌───────────────────────────────┐
│ City map        ✦ 2 charters ✕│  44 px header
│          ◇                    │
│       ◇  ◆  ◇      atlas      │  ≈ 50% height: the 3×3 slots as one diamond fitted to the width
│          ◆  ◆                 │  (slot diamonds 120×60 px at 390, 110×55 at 360)
│             ◇                 │  ◆ owned (impostor, name, residents)  ◇ candidate (fog preview, icon, lobby sigils, pulsing +)
├───────────────────────────────┤
│ Kessel Flats                  │  bottom sheet, drag to 85%
│ Slag, rail yards and a long…  │  tagline
│ Land 89% · Water 11% · 1 dock │  terrain line (islands, ruins, frames, steps, channels by kind)
│ + Fab zoning half price       │  perks (green, ≤ 3)
│ ! Brownfield smog until …     │  hazards (amber, ≤ 2)
│ (hex) Sallow: "The Flats pay… │  lobbyists: sigil + quote
│ Annexing: Basalt ++ · Nacre − │  summary in the choice-summary style
│ 3 regional links here become… │  only when it applies
│ Uses 1 charter (1 left)       │  price line
│ [   Annex Kessel Flats    ]   │  52 px primary, in the bottom 40% (one thumb)
└───────────────────────────────┘
```

**Landscape (844×390):** atlas on the left 55%, sheet on the right 45% (scrolls).

- **Slot states:** owned (impostor, short name, residents in `abbr`; the sheet shows its census, perks and "Go there"); candidate (as above); not adjacent (dimmer, a lock, "Not next to the city yet"); bought-able in the sandbox (price instead of charter).
- **Price line:** "Uses 1 charter (1 left)"; "250,000 CR" (sandbox, no charter left); "Next charter: finish Chapter III" (story, no charter); "Not next to the city yet".
- **Lease (Tarmac Reach only):** two 44 px segmented buttons, "Nacre: terminal" and "Basalt: cargo", each with its summary line ("Nacre ++ · Basalt −"); **Annex** stays disabled until one is picked.
- **Confirm:** tapping Annex turns the button into "Annex Kessel Flats? ✓ ✕" (each ≥ 44×44); Enter = ✓ on desktop. ✓ calls `game.annex(slot, lease)`, closes the sheet, flies the camera in (1.2 s, a tap skips) and lifts the fog (1.5 s); the banner follows (`MilestoneBanner`).
- **"?"** in the header: "Every chapter you finish grants a district charter. Spend it here to annex a district next to your city. Each district has its own land, perks and problems, and some factions lobby for one or another. After Charter Night you can buy the last districts with credits."

### 7.3 HUD and goal chip

- The map button (above). No other HUD element is added; the 360 px top bar keeps its current items.
- The goal chip (story rail) shows a gold "✦ 1" token while a charter waits; tapping the token opens the City map. The amber "message waiting" state keeps priority over it.

### 7.4 Skybridge tool

As §5.4. Input (WP-5): taps on tall towers and badges are hit-tested in screen space (badge 44 px round, anchored above the tower's roof); the tube is pickable at its height (a slab like EXPANSION's sky slab, `PickFootprint.base`) and selects `{ x, y, link }`. While a source is selected, the pill shows the source's state ("TAP A PARTNER · 3 in reach"); during a route confirm, ✓ / ✕ as EXPANSION §7.7.

### 7.5 Inspect additions

Values stay ≤ 12 characters; longer text goes in note rows (EXPANSION §7.4).

| Tile | Additions |
|---|---|
| Zone tile | subtitle "{form} · {n} floors"; Homes (Hab); District `Kessel Flats` (the 12-char short name); notes: parcel; "Floodplain: level 2 at most without a Floodwatch" (warn); "Brownfield: smog until the soil clears" (warn); "Reedbed: a free park while unbuilt" (good); "Terrace 2: views +7%" (good); "Ruin: comes back with a road and power" (good) |
| Locked tile | the district preview (name, tagline, perks, hazards, lobbyists); action "Open City map" (`InspectAction 'map'`) |
| Skybridge tube | §5.5; action "Remove skybridge" (`'bridgeRemove'`) |
| Tall tower | Skybridges `2/4`; lobby note |
| Corp Spire | Sponsor `Basalt` |
| Stratablock | Look `Crucible` (crown stage) |
| Frame | title "Unfinished frame", subtitle "Finish it as a Stratablock with its Plinth done."; action "Finish frame · 7,200 CR" (`'frame'`) |
| Pump House | Reclaim `2/3 rings`, then "Pump garden" |
| Floodwatch | note "Stops king tides and the floodplain limit nearby" |
| Halo Lookout | note "Works only while bridged into a Sky Lobby" (warn when it isn't) |

### 7.6 Settings

- **Weather:** Full / Light / Off (a 3-way segmented control, replacing the Rain toggle; §6.4).
- **Crowds:** On / Off (default On on high quality, Off on low).
- Both are additive `Settings` fields with the usual "unknown reads as default" rule.

### 7.7 Making it explain itself

1. **First-use tips** (EXPANSION §7.6 rules: one at a time, never over a tray, drag, story card or message banner; seen ids per device): `charter` (first charter arrives), `citymap` (first open), `annexed` (after the first annex), `skybridge` (tool selected), `skylobby` (first lobby), `frame` (first Skeleton Row annex), `pumphouse` (tool selected), `sponsor` (first Spire ghost); sim hints `floodplain` and `brownfield`. Copy in Appendix A.
2. **The City map's "?"** (above) and the annex sheet's summary lines.
3. **Rules drawn while the skybridge tool is active** (lanes, badges, reasons).
4. **Inspect notes** for every district perk and hazard.
5. **Help** (menu.ts) gains two steps after EXPANSION's: "10 · Grow beyond the shore" ("Each chapter grants a district charter. Open the City map, pick a district next to your city and annex it.") and "11 · Bridge the towers" ("Pick Skybridge and tap a tall tower: its lanes light up. Tap a glowing partner to link them. Three linked towers make a Sky Lobby.").
6. **Unlock news and the milestone banner** name the tray and chip ("Now available: Canopy Park (Civic · Parks)").

### 7.8 Acceptance (WP-5)

Every target ≥ 44 px at 390×844, 360×640 and 844×390; the toolbar still has 9 buttons; no chip holds more than 6 cards; the City map's primary button sits in the bottom 40% of the screen in portrait; no inspect value overflows at 360 px (visual harness, as EXPANSION §7.4); the annex confirm can't fire from a single tap; tips never stack.

---

## 8. Story hooks

### 8.1 Who cares about what

| Feature | Board | Basalt | Nacre | Undertow | Kites | Tuning |
|---|---|---|---|---|---|---|
| Districts | lobbies Reedmere (and Terraces while the Tuning is hidden); mood "Green lung"; card `ds.reedmere`, `ds.tarmac` | lobbies Kessel Flats and the Tarmac lease; mood "The Flats"; card `ds.flats` | lobbies the Shoals and the Tarmac lease; card `ds.shoals` | lobbies the Sunk and Copperline; seeds in the Sunk; cards `ds.sunk`, `ds.bazaar` | lobbies Skeleton Row and Copperline; seeds on the frames; cards `ds.skeleton`, `ds.bazaar` | lobbies Terraces once active; mood "Lamps on the hill"; card `ds.terraces` |
| Spire sponsor | +3 for Independent | +6, power +120 when Basalt sponsors | +6, power +120 when Nacre sponsors (old spires) | −2 | | |
| Crowns | Commons | Foundry | Glare | **Salvage** (new) | Kite Nest | **Lamp** (new) |
| Landmarks | Charter Hall | Hexworks | Pearl Atrium, Arena (`lm.arena`) | Hullhouse, the Beacon (`lm.beacon`) | Kite Mast, Halo Lookout (`lm.halo`) | Lamp Choir |
| Sky Lobbies | | | | | Skybridges mood (unchanged) | |

### 8.2 Charters and lobbying

- `charter n` (new effect, Step 0b): adds n charters, emits `charter`, shows "+1 district charter" in the choice summary (hint `charter`). Every chapter reward (Ch1–Ch5, `chapters.ts`) gains `charter 1`; the director applies `charter 1` when an ending is chosen. The reward sys lines are not changed (lint length).
- **Lobby lines** live in `DISTRICTS[kind].quote` (Step 0b, verbatim, ≤ 110 chars, linted by WP-7):

| District | Speaker | Line |
|---|---|---|
| Shoals | Oduya | Islands, partner! Every window a sea view! I can sell them before you pour the bridges! |
| The Sunk | Brine | Those streets went under in the storm, little light. My people never left them. |
| Kessel Flats | Sallow | The Flats pay for themselves, Operations. Flat land, a dock, nobody next door to complain. |
| Terraces (Tuning active) | Ohm | On the hill the lamps can see each other, Hum. Let the city climb. |
| Terraces (before) | Marrow | Resolved: homes with a view. Proposed: for once, for everyone. |
| Reedmere | Marrow | Minutes: the marsh filters more smog than four plazas. The Board would like to keep it. |
| Skeleton Row | lark | the frames are the best climbing in the city, moth. finish them. we'll mind the roofs. |
| Tarmac Reach | Oduya | A runway that's already there, partner! Imagine the terminal! |
| Tarmac Reach | Sallow | Cargo, Operations. Cargo pays by the tonne. Terminals pay by the smile. |
| Copperline | Brine | The night stalls run on tides, little light. I know their tides. |
| Copperline | lark | copperline's the best market in town. we sell signal there. let us keep selling. |

- **Annex reactions** (`director.onAnnex(kind, lease)`, Step 0b; ordinary favor changes through the standing rules): each lobbyist of the annexed district +6 (`ANNEX.lobbyFavor`); each lobbyist of the **other current candidates** −2 (`rivalLobbyFavor`, once per faction; a faction that lobbied for the annexed one too gets only the +6); Tarmac lease: chosen +8, the other −4. The hidden Tuning is never a lobbyist (or named) before `tuningActive`; Marrow speaks for Terraces until then. No card opens on annex.

### 8.3 Deck cards (new file `src/game/story/content/cards/megacity.ts`, WP-7)

Eleven cards, spread into `DECK` and `CARD_LIST` but not `FACTION_DECKS` (as EXPANSION §8.3): `DECK` and `CARDS` totals +11. Every card has `kind: 'faction'` (`ds.bazaar` is a two-faction card like `x.corner`), a `when`, `weight: 10`, `cooldown: 720`, **`once`**, exactly one default (‡), no ⚑, no beat, no queue, and a `brief`. Copy was length-checked against the lint limits (title ≤ 28, body ≤ 280, brief ≤ 220, labels ≤ 40 ending in a period), the banned list, the `!` rule and the spoiler guard (§8.6) with `/tmp/claude-megacity/copy/check.mjs`; WP-7's lint run is final. District names are written literally (no spot rule needed).

##### `ds.shoals` · Nacre · GLASS ON THE WATER
when `district.shoals >= 1`
> Oduya: 'Partner! The Shoals are the prettiest water in the city! A ferry with a glass bar, light shows on every island, and our logo on the tide tables. A tiny logo. Everyone reads tide tables!'

Brief: "Nacre wants to brand the Shoals with a luxury ferry and island light shows. It pays and lifts land value but annoys the Board. Refuse, or make Nacre fund public ferries as well."
- **Put the logo on the tides.** → Nacre +8, Board −3, CR +4,000, `[landValueAdd +0.01, 360d]`
- **Keep the water plain.** ‡ → Nacre −4, Board +2
- **Public ferries too.** → Nacre +3, Board +3, CR +2,000

##### `ds.sunk` · Undertow · WHAT THE TIDE KEPT
when `district.sunk >= 1 & turf.undertow >= 10`
> Brine, on a roof above a flooded street: 'The tide took these streets in the storm, little light. We never left them. Now your surveyors paint numbers on our doors. Tell me what the numbers mean.'

Brief: "Old Brine's people live in the Sunk's ruins. Clear them out for salvage (Undertow angry), give them title so the ruins become homes, or rent them the ruins for secret income (raises Trace)."
- **Clear the ruins.** → Undertow −12, Board +3, CR +2,500, `ruins clear`
- **Give them title to the ruins.** ‡ → Undertow +10, Board −2, `[demandRes +0.03, 360d]`
- **Rent them the ruins.** → Undertow +5, Trace +2, `↻ +250/mo ×12mo "Ruin rent"`

##### `ds.flats` · Basalt · BROWNFIELD
when `district.flats >= 1`
> Sallow: 'The Flats hold forty years of slag, Operations. Cleaning it costs nine thousand. Building fabs on top of it costs nothing. The soil does not vote. I have checked.'

Brief: "Basalt wants to build on the Flats' polluted soil as it is: fast and cheap for industry, but the smog stays. Pay to clean it all now, or let it clear slowly as the district grows."
- **Build on it as it is.** → Basalt +8, Board −3, `[demandInd +0.04, 360d]`
- **Clean it first: 9,000.** → CR −9,000, Board +4, Tuning +2, `brownfield clear`
- **Let it clear slowly.** ‡ → Basalt +2

##### `ds.terraces` · Tuning · LAMPS ON THE HILL
when `district.terraces >= 1 & tuningActive`
> Sister Ohm: 'On the terraces every window can see every other window, Hum. Let the families leave a lamp lit on the stairs. One lamp a step. The hill will read like a hymn.'

Brief: "The Tuning want a lamp on every terrace stair. It lifts approval and pleases them, but you pay the lamp bill and Nacre calls it clutter. Refuse, or let each block decide for itself."
- **Light every step.** → Tuning +8, Nacre −3, `↻ −120/mo ×24mo "Stair lamps"`, `[approvalAdd +2, perm]`
- **Keep the stairs dark.** ‡ → Tuning −4
- **Let each block decide.** → Tuning +3, `[approvalAdd +1, perm]`

##### `ds.reedmere` · Board · THE GREEN LUNG
when `district.reedmere >= 1`
> Marrow: 'Minutes. Item: the reed marsh filters more smog than four plazas and costs nothing. Item: developers want it drained. The Board asks you to protect it. Noted: the Board asked politely.'

Brief: "The Board wants the Reedmere reeds protected: free parkland and a happy Board, but Basalt wants the land. Drain the south bank for homes instead, or sell the drainage rights for cash."
- **Protect the reeds.** ‡ → Board +8, Basalt −3, `[approvalAdd +1, perm]`
- **Drain the south bank.** → Board −4, Basalt +3, `[demandRes +0.05, 360d]`
- **Sell the drainage rights.** → CR +5,000, Board −6, Nacre +2

##### `ds.skeleton` · Kites · THE FRAMES
when `district.skeleton >= 1 & turf.kites >= 10`
> lark: 'the frames in skeleton row are the best climbing in the city, moth. we live up there now. finish them if you want. just leave us the top floors. we keep the wasps off your cranes.'

Brief: "The Glass Kites live in Skeleton Row's unfinished towers. Let them keep the top floors (Kites pleased, Nacre not), clear them out for your building crews, or charge them rent."
- **Leave them the top floors.** ‡ → Kites +10, Nacre −4
- **Clear the frames.** → Kites −8, Board +2
- **Charge them rent.** → Kites +2, Trace +1, `↻ +150/mo ×24mo "Frame rent"`

##### `ds.tarmac` · Board · FAMILIES ON THE APRON
when `district.tarmac >= 1`
> Marrow: 'Resolved: the old airfield is open again. Noted: the families who moved onto the apron in the dark years would like to know if they are part of the plan. The Board would also like to know.'

Brief: "Families live on the old Tarmac Reach apron. Rehouse them properly (costs money, Board pleased), let them stay as an affordable quarter, or clear them out for the leaseholder."
- **Rehouse them: 6,000.** → CR −6,000, Board +8, `[approvalAdd +1, perm]`
- **Let them stay.** ‡ → Board +2, `[demandRes +0.02, 360d]`
- **Clear the apron.** → Board −6, Basalt +3, Nacre +3

##### `ds.bazaar` · Undertow + Kites · TWO TIDES, ONE MARKET
when `district.bazaar >= 1 & turf.undertow >= 10 & turf.kites >= 10`
> Brine and lark, on one call for once. Brine: 'Copperline's night stalls want one set of rules, little light.' lark: 'ours.' Brine: 'Ours.' Then both of them wait, very politely, for you to pick a word.

Brief: "Both gangs want to run Copperline's night markets. Pick one (the other gang is angry), split the market down the middle, or send in the Board's inspectors (both gangs dislike that)."
- **Give it to the Undertow.** → Undertow +10, Kites −8
- **Give it to the Kites.** → Kites +10, Undertow −8
- **Split it down the middle.** ‡ → Undertow +3, Kites +3, Board −2
- **Send in the inspectors.** → Undertow −6, Kites −6, Board +6

##### `lm.arena` · Nacre · HOME GAME
when `count.arena >= 1`
> Oduya: 'Partner! Opening night at the Arena! We'd love to put residents' faces on the big screen between matches! Only the happy ones! Our software already knows which ones are happy!'

Brief: "Nacre wants to scan the Arena crowd and show the happiest faces. Fans like it and Nacre pays, but it feeds Nacre's cameras and raises Trace. Refuse, or allow it for people who opt in."
- **Let the cameras pick.** → Nacre +8, CR +3,000, Trace +2
- **No faces on the screen.** ‡ → Nacre −4, Board +2
- **Only people who opt in.** → Nacre +3, Board +2

##### `lm.beacon` · Undertow · A LAMP ON THE WATER
when `count.beacon >= 1`
> Brine: 'You built a lamp on the water, little light. The divers love it. The night boats do not. Dim it on moonless nights and both of them will owe you. Keep it bright and only one will.'

Brief: "Old Brine asks you to dim the Harbour Beacon on dark nights so her boats can run. It pleases the Undertow and pays, but raises Trace. Keep it lit, or dim it and log every boat."
- **Dim it on dark nights.** → Undertow +8, Trace +2, `↻ +200/mo ×12mo "Dark nights"`
- **Keep it lit.** ‡ → Undertow −4, Board +2
- **Dim it, and log every boat.** → Undertow −2, Board +4, Trace −1

##### `lm.halo` · Kites · THE BEST VIEW
when `count.halolookout >= 1`
> lark: 'your halo lookout has the best view in the city, moth. and the best signal. we could hang one tiny relay under the rim. tourists would never see it. you wouldn't either. that's the point.'

Brief: "The Glass Kites want a hidden relay on the Halo Lookout. It pleases them and lowers Trace, but Nacre is annoyed. Refuse, or allow it and file a report with the Board."
- **Let them hide it.** → Kites +10, Trace −2, Nacre −3
- **No relays on the Lookout.** ‡ → Kites −5
- **Allow it, and file a report.** → Kites +3, Board +3, Trace +1

**Cadence:** eleven `once` cards under the pace's real-second deck gaps; they add variety, not frequency (the director's gates set the rate). Their conditions arrive spread over the campaign: one per annexed district, the landmark ones late.

### 8.4 Data rows

- **Effects** (STORY.md §10.3 closed vocabulary, additive): `charter n` (Step 0b); `brownfield clear` (clears every brownfield tile in owned Kessel Flats) and `ruins clear` (turns the Sunk's remaining ruins into empty zoned lots), both WP-7 in `story/effects.ts`, calling `clearBrownfield` / `clearRuins` from `districts/effects.ts` (WP-2). An effect whose district isn't owned is skipped (STORY.md §0).
- **Metrics** (closed `Metric` union, `PLAIN_METRICS`, `STAT_METRICS`, Step 0b): `districts` (owned count), `charters`, `district.shoals | sunk | flats | terraces | reedmere | skeleton | tarmac | bazaar` (0/1), `skylobby.count`, `skylobby.max`. `count.<type>` works for the new types automatically.
- **Mood drivers** (`content/factions.ts`, WP-7; every faction stays within the lint's 4–6): Board "Green lung" `m: 'district.reedmere', mul: 3, min: 0, max: 3`; Basalt "The Flats" `district.flats ×3`; Tuning "Lamps on the hill" `district.terraces ×3`. Nacre, Undertow and Kites already have 6.
- **Build reactions** (`FACTION_BUILD_REACTIONS`, Step 0b; landmarks limit 1, others the default 5): floodwatch Board +1; pumphouse Undertow +1, Tuning +1; canopypark Board +1, Tuning +1; medtower Board +2, Tuning +2; reclaim Board +1, Basalt −1; metro Board +2, Undertow −1; markethall Undertow +1, Kites +1; tidal Tuning +1, Basalt −1; geothermal Basalt +1; datavault Nacre +3, Kites +1; charterhall Board +8, Nacre −2; hexworks Basalt +10, Tuning −3; pearlatrium Nacre +10, Kites −3; hullhouse Undertow +10, Board −4; kitemast Kites +10, Nacre −4; lampchoir Tuning +10, Basalt −2; beacon Board +2, Undertow −1; arena Nacre +3, Board +2; halolookout Nacre +4, Kites +2; terminal Board +4. The Spire's reaction follows its sponsor (§6.2).
- **Power terms** (both `POWER_TERMS` in content, WP-7, and the live sums in `story/factions.ts`, WP-2): Board +100 per Charter Hall; Basalt +120 per Hexworks, +120 per Basalt-sponsored Spire; Nacre `perSpire` 120 now counts Nacre-sponsored and unsponsored old spires, +120 per Pearl Atrium; Undertow +100 per Hullhouse, +80 per Salvage crown; Kites +100 per Kite Mast. A test pins the Balance of Power of the S1 fixture as unchanged.
- **Turf affinity** (`TURF.affinity`, Step 0b keys, WP-1 terms): both gangs `bazaar: 0.1` inside Copperline; Kites `frameNear: 0.2, frameRadius: 2`; Undertow `sunk: 0.1` inside the Sunk. Cap 8% of **owned** land.
- **Glossary:** stays at 20 entries; the Skybridge text is replaced (§5.7); "The Sunk" entry already says the city is built at its edge.

### 8.5 Copy rules

STORY.md §1.4 voice (Marrow in minutes, Sallow in arithmetic calling MOTH "Operations", Oduya delighted with the only `!`, Brine in tides calling MOTH "little light", lark lowercase calling MOTH "moth", Ohm hymn-like calling MOTH "the Hum"); briefs mandatory (≤ 220); lobby lines ≤ 110 and in voice; taglines ≤ 60; perk and hazard lines ≤ 48; neighbourhood names ≤ 15; no `$` in story bodies; screen names avoid every banned word (hence "Halo Lookout", "Reedmere Marsh").

### 8.6 Spoiler guard (lint, WP-7)

`tests/story/content-lint.test.ts` gains a scan over every `DISTRICTS` text (tagline, perks, hazards, quotes, neighbourhoods), the new building names, descriptions and meta lines, the megacity cards, the tips and the city-event lines: none may match `/\bgates?\b|\bseal(ed|s|ing)?\b|complying|eleven thousand|11,000/i`. The Sunk is described only as drowned "in the storm of 2084" (the official story) everywhere.

---

## 9. Audio

- Annex: the existing `milestone` sfx at the fog lift. Skybridge build and routes: `build`. Frame finish: `build`. No new `sfx` kinds (audio keys a `Record` on them).
- City events: no sound by default; *optional* (WP-5, in `audio.ts`): a soft chime when a night market or lantern night starts, through `AudioEngine` listening to `cityEvent` directly (its own gap, ≥ 420 s apart by construction).
- *Optional* district ambience: a quiet loop per style under the music when that district fills the view (gulls, machinery, market voices), muted with sound off.

---
## 10. Performance, saves, balance and tests

### 10.1 Budgets

Node figures are what the tests assert (CI keeps EXPANSION's 3× slack); phone is ×3.5 (§2.1), checked on a device in Step 9.

| Area | 1 district | 9 districts, fully built | How |
|---|---|---|---|
| `sim.step()` average | ≤ 1.0 ms (today 0.78–1.05) | ≤ 4.5 ms (prototype 4.1–4.9) | O1–O4, O7 |
| After a player action (`recomputeAround`) | ≤ 1.5 ms | ≤ 5 ms | O5 |
| `recomputeAll()` (load, new city, annex) | ≤ 2 ms | ≤ 12 ms | — |
| Story `onMonth` | ≤ 1.5 ms (today 1.24) | ≤ 3 ms (today's code 9.4) | O6 |
| Save write | ≤ 0.5 ms, ≤ 40 KB | ≤ 3 ms, ≤ 320 KB | owned slots only |
| Load (parse, deserialize, regenerate locked slots, `recomputeAll`) | ≤ 30 ms | ≤ 40 ms | terrain gen < 25 ms |
| Migration v1–v3 → v4 | ≤ 40 ms once | — | §3.10 |
| Sim share of a phone frame at speed 3 | — | ≤ 30%; frame guard 8 ms | §3.3 |
| Frame, mid-range phone, default zoom | ≥ 30 fps, 60 target | same | view-bound; minZoom 0.4 and the atlas below it |
| On-screen tiles at minimum zoom | ≤ 3,775 (today) | ≤ 2,195 at 0.4 | §2.5 |
| Canvas memory | ground 24 MB + sprites 32 MB (today) | + atlas ≤ 4 MB | §3.9, §6.1 |
| Heap | +≈ 8 MB for the 192 frame (36,864 tile objects ≈ 4 MB, 19 fields × 147 KB ≈ 2.8 MB, sim mirrors ≈ 2 MB) | same | arrays allocated once |
| Skybridges | ≤ 0.4 ms for 60 visible gap tiles | same | cached segments |
| Life and atmosphere | ≤ 1.5 ms a frame together (crowds 0.6, weather 0.5, boats 0.2, a running event 0.4) | same | §6.4 |
| City map open | ≤ 2 ms a frame | same | 9 impostor blits |

### 10.2 Save, migration and contract tests (Step 0b)

`tests/save-v4.test.ts`, `tests/districts-contract.test.ts`:

1. v1, v2 and v3 fixtures (the pinned JSON files of Step 0a) migrate: the start slot's tiles equal the old tiles bit for bit; buildings at +64; sky, turf and rail at the offset; links +64; `seam`, `pending.spot`, `open.spot`, `waiting.spot`, `railOut[].i` remapped; `locals` and `crackdowns` +64; `maxPopulation` ×10 and `milestones` mapped; charters owed (a Ch3 save gets 2, a post-ending save 6); `.v3` written once and never overwritten; `loadedVersion` kept.
2. The contract test walks every `StoryState` key and fails on a numeric field not listed as a tile index, a coordinate or "not spatial".
3. A v4 round trip keeps owned slots, their order, charters, `bought`, `annexedAt`, the lease, `elev`, `ground`, `sponsor`, `look` and `reclaim`; locked slots regenerate identically; the 9-district fixture serializes ≤ 320 KB.
4. Corrupt input never throws except "Incompatible save" for a tile count mismatch, duplicate or out-of-range slots, or a missing `START_SLOT`; unknown or wrong-length `kinds` → the seed's layout; negative charters → 0; `elev` or `ground` on water → 0; a lease on an unowned or wrong district → dropped.
5. A v5 save is left untouched and blocks autosave (EXPANSION §2.5 rule with versions bumped); a dev save with `scale: 10` is not multiplied again.
6. `World.generate(seed)`'s start slot equals today's `generateTerrain` output for 30 seeds.
7. Every mutator, called in random order with random annexes, keeps the §3.2 invariants; nothing can be built, zoned, railed, skywayed, bridged or turfed on a locked tile.
8. Layout (§3.6.2) over 200 seeds: every kind once, the Shoals across the bay, land shares in range, every slot ≥ 35% land in one component.

### 10.3 Balance targets

Measured headless (§10.4); Step 9 tunes only the megacity tables in config.ts and records the results in §10.6.

| # | Scenario | Target |
|---|---|---|
| S1 | **Invariance.** The expansion fixture and `ScriptedMayor` (seeds 2091, 7, 31) at years 3 and 8, saved by the v3 build (pinned fixtures) and loaded by v4 | residents and jobs ×10 (±0.5%); monthly income and expenses ±1%; avgTraffic, avgPollution, avgLandValue, unemployment ±0.002; approval ±0.5; power supply and demand identical; salt price and Balance of Power identical (±1 point) |
| S2 | v4 `ScriptedMayor` 8 years against its v3 run | population ×10 ±3%; funds trajectory ±5%; chapter starts in the story harness within ±30 d on every pace |
| S3 | Existing balance, playthrough and expansion-balance tests (expectations ×10) | pass |
| D1 | **MegaMayor** (annexes whenever a charter waits, candidates in a fixed kind order, grows each new slot with the `ScriptedMayor` grid) 12 sim years, 3 seeds | ≥ 5 districts by Charter Night; 1.0–2.5 M residents by year 12; net income positive every year; approval within ±5 of the one-district mayor |
| D2 | Each perk (unit tests) | Shoals bridges ×0.6 price; Sunk ruins recover ≥ 1.8× as often as other abandoned tiles; Kessel Fab zoning ×0.5 and its demand add stops at 400 Fab tiles; Terraces +0.035 land value per step; an unbuilt reed tile reads park ≥ 0.45; the Tarmac lease adds 2,000 jobs of demand; 100 Copperline Market tiles → 6,000 visitors |
| D3 | Hazards stay mild | no hazard abandons a building; king tides and the floodplain cap vanish under a Floodwatch; brownfield clears ≤ 720 d after development |
| D4 | No softlock | the playthrough test with annexing disabled reaches Charter Night and an ending on every pace |
| D5 | A new district grows | the first `ScriptedMayor` block in a just-annexed slot develops within 60 d of getting road and power |
| K1 | Sky Lobby payoff (fixture: 2–6 L3 towers in a row, bridged) | trips −20% at k = 2, −25% at k ≥ 3; land value at the anchors +0.05 (+0.02 × min(k, 4) in a lobby); visitors 2,000 × (k − 2); the Halo Lookout unlocks at k = 5 |
| K2 | Skybridge placement | every green partner builds; every red reason ≤ 32 chars; a two-bridge route exists for ≥ 80% of non-aligned tall pairs within 10 tiles in the megacity fixture |
| V1 | Variety | adjacent-identical rate ≤ 3%; distinct bodies at zoom 1 ≤ 220; paint rate ≤ 1.5× v3 |
| P1 | Performance | §10.1 with the megacity fixture |
| E1 | City events | 3–7 per unpaused hour; none in the first 600 s; never two at once; exactly one ticker line each |

### 10.4 Headless measurement plan

`tests/megacity-measure.test.ts` (Step 9), skipped unless `MEASURE=1`, seeds 2091, 7, 31, one printed table per scenario:

- **M1** S1 invariance from the pinned v3 fixtures. **M2** MegaMayor 12 years (D1, D5). **M3** `megacityFixture(n)` for n = 1, 3, 5, 9 fully built slots: `step`, `recomputeAround` over 100 random actions, `recomputeAll`, `onMonth`, save size and time (P1), best of 8 batches as in §2.1. **M4** Sky Lobby payoff and placement (K1, K2). **M5** perks and hazards (D2, D3). **M6** city events on a fake clock (E1). **M7** render counts with `tests/canvas-mock.ts`: distinct body ids per frame in a scripted pan over the fixture, painted sprites per second, adjacent-identical rate, on-screen tiles at minimum zoom (V1).
- **Fixture and mayors** in new `tests/megacity-fixture.ts` (WP-1, extended by Step 9; `tests/helpers.ts` gains only the frame port of Step 0b): `megacityFixture(world, n)` owns and fills n slots with World mutators only (so WP-1 does not depend on WP-2's tools); `MegaMayor` wraps `ScriptedMayor` with `annex` and per-slot origins.
- The scratch scripts of Appendix D are the starting point; M3 reproduces §2.2–§2.4 inside the test suite.

### 10.5 Tests by package

| Package | New tests | Updated |
|---|---|---|
| Step 0a | `megacity-scale.test.ts` (S1 short form, the threshold lint), pinned `tests/fixtures/v3-*.json` | every population expectation (balance, budget, growth, story harness and playthrough, expansion balance) |
| Step 0b | `save-v4.test.ts`, `districts-contract.test.ts` | the 21 files with hard-coded 64 / 63 / 4096 (`turf`, `save`, `input-gestures`, `actions-roads`, `sim-roads`, `save-v3`, `render-ground`, `fuzz`, …) via `world.idx` and the new helpers: `flatWorld()` owns all 9 slots (so local coordinates keep working), `startWorld()` owns only slot 4, `fullyBuiltWorld()` builds in slot 4; `story/contract.test.ts` (SAVE_VERSION 4); `perf.test.ts` temporary budgets |
| WP-1 | `sim-districts.test.ts`, `recompute-around.test.ts` (after an action, fields inside `rect ⊕ 12` equal `recomputeAll`'s within 1e-6 and stats match), `turf-scale.test.ts` (O6 equals the full-map turf on 20 random cities), `megacity-fixture.ts` | `perf.test.ts` (§10.1 restored, megacity fixture), `fields`, `growth`, `budget` |
| WP-2 | `districts-terrain.test.ts`, `annex.test.ts`, `actions-districts.test.ts`, `skybridge-v2.test.ts`, `game-megacity.test.ts` (annex, buy, charters, lease, undo of bridges, frame finish, frame guard with a fake clock) | `vertical.test.ts`, `actions.test.ts`, `fuzz.test.ts` (new tools), `story/conditions.test.ts` (power terms) |
| WP-3 | `render-districts.test.ts` (fog, pins, overview scale, atlas, minZoom), `parcels.test.ts` (rules, stability under edits, tier re-check) | `render-ground.test.ts`, `render-roads.test.ts` |
| WP-4 | `building-variety.test.ts` (every kit body × style × tier × parcel paints; every new building and look; height-class bounds; V1 counts) | `building-art.test.ts` |
| WP-5 | `citymap.test.ts` (model: states, price lines, lease gating, confirm), `ui-catalogue` (chips, metas, icons) | `input-gestures.test.ts` (bridge taps, tube pick, pins) |
| WP-6 | `city-events.test.ts` (E1, fake clock), `life-fx.test.ts` (caps, LOD, settings) | `port-fx.test.ts` if traffic kinds shift |
| WP-7 | — | `story/content-lint.test.ts` (+11, spoiler guard, lobby lines), `story/expansion-cards.test.ts`-style drawability for the 11 cards |

### 10.6 Measured

*(Filled in by Step 9: the final §10.3 table, the on-device frame and speed-3 numbers, and whether O8 was needed.)*

---

## 11. Work packages

**Rules.** Step 0a, then Step 0b, land first, one agent each, alone. Then **at most two agents run at once**, in the waves below. Each package owns the files listed and edits nothing else; a change needed in another package's file goes into its hand-off note for Step 9. After Step 0b these are frozen: `types.ts`, `world.ts`, `events.ts`, `buildingStats.ts`, `districts/slots.ts`, `districts/migrate.ts`, `districts/layout.ts`, `story/types.ts`, the `TileInfo` shape, the `ParcelMap` interface and the `drawSkybridgeSpan` signature. `config.ts` belongs to WP-1 (numbers only, no renames) during the waves and to Step 9 after. Every package ends with `npm run typecheck` and `npm test` green.

### Step 0a · Scale (one agent)

**Owns:** `src/game/config.ts` (§4 numbers and `POP_SCALE`), `src/game/sim/tuning.ts`, `src/game/sim/census.ts` (the two demand floors only), `src/game/sim/advisor.ts` and `src/game/sim/incidents.ts` (thresholds and the grant slope only), `src/game/news.ts` (`minPop` / `maxPop`), `src/render/art/traffic.ts` and `src/render/art/skytraffic.ts` (one constant each), `src/game/story/content/chapters.ts`, `cards/undertow.ts`, `cards/nacre.ts`, `cards/board.ts` (thresholds and goal labels), `src/game/world.ts` (load: ×10 for saves without `scale`; write `scale: 10`). Tests: new `tests/megacity-scale.test.ts`; **first**, before any edit, generate and commit the pinned v3 fixtures `tests/fixtures/v3-expansion.json`, `v3-mayor-{2091,7,31}-y{3,8}.json`; then update every population expectation.
**Builds:** §4.
**Acceptance:** S1 and S3 green; the story pace tests unchanged in timing.

### Step 0b · World frame, districts contract, save v4 (one agent)

**Owns:** `types.ts`, `config.ts` (§3.2 tables, `DISTRICTS` copy verbatim from §3.7 and §8.2, `DISTRICT_PRICES`, `ANNEX`, `SKYBRIDGE` v2 numbers, new `BUILDINGS` rows with `meta`, `desc`, gates and `height` / `roof`, `CROWNS` additions, `FACTION_BUILD_REACTIONS`, `POWER_WEIGHTS` keys, `TURF.affinity` keys, `EDGE_LINKS.perDistrict`, `CITY_EVENTS`, `ZONE_HEIGHT`, `ZONE_ROOF`), `events.ts`, `world.ts` (frame, district state, slots, segments, `annex`, `setTerrain`, `setGround`, invariants, v4 serialize / deserialize, `cityEvent`, `conductorVersion` bumps), `buildingStats.ts` (new types; frames inert), new `src/game/districts/slots.ts`, `migrate.ts`, `layout.ts` (§3.6.2 in full), `terrain.ts` (the start generator moved in bit-identically, plain-noise stubs for the kinds), in `sim.ts` only the `districtDaily` hook and a `recomputeAround` that calls `recomputeAll`, in `census.ts` / `sim/ports.ts` only the two `cityEvent` read sites; `story/types.ts` (metrics, `CrownId`, effect `charter`, gate fields, `InspectAction` ids `'frame' | 'bridgeRemove' | 'map'`, `VerticalCache.lobbies` and `.lobbyVisitors`), `story/conditions.ts` and `content/vocab.ts` (metrics), `story/effects.ts` (`charter` only), `story/director.ts` (`onAnnex`, the ending's charter), `story/content/chapters.ts` (`charter 1` in every reward), `game.ts` (save safety: versions, `.v3`; `annex` / `buyDistrict` stubs; the `cityEvents.update(dt)` call in `Game.update`), new `src/game/cityEvents.ts` (a no-op `CityEvents` with the final signature, WP-6 fills it), placeholder art entries in `render/art/services.ts` (new types reuse existing recipes) and `render/overlay.ts` (`EFFECT_RGB` for `resilience`, `filter`), new `render/parcels.ts` with the frozen `ParcelMap` interface and an all-single implementation (WP-3 fills it), and in `render/art/vertical.ts` the frozen `drawSkybridgeSpan(ctx, span, skin, env)` delegating to today's tube painter (WP-4 fills it). Tests: §10.2 and the frame port (§10.5).
**Perf note:** until WP-1, a one-district world still pays the empty-area cost (§2.3); Step 0b raises `tests/perf.test.ts` to step < 5 ms and recompute < 15 ms with a comment naming WP-1, which restores §10.1.
**Acceptance:** §10.2 green; a v3 city loads, plays and saves on the 192 frame and looks the same (start slot, names, props); a new city starts on the identical start map.

### Wave 1 (two agents)

#### WP-1 · Sim at scale
**Owns:** `src/game/sim.ts`, `src/game/sim/*.ts`, `src/game/story/turf.ts`, `src/game/story/mods.ts`, `config.ts` (numbers). Tests per §10.5.
**Builds:** O1–O7; the district sim rules of §3.3 (layers `parkAdd` / `pollutionAdd`, floodplain cap, ruin recovery, brownfield clearing, demand adds, per-district census, `resilience` and `filter`, the Metro network, Sky Lobby and landmark visitors in `PortSystem`, `cityEvent` terms); turf affinity terms for Copperline, frames and the Sunk; regional links on the boundary (§3.5) in `SimGrid`.
**Acceptance:** §10.1 sim and story budgets; the equivalence tests; every existing sim, story and balance test green.

#### WP-2 · Districts gameplay, actions, Game and skybridge rules
**Owns:** `src/game/districts/terrain.ts` (generators), `annex.ts` (content placement), `effects.ts` (district layer part, `clearBrownfield`, `clearRuins`), `daily.ts` (Pump Houses, king tides); `src/game/actions.ts` (locked tiles, district costs, the new building rules: flat footprint, water and shore sites, district-bound landmarks, sponsor, frame finish, salvage); `src/game/game.ts` (annex, buy, charters, lease, `districtView()` for the City map, `getTileInfo` additions, `inspectActions`, toast `'map'`, skybridge source / plan / apply with undo, the frame guard); `src/game/story/vertical.ts` (skybridge v2, partners, routes, payoff, Sky Lobbies, owned segments); `src/game/story/factions.ts` (power terms). Tests per §10.5.
**Acceptance:** D2, D3, D5, K1, K2; every rule of §3.4, §3.5, §5.3 and §6.3 has a test; the fuzz test is green with the new tools.

### Wave 2 (two agents)

Interfaces fixed before the wave (Step 0b): `ParcelMap` (`shape`, `head`, `member` per tile) and `drawSkybridgeSpan(ctx, span, skin, env)`.

#### WP-3 · World view
**Owns:** `src/render/renderer.ts`, `ground.ts`, `camera.ts` (additive), `overlay.ts`, `src/render/story.ts`, `src/render/parcels.ts` (fills Step 0b's stub), new `src/render/atlas.ts`, `src/render/art/skyway.ts` (only for crossings).
**Builds:** §3.9 (bounds, fog, boundary line, pins, overview scale, atlas, minZoom, sweep clip, district ground character), Terraces elevation (**optional item**), the skybridge lanes, badges, route ghost and crossing order (§5.4, §5.6 depth), parcels.
**Acceptance:** visual checks at 390×844, 360×640 and 844×390, day and night, zoom 0.4 / 1 / 2.5: fog and boundary readable, pins tappable, no seams at slot borders; atlas transition both ways; the frame budget with the megacity fixture.

#### WP-4 · Building art
**Owns:** `src/render/buildings.ts`, `art/painter.ts`, `art/zones.ts`, new `art/kit.ts`, `art/styles.ts`, `art/faction.ts`, `art/landmarks.ts`, `art/services.ts`, `art/story.ts`, `art/vertical.ts`.
**Builds:** the kit and styles (§6.1), parcel drawing, the generic fallback, faction languages with their variants and where they apply (§6.2), art for every new type (§6.3), the skybridge skins and walkers (§5.6), `zoneFloors`, the height-class bounds.
**Acceptance:** V1; every body and look renders in the sweep test; a migrated city keeps its palettes; Basalt, Nacre, Board, Undertow, Kites and Tuning variants are told apart in a side-by-side capture at zoom 0.5 by day and by night.

### Wave 3 (two agents)

#### WP-5 · UI, input and audio
**Owns:** `src/ui/*` (new `ui/citymap.ts`), `src/input/*`, `src/audio/audio.ts`.
**Builds:** §7 (chips, rumoured cards, metas, City map and annex sheet, map button, goal-chip token, the skybridge tool flow, inspect additions, the Spire sponsor step and crown look picker, settings, tips, help), §9.
**Acceptance:** §7.8.

#### WP-6 · Life and atmosphere (**droppable as a package**)
**Owns:** `src/render/effects.ts`, `art/traffic.ts`, `art/weather.ts`, `art/skytraffic.ts`, `art/fx.ts`, new `art/crowds.ts`, `art/boats.ts`, `art/festival.ts`, `src/game/cityEvents.ts` (fills Step 0b's stub).
**Builds:** §6.4. If dropped: `world.cityEvent` stays null, `Settings.weather` maps to today's rain, nothing else changes.
**Acceptance:** E1; the life budget of §10.1; every item obeys low quality and the settings.

### WP-7 · Story content (takes the first free slot after WP-2; cards **droppable**)
**Owns:** new `src/game/story/content/cards/megacity.ts`, `cards/index.ts`, `content/factions.ts` (drivers, `POWER_TERMS` rows), `content/glossary.ts` (Skybridge text), `story/effects.ts` (`brownfield clear`, `ruins clear`), `tests/story/content-lint.test.ts`, `docs/STORY.md` (a "Megacity" subsection: districts, charters, the new crowns and landmarks, the cards; population numbers ×10).
**Builds:** §8.3, §8.4's content rows, §8.6.
**Acceptance:** content lint green; each card drawable in a world that meets its `when`; the playthrough reaches Ch6 on every pace. If the cards are dropped, the lobby lines, annex reactions, charters and rescale (Step 0a / 0b) still ship.

### Step 9 · Integration, balance and performance (one agent, last)
**Owns:** `config.ts` (megacity numbers), `tests/megacity-measure.test.ts`, new `tests/megacity-balance.test.ts` (D1 short form, one seed, in the regular suite), `tests/megacity-fixture.ts` (extends WP-1's), `public/sw.js` (`VERSION` bump), `docs/MEGACITY.md` §10.6, `docs/CONTRACTS.md` (a "Megacity layer" section: the frame, slots and segments, save v4, the new modules and events), `docs/DESIGN.md` (the interview decisions), `docs/EXPANSION.md` (population numbers ×10 with a note), and the cross-package fixes from the hand-off notes.
**Builds:** §10.4; tunes to §10.3; the **device check** (a mid-range phone, or Chrome with 4× CPU throttling: frame rate at 9 districts, sim share at speed 3; builds O8 only if a budget is missed); `npm run build:single` and a single-file run; loads v1, v2, v3 and v4 saves; a stale v3 build opened on a v4 save leaves it intact.
**Acceptance:** every §10.3 target met or waived in §10.6 with a reason; all tests green.

### Order and what can be dropped

```
Step 0a ─► Step 0b ─► Wave 1: WP-1 Sim ∥ WP-2 Districts/actions/Game
                  ─► Wave 2: WP-3 World view ∥ WP-4 Building art
                  ─► Wave 3: WP-5 UI/input/audio ∥ WP-6 Life & atmosphere
                  ─► Step 9 Integration
WP-7 Story content takes the first free slot after WP-2 (never a third concurrent agent).
```

| Item | Package | If dropped |
|---|---|---|
| Life and atmosphere (whole package) | WP-6 | `cityEvent` null; weather = today's rain |
| Story cards | WP-7 | the deck is unchanged; lobby lines and reactions remain |
| Terraces elevation rendering | WP-3 | contour shading; the numbers stay |
| Optional landmarks (Hullhouse, Lamp Choir, Grand Terminal) and services (Market Hall, Tidal Turbine, Geothermal Bore, Data Vault) | WP-2, WP-4 | their `BUILDINGS` rows get `hidden: true` (never in trays); contract rows stay |
| Haze, drones, ambience, event chimes, Kite Day, Parade | WP-6 | — |
| O8 sleeping districts | Step 9 | not built unless the device check needs it |

Not droppable: Step 0a, Step 0b, WP-1, WP-2, WP-3 (but elevation), WP-4 (kit, parcels, faction languages, core landmarks), WP-5.

---

## Appendix A · Copy: tips, descriptions and meta lines

Tips (≤ 110 chars, EXPANSION §7.6 rules):

| id | Text |
|---|---|
| charter | You earned a district charter. Open the City map to choose where your city grows next. |
| citymap | Tap a district next to your city to see its land, perks and who wants it. Annexing uses one charter. |
| annexed | Roads, power and services cross into the new district like anywhere else. Inspect shows its perks. |
| skybridge | Tap a tall tower: its lanes light up. Tap a glowing partner to link them. Skyways are for cars. |
| skylobby | Three linked towers make a Sky Lobby: fewer car trips, higher land value and visitors. |
| frame | Skeleton Row's frames are half-built towers. Tap one to finish it as a Stratablock. |
| pumphouse | Pump Houses raise the canals around them into new land, one ring a month. |
| floodplain (sim) | Reedmere's floodplain stops at level 2. A Floodwatch Station lets it grow tall. |
| brownfield (sim) | Kessel Flats' brownfield smog fades as the soil is built on, or under parks. |
| sponsor | Choose who pays for this Spire. The sponsor's style, jobs and power go with it. |

Descriptions (≤ 90 chars) and tray meta lines (≤ 22 chars):

| id | Description | Meta |
|---|---|---|
| floodwatch | Tide gauges, pumps and flood barriers. Stops king tides and floodplain limits. | 2×2 · flood safety |
| pumphouse | Pumps a ring of canal dry each month until new land stands. | 1×1 · makes land |
| canopypark | A roofed forest of lights. A big park for a big city. | 3×3 · big park |
| medtower | A hospital tower. Care for half a district. | 3×3 · health r20 |
| reclaim | Scrubbers and sorting lines. Cleans the air and the soil nearby. | 2×2 · cleans smog |
| metro | An underground line between districts. Links with other Metro Stations. | 1×1 · links districts |
| markethall | A covered night market. Visitors, shoppers and a little goodwill. | 2×2 · visitors |
| tidal | Turbines in the current. Clean power from the water. | 2×2 · water · 600 MW |
| geothermal | A bore into the hill's warm rock. Clean, steady power. | 2×2 · hill · 900 MW |
| datavault | A buried data hall. Signal for a whole district. | 3×3 · net r18 |
| charterhall | The Board's seat. A public hall with nine flags and open doors. | 3×3 · approval |
| hexworks | Basalt's foundry headquarters. Huge power, huge payroll, some smoke. | 4×4 · 2,500 MW |
| pearlatrium | Nacre's flagship. A glowing atrium visitors cross the bay to see. | 3×3 · visitors |
| hullhouse | An upturned hull the size of a block. The Undertow's market hall. | 3×3 · off-ledger |
| kitemast | The tallest mast in the city, strung with kites and relays. | 2×2 · signal r22 |
| lampchoir | A hall where every window holds a lamp. The Tuning sing there. | 2×2 · approval |
| beacon | A lighthouse on the islands. Its beam sweeps the bay at night. | 1×1 · shore · visitors |
| arena | A stadium for matches and concerts. Arena nights fill the streets. | 4×4 · visitors |
| halolookout | A ring of glass on top of the skyline. Bridge it into a Sky Lobby. | 2×2 · skybridge hub |
| terminal | A grand station where the ribbon and the metro meet. | 4×4 · transit hub |
| frame | An unfinished tower frame. Finish it as a Stratablock. | (never in a tray) |

Sky tray metas: Skybridge "People · tap two towers", Skyway "Cars · drag like a road".

## Appendix B · News and advisor lines

Owners: `annex` (WP-2, Game), `lobby` (WP-2, `vertical.ts`), the event lines (WP-6, `cityEvents.ts`), the advisor rows (WP-1, `advisor.ts`).

| Key | Kind | Cooldown | Text |
|---|---|---|---|
| annex | good | once per district | "{city} grows: {name} joins the city." |
| lobby | good | once per lobby | "Three towers in {district} are one Sky Lobby now: {name}." |
| milestone (new rows) | good | once | generated as today ("Night Harbour! {city} passes 600,000 residents…") |
| nightmarket | info | per event | "Night market in {district} tonight: lanterns from one end of the street to the other." |
| lanterns | info | per event | "Lantern night: the whole city sends paper lights up over the water." |
| stormwatch | info | per event | "Storm watch: flood barriers up along the shore. Stay off the piers." |
| arenanight | info | per event | "Match night at the Arc Arena. The stations are full and the streets are louder." |
| kiteday | info | per event | "Kite day: diamond kites over {district}. Nobody admits who made them." |
| parade | info | per event | "Parade on the avenue in {district}. Confetti in every gutter by midnight." |
| floodplain | warn | 240 d (≥ 20 capped tiles) | "Advisor: Reedmere's floodplain holds homes at level 2. A Floodwatch Station lifts the limit." |
| brownfield | info | 300 d | "Advisor: brownfield smog over Kessel Flats. Build on it, or add parks and a Reclaim Works." |
| bridges (optional) | info | 360 d (≥ 6 aligned unbridged pairs) | "Advisor: {n} pairs of tall towers line up for skybridges." |

## Appendix C · Decisions and rejected alternatives

1. **Growing world** (resize on annex): every stored tile index would be remapped mid-game; rejected for a fixed 3×3 frame (§3.1).
2. **4×4 grid:** 14–15 ms a step fully built today, ≈ 28 ms on a phone optimised; rejected (§2.6). Nine districts still reach 4.4 M residents.
3. **Separate sims per district:** every system crosses borders; rejected.
4. **Merging Skyways and Skybridges:** different users, heights and gestures; one tray line could not explain a merged tool. They now coexist on the same tiles instead (§5.2).
5. **Skybridges at any angle:** in this projection a bridge along (1, 1) points at the camera and reads as a column; two-bridge routes solve reachability with axis-aligned spans.
6. **A story card for each annex:** an interruption; the City map is opened by the player, the charter waits in the reward message, and the lobbying lives on the sheet.
7. **A unique sprite per tile:** ≈ 250 bodies × 120 KB per screen and unbounded painting; the kit is a bounded library with a warm fallback.
8. **District capacity perks** (e.g. Copperline Market jobs ×1.15): would touch the four capacity consumers EXPANSION unified; visitors instead.
9. **Water utility, service capacity limits:** not asked for, new balance surface; rejected.
10. **Steeper capacity per level** (L3 ×20): re-tunes growth gates and traffic; 2×2 parcels and megastructures give the "thousands" feel.
11. **Buying districts before the ending:** the owner said the sandbox; charters cover the campaign, and a stalled chapter still ends through its fallbacks.
12. **Real elevation everywhere:** render and picking cost; only Lantern Terraces, and optional there.
13. **Saving locked slots or a compressed tile format:** regenerated land costs nothing to store; structural RLE saved only 17% (§2.5).
14. **Sleeping districts:** not needed at the measured numbers; kept as fallback O8.
15. **A Copperline lease on the annex sheet:** one contest in one place; the gangs' dispute lives in `ds.bazaar`, and only Tarmac Reach has a lease.
16. **Scaling story lore numbers:** the 11,000 and 90,212 are history, not city size; unchanged.

## Appendix D · Measurement scripts (scratch, not part of the build)

All under `/tmp/claude-megacity/` (Step 9 ports them into `tests/megacity-measure.test.ts`):

| Path | What |
|---|---|
| `run.sh N…` | copies `src/`, patches `MAP_SIZE` to N, bundles `bench.ts` with esbuild into `nN/bench.mjs` |
| `bench.ts` → `out-N-{full,one,five}.json` | step, recompute, single-pass costs, a Game day with the director, heap, save size, view counts (§2.2, §2.5) |
| `bench2.ts` | best-of-8 batch timings (the §2.2 table) |
| `profile.ts` | per-system share of `step()` |
| `story.ts`, `story2.ts` | director month-end cost and its parts (§2.3) |
| `save.ts` | save size and timings, and the RLE alternative (§2.5) |
| `opt/`, `opt64/`, `opt192/` | the prototype patch (power labels, allocation skip, coverage cache, 4-phase stagger) and its bundles (§2.4) |
| `copy/check.mjs`, `copy/check2.mjs` | length, banned-term, `!` and spoiler checks for the copy in §3.7, §8 and Appendices A–B |
