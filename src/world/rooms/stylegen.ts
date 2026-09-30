import type { PlanetStyle } from '../art/planets.ts';
import { seededRandom } from '../art/util.ts';
import { STATION_OWNERS, STATION_TYPES } from './look.ts';
import type { StationLook, StationOwner, StationType } from './look.ts';
import { HAIR, SKIN } from './styles.ts';
import type {
  BarDecor,
  BarLook,
  BayKind,
  CeilingKind,
  DressingKind,
  Emblem,
  GoodsKind,
  HangarLook,
  HatKind,
  InteriorStyle,
  Outfit,
  OutfitKind,
  OutsideLook,
  PillarKind,
  V3,
  WallKind,
} from './styles.ts';

/**
 * Interior art direction for generated stations, derived deterministically from a station's look:
 * the station type sets the character of the whole place (architecture, set dressing, goods, bar,
 * crowd, how bright it is), the owner its palette family and signage colours, `size` how big and
 * busy it feels, `wear` grime, clutter and dim or flickering light, `seed` the small variations
 * within the family and `starColor` the light through the bay.
 *
 * The result is plain data: callers may adjust it before building (for example to show the real
 * body a station orbits, set `outside.planet`).
 */

/* ------------------------------------------------------------------------------------------------
 * Colour helpers (sRGB hex strings).
 * ---------------------------------------------------------------------------------------------- */

type RGB = [number, number, number];

