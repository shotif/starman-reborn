import type { AmbienceRoom } from './types.ts';
import { AMBIENCE, AMBIENCE_LIMITS, AmbiencePlanner, RADIO, murmurStep, radioBurst, radioGap } from './ambienceSpecs.ts';
import type { AmbientEvent, AmbientEventKind, RadioBurst, RoomAmbienceDef } from './ambienceSpecs.ts';
import { Voice, ahr, amp, chain, filter, noise, osc, perc, resources, safeDisconnect, safeStop, shaper, sweep } from './synth.ts';
import type { BusInput, Resources } from './synth.ts';
import { between, chance, clamp01, hashString, mulberry32 } from './theory.ts';
import type { Rng } from './theory.ts';

/** Scheduler look-ahead (seconds) and timer period (ms): ambience events are sparse, not rhythmic. */
export const AMBIENCE_LOOKAHEAD = 0.3;
const TICK_MS = 100;
/** Seconds a room bed takes to fade in, and to fade out when the player moves on. */
const FADE_IN = 1.5;
const FADE_OUT = 1.2;
/** Reverb send of the steady beds (the hall around them). */
const ROOM_SEND = 0.15;

type Recipe = (v: Voice, res: Resources, t: number, e: AmbientEvent, rng: Rng) => void;

/** A two-operator FM strike (metal, glass): the brightness settles faster than the ring. */
function strike(v: Voice, res: Resources, t: number, freq: number, ratio: number, index: number, decay: number, peak: number, dest: AudioNode): void {
  const car = osc(v, res, 'sine', freq, t, t + decay + 0.03);
  const mod = osc(v, res, 'sine', freq * ratio, t, t + decay + 0.03);
  const dev = amp(v);
  sweep(dev.gain, freq * ratio * index, freq * 0.05 + 1, t, decay * 0.3);
  chain(mod, dev, car.frequency);
  const g = amp(v);
  perc(g.gain, t, 0.001, decay, peak);
  chain(car, g, dest);
}

