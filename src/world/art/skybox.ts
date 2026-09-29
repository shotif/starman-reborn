import * as THREE from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { ArtContext, ArtObject } from './types.ts';
import { NOISE_GLSL, OUTPUT_GLSL, getNoiseVolume } from './noise.ts';
import { byQuality, disposeObject, seededRandom, trackViewport, viewportUniform } from './util.ts';

export interface SkyboxOptions {
  seed: number;
  /** Deep background colour. */
  baseColor: THREE.ColorRepresentation;
  /** Nebula tints (artistic; not observational imagery). */
  nebulaColors: THREE.ColorRepresentation[];
  /** 0..1 */
  nebulaIntensity: number;
  /** 0..1 relative density of background stars. */
  starDensity: number;
  /** Tilt of the faint Milky Way band, radians. */
  bandTilt?: number;
  /** 0..1 amount of dark absorbing dust lanes across the nebula (default 0.35). */
  dust?: number;
}

const SKY_RADIUS = 900_000;
const STAR_RADIUS = 850_000;

// Low-frequency nebula fields are evaluated per vertex on a dense icosphere (cheap), the fragment
// shader only adds one or two detail octaves, so a full-screen sky costs little on phones.
const SKY_VERT = /* glsl */ `
uniform vec3 uSeedOff;
uniform vec3 uBandN;
varying vec3 vDir;
varying vec4 vNeb;
${NOISE_GLSL}
void main() {
  vec3 dir = normalize(position);
  vDir = dir;
  vec3 q = dir * 1.5 + uSeedOff;
  vec3 w = vec3(fbmLod(q + 1.7, 3), fbmLod(q + 9.2, 3), fbmLod(q + 4.4, 3));
  float d1 = fbmLod(q * 1.2 + w * 1.6, NOCT);
  float d2 = fbmLod(q * 2.0 + w.zxy * 2.0 + 13.0, NOCT);
  float bl = dot(dir, uBandN);
  float band = exp(-bl * bl * 14.0) * (0.75 + 0.5 * fbmLod(dir * 3.0 + uSeedOff.zxy, 3));
  float dust = fbmLod(q * 2.6 + w * 0.8 + 31.0, 3);
  vNeb = vec4(d1, d2, band, dust);
  gl_Position = projectionMatrix * viewMatrix * vec4(cameraPosition + position, 1.0);
}
`;

const SKY_FRAG = /* glsl */ `
uniform vec3 uSeedOff;
uniform vec3 uBase;
uniform vec3 uC1;
uniform vec3 uC2;
uniform vec3 uC3;
uniform float uIntensity;
uniform float uDust;
uniform vec3 uBandColor;
varying vec3 vDir;
varying vec4 vNeb;
${NOISE_GLSL}
void main() {
  vec3 dir = normalize(vDir);
  float det = fbm(dir * 9.0 + uSeedOff * 1.3, DOCT);
  float d1 = vNeb.x + det * 0.22;
  float d2 = vNeb.y + det * 0.26;
  float n1 = smoothstep(-0.1, 0.45, d1);
  float n2 = smoothstep(0.0, 0.5, d2) * n1;
  // Brighter knots where both fields overlap; wispy texture from the detail octaves.
  float core = smoothstep(0.2, 0.6, d1) * smoothstep(0.05, 0.45, d2);
  float tex = 0.7 + 0.6 * smoothstep(-0.25, 0.25, det);
  vec3 neb = (uC1 * n1 * 0.5 + uC2 * n2 * 0.7 + uC3 * core * 0.6) * tex;
  // Dark absorbing dust lanes.
  float dl = smoothstep(0.0, 0.25, vNeb.w + det * 0.2);
  float dust = dl * uDust;
  float band = vNeb.z;
  vec3 bandCol = uBandColor * band * (0.55 + 0.45 * smoothstep(-0.3, 0.3, det + vNeb.x));
  vec3 col = uBase + (neb * uIntensity + bandCol) * (1.0 - dust * 0.85);
  gl_FragColor = vec4(col, 1.0);
  ${OUTPUT_GLSL}
  // Dither in output space to break banding in the dark gradients.
  float ign = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
  gl_FragColor.rgb += (ign - 0.5) / 255.0;
}
`;

const STAR_VERT = /* glsl */ `
attribute vec3 aColor;
attribute float aSize;
uniform float uViewport;
varying vec3 vColor;
void main() {
  float scale = uViewport / 1000.0;
  float px = aSize * scale;
  // Sub-pixel stars keep a 1.5px footprint and trade size for brightness.
  float size = max(px, 1.5);
  vColor = aColor * min(1.0, (px * px) / (size * size) * 1.6);
  gl_PointSize = size;
  gl_Position = projectionMatrix * viewMatrix * vec4(cameraPosition + position, 1.0);
}
`;

const STAR_FRAG = /* glsl */ `
varying vec3 vColor;
void main() {
  vec2 d = gl_PointCoord * 2.0 - 1.0;
  float r2 = dot(d, d);
  if (r2 > 1.0) discard;
  float a = exp(-r2 * 4.0) * (1.0 - r2 * 0.5) + exp(-r2 * 24.0);
  gl_FragColor = vec4(vColor * a, 1.0);
  ${OUTPUT_GLSL}
}
`;

const STAR_TINTS: [number, string][] = [
  [0.14, '#a9c1ff'],
  [0.36, '#eef2ff'],
  [0.24, '#fff3df'],
  [0.15, '#ffdcae'],
  [0.11, '#ffb88f'],
];

