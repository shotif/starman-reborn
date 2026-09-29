import { describe, expect, it } from 'vitest';
import type { EngineSoundState, MusicMood, SfxId } from '../../src/audio/types.ts';
import { AudioEngine } from '../../src/audio/AudioEngine.ts';
import { Composer, combatBar, swingBeat } from '../../src/audio/composer.ts';
import type { BarPlan } from '../../src/audio/composer.ts';
import { safetyCurve, softClipCurve, waveHarmonics, whiteNoise } from '../../src/audio/dsp.ts';
import { ENGINE_PARAMS, changedParams, engineTargets, meaningfulChange } from '../../src/audio/engineParams.ts';
import { EngineSound } from '../../src/audio/engineSound.ts';
import { MixGraph } from '../../src/audio/graph.ts';
import { MOODS, MUSIC_MOODS, combatTempoMultiplier } from '../../src/audio/moods.ts';
import { MAX_LAYER_VOICES, MusicPlayer } from '../../src/audio/music.ts';
import { generateImpulse } from '../../src/audio/reverb.ts';
import { SfxPlayer } from '../../src/audio/sfx.ts';
import { MAX_SFX_VOICES, SFX_IDS, SFX_SPECS, VoiceLimiter } from '../../src/audio/sfxSpecs.ts';
import type { SfxSpec } from '../../src/audio/sfxSpecs.ts';
import type { BusInput } from '../../src/audio/synth.ts';
import {
  SCALES,
  degreeToMidi,
  freqToMidi,
  hashString,
  inScale,
  midiToFreq,
  mulberry32,
  nearestDegree,
  notesInRange,
  pitchClass,
  voiceLead,
  volumeToGain,
  weightedIndex,
} from '../../src/audio/theory.ts';

const ALL_MOODS: MusicMood[] = ['title', 'docked', 'map', 'sol', 'alpha-centauri', 'barnard', 'sirius', 'epsilon-eridani'];

const ALL_SFX: SfxId[] = [
  'ui-click', 'ui-confirm', 'ui-error', 'laser', 'laser-mk2', 'laser-enemy', 'missile-launch', 'missile-lock',
  'hit-shield', 'hit-hull', 'player-hit-shield', 'player-hit-hull', 'shield-down', 'explosion-small',
  'explosion-large', 'boost-start', 'cruise-charge', 'cruise-engage', 'cruise-exit', 'lane-enter', 'lane-exit',
  'dock-clamp', 'undock', 'jump-charge', 'jump-exit', 'pickup', 'alert', 'scan', 'credits', 'mission-complete',
  'repair', 'target-lock',
];

function bars(mood: MusicMood, seed: number, count: number): BarPlan[] {
  const c = new Composer(MOODS[mood], seed);
  return Array.from({ length: count }, () => c.nextBar());
}

describe('music theory helpers', () => {
  it('converts MIDI notes and frequencies with A4 = 440 Hz', () => {
    expect(midiToFreq(69)).toBe(440);
    expect(midiToFreq(81)).toBeCloseTo(880, 9);
    expect(midiToFreq(60)).toBeCloseTo(261.6256, 3);
    expect(freqToMidi(midiToFreq(47.3))).toBeCloseTo(47.3, 9);
  });

  it('maps volume sliders through a clamped perceptual curve', () => {
    expect(volumeToGain(0)).toBe(0);
    expect(volumeToGain(1)).toBe(1);
    expect(volumeToGain(0.5)).toBeCloseTo(0.25, 9);
    expect(volumeToGain(-1)).toBe(0);
    expect(volumeToGain(3)).toBe(1);
    expect(volumeToGain(Number.NaN)).toBe(0);
    for (let v = 0; v < 1; v += 0.05) expect(volumeToGain(v + 0.05)).toBeGreaterThan(volumeToGain(v));
  });

  it('generates deterministic, well-spread random numbers', () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    const c = mulberry32(43);
    const seqA = Array.from({ length: 100 }, a);
    expect(Array.from({ length: 100 }, b)).toEqual(seqA);
    expect(Array.from({ length: 100 }, c)).not.toEqual(seqA);
    const r = mulberry32(7);
    let sum = 0;
    for (let i = 0; i < 10000; i++) {
      const x = r();
      expect(x >= 0 && x < 1).toBe(true);
      sum += x;
    }
    expect(sum / 10000).toBeCloseTo(0.5, 1);
    expect(new Set(ALL_MOODS.map(hashString)).size).toBe(ALL_MOODS.length);
  });

  it('never picks zero-weight options', () => {
    const r = mulberry32(3);
    const counts = [0, 0, 0];
    for (let i = 0; i < 3000; i++) counts[weightedIndex(r, [1, 0, 3])]++;
    expect(counts[1]).toBe(0);
    expect(counts[2]).toBeGreaterThan(counts[0] * 2);
  });

  it('maps scale degrees to MIDI and back', () => {
    expect(degreeToMidi(60, SCALES.major, 7)).toBe(72);
    expect(degreeToMidi(60, SCALES.major, -1)).toBe(59);
    expect(degreeToMidi(57, SCALES.aeolian, 2)).toBe(60);
    for (let d = -10; d <= 20; d++) expect(nearestDegree(60, SCALES.lydian, degreeToMidi(60, SCALES.lydian, d))).toBe(d);
    expect(notesInRange(60, [0, 4, 7], 60, 72)).toEqual([60, 64, 67, 72]);
    expect(inScale(62, SCALES.major, 61)).toBe(true);
    expect(inScale(62, SCALES.major, 63)).toBe(false);
  });

  it('voice-leads chords smoothly within the register', () => {
    const cmaj = voiceLead(null, 60, [4, 7, 0], 3, 55, 72);
    expect(cmaj).toHaveLength(3);
    expect(new Set(cmaj.map((n) => pitchClass(n - 60)))).toEqual(new Set([0, 4, 7]));
    const amin = voiceLead(cmaj, 60, [0, 4, 9], 3, 55, 72);
    for (let i = 0; i < 3; i++) expect(Math.abs(amin[i] - cmaj[i])).toBeLessThanOrEqual(2);
    for (const n of amin) {
      expect(n).toBeGreaterThanOrEqual(55);
      expect(n).toBeLessThanOrEqual(72);
    }
    expect(amin.slice().sort((x, y) => x - y)).toEqual(amin);
  });
});

