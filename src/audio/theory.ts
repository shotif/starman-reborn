/** Pure music-theory, random and level helpers. No Web Audio access: safe to unit test in Node. */

export type Rng = () => number;

/** Small deterministic PRNG (mulberry32). Returns floats in [0, 1). */
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** FNV-1a 32-bit string hash, used for stable per-mood seeds. */
export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function pick<T>(rng: Rng, items: readonly T[]): T {
  return items[Math.min(items.length - 1, Math.floor(rng() * items.length))];
}

/** Index chosen with probability proportional to its (non-negative) weight. */
export function weightedIndex(rng: Rng, weights: readonly number[]): number {
  let total = 0;
  for (const w of weights) total += Math.max(0, w);
  if (total <= 0) return 0;
  let r = rng() * total;
  for (let i = 0; i < weights.length; i++) {
    r -= Math.max(0, weights[i]);
    if (r < 0) return i;
  }
  return weights.length - 1;
}

export function chance(rng: Rng, p: number): boolean {
  return rng() < p;
}

export function between(rng: Rng, lo: number, hi: number): number {
  return lo + (hi - lo) * rng();
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Clamps to 0..1; non-finite input becomes 0. */
export function clamp01(v: number): number {
  return Number.isFinite(v) ? clamp(v, 0, 1) : 0;
}

const A4_MIDI = 69;
const A4_HZ = 440;

export function midiToFreq(midi: number): number {
  return A4_HZ * 2 ** ((midi - A4_MIDI) / 12);
}

export function freqToMidi(hz: number): number {
  return A4_MIDI + 12 * Math.log2(hz / A4_HZ);
}

export function gainToDb(gain: number): number {
  return gain > 0 ? 20 * Math.log10(gain) : -Infinity;
}

/** Perceptual taper for 0..1 volume sliders: squared, so 0.5 is about -12 dB. */
export function volumeToGain(v: number): number {
  const c = clamp01(v);
  return c * c;
}

export const SCALES = {
  major: [0, 2, 4, 5, 7, 9, 11],
  lydian: [0, 2, 4, 6, 7, 9, 11],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  aeolian: [0, 2, 3, 5, 7, 8, 10],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
} as const satisfies Record<string, readonly number[]>;

export function pitchClass(n: number): number {
  return ((Math.round(n) % 12) + 12) % 12;
}

/** MIDI note of a scale degree; degrees may be negative or span several octaves. */
export function degreeToMidi(key: number, scale: readonly number[], degree: number): number {
  const n = scale.length;
  const d = Math.round(degree);
  const oct = Math.floor(d / n);
  return key + oct * 12 + scale[d - oct * n];
}

/** Scale degree whose note is nearest to `midi` (ties resolve downward). */
export function nearestDegree(key: number, scale: readonly number[], midi: number): number {
  const n = scale.length;
  const oct = Math.floor((midi - key) / 12);
  let best = oct * n;
  let bestDist = Infinity;
  for (let d = (oct - 1) * n; d < (oct + 2) * n; d++) {
    const dist = Math.abs(degreeToMidi(key, scale, d) - midi);
    if (dist < bestDist) {
      bestDist = dist;
      best = d;
    }
  }
  return best;
}

export function inScale(key: number, scale: readonly number[], midi: number): boolean {
  return scale.includes(pitchClass(midi - key));
}

/** All MIDI notes in [lo, hi] whose pitch class relative to `key` is one of `pcs`. */
export function notesInRange(key: number, pcs: readonly number[], lo: number, hi: number): number[] {
  const set = new Set(pcs.map(pitchClass));
  const out: number[] = [];
  for (let m = Math.ceil(lo); m <= hi; m++) if (set.has(pitchClass(m - key))) out.push(m);
  return out;
}

/** Note in `notes` nearest to `target` (ties go lower). Returns `target` for an empty list. */
export function nearestNote(notes: readonly number[], target: number): number {
  let best = target;
  let bestDist = Infinity;
  for (const n of notes) {
    const d = Math.abs(n - target);
    if (d < bestDist) {
      bestDist = d;
      best = n;
    }
  }
  return best;
}

function spreadTargets(voices: number, lo: number, hi: number): number[] {
  const a = lo + (hi - lo) * 0.2;
  const b = hi - (hi - lo) * 0.2;
  return Array.from({ length: voices }, (_, i) => (voices === 1 ? (a + b) / 2 : a + ((b - a) * i) / (voices - 1)));
}

/**
 * Picks `voices` distinct chord notes in [lo, hi] that move as little as possible from `prev`
 * (smooth voice leading) while covering the chord's priority tones: the first distinct pitch
 * classes of `pcs`. Returns notes in ascending order.
 */
export function voiceLead(
  prev: readonly number[] | null,
  key: number,
  pcs: readonly number[],
  voices: number,
  lo: number,
  hi: number,
): number[] {
  const cands = notesInRange(key, pcs, lo, hi);
  if (cands.length === 0) return spreadTargets(voices, lo, hi).map(Math.round);
  if (cands.length <= voices) {
    const out = cands.slice();
    while (out.length < voices) out.push(out[out.length - 1]);
    return out;
  }
  const distinct: number[] = [];
  for (const p of pcs) {
    const pc = pitchClass(p);
    if (!distinct.includes(pc)) distinct.push(pc);
  }
  const required = distinct.slice(0, Math.min(voices, distinct.length));
  const target = prev && prev.length === voices ? prev.slice().sort((x, y) => x - y) : spreadTargets(voices, lo, hi);

  let best: number[] = cands.slice(0, voices);
  let bestCost = Infinity;
  const combo: number[] = [];
  const visit = (start: number): void => {
    if (combo.length === voices) {
      let cost = 0;
      for (let i = 0; i < voices; i++) cost += Math.abs(combo[i] - target[i]);
      for (const pc of required) if (!combo.some((n) => pitchClass(n - key) === pc)) cost += 7;
      // Close intervals low in the register sound muddy.
      for (let i = 1; i < voices; i++) if (combo[i - 1] < 55 && combo[i] - combo[i - 1] < 3) cost += 3;
      if (cost < bestCost) {
        bestCost = cost;
        best = combo.slice();
      }
      return;
    }
    for (let i = start; i <= cands.length - (voices - combo.length); i++) {
      combo.push(cands[i]);
      visit(i + 1);
      combo.pop();
    }
  };
  visit(0);
  return best;
}
