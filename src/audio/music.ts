import type { MusicMood } from './types.ts';
import { Composer, combatBar } from './composer.ts';
import type { BarPlan, CombatStep, NoteEvent, Part } from './composer.ts';
import { MOODS, combatTempoMultiplier } from './moods.ts';
import type { MoodDef, ToneDef, WaveName } from './moods.ts';
import {
  Voice,
  amp,
  chain,
  createPanner,
  filter,
  noise,
  osc,
  perc,
  resources,
  safeDisconnect,
  safeStop,
  setWave,
  sweep,
} from './synth.ts';
import type { BusInput, Resources } from './synth.ts';
import { clamp01, hashString, midiToFreq, mulberry32, pitchClass } from './theory.ts';
import type { Rng } from './theory.ts';

/** Scheduler look-ahead (seconds) and timer period (ms). */
export const LOOKAHEAD = 0.1;
const TICK_MS = 25;
/** Scored notes ringing at once per mood layer (pads and drone are extra, persistent). */
export const MAX_LAYER_VOICES = 6;
const MAX_COMBAT_VOICES = 8;
const COMBAT_LEVEL = 0.9;

function velGain(vel: number): number {
  return clamp01(vel) ** 1.4;
}

/** Synthesises one scored note into `v`. */
function playTone(res: Resources, v: Voice, tone: ToneDef, freq: number, t: number, vel: number): void {
  const peak = tone.level * velGain(vel);
  const decay = tone.decay;
  switch (tone.kind) {
    case 'pluck': {
      const end = t + 0.005 + decay;
      const o = osc(v, res, tone.wave ?? 'triangle', freq, t, end + 0.01);
      const cut = tone.cutoff ?? 2000;
      const f = filter(v, 'lowpass', cut, tone.q ?? 0.8);
      sweep(f.frequency, Math.min(16000, cut * (0.7 + vel)), Math.max(60, cut * 0.3), t, decay * 0.6);
      const g = amp(v);
      perc(g.gain, t, 0.005, decay, peak);
      chain(o, f, g, v.out);
      break;
    }
    case 'bell':
    case 'ep':
    case 'clank': {
      // Two-operator FM: the spectrum settles faster than the amplitude (bright strike, pure ring).
      const ratio = tone.ratio ?? 2;
      const end = t + 0.004 + decay;
      const car = osc(v, res, 'sine', freq, t, end + 0.01);
      const mod = osc(v, res, 'sine', freq * ratio, t, end + 0.01);
      const depth = amp(v);
      const dev = (tone.index ?? 1) * freq * ratio * (0.6 + 0.4 * vel);
      const settle = tone.kind === 'bell' ? 0.45 : tone.kind === 'ep' ? 0.25 : 0.15;
      sweep(depth.gain, dev, dev * 0.04 + 0.5, t, decay * settle);
      chain(mod, depth, car.frequency);
      const g = amp(v);
      perc(g.gain, t, tone.kind === 'ep' ? 0.004 : 0.002, decay, peak);
      if (tone.kind === 'clank') chain(car, filter(v, 'bandpass', tone.cutoff ?? 2500, tone.q ?? 1.2), g, v.out);
      else chain(car, g, v.out);
      break;
    }
    case 'pulse': {
      const end = t + 0.003 + decay;
      const o = osc(v, res, tone.wave ?? 'sawtooth', freq, t, end + 0.01);
      const cut = tone.cutoff ?? 500;
      const f = filter(v, 'lowpass', cut, tone.q ?? 6);
      sweep(f.frequency, cut * (1 + 1.5 * vel), cut * 0.45, t, decay * 0.8);
      const g = amp(v);
      perc(g.gain, t, 0.003, decay, peak);
      chain(o, f, g, v.out);
      break;
    }
    case 'tick': {
      const end = t + 0.002 + decay;
      const n = noise(v, res, t, end + 0.01);
      const f = filter(v, 'bandpass', tone.cutoff ?? 6000, tone.q ?? 2);
      const g = amp(v);
      perc(g.gain, t, 0.002, decay, peak);
      chain(n, f, g, v.out);
      break;
    }
  }
}

interface Queued {
  time: number;
  ev: NoteEvent;
}

interface Grid {
  t0: number;
  step: number;
  root: number;
}

/**
 * One mood's generative arrangement: gliding detuned pad voices through a slowly moving lowpass,
 * a drone, an optional noise bed and echo, and scored notes from the seeded composer.
 */