describe('mood definitions', () => {
  it('defines every mood exactly once', () => {
    expect(MUSIC_MOODS.slice().sort()).toEqual(ALL_MOODS.slice().sort());
    for (const mood of ALL_MOODS) expect(MOODS[mood].id).toBe(mood);
  });

  it('keeps tempos, keys, scales and registers sane', () => {
    for (const def of Object.values(MOODS)) {
      expect(def.tempo).toBeGreaterThanOrEqual(40);
      expect(def.tempo).toBeLessThanOrEqual(140);
      expect([3, 4]).toContain(def.beatsPerBar);
      expect(def.key).toBeGreaterThanOrEqual(36);
      expect(def.key).toBeLessThanOrEqual(72);
      expect(def.scale[0]).toBe(0);
      expect(def.scale).toHaveLength(7);
      expect(def.pad.high - def.pad.low).toBeGreaterThanOrEqual(12);
      for (const part of [def.melody, def.sparkle, def.comp]) if (part) expect(part.high - part.low).toBeGreaterThanOrEqual(12);
      for (const p of [def.pulse, def.ticks]) if (p) for (const pat of p.patterns) expect(pat).toHaveLength(def.beatsPerBar * 4);
    }
  });

  it('uses chords that fit their scales and form a connected progression graph', () => {
    for (const def of Object.values(MOODS)) {
      def.chords.forEach((chord, i) => {
        const scale = chord.scale ?? def.scale;
        for (const pc of chord.pcs) expect(scale).toContain(pitchClass(pc));
        expect(chord.next.length).toBeGreaterThan(0);
        for (const n of chord.next) {
          expect(n).not.toBe(i);
          expect(n >= 0 && n < def.chords.length).toBe(true);
        }
      });
      const seen = new Set([0]);
      const stack = [0];
      while (stack.length > 0) {
        for (const n of def.chords[stack.pop() ?? 0].next) {
          if (!seen.has(n)) {
            seen.add(n);
            stack.push(n);
          }
        }
      }
      expect(seen.size).toBe(def.chords.length);
    }
  });

  it('stays within the phone voice budget and a combat-friendly tempo', () => {
    for (const def of Object.values(MOODS)) {
      expect(def.pad.voices).toBeGreaterThanOrEqual(3);
      expect(def.pad.voices + 1 + MAX_LAYER_VOICES).toBeLessThanOrEqual(12);
      const bpm = def.tempo * combatTempoMultiplier(def.tempo);
      expect(bpm).toBeGreaterThanOrEqual(95);
      expect(bpm).toBeLessThanOrEqual(150);
    }
  });
});

