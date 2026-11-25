// ─────────────────────────────────────────────────────────────────────────────
// InputController: every way the player touches the city.
//
// Touch (primary target)
//   1 finger, inspect     drag pans with inertia · tap selects (height-aware,
//                         so tapping a tower's body picks the tower) · tap the
//                         selected tile again to deselect · double-tap zooms in
//                         · double-tap-and-drag up/down = one-thumb zoom
//   1 finger, build tool  press previews · drag updates the L-path / rectangle
//                         / footprint ghost · release applies · near a screen
//                         edge the map auto-scrolls · hold still ~0.45 s to
//                         peek-inspect instead (drag to scrub, nothing applied)
//                         · a costly or lossy plan (game.commit → pendingConfirm)
//                         keeps its ghost after release and waits for ✓ / ✕ on
//                         the action pill; a new drag (or tap) moves it, two
//                         fingers look around without dropping it
//   Inspect taps          a tap on a skyway deck selects the deck (sky: true)
//   Port tools            the Seaport ghost snaps to the nearest valid shore
//                         site; picking a port tool zooms out to fit its noise
//                         ring, and leaving it zooms back (EXPANSION §5.1, §5.4)
//   2+ fingers            pinch zoom + pan around the centroid, always; a
//                         second finger cancels a build drag · quick
//                         two-finger tap zooms out
// Mouse
//   left = one finger · right / middle drag = pan · wheel = smooth zoom at the
//   cursor (ctrl+wheel trackpad pinch is applied 1:1) · hovering with a build
//   tool previews the tile / footprint under the cursor
// Keyboard: see keyboard.ts.
//
// Only canvas pointer events are handled (UI panels sit above with their own
// pointer events), positions are canvas-relative CSS px = camera space.
// Gesture state lives in a small state machine (`mode`) per pointer session
// (first finger down → last finger up). Continuous motion (fling, animated
// zoom, keyboard pan, edge scroll, long-press timing) runs in update(dt).
// ─────────────────────────────────────────────────────────────────────────────

import { snapSeaport } from '../game/actions';
import { BUILDINGS, isBuildingTool } from '../game/config';
import type { Game } from '../game/game';
import { shoreSites } from '../game/ports';
import { SKY_RAMP } from '../game/skyway';
import { ZoneType, type ToolId } from '../game/types';
import { serviceBuildingHeight, zoneBuildingHeight } from '../render/buildings';
import { TILE_H, TILE_W, type Camera, type Vec } from '../render/camera';
import {
  CLICK_MAX_MS,
  DOUBLE_TAP_MS,
  DOUBLE_TAP_SLOP_MOUSE,
  DOUBLE_TAP_SLOP_TOUCH,
  DOUBLE_TAP_ZOOM,
  EDGE_MAX_SPEED,
  EDGE_RAMP_S,
  EDGE_ZONE,
  FLING_CATCH_SPEED,
  FLING_FRICTION,
  FLING_MAX_SPEED,
  FLING_MIN_SPEED,
  FLING_STOP_SPEED,
  HAPTIC_TICK_GAP_MS,
  LONG_PRESS_MS,
  PINCH_WHEEL_MAX_DELTA,
  PINCH_WHEEL_RATE,
  REPLAN_INTERVAL_S,
  TAPZOOM_RATE,
  TAP_MAX_MS,
  TAP_SLOP_MOUSE,
  TAP_SLOP_TOUCH,
  TWO_FINGER_TAP_LAND_MS,
  VelocityTracker,
  WHEEL_ZOOM_RATE,
  ZOOM_EASE,
  capSpeed,
  centroidSpread,
  clamp,
  clampToolTile,
  damp,
  edgeScrollVelocity,
  flingDisplacement,
  isTwoFingerTap,
  pickTile,
  pointerActivity,
  SKY_PICK_BASE,
  SKY_PICK_RAMP_BASE,
  SKY_PICK_TOP,
  pinchFactor,
  screenToTileF,
  screenToTileInto,
  smoothstep,
  wheelDeltaPx,
  type Centroid,
  type PickFootprint,
  type PickHit,
} from './gestures';
import { annexPins, pinAt } from '../render/districts';
import { HAPTIC_CONFIRM_MS, HAPTIC_TICK_MS, haptic } from './haptics';
import { KeyboardInput, isTypingTarget } from './keyboard';
import { MAP_PINCH_IN, MAP_PINCH_OUT, mapBus } from './mapbus';

type PointerKind = 'mouse' | 'touch' | 'pen';

/** One finger / pen / mouse currently pressed on the canvas. */
interface TrackedPointer {
  id: number;
  kind: PointerKind;
  /** Current position (canvas CSS px). */
  x: number;
  y: number;
  downX: number;
  downY: number;
  /** performance.now() at press. */
  downT: number;
  button: number;
}

/**
 * Gesture state of the current pointer session.
 *  pan      one pointer drags the map (inspect tool, right/middle mouse, or the
 *           finger left over after a pinch)
 *  build    one pointer drives a build-tool preview; release applies
 *  pinch    2+ touch pointers zoom + pan
 *  tapzoom  second press of a double-tap: release = zoom step, drag = zoom
 *  scrub    long-press peek-inspect inside a build tool (never applies)
 *  void     gesture was cancelled (Esc / tool change); ignore until release
 */
type Mode = 'idle' | 'pan' | 'build' | 'pinch' | 'tapzoom' | 'scrub' | 'void';

const NO_TILE = -99999;

/** Tools whose ghost is big and loud enough that picking them zooms out to fit (EXPANSION §5.4). */
const FIT_TOOLS: ReadonlySet<ToolId> = new Set<ToolId>(['seaport', 'airport', 'spaceport']);
/** Share of the screen the footprint + noise ring may fill after the fit zoom. */
const FIT_MARGIN = 0.92;

export class InputController {
  // ── Pointer session ───────────────────────────────────────────────────────
  /** Pressed pointers in press order (a handful at most, so linear search is fine). */
  private readonly pointers: TrackedPointer[] = [];
  private session: 'mouse' | 'touch' | null = null;
  private mode: Mode = 'idle';
  /** The pointer driving single-pointer modes. */
  private primary: TrackedPointer | null = null;
  /** Primary pointer travelled beyond the tap slop. */
  private moved = false;
  /** This session may still end as a tap (single pointer, didn't catch a fling…). */
  private tapAllowed = false;
  private lastX = 0;
  private lastY = 0;

