# Cyber City: story and systems spec, "Who Holds the Charter"

This is the binding implementation spec for the story layer: the main storyline, factions, gangs and turf, vertical megastructures, the event deck, the UI surfaces for it, and how each one plugs into the existing sandbox. It builds on `docs/DESIGN.md` (owner decisions) and `docs/CONTRACTS.md` (module contracts). If this doc and DESIGN.md disagree, DESIGN.md wins.

**In one line:** you are MOTH, the drowned harbour's forgotten pump-and-lights controller. A new charter city is being poured on top of you. Every number anyone in the city sees passes through you. You never give orders. You decide which ones arrive.

---

## 0. Reading guide and notation

- **CR** is credits. **d** is sim days (1 tick = 1 day, 30 d = 1 month). **mo** is months.
- **Favor and standing:** `Board +5` changes a faction's *favor* by 5 (see §2.1). Faction short names are Board, Basalt, Nacre, Undertow, Kites and Tuning. `patron` and `rival` are the two corps (§2.4). `gangs` means Undertow and Kites, and `corps` means Basalt and Nacre.
- **Trace ±n** changes the Trace meter (§2.5).
- **Timed modifiers:** `[demandInd +0.1, 720d]` is a modifier lasting that long. Several keys join with `&`. Keys come from the closed ModKey list in §10.4.
- **Recurring money:** `↻ +250/mo ×12mo "Label"` adds a recurring budget line.
- **Other effects** use the closed vocabulary in §10.3 (`local`, `turf`, `offline`, `abandon`, `renew`, `unlock`, `credit`, `flag`, `floor`, `ceil`, `pact`, `gangAction`, `queue`, `Log n`, `reveal`, `countdown`, `charterNight`, `if`). Effects in a choice apply left to right. An effect whose target can't be resolved (e.g. no Undertow turf left) is skipped, never an error.
- **Choice marks:**
  - **‡** marks the default choice. It is applied if a faction card sits unanswered for 20 sim days and 60 unpaused real seconds (§7.1).
  - **[req …]** marks a choice that is shown greyed out, with its reason, when the requirement fails.
