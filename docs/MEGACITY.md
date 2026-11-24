# Cyber City: Megacity spec, "Districts, Scale, Skybridges and Variety"

This is the binding implementation spec for the owner's feedback after a nearly full playthrough:

> "The map needs to be bigger, or you should be able to expand to a new area of your choosing (another grid like the starting one) after each chapter.
> Houses don't hold enough people, it doesn't feel realistic, businesses don't provide enough jobs, etc. just doesn't feel realistic.
> Skybridges feel clunky.
> I love the corp towers and the other similar structures but they need more personality, different architecture, etc.
> More variety is the biggest thing I think."

It covers **districts** (a 3×3 grid of 64×64 areas; the player annexes one with each chapter's **land grant**, keeps receiving grants after the ending, and can buy districts with credits in the sandbox), **megacity scale** (ten times the people per building, denser offices and fabs so a balanced city is about 60% homes, megastructures that out-house the towers around them, every threshold rescaled), a **skybridge rework** (tap a tower, tap a partner; one height rule drawn on the map; visible payoff; faction skins; Sky Lobbies), **variety** (merged parcels and a modular building kit with 44 templates, per-district styles with their own silhouettes, six faction architecture languages, new landmarks and civic buildings, crowds, weather, vehicles, city life), and **choices that last** (§9: each ending reshapes the post-ending skyline and opens its own landmark; key story choices leave named places, plaques and building variants; epilogue cards and Charter Review lines call them back). It ends with the phone UI, story hooks, performance, saves, balance and the work packages. Section 2 holds the measurements every size and budget decision rests on; Appendix C lists the alternatives this spec rejected; Appendix E records how the two reviews of the draft were resolved.

**Precedence.** `docs/DESIGN.md` (owner decisions) wins over this doc. `docs/STORY.md` stays the binding story spec, `docs/EXPANSION.md` the binding spec for roads, wealth and ports; this doc only adds to them (deck cards, metrics, effects, mood rows, build reactions, power terms) and rescales their population numbers (§4). `docs/CONTRACTS.md`, `docs/STORY-CONTRACT.md` and `docs/PACING.md` still hold; §3.2 and §12 list the additive changes.

**Owner decisions this doc implements (follow-up interview, binding):**

| Topic | Decision |
|---|---|
| Map | "Unlock new districts". After each chapter the player chooses an **adjacent** area the same size as the start map (64×64) to annex. Each district has its own terrain and character. In the sandbox the player can buy more districts with credits. |
| Scale | "Megacity". Dense blocks house thousands, megastructures tens of thousands, a big city reaches millions; jobs scale to match; every population goal, unlock, story threshold and price is rescaled to fit. |
| Skybridges | All four were clunky: placing them (fiddly drag), where they're allowed (confusing, strict), how they look, and why build them (unclear payoff). Rework all four, and make their relation to Skyways crystal clear. |
| Variety (the biggest thing) | No clone buildings; corp tower personality (each faction's towers, crowns and megastructures get distinct architecture; keep what works and deepen it); unique landmarks and more service/civic types; life and atmosphere (crowds, weather, more vehicles, district character, city events). |
| Standing decisions | No losing. Late-game money is the reward (no levies, no treasury-scaled prices). Story cadences are unpaused real seconds (docs/PACING.md) and nothing here adds an interruption. Calendar and growth speed are fine. Phone first (390×844, 360×640, 844×390; 44 px targets; one thumb; the toolbar keeps its 9 categories). Performance on mid-range phones is a hard constraint. |
| Choices that last (owner request after the draft) | "Even if the story ends, you should be able to keep building your city, making it your own. Adds more weight to your choices." Post-ending play exists today; §9 makes the choices visible and permanent in the city the player keeps building, and districts keep coming after the ending. |
| How "price is rescaled" is read | Head counts and population gates are rescaled; **money is kept at per-building parity** (a tower costs and pays what it did, because per-head rates fall ×10 with the units). A single `CR_SCALE` knob (default 1, §4.1) can scale every price later without a contract change. To confirm with the owner at Step 9 (DESIGN.md records it as "prices kept at per-building parity"). |

**Preconditions.** Implementation starts after the expansion (docs/EXPANSION.md, save v3) has fully landed, including its Step 7. Every edit here to a file the expansion or the pacing workflow owns is **additive** (new union members, new rows, new keys, new optional fields) except the explicitly listed rescaled numbers (§4.4) and `MAP_SIZE` (§3.1). This update writes **save version 4**.

**IP and copy.** Every new name is original or a generic term (District, Land Grant, Skybridge, Sky Lobby, Pump House, Floodwatch Station, Metro Station, Arena, Beacon…). Player-facing copy in any file follows STORY.md §1.4 (voice and the banned-term list, which bans *deck*, *shell*, *ghost*, *construct*, *delta* and others as whole words, so no screen name uses them) and EXPANSION's copy rules (no `$` in story bodies). Internal art words in this doc (impostor, kit, skin, deck…) never reach the screen. **Spoiler guard:** the story's reveal is Chapter IV (`ch4.drain` → `ch4.logs` → `ch4.brine`), so no new text that can show before `ch4.logs` mentions gates, sealing, "complying", the death toll or the pump station by number; the Sunk itself opens for annexing only after `ch4.brine` (§3.7), so all of its copy is written after the reveal. §8.6 adds the lint.

**Words.** On screen a **District** is one 64×64 area (owner's word) with a proper name ("Kessel Flats"). The token that annexes one is a **Land Grant** (✦; "grant" in code), not a "charter": *Charter* stays the story's own object (The Charter, Charter Night, the Charter Board, Charter Shore, Charter Hall). The industrial zone is renamed on screen from "Fab District" to **Fab Yards** (Step 0a), so "District" means only the 64×64 area. The existing `{district}` story token keeps naming the small 8×8 neighbourhoods ("Rivet Row") and is called a *neighbourhood* in this doc. In code the 64×64 unit is a **slot** (`SlotId`), its archetype a `DistrictKind`.

**Notation.** As EXPANSION: CR credits, d sim days (speed 1 = 2 d/s, speed 3 = 16 d/s), r a Chebyshev radius in tiles, story effects in STORY.md §0 notation. "×10 units" marks a number already multiplied by `POP_SCALE` (§4). Measured times are Node 22 on the shared 4-core dev container (§2.1); "phone" estimates multiply them by 3.5, an assumption **Step 0b's device benchmark** replaces with a measured factor before the frame is frozen (§12).

---

## 1. Overview and player fantasy

### 1.1 Features

| Feature | Player fantasy | What the player does |
|---|---|---|
| **Districts** | "My city spills over the bay onto the islands, down into the drowned quarter, up the stepped hills. I chose each step, and every district feels like a different place." | After each chapter a **land grant** (✦) arrives with the chapter reward. Open the **City map**, look at the districts next to the city (a night vignette of its buildings, terrain, perks, hazards, who lobbies for it), tap **Annex**. The fog lifts and new land joins the city. Each district has 2–3 optional district goals. After the ending, grants keep coming on the chapter cadence, and credits can buy districts sooner. |
| **Megacity scale** | "A tower of 1,500 people, an office tower of 1,250 jobs, a 2×2 block of 6,000, a Stratablock of 38,000, a city of millions." | Nothing new to learn: every head count is ten times bigger; offices and fabs hold more jobs per lot, so a balanced city is about 60% homes instead of half; megastructures hold far more than the towers around them. Inspect shows floors, homes and jobs per building; the City map shows each district's census. |
| **Skybridges v2** | "Glass walkways between my towers, crowded at night, each one built by a different faction. Three towers linked make a Sky Lobby and tourists come to walk it." | Pick Skybridge, tap a tower: a ghost tube shows each lane at bridge height, buildings in the way turn see-through, and every valid partner glows with its price; tap a partner. One rule: anything lower than the bridge passes under. Towers that don't line up get a two-bridge route. The pill and inspect show walkers, cars saved and land value. |
| **Building variety** | "No two blocks look alike. Dense corners merge into podium towers; each district has its own materials, roofs and building types." | Nothing to do: zone tiles that match merge into 2×1, 1×2 and 2×2 parcels; 44 kit templates plus today's 72 hand-drawn buildings give every cell at least 6 single-lot bodies and 4 merged ones; each district style adds its own silhouettes (stilt houses, hull-roof shacks, courtyard shophouses…). |
| **Faction architecture** | "I can tell a Basalt tower from a Nacre tower from across the bay, and I can see who is winning." | Choose a sponsor and a look when placing a Corp Spire; pick a crown look when raising a Stratablock crown; faction buildings and landmarks come in several designs, each with a live signature (furnace flicker, halo turn, clock hands…), lit brighter when the faction is Allied. Today's designs stay as look 0. |
| **Landmarks and civic** | "A lighthouse on the islands, an arena that fills on match nights, a lookout ring on my tallest towers." | Ten unique landmarks with unlock conditions, five ending landmarks (§9), ten new repeatable service and utility types (§6.3). |
| **Life and atmosphere** | "Crowds under umbrellas, fog on the marsh at dawn, buses and water taxis, a night market lighting up the alleys." | Settings → Weather (Full / Light / Off), Crowds and City life; night markets, lantern nights and match nights happen by themselves now and then, announced by one ticker line. |
| **Choices that last** | "My city remembers what I did: the Truce Wall at the Seam, the open pump hall in the Sunk, Basalt's furnace towers taking over the skyline after Ironwork." | Keep building after the ending: the ending's faction architecture spreads over the skyline, its own landmark can be built, choices across the chapters leave named places and plaques, and epilogue cards and Charter Reviews mention them by name (§9). |

### 1.2 How they interlock

```
 Chapter reward ──► +1 land grant ──► City map: adjacent districts (terrain, perks, hazards, lobbyists)
 (epilogue: a grant per chapter floor)   │ annex (favor to lobbyists, lease choices, district goals)
                                         ▼
   new land ──► more homes/jobs (×10 units) ──► money (per resident unchanged; more land = more income)
     │   │                                            │
     │   └─ district perks / hazards (layers, costs) ─┤
     │                                                ▼
     │                                   landmarks, megastructures, faction architecture
     ▼                                                │
 district style ──► building kit + parcels ───────────┤ (tall towers)
                                                      ▼
                                skybridges ──► Sky Lobbies ──► visitors, land value, fewer car trips
                                                      │
 crowds, vehicles, weather, city life ◄───────────────┘ (read the same city: Market tiles, plazas, arena, stations)
```

The loops the player feels:

1. **Growth loop.** Chapters give land grants; grants give land; land gives people and money; money buys landmarks and megastructures; after the ending grants keep coming and credits buy districts sooner.
2. **Character loop.** Each district changes what is cheap, what is hard and what the city looks like there. Where the player annexes decides who is pleased (lobbyists), which landmarks open (the Beacon needs the Shoals, the Hullhouse the Sunk) and which district goals the player can chase.
3. **Skyline loop.** Dense, well-served blocks reach level 3 and merge into tall parcels; tall towers become skybridge anchors; linked towers form Sky Lobbies that pay back in visitors and land value, which keeps blocks dense and rich.
4. **Memory loop** (§9). Story choices become places on the map; the ending reshapes the skyline; Charter Reviews can swap the ending, and each ending the city has held leaves its towers and its landmark behind.

### 1.3 The first ten minutes and the late game

| | First 10 minutes | Middle (Ch2–Ch5) | Late game and sandbox |
|---|---|---|---|
| Map | **Exactly today's start map** (Charter Shore, same generator). Just past each edge the neighbouring districts show as fog with a dashed border: there is more out there. | One land grant per chapter: 5 more districts by the end of Ch5 (the Sunk opens once Chapter IV's reveal has played). | The ending grants a sixth (7 districts); the epilogue grants one more every chapter floor (24 min on Relaxed) until all 9 are owned, or credits buy them sooner. |
| Numbers | ×10 units from the first lot: "Reach 6,000 residents", an L1 walk-up holds 140, a corner shop 80 jobs. Growth speed is unchanged. | Towers of 1,500, office towers of 1,250 jobs, 2×2 parcels of 6,000, Stratablocks of 38,000. | 1–5 M residents; milestones Night Harbour (600k), Million Windows (1M), Neon Coast (2M), Endless City (4M). |
| Buildings | The kit and parcels from the first block; floors, homes and jobs in inspect. | Faction crowns with three looks each; Spire sponsors and looks; district styles. | Faction landmarks (Charter Hall, Hexworks, Pearl Atrium, Kite Mast…), Arena, Halo Lookout, the ending's landmark. |
| Links | (Skybridges unlock at the Ch3 reward as today.) | Skybridge v2 tap flow, Sky Lobbies. | Lobby of 5+ unlocks the Halo Lookout. |
| Life | Crowds, more vehicle kinds, fog mornings and rain, from the start. | City life begins after 10 minutes of play (one ticker line each). | Arena nights, lantern nights, boats in every canal. |
| Story | Unchanged. No new card or choice before the first grant. | District cards in the relaxed deck (once each); lobby lines on the City map. | Landmark cards; annex reactions; the marks of §9 on the map; epilogue callback cards and Charter Review lines. |

### 1.4 Pace in real time

Every new cadence, in unpaused real seconds unless it is a sim-world process (stated in sim days, like growth, which the owner called fine).

| What | Rule | Speed 1 | Speed 3 | Reads as |
|---|---|---|---|---|
| Land grant (story) | with each chapter reward message (chapter floor 1,440 s on Relaxed) | ≥ 24 min apart | ≥ 24 min apart | a reward, waiting in the message the player opens |
| Land grant (epilogue) | every `pace.chapterMinSec` unpaused seconds after the ending while a slot is locked (1,440 / 840 / 600 s on Relaxed / Normal / Brisk); one ticker line and the ✦ token, no card or banner | 24 min | 24 min | the city keeps growing |
| Annex | player-initiated; camera fly 1.2 s (tap skips), fog lift 1.5 s, then the once-per-district banner | — | — | a celebration, never an interruption |
| District goal done | checked monthly; one ticker line and a stamp on the City map | — | — | a small reward |
| Pump House reclamation | 3 rings × 30 sim d | 45 s | 6 s | land rising out of the canals |
| King tides (Shoals) | 2 × a sim year, 20 d each | 10 s | 1.3 s | weather, like seasons |
| City life | first after 600 s; then every 420–900 s; 90–180 s each (visuals); gameplay terms per sim day with a cap per event; at most one at a time; one ticker line | 7–15 min | 7–15 min | something happening in the city |
| District / landmark deck cards | the pace's deck gaps (PACING.md); all 11 are `once` | rare | rare | — |
| Epilogue callback cards (§9.4) | Chapter VII only, the pace's deck gaps; all `once` | rare | rare | the city remembers |
| Charter Review | every 1,080 d (STORY.md §6.3), delivered at a deck slot, so at most one per deck gap (≥ 15 min on Relaxed); gains one callback line (§9.4) | ≥ 15 min | ≥ 15 min | — |
| Sky Lobby banner | only the city's **first** lobby (moment banner); later lobbies post one news line | — | — | a small celebration |
| Fog mornings | visual clock 05:00–09:00, on 60% of days in a foggy district in view, 25% elsewhere | per visual day | per visual day | atmosphere |
| Skybridge undo | 10 s wall clock (EXPANSION §7.7 rule extended) | 10 s | 10 s | — |
| District name label | when the camera centre crosses into another district: its name fades in and out over 1.5 s, at most once per 20 s | — | — | a sense of place |

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

### 2.6 Review measurements (added in revision)

The two reviews of the draft measured what the averages above hide (scripts in `/tmp/claude-megacity/critic/`), and the revision measured the art heights the skybridge rule needs (`/tmp/claude-megacity/rev/heights.ts`, `heights2.ts`, today's tree with the expansion's tier art):

| What | 64 | 192, 9 districts | Source |
|---|---|---|---|
| One game day as `Game.update` runs it (`step()` + `story.onDay()`), O2–O4 prototype | — | p50 4.74 ms, **p95 7.41 ms, max 13.3 ms** | critic `frames.ts` |
| Month-end frame (step + `onDay` with `onMonth`), prototype or today's code | — | p50 15–17 ms, **max 26 ms** | critic `frames.ts` |
| Autosave (`serialize` + `stringify`), runs inside the `month` handler every 3 sim months (`src/main.ts`) | 0.3 ms | p50 2.3 ms, max 6–8 ms (+ `setItem`) | critic |
| Render cache rebuilds on a `tiles` event: `RoadAccessMap` (renderer.ts) + `StreetTraffic.rebuild` (effects.ts) | 0.27 + 0.18 ms | **1.6 + 1.1 ms**, nearly every tick at speed 3 | critic `n192/render.ts` |
| World + Simulation retained memory | — | 4.3 MB heap + 11 MB typed arrays | critic `a192/heap.ts` |
| `Game.restore` of an empty world (generate 26, sim constructor 11, first `recomputeAll` 12.6 ms) | 16 ms | **109 ms** | critic `a192/gen.ts` |
| Save JSON with tier and ground bits on half the land | — | 278 KB as number arrays; **189 KB** as 3 bytes a tile in base64, round trip 0.98 ms vs 2.43 ms | critic `n192/savesize.ts` |

Art heights (world px above the ground, all 16 variants × 3 tiers): Hab L1 19–33, L2 **52–81**, L3 **128–169**; Market L1 12–30, L2 50–76, L3 131–213; Fab L1 12–29, L2 24–50, L3 69–118. Buildings: Corp Spire 287, Arcology 204, Glarewall 138, Stratablock 83 / 177 / 232 by complete stage.

### 2.7 Decisions these numbers make

1. **The world is a fixed 3×3 grid of 64×64 slots, 192×192 tiles** (§3.1). Fully built (9 districts) the prototype sim takes 4.1–4.9 ms a step in Node, ≈ 15 ms on a phone at the assumed ×3.5: at speed 3 (16 steps a second) about 25% of a phone core. A 4×4 grid (256×256) costs 14–15 ms today and ≈ 8 ms optimised, ≈ 28 ms on a phone, 45% of a core at speed 3, plus 23 ms `recomputeAll`s: rejected. The ×3.5 factor is measured on a device in **Step 0b** before the frame is frozen (§12).
2. **Locked slots cost nothing**: a locked tile is out of bounds for every loop and stencil in the sim, the turf and layer code (§3.3, O1).
3. **Caches and staggering** as prototyped (O2–O4), with the power fill and the coverage key specified exactly (the prototype was not equivalence-safe): −40 to −47%.
4. **No atomic spike over a frame:** averages are not enough (§2.6: p95 7.4 ms, max 13 ms, month end 26 ms in Node). A day is **sliced** across frames, the month-end work is spread over the month's first days, and autosave moves to an idle frame (§3.3). Budgets are p95 and max, per frame (§11.1).
5. **`recomputeAround(rect)`** replaces `recomputeAll` after a player action (O5): `recomputeAll` stays 10–12 ms at 9 districts (35–40 ms on a phone), which would hitch every drag.
6. **Turf from typed mirrors, banded over the month** (O6, prototyped before WP-1): the month-end frame ≤ 8 ms in Node at 9 districts.
7. **Render caches go incremental** (R0, §3.9): the whole-map rebuilds above are 2.7 ms per `tiles` event at 9 districts and appear in no draft budget.
8. **Saves store each owned slot's tiles as a base64 block** of 3 bytes a tile: ≈ 190–240 KB for 9 districts, written in an idle frame (§3.10).
9. **Render:** a multi-district city keeps real sprites down to zoom 0.22 in a **skyline view** (L3 towers, parcels and every building as sprites; L1–L2 as roof tints in the ground cache); pinching out past it snaps to the City map, the only place the low-resolution atlas is drawn (§3.9).
10. **Sleeping districts** (O8) are a **planned contingency with a trigger**: built in WP-1 if Step 0b's device factor exceeds 4.5 (§3.3).

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

**Nine districts in all:** the start, five land grants from chapters I–V, one from the ending, and **two more after the ending**, from epilogue grants or bought with credits (§3.8). The owner asked for "after each chapter"; Chapter VI ends in the ending, so its grant comes with the ending. Whether the sandbox should grow past nine is an open owner question (Appendix E).

**Frame limits.** `SimGrid` stores tile indices in `Uint16Array` lists (`hwList`, `hwReachList`, `skyList`, `skyReachList`) and component ids in `Int16Array` (`hwComp`, `skyComp`, `reachBfs`). 36,864 tiles fit, but a larger frame would overflow silently, so Step 0b adds a static assertion (`MAP_SIZE ** 2 <= 65_535` and `AREA / 2 <= 32_767`) next to `MAP_SIZE` with a comment pointing to Appendix C.

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

/**
 * Ground feature of a land tile (tile bits 22-23). What it does depends on the district (§3.7).
 * A **ruin** is a zoned, abandoned tile with ground Rubble (the Sunk's annex content): it is counted
 * in `ruins`, not `abandoned`, never collapses, and turns Plain when it recovers (§3.3).
 */
export enum Ground { Plain = 0, Reed = 1, Brownfield = 2, Rubble = 3 }

export interface Tile {
  /* …existing… */
  /** Terrace step 0..3 (Highstep Terraces; 0 elsewhere and on water). Saved in bits 20-21. */
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
  // Ending landmarks, one each, buildable only while that ending is current (§9.2)
  | 'gantry' | 'glasssmile' | 'breadpier' | 'recordtower' | 'stillsquare'
  // Fixed structures placed by annex content, never in a tray, never bulldozed
  | 'frame'        // Skeleton Row's unfinished frames (inert until finished)
  | 'pumphall';    // the Sunk's old pump hall (Pump Station 6, §3.7)

export type ServiceEffect = /* …existing… */ | 'resilience' | 'filter';

export interface Building {
  /* …existing… */
  /** Corp Spire only: who paid for it (§6.2). Missing on old saves → 'nacre' (today's power weights and today's art). */
  sponsor?: 'basalt' | 'nacre' | 'none';
  /**
   * Faction building, crown, Spire or landmark design 0..3 (§6.2). **Look 0 is exactly today's art.**
   * Missing → 0 (every v1–v3 building keeps its look). A new placement that skips the picker gets a hash of its id.
   */
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

export interface DistrictCensus { slot: SlotId; kind: DistrictKind; residents: number; jobs: number; developed: number; avgLandValue: number; ruins: number }

export interface CityStats {
  /* …existing… */
  /** Owned districts, in annex order. */
  districts: DistrictCensus[];
  /** Skybridge clusters of ≥ 3 anchors (§5.5). */
  skyLobbies: { count: number; largest: number; visitors: number };
  /** Ruins standing (zoned, abandoned, ground Rubble); not part of `abandoned`. */
  ruins: number;
  /** Ruins that came back as homes or shops (district goal, §3.7); copied from `districts.ruinsRestored`. */
  ruinsRestored: number;
}

export interface Selection { /* …existing… */ /** A skybridge tube was tapped (§5.4). */ link?: number }

export interface BridgePayoff {
  /** People a day walking the bridge: 0.2 × (residents + jobs of both anchors; a parcel counts all its members). */
  walkers: number;
  /** Car trips a day the two towers no longer make (20%, 25% inside a Sky Lobby). */
  tripsCut: number;
  /** Tiles that gain +5% land value. */
  lvTiles: number;
  /** The Sky Lobby this bridge forms or joins (k ≥ 3 anchors), else null. */
  lobby: { k: number; name: string; visitors: number } | null;
}

/** A merged parcel (§6.1): a pure function of tiles and seed, computed by `src/game/parcels.ts`. */
export interface Parcel {
  /** Head tile (the front corner): the parcel's skybridge anchor key and sort key. */
  hx: number; hy: number;
  /** Footprint origin and size: 2×2, 2×1 or 1×2. */
  x: number; y: number; w: 1 | 2; h: 1 | 2;
  /** Drawn level and tier: the lowest among its members. */
  level: number; tier: number;
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
  /** Unspent land grants. */
  grants: number;
  bought: number;
  /** Length 9, indexed by SlotId: the tick the slot was annexed, −1 while locked. */
  annexedAt: number[];
  /** The annex-sheet lease (Tarmac Reach only, §3.7). */
  leases?: { tarmac?: 'nacre' | 'basalt' };
  /** Unpaused real seconds since the ending or the last epilogue grant (§3.8). Missing → 0. */
  epilogueSec?: number;
  /** District goals completed (§3.7), by id. Missing → none. */
  goalsDone?: string[];
  /** Ruins restored since annex (§3.7). Missing → 0. */
  ruinsRestored?: number;
}

/** Version 1, 2, 3 and 4 all load. */
export interface SaveData {
  /* …existing… */
  /** POP_SCALE the head counts in this save are in (10). Missing → ×1 (v1–v3, multiplied at load). */
  scale?: number;
  /** World side (192). Missing on v1–v3 (migrated, §3.10); any other value on a v4 save → treated as a future save. */
  size?: number;
  /** v4 district state. */
  districts?: DistrictSave;
  /** v4: one base64 block per owned slot, in districts.owned order: 4096 tiles × 3 bytes (bits 0-23, little-endian), row-major inside the slot. v4 saves have no `tiles`. */
  tileBlocks?: string[];
}
```

`blankTile()` gains `elev: 0, ground: Ground.Plain`; `makeFields()` the two arrays; `emptyStats()` `districts: []`, `skyLobbies: { count: 0, largest: 0, visitors: 0 }`, `ruins: 0`, `ruinsRestored: 0`.

#### Shared game-side modules (Step 0b, frozen)

- **`src/game/parcels.ts`**: `parcelAt(world, x, y): Parcel | null`, `parcelMap(world)` (a cached `Uint8Array(AREA)`: bits 0-1 shape, bit 2 head, bit 3 member, rebuilt for the aligned 2×2 blocks a `tiles` event touches). A pure function of the tiles and the seed, with no saved state (rules in §6.1). Render, inspect (`getTileInfo`), the skybridge rules and the Sky Lobby count all read it, so a parcel is one thing everywhere.
- **`src/game/heights.ts`**: the one height truth for the skybridge rule and the art. `CLASSIC_TOPS` (a 432-entry table of today's zone body tops, generated once from the art by a script and kept equal by a WP-4 test), `kitTop(spec)` (the formula every kit body's main mass is drawn at, §6.1), `heightOf(world, x, y)` (a tile's or building's top, parcel-aware) and `roofOf(world, x, y)` (an anchor's facade top where a tube attaches; `BUILDINGS[type].roof` for buildings). Bounds the art keeps (WP-4 test): every L2 body ≤ 84, every L3 Hab or Market body (the anchors) ≥ 128, at any style.

#### `src/game/world.ts` additions

```ts
/** District state (saved as SaveData.districts). Written by world.annex() and Game only. */
districts: DistrictSave;            // { kinds, owned, grants, bought, annexedAt, leases, epilogueSec, goalsDone, ruinsRestored }
/** 1 = owned, index SlotId. */
slotOwned = new Uint8Array(9);
/** Owned row segments as [start, end) index pairs, ascending; owned slots side by side in a row merge into one segment. */
segs = new Int32Array(SLOTS * MAP_SIZE * 2);
segCount = 0;                       // number of ints used (2 per segment)
/** ++ on every annex (renderer, SimGrid and turf compare it). */
slotsVersion = 0;
/** ++ when road / zone / building presence changes (power labels, O2). setLevel and setWealth do not bump it. */
conductorVersion = 0;
/** ++ when anything coverage reads changes (O3): building add / remove / stage / crown / sponsor / look / offline / powered, the Metro network flag, Sky Lobby membership. */
coverageVersion = 0;
/** ++ on every setTerrain (Pump House reclamation); the 'terrain' event carries the rect. */
terrainVersion = 0;
/** Tile rect of the owned slots. */
ownedBox: { x0: number; y0: number; x1: number; y1: number };
/** Shoals king tide: days left (0 = none). */
tide = 0;

isOwned(x: number, y: number): boolean;     // in bounds and its slot is owned
ownedAt(i: number): boolean;
slotAt(x: number, y: number): SlotId;       // SLOT_OF[y * N + x]
kindAt(x: number, y: number): DistrictKind; // districts.kinds[slotAt]
/**
 * Structural annex: mark owned, place the district's content (districts/annex.ts) with per-tile events
 * suspended, rebuild segs and ownedBox, then emit one 'tiles' touch for the slot rect and 'annex'. No cost, no rules.
 * Content draws from `new Rng(seed ^ ANNEX_SALT[slot])` and hashes, never world.rng, so later growth rolls don't shift.
 */
annex(slot: SlotId): void;
/** Pump House reclamation: water → land on an **owned** tile only (a bridge becomes a road of its kind; Alley/Ramp rules hold). Bumps conductorVersion and terrainVersion, emits 'terrain'. */
setTerrain(x: number, y: number, terrain: Terrain): void;
setGround(x: number, y: number, g: Ground): void;
```

Static tables in new `src/game/districts/slots.ts`: `SLOT_OF: Uint8Array(36864)`, `slotRect(s)`, `slotNeighbours(s)` (4-adjacent), `adjacentLocked(world): SlotId[]` (the annex candidates), `rebuildSegments(world)`, `artXY(x, y)` (= `x − 64, y − 64`, one global offset, so it is continuous across slot borders and equals today's coordinates on the start slot: render hashes, the `SimGrid.computeTerrainValue` noise, ground `TerrainInfo` hashes and the start slot's neighbourhood names all use it, so a migrated city keeps its land values, puddles, cracks and names).

**Invariants** (Step 0b enforces them in every mutator; the contract test runs every mutator in random order, with random annexes, and checks after each call): no road, zone, building, rail, sky, link anchor or turf on a locked tile; terrain changes only on owned tiles; `elev = 0` and `ground = Plain` on water; `segs` covers exactly the owned slots; EXPANSION §2.1's invariants still hold.

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
  recoverMul?: number;                  // ruin recovery chance ×
  restorePay?: number;                  // CR paid when a ruin here comes back (cap per month in RUINS)
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
  /** Annexable only once this story condition holds (the Sunk: ch4.brine shown); before it the City map says "Still flooded: opens later". */
  opensWhen?: Condition;
  perks: string[];         // ≤ 3 lines ≤ 48 chars
  hazards: string[];       // ≤ 2 lines ≤ 48 chars
  water: [number, number]; // target water share
  fog: number;             // chance of a fog morning (§6.4)
  /** Building and ground style (§6.1); one style per kind, so the style id is the kind. */
  style: DistrictKind;
  neighbourhoods: string[];// 12 names ≤ 15 chars: the {district} token inside it
  /** 2–3 optional goals shown on the City map once owned (§3.7). */
  goals: DistrictGoal[];
  mods: DistrictMods;
}

/** A district goal: checked on the month tick by `districts/goals.ts` (a check function per id, WP-2); reward paid once, one ticker line, a stamp on the City map. */
export interface DistrictGoal { id: string; label: string /* ≤ 40 */; reward: number; /** hidden while this building type is hidden or locked */ needs?: BuildingType }

export const DISTRICTS: Record<DistrictKind, DistrictDef> = { /* §3.7 */ };

/**
 * Price of the next district by districts owned (index 1..8), after an ending only. Fixed numbers, never scaled
 * with funds. Placeholders: Step 9 sets the last two so each is 8–12 unpaused minutes of the D1 median
 * 7-district city's net income at speed 1 (§11.3); the lower rows only matter for a city whose grants were lost.
 */
export const DISTRICT_PRICES: readonly number[] = [0, 1_000_000, 1_200_000, 1_400_000, 1_600_000, 1_800_000, 2_000_000, 2_500_000, 4_000_000];

export const ANNEX = {
  lobbyFavor: 6, rivalLobbyFavor: -2,
  leaseFavor: 8, leaseRivalFavor: -4,
  flyInSec: 1.2, fogLiftSec: 1.5,
  /** Tiles of locked land the camera may show past the owned box. */
  peek: 6,
} as const;

/** Ruins (§3.7): recovery pay cap, blight weight, collapse exemption. */
export const RUINS = { payCapMonth: 4_000, blightWeight: 0.5 } as const;

/** Every price × this (§0, "How price is rescaled"): 1 = per-building parity. Read by costOf / upkeepOf only. */
export const CR_SCALE = 1;

/** Port limits grow with owned districts (§3.5). */
export const PORT_LIMITS = {
  seaport: (owned: number) => 2 + Math.floor((owned - 1) / 3),    // 2, 3 at 4+, 4 at 7+
  airport: (owned: number) => (owned >= 4 ? 2 : 1),               // the second only inside Tarmac Reach
  spaceport: (_owned: number) => 1,
} as const;
```

`BuildingDef` gains (optional; absent = today's behaviour): `height?: number` (the building's top) and `roof?: number` (the facade top a skybridge tube attaches under), both in world px, set by Step 0b from today's art (Spire 287 / ≈ 200, Arcology 204 / ≈ 180, Glarewall 138 / ≈ 120, Stratablock by complete stage 83 / 177 / 232 with roof ≈ 160 from stage 2) and kept by the WP-4 art test (§5.3); `site?: 'shore' | 'water'` (`'water'`: the footprint is on water, Tidal Turbine); `hidden?: boolean` (never in a tray: `frame`, `pumphall`, and any dropped optional type); `fixed?: boolean` (`frame`, `pumphall`: cannot be bulldozed). `BuildingGate` (story/types.ts) gains `district?: DistrictKind`, `lobby?: number`, `districts?: number`, `chapter?: number` (§6.3) and `ending?: EndingId` (§9.2). `EDGE_LINKS` gains `perDistrict: 4` (cap = 12 + 4 × (owned − 1)). Events (`events.ts`): `annex: { slot: SlotId; kind: DistrictKind }`, `grant: { grants: number; why: 'chapter' | 'ending' | 'epilogue' | 'migrated' }`, `terrain: { x0, y0, x1, y1 }`, `districtGoal: { slot: SlotId; id: string }`, `cityEvent: { id: CityEventId; phase: 'start' | 'end'; slot?: SlotId }`; `toast.action.id` gains `'map'`.

### 3.3 The sim with districts

The world is one continuous city: roads, power, services, traffic, turf and skybridges cross slot borders with no special case, because the arrays are one 192×192 grid. Locked slots hold nothing, so they contribute nothing; what has to change is that today's code **visits** them, and that a full day at 9 districts is too big to run in one frame. The optimisations, each with an owner (WP-1 unless stated) and its measured or expected effect:

| # | Change | Effect |
|---|---|---|
| **O1** | **Owned segments, one boundary rule.** Every per-tile loop in `sim/*.ts`, `story/turf.ts`, `story/mods.ts` (`composeLayers`, `resetLayers`) and `story/vertical.ts` (`refresh`, WP-2) iterates `for (let s = 0; s < w.segCount; s += 2) for (let i = w.segs[s]; i < w.segs[s + 1]; i++)`. **A locked tile is exactly out of bounds for every stencil** (`blur3` both directions, turf dilations, the water-view BFS of `computeTerrainValue`, road access, coverage stamps): each stencil treats it like today's map edge, whatever the scratch buffers hold, so a v3 city in the start slot computes exactly what it did on the 64 map (S1, §11.3). The day's tile-age loop walks zoned, road and building tiles only. `turf.landTiles`, `capFor` and `turf.share` count owned land only. | removes the 2.9 ms of empty area (§2.3): "1 of 9" ≈ today |
| **O2** | **Power, specified exactly.** Component labels are cached on `world.conductorVersion`. Every tick: supply and demand per component. A component with **supply 0** is unpowered, with no BFS. A component with **supply ≥ demand > 0** powers every tile and sets `remain[c] = supply − demand`, so `PowerGrid.tryReserve` and `canFeed` see the true headroom. Only components with **0 < supply < demand** run today's allocation BFS. (The draft's prototype skipped the subtraction and was not equivalence-safe.) Test: on 50 random cities, including disconnected consumers, zero-supply components and brownouts, `powered`, `remain`, `compDeficit` and `building.powered` equal today's BFS exactly; re-measure after the fix. | power 29% of a step → ~10% (to be re-measured) |
| **O3** | **Coverage cached** on `(world.coverageVersion, world.mods version, layer part versions)`. `coverageVersion` bumps on building add / remove / stage / crown / sponsor / look / offline / powered, the Metro network flag (§6.3) and Sky Lobby membership (Halo Lookout); `mods` covers `securityMul` (deals, crackdowns); the layer versions cover `transitAdd` and the district `parkAdd`. Test: toggling each input changes the cached fields exactly as an uncached pass does. | coverage 10% → ~0 on quiet ticks |
| **O4** | **4-phase field stagger** (`FIELD_STAGGER` 4): 0 traffic; 1 pollution + noise; 2 neighbourhood + land value; 3 crime + wealth score. Field latency 4 days (2 s at speed 1). With tick slicing (below) at most one field phase runs per frame. | −40% together with O2–O3 (§2.4) |
| **O5** | **`Simulation.recomputeAround(rect)`** after player actions: power (relabel only if conductors changed), coverage (if its key changed), traffic in full (highway and sky pools are network-wide), then pollution, neighbourhood, land value, crime and wealth score on `rect ⊕ 12` rows clipped to owned segments, then census, averages and budget. If the traffic change **outside** the window exceeds 2% of any tile's volume, a full field pass is scheduled for the next ticks (sliced as usual). `Game.apply` passes the plan's touched rect. Tax and budget sliders (`ui/budget.ts` calls `recomputeAll` at the end of every drag today) call `sim.recomputeEconomy()` (census and budget only). `recomputeAll` stays for load, new city and annex; WP-1 lists every remaining caller in its hand-off. | an action costs ~4 ms in Node at 9 districts instead of 10–12 |
| **O6** | **Turf from typed mirrors, banded over the month** (prototyped in `/tmp/claude-megacity/` before WP-1 starts; the ≤ 8 ms month-end frame of §11.1 is the bar). `turf.computeMaps` reads `SimGrid`'s typed arrays instead of `Tile` objects, keeps today's **separable** dilations but runs them over owned segments only, and runs in 4 row bands on days 1–4 of each month into a double buffer; the monthly rules apply the finished buffer on day 4. `bestTile` (seeding, tagback) scans owned eligible tiles only when needed. `refreshStats` over owned segments. | `onMonth` 9.4 ms → 4 slices of ≤ 2 ms |
| **O7** | Budget projection every 3rd tick (the month-end tick always projects fresh before `settleMonth`). | −0.3 ms at 9 districts |
| **O8** | **Sleeping districts: a planned contingency with a trigger.** A slot with no player action for 120 s and no level change for 60 d samples growth at ¼ rate and runs its local field passes every 4th cycle. **Trigger:** Step 0b's device benchmark measures a phone factor above 4.5 (instead of the assumed 3.5), or the p95 day on the device exceeds 12 ms at 9 districts. Then O8 is built inside WP-1 before Wave 2 starts; otherwise it is not built. | ≈ −40% at 9 districts with 5 asleep (estimate) |

**Tick slicing and the frame guard** (`Simulation.stepSlice`, WP-1; `Game.update`, WP-2). `step()` stays as the headless whole-day call (tests, the measure harness). The game calls `stepSlice(budgetMs)`, which runs the current day's next **slices**, each atomic: **A** scan, power, coverage, census count; **B** this day's field phase (O4); **C** growth sample, tiers, district daily hook, budget, advisor, then `story.onDay`. A day completes over 1–3 frames; stats and events are published only when C completes, so the UI never sees half a day. Sim work per frame is capped at 6 ms on coarse-pointer devices (10 ms otherwise); a slice never starts if the frame has already spent the cap. At speed 3 (16 days a second) that is 48 slices a second, under one per frame at 60 fps. The dropped-backlog threshold stays at today's 4 days (`game.ts`; raised to 6 only if the device check shows calendar loss at speed 3), so a hitch (an annex `recomputeAll`, a GC pause) never turns into seconds of saturated catch-up.

**Month end, spread** (WP-1 for the sim, WP-2 for the story parts it calls). The story's `onMonth` parts move off the month-end tick: `turf` bands on days 1–4 (O6), `vertical.refresh` on day 2, `turf.refreshStats` and `composeLayers` on day 4; `settleMonth` (budget) stays on the month-end tick with its projection precomputed on the tick before (O7). Every slice C stays within the frame cap.

**Autosave off the month tick** (`src/main.ts`, WP-2). The `month` handler only sets `saveDue`. The save runs on the first frame after it in which no sim slice ran (`requestIdleCallback` with a 500 ms timeout fallback), at most every max(3 sim months, 60 unpaused seconds). Serialization uses the tile blocks of §3.10 (≈ 1 ms in Node at 9 districts); `localStorage.setItem` of a 240 KB string is measured on the device in Step 0b.

**District rules in the sim** (WP-1, reading `DISTRICTS[kind].mods`, tile `elev` / `ground` and the district layer part):

- **Layers.** `SimLayers` gains `parkAdd` and `pollutionAdd` (identity 0); `LayerParts` gains `district` (both frozen in Step 0b in `story/mods.ts`'s `makeLayers` / `makeLayerParts`). `districts/effects.ts` (WP-2) writes the district part: `lvAdd` (Shoals shore +0.04, Sunk rubble −0.04, Tarmac −0.03, Terraces +0.035 × elev, king-tide −0.03), `crimeAdd` (Sunk decay, frames), `parkAdd` (unbuilt reed tiles 0.5 r1), `pollutionAdd` (brownfield 0.15, developed 0.07). Ground changes mark the part dirty; it is rebuilt **at most once per sim day**, plus on annex, at tide start and end and on the first day of each sim year (crime decay). `composeLayers` merges it like the story parts.
- **Terrain changes** (Pump House reclamation): the `terrain` event's rect triggers a local recompute of `computeTerrainValue` within `WATER_VIEW_RANGE` of it (WP-1), of ground `TerrainInfo` depth and tone inside it (WP-3), and of Seaport `shoreSites` (WP-1 `ports.ts`); nothing assumes terrain is fixed after generation any more.
- **Fields.** Coverage max-combines `parkAdd` into `park`; pollution adds `pollutionAdd` to the sources and multiplies the diffused field by `1 − 0.25 × filter`; `resilience` and `filter` are ordinary coverage effects (added to `EFFECTS`).
- **Ruins** (§3.7). A ruin is a zoned, abandoned tile with ground Rubble. Census counts it in `ruins`, **not** `abandoned`, so the advisor's "N buildings stand abandoned" line, Undertow's "Dark lots" mood driver (`content/factions.ts`, `abandoned / 10`) and the `abandoned`-keyed cards and spot rules (`nc.renewal`, Undertow's `abandoned ≥ 5` card) never see ruins. Ruins never collapse (exempt from `COLLAPSE_AGE`), blight the neighbourhood field at half weight (`RUINS.blightWeight`), and recover like abandoned tiles once a road is within 3 and power arrives, at `RECOVER_CHANCE × recoverMul` (2 in the Sunk); recovery sets ground Plain, adds 1 to `districts.ruinsRestored` and pays `restorePay` (cap `RUINS.payCapMonth` a month). Bulldozing a ruin costs the normal fee and leaves an unzoned rubble lot. The advisor gains one ruins line (Appendix B).
- **Growth.** Reedmere floodplain tiles (land within 1 of water, marked at annex) cannot step to level 3 while `resilience` = 0; a brownfield tile clears (`setGround(Plain)`) when a sampled tile is developed with `age ≥ 720`, or has `park ≥ 0.3` or `filter > 0` with `age ≥ 360`.
- **Demand.** `Simulation.setTrade` adds Kessel Flats' +2,000 industrial jobs while it has < 400 developed Fab tiles, the Tarmac lease (+2,000 Market or Fab jobs), and the Bazaar's visitors (`PortSystem` raw visitors) at 600 per 10 developed Market tiles there, cap 30,000. The turf demand term (`TURF.demandPer100`, +0.04 per 100 gang tiles today) is divided by the number of owned districts, so one district is unchanged and a gang at its 8% cap over nine districts adds what it adds today (≈ +0.1).
- **Census** fills `stats.districts` in the same pass (residents, jobs, developed tiles, ruins and mean land value per owned slot).
- **Daily** (`districts/daily.ts`, WP-2, called from slice C through a Step 0b hook): Pump House reclamation, king tides (`world.tide`), frame crime refresh on finish, district goals on the month tick (§3.7).

### 3.4 Locked slots

- **Building anything** on a locked tile is refused tile by tile: `ok: false`, reason "Not annexed yet", `plan.slot` set. The pill shows the reason; lifting the finger on such a plan toasts "Kessel Flats isn't part of the city yet" with a **Map** action (44 px) that opens the City map on that slot.
- Bulldoze and story tools ignore locked tiles. Turf never forms there; story spot rules only search owned tiles (they already search developed tiles, which locked slots never have).
- **Inspect** on a locked tile opens the district preview (name, tagline, perks, hazards, lobbyists) with "Open City map". A district whose `opensWhen` does not hold yet (the Sunk before `ch4.brine`) shows only its name and "Still flooded: opens later", with no reason given.
- Roads may run right up to the owned boundary; that is how regional links work (§3.5).

### 3.5 Map edge, regional links and ports

- **Boundary tile:** an owned tile with a 4-neighbour that is off the map or in a locked slot.
- **Regional link** (EXPANSION §3.10's rule with "map border" replaced by "boundary"): a ground road on a boundary tile, whose outward neighbour is off-map or locked and whose inward neighbour is a road it links to. Points as EXPANSION (Street 1, Avenue 2, Highway 3); cap `12 + 4 × (owned − 1)` (44 at 9 districts); demand per point in ×10 units (Fab 250 jobs, Market 120); visitors per point 400 (X3).
- **Annexing turns a shared border internal:** its links stop counting. The annex sheet says so ("3 regional links here become city streets"); the new district's outer boundary is where the next ones go. The world's outer edge (x or y = 0 or 191) is a permanent boundary.
- **Stubs:** each owned slot gets 2 painted regional-road stubs on its outer boundary (art, from the seed), redrawn when the boundary moves. Cars spawn and leave at boundary roads (EXPANSION §3.11 with the boundary; the spawn rule in `art/traffic.ts` is WP-3's in Wave 2, the rest of that file WP-6's in Wave 3).
- **Ports:** a Seaport's berth tiles must be owned open water; the ship's approach may cross locked water (art only). Airport, Spaceport and every footprint must be owned. Planes and launches ignore slots.
- **Port limits grow with the city** (`PORT_LIMITS`, §3.2; `SEAPORT.maxCounted` follows the Seaport limit): Seaports 2 at 1–3 districts, 3 at 4–6, 4 at 7–9; Airports 1, and a second from 4 districts that must stand inside Tarmac Reach (so its "Airport 25% off" perk always has a use); one Spaceport. A city of millions with one harbour and one airport would undercut the realism the owner asked for; the limit message names the next step ("A third Seaport needs 4 districts").

### 3.6 Terrain generation

#### 3.6.1 Pipeline (`src/game/districts/terrain.ts`, WP-2; Step 0b ships a plain-noise stub with the same signature)

1. **Start slot:** today's `generateTerrain` run in slot-local coordinates and written at +64, +64: **bit-identical** to today's map for the same seed (test), so new cities start exactly as before and the balance tests keep their terrain.
2. **Layout:** `assignKinds(seed, baySide, riverAxis, riverExits)` (§3.6.2) → `kinds[9]`.
3. **Edge slots** in the order 1, 5, 7, 3, then **corners** 0, 2, 6, 8, each with its kind's generator (§3.7) and **border blending** against every neighbour already generated: for depth d = 0..5 from the shared border, `w = (6 − d) / 6`; a tile is water when `w × p(k) + (1 − w) × own(k, d) > 0.5`, where `p(k)` is the neighbour's border tile (water 1, land 0) smoothed over k ± 1, and `own` is the generator's value scaled to 0..1 around its threshold. A water run of 2–4 tiles on the neighbour's border (a river mouth) is continued as a channel of the same width that meanders (`sin` + fbm, as today's river) to the opposite edge or into the kind's water body. Corners take the larger blend weight of their two neighbours.
4. Every generator uses `new Rng(seed ^ SALT[slot])` and `fbm(…, seed + 100 × slot)`, so locked slots regenerate identically at every load. Owned slots are saved (§3.10), so a later generator change only alters land nobody owns yet.

Cost: 32,768 tiles of fbm at world creation, < 25 ms in Node (once per new city or migration). **On load** only the locked slots are generated, plus the 6-tile border strips of owned slots that blending reads (owned land comes from the save); each slot's fbm field is computed once into a scratch `Float32Array(4096)` so the Shoals' threshold iterations (and any other iterative rule) reuse it instead of recomputing noise. The review measured a full `Game.restore` of an empty 192 world at 109 ms in Node with today's code (§2.6); §11.1 budgets it.

#### 3.6.2 Which district goes where

Relative to the start map's bay side (`side` in `generateTerrain`: 0 north, 1 east, 2 south, 3 west) and its river (`riverAxis`: crosses the west and east edges when 0, north and south when 1). Rng `new Rng(seed ^ 0x6d454741)` so no other roll shifts:

1. The edge slot across the bay → **Saltglass Shoals** (the bay continues into islands).
2. One of the two corners flanking it (rng) → **The Sunk** (the drowned lower wards lie along the old shore).
3. The river-exit edge slot that is not the Shoals (rng if two) → **Reedmere Marsh** (the river spreads into reeds).
4. The edge slot opposite the bay, if free, else the free corner on that side → **Highstep Terraces** (inland hills).
5. A free slot touching the bay side if any, else any free slot → **Kessel Flats** (it carves its own dock basin either way).
6. The rest → **Skeleton Row**, **Tarmac Reach**, **Verdigris Bazaar**, shuffled.

A contract test runs 200 seeds: every kind appears once, the Shoals is always across the bay, every slot's land share is inside its kind's range, and every slot is buildable (≥ 35% land in one 4-connected component).

### 3.7 The nine districts

| Kind | Name (short) | Water | Lobby | Perks (City map lines) | Hazards | Style |
|---|---|---|---|---|---|---|
| `shore` | Charter Shore (Shore) | today | — | — | — | shore |
| `shoals` | Saltglass Shoals (Shoals) | 45–60% | Nacre | Bridges 40% cheaper · Waterfront land value +4% · Harbour Beacon site | King tides twice a year · Floodwatch stops them | shoals |
| `sunk` | The Sunk (The Sunk) | 25–35% | Undertow | Ruins come back as cheap homes · Restoring a ruin pays 40 CR · Pump Houses raise new land | Crime +6%, fading over years · The Undertow is here first | sunk |
| `flats` | Kessel Flats (Kessel Flats) | 8–15% | Basalt | Fab zoning half price · Reactors and Seaports 15% off · Extra industrial demand | Brownfield smog until the soil clears | flats |
| `terraces` | Highstep Terraces (Terraces) | 3–8% | Tuning (once active), else Board | Views: +3.5% land value per step | Roads cost double on slopes · Buildings need flat ground | terraces |
| `reedmere` | Reedmere Marsh (Reedmere) | 25–40% | Board | Unbuilt reeds act as free parks · Tidal Turbine sites | Floodplain: level 2 at most without Floodwatch | reedmere |
| `skeleton` | Skeleton Row (Skeleton Row) | 5–10% | Kites | Finish a half-built tower for 60% of the price | Crime near the empty frames · The Kites live up there | skeleton |
| `tarmac` | Tarmac Reach (Tarmac Reach) | 5–15% | Nacre and Basalt (lease) | Roads 30% cheaper · Second Airport site, 25% off · Lease the apron: +2,000 jobs demand | Windswept: land value −3% · Families live on the apron | tarmac |
| `bazaar` | Verdigris Bazaar (Verdigris) | 5–12% | Undertow and Kites | A ready-made alley quarter · Night markets draw visitors · Market Hall half price | Alleys bring crime · Both crews want it | bazaar |

Taglines (City map, ≤ 60 chars): Shore "Where the charter opened the shore. Your first streets."; Shoals "Islands and sandbars across the bay. Bridges come cheap."; Sunk "The drowned wards. People still live there." (after the ch4.brine choice it changes, §9.3); Flats "Slag, rail yards and a long dock. Industry moves in fast."; Terraces "A stepped hillside. Views sell, slopes cost."; Reedmere "Reeds and channels. Free parkland while you leave it be."; Skeleton "Unfinished towers from a developer who went bust."; Tarmac "An old airfield. Flat, open and windy."; Bazaar "A tangle of alleys and night stalls under copper roofs."

Every district style also brings its own building silhouettes (§6.1, at least 25% of the bodies drawn there), its own ground props (§3.9) and 2–3 optional **district goals**, shown on its City map sheet once it is owned and checked on the month tick (`districts/goals.ts`, WP-2). A goal pays its reward once, posts one ticker line ("Kessel Flats: two Seaports on the basin. +25,000 CR") and stamps the district on the City map; it never opens a card.

#### Saltglass Shoals (`shoals`)

- **Terrain:** water by default; land where `fbm(x·0.06, y·0.06) > t` (islands, t starting at 0.52 and lowered by 0.01 until land ≥ 40%), plus sandbars where `|fbm2 − 0.5| < 0.02` (one-tile land strips joining some islands). The bay side continues open water for the first 8 tiles from the shared border except where the start map's coast pokes through.
- **Mods:** `bridgeCostMul 0.6`, `bridgeUpkeepMul 0.7`, `lvShore +0.04`, `kingTide { months: [3, 9], days: 20, lv: −0.03 }` (land within 1 of open water, cancelled where `resilience > 0`).
- **Content on annex:** none (terrain is the content); 2 stubs. The Harbour Beacon (§6.3) needs a Shoals shore tile.
- **Goals:** "Bridge 3 islands to the city" (20,000); "Light the Harbour Beacon" (10,000); "150,000 residents on the Shoals" (25,000).
- **Neighbourhoods:** Pelican Key, Gull Reef, Pearl Spit, Low Key, Shell Bar, Ferry Row, Sandbar, Tide Key, Kelp Wharf, Glass Key, Tern Point, Salt Row.
- **Look:** white render and pastel walls on stilts, boardwalk edges, rope bollards, ferry piers; gulls (art) by day. Own silhouettes: stilt houses, boardwalk terraces, a ferry-pier hall.

#### The Sunk (`sunk`)

- **When it opens:** `opensWhen` = `ch4.brine` answered, i.e. `any(flagIs('published'), flagIs('buried'), flagIs('leashed'))` (each of its three choices sets one; existing vocabulary), which is after the whole Chapter IV beat chain (`ch4.drain`, `ch4.logs`, `ch4.brine`). Before that it shows on the City map as a locked slot with its name and "Still flooded: opens later", and is never a candidate; story-wise, {patron}'s drain in `ch4.drain` is what opens it to the city. So everything the Sunk says or offers (lobby line, perks, `ds.sunk`, Pump Houses there) is written for a player who knows what the logs said, and no Pump House can drain it before Chapter IV. (It is a corner slot, so in practice it is the 4th annex or later anyway.)
- **Terrain:** the old street grid flooded: canals on every 8th local row and column (offset by `hash(seed)`), 2 tiles wide, except 30% of canal segments that survive as land causeways; 3–5 sunken plazas (3×3 pools). Water 25–35%.
- **Content on annex** (batched, §3.2): **ruins** on 35% of land tiles: zone tiles (Hab 60%, Market 40%), level 1 (70%) or 2, abandoned, tier $, a hashed variant, ground Rubble (§3.3: counted as `ruins`, never as `abandoned`; they never collapse; they come back when a road reaches within 3 and power arrives). Rubble ground (unzoned) on 20% of the remaining land. **The old pump hall** (`pumphall`, 3×3, `fixed`, `hidden`, inert: no power, upkeep, jobs or trips) on the causeway nearest the start slot's coast: Pump Station 6, where the logs were found. It is visible in the fog from the start (a dark hall on the water), named only "Old pump hall" until the Sunk opens; its look follows the ch4.brine choice (§9.3). Pump Houses may not be placed within r6 of it.
- **Mods:** `crime { v: 0.06, halfLifeDays: 1080 }`, `lvAll −0.04` on rubble tiles only, `recoverMul 2`, `restorePay 40` (cap `RUINS.payCapMonth` 4,000 a month). There is no pay for clearing a ruin: the district rewards bringing people back, not bulldozing their streets.
- **Story:** the Undertow seeds here on annex if it has seeded (else at its normal seeding, with the Sunk's best tile preferred); Brine lobbies for it. The Pump House (§6.3) raises canals into land. The Sunk Memorial built inside the Sunk uses its "Lower Wards" look (§9.3).
- **Goals:** "Restore 40 ruins" (20,000); "Raise 3 pump gardens" (15,000); "A Sunk Memorial by the water" (10,000, shown only while the memorial is unlocked).
- **Neighbourhoods:** Silt Row, Drowned Mile, Pump Lane, Old Ward, Hullside, Weir Street, Canal Nine, Mudlark, Cistern Row, Kelpmarket, Rope Walk, Low Tide.
- **Look:** waterline stains, patched brick and salvaged sheet metal, green-tinted lamps, mooring rings and boats tied to doorways. Own silhouettes: hull-roof shacks, canal-front lofts with boat doors, a stair-tower on a causeway.

#### Kessel Flats (`flats`)

- **Terrain:** almost all land; one straight dock basin 4 tiles wide along the slot edge farthest from the start (or through the middle if that edge is the world edge on the bay side), straight for ≥ 40 tiles so it offers ≥ 3 Seaport sites (`shoreSites` test).
- **Content on annex:** brownfield ground on 60% of land (blobs where `fbm > 0.4`), old rail-yard ground art on brownfield, 2 stubs (one aimed at the basin).
- **Mods:** `zoneCostMul { ind: 0.5 }`, `buildCostMul { reactor: 0.85, foundry: 0.85, seaport: 0.85, hexworks: 0.85 }`, `demandInd { jobs: 2000, whileFabBelow: 400 }`, `brownfield { pollution: 0.15, developedPollution: 0.07, clearDays: 720, parkClearDays: 360 }`.
- **Goals:** "Clear 300 brownfield lots" (20,000); "Two Seaports on the basin" (25,000); "A Reclaim Works in the Flats" (10,000).
- **Neighbourhoods:** Slag Hill, Rivet Row, Yard Nine, Coke Ovens, Kessel Cross, Sidings, Furnace End, Ash Lane, Gantry Row, Cinder Mile, Pressworks, Coal Wharf.
- **Look:** corrugated steel and soot brick, sawtooth roofs, chimneys, sodium light, oil-sheen puddles. Own silhouettes: gantry sheds, coke-oven rows, worker barracks with a rooftop pipe rack.

#### Highstep Terraces (`terraces`)

- **Terrain:** `elev = clamp(floor((fbm(x·0.05, y·0.05) − 0.3) × 6 + d/24), 0, 3)` where `d` is the distance from the shared border with the city (the hill rises away from it); cells of a step smaller than 3×3 are merged into the lower step; one stream (water 3–8%).
- **Mods:** `lvPerElev 0.035`, `slopeRoadMul 2` (a road tile with a 4-neighbour on a different step), and every building footprint must be flat (reason "Needs flat ground"). Parcels never span two steps; a skyway or rail span may not change step.
- **Render (core):** contour shading per step in the ground cache, painted retaining-wall faces on the +x / +y sides where the neighbour is lower, stair decals on Streets between steps, building bases darkened by step. **Real raised steps** (every layer offset by `elev × 8`) are a separate optional package after Step 9 (§12), with the full list of layers it touches.
- **Story:** the Tuning lobbies once active (Ohm); before that the Board (Marrow). The Geothermal Bore (§6.3) needs a terrace step ≥ 1.
- **Goals:** "Level 3 towers on the top step" (20,000); "Tap the hill: a Geothermal Bore" (15,000, hidden if the Bore is dropped).
- **Neighbourhoods:** Stone Steps, High Terrace, Vinehill, Stairwell, Overlook, Cistern Hill, Glimmer Rise, Tierside, Lookout, Quarry Steps, Ember Rise, Ridge Row.
- **Look:** stepped stone, terrace gardens, stairs between steps, warm lamps along every stair. Own silhouettes: stepped hillside houses, a stair-street row, cliff-face apartments.

#### Reedmere Marsh (`reedmere`)

- **Terrain:** braided channels: the start map's river (if it exits here) splits into 3–5 channels of width 1–2 that wander and rejoin; otherwise 3 channels from the slot's edges. Water 25–40%.
- **Content on annex:** reed ground on 50% of land within 4 of water (`fbm > 0.35`); floodplain marks (land within 1 of water).
- **Mods:** `reedPark { v: 0.5, r: 1 }` (only while the reed tile has no road, zone or building), `floodplainMaxLevel 2` (unless `resilience > 0`).
- **Goals:** "Keep 300 reed lots wild at 100,000 residents" (25,000); "A Floodwatch Station in the marsh" (10,000).
- **Neighbourhoods:** Reedmere, Heron Flats, Wickfen, Sedge Row, Mere End, Willowcut, Fenlight, Eelbrook, Marsh End, Rushmoor, Cattail, Mudbank.
- **Look:** timber and green roofs, boardwalk paths, reeds swaying (animated tint), herons (art) by day, the foggiest district (`fog 0.6`). Own silhouettes: long houses on piles, reed-thatched boathouses.

#### Skeleton Row (`skeleton`)

- **Terrain:** mostly land; one small canal. Water 5–10%.
- **Content on annex:** 5 **frames** (`frame`, 4×4, `fixed`, inert: no power, upkeep, jobs or trips; not tall) on flat land ≥ 10 tiles apart, a broken street grid (Streets on 40% of a 6-tile grid's segments), rubble on 15% of land.
- **Finish a frame:** inspect action "Finish frame · 7,200 CR" (60% of the Stratablock plinth, `STACK_STAGES[0].cost × 0.6`, ignoring the per-stack 1.15 scale) replaces it with a `stack` at **stage 1 complete** (no 60-day plinth wait) in the Skeleton style; later stages as normal. Needs `unlock stack` (or its fallback).
- **Mods:** `frameCrime { v: 0.04, r: 3 }` around unfinished frames.
- **Story:** the Kites seed on a frame on annex (if seeded): `frame` joins `TURF_KEEPING` (world.ts) and `KEEPS_TURF` (turf.ts), so turf can stand on a frame's footprint; finishing a frame into a Stratablock clears it as for any building. lark lobbies.
- **Goals:** "Finish 2 frames" (20,000); "A Sky Lobby in Skeleton Row" (20,000).
- **Neighbourhoods:** Rebar Row, The Frames, Crane Yard, Hollow Tower, Scaffold Lane, Formwork, Skyhook, Bare Steel, Topping Out, Lift Shaft, Ninth Floor, Girder Park.
- **Look:** raw concrete and exposed rebar, tarps flapping, tower cranes frozen mid-swing, Kites' string lights on the frame tops at night. Own silhouettes: scaffold-wrapped half-towers, a tower with a bare concrete top storey.

#### Tarmac Reach (`tarmac`)

- **Terrain:** flat land, one shore edge or a lagoon (water 5–15%).
- **Content on annex:** an old runway strip (6×40) and apron (12×12) painted as ground art (brownfield bits, no pollution in this district), 2 stubs, and **the apron families**: a cluster of 24 Hab tiles at level 1, tier $, on the apron's edge with a Back Alley through it (an affordable quarter, EXPANSION §4.4), which `ds.tarmac` can rehouse or clear (§8.3).
- **Mods:** `roadCostMul 0.7`, `buildCostMul { airport: 0.75, spaceport: 0.8 }`, `lvAll −0.03`. The city's second Airport may only stand here (§3.5).
- **Lease** (annex sheet, §7.2): "Lease the old apron to:" **Nacre** (+2,000 Market jobs of demand, Nacre +8, Basalt −4) or **Basalt** (+2,000 Fab jobs, Basalt +8, Nacre −4).
- **Goals:** "A second Airport on the old field" (30,000); "100,000 residents on the Reach" (20,000).
- **Neighbourhoods:** Apron Nine, Old Tower, Hangar Row, Taxiway, Windsock, Runway End, Beacon Hill, Jetwash, Holding Bay, Tarmac Cross, Radar Row, Hardstand.
- **Look:** low hangars, wide sheds, windsocks, faded runway numbers, blinking obstruction lights. Own silhouettes: hangar homes under arched roofs, a control-tower block.

#### Verdigris Bazaar (`bazaar`)

- **Terrain:** land with one canal (water 5–12%).
- **Content on annex:** a Back Alley tangle on a jittered 3-tile grid (≈ 18% of land), two Streets entering from each shared border, 1×1 empty squares at alley crossings.
- **Mods:** `visitorsPerMarket { per: 600, tiles: 10, cap: 30000 }`, `buildCostMul { markethall: 0.5 }`; both gangs' turf affinity +0.1 inside it (`TURF.affinity.*.bazaar`).
- **Story:** both gangs lobby for it (both +6 on annex); who runs its night stalls is settled later in the card `ds.bazaar` (§8.3), not on the annex sheet.
- **Goals:** "40 Market lots at $$ or better" (20,000); "A Market Hall in the Bazaar" (10,000, hidden if the Market Hall is dropped).
- **Neighbourhoods:** Tinsmith Row, Paper Lane, Spice Row, Noodle Steps, Tin Market, Wireway, Brass Court, Silk Steps, Coil Street, Pawn Row, Charm Lane, Abacus Bridge.
- **Look:** copper and verdigris roofs, paper lanterns strung across alleys (animated glow), awnings, dense hand-painted signs in the invented glyph set. Own silhouettes: courtyard shophouses, a stacked market tower with balconies on every floor.

**Naming lint** (WP-7, `content-lint`): no neighbourhood name appears in two lists (the start list in `news.ts` included), no neighbourhood contains a district name, and in the new names this doc adds (districts, neighbourhoods, landmarks, milestones, Sky Lobby names, crowns) "Lamp" / "Lantern" appear only for the Tuning, plus the one neutral `lanterns` City life night (existing names such as "Thousand Lamps" and "Lantern Row" stay). Event and news lines that name a neighbourhood append the district short name when the city has more than one district ("Paper Lane, Verdigris").

### 3.8 Annexing

- **Land grants (story).** Each chapter reward (Ch1–Ch5) and the ending carry the new effect `grant 1` (§8.4): `districts.grants` +1, event `grant`, the goal chip shows a gold "✦ 1" token until spent. Grants never expire.
- **Land grants (epilogue).** After the ending, Game counts unpaused real seconds in `districts.epilogueSec` (saved) and grants one more every `pace.chapterMinSec` (1,440 s on Relaxed, 840 on Normal, 600 on Brisk: the same floor that spaced the chapters), while at least one slot is locked and no grant is unspent. It arrives as one ticker line ("A land grant arrives: the city may annex again.") and the ✦ token; never a card, banner or pause. A 7-district city at Charter Night reaches 9 districts about 48 minutes later on Relaxed without spending a credit.
- **Candidates:** locked slots 4-adjacent to an owned slot (`adjacentLocked`) whose `opensWhen` holds. Non-adjacent locked slots show on the City map but cannot be annexed ("Not next to the city yet"); the Sunk before `ch4.brine` shows "Still flooded: opens later".
- **Price:** one grant while the player has any; otherwise, **only after an ending is chosen**, `DISTRICT_PRICES[owned]` credits (fixed numbers: placeholders 2,500,000 for the 8th and 4,000,000 for the 9th, set by Step 9 to 8–12 unpaused minutes of a median 7-district city's net income at speed 1). Buying skips the wait for the next epilogue grant; it never resets that clock. Before the ending without a grant: "Next land grant: finish Chapter III".
- **The edge of the region.** With all 9 districts owned the City map says "The city reaches the edge of the region." and the sandbox's goals take over: the 2M and 4M milestones (§4.5), every district goal, the landmark set (all ten landmarks and, through Charter Reviews, all five ending landmarks, §9.2) and Pump House reclamation of the remaining bay.
- **`Game.annex(slot, lease?)`** (WP-2): checks; pays (grant, or funds and `bought` +1); `world.annex(slot)` (batched: one `tiles` touch for the slot rect); rebuilds the district layer part; `director.onAnnex(kind, lease)` (favor, §8.2); `sim.recomputeAll()`; emits `annex`; queues the once-per-kind moment banner ("DISTRICT ANNEXED · KESSEL FLATS" / "Fab zoning half price") in `MilestoneBanner`. Not undoable (it is confirmed on the sheet, §7.2). Same seed and same annex order give an identical world (test).
- **Migration** (§3.10) grants what a v3 city has earned: completed chapters (at most 5), plus 1 if an ending was chosen; a post-ending save also starts its epilogue clock at 0.

### 3.9 The renderer with districts (WP-3)

Three view bands for a city of more than one district (a one-district city keeps today's view down to zoom 0.25, so nothing changes until the first annex):

| Band | Zoom | What draws | Why |
|---|---|---|---|
| **Street view** | ≥ 0.4 | everything, as today (LOD sprites below `LOD_ZOOM` 0.55) | ≤ 2,195 tiles on screen at 0.4 (portrait), inside today's worst case |
| **Skyline view** | 0.22–0.4 | real sprites for L3 towers, parcels and **every** building (Spires, crowns, Arcologies, landmarks), at the sprite cache's bucketed scales; L1–L2 bodies as roof tints painted into the ground cache's bucket; roads, rail, skyways and skybridges as today; no crowds, cars or fine fx | the zoomed-out night skyline is where "a city of millions" is felt, so towers, crowns and lit windows stay sharp; the sweep visits the clipped box but draws only tall things (cap: 2,600 sprites a frame, nearest the screen centre first; the rest of the tall bodies drop to roof tints, measured in M7) |
| **City map** | the 3×3 world fitted (≈ 0.03–0.05) | one atlas impostor per slot (below) | the whole region at a glance; only reached as a separate view |

- **Camera** (`camera.ts`, additive, the public API stays): `bounds: Rect | null` in tiles, used by `clamp()` instead of `0..MAP_SIZE` when set; `setBounds(r)`; `fitBox(r, insetBottomPx = 0)` (frames a tile rect above a bottom sheet: the City map frames the 3×3 world in the top half). Slot taps on the atlas and Annex pin taps are pure geometry (`camera.screenToTile` → `slotAt`; pin centres from `slotRect` → `camera.tileToScreen`), so input and UI never call into the renderer. The Renderer sets `bounds` to the owned box ± `ANNEX.peek` (6), `minZoom` to 0.25 for one district and **0.22** otherwise, and `fitMap()` fits the owned box. `visibleTileBounds` keeps clipping to the map. (Step 0b already ships bounds, `minZoom`, `fitMap` to the owned box, the sweep clip and the owned-box overview, so the build between Step 0b and WP-3 looks like today; WP-3 adds the rest.)
- **The pinch-out gesture:** continued pinch-out at `minZoom` snaps, animated over 0.3 s, to the City map framing; pinching in (or tapping an owned slot) on the City map snaps back to `minZoom` centred where the fingers are. There are no intermediate atlas zooms, so the atlas is never shown magnified: at the City map framing (≈ 0.04 × DPR 2 = 0.08 device px per world px) the 0.1 atlas is drawn at least 1:1.
- **Ground cache.** `OX` and the chunk grid are unchanged in form (N = 192). Locked tiles inside the peek margin paint in a **fog** style: terrain colour × 0.45 mixed 30% toward `[40, 26, 70]`, no props, no roads, but the Sunk's old pump hall shows as a dark hall shape; a dashed boundary line (`#8f7bff`, 2 world px, alpha 0.6, dash 10/8) along the owned edge. Below zoom 0.4 (more than one district) the ground chunk also paints L1–L2 roof tints (one flat roof diamond per developed tile in the body's wall colour, darkened by night bucket).
- **Annex pins**: a 44 px round screen-space button with "+" and the short name at the middle of each candidate slot's shared border, drawn after the ground; input hit-tests it and opens the City map on that slot. Pins show **only while a grant waits**, or after the ending while the next district's price is affordable; otherwise the dashed border alone says there is more land.
- **District name label**: when the camera centre crosses into another owned district, its name ("KESSEL FLATS") fades in at the top of the map area and out over 1.5 s, at most once per 20 s, never while a tool is dragging.
- **Overview bucket** (the pan fallback while chunks paint): covers the visible region ∩ (owned box + peek) at ≥ 0.2 device px per world px, rebuilt progressively as the camera moves, within 4 MB. It is a transient fallback: chunks at the current bucket paint within the existing per-frame chunk budget, so it shows for a few frames during a fast pan.
- **Atlas** (`render/atlas.ts`, City map only): one cached impostor per slot at 0.1 device px per world px (≈ 410×236 px, 0.39 MB; 3.5 MB for 9). Owned slots: ground colour per tile, a shaded prism per developed tile (height by level), prisms for buildings, lit-window dots in 3 night buckets; locked slots: fog terrain (water, land, terrace tints) with the kind's icon. Repainted **progressively** in row bands within ≤ 2 ms a frame, only when the City map opens (dirty slots) and on annex while it is open. Frame cost: 9 blits and labels, ≤ 1 ms. `styleVignette(kind)` paints the annex sheet's night vignette (3 kit bodies in the district style, §7.2) into a small canvas once per kind.
- **Sweep:** `drawObjects` iterates the visible box clipped to the owned box; at zoom ≥ 0.4 the on-screen count is ≤ 2,195 (portrait), inside today's worst case. Below 0.55 sprites stay on the sprite cache's scale buckets (no exact-scale repaint on settle), so a zoom change does not repaint every visible body.
- **R0: render caches go incremental** (WP-3, with WP-6 for `effects.ts` / `art/traffic.ts`). Today several render caches rebuild over the whole map on every `tiles` event, and growth emits one nearly every tick at speed 3: `RoadAccessMap` (renderer.ts: `fillKinds` + `computeAccess`) and `StreetTraffic.rebuild` (effects.ts) cost 1.6 + 1.1 ms in Node at 9 districts (§2.6). WP-3 inventories every N×N loop in `src/render` and `src/ui` (also overlay `darkState` once per tick, overlay builds, `drawToolHints` recomputing `shoreSites` on every `world.version` while the Seaport tool is active, the `StoryRender` tall mask, `SkywayLayer`'s shape list, ground `TerrainInfo`) and makes each one dirty-rect incremental from the rect the `tiles` event already carries (`events.ts`: `{ x0, y0, x1, y1 }`), or clips it to owned segments; full rebuilds are throttled to at most one per 250 ms. Budget: render cache upkeep ≤ 0.3 ms a frame on average and ≤ 1 ms p95 at 9 districts in Node during a speed-3 growth run (§11.1, test R1).
- **Terraces** (`elev`): contour shading, painted retaining walls, stair decals and darkened building bases (core, §3.7); nothing is raised. `elevOffset(world, x, y)` is frozen in Step 0b and returns 0 until the optional raised-steps package (§12).
- **District ground character** (ground cache, per style): pavement tint and street furniture (Shoals boardwalks and bollards, Sunk canal walls and mooring rings, Kessel rail tracks on brownfield, Terraces stairs, Reedmere reeds and boardwalks, Skeleton rubble and cones, Tarmac runway numbers and windsocks, Bazaar paper lanterns over alleys, glowing in the animated pass).
- **The title Showcase** (`ui/start/showcase.ts`) builds its own World, Simulation and Renderer; with `MAP_SIZE` 192 that is another ≈ 15 MB, so it is released when the title closes (WP-5), and `loadPrevious` drops the current world before restoring the other.
- Budgets: ground chunks 24 MB (unchanged), sprite cache 32 MB (unchanged), overview ≤ 4 MB, atlas ≤ 4 MB.

### 3.10 Saves: version 4 and migration

- `SAVE_VERSION = 4`, `SAVE_VERSIONS_SUPPORTED = [1, 2, 3, 4]`, `SAVE_KEY` unchanged.
- **Tile bits:** EXPANSION §2.3 plus **20-21 elev** (0..3; written 0 on water) and **22-23 ground** (0..3; written 0 on water). Bits 24-31 are not stored in v4 (a later version that needs them widens the block).
- **v4 layout:** `size: 192`, `scale: 10`, `districts` (§3.2), and `tileBlocks`: one base64 string per owned slot in `districts.owned` order, 4096 tiles × 3 bytes (bits 0-23, little-endian), row-major inside the slot (so the start slot's block decodes to exactly the old tile numbers). The review measured 189 KB for 9 built districts this way against 278 KB as number arrays with realistic tier and ground bits, and a 2.5× faster round trip (§2.6). Buildings, sky, turf, rail and links are stored in world coordinates. Locked slots are not saved: `deserialize` first generates the locked slots and the border strips blending needs (§3.6.1; each blends against *generated* neighbours, never against edited land, so a Pump House can't shift a locked coastline between sessions), then decodes the owned blocks over it. A block that is not 16,384 base64 characters, a block count ≠ `owned.length`, a duplicate or out-of-range slot, or `owned` without `START_SLOT` → "Incompatible save" (raw string copied to `.unreadable`, EXPANSION §2.5).
- **Which saves migrate:** only `version ≤ 3` (`upgradeSave`). A v4 save whose `size` is not 192 is treated as a **future save** (left untouched, autosave blocked, EXPANSION §2.5), not as "Incompatible"; a v4 save is never migrated as if it were v3.
- **Migration** `upgradeSave(data): SaveData` (new `src/game/districts/migrate.ts`, pure JSON → JSON, Step 0b), for `version ≤ 3`:
  - offset (64, 64); `remap(i) = ((i >> 6) + 64) * 192 + (i & 63) + 64`;
  - `tiles` → the start slot's block verbatim;
  - buildings `x`, `y` += 64; `sky` (v3), story `turf` and `rail`: RLE-decode at 4096, place, RLE-encode at 36,864; `links` `ax ay bx by` += 64;
  - story tile indices through `remap` (−1 / null kept): `seam`, `pending.spot`, `open.spot`, `waiting.spot`, `railOut[].i`; coordinates += 64: `locals[].x/y`, `crackdowns[].x/y`. Step 0b lists them in `TILE_INDEX_FIELDS` / `TILE_XY_FIELDS`, and a contract test walks every `StoryState` key so a future field cannot be missed;
  - **scale:** a save without `scale` gets `maxPopulation × 10` and its `milestones` mapped to the ×10 thresholds; then `scale: 10`;
  - `districts`: `kinds` from §3.6.2 (the start terrain is regenerated from the seed and checked against the saved terrain bits; on a mismatch, e.g. a hand-edited save, the layout still comes from the seed), `owned [4]`, `grants` as §3.8, `bought 0`, `annexedAt` (length 9, by SlotId) −1 except slot 4 = the save's tick, `epilogueSec 0`;
  - story: `endingHistory` from `ending` / `endingVariant` / `endingTick` when an ending was chosen (§9.6).
  - **Backups by source version:** the first v1 or v2 load keeps writing `${SAVE_KEY}.v2` (today's rule) and the first v3 load writes `${SAVE_KEY}.v3`, each once and never overwritten (today's `keepOldSave` writes `.v2` whenever `loadedVersion < SAVE_VERSION`, which after the bump would file a v3 save under `.v2`). `loadedVersion` keeps the original version (EXPANSION's `settleWealth` still runs for < 3).
  - `previousSaveInfo` (the previous-city slot on the title screen) multiplies a backup's `maxPopulation` by 10 when it has no `scale`, so the title never shows ×1 numbers.
- **Size:** 9 districts fully built ≈ 190–240 KB with tile blocks; budget **≤ 260 KB**, tested with the megacity fixture with tiers and ground set. Write ≤ 2 ms p95 in Node, in an idle frame (§3.3). Total storage with backups (`.v2`, `.v3`, the previous-city slot, `.future`, `.unreadable`) ≤ 1.2 MB. A failed `storageSet` toasts "Couldn't save: storage is full" once a session.

---
## 4. Megacity scale

### 4.1 Approach: a unit change, then a density pass

Two steps, both in Step 0a, so each can be checked on its own:

**1. Units. `POP_SCALE = 10` is a change of units for people.** Every head count (residents and jobs of every zone level, building, stage and crown; every population threshold) is multiplied by 10, and every rate *per head* (tax, trips, trade, visitor spending, the salt price slope, the power-share divisors) is divided by 10. Everything per tile and per building (taxes, traffic, power, pollution, growth, upkeep, prices) is therefore **identical within rounding**, which S1 pins at the commit that lands this step (§11.3). The story's pacing (PACING.md, measured on population gates) is unchanged because its gates move with the units.

**2. Density pass: businesses provide enough jobs.** Units alone keep the felt problem: with today's demand ratios (`COM_PER_RES` 0.25, `COM_PER_IND` 0.1, `IND_PER_WORKER` 0.45 of `WORKFORCE_SHARE` 0.6) one L3 Hab tile of 1,500 residents wants about 415 Market jobs and 405 Fab jobs, which is 0.46 Market L3 tiles and 0.54 Fab L3 tiles: **a balanced city is half shops and fabs** (≈ 50% Hab, 23% Market, 27% Fab land), and a shop lot holds fewer people than a house lot. Offices and modern fabs are denser than that, so the pass raises jobs per tile at L2–L3 (table below) and leaves demand per head, tax per job and power per tile unchanged:

- A balanced L3 city becomes **≈ 60% Hab, 20% Market, 20% Fab** land (per Hab tile: 0.33 Market and 0.34 Fab tiles).
- Money per resident is unchanged (the same jobs per resident pay the same tax per job); a district holds about a fifth more residents because less of it is shops and fabs, so income per district rises by about that much ("late-game money is the reward").
- Trips per tile follow capacity (a Market L3 tile makes ×1.39 the trips, a Fab L3 tile ×1.6; city-wide trips per resident are unchanged), so downtowns are busier: a real city's shape. S4 checks average traffic; if it misses, Step 9 adds a per-level trip factor rather than touching capacity.
- Megastructures get a density premium so they out-house the towers beside them (§4.2).
- S1 stays meaningful: `tests/megacity-scale.test.ts` keeps its static half (every head count in the tables equals v3 × 10, times the density table for Market and Fab L2–L3 and the listed megastructures; every per-head rate equals v3 ÷ 10), and **S4** (§11.3) measures the density pass dynamically.

Why ×10 and not steeper level ratios: an L1 walk-up of 140 people (≈ 58 homes on a ~40 m lot), an L2 slab of 480, an L3 tower of 1,500 (35–45 floors), an office tower of 1,250 jobs and a Stratablock of 38,000 are realistic; growth gates, power and the story's pacing keep working because the level ratios for homes stay. A fully built district (the fixture's fixed zone mix) held ≈ 480,000 before the density pass (48,374 × 10 measured); D1 measures the balanced figure (§11.3). What makes the scale *felt* is added on top: 2×2 parcel towers (§6.1), megastructure and landmark numbers (§4.2, §6.3), new milestones (§4.5) and the realism surfaces (§4.6).

**Unchanged on purpose:** lore numbers (the 11,000 below the gates, the 90,212 above them, MOTH's `> lamps 4,112` telemetry), money (costs, upkeep, grants, chapter rewards, CR in cards; `CR_SCALE` = 1, §0), tile counts (`dev.*`, turf tiles, road and skyway tiles, `abandoned`), percentages, radii, MW, sim days and real seconds. There is no water utility (Appendix C).

### 4.2 Capacities

Zones, residents or jobs per tile after both steps (EXPANSION §4.4's tier multipliers and the affordable ×1.1 apply unchanged; **bold** = raised by the density pass):

| | L1 | L2 | L3 | L3 $$$ | 2×2 parcel at L3 (four tiles, §6.1) |
|---|---|---|---|---|---|
| Hab Blocks (residents) | 140 | 480 | 1,500 | 1,350 | 6,000 |
| Market Strip (jobs) | 80 | **380** (280 by units alone) | **1,250** (900) | 1,190 | 5,000 |
| Fab Yards (jobs) | 120 | **450** (340) | **1,200** (750) | 1,080 | 4,800 |

Buildings (×10; cost unchanged; **bold** = density premium, with power and upkeep adjusted so per-resident running costs stay near a Hab L3 tile's):

| Building | Residents | Jobs | | Building | Residents | Jobs |
|---|---|---|---|---|---|---|
| Fusion Reactor | — | 400 | | Stratablock Plinth | — | 3,000 Market + 1,000 Fab |
| Enforcer Precinct | — | 200 | | + Hab Core | **+32,000** (power 80 → 150, upkeep 180 → 260) | — |
| Med Clinic | — | 250 | | + Crown | **+6,000** | +3,000 Market |
| Data Hub | — | 100 | | Crown: Foundry | — | +2,500 Fab |
| Maglev Station | — | 150 | | Crown: Commons | **+10,000** | — |
| Corp Spire | — | **8,000** (power 60 → 80) | | Crown: Salvage (new) | — | +3,000 (untaxed) |
| Arcology | **40,000** (power 220 → 290) | 1,200 | | Foundry Spine | — | 2,500 |
| Academy | — | 300 | | Glarewall | — | 100 |
| Seaport | — | 2,400 | | Tidemarket | — | 1,500 (untaxed) |
| Airport | — | 3,200 | | Commons Hall | — | 300 |
| Spaceport | — | 5,500 (2,500 Fab) | | New types | §6.3 | §6.3 |

A full Stratablock (16 tiles) is **38,000 residents and 7,000 jobs** (42,000 with the Commons crown), against 24,000 for 16 plain L3 Hab tiles: "megastructures house tens of thousands" and inspect shows it. **Balance assertion** (S4): every megastructure (full Stratablock, Arcology, Corp Spire, Hexworks, Pearl Atrium) houses or employs at least 1.5× the heads of its footprint in L3 zone tiles of its kind. Service coverage radii are unchanged and services still have no capacity limit (Appendix C).

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
| corp investment (incident payout) | sim/incidents.ts | `1500 + 0.4 × pop` (1,500–12,000) | `1500 + 0.04 × pop` | payouts unchanged |
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
| config.ts | `MILESTONES[].pop` | ×10, plus four new rows (§4.5) |
| config.ts | `ZONES.com.capacity`, `ZONES.ind.capacity` (density pass) | L2 / L3: Market 380 / 1,250, Fab 450 / 1,200 (×10 units) |
| config.ts | `STACK_STAGES[1].res` and `.power` / `.upkeep`, `STACK_STAGES[2].res`, `CROWNS.commons.residents`, `BUILDINGS.arcology.residents` / `.powerUse`, `BUILDINGS.spire.jobs` / `.powerUse` (density premium) | 32,000 (150 / 260); 6,000; 10,000; 40,000 (290); 8,000 (80) |
| config.ts, every UI string | `ZONES.ind.name` "Fab District" and the strings that quote it (`ui/tips.ts` academy tip, the two "Fab Districts" mood labels in `content/factions.ts`, three advisor lines in `sim/advisor.ts`, the welcome news in `game.ts`, `wealth.ts` / `painter.ts` comments) | "Fab Yards" (Step 0a; the zone's tool id stays `ind`) |
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
| story/content/whispers.ts, story/director.ts | `NOTE_CROSSINGS_PER_BRIDGE = 150` and the literal 150 in `director.fillNote` (the line "> {n} people crossed the sky today") | replaced by Σ `BridgePayoff.walkers` over active bridges (already ×10 units), so the note matches inspect |
| story/turf.ts | `TURF.demandPer100` term | divided by owned districts (§3.3); `landTiles`, `capFor`, `turf.share` over owned land |
| story/content/chapters.ts | triggers, fallbacks, goals, beat conditions, goal labels and `show.target` | Ch1 beats `pop ≥ 1,000` / `≥ 3,000`, goal 6,000; Ch2 trigger 15,000 (fallback 10,000), goals 30,000 and `pop ≥ 10,000` on `c2.jobs`; Ch3 50,000 (35,000), goal 70,000; Ch4 90,000 (60,000), goal 120,000; Ch5 150,000, goal 180,000; Ch6 220,000 |
| story/content/cards/undertow.ts | `ut.surge` `pop ≥ 2000` | 20,000 |
| story/content/cards/nacre.ts | `nc.census` `pop ≥ 3000` | 30,000 |
| story/content/cards/board.ts | `bd.ballot` `pop ≥ 3000` | 30,000 |
| world.ts / districts/migrate.ts | loaded `maxPopulation`, `milestones` (saves without `scale`) | ×10, mapped to the new thresholds |
| tests | every population expectation (balance, playthrough, story harness, expansion balance) | ×10 (Step 0a) |
| docs/STORY.md, docs/EXPANSION.md | tables quoting populations, jobs and residents | ×10, with a note pointing here (Step 9) |

A lint (`tests/megacity-scale.test.ts`, Step 0a) fails on any `m('pop', …)` threshold in story content that is not a multiple of 1,000 or whose goal label number differs from its condition, on any `unlockPop` that is not a multiple of 10, and on any per-tile-count term (`/per100|perTile|per 100/i` in `config.ts` and `story/*.ts`) that is not listed in this table as reviewed.

### 4.5 Milestones

| Residents | Title | Reward (CR, unchanged where it existed) |
|---|---|---|
| 1,000 | Settlement | 1,000 |
| 5,000 | Outpost | 2,000 |
| 15,000 | Boomtown | 4,000 |
| 50,000 | Neon Metro | 8,000 |
| 120,000 | Megacity | 15,000 |
| 300,000 | Thousand Lamps | 30,000 |
| **600,000** | **Night Harbour** (new) | 45,000 |
| **1,000,000** | **Million Windows** (new) | 60,000 |
| **2,000,000** | **Neon Coast** (new) | 90,000 |
| **4,000,000** | **Endless City** (new) | 150,000 |

The new rows need more than one district (a balanced district holds roughly half a million), so they are the late game's and the sandbox's growth goals. Each still gives Board +3 (STORY.md §2.6). "Lamp" and "Lantern" stay reserved for the Tuning (§3.7 naming lint), so the new titles avoid them.

### 4.6 Display and realism surfaces

- **Formatting** (`ui/format.ts`, unchanged functions): the HUD shows `groupInt` below 100,000 and `abbr` above ("482k", "1.24M": three significant digits, the owner's "1.2M" style); the City map census always `abbr`; inspect, goals and news `groupInt` ("1,500,000" fits the 12-character value column). No new formatter.
- **Inspect, zone tile** (WP-2 fills `TileInfo`, WP-5 renders): subtitle "{form} · {floors} floors" ("Point tower · 41 floors", "Office tower · 38 floors"); rows Residents `1,480` and Homes `617` (residents / 2.4) for Hab Blocks, **Jobs `1,250`** for shops and fabs ("employs 1,250" in the subtitle's tooltip line for offices); a merged parcel adds the note "Part of a 2×2 tower: 5,920 residents" (`getTileInfo` reads `src/game/parcels.ts`, so Game knows the parcel). `floors = max(1, round(top / 6.5))` from `heightOf` (`src/game/heights.ts`), so Game computes it without importing render.
- **Inspect, megastructures:** "Stratablock · 61 floors"; rows Residents, Jobs, Stage.
- **City map census** per district: residents, jobs, "1 job per 1.7 residents", land value.
- **Report:** a "Districts" block (one compact row per district) and the city line "2.41M residents · 1.38M jobs · 7 districts".

---
## 5. Skybridges v2

### 5.1 The four complaints and their fixes

| Complaint | Today (STORY.md §4.3) | v2 |
|---|---|---|
| Placing (fiddly drag) | drag exactly from one tall tower to another, straight along x or y | **tap a tower, tap a partner**; the first tap hits the tower's whole silhouette; a ghost tube shows every lane at bridge height and buildings in the way turn see-through; after a bridge, its far tower stays selected for the next one; towers that don't line up get a **two-bridge route**; drags still work and **snap** to the nearest valid partner within 2 tiles of the finger |
| Where they're allowed (confusing, strict) | gap 2..8; any tall tower in between blocks; no skyway under the gap; 2 bridges per anchor | gap **1..10** (bridge across a single street); **one height rule: anything lower than the bridge passes under** (so L2 never blocks a bridge between L3 towers); skyways, rail and roads pass under; a merged parcel tower is one anchor; crossings at different heights allowed; every rule is **drawn** on the map while the tool is active |
| How they look | an 8 px glass tube, 0.24 tile wide | a 14 px tube, 0.32 tile wide with a floor slab and end collars, **seven skins** by faction and district, walkers by day, moving lights by night |
| Why build them | effects hidden in the sim | numbers on the pill and in inspect (walkers a day, cars saved, land value); **Sky Lobbies**: 3+ linked towers pull visitors and raise land value; 5+ unlock the **Halo Lookout** |

### 5.2 Skybridge, Ribbon Rail and Skyway: three jobs

Three elevated links share the Sky tray's **Links** chip. They stay three things with three verbs, because they serve different users at different heights with different gestures; a merged tool could not be explained in one tray line (Appendix C).

| | **Skybridge** (this section) | **Ribbon Rail** (STORY.md §4.4) | **Skyway** (EXPANSION §3.7) |
|---|---|---|---|
| Carries | people, on foot | people, by train | cars |
| Height | high: just under the lower tower's roof (≈ 120–200 px) | 28 px viaduct | low: a 52 px deck, about three floors up |
| Placed by | tapping a tower, then a partner | dragging between stations | dragging, like a road (≤ 24 tiles) |
| Ends on | two tall towers | stations (Maglev Stations and Stratablocks) | a street (ramp) or a megastructure (dock) |
| Path | same row or column (a two-bridge route otherwise) | any path along the drag | any L-shaped drag |
| Pays off | the towers make fewer car trips; land value near both ends; Sky Lobbies draw visitors | joins stations into a live line (transit, chapter goals) | takes car traffic off the streets near its ramps; docks feed megastructures |
| Looks | glass or faction-built tube, walkers, lit floors | slim lit viaduct, trains | dark asphalt deck, magenta edge, headlights |
| Tray meta (≤ 22) | "Walkway · tap 2 towers" | "Trains · drag" | "Cars · drag" |
| Inspect subtitle | "A walkway for people. Skyways carry cars." | (today's) | "A raised road for cars. Skybridges are for people." |

The skybridge and the skyway may now cross: a skyway may run under a skybridge's gap and a skybridge over a skyway (EXPANSION §3.7's "Skybridge in the way" / "Skyway in the way" rules are removed; their heights never meet). Rail passes under too.

### 5.3 Rules

Heights come from `src/game/heights.ts` (§3.2), the same numbers the art draws, so the rule and the picture agree by construction.

1. **Both ends are tall anchors:** a level-3 Hab or Market tile that is not abandoned, a merged parcel whose drawn level is 3 (one anchor, keyed on its head tile, §6.1), or a tall building (Corp Spire, Arcology, Glarewall, Stratablock with complete stage ≥ 2, Med Tower, Pearl Atrium, Hexworks, Kite Mast, Halo Lookout, the ending landmarks marked tall in §9.2). Both must be in owned districts.
2. **They line up:** a row or column of one anchor's footprint meets the other's footprint. Lanes run along each footprint row and column (a band as wide as the footprint for parcels and buildings), and the tube attaches at the facing facade (`edgeAnchor` extended to parcels).
3. **Gap:** 1 to 10 tiles between their facing edges (`SKYBRIDGE.minGap` 2 → 1, `maxGap` 8 → 10).
4. **Tube height:** the lower anchor's roof `R = min(roofOf(a), roofOf(b))`; the tube's **top** is `R − 6` and its **bottom** `R − 23` (14 px tube + 3 px slab). Single L3 towers have `R ≥ 128` (measured art 128–213 for Hab and Market L3, kept by the WP-4 test), so a bridge between two of them runs with its bottom at ≥ 105 px.
5. **Clear line, one rule: anything lower than the bridge passes under.** A gap tile blocks only if its `heightOf` is above the tube bottom − 6 px clearance (`R − 29`). Derived guarantees, each a contract test: every L2 body (≤ 84 px, any style) passes under a bridge between L3 towers (`128 − 29 = 99 > 84`); an L3 tower or a taller building in the gap blocks a bridge between the shortest L3 towers; between taller anchors (Stratablocks, Arcologies, parcel towers) ordinary L3 towers can pass under. In words on screen: "Buildings lower than the bridge pass under."
6. **Limits:** a single zone tower takes 2 bridges, a parcel tower 3, a building 4, the Kite Mast 6 (`maxPerAnchor`, `maxPerParcel`, `maxPerBuilding`, `maxPerMast`). Links saved before a parcel formed under them stay valid even if that puts the parcel over its limit (the limit applies to new bridges).
7. **Crossing:** two bridges may cross over one tile when their tubes are ≥ 20 px apart in height (`crossGap` 20: one tube plus slab is 17 px); otherwise "Another skybridge crosses here".
8. **Cost** 1,200 + 250 per gap tile (was 300); **upkeep** 15 + 3 per gap tile a month ("Skybridges" line). The most expensive bridge (gap 10) costs 3,700: below `SAFETY.confirmCost`, so one bridge builds on the second tap, with **Undo** (10 s, EXPANSION §7.7 extended to skybridges: removes the link and refunds).
9. **Dark** (today's "sealed" state, renamed on screen): if an end stops being tall or loses power, the bridge goes dark, costs no upkeep and does nothing; it relights by itself. The news line becomes "Skybridge dark: an anchor dropped below the skyline." (`vertical.ts`, WP-2).

Reasons (≤ 32 chars, for the pill and red dots): "Start on a tall tower", "Not lined up with this tower", "Too far: 10 tiles at most", "Towers touch: no gap", "A taller building is in the way", "This tower has its 2 bridges", "This tower has its 3 bridges", "This building has 4 bridges", "Another skybridge crosses here", "Not annexed yet".

### 5.4 Placement flow

1. **Select the tool** (Sky → Links → Skybridge). Every tall anchor in view glows (today's `drawAnchors`); level-2 Hab and Market towers show a faint dotted roof outline, "grows tall at level 3" on tap.
2. **Tap a tower (A).** The first tap is hit-tested against the whole sprite silhouette of tall anchors (not the ground tile), picking the nearest tall anchor within 24 px of the finger. A gets a ring, and the camera eases (0.3 s) so A and its 10-tile reach fit the screen above the pill. Each lane shows as a **ghost tube at bridge height** (translucent, green up to the first blocker, red beyond it), and every building standing inside a lane is drawn **see-through** (alpha 0.35) while A is selected, so the rule is visible in a dense downtown. Partner badges, decluttered: valid partners get a green 44 px badge with the price ("1,450"); invalid ones a 16 px red dot (tapping it shows the reason in the pill); at most 8 badges show, nearest first, placed to avoid overlap. Two-bridge routes (a blue "2") appear only after the player taps the **Show routes** chip in the pill.
3. **Tap a green partner (B):** the bridge builds at once, with the pill showing its payoff for 3 s ("SKYBRIDGE · 1,450 CR" / "600 walkers · cars −20%") and the Undo toast. **B becomes the selected tower**, so a Sky Lobby takes one tap per bridge.
4. **Tap a blue "2":** the pill shows "2 SKYBRIDGES · 3,100 CR" and the route ghost, with ✓ / ✕ (a compound action always confirms). ✓ builds both.
5. **Tap empty ground or A again:** deselect. The tool chip's ✕ leaves the tool.
6. **Drag** still works: press on A and drag; the ghost snaps to the nearest valid partner within 2 tiles of the finger; lift to build.
7. **Desktop:** click-click, the same flow; Esc deselects.

APIs (WP-2, `story/vertical.ts`; Game wraps them): `skybridgePartners(world, ax, ay): Partner[]` (`{ x, y, ok, reason?, cost, route?: { via: { x, y } } }`), `planSkybridge` (v2 rules, fills `plan.bridge`, `plan.route`), `skybridgePayoff(world, a, b): BridgePayoff`, `laneBands(world, ax, ay)` (the lane rects the overlay draws and dims). Partner search scans the lanes × 11 tiles plus, for routes, the lanes of each valid partner: a few hundred tile checks, recomputed on tap and on `tiles` events while a source is selected.

### 5.5 Payoff

Per active bridge (today's effects, now shown): both towers' car trips ×0.8 (`tripMul`); land value +5% within 3 of each end; Market demand +0.01 (cap +0.08).

**Sky Lobby:** a connected group of k ≥ 3 anchors linked by active bridges (a parcel counts once; `vertical.refresh`, cached in `world.vertical.lobbies`):

| Term | Value |
|---|---|
| Car trips of every tower in it | ×0.75 (instead of ×0.8) |
| Land value on and within 2 of every tower in it | +0.02 × min(k, 4) (cap +0.08), on top of the +0.05 |
| Market demand | +0.02 × (k − 2), cap +0.06 (today's cluster term) |
| Visitors (X3) | +1,000 × (k − 2) a month, cap 6,000 per lobby and **30,000 city-wide** (the Halo Lookout and landmarks are on top). An Airport draws 12,000 for 45,000 CR; a lobby is a supplement, not a replacement. |
| Name | "{A} {B}" from two lists, by a hash of its lowest anchor key: Glass, Prism, Neon, High, Copper, Pearl, Hex, Cloud, Signal, Tide, Amber, Halo × Steps, Gallery, Walk, Arcade, Rise, Loop, Concourse, Crossing, Terrace, Promenade |
| k ≥ 5 | unlocks the Halo Lookout (§6.3) |

The **first** lobby a city forms shows the moment banner "SKY LOBBY · GLASS STEPS" / "3 towers linked: visitors and land value" (`MomentId` gains `'lobby'`); later lobbies post one news line (§1.4 matches).

**Shown numbers** (`BridgePayoff`): walkers a day = 0.2 × (residents + jobs of both anchors, a parcel counting all its members): two L3 Hab towers 600, a full Stratablock and a Spire 10,600. Cars: "−20%" (−25% in a lobby). Land: tiles that gain +5%.

**Inspect** (tap the tube: `Selection.link`, picked like EXPANSION's sky slab at the tube's height): title "Skybridge", subtitle "A walkway for people. Skyways carry cars."; rows Walkers `600/day`, Cars `−20%`, Land `+5%`, Lobby `5 towers` (when in one), Upkeep `30/mo`; notes "Part of Sky Lobby Glass Steps: +3,000 visitors a month" (good), "Dark: a tower here is no longer tall" (warn); action "Remove skybridge" (no refund after the 10 s undo). Anchors' inspect gains the row Skybridges `2/4` and the lobby note.

### 5.6 Art

- **Scale:** tube 0.32 tile wide (was 0.24) and 14 px tall (was 8), a 3 px floor slab, an end collar where it meets each facade; ≥ 7 screen px tall at zoom 0.5. Drawn at the §5.3 height.
- **Skin** (`skinOf(link)`), first that applies: a faction crown on either end; a faction exclusive building or landmark; a Spire's sponsor; the lower anchor's district style; glass.

| Skin | From | Look |
|---|---|---|
| Glass | Charter Shore, Shoals, Terraces, default | clear glass, white mullions every 0.25 tile, lit floor strip |
| Truss box | Basalt; Kessel Flats, Tarmac Reach | square orange-lit steel truss, X-bracing (`ribs`), riveted end plates |
| Pearl ribbon | Nacre | rounded pink-white tube with a soft vertical gradient, a halo glow at night, no mullions |
| Civic arcade | Board | pale stone arches under a glazed roof, warm windows, a small flag at mid-span |
| Container chain | Undertow; the Sunk | a row of rust and blue containers with cut windows, a net and a green lamp underneath |
| Cable span | Kites; Skeleton Row, Verdigris Bazaar | a light walkway on cables with a 6 px sag at mid-span (gap ≥ 4), string lights, small diamond banners |
| Lamp gallery | Tuning (only once active); Reedmere uses its timber variant | a timber-framed gallery with a row of hanging lanterns, warm light only |

- **Walkers:** by day tiny figures (2×3 px) on the floor strip, by night moving light dots; one per 150 walkers per gap tile (max 4), at zoom ≥ 0.6 only. **Dark:** dark glass, no walkers, a red lamp at each end.
- **Ghosts and lanes:** the ghost tube at bridge height (green or red), both spans for a route, the lane bands, the see-through pass and the badges in `overlay.ts` (WP-3).
- **Caching:** segment sprites keyed (skin 0..6, axis, end or middle piece, night bucket, scale bucket) in the existing `SpriteCache` with ids from `BRIDGE_BASE = 5000`; walkers drawn live. ≤ 0.4 ms for 60 visible gap tiles.
- **Depth:** unchanged (each gap tile at its sweep key after that diagonal's buildings, `drawSkybridges`); two tubes on one tile draw lower first.

### 5.7 Data, sim and story changes

- `SkyLink` keeps its shape (bridges stay axis-aligned); the skin is derived; links are saved in world coordinates (migrated +64).
- `SKYBRIDGE` gains `perTile 250`, `minGap 1`, `maxGap 10`, `maxPerParcel 3`, `maxPerBuilding 4`, `maxPerMast 6`, `tubeBelowRoof 6`, `tubeHeight 17`, `clearance 6`, `crossGap 20`, `walkerShare 0.2`, `lobby: { min: 3, tripMul: 0.75, lvPer: 0.02, lvCap: 0.08, lvRadius: 2, visitorsPer: 1000, visitorsCap: 6000, cityCap: 30000, halo: 5 }`. Existing links stay valid (every old gap 2..8 is inside 1..10, and today's rule only blocked tall tiles, which still block).
- `vertical.refresh` (WP-2) computes lobbies and writes their trip and land-value terms into the vertical layer part; `world.vertical.lobbyVisitors` is added to raw visitors by `PortSystem` (WP-1). New metrics `skylobby.count`, `skylobby.max`.
- Kites keep "Skybridges +2 per active skybridge, max +8".
- Glossary "Skybridge" (WP-7, replaces today's text, 181 chars): "A walkway for people between two tall towers that line up. Anything lower than the bridge passes under. It cuts car trips and lifts land value. Three linked towers form a Sky Lobby." Glossary "Sky Lobby" (new, §8.4).

---

## 6. Variety

### 6.1 Buildings that don't repeat

Three layers: **parcels** merge matching tiles into bigger buildings, a **modular kit** adds 44 parametric templates to today's 72 hand-built bodies, and a **district style** picks materials, roofs, windows, signs and props and adds its own silhouettes. The sim's numbers are untouched (capacity stays per tile); the parcel map and the heights are game-side modules (§3.2) so the skybridge rules and inspect read the same truth as the art. EXPANSION's wealth-tier dressing (`dressTier`) runs after every recipe as today.

#### Parcels (`src/game/parcels.ts`, rules frozen in Step 0b; WP-3 caches and sorts them; WP-4 draws them)

- **Merge rule** (a pure function of the tiles and the seed, no saved state): for each **2×2 block aligned to even world coordinates** (the start slot's offset 64 is even, so a migrated city aligns as before), if all four tiles are the same zone, developed (level ≥ 1), not abandoned, not a ruin, on the same terrace step, with no building, and `hash(artX, artY, seed) < 0.5`, it is one **2×2 parcel**. Otherwise each aligned pair along x, then along y, with the same rule at 0.5 → a **2×1** or **1×2 parcel**. Otherwise single tiles.
- **Level and tier do not take part in the merge.** A parcel draws at the **lowest** level and tier among its members, so members levelling up or changing tier never merge or unmerge it (no popping, no repaint storms); a parcel only changes when a member is developed, abandoned, bulldozed or rezoned. When the last member reaches L3, the whole lot becomes one tower ("the block redevelops together"). Capacity stays per tile, so inspect's parcel sum is exact.
- `parcelMap(world)` is rebuilt for the aligned blocks a `tiles` event touches and on `world` / `annex`. The head (front corner) draws one sprite for the whole parcel; members draw nothing; the sweep treats the parcel like a multi-tile building (sort key at its front corner). A tap on any member selects the parcel; inspect shows the parcel's sum (§4.6).
- **One anchor:** a parcel at drawn level 3 is one skybridge anchor keyed on its head, with its own limit and one count in a Sky Lobby (§5.3, §5.5).
- Parcel L3 towers are taller ("towers on bigger lots go higher"): pairs up to 1.3× and quads up to 1.6× a single L3 tower, within `heights.ts`' bounds (below).

#### The kit (`src/render/art/kit.ts`, WP-4)

`kitRecipe(spec): Recipe`, spec `{ zone, level, tier, style, form, parcel, palBit, seed }`. Forms 0..7 are today's 72 hand recipes (kept, they work; singles only); forms 8..23 are templates. `seed` is a **2-bit per-tile parameter variant** (`hash(artX, artY, seed) & 3`): each template has 4 parameter sets (height, setbacks, roof, window pattern, signage), so one template yields 4 visibly different bodies. Each template draws with the existing Painter primitives (`box`, `chamfer`, `prism`, `cyl`, `dome`, `saw`, `ribs`, `ring`, `stack`, `tank`, `antenna`, `dish`, `greens`, `laundry`, `awning`, `blade`, `board`, `ticker`, `container`…).

**Eligibility matrix** (cells are zone × level × parcel shape: S single, P pair 2×1 or 1×2, Q quad 2×2):

| Hab Blocks template | Cells | | Market Strip template | Cells | | Fab Yards template | Cells |
|---|---|---|---|---|---|---|---|
| walk-up with stair and water tank | S1 S2 | | stall row under cables | S1 P1 Q1 | | shed with roller doors | S1 P1 Q1 |
| row houses with chimneys | P1 P2 | | corner shop with blade sign | S1 S2 | | container yard | S1 P1 Q1 |
| capsule cluster | S1 S2 P2 | | arcade with awnings | P1 P2 Q1 | | sawtooth hall | S2 P2 Q1 Q2 |
| courtyard block | Q1 Q2 | | mall box with glass atrium | P2 Q2 | | tank farm | S2 P2 Q2 |
| slab with balcony bands | S2 P2 P3 | | office slab | S2 P2 P3 | | silo cluster | S2 S3 P3 |
| tenement around a laundry yard | P1 Q1 Q2 | | glass tower with a crown | S3 P3 | | stack hall with chimneys | S3 P3 Q3 |
| point tower, 0–2 setbacks | S3 Q3 | | hotel tower with a vertical sign | S3 P3 | | crane warehouse | P2 Q2 Q3 |
| stepped setback tower | S3 P3 | | podium tower with a holo billboard | P3 Q3 | | drone hangar (arched roof) | P1 P2 Q1 Q2 |
| twin towers on a podium | P3 Q3 | | night-market hall | P1 Q1 | | vat farm with gantries | S3 P3 Q3 |
| pencil tower with a crown | S3 | | department store (stepped glass) | S2 Q2 | | conveyor works (two halls, a bridge) | P3 Q3 |
| stacked terrace villas | P2 Q2 P3 | | twin offices with an atrium | Q3 | | print shop with roof vents | S1 S2 P1 |
| perimeter block, garden roof | Q1 Q2 Q3 | | split tower with a garden break | S3 Q3 | | cleanroom block ($$$ only, any cell) | all |
| tower cluster on one podium | Q3 | | food-court podium, roof screen | Q1 Q2 | | | |
| cut-corner tower | S2 S3 | | conference drum with a ring sign | P2 Q3 | | | |
| bungalow court | P1 Q1 | | kiosk cluster | S1 P1 | | | |
| shophouse homes over shutters | S1 P1 | | tech campus around a lawn | Q2 | | | |

Floors (a contract test over the matrix): every **single** cell has ≥ 6 distinct silhouettes (it has today's 8 classic forms plus 2–4 templates), every **pair and quad** cell ≥ 4 templates, each × 4 parameter variants × 2 palettes × 3 tiers. The cleanroom block is extra in every $$$ cell.

Parameters (per template, chosen by `seed`): height from `kitTop(spec)` (below); footprint inset 0.05–0.2; setbacks 0–3; roof (flat with plant, gable, sawtooth, garden, helipad, antenna crown, water tower, solar, dome, pyramid); windows (grid, band, curtain, slit, capsule, louver, balcony stack, lattice); wall material from the style; neon trim from the palette; signage (none, blade, wall sign, billboard, holo panel; billboards only on Market L2+, probability 0.4); 0–4 roof clutter props. Signs use an **invented glyph set** (40 abstract glyphs on a 3×5 stroke grid; never a real letter, script or logo); billboards are colour blocks and shapes.

**Heights** (`kitTop(spec)` in `src/game/heights.ts`, the formula the art draws the main mass at): `band(zone, level, parcel) × style multiplier × (0.8 + 0.4 × seed / 3)`, clamped to L1 [12, 36], L2 [40, 84], Fab L3 [70, 120], Hab and Market L3 single [128, 216], pair [150, 260], quad [180, 300]. The clamps keep §5.3's guarantees at every style (Tarmac's 0.8 and Skeleton's 1.1 included). Roof clutter (antennas, cranes) may rise above the mass; the skybridge rule uses the mass. Today's classic forms keep their `CLASSIC_TOPS` height in every style (a style restyles their materials, not their mass), so the measured 128–213 px of today's L3 art holds everywhere.

**Form choice:** `pickForm(hash(artX, artY, seed), cell, style)` picks **uniformly over every eligible body** of the cell (classic forms, templates and the style's own silhouettes, each with its 4 parameter variants), with two rules: the district style's exclusive silhouettes (below) make at least 25% of picks in their district; and **no identical body** (same form, seed and palette) within r = 2 (the picker re-hashes up to 4 times, deterministically). A migrated city re-picks too: that change is the variety the owner asked for, and its colour mix (palettes) stays.

#### District styles (`src/render/art/styles.ts`, WP-4; ground props in WP-3)

Materials alone read weakly at the phone's usual zoom (0.4–0.9), so each style also owns 2–3 **silhouettes** that appear only in its district, with a guaranteed share of ≥ 25% of the bodies drawn there:

| Style | Walls | Roofs | Windows | Signs | Props | Own silhouettes (cells) | Height × |
|---|---|---|---|---|---|---|---|
| shore (Charter Shore) | today's sets | today's | today's | today's | today's | — (today's look, plus the general kit) | 1 |
| shoals | white and pastel render, pale timber | flat with railings, small domes | band, curtain | sparse, pastel neon | stilts under ground floors on shore tiles, rope rails, rooftop sails | stilt houses (S1 S2 P1), boardwalk terraces (P2 Q2), ferry-pier hall (Q1 Market) | 0.9 |
| sunk | patched brick, salvaged sheet metal, waterline stain to 8 px | tarps, upturned-hull roofs on L1 | capsule, grid with boarded panes | hand-painted, green neon | mooring rings, hanging lamps (green), boats at doorways | hull-roof shacks (S1 P1), canal-front lofts with boat doors (S2 P2), causeway stair-tower (S3) | 0.85 |
| flats | corrugated steel, soot brick | sawtooth, gable | slit, grid | stencilled numbers | chimneys, pipe racks, conveyors | gantry sheds (Fab P2 Q2 Q3), coke-oven rows (Fab S1 P1), worker barracks with pipe racks (Hab P2) | 1 |
| terraces | dressed stone, plaster | terrace gardens, gable | grid, balcony stack | small, warm | stair lamps, planters on every setback | stepped hillside houses (S1 S2 P2), stair-street row (P1), cliff-face apartments (S3 P3) | 0.95 |
| reedmere | timber, green panels | green roofs, gable | grid, louver | few | boardwalks, reed planters, rain chains | long houses on piles (P1 P2), reed-thatched boathouses (S1 S2) | 0.85 |
| skeleton | raw concrete, exposed rebar on the top 12 px | flat with tarps and a crane hook | grid with dark gaps | spray tags | scaffold on 30% of L2–L3 tops | scaffold-wrapped half-towers (S3 P3), bare-top tower (S3 Q3) | 1.1 |
| tarmac | ribbed metal, painted concrete | wide flat, hangar arcs | band | big numbers | windsocks, obstruction lights | hangar homes under arched roofs (S1 S2 P2), control-tower block (S3) | 0.8 |
| bazaar | copper and verdigris, ochre plaster | copper hips and pyramids | small grid | dense, every glyph colour | awnings, lantern strings between tiles, stall crates | courtyard shophouses (S1 S2 P1 Q1), balconied market tower (S3 P3) | 0.9 |

**Service buildings by style:** the Med Clinic, Enforcer Precinct, Neon Plaza and Fusion Reactor get two more looks each, so a nine-district city doesn't repeat them: today's look in Charter Shore, Highstep and Verdigris; an "industrial" look in Kessel, Tarmac and Skeleton Row; a "waterfront" look in the Shoals, the Sunk and Reedmere (chosen by the district of the building's head tile; same numbers).

#### Ids, memory and paint budgets

- **Zone kit ids:** `KIT_BASE (1,000,000) + (((((((zone − 1)·3 + level − 1)·3 + tier)·10 + style)·24 + form)·4 + parcel)·2 + palBit)·4 + seed` (< 1,210,000). Classic forms on single tiles in the `shore` style keep EXPANSION's ids (0..431).
- **Service ids (frozen in Step 0b):** today's `SERVICE_BASE (480) + typeIndex × STACK_VARIANTS (64) + variant` would run into `SKY_BASE` 4,000 once the 27 new types are added (today's 27 + 27 = 54 types: 54 × 64 + 480 = 3,936, plus up to 63 variants), and crown, Spire, faction and style looks overflow 64 variants per type. Every service model moves to `SERVICE_KIT_BASE (2,000,000) + ((typeIndex × 16 + look) × 10 + style) × 64 + variant` (look = sponsor × 4 + look for Spires, < 16), below 2,600,000 for up to 57 types. `SKY_BASE` 4,000 and `BRIDGE_BASE` 5,000 stay. A contract test checks every id family is disjoint. Ids are cache keys, never saved, so renumbering is free.
- **Sprite keys** keep today's formula `((id × 5 + state) × 7 + nb) × 4096 × 2 + lod`, which stays below 2⁵³ while id < ≈ 3·10¹⁰ (not 10¹¹ as the draft said); every id above is far below. `zoneHeights` (`Float32Array(SERVICE_BASE)` in `buildings.ts`) becomes a `Map` for kit ids, since heights now come from `heights.ts`.
- **Below `LOD_ZOOM` (0.55)** kit bodies collapse to a small LOD set: key (zone, level, parcel, style, form mod 4, tier), 4 silhouettes per cell and style, painted on the scale buckets only (never exact-scale on settle). Buildings, crowns and landmarks keep their own LOD sprites, so the skyline view (§3.9) stays recognisable.
- **Sprite cache** 32 MB on high quality (unchanged), 20 MB on low; paint budget 3 ms a frame (unchanged).
- **Generic fallback, a `SpriteCache` rule:** today `SpriteCache.get` paints a family with no sprite yet at once, ignoring the budget (`art/sprites.ts`). Kit families get a **cross-family fallback**: a body never painted draws the classic body of the same zone, level, tier and palette (painted first and kept warm) until its turn in the budget, so panning into a new district never hitches. Target: on the reference phone, a fresh district panned into at zoom 1 shows all real bodies within 30 frames.
- **Contact sheets** (WP-4 deliverable, before Wave 3): one generated PNG per style showing every cell's bodies by day and by night at zoom 1 and 0.5, for an owner-style review.
- **Targets** (WP-4 acceptance, the megacity fixture and a scripted pan): at zoom 1 portrait, distinct bodies on screen ≤ 260 and sprite memory ≤ 26 MB at DPR 2; at zoom 0.55 and 0.4, distinct bodies, sprite MB and paint ms per frame measured on the reference phone (≤ 3 ms paint p95 while panning); sprites painted per second while panning ≤ 1.5× v3; **adjacent-identical rate** (a tile and any of its 8 neighbours drawing the same body) ≤ 3%; **no body more than 15% of its cell's tiles on screen**; no identical body within r = 2; every kit template ≤ 1.2 ms to paint at scale 1.

### 6.2 Faction architecture languages

Each faction gets a design language an artist-programmer can apply with the Painter kit: palette (day RGB; night colours via `nightOf` unless given), shapes, rules, light, a live **signature**, and named **designs** (A–D) that the families below use as their looks. **Look 0 of every family is exactly today's art** (the owner loves today's corp towers; they stay and the new designs are added beside them).

| | **Basalt** "Hex and Furnace" | **Nacre** "Pearl and Spiral" | **Board** "Civic Stone" | **Undertow** "Salvage and Tide" | **Kites** "Rig and Sail" | **Tuning** "Lamp and Hymn" |
|---|---|---|---|---|---|---|
| Palette | basalt black [52, 50, 56], rust steel [120, 80, 60], hazard yellow [230, 190, 40] | pearl [232, 226, 236], blush glass [214, 176, 206] / night [40, 26, 48], ice [180, 230, 255] | limestone [214, 214, 206], slate [96, 104, 120], verdigris [120, 180, 160] | rust [132, 84, 60], hull green [56, 92, 80], tarp blue [60, 120, 140], net grey | lilac [201, 162, 255], sailcloth [236, 236, 246], cable black | candle cream [255, 243, 196], copper [184, 115, 51], night blue |
| Light | furnace orange [255, 123, 46], sodium | soft pink halos [255, 198, 241], no hard strips | warm windows [255, 220, 160], banner blue | green-tinted lamps [182, 255, 46] | string lights [255, 214, 150], UV mural glow | warm only: every window candle-lit |
| Shapes | hex prisms (`prism`, 6 sides), chamfered buttresses, riveted trusses (`ribs`), sawtooth roofs, flame stacks | cylinders and ellipses (`cyl`, `cylGrad`), stacked offset discs, domes, rings (`neonRing`), curtain glass | symmetric stepped blocks, colonnades (thin boxes), arcades (`door` arches), domes, clock faces (`ring` + hands), nine pennants | containers, upturned hulls (half-prism keel), scaffolds, nets (`laundry`), cranes (`pipe` + hook), patched faces (mixed materials on one wall) | antenna forests, diamond sails (quads on masts), platforms, ladders, dishes, murals (`board`) | pointed lantern roofs, copper coils (`cylBands`), bell domes, lantern rows, concentric ground rings |
| Rules | no curves except chimneys; the base ≥ 30% wider than the top; 2–3 tiers | no sharp roof corners (dome, ring or taper on top); vertical gradient pearl → blush | always bilateral symmetry; podium, body, crown; arcade at street level; never advertising | always asymmetric; ≥ 3 materials; something hangs (nets, lamps) | always light add-ons over something; diagonals; never heavy masonry | no cool light, no billboards |
| **Signature** (live, in the effects pass) | furnace flicker in the slit bands; a flare from every stack at the 06:00 and 18:00 shift change | halos turn slowly (one turn a minute) | clock hands show the visual clock; flags stir | lamps swing on their chains | antenna tips blink in patterns; two kites tug on lines by day | lantern windows pulse slowly, in step across the city |
| Design A | **Hex Column**: three stacked hex prisms (radius 0.9 / 0.75 / 0.6 tile, 90 / 80 / 60 px), an orange slit band at each joint, a flame stack | **Spiral**: 12 discs each turned 15°, tapering | **Charter block**: colonnaded block with a verdigris dome and nine flags | **Hull Stack**: containers three high under an upturned boat hull | **Antenna Forest**: 8–12 masts of mixed height with blinking tips | **Lamp Chapel**: pointed roof with an open lantern |
| Design B | **Buttress Hall**: a long block with four wedge buttresses a side and two stacks | **Pearl Drop**: a slim stem with a bulb top 1.4× as wide and a ring halo | **Stepped Tower**: three setbacks, a clock face on the top tier | **Net Loft**: a scaffold tower hung with drying nets and lamps | **Sail Canopy**: four diamond sails on masts over the roof | **Coil Belfry**: a copper coil tower with a humming glow |
| Design C | **Crucible**: a tower crowned by a glowing bowl (orange glow and embers) | **Ribbon Twins**: two slim towers joined by a curved ribbon at 70% height | **Open Belfry**: a slender tower with an open lit top | **Crane Hab**: a dock crane with cabins along the jib | **Rope Roost**: stacked platforms, ladders and nets | **Choir Ring**: a ring of lit windows around a court |
| Design D (tallest uses) | **Gantry Spine**: an open lattice core with a gantry crane on top | **Halo Atrium**: a wide dome with two floating rings | — | — | — | — |

**Standing shows at night** (WP-4 art, WP-3 reads standing through `VisualState`): a faction's buildings, crowns, landmarks and sponsored Spires light brighter with banners out while it is **Allied**, as today while Friendly or Neutral, and at half window light with banners down while **Hostile**. So the skyline says who is winning.

**Where each language appears** (looks are `Building.look`, §3.2):

| Structure | Looks (0 is today's art) | Rule |
|---|---|---|
| **Corp Spire** | Nacre: 0 **Facet** (today's very tall faceted glass tower with its crown light), 1 Spiral, 2 Pearl Drop, 3 Halo Atrium · Basalt: 0 Hex Column, 1 Crucible, 2 Gantry Spine · Independent: 0 Needle, 1 Twin Blade, 2 Lattice (new, neutral glass and steel) | Placing one adds a **sponsor** step to its confirm pill (it costs ≥ 10,000). Basalt: 40% of its 8,000 jobs are Fab, build reaction Basalt +6, Nacre +2, Undertow −2, its power weight 120 counts for Basalt. Nacre: today's numbers (Nacre +6, Basalt +2, Undertow −2, weight to Nacre). Independent: Board +3, prestige r14 (instead of 16), no faction weight. **Old spires without `sponsor` read as Nacre with look 0**, so every existing Spire looks exactly as it did. |
| **Stratablock crown** | Foundry: 0 today's, 1 Crucible, 2 Hex Column · Glare: 0 today's, 1 Pearl Drop, 2 Halo Atrium (ring only) · Kite Nest: 0 today's, 1 Antenna Forest, 2 Sail Canopy · Commons: 0 today's, 1 Stepped Tower, 2 Open Belfry · **Salvage** (new): 0 Hull Stack, 1 Net Loft, 2 Crane Hab · **Lamp** (new): 0 Lamp Chapel, 1 Coil Belfry, 2 Choir Ring | Plinth and Hab Core in the district style (today's in Charter Shore). The crown picker preselects look 0. **Salvage** (Undertow, needs Undertow Friendly): +3,000 untaxed jobs, ↻ "Off-ledger" +300/mo, Undertow turf protected r2; Undertow +8, Board −4, power +80. **Lamp** (Tuning, needs the Tuning active and Friendly): approval +2, upkeep ×0.99 per crown, Tuning +8, Basalt −3. `CrownId` gains `'salvage' \| 'lamp'`. |
| **Faction buildings** | Foundry Spine (Basalt), Glarewall (Nacre), Tidemarket (Undertow), Kite Roost (Kites), Commons Hall (Board): 0 today's, 1 and 2 from the language's designs | New placements: by hash of the id; v1–v3 buildings: look 0. |
| **Arcology** | by district style: ziggurat (today's; Charter Shore and any style without its own), Hive (honeycomb hex cells, Kessel and Tarmac), Hanging Gardens (stepped green terraces, Terraces and Reedmere), Pier Arcology (on stilts at the water's edge, Shoals and the Sunk), Ring (a circle of towers around a lit court, Verdigris and Skeleton Row) | Same numbers. A migrated city's Arcology stands in Charter Shore, so it keeps the ziggurat. |
| **Faction landmarks** | — | §6.3: Charter Hall (Board), Hexworks (Basalt), Pearl Atrium (Nacre), Hullhouse (Undertow), Kite Mast (Kites), Lamp Choir (Tuning), each a hero piece in its language with its signature. |
| **Ending skylines** | — | §9.2: the ending's language spreads over the city's L3 towers after Charter Night. |
| **Skybridge skins** | — | §5.6. |
| **Turf decals** | — | unchanged (STORY.md §3.7). |

**Pickers** (WP-5): the **crown picker** is a 2-column grid of crown cards (44 px min height, crown name, its summary line); tapping a card selects it and shows a **look chip row** under it (three 44 px chips with tiny thumbnails, look 0 preselected), and the ghost on the map shows the chosen look. The **Spire** confirm pill gets a sponsor row (a 44 px segmented control: Basalt · Nacre · Independent) above ✓ / ✕, with a "‹ look ›" chip that cycles the ghost through that sponsor's looks. Both fit 360 px.

**Migration test** (Step 0b, §11.2): a v3 fixture's Spires, crowns, faction buildings, Arcology, reactors and Stratablocks resolve to the same art recipe (look 0, today's recipe) after loading in v4, so the owner's favourite towers do not change on load. Only zone bodies re-pick (§6.1).

### 6.3 Landmarks and new civic buildings

All new types go into `BUILDING_ORDER` **before `'stack'`** (the story types stay `slice(-7)`), with `meta` lines ≤ 22 chars, `plural` where needed and art in WP-4. Landmarks have `maxCount: 1`. New gate fields (`BuildingGate`, additive): `district?: DistrictKind` (owned, footprint inside it), `lobby?: number` (a Sky Lobby of at least n towers), `districts?: number` (owned count), `chapter?: number` (chapters completed), `ending?: EndingId` (the current ending, §9.2). The gate rule of STORY.md §4.5 gains them as further **AND** terms; `lockedReason` names the first missing part ("Needs the Shoals", "Needs a Sky Lobby of 5 towers").

**Landmarks (one each):**

| id | Name | Size | Cost | Upkeep | Power | Unlock | Effect | Jobs (×10) | Core? |
|---|---|---|---|---|---|---|---|---|---|
| `charterhall` | Charter Hall | 3×3 | 30,000 | 300 | uses 20 | Board Friendly and Ch3 done (fallback 300,000 residents) | park r10; approval +3 while it stands; Board power +100 | 800 | core |
| `hexworks` | Hexworks | 4×4 | 60,000 | 600 | supplies 2,500 MW | Basalt Allied, or patron Basalt and 300,000 residents | pollution 0.35; Basalt power +120; tall | 20,000 Fab (megastructure, §4.2) | core |
| `pearlatrium` | Pearl Atrium | 3×3 | 55,000 | 500 | uses 60 | Nacre Allied, or patron Nacre and 300,000 residents | prestige r18; visitors +20,000/mo; Nacre power +120; tall | 18,000 (megastructure, §4.2) | core |
| `kitemast` | Kite Mast | 2×2 | 12,000 | 0 | uses 10 | Kites Allied | net r22; Trace −1 a month; tall, takes 6 skybridges; Kites power +100 | 0 | core |
| `beacon` | Harbour Beacon | 1×1 | 8,000 | 40 | uses 4 | the Shoals owned and 120,000 residents; a Shoals shore tile | prestige r10; visitors +5,000/mo; a sweeping beam at night | 50 | core |
| `arena` | Arc Arena | 4×4 | 80,000 | 700 | uses 80 | 300,000 residents | visitors +25,000/mo; hosts Arena Night (§6.4); noise 0.5 r6 only during an event | 1,500 | core |
| `halolookout` | Halo Lookout | 2×2 | 40,000 | 300 | uses 30 | a Sky Lobby of ≥ 5 towers | tall, takes 4 skybridges; works only while bridged into a Sky Lobby: visitors +15,000/mo, land value +0.06 r10 | 400 | core |
| `hullhouse` | Hullhouse | 3×3 | 15,000 | 0 | uses 8 | Undertow Allied; inside the Sunk | ↻ "Off-ledger" +600/mo; crime +0.05 r6; protects Undertow turf r5; Undertow power +100 | 2,500 (untaxed) | optional |
| `lampchoir` | Lamp Choir | 2×2 | 9,000 | 60 | uses 6 | the Tuning active and Friendly | approval +2 while it stands; upkeep ×0.98 city-wide | 100 | optional |
| `terminal` | Grand Terminal | 4×4 | 70,000 | 500 | uses 50 | 3 districts owned and a live ribbon with ≥ 4 stations | the hub: every Maglev and Metro Station's transit radius ×1.5 city-wide; counts as two ribbon stations; transit r16 | 1,200 | optional |

**Civic and utility (repeatable):**

| id | Name | Size | Cost | Upkeep | Power | Unlock | Effect | Jobs (×10) | Core? |
|---|---|---|---|---|---|---|---|---|---|
| `floodwatch` | Floodwatch Station | 2×2 | 1,800 | 90 | uses 6 | 15,000 residents, or the Shoals, the Sunk or Reedmere owned | `resilience` r12: cancels king tides and the floodplain cap; incident outages in range last half as long | 150 | core |
| `pumphouse` | Pump House | 1×1 | 900 | 20 | uses 4 | a shore tile in the Sunk, the Shoals or Reedmere, not within r6 of the Sunk's old pump hall | reclaims owned water within r2 over 90 d, one ring per 30 d (never berths, bridges, rail, locked tiles, or water more than 3 tiles from land), then becomes a pump garden (park r3); 16 per district at most | 30 | core |
| `canopypark` | Canopy Park | 3×3 | 1,200 | 30 | uses 2 | 15,000 residents | park r12 | 20 | core |
| `medtower` | Med Tower | 3×3 | 9,000 | 380 | uses 30 | 120,000 residents | health r20; tall | 1,200 | core |
| `reclaim` | Reclaim Works | 2×2 | 3,000 | 140 | uses 12 | 50,000 residents, or Kessel Flats owned | `filter` r10; brownfield clears twice as fast | 400 Fab | core |
| `metro` | Metro Station | 1×1 | 4,000 | 160 | uses 10 | 120,000 residents and 2 districts | **links districts**: transit r9; with powered stations in ≥ 2 districts, every station gets transit r12 and trips ×0.9 within r4; the City map draws the lines between districts with a station. (The Maglev Station stays the local transit stop.) | 60 | core |
| `markethall` | Market Hall | 2×2 | 1,500 | 60 | uses 6 | 15,000 residents | visitors +1,500/mo; Market demand +0.01 each (cap +0.05); approval +0.5 each (cap +2) | 120 | optional |
| `tidal` | Tidal Turbine | 2×2 on water | 6,000 | 120 | supplies 600 MW | the Shoals, the Sunk or Reedmere owned | clean power; 4 water tiles (not berths), 2 sides on water (`site: 'water'`) | 40 | optional |
| `geothermal` | Geothermal Bore | 2×2 | 9,000 | 180 | supplies 900 MW | Highstep Terraces owned; flat at step ≥ 1 | clean power | 60 | optional |
| `datavault` | Data Vault | 3×3 | 12,000 | 300 | uses 120 | 300,000 residents | net r18 | 600 | optional |

Unlocks sit on the milestone populations (15,000 Boomtown, 50,000 Neon Metro, 120,000 Megacity, 300,000 Thousand Lamps), so the milestone banner announces them, as in EXPANSION. `frame` (Skeleton Row) and `pumphall` (the Sunk) are placed by annex content and never in a tray; the five ending landmarks are in §9.2. Build reactions and power terms: §8.4. Descriptions (≤ 90 chars) and `meta` lines are in Appendix A.

### 6.4 Life and atmosphere

All of it lives in `Effects` and its art modules (WP-6), reads the world, and changes no rule except the small, labelled City life terms. Low quality turns crowds, boats and fog patches off.

| Item | What | Budget | Core? |
|---|---|---|---|
| **Crowds** (`art/crowds.ts`) | 2×3 px figures (head dot and body, six colours) on the sidewalks of visible road tiles beside developed Market and Hab tiles; density by local Market level and time of day (evening peak); groups gather at plazas, Market Halls, stations and the Arena; umbrellas (a 3 px arc) in rain; walkers move along tile edges at 0.3 tiles/s and turn at corners | ≤ 300 figures, zoom ≥ 0.8, ≤ 0.6 ms | core |
| **Weather** (`art/weather.ts`) | `Settings.weather: 'full' \| 'light' \| 'off'` replaces the `rain` toggle (`rain: true` reads `'full'`, `false` reads `'off'`; `rain` is still written for old builds). Today's rain and storms stay; new: **fog** (two pre-rendered fog band canvases 512×256 drifting in screen space, alpha 0.25 Full / 0.12 Light, on fog mornings §1.4 and in storms, plus ≤ 40 ground fog patches over water and reed tiles at zoom ≥ 0.5), **neon reflections** (during rain at night, 1–2 tinted streak sprites on road tiles beside lit Market tiles L2+, ≤ 120 a frame, zoom ≥ 0.6), **haze** (a warm grey screen grade proportional to `avgPollution`, alpha ≤ 0.15). District bias: Reedmere and the Sunk fog `0.6`, Kessel haze ×1.5, the Shoals' rain angle steeper | ≤ 0.5 ms total | fog + reflections core; haze optional |
| **Vehicles** (`art/traffic.ts`) | new kinds on the EXPANSION car system: **buses** on avenues (12% of avenue spawns; a long lit body), **delivery vans** (everywhere), **cargo trucks** to the Seaport and Fab tiles (and the 35% on highways), **taxis** near the Airport, stations and $$+ Market tiles, **police cruisers** near precincts (blue and red at night) | the existing car cap and budget | core |
| **Boats** (`art/boats.ts`) | water taxis and barges on canals and channels (the Sunk, Reedmere, Shoals, harbour), routed over a cached water-tile graph per owned slot; ferries between Shoals islands without bridges; a wake trail | ≤ 24 visible, ≤ 0.2 ms | core |
| **Drones** (`art/skytraffic.ts`) | delivery drones (tiny blinking dots) over Market areas | the existing sky budget | optional |
| **District character** | ground props per style (§3.9), building styles (§6.1), weather bias above; *optional* district ambience loops (gulls, machinery, market chatter) in `audio.ts` | — | core (ambience optional) |
| **City life** | §6.4.1 | ≤ 0.4 ms while one runs | core (4), optional (2) |

#### 6.4.1 City life (`src/game/cityEvents.ts`, Game-side, WP-6)

On screen these are **City life** (Settings → City life: On / Off, default On), not "city events": today's Settings toggle labelled "City events" (`menu.ts`: grid hacks, crew surges, investments) keeps its job and does not mute them, and City life does not mute incidents.

Real-time and never interrupting: `CITY_LIFE = { firstAfterSec: 600, gapSec: [420, 900], maxActive: 1 }` in unpaused real seconds (`Game.update` drives it with the frame's `dt`, frozen while paused). Each happening posts **one ticker line** at its start (news `info`), never a toast, card or banner. Its **visuals** last a fixed real time (90–150 s); its **gameplay** is expressed per sim day and capped per happening, so speed 3 does not multiply it: each term applies for at most `capDays` sim days of the visual window (`capDays` = 60 d, i.e. 30 s at speed 1 and under 4 s at speed 3), then the visuals continue alone. The terms go through one optional World field the sim reads (not saved: a happening in progress simply ends on reload): `world.cityEvent: { id, until (unpaused seconds left), daysLeft, visitors, approval, demandCom, slot? } | null` (Step 0b adds the field and the read sites: `census.approval` adds `approval`, `PortSystem` raw visitors add `visitors` (a monthly rate), `demandTarget` adds `demandCom`, each only while `daysLeft > 0`).

| id | When (checked at each gap) | Lasts (visuals) | Visual | Gameplay (while `daysLeft > 0`, ≤ 60 sim days) | Core? |
|---|---|---|---|---|---|
| `nightmarket` | a district with ≥ 40 developed Market tiles (the Bazaar first); night | 120 s | paper lanterns over that district's streets and alleys, crowds ×2 near Market tiles, stalls on sidewalks | Market demand +0.03, visitors +3,000/mo | core |
| `lanterns` | the next sim month 10 after the gap opens, ≥ 50,000 residents, once a sim year | 150 s | sky lanterns (≤ 60 glow sprites) rising from parks and plazas | approval +1 | core |
| `stormwatch` | the weather turns Storm | 90 s | flood barriers rise on owned shores of the Shoals (and of the Sunk, which can only be owned after the reveal), Floodwatch beacons spin, signs flicker | none | core |
| `arenanight` | the Arena exists; every third gap | 120 s | searchlights over the Arena, crowds streaming from stations | visitors +8,000/mo; noise 0.5 r6 around it | core |
| `kiteday` | Kites Friendly, by day | 120 s | kites over Kites turf | none | optional |
| `parade` | approval ≥ 70 | 90 s | confetti and floats along the longest avenue | approval +1 | optional |

Ticker lines (Appendix B) name the place with `{district}` (a neighbourhood in the happening's slot) and, in a multi-district city, the district's short name ("Paper Lane, Verdigris"). A happening never runs while the sim is paused (an open story card pauses it). EXPANSION's launches are not City life and keep their own clock. WP-7 checks `stormwatch` against STORY.md's foreshadowing intent for the start shore (barriers on Charter Shore appear only after `ch4.logs`).

---
## 7. Phone UI

### 7.1 Toolbar: still 9 buttons; trays get section chips

| Button (short) | Change |
|---|---|
| Info, Demo, Road, Zone | unchanged (the industrial zone reads "Fab Yards") |
| **Infra** | adds Tidal Turbine and Geothermal Bore (optional types); chips **Power · Ports** |
| **Civic** | chips **Safety** (Precinct, Floodwatch, Clinic, Med Tower) · **Parks** (Plaza, Canopy Park, Market Hall, Memorial) · **Learning** (Academy, Data Hub, Data Vault) · **Transit & works** (Maglev, Metro, Reclaim Works, Pump House) |
| **Sky** | chips **Towers** (Stratablock, Spire, Arcology) · **Links** (Skybridge, Ribbon Rail, Skyway) · **Landmarks** (Harbour Beacon, Arc Arena, Halo Lookout, Grand Terminal) |
| **Deals** | chips **Buildings** (Commons Hall, Foundry Spine, Glarewall, Tidemarket, Kite Roost) · **Landmarks** (Charter Hall, Hexworks, Pearl Atrium, Hullhouse, Kite Mast, Lamp Choir) · **Legacy** (after an ending only: the current ending's landmark, §9.2) |
| **Data** | first card **City map** (opens §7.2); then the views as EXPANSION §7.3 |

- **Section chips:** 44 px tall pills in a row at the top of the tray, at most 4 per tray, at most 6 cards per chip (so a 390 px tray shows 3½ cards and the scroll fade of EXPANSION §7.2 still hints the rest). The last chip per category is remembered for the session (memory only). EXPANSION's "new" dot also shows on the chip that holds the new card. Landscape compact tray (`max-height: 520px`): the chips are the first items of the single row (44×44 icon and short label).
- **Rumoured cards:** a locked landmark or district-bound type stays hidden until the player is one step away (its faction at Friendly for an Allied gate; 50% of its population unlock; its district owned or a candidate), then shows greyed with its condition ("Needs Basalt Allied", "Needs the Shoals"). Trays never fill with cards the player can't reach.
- **Meta lines** (≤ 22 chars, Appendix A), one job each for the three links: Skybridge "Walkway · tap 2 towers", Ribbon Rail "Trains · drag", Skyway "Cars · drag".

### 7.2 City map and annexing

**Entry points:** (1) the **map button** in the HUD's top-right cluster (44×44, a map icon with a gold dot and count while a grant waits; label "City map" on wide screens; not shown below 375 px wide, §7.3); (2) Data → City map; (3) pinching out past the minimum zoom in a multi-district city snaps to the City map (§3.9); (4) an **Annex pin** on the boundary; (5) the **Map** action on a "Not annexed yet" toast; (6) the goal chip's ✦ token. The sim keeps running (it is a panel like the budget, not an interruption).

**Portrait (390×844, 360×640):**

```
┌───────────────────────────────┐
│ City map             ✦ 2    ? ✕│  44 px header
│          ◇                    │
│       ◇  ◆  ◇      atlas      │  ≈ 50% height: the 3×3 slots as one diamond fitted to the width
│          ◆  ◆                 │  (slot diamonds 120×60 px at 390, 110×55 at 360)
│             ◇                 │  ◆ owned (impostor, name, residents, goal stamps)  ◇ candidate (fog preview, icon, lobby sigils, pulsing +)
├───────────────────────────────┤
│ Kessel Flats                  │  bottom sheet, drag to 85%; this part scrolls
│ [night vignette: 3 buildings] │  72 px style vignette (styleVignette, §3.9)
│ Slag, rail yards and a long…  │  tagline
│ Land 89% · Water 11% · 1 dock │  terrain line (islands, ruins, frames, steps, channels by kind)
│ + Fab zoning half price       │  perks (green, ≤ 3)
│ ! Brownfield smog until …     │  hazards (amber, ≤ 2)
│ (hex) Sallow: "The Flats pay… │  lobbyists: sigil + quote, 2 lines at most, "more" expands
│ Annexing: Basalt ++ · Nacre − │  summary in the choice-summary style
│ 3 regional links here become… │  only when it applies
├───────────────────────────────┤  sticky footer (never scrolls away)
│ Uses 1 land grant (1 left)    │  price line
│ [   Annex Kessel Flats    ]   │  52 px primary, in the bottom 40% (one thumb)
└───────────────────────────────┘
```

**Landscape (844×390):** atlas on the left 55%, sheet on the right 45% (scrolls above the same sticky footer).

- **Slot states:** owned (impostor, short name, residents in `abbr`; the sheet shows its census, perks, its **district goals** with ticks and rewards, and "Go there"); candidate (as above); not adjacent (dimmer, a lock, "Not next to the city yet"); not open yet (the Sunk before `ch4.brine`: "Still flooded: opens later", no reason); buyable after the ending (price instead of a grant). With all 9 owned, a line under the atlas: "The city reaches the edge of the region."
- **Price line:** "Uses 1 land grant (1 left)"; "2,500,000 CR · or wait for the next grant" (after the ending, no grant left); "Next land grant: finish Chapter III" (story, no grant); "Not next to the city yet".
- **Lease (Tarmac Reach only):** two 44 px segmented buttons, "Nacre: terminal" and "Basalt: cargo", each with its summary line ("Nacre ++ · Basalt −"); **Annex** stays disabled until one is picked.
- **Confirm:** tapping Annex turns the button into "Annex Kessel Flats? ✓ ✕" (each ≥ 44×44); Enter = ✓ on desktop. ✓ calls `game.annex(slot, lease)`, closes the sheet, flies the camera in (1.2 s, a tap skips) and lifts the fog (1.5 s); the banner follows (`MilestoneBanner`).
- **Metro lines:** owned districts that each have a powered Metro Station are joined by a thin line on the atlas (§6.3).
- **"?"** in the header: "Every chapter you finish brings a land grant. Spend it here to annex a district next to your city. Each district has its own land, perks, problems and goals, and some factions lobby for one or another. After Charter Night grants keep coming, and you can buy districts with credits."

### 7.3 HUD and goal chip

- The map button (above). At 360–374 px wide it is left out and the goal chip's ✦ token plus Data → City map are the entry points; from 375 px up it sits in the top-right cluster. No other HUD element is added.
- The goal chip (story rail) shows a gold "✦ 1" token while a grant waits; tapping the token opens the City map. The amber "message waiting" state keeps priority over it.

### 7.4 Skybridge tool

As §5.4. Input (WP-5): the first tap hit-tests tall anchors against their whole sprite silhouette (the nearest within 24 px wins); taps on badges are hit-tested in screen space (green badge 44 px round, anchored above the tower's roof; a red dot's hit area is 44 px even though it draws at 16 px); the tube is pickable at its height (a slab like EXPANSION's sky slab, `PickFootprint.base`) and selects `{ x, y, link }`. While a source is selected, the pill shows the source's state ("TAP A PARTNER · 3 in reach") and the **Show routes** chip; during a route confirm, ✓ / ✕ as EXPANSION §7.7. The camera's ease to fit A's reach is skipped if the player is pinching.

### 7.5 Inspect additions

Values stay ≤ 12 characters; longer text goes in note rows (EXPANSION §7.4).

| Tile | Additions |
|---|---|
| Zone tile | subtitle "{form} · {n} floors"; Homes (Hab) or Jobs (Market, Fab); District `Kessel Flats` (the 12-char short name); notes: parcel sum; "Floodplain: level 2 at most without a Floodwatch" (warn); "Brownfield: smog until the soil clears" (warn); "Reedbed: a free park while unbuilt" (good); "Terrace 2: views +7%" (good) |
| Ruin | title "Ruin"; note "Comes back as homes with a road and power" (good); in the Sunk "Restoring it pays 40 CR" |
| Locked tile | the district preview (name, tagline, perks, hazards, lobbyists); action "Open City map" (`InspectAction 'map'`) |
| Skybridge tube | §5.5; action "Remove skybridge" (`'bridgeRemove'`) |
| Tall tower | Skybridges `2/4`; lobby note |
| Corp Spire | Sponsor `Basalt`; Look `Hex Column` |
| Stratablock | Look `Crucible` (crown stage) |
| Frame | title "Unfinished frame", subtitle "Finish it as a Stratablock with its Plinth done."; action "Finish frame · 7,200 CR" (`'frame'`) |
| Old pump hall | title per §9.3; note by the ch4.brine choice; no actions |
| Pump House | Reclaim `2/3 rings`, then "Pump garden" |
| Floodwatch | note "Stops king tides and the floodplain limit nearby" |
| Halo Lookout | note "Works only while bridged into a Sky Lobby" (warn when it isn't) |
| Ending landmark | note "Built under Ironwork" and, after a Charter Review changed the ending, "Dormant: its ending is not current" (§9.2) |
| Any tile with a mark | the mark's plaque line (§9.3), e.g. "Truce Row: the crews signed here" |

### 7.6 Settings

- **Weather:** Full / Light / Off (a 3-way segmented control, replacing the Rain toggle; §6.4).
- **Crowds:** On / Off (default On on high quality, Off on low).
- **City life:** On / Off (default On; §6.4.1). The existing "City events" toggle (incidents) is unchanged and listed next to it with its description, so the two are not confused.
- All are additive `Settings` fields with the usual "unknown reads as default" rule.

### 7.7 Making it explain itself

1. **First-use tips** (EXPANSION §7.6 rules: one at a time, never over a tray, drag, story card or message banner; seen ids per device): `grant` (first land grant arrives), `citymap` (first open), `annexed` (after the first annex), `skybridge` (tool selected), `skylobby` (first lobby), `frame` (first Skeleton Row annex), `pumphouse` (tool selected), `sponsor` (first Spire ghost), `legacy` (first time the Legacy chip appears); sim hints `floodplain`, `brownfield` and `ruins`. Copy in Appendix A.
2. **The City map's "?"** (above) and the annex sheet's summary lines.
3. **Rules drawn while the skybridge tool is active** (ghost tubes, see-through buildings, badges, reasons).
4. **Inspect notes** for every district perk and hazard, and the plaques of §9.3.
5. **Help** (menu.ts) gains two steps after EXPANSION's: "10 · Grow beyond the shore" ("Each chapter brings a land grant. Open the City map, pick a district next to your city and annex it.") and "11 · Bridge the towers" ("Pick Skybridge and tap a tall tower: its lanes light up. Tap a glowing partner to link them. Three linked towers make a Sky Lobby.").
6. **Unlock news and the milestone banner** name the tray and chip ("Now available: Canopy Park (Civic · Parks)").

### 7.8 Acceptance (WP-5)

Every target ≥ 44 px at 390×844, 360×640 and 844×390; the toolbar still has 9 buttons; no chip holds more than 6 cards; the City map's price line and Annex button stay visible (sticky) with every sheet section expanded at 360×640, and the button sits in the bottom 40% in portrait; the HUD fits at 360 px and at 390 px with funds "12.3M" and population "4.41M" (map button absent below 375 px); no inspect value overflows at 360 px (visual harness, as EXPANSION §7.4); the annex confirm can't fire from a single tap; with a source selected in a dense downtown at zoom 0.6 on 390 px, at most 8 badges show and none overlap; tips never stack.

---

## 8. Story hooks

### 8.1 Who cares about what

| Feature | Board | Basalt | Nacre | Undertow | Kites | Tuning |
|---|---|---|---|---|---|---|
| Districts | lobbies Reedmere (and Terraces while the Tuning is hidden); mood "Green lung"; card `ds.reedmere`, `ds.tarmac` | lobbies Kessel Flats and the Tarmac lease; mood "The Flats"; card `ds.flats` | lobbies the Shoals and the Tarmac lease; card `ds.shoals` | lobbies the Sunk and the Bazaar; seeds in the Sunk; cards `ds.sunk`, `ds.bazaar` | lobbies Skeleton Row and the Bazaar; seeds on the frames; cards `ds.skeleton`, `ds.bazaar` | lobbies Terraces once active; mood "Lamps on the hill"; card `ds.terraces` |
| Spire sponsor | +3 for Independent | +6, power +120 when Basalt sponsors | +6, power +120 when Nacre sponsors (old spires) | −2 | | |
| Crowns | Commons | Foundry | Glare | **Salvage** (new) | Kite Nest | **Lamp** (new) |
| Landmarks | Charter Hall | Hexworks | Pearl Atrium, Arena (`lm.arena`) | Hullhouse, the Beacon (`lm.beacon`) | Kite Mast, Halo Lookout (`lm.halo`) | Lamp Choir |
| Sky Lobbies | | | | | Skybridges mood (unchanged) | |
| After the ending (§9) | Record Tower (Open Ledger); the answering balcony | Foreman's Gantry (Ironwork); skyline takeover | The Glass Smile (Pearlescence); skyline takeover | Bread Pier (Low Crown); the old pump hall's fate | Bread Pier; lark's kite | the Lamp Square (Lamplight); lantern roofs |

### 8.2 Land grants and lobbying

- `grant n` (new effect, Step 0b): adds n land grants, emits `grant`, shows "+1 land grant" in the choice summary (hint `grant`). Every chapter reward (Ch1–Ch5, `chapters.ts`) gains `grant 1`; the director applies `grant 1` when an ending is chosen; Game adds the epilogue grants (§3.8). The reward sys lines are not changed (lint length).
- **Lobby lines** live in `DISTRICTS[kind].quote` (Step 0b, verbatim, ≤ 110 chars, linted by WP-7):

| District | Speaker | Line |
|---|---|---|
| Shoals | Oduya | Islands, partner! Every window a sea view! I can sell them before you pour the bridges! |
| The Sunk (opens after `ch4.brine`, so always after the reveal) | Brine | You know what lies under these streets now, little light. Build on them gently. My people still live here. |
| Kessel Flats | Sallow | The Flats pay for themselves, Operations. Flat land, a dock, nobody next door to complain. |
| Terraces (Tuning active) | Ohm | On the hill the lamps can see each other, Hum. Let the city climb. |
| Terraces (before) | Marrow | Resolved: homes with a view. Proposed: for once, for everyone. |
| Reedmere | Marrow | Minutes: the marsh filters more smog than four plazas. The Board would like to keep it. |
| Skeleton Row | lark | the frames are the best climbing in the city, moth. finish them. we'll mind the roofs. |
| Tarmac Reach | Oduya | A runway that's already there, partner! Imagine the terminal! |
| Tarmac Reach | Sallow | Cargo, Operations. Cargo pays by the tonne. Terminals pay by the smile. |
| Verdigris Bazaar | Brine | The night stalls run on tides, little light. I know their tides. |
| Verdigris Bazaar | lark | verdigris is the best market in town. we sell signal there. let us keep selling. |

- **Annex reactions** (`director.onAnnex(kind, lease)`, Step 0b; ordinary favor changes through the standing rules): each lobbyist of the annexed district +6 (`ANNEX.lobbyFavor`); each lobbyist of the **other current candidates** −2 (`rivalLobbyFavor`, once per faction; a faction that lobbied for the annexed one too gets only the +6); Tarmac lease: chosen +8, the other −4. The hidden Tuning is never a lobbyist (or named) before `tuningActive`; Marrow speaks for Terraces until then. No card opens on annex.

### 8.3 Deck cards (new file `src/game/story/content/cards/megacity.ts`, WP-7)

Eleven cards, spread into `DECK` and `CARD_LIST` but not `FACTION_DECKS` (as EXPANSION §8.3): `DECK` and `CARDS` totals +11. Every card has `kind: 'faction'` (`ds.bazaar` is a two-faction card like `x.corner`), a `when`, `weight: 10`, `cooldown: 720`, **`once`**, exactly one default (‡), no ⚑, no beat, no queue, and a `brief`. Copy was length-checked against the lint limits (title ≤ 28, body ≤ 280, brief ≤ 220, labels ≤ 40 ending in a period), the banned list, the `!` rule and the spoiler guard (§8.6) with `/tmp/claude-megacity/copy/check.mjs` (the revised `ds.sunk` and `ds.bazaar`, and all of §9's copy, with `/tmp/claude-megacity/rev/check3.mjs`); WP-7's lint run is final. Every choice that promises a physical change makes it (an effect of §8.4). District names are written literally (no spot rule needed).

##### `ds.shoals` · Nacre · GLASS ON THE WATER
when `district.shoals >= 1`
> Oduya: 'Partner! The Shoals are the prettiest water in the city! A ferry with a glass bar, light shows on every island, and our logo on the tide tables. A tiny logo. Everyone reads tide tables!'

Brief: "Nacre wants to brand the Shoals with a luxury ferry and island light shows. It pays and lifts land value but annoys the Board. Refuse, or make Nacre fund public ferries as well."
- **Put the logo on the tides.** → Nacre +8, Board −3, CR +4,000, `[landValueAdd +0.01, 360d]`
- **Keep the water plain.** ‡ → Nacre −4, Board +2
- **Public ferries too.** → Nacre +3, Board +3, CR +2,000

##### `ds.sunk` · Undertow · WHAT THE TIDE KEPT
when `district.sunk >= 1 & turf.undertow >= 10` (the Sunk only opens after `ch4.brine`, so this card always comes after the reveal and is written for it)
> Brine, on a roof above a flooded street: 'You know what lies under these streets now, little light. My people still live in them. Your surveyors paint numbers on our doors. Tell me what the numbers mean, and say it kindly.'

Brief: "Old Brine's people live in the Sunk's ruins. Clearing them for builders pays but angers the Undertow and the Tuning. Giving them title turns the ruins into homes. Renting them the ruins pays quietly but raises Trace."
- **Clear the ruins.** → Undertow −15, Tuning −6, Board +2, CR +2,500, `[approvalAdd −1, 360d]`, `ruins clear`
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
- **Drain the south bank.** → Board −4, Basalt +3, `[demandRes +0.05, 360d]`, `reeds drain` (the reed ground on the half of owned Reedmere nearer the start slot turns Plain)
- **Sell the drainage rights.** → CR +5,000, Board −6, Nacre +2

##### `ds.skeleton` · Kites · THE FRAMES
when `district.skeleton >= 1 & turf.kites >= 10`
> lark: 'the frames in skeleton row are the best climbing in the city, moth. we live up there now. finish them if you want. just leave us the top floors. we keep the wasps off your cranes.'

Brief: "The Glass Kites live in Skeleton Row's unfinished towers. Let them keep the top floors (Kites pleased, Nacre not), clear them out for your building crews, or charge them rent."
- **Leave them the top floors.** ‡ → Kites +10, Nacre −4
- **Clear the frames.** → Kites −8, Board +2, `turf kites −60 slot:skeleton` (the Kites' string lights go dark on the frames)
- **Charge them rent.** → Kites +2, Trace +1, `↻ +150/mo ×24mo "Frame rent"`

##### `ds.tarmac` · Board · FAMILIES ON THE APRON
when `district.tarmac >= 1`
> Marrow: 'Resolved: the old airfield is open again. Noted: the families who moved onto the apron in the dark years would like to know if they are part of the plan. The Board would also like to know.'

Brief: "Families live on the old Tarmac Reach apron. Rehouse them properly (costs money, Board pleased), let them stay as an affordable quarter, or clear them out for the leaseholder."
- **Rehouse them: 6,000.** → CR −6,000, Board +8, `[approvalAdd +1, perm]`, `apron rehouse` (the 24 apron Hab tiles step to level 2 and tier $$)
- **Let them stay.** ‡ → Board +2, `[demandRes +0.02, 360d]`
- **Clear the apron.** → Board −6, Basalt +3, Nacre +3, `apron clear` (the cluster is bulldozed and its zoning removed)

##### `ds.bazaar` · Undertow + Kites · WHO RUNS THE STALLS
when `district.bazaar >= 1 & turf.undertow >= 10 & turf.kites >= 10`
> Brine and lark, on one call for once. Brine: 'Verdigris ran its night stalls before the Seam had a name, little light. Now they want one set of rules.' lark: 'ours.' Brine: 'Ours.' Then both of them wait, very politely, for you to pick a word.

Brief: "Both gangs want to run the Verdigris Bazaar's night stalls. Pick one (the other gang is angry), split the stalls down the middle, or send in the Board's inspectors (both gangs dislike that)."
- **Give it to the Undertow.** → Undertow +10, Kites −8
- **Give it to the Kites.** → Kites +10, Undertow −8
- **Split it down the middle.** ‡ → Undertow +3, Kites +3, Board −2
- **Send in the inspectors.** → Undertow −6, Kites −6, Board +6

(Retitled from the draft's "TWO TIDES, ONE MARKET" so it no longer echoes `x.corner`'s "FIRST JOINT MARKET"; the body places the Bazaar's stalls before the Seam's corner market, so the two stories don't overlap.)

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

- **Effects** (STORY.md §10.3 closed vocabulary, additive): `grant n` (Step 0b); `brownfield clear` (clears every brownfield tile in owned Kessel Flats), `ruins clear` (turns the Sunk's remaining ruins into empty zoned lots), `reeds drain` (reed ground → Plain on the half of owned Reedmere nearer the start slot), `apron rehouse` and `apron clear` (the Tarmac apron cluster, §3.7), all WP-7 in `story/effects.ts`, calling `clearBrownfield` / `clearRuins` / `drainReeds` / `apron` from `districts/effects.ts` (WP-2). The turf effect gains the target `slot:<kind>` (`Target` union, Step 0b): every tile of that gang inside the owned slot of that kind. An effect whose district isn't owned is skipped (STORY.md §0).
- **Metrics** (closed `Metric` union, `PLAIN_METRICS`, `STAT_METRICS`, Step 0b): `districts` (owned count), `grants`, `district.shoals | sunk | flats | terraces | reedmere | skeleton | tarmac | bazaar` (0/1), `ruins`, `skylobby.count`, `skylobby.max`. `count.<type>` works for the new types automatically. §9.4's cards also read `chapter` and flags, which exist.
- **Mood drivers** (`content/factions.ts`, WP-7; every faction stays within the lint's 4–6): Board "Green lung" `m: 'district.reedmere', mul: 3, min: 0, max: 3`; Basalt "The Flats" `district.flats ×3`; Tuning "Lamps on the hill" `district.terraces ×3`. Nacre, Undertow and Kites already have 6.
- **Build reactions** (`FACTION_BUILD_REACTIONS`, Step 0b; landmarks limit 1, others the default 5): floodwatch Board +1; pumphouse Undertow +1, Tuning +1; canopypark Board +1, Tuning +1; medtower Board +2, Tuning +2; reclaim Board +1, Basalt −1; metro Board +2, Undertow −1; markethall Undertow +1, Kites +1; tidal Tuning +1, Basalt −1; geothermal Basalt +1; datavault Nacre +3, Kites +1; charterhall Board +8, Nacre −2; hexworks Basalt +10, Tuning −3; pearlatrium Nacre +10, Kites −3; hullhouse Undertow +10, Board −4; kitemast Kites +10, Nacre −4; lampchoir Tuning +10, Basalt −2; beacon Board +2, Undertow −1; arena Nacre +3, Board +2; halolookout Nacre +4, Kites +2; terminal Board +4; the ending landmarks as §9.2. The Spire's reaction follows its sponsor (§6.2).
- **Power terms** (both `POWER_TERMS` in content, WP-7, and the live sums in `story/factions.ts`, WP-2): Board +100 per Charter Hall; Basalt +120 per Hexworks, +120 per Basalt-sponsored Spire; Nacre `perSpire` 120 now counts Nacre-sponsored and unsponsored old spires, +120 per Pearl Atrium; Undertow +100 per Hullhouse, +80 per Salvage crown; Kites +100 per Kite Mast; Basalt +150 per Foreman's Gantry and Nacre +150 per Glass Smile while their ending is current (§9.2). A test pins the Balance of Power of the S1 fixture as unchanged.
- **Turf affinity** (`TURF.affinity`, Step 0b keys, WP-1 terms): both gangs `bazaar: 0.1` inside the Bazaar; Kites `frameNear: 0.2, frameRadius: 2`; Undertow `sunk: 0.1` inside the Sunk. Cap 8% of **owned** land.
- **Glossary:** the lint cap rises from 20 to **22** entries (`content-lint.test.ts`), adding "Districts and grants" ("A District is one 64×64 part of the region. Each chapter brings a land grant: spend it on the City map to annex a district next to yours. After Charter Night, grants keep coming and credits buy more.", 199 chars, within the 200-char limit in `content/tokens.ts`) and "Sky Lobby" ("Three or more towers linked by skybridges. Fewer car trips, higher land value nearby, and visitors who come to walk it."); the Skybridge text is replaced (§5.7); "The Sunk" entry already says the city is built at its edge.

### 8.5 Copy rules

STORY.md §1.4 voice (Marrow in minutes, Sallow in arithmetic calling MOTH "Operations", Oduya delighted with the only `!`, Brine in tides calling MOTH "little light", lark lowercase calling MOTH "moth", Ohm hymn-like calling MOTH "the Hum"); briefs mandatory (≤ 220); lobby lines ≤ 110 and in voice; taglines ≤ 60; perk and hazard lines ≤ 48; neighbourhood names ≤ 15; no `$` in story bodies; screen names avoid every banned word (hence "Halo Lookout", "Reedmere Marsh").

### 8.6 Spoiler guard (lint, WP-7)

The reveal is Chapter IV (`ch4.drain` names the pump station, `ch4.logs` shows the order and the toll, `ch4.brine` decides what the city learns), not Chapter V. `tests/story/content-lint.test.ts` gains a scan over **every new player-facing string** this doc adds: every `DISTRICTS` text (tagline, perks, hazards, quotes, neighbourhoods, goals), the new building names, descriptions and meta lines, the megacity cards, the tips, the City life lines, the skybridge reasons and inspect notes, toasts and advisor lines, and all of §9's copy (plaques, review lines, epilogue cards, ending landmarks):

- none may match `/\bgates?\b|\bseal(ed|s|ing)?\b|complying|eleven thousand|11,000/i` (one rule for all new copy, epilogue included, so the lint needs no exception list; this is why skybridges go "dark", not "sealed");
- text that can show **before `ch4.drain`** (everything except the Sunk's own copy, which only shows once it opens after `ch4.brine`, and §9's flag-keyed marks and epilogue copy) may not match `/pump station|\bPS6\b|02:17/i`; before then the hall in the fog is only "Old pump hall";
- the Sunk is described as "the drowned wards" or drowned "in the storm of 2084" (the official story); its copy speaks to a player who knows what the logs said without restating it.

`stormwatch` (§6.4.1) keeps its barriers to owned Shoals and Sunk shores and to Charter Shore only after `ch4.logs`; WP-7 confirms this against STORY.md's foreshadowing intent. The existing news line "Skybridge sealed: …" is reworded to "Skybridge dark: …" by WP-2 (`vertical.ts`).

---

## 9. Choices that last

The owner, after the draft: *"I think even if the story ends, you should be able to keep building your city, making it your own. Adds more weight to your choices."*

**What exists today** (verified in `src/game/story/`): after Charter Night the ending screen's primary button is **Keep building** (`CHARTER_NIGHT_TEXT.keepBuilding`); the game moves to **Chapter VII · Epilogue** (`chapters.ts` `EPILOGUE`; `director.setEnding` sets `chapter = 7`, `phase = 'ended'`); the deck keeps running; the ending's `post` ModPatch and `rules` (`content/endings.ts`) apply for as long as that ending is current, because `resolveMods`, the faction code and the director read `story.ending` every time (STORY.md §6.4); the **Charter Review** (`ep.review`) is queued every `STORY_PACING.reviewEvery` = 1,080 sim days (`director.checkReviews`) and delivered at a deck slot, so at most one per deck gap (≥ 15 min on Relaxed), offering "Open a new count"; the **Full Recall** coda fires once all 12 Silt Logs are owned; the ending's look is a **screen grade** (`render/story.ts` `drawGrade`: Ironwork orange, Pearlescence pink, Low Crown lime and lilac at night with doubled turf tags, Open Ledger cool blue, Lamplight warm; the Quiet Hand none) plus Tuning window candles (`VisualState.candles`). Choices are saved as flags (`story.flags`) and the five key choices as choice indices (`story.keyChoices`, shown as icons on the ending screen).

**What is missing:** apart from the grade and the candles, the city the player keeps building does not show any of it. No building or place remembers the lark, the vote, the pier, the logs or the final choice; no landmark belongs to an ending; nothing after the ending mentions a choice by name; and with the draft, the map stopped growing two purchases after the ending.

**Principles.**

- **Derived, not applied.** Every mark is computed from saved state (flags, key choices, `story.seam`, the ending history) by one pure module, `src/game/marks.ts` (`deriveMarks(world): Marks`), on load and on the `flag`, `ending`, `annex` and `tiles` events, exactly as STORY.md §6.4 derives ending rules. A Charter Review that swaps the ending swaps the live look cleanly, and the history stays.
- **Never an interruption.** Marks appear on the map, in inspect, in names and in COMMS cards that wait; nothing new opens by itself or pauses.
- **Spoiler-safe.** All copy passes §8.6's lint; callbacks name choices by their in-game names ("the Seam Truce", "Clean Glass", "the logs you published", "the leash"), never the secret's specifics.
- **Cheap.** Decals, name swaps and variants of existing recipes, plus one landmark per ending.

### 9.1 What the player sees

> *"After Ironwork, Basalt's furnace towers creep across my skyline and I can build the Foreman's Gantry. At the Seam a long mural says the crews signed the truce there. In the Sunk the old pump hall stands open, lamps along the causeway, because I published the logs. Three years later the Charter Review reminds me lark still flies the moth kite. And the City map keeps growing."*

### 9.2 The five endings in the city

Each ending gives the post-ending city a distinct look in three layers, and opens one **ending landmark** the player can build only while that ending is current (`BuildingGate.ending`; Deals → **Legacy** chip, §7.1).

| Ending | Skyline takeover (L3 towers and parcels) | Street look (props and light, added to today's grade) | Ending landmark | Where it comes from |
|---|---|---|---|---|
| **Ironwork** | Basalt "Hex and Furnace" tower bodies | sodium-orange street lights; quota boards on Fab L2+ facades; a tower crane on 1 in 8 L3 roofs | **Foreman's Gantry** (`gantry`) | `end.ironwork`: "a serial number and a quota… one room unlit" |
| **Pearlescence** | Nacre "Pearl and Spiral" tower bodies | round smile screens on Market L2+ facades (an original pearl disc with two dots and an arc, MOTH's smile); a pearl halo on every tall tower at night | **The Glass Smile** (`glasssmile`) | `end.pearl`: "Every screen smiles your smile now" |
| **The Low Crown** | Undertow "Salvage and Tide" and Kites "Rig and Sail" bodies, alternating | string lights and both crews' banners on every corner; a lamp on every corner light (today's doubled tags stay) | **Bread Pier** (`breadpier`) | `end.lowcrown`: "split it like bread on the pier and hand you the knife to keep it fair" |
| **Open Ledger** | Board "Civic Stone" bodies | ledger tickers (the city's live budget lines scrolling) on Market facades; open glass ground floors; Board flags on avenues | **Record Tower** (`recordtower`) | `end.ledger`: "The Board reads the Ledger aloud, every line" |
| **The Quiet Hand** | none: the district styles stay pure, a city that looks owned by nobody | each active faction's colour appears once in turn on avenue pennants, never one more than another | **The Still Square** (`stillsquare`) | `end.quiet`: "the scales level, and your name to yourself" |
| **Lamplight** (Quiet Hand variant) | Tuning lantern roofs on Hab L2–L3 (a roof variant, not a new body) | today's window candles, plus lamps along every stair and causeway | The Still Square becomes **the Lamp Square** (candles on every step, a lamp path to the water) | `end.lamplight`: "Sister Ohm walks the old pump road and counts them" |

**Skyline takeover rule** (`marks.skylineLang(x, y)`, read by the kit's `pickForm`, §6.1). `story.endingHistory` (saved, §9.6) records each ending the city has held and for how long. For each ending, its share of eligible bodies is `min(0.35, 0.07 × sim years it has been current)`, and the shares of all past and present endings add up to at most 0.5, so the district styles always keep half the skyline. Each eligible body (L3 Hab or Market single tower, or an L3 parcel, in an owned district) hashes to a point in [0, 1); it draws in the language of the ending whose cumulative band covers that point, else in its district style. As a share grows, more towers turn; when a Charter Review swaps the ending, the old ending's band freezes and the new one starts growing, so a city that held Ironwork for six years and then Open Ledger keeps its furnace towers beside new civic stone. Landmarks, megastructures and faction buildings are never re-skinned. The tower bodies are WP-4 art (`art/legacy.ts`: per language a Hab L3 single, a Market L3 single and an L3 quad parcel body, so 15 bodies, plus the lantern roof variant), each inside `heights.ts` bounds.

**Ending landmarks** (one each, `maxCount: 1`, unlocked the moment the ending is chosen; `BUILDING_ORDER` before `'stack'`; art WP-4):

| id | Name | Size | Cost | Upkeep | Power | Effect while its ending is current | Jobs (×10) | Build reaction | Look |
|---|---|---|---|---|---|---|---|---|---|
| `gantry` | Foreman's Gantry | 4×4 | 90,000 | 800 | uses 120 | industrial demand +0.05; reactor, Stratablock and Foundry Spine costs ×0.95 more; Basalt power +150; pollution 0.3 r6; tall | 20,000 Fab | Basalt +10, Tuning −3 | a colossal gantry crane straddling a works yard; its cab is a lit quota board showing this month's Fab jobs; one cab window never lights |
| `glasssmile` | The Glass Smile | 3×3 | 85,000 | 700 | uses 90 | visitors +30,000/mo; land value +0.04 r14; Nacre power +150; tall | 3,000 | Nacre +10, Kites −6 | a pearl sphere on a slim stem; by night its whole surface is one screen showing MOTH's smile, which turns slowly to follow the camera |
| `breadpier` | Bread Pier | 4×4, shore | 40,000 | 0 | uses 20 | ↻ "Pier stalls" +900/mo (untaxed); gang turf crime ×0.85 r12; protects both gangs' turf r6; visitors +10,000/mo | 2,000 (untaxed) | Undertow +8, Kites +8 | a long pier market under one canopy, half nets and green lamps, half kites and string lights, one long table down the middle |
| `recordtower` | Record Tower | 3×3 | 70,000 | 400 | uses 40 | approval +3; upkeep ×0.98 city-wide; land value +0.03 r12; tall | 1,500 | Board +10 | a stone tower whose four faces scroll the city's real income and upkeep lines (read from `stats`), a public reading hall at its foot |
| `stillsquare` | The Still Square | 3×3 | 30,000 | 100 | uses 6 | park r12; approval +1 (+2 under Lamplight); Nudge cooldown 360 → 270 d; under Lamplight full window candles within r16 | 100 | every visible faction +2 | a quiet plaza around a great balance whose pans always hang level, lit from below; under Lamplight candles on every step |

Descriptions (Appendix A): Gantry "A gantry crane over a works yard. Its cab is a quota board. One window never lights." · Glass Smile "A pearl sphere on a slim stem. At night its whole face smiles your smile." · Bread Pier "A long pier market under one canopy: half nets, half kites, one long table." · Record Tower "A stone tower whose four faces scroll the city's accounts, live, line by line." · Still Square "A quiet square around a great balance. Its pans always hang level."

**After a Charter Review changes the ending**, a built ending landmark **stays** (it is history). It switches to a "past" look (the quota board dark, the smile screen off, the pier stalls shuttered, the ledger frozen on the review day, the scales still level), keeps its park, visitors and approval terms, and drops its ending-bound terms (faction power, cost and demand terms, income, Nudge, turf). Inspect notes "Built under Ironwork" and "Dormant: its ending is not current". If the city later holds that ending again, it wakes. Over several reviews a city can collect all five: one of the sandbox's goals (§3.8).

Core: the skyline takeover, the street look for each ending, the five landmarks with their past looks. Optional: the smile following the camera, the live ledger text (a static ticker is the fallback).

### 9.3 Key choices leave marks

Each mark is a `Mark` from `deriveMarks`: a kind (`decal`, `name`, `variant`, `share`, `plaque`), a place (a tile, a building, a neighbourhood cell or a district) and the flag it reads. Places come from saved state only: `story.seam` (a saved tile index, migrated with +64), the old pump hall (fixed by annex content), the oldest standing building of a type (by id), or a deterministic tile in a slot. A renamed neighbourhood replaces that 8×8 cell's `{district}` name in news, inspect and cards; the naming lint (§3.7) covers the new names.

| Card · choice | Flag read | Mark | Kind and place | Core? |
|---|---|---|---|---|
| `ch1.lark` · "Answer: 'M.O.T.H.'" | `larkKnows` (`keyChoices['ch1.lark'] = 0`) | **lark's kite**: a lilac moth-wing kite flies over the tallest building on Kites turf (the Kite Mast once built), every day; by night its tail blinks; plaque "lark's kite: she flies it for you." `ep.kite`'s "Ping them back." (`kiteHello`) adds a second, smaller kite | decal over a building | core |
| `ch1.lark` · "Stay dark." | `keyChoices['ch1.lark'] = 1` | **the dead channel**: one unlit relay mast on Charter Shore's old pump outfall (the start slot's shore tile nearest its centre); plaque "A dead pump channel. Nothing pings back." | decal on a tile | optional |
| `ch1.lark` · "Answer as a Board clerk." | `clerkLie` | **Clerk No. 9**: a brass plaque on the oldest Commons Hall or the Charter Hall: "Permits: Clerk No. 9." | plaque | optional |
| `ch2.vote` · "Project a Basalt win." | `patron = basalt` with `keyChoices['ch2.vote'] = 0` | **the patron's first ground**: a permanent 10% Basalt band of Charter Shore's L3 towers (the takeover rule's bodies, start slot only, inside its 0.5 cap) from Chapter II on; the cell holding the oldest Foundry Spine is renamed **Projection Yards**; plaque "Ground broken on a projection." | share + name | core |
| `ch2.vote` · "Project a Nacre win." | `patron = nacre`, `keyChoices['ch2.vote'] = 1` | the same with Nacre; the cell with the oldest Glarewall becomes **Delight Row**; plaque "Delight, as projected." | share + name | core |
| `ch2.vote` · "Report the honest tie." | `honestTie` | a 10% Board "Civic Stone" band of Charter Shore's L3 towers; the cell with the oldest Neon Plaza becomes **Four-Four Square**; plaque "Four to four. The terminal told the truth." | share + name | core |
| `ch3.pier` · "Run Clean Glass." | `cleanGlass` | **Clean Glass mast**: a floodlit precinct mast at the Seam whose searchlight sweeps at night; the Seam's cell becomes **Glass Yard**; plaque "Operation Clean Glass began here." | decal + name at `story.seam` | core |
| `ch3.pier` · "Broker the Seam Truce." | `truce` | **Truce Wall**: both crews' tags meet on one long mural along the Seam's facades (r2); the cell becomes **Truce Row**; plaque "The crews signed the Seam Truce here." `ep.seam`'s lights (`seamFair`) add string lights across it | decal + name | core |
| `ch3.winner` · Undertow | `oneTide = undertow` | **Low Water**: nets and green lamps hang over the Seam's streets; the cell becomes **Low Water**; plaque "The Undertow took the Seam here." | decal + name | core |
| `ch3.winner` · Kites | `oneTide = kites` | **High Line**: kites and string lights over the Seam; the cell becomes **High Line**; plaque "The Kites took the Seam here." | decal + name | core |
| `ch4.brine` · "Publish everything." | `published` | **the open hall**: the old pump hall's doors stand open, lamps line the causeway, a wall of names glows from below; the Sunk's tagline becomes "The drowned wards. The city knows their names now."; plaque "Open to all. The names are read here every year." `ep.names`' lamps (`namesLit`) keep every lamp lit each night | variant of `pumphall` + tagline | core |
| `ch4.brine` · "Bury it. Sell the silence." | `buried` | **private works**: the hall fenced and dark under a faded {patron} sign; tagline "The drowned wards. Fenced off and quiet."; plaque "Private works. No entry." `ep.fence` can pour a slab over it (`hallPoured`) or open it after all (`hallOpened` → the open hall) | variant + tagline | core |
| `ch4.brine` · "Leash the Board." | `leashed` | **the archive**: a Board flag, a guard box, one lit window; tagline "The drowned wards. The Board keeps the key."; plaque "Board archive. Key held by the Chair." `ep.leash`'s "Take the leash off." (`unleashed`) opens its door | variant + tagline | core |
| `coda.recall` · "Stay." | `fullRecall` | **every lamp lit**: every window of the old pump hall lit and a small figure with a lamp at the door; plaque "Every lamp lit." (overrides the three looks above for the light only) | variant | core |
| the reveal itself | `ch4.logs` shown and the Sunk owned | **the Sunk Memorial's Lower Wards look**: a Sunk Memorial built inside the Sunk faces the water, its names wall lit from the canal side; the first one there adds +1 approval to today's +3 | variant of `memorial` | core |
| `ch5.choice` · "Sign with {patron}." | `lure = shelved` | **patron livery**: Charter Shore's street lamps wear the patron's collar (a Basalt orange band or a Nacre pearl ring); plaque on lamps "Lit under contract." | decal (lamps) | core |
| `ch5.choice` · "Go to ground with the crews." | `wentToGround` (`lure = running`) | **dark blocks**: three developed blocks in the strongest gang's turf keep their windows dark at night, a lime moth stencil on one wall; plaque "Something hums here after midnight." | decal on tiles | core |
| `ch5.kept` · "Agree." | `keptByBoard` | **the answering balcony**: the Charter Hall (or the oldest Commons Hall) gets a lit balcony with a public terminal; plaque "MOTH answers to this room every month." | variant + plaque | core |
| `ch5.hidden` · "Thank her." | `hiddenByTuning` | **Ohm's door**: lamps ring the old pump hall's door (shown once the Sunk is owned); plaque "A lamp by the door, for next time." | variant | core |
| `kt.paint` · "Say yes." | `mural` | today's bridge art variant, plus the plaque "lark's crew painted this." on its bridge | plaque | optional |
| `kt.door` (Fen) | `fen = free` | kites fly off the Ribbon Rail stations by day ("fen's flying kites off the ribbon now") | decal | optional |
| `bd.archive` · "Give her the minutes." | `marrowKnows` | the Charter Hall plaque "Minutes, unedited." | plaque | optional |
| the ending | `story.ending`, `endingVariant`, `endingHistory` | §9.2 | share + landmark | core |

### 9.4 Callbacks in words

**Charter Review lines** (core). `ep.review` gains a second paragraph appended by the director, the way `end.lamplight` adds one to `end.quiet` (`director` line ≈ 1979). The line comes from `REVIEW_LINES` (new `src/game/story/content/epilogue.ts`, WP-8): the first entry whose `when` holds and whose id is not in `story.callbacks` (saved), in table order; the generic line when none is left. Each review uses one line, so callbacks never pile up. Lines (≤ 140 chars, narrator voice like `ep.review`, checked with `rev/check3.mjs`):

| id | when | Line |
|---|---|---|
| `rl.lark` | `larkKnows` | Lark still flies the moth kite over the rooftops. She tells the new kids it answers when they ping it. It does. |
| `rl.dark` | `keyChoices['ch1.lark'] = 1` | The dead pump channel still pings now and then. You still don't answer. The kids on the roofs have stopped asking. |
| `rl.clerk` | `clerkLie` | A permit form still lists Clerk No. 9. Nobody has ever met the clerk. You keep it that way. |
| `rl.tie` | `honestTie` | The Board still quotes the four-to-four vote. The terminal told the truth that night, and they have not forgotten. |
| `rl.basalt` | `keyChoices['ch2.vote'] = 0` | Basalt still builds on the projection you gave them. The furnaces never asked whether it was honest. |
| `rl.nacre` | `keyChoices['ch2.vote'] = 1` | Nacre still frames the projection in its lobby: the night the city chose delight. They frame it beautifully. |
| `rl.glass` | `cleanGlass` | The Clean Glass mast still lights the Seam. The kids there were born after the sweep. They know the story anyway. |
| `rl.truce` | `truce` | The Truce Wall at the Seam has more tags than ever, and not one of them is crossed out. |
| `rl.tideU` | `oneTide = undertow` | Nets still hang over Low Water. The Undertow tells the story of the Seam one way. The Kites tell it another. |
| `rl.tideK` | `oneTide = kites` | Kites still fly over the High Line. The Kites tell the story of the Seam one way. The Undertow tells it another. |
| `rl.published` | `published` | The names from the Sunk are read aloud every year now. Old Brine reads her mother's street last. |
| `rl.buried` | `buried` | The old pump hall is still fenced and dark. {patron}'s sign has faded. The water under it has not. |
| `rl.leashed` | `leashed` | The Board still keeps the key to the old pump hall. Marrow checks the lock herself, every month. |
| `rl.signed` | `lure = shelved` | {patron}'s colours are on every lamp you light. You light them anyway, on time, every night. |
| `rl.ground` | `wentToGround` | Three dark blocks still hum after midnight. The crews never ask what runs in them. You never tell. |
| `rl.kept` | `keptByBoard` | Every month you answer to the Board, out loud. Five to four, the first time. Some months now it is six. |
| `rl.ohm` | `hiddenByTuning` | Sister Ohm still keeps a lamp by the pump hall door. She says it is for next time. She hopes there isn't one. |
| `rl.recall` | `fullRecall` | Every lamp in the old pump hall is lit. You stayed. Some nights that is the whole job. |
| `rl.generic` | always | The city has grown since Charter Night. So have the claims. |

**Epilogue cards** (new `src/game/story/content/cards/epilogue.ts`, WP-8). Deck cards with `when` including `m('chapter', '>=', 7)`, `once`, `weight: 10`, `cooldown: 720`, exactly one default (‡), a `brief`, no ⚑, no beat, no queue. They join `DECK` and `CARD_LIST` (spread by Step 0b from an initially empty `EPILOGUE_DECK`, so WP-8 never edits `cards/index.ts`) and arrive as COMMS cards under the pace's deck gaps (Relaxed: ≥ 15 min apart), so they add callbacks, not frequency. Three new tokens resolve from flags (`content/tokens.ts`, WP-8): `{seamPast}` ("the Seam Truce" / "Clean Glass" / "the night the Undertow took the Seam" / "the night the Kites took the Seam"), `{votePast}` ("the honest tie" / "the Basalt projection" / "the Nacre projection"), `{logsPast}` ("the logs you published" / "the logs you buried" / "the leash").

Core (5):

##### `ep.kite` · Kites · lark · THE KITE STILL FLIES
when `chapter >= 7 & larkKnows`
> lark: 'remember when you pinged back? i teach the new kids the dead channel now. they made you a kite. it's ugly. it flies anyway. they want to meet you. i said you're shy.'

Brief: "Lark, grown up now, teaches the Glass Kites' rooftop kids, and they made a kite for you. Say hello (the Kites are pleased, a little Trace), or stay the story they tell."
- **Ping them back.** → Kites +6, Trace +1, flag `kiteHello`
- **Stay a story.** ‡ → Kites +2

##### `ep.seam` · Undertow + Kites · ONE NIGHT AT THE SEAM
when `chapter >= 7 & seam set & (truce | cleanGlass | oneTide)`, spot `seam`
> Brine and lark, on one call. Brine: 'Since {seamPast}, the kids at the Seam keep one night a year for both crews, little light. No colours.' lark: 'and lights. lots of lights.' Brine: 'Some lights.'

Brief: "Years after {seamPast}, kids from both crews want one shared night at the Seam in {district}. Paying for the lights pleases both gangs and the Board. Leaving it to them pleases both a little."
- **Light the Seam for them.** → CR −3,000, Undertow +4, Kites +4, Board +2, flag `seamFair`
- **Leave it to the crews.** ‡ → Undertow +1, Kites +1

##### `ep.names` · Undertow · Old Brine · THE NAMES
when `chapter >= 7 & published & district.sunk >= 1`
> Brine: 'We read the names at the old pump hall now, little light. Every year, the whole night through. Come and keep the lamps lit while we read. You know the way better than anyone.'

Brief: "Since you published the logs, the Undertow reads the names of the drowned every year at the old pump hall in the Sunk. Paying for the lamps honours them and lifts approval for good."
- **Keep every lamp lit.** → CR −2,000, Undertow +6, `[approvalAdd +1, perm]`, flag `namesLit`
- **Leave it to them.** ‡ → Undertow +2

##### `ep.fence` · System · PRIVATE WORKS
when `chapter >= 7 & buried & district.sunk >= 1`
> A letter from {patron}: the old pump hall in the Sunk is still listed as private works, fenced and dark. They would like to pour one slab over it and close the file. The water under it is quiet. For now.

Brief: "You buried the logs, and {patron} wants to bury the old pump hall too. Pouring over it pays well, but the Undertow will not forgive it. Leave it fenced, or open it to the public after all."
- **Pour over it.** → CR +15,000, Undertow −15, patron +5, flag `hallPoured`
- **Leave it fenced.** ‡ → none
- **Open it after all.** → Undertow +10, patron −10, Trace +4, `[approvalAdd −2, 180d]`, flag `hallOpened` (a mark only: `buried` stays, so the Open Ledger claims are unchanged)

##### `ep.leash` · Charter Board · Ilse Marrow · THE LEASH
when `chapter >= 7 & leashed` (retired with the Board under Ironwork, like every Board card)
> Marrow: 'Minutes. Item: the leash you hold on this Board. Proposed: you take it off. Noted: we are asking, not telling. Noted: we know what that means. Noted: so do you.'

Brief: "Years ago you used the logs to leash the Board. Chair Marrow asks you to let it go. Freeing them pleases the Board a great deal. Keeping the leash keeps things as they are."
- **Take the leash off.** → Board +12, flag `unleashed` (a mark only: the permanent floor and the closed Open Ledger claim stay as STORY.md defines them)
- **Keep the leash.** ‡ → Board −2

Optional (5, one per ending landmark; WP-8 writes the final copy under the same lint, each with a brief): `ep.quota` (Basalt, Sallow, when `ending = ironwork & count.gantry >= 1`: he raises the quota on the Gantry's board; meet it, meet it and keep the dark room, or ask for a holiday), `ep.smile` (Nacre, Oduya, `pearl & count.glasssmile >= 1`: she wants the Smile to wink at people), `ep.pier` (Undertow + Kites, `lowcrown & count.breadpier >= 1`: the crews ask MOTH to cut the bread on the pier's first night), `ep.record` (Board, `ledger & count.recordtower >= 1`: a resident asks for a line in the Record to be struck), `ep.level` (system, `quiet & count.stillsquare >= 1`: the scales tilt by a hair; leave them or nudge them back).

### 9.5 The map keeps growing after the ending

- **Epilogue land grants** (core, §3.8): one every `pace.chapterMinSec` unpaused real seconds after the ending (1,440 / 840 / 600 s on Relaxed / Normal / Brisk, the cadence the chapters had), counted in `districts.epilogueSec`, while a slot is locked and no grant is unspent. One ticker line and the ✦ token; never a card, banner or pause.
- **Purchase with credits** (core): any time after the ending, `DISTRICT_PRICES` (fixed, §3.2); buying skips the wait and never resets the grant clock.
- A city that reaches Charter Night with 7 districts owns all 9 about 48 minutes later on Relaxed without spending, sooner if it buys. Then the City map says "The city reaches the edge of the region." and the sandbox goals take over (§3.8). Growing past nine districts is an open owner question (Appendix E).

### 9.6 Saves, ownership and tests

**Already saved (no change):** every choice flag (`story.flags`: `larkKnows`, `clerkLie`, `patron`, `honestTie`, `cleanGlass`, `truce`, `oneTide`, `published`, `buried`, `leashed`, `lure`, `wentToGround`, `keptByBoard`, `hiddenByTuning`, `fullRecall`, `mural`, `fen`, `marrowKnows`…), `story.keyChoices`, `story.seam` (a tile index, migrated by §3.10's remap), `story.ending`, `endingVariant`, `endingTick`, `nextReview`, `nudgeReady`, `logs`, `seen` (once cards), `story.log`. The new epilogue choices only set new flags (`kiteHello`, `seamFair`, `namesLit`, `hallPoured`, `hallOpened`, `unleashed`) in the same `story.flags`.

**New in v4** (all optional; missing reads as the default):

| Field | Shape | Missing → | Validated in |
|---|---|---|---|
| `story.endingHistory` | `{ id: EndingId; variant: 'lamplight' \| null; from: number; to: number \| null }[]` (≤ 32 entries; a review that keeps the ending adds nothing) | a save with an ending: one entry `{ id: ending, variant: endingVariant, from: endingTick, to: null }`; else `[]` | `story/encode.ts` |
| `story.callbacks` | review line ids used (`string[]`, ≤ 64) | `[]` | `story/encode.ts` |
| `districts.epilogueSec` | unpaused seconds (§3.2) | 0 | `world.ts` |
| ending landmarks, `pumphall` | ordinary buildings | — | as buildings |

The marks themselves are never saved: `deriveMarks` recomputes them on load.

**Ownership.** Step 0b freezes the interfaces: `src/game/marks.ts` with `deriveMarks(world): Marks` and `skylineLang(x, y)` (a stub returning no marks and `null`), `BuildingGate.ending`, the three `StoryState` fields above, `VisualState.marks` (the derived set the renderer reads), the `EPILOGUE_DECK` spread in `cards/index.ts`, the `marks.draw(ctx, …)` call site in `render/story.ts` delegating to a no-op `art/marks.ts`, and the five ending landmark `BUILDINGS` rows. **WP-4** (art, Wave 2) draws the five ending landmarks with their past looks, the 15 faction tower bodies and the lantern roof, and the `pumphall` looks. **WP-8 · Choices that last** (Wave 4, core, §12) owns `src/game/marks.ts`, `src/render/art/marks.ts` (decals: kites, mast, Truce Wall, nets, banners, livery, smile screens, ledger tickers, quota boards, dark blocks, the Lower Wards memorial look), `story/content/epilogue.ts` (review lines, tokens' strings), `story/content/cards/epilogue.ts`, the director's review-line append and `endingHistory` bookkeeping in `story/director.ts`, `content/tokens.ts` (the three tokens), the epilogue grant clock in `game.ts` (handed over from WP-2 after Wave 1), and a **Keepsakes** list in the goal drawer's "Story so far" (new `src/ui/story/keepsakes.ts`: each mark with its plaque line and a "Show" button that pans the camera to it).

**Tests** (WP-8, `tests/lasting-choices.test.ts` and `tests/story/lasting-lint.test.ts`):

1. Table-driven: for every row of §9.3, setting its flag (or key choice) produces exactly that mark at that place; clearing it removes it.
2. `deriveMarks` after a save and load equals `deriveMarks` live (marks are derived, nothing drifts).
3. Ending history: a city that held Ironwork for 6 sim years and then Open Ledger for 2 has Basalt share 0.35 and Board share 0.14 (total ≤ 0.5); the bodies in the Basalt band stay Basalt after the swap.
4. Ending landmarks: buildable only while their ending is current; after a review swap the landmark stands, reads "Dormant", keeps its visitors, park and approval and drops its ending-bound terms; it wakes when the ending returns.
5. Epilogue grant clock on a fake clock: the first grant 1,440 unpaused s after the ending on Relaxed, never while paused, none while a grant is unspent, none once all 9 slots are owned; a purchase does not reset it; the clock survives save and load.
6. Review lines: each review appends exactly one line, never repeats one, falls back to the generic line, and every line and epilogue card passes §8.6's lint, the length limits and the voice rules (lowercase lark, Brine's "little light", Marrow's minutes, no `!` outside Nacre).
7. Epilogue cards are drawable only in Chapter VII with their flags, never open by themselves, and `ep.fence` / `ep.leash` leave `buried` / `leashed` and therefore the ending claims unchanged.
8. A v3 post-ending fixture migrates with one `endingHistory` entry and shows its marks on first load.

---

## 10. Audio

- Annex: the existing `milestone` sfx at the fog lift. Skybridge build and routes: `build`. Frame finish: `build`. No new `sfx` kinds (audio keys a `Record` on them).
- City life: no sound by default; *optional* (WP-5, in `audio.ts`): a soft chime when a night market or lantern night starts, through `AudioEngine` listening to `cityEvent` directly (its own gap, ≥ 420 s apart by construction).
- *Optional* district ambience: a quiet loop per style under the music when that district fills the view (gulls, machinery, market voices), muted with sound off.

---
## 11. Performance, saves, balance and tests

### 11.1 Budgets

Node figures are what the tests assert (CI keeps EXPANSION's 3× slack). Phone figures use the factor **measured in Step 0b** on the reference device (a mid-range phone, or Chrome with 4× CPU throttling when no phone is available); the 3.5 in §2 is the assumption it replaces. Every per-frame budget is a **p95 and a max**, because a single slice or the month end cannot be split further (§2.6).

| Area | 1 district | 9 districts, fully built | How |
|---|---|---|---|
| `sim.step()` (headless whole day) mean | ≤ 1.0 ms (today 0.78–1.05) | ≤ 4.5 ms (prototype 4.1–4.9) | O1–O4, O7 |
| Sim work in one frame (`stepSlice` slices + `story.onDay`), during a speed-3 run | p95 ≤ 2 ms, max ≤ 4 ms | **p95 ≤ 4 ms, max ≤ 6 ms** (draft prototype, unsliced: p95 7.4, max 13.3) | tick slicing, O4 |
| The month-end frame (settlement, the day's slices, `onMonth` parts due that day, nothing else) | ≤ 3 ms | **≤ 6 ms p95, ≤ 8 ms max** (today's code: 15–17 p50, 26 max) | month end spread, O6 |
| Autosave frame (serialize + stringify + `setItem`) | ≤ 1 ms | ≤ 2 ms p95 in Node + `setItem` measured on the device; never in a frame that ran a slice | tile blocks, idle frame (§3.3) |
| After a player action (`recomputeAround`) | ≤ 1.5 ms | ≤ 5 ms | O5 |
| `recomputeAll()` (load, new city, annex) | ≤ 2 ms | ≤ 12 ms | — |
| Render cache upkeep (R0) during a speed-3 growth run | ≤ 0.1 ms mean | **≤ 0.3 ms mean, ≤ 1 ms p95** (today 2.7 ms per `tiles` event) | dirty rects, 250 ms throttle (§3.9) |
| Save size | ≤ 40 KB | **≤ 260 KB** (tiers and ground set) | tile blocks (§3.10) |
| `Game.restore` (parse, deserialize, generate locked slots and border strips, sim constructor, `recomputeAll`) | ≤ 40 ms | **≤ 120 ms** in Node (empty-world restore today 109 ms); measured on the device | §3.6.1 |
| Migration v1–v3 → v4 | ≤ 60 ms once | — | §3.10 |
| Sim share of a phone frame at speed 3 | — | ≤ 30%; frame cap 6 ms | §3.3 |
| Frame, mid-range phone, default zoom | ≥ 30 fps, 60 target | same | view-bound; skyline view below 0.4 (§3.9) |
| On-screen sprites at minimum zoom | ≤ 3,775 tiles (today) | ≤ 2,195 tiles at 0.4; ≤ 2,600 sprites in the skyline view | §2.5, §3.9 |
| Canvas memory | ground 24 MB + sprites 32 MB (today) | + overview ≤ 4 MB + atlas ≤ 4 MB | §3.9, §6.1 |
| JS heap + typed arrays | +≈ 15 MB for the 192 frame (measured: 4.3 MB heap + 11 MB typed arrays for one World + Simulation) | same; the title Showcase's world is released when the title closes | §3.9 |
| Skybridges | ≤ 0.4 ms for 60 visible gap tiles | same | cached segments |
| Life and atmosphere | ≤ 1.5 ms a frame together (crowds 0.6, weather 0.5, boats 0.2, City life 0.4) | same | §6.4 |
| Faction signatures and marks (§6.2, §9) | ≤ 0.3 ms a frame | same | live fx in the effects pass |
| City map open | ≤ 2 ms a frame | same | 9 impostor blits, progressive repaint |

### 11.2 Save, migration and contract tests (Step 0b)

`tests/save-v4.test.ts`, `tests/districts-contract.test.ts`:

1. v1, v2 and v3 fixtures (the pinned JSON files of Step 0a) migrate: the start slot's tiles equal the old tiles bit for bit; buildings at +64; sky, turf and rail at the offset; links +64; `seam`, `pending.spot`, `open.spot`, `waiting.spot`, `railOut[].i` remapped; `locals` and `crackdowns` +64; `maxPopulation` ×10 and `milestones` mapped; grants owed (a Ch3 save gets 2, a post-ending save 6, with `endingHistory` and `epilogueSec 0`); `.v2` for v1–v2 and `.v3` for v3, each written once and never overwritten; `loadedVersion` kept.
2. The contract test walks every `StoryState` key and fails on a numeric field not listed as a tile index, a coordinate or "not spatial".
3. A v4 round trip keeps owned slots, their order, grants, `bought`, `annexedAt` (length 9, by SlotId), the lease, `epilogueSec`, `goalsDone`, `ruinsRestored`, `elev`, `ground`, `sponsor`, `look`, `reclaim`, `endingHistory` and `callbacks`; locked slots regenerate identically; the 9-district fixture with tiers and ground serializes ≤ 260 KB.
4. Corrupt input never throws except "Incompatible save" for a bad tile block, a block count mismatch, duplicate or out-of-range slots, or a missing `START_SLOT`; unknown or wrong-length `kinds` → the seed's layout; negative grants → 0; `elev` or `ground` on water → 0; a lease on an unowned or wrong district → dropped.
5. A v5 save, or a v4 save whose `size` is not 192, is left untouched and blocks autosave (EXPANSION §2.5 rule with versions bumped); a v4 save is never run through `upgradeSave`; a dev save with `scale: 10` is not multiplied again; `previousSaveInfo` shows ×10 numbers for a v3 backup.
6. `World.generate(seed)`'s start slot equals today's `generateTerrain` output for 30 seeds.
7. Every mutator, called in random order with random annexes, keeps the §3.2 invariants; nothing can be built, zoned, railed, skywayed, bridged, turfed or reclaimed on a locked tile.
8. Layout (§3.6.2) over 200 seeds: every kind once, the Shoals across the bay, land shares in range, every slot ≥ 35% land in one component.
9. **Field identity on slot 4:** a pinned v3 fixture loaded in v4, then `recomputeAll`, gives every field on the start slot (pollution, neighbourhood, land value, crime, coverage, traffic, terrain value) equal to the v3 build's within 1e-6 (the O1 boundary rule and `artXY` noise).
10. **Look 0:** the v3 fixture's Spires, crowns, faction buildings, Arcology, reactors and Stratablocks resolve to today's art recipes after loading (§6.2).
11. **Ids:** every model id family (zones, lots, kit, services, sky, bridges) is disjoint; the sprite key of the largest id stays below 2⁵³; the frame-size assertion of §3.1 holds.
12. **Annex determinism:** the same seed and the same annex order give an identical world (tiles, buildings, rng state).

### 11.3 Balance targets

Measured headless (§11.4); Step 9 tunes only the megacity tables in config.ts and records the results in §11.6.

| # | Scenario | Target |
|---|---|---|
| S1 | **Invariance of the unit change** (run at the commit that lands Step 0a part 1, before the density pass). The expansion fixture and `ScriptedMayor` (seeds 2091, 7, 31) at years 3 and 8, saved by the v3 build (pinned fixtures) and loaded by v4 | residents and jobs ×10 (±0.5%); monthly income and expenses ±1%; avgTraffic, avgPollution, avgLandValue, unemployment ±0.002; approval ±0.5; power supply and demand identical; salt price and Balance of Power identical (±1 point). Afterwards the suite keeps S1's static half (§4.1). |
| S2 | v4 `ScriptedMayor` 8 years against its v3 run (after the density pass) | population ×10 within −5% / +25% (the denser jobs free land for homes); funds trajectory within −5% / +25%; chapter starts in the story harness within ±30 d on every pace |
| S3 | Existing balance, playthrough and expansion-balance tests (expectations ×10, density-adjusted where they count jobs) | pass |
| S4 | **Density pass.** A demand-led mayor (zones whichever of Hab, Market, Fab has the highest demand) on one district, 12 sim years | at zero unemployment (≤ 5%), land developed as Hab 55–65%, Market 15–25%, Fab 15–25%; avgTraffic within +0.03 of S2's; Balance of Power within ±2 points of S2's; every megastructure houses or employs ≥ 1.5× the heads of its footprint in L3 zone tiles (§4.2) |
| D1 | **MegaMayor** with PACING.md's harness (0.5 s a sim day, Relaxed pace, the reading-time model; annexes whenever a grant waits, candidates in a fixed kind order, grows each new slot with the `ScriptedMayor` grid), run to Charter Night and 60 unpaused minutes past it, 3 seeds, plus a speed-3 variant | districts owned at each chapter start: Ch2 ≥ 2, Ch3 ≥ 3, Ch4 ≥ 4, Ch5 ≥ 5, Charter Night ≥ 6 (7 after the ending's grant), 9 by 60 min after it; residents at Charter Night 1.0–3.0 M; net income positive every year; approval within ±5 of the one-district mayor; **no stall**: owned land is never ≥ 85% developed for more than 10 unpaused minutes while no grant waits and (after the ending) no purchase is affordable. The 7-district net income at Charter Night sets `DISTRICT_PRICES[7..8]` (§3.2). |
| D2 | Each perk (unit tests) | Shoals bridges ×0.6 price; Sunk ruins recover ≥ 1.8× as often as abandoned tiles elsewhere; **ruins: ≥ 90% still stand after 2 sim years untouched**, never counted in `abandoned`, the advisor's abandoned line and the "Dark lots" driver ignore them; Kessel Fab zoning ×0.5 and its demand add stops at 400 Fab tiles; Terraces +0.035 land value per step; an unbuilt reed tile reads park ≥ 0.45; the Tarmac lease adds 2,000 jobs of demand; 100 Bazaar Market tiles → 6,000 visitors; Seaport and Airport limits follow `PORT_LIMITS` |
| D3 | Hazards stay mild | no hazard abandons a building; king tides and the floodplain cap vanish under a Floodwatch; brownfield clears ≤ 720 d after development |
| D4 | No softlock | the playthrough test with annexing disabled reaches Charter Night and an ending on every pace; the Sunk is never annexable before `ch4.brine` on any pace (pace test) |
| D5 | A new district grows | the first `ScriptedMayor` block in a just-annexed slot develops within 60 d of getting road and power |
| D6 | District goals | every goal is reachable in its district by the MegaMayor or a scripted builder within 10 sim years; each pays once and posts one line |
| K1 | Sky Lobby payoff (fixture: 2–6 L3 towers in a row, bridged) | trips −20% at k = 2, −25% at k ≥ 3; land value at the anchors +0.05 (+0.02 × min(k, 4) in a lobby); visitors 1,000 × (k − 2), ≤ 6,000 per lobby and ≤ 30,000 city-wide; the Halo Lookout unlocks at k = 5; a 2×2 parcel counts once |
| K2 | Skybridge placement on a **dense downtown fixture** (a 16×16 block of mixed L2 and L3 Hab and Market, parcels on, plus an aligned row) | every green partner builds; every red reason ≤ 32 chars; no L2 tile ever blocks a bridge between L3 anchors; no parcel blocks itself; a two-bridge route exists for ≥ 80% of non-aligned tall pairs within 10 tiles |
| V1 | Variety | adjacent-identical rate ≤ 3%; no body over 15% of its cell on screen; no identical body within r = 2; ≥ 6 bodies per single cell and ≥ 4 per pair and quad cell (matrix test); style silhouettes ≥ 25% of their district; distinct bodies at zoom 1 ≤ 260; paint rate ≤ 1.5× v3 |
| P1 | Performance | §11.1 with the megacity fixture, p95 and max included |
| R1 | Render passes | a canvas-mock speed-3 growth run counts whole-map passes per frame: ≤ 1 per 250 ms |
| E1 | City life | 3–7 per unpaused hour; none in the first 600 s; never two at once; exactly one ticker line each; gameplay terms last ≤ 60 sim days at any speed |
| L1 | Choices that last | §9.6's tests |

### 11.4 Headless measurement plan

`tests/megacity-measure.test.ts` (Step 9), skipped unless `MEASURE=1`, seeds 2091, 7, 31, one printed table per scenario:

- **M1** S1 invariance from the pinned v3 fixtures. **M2** MegaMayor with the PACING harness to Charter Night + 60 min (D1, D5, D6), and the demand-led mayor (S4). **M3** `megacityFixture(n)` for n = 1, 3, 5, 9 fully built slots: whole-day `step`, the per-frame sim work of a speed-3 run (sliced), the month-end frame, the autosave frame, `recomputeAround` over 100 random actions, `recomputeAll`, `Game.restore`, save size (P1), printing **p50, p95 and max** per measure (best-of-8 means only alongside). **M4** Sky Lobby payoff and placement (K1, K2). **M5** perks and hazards (D2, D3). **M6** City life on a fake clock (E1). **M7** render counts with `tests/canvas-mock.ts`: distinct body ids per frame in a scripted pan over the fixture at zoom 1, 0.55 and 0.4, painted sprites per second, adjacent-identical rate, sprites in the skyline view, whole-map passes per frame (V1, R1).
- **Fixture and mayors** in new `tests/megacity-fixture.ts` (WP-1, extended by Step 9; `tests/helpers.ts` gains only the frame port of Step 0b): `megacityFixture(world, n)` owns and fills n slots with World mutators only (so WP-1 does not depend on WP-2's tools); `MegaMayor` wraps `ScriptedMayor` with `annex` and per-slot origins.
- The scratch scripts of Appendix D are the starting point; M3 reproduces §2.2–§2.6 inside the test suite.

### 11.5 Tests by package

| Package | New tests | Updated |
|---|---|---|
| Step 0a | `megacity-scale.test.ts` (S1 at the part-1 commit, then its static half; the threshold and per-tile-term lints), pinned `tests/fixtures/v3-*.json` | every population expectation (balance, budget, growth, story harness and playthrough, expansion balance), density-adjusted job expectations, the "Fab Yards" strings |
| Step 0b | `save-v4.test.ts`, `districts-contract.test.ts` (§11.2), `parcels-contract.test.ts` (the merge rule as a pure function), `heights.test.ts` (`CLASSIC_TOPS` equals the art, bounds) | **the 32 test files** that match the size grep (`64`, `63`, `4096`, `MAP_SIZE`, `N - 1`): actions-ports, actions-roads, actions-story, building-art, expansion-contract, expansion-fixture, expansion-measure, fields, fuzz, helpers, input-gestures, perf, port-fx, ports-sim, render-ground, render-roads, roads, save-v3, save, sim-roads, start-screen, story/conditions, story/content-lint, story/contract, story/effects, story/expansion-cards, story/format-vs, story/mods, story/pace, turf, vertical, wealth. Some mean "the map edge" by `N − 1` (e.g. `expansion-fixture.ts` digs its bay with `clearRect(w, 0, 60, N−1, N−1)`, which at 192 lands in a locked slot), so each is reviewed, not rewritten blindly. New helpers: `sx(x)` / `sy(y)` (slot-local → world for slot 4), `flatWorld()` owns all 9 slots, `startWorld()` owns only slot 4, `fullyBuiltWorld()` builds in slot 4; shared fixtures are cached per file (a World + Simulation costs ≈ 35 ms at 192 vs 5 ms at 64), and the suite's wall time is budgeted at ≤ 1.5× today's. `story/contract.test.ts` (SAVE_VERSION 4); `perf.test.ts` temporary budgets |
| WP-1 | `sim-districts.test.ts`; `power-equivalence.test.ts` (O2 on 50 random cities with disconnected consumers, zero-supply components and brownouts); `coverage-cache.test.ts` (O3: toggling every input matches an uncached pass); `recompute-around.test.ts` (on a freshly recomputed world, after an action, fields inside `rect ⊕ (12 − the largest stencil radius)` equal `recomputeAll`'s within 1e-6, traffic-derived pollution beyond the window not compared, and stats match); `turf-scale.test.ts` (O6's banded turf equals the full-map turf after the month on 20 random cities); `slice.test.ts` (a sliced day equals a whole `step()` exactly; stats publish only at slice C); `ruins.test.ts`; `megacity-fixture.ts` | `perf.test.ts` (§11.1 restored with p95 / max, megacity fixture), `fields`, `growth`, `budget` |
| WP-2 | `districts-terrain.test.ts`, `annex.test.ts` (determinism, batching: one `tiles` event per annex), `actions-districts.test.ts`, `skybridge-v2.test.ts` (K2 dense fixture, parcels as one anchor, the height rule's guarantees), `goals.test.ts`, `game-megacity.test.ts` (annex, buy, grants, the epilogue clock stub, lease, undo of bridges, frame finish, the frame cap and backlog with a fake clock, autosave never in a slice frame) | `vertical.test.ts`, `actions.test.ts`, `fuzz.test.ts` (new tools), `story/conditions.test.ts` (power terms) |
| WP-3 | `render-districts.test.ts` (fog, pins only with a grant, overview, the City map snap, minZoom, the skyline view's sprite cap, the district label), `render-passes.test.ts` (R1), parcel draw order | `render-ground.test.ts`, `render-roads.test.ts` |
| WP-4 | `building-variety.test.ts` (every kit body × style × tier × parcel × seed paints; the eligibility matrix floors; every new building, look and ending landmark; height bounds; V1 counts) | `building-art.test.ts` (look 0 equals today's recipes) |
| WP-5 | `citymap.test.ts` (model: states, price lines, sticky footer, lease gating, confirm, goals list), `ui-catalogue` (chips, metas, icons, the Legacy chip) | `input-gestures.test.ts` (silhouette first tap, badges, tube pick, pins) |
| WP-6 | `city-events.test.ts` (E1, fake clock, the per-sim-day cap), `life-fx.test.ts` (caps, LOD, settings) | `port-fx.test.ts` if traffic kinds shift |
| WP-7 | — | `story/content-lint.test.ts` (+11 cards, the universal spoiler scan, the pre-`ch4.drain` scan, lobby lines, the naming lint, glossary cap 22), `story/expansion-cards.test.ts`-style drawability for the 11 cards |
| WP-8 | `lasting-choices.test.ts`, `story/lasting-lint.test.ts` (§9.6) | `story/director` tests for the review paragraph |

### 11.6 Measured

*(Filled in by Step 9: the final §11.3 table, the on-device frame and speed-3 numbers with p95 and max, the measured phone factor from Step 0b, and whether O8 was needed.)*

---

## 12. Work packages

**Rules.** Step 0a, then Step 0b, land first, one agent each, alone. Then **at most two agents run at once**, in the waves below. Each package owns the files listed and edits nothing else; a change needed in another package's file goes into its hand-off note for Step 9. After Step 0b these are frozen: `types.ts`, `world.ts`, `events.ts`, `buildingStats.ts`, `districts/slots.ts`, `districts/migrate.ts`, `districts/layout.ts`, `story/types.ts`, the `TileInfo` shape, `src/game/parcels.ts` (rules and interface), `src/game/heights.ts` (interface and bounds; WP-4 may only regenerate `CLASSIC_TOPS`), `src/game/marks.ts` (interface), the service model id scheme, `elevOffset(world, x, y)` (returns 0), the parcel-aware draw call `drawZone(ctx, tile, parcel, env)`, `drawSkybridgeSpan(ctx, span, skin, env)`, the `makeLayers` / `makeLayerParts` additions in `story/mods.ts` (`parkAdd`, `pollutionAdd`, the `district` part), `Simulation.stepSlice`, the `marks.draw` call site in `render/story.ts` and the `EPILOGUE_DECK` spread. `config.ts` belongs to WP-1 (numbers only, no renames) during the waves and to Step 9 after. Every package ends with `npm run typecheck` and `npm test` green.

### Step 0a · Scale (one agent)

**Owns:** `src/game/config.ts` (§4 numbers, `POP_SCALE`, `CR_SCALE`, the density table, the megastructure premium, the "Fab Yards" name), `src/game/sim/tuning.ts`, `src/game/sim/census.ts` (the two demand floors only), `src/game/sim/advisor.ts` and `src/game/sim/incidents.ts` (thresholds, the payout slope and the "Fab Yards" strings only), `src/game/news.ts` (`minPop` / `maxPop`), `src/render/art/traffic.ts` and `src/render/art/skytraffic.ts` (one constant each), `src/game/story/content/chapters.ts`, `cards/undertow.ts`, `cards/nacre.ts`, `cards/board.ts` (thresholds and goal labels), `src/game/story/content/whispers.ts` and the note line in `story/director.ts` (the per-head crossing constant, §4.4), `content/factions.ts` (the two "Fab Yards" labels), `src/ui/tips.ts` (one string), `src/game/world.ts` (load: ×10 for saves without `scale`; write `scale: 10`). Tests: new `tests/megacity-scale.test.ts`; **first**, before any edit, generate and commit the pinned v3 fixtures `tests/fixtures/v3-expansion.json`, `v3-mayor-{2091,7,31}-y{3,8}.json`; then update every population expectation.
**Builds:** §4, in two commits: part 1 the units (S1 green at that commit), part 2 the density pass and megastructure premium (S4 measured, S2 and S3 green).
**Acceptance:** S1 (part 1), S2, S3 and S4 (part 2); the story pace tests unchanged in timing.

### Step 0b · World frame, districts contract, save v4, device check (one agent)

**Owns:** `types.ts`, `config.ts` (§3.2 tables, `DISTRICTS` copy verbatim from §3.7 and §8.2, `DISTRICT_PRICES`, `ANNEX`, `RUINS`, `PORT_LIMITS`, `SKYBRIDGE` v2 numbers, new `BUILDINGS` rows with `meta`, `desc`, gates and `height` / `roof`, the ending landmark rows, `CROWNS` additions, `FACTION_BUILD_REACTIONS`, `POWER_WEIGHTS` keys, `TURF.affinity` keys, `EDGE_LINKS.perDistrict`, `CITY_LIFE`), `events.ts`, `world.ts` (frame, district state, slots, segments, batched `annex`, `setTerrain` (owned only), `setGround`, invariants, v4 serialize / deserialize with tile blocks, `cityEvent`, `conductorVersion`, `coverageVersion` and `terrainVersion` bumps), `buildingStats.ts` (new types; frames and the pump hall inert), new `src/game/parcels.ts`, `src/game/heights.ts` (with `CLASSIC_TOPS` generated from today's art), `src/game/marks.ts` (stub), `src/game/districts/slots.ts`, `migrate.ts`, `layout.ts` (§3.6.2 in full), `terrain.ts` (the start generator moved in bit-identically, plain-noise stubs for the kinds), in `sim.ts` only the `districtDaily` hook, a `stepSlice` that runs whole days and a `recomputeAround` that calls `recomputeAll`, in `census.ts` / `sim/ports.ts` only the `cityEvent` read sites; `story/types.ts` (metrics, `CrownId`, effect `grant`, the `slot:<kind>` target, gate fields including `ending`, `InspectAction` ids `'frame' | 'bridgeRemove' | 'map'`, `VerticalCache.lobbies` and `.lobbyVisitors`, `StoryState.endingHistory` and `.callbacks`, `VisualState.marks`), `story/encode.ts` (the two fields), `story/conditions.ts` and `content/vocab.ts` (metrics), `story/effects.ts` (`grant` only), `story/director.ts` (`onAnnex`, the ending's grant, `endingHistory` on `setEnding`), `story/content/chapters.ts` (`grant 1` in every reward), `story/content/cards/index.ts` (the empty `EPILOGUE_DECK` spread), `game.ts` (save safety: versions, `.v2` / `.v3` by source version, future-save rule; `annex` / `buyDistrict` stubs; the `cityEvents.update(dt)` call in `Game.update`), new `src/game/cityEvents.ts` (a no-op with the final signature, WP-6 fills it), placeholder art entries in `render/art/services.ts` (new types reuse existing recipes) and `render/overlay.ts` (`EFFECT_RGB` for `resilience`, `filter`), the **minimal render frame** (in `camera.ts`, `renderer.ts`, `ground.ts`: camera bounds of the owned box ± peek, `minZoom`, `fitMap` to the owned box, the sweep clipped to the owned box, the overview over the owned box), the frozen draw signatures (`drawZone` with a parcel, `drawSkybridgeSpan`, `marks.draw` → a no-op `art/marks.ts`), the service id scheme in `render/buildings.ts`, and the frame-size assertion. Tests: §11.2 and the frame port (§11.5).
**Device check (before the frame is frozen):** run the 192 prototype benchmark (the scratch `opt192` bundle and the review's `frames.ts`, wrapped in a `bench.html` page) on the reference phone, or Chrome with 4× CPU throttling: whole-day step, sliced frame p95 and max, month-end frame, autosave frame including `localStorage.setItem` of a 240 KB string, `Game.restore`. Record the measured phone factor in §11.6. **If the factor exceeds 4.5 or the p95 day exceeds 12 ms on the device at 9 districts, O8 becomes a WP-1 item** (§3.3) before Wave 2.
**Perf note:** until WP-1, a one-district world still pays the empty-area cost (§2.3); Step 0b raises `tests/perf.test.ts` to step < 5 ms and recompute < 15 ms with a comment naming WP-1, which restores §11.1.
**Acceptance:** §11.2 green; a v3 city loads, plays and saves on the 192 frame and looks the same (start slot, names, props, camera, overview), because the minimal render frame lands here; a new city starts on the identical start map.

### Wave 1 (two agents)

#### WP-1 · Sim at scale
**Owns:** `src/game/sim.ts`, `src/game/sim/*.ts`, `src/game/story/turf.ts`, `src/game/story/mods.ts`, `config.ts` (numbers). Tests per §11.5. **First:** prototype O6 in the scratch copy and confirm the month-end frame bar (§3.3).
**Builds:** O1–O7 (O8 if Step 0b's trigger fired); tick slicing (`stepSlice`) and the spread month end; the district sim rules of §3.3 (layers `parkAdd` / `pollutionAdd`, floodplain cap, ruins, brownfield clearing, demand adds, the turf demand term per district, per-district census, `resilience` and `filter`, local terrain-value recompute on `terrain`, Seaport `shoreSites` refresh, the Metro network, Sky Lobby and landmark visitors in `PortSystem`, `cityEvent` terms, port limits); turf affinity terms for the Bazaar, frames and the Sunk; regional links on the boundary (§3.5) in `SimGrid`; `recomputeEconomy`.
**Acceptance:** §11.1 sim and story budgets with p95 and max; the equivalence tests (power, coverage, slices, turf, recomputeAround, field identity); every existing sim, story and balance test green.

#### WP-2 · Districts gameplay, actions, Game and skybridge rules
**Owns:** `src/game/districts/terrain.ts` (generators), `annex.ts` (content placement, batched, own Rng), `effects.ts` (district layer part, `clearBrownfield`, `clearRuins`, `drainReeds`, `apron`), `daily.ts` (Pump Houses, king tides), `goals.ts` (district goals); `src/game/actions.ts` (locked tiles, district costs, the new building rules: flat footprint, water and shore sites, district-bound and ending landmarks, the pump-hall radius, sponsor, frame finish, ruin restore pay); `src/game/game.ts` (annex, buy, grants, the epilogue grant clock, lease, `districtView()` for the City map, `getTileInfo` additions with parcels and heights, `inspectActions`, toast `'map'`, skybridge source / plan / apply with undo, the frame cap and backlog); `src/main.ts` (autosave off the month tick); `src/game/story/vertical.ts` (skybridge v2, partners, routes, lanes, payoff, Sky Lobbies, parcels as anchors, owned segments, the "dark" news line); `src/game/story/factions.ts` (power terms). Tests per §11.5.
**Acceptance:** D2, D3, D5, D6, K1, K2; every rule of §3.4, §3.5, §5.3 and §6.3 has a test; the fuzz test is green with the new tools.

### Wave 2 (two agents)

Interfaces fixed before the wave (Step 0b): `parcels.ts`, `heights.ts`, `drawZone(ctx, tile, parcel, env)`, `drawSkybridgeSpan(ctx, span, skin, env)`, `marks.ts`.

#### WP-3 · World view
**Owns:** `src/render/renderer.ts`, `ground.ts`, `camera.ts` (additive), `overlay.ts`, `src/render/story.ts`, new `src/render/atlas.ts`, `src/render/art/skyway.ts` (only for crossings), the boundary spawn rule in `src/render/art/traffic.ts` (that rule only, §3.5), `src/ui/start/showcase.ts` (release on close).
**Builds:** §3.9 (fog, boundary line, pins, the three view bands and the City map snap, overview, atlas, sweep clip, district label, district ground character, Terraces contour shading and wall decals), **R0** (every whole-map render pass made incremental or clipped, with WP-6 taking `effects.ts`' `StreetTraffic` in Wave 3 under the same rule), the skybridge ghost tubes, see-through pass, badges, route ghost and crossing order (§5.4, §5.6 depth), parcel caching and sort keys.
**Acceptance:** visual checks at 390×844, 360×640 and 844×390, day and night, zoom 0.22 / 0.3 / 0.4 / 1 / 2.5: fog and boundary readable, pins tappable, no seams at slot borders; **at zoom 0.3 by night, crowns, Spires and landmarks are identifiable**; the City map snap both ways; R1; the frame budget with the megacity fixture.

#### WP-4 · Building art
**Owns:** `src/render/buildings.ts`, `art/painter.ts`, `art/zones.ts`, `art/sprites.ts` (the cross-family fallback rule), new `art/kit.ts`, `art/styles.ts`, `art/faction.ts`, `art/landmarks.ts`, `art/legacy.ts`, `art/services.ts`, `art/story.ts`, `art/vertical.ts`.
**Builds:** the kit, its eligibility matrix and styles with their own silhouettes (§6.1), service looks by style, parcel drawing, the generic fallback, the LOD collapse, faction languages with their designs, signatures, standing light and where they apply, look 0 = today's art (§6.2), art for every new type (§6.3) including the pump hall's looks, the five ending landmarks with past looks and the faction tower bodies (§9.2), the skybridge skins and walkers (§5.6), the height bounds.
**Acceptance:** V1; every body and look renders in the sweep test; a migrated city keeps its palettes and today's Spires, crowns and faction buildings; Basalt, Nacre, Board, Undertow, Kites and Tuning designs are told apart in a side-by-side capture at zoom 0.5 by day and by night; the nine districts are told apart in a side-by-side capture at zoom 0.5 by day and by night; the per-style **contact sheets** are delivered for review before Wave 3.

### Wave 3 (two agents)

#### WP-5 · UI, input and audio
**Owns:** `src/ui/*` (new `ui/citymap.ts`), `src/input/*`, `src/audio/audio.ts`.
**Builds:** §7 (chips including Legacy, rumoured cards, metas, City map and annex sheet with the sticky footer, vignette and goals, the map button rules, goal-chip token, the skybridge tool flow with the silhouette first tap, inspect additions, the Spire sponsor step and the crown look picker, settings including City life, tips, help), §10.
**Acceptance:** §7.8.

#### WP-6 · Life and atmosphere (**droppable as a package**)
**Owns:** `src/render/effects.ts`, `art/traffic.ts` (all but the boundary spawn rule), `art/weather.ts`, `art/skytraffic.ts`, `art/fx.ts`, new `art/crowds.ts`, `art/boats.ts`, `art/festival.ts`, `src/game/cityEvents.ts` (fills Step 0b's stub).
**Builds:** §6.4, and R0 for `StreetTraffic.rebuild` (dirty rects). If dropped: `world.cityEvent` stays null, `Settings.weather` maps to today's rain, R0 for `effects.ts` is still done by Step 9.
**Acceptance:** E1; the life budget of §11.1; every item obeys low quality and the settings.

### Wave 4 (two agents)

#### WP-7 · Story content (cards **droppable**)
**Owns:** new `src/game/story/content/cards/megacity.ts`, `content/factions.ts` (drivers, `POWER_TERMS` rows), `content/glossary.ts` (Skybridge text, the two new entries), `story/effects.ts` (`brownfield clear`, `ruins clear`, `reeds drain`, `apron`, the `slot:<kind>` turf target), `tests/story/content-lint.test.ts`, and `docs/STORY.md` (the **single owner** of STORY.md in this update: a "Megacity" subsection on districts, land grants, the new crowns and landmarks, the cards and §9's marks; population numbers ×10).
**Builds:** §8.3, §8.4's content rows, §8.6.
**Acceptance:** content lint green; each card drawable in a world that meets its `when`; the playthrough reaches Ch6 on every pace. If the cards are dropped, the lobby lines, annex reactions, grants and rescale (Step 0a / 0b) still ship.

#### WP-8 · Choices that last (core)
**Owns:** `src/game/marks.ts` (fills Step 0b's stub), new `src/render/art/marks.ts` (decals), new `src/game/story/content/epilogue.ts` (review lines), new `story/content/cards/epilogue.ts` (the `EPILOGUE_DECK`), `content/tokens.ts` (`{seamPast}`, `{votePast}`, `{logsPast}`), `story/director.ts` (the review paragraph, `story.callbacks`), the epilogue grant clock's delivery line in `game.ts` (handed over from WP-2), new `src/ui/story/keepsakes.ts` and its mount in the goal drawer (handed over from WP-5), `tests/lasting-choices.test.ts`, `tests/story/lasting-lint.test.ts`.
**Builds:** §9 (the art of the landmarks and tower bodies is WP-4's, Wave 2).
**Acceptance:** §9.6's tests; a post-ending playthrough on each of the five endings shows its skyline takeover, its landmark in the Legacy chip and at least three marks from §9.3 with their plaques.

### Step 9 · Integration, balance and performance (one agent, last)
**Owns:** `config.ts` (megacity numbers, `DISTRICT_PRICES` from D1), `tests/megacity-measure.test.ts`, new `tests/megacity-balance.test.ts` (D1 short form, one seed, in the regular suite), `tests/megacity-fixture.ts` (extends WP-1's), `public/sw.js` (`VERSION` bump), `docs/MEGACITY.md` §11.6, `docs/CONTRACTS.md` (a "Megacity layer" section: the frame, slots and segments, save v4, the new modules and events), `docs/DESIGN.md` (the interview decisions, "prices kept at per-building parity", the choices-that-last request), `docs/EXPANSION.md` (population numbers ×10 with a note), and the cross-package fixes from the hand-off notes.
**Builds:** §11.4; tunes to §11.3; the final **device check** (frame rate at 9 districts, sim share at speed 3, p95 and max); `npm run build:single` and a single-file run; loads v1, v2, v3 and v4 saves; a stale v3 build opened on a v4 save leaves it intact.
**Acceptance:** every §11.3 target met or waived in §11.6 with a reason; all tests green.

### After Step 9 (optional) · Raised terrace steps
One agent, only if the owner wants real raised hills after seeing the contour version. Every layer drawn on a tile offsets by `elevOffset(world, x, y) = elev × 8`: ground plates and retaining-wall faces (`ground.ts`), zone and building sprites (`buildings.ts`), cars and crowds (`art/traffic.ts`, `art/crowds.ts`), boats (no change: water is step 0), rail viaducts (28 px) and skyway decks (52 px) with their ramps (`render/story.ts`, `art/skyway.ts`), skybridge tubes (tube top = min over the anchors of `roofOf + elev × 8` − 6), overlays, ghosts and highlights (`overlay.ts`, `highlight.ts`), the atlas prisms, and picking (`input/*`: test the up to three tiles in front of the ground hit whose raised diamond contains the point). Rules that already hold from Step 0b: parcels never span two steps; a skyway or rail span may not change step.

### Order and what can be dropped

```
Step 0a ─► Step 0b (+ device check) ─► Wave 1: WP-1 Sim ∥ WP-2 Districts/actions/Game
                                    ─► Wave 2: WP-3 World view ∥ WP-4 Building art
                                    ─► Wave 3: WP-5 UI/input/audio ∥ WP-6 Life & atmosphere
                                    ─► Wave 4: WP-7 Story content ∥ WP-8 Choices that last
                                    ─► Step 9 Integration ─► (optional) raised terrace steps
```

| Item | Package | If dropped |
|---|---|---|
| Life and atmosphere (whole package) | WP-6 | `cityEvent` null; weather = today's rain |
| Story cards (the 11 megacity cards) | WP-7 | the deck is unchanged; lobby lines, reactions, district effects remain |
| Optional epilogue cards (the five ending-landmark cards), the optional marks of §9.3, the smile that follows the camera, the live ledger text | WP-8 | the core marks, review lines and five core epilogue cards remain |
| Raised terrace steps | after Step 9 | contour shading (core) stays |
| Optional landmarks (Hullhouse, Lamp Choir, Grand Terminal) and services (Market Hall, Tidal Turbine, Geothermal Bore, Data Vault) | WP-2, WP-4 | their `BUILDINGS` rows get `hidden: true` (never in trays); their district goals hide; contract rows stay |
| Haze, drones, ambience, chimes, Kite Day, Parade | WP-6 | — |
| O8 sleeping districts | WP-1 | built only if Step 0b's trigger fires |

Not droppable: Step 0a (both parts), Step 0b, WP-1, WP-2, WP-3, WP-4 (kit and matrix, style silhouettes, parcels, faction languages, look 0, core landmarks, ending landmarks), WP-5, WP-8's core.

---

## Appendix A · Copy: tips, descriptions and meta lines

Tips (≤ 110 chars, EXPANSION §7.6 rules; all checked with `rev/check3.mjs` or `copy/check.mjs`):

| id | Text |
|---|---|
| grant | You earned a land grant. Open the City map to choose where your city grows next. |
| citymap | Tap a district next to your city to see its land, perks, goals and who wants it. Annexing uses one grant. |
| annexed | Roads, power and services cross into the new district like anywhere else. Inspect shows its perks. |
| skybridge | Tap a tall tower: its lanes light up at bridge height. Anything lower passes under. Skyways are for cars. |
| skylobby | Three linked towers make a Sky Lobby: fewer car trips, higher land value and visitors. |
| frame | Skeleton Row's frames are half-built towers. Tap one to finish it as a Stratablock. |
| pumphouse | Pump Houses raise the canals around them into new land, one ring a month. |
| sponsor | Choose who pays for this Spire. The sponsor's style, jobs and power go with it. |
| legacy | Your ending has its own landmark now. Find it under Deals, in the Legacy chip. |
| floodplain (sim) | Reedmere's floodplain stops at level 2. A Floodwatch Station lets it grow tall. |
| brownfield (sim) | Kessel Flats' brownfield smog fades as the soil is built on, or under parks. |
| ruins (sim) | Ruins come back as homes once a road reaches them and the power is on. |

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
| terminal | The grand station where every line meets. Widens every station's reach. | 4×4 · transit hub |
| gantry | A gantry crane over a works yard. Its cab is a quota board. One window never lights. | 4×4 · Fab jobs |
| glasssmile | A pearl sphere on a slim stem. At night its whole face smiles your smile. | 3×3 · visitors |
| breadpier | A long pier market under one canopy: half nets, half kites, one long table. | 4×4 · shore · stalls |
| recordtower | A stone tower whose four faces scroll the city's accounts, live, line by line. | 3×3 · approval |
| stillsquare | A quiet square around a great balance. Its pans always hang level. | 3×3 · park |
| frame | An unfinished tower frame. Finish it as a Stratablock. | (never in a tray) |
| pumphall | The old pump hall on the causeway, where the storm logs were found. (inspect only, after the Sunk opens) | (never in a tray) |

Links metas (one job each, §5.2): Skybridge "Walkway · tap 2 towers", Ribbon Rail "Trains · drag", Skyway "Cars · drag".

## Appendix B · News and advisor lines

Owners: `annex`, `grant`, `goal` (WP-2, Game), `lobby` and `dark` (WP-2, `vertical.ts`), the City life lines (WP-6, `cityEvents.ts`), the advisor rows (WP-1, `advisor.ts`). In a city of more than one district, every line that names a neighbourhood with `{district}` appends the district short name ("Paper Lane, Verdigris").

| Key | Kind | Cooldown | Text |
|---|---|---|---|
| annex | good | once per district | "{city} grows: {name} joins the city." |
| grant (epilogue) | good | per grant | "A land grant arrives: the city may annex again." |
| goal | good | once per goal | "{name}: {goal}. +{reward} CR" (e.g. "Kessel Flats: two Seaports on the basin. +25,000 CR") |
| edge | info | once | "The city reaches the edge of the region." |
| lobby | good | once per lobby (the first lobby gets the banner instead) | "Three towers in {district} are one Sky Lobby now: {name}." |
| dark (reworded) | warn | as today | "Skybridge dark: an anchor dropped below the skyline." |
| milestone (new rows) | good | once | generated as today ("Night Harbour! {city} passes 600,000 residents…") |
| nightmarket | info | per happening | "Night market in {district} tonight: paper lanterns from one end of the street to the other." |
| lanterns | info | per happening | "Lantern night: the whole city sends paper lights up over the water." |
| stormwatch | info | per happening | "Storm watch: flood barriers up along the shore. Stay off the piers." |
| arenanight | info | per happening | "Match night at the Arc Arena. The stations are full and the streets are louder." |
| kiteday | info | per happening | "Kite day: diamond kites over {district}. Nobody admits who made them." |
| parade | info | per happening | "Parade on the avenue in {district}. Confetti in every gutter by midnight." |
| floodplain | warn | 240 d (≥ 20 capped tiles) | "Advisor: Reedmere's floodplain holds homes at level 2. A Floodwatch Station lifts the limit." |
| brownfield | info | 300 d | "Advisor: brownfield smog over Kessel Flats. Build on it, or add parks and a Reclaim Works." |
| ruins | info | 300 d (≥ 40 ruins) | "Advisor: ruins in the Sunk come back as homes with a road and power." |
| bridges (optional) | info | 360 d (≥ 6 aligned unbridged pairs) | "Advisor: {n} pairs of tall towers line up for skybridges." |

## Appendix C · Decisions and rejected alternatives

1. **Growing world** (resize on annex): every stored tile index would be remapped mid-game; rejected for a fixed 3×3 frame (§3.1).
2. **4×4 grid:** 14–15 ms a step fully built today, ≈ 28 ms on a phone optimised; rejected (§2.7). Nine districts still reach 4–5 M residents. Growing past nine is an owner question (Appendix E).
3. **Separate sims per district:** every system crosses borders; rejected.
4. **Merging Skyways and Skybridges:** different users, heights and gestures; one tray line could not explain a merged tool. They now coexist on the same tiles, and the Links chip gives each of the three links one verb (§5.2).
5. **Skybridges at any angle:** in this projection a bridge along (1, 1) points at the camera and reads as a column; two-bridge routes solve reachability with axis-aligned spans.
6. **A story card for each annex:** an interruption; the City map is opened by the player, the grant waits in the reward message, and the lobbying lives on the sheet.
7. **A unique sprite per tile:** ≈ 250 bodies × 120 KB per screen and unbounded painting; the kit is a bounded library (44 templates × 4 parameter variants) with a warm fallback.
8. **District capacity perks** (e.g. Bazaar Market jobs ×1.15): would touch the four capacity consumers EXPANSION unified; visitors instead.
9. **Water utility, service capacity limits:** not asked for, new balance surface; rejected.
10. **Steeper capacity per level for homes** (Hab L3 ×20): re-tunes growth gates, power and the story's pacing. Instead the density pass raises jobs per tile for shops and fabs (the owner's "businesses don't provide enough jobs") and gives megastructures a premium (§4.1, §4.2).
11. **Buying districts before the ending:** the owner said the sandbox; grants cover the campaign, and a stalled chapter still ends through its fallbacks.
12. **Real raised elevation:** render and picking cost across six layers and four packages; Highstep Terraces get contour shading, painted walls and stairs, and raised steps are an optional package after Step 9 (§12).
13. **Saving locked slots, or keeping number arrays:** regenerated land costs nothing to store; structural RLE saved only 17%, but 3-byte base64 tile blocks save about a third and round-trip 2.5× faster (§3.10).
14. **Sleeping districts as an afterthought:** now a planned contingency with a measured trigger in Step 0b (O8).
15. **A Bazaar lease on the annex sheet:** one contest in one place; the gangs' dispute lives in `ds.bazaar`, and only Tarmac Reach has a lease.
16. **Scaling story lore numbers:** the 11,000 and 90,212 are history, not city size; unchanged.
17. **Parcel hysteresis** (stay merged once merged): needs saved state. Leaving level and tier out of the merge rule gives the same stability with a pure function (§6.1).
18. **A magnified atlas between zoom 0.15 and 0.4:** a 0.1-scale impostor would be upscaled 5–8× exactly where the skyline should impress; the skyline view keeps real sprites there and the atlas only shows at 1:1 on the City map (§3.9).
19. **Keying every Sunk text to the reveal:** two versions of every line, and Pump Houses could still drain the Sunk before Chapter IV; opening the Sunk only after `ch4.brine` makes one post-reveal version enough (§3.7).

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
| `opt/`, `opt64/`, `opt192/` | the prototype patch (power labels, allocation skip, coverage cache, 4-phase stagger) and its bundles (§2.4); its power fill is **not** equivalence-safe (§3.3 O2) |
| `copy/check.mjs`, `copy/check2.mjs` | length, banned-term, `!` and spoiler checks for the draft's copy in §3.7, §8 and Appendices A–B |
| `critic/frames.ts`, `critic/o192/` | per-day `step()` + `onDay()` and month-end frame percentiles on today's code and the prototype (§2.6) |
| `critic/n192/render.ts`, `critic/n192/savesize.ts` | whole-map render rebuild costs; save size with tier and ground bits and the 3-byte base64 alternative (§2.6) |
| `critic/a192/gen.ts`, `critic/a192/heap.ts` | `Game.restore` phases and retained memory at 192 (§2.6) |
| `rev/heights.ts`, `rev/heights2.ts` | zone and building art heights from today's recipes (§2.6, §5.3) |
| `rev/check3.mjs` | length, banned-term, `!`, spoiler and pre-`ch4.drain` checks for the revision's copy (§3.7, §8.2, §8.3, §9, Appendix A) |

## Appendix E · Decisions on the review

Two reviews of the draft (a player and design critique, and an engineering critique) were resolved in this revision. Every high and medium issue is addressed; the cheap low ones are done. Where the fix differs from the one suggested, the reason is given.

**Player and design review**

| # | Severity | Issue | Resolution |
|---|---|---|---|
| 1 | high | ×10 units keep "not enough jobs": half the land is shops and fabs | **Done, numbers chosen here:** a density pass (Market 380 / 1,250, Fab 450 / 1,200 at L2 / L3) targets ≈ 60% Hab, 20% Market, 20% Fab instead of the suggested 55 / 25 / 20, because 55 / 25 / 20 would leave Market capacity at today's ratio and change only Fab. Tax per job stays (so money per resident is unchanged); S4 measures the land mix; inspect shows jobs (§4.1, §4.2, §4.6). |
| 2 | high | Few templates per tall cell, one quad template, no per-tile seed | **Done:** an eligibility matrix of 44 templates with ≥ 6 single and ≥ 4 pair / quad bodies per cell, uniform picks, a 2-bit per-tile seed (4 variants each), V1's 15% and r = 2 rules, contact sheets (§6.1). |
| 3 | high | Skybridge clearance blocks L2; parcels are not one anchor | **Done:** `parcels.ts` and `heights.ts` game-side; a parcel is one anchor; the tube rule is stated with measured art (L2 ≤ 84 passes under L3 anchors ≥ 128); K2 uses a dense downtown fixture (§5.3, §6.1). |
| 4 | high | The 0.1 atlas blurs the skyline from the first annex | **Different fix:** instead of a baked middle LOD in the ground cache (which would need night variants and a repaint per growth tick), a skyline view keeps real sprites for tall things down to zoom 0.22 and draws L1–L2 as roof tints; the atlas is shown only on the City map at ≥ 1:1. Acceptance at zoom 0.3 by night added (§3.9, §12 WP-3). |
| 5 | high | Migration re-skins today's Spire, crowns and faction buildings | **Done:** look 0 of every family is today's art; missing `look` → 0; today's Spire is Nacre look 0 "Facet"; a migration test (§6.2, §11.2). |
| 6 | high | The reveal is Chapter IV; Sunk copy contradicts Brine; salvage profits from the drowned; `ch4.drain` can land in an owned Sunk | **Different fix:** rather than keying every text to the reveal, **the Sunk opens only after `ch4.brine`**, so all its copy is post-reveal and written once, no Pump House can drain it before Chapter IV, and `ch4.drain` never meets an owned Sunk. Salvage is replaced by pay for restoring a ruin; "Clear the ruins" is harsher; the old pump hall stands in the Sunk as a fixed hall with a Pump House exclusion radius (§3.7, §8.3, §8.6). |
| 7 | medium | Ruins trip the abandonment systems | **Done:** ruins (zoned, abandoned, ground Rubble) are their own metric, excluded from `abandoned`, the advisor, "Dark lots" and the abandoned cards; half-weight blight; their own advisor line (§3.3). |
| 8 | medium | Budgets are averages; atomic spikes | **Done** with the engineering review's #1 (below). |
| 9 | medium | Megastructures less dense than the towers beside them | **Done:** Hab Core 32,000, crowns +6,000 / Commons +10,000, Arcology 40,000, Spire 8,000, Hexworks 20,000, Pearl Atrium 18,000, with power and upkeep adjusted, and the 1.5× assertion in S4 (§4.2, §6.3). |
| 10 | medium | Port limits don't scale; perks moot | **Done:** `PORT_LIMITS` (Seaports 2–4, a second Airport in Tarmac Reach from 4 districts) (§3.5). |
| 11 | medium | Sandbox prices are seconds of income; no land goal after 9 | **Done:** fixed prices set from D1's measured income (placeholders 2.5M and 4M), epilogue grants (§3.8, §9.5), the region-edge line and a sandbox goal ladder (4M milestone, district goals, the landmark set and the five ending landmarks). Growing past nine is an owner question (below). |
| 12 | medium | "Charter" names six things; glossary cap | **Done:** the token is a **Land Grant**; glossary cap 22 with "Districts and grants" and "Sky Lobby"; the zone is renamed **Fab Yards** on screen (§0, §8.4). |
| 13 | medium | Skybridge lanes hidden by towers; badge clutter; multi-tile lanes; first tap | **Done:** ghost tubes at bridge height, see-through buildings, decluttered badges (green full, red 16 px dots, routes behind a chip, ≤ 8), auto-fit, lanes per footprint row and column, silhouette hit-test (§5.4, §7.4). |
| 14 | medium | Annexing lacks short-term purpose; previews don't sell | **Done:** 2–3 district goals per district, a night vignette on the sheet, a district name label on crossing a border (§3.7, §7.2, §3.9). |
| 15 | medium | Sheet footer can scroll away; HUD button fit; permanent pins | **Done:** sticky footer, 2-line quotes, the map button only from 375 px with a HUD fit test, pins only while a grant waits or a purchase is affordable (§7.2, §7.3, §3.9). |
| 16 | medium | District styles are only paint | **Done:** 2–3 own silhouettes per style with a ≥ 25% share, a 9-district capture, service looks by style for four services (§6.1). |
| 17 | medium | Faction towers need life; pickers underspecified | **Done:** a live signature per language, standing-based night light, the crown and Spire pickers specified (§6.2). |
| 18 | medium | Terraces elevation touches six layers | **Done:** contour shading is the default; raised steps are an optional post-Step 9 package with the full layer list; the parcel, skyway and rail step rules hold now (§3.7, §12). |
| 19 | low | D1 mixes clocks | **Done:** PACING harness to Charter Night + 60 min, per-chapter targets, a speed-3 variant and the 85%-developed stall check (§11.3). |
| 20 | low | Event durations vs sim time; name clash; lanterns; "slot" | **Done:** "City life" with its own toggle, gameplay capped at 60 sim days per happening, the lanterns and "every third gap" wording (§6.4.1). |
| 21 | low | Card copy promises changes that don't happen; `ds.bazaar` overlaps `x.corner` | **Done:** `turf … slot:skeleton`, `reeds drain`, the apron families placed at annex with `apron rehouse` / `apron clear`; `ds.bazaar` retitled and set before the Seam's market (§3.7, §8.3, §8.4). |
| 22 | low | Sky Lobby visitors outdraw ports; banner wording | **Done:** 1,000 × (k − 2), ≤ 6,000 a lobby, ≤ 30,000 city-wide; first-lobby banner only (§5.5, §1.4). |
| 23 | low | Three links and four stations without one job each | **Done:** Ribbon Rail added to §5.2's table, one meta per link, the Metro "links districts" with lines on the City map, the Grand Terminal's unique ×1.5 station radius (§5.2, §6.3). |
| 24 | low | Name collisions; Lamp / Lantern overuse; event lines | **Done:** Lantern Terraces → **Highstep Terraces**, Copperline Bazaar → **Verdigris Bazaar** (the start list keeps "Old Copperline" and "Lantern Row"), Brine Steps → Shell Bar, Lamp Key / Steps / Bridge renamed, milestones Million Windows and Neon Coast, the naming lint, district short names in event lines (§3.7, §4.5). The district rather than the start list was renamed so existing cities keep their neighbourhood names. |
| 25 | low | "Sealed" in skybridge copy; lint scope; stormwatch | **Done:** "Dark" on screen and in the news line, the lint covers notes, reasons, toasts and tips, stormwatch barriers only on owned Shoals and Sunk shores and on Charter Shore after `ch4.logs` (§5.3, §8.6). |
| 26 | low | "Every price rescaled" is an interpretation | **Done:** stated in §0's table and for DESIGN.md as "prices kept at per-building parity; confirm with owner", with a `CR_SCALE` knob. |

**Engineering review**

| # | Severity | Issue | Resolution |
|---|---|---|---|
| 1 | high | Step and month-end spikes; synchronous autosave; ×3.5 checked too late | **Done:** p95 / max budgets per frame, tick slicing (A / B / C), the month end spread over days 1–4, autosave in an idle frame, a device benchmark in Step 0b with an O8 trigger (§3.3, §11.1, §12). The suggested 2–3 frame pipeline is the slicing; budget settlement stays on the month-end tick because its projection is precomputed (O7). |
| 2 | high | Render-side whole-map passes in no budget | **Done:** R0 in WP-3 (and WP-6 for `effects.ts`), a §11.1 row and R1's pass-count test (§3.9). |
| 3 | medium | O2 power fill not equivalence-safe | **Done:** the fill specified exactly (`remain = supply − demand`, zero-supply without BFS, BFS only when 0 < supply < demand) and a 50-city equivalence test (§3.3). |
| 4 | medium | O3 coverage key incomplete | **Done:** `coverageVersion` plus mods and layer versions; a toggle test (§3.3). |
| 5 | medium | Anisotropic blur edge; world-coordinate terrain noise breaks S1 | **Done:** one rule, a locked tile is out of bounds for every stencil; terrain-value noise and `TerrainInfo` hashes from `artXY`; a slot-4 field identity test (§3.3, §3.2, §11.2). |
| 6 | medium | Caches assume terrain never changes; reclamation on locked tiles | **Done:** `terrainVersion` and a `terrain` event with local recomputes; the district part rebuilt at most once a day; reclamation only on owned tiles (§3.2, §3.3). |
| 7 | medium | O6 not prototyped; per-candidate scans may be slower | **Done:** prototype before WP-1; separable dilations over owned segments on typed mirrors, banded over days 1–4 with a double buffer; the whole month-end frame budgeted (§3.3). |
| 8 | medium | Zoomed-out ids, memory and paint; fallback ignores the budget | **Done:** V1 / P1 at zoom 0.55 and 0.4 on the device, the LOD collapse, bucketed scales below 0.55, a cross-family fallback rule in `SpriteCache`, the 300 ms target restated in frames (§6.1). |
| 9 | medium | Service ids overflow; wrong safe-id bound | **Done:** `SERVICE_KIT_BASE` scheme frozen in Step 0b, a disjointness test, the bound corrected to ≈ 3·10¹⁰, `zoneHeights` → `Map` (§6.1). |
| 10 | medium | Parcels × anchors; merge popping | **Done, different mechanism:** parcels game-side and one anchor, as suggested; instead of hysteresis (which needs saved state), the merge rule leaves out level and tier and draws at the lowest member's (§6.1, Appendix C 17). |
| 11 | medium | Tube edge ambiguous; crossGap < tube | **Done:** top and bottom defined, the inequality as a contract test, `crossGap` 20 (§5.3). |
| 12 | medium | Missed per-head constants and area-scaled terms; ruins in `abandoned` | **Done:** crossings note from Σ walkers, the turf demand term per district, owned-land turf denominators, ruins excluded, the per-tile-term lint (§4.4, §3.3). |
| 13 | medium | Ruins collapse within minutes | **Done:** ruins never collapse; D2 asserts ≥ 90% stand after 2 sim years (§3.3, §11.3). |
| 14 | medium | The Sunk before Chapter IV | **Done:** the Sunk opens only after `ch4.brine` (stricter than the suggested `ch4.drain`, so the reveal itself has played); the pre-`ch4.drain` regex; a pace test (§3.7, §8.6, §11.3). |
| 15 | medium | Load and heap budgets unrealistic; Showcase doubles the world | **Done:** restore ≤ 120 ms in Node plus a device check; only locked slots and border strips generated; fbm cached per slot; the Showcase released; the heap row corrected to ≈ 15 MB (§3.6.1, §3.9, §11.1). |
| 16 | medium | Atlas unreachable by pinch; pan fallback | **Done:** pinch-out at `minZoom` snaps to the City map; the overview is a transient fallback at ≥ 0.2 device px per world px over the visible region (§3.9). |
| 17 | medium | Cross-package items without owners | **Done:** Step 0b freezes `elevOffset`, `drawZone` with a parcel, the `makeLayers` additions, `stepSlice`, the marks call site; elevation downgraded to contour shading; boundary spawns to WP-3 in Wave 2; per-head copy constants to Step 0a; STORY.md owned by WP-7 only (§12). |
| 18 | medium | The build between Step 0b and WP-3 can't look the same | **Done:** the minimal render frame moves into Step 0b (§12). |
| 19 | medium | `recomputeAround` test fails by construction; missed callers | **Done:** the test defined on a fresh world inside `rect ⊕ (12 − max stencil)`, a full pass scheduled when traffic outside moves, `recomputeEconomy` for the tax sliders, callers listed by WP-1 (§3.3, §11.5). |
| 20 | low | Save size without ground bits; only RLE compared | **Done:** 3-byte base64 tile blocks, budget 260 KB measured with tiers and ground (§3.10). |
| 21 | low | Migration edge cases | **Done:** migrate only `version ≤ 3`, backups by source version, a future-save rule for odd sizes, `previousSaveInfo` ×10, `annexedAt` by SlotId (§3.10, §11.2). |
| 22 | low | 31 files, not 21; suite time | **Done:** the 32 files matching the grep are listed, slot-local helpers, cached fixtures and a suite-time budget (§11.5). |
| 23 | low | Annex fires thousands of events and draws from `world.rng` | **Done:** batched annex with one slot touch, its own Rng, a determinism test (§3.2, §3.8). |
| 24 | low | Frames clear Kites turf | **Done:** `frame` joins both turf-keeping sets (§3.7). |
| 25 | low | Backlog 32 ticks | **Done:** kept at today's 4 (6 only if the device shows calendar loss) (§3.3). |
| 26 | low | `Uint16Array` limits | **Done:** a static assertion in Step 0b (§3.1). |
| 27 | low | Atlas repaint hitches | **Done:** progressive row bands ≤ 2 ms a frame, only when the map opens and on annex (§3.9). |

**Open questions for the owner** (only ones that change what gets built):

1. **More than nine districts in the sandbox?** The plan stops at a 3×3 region (≈ 4–5 M residents): after the ending, two more land grants arrive (about 48 minutes on Relaxed) or can be bought, then "the city reaches the edge of the region" and the sandbox goals take over. Growing further would need a larger frame plus sleeping districts (O8), which the measurements put at real risk on mid-range phones. Is nine the right end point, or should the sandbox keep growing at that risk?
2. **Raised hills.** Highstep Terraces ship with painted terraces (contour shading, walls and stairs). Real raised steps touch six render layers and are planned as an optional package after integration. Build it, or is the painted version enough?
