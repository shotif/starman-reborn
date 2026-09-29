import * as THREE from 'three';
import type { ArtContext, ArtObject } from './types.ts';
import { NOISE_GLSL, OUTPUT_GLSL, getNoiseVolume } from './noise.ts';
import { byQuality, disposeObject, seededRandom } from './util.ts';

export type PlanetStyle =
  | 'mercury'
  | 'venus'
  | 'earth'
  | 'moon'
  | 'mars'
  | 'jupiter'
  | 'saturn'
  | 'uranus'
  | 'neptune'
  /** Rocky exoplanet around a red dwarf (artist's impression, e.g. Proxima b). */
  | 'exo-rocky-warm'
  /** Airless, scorched close-in exoplanet (e.g. Barnard's Star planets). */
  | 'exo-scorched'
  /** Cold rocky/icy exoplanet. */
  | 'exo-rocky-cold'
  /** Jupiter-like exoplanet (e.g. Epsilon Eridani b). */
  | 'exo-gas-giant';

export interface PlanetArtOptions {
  radius: number;
  style: PlanetStyle;
  seed?: number;
  /** World-space position of the light source (the host star). */
  lightPosition: THREE.Vector3;
  lightColor?: THREE.ColorRepresentation;
  rings?: { inner: number; outer: number; color?: THREE.ColorRepresentation; opacity?: number };
  /** Draw an atmospheric rim. Defaults per style. */
  atmosphere?: boolean;
  /** Axial spin, radians per second. */
  spinSpeed?: number;
  /** Axial tilt, radians. */
  tilt?: number;
}

export interface PlanetArt extends ArtObject {
  readonly radius: number;
  /** Update the host star position (world space) used for day/night shading. */
  setLightPosition(worldPos: THREE.Vector3): void;
}

/* ------------------------------------------------------------------------------------------------
 * Shaders. Lighting runs in the globe's object space (unit sphere), so noise gradients from the
 * shared volume can bend normals directly and ring shadows are a plane intersection at y = 0.
 * ---------------------------------------------------------------------------------------------- */

const SURFACE_VERT = /* glsl */ `
uniform vec3 uLightPos;
varying vec3 vObj;
varying vec3 vL;
varying vec3 vV;
void main() {
  vObj = normalize(position);
  vec4 wp = modelMatrix * vec4(position, 1.0);
  mat3 m = mat3(modelMatrix);
  vL = (uLightPos - wp.xyz) * m;
  vV = (cameraPosition - wp.xyz) * m;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const SURFACE_COMMON = /* glsl */ `
uniform vec3 uLightColor;
uniform float uSun;
uniform float uAmbient;
uniform float uTime;
uniform vec3 uSeed;
uniform vec3 uAtmoColor;
uniform float uAtmo;
uniform float uTwilight;
varying vec3 vObj;
varying vec3 vL;
varying vec3 vV;
${NOISE_GLSL}
#ifdef HAS_RINGS
uniform sampler2D uRingTex;
uniform vec2 uRingRange;
float ringShadow(vec3 p, vec3 L) {
  if (abs(L.y) < 1e-4) return 1.0;
  float t = -p.y / L.y;
  vec3 h = p + L * t;
  float u = (length(h.xz) - uRingRange.x) / (uRingRange.y - uRingRange.x);
  float a = textureLod(uRingTex, vec2(clamp(u, 0.0, 1.0), 0.5), 0.0).a;
  float inside = step(0.0, t) * step(0.0, u) * step(u, 1.0);
  return 1.0 - a * 0.8 * inside;
}
#endif
vec3 bumpNormal(vec3 N, vec3 grad, float k) {
  return normalize(N - (grad - dot(grad, N) * N) * k);
}
vec3 rotY(vec3 p, float a) {
  float c = cos(a), s = sin(a);
  return vec3(c * p.x - s * p.z, p.y, s * p.x + c * p.z);
}
vec3 finish(vec3 albedo, vec3 N, vec3 Nb, vec3 L, vec3 V, vec3 emissive) {
  float geo = dot(N, L);
  float term = smoothstep(-uTwilight, uTwilight + 0.04, geo);
  float diff = max(dot(Nb, L), 0.0) * term + uTwilight * 0.35 * smoothstep(-uTwilight * 1.5, uTwilight, geo) * (1.0 - term);
#ifdef HAS_RINGS
  diff *= ringShadow(N, L);
#endif
  vec3 col = albedo * (uLightColor * diff * uSun + uAmbient) + emissive;
  if (uAtmo > 0.0) {
    float mu = max(dot(N, V), 0.0);
    float sunSide = smoothstep(-0.3, 0.45, geo);
    vec3 air = uAtmoColor * uLightColor * uSun;
    col = mix(col, air * sunSide * 0.55, clamp(pow(1.0 - mu, 4.0) * uAtmo * 0.85, 0.0, 1.0));
    col += air * pow(1.0 - mu, 2.5) * sunSide * uAtmo * 0.45;
  }
  return col;
}
`;

const ROCKY_FRAG = /* glsl */ `
${SURFACE_COMMON}
uniform vec3 uC0;
uniform vec3 uC1;
uniform vec3 uC2;
uniform vec3 uCapColor;
uniform vec3 uHotColor;
uniform float uFreq;
uniform float uBump;
uniform float uMaria;
uniform float uCraters;
uniform float uCaps;
uniform float uHot;
uniform float uCracks;
uniform float uRays;

