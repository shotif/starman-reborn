import type { WaveName } from './moods.ts';
import { softClipCurve, waveHarmonics, whiteNoise } from './dsp.ts';
import type { CustomWave } from './dsp.ts';
import { clamp } from './theory.ts';

/** Where a sound sends its dry signal and its reverb send. */
export interface BusInput {
  dry: AudioNode;
  wet: AudioNode;
}

/** Per-context shared assets, built once so individual sounds allocate nothing but their nodes. */
export interface Resources {
  readonly ctx: BaseAudioContext;
  /** Two seconds of mono white noise shared by every noisy sound. */
  readonly noise: AudioBuffer;
  readonly softClip: Float32Array<ArrayBuffer>;
  readonly canPan: boolean;
  readonly waves: Map<CustomWave, PeriodicWave>;
}

const cache = new WeakMap<BaseAudioContext, Resources>();

export function resources(ctx: BaseAudioContext): Resources {
  let res = cache.get(ctx);
  if (!res) {
    const len = Math.round(ctx.sampleRate * 2);
    const noise = ctx.createBuffer(1, len, ctx.sampleRate);
    noise.getChannelData(0).set(whiteNoise(len, 1234));
    res = {
      ctx,
      noise,
      softClip: softClipCurve(1024, 2.2),
      canPan: typeof ctx.createStereoPanner === 'function',
      waves: new Map(),
    };
    cache.set(ctx, res);
  }
  return res;
}

export function setWave(o: OscillatorNode, res: Resources, wave: WaveName): void {
  if (wave === 'sine' || wave === 'triangle' || wave === 'sawtooth' || wave === 'square') {
    o.type = wave;
    return;
  }
  let pw = res.waves.get(wave);
  if (!pw) {
    const imag = waveHarmonics(wave);
    pw = res.ctx.createPeriodicWave(new Float32Array(imag.length), imag);
    res.waves.set(wave, pw);
  }
  o.setPeriodicWave(pw);
}

/** Stereo panner, or a plain gain where StereoPannerNode is missing (older iOS). */
export function createPanner(ctx: BaseAudioContext, pan: number): AudioNode {
  if (typeof ctx.createStereoPanner !== 'function') return ctx.createGain();
  const p = ctx.createStereoPanner();
  p.pan.value = clamp(pan, -1, 1);
  return p;
}

export function safeDisconnect(n: AudioNode): void {
  try {
    n.disconnect();
  } catch {
    // already disconnected
  }
}

export function safeStop(s: AudioScheduledSourceNode, at: number): void {
  try {
    s.stop(at);
  } catch {
    // not started or already stopped
  }
}

/**
 * The nodes making up one sound. Sources registered with `play` are started/stopped at the given
 * times; once the last one ends every node is disconnected and `onDone` fires.
 */
export class Voice {
  readonly ctx: BaseAudioContext;
  readonly out: GainNode;
  end = 0;
  onDone: (() => void) | null = null;
  private readonly nodes: AudioNode[] = [];
  private readonly sources: AudioScheduledSourceNode[] = [];
  private live = 0;
  private done = false;

  constructor(ctx: BaseAudioContext, dest: AudioNode, level: number, pan = 0, wetDest: AudioNode | null = null, wet = 0) {
    this.ctx = ctx;
    this.out = ctx.createGain();
    this.out.gain.value = level;
    this.nodes.push(this.out);
    let tail: AudioNode = this.out;
    if (pan !== 0 && typeof ctx.createStereoPanner === 'function') {
      tail = this.add(createPanner(ctx, pan));
      this.out.connect(tail);
    }
    tail.connect(dest);
    if (wetDest && wet > 0) {
      const send = this.add(ctx.createGain());
      send.gain.value = wet;
      tail.connect(send);
      send.connect(wetDest);
    }
  }

  get finished(): boolean {
    return this.done;
  }

  add<T extends AudioNode>(node: T): T {
    this.nodes.push(node);
    return node;
  }

  play<T extends AudioScheduledSourceNode>(src: T, start: number, stop: number): T {
    this.track(src, stop);
    src.start(start);
    src.stop(stop);
    return src;
  }

