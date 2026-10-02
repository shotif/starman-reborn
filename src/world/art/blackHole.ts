import * as THREE from 'three';
import { NOISE_GLSL, OUTPUT_GLSL, getNoiseVolume } from './noise.ts';
import { disposeObject } from './util.ts';
import type { ArtContext, ArtObject } from './types.ts';

/**
 * The black hole where Pyre was (docs/PROCGEN.md §26), drawn schematically at the scene's scale:
 * its shadow (black: nothing escapes it), the thin bright ring of light bent round it, and a disc
 * of the star's gas still falling back in, glowing while there is any (`setFallback`). A real
 * stellar black hole is a few tens of kilometres across; here it is drawn large enough to see.
 */

export interface BlackHoleArtOptions {
  /** Radius of the shadow, scene units. */
  shadow: number;
  /** The disc of infalling gas: inner and outer radius, scene units. */
  disc: readonly [number, number];
  /** Where its tides start to strain a hull: drawn as a faint dashed ring in the disc's plane. */
  zone?: number;
  seed?: number;
}

export interface BlackHoleArt extends ArtObject<THREE.Group> {
  /** How bright the infalling gas still glows, 0–1. */
  setFallback(k: number): void;
}

const DISC_VERT = /* glsl */ `
varying vec2 vPos;
void main() {
  vPos = position.xy;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const DISC_FRAG = /* glsl */ `
uniform float uTime;
uniform float uInner;
uniform float uOuter;
uniform float uGlow;
uniform vec3 uSeed;
varying vec2 vPos;
${NOISE_GLSL}
void main() {
  float r = length(vPos);
  float x = clamp((r - uInner) / (uOuter - uInner), 0.0, 1.0);
  // Gas goes round faster near the hole (roughly Keplerian), so the swirl winds up toward the centre.
  float angle = atan(vPos.y, vPos.x) + uTime * 0.6 / pow(max(r / uInner, 1.0), 1.5);
  float swirl = fbm(vec3(cos(angle) * 2.2, sin(angle) * 2.2, x * 5.0) + uSeed, 4);
  float bands = 0.55 + 0.45 * smoothstep(-0.25, 0.35, swirl);
  // Hotter (whiter) inside, redder outside; it fades at both edges.
  vec3 hot = vec3(1.0, 0.93, 0.8);
  vec3 cool = vec3(0.95, 0.36, 0.12);
  vec3 col = mix(hot, cool, smoothstep(0.0, 0.85, x));
  float edge = smoothstep(0.0, 0.08, x) * (1.0 - smoothstep(0.55, 1.0, x));
  float a = edge * bands * uGlow * (1.4 - x);
  gl_FragColor = vec4(col * a, 1.0);
  ${OUTPUT_GLSL}
}
`;

const RING_FRAG = /* glsl */ `
uniform float uTime;
uniform float uGlow;
varying vec2 vUv;
void main() {
  vec2 d = vUv * 2.0 - 1.0;
  float r = length(d);
  // The photon ring: a thin bright circle just outside the shadow, and a faint halo of bent light.
  float ring = exp(-pow((r - 0.5) / 0.018, 2.0));
  float halo = exp(-pow((r - 0.5) / 0.12, 2.0)) * 0.25;
  float flicker = 0.92 + 0.08 * sin(uTime * 3.1 + r * 40.0);
  vec3 col = vec3(1.0, 0.86, 0.7) * (ring * 1.6 + halo) * flicker * (0.35 + 0.65 * uGlow);
  gl_FragColor = vec4(col, 1.0);
  ${OUTPUT_GLSL}
}
`;

const RING_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export function createBlackHole(opts: BlackHoleArtOptions, ctx: ArtContext): BlackHoleArt {
  const group = new THREE.Group();
  group.name = 'black-hole';
  const seed = opts.seed ?? 7;

  // The shadow: black, and solid, so the sky behind it is hidden.
  const shadow = new THREE.Mesh(new THREE.SphereGeometry(opts.shadow, ctx.quality === 'low' ? 24 : 40, ctx.quality === 'low' ? 16 : 28), new THREE.MeshBasicMaterial({ color: 0x000000 }));
  shadow.name = 'shadow';
  group.add(shadow);

  // The photon ring: a billboard facing the camera, twice the shadow's size.
  const ringUniforms = { uTime: { value: 0 }, uGlow: { value: 1 } };
  const ring = new THREE.Mesh(
    new THREE.PlaneGeometry(opts.shadow * 2.2 * 2, opts.shadow * 2.2 * 2),
    new THREE.ShaderMaterial({ uniforms: ringUniforms, vertexShader: RING_VERT, fragmentShader: RING_FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }),
  );
  ring.name = 'photon-ring';
  ring.renderOrder = 12;
  group.add(ring);

  // The disc of infalling gas, a little tilted.
  const discUniforms = {
    uNoise: { value: getNoiseVolume() },
    uTime: { value: 0 },
    uInner: { value: opts.disc[0] },
    uOuter: { value: opts.disc[1] },
    uGlow: { value: 1 },
    uSeed: { value: new THREE.Vector3(seed * 1.7, seed * 0.3, seed * 2.9) },
  };
  const disc = new THREE.Mesh(
    new THREE.RingGeometry(opts.disc[0], opts.disc[1], ctx.quality === 'low' ? 64 : 128, 1),
    new THREE.ShaderMaterial({ uniforms: discUniforms, vertexShader: DISC_VERT, fragmentShader: DISC_FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, defines: { GRAN_OCT: 3 } }),
  );
  disc.name = 'fallback-disc';
  disc.rotation.set(-Math.PI / 2 + 0.32, 0, 0.18);
  disc.renderOrder = 11;
  group.add(disc);

  // The edge of the tidal zone, faint and dashed, in the same plane.
  if (opts.zone) {
    const points: THREE.Vector3[] = [];
    for (let i = 0; i <= 160; i++) {
      const a = (i / 160) * Math.PI * 2;
      points.push(new THREE.Vector3(Math.cos(a) * opts.zone, Math.sin(a) * opts.zone, 0));
    }
    const ring = new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), new THREE.LineDashedMaterial({ color: 0xff9a6a, dashSize: opts.zone * 0.035, gapSize: opts.zone * 0.025, transparent: true, opacity: 0.35, depthWrite: false }));
    ring.computeLineDistances();
    ring.name = 'tidal-zone';
    ring.rotation.copy(disc.rotation);
    group.add(ring);
  }

  const timeScale = ctx.reducedMotion ? 0.3 : 1;
  const camPos = new THREE.Vector3();
  return {
    object: group,
    setFallback(k) {
      const g = Math.min(1, Math.max(0, k));
      discUniforms.uGlow.value = g;
      ringUniforms.uGlow.value = g;
      disc.visible = g > 0.01;
    },
    update(_dt, time, camera) {
      ringUniforms.uTime.value = time * timeScale;
      discUniforms.uTime.value = time * timeScale;
      camera.getWorldPosition(camPos);
      ring.lookAt(camPos);
    },
    dispose() {
      disposeObject(group);
    },
  };
}
