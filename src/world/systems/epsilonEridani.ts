import type { SystemSceneDef } from '../sceneTypes.ts';
import { confirmedPlanets, dirTo, polar, v } from './helpers.ts';

const STAR = v(0, 0, 0);
const hub = polar(STAR, 24_000, 40, 0);
const arrival = hub.clone().add(v(6_500, 2_600, 7_500));

export const EPSILON_ERIDANI_SCENE: SystemSceneDef = {
  systemId: 'epsilon-eridani',
  skybox: {
    seed: 97,
    baseColor: '#070403',
    nebulaColors: ['#5a3a1f', '#3d2614', '#4a3a2a'],
    nebulaIntensity: 0.6,
    starDensity: 0.7,
    bandTilt: -0.8,
  },
  ambient: { sky: '#e0b48a', ground: '#140c06', intensity: 0.3 },
  stars: [
    { id: 'epsilon-eridani', name: 'Epsilon Eridani', position: STAR, radius: 3_200, color: '#ffc58c', kind: 'main-sequence', activity: 0.7, light: 2.2, lightRange: 90_000 },
  ],
  planets: confirmedPlanets(
    'epsilon-eridani',
    { 'epsilon-eridani': STAR },
    { 'eps Eri b': { orbit: 46_000, angle: 200, y: 1_500, radius: 4_000, style: 'exo-gas-giant' } },
  ),
  stations: [{ locationId: 'eridani-hub', kind: 'eridani-hub', position: hub, approach: dirTo(hub, arrival) }],
  lanes: [],
  belts: [
    {
      id: 'eps-inner-belt',
      center: STAR,
      shape: 'ring',
      innerRadius: 20_000,
      outerRadius: 28_000,
      thickness: 1_800,
      count: { low: 450, medium: 900, high: 1_500 },
      sizeMin: 18,
      sizeMax: 150,
      color: '#8a7462',
      seed: 5,
    },
    {
      id: 'eps-outer-belt',
      center: STAR,
      shape: 'ring',
      innerRadius: 82_000,
      outerRadius: 106_000,
      thickness: 5_000,
      count: { low: 150, medium: 300, high: 500 },
      sizeMin: 40,
      sizeMax: 260,
      color: '#9a8a7c',
      seed: 9,
    },
  ],
  dust: [
    { center: STAR, innerRadius: 18_000, outerRadius: 31_000, color: '#b08462', opacity: 0.22, seed: 3 },
    { center: STAR, innerRadius: 78_000, outerRadius: 112_000, color: '#a89080', opacity: 0.18, seed: 4 },
  ],
  beacons: [{ id: 'eps-jump', name: 'Eridani jump beacon', position: arrival.clone().add(v(250, -80, 250)), kind: 'jump' }],
  scanZones: [],
  encounters: [],
  arrival: { position: arrival, lookAt: hub },
  orbitLines: true,
  scaleNote: 'Belt and planet distances are schematic; individual asteroids are illustrative.',
};