describe('generative composer', () => {
  it('is deterministic for a seed and varies across seeds', () => {
    for (const mood of ALL_MOODS) {
      expect(bars(mood, 99, 48)).toEqual(bars(mood, 99, 48));
      expect(JSON.stringify(bars(mood, 1, 48))).not.toBe(JSON.stringify(bars(mood, 2, 48)));
    }
  });

  it('keeps every note in range, in key and inside its bar', () => {
    for (const mood of ALL_MOODS) {
      const def = MOODS[mood];
      for (const plan of bars(mood, 5, 128)) {
        const chord = def.chords[plan.chord];
        expect(plan.pad).toHaveLength(def.pad.voices);
        for (const n of plan.pad) {
          expect(n).toBeGreaterThanOrEqual(def.pad.low);
          expect(n).toBeLessThanOrEqual(def.pad.high);
          expect(chord.pcs.map(pitchClass)).toContain(pitchClass(n - def.key));
        }
        expect(plan.brightness >= 0 && plan.brightness <= 1).toBe(true);
        expect(plan.events.length).toBeLessThanOrEqual(40);
        let last = -1;
        for (const e of plan.events) {
          expect(e.beat).toBeGreaterThanOrEqual(0);
          expect(e.beat).toBeLessThan(def.beatsPerBar);
          expect(e.beat).toBeGreaterThanOrEqual(last);
          last = e.beat;
          expect(e.vel > 0 && e.vel <= 1).toBe(true);
          expect(Math.abs(e.pan)).toBeLessThanOrEqual(1);
          const part = e.part === 'melody' ? def.melody : e.part === 'sparkle' ? def.sparkle : e.part === 'comp' ? def.comp : null;
          if (part) {
            expect(e.midi).toBeGreaterThanOrEqual(part.low);
            expect(e.midi).toBeLessThanOrEqual(part.high);
          }
          if (e.part === 'melody') expect(inScale(def.key, chord.scale ?? def.scale, e.midi)).toBe(true);
        }
      }
    }
  });

  it('moves pad voices smoothly on chord changes', () => {
    for (const mood of ALL_MOODS) {
      const plans = bars(mood, 11, 96);
      let moves = 0;
      let total = 0;
      for (let i = 1; i < plans.length; i++) {
        if (!plans[i].chordChanged) continue;
        plans[i].pad.forEach((n, v) => {
          total += Math.abs(n - plans[i - 1].pad[v]);
          moves++;
        });
      }
      expect(moves).toBeGreaterThan(0);
      expect(total / moves).toBeLessThanOrEqual(3);
    }
  });

  it('does not settle into an obvious loop', () => {
    for (const mood of ALL_MOODS) {
      const plans = bars(mood, 21, 64);
      const chords = plans.map((p) => p.chord).join(',');
      for (const period of [2, 4, 8]) {
        const shifted = plans.slice(period).map((p) => p.chord).join(',');
        expect(chords.startsWith(shifted)).toBe(false);
      }
      const withNotes = plans.filter((p) => p.events.length > 0);
      const unique = new Set(withNotes.map((p) => JSON.stringify(p.events.map((e) => [e.part, e.midi, e.beat.toFixed(2)]))));
      expect(unique.size).toBeGreaterThan(withNotes.length * 0.5);
    }
  });

  it('gives sparse moods fewer notes than busy ones', () => {
    const density = (mood: MusicMood): number => bars(mood, 8, 64).reduce((n, p) => n + p.events.length, 0) / 64;
    expect(density('barnard')).toBeLessThan(density('sirius'));
    expect(density('map')).toBeLessThan(density('epsilon-eridani'));
  });

  it('swings only off-beats', () => {
    expect(swingBeat(1, 0.5)).toBe(1);
    expect(swingBeat(1.5, 0.6)).toBeCloseTo(1.6, 9);
    expect(swingBeat(2.25, 0.6)).toBeCloseTo(2.3, 9);
    expect(swingBeat(1.5, 0)).toBe(1.5);
  });
});

describe('combat layer patterns', () => {
  const hits = (x: number): number =>
    combatBar(x, mulberry32(1), 1).reduce((n, s) => n + (s.pulse > 0 ? 1 : 0) + (s.hat > 0 ? 1 : 0) + (s.kick > 0 ? 1 : 0) + (s.stab > 0 ? 1 : 0), 0);

  it('is silent at zero and 16 steps long', () => {
    const bar = combatBar(0, mulberry32(1), 0);
    expect(bar).toHaveLength(16);
    expect(hits(0)).toBe(0);
  });

  it('gets busier as intensity rises', () => {
    expect(hits(0.2)).toBeGreaterThan(0);
    expect(hits(0.6)).toBeGreaterThan(hits(0.2));
    expect(hits(1)).toBeGreaterThan(hits(0.6));
    expect(combatBar(0.2, mulberry32(2), 0).some((s) => s.hat > 0 || s.kick > 0)).toBe(false);
    expect(combatBar(1, mulberry32(2), 1).some((s) => s.stab > 0)).toBe(true);
  });
});

