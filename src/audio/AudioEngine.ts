import type { AmbienceRoom, AudioUnlockState, AudioVolumes, EngineSoundState, MusicMood, SfxId, SfxOptions } from './types.ts';
import { AmbiencePlayer } from './ambience.ts';
import { EngineSound } from './engineSound.ts';
import { DEFAULT_VOLUMES, MixGraph } from './graph.ts';
import { MusicPlayer } from './music.ts';
import { SfxPlayer } from './sfx.ts';
import { resources } from './synth.ts';
import { clamp01 } from './theory.ts';

type ContextCtor = new (options?: AudioContextOptions) => AudioContext;

/** Seconds for a mood crossfade, and for the very first fade-in after unlocking. */
const MOOD_FADE = 3;
const FIRST_FADE = 2;
/** How long `unlock()` waits for `resume()` before returning (the state listener covers later). */
const RESUME_WAIT_MS = 800;

function contextCtor(): ContextCtor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { AudioContext?: ContextCtor; webkitAudioContext?: ContextCtor };
  return w.AudioContext ?? w.webkitAudioContext ?? null;
}

function createContext(Ctor: ContextCtor): AudioContext {
  try {
    return new Ctor({ latencyHint: 'interactive' });
  } catch {
    return new Ctor(); // older webkitAudioContext takes no options
  }
}

function safeResume(ctx: AudioContext): Promise<void> | null {
  try {
    const p = ctx.resume() as Promise<void> | undefined;
    return p ? p.catch(() => undefined) : null;
  } catch {
    return null;
  }
}

function safeSuspend(ctx: AudioContext): void {
  try {
    void (ctx.suspend() as Promise<void> | undefined)?.catch(() => undefined);
  } catch {
    // older implementations may throw synchronously
  }
}

/** A one-sample silent buffer played inside the gesture fully unlocks output on iOS. */
function playSilence(ctx: AudioContext): void {
  try {
    const src = ctx.createBufferSource();
    src.buffer = ctx.createBuffer(1, 1, ctx.sampleRate);
    src.connect(ctx.destination);
    src.onended = () => src.disconnect();
    src.start(0);
  } catch {
    // best effort
  }
}

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Snapshot for dev tools. */
export interface AudioDebugStats {
  contextState: string;
  sampleRate: number;
  baseLatency: number;
  musicVoices: number;
  sfxVoices: number;
  engineActive: boolean;
  schedulerRunning: boolean;
  combatIntensity: number;
  ambienceRoom: AmbienceRoom | null;
  ambienceVoices: number;
  radio: number;
}

/**
 * Procedural Web Audio engine. The AudioContext is created only inside `unlock()`, which the app
 * calls from a user gesture (pointerup/keydown/touchend) as browsers, notably iOS Safari, require.
 * Everything is synthesized at runtime (see ./music.ts, ./sfx.ts, ./engineSound.ts, ./ambience.ts);
 * calls made before unlocking are remembered (mood, volumes, mute, intensity, engine, ambience,
 * radio) and applied afterwards.
 */
export class AudioEngine {
  private unlockState: AudioUnlockState = 'locked';
  private volumes: AudioVolumes = { ...DEFAULT_VOLUMES };
  private muted = false;
  private mood: MusicMood | null = null;
  private intensity = 0;
  private engineState: EngineSoundState | null = null;
  private ambienceRoom: AmbienceRoom | null = null;
  private radio = 0;
  private suspended = false;
  private ctx: AudioContext | null = null;
  private graph: MixGraph | null = null;
  private music: MusicPlayer | null = null;
  private sfx: SfxPlayer | null = null;
  private engine: EngineSound | null = null;
  private scape: AmbiencePlayer | null = null;
  private musicStarted = false;

  get state(): AudioUnlockState {
    return this.unlockState;
  }

  get currentMood(): MusicMood | null {
    return this.mood;
  }

  /** Must be called from a user-gesture handler. Safe to call repeatedly. */
  async unlock(): Promise<void> {
    if (this.unlockState === 'unavailable') return;
    let ctx = this.ctx;
    if (ctx && (ctx.state as string) === 'closed') {
      this.teardown();
      ctx = null;
    }
    if (!ctx) {
      const Ctor = contextCtor();
      if (!Ctor) {
        this.unlockState = 'unavailable';
        return;
      }
      try {
        ctx = createContext(Ctor);
      } catch {
        this.unlockState = 'unavailable';
        return;
      }
      this.ctx = ctx;
      if (typeof ctx.addEventListener === 'function') ctx.addEventListener('statechange', this.onStateChange);
      else ctx.onstatechange = this.onStateChange;
    }
    // Everything before the first await runs inside the user gesture, as iOS requires:
    // resume (also recovers 'suspended' and iOS 'interrupted'), then the silent buffer.
    const resumed = ctx.state === 'running' ? null : safeResume(ctx);
    playSilence(ctx);
    if (!this.graph) this.build(ctx);
    // Unlocked by this gesture, but the app asked for silence (page hidden): go back to sleep.
    if (this.suspended) safeSuspend(ctx);
    this.syncState();
    if (resumed) {
      await Promise.race([resumed, wait(RESUME_WAIT_MS)]);
      this.syncState();
    }
  }

