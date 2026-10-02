import * as THREE from 'three';
import type { ArtContext, ArtObject } from './types.ts';
import { NOISE_GLSL, OUTPUT_GLSL, getNoiseVolume } from './noise.ts';
import { byQuality, disposeObject, seededRandom } from './util.ts';

export type StarKind = 'main-sequence' | 'red-dwarf' | 'white-dwarf' | 'supergiant';

export interface StarArtOptions {
  /** Radius of the visible photosphere in game units (schematic). */
  radius: number;
  /** Display colour (artistic, inspired by spectral type). */
  color: THREE.ColorRepresentation;
  kind?: StarKind;
  /** 0..1 surface activity (granulation contrast, flare spots on red dwarfs). */
  activity?: number;
  /** Multiplier for the size of the glow halo relative to the radius. */
  glowScale?: number;
  /** Brightness multiplier for glow sprites. */
  intensity?: number;
  seed?: number;
}

export interface StarArt extends ArtObject {
  readonly radius: number;
}

const PHOTOSPHERE_VERT = /* glsl */ `
varying vec3 vObj;
varying vec3 vN;
varying vec3 vV;
void main() {
  vObj = normalize(position);
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vN = normalize(mat3(modelMatrix) * normal);
  vV = cameraPosition - wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const PHOTOSPHERE_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform vec3 uLimbColor;
uniform float uTime;
uniform float uActivity;
uniform float uBright;
uniform float uSpots;
uniform float uGranFreq;
uniform vec3 uSeed;
uniform vec4 uFlare;
varying vec3 vObj;
varying vec3 vN;
varying vec3 vV;
${NOISE_GLSL}
void main() {
  vec3 N = normalize(vN);
  vec3 V = normalize(vV);
  float mu = clamp(dot(N, V), 0.0, 1.0);
  vec3 p = vObj;
  float t = uTime;
  // Convective granulation, gently churning via a slow domain warp.
  vec3 q = p * uGranFreq + uSeed;
  float warp = snoise(q * 0.35 + vec3(0.0, t * 0.03, t * 0.02));
  float g = fbm(q + warp * 1.2 + vec3(t * 0.021, -t * 0.017, t * 0.019), GRAN_OCT);
  float cells = smoothstep(-0.3, 0.3, g);
  // Supergranulation network and large-scale brightness patches.
  float net = fbm(p * 2.6 + uSeed * 1.7 + vec3(0.0, t * 0.004, 0.0), 3);
  float bright = 0.74 + 0.45 * cells * uActivity + 0.25 * net;
  // Starspots: dark umbra with a softer penumbra.
  float sf = fbm(p * 3.2 + uSeed * 2.3 + vec3(t * 0.003), 4);
  float pen = smoothstep(0.16, 0.26, sf) * uSpots;
  float umb = smoothstep(0.26, 0.34, sf) * uSpots;
  bright *= 1.0 - pen * 0.35 - umb * 0.45;
  // Quadratic limb darkening with a warmer, redder limb.
  float m1 = 1.0 - mu;
  float limb = 1.0 - 0.52 * m1 - 0.22 * m1 * m1;
  vec3 col = mix(uLimbColor, uColor, smoothstep(0.0, 0.85, mu));
  col *= bright * limb * uBright;
  // Flare: a bright patch that swells and fades (red dwarfs).
  float fd = dot(p, uFlare.xyz);
  float flare = uFlare.w * smoothstep(0.86, 0.99, fd) * (0.7 + 0.6 * cells);
  col += mix(uColor, vec3(1.0), 0.6) * flare * 3.0;
  gl_FragColor = vec4(col, 1.0);
  ${OUTPUT_GLSL}
}
`;