describe('sound effect specs and voice limiting', () => {
  it('covers every SfxId with sane levels and lengths', () => {
    expect(SFX_IDS.slice().sort()).toEqual(ALL_SFX.slice().sort());
    const long: Partial<Record<SfxId, number>> = {
      'explosion-large': 2.6,
      'cruise-charge': 1.9,
      'jump-charge': 2.6,
      'jump-exit': 2,
      'mission-complete': 2.1,
    };
    for (const id of ALL_SFX) {
      const s = SFX_SPECS[id];
      expect(s.dur).toBeLessThanOrEqual(long[id] ?? 1.5);
      expect(s.gain > 0 && s.gain <= 1).toBe(true);
      expect(s.maxInst).toBeGreaterThanOrEqual(1);
      expect(s.wet >= 0 && s.wet <= 1).toBe(true);
    }
  });

  const open: SfxSpec = { dur: 5, gain: 1, minGap: 0, maxInst: 100, prio: 1, wet: 0 };

  it('caps simultaneous voices and steals the oldest', () => {
    const lim = new VoiceLimiter();
    const keys: number[] = [];
    for (let i = 0; i < MAX_SFX_VOICES; i++) {
      const g = lim.request('laser', i * 0.01, open);
      expect(g?.steal).toEqual([]);
      keys.push(g?.key ?? -1);
    }
    const g = lim.request('laser', 0.5, open);
    expect(g?.steal).toEqual([keys[0]]);
    expect(lim.count).toBe(MAX_SFX_VOICES);
  });

  it('never steals a higher-priority voice', () => {
    const lim = new VoiceLimiter(4);
    for (let i = 0; i < 4; i++) lim.request('alert', i, { ...open, prio: 5 });
    expect(lim.request('ui-click', 4.5, { ...open, prio: 1 })).toBeNull();
    expect(lim.request('explosion-large', 4.6, { ...open, prio: 5 })).not.toBeNull();
  });

  it('rate-limits rapid repeats of one sound and trims their gain', () => {
    const lim = new VoiceLimiter();
    const spec = SFX_SPECS.laser;
    expect(lim.request('laser', 0, spec)).not.toBeNull();
    expect(lim.request('laser', spec.minGap / 2, spec)).toBeNull();
    const second = lim.request('laser', spec.minGap * 1.1, spec);
    expect(second).not.toBeNull();
    expect(second?.gain ?? 1).toBeLessThan(1);
    expect(lim.request('hit-hull', spec.minGap / 2, SFX_SPECS['hit-hull'])).not.toBeNull();
  });

  it('enforces per-sound instance caps and frees finished voices', () => {
    const lim = new VoiceLimiter();
    const spec = SFX_SPECS['missile-lock'];
    const first = lim.request('missile-lock', 0, spec);
    const second = lim.request('missile-lock', spec.minGap + 0.01, spec);
    expect(second?.steal).toEqual([first?.key]);
    expect(lim.active(10)).toBe(0);
    const g = lim.request('ui-click', 20, SFX_SPECS['ui-click']);
    lim.release(g?.key ?? -1);
    expect(lim.count).toBe(0);
  });
});

describe('engine sound mapping', () => {
  const base: EngineSoundState = { throttle: 0, speed: 0, boost: false, cruise: false, lane: false };

  it('hums at idle with every extra layer off', () => {
    const t = engineTargets(base);
    expect(t.humGain).toBeGreaterThan(0);
    expect(t.subGain).toBeGreaterThan(0);
    expect(t.boostGain).toBe(0);
    expect(t.cruiseGain).toBe(0);
    expect(t.laneGain).toBe(0);
    expect(t.laneToneGain).toBe(0);
  });

  it('rises with throttle and speed, and roars on boost', () => {
    const lo = engineTargets({ ...base, throttle: 0.2, speed: 0.2 });
    const hi = engineTargets({ ...base, throttle: 0.9, speed: 0.9 });
    expect(hi.humHz).toBeGreaterThan(lo.humHz);
    expect(hi.humCutoff).toBeGreaterThan(lo.humCutoff);
    expect(hi.humGain).toBeGreaterThan(lo.humGain);
    expect(hi.noiseGain).toBeGreaterThan(lo.noiseGain);
    const boost = engineTargets({ ...base, throttle: 0.9, speed: 0.9, boost: true });
    expect(boost.boostGain).toBeGreaterThan(0);
    expect(boost.humCutoff).toBeGreaterThan(hi.humCutoff);
  });

  it('adds a cruise shimmer and a lane rush that masks the hum', () => {
    const cruise = engineTargets({ ...base, throttle: 1, speed: 1, cruise: true });
    expect(cruise.cruiseGain).toBeGreaterThan(0);
    const lane = engineTargets({ ...base, throttle: 1, speed: 1, cruise: true, lane: true });
    expect(lane.laneGain).toBeGreaterThan(0);
    expect(lane.cruiseGain).toBe(0);
    expect(lane.humGain).toBeLessThan(cruise.humGain);
  });

  it('clamps out-of-range input', () => {
    expect(engineTargets({ ...base, throttle: 5, speed: -2 })).toEqual(engineTargets({ ...base, throttle: 1, speed: 0 }));
    expect(engineTargets({ ...base, throttle: Number.NaN })).toEqual(engineTargets(base));
  });

  it('only reports meaningful parameter changes', () => {
    const a = engineTargets({ ...base, throttle: 0.5, speed: 0.5 });
    expect(changedParams(null, a)).toEqual(ENGINE_PARAMS.slice());
    expect(changedParams(a, a)).toEqual([]);
    expect(changedParams(a, engineTargets({ ...base, throttle: 0.5005, speed: 0.5 }))).toEqual([]);
    expect(changedParams(a, engineTargets({ ...base, throttle: 0.9, speed: 0.5 }))).toContain('humGain');
    expect(meaningfulChange(100, 100.5, 0.01)).toBe(false);
    expect(meaningfulChange(100, 102, 0.01)).toBe(true);
    expect(meaningfulChange(0.1, 0, 0.03)).toBe(true);
    expect(meaningfulChange(Number.NaN, 1, 0.03)).toBe(true);
  });
});

