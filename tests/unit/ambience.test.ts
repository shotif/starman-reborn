import { describe, expect, it } from 'vitest';
import {
  AMBIENCE,
  AMBIENCE_LIMITS,
  AMBIENCE_ROOMS,
  AmbiencePlanner,
  RADIO,
  bedNodeCount,
  murmurStep,
  planAmbience,
  radioBurst,
  radioGap,
} from '../../src/audio/ambienceSpecs.ts';
import { SFX_SPECS } from '../../src/audio/sfxSpecs.ts';
import { mulberry32 } from '../../src/audio/theory.ts';
import type { AmbienceRoom } from '../../src/audio/types.ts';

/** Station ambience and local radio: the pure specs and planners (the runtime is tested in audio.test.ts). */

const ROOMS: AmbienceRoom[] = ['deck', 'bar', 'trader', 'outfitter'];

describe('station ambience specs', () => {
  it('defines a bed for every room', () => {
    expect(AMBIENCE_ROOMS.slice().sort()).toEqual(ROOMS.slice().sort());
    for (const room of ROOMS) {
      expect(AMBIENCE[room].room).toBe(room);
      expect(AMBIENCE[room].character.length).toBeGreaterThan(20);
    }
  });

  it('gives each room its own sounds: hangar clanks, a murmur and glasses, machinery', () => {
    const kinds = (room: AmbienceRoom): string[] => AMBIENCE[room].events.map((e) => e.kind);
    expect(kinds('deck')).toContain('clank');
    expect(AMBIENCE.bar.murmur).toBeDefined();
    expect(kinds('bar')).toContain('clink');
    for (const room of ['trader', 'outfitter'] as const) expect(kinds(room).some((k) => k === 'servo' || k === 'ratchet' || k === 'crackle')).toBe(true);
    for (const room of ['deck', 'trader', 'outfitter'] as const) expect(AMBIENCE[room].murmur).toBeUndefined();
  });

  it('keeps every level, pitch, rate and node count within its limits', () => {
    const L = AMBIENCE_LIMITS;
    const inLevel = (x: number): void => {
      expect(x).toBeGreaterThan(0);
      expect(x).toBeLessThanOrEqual(L.maxLevel);
    };
    for (const def of Object.values(AMBIENCE)) {
      expect(def.level).toBeGreaterThan(0);
      expect(def.level).toBeLessThanOrEqual(1);
      const hum = def.hum;
      inLevel(hum.level);
      expect(hum.freq).toBeGreaterThanOrEqual(30);
      expect(hum.freq).toBeLessThanOrEqual(120);
      expect(hum.cutoff).toBeGreaterThan(hum.freq);
      expect(hum.beat).toBeGreaterThanOrEqual(0);
      expect(hum.beat).toBeLessThanOrEqual(2);
      expect(hum.harmonics.length).toBeGreaterThanOrEqual(1);
      expect(hum.harmonics.length).toBeLessThanOrEqual(L.maxHarmonics);
      expect(hum.harmonics[0]).toBe(1);
      for (const a of hum.harmonics) expect(a > 0 && a <= 1).toBe(true);
      expect(def.noise.length).toBeLessThanOrEqual(L.maxNoiseBeds);
      for (const b of def.noise) {
        inLevel(b.level);
        expect(b.freq).toBeGreaterThanOrEqual(40);
        expect(b.freq).toBeLessThanOrEqual(12_000);
        expect(b.q > 0 && b.q <= 10).toBe(true);
        if (b.flutter) {
          expect(b.flutter.rate > 0 && b.flutter.rate <= 20).toBe(true);
          expect(b.flutter.depth > 0 && b.flutter.depth <= 1).toBe(true);
        }
      }
      if (def.murmur) {
        const m = def.murmur;
        inLevel(m.level);
        expect(m.bands.length).toBeLessThanOrEqual(L.maxTalkers);
        for (const f of m.bands) expect(f >= 150 && f <= 3000).toBe(true);
        expect(m.drift >= 1 && m.drift <= 1.5).toBe(true);
        expect(m.step[0]).toBeGreaterThanOrEqual(0.05);
        expect(m.step[1]).toBeGreaterThanOrEqual(m.step[0]);
        expect(m.pause >= 0 && m.pause < 1).toBe(true);
      }
      expect(def.events.length).toBeGreaterThan(0);
      expect(def.events.length).toBeLessThanOrEqual(L.maxEvents);
      for (const e of def.events) {
        expect(e.every[0]).toBeGreaterThanOrEqual(L.minEvery);
        expect(e.every[1]).toBeGreaterThanOrEqual(e.every[0]);
        inLevel(e.level[0]);
        inLevel(e.level[1]);
        expect(e.level[1]).toBeGreaterThanOrEqual(e.level[0]);
        expect(e.freq[0]).toBeGreaterThanOrEqual(20);
        expect(e.freq[1]).toBeLessThanOrEqual(12_000);
        expect(e.freq[1]).toBeGreaterThanOrEqual(e.freq[0]);
        expect(e.spread >= 0 && e.spread <= 1).toBe(true);
        expect(e.wet >= 0 && e.wet <= 1).toBe(true);
      }
      expect(bedNodeCount(def)).toBeLessThanOrEqual(L.maxBedNodes);
    }
  });

  it('plans sparse events deterministically for a seed, in time order and within their ranges', () => {
    const seconds = 600;
    for (const room of ROOMS) {
      const def = AMBIENCE[room];
      const plan = planAmbience(def, 7, seconds);
      expect(planAmbience(def, 7, seconds)).toEqual(plan);
      expect(JSON.stringify(planAmbience(def, 8, seconds))).not.toBe(JSON.stringify(plan));
      let last = 0;
      for (const e of plan) {
        expect(e.time).toBeGreaterThanOrEqual(last);
        expect(e.time).toBeLessThanOrEqual(seconds);
        last = e.time;
        const spec = def.events.find((x) => x.kind === e.kind)!;
        expect(e.level >= spec.level[0] && e.level <= spec.level[1]).toBe(true);
        expect(e.freq >= spec.freq[0] && e.freq <= spec.freq[1]).toBe(true);
        expect(Math.abs(e.pan)).toBeLessThanOrEqual(spec.spread);
      }
      for (const spec of def.events) {
        const times = plan.filter((e) => e.kind === spec.kind).map((e) => e.time);
        expect(times.length).toBeGreaterThanOrEqual(Math.floor(seconds / spec.every[1]) - 1);
        expect(times.length).toBeLessThanOrEqual(Math.ceil(seconds / spec.every[0]) + 1);
        for (let i = 1; i < times.length; i++) {
          expect(times[i]! - times[i - 1]!).toBeGreaterThanOrEqual(spec.every[0] - 1e-9);
          expect(times[i]! - times[i - 1]!).toBeLessThanOrEqual(spec.every[1] + 1e-9);
        }
      }
    }
  });

  it('plans the same events however the look-ahead window moves', () => {
    for (const room of ROOMS) {
      const planner = new AmbiencePlanner(AMBIENCE[room], mulberry32(3), 0);
      const chunked = [];
      for (let t = 0.3; t <= 120; t += 0.1 + (t % 0.7)) chunked.push(...planner.take(t));
      chunked.push(...planner.take(120));
      expect(chunked).toEqual(planAmbience(AMBIENCE[room], 3, 120));
    }
  });

  it('moves the talkers of the murmur syllable by syllable', () => {
    const m = AMBIENCE.bar.murmur!;
    const rng = mulberry32(5);
    let pauses = 0;
    for (let i = 0; i < 1000; i++) {
      const s = murmurStep(m, rng);
      expect(s.len >= m.step[0] && s.len <= m.step[1]).toBe(true);
      expect(s.level > 0 && s.level <= 1).toBe(true);
      expect(s.shift >= 1 / m.drift - 1e-9 && s.shift <= m.drift + 1e-9).toBe(true);
      if (s.level < 0.1) pauses++;
    }
    expect(pauses / 1000).toBeCloseTo(m.pause, 1);
  });
});

