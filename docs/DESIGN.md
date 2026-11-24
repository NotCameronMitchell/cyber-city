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
