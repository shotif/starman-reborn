import type { ChordDef, CompDef, MelodyDef, MoodDef, PatternDef, SparkleDef } from './moods.ts';
import {
  between,
  chance,
  clamp,
  clamp01,
  degreeToMidi,
  mulberry32,
  nearestDegree,
  nearestNote,
  notesInRange,
  pick,
  pitchClass,
  voiceLead,
  weightedIndex,
} from './theory.ts';
import type { Rng } from './theory.ts';

/** Deterministic, seeded generative score. Pure: produces note plans, never touches Web Audio. */

export type Part = 'melody' | 'sparkle' | 'comp' | 'pulse' | 'ticks';

export interface NoteEvent {
  /** Onset in beats from the start of the bar. */
  beat: number;
  part: Part;
  midi: number;
  /** 0..1 */
  vel: number;
  /** Nominal length in beats. */
  dur: number;
  /** -1..1 */
  pan: number;
}

export interface BarPlan {
  index: number;
  /** Index into the mood's chord list. */
  chord: number;
  chordChanged: boolean;
  /** Drone / bass note (MIDI). */
  drone: number;
  /** Pad voicing, ascending, one MIDI note per pad voice. */
  pad: number[];
  /** 0..1 target for the pad filter this bar. */
  brightness: number;
  /** Sorted by onset. */
  events: NoteEvent[];
}

interface MotifNote {
  beat: number;
  step: number;
  len: number;
}

const STEPS_PER_BEAT = 4;

/** Delays off-beat eighths (and, half as much, off-beat sixteenths) for a swung feel. */
export function swingBeat(beat: number, swing: number): number {
  if (swing <= 0) return beat;
  const frac = beat - Math.floor(beat);
  if (Math.abs(frac - 0.5) < 1e-6) return beat + swing / 6;
  if (Math.abs(frac - 0.25) < 1e-6 || Math.abs(frac - 0.75) < 1e-6) return beat + swing / 12;
  return beat;
}

export class Composer {
  readonly def: MoodDef;
  private readonly rng: Rng;
  private bar = 0;
  private chord = 0;
  private chordBarsLeft = 0;
  private voicing: number[] | null = null;
  private motif: MotifNote[] | null = null;
  private lastMelody: number;
  private readonly patterns = new Map<Part, readonly number[]>();

  constructor(def: MoodDef, seed: number) {
    this.def = def;
    this.rng = mulberry32(seed);
    this.lastMelody = def.melody ? Math.round((def.melody.low + def.melody.high) / 2) : def.key + 12;
  }

  get barIndex(): number {
    return this.bar;
  }

  nextBar(): BarPlan {
    const { def, rng } = this;
    const index = this.bar++;
    const phrasePos = index % def.phraseBars;

    let changed = false;
    if (index === 0) {
      changed = true;
      this.chordBarsLeft = pick(rng, def.barsPerChord);
    } else if (--this.chordBarsLeft <= 0) {
      let next = pick(rng, def.chords[this.chord].next);
      // Phrase starts lean back towards the home chord so the harmony keeps its centre.
      if (phrasePos === 0 && this.chord !== 0 && chance(rng, 0.35)) next = 0;
      changed = next !== this.chord;
      this.chord = next;
      this.chordBarsLeft = pick(rng, def.barsPerChord);
    }
    const chord = def.chords[this.chord];
    const voicing =
      changed || !this.voicing
        ? voiceLead(this.voicing, def.key, chord.pcs, def.pad.voices, def.pad.low, def.pad.high)
        : this.voicing;
    this.voicing = voicing;

    const base = def.key + def.drone.octave;
    let drone = base;
    if (def.drone.follow === 'root') {
      const pc = pitchClass(chord.root);
      drone = base + pc > base + 6 ? base + pc - 12 : base + pc;
    }

    const arc = Math.sin((Math.PI * (phrasePos + 0.5)) / def.phraseBars);
    const brightness = clamp01(0.3 + 0.5 * arc + between(rng, -0.08, 0.08));

    const events: NoteEvent[] = [];
    const scale = chord.scale ?? def.scale;
    if (def.melody) this.melody(events, def.melody, chord, scale, phrasePos);
    if (def.sparkle) this.sparkle(events, def.sparkle, chord, phrasePos);
    if (def.comp) this.comp(events, def.comp, chord);
    if (def.pulse) this.pattern(events, 'pulse', def.pulse, chord, phrasePos);
    if (def.ticks) this.pattern(events, 'ticks', def.ticks, chord, phrasePos);
    const bpb = def.beatsPerBar;
    for (const e of events) e.beat = clamp(swingBeat(e.beat, def.swing), 0, bpb - 0.01);
    events.sort((a, b) => a.beat - b.beat);

    return { index, chord: this.chord, chordChanged: changed, drone, pad: voicing.slice(), brightness, events };
  }

