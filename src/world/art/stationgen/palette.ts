import * as THREE from 'three';
import type { Rng } from '../shipgen/palette.ts';
import type { StationOwner } from './types.ts';

/**
 * Paint for generated stations. The owner picks the family (Transit Authority white and blue,
 * Frontier sand, olive and teal, Hollow Wake soot and rust with red, independents mixed paint with
 * neon); the seed picks shades inside it. Colours are linear (three's working space); `glow*`,
 * `bayGlow` are HDR emissive colours.
 */
export interface StationPalette {
  hull: THREE.Color;
  /** Second paint for alternate modules. */
  hullAlt: THREE.Color;
  /** Plates, doors, inner faces. */
  panel: THREE.Color;
  /** Bold faction stripes and a second trim. */
  trim: THREE.Color;
  trimAlt: THREE.Color;
  /** Girders, trusses, bare machinery. */
  metal: THREE.Color;
  metalDark: THREE.Color;
  /** Dark bands, seams and end caps. */
  band: THREE.Color;
  /** Signage and accent strips (HDR). */
  glow: THREE.Color;
  glowAlt: THREE.Color;
  /** Floodlights and interior glow (sRGB hex, star-tinted). */
  lamp: string;
  /** Main beacon colour (sRGB hex). */
  beacon: string;
  /** Hazard stripe pair. */
  hazard: [THREE.Color, THREE.Color];
  tanks: THREE.Color[];
  cargo: THREE.Color[];
  /** Mismatched plating for patches, repairs and jury-rigged modules. */
  patches: THREE.Color[];
  /** Bay mouth outline (HDR). */
  bayGlow: THREE.Color;
  /** Tint for anchoring rocks. */
  rock: THREE.Color;
  /** Neon colours for signs and string lights (HDR). */
  neon: THREE.Color[];
}

const c = (hex: string, scale = 1): THREE.Color => new THREE.Color(hex).multiplyScalar(scale);
const list = (hexes: string[]): THREE.Color[] => hexes.map((h) => c(h));

const NEON = ['#ff3cc8', '#2ef0ff', '#b0ff3c', '#ffb23c', '#a46bff', '#ff4a6a'];

/** Every neon (HDR), for signage that ignores the owner's palette. */
export function allNeons(): THREE.Color[] {
  return NEON.map((h) => c(h, 2.2));
}

