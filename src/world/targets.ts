import type * as THREE from 'three';
import type { DataClass, FactionId } from '../data/types.ts';

/** `belt`: a cited belt, at its point nearest the player; `rock`: a rock in it a mining laser can cut. */
/** `sky`: a far star beyond the map, at the sky's distance (docs/PROCGEN.md §25): observed, never flown to. */
/** `hole`: the black hole where Pyre was (docs/PROCGEN.md §26): scanned from outside its tides. */
/** `wreck`: a site marked in flight (docs/PROCGEN.md §31): a wreck, a derelict, something adrift. */
/** `gate`: a race gate or start box (docs/PROCGEN.md §33), fiction. */
/** `battle`: where a border battle is fought (docs/PROCGEN.md §35), fiction. */
export type TargetKind = 'station' | 'planet' | 'star' | 'lane' | 'beacon' | 'ship' | 'loot' | 'drone' | 'belt' | 'rock' | 'sky' | 'hole' | 'wreck' | 'gate' | 'battle' | 'comet' | 'asteroid' | 'craft';

/** Anything the player can select, bracket, fly to or dock with. */
export interface Target {
  id: string;
  name: string;
  kind: TargetKind;
  /** Live world position (updated by the owner). */
  position: THREE.Vector3;
  /** Live velocity when the target moves (ships), else undefined. */
  velocity?: THREE.Vector3;
  radius: number;
  subtitle: string;
  /** Real object (observed), illustrated, or game fiction. */
  dataClass: DataClass;
  faction?: FactionId;
  hostile?: boolean;
  /** One of the player's own ships, flown by a captain (docs/PROCGEN.md §18.6). */
  own?: boolean;
  locationId?: string;
  bodyId?: string;
  laneId?: string;
  /** Lane entrance at the lane's `to` end (travel runs back toward `from`). */
  laneReverse?: boolean;
  /** Shown instead of the distance in metres (a far star: its distance in light-years). */
  distanceLabel?: string;
  /** False once destroyed/collected. */
  alive: boolean;
  /** Shown in the target cycle list (T key / Target button). */
  cycle: boolean;
}
