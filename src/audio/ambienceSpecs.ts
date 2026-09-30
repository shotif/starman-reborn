import type { AmbienceRoom } from './types.ts';
import { between, chance, clamp01, mulberry32 } from './theory.ts';
import type { Rng } from './theory.ts';

/**
 * Station ambience and local radio: pure data and planners, shared by the runtime (./ambience.ts)
 * and the unit tests. No Web Audio access. Everything here is synthesized from filtered noise,
 * hums and short synthetic events; the radio is a stylised texture, never speech.
 */

/** A mains-like hum: one periodic wave with a few harmonics, played twice a little apart so it beats. */
export interface HumDef {
  /** Fundamental, Hz. */
  freq: number;
  /** Harmonic amplitudes from the fundamental up. */
  harmonics: readonly number[];
  /** Hz between the two copies (a slow beat); 0 plays a single copy. */
  beat: number;
  level: number;
  /** Lowpass on the hum, Hz. */
  cutoff: number;
}

/** A steady bed of filtered noise: a hall's rumble, air handling, a conveyor. */
export interface NoiseBedDef {
  filter: 'lowpass' | 'bandpass' | 'highpass';
  freq: number;
  q: number;
  level: number;
  /** Periodic amplitude flutter (rollers, a compressor): rate in Hz and depth 0..1. */
  flutter?: { rate: number; depth: number };
}

/** Talkers in a crowd: noise bands whose levels and centres move syllable by syllable. A texture, not speech. */
export interface MurmurDef {
  /** Band centre of each talker, Hz (each syllable moves it by up to `drift` either way). */
  bands: readonly number[];
  /** Largest move of a talker's band per syllable, as a ratio (1.25 = a major third up or down). */
  drift: number;
  q: number;
  level: number;
  /** Seconds a syllable lasts. */
  step: readonly [number, number];
  /** Chance a talker is quiet for a syllable. */
  pause: number;
}

export type AmbientEventKind = 'clank' | 'clink' | 'hiss' | 'thud' | 'beep' | 'servo' | 'ratchet' | 'crackle';

/** A sparse random sound in a room: how often, how loud, what pitch, how far off. */
export interface AmbientEventDef {
  kind: AmbientEventKind;
  /** Seconds between two of these, uniform in [min, max]. */
  every: readonly [number, number];
  /** Peak level range. */
  level: readonly [number, number];
  /** Pitch or band range, Hz. */
  freq: readonly [number, number];
  /** Widest pan either side, 0..1. */
  spread: number;
  /** Reverb send, 0..1: more for distant sounds. */
  wet: number;
}

export interface RoomAmbienceDef {
  room: AmbienceRoom;
  character: string;
  hum: HumDef;
  noise: readonly NoiseBedDef[];
  murmur?: MurmurDef;
  events: readonly AmbientEventDef[];
  /** Overall trim. */
  level: number;
}

/** Budgets the room beds keep to (checked by the unit tests), for phones. */
export const AMBIENCE_LIMITS = {
  /** Largest gain of any hum, bed, murmur or event. */
  maxLevel: 0.2,
  maxHarmonics: 4,
  maxNoiseBeds: 2,
  maxTalkers: 3,
  maxEvents: 4,
  /** Shortest gap between two events of one kind, seconds. */
  minEvery: 1.5,
  /** Event voices ringing at once in one room (the oldest is cut short beyond this). */
  maxEventVoices: 3,
  /** Nodes a room bed keeps running, events aside. */
  maxBedNodes: 18,
} as const;

