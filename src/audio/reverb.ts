import { mulberry32 } from './theory.ts';

export interface ImpulseOptions {
  /** Total length in seconds. */
  seconds: number;
  /** Seconds for the tail to fall by 60 dB. */
  rt60: number;
  /** Silence before the tail starts. */
  preDelay: number;
  /** 0..1: how much darker the tail becomes over time. */
  damping: number;
  seed: number;
}

export const DEFAULT_IMPULSE: ImpulseOptions = { seconds: 2.8, rt60: 2.6, preDelay: 0.02, damping: 0.85, seed: 7 };

/**
 * Pure stereo impulse response: decorrelated noise with an exponential decay whose tone darkens
 * over time (a one-pole lowpass with a rising pole), a soft onset and a faded end.
 */
export function generateImpulse(sampleRate: number, o: ImpulseOptions = DEFAULT_IMPULSE): Float32Array<ArrayBuffer>[] {
  const len = Math.max(1, Math.round(o.seconds * sampleRate));
  const pre = Math.min(len, Math.round(o.preDelay * sampleRate));
  const fade = Math.max(1, Math.round(0.05 * sampleRate));
  const onset = 0.01 * sampleRate;
  const step = Math.exp(-6.9078 / (o.rt60 * sampleRate));
  const out: Float32Array<ArrayBuffer>[] = [];
  for (let ch = 0; ch < 2; ch++) {
    const data = new Float32Array(len);
    const rng = mulberry32(o.seed * 2 + ch + 1);
    let lp = 0;
    let env = 1;
    let a = 0;
    let comp = 1;
    for (let i = pre; i < len; i++) {
      const k = i - pre;
      if ((k & 127) === 0) {
        a = Math.min(0.97, 0.15 + 0.8 * o.damping * (k / sampleRate / o.seconds));
        comp = Math.sqrt((1 + a) / (1 - a));
      }
      lp = lp * a + (rng() * 2 - 1) * (1 - a);
      let v = lp * comp * env;
      if (k < onset) v *= k / onset;
      if (i >= len - fade) v *= (len - i) / fade;
      data[i] = v;
      env *= step;
    }
    out.push(data);
  }
  return out;
}

/** Shared reverb: a ConvolverNode loaded with a generated impulse (no audio files). */
export function createReverb(ctx: BaseAudioContext, o: ImpulseOptions = DEFAULT_IMPULSE): ConvolverNode {
  const conv = ctx.createConvolver();
  const [l, r] = generateImpulse(ctx.sampleRate, o);
  const buf = ctx.createBuffer(2, l.length, ctx.sampleRate);
  buf.getChannelData(0).set(l);
  buf.getChannelData(1).set(r);
  conv.normalize = true;
  conv.buffer = buf;
  return conv;
}