/** Room events. `e.level` is the voice's gain; each recipe's own envelopes peak at 1 or below. */
const RECIPES: Record<AmbientEventKind, Recipe> = {
  clank: (v, res, t, e, rng) => {
    // Metal on metal, far off: an inharmonic strike through a band, and a knock under it.
    const bp = filter(v, 'bandpass', e.freq * 2, 1.2);
    bp.connect(v.out);
    strike(v, res, t, e.freq, 1.41, 3, between(rng, 0.5, 1.1), 1, bp);
    const k = osc(v, res, 'sine', e.freq * 0.6, t, t + 0.22);
    sweep(k.frequency, e.freq * 0.6, e.freq * 0.35, t, 0.1);
    const kg = amp(v);
    perc(kg.gain, t, 0.002, 0.15, 0.6);
    chain(k, kg, v.out);
  },

  clink: (v, res, t, e, rng) => {
    // Glass on glass, sometimes a second glass answering.
    strike(v, res, t, e.freq, 2.32, 1.2, between(rng, 0.3, 0.55), 1, v.out);
    if (chance(rng, 0.4)) strike(v, res, t + between(rng, 0.06, 0.14), e.freq * between(rng, 1.04, 1.12), 2.32, 1.2, between(rng, 0.25, 0.45), 0.8, v.out);
  },

  hiss: (v, res, t, e, rng) => {
    // Hydraulics letting go: a band of noise swelling and sinking.
    const a = between(rng, 0.08, 0.2);
    const hold = between(rng, 0.2, 0.7);
    const r = between(rng, 0.4, 0.9);
    const n = noise(v, res, t, t + a + hold + r + 0.02);
    const bp = filter(v, 'bandpass', e.freq, 1.1);
    sweep(bp.frequency, e.freq, e.freq * 0.7, t, a + hold + r);
    const g = amp(v);
    ahr(g.gain, t, a, hold, r, 1);
    chain(n, bp, g, v.out);
  },

  thud: (v, res, t, e) => {
    // Something heavy set down: a sine dropping onto its note, and a dull knock of noise.
    const o = osc(v, res, 'sine', e.freq * 2, t, t + 0.4);
    sweep(o.frequency, e.freq * 2, e.freq, t, 0.08);
    const g = amp(v);
    perc(g.gain, t, 0.003, 0.3, 1);
    chain(o, g, v.out);
    const n = noise(v, res, t, t + 0.12);
    const lp = filter(v, 'lowpass', 900, 0.7);
    const ng = amp(v);
    perc(ng.gain, t, 0.001, 0.08, 0.5);
    chain(n, lp, ng, v.out);
  },

  beep: (v, res, t, e, rng) => {
    // A scanner acknowledging a crate: two or three short beeps, the last one higher.
    const count = chance(rng, 0.5) ? 2 : 3;
    for (let i = 0; i < count; i++) {
      const at = t + i * 0.12;
      const o = osc(v, res, 'sine', e.freq * (i === count - 1 ? 1.26 : 1), at, at + 0.1);
      const g = amp(v);
      ahr(g.gain, at, 0.004, 0.05, 0.03, 1);
      chain(o, g, v.out);
    }
  },

  servo: (v, res, t, e, rng) => {
    // A loader arm: a buzzy motor that winds up and settles.
    const up = between(rng, 0.3, 0.6);
    const down = between(rng, 0.25, 0.5);
    const o = osc(v, res, 'sawtooth', e.freq, t, t + up + down + 0.1);
    o.frequency.setValueAtTime(e.freq, t);
    o.frequency.linearRampToValueAtTime(e.freq * 1.6, t + up);
    o.frequency.linearRampToValueAtTime(e.freq * 1.25, t + up + down);
    const bp = filter(v, 'bandpass', e.freq * 3, 3);
    const g = amp(v);
    ahr(g.gain, t, 0.06, Math.max(0, up + down - 0.12), 0.1, 1);
    chain(o, bp, g, v.out);
  },

  ratchet: (v, res, t, e, rng) => {
    // An impact wrench: a quick run of clicks over a motor whine.
    const clicks = 5 + Math.floor(rng() * 6);
    const rate = between(rng, 14, 22);
    const len = clicks / rate;
    const n = noise(v, res, t, t + len + 0.05);
    const bp = filter(v, 'bandpass', e.freq, 2);
    const g = amp(v);
    for (let i = 0; i < clicks; i++) perc(g.gain, t + i / rate, 0.001, 0.025, 1 - 0.3 * rng());
    chain(n, bp, g, v.out);
    const m = osc(v, res, 'sawtooth', rate * 6, t, t + len + 0.1);
    const lp = filter(v, 'lowpass', 900, 1);
    const mg = amp(v);
    ahr(mg.gain, t, 0.02, Math.max(0, len - 0.04), 0.06, 0.25);
    chain(m, lp, mg, v.out);
  },

  crackle: (v, res, t, e, rng) => {
    // Welding: bright static in random spits over a low electric buzz.
    const len = between(rng, 0.6, 1.4);
    const n = noise(v, res, t, t + len + 0.05);
    const hp = filter(v, 'highpass', e.freq, 0.8);
    const g = amp(v);
    for (let at = t; at < t + len; ) {
      const d = between(rng, 0.004, 0.03);
      perc(g.gain, at, 0.0005, d, between(rng, 0.3, 1));
      at += d + 0.0015 + between(rng, 0.002, 0.05);
    }
    chain(n, hp, g, v.out);
    const buzz = osc(v, res, 'square', between(rng, 98, 122), t, t + len + 0.1);
    const lp = filter(v, 'lowpass', 600, 0.7);
    const bg = amp(v);
    ahr(bg.gain, t, 0.05, Math.max(0, len - 0.1), 0.1, 0.12);
    chain(buzz, lp, bg, v.out);
  },
};

