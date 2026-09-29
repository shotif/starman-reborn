import type { SfxId, SfxOptions } from './types.ts';
import type { WaveName } from './moods.ts';
import { SFX_SPECS, VoiceLimiter } from './sfxSpecs.ts';
import { Voice, ahr, amp, chain, createPanner, filter, noise, osc, perc, resources, shaper, sweep } from './synth.ts';
import type { BusInput, Resources } from './synth.ts';
import { clamp, clamp01 } from './theory.ts';

/** What a recipe gets: its voice, start time, frequency scale `p` and time scale `s`. */
interface Kit {
  res: Resources;
  v: Voice;
  t: number;
  p: number;
  s: number;
}

type Recipe = (k: Kit) => void;

const at = (k: Kit, sec: number): number => k.t + sec * k.s;
const jitter = (amount: number): number => 1 + (Math.random() * 2 - 1) * amount;

/** Oscillator with an exponential glide f0 -> f1 and a percussive envelope. */
function tone(
  k: Kit,
  wave: WaveName,
  f0: number,
  f1: number,
  when: number,
  attack: number,
  decay: number,
  peak: number,
  glide = decay,
  dest: AudioNode = k.v.out,
): OscillatorNode {
  const start = at(k, when);
  const a = attack * k.s;
  const d = decay * k.s;
  const o = osc(k.v, k.res, wave, f0 * k.p, start, start + a + d + 0.02);
  if (f1 !== f0) sweep(o.frequency, f0 * k.p, f1 * k.p, start, glide * k.s);
  const g = amp(k.v);
  perc(g.gain, start, a, d, peak);
  chain(o, g, dest);
  return o;
}

/** Noise through a swept filter with a percussive envelope. */
function hiss(
  k: Kit,
  type: BiquadFilterType,
  f0: number,
  f1: number,
  q: number,
  when: number,
  attack: number,
  decay: number,
  peak: number,
  glide = decay,
  dest: AudioNode = k.v.out,
): BiquadFilterNode {
  const start = at(k, when);
  const a = attack * k.s;
  const d = decay * k.s;
  const n = noise(k.v, k.res, start, start + a + d + 0.02, clamp(k.p, 0.5, 2));
  const f = filter(k.v, type, f0 * k.p, q);
  if (f1 !== f0) sweep(f.frequency, f0 * k.p, f1 * k.p, start, glide * k.s);
  const g = amp(k.v);
  perc(g.gain, start, a, d, peak);
  chain(n, f, g, dest);
  return f;
}

/** Two-operator FM strike (bells, metal): the index decays faster than the level. */
function fm(
  k: Kit,
  freq: number,
  ratio: number,
  index: number,
  when: number,
  decay: number,
  peak: number,
  settle = 0.35,
  dest: AudioNode = k.v.out,
): void {
  const start = at(k, when);
  const d = decay * k.s;
  const fc = freq * k.p;
  const car = osc(k.v, k.res, 'sine', fc, start, start + d + 0.03);
  const mod = osc(k.v, k.res, 'sine', fc * ratio, start, start + d + 0.03);
  const dev = amp(k.v);
  sweep(dev.gain, index * fc * ratio, index * fc * ratio * 0.03 + 0.5, start, d * settle);
  chain(mod, dev, car.frequency);
  const g = amp(k.v);
  perc(g.gain, start, 0.002, d, peak);
  chain(car, g, dest);
}

/** Gated tone: attack, hold, short release. */
function beep(k: Kit, wave: WaveName, freq: number, when: number, len: number, peak: number, dest: AudioNode = k.v.out): void {
  const start = at(k, when);
  const hold = len * k.s;
  const o = osc(k.v, k.res, wave, freq * k.p, start, start + hold + 0.06);
  const g = amp(k.v);
  ahr(g.gain, start, 0.004, hold, 0.04, peak);
  chain(o, g, dest);
}

