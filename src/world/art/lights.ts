import * as THREE from 'three';
import type { ArtContext } from './types.ts';
import { OUTPUT_GLSL } from './noise.ts';
import { trackViewport, viewportUniform } from './util.ts';

/**
 * Additive glow points for navigation lights, beacons, emitters and nozzle glows. One draw call
 * per set; blinking is evaluated in the vertex shader from `uTime`. With reduced motion every
 * blink becomes a slow, shallow pulse (no strobing).
 */

export interface LightSpec {
  p: [number, number, number];
  color: THREE.ColorRepresentation;
  /** World-space diameter of the glow. */
  size: number;
  intensity?: number;
  /** Blink rate in Hz (0 = steady). */
  blink?: number;
  /** 0..1 phase offset (chase sequences). */
  phase?: number;
  /** Fraction of the cycle the light is on. */
  duty?: number;
  /** Brightness while "off". */
  min?: number;
}

export interface LightPoints {
  readonly points: THREE.Points;
  readonly uniforms: {
    uTime: { value: number };
    uIntensity: { value: number };
    uSize: { value: number };
  };
}

const VERT = /* glsl */ `
attribute vec3 aColor;
attribute vec4 aParams;
attribute vec2 aDuty;
uniform float uTime;
uniform float uIntensity;
uniform float uSize;
uniform float uViewport;
uniform float uCalm;
uniform float uMinPx;
varying vec3 vColor;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  // World-size glow that follows the object's scale (e.g. a cargo pod scaled up as a drone).
  float sc = length(modelMatrix[0].xyz);
  float px = aParams.x * sc * uSize * uViewport * projectionMatrix[1][1] * 0.5 / max(-mv.z, 1e-3);
  float level = 1.0;
  if (aParams.z > 0.0) {
    float ph = fract(uTime * aParams.z + aParams.w);
    float on = smoothstep(0.0, 0.04, ph) * (1.0 - smoothstep(aDuty.x, aDuty.x + 0.06, ph));
    float calm = 0.5 + 0.5 * cos(6.2831853 * (uTime * min(aParams.z, 0.35) + aParams.w));
    level = mix(mix(aDuty.y, 1.0, on), mix(max(aDuty.y, 0.45), 1.0, calm), uCalm);
  }
  float minPx = uMinPx * uViewport / 1080.0;
  float size = clamp(px, minPx, 320.0);
  // Far away the sprite stops shrinking; fade it instead so distant lights become faint points.
  float dim = clamp(px / minPx, 0.25, 1.0);
  vColor = aColor * aParams.y * uIntensity * level * dim;
  gl_PointSize = size;
  gl_Position = projectionMatrix * mv;
}
`;

const FRAG = /* glsl */ `
varying vec3 vColor;
void main() {
  vec2 d = gl_PointCoord * 2.0 - 1.0;
  float r2 = dot(d, d);
  if (r2 > 1.0) discard;
  float core = exp(-r2 * 22.0);
  float halo = exp(-r2 * 5.0) * (1.0 - r2);
  vec3 c = vColor * (core * 1.6 + halo * 0.5) + vec3(dot(vColor, vec3(0.33))) * core * 0.6;
  gl_FragColor = vec4(c, 1.0);
  ${OUTPUT_GLSL}
}
`;

export function createLightPoints(specs: LightSpec[], ctx: ArtContext, minPx = 2.5): LightPoints {
  const n = specs.length;
  const pos = new Float32Array(n * 3);
  const col = new Float32Array(n * 3);
  const params = new Float32Array(n * 4);
  const duty = new Float32Array(n * 2);
  const c = new THREE.Color();
  specs.forEach((s, i) => {
    pos.set(s.p, i * 3);
    c.set(s.color);
    col[i * 3] = c.r;
    col[i * 3 + 1] = c.g;
    col[i * 3 + 2] = c.b;
    params[i * 4] = s.size;
    params[i * 4 + 1] = s.intensity ?? 1;
    params[i * 4 + 2] = s.blink ?? 0;
    params[i * 4 + 3] = s.phase ?? 0;
    duty[i * 2] = s.duty ?? 0.12;
    duty[i * 2 + 1] = s.min ?? 0;
  });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
  geo.setAttribute('aParams', new THREE.BufferAttribute(params, 4));
  geo.setAttribute('aDuty', new THREE.BufferAttribute(duty, 2));
  geo.computeBoundingSphere();
  if (geo.boundingSphere) geo.boundingSphere.radius += 2;
  const uniforms = {
    uTime: { value: 0 },
    uIntensity: { value: 1 },
    uSize: { value: 1 },
    uViewport: viewportUniform,
    uCalm: { value: ctx.reducedMotion ? 1 : 0 },
    uMinPx: { value: minPx },
  };
  const points = new THREE.Points(
    geo,
    new THREE.ShaderMaterial({
      uniforms,
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }),
  );
  points.name = 'lights';
  points.renderOrder = 5;
  trackViewport(points);
  return { points, uniforms };
}