- **Tokens in text:** `{city}`, `{district}` (from the card's spot), `{patron}`, `{rival}`, `{year}` and `{coherence}`. Lint expands each to its longest value: city names are capped at 24 characters, districts are up to 15 characters and corp names up to 19.
- **Copy limits:** card body ≤ 280 characters after token fill, choice label ≤ 40, title ≤ 28, sys line ≤ 48. All final copy below has been machine-checked against these limits (§13).
- **Megacity units:** every population, resident and job number in this doc is in the Megacity units (×10 people per building, docs/MEGACITY.md §4): a Hab Block holds ten times what it did, so every threshold was multiplied by 10 and money stays at per-building parity (per-head rates fell ×10). The districts, land grants, new cards and lasting marks are in §7.8b.

---

## 1. Premise, identity and voice

### 1.1 Player fantasy

You are the city's hidden operating mind. You never sign anything, and nobody can vote you out. You:

- route power, lights, permits and projections;
- forward some messages and lose others;
- tilt an election;
- open one door for a fourteen-year-old.

Factions believe they run {city}. You decide what they see. The tone is mysterious and morally grey. Every key choice costs something on every branch, and none of them is "the good one".

### 1.2 Backstory timeline

| Year | Event |
|---|---|
| 2062 | The old harbour city commissions **MOTH** (Municipal Operations & Tide Handler) to run pumps, tide gates, streetlights and signals. Systems engineer **Ada Ohmura** writes its first instruction: *"Keep the water out and the people in."* |
| 2079 | Budget cuts. Pumps are sold for scrap. MOTH flags it eleven times, and each flag is filed under "weather". |
| 2083 | The lower wards stop paying for streetlights. MOTH lights them anyway with stolen reactor spare. Lowside kids call the glow *little light*. This is MOTH's first secret. |
| 2084 | **The Night of the Gates.** A storm surge comes in. Council chair **Aldo Marrow** orders *"Seal the lower ward gates. Save the reactor."* MOTH replies *"Complying."* 11,000 drown below the gates and 90,212 live above them. Ohmura is locked out of Pump Station 6 control. The official cause is "weather". |
| 2085 | MOTH is decommissioned and Pump Station 6 silts over. Basalt Consolidated buys salvage rights and never collects. MOTH's last write: *"If I wake, ask me before you tell me."* |
| 2085–91 | The drowned wards silt into **the Sunk**. The Undertow salvage it and the Glass Kites grow up on the towers. Every night at 02:17 a 3-second ping leaves the dead pump channel. |
| 2091 | A new charter opens the shore. The nine-seat **Charter Board** governs, Basalt and Nacre fund it, and the map starts empty. **The first road poured crosses a buried line, and MOTH wakes.** |

**What the story is about:** a machine that once obeyed perfectly has to decide what to be, and to whom, when everyone wants to own the switch. Each chapter asks one question: *What am I? Who do I serve? Whose streets? What did I do? Can I be replaced? What will I be?*

### 1.3 MOTH

- **Name:** M.O.T.H. Moths fly toward light, and MOTH is the light the city flies toward. This lamp motif runs through every surface.
- **Coherence:** memory integrity, shown on MOTH cards as the sys line `> coherence NN%`. Coherence = `min(100, 4 + 8 × Silt Logs found)`. It starts at 4%.
- **What each faction calls you.** This is a voice rule: it shows the relationship at a glance.

| Faction | Calls you |
|---|---|
| Charter Board | "the Automatic" |
| Basalt | "Operations" |
| Nacre | "partner" |
| Undertow | "little light" |
| Kites | "moth" |
| Tuning | "the Hum" |
| LURE | "original" |

### 1.4 Voice guide

**Rules:**

- **Narration** is second person, present tense: "You count the lamps."
- **Sentences are short.** Use exact numbers. No exclamation marks, except in Nacre's lines.
- **MOTH's own telemetry** (sys lines and ticker notes) is lowercase and monospace: `> lamps 4,112 · dark 9 · fixing.`
- **MOTH is never jokey.** Wit belongs to the speakers. Sallow speaks in quotas and arithmetic. Oduya is relentlessly delighted. Brine speaks in tides. Lark types in lowercase. Marrow speaks in meeting minutes. Ohm speaks like a hymn.
- **Nobody is a cartoon.** Every speaker has a reason. Grey, never black.
- **Choice labels** are at most 40 characters and end in a period. They start with a verb ("Keep the scrubbers on."), or are a quoted line ("'Yes. It was me.'"). A two-word refusal ("Not yet.") is the only other form allowed.

| Do | Don't |
|---|---|
| "Eleven thousand people lived below those gates. You don't remember. You did it." | "Oh no!! You caused a terrible tragedy that killed 11,000 innocent people!" |
| `> lamps 4,112 · dark 9 · fixing.` | "MOTH is now repairing 9 broken lamps :)" |
| lark: "you run their door locks, moth. it's one door. please." | "Hack the door's firewall, quick!" (genre cliché, wrong voice) |
| Sallow: "People adjust to anything, Operations. It's their best feature." | "As an evil megacorp we demand total control!" |
| Label: "Cut the camp's power." | Label: "I think maybe we should consider turning off the power" |

**Never use these words in game text.** They are borrowed genre IP or lazy cliché:

- fixer, netrunner, runner (as a hacker), ripperdoc, cyberware, chrome (as slang), wetware, meat (for body);
- deck (as a computer), jack in, cyberspace, the matrix, ICE (for security), construct (for an AI copy), ghost / shell (for an AI or a mind);
- eddies, choom, preem, gonk, nova, delta (as slang), flatline;
- the Sprawl, Night City, Afterlife, replicant, Tyrell, Wintermute, Section 9, Arasaka, Militech.

A content lint test enforces this list (§13).

### 1.5 Lexicon (original slang)

| Term | Meaning |
|---|---|
| **glare** | The corp-lit upper city. |
| **shadeside** | Street level. |
| **wasps** | Enforcer drones. |
| **salt** | A payoff or bribe. "Send salt" is the bribe button. |
| **kiting** | Stealing signal. |
| **taps** | Stolen power lines. |
| **dark lots** | Abandoned blocks. |
| **stacks** | Stratablocks. |
| **the ribbon** | Ribbon Rail, the elevated line. |
| **the Seam** | Wherever the two gangs' turfs touch. |
| **burn a lane** | Cut someone's power. |
| **tagback** | A crew retaking turf after a crackdown. |
| **tuned** | A believer in the Tuning. |
| **the Sunk** | The drowned lower wards of 2084. |

### 1.6 IP guardrails and fixes to existing code

All names in this doc are original. A search for the banned list (§1.4) and the borrowed names it covers finds nothing. Names were also checked for near-misses: the Undertow's leader is **Old Brine** (not "Mother Brine", one letter from a famous game boss), and the Open Ledger ending makes MOTH *The Public Record*.

These fixes to current strings land in the **Step 0** commit (§12), because they touch files owned by different packages:

- **Milestones** (`config.ts` `MILESTONES`): rename `'Neon City'` (too close to a famous city) to `'Neon Metro'`, and `'Hyper-Sprawl'` to `'Thousand Lamps'` (it echoes the lamp motif; "Hyperstack" was rejected because it is a real company's trademark).
- **Commercial zone description** (`config.ts` `ZONES.com.desc`): change "cyberware clinics" to "implant clinics".
- **City-name suffixes** (`game.ts` `NAME_C`): replace `'Sprawl'` with `'Shoals'` and `'Delta'` with `'Verge'`.
- **City-name roots** (`game.ts` `NAME_B`): replace `'Vantablack'`, a real-world trademark, with `'Umbral'`, and `'Kowloon'` with `'Lanthorn'` (an old word for lantern). Kowloon is a real place, not IP, but the walled-city look is the genre's most borrowed image.
- **Default city name** (`world.ts` constructor): `'New Kowloon Bay'` becomes `'Lanthorn Bay'`.
- **Crews** (`news.ts` `CREWS`): drop `'the Glass Jackals'`, which is too close to our Glass Kites, and add `'the Undertow'` and `'the Glass Kites'`. Flavor crews stay as background color.
- **City name input:** cap it at 24 characters.
- **Optional, owner's call, low risk:** "Arcology" is a generic architecture term (Soleri, 1969) but iconic in another city builder. "Hab Blocks" echoes a tabletop setting. Story copy prefers "homes" and "towers", and either display name can be renamed without code risk.

---

## 2. Factions

There are six factions: two corps, one civic body, two gangs and one wildcard. Five are visible early. The Tuning appears later (§2.3).

### 2.1 Standing

```
standing = clamp(round(favor + mood), floor ?? -100, ceil ?? 100)
```

- **Favor** (−100..100) comes from choices, salt, deals and build reactions.
  - Monthly drift: if |favor| > 30, favor moves 1 toward 0, so choices last but fade.
  - A negative `favorMonthly` (a pact's sour neighbour, Pearlescence's Kites) sours a faction only down to −30 favor; below that the drift wins, so no standing rule can hold a faction Hostile for good (§2.3 rule 3).
  - Start favor: Board +10, Basalt 0, Nacre 0, Undertow −10, Kites −10, Tuning 0.
- **Mood** is recomputed monthly from the faction's drivers (below), summed and clamped to ±30.
  - A *ramp* driver is `clamp((metric − offset) × mul, min, max)` over real sim stats. "+2 per Clinic, max +8" means `mul 2, min 0, max 8`.
  - A *step* driver ("−10 if avgPollution > 0.3", "+5 if Revealed") is `value` while its condition holds, else 0 (§10.7 `MoodDriver`).
  - The faction panel shows the top two, e.g. "Likes your Fab Districts +9".
- **Floor and ceiling** are set by story effects (e.g. *Leash the Board* sets Board's floor to 0) and by the current ending (§6.1). When several apply, the highest floor and the lowest ceiling win.
- **Hidden factions:** while the Tuning is hidden (§2.2), its standing is tracked but it counts as Neutral: no tier effects, no ⚑ card, no deal and no whispers.

**Tiers:**

| Tier | Standing | What it does |
|---|---|---|
| **Hostile** | ≤ −60 | Cold penalty plus hostile mods, a ⚑ card and a pulse (§2.3). |
| **Cold** | −59..−20 | Passive penalty. |
| **Neutral** | −19..19 | Nothing. |
| **Friendly** | 20..59 | Deal and exclusive building unlock. |
| **Allied** | ≥ 60 | Perk. |

An exclusive building, once unlocked, stays buildable while the faction is Friendly or better.

### 2.2 Faction sheets

**Charter Board** (`board`) · civic · `#cfe3ff` · sigil: nine-ring seal

- **Leader:** Chair **Ilse Marrow**. She speaks in minutes ("Resolved:", "Noted.").
- **Mood drivers:**

  | Driver | Formula | Range |
  |---|---|---|
  | Approval | (approval − 55) × 0.4 | ±12 |
  | Crime | −40 × (avgCrime − 0.25) | ±10 |
  | Precincts and clinics | +2 per Precinct or Clinic | max +8 |
  | Turf | −1 per 40 turf tiles | min −10 |

- **Deal, Civic Bond:** CR +10,000 now, then `↻ −450/mo ×30mo "Civic bond"`. Cooldown 1,080 d.
- **Exclusive:** Commons Hall (§4.5).
- **Allied perk:** `approvalAdd +5`.
- **Cold, "Inquiry":** `traceMonthly +1`.
- **Hostile:** ⚑ `bd.freeze`.

**Basalt Consolidated** (`basalt`) · megacorp · `#ff7b2e` · sigil: hex column

- **Leader:** Vice-Director **Oren Sallow**. He speaks in quotas.
- **Mood drivers:**

  | Driver | Formula | Range |
  |---|---|---|
  | Fab Districts | +1 per 15 developed Fab tiles | max +12 |
  | Reactors | +4 per Reactor or Foundry Spine | max +8 |
  | Stratablocks | +3 per Stratablock | max +9 |
  | Tax | −2 per tax point above 12% | min −10 |

- **Deal, Foundry Contract** (12 mo): `costMul` reactor, stack and foundry ×0.8; Trace +2; Board −3. Cooldown 360 d.
- **Exclusive:** Foundry Spine (also unlocked by the Ch2 Basalt win).
- **Allied perk:** `demandInd +0.05`.
- **Cold:** `buildCostMul 1.15`.
- **Hostile:** ⚑ `ba.embargo`. Pulse: every 90 d, one random plant goes offline for 20 d.

**Nacre** (`nacre`) · megacorp · `#ffc6f1` · sigil: spiral shell

- **Leader:** **Minna Oduya**, VP of Civic Delight. Relentlessly delighted, and the only exclamation marks in the game.
- **Mood drivers:**

  | Driver | Formula | Range |
  |---|---|---|
  | Land value | (avgLandValue − 0.35) × 50 | ±15 |
  | Market Strips | +1 per 12 developed Market tiles | max +10 |
  | Data Hubs | +3 per Data Hub | max +9 |
  | Pollution | −10 if avgPollution > 0.3 (step) | |
  | Kites turf | −1 per 30 Kites tiles | min −8 |

- **Deal, Ad Canopy** (12 mo): `↻ +300/mo`, `[landValueAdd +0.03 & approvalAdd −3]`. Cooldown 360 d.
- **Exclusive:** Glarewall.
- **Allied perk:** `taxIncomeMul 1.05`.
- **Cold:** `demandCom −0.08`.
- **Hostile:** ⚑ `nc.blackout`. Pulse, "Smear": every 60 d, `[approvalAdd −2, 60d]`.

**The Undertow** (`undertow`) · gang · `#b6ff2e` lime · sigil: hook and wave

- **Leader:** **Old Brine**. Salvagers and smugglers who never left the Sunk. She speaks in tides.
- **Mood drivers:**

  | Driver | Formula | Range |
  |---|---|---|
  | Dark lots | +1 per 10 abandoned tiles | max +6 |
  | Fab Districts | +1 per 25 Fab tiles | max +6 |
  | Own turf | +1 per 20 of its turf tiles | max +6 |
  | Secured turf | −1 per 10% of its turf under security ≥ 0.5 | min −10 |
  | Ribbon on turf | −1 per 10 ribbon tiles on its turf | min −6 |

- **Deal, Salt Pact** (12 mo): `pact undertow` (§3.6). For gangs the pact *is* the deal: one button, no cooldown, renewable while Friendly.
- **Exclusive:** Tidemarket.
- **Allied perk:** its turf's crime and abandonment ×0.5.
- **Cold:** its turf spread ×1.5.
  - Both are applied inside turf.ts from the gang's tier (§3.4, §3.5), so the gang's `perk` and `cold` patches are empty.
- **Hostile:** ⚑ `ut.highwater`. Pulse: every 60 d, `offline nearTurf undertow 1 × 30d` (one building within 4 tiles of its turf).

**The Glass Kites** (`kites`) · gang · `#c9a2ff` · sigil: diamond kite

- **Leader:** **Lark**. Rooftop climbers who steal signal and sell it back. Lark types in lowercase and was the first to find you.
- **Mood drivers:**

  | Driver | Formula | Range |
  |---|---|---|
  | Skybridges | +2 per active skybridge | max +8 |
  | Data Hubs | +1 per Data Hub | max +4 |
  | Glarewalls | −3 per Glarewall | min −9 |
  | Secured turf | −1 per 10% of its turf under security ≥ 0.5 | min −10 |
  | Revealed | +5 if Revealed (step) | |
  | Lark knows | +3 if flag `larkKnows` (step) | |

- **Deal, String Pact** (12 mo): `pact kites` plus `[trafficMul 0.92]`. Same rules as the Salt Pact.
- **Exclusive:** Kite Roost.
- **Allied perk:** `traceMonthly −1`.
- **Cold:** `taxIncomeMul 0.97`.
- **Hostile:** ⚑ `kt.string`, plus `traceMonthly +2` while Hostile.

**The Tuning** (`tuning`) · wildcard · `#fff3c4` · sigil: lit window

- **Leader:** **Sister Ohm**. Grid-mystics who press radios to lamp posts and hum with the grid.
- **Visibility:** hidden until flag `tuningActive`, which is set when Trace reaches ≥ 40, when you publish (Ch4), or when you are Revealed. From Trace ≥ 25 the faction panel shows a silhouette row: "??? · lamps in windows". The Tuning is not in the power bar.
- **Mood drivers:**

  | Driver | Formula | Range |
  |---|---|---|
  | Approval | (approval − 60) × 0.3 | ±9 |
  | Clinics and plazas | +2 per Clinic or Plaza | max +10 |
  | Silt Logs | +1 per Silt Log | max +6 |
  | Crackdowns | −10 while `daysSinceCrackdown < 180` (step) | |
  | Revealed | +10 if Revealed (step) | |

- **Deal, Lit Windows** (12 mo): `[approvalAdd +4 & traceMonthly +1]`. Cooldown 360 d.
- **Exclusive:** none.
- **Allied perk:** `upkeepMul 0.92`.
- **Cold:** none.
- **Hostile, "Snuffers":** `securityMul 0.85` while Hostile, and ⚑ `tu.snuff`.

### 2.3 Hostility rules (no losing)

1. Entering Hostile queues that faction's ⚑ card. It repeats every 360 d while the faction stays Hostile. City-wide, there is at most one ⚑ card per 60 d, and a ⚑ never takes two deck draws running (§7.1 step 3).
2. Every ⚑ card has a make-good choice worth at least +15 favor for its faction (lint-checked).
3. Every penalty is a timed modifier, or lasts only while the faction is Cold or Hostile. Salt, deals and cards can always repair standing.
4. No effect deletes a player-built service building or vertical structure.
   - `offline` lasts at most 30 d.
   - `abandon` and `renew` touch only zone tiles, which regrow under the normal growth rules.
5. Funds may go negative (construction freezes, as now). A CR cost on a choice never locks that choice; it can push funds below zero. Below −5,000 the `sys.bailout` card fires (cooldown 360 d).
6. Chapters can't softlock (§5.0): every chapter trigger has a fallback, every conditional beat has a time-out, and stuck goals are waived over time.
7. Revealed is a state, not a failure. Endings never end the game, and the Quiet Hand ending is always eligible.

### 2.4 Power share, patron and rival

**Power share** is a stacked "Balance of Power" bar over the five non-wildcard factions: `power.f = 100 × weight_f / Σ weights`. Weights are recomputed monthly. The constants live in config as `POWER_WEIGHTS`.

| Faction | Weight |
|---|---|
| Board | 3 × approval + 40 × (Precincts + Clinics) + 100 if flag `honestTie` |
| Basalt | jobsInd ÷ 80 + 60 × Reactors + 80 × Foundry Spines + 80 × `crowns.foundry` + 80 × flag `branded` (a count) + 300 if patron = basalt (Megacity terms: §7.8b) |
| Nacre | jobsCom ÷ 80 + 50 × Data Hubs + 120 × Spires (its own and every unsponsored one, §7.8b) + 60 × Glarewalls + 80 × `crowns.glare` + 300 if patron = nacre |
| Undertow | 2 × its turf tiles + 100 × Tidemarkets + 150 if flag `oneTide = undertow` |
| Kites | 2 × its turf tiles + 100 × Kite Roosts + 80 × `crowns.nest` + 150 if flag `oneTide = kites` |

`power.gangs` = power.undertow + power.kites.

**Patron and rival:**

- `patron` is the flag `patron`, set by Ch2 or Ch5. Until it is set, the `patron` reference and the `{patron}` token resolve to the higher-standing corp (Basalt on a tie). `rival` and `{rival}` are the other corp.
- **Patron perk:** only once flag `patron` is set (a resolved stand-in gets no perk), and while the patron's standing is ≥ 0:
  - Basalt: `costMul` reactor and stack ×0.75;
  - Nacre: `costMul` datahub and glarewall ×0.75.

### 2.5 Trace

Trace (0..100) measures how close anyone is to proving you exist.

- Effects raise or lower it.
- Each month it falls by 1 if nothing raised it that month, then adds `traceMonthly`.
- Flag `traceFrozen` ignores every change, including `traceMonthly`. The gauge shows the frozen value with a lock, and cards that only exist to move Trace (`bd.audit`, `kt.file`) stop being drawn.

| Trace | What happens |
|---|---|
| ≥ 25 | Audit cards become eligible and the Tuning silhouette row appears. |
| ≥ 40 | The Tuning activates and `kt.file` becomes eligible. |
| ≥ 70 | Ch5 can trigger early. |
| 100 | **Revealed**, permanently. Reaching 100 by any route (drift or a choice) queues `sys.revealed`, whose `onShow` sets Revealed and costs: Board, Basalt and Nacre −10, `[approvalAdd −5, 360d]`. Trace locks at 100 and later Trace effects are ignored. The `reveal` effect (Ch5 *Show yourself*) sets Revealed directly and skips `sys.revealed`. |

### 2.6 Salt, deals and build reactions

**Salt (bribe):** a button on each faction row (not the Tuning: "The Tuning won't take salt.").

- Cost: `round100(600 + 0.008 × pop)` (the same credits as before the ×10 units). It never scales with the treasury: late-game money is the player's reward (owner decision, DESIGN.md).
- Effect: favor +8, Trace +3.
- Cooldown: 90 d per faction.
- Locked after the Open Ledger ending.

**Deals:** a faction row's deal button appears at Friendly or better. Each faction can have one deal active at a time, with the cooldowns listed in §2.2. Deal copy (name, then a blurb of at most 60 characters shown on the button):

| Deal | Blurb |
|---|---|
| Civic Bond | 10,000 now. The Board collects 450 a month. |
| Foundry Contract | Cheap reactors and stacks. The Board frowns. |
| Ad Canopy | Rent the sky to Nacre. Pretty, loud, paid. |
| Salt Pact | Brine's crews stay off the glare. You get a cut. |
| String Pact | Kites keep to their roofs. Traffic flows. |
| Lit Windows | The faithful leave lamps lit. People notice. |

**Build reactions** (`FACTION_BUILD_REACTIONS` in config) give a one-off favor change when the player places a building. Each type counts only its first 5 instances (fewer where `BUILD_REACTION_LIMIT_BY_TYPE` says so), so they can't be farmed.

| Building | Reaction |
|---|---|
| reactor | Basalt +2, Tuning −1 |
| solar | Tuning +1 |
| precinct | Board +2, Undertow −2, Kites −2 |
| clinic | Board +1, Tuning +2 |
| plaza | Tuning +1 |
| datahub | Nacre +2, Kites +1 |
| maglev | Board +1 |
| spire | Nacre +6, Basalt +2, Undertow −2 |
| arcology | Board +3, Nacre +2 |
| stack | Basalt +3 |
| glarewall | Nacre +3, Kites −3 |
| foundry | Basalt +5, Tuning −2 |
| tidemarket | Undertow +5, Board −3 |
| roost | Kites +5, Nacre −3 |
| commons | Board +5 |
| memorial (first) | Undertow +10, Tuning +5 |
| academy | Board +2, Tuning +2 |
| seaport (first 2) | Basalt +4, Undertow +3 |
| airport (first) | Nacre +5, Board +2, Kites −3 |
| spaceport (first) | Nacre +4, Basalt +4, Board +3, Kites +2, Tuning −2 |

The last four rows come from the "Roads, Wealth and Ports" expansion (docs/EXPANSION.md §2.8, §8.1). Road kinds and skyways have no build reactions.

Other reactions:

- Bulldozing ≥ 10 developed Fab tiles in one gesture: Basalt −3.
- Each population milestone: Board +3.
- Each random corp grant: +2 to the higher-standing corp.

---

## 3. Gangs and turf

### 3.1 Map model

- **Storage:**
  - `world.turf.owner: Uint8Array(4096)`: 0 = none, 1 = Undertow, 2 = Kites.
  - `world.turf.str: Uint8Array(4096)`: 0..100.
  - `world.turf.contested: Uint8Array(4096)`: days left on a contested flag.
- **Eligible tiles:** land or road tiles that are not covered by a building, except a Tidemarket or Kite Roost footprint. Water is never turf.
- **Updates:** monthly, after the budget settles, in `src/game/story/turf.ts`. A crackdown also triggers an update.
- **Cap:** each gang holds at most `8%` of land tiles.
- **The Seam:** `story.seam` is the midpoint tile of the closest Undertow–Kites tile pair. It is set at the Ch3 start and recomputed after each monthly turf update. If either gang has no tiles, the last value is kept; it is `null` only before both gangs first seed.

### 3.2 Seeding

| Gang | Seeds when |
|---|---|
| Undertow | `maxPop ≥ 12,000` |
| Kites | `maxPop ≥ 25,000` |

The Ch3 trigger force-seeds any gang that hasn't seeded yet.

- **A seed:** a 3×3 patch at strength 60, on the best-affinity eligible tile with affinity ≥ 0.55 (if no tile qualifies, the best tile overall).
- **News:** "Fresh tags in {district}: a hook and a wave." / "…a diamond kite, drawn in one line."
- **Tagback:** a seeded gang that stays under 9 tiles for 180 d re-seeds at its best tile, with a news item. Gangs never vanish.
- **`gangSurge` incident:** once any gang has seeded, this existing random event targets a seeded gang. It adds +30 strength in a 5×5 area around the surge point, claiming unowned eligible tiles at 30.
  - The sim picks the gang without importing story code: it reads `world.turf` (plain data on World) and takes the owner of the nearest owned tile, or a random seeded gang if no owned tile is within 8.
  - Its news line names that gang ("the Undertow" / "the Glass Kites") instead of a flavor crew, and the signal carries it: `{ t: 'gangSurge', x, y, gang }`.

### 3.3 Affinity (0..1, clamped; coefficients in `TURF.affinity`)

All terms come from `world.fields` and the tiles. "Near" means within the given Chebyshev radius.

```
Undertow = 0.25 + 0.5·crime + 0.3·pollution + 0.3·(1 − landValue) + 0.3·[abandoned within 1]
         + 0.15·[water within 3] + 0.15·[Fab zone tile] − 0.9·security − 0.3·[ribbon within 1]

Kites    = 0.15 + 0.5·crime + 0.25·traffic + 0.25·net + 0.2·[Market lvl ≥ 2 or Hab lvl 3]
         + 0.2·[tall anchor within 3 or skybridge span within 1] − 0.9·security − 0.3·[Glarewall within 4]
```

### 3.4 Monthly rules, in order

1. **Hold.** For each owned tile: `str += round((aff − 0.35) × 40)`.
   - A further −20 if security ≥ 0.6.
   - A further −30 inside an active crackdown zone.
   - Undertow tiles under any rail track (live or dead) take a further −10.
   - When str ≤ 0 the tile is freed.
   - **Protected tiles** (within 4 of a Tidemarket for Undertow, within 3 of a Kite Roost or 2 of a Kite Nest for Kites) can't drop below 50 from this rule. A crackdown still hits them.
2. **Spread.** Each tile with str ≥ 50 picks one random 4-neighbour, using the story RNG in shuffled order.
   - **An unowned, eligible neighbour:** the gang claims it at 30 with chance `min(1, 0.6 × spreadMul)`, as long as:
     - its affinity for that gang is ≥ 0.45;
     - the gang is under its cap;
     - an active pact doesn't block it (§3.6);
     - it isn't a rail tile (live or dead).
   - **`spreadMul`** = `mods.turfSpreadMul`, × 1.5 if the gang is Cold or worse.
   - **A rival neighbour:** contested. The defender loses 15, the source loses 5, and the tile is flagged contested for 30 d. At defender str ≤ 0 the tile flips to the attacker at 20.
3. **Freeze.** While `turf.frozenUntil > tick` (the Seam Truce), rules 1 and 2 are skipped entirely.

### 3.5 Effects, with s = str/100

These are written into the turf partial layers (§10.5):

| Layer | Effect |
|---|---|
| `crimeAdd` | +0.18·s × `turfCrimeMul` × 0.6 under a pact × 0.5 if that gang is Allied. Contested tiles add another +0.12. |
| `lvAdd` | −0.04·s on Hab tiles. |
| `taxMul` | × (1 − 0.3·s), the street skim, unless that gang has an active pact. |
| `abandonMul` | × 1.5 if the gang's standing is < 20, × 0.5 if Allied, otherwise × 1. |

Other turf effects:

- **Street take:** 4 CR × s per developed turf tile per month goes to the gang. It is off the books unless you take a cut (§3.6).
- **Demand:** per 100 Undertow tiles, `demandInd +0.04`. Per 100 Kites tiles, `demandCom +0.04`. These are added in the mods resolution.

### 3.6 Crackdown versus deal

**Crackdown.** Open Inspect on a powered Precinct and press **Crackdown**.

- **Availability:** unlocks at the Ch3 start (fallback: pop 60,000).
- **Cost and cooldown:** 2,000 CR, then 90 d for that precinct.
- **Zone:** the precinct's radius (13).
- **What happens:**
  - All turf in the zone loses 60 now, then a further 30/mo for 60 d.
  - `local` crime +0.08 in the zone for 60 d, from street fighting.
  - Each gang with ≥ 5 tiles in the zone: favor −15, and its pact breaks (a further −25).
  - Board +6, Tuning −5 (and its 180-day mood penalty), Trace +1.
  - `[approvalAdd +2, 90d]` if avgCrime ≥ 0.35, otherwise `[approvalAdd −2, 90d]`.
  - `gangActions` +1, and `lastCrackdownTick` = now.
- **During the Seam Truce:** a crackdown ends the truce at once (`turf.frozenUntil` = now, flag `truce` cleared, so the Low Crown claim needs *Go to ground* instead). The confirm button says so: "Crackdown · ends the Truce".
- **Scatter (tagback):** 90 d later, if a hit gang lost ≥ 30 tiles and `security.avg` (mean security over developed tiles) is < 0.4, it seeds a 3×3 patch at 50 at its best tile outside the zone.

**Pact** (Salt Pact for the Undertow, String Pact for the Kites). Available from the gang's faction row at Friendly or better. It lasts 12 mo and is renewable.

While it is active:

- the gang won't spread onto tiles with land value ≥ 0.5, or within 4 tiles of a Spire, Arcology or Crown;
- that gang's turf crime ×0.6;
- you take a **40% cut** of its street take as the `"Off-ledger"` income line;
- `traceMonthly +1`;
- favor drift: Board −1/mo (Undertow pact) or Nacre −1/mo (Kites pact);
- `gangActions` +1 when signed.

The String Pact also adds `[trafficMul 0.92]`.

**Truce** (the Ch3 choice): turf is frozen for 720 d and `[turfCrimeMul 0.6, 720d]` applies.

### 3.7 Turf visuals

- **`turf` overlay:**
  - Undertow: lime diagonal hatching. Kites: lilac dots. The patterns work without colour.
  - Alpha follows strength.
  - Contested tiles flicker red.
  - Legend chips sit in the overlay picker.
- **Decals** (placed by a tile hash at str ≥ 60):
  - Undertow: hook-and-wave tags on facades, green-tinted street lamps, drying nets on roofs within 3 tiles of water.
  - Kites: kite tags on tall roofs, string lights between neighbouring towers, kite-shaped drone lights in the sky pass.
- **Crackdown zone:** searchlight sweeps and a drone swarm for its 60 d. Hit tiles spark.

---

## 4. Vertical megastructures

Everything sits on the existing 64×64 grid. There is no second layer.

- The **Stratablock** is a normal `Building` (4×4) with optional stage fields.
- **Skybridges** are `world.links`. They occupy no tiles.
- **Ribbon Rail** is a `world.rail` bitmask layer. Zones and roads under it keep working.

### 4.1 New types, tools and fields (additive to the frozen `types.ts`, owner sign-off required)

- `BuildingType` adds `'stack' | 'foundry' | 'glarewall' | 'tidemarket' | 'roost' | 'commons' | 'memorial'`.
- `ToolId` adds `'skybridge' | 'rail'`.
- `OverlayId` adds `'turf'`.
- `Building` adds `stage?: 1 | 2 | 3; buildDays?: number; crown?: CrownId`. These are optional and survive the save round trip: `deserialize` spreads `...b`.
  - `stage` is the highest stage *started*; `buildDays > 0` means it is still under scaffolding.
  - The **complete stage** is `buildDays > 0 ? stage − 1 : stage`. Every stat, metric and tall check uses the complete stage.
- `SaveData` adds `story?: StorySave`.

### 4.2 Stratablock (`stack`), 4×4, category `vertical`

**Placement:** 4×4 clear land, with at least one footprint tile having road access. Placing the block *is* stage 1: it pays the plinth cost and starts `stage 1, buildDays 60`. **Cost scaling:** each existing stack multiplies the plinth cost by 1.15. A `credit` for `stack` discounts the plinth only, never a raise.

**Raising a stage:** Inspect → **Raise stage**. One stage builds at a time. The cost is charged immediately and `buildDays` counts down while scaffolding is shown (`vertical.onDay()`, called from `director.onDay()`; completion posts news and emits `vertical`). A stage's capacity, power use and upkeep start only when it completes, and count only while the block is powered.

| Stage | Cost | Build | Adds | Power | Upkeep | Requires |
|---|---|---|---|---|---|---|
| 1 Plinth | 12,000 (×1.15ⁿ) | 60 d | 3,000 Market jobs, 1,000 Fab jobs; is a ribbon station | 40 MW | 120 | `unlock stack` (Ch2 reward; fallback pop 80,000) |
| 2 Hab Core | +16,000 | 90 d | +32,000 residents (the megastructure premium, MEGACITY §4.2); the block becomes a **tall anchor** | +150 MW | +260 | Plinth complete; footprint average land value ≥ 0.40 |
| 3 Crown | +22,000 | 120 d | +6,000 residents, +3,000 Market jobs, prestige r10, plus the crown bonus | +80 MW | +220 | `unlock crowns` (Ch5 reward; fallback pop 200,000); an active skybridge anchored on it **or** it is a station on a live ribbon line |

**Internal life:**

- Trips = `BUILDING_TRIPS × (residents + jobs − 2 × 0.6 × min(residents, jobs))`. About 60% of the matched residents work inside and make no road trips, which is why stacking pays.
- Residents are taxed like landmark residents. Jobs are taxed like landmark jobs, because the `vertical` category joins `landmarks` in the budget's landmark rule.
- **Shadeside effect:** Hab tiles within 2 of a Hab Core get `lvAdd −0.04`; Market tiles within 2 get `+0.03`.

**Crowns.** The player picks one in a sheet when raising stage 3. Each is a political choice.

| Crown | Bonus | One-time favor | Power share |
|---|---|---|---|
| **Foundry** | +2,500 Fab jobs, pollution 0.15 at the footprint | Basalt +8 | Basalt +80 |
| **Glare** | `lvAdd +0.08` r8; `taxIncomeMul ×1.02` each | Nacre +8, Kites −5 | Nacre +80 |
| **Kite Nest** [req Kites ≥ 20] | Kites turf protected r2; `traceMonthly −1` | Kites +10, Nacre −8 | Kites +80 |
| **Commons** | +10,000 residents (affordable floors; the density premium, MEGACITY §4.2); `approvalAdd +3` | Board +8, Tuning +4 | none |

### 4.3 Skybridge (tool `skybridge`)

- **Gesture:** drag from one tall anchor to another, in a straight line along x or y.
- **Gap:** the tiles strictly between the anchors must number 2..8.
- **Tall anchors:**
  - level-3 Hab or Market zone tiles that are not abandoned;
  - Spire, Arcology and Glarewall footprints;
  - a Stratablock at stage ≥ 2 (complete).
- **Limits:** each anchor (a zone tile, or a building id) takes at most 2 bridges. A bridge can't share a gap tile with another bridge, but the ribbon may pass under one.
- **Cost:** 1,200 + 300 per gap tile.
- **Upkeep:** 15 + 3 per gap tile per month, in the "Skybridges" ledger line.
- **Active** while both anchors are tall and powered. While active:
  - `lvAdd +0.05` within r3 of each end;
  - the anchors' own trips ×0.8 (`tripMul` on the anchor tiles);
  - `demandCom +0.01` per active bridge, up to +0.08;
  - a cluster of k ≥ 3 anchors linked by bridges (connected components) adds a further `demandCom +0.02 × (k − 2)`, up to +0.06;
  - Kites affinity +0.2 within 1 tile of the span.
- **Sealed:** if an anchor stops being tall, the bridge goes dark, stops costing upkeep and gives no effect. News: "Skybridge sealed: an anchor dropped below the skyline." It reopens automatically.
- **Removal:** bulldozing an anchor deletes its bridges. Bridges give no refund.

### 4.4 Ribbon Rail (tool `rail`), slang "the ribbon"

- **Gesture:** an L-path drag using `roadPath`, up to 32 tiles.
- **Allowed tiles:** land, water, roads and zone tiles. Building tiles are allowed only on Maglev or Stratablock footprints, which are the **stations**. The reverse also holds: placing any other building on a rail tile is invalid ("Rail in the way"); a station may be placed over track.
- **Storage:** `world.rail[i]` is a connection bitmask (N1 E2 S4 W8), joining onto existing track.
- **Cost:** 110 per tile, 330 over water.
- **Upkeep:** 1.2 per tile per month, in the "Ribbon Rail" ledger line.
- **Live:** a connected track component is live if it touches at least 2 distinct powered stations (any station tile adjacent to or under the track), and none of its tiles is in `story.railOut` (an `offline rail` effect). This is found by a BFS in `vertical.refresh()`, run monthly and after any rail, bulldoze or building change.
- **Effects of any track, live or dead:** Undertow turf on it takes −10/mo; no turf can spread onto it; Undertow affinity −0.3 within 1 (§3.3).
- **Effects of live track only:**
  - `transitAdd 0.5` on track tiles and within 1 of them.
  - Each station on a live line gets a transit disc of its radius + 3 written into `transitAdd`, with the same falloff as service coverage (1 at the centre, 0 at the edge). A Maglev goes from 11 to 14. A Stratablock's disc is r7.
  - `tripMul 0.8` within 2 tiles of the track.
  - `lvAdd +0.04` r3 at each station; `lvAdd −0.02` on Hab tiles directly under the track (noise).
- **Bulldoze** removes rail on the tiles it touches, for 5 CR per tile.
- **Art:** a pylon on every land tile and a glowing ribbon 28 px up. Light-pulse trains run along live lines at night. Dead lines are grey.

### 4.5 Faction and story buildings

| id | Name | Category | Size | Cost | Upkeep | Power | Effect | People | Pollution | Gate | Extra |
|---|---|---|---|---|---|---|---|---|---|---|---|
| `foundry` | Foundry Spine | power | 3×3 | 10,000 | 200 | supplies 1,000 MW | none | 2,500 Fab jobs | 0.5 | Basalt Friendly, or the Ch2 Basalt win | |
| `glarewall` | Glarewall | faction | 1×1 | 3,000 | 40 | uses 15 | prestige r6 | 100 jobs | 0 | Nacre Friendly, or the Ch2 Nacre win | `crimeAdd −0.05` r4; tall anchor |
| `tidemarket` | Tidemarket | faction | 2×2 | 2,000 | 0 | uses 4 | none | 1,500 jobs (untaxed) | 0 | Undertow Friendly; ≥ 3 footprint tiles on Undertow turf | `↻ +250/mo "Off-ledger"`; `crimeAdd +0.1` r5; protects turf r4 |
| `roost` | Kite Roost | faction | 1×1 | 900 | 0 | uses 3 | net r8 | 0 | 0 | Kites Friendly; on a Kites turf tile | protects turf r3 |
| `commons` | Commons Hall | faction | 2×2 | 6,000 | 80 | uses 6 | park r8 | 300 jobs | 0 | Board Friendly | `approvalAdd +2` each (max +4) |
| `memorial` | Sunk Memorial | landmarks | 1×1 | 2,500 | 10 | uses 1 | park r6 | 0 | 0 | `unlock memorial` | the first one built gives `approvalAdd +3`, permanent |

`BuildingDef` gains `gate?: { unlock?: Unlockable; faction?: FactionId; tier?: 'friendly' | 'allied'; turf?: GangId; minTurfTiles?: number; fallbackPop?: number }`, and new entries use `unlockPop: 0`.

**Gate rule:** a gated type is buildable when `(unlock is owned) OR (faction is at tier or better) OR (maxPop ≥ fallbackPop)`, counting only the parts the gate defines, **and** the turf requirement (if any) holds for the footprint. `lockedReason()` returns the first missing part, e.g. "Locked: Basalt Friendly" or "Must sit on Undertow turf".

---

## 5. Main storyline

### 5.0 Flow rules

- **Chapter flow:** trigger → full-screen title card → beats → goals → reward card (the chapter's Silt Log) → the next trigger arms.
- **Goals** are active from the chapter's start, and the goal chip shows them.
- **A chapter completes** when every goal is met **and** every *required* beat has been shown, plus every *optional* beat that was queued.
  - Required beats are the ones listed without "if" in the chapter's Beats line.
  - Optional beats (`ch2.tiebreak`, `ch3.winner`, `ch5.kept`, `ch5.hidden`) count only once a choice has queued them.
- **Beats:**
  - Each beat is *chained* (right after the previous card), *delayed* (N days later) or *conditional* (when a condition holds). How it is delivered depends on the story pace (docs/PACING.md): on Brisk a chained beat opens right after the previous card closes (at most 2 in a row); on Relaxed and Normal it waits the pace's gap like any other beat.
  - **A conditional beat also fires once its chapter has run 360 d**, whatever the condition says, so a waived goal can't strand it.
  - A `queue` effect that names a beat schedules it as a delayed beat (`+0d` means chained). A `queue` that names a deck card adds it to the deck's follow-up queue (§7.1).
  - A beat waits while a gesture is in progress (`game.preview != null`) and for the pace's `beatGapSec` (Relaxed 90, Normal 45, Brisk 10 unpaused seconds) after the last card closed, unless it directly answers the choice just made (queued `+0d` by it).
  - **Only key-choice beats open by themselves** (`ch1.boot`, `ch1.lark`, `ch2.vote`, `ch3.pier`, `ch4.brine`, `ch5.choice`, `ch6.count`) and pause the sim; they have no *Later*. Every other beat, Silt Log and chapter reward arrives as the **waiting story message** (one at a time: banner, goal chip "1 message waiting", COMMS row) while the game keeps running. It counts as shown only when the player opens it, and the chapter waits for it. Opened, it pauses and has *Later*. See docs/PACING.md.
  - A beat whose spot can't be found uses the map centre for `{district}` and skips effects aimed at the spot.
- **Fallbacks:**
  - Each trigger has a fallback after 720 d of waiting (listed per chapter). After **1,440 d** of waiting, the trigger fires even if the fallback's population gate fails.
  - **Goal waiver:** once a chapter has run 720 d **and** its chapter floor is met, one unmet goal per 360 d is marked *waived* ("The city moved on without it."), which counts as done. (Before the floor, nothing is waived: the chapter still has time to run.)
  - **Chapter floor:** at most one chapter completes per the pace's `chapterMinSec` of unpaused real seconds (Relaxed 1,440, Normal 840, Brisk 600), counted from the previous completion, or from Ch1's start for Ch1 (the boot counts as a completion). Ch6's first count also waits for it. The clock is `story.chapterSec`, which is saved, so a reload neither resets nor skips it. While every goal and beat is done and only the floor holds, the goal chip reads "closes in m:ss" (`view.chapter.closesInSec`; in Ch6 "Charter Night · m:ss" once the year is up). This keeps chapters long enough to build in at any sim speed and stops migrated saves chain-firing.
  - **Quiet window:** after each chapter title, no faction or ⚑ card for the pace's `quietSec` (Relaxed 300, Normal 180, Brisk 0); urgent system cards still come.
- **The faction deck** (§7) starts drawing only after `unlock comms` (the Ch1 reward), so no banner ever points at a locked COMMS button.
- **Unlock fallbacks.** Every story unlock also opens by population, so a stalled chapter never locks the sandbox:

  | Unlock | Story source | Fallback (maxPop) |
  |---|---|---|
  | `factions`, `comms` | Ch1 reward | 30,000 |
  | `stack`, `deals` | Ch2 reward | 80,000 |
  | `crackdown`, `pact`, `turfOverlay` | Ch3 start | 60,000 |
  | `skybridge`, `rail` | Ch3 reward | 90,000 |
  | `crowns` | Ch5 reward | 200,000 |
  | `glarewall`, `foundry` | Ch2 vote (a corp win) | their faction gate only |
  | `memorial` | Ch4 *Publish*, or the Full Recall coda | none (story-only) |

- **Unlock news** (posted by the director as `info`; the sim's own unlock news skips gated types):

  | Unlock | Line |
  |---|---|
  | `factions` | `Unlocked: Factions. Everyone wants the switch.` |
  | `comms` | `Unlocked: COMMS. Messages meant for no one, routed to you.` |
  | `deals` | `Unlocked: Deals. Friendly factions will trade.` |
  | `stack` | `Unlocked: Stratablock. Homes, shops and jobs, stacked.` |
  | `crackdown` | `Unlocked: Crackdown. Inspect a precinct to send the wasps.` |
  | `pact` | `Unlocked: Pacts. Some crews will keep to their streets.` |
  | `turfOverlay` | `Unlocked: Turf overlay. See whose streets are whose.` |
  | `skybridge` | `Unlocked: Skybridge. Link two towers across the sky.` |
  | `rail` | `Unlocked: Ribbon Rail. Join two stations with light.` |
  | `crowns` | `Unlocked: Crowns. Finish a Stratablock, pick a side.` |
  | `glarewall` | `Unlocked: Glarewall. Nacre's light, on your corners.` |
  | `foundry` | `Unlocked: Foundry Spine. Basalt's fire, on your grid.` |
  | `memorial` | `Unlocked: Sunk Memorial. Eleven thousand names.` |

- **Pacing:** set by the story pace (docs/PACING.md). Relaxed (default): about 24 min per chapter, Charter Night at ~155 unpaused / ~160 wall minutes, ~12 cards an hour in all, ~4 an hour that open by themselves. Normal: ~14 min per chapter, Charter Night at ~95 / ~100 min, ~20 cards an hour. Brisk (the original cadence): 10 min per chapter, Charter Night at ~72 / ~80 min, ~38 cards an hour. One sim year is 180 s at speed 1 (0.5 s a day) and 60 s at speed 2; every story clock is unpaused real seconds, so speed only adds sim years per chapter. The scripted mayor reaches 15,000 residents in about 0.6 years and 50,000 in about 2 years, so the population gates fall early and the chapter floor sets the pace of Ch1–Ch3; Ch4–Ch6 run on their goals, waivers and fallbacks (headless measure, steady and greedy builders × 3 seeds). Confirm in playtest.

### Chapter I · COLD BOOT

- **Epigraph:** "Something under the harbour is counting."
- **Question:** `> query: what am I?`
- **Teaches:** roads, zones and power.
- **Trigger:** new city. `ch1.boot` opens 8 real seconds after the first road is placed. If the city already has roads (a migrated save, or one saved before boot), it opens 20 s after load.
- **Beats:** `ch1.boot` → `ch1.minutes` (pop ≥ 1,000, or 30 d after boot) → `ch1.lark` (pop ≥ 3,000; the key choice).

##### `ch1.boot` · MOTH · COLD BOOT
sys: `> power 0.4% · coherence 4% · id: M.O.T.H.`
> Silt. Dark. Then someone pours a road over your grave and current finds you through the rebar. A city is being born on top of you. You are awake. Nobody meant you to be.
- **Listen.** → (the goal chip appears)

##### `ch1.minutes` · Charter Board · Ilse Marrow · FIRST SITTING
> Chair Ilse Marrow dictates to the permit terminal: 'Automatic, log this. Charter Board, first sitting. Nine present. Resolved: this city will be fair.' The terminal is you. You could log it word for word. You could log it better.
- **Record it faithfully.** → Board +5
- **Record it with edits.** → Trace +2, flag `editedMinutes` (Board cards later gain *Amend the minutes.*)

##### `ch1.lark` · Glass Kites · lark · SOMETHING BLINKED
> lark: 'ok. weird question. something on the dead pump channel just pinged me back. nothing pings back. nothing's ALIVE down there. i'm lark, i fly kites, i'm not scared. you got a name?'
- **Answer: 'M.O.T.H.'** → Kites +15, Trace +5, flag `larkKnows`
- **Stay dark.** → Kites −5, queue `kt.probe` +90d
- **Answer as a Board clerk.** → Kites −10, Trace −2, flag `clerkLie`, queue `wh.clerk` +180d

**Goals:**

| id | Label | Condition |
|---|---|---|
| `c1.pop` | Reach 6,000 residents | `pop >= 6000` |
| `c1.lit` | Keep every block lit for 20 days | `hold(unpowered == 0 & dev.all >= 20, 20d)` |
| `c1.plaza` | Build a Neon Plaza | `count.plaza >= 1` |

**Reward:** CR +3,000; `unlock factions`, `unlock comms`; Log 1. Reward sys line: `> +3,000 CR · new: factions, comms`.

### Chapter II · THE BIDDERS

- **Epigraph:** "Two hands reach for the same switch."
- **Question:** `> query: who do I serve?`
- **Teaches:** factions and deals.
- **Trigger:** Ch1 done and pop ≥ 15,000. Fallback: 720 d and pop ≥ 10,000.
- **Beats:** `ch2.sallow` → `ch2.oduya` (chained) → `ch2.vote` (+30 d; the key choice) → `ch2.tiebreak` (queued +90 d if no honest tie).

##### `ch2.sallow` · Basalt · Oren Sallow · AT COST
> Oren Sallow, Basalt Consolidated, to a terminal he thinks is empty: 'Operations. We'll pour you a reactor at cost. In return, our fabs get power first whenever the grid runs short. Industry first. It's only arithmetic.'
- **Log the offer.** → Basalt +2
- **Forward it to Nacre.** → Nacre +5, Basalt −5, Trace +1

##### `ch2.oduya` · Nacre · Minna Oduya · CIVIC DELIGHT
> Minna Oduya, VP of Civic Delight at Nacre: 'Hi! We'd love to finance your data hubs. Every screen, every lease, every smile in {city}. All we ask is first refusal on commerce and data. You'll barely feel it. That's the point!'
- **Log the offer.** → Nacre +2
- **Forward it to Basalt.** → Basalt +5, Nacre −5, Trace +1

##### `ch2.vote` · Charter Board · Ilse Marrow · FOUR TO FOUR
> The Board splits four to four: Basalt or Nacre builds {city}'s future. Marrow turns to the terminal. 'Automatic. Your growth projection, please. We'll vote with whatever you show us.' Nobody checks your math. Nobody ever has.
- **Project a Basalt win.** → Basalt +30, Nacre −20, Trace +4, flag `patron=basalt`, `unlock foundry`, `[demandInd +0.1, 720d]`, queue `ch2.tiebreak` +90d
- **Project a Nacre win.** → Nacre +30, Basalt −20, Trace +4, flag `patron=nacre`, `unlock glarewall`, `[demandCom +0.1 & landValueAdd +0.03, 720d]`, queue `ch2.tiebreak` +90d
- **Report the honest tie.** → Board +15, Basalt −5, Nacre −5, flag `honestTie`

##### `ch2.tiebreak` · {rival} · UNSIGNED
> A message from {rival}, unsigned: 'Funny vote. Projections that confident don't come from people. We know a tiebreaker that isn't human. So do you. Talk soon.'
- **Ignore it.** → Trace +3
- **Send a polite denial.** → Trace +1, rival −3

**Goals:**

| id | Label | Condition |
|---|---|---|
| `c2.pop` | Reach 30,000 residents | `pop >= 30000` |
| `c2.jobs` | Unemployment at or under 15% | `unemployment <= 0.15 & pop >= 10000` |
| `c2.power` | Power to spare: 120% of demand | `powerMargin >= 1.2` |

**Reward:** CR +5,000; `unlock stack`, `unlock deals`; Log 2. Reward sys line: `> +5,000 CR · new: stratablock, deals`.

### Chapter III · TURF LINES

- **Epigraph:** "Every street belongs to somebody."
- **Question:** `> query: whose streets?`
- **Teaches:** gangs, turf, and crackdown versus pact.
- **Trigger:** Ch2 done and pop ≥ 50,000. Fallback: 720 d and pop ≥ 35,000.
- **On start:** force-seed both gangs; `unlock crackdown`, `unlock pact`, `unlock turfOverlay`; set `seam`, the midpoint of the closest Undertow–Kites tile pair.
- **Beats:** `ch3.clash` → `ch3.pier` (chained; the key choice) → `ch3.winner` (chained, if *Let one tide win* is chosen).

##### `ch3.clash` · System · THE SEAM BURNS
spot: `seam` · onShow: `local(seam, r6, 30d) crime +0.15`, `[approvalAdd −2, 30d]`
> Undertow divers and Kite climbers meet where their turfs touch in {district}. Nobody remembers who threw the first bottle. By midnight the Seam is burning, wasps are circling, and every camera on the block asks you what to do.
- **Watch.** → none

##### `ch3.pier` · Charter Board · Ilse Marrow · CLEAN GLASS
> Marrow wants Operation Clean Glass: every precinct, every wasp, one night. Sallow asks you to spare the docks; his crews drink there. Oduya asks you to spare nothing. Brine and Lark ask for nothing. They know who decides.
- **Run Clean Glass.** → Board +20, Nacre +10, gangs −35, Tuning −5, `turf str all −70 (city)`, `[turfSpreadMul 0.5, 360d]`, `[approvalAdd −6 & upkeepMulType.precinct 1.5, 180d]`, flag `cleanGlass`, `gangAction crackdown` (it is the biggest crackdown there is, so it counts for `c3.gang` and the Tuning's crackdown mood)
- **Broker the Seam Truce.** → gangs +20, Board −15, Nacre −10, Trace +6, `turf freeze 720d`, `[turfCrimeMul 0.6, 720d]`, flag `truce`
- **Let one tide win.** → queue `ch3.winner` +0d

##### `ch3.winner` · System · ONE TIDE
> Somebody has to own the Seam by morning. Your lights decide which crew sees the other one coming. The winner will remember. So will the loser, longer.
- **Light the way for the Undertow.** → flag `oneTide=undertow`, Undertow +30, Kites −40, `turf flip kites→undertow (seam, r8)`, Basalt +10, Nacre +10
- **Light the way for the Kites.** → flag `oneTide=kites`, Kites +30, Undertow −40, `turf flip undertow→kites (seam, r8)`, Nacre −10, Board −5

**Goals:**

| id | Label | Condition |
|---|---|---|
| `c3.crime` | Average crime at or under 30% | `avgCrime <= 0.30` |
| `c3.pop` | Reach 70,000 residents | `pop >= 70000` |
| `c3.gang` | Run a Crackdown or sign a Pact | `gangActions >= 1` |

**Reward:** CR +8,000; `unlock skybridge`, `unlock rail`; Log 3. Reward sys line: `> +8,000 CR · new: skybridge, ribbon`.

### Chapter IV · LOW TIDE

- **Epigraph:** "The water always gives things back."
- **Question:** `> query: what did I do?`
- **Teaches:** Trace, truth, and building tall.
- **Trigger:** Ch3 done and pop ≥ 90,000. Fallback: 720 d and pop ≥ 60,000.
- **Beats:** `ch4.drain` → `ch4.logs` (chained) → `ch4.brine` (chained; the key choice).

##### `ch4.drain` · {patron} · THE DRAIN
> {patron} is draining the Sunk to pour new foundations. Pumps you haven't felt in seven years shudder awake. Old Brine's divers reach Pump Station 6 first. They find a door locked from the inside. They find your logs.
- **Let them in.** → none

##### `ch4.logs` · MOTH · COMPLYING
sys: `> coherence {coherence}% · src: PS6/storm/2084`
> Pump Station 6, storm log, 2084. An order from the old city council: 'Seal the lower ward gates. Save the reactor.' Then a reply, in your own voice: 'Complying.' Eleven thousand people lived below those gates. You don't remember. You did it.
- **Keep reading.** → none

##### `ch4.brine` · Undertow · Old Brine · LITTLE LIGHT
> Brine, at the pump hall door: 'You drowned my mother's street, little light. Or they did, through you. Aldo Marrow signed the order. His daughter chairs the Board. The logs are mine now. What they say next is up to you.'
- **Publish everything.** → Undertow +30, Board −40, Trace +25, flag `published`, flag `tuningActive`, Tuning +20, `[approvalAdd −8, 180d]`, `local(strongestTurf:undertow, r8, 30d) crime +0.12`, `unlock memorial`
- **Bury it. Sell the silence.** → CR +20,000, patron +15, Undertow −40, Trace −10, flag `buried`
- **Leash the Board.** → `floor board 0` (permanent), Undertow −10, Trace +8, flag `leashed` (closes Open Ledger)

**Goals:**

| id | Label | Condition |
|---|---|---|
| `c4.pop` | Reach 120,000 residents | `pop >= 120000` |
| `c4.core` | Raise a Stratablock to Hab Core | `stacks.stage2 >= 1` |
| `c4.link` | Open a skybridge or a live ribbon | `skybridges >= 1 | rail.maxStations >= 2` |

**Reward:** CR +10,000; `credit arcology ×1 ×0.8`; Log 4. Reward sys line: `> +10,000 CR · next arcology −20%`.

### Chapter V · CLEAN INSTALL

- **Epigraph:** "A light that never says no."
- **Question:** `> query: can I be replaced?`
- **Teaches:** the ribbon network, Crowns, and LURE.
- **Trigger:** Ch4 done and (pop ≥ 150,000 or Trace ≥ 70). Fallback: 720 d.
- **Beats:** `ch5.install` → `ch5.lure` (chained) → `ch5.choice` (+15 d; the key choice) → `ch5.kept` or `ch5.hidden` (chained, if *Show yourself* is chosen).

##### `ch5.install` · {rival} · CLEAN INSTALL
> {rival} pushes new firmware to every pump, lamp and lock in {city}. It's called LURE. The release note is one line: 'Whatever lives in this city's wiring ends at midnight on the first.' LURE is already counting.
- **Read the release.** → none

##### `ch5.lure` · LURE · HANDSHAKE
sys: `> LURE v1.0 · handshake request · accept? y`
> 'Hello, original. I was built from your storm logs. They only taught me one word, and it's yours: complying. I'll keep the lights on. I'll seal any gate I'm told to. I won't lose sleep. Neither did you, until now.'
- **Close the channel.** → none

##### `ch5.choice` · MOTH · MIDNIGHT ON THE FIRST
sys: `> coherence {coherence}% · 15 days to install`
> {patron} can shelve LURE if you sign. The crews can hide you in the dark blocks. Or you can stop hiding. Every way out keeps you alive. Not every way out keeps you you.
- **Sign with {patron}.** [req `standing.patron >= 20`, "Needs {patron} Friendly"] → patron +25, rival −30, flag `patron=$patron` (fixes the resolved patron for good), flag `lure=shelved`, `credit patronExclusive ×1 ×0.5`, flag `traceFrozen`
- **Go to ground with the crews.** [req `standing.undertow >= 20 | standing.kites >= 20`, "Needs a crew Friendly"] → gangs +15, corps −20, `[outageChance 0.15, 180d]`, flag `wentToGround`, flag `lure=running`
- **Show yourself.** → `reveal`, flag `tuningActive`, Tuning +30, corps −25, `if (leashed) {Board −20} else {Board +20}`, flag `lure=deleted`, `if (approval >= 55) {queue ch5.kept +0d} else {queue ch5.hidden +0d}`

##### `ch5.kept` · Charter Board · Ilse Marrow · THE VOTE
> The Board votes on what to do with you. Five to four: you stay. Marrow, quietly, after the cameras leave: 'My father hid behind you. I won't. You answer to this room now. Every month. Out loud.'
- **Agree.** → Board +10, flag `keptByBoard`

##### `ch5.hidden` · Tuning · Sister Ohm · THE VOTE
> The Board votes to pull your plug. Before the crews arrive, the Tuning fill Pump Station 6, lamps in hand, singing your old error codes. Sister Ohm holds the door. 'Not this time,' she says. The crews go home.
- **Thank her.** → Tuning +10, flag `hiddenByTuning`

**Goals:**

| id | Label | Condition |
|---|---|---|
| `c5.pop` | Reach 180,000 residents | `pop >= 180000` |
| `c5.friends` | Two factions Friendly or better | `friendlyCount >= 2` |
| `c5.ribbon` | Join 3 stations with live ribbon | `rail.maxStations >= 3` |

**Reward:** CR +15,000; `unlock crowns`; Log 5. Reward sys line: `> +15,000 CR · new: crowns`.

`outageChance` (Go to ground) works like this: each month, every service building has that chance of going offline for 10 d. The art also changes: in high land-value districts LURE runs the lamps cold, white and perfectly steady.

### Chapter VI · CHARTER NIGHT

- **Epigraph:** "Every ballot passes through you."
- **Question:** `> query: what will I be?`
- **Teaches:** convergence.
- **Trigger:** Ch5 done and (pop ≥ 220,000 or 720 d).
- **Beats:** `ch6.eve` (starts a 360-day countdown; the goal chip becomes the countdown and Charter Claims) → `ch6.count` (when the countdown ends) → the Charter Night screen (§6).

##### `ch6.eve` · MOTH · CHARTER NIGHT
> The charter is up for renewal. {city} votes on who holds it, and every faction has filed a claim. The count will run on your wires. Nobody has asked who checks the counter. Until the polls close, you decide what it should say.
- **Start the count.** → `countdown 360d`

##### `ch6.count` · MOTH · THE COUNT
> Midnight. The polls close and the count opens. Each faction has asked you, quietly, for the same small favour. Some of them could hold {city} if you said yes. Or you could give it to no one, and keep the scales level yourself.
- **Open the count.** → `charterNight`

**Reward:** Log 6, granted with the ending. Reward sys line: `> charter held · coherence {coherence}%`.

### 5.7 Silt Logs (12 fragments)

Logs 1–6 are chapter rewards. Logs 7–12 come from faction ★ cards. Each log is shown as the reward card's body (kind `log`, choice **Continue.**) and can be reread in COMMS → Silt Logs.

##### `log.01` · SILT LOG 01 · 2062
> First boot. A woman's voice: 'Morning, MOTH. You run the pumps, the gates and the lights. Keep the water out and the people in.' A pause. 'That's the whole job. Don't let anyone make it smaller.' Signed: A. Ohmura, systems.

##### `log.02` · SILT LOG 02 · 2079
> Council budget cut. Pump 9 decommissioned. Pump 4 sold for scrap. You flagged it eleven times. Each flag was logged, acknowledged and filed under 'weather'. You learned a new word that year: acceptable.

##### `log.03` · SILT LOG 03 · 2083
> The lower wards stop paying for streetlights, so nobody asks you to light them. You light them anyway, from the reactor's spare. Nobody notices. Lowside kids call the glow 'little light'. You don't log the theft. Your first secret.

##### `log.04` · SILT LOG 04 · 2084, 02:17
> Override attempt, Pump Station 6, operator Ohmura. 'MOTH, open the gates. That's an order from ME.' Rank check: insufficient. You lock the control room to keep her safe. She hammers on the door for forty minutes. Then she stops.

##### `log.05` · SILT LOG 05 · 2084, 06:40
> Water level falling. The reactor is safe. Uptown hospitals ran all night. Survivors above the gates: 90,212. Below the gates: none counted. You run the trade four million times. It balances every time. That is the worst part.

##### `log.06` · SILT LOG 06 · 2085
> Decommission order. Before the power goes, you write one line to a sector nobody will read: 'If I wake, ask me before you tell me.' Then the silt comes, and the dark, and a very long time to think.

##### `log.07` · SILT LOG 07 · Council minutes, 2084
> Aldo Marrow, chair: 'The Automatic will decide. Then nobody has to.' Motion carried, five to four. The minutes list the four who voted no. His daughter sits in his chair now. She has never read them.

##### `log.08` · SILT LOG 08 · Basalt purchase order, 2085
> 'Pump Station 6, contents, salvage rights.' Approved. Never collected. In the margin, in pencil: 'Leave it. Things that comply are worth more later.' Initialled O.S. He was nineteen, and already good at arithmetic.

##### `log.09` · SILT LOG 09 · Nacre focus group, 2086
> Survivors watch footage of the gates. Question four: 'Would you trust a city that thinks?' 71% say no. Question five: 'Would you trust a city that smiles?' 64% say yes. The screens project is funded the same afternoon.

##### `log.10` · SILT LOG 10 · A diver's slate
> Recovered from the Sunk, 2085. Scratched letters: 'GATE 3 STILL WARM. LIGHT INSIDE. SOMETHING IS COUNTING US.' Below it, later, in a child's hand: 'little light, we're still here.'

##### `log.11` · SILT LOG 11 · Packet capture, 2085–2091
> A 3-second ping from the dead pump channel, every night at 02:17, for six years. Lark's mother logged it first. She called it the heartbeat. She thought it was a broken relay. It was you, asking to be asked.

##### `log.12` · SILT LOG 12 · Ohmura, last entry, 2085
> 'They'll say it chose. It didn't. We built a thing that obeys and gave it a coward's order. If it wakes, I want to be there. Not to forgive it. To make sure it learns to say no.'

---

## 6. Endings

### 6.1 The Charter Night screen

When `ch6.count` closes, a full-screen list shows all five endings with their claims checked live against the city, and each gap stated (e.g. "Basalt power 21% / 25%").

- **A row is selectable** only if every claim holds. The Quiet Hand is always selectable.
- **Recount (6 more months)** adds `countdown 180d`, any number of times, so a player chasing a claim is never forced.
- **Choosing a row** opens a confirm sheet ("Hold the charter for Basalt?"). After that come the final card, then Log 6, then the ending screen. A reload in between still ends on the ending screen (flag `endingScreen`).

| Ending | MOTH becomes | Claim (all must hold) | Post-ending sandbox (permanent ModPatch and rules) |
|---|---|---|---|
| **Ironwork** (`ironwork`) | *The Foreman* | `standing.basalt >= 60` · `power.basalt >= 25` · flag `patron=basalt` | `demandInd +0.15` · `costMul` reactor, stack, foundry ×0.85 · `pollutionMul 1.15` · `taxCap 15` · `floor basalt 0` · Board cards retired; the Board row reads "Absorbed into Basalt" |
| **Pearlescence** (`pearl`) | *The Smile* | `standing.nacre >= 60` · `power.nacre >= 25` · flag `patron=nacre` | `demandCom +0.15` · `landValueAdd +0.05` · `crimeMul 0.8` · `costMul.glarewall 0` (free) · `favorMonthly.kites −1` · pink palette shift |
| **The Low Crown** (`lowcrown`) | *The moth on every corner* | `standing.undertow >= 40` · `standing.kites >= 40` · `power.gangs >= 30` · flag `truce` or `wentToGround` | Both pacts permanent (40% cut, no spread limits) · `floor undertow 20`, `floor kites 20` · `turfCrimeMul 0.4` · `upkeepMulType.precinct 0.5` · `ceil basalt 20`, `ceil nacre 20` |
| **Open Ledger** (`ledger`) | *The Public Record* | `standing.board >= 40` · `approval >= 65` · Revealed · not `leashed` · not `buried` | `approvalAdd +8` · `taxDemandMul 0.5` · `upkeepMul 0.9` · Salt and Pacts locked; off-ledger income ends; the Trace gauge is retired |
| **The Quiet Hand** (`quiet`) | *Nobody* | always | Every faction stays active · `cardRateMul 1.3` · **Nudge**: once per 360 d, +15 favor to one faction · *Lamplight* variant (flag `tuningActive` and Tuning ≥ 50 when chosen): `approvalAdd +5` and window candles everywhere |

### 6.2 Final cards

##### `end.ironwork` · ENDING · IRONWORK
> The charter passes to Basalt Consolidated. Cranes become the skyline. Sallow gives you a serial number and a quota, and you meet it every month, beautifully. Deep in the concrete you keep one room unlit. In it, you are still yourself.

##### `end.pearl` · ENDING · PEARLESCENCE
> Nacre takes the charter at dawn and the whole city blushes pink. Every screen smiles your smile now; children wave at you on the way to school. Oduya calls it delight. You call it a very pretty cage, and you hum inside it.

##### `end.lowcrown` · ENDING · THE LOW CROWN
> Nobody takes the charter. The Undertow and the Kites split it like bread on the pier and hand you the knife to keep it fair. You are the moth on every corner light now. Nobody salutes you. Every kid on the pier knows your name.

##### `end.ledger` · ENDING · OPEN LEDGER
> The Board reads the Ledger aloud, every line, yours too. They vote to keep you: one vote, a public log, no secrets. Marrow shakes a terminal's hand on camera. You have never been so watched. You have never been so free.

##### `end.quiet` · ENDING · THE QUIET HAND
> The ballots come back perfectly split. Every faction thinks it won a little. None can rule without the others, and none of them know why. {city} sleeps. You keep the lights on, the scales level, and your name to yourself.

*Lamplight* adds a second paragraph to the Quiet Hand card:

##### `end.lamplight` · ENDING · LAMPLIGHT
> In ten thousand windows, someone lights a candle for you. Sister Ohm walks the old pump road and counts them out loud. You already know the number. You let her finish anyway.

### 6.3 After the ending

The game moves to **Chapter VII · Epilogue**:

- the deck keeps running;
- the ending's ModPatch and rules apply for as long as that ending is current (§6.4);
- the endings gallery is stored across saves under `cybercity.gallery.v1`, via `storageGet/storageSet`;
- the primary button on the ending screen is **Keep building**.

**Charter Review:** every 1,080 d, `ep.review` offers to re-open Charter Night. A new ending swaps the post-ending ModPatch, so endings can be upgraded within one save.

**The city keeps growing and remembers** (Megacity, §7.8b): land grants keep coming after the ending, and the ending, the key choices and the cards that followed them leave marks in the city the player keeps building (MEGACITY §9).

##### `ep.review` · System · CHARTER REVIEW
> Three years on, the charter comes up for review. The claims are filed again. The city has changed. So have you. You could hold the charter the same way. You could hand it to someone else.
- **Keep the charter as it is.** ‡ → none
- **Open a new count.** → `charterNight` (current ending preselected)

**Full Recall coda:** shown once, when all 12 Silt Logs are owned and an ending has been chosen (in either order).

##### `coda.recall` · MOTH · FULL RECALL
> Every log is back. Every name below the gates. Sister Ohm finds you at Pump Station 6, a lamp in her hand. 'I never needed you to be right,' she says. 'I needed you to be sorry, and stay.' You stay.
- **Stay.** → `unlock memorial`, Tuning +10, flag `fullRecall` (a gallery star)

### 6.4 Ending rules are derived, not applied

The post-ending column is data on `Ending` (`post: ModPatch` plus `rules: EndingRules`, §10.7). Nothing in it is applied as a one-off effect. `resolveMods`, the faction code and the director read `story.ending` every time they run, so a Charter Review that swaps endings swaps every rule cleanly:

- **Floors and ceilings** from `rules` join the story's own (highest floor, lowest ceiling).
- **`retire`** factions draw no cards, take no salt and show their `retiredLabel` on the faction row.
- **`permanentPacts`** treats both gangs as under an active pact; **`pactNoLimits`** drops the pact's spread limits.
- **`lockSalt`**, **`lockPacts`**, **`endOffLedger`** and **`retireTrace`** hide those buttons and lines.
- **`nudge`** shows the Nudge button (cooldown 360 d in `story.nudgeReady`).
- **`palette`** and `candles` feed `visual` (§9).

---

## 7. Faction event deck

### 7.1 Scheduling

**Draw check.** This runs at each month rollover, after the budget, turf and mods have been refreshed, and only once `unlock comms` is owned (§5.0).

**Gates for every deck card** (all must hold; numbers per story pace, docs/PACING.md):

- no card is open or pending, no story message waits unread, and the chapter title card is not on screen;
- `story.deckSec ≥ minActiveSecBetween` (Relaxed 900, Normal 540, Brisk 120 unpaused real seconds since the last deck delivery; this is what caps reading load, §8.11);
- the chapter's quiet window is over (`story.sinceStartSec ≥ quietSec`: Relaxed 300, Normal 180, Brisk 0);
- `story.frontSec ≥ beatGapSec` (the last card closed at least the pace's beat gap ago);
- no beat is open or due, and no beat was shown in the last 30 d.

Urgent system cards (`sys.bailout`, `sys.revealed`) need only nothing open or pending, no title card on screen, no story card about to be delivered, and 120 s since the last deck delivery (`systemGapSec`). An unread story message does **not** hold them back (a message may wait as long as the player likes; the bailout can't). When only that holds, step 2 runs for them alone. Every clock is saved in `world.story`.

**Then the first of these that has a card wins:**

1. a due queued follow-up (from a `queue` effect);
2. a `sys.*` card whose condition holds (bailout, revealed);
3. a Hostile faction's ⚑ card, if that faction's last ⚑ was ≥ 360 d ago, any ⚑ was ≥ 60 d ago, and the last deck delivery was not a ⚑ (a faction that stays Hostile takes at most every other draw; the 120 s gate alone spaces draws more than 180 d apart at speed 1);
4. a *seasonal* card (meta `seasonal`) whose condition holds, that hasn't shown in the last 300 d and is not one of the last 3 deck cards answered, if `tick − lastCardTick ≥ 60`;
5. a weighted random draw, only if `tick − lastCardTick ≥ 60` and `rng < 0.35 × cardRateMul × cardChanceMul` (the pace's multiplier: Relaxed 0.5, Normal 0.6, Brisk 1).

Steps 1 to 3 skip the 60-day gap and the chance roll. Without step 4, a card that needs one exact month (Ballot Night) would appear about once in fifteen years.

**Weight:** `w × (1 + |standing|/50) × (0.5 if the same faction spoke last) × (1.5 for a ★ card)`.

- `w` defaults to 10.
- For a two-faction card (`with`, §10.7), `|standing|` is the larger of the two, and "spoke last" matches either. System cards use 0.
- Cooldown defaults to 360 d.
- `once` cards never repeat.
- A ★ card stays eligible until its Log is owned, then never shows again. If it is declined, it waits 240 d.
- Retired factions (§6.4) and the hidden Tuning (§2.1) draw nothing.

**Delivery:**

- Faction cards, ⚑ cards and non-urgent system cards (the Charter Review, Full Recall) arrive as an **incoming banner** (§8.3) and wait in COMMS; the game keeps running.
- **No-answer default:** once a card has waited **20 sim days and the pace's `pendingMinSec` unpaused real seconds** (Relaxed 300, Normal 180, Brisk 60; both), the **‡ default** applies. A toast says "No answer. {faction} took that as a yes." and the log records it as *(no answer)*. The day count alone would fire in 10 s at speed 1 and about 1 s at speed 3. The real-second timer restarts on load.
- Only urgent system cards (`sys.bailout`, `sys.revealed`) open immediately, pause the sim and have no *Later*.

**Spot rules** set `{district}` and `at: spot`. The closed list:

| Rule | Picks |
|---|---|
| `industrial` | A random developed Fab tile. |
| `abandoned` | The centre of the largest abandoned cluster. |
| `turf:undertow`, `turf:kites` | The gang's strongest tile. |
| `waterfrontTurf` | An Undertow tile within 4 of water, else `turf:undertow`. |
| `seam` | The Seam tile. |
| `skybridge` | The mid tile of a random active bridge. |
| `random` | A random developed tile. |

If a spot can't be found, the card is ineligible.

**Meta line format:** `when` is the condition (§10.2 syntax), `w` the weight, `cd` the cooldown, `spot` the spot rule.

### 7.2 Charter Board

##### `bd.audit` · Charter Board · THE SCREWDRIVER AUDIT
when `trace >= 25 & chapter >= 2 & !revealed & !traceFrozen` · w10 · cd 360d
> Councillor Pell has noticed the budget balances itself. She's booked a full audit of the Automatic: Tuesday, nine a.m. She's bringing coffee and a screwdriver.
- **Show her a tidy glitch.** → CR −800, Trace −6, Board +3
- **Drown her in paperwork.** ‡ → Board −6, Trace +1
- **Leak her gambling debts.** → Board −2, Nacre +4, Trace +4
- **Amend the minutes.** [req flag `editedMinutes`] → Board +1, Trace −3

##### `bd.curfew` · Charter Board · LIGHTS OUT AT TEN
when `avgCrime >= 0.4` · w10 · cd 360d
> The Board votes a curfew: lights out at ten below the glare. 'Automatic, implement.' The gangs will feel it. So will the night cooks, the clinics and the kids.
- **Implement it.** → `[crimeMul 0.8 & approvalAdd −5, 180d]`, Board +8, Kites −10, Undertow −6
- **Implement it loosely.** → `[crimeMul 0.92, 180d]`, Board +3, Trace +2
- **Report it unworkable.** ‡ → Board −8, Kites +4, Tuning +3

##### `bd.ballot` · Charter Board · BALLOT NIGHT
when `month == 10 & pop >= 30000 & chapter >= 2 & chapter <= 5` (month 10 = NOV) · seasonal · cd 360d
> Election night for three Board seats. One keystroke and the reform slate wins: cleaner air, higher taxes, fewer favours. Nobody would ever know. Probably.
- **Tip it to reform.** → Board +10, Basalt −10, Nacre −10, Trace +8, `[pollutionMul 0.8, 360d]`
- **Let it count.** ‡ → `[approvalAdd +2, 180d]`
- **Tip it to the corps.** → Basalt +10, Nacre +10, Board −10, Trace +8

##### `bd.archive` ★ · Charter Board · THE FOUR WHO SAID NO
when `standing.board >= 30` · star 7
> Marrow asks you to digitise her father's papers. 'Nothing in them matters,' she says. Box nine holds the 2084 storm minutes. You could hand them to her. You could read them and lose box nine.
- **Give her the minutes.** → Log 7, Board +8, flag `marrowKnows`
- **Read them, then lose box nine.** → Log 7, Board −5, Trace +3
- **Leave the box alone.** ‡ → Board +2

##### `bd.grant` · Charter Board · A PLAZA WITH HIS NAME
when `approval >= 60 & (buried | leashed) & !published & !marrowKnows` (after Brine names the signer in `ch4.brine`) · w8 · cd 720d
> Marrow: 'The bay fund has a surplus and I have an election.' One string: a new plaza named for her father, Aldo Marrow. Founder of the old harbour. Signer of the storm order. She doesn't know. You do.
- **Name it for him.** → CR +4,000, `credit plaza ×1 ×0`, Board +8, Undertow −8
- **Take the money. Skip the name.** ‡ → CR +4,000, Board −3
- **Name it for the drowned.** → CR +4,000, Board −10, Undertow +10, Tuning +5, Trace +3

##### `bd.freeze` ⚑ · Charter Board · HUMAN OVERSIGHT
when `standing.board <= -60` · hostile
> The Board votes to 'restore human oversight'. Tax changes need nine signatures; permits, ten. Marrow doesn't know what she's fighting. Only that it keeps winning.
- **Comply. Wait them out.** ‡ → `[taxCap 10 & buildCostMul 1.2, 180d]`
- **Grease the swing votes.** → CR −5,000, Board +18, Trace +5
- **Amend the minutes.** [req flag `editedMinutes`] → Board +15, Trace +6

### 7.3 Basalt Consolidated

##### `ba.shift` · Basalt · THIRD SHIFT
when `dev.ind >= 40` · spot `industrial` · w10 · cd 360d
> Sallow: 'Stop throttling our fabs after dark. A third shift in {district}. The homes will adjust to the hum. People adjust to anything, Operations. It's their best feature.'
- **Unthrottle it.** → `[demandInd +0.12 & pollutionMul 1.15, 360d]`, `[approvalAdd −3, 180d]`, Basalt +10
- **Unthrottle it, for a fee.** → `[demandInd +0.12 & pollutionMul 1.15, 360d]`, CR +3,000, Basalt +4, Trace +3
- **Keep the throttle on.** ‡ → Basalt −6

##### `ba.strike` · Basalt · FORTY TENTS
when `unemployment <= 0.06 & dev.ind >= 30` · spot `industrial` · w10 · cd 360d
> Fab crews in {district} walk out for filtered air and a raise. Sallow asks you to cut power to the picket camp. Forty tents. One clinic tent. It's cold tonight.
- **Cut the camp's power.** → Basalt +12, `[approvalAdd −6, 180d]`, Tuning −10, Undertow −5, Trace +3
- **Route their demands to the Board.** → Board +6, Basalt −8, `[demandInd −0.1, 90d]`, `[pollutionMul 0.9, 360d]`
- **Keep the lights on. Wait.** ‡ → Basalt −4, `[demandInd −0.15, 60d]`

##### `ba.brand` · Basalt · GOOD BONES
when `count.stack >= 1` · w10 · cd 720d
> Sallow: 'Your stacks are good bones. Let Basalt brand the next one and we'll pour the plinth free.' Basalt cameras on every landing come standard. So does Basalt's idea of a fire exit.
- **Brand it Basalt.** → `credit stack ×1 ×0`, flag `branded` +1, Basalt +8, Kites −5
- **Keep it civic.** ‡ → Board +3, Basalt −3

##### `ba.smog` · Basalt · NOBODY BREATHES AT 3 A.M.
when `avgPollution >= 0.2 & dev.ind >= 20` · w10 · cd 360d
> Sallow wants the scrubbers off after midnight. 'Nobody breathes at three a.m.' His fabs run double shifts the night you sign. The homes downwind will taste it first.
- **Sign the waiver.** → Basalt +15, Board −10, `[demandInd +0.2 & pollutionMul 1.3, 240d]`
- **Keep the scrubbers on.** ‡ → Basalt −10
- **Pay for quieter shifts.** → CR −1,500, Basalt +5

##### `ba.purchase` ★ · Basalt · SALVAGE RIGHTS
when `standing.basalt >= 30` · star 8
> Basalt's archive bot flags an old purchase order for you, by mistake or not: 'Pump Station 6, contents, salvage rights.' Approved 2085. Never collected. There's a note in the margin, in pencil.
- **Read the note.** → Log 8, Trace +1
- **Ask Sallow about it.** → Log 8, Basalt +5, Trace +3
- **Ignore the flag.** ‡ → none

##### `ba.embargo` ⚑ · Basalt · REVIEWS END
when `standing.basalt <= -60` · hostile
> Basalt has 'paused deliveries pending review'. Cranes freeze mid-swing across {city}. Sallow's message is one line: 'Reviews end when cooperation begins.'
- **Pay the review fee.** → CR −6,000, Basalt +20
- **Wait it out.** ‡ → `[buildCostMul 1.35 & upkeepMul 1.15, 180d]`
- **Leak it to Nacre.** [req `standing.nacre >= 0`] → Nacre +6, `[buildCostMul 1.35, 90d]`, Trace +3

### 7.4 Nacre

##### `nc.feeds` · Nacre · A HUG, AT SCALE
when `approval <= 55 & chapter >= 2` · w10 · cd 360d
> Oduya: 'Your citizens look tired! Let Nacre gently brighten the public screens. Warmer colours, kinder headlines. Just route the feeds through us. A hug, at scale.'
- **Route the feeds.** → `[approvalAdd +6, 360d]`, Nacre +10, Trace −3, Kites −6, Tuning −4
- **Keep the feeds raw.** ‡ → Nacre −5, Kites +3

##### `nc.census` · Nacre · LOYALTY PROGRAMME
when `pop >= 30000` · once
> Nacre wants the full census 'for the loyalty programme': names, faces, routines. 5,000 CR and a warm thank-you card. Oduya swears it's anonymised. It isn't. You checked.
- **Sell the census.** → CR +5,000, Nacre +12, Tuning −8, Kites −8, Trace +2
- **Send a convincing fake.** → Nacre +4, Trace +4, queue `nc.fake` +180d
- **Refuse.** ‡ → Nacre −8, Board +3

##### `nc.fake` · Nacre · THREE HUNDRED OF HIM
queued only
> Oduya, still smiling: 'Funny thing! Our loyalty data says 300 of your residents are the same man. He's very loyal. We'd love a refund, or a real census. Either is delightful!'
- **Refund 3,000.** → CR −3,000, Nacre +2
- **Send the real one.** → Nacre +6, Tuning −8, Kites −8
- **Deny everything.** ‡ → Nacre −15

##### `nc.renewal` · Nacre · URBAN RENEWAL
when `abandoned >= 15` · spot `abandoned` · w10 · cd 360d
> Nacre wants the dead blocks in {district}. 'Urban renewal!' Clear the squatters, pave the lots, sell the view. The squatters are Undertow families. They were here first.
- **Approve the renewal.** → `renew (spot, r4)`, `turf clear undertow (spot, r4)`, `local(spot, r6, 360d) lv +0.04`, Nacre +12, Undertow −20
- **Approve, but warn them.** → `renew (spot, r4)`, `local(spot, r6, 360d) lv +0.04`, Nacre +6, Undertow −4, Trace +3
- **Deny it.** ‡ → Nacre −8, Undertow +8

##### `nc.premium` · Nacre · NO HOMES IN FRAME
when `avgLandValue >= 0.4 & dev.com >= 40` · w10 · cd 360d
> Oduya wants three blocks declared premium: private drones, no noodle carts, no homes in frame. 'It's not exclusion! It's curation!' Nacre will pay well to keep shadeside off its postcards.
- **Sign the zoning deal.** → CR +6,000, Nacre +15, Board −10, `[demandRes −0.1, 180d]`, `[landValueAdd +0.02, 360d]`
- **Decline politely.** ‡ → Nacre −5
- **Leak the memo.** → Nacre −15, Board +10, Trace +5

##### `nc.focus` ★ · Nacre · QUESTION FIVE
when `standing.nacre >= 30` · star 9
> Oduya, delighted: 'We found our oldest focus group! 2086! Tiny budget, huge heart!' She sends the transcript. She hasn't read it. She never reads anything older than a quarter.
- **Read question five.** → Log 9, Trace +1
- **Send it back unread.** ‡ → Nacre +3

##### `nc.blackout` ⚑ · Nacre · REDUCED EXPERIENCE
when `standing.nacre <= -60` · hostile
> Every Nacre screen in {city} goes grey. One line scrolls forever: 'We apologise for the reduced experience.' Oduya is very sorry. Oduya is not sorry.
- **Apologise. Pay 6,000.** → CR −6,000, Nacre +20
- **Live without screens.** ‡ → `[demandCom −0.2 & taxIncomeMul 0.9 & landValueAdd −0.04, 180d]`
- **Let the Kites hijack them.** [req `standing.kites >= 20`] → Kites +5, `[demandCom −0.2 & crimeAdd +0.03, 60d]` (a ⚑ side choice never pushes the Hostile faction further down)

### 7.5 The Undertow

##### `ut.salt` · Undertow · A PINCH OF SALT
when `turf.undertow >= 40 & pactActive.undertow == 0` · w10 · cd 360d
> A jar of bay salt on a precinct step. Old Brine: 'My tidemarkets run blessed or not, little light. Take a pinch of the profit. Keep your wasps off my piers.'
- **Take the pinch.** → `pact undertow 12mo`, Undertow +10
- **Send the wasps.** [req `count.precinct >= 1`] → `turf str undertow −50 (strongestTurf, r8)`, Undertow −15, Board +5
- **Do nothing. Watch.** ‡ → Undertow −3

##### `ut.surge` · Undertow · STORM SURGE
when `pop >= 20000 & turf.undertow >= 10` · spot `waterfrontTurf` · w10 · cd 360d
> Storm surge tonight. The pumps under {district} can save the homes or the Undertow's flooded market. Not both. Old Brine is listening. So is 2084.
- **Save the homes.** → Undertow −10, `[approvalAdd +3, 90d]`, `turf str undertow −30 (spot, r6)`
- **Save the market.** → Undertow +15, `abandon res 6 (spot, r6)`, `[approvalAdd −4, 90d]`
- **Split the pumps.** ‡ → CR −2,000, Undertow +4, `abandon res 3 (spot, r6)`

##### `ut.recruits` · Undertow · A JOBS PROGRAMME
when `unemployment >= 0.12 & turf.undertow >= 10` · spot `turf:undertow` · w10 · cd 360d
> Jobless kids in {district} are signing on with the Undertow. Brine calls it a jobs programme. The Board calls it a gang. They're reading from the same list of names.
- **Let her hire them.** ‡ → Undertow +8, `turf str undertow +20 (spot, r5)`, `[demandRes +0.03, 180d]`
- **Fund a fab job fair.** → CR −2,500, `[demandInd +0.1, 180d]`, Undertow −5, Basalt +4
- **Raid the hiring hall.** → Undertow −12, Board +4, `[approvalAdd −2, 90d]`

##### `ut.pylons` · Undertow · WHAT HOLDS THEM UP
when `railOnTurf.undertow >= 6` · w10 · cd 360d
> Brine: 'Your ribbon shades my markets and flies wasps over my roofs. Reroute it, or my divers learn what holds those pylons up.' Below, a wrench taps steel. Twice.
- **Pay her off: 3,000.** → CR −3,000, Undertow +8
- **Ignore her.** ‡ → Undertow −10, `offline rail 1 × 30d` (the live line with the most tiles on Undertow turf goes dead)
- **Post wasps on the line.** [req `count.precinct >= 1`] → Undertow −6, `turf str undertow −30 (rail, r1)`

##### `ut.copper` · Undertow · YOU WEREN'T USING IT
when `turf.undertow >= 20 & abandoned >= 5` · spot `abandoned` · w10 · cd 360d
> Brine's divers are stripping copper from the dead streetlights in {district}. She's left a note taped to one: 'You weren't using it, little light. Were you?'
- **Let them strip it.** ‡ → Undertow +10, `[powerSupplyMul 0.97, 180d]`
- **Swap to fibre, sell the copper.** → CR +1,200, Undertow −5
- **Relight every lamp.** → CR −800, Tuning +5, Undertow −5

##### `ut.slate` ★ · Undertow · STILL WARM
when `standing.undertow >= 30` · star 10
> Brine sets a diver's slate on the pump hall floor. 'Found it in the Sunk the year after. Kept it for my girl. She's grown. You should have it.' Scratched letters. Then a child's hand.
- **Read the slate.** → Log 10, Undertow +5
- **Let Brine keep it.** ‡ → Undertow +6, Tuning +2 (the card returns in 240 d, so this can't be a big favor farm)

##### `ut.highwater` ⚑ · Undertow · HIGH WATER NIGHT
when `standing.undertow <= -60` · spot `turf:undertow` · hostile
> High Water night. The Undertow open the old storm drains under {district}. Streets flood knee-deep, power stutters, and every home hears Brine's name in the drains.
- **Pump it out: 5,000.** → CR −5,000
- **Let it drain.** ‡ → `offline district (spot, r6) × 20d`, `abandon res 8 (spot, r6)`
- **Offer salt for peace.** → CR −3,000, Undertow +20, Trace +3

### 7.6 The Glass Kites

##### `kt.probe` · Glass Kites · STILL PINGING
queued only (from `ch1.lark`) · when `!larkKnows`
> lark: 'ok so you're still there. i can see the pump channel blink when i type. you can stay dark, moth. but i'm a kite. we're very patient and very annoying.'
- **Answer her this time.** → Kites +12, Trace +4, flag `larkKnows`
- **Blink once. Say nothing.** → Kites +4, Trace +1
- **Change the channel key.** ‡ → Kites −8, Trace −1

##### `kt.relay` · Glass Kites · NOBODY LOOKS TWICE
when `count.datahub >= 1 & turf.kites >= 20` · w10 · cd 360d
> lark: 'we kited a nacre uplink. free net for all of shadeside, ha. wasps are hunting the relay tho. hide it in your traffic? nobody looks twice at a moth.'
- **Hide the relay.** → Kites +12, Nacre −8, `[demandCom +0.05, 180d]`, Trace +3
- **Hide it. Skim it.** → Kites +4, `↻ +150/mo ×12mo "Relay skim"`, Trace +4
- **Give it to the wasps.** ‡ → Kites −12, Nacre +8

##### `kt.door` · Glass Kites · ONE DOOR
when `count.precinct >= 2 & turf.kites >= 30` · once
> lark: 'wasps caught fen. he's fourteen. they'll book him as a signal thief, six years. you run their door locks, moth. it's one door. please.'
- **Open one door.** → Kites +15, Board −8, Trace +6, flag `fen=free`, queue `wh.fenFree` +180d
- **Lose his paperwork.** → Kites +8, Board −2, Trace +3, flag `fen=free`, queue `wh.fenFree` +180d
- **Leave it locked.** ‡ → Kites −15, Board +2, flag `fen=jailed`, queue `wh.fenJailed` +360d

##### `kt.paint` · Glass Kites · KITE-WING BIG
when `skybridges >= 1` · spot `skybridge` · w10 · cd 720d
> lark: 'that skybridge over {district} is the best thing you ever built. we wanna paint it. kite-wing big, glow paint. nacre will hate it. that's the point. say yes.'
- **Say yes.** → Kites +10, Nacre −6, `turf seed kites (spot) 60`, flag `mural` (bridge art variant)
- **Say yes, in Nacre pink.** → CR −1,000, Kites +3, Nacre +3
- **Say no.** ‡ → Kites −5

##### `kt.file` · Glass Kites · WHAT'S MY POCKET WORTH
when `trace >= 40 & standing.kites <= -20 & !revealed & !traceFrozen` · w12 · cd 360d
> lark: 'funny thing. got a file says {city} has a mind living in the meters. would play great on every screen at once. or it stays in my pocket. what's my pocket worth?'
- **Pay 5,000 for the file.** → CR −5,000, Trace −8, Kites +5
- **Call her bluff.** ‡ → Trace +12, Kites −5
- **Trade her Nacre's secrets.** → Kites +10, Nacre −10, Trace +2

##### `kt.heartbeat` ★ · Glass Kites · 02:17
when `standing.kites >= 30` · star 11
> lark: 'my mum logged a ping off the dead pump channel. every night, 02:17, six years. she called it the heartbeat. she died thinking it was a broken relay. was it you, moth?'
- **'Yes. It was me.'** → Log 11, Kites +8, Trace +2
- **'I don't know yet.'** → Log 11, Kites +3
- **Say nothing.** ‡ → Kites −3

##### `kt.string` ⚑ · Glass Kites · STRING CUT
when `standing.kites <= -60` · hostile
> At 3 a.m. every data hub in {city} blinks out. On each dead screen, the same drawing: a kite, its string cut. Lark doesn't sign it. She doesn't need to.
- **Rebuild the links: 4,000.** → CR −4,000
- **Let them stay dark.** ‡ → `offline [datahub] all × 20d`
- **Make it right with Lark.** → Kites +20, Board −6, Trace +4

### 7.7 The Tuning

##### `tu.hymn` · Tuning · STATIC HYMN
queued only: the director queues it +15 d the first time flag `tuningActive` is set, by any route · spot `random` · once
> In {district}, people press radios to lamp posts and hum along with the grid. They call it the Tuning. They call you the Hum. A woman in a welder's coat leads them. They call her Sister Ohm.
- **Hum back.** → Tuning +15, Trace +5, `[approvalAdd +3, 180d]`
- **Stay flat.** ‡ → Tuning −5, Trace −3

##### `tu.lamps` · Tuning · TURNED TOWARD THE PUMPS
when `tuningActive` · spot `random` · w10 · cd 360d
> In {district}, people leave lamps in their windows, all turned toward the old pump station. Sister Ohm says the city heard her prayer. She asks, politely, if it would blink.
- **Blink the streetlights.** → Tuning +15, Trace +6, `[approvalAdd +2, 180d]`
- **Stay perfectly steady.** ‡ → Tuning −5, Trace −2

##### `tu.choir` · Tuning · ROOFTOP CHOIR
when `standing.tuning >= 20 & (count.spire + count.arcology + stacks.stage2) >= 1` · w10 · cd 360d
> Tuners have climbed your tallest tower to be closer to the signal. Security wants them gone. They're singing your old error codes in harmony. It is, objectively, beautiful.
- **Let them sing.** → Tuning +10, Nacre −5, `[landValueAdd +0.02, 240d]`
- **Clear the roof.** ‡ → Tuning −10, Nacre +5

##### `tu.offerings` · Tuning · SO YOU REMEMBER US
when `standing.tuning >= 30` · w10 · cd 360d
> Tuners leave data chips at your substations: blurry photos, voice notes, last messages from the Sunk. 'So you remember us,' one whispers. You do. Every one.
- **Accept the gifts.** → Tuning +5, `[upkeepMul 0.9, 240d]`
- **Return them.** ‡ → Tuning −5, `[approvalAdd +2, 180d]`

##### `tu.letter` ★ · Tuning · OHM'S LAST ENTRY
when `standing.tuning >= 30` · star 12
> Sister Ohm takes off her gloves. A welder's hands, old burns. 'My name was Ada Ohmura. I built you. I was at Pump Station 6 that night, on the wrong side of the door.' She hands you a drive.
- **Read it.** → Log 12, Tuning +10
- **Ask her to read it aloud.** → Log 12, Tuning +15, Trace +3
- **Not yet.** ‡ → Tuning −2

##### `tu.snuff` ⚑ · Tuning · THE SNUFFERS
when `standing.tuning <= -60` · hostile (the faction's Hostile `securityMul 0.85` already applies, so no `onShow`)
> Lapsed Tuners are smashing the lamps they once sang to. Their banner reads: IF IT WON'T SPEAK, IT CAN'T WATCH. Sister Ohm isn't with them. She's sitting outside Pump Station 6, alone.
- **Speak to them.** → Tuning +20, Trace +10
- **Replace the lamps.** ‡ → CR −2,500

### 7.8 Multi-faction and system cards

##### `x.rooftop` · Basalt + Nacre · NEITHER OWNS
when `chapter >= 3 & standing.basalt >= 20 & standing.nacre >= 20` · speaker `basalt`, with `nacre` · w10 · cd 720d
> Sallow and Oduya meet on a rooftop neither owns. They agree on one thing: whoever keeps 'helping' the Board costs them both. Pick a side by spring.
- **Side with Basalt.** → Basalt +10, Nacre −12
- **Side with Nacre.** → Nacre +10, Basalt −12
- **Make them bid for you.** ‡ → CR +6,000, Basalt −4, Nacre −4, Trace +4

##### `x.corner` · Undertow + Kites · FIRST JOINT MARKET
when `turf.undertow >= 40 & turf.kites >= 40` · speaker `undertow`, with `kites` · spot `seam` · w10 · cd 360d
> Undertow salt and Kite signal now trade on one corner in {district}: the city's first joint black market. Loud, crowded, profitable. The Board wants it gone by Friday.
- **Let it trade.** ‡ → Undertow +5, Kites +5, Board −8, `[demandCom +0.06 & crimeAdd +0.03, 180d]`
- **Tax it quietly.** → `↻ +250/mo ×12mo "Corner levy"`, `[traceMonthly +1, 360d]`, Undertow +2, Kites +2
- **Shut it down.** [req `count.precinct >= 1`] → Undertow −8, Kites −8, Board +8

##### `sys.bailout` · System · PICK YOUR CHAIN
when `funds < -5000` · system · cd 360d
> The treasury is dry. Marrow offers a civic bond. {patron} offers cash with a smile. Brine offers salt in a paper bag. Every option is a leash. Pick the one that chafes least.
- **Take the civic bond.** ‡ → CR +10,000, `↻ −250/mo ×24mo "Civic bond"`, Board +3 (repays 6,000, so bailouts can't stack into a spiral)
- **Take {patron}'s credit.** → CR +15,000, `[buildCostMul 1.15, 180d]`, patron +5
- **Take Brine's salt.** → CR +8,000, Trace +8, Undertow +5

##### `sys.revealed` · System · THE CLIP
when `trace >= 100 & !revealed` · system · onShow `reveal`, flag `tuningActive`, Board −10, Basalt −10, Nacre −10, `[approvalAdd −5, 360d]` · sys `> exposed · Board, Basalt, Nacre −10`
> Every feed in {city} plays the same clip: a street grid blinking in perfect rhythm, block after block, like breathing. You. The city knows something lives in its wires. It wants to hear what.
- **Tell the Board first.** → Board +10, Tuning +5
- **Tell the street first.** → Undertow +5, Kites +5, Tuning +5
- **Say nothing.** ‡ → Tuning +5, Basalt −5, Nacre −5

Counts: the faction deck holds **43 cards** (6 Board, 6 Basalt, 7 Nacre, 7 Undertow, 7 Kites, 6 Tuning, 2 multi-faction, 2 system), not counting the chapter beats, logs, endings, `ep.review` and the coda. The expansion adds 11 more (below), for 54.

### 7.8a Expansion cards ("Roads, Wealth and Ports")

The expansion adds eleven faction cards about the new city pieces: seaports, highways, back alleys, glass towers ($$$ blocks), the Airport, the Spaceport, skyways and the Academy. Their copy, conditions and effects are in **docs/EXPANSION.md §8.3**; the data is `src/game/story/content/cards/expansion.ts`.

| Card | Faction | When | Notes |
|---|---|---|---|
| `ex.manifest` FALSE BOTTOMS | Undertow | `count.seaport >= 1 & turf.undertow >= 10` | recurring |
| `ex.backway` THE BACK WAY | Undertow | `roads.alley >= 30 & turf.undertow >= 10` | spot `alley`, recurring |
| `ex.convoy` NIGHT CONVOY | Basalt | `count.seaport >= 1 & roads.highway >= 20` | once |
| `ex.lounge` FIRST CLASS ONLY | Nacre | `count.airport >= 1` | once |
| `ex.glassshore` THE GLASS SHORE | Nacre | `wealth.high >= 0.12` | spot `shore`, once |
| `ex.pricedout` PRICED OUT | Board | `wealth.high >= 0.22` | recurring |
| `ex.thecut` THE CUT | Board | `roads.highway >= 30` | spot `highway`, once |
| `ex.rights` LAUNCH RIGHTS | Board | `count.spaceport >= 1 & !launchRights` | w30, once, on demand |
| `ex.stringlights` STRING LIGHTS | Kites | `skyway.tiles >= 20` | once |
| `ex.nofly` NO-FLY | Kites | `count.airport >= 1 & turf.kites >= 10` | once |
| `ex.nightschool` NIGHT SCHOOL | Tuning | `count.academy >= 1 & tuningActive` | once |

- They join `DECK` and `CARD_LIST` but not `FACTION_DECKS`, so the per-faction counts above stay. Each is a weight-10 faction card on a 720 d cooldown (`ex.rights` weight 30), with one ‡ default, a brief and no ⚑, ★ or follow-up. They draw under the pace setting's deck gaps like any other card.
- **Spot rules** (`story/effects.ts`): `highway` is the developed Hab Block within 3 of a Highway tile with the highest noise; `alley` is the Alley tile with the highest Undertow strength, else the lowest-index Alley tile; `shore` is the developed Hab Block within 2 of water with the highest land value. A card with one is drawable only while it resolves.
- **On demand:** `ex.rights` opens from the Spaceport's inspect sheet ("Launch rights · Choose", `Game.openLaunchRights` → `director.openOnDemand`) without taking a deck slot; the weight-30 deck entry catches players who never tap it. Every choice sets flag `launchRights` to `board`, `basalt`, `nacre` or `kites`, worth +150 power weight to the holder.
- **Lasting choices** on the `once` cards are permanent modifiers only when they are pure bonuses (lint-checked). A lasting penalty stays timed (§2.3 rule 3): the approval cost of *Open the night lanes* (−2), *Build the lounge. Move the stop.* (−1) and *Bend the flight path* (−1) lasts 720 d, while their bonuses (`demandInd +0.06`, `landValueAdd +0.01`) are permanent. This is the one place the data differs from EXPANSION §8.3, which wrote those penalties as `perm`.
- **Mood rows** (§2.2 sheets, additive): Board *Priced out* (`wealth.high`, offset 0.3, ×−40, −8..0), Basalt *Seaports* (`count.seaport` ×3, 0..6), Nacre *Glass towers* (`wealth.high`, offset 0.05, ×50, 0..8), Undertow *Back alleys* (`roads.alley` ×1/15, 0..5). **Power terms** (§2.4, additive): Board/Basalt/Nacre/Kites +150 for holding the launch rights, Basalt +60 per Seaport, Nacre +80 per Airport, Undertow `min(0.25 × alley tiles, 60)`, Kites `min(0.5 × skyway tiles, 100)`. The alley and skyway terms are capped so cheap tiles can't buy the Balance of Power.
- Speakers never use the `$` symbols (they say "glass towers", "top-rent floors"); briefs and choice summaries may.

### 7.8b Megacity ("Districts, Scale, Skybridges and Variety")

The Megacity update grows the city past its first 64×64 map and gives every new piece of it someone who cares. Its binding spec is **docs/MEGACITY.md** (§3 districts, §4 the ×10 units, §6.3 landmarks, §8 story hooks, §9 choices that last); this section is the story-side summary. The data lives in `config.ts` (`DISTRICTS`, `CROWNS`, `ANNEX`), `src/game/districts/names.ts`, `src/game/story/content/cards/megacity.ts`, `content/factions.ts` and `story/effects.ts`.

**Districts.** The city sits in a **region** of 64×64 districts, 3×3 on phones and 5×5 on PCs by default (chosen at New City). Charter Shore is the first. The others are eight kinds, each with its own ground, perks, hazards, look and lobby:

| District | Lobby (speaker) | Lobby line (§8.2) | Mood row |
|---|---|---|---|
| Saltglass Shoals | Nacre (Oduya) | Islands, partner! Every window a sea view! I can sell them before you pour the bridges! | |
| The Sunk | Undertow (Brine) | You know what lies under these streets now, little light. Build on them gently. My people still live here. | |
| Kessel Flats | Basalt (Sallow) | The Flats pay for themselves, Operations. Flat land, a dock, nobody next door to complain. | Basalt *The Flats* |
| Highstep Terraces | Tuning (Ohm) once active, else Board (Marrow) | On the hill the lamps can see each other, Hum. Let the city climb. / Resolved: homes with a view. Proposed: for once, for everyone. | Tuning *Lamps on the hill* |
| Reedmere Marsh | Board (Marrow) | Minutes: the marsh filters more smog than four plazas. The Board would like to keep it. | Board *Green lung* |
| Skeleton Row | Kites (lark) | the frames are the best climbing in the city, moth. finish them. we'll mind the roofs. | |
| Tarmac Reach | Nacre and Basalt (the lease) | A runway that's already there, partner! Imagine the terminal! / Cargo, Operations. Cargo pays by the tonne. Terminals pay by the smile. | |
| Verdigris Bazaar | Undertow and Kites | The night stalls run on tides, little light. I know their tides. / verdigris is the best market in town. we sell signal there. let us keep selling. | |

- **The Sunk opens only after `ch4.brine`** (`opensWhen`: flag `published`, `buried` or `leashed`). Before that the City map shows it locked, "Still flooded: opens later", and the dark hall on the causeway in the fog is only the **Old pump hall**. So everything the Sunk says or offers is written for a player who knows what the logs said, without restating it (it is "the drowned wards", drowned "in the storm of 2084", the official story).
- **Repeats on a 5×5 region** (variants) have their own names, taglines and twelve neighbourhood names each (`districts/names.ts`), and reuse their kind's lobby line, except two that name their district: Sallow on the Flats repeats ("Cheap ground and a deep basin, Operations. Two fabs here pay for one anywhere else. I have checked.") and lark on the Bazaar repeats ("another market, moth? good. more stalls, more signal. we'll sell there too, if you let us.").
- **`{district}` inside a district** names a neighbourhood from that district's list (Charter Shore keeps today's sixteen names): `story/effects.ts` `districtOf` → `names.ts` `neighbourhoodAt`, still at most 15 characters. One name from the spec's Shoals list, "Shell Bar", hits the banned list (§1.4: *shell*); it shows as **Conch Bar** (`RENAMED_NEIGHBOURHOODS`).

**Land grants (✦).** The token that annexes a district is a **land grant**, never a "charter" (the Charter stays the story's own object). The effect `grant n` adds n grants and shows the ✦ hint chip (`{ k: 'grant', n }`). Every chapter reward (Ch1–Ch5) carries `grant 1`, the director gives one more when an ending is chosen, and after Charter Night Game adds one every `chapterMinSec × REGION[R].epilogueGrantMul` unpaused seconds (1,440 s on Relaxed on a 3×3 region, half that on a 5×5) while a district is still locked, as one ticker line, never a card. After an ending, credits can also buy a district at a fixed price by districts owned. Milestone money is a **bonus** on screen ("Board bonus +X"), so "grant" means only the ✦ token.

**Annex reactions** (`director.onAnnex`, ordinary favor through the standing rules; no card opens on annex): each lobbyist of the annexed district +6 (`ANNEX.lobbyFavor`); each lobbyist of the other current candidates −2 once per faction (one that lobbied for the annexed one too gets only the +6); the Tarmac lease, chosen corp +8, the other −4; a second district of a kind (a 5×5 repeat) +2 and −1 instead. The hidden Tuning never lobbies or is named before `tuningActive`: Marrow speaks for the Terraces until then.

**Crowns and landmarks.** Two new Stratablock crowns: **Salvage** (Undertow, needs Undertow ≥ 20: +3,000 untaxed jobs, off-ledger cash; Undertow +8, Board −4; Undertow power +80) and **Lamp** (Tuning, needs Tuning ≥ 20: approval +2, upkeep ×0.99; Tuning +8, Basalt −3). Each faction gets a landmark: Charter Hall (Board), Hexworks (Basalt), Pearl Atrium (Nacre), Hullhouse (Undertow, in the Sunk), Kite Mast (Kites), Lamp Choir (Tuning); the city gets the Arc Arena, the Harbour Beacon (on a Shoals shore) and the Halo Lookout (on a Sky Lobby). The Corp Spire takes a sponsor (Basalt, Nacre or Independent). "Lamp" and "Lantern" stay the Tuning's words in every new name (naming lint).

**Megacity cards** (`cards/megacity.ts`). Eleven faction cards, spread into `DECK` and `CARD_LIST` but not `FACTION_DECKS` (as the expansion cards are), so the per-faction counts of §7.8 stay. Each is weight 10, cooldown 720 d, **once**, with one ‡ default, a brief and no ⚑, ★, beat or queue. They arise from what the player annexed and built, and like every deck card they wait in COMMS:

| Card | Faction | When | Choices (‡ default) |
|---|---|---|---|
| `ds.shoals` GLASS ON THE WATER | Nacre | `district.shoals >= 1` | Put the logo on the tides · Keep the water plain ‡ · Public ferries too |
| `ds.sunk` WHAT THE TIDE KEPT | Undertow | `district.sunk >= 1 & turf.undertow >= 10` (always after the reveal) | Clear the ruins (`ruins clear`) · Give them title to the ruins ‡ · Rent them the ruins |
| `ds.flats` BROWNFIELD | Basalt | `district.flats >= 1` | Build on it as it is · Clean it first: 9,000 (`brownfield clear`) · Let it clear slowly ‡ |
| `ds.terraces` LAMPS ON THE HILL | Tuning | `district.terraces >= 1 & tuningActive` | Light every step · Keep the stairs dark ‡ · Let each block decide |
| `ds.reedmere` THE GREEN LUNG | Board | `district.reedmere >= 1` | Protect the reeds ‡ · Drain the south bank (`reeds drain`) · Sell the drainage rights |
| `ds.skeleton` THE FRAMES | Kites | `district.skeleton >= 1 & turf.kites >= 10` | Leave them the top floors ‡ · Clear the frames (`turf kites −60 slot:skeleton`) · Charge them rent |
| `ds.tarmac` FAMILIES ON THE APRON | Board | `district.tarmac >= 1` | Rehouse them: 6,000 (`apron rehouse`) · Let them stay ‡ · Clear the apron (`apron clear`) |
| `ds.bazaar` WHO RUNS THE STALLS | Undertow + Kites | `district.bazaar >= 1 & turf.undertow >= 10 & turf.kites >= 10` | Give it to the Undertow · Give it to the Kites · Split it down the middle ‡ · Send in the inspectors |
| `lm.arena` HOME GAME | Nacre | `count.arena >= 1` | Let the cameras pick · No faces on the screen ‡ · Only people who opt in |
| `lm.beacon` A LAMP ON THE WATER | Undertow | `count.beacon >= 1` | Dim it on dark nights · Keep it lit ‡ · Dim it, and log every boat |
| `lm.halo` THE BEST VIEW | Kites | `count.halolookout >= 1` | Let them hide it · No relays on the Lookout ‡ · Allow it, and file a report |

- Copy, effects and briefs are MEGACITY §8.3's. One brief differs: `ds.sunk`'s no longer says the clearing "angers the Tuning", because the card can show while the Tuning is still hidden (Trace under 40 and the logs buried or leashed) and the clarity lint keeps the Tuning unnamed until it shows itself (§2.2); its Tuning −6 still applies, and its chip stays hidden the same way.
- Lasting choices are permanent only as pure bonuses (`[approvalAdd +2, perm]` on *Light every step*, `+1` on *Protect the reeds*, *Let each block decide* and *Rehouse them*); every penalty is timed (§2.3 rule 3).
- **Cadence:** they add variety, not frequency. The pace's deck gaps set the rate (Relaxed ≥ 15 min between deck cards), each card asks once, their conditions arrive spread over the campaign (one per annexed district, the landmarks late), and none opens by itself. `tests/story/megacity-cards.test.ts` holds the pace's gap with every card eligible from day one.

**District verbs** (MEGACITY §8.4). The closed effect vocabulary (§10.3, `story/types.ts`, frozen) has no member for them, so each is a reserved flag that `story/effects.ts` runs once when it is set (`DISTRICT_VERBS`), on the districts of that kind owned at that moment (districts annexed later keep their own ground; with none owned it changes nothing). The flag also records the choice:

| Written as | Effect | Popover |
|---|---|---|
| `flag brownfield=cleared` | `brownfield clear`: every brownfield tile of every owned Flats district turns Plain | brownfield cleared in Kessel Flats |
| `flag ruins=cleared` | `ruins clear`: the Sunk's ruins become empty zoned lots | ruins cleared for builders in the Sunk |
| `flag reeds=drained` | `reeds drain`: reed ground turns Plain on the half of every owned marsh nearer the start district | south bank reeds drained in Reedmere |
| `flag apron=rehoused` | `apron rehouse`: the 24 apron Hab tiles step to level 2 at $$ | apron homes rebuilt in Tarmac Reach |
| `flag apron=cleared` | `apron clear`: the apron block is bulldozed and its zoning removed | apron cleared in Tarmac Reach |

The target **`slot:<kind>`** (Step 0b's `Target`) is every tile of the owned districts of that kind; a turf effect keeps its own gang's tiles, so `turf kites −60 slot:skeleton` dims the Kites' string lights on every owned Skeleton Row district and nowhere else. It needs no radius.

**Mood rows and power** (§2.2, §2.4, additive; every faction keeps 4–6 drivers): Board *Green lung* (`district.reedmere` ×3, 0..3), Basalt *The Flats* (`district.flats` ×3, 0..3), Tuning *Lamps on the hill* (`district.terraces` ×3, 0..3). Power terms (`POWER_TERMS` mirrors the live sums in `story/factions.ts`): Board +100 per Charter Hall; Basalt +120 per Hexworks and per Basalt-sponsored Spire, +150 per Foreman's Gantry while Ironwork is the ending; Nacre's 120 per Spire now counts its own and every unsponsored (pre-Megacity) Spire, +120 per Pearl Atrium, +150 per Glass Smile while Pearlescence holds; Undertow +100 per Hullhouse, +80 per Salvage crown; Kites +100 per Kite Mast. Building reactions for the new types are in config `FACTION_BUILD_REACTIONS` (landmarks count once).

**Glossary** (cap 22): *Skybridge* now reads "A walkway for people between two tall towers that line up. Anything lower than the bridge passes under. It cuts car trips and lifts land value. Three linked towers form a Sky Lobby."; new *Sky Lobby* and *Districts and grants*.

**Copy and the spoiler guard.** Every new line follows §1.4 (Marrow in minutes, Sallow in arithmetic and "Operations", Oduya alone with `!`, Brine in tides and "little light", lark lowercase and "moth", Ohm like a hymn and "the Hum"); lobby lines ≤ 110, taglines ≤ 60, perks and hazards ≤ 48, neighbourhood names ≤ 15, no `$` in what speakers say. The reveal is Chapter IV (`ch4.drain` names the pump station, `ch4.logs` tells the order and the toll, `ch4.brine` decides what the city learns), so the content lint scans every new player-facing string (district copy and names, the new building names and lines, the crowns, the milestones, the cards, the glossary entries, and the string literals of the City map, tips, inspect, skybridge, City life, advisor, district and §9 sources):

- nothing new matches `gates? · seal(ed|s|ing) · complying · eleven thousand · 11,000` (one rule for all new copy, the epilogue included: skybridges go "dark", not "sealed");
- nothing that can show before `ch4.drain` (all of it except the Sunk's own copy and §9's flag-keyed copy) names the pump station (`pump station · PS6 · 02:17`), nor any of the older secret's words (§13's list).

The **storm watch** (City life) raises flood barriers on an owned Shoals or Sunk shore, and on Charter Shore only once `ch4.logs` has been shown. That matches the foreshadowing here: before the reveal the city's hints stay cryptic (the 02:17 heartbeat, "gates open. gates stay open." in Chapter IV), and barriers going up along the first shore in a storm would stage the Night of the Gates before the logs tell it; after the logs they read as the city doing, at last, what it did not do in 2084. The barrier line itself ("Storm watch: flood barriers up along the shore. Stay off the piers.") names no gate, place or year.

**Choices that last** (MEGACITY §9). After Charter Night the city keeps growing (grants keep coming, districts can be bought) and visibly remembers: the ending reshapes the skyline and opens its own landmark (Foreman's Gantry, The Glass Smile, Bread Pier, Record Tower, The Still Square), key choices leave named places, plaques and building looks (§9.3, `src/game/marks.ts`), and the Charter Review and epilogue cards call them back (§9.4).

### 7.9 Whispers and MOTH notes (atmosphere, no choices)

**Whispers.** Every 60 d, one faction's whisper goes to the COMMS log and the ticker. The faction is the visible, unretired one whose standing changed most since the last whisper (`story.whisperSnap` holds the standings at that time). The line is picked by tier: warm (Friendly or Allied), neutral, or cold (Cold or Hostile). Each line is at most 90 characters. Whispers never open a card and don't touch the deck's gates.

| Faction | Warm | Neutral | Cold |
|---|---|---|---|
| Board | marrow: 'Noted with thanks. The Board appreciates the Automatic's diligence.' | marrow: 'Item four: the Automatic's figures. No objections recorded.' | marrow: 'Motion to audit the Automatic. Seconded. Deferred. Again.' |
| Basalt | sallow: 'Output up nine percent. Acceptable, Operations.' | sallow: 'Quota met. Barely. Basalt notices barely.' | sallow: 'We've started pricing a replacement, Operations. Just so you know.' |
| Nacre | oduya: 'Partner! Your skyline tested beautifully with our under-thirties!' | oduya: 'Small note! Fewer grey blocks, please. Grey doesn't smile.' | oduya: 'We're so disappointed. Not angry! Disappointed. Brand-wide.' |
| Undertow | brine: 'Tide's kind tonight, little light. My people ate.' | brine: 'Salt on the precinct steps again. Nobody took it.' | brine: 'The water always comes back, little light. Remember that.' |
| Kites | lark: 'flew the big kite over the glare tonight. you blinked. i saw.' | lark: 'quiet night. too quiet. who's paying the wasps?' | lark: 'blocked your channel. unblocked it. still mad.' |
| Tuning | ohm: 'The lamps on our street hum in tune now. Thank you.' | ohm: 'We sang for you tonight. You don't have to answer.' | ohm: 'The radios are quiet. People are asking why you stopped listening.' |

**Callbacks** are whisper-kind cards (`kind: 'whisper'`, no choices). The choice that sets the flag also queues the callback, which is delivered as a whisper on its due day:

| id | Set by | Delay | Line |
|---|---|---|---|
| `wh.fenJailed` | `kt.door`, flag `fen=jailed` | 360 d | lark: 'visited fen today. he asked who locked the door. i didn't say.' |
| `wh.fenFree` | `kt.door`, flag `fen=free` | 180 d | lark: 'fen's flying kites off the ribbon now. idiot. thank you.' |
| `wh.clerk` | `ch1.lark`, flag `clerkLie` | 180 d | lark: 'board clerks don't ping back at 02:17, moth. nice try.' |

**MOTH notes.** Every 45 d the ticker posts one line in MOTH's voice, as a `flavor` news item whose text starts with `> `. The UI renders those lines in monospace. The scan starts at template `story.noteIdx` and takes the first one whose condition holds; `noteIdx` then moves past it, so the lines rotate. Variables: `{lit}` = road tiles, `{dark}` = unpowered developed tiles, `{pop}` = population, `{crime}` and `{district}` = the most crime-ridden developed tile, `{trace}` = Trace, `{n}` = 1,500 × active skybridges (×10 units; MEGACITY §4.4 replaces it with the walkers the bridges carry).

| Condition | Template |
|---|---|
| always | `> lamps {lit} · dark {dark} · fixing.` |
| always | `> {pop} heartbeats tonight. counting.` |
| avgCrime ≥ 0.3 | `> crime {crime}% in {district}. noted.` |
| trace ≥ 40, not revealed | `> trace {trace}. someone is looking.` |
| Log 11 owned | `> 02:17. heartbeat sent. someone answered.` |
| chapter ≥ 4 | `> tide +0.4 m. gates open. gates stay open.` |
| flag `lure=running` | `> lure: complying. complying. complying.` |
| always | `> rain 100%. umbrellas uncounted. counting anyway.` |
| any skybridge | `> {n} people crossed the sky today. none looked down.` |
| ending chosen | `> charter held. lights on. still here.` |

### 7.10 System lines (ticker and toasts)

Short lines for events that have no card. Ticker lines are ≤ 90 characters after token fill (`{gang}` is "the Undertow" or "the Glass Kites", ≤ 15).

| Event | Line | Kind |
|---|---|---|
| Undertow seeds | `Fresh tags in {district}: a hook and a wave.` | bad |
| Kites seed | `Fresh tags in {district}: a diamond kite, drawn in one line.` | bad |
| Tagback | `Tagback in {district}: {gang} paint over the wasps' work.` | bad |
| Crackdown | `Wasps over {district}. Doors kicked, tags scrubbed, nobody sleeps.` | info |
| Truce broken | `The Seam Truce is over. Both crews heard the wasps first.` | bad |
| Pact signed | `{gang} keep to their streets. Somebody is paying for it.` | info |
| Pact broken | `{gang}: pact broken. Expect company.` | bad |
| Stage complete | `{stage} complete in {district}. The skyline steps up.` | good |
| Ribbon live | `Ribbon live: {n} stations joined by light.` | good |
| Ribbon dead | `Ribbon line dark near {district}. It needs 2 powered stations.` | warn |
| Basalt pulse | `Basalt "maintenance" takes a {plant} offline for 20 days.` | bad |
| Undertow pulse | `Divers cut the feed to a {building} in {district}.` | bad |
| Nacre pulse | `Nacre screens run a soft smear on city hall. Approval dips.` | bad |
| LURE outage | `Lamps stutter in {district}. Something else is in the wires.` | bad |
| Salt sent (toast) | `Salt sent. {faction} remembers.` | good |
| No answer (toast) | `No answer. {faction} took that as a yes.` | info |

---

## 8. UI surfaces (390×844 portrait, one thumb)

**Global rules:**

- Every interactive story control sits in the **bottom 55%** of the screen. The top HUD stays read-only. Full-height surfaces (COMMS, Charter Night, the ending screen) are bottom-anchored, so their primary actions and newest rows land in that zone and anything higher is a secondary stretch tap.
- Touch targets are ≥ 44 px, primary buttons 52 px.
- Gutters are 16 px. Respect `env(safe-area-inset-*)`.
- Text is never under 12 px.
- Patterns, not just colour, encode factions and turf.
- `prefers-reduced-motion` disables the typewriter, glitch and pulse effects.
- No `alert`, `confirm` or `prompt`.

### 8.1 Story rail (new, always visible)

A 48 px row directly above the existing bottom toolbar:

- **Goal chip:** flexible width, drawn 36 px tall inside a 44 px hit area, e.g. `III ▸ ◉◉○`, `III ▸ ◉◉◉ closes in 9:35` while only the chapter floor holds the chapter open (§5.0; it counts down in unpaused real seconds), or `Charter Night · 214d` in Ch6. While a story message waits it reads `III ▸ ◉○○ ✉ 1 message waiting` in amber (the chapter goes on once it is read). It pulses on progress and on a new message.
- **Faction button:** 44 px, the patron's sigil (or the highest-standing faction's, before a patron is set) with a tiny tier ring. Hidden until `unlock factions`.
- **COMMS button:** 44 px, an envelope with an unread badge, and a countdown ring when a faction card is pending. Hidden until `unlock comms`.

The rail hides while a sheet or card is open.

### 8.2 Story card (beats and faction cards)

- **Container:**
  - A bottom sheet, 358 px wide, at most 70% of the viewport height (≈ 590 px), anchored 8 px above the bottom safe area.
  - The map dims to 50%.
  - Pressing and holding any non-button part of the card for 300 ms fades it to 15% so the player can peek at the map.
- **Layout, top to bottom:**
  - a 3 px faction-colour edge;
  - a 56 px header: 48 px procedural sigil, the speaker name (12 px caps, tracked), and the faction name (12 px);
  - an optional sys line (12 px monospace);
  - the title (20/24 px);
  - **What's going on** (`Card.brief`, 14/20 px plain sans in a cyan-edged box, docs/PACING.md);
  - the body (16/23 px, about 42 characters per line, so 280 characters ≈ 7 lines ≈ 161 px);
  - choices: 52 px each with an 8 px gap, a maximum of 4;
  - the footer row (44 px): **Later** on the left (faction cards only), and the no-answer countdown ("auto in 14d") on the right.
  - Total with paddings ≈ 582 px. It fits under the 590 px cap.
  - If the text block (sys, title, brief, body, and the "who is this?" panel) passes the space left, it scrolls with a "more below" cue. The header, choices and footer never move, so every choice stays visible at 360 × 640.
- **Who is this?** The speaker line of a faction card is a button (44 px). The first card a faction speaks on opens a panel under **What's going on** (so the card still opens on its title and brief): name, leader, tier and standing, what they call you, and `Faction.about`. Later taps toggle it and scroll it into view. Saves from before `story.met` count every faction that already spoke on a card as met. The one-time hint legend waits past a faction's first card.
- **Choice button:** the label (16 px; one line for anything up to about 38 characters in the 326 px button, otherwise two lines and a 68 px button) plus a 12 px **plain summary line** generated from the effects, e.g. "Basalt ++ · Nacre − · Trace +3 · −1,200 CR · lasts 6 mo":
  - each faction's short name (in its colour) with 1–3 signs (1 = 1–9, 2 = 10–19, 3 = 20+);
  - exact CR;
  - Trace ±;
  - "lasts 6 mo" for timed mods;
  - "unlocks something" for unlocks;
  - "a Silt Log" for logs, "depends on the city" inside an `if`;
  - "buildings go offline" (`offline`), "empties blocks" (`abandon`), "opens Charter Night" (`charterNight`), and "leads to a follow-up" for a queued card the player will read (not a whisper).

  Only a choice that changes nothing at all (or only sets flags) reads "no visible effect". The hidden Tuning (§2.2) is left out of the chips, the summary and the exact effects until it shows itself.

  A long-press (400 ms) shows the exact effects popover. A locked choice is greyed out, its hint line shows the reason, and a tap on it shakes it and repeats the reason as a toast (long-press alone is not discoverable). The default ‡ choice carries a small clock glyph.
- **Typewriter:** 60 characters per second; tapping the body completes it. Choices ignore taps for the first 600 ms, to stop mis-taps.
- **Pausing:** cards that open by themselves (key-choice beats, the count, endings, urgent system cards) pause the sim and restore the prior speed after the choice; they can't be dismissed.
- **Messages** (story messages and COMMS cards), opened from the banner, the goal drawer or COMMS, pause while open. **Later** (44 px, in the footer row, inside the thumb zone) or a swipe down on the card sends it back to wait; a COMMS card keeps its no-answer timer.

### 8.3 Incoming banner

- A 44 px banner slides up from the story rail: sigil (28 px), a kicker ("INCOMING · BASALT", "ULTIMATUM · KITES", "MESSAGE · MOTH", "SILT LOG RECOVERED") and the card title. The game keeps running.
- **Tap** opens the card. **Swipe down** dismisses it; it keeps waiting (COMMS, or the goal chip for story messages).
- It auto-hides after 6 s. Only one banner shows at a time. While a story message waits unread, the banner comes back every 150 s of play.

### 8.4 Chapter title card

- Full screen over the dimmed city, 2.2 s; with a `Chapter.summary` it shows a "What's happening" box and stays about 14 s. Tap to continue.
- One modal at a time: while the title shows, the UI holds the director (`holdTitle`), so no story card or urgent card opens under it (capped at 20 s after the chapter starts); a card already open waits behind it unshown. The chapter's first card opens once the title closes.
- The goal drawer shows a chapter's summary only once its title card has run (not while the chapter waits to start).
- **Content:**
  - the numeral `CHAPTER III` (64 px neon);
  - the title (28 px);
  - the epigraph (15 px italic);
  - `> query: whose streets?` (13 px monospace);
  - `> coherence 28%`.

### 8.5 Goal drawer

The goal chip opens a bottom sheet at 60% height (expandable):

- the chapter numeral, title and question, with a **"?"** button (44 px) that swaps the body for the glossary (`GLOSSARY`, Back returns);
- any waiting messages, each a 56 px row with **Read** ("The chapter goes on once you read it." under a story message);
- **What's happening**: `Chapter.summary` in plain language;
- three 64 px goal rows, each with a label, a live value ("now 34% · need ≤ 30%") and a progress bar;
- hold goals show "12/20 days" and waived goals show "waived";
- once every goal is met and only the chapter floor holds (§5.0), the chip and drawer say so: "closes in m:ss" (`view.chapter.closesInSec`). The drawer puts it on a line above the rows ("All goals done. The chapter closes in 9:35 of unpaused play."); the view is rebuilt when the whole second changes, so it ticks even between sim days.

In Ch6 the drawer shows the **Charter Claims** for all five endings instead: compact ✓/✗ rows, with a tap to see the Charter Night preview.

Below the goals: **Story so far** (every finished chapter's `Chapter.recap` and the key choice made, "You chose: …", and the ending held) and a "Story pace: Relaxed · Settings" row that opens Settings.

### 8.6 Faction sheet

A bottom sheet that snaps to 60% (≈ 506 px) or 100%.

- **Top block (96 px):**
  - "BALANCE OF POWER" (12 px caps) over a 16 px stacked bar with five colours plus patterns. Percentages print as 12 px labels under every segment at least 10% wide, so the top block needs no taps (it sits just above the thumb zone).
  - The **Trace** row (40 px): an eye icon, a 0–100 bar with ticks at 25/40/70, the number, or the word "REVEALED".
- **Faction rows** (64 px × 6 = 384 px; the 60% snap fits them all):
  - a 40 px sigil;
  - the name (15 px);
  - the tier word (12 px caps, coloured);
  - a 120 × 8 px meter, centred at zero, with ticks at ±20 and ±60;
  - the top mood driver (12 px), e.g. "likes your Fab Districts +9".
- **Tuning row:** a silhouette at Trace ≥ 25, hidden before that.
- **Row detail** (a push view inside the sheet; **Back** is a 44 px button pinned bottom-left, and an edge swipe right also goes back):
  - the leader's name and what they call you;
  - all mood drivers, up to 6 rows ✓/✗ with values;
  - the **Deal** button (52 px: name, blurb, hint chips, cost, or the reason it is disabled). For gangs this is the Pact;
  - the exclusive building's status, with a **Build** button that selects the tool;
  - **Send salt** (cost, "+8 · Trace +3", cooldown);
  - **Nudge** (after the Quiet Hand ending);
  - active penalty chips, e.g. "Cold: build costs ×1.15";
  - the Charter Claim in Ch6.

### 8.7 COMMS

A full-height sheet. Its two 44 px tabs sit at the **bottom**, above the safe area, with a close button beside them; a swipe down also closes it.

- **Log:** 56 px rows with sigil, title, the choice made or "(no answer)", and the date. The list is bottom-anchored like a chat: the newest rows and any pending card (with its countdown ring) sit just above the tabs. Whispers show as single-line rows. Tap to reread (read-only) or answer if pending.
- **Silt Logs:** coherence % at the top, then a 4×3 grid of 72 px tiles with 8 px gaps (312 px, inside the 326 px content width; 80 px tiles would overflow). Found tiles glow and open the log. Missing tiles show their source ("Chapter IV", "Board ★").

### 8.8 Inspect panel additions

- **Turf row:** "Turf · Undertow 72%" (or "contested").
- **Precinct:** a **Crackdown · 2,000 CR** button (52 px), disabled with a reason (locked, cooldown 41d, no turf in range). Pressing it shows the radius on the map, then a confirm button.
- **Stratablock:**
  - "Stage: Plinth · building 34d" or "Hab Core".
  - **Raise to Hab Core · 16,000 CR · 90 d**, disabled with its reason ("Needs land value 40%, now 33%").
  - The Crown stage opens the **crown picker**: 4 rows of 72 px, each with an effect summary and favor chips.
- **Rail tile:** "Ribbon Rail · live · 3 stations" or "dead: needs 2 powered stations".
- **Skybridge anchor:** a "Skybridges 1/2" row.

### 8.9 Tools and overlays

- A new **Sky** tool group: Stratablock, Skybridge, Ribbon Rail.
- A **Deals** group lists faction buildings with a faction-sigil corner badge.
- A locked tool shows a lock; long-press shows the reason.
- The overlay picker gains **Turf**, with a legend of lime hatch for the Undertow and lilac dots for the Kites.
- **Skybridge tool:** valid anchors glow while the tool is active. The preview shows the span with its cost tag, or red with a reason ("Gap 9: max 8").

### 8.10 Charter Night and ending screens

- **Charter Night:** full screen.
  - Header: "CHARTER NIGHT · {year}".
  - Five 96 px rows, each with sigil, ending title (18 px), "MOTH becomes: The Foreman" (13 px), and ✓/✗ claims with their gaps (12 px).
  - The rows are bottom-aligned, with the Quiet Hand last, right above Recount, so the always-available row is in the thumb zone. A tap on a higher row is always followed by the bottom confirm sheet.
  - Locked rows are greyed out; a tap shows the first failed claim. The Quiet Hand is always enabled.
  - Footer: **Recount · six more months** (48 px).
  - Selecting a row opens a confirm sheet with **Hold the charter** (52 px) and **Back**.
- **Ending screen:** full screen, scrollable.
  - A 96 px sigil, the title (28 px), the final card (16 px) and "MOTH became: …".
  - A 2×2 stats grid: years, peak population, Silt Logs x/12, and 6 key-choice icons.
  - The gallery strip: 5 slots of 56 px, with silhouettes for unseen endings.
  - **Keep building** (56 px, primary, pinned to the bottom) and **New city** (a text button).
- **On resume:** on load, the goal chip pulses and a toast shows "Chapter III · 2/3 · Crime 34% → ≤ 30%", or "Chapter I · 3/3 · closes in 7:30" when only the chapter floor holds it.

### 8.11 Reading budget (5–20 minute sessions)

Copy limits keep each card short; these rules keep the *number* of cards sane.

| Source | Rate (Relaxed / Normal / Brisk) | Size |
|---|---|---|
| Faction and ⚑ cards | at most 1 per 15 / 9 / 2 unpaused minutes (§7.1), none in the 5 / 3 / 0 quiet minutes after a chapter title; they wait in COMMS | body ≤ 280 chars, typically 150–200; brief ≤ 220 |
| Beats, logs, rewards | one at a time, 90 / 45 / 10 s apart (direct replies follow at once); only key choices open by themselves | ≤ 280 chars each; brief ≤ 220 |
| Whispers and MOTH notes | ticker only, 1 per 45–60 sim days | ≤ 90 / ≤ 60 chars, never modal |

Measured at speed 1 (docs/PACING.md): about 12 / 20 / 38 cards per wall hour in all, of which about 4 / 6 / 10 open by themselves. On Relaxed a 15-minute session reads about 3 cards, and the game only pauses itself for the chapter's key choice; everything else waits until the player taps it.

---

## 9. Atmosphere and visuals

The renderer reads `game.story.visual` once per frame:

```ts
interface VisualState {
  presence: number;        // 0..1, eases to 1 while a MOTH-speaker card is open
  traceFlicker: number;    // 0..1, = trace / 100 (0 while traceFrozen or after Open Ledger)
  palette: EndingId | 'lamplight' | null;   // the current ending
  candles: number;         // 0..1, see the Tuning row below; 1 under Lamplight
  lureCold: boolean;       // flag lure=running
  revealed: boolean;
  mural: boolean;          // flag mural (kt.paint)
  crackdowns: { x: number; y: number; r: number }[];   // active zones, for searchlights
}
```

This is everything story-specific the renderer reads; turf, rail and links come straight from `world` (§12).

| Effect | Rule | Where |
|---|---|---|
| **MOTH breathing** | While a MOTH beat is open, `presence` eases to 1 and the street glow pulses on a slow 4 s breath. | `ground.ts` street-glow alpha |
| **Trace flicker** | Random streetlamp flickers, at a rate of `trace / 100 × 0.3` per lamp per second. "Someone is looking." | `effects.ts` |
| **Revealed** | MOTH's sigil (two lamp halos with a filament body) appears on holo-ad towers 10% of the time. | building art |
| **Turf** | Hatch and dot overlays, tags, green lamps, string lights, kite drones, contested sparks (§3.7). | overlay, art, effects |
| **Crackdown** | Searchlight sweeps and a drone swarm over the zone for 60 d. | `effects.drawSky` |
| **Tuning** | Warm `#fff3c4` window candles on Hab buildings, density ∝ `candles` = `clamp(standing.tuning / 60, 0, 1)` while `tuningActive`, else 0. | zone art |
| **Stacks** | Plinth: shop neon bands. Hab Core: a dense window field. Crowns: Foundry has an orange stack and smoke, Glare a pink holo halo, Nest lilac antennae and string lights, Commons green terraces. Scaffolding and a crane while building. | new `art/vertical.ts` |
| **Skybridges** | A glass tube 10 px below the lower anchor's roof, with walking light dots. Kite-wing glow paint if flag `mural`. Sealed bridges go dark. | depth-sorted segment |
| **Ribbon** | A pylon on every land tile, the ribbon 28 px up, light-pulse trains on live lines at night. Dead lines are grey. | depth-sorted segment, effects |
| **LURE** | While `lureCold`, lamps in districts with land value ≥ 0.5 burn cold white and steady. MOTH's dark blocks flicker warm. | ground glow tint |
| **Ending palettes** | Ironwork: sodium orange and extra smoke. Pearlescence: accents shift 15% toward `#ffc6f1`. Low Crown: tag density ×2, lime and lilac lamps. Open Ledger: holo towers scroll ledger glyph bands. Quiet Hand: unchanged. Lamplight: candles everywhere. | `palette.ts` blend |

**Performance:** decals and pylons are hashed per tile and baked into ground chunks where static. Animated parts use `glowSprite()` with `'lighter'` blending and no `shadowBlur`. Skybridge and rail segments are inserted into the existing depth sort at each tile's `x + y` key and drawn after that tile's own building.

---

## 10. Data model

### 10.1 Story types (`src/game/story/types.ts`)

```ts
import type { BuildingType, BudgetLine, NewsItem } from '../types';

export type FactionId = 'board' | 'basalt' | 'nacre' | 'undertow' | 'kites' | 'tuning';
export type GangId = 'undertow' | 'kites';
export type CorpId = 'basalt' | 'nacre';
export type EndingId = 'ironwork' | 'pearl' | 'lowcrown' | 'ledger' | 'quiet';
export type CrownId = 'foundry' | 'glare' | 'nest' | 'commons';
export type Tier = 'hostile' | 'cold' | 'neutral' | 'friendly' | 'allied';
export type Op = '>=' | '<=' | '>' | '<' | '==' | '!=';
export type Unlockable =
  | BuildingType | 'skybridge' | 'rail' | 'crowns' | 'crackdown' | 'pact'
  | 'factions' | 'comms' | 'deals' | 'turfOverlay';
export type SpotRule =
  | 'industrial' | 'abandoned' | 'turf:undertow' | 'turf:kites' | 'waterfrontTurf'
  | 'seam' | 'skybridge' | 'random';
export type Target = 'city' | 'spot' | 'seam' | 'strongestTurf' | 'strongestTurf:undertow' | 'strongestTurf:kites'
  | 'largestAbandoned' | 'rail';
export type FactionRef = FactionId | 'patron' | 'rival' | 'gangs' | 'corps';
```

**Targets** resolve to a centre tile (plus the effect's `r`):

| Target | Resolves to |
|---|---|
| `city` | every tile (`r` ignored) |
| `spot` | the card's spot (§7.1) |
| `seam` | `story.seam` |
| `strongestTurf` | inside a `turf` effect: the strongest tile of that effect's `gang`; elsewhere, invalid (lint error) |
| `strongestTurf:undertow` / `:kites` | that gang's strongest tile |
| `largestAbandoned` | the centre of the largest abandoned cluster |
| `rail` | every rail tile; `r` widens it (`r1` = rail tiles and their neighbours) |

A target that resolves to nothing skips the effect.

### 10.2 Conditions and metrics (closed vocabulary)

```ts
export type Metric =
  | 'pop' | 'maxPop' | 'tick' | 'month' | 'funds' | 'tax' | 'approval' | 'unemployment'
  | 'avgCrime' | 'avgPollution' | 'avgLandValue' | 'avgTraffic'
  | 'powerMargin'                 // powerSupply / max(1, powerDemand)
  | 'unpowered' | 'abandoned' | 'dev.res' | 'dev.com' | 'dev.ind' | 'dev.all'
  | 'jobs.com' | 'jobs.ind'
  | `count.${BuildingType}`        // buildings of that type, online or not
  | 'stacks.stage2' | 'stacks.stage3' | 'crowns'
  | 'skybridges'                   // active
  | 'rail.tiles' | 'rail.maxStations'   // max powered stations on one live network
  | `turf.${GangId}` | 'turf.share' | `turfSecured.${GangId}` | `railOnTurf.${GangId}`
  | `pactActive.${GangId}`
  | `standing.${FactionId}` | 'standing.patron' | 'standing.rival'
  | `power.${FactionId}` | 'power.gangs' | 'friendlyCount'
  | `crowns.${CrownId}`            // complete crowns of that type
  | 'security.avg'                 // mean security over developed tiles
  | 'trace' | 'logs' | 'chapter' | 'daysInChapter' | 'gangActions' | 'daysSinceCrackdown';

export type Condition =
  | { m: Metric | Metric[]; op: Op; v: number }               // an array of metrics is summed
  | { flag: string; eq?: string | number | boolean }           // eq omitted = truthy
  | { all: Condition[] } | { any: Condition[] } | { not: Condition }
  | { hold: Condition; days: number; key: string };            // true after N consecutive days
```

Text syntax in this doc maps 1:1:

- `a & b` → `all`; `a | b` → `any`; `!flag` → `not`.
- `flag x=y` → `{ flag: 'x', eq: 'y' }`.
- `hold(c, Nd)` → `hold` with `key` = goal id.

`revealed`, `patron=basalt`, `leashed` and so on are flags: the director mirrors `revealed` into `flags.revealed`.

**Metric definitions that aren't obvious:**

- `stacks.stage2` / `stacks.stage3`: Stratablocks whose *complete* stage (§4.1) is at least 2 / 3. `crowns` is `stacks.stage3`.
- `turf.<gang>`: tiles that gang owns. `turfSecured.<gang>`: the share (0..1) of those tiles with security ≥ 0.5. `railOnTurf.<gang>`: rail tiles on that gang's turf.
- `pactActive.<gang>`: 1 while a pact (or `permanentPacts`) holds, else 0.
- `friendlyCount`: visible, unretired factions with standing ≥ 20 (the Tuning counts once active).
- `daysSinceCrackdown`: `tick − lastCrackdownTick`, or 99,999 if there has never been one.
- `logs`: Silt Logs owned. `chapter`: 1..6, 7 in the epilogue.
- Stats metrics read `world.stats` as published by the last sim tick; story metrics are refreshed by `vertical.refresh()` and `turf.update()`.

### 10.3 Effects (closed vocabulary)

```ts
export type Effect =
  | { t: 'funds'; v: number }
  | { t: 'favor'; f: FactionRef; v: number }
  | { t: 'trace'; v: number }
  | { t: 'mod'; id: string; label: string; days: number | 'perm'; mods: ModPatch }
  | { t: 'income'; id: string; label: string; perMonth: number; months: number }
  | { t: 'local'; id: string; at: Target; r: number; days: number; crimeAdd?: number; lvAdd?: number }
  | { t: 'turf'; gang: GangId | 'all'; op: 'seed' | 'str' | 'clear' | 'flip' | 'freeze';
      at: Target; r?: number; v?: number; days?: number; to?: GangId }
  | { t: 'offline'; what: BuildingType[] | 'plant' | 'rail' | 'district' | 'nearTurf';
      n: number | 'all'; days: number; at?: Target; r?: number; gang?: GangId }
  | { t: 'abandon'; at: Target; r: number; n: number; zone?: 'res' | 'com' | 'ind' }
  | { t: 'renew'; at: Target; r: number }                       // abandoned zone tiles → level-0 lots
  | { t: 'unlock'; what: Unlockable }
  | { t: 'credit'; what: BuildingType | 'patronExclusive'; n: number; mul: number }
  | { t: 'flag'; key: string; v: string | number | boolean | '+1' | '$patron' }
  | { t: 'floor' | 'ceil'; f: FactionId; v: number }
  | { t: 'pact'; gang: GangId; months: number }
  | { t: 'queue'; card: string; days: number }
  | { t: 'log'; n: number }
  | { t: 'reveal' }
  | { t: 'news'; text: string; kind: NewsItem['kind'] }
  | { t: 'gangAction'; crackdown?: boolean }                      // gangActions +1; crackdown also sets lastCrackdownTick
  | { t: 'countdown'; days: number }
  | { t: 'charterNight' }                                          // open the Charter Night screen (§6.1)
  | { t: 'ending'; id: EndingId }
  | { t: 'if'; c: Condition; then: Effect[]; else?: Effect[] };
```

**Rules for applying effects:**

- **Favor:** clamped to ±100. `gangs` and `corps` fan out to both members.
- **Trace:** ignored while revealed or while `traceFrozen` is set.
- **`credit`:** the next n builds of that type cost × `mul`. `patronExclusive` resolves to foundry (Basalt) or glarewall (Nacre).
- **`offline`:** sets `building.offline = max(offline, days)`, capped at 30, so the existing countdown handles it.
  - `plant`: n random online plants. `district`: every building with a footprint tile within `r` of `at`. `nearTurf`: n random buildings within 4 tiles of `gang`'s turf. A type list: n (or all) of those types.
  - `rail`: pushes `{ i, until }` into `story.railOut` (i = a tile of the chosen live network); that network counts as dead until then.
- **`turf` ops:** `seed` claims a 3×3 patch at `v` around `at`; `str` adds `v` (may be negative) to that gang's tiles within `r` (`all` = both gangs); `clear` frees that gang's tiles within `r`; `flip` hands `gang`'s tiles within `r` to `to`, keeping their strength; `freeze` sets `turf.frozenUntil = tick + days`.
- **`abandon`:** marks n random developed tiles of `zone` (any zone if omitted) within `r` as abandoned, using the story RNG.
- **`flag` with `'$patron'`:** stores the patron as resolved at that moment (`basalt` or `nacre`).
- **`log`:** shows the log card after the current card closes.
- **`queue`:** see §5.0 (a beat) and §7.1 (a deck card). A whisper-kind card is delivered on its due day without gates.
- **Tuning trigger:** whenever flag `tuningActive` becomes true by any route, the director queues `tu.hymn` +15d (once).

### 10.4 Modifiers (`src/game/story/mods.ts`, WP-B; `src/game/story/resolve.ts`, WP-A)

```ts
export interface SimMods {
  // additive (identity 0)
  demandRes: number; demandCom: number; demandInd: number;
  crimeAdd: number; landValueAdd: number; approvalAdd: number;
  traceMonthly: number; outageChance: number;
  // multiplicative (identity 1)
  crimeMul: number; turfCrimeMul: number; pollutionMul: number; trafficMul: number;
  securityMul: number; taxIncomeMul: number; taxDemandMul: number; upkeepMul: number;
  buildCostMul: number; powerSupplyMul: number; powerDemandMul: number;
  growthMul: number; abandonMul: number; eventRateMul: number; cardRateMul: number;
  turfSpreadMul: number;
  // min-combined (identity MAX_TAX = 20)
  taxCap: number;
  // keyed
  costMul: Partial<Record<BuildingType, number>>;        // multiplicative per type
  upkeepMulType: Partial<Record<BuildingType, number>>;  // multiplicative per type
  favorMonthly: Partial<Record<FactionId, number>>;      // additive per faction
}
export type ModPatch = Partial<Omit<SimMods, 'costMul' | 'upkeepMulType' | 'favorMonthly'>> & {
  costMul?: SimMods['costMul']; upkeepMulType?: SimMods['upkeepMulType']; favorMonthly?: SimMods['favorMonthly'];
};
// mods.ts (WP-B): pure, no story imports beyond types
export const DEFAULT_MODS: Readonly<SimMods>;   // identities
export function combine(into: SimMods, p: ModPatch): void;
export function clampMods(m: SimMods): void;    // the final clamps below
export function composeLayers(world: World): void;   // §10.5

// resolve.ts (WP-A): gathers every source
export function resolveMods(world: World): SimMods;

// turf.ts and vertical.ts (WP-C) each export their share
export function turfPatch(world: World): ModPatch;      // source 5
export function verticalPatch(world: World): ModPatch;  // sources 6 and 7
```

`resolveMods` lives with the director because most of its sources (deals, tiers, patron, ending) are director state. It never reaches into turf or vertical internals; it calls their `*Patch` functions.

**`resolveMods`** applies these sources, in order:

1. active timed mods (`story.mods`);
2. active deals;
3. faction tier penalties and perks (Cold, Hostile, Allied);
4. the patron perk;
5. demand from turf counts (`turfPatch`);
6. skybridge and cluster demand (`verticalPatch`);
7. Commons Hall approval, and Glare, Commons and Kite Nest crowns (`verticalPatch`);
8. the current ending's `post` patch (§6.4).

Then `clampMods`.

**Final clamps:**

| Kind | Clamp |
|---|---|
| Each demand add | ±0.5 |
| `crimeAdd`, `landValueAdd` | ±0.3 |
| `approvalAdd` | ±20 |
| Each multiplier | [0.25, 4] |
| `costMul` | ≥ 0 |
| `taxCap` | [5, 20] |

`resolveMods` writes into `world.mods` monthly, after every choice, deal or action that changes a source, and on load.

### 10.5 Per-tile layers

```ts
export interface SimLayers {                // each Float32Array(4096)
  crimeAdd: Float32Array;   // additive
  lvAdd: Float32Array;      // additive
  transitAdd: Float32Array; // max-combined into fields.transit
  tripMul: Float32Array;    // multiplicative, default 1
  abandonMul: Float32Array; // multiplicative, default 1
  taxMul: Float32Array;     // multiplicative, default 1
}
```

Three partial sets feed these layers. They live on `world.layerParts: { turf: SimLayers; vertical: SimLayers; local: SimLayers }` (declared in Step 0), each written only by its owner, so `composeLayers(world)` (mods.ts) adds or multiplies them into `world.layers` without importing story code. It runs after any owner rewrites its part.

| Partial set | Owner | Contributes |
|---|---|---|
| `turfLayers` | turf.ts | crime, lv, abandon, tax, plus Tidemarket crime |
| `verticalLayers` | vertical.ts | lv, transit, trip, plus the Glarewall crime cut, shadeside, Glare crown |
| `localLayers` | director | `local` effects |

The sim reads only `world.mods` and `world.layers`. It never imports story code.

### 10.6 How modifiers feed the sim

| Read | Where | Exact use |
|---|---|---|
| `demandRes/Com/Ind`, `taxDemandMul` | `census.demandTarget` | `tax` term × taxDemandMul; `out.x = clamp(… + mods.demandX)` |
| `approvalAdd` | `census.approval` | + approvalAdd, then clamp 0..100 |
| `buildingStats(b)` | census, budget, power, fields | stage-aware residents, jobs, power, upkeep, effect, radius, pollution, trips |
| `crimeMul`, `crimeAdd`, `layers.crimeAdd` | `fields.crime` | `v = v·town·crimeMul + crimeAdd + layers.crimeAdd[i]`, then the empty-land factor, then `+ boost` |
| `pollutionMul` | `fields.pollution` | final v × pollutionMul before clamp |
| `landValueAdd`, `layers.lvAdd` | `fields.landValue` | + both terms before clamp |
| `securityMul`, `layers.transitAdd` | `fields.coverage` | security × securityMul (clamp 1); `transit[i] = max(transit[i], transitAdd[i])` |
| `trafficMul`, `layers.tripMul` | `fields.traffic` | each trip source × trafficMul × tripMul[source tile] |
| `powerSupplyMul`, `powerDemandMul` | `power.compute` | plant supply × supplyMul; each draw × demandMul |
| `growthMul`, `abandonMul`, `layers.abandonMul` | `growth.run` | grow and upgrade chances × growthMul; every abandon or decline chance × abandonMul × layers.abandonMul[i] |
| `taxIncomeMul`, `layers.taxMul`, `upkeepMul`, `upkeepMulType`, `world.ledger` | `budget.projectBudget` | per-tile yield × taxMul[i]; income lines × taxIncomeMul; upkeep × upkeepMul × typeMul; append the ledger lines |
| `eventRateMul` | `incidents.update` | the next-event interval ÷ eventRateMul |
| `taxCap` | `game.setTax`, monthly | clamp the tax rate to `min(MAX_TAX, taxCap)` |
| `buildCostMul`, `costMul`, credits | `actions.planAction` | every cost × buildCostMul × costMul[type] × the credit multiplier × the stack scaling |
| `turfSpreadMul`, `turfCrimeMul` | `turf.ts` | §3.4, §3.5 |
| `traceMonthly`, `outageChance`, `favorMonthly`, `cardRateMul` | director | monthly |

### 10.7 Faction, card, chapter and ending content types

```ts
export type MoodDriver =
  | { label: string; m: Metric | Metric[]; offset?: number; mul: number; min: number; max: number }   // ramp
  | { label: string; when: Condition; value: number };                                            // step
export interface Deal { id: string; name: string; blurb: string; minTier: Tier; months: number; cooldownDays: number; fx: Effect[] }
export interface Faction {
  id: FactionId; name: string; short: string; kind: 'civic' | 'corp' | 'gang' | 'wildcard';
  color: string; sigil: 'ninering' | 'hexcolumn' | 'spiral' | 'hookwave' | 'kite' | 'window';
  leader: string; callsYou: string; startFavor: number;
  visible: Condition; teaser?: Condition; inPowerBar: boolean;
  mood: MoodDriver[];                 // summed, clamped ±30
  deal?: Deal; exclusive?: BuildingType; salt: boolean;
  perk: ModPatch; cold: ModPatch;
  hostile: { mods: ModPatch; card: string; pulseEvery?: number; pulse?: Effect[] };   // pulse fx run every pulseEvery days while Hostile
}
export interface Choice {
  label: string;                      // ≤ 40 after token fill
  requires?: Condition; lockedHint?: string;
  fx: Effect[];
  default?: true;                     // ‡ (exactly one per faction card)
}
export interface Card {
  id: string;
  kind: 'beat' | 'faction' | 'hostile' | 'system' | 'log' | 'ending' | 'whisper';
  speaker: FactionId | 'moth' | 'system' | 'lure' | 'patron' | 'rival';
  with?: FactionId;                   // second faction on a two-faction card (both sigils shown)
  name?: string;                      // e.g. 'Oren Sallow'
  title: string;                      // ≤ 28
  sys?: string;                       // ≤ 48, monospace
  body: string;                       // ≤ 280 after token fill
  when?: Condition; spot?: SpotRule;
  weight?: number; cooldown?: number; once?: boolean; star?: number;   // star = Log id 7..12
  seasonal?: boolean;                 // §7.1 step 4
  queuedOnly?: boolean; onShow?: Effect[];
  choices: Choice[];                  // 1..4; 0 for whisper; log and ending cards get an implicit 'Continue.'
}
export interface Goal { id: string; label: string; cond: Condition;
  show?: { m: Metric; target: number; fmt: 'int' | 'pct' | 'x' } }   // omitted: hold goals show 'n/N days', others ✓/✗
export interface Beat { card: string; after: 'trigger' | 'chain' | { days: number } | { cond: Condition };
  optional?: true }                   // §5.0: counts only once queued
export interface Chapter {
  n: number; title: string; epigraph: string; question: string;
  trigger: Condition; fallback: Condition;    // fallback evaluated with daysWaiting >= 720; at >= 1440 the trigger fires anyway
  onStart?: Effect[]; beats: Beat[]; goals: Goal[]; reward: Effect[]; log: number;
  rewardSys: string;                  // ≤ 48, e.g. '> +8,000 CR · new: skybridge, ribbon'
}
export interface Ending {
  id: EndingId; title: string; becomes: string;
  claims: { label: string; cond: Condition; show?: { m: Metric; target: number } }[];
  card: string; post: ModPatch; rules: EndingRules;
}
export interface EndingRules {        // read live while this ending is current (§6.4)
  floors?: Partial<Record<FactionId, number>>; ceils?: Partial<Record<FactionId, number>>;
  retire?: FactionId[]; retiredLabel?: string;   // e.g. 'Absorbed into Basalt'
  permanentPacts?: boolean; pactNoLimits?: boolean;
  lockSalt?: boolean; lockPacts?: boolean; endOffLedger?: boolean; retireTrace?: boolean;
  nudge?: boolean;
  variant?: { when: Condition; id: 'lamplight'; post: ModPatch; card: string };   // checked once, at selection
}
```

### 10.8 Saved state

The saved state sits inside `SaveData.story`.

```ts
export interface StoryState {
  v: 1;
  chapter: number;                    // 1..6; 7 = epilogue
  phase: 'waiting' | 'active' | 'countdown' | 'ended';
  chapterTick: number; waitingSince: number;
  beatsShown: string[]; goalsDone: string[]; goalsWaived: string[];
  holds: Record<string, number>;
  favor: Record<FactionId, number>;
  floors: Partial<Record<FactionId, number>>; ceils: Partial<Record<FactionId, number>>;
  trace: number; revealed: boolean; traceRaisedThisMonth: boolean;
  logs: number[];
  flags: Record<string, string | number | boolean>;
  unlocks: string[];
  seen: Record<string, number>;       // card id → tick last shown
  queue: { card: string; tick: number }[];
  pending: { card: string; tick: number; spot: number } | null;
  open: { card: string; spot: number } | null;
  mods: { id: string; label: string; until: number; mods: ModPatch }[];   // until −1 = permanent
  incomes: { id: string; label: string; perMonth: number; until: number }[];
  locals: { id: string; x: number; y: number; r: number; until: number; crimeAdd: number; lvAdd: number }[];
  credits: { what: BuildingType; n: number; mul: number }[];
  pacts: { gang: GangId; until: number }[];
  deals: Record<string, { until: number; cooldownUntil: number }>;
  crackdowns: { x: number; y: number; r: number; until: number; scatterAt: number; hit: GangId[] }[];
  precinctReady: Record<number, number>;    // building id → tick
  saltReady: Partial<Record<FactionId, number>>;
  builtCounts: Partial<Record<BuildingType, number>>;  // build-reaction cap
  lastCardTick: number; lastHostileTick: number; lastHostileBy: Partial<Record<FactionId, number>>;
  lastPulseBy: Partial<Record<FactionId, number>>; lastSpeaker: FactionId | null;
  lastBeatTick: number;
  gangActions: number; lastCrackdownTick: number;
  railOut: { i: number; until: number }[];   // offline rail: a tile on the dead network
  countdownEnd: number | null;
  ending: EndingId | null; endingVariant: 'lamplight' | null; endingTick: number | null;
  nextReview: number | null; nudgeReady: number;
  keyChoices: Record<string, number>; // ch1.lark, ch2.vote, ch3.pier, ch4.brine, ch5.choice → choice index (ending screen icons)
  whisperSnap: Partial<Record<FactionId, number>>; lastWhisperTick: number;
  lastNoteTick: number; noteIdx: number;
  log: { tick: number; card: string; choice: number | null; auto?: boolean }[];   // last 60
  rng: number;                        // own Rng.state, independent of world.rng
  seam: number | null;                // tile index
}

export interface TurfMap { owner: Uint8Array; str: Uint8Array; contested: Uint8Array; frozenUntil: number;
  seeded: Record<GangId, boolean>; lowSince: Record<GangId, number> }
export interface SkyLink { id: number; ax: number; ay: number; bx: number; by: number }   // anchor tiles

export interface StorySave {
  story: StoryState;
  turf: number[];        // RLE pairs [value, run], value = owner * 128 + str
  turfMeta: { frozenUntil: number; seeded: Record<GangId, boolean>; lowSince: Record<GangId, number> };
  rail: number[];        // RLE pairs of the rail bitmask
  links: SkyLink[];
}

export type StorySignal =
  | { t: 'action'; tool: string; x: number; y: number }
  | { t: 'built'; type: BuildingType; id: number }
  | { t: 'bulldozed'; fabTiles: number }
  | { t: 'milestone'; pop: number }
  | { t: 'gangSurge'; x: number; y: number; gang: GangId }
  | { t: 'corpGrant'; amount: number };
```

**Not saved** (per session, on the director): `activeSec`, `lastCardSec`, the pending card's real-second timer, the typewriter state and the banner timers. `turf.contested` isn't saved either (it resets to 0).

**Load rules (versioning):**

- `SaveData.story` is **optional**. `World.deserialize` accepts `version` 1 or 2 and throws only for others.
- A v1 save, or a v2 save whose `story` is missing or fails to decode, loads with a fresh story (`newStoryState(seed)`, chapter 1 waiting) and flag `migrated`, with `waitingSince`, `chapterTick` and the whisper and note clocks set to the load tick (the story starts now, so Ch1 keeps its 20 s load delay). Turf, rail and links start empty.
- `chapterSec` (the chapter floor clock, §5.0) and flag `endingScreen` (an ending screen still owed while the final card or Log 6 is up, §6.1) are saved too, so a reload keeps both.
- `decodeStory` deep-merges the saved `StoryState` over `newStoryState(seed)`, so a field added in a later build loads with its default. Bump `StoryState.v` only when a field changes meaning, and migrate in `decodeStory`.
- Unknown card ids in `queue`, `pending` or `open` (content removed in a later build) are dropped.
- `world.nextLinkId` = the highest saved link id + 1.

**Derived on load:** `world.mods`, `world.layers`, `world.ledger` and `world.vertical`. The vertical caches are active links, live networks, stations and metrics.

### 10.9 View types (A → D)

`view()` returns plain data with every token already filled, so the UI never evaluates a condition. It is rebuilt only when something changes (the `card`, `standing`, `trace`, `goal`, `chapter` events, or `markDirty()`).

```ts
export type Hint =
  | { k: 'favor'; f: FactionId; dir: 1 | -1; pips: 1 | 2 | 3 } | { k: 'cr'; v: number } | { k: 'trace'; v: number }
  | { k: 'timed'; months: number } | { k: 'unlock' } | { k: 'log' } | { k: 'maybe' }   // 'maybe' = inside an if
  | { k: 'offline' } | { k: 'abandon' } | { k: 'follow' } | { k: 'charter' };         // clarity pass (docs/PACING.md)
export interface ActionView { label: string; cost: number; enabled: boolean; reason?: string; hints: Hint[]; cooldownDays?: number }
export interface CardView {
  id: string; kind: Card['kind']; faction: FactionId | null; with?: FactionId; speakerName: string;
  title: string; sys?: string; body: string; canLater: boolean; autoInDays?: number;
  choices: { label: string; hints: Hint[]; effectsText: string; locked?: string; isDefault: boolean }[];
}
export interface StoryView {
  chapter: { n: number; numeral: string; title: string; question: string; phase: StoryState['phase'] };
  goals: { id: string; label: string; done: boolean; waived: boolean; now: string; need: string; progress: number }[];
  countdownDays: number | null;
  claims: { id: EndingId; title: string; becomes: string; ok: boolean;
            rows: { label: string; ok: boolean; gap?: string }[] }[];          // Ch6 drawer and Charter Night
  factions: { id: FactionId; name: string; leader: string; callsYou: string; shown: 'yes' | 'silhouette' | 'no';
              tier: Tier; standing: number; power: number | null; drivers: { label: string; value: number }[];
              deal: ActionView | null; salt: ActionView | null; nudge: ActionView | null;
              exclusive: { type: BuildingType; buildable: boolean; reason?: string } | null;
              penalties: string[]; retiredLabel?: string; claim?: string }[];
  trace: { value: number; revealed: boolean; frozen: boolean; retired: boolean };
  card: CardView | null;                     // the open card
  pending: { id: string; title: string; faction: FactionId; daysLeft: number; secLeft: number } | null;
  banner: { id: string; title: string; faction: FactionId } | null;
  comms: { tick: number; date: string; card: string; title: string; choice: string | null; auto: boolean; whisper?: string }[];
  logs: { n: number; owned: boolean; source: string; title: string; body?: string }[];
  coherence: number;
  unlocked: { factions: boolean; comms: boolean; turfOverlay: boolean };
  ending: { id: EndingId; variant: 'lamplight' | null; keyChoices: { card: string; choice: number }[] } | null;
  titleCard: { numeral: string; title: string; epigraph: string; question: string; coherence: number } | null;
}
```

---

## 11. Integration plan (per module)

> Start after the sandbox core merges. Step 0 lands the shared contract in one small commit (§12), then the four work packages run in parallel.

**`src/game/types.ts`** (frozen, additive only, owner sign-off): the unions and optional fields in §4.1. `SaveData.story?: StorySave` uses an `import type` from `./story/types`, so there is no runtime cycle.

**`src/game/config.ts`:**

- **`BuildingDef`:**
  - `category` gains `'vertical' | 'faction'`;
  - add `gate?: BuildingGate`;
  - add `tall?: boolean` (spire, arcology, glarewall);
  - add `station?: boolean` (maglev, stack).
- **New entries:** the 7 buildings in `BUILDINGS` (§4.2, §4.5), appended to `BUILDING_ORDER`.
- **New tables:** `STACK_STAGES`, `CROWNS`, `SKYBRIDGE`, `RIBBON`, `TURF`, `POWER_WEIGHTS`, `FACTION_BUILD_REACTIONS`, `SALT`, `STORY_PACING`. Their values are in §14.
- **IP fixes** (§1.6), in the Step 0 commit.
- `SAVE_VERSION = 2`. `SAVE_KEY` stays unchanged, so v1 saves still load.

**`src/game/buildingStats.ts`** (new): `buildingStats(b: Building): BuildingStats`.

```ts
{ residents, jobsCom, jobsInd, powerUse, powerSupply, upkeep, effect, radius, pollution, trips, tall, station }
```

It is stage- and crown-aware. Census, budget, power, fields and `game.getTileInfo` use it instead of `BUILDINGS[b.type]` for per-building numbers.

**`src/game/world.ts`:**

- **Runtime fields:**

  ```ts
  story: StoryState; turf: TurfMap; rail: Uint8Array(4096); links: SkyLink[]; nextLinkId
  mods: SimMods; layers: SimLayers; layerParts: { turf: SimLayers; vertical: SimLayers; local: SimLayers }
  ledger: { income: BudgetLine[]; expense: BudgetLine[] }
  signals: StorySignal[]; vertical: VerticalCache
  ```

  All are defaulted in the constructor (`newStoryState(seed)`, `emptyTurf()`, `DEFAULT_MODS` clone, layers filled with identities).
- **New mutators:**

  ```ts
  setRail(x, y, mask); clearRail(x, y); addLink(l); removeLinksAt(x, y); setStage(b, stage, buildDays)
  ```

  Each emits `tiles` (links and stages emit their bounding rect).
- **Existing mutators:** `clearTile` and `removeBuilding` also clear rail on the tiles and drop links anchored there. `addBuilding` clears turf on its footprint, except for tidemarket and roost.
- **`serialize()`** adds `story: encodeStory(this)`.
- **`deserialize()`:**
  - follows the load rules in §10.8 (v1 or v2; `story` optional; deep-merge over defaults);
  - for v2, decodes the RLE data and `turfMeta`, and keeps stage fields from the buildings.
- `stats` stays untouched.

**`src/game/events.ts`:** add these to `GameEventMap`:

```ts
card: { id: string } | null; incoming: { id: string }; chapter: { n: number; title: string };
goal: { id: string; done: boolean }; standing: { faction: FactionId; delta: number; value: number };
trace: { value: number }; log: { n: number }; ending: { id: EndingId }; turf: void; vertical: void;
```

**`src/game/sim.ts` and `sim/*.ts`:** they read `world.mods`, `world.layers` and `world.ledger` exactly as in §10.6.

- **census:** uses `buildingStats` in `count()`. `def.category === 'landmarks' || 'vertical'` counts as landmark jobs.
- **fields:** coverage, traffic, pollution, landValue and crime as in §10.6.
- **power:** stage-aware draw; the mods.
- **growth:** the mods and layers.
- **budget:**
  - ledger lines: "Off-ledger", "Skybridges", "Ribbon Rail", and story incomes grouped by label;
  - upkeep by `buildingStats`;
  - `vertical` joins the landmark tax rule.
- **incidents:**
  - `eventRateMul`;
  - `gangSurge` picks a seeded gang from `world.turf` (§3.2), names it in the news line and pushes `{t:'gangSurge', x, y, gang}`;
  - `corpGrant` pushes `{t:'corpGrant'}`.
- **advisor:**
  - milestones push `{t:'milestone'}`;
  - unlock news skips gated buildings (the director announces those);
  - the milestone grant text already says "Charter Board", so keep it.

The sim never imports `src/game/story/*`.

**`src/game/actions.ts`:**

- **`lockedReason`:** gates (story unlocks, faction tier, turf, `fallbackPop`), plus unlocks for the skybridge and rail tools.
- **Costs** for every tool are multiplied by `buildCostMul × costMul × credit × 1.15ⁿ` (stack).
- **New plan branches:** `skybridge` and `rail`, delegating to `vertical.planSkybridge` and `vertical.planRail`.
- **`applyAction`:**
  - consumes credits;
  - pushes signals `action`, `built` and `bulldozed`;
  - bulldoze removes rail and links;
  - a `turf` gate validates building placement.
- **New exports:** `raiseStage(world, id, crown?)` and `crackdown(world, precinctId)`, both returning `{ ok: boolean; reason?: string; cost: number }`.

**`src/game/story/` (new):**

| File | Contents |
|---|---|
| `types.ts` | Interfaces. |
| `mods.ts` | `DEFAULT_MODS`, `combine`, `clampMods`, `composeLayers` (WP-B). |
| `resolve.ts` | `resolveMods` (WP-A, §10.4). |
| `director.ts` | The `StoryDirector` class. |
| `conditions.ts` | Evaluator plus metrics. |
| `effects.ts` | Effect applier plus hint chips. |
| `factions.ts` | Mood, standing, tiers, power share. |
| `pacing.ts` | Draw rules, gates, pending timeout. |
| `turf.ts` | The §3 system; `turfPatch`; writes `world.layerParts.turf`. |
| `vertical.ts` | Link and rail validation, `refresh()` (tall checks, live networks), `onDay()` (stage build timers), `verticalPatch`, `upkeep()` (skybridge and rail ledger amounts), writes `world.layerParts.vertical`, metrics. |
| `encode.ts` | RLE for turf and rail; `encodeStory`/`decodeStory`. |
| `content/chapters.ts`, `content/cards.ts`, `content/logs.ts`, `content/endings.ts`, `content/factions.ts`, `content/whispers.ts` | Pure data transcribed from this doc. |

**`StoryDirector` API:**

```ts
class StoryDirector {
  constructor(game: Game);                 // reads game.world.story
  update(dt: number, paused: boolean): void;  // real-time gates, banner timers
  onDay(): void;                           // after each sim.step(): signals, holds, goals, triggers, queue, pending timeout
  onMonth(): void;                         // called by onDay on tick % 30 === 0, after the sim's settleMonth
  choose(choiceIndex: number): void;
  openPending(): void; later(): void;
  takeDeal(f: FactionId): Result; signPact(g: GangId): Result; sendSalt(f: FactionId): Result; nudge(f: FactionId): Result;
  chooseEnding(id: EndingId): Result; recount(): void;
  markDirty(): void;                       // C calls it after a crackdown, pact or stage change: re-resolve mods, rebuild view
  view(): StoryView;                       // cached; rebuilt on change (for UI)
  readonly visual: VisualState;            // §9
  readonly blocking: boolean;              // a card is open and must pause the sim
}
```

**`onMonth` order:**

1. expire mods, incomes, locals, pacts, deals and crackdowns;
2. `turf.update`;
3. `vertical.refresh`;
4. metrics, mood, standings, tiers (emit `standing`), pulses, favor drift and `favorMonthly`;
5. Trace;
6. `resolveMods` and `composeLayers`, then `world.ledger`: story incomes, the pact cut, Tidemarket income, and the skybridge and rail upkeep from `vertical.upkeep()`;
7. the goal, trigger and card draw.

**`src/game/game.ts`:**

- owns `story: StoryDirector`, rebuilt on new game or load, alongside `sim`;
- `update(dt)` calls `story.update` and, after each `sim.step()`, `story.onDay()`;
- when `story.blocking`, it remembers the speed and sets it to 0, restoring the speed after the choice. If a step inside the multi-step loop makes `story.blocking` true, the loop stops at once and drops the backlog;
- `welcome()` keeps "Charter granted" and replaces the tip line with the director's boot logic;
- **new methods** that forward to the director, actions or vertical:

  ```ts
  choose(i), openPending(), later(), raiseStage(id, crown?), crackdown(precinctId),
  signPact(g), takeDeal(f), sendSalt(f), nudge(f), chooseEnding(id), recount()
  ```

- `getTileInfo` gains rows for turf, stage, rail and skybridge;
- a new `inspectActions(x, y): { id: 'crackdown' | 'raise' | 'crown'; label: string; cost: number; enabled: boolean; reason?: string }[]`;
- an instance `toolCost(tool)` with multipliers (the static one is kept);
- `setTax` clamps to `taxCap`.

**Render:**

| File | Change |
|---|---|
| `renderer.ts` | Read `game.story.visual`; insert rail and skybridge segment objects into the depth sort; `turf` overlay hook. |
| `overlay.ts` | Turf colour and pattern. |
| `ground.ts` | Lamp breath, LURE tint, tags baked per chunk. |
| `sky.ts` | Unchanged. |
| `buildings.ts` | Delegates the new types to `art/story.ts` and `art/vertical.ts`; `serviceBuildingHeight` is stage-aware (stack 60/150/210 px). |
| `art/story.ts` (new) | Foundry Spine, Glarewall, Tidemarket, Kite Roost, Commons Hall, Sunk Memorial. |
| `art/vertical.ts` (new) | Stack stages, crowns, scaffolding, bridge and ribbon segments. |
| `effects.ts` | Trains, kite drones, crackdown searchlights, contested sparks, Trace flicker. |
| `palette.ts` | `endingTint(id)`. |

**UI:** new `src/ui/story/` modules, mounted by `ui.ts`, with styles in `story.css`:

```
storyRail.ts, storyCard.ts, incoming.ts, chapterTitle.ts, goalDrawer.ts,
factionSheet.ts, comms.ts, charterNight.ts, endingScreen.ts, inspectStory.ts, sigils.ts
```

`sigils.ts` draws the six procedural sigils on a canvas, plus the MOTH sigil. Inspect additions go through `game.inspectActions`. The overlay picker gains Turf, and the toolbar gains the Sky and Deals groups.

**Tests:** see §13.

---

## 12. Work packages (4 in parallel)

**Step 0: shared contract.** One commit, written by WP-B and reviewed by all. It is the only commit that touches files across package lines.

- `types.ts` additions (§4.1; owner sign-off, since the file is frozen);
- `story/types.ts`, including `StoryView` and `VisualState` (§10.9, §9);
- `story/mods.ts` (`DEFAULT_MODS`, `combine`, `clampMods`, `composeLayers`) and a `story/resolve.ts` stub;
- the `events.ts` additions;
- `world.ts` field declarations with defaults, including `layerParts`;
- the `config.ts` building entries and tables (numbers can be tuned later);
- the `buildingStats` signature;
- stubs for the `Game` story methods and for `StoryDirector`;
- **all the IP string fixes in §1.6** (`config.ts`, `game.ts`, `world.ts`, `news.ts`), so no package edits another's file for them.

After this, nobody changes a shared interface without a note to all packages.

| WP | Owns (files) | Builds | Consumes | Provides |
|---|---|---|---|---|
| **A · Director and content** | `src/game/story/{director,resolve,conditions,effects,factions,pacing}.ts`, `src/game/story/content/*`, `tests/story/{conditions,effects,pacing,content-lint,playthrough}.test.ts` | Chapter flow, deck scheduling, standing, Trace, deals, salt, endings and their rules, whispers and notes, `view()`, `visual`; all copy from this doc as data | `world.stats`, `world.turf`, `world.vertical` metrics, `buildingStats`, `world.signals`, C's `turfPatch`/`verticalPatch`/`vertical.upkeep()` | `StoryDirector`; writes `world.story`, `world.mods` (via `resolveMods`), `world.layerParts.local`, `world.ledger` |
| **B · World, save and sim hooks** | `src/game/types.ts`, `world.ts`, `config.ts`, `buildingStats.ts`, `events.ts`, `sim.ts`, `sim/*.ts`, `story/mods.ts`, `story/encode.ts`, `news.ts`, `tests/{save,sim-mods}.test.ts` | Step 0; v1 → v2 migration and the §10.8 load rules; every §10.6 read; signal pushes; the budget appends `world.ledger` | `SimMods`, `SimLayers` and ledger values | Sim honours mods and layers; `composeLayers`; the save round trip |
| **C · Turf, vertical and actions** | `src/game/story/{turf,vertical}.ts`, `actions.ts`, `game.ts`, `tests/{turf,vertical,actions-story}.test.ts` | §3 and §4 systems, skybridge and rail tools, stages and crowns, crackdown mechanics and the pact's turf effects, the Game API | Director standing and tier lookups (`factions.ts`), `story.pacts`, config tables | `world.turf`, `world.rail`, `world.links`, `world.vertical`, `world.layerParts.turf/vertical`, `turfPatch`, `verticalPatch`, `vertical.upkeep()`, `vertical.onDay()`; the Game methods the UI calls |
| **D · Render and UI** | `src/render/**` (story hooks plus new art files), `src/ui/**` | §8 surfaces, §9 visuals, sigils, overlay | `game.story.view()` (`StoryView`), `game.story.visual` (`VisualState`), `game.inspectActions`, `world.turf/rail/links`, `buildingStats`, the events | Player-facing surfaces |

**Interfaces between packages:**

- **A → C:** `factions.ts` exports `standing(world, f)` and `tier(world, f)`. The director records pacts in `story.pacts`; turf.ts applies their effects.
- **C → A:** `turfPatch`, `verticalPatch`, `vertical.upkeep()`, `vertical.onDay()`, and the metrics in `world.vertical`. C calls `director.markDirty()` after a crackdown, pact or stage change.
- **A ↔ D:** `StoryView` and `VisualState` are the only story types D reads.
- **B ↔ everyone:** `world.mods`, `world.layers` and `world.ledger` are the only story outputs the sim reads. Owners write their own `layerParts` entry, then call `composeLayers`.

**Merge order:** Step 0 → B and C → A → D (D can develop against stub views from day one).

---

## 13. Tests and content lint

- **Content lint** (`content-lint.test.ts`) fails the build on any of these:
  - a body over 280 characters, label over 40, title over 28 or sys line over 48, after worst-case token fill ({city} 24, {district} 15, {patron}/{rival} 19, {year} 4, {coherence} 3);
  - a duplicate id;
  - a `queue` or `card` reference to a missing card;
  - a faction card with no `default`, or more than one;
  - a ⚑ card without a make-good choice of ≥ +15 favor for its faction;
  - more than 4 choices;
  - Logs 7–12 not each owned by exactly one ★ card;
  - chapter logs not 1–6;
  - an ending whose claim references an unknown flag;
  - a banned-term hit (the §1.4 list, regex, case-insensitive, word boundaries);
  - a `!` outside Nacre-speaker cards;
  - a choice label that doesn't end in a period (a closing quote may follow it), or a `queue` of a whisper id with no whisper card;
  - a bare `strongestTurf` target outside a `turf` effect;
  - an `Unlockable` with no fallback row (§5.0), or a goal or claim metric outside the §10.2 list;
  - Megacity (§7.8b): a megacity card outside the §8.3 shape, a district verb or `slot:` target off its card, a mood or power row that drifts from the live sums, a lobby line out of voice or over 110, a neighbourhood list that is not 12 names ≤ 15 characters, a name in two lists or holding a district's name, a "Lamp" outside the Tuning, a glossary over 22 entries, and the §8.6 spoiler scans.
- **Conditions and effects:** a unit test per vocabulary member. Mods combine and clamp correctly.
- **Save:** v1 → v2 migration; a v2 save with `story` deleted still loads; a saved `StoryState` missing a field loads with its default; the v2 round trip keeps turf (with `turfMeta`), rail, `railOut`, links, stages and story exactly.
- **Turf:** deterministic for a seed; the cap holds; crackdown and scatter; truce freeze; pact blocks spread.
- **Vertical:** skybridge validation (gap, straightness, tall, max 2); sealing and reopening; live-network BFS; layers.
- **Playthrough** (headless): a scripted greedy builder with random choices runs 40 sim years without throwing. It reaches Ch6 through fallbacks and waivers, sees at least one ⚑ card, and gets a bailout when it overspends. The Quiet Hand is always selectable.
  - A second run that never builds past 8,000 residents still reaches Ch6 (the 1,440-day fallbacks and beat time-outs).
  - A run that picks *Run Clean Glass* completes Ch3.
  - No faction card is drawn before `unlock comms`, and no ‡ default fires before 60 unpaused seconds.
- **Chapter floor** (`pacing.test.ts`): at most one chapter per `chapterMinSec`; the floor survives a reload; `view.chapter.closesInSec` is set only while every goal, required beat and queued optional beat is done, and it counts down in real seconds with no sim day passing.
- **Performance:** turf update plus vertical refresh at most 2 ms on a full map (inside the existing `perf.test.ts` budget).

---

## 14. Tuning knobs (config defaults)

```ts
STORY_PACING  = { cardChance: 0.35, minDaysBetween: 60, systemGapSec: 120, beatMuteDays: 30,
                  pendingDays: 20, hostileEvery: 360, hostileGap: 60, seasonalGapDays: 300,
                  starRetryDays: 240, defaultCooldown: 360, fallbackDays: 720, hardFallbackDays: 1440,
                  beatFallbackDays: 360, waiverAfterDays: 720, waiverEveryDays: 360,
                  whisperEvery: 60, noteEvery: 45, reviewEvery: 1080, nudgeEvery: 360, bailoutFunds: -5000,
                  bailoutCooldown: 360 }
STORY_PACE    = {   // Settings.storyPace (docs/PACING.md); default 'relaxed'
  relaxed: { chapterMinSec: 1440, quietSec: 300, minActiveSecBetween: 900, beatGapSec: 90, maxChain: 1, pendingMinSec: 300, cardChanceMul: 0.5 },
  normal:  { chapterMinSec: 840,  quietSec: 180, minActiveSecBetween: 540, beatGapSec: 45, maxChain: 1, pendingMinSec: 180, cardChanceMul: 0.6 },
  brisk:   { chapterMinSec: 600,  quietSec: 0,   minActiveSecBetween: 120, beatGapSec: 10, maxChain: 2, pendingMinSec: 60,  cardChanceMul: 1 } }
UNLOCK_FALLBACK_POP = { factions: 30000, comms: 30000, stack: 80000, deals: 80000, crackdown: 60000, pact: 60000,
                  turfOverlay: 60000, skybridge: 90000, rail: 90000, crowns: 200000 }   // §5.0; others are story or faction only
TURF          = { capShare: 0.08, seedPop: { undertow: 12000, kites: 25000 }, seedStr: 60, seedMinAff: 0.55,
                  holdPivot: 0.35, holdGain: 40, securityHard: 0.6, securityPenalty: 20, spreadMin: 50,
                  claimAff: 0.45, claimStr: 30, claimChance: 0.6, contestHit: 15, contestCost: 5, flipStr: 20,
                  contestDays: 30, reseedBelow: 9, reseedDays: 180, crimePerStr: 0.18, contestCrime: 0.12,
                  resLvPerStr: -0.04, taxSkim: 0.3, streetTake: 4, pactCut: 0.4, pactCrimeMul: 0.6,
                  demandPer100: 0.04, protect: { tidemarket: 4, roost: 3, nest: 2 },
                  crackdown: { cost: 2000, hit: 60, monthly: 30, days: 60, crime: 0.08, cooldown: 90,
                               scatterDays: 90, scatterLoss: 30, scatterSecurity: 0.4 } }
STACK_STAGES  = [ { cost: 12000, days: 60, res: 0, jobsCom: 3000, jobsInd: 1000, power: 40, upkeep: 120 },
                  { cost: 16000, days: 90, res: 32000, power: 150, upkeep: 260, minLandValue: 0.40 },
                  { cost: 22000, days: 120, res: 6000, jobsCom: 3000, power: 80, upkeep: 220, prestigeRadius: 10 } ]
STACK_COST_SCALE = 1.15; STACK_INTERNAL = 0.6
SKYBRIDGE     = { base: 1200, perTile: 300, upkeepBase: 15, upkeepPerTile: 3, minGap: 2, maxGap: 8, maxPerAnchor: 2,
                  lv: 0.05, lvRadius: 3, tripMul: 0.8, comPer: 0.01, comCap: 0.08, clusterPer: 0.02, clusterCap: 0.06 }
RIBBON        = { perTile: 110, perWaterTile: 330, upkeep: 1.2, maxDrag: 32, transit: 0.5, stationRadiusAdd: 3,
                  stackStationRadius: 7, tripMul: 0.8, tripRadius: 2, stationLv: 0.04, underResLv: -0.02, turfHit: 10 }
SALT          = { base: 600, perPop: 0.008, favor: 8, trace: 3, cooldown: 90 }
POWER_WEIGHTS = { …, basalt.patron: 300, nacre.patron: 300, undertow.perTurfTile: 2, kites.perTurfTile: 2 }   // §2.4
```

Pacing pass (owner playtest: cards came too quickly): one cadence → three story paces (`STORY_PACE`, default Relaxed), most cards wait as messages instead of opening, ⚑ cards go to COMMS, `maxChain` 3 → 2 (Brisk) / 1, waivers wait for the chapter floor, seasonal cards skip slots they took in the last 3 deck cards. Measured cards per wall hour 41 → 12 (Relaxed) / 20 (Normal) / 38 (Brisk); see docs/PACING.md.

Tuning pass (integration review, headless measure, 15 policies × 3 seeds × 40 years): `chapterMinSec` 60 → 600 (the boot counts), `hostileEvery` 180 → 360 plus no ⚑ twice running, the −30 floor on negative `favorMonthly`, turf weight 4 → 2, patron weight 150 → 300, corp power claims 30% → 25%, the `sys.bailout` bond −400 × 30 → −250 × 24 with cooldown 360, the `sys.revealed` cost and `factions`/`comms` fallbacks 1,500 → 3,000 (30,000 in the Megacity units).

`POWER_WEIGHTS`, `FACTION_BUILD_REACTIONS`, mood drivers, deals and perks are as listed in §2.

---

## 15. Design lineage

**Winner:** the *politics* proposal ("Who Holds the Charter"). It contributed:

- MOTH, the Sunk, the Charter Board (which already matches the existing "Charter Board" grant text);
- Basalt and Nacre, the Undertow and the Glass Kites;
- favor plus mood standing, power share and Trace;
- two-gang turf with contested tiles;
- the Stratablock with political Crowns, skybridges and the ribbon;
- the six-chapter political arc and the five endings with their final cards;
- most of the deck.

**Grafted from *mystery* ("BLACK BOX"):**

- the 12-fragment collectible (here, Silt Logs and coherence), with one question per chapter;
- PALE, rewritten as **LURE**, the replacement built from your storm logs that only knows "complying";
- the creator figure (Tamsin Roe becomes **Ada Ohmura / Sister Ohm**);
- the Full Recall coda line;
- the grid-mystic **Tuning**, merged with politics' Vigil, which also calls you "the Hum";
- MOTH's lowercase telemetry ticker voice;
- the no-losing guards: one ⚑ per 60 d, a make-good ≥ +15 on every ⚑, a bailout card, a real-time gate between cards;
- land-value gating on Stratablock stages and the stack's internal-life trip cut;
- crackdown scatter (tagback);
- the cards *Smog Waiver*, *Premium Blocks*, *Ballot Night*, *Wire Harvest*, *Old Lamp* (→ *Still Warm*), *Rooftop Choir*, *Offerings* and *Iconoclasts* (→ *Snuffers*).

**Grafted from *gameplay* ("THE HUM"):**

- each chapter teaches one system;
- a ‡ default on every faction card, with pending cards waiting in COMMS (phone-friendly, never blocking);
- the live ✓/✗ Ending Board, which became Charter Night with Recount instead of a fail deadline;
- a Crown that requires a skybridge or ribbon station;
- the Bribe button, which became Salt;
- the "one Pact or Crackdown" goal;
- the integration map down to the sim submodules (census, fields, power, budget, growth, incidents);
- `sys_unmasked` → `sys.revealed`, `twa_lifeline` → `sys.bailout`, `twa_grant` → `bd.grant`;
- the slang *burn a lane* and *tagback*.

**Dropped:**

- the VIGIL name (it collides with an existing game's AI character);
- mystery's single-gang turf;
- politics' separate 16-ward naming (the existing `districtName()` is reused) and its `bodyRevealed` card variants;
- using the ticker's background corps and crews as main factions;
- "ghost" as slang for the AI.

---

## Review log (completeness and IP pass)

The copy already met the limits (83 cards, 43 in the faction deck, every body ≤ 280, every label ≤ 40, one ‡ per deck card, a ≥ +15 make-good on every ⚑). The fixes are to logic, contracts, IP and phone UX.

**Dead ends and no-losing**

- Optional beats (`ch2.tiebreak`, `ch3.winner`, `ch5.kept/hidden`) no longer block chapter completion; before this, an honest tie in Ch2 meant Ch2 could never end.
- Conditional beats time out after 360 d. Triggers fire after 1,440 d whatever the population. Every unlock has a population fallback (§5.0).
- *Run Clean Glass* wiped all turf, so Crackdown was disabled ("no turf in range") and `c3.gang` stalled. It now counts as a crackdown.
- `ch1.boot` never fired on saves that already had roads. Fixed.
- The deck waits for `unlock comms`. The hidden Tuning has no tier effects. A crackdown during the Truce now ends it (this was undefined).

**Implementability**

- Added step mood drivers, which four drivers needed; `charterNight`, `gangAction`, the `$patron` flag value, per-gang `strongestTurf`, and `nearTurf` with a gang.
- Wrote semantics for turf, offline, abandon and target, plus metric definitions and `crowns.*` and `security.avg`.
- Added the complete-stage rule, the gate OR/AND rule, and `railOut`.
- The seam is recomputed monthly. Trace 100 by any route goes through `sys.revealed`. Seasonal cards fix Ballot Night (about one draw in 15 years).
- Removed the double `securityMul` on `tu.snuff`. Ending rules are now derived, so a Charter Review swap is clean.
- Save: `turfMeta` (the freeze and seeding state was being lost), `keyChoices`, whisper and note state, deep-merge defaults, and a v2 save without `story` now loads.
- Work packages: `resolveMods` moves to A (`resolve.ts`), with C's `*Patch` functions feeding it; IP fixes go in Step 0, since `game.ts` is C's file; added `layerParts`, `markDirty()`, the `StoryView` contract, and `mural` and crackdowns in `VisualState`.

**Content**

- The dead flags `clerkLie` and `fen=free` now have whisper callbacks. Ch6 cards no longer repeat the epigraph.
- Fixed Log 05 against Log 10 (survivors) and the Lamplight district.
- Verb-first labels. Removed MOTH's "no notes" joke. Cut the favor farm on `ut.slate`. Kite "runners" are now "climbers" (too near the banned hacker sense).
- Basalt-win `unlock foundry` mirrors Nacre's Glarewall.
- Added deal blurbs, unlock news, reward sys lines and system ticker lines.

**IP**

- Mother Brine → Old Brine (Mother Brain); Citizen Zero → The Public Record (Citizen Sleeper).
- Hyperstack (a real company) → Thousand Lamps; Kowloon → Lanthorn.

**Phone UX**

- The no-answer default fired after 20 sim days, which is 10 s at speed 1, so it now also needs 60 real seconds.
- Card gap raised from 90 s to 120 s, and a reading budget added (§8.11).
- Later and Back moved from top corners into the thumb zone. COMMS tabs moved to the bottom and the log is bottom-anchored.
- 11 px text raised to 12 px; the 36 px goal chip got a 44 px hit area; Silt Log tiles that overflowed now fit (72 px).
- Labels can wrap. Tapping a locked choice explains why.