describe('DSP generators', () => {
  it('makes deterministic zero-mean noise', () => {
    const n = whiteNoise(20000, 9);
    expect(whiteNoise(20000, 9)).toEqual(n);
    let sum = 0;
    for (const x of n) {
      expect(x >= -1 && x < 1).toBe(true);
      sum += x;
    }
    expect(Math.abs(sum / n.length)).toBeLessThan(0.02);
  });

  it('builds a symmetric, monotonic soft-clip curve', () => {
    const c = softClipCurve(1024, 2.2);
    expect(c[0]).toBeCloseTo(-1, 9);
    expect(c[c.length - 1]).toBeCloseTo(1, 9);
    for (let i = 1; i < c.length; i++) expect(c[i]).toBeGreaterThan(c[i - 1]);
    for (let i = 0; i < c.length; i++) expect(c[i]).toBeCloseTo(-c[c.length - 1 - i], 9);
  });

  it('builds an output safety curve that is transparent below its knee and never reaches full scale', () => {
    const c = safetyCurve(2049);
    const at = (x: number): number => c[Math.round(((x + 1) / 2) * (c.length - 1))];
    expect(at(0)).toBe(0);
    expect(at(0.5)).toBeCloseTo(0.5, 2);
    expect(at(-0.7)).toBeCloseTo(-0.7, 2);
    for (let i = 1; i < c.length; i++) expect(c[i]).toBeGreaterThanOrEqual(c[i - 1]);
    for (const x of c) expect(Math.abs(x)).toBeLessThan(0.99);
  });

  it('defines custom oscillator spectra', () => {
    for (const name of ['warm', 'hollow', 'glass'] as const) {
      const h = waveHarmonics(name);
      expect(h[0]).toBe(0);
      expect(h[1]).toBe(1);
      for (const x of h) expect(Number.isFinite(x)).toBe(true);
    }
    const hollow = waveHarmonics('hollow');
    expect(hollow[3]).toBeGreaterThan(hollow[2]);
  });

  it('generates a decaying, decorrelated stereo impulse response', () => {
    const sr = 8000;
    const opts = { seconds: 2, rt60: 1.8, preDelay: 0.02, damping: 0.8, seed: 3 };
    const [l, r] = generateImpulse(sr, opts);
    expect(l).toHaveLength(2 * sr);
    expect(generateImpulse(sr, opts)[0]).toEqual(l);
    for (let i = 0; i < 0.02 * sr; i++) expect(l[i]).toBe(0);
    const energy = (d: Float32Array, a: number, b: number): number => {
      let e = 0;
      for (let i = Math.floor(a * sr); i < Math.floor(b * sr); i++) e += d[i] * d[i];
      return e;
    };
    expect(10 * Math.log10(energy(l, 0, 0.3) / energy(l, 1.5, 1.8))).toBeGreaterThan(30);
    let lr = 0;
    for (let i = 0; i < l.length; i++) lr += l[i] * r[i];
    expect(Math.abs(lr) / Math.sqrt(energy(l, 0, 2) * energy(r, 0, 2))).toBeLessThan(0.2);
    for (const x of l) expect(Number.isFinite(x)).toBe(true);
  });
});

describe('AudioEngine outside a browser', () => {
  it('is a harmless no-op before unlock and remembers requests', () => {
    const audio = new AudioEngine();
    expect(audio.state).toBe('locked');
    expect(audio.currentMood).toBeNull();
    audio.play('laser');
    audio.setCombatIntensity(0.7);
    audio.setEngine({ throttle: 1, speed: 1, boost: true, cruise: false, lane: false });
    audio.setEngine(null);
    audio.setSuspended(true);
    audio.setSuspended(false);
    audio.setMusic('sirius');
    expect(audio.currentMood).toBe('sirius');
    audio.setVolumes({ master: 0.5, music: 2, sfx: -1 });
    const v = audio.getVolumes();
    expect(v).toEqual({ master: 0.5, music: 1, sfx: 0 });
    v.master = 0.1;
    expect(audio.getVolumes().master).toBe(0.5);
    audio.setMuted(true);
    expect(audio.isMuted).toBe(true);
  });

  it('reports unavailable without Web Audio', async () => {
    const audio = new AudioEngine();
    await audio.unlock();
    expect(audio.state).toBe('unavailable');
    audio.play('explosion-large');
    audio.setMusic('title');
    expect(audio.currentMood).toBe('title');
    await audio.unlock();
    expect(audio.state).toBe('unavailable');
  });
});

