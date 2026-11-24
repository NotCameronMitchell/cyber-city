// ─────────────────────────────────────────────────────────────────────────────
// Boot + frame loop. Wires Game, Camera, Renderer, InputController, UI and
// AudioEngine together, keeps the canvas sized to the (visual) viewport, runs
// the rAF loop, autosaves, and supports the artifact hot-reload hooks.
// Every page load (and the artifact's hot reload) opens on the start screen:
// the city stays paused behind it and the game is held until the player
// leaves it (src/ui/start).
//
//   frame:  game.update → input.update → renderer.render → ui.update
//           (on the title: start.update (drift) → renderer.render → ui.update)
//   saves:  every 3 sim months · every 90 s of unpaused play · page hide
//           (none while the title is up: nothing changes behind it)
// ─────────────────────────────────────────────────────────────────────────────

import { AudioEngine } from './audio/audio';
import { SAVE_KEY } from './game/config';
import { Game } from './game/game';
import { storageGet } from './game/storage';
import type { SaveData } from './game/types';
import { InputController } from './input/input';
import { Camera } from './render/camera';
import { Renderer } from './render/renderer';
import { saveState, worthKeeping } from './ui/start/startModel';
import { StartScreen } from './ui/start/startScreen';
import { UI } from './ui/ui';

/** Longest frame step fed to the game (s): a long stall must not teleport the sim. */
const MAX_DT = 0.1;
/** Autosave every N months of sim time … */
const AUTOSAVE_MONTHS = 3;
/** … and every N seconds of unpaused play. */
const AUTOSAVE_SECONDS = 90;
/** The idle title redraws the drifting city at most this often (s): half the work on phones. */
const TITLE_FRAME = 1 / 30;
/** With reduced motion the title's city is a still picture: redrawn this rarely (s), time stopped. */
const TITLE_STILL_FRAME = 1 / 8;

interface HotApi {
  data?: unknown;
  ready?: (cb: (data?: unknown) => void) => void;
  snapshot?: (fn: () => unknown) => void;
}

function looksLikeSave(data: unknown): data is SaveData {
  return !!data && typeof data === 'object' && Array.isArray((data as SaveData).tiles);
}

