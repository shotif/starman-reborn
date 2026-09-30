import type { PlanetStyle } from '../art/planets.ts';
import type { StationKind } from '../art/stations.ts';

/**
 * Per-station art direction for the docked interiors: palette, light mood, architecture flavour,
 * how busy the place is, and what hangs outside the bay. Colours are sRGB hex strings.
 */

export type V3 = [number, number, number];

export type PillarKind = 'round' | 'ibeam' | 'modular' | 'lattice' | 'slab' | 'hex';
export type BayKind = 'open' | 'blast' | 'modular' | 'slot' | 'shielded' | 'market';
export type OutfitKind = 'coverall' | 'jacket' | 'suit' | 'coat' | 'uniform' | 'vest' | 'apron';
export type HatKind = 'none' | 'cap' | 'helmet' | 'beanie';

export interface Outfit {
  label: string;
  kind: OutfitKind;
  top: string;
  bottom: string;
  /** Collar, stripes, belt. */
  accent: string;
  hat?: HatKind;
  hatColor?: string;
}

export interface LightMood {
  color: string;
  intensity: number;
}

export interface HangarLook {
  floor: string;
  floorAlt: string;
  floorRough: number;
  floorMetal: number;
  wall: string;
  wallDark: string;
  trim: string;
  metal: string;
  pillar: string;
  accent: string;
  /** Floor paint (lines, pad ring). */
  marking: string;
  marking2: string;
  hazard: [string, string];
  /** Paint of machines (loader, service arms). */
  machine: string;
  /** Lamp fixtures (emissive). */
  lamp: string;
  lampLevel: number;
  /** Accent strips (emissive). */
  glow: string;
  glowLevel: number;
  hemiSky: string;
  hemiGround: string;
  hemi: number;
  key: LightMood;
  fillTrader: LightMood;
  fillOutfitter: LightMood;
  fog: string;
  fogDensity: number;
  pillarKind: PillarKind;
  bayKind: BayKind;
  /** Half width and height of the bay mouth. */
  mouth: [number, number];
  /** 0..1 how cluttered the floor is (crates, drums, carts). */
  clutter: number;
  /** Holographic displays tint. */
  holo: string;
  /** Pad hover-field glow. */
  padGlow: string;
  workers: number;
}

export interface BarLook {
  floor: string;
  floorPattern: 'tiles' | 'planks' | 'plates' | 'terrazzo';
  wall: string;
  wallTrim: string;
  counter: string;
  counterTop: string;
  seat: string;
  table: string;
  lamp: string;
  accent: string;
  /** Back-bar bottle/tank glow colours. */
  bottles: string[];
  hemiSky: string;
  hemiGround: string;
  hemi: number;
  key: LightMood;
  fillA: LightMood;
  fillB: LightMood;
  fog: string;
  fogDensity: number;
  window: 'panorama' | 'portholes' | 'band' | 'none';
  plants: number;
  patrons: number;
  bartender: Outfit;
  /** Extra dressing. */
  decor: 'lounge' | 'canteen' | 'mess' | 'spare' | 'clinic' | 'market';
}

export interface OutsideLook {
  /** Direction from the station towards its star (placed so the deck shot sees it in the bay). */
  starDir: V3;
  /**
   * Where the bay's spill light comes from (defaults to `starDir`): off to one side, it rakes
   * across the deck from beside the star rather than straight past the ship at the camera.
   */
  spillDir?: V3;
  /** Size of the star glow (world units at distance 1000). */
  starSize: number;
  starIntensity: number;
  /**
   * `frontLight` pulls the planet's lighting towards the viewer (artistic licence: the star stays
   * visible in the bay while the planet still shows a lit face instead of a thin crescent).
   */
  planet?: { style: PlanetStyle; radius: number; distance: number; dir: V3; tilt?: number; seed: number; frontLight: number };
  /** A second bright point (e.g. Sirius B). */
  companion?: { dir: V3; color: string; size: number };
  /** Floating rocks outside the bay (debris belt). */
  rocks: number;
  /** How the light spills in through the bay: tint mixed into the star colour, and strength. */
  spillTint: string;
  spillMix: number;
  spill: number;
  /** Strength of light shafts through the bay (0 = none). */
  rays: number;
}

export interface InteriorStyle {
  kind: StationKind;
  name: string;
  hangar: HangarLook;
  bar: BarLook;
  crowd: Outfit[];
  skin: string[];
  hair: string[];
  outside: OutsideLook;
}