// ---- runtime wiring on a minimal fake Web Audio implementation (validates API usage too) ----

class FakeParam {
  value: number;
  writes = 0;

  constructor(ctx: FakeContext, value: number) {
    this.value = value;
    ctx.params.push(this);
  }

  setValueAtTime(v: number, t: number): this {
    return this.write(v, t);
  }

  linearRampToValueAtTime(v: number, t: number): this {
    return this.write(v, t);
  }

  exponentialRampToValueAtTime(v: number, t: number): this {
    if (v === 0) throw new RangeError('exponential ramp to zero');
    return this.write(v, t);
  }

  setTargetAtTime(v: number, t: number, timeConstant: number): this {
    if (!(timeConstant >= 0)) throw new RangeError(`bad time constant ${timeConstant}`);
    return this.write(v, t);
  }

  cancelScheduledValues(t: number): this {
    if (!(t >= 0)) throw new RangeError(`bad cancel time ${t}`);
    return this;
  }

  private write(v: number, t: number): this {
    if (!Number.isFinite(v) || !Number.isFinite(t) || t < 0) throw new RangeError(`bad automation ${v} @ ${t}`);
    this.value = v;
    this.writes++;
    return this;
  }
}

class FakeNode {
  readonly context: FakeContext;

  constructor(ctx: FakeContext, kind: string) {
    this.context = ctx;
    ctx.created.set(kind, (ctx.created.get(kind) ?? 0) + 1);
  }

  connect<T>(dest: T): T {
    return dest;
  }

  disconnect(): void {
    this.context.disconnected++;
  }
}

class FakeSource extends FakeNode {
  onended: (() => void) | null = null;
  startAt = -1;
  stopAt = -1;

  start(when = 0, offset = 0): void {
    if (this.startAt >= 0) throw new Error('InvalidStateError: started twice');
    if (!(when >= 0) || !(offset >= 0)) throw new RangeError('bad start');
    this.startAt = when;
    this.context.sources.add(this);
  }

  stop(when = 0): void {
    if (this.startAt < 0) throw new Error('InvalidStateError: stopped before start');
    if (!(when >= 0)) throw new RangeError('bad stop');
    this.stopAt = when;
  }
}

class FakeOscillator extends FakeSource {
  type = 'sine';
  readonly frequency: FakeParam;
  readonly detune: FakeParam;

  constructor(ctx: FakeContext) {
    super(ctx, 'oscillator');
    this.frequency = new FakeParam(ctx, 440);
    this.detune = new FakeParam(ctx, 0);
  }

  setPeriodicWave(): void {}
}

class FakeBufferSource extends FakeSource {
  buffer: FakeBuffer | null = null;
  loop = false;
  readonly playbackRate: FakeParam;

  constructor(ctx: FakeContext) {
    super(ctx, 'bufferSource');
    this.playbackRate = new FakeParam(ctx, 1);
  }
}

class FakeGain extends FakeNode {
  readonly gain: FakeParam;

  constructor(ctx: FakeContext) {
    super(ctx, 'gain');
    this.gain = new FakeParam(ctx, 1);
  }
}

class FakeBiquad extends FakeNode {
  type = 'lowpass';
  readonly frequency: FakeParam;
  readonly Q: FakeParam;

  constructor(ctx: FakeContext) {
    super(ctx, 'biquad');
    this.frequency = new FakeParam(ctx, 350);
    this.Q = new FakeParam(ctx, 1);
  }
}

class FakeBuffer {
  readonly length: number;
  readonly sampleRate: number;
  readonly numberOfChannels: number;
  private readonly data: Float32Array[];

  constructor(channels: number, length: number, sampleRate: number) {
    this.length = length;
    this.sampleRate = sampleRate;
    this.numberOfChannels = channels;
    this.data = Array.from({ length: channels }, () => new Float32Array(length));
  }

  get duration(): number {
    return this.length / this.sampleRate;
  }

  getChannelData(c: number): Float32Array {
    return this.data[c];
  }
}

class FakeContext {
  currentTime = 0;
  readonly sampleRate = 8000;
  state: string;
  disconnected = 0;
  silentBuffers = 0;
  readonly created = new Map<string, number>();
  readonly params: FakeParam[] = [];
  readonly sources = new Set<FakeSource>();
  readonly destination: FakeNode;
  private readonly listeners: (() => void)[] = [];

  constructor(state = 'running') {
    this.state = state;
    this.destination = new FakeNode(this, 'destination');
  }

  addEventListener(_type: string, fn: () => void): void {
    this.listeners.push(fn);
  }

  setState(state: string): void {
    this.state = state;
    for (const fn of this.listeners) fn();
  }

