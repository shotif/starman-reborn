import * as THREE from 'three';
import type { QualityLevel } from './types.ts';
import { panelTexture, radiatorTexture, solarTexture, windowTexture } from './textures.ts';
import { markShared } from './util.ts';

/**
 * Shared PBR materials for ships, stations and structures. Hull colour comes from vertex colours
 * (so one material covers every paint scheme) multiplied by a tileable plating texture. A faint
 * cool rim term keeps silhouettes readable on the unlit side, where only the hemisphere light
 * reaches. Cached per quality; never disposed.
 */

export const rimUniform = { value: new THREE.Color(0.03, 0.045, 0.07) };

function withRim<T extends THREE.MeshStandardMaterial>(m: T, strength = 1): T {
  const rimScale = { value: strength };
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uRimColor = rimUniform;
    shader.uniforms.uRimScale = rimScale;
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uRimColor;\nuniform float uRimScale;')
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        {
          float rimF = 1.0 - saturate(dot(normal, normalize(vViewPosition)));
          totalEmissiveRadiance += uRimColor * uRimScale * rimF * rimF * rimF;
        }`,
      );
  };
  m.customProgramCacheKey = () => 'art-rim';
  return m;
}

const cache = new Map<string, THREE.Material>();

function cached<T extends THREE.Material>(key: string, make: () => T): T {
  const hit = cache.get(key);
  if (hit) return hit as T;
  const m = markShared(make());
  cache.set(key, m);
  return m;
}

/** Painted hull plating (vertex-coloured). */
export function hullMaterial(q: QualityLevel): THREE.MeshStandardMaterial {
  return cached(`hull:${q}`, () =>
    withRim(new THREE.MeshStandardMaterial({ vertexColors: true, map: panelTexture(q), roughness: 0.7, metalness: 0.15 })),
  );
}

/** Bare metal: trusses, tanks, nozzles, greebles (vertex-coloured). */
export function metalMaterial(q: QualityLevel): THREE.MeshStandardMaterial {
  return cached(`metal:${q}`, () =>
    withRim(new THREE.MeshStandardMaterial({ vertexColors: true, map: panelTexture(q), roughness: 0.55, metalness: 0.45 })),
  );
}

/** Rough rock (anchoring asteroids, station foundations). */
export function rockMaterial(): THREE.MeshStandardMaterial {
  return cached('rock', () => withRim(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0.02, flatShading: true }), 0.6));
}

/** Tinted canopy / observation glass: glossy with a faint interior glow. */
export function glassMaterial(tint: 'cool' | 'red' | 'warm' = 'cool'): THREE.MeshStandardMaterial {
  const look = {
    cool: { color: 0x0d1a28, emissive: 0x0d3550 },
    red: { color: 0x1a0a0a, emissive: 0x4a0c08 },
    warm: { color: 0x1a140c, emissive: 0x4a3010 },
  }[tint];
  return cached(`glass:${tint}`, () =>
    withRim(
      new THREE.MeshStandardMaterial({ color: look.color, emissive: look.emissive, emissiveIntensity: 0.9, roughness: 0.12, metalness: 0.7 }),
      3,
    ),
  );
}

/** Unlit emissive surfaces; brightness (HDR) comes from vertex colours. */
export function emissiveMaterial(): THREE.MeshBasicMaterial {
  return cached('emissive', () => new THREE.MeshBasicMaterial({ vertexColors: true }));
}

/** Lit window bands (unlit material + window texture); polygon offset keeps decals in front. */
export function windowMaterial(q: QualityLevel): THREE.MeshBasicMaterial {
  return cached(`windows:${q}`, () =>
    new THREE.MeshBasicMaterial({
      map: windowTexture(q),
      color: new THREE.Color(1.6, 1.5, 1.4),
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -4,
    }),
  );
}

export function solarMaterial(q: QualityLevel): THREE.MeshStandardMaterial {
  return cached(`solar:${q}`, () =>
    withRim(new THREE.MeshStandardMaterial({ map: solarTexture(q), roughness: 0.46, metalness: 0.3, emissive: 0x040a1c }), 1.5),
  );
}

/** Radiator panels with a faint warm heat glow in the ribs (visible on the dark side). */
export function radiatorMaterial(q: QualityLevel): THREE.MeshStandardMaterial {
  return cached(`radiator:${q}`, () =>
    withRim(
      new THREE.MeshStandardMaterial({
        map: radiatorTexture(q),
        emissiveMap: radiatorTexture(q),
        emissive: new THREE.Color(0.22, 0.05, 0.015),
        roughness: 0.5,
        metalness: 0.15,
      }),
    ),
  );
}

/** Dark bay interiors and apertures. */
export function darkMaterial(): THREE.MeshStandardMaterial {
  return cached('dark', () => new THREE.MeshStandardMaterial({ color: 0x07090c, roughness: 0.9, metalness: 0.1 }));
}

/** Material set keyed the way the geometry kit names its parts. */
export function standardSet(q: QualityLevel): Record<string, THREE.Material> {
  return {
    hull: hullMaterial(q),
    metal: metalMaterial(q),
    rock: rockMaterial(),
    glass: glassMaterial('cool'),
    glassRed: glassMaterial('red'),
    glassWarm: glassMaterial('warm'),
    emissive: emissiveMaterial(),
    windows: windowMaterial(q),
    solar: solarMaterial(q),
    radiator: radiatorMaterial(q),
    dark: darkMaterial(),
  };
}
