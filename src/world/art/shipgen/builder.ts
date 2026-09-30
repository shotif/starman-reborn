import * as THREE from 'three';
import type { ShipStyle } from '../../../content/types.ts';
import { Kit } from '../kit.ts';
import type { PartOptions, V3 } from '../kit.ts';
import type { LightSpec } from '../lights.ts';
import type { QualityLevel } from '../types.ts';
import { byQuality } from '../util.ts';
import { rngFor, shipPalette } from './palette.ts';
import type { Rng, ShipPalette } from './palette.ts';
import type { ShipModelArtOptions } from './types.ts';

/**
 * Working state while one ship is generated: the geometry kit, paint, seeded streams and the
 * anchors parts register (nozzles, muzzles, lights). Sizes are in metres, laid out around the
 * class radius `R`; the blueprint normalises the finished model to the exact target size.
 */
export class ShipBuilder {
  readonly kit = new Kit(2.5);
  readonly spec: ShipModelArtOptions;
  readonly quality: QualityLevel;
  readonly style: ShipStyle;
  readonly pal: ShipPalette;
  /** Size unit: the class collision radius. */
  readonly R: number;
  readonly tier: number;
  /** 0 = smooth .. 1 = heavily plated. */
  readonly greeble: number;
  /** Spliced salvage hulls are not mirror-symmetric. */
  readonly symmetric: boolean;
  /** Radial segments for engines, turrets and dishes. */
  readonly seg: number;
  /** Radial segments for barrels, struts and antennae. */
  readonly segThin: number;
  /** Radial segments for cargo pods and for large bands (rings, dishes). */
  readonly segPod: number;
  readonly segRing: number;
  /** Share of optional greebles kept at this quality. */
  readonly detail: number;
  readonly nozzles: V3[] = [];
  /** Exit radius of the main nozzles (plume width). */
  nozzleRadius = 0;
  readonly muzzles: V3[] = [];
  readonly lights: LightSpec[] = [];

  constructor(spec: ShipModelArtOptions, quality: QualityLevel) {
    this.spec = spec;
    this.quality = quality;
    this.style = spec.style;
    this.pal = shipPalette(spec.style);
    this.R = spec.radius;
    this.tier = spec.tier;
    this.greeble = Math.max(0, Math.min(1, spec.style.greeble));
    this.symmetric = spec.style.silhouette !== 'splice';
    this.seg = byQuality(quality, 8, 12, 16);
    this.segThin = byQuality(quality, 5, 6, 8);
    this.segPod = byQuality(quality, 6, 10, 14);
    this.segRing = byQuality(quality, 10, 16, 20);
    this.detail = byQuality(quality, 0.45, 0.75, 1);
  }

  rng(aspect: string): Rng {
    return rngFor(this.spec.id, aspect);
  }

  add(key: string, geometry: THREE.BufferGeometry, opts: PartOptions = {}): void {
    this.kit.add(key, geometry, opts);
  }

  box(key: string, size: V3, position: V3, color: THREE.ColorRepresentation, rotation?: V3): void {
    this.kit.add(key, new THREE.BoxGeometry(size[0], size[1], size[2]), { position, rotation, color });
  }

  /** Emissive part: `color` is already HDR-scaled. */
  glowBox(size: V3, position: V3, color: THREE.Color, rotation?: V3): void {
    this.kit.add('emissive', new THREE.BoxGeometry(size[0], size[1], size[2]), { position, rotation, color });
  }

  /** Nav or running light; `size` is the glow diameter in units of R. */
  light(p: V3, color: THREE.ColorRepresentation, size: number, extra: Partial<LightSpec> = {}): void {
    this.lights.push({ p, color, size: size * this.R, intensity: 1.4, ...extra });
  }
}
