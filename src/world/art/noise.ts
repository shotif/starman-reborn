import * as THREE from 'three';
import { markShared, seededRandom } from './util.ts';

/* ------------------------------------------------------------------------------------------------
 * CPU noise (geometry displacement, placement). Seeded 3D gradient noise, roughly in [-1, 1].
 * ---------------------------------------------------------------------------------------------- */

export type Noise3 = (x: number, y: number, z: number) => number;

function fade(t: number): number {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

export function createNoise3(seed: number): Noise3 {
  const rand = seededRandom(seed * 7919 + 17);
  const perm = new Uint8Array(512);
  const gx = new Float32Array(256);
  const gy = new Float32Array(256);
  const gz = new Float32Array(256);
  for (let i = 0; i < 256; i++) {
    perm[i] = i;
    // Uniform random unit vectors.
    const z = rand() * 2 - 1;
    const a = rand() * Math.PI * 2;
    const r = Math.sqrt(1 - z * z);
    gx[i] = Math.cos(a) * r;
    gy[i] = Math.sin(a) * r;
    gz[i] = z;
  }
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const t = perm[i]!;
    perm[i] = perm[j]!;
    perm[j] = t;
  }
  for (let i = 0; i < 256; i++) perm[i + 256] = perm[i]!;

  const grad = (h: number, x: number, y: number, z: number): number => gx[h]! * x + gy[h]! * y + gz[h]! * z;

  return (x, y, z) => {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const zi = Math.floor(z);
    const xf = x - xi;
    const yf = y - yi;
    const zf = z - zi;
    const X = xi & 255;
    const Y = yi & 255;
    const Z = zi & 255;
    const u = fade(xf);
    const v = fade(yf);
    const w = fade(zf);
    const A = perm[X]! + Y;
    const B = perm[X + 1]! + Y;
    const AA = perm[A]! + Z;
    const AB = perm[A + 1]! + Z;
    const BA = perm[B]! + Z;
    const BB = perm[B + 1]! + Z;
    const x1 = lerp(grad(perm[AA]!, xf, yf, zf), grad(perm[BA]!, xf - 1, yf, zf), u);
    const x2 = lerp(grad(perm[AB]!, xf, yf - 1, zf), grad(perm[BB]!, xf - 1, yf - 1, zf), u);
    const x3 = lerp(grad(perm[AA + 1]!, xf, yf, zf - 1), grad(perm[BA + 1]!, xf - 1, yf, zf - 1), u);
    const x4 = lerp(grad(perm[AB + 1]!, xf, yf - 1, zf - 1), grad(perm[BB + 1]!, xf - 1, yf - 1, zf - 1), u);
    return lerp(lerp(x1, x2, v), lerp(x3, x4, v), w) * 1.6;
  };
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function fbm3(noise: Noise3, x: number, y: number, z: number, octaves: number): number {
  let sum = 0;
  let amp = 0.5;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += amp * noise(x, y, z);
    norm += amp;
    // Rotate-ish shuffle between octaves hides lattice alignment.
    const nx = y * 1.71 + z * 0.62 + 3.1;
    const ny = z * 1.63 - x * 0.74 - 1.7;
    const nz = x * 1.58 + y * 0.81 + 5.3;
    x = nx;
    y = ny;
    z = nz;
    amp *= 0.5;
  }
  return sum / norm;
}

/* ------------------------------------------------------------------------------------------------
 * GPU noise volume: 64^3 RGBA8, periodic over 8 lattice cells. R = smooth gradient noise, GBA = its
 * analytic gradient, so shaders get fbm *and* bump normals from one trilinear fetch per octave.
 * Shared by planets, stars, skybox, dust and effects; created once and never disposed.
 * ---------------------------------------------------------------------------------------------- */

const VOL = 64;
const PERIOD = 8;
const VALUE_RANGE = 0.9;
const GRAD_RANGE = 3.0;

let noiseVolume: THREE.Data3DTexture | null = null;

