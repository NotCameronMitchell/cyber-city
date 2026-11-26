// ─────────────────────────────────────────────────────────────────────────────
// District ambience (docs/MEGACITY.md §10, optional): a quiet loop per district
// style under the music while that district fills the view, muted with sound
// off. Everything is synthesized (no audio files), like the rest of audio.ts.
//
//   shore     harbour surf, a far foghorn, now and then a gull
//   shoals    surf and lapping water, gulls
//   sunk      a low drone in flooded halls, drips with an echo
//   flats     machine hum and rumble, clanks, steam
//   terraces  hill breeze, wind chimes
//   reedmere  wind in the reeds, frogs, crickets
//   skeleton  wind whistling through bare frames, steel creaks
//   tarmac    open wind, a jet passing far off
//   bazaar    market voices, stall bells
//
// The pure parts (the recipe table, the view rule) are exported for tests; the
// player schedules its sparse events ahead on the AudioContext clock
// (`scheduleUntil`), so an OfflineAudioContext can render it for a level check.
// ─────────────────────────────────────────────────────────────────────────────

import type { DistrictKind, SlotId } from '../game/types';

/** A continuous bed: looped noise through one filter, its level breathing on a slow LFO. */
export interface AmbBed {
  filter: BiquadFilterType;
  /** Filter frequency (Hz) and Q. */
  f: number;
  q: number;
  gain: number;
  /** Breathing: the LFO rate (Hz) and how much of the gain it swings (0..1). */
  lfo: number;
  depth: number;
  /** Optional slow sweep of the filter frequency (± Hz), for wind. */
  sweep?: number;
}

/** A steady machine tone (oscillator through a low-pass). */
export interface AmbHum {
  type: OscillatorType;
  f: number;
  lp: number;
  gain: number;
}

export type AmbEventKind = 'gull' | 'drip' | 'clank' | 'steam' | 'chime' | 'croak' | 'cricket' | 'creak' | 'jet' | 'babble' | 'bell' | 'horn';

/** A sparse sound repeated at random gaps (seconds) inside `every`. */
export interface AmbEvent {
  kind: AmbEventKind;
  every: [number, number];
  gain: number;
}

export interface AmbienceRecipe {
  /** What the player hears, for the comment above and the tests. */
  label: string;
  beds: AmbBed[];
  hums: AmbHum[];
  events: AmbEvent[];
  /** A short echo on the events (the Sunk's flooded halls). */
  echo?: { sec: number; feedback: number; wet: number };
  /** Loudness trim, so every district sits at about the same level under the music (measured offline, see tests). */
  trim: number;
}

