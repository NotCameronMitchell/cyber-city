// District ambience (docs/MEGACITY.md §10, optional; WP-5): one recipe per district kind, the view rule (a district is
// heard while it fills the view: six of nine screen samples), the bus between the UI tick and the AudioEngine, and the
// player's look-ahead scheduling on a fake AudioContext (the suite runs under node; levels were measured in Chromium
// with an OfflineAudioContext, see AMB_GAIN in audio.ts).

import { afterEach, describe, expect, it } from 'vitest';
import {
  AMB_FILL,
  AMBIENCE,
  ambienceAt,
  ambienceTarget,
  DistrictAmbience,
  NO_AMBIENCE,
  onAmbience,
  setAmbience,
  type AmbienceTarget,
} from '../src/audio/ambience';
import { DISTRICT_KINDS, type DistrictKind } from '../src/game/types';

// ── A fake AudioContext: enough of the graph to count what the player starts ──

class FakeParam {
  value = 0;
  events: string[] = [];
  setValueAtTime(v: number) {
    this.value = v;
    this.events.push('set');
    return this;
  }
  linearRampToValueAtTime(v: number) {
    this.value = v;
    this.events.push('lin');
    return this;
  }
  exponentialRampToValueAtTime(v: number) {
    this.value = v;
    this.events.push('exp');
    return this;
  }
  cancelScheduledValues() {
    return this;
  }
}

class FakeNode {
  gain = new FakeParam();
  frequency = new FakeParam();
  detune = new FakeParam();
  Q = new FakeParam();
  pan = new FakeParam();
  delayTime = new FakeParam();
  type = '';
  loop = false;
  buffer: unknown = null;
  onended: (() => void) | null = null;
  started: number[] = [];
  stoppedAt = Infinity;
  constructor(readonly ctx: FakeCtx, readonly kind: string) {
    ctx.made.push(this);
  }
  connect<T>(n: T): T {
    return n;
  }
  disconnect() {}
  start(t = 0) {
    this.started.push(t);
    this.ctx.starts.push({ kind: this.kind, t });
  }
  stop(t = 0) {
    this.stoppedAt = Math.min(this.stoppedAt, t);
  }
}

class FakeCtx {
  currentTime = 0;
  sampleRate = 8000;
  made: FakeNode[] = [];
  starts: { kind: string; t: number }[] = [];
  createGain() {
    return new FakeNode(this, 'gain');
  }
  createBiquadFilter() {
    return new FakeNode(this, 'filter');
  }
  createOscillator() {
    return new FakeNode(this, 'osc');
  }
  createBufferSource() {
    return new FakeNode(this, 'src');
  }
  createDelay() {
    return new FakeNode(this, 'delay');
  }
  createStereoPanner() {
    return new FakeNode(this, 'pan');
  }
  createBuffer(_c: number, len: number) {
    const d = new Float32Array(len);
    return { getChannelData: () => d, length: len };
  }
}

const ctxOf = () => new FakeCtx() as unknown as BaseAudioContext & FakeCtx;
const noiseOf = (ctx: FakeCtx) => ctx.createBuffer(1, 100) as unknown as AudioBuffer;

// ── A 3×3 world and a camera whose screen maps straight onto tiles ──

function world3(owned: number[]) {
  const R = 3;
  const kinds: DistrictKind[] = ['shoals', 'sunk', 'flats', 'terraces', 'shore', 'reedmere', 'skeleton', 'tarmac', 'bazaar'];
  const slotOwned = new Uint8Array(R * R);
  for (const s of owned) slotOwned[s] = 1;
  return {
    N: 64 * R,
    slotAt: (x: number, y: number) => Math.floor(y / 64) * R + Math.floor(x / 64),
    slotOwned,
    districts: { kinds },
  };
}

/** A camera showing tiles [x0, x0 + w) × [y0, y0 + h) on a 300 × 300 screen. */
function cam(x0: number, y0: number, w: number, h: number, mapView = false) {
  return { width: 300, height: 300, mapView, screenToTile: (sx: number, sy: number) => ({ x: x0 + (sx / 300) * w, y: y0 + (sy / 300) * h }) };
}

afterEach(() => {
  onAmbience(null);
  setAmbience(NO_AMBIENCE);
});

describe('district ambience recipes (§10)', () => {
  it('every district kind has a loop: a label, a trim, a bed or a hum, sparse events with sane gaps and gains', () => {
    for (const k of DISTRICT_KINDS) {
      const r = AMBIENCE[k];
      expect(r, k).toBeTruthy();
      expect(r.label.length).toBeGreaterThan(8);
      expect(r.trim).toBeGreaterThan(0);
      expect(r.trim).toBeLessThanOrEqual(2);
      expect(r.beds.length + r.hums.length).toBeGreaterThan(0);
      expect(r.events.length).toBeGreaterThan(0);
      for (const b of r.beds) {
        expect(b.gain).toBeGreaterThan(0);
        expect(b.gain).toBeLessThanOrEqual(1);
        expect(b.depth).toBeGreaterThanOrEqual(0);
        expect(b.depth).toBeLessThanOrEqual(1);
      }
      for (const e of r.events) {
        expect(e.every[0]).toBeGreaterThan(0.2);
        expect(e.every[1]).toBeGreaterThan(e.every[0]);
        expect(e.gain).toBeGreaterThan(0);
        expect(e.gain).toBeLessThanOrEqual(1);
      }
    }
    // The three the spec names: gulls, machinery, market voices.
    expect(AMBIENCE.shoals.events.some((e) => e.kind === 'gull')).toBe(true);
    expect(AMBIENCE.flats.events.some((e) => e.kind === 'clank') && AMBIENCE.flats.hums.length > 0).toBe(true);
    expect(AMBIENCE.bazaar.events.some((e) => e.kind === 'babble')).toBe(true);
  });
});

