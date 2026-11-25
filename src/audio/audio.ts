// ─────────────────────────────────────────────────────────────────────────────
// AudioEngine: every sound is synthesized with WebAudio (no audio files).
//
//   • SFX for the game's 'sfx' events (build / zone / road / bulldoze / error /
//     click / money / milestone / alert), rate-limited and voice-capped.
//   • Story cues (docs/STORY.md §8): a two-note chime for an incoming faction
//     card, a low "transmission" swell when a card opens, a deep sub drop and
//     rising tone for a chapter title, a glassy arpeggio for a Silt Log and a
//     slow chord for an ending. They listen to the story events directly (no
//     new 'sfx' kinds) and share the SFX bus, volume and voice cap.
//   • Launch rumble (EXPANSION §9): on 'liftoff', a 3 s low-passed noise swell
//     under a slow rising sine. Launches are ≥ 180 s apart, so it never drones.
//   • Megacity (MEGACITY §10): an annex plays the milestone sound as the fog
//     lifts; the optional City life chime is a soft three-note bell when a
//     night market or a lantern night starts (City life on), listening to
//     'cityEvent' directly. Its own gap (≥ 420 s apart by construction).
//   • Optional ambient score (settings.music): a slow generative synthwave pad
//     — detuned saws + sub triangle through a breathing low-pass, chord changes
//     every ~8 s, a soft sine bass and a sparse delayed arpeggio.
//
// The AudioContext is created lazily on the first user gesture (iOS / Chrome
// autoplay rules) and re-resumed on later gestures if the OS interrupted it.
// It is suspended while the page is hidden. Master volume is conservative.
// ─────────────────────────────────────────────────────────────────────────────

import type { GameEventMap } from '../game/events';
import type { Game } from '../game/game';
import { cityLifeOn } from '../game/settings';

type SfxKind = GameEventMap['sfx'];
/** Event-driven cues with their own gap (not sfx kinds; STORY-CONTRACT keys a Record on those). */
type StoryCue = 'incoming' | 'card' | 'chapter' | 'log' | 'ending' | 'launch' | 'chime';
const STORY_GAP: Record<StoryCue, number> = { incoming: 1.5, card: 0.6, chapter: 2, log: 1.5, ending: 3, launch: 20, chime: 60 };
/** City life happenings that ring the chime (§10): the two that light up the streets. */
const CHIME_EVENTS: ReadonlySet<string> = new Set(['nightmarket', 'lanterns']);

const MASTER_GAIN = 0.42;
const SFX_GAIN = 0.9;
const MUSIC_GAIN = 0.3;
const MAX_VOICES = 28;

/** Minimum gap between two plays of the same sound (seconds). */
const MIN_GAP: Record<SfxKind, number> = {
  click: 0.035,
  road: 0.045,
  zone: 0.06,
  build: 0.09,
  bulldoze: 0.09,
  error: 0.14,
  money: 5, // monthly settlement fires every ~2 s at top speed
  milestone: 1.5,
  alert: 0.8,
};

const mtof = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

