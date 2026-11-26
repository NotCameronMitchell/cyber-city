# Cyber City — design direction (from the player interview)

These answers came from the project owner and take precedence over defaults.

| Topic | Decision |
|---|---|
| Game type | **Story-driven** city builder (SimCity-genre core, original IP) |
| Story shape | **Hybrid**: main storyline in chapters with key choices and **multiple endings**, plus recurring faction events between story beats. **Sandbox continues after the ending.** |
| Player role | **The city's hidden AI / fixer** secretly running the city's systems. Tone: mysterious, sci-fi, morally grey. |
| Fail state | **No losing.** Consequences hurt (riots, sanctions, sabotage, faction hostility) but the game never ends. |
| Cyberpunk systems | **Megacorps & factions** (influence, deals, bribes, demands) · **Crime & gangs** (turf, crackdowns, black markets) · **Vertical megastructures** · **Atmosphere & visuals** |
| Verticality | **Megastructures + sky links on the same map**: huge multi-tile megablocks stacking homes, shops and jobs; skybridges between towers; elevated rail. |
| Platform | **Web link + Add to Home Screen** (PWA on GitHub Pages), saves progress locally. |
| Visual style | **2D isometric** procedural canvas art, neon at night. |

## IP rule
Everything original. Inspired by the cyberpunk genre, never copying Cyberpunk 2077 / SimCity names, characters, factions, slang, art or UI.

## Follow-up decisions (story review)

| Topic | Decision |
|---|---|
| Story spec | `docs/STORY.md` ("Who Holds the Charter") is the binding story/systems spec. |
| AI name | **Keep MOTH** (Municipal Operations & Tide Handler). |
| Core secret | **Keep** the Night of the Gates (11,000 drowned when MOTH obeyed the order to seal the gates). Restrained, never graphic. |
| `types.ts` | The additive changes listed in STORY.md §4.1 / §12 Step 0 are approved (optional `SaveData.story`, v1 saves must still load). |
| "Arcology", "Hab Blocks" | Keep: both are generic architecture/sci-fi terms. |
| Random-events setting | Mutes random city incidents only; story and faction cards are core and stay on. |
| Late-game money | **Money is the reward.** An established, well-built city should earn easily. No levies, wealth taxes or prices that scale with the treasury. Deficit help (bailout) is fine. |
| Toolbar width on narrow phones, extra faction cards | Undecided: the owner will play through first. |

## Expansion decisions (roads, wealth and ports interview)

Binding spec: `docs/EXPANSION.md` ("Roads, Wealth and Ports"); measured balance in its §10.5.