/**
 * Background sphere (nebula + stars). `update` must keep it centred on the camera. It renders
 * behind everything (depthWrite off, renderOrder very low) and must fit inside a far plane of 2e6.
 */
export function createSkybox(opts: SkyboxOptions, ctx: ArtContext): ArtObject {
  const rand = seededRandom(opts.seed * 1543 + 11);
  const noise = getNoiseVolume();
  const group = new THREE.Group();
  group.name = 'skybox';

  const cols = opts.nebulaColors.length > 0 ? opts.nebulaColors : [0x203050];
  const c1 = new THREE.Color(cols[0]!);
  const c2 = new THREE.Color(cols[1 % cols.length]!);
  const c3 = new THREE.Color(cols[2 % cols.length]!);
  if (cols.length < 3) c3.lerp(new THREE.Color(1, 1, 1), 0.35);

  // Galactic band plane: tilt about X, then a seeded yaw.
  const tilt = opts.bandTilt ?? 0.45;
  const bandN = new THREE.Vector3(0, 1, 0)
    .applyAxisAngle(new THREE.Vector3(1, 0, 0), tilt)
    .applyAxisAngle(new THREE.Vector3(0, 1, 0), rand() * Math.PI * 2);
  const base = new THREE.Color(opts.baseColor);
  const bandColor = base.clone().lerp(new THREE.Color(0.72, 0.7, 0.66), 0.6).multiplyScalar(0.028 + 0.03 * opts.starDensity);

  const detail = byQuality(ctx.quality, 20, 30, 42);
  let geo: THREE.BufferGeometry = new THREE.IcosahedronGeometry(SKY_RADIUS, detail);
  geo.deleteAttribute('normal');
  geo.deleteAttribute('uv');
  geo = mergeVertices(geo);
  const skyMat = new THREE.ShaderMaterial({
    uniforms: {
      uNoise: { value: noise },
      uSeedOff: { value: new THREE.Vector3(rand() * 60, rand() * 60, rand() * 60) },
      uBandN: { value: bandN },
      uBase: { value: base },
      uC1: { value: c1 },
      uC2: { value: c2 },
      uC3: { value: c3 },
      uIntensity: { value: opts.nebulaIntensity * 0.9 },
      uDust: { value: opts.dust ?? 0.35 },
      uBandColor: { value: bandColor },
    },
    defines: { NOCT: byQuality(ctx.quality, 4, 5, 5), DOCT: byQuality(ctx.quality, 1, 2, 2) },
    vertexShader: SKY_VERT,
    fragmentShader: SKY_FRAG,
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: false,
  });
  const sky = new THREE.Mesh(geo, skyMat);
  sky.renderOrder = -1000;
  sky.frustumCulled = false;
  sky.name = 'sky';
  group.add(sky);

  // Star field.
  const count = Math.round(Math.max(0, Math.min(1.5, opts.starDensity)) * byQuality(ctx.quality, 1600, 3200, 5200));
  if (count > 0) {
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const sizes = new Float32Array(count);
    const tints = STAR_TINTS.map(([w, hex]) => ({ w, c: new THREE.Color(hex) }));
    const v = new THREE.Vector3();
    const t1 = new THREE.Vector3();
    const t2 = new THREE.Vector3();
    t1.set(1, 0, 0);
    if (Math.abs(bandN.x) > 0.9) t1.set(0, 0, 1);
    t1.cross(bandN).normalize();
    t2.crossVectors(bandN, t1);
    for (let i = 0; i < count; i++) {
      if (rand() < 0.38) {
        // Concentrate towards the band.
        const a = rand() * Math.PI * 2;
        const g = (rand() + rand() + rand() - 1.5) * 0.28;
        v.copy(t1).multiplyScalar(Math.cos(a)).addScaledVector(t2, Math.sin(a)).addScaledVector(bandN, g).normalize();
      } else {
        const z = rand() * 2 - 1;
        const a = rand() * Math.PI * 2;
        const r = Math.sqrt(1 - z * z);
        v.set(Math.cos(a) * r, z, Math.sin(a) * r);
      }
      positions[i * 3] = v.x * STAR_RADIUS;
      positions[i * 3 + 1] = v.y * STAR_RADIUS;
      positions[i * 3 + 2] = v.z * STAR_RADIUS;
      let pick = rand();
      let tint = tints[0]!.c;
      for (const t of tints) {
        if (pick < t.w) {
          tint = t.c;
          break;
        }
        pick -= t.w;
      }
      const m = Math.pow(rand(), 4.2);
      const bright = 0.18 + m * 2.4;
      sizes[i] = 1.1 + m * 3.6 + (m > 0.93 ? 2.5 : 0);
      colors[i * 3] = tint.r * bright;
      colors[i * 3 + 1] = tint.g * bright;
      colors[i * 3 + 2] = tint.b * bright;
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    sg.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));
    sg.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
    const stars = new THREE.Points(
      sg,
      new THREE.ShaderMaterial({
        uniforms: { uViewport: viewportUniform },
        vertexShader: STAR_VERT,
        fragmentShader: STAR_FRAG,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    stars.renderOrder = -999;
    stars.frustumCulled = false;
    stars.name = 'stars';
    trackViewport(stars);
    group.add(stars);
  }

  const camPos = new THREE.Vector3();
  return {
    object: group,
    update: (_dt, _time, camera) => {
      // The shaders centre themselves on the camera; keep the object there too for callers.
      camera.getWorldPosition(camPos);
      group.position.copy(camPos);
    },
    dispose: () => disposeObject(group),
  };
}