/** One recipe per district kind (variants share their kind's sound). */
export const AMBIENCE: Record<DistrictKind, AmbienceRecipe> = {
  shore: {
    label: 'harbour surf, a far foghorn, a gull now and then',
    trim: 0.65,
    beds: [
      { filter: 'lowpass', f: 700, q: 0.7, gain: 0.5, lfo: 0.11, depth: 0.7 },
      { filter: 'highpass', f: 2600, q: 0.5, gain: 0.05, lfo: 0.05, depth: 0.5 },
    ],
    hums: [],
    events: [
      { kind: 'gull', every: [10, 22], gain: 0.4 },
      { kind: 'horn', every: [50, 95], gain: 0.3 },
    ],
  },
  shoals: {
    label: 'surf and lapping water, gulls',
    trim: 0.62,
    beds: [
      { filter: 'lowpass', f: 650, q: 0.7, gain: 0.55, lfo: 0.09, depth: 0.8 },
      { filter: 'bandpass', f: 950, q: 1.1, gain: 0.16, lfo: 0.42, depth: 0.6 },
    ],
    hums: [],
    events: [{ kind: 'gull', every: [4, 10], gain: 0.5 }],
  },
  sunk: {
    label: 'a low drone in flooded halls, drips with an echo',
    trim: 2,
    beds: [
      { filter: 'bandpass', f: 140, q: 4, gain: 0.55, lfo: 0.03, depth: 0.3 },
      { filter: 'lowpass', f: 380, q: 0.7, gain: 0.2, lfo: 0.07, depth: 0.5 },
    ],
    hums: [],
    events: [{ kind: 'drip', every: [1.2, 4], gain: 0.45 }],
    echo: { sec: 0.23, feedback: 0.35, wet: 0.5 },
  },
  flats: {
    label: 'machine hum and rumble, clanks, steam',
    trim: 1,
    beds: [
      { filter: 'lowpass', f: 300, q: 0.8, gain: 0.45, lfo: 0.2, depth: 0.25 },
      // A far machine whine, so a phone speaker (no bass) still hears the yards.
      { filter: 'bandpass', f: 1150, q: 6, gain: 0.12, lfo: 0.3, depth: 0.5 },
    ],
    hums: [
      { type: 'sawtooth', f: 55, lp: 210, gain: 0.05 },
      { type: 'sawtooth', f: 82.6, lp: 240, gain: 0.022 },
    ],
    events: [
      { kind: 'clank', every: [1.4, 3.4], gain: 0.4 },
      { kind: 'steam', every: [9, 19], gain: 0.25 },
    ],
  },
  terraces: {
    label: 'hill breeze, wind chimes',
    trim: 0.72,
    beds: [{ filter: 'bandpass', f: 720, q: 0.8, gain: 0.4, lfo: 0.07, depth: 0.7, sweep: 300 }],
    hums: [],
    events: [{ kind: 'chime', every: [3, 9], gain: 0.4 }],
  },
  reedmere: {
    label: 'wind in the reeds, frogs, crickets',
    trim: 0.65,
    beds: [
      { filter: 'highpass', f: 2800, q: 0.6, gain: 0.16, lfo: 0.12, depth: 0.8 },
      { filter: 'lowpass', f: 300, q: 0.7, gain: 0.14, lfo: 0.05, depth: 0.4 },
    ],
    hums: [],
    events: [
      { kind: 'croak', every: [2, 6], gain: 0.45 },
      { kind: 'cricket', every: [3, 8], gain: 0.25 },
    ],
  },
  skeleton: {
    label: 'wind whistling through bare frames, steel creaks',
    trim: 1.5,
    beds: [
      { filter: 'bandpass', f: 900, q: 6, gain: 0.32, lfo: 0.05, depth: 0.8, sweep: 260 },
      { filter: 'lowpass', f: 300, q: 0.7, gain: 0.3, lfo: 0.08, depth: 0.5 },
    ],
    hums: [],
    events: [
      { kind: 'creak', every: [5, 12], gain: 0.35 },
      { kind: 'clank', every: [9, 20], gain: 0.16 },
    ],
  },
  tarmac: {
    label: 'open wind, a jet passing far off',
    trim: 0.9,
    beds: [{ filter: 'lowpass', f: 600, q: 0.7, gain: 0.42, lfo: 0.06, depth: 0.6 }],
    hums: [],
    events: [{ kind: 'jet', every: [24, 44], gain: 0.5 }],
  },
  bazaar: {
    label: 'market voices, stall bells',
    trim: 1.15,
    beds: [{ filter: 'bandpass', f: 620, q: 0.7, gain: 0.22, lfo: 0.5, depth: 0.3 }],
    hums: [],
    events: [
      { kind: 'babble', every: [0.35, 0.9], gain: 0.4 },
      { kind: 'bell', every: [7, 16], gain: 0.25 },
    ],
  },
};

// ── When a district fills the view ───────────────────────────────────────────

/** The share of the 3 × 3 view samples one owned district must hold before its ambience plays. */
export const AMB_FILL = 6 / 9;

export interface AmbienceTarget {
  kind: DistrictKind | null;
  /** The slot heard (−1 for none) and its loudness 0..1 (its share of the view). */
  slot: SlotId;
  level: number;
}

export const NO_AMBIENCE: AmbienceTarget = { kind: null, slot: -1, level: 0 };

interface AmbWorld {
  N: number;
  slotAt(x: number, y: number): SlotId;
  slotOwned: ArrayLike<number>;
  districts: { kinds: readonly DistrictKind[] };
}

interface AmbCamera {
  width: number;
  height: number;
  mapView: boolean;
  screenToTile(sx: number, sy: number): { x: number; y: number };
}

/**
 * The district the view is in: nine points on a 3 × 3 grid over the screen; the owned district under at least six of
 * them is heard, at the share it holds. None on the City map, over locked land, or zoomed out across districts.
 */