class MoodLayer {
  readonly mood: MusicMood;
  readonly def: MoodDef;
  readonly beat: number;
  readonly barDur: number;
  readonly t0: number;
  fadingOut = false;
  disposeAt = Infinity;
  disposed = false;
  private readonly ctx: BaseAudioContext;
  private readonly res: Resources;
  private readonly composer: Composer;
  private readonly dry: GainNode;
  private readonly wet: GainNode;
  private readonly nodes: AudioNode[] = [];
  private readonly sources: AudioScheduledSourceNode[] = [];
  private readonly padA: OscillatorNode[] = [];
  private readonly padB: OscillatorNode[] = [];
  private readonly padFilter: BiquadFilterNode;
  private readonly padOut: GainNode;
  private readonly drone: { osc: OscillatorNode; mul: number; add: number }[] = [];
  private readonly parts = new Map<Part, { tone: ToneDef; input: GainNode }>();
  private readonly voices: Voice[] = [];
  private first: BarPlan | null;
  private nextBar = 0;
  private queue: Queued[] = [];

  constructor(ctx: BaseAudioContext, res: Resources, mood: MusicMood, seed: number, out: BusInput, start: number) {
    this.ctx = ctx;
    this.res = res;
    this.mood = mood;
    this.def = MOODS[mood];
    const def = this.def;
    this.beat = 60 / def.tempo;
    this.barDur = this.beat * def.beatsPerBar;
    this.t0 = start;
    this.composer = new Composer(def, seed);
    const first = this.composer.nextBar();
    this.first = first;

    this.dry = this.gain(0);
    this.dry.connect(out.dry);
    this.wet = this.gain(0);
    this.wet.connect(out.wet);

    // Pad: oscillator pairs detuned against each other and split left/right for width.
    const pad = def.pad;
    const left = this.track(createPanner(ctx, -0.6));
    const right = this.track(createPanner(ctx, 0.6));
    this.padFilter = this.biquad('lowpass', pad.cutoff, pad.q);
    this.padOut = this.gain(pad.level);
    chain(left, this.padFilter, this.padOut, this.dry);
    right.connect(this.padFilter);
    this.send(this.padOut, this.wet, def.reverb);
    for (const m of first.pad) {
      const f = midiToFreq(m);
      this.padA.push(this.start(this.osc(pad.wave, f, -pad.detune), left, start));
      this.padB.push(this.start(this.osc(pad.wave, f, pad.detune), right, start));
    }
    const lfoDepth = this.gain(pad.cutoff * pad.lfoDepth);
    lfoDepth.connect(this.padFilter.frequency);
    this.start(this.osc('sine', pad.lfoRate, 0), lfoDepth, start);

    // Drone: sine (or a slowly beating pair) plus a soft triangle an octave up.
    const d = def.drone;
    const droneLp = this.biquad('lowpass', d.cutoff, 0.5);
    const droneOut = this.gain(d.level);
    chain(droneLp, droneOut, this.dry);
    this.send(droneOut, this.wet, def.reverb * 0.3);
    const f0 = midiToFreq(first.drone);
    const partials = [{ mul: 1, add: 0, wave: 'sine' as WaveName, level: 1 }];
    if (d.beat > 0) partials.push({ mul: 1, add: d.beat, wave: 'sine', level: 0.8 });
    if (d.upper > 0) partials.push({ mul: 2, add: 0, wave: 'triangle', level: d.upper });
    for (const p of partials) {
      const lvl = this.gain(p.level);
      lvl.connect(droneLp);
      const o = this.start(this.osc(p.wave, f0 * p.mul + p.add, 0), lvl, start);
      this.drone.push({ osc: o, mul: p.mul, add: p.add });
    }

    if (def.noise) {
      const nb = def.noise;
      const src = this.track(ctx.createBufferSource());
      src.buffer = res.noise;
      src.loop = true;
      const bp = this.biquad('bandpass', nb.freq, nb.q);
      const nOut = this.gain(nb.level);
      chain(src, bp, nOut, this.dry);
      this.send(nOut, this.wet, 0.6);
      const lfo = this.gain(nb.freq * nb.lfoDepth);
      lfo.connect(bp.frequency);
      this.start(this.osc('sine', nb.lfoRate, 0), lfo, start);
      src.start(start, Math.random() * 1.5);
      this.sources.push(src);
    }

    let echoIn: GainNode | null = null;
    if (def.echo) {
      const e = def.echo;
      echoIn = this.gain(1);
      const delay = this.track(ctx.createDelay(4));
      delay.delayTime.value = Math.min(3.9, e.beats * this.beat);
      const tone = this.biquad('lowpass', e.tone, 0.5);
      const fb = this.gain(e.feedback);
      const eOut = this.gain(e.level);
      chain(echoIn, delay, tone, fb, delay);
      chain(tone, eOut, this.dry);
      this.send(eOut, this.wet, 0.5);
    }

    const partTones: [Part, ToneDef | undefined][] = [
      ['melody', def.melody?.tone],
      ['sparkle', def.sparkle?.tone],
      ['comp', def.comp?.tone],
      ['pulse', def.pulse?.tone],
      ['ticks', def.ticks?.tone],
    ];
    for (const [part, tone] of partTones) {
      if (!tone) continue;
      const input = this.gain(1);
      input.connect(this.dry);
      if (tone.wet) this.send(input, this.wet, tone.wet);
      if (tone.echo && echoIn) this.send(input, echoIn, tone.echo);
      this.parts.set(part, { tone, input });
    }
  }