  playBuffer(src: AudioBufferSourceNode, start: number, stop: number, offset: number): AudioBufferSourceNode {
    this.track(src, stop);
    src.start(start, offset);
    src.stop(stop);
    return src;
  }

  private track(src: AudioScheduledSourceNode, stop: number): void {
    this.nodes.push(src);
    this.sources.push(src);
    this.live++;
    src.onended = () => {
      if (--this.live <= 0) this.finish();
    };
    if (stop > this.end) this.end = stop;
  }

  /** Quick fade and early stop, used for voice stealing and teardown. */
  release(at: number, fade = 0.012): void {
    if (this.done) return;
    const g = this.out.gain;
    g.cancelScheduledValues(at);
    g.setTargetAtTime(0, at, fade);
    const stopAt = at + fade * 6;
    if (stopAt < this.end) {
      for (const s of this.sources) safeStop(s, stopAt);
      this.end = stopAt;
    }
  }

  private finish(): void {
    if (this.done) return;
    this.done = true;
    for (const n of this.nodes) safeDisconnect(n);
    this.onDone?.();
  }
}

// ---- node helpers (all register with the voice so they are cleaned up) ----

export function osc(v: Voice, res: Resources, wave: WaveName, freq: number, start: number, stop: number): OscillatorNode {
  const o = v.ctx.createOscillator();
  setWave(o, res, wave);
  o.frequency.value = freq;
  return v.play(o, start, stop);
}

/** Looping slice of the shared noise buffer from a random offset (decorrelates simultaneous uses). */
export function noise(v: Voice, res: Resources, start: number, stop: number, rate = 1): AudioBufferSourceNode {
  const src = v.ctx.createBufferSource();
  src.buffer = res.noise;
  src.loop = true;
  src.playbackRate.value = rate;
  return v.playBuffer(src, start, stop, Math.random() * (res.noise.duration - 0.1));
}

export function filter(v: Voice, type: BiquadFilterType, freq: number, q = 0.707): BiquadFilterNode {
  const f = v.add(v.ctx.createBiquadFilter());
  f.type = type;
  f.frequency.value = freq;
  f.Q.value = q;
  return f;
}

export function amp(v: Voice, value = 0): GainNode {
  const g = v.add(v.ctx.createGain());
  g.gain.value = value;
  return g;
}

export function shaper(v: Voice, res: Resources): WaveShaperNode {
  const s = v.add(v.ctx.createWaveShaper());
  s.curve = res.softClip;
  s.oversample = '2x';
  return s;
}

/** Connects nodes in series; the last target may be an AudioParam (modulation). */
export function chain(first: AudioNode, ...rest: (AudioNode | AudioParam)[]): void {
  let prev = first;
  for (const next of rest) {
    if ('connect' in next) {
      prev.connect(next);
      prev = next;
    } else {
      prev.connect(next);
    }
  }
}

/** Linear attack to `peak`, exponential decay to silence; returns the end time. */
export function perc(p: AudioParam, start: number, attack: number, decay: number, peak: number): number {
  const a = Math.max(0.001, attack);
  const end = start + a + Math.max(0.005, decay);
  p.setValueAtTime(0, start);
  p.linearRampToValueAtTime(Math.max(0.0002, peak), start + a);
  p.exponentialRampToValueAtTime(0.0001, end);
  p.setValueAtTime(0, end);
  return end;
}

/** Attack, hold at `peak`, then exponential release; returns the end time. */
export function ahr(p: AudioParam, start: number, attack: number, hold: number, release: number, peak: number): number {
  const a = Math.max(0.001, attack);
  const end = start + a + hold + Math.max(0.005, release);
  p.setValueAtTime(0, start);
  p.linearRampToValueAtTime(Math.max(0.0002, peak), start + a);
  p.setValueAtTime(Math.max(0.0002, peak), start + a + hold);
  p.exponentialRampToValueAtTime(0.0001, end);
  p.setValueAtTime(0, end);
  return end;
}

/** Exponential sweep between two positive values. */
export function sweep(p: AudioParam, from: number, to: number, start: number, dur: number): void {
  p.setValueAtTime(Math.max(0.0001, from), start);
  p.exponentialRampToValueAtTime(Math.max(0.0001, to), start + Math.max(0.001, dur));
}