export function ambienceAt(world: AmbWorld, cam: AmbCamera): AmbienceTarget {
  if (cam.mapView || cam.width <= 0 || cam.height <= 0) return NO_AMBIENCE;
  const count = new Map<SlotId, number>();
  for (let j = 0; j < 3; j++)
    for (let i = 0; i < 3; i++) {
      const t = cam.screenToTile((cam.width * (2 * i + 1)) / 6, (cam.height * (2 * j + 1)) / 6);
      const x = Math.floor(t.x);
      const y = Math.floor(t.y);
      if (x < 0 || y < 0 || x >= world.N || y >= world.N) continue;
      const s = world.slotAt(x, y);
      if (s < 0 || world.slotOwned[s] !== 1) continue;
      count.set(s, (count.get(s) ?? 0) + 1);
    }
  let best = -1;
  let n = 0;
  for (const [s, c] of count) if (c > n || (c === n && s < best)) [best, n] = [s, c];
  if (best < 0 || n / 9 < AMB_FILL - 1e-9) return NO_AMBIENCE;
  return { kind: world.districts.kinds[best] ?? 'shore', slot: best, level: n / 9 };
}

// ── The bus between the view (the UI's tick) and the AudioEngine ─────────────

let target: AmbienceTarget = NO_AMBIENCE;
let listener: ((t: AmbienceTarget) => void) | null = null;

/** The UI's 1 Hz tick says what the view shows; the AudioEngine follows. */
export function setAmbience(t: AmbienceTarget): void {
  if (t.kind === target.kind && t.slot === target.slot && Math.abs(t.level - target.level) < 0.05) return;
  target = t;
  listener?.(t);
}

export function ambienceTarget(): AmbienceTarget {
  return target;
}

/** The AudioEngine listens (one listener). */
export function onAmbience(fn: ((t: AmbienceTarget) => void) | null): void {
  listener = fn;
}

// ── The player ──────────────────────────────────────────────────────────────

/** Seconds of the shared noise loop the beds read (each bed starts at its own offset, so beds never correlate). */
const NOISE_SEC = 3.7;
/** Look-ahead for the sparse events (s). */
export const AMB_LOOKAHEAD = 1.2;

const rand = (a: number, b: number) => a + Math.random() * (b - a);

/** The ambience's noise loop (made once per context, on the first ambience). */
export function ambienceNoise(ctx: BaseAudioContext): AudioBuffer {
  const len = Math.round(ctx.sampleRate * NOISE_SEC);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  // A short crossfade at the seam, so the loop never clicks.
  const fade = Math.round(ctx.sampleRate * 0.05);
  for (let i = 0; i < fade; i++) {
    const a = i / fade;
    d[i] = d[i] * a + d[len - fade + i] * (1 - a);
  }
  return buf;
}

/**
 * One district's loop: the beds and hums run while it lives; the events are scheduled ahead by `scheduleUntil` (the
 * engine calls it on a timer with the context clock). `fadeTo` sets its level; `stop` fades out and frees the nodes.
 */
export class DistrictAmbience {
  readonly out: GainNode;
  private readonly trimNode: GainNode;
  private readonly fx: AudioNode;
  private readonly sources: AudioScheduledSourceNode[] = [];
  private readonly nodes: AudioNode[] = [];
  private readonly live = new Set<AudioScheduledSourceNode>();
  private readonly next: number[];
  private stopped = false;

  constructor(
    private readonly ctx: BaseAudioContext,
    dest: AudioNode,
    private readonly noise: AudioBuffer,
    readonly recipe: AmbienceRecipe,
    level = 0,
  ) {
    const t = ctx.currentTime;
    this.out = ctx.createGain();
    this.out.gain.value = level;
    this.trimNode = ctx.createGain();
    this.trimNode.gain.value = recipe.trim;
    this.out.connect(this.trimNode).connect(dest);
    this.nodes.push(this.out, this.trimNode);
    // Events go through an optional echo.
    if (recipe.echo) {
      const sum = ctx.createGain();
      const delay = ctx.createDelay(1);
      delay.delayTime.value = recipe.echo.sec;
      const fb = ctx.createGain();
      fb.gain.value = recipe.echo.feedback;
      const wet = ctx.createGain();
      wet.gain.value = recipe.echo.wet;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 1800;
      sum.connect(this.out);
      sum.connect(delay);
      delay.connect(lp).connect(fb).connect(delay);
      delay.connect(wet).connect(this.out);
      this.nodes.push(sum, delay, fb, wet, lp);
      this.fx = sum;
    } else this.fx = this.out;
    recipe.beds.forEach((b, i) => this.bed(b, t, i));
    for (const hm of recipe.hums) this.hum(hm, t);
    // The first of each event comes a little in, not all at once.
    this.next = recipe.events.map((e) => t + rand(0.4, Math.min(6, e.every[1])));
  }

