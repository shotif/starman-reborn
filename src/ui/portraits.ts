import { hashString, rng, type Rng } from '../content/random.ts';
import type { CharacterId } from '../content/story/types.ts';
import { h } from './dom.ts';

/**
 * Procedural portraits for the people met face to face in the station bars (docs/ROADMAP.md,
 * increment 7): the story characters and the generated regulars. A portrait is a small inline SVG
 * (viewBox 0 0 96 96, a few KB), head and shoulders, flat-shaded in the interface's colours: a
 * navy-glass vignette tinted by faction, light from the upper left and a thin rim of the
 * faction's accent on the right.
 *
 * It is a pure function of a seed and a look. The look dresses the person (faction: clothes,
 * palette and insignia; role: headset, goggles or visor, collar tabs, data slate or hood; age),
 * and the seed decides who they are: skin, face, hair, eyes, marks and trinkets. Every trait
 * draws from its own stream, rng(seed, 'portrait', key), so tuning one never reshuffles another.
 */

export type PortraitFaction = 'sta' | 'frontier' | 'hollow-wake' | 'independent';
export type PortraitRole = 'trader' | 'pilot' | 'fixer' | 'officer' | 'miner' | 'scientist' | 'colonist';
export type PortraitAge = 'young' | 'middle' | 'old';

export interface PortraitLook {
  faction: PortraitFaction;
  role: PortraitRole;
  /** Left out, the seed decides. */
  age?: PortraitAge;
}

export const PORTRAIT_FACTIONS: readonly PortraitFaction[] = ['sta', 'frontier', 'hollow-wake', 'independent'];
export const PORTRAIT_ROLES: readonly PortraitRole[] = ['trader', 'pilot', 'fixer', 'officer', 'miner', 'scientist', 'colonist'];
export const PORTRAIT_AGES: readonly PortraitAge[] = ['young', 'middle', 'old'];

/**
 * The story characters (src/content/story/arcs.ts). The seeds were picked by eye to fit each
 * one (tests/unit/portraits.test.ts pins the traits that make them who they are), and sit above
 * 1000 so small seeds given to regulars never repeat a story face.
 */
export const STORY_PORTRAITS: Readonly<Record<CharacterId, { seed: number; look: PortraitLook }>> = {
  // Internal audit: a dark ponytail, square glasses, the Authority's uniform and collar tabs.
  castell: { seed: 1915, look: { faction: 'sta', role: 'officer', age: 'middle' } },
  // The Kettering Line's pilot: dyed red hair swept back, a comm headset, a flight jacket.
  kettering: { seed: 1027, look: { faction: 'independent', role: 'pilot', age: 'middle' } },
  // The Cooperative's relief coordinator: a headscarf in Frontier green, supply lists on a slate.
  quist: { seed: 1005, look: { faction: 'frontier', role: 'trader', age: 'middle' } },
  // Foreman of the Gardens: a knitted cap, braces over a work shirt.
  brandt: { seed: 1097, look: { faction: 'frontier', role: 'colonist', age: 'middle' } },
  // The Institute's botanist: greying curls, glasses, a lab coat and a slate of readings.
  ansari: { seed: 2636, look: { faction: 'frontier', role: 'scientist', age: 'middle' } },
  // Captain of the Nest crews: a grey crop, a scar and a cybernetic eye.
  salt: { seed: 1020, look: { faction: 'hollow-wake', role: 'officer', age: 'old' } },
  // Keeper of Squall Relay: long silver hair, a comm headset always on, a navy jacket.
  halloway: { seed: 3008, look: { faction: 'independent', role: 'pilot', age: 'old' } },
  // Steward of Harrow Farmstead: grey curls and a work shirt.
  fenwick: { seed: 3016, look: { faction: 'independent', role: 'colonist', age: 'old' } },
};

/* ---------------------------------------------------------------------------------------------- */
/* Traits: everything decided about one person before anything is drawn.                           */
/* ---------------------------------------------------------------------------------------------- */

export type HairStyle =
  | 'crop'
  | 'buzz'
  | 'side'
  | 'fringe'
  | 'slick'
  | 'undercut'
  | 'mohawk'
  | 'coily'
  | 'afro'
  | 'locs'
  | 'long'
  | 'bob'
  | 'bun'
  | 'ponytail'
  | 'bald'
  | 'receding';
export type Beard = 'stubble' | 'moustache' | 'goatee' | 'short' | 'full' | 'chinstrap';
export type Garment = 'tunic' | 'jacket' | 'coat' | 'flight' | 'lab' | 'hoodie' | 'coverall' | 'shirt' | 'sweater';
export type Headwear = 'headset' | 'goggles' | 'visor' | 'hood' | 'scarf' | 'beanie';
type Emblem = 'ring' | 'chevron' | 'wake' | 'star';

interface Cloth {
  base: string;
  /** Piping, stripes and stitching. */
  trim: string;
  /** What shows under a jacket or coat. */
  under: string;
  /** Buckles, tabs and badges. */
  metal: string;
}

/**
 * Everything about one portrait (see portraitTraits). Lengths are viewBox units before the
 * figure is scaled into the frame; x = 48 is the middle of the face.
 */
export interface PortraitTraits {
  faction: PortraitFaction;
  role: PortraitRole;
  age: PortraitAge;
  /** 0 = strong, angular features … 1 = soft, rounded ones. */
  soft: number;
  // Head: skull top, eye line, chin; half-widths at the cheekbones, jaw corner and chin.
  top: number;
  eye: number;
  chin: number;
  hw: number;
  jw: number;
  cw: number;
  jawY: number;
  neck: number;
  shoulders: number;
  // Features.
  eyeGap: number;
  eyeW: number;
  eyeH: number;
  eyeTilt: number;
  crease: boolean;
  lashes: boolean;
  browY: number;
  browW: number;
  browArch: number;
  browTilt: number;
  noseY: number;
  noseW: number;
  mouthY: number;
  mouthW: number;
  lipTop: number;
  lipLow: number;
  smile: number;
  smirk: number;
  // Colours.
  skin: string;
  iris: string;
  hair: string;
  /** Brows and beard: the natural colour under any dye. */
  brow: string;
  // Hair.
  style: HairStyle;
  volume: number;
  hairline: number;
  part: -1 | 1;
  beard: Beard | null;
  // Marks and trinkets.
  freckles: boolean;
  blush: number;
  scar: 'brow' | 'cheek' | 'lip' | null;
  mole: readonly [number, number] | null;
  tattoo: boolean;
  smudge: boolean;
  earring: 'stud' | 'hoop' | 'rings' | null;
  glasses: 'round' | 'square' | null;
  implant: 'eye' | 'temple' | 'jaw' | null;
  eyepatch: boolean;
  wrinkles: number;
  // Clothes and kit.
  garment: Garment;
  cloth: Cloth;
  headwear: Headwear | null;
  lens: string;
  slate: boolean;
  tabs: boolean;
  patches: number;
  emblem: Emblem | null;
}

/** Skin tones from very fair to very deep, and two olive tones. */
const SKINS = ['#f7dfcc', '#f0cbab', '#e5b692', '#d8a47c', '#c99068', '#b87d54', '#a56a45', '#8c5738', '#74452c', '#5d3623', '#482a1c', '#d3ab80', '#b28b5f'];

const HAIR = {
  black: '#1e1917',
  darkBrown: '#36261c',
  brown: '#5a3d28',
  lightBrown: '#835b3b',
  auburn: '#7d3624',
  copper: '#b0602f',
  darkBlonde: '#a8854f',
  blonde: '#d6b77e',
  platinum: '#e7dcc3',
  saltPepper: '#716d69',
  grey: '#a2a09c',
  silver: '#c8cacb',
  white: '#e8e6e1',
} as const;

/** Dyes some independents and raiders wear. */
const DYES = ['#2fa7a2', '#c2509e', '#4272d8', '#b8303f', '#8255cc', '#e9e4da'];

const IRIS = { darkBrown: '#3a2417', brown: '#5b3a22', hazel: '#7b6a33', green: '#4f7d4c', blue: '#4b7cad', grey: '#7b8b97', amber: '#a8762c' } as const;

/** Background vignette per faction: centre glow, middle, edge. */
const VIGNETTE: Record<PortraitFaction, readonly [string, string, string]> = {
  sta: ['#2c5790', '#152a4d', '#070e1d'],
  frontier: ['#33644f', '#17342b', '#07120e'],
  'hollow-wake': ['#6c3322', '#311710', '#110806'],
  independent: ['#4c386b', '#251b39', '#0b0814'],
};

/** Rim light on the shadow side, in the interface's accents. */
const RIM: Record<PortraitFaction, string> = {
  sta: '#5cc8ff',
  frontier: '#6fe0b4',
  'hollow-wake': '#ffb45c',
  independent: '#c9a2ff',
};

const EMBLEMS: Record<PortraitFaction, Emblem> = { sta: 'ring', frontier: 'chevron', 'hollow-wake': 'wake', independent: 'star' };

const FACTION_NAMES: Record<PortraitFaction, string> = {
  sta: 'Transit Authority',
  frontier: 'Frontier Cooperative',
  'hollow-wake': 'Hollow Wake',
  independent: 'independent',
};

/** Picks by weight. */
function weighted<T>(r: Rng, options: readonly (readonly [T, number])[]): T {
  const total = options.reduce((sum, [, w]) => sum + Math.max(0, w), 0);
  let x = r.next() * total;
  for (const [item, w] of options) {
    x -= Math.max(0, w);
    if (x < 0) return item;
  }
  return options[options.length - 1]![0];
}

/** Perceived lightness of a colour, 0..1. */
function lightness(hex: string): number {
  const v = parseInt(hex.slice(1), 16);
  return (0.299 * ((v >> 16) & 255) + 0.587 * ((v >> 8) & 255) + 0.114 * (v & 255)) / 255;
}

/** Linear mix of two #rrggbb colours. */
function mix(a: string, b: string, t: number): string {
  const x = parseInt(a.slice(1), 16);
  const y = parseInt(b.slice(1), 16);
  const ch = (shift: number): number => {
    const p = (x >> shift) & 255;
    return Math.round(p + (((y >> shift) & 255) - p) * t);
  };
  return `#${((1 << 24) | (ch(16) << 16) | (ch(8) << 8) | ch(0)).toString(16).slice(1)}`;
}

/** The clothes palette for a faction: uniform navy, earthy work cloth, dark leather, or anything. */
function clothFor(faction: PortraitFaction, r: Rng): Cloth {
  switch (faction) {
    case 'sta':
      return { base: r.pick(['#1d2d4e', '#22365c', '#1a2845']), trim: '#5cc8ff', under: r.pick(['#d9e0ea', '#c5cfdc']), metal: r.pick(['#e3b62e', '#cdd9e8']) };
    case 'frontier':
      return {
        base: r.pick(['#5b6142', '#7b7352', '#6b4f35', '#4e5a3d', '#8a7957', '#5e4a3a']),
        trim: r.pick(['#5fb870', '#46a88a']),
        under: r.pick(['#e2d8bd', '#c9b98e', '#d8c7a2', '#9fb08a']),
        metal: '#c9a95e',
      };
    case 'hollow-wake':
      return {
        base: r.pick(['#302622', '#3c2c24', '#282221', '#46352b']),
        trim: r.pick(['#a8522a', '#b8431f', '#8f4a2a']),
        under: r.pick(['#1b1613', '#4b3b31', '#5e2a1f', '#6e6358']),
        metal: r.pick(['#e59a12', '#b3a894']),
      };
    case 'independent':
      return {
        base: r.pick(['#3b5b69', '#6b3b4d', '#4b4b5d', '#7a6233', '#2d3e5d', '#59416d', '#3d4d3d', '#8a4b33']),
        trim: r.pick(['#ff6fae', '#5cc8ff', '#ffd84a', '#62e39a', '#b98cff', '#ff8a4a']),
        under: r.pick(['#d9d8d0', '#2b2b31', '#c8b8a0', '#9aa7b3']),
        metal: '#c9ccd2',
      };
  }
}

/** The garment a role wears in a faction. */
function garmentFor(look: PortraitLook, r: Rng): Garment {
  const wake = look.faction === 'hollow-wake';
  switch (look.role) {
    case 'officer':
      return wake ? 'coat' : look.faction === 'sta' ? 'tunic' : r.next() < 0.5 ? 'tunic' : 'jacket';
    case 'pilot':
      return weighted(r, [['flight', 6], [wake ? 'coat' : 'jacket', 4]]);
    case 'trader':
      return weighted(r, [['jacket', wake ? 2 : 6], ['coat', wake ? 6 : 2], ['sweater', 2]]);
    case 'scientist':
      return weighted(r, [['lab', 7], ['sweater', 3]]);
    case 'fixer':
      return 'hoodie';
    case 'miner':
      return 'coverall';
    case 'colonist':
      return weighted(r, [['shirt', 6], ['sweater', 3], [wake ? 'coat' : 'jacket', 1]]);
  }
}