export function getNoiseVolume(): THREE.Data3DTexture {
  if (noiseVolume) return noiseVolume;
  const rand = seededRandom(0x5eed_a11);
  const n = PERIOD * PERIOD * PERIOD;
  const g = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const z = rand() * 2 - 1;
    const a = rand() * Math.PI * 2;
    const r = Math.sqrt(1 - z * z);
    g[i * 3] = Math.cos(a) * r;
    g[i * 3 + 1] = Math.sin(a) * r;
    g[i * 3 + 2] = z;
  }
  const data = new Uint8Array(VOL * VOL * VOL * 4);
  const cellTexels = VOL / PERIOD;
  const idx = (i: number, j: number, k: number): number =>
    (((i & (PERIOD - 1)) * PERIOD + (j & (PERIOD - 1))) * PERIOD + (k & (PERIOD - 1))) * 3;
  // Corner gradients/values reused per texel.
  const cg = new Float32Array(24);
  const cv = new Float32Array(8);
  let o = 0;
  for (let tz = 0; tz < VOL; tz++) {
    const pz = (tz + 0.5) / cellTexels;
    const kz = Math.floor(pz);
    const fz = pz - kz;
    for (let ty = 0; ty < VOL; ty++) {
      const py = (ty + 0.5) / cellTexels;
      const ky = Math.floor(py);
      const fy = py - ky;
      for (let tx = 0; tx < VOL; tx++) {
        const px = (tx + 0.5) / cellTexels;
        const kx = Math.floor(px);
        const fx = px - kx;
        // Corners a..h = (0,0,0) (1,0,0) (0,1,0) (1,1,0) (0,0,1) (1,0,1) (0,1,1) (1,1,1)
        for (let c = 0; c < 8; c++) {
          const ox = c & 1;
          const oy = (c >> 1) & 1;
          const oz = (c >> 2) & 1;
          const gi = idx(kx + ox, ky + oy, kz + oz);
          const gx = g[gi]!;
          const gy = g[gi + 1]!;
          const gz = g[gi + 2]!;
          cg[c * 3] = gx;
          cg[c * 3 + 1] = gy;
          cg[c * 3 + 2] = gz;
          cv[c] = gx * (fx - ox) + gy * (fy - oy) + gz * (fz - oz);
        }
        const ux = fade(fx);
        const uy = fade(fy);
        const uz = fade(fz);
        const dux = 30 * fx * fx * (fx * (fx - 2) + 1);
        const duy = 30 * fy * fy * (fy * (fy - 2) + 1);
        const duz = 30 * fz * fz * (fz * (fz - 2) + 1);
        const va = cv[0]!, vb = cv[1]!, vc = cv[2]!, vd = cv[3]!;
        const ve = cv[4]!, vf = cv[5]!, vg = cv[6]!, vh = cv[7]!;
        const k1 = vb - va;
        const k2 = vc - va;
        const k3 = ve - va;
        const k4 = va - vb - vc + vd;
        const k5 = va - vc - ve + vg;
        const k6 = va - vb - ve + vf;
        const k7 = -va + vb + vc - vd + ve - vf - vg + vh;
        const value = va + k1 * ux + k2 * uy + k3 * uz + k4 * ux * uy + k5 * uy * uz + k6 * uz * ux + k7 * ux * uy * uz;
        const d = [0, 0, 0];
        for (let a = 0; a < 3; a++) {
          const ga = cg[a]!, gb = cg[3 + a]!, gc = cg[6 + a]!, gd = cg[9 + a]!;
          const ge = cg[12 + a]!, gf = cg[15 + a]!, gg = cg[18 + a]!, gh = cg[21 + a]!;
          d[a] =
            ga +
            ux * (gb - ga) +
            uy * (gc - ga) +
            uz * (ge - ga) +
            ux * uy * (ga - gb - gc + gd) +
            uy * uz * (ga - gc - ge + gg) +
            uz * ux * (ga - gb - ge + gf) +
            ux * uy * uz * (-ga + gb + gc - gd + ge - gf - gg + gh);
        }
        d[0]! += dux * (k1 + k4 * uy + k6 * uz + k7 * uy * uz);
        d[1]! += duy * (k2 + k4 * ux + k5 * uz + k7 * ux * uz);
        d[2]! += duz * (k3 + k5 * uy + k6 * ux + k7 * ux * uy);
        data[o++] = enc(value / VALUE_RANGE);
        data[o++] = enc(d[0]! / GRAD_RANGE);
        data[o++] = enc(d[1]! / GRAD_RANGE);
        data[o++] = enc(d[2]! / GRAD_RANGE);
      }
    }
  }
  const tex = new THREE.Data3DTexture(data, VOL, VOL, VOL);
  tex.format = THREE.RGBAFormat;
  tex.type = THREE.UnsignedByteType;
  tex.wrapS = tex.wrapT = tex.wrapR = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.unpackAlignment = 1;
  tex.needsUpdate = true;
  noiseVolume = markShared(tex);
  return tex;
}