  // ── Pan velocity (fed with the accumulated pan offset, continuous across finger changes)
  private readonly tracker = new VelocityTracker();
  private panAccX = 0;
  private panAccY = 0;
  private flingVx = 0;
  private flingVy = 0;

  // ── Pinch
  private readonly centroid: Centroid = { x: 0, y: 0, spread: 0, count: 0 };
  private pinchCx = 0;
  private pinchCy = 0;
  private pinchSpread = 0;
  private pinchStartCx = 0;
  private pinchStartCy = 0;
  private pinchStartSpread = 0;
  private pinchStartT = 0;
  private pinchMaxCount = 0;
  private pinchTravel = 0;
  private pinchMinRatio = 1;
  private pinchMaxRatio = 1;
  private pinchTapEligible = false;
  /** City map snap (MEGACITY §3.9): spread ratio accumulated while pinching out at minZoom / in at the map's largest zoom. */
  private pinchOut = 1;
  private pinchIn = 1;

  // ── Build drag
  private readonly buildStart: Vec = { x: 0, y: 0 };
  private readonly buildCur: Vec = { x: 0, y: 0 };
  private edgeTime = 0;
  private readonly scrubTile: Vec = { x: NO_TILE, y: NO_TILE };
  /** The current selection came from a long-press peek (cleared when building resumes). */
  private peekSelection = false;
  /**
   * The press began while a plan waited for ✓: it is only dropped once this finger
   * moves or lifts as a tap; a second finger (look around) keeps it (EXPANSION §7.7).
   */
  private holdPending = false;

  // ── Seaport snap: valid shore top-lefts (ports.shoreSites), recounted after tile edits.
  private shoreMarks: Uint8Array | null = null;
  private shoreDirty = true;

  // ── Port tools zoom out to fit; leaving them restores `prev` unless the player zoomed meanwhile.
  private fit: { prev: number; set: number } | null = null;

  // ── Animated zoom (wheel, keyboard, double-tap). 0 = idle.
  private zoomTarget = 0;
  private zoomAx = 0;
  private zoomAy = 0;

  // ── City map: an annex pin under the press (a tap opens the City map on its slot), the map session.
  private pinSlot = -1;
  private mapSession = false;

  // ── Double-tap memory
  private lastTapT = -Infinity;
  private lastTapX = 0;
  private lastTapY = 0;

  // ── Mouse hover preview
  private hoverActive = false;
  private hoverShown = false;
  private readonly hoverPos: Vec = { x: 0, y: 0 };
  private readonly hoverTile: Vec = { x: NO_TILE, y: NO_TILE };

  // ── Frame bookkeeping
  private replanAcc = 0;
  private camX = NaN;
  private camY = NaN;
  private camZoom = NaN;
  private cursor = '';
  private rect: DOMRect;

  // ── Scratch (no per-move allocation)
  private readonly tmpTile: Vec = { x: 0, y: 0 };
  private readonly tmpHit: PickHit = { x: 0, y: 0, sky: false };
  private readonly tmpF: Vec = { x: 0, y: 0 };
  private readonly tmpV: Vec = { x: 0, y: 0 };

  private readonly keyboard: KeyboardInput;
  private readonly offs: (() => void)[] = [];
  private readonly savedStyle: { touchAction: string; cursor: string };

  constructor(
    public canvas: HTMLCanvasElement,
    public game: Game,
    public camera: Camera,
  ) {
    this.rect = canvas.getBoundingClientRect();

    // Own every touch on the map: no browser pan / pinch-zoom / double-tap
    // zoom / long-press callout / text selection / tap flash.
    const st = canvas.style;
    this.savedStyle = { touchAction: st.touchAction, cursor: st.cursor };
    st.touchAction = 'none';
    st.setProperty('user-select', 'none');
    st.setProperty('-webkit-user-select', 'none');
    st.setProperty('-webkit-touch-callout', 'none');
    st.setProperty('-webkit-tap-highlight-color', 'transparent');

    const active: AddEventListenerOptions = { passive: false };
    this.listen(canvas, 'pointerdown', this.onPointerDown as EventListener, active);
    this.listen(canvas, 'pointermove', this.onPointerMove as EventListener, active);
    this.listen(canvas, 'pointerup', this.onPointerUp as EventListener, active);
    this.listen(canvas, 'pointercancel', this.onPointerCancel as EventListener);
    this.listen(canvas, 'lostpointercapture', this.onLostCapture as EventListener);
    this.listen(canvas, 'pointerenter', this.onPointerEnter as EventListener);
    this.listen(canvas, 'pointerleave', this.onPointerLeave as EventListener);
    this.listen(canvas, 'wheel', this.onWheel as EventListener, active);
    this.listen(canvas, 'contextmenu', preventDefault, active);
    this.listen(canvas, 'dblclick', preventDefault, active);
    this.listen(canvas, 'auxclick', preventDefault, active);
    this.listen(canvas, 'mousedown', this.onMouseDown as EventListener, active);
    // Belt and braces for browsers that leak scroll / rubber-band through touch-action.
    this.listen(canvas, 'touchmove', preventDefault, active);
    // iOS Safari's proprietary pinch-zoom gesture events.
    this.listen(document, 'gesturestart', preventDefault, active);
    this.listen(document, 'gesturechange', preventDefault, active);
    this.listen(document, 'gestureend', preventDefault, active);
    // Layout changes move the canvas origin.
    this.listen(window, 'resize', this.refreshRect);
    this.listen(window, 'orientationchange', this.refreshRect);
    this.listen(window, 'scroll', this.refreshRect, { passive: true });
    if (window.visualViewport) this.listen(window.visualViewport, 'resize', this.refreshRect);
    // Losing focus mid-gesture (app switch, notification) must not leave a drag stuck.
    this.listen(window, 'blur', this.onBlur);
    this.listen(document, 'visibilitychange', this.onVisibility);

    const ev = game.events;
    this.offs.push(ev.on('tool', this.onToolChanged));
    this.offs.push(ev.on('world', this.onWorldChanged));
    this.offs.push(ev.on('tiles', () => (this.shoreDirty = true)));

    this.keyboard = new KeyboardInput(game, {
      zoomStep: (factor) => this.animateZoom(factor, this.camera.width / 2, this.camera.height / 2, true),
      cancelGesture: () => this.cancelGesture(),
      confirmPending: () => this.confirmPending(),
    });
    this.updateCursor();
  }