type FaceShape = { hw: number; jw: number; cw: number; jaw: number; chin: number };
const FACE_SHAPES: readonly (readonly [FaceShape, number])[] = [
  [{ hw: 17.6, jw: 13.4, cw: 4.4, jaw: 9, chin: 65.2 }, 5], // oval
  [{ hw: 18.4, jw: 15.4, cw: 5.8, jaw: 7.6, chin: 64.2 }, 3], // round
  [{ hw: 17.8, jw: 16.2, cw: 6.8, jaw: 7.2, chin: 65.4 }, 3], // square
  [{ hw: 16.8, jw: 13.2, cw: 4.8, jaw: 10, chin: 66.8 }, 2], // long
  [{ hw: 18.2, jw: 12.4, cw: 3.4, jaw: 10, chin: 65.4 }, 2], // heart
  [{ hw: 18.8, jw: 15.2, cw: 5.2, jaw: 8.4, chin: 66 }, 2], // broad
];

/** Hairstyles, weighted by softness, age and hair texture. */
function hairStyleFor(r: Rng, soft: number, age: PortraitAge, curl: number, look: PortraitLook): HairStyle {
  const s = soft > 0.5;
  const old = age === 'old';
  const edgy = look.faction === 'hollow-wake' || look.faction === 'independent';
  const kinky = 0.5 + curl * 1.8;
  return weighted<HairStyle>(r, [
    ['crop', s ? 5 : 20],
    ['buzz', s ? 2 : 10],
    ['side', s ? 8 : 13],
    ['fringe', s ? 9 : 3],
    ['slick', s ? 2 : old ? 9 : 6],
    ['undercut', (s ? 3 : 7) * (old ? 0.3 : 1)],
    ['mohawk', (edgy ? 3 : 0.4) * (old ? 0.2 : 1)],
    ['coily', (s ? 5 : 8) * kinky],
    ['afro', (s ? 7 : 4) * kinky * (old ? 0.6 : 1)],
    ['locs', (s ? 6 : 4) * kinky],
    ['long', (s ? 18 : 3) * (old ? 0.6 : 1) * (1.4 - curl * 0.5)],
    ['bob', s ? 12 : 1],
    ['bun', s ? (old ? 16 : 10) : 2],
    ['ponytail', s ? 9 : 3],
    ['bald', s ? 0 : old ? 12 : 3],
    ['receding', s ? 0 : old ? 14 : 2],
  ]);
}

/** Decides everything about a portrait from its seed and look. */
export function portraitTraits(seed: number, look: PortraitLook): PortraitTraits {
  const stream = (key: string, ...more: string[]): Rng => rng(seed, 'portrait', key, ...more);
  const age = look.age ?? weighted(stream('age'), [['young', 35], ['middle', 45], ['old', 20]] as const);
  const old = age === 'old';
  const wake = look.faction === 'hollow-wake';

  // Build: soft or strong features, face shape, proportions.
  const b = stream('build');
  const pole = b.next();
  const soft = pole < 0.46 ? b.range(0.64, 1) : pole < 0.92 ? b.range(0, 0.36) : b.range(0.36, 0.64);
  const face = weighted(b, FACE_SHAPES);
  const hw = face.hw + b.range(-0.6, 0.6) - soft * 0.4;
  const chin = face.chin + b.range(-0.8, 0.8) + (old ? 0.5 : 0);
  const jw = face.jw + b.range(-0.8, 0.8) - soft * 1.4 + (old ? 0.5 : 0);
  const cw = Math.max(2.4, face.cw + b.range(-0.6, 0.6) - soft * 0.9);
  const top = b.range(17.6, 19.6);
  const eye = b.range(41.8, 43);
  const neck = b.range(8, 9.2) + (1 - soft) * 1.6;
  const shoulders = b.range(33, 36) + (1 - soft) * 3.5;

  // Skin, eyes, freckles.
  const sk = stream('skin');
  const skin = sk.pick(SKINS);
  const depth = 1 - lightness(skin);
  const iris =
    depth > 0.45
      ? weighted(sk, [[IRIS.darkBrown, 60], [IRIS.brown, 30], [IRIS.hazel, 7], [IRIS.amber, 3]])
      : depth > 0.3
        ? weighted(sk, [[IRIS.darkBrown, 35], [IRIS.brown, 30], [IRIS.hazel, 14], [IRIS.green, 8], [IRIS.amber, 6], [IRIS.grey, 7]])
        : weighted(sk, [[IRIS.darkBrown, 14], [IRIS.brown, 20], [IRIS.hazel, 16], [IRIS.green, 15], [IRIS.blue, 22], [IRIS.grey, 13]]);
  const freckles = sk.next() < (depth < 0.3 ? 0.24 : depth < 0.45 ? 0.1 : 0.05);
  const blush = (depth < 0.3 ? 0.12 : depth < 0.45 ? 0.09 : 0.06) * (0.3 + soft * 0.7) * sk.range(0.5, 1);

  // Features.
  const fe = stream('features');
  const eyeW = fe.range(5.9, 6.8);
  const eyeH = fe.range(2.5, 3.1) + soft * 0.25 - (old ? 0.2 : 0);
  const eyeGap = eyeW / 2 + fe.range(3.4, 4.2) + (hw - 17.6) * 0.3;
  const eyeTilt = fe.range(-0.3, 0.9);
  const crease = fe.next() < 0.72;
  const lashes = soft > 0.55 && fe.next() < 0.85;
  const browY = fe.range(4.6, 5.6) - (old ? 0.3 : 0);
  const browW = 1.1 + (1 - soft) * 0.8 + fe.range(0, 0.45);
  const browArch = fe.range(0.4, 1.4) + soft * 0.5;
  const browTilt = fe.range(-0.5, 0.6) + (wake || look.role === 'officer' ? 0.35 : 0);
  const noseY = eye + fe.range(9.8, 11.2);
  const noseW = fe.range(3.4, 4.6) + depth * 0.7 - soft * 0.2;
  const mouthY = noseY + fe.range(5.2, 6.2);
  const mouthW = fe.range(4.6, 5.8);
  const lipTop = (fe.range(0.75, 1.15) + soft * 0.25) * (old ? 0.8 : 1);
  const lipLow = (fe.range(0.85, 1.3) + soft * 0.35) * (old ? 0.8 : 1);
  const friendly = look.role === 'colonist' || look.role === 'trader' ? 2 : 1;
  const stern = wake || look.role === 'officer' ? 2 : 1;
  const smile = weighted(fe, [[0, 4 * stern], [0.5, 4], [1.1, 2 * friendly], [-0.4, 1.5 * stern]] as const);
  const smirk = fe.next() < 0.18 ? (fe.next() < 0.5 ? -0.8 : 0.8) : 0;

  // Hair: natural colour by skin (loosely), greys with age, dyes for some; style and volume.
  const ha = stream('hair');
  const natural =
    depth > 0.5
      ? weighted(ha, [[HAIR.black, 62], [HAIR.darkBrown, 34], [HAIR.brown, 4]])
      : depth > 0.33
        ? weighted(ha, [[HAIR.black, 32], [HAIR.darkBrown, 34], [HAIR.brown, 18], [HAIR.lightBrown, 8], [HAIR.auburn, 5], [HAIR.copper, 3]])
        : weighted(ha, [
            [HAIR.black, 12],
            [HAIR.darkBrown, 20],
            [HAIR.brown, 18],
            [HAIR.lightBrown, 12],
            [HAIR.auburn, 8],
            [HAIR.copper, 9],
            [HAIR.darkBlonde, 10],
            [HAIR.blonde, 8],
            [HAIR.platinum, 3],
          ]);
  const grey = old
    ? weighted(ha, [[HAIR.saltPepper, 25], [HAIR.grey, 30], [HAIR.silver, 25], [HAIR.white, 20]])
    : age === 'middle' && ha.next() < 0.22
      ? mix(natural, HAIR.grey, 0.45)
      : natural;
  const dyeChance = old ? 0 : look.faction === 'independent' ? 0.18 : wake ? 0.12 : 0.03;
  const hair = ha.next() < dyeChance ? ha.pick(DYES) : grey;
  const curl = depth > 0.5 ? ha.range(0.5, 1) : depth > 0.33 ? ha.range(0.1, 0.8) : ha.range(0, 0.5);
  let style = hairStyleFor(ha, soft, age, curl, look);
  const volume = ha.range(1.8, 3.6);
  const hairline = top + ha.range(5.8, 7.4) + (old ? 1.2 : 0);
  const part: -1 | 1 = ha.next() < 0.5 ? -1 : 1;

  // Facial hair.
  const be = stream('beard');
  const beardChance = soft < 0.4 ? (age === 'young' ? 0.34 : 0.56) * (look.faction === 'sta' ? 0.7 : wake ? 1.3 : 1) : 0;
  const beard =
    be.next() < beardChance
      ? weighted<Beard>(be, [
          ['stubble', 30],
          ['short', 24],
          ['full', look.faction === 'sta' ? 4 : 14],
          ['goatee', 12],
          ['moustache', 10],
          ['chinstrap', 7],
        ])
      : null;

  // Marks and trinkets.
  const ma = stream('marks');
  const scar = ma.next() < (wake ? 0.5 : look.role === 'fixer' ? 0.25 : look.role === 'miner' ? 0.15 : 0.06) ? ma.pick(['brow', 'cheek', 'lip'] as const) : null;
  const mole = ma.next() < 0.12 ? ([48 + ma.pick([-1, 1]) * ma.range(5, 11), eye + ma.range(6, 18)] as const) : null;
  const tattoo = ma.next() < (wake ? 0.28 : look.faction === 'independent' ? 0.12 : 0.02) + (look.role === 'fixer' ? 0.1 : 0);
  const smudge = look.role === 'miner' && ma.next() < 0.5;
  const earring = ma.next() < (wake ? 0.55 : soft > 0.5 ? 0.45 : 0.2) ? (wake ? ma.pick(['stud', 'hoop', 'rings'] as const) : ma.pick(['stud', 'stud', 'hoop'] as const)) : null;
  const glassesChance = look.role === 'scientist' ? 0.45 : look.role === 'trader' ? 0.18 : look.role === 'officer' ? 0.12 : look.role === 'miner' ? 0 : 0.06;
  const glassesRoll = ma.next();
  const implantChance = wake ? 0.2 : look.faction === 'independent' ? 0.16 : look.faction === 'sta' ? 0.07 : 0.09;
  const implant = ma.next() < implantChance ? ma.pick(['eye', 'temple', 'jaw'] as const) : null;
  const eyepatch = wake && implant !== 'eye' && ma.next() < 0.07;
  const glasses = glassesRoll < glassesChance && !eyepatch && implant !== 'eye' ? ma.pick(['round', 'square'] as const) : null;
  const wrinkles = old ? ma.range(0.7, 1) : age === 'middle' ? ma.range(0.15, 0.45) : 0;

  // Clothes and kit.
  const cl = stream('clothes', look.faction, look.role);
  const garment = garmentFor(look, cl);
  const cloth = clothFor(look.faction, cl);
  const headwear: Headwear | null =
    look.role === 'pilot'
      ? 'headset'
      : look.role === 'miner'
        ? weighted(cl, [['goggles', 6], ['visor', 4]] as const)
        : look.role === 'fixer'
          ? 'hood'
          : look.role === 'colonist' && cl.next() < 0.1
            ? 'beanie'
            : (look.role === 'colonist' || look.role === 'trader' || look.role === 'scientist') && soft > 0.5 && cl.next() < 0.08
              ? 'scarf'
              : null;
  // Hair that would stand out of a knitted cap is worn down under it.
  if (headwear === 'beanie' && (style === 'mohawk' || style === 'afro' || style === 'bun')) style = soft > 0.5 ? 'long' : 'crop';
  const lens = cl.pick(['#ffb347', '#5cc8ff', '#7ee0a0', '#ff7a5c']);
  const patches = wake ? cl.int(1, 2) : look.role === 'miner' ? cl.int(0, 1) : 0;
  const emblem = look.faction === 'independent' && cl.next() < 0.5 ? null : EMBLEMS[look.faction];

  return {
    faction: look.faction,
    role: look.role,
    age,
    soft,
    top,
    eye,
    chin,
    hw,
    jw,
    cw,
    jawY: chin - face.jaw,
    neck,
    shoulders,
    eyeGap,
    eyeW,
    eyeH,
    eyeTilt,
    crease,
    lashes,
    browY,
    browW,
    browArch,
    browTilt,
    noseY,
    noseW,
    mouthY,
    mouthW,
    lipTop,
    lipLow,
    smile,
    smirk,
    skin,
    iris,
    hair,
    brow: mix(grey, '#000000', lightness(grey) > 0.6 ? 0.25 : 0.12),
    style,
    volume,
    hairline,
    part,
    beard,
    freckles,
    blush,
    scar,
    mole,
    tattoo,
    smudge,
    earring,
    glasses,
    implant,
    eyepatch,
    wrinkles,
    garment,
    cloth,
    headwear,
    lens,
    slate: look.role === 'trader' || look.role === 'scientist',
    tabs: look.role === 'officer',
    patches,
    emblem,
  };
}