function base(owner: StationOwner, r: Rng): StationPalette {
  const neon = NEON.map((h) => c(h, 2.2));
  switch (owner) {
    case 'sta':
      return {
        hull: c(r.pick(['#e2e6ea', '#dde3e8', '#e6e8ea'])),
        hullAlt: c(r.pick(['#c9d0d7', '#ccd3d9'])),
        panel: c('#b3bcc6'),
        trim: c(r.pick(['#2f64c8', '#2a5cbc', '#3570d2'])),
        trimAlt: c('#7fb0e8'),
        metal: c('#8a929c'),
        metalDark: c('#3c424a'),
        band: c('#4a525c'),
        glow: c('#6fc8ff', 1.9),
        glowAlt: c('#d6ecff', 1.6),
        lamp: '#fff1dc',
        beacon: '#ff3a2a',
        hazard: [c('#e0a82e'), c('#23262a')],
        tanks: list(['#e8ecef', '#2f64c8', '#c8d0d8', '#e8ecef']),
        cargo: list(['#2f64c8', '#e4e8ec', '#7f8a96', '#3a7bd5', '#9fb3c8', '#c8d0d8']),
        patches: list(['#9aa4ae', '#c4b8a0', '#7f8a96', '#b0b8c0']),
        bayGlow: c('#bff0ff', 1.5),
        rock: c('#8a8178'),
        neon: [c('#6fc8ff', 2), c('#d6ecff', 1.8), ...neon.slice(1, 2)],
      };
    case 'frontier':
      return {
        hull: c(r.pick(['#c9b98f', '#cdbd92', '#c4b48a'])),
        hullAlt: c(r.pick(['#7d8a5c', '#76845a', '#3f6f78'])),
        panel: c('#b1a27a'),
        trim: c(r.pick(['#2f8a86', '#2a8078'])),
        trimAlt: c('#e0c341'),
        metal: c('#8c897a'),
        metalDark: c('#3e3c34'),
        band: c('#56523f'),
        glow: c('#8ff0e0', 1.9),
        glowAlt: c('#ffe08a', 1.6),
        lamp: '#ffe2b0',
        beacon: '#ff3a2a',
        hazard: [c('#e0c341'), c('#2a2a22')],
        tanks: list(['#c9b98f', '#7d8a5c', '#3f6f78', '#d8cfb4']),
        cargo: list(['#7d8a5c', '#3f6f78', '#c9b98f', '#b5562c', '#e0c341', '#8a7a5a']),
        patches: list(['#8a7a5a', '#6a7250', '#3f6f78', '#a08058']),
        bayGlow: c('#c8ffe8', 1.5),
        rock: c('#8c7a68'),
        neon: [c('#8ff0e0', 2), c('#ffe08a', 2), c('#b6ff8a', 2)],
      };
    case 'hollow-wake':
      return {
        hull: c(r.pick(['#4a423d', '#463e39', '#4e4540'])),
        hullAlt: c(r.pick(['#6c4230', '#744632', '#643e2e'])),
        panel: c('#5a4e46'),
        trim: c(r.pick(['#b8321f', '#c23a22'])),
        trimAlt: c('#e05a2a'),
        metal: c('#5e5650'),
        metalDark: c('#24201e'),
        band: c('#1e1a18'),
        glow: c('#ff4a2a', 2.1),
        glowAlt: c('#ff8a5c', 1.7),
        lamp: '#ffb080',
        beacon: '#ff2a1a',
        hazard: [c('#b8321f'), c('#1a1716')],
        tanks: list(['#4a3a32', '#6b3a2e', '#3a3431', '#7a4a30']),
        cargo: list(['#6b3a2e', '#4a403a', '#7a5a3a', '#3a3431', '#8a3020']),
        patches: list(['#6b3a2e', '#2a2624', '#7a6050', '#503020', '#5a5a52']),
        bayGlow: c('#ff6a4a', 1.8),
        rock: c('#5a524c'),
        neon: [c('#ff4a2a', 2.2), c('#ff8a5c', 2), c('#ffb23c', 2)],
      };
    case 'independent': {
      // Two different neons: the paint trim and the second accent.
      const i = r.int(0, NEON.length - 1);
      const trim = c(NEON[i]!);
      const trimAlt = c(NEON[(i + r.int(1, NEON.length - 1)) % NEON.length]!);
      return {
        hull: c(r.pick(['#b8b4aa', '#a4a8ac', '#c8c0b0', '#9ea69a'])),
        hullAlt: c(r.pick(['#c47a3c', '#3f7f86', '#5a6f8c', '#7a7f4a', '#8a4a4a', '#d8ccb0'])),
        panel: c('#8e9092'),
        trim,
        trimAlt,
        metal: c('#7c7a76'),
        metalDark: c('#34322f'),
        band: c('#3a3a3c'),
        glow: trim.clone().multiplyScalar(2.2),
        glowAlt: trimAlt.clone().multiplyScalar(2),
        lamp: '#ffe6c8',
        beacon: '#ff3a2a',
        hazard: [c('#ffb23c'), c('#23262a')],
        tanks: list(['#c47a3c', '#d8ccb0', '#5a6f8c', '#9ea69a', '#8a4a4a']),
        cargo: list(['#c47a3c', '#3f7f86', '#d8ccb0', '#8a4a4a', '#5a6f8c', '#e0c341', '#7a7f4a']),
        patches: list(['#c47a3c', '#3f7f86', '#5a6f8c', '#7a7f4a', '#8a4a4a', '#d8ccb0', '#6a6a70']),
        bayGlow: trim.clone().lerp(c('#ffffff'), 0.35).multiplyScalar(1.9),
        rock: c('#7d766f'),
        neon,
      };
    }
  }
}

/** Mismatched salvage paints any owner's patched-together modules may carry. */
export const SALVAGE: readonly THREE.Color[] = ['#b0683a', '#4f7d82', '#7a7f4a', '#d2c6a8', '#5a6f8c', '#8a4a44', '#9a9a92', '#c49a3a'].map((h) => c(h));

/** Palette for an owner, star-tinted lamps included. */
export function stationPalette(owner: StationOwner, r: Rng, starColor: string): StationPalette {
  const p = base(owner, r);
  // The local star colours floodlights a little (never enough to lose the owner's feel).
  p.lamp = `#${new THREE.Color(p.lamp).lerp(new THREE.Color(starColor), 0.22).getHexString()}`;
  return p;
}

const GRIME = c('#2e271f');
const RUST = c('#6e3f24');

/**
 * Per-piece paint: a small shade variation always, plus grime and rust with wear. Returns a new
 * colour.
 */
export function weathered(color: THREE.Color, r: Rng, wear: number, variation = 0.06): THREE.Color {
  const out = color.clone().multiplyScalar(1 - variation * r.next());
  if (wear > 0) {
    // Everything ages a little; some pieces a lot.
    const k = wear * (0.35 + 0.65 * r.next());
    out.multiplyScalar(1 - 0.36 * k);
    out.lerp(r.next() < 0.55 ? GRIME : RUST, 0.38 * k);
  }
  return out;
}
