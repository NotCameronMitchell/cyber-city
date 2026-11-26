# Cyber City

An isometric city builder set in a rain-soaked, neon-lit future, made for
phones first. Lay streets, zone hab blocks, market strips and fab districts,
keep the power grid alive, and grow a settlement into a glowing megacity.
You are MOTH, the hidden city AI nobody meant to wake: a six-chapter story,
"Who Holds the Charter", plays out over your city, with factions to court,
street crews to manage and five endings. You can never lose.
It plays in portrait or landscape, works offline once installed, and also runs
on desktop with mouse and keyboard.

Vanilla TypeScript, Vite and Canvas 2D. No runtime dependencies, no image or
audio files: every building, car, sign and sound is generated in code.

## How to play

1. **Build a road.** Pick *Road* and drag across tiles. Roads can bridge water.
2. **Zone next to it.** *Zones* holds Hab Blocks (homes), Market Strips (shops)
   and Fab Districts (jobs, pollution). Zoned lots need a road within 3 tiles.
3. **Power it.** A Solar Farm (under *Power*) touching your roads or zones
   lights up the grid. When demand outgrows supply, construction stalls.
4. **Watch the R·C·I bars** in the top bar and zone whatever is in demand.
   Add services (plazas, enforcer precincts, med clinics, data hubs, maglev)
   to raise land value and fight crime, smog and traffic. More services and
   the landmarks unlock as the population grows.
5. Keep the treasury positive: tap the credits readout for the budget and tax
   slider.
6. **Follow the story.** Your first road wakes MOTH. The strip above the
   toolbar shows the chapter goals (tap it for the goal drawer), the faction
   sheet and COMMS, where faction messages wait for an answer (or answer
   themselves after a while).

### Touch (phone / tablet)

| Gesture | Action |
|---|---|
| One-finger drag | Pan the map (with momentum) |
| Pinch | Zoom around your fingers |
| Tap | Inspect a tile or building (tap again to deselect) |
| Double-tap | Zoom in |
| Double-tap, then drag up / down | One-thumb zoom |
| Two-finger tap | Zoom out |
| Drag with a build tool | Preview, then release to build (roads as an L-path, zones and bulldoze as a rectangle) |
| Press and hold with a build tool | Peek at tile info instead of building |
| Drag near a screen edge while building | Auto-scroll the map |

### Mouse and keyboard (desktop)

| Input | Action |
|---|---|
| Left drag | Pan, or build with a tool selected |
| Right / middle drag | Pan |
| Wheel, trackpad pinch | Zoom at the cursor |
| WASD / arrow keys | Pan (Shift = faster) |
| `+` / `-` | Zoom |
| Space | Pause / resume |
| `1` `2` `3` | Sim speed |
| `R` road, `B` bulldoze | Tools (press again for Inspect) |
| `Z` `X` `C` | Zone homes / shops / industry |
| `O` (Shift+`O`) | Cycle data views forwards (backwards) |
| Esc | Close panels, back to Inspect |

## Features

- **Story campaign:** six chapters with measurable goals and key choices,
  Silt Logs to recover, five endings decided on Charter Night, and an
  epilogue where the sandbox carries on (an endings gallery is kept per
  device). Old saves load and start the story at Chapter I.
- **Factions:** the Charter Board, Basalt, Nacre, two street crews (the
  Undertow and the Glass Kites) and a hidden sixth; standing, moods, deals,
  pacts, salt, exclusive buildings, a balance-of-power bar and Trace (how
  close anyone is to proving MOTH exists).
- **Turf and crackdowns:** crews claim streets as the city grows (Turf data
  view); precincts can launch crackdowns, or you can sign a pact.
- **Vertical city:** Stratablocks raised in three stages with a choice of
  crown, skybridges between tall towers, and the elevated Ribbon Rail with
  stations (all under *Sky*).
- **Simulation:** power grid with brownouts, pollution, land value, crime,
  traffic, RCI demand, building growth, decline and abandonment, a monthly
  budget with taxes and upkeep, population milestones with grants, random
  city incidents, and an advisor that warns about problems.
- **Art:** procedural buildings in 16 looks per zone and density, construction
  and abandoned states, a day/night cycle where the city switches to neon,
  street traffic, flying cars, searchlights, ad blimps, drizzle and storms.
- **Data views:** power, land value, crime, pollution, traffic, service
  coverage and turf.
- **Mobile-first UI:** notch-safe layout for portrait phones, landscape phones
  (side rail), tablets and desktop; touch targets of 44 px or more; haptics.
- **Audio:** synthesized sound effects and an optional generative synth score.
- **Saves:** autosaves on this device every 3 in-game months, every 90 s of
  play and whenever the page is hidden. Save and load from the menu.
- **Installable PWA:** add it to your home screen for a fullscreen app that
  works offline.

## Commands

```bash
npm install            # once
npm run dev            # dev server (also on your LAN: open it on your phone)
npm test               # vitest suites (sim, actions, saves, gestures, story)
npm run typecheck      # tsc --noEmit
npm run build          # typecheck + production build into dist/
npm run preview        # serve dist/ locally
npm run build:single   # dist-single/index.html: one self-contained file
```

`build:single` inlines the script and stylesheet into one HTML file that runs
from `file://` or inside a sandboxed iframe. It only needs the network for the
Google Fonts stylesheet and falls back to system fonts without it. Offline
caching and installing need the hosted build.

## Deploying to GitHub Pages

`.github/workflows/deploy.yml` runs on every push to `main` (or by hand from
the Actions tab): it installs with `npm ci`, runs the tests, builds and
publishes `dist/` to GitHub Pages.

One-time setup: in the repository go to **Settings → Pages** and set
**Source** to **GitHub Actions**. The build uses relative paths (`base: './'`),
so it works under `https://<user>.github.io/<repo>/` without changes.

The service worker (`public/sw.js`) caches the app for offline play. After a
release that changes caching, bump `VERSION` in it.

## Project structure

```
index.html               page shell (canvas + UI root)
public/                  manifest, icons, service worker
scripts/inline.mjs       single-file build step
src/
  main.ts                boot, frame loop, resize, autosave, hot reload, SW
  game/                  data model, world, actions, game controller,
                         simulation (sim.ts + sim/), balance config, news copy
  game/story/            story director, factions, turf, megastructures,
                         save encoding; content/ holds every card and line
  render/                camera, renderer, ground cache, overlays, sky,
                         building art (buildings.ts + art/), effects
  input/                 touch / mouse / keyboard gestures, haptics
  ui/                    DOM HUD, toolbar, panels, dialogs, ui.css
                         (ui/story/: story card, rail, sheets, Charter Night)
  audio/                 synthesized SFX and music
tests/                   vitest suites
docs/                    CONTRACTS.md (module APIs), STORY-CONTRACT.md
                         (story interfaces), DESIGN.md, STORY.md (story spec)
```

`docs/CONTRACTS.md` describes how the modules talk to each other;
`docs/STORY-CONTRACT.md` covers the story layer, specified in `docs/STORY.md`.

## Debugging

In the browser console, `window.cc` exposes `{ game, camera, renderer }` (plus
`input`, `ui` and `audio`). For example, `cc.game.setSpeed(3)` or
`cc.game.setOverlay('crime')`. `cc.game.story.view()` shows the story state;
`cc.game.story.charterNight()` opens Charter Night early. Settings → *Show FPS* turns on a frame-time
readout.

## IP note

Cyber City is original work in the cyberpunk genre. Its names, places,
corporations, crews, slang, art, sounds and UI are invented for this project.
It is not affiliated with, and borrows nothing from, any existing game or
franchise.