/** One burst of distant radio chatter: the squelch opens, garbled band-limited static, the squelch closes. */
function playRadio(v: Voice, res: Resources, t: number, b: RadioBurst): void {
  const end = t + b.duration;
  const n = noise(v, res, t, end + 0.02);
  const hp = filter(v, 'highpass', 2800, 0.7);
  const squelch = amp(v);
  perc(squelch.gain, t, 0.001, RADIO.open, 0.5);
  perc(squelch.gain, end - RADIO.tail, 0.002, RADIO.tail - 0.01, 0.4);
  chain(n, hp, squelch, v.out);
  // The chatter: a narrow band that jumps about, gated syllable by syllable and driven into grit.
  const bp = filter(v, 'bandpass', b.syllables[0]?.band ?? 1500, 2.5);
  const gate = amp(v);
  for (const s of b.syllables) {
    bp.frequency.setValueAtTime(s.band, t + s.t);
    gate.gain.setTargetAtTime(s.level * RADIO.drive, t + s.t, 0.01);
    gate.gain.setTargetAtTime(0, t + s.t + s.len, 0.015);
  }
  chain(n, bp, gate, shaper(v, res), v.out);
  // A faint carrier whistle drifting underneath.
  const w = osc(v, res, 'sine', b.whistle, t, end);
  sweep(w.frequency, b.whistle, b.whistle * 0.97, t, b.duration);
  const wg = amp(v);
  ahr(wg.gain, t, 0.05, Math.max(0, b.duration - 0.2), 0.1, 0.05);
  chain(w, wg, v.out);
}

/**
 * One room's looping bed: a beating hum, filtered noise, a murmur of talkers (the bar) and sparse
 * random events from its planner. Fades in and out; its nodes are released after it fades out.
 */
class RoomBed {
  readonly room: AmbienceRoom;
  readonly def: RoomAmbienceDef;
  fadingOut = false;
  disposeAt = Infinity;
  disposed = false;
  private readonly ctx: BaseAudioContext;
  private readonly res: Resources;
  private readonly bus: BusInput;
  private readonly out: GainNode;
  private readonly nodes: AudioNode[] = [];
  private readonly sources: AudioScheduledSourceNode[] = [];
  private readonly voices: Voice[] = [];
  private readonly talkers: { gain: GainNode; band: BiquadFilterNode; base: number; next: number }[] = [];
  private readonly planner: AmbiencePlanner;
  private readonly rng: Rng;

  constructor(ctx: BaseAudioContext, res: Resources, room: AmbienceRoom, bus: BusInput, seed: number, start: number) {
    this.ctx = ctx;
    this.res = res;
    this.room = room;
    this.def = AMBIENCE[room];
    this.bus = bus;
    const def = this.def;
    this.planner = new AmbiencePlanner(def, mulberry32(seed), start);
    this.rng = mulberry32(seed ^ 0x5bd1e995);

    this.out = this.gain(0);
    this.out.connect(bus.dry);
    const send = this.gain(ROOM_SEND);
    this.out.connect(send);
    send.connect(bus.wet);

    // Hum: one periodic wave with the room's harmonics, twice, a fraction of a hertz apart.
    const hum = def.hum;
    const imag = new Float32Array(hum.harmonics.length + 1);
    hum.harmonics.forEach((a, i) => (imag[i + 1] = a));
    const wave = ctx.createPeriodicWave(new Float32Array(imag.length), imag);
    const humLp = this.biquad('lowpass', hum.cutoff, 0.7);
    const humGain = this.gain(hum.level);
    chain(humLp, humGain, this.out);
    for (const f of hum.beat > 0 ? [hum.freq, hum.freq + hum.beat] : [hum.freq]) {
      const o = this.track(ctx.createOscillator());
      o.setPeriodicWave(wave);
      o.frequency.value = f;
      this.start(o, humLp, start);
    }

    // One looping noise source feeds every noise bed and talker.
    if (def.noise.length > 0 || def.murmur) this.buildNoise(start);
  }

  get voiceCount(): number {
    let n = 1;
    for (const v of this.voices) if (!v.finished) n++;
    return n;
  }

  scheduleUntil(horizon: number, now: number): void {
    if (this.disposed) return;
    for (const e of this.planner.take(horizon)) {
      if (!this.fadingOut && e.time >= now - 0.05) this.play(e, Math.max(e.time, now));
    }
    const m = this.def.murmur;
    if (!m) return;
    for (const talker of this.talkers) {
      // Stalled timer: skip the syllables that were missed rather than play them all at once.
      if (talker.next < now - 1) talker.next = now;
      while (talker.next <= horizon) {
        const s = murmurStep(m, this.rng);
        const at = Math.max(talker.next, now);
        talker.gain.gain.setTargetAtTime(s.level, at, s.len * 0.3);
        talker.band.frequency.setTargetAtTime(talker.base * s.shift, at, s.len * 0.5);
        talker.next += s.len;
      }
    }
  }