describe('when a district fills the view (§10)', () => {
  it('heard at street zoom inside an owned district, at full level', () => {
    const t = ambienceAt(world3([4]), cam(70, 70, 40, 40));
    expect(t).toEqual({ kind: 'shore', slot: 4, level: 1 });
  });

  it('a view across two owned districts plays the one under six of nine samples, at its share; a 50/50 view plays none', () => {
    const w = world3([4, 5]);
    // x 110..170: samples at 120, 140, 160 → slot 4, 5, 5 (two of three columns in slot 5).
    const t = ambienceAt(w, cam(110, 70, 60, 40));
    expect(t.kind).toBe('reedmere');
    expect(t.level).toBeCloseTo(6 / 9, 5);
    expect(t.level).toBeGreaterThanOrEqual(AMB_FILL - 1e-9);
    // A view centred where four owned districts meet: samples split 4 / 2 / 2 / 1, none holds six.
    expect(ambienceAt(world3([0, 1, 3, 4]), cam(4, 4, 120, 120)).kind).toBeNull();
  });

  it('none over locked land, off the map, zoomed out across the region, or on the City map', () => {
    expect(ambienceAt(world3([4]), cam(140, 70, 40, 40)).kind).toBeNull(); // slot 5 is locked
    expect(ambienceAt(world3([4]), cam(-200, -200, 40, 40)).kind).toBeNull();
    expect(ambienceAt(world3([0, 1, 2, 3, 4, 5, 6, 7, 8]), cam(0, 0, 192, 192)).kind).toBeNull();
    expect(ambienceAt(world3([4]), cam(70, 70, 40, 40, true))).toEqual(NO_AMBIENCE);
  });
});

describe('the ambience bus', () => {
  it('tells the engine only about a change (another district, or the level by 5 % or more)', () => {
    const seen: AmbienceTarget[] = [];
    onAmbience((t) => seen.push(t));
    setAmbience({ kind: 'flats', slot: 2, level: 1 });
    setAmbience({ kind: 'flats', slot: 2, level: 0.98 });
    setAmbience({ kind: 'flats', slot: 2, level: 0.8 });
    setAmbience({ kind: 'flats', slot: 7, level: 0.8 });
    setAmbience(NO_AMBIENCE);
    expect(seen.map((t) => `${t.kind}:${t.slot}:${t.level}`)).toEqual(['flats:2:1', 'flats:2:0.8', 'flats:7:0.8', 'null:-1:0']);
    expect(ambienceTarget()).toEqual(NO_AMBIENCE);
  });
});

describe('the player (fake AudioContext)', () => {
  it('starts its beds and hums at once, schedules events only up to the horizon, and spaces them by the recipe', () => {
    const ctx = ctxOf();
    const r = AMBIENCE.bazaar;
    const amb = new DistrictAmbience(ctx, ctx.createGain() as unknown as AudioNode, noiseOf(ctx), r, 0);
    const beds = ctx.starts.length;
    // Each bed starts a noise source and its LFO (and a sweep LFO when it has one).
    expect(beds).toBe(r.beds.reduce((n, b) => n + 2 + (b.sweep ? 1 : 0), 0) + r.hums.length);
    amb.scheduleUntil(60);
    const events = ctx.starts.slice(beds);
    expect(events.length).toBeGreaterThan(0);
    expect(Math.max(...events.map((e) => e.t))).toBeLessThan(61);
    // Babble every 0.35–0.9 s: about 60 / 0.6 bursts, each 3–6 syllables.
    const syllables = events.filter((e) => e.kind === 'src').length;
    expect(syllables).toBeGreaterThan((60 / 0.9) * 3 * 0.8);
    expect(syllables).toBeLessThan((60 / 0.35) * 6 * 1.1);
    // Nothing more until the horizon moves.
    const n = ctx.starts.length;
    amb.scheduleUntil(60);
    expect(ctx.starts.length).toBe(n);
  });

  it('never plays a backlog after the context was suspended for a long time', () => {
    const ctx = ctxOf();
    const amb = new DistrictAmbience(ctx, ctx.createGain() as unknown as AudioNode, noiseOf(ctx), AMBIENCE.sunk, 0);
    const beds = ctx.starts.length;
    ctx.currentTime = 600; // ten minutes in the background
    amb.scheduleUntil(601.2);
    const drips = ctx.starts.slice(beds);
    // Drips every 1.2–4 s: at most a couple in the 1.2 s window, none in the past.
    expect(drips.length).toBeLessThanOrEqual(3);
    for (const d of drips) expect(d.t).toBeGreaterThanOrEqual(600);
  });

  it('fades to a level, and stop() fades out and stops every source it started', () => {
    const ctx = ctxOf();
    const amb = new DistrictAmbience(ctx, ctx.createGain() as unknown as AudioNode, noiseOf(ctx), AMBIENCE.flats, 0);
    amb.fadeTo(0.8, 2.5);
    expect((amb.out.gain as unknown as FakeParam).value).toBeCloseTo(0.8, 5);
    amb.scheduleUntil(5);
    amb.stop(1.5);
    expect((amb.out.gain as unknown as FakeParam).value).toBe(0);
    for (const nd of ctx.made) if (nd.started.length) expect(nd.stoppedAt, nd.kind).toBeLessThanOrEqual(1.56);
    // A stopped loop schedules nothing more.
    const n = ctx.starts.length;
    amb.scheduleUntil(100);
    expect(ctx.starts.length).toBe(n);
  });
});