  private bed(b: AmbBed, t: number, i: number): void {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = b.filter;
    f.frequency.value = b.f;
    f.Q.value = b.q;
    const g = ctx.createGain();
    g.gain.value = b.gain * (1 - b.depth / 2);
    // Breathing: an LFO swings the gain around its middle.
    const lfo = ctx.createOscillator();
    lfo.frequency.value = b.lfo * rand(0.85, 1.15);
    const lg = ctx.createGain();
    lg.gain.value = (b.gain * b.depth) / 2;
    lfo.connect(lg).connect(g.gain);
    src.connect(f).connect(g).connect(this.out);
    this.nodes.push(f, g, lg);
    this.sources.push(src, lfo);
    if (b.sweep) {
      const sw = ctx.createOscillator();
      sw.frequency.value = b.lfo * 0.61;
      const sg = ctx.createGain();
      sg.gain.value = b.sweep;
      sw.connect(sg).connect(f.frequency);
      this.nodes.push(sg);
      this.sources.push(sw);
      sw.start(t);
    }
    src.start(t, ((i * 1.37) % NOISE_SEC) + rand(0, 0.5));
    lfo.start(t);
  }

  private hum(hm: AmbHum, t: number): void {
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    osc.type = hm.type;
    osc.frequency.value = hm.f;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = hm.lp;
    const g = ctx.createGain();
    g.gain.value = hm.gain;
    osc.connect(lp).connect(g).connect(this.out);
    this.nodes.push(lp, g);
    this.sources.push(osc);
    osc.start(t);
  }

  /** Fade to `level` (0..1 of the ambience bus) over `sec`. */
  fadeTo(level: number, sec: number): void {
    if (this.stopped) return;
    const t = this.ctx.currentTime;
    const p = this.out.gain;
    p.cancelScheduledValues(t);
    p.setValueAtTime(p.value, t);
    p.linearRampToValueAtTime(Math.max(0, level), t + Math.max(0.01, sec));
  }

  /** Schedule every event due before `until` (context seconds). */
  scheduleUntil(until: number): void {
    if (this.stopped) return;
    const ev = this.recipe.events;
    for (let i = 0; i < ev.length; i++) {
      // A guard against a long-suspended context: never schedule a backlog.
      if (this.next[i] < this.ctx.currentTime - 1) this.next[i] = this.ctx.currentTime + rand(0, ev[i].every[0]);
      while (this.next[i] < until) {
        this.play(ev[i], Math.max(this.next[i], this.ctx.currentTime + 0.01));
        this.next[i] += rand(ev[i].every[0], ev[i].every[1]);
      }
    }
  }

  /** Fade out over `sec`, then stop and free everything. */
  stop(sec = 1.5): void {
    if (this.stopped) return;
    this.fadeTo(0, sec);
    this.stopped = true;
    const end = this.ctx.currentTime + sec + 0.05;
    for (const s of [...this.sources, ...this.live]) {
      try {
        s.stop(end);
      } catch {
        /* already stopped */
      }
    }
    const free = () => {
      for (const n of this.nodes)
        try {
          n.disconnect();
        } catch {
          /* gone */
        }
      for (const s of this.sources)
        try {
          s.disconnect();
        } catch {
          /* gone */
        }
    };
    if (typeof window !== 'undefined') window.setTimeout(free, (sec + 0.3) * 1000);
  }

  // ── Events ──────────────────────────────────────────────────────────────

