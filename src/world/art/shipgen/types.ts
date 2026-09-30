import type * as THREE from 'three';
import type { ShipClassId, ShipStyle, Tier } from '../../../content/types.ts';
import type { ShipArt } from '../ships.ts';

export interface ShipModelArtOptions {
  /** Catalogue model id; seeds the details. */
  id: string;
  shipClass: ShipClassId;
  tier: Tier;
  /** Maker style from the rules. */
  style: ShipStyle;
  /** Gun mounts to place muzzles for. */
  guns: number;
  /** Class collision radius to roughly fill. */
  radius: number;
}

export interface GeneratedShipArt extends ShipArt {
  /** Nose-to-tail length in metres (chase camera distance). */
  readonly length: number;
  /** Engine nozzle positions, ship-local. */
  readonly nozzles: readonly THREE.Vector3[];
}
