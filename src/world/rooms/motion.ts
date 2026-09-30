import type * as THREE from 'three';
import type { PartOptions, V3 } from '../art/kit.ts';
import { rimUniform } from '../art/materials.ts';

/**
 * Vertex-shader animation for merged meshes. Every part carries up to two motions (B is applied
 * first, then A, so B can hang off A like a head on a swaying torso); the room builder streams the
 * motion channels next to the geometry. Parts of many animated props share one mesh per material,
 * so a whole room of idle motion costs a few draw calls and no per-frame CPU work beyond one time
 * uniform.
 */

export const MOTION = {
  none: 0,
  /** Continuous turn about +Y (turntables, fans, radar heads). */
  spin: 1,
  /** amp·sin about Y. */
  swingY: 2,
  swingX: 3,
  swingZ: 4,
  /** Vertical bob. */
  bob: 5,
  /** Idle body sway with breathing (people). */
  sway: 6,
  slideX: 7,
  slideZ: 8,
  /** Bob plus a slow yaw wobble (hovering drones). */
  hover: 9,
  /** Look around with holds (heads). */
  look: 10,
  /** Continuous travel along Z that wraps every `amp` metres (conveyor belts); `speed` in m/s. */
  conveyZ: 11,
} as const;
export type MotionType = (typeof MOTION)[keyof typeof MOTION];

export interface Motion {
  type: MotionType;
  pivot: V3;
  /** Angular rate (rad/s) or oscillation rate. */
  speed: number;
  amp?: number;
  phase?: number;
}

export interface MotionPartOptions extends PartOptions {
  /** Applied after the local transform (e.g. a person's placement). Pivots go through it too. */
  matrix?: THREE.Matrix4;
  a?: Motion;
  b?: Motion;
}

export interface MotionUniforms {
  uMotionTime: { value: number };
  uMotionScale: { value: number };
}

const MOTION_GLSL = /* glsl */ `
attribute vec3 aPivotA;
attribute vec4 aMotionA;
attribute vec3 aPivotB;
attribute vec4 aMotionB;
uniform float uMotionTime;
uniform float uMotionScale;
mat3 mRotY(float a) { float c = cos(a); float s = sin(a); return mat3(c, 0.0, -s, 0.0, 1.0, 0.0, s, 0.0, c); }
mat3 mRotX(float a) { float c = cos(a); float s = sin(a); return mat3(1.0, 0.0, 0.0, 0.0, c, s, 0.0, -s, c); }
mat3 mRotZ(float a) { float c = cos(a); float s = sin(a); return mat3(c, s, 0.0, -s, c, 0.0, 0.0, 0.0, 1.0); }
float mHash(float n) { return fract(sin(n * 12.9898) * 43758.5453); }
void motionEval(vec4 m, out mat3 R, out vec3 T, out float breath) {
  R = mat3(1.0);
  T = vec3(0.0);
  breath = 0.0;
  float type = m.x;
  if (type < 0.5) return;
  float t = uMotionTime;
  float w = m.y;
  float amp = m.z * uMotionScale;
  float ph = m.w;
  if (type < 1.5) {
    R = mRotY(t * w * mix(0.4, 1.0, uMotionScale) + ph);
  } else if (type < 2.5) {
    R = mRotY(amp * sin(t * w + ph));
  } else if (type < 3.5) {
    R = mRotX(amp * sin(t * w + ph));
  } else if (type < 4.5) {
    R = mRotZ(amp * sin(t * w + ph));
  } else if (type < 5.5) {
    T.y = amp * sin(t * w + ph);
  } else if (type < 6.5) {
    float s1 = sin(t * w * 0.23 + ph * 3.1) + 0.4 * sin(t * w * 0.61 + ph);
    float s2 = sin(t * w * 0.17 + ph * 1.7);
    R = mRotX(amp * 0.6 * s1) * mRotZ(amp * 0.45 * s2);
    breath = sin(t * w + ph) * uMotionScale;
  } else if (type < 7.5) {
    T.x = amp * sin(t * w + ph);
  } else if (type < 8.5) {
    T.z = amp * sin(t * w + ph);
  } else if (type < 9.5) {
    T.y = amp * sin(t * w + ph);
    R = mRotY(0.22 * uMotionScale * sin(t * w * 0.31 + ph * 2.0));
  } else if (type > 10.5) {
    float len = max(m.z, 0.01);
    T.z = mod(t * w * mix(0.35, 1.0, uMotionScale) + ph, len) - 0.5 * len;
  } else {
    float u = t * w + ph;
    float k = floor(u);
    float f = smoothstep(0.62, 1.0, fract(u));
    float a0 = mHash(k + ph * 7.31) * 2.0 - 1.0;
    float a1 = mHash(k + 1.0 + ph * 7.31) * 2.0 - 1.0;
    float nod = 0.12 * sin(t * 0.7 + ph * 5.0);
    R = mRotY(amp * mix(a0, a1, f)) * mRotX(nod * amp);
  }
}
vec3 motionApply(vec3 p, vec3 pivot, vec4 m) {
  mat3 R;
  vec3 T;
  float breath;
  motionEval(m, R, T, breath);
  vec3 q = R * (p - pivot);
  q.y *= 1.0 + 0.014 * breath;
  q.xz *= 1.0 + 0.008 * breath * step(0.0, q.y);
  return q + pivot + T;
}
vec3 motionPosition(vec3 p) {
  return motionApply(motionApply(p, aPivotB, aMotionB), aPivotA, aMotionA);
}
vec3 motionNormal(vec3 n) {
  mat3 R;
  vec3 T;
  float breath;
  motionEval(aMotionB, R, T, breath);
  n = R * n;
  motionEval(aMotionA, R, T, breath);
  return R * n;
}
`;

/**
 * Patches a material with the motion vertex code (and, for lit materials, the same faint cool rim
 * term the shared art materials use, so animated props match static ones).
 */
export function withMotion<T extends THREE.Material>(material: T, uniforms: MotionUniforms, rim = true, rimStrength = 1): T {
  const rimScale = { value: rimStrength };
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uMotionTime = uniforms.uMotionTime;
    shader.uniforms.uMotionScale = uniforms.uMotionScale;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${MOTION_GLSL}`)
      .replace('#include <beginnormal_vertex>', 'vec3 objectNormal = motionNormal(vec3(normal));\n#ifdef USE_TANGENT\nvec3 objectTangent = vec3(tangent.xyz);\n#endif')
      .replace('#include <begin_vertex>', 'vec3 transformed = motionPosition(vec3(position));');
    if (rim && shader.fragmentShader.includes('#include <emissivemap_fragment>')) {
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
    }
  };
  material.customProgramCacheKey = () => (rim ? 'room-motion-rim' : 'room-motion');
  return material;
}
