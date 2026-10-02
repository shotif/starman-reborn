import { DOOMED } from '../../content/stellar/doomed.ts';
import { getLocation } from '../../data/systems.ts';
import type { SystemId } from '../../data/types.ts';
import type { SystemSceneDef } from '../sceneTypes.ts';
import { dirTo, v } from './helpers.ts';

/**
 * Pyre, the invented star (docs/PROCGEN.md §26), as it lives: a red supergiant, drawn far smaller
 * than one would be (over a thousand times the Sun's size), its observatory at a wary distance, and
 * the jump beacon of its one lane. No planets or belts: none are invented.
 */
const STAR = v(0, 0, 0);
const observatory = v(62_000, 3_500, 24_000);
const arrival = observatory.clone().add(v(6_000, 1_400, 8_500));

export const PYRE_ALIVE_SCENE: SystemSceneDef = {
  systemId: DOOMED.star.id as SystemId,
  skybox: { seed: 71, baseColor: '#070203', nebulaColors: ['#4a160c', '#2a0c08', '#180a1c'], nebulaIntensity: 0.34, starDensity: 0.5, bandTilt: 0.6 },
  ambient: { sky: '#ff9a6a', ground: '#140604', intensity: 0.3 },
  stars: [
    {
      id: DOOMED.star.id,
      name: DOOMED.star.name,
      position: STAR,
      radius: 9_000,
      color: DOOMED.star.colorHex,
      kind: 'supergiant',
      activity: 1,
      glowScale: 3,
      light: 1.7,
      lightRange: 170_000,
    },
  ],
  planets: [],
  stations: [
    {
      locationId: DOOMED.stations.observatory.id,
      kind: 'sirius-platform',
      look: getLocation(DOOMED.stations.observatory.id).look!,
      position: observatory,
      approach: dirTo(observatory, arrival),
    },
  ],
  lanes: [],
  belts: [],
  dust: [],
  beacons: [{ id: 'pyre-jump', name: `${DOOMED.star.name} jump beacon`, position: arrival.clone().add(v(250, -120, 300)), kind: 'jump' }],
  scanZones: [],
  encounters: [],
  // Ships come out of the lane facing the star.
  arrival: { position: arrival, lookAt: STAR },
  orbitLines: false,
  scaleNote: `${DOOMED.star.name} and its observatory are invented. The star is drawn far smaller than a red supergiant would be.`,
};
