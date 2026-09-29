import type { WaveName } from './moods.ts';
import { mulberry32 } from './theory.ts';

/** Pure sample/curve generators. No Web Audio access: safe to unit test in Node. */

/** Uniform white noise in [-1, 1), deterministic for a given seed. */
export function whiteNoise(length: number, seed: number): Float32Array<ArrayBuffer> {
  const rng = mulberry32(seed);
  const out = new Float32Array(length);
  for (let i = 0; i < length; i++) out[i] = rng() * 2 - 1;
  return out;
}

/** Odd-symmetric tanh soft-clip curve for a WaveShaperNode, normalised to +/-1. */
export function softClipCurve(length: number, drive: number): Float32Array<ArrayBuffer> {
  const out = new Float32Array(length);
  const norm = Math.tanh(drive);
  for (let i = 0; i < length; i++) {
    const x = (i / (length - 1)) * 2 - 1;
    out[i] = Math.tanh(drive * x) / norm;
  }
  return out;
}

/**
 * Output safety curve: identity up to `knee`, then a tanh shoulder that never reaches full scale.
 * Transparent at normal levels; only extreme pile-ups that get past the limiter are rounded off.
 */
export function safetyCurve(length: number, knee = 0.75): Float32Array<ArrayBuffer> {
  const out = new Float32Array(length);
  const room = 0.99 - knee;
  for (let i = 0; i < length; i++) {
    const x = (i / (length - 1)) * 2 - 1;
    const a = Math.abs(x);
    out[i] = a <= knee ? x : Math.sign(x) * (knee + room * Math.tanh((a - knee) / room));
  }
  return out;
}

export type CustomWave = Exclude<WaveName, OscillatorType>;

/** Harmonic amplitudes (index = harmonic number, 0 = DC) for the custom pad/pluck waves. */
export function waveHarmonics(name: CustomWave, count = 24): Float32Array<ArrayBuffer> {
  const amps = new Float32Array(count + 1);
  for (let n = 1; n <= count; n++) {
    if (name === 'warm') amps[n] = 1 / n ** 1.7;
    else if (name === 'hollow') amps[n] = n % 2 === 1 ? 1 / n ** 1.4 : 0.15 / (n * n);
    else amps[n] = ({ 1: 1, 2: 0.25, 3: 0.3, 4: 0.12, 6: 0.08, 8: 0.05 } as Record<number, number>)[n] ?? 0;
  }
  return amps;
}