  private makeMotif(m: MelodyDef): MotifNote[] {
    const { rng } = this;
    const bpb = this.def.beatsPerBar;
    const rhythm = pick(rng, m.rhythms).filter((b) => b < bpb);
    let step = 0;
    return rhythm.map((beat, i) => {
      const next = i + 1 < rhythm.length ? rhythm[i + 1] : bpb;
      const note = { beat, step, len: Math.max(0.5, next - beat) };
      // Mostly stepwise, the occasional leap.
      const size = chance(rng, 0.12) ? m.stepMax + 1 : chance(rng, 0.6) ? 1 : Math.min(2, m.stepMax);
      step = clamp(step + (chance(rng, 0.5) ? size : -size), -6, 6);
      return note;
    });
  }

  private melody(out: NoteEvent[], m: MelodyDef, chord: ChordDef, scale: readonly number[], phrasePos: number): void {
    const { rng, def } = this;
    if (phrasePos === 0 && (!this.motif || chance(rng, 0.55))) this.motif = this.makeMotif(m);
    const breath = phrasePos === def.phraseBars - 1 ? 0.5 : 1;
    if (!chance(rng, m.density * breath)) return;
    const bpb = def.beatsPerBar;
    let notes = (this.motif ?? this.makeMotif(m)).map((n) => ({ ...n }));
    switch (weightedIndex(rng, [4, 2, 2, 1.5, 1.5])) {
      case 1: // inverted contour
        notes = notes.map((n) => ({ ...n, step: -n.step }));
        break;
      case 2: // thinned
        notes = notes.filter((_, i) => i === 0 || chance(rng, 0.65));
        break;
      case 3: // tail only
        notes = notes.slice(Math.floor(notes.length / 2));
        break;
      case 4: {
        // displaced
        const shift = pick(rng, [0.5, 1]);
        notes = notes.map((n) => ({ ...n, beat: n.beat + shift })).filter((n) => n.beat < bpb);
        break;
      }
      default:
        break;
    }
    const tones = notesInRange(def.key, chord.pcs, m.low, m.high);
    const anchor = nearestNote(tones, this.lastMelody + pick(rng, [-2, 0, 0, 2]));
    const anchorDeg = nearestDegree(def.key, scale, anchor);
    for (const n of notes) {
      let midi = degreeToMidi(def.key, scale, anchorDeg + n.step);
      const strong = n.beat === 0 || (bpb === 4 && n.beat === 2);
      if (strong) midi = nearestNote(tones, midi);
      while (midi > m.high) midi -= 12;
      while (midi < m.low) midi += 12;
      out.push({
        beat: Math.max(0, n.beat + between(rng, -0.012, 0.012)),
        part: 'melody',
        midi,
        vel: (strong ? 0.8 : 0.6) + between(rng, 0, 0.15),
        dur: n.len,
        pan: between(rng, -0.35, 0.35),
      });
      this.lastMelody = midi;
    }
  }

  private sparkle(out: NoteEvent[], s: SparkleDef, chord: ChordDef, phrasePos: number): void {
    const { rng, def } = this;
    if (!chance(rng, s.density * (phrasePos === 0 ? 1.2 : 1))) return;
    const tones = notesInRange(def.key, chord.pcs, s.low, s.high);
    if (tones.length === 0) return;
    const bpb = def.beatsPerBar;
    const count = 1 + Math.floor(rng() * s.maxNotes);
    if (s.arpRate) {
      const rate = s.arpRate;
      const n = Math.min(count, tones.length, Math.floor(bpb / rate));
      const up = chance(rng, 0.7);
      const slots = Math.max(1, Math.floor((bpb - (n - 1) * rate) / rate));
      const start = Math.floor(rng() * slots) * rate;
      const first = up ? Math.floor(rng() * (tones.length - n + 1)) : tones.length - 1 - Math.floor(rng() * (tones.length - n + 1));
      for (let i = 0; i < n; i++) {
        const beat = start + i * rate;
        if (beat >= bpb) break;
        out.push({
          beat,
          part: 'sparkle',
          midi: tones[first + (up ? i : -i)],
          vel: 0.45 + 0.3 * (1 - i / n) + between(rng, 0, 0.1),
          dur: rate,
          pan: n > 1 ? -0.45 + (0.9 * i) / (n - 1) : 0,
        });
      }
      return;
    }
    const used = new Set<number>();
    for (let i = 0; i < count; i++) {
      const beat = Math.floor(rng() * bpb * 2) / 2;
      if (used.has(beat)) continue;
      used.add(beat);
      out.push({
        beat: beat + between(rng, 0, 0.012),
        part: 'sparkle',
        midi: pick(rng, tones),
        vel: 0.45 + 0.35 * rng(),
        dur: 1,
        pan: between(rng, -0.5, 0.5),
      });
    }
  }