// Camera-facing quad placed in view space. Pulled towards the camera by a star radius plus a
// depth-precision margin so it is never swallowed by its own photosphere at 400k units, while
// planets in front still occlude it. `uMinScreen` keeps a minimum on-screen size (NDC units).
const GLOW_VERT = /* glsl */ `
uniform float uSize;
uniform float uRadius;
uniform float uMinScreen;
uniform float uClampMin;
uniform float uNear;
varying vec2 vUv;
varying float vDisk;
varying float vFar;
varying float vClose;
void main() {
  vec4 mvC = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  float d = max(length(mvC.xyz), 1e-3);
  float margin = d * d * 6.0 / (uNear * 16777216.0);
  float pull = min(uRadius * 1.15 + margin, d * 0.9);
  float k = (d - pull) / d;
  vec3 c = mvC.xyz * k;
  float worldHalf = uSize * k;
  float minHalf = uMinScreen * max(-c.z, 1e-3) / projectionMatrix[1][1];
  float halfSize = mix(worldHalf, max(worldHalf, minHalf), uClampMin);
  // 1 when the star is too small on screen to read as a disk (the far sprite takes over).
  vFar = smoothstep(0.35, 1.0, minHalf / max(uRadius * 1.6 * k, 1e-6));
  // 1 when the disk fills a large part of the view: the corona is toned down so the surface reads.
  vClose = smoothstep(0.04, 0.3, uRadius * k * projectionMatrix[1][1] / max(-c.z, 1e-3));
  // The sphere's silhouette subtends asin(R/d), wider than R/d up close.
  float sil = inversesqrt(max(1.0 - (uRadius * uRadius) / (d * d), 0.02));
  vDisk = uRadius * k * sil / halfSize;
  vUv = position.xy;
  gl_Position = projectionMatrix * vec4(c + vec3(position.xy * halfSize, 0.0), 1.0);
}
`;

const CORONA_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uIntensity;
uniform float uTime;
uniform float uRays;
varying vec2 vUv;
varying float vDisk;
varying float vFar;
varying float vClose;
${NOISE_GLSL}
void main() {
  float r = length(vUv);
  if (r >= 1.0) discard;
  float rs = r / max(vDisk, 1e-4);
  float edge = 1.0 - smoothstep(0.55, 1.0, r);
  float a = atan(vUv.y, vUv.x);
  // Streamers: angular noise that also drifts slowly with radius and time.
  float n = snoise(vec3(cos(a) * 2.2, sin(a) * 2.2, rs * 0.35 - uTime * 0.03));
  n += 0.5 * snoise(vec3(cos(a) * 5.0, sin(a) * 5.0, rs * 0.6 + uTime * 0.02));
  float rays = 1.0 + uRays * n * smoothstep(1.0, 1.6, rs);
  // Corona outside the disk only: additive glow is tone-mapped on its own, so anything added over
  // the photosphere would clip it to flat white. A short blend inside the limb avoids a seam.
  float x = max(rs - 1.0, 0.0);
  float inner = exp(-x * 5.0) * 0.25;
  float mid = exp(-x * 1.5) * 0.15;
  float wide = 0.06 / (1.0 + x * x * 1.5);
  float I = (inner + mid) * mix(1.0, rays, smoothstep(1.0, 1.3, rs)) + wide;
  I *= smoothstep(0.985, 1.0, rs);
  // Softer when the disk fills the view; fade out where the screen-space sprite dominates.
  I *= edge * (1.0 - 0.6 * vFar) * mix(1.0, 0.35, vClose);
  gl_FragColor = vec4(uColor * I * uIntensity, 1.0);
  ${OUTPUT_GLSL}
}
`;

const FAR_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uIntensity;
varying vec2 vUv;
varying float vFar;
void main() {
  float r2 = dot(vUv, vUv);
  if (r2 >= 1.0) discard;
  float r = sqrt(r2);
  float core = exp(-r2 * 90.0) * 2.2;
  float halo = exp(-r * 6.0) * 0.8 + exp(-r2 * 12.0) * 0.3;
  // Faint cross-shaped diffraction spikes.
  float sx = exp(-abs(vUv.y) * 120.0) * (1.0 - r);
  float sy = exp(-abs(vUv.x) * 120.0) * (1.0 - r);
  float spikes = (sx + sy) * 0.35;
  float I = (core + halo + spikes) * smoothstep(1.0, 0.7, r) * vFar;
  vec3 col = mix(uColor, vec3(1.0), 0.55 * exp(-r2 * 60.0));
  gl_FragColor = vec4(col * I * uIntensity, 1.0);
  ${OUTPUT_GLSL}
}
`;

