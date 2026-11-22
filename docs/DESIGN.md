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