function lowpass(k: Kit, freq: number, q = 0.707, dest: AudioNode = k.v.out): BiquadFilterNode {
  const f = filter(k.v, 'lowpass', freq * k.p, q);
  f.connect(dest);
  return f;
}

function pan(k: Kit, value: number): AudioNode {
  const p = k.v.add(createPanner(k.v.ctx, value));
  p.connect(k.v.out);
  return p;
}

/** Pan sweep on a panner made by `pan` (no-op where StereoPannerNode is missing). */
function panSweep(node: AudioNode, from: number, to: number, start: number, dur: number): void {
  if (!('pan' in node)) return;
  const p = (node as StereoPannerNode).pan;
  p.setValueAtTime(from, start);
  p.linearRampToValueAtTime(to, start + dur);
}

/** Tremolo stage: a gain whose level wobbles at `rate` Hz between (1-depth) and 1. */
function tremolo(k: Kit, rate: number, depth: number, start: number, stop: number, dest: AudioNode = k.v.out): { node: GainNode; lfo: OscillatorNode } {
  const node = amp(k.v, 1 - depth / 2);
  node.connect(dest);
  const lfo = osc(k.v, k.res, 'sine', rate, start, stop);
  const amt = amp(k.v, depth / 2);
  chain(lfo, amt, node.gain);
  return { node, lfo };
}