function enc(v: number): number {
  const c = Math.round((v * 0.5 + 0.5) * 255);
  return c < 0 ? 0 : c > 255 ? 255 : c;
}

/**
 * GLSL helpers for the noise volume. Coordinates are in lattice units (one feature ~ 1 unit).
 * Declares `uniform sampler3D uNoise`.
 */
export const NOISE_GLSL = /* glsl */ `
uniform sampler3D uNoise;
const mat3 OCT_ROT = mat3(0.6193, 0.5232, -0.5854, -0.3225, 0.8493, 0.4179, 0.7158, -0.0700, 0.6948);
const mat3 OCT_ROT_T = mat3(0.6193, -0.3225, 0.7158, 0.5232, 0.8493, -0.0700, -0.5854, 0.4179, 0.6948);
float snoise(vec3 p) {
  return texture(uNoise, p * ${(1 / PERIOD).toFixed(4)}).x * ${(VALUE_RANGE * 2).toFixed(2)} - ${VALUE_RANGE.toFixed(2)};
}
float snoiseLod(vec3 p) {
  return textureLod(uNoise, p * ${(1 / PERIOD).toFixed(4)}, 0.0).x * ${(VALUE_RANGE * 2).toFixed(2)} - ${VALUE_RANGE.toFixed(2)};
}
vec4 snoiseD(vec3 p) {
  vec4 t = texture(uNoise, p * ${(1 / PERIOD).toFixed(4)});
  return vec4(t.x * ${(VALUE_RANGE * 2).toFixed(2)} - ${VALUE_RANGE.toFixed(2)}, (t.yzw * 2.0 - 1.0) * ${GRAD_RANGE.toFixed(1)});
}
float fbm(vec3 p, int octaves) {
  float s = 0.0;
  float a = 0.5;
  for (int i = 0; i < 8; i++) {
    if (i >= octaves) break;
    s += a * snoise(p);
    p = OCT_ROT * p * 2.03;
    a *= 0.5;
  }
  return s;
}
float fbmLod(vec3 p, int octaves) {
  float s = 0.0;
  float a = 0.5;
  for (int i = 0; i < 8; i++) {
    if (i >= octaves) break;
    s += a * snoiseLod(p);
    p = OCT_ROT * p * 2.03;
    a *= 0.5;
  }
  return s;
}
// fbm value (x) plus its gradient with respect to p (yzw), for bump mapping.
vec4 fbmD(vec3 p, int octaves) {
  vec4 s = vec4(0.0);
  float a = 0.5;
  mat3 mT = mat3(1.0);
  for (int i = 0; i < 8; i++) {
    if (i >= octaves) break;
    vec4 n = snoiseD(p);
    s.x += a * n.x;
    s.yzw += a * (mT * n.yzw);
    p = OCT_ROT * p * 2.03;
    mT = mT * OCT_ROT_T * 2.03;
    a *= 0.5;
  }
  return s;
}
// Ridged variant: sharp creases, good for cloud fronts and lava cracks.
float ridged(vec3 p, int octaves) {
  float s = 0.0;
  float a = 0.5;
  for (int i = 0; i < 8; i++) {
    if (i >= octaves) break;
    float n = 1.0 - abs(snoise(p) * 1.6);
    s += a * n * n;
    p = OCT_ROT * p * 2.03;
    a *= 0.5;
  }
  return s;
}
float hash13(vec3 p) {
  p = fract(p * vec3(0.1031, 0.1030, 0.0973));
  p += dot(p, p.yzx + 33.33);
  return fract((p.x + p.y) * p.z);
}
vec3 hash33(vec3 p) {
  p = fract(p * vec3(0.1031, 0.1030, 0.0973));
  p += dot(p, p.yxz + 33.33);
  return fract((p.xxy + p.yxx) * p.zyx);
}
`;

/** Standard tail for custom fragment shaders so they match the renderer's tone mapping/output. */
export const OUTPUT_GLSL = /* glsl */ `
#include <tonemapping_fragment>
#include <colorspace_fragment>
`;