float craterLayer(vec3 p, float freq, float density, float salt, inout vec3 grad) {
  vec3 x = p * freq + salt;
  vec3 cell = floor(x);
  vec3 h = hash33(cell + salt * 1.37);
  if (h.x > density) return 0.0;
  vec3 c = 0.3 + 0.4 * hash33(cell * 1.71 + 5.3 + salt);
  float rad = mix(0.1, 0.27, h.y * h.y);
  vec3 dv = x - cell - c;
  float dl = length(dv);
  float d = dl / rad;
  if (d > 2.6) return 0.0;
  // Bowl (inside) plus raised rim; slope is size-independent so every crater shades alike.
  float inside = step(d, 1.0);
  float re = (d - 1.0) / 0.24;
  float rim = exp(-re * re);
  float slope = inside * 2.0 * d * 0.8 + 0.34 * rim * (-2.0 * re / 0.24);
  grad += 0.16 * slope * dv / max(dl, 1e-5);
  float fresh = step(1.0 - uRays, h.z);
  float ejecta = fresh * (1.0 - smoothstep(1.0, 2.6, d)) * step(1.0, d);
  return rim * 0.22 - inside * 0.1 + fresh * inside * 0.18 + ejecta * 0.3;
}

void main() {
  vec3 N = normalize(vObj);
  vec3 L = normalize(vL);
  vec3 V = normalize(vV);
  vec3 p = N;
  vec4 hd = fbmD(p * uFreq + uSeed, OCT);
  float large = fbm(p * 1.15 + uSeed.zxy * 0.7, 3);
  float maria = smoothstep(0.02, 0.16, large) * uMaria;
  vec3 grad = hd.yzw * uFreq * uBump;
  float alb = 0.0;
  vec3 cg = vec3(0.0);
  if (uCraters > 0.0) {
    alb += craterLayer(p, 3.2, 0.3 * uCraters, 1.3, cg);
    alb += craterLayer(p, 7.5, 0.45 * uCraters * (1.0 - maria * 0.6), 7.1, cg);
    alb += craterLayer(p, 17.0, 0.55 * uCraters * (1.0 - maria * 0.5), 3.7, cg);
#if CRATER_LAYERS > 3
    alb += craterLayer(p, 37.0, 0.6 * uCraters, 9.9, cg);
#endif
  }
  grad += cg;
  vec3 albedo = mix(uC1, uC2, smoothstep(-0.12, 0.3, hd.x));
  albedo = mix(albedo, uC0, maria);
  albedo *= 1.0 + alb;
  // Fractures (icy worlds) darken thin creases.
  if (uCracks > 0.0) {
    float cr = ridged(p * 3.1 + uSeed.yzx, 3);
    albedo *= 1.0 - smoothstep(0.62, 0.8, cr) * uCracks * 0.55;
  }
  // Polar caps.
  float lat = abs(p.y);
  float capEdge = 1.0 - uCaps * 0.28;
  float cap = step(0.001, uCaps) * smoothstep(capEdge - 0.02, capEdge + 0.02, lat + hd.x * 0.12);
  albedo = mix(albedo, uCapColor, cap);
  vec3 Nb = bumpNormal(N, grad, 1.0 - cap * 0.7);
  // Scorched worlds: glowing lava channels and a dull thermal glow under the star.
  vec3 emissive = vec3(0.0);
  if (uHot > 0.0) {
    float geo = max(dot(N, L), 0.0);
    float lava = smoothstep(0.78, 0.95, ridged(p * 3.4 + uSeed, 3));
    emissive = uHotColor * uHot * (lava * pow(geo, 2.0) * 1.1 + pow(geo, 3.0) * 0.12);
  }
  gl_FragColor = vec4(finish(albedo, N, Nb, L, V, emissive), 1.0);
  ${OUTPUT_GLSL}
}
`;

const EARTH_FRAG = /* glsl */ `
${SURFACE_COMMON}
uniform float uClouds;
uniform float uCities;
void main() {
  vec3 N = normalize(vObj);
  vec3 L = normalize(vL);
  vec3 V = normalize(vV);
  vec3 p = N;
  vec3 q = p * 1.2 + uSeed;
  vec3 warp = snoiseD(q * 0.7 + 3.1).yzw + 0.5 * snoiseD(q * 1.9 + 7.3).yzw;
  vec4 hd = fbmD(q + warp * 0.2, OCT + 1);
  float h = hd.x + 0.24 * snoise(q * 0.42 + 9.0) + 0.01;
  float land = smoothstep(-0.006, 0.006, h);
  float lat = abs(p.y);
  float moist = snoise(q * 2.1 + 17.0);
  // Biomes: forests, grassland, subtropical deserts, tundra, bare highlands.
  vec3 forest = vec3(0.035, 0.085, 0.03);
  vec3 grass = vec3(0.12, 0.16, 0.055);
  vec3 desert = vec3(0.42, 0.3, 0.16);
  vec3 tundra = vec3(0.2, 0.19, 0.15);
  vec3 rock = vec3(0.2, 0.17, 0.13);
  float dry = smoothstep(-0.05, 0.25, -moist) * smoothstep(0.12, 0.26, lat) * (1.0 - smoothstep(0.4, 0.55, lat));
  vec3 lc = mix(forest, grass, smoothstep(-0.25, 0.3, moist));
  lc = mix(lc, desert, dry);
  lc = mix(lc, tundra, smoothstep(0.6, 0.78, lat));
  lc = mix(lc, rock, smoothstep(0.1, 0.24, h));
  vec3 deep = vec3(0.004, 0.022, 0.075);
  vec3 shallow = vec3(0.015, 0.1, 0.17);
  vec3 ocean = mix(deep, shallow, smoothstep(-0.1, 0.0, h));
  vec3 albedo = mix(ocean, lc, land);
  float ice = smoothstep(0.84, 0.88, lat + moist * 0.04 + hd.x * 0.05) + land * smoothstep(0.26, 0.34, h);
  ice = clamp(ice, 0.0, 1.0);
  albedo = mix(albedo, vec3(0.75, 0.8, 0.86), ice);
  vec3 Nb = bumpNormal(N, hd.yzw * 1.2, 0.06 * land * (1.0 - ice));
  // Clouds drift slowly relative to the surface; stretched along longitude, busier at the
  // equator and in the storm tracks, clearer over the subtropics.
  vec3 cq = rotY(p, uTime * 0.005) * vec3(3.0, 5.2, 3.0) + uSeed.zxy;
  vec3 cw = snoiseD(cq * 0.35 + 5.0).yzw;
  float cn = fbm(cq + cw * 0.7, OCT + 1);
  float clat = asin(clamp(p.y, -1.0, 1.0));
  float belt = 0.1 * cos(clat * 6.0);
  float cloud = smoothstep(0.0, 0.34, cn + belt + (uClouds - 0.5) * 0.3) * 0.9;
  // Sun glint on open water.
  vec3 H = normalize(L + V);
  float ndh = max(dot(N, H), 0.0);
  float glint = pow(ndh, 260.0) * 0.8 + pow(ndh, 28.0) * 0.012;
  glint *= (1.0 - land) * (1.0 - ice) * (1.0 - cloud) * smoothstep(0.0, 0.1, dot(N, L));
  // Night-side city lights (fictional future Earth), hidden under clouds.
  float night = smoothstep(0.05, -0.15, dot(N, L));
  float city = smoothstep(0.2, 0.45, fbm(p * 22.0 + uSeed, 3)) * smoothstep(0.1, 0.5, 1.0 - lat);
  vec3 emissive = vec3(1.0, 0.6, 0.28) * city * land * (1.0 - ice) * night * (1.0 - cloud * 0.85) * uCities * 0.35;
  vec3 surf = mix(albedo, vec3(0.86, 0.88, 0.9), cloud);
  vec3 col = finish(surf, N, normalize(mix(Nb, N, cloud)), L, V, emissive);
  col += uLightColor * uSun * glint;
  gl_FragColor = vec4(col, 1.0);
  ${OUTPUT_GLSL}
}
`;

const GAS_FRAG = /* glsl */ `
${SURFACE_COMMON}
uniform sampler2D uBands;
uniform float uTurb;
uniform float uFlow;
uniform vec4 uStorm;
uniform vec3 uStormColor;
uniform float uStormStrength;
uniform float uHaze;
uniform float uStreaks;
uniform float uBrightClouds;
uniform float uSwirl;
void main() {
  vec3 N = normalize(vObj);
  vec3 L = normalize(vL);
  vec3 V = normalize(vV);
  vec3 p = N;
  float lat = asin(clamp(p.y, -1.0, 1.0));
  // Differential zonal flow: neighbouring bands drift at different rates.
  float shear = sin(lat * 6.0 + uSeed.x) + 0.5 * sin(lat * 15.0 + uSeed.y);
  vec3 q = rotY(p, uTime * uFlow * shear);
  vec3 tq = q * vec3(2.4, 8.0, 2.4) * mix(1.0, 0.4, uSwirl) + uSeed;
  vec3 w = snoiseD(tq * 0.45).yzw;
  float t1 = fbm(tq + w * (0.45 + uSwirl * 0.8), OCT);
  float t2 = snoise(tq * 3.1 + w * 0.8);
  float v = 0.5 + lat / 3.14159 + (t1 * 0.05 + t2 * 0.008) * uTurb;
  // Storm oval with a swirling interior and a pale collar.
  vec3 sc = uStorm.xyz;
  vec3 east = normalize(cross(vec3(0.0, 1.0, 0.0), sc));
  vec3 north = cross(sc, east);
  vec2 lp = vec2(dot(q, east), dot(q, north)) / vec2(uStorm.w, uStorm.w * 0.6);
  float front = step(0.0, dot(q, sc)) * uStormStrength;
  float sr = length(lp);
  float tw = (1.0 - smoothstep(0.0, 1.1, sr)) * 3.2;
  float cs = cos(tw), sn = sin(tw);
  vec2 rl = vec2(cs * lp.x - sn * lp.y, sn * lp.x + cs * lp.y);
  float inner = snoise(vec3(rl * 2.4, 4.2) + uSeed);
  v += front * lp.y * uStorm.w * 0.12 * exp(-sr * sr * 0.5);
  vec3 col = texture(uBands, vec2(clamp(v, 0.001, 0.999), 0.5)).rgb;
  float streak = snoise(q * vec3(3.0, 55.0, 3.0) + uSeed);
  col *= 1.0 + streak * 0.07 * uStreaks + t1 * 0.16 * uTurb;
  float mask = (1.0 - smoothstep(0.78, 1.02, sr)) * front;
  vec3 sCol = uStormColor * (0.88 + 0.28 * inner) * (0.82 + 0.18 * smoothstep(0.0, 0.85, sr));
  col = mix(col, sCol, mask);
  float collar = smoothstep(0.82, 1.0, sr) * (1.0 - smoothstep(1.0, 1.3, sr)) * front;
  col = mix(col, col * 1.12 + 0.02, collar * 0.7);
  // High bright cloud streaks (ice giants).
  if (uBrightClouds > 0.0) {
    float bc = ridged(q * vec3(1.4, 11.0, 1.4) + uSeed.zyx, 3);
    float belt = smoothstep(0.25, 0.45, abs(p.y)) * (1.0 - smoothstep(0.55, 0.7, abs(p.y)));
    col = mix(col, vec3(0.8, 0.86, 0.95), smoothstep(0.7, 0.9, bc) * belt * uBrightClouds);
  }
  col *= 1.0 - uHaze * smoothstep(0.55, 0.97, abs(p.y));
  float mu = max(dot(N, V), 0.0);
  col *= mix(0.62, 1.0, sqrt(mu));
  gl_FragColor = vec4(finish(col, N, N, L, V, vec3(0.0)), 1.0);
  ${OUTPUT_GLSL}
}
`;

const HALO_VERT = /* glsl */ `
varying vec3 vWorld;
varying vec3 vCenter;
varying float vScale;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  vCenter = modelMatrix[3].xyz;
  vScale = length(modelMatrix[0].xyz);
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