/* ---------------------------------------------------------------------------------------------- */
/* SVG building blocks.                                                                            */
/* ---------------------------------------------------------------------------------------------- */

type P = readonly [number, number];
/** A path segment: one point draws a line, two a quadratic curve, three a cubic (end point last). */
type Seg = readonly [P] | readonly [P, P] | readonly [P, P, P];
type Attrs = Record<string, string | number | undefined>;

/** A number with at most `places` decimals and no leading zero (".5"). */
const num = (v: number, places: number): string => String(Math.round(v * 10 ** places) / 10 ** places).replace(/^(-?)0\./, '$1.');
/** Coordinates keep one decimal. */
const n = (v: number): string => num(v, 1);
const pt = (p: P): string => `${n(p[0])} ${n(p[1])}`;
const flip = (p: P): P => [96 - p[0], p[1]];
const lerp = (a: P, b: P, t: number): P => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];

function segment(s: Seg): string {
  return s.length === 1 ? `L${pt(s[0])}` : s.length === 2 ? `Q${pt(s[0])} ${pt(s[1])}` : `C${pt(s[0])} ${pt(s[1])} ${pt(s[2])}`;
}

/** A path from `start` through segments, closed unless `open`. */
function path(start: P, segs: readonly Seg[], open = false): string {
  return `M${pt(start)}${segs.map(segment).join('')}${open ? '' : 'Z'}`;
}

/** A closed shape symmetric about x = 48, from its right half (starting on the axis). */
function sym(start: P, right: readonly Seg[]): string {
  const ends: P[] = [start, ...right.map((s) => s[s.length - 1]!)];
  let d = path(start, right, true);
  const last = ends[ends.length - 1]!;
  if (Math.abs(last[0] - 48) > 0.01) d += `L${pt(flip(last))}`;
  for (let i = right.length - 1; i >= 0; i--) {
    const s = right[i]!;
    const back = flip(ends[i]!);
    d += s.length === 1 ? `L${pt(back)}` : s.length === 2 ? `Q${pt(flip(s[0]))} ${pt(back)}` : `C${pt(flip(s[1]))} ${pt(flip(s[0]))} ${pt(back)}`;
  }
  return `${d}Z`;
}

/** The stretch of a cubic Bézier (p0 plus a segment) between t0 and t1, as a path. */
function cubicPart(p0: P, [p1, p2, p3]: readonly [P, P, P], t0: number, t1: number): string {
  const split = (a: P, b: P, c: P, d: P, t: number): [P, P, P, P, P, P, P] => {
    const ab = lerp(a, b, t);
    const bc = lerp(b, c, t);
    const cd = lerp(c, d, t);
    const abc = lerp(ab, bc, t);
    const bcd = lerp(bc, cd, t);
    return [a, ab, abc, lerp(abc, bcd, t), bcd, cd, d];
  };
  const [a, b, c, d] = split(p0, p1, p2, p3, t1);
  const [, , , m, e, f, g] = split(a, b, c, d, t0 / t1);
  return `M${pt(m)}C${pt(e)} ${pt(f)} ${pt(g)}`;
}

/** Colour attributes, whose #aabbcc values shorten to #abc. */
const COLOURS = new Set(['fill', 'stroke', 'stop-color']);