const RECIPES: Record<SfxId, Recipe> = {
  'ui-click': (k) => {
    tone(k, 'sine', 2200, 1400, 0, 0.001, 0.035, 0.6, 0.03);
    hiss(k, 'highpass', 5000, 5000, 0.7, 0, 0.0005, 0.012, 0.25);
  },

  'ui-confirm': (k) => {
    tone(k, 'triangle', 660, 660, 0, 0.004, 0.12, 0.5);
    tone(k, 'triangle', 990, 990, 0.07, 0.004, 0.2, 0.5);
    tone(k, 'sine', 1980, 1980, 0.07, 0.002, 0.12, 0.12);
  },

  'ui-error': (k) => {
    const lp = lowpass(k, 1400);
    tone(k, 'square', 220, 208, 0, 0.004, 0.11, 0.35, 0.1, lp);
    tone(k, 'square', 185, 172, 0.12, 0.004, 0.16, 0.35, 0.15, lp);
  },

  laser: (k) => {
    const j = jitter(0.04);
    const lp = lowpass(k, 7000, 1.2);
    sweep(lp.frequency, 7000 * k.p, 1200 * k.p, k.t, 0.16 * k.s);
    tone(k, 'square', 1800 * j, 280 * j, 0, 0.002, 0.16, 0.42, 0.14, lp);
    tone(k, 'sine', 900 * j, 140 * j, 0, 0.002, 0.12, 0.4, 0.1);
  },

  'laser-mk2': (k) => {
    const j = jitter(0.03);
    const lp = lowpass(k, 6000, 2);
    sweep(lp.frequency, 6000 * k.p, 700 * k.p, k.t, 0.25 * k.s);
    tone(k, 'sawtooth', 1300 * j, 190 * j, 0, 0.002, 0.26, 0.32, 0.2, lp);
    tone(k, 'sawtooth', 1313 * j, 192 * j, 0, 0.002, 0.26, 0.28, 0.2, lp);
    tone(k, 'sine', 420 * j, 60 * j, 0, 0.002, 0.24, 0.55, 0.18);
    hiss(k, 'bandpass', 3500, 1200, 1.5, 0, 0.001, 0.07, 0.25);
  },

  'laser-enemy': (k) => {
    const j = jitter(0.05);
    const lp = lowpass(k, 2600, 1.4);
    sweep(lp.frequency, 2600 * k.p, 600 * k.p, k.t, 0.2 * k.s);
    const grit = shaper(k.v, k.res);
    grit.connect(lp);
    tone(k, 'sawtooth', 700 * j, 120 * j, 0, 0.003, 0.22, 0.5, 0.2, grit);
    tone(k, 'square', 350 * j, 60 * j, 0, 0.003, 0.2, 0.3, 0.2, grit);
  },

  'missile-launch': (k) => {
    tone(k, 'sine', 140, 45, 0, 0.002, 0.25, 0.7, 0.2);
    hiss(k, 'highpass', 2500, 2500, 0.8, 0, 0.001, 0.09, 0.35);
    hiss(k, 'bandpass', 400, 2600, 1.1, 0.02, 0.12, 1.5, 0.6, 1);
    tone(k, 'sawtooth', 110, 330, 0.03, 0.08, 1.3, 0.07, 1, lowpass(k, 1400));
  },

  'missile-lock': (k) => {
    const lp = lowpass(k, 3500);
    for (let i = 0; i < 3; i++) {
      beep(k, 'square', 1400, i * 0.13, 0.055, 0.22, lp);
      beep(k, 'sine', 2800, i * 0.13, 0.055, 0.08);
    }
  },

  'hit-shield': (k) => {
    const j = jitter(0.06);
    fm(k, 1300 * j, 2.41, 3, 0, 0.32, 0.28, 0.3);
    hiss(k, 'bandpass', 5000, 2500, 3, 0, 0.001, 0.3, 0.3);
    tone(k, 'sawtooth', 2400 * j, 900 * j, 0, 0.001, 0.1, 0.1, 0.1, lowpass(k, 5000));
  },

  'hit-hull': (k) => {
    const j = jitter(0.06);
    tone(k, 'sine', 150 * j, 55, 0, 0.002, 0.22, 0.8, 0.15);
    fm(k, 380 * j, 1.43, 2.5, 0, 0.3, 0.25, 0.25);
    hiss(k, 'lowpass', 2500, 600, 0.7, 0, 0.001, 0.06, 0.4);
  },

  'player-hit-shield': (k) => {
    tone(k, 'sine', 95, 40, 0, 0.003, 0.35, 0.8, 0.25);
    fm(k, 700, 2.41, 3.5, 0, 0.5, 0.3, 0.3);
    hiss(k, 'bandpass', 2800, 900, 2.5, 0, 0.002, 0.5, 0.35);
    tone(k, 'triangle', 900, 480, 0, 0.004, 0.45, 0.18, 0.4);
  },

  'player-hit-hull': (k) => {
    const crunch = shaper(k.v, k.res);
    crunch.connect(lowpass(k, 3000));
    tone(k, 'sine', 110, 36, 0, 0.002, 0.45, 0.9, 0.3);
    hiss(k, 'bandpass', 1100, 400, 1.2, 0, 0.001, 0.25, 0.7, 0.25, crunch);
    fm(k, 220, 1.37, 3, 0, 0.6, 0.3, 0.2);
    hiss(k, 'lowpass', 900, 200, 0.7, 0.05, 0.01, 0.5, 0.25);
  },

  'shield-down': (k) => {
    // A falling, wobbling warning tone that holds through the drop, then fades.
    const start = at(k, 0);
    const end = start + 1.15 * k.s;
    const lp = lowpass(k, 2600);
    const trem = tremolo(k, 11, 0.7, start, end, lp);
    const env = amp(k.v);
    ahr(env.gain, start, 0.01, 0.65 * k.s, 0.45 * k.s, 1);
    env.connect(trem.node);
    for (const [wave, f0, f1, lvl] of [['triangle', 1046, 262, 0.5], ['sine', 523, 131, 0.3]] as const) {
      const o = osc(k.v, k.res, wave, f0 * k.p, start, end);
      sweep(o.frequency, f0 * k.p, f1 * k.p, start, 0.9 * k.s);
      chain(o, amp(k.v, lvl), env);
    }
    hiss(k, 'bandpass', 3000, 400, 2, 0, 0.005, 0.8, 0.12);
  },

  'explosion-small': (k) => {
    const j = jitter(0.08);
    tone(k, 'sine', 95 * j, 32, 0, 0.002, 0.7, 0.9, 0.4);
    hiss(k, 'lowpass', 3200 * j, 280, 0.8, 0, 0.002, 1.2, 0.8, 0.8);
    hiss(k, 'bandpass', 1800, 500, 1.2, 0.02, 0.003, 0.45, 0.35);
  },

  'explosion-large': (k) => {
    tone(k, 'sine', 75, 26, 0, 0.003, 1.6, 1, 0.9);
    tone(k, 'triangle', 120, 38, 0, 0.003, 0.9, 0.35, 0.6);
    // Two decorrelated blasts panned apart give the blast width; a low rumble carries the tail.
    hiss(k, 'lowpass', 2400, 140, 0.9, 0, 0.004, 3, 0.6, 2.2, pan(k, -0.45));
    hiss(k, 'lowpass', 2200, 150, 0.9, 0.01, 0.004, 3, 0.6, 2.2, pan(k, 0.45));
    hiss(k, 'lowpass', 320, 120, 0.7, 0.05, 0.25, 4.2, 1.6, 3);
    hiss(k, 'bandpass', 700, 250, 1, 0.12, 0.01, 1.4, 0.35);
    hiss(k, 'highpass', 3000, 1500, 0.7, 0.15, 0.002, 0.25, 0.25);
    hiss(k, 'highpass', 2600, 1200, 0.7, 0.38, 0.002, 0.2, 0.18);
  },

  'boost-start': (k) => {
    tone(k, 'sine', 160, 60, 0, 0.002, 0.2, 0.6, 0.15);
    const lp = lowpass(k, 250, 1.5);
    sweep(lp.frequency, 250 * k.p, 2000 * k.p, k.t, 0.35 * k.s);
    tone(k, 'sawtooth', 65, 140, 0, 0.03, 0.75, 0.35, 0.4, lp);
    tone(k, 'sawtooth', 66, 141, 0, 0.03, 0.75, 0.3, 0.4, lp);
    hiss(k, 'bandpass', 300, 1500, 0.9, 0, 0.05, 0.7, 0.5, 0.35);
  },

  'cruise-charge': (k) => {
    const start = at(k, 0);
    const rise = 1.5 * k.s;
    const end = start + rise + 0.3 * k.s;
    // Vibrato that speeds up as the charge builds.
    const vib = osc(k.v, k.res, 'sine', 4, start, end);
    sweep(vib.frequency, 4, 14, start, rise);
    const vibAmt = amp(k.v, 12);
    vib.connect(vibAmt);
    const g = amp(k.v);
    ahr(g.gain, start, rise, 0.05 * k.s, 0.25 * k.s, 0.35);
    g.connect(k.v.out);
    for (const [wave, mul, lvl] of [['triangle', 1, 1], ['sine', 1.5, 0.45]] as const) {
      const o = osc(k.v, k.res, wave, 220 * mul * k.p, start, end);
      sweep(o.frequency, 220 * mul * k.p, 1320 * mul * k.p, start, 1.7 * k.s);
      vibAmt.connect(o.detune);
      chain(o, amp(k.v, lvl), g);
    }
    const n = noise(k.v, k.res, start, end);
    const bp = filter(k.v, 'bandpass', 800 * k.p, 2);
    sweep(bp.frequency, 800 * k.p, 4000 * k.p, start, 1.7 * k.s);
    const ng = amp(k.v);
    ahr(ng.gain, start, rise, 0.05 * k.s, 0.25 * k.s, 0.2);
    chain(n, bp, ng, k.v.out);
  },

  'cruise-engage': (k) => {
    tone(k, 'sine', 190, 48, 0, 0.003, 0.5, 0.85, 0.25);
    hiss(k, 'lowpass', 5000, 350, 0.8, 0, 0.003, 0.6, 0.55, 0.45);
    tone(k, 'sine', 1320, 1320, 0.02, 0.005, 0.7, 0.12);
    tone(k, 'sine', 1980, 1980, 0.02, 0.005, 0.6, 0.08);
  },

  'cruise-exit': (k) => {
    hiss(k, 'bandpass', 3200, 500, 1.2, 0, 0.08, 0.55, 0.4, 0.5);
    tone(k, 'triangle', 900, 240, 0, 0.02, 0.55, 0.25, 0.5);
    tone(k, 'sine', 120, 50, 0.4, 0.004, 0.25, 0.4, 0.2);
  },

  'lane-enter': (k) => {
    const p = pan(k, -0.7);
    panSweep(p, -0.7, 0.7, at(k, 0), 1.2 * k.s);
    hiss(k, 'bandpass', 500, 5000, 3, 0, 0.3, 1, 0.6, 1.1, p);
    tone(k, 'sine', 523, 1046, 0.05, 0.25, 1, 0.15, 1);
    tone(k, 'sine', 784, 1568, 0.05, 0.25, 1, 0.1, 1);
  },

  'lane-exit': (k) => {
    const p = pan(k, 0.7);
    panSweep(p, 0.7, -0.7, at(k, 0), 1 * k.s);
    hiss(k, 'bandpass', 5000, 450, 3, 0, 0.05, 1, 0.55, 1, p);
    tone(k, 'sine', 1046, 523, 0, 0.05, 0.9, 0.14, 0.9);
    tone(k, 'sine', 1568, 784, 0, 0.05, 0.9, 0.09, 0.9);
    tone(k, 'sine', 110, 50, 0.85, 0.004, 0.3, 0.35, 0.2);
  },

  'dock-clamp': (k) => {
    tone(k, 'sine', 110, 48, 0, 0.002, 0.25, 0.8, 0.15);
    fm(k, 180, 1.41, 3, 0, 0.3, 0.35, 0.2);
    hiss(k, 'lowpass', 1800, 400, 0.8, 0, 0.001, 0.08, 0.4);
    tone(k, 'sine', 95, 45, 0.14, 0.002, 0.2, 0.5, 0.12);
    fm(k, 150, 1.41, 2.5, 0.14, 0.25, 0.25, 0.2);
    hiss(k, 'highpass', 3500, 2200, 0.8, 0.28, 0.02, 0.95, 0.2, 0.9);
  },

  undock: (k) => {
    hiss(k, 'highpass', 2200, 3800, 0.8, 0, 0.06, 0.55, 0.2);
    fm(k, 160, 1.41, 2.5, 0.42, 0.28, 0.3, 0.2);
    tone(k, 'sine', 100, 50, 0.42, 0.002, 0.22, 0.6, 0.12);
    tone(k, 'sawtooth', 55, 110, 0.45, 0.2, 0.8, 0.18, 0.7, lowpass(k, 600));
  },

  'jump-charge': (k) => {
    const start = at(k, 0);
    const rise = 2.2 * k.s;
    const end = start + rise + 0.3 * k.s;
    const lp = lowpass(k, 600, 1.2);
    sweep(lp.frequency, 600 * k.p, 8000 * k.p, start, rise);
    const trem = tremolo(k, 3, 0.8, start, end, lp);
    sweep(trem.lfo.frequency, 3, 18, start, rise);
    const g = amp(k.v);
    ahr(g.gain, start, rise, 0.05 * k.s, 0.2 * k.s, 1);
    g.connect(trem.node);
    for (const [wave, mul, lvl] of [['sine', 1, 0.3], ['triangle', 1.5, 0.15], ['sine', 2.004, 0.12]] as const) {
      const o = osc(k.v, k.res, wave, 110 * mul * k.p, start, end);
      sweep(o.frequency, 110 * mul * k.p, 880 * mul * k.p, start, 2.35 * k.s);
      chain(o, amp(k.v, lvl), g);
    }
    const n = noise(k.v, k.res, start, end);
    const bp = filter(k.v, 'bandpass', 200 * k.p, 1.5);
    sweep(bp.frequency, 200 * k.p, 6000 * k.p, start, rise);
    const ng = amp(k.v);
    ahr(ng.gain, start, rise, 0.05 * k.s, 0.2 * k.s, 0.2);
    chain(n, bp, ng, k.v.out);
  },

  'jump-exit': (k) => {
    const lp = lowpass(k, 6000);
    sweep(lp.frequency, 6000 * k.p, 1200 * k.p, k.t, 1.4 * k.s);
    const chord: [WaveName, number][] = [['triangle', 262], ['sine', 392], ['triangle', 523], ['sine', 587], ['sine', 784]];
    chord.forEach(([wave, f], i) => tone(k, wave, f, f, i * 0.012, 0.05, 2.4, 0.12, 2.4, lp));
    tone(k, 'sine', 70, 32, 0, 0.004, 1.1, 0.7, 0.9);
    hiss(k, 'lowpass', 7000, 600, 0.7, 0, 0.02, 1.8, 0.45, 1.4);
  },

  pickup: (k) => {
    tone(k, 'triangle', 880, 880, 0, 0.003, 0.12, 0.45);
    tone(k, 'triangle', 1320, 1320, 0.06, 0.003, 0.2, 0.45);
    fm(k, 2640, 2, 0.5, 0.06, 0.2, 0.12);
  },

  alert: (k) => {
    const lp = lowpass(k, 2200);
    [660, 880, 660, 880].forEach((f, i) => {
      beep(k, 'square', f, i * 0.22, 0.17, 0.2, lp);
      beep(k, 'sine', f, i * 0.22, 0.17, 0.2);
    });
  },

  scan: (k) => {
    const start = at(k, 0);
    const bp = filter(k.v, 'bandpass', 300 * k.p, 10);
    sweep(bp.frequency, 300 * k.p, 4000 * k.p, start, 0.7 * k.s);
    bp.connect(k.v.out);
    tone(k, 'sawtooth', 110, 110, 0, 0.05, 0.75, 0.4, 0.75, bp);
    tone(k, 'sine', 400, 2400, 0, 0.05, 0.7, 0.05, 0.7);
    fm(k, 1800, 1, 0.8, 0.72, 0.4, 0.2);
  },

  credits: (k) => {
    fm(k, 1047, 2, 0.8, 0, 0.45, 0.25);
    fm(k, 1319, 2, 0.8, 0.035, 0.45, 0.22);
    fm(k, 1568, 2, 0.8, 0.07, 0.55, 0.22);
    hiss(k, 'highpass', 6000, 6000, 0.7, 0, 0.001, 0.03, 0.15);
  },

  'mission-complete': (k) => {
    // Original rising figure resolving onto a held high E over an A add9 swell.
    const motif: [number, number, number][] = [[659, 0, 0.35], [880, 0.14, 0.35], [1109, 0.28, 0.4], [988, 0.5, 0.45], [1319, 0.7, 1.2]];
    const lead = lowpass(k, 5000);
    for (const [f, when, decay] of motif) tone(k, 'triangle', f, f, when, 0.005, decay, 0.3, decay, lead);
    fm(k, 1319, 2, 0.6, 0.7, 1.1, 0.12);
    const pad = lowpass(k, 1800);
    const start = at(k, 0.5);
    for (const f of [220, 330, 494, 554]) {
      const o = osc(k.v, k.res, 'triangle', f * k.p, start, start + 1.7 * k.s);
      const g = amp(k.v);
      ahr(g.gain, start, 0.3 * k.s, 0.4 * k.s, 0.9 * k.s, 0.08);
      chain(o, g, pad);
    }
  },

  repair: (k) => {
    const start = at(k, 0);
    const bp = filter(k.v, 'bandpass', 1200 * k.p, 1.5);
    bp.connect(k.v.out);
    const g = amp(k.v);
    ahr(g.gain, start, 0.05 * k.s, 0.85 * k.s, 0.25 * k.s, 0.35);
    g.connect(bp);
    const end = start + 1.2 * k.s;
    for (const [wave, mul, lvl] of [['sawtooth', 1, 1], ['square', 1.5, 0.3]] as const) {
      const o = osc(k.v, k.res, wave, 180 * mul * k.p, start, end);
      const f = o.frequency;
      // Two servo moves, each a quick glide and settle.
      const steps: [number, number][] = [[0.25, 320], [0.45, 240], [0.75, 360], [1, 300]];
      f.setValueAtTime(180 * mul * k.p, start);
      for (const [when, hz] of steps) f.linearRampToValueAtTime(hz * mul * k.p, start + when * k.s);
      chain(o, amp(k.v, lvl), g);
    }
    for (let i = 0; i < 6; i++) hiss(k, 'highpass', 4000, 4000, 0.7, 0.05 + i * 0.06, 0.0005, 0.012, 0.25);
    tone(k, 'sine', 1760, 1760, 1, 0.003, 0.12, 0.15);
  },

  'target-lock': (k) => {
    const lp = lowpass(k, 4000);
    beep(k, 'square', 1200, 0, 0.04, 0.22, lp);
    beep(k, 'square', 1800, 0.06, 0.09, 0.22, lp);
    tone(k, 'sine', 3600, 3600, 0.06, 0.002, 0.12, 0.08);
    hiss(k, 'highpass', 5000, 5000, 0.7, 0, 0.0005, 0.01, 0.2);
  },
};

