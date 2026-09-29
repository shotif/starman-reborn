import type { EngineSoundState } from './types.ts';
import { changedParams, engineTargets } from './engineParams.ts';
import type { EngineParam, EngineTargets } from './engineParams.ts';
import { resources, safeDisconnect, safeStop, setWave } from './synth.ts';
import type { Resources } from './synth.ts';
import type { WaveName } from './moods.ts';

/** Smooth an AudioParam towards `value` (no clicks; replaces any pending move). */
function glideTo(p: AudioParam, value: number, now: number, tc: number): void {
  p.cancelScheduledValues(now);
  p.setTargetAtTime(value, now, tc);
}

/** The live node graph; cruise and lane layers are only built once first needed. */
class EngineGraph {
  readonly master: GainNode;
  private readonly ctx: BaseAudioContext;
  private readonly res: Resources;
  private readonly nodes: AudioNode[] = [];
  private readonly sources: AudioScheduledSourceNode[] = [];
  private readonly humA: OscillatorNode;
  private readonly humB: OscillatorNode;
  private readonly sub: OscillatorNode;
  private readonly humFilter: BiquadFilterNode;
  private readonly humGain: GainNode;
  private readonly subGain: GainNode;
  private readonly noiseSrc: AudioBufferSourceNode;
  private readonly noiseFilter: BiquadFilterNode;
  private readonly noiseGain: GainNode;
  private readonly boostFilter: BiquadFilterNode;
  private readonly boostGain: GainNode;
  private cruise: { gain: GainNode; a: OscillatorNode; b: OscillatorNode } | null = null;
  private lane: { gain: GainNode; filter: BiquadFilterNode; toneGain: GainNode } | null = null;

  constructor(ctx: BaseAudioContext, res: Resources, dest: AudioNode, now: number, t: EngineTargets) {
    this.ctx = ctx;
    this.res = res;
    this.master = this.gain(0);
    this.master.connect(dest);

    // Hum: two detuned saws through a lowpass that opens with throttle, plus a sub sine.
    this.humFilter = this.biquad('lowpass', t.humCutoff, 1.8);
    this.humGain = this.gain(t.humGain);
    this.humFilter.connect(this.humGain);
    this.humGain.connect(this.master);
    this.humA = this.osc('sawtooth', t.humHz, -8, this.humFilter, now);
    this.humB = this.osc('sawtooth', t.humHz, 9, this.humFilter, now);
    this.subGain = this.gain(t.subGain);
    this.subGain.connect(this.master);
    this.sub = this.osc('sine', t.humHz / 2, 0, this.subGain, now);

    // One noise source feeds thrust hiss, the boost roar and (later) the lane rush.
    this.noiseSrc = this.track(ctx.createBufferSource());
    this.noiseSrc.buffer = res.noise;
    this.noiseSrc.loop = true;
    this.noiseFilter = this.biquad('bandpass', t.noiseHz, 0.9);
    this.noiseGain = this.gain(t.noiseGain);
    this.noiseSrc.connect(this.noiseFilter);
    this.noiseFilter.connect(this.noiseGain);
    this.noiseGain.connect(this.master);
    this.boostFilter = this.biquad('lowpass', t.boostCutoff, 0.7);
    const drive = this.track(ctx.createWaveShaper());
    drive.curve = res.softClip;
    this.boostGain = this.gain(t.boostGain);
    this.noiseSrc.connect(this.boostFilter);
    this.boostFilter.connect(drive);
    drive.connect(this.boostGain);
    this.boostGain.connect(this.master);
    this.noiseSrc.start(now, Math.random() * 1.5);
    this.sources.push(this.noiseSrc);
  }

  /** Applies one parameter target; `prev` picks attack vs release speed for gains. */
  set(p: EngineParam, value: number, now: number, t: EngineTargets, prev: number | undefined): void {
    switch (p) {
      case 'humHz':
        glideTo(this.humA.frequency, value, now, 0.12);
        glideTo(this.humB.frequency, value, now, 0.12);
        glideTo(this.sub.frequency, value / 2, now, 0.12);
        break;
      case 'humCutoff':
        glideTo(this.humFilter.frequency, value, now, 0.1);
        break;
      case 'humGain':
        glideTo(this.humGain.gain, value, now, 0.08);
        break;
      case 'subGain':
        glideTo(this.subGain.gain, value, now, 0.1);
        break;
      case 'noiseHz':
        glideTo(this.noiseFilter.frequency, value, now, 0.12);
        break;
      case 'noiseGain':
        glideTo(this.noiseGain.gain, value, now, 0.1);
        break;
      case 'boostGain':
        glideTo(this.boostGain.gain, value, now, value > (prev ?? 0) ? 0.06 : 0.3);
        break;
      case 'boostCutoff':
        glideTo(this.boostFilter.frequency, value, now, 0.1);
        break;
      case 'cruiseGain':
        if (value > 0 || this.cruise) glideTo(this.ensureCruise(now, t).gain.gain, value, now, 0.35);
        break;
      case 'cruiseHz':
        if (this.cruise) {
          glideTo(this.cruise.a.frequency, value, now, 0.3);
          glideTo(this.cruise.b.frequency, value * 1.5, now, 0.3);
        }
        break;
      case 'laneGain':
        if (value > 0 || this.lane) glideTo(this.ensureLane(now, t).gain.gain, value, now, 0.6);
        break;
      case 'laneHz':
        if (this.lane) glideTo(this.lane.filter.frequency, value, now, 0.4);
        break;
      case 'laneToneGain':
        if (value > 0 || this.lane) glideTo(this.ensureLane(now, t).toneGain.gain, value, now, 0.6);
        break;
    }
  }