type AudioCtor = typeof AudioContext;

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private sfxBus: GainNode | null = null;
  private musicBus: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private music: AmbientScore | null = null;
  private readonly last = new Map<SfxKind, number>();
  private readonly lastCue = new Map<StoryCue, number>();
  private voices = 0;
  private failed = false;

  constructor(private readonly game: Game) {
    game.events.on('sfx', (kind) => this.play(kind));
    game.events.on('incoming', () => this.cue('incoming'));
    game.events.on('card', (c) => {
      if (c) this.cue('card');
    });
    game.events.on('chapter', () => this.cue('chapter'));
    game.events.on('log', () => this.cue('log'));
    game.events.on('ending', () => this.cue('ending'));
    game.events.on('liftoff', () => this.cue('launch'));
    // Megacity (§10): the annex's fog lift, and the optional City life chime (only while City life is on).
    game.events.on('annex', () => this.play('milestone'));
    game.events.on('cityEvent', (e) => {
      if (e.phase === 'start' && CHIME_EVENTS.has(e.id) && cityLifeOn(this.game.settings)) this.cue('chime');
    });
    game.events.on('settings', () => this.syncSettings());
    const unlock = () => this.unlock();
    for (const type of ['pointerdown', 'touchend', 'mousedown', 'keydown']) {
      window.addEventListener(type, unlock, { capture: true, passive: true });
    }
    document.addEventListener('visibilitychange', () => this.onVisibility());
  }

  // ── Context lifecycle ─────────────────────────────────────────────────────

  /** Create / resume the context inside a user gesture. Cheap when already running. */
  private unlock(): void {
    if (this.failed) return;
    if (!this.ctx) {
      const Ctor: AudioCtor | undefined =
        (globalThis as unknown as { AudioContext?: AudioCtor }).AudioContext ??
        (globalThis as unknown as { webkitAudioContext?: AudioCtor }).webkitAudioContext;
      if (!Ctor) {
        this.failed = true;
        return;
      }
      try {
        this.ctx = new Ctor({ latencyHint: 'interactive' });
      } catch {
        this.failed = true;
        return;
      }
      this.build(this.ctx);
      // iOS: playing a silent buffer inside the gesture fully unlocks output.
      try {
        const src = this.ctx.createBufferSource();
        src.buffer = this.ctx.createBuffer(1, 1, 22050);
        src.connect(this.ctx.destination);
        src.start(0);
      } catch {
        /* ignore */
      }
      this.syncSettings();
    }
    if (this.ctx.state !== 'running' && document.visibilityState === 'visible') {
      this.ctx.resume().catch(() => undefined);
    }
  }

  private build(ctx: AudioContext): void {
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16;
    comp.knee.value = 12;
    comp.ratio.value = 4;
    comp.attack.value = 0.004;
    comp.release.value = 0.2;
    comp.connect(ctx.destination);

    this.master = ctx.createGain();
    this.master.gain.value = MASTER_GAIN;
    this.master.connect(comp);

    this.sfxBus = ctx.createGain();
    this.sfxBus.gain.value = this.game.settings.sound ? SFX_GAIN : 0;
    this.sfxBus.connect(this.master);

    this.musicBus = ctx.createGain();
    this.musicBus.gain.value = 0;
    this.musicBus.connect(this.master);

    // One second of white noise, shared by every noisy sound.
    const len = ctx.sampleRate;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  }

  private onVisibility(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    if (document.visibilityState === 'hidden') {
      ctx.suspend().catch(() => undefined);
    } else {
      ctx.resume().catch(() => undefined);
    }
  }

  private syncSettings(): void {
    const ctx = this.ctx;
    if (!ctx || !this.sfxBus || !this.musicBus) return;
    const s = this.game.settings;
    this.sfxBus.gain.setTargetAtTime(s.sound ? SFX_GAIN : 0, ctx.currentTime, 0.03);
    if (s.music && !this.music) {
      this.music = new AmbientScore(ctx, this.musicBus);
      this.musicBus.gain.cancelScheduledValues(ctx.currentTime);
      this.musicBus.gain.setValueAtTime(this.musicBus.gain.value, ctx.currentTime);
      this.musicBus.gain.linearRampToValueAtTime(MUSIC_GAIN, ctx.currentTime + 3);
    } else if (!s.music && this.music) {
      const m = this.music;
      this.music = null;
      this.musicBus.gain.cancelScheduledValues(ctx.currentTime);
      this.musicBus.gain.setValueAtTime(this.musicBus.gain.value, ctx.currentTime);
      this.musicBus.gain.linearRampToValueAtTime(0, ctx.currentTime + 1.2);
      window.setTimeout(() => m.stop(), 1400);
    }
  }

  // ── SFX ───────────────────────────────────────────────────────────────────

  private play(kind: SfxKind): void {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running' || !this.game.settings.sound || !this.sfxBus) return;
    const now = ctx.currentTime;
    const prev = this.last.get(kind) ?? -1;
    if (now - prev < MIN_GAP[kind]) return;
    if (this.voices > MAX_VOICES && kind !== 'milestone') return;
    this.last.set(kind, now);
    const t = now + 0.005;
    switch (kind) {
      case 'click':
        return this.click(t);
      case 'road':
        return this.road(t);
      case 'zone':
        return this.zone(t);
      case 'build':
        return this.buildSfx(t);
      case 'bulldoze':
        return this.bulldoze(t);
      case 'error':
        return this.error(t);
      case 'money':
        return this.money(t);
      case 'milestone':
        return this.milestone(t);
      case 'alert':
        return this.alert(t);
    }
  }

  // ── Story cues ────────────────────────────────────────────────────────────

  private cue(kind: StoryCue): void {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running' || !this.game.settings.sound || !this.sfxBus) return;
    const now = ctx.currentTime;
    if (now - (this.lastCue.get(kind) ?? -10) < STORY_GAP[kind]) return;
    if (this.voices > MAX_VOICES) return;
    this.lastCue.set(kind, now);
    const t = now + 0.01;
    switch (kind) {
      case 'incoming':
        // Two soft bell notes, a fifth apart, with a faint radio hiss.
        this.tone('sine', mtof(81), t, 0.5, 0.05, { attack: 0.006 });
        this.tone('sine', mtof(88), t + 0.14, 0.7, 0.045, { attack: 0.006 });
        this.tone('triangle', mtof(93), t + 0.14, 0.25, 0.012);
        this.hiss(t, 0.35, 0.01, 'bandpass', 2400, { q: 2 });
        return;
      case 'card':
        // Low transmission swell: a filtered noise breath under a soft sine.
        this.hiss(t, 0.6, 0.02, 'lowpass', 300, { f1: 1600, attack: 0.18 });
        this.tone('sine', mtof(45), t, 0.9, 0.05, { attack: 0.2 });
        this.tone('sine', mtof(64), t + 0.1, 0.6, 0.014, { attack: 0.15 });
        return;
      case 'chapter':
        // Deep sub drop, then a rising neon tone.
        this.tone('sine', 90, t, 1.6, 0.11, { f1: 38, glide: 1.2, attack: 0.01 });
        this.hiss(t, 1.2, 0.03, 'lowpass', 900, { f1: 200 });
        this.tone('sawtooth', mtof(57), t + 0.25, 1.4, 0.016, { f1: mtof(69), glide: 1.1, attack: 0.3 });
        this.tone('sine', mtof(81), t + 0.9, 1.1, 0.03, { attack: 0.08 });
        return;
      case 'log':
        [76, 79, 83, 88, 91].forEach((m, i) => this.tone('sine', mtof(m), t + i * 0.09, 0.9, 0.028, { attack: 0.01 }));
        this.tone('triangle', mtof(52), t, 1.2, 0.03, { attack: 0.05 });
        return;
      case 'ending':
        this.milestone(t);
        return;
      case 'launch':
        this.launch(t);
        return;
      case 'chime':
        // A soft lantern bell: three rising sine notes with a long tail, quieter than a card's chime.
        [79, 83, 86].forEach((m, i) => this.tone('sine', mtof(m), t + i * 0.18, 1.4, 0.026, { attack: 0.01 }));
        this.tone('triangle', mtof(67), t, 1.6, 0.012, { attack: 0.08 });
        return;
    }
  }

  /**
   * A rocket leaving the city (EXPANSION §9): low-passed noise that swells for ~1.2 s and fades by
   * 3 s, a sub sine rising slowly under it and a faint high air roar. About 3 s, sfx bus volume.
   */
  private launch(t: number): void {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.Q.value = 0.7;
    lp.frequency.setValueAtTime(160, t);
    lp.frequency.exponentialRampToValueAtTime(520, t + 1.2);
    lp.frequency.exponentialRampToValueAtTime(140, t + 3);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.16, t + 1.1);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 3);
    src.connect(lp).connect(g).connect(this.sfxBus!);
    this.track(src, g);
    src.start(t, Math.random() * 0.5);
    src.stop(t + 3.05);
    // The slow rising sine under the roar.
    this.tone('sine', 38, t, 3, 0.09, { f1: 72, glide: 2.8, attack: 0.6 });
    this.hiss(t + 0.3, 2.4, 0.012, 'bandpass', 1800, { f1: 900, q: 0.6, attack: 0.5 });
  }

  /** Oscillator with an attack / exponential-decay envelope and optional pitch glide. */
  private tone(
    type: OscillatorType,
    f0: number,
    t: number,
    dur: number,
    peak: number,
    opts: { f1?: number; glide?: number; attack?: number; detune?: number; dest?: AudioNode } = {},
  ): void {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(f0, t);
    if (opts.f1 !== undefined) osc.frequency.exponentialRampToValueAtTime(Math.max(1, opts.f1), t + (opts.glide ?? dur));
    if (opts.detune) osc.detune.value = opts.detune;
    const a = opts.attack ?? 0.004;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g).connect(opts.dest ?? this.sfxBus!);
    this.track(osc, g);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  /** Filtered noise burst with optional filter sweep. */
  private hiss(
    t: number,
    dur: number,
    peak: number,
    filter: BiquadFilterType,
    f0: number,
    opts: { f1?: number; q?: number; attack?: number; dest?: AudioNode } = {},
  ): void {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const bq = ctx.createBiquadFilter();
    bq.type = filter;
    bq.frequency.setValueAtTime(f0, t);
    if (opts.f1 !== undefined) bq.frequency.exponentialRampToValueAtTime(Math.max(20, opts.f1), t + dur);
    bq.Q.value = opts.q ?? 0.8;
    const g = ctx.createGain();
    const a = opts.attack ?? 0.003;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(bq).connect(g).connect(opts.dest ?? this.sfxBus!);
    this.track(src, g);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.02);
  }

  private track(src: AudioScheduledSourceNode, g: GainNode): void {
    this.voices++;
    src.onended = () => {
      this.voices--;
      try {
        src.disconnect();
        g.disconnect();
      } catch {
        /* already gone */
      }
    };
  }

  private click(t: number): void {
    this.tone('triangle', 2100, t, 0.045, 0.05, { f1: 1300, glide: 0.03 });
    this.hiss(t, 0.02, 0.018, 'highpass', 5000);
  }

  private road(t: number): void {
    const j = 1 + (Math.random() - 0.5) * 0.12;
    this.tone('square', 1150 * j, t, 0.035, 0.022, { f1: 820 * j });
    this.hiss(t, 0.028, 0.05, 'bandpass', 2600 * j, { q: 2.2 });
  }

  private zone(t: number): void {
    const j = 1 + (Math.random() - 0.5) * 0.06;
    this.tone('sine', 520 * j, t, 0.14, 0.09, { f1: 790 * j, glide: 0.06 });
    this.tone('triangle', 1040 * j, t + 0.012, 0.1, 0.025, { f1: 1580 * j, glide: 0.06 });
  }

  private buildSfx(t: number): void {
    // Thunk: a dropping sine body + a puff of low noise.
    this.tone('sine', 150, t, 0.34, 0.32, { f1: 46, glide: 0.2, attack: 0.006 });
    this.hiss(t, 0.11, 0.1, 'lowpass', 900, { f1: 200 });
    // Shimmer: staggered high partials of an A-major add9 sparkle.
    const ctx = this.ctx!;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 900;
    hp.connect(this.sfxBus!);
    const notes = [1318.5, 1760, 2217.5, 2637];
    notes.forEach((f, i) => {
      this.tone('sine', f, t + 0.07 + i * 0.038, 0.55, 0.028, { attack: 0.012, detune: (Math.random() - 0.5) * 12, dest: hp });
    });
    window.setTimeout(() => {
      try {
        hp.disconnect();
      } catch {
        /* ignore */
      }
    }, 1200);
  }

  private bulldoze(t: number): void {
    this.tone('sine', 95, t, 0.26, 0.22, { f1: 38, glide: 0.2 });
    this.hiss(t, 0.36, 0.26, 'lowpass', 2600, { f1: 240, q: 1.2 });
    // Crunchy debris: short band-passed bursts at random pitches.
    for (let i = 0; i < 3; i++) {
      this.hiss(t + 0.04 + i * 0.06 + Math.random() * 0.02, 0.07, 0.12, 'bandpass', 700 + Math.random() * 1400, { q: 3 });
    }
  }

  private error(t: number): void {
    const ctx = this.ctx!;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 760;
    lp.connect(this.sfxBus!);
    for (const off of [0, 0.13]) {
      this.tone('sawtooth', 110, t + off, 0.1, 0.085, { attack: 0.006, dest: lp });
      this.tone('sawtooth', 116.5, t + off, 0.1, 0.07, { attack: 0.006, dest: lp });
    }
    window.setTimeout(() => {
      try {
        lp.disconnect();
      } catch {
        /* ignore */
      }
    }, 800);
  }

  private money(t: number): void {
    const notes = [1046.5, 1318.5, 1568, 2093];
    notes.forEach((f, i) => {
      this.tone('triangle', f, t + i * 0.055, 0.2, 0.045, { attack: 0.003 });
      this.tone('sine', f * 2, t + i * 0.055, 0.08, 0.012);
    });
  }

  private milestone(t: number): void {
    const ctx = this.ctx!;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.Q.value = 3;
    lp.frequency.setValueAtTime(320, t);
    lp.frequency.exponentialRampToValueAtTime(5200, t + 1.3);
    lp.frequency.exponentialRampToValueAtTime(1400, t + 2.6);
    const out = ctx.createGain();
    out.gain.value = 1;
    lp.connect(out).connect(this.sfxBus!);
    // A rising A-major-9 chord, saws detuned in pairs.
    const notes = [57, 61, 64, 69, 71, 76];
    notes.forEach((m, i) => {
      const f = mtof(m);
      const at = t + i * 0.085;
      for (const d of [-9, 9]) this.swell('sawtooth', f, at, 2.4, 0.032, d, lp);
    });
    // Sparkle on top once the chord blooms.
    [88, 93, 95, 100].forEach((m, i) => this.tone('sine', mtof(m), t + 0.75 + i * 0.09, 0.6, 0.02, { attack: 0.01 }));
    window.setTimeout(() => {
      try {
        lp.disconnect();
        out.disconnect();
      } catch {
        /* ignore */
      }
    }, 3600);
  }

  /** Slow-attack sustained voice (for chords). */
  private swell(type: OscillatorType, f: number, t: number, dur: number, peak: number, detune: number, dest: AudioNode): void {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.value = f;
    osc.detune.value = detune;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + 0.12);
    g.gain.setValueAtTime(peak, t + dur * 0.45);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g).connect(dest);
    this.track(osc, g);
    osc.start(t);
    osc.stop(t + dur + 0.05);
  }

  private alert(t: number): void {
    const ctx = this.ctx!;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 2400;
    lp.connect(this.sfxBus!);
    const seq = [880, 660, 880, 660];
    seq.forEach((f, i) => this.tone('square', f, t + i * 0.15, 0.13, 0.032, { attack: 0.008, dest: lp }));
    window.setTimeout(() => {
      try {
        lp.disconnect();
      } catch {
        /* ignore */
      }
    }, 1200);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Ambient score: look-ahead scheduler (setInterval + AudioContext clock).
// ─────────────────────────────────────────────────────────────────────────────

interface Chord {
  bass: number;
  pad: number[];
}

/** i – VI – III – VII in A minor, with lush extensions. MIDI notes. */
const PROGRESSION: Chord[] = [
  { bass: 45, pad: [57, 60, 64, 71] }, // Am(add9)
  { bass: 41, pad: [53, 57, 60, 64] }, // Fmaj7
  { bass: 48, pad: [55, 60, 64, 71] }, // Cmaj7
  { bass: 43, pad: [55, 59, 62, 64] }, // G6
];

const CHORD_SECONDS = 8;
const STEP_SECONDS = 0.4; // eighth notes at 75 BPM
const LOOKAHEAD = 0.7;

class AmbientScore {
  private readonly padFilter: BiquadFilterNode;
  private readonly lfo: OscillatorNode;
  private readonly lfoGain: GainNode;
  private readonly delay: DelayNode;
  private readonly feedback: GainNode;
  private readonly arpBus: GainNode;
  private readonly timer: number;
  private nextChord: number;
  private nextStep: number;
  private chordIndex = 0;
  private current: Chord = PROGRESSION[0];
  private readonly live = new Set<AudioScheduledSourceNode>();
  private stopped = false;

  constructor(
    private readonly ctx: AudioContext,
    private readonly out: GainNode,
  ) {
    const t = ctx.currentTime;
    this.padFilter = ctx.createBiquadFilter();
    this.padFilter.type = 'lowpass';
    this.padFilter.frequency.value = 760;
    this.padFilter.Q.value = 0.9;
    this.padFilter.connect(out);

    // Slow "breathing" of the pad's cutoff.
    this.lfo = ctx.createOscillator();
    this.lfo.frequency.value = 0.06;
    this.lfoGain = ctx.createGain();
    this.lfoGain.gain.value = 380;
    this.lfo.connect(this.lfoGain).connect(this.padFilter.frequency);
    this.lfo.start(t);

    // Arp → feedback delay with a darkening filter in the loop.
    this.arpBus = ctx.createGain();
    this.arpBus.gain.value = 1;
    this.delay = ctx.createDelay(2);
    this.delay.delayTime.value = STEP_SECONDS * 1.5;
    this.feedback = ctx.createGain();
    this.feedback.gain.value = 0.38;
    const loopLp = ctx.createBiquadFilter();
    loopLp.type = 'lowpass';
    loopLp.frequency.value = 2200;
    this.arpBus.connect(out);
    this.arpBus.connect(this.delay);
    this.delay.connect(loopLp).connect(this.feedback).connect(this.delay);
    const wet = ctx.createGain();
    wet.gain.value = 0.55;
    this.delay.connect(wet).connect(out);

    this.nextChord = t + 0.1;
    this.nextStep = t + 0.1 + STEP_SECONDS * 4;
    this.timer = window.setInterval(() => this.schedule(), 200);
    this.schedule();
  }

  private schedule(): void {
    if (this.stopped || this.ctx.state !== 'running') return;
    const horizon = this.ctx.currentTime + LOOKAHEAD;
    while (this.nextChord < horizon) {
      this.current = PROGRESSION[this.chordIndex % PROGRESSION.length];
      this.chordIndex++;
      this.playChord(this.current, this.nextChord);
      this.nextChord += CHORD_SECONDS;
    }
    while (this.nextStep < horizon) {
      if (Math.random() < 0.34) this.playArp(this.nextStep);
      this.nextStep += STEP_SECONDS;
    }
  }

  private playChord(c: Chord, t: number): void {
    const dur = CHORD_SECONDS + 3; // overlap into the next chord
    for (const m of c.pad) {
      const f = mtof(m);
      this.voice('sawtooth', f, t, dur, 0.028, -9, this.padFilter, 2.6);
      this.voice('sawtooth', f, t, dur, 0.028, 9, this.padFilter, 2.6);
      this.voice('triangle', f / 2, t, dur, 0.02, 0, this.padFilter, 2.6);
    }
    // Soft sine bass, entering a beat late.
    this.voice('sine', mtof(c.bass), t + STEP_SECONDS * 2, CHORD_SECONDS - 0.4, 0.085, 0, this.out, 0.6);
  }

  private playArp(t: number): void {
    const notes = this.current.pad;
    const m = notes[Math.floor(Math.random() * notes.length)] + (Math.random() < 0.55 ? 12 : 24);
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    osc.type = Math.random() < 0.7 ? 'triangle' : 'sine';
    osc.frequency.value = mtof(m);
    const g = ctx.createGain();
    const peak = 0.022 + Math.random() * 0.014;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.55);
    osc.connect(g).connect(this.arpBus);
    this.keep(osc, g);
    osc.start(t);
    osc.stop(t + 0.6);
  }

  /** Long pad voice: slow attack, hold, slow release. */
  private voice(type: OscillatorType, f: number, t: number, dur: number, peak: number, detune: number, dest: AudioNode, attack: number): void {
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.value = f;
    osc.detune.value = detune;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + attack);
    g.gain.setValueAtTime(peak, t + dur - 3);
    g.gain.linearRampToValueAtTime(0, t + dur);
    osc.connect(g).connect(dest);
    this.keep(osc, g);
    osc.start(t);
    osc.stop(t + dur + 0.05);
  }

  private keep(src: AudioScheduledSourceNode, g: GainNode): void {
    this.live.add(src);
    src.onended = () => {
      this.live.delete(src);
      try {
        src.disconnect();
        g.disconnect();
      } catch {
        /* ignore */
      }
    };
  }

  stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    window.clearInterval(this.timer);
    const t = this.ctx.currentTime;
    for (const s of this.live) {
      try {
        s.stop(t + 0.05);
      } catch {
        /* not started / already stopped */
      }
    }
    try {
      this.lfo.stop(t + 0.05);
    } catch {
      /* ignore */
    }
    window.setTimeout(() => {
      for (const n of [this.padFilter, this.lfoGain, this.delay, this.feedback, this.arpBus]) {
        try {
          n.disconnect();
        } catch {
          /* ignore */
        }
      }
    }, 300);
  }
}