  // ── Public API ────────────────────────────────────────────────────────────

  /** Per-frame: long-press timing, edge scroll, fling, animated zoom, keyboard pan, hover tracking. */
  update(dt: number): void {
    if (!(dt > 0)) return;
    dt = Math.min(dt, 0.1);
    const cam = this.camera;
    const now = performance.now();

    // Long-press in a build tool → peek-inspect.
    const p = this.primary;
    if (this.mode === 'build' && p && !this.moved && p.kind !== 'mouse' && now - p.downT >= LONG_PRESS_MS) {
      this.enterScrub(p);
    }

    // Edge auto-scroll while dragging a build preview.
    if (this.mode === 'build' && p && this.moved) {
      const v = edgeScrollVelocity(p.x, p.y, cam.width, cam.height, EDGE_ZONE, EDGE_MAX_SPEED, this.tmpV);
      if (v.x !== 0 || v.y !== 0) {
        this.edgeTime += dt;
        const ramp = smoothstep(this.edgeTime / EDGE_RAMP_S);
        cam.panBy(-v.x * ramp * dt, -v.y * ramp * dt);
      } else {
        this.edgeTime = 0;
      }
    }

    // Fling inertia.
    if (this.flingVx !== 0 || this.flingVy !== 0) {
      const bx = cam.x;
      const by = cam.y;
      const dx = flingDisplacement(this.flingVx, FLING_FRICTION, dt);
      const dy = flingDisplacement(this.flingVy, FLING_FRICTION, dt);
      cam.panBy(dx, dy);
      const decay = Math.exp(-FLING_FRICTION * dt);
      this.flingVx *= decay;
      this.flingVy *= decay;
      const want = Math.hypot(dx, dy);
      const got = Math.hypot(cam.x - bx, cam.y - by) * cam.zoom;
      // Stop when slow, or when the camera clamp at the map edge ate the motion.
      if (Math.hypot(this.flingVx, this.flingVy) < FLING_STOP_SPEED || (want > 0.5 && got < want * 0.25)) this.stopFling();
    }

    // Animated zoom, eased in log space so in/out feel symmetric.
    if (this.zoomTarget > 0) {
      const z = cam.zoom;
      const lz = Math.log(z);
      const lt = Math.log(this.zoomTarget);
      const next = Math.abs(lt - lz) < 0.002 ? this.zoomTarget : Math.exp(lz + (lt - lz) * damp(ZOOM_EASE, dt));
      cam.zoomAt(next / z, this.zoomAx, this.zoomAy);
      if (next === this.zoomTarget || cam.zoom === z) this.zoomTarget = 0;
    }

    // Keyboard pan (eased).
    if (this.keyboard.step(dt, this.tmpV)) cam.panBy(-this.tmpV.x * dt, -this.tmpV.y * dt);

    // If the view moved under a stationary pointer, the tile under it changed.
    if (cam.x !== this.camX || cam.y !== this.camY || cam.zoom !== this.camZoom) {
      this.camX = cam.x;
      this.camY = cam.y;
      this.camZoom = cam.zoom;
      if (this.mode === 'build' && p && !this.holdPending) this.updateBuildAt(p.x, p.y, false);
      else if (this.mode === 'scrub' && p) this.updateScrub(p.x, p.y);
      else this.updateHover(false);
    }

    // Keep the preview honest as funds / tiles change under it.
    this.replanAcc += dt;
    if (this.replanAcc >= REPLAN_INTERVAL_S) {
      this.replanAcc = 0;
      if (this.mode === 'build' && !this.holdPending) this.refreshBuildPreview();
      else if (this.hoverShown) this.updateHover(true);
    }
  }

  /**
   * ✓ on the plan waiting for confirmation (the pill's ✓ and Enter): re-plans from the same points
   * and builds; a plan that is no longer valid toasts its reason (Game.confirmPending).
   */
  confirmPending(): void {
    const plan = this.game.confirmPending();
    if (plan?.valid) haptic(HAPTIC_CONFIRM_MS);
  }

  /** ✕ on the plan waiting for confirmation. */
  cancelPending(): void {
    this.game.cancelPending();
    this.holdPending = false;
  }

  destroy(): void {
    this.cancelGesture();
    if (this.hoverShown) this.game.setPreview(null);
    this.hoverShown = false;
    this.hoverActive = false;
    this.keyboard.destroy();
    for (const off of this.offs.splice(0)) off();
    this.canvas.style.touchAction = this.savedStyle.touchAction;
    this.canvas.style.cursor = this.savedStyle.cursor;
  }

  // ── Pointer events ────────────────────────────────────────────────────────

  private readonly onPointerDown = (e: PointerEvent) => {
    const kind: PointerKind = e.pointerType === 'mouse' ? 'mouse' : e.pointerType === 'pen' ? 'pen' : 'touch';
    const isMouse = kind === 'mouse';
    if (isMouse && e.button > 2) return; // back / forward buttons
    if (e.button === 1) e.preventDefault(); // middle-click autoscroll

    // A fresh primary press while we still track pointers means we missed an
    // up/cancel somewhere (OS gesture, devtools…): start clean.
    if (this.pointers.length > 0 && (isMouse || e.isPrimary)) this.resetSession();
    // Never mix mouse and touch in one session.
    if (this.session && (this.session === 'mouse') !== isMouse) return;
    if (this.find(e.pointerId)) return;

    blurTextFocus();
    this.refreshRect();
    // A tap during the annex fly-in skips to its end (§7.2).
    if (mapBus.flyIn && this.camera.animating) this.camera.easeToBox(mapBus.flyIn, 0, 0);
    mapBus.flyIn = null;
    const x = e.clientX - this.rect.left;
    const y = e.clientY - this.rect.top;
    const now = performance.now();
    const ptr: TrackedPointer = { id: e.pointerId, kind, x, y, downX: x, downY: y, downT: now, button: e.button };
    this.pointers.push(ptr);
    try {
      this.canvas.setPointerCapture(e.pointerId);
    } catch {
      /* pointer already gone */
    }

    if (this.pointers.length === 1) this.beginSession(ptr, now);
    else this.beginPinch(now);
    this.updateCursor();
  };

