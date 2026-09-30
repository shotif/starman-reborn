import type * as THREE from 'three';
import type { ShipArt } from '../art/ships.ts';
import type { SkyboxOptions } from '../art/skybox.ts';
import type { StationKind } from '../art/stations.ts';
import type { ArtContext } from '../art/types.ts';
import type { InteriorStyle } from './styles.ts';

/**
 * Contract for procedural station interiors (the 3D places behind the docked menus). Game code
 * only depends on these types. Conventions follow src/world/art/types.ts: 1 unit ≈ 1 metre,
 * +Y up, all art original and procedural.
 *
 * One interior holds every room of a station: the hangar deck with the player's ship on its pad,
 * the trader's cargo area and the outfitter's workshop (camera moves between them), plus the
 * lounge/bar (a separate area the camera cuts to).
 */

/** The places a player can visit while docked. */
export type RoomView = 'deck' | 'trader' | 'outfitter' | 'bar';

/** How the camera gets to a new view: a smooth move, or a cut the UI covers with a quick fade. */
export type ViewTransition = 'move' | 'cut';

/**
 * Options for `createStationInterior`. Give a hand-built `station` (its authored style), or a
 * `style` for any other station (usually `generateInteriorStyle(look)`); a style wins over the
 * station's own.
 */
export type StationInteriorOptions = StationInteriorBase & (
  | {
      /** Which hand-built station: its authored style drives palette, materials, props and lighting mood. */
      station: StationKind;
      /** Art direction to build instead of the station's authored one. */
      style?: InteriorStyle;
    }
  | {
      station?: StationKind;
      /** Art direction for the rooms, e.g. `generateInteriorStyle(look)` for a generated station. */
      style: InteriorStyle;
    }
);

export interface StationInteriorBase {
  /** The local sky seen through bay doors and windows. */
  skybox: SkyboxOptions;
  /** Colour of the local star's light spilling in through openings. */
  starColor: THREE.ColorRepresentation;
  /** Seed for props, crowd and small variations (stable per station). */
  seed: number;
  /** Rooms this station offers; views not listed may be omitted from the scene. */
  rooms: readonly RoomView[];
  /**
   * Builds the player's ship shown on the pad (default: the starting courier). Ships longer than
   * the pad are shown scaled down to fit.
   */
  ship?: (ctx: ArtContext) => ShipArt & { readonly length?: number };
}

/** A tappable thing in a room (e.g. a person in the bar), in CSS pixels for the current frame. */
export interface RoomHotspot {
  id: string;
  label: string;
  x: number;
  y: number;
  /** False when behind the camera or off screen. */
  visible: boolean;
}

export interface StationInterior {
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  readonly rooms: readonly RoomView[];
  readonly view: RoomView;
  /** Moves the camera to a room. Returns how it got there; instant skips any animation. */
  setView(view: RoomView, instant?: boolean): ViewTransition;
  /** Viewport size in CSS pixels; portrait screens get wider framing so the subject still fits. */
  resize(width: number, height: number): void;
  /** Called every rendered frame while docked. */
  update(dt: number): void;
  /** People and objects the UI may place tap targets on (bar patrons, the bartender, ...). */
  hotspots(): RoomHotspot[];
  dispose(): void;
}

export type CreateStationInterior = (opts: StationInteriorOptions, ctx: ArtContext) => StationInterior;