  fadeIn(at: number, dur: number): void {
    this.fadingOut = false;
    this.disposeAt = Infinity;
    const g = this.out.gain;
    g.cancelScheduledValues(at);
    g.setTargetAtTime(this.def.level, at, Math.max(0.005, dur / 4));
  }

  fadeOut(at: number, dur: number): void {
    this.fadingOut = true;
    this.disposeAt = Math.min(this.disposeAt, at + dur + 0.3);
    const g = this.out.gain;
    g.cancelScheduledValues(at);
    g.setTargetAtTime(0, at, Math.max(0.005, dur / 4.5));
  }

  dispose(at: number): void {
    if (this.disposed) return;
    this.disposed = true;
    const g = this.out.gain;
    g.cancelScheduledValues(at);
    g.setTargetAtTime(0, at, 0.02);
    for (const v of this.voices) v.release(at);
    this.voices.length = 0;
    for (const s of this.sources) safeStop(s, at + 0.12);
    const last = this.sources[this.sources.length - 1];
    const cleanup = (): void => this.nodes.forEach(safeDisconnect);
    if (last) last.onended = cleanup;
    else cleanup();
  }

  private play(e: AmbientEvent, t: number): void {
    for (let i = this.voices.length - 1; i >= 0; i--) if (this.voices[i].finished) this.voices.splice(i, 1);
    if (this.voices.length >= AMBIENCE_LIMITS.maxEventVoices) this.voices.shift()?.release(t, 0.05);
    const v = new Voice(this.ctx, this.out, e.level, e.pan, this.bus.wet, e.wet);
    RECIPES[e.kind](v, this.res, t, e, this.rng);
    this.voices.push(v);
  }

  /** Noise beds (with their flutter) and the murmur's talkers, all fed by one looping source. */
  private buildNoise(start: number): void {
    const { ctx, def } = this;
    const src = this.track(ctx.createBufferSource());
    src.buffer = this.res.noise;
    src.loop = true;
    for (const b of def.noise) {
      const depth = b.flutter ? clamp01(b.flutter.depth) : 0;
      const g = this.gain(b.level * (1 - depth / 2));
      chain(src, this.biquad(b.filter, b.freq, b.q), g, this.out);
      if (b.flutter) {
        const lfoDepth = this.gain((b.level * depth) / 2);
        lfoDepth.connect(g.gain);
        const lfo = this.track(ctx.createOscillator());
        lfo.frequency.value = b.flutter.rate;
        this.start(lfo, lfoDepth, start);
      }
    }
    const m = def.murmur;
    if (m) {
      const murmurOut = this.gain(m.level);
      murmurOut.connect(this.out);
      for (const base of m.bands) {
        const g = this.gain(0);
        const band = this.biquad('bandpass', base, m.q);
        chain(src, band, g, murmurOut);
        this.talkers.push({ gain: g, band, base, next: start + between(this.rng, 0, m.step[1]) });
      }
    }
    // A random offset decorrelates it from every other use of the shared noise buffer.
    src.start(start, Math.random() * Math.max(0, this.res.noise.duration - 0.1));
    this.sources.push(src);
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

  private start(src: OscillatorNode, dest: AudioNode, at: number): void {
    src.connect(dest);
    src.start(at);
    this.sources.push(src);
  }
}

/**
 * Station ambience and the local radio, on the effects bus: a looping bed per room that
 * crossfades as the player moves between rooms, and faint bursts of radio chatter whose rate
 * follows how busy the system is. A short timer tops up events ahead of the audio clock (like the
 * music scheduler). Works on an OfflineAudioContext too: call `scheduleUntil` instead of `start()`.
 */
export class AmbiencePlayer {
  private readonly ctx: BaseAudioContext;
  private readonly res: Resources;
  private readonly out: BusInput;
  private readonly seed: number;
  private readonly radioRng: Rng;
  private beds: RoomBed[] = [];
  private spawned = 0;
  private radio = 0;
  private radioNext = Infinity;
  private radioVoice: Voice | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastWall = 0;

  constructor(ctx: BaseAudioContext, out: BusInput, seed = Math.floor(Math.random() * 2 ** 32)) {
    this.ctx = ctx;
    this.res = resources(ctx);
    this.out = out;
    this.seed = seed >>> 0;
    this.radioRng = mulberry32(this.seed ^ 0x27d4eb2f);
  }