interface KindLook {
  bright: number;
  activity: number;
  spots: number;
  glowScale: number;
  glowIntensity: number;
  farIntensity: number;
  granFreq: number;
  rays: number;
  limb: [number, number, number];
}

const LOOKS: Record<StarKind, KindLook> = {
  'main-sequence': {
    bright: 1.3,
    activity: 0.7,
    spots: 0.35,
    glowScale: 4.5,
    glowIntensity: 1.2,
    farIntensity: 1.3,
    granFreq: 34,
    rays: 0.35,
    limb: [1.0, 0.6, 0.34],
  },
  'red-dwarf': {
    bright: 0.95,
    activity: 0.85,
    spots: 1.0,
    glowScale: 5.5,
    glowIntensity: 1.0,
    farIntensity: 1.1,
    granFreq: 22,
    rays: 0.25,
    limb: [0.75, 0.22, 0.08],
  },
  'white-dwarf': {
    bright: 3.0,
    activity: 0.15,
    spots: 0.0,
    glowScale: 16,
    glowIntensity: 1.6,
    farIntensity: 1.8,
    granFreq: 40,
    rays: 0.2,
    limb: [0.8, 0.85, 1.0],
  },
  // A red supergiant (Pyre, the invented star): a handful of convection cells, each as big as a
  // sun, a deep red limb, and a slow pulse. Artistic, like every star's look.
  supergiant: {
    bright: 0.92,
    activity: 1.0,
    spots: 0.55,
    glowScale: 3.0,
    glowIntensity: 0.95,
    farIntensity: 1.2,
    granFreq: 3.2,
    rays: 0.12,
    limb: [0.62, 0.17, 0.05],
  },
};

/**
 * A star: emissive animated photosphere plus additive glow. The glow must stay visible as a bright
 * point with a halo when viewed from 300,000+ units away (e.g. Proxima seen from Alpha Centauri A/B).
 */