/** Plays synthesized one-shots with voice limiting, per-sound rate limits, pan and pitch. */
export class SfxPlayer {
  private readonly ctx: BaseAudioContext;
  private readonly res: Resources;
  private readonly out: BusInput;
  private readonly limiter = new VoiceLimiter();
  private readonly voices = new Map<number, Voice>();

  constructor(ctx: BaseAudioContext, out: BusInput) {
    this.ctx = ctx;
    this.res = resources(ctx);
    this.out = out;
  }

  get activeVoices(): number {
    return this.voices.size;
  }

  /** Returns false when the sound was skipped (muted volume, rate limit or voice cap). */
  play(id: SfxId, opts: SfxOptions = {}, when?: number): boolean {
    const spec = SFX_SPECS[id];
    const recipe = RECIPES[id];
    if (!spec || !recipe) return false;
    const volume = opts.volume === undefined ? 1 : clamp01(opts.volume);
    if (volume <= 0.001) return false;
    const rawPitch = opts.pitch ?? 1;
    const pitch = Number.isFinite(rawPitch) && rawPitch > 0 ? clamp(rawPitch, 0.25, 4) : 1;
    const rawPan = opts.pan ?? 0;
    const panValue = Number.isFinite(rawPan) ? clamp(rawPan, -1, 1) : 0;
    const scale = clamp(1 / pitch, 0.5, 2);
    const now = when ?? this.ctx.currentTime;
    const grant = this.limiter.request(id, now, spec, scale);
    if (!grant) return false;
    for (const key of grant.steal) {
      this.voices.get(key)?.release(now);
      this.voices.delete(key);
    }
    const v = new Voice(this.ctx, this.out.dry, spec.gain * volume * grant.gain, panValue, this.out.wet, spec.wet);
    recipe({ res: this.res, v, t: now + 0.003, p: pitch, s: scale });
    this.voices.set(grant.key, v);
    v.onDone = () => {
      this.voices.delete(grant.key);
      this.limiter.release(grant.key);
    };
    return true;
  }

  stopAll(): void {
    const now = this.ctx.currentTime;
    for (const v of this.voices.values()) v.release(now);
    this.voices.clear();
    this.limiter.clear();
  }
}
