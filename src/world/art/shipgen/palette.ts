import * as THREE from 'three';
import type { ShipStyle } from '../../../content/types.ts';
import { seededRandom } from '../util.ts';

/**
 * Seeded streams and paint for generated ships. Every detail decision draws from a stream keyed by
 * the model id and what the decision is for, so adding a detail never shifts the others and the
 * same id builds the same ship on every device.
 */

/** FNV-1a (32-bit) hash of a string. */
export function hashText(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export interface Rng {
  /** Uniform in [0, 1). */
  next(): number;
  /** Uniform in [min, max). */
  range(min: number, max: number): number;
  /** Integer in [min, max]. */
  int(min: number, max: number): number;
  chance(p: number): boolean;
  pick<T>(items: readonly T[]): T;
}

/** Independent stream for one aspect ("hull", "greebles", ...) of one model. */
export function rngFor(id: string, aspect: string): Rng {
  const next = seededRandom(hashText(`${id}#${aspect}`));
  return {
    next,
    range: (min, max) => min + next() * (max - min),
    int: (min, max) => min + Math.floor(next() * (max - min + 1)),
    chance: (p) => next() < p,
    pick: (items) => items[Math.min(items.length - 1, Math.floor(next() * items.length))]!,
  };
}

export type GlassKey = 'glass' | 'glassRed' | 'glassWarm';

export interface ShipPalette {
  hull: THREE.Color;
  hullLight: THREE.Color;
  hullDark: THREE.Color;
  panel: THREE.Color;
  panelDark: THREE.Color;
  accent: THREE.Color;
  /** Dark seams, intakes, end caps. */
  trim: THREE.Color;
  /** Engine housings, barrels, struts. */
  metal: THREE.Color;
  metalDark: THREE.Color;
  /** Near-black openings (intakes, launcher tubes). */
  hole: THREE.Color;
  /** Engine glow (HDR emissive). */
  glow: THREE.Color;
  /** Running light strips (HDR emissive). */
  strip: THREE.Color;
  /** Canopy tint, matched to the maker's trim. */
  glass: GlassKey;
  /** Mismatched plating for spliced salvage hulls. */
  salvage: readonly THREE.Color[];
}

const hsl = { h: 0, s: 0, l: 0 };

function glassFor(accent: THREE.Color): GlassKey {
  accent.getHSL(hsl, THREE.SRGBColorSpace);
  if (hsl.s < 0.35) return 'glass';
  if (hsl.h < 0.04 || hsl.h > 0.95) return 'glassRed';
  if (hsl.h < 0.17) return 'glassWarm';
  return 'glass';
}

export function shipPalette(style: ShipStyle): ShipPalette {
  const c = (hex: string): THREE.Color => new THREE.Color(hex);
  const p = style.palette;
  const hull = c(p.hull);
  const panel = c(p.panel);
  const accent = c(p.accent);
  const glow = c(p.glow);
  accent.getHSL(hsl, THREE.SRGBColorSpace);
  // Saturated accents make good light strips; pale ones fall back to the engine glow.
  const strip = (hsl.s > 0.45 && hsl.l > 0.3 ? accent.clone() : glow.clone()).multiplyScalar(2.2);
  return {
    hull,
    hullLight: hull.clone().lerp(c('#ffffff'), 0.2),
    hullDark: hull.clone().multiplyScalar(0.62),
    panel,
    panelDark: panel.clone().multiplyScalar(0.66),
    accent,
    trim: hull.clone().lerp(c('#121418'), 0.78),
    metal: c('#747a82').lerp(hull, 0.18),
    metalDark: c('#33373d').lerp(hull, 0.1),
    hole: c('#07080a'),
    glow: glow.clone().multiplyScalar(2.2),
    strip,
    glass: glassFor(accent),
    salvage: [hull, panel, c('#4c525a'), c('#6a6450'), c('#3b474c'), c('#5a4038')],
  };
}