export const AMBIENCE: Record<AmbienceRoom, RoomAmbienceDef> = {
  deck: {
    room: 'deck',
    character: 'The hangar: a low mains hum with a slow beat, the rumble and air handling of a big hall, distant clanks, hydraulic hisses and the odd heavy thud.',
    hum: { freq: 50, harmonics: [1, 0.5, 0.25], beat: 0.35, level: 0.012, cutoff: 260 },
    noise: [
      { filter: 'lowpass', freq: 220, q: 0.7, level: 0.14 },
      { filter: 'bandpass', freq: 1500, q: 0.8, level: 0.05 },
    ],
    events: [
      { kind: 'clank', every: [5, 13], level: [0.03, 0.07], freq: [140, 420], spread: 0.8, wet: 0.7 },
      { kind: 'hiss', every: [11, 26], level: [0.035, 0.07], freq: [1800, 3600], spread: 0.7, wet: 0.4 },
      { kind: 'thud', every: [14, 32], level: [0.03, 0.06], freq: [55, 90], spread: 0.6, wet: 0.5 },
    ],
    level: 1,
  },

  bar: {
    room: 'bar',
    character: 'The murmur of a room full of people (noise bands moving syllable by syllable, no speech), clinking glasses, a glass set down now and then, a quiet room tone.',
    hum: { freq: 60, harmonics: [1, 0.3], beat: 0.2, level: 0.006, cutoff: 200 },
    noise: [{ filter: 'lowpass', freq: 650, q: 0.5, level: 0.06 }],
    murmur: { bands: [360, 610, 1020], drift: 1.25, q: 1.5, level: 0.2, step: [0.11, 0.3], pause: 0.22 },
    events: [
      { kind: 'clink', every: [2.5, 7], level: [0.012, 0.03], freq: [2300, 4200], spread: 0.9, wet: 0.35 },
      { kind: 'thud', every: [12, 28], level: [0.012, 0.025], freq: [90, 150], spread: 0.7, wet: 0.25 },
    ],
    level: 1,
  },

  trader: {
    room: 'trader',
    character: 'The cargo floor: conveyors rattling on their rollers, loader servos, scanner beeps, crates set down and the odd clank.',
    hum: { freq: 55, harmonics: [1, 0.4, 0.3], beat: 0.5, level: 0.01, cutoff: 320 },
    noise: [
      { filter: 'bandpass', freq: 380, q: 0.9, level: 0.12, flutter: { rate: 3.2, depth: 0.5 } },
      { filter: 'bandpass', freq: 900, q: 0.9, level: 0.035 },
    ],
    events: [
      { kind: 'servo', every: [6, 15], level: [0.04, 0.08], freq: [180, 320], spread: 0.8, wet: 0.3 },
      { kind: 'beep', every: [9, 22], level: [0.008, 0.015], freq: [1400, 2200], spread: 0.8, wet: 0.2 },
      { kind: 'thud', every: [7, 18], level: [0.03, 0.06], freq: [60, 100], spread: 0.7, wet: 0.4 },
      { kind: 'clank', every: [10, 24], level: [0.02, 0.045], freq: [200, 480], spread: 0.8, wet: 0.5 },
    ],
    level: 1,
  },

  outfitter: {
    room: 'outfitter',
    character: 'The workshop: a compressor chugging, impact wrenches, welding crackle, servos and tools set down on metal.',
    hum: { freq: 60, harmonics: [1, 0.6, 0.2], beat: 0.8, level: 0.009, cutoff: 420 },
    noise: [
      { filter: 'bandpass', freq: 700, q: 1.4, level: 0.1, flutter: { rate: 11, depth: 0.35 } },
      { filter: 'highpass', freq: 3000, q: 0.7, level: 0.01 },
    ],
    events: [
      { kind: 'ratchet', every: [8, 18], level: [0.03, 0.06], freq: [2500, 4500], spread: 0.8, wet: 0.3 },
      { kind: 'crackle', every: [10, 24], level: [0.012, 0.024], freq: [3000, 6000], spread: 0.7, wet: 0.25 },
      { kind: 'servo', every: [9, 20], level: [0.035, 0.07], freq: [220, 380], spread: 0.8, wet: 0.3 },
      { kind: 'clank', every: [6, 14], level: [0.025, 0.055], freq: [260, 700], spread: 0.8, wet: 0.45 },
    ],
    level: 1,
  },
};

export const AMBIENCE_ROOMS = Object.keys(AMBIENCE) as AmbienceRoom[];

/**
 * Nodes a room bed keeps running (./ambience.ts builds exactly these): its output and room send,
 * the hum's oscillators, lowpass and gain, one shared noise source, a filter and gain per noise
 * bed (plus an LFO and its depth for flutter), and a band and gain per talker plus the murmur's gain.
 */
export function bedNodeCount(def: RoomAmbienceDef): number {
  let n = 2 + (def.hum.beat > 0 ? 2 : 1) + 2;
  if (def.noise.length > 0 || def.murmur) n += 1;
  for (const b of def.noise) n += b.flutter ? 4 : 2;
  if (def.murmur) n += def.murmur.bands.length * 2 + 1;
  return n;
}

/** One event as it will play. */
export interface AmbientEvent {
  time: number;
  kind: AmbientEventKind;
  level: number;
  freq: number;
  pan: number;
  wet: number;
}

/**
 * The event timeline of a room: the next time of each kind, drawn from one seeded stream. Events
 * come out in time order, so the sequence is the same however the look-ahead window moves.
 */
export class AmbiencePlanner {
  readonly def: RoomAmbienceDef;
  private readonly rng: Rng;
  private readonly next: number[];

  constructor(def: RoomAmbienceDef, rng: Rng, start: number) {
    this.def = def;
    this.rng = rng;
    // The first of each kind comes part-way into its gap, so a room does not open with a burst.
    this.next = def.events.map((e) => start + between(rng, e.every[0] * 0.25, e.every[1]));
  }