  private readonly onPointerMove = (e: PointerEvent) => {
    const ptr = this.find(e.pointerId);
    if (!ptr) {
      if (e.pointerType === 'mouse' && this.pointers.length === 0 && e.buttons === 0) {
        this.hoverPos.x = e.clientX - this.rect.left;
        this.hoverPos.y = e.clientY - this.rect.top;
        this.hoverActive = true;
        this.updateHover(false);
      }
      return;
    }
    ptr.x = e.clientX - this.rect.left;
    ptr.y = e.clientY - this.rect.top;
    const now = performance.now();

    if (ptr === this.primary && !this.moved) {
      const slop = ptr.kind === 'mouse' ? TAP_SLOP_MOUSE : TAP_SLOP_TOUCH;
      const dx = ptr.x - ptr.downX;
      const dy = ptr.y - ptr.downY;
      if (dx * dx + dy * dy > slop * slop) {
        this.moved = true;
        this.updateCursor();
        // A real drag replaces the plan waiting for ✓ (the ghost moves with the finger).
        if (this.mode === 'build' && this.holdPending) this.releasePending();
      }
    }

    switch (this.mode) {
      case 'pan':
        if (ptr === this.primary) {
          this.panGesture(ptr.x - this.lastX, ptr.y - this.lastY, now);
          this.lastX = ptr.x;
          this.lastY = ptr.y;
        }
        break;
      case 'pinch':
        this.updatePinch(now);
        break;
      case 'build':
        if (ptr === this.primary) this.updateBuildAt(ptr.x, ptr.y, true);
        break;
      case 'tapzoom':
        if (ptr === this.primary) {
          // Drag down = zoom in, up = zoom out, anchored where the double-tap landed.
          if (this.moved) this.camera.zoomAt(Math.exp((ptr.y - this.lastY) * TAPZOOM_RATE), ptr.downX, ptr.downY);
          this.lastY = ptr.y;
        }
        break;
      case 'scrub':
        if (ptr === this.primary) this.updateScrub(ptr.x, ptr.y);
        break;
      default:
        break;
    }
  };

  private readonly onPointerUp = (e: PointerEvent) => {
    const ptr = this.find(e.pointerId);
    if (ptr) {
      ptr.x = e.clientX - this.rect.left;
      ptr.y = e.clientY - this.rect.top;
    }
    this.releasePointer(e.pointerId, false);
  };

  private readonly onPointerCancel = (e: PointerEvent) => {
    this.releasePointer(e.pointerId, true);
  };

  /** Capture lost without an up/cancel (element removed, capture stolen…): treat as cancel. */
  private readonly onLostCapture = (e: PointerEvent) => {
    if (this.find(e.pointerId)) this.releasePointer(e.pointerId, true);
  };

  private readonly onPointerEnter = (e: PointerEvent) => {
    if (e.pointerType !== 'mouse') return;
    this.refreshRect();
  };

  private readonly onPointerLeave = (e: PointerEvent) => {
    if (e.pointerType !== 'mouse' || this.pointers.length > 0) return;
    this.hoverActive = false;
    this.clearHover();
  };

  private readonly onMouseDown = (e: MouseEvent) => {
    if (e.button === 1) e.preventDefault(); // Windows middle-click autoscroll
  };

  private readonly onWheel = (e: WheelEvent) => {
    e.preventDefault(); // never let the page zoom / scroll
    if (this.session === 'touch') return;
    const sx = e.clientX - this.rect.left;
    const sy = e.clientY - this.rect.top;
    const cam = this.camera;
    const d = wheelDeltaPx(e.deltaY, e.deltaMode, cam.height);
    if (d === 0) return;
    if (e.ctrlKey && Math.abs(d) < PINCH_WHEEL_MAX_DELTA) {
      // Trackpad pinch arrives as ctrl+wheel with small fine-grained deltas: apply 1:1.
      this.zoomTarget = 0;
      cam.zoomAt(Math.exp(-d * PINCH_WHEEL_RATE), sx, sy);
      return;
    }
    // Mouse wheel / trackpad scroll: accumulate into a smoothed target.
    const base = this.zoomTarget > 0 ? this.zoomTarget : cam.zoom;
    const z = zoomRange(cam);
    this.zoomTarget = clamp(base * Math.exp(-clamp(d, -240, 240) * WHEEL_ZOOM_RATE), z.lo, z.hi);
    this.zoomAx = sx;
    this.zoomAy = sy;
  };

  private readonly refreshRect = () => {
    this.rect = this.canvas.getBoundingClientRect();
  };

  private readonly onBlur = () => {
    this.cancelGesture(true);
    this.stopFling();
  };

  private readonly onVisibility = () => {
    if (document.visibilityState === 'hidden') this.onBlur();
  };

  // ── Game events ───────────────────────────────────────────────────────────

  private readonly onToolChanged = () => {
    // A tool switch mid-drag (hotkey, UI) abandons the drag; setTool cleared the preview.
    if (this.mode === 'build' || this.mode === 'scrub') this.mode = 'void';
    this.peekSelection = false;
    this.holdPending = false;
    this.hoverShown = false;
    this.shoreDirty = true;
    this.fitTool(this.game.tool);
    this.updateHover(true);
    this.updateCursor();
  };

  private readonly onWorldChanged = () => {
    this.cancelGesture();
    this.stopFling();
    this.fit = null;
    this.shoreDirty = true;
    this.holdPending = false;
    this.peekSelection = false;
    this.lastTapT = -Infinity;
    this.hoverShown = false;
    this.updateHover(true);
  };

  // ── Session lifecycle ─────────────────────────────────────────────────────