export function createStar(opts: StarArtOptions, ctx: ArtContext): StarArt {
  const kind = opts.kind ?? 'main-sequence';
  const look = LOOKS[kind];
  const radius = opts.radius;
  const color = new THREE.Color(opts.color);
  const intensity = opts.intensity ?? 1;
  const seed = opts.seed ?? 1;
  const rand = seededRandom(seed * 131 + 7);
  const noise = getNoiseVolume();

  const group = new THREE.Group();
  group.name = 'star';

  // Photosphere.
  const [ws, hs] = byQuality(ctx.quality, [32, 20], [48, 32], [64, 44]);
  const limbColor = new THREE.Color(look.limb[0], look.limb[1], look.limb[2]).multiply(color);
  const photoUniforms = {
    uNoise: { value: noise },
    uColor: { value: color.clone() },
    uLimbColor: { value: limbColor },
    uTime: { value: 0 },
    uActivity: { value: opts.activity ?? look.activity },
    uBright: { value: look.bright },
    uSpots: { value: kind === 'red-dwarf' ? 0.6 + (opts.activity ?? look.activity) * 0.5 : look.spots },
    uGranFreq: { value: look.granFreq },
    uSeed: { value: new THREE.Vector3(rand() * 50, rand() * 50, rand() * 50) },
    uFlare: { value: new THREE.Vector4(0, 1, 0, 0) },
  };
  const photosphere = new THREE.Mesh(
    new THREE.SphereGeometry(radius, ws, hs),
    new THREE.ShaderMaterial({
      uniforms: photoUniforms,
      vertexShader: PHOTOSPHERE_VERT,
      fragmentShader: PHOTOSPHERE_FRAG,
      defines: { GRAN_OCT: byQuality(ctx.quality, 2, 3, 4) },
    }),
  );
  photosphere.name = 'photosphere';
  group.add(photosphere);

  // Shared quad for both billboards.
  const quad = new THREE.PlaneGeometry(2, 2);
  const glowColor = color.clone();
  const glowSize = radius * (opts.glowScale ?? look.glowScale);
  const coronaUniforms = {
    uNoise: { value: noise },
    uColor: { value: glowColor },
    uIntensity: { value: look.glowIntensity * intensity },
    uTime: { value: 0 },
    uRays: { value: look.rays },
    uSize: { value: glowSize },
    uRadius: { value: radius },
    uMinScreen: { value: byQuality(ctx.quality, 0.05, 0.055, 0.06) },
    uClampMin: { value: 0 },
    uNear: { value: 0.5 },
  };
  const corona = new THREE.Mesh(
    quad,
    new THREE.ShaderMaterial({
      uniforms: coronaUniforms,
      vertexShader: GLOW_VERT,
      fragmentShader: CORONA_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }),
  );
  corona.frustumCulled = false;
  corona.renderOrder = 10;
  corona.name = 'corona';
  group.add(corona);

  // Dim-coloured (red) stars get a brighter far sprite so they still read as a point with a halo.
  const lum = 0.2126 * color.r + 0.7152 * color.g + 0.0722 * color.b;
  const farBoost = 1 + Math.max(0, 0.8 - lum) * 1.6;
  const farUniforms = {
    uColor: { value: glowColor },
    uIntensity: { value: look.farIntensity * intensity * farBoost },
    uSize: { value: radius * 1.6 },
    uRadius: { value: radius },
    uMinScreen: { value: coronaUniforms.uMinScreen.value },
    uClampMin: { value: 1 },
    uNear: { value: 0.5 },
  };
  const far = new THREE.Mesh(
    quad.clone(),
    new THREE.ShaderMaterial({
      uniforms: farUniforms,
      vertexShader: GLOW_VERT,
      fragmentShader: FAR_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }),
  );
  far.frustumCulled = false;
  far.renderOrder = 11;
  far.name = 'far-glow';
  group.add(far);

  // Red-dwarf flares: occasional gentle swell (never with reduced motion).
  const flares = kind === 'red-dwarf' && !ctx.reducedMotion;
  let nextFlare = 4 + rand() * 6;
  let flareAge = -1;
  const flareLife = 3.2;
  const flareDir = new THREE.Vector3();
  const baseGlow = coronaUniforms.uIntensity.value;
  const timeScale = ctx.reducedMotion ? 0.4 : 1;
  // A supergiant pulses slowly, swelling a little and brightening (not with reduced motion).
  const pulse = kind === 'supergiant' && !ctx.reducedMotion;
  const baseBright = photoUniforms.uBright.value;

  return {
    object: group,
    radius,
    update(dt, time, camera) {
      const t = time * timeScale;
      photoUniforms.uTime.value = t;
      coronaUniforms.uTime.value = t;
      const near = (camera as THREE.PerspectiveCamera).near ?? 0.5;
      coronaUniforms.uNear.value = near;
      farUniforms.uNear.value = near;
      if (pulse) {
        const w = Math.sin(t * 0.21) * 0.6 + Math.sin(t * 0.13 + 1.7) * 0.4;
        photosphere.scale.setScalar(1 + 0.012 * w);
        photoUniforms.uBright.value = baseBright * (1 + 0.07 * w);
      }
      if (!flares) return;
      if (flareAge < 0) {
        nextFlare -= dt;
        if (nextFlare <= 0) {
          flareAge = 0;
          flareDir.set(rand() * 2 - 1, rand() * 1.6 - 0.8, rand() * 2 - 1).normalize();
          photoUniforms.uFlare.value.set(flareDir.x, flareDir.y, flareDir.z, 0);
        }
      } else {
        flareAge += dt;
        const x = flareAge / flareLife;
        // Fast-ish rise, slow decay; smooth so it never reads as a flash.
        const s = x < 0.25 ? THREE.MathUtils.smootherstep(x / 0.25, 0, 1) : 1 - THREE.MathUtils.smoothstep(x, 0.25, 1);
        photoUniforms.uFlare.value.w = s * 0.9;
        coronaUniforms.uIntensity.value = baseGlow * (1 + 0.18 * s);
        if (x >= 1) {
          flareAge = -1;
          nextFlare = 9 + rand() * 14;
          photoUniforms.uFlare.value.w = 0;
          coronaUniforms.uIntensity.value = baseGlow;
        }
      }
    },
    dispose: () => disposeObject(group),
  };
}
