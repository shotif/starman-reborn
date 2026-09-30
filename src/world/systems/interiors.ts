import { hashString } from '../../content/random.ts';
import { getLocation } from '../../data/systems.ts';
import { generateInteriorStyle, type InteriorStyle } from '../rooms/index.ts';
import type { SceneStationDef, SystemSceneDef } from '../sceneTypes.ts';

/**
 * The interior of a generated station, with the view out of the bay kept true to the catalogue:
 * the confirmed planet the station orbits hangs outside, a station around a star shows no planet
 * (none is invented), and a second star of the system shows as a second bright point.
 */
export function generatedInteriorStyle(def: SystemSceneDef, station: SceneStationDef): InteriorStyle | null {
  if (!station.look) return null;
  const style = generateInteriorStyle(station.look);
  const outside = { ...style.outside };
  const planet = def.planets.find((p) => p.id === getLocation(station.locationId).nearBodyId);
  if (planet) {
    const giant = planet.style === 'exo-gas-giant';
    outside.planet = {
      style: planet.style,
      radius: giant ? 3_400 : planet.radius > 500 ? 2_100 : 1_700,
      distance: giant ? 14_000 : 8_200,
      dir: [-0.45, -0.18, -1],
      tilt: 0.2,
      seed: hashString(planet.id) % 97,
      frontLight: 1.1,
    };
  } else {
    delete outside.planet;
  }
  // The nearest star lights the bay; another star of the system shows beside it.
  const d2 = (p: { distanceToSquared(v: SceneStationDef['position']): number }) => p.distanceToSquared(station.position);
  const lit = def.stars.reduce((best, s) => (d2(s.position) < d2(best.position) ? s : best));
  const other = def.stars.find((s) => s !== lit);
  if (other) outside.companion = { dir: [0.5, 0.2, -1], color: other.color, size: other.kind === 'white-dwarf' ? 10 : 16 };
  else delete outside.companion;
  return { ...style, outside };
}