  resume(): Promise<void> {
    return Promise.resolve().then(() => this.setState('running'));
  }

  suspend(): Promise<void> {
    return Promise.resolve().then(() => this.setState('suspended'));
  }

  createGain(): FakeGain {
    return new FakeGain(this);
  }

  createOscillator(): FakeOscillator {
    return new FakeOscillator(this);
  }

  createBufferSource(): FakeBufferSource {
    return new FakeBufferSource(this);
  }

  createBiquadFilter(): FakeBiquad {
    return new FakeBiquad(this);
  }

  createStereoPanner(): FakeNode & { pan: FakeParam } {
    return Object.assign(new FakeNode(this, 'panner'), { pan: new FakeParam(this, 0) });
  }

  createDelay(): FakeNode & { delayTime: FakeParam } {
    return Object.assign(new FakeNode(this, 'delay'), { delayTime: new FakeParam(this, 0) });
  }

  createWaveShaper(): FakeNode & { curve: Float32Array | null; oversample: string } {
    return Object.assign(new FakeNode(this, 'shaper'), { curve: null, oversample: 'none' });
  }

  createConvolver(): FakeNode & { buffer: FakeBuffer | null; normalize: boolean } {
    return Object.assign(new FakeNode(this, 'convolver'), { buffer: null, normalize: true });
  }

  createDynamicsCompressor(): FakeNode & Record<'threshold' | 'knee' | 'ratio' | 'attack' | 'release', FakeParam> {
    const p = (v: number): FakeParam => new FakeParam(this, v);
    return Object.assign(new FakeNode(this, 'compressor'), { threshold: p(-24), knee: p(30), ratio: p(12), attack: p(0.003), release: p(0.25) });
  }

  createBuffer(channels: number, length: number, sampleRate: number): FakeBuffer {
    if (length === 1) this.silentBuffers++;
    return new FakeBuffer(channels, length, sampleRate);
  }

  createPeriodicWave(): object {
    return {};
  }

  count(kind: string): number {
    return this.created.get(kind) ?? 0;
  }

  paramWrites(): number {
    return this.params.reduce((n, p) => n + p.writes, 0);
  }

  /** Moves the clock and fires `ended` for every source whose stop time has passed. */
  advance(t: number): void {
    this.currentTime = t;
    for (const s of [...this.sources]) {
      if (s.stopAt >= 0 && s.stopAt <= t) {
        this.sources.delete(s);
        s.onended?.();
      }
    }
  }
}

