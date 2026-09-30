import type { StationArt } from '../stations.ts';
import type { ArtContext } from '../types.ts';
import { disposeObject } from '../util.ts';
import { StationGen, clamp01 } from './builder.ts';
import { customsDepot, freeport, relay, tradePort } from './civil.ts';
import { militaryBase, pirateDen } from './hostile.ts';
import { factory, miningOutpost, refinery, shipyard } from './industry.ts';
import { agriStation, researchStation } from './science.ts';
import { STATION_OWNERS } from './types.ts';
import type { StationLook, StationType } from './types.ts';

/**
 * Procedural station exteriors from a look descriptor: the type sets the silhouette (ring port,
 * hangar depot, open shipyard frames, a rock with conveyors, refinery towers...), the owner the
 * palette, `size` the scale and how much structure there is, `wear` grime and failing lights, and
 * the seed every small variation (module counts, arm lengths, arrangement, shades). The same look
 * always builds the same geometry.
 *
 * Every station has one lit docking bay; `dockPoint` sits just outside its mouth and
 * `dockApproach` points out of it, and a corridor of DOCK_CORRIDOR.radius around the line
 * DOCK_CORRIDOR.length out from the dock point is kept free of geometry at every moment of the
 * animation. `radius` encloses every vertex and light over all animated poses. Budgets: at most
 * MAX_STATION_MESHES meshes (merged by material; light points extra) and STATION_TRIANGLE_BUDGET
 * triangles for the quality. Geometry is built per station (nothing shared but the standard
 * materials), so `dispose()` frees it all.
 */

export type { StationLook, StationOwner, StationType } from './types.ts';
export { STATION_OWNERS, STATION_TYPES } from './types.ts';
export { DOCK_CORRIDOR, MAX_STATION_MESHES, STATION_TRIANGLE_BUDGET } from './builder.ts';

/** Nominal bounding radius range (size 0 .. 1) per type, in metres. */
const RADIUS_RANGE: Readonly<Record<StationType, readonly [number, number]>> = {
  'trade-port': [200, 320],
  'customs-depot': [140, 240],
  shipyard: [190, 320],
  'mining-outpost': [145, 220],
  refinery: [150, 260],
  factory: [150, 270],
  'agri-station': [150, 260],
  'research-station': [120, 220],
  relay: [90, 150],
  'military-base': [160, 290],
  freeport: [150, 270],
  'pirate-den': [120, 230],
};

/**
 * The radius a station of this type and size is laid out for (the built `radius` lands close to
 * it). Useful for placing stations before building their art.
 */
export function nominalStationRadius(type: StationType, size: number): number {
  const [lo, hi] = RADIUS_RANGE[type];
  return lo + (hi - lo) * clamp01(size);
}

const ARCHETYPES: Readonly<Record<StationType, (b: StationGen) => void>> = {
  'trade-port': tradePort,
  'customs-depot': customsDepot,
  shipyard,
  'mining-outpost': miningOutpost,
  refinery,
  factory,
  'agri-station': agriStation,
  'research-station': researchStation,
  relay,
  'military-base': militaryBase,
  freeport,
  'pirate-den': pirateDen,
};

export function createGeneratedStation(input: StationLook, ctx: ArtContext): StationArt {
  const build = (ARCHETYPES as Partial<Record<string, (b: StationGen) => void>>)[input.type];
  if (!build) throw new Error(`stationgen: unknown station type "${String(input.type)}"`);
  // Looks may come from saved or generated data: unknown owners get independent paint.
  const look: StationLook = STATION_OWNERS.includes(input.owner) ? input : { ...input, owner: 'independent' };
  const b = new StationGen(look, ctx, nominalStationRadius(look.type, look.size));
  build(b);
  const dock = b.dock;
  if (!dock) throw new Error(`stationgen: ${look.type} built no docking bay`);
  b.finish();
  const radius = Math.ceil(b.measureRadius() * 1.01 + 1);
  b.tick(0);
  let disposed = false;
  return {
    object: b.root,
    radius,
    dockPoint: dock.point.clone(),
    dockApproach: dock.approach.clone().normalize(),
    update(_dt, time) {
      b.tick(time);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      disposeObject(b.root);
    },
  };
}