// Analytic halo: outside the disk only, so it never depth-fights the globe at 100k+ units.
const HALO_FRAG = /* glsl */ `
uniform vec3 uLightPos;
uniform vec3 uLightColor;
uniform vec3 uAtmoColor;
uniform float uR;
uniform float uShell;
uniform float uStrength;
uniform float uSun;
varying vec3 vWorld;
varying vec3 vCenter;
varying float vScale;
void main() {
  vec3 ro = cameraPosition;
  vec3 rd = normalize(vWorld - ro);
  vec3 oc = vCenter - ro;
  float tca = dot(oc, rd);
  float b = tca > 0.0 ? length(oc - rd * tca) : length(oc);
  float R = uR * vScale;
  float S = uShell * vScale;
  // Discard slightly inside the true radius: the tessellated globe's silhouette is a polygon, and
  // the depth test hides the halo wherever the globe is actually drawn.
  if (b < R * 0.992) discard;
  float h = clamp((b - R) / (S - R), 0.0, 1.0);
  float dens = (1.0 - h) * (1.0 - h) * exp(-h * 3.5);
  vec3 cp = ro + rd * max(tca, 0.0);
  vec3 cn = normalize(cp - vCenter);
  vec3 L = normalize(uLightPos - vCenter);
  float sd = dot(cn, L);
  float lit = smoothstep(-0.45, 0.4, sd);
  float fwd = pow(max(dot(rd, L), 0.0), 8.0) * smoothstep(-0.75, 0.0, sd) * 1.4;
  vec3 col = uAtmoColor * uLightColor * dens * (lit + fwd) * uStrength * uSun;
  gl_FragColor = vec4(col, 1.0);
  ${OUTPUT_GLSL}
}
`;

