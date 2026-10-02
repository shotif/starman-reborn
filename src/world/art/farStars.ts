import * as THREE from 'three';
import { OUTPUT_GLSL } from './noise.ts';
import { disposeObject, trackViewport, viewportUniform } from './util.ts';
import type { ArtContext, ArtObject } from './types.ts';

/**
 * Far stars beyond the map (docs/PROCGEN.md §25): points at the sky's distance in their true
 * direction, as bright as their apparent magnitude, drawn like the skybox's stars. A supernova
 * near its peak (magnitude −3 or brighter) also gets a halo, and a faint light that falls on the
 * ships from its side of the sky.
 */

export interface FarSkyStar {
  /** Unit direction in the scene. */
  dir: THREE.Vector3;
  /** Apparent magnitude (Infinity, or fainter than the naked eye: not drawn). */
  magnitude: number;
  colour: string;
}

export interface FarStarsArt extends ArtObject<THREE.Group> {
  /** Sets each star's direction, brightness and colour (in the order they were created). */
  set(stars: readonly FarSkyStar[]): void;
}

const SKY_DISTANCE = 840_000;
const NAKED_EYE = 6.5;

const VERT = /* glsl */ `
attribute vec3 aColor;
attribute float aSize;
attribute float aHalo;
uniform float uViewport;
varying vec3 vColor;
varying float vHalo;
void main() {
  float size = max(aSize * uViewport / 1000.0, 1.5);
  vColor = aColor;
  vHalo = aHalo;
  gl_PointSize = size;
  gl_Position = projectionMatrix * viewMatrix * vec4(cameraPosition + position, 1.0);
}
`;

const FRAG = /* glsl */ `
varying vec3 vColor;
varying float vHalo;
void main() {
  vec2 d = gl_PointCoord * 2.0 - 1.0;
  float r2 = dot(d, d);
  if (r2 > 1.0) discard;
  // A hard core, a soft glow, and for a supernova a wide halo with faint spikes.
  float core = exp(-r2 * 40.0);
  float glow = exp(-r2 * 6.0) * (1.0 - r2);
  float spikes = vHalo * 0.35 * (exp(-abs(d.x) * 40.0) + exp(-abs(d.y) * 40.0)) * (1.0 - r2);
  float a = core + glow * (0.45 + 0.4 * vHalo) + spikes;
  gl_FragColor = vec4(vColor * a, 1.0);
  ${OUTPUT_GLSL}
}
`;

/** Size (px at a 1000 px viewport), brightness (0–1) and halo (0–1) for an apparent magnitude. */
export function farStarStyle(magnitude: number): { size: number; brightness: number; halo: number } {
  if (!Number.isFinite(magnitude) || magnitude >= NAKED_EYE) return { size: 0, brightness: 0, halo: 0 };
  const brighter = Math.max(0, 1 - magnitude);
  return {
    size: Math.min(64, 4 + 4.2 * brighter),
    brightness: Math.min(1, Math.max(0.12, 10 ** (-0.4 * (magnitude - 2)))),
    halo: Math.min(1, Math.max(0, (-3 - magnitude) / 8)),
  };
}

export function createFarStars(count: number, _ctx: ArtContext): FarStarsArt {
  const group = new THREE.Group();
  group.name = 'far-stars';
  const geom = new THREE.BufferGeometry();
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const sizes = new Float32Array(count);
  const halos = new Float32Array(count);
  geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geom.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));
  geom.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
  geom.setAttribute('aHalo', new THREE.BufferAttribute(halos, 1));
  const points = new THREE.Points(
    geom,
    new THREE.ShaderMaterial({
      uniforms: { uViewport: viewportUniform },
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }),
  );
  // Over the skybox's stars, under everything near.
  points.renderOrder = -998;
  points.frustumCulled = false;
  trackViewport(points);
  group.add(points);

  // The supernova's light on the ships, from its side of the sky.
  const light = new THREE.DirectionalLight('#ffffff', 0);
  group.add(light, light.target);
  let lightDir: THREE.Vector3 | null = null;
  const camPos = new THREE.Vector3();
  const colour = new THREE.Color();

  return {
    object: group,
    set(stars) {
      let brightest = Infinity;
      lightDir = null;
      stars.slice(0, count).forEach((s, i) => {
        const style = farStarStyle(s.magnitude);
        positions.set([s.dir.x * SKY_DISTANCE, s.dir.y * SKY_DISTANCE, s.dir.z * SKY_DISTANCE], i * 3);
        colour.set(s.colour).multiplyScalar(style.brightness);
        colors.set([colour.r, colour.g, colour.b], i * 3);
        sizes[i] = style.size;
        halos[i] = style.halo;
        if (s.magnitude < brightest) {
          brightest = s.magnitude;
          lightDir = s.dir;
          light.color.set(s.colour);
        }
      });
      for (const name of ['position', 'aColor', 'aSize', 'aHalo']) geom.getAttribute(name).needsUpdate = true;
      // Only a supernova lights anything: magnitude −3 and brighter, never more than a faint fill.
      light.intensity = brightest < -3 ? Math.min(0.35, 0.03 * 10 ** (-0.4 * (brightest + 3))) : 0;
    },
    update(_dt, _time, camera) {
      camera.getWorldPosition(camPos);
      group.position.set(0, 0, 0);
      if (lightDir && light.intensity > 0) {
        light.position.copy(camPos).addScaledVector(lightDir, 1_000);
        light.target.position.copy(camPos);
      }
    },
    dispose() {
      disposeObject(group);
    },
  };
}