  /** Every event due up to `horizon`, in time order. */
  take(horizon: number): AmbientEvent[] {
    const out: AmbientEvent[] = [];
    const { def, rng, next } = this;
    for (;;) {
      let i = -1;
      for (let k = 0; k < next.length; k++) if (next[k] <= horizon && (i < 0 || next[k] < next[i])) i = k;
      if (i < 0) return out;
      const e = def.events[i];
      out.push({
        time: next[i],
        kind: e.kind,
        level: between(rng, e.level[0], e.level[1]),
        freq: between(rng, e.freq[0], e.freq[1]),
        pan: between(rng, -e.spread, e.spread),
        wet: e.wet,
      });
      next[i] += between(rng, e.every[0], e.every[1]);
    }
  }
}

/** Every event a room plays in its first `seconds`, for a seed (tests and tools). */
export function planAmbience(def: RoomAmbienceDef, seed: number, seconds: number): AmbientEvent[] {
  return new AmbiencePlanner(def, mulberry32(seed), 0).take(seconds);
}

/** One syllable of a talker: how long it lasts, its level (a pause is nearly silent) and where its band moves. */
export function murmurStep(m: MurmurDef, rng: Rng): { len: number; level: number; shift: number } {
  const len = between(rng, m.step[0], m.step[1]);
  const level = chance(rng, m.pause) ? 0.04 : between(rng, 0.25, 1);
  return { len, level, shift: m.drift ** between(rng, -1, 1) };
}

// ---- local radio ----

export const RADIO = {
  /** Below this busyness the local radio is silent. */
  threshold: 0.3,
  /** Seconds between bursts just above the threshold, and at full traffic. */
  gapQuiet: [28, 55] as const,
  gapBusy: [9, 20] as const,
  /** Seconds before the first burst once the radio comes on. */
  first: [3, 9] as const,
  /** Seconds of chatter in a burst, and the syllables it is cut into. */
  talk: [0.7, 2.4] as const,
  syllable: [0.06, 0.2] as const,
  /** Chance a syllable is a gap. */
  gaps: 0.25,
  /** Where the chatter's narrow band sits, Hz. */
  band: [900, 2200] as const,
  /** Seconds of the squelch opening and of its tail. */
  open: 0.05,
  tail: 0.12,
  /** Output gain of a burst (faint), and how hard its static drives the grit stage. */
  level: 0.035,
  drive: 3,
  /** A faint carrier whistle, Hz. */
  whistle: [1100, 2600] as const,
  /** Widest pan either side. */
  spread: 0.6,
} as const;

/** Seconds to the next burst at this busyness (fewer, further apart, in quieter systems); null when silent. */
export function radioGap(level: number, rng: Rng): number | null {
  if (!(level >= RADIO.threshold)) return null;
  const k = clamp01((level - RADIO.threshold) / (1 - RADIO.threshold));
  const lo = RADIO.gapQuiet[0] + (RADIO.gapBusy[0] - RADIO.gapQuiet[0]) * k;
  const hi = RADIO.gapQuiet[1] + (RADIO.gapBusy[1] - RADIO.gapQuiet[1]) * k;
  return between(rng, lo, hi);
}

/** One syllable of radio chatter: when (from the burst's start), how long, how loud, where its band sits. */
export interface RadioSyllable {
  t: number;
  len: number;
  level: number;
  band: number;
}

export interface RadioBurst {
  /** Seconds from the squelch opening to the end of its tail. */
  duration: number;
  pan: number;
  whistle: number;
  syllables: RadioSyllable[];
}

/** Plans one burst: the squelch opens, garbled syllables of band-limited static, the squelch closes. */
export function radioBurst(rng: Rng): RadioBurst {
  const talk = between(rng, RADIO.talk[0], RADIO.talk[1]);
  const stop = RADIO.open + talk;
  const syllables: RadioSyllable[] = [];
  let t = RADIO.open;
  while (t < stop - RADIO.syllable[0]) {
    const len = Math.min(between(rng, RADIO.syllable[0], RADIO.syllable[1]), stop - t);
    if (!chance(rng, RADIO.gaps)) syllables.push({ t, len, level: between(rng, 0.45, 1), band: between(rng, RADIO.band[0], RADIO.band[1]) });
    t += len + between(rng, 0.015, 0.06);
  }
  return {
    duration: stop + RADIO.tail,
    pan: between(rng, -RADIO.spread, RADIO.spread),
    whistle: between(rng, RADIO.whistle[0], RADIO.whistle[1]),
    syllables,
  };
}