const RING_VERT = /* glsl */ `
uniform vec3 uLightPos;
varying vec3 vLocal;
varying vec3 vL;
varying vec3 vV;
void main() {
  vLocal = position;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  mat3 m = mat3(modelMatrix);
  vL = (uLightPos - wp.xyz) * m;
  vV = (cameraPosition - wp.xyz) * m;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const RING_FRAG = /* glsl */ `
uniform sampler2D uRingTex;
uniform vec2 uRange;
uniform float uR;
uniform float uOpacity;
uniform float uSun;
uniform vec3 uLightColor;
varying vec3 vLocal;
varying vec3 vL;
varying vec3 vV;
void main() {
  float r = length(vLocal.xz);
  float u = (r - uRange.x) / (uRange.y - uRange.x);
  vec4 rt = texture(uRingTex, vec2(clamp(u, 0.0, 1.0), 0.5));
  if (u < 0.0 || u > 1.0) discard;
  vec3 L = normalize(vL);
  vec3 V = normalize(vV);
  // Planet shadow: does the ray towards the star pass through the globe?
  float tca = dot(-vLocal, L);
  float d2 = dot(vLocal, vLocal) - tca * tca;
  float shadow = tca > 0.0 ? smoothstep(uR * uR * 0.94, uR * uR * 1.03, d2) : 1.0;
  float sameSide = step(0.0, L.y * V.y);
  float front = 0.3 + 0.7 * pow(abs(L.y), 0.35);
  float back = 0.4 * (1.0 - rt.a * 0.75);
  vec3 col = rt.rgb * uLightColor * mix(back, front, sameSide) * shadow * uSun;
  col += rt.rgb * uLightColor * pow(max(dot(-V, L), 0.0), 10.0) * (1.0 - rt.a * 0.5) * shadow * uSun * 0.6;
  gl_FragColor = vec4(col, rt.a * uOpacity);
  ${OUTPUT_GLSL}
}
`;

/* ------------------------------------------------------------------------------------------------
 * Style table.
 * ---------------------------------------------------------------------------------------------- */

type Family = 'rocky' | 'earth' | 'gas';

interface RockyLook {
  c0: string;
  c1: string;
  c2: string;
  cap?: string;
  caps?: number;
  freq: number;
  bump: number;
  maria: number;
  craters: number;
  rays?: number;
  hot?: number;
  cracks?: number;
}

interface GasLook {
  bands: [number, string][];
  /** Amplitude of the fine random stripes baked between the main bands. */
  stripes?: number;
  turb: number;
  flow: number;
  storm?: { lat: number; size: number; color: string; strength: number };
  haze: number;
  streaks: number;
  brightClouds?: number;
  swirl?: number;
}

interface StyleDef {
  family: Family;
  atmosphere: boolean;
  atmoColor: string;
  atmoStrength: number;
  shell: number;
  twilight: number;
  rocky?: RockyLook;
  gas?: GasLook;
}

const STYLES: Record<PlanetStyle, StyleDef> = {
  mercury: {
    family: 'rocky',
    atmosphere: false,
    atmoColor: '#000000',
    atmoStrength: 0,
    shell: 0,
    twilight: 0.015,
    rocky: { c0: '#4f4843', c1: '#6f6760', c2: '#978d83', freq: 2.4, bump: 0.018, maria: 0.35, craters: 1.0, rays: 0.12 },
  },
  moon: {
    family: 'rocky',
    atmosphere: false,
    atmoColor: '#000000',
    atmoStrength: 0,
    shell: 0,
    twilight: 0.015,
    rocky: { c0: '#3f3f41', c1: '#7c7a77', c2: '#a3a09b', freq: 2.2, bump: 0.014, maria: 0.9, craters: 0.9, rays: 0.16 },
  },
  mars: {
    family: 'rocky',
    atmosphere: true,
    atmoColor: '#d9a27c',
    atmoStrength: 0.4,
    shell: 1.035,
    twilight: 0.05,
    rocky: {
      c0: '#5a2c1c',
      c1: '#9e4525',
      c2: '#c07a4c',
      cap: '#efe9e2',
      caps: 0.2,
      freq: 2.0,
      bump: 0.02,
      maria: 0.75,
      craters: 0.45,
      rays: 0.04,
    },
  },
  'exo-rocky-warm': {
    family: 'rocky',
    atmosphere: true,
    atmoColor: '#c98a6a',
    atmoStrength: 0.3,
    shell: 1.035,
    twilight: 0.06,
    rocky: { c0: '#231b18', c1: '#4a3a31', c2: '#7a6452', freq: 2.6, bump: 0.022, maria: 0.8, craters: 0.25, rays: 0.0 },
  },
  'exo-scorched': {
    family: 'rocky',
    atmosphere: false,
    atmoColor: '#000000',
    atmoStrength: 0,
    shell: 0,
    twilight: 0.015,
    rocky: { c0: '#121010', c1: '#221e1d', c2: '#3a3432', freq: 2.8, bump: 0.02, maria: 0.5, craters: 0.9, rays: 0.05, hot: 1.0 },
  },
  'exo-rocky-cold': {
    family: 'rocky',
    atmosphere: false,
    atmoColor: '#9ab8e0',
    atmoStrength: 0.3,
    shell: 1.03,
    twilight: 0.02,
    rocky: {
      c0: '#48505c',
      c1: '#8793a2',
      c2: '#cbd6e2',
      cap: '#eef4fa',
      caps: 0.6,
      freq: 2.3,
      bump: 0.016,
      maria: 0.5,
      craters: 0.5,
      rays: 0.1,
      cracks: 1.0,
    },
  },
  earth: {
    family: 'earth',
    atmosphere: true,
    atmoColor: '#5f9dff',
    atmoStrength: 1.0,
    shell: 1.06,
    twilight: 0.12,
  },
  venus: {
    family: 'gas',
    atmosphere: true,
    atmoColor: '#f2dfae',
    atmoStrength: 0.45,
    shell: 1.06,
    twilight: 0.25,
    gas: {
      bands: [
        [0, '#d3c196'],
        [0.25, '#dfcfa6'],
        [0.5, '#e6d8b2'],
        [0.75, '#dfcfa5'],
        [1, '#d2bf93'],
      ],
      stripes: 0.02,
      turb: 1.4,
      flow: 0.004,
      haze: 0.15,
      streaks: 0.0,
      swirl: 1.0,
    },
  },
  jupiter: {
    family: 'gas',
    atmosphere: true,
    atmoColor: '#cdbb9c',
    atmoStrength: 0.3,
    shell: 1.035,
    twilight: 0.14,
    gas: {
      bands: [
        [0, '#7d766b'],
        [0.08, '#8f8474'],
        [0.16, '#b3a181'],
        [0.21, '#c9b692'],
        [0.26, '#977658'],
        [0.3, '#d8c6a2'],
        [0.355, '#8d6143'],
        [0.405, '#b3825a'],
        [0.445, '#e6d7ba'],
        [0.5, '#eadcbf'],
        [0.545, '#dcc39b'],
        [0.585, '#855438'],
        [0.635, '#7a4e33'],
        [0.665, '#d7c3a0'],
        [0.715, '#9f7f5f'],
        [0.76, '#cfbb98'],
        [0.82, '#9d8a70'],
        [0.9, '#8d8271'],
        [1, '#7a7368'],
      ],
      turb: 1.0,
      flow: 0.006,
      storm: { lat: -0.6, size: 0.26, color: '#c4552e', strength: 1 },
      haze: 0.25,
      streaks: 1.0,
    },
  },
  saturn: {
    family: 'gas',
    atmosphere: true,
    atmoColor: '#dccb9e',
    atmoStrength: 0.3,
    shell: 1.035,
    twilight: 0.14,
    gas: {
      bands: [
        [0, '#a8977a'],
        [0.1, '#bba787'],
        [0.22, '#cfbb8f'],
        [0.3, '#c6ae82'],
        [0.38, '#dccb9f'],
        [0.46, '#e6d6ab'],
        [0.54, '#e2d0a3'],
        [0.61, '#d0ba8b'],
        [0.68, '#c8b184'],
        [0.77, '#d7c498'],
        [0.87, '#bfab86'],
        [1, '#9f8f76'],
      ],
      turb: 0.45,
      flow: 0.005,
      haze: 0.2,
      streaks: 0.6,
    },
  },
  uranus: {
    family: 'gas',
    atmosphere: true,
    atmoColor: '#a6e3ee',
    atmoStrength: 0.6,
    shell: 1.05,
    twilight: 0.18,
    gas: {
      bands: [
        [0, '#b4e4ea'],
        [0.2, '#a8dce3'],
        [0.4, '#9ed4dc'],
        [0.5, '#a1d6de'],
        [0.62, '#9bd2da'],
        [0.8, '#a7dbe2'],
        [1, '#b0e1e7'],
      ],
      stripes: 0.03,
      turb: 0.08,
      flow: 0.003,
      haze: -0.08,
      streaks: 0.0,
    },
  },
  neptune: {
    family: 'gas',
    atmosphere: true,
    atmoColor: '#6a92ff',
    atmoStrength: 0.65,
    shell: 1.05,
    twilight: 0.18,
    gas: {
      bands: [
        [0, '#2c4a9e'],
        [0.15, '#3657b8'],
        [0.3, '#2f50b2'],
        [0.42, '#3b62c6'],
        [0.5, '#3659bf'],
        [0.58, '#3152b6'],
        [0.7, '#3e66cc'],
        [0.85, '#3455b6'],
        [1, '#2b4796'],
      ],
      turb: 0.5,
      flow: 0.006,
      storm: { lat: -0.35, size: 0.16, color: '#1a2a6a', strength: 1 },
      haze: 0.15,
      streaks: 0.4,
      brightClouds: 0.8,
    },
  },
  'exo-gas-giant': {
    family: 'gas',
    atmosphere: true,
    atmoColor: '#a9b3c4',
    atmoStrength: 0.35,
    shell: 1.035,
    twilight: 0.14,
    gas: {
      bands: [], // generated per seed from EXO_GAS_PALETTES
      turb: 0.8,
      flow: 0.005,
      storm: { lat: 0.3, size: 0.15, color: '#d9d0c0', strength: 0.9 },
      haze: 0.22,
      streaks: 0.8,
    },
  },
};

// Muted palettes, deliberately unlike Jupiter's tans: teal-sage, slate-mauve, ash-rose.
const EXO_GAS_PALETTES: string[][] = [
  ['#3b5957', '#5b7a75', '#95a28a', '#4b6866', '#bec0a2', '#cfcdb1', '#7b9585', '#476361', '#83947d', '#3a5250'],
  ['#58526a', '#766e87', '#a097a5', '#555e77', '#c2bab6', '#cfc8c1', '#8a8297', '#50586e', '#787084', '#4b465a'],
  ['#5a5052', '#7c6b6c', '#a88f8a', '#625b5e', '#c4b2a8', '#d1c2b7', '#927c7a', '#5d5658', '#877774', '#4f4749'],
];

/* ------------------------------------------------------------------------------------------------
 * Small generated lookup textures (bands, ring profile).
 * ---------------------------------------------------------------------------------------------- */

function srgbBytes(hex: string): [number, number, number] {
  const c = new THREE.Color(hex);
  const s = c.clone().convertLinearToSRGB();
  return [Math.round(s.r * 255), Math.round(s.g * 255), Math.round(s.b * 255)];
}

function makeLookup(width: number, fill: (u: number, out: Float32Array) => void): THREE.DataTexture {
  const data = new Uint8Array(width * 4);
  const px = new Float32Array(4);
  for (let i = 0; i < width; i++) {
    fill((i + 0.5) / width, px);
    data[i * 4] = Math.max(0, Math.min(255, Math.round(px[0]!)));
    data[i * 4 + 1] = Math.max(0, Math.min(255, Math.round(px[1]!)));
    data[i * 4 + 2] = Math.max(0, Math.min(255, Math.round(px[2]!)));
    data[i * 4 + 3] = Math.max(0, Math.min(255, Math.round(px[3]!)));
  }
  const tex = new THREE.DataTexture(data, width, 1, THREE.RGBAFormat);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.needsUpdate = true;
  return tex;
}

function makeBandTexture(stops: [number, string][], rand: () => number, stripeAmp = 0.14): THREE.DataTexture {
  const cols = stops.map(([pos, hex]) => ({ pos, rgb: srgbBytes(hex) }));
  // Thin random stripes add the fine banding seen between the main belts and zones.
  const stripes: { pos: number; width: number; gain: number }[] = [];
  for (let i = 0; i < 42; i++) stripes.push({ pos: rand(), width: 0.002 + rand() * 0.012, gain: (rand() - 0.5) * stripeAmp });
  const jitter = (rand() - 0.5) * 0.02;
  return makeLookup(256, (u, out) => {
    const x = Math.min(1, Math.max(0, u + jitter));
    let i = 0;
    while (i < cols.length - 2 && x > cols[i + 1]!.pos) i++;
    const a = cols[i]!;
    const b = cols[i + 1]!;
    const t0 = (x - a.pos) / Math.max(1e-6, b.pos - a.pos);
    const t = THREE.MathUtils.smoothstep(t0, 0.2, 0.8);
    let gain = 1;
    for (const s of stripes) {
      const d = (x - s.pos) / s.width;
      gain += s.gain * Math.exp(-d * d);
    }
    for (let k = 0; k < 3; k++) out[k] = (a.rgb[k]! + (b.rgb[k]! - a.rgb[k]!) * t) * gain;
    out[3] = 255;
  });
}

function makeRingTexture(color: THREE.ColorRepresentation, rand: () => number): THREE.DataTexture {
  const base = new THREE.Color(color).convertLinearToSRGB();
  const ringlets: { pos: number; width: number; amp: number }[] = [];
  for (let i = 0; i < 90; i++) ringlets.push({ pos: rand(), width: 0.002 + rand() * 0.025, amp: (rand() - 0.45) * 0.9 });
  const gapPos = 0.55 + rand() * 0.08;
  const gap2 = 0.86 + rand() * 0.05;
  return makeLookup(512, (u, out) => {
    // Broad profile: faint inner ring, dense middle, moderate outer ring.
    let d = 0.25 + 0.75 * THREE.MathUtils.smoothstep(u, 0.02, 0.3);
    d *= 1 - 0.35 * THREE.MathUtils.smoothstep(u, 0.75, 1.0);
    for (const r of ringlets) {
      const x = (u - r.pos) / r.width;
      d += r.amp * Math.exp(-x * x) * 0.5;
    }
    const g1 = (u - gapPos) / 0.022;
    d *= 1 - 0.92 * Math.exp(-g1 * g1 * g1 * g1);
    const g2 = (u - gap2) / 0.006;
    d *= 1 - 0.7 * Math.exp(-g2 * g2);
    d *= THREE.MathUtils.smoothstep(u, 0.0, 0.03) * (1 - THREE.MathUtils.smoothstep(u, 0.97, 1.0));
    d = Math.max(0, Math.min(1, d));
    // Inner ring greyer and dimmer, main ring brightest.
    const shade = (0.7 + 0.35 * d) * (0.8 + 0.2 * THREE.MathUtils.smoothstep(u, 0.05, 0.35));
    const grey = 1 - THREE.MathUtils.smoothstep(u, 0.0, 0.3) * 0.25;
    out[0] = (base.r * (1 - grey * 0.2) + 0.55 * grey * 0.2) * 255 * shade;
    out[1] = (base.g * (1 - grey * 0.2) + 0.55 * grey * 0.2) * 255 * shade;
    out[2] = (base.b * (1 - grey * 0.2) + 0.58 * grey * 0.2) * 255 * shade;
    out[3] = d * 255;
  });
}

function lin(hex: string): THREE.Color {
  return new THREE.Color(hex);
}

/* ------------------------------------------------------------------------------------------------
 * Builder.
 * ---------------------------------------------------------------------------------------------- */

/** Shader-lit procedural planet with optional atmosphere halo and rings. */
export function createPlanet(opts: PlanetArtOptions, ctx: ArtContext): PlanetArt {
  const style = STYLES[opts.style];
  const seed = opts.seed ?? 1;
  const rand = seededRandom(seed * 977 + opts.style.length * 31);
  const radius = opts.radius;
  const noise = getNoiseVolume();

  const group = new THREE.Group();
  group.name = `planet-${opts.style}`;
  const tiltGroup = new THREE.Group();
  tiltGroup.rotation.z = opts.tilt ?? 0;
  group.add(tiltGroup);

  const lightPos = { value: opts.lightPosition.clone() };
  const lightColor = { value: new THREE.Color(opts.lightColor ?? 0xffffff) };
  const sun = { value: 1.35 };
  const time = { value: 0 };
  const atmosphere = opts.atmosphere ?? style.atmosphere;
  const atmoColor = lin(style.atmoColor);

  const uniforms: Record<string, THREE.IUniform> = {
    uNoise: { value: noise },
    uLightPos: lightPos,
    uLightColor: lightColor,
    uSun: sun,
    uAmbient: { value: 0.012 },
    uTime: time,
    uSeed: { value: new THREE.Vector3(rand() * 40, rand() * 40, rand() * 40) },
    uAtmoColor: { value: atmoColor },
    uAtmo: { value: atmosphere ? style.atmoStrength : 0 },
    uTwilight: { value: atmosphere ? style.twilight : Math.min(style.twilight, 0.03) },
  };
  const defines: Record<string, number | string> = {
    OCT: byQuality(ctx.quality, 3, 4, 5),
    CRATER_LAYERS: byQuality(ctx.quality, 3, 3, 4),
  };

  let fragmentShader: string;
  if (style.family === 'rocky') {
    const r = style.rocky!;
    Object.assign(uniforms, {
      uC0: { value: lin(r.c0) },
      uC1: { value: lin(r.c1) },
      uC2: { value: lin(r.c2) },
      uCapColor: { value: lin(r.cap ?? '#ffffff') },
      uHotColor: { value: new THREE.Color(1.0, 0.32, 0.08).multiplyScalar(1.6) },
      uFreq: { value: r.freq * (0.9 + rand() * 0.2) },
      uBump: { value: r.bump },
      uMaria: { value: r.maria },
      uCraters: { value: r.craters },
      uCaps: { value: r.caps ?? 0 },
      uHot: { value: r.hot ?? 0 },
      uCracks: { value: r.cracks ?? 0 },
      uRays: { value: r.rays ?? 0 },
    });
    fragmentShader = ROCKY_FRAG;
  } else if (style.family === 'earth') {
    Object.assign(uniforms, { uClouds: { value: 0.5 }, uCities: { value: 1 } });
    fragmentShader = EARTH_FRAG;
  } else {
    const g = style.gas!;
    let bands = g.bands;
    if (opts.style === 'exo-gas-giant') {
      const pal = EXO_GAS_PALETTES[(Math.abs(Math.floor(seed)) + 2) % EXO_GAS_PALETTES.length]!;
      bands = pal.map((c, i) => [i / (pal.length - 1) + (i > 0 && i < pal.length - 1 ? (rand() - 0.5) * 0.05 : 0), c]);
    }
    const storm = g.storm;
    const lon = rand() * Math.PI * 2;
    const slat = storm ? storm.lat + (rand() - 0.5) * 0.08 : 0;
    Object.assign(uniforms, {
      uBands: { value: makeBandTexture(bands, rand, g.stripes ?? 0.14) },
      uTurb: { value: g.turb },
      uFlow: { value: ctx.reducedMotion ? g.flow * 0.5 : g.flow },
      uStorm: {
        value: new THREE.Vector4(
          Math.cos(slat) * Math.cos(lon),
          Math.sin(slat),
          Math.cos(slat) * Math.sin(lon),
          storm ? storm.size * (0.9 + rand() * 0.2) : 0.1,
        ),
      },
      uStormColor: { value: lin(storm?.color ?? '#ffffff') },
      uStormStrength: { value: storm?.strength ?? 0 },
      uHaze: { value: g.haze },
      uStreaks: { value: g.streaks },
      uBrightClouds: { value: g.brightClouds ?? 0 },
      uSwirl: { value: g.swirl ?? 0 },
    });
    fragmentShader = GAS_FRAG;
  }

  // Rings (and their shadow on the globe).
  let ringTex: THREE.DataTexture | null = null;
  if (opts.rings) {
    ringTex = makeRingTexture(opts.rings.color ?? 0xd8c7a0, rand);
    defines.HAS_RINGS = 1;
    uniforms.uRingTex = { value: ringTex };
    uniforms.uRingRange = { value: new THREE.Vector2(opts.rings.inner / radius, opts.rings.outer / radius) };
  }

  const [ws, hs] = byQuality(ctx.quality, [40, 28], [64, 44], [96, 64]);
  const surface = new THREE.Mesh(
    new THREE.SphereGeometry(radius, ws, hs),
    new THREE.ShaderMaterial({ uniforms, defines, vertexShader: SURFACE_VERT, fragmentShader }),
  );
  surface.name = 'surface';
  tiltGroup.add(surface);

  if (atmosphere && style.shell > 1) {
    const shellR = radius * style.shell;
    const halo = new THREE.Mesh(
      new THREE.SphereGeometry(shellR, byQuality(ctx.quality, 32, 48, 64), byQuality(ctx.quality, 20, 32, 40)),
      new THREE.ShaderMaterial({
        uniforms: {
          uLightPos: lightPos,
          uLightColor: lightColor,
          uAtmoColor: { value: atmoColor },
          uR: { value: radius },
          uShell: { value: shellR },
          uStrength: { value: style.atmoStrength * 1.1 },
          uSun: sun,
        },
        vertexShader: HALO_VERT,
        fragmentShader: HALO_FRAG,
        side: THREE.BackSide,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    halo.name = 'atmosphere';
    group.add(halo);
  }

  if (opts.rings && ringTex) {
    const ringGeo = new THREE.RingGeometry(opts.rings.inner, opts.rings.outer, byQuality(ctx.quality, 96, 128, 180), 1);
    ringGeo.rotateX(-Math.PI / 2);
    const ring = new THREE.Mesh(
      ringGeo,
      new THREE.ShaderMaterial({
        uniforms: {
          uRingTex: { value: ringTex },
          uRange: { value: new THREE.Vector2(opts.rings.inner, opts.rings.outer) },
          uR: { value: radius },
          uOpacity: { value: opts.rings.opacity ?? 0.85 },
          uSun: sun,
          uLightPos: lightPos,
          uLightColor: lightColor,
        },
        vertexShader: RING_VERT,
        fragmentShader: RING_FRAG,
        side: THREE.DoubleSide,
        transparent: true,
        depthWrite: false,
      }),
    );
    ring.name = 'rings';
    ring.renderOrder = 1;
    tiltGroup.add(ring);
  }

  const spin = opts.spinSpeed ?? 0.004;
  return {
    object: group,
    radius,
    setLightPosition(worldPos) {
      lightPos.value.copy(worldPos);
    },
    update(dt, t) {
      time.value = t;
      surface.rotation.y += spin * dt;
    },
    dispose: () => disposeObject(group),
  };
}