describe('local radio plans', () => {
  it('stays silent in quiet systems and talks more often in busy ones', () => {
    const rng = mulberry32(9);
    for (const level of [0, 0.1, RADIO.threshold - 0.01, Number.NaN]) expect(radioGap(level, rng)).toBeNull();
    const mean = (level: number): number => {
      let sum = 0;
      for (let i = 0; i < 500; i++) {
        const g = radioGap(level, rng)!;
        expect(g).toBeGreaterThanOrEqual(RADIO.gapBusy[0]);
        expect(g).toBeLessThanOrEqual(RADIO.gapQuiet[1]);
        sum += g;
      }
      return sum / 500;
    };
    const quiet = mean(RADIO.threshold);
    const busy = mean(1);
    expect(busy).toBeLessThan(quiet / 2);
    expect(busy).toBeGreaterThan(5);
  });

  it('cuts each burst into garbled syllables between the squelch opening and closing', () => {
    const rng = mulberry32(4);
    const first = radioBurst(mulberry32(21));
    expect(radioBurst(mulberry32(21))).toEqual(first);
    for (let i = 0; i < 300; i++) {
      const b = radioBurst(rng);
      expect(b.duration).toBeGreaterThanOrEqual(RADIO.open + RADIO.talk[0] + RADIO.tail - 1e-9);
      expect(b.duration).toBeLessThanOrEqual(RADIO.open + RADIO.talk[1] + RADIO.tail + 1e-9);
      expect(Math.abs(b.pan)).toBeLessThanOrEqual(RADIO.spread);
      expect(b.whistle >= RADIO.whistle[0] && b.whistle <= RADIO.whistle[1]).toBe(true);
      let end = RADIO.open;
      for (const s of b.syllables) {
        expect(s.t).toBeGreaterThanOrEqual(end);
        expect(s.len).toBeGreaterThanOrEqual(RADIO.syllable[0] - 1e-9);
        end = s.t + s.len;
        expect(end).toBeLessThanOrEqual(b.duration - RADIO.tail + 1e-9);
        expect(s.level > 0 && s.level <= 1).toBe(true);
        expect(s.band >= RADIO.band[0] && s.band <= RADIO.band[1]).toBe(true);
      }
    }
  });

  it('keeps the ambient radio faint, well under the comm blip', () => {
    expect(RADIO.level).toBeLessThanOrEqual(0.05);
    expect(RADIO.level).toBeLessThan(SFX_SPECS['radio-blip'].gain / 4);
    expect(SFX_SPECS['radio-blip'].dur).toBeLessThanOrEqual(0.5);
  });
});