  /** Sixteenth-note grid for the combat layer, tempo-synced to this mood. */
  get grid(): Grid {
    const mul = combatTempoMultiplier(this.def.tempo);
    return { t0: this.t0, step: this.beat / (4 * mul), root: 36 + pitchClass(this.def.key) };
  }

  get voiceCount(): number {
    let n = this.def.pad.voices + 1;
    for (const v of this.voices) if (!v.finished) n++;
    return n;
  }

  scheduleUntil(horizon: number, now: number): void {
    if (this.disposed) return;
    while (this.t0 + this.nextBar * this.barDur <= horizon) {
      const barTime = this.t0 + this.nextBar * this.barDur;
      const plan = this.first ?? this.composer.nextBar();
      this.first = null;
      this.nextBar++;
      // Far behind (stalled timer): skip whole bars rather than play a burst of late notes.
      if (barTime + this.barDur < now) continue;
      this.applyBar(plan, Math.max(barTime, now));
      if (this.fadingOut) continue;
      for (const ev of plan.events) this.queue.push({ time: barTime + ev.beat * this.beat, ev });
    }
    while (this.queue.length > 0 && this.queue[0].time <= horizon) {
      const q = this.queue[0];
      this.queue.shift();
      if (q.time >= now - 0.02) this.playEvent(q.ev, Math.max(q.time, now));
    }
  }

  fadeIn(at: number, dur: number): void {
    this.fadingOut = false;
    this.disposeAt = Infinity;
    for (const g of [this.dry.gain, this.wet.gain]) {
      g.cancelScheduledValues(at);
      g.setTargetAtTime(this.def.level, at, Math.max(0.005, dur / 4));
    }
  }

  fadeOut(at: number, dur: number): void {
    this.fadingOut = true;
    this.disposeAt = Math.min(this.disposeAt, at + dur + 0.5);
    for (const g of [this.dry.gain, this.wet.gain]) {
      g.cancelScheduledValues(at);
      g.setTargetAtTime(0, at, Math.max(0.005, dur / 4.5));
    }
    const cut = at + dur * 0.3;
    this.queue = this.queue.filter((q) => q.time < cut);
  }

