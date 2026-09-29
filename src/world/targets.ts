import type * as THREE from 'three';
import type { DataClass, FactionId } from '../data/types.ts';

export type TargetKind = 'station' | 'planet' | 'star' | 'lane' | 'beacon' | 'ship' | 'loot' | 'drone';

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
  locationId?: string;
  bodyId?: string;
  laneId?: string;
  /** Lane entrance at the lane's `to` end (travel runs back toward `from`). */
  laneReverse?: boolean;
  /** False once destroyed/collected. */
  alive: boolean;
  /** Shown in the target cycle list (T key / Target button). */
  cycle: boolean;
}