function start(data?: unknown): void {
  const canvas = document.getElementById('game') as HTMLCanvasElement | null;
  const root = document.getElementById('ui');
  if (!canvas || !root) throw new Error('Cyber City: #game canvas or #ui root missing');

  const game = new Game();
  // Did the Game load the stored city, or start fresh because it could not read it?
  const stored = saveState(storageGet(SAVE_KEY), game.world);
  let restored = false;
  if (looksLikeSave(data)) {
    restored = game.restore(data);
    if (!restored) console.warn('[boot] hot-reload snapshot could not be restored');
  }

  const camera = new Camera();
  const renderer = new Renderer(canvas, game, camera);
  const input = new InputController(canvas, game, camera);
  const ui = new UI(root, game, camera);
  const audio = new AudioEngine(game);

  // ── Start screen ──────────────────────────────────────────────────────────
  // A newer build's save keeps this session on a throwaway city (save blocked): offer New City, not Continue.
  const blocked = (game as { saveBlocked?: boolean }).saveBlocked === true;
  let saveNow: (why: string) => boolean = () => false;
  const w = game.world;
  const title = new StartScreen({
    game,
    camera,
    ui,
    canvas,
    // A restored snapshot counts only with progress (a title that was never left has none).
    hasCity: (stored === 'loaded' && !blocked) || (restored && worthKeeping({ tick: w.tick, buildingCount: w.buildings.size, tiles: w.tiles })),
    unreadable: stored === 'unreadable' && !restored,
    save: () => saveNow('menu'),
  });

  (window as any).cc = { game, camera, renderer, input, ui, audio, start: title };
  // No snapshot of a first-launch title that was never left: the next load must not offer Continue for it.
  (window as any).claude?.hot?.snapshot?.(() => (title.holding && !title.hasCity ? undefined : game.snapshot()));

  // ── Sizing ────────────────────────────────────────────────────────────────
  // Coalesce bursts of resize events into one resize per frame; iOS reports
  // the final size of an orientation change a little late, so check again.
  let resizeQueued = false;
  const queueResize = () => {
    if (resizeQueued) return;
    resizeQueued = true;
    requestAnimationFrame(() => {
      resizeQueued = false;
      renderer.resize();
      title.resize();
    });
  };
  window.addEventListener('resize', queueResize);
  window.addEventListener('orientationchange', () => {
    queueResize();
    setTimeout(queueResize, 250);
    setTimeout(queueResize, 600);
  });
  window.visualViewport?.addEventListener('resize', queueResize);
  renderer.resize();

  // ── Autosave ──────────────────────────────────────────────────────────────
  let monthsSinceSave = 0;
  let playSinceSave = 0;
  const save = (why: string): boolean => {
    // Nothing changes behind the title, and a first launch that never left it has no city to keep.
    if (title.holding && why !== 'menu') return false;
    monthsSinceSave = 0;
    playSinceSave = 0;
    try {
      return game.save();
    } catch (err) {
      console.warn(`[autosave] ${why} failed`, err);
      return false;
    }
  };
  game.events.on('month', () => {
    if (++monthsSinceSave >= AUTOSAVE_MONTHS) save('monthly');
  });
  // A fresh world starts its own count (newCity already saves itself).
  game.events.on('world', () => {
    monthsSinceSave = 0;
    playSinceSave = 0;
  });
  saveNow = save;
  window.addEventListener('pagehide', () => save('pagehide'));

  // ── Frame loop ────────────────────────────────────────────────────────────
  let rafId = 0;
  let last = 0;
  let time = 0;
  let errors = 0;
  /** Seconds since the idle title last redrew the city. */
  let titleAcc = TITLE_FRAME;
  /** Animation time the title draws with (stopped while its backdrop is a still picture). */
  let titleTime = 0;

  const frame = (now: number) => {
    rafId = requestAnimationFrame(frame);
    let dt = last ? (now - last) / 1000 : 1 / 60;
    last = now;
    if (!(dt >= 0)) dt = 0;
    if (dt > MAX_DT) dt = MAX_DT;
    time += dt;
    try {
      if (title.holding) {
        // Title: the city is held (no sim, no story timers, no input); only the drift moves.
        // First launch draws the showcase city (title.backdrop) instead of the bare map.
        title.update(dt);
        titleAcc += dt;
        const still = title.still;
        if (!still) titleTime = time;
        if (!title.idle || titleAcc >= (still ? TITLE_STILL_FRAME : TITLE_FRAME) * 0.9) {
          (title.backdrop ?? renderer).render(still ? 0 : Math.min(titleAcc, MAX_DT), titleTime);
          titleAcc = 0;
        }
      } else {
        game.update(dt);
        input.update(dt);
        renderer.render(dt, time);
        titleAcc = TITLE_FRAME;
      }
      ui.update(dt);
    } catch (err) {
      // Keep the loop alive; report the first few so a bad frame is visible.
      if (errors++ < 5) console.error('[frame]', err);
    }
    if (game.speed > 0) {
      playSinceSave += dt;
      if (playSinceSave >= AUTOSAVE_SECONDS) save('timer');
    }
  };

  const run = () => {
    if (rafId) return;
    last = 0;
    rafId = requestAnimationFrame(frame);
  };
  const stop = () => {
    if (rafId) cancelAnimationFrame(rafId);
    rafId = 0;
  };

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      stop();
      save('hidden');
    } else {
      queueResize();
      run();
    }
  });
  if (document.visibilityState !== 'hidden') run();

  registerServiceWorker();
}

/** Offline support for the hosted build only (never in dev, iframes or file://). */
function registerServiceWorker(): void {
  try {
    if (!import.meta.env.PROD) return;
    if (!('serviceWorker' in navigator)) return;
    if (window.top !== window) return;
    const local = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
    if (location.protocol !== 'https:' && !local) return;
    const register = () => {
      navigator.serviceWorker.register('./sw.js', { scope: './' }).catch((err) => {
        console.info('[sw] not registered', err?.message ?? err);
      });
    };
    if (document.readyState === 'complete') register();
    else window.addEventListener('load', register, { once: true });
  } catch {
    /* sandboxed or unsupported: run without offline support */
  }
}

const hot = (window as any).claude?.hot as HotApi | undefined;
if (hot?.ready) hot.ready(start);
else start(hot?.data);
