import type { SystemSceneDef } from '../sceneTypes.ts';
import { confirmedPlanets, dirTo, v } from './helpers.ts';

const A = v(0, 0, 0);
const B = v(26_000, 3_000, -14_000);
// Proxima lies far from the A/B pair (about 13,000 AU in reality); compressed here.
const PROXIMA = v(-170_000, 25_000, 160_000);

const planets = confirmedPlanets(
  'alpha-centauri',
  { 'proxima-centauri': PROXIMA },
  {
    'Proxima Cen b': { orbit: 6_000, angle: 25, y: 300, radius: 520, style: 'exo-rocky-warm' },
    'Proxima Cen d': { orbit: 3_000, angle: 215, y: -150, radius: 250, style: 'exo-scorched' },
    'Proxima Cen c': { orbit: 24_000, angle: 300, y: 1_000, radius: 1_400, style: 'exo-rocky-cold' },
  },
);
const proximaB = planets.find((p) => p.id === 'proxima-cen-b')?.position ?? PROXIMA.clone().add(v(5_400, 300, 2_600));
const arrival = v(-14_000, 3_500, 30_000);
const toProxima = dirTo(arrival, PROXIMA);
const meridian = proximaB.clone().add(v(1_500, 400, 900));
const laneFrom = arrival.clone().addScaledVector(toProxima, 3_000);
const laneTo = meridian.clone().addScaledVector(toProxima, -7_000);

export const ALPHA_CENTAURI_SCENE: SystemSceneDef = {
  systemId: 'alpha-centauri',
  skybox: {
    seed: 27,
    baseColor: '#070503',
    nebulaColors: ['#6b4a1d', '#4a2f14', '#2d2440'],
    nebulaIntensity: 0.5,
    starDensity: 0.85,
    bandTilt: -0.3,
  },
  ambient: { sky: '#e8c89a', ground: '#1c150f', intensity: 0.28 },
  stars: [
    { id: 'alpha-centauri-a', name: 'Alpha Centauri A', position: A, radius: 4_200, color: '#fff3e2', kind: 'main-sequence', activity: 0.45, light: 2.4, lightRange: 70_000 },
    { id: 'alpha-centauri-b', name: 'Alpha Centauri B', position: B, radius: 3_400, color: '#ffd2a0', kind: 'main-sequence', activity: 0.55, light: 1.5, lightRange: 55_000 },
    {
      id: 'proxima-centauri',
      name: 'Proxima Centauri',
      position: PROXIMA,
      radius: 900,
      color: '#ff8a5c',
      kind: 'red-dwarf',
      activity: 0.8,
      glowScale: 1.3,
      light: 1.5,
      lightRange: 16_000,
    },
  ],
  planets,
  stations: [{ locationId: 'meridian-outpost', kind: 'proxima-outpost', position: meridian, approach: toProxima.clone().negate() }],
  lanes: [{ id: 'ac-proxima', name: 'Proxima transfer lane', fromName: 'Lane to Proxima', toName: 'Lane to Alpha Centauri A/B', from: laneFrom, to: laneTo, ringSpacing: 12_000, speed: 9_500 }],
  belts: [],
  dust: [],
  beacons: [{ id: 'ac-jump', name: 'Rigil arrival beacon', position: arrival.clone().add(v(250, -120, -400)), kind: 'jump' }],
  scanZones: [],
  encounters: [],
  arrival: { position: arrival, lookAt: A },
  orbitLines: true,
  scaleNote: 'A/B separation and the distance to Proxima are compressed; Proxima really lies ~13,000 AU from the pair.',
};