  dispose(at: number): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const g of [this.dry.gain, this.wet.gain]) {
      g.cancelScheduledValues(at);
      g.setTargetAtTime(0, at, 0.02);
    }
    for (const v of this.voices) v.release(at);
    this.voices.length = 0;
    this.queue = [];
    for (const s of this.sources) safeStop(s, at + 0.15);
    const last = this.sources[this.sources.length - 1];
    const cleanup = (): void => this.nodes.forEach(safeDisconnect);
    if (last) last.onended = cleanup;
    else cleanup();
  }

  private applyBar(plan: BarPlan, t: number): void {
    const { pad, drone } = this.def;
    if (plan.index > 0 && plan.chordChanged) {
      const tc = pad.glide / 3;
      plan.pad.forEach((m, i) => {
        const f = midiToFreq(m);
        this.padA[i].frequency.setTargetAtTime(f, t, tc);
        this.padB[i].frequency.setTargetAtTime(f, t, tc);
      });
      // Re-articulate: a small dip and swell of the pad on each chord change.
      const g = this.padOut.gain;
      g.setTargetAtTime(pad.level * 0.8, t, 0.12);
      g.setTargetAtTime(pad.level, t + 0.3, 0.9);
      if (drone.follow === 'root') {
        const f = midiToFreq(plan.drone);
        for (const p of this.drone) p.osc.frequency.setTargetAtTime(f * p.mul + p.add, t, 0.35);
      }
    }
    const cut = pad.cutoff * (1 - pad.sweep / 2 + pad.sweep * plan.brightness);
    this.padFilter.frequency.setTargetAtTime(cut, t, this.barDur / 3);
  }

  private playEvent(ev: NoteEvent, t: number): void {
    const part = this.parts.get(ev.part);
    if (!part) return;
    for (let i = this.voices.length - 1; i >= 0; i--) if (this.voices[i].finished) this.voices.splice(i, 1);
    // At the cap, steal the oldest ringing note: by now it has mostly decayed.
    if (this.voices.length >= MAX_LAYER_VOICES) this.voices.shift()?.release(t, 0.03);
    const v = new Voice(this.ctx, part.input, 1, ev.pan);
    playTone(this.res, v, part.tone, ev.part === 'ticks' ? 0 : midiToFreq(ev.midi), t, ev.vel);
    this.voices.push(v);
  }

  private track<T extends AudioNode>(n: T): T {
    this.nodes.push(n);
    return n;
  }

  private gain(value: number): GainNode {
    const g = this.track(this.ctx.createGain());
    g.gain.value = value;
    return g;
  }

  private biquad(type: BiquadFilterType, freq: number, q: number): BiquadFilterNode {
    const f = this.track(this.ctx.createBiquadFilter());
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    return f;
  }

  private send(from: AudioNode, to: AudioNode, amount: number): void {
    if (amount <= 0) return;
    const g = this.gain(amount);
    from.connect(g);
    g.connect(to);
  }

  private osc(wave: WaveName, freq: number, detune: number): OscillatorNode {
    const o = this.track(this.ctx.createOscillator());
    setWave(o, this.res, wave);
    o.frequency.value = freq;
    o.detune.value = detune;
    return o;
  }

  private start<T extends AudioScheduledSourceNode>(src: T, dest: AudioNode, at: number): T {
    src.connect(dest);
    src.start(at);
    this.sources.push(src);
    return src;
  }
}

/** Tense tempo-synced layer (low pulses, noise hats, thumps, stabs) that fades in over any mood. */
class CombatLayer {
  private readonly ctx: BaseAudioContext;
  private readonly res: Resources;
  private readonly input: GainNode;
  private readonly level: GainNode;
  private readonly rng: Rng;
  private readonly voices: Voice[] = [];
  private target = 0;
  private idleSince = 0;
  private grid: Grid | null = null;
  private stepIdx = 0;
  private nextStep = -1;
  private pattern: CombatStep[] = [];
  private patternLevel = -1;

  constructor(ctx: BaseAudioContext, res: Resources, out: BusInput, seed: number) {
    this.ctx = ctx;
    this.res = res;
    this.rng = mulberry32(seed);
    this.input = ctx.createGain();
    this.level = ctx.createGain();
    this.level.gain.value = 0;
    this.input.connect(this.level);
    this.level.connect(out.dry);
    const send = ctx.createGain();
    send.gain.value = 0.2;
    this.level.connect(send);
    send.connect(out.wet);
  }

  get intensity(): number {
    return this.target;
  }

  get voiceCount(): number {
    let n = 0;
    for (const v of this.voices) if (!v.finished) n++;
    return n;
  }

  setIntensity(x: number, now: number): void {
    const rising = x > this.target;
    if (x === 0 && this.target > 0) this.idleSince = now;
    this.target = x;
    const g = this.level.gain;
    g.cancelScheduledValues(now);
    g.setTargetAtTime(x > 0 ? COMBAT_LEVEL * (0.45 + 0.55 * x) : 0, now, rising ? 0.3 : 0.8);
  }

  setGrid(grid: Grid): void {
    this.grid = grid;
    this.nextStep = -1;
  }