  private play(e: AmbEvent, t: number): void {
    const dest = this.panner(t);
    const g = e.gain;
    switch (e.kind) {
      case 'gull': {
        const n = 1 + Math.floor(Math.random() * 3);
        const j = rand(0.9, 1.15);
        for (let k = 0; k < n; k++) {
          const at = t + k * rand(0.28, 0.4);
          this.glide('triangle', 1750 * j, 1150 * j, at, 0.16, 0.05 * g, dest);
          this.glide('triangle', 1500 * j, 900 * j, at + 0.17, 0.2, 0.04 * g, dest);
        }
        break;
      }
      case 'drip': {
        const f = rand(900, 1700);
        this.glide('sine', f, f * 1.6, t, 0.12, 0.09 * g, dest, 0.002);
        break;
      }
      case 'clank': {
        this.noiseBurst(t, 0.08, 0.5 * g, 'bandpass', rand(1800, 2600), 8, dest);
        const j = rand(0.85, 1.2);
        this.glide('sine', 420 * j, 418 * j, t, 0.45, 0.035 * g, dest, 0.002);
        this.glide('sine', 1130 * j, 1126 * j, t, 0.3, 0.02 * g, dest, 0.002);
        this.glide('sine', 72, 40, t, 0.22, 0.12 * g, dest, 0.004);
        break;
      }
      case 'steam':
        this.noiseBurst(t, 1.3, 0.22 * g, 'highpass', 3200, 0.7, dest, 0.25);
        break;
      case 'chime': {
        const scale = [84, 86, 88, 91, 93, 96];
        const n = 2 + Math.floor(Math.random() * 3);
        for (let k = 0; k < n; k++) {
          const f = 440 * Math.pow(2, (scale[Math.floor(Math.random() * scale.length)] - 69) / 12);
          const at = t + k * rand(0.15, 0.4);
          this.glide('sine', f, f, at, 2.2, 0.03 * g, dest, 0.003);
          this.glide('sine', f * 2.76, f * 2.76, at, 0.9, 0.008 * g, dest, 0.003);
        }
        break;
      }
      case 'croak': {
        const n = 1 + Math.floor(Math.random() * 3);
        const f = rand(150, 210);
        for (let k = 0; k < n; k++) this.croak(t + k * rand(0.3, 0.45), f, 0.06 * g, dest);
        break;
      }
      case 'cricket': {
        const n = 3 + Math.floor(Math.random() * 3);
        const f = rand(4100, 4600);
        for (let k = 0; k < n; k++) this.glide('sine', f, f, t + k * 0.045, 0.02, 0.012 * g, dest, 0.003);
        break;
      }
      case 'creak': {
        const f = rand(120, 160);
        this.filtered('sawtooth', f, f * 0.68, t, rand(0.7, 1.2), 0.04 * g, 'bandpass', 420, 5, dest, 0.2);
        break;
      }
      case 'jet':
        this.sweepNoise(t, 9, 0.5 * g, 180, 650, dest);
        break;
      case 'babble': {
        const n = 3 + Math.floor(Math.random() * 4);
        let at = t;
        const voice = rand(0.8, 1.3);
        for (let k = 0; k < n; k++) {
          const d = rand(0.07, 0.15);
          this.syllable(at, d, rand(0.6, 1) * 0.5 * g, rand(320, 760) * voice, rand(950, 2100) * voice, dest);
          at += d + rand(0.02, 0.08);
        }
        break;
      }
      case 'bell': {
        const f = rand(1250, 1450);
        this.glide('triangle', f, f, t, 0.8, 0.035 * g, dest, 0.002);
        this.glide('sine', f * 2, f * 2, t, 0.45, 0.012 * g, dest, 0.002);
        break;
      }
      case 'horn': {
        for (const f of [92, 92.7]) this.filtered('sawtooth', f, f, t, 2.8, 0.05 * g, 'lowpass', 380, 0.8, dest, 0.5);
        break;
      }
    }
  }

  /** A random-pan stereo panner on the event bus (where the context has one). */
  private panner(t: number): AudioNode {
    const ctx = this.ctx as BaseAudioContext & { createStereoPanner?: () => StereoPannerNode };
    if (typeof ctx.createStereoPanner !== 'function') return this.fx;
    const p = ctx.createStereoPanner();
    p.pan.value = rand(-0.65, 0.65);
    p.connect(this.fx);
    // Freed after the longest event (the jet, 9 s).
    const free = () => {
      try {
        p.disconnect();
      } catch {
        /* gone */
      }
    };
    if (typeof window !== 'undefined') window.setTimeout(free, Math.max(0, t - this.ctx.currentTime + 10.5) * 1000);
    return p;
  }