  private comp(out: NoteEvent[], c: CompDef, chord: ChordDef): void {
    const { rng, def } = this;
    if (!chance(rng, c.density)) return;
    const centre = (c.low + c.high) / 2;
    // Shell voicing: the chord's two most characteristic tones near the middle of the register.
    const shell = chord.pcs.slice(0, 2).map((pc) => nearestNote(notesInRange(def.key, [pc], c.low, c.high), centre));
    const rhythm = pick(rng, c.rhythms).filter((b) => b < def.beatsPerBar);
    for (const beat of rhythm) {
      shell.forEach((midi, i) => {
        out.push({
          beat: beat + i * 0.03,
          part: 'comp',
          midi,
          vel: (beat === 0 ? 0.65 : 0.55) + between(rng, 0, 0.12),
          dur: 1,
          pan: between(rng, -0.2, 0.2),
        });
      });
    }
  }

  private pattern(out: NoteEvent[], part: Part, p: PatternDef, chord: ChordDef, phrasePos: number): void {
    const { rng, def } = this;
    let base = this.patterns.get(part);
    if (!base || phrasePos === 0) {
      base = pick(rng, p.patterns);
      this.patterns.set(part, base);
    }
    if (!chance(rng, p.density)) return;
    const steps = base.slice(0, def.beatsPerBar * STEPS_PER_BEAT);
    // Small per-bar mutation keeps the loop from sounding mechanical.
    if (chance(rng, 0.35)) {
      const i = Math.floor(rng() * steps.length);
      steps[i] = steps[i] > 0 && i % 4 !== 0 ? 0 : 0.35;
    }
    const bass = def.key - 12 + pitchClass(chord.root);
    steps.forEach((v, i) => {
      if (v <= 0) return;
      out.push({
        beat: i / STEPS_PER_BEAT,
        part,
        midi: part === 'pulse' ? (v >= 0.9 && chance(rng, 0.15) ? bass + 12 : bass) : 0,
        vel: v,
        dur: 1 / STEPS_PER_BEAT,
        pan: part === 'ticks' ? between(rng, -0.3, 0.3) : 0,
      });
    });
  }
}

/** One sixteenth step of the combat layer. Zero means "no hit". */
export interface CombatStep {
  pulse: number;
  /** 1 = play the pulse an octave up. */
  octave: number;
  hat: number;
  open: boolean;
  kick: number;
  stab: number;
}

/** Sixteen-step combat pattern for a given intensity: denser and busier as intensity rises. */
export function combatBar(intensity: number, rng: Rng, bar: number): CombatStep[] {
  const x = clamp01(intensity);
  const steps: CombatStep[] = [];
  for (let i = 0; i < 16; i++) {
    const s: CombatStep = { pulse: 0, octave: 0, hat: 0, open: false, kick: 0, stab: 0 };
    if (x > 0) {
      const gallop = x > 0.65 && i % 4 === 3;
      if (i % 2 === 0 || gallop) s.pulse = (i % 8 === 0 ? 1 : i % 4 === 0 ? 0.8 : 0.6) * (0.55 + 0.45 * x);
      if (s.pulse > 0 && i === 14 && bar % 2 === 1 && x > 0.5) s.octave = 1;
      if (x >= 0.25 && i % 4 === 2) s.hat = 0.7;
      if (x >= 0.5 && i % 2 === 1) s.hat = i % 4 === 3 ? 0.45 : 0.3;
      if (x >= 0.5 && i % 4 === 0) s.hat = 0.25;
      if (x >= 0.8 && i === 14 && bar % 2 === 1) {
        s.hat = 0.6;
        s.open = true;
      }
      if (s.hat > 0 && !s.open && chance(rng, 0.08)) s.hat = 0;
      if (x >= 0.4 && (i === 0 || i === 8)) s.kick = 0.8 + 0.2 * x;
      if (x >= 0.75 && i === 10 && chance(rng, 0.5)) s.kick = 0.6;
      if (x >= 0.7 && bar % 2 === 1 && i === 12) s.stab = 0.7 + 0.3 * x;
    }
    steps.push(s);
  }
  return steps;
}