  scheduleUntil(horizon: number, now: number): void {
    const g = this.grid;
    if (!g) return;
    if (this.target <= 0 && now - this.idleSince > 4) {
      this.nextStep = -1;
      return;
    }
    if (this.nextStep < 0 || this.nextStep < now - 0.05) {
      this.stepIdx = Math.max(0, Math.ceil((now + 0.005 - g.t0) / g.step));
      this.nextStep = g.t0 + this.stepIdx * g.step;
      this.pattern = [];
    }
    while (this.nextStep <= horizon) {
      const i = this.stepIdx % 16;
      if (i === 0 || this.pattern.length === 0 || Math.abs(this.patternLevel - this.target) > 0.15) {
        this.pattern = combatBar(this.target, this.rng, Math.floor(this.stepIdx / 16));
        this.patternLevel = this.target;
      }
      if (this.target > 0) this.playStep(this.pattern[i], this.nextStep, g);
      this.stepIdx++;
      this.nextStep = g.t0 + this.stepIdx * g.step;
    }
  }

  private playStep(s: CombatStep, t: number, g: Grid): void {
    const { res } = this;
    const x = this.target;
    if (s.kick > 0) {
      this.voice(t, 0, (v) => {
        const o = osc(v, res, 'sine', 130, t, t + 0.3);
        sweep(o.frequency, 130, 42, t, 0.12);
        const a = amp(v);
        perc(a.gain, t, 0.002, 0.24, 0.5 * s.kick);
        chain(o, a, v.out);
      });
    }
    if (s.pulse > 0) {
      this.voice(t, 0, (v) => {
        const o = osc(v, res, 'sawtooth', midiToFreq(g.root + 12 * s.octave), t, t + g.step * 2 + 0.05);
        const lp = filter(v, 'lowpass', 200, 5);
        const cut = 180 + 900 * x;
        sweep(lp.frequency, cut * 2.2, cut * 0.6, t, g.step * 1.5);
        const a = amp(v);
        perc(a.gain, t, 0.003, g.step * 1.8, 0.16 * s.pulse);
        chain(o, lp, a, v.out);
      });
    }
    if (s.hat > 0) {
      this.voice(t, (this.rng() - 0.5) * 0.5, (v) => {
        const len = s.open ? 0.22 : 0.045;
        const n = noise(v, res, t, t + len + 0.02);
        const hp = filter(v, 'highpass', 7000, 0.7);
        const a = amp(v);
        perc(a.gain, t, 0.001, len, 0.07 * s.hat);
        chain(n, hp, a, v.out);
      });
    }
    if (s.stab > 0) {
      this.voice(t, 0, (v) => {
        const f = midiToFreq(g.root + 24);
        const lp = filter(v, 'lowpass', 1600, 2);
        const a = amp(v);
        perc(a.gain, t, 0.004, 0.35, 0.06 * s.stab);
        // Minor ninth and tritone over the root: unresolved tension.
        for (const semis of [1, 6]) osc(v, res, 'sawtooth', f * 2 ** (semis / 12), t, t + 0.4).connect(lp);
        chain(lp, a, v.out);
      });
    }
  }

  private voice(t: number, pan: number, build: (v: Voice) => void): void {
    for (let i = this.voices.length - 1; i >= 0; i--) if (this.voices[i].finished) this.voices.splice(i, 1);
    if (this.voices.length >= MAX_COMBAT_VOICES) this.voices.shift()?.release(t, 0.01);
    const v = new Voice(this.ctx, this.input, 1, pan);
    build(v);
    this.voices.push(v);
  }
}

/**
 * Generative score: crossfading mood layers plus the combat layer, driven by a look-ahead
 * scheduler (a short timer tops up events ~100 ms ahead of the audio clock). Works on an
 * OfflineAudioContext too: call `scheduleUntil(duration)` once instead of `start()`.
 */
export class MusicPlayer {
  private readonly ctx: BaseAudioContext;
  private readonly res: Resources;
  private readonly moodDry: GainNode;
  private readonly moodWet: GainNode;
  private readonly combat: CombatLayer;
  private readonly seed: number;
  private layers: MoodLayer[] = [];
  private spawned = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastWall = 0;
  private appliedIntensity = -1;

  constructor(ctx: BaseAudioContext, out: BusInput, seed = Math.floor(Math.random() * 2 ** 32)) {
    this.ctx = ctx;
    this.res = resources(ctx);
    this.seed = seed >>> 0;
    this.moodDry = ctx.createGain();
    this.moodDry.connect(out.dry);
    this.moodWet = ctx.createGain();
    this.moodWet.connect(out.wet);
    this.combat = new CombatLayer(ctx, this.res, out, this.seed ^ 0x9e3779b9);
  }