  private keep(src: AudioScheduledSourceNode, ...nodes: AudioNode[]): void {
    this.live.add(src);
    src.onended = () => {
      this.live.delete(src);
      for (const n of [src, ...nodes])
        try {
          n.disconnect();
        } catch {
          /* gone */
        }
    };
  }

  /** A tone gliding f0 → f1 with a quick attack and an exponential decay over `dur`. */
  private glide(type: OscillatorType, f0: number, f1: number, t: number, dur: number, peak: number, dest: AudioNode, attack = 0.02): void {
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) osc.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g).connect(dest);
    this.keep(osc, g);
    osc.start(t);
    osc.stop(t + dur + 0.05);
  }

  /** A tone through a filter with a slow attack (creaks, the foghorn). */
  private filtered(type: OscillatorType, f0: number, f1: number, t: number, dur: number, peak: number, ft: BiquadFilterType, ff: number, q: number, dest: AudioNode, attack: number): void {
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) osc.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const f = ctx.createBiquadFilter();
    f.type = ft;
    f.frequency.value = ff;
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + attack);
    g.gain.setValueAtTime(peak, t + Math.max(attack, dur * 0.6));
    g.gain.linearRampToValueAtTime(0, t + dur);
    osc.connect(f).connect(g).connect(dest);
    this.keep(osc, f, g);
    osc.start(t);
    osc.stop(t + dur + 0.05);
  }

  /** A burst of filtered noise (clanks, steam). */
  private noiseBurst(t: number, dur: number, peak: number, ft: BiquadFilterType, ff: number, q: number, dest: AudioNode, attack = 0.003): void {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = ft;
    f.frequency.value = ff;
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(dest);
    this.keep(src, f, g);
    src.start(t, rand(0, NOISE_SEC - dur - 0.1));
    src.stop(t + dur + 0.05);
  }

  /** A far jet: low-passed noise whose cutoff and level rise and fall over `dur`. */
  private sweepNoise(t: number, dur: number, peak: number, lo: number, hi: number, dest: AudioNode): void {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.Q.value = 0.9;
    f.frequency.setValueAtTime(lo, t);
    f.frequency.linearRampToValueAtTime(hi, t + dur * 0.45);
    f.frequency.linearRampToValueAtTime(lo, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + dur * 0.45);
    g.gain.linearRampToValueAtTime(0, t + dur);
    src.connect(f).connect(g).connect(dest);
    this.keep(src, f, g);
    src.start(t, rand(0, 1));
    src.stop(t + dur + 0.05);
  }

  /** A frog: a square tone throbbing at ~28 Hz through a low-pass. */
  private croak(t: number, f: number, peak: number, dest: AudioNode): void {
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    osc.type = 'square';
    osc.frequency.setValueAtTime(f, t);
    osc.frequency.linearRampToValueAtTime(f * 0.86, t + 0.24);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 620;
    const am = ctx.createGain();
    am.gain.value = 0.5;
    const trem = ctx.createOscillator();
    trem.frequency.value = 28;
    const tg = ctx.createGain();
    tg.gain.value = 0.5;
    trem.connect(tg).connect(am.gain);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + 0.03);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.26);
    osc.connect(lp).connect(am).connect(g).connect(dest);
    this.keep(osc, lp, am, g);
    this.keep(trem, tg);
    osc.start(t);
    trem.start(t);
    osc.stop(t + 0.3);
    trem.stop(t + 0.3);
  }

  /** One syllable of a far voice: noise through two formant band-passes. */
  private syllable(t: number, dur: number, peak: number, f1: number, f2: number, dest: AudioNode): void {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + dur * 0.3);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    const a = ctx.createBiquadFilter();
    a.type = 'bandpass';
    a.frequency.value = f1;
    a.Q.value = 7;
    const b = ctx.createBiquadFilter();
    b.type = 'bandpass';
    b.frequency.value = f2;
    b.Q.value = 9;
    src.connect(a).connect(g);
    src.connect(b).connect(g);
    g.connect(dest);
    this.keep(src, a, b, g);
    src.start(t, rand(0, NOISE_SEC - dur - 0.1));
    src.stop(t + dur + 0.05);
  }
}
