import { DOOMED } from '../../content/stellar/doomed.ts';
import { getLocation } from '../../data/systems.ts';
import type { SystemId } from '../../data/types.ts';
import { horizonKm, PYRE_HOLE_ID, tidalLimitKm } from '../../economy/pyrePhysics.ts';
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

/**
 * Where Pyre was, once it has gone (docs/PROCGEN.md §26): no star, the black hole its core left,
 * the glowing cloud of its outer layers all round, and the station built well clear of the hole
 * (open some hours after the lane opens again). The observatory is gone with the star.
 */
const HOLE = v(0, 0, 0);
const remnant = v(70_000, 3_500, -32_000);
const remnantArrival = remnant.clone().add(v(5_000, 1_200, 7_500));
const km = (x: number) => Math.round(x).toLocaleString('en-GB');

export const PYRE_GONE_SCENE: SystemSceneDef = {
  systemId: DOOMED.star.id as SystemId,
  skybox: { seed: 72, baseColor: '#040309', nebulaColors: ['#5a1830', '#123c48', '#3a0e10'], nebulaIntensity: 0.55, starDensity: 0.5, bandTilt: 0.6 },
  ambient: { sky: '#e0a890', ground: '#0a0610', intensity: 0.42 },
  stars: [],
  blackHole: {
    id: PYRE_HOLE_ID,
    name: `${DOOMED.star.name}’s black hole`,
    subtitle: 'Invented black hole · not in the real sky',
    position: HOLE,
    shadow: 1_800,
    disc: [3_000, 14_000],
    tidalRadius: 22_000,
    glow: { color: '#ffd2a6', light: 1.1 },
  },
  planets: [],
  stations: [
    {
      locationId: DOOMED.stations.remnant.id,
      kind: 'sirius-platform',
      look: getLocation(DOOMED.stations.remnant.id).look!,
      position: remnant,
      approach: dirTo(remnant, remnantArrival),
    },
  ],
  lanes: [],
  belts: [],
  dust: [],
  beacons: [{ id: 'pyre-jump', name: `${DOOMED.star.name} jump beacon`, position: remnantArrival.clone().add(v(250, -120, 300)), kind: 'jump' }],
  scanZones: [],
  encounters: [],
  // Ships come out of the lane facing the hole.
  arrival: { position: remnantArrival, lookAt: HOLE },
  orbitLines: false,
  scaleNote: `${DOOMED.star.name}, its black hole and its station are invented. The hole is drawn far larger than one of ${DOOMED.blackHole.massSolar} Suns would be (about ${km(2 * horizonKm())} km across), and its tides far nearer: they would pull a ship apart within about ${km(tidalLimitKm())} km.`,
};
