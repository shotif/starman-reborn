import type { EngineSoundState } from './types.ts';
import { clamp01 } from './theory.ts';

/** Pure mapping from flight state to engine-sound parameters (Hz and linear gains). */
export interface EngineTargets {
  /** Base frequency of the detuned hum oscillators. */
  humHz: number;
  humCutoff: number;
  humGain: number;
  subGain: number;
  /** Band centre of the thrust hiss. */
  noiseHz: number;
  noiseGain: number;
  boostGain: number;
  boostCutoff: number;
  cruiseGain: number;
  cruiseHz: number;
  laneGain: number;
  laneHz: number;
  laneToneGain: number;
}

export type EngineParam = keyof EngineTargets;

export const ENGINE_PARAMS: readonly EngineParam[] = [
  'humHz',
  'humCutoff',
  'humGain',
  'subGain',
  'noiseHz',
  'noiseGain',
  'boostGain',
  'boostCutoff',
  'cruiseGain',
  'cruiseHz',
  'laneGain',
  'laneHz',
  'laneToneGain',
];

/** Overall engine trim: keeps a full-throttle hum a few dB under the default music level. */
const LEVEL = 0.2;

export function engineTargets(state: EngineSoundState): EngineTargets {
  const t = clamp01(state.throttle);
  const s = clamp01(state.speed);
  const boost = state.boost ? 1 : 0;
  const cruise = state.cruise && !state.lane ? 1 : 0;
  const lane = state.lane ? 1 : 0;
  // In a lane the ship's own engine recedes under the lane's rush of air.
  const recede = lane ? 0.35 : 1;
  return {
    humHz: 38 + 34 * t + 16 * s + 14 * boost + 10 * cruise,
    humCutoff: 220 + 1100 * t + 400 * s + 1500 * boost + 300 * cruise,
    humGain: LEVEL * (0.05 + 0.09 * t + 0.03 * s + 0.05 * boost) * recede * (cruise ? 0.7 : 1),
    subGain: LEVEL * (0.06 + 0.06 * t) * recede,
    noiseHz: 500 + 900 * t + 1500 * s,
    noiseGain: LEVEL * (0.012 + 0.03 * t + 0.03 * s) * recede,
    boostGain: LEVEL * boost * (0.2 + 0.08 * t),
    boostCutoff: 700 + 900 * t,
    cruiseGain: LEVEL * cruise * (0.05 + 0.03 * s),
    cruiseHz: 520 + 260 * s,
    laneGain: LEVEL * lane * 0.45,
    laneHz: 900 + 600 * s,
    laneToneGain: LEVEL * lane * 0.12,
  };
}

/** Relative tolerance per parameter: pitches move in ~1% steps, gains and cutoffs in ~3%. */
function tolerance(param: EngineParam): number {
  return param.endsWith('Hz') ? 0.01 : 0.03;
}

/** True when `next` differs enough from `prev` to be worth an AudioParam update. */
export function meaningfulChange(prev: number, next: number, rel: number, abs = 0.0005): boolean {
  if (!Number.isFinite(prev)) return true;
  const d = Math.abs(next - prev);
  return d > abs && d > Math.abs(prev) * rel;
}

/** Parameters whose target moved meaningfully since the last applied set. */
export function changedParams(prev: EngineTargets | null, next: EngineTargets): EngineParam[] {
  if (!prev) return ENGINE_PARAMS.slice();
  return ENGINE_PARAMS.filter((k) => meaningfulChange(prev[k], next[k], tolerance(k)));
}
