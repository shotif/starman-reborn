import type { SystemSceneDef } from '../sceneTypes.ts';
import { dirTo, v } from './helpers.ts';

const A = v(0, 0, 0);
const B = v(70_000, -4_000, -30_000);
const platform = B.clone().add(v(-9_000, 1_200, 7_500));
// The platform's radiation shield faces the white dwarf; ships dock on the far side.
const awayFromB = dirTo(B, platform);
const arrival = platform.clone().addScaledVector(awayFromB, 9_500).add(v(0, 1_500, 0));

export const SIRIUS_SCENE: SystemSceneDef = {
  systemId: 'sirius',
  skybox: {
    seed: 71,
    baseColor: '#020410',
    nebulaColors: ['#1f3a8a', '#3b2a7a', '#0e2a4a'],
    nebulaIntensity: 0.55,
    starDensity: 1,
    bandTilt: 0.2,
  },
  ambient: { sky: '#b8ccff', ground: '#0a0d1a', intensity: 0.34 },
  stars: [
    { id: 'sirius-a', name: 'Sirius A', position: A, radius: 6_000, color: '#cfdcff', kind: 'main-sequence', activity: 0.35, glowScale: 1.4, intensity: 1.4, light: 3.0, lightRange: 160_000 },
    { id: 'sirius-b', name: 'Sirius B', position: B, radius: 160, color: '#eef2ff', kind: 'white-dwarf', glowScale: 3, intensity: 1.6, light: 0.8, lightRange: 14_000 },
  ],
  planets: [],
  stations: [{ locationId: 'sirius-platform', kind: 'sirius-platform', position: platform, approach: awayFromB }],
  lanes: [],
  belts: [],
  dust: [],
  beacons: [{ id: 'sirius-jump', name: 'Sirius jump beacon', position: arrival.clone().add(v(-200, 100, 300)), kind: 'jump' }],
  scanZones: [{ bodyId: 'sirius-b-close', name: 'Sirius B close pass', center: B, range: 4_000 }],
  encounters: [],
  arrival: { position: arrival, lookAt: platform },
  orbitLines: false,
  scaleNote: 'The A–B separation (about 8 to 31 AU in reality) is compressed.',
};