| Topic | Decision |
|---|---|
| Request | "Different road types, different levels to zoning ($, $$, $$$), and airports/spaceports/ports in general, and any other things that could fit in." |
| Wealth | **The city decides.** $ / $$ / $$$ emerges from land value and conditions (services, transit, schools, quiet; noise and crime hold it back). It shows as the Wealth view and in the block art; the player steers it and never paints it. Density levels keep growing as before. |
| Roads | Street, Avenue, Highway (nothing fronts a highway; crossing it with a street makes on-ramps), Back Alley (cheap, narrow, low capacity, more crime, affordable homes, crews like them) and elevated Skyways that land on streets and dock into megastructures. **No one-way streets.** |
| Ports | Seaport (cargo docks on a straight shore; industry; smuggling), Airport (large, loud; commerce and visitors; planes), Spaceport (late megaproject; slow build; night launches; huge prestige; launch rights a faction wants). **No aircar skyports.** |
| Extras | A small curated set, each optional: Academy (schools steer wealth), regional links (roads at the map edge bring trade), visitors and tourism. |
| Late-game money | Still **the reward**: no levies, no treasury-scaled prices, no hidden sandbox penalty for a rich ($$$) city. Rich-city friction lives only in the story (the Board's "Priced out" mood and card); back alleys are the affordable lever. |
| Toolbar | Still 9 buttons. The Power button relabels to **"Infra"** ("Power & Ports" on wide screens) when the first port unlocks (approved). |
| Launches | At most one per visual night and at least 180 unpaused seconds apart (approved); the first one is announced 10 s ahead with a Watch button. |
| Pace | "Pace of play feels way too fast": every new cadence runs in unpaused real seconds (or the visual clock), new unlocks sit on the existing population milestones, and story additions are relaxed deck cards, never new chapter beats. |
| Safety | Costly buildings and highways that cut lots off wait for ✓; road, skyway and zone drags can be undone for 10 s; a building bulldozed within 30 s is refunded in full. |
| Fail state, IP | Unchanged: no losing; fully original names and art (generic terms only: Street, Avenue, Highway, Back Alley, On-ramp, Skyway, Seaport, Airport, Spaceport, Academy). |

## Megacity decisions (districts and scale interviews)

Binding spec: `docs/MEGACITY.md` ("Districts, Scale, Skybridges and Variety"); measurements in its §2, the owner's answers in its Appendix E.

| Topic | Decision |
|---|---|
| Request | "The map needs to be bigger, or you should be able to expand to a new area of your choosing after each chapter. Houses don't hold enough people, businesses don't provide enough jobs. Skybridges feel clunky. Corp towers need more personality. More variety is the biggest thing." |
| Map | **Unlock districts**: after each chapter a land grant annexes an adjacent 64×64 district of the player's choosing, each with its own terrain and character; grants keep coming after the ending, and in the sandbox districts can also be **bought with credits** (fixed prices by districts owned, never scaled with the treasury). |
| Scale | **Megacity**: ten times the people per building, denser offices and fabs, megastructures that out-house the towers around them, millions of residents; every population goal, unlock and story threshold rescaled. Money stays at per-building parity (to confirm at Step 9). |
| Skybridges | **Rework all four**: placing (tap a tower, tap a partner), rules (one height rule, drawn on the map), looks (bigger tubes, faction and district skins, walkers) and payoff (shown numbers, Sky Lobbies); clearly separate from Skyways. |
| Variety | **All four kinds**: no clone buildings (merged parcels and a building kit), faction architecture for corp towers and megastructures (today's designs kept as the first look), unique landmarks and more civic types, life and atmosphere (crowds, weather, vehicles, district character, city life). |
| Choices that last | "Even if the story ends, you should be able to keep building your city, making it your own." The ending reshapes the skyline and opens its own landmark; key choices leave named places and plaques; epilogue cards and Charter Reviews recall them. |
| Hills | **Painted first**: Highstep Terraces ship with painted terraces (contour shading, retaining walls, stairs); real raised steps stay an optional later package. |
| Region size | **Per city, chosen at New City**: phones default to **3×3** (9 districts, ≈ 4–5 M people), PCs to **5×5** (25 districts, ≈ 12 M). The device sets the default, the player can override it, and a phone that picks 5×5 is warned and runs it in lower detail; far districts may rest when a PC struggles. Old cities become 3×3. *Spec addition, owner to confirm:* a 3×3 city can grow once into a 5×5 (never back), so a phone's city moved to a computer can use the bigger map. |
| City transfer | **Export/import file**: Menu → Export city saves a small file; Import city on another device opens it after a confirm, keeping the replaced city as Previous city. No accounts or servers. Works in the single-file build and the installed app on iOS and Android. The city's story pace travels with it; importing an older copy of the same city is flagged before it replaces newer play. |
| Desktop | **All three**: on wide screens with a mouse, inspect, story and reports open as a **side panel** so the city stays visible; **hover tooltips** on tools and buildings (names, costs, key numbers); **shortcut hints** on tool buttons plus a **?** sheet. The phone layout does not change. |
| Standing decisions | Unchanged: no losing; late-game money is the reward (no levies, no treasury-scaled prices); relaxed real-time story pacing with no new interruptions; phone first (44 px targets) with mid-range phone performance a hard constraint for the 3×3 region; fully original IP. |