  /** The mood currently playing (not fading out), if any. */
  get mood(): MusicMood | null {
    const last = this.layers[this.layers.length - 1];
    return last && !last.fadingOut && !last.disposed ? last.mood : null;
  }

  get intensity(): number {
    return this.combat.intensity;
  }

  get running(): boolean {
    return this.timer !== null;
  }

  get voiceCount(): number {
    let n = this.combat.voiceCount;
    for (const l of this.layers) if (!l.disposed) n += l.voiceCount;
    return n;
  }

  /** Crossfades to `mood` over `fade` seconds (no-op if it is already playing). */
  setMood(mood: MusicMood, fade = 3, at = this.ctx.currentTime): void {
    if (!(mood in MOODS) || this.mood === mood) return;
    const revive = this.layers.find((l) => l.mood === mood && !l.disposed);
    for (const l of this.layers) if (l !== revive && !l.fadingOut) l.fadeOut(at, fade);
    let layer: MoodLayer;
    if (revive) {
      revive.fadeIn(at, fade);
      layer = revive;
      this.layers = this.layers.filter((l) => l !== revive);
    } else {
      // Rapid switching: at most three layers at once. Drop the oldest outright and hurry every
      // fading layer but the newest one away.
      let alive = this.layers.filter((l) => !l.disposed);
      while (alive.length >= 3) {
        alive[0].dispose(at);
        alive = alive.slice(1);
      }
      for (let i = 0; i < alive.length - 1; i++) alive[i].fadeOut(at, 0.4);
      this.layers = alive;
      const seed = ((this.seed ^ hashString(mood)) + this.spawned++ * 7919) >>> 0;
      layer = new MoodLayer(this.ctx, this.res, mood, seed, { dry: this.moodDry, wet: this.moodWet }, at + 0.05);
      layer.fadeIn(at + 0.05, fade);
    }
    this.layers.push(layer);
    this.combat.setGrid(layer.grid);
  }

  /** 0..1: fades the combat layer in/out and gently ducks the mood underneath it. */
  setIntensity(value: number, at = this.ctx.currentTime): void {
    const x = clamp01(value);
    if (Math.abs(x - this.appliedIntensity) < 0.02 && x !== 0 && x !== 1) return;
    if (x === this.appliedIntensity) return;
    this.appliedIntensity = x;
    this.combat.setIntensity(x, at);
    for (const g of [this.moodDry.gain, this.moodWet.gain]) {
      g.cancelScheduledValues(at);
      g.setTargetAtTime(1 - 0.3 * x, at, 0.6);
    }
  }

  /** Layers alive (current plus any still fading out). */
  get layerCount(): number {
    return this.layers.length;
  }

  /** Schedules every event up to `horizon` and retires layers whose fade-out has finished. */
  scheduleUntil(horizon: number): void {
    const now = this.ctx.currentTime;
    let reap = false;
    for (const l of this.layers) {
      if (!l.disposed && l.disposeAt <= now) l.dispose(now);
      if (l.disposed) reap = true;
      else l.scheduleUntil(horizon, now);
    }
    if (reap) this.layers = this.layers.filter((l) => !l.disposed);
    this.combat.scheduleUntil(horizon, now);
  }

  start(): void {
    if (this.timer !== null) return;
    this.lastWall = performance.now();
    this.timer = setInterval(this.tick, TICK_MS);
    this.tick();
  }

  stop(): void {
    if (this.timer === null) return;
    clearInterval(this.timer);
    this.timer = null;
  }

  dispose(): void {
    this.stop();
    const now = this.ctx.currentTime;
    this.combat.setIntensity(0, now);
    for (const l of this.layers) l.dispose(now);
    this.layers = [];
  }

  private readonly tick = (): void => {
    if (this.ctx.state !== 'running') return;
    const wall = performance.now();
    const gap = (wall - this.lastWall) / 1000;
    this.lastWall = wall;
    // Throttled timers (background tabs, long frames): widen the window to bridge the gap.
    this.scheduleUntil(this.ctx.currentTime + Math.min(1.2, Math.max(LOOKAHEAD, gap * 1.5)));
  };
}