function rgb(hex: string): RGB {
  const n = parseInt(hex.slice(1, 7), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

function toHex([r, g, b]: RGB): string {
  const c = (v: number): string =>
    Math.round(Math.max(0, Math.min(1, v)) * 255)
      .toString(16)
      .padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
}

function toHsl(hex: string): RGB {
  const [r, g, b] = rgb(hex);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h / 6, s, l];
}

/** HSL (all 0..1, hue wraps) to hex. */
export function hsl(h: number, s: number, l: number): string {
  h = ((h % 1) + 1) % 1;
  s = Math.max(0, Math.min(1, s));
  l = Math.max(0, Math.min(1, l));
  if (s === 0) return toHex([l, l, l]);
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const f = (t: number): number => {
    t = ((t % 1) + 1) % 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return toHex([f(h + 1 / 3), f(h), f(h - 1 / 3)]);
}

/** Linear blend of two colours. */
export function mix(a: string, b: string, t: number): string {
  const x = rgb(a);
  const y = rgb(b);
  return toHex([x[0] + (y[0] - x[0]) * t, x[1] + (y[1] - x[1]) * t, x[2] + (y[2] - x[2]) * t]);
}

/** Brightness scale (k > 1 brightens towards clipping). */
export function scale(a: string, k: number): string {
  const [r, g, b] = rgb(a);
  return toHex([r * k, g * k, b * k]);
}

/** Shift hue (turns), saturation and lightness (multipliers). */
function adjust(a: string, dh: number, sat = 1, light = 1): string {
  const [h, s, l] = toHsl(a);
  return hsl(h + dh, s * sat, l * light);
}

const clamp01 = (v: number): number => Math.max(0, Math.min(1, Number.isFinite(v) ? v : 0));
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/* ------------------------------------------------------------------------------------------------
 * Owner palettes: the colour family of everything painted, lit or signed.
 * ---------------------------------------------------------------------------------------------- */

interface Palette {
  /** Neutrals from light to deep (cladding, trims, metals). */
  light: string;
  mid: string;
  dark: string;
  deep: string;
  /** Primary and secondary accent paint. */
  accent: string;
  accent2: string;
  /** Emissive strips and signage glow. */
  glow: string;
  lamp: string;
  holo: string;
  hazard: [string, string];
  machine: string;
  marking: string;
  /** Workwear and service uniforms. */
  work: string;
  uniform: string;
  rust: string;
  signs: string[];
  containers: string[];
  bottles: string[];
}

const NEON = ['#ff3ab0', '#2ae0ff', '#ffd23a', '#7aff4a', '#ff7a2a', '#b05aff'];

function shuffle<T>(list: readonly T[], rand: () => number): T[] {
  const out = list.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

function ownerPalette(owner: StationOwner, rand: () => number): Palette {
  // Small hue and lightness drift within the family, so no two stations of an owner match exactly.
  const dh = (rand() - 0.5) * 0.03;
  const dl = 1 + (rand() - 0.5) * 0.08;
  const j = (hex: string): string => adjust(hex, dh, 1, dl);
  switch (owner) {
    case 'sta':
      return {
        light: j('#dde3ea'),
        mid: j('#98a3b0'),
        dark: j('#56626f'),
        deep: j('#252b34'),
        accent: j('#2f7fd8'),
        accent2: '#e3b62e',
        glow: j('#4aa6ff'),
        lamp: '#eef4ff',
        holo: j('#5ab8ff'),
        hazard: ['#e3b62e', '#262b33'],
        machine: rand() < 0.5 ? '#e3b62e' : j('#3a6fc0'),
        marking: '#eef3f8',
        work: j('#dfe4ea'),
        uniform: j('#1f2d4a'),
        rust: '#8a5a3a',
        signs: [j('#2f7fd8'), '#eef3f8', j('#1d3f7a'), '#e3b62e'],
        containers: ['#e8ecf0', j('#2f64c8'), j('#9aa4b0'), '#dfe4ea', j('#3a78d8'), j('#6a7482')],
        bottles: [j('#5ab8ff'), '#ffb45a', '#9af0ff', '#eef4ff'],
      };
    case 'frontier':
      return {
        light: j('#cdbf9c'),
        mid: j('#8c8766'),
        dark: j('#4d4a38'),
        deep: j('#27251d'),
        accent: j('#2a9d8f'),
        accent2: j('#d9a441'),
        glow: j('#48e0c8'),
        lamp: '#ffe6bf',
        holo: j('#6affd8'),
        hazard: ['#e0b030', '#2a2820'],
        machine: rand() < 0.5 ? j('#d9a441') : j('#7a7a4a'),
        marking: '#e8dcb8',
        work: j('#d9642a'),
        uniform: j('#5a6040'),
        rust: '#9a5a2e',
        signs: [j('#2a9d8f'), '#e8c878', j('#6f7a3a'), j('#d9642a')],
        containers: [j('#7a7a4a'), j('#c9b98e'), j('#2e8a78'), j('#a86a3a'), j('#5e6a4a'), j('#d8a832')],
        bottles: [j('#8affd0'), '#ffd06a', '#ff9a6a', '#c8ff6a'],
      };
    case 'hollow-wake':
      return {
        light: j('#7c706a'),
        mid: j('#4f4642'),
        dark: j('#2d2624'),
        deep: j('#171312'),
        accent: j('#b8321e'),
        accent2: j('#9a5a2e'),
        glow: j('#ff3a24'),
        lamp: '#ffb88a',
        holo: j('#ff5a3a'),
        hazard: ['#c0281e', '#1a1614'],
        machine: j('#8a4a2a'),
        marking: '#b8a890',
        work: j('#7a3a22'),
        uniform: j('#2a2422'),
        rust: j('#8a4a2a'),
        signs: [j('#c0281e'), '#e0d0b0', j('#8a4a2a'), '#ff6a3a'],
        containers: [j('#5a2a24'), j('#6a4a3a'), j('#3a3230'), j('#8a3a24'), j('#4a4440'), j('#7a5a3a')],
        bottles: ['#ff5a3a', '#ffb06a', '#d8a860', '#ff8a4a'],
      };
    case 'independent': {
      // Mixed neon over a cool or warm grey: every independent port picks its own signage.
      const hue = [0.72, 0.55, 0.9, 0.08][Math.floor(rand() * 4)]!;
      const neon = shuffle(NEON, rand);
      return {
        light: hsl(hue, 0.1, 0.7 * dl),
        mid: hsl(hue, 0.09, 0.44 * dl),
        dark: hsl(hue, 0.1, 0.25 * dl),
        deep: hsl(hue, 0.12, 0.12 * dl),
        accent: neon[0]!,
        accent2: neon[1]!,
        glow: neon[0]!,
        lamp: rand() < 0.5 ? '#ffd8c4' : '#eee4ff',
        holo: neon[1]!,
        hazard: ['#ffd23a', hsl(hue, 0.12, 0.12)],
        machine: neon[2]!,
        marking: '#f0e8d0',
        work: mix(neon[2]!, '#6a6a6a', 0.35),
        uniform: hsl(hue, 0.15, 0.24),
        rust: '#8a5a3a',
        signs: neon.slice(0, 4),
        containers: ['#c83a7a', '#2a8ab8', '#d8a832', '#4aa84a', '#8a4ac8', '#c8622a', '#5a5a6a'],
        bottles: neon.slice(0, 5),
      };
    }
  }
}

/* ------------------------------------------------------------------------------------------------
 * Station types: the character of the whole place.
 * ---------------------------------------------------------------------------------------------- */

type Slot = keyof Omit<Palette, 'hazard' | 'signs' | 'containers' | 'bottles'>;
/** Outfit template: colours are palette slots or literal hex. */
type Role = [label: string, kind: OutfitKind, top: Slot | `#${string}`, bottom: Slot | `#${string}`, accent: Slot | `#${string}`, hat?: HatKind, hatColor?: Slot | `#${string}`];

interface TypeDef {
  name: string;
  /** Cladding tone of walls and pillars. */
  tone: 'light' | 'mid' | 'dark';
  /** 0..1 how brightly lit. */
  bright: number;
  /** -1 warm .. +1 cool lamp light. */
  cool: number;
  clutter: number;
  /** 0..1 how busy (crowd, traffic). */
  busy: number;
  walls: WallKind;
  ceiling: CeilingKind;
  pillars: PillarKind[];
  bays: BayKind[];
  /** Half width of the bay mouth for small and large stations. */
  mouth: [number, number];
  floor: [rough: number, metal: number];
  /** Fog density multiplier (haze, dust, steam). */
  haze: number;
  dressing: DressingKind[];
  /** Optional extras, each built when the seed rolls under its chance. */
  extras?: [DressingKind, number][];
  goods: GoodsKind;
  /** The type's own light colour mixed into the owner's glow (grow lights, furnace heat, alarms). */
  glowTint?: [string, number];
  bar: { decor: BarDecor[]; window: BarLook['window'][]; floor: BarLook['floorPattern'][]; plants: [number, number] };
  crowd: Role[];
  dealer: Role;
  mechanic: Role;
  bartender: Role;
  outside: { planets: PlanetStyle[]; planetChance: number; rocks: [number, number]; rays: number };
}

const TYPES: Record<StationType, TypeDef> = {
  'trade-port': {
    name: 'trade port',
    tone: 'light',
    bright: 0.95,
    cool: 0.2,
    clutter: 0.45,
    busy: 1,
    walls: 'panels',
    ceiling: 'truss',
    pillars: ['round', 'slab'],
    bays: ['open'],
    mouth: [26, 31],
    floor: [0.6, 0.32],
    haze: 0.8,
    dressing: ['gallery', 'guide-lights', 'concourse', 'carts'],
    goods: 'commodities',
    bar: { decor: ['cafe'], window: ['panorama'], floor: ['terrazzo', 'tiles'], plants: [4, 8] },
    crowd: [
      ['Trader', 'suit', 'dark', 'deep', 'accent2'],
      ['Pilot', 'jacket', 'accent', 'deep', 'light'],
      ['Courier', 'jacket', 'mid', 'dark', 'accent'],
      ['Dock crew', 'coverall', 'work', 'work', 'accent', 'cap'],
      ['Traveller', 'coat', '#8a5a3a', 'deep', '#e8dcc8'],
      ['Port officer', 'uniform', 'uniform', 'uniform', 'accent2', 'cap'],
    ],
    dealer: ['Trader', 'suit', 'deep', 'deep', 'accent2'],
    mechanic: ['Engineer', 'coverall', 'light', 'light', 'accent'],
    bartender: ['Barista', 'apron', 'light', 'dark', 'accent'],
    outside: { planets: ['exo-rocky-warm', 'exo-rocky-cold', 'exo-gas-giant'], planetChance: 0.85, rocks: [0, 0], rays: 0 },
  },
  'customs-depot': {
    name: 'customs depot',
    tone: 'light',
    bright: 0.8,
    cool: 0.55,
    clutter: 0.3,
    busy: 0.65,
    walls: 'panels',
    ceiling: 'truss',
    pillars: ['slab', 'ibeam'],
    bays: ['scanner'],
    mouth: [22, 28],
    floor: [0.66, 0.36],
    haze: 0.9,
    dressing: ['scanner-gates', 'hazard-lanes', 'inspection'],
    extras: [['gallery', 0.5]],
    goods: 'seized',
    bar: { decor: ['canteen'], window: ['band', 'portholes'], floor: ['plates', 'tiles'], plants: [0, 2] },
    crowd: [
      ['Customs officer', 'uniform', 'uniform', 'uniform', 'accent2', 'cap'],
      ['Inspector', 'uniform', 'mid', 'dark', 'accent', 'cap'],
      ['Pilot', 'jacket', 'dark', 'deep', 'accent'],
      ['Dock crew', 'coverall', 'work', 'work', 'dark', 'helmet', 'accent2'],
      ['Hauler', 'jacket', 'accent2', 'dark', 'light'],
      ['Clerk', 'suit', 'mid', 'dark', 'accent'],
    ],
    dealer: ['Customs officer', 'uniform', 'uniform', 'uniform', 'accent2', 'cap'],
    mechanic: ['Mechanic', 'coverall', 'mid', 'mid', 'accent'],
    bartender: ['Cook', 'apron', 'light', 'dark', 'accent'],
    outside: { planets: ['exo-rocky-cold', 'exo-rocky-warm', 'exo-scorched'], planetChance: 0.6, rocks: [0, 0], rays: 0 },
  },
  shipyard: {
    name: 'shipyard',
    tone: 'mid',
    bright: 0.75,
    cool: 0.15,
    clutter: 0.55,
    busy: 0.8,
    walls: 'panels',
    ceiling: 'truss',
    pillars: ['lattice', 'ibeam'],
    bays: ['gantry'],
    mouth: [27, 31],
    floor: [0.72, 0.42],
    haze: 1.1,
    dressing: ['hull-dock', 'bridge-crane', 'welders'],
    goods: 'hull',
    bar: { decor: ['canteen', 'messhall'], window: ['band'], floor: ['plates'], plants: [0, 1] },
    crowd: [
      ['Shipwright', 'coverall', 'work', 'work', 'dark', 'helmet', 'accent2'],
      ['Welder', 'coverall', 'dark', 'dark', 'accent2', 'helmet', '#2a2c30'],
      ['Engineer', 'coverall', 'light', 'light', 'accent'],
      ['Foreman', 'vest', 'dark', 'deep', 'work', 'cap'],
      ['Pilot', 'jacket', 'accent', 'deep', 'light'],
      ['Buyer', 'suit', 'mid', 'dark', 'accent2'],
    ],
    dealer: ['Yard broker', 'suit', 'dark', 'deep', 'accent2'],
    mechanic: ['Shipwright', 'coverall', 'work', 'work', 'dark', 'helmet', 'accent2'],
    bartender: ['Cook', 'apron', 'light', 'dark', 'accent'],
    outside: { planets: ['exo-gas-giant', 'exo-rocky-cold'], planetChance: 0.7, rocks: [0, 0], rays: 0.02 },
  },
  'mining-outpost': {
    name: 'mining outpost',
    tone: 'mid',
    bright: 0.55,
    cool: 0.35,
    clutter: 0.8,
    busy: 0.55,
    walls: 'rock',
    ceiling: 'truss',
    pillars: ['rock', 'ibeam'],
    bays: ['rock'],
    mouth: [20, 27],
    floor: [0.82, 0.3],
    haze: 1.25,
    dressing: ['ore-carts', 'work-lights', 'rubble', 'ore-bins'],
    goods: 'ore',
    bar: { decor: ['canteen'], window: ['portholes', 'band'], floor: ['plates'], plants: [0, 1] },
    crowd: [
      ['Miner', 'coverall', 'work', 'work', 'dark', 'helmet', 'accent2'],
      ['Driller', 'coverall', 'mid', 'mid', 'work', 'helmet', '#d8d2c4'],
      ['Hauler', 'jacket', 'accent', 'dark', 'light'],
      ['Assayer', 'coat', 'light', 'dark', 'accent'],
      ['Engineer', 'coverall', 'dark', 'dark', 'accent', 'beanie'],
      ['Pilot', 'jacket', 'dark', 'deep', 'accent2'],
    ],
    dealer: ['Ore buyer', 'vest', 'dark', 'deep', 'accent2'],
    mechanic: ['Mechanic', 'coverall', 'mid', 'mid', 'work'],
    bartender: ['Cook', 'apron', 'light', 'dark', 'accent'],
    outside: { planets: ['exo-rocky-cold', 'exo-scorched'], planetChance: 0.5, rocks: [10, 20], rays: 0.04 },
  },
  refinery: {
    name: 'refinery',
    tone: 'mid',
    bright: 0.55,
    cool: -0.65,
    clutter: 0.55,
    busy: 0.5,
    walls: 'panels',
    ceiling: 'truss',
    pillars: ['pipes'],
    bays: ['blast'],
    mouth: [22, 28],
    floor: [0.78, 0.45],
    haze: 1.5,
    dressing: ['pipework', 'tanks', 'heat'],
    goods: 'fuel',
    glowTint: ['#ff7a2a', 0.7],
    bar: { decor: ['canteen'], window: ['portholes'], floor: ['plates'], plants: [0, 0] },
    crowd: [
      ['Refinery hand', 'coverall', 'work', 'dark', 'light', 'helmet', 'accent2'],
      ['Process engineer', 'coverall', 'light', 'light', 'accent', 'cap'],
      ['Hauler', 'jacket', 'dark', 'deep', 'work'],
      ['Chemist', 'coat', 'light', 'mid', 'accent'],
      ['Foreman', 'vest', 'mid', 'dark', 'work', 'helmet', 'light'],
      ['Pilot', 'jacket', 'accent', 'deep', 'light'],
    ],
    dealer: ['Fuel broker', 'vest', 'dark', 'deep', 'accent'],
    mechanic: ['Pipefitter', 'coverall', 'mid', 'mid', 'work', 'beanie'],
    bartender: ['Cook', 'apron', 'light', 'dark', 'accent'],
    outside: { planets: ['exo-gas-giant', 'exo-scorched'], planetChance: 0.8, rocks: [0, 0], rays: 0.07 },
  },
  factory: {
    name: 'factory',
    tone: 'mid',
    bright: 0.8,
    cool: 0.25,
    clutter: 0.55,
    busy: 0.75,
    walls: 'panels',
    ceiling: 'truss',
    pillars: ['modular', 'ibeam'],
    bays: ['modular', 'blast'],
    mouth: [23, 29],
    floor: [0.7, 0.4],
    haze: 1,
    dressing: ['conveyors', 'robot-arms', 'hazard-lanes'],
    goods: 'machinery',
    bar: { decor: ['messhall', 'canteen'], window: ['band'], floor: ['plates', 'tiles'], plants: [0, 2] },
    crowd: [
      ['Fabricator', 'coverall', 'mid', 'mid', 'work'],
      ['Line technician', 'coverall', 'light', 'light', 'accent', 'cap'],
      ['Engineer', 'coat', 'light', 'dark', 'accent'],
      ['Foreman', 'vest', 'dark', 'deep', 'work', 'helmet', 'work'],
      ['Hauler', 'jacket', 'accent2', 'dark', 'light'],
      ['Buyer', 'suit', 'dark', 'deep', 'accent'],
    ],
    dealer: ['Sales agent', 'suit', 'mid', 'dark', 'accent'],
    mechanic: ['Line technician', 'coverall', 'light', 'light', 'accent', 'cap'],
    bartender: ['Cook', 'apron', 'light', 'dark', 'accent'],
    outside: { planets: ['exo-rocky-cold', 'exo-rocky-warm', 'exo-gas-giant'], planetChance: 0.6, rocks: [0, 0], rays: 0.02 },
  },
  'agri-station': {
    name: 'agricultural station',
    tone: 'light',
    bright: 0.75,
    cool: -0.2,
    clutter: 0.45,
    busy: 0.6,
    walls: 'panels',
    ceiling: 'truss',
    pillars: ['modular', 'round'],
    bays: ['modular', 'open'],
    mouth: [22, 28],
    floor: [0.72, 0.28],
    haze: 1.1,
    dressing: ['planters', 'grow-lights', 'hydroponics'],
    goods: 'crops',
    glowTint: ['#7dffa6', 0.55],
    bar: { decor: ['mess'], window: ['band', 'panorama'], floor: ['planks'], plants: [7, 10] },
    crowd: [
      ['Grower', 'coverall', '#4a7a52', '#4a7a52', 'light'],
      ['Botanist', 'coat', 'light', 'dark', '#5aa83a'],
      ['Hydroponics tech', 'coverall', 'mid', 'mid', 'accent', 'beanie'],
      ['Hauler', 'jacket', 'accent2', 'dark', 'light'],
      ['Cook', 'apron', 'light', 'dark', 'accent'],
      ['Pilot', 'jacket', 'dark', 'deep', 'accent'],
    ],
    dealer: ['Produce trader', 'vest', '#6a8a4a', 'dark', 'accent2'],
    mechanic: ['Engineer', 'coverall', 'mid', 'mid', 'accent', 'beanie'],
    bartender: ['Cook', 'apron', 'light', 'dark', '#5aa83a'],
    outside: { planets: ['exo-rocky-warm', 'exo-rocky-cold'], planetChance: 0.85, rocks: [0, 0], rays: 0.05 },
  },
  'research-station': {
    name: 'research station',
    tone: 'light',
    bright: 0.8,
    cool: 0.75,
    clutter: 0.2,
    busy: 0.45,
    walls: 'clean',
    ceiling: 'truss',
    pillars: ['slab'],
    bays: ['shielded', 'open'],
    mouth: [15, 24],
    floor: [0.55, 0.12],
    haze: 0.7,
    dressing: ['floor-seams', 'lab-benches', 'sample-racks'],
    goods: 'samples',
    bar: { decor: ['labcafe'], window: ['none', 'panorama'], floor: ['tiles'], plants: [1, 4] },
    crowd: [
      ['Scientist', 'coat', '#eef0f2', 'mid', 'accent'],
      ['Researcher', 'coat', 'light', 'dark', 'accent2'],
      ['Lab technician', 'coverall', 'light', 'light', 'accent'],
      ['Observer', 'suit', 'mid', 'dark', 'glow'],
      ['Pilot', 'jacket', 'accent', 'deep', 'light'],
      ['Medic', 'coat', '#bcd8e0', 'dark', '#e8f0f0'],
    ],
    dealer: ['Supply officer', 'uniform', 'mid', 'dark', 'accent', 'cap'],
    mechanic: ['Lab technician', 'coverall', 'light', 'light', 'accent'],
    bartender: ['Steward', 'uniform', 'light', 'mid', 'accent'],
    outside: { planets: ['exo-gas-giant', 'exo-rocky-cold'], planetChance: 0.75, rocks: [0, 0], rays: 0.08 },
  },
  relay: {
    name: 'relay',
    tone: 'dark',
    bright: 0.4,
    cool: 0.4,
    clutter: 0.3,
    busy: 0.2,
    walls: 'panels',
    ceiling: 'ducts',
    pillars: ['lattice'],
    bays: ['slot'],
    mouth: [16, 20],
    floor: [0.74, 0.45],
    haze: 1.2,
    dressing: ['relay-racks', 'red-beacons', 'clutter'],
    goods: 'fuel',
    bar: { decor: ['spare'], window: ['portholes'], floor: ['plates'], plants: [0, 0] },
    crowd: [
      ['Relay technician', 'coverall', 'dark', 'dark', 'accent', 'beanie'],
      ['Drifter', 'coat', '#5a4a3a', 'deep', '#8a7a5a'],
      ['Pilot', 'jacket', 'mid', 'deep', 'accent'],
      ['Hauler', 'jacket', 'accent2', 'dark', 'light'],
    ],
    dealer: ['Relay keeper', 'coverall', 'mid', 'mid', 'accent'],
    mechanic: ['Relay technician', 'coverall', 'dark', 'dark', 'accent', 'beanie'],
    bartender: ['Relay keeper', 'coverall', 'dark', 'dark', 'accent'],
    outside: { planets: ['exo-scorched', 'exo-rocky-cold'], planetChance: 0.25, rocks: [0, 0], rays: 0 },
  },
  'military-base': {
    name: 'military base',
    tone: 'mid',
    bright: 0.65,
    cool: 0.5,
    clutter: 0.35,
    busy: 0.7,
    walls: 'armour',
    ceiling: 'truss',
    pillars: ['armour'],
    bays: ['blast'],
    mouth: [23, 28],
    floor: [0.7, 0.42],
    haze: 0.9,
    dressing: ['banners', 'weapon-racks', 'ordnance', 'hazard-lanes'],
    goods: 'munitions',
    bar: { decor: ['messhall'], window: ['band'], floor: ['plates'], plants: [0, 0] },
    crowd: [
      ['Soldier', 'armour', 'uniform', 'dark', 'accent', 'helmet', 'uniform'],
      ['Officer', 'uniform', 'uniform', 'uniform', 'accent2', 'cap'],
      ['Marine', 'armour', 'mid', 'dark', 'accent', 'helmet', 'mid'],
      ['Pilot', 'jacket', 'uniform', 'deep', 'accent'],
      ['Gunner', 'coverall', 'uniform', 'uniform', 'accent2', 'beanie'],
      ['Medic', 'uniform', 'light', 'mid', '#d83a2a'],
    ],
    dealer: ['Quartermaster', 'uniform', 'uniform', 'uniform', 'accent2', 'cap'],
    mechanic: ['Armourer', 'coverall', 'dark', 'dark', 'accent', 'cap'],
    bartender: ['Mess steward', 'apron', 'light', 'uniform', 'accent'],
    outside: { planets: ['exo-rocky-cold', 'exo-rocky-warm', 'exo-gas-giant'], planetChance: 0.7, rocks: [0, 0], rays: 0 },
  },
  freeport: {
    name: 'freeport',
    tone: 'mid',
    bright: 0.6,
    cool: -0.25,
    clutter: 0.8,
    busy: 0.85,
    walls: 'patched',
    ceiling: 'truss',
    pillars: ['hex', 'round'],
    bays: ['market'],
    mouth: [23, 29],
    floor: [0.7, 0.35],
    haze: 1.1,
    dressing: ['neon', 'graffiti', 'stalls', 'lounge-furniture'],
    extras: [['pennants', 0.6]],
    goods: 'bazaar',
    bar: { decor: ['dive'], window: ['band', 'portholes'], floor: ['planks', 'plates'], plants: [1, 3] },
    crowd: [
      ['Spacer', 'jacket', 'accent', 'deep', 'glow'],
      ['Smuggler', 'coat', 'dark', 'deep', 'accent2'],
      ['Trader', 'vest', 'accent2', 'dark', 'light'],
      ['Mechanic', 'coverall', 'mid', 'mid', 'glow', 'beanie'],
      ['Drifter', 'coat', '#5a4a3a', 'deep', 'glow', 'hood', '#4a3a2e'],
      ['Musician', 'jacket', '#7a3a8a', 'deep', 'accent'],
    ],
    dealer: ['Broker', 'vest', 'dark', 'deep', 'glow'],
    mechanic: ['Fixer', 'coverall', 'mid', 'mid', 'accent', 'beanie'],
    bartender: ['Bartender', 'vest', 'deep', 'deep', 'glow'],
    outside: { planets: ['exo-gas-giant', 'exo-rocky-warm', 'exo-rocky-cold'], planetChance: 0.6, rocks: [0, 6], rays: 0 },
  },
  'pirate-den': {
    name: 'pirate den',
    tone: 'dark',
    bright: 0.35,
    cool: -0.4,
    clutter: 0.9,
    busy: 0.6,
    walls: 'scrap',
    ceiling: 'truss',
    pillars: ['scrap'],
    bays: ['scrap'],
    mouth: [19, 25],
    floor: [0.84, 0.4],
    haze: 1.35,
    dressing: ['scrap-piles', 'fire-barrels', 'wreck', 'chains', 'red-beacons'],
    goods: 'scrap',
    glowTint: ['#ff2a1a', 0.6],
    bar: { decor: ['hangout'], window: ['portholes'], floor: ['plates'], plants: [0, 0] },
    crowd: [
      ['Raider', 'harness', 'dark', 'deep', 'accent', 'bandana', 'accent'],
      ['Scavenger', 'coat', '#5a4a3a', 'deep', 'rust', 'hood', '#3a2e26'],
      ['Gunner', 'harness', 'deep', 'dark', 'accent2', 'helmet', 'dark'],
      ['Smuggler', 'jacket', 'accent2', 'deep', 'light'],
      ['Scrapper', 'coverall', 'rust', 'dark', 'accent', 'beanie'],
      ['Drifter', 'coat', 'mid', 'deep', 'accent'],
    ],
    dealer: ['Fence', 'coat', 'deep', 'deep', 'accent'],
    mechanic: ['Scrapper', 'coverall', 'rust', 'dark', 'accent', 'beanie'],
    bartender: ['Barkeep', 'vest', 'dark', 'deep', 'accent'],
    outside: { planets: ['exo-scorched', 'exo-rocky-cold', 'exo-gas-giant'], planetChance: 0.45, rocks: [14, 24], rays: 0.03 },
  },
};

const EMBLEMS: Record<StationOwner, Emblem> = {
  sta: 'ring',
  frontier: 'chevron',
  'hollow-wake': 'wake',
  independent: 'star',
};

const OWNER_NAMES: Record<StationOwner, string> = {
  sta: 'Transit Authority',
  frontier: 'Frontier',
  'hollow-wake': 'Hollow Wake',
  independent: 'Independent',
};

/* ------------------------------------------------------------------------------------------------
 * Generator.
 * ---------------------------------------------------------------------------------------------- */

function hash(...parts: number[]): number {
  let h = 0x811c9dc5;
  for (const p of parts) {
    h ^= p | 0;
    h = Math.imul(h, 0x01000193);
    h ^= h >>> 13;
  }
  return h >>> 0;
}

/** Direction with a little seeded wobble, normalised. */
function dir(x: [number, number], y: [number, number], z: number, rand: () => number): V3 {
  const v: V3 = [lerp(x[0], x[1], rand()), lerp(y[0], y[1], rand()), z];
  const n = Math.hypot(...v);
  return [v[0] / n, v[1] / n, v[2] / n];
}

export function generateInteriorStyle(look: StationLook): InteriorStyle {
  const t = TYPES[look.type];
  const size = clamp01(look.size);
  const wear = clamp01(look.wear);
  const seed = Math.floor(Number.isFinite(look.seed) ? look.seed : 0);
  const typeIndex = STATION_TYPES.indexOf(look.type);
  const ownerIndex = STATION_OWNERS.indexOf(look.owner);
  // Separate streams: the same station type and seed keep their architecture whoever owns them,
  // and the owner's palette drifts on its own.
  const rs = seededRandom(hash(seed, typeIndex, 0x5eed));
  const rp = seededRandom(hash(seed, ownerIndex, 0xc01));
  const rc = seededRandom(hash(seed, typeIndex, ownerIndex, 0xc40d));
  const pick = <T>(list: readonly T[], rand: () => number): T => list[Math.floor(rand() * list.length) % list.length]!;
  const p = ownerPalette(look.owner, rp);

  // Run-down stations are dimmer, greyer and browner.
  const worn = (hex: string, k = 1): string => mix(adjust(hex, 0, 1 - 0.3 * wear * k, 1 - 0.14 * wear * k), '#3a2e22', 0.12 * wear * k);
  const tone = { light: p.light, mid: p.mid, dark: p.dark }[t.tone];
  const glowBase = t.glowTint ? mix(p.glow, t.glowTint[0], t.glowTint[1]) : p.glow;
  // Lamps: the owner's lamp, pushed warm or cool by the type (refinery furnace glow, clinical labs).
  const lampTint = t.cool >= 0 ? mix(p.lamp, '#e8f0ff', t.cool * 0.5) : mix(p.lamp, '#ffb070', -t.cool * 0.45);
  const dim = 1 - 0.28 * wear;
  const bright = t.bright;
  // How much star light the bay lets in (the bar's window takes a share of it).
  const spill = lerp(1.2, 3, bright) * (1 - 0.2 * wear);

  // Rock-cut halls show the body they are dug into: grey basalt, brown regolith, rusty iron rock.
  const rock = t.walls === 'rock' ? mix(pick(['#6e655c', '#7a6a58', '#5c5854', '#7a5e4c', '#66625e'], rs), p.mid, 0.15) : null;
  const wall = worn(rock ?? (t.walls === 'clean' ? mix(p.light, '#f4f6f8', 0.55) : tone));
  const floorBase = t.tone === 'light' ? adjust(p.light, 0, 0.9, 0.88) : t.tone === 'mid' ? mix(p.mid, p.light, 0.25) : scale(p.mid, 0.95);
  const floor = worn(t.walls === 'clean' ? mix(floorBase, '#e8ecf0', 0.5) : floorBase, 1.3);
  const clutter = clamp01(t.clutter + wear * 0.3 + (size - 0.5) * 0.2);
  const workers = Math.max(1, Math.min(5, Math.round(1 + 4 * size * (0.35 + 0.65 * t.busy))));
  const mouthW = Math.round(lerp(t.mouth[0], t.mouth[1], size) + (rs() - 0.5) * 2);
  const mouthH = Math.round(Math.min(17, Math.max(11, mouthW * 0.56 + 1)));
  const flicker = clamp01((wear - 0.3) * 1.3 + (look.type === 'pirate-den' || look.type === 'relay' ? 0.15 : 0));

  // Every station wears its owner's colours on the walls and over the bay.
  const dressing: DressingKind[] = ['livery', ...t.dressing];
  for (const [d, chance] of t.extras ?? []) if (rs() < chance) dressing.push(d);
  if (clutter > 0.6 && !dressing.includes('clutter')) dressing.push('clutter');

  const glow = worn(glowBase, 0.5);
  const hazard: [string, string] = [worn(p.hazard[0], 0.6), p.hazard[1]];
  const hangar: HangarLook = {
    floor,
    floorAlt: scale(floor, 0.9),
    floorRough: t.floor[0],
    floorMetal: t.floor[1],
    wall,
    wallDark: rock ? scale(rock, 0.42) : worn(t.tone === 'light' ? p.mid : p.dark),
    trim: worn(t.tone === 'dark' ? p.deep : p.dark),
    metal: worn(mix(p.mid, '#9aa0a8', 0.45)),
    pillar: worn(t.pillars[0] === 'slab' ? mix(tone, '#ffffff', 0.25) : tone),
    accent: worn(p.accent, 0.6),
    marking: worn(p.marking, 0.8),
    marking2: worn(p.accent, 0.5),
    hazard,
    machine: worn(p.machine, 0.7),
    lamp: lampTint,
    lampLevel: lerp(1.5, 2.6, bright) * dim,
    glow,
    glowLevel: lerp(1.5, 2.3, bright) * (1 - 0.2 * wear),
    hemiSky: mix(lampTint, p.mid, 0.4),
    hemiGround: p.deep,
    hemi: lerp(0.16, 0.4, bright) * dim,
    key: { color: mix(lampTint, '#ffffff', 0.3), intensity: lerp(40, 62, bright) * dim },
    fillTrader: { color: mix(lampTint, glow, 0.45), intensity: lerp(16, 36, bright) * dim },
    fillOutfitter: { color: mix(lampTint, p.accent, 0.3), intensity: lerp(14, 30, bright) * dim },
    fog: mix(p.deep, glow, 0.08),
    fogDensity: lerp(0.0055, 0.0085, 1 - bright) * t.haze * (1 + 0.3 * wear),
    pillarKind: pick(t.pillars, rs),
    bayKind: look.owner === 'independent' && look.type === 'trade-port' ? 'market' : pick(t.bays, rs),
    mouth: [mouthW, mouthH],
    clutter,
    holo: t.glowTint && look.type !== 'pirate-den' ? mix(p.holo, glowBase, 0.3) : p.holo,
    padGlow: mix(glow, '#ffffff', 0.35),
    workers,
    containers: p.containers.map((c) => worn(c, 0.8)),
    // Farms grow food along the trader's wall and refineries keep tanks there instead.
    wallStack: t.goods !== 'crops' && look.type !== 'refinery',
    heavyCrane: t.goods === 'hull' || t.goods === 'machinery' || (t.goods === 'commodities' && size > 0.6),
    sparseLamps: bright < 0.45,
    drones: look.type === 'relay' || look.type === 'pirate-den' ? 0 : size > 0.75 ? 4 : size > 0.45 ? 3 : 2,
    walls: t.walls,
    ceiling: t.ceiling,
    goods: t.goods,
    dressing,
    signs: p.signs.map((c) => worn(c, 0.4)),
    emblem: EMBLEMS[look.owner],
    grime: wear,
    flicker,
  };

  // The bar.
  const decor = pick(t.bar.decor, rs);
  const barBright = decor === 'cafe' || decor === 'labcafe' ? 1 : decor === 'dive' || decor === 'hangout' || decor === 'spare' ? 0.35 : 0.7;
  const barLamp = decor === 'labcafe' ? '#f0f6ff' : decor === 'hangout' ? '#ff9a5a' : mix(p.lamp, '#ffc47a', decor === 'cafe' ? 0.35 : 0.6);
  const barWall =
    decor === 'labcafe' || decor === 'cafe'
      ? worn(mix(p.light, '#f2f4f6', decor === 'labcafe' ? 0.6 : 0.2))
      : decor === 'dive' || decor === 'hangout'
        ? worn(p.dark)
        : worn(mix(p.mid, p.dark, 0.4));
  const bar: BarLook = {
    // Pale floors catch the window's light: keep the cafés' a shade darker than their walls.
    floor: worn(decor === 'labcafe' ? '#a9b0ba' : decor === 'cafe' ? mix(p.mid, p.light, 0.22) : decor === 'hangout' ? p.dark : mix(p.mid, p.dark, 0.5)),
    floorPattern: pick(t.bar.floor, rs),
    wall: barWall,
    wallTrim: worn(decor === 'labcafe' ? p.accent : p.accent2, 0.6),
    counter: worn(decor === 'labcafe' ? '#f4f6f9' : decor === 'cafe' ? p.light : p.dark),
    counterTop: decor === 'hangout' ? worn('#5a4a3e') : worn(mix(p.mid, '#c8c8c8', 0.5)),
    seat: worn(decor === 'dive' ? p.accent : p.accent2 === p.accent ? p.dark : mix(p.accent, p.dark, 0.35)),
    table: worn(decor === 'labcafe' || decor === 'cafe' ? '#eef0f2' : mix(p.mid, p.light, 0.3)),
    lamp: barLamp,
    accent: worn(decor === 'hangout' ? mix(p.glow, '#ff2a1a', 0.6) : glow, 0.4),
    bottles: p.bottles,
    hemiSky: mix(barLamp, p.mid, 0.35),
    hemiGround: p.deep,
    hemi: lerp(0.3, 0.85, barBright) * dim,
    key: { color: barLamp, intensity: (barBright > 0.9 ? 12.5 : lerp(11, 16, barBright)) * dim },
    fillA: { color: mix(barLamp, glow, 0.6), intensity: lerp(6, 10, barBright) * dim },
    fillB: { color: mix(barLamp, p.accent2, 0.3), intensity: lerp(5, 9, barBright) * dim },
    fog: mix(p.deep, barLamp, 0.08),
    fogDensity: lerp(0.03, 0.012, barBright) * (1 + 0.25 * wear),
    window: pick(t.bar.window, rs),
    // Pale and polished floors flare under a strong window spill: cap what reaches them.
    spill: Math.min(0.3, (decor === 'cafe' || decor === 'labcafe' ? 0.26 : barBright > 0.5 ? 0.3 : 0.5) / spill),
    plants: Math.round(lerp(t.bar.plants[0], t.bar.plants[1], rs())),
    patrons: Math.max(2, Math.min(8, Math.round(lerp(2, 8, size * (0.4 + 0.6 * t.busy)) + (rs() - 0.5) * 1.5))),
    bartender: role(t.bartender, p),
    decor,
  };

  // Outside the bay.
  const star = rgb(look.starColor);
  const redness = clamp01((star[0] - star[2]) * 1.6);
  const blueness = clamp01((star[2] - star[0]) * 3);
  const hasPlanet = rs() < t.outside.planetChance;
  const outside: OutsideLook = {
    starDir: dir([-0.12, 0.07], [-0.12, 0.02], -1, rs),
    spillDir: dir([0.17, 0.34], [-0.05, 0.12], -0.96, rs),
    starSize: lerp(46, 110, redness) + rs() * 18 + blueness * 60,
    starIntensity: lerp(1.1, 1.5, rs()) + blueness * 1.2,
    rocks: Math.round(lerp(t.outside.rocks[0], t.outside.rocks[1], rs())),
    spillTint: mix(lampTint, glow, 0.25),
    spillMix: 0.3,
    spill,
    rays: t.outside.rays,
  };
  if (hasPlanet) {
    const style = pick(t.outside.planets, rs);
    const giant = style === 'exo-gas-giant';
    outside.planet = {
      style,
      radius: giant ? lerp(2800, 3600, rs()) : lerp(1500, 2400, rs()),
      distance: giant ? lerp(12000, 15000, rs()) : lerp(7800, 9500, rs()),
      dir: [lerp(-0.52, -0.4, rs()), lerp(-0.22, -0.15, rs()), -1],
      tilt: lerp(0, 0.45, rs()),
      seed: 1 + Math.floor(rs() * 97),
      frontLight: lerp(0.8, 1.4, rs()),
    };
  }

  // The crowd: the type's roles in the owner's colours, in a seeded order.
  const crowd = shuffle(t.crowd, rc).map((r) => role(r, p));

  return {
    kind: look.type,
    name: `${OWNER_NAMES[look.owner]} ${t.name}`,
    hangar,
    bar,
    crowd,
    dealer: role(t.dealer, p),
    mechanic: role(t.mechanic, p),
    skin: SKIN,
    hair: HAIR,
    outside,
  };
}

function role(r: Role, p: Palette): Outfit {
  const [label, kind, top, bottom, accent, hat, hatColor] = r;
  const c = (s: Slot | `#${string}`): string => (s.startsWith('#') ? s : p[s as Slot]);
  const o: Outfit = { label, kind, top: c(top), bottom: c(bottom), accent: c(accent) };
  if (hat) o.hat = hat;
  if (hatColor) o.hatColor = c(hatColor);
  return o;
}
