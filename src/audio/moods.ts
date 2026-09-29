import type { MusicMood } from './types.ts';
import { SCALES } from './theory.ts';

/** Oscillator shapes: native types plus custom PeriodicWaves built at runtime. */
export type WaveName = 'sine' | 'triangle' | 'sawtooth' | 'square' | 'warm' | 'hollow' | 'glass';

export type ToneKind = 'pluck' | 'bell' | 'ep' | 'pulse' | 'tick' | 'clank';

/** How one event voice sounds. */
export interface ToneDef {
  kind: ToneKind;
  /** Peak gain at velocity 1. */
  level: number;
  /** Amplitude decay in seconds. */
  decay: number;
  wave?: WaveName;
  /** Filter cutoff (pluck/pulse) or band centre (tick) in Hz. */
  cutoff?: number;
  q?: number;
  /** FM modulator:carrier ratio (bell/ep/clank). */
  ratio?: number;
  /** FM modulation index at the onset. */
  index?: number;
  /** Reverb send 0..1. */
  wet?: number;
  /** Echo send 0..1. */
  echo?: number;
}

export interface ChordDef {
  /** Chord root in semitones above the key (drives the drone when it follows roots). */
  root: number;
  /** Chord tones in semitones above the key, in voicing priority order. */
  pcs: readonly number[];
  /** Indices of chords that may follow this one. */
  next: readonly number[];
  /** Scale for melodic parts over this chord (defaults to the mood scale). */
  scale?: readonly number[];
}

export interface PadDef {
  /** Sustained voices, two detuned oscillators each; they glide between chords. */
  voices: number;
  wave: WaveName;
  /** +/- detune of the oscillator pair, in cents. */
  detune: number;
  low: number;
  high: number;
  /** Lowpass centre in Hz. */
  cutoff: number;
  /** 0..1: how far phrase brightness moves the cutoff. */
  sweep: number;
  q: number;
  lfoRate: number;
  /** Filter LFO depth as a fraction of the cutoff. */
  lfoDepth: number;
  level: number;
  /** Chord-change portamento in seconds. */
  glide: number;
}

export interface DroneDef {
  level: number;
  /** Offset from the key in semitones. */
  octave: number;
  follow: 'root' | 'tonic';
  /** Level of a triangle an octave up, so the drone reads on small speakers. */
  upper: number;
  /** Slow beating between two detuned sines in Hz (0 = single sine). */
  beat: number;
  cutoff: number;
}

export interface NoiseBedDef {
  level: number;
  freq: number;
  q: number;
  lfoRate: number;
  /** Band-centre LFO depth as a fraction of `freq`. */
  lfoDepth: number;
}

export interface MelodyDef {
  tone: ToneDef;
  /** Probability that a bar carries the motif. */
  density: number;
  low: number;
  high: number;
  /** Candidate onset patterns in beats. */
  rhythms: readonly (readonly number[])[];
  /** Largest scale-step move between consecutive motif notes. */
  stepMax: number;
}

export interface SparkleDef {
  tone: ToneDef;
  density: number;
  low: number;
  high: number;
  maxNotes: number;
  /** When set, notes form an arpeggio at this spacing in beats. */
  arpRate?: number;
}

export interface CompDef {
  tone: ToneDef;
  density: number;
  low: number;
  high: number;
  rhythms: readonly (readonly number[])[];
}

/** 16th-note step patterns (velocity per step, 4 steps per beat). */
export interface PatternDef {
  tone: ToneDef;
  patterns: readonly (readonly number[])[];
  /** Probability that a bar plays at all. */
  density: number;
}

export interface EchoDef {
  beats: number;
  feedback: number;
  level: number;
  /** Lowpass in the feedback loop, Hz. */
  tone: number;
}

export interface MoodDef {
  id: MusicMood;
  character: string;
  tempo: number;
  beatsPerBar: number;
  /** MIDI note of the key centre (pads sit around it). */
  key: number;
  scale: readonly number[];
  /** 0..1 swing applied to off-beat eighths and sixteenths. */
  swing: number;
  chords: readonly ChordDef[];
  barsPerChord: readonly number[];
  phraseBars: number;
  pad: PadDef;
  drone: DroneDef;
  noise?: NoiseBedDef;
  melody?: MelodyDef;
  sparkle?: SparkleDef;
  comp?: CompDef;
  pulse?: PatternDef;
  ticks?: PatternDef;
  echo?: EchoDef;
  /** Reverb send for pads and drones. */
  reverb: number;
  /** Overall layer trim. */
  level: number;
}

