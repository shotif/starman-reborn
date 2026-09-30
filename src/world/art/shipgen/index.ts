import * as THREE from 'three';
import { RULES } from '../../../content/rules/index.ts';
import type { ShipModel } from '../../../content/types.ts';
import { Kit } from '../kit.ts';
import type { V3 } from '../kit.ts';
import { standardSet } from '../materials.ts';
import { assembleShip } from '../ships.ts';
import type { ArtContext } from '../types.ts';
import { buildBlueprint } from './blueprint.ts';
import { acquireBlueprint, releaseBlueprint } from './cache.ts';
import type { GeneratedShipArt, ShipModelArtOptions } from './types.ts';

/**
 * Procedural ships for the catalogue: one recognisable model per (class, maker, tier). The class
 * sets proportions and layout, the maker's style the visual language, the tier the refinement, and
 * the model id seeds small deterministic variations. Geometry is built once per (model, quality)
 * and shared; each ship adds only its own plumes, glows, lights and shield (see ships.ts).
 */

export type { GeneratedShipArt, ShipModelArtOptions } from './types.ts';
export type { ShipArtCacheStats } from './cache.ts';
export { MAX_IDLE_BLUEPRINTS, clearShipArtCache, shipArtCacheStats } from './cache.ts';

/** Cache key: everything that shapes the geometry. */
function blueprintKey(o: ShipModelArtOptions, quality: string): string {
  const s = o.style;
  const p = s.palette;
  return [quality, o.id, o.shipClass, o.tier, o.guns, o.radius, s.silhouette, s.wings, s.greeble, p.hull, p.panel, p.accent, p.glow].join('|');
}

export function createShipModelArt(opts: ShipModelArtOptions, ctx: ArtContext): GeneratedShipArt {
  const key = blueprintKey(opts, ctx.quality);
  const bp = acquireBlueprint(key, () => buildBlueprint(opts, ctx.quality));
  const art = assembleShip(
    {
      name: opts.id,
      // An empty kit: the hull meshes come from the shared blueprint below, while assembleShip
      // adds this ship's own plumes, glows, lights and shield.
      kit: new Kit(),
      engine: { ...bp.engine, nozzles: bp.engine.nozzles.map((n) => [...n] as V3) },
      lights: bp.lights.map((l) => ({ ...l })),
      shield: [...bp.shield],
      shieldColor: bp.shieldColor,
      radius: bp.radius,
      muzzles: bp.muzzles.map((m) => [...m] as V3),
    },
    ctx,
  );
  const materials = standardSet(ctx.quality);
  for (const part of bp.parts) {
    const mesh = new THREE.Mesh(part.geometry, materials[part.key]);
    mesh.name = part.key;
    art.object.add(mesh);
  }
  let released = false;
  return {
    ...art,
    length: bp.length,
    nozzles: bp.engine.nozzles.map((n) => new THREE.Vector3(...n)),
    dispose() {
      if (released) return;
      released = true;
      // Frees this ship's plumes, glows and shield; shared geometry is marked shared and skipped.
      art.dispose();
      releaseBlueprint(key);
    },
  };
}

/** Art options for a catalogue model: its maker's style and one muzzle per gun slot. */
export function shipModelArtOptions(model: ShipModel): ShipModelArtOptions {
  const maker = RULES.makers.find((m) => m.id === model.maker);
  if (!maker) throw new Error(`Unknown ship maker ${model.maker}`);
  return {
    id: model.id,
    shipClass: model.class,
    tier: model.tier,
    style: maker.style,
    guns: model.slots.filter((s) => s.type === 'gun').length,
    radius: model.radius,
  };
}

/** Convenience: build from a catalogue model (looks up the maker style and gun count). */
export function createCatalogShipArt(model: ShipModel, ctx: ArtContext): GeneratedShipArt {
  return createShipModelArt(shipModelArtOptions(model), ctx);
}