const SKIN = ['#f1c9a8', '#e3b08a', '#c98f66', '#ad7048', '#8d5636', '#6a3f28', '#4a2e20'];
const HAIR = ['#1b1512', '#3a2a1e', '#5e4128', '#9a7446', '#d6bf94', '#8e8e8e', '#a8462a', '#262626'];

export const STYLES: Record<StationKind, InteriorStyle> = {
  'earth-port': {
    kind: 'earth-port',
    name: 'Halcyon Ring',
    hangar: {
      floor: '#b4bac3',
      floorAlt: '#a3aab4',
      floorRough: 0.62,
      floorMetal: 0.35,
      wall: '#d3d9e0',
      wallDark: '#7d8794',
      trim: '#5a6573',
      metal: '#98a2ae',
      pillar: '#dfe4ea',
      accent: '#2f7fd8',
      marking: '#eef3f8',
      marking2: '#3d8fe8',
      hazard: ['#e3b62e', '#262b33'],
      machine: '#e3b62e',
      lamp: '#eaf2ff',
      lampLevel: 2.4,
      glow: '#4aa2ff',
      glowLevel: 2.2,
      hemiSky: '#b9cbe4',
      hemiGround: '#3c4450',
      hemi: 0.38,
      key: { color: '#f4f7ff', intensity: 60 },
      fillTrader: { color: '#9cc4ff', intensity: 34 },
      fillOutfitter: { color: '#c8dcff', intensity: 30 },
      fog: '#1a2536',
      fogDensity: 0.0065,
      pillarKind: 'round',
      bayKind: 'open',
      mouth: [31, 17],
      clutter: 0.45,
      holo: '#5ab8ff',
      padGlow: '#7cc4ff',
      workers: 3,
    },
    bar: {
      floor: '#6a7482',
      floorPattern: 'terrazzo',
      wall: '#3e4a5c',
      wallTrim: '#c79a52',
      counter: '#1d2530',
      counterTop: '#d8dee6',
      seat: '#2c4a78',
      table: '#e2e6ec',
      lamp: '#ffc47a',
      accent: '#4aa8ff',
      bottles: ['#5ab8ff', '#ffb45a', '#9af0ff', '#ff8a5a'],
      hemiSky: '#7a96c4',
      hemiGround: '#2a2016',
      hemi: 0.72,
      key: { color: '#ffcf8a', intensity: 16 },
      fillA: { color: '#6aa8ff', intensity: 10 },
      fillB: { color: '#ffb46a', intensity: 9 },
      fog: '#0d1320',
      fogDensity: 0.02,
      window: 'panorama',
      plants: 3,
      patrons: 6,
      bartender: { label: 'Bartender', kind: 'vest', top: '#1d232c', bottom: '#15191f', accent: '#e9edf2' },
      decor: 'lounge',
    },
    crowd: [
      { label: 'Pilot', kind: 'jacket', top: '#24406e', bottom: '#2b2f38', accent: '#6fb0ff' },
      { label: 'Trader', kind: 'suit', top: '#3a3f48', bottom: '#2c3038', accent: '#c9a05a' },
      { label: 'Courier', kind: 'jacket', top: '#8a929c', bottom: '#30343c', accent: '#2f7fd8' },
      { label: 'Transit officer', kind: 'uniform', top: '#1f2d4a', bottom: '#1f2d4a', accent: '#d8b45a', hat: 'cap' },
      { label: 'Engineer', kind: 'coverall', top: '#dfe4ea', bottom: '#dfe4ea', accent: '#2f7fd8' },
      { label: 'Traveller', kind: 'coat', top: '#8a5a3a', bottom: '#2a2a30', accent: '#e8dcc8' },
    ],
    skin: SKIN,
    hair: HAIR,
    outside: {
      starDir: [-0.021, 0.02, -1],
      spillDir: [0.34, 0.1, -0.94],
      starSize: 55,
      starIntensity: 1.3,
      planet: { style: 'earth', radius: 2300, distance: 9000, dir: [-0.42, -0.2, -1], tilt: 0.41, seed: 3, frontLight: 1.4 },
      rocks: 0,
      spillTint: '#8fc2ff',
      spillMix: 0.35,
      spill: 2.5,
      rays: 0,
    },
  },

  'mars-depot': {
    kind: 'mars-depot',
    name: 'Deimos Depot',
    hangar: {
      floor: '#6a5646',
      floorAlt: '#584638',
      floorRough: 0.78,
      floorMetal: 0.4,
      wall: '#7b5a45',
      wallDark: '#3b2b21',
      trim: '#2c231d',
      metal: '#6d5849',
      pillar: '#5e4a3c',
      accent: '#c9622a',
      marking: '#e2aa30',
      marking2: '#d9d2c4',
      hazard: ['#e2aa30', '#1c1814'],
      machine: '#e2aa30',
      lamp: '#ffb25a',
      lampLevel: 2.6,
      glow: '#ff7a2a',
      glowLevel: 1.8,
      hemiSky: '#c98a5c',
      hemiGround: '#24160e',
      hemi: 0.34,
      key: { color: '#ffb866', intensity: 64 },
      fillTrader: { color: '#ff9a4a', intensity: 36 },
      fillOutfitter: { color: '#ffc27a', intensity: 30 },
      fog: '#2c1a10',
      fogDensity: 0.0095,
      pillarKind: 'ibeam',
      bayKind: 'blast',
      mouth: [28, 16],
      clutter: 0.85,
      holo: '#ffb24a',
      padGlow: '#ffb070',
      workers: 4,
    },
    bar: {
      floor: '#4a3a2e',
      floorPattern: 'plates',
      wall: '#5a4436',
      wallTrim: '#e2aa30',
      counter: '#6a4a36',
      counterTop: '#8a8a86',
      seat: '#8a3a22',
      table: '#6e6a64',
      lamp: '#ffb25a',
      accent: '#ff7a2a',
      bottles: ['#ffb45a', '#ff6a3a', '#ffd88a', '#9ad86a'],
      hemiSky: '#c98a5c',
      hemiGround: '#1c120c',
      hemi: 0.6,
      key: { color: '#ffbf70', intensity: 18 },
      fillA: { color: '#ff9a50', intensity: 11 },
      fillB: { color: '#ffd29a', intensity: 8 },
      fog: '#1e130c',
      fogDensity: 0.024,
      window: 'portholes',
      plants: 0,
      patrons: 6,
      bartender: { label: 'Cook', kind: 'apron', top: '#b8b2a6', bottom: '#3a302a', accent: '#8a3a22' },
      decor: 'canteen',
    },
    crowd: [
      { label: 'Dockworker', kind: 'coverall', top: '#d9642a', bottom: '#d9642a', accent: '#e8e4d8', hat: 'helmet', hatColor: '#e8c02e' },
      { label: 'Dockworker', kind: 'coverall', top: '#c8a032', bottom: '#4a4038', accent: '#e8e4d8', hat: 'beanie' },
      { label: 'Customs officer', kind: 'uniform', top: '#3e3228', bottom: '#2e261f', accent: '#e2aa30', hat: 'cap' },
      { label: 'Mechanic', kind: 'coverall', top: '#6a6258', bottom: '#6a6258', accent: '#d9642a' },
      { label: 'Hauler', kind: 'jacket', top: '#7a2e1e', bottom: '#2e2a26', accent: '#caa46a' },
      { label: 'Pilot', kind: 'jacket', top: '#4a3a2c', bottom: '#2b2926', accent: '#d9642a' },
    ],
    skin: SKIN,
    hair: HAIR,
    outside: {
      starDir: [0.06, -0.109, -0.992],
      spillDir: [0.3, 0.12, -0.95],
      starSize: 42,
      starIntensity: 1.1,
      planet: { style: 'mars', radius: 1900, distance: 8000, dir: [-0.45, -0.18, -1], tilt: 0.44, seed: 5, frontLight: 1.2 },
      rocks: 0,
      spillTint: '#ff8a5a',
      spillMix: 0.45,
      spill: 3.0,
      rays: 0.025,
    },
  },

  'proxima-outpost': {
    kind: 'proxima-outpost',
    name: 'Meridian Outpost',
    hangar: {
      floor: '#5f6a63',
      floorAlt: '#545e58',
      floorRough: 0.7,
      floorMetal: 0.3,
      wall: '#b5bdb2',
      wallDark: '#48524b',
      trim: '#343c37',
      metal: '#7a857e',
      pillar: '#a9b3a8',
      accent: '#3fae6a',
      marking: '#e2e8dc',
      marking2: '#46c27a',
      hazard: ['#d8b43a', '#252a27'],
      machine: '#d8b43a',
      lamp: '#ffeed2',
      lampLevel: 2.0,
      glow: '#58f08e',
      glowLevel: 1.9,
      hemiSky: '#b89a8c',
      hemiGround: '#161a17',
      hemi: 0.3,
      key: { color: '#ffe4c4', intensity: 52 },
      fillTrader: { color: '#7dffa6', intensity: 26 },
      fillOutfitter: { color: '#ffd6b0', intensity: 24 },
      fog: '#121a15',
      fogDensity: 0.009,
      pillarKind: 'modular',
      bayKind: 'modular',
      mouth: [24, 14],
      clutter: 0.55,
      holo: '#6affb0',
      padGlow: '#8affc0',
      workers: 3,
    },
    bar: {
      floor: '#5a4a3a',
      floorPattern: 'planks',
      wall: '#9ca592',
      wallTrim: '#3fae6a',
      counter: '#7a5a3e',
      counterTop: '#c9c2b0',
      seat: '#3f6e4e',
      table: '#8a6a4a',
      lamp: '#ffd9a0',
      accent: '#58f08e',
      bottles: ['#8aff9a', '#ffd06a', '#ff9a6a', '#c8ff6a'],
      hemiSky: '#a8b89a',
      hemiGround: '#1a140e',
      hemi: 0.55,
      key: { color: '#ffd8a0', intensity: 15 },
      fillA: { color: '#7dffa6', intensity: 9 },
      fillB: { color: '#ff8a5c', intensity: 8 },
      fog: '#101510',
      fogDensity: 0.022,
      window: 'band',
      plants: 10,
      patrons: 4,
      bartender: { label: 'Cook', kind: 'apron', top: '#d8d6c8', bottom: '#3a3a32', accent: '#3fae6a' },
      decor: 'mess',
    },
    crowd: [
      { label: 'Scientist', kind: 'coat', top: '#e6e8e2', bottom: '#3a4038', accent: '#3fae6a' },
      { label: 'Botanist', kind: 'coverall', top: '#4a7a52', bottom: '#4a7a52', accent: '#d8d0a0' },
      { label: 'Pilot', kind: 'jacket', top: '#2e6a66', bottom: '#2c302c', accent: '#d8b43a' },
      { label: 'Engineer', kind: 'coverall', top: '#6e7670', bottom: '#6e7670', accent: '#3fae6a', hat: 'beanie' },
      { label: 'Medic', kind: 'coat', top: '#bcd8e0', bottom: '#40484a', accent: '#e8f0f0' },
    ],
    skin: SKIN,
    hair: HAIR,
    outside: {
      starDir: [-0.096, -0.019, -0.995],
      spillDir: [0.28, 0.08, -0.96],
      starSize: 70,
      starIntensity: 0.9,
      planet: { style: 'exo-rocky-warm', radius: 1700, distance: 8200, dir: [-0.5, -0.2, -1], tilt: 0.2, seed: 7, frontLight: 0.7 },
      rocks: 0,
      spillTint: '#ff7a4a',
      spillMix: 0.3,
      spill: 1.2,
      rays: 0,
    },
  },

  'barnard-relay': {
    kind: 'barnard-relay',
    name: 'Barnard Transit Relay',
    hangar: {
      floor: '#44474c',
      floorAlt: '#3a3d42',
      floorRough: 0.72,
      floorMetal: 0.45,
      wall: '#4c5056',
      wallDark: '#1e1f22',
      trim: '#1a1b1e',
      metal: '#5a5e65',
      pillar: '#4a4e55',
      accent: '#a8322a',
      marking: '#8e949c',
      marking2: '#b8402e',
      hazard: ['#a88a2a', '#1a1a1c'],
      machine: '#a88a2a',
      lamp: '#dfe6f0',
      lampLevel: 1.8,
      glow: '#ff3a2a',
      glowLevel: 1.6,
      hemiSky: '#7a4a44',
      hemiGround: '#0c0808',
      hemi: 0.2,
      key: { color: '#e6ecf6', intensity: 48 },
      fillTrader: { color: '#ff5a44', intensity: 20 },
      fillOutfitter: { color: '#ff6a50', intensity: 14 },
      fog: '#120a0a',
      fogDensity: 0.012,
      pillarKind: 'lattice',
      bayKind: 'slot',
      mouth: [19, 12],
      clutter: 0.2,
      holo: '#ff6a4a',
      padGlow: '#ff8a70',
      workers: 1,
    },
    bar: {
      floor: '#2e3034',
      floorPattern: 'plates',
      wall: '#34373c',
      wallTrim: '#8a2a22',
      counter: '#3a3c40',
      counterTop: '#5a5e64',
      seat: '#5a2a24',
      table: '#44474c',
      lamp: '#ffc890',
      accent: '#ff3a2a',
      bottles: ['#ff5a3a', '#ffb06a', '#d8d8d8'],
      hemiSky: '#6a3a34',
      hemiGround: '#0a0606',
      hemi: 0.34,
      key: { color: '#ffc890', intensity: 13 },
      fillA: { color: '#ff4a34', intensity: 7 },
      fillB: { color: '#9aa8c0', intensity: 4 },
      fog: '#0e0808',
      fogDensity: 0.03,
      window: 'portholes',
      plants: 0,
      patrons: 3,
      bartender: { label: 'Relay keeper', kind: 'coverall', top: '#3a3e44', bottom: '#3a3e44', accent: '#a8322a' },
      decor: 'spare',
    },
    crowd: [
      { label: 'Relay technician', kind: 'coverall', top: '#3a3e44', bottom: '#3a3e44', accent: '#b8402e', hat: 'beanie' },
      { label: 'Drifter', kind: 'coat', top: '#5a4a3a', bottom: '#2a2826', accent: '#8a7a5a' },
      { label: 'Pilot', kind: 'jacket', top: '#2e3440', bottom: '#26282c', accent: '#b8402e' },
    ],
    skin: SKIN,
    hair: HAIR,
    outside: {
      starDir: [-0.017, -0.072, -0.997],
      spillDir: [0.17, -0.05, -0.98],
      starSize: 120,
      starIntensity: 1.5,
      rocks: 0,
      spillTint: '#ff5a3a',
      spillMix: 0.3,
      spill: 0.7,
      rays: 0,
    },
  },

  'sirius-platform': {
    kind: 'sirius-platform',
    name: 'Horizon Platform',
    hangar: {
      floor: '#dfe4ea',
      floorAlt: '#cfd5dd',
      floorRough: 0.6,
      floorMetal: 0.12,
      wall: '#eef1f5',
      wallDark: '#9aa4b0',
      trim: '#7c8794',
      metal: '#b6bec8',
      pillar: '#f2f4f7',
      accent: '#5aa8f0',
      marking: '#4a8ee0',
      marking2: '#9aa4b0',
      hazard: ['#2e3642', '#e6eaf0'],
      machine: '#dfe4ea',
      lamp: '#f6f9ff',
      lampLevel: 2.6,
      glow: '#8fd0ff',
      glowLevel: 2.4,
      hemiSky: '#c8d8f4',
      hemiGround: '#3a4252',
      hemi: 0.22,
      key: { color: '#ffffff', intensity: 46 },
      fillTrader: { color: '#bcd6ff', intensity: 24 },
      fillOutfitter: { color: '#d8e6ff', intensity: 22 },
      fog: '#1c2740',
      fogDensity: 0.006,
      pillarKind: 'slab',
      bayKind: 'shielded',
      mouth: [15, 11],
      clutter: 0.25,
      holo: '#8fd8ff',
      padGlow: '#bfe6ff',
      workers: 2,
    },
    bar: {
      floor: '#e2e6ec',
      floorPattern: 'tiles',
      wall: '#e8ecf1',
      wallTrim: '#6fb8ff',
      counter: '#f4f6f9',
      counterTop: '#9fb4cc',
      seat: '#c8d4e2',
      table: '#f4f6f9',
      lamp: '#eef6ff',
      accent: '#6fb8ff',
      bottles: ['#9fd8ff', '#e8f4ff', '#7ab8ff'],
      hemiSky: '#dfe9ff',
      hemiGround: '#6a7282',
      hemi: 0.85,
      key: { color: '#f2f8ff', intensity: 14 },
      fillA: { color: '#9ccaff', intensity: 9 },
      fillB: { color: '#dfe8ff', intensity: 7 },
      fog: '#5e7090',
      fogDensity: 0.012,
      window: 'none',
      plants: 2,
      patrons: 4,
      bartender: { label: 'Steward', kind: 'uniform', top: '#e8eef6', bottom: '#b8c4d4', accent: '#5aa8f0' },
      decor: 'clinic',
    },
    crowd: [
      { label: 'Researcher', kind: 'coat', top: '#f2f4f8', bottom: '#9aa6b6', accent: '#5aa8f0' },
      { label: 'Radiation technician', kind: 'coverall', top: '#c8ccd2', bottom: '#c8ccd2', accent: '#e6c02e', hat: 'helmet' },
      { label: 'Pilot', kind: 'jacket', top: '#3a5a8a', bottom: '#2a3444', accent: '#e8eef6' },
      { label: 'Observer', kind: 'suit', top: '#5a6a80', bottom: '#3a4454', accent: '#bfe6ff' },
    ],
    skin: SKIN,
    hair: HAIR,
    outside: {
      starDir: [-0.203, -0.13, -0.971],
      spillDir: [0.3, 0.1, -0.95],
      starSize: 190,
      starIntensity: 3.2,
      companion: { dir: [0.045, -0.106, -0.993], color: '#eef2ff', size: 16 },
      rocks: 0,
      spillTint: '#cfe0ff',
      spillMix: 0.3,
      spill: 2.8,
      rays: 0.11,
    },
  },

  'eridani-hub': {
    kind: 'eridani-hub',
    name: 'Eridani Mining Hub',
    hangar: {
      floor: '#6e5a42',
      floorAlt: '#5e4b36',
      floorRough: 0.74,
      floorMetal: 0.32,
      wall: '#8a6c4e',
      wallDark: '#3a2a1c',
      trim: '#2e2218',
      metal: '#7c6452',
      pillar: '#7a5a3e',
      accent: '#e0902a',
      marking: '#f0c040',
      marking2: '#3ab8a4',
      hazard: ['#f0c040', '#241a12'],
      machine: '#f0c040',
      lamp: '#ffc47e',
      lampLevel: 2.5,
      glow: '#ff5ab0',
      glowLevel: 2.0,
      hemiSky: '#e0a878',
      hemiGround: '#20140c',
      hemi: 0.36,
      key: { color: '#ffd29a', intensity: 60 },
      fillTrader: { color: '#ff9a5a', intensity: 36 },
      fillOutfitter: { color: '#ff7ab4', intensity: 26 },
      fog: '#2a1a10',
      fogDensity: 0.0085,
      pillarKind: 'hex',
      bayKind: 'market',
      mouth: [29, 16],
      clutter: 1,
      holo: '#ffc05a',
      padGlow: '#ffd08a',
      workers: 5,
    },
    bar: {
      floor: '#6a4a30',
      floorPattern: 'planks',
      wall: '#7a4e34',
      wallTrim: '#f0c040',
      counter: '#8a4a2a',
      counterTop: '#d8a860',
      seat: '#a8382a',
      table: '#9a6a3e',
      lamp: '#ffb860',
      accent: '#ff5ab0',
      bottles: ['#ffb45a', '#ff5ab0', '#5affd8', '#ffe06a', '#ff7a4a'],
      hemiSky: '#e0a070',
      hemiGround: '#1e120a',
      hemi: 0.62,
      key: { color: '#ffc27a', intensity: 17 },
      fillA: { color: '#ff6ab0', intensity: 10 },
      fillB: { color: '#ffb05a', intensity: 10 },
      fog: '#20140c',
      fogDensity: 0.022,
      window: 'band',
      plants: 4,
      patrons: 8,
      bartender: { label: 'Bartender', kind: 'vest', top: '#7a2a4a', bottom: '#2a1e18', accent: '#f0c040' },
      decor: 'market',
    },
    crowd: [
      { label: 'Miner', kind: 'coverall', top: '#c89a3a', bottom: '#c89a3a', accent: '#3a3028', hat: 'helmet', hatColor: '#d8d2c4' },
      { label: 'Trader', kind: 'jacket', top: '#8a2a5a', bottom: '#2a2420', accent: '#f0c040' },
      { label: 'Merchant', kind: 'coat', top: '#5a3a7a', bottom: '#2a2024', accent: '#e0902a' },
      { label: 'Pilot', kind: 'jacket', top: '#2e6a6a', bottom: '#2a2622', accent: '#f0c040' },
      { label: 'Refinery hand', kind: 'coverall', top: '#d0602a', bottom: '#4a3a2c', accent: '#e8e0c8', hat: 'beanie' },
      { label: 'Mechanic', kind: 'coverall', top: '#5a5448', bottom: '#5a5448', accent: '#3ab8a4' },
    ],
    skin: SKIN,
    hair: HAIR,
    outside: {
      starDir: [-0.035, 0.005, -0.999],
      spillDir: [0.32, 0.1, -0.94],
      starSize: 50,
      starIntensity: 1.2,
      planet: { style: 'exo-gas-giant', radius: 3400, distance: 14000, dir: [-0.45, -0.16, -1], tilt: 0.2, seed: 4, frontLight: 1.1 },
      rocks: 18,
      spillTint: '#ffb070',
      spillMix: 0.35,
      spill: 3.0,
      rays: 0,
    },
  },
};