  private beginSession(ptr: TrackedPointer, now: number): void {
    this.session = ptr.kind === 'mouse' ? 'mouse' : 'touch';
    const caught = Math.hypot(this.flingVx, this.flingVy) > FLING_CATCH_SPEED;
    this.stopFling(); // a touch stops the map
    if (ptr.kind !== 'mouse') this.zoomTarget = 0;
    this.primary = ptr;
    this.moved = false;
    this.tapAllowed = !caught;
    this.edgeTime = 0;
    this.lastX = ptr.x;
    this.lastY = ptr.y;
    this.panAccX = 0;
    this.panAccY = 0;
    this.tracker.reset();
    this.tracker.add(now, 0, 0);
    // The gesture owns the preview from here; hover resumes after release.
    this.hoverShown = false;

    this.pinSlot = -1;
    this.mapSession = false;
    if (ptr.kind === 'mouse' && ptr.button !== 0) {
      this.mode = 'pan';
      this.tapAllowed = false;
      return;
    }

    // The City map (§7.2): one finger pans (while zoomed), a tap selects a slot, a double-tap zooms 1× ↔ 2× (5×5).
    if (this.camera.mapView) {
      this.mapSession = true;
      const slop = ptr.kind === 'mouse' ? DOUBLE_TAP_SLOP_MOUSE : DOUBLE_TAP_SLOP_TOUCH;
      const isSecondTap = now - this.lastTapT <= DOUBLE_TAP_MS && Math.hypot(ptr.x - this.lastTapX, ptr.y - this.lastTapY) <= slop;
      this.lastTapT = -Infinity;
      this.mode = isSecondTap && this.tapAllowed && this.camera.mapHeadroom > 1 ? 'tapzoom' : 'pan';
      return;
    }

    // An annex pin under the finger (§3.9): a tap opens the City map on its slot, whatever the tool.
    const pin = pinAt(annexPins(this.game.world, this.camera), ptr.x, ptr.y);
    if (pin) {
      this.pinSlot = pin.slot;
      this.mode = 'pan';
      return;
    }

    const tool = this.game.tool;
    if (tool === 'inspect') {
      const slop = ptr.kind === 'mouse' ? DOUBLE_TAP_SLOP_MOUSE : DOUBLE_TAP_SLOP_TOUCH;
      const isSecondTap =
        now - this.lastTapT <= DOUBLE_TAP_MS && Math.hypot(ptr.x - this.lastTapX, ptr.y - this.lastTapY) <= slop;
      this.lastTapT = -Infinity;
      this.mode = isSecondTap && this.tapAllowed ? 'tapzoom' : 'pan';
      return;
    }

    const t = screenToTileInto(this.camera, ptr.x, ptr.y, this.tmpTile);
    if (!this.game.world.inBounds(t.x, t.y)) {
      // Pressing off the map with a build tool just pans.
      this.mode = 'pan';
      this.tapAllowed = false;
      return;
    }
    if (this.peekSelection) {
      this.peekSelection = false;
      this.game.select(null);
    }
    this.clampTile(t);
    this.buildStart.x = this.buildCur.x = t.x;
    this.buildStart.y = this.buildCur.y = t.y;
    this.mode = 'build';
    pointerActivity.building = true;
    // A plan waiting for ✓ keeps its ghost until this press turns out to be a drag or a tap.
    this.holdPending = this.game.pendingConfirm !== null;
    if (!this.holdPending) this.refreshBuildPreview();
  }

  /** The press that began over a waiting plan became a drag or a tap: drop the plan, preview this one. */
  private releasePending(): void {
    this.holdPending = false;
    this.game.cancelPending();
    if (this.primary) this.updateBuildAt(this.primary.x, this.primary.y, false);
    this.refreshBuildPreview();
  }

  /** A second (or further) finger landed: everything becomes a pinch. */
  private beginPinch(now: number): void {
    const fresh = this.mode !== 'pinch';
    // Cancel the drag, nothing applied; a plan waiting for ✓ keeps its ghost while two fingers look around.
    if (this.mode === 'build' && !this.holdPending) this.game.setPreview(null);
    pointerActivity.building = false;
    if (fresh) {
      const first = this.primary;
      this.pinchTapEligible =
        this.pointers.length === 2 && !!first && !this.moved && now - first.downT <= TWO_FINGER_TAP_LAND_MS && this.mode !== 'scrub';
    } else {
      this.pinchTapEligible = false; // a third finger rules out a two-finger tap
    }
    this.mode = 'pinch';
    this.tapAllowed = false;
    this.zoomTarget = 0;
    this.stopFling();
    this.rebasePinch();
    if (fresh) {
      this.pinchStartT = now;
      this.pinchStartCx = this.pinchCx;
      this.pinchStartCy = this.pinchCy;
      this.pinchStartSpread = this.pinchSpread;
      this.pinchTravel = 0;
      this.pinchMinRatio = 1;
      this.pinchMaxRatio = 1;
      this.pinchMaxCount = 0;
      this.pinchOut = 1;
      this.pinchIn = 1;
    }
    this.pinchMaxCount = Math.max(this.pinchMaxCount, this.pointers.length);
  }

  /** Re-anchor the pinch on the current finger set so adding/removing a finger never jumps. */
  private rebasePinch(): void {
    const c = centroidSpread(this.pointers, this.centroid);
    this.pinchCx = c.x;
    this.pinchCy = c.y;
    this.pinchSpread = c.spread;
  }

  private updatePinch(now: number): void {
    const c = centroidSpread(this.pointers, this.centroid);
    if (c.count < 2) return;
    this.panGesture(c.x - this.pinchCx, c.y - this.pinchCy, now);
    const f = pinchFactor(this.pinchSpread, c.spread);
    if (f !== 1 && this.mapSnap(f, c.x, c.y)) return;
    if (f !== 1) this.camera.zoomAt(f, c.x, c.y);
    this.pinchCx = c.x;
    this.pinchCy = c.y;
    this.pinchSpread = c.spread;
    // Stats for two-finger-tap classification.
    this.pinchTravel = Math.max(this.pinchTravel, Math.hypot(c.x - this.pinchStartCx, c.y - this.pinchStartCy));
    if (this.pinchStartSpread > 0) {
      const r = c.spread / this.pinchStartSpread;
      if (r < this.pinchMinRatio) this.pinchMinRatio = r;
      if (r > this.pinchMaxRatio) this.pinchMaxRatio = r;
    }
  }