  dispose(now: number): void {
    for (const s of this.sources) safeStop(s, now + 0.05);
    const last = this.sources[this.sources.length - 1];
    const cleanup = (): void => this.nodes.forEach(safeDisconnect);
    if (last) last.onended = cleanup;
    else cleanup();
  }

  /** Smooth, higher shimmer for cruise: a vibrato-ed triangle and a fifth above. */
  private ensureCruise(now: number, t: EngineTargets): { gain: GainNode; a: OscillatorNode; b: OscillatorNode } {
    if (this.cruise) return this.cruise;
    const gain = this.gain(0);
    gain.connect(this.master);
    const vib = this.gain(9);
    const a = this.osc('triangle', t.cruiseHz, 0, gain, now);
    const b = this.osc('sine', t.cruiseHz * 1.5, 6, gain, now);
    this.osc('sine', 5.2, 0, vib, now);
    vib.connect(a.detune);
    vib.connect(b.detune);
    this.cruise = { gain, a, b };
    return this.cruise;
  }

  /** Airy lane rush: band-passed noise swept by a slow LFO, plus a soft whistling tone. */
  private ensureLane(now: number, t: EngineTargets): { gain: GainNode; filter: BiquadFilterNode; toneGain: GainNode } {
    if (this.lane) return this.lane;
    const filter = this.biquad('bandpass', t.laneHz, 1.5);
    const gain = this.gain(0);
    this.noiseSrc.connect(filter);
    filter.connect(gain);
    gain.connect(this.master);
    const sweepDepth = this.gain(450);
    sweepDepth.connect(filter.frequency);
    this.osc('sine', 0.17, 0, sweepDepth, now);
    const toneGain = this.gain(0);
    toneGain.connect(this.master);
    const whistle = this.osc('sine', 660, 0, toneGain, now);
    const wobble = this.gain(14);
    wobble.connect(whistle.detune);
    this.osc('sine', 0.6, 0, wobble, now);
    this.lane = { gain, filter, toneGain };
    return this.lane;
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

  private biquad(type: BiquadFilterType, freq: number, q: number): BiquadFilterNode {
    const f = this.track(this.ctx.createBiquadFilter());
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    return f;
  }

  private osc(wave: WaveName, freq: number, detune: number, dest: AudioNode, now: number): OscillatorNode {
    const o = this.track(this.ctx.createOscillator());
    setWave(o, this.res, wave);
    o.frequency.value = freq;
    o.detune.value = detune;
    o.connect(dest);
    o.start(now);
    this.sources.push(o);
    return o;
  }
}

/**
 * Continuous engine sound driven every frame by `update(state)`. Identical frames are ignored and
 * AudioParams are only touched when a target moves meaningfully; `update(null)` fades out and
 * tears the graph down shortly after.
 */
export class EngineSound {
  private readonly ctx: BaseAudioContext;
  private readonly res: Resources;
  private readonly dest: AudioNode;
  private graph: EngineGraph | null = null;
  private applied: EngineTargets | null = null;
  private active = false;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private lastThrottle = NaN;
  private lastSpeed = NaN;
  private lastFlags = -1;

  constructor(ctx: BaseAudioContext, dest: AudioNode) {
    this.ctx = ctx;
    this.res = resources(ctx);
    this.dest = dest;
  }

  get isActive(): boolean {
    return this.active;
  }

  update(state: EngineSoundState | null): void {
    const now = this.ctx.currentTime;
    if (!state) {
      this.silence(now);
      return;
    }
    const flags = (state.boost ? 1 : 0) | (state.cruise ? 2 : 0) | (state.lane ? 4 : 0);
    if (this.active && state.throttle === this.lastThrottle && state.speed === this.lastSpeed && flags === this.lastFlags) {
      return;
    }
    this.lastThrottle = state.throttle;
    this.lastSpeed = state.speed;
    this.lastFlags = flags;

    const next = engineTargets(state);
    if (!this.graph) {
      this.graph = new EngineGraph(this.ctx, this.res, this.dest, now, next);
      // Apply every target once so lazily built layers (cruise, lane) exist if already needed.
      this.applied = null;
    }
    if (!this.active) {
      this.active = true;
      if (this.idleTimer !== null) {
        clearTimeout(this.idleTimer);
        this.idleTimer = null;
      }
      glideTo(this.graph.master.gain, 1, now, 0.15);
    }
    const applied = this.applied ?? { ...next };
    for (const p of changedParams(this.applied, next)) {
      this.graph.set(p, next[p], now, next, applied[p]);
      applied[p] = next[p];
    }
    this.applied = applied;
  }

  dispose(): void {
    if (this.idleTimer !== null) clearTimeout(this.idleTimer);
    this.idleTimer = null;
    this.teardown();
  }

  private silence(now: number): void {
    if (!this.graph || !this.active) return;
    this.active = false;
    glideTo(this.graph.master.gain, 0, now, 0.2);
    // Tear down once the fade is inaudible, unless flight resumes first.
    this.idleTimer = setTimeout(() => {
      this.idleTimer = null;
      if (!this.active) this.teardown();
    }, 2000);
  }

  private teardown(): void {
    this.active = false;
    this.graph?.dispose(this.ctx.currentTime);
    this.graph = null;
    this.applied = null;
    this.lastFlags = -1;
  }
}