export const MOODS: Record<MusicMood, MoodDef> = {
  title: {
    id: 'title',
    character: 'Hopeful and spacious: D major with a lydian lift, wide saw pads, echoing plucks and bell arpeggios.',
    tempo: 68,
    beatsPerBar: 4,
    key: 50,
    scale: SCALES.major,
    swing: 0,
    chords: [
      { root: 0, pcs: [4, 11, 7, 2], next: [1, 2, 3, 4] },
      { root: 0, pcs: [6, 9, 2, 4], next: [0, 2], scale: SCALES.lydian },
      { root: 9, pcs: [0, 7, 11, 4], next: [3, 4] },
      { root: 5, pcs: [9, 4, 7, 0], next: [0, 4, 1] },
      { root: 7, pcs: [0, 2, 9, 7], next: [0, 3] },
    ],
    barsPerChord: [2, 2, 4],
    phraseBars: 8,
    pad: {
      voices: 4, wave: 'sawtooth', detune: 9, low: 55, high: 76, cutoff: 1500, sweep: 0.5, q: 0.8,
      lfoRate: 0.05, lfoDepth: 0.3, level: 0.034, glide: 0.9,
    },
    drone: { level: 0.1, octave: -12, follow: 'root', upper: 0.25, beat: 0, cutoff: 420 },
    melody: {
      tone: { kind: 'pluck', wave: 'triangle', cutoff: 2400, decay: 1.6, level: 0.1, wet: 0.45, echo: 0.5 },
      density: 0.45, low: 69, high: 86, stepMax: 2,
      rhythms: [[0, 1.5, 2, 3], [0, 0.5, 1, 2.5], [0, 2, 2.5, 3], [1, 1.5, 3], [0, 3]],
    },
    sparkle: {
      tone: { kind: 'bell', ratio: 2, index: 1.2, decay: 3.2, level: 0.055, wet: 0.7, echo: 0.6 },
      density: 0.35, low: 81, high: 93, maxNotes: 4, arpRate: 0.5,
    },
    echo: { beats: 0.75, feedback: 0.38, level: 0.35, tone: 2600 },
    reverb: 0.9,
    level: 1.05,
  },

  docked: {
    id: 'docked',
    character: 'Calm lounge: F major sevenths, warm low-pass pads, soft electric-piano comping, brushed off-beats.',
    tempo: 74,
    beatsPerBar: 4,
    key: 53,
    scale: SCALES.major,
    swing: 0.55,
    chords: [
      { root: 0, pcs: [4, 11, 7, 2], next: [1, 2, 4] },
      { root: 9, pcs: [0, 7, 11, 4], next: [2, 3] },
      { root: 2, pcs: [5, 0, 4, 9], next: [3] },
      { root: 7, pcs: [0, 5, 9, 2], next: [0, 4] },
      { root: 5, pcs: [9, 4, 0, 7], next: [3, 0, 5] },
      { root: 4, pcs: [7, 2, 11, 4], next: [1, 4] },
    ],
    barsPerChord: [1, 2, 2],
    phraseBars: 8,
    pad: {
      voices: 4, wave: 'warm', detune: 6, low: 57, high: 74, cutoff: 950, sweep: 0.3, q: 0.7,
      lfoRate: 0.04, lfoDepth: 0.25, level: 0.03, glide: 0.5,
    },
    drone: { level: 0.12, octave: -12, follow: 'root', upper: 0.3, beat: 0, cutoff: 380 },
    comp: {
      tone: { kind: 'ep', ratio: 1, index: 1.4, decay: 2.4, level: 0.06, wet: 0.35 },
      density: 0.8, low: 60, high: 76,
      rhythms: [[0, 2.5], [0.5, 2], [1.5, 3], [0, 1.5, 3]],
    },
    melody: {
      tone: { kind: 'bell', ratio: 4, index: 0.6, decay: 2.2, level: 0.055, wet: 0.4 },
      density: 0.3, low: 72, high: 84, stepMax: 2,
      rhythms: [[0, 1, 1.5], [0.5, 2], [2, 2.5, 3], [0, 1.5, 2.5, 3]],
    },
    ticks: {
      tone: { kind: 'tick', cutoff: 5200, q: 0.8, decay: 0.14, level: 0.02 },
      density: 0.85,
      patterns: [
        [0, 0, 0, 0, 0.6, 0, 0, 0, 0, 0, 0, 0, 0.6, 0, 0.25, 0],
        [0, 0, 0.2, 0, 0.6, 0, 0, 0, 0, 0, 0.2, 0, 0.6, 0, 0, 0],
      ],
    },
    reverb: 0.55,
    level: 0.95,
  },

  map: {
    id: 'map',
    character: 'Sparse and contemplative: A minor open voicings, thin triangle pads, distant bells with long echoes.',
    tempo: 58,
    beatsPerBar: 4,
    key: 45,
    scale: SCALES.aeolian,
    swing: 0,
    chords: [
      { root: 0, pcs: [3, 7, 2, 0], next: [1, 2, 3, 4] },
      { root: 8, pcs: [0, 7, 3, 2], next: [0, 2] },
      { root: 3, pcs: [7, 2, 10, 3], next: [3, 0] },
      { root: 7, pcs: [0, 5, 2, 7], next: [0, 1] },
      { root: 5, pcs: [8, 3, 7, 0], next: [0, 2] },
    ],
    barsPerChord: [2, 4],
    phraseBars: 8,
    pad: {
      voices: 3, wave: 'triangle', detune: 5, low: 57, high: 72, cutoff: 1100, sweep: 0.35, q: 0.6,
      lfoRate: 0.03, lfoDepth: 0.3, level: 0.045, glide: 1.4,
    },
    drone: { level: 0.08, octave: -12, follow: 'tonic', upper: 0.35, beat: 0, cutoff: 300 },
    sparkle: {
      tone: { kind: 'bell', ratio: 2.76, index: 0.8, decay: 4.5, level: 0.055, wet: 0.8, echo: 0.5 },
      density: 0.4, low: 76, high: 88, maxNotes: 2,
    },
    melody: {
      tone: { kind: 'pluck', wave: 'glass', cutoff: 1800, decay: 2.6, level: 0.065, wet: 0.6, echo: 0.4 },
      density: 0.18, low: 64, high: 79, stepMax: 3,
      rhythms: [[0, 3], [1, 2.5], [0, 1.5]],
    },
    echo: { beats: 1.5, feedback: 0.4, level: 0.35, tone: 2000 },
    reverb: 1,
    level: 1,
  },

  sol: {
    id: 'sol',
    character: 'Gentle and familiar: C major, soft warm pads and a singable stepwise pluck melody.',
    tempo: 76,
    beatsPerBar: 4,
    key: 48,
    scale: SCALES.major,
    swing: 0,
    chords: [
      { root: 0, pcs: [4, 7, 2, 0], next: [1, 2, 3, 5] },
      { root: 11, pcs: [11, 2, 7, 9], next: [2, 0] },
      { root: 9, pcs: [0, 7, 4, 9], next: [3, 4] },
      { root: 5, pcs: [9, 4, 0, 5], next: [0, 4, 5] },
      { root: 2, pcs: [5, 0, 9, 2], next: [5] },
      { root: 7, pcs: [0, 5, 2, 7], next: [0, 3] },
    ],
    barsPerChord: [2, 2, 4],
    phraseBars: 8,
    pad: {
      voices: 4, wave: 'warm', detune: 7, low: 55, high: 74, cutoff: 1250, sweep: 0.4, q: 0.7,
      lfoRate: 0.045, lfoDepth: 0.25, level: 0.032, glide: 0.7,
    },
    drone: { level: 0.1, octave: -12, follow: 'root', upper: 0.3, beat: 0, cutoff: 400 },
    melody: {
      tone: { kind: 'pluck', wave: 'triangle', cutoff: 2000, decay: 1.8, level: 0.1, wet: 0.4, echo: 0.25 },
      density: 0.6, low: 67, high: 84, stepMax: 2,
      rhythms: [[0, 1, 2, 3], [0, 1.5, 2], [0, 0.5, 1, 2], [0, 2, 3], [0, 1, 1.5, 2, 3]],
    },
    sparkle: {
      tone: { kind: 'bell', ratio: 2, index: 0.7, decay: 2.8, level: 0.045, wet: 0.6 },
      density: 0.2, low: 79, high: 91, maxNotes: 2,
    },
    echo: { beats: 0.75, feedback: 0.3, level: 0.25, tone: 2400 },
    reverb: 0.75,
    level: 1,
  },

  'alpha-centauri': {
    id: 'alpha-centauri',
    character: 'Golden and wondrous: E lydian in 3/4, bright detuned saws, rising FM bell arpeggios.',
    tempo: 84,
    beatsPerBar: 3,
    key: 52,
    scale: SCALES.lydian,
    swing: 0,
    chords: [
      { root: 0, pcs: [4, 11, 7, 2], next: [1, 2, 3] },
      { root: 0, pcs: [6, 9, 2, 4], next: [0, 3] },
      { root: 9, pcs: [0, 7, 11, 4], next: [3, 4] },
      { root: 5, pcs: [9, 4, 0, 11], next: [0, 4], scale: SCALES.major },
      { root: 7, pcs: [0, 2, 9, 7], next: [0, 1] },
    ],
    barsPerChord: [2, 4],
    phraseBars: 8,
    pad: {
      voices: 4, wave: 'sawtooth', detune: 10, low: 56, high: 76, cutoff: 1700, sweep: 0.5, q: 0.9,
      lfoRate: 0.06, lfoDepth: 0.3, level: 0.028, glide: 0.8,
    },
    drone: { level: 0.09, octave: -12, follow: 'root', upper: 0.25, beat: 0, cutoff: 450 },
    sparkle: {
      tone: { kind: 'bell', ratio: 2, index: 1.6, decay: 3, level: 0.05, wet: 0.55, echo: 0.4 },
      density: 0.65, low: 71, high: 91, maxNotes: 6, arpRate: 0.5,
    },
    melody: {
      tone: { kind: 'pluck', wave: 'triangle', cutoff: 2600, decay: 2.2, level: 0.07, wet: 0.5, echo: 0.3 },
      density: 0.35, low: 68, high: 86, stepMax: 2,
      rhythms: [[0, 1, 2], [0, 1.5], [0, 2, 2.5], [1, 2]],
    },
    echo: { beats: 1.5, feedback: 0.35, level: 0.3, tone: 3000 },
    reverb: 0.9,
    level: 1.2,
  },

  barnard: {
    id: 'barnard',
    character: 'Dark and sparse: C# phrygian, low hollow pads, beating sub drone, wind, rare dark gongs.',
    tempo: 50,
    beatsPerBar: 4,
    key: 49,
    scale: SCALES.phrygian,
    swing: 0,
    chords: [
      { root: 0, pcs: [3, 7, 0], next: [1, 2, 3] },
      { root: 0, pcs: [1, 5, 8, 0], next: [0, 3] },
      { root: 8, pcs: [0, 7, 3, 8], next: [0, 3] },
      { root: 0, pcs: [10, 1, 5], next: [0, 1] },
    ],
    barsPerChord: [4, 4, 2],
    phraseBars: 8,
    pad: {
      voices: 3, wave: 'hollow', detune: 8, low: 49, high: 66, cutoff: 650, sweep: 0.3, q: 1.2,
      lfoRate: 0.025, lfoDepth: 0.35, level: 0.045, glide: 1.8,
    },
    drone: { level: 0.14, octave: -12, follow: 'tonic', upper: 0.4, beat: 0.3, cutoff: 260 },
    noise: { level: 0.03, freq: 420, q: 0.9, lfoRate: 0.04, lfoDepth: 0.5 },
    melody: {
      tone: { kind: 'pluck', wave: 'sawtooth', cutoff: 600, decay: 1.4, level: 0.07, wet: 0.6 },
      density: 0.2, low: 49, high: 64, stepMax: 1,
      rhythms: [[0, 1.5], [0], [2, 3]],
    },
    sparkle: {
      tone: { kind: 'bell', ratio: 1.41, index: 2.5, decay: 5, level: 0.05, wet: 0.85 },
      density: 0.12, low: 56, high: 68, maxNotes: 1,
    },
    reverb: 0.9,
    level: 0.7,
  },

  sirius: {
    id: 'sirius',
    character: 'Crystalline and bright: B major/lydian, glassy high pads, sparkling 16th-note FM bell runs.',
    tempo: 92,
    beatsPerBar: 4,
    key: 59,
    scale: SCALES.major,
    swing: 0,
    chords: [
      { root: 0, pcs: [4, 11, 7, 2], next: [1, 2, 3] },
      { root: 0, pcs: [6, 9, 2, 4], next: [0, 2], scale: SCALES.lydian },
      { root: 9, pcs: [0, 7, 11, 4], next: [3, 0] },
      { root: 5, pcs: [9, 4, 0, 11], next: [0, 4] },
      { root: 7, pcs: [0, 2, 9, 7], next: [0, 3] },
    ],
    barsPerChord: [2, 2, 4],
    phraseBars: 8,
    pad: {
      voices: 4, wave: 'glass', detune: 6, low: 66, high: 83, cutoff: 3200, sweep: 0.4, q: 0.6,
      lfoRate: 0.07, lfoDepth: 0.25, level: 0.022, glide: 0.6,
    },
    drone: { level: 0.07, octave: -24, follow: 'root', upper: 0.35, beat: 0, cutoff: 500 },
    sparkle: {
      tone: { kind: 'bell', ratio: 3.5, index: 1.1, decay: 1.8, level: 0.045, wet: 0.6, echo: 0.5 },
      density: 0.75, low: 78, high: 98, maxNotes: 8, arpRate: 0.25,
    },
    melody: {
      tone: { kind: 'bell', ratio: 2, index: 0.9, decay: 2.6, level: 0.055, wet: 0.5, echo: 0.3 },
      density: 0.35, low: 74, high: 90, stepMax: 3,
      rhythms: [[0, 1, 2], [0, 1.5, 3], [0.5, 2]],
    },
    echo: { beats: 0.75, feedback: 0.42, level: 0.35, tone: 5000 },
    reverb: 0.9,
    level: 1.35,
  },

  'epsilon-eridani': {
    id: 'epsilon-eridani',
    character: 'Industrial: F dorian, resonant 16th-note pulses and metal ticks under dusty filtered saw pads.',
    tempo: 100,
    beatsPerBar: 4,
    key: 53,
    scale: SCALES.dorian,
    swing: 0,
    chords: [
      { root: 0, pcs: [3, 10, 2, 7], next: [1, 2, 3] },
      { root: 10, pcs: [5, 0, 7, 10], next: [0, 2] },
      { root: 8, pcs: [0, 7, 3, 8], next: [3, 0], scale: SCALES.aeolian },
      { root: 5, pcs: [10, 3, 0, 5], next: [0, 1] },
    ],
    barsPerChord: [2, 4],
    phraseBars: 8,
    pad: {
      voices: 3, wave: 'sawtooth', detune: 12, low: 53, high: 70, cutoff: 800, sweep: 0.35, q: 1.4,
      lfoRate: 0.08, lfoDepth: 0.35, level: 0.03, glide: 0.4,
    },
    drone: { level: 0.09, octave: -12, follow: 'root', upper: 0.3, beat: 0, cutoff: 300 },
    noise: { level: 0.02, freq: 3200, q: 1.5, lfoRate: 0.11, lfoDepth: 0.4 },
    pulse: {
      tone: { kind: 'pulse', wave: 'sawtooth', cutoff: 520, q: 7, decay: 0.16, level: 0.085, wet: 0.15 },
      density: 0.92,
      patterns: [
        [1, 0, 0.5, 0, 0.8, 0, 0.5, 0.3, 1, 0, 0.5, 0, 0.8, 0.3, 0.5, 0],
        [1, 0, 0, 0.6, 0, 0.6, 0, 0, 1, 0, 0, 0.6, 0, 0.6, 0.4, 0],
        [0.9, 0.4, 0.6, 0.4, 0.9, 0.4, 0.6, 0.4, 0.9, 0.4, 0.6, 0.4, 0.9, 0.4, 0.7, 0.5],
      ],
    },
    ticks: {
      tone: { kind: 'tick', cutoff: 6000, q: 3, decay: 0.04, level: 0.03 },
      density: 0.9,
      patterns: [
        [0, 0, 0.7, 0, 0, 0, 0.7, 0, 0, 0, 0.7, 0, 0, 0, 0.7, 0.3],
        [0.3, 0, 0.8, 0, 0.3, 0, 0.8, 0.4, 0.3, 0, 0.8, 0, 0.3, 0.2, 0.8, 0],
      ],
    },
    sparkle: {
      tone: { kind: 'clank', ratio: 2.76, index: 3, decay: 0.6, cutoff: 3000, level: 0.04, wet: 0.5 },
      density: 0.3, low: 70, high: 84, maxNotes: 2,
    },
    melody: {
      tone: { kind: 'pluck', wave: 'square', cutoff: 1400, decay: 0.9, level: 0.05, wet: 0.3, echo: 0.4 },
      density: 0.3, low: 60, high: 75, stepMax: 2,
      rhythms: [[0, 0.75, 1.5], [0, 0.5, 1.5, 2.5], [2, 2.75, 3.5]],
    },
    echo: { beats: 0.75, feedback: 0.35, level: 0.25, tone: 1800 },
    reverb: 0.6,
    level: 1.1,
  },
};

export const MUSIC_MOODS = Object.keys(MOODS) as MusicMood[];

/** Combat pulse tempo multiplier for a mood: the one of 1, 1.5 or 2 landing nearest 124 BPM. */
export function combatTempoMultiplier(tempo: number): number {
  let best = 1;
  for (const m of [1, 1.5, 2]) if (Math.abs(tempo * m - 124) < Math.abs(tempo * best - 124)) best = m;
  return best;
}