  /**
   * The City map snap by pinch (§3.9): a continued pinch-out at minZoom in a multi-district city opens the City map;
   * a continued pinch-in on the City map at its largest zoom leaves it towards the fingers. Returns true when it
   * snapped (the rest of the gesture is ignored).
   */
  private mapSnap(f: number, cx: number, cy: number): boolean {
    const cam = this.camera;
    const hooks = mapBus.hooks;
    if (!hooks) return false;
    if (cam.mapView) {
      const top = cam.mapZoom * cam.mapHeadroom;
      if (f > 1 && cam.zoom >= top * 0.995) {
        this.pinchIn *= f;
        if (this.pinchIn >= MAP_PINCH_IN) {
          hooks.leave(cx, cy);
          this.mode = 'void';
          haptic(HAPTIC_CONFIRM_MS);
          return true;
        }
      } else if (f < 1) this.pinchIn = 1;
      return false;
    }
    const w = this.game.world;
    if (f < 1 && cam.zoom <= cam.minZoom * 1.002 && w.region >= 3 && w.districts.owned.length >= 2) {
      this.pinchOut *= f;
      if (this.pinchOut <= MAP_PINCH_OUT) {
        hooks.open();
        this.mode = 'void';
        haptic(HAPTIC_CONFIRM_MS);
        return true;
      }
    } else if (f > 1) this.pinchOut = 1;
    return false;
  }

  private releasePointer(id: number, cancelled: boolean): void {
    const i = this.pointers.findIndex((q) => q.id === id);
    if (i < 0) return;
    const ptr = this.pointers[i];
    this.pointers.splice(i, 1);
    const now = performance.now();

    if (this.mode === 'pinch') {
      const left = this.pointers.length;
      if (left >= 2) {
        this.rebasePinch();
        return;
      }
      if (
        !cancelled &&
        this.pinchTapEligible &&
        isTwoFingerTap(now - this.pinchStartT, this.pinchMaxCount, this.pinchTravel, this.pinchMinRatio, this.pinchMaxRatio)
      ) {
        this.animateZoom(1 / DOUBLE_TAP_ZOOM, this.pinchStartCx, this.pinchStartCy, false);
      }
      this.pinchTapEligible = false;
      if (left === 1) {
        // Hand over to the remaining finger as a plain pan — from where it is now.
        const rest = this.pointers[0];
        this.primary = rest;
        this.mode = 'pan';
        this.moved = true;
        this.lastX = rest.x;
        this.lastY = rest.y;
        return;
      }
      if (!cancelled) this.startFling(now);
      this.endSession(ptr);
      return;
    }

    if (this.pointers.length > 0) {
      // Not the last pointer (only possible in 'void'): wait for the rest.
      if (ptr === this.primary) this.primary = this.pointers[0];
      return;
    }

    const isTap = !this.moved && now - ptr.downT <= (ptr.kind === 'mouse' ? CLICK_MAX_MS : TAP_MAX_MS);
    switch (this.mode) {
      case 'pan':
        if (cancelled) break;
        if (this.mapSession) {
          if (this.tapAllowed && isTap) {
            mapBus.hooks?.tap(ptr.x, ptr.y);
            this.lastTapT = now;
            this.lastTapX = ptr.x;
            this.lastTapY = ptr.y;
          } else this.startFling(now);
        } else if (this.pinSlot >= 0 && isTap) mapBus.hooks?.open(this.pinSlot);
        else if (this.tapAllowed && isTap && this.game.tool === 'inspect') this.handleTap(ptr.x, ptr.y, now);
        else this.startFling(now);
        break;
      case 'build':
        if (this.holdPending) {
          // A tap (no drag) over a waiting plan: drop it and plan here instead.
          if (cancelled) break;
          this.releasePending();
        }
        if (cancelled) this.game.setPreview(null);
        else this.commitBuild();
        break;
      case 'tapzoom':
        if (!cancelled && isTap) {
          const cam = this.camera;
          if (this.mapSession) {
            // The 5×5 City map (§7.2): a double-tap toggles 1× ↔ 2× around the finger.
            const fit = cam.mapZoom;
            this.animateZoom(cam.zoom < fit * 1.4 ? (fit * cam.mapHeadroom) / cam.zoom : fit / cam.zoom, ptr.downX, ptr.downY, false);
            break;
          }
          // At max zoom a double-tap backs out instead of doing nothing.
          const atMax = cam.zoom >= cam.maxZoom * 0.98;
          this.animateZoom(atMax ? 1 / DOUBLE_TAP_ZOOM : DOUBLE_TAP_ZOOM, ptr.downX, ptr.downY, false);
        }
        break;
      default:
        break;
    }
    this.endSession(ptr);
  }

  private endSession(last: TrackedPointer): void {
    this.mode = 'idle';
    this.holdPending = false;
    pointerActivity.building = false;
    this.session = null;
    this.primary = null;
    this.moved = false;
    this.edgeTime = 0;
    if (last.kind === 'mouse') {
      // Resume the hover preview where the cursor is, if it was released over the canvas
      // (pointerleave clears it if a UI panel is on top there).
      const inside = last.x >= 0 && last.y >= 0 && last.x < this.rect.width && last.y < this.rect.height;
      this.hoverPos.x = last.x;
      this.hoverPos.y = last.y;
      this.hoverActive = inside;
      if (inside) this.updateHover(true);
      else this.clearHover();
    }
    this.updateCursor();
  }

  /** Drop all pointer state without applying anything. */
  private resetSession(): void {
    if (this.mode === 'build' && !this.holdPending) this.game.setPreview(null);
    this.pointers.length = 0;
    this.holdPending = false;
    pointerActivity.building = false;
    this.mode = 'idle';
    this.session = null;
    this.primary = null;
    this.moved = false;
  }

  /**
   * Abort the in-progress gesture (Esc, tool change, world swap, blur).
   * With `release` the pointers are forgotten too; otherwise the session
   * idles in 'void' until the fingers lift.
   */
  private cancelGesture(release = false): void {
    if (this.mode === 'build' && !this.holdPending) this.game.setPreview(null);
    this.holdPending = false;
    pointerActivity.building = false;
    if (release) {
      this.resetSession();
      this.hoverActive = false;
      this.clearHover();
    } else if (this.mode !== 'idle') {
      this.mode = 'void';
    }
    this.updateCursor();
  }

