import type { AmbienceRoom, AudioVolumes, EngineSoundState, MusicMood, SfxId, SfxOptions } from './types.ts';
import { AMBIENCE_LOOKAHEAD, AmbiencePlayer } from './ambience.ts';
import { EngineSound } from './engineSound.ts';
import { DEFAULT_VOLUMES, MixGraph } from './graph.ts';
import { LOOKAHEAD, MusicPlayer } from './music.ts';
import { SFX_SPECS } from './sfxSpecs.ts';
import { SfxPlayer } from './sfx.ts';
import { gainToDb } from './theory.ts';

/**
 * Faster-than-real-time renders through the exact live mix chain (buses, reverb, limiter), for
 * the dev lab and automated level checks. Not used by the game itself.
 */

export interface LevelReport {
  peak: number;
  rms: number;
  peakDb: number;
  rmsDb: number;
  /** Samples at or above full scale. */
  clipped: number;
  /** Seconds from the first to the last sample within 50 dB of the peak. */
  audible: number;
  /** RMS frequency of the signal (a rough brightness figure), Hz. */
  brightness: number;
}

export interface RenderOptions {
  seconds: number;
  sampleRate?: number;
  volumes?: AudioVolumes;
  seed?: number;
}

export function measure(buf: AudioBuffer, fromSeconds = 0): LevelReport {
  const from = Math.min(buf.length, Math.floor(fromSeconds * buf.sampleRate));
  let peak = 0;
  let sq = 0;
  let dsq = 0;
  let clipped = 0;
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const d = buf.getChannelData(c);
    for (let i = from; i < d.length; i++) {
      const a = Math.abs(d[i]);
      if (a > peak) peak = a;
      if (a >= 1) clipped++;
      sq += d[i] * d[i];
      if (i > from) dsq += (d[i] - d[i - 1]) ** 2;
    }
  }
  const floor = peak * 10 ** (-50 / 20);
  let first = -1;
  let last = -1;
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const d = buf.getChannelData(c);
    for (let i = from; i < d.length; i++) {
      if (Math.abs(d[i]) > floor) {
        if (first < 0 || i < first) first = i;
        if (i > last) last = i;
      }
    }
  }
  const n = Math.max(1, (buf.length - from) * buf.numberOfChannels);
  const rms = Math.sqrt(sq / n);
  const brightness = sq > 0 ? (buf.sampleRate / (2 * Math.PI)) * Math.sqrt(dsq / sq) : 0;
  return {
    peak,
    rms,
    peakDb: gainToDb(peak),
    rmsDb: gainToDb(rms),
    clipped,
    audible: first < 0 ? 0 : (last - first) / buf.sampleRate,
    brightness,
  };
}

function offline(seconds: number, sampleRate: number, volumes: AudioVolumes): { ctx: OfflineAudioContext; graph: MixGraph } {
  const ctx = new OfflineAudioContext(2, Math.ceil(seconds * sampleRate), sampleRate);
  const graph = new MixGraph(ctx);
  graph.apply(volumes, false, 0, 0.001);
  return { ctx, graph };
}

/** Renders a mood the way it plays live: events are scheduled just ahead of the render clock. */
export function renderMood(mood: MusicMood, o: RenderOptions & { intensity?: number }): Promise<AudioBuffer> {
  const { ctx, graph } = offline(o.seconds, o.sampleRate ?? 44100, o.volumes ?? DEFAULT_VOLUMES);
  const music = new MusicPlayer(ctx, graph.music, o.seed ?? 1);
  music.setMood(mood, 0.5, 0);
  if (o.intensity) music.setIntensity(o.intensity, 0);
  music.scheduleUntil(LOOKAHEAD);
  const step = 0.05;
  for (let t = step; t < o.seconds; t += step) {
    const at = t;
    void ctx.suspend(at).then(() => {
      music.scheduleUntil(at + LOOKAHEAD);
      void ctx.resume();
    });
  }
  return ctx.startRendering();
}

/** Renders a room's ambience (or none) and, with `radio`, the local radio, the way they play live. */
export function renderAmbience(room: AmbienceRoom | null, o: RenderOptions & { radio?: number }): Promise<AudioBuffer> {
  const { ctx, graph } = offline(o.seconds, o.sampleRate ?? 44100, o.volumes ?? DEFAULT_VOLUMES);
  const scape = new AmbiencePlayer(ctx, graph.sfx, o.seed ?? 1);
  scape.setRoom(room, 0);
  if (o.radio) scape.setRadio(o.radio, 0);
  scape.scheduleUntil(AMBIENCE_LOOKAHEAD);
  const step = 0.1;
  for (let t = step; t < o.seconds; t += step) {
    const at = t;
    void ctx.suspend(at).then(() => {
      scape.scheduleUntil(at + AMBIENCE_LOOKAHEAD);
      void ctx.resume();
    });
  }
  return ctx.startRendering();
}

export function renderSfx(id: SfxId, o: Partial<RenderOptions> & { opts?: SfxOptions } = {}): Promise<AudioBuffer> {
  const seconds = o.seconds ?? SFX_SPECS[id].dur * 2 + 0.6;
  const { ctx, graph } = offline(seconds, o.sampleRate ?? 44100, o.volumes ?? DEFAULT_VOLUMES);
  new SfxPlayer(ctx, graph.sfx).play(id, o.opts ?? {}, 0.02);
  return ctx.startRendering();
}

/** Renders a burst of the same sound (e.g. rapid laser fire) to check stacking stays clean. */
export function renderBurst(id: SfxId, count: number, interval: number, o: Partial<RenderOptions> = {}): Promise<AudioBuffer> {
  const seconds = o.seconds ?? count * interval + SFX_SPECS[id].dur + 0.6;
  const { ctx, graph } = offline(seconds, o.sampleRate ?? 44100, o.volumes ?? DEFAULT_VOLUMES);
  const sfx = new SfxPlayer(ctx, graph.sfx);
  for (let i = 0; i < count; i++) sfx.play(id, { pan: ((i % 5) - 2) / 3 }, 0.02 + i * interval);
  return ctx.startRendering();
}

export function renderEngine(state: EngineSoundState, o: RenderOptions): Promise<AudioBuffer> {
  const { ctx, graph } = offline(o.seconds, o.sampleRate ?? 44100, o.volumes ?? DEFAULT_VOLUMES);
  new EngineSound(ctx, graph.sfx.dry).update(state);
  return ctx.startRendering();
}
