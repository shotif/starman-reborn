import type { AudioVolumes } from './types.ts';
import { safetyCurve } from './dsp.ts';
import { createReverb } from './reverb.ts';
import { safeDisconnect } from './synth.ts';
import type { BusInput } from './synth.ts';
import { volumeToGain } from './theory.ts';

export const DEFAULT_VOLUMES: Readonly<AudioVolumes> = { master: 0.8, music: 0.6, sfx: 0.8 };

/** Smooth gain changes: time constant for volume/mute moves (seconds). */
const GAIN_SMOOTHING = 0.05;

/**
 * Bus trims calibrated with the dev lab's offline renders: at default volumes the music sits
 * around -23 dBFS RMS, weapons peak near -11 dBFS and the largest impacts near -3 dBFS.
 */
const MUSIC_TRIM = 2.2;
const SFX_TRIM = 2.5;

/**
 * music bus ─┐                    ┌─ dry ───────────────────────────┐
 * sfx bus  ──┴─ (post-fader sends) ┴─ wet → highpass → convolver ──┴─ master → limiter → safety → out
 * Each bus is a dry/wet pair of gains driven by the same volume, so the reverb tail follows it.
 */
export class MixGraph {
  readonly ctx: BaseAudioContext;
  readonly music: BusInput;
  readonly sfx: BusInput;
  private readonly master: GainNode;
  private readonly limiter: DynamicsCompressorNode;
  private readonly musicDry: GainNode;
  private readonly musicWet: GainNode;
  private readonly sfxDry: GainNode;
  private readonly sfxWet: GainNode;
  private readonly nodes: AudioNode[] = [];

  constructor(ctx: BaseAudioContext, dest: AudioNode = ctx.destination) {
    this.ctx = ctx;
    this.master = this.gain(0);
    this.limiter = this.track(ctx.createDynamicsCompressor());
    // Peak control rather than pumping: high threshold, fast attack, moderate release.
    this.limiter.threshold.value = -10;
    this.limiter.knee.value = 8;
    this.limiter.ratio.value = 8;
    this.limiter.attack.value = 0.003;
    this.limiter.release.value = 0.2;
    // Final safety net: transparent below -2.5 dBFS, rounds off anything that slips past the limiter.
    const safety = this.track(ctx.createWaveShaper());
    safety.curve = safetyCurve(2049);
    this.master.connect(this.limiter);
    this.limiter.connect(safety);
    safety.connect(dest);

    const reverbIn = this.track(ctx.createBiquadFilter());
    reverbIn.type = 'highpass';
    reverbIn.frequency.value = 180;
    const reverb = this.track(createReverb(ctx));
    reverbIn.connect(reverb);
    reverb.connect(this.master);

    this.musicDry = this.gain(0);
    this.musicWet = this.gain(0);
    this.sfxDry = this.gain(0);
    this.sfxWet = this.gain(0);
    this.musicDry.connect(this.master);
    this.sfxDry.connect(this.master);
    this.musicWet.connect(reverbIn);
    this.sfxWet.connect(reverbIn);
    this.music = { dry: this.musicDry, wet: this.musicWet };
    this.sfx = { dry: this.sfxDry, wet: this.sfxWet };
  }

  /** Applies volumes (perceptual taper) and mute with smoothed ramps. */
  apply(v: AudioVolumes, muted: boolean, at = this.ctx.currentTime, smoothing = GAIN_SMOOTHING): void {
    const set = (p: AudioParam, value: number): void => {
      p.cancelScheduledValues(at);
      p.setTargetAtTime(value, at, smoothing);
    };
    set(this.master.gain, muted ? 0 : volumeToGain(v.master));
    const music = volumeToGain(v.music) * MUSIC_TRIM;
    const sfx = volumeToGain(v.sfx) * SFX_TRIM;
    set(this.musicDry.gain, music);
    set(this.musicWet.gain, music);
    set(this.sfxDry.gain, sfx);
    set(this.sfxWet.gain, sfx);
  }

  dispose(): void {
    this.nodes.forEach(safeDisconnect);
  }

  private track<T extends AudioNode>(n: T): T {
    this.nodes.push(n);
    return n;
  }

  private gain(value: number): GainNode {
    const g = this.track(this.ctx.createGain());
    g.gain.value = value;
    return g;
  }
}