  /** The room playing now (not fading out), if any. */
  get room(): AmbienceRoom | null {
    const last = this.beds[this.beds.length - 1];
    return last && !last.fadingOut && !last.disposed ? last.room : null;
  }

  get radioLevel(): number {
    return this.radio;
  }

  get running(): boolean {
    return this.timer !== null;
  }

  /** Room beds alive (the current one plus any still fading out). */
  get bedCount(): number {
    return this.beds.filter((b) => !b.disposed).length;
  }

  /** Beds plus event and radio voices ringing now. */
  get voiceCount(): number {
    let n = this.radioVoice && !this.radioVoice.finished ? 1 : 0;
    for (const b of this.beds) if (!b.disposed) n += b.voiceCount;
    return n;
  }

  /** Crossfades to a room's bed; null fades the ambience out (no-op if it is already playing). */
  setRoom(room: AmbienceRoom | null, at = this.ctx.currentTime): void {
    if (room === this.room) return;
    const revive = room ? this.beds.find((b) => b.room === room && !b.disposed) : undefined;
    for (const b of this.beds) if (b !== revive && !b.fadingOut && !b.disposed) b.fadeOut(at, FADE_OUT);
    if (!room) return;
    if (revive) {
      revive.fadeIn(at, FADE_IN);
      this.beds = [...this.beds.filter((b) => b !== revive), revive];
      return;
    }
    // Rapid room changes: at most two beds at once, the oldest goes outright.
    let alive = this.beds.filter((b) => !b.disposed);
    while (alive.length >= 2) {
      alive[0].dispose(at);
      alive = alive.slice(1);
    }
    const seed = ((this.seed ^ hashString(room)) + this.spawned++ * 7919) >>> 0;
    const bed = new RoomBed(this.ctx, this.res, room, this.out, seed, at + 0.02);
    bed.fadeIn(at + 0.02, FADE_IN);
    this.beds = [...alive, bed];
  }

  /** 0..1 busyness of the local radio: bursts come more often in busier systems, none below the threshold. */
  setRadio(level: number, at = this.ctx.currentTime): void {
    const x = clamp01(level);
    if (x === this.radio) return;
    const wasOn = this.radio >= RADIO.threshold;
    this.radio = x;
    if (x < RADIO.threshold) this.radioNext = Infinity;
    else if (!wasOn) this.radioNext = at + between(this.radioRng, RADIO.first[0], RADIO.first[1]);
  }

  /** Schedules every event up to `horizon` and retires beds whose fade-out has finished. */
  scheduleUntil(horizon: number): void {
    const now = this.ctx.currentTime;
    let reap = false;
    for (const b of this.beds) {
      if (!b.disposed && b.disposeAt <= now) b.dispose(now);
      if (b.disposed) reap = true;
      else b.scheduleUntil(horizon, now);
    }
    if (reap) this.beds = this.beds.filter((b) => !b.disposed);
    while (this.radioNext <= horizon) {
      const t = this.radioNext;
      if (t >= now - 0.05) this.playRadio(Math.max(t, now));
      this.radioNext = t + (radioGap(this.radio, this.radioRng) ?? Infinity);
    }
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
    for (const b of this.beds) b.dispose(now);
    this.beds = [];
    this.radioVoice?.release(now);
    this.radioVoice = null;
    this.radio = 0;
    this.radioNext = Infinity;
  }

  private playRadio(t: number): void {
    // One burst at a time: a new one cuts a lingering one short.
    if (this.radioVoice && !this.radioVoice.finished) this.radioVoice.release(t, 0.03);
    const b = radioBurst(this.radioRng);
    const v = new Voice(this.ctx, this.out.dry, RADIO.level, b.pan, this.out.wet, 0.15);
    playRadio(v, this.res, t, b);
    this.radioVoice = v;
  }

  private readonly tick = (): void => {
    if (this.ctx.state !== 'running') return;
    const wall = performance.now();
    const gap = (wall - this.lastWall) / 1000;
    this.lastWall = wall;
    // Throttled timers (background tabs, long frames): widen the window to bridge the gap.
    this.scheduleUntil(this.ctx.currentTime + Math.min(1.5, Math.max(AMBIENCE_LOOKAHEAD, gap * 1.5)));
  };
}