  setVolumes(v: AudioVolumes): void {
    this.volumes = { master: clamp01(v.master), music: clamp01(v.music), sfx: clamp01(v.sfx) };
    this.applyMix();
  }

  getVolumes(): AudioVolumes {
    return { ...this.volumes };
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    this.applyMix();
  }

  get isMuted(): boolean {
    return this.muted;
  }

  play(id: SfxId, opts?: SfxOptions): void {
    if (!this.sfx || this.muted || !this.live) return;
    this.sfx.play(id, opts);
  }

  /** Crossfades to the given music mood (no-op if already playing it). */
  setMusic(mood: MusicMood): void {
    if (mood === this.mood) return;
    this.mood = mood;
    if (this.music && this.live) this.startMood(this.music);
  }

  /** 0..1 combat intensity layered over the current mood. */
  setCombatIntensity(value: number): void {
    this.intensity = clamp01(value);
    if (this.music && this.live) this.music.setIntensity(this.intensity);
  }

  /** Station ambience for a room, or null for none; it crossfades between rooms (effects volume). */
  setAmbience(room: AmbienceRoom | null): void {
    if (room === this.ambienceRoom) return;
    this.ambienceRoom = room;
    if (this.scape && this.live) this.scape.setRoom(room);
  }

  get currentAmbience(): AmbienceRoom | null {
    return this.ambienceRoom;
  }

  /** 0..1 how busy the local radio is: faint bursts of chatter in busy systems, silence at 0. */
  setRadio(level: number): void {
    const x = clamp01(level);
    if (x === this.radio) return;
    this.radio = x;
    if (this.scape && this.live) this.scape.setRadio(x);
  }

  get radioLevel(): number {
    return this.radio;
  }

  /** Continuous engine hum; call every frame while flying, or with null to silence. */
  setEngine(state: EngineSoundState | null): void {
    this.engineState = state;
    if (this.engine && this.live) this.engine.update(state);
  }

  /** Called when the page is hidden/shown to save battery. */
  setSuspended(suspended: boolean): void {
    if (suspended === this.suspended) return;
    this.suspended = suspended;
    const ctx = this.ctx;
    if (!ctx) return;
    if (suspended) {
      this.music?.stop();
      this.scape?.stop();
      safeSuspend(ctx);
    } else {
      // May be refused without a gesture (iOS); state stays 'locked' until the next unlock().
      void safeResume(ctx)?.then(() => this.syncState());
    }
    this.syncState();
  }

  /** Dev/diagnostics snapshot (not needed by the game). */
  debugStats(): AudioDebugStats {
    const ctx = this.ctx;
    return {
      contextState: ctx ? (ctx.state as string) : 'none',
      sampleRate: ctx ? ctx.sampleRate : 0,
      baseLatency: ctx && typeof ctx.baseLatency === 'number' ? ctx.baseLatency : 0,
      musicVoices: this.music?.voiceCount ?? 0,
      sfxVoices: this.sfx?.activeVoices ?? 0,
      engineActive: this.engine?.isActive ?? false,
      schedulerRunning: this.music?.running ?? false,
      combatIntensity: this.intensity,
      ambienceRoom: this.scape?.room ?? null,
      ambienceVoices: this.scape?.voiceCount ?? 0,
      radio: this.radio,
    };
  }

  /** Context running and not deliberately suspended. */
  private get live(): boolean {
    return this.unlockState === 'running' && !this.suspended;
  }

  private build(ctx: AudioContext): void {
    resources(ctx);
    const graph = new MixGraph(ctx);
    graph.apply(this.volumes, this.muted, ctx.currentTime);
    this.graph = graph;
    this.music = new MusicPlayer(ctx, graph.music);
    this.sfx = new SfxPlayer(ctx, graph.sfx);
    this.engine = new EngineSound(ctx, graph.sfx.dry);
    this.scape = new AmbiencePlayer(ctx, graph.sfx);
  }

  private applyMix(): void {
    if (this.graph && this.ctx) this.graph.apply(this.volumes, this.muted, this.ctx.currentTime);
  }

  private startMood(music: MusicPlayer): void {
    if (!this.mood || music.mood === this.mood) return;
    music.setMood(this.mood, this.musicStarted ? MOOD_FADE : FIRST_FADE);
    this.musicStarted = true;
  }

  private readonly onStateChange = (): void => this.syncState();

  /** Mirrors the real context state and starts/stops the scheduler accordingly. */
  private syncState(): void {
    const ctx = this.ctx;
    if (!ctx || this.unlockState === 'unavailable') return;
    this.unlockState = ctx.state === 'running' ? 'running' : 'locked';
    const music = this.music;
    if (!music) return;
    if (this.live) {
      this.startMood(music);
      music.setIntensity(this.intensity);
      music.start();
      this.engine?.update(this.engineState);
      this.scape?.setRoom(this.ambienceRoom);
      this.scape?.setRadio(this.radio);
      this.scape?.start();
    } else {
      music.stop();
      this.scape?.stop();
    }
  }

  private teardown(): void {
    this.music?.dispose();
    this.sfx?.stopAll();
    this.engine?.dispose();
    this.scape?.dispose();
    this.graph?.dispose();
    this.music = null;
    this.sfx = null;
    this.engine = null;
    this.scape = null;
    this.graph = null;
    this.ctx = null;
    this.musicStarted = false;
    this.unlockState = 'locked';
  }
}