  // ── Pan / fling / zoom ────────────────────────────────────────────────────

  private panGesture(dx: number, dy: number, now: number): void {
    if (dx === 0 && dy === 0) return;
    this.camera.panBy(dx, dy);
    this.panAccX += dx;
    this.panAccY += dy;
    this.tracker.add(now, this.panAccX, this.panAccY);
  }

  private startFling(now: number): void {
    const v = this.tracker.velocity(now, this.tmpV);
    const speed = capSpeed(v, FLING_MAX_SPEED);
    if (speed < FLING_MIN_SPEED) return;
    this.flingVx = v.x;
    this.flingVy = v.y;
  }

  private stopFling(): void {
    this.flingVx = 0;
    this.flingVy = 0;
  }

  /**
   * Ease the zoom by `factor` around screen (ax, ay). With `accumulate`,
   * repeated calls stack onto the pending target (key repeat).
   */
  private animateZoom(factor: number, ax: number, ay: number, accumulate: boolean): void {
    const cam = this.camera;
    const base = accumulate && this.zoomTarget > 0 ? this.zoomTarget : cam.zoom;
    const z = zoomRange(cam);
    this.zoomTarget = clamp(base * factor, z.lo, z.hi);
    this.zoomAx = ax;
    this.zoomAy = ay;
  }

  // ── Inspect ───────────────────────────────────────────────────────────────

  private handleTap(sx: number, sy: number, now: number): void {
    const t = this.pickAt(sx, sy, this.tmpHit, true);
    const sel = this.game.selected;
    const sky = !!t.sky;
    if (sel && sel.x === t.x && sel.y === t.y && !!sel.sky === sky) {
      // Tapping the selected tile (or deck) again dismisses the info card.
      this.game.select(null);
      this.game.events.emit('sfx', 'click');
    } else if (sky) {
      // The visible skyway deck: its own sheet (EXPANSION §3.7, §7.4).
      this.game.select({ x: t.x, y: t.y, sky: true });
      this.game.events.emit('sfx', 'click');
    } else {
      this.game.apply({ x: t.x, y: t.y }, { x: t.x, y: t.y });
    }
    this.lastTapT = now;
    this.lastTapX = sx;
    this.lastTapY = sy;
  }

  /** Height-aware tile pick: what the player sees under the point, towers (and, with `sky`, skyway decks) included. */
  private pickAt(sx: number, sy: number, out: PickHit, sky = false): PickHit {
    const f = screenToTileF(this.camera, sx, sy, this.tmpF);
    return pickTile(f.x, f.y, this.lookupFootprint, out, undefined, sky);
  }

  private readonly lookupFootprint = (tx: number, ty: number, out: PickFootprint, layer: 0 | 1): boolean => {
    const world = this.game.world;
    const t = world.tileAt(tx, ty);
    if (!t) return false;
    if (layer === 1) {
      // The skyway slab over this tile (deck at SKYWAY.z; a ramp slopes lower).
      const bits = world.sky[world.idx(tx, ty)];
      if (!bits) return false;
      out.x = tx;
      out.y = ty;
      out.size = 1;
      out.base = bits & SKY_RAMP ? SKY_PICK_RAMP_BASE : SKY_PICK_BASE;
      out.height = SKY_PICK_TOP;
      return true;
    }
    if (t.buildingId >= 0) {
      const b = world.buildings.get(t.buildingId);
      if (!b) return false;
      out.x = b.x;
      out.y = b.y;
      out.size = b.size;
      out.height = serviceBuildingHeight(b.type, b);
      return true;
    }
    if (t.zone !== ZoneType.None && t.level > 0) {
      out.x = tx;
      out.y = ty;
      out.size = 1;
      out.height = zoneBuildingHeight(t);
      return true;
    }
    return false;
  };

  private enterScrub(ptr: TrackedPointer): void {
    // A long-press peek over a plan waiting for ✓ drops that plan (nothing is built).
    if (this.holdPending) {
      this.holdPending = false;
      this.game.cancelPending();
    }
    this.game.setPreview(null);
    this.mode = 'scrub';
    this.scrubTile.x = this.scrubTile.y = NO_TILE;
    this.updateScrub(ptr.x, ptr.y);
    haptic(HAPTIC_CONFIRM_MS);
  }

  private updateScrub(sx: number, sy: number): void {
    const t = this.pickAt(sx, sy, this.tmpHit, true);
    const key = t.sky ? -t.x - 1 : t.x;
    if (key === this.scrubTile.x && t.y === this.scrubTile.y) return;
    this.scrubTile.x = key;
    this.scrubTile.y = t.y;
    if (!this.game.world.inBounds(t.x, t.y)) return;
    this.game.select(t.sky ? { x: t.x, y: t.y, sky: true } : { x: t.x, y: t.y });
    this.peekSelection = true;
    haptic(HAPTIC_TICK_MS, HAPTIC_TICK_GAP_MS);
  }

  // ── Build tools ───────────────────────────────────────────────────────────

  /** Keep the finger tile on the map (and building footprints fully on it); the Seaport snaps to a shore site. */
  private clampTile(t: Vec): Vec {
    const tool = this.game.tool;
    clampToolTile(t, this.game.world.N, isBuildingTool(tool) ? BUILDINGS[tool].size : 1);
    if (tool === 'seaport') {
      // EXPANSION §5.1: slide toward a highlighted shore instead of hunting for it (snapRadius tiles).
      const s = snapSeaport(t, this.shores(), this.game.world.N);
      t.x = s.x;
      t.y = s.y;
    }
    return t;
  }

  /** Valid Seaport top-lefts, recounted when the tool is picked and after tile edits (< 1 ms). */
  private shores(): Uint8Array {
    const w = this.game.world;
    if (!this.shoreMarks || this.shoreMarks.length !== w.area) {
      this.shoreMarks = new Uint8Array(w.area);
      this.shoreDirty = true;
    }
    if (this.shoreDirty) {
      shoreSites(w, this.shoreMarks);
      this.shoreDirty = false;
    }
    return this.shoreMarks;
  }

