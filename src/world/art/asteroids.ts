import * as THREE from 'three';
import type { ArtContext, ArtObject } from './types.ts';
import { rimUniform } from './materials.ts';
import { NOISE_GLSL, OUTPUT_GLSL, getNoiseVolume } from './noise.ts';
import { rockGeometry } from './rocks.ts';
import { byQuality, disposeObject, seededRandom } from './util.ts';

export interface AsteroidFieldOptions {
  seed: number;
  count: number;
  /** 'ring': annulus around the local origin in the XZ plane. 'cluster': ball around the origin. */
  shape: 'ring' | 'cluster';
  innerRadius: number;
  outerRadius: number;
  /** Vertical spread for rings. */
  thickness: number;
  sizeMin: number;
  sizeMax: number;
  color: THREE.ColorRepresentation;
  /** Spheres no rock may sit in (field-local space): stations in the ring, with room to spare. */
  clear?: readonly { center: THREE.Vector3; radius: number }[];
}

export interface AsteroidHit {
  position: THREE.Vector3;
  radius: number;
}

export interface AsteroidFieldArt extends ArtObject {
  /**
   * Writes asteroids whose bodies come within `radius` of `point` (world space) into `out`
   * (reusing existing entries) and returns how many were written. Used for collisions.
   */
  queryNear(point: THREE.Vector3, radius: number, out: AsteroidHit[]): number;
}

const SHAPES = 3;
/** Collision radius as a fraction of the instance scale (rocks are displaced around radius 1). */
const BODY = 0.92;

