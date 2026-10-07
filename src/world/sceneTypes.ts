import type * as THREE from 'three';
import type { CraftLook } from '../content/stellar/spacecraft.ts';
import type { StationLook } from '../content/world/types.ts';
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
  /** Its axis as a direction in the scene, in place of `tilt` (Jupiter's and Saturn's: docs/PROCGEN.md §48.3). */
  pole?: THREE.Vector3;
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
  /** Hand-made model (generated stations borrow the closest one until their own look is built). */
  kind: StationKind;
  /** Generated stations: what the station generator builds the exterior and interior from. */
  look?: StationLook;
  position: THREE.Vector3;
  /** World direction ships approach the docking bay from. */
  approach: THREE.Vector3;
  /** Raider den: shown and solid, but lawful pilots cannot dock. */
  hostile?: boolean;
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

/**
 * A ring of rocks drawn for a belt a cited source reports (docs/PROCGEN.md §19): no ring without a
 * belt record. Where it lies in the scene is schematic; the record says what is observed.
 */
export interface SceneBeltDef {
  id: string;
  /** The belt record (src/data/generated/belts.json) this ring draws. */
  beltId: string;
  /** Which of the belt's rings this is, when it has more than one ("inner ring"). */
  label?: string;
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

/**
 * The black hole where Pyre was (docs/PROCGEN.md §26), drawn far larger than a real one: its
 * shadow, the disc of gas still falling back in, and the zone where its tides strain a hull (drawn
 * far smaller than the real one, like every distance in a scene).
 */
export interface SceneBlackHoleDef {
  /** Body id (its science card). */
  id: string;
  name: string;
  subtitle: string;
  position: THREE.Vector3;
  /** Radius of the shadow, units: a ship that reaches it is lost. */
  shadow: number;
  /** The disc of gas falling back in: inner and outer radius, units. */
  disc: readonly [number, number];
  /** Inside this the tides strain a ship's hull, more the nearer it goes; the autopilot stops outside. */
  tidalRadius: number;
  /** The glow of the infalling gas as a light: colour and intensity at full glow. */
  glow: { color: string; light: number };
}

/**
 * A comet (Sol's, docs/PROCGEN.md §45): its nucleus where it stands on the game's date, drawn larger
 * than life, with a coma and two tails while it is near enough the Sun.
 */
export interface SceneCometDef {
  /** Body id (its science card), e.g. `comet-1p`. */
  id: string;
  name: string;
  subtitle: string;
  position: THREE.Vector3;
  /** The nucleus's drawn radius. */
  radius: number;
  /** The coma's radius and the tails' length (0 for a bare nucleus). */
  coma: number;
  tail: number;
  /** Unit directions: the gas tail's, straight away from the Sun, and the dust tail's, bent back along its path. */
  gasDir: THREE.Vector3;
  dustDir: THREE.Vector3;
  scanRange: number;
}

/**
 * A named asteroid (Sol's, docs/PROCGEN.md §47): where it stands on the game's date, drawn larger than
 * life in the proportions of its measured shape, and spun faster.
 */
export interface SceneAsteroidDef {
  /** Body id (its science card), e.g. `asteroid-99942`. */
  id: string;
  name: string;
  subtitle: string;
  position: THREE.Vector3;
  /** The drawn radius (its longest axis), and each axis's share of it. */
  radius: number;
  shape: [number, number, number];
  /** Turning speed as drawn (radians a second; 0 when its rotation is not known). */
  spin: number;
  /** Its colour, from its spectral type and albedo. */
  color: string;
  /** Passing Earth: drawn from Earth in its real direction (§47.3). */
  near: boolean;
  scanRange: number;
}

/**
 * A spacecraft (Sol's, docs/PROCGEN.md §49): where JPL Horizons has it on the game's date, drawn far
 * larger than life as a schematic of its kind.
 */
export interface SceneCraftDef {
  /** Body id (its science card), e.g. `voyager-1`. */
  id: string;
  name: string;
  subtitle: string;
  position: THREE.Vector3;
  radius: number;
  look: CraftLook;
  /** Near Earth: drawn from Earth in its real direction (§49.3). */
  near: boolean;
  scanRange: number;
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
  /** A black hole (Pyre's, once it has gone: docs/PROCGEN.md §26). */
  blackHole?: SceneBlackHoleDef;
  /** Comets (Sol's: docs/PROCGEN.md §45). */
  comets?: SceneCometDef[];
  /** Named asteroids (Sol's: docs/PROCGEN.md §47). */
  asteroids?: SceneAsteroidDef[];
  /** Spacecraft (Sol's: docs/PROCGEN.md §49). */
  craft?: SceneCraftDef[];
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
