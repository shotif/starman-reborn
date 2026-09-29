import type * as THREE from 'three';
import type { DataClass, SystemId } from '../data/types.ts';
import type { PlanetStyle } from './art/planets.ts';
import type { SkyboxOptions } from './art/skybox.ts';
import type { StarKind } from './art/stars.ts';
import type { StationKind } from './art/stations.ts';

/**
 * Local system scenes use intentionally compressed, schematic distances in game units (~metres at
 * ship scale). They never map light-years or AU directly; the star map owns real distances.
 */

export interface SceneStarDef {
  /** Stellar component id ('sun' for Sol). */
  id: string;
  name: string;
  position: THREE.Vector3;
  radius: number;
  color: string;
  kind: StarKind;
  activity?: number;
  glowScale?: number;
  intensity?: number;
  /** Directional light intensity at full strength. */
  light: number;
  /** Distance (units) within which the star lights at full strength; falls off beyond. */
  lightRange: number;
}

export interface ScenePlanetDef {
  /** Body id: Solar System ids ('earth') or confirmed-planet ids ('proxima-cen-b'). */
  id: string;
  name: string;
  subtitle: string;
  position: THREE.Vector3;
  radius: number;
  style: PlanetStyle;
  hostStarId: string;
  rings?: { inner: number; outer: number; color?: string; opacity?: number };
  tilt?: number;
  spinSpeed?: number;
  /** Centre of the schematic orbit line (host star position), when drawn. */
  orbitCenter?: THREE.Vector3;
  /** Auto-discovery range (units); defaults to 9,000. */
  scanRange?: number;
  /** Whether this body is a catalogued real object that can be "discovered". */
  scannable: boolean;
}

export interface SceneStationDef {
  locationId: string;
  kind: StationKind;
  position: THREE.Vector3;
  /** World direction ships approach the docking bay from. */
  approach: THREE.Vector3;
}

export interface SceneLaneDef {
  id: string;
  name: string;
  /** Label for the entrance at `from` (travelling toward `to`), e.g. "Lane to Mars". */
  fromName: string;
  /** Label for the entrance at `to` (travelling toward `from`). */
  toName: string;
  from: THREE.Vector3;
  to: THREE.Vector3;
  ringSpacing: number;
  /** Travel speed in the lane, units/s. */
  speed: number;
}

export interface SceneBeltDef {
  id: string;
  center: THREE.Vector3;
  shape: 'ring' | 'cluster';
  innerRadius: number;
  outerRadius: number;
  thickness: number;
  count: { low: number; medium: number; high: number };
  sizeMin: number;
  sizeMax: number;
  color: string;
  seed: number;
}

export interface SceneDustDef {
  center: THREE.Vector3;
  innerRadius: number;
  outerRadius: number;
  color: string;
  opacity: number;
  seed: number;
}

export interface SceneBeaconDef {
  id: string;
  name: string;
  position: THREE.Vector3;
  kind: 'jump' | 'nav';
}

/** Close-range scan zones for non-planet bodies (e.g. a close pass on Sirius B for a contract). */
export interface SceneScanZone {
  bodyId: string;
  name: string;
  center: THREE.Vector3;
  range: number;
}

export interface EncounterDef {
  id: string;
  /** Trigger when the player enters this sphere. */
  center: THREE.Vector3;
  radius: number;
  /** Distance ahead of the player where the raider appears. */
  spawnAhead: number;
  bounty: number;
}

/** Harmless target drones for aiming practice (no reward). */
export interface PracticeRangeDef {
  center: THREE.Vector3;
  count: number;
  /** Radius of the slow circles the drones fly. */
  radius: number;
}

export interface SystemSceneDef {
  systemId: SystemId;
  skybox: SkyboxOptions;
  ambient: { sky: string; ground: string; intensity: number };
  stars: SceneStarDef[];
  planets: ScenePlanetDef[];
  stations: SceneStationDef[];
  lanes: SceneLaneDef[];
  belts: SceneBeltDef[];
  dust: SceneDustDef[];
  beacons: SceneBeaconDef[];
  scanZones: SceneScanZone[];
  encounters: EncounterDef[];
  practice?: PracticeRangeDef;
  /** Where ships appear after a jump, and what they face. */
  arrival: { position: THREE.Vector3; lookAt: THREE.Vector3 };
  /** Draw faint schematic orbit lines around the host star. */
  orbitLines: boolean;
  /** One-line note on the scene's compressed scale (shown in the scene legend). */
  scaleNote: string;
}

export interface TargetInfoLine {
  text: string;
  dataClass: DataClass;
}
