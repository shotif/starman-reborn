import * as THREE from 'three';
import type { V3 } from '../kit.ts';
import type { LightSpec } from '../lights.ts';
import type { EngineLook } from '../ships.ts';
import type { QualityLevel } from '../types.ts';
import { markShared } from '../util.ts';
import { ShipBuilder } from './builder.ts';
import { buildClass } from './classes.ts';
import { rngFor } from './palette.ts';
import type { ShipModelArtOptions } from './types.ts';

/**
 * A finished model at one quality: merged geometry per material plus the anchors instances need.
 * Blueprints are shared by every ship of the model (see cache.ts), so nothing here is per ship.
 */
export interface ShipBlueprint {
  /** One merged geometry per material key (at most one each of hull, metal, glass, emissive). */
  readonly parts: readonly { readonly key: string; readonly geometry: THREE.BufferGeometry }[];
  /** Plume look, including the nozzle positions. */
  readonly engine: Readonly<EngineLook>;
  readonly lights: readonly LightSpec[];
  /** Shield ellipsoid semi-axes. */
  readonly shield: V3;
  readonly shieldColor: THREE.Color;
  /** Bounding radius about the ship origin. */
  readonly radius: number;
  readonly length: number;
  readonly muzzles: readonly V3[];
  readonly triangles: number;
}

/** Mk I–V size relative to the class radius: higher marks sit a little larger. */
const TIER_SIZE = [0.95, 1, 1.05, 1.08, 1.1];

/** Kit.build wants a material per key; the meshes it makes are only used to collect geometry. */
const PLACEHOLDER = new THREE.MeshBasicMaterial();
const KEYS = ['hull', 'metal', 'glass', 'glassRed', 'glassWarm', 'emissive'];

const hsl = { h: 0, s: 0, l: 0 };

function hslColor(h: number, s: number, l: number): THREE.Color {
  return new THREE.Color().setHSL(((h % 1) + 1) % 1, Math.min(1, s), Math.min(1, l), THREE.SRGBColorSpace);
}

/** Plume colours from the maker's glow: white-hot core, saturated sheath, cruise shifted in hue. */
function plumeColors(glowHex: string): Pick<EngineLook, 'core' | 'color' | 'boostCore' | 'boostColor' | 'cruiseColor'> {
  new THREE.Color(glowHex).getHSL(hsl, THREE.SRGBColorSpace);
  const { h, s, l } = hsl;
  const warm = h < 0.2 || h > 0.85;
  const shift = warm ? -0.03 : h < 0.4 ? 0.06 : 0.08;
  return {
    core: hslColor(h, s, 0.95),
    color: hslColor(h, s, l * 0.82),
    boostCore: '#ffffff',
    boostColor: hslColor(h + 0.01, s, Math.min(0.9, l * 1.05)),
    cruiseColor: hslColor(h + shift, s, l * 0.94),
  };
}

export function buildBlueprint(opts: ShipModelArtOptions, quality: QualityLevel): ShipBlueprint {
  const b = new ShipBuilder(opts, quality);
  buildClass(b);
  const materials = Object.fromEntries(KEYS.map((k) => [k, PLACEHOLDER]));
  const meshes = b.kit.build(new THREE.Group(), materials);

  // Centre the model along its length and height (the symmetry plane stays at x = 0), then scale
  // it so its bounding radius about the origin matches the class radius for its tier.
  const box = new THREE.Box3();
  for (const m of meshes) {
    m.geometry.computeBoundingBox();
    box.union(m.geometry.boundingBox!);
  }
  const cy = (box.min.y + box.max.y) / 2;
  const cz = (box.min.z + box.max.z) / 2;
  let r0 = 0;
  for (const m of meshes) {
    const pos = m.geometry.attributes.position!;
    for (let i = 0; i < pos.count; i++) {
      r0 = Math.max(r0, Math.hypot(pos.getX(i), pos.getY(i) - cy, pos.getZ(i) - cz));
    }
  }
  const tier = Math.max(1, Math.min(5, Math.round(opts.tier)));
  const target = opts.radius * TIER_SIZE[tier - 1]! * rngFor(opts.id, 'size').range(0.98, 1.02);
  const s = target / Math.max(r0, 1e-6);
  const m4 = new THREE.Matrix4().makeScale(s, s, s).multiply(new THREE.Matrix4().makeTranslation(0, -cy, -cz));
  let triangles = 0;
  const parts = meshes.map((m) => {
    const g = m.geometry;
    g.applyMatrix4(m4);
    g.computeBoundingBox();
    g.computeBoundingSphere();
    triangles += g.attributes.position!.count / 3;
    return { key: m.name, geometry: markShared(g) };
  });
  const tf = (p: V3): V3 => [p[0] * s, (p[1] - cy) * s, (p[2] - cz) * s];

  // Half extents of the centred model; the shield bubble is never flatter than 0.42 of its span.
  const length = (box.max.z - box.min.z) * s;
  const hx = Math.max(Math.abs(box.min.x), Math.abs(box.max.x)) * s;
  const hy = ((box.max.y - box.min.y) / 2) * s;
  const hz = length / 2;
  const nozzles = b.nozzles.map(tf);
  return {
    parts,
    engine: {
      nozzles,
      radius: b.nozzleRadius * s,
      // Full-throttle plume about half the ship's length, like the hand-built ships.
      length: length * (0.42 + 0.03 * tier),
      ...plumeColors(opts.style.palette.glow),
    },
    lights: b.lights.map((l) => ({ ...l, p: tf(l.p), size: l.size * s })),
    shield: [hx * 1.12, Math.max(hy * 1.5, 0.42 * Math.max(hx, hz)), hz * 1.14],
    shieldColor: new THREE.Color(opts.style.palette.glow),
    radius: target,
    length,
    muzzles: b.muzzles.map(tf),
    triangles,
  };
}