function rockMaterial(tumble: boolean): { material: THREE.MeshStandardMaterial; time: { value: number } } {
  const time = { value: 0 };
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.93, metalness: 0.04, flatShading: true });
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = time;
    shader.uniforms.uRimColor = rimUniform;
    if (tumble) {
      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          `#include <common>
          attribute vec4 aTumble;
          uniform float uTime;
          mat3 tumbleRot(vec3 a, float ang) {
            float c = cos(ang), s = sin(ang), t = 1.0 - c;
            return mat3(
              t * a.x * a.x + c, t * a.x * a.y + s * a.z, t * a.x * a.z - s * a.y,
              t * a.x * a.y - s * a.z, t * a.y * a.y + c, t * a.y * a.z + s * a.x,
              t * a.x * a.z + s * a.y, t * a.y * a.z - s * a.x, t * a.z * a.z + c);
          }`,
        )
        .replace('#include <beginnormal_vertex>', 'mat3 tumbleM = tumbleRot(aTumble.xyz, uTime * aTumble.w);\nvec3 objectNormal = tumbleM * vec3(normal);')
        .replace('#include <begin_vertex>', 'vec3 transformed = tumbleM * vec3(position);');
    }
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uRimColor;')
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        { float rimF = 1.0 - saturate(dot(normal, normalize(vViewPosition))); totalEmissiveRadiance += uRimColor * 0.7 * rimF * rimF * rimF; }`,
      );
  };
  material.customProgramCacheKey = () => (tumble ? 'art-rock-tumble' : 'art-rock');
  return { material, time };
}

/** Instanced asteroid field with a spatial hash for collision queries. */
export function createAsteroidField(opts: AsteroidFieldOptions, ctx: ArtContext): AsteroidFieldArt {
  const rand = seededRandom(opts.seed * 2654435761);
  const group = new THREE.Group();
  group.name = 'asteroid-field';
  const count = Math.max(0, Math.floor(opts.count));
  const tumble = ctx.quality === 'high';
  const { material, time } = rockMaterial(tumble);
  const detail = byQuality(ctx.quality, 1, 2, 2);
  const stretches: [number, number, number][] = [
    [1, 0.85, 1.1],
    [1.35, 0.8, 0.9],
    [0.95, 1.05, 0.8],
  ];

  // Instance placement.
  const centers = new Float32Array(count * 3);
  const radii = new Float32Array(count);
  const quats: THREE.Quaternion[] = [];
  const base = new THREE.Color(opts.color);
  const hsl = { h: 0, s: 0, l: 0 };
  base.getHSL(hsl);
  let maxR = 0;
  const p = new THREE.Vector3();
  for (let i = 0; i < count; i++) {
    if (opts.shape === 'ring') {
      const a = rand() * Math.PI * 2;
      // Denser towards the middle of the annulus.
      const u = (rand() + rand()) / 2;
      const r = opts.innerRadius + u * (opts.outerRadius - opts.innerRadius);
      p.set(Math.cos(a) * r, (rand() + rand() + rand() - 1.5) * 0.66 * opts.thickness, Math.sin(a) * r);
    } else {
      // Uniform-ish ball with a denser core.
      const z = rand() * 2 - 1;
      const a = rand() * Math.PI * 2;
      const s = Math.sqrt(1 - z * z);
      const r = opts.innerRadius + Math.pow(rand(), 0.6) * (opts.outerRadius - opts.innerRadius);
      p.set(Math.cos(a) * s * r, z * r * 0.7, Math.sin(a) * s * r);
    }
    // Many small rocks, few big ones.
    const size = opts.sizeMin + Math.pow(rand(), 2.6) * (opts.sizeMax - opts.sizeMin);
    // A rock in a cleared sphere is left out (its draws still made, so the others stay where they are).
    const gone = !!opts.clear?.some((c) => c.center.distanceTo(p) < c.radius + size);
    centers[i * 3] = p.x;
    centers[i * 3 + 1] = p.y;
    centers[i * 3 + 2] = p.z;
    radii[i] = gone ? 0 : size * BODY;
    if (!gone) maxR = Math.max(maxR, size * BODY);
    quats.push(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(rand() - 0.5, rand() - 0.5, rand() - 0.5).normalize(), rand() * Math.PI * 2));
  }

  // One InstancedMesh per base rock shape.
  const meshes: THREE.InstancedMesh[] = [];
  const m = new THREE.Matrix4();
  const sc = new THREE.Vector3();
  const col = new THREE.Color();
  for (let sIdx = 0; sIdx < SHAPES; sIdx++) {
    const n = Math.floor((count - sIdx + SHAPES - 1) / SHAPES);
    if (n <= 0) continue;
    const geo = rockGeometry(opts.seed * 31 + sIdx * 7 + 1, { detail, stretch: stretches[sIdx], rough: 0.3 + sIdx * 0.05, craters: 3 + sIdx * 2 });
    const mesh = new THREE.InstancedMesh(geo, material, n);
    mesh.name = `asteroids-${sIdx}`;
    const tumbleAttr = tumble ? new Float32Array(n * 4) : null;
    let k = 0;
    for (let i = sIdx; i < count; i += SHAPES) {
      const size = radii[i]! / BODY;
      p.set(centers[i * 3]!, centers[i * 3 + 1]!, centers[i * 3 + 2]!);
      sc.setScalar(size);
      m.compose(p, quats[i]!, sc);
      mesh.setMatrixAt(k, m);
      col.setHSL(hsl.h + (rand() - 0.5) * 0.05, hsl.s * (0.7 + rand() * 0.5), hsl.l * (0.72 + rand() * 0.5));
      mesh.setColorAt(k, col);
      if (tumbleAttr) {
        const ax = new THREE.Vector3(rand() - 0.5, rand() - 0.5, rand() - 0.5).normalize();
        tumbleAttr.set([ax.x, ax.y, ax.z, (0.02 + rand() * 0.12) * (ctx.reducedMotion ? 0.6 : 1) * (8 / Math.max(4, size))], k * 4);
      }
      k++;
    }
    if (tumbleAttr) geo.setAttribute('aTumble', new THREE.InstancedBufferAttribute(tumbleAttr, 4));
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
    // Tumbling rotates rocks about their centres, so the instance bounds stay valid.
    group.add(mesh);
    meshes.push(mesh);
  }

  // Spatial hash over instance centres (field-local space).
  const cell = Math.max(maxR * 2.5, (opts.outerRadius - opts.innerRadius) / 24, 1);
  const inv = 1 / cell;
  const grid = new Map<number, number[]>();
  const key = (x: number, y: number, z: number): number => ((x + 4096) * 8192 + (y + 4096)) * 8192 + (z + 4096);
  for (let i = 0; i < count; i++) {
    if (radii[i] === 0) continue;
    const kx = Math.floor(centers[i * 3]! * inv);
    const ky = Math.floor(centers[i * 3 + 1]! * inv);
    const kz = Math.floor(centers[i * 3 + 2]! * inv);
    const kk = key(kx, ky, kz);
    let list = grid.get(kk);
    if (!list) grid.set(kk, (list = []));
    list.push(i);
  }

  const invWorld = new THREE.Matrix4();
  const local = new THREE.Vector3();
  // Per-query state shared with `consider` so queries allocate nothing (beyond growing `out`).
  let qOut: AsteroidHit[] = [];
  let qN = 0;
  let qLr = 0;
  let qScale = 1;
  const consider = (i: number): void => {
    if (radii[i] === 0) return;
    const dx = centers[i * 3]! - local.x;
    const dy = centers[i * 3 + 1]! - local.y;
    const dz = centers[i * 3 + 2]! - local.z;
    const rr = qLr + radii[i]!;
    if (dx * dx + dy * dy + dz * dz > rr * rr) return;
    let hit = qOut[qN];
    if (!hit) {
      hit = { position: new THREE.Vector3(), radius: 0 };
      qOut[qN] = hit;
    }
    hit.position.set(centers[i * 3]!, centers[i * 3 + 1]!, centers[i * 3 + 2]!).applyMatrix4(group.matrixWorld);
    hit.radius = radii[i]! * qScale;
    qN++;
  };

  return {
    object: group,
    queryNear(point, radius, out) {
      group.updateWorldMatrix(true, false);
      invWorld.copy(group.matrixWorld).invert();
      qScale = group.matrixWorld.getMaxScaleOnAxis() || 1;
      local.copy(point).applyMatrix4(invWorld);
      qLr = Math.max(0, radius) / qScale;
      qOut = out;
      qN = 0;
      const reach = qLr + maxR;
      const x0 = Math.floor((local.x - reach) * inv);
      const x1 = Math.floor((local.x + reach) * inv);
      const y0 = Math.floor((local.y - reach) * inv);
      const y1 = Math.floor((local.y + reach) * inv);
      const z0 = Math.floor((local.z - reach) * inv);
      const z1 = Math.floor((local.z + reach) * inv);
      if ((x1 - x0 + 1) * (y1 - y0 + 1) * (z1 - z0 + 1) > count) {
        // Huge query: a linear scan is cheaper than walking empty cells.
        for (let i = 0; i < count; i++) consider(i);
      } else {
        for (let x = x0; x <= x1; x++) {
          for (let y = y0; y <= y1; y++) {
            for (let z = z0; z <= z1; z++) {
              const list = grid.get(key(x, y, z));
              if (!list) continue;
              for (let j = 0; j < list.length; j++) consider(list[j]!);
            }
          }
        }
      }
      return qN;
    },
    update(_dt, t) {
      time.value = t;
    },
    dispose: () => disposeObject(group),
  };
}

/* ------------------------------------------------------------------------------------------------
 * Dust ring.
 * ---------------------------------------------------------------------------------------------- */

export interface DustRingOptions {
  innerRadius: number;
  outerRadius: number;
  color: THREE.ColorRepresentation;
  opacity: number;
  seed: number;
}

const DUST_VERT = /* glsl */ `
varying vec3 vLocal;
varying vec3 vWorld;
void main() {
  vLocal = position;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const DUST_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uOpacity;
uniform float uInner;
uniform float uOuter;
uniform vec3 uSeed;
uniform float uFadeNear;
varying vec3 vLocal;
varying vec3 vWorld;
${NOISE_GLSL}
void main() {
  float r = length(vLocal.xz);
  float w = uOuter - uInner;
  float u = (r - uInner) / w;
  float edge = smoothstep(0.0, 0.22, u) * (1.0 - smoothstep(0.68, 1.0, u));
  // Fine concentric banding with wobble, plus clumpy structure.
  float wob = snoise(vec3(u * 5.0, uSeed.x, uSeed.y)) * 2.5;
  float bands = 0.8 + 0.2 * sin(u * 38.0 + wob) * sin(u * 13.0 + uSeed.z);
  vec3 q = vec3(vLocal.x, 0.0, vLocal.z) / w * 2.2 + uSeed;
  float n = fbm(q + vec3(0.0, u * 3.0, 0.0), 4);
  float clump = smoothstep(-0.3, 0.45, n);
  float wisp = smoothstep(0.1, 0.5, fbm(q * 3.1 + 11.0, 3));
  float d = edge * bands * (0.2 + 0.65 * clump + 0.3 * wisp * clump);
  float near = smoothstep(uFadeNear, uFadeNear * 5.0, length(cameraPosition - vWorld));
  gl_FragColor = vec4(uColor * d * uOpacity * near, 1.0);
  ${OUTPUT_GLSL}
}
`;

/** Faint flat dust annulus (schematic debris disk) in the XZ plane. */
export function createDustRing(opts: DustRingOptions, ctx: ArtContext): ArtObject {
  const rand = seededRandom(opts.seed * 7 + 5);
  const geo = new THREE.RingGeometry(opts.innerRadius, opts.outerRadius, byQuality(ctx.quality, 96, 128, 192), byQuality(ctx.quality, 4, 6, 8));
  geo.rotateX(-Math.PI / 2);
  const mesh = new THREE.Mesh(
    geo,
    new THREE.ShaderMaterial({
      uniforms: {
        uNoise: { value: getNoiseVolume() },
        uColor: { value: new THREE.Color(opts.color).multiplyScalar(0.55) },
        uOpacity: { value: opts.opacity },
        uInner: { value: opts.innerRadius },
        uOuter: { value: opts.outerRadius },
        uSeed: { value: new THREE.Vector3(rand() * 30, rand() * 30, rand() * 30) },
        uFadeNear: { value: (opts.outerRadius - opts.innerRadius) * 0.03 },
      },
      vertexShader: DUST_VERT,
      fragmentShader: DUST_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    }),
  );
  mesh.name = 'dust-ring';
  mesh.renderOrder = 2;
  return { object: mesh, dispose: () => disposeObject(mesh) };
}
