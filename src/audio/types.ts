/** Contract for the procedural audio engine. All sound is synthesized at runtime (original). */

export type SfxId =
  | 'ui-click'
  | 'ui-confirm'
  | 'ui-error'
  | 'laser'
  | 'laser-mk2'
  | 'laser-enemy'
  | 'missile-launch'
  | 'missile-lock'
  | 'hit-shield'
  | 'hit-hull'
  | 'player-hit-shield'
  | 'player-hit-hull'
  | 'shield-down'
  | 'explosion-small'
  | 'explosion-large'
  | 'boost-start'
  | 'cruise-charge'
  | 'cruise-engage'
  | 'cruise-exit'
  | 'lane-enter'
  | 'lane-exit'
  | 'dock-clamp'
  | 'undock'
  | 'jump-charge'
  | 'jump-exit'
  | 'pickup'
  | 'alert'
  | 'scan'
  | 'credits'
  | 'mission-complete'
  | 'repair'
  | 'target-lock';

export type MusicMood =
  | 'title'
  | 'docked'
  | 'map'
  | 'sol'
  | 'alpha-centauri'
  | 'barnard'
  | 'sirius'
  | 'epsilon-eridani'
  | 'bar'
  | 'frontier'
  | 'deep-space'
  | 'den';

export interface SfxOptions {
  /** 0..1 multiplier. */
  volume?: number;
  /** -1 (left) .. 1 (right). */
  pan?: number;
  /** Playback-rate style pitch multiplier (1 = normal). */
  pitch?: number;
}

export interface EngineSoundState {
  /** 0..1 main throttle. */
  throttle: number;
  /** 0..1 speed relative to cruise speed. */
  speed: number;
  boost: boolean;
  cruise: boolean;
  /** True while travelling in a trade lane. */
  lane: boolean;
}

export type AudioUnlockState = 'locked' | 'running' | 'unavailable';

export interface AudioVolumes {
  master: number;
  music: number;
  sfx: number;
}
