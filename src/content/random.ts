/**
 * Deterministic randomness and rounding for content generators (docs/PROCGEN.md §3).
 * Generators never call Math.random(): every decision draws from a stream keyed by what it is for,
 * so adding an item never shifts the numbers of another.
 */

/** FNV-1a (32-bit) hash of a string. */
export function hashString(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export interface Rng {
  /** Uniform in [0, 1). */
  next(): number;
  /** Uniform in [min, max). */
  range(min: number, max: number): number;
  /** Integer in [min, max]. */
  int(min: number, max: number): number;
  pick<T>(items: readonly T[]): T;
  /** A shuffled copy. */
  shuffle<T>(items: readonly T[]): T[];
}

/** An independent stream for (seed, ...keys), e.g. `rng(seed, 'ship-names', 'halden')`. */
export function rng(seed: number, ...keys: readonly (string | number)[]): Rng {
  let state = hashString(`${seed >>> 0}|${keys.join('|')}`);
  // mulberry32
  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (min: number, max: number): number => min + Math.floor(next() * (max - min + 1));
  return {
    next,
    range: (min, max) => min + next() * (max - min),
    int,
    pick: (items) => {
      if (items.length === 0) throw new RangeError('pick from an empty list');
      return items[int(0, items.length - 1)]!;
    },
    shuffle: (items) => {
      const out = items.slice();
      for (let i = out.length - 1; i > 0; i--) {
        const j = int(0, i);
        [out[i], out[j]] = [out[j]!, out[i]!];
      }
      return out;
    },
  };
}

/** Rounds to a multiple of `step` without floating-point dust (0.1 + 0.2 stays 0.3). */
export function roundTo(value: number, step: number): number {
  const decimals = Math.max(0, Math.ceil(-Math.log10(step)) + 1);
  return Number((Math.round(value / step) * step).toFixed(decimals));
}

/** Prices read like price tags: 1 cr steps under 200, then 5, 50 and 100. */
export function roundPrice(value: number): number {
  const step = value >= 20_000 ? 100 : value >= 2_000 ? 50 : value >= 200 ? 5 : 1;
  return Math.max(1, roundTo(value, step));
}

export const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V'] as const;