/** One element as markup; undefined attributes are left out, numbers keep one decimal (opacity two). */
function el(tag: string, attrs: Attrs, inner = ''): string {
  let s = `<${tag}`;
  for (const k in attrs) {
    const v = attrs[k];
    if (v === undefined) continue;
    const text = typeof v === 'number' ? num(v, k.endsWith('opacity') ? 2 : 1) : COLOURS.has(k) ? v.replace(/^#([0-9a-f])\1([0-9a-f])\2([0-9a-f])\3$/, '#$1$2$3') : v;
    s += ` ${k}="${text}"`;
  }
  return inner ? `${s}>${inner}</${tag}>` : `${s}/>`;
}

const shape = (d: string, color: string, extra: Attrs = {}): string => el('path', { d, fill: color, ...extra });
/** Round caps and joins come from the figure's group. */
const stroke = (d: string, color: string, width: number, extra: Attrs = {}): string => el('path', { d, fill: 'none', stroke: color, 'stroke-width': width, ...extra });
const circle = (cx: number, cy: number, r: number, color: string, extra: Attrs = {}): string => el('circle', { cx, cy, r, fill: color, ...extra });
const ellipse = (cx: number, cy: number, rx: number, ry: number, color: string, extra: Attrs = {}): string => el('ellipse', { cx, cy, rx, ry, fill: color, ...extra });
const use = (id: string, extra: Attrs = {}): string => el('use', { href: `#${id}`, ...extra });
/** Several ellipses [cx, cy, rx, ry] as one path. */
const ovals = (...list: readonly (readonly [number, number, number, number])[]): string =>
  list.map(([x, y, rx, ry]) => `M${n(x - rx)} ${n(y)}a${n(rx)} ${n(ry)} 0 1 0 ${n(rx * 2)} 0a${n(rx)} ${n(ry)} 0 1 0 ${n(-rx * 2)} 0`).join('');
/** The mirror image about x = 48. */
const MIRROR = 'matrix(-1 0 0 1 96 0)';
/** The figure is drawn at a comfortable size, then scaled up about (48, ZOOM_Y) to fill the frame. */
const ZOOM = 1.12;
const ZOOM_Y = 54;

/** Scalloped outline (curls): bumps along an elliptical arc from angle a0 to a1 (radians, y up). */
function bumps(cx: number, cy: number, rx: number, ry: number, a0: number, a1: number, count: number, depth: number, r: Rng): string {
  let d = '';
  const at = (a: number, k: number): P => [cx + Math.cos(a) * rx * k, cy - Math.sin(a) * ry * k];
  for (let i = 1; i <= count; i++) {
    const a = a0 + ((a1 - a0) * i) / count;
    const mid = a0 + ((a1 - a0) * (i - 0.5)) / count;
    d += `Q${pt(at(mid, 1 + (depth / Math.min(rx, ry)) * r.range(0.7, 1.3)))} ${pt(at(a, 1))}`;
  }
  return d;
}

/* ---------------------------------------------------------------------------------------------- */
/* Drawing, back to front.                                                                         */
/* ---------------------------------------------------------------------------------------------- */

interface Tones {
  skin: string;
  shade: string;
  deep: string;
  light: string;
  lip: string;
  hair: string;
  hairShade: string;
  hairLight: string;
  rim: string;
}

function tonesFor(t: PortraitTraits): Tones {
  const depth = 1 - lightness(t.skin);
  return {
    skin: t.skin,
    shade: mix(t.skin, '#3a1a14', 0.24),
    deep: mix(t.skin, '#1c0b08', 0.62),
    light: mix(t.skin, '#fff3e6', depth > 0.45 ? 0.16 : 0.24),
    lip: mix(t.skin, depth > 0.45 ? '#4a1a1c' : '#b4585a', depth > 0.45 ? 0.28 : 0.3),
    hair: t.hair,
    hairShade: mix(t.hair, '#000000', 0.32),
    hairLight: mix(t.hair, '#ffffff', 0.28),
    rim: RIM[t.faction],
  };
}

/** Where the neck meets the shoulders. */
const BASE = 73;

/** Right half of the face outline: crown to cheekbone, cheek to jaw corner, jaw to chin. */
function headRight(t: PortraitTraits): readonly [P, P, P][] {
  const { top: T, eye: E, chin: C, hw, jw, cw, jawY } = t;
  const round = t.soft * 1.2;
  return [
    [[48 + hw * 0.58, T], [48 + hw, T + (E - T) * 0.42], [48 + hw, E - 1]],
    [[48 + hw, E + (jawY - E) * 0.55], [48 + jw + (hw - jw) * 0.45 + round * 0.3, jawY - 2.2 - round], [48 + jw, jawY]],
    [[48 + jw - (jw - cw) * 0.28 - round * 0.3, jawY + (C - jawY) * 0.55 + round * 0.4], [48 + cw + 1.4, C], [48, C]],
  ];
}

/** Right half of the torso: neckline, trapezius to the shoulder point, then down the arm. */
function torsoRight(t: PortraitTraits): { start: P; segs: Seg[] } {
  const { neck: w, shoulders: sh } = t;
  const kind = NECKLINE[t.garment];
  const depth = BASE + (t.garment === 'coverall' ? 8 : t.garment === 'shirt' ? 11 : 15);
  const start: P = kind === 'v' ? [48, depth] : kind === 'crew' ? [48, BASE + 4.2] : [48, BASE + 2];
  const first: Seg = kind === 'crew' ? [[48 + w * 0.8, BASE + 4.2], [48 + w + 1, BASE + 2], [48 + w + 1.4, BASE + 0.4]] : [[48 + w + 1.4, BASE + 0.4]];
  return {
    start,
    segs: [first, [[48 + w + 8, BASE + 2], [48 + sh - 9, BASE + 2.6], [48 + sh, BASE + 6]], [[48 + sh + 5.6, BASE + 7.6], [48 + sh + 8, BASE + 13], [48 + sh + 9, 97]], [[48, 97]]],
  };
}

type Neckline = 'high' | 'v' | 'crew';
const NECKLINE: Record<Garment, Neckline> = {
  tunic: 'high',
  jacket: 'v',
  coat: 'v',
  flight: 'high',
  lab: 'v',
  hoodie: 'crew',
  coverall: 'v',
  shirt: 'v',
  sweater: 'crew',
};

/** The vignette and a faint comm-screen ring behind the head. */
function background(t: PortraitTraits, id: string): string {
  return el('rect', { width: 96, height: 96, fill: `url(#${id}b)` }) + el('circle', { cx: 48, cy: 40, r: 34, fill: 'none', stroke: RIM[t.faction], 'stroke-width': 1.2, opacity: 0.09 });
}

/** A hood's outer shape (for its dark inside and its cloth). */
function hoodOuter(t: PortraitTraits): string {
  const { top: T, eye: E, hw, neck: w } = t;
  return sym([48, T - 10], [
    [[48 + 5, T - 9.4], [48 + hw + 6.5, T - 5], [48 + hw + 8.5, E - 4]],
    [[48 + hw + 10, E + 10], [48 + hw + 9.5, 66], [48 + hw + 15, BASE + 5]],
    [[48 + hw + 8, BASE + 10], [48 + w + 6, BASE + 10], [48, BASE + 14]],
  ]);
}

/** Hair that sits behind the head and neck. */
function hairBack(t: PortraitTraits, c: Tones, r: Rng): string {
  const { top: T, eye: E, hw, chin: C } = t;
  const v = t.volume;
  const o = hw + v * 0.6 + 0.8;
  const back = c.hairShade;
  switch (t.style) {
    case 'long':
    case 'bob': {
      const bottom = t.style === 'long' ? r.range(84, 94) : C + r.range(-3, 1);
      const flare = t.style === 'long' ? r.range(2, 5) : 1.5;
      return shape(
        sym([48, T - v], [
          [[48 + o * 0.62, T - v], [48 + o + 0.6, T + 6], [48 + o + 0.6, E]],
          [[48 + o + 0.6, E + 12], [48 + o + flare * 0.5, bottom - 10], [48 + o + flare, bottom]],
          [[48 + o * 0.6, bottom + 1.4], [48 + 8, bottom + 1], [48, bottom + 0.6]],
        ]),
        back,
      );
    }
    case 'afro': {
      const rx = hw + 6 + v * 1.2;
      const ry = (E - T) * 0.5 + 8 + v;
      const cy = T + (E - T) * 0.5;
      const start: P = [48 + Math.cos(-0.35) * rx, cy + Math.sin(0.35) * ry];
      return shape(`M${pt(start)}${bumps(48, cy, rx, ry, -0.35, Math.PI + 0.35, 13, 2.2, r)}L${pt([48 - hw + 2, E + 10])}L${pt([48 + hw - 2, E + 10])}Z`, back);
    }
    case 'locs': {
      let d = '';
      for (const side of [-1, 1]) {
        for (let k = 0; k < 5; k++) {
          const x0 = 48 + side * (hw - 6 + k * 2.2);
          const x1 = 48 + side * (hw - 1 + k * 2.3 + r.range(-0.5, 0.5));
          d += `M${n(x0)} ${n(T + 2 + k * 2.5)}C${n(x0 + side * 6)} ${n(E - 4)} ${n(x1 + side * 1.5)} ${n(E + 12)} ${n(x1)} ${n(r.range(80, 92))}`;
        }
      }
      return stroke(d, mix(back, '#000000', 0.35), 3.6) + stroke(d, back, 2.4);
    }
    case 'ponytail': {
      const s = t.part;
      return shape(
        path([48 + s * hw * 0.3, T + 1], [
          [[48 + s * (hw + 6.5), T - 1], [48 + s * (hw + 6), E + 8], [48 + s * (hw + 1.8), BASE + 6]],
          [[48 + s * (hw - 1), BASE], [48 + s * (hw - 2), E + 6]],
        ]),
        back,
      );
    }
    case 'bun':
      return circle(48 + t.part * r.range(0, 3), T - v - r.range(1.5, 3), r.range(5.5, 7), c.hair) + circle(48 + t.part * 1.5, T - v - 1.2, 4, c.hairShade, { opacity: 0.35 });
    default:
      return '';
  }
}

/**
 * A cap of hair over the skull: `up` thick on top and `out` at the sides, down to `sideY` in
 * front of the ears, with the hairline at `hl`.
 */
function capPath(t: PortraitTraits, up: number, out: number, sideY: number, hl: number, corner = 1.6): string {
  const { top: T, eye: E, hw } = t;
  const o = hw + out;
  return sym([48, T - up], [
    [[48 + o * 0.6, T - up], [48 + o + up * 0.15, T + (E - T) * 0.36 - up * 0.4], [48 + o, sideY - 2.5]],
    [[48 + o, sideY - 0.8], [48 + o - 0.6, sideY], [48 + hw - 0.8, sideY]],
    [[48 + hw - 1.3, E - 8], [48 + hw - 1.2 - corner, hl + 3.2], [48 + hw * 0.56, hl + 0.9]],
    [[48 + hw * 0.3, hl], [48 + 4, hl - 0.2], [48, hl - 0.1]],
  ]);
}

/**
 * A cap of textured hair: a scalloped outline `out` beyond the skull at the sides and `up` above
 * it, with `count` bumps `depth` deep, down to `sideY` in front of the ears.
 */
function tuftedCap(t: PortraitTraits, out: number, up: number, sideY: number, count: number, depth: number, r: Rng): string {
  const { top: T, eye: E, hw, hairline: hl } = t;
  const o = hw + out;
  const cy = T + (E - T) * 0.5;
  const start: P = [48 + hw - 0.8, sideY];
  return (
    `M${pt(start)}L${pt([48 + o, sideY])}${bumps(48, cy, o, cy - T + up, -0.12, Math.PI + 0.12, count, depth, r)}L${pt([48 - hw + 0.8, sideY])}` +
    `C${pt([48 - hw + 1.3, E - 8])} ${pt([48 - hw + 2.6, hl + 3])} ${pt([48 - hw * 0.56, hl + 0.9])}C${pt([44, hl - 0.3])} ${pt([52, hl - 0.3])} ${pt([48 + hw * 0.56, hl + 0.9])}` +
    `C${pt([48 + hw - 2.6, hl + 3])} ${pt([48 + hw - 1.3, E - 8])} ${pt(start)}Z`
  );
}

/** Hair in front: the cap, fringes and locks that frame the face. */
function hairFront(t: PortraitTraits, c: Tones, r: Rng): string {
  const { top: T, eye: E, hw, jawY } = t;
  const v = t.volume;
  const hl = t.hairline;
  const s = t.part;
  const shine = (width = 1.4): string => stroke(`M${n(48 - hw * 0.72)} ${n(T + 7)}Q${n(48 - hw * 0.45)} ${n(T - v + 1.8)} ${n(48 - 3)} ${n(T - v + 1.4)}`, c.hairLight, width, { opacity: 0.4 });
  /** A few strands combed back from the hairline. */
  const combed = (xs: readonly number[], color: string, opacity: number): string =>
    stroke(xs.map((dx) => `M${n(48 + dx)} ${n(hl + 0.4)}Q${n(48 + dx * 1.12)} ${n(T + 3)} ${n(48 + dx * 0.75)} ${n(T - v * 0.6 + 1.2)}`).join(''), color, 0.7, { opacity });
  const cropped = (hlAt: number): string => shape(capPath(t, 0.8, 0.5, E - 3, hlAt, 1), mix(c.hair, c.skin, 0.4));
  switch (t.style) {
    case 'crop':
      return shape(tuftedCap(t, 0.9, v * 0.75, E - 2.5, 15, 0.55, r), c.hair) + combed([-6, -1.5, 3, 7.5], c.hairShade, 0.45) + shine();
    case 'buzz':
      return cropped(hl + 0.5);
    case 'coily':
      return shape(tuftedCap(t, v * 0.55, v, E - 2.6, 11, 1.3, r), c.hair);
    case 'afro':
      return shape(capPath(t, 1, 1, E - 1, hl, 2), c.hair) + shine(2);
    case 'locs': {
      // Textured roots, then two locs each side falling past the ears.
      const cap = tuftedCap(t, 1.4, 2.2, E - 2.2, 12, 1, r);
      let d = '';
      for (const side of [-1, 1]) {
        for (const k of [0, 1]) {
          const x = 48 + side * (hw - 1.6 + k * 2.2);
          d += `M${n(x)} ${n(hl + 3)}C${n(x + side * 1.5)} ${n(E + 6)} ${n(x + side * 0.5)} ${n(jawY)} ${n(x + side * (1.5 + k))} ${n(BASE + r.range(0, 6))}`;
        }
      }
      return shape(cap, c.hair) + stroke(d, mix(c.hair, '#000000', 0.35), 3.4) + stroke(d, c.hair, 2.2);
    }
    case 'side':
    case 'undercut': {
      const sides = t.style === 'undercut' ? cropped(hl + 0.5) : shape(capPath(t, v * 0.5, 0.8, E - 2.5, hl), c.hair);
      const lift = v + (t.style === 'undercut' ? 1.5 : 0.8);
      // Swept from a parting over the top, falling across the forehead to the far temple.
      const sweep = shape(
        path([48 + s * 7, hl + 0.2], [
          [[48 + s * 6, T - lift - 1], [48 - s * 4, T - lift - 2.2], [48 - s * (hw * 0.8), T - lift + 1.4]],
          [[48 - s * (hw + v * 0.5), T + 4], [48 - s * (hw + 0.6), hl], [48 - s * (hw - 0.6), hl + 5]],
          [[48 - s * (hw * 0.6), hl + 5.6], [48 - s * 2, hl + 3.4], [48 + s * 3, hl + 1.4]],
          [[48 + s * 5.5, hl + 0.6], [48 + s * 7, hl + 0.2]],
        ]),
        c.hair,
      );
      const flow = stroke(`M${n(48 + s * 5)} ${n(T - lift + 1)}Q${n(48 - s * 4)} ${n(T - lift + 1)} ${n(48 - s * (hw - 1.5))} ${n(hl + 1)}M${n(48 + s * 2)} ${n(hl + 1)}Q${n(48 - s * 5)} ${n(hl - 1)} ${n(48 - s * (hw - 3))} ${n(hl + 3.6)}`, c.hairShade, 0.7, { opacity: 0.5 });
      return sides + sweep + flow + shine();
    }
    case 'fringe': {
      // Locks of uneven length across the brow, longer towards the temples, combed a little to one side.
      const cap = shape(capPath(t, v * 0.8, 1.2, E - 2, hl), c.hair);
      const y = E - r.range(8, 9.2);
      const steps = 7;
      const tips: P[] = [];
      for (let i = 0; i <= steps; i++) {
        const k = Math.abs(i - steps / 2) / (steps / 2);
        tips.push([48 - hw + 0.8 + ((2 * hw - 1.6) * i) / steps, y + k * k * 2.4 + r.range(-0.4, 0.9)]);
      }
      let d = `M${n(48 - hw + 0.4)} ${n(hl - 1)}L${pt(tips[0]!)}`;
      let strands = '';
      for (let i = 1; i < tips.length; i++) {
        const a = tips[i - 1]!;
        const b = tips[i]!;
        const notch: P = [(a[0] + b[0]) / 2 + s * 0.5, Math.min(a[1], b[1]) - r.range(1.3, 2.2)];
        d += `Q${n(a[0] + 0.3)} ${n(notch[1] + 0.6)} ${pt(notch)}Q${n(b[0] - 0.5)} ${n(notch[1] + 0.2)} ${pt(b)}`;
        if (i % 2) strands += `M${n(b[0] + s * 2)} ${n(hl + 1)}Q${n(b[0] + s * 0.8)} ${n((hl + b[1]) / 2)} ${n(b[0])} ${n(b[1] - 1.2)}`;
      }
      return cap + shape(`${d}L${n(48 + hw - 0.4)} ${n(hl - 1)}Z`, c.hair) + stroke(strands, c.hairShade, 0.6, { opacity: 0.5 }) + shine();
    }
    case 'slick':
      return shape(capPath(t, v * 0.6, 0.8, E - 3, hl - 0.6), c.hair) + combed([-7, -2, 3.5, 8.5], c.hairShade, 0.6) + shine(1.1);
    case 'mohawk': {
      const w = r.range(3.6, 5);
      const peak = T - r.range(7, 11);
      return (
        shape(capPath(t, 0.6, 0.4, E - 3.5, hl + 0.8, 1), mix(c.hair, c.skin, 0.5)) +
        shape(`M${n(48 - w)} ${n(hl + 1)}C${n(48 - w - 1.2)} ${n(T - 2)} ${n(48 - w * 0.6)} ${n(peak + 1)} 48 ${n(peak)}C${n(48 + w * 0.6)} ${n(peak + 1)} ${n(48 + w + 1.2)} ${n(T - 2)} ${n(48 + w)} ${n(hl + 1)}Z`, c.hair)
      );
    }
    case 'long':
    case 'bob': {
      const cap = shape(capPath(t, v, v * 0.6, E - 1, hl), c.hair);
      const low = t.style === 'long' ? 84 : jawY + 5;
      const lock = (side: number): string =>
        shape(
          path([48 + side * (hw * 0.25), hl - 0.6], [
            [[48 + side * (hw * 0.75), hl + 0.2], [48 + side * (hw - 1.6), hl + 5], [48 + side * (hw - 1.3), E]],
            [[48 + side * (hw - 0.8), E + 10], [48 + side * (hw - 0.2), jawY - 2], [48 + side * (hw + 1.2), low - 1.4]],
            // Rounded ends.
            [[48 + side * (hw + 1.6), low + 0.6], [48 + side * (hw + 3.4), low + 0.4]],
            [[48 + side * (hw + v + 3.2), low + 0.2], [48 + side * (hw + v + 3), low - 2.4]],
            [[48 + side * (hw + v + 1), E - 6]],
            [[48 + side * (hw * 0.4), T - v + 1]],
          ]),
          c.hair,
        );
      const strand = (side: number): string => `M${n(48 + side * (hw - 0.6))} ${n(E - 5)}Q${n(48 + side * (hw + 0.8))} ${n(E + 9)} ${n(48 + side * (hw + 2.4))} ${n(low - 2.4)}`;
      const partX = 48 + s * r.range(0, 5);
      return (
        cap +
        lock(-1) +
        lock(1) +
        stroke(`M${n(partX)} ${n(hl - 0.5)}Q${n(partX - s)} ${n(T + 2)} ${n(partX - s * 2)} ${n(T - v + 1)}${strand(-1)}${strand(1)}`, c.hairShade, 0.8, { opacity: 0.6 }) +
        shine()
      );
    }
    case 'bun':
    case 'ponytail':
      return shape(capPath(t, 1.6, 0.9, E - 2, hl - 0.4), c.hair) + combed([-6, -2, 2, 6], c.hairShade, 0.5) + shine(1.2);
    case 'receding': {
      const side = (k: number): string =>
        shape(
          path([48 + k * (hw - 0.8), E - 2.5], [
            [[48 + k * (hw + 2), E - 4], [48 + k * (hw + 2), T + 8], [48 + k * (hw - 2), T + 5]],
            [[48 + k * (hw - 4.5), T + 8], [48 + k * (hw - 2.4), E - 8], [48 + k * (hw - 0.8), E - 2.5]],
          ]),
          c.hair,
        );
      return side(-1) + side(1) + shape(capPath(t, 0.5, 0.4, E - 5, hl + 3, 3), c.hair, { opacity: 0.35 });
    }
    case 'bald':
      return ellipse(48 - 5, T + 5, 6, 3, c.light, { opacity: 0.35 });
  }
}

/** Neck, with the chin's shadow. */
function neck(t: PortraitTraits, c: Tones): string {
  const { neck: w, chin: C } = t;
  return (
    shape(`M${n(48 - w)} ${n(C - 12)}L${n(48 - w - 0.8)} 95H${n(48 + w + 0.8)}L${n(48 + w)} ${n(C - 12)}Z`, c.skin) +
    shape(`M${n(48 - w - 0.5)} ${n(C - 7)}Q48 ${n(C + 9)} ${n(48 + w + 0.5)} ${n(C - 7)}Z`, c.shade) +
    shape(`M${n(48 + w - 2.6)} ${n(C)}L${n(48 + w + 0.2)} ${n(C - 2)}L${n(48 + w + 0.8)} 95H${n(48 + w - 2)}Z`, c.shade, { opacity: 0.7 })
  );
}

/** A faction emblem, centred on (x, y). */
function emblem(kind: Emblem, x: number, y: number, color: string, scale = 1): string {
  const g = (inner: string): string => el('g', { transform: `translate(${n(x)} ${n(y)}) scale(${scale})` }, inner);
  switch (kind) {
    case 'ring':
      return g(el('circle', { r: 2.1, fill: 'none', stroke: color, 'stroke-width': 1.1 }) + el('ellipse', { rx: 4, ry: 1.3, fill: 'none', stroke: color, 'stroke-width': 0.8, transform: 'rotate(-20)' }));
    case 'chevron':
      return g(stroke('M-3.2 1L0-2.2L3.2 1M-3.2 3.6L0 .4L3.2 3.6', color, 1.2));
    case 'wake':
      return g(stroke('M-3.4-2.4Q0 .8 3.4-2.4M-2.6 .6Q0 2.8 2.6 .6M-1.8 3.2Q0 4.4 1.8 3.2', color, 0.9));
    case 'star':
      return g(shape('M0-3.6L.9-.9L3.6 0L.9.9L0 3.6L-.9.9L-3.6 0L-.9-.9Z', color));
  }
}

/** Clothes: the garment, its collar and trim, insignia and role kit worn on the body. */
function body(t: PortraitTraits, c: Tones, id: string, r: Rng): string {
  const { neck: w, shoulders: sh } = t;
  const k = t.cloth;
  const B = BASE;
  const lab = t.garment === 'lab';
  const fabric = lab ? r.pick(['#dfe4e8', '#e8e6de', '#cfd9e2']) : k.base;
  const dark = mix(fabric, lab ? '#1a2433' : '#000000', lab ? 0.3 : 0.35);
  const lift = mix(fabric, '#ffffff', 0.14);
  // The garment, shaded on the right and lit along the left shoulder (clipped to the torso).
  let s =
    use(`${id}t`, { fill: fabric }) +
    el('g', { 'clip-path': `url(#${id}tc)` }, shape(`M70 97C70 90 72 ${B + 11} 76.5 ${B + 6.5}L99 ${B + 5}V97Z`, dark, { opacity: lab ? 0.8 : 0.55 }) + stroke(`M${n(48 - sh - 2)} ${n(B + 11.5)}Q${n(48 - sh + 6)} ${n(B + 3.2)} ${n(48 - w - 5)} ${n(B + 1.6)}`, lift, 1.4, { opacity: 0.6 }));
  const highCollar = (fill: string, trim: string | null): string =>
    shape(`M${n(48 - w - 1.6)} ${n(B - 2.5)}Q48 ${n(B + 0.1)} ${n(48 + w + 1.6)} ${n(B - 2.5)}L${n(48 + w + 2.8)} ${n(B + 4.2)}Q48 ${n(B + 7.4)} ${n(48 - w - 2.8)} ${n(B + 4.2)}Z`, fill) +
    (trim ? stroke(`M${n(48 - w - 1.6)} ${n(B - 2.5)}Q48 ${n(B + 0.1)} ${n(48 + w + 1.6)} ${n(B - 2.5)}`, trim, 0.9) : '') +
    stroke(`M48 ${n(B - 1.1)}V${n(B + 5.6)}`, mix(fill, '#000000', 0.4), 0.8);
  const vFill = (fill: string, depth: number): string => shape(`M${n(48 - w - 1.2)} ${n(B + 0.6)}L48 ${n(depth)}L${n(48 + w + 1.2)} ${n(B + 0.6)}Z`, fill);
  const lapels = (fill: string, edge: string, depth: number): string => {
    const one = (side: number): string =>
      shape(path([48 + side * (w + 1.2), B + 0.4], [[[48 + side * (w + 5.5), B + 6]], [[48 + side * 6.5, B + 9.5]], [[48 + side * 0.4, depth + 0.6]], [[48 + side * 3, B + 7]]]), fill) +
      stroke(`M${n(48 + side * (w + 1.2))} ${n(B + 0.4)}L${n(48 + side * 3)} ${n(B + 7)}L${n(48 + side * 0.4)} ${n(depth + 0.6)}`, edge, 0.6, { opacity: 0.8 });
    return one(-1) + one(1);
  };
  const collarPoints = (fill: string): string => {
    const one = (side: number): string => shape(`M${n(48 + side * (w + 1.4))} ${n(B - 0.6)}L${n(48 + side * 1.6)} ${n(B + 6.5)}L${n(48 + side * (w - 1.2))} ${n(B + 3.6)}Z`, fill);
    return one(-1) + one(1);
  };
  switch (t.garment) {
    case 'tunic':
      // High collar, diagonal closure and shoulder seams, all piped.
      s += highCollar(lift, k.trim);
      s += stroke(`M${n(48 - 2)} ${n(B + 4.8)}L${n(48 + 14)} 97`, k.trim, 1);
      s += stroke(`M${n(48 + w + 6)} ${n(B + 2.8)}Q${n(48 + sh - 8)} ${n(B + 3.4)} ${n(48 + sh + 1)} ${n(B + 7)}M${n(48 - w - 6)} ${n(B + 2.8)}Q${n(48 - sh + 8)} ${n(B + 3.4)} ${n(48 - sh - 1)} ${n(B + 7)}`, k.trim, 0.8, { opacity: 0.85 });
      break;
    case 'jacket':
      s += vFill(k.under, B + 14) + collarPoints(mix(k.under, '#ffffff', 0.25));
      if (r.next() < 0.45) s += shape(`M${n(48 - 1.6)} ${n(B + 5)}L48 ${n(B + 4)}L${n(48 + 1.6)} ${n(B + 5)}L${n(48 + 1.1)} ${n(B + 15)}L48 ${n(B + 16)}L${n(48 - 1.1)} ${n(B + 15)}Z`, k.trim);
      s += lapels(mix(k.base, '#ffffff', 0.08), k.trim, B + 14);
      break;
    case 'coat': {
      s += vFill(k.under, B + 15);
      // Turned-up collar.
      const flap = (side: number): string =>
        shape(`M${n(48 + side * (w + 0.6))} ${n(B + 2)}L${n(48 + side * (w + 1.8))} ${n(B - 8.5)}L${n(48 + side * (w + 8))} ${n(B - 5.5)}L${n(48 + side * (w + 8.4))} ${n(B + 4.4)}Z`, lift) +
        stroke(`M${n(48 + side * (w + 1.8))} ${n(B - 8.5)}L${n(48 + side * (w + 8))} ${n(B - 5.5)}`, k.trim, 0.8, { opacity: 0.8 });
      s += flap(-1) + flap(1) + lapels(dark, k.trim, B + 15);
      // A strap across the chest with a buckle.
      if (r.next() < 0.6) s += stroke(`M${n(48 - sh + 2)} ${n(B + 6)}L${n(48 + sh - 8)} 99`, '#1a1412', 3.4) + el('rect', { x: 52, y: n(B + 14.3), width: 4, height: 3, rx: 0.6, fill: 'none', stroke: k.metal, 'stroke-width': 0.9, transform: `rotate(34 54 ${n(B + 15.8)})` });
      break;
    }
    case 'flight':
      // Suit seal ring, zip and a stripe.
      s += shape(`M${n(48 - w - 2.2)} ${n(B - 1.8)}Q48 ${n(B + 1.2)} ${n(48 + w + 2.2)} ${n(B - 1.8)}L${n(48 + w + 3)} ${n(B + 3.4)}Q48 ${n(B + 6.6)} ${n(48 - w - 3)} ${n(B + 3.4)}Z`, '#8b95a6');
      s += stroke(`M${n(48 - w - 2.2)} ${n(B - 1.8)}Q48 ${n(B + 1.2)} ${n(48 + w + 2.2)} ${n(B - 1.8)}`, '#d5dde8', 0.7, { opacity: 0.8 });
      s += stroke(`M48 ${n(B + 6)}V97`, lift, 0.9) + el('rect', { x: 47, y: n(B + 7), width: 2, height: 2.8, rx: 0.5, fill: '#c7ced8' });
      s += stroke(`M${n(48 - sh - 2)} ${n(B + 14.5)}L42 ${n(B + 12.2)}M54 ${n(B + 12.2)}L${n(48 + sh + 2)} ${n(B + 14.5)}`, k.trim, 1.6, { opacity: 0.9 });
      break;
    case 'lab':
      // A light coat open over a shirt in the faction's colour, a pocket and a pen.
      s += vFill(k.base, B + 16);
      s += shape(`M${n(48 - w * 0.9)} ${n(B + 3.2)}Q48 ${n(B + 6.6)} ${n(48 + w * 0.9)} ${n(B + 3.2)}L${n(48 + w + 1.2)} ${n(B + 0.6)}L${n(48 - w - 1.2)} ${n(B + 0.6)}Z`, c.skin);
      s += lapels(mix(fabric, '#9fb0c2', 0.3), '#ffffff', B + 16);
      s += stroke(`M60 ${n(B + 14.5)}H68`, mix(fabric, '#5a6a7a', 0.45), 0.8) + stroke(`M62 ${n(B + 11.2)}V${n(B + 14.8)}`, k.trim, 1.1);
      break;
    case 'hoodie':
      // Drawstrings below the hood's cowl.
      s += stroke(`M44 ${n(B + 6)}V${n(B + 15)}M52 ${n(B + 6)}V${n(B + 17)}`, k.under, 0.9) + circle(44, B + 15.6, 0.8, k.metal) + circle(52, B + 17.6, 0.8, k.metal);
      break;
    case 'coverall':
      s += vFill(k.under, B + 8) + collarPoints(lift);
      // Reflective stripes.
      s += el('g', { 'clip-path': `url(#${id}tc)` }, el('rect', { x: 0, y: n(B + 14.5), width: 96, height: 3.2, fill: '#e8a33a' }) + el('rect', { x: 0, y: n(B + 15.6), width: 96, height: 1, fill: '#e8eef4', opacity: 0.85 }));
      s += stroke(`M58 ${n(B + 10.5)}H67`, dark, 0.8);
      break;
    case 'shirt': {
      s += vFill(c.skin, B + 11) + shape(`M${n(48 - w - 1.2)} ${n(B + 0.6)}L48 ${n(B + 11)}L${n(48 + w + 1.2)} ${n(B + 0.6)}L${n(48 + w + 1.4)} ${n(B + 2)}L48 ${n(B + 12.2)}L${n(48 - w - 1.4)} ${n(B + 2)}Z`, c.shade, { opacity: 0.35 });
      s += collarPoints(lift);
      s += stroke(`M48 ${n(B + 11.5)}V97`, dark, 0.7) + circle(48.9, B + 15, 0.45, lift) + circle(48.9, B + 19.5, 0.45, lift);
      // Braces or a neckerchief.
      const extra = r.next();
      if (extra < 0.3) s += stroke(`M33 ${n(B + 4)}V97M63 ${n(B + 4)}V97`, mix(k.base, '#000000', 0.5), 2.4);
      else if (extra < 0.55) s += shape(`M${n(48 - w - 1)} ${n(B + 1.2)}Q48 ${n(B + 5)} ${n(48 + w + 1)} ${n(B + 1.2)}L50 ${n(B + 10)}L48 ${n(B + 12)}L46 ${n(B + 10)}Z`, k.trim);
      break;
    }
    case 'sweater':
      s += r.next() < 0.4 ? highCollar(lift, null) : stroke(`M${n(48 - w - 1)} ${n(B + 2.2)}Q48 ${n(B + 6.4)} ${n(48 + w + 1)} ${n(B + 2.2)}`, lift, 1.6);
      s += stroke(`M20 ${n(B + 17)}H76M18 ${n(B + 19.4)}H78`, lift, 0.8, { opacity: 0.45 });
      break;
  }
  // Wake patches: squares of other cloth, stitched on.
  for (let i = 0; i < t.patches; i++) {
    const x = i === 0 ? 48 - sh + r.range(6, 11) : 48 + r.range(14, 22);
    const y = B + r.range(11, 16);
    const size = r.range(4.2, 5.6);
    s += el('rect', {
      x: n(x),
      y: n(y),
      width: n(size),
      height: n(size * r.range(0.8, 1.1)),
      fill: r.pick(['#5a4a3a', '#6a2e22', '#4a5040', '#3d4652', '#7a5a2e']),
      stroke: k.metal,
      'stroke-width': 0.5,
      'stroke-dasharray': '1 .8',
      transform: `rotate(${n(r.range(-12, 12))} ${n(x + size / 2)} ${n(y + size / 2)})`,
    });
  }
  // Officers: collar tabs.
  if (t.tabs) {
    const tab = (side: number): string =>
      el('rect', { x: n(48 + side * (w + 1.2) - 2), y: n(B - 1.4), width: 4, height: 2.6, rx: 0.4, fill: k.metal, transform: `rotate(${side * -12} ${n(48 + side * (w + 1.2))} ${n(B - 0.1)})` }) +
      circle(48 + side * (w + 1.2), B - 0.1, 0.5, mix(k.metal, '#000000', 0.45));
    s += tab(-1) + tab(1);
  }
  // Insignia on the chest.
  if (t.emblem) s += lab ? emblem(t.emblem, 64, B + 17.5, k.trim, 0.7) : emblem(t.emblem, 65, B + 14.5, t.faction === 'sta' || t.faction === 'independent' ? k.trim : k.metal, 0.9);
  return s;
}

function ears(t: PortraitTraits, c: Tones, id: string): string {
  const { eye: E, hw } = t;
  let s = use(`${id}r`, { fill: c.shade }) + use(`${id}r`, { fill: c.skin, transform: MIRROR });
  const lobe = (side: number): P => [48 + side * (hw + 1.2), E + 9.4];
  if (t.earring) {
    const metal = t.faction === 'hollow-wake' ? '#e0a64a' : '#e6d9a8';
    for (const side of t.earring === 'rings' ? [-1, 1] : [-1]) {
      const [x, y] = lobe(side);
      if (t.earring === 'stud') s += circle(x, y, 0.9, metal);
      else if (t.earring === 'hoop') s += el('circle', { cx: n(x), cy: n(y + 1.6), r: 1.7, fill: 'none', stroke: metal, 'stroke-width': 0.7 });
      else s += el('circle', { cx: n(x), cy: n(y + 1.3), r: 1.3, fill: 'none', stroke: metal, 'stroke-width': 0.6 }) + circle(x + side * 1.4, y - 3.5, 0.6, metal) + circle(x + side * 1.8, y - 6, 0.6, metal);
    }
  }
  return s;
}

/** Skin of the face with light and shade, then marks (clipped to the face). */
function face(t: PortraitTraits, c: Tones, id: string, r: Rng): string {
  const { top: T, eye: E, chin: C, hw, jawY } = t;
  let inner = '';
  // Shadow side and highlights.
  inner += shape(
    path([48 + hw * 0.62, T - 2], [
      [[48 + hw * 0.18, E - 8], [48 + hw * 0.8, E + 3], [48 + hw * 0.64, jawY - 2]],
      [[48 + hw * 0.52, C - 4], [48 + 5, C - 0.6], [48 - 2, C + 1]],
      [[98, C + 1]],
      [[98, T - 2]],
    ]),
    c.shade,
  );
  inner += shape(ovals([42, T + 10.5, 6, 3], [38.5, E + 6.5, 3.8, 2], [46.5, C - 2.4, 2.6, 1.2]), c.light, { opacity: 0.37 });
  if (t.blush > 0.03) inner += shape(ovals([48 - t.eyeGap - 1, E + 8.6, 3.6, 2.2], [48 + t.eyeGap + 1, E + 8.6, 3.6, 2.2]), '#d85660', { opacity: t.blush });
  // Age: under-eye lines, folds from nose to mouth, forehead lines, crow's feet.
  if (t.wrinkles > 0) {
    const a = t.wrinkles;
    const fold = (side: number): string =>
      `M${n(48 + side * (t.noseW + 1.4))} ${n(t.noseY - 1.2)}Q${n(48 + side * (t.mouthW + 3.2))} ${n(t.noseY + 2.4)} ${n(48 + side * (t.mouthW + 1.8))} ${n(t.mouthY + 2.6)}`;
    inner += stroke(fold(-1) + fold(1), c.shade, 0.9, { opacity: 0.35 + a * 0.4 });
    if (a > 0.5) {
      const under = (side: number): string =>
        `M${n(48 + side * (t.eyeGap - t.eyeW * 0.4))} ${n(E + t.eyeH + 1.2)}Q${n(48 + side * t.eyeGap)} ${n(E + t.eyeH + 2.4)} ${n(48 + side * (t.eyeGap + t.eyeW * 0.45))} ${n(E + t.eyeH + 0.8)}`;
      const feet = (side: number): string => `M${n(48 + side * (t.eyeGap + t.eyeW * 0.6))} ${n(E - 0.6)}l${n(side * 2)} -1.1M${n(48 + side * (t.eyeGap + t.eyeW * 0.6))} ${n(E + 0.8)}l${n(side * 2)} .9`;
      const fy = t.hairline + 3.2;
      const brow = `M40 ${n(fy)}Q48 ${n(fy - 1.2)} 56 ${n(fy)}M42 ${n(fy + 2.6)}Q48 ${n(fy + 1.6)} 54 ${n(fy + 2.6)}`;
      inner += stroke(under(-1) + under(1) + feet(-1) + feet(1) + brow, c.shade, 0.7, { opacity: 0.65 });
    }
  }
  if (t.freckles) {
    for (let i = 0; i < 14; i++) inner += circle(48 + (i % 2 ? 1 : -1) * r.range(2.5, 12), E + r.range(3.5, 9), r.range(0.35, 0.55), mix(c.skin, '#6a3a1e', 0.45), { opacity: 0.8 });
  }
  if (t.smudge) inner += ellipse(48 + r.pick([-1, 1]) * r.range(8, 12), E + r.range(7, 12), r.range(2.5, 3.5), r.range(1.2, 2), '#2a2422', { opacity: 0.35, transform: `rotate(${n(r.range(-25, 25))} 48 ${n(E + 9)})` });
  if (t.mole) inner += circle(t.mole[0], t.mole[1], 0.55, c.deep, { opacity: 0.85 });
  if (t.tattoo) {
    const side = r.pick([-1, 1]);
    const x = 48 + side * (t.eyeGap + 1.5);
    const ink = '#26323e';
    inner +=
      r.next() < 0.5
        ? circle(x - 1.8, E + 5.2, 0.5, ink, { opacity: 0.8 }) + circle(x, E + 5.8, 0.5, ink, { opacity: 0.8 }) + circle(x + 1.8, E + 5.2, 0.5, ink, { opacity: 0.8 })
        : stroke(`M${n(48 + side * (hw - 1))} ${n(E + 2)}L${n(48 + side * (hw - 5))} ${n(E + 7)}L${n(48 + side * (hw - 2))} ${n(E + 9)}`, t.faction === 'hollow-wake' ? '#a8522a' : '#3a4a6a', 0.9, { opacity: 0.8 });
  }
  return use(`${id}h`, { fill: c.skin }) + el('g', { 'clip-path': `url(#${id}hc)` }, inner);
}

/** The left eye with its brow, drawn once and mirrored for the right. */
function eyes(t: PortraitTraits, c: Tones, id: string): string {
  const { eye: E, eyeGap: g, eyeW: w, eyeH: hgt, eyeTilt: tilt } = t;
  const x = 48 - g;
  const outer: P = [x - w / 2, E - tilt];
  const inner: P = [x + w / 2, E + 0.4];
  const lid = `M${pt(outer)}C${pt([x - w * 0.25, E - hgt * 1.05])} ${pt([x + w * 0.2, E - hgt * 1.05])} ${pt(inner)}`;
  const irisR = hgt * 0.7;
  const lash = mix(c.deep, '#000000', 0.3);
  let s = use(`${id}e`, { fill: mix('#f4efe9', c.skin, 0.2) });
  s += el('g', { 'clip-path': `url(#${id}ec)` }, circle(x + 0.1, E + 0.2, irisR, t.iris) + circle(x + 0.1, E + 0.2, irisR * 0.48, '#120c0a') + stroke(`M${n(x - w)} ${n(E - hgt * 0.62)}H${n(x + w)}`, c.shade, 1.4, { opacity: 0.45 }));
  s += stroke(lid + (t.lashes ? `M${pt(outer)}l-1.3 -.9` : ''), lash, t.lashes ? 1.35 : 1.1);
  const crease = t.crease ? `M${n(x - w * 0.42)} ${n(E - hgt * 0.95)}Q${n(x)} ${n(E - hgt - 1.7)} ${n(x + w * 0.42)} ${n(E - hgt * 0.8)}` : '';
  s += stroke(`M${n(x - w * 0.38)} ${n(E + hgt * 0.55)}Q${n(x + w * 0.1)} ${n(E + hgt * 0.78)} ${pt(inner)}${crease}`, c.shade, 0.6, { opacity: 0.68 });
  // The brow: thick at the inner end, tapering outwards.
  const bY = E - t.browY;
  const bi: P = [x + w / 2 + 0.6, bY + t.browTilt];
  const bo: P = [x - w / 2 - 1.2, bY + 1];
  const peak: P = [x - w * 0.12, bY - t.browArch];
  const bw = t.browW;
  s += shape(`M${n(bi[0])} ${n(bi[1] + bw * 0.5)}L${n(bi[0] + 0.2)} ${n(bi[1] - bw * 0.5)}Q${n(peak[0])} ${n(peak[1] - bw * 0.55)} ${pt(bo)}Q${n(peak[0])} ${n(peak[1] + bw * 0.5)} ${n(bi[0])} ${n(bi[1] + bw * 0.5)}Z`, t.brow);
  const shine = circle(x - 0.6, E - 0.6, 0.6, '#ffffff', { opacity: 0.9 }) + circle(96 - x - 0.6, E - 0.6, 0.6, '#ffffff', { opacity: 0.9 });
  return el('g', { id: `${id}g` }, s) + use(`${id}g`, { transform: MIRROR }) + shine;
}

function nose(t: PortraitTraits, c: Tones): string {
  const { eye: E, noseY: N, noseW: w } = t;
  return (
    shape(`M${n(48 + 1.6)} ${n(E + 1)}C${n(48 + 2.4)} ${n(E + 5)} ${n(48 + w * 0.7)} ${n(N - 4)} ${n(48 + w)} ${n(N - 1)}Q${n(48 + w + 0.6)} ${n(N + 0.8)} ${n(48 + w * 0.3)} ${n(N + 1.1)}L${n(48 + 1)} ${n(N)}C${n(48 + 2)} ${n(N - 3.5)} ${n(48 + 1)} ${n(E + 5)} ${n(48 + 0.6)} ${n(E + 1)}Z`, c.shade, { opacity: 0.8 }) +
    shape(`M${n(48 - w)} ${n(N - 0.4)}C${n(48 - w * 0.5)} ${n(N + 1.7)} ${n(48 + w * 0.5)} ${n(N + 1.7)} ${n(48 + w)} ${n(N - 0.4)}C${n(48 + w * 0.4)} ${n(N + 0.5)} ${n(48 - w * 0.4)} ${n(N + 0.5)} ${n(48 - w)} ${n(N - 0.4)}Z`, c.shade) +
    shape(ovals([48 - w * 0.45, N + 0.2, 0.9, 0.5], [48 + w * 0.45, N + 0.2, 0.9, 0.5]), c.deep, { opacity: 0.55 }) +
    stroke(`M${n(48 - w - 0.3)} ${n(N - 2)}Q${n(48 - w - 1)} ${n(N)} ${n(48 - w * 0.55)} ${n(N + 0.5)}`, c.shade, 0.7, { opacity: 0.7 }) +
    stroke(`M47.3 ${n(E + 2)}L47 ${n(N - 3)}`, c.light, 1.1, { opacity: 0.45 }) +
    ellipse(47.3, N - 1.8, 1, 0.8, c.light, { opacity: 0.5 })
  );
}

function mouth(t: PortraitTraits, c: Tones): string {
  const { mouthY: M, mouthW: w, lipTop: u, lipLow: l } = t;
  const L: P = [48 - w, M - t.smile + (t.smirk < 0 ? t.smirk : 0)];
  const R: P = [48 + w, M - t.smile + (t.smirk > 0 ? -t.smirk : 0)];
  const midY = M + 0.5 + t.smile * 0.25;
  return (
    shape(`M${pt(L)}Q${n(48 - w * 0.5)} ${n(M - 1.8 * u)} 48 ${n(M - 1.1 * u)}Q${n(48 + w * 0.5)} ${n(M - 1.8 * u)} ${pt(R)}Q48 ${n(midY + 0.2)} ${pt(L)}Z`, mix(c.lip, '#000000', 0.12)) +
    shape(`M${n(48 - w * 0.8)} ${n(M + 0.4)}Q48 ${n(M + 3.4 * l)} ${n(48 + w * 0.8)} ${n(M + 0.4)}Z`, c.lip) +
    ellipse(47.4, M + 1.5 * l, w * 0.28, 0.45, '#ffffff', { opacity: 0.18 }) +
    stroke(`M${pt(L)}Q48 ${n(midY)} ${pt(R)}`, mix(c.deep, '#000000', 0.2), 0.8) +
    stroke(`M46 ${n(M + 4.2 * l + 0.6)}Q48 ${n(M + 4.6 * l + 0.8)} 50 ${n(M + 4.2 * l + 0.6)}`, c.shade, 0.9, { opacity: 0.5 })
  );
}

function beard(t: PortraitTraits): string {
  if (!t.beard) return '';
  const { eye: E, chin: C, hw, jw, cw, jawY, noseY: N, mouthY: M, mouthW: mw } = t;
  const color = t.brow;
  const full = (len: number, opacity?: number): string =>
    shape(
      sym([48, N + 1.6], [
        [[48 + mw * 0.6, N + 1.1], [48 + mw + 1.8, M - 0.4]],
        [[48 + mw + 3.4, M - 3], [48 + hw - 5, E + 8], [48 + hw - 2.4, E + 1.5]],
        [[48 + hw + 0.3, E + 1.5]],
        [[48 + hw + 0.5, jawY - 4], [48 + jw + 1.2, jawY + 1], [48 + jw - 0.6, jawY + 2 + len * 0.4]],
        [[48 + jw - 3, C + len * 0.8], [48 + cw + 1, C + len], [48, C + len]],
      ]),
      color,
      { opacity },
    );
  switch (t.beard) {
    case 'stubble':
      return full(0.4, 0.28);
    case 'short':
      return full(1.8);
    case 'full':
      return full(6) + stroke(`M42 ${n(C + 2)}Q48 ${n(C + 5)} 54 ${n(C + 2)}`, mix(color, '#000000', 0.3), 0.7, { opacity: 0.6 });
    case 'goatee':
      return shape(
        sym([48, N + 1.6], [
          [[48 + mw * 0.6, N + 1.1], [48 + mw + 1.2, M + 0.4]],
          [[48 + mw + 1.4, M + 3], [48 + mw * 0.8, C - 2], [48 + cw * 0.9, C + 0.8]],
          [[50, C + 2.2], [48, C + 2.2]],
        ]),
        color,
      );
    case 'moustache':
      return shape(sym([48, N + 1.4], [[[48 + mw * 0.6, N + 0.8], [48 + mw + 1.4, M + 0.9]], [[48 + mw * 0.5, M - 0.6], [48, M - 0.8]]]), color);
    case 'chinstrap':
      return (
        stroke(
          `M${n(48 - hw + 0.4)} ${n(E + 2)}C${n(48 - hw + 0.4)} ${n(jawY - 3)} ${n(48 - jw - 0.4)} ${n(jawY + 1)} ${n(48 - jw + 1)} ${n(jawY + 3)}C${n(48 - jw + 3)} ${n(C)} ${n(48 - cw)} ${n(C - 0.2)} 48 ${n(C - 0.2)}C${n(48 + cw)} ${n(C - 0.2)} ${n(48 + jw - 3)} ${n(C)} ${n(48 + jw - 1)} ${n(jawY + 3)}C${n(48 + jw + 0.4)} ${n(jawY + 1)} ${n(48 + hw - 0.4)} ${n(jawY - 3)} ${n(48 + hw - 0.4)} ${n(E + 2)}`,
          color,
          2.6,
        ) + full(0.3, 0.2)
      );
  }
}

/** A healed scar through a brow, down a cheek or across the lip. */
function scar(t: PortraitTraits, c: Tones): string {
  if (!t.scar) return '';
  const { eye: E, eyeGap: g, mouthY: M } = t;
  const d =
    t.scar === 'brow'
      ? `M${n(48 + g - 2)} ${n(E - 9)}L${n(48 + g + 1.5)} ${n(E - 2.5)}M${n(48 + g + 2.2)} ${n(E + 2.5)}L${n(48 + g + 4)} ${n(E + 6.5)}`
      : t.scar === 'cheek'
        ? `M${n(48 - g - 4)} ${n(E + 4)}Q${n(48 - g)} ${n(E + 8)} ${n(48 - g + 2.5)} ${n(E + 13)}`
        : `M49.5 ${n(M - 4.5)}L51 ${n(M + 3.5)}`;
  return stroke(d, mix(c.shade, '#000000', 0.1), 1.5, { opacity: 0.5 }) + stroke(d, mix(c.skin, '#f4c6b8', 0.45), 0.8);
}

/** A hood's dark inside, drawn before the head so the face sits in it. */
function headwearBack(t: PortraitTraits): string {
  return t.headwear === 'hood' ? shape(hoodOuter(t), mix(t.cloth.base, '#000000', 0.7)) : '';
}

/** Headwear and gear: hood, headscarf, beanie, goggles, visor or a comm headset. */
function headwear(t: PortraitTraits): string {
  const { top: T, eye: E, chin: C, hw, jw, jawY, hairline: hl } = t;
  const k = t.cloth;
  switch (t.headwear) {
    case 'hood': {
      const cloth = mix(k.base, '#ffffff', 0.06);
      const opening = sym([48, hl - 3.5], [
        [[48 + hw * 0.7, hl - 4], [48 + hw + 3.5, E - 12], [48 + hw + 3.2, E]],
        [[48 + hw + 3, jawY + 4], [48 + hw * 0.6, C + 8], [48, C + 10]],
      ]);
      // The hood's shadow across the brow, then the cloth with a rolled hem and a fold.
      return (
        shape(`M${n(48 - hw - 4)} ${n(hl - 5)}H${n(48 + hw + 4)}V${n(hl + 1.5)}Q48 ${n(hl + 6)} ${n(48 - hw - 4)} ${n(hl + 1.5)}Z`, '#000000', { opacity: 0.35 }) +
        shape(`${hoodOuter(t)}${opening}`, cloth, { 'fill-rule': 'evenodd' }) +
        stroke(opening, mix(cloth, '#ffffff', 0.2), 1.3, { opacity: 0.85 }) +
        stroke(`M${n(48 + hw + 6)} ${n(T + 2)}Q${n(48 + hw + 9)} ${n(E + 6)} ${n(48 + hw + 10)} 70M${n(48 - hw - 6)} ${n(T + 4)}Q${n(48 - hw - 8.5)} ${n(E + 4)} ${n(48 - hw - 9.5)} 66`, mix(cloth, '#000000', 0.35), 1.2, { opacity: 0.6 })
      );
    }
    case 'scarf': {
      const cloth = mix(k.trim, k.base, 0.35);
      const outer = sym([48, T - 3.4], [
        [[48 + hw * 0.7, T - 3.4], [48 + hw + 4, T + 4], [48 + hw + 4.2, E + 2]],
        [[48 + hw + 4.4, E + 18], [48 + hw + 7, BASE], [48 + hw + 13, BASE + 8]],
        [[48 + hw, BASE + 12], [56, BASE + 10], [48, BASE + 12]],
      ]);
      const opening = sym([48, hl - 1.2], [
        [[48 + hw * 0.7, hl - 1.2], [48 + hw - 0.4, E - 9], [48 + hw - 0.6, E]],
        [[48 + hw - 0.8, jawY + 1], [48 + jw + 1, C + 0.5], [48, C + 1.4]],
      ]);
      return shape(`${outer}${opening}`, cloth, { 'fill-rule': 'evenodd' }) + stroke(`M${n(48 - hw - 2)} ${n(E + 12)}Q42 ${n(C + 8)} 58 ${n(C + 12)}`, mix(cloth, '#000000', 0.3), 0.9, { opacity: 0.6 });
    }
    case 'beanie': {
      const knit = mix(k.trim, k.base, 0.3);
      const dark = mix(knit, '#000000', 0.3);
      const dome = sym([48, T - 7], [
        [[48 + hw * 0.78, T - 7.4], [48 + hw + 3.4, T + 1], [48 + hw + 2.6, hl + 1.4]],
        [[48, hl + 1.4]],
      ]);
      const cuff = `M${n(48 - hw - 3)} ${n(hl)}Q48 ${n(hl - 2.6)} ${n(48 + hw + 3)} ${n(hl)}L${n(48 + hw + 2.6)} ${n(hl + 5.6)}Q48 ${n(hl + 3.2)} ${n(48 - hw - 2.6)} ${n(hl + 5.6)}Z`;
      let ribs = '';
      for (let x = -hw; x <= hw; x += 2.6) ribs += `M${n(48 + x)} ${n(hl - 1 + (x * x) / 400)}v4.6`;
      return shape(dome, knit) + stroke(`M${n(48 - 4)} ${n(T - 5.8)}Q${n(48 + 2)} ${n(T - 2)} ${n(48 + 9)} ${n(T - 3.2)}`, dark, 0.7, { opacity: 0.5 }) + shape(cuff, mix(knit, '#000000', 0.12)) + stroke(ribs, dark, 0.6, { opacity: 0.45 });
    }
    case 'goggles': {
      const y = hl - 1.4;
      const lensAt = (x: number): string =>
        circle(x, y, 4, '#2c3038') + circle(x, y, 3, t.lens, { opacity: 0.75 }) + stroke(`M${n(x - 1.8)} ${n(y - 0.8)}Q${n(x - 1)} ${n(y - 2)} ${n(x + 0.6)} ${n(y - 2.2)}`, '#ffffff', 0.7, { opacity: 0.8 });
      return stroke(`M${n(48 - hw - 1.4)} ${n(y + 3)}Q48 ${n(y - 2.5)} ${n(48 + hw + 1.4)} ${n(y + 3)}`, '#24262c', 2.4) + lensAt(40.5) + lensAt(55.5) + el('rect', { x: 46, y: n(y - 0.9), width: 4, height: 1.8, fill: '#2c3038' });
    }
    case 'visor': {
      const y0 = E - 5;
      const d = `M${n(48 - hw - 1.2)} ${n(y0 + 1)}Q48 ${n(y0 - 2)} ${n(48 + hw + 1.2)} ${n(y0 + 1)}L${n(48 + hw + 1)} ${n(E + 3.4)}Q48 ${n(E + 5.2)} ${n(48 - hw - 1)} ${n(E + 3.4)}Z`;
      return shape(d, t.lens, { opacity: 0.55 }) + stroke(d, '#2a2e36', 1.2) + stroke(`M${n(48 - hw + 2)} ${n(y0 + 1.4)}Q48 ${n(y0 - 0.8)} ${n(48 + hw - 4)} ${n(y0 + 1)}`, '#ffffff', 0.8, { opacity: 0.55 });
    }
    case 'headset': {
      const dark = '#262c38';
      const cup = (side: number): string => el('rect', { x: n(48 + side * (hw + 1.6) - 2.6), y: n(E - 1), width: 5.2, height: 8.6, rx: 2.2, fill: dark });
      return (
        stroke(`M${n(48 - hw - 1.6)} ${n(E)}C${n(48 - hw - 1.6)} ${n(T - 12)} ${n(48 + hw + 1.6)} ${n(T - 12)} ${n(48 + hw + 1.6)} ${n(E)}`, dark, 1.6) +
        cup(-1) +
        cup(1) +
        circle(48 - hw - 1.6, E + 1.4, 0.7, RIM[t.faction]) +
        stroke(`M${n(48 - hw - 1)} ${n(E + 6)}Q${n(48 - hw + 1)} ${n(t.mouthY + 2.5)} ${n(48 - t.mouthW - 2.6)} ${n(t.mouthY + 0.8)}`, dark, 1.1) +
        ellipse(48 - t.mouthW - 2.8, t.mouthY + 0.8, 1.5, 1, '#1a1e28')
      );
    }
    default:
      return '';
  }
}

/** Glasses, an eyepatch or a cybernetic implant. */
function gear(t: PortraitTraits): string {
  const { eye: E, eyeGap: g, eyeW: w, hw, jw, jawY, chin: C } = t;
  let s = '';
  if (t.glasses) {
    const frame = t.faction === 'hollow-wake' ? '#3a3230' : '#1d2230';
    const lens = (x: number): string =>
      t.glasses === 'round'
        ? el('circle', { cx: n(x), cy: n(E + 0.2), r: w * 0.62, fill: '#dff2ff', 'fill-opacity': 0.1, stroke: frame, 'stroke-width': 0.8 })
        : el('rect', { x: n(x - w * 0.68), y: n(E - 2.6), width: n(w * 1.36), height: 5.4, rx: 1.2, fill: '#dff2ff', 'fill-opacity': 0.1, stroke: frame, 'stroke-width': 0.8 });
    s += lens(48 - g) + lens(48 + g);
    s += stroke(`M${n(48 - g + w * 0.62)} ${n(E - 0.4)}Q48 ${n(E - 1.6)} ${n(48 + g - w * 0.62)} ${n(E - 0.4)}M${n(48 - g - w * 0.66)} ${n(E - 0.6)}L${n(48 - hw)} ${n(E - 1.4)}M${n(48 + g + w * 0.66)} ${n(E - 0.6)}L${n(48 + hw)} ${n(E - 1.4)}`, frame, 0.8);
    s += stroke(`M${n(48 - g - 1.8)} ${n(E - 1)}l1.2 -1`, '#ffffff', 0.6, { opacity: 0.6 });
  }
  if (t.eyepatch) {
    s += stroke(`M${n(48 - hw)} ${n(E - 6)}L${n(48 + hw)} ${n(E - 9.5)}`, '#1a1412', 1);
    s += shape(`M${n(48 + g - 3.6)} ${n(E - 3.2)}Q${n(48 + g)} ${n(E - 4.6)} ${n(48 + g + 3.6)} ${n(E - 3.4)}L${n(48 + g + 3)} ${n(E + 2.4)}Q${n(48 + g)} ${n(E + 4.4)} ${n(48 + g - 3)} ${n(E + 2.4)}Z`, '#1d1715');
  }
  const glow = t.faction === 'hollow-wake' ? '#ff5a3a' : t.faction === 'frontier' ? '#7ee0a0' : t.faction === 'independent' ? '#d58cff' : '#5cc8ff';
  const metal = '#9aa6b4';
  const rivet = '#3a4250';
  switch (t.implant) {
    case 'eye':
      s += shape(`M${n(48 + g - 4.2)} ${n(E - 3.6)}L${n(48 + hw - 0.4)} ${n(E - 4.6)}L${n(48 + hw - 0.2)} ${n(E + 3.4)}L${n(48 + g - 2)} ${n(E + 4)}Z`, metal, { opacity: 0.9 });
      s += circle(48 + g, E, 3.3, '#2a3140') + circle(48 + g, E, 2.1, glow, { opacity: 0.85 }) + circle(48 + g, E, 0.8, '#ffffff', { opacity: 0.9 });
      s += circle(48 + hw - 1.6, E - 3.2, 0.45, rivet) + circle(48 + hw - 1.6, E + 2.2, 0.45, rivet);
      break;
    case 'temple':
      s += el('rect', { x: n(48 + hw - 5.2), y: n(E - 11), width: 4.6, height: 6.4, rx: 1, fill: metal, transform: `rotate(-8 ${n(48 + hw - 3)} ${n(E - 8)})` });
      s += circle(48 + hw - 3.4, E - 9.2, 0.6, glow) + circle(48 + hw - 3.2, E - 6.6, 0.6, glow, { opacity: 0.7 }) + stroke(`M${n(48 + hw - 5.4)} ${n(E - 4.4)}L${n(48 + hw - 8)} ${n(E - 1.5)}`, glow, 0.5, { opacity: 0.6 });
      break;
    case 'jaw':
      s += shape(`M${n(48 - hw + 0.4)} ${n(jawY - 6)}L${n(48 - hw + 5)} ${n(jawY - 5)}L${n(48 - jw + 5)} ${n(C - 3)}L${n(48 - jw + 1.5)} ${n(C - 4)}Z`, metal, { opacity: 0.9 });
      s += circle(48 - hw + 3, jawY - 4.4, 0.5, rivet) + circle(48 - jw + 3.4, C - 4.6, 0.5, rivet) + stroke(`M${n(48 - hw + 4.8)} ${n(jawY - 2)}l1.6 2`, glow, 0.6);
      break;
    default:
      break;
  }
  return s;
}

/** A data slate held up at the lower left, its screen lit. */
function slate(t: PortraitTraits, c: Tones): string {
  const science = t.role === 'scientist';
  const ink = science ? '#62e3a0' : '#5cc8ff';
  const content = science
    ? stroke('M-7 8L-4 5L-1.5 6.5L1.5 2L4.5 4L7.5 0', ink, 0.9) + el('rect', { x: -7.5, y: -0.6, width: 6, height: 1, fill: ink, opacity: 0.7 })
    : el('rect', { x: -7.5, y: -0.4, width: 8, height: 1.2, fill: ink }) +
      el('path', { d: 'M-7.5 2.8H5.5M-7.5 5H2.5', stroke: '#9be0ff', 'stroke-width': 0.8, opacity: 0.6 }) +
      el('rect', { x: 3.5, y: 7, width: 4, height: 2.4, fill: '#ffd84a', opacity: 0.85 });
  return el(
    'g',
    { transform: 'translate(20 81) rotate(9)' },
    el('rect', { x: -10.5, y: -3.4, width: 21, height: 17, rx: 1.8, fill: '#151c2a', stroke: '#3c4d6a', 'stroke-width': 0.7 }) +
      el('rect', { x: -9, y: -2, width: 18, height: 14, rx: 0.8, fill: science ? '#0f3a3a' : '#0f2f4a' }) +
      content +
      // The thumb of the hand holding it.
      el('rect', { x: -11.8, y: 1.2, width: 3, height: 6.6, rx: 1.5, fill: c.skin, transform: 'rotate(-12 -10.3 4.5)' }) +
      el('rect', { x: -10.6, y: 1.8, width: 1.6, height: 5.6, rx: 0.8, fill: c.shade, opacity: 0.6, transform: 'rotate(-12 -10.3 4.5)' }),
  );
}

/** Rim light down the shadow side: the jaw, the side of the neck and the shoulder (unless covered). */
function rim(t: PortraitTraits, c: Tones): string {
  if (t.headwear === 'scarf') return '';
  const [cheek, jaw, chin] = headRight(t);
  const torso = torsoRight(t);
  const neckBase = torso.segs[0]![torso.segs[0]!.length - 1]!;
  const trapezius = torso.segs[1] as readonly [P, P, P];
  const arm = torso.segs[2] as readonly [P, P, P];
  const hood = t.headwear === 'hood';
  const d =
    (hood ? '' : cubicPart(cheek[2], jaw, 0.4, 1) + cubicPart(jaw[2], chin, 0, 0.45).replace(/^M[^C]*/, '')) +
    `M${n(48 + t.neck + 0.5)} ${n(t.chin + 1)}L${n(48 + t.neck + 0.9)} ${n(BASE - 1)}` +
    (hood ? '' : cubicPart(neckBase, trapezius, 0.3, 1) + cubicPart(trapezius[2], arm, 0, 0.3).replace(/^M[^C]*/, ''));
  return stroke(d, c.rim, 0.9, { opacity: 0.55 });
}

/** Reusable shapes: vignette, face, torso, ear and eye, and the clips made from them. */
function defs(t: PortraitTraits, c: Tones, id: string): string {
  const [glow, mid, edge] = VIGNETTE[t.faction];
  const { eye: E, eyeGap: g, eyeW: w, eyeH: hgt, eyeTilt: tilt, hw } = t;
  const x = 48 - g;
  const eyeShape = `M${n(x - w / 2)} ${n(E - tilt)}C${n(x - w * 0.25)} ${n(E - hgt * 1.05)} ${n(x + w * 0.2)} ${n(E - hgt * 1.05)} ${n(x + w / 2)} ${n(E + 0.4)}C${n(x + w * 0.2)} ${n(E + hgt * 0.72)} ${n(x - w * 0.25)} ${n(E + hgt * 0.72)} ${n(x - w / 2)} ${n(E - tilt)}Z`;
  const ear = path([48 + hw - 1.2, E - 2.2], [
    [[48 + hw + 2.6, E - 5], [48 + hw + 4.4, E + 2], [48 + hw + 3, E + 6.6]],
    [[48 + hw + 2.2, E + 9.4], [48 + hw + 0.2, E + 10.6], [48 + hw - 1.2, E + 9.2]],
  ]);
  const earDetail = stroke(`M${n(48 + hw + 0.4)} ${n(E - 0.6)}C${n(48 + hw + 2.5)} ${n(E - 1.8)} ${n(48 + hw + 2.9)} ${n(E + 3.5)} ${n(48 + hw + 1.2)} ${n(E + 5.5)}`, c.deep, 0.8, { opacity: 0.45 });
  const torso = torsoRight(t);
  return el(
    'defs',
    {},
    el('radialGradient', { id: `${id}b`, cx: 48, cy: 42, r: 66, gradientUnits: 'userSpaceOnUse' }, el('stop', { offset: 0, 'stop-color': glow }) + el('stop', { offset: 0.55, 'stop-color': mid }) + el('stop', { offset: 1, 'stop-color': edge })) +
      el('path', { id: `${id}h`, d: sym([48, t.top], headRight(t)) }) +
      el('clipPath', { id: `${id}hc` }, use(`${id}h`)) +
      el('path', { id: `${id}t`, d: sym(torso.start, torso.segs) }) +
      el('clipPath', { id: `${id}tc` }, use(`${id}t`)) +
      el('path', { id: `${id}e`, d: eyeShape }) +
      el('clipPath', { id: `${id}ec` }, use(`${id}e`)) +
      el('g', { id: `${id}r` }, el('path', { d: ear }) + earDetail),
  );
}

/** The whole portrait, with ids starting `id`. */
function render(seed: number, look: PortraitLook, id: string): string {
  const t = portraitTraits(seed, look);
  const c = tonesFor(t);
  const r = (key: string): Rng => rng(seed, 'portrait', 'draw', key);
  const scarf = t.headwear === 'scarf';
  const figure = [
    headwearBack(t),
    scarf ? '' : hairBack(t, c, r('back')),
    scarf ? '' : neck(t, c),
    body(t, c, id, r('body')),
    scarf || t.headwear === 'hood' ? '' : ears(t, c, id),
    face(t, c, id, r('face')),
    eyes(t, c, id),
    nose(t, c),
    scar(t, c),
    beard(t),
    mouth(t, c),
    scarf ? '' : hairFront(t, c, r('front')),
    headwear(t),
    gear(t),
    rim(t, c),
    t.slate ? slate(t, c) : '',
  ].join('');
  const zoom = `matrix(${ZOOM} 0 0 ${ZOOM} ${n(48 * (1 - ZOOM))} ${n(ZOOM_Y * (1 - ZOOM))})`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96">${defs(t, c, id)}${background(t, id)}${el('g', { transform: zoom, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, figure)}</svg>`;
}

/**
 * The portrait as SVG markup. Ids inside are derived from the seed and look, so the same person
 * gives the same markup; to put several copies on one page, use portraitElement(), which gives
 * each copy its own ids.
 */
export function portraitSvg(seed: number, look: PortraitLook): string {
  return render(seed, look, `p${hashString(`${seed}|${look.faction}|${look.role}|${look.age ?? ''}`).toString(36).slice(0, 5)}`);
}

/** How a portrait is described to screen readers when no name is given. */
export function describeLook(look: PortraitLook): string {
  const age = look.age === 'old' ? 'an older ' : look.age === 'young' ? 'a young ' : '';
  const who = `${FACTION_NAMES[look.faction]} ${look.role}`;
  return `Portrait of ${age || (/^[aeiou]/i.test(who) ? 'an ' : 'a ')}${who}`;
}

export interface PortraitOptions {
  /** Accessible name, e.g. the person's name; defaults to a description of the look. */
  label?: string;
  /** 56, 72 (default) or 96 px at 100% text size. */
  size?: 'sm' | 'md' | 'lg';
  /** Extra classes on the frame. */
  class?: string;
}

let instances = 0;

/** A framed portrait: <span class="portrait" role="img"> around the SVG, its ids unique on the page. */
export function portraitElement(seed: number, look: PortraitLook, opts: PortraitOptions = {}): HTMLElement {
  const frame = h('span', {
    class: ['portrait frame frame-sm', `portrait-${opts.size ?? 'md'}`, opts.class].filter(Boolean).join(' '),
    role: 'img',
    'aria-label': opts.label ?? describeLook(look),
    dataset: { faction: look.faction },
  });
  instances += 1;
  // Generated markup only (numbers and fixed tags), never text from the save or the player.
  frame.innerHTML = render(seed, look, `q${instances.toString(36)}_`).replace('<svg ', '<svg aria-hidden="true" focusable="false" ');
  return frame;
}