const asContext = (ctx: FakeContext): BaseAudioContext => ctx as unknown as BaseAudioContext;
const fakeBus = (ctx: FakeContext): BusInput => ({ dry: ctx.createGain(), wet: ctx.createGain() }) as unknown as BusInput;
const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe('runtime graph on a fake AudioContext', () => {
  it('builds the mix graph with a generated reverb impulse', () => {
    const ctx = new FakeContext();
    const graph = new MixGraph(asContext(ctx));
    graph.apply({ master: 0.8, music: 0.6, sfx: 0.8 }, false);
    graph.apply({ master: 0.8, music: 0.6, sfx: 0.8 }, true);
    expect(ctx.count('convolver')).toBe(1);
    expect(ctx.count('compressor')).toBe(1);
  });

  it('plays every sound effect, caps voices and cleans up after itself', () => {
    const ctx = new FakeContext();
    const sfx = new SfxPlayer(asContext(ctx), fakeBus(ctx));
    for (const id of ALL_SFX) expect(sfx.play(id, { pan: 0.4, pitch: 1.3, volume: 0.8 })).toBe(true);
    expect(sfx.activeVoices).toBeLessThanOrEqual(MAX_SFX_VOICES);
    expect(sfx.play('laser', { volume: 0 })).toBe(false);
    ctx.advance(0.5);
    expect(sfx.play('laser', { pitch: 0.5, pan: -1 })).toBe(true);
    expect(sfx.play('laser')).toBe(false); // same instant: rate-limited
    for (const s of ctx.sources) expect(s.stopAt).toBeGreaterThan(s.startAt);
    ctx.advance(30);
    expect(sfx.activeVoices).toBe(0);
    expect(ctx.sources.size).toBe(0);
    expect(ctx.disconnected).toBeGreaterThan(0);
  });

  it('touches engine AudioParams only when the flight state moves meaningfully', () => {
    const ctx = new FakeContext();
    const engine = new EngineSound(asContext(ctx), ctx.createGain() as unknown as AudioNode);
    const state: EngineSoundState = { throttle: 0.5, speed: 0.5, boost: false, cruise: true, lane: false };
    engine.update(state);
    // Hum pair + sub, plus the cruise pair and its vibrato: built on the very first frame.
    expect(ctx.count('oscillator')).toBe(6);
    const writes = ctx.paramWrites();
    for (let i = 0; i < 100; i++) engine.update(state);
    expect(ctx.paramWrites()).toBe(writes);
    engine.update({ ...state, throttle: 0.5004 });
    expect(ctx.paramWrites()).toBe(writes);
    engine.update({ ...state, throttle: 0.9, boost: true });
    expect(ctx.paramWrites()).toBeGreaterThan(writes);
    engine.update({ ...state, lane: true });
    expect(ctx.count('oscillator')).toBe(9);
    engine.dispose();
    expect(engine.isActive).toBe(false);
  });

  it('crossfades moods, bounds voices and retires faded layers', () => {
    const ctx = new FakeContext();
    const music = new MusicPlayer(asContext(ctx), fakeBus(ctx), 5);
    let t = 0;
    let maxVoices = 0;
    let maxLayers = 0;
    const run = (seconds: number): void => {
      for (const end = t + seconds; t < end; t += 0.025) {
        ctx.advance(t);
        music.scheduleUntil(t + 0.1);
        maxVoices = Math.max(maxVoices, music.voiceCount);
        maxLayers = Math.max(maxLayers, music.layerCount);
      }
    };
    music.setMood('title', 3, 0);
    run(40);
    expect(maxVoices).toBeGreaterThan(5);
    expect(maxVoices).toBeLessThanOrEqual(4 + 1 + MAX_LAYER_VOICES);
    music.setMood('title');
    expect(music.layerCount).toBe(1);
    music.setMood('epsilon-eridani');
    music.setIntensity(1);
    run(20);
    expect(music.mood).toBe('epsilon-eridani');
    expect(music.layerCount).toBe(1);
    for (const mood of ['map', 'title', 'barnard', 'sirius', 'sol'] as const) {
      music.setMood(mood);
      run(0.3);
    }
    run(10);
    expect(maxLayers).toBeLessThanOrEqual(3);
    expect(music.layerCount).toBe(1);
    expect(music.mood).toBe('sol');
    music.setIntensity(0);
    music.dispose();
    ctx.advance(t + 5);
    expect(ctx.sources.size).toBe(0);
  });

  /** Runs `body` with a fake `window` exposing a context constructor under `name`. */
  async function withFakeWindow(name: 'AudioContext' | 'webkitAudioContext', body: (made: FakeContext[]) => Promise<void>): Promise<void> {
    const made: FakeContext[] = [];
    class TestContext extends FakeContext {
      constructor() {
        super('suspended');
        made.push(this);
      }
    }
    const g = globalThis as { window?: unknown };
    g.window = { [name]: TestContext };
    try {
      await body(made);
    } finally {
      delete g.window;
    }
  }

  it('creates its context only in unlock and follows suspend, resume and interruptions', async () => {
    await withFakeWindow('AudioContext', async (made) => {
      const audio = new AudioEngine();
      audio.setMusic('sirius');
      audio.setCombatIntensity(0.5);
      audio.play('laser');
      expect(made).toHaveLength(0);

      await audio.unlock();
      expect(made).toHaveLength(1);
      const ctx = made[0];
      expect(audio.state).toBe('running');
      expect(ctx.silentBuffers).toBe(1);
      expect(audio.debugStats().schedulerRunning).toBe(true);
      expect(audio.debugStats().musicVoices).toBeGreaterThan(0);
      audio.play('laser');
      expect(audio.debugStats().sfxVoices).toBe(1);
      audio.setEngine({ throttle: 1, speed: 1, boost: false, cruise: false, lane: true });
      expect(audio.debugStats().engineActive).toBe(true);

      audio.setSuspended(true);
      await flush();
      expect(audio.state).toBe('locked');
      expect(audio.debugStats().schedulerRunning).toBe(false);
      audio.setSuspended(false);
      await flush();
      expect(audio.state).toBe('running');
      expect(audio.debugStats().schedulerRunning).toBe(true);

      ctx.setState('interrupted');
      expect(audio.state).toBe('locked');
      expect(audio.debugStats().schedulerRunning).toBe(false);
      await audio.unlock();
      expect(audio.state).toBe('running');
      expect(made).toHaveLength(1);
      expect(ctx.silentBuffers).toBe(2);

      audio.setSuspended(true);
      await flush();
    });
  });

  it('falls back to webkitAudioContext and stays asleep when unlocked while suspended', async () => {
    await withFakeWindow('webkitAudioContext', async (made) => {
      const audio = new AudioEngine();
      audio.setSuspended(true);
      await audio.unlock();
      await flush();
      expect(made).toHaveLength(1);
      expect(made[0].silentBuffers).toBe(1);
      expect(audio.state).toBe('locked');
      expect(audio.debugStats().schedulerRunning).toBe(false);
      audio.setSuspended(false);
      await flush();
      expect(audio.state).toBe('running');
      expect(audio.debugStats().schedulerRunning).toBe(true);
      audio.setSuspended(true);
      await flush();
    });
  });
});
