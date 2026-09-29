import type { AudioUnlockState, AudioVolumes, EngineSoundState, MusicMood, SfxId, SfxOptions } from './types.ts';

/**
 * Procedural Web Audio engine. The AudioContext is created only inside `unlock()`, which the app
 * calls from a user gesture (pointerup/keydown/touchend) as browsers, notably iOS Safari, require.
 * PLACEHOLDER implementation: tracks state but makes no sound; replaced by the audio pass.
 */
export class AudioEngine {
  private unlockState: AudioUnlockState = 'locked';
  private volumes: AudioVolumes = { master: 0.8, music: 0.6, sfx: 0.8 };
  private muted = false;
  private mood: MusicMood | null = null;

  get state(): AudioUnlockState {
    return this.unlockState;
  }

  get currentMood(): MusicMood | null {
    return this.mood;
  }

  /** Must be called from a user-gesture handler. Safe to call repeatedly. */
  async unlock(): Promise<void> {
    if (typeof window === 'undefined' || !('AudioContext' in window)) {
      this.unlockState = 'unavailable';
      return;
    }
    this.unlockState = 'running';
  }

  setVolumes(v: AudioVolumes): void {
    this.volumes = { ...v };
  }

  getVolumes(): AudioVolumes {
    return { ...this.volumes };
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
  }

  get isMuted(): boolean {
    return this.muted;
  }

  play(_id: SfxId, _opts?: SfxOptions): void {}

  /** Crossfades to the given music mood (no-op if already playing it). */
  setMusic(mood: MusicMood): void {
    this.mood = mood;
  }

  /** 0..1 combat intensity layered over the current mood. */
  setCombatIntensity(_value: number): void {}

  /** Continuous engine hum; call every frame while flying, or with null to silence. */
  setEngine(_state: EngineSoundState | null): void {}

  /** Called when the page is hidden/shown to save battery. */
  setSuspended(_suspended: boolean): void {}
}