  /**
   * Port tools zoom out (animated, around the screen centre, clamped to the camera's minimum)
   * until footprint + noise ring fits the screen; leaving them zooms back to where the player was,
   * unless they zoomed by hand meanwhile (EXPANSION §5.4).
   */
  private fitTool(tool: ToolId): void {
    const cam = this.camera;
    const cx = cam.width / 2;
    const cy = cam.height / 2;
    if (FIT_TOOLS.has(tool) && isBuildingTool(tool)) {
      const def = BUILDINGS[tool];
      const span = def.size + 2 * (def.noise?.r ?? 0);
      const want = clamp(Math.min(cam.width / (span * TILE_W), cam.height / (span * TILE_H)) * FIT_MARGIN, cam.minZoom, cam.maxZoom);
      const now = this.zoomTarget > 0 ? this.zoomTarget : cam.zoom;
      const prev = this.fit ? this.fit.prev : now;
      if (want < now - 1e-3) {
        this.animateZoom(want / cam.zoom, cx, cy, false);
        this.fit = { prev, set: want };
      } else if (this.fit) this.fit = { prev, set: now };
      return;
    }
    const fit = this.fit;
    this.fit = null;
    if (!fit) return;
    const now = this.zoomTarget > 0 ? this.zoomTarget : cam.zoom;
    // Zoomed by hand since the fit: leave the view alone.
    if (Math.abs(now - fit.set) > fit.set * 0.03) return;
    this.animateZoom(fit.prev / cam.zoom, cx, cy, false);
  }

  private updateBuildAt(sx: number, sy: number, tick: boolean): void {
    const t = this.clampTile(screenToTileInto(this.camera, sx, sy, this.tmpTile));
    if (t.x === this.buildCur.x && t.y === this.buildCur.y) return;
    this.buildCur.x = t.x;
    this.buildCur.y = t.y;
    this.refreshBuildPreview();
    if (tick && this.primary && this.primary.kind !== 'mouse') haptic(HAPTIC_TICK_MS, HAPTIC_TICK_GAP_MS);
  }

  private refreshBuildPreview(): void {
    const tool = this.game.tool;
    if (tool === 'inspect') {
      this.game.setPreview(null);
      return;
    }
    if (this.holdPending) return; // the waiting plan keeps its ghost
    // planAction copies what it needs, so passing our scratch points is safe.
    const from = isBuildingTool(tool) ? this.buildCur : this.buildStart;
    this.game.setPreview(this.game.plan(from, this.buildCur));
  }

  /**
   * Lift: build, unless the plan needs ✓ (a costly building or a highway that strands lots,
   * EXPANSION §7.7). Then game.commit keeps it as pendingConfirm and the ghost stays.
   */
  private commitBuild(): void {
    const tool = this.game.tool;
    const to = { x: this.buildCur.x, y: this.buildCur.y };
    const from = isBuildingTool(tool) ? to : { x: this.buildStart.x, y: this.buildStart.y };
    const plan = this.game.commit(from, to);
    if (this.game.pendingConfirm) haptic(HAPTIC_TICK_MS);
    else if (plan.valid) haptic(HAPTIC_CONFIRM_MS);
  }

  // ── Mouse hover preview ───────────────────────────────────────────────────

  private updateHover(force: boolean): void {
    if (!this.hoverActive || this.session) return;
    // The ghost of a plan waiting for ✓ stays put under a moving cursor.
    if (this.game.pendingConfirm) return;
    const tool = this.game.tool;
    if (tool === 'inspect' || this.camera.mapView) {
      this.clearHover();
      return;
    }
    const t = screenToTileInto(this.camera, this.hoverPos.x, this.hoverPos.y, this.tmpTile);
    if (!this.game.world.inBounds(t.x, t.y)) {
      this.clearHover();
      return;
    }
    this.clampTile(t);
    if (!force && this.hoverShown && t.x === this.hoverTile.x && t.y === this.hoverTile.y) return;
    this.hoverTile.x = t.x;
    this.hoverTile.y = t.y;
    this.game.setPreview(this.game.plan(t, t));
    this.hoverShown = true;
  }

  private clearHover(): void {
    if (this.hoverShown && !this.game.pendingConfirm) this.game.setPreview(null);
    this.hoverShown = false;
    this.hoverTile.x = this.hoverTile.y = NO_TILE;
  }

  // ── Misc ──────────────────────────────────────────────────────────────────

  private updateCursor(): void {
    let c: string;
    if (this.session === 'mouse' && (this.mode === 'pan' || this.mode === 'tapzoom') && (this.moved || this.primary?.button !== 0)) c = 'grabbing';
    else if (this.game.tool !== 'inspect') c = 'crosshair';
    else c = 'default';
    if (c !== this.cursor) {
      this.cursor = c;
      this.canvas.style.cursor = c;
    }
  }

  private find(id: number): TrackedPointer | undefined {
    for (let i = 0; i < this.pointers.length; i++) if (this.pointers[i].id === id) return this.pointers[i];
    return undefined;
  }

  private listen(target: EventTarget, type: string, fn: EventListener, opts?: AddEventListenerOptions): void {
    target.addEventListener(type, fn, opts);
    this.offs.push(() => target.removeEventListener(type, fn, opts));
  }
}

/** The zoom range input may ease to: the City map's [fit, fit × headroom] while it is open, else [minZoom, maxZoom]. */
export function zoomRange(cam: Pick<Camera, 'mapView' | 'mapZoom' | 'mapHeadroom' | 'minZoom' | 'maxZoom'>): { lo: number; hi: number } {
  return cam.mapView ? { lo: cam.mapZoom, hi: cam.mapZoom * cam.mapHeadroom } : { lo: cam.minZoom, hi: cam.maxZoom };
}

function preventDefault(e: Event): void {
  if (e.cancelable) e.preventDefault();
}

/** Tapping the map should dismiss an on-screen keyboard (we never preventDefault the press itself). */
function blurTextFocus(): void {
  const el = document.activeElement as HTMLElement | null;
  if (el && isTypingTarget(el) && typeof el.blur === 'function') el.blur();
}
