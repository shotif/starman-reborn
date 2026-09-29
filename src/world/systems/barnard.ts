import type { SystemSceneDef } from '../sceneTypes.ts';
import { confirmedPlanets, dirTo, v } from './helpers.ts';

const STAR = v(0, 0, 0);
const relay = v(11_000, 900, 7_000);
const arrival = relay.clone().add(v(3_500, 800, 6_500));

export const BARNARD_SCENE: SystemSceneDef = {
  systemId: 'barnard',
  skybox: {
    seed: 53,
    baseColor: '#060203',
    nebulaColors: ['#4a1210', '#2a0a0c', '#1a1024'],
    nebulaIntensity: 0.28,
    starDensity: 0.45,
    bandTilt: 1.1,
  },
  ambient: { sky: '#d98a6a', ground: '#120806', intensity: 0.22 },
  stars: [
    {
      id: 'barnards-star',
      name: 'Barnard’s Star',
      position: STAR,
      radius: 1_000,
      color: '#ff9466',
      kind: 'red-dwarf',
      activity: 0.6,
      glowScale: 1.2,
      light: 1.35,
      lightRange: 22_000,
    },
  ],
  // Four close-in planets (orbits of a few days), drawn on compressed schematic orbits.
  planets: confirmedPlanets(
    'barnard',
    { 'barnards-star': STAR },
    {
      'Barnard d': { orbit: 3_200, angle: 300, radius: 200, style: 'exo-scorched' },
      'Barnard b': { orbit: 4_000, angle: 30, y: 80, radius: 240, style: 'exo-scorched' },
      'Barnard c': { orbit: 4_800, angle: 140, y: -60, radius: 250, style: 'exo-scorched' },
      'Barnard e': { orbit: 6_600, angle: 230, y: 120, radius: 210, style: 'exo-scorched' },
    },
  ),
  stations: [{ locationId: 'barnard-relay', kind: 'barnard-relay', position: relay, approach: dirTo(relay, arrival) }],
  lanes: [],
  belts: [],
  dust: [],
  beacons: [{ id: 'barnard-jump', name: 'Barnard jump beacon', position: arrival.clone().add(v(200, -100, 300)), kind: 'jump' }],
  scanZones: [],
  encounters: [],
  arrival: { position: arrival, lookAt: relay },
  orbitLines: true,
  scaleNote: 'Planet orbits are compressed: the real planets circle the star in 2–7 days.',
};
