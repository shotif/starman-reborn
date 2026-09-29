import * as THREE from 'three';
import type { ScenePlanetDef, SystemSceneDef } from '../sceneTypes.ts';
import { dirTo, polar, v } from './helpers.ts';

const SUN = v(0, 0, 0);

interface SolPlanet {
  id: string;
  name: string;
  subtitle: string;
  orbit: number;
  angle: number;
  radius: number;
  style: ScenePlanetDef['style'];
  rings?: ScenePlanetDef['rings'];
  tilt?: number;
}

// Schematic layout: order and relative size are real, spacing and scale are compressed for play.
const PLANETS: SolPlanet[] = [
  { id: 'mercury', name: 'Mercury', subtitle: 'Terrestrial planet · 1st from the Sun', orbit: 18_000, angle: 200, radius: 600, style: 'mercury' },
  { id: 'venus', name: 'Venus', subtitle: 'Terrestrial planet · 2nd from the Sun', orbit: 27_000, angle: 140, radius: 1_300, style: 'venus' },
  { id: 'earth', name: 'Earth', subtitle: 'Terrestrial planet · 3rd from the Sun', orbit: 42_000, angle: 32, radius: 1_600, style: 'earth', tilt: 0.41 },
  { id: 'mars', name: 'Mars', subtitle: 'Terrestrial planet · 4th from the Sun', orbit: 56_000, angle: 58, radius: 900, style: 'mars', tilt: 0.44 },
  { id: 'jupiter', name: 'Jupiter', subtitle: 'Gas giant · 5th from the Sun', orbit: 88_000, angle: 110, radius: 5_200, style: 'jupiter', tilt: 0.05 },
  {
    id: 'saturn',
    name: 'Saturn',
    subtitle: 'Gas giant · 6th from the Sun',
    orbit: 118_000,
    angle: 250,
    radius: 4_400,
    style: 'saturn',
    tilt: 0.47,
    rings: { inner: 5_600, outer: 9_800, color: '#d9c7a0', opacity: 0.75 },
  },
  { id: 'uranus', name: 'Uranus', subtitle: 'Ice giant · 7th from the Sun', orbit: 142_000, angle: 320, radius: 2_400, style: 'uranus', tilt: 1.7 },
  { id: 'neptune', name: 'Neptune', subtitle: 'Ice giant · 8th from the Sun', orbit: 164_000, angle: 12, radius: 2_300, style: 'neptune', tilt: 0.49 },
];

const positions = Object.fromEntries(PLANETS.map((p) => [p.id, polar(SUN, p.orbit, p.angle)])) as Record<string, THREE.Vector3>;
const earth = positions.earth!;
const mars = positions.mars!;
const earthToMars = dirTo(earth, mars);
const earthPort = earth.clone().addScaledVector(earthToMars, 2_900).add(v(0, 600, 0));
const marsDepot = mars.clone().addScaledVector(earthToMars, -2_000).add(v(0, 350, 0));
const laneFrom = earthPort.clone().addScaledVector(earthToMars, 1_200);
const laneTo = marsDepot.clone().addScaledVector(earthToMars, -3_200);
const moon = earth.clone().add(v(3_600, 500, -2_200));
const arrival = marsDepot.clone().add(v(4_200, 1_300, 5_600));

export const SOL_SCENE: SystemSceneDef = {
  systemId: 'sol',
  skybox: {
    seed: 11,
    baseColor: '#03060d',
    nebulaColors: ['#1d4a6e', '#12304f', '#3a2f63'],
    nebulaIntensity: 0.45,
    starDensity: 0.8,
    bandTilt: 0.5,
  },
  ambient: { sky: '#9ab8e8', ground: '#1a1f2c', intensity: 0.32 },
  stars: [
    {
      id: 'sun',
      name: 'Sun',
      position: SUN,
      radius: 4_000,
      color: '#fff1d6',
      kind: 'main-sequence',
      activity: 0.5,
      light: 2.6,
      lightRange: 400_000,
    },
  ],
  planets: [
    ...PLANETS.map<ScenePlanetDef>((p) => ({
      id: p.id,
      name: p.name,
      subtitle: `${p.subtitle} · schematic size and orbit`,
      position: positions[p.id]!,
      radius: p.radius,
      style: p.style,
      hostStarId: 'sun',
      ...(p.rings ? { rings: p.rings } : {}),
      ...(p.tilt !== undefined ? { tilt: p.tilt } : {}),
      spinSpeed: 0.004,
      orbitCenter: SUN,
      scannable: true,
      scanRange: Math.max(9_000, p.radius * 4),
    })),
    {
      id: 'moon',
      name: 'Moon',
      subtitle: 'Earth’s natural satellite · schematic size and distance',
      position: moon,
      radius: 430,
      style: 'moon',
      hostStarId: 'sun',
      scannable: true,
    },
  ],
  stations: [
    { locationId: 'earth-port', kind: 'earth-port', position: earthPort, approach: earthToMars.clone() },
    { locationId: 'mars-depot', kind: 'mars-depot', position: marsDepot, approach: earthToMars.clone().negate() },
  ],
  lanes: [{ id: 'sol-earth-mars', name: 'Earth–Mars trade lane', fromName: 'Lane to Mars', toName: 'Lane to Earth', from: laneFrom, to: laneTo, ringSpacing: 2_000, speed: 2_600 }],
  belts: [],
  dust: [],
  beacons: [{ id: 'sol-jump', name: 'Sol jump beacon', position: arrival.clone().add(v(0, 0, 300)), kind: 'jump' }],
  scanZones: [],
  encounters: [{ id: 'mars-raider', center: marsDepot, radius: 7_500, spawnAhead: 1_300, bounty: 220 }],
  practice: { center: earthPort.clone().addScaledVector(earthToMars, 1_100).add(v(-500, 350, 300)), count: 3, radius: 160 },
  arrival: { position: arrival, lookAt: marsDepot },
  orbitLines: true,
  scaleNote: 'Planet sizes, spacing and positions are schematic, not today’s sky.',
};
