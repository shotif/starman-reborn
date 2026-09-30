import type { AmbienceRoom, MusicMood } from './types.ts';

/**
 * Which music and which station ambience play where (docs/DESIGN.md, Audio). Pure: the game
 * describes where the player is and what is going on; these rules pick. No Web Audio access.
 */

/** Where the player is, as far as the music cares. Fields left out mean "no". */
export interface MoodSituation {
  /** What is on screen. */
  scene: 'title' | 'map' | 'docked' | 'flight';
  /** Docked: the room the player is in. */
  room?: AmbienceRoom | null;
  /** Docked at a raider den (only pilots the Hollow Wake trusts can). */
  atDen?: boolean;
  /** The system's own theme (the hand-made systems' moods, or the one its star is closest to). */
  theme: MusicMood;
  /** Nobody keeps the peace in this system. */
  lawless?: boolean;
  /** Metres to the nearest raider den still standing; absent or Infinity when there is none. */
  denDistance?: number;
  /** Riding a trade lane. */
  inLane?: boolean;
  /** Seconds of the current cruise or lane ride (0 when not travelling). */
  travel?: number;
  /** Seconds since the last cruise or lane ride ended. */
  sinceTravel?: number;
  /** A fight is on: combat takes over from the travel music. */
  combat?: boolean;
}

export const MOOD_RULES = {
  /** A den's music comes in this close to it (m), and lets go only beyond `denLeave`. */
  denNear: 12_000,
  denLeave: 15_000,
  /** Seconds in a lane, or of cruise, before the deep-space drones come in. */
  laneAfter: 2,
  cruiseAfter: 20,
  /** Seconds the drones outlast a ride, so a short break in cruise does not end them. */
  travelHold: 5,
} as const;

/**
 * The mood for a situation. `current` is the mood playing now: the den and travel moods hold on
 * a little past their thresholds so the music does not flip back and forth at the edge.
 *
 * - Title and star map keep their own themes.
 * - Docked: the bar room plays 'bar', any other room 'docked'; a raider den plays 'den' throughout.
 * - Flying: near a raider den 'den'; a lane ride or a long cruise 'deep-space' (never in a fight);
 *   otherwise 'frontier' in lawless space and the system's theme elsewhere. Combat intensity
 *   layers over whichever of these plays (src/audio/music.ts).
 */
export function chooseMood(s: MoodSituation, current: MusicMood | null = null): MusicMood {
  switch (s.scene) {
    case 'title':
      return 'title';
    case 'map':
      return 'map';
    case 'docked':
      return s.atDen ? 'den' : s.room === 'bar' ? 'bar' : 'docked';
    default:
      return flightMood(s, current);
  }
}

function flightMood(s: MoodSituation, current: MusicMood | null): MusicMood {
  const den = s.denDistance ?? Infinity;
  if (den < (current === 'den' ? MOOD_RULES.denLeave : MOOD_RULES.denNear)) return 'den';
  if (!s.combat && deepTravel(s, current)) return 'deep-space';
  return s.lawless ? 'frontier' : s.theme;
}

/** A lane ride past its first seconds, or a long cruise; held briefly after it ends. */
function deepTravel(s: MoodSituation, current: MusicMood | null): boolean {
  const travel = s.travel ?? 0;
  if (current === 'deep-space' && (travel > 0 || (s.sinceTravel ?? Infinity) < MOOD_RULES.travelHold)) return true;
  return travel >= (s.inLane ? MOOD_RULES.laneAfter : MOOD_RULES.cruiseAfter);
}

/** The ambience bed for a situation: the room's while docked, none anywhere else. */
export function ambienceFor(s: MoodSituation): AmbienceRoom | null {
  return s.scene === 'docked' ? (s.room ?? 'deck') : null;
}

/** Seconds of the current cruise or lane ride, and since the last one ended (for `chooseMood`). */
export class TravelClock {
  travel = 0;
  since = Infinity;

  update(dt: number, travelling: boolean): void {
    const step = Number.isFinite(dt) && dt > 0 ? dt : 0;
    if (travelling) {
      this.travel += step;
      this.since = 0;
    } else {
      this.travel = 0;
      this.since += step;
    }
  }

  reset(): void {
    this.travel = 0;
    this.since = Infinity;
  }
}
