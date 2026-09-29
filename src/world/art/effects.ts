import * as THREE from 'three';
import type { ArtContext, ArtObject } from './types.ts';
import { Kit, latheZ, slab } from './kit.ts';
import { createLightPoints } from './lights.ts';
import { metalMaterial, standardSet } from './materials.ts';
import { NOISE_GLSL, OUTPUT_GLSL, getNoiseVolume } from './noise.ts';
import { approach, byQuality, disposeObject, markShared, seededRandom } from './util.ts';

export type ProjectileKind = 'player-pulse' | 'player-pulse-mk2' | 'enemy-pulse';

export interface ProjectileView {
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  kind: ProjectileKind;
}

export interface ProjectileRenderer extends ArtObject {
  /** Draw exactly these projectiles this frame (called every frame after simulation). */
  render(list: readonly ProjectileView[]): void;
}

export interface TransientEffect extends ArtObject {
  /** True once the effect has finished and can be removed and disposed. */
  readonly finished: boolean;
}

/* ------------------------------------------------------------------------------------------------
 * Shared quad + capsule billboard: a segment (head, direction, length, width) expanded in view
 * space so it reads as a streak from the side and as a round glow when seen end-on.
 * ---------------------------------------------------------------------------------------------- */

let quadGeo: THREE.BufferGeometry | null = null;
function unitQuad(): THREE.BufferGeometry {
  if (!quadGeo) {
    quadGeo = new THREE.BufferGeometry();
    quadGeo.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
    quadGeo.setIndex([0, 1, 2, 0, 2, 3]);
    markShared(quadGeo);
  }
  return quadGeo;
}

/** Per-owner instanced quad (own buffers: disposing one must not free another's attributes). */
function instancedQuad(count: number): THREE.InstancedBufferGeometry {
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  g.instanceCount = count;
  return g;
}

const CAPSULE_GLSL = /* glsl */ `
varying vec2 vQ;
varying float vHalf;
// head/dir in view space; len and width in world units. Writes gl_Position.
void capsule(vec3 head, vec3 dir, float len, float width) {
  vec3 mid = head - dir * len * 0.5;
  vec3 ray = normalize(mid);
  vec3 axis = dir - ray * dot(dir, ray);
  float f = length(axis);
  axis = f > 1e-4 ? axis / f : normalize(cross(ray, vec3(0.0, 1.0, 0.0001)));
  vec3 side = normalize(cross(ray, axis));
  float halfLen = 0.5 * len * f + width;
  vec3 p = mid + axis * position.y * halfLen + side * position.x * width * 1.6;
  vQ = vec2(position.x * 1.6, position.y * halfLen / width);
  vHalf = halfLen / width;
  gl_Position = projectionMatrix * vec4(p, 1.0);
}
`;

const CAPSULE_FRAG_GLSL = /* glsl */ `
varying vec2 vQ;
varying float vHalf;
// Squared distance (in widths) to the capsule core; t = 0 tail .. 1 head.
float capsuleDist(out float t) {
  float seg = max(vHalf - 1.0, 0.0);
  float along = clamp(vQ.y, -seg, seg);
  vec2 d = vec2(vQ.x, vQ.y - along);
  t = clamp((vQ.y + vHalf) / (2.0 * vHalf), 0.0, 1.0);
  return dot(d, d);
}
`;

/* ------------------------------------------------------------------------------------------------
 * Projectiles.
 * ---------------------------------------------------------------------------------------------- */

const PROJECTILE_VERT = /* glsl */ `
attribute vec3 iPos;
attribute vec3 iDir;
attribute vec3 iColor;
attribute vec2 iSize;
varying vec3 vColor;
${CAPSULE_GLSL}
void main() {
  vec3 head = (modelViewMatrix * vec4(iPos, 1.0)).xyz;
  vec3 dir = normalize((modelViewMatrix * vec4(iDir, 0.0)).xyz);
  vColor = iColor;
  capsule(head, dir, iSize.x, iSize.y);
}
`;

const PROJECTILE_FRAG = /* glsl */ `
varying vec3 vColor;
${CAPSULE_FRAG_GLSL}
void main() {
  float t;
  float d2 = capsuleDist(t);
  float core = exp(-d2 * 9.0);
  float glow = exp(-d2 * 1.8);
  float head = 0.45 + 0.55 * t * t;
  vec3 col = (vColor * glow * 0.8 + vec3(1.0) * core * 1.2) * head;
  gl_FragColor = vec4(col, 1.0);
  ${OUTPUT_GLSL}
}
`;

const PROJECTILE_LOOK: Record<ProjectileKind, { color: [number, number, number]; length: number; width: number }> = {
  'player-pulse': { color: [0.25, 0.8, 1.45], length: 7, width: 0.5 },
  'player-pulse-mk2': { color: [0.95, 0.6, 1.7], length: 8.5, width: 0.62 },
  'enemy-pulse': { color: [1.6, 0.36, 0.1], length: 6.5, width: 0.55 },
};

/** Instanced/pooled bolt renderer oriented along velocity. */
export function createProjectileRenderer(maxCount: number, _ctx: ArtContext): ProjectileRenderer {
  const n = Math.max(1, maxCount);
  const geo = instancedQuad(0);
  const pos = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3).setUsage(THREE.DynamicDrawUsage);
  const dir = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3).setUsage(THREE.DynamicDrawUsage);
  const col = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3).setUsage(THREE.DynamicDrawUsage);
  const size = new THREE.InstancedBufferAttribute(new Float32Array(n * 2), 2).setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('iPos', pos);
  geo.setAttribute('iDir', dir);
  geo.setAttribute('iColor', col);
  geo.setAttribute('iSize', size);
  const mesh = new THREE.Mesh(
    geo,
    new THREE.ShaderMaterial({
      vertexShader: PROJECTILE_VERT,
      fragmentShader: PROJECTILE_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    }),
  );
  mesh.name = 'projectiles';
  mesh.frustumCulled = false;
  mesh.renderOrder = 8;
  const pa = pos.array as Float32Array;
  const da = dir.array as Float32Array;
  const ca = col.array as Float32Array;
  const sa = size.array as Float32Array;
  return {
    object: mesh,
    render(list) {
      const count = Math.min(list.length, n);
      for (let i = 0; i < count; i++) {
        const p = list[i]!;
        const look = PROJECTILE_LOOK[p.kind] ?? PROJECTILE_LOOK['player-pulse'];
        pa[i * 3] = p.position.x;
        pa[i * 3 + 1] = p.position.y;
        pa[i * 3 + 2] = p.position.z;
        const v = p.velocity;
        const l = Math.hypot(v.x, v.y, v.z) || 1;
        da[i * 3] = v.x / l;
        da[i * 3 + 1] = v.y / l;
        da[i * 3 + 2] = v.z / l;
        ca[i * 3] = look.color[0];
        ca[i * 3 + 1] = look.color[1];
        ca[i * 3 + 2] = look.color[2];
        sa[i * 2] = look.length;
        sa[i * 2 + 1] = look.width;
      }
      geo.instanceCount = count;
      pos.needsUpdate = true;
      dir.needsUpdate = true;
      col.needsUpdate = true;
      size.needsUpdate = true;
      mesh.visible = count > 0;
    },
    dispose: () => disposeObject(mesh),
  };
}

/* ------------------------------------------------------------------------------------------------
 * Particle building blocks for explosions and sparks.
 * ---------------------------------------------------------------------------------------------- */

const SPARK_VERT = /* glsl */ `
attribute vec3 sDir;
attribute vec4 sParams; // speed, width, life, delay
uniform float uAge;
uniform float uDrag;
uniform float uScale;
varying float vLife;
${CAPSULE_GLSL}
void main() {
  float t = uAge - sParams.w;
  float life = sParams.z;
  vLife = t / life;
  if (t < 0.0 || t > life) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }
  float k = uDrag;
  float travel = sParams.x * (1.0 - exp(-k * t)) / k;
  float speed = sParams.x * exp(-k * t);
  vec3 head = (modelViewMatrix * vec4(sDir * travel * uScale, 1.0)).xyz;
  vec3 dir = normalize((modelViewMatrix * vec4(sDir, 0.0)).xyz);
  capsule(head, dir, max(speed * 0.05, sParams.y) * uScale, sParams.y * uScale);
}
`;

const SPARK_FRAG = /* glsl */ `
uniform vec3 uHot;
uniform vec3 uCool;
uniform float uBright;
varying float vLife;
${CAPSULE_FRAG_GLSL}
void main() {
  float t;
  float d2 = capsuleDist(t);
  float fade = 1.0 - smoothstep(0.55, 1.0, vLife);
  float I = (exp(-d2 * 6.0) * 1.4 + exp(-d2 * 1.6) * 0.4) * fade * (0.5 + 0.5 * t);
  vec3 col = mix(uHot, uCool, smoothstep(0.1, 0.8, vLife));
  gl_FragColor = vec4(col * I * uBright, 1.0);
  ${OUTPUT_GLSL}
}
`;

function sparkMesh(count: number, rand: () => number, speed: [number, number], width: number, life: [number, number], delay: number): {
  mesh: THREE.Mesh;
  u: { uAge: { value: number }; uDrag: { value: number }; uScale: { value: number }; uHot: { value: THREE.Color }; uCool: { value: THREE.Color }; uBright: { value: number } };
} {
  const geo = instancedQuad(count);
  const d = new Float32Array(count * 3);
  const prm = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) {
    const z = rand() * 2 - 1;
    const a = rand() * Math.PI * 2;
    const r = Math.sqrt(1 - z * z);
    d.set([Math.cos(a) * r, z, Math.sin(a) * r], i * 3);
    prm.set([speed[0] + rand() * (speed[1] - speed[0]), width * (0.6 + rand() * 0.8), life[0] + rand() * (life[1] - life[0]), rand() * delay], i * 4);
  }
  geo.setAttribute('sDir', new THREE.InstancedBufferAttribute(d, 3));
  geo.setAttribute('sParams', new THREE.InstancedBufferAttribute(prm, 4));
  const u = {
    uAge: { value: 0 },
    uDrag: { value: 2.5 },
    uScale: { value: 1 },
    uHot: { value: new THREE.Color(1.6, 1.25, 0.8) },
    uCool: { value: new THREE.Color(1.4, 0.35, 0.08) },
    uBright: { value: 1 },
  };
  const mesh = new THREE.Mesh(
    geo,
    new THREE.ShaderMaterial({
      uniforms: u,
      vertexShader: SPARK_VERT,
      fragmentShader: SPARK_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    }),
  );
  mesh.frustumCulled = false;
  mesh.renderOrder = 9;
  return { mesh, u };
}

// Camera-facing quad at the object origin (flashes, shockwaves).
const BILLBOARD_VERT = /* glsl */ `
uniform float uSize;
varying vec2 vUv;
void main() {
  vec4 mv = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  // Nudge towards the camera so nearby debris does not clip the glow.
  mv.xyz *= max(0.0, 1.0 - uSize * 0.5 / max(length(mv.xyz), 1e-3));
  mv.xy += position.xy * uSize;
  vUv = position.xy;
  gl_Position = projectionMatrix * mv;
}
`;

const FLASH_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uI;
varying vec2 vUv;
void main() {
  float r2 = dot(vUv, vUv);
  if (r2 > 1.0) discard;
  float I = exp(-r2 * 5.0) + exp(-r2 * 28.0) * 1.5;
  gl_FragColor = vec4(uColor * I * uI, 1.0);
  ${OUTPUT_GLSL}
}
`;

const SHOCK_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uI;
uniform float uR;
varying vec2 vUv;
void main() {
  float r = length(vUv);
  float d = (r - uR) / 0.06;
  float I = exp(-d * d) * uI * smoothstep(1.0, 0.85, r);
  gl_FragColor = vec4(uColor * I, 1.0);
  ${OUTPUT_GLSL}
}
`;

// Fire and smoke puffs share one premultiplied-alpha pass: fire adds light, smoke occludes.
const PUFF_VERT = /* glsl */ `
attribute vec3 pDir;
attribute vec4 pParams; // speed, size, seed, delay
uniform float uAge;
uniform float uScale;
varying vec2 vUv;
varying float vT;
varying float vSeed;
void main() {
  float t = max(uAge - pParams.w, 0.0);
  float travel = pParams.x * (1.0 - exp(-2.6 * t)) / 2.6;
  vec3 c = pDir * travel * uScale;
  float size = uScale * pParams.y * (0.35 + 1.4 * (1.0 - exp(-3.2 * t)) + 0.35 * t);
  vec4 mv = modelViewMatrix * vec4(c, 1.0);
  mv.xy += position.xy * size;
  vUv = position.xy;
  vT = t;
  vSeed = pParams.z;
  gl_Position = uAge < pParams.w ? vec4(2.0, 2.0, 2.0, 1.0) : projectionMatrix * mv;
}
`;

const PUFF_FRAG = /* glsl */ `
uniform float uSmoke;
varying vec2 vUv;
varying float vT;
varying float vSeed;
${NOISE_GLSL}
void main() {
  float r = length(vUv);
  vec3 q = vec3(vUv * 2.2 + vSeed * 3.1, vSeed * 5.0 + vT * 1.6);
  float n = fbm(q, 3);
  float billow = ridged(q * 1.3 + 4.0, 2);
  float edge = 1.0 - smoothstep(0.75, 1.0, r);
  float shape = smoothstep(0.95, 0.2, r + n * 0.8 - billow * 0.25) * edge;
  float heat = exp(-vT * 3.2);
  // Hot cores, cooler lobes: temperature varies across each puff.
  float temp = heat * (1.15 - r * 0.6) * (0.75 + 0.6 * billow);
  vec3 fire = mix(vec3(0.45, 0.06, 0.01), vec3(1.5, 0.62, 0.18), smoothstep(0.15, 0.55, temp));
  fire = mix(fire, vec3(1.9, 1.55, 1.1), smoothstep(0.6, 1.0, temp));
  float fireA = shape * heat * heat * (0.55 + 0.7 * billow) * 2.2;
  float smokeShape = smoothstep(0.9, 0.35, r + n * 1.1 - billow * 0.35) * edge;
  float smokeA = smokeShape * (1.0 - heat) * uSmoke * (1.0 - smoothstep(0.85, 1.55, vT)) * smoothstep(0.1, 0.5, billow + n);
  // Lit dust-grey smoke (reads against black space), warmer while still hot.
  vec3 smoke = mix(vec3(0.075, 0.07, 0.066), vec3(0.16, 0.07, 0.03), heat);
  gl_FragColor = vec4(fire * fireA + smoke * smokeA, smokeA);
  ${OUTPUT_GLSL}
}
`;

/** Ship explosion: flash, fireball, debris sparks, ~1.5 s. `scale` ~ ship radius. */
export function createExplosion(position: THREE.Vector3, scale: number, ctx: ArtContext): TransientEffect {
  const rand = seededRandom(Math.floor(position.x * 13 + position.y * 7 + position.z * 3) ^ 0x5a5a);
  const group = new THREE.Group();
  group.name = 'explosion';
  group.position.copy(position);
  const calm = ctx.reducedMotion;
  const life = 1.6;
  const s = Math.max(0.1, scale);

  // Flash.
  const flashU = { uSize: { value: s * 2.4 }, uColor: { value: new THREE.Color(1.0, 0.85, 0.6) }, uI: { value: 0 } };
  const flash = new THREE.Mesh(
    unitQuad(),
    new THREE.ShaderMaterial({
      uniforms: flashU,
      vertexShader: BILLBOARD_VERT,
      fragmentShader: FLASH_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }),
  );
  flash.frustumCulled = false;
  flash.renderOrder = 10;
  group.add(flash);

  // Fireball / smoke puffs.
  const puffs = byQuality(ctx.quality, 7, 11, 16);
  const pg = instancedQuad(puffs);
  const pd = new Float32Array(puffs * 3);
  const pp = new Float32Array(puffs * 4);
  for (let i = 0; i < puffs; i++) {
    const z = rand() * 2 - 1;
    const a = rand() * Math.PI * 2;
    const r = Math.sqrt(1 - z * z);
    pd.set([Math.cos(a) * r, z, Math.sin(a) * r], i * 3);
    // One central core puff; the rest fly out into irregular lobes.
    pp.set([i === 0 ? 0.2 : 1.8 + rand() * 3.2, i === 0 ? 0.8 : 0.28 + rand() * 0.42, rand() * 10, i === 0 ? 0 : rand() * 0.18], i * 4);
  }
  pg.setAttribute('pDir', new THREE.InstancedBufferAttribute(pd, 3));
  pg.setAttribute('pParams', new THREE.InstancedBufferAttribute(pp, 4));
  const puffU = { uNoise: { value: getNoiseVolume() }, uAge: { value: 0 }, uScale: { value: s }, uSmoke: { value: 0.75 } };
  const puffMesh = new THREE.Mesh(
    pg,
    new THREE.ShaderMaterial({
      uniforms: puffU,
      vertexShader: PUFF_VERT,
      fragmentShader: PUFF_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.CustomBlending,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
      blendSrcAlpha: THREE.OneFactor,
      blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
    }),
  );
  puffMesh.frustumCulled = false;
  puffMesh.renderOrder = 9;
  group.add(puffMesh);

  // Sparks.
  const sparks = sparkMesh(byQuality(ctx.quality, 14, 26, 40), rand, [6, 16], 0.07, [0.45, 1.1], 0.05);
  sparks.u.uScale.value = s;
  sparks.u.uDrag.value = 2.2;
  group.add(sparks.mesh);

  // Shockwave ring (not with reduced motion; too large and sudden).
  const shockU = { uSize: { value: s * 3.6 }, uColor: { value: new THREE.Color(1.0, 0.7, 0.45) }, uI: { value: 0 }, uR: { value: 0 } };
  let shock: THREE.Mesh | null = null;
  if (!calm && ctx.quality !== 'low') {
    shock = new THREE.Mesh(
      unitQuad(),
      new THREE.ShaderMaterial({
        uniforms: shockU,
        vertexShader: BILLBOARD_VERT,
        fragmentShader: SHOCK_FRAG,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    shock.frustumCulled = false;
    shock.renderOrder = 10;
    group.add(shock);
  }

  // Tumbling hull shards.
  const shardCount = byQuality(ctx.quality, 0, 6, 10);
  let shards: THREE.InstancedMesh | null = null;
  const shardDir: THREE.Vector3[] = [];
  const shardSpin: THREE.Vector3[] = [];
  const shardSpeed: number[] = [];
  if (shardCount > 0) {
    const sg = new THREE.TetrahedronGeometry(1, 0);
    sg.scale(1, 0.35, 0.7);
    sg.setAttribute('color', new THREE.BufferAttribute(new Float32Array(sg.attributes.position!.count * 3).fill(0.3), 3));
    shards = new THREE.InstancedMesh(sg, metalMaterial(ctx.quality), shardCount);
    shards.frustumCulled = false;
    for (let i = 0; i < shardCount; i++) {
      shardDir.push(new THREE.Vector3(rand() - 0.5, rand() - 0.5, rand() - 0.5).normalize());
      shardSpin.push(new THREE.Vector3(rand() - 0.5, rand() - 0.5, rand() - 0.5).normalize().multiplyScalar(4 + rand() * 8));
      shardSpeed.push(3 + rand() * 6);
    }
    group.add(shards);
  }
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const pv = new THREE.Vector3();
  const sv = new THREE.Vector3();

  let age = 0;
  const flashPeak = calm ? 0.9 : 3.2;
  const flashRate = calm ? 5 : 13;
  const step = (): void => {
    flashU.uI.value = flashPeak * Math.exp(-age * flashRate) * Math.min(1, age * 40 + 0.4);
    puffU.uAge.value = age;
    sparks.u.uAge.value = age;
    if (shock) {
      const x = age / 0.5;
      shockU.uR.value = Math.min(1, 0.15 + x * 0.8);
      shockU.uI.value = x < 1 ? (1 - x) * (1 - x) * 0.45 : 0;
      shock.visible = x < 1;
    }
    if (shards) {
      for (let i = 0; i < shardCount; i++) {
        const k = 2.0;
        const travel = (shardSpeed[i]! * (1 - Math.exp(-k * age))) / k;
        pv.copy(shardDir[i]!).multiplyScalar(travel * s);
        const sp = shardSpin[i]!;
        e.set(sp.x * age, sp.y * age, sp.z * age);
        q.setFromEuler(e);
        const shrink = 1 - THREE.MathUtils.smoothstep(age, life - 0.5, life);
        sv.setScalar(s * 0.12 * (0.6 + (i % 3) * 0.3) * shrink);
        m.compose(pv, q, sv);
        shards.setMatrixAt(i, m);
      }
      shards.instanceMatrix.needsUpdate = true;
    }
  };
  step();
  return {
    object: group,
    get finished() {
      return age >= life;
    },
    update(dt) {
      age += dt;
      step();
    },
    dispose: () => disposeObject(group),
  };
}

/** Small hit spark where a bolt strikes a shield or hull, ~0.3 s. */
export function createImpactSpark(position: THREE.Vector3, color: THREE.ColorRepresentation, ctx: ArtContext): TransientEffect {
  const rand = seededRandom(Math.floor(position.x * 31 + position.y * 17 + position.z * 11) ^ 0x33);
  const group = new THREE.Group();
  group.name = 'impact-spark';
  group.position.copy(position);
  const tint = new THREE.Color(color);
  const flashU = { uSize: { value: 2.2 }, uColor: { value: tint.clone().lerp(new THREE.Color(1, 1, 1), 0.4) }, uI: { value: 0 } };
  const flash = new THREE.Mesh(
    unitQuad(),
    new THREE.ShaderMaterial({
      uniforms: flashU,
      vertexShader: BILLBOARD_VERT,
      fragmentShader: FLASH_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }),
  );
  flash.frustumCulled = false;
  flash.renderOrder = 10;
  group.add(flash);
  const sp = sparkMesh(byQuality(ctx.quality, 6, 10, 14), rand, [8, 22], 0.05, [0.14, 0.3], 0.02);
  sp.u.uDrag.value = 6;
  sp.u.uHot.value.set(1.5, 1.4, 1.2);
  sp.u.uCool.value.copy(tint).multiplyScalar(1.4);
  group.add(sp.mesh);
  const life = 0.32;
  const peak = ctx.reducedMotion ? 0.8 : 1.8;
  let age = 0;
  const step = (): void => {
    flashU.uI.value = peak * Math.exp(-age * 16);
    sp.u.uAge.value = age;
  };
  step();
  return {
    object: group,
    get finished() {
      return age >= life;
    },
    update(dt) {
      age += dt;
      step();
    },
    dispose: () => disposeObject(group),
  };
}

/* ------------------------------------------------------------------------------------------------
 * Missile with exhaust and a short world-space ribbon trail.
 * ---------------------------------------------------------------------------------------------- */

const TRAIL_VERT = /* glsl */ `
attribute float aT;
varying float vT;
void main() {
  vT = aT;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const TRAIL_FRAG = /* glsl */ `
uniform vec3 uHot;
uniform vec3 uCool;
varying float vT;
void main() {
  float a = pow(1.0 - vT, 1.6);
  vec3 col = mix(uHot, uCool, smoothstep(0.0, 0.5, vT));
  gl_FragColor = vec4(col * a, 1.0);
  ${OUTPUT_GLSL}
}
`;

/** Missile body with exhaust; faces -Z. ~3 units long. */
export function createMissileArt(ctx: ArtContext): ArtObject<THREE.Group> {
  const group = new THREE.Group();
  group.name = 'missile';
  const kit = new Kit(1);
  const seg = byQuality(ctx.quality, 6, 8, 10);
  kit.add('hull', latheZ([[0.001, -1.6], [0.1, -1.35], [0.17, -1.0], [0.18, 1.1], [0.14, 1.3]], seg), { color: '#dfe3e6' });
  kit.add('hull', latheZ([[0.185, -0.55], [0.185, -0.35]], seg), { color: '#c0392b' });
  kit.add('metal', latheZ([[0.14, 1.3], [0.12, 1.42], [0.16, 1.5], [0.09, 1.48]], seg), { color: '#3a3f45' });
  kit.add('emissive', new THREE.CircleGeometry(0.1, seg), { position: [0, 0, 1.47], color: '#ffd08a', intensity: 3 });
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    kit.add('hull', slab([[0.15, 0.5], [0.15, 1.25], [0.5, 1.3], [0.5, 1.0]], 0.04, 0.01), { rotation: [0, 0, a], color: '#9aa1a8' });
  }
  kit.build(group, standardSet(ctx.quality));
  const glow = createLightPoints(
    [
      { p: [0, 0, 1.62], color: '#ffc27a', size: 1.6, intensity: 2.2 },
      { p: [0, 0, 2.1], color: '#ff7a3a', size: 2.6, intensity: 0.6 },
    ],
    ctx,
    3,
  );
  group.add(glow.points);

  // Trail ribbon (world space: its matrixWorld stays identity).
  const N = byQuality(ctx.quality, 12, 18, 24);
  const spacing = 0.6;
  const hist = new Float32Array(N * 3);
  const verts = new Float32Array(N * 2 * 3);
  const tAttr = new Float32Array(N * 2);
  const idx: number[] = [];
  for (let i = 0; i < N; i++) {
    tAttr[i * 2] = i / (N - 1);
    tAttr[i * 2 + 1] = i / (N - 1);
    if (i < N - 1) {
      const a = i * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }
  const tg = new THREE.BufferGeometry();
  const posAttr = new THREE.BufferAttribute(verts, 3).setUsage(THREE.DynamicDrawUsage);
  tg.setAttribute('position', posAttr);
  tg.setAttribute('aT', new THREE.BufferAttribute(tAttr, 1));
  tg.setIndex(idx);
  const trail = new THREE.Mesh(
    tg,
    new THREE.ShaderMaterial({
      uniforms: { uHot: { value: new THREE.Color(1.3, 0.75, 0.35) }, uCool: { value: new THREE.Color(0.18, 0.2, 0.26) } },
      vertexShader: TRAIL_VERT,
      fragmentShader: TRAIL_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    }),
  );
  trail.name = 'trail';
  trail.frustumCulled = false;
  trail.matrixAutoUpdate = false;
  trail.matrixWorldAutoUpdate = false;
  trail.visible = false;
  group.add(trail);

  const nozzle = new THREE.Vector3();
  const cam = new THREE.Vector3();
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const tan = new THREE.Vector3();
  const side = new THREE.Vector3();
  const toCam = new THREE.Vector3();
  let primed = false;
  const flick = ctx.reducedMotion ? 0 : 1;
  return {
    object: group,
    update(_dt, time, camera) {
      group.updateWorldMatrix(true, false);
      nozzle.set(0, 0, 1.6).applyMatrix4(group.matrixWorld);
      if (!primed) {
        for (let i = 0; i < N; i++) hist.set([nozzle.x, nozzle.y, nozzle.z], i * 3);
        primed = true;
      }
      a.set(hist[3]!, hist[4]!, hist[5]!);
      if (a.distanceToSquared(nozzle) > spacing * spacing) {
        hist.copyWithin(3, 0, (N - 1) * 3);
      }
      hist[0] = nozzle.x;
      hist[1] = nozzle.y;
      hist[2] = nozzle.z;
      camera.getWorldPosition(cam);
      for (let i = 0; i < N; i++) {
        const i0 = Math.max(0, i - 1);
        const i1 = Math.min(N - 1, i + 1);
        a.set(hist[i0 * 3]!, hist[i0 * 3 + 1]!, hist[i0 * 3 + 2]!);
        b.set(hist[i1 * 3]!, hist[i1 * 3 + 1]!, hist[i1 * 3 + 2]!);
        tan.subVectors(a, b);
        const px = hist[i * 3]!;
        const py = hist[i * 3 + 1]!;
        const pz = hist[i * 3 + 2]!;
        toCam.set(cam.x - px, cam.y - py, cam.z - pz);
        side.crossVectors(tan, toCam);
        const len = side.length();
        const w = 0.12 + 0.28 * (i / (N - 1));
        if (len > 1e-6) side.multiplyScalar(w / len);
        else side.set(0, w, 0);
        verts[i * 6] = px + side.x;
        verts[i * 6 + 1] = py + side.y;
        verts[i * 6 + 2] = pz + side.z;
        verts[i * 6 + 3] = px - side.x;
        verts[i * 6 + 4] = py - side.y;
        verts[i * 6 + 5] = pz - side.z;
      }
      posAttr.needsUpdate = true;
      trail.visible = true;
      glow.uniforms.uTime.value = time;
      glow.uniforms.uIntensity.value = 1 + flick * 0.15 * Math.sin(time * 61) * Math.sin(time * 37);
    },
    dispose: () => disposeObject(group),
  };
}

/* ------------------------------------------------------------------------------------------------
 * Cargo pod.
 * ---------------------------------------------------------------------------------------------- */

/** Floating loot container with a blinking beacon, ~3 units. */
export function createCargoPod(ctx: ArtContext): ArtObject<THREE.Group> {
  const group = new THREE.Group();
  group.name = 'cargo-pod';
  const spin = new THREE.Group();
  group.add(spin);
  const kit = new Kit(1.2);
  const seg = byQuality(ctx.quality, 8, 10, 14);
  kit.add('hull', latheZ([[0.55, -1.55], [0.85, -1.3], [0.9, -0.9], [0.9, 0.9], [0.85, 1.3], [0.55, 1.55]], seg), { color: '#c98a2e' });
  kit.add('metal', latheZ([[0.001, -1.62], [0.56, -1.56]], seg), { color: '#3b4046' });
  kit.add('metal', latheZ([[0.56, 1.56], [0.001, 1.62]], seg), { color: '#3b4046' });
  for (const z of [-0.95, 0, 0.95]) {
    kit.add('metal', new THREE.TorusGeometry(0.92, 0.07, 5, seg), { position: [0, 0, z], color: '#2f3338' });
  }
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    kit.add('hull', new THREE.BoxGeometry(0.2, 0.06, 0.5), {
      position: [Math.cos(a) * 0.92, Math.sin(a) * 0.92, -0.48],
      rotation: [0, 0, a + Math.PI / 2],
      color: i % 2 ? '#1f2226' : '#e8c440',
    });
  }
  kit.add('metal', new THREE.BoxGeometry(0.16, 0.5, 0.9), { position: [0, 0.98, 0.45], color: '#2f3338' });
  kit.add('emissive', new THREE.SphereGeometry(0.14, 8, 6), { position: [0, 0, 1.66], color: '#ffb640', intensity: 2.2 });
  kit.build(spin, standardSet(ctx.quality));
  const beacon = createLightPoints(
    [
      { p: [0, 0, 1.75], color: '#ffb640', size: 2.2, intensity: 2.4, blink: 1.0, duty: 0.3, min: 0.12 },
      { p: [0, 0, -1.75], color: '#ffb640', size: 1.2, intensity: 1.0, blink: 1.0, duty: 0.3, phase: 0.5, min: 0.1 },
    ],
    ctx,
    3,
  );
  spin.add(beacon.points);
  spin.rotation.x = 0.4;
  return {
    object: group,
    update(_dt, time) {
      spin.rotation.y = time * 0.35;
      spin.rotation.z = Math.sin(time * 0.4) * 0.3;
      beacon.uniforms.uTime.value = time;
    },
    dispose: () => disposeObject(group),
  };
}

/* ------------------------------------------------------------------------------------------------
 * Speed streaks (camera child).
 * ---------------------------------------------------------------------------------------------- */

export interface SpeedStreaksArt extends ArtObject {
  /** 0 = hidden, 1 = full trade-lane streaks. Add `object` as a child of the camera. */
  setIntensity(value: number): void;
}

const STREAK_VERT = /* glsl */ `
attribute vec4 aSeed; // angle, radius, phase, variation
uniform float uTime;
uniform float uRange;
uniform float uSpeed;
uniform float uLength;
varying float vFade;
varying vec2 vUv;
void main() {
  float z = -uRange + mod(aSeed.z * uRange + uTime * uSpeed * (0.7 + 0.6 * aSeed.w), uRange);
  float c = cos(aSeed.x);
  float s = sin(aSeed.x);
  vec3 center = vec3(c * aSeed.y, s * aSeed.y, z);
  vec3 tangent = vec3(-s, c, 0.0);
  float len = uLength * (0.6 + 0.8 * aSeed.w);
  float width = 0.035 * aSeed.y * 0.12 + 0.02;
  vec3 p = center + vec3(0.0, 0.0, 1.0) * position.y * len * 0.5 + tangent * position.x * width;
  vFade = smoothstep(-uRange, -uRange * 0.72, z) * (1.0 - smoothstep(-uRange * 0.12, -2.0, z));
  vUv = position.xy;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}
`;

const STREAK_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uOpacity;
varying float vFade;
varying vec2 vUv;
void main() {
  float across = 1.0 - vUv.x * vUv.x;
  float along = 1.0 - abs(vUv.y);
  float I = across * along * along * vFade * uOpacity;
  gl_FragColor = vec4(uColor * I, 1.0);
  ${OUTPUT_GLSL}
}
`;

/** Camera-attached motion streaks for cruise and lane travel. */
export function createSpeedStreaks(ctx: ArtContext): SpeedStreaksArt {
  const calm = ctx.reducedMotion;
  const max = Math.round(byQuality(ctx.quality, 70, 130, 200) * (calm ? 0.5 : 1));
  const rand = seededRandom(909);
  const g = instancedQuad(0);
  const seeds = new Float32Array(max * 4);
  for (let i = 0; i < max; i++) {
    // Keep a clear cone around the view centre (the ship sits there).
    seeds.set([rand() * Math.PI * 2, 5 + Math.pow(rand(), 0.7) * 30, rand(), rand()], i * 4);
  }
  g.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 4));
  const u = {
    uTime: { value: 0 },
    uRange: { value: 160 },
    uSpeed: { value: 160 },
    uLength: { value: 14 },
    uColor: { value: new THREE.Color(0.75, 0.9, 1.2) },
    uOpacity: { value: 0 },
  };
  const mesh = new THREE.Mesh(
    g,
    new THREE.ShaderMaterial({
      uniforms: u,
      vertexShader: STREAK_VERT,
      fragmentShader: STREAK_FRAG,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    }),
  );
  mesh.name = 'speed-streaks';
  mesh.frustumCulled = false;
  mesh.renderOrder = 50;
  mesh.visible = false;
  let level = 0;
  let target = 0;
  let clock = 0;
  const cruiseCol = new THREE.Color(0.75, 0.88, 1.15);
  const laneCol = new THREE.Color(0.45, 1.05, 1.35);
  return {
    object: mesh,
    setIntensity(v) {
      target = Math.max(0, Math.min(1, v));
    },
    update(dt) {
      level = approach(level, target, 2.5, dt);
      mesh.visible = level > 0.01;
      if (!mesh.visible) return;
      const speed = (60 + 260 * level) * (calm ? 0.35 : 1);
      clock += dt * speed;
      // uTime * uSpeed = distance travelled; keep uSpeed = 1 so speed changes never jump.
      u.uTime.value = clock;
      u.uSpeed.value = 1;
      u.uLength.value = (6 + 26 * level) * (calm ? 0.6 : 1);
      u.uOpacity.value = (0.12 + 0.55 * level) * (calm ? 0.55 : 1);
      u.uColor.value.copy(cruiseCol).lerp(laneCol, THREE.MathUtils.smoothstep(level, 0.4, 0.9));
      g.instanceCount = Math.round(max * Math.min(1, 0.2 + level * 0.9));
    },
    dispose: () => disposeObject(mesh),
  };
}

/* ------------------------------------------------------------------------------------------------
 * Jump tunnel (camera child).
 * ---------------------------------------------------------------------------------------------- */

export interface JumpTunnelArt extends ArtObject {
  /** 0..1 progress through the jump transition. Add `object` as a child of the camera. */
  setProgress(value: number): void;
}

const TUNNEL_VERT = /* glsl */ `
varying vec3 vLocal;
void main() {
  vLocal = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const TUNNEL_FRAG = /* glsl */ `
uniform float uTime;
uniform float uAlpha;
uniform float uFlow;
uniform float uLength;
uniform float uContrast;
uniform vec3 uC1;
uniform vec3 uC2;
varying vec3 vLocal;
${NOISE_GLSL}
void main() {
  float a = atan(vLocal.y, vLocal.x);
  float z = -vLocal.z / uLength; // 0 near the camera .. 1 far end
  vec3 q = vec3(cos(a) * 2.0, sin(a) * 2.0, vLocal.z * 0.035 + uTime * uFlow);
  float n = fbm(q, 3);
  float streaks = pow(max(snoise(vec3(cos(a) * 4.0, sin(a) * 4.0, vLocal.z * 0.012 + uTime * uFlow * 1.6)) * 1.6, 0.0), 2.0);
  float rings = pow(0.5 + 0.5 * sin(vLocal.z * 0.12 + uTime * uFlow * 12.0 + n * 3.0), 8.0);
  float I = (0.18 + 0.35 * smoothstep(-0.2, 0.4, n)) + streaks * 0.55 * uContrast + rings * 0.3 * uContrast;
  vec3 col = mix(uC1, uC2, smoothstep(-0.3, 0.5, n + z * 0.4 + streaks * 0.3));
  float ends = smoothstep(0.0, 0.08, z) * (1.0 - smoothstep(0.75, 1.0, z));
  gl_FragColor = vec4(col * I * uAlpha * ends, 1.0);
  ${OUTPUT_GLSL}
}
`;

const SCREEN_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uI;
uniform float uVignette;
varying vec2 vUv;
void main() {
  float r2 = dot(vUv, vUv);
  // Flash plus a soft edge vignette glow during the build-up.
  float v = smoothstep(0.2, 1.4, r2) * uVignette;
  gl_FragColor = vec4(uColor * (uI + v), 1.0);
  ${OUTPUT_GLSL}
}
`;

const SCREEN_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = position.xy;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

/** Camera-attached fictional jump tunnel effect. */
export function createJumpTunnel(ctx: ArtContext): JumpTunnelArt {
  const calm = ctx.reducedMotion;
  const group = new THREE.Group();
  group.name = 'jump-tunnel';
  group.visible = false;
  const length = 260;
  const tubeGeo = new THREE.CylinderGeometry(9, 9, length, byQuality(ctx.quality, 24, 32, 48), byQuality(ctx.quality, 8, 12, 16), true);
  tubeGeo.rotateX(Math.PI / 2);
  tubeGeo.translate(0, 0, -length / 2 - 2);
  const tu = {
    uNoise: { value: getNoiseVolume() },
    uTime: { value: 0 },
    uAlpha: { value: 0 },
    uFlow: { value: 0.6 },
    uLength: { value: length },
    uContrast: { value: calm ? 0.35 : 1 },
    uC1: { value: new THREE.Color(0.28, 0.12, 0.75) },
    uC2: { value: new THREE.Color(0.35, 0.85, 1.3) },
  };
  const tube = new THREE.Mesh(
    tubeGeo,
    new THREE.ShaderMaterial({
      uniforms: tu,
      vertexShader: TUNNEL_VERT,
      fragmentShader: TUNNEL_FRAG,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: THREE.AdditiveBlending,
      side: THREE.BackSide,
    }),
  );
  tube.frustumCulled = false;
  tube.renderOrder = 60;
  group.add(tube);

  // Bright gate at the far end of the tunnel.
  const gateU = { uSize: { value: 30 }, uColor: { value: new THREE.Color(0.85, 0.75, 1.3) }, uI: { value: 0 } };
  const gate = new THREE.Mesh(
    unitQuad(),
    new THREE.ShaderMaterial({
      uniforms: gateU,
      vertexShader: BILLBOARD_VERT,
      fragmentShader: FLASH_FRAG,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: THREE.AdditiveBlending,
    }),
  );
  gate.position.z = -length * 0.8;
  gate.frustumCulled = false;
  gate.renderOrder = 61;
  group.add(gate);

  // Full-screen flash / vignette (clip-space quad).
  const su = { uColor: { value: new THREE.Color(0.85, 0.8, 1.0) }, uI: { value: 0 }, uVignette: { value: 0 } };
  const screen = new THREE.Mesh(
    unitQuad(),
    new THREE.ShaderMaterial({
      uniforms: su,
      vertexShader: SCREEN_VERT,
      fragmentShader: SCREEN_FRAG,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: THREE.AdditiveBlending,
    }),
  );
  screen.frustumCulled = false;
  screen.renderOrder = 62;
  group.add(screen);

  let progress = 0;
  let clock = 0;
  const vignetteCol = new THREE.Color(0.45, 0.3, 0.9);
  const flashCol = new THREE.Color(0.9, 0.88, 1.0);
  return {
    object: group,
    setProgress(v) {
      progress = Math.max(0, Math.min(1, v));
    },
    update(dt) {
      const p = progress;
      group.visible = p > 0.001 && p < 0.999;
      if (!group.visible) return;
      const ss = THREE.MathUtils.smoothstep;
      // Build-up 0-0.3, tunnel 0.25-0.85, flash 0.82-1.
      const build = ss(p, 0.0, 0.3);
      const tunnel = ss(p, 0.18, 0.4) * (1 - ss(p, 0.86, 0.95));
      const flash = ss(p, 0.8, 0.9) * (1 - ss(p, 0.9, 1.0));
      const flow = (calm ? 0.25 : 0.6) + (calm ? 0.5 : 2.2) * ss(p, 0.2, 0.8);
      clock += dt * flow;
      tu.uTime.value = clock;
      tu.uFlow.value = 1;
      tu.uAlpha.value = tunnel * (calm ? 0.28 : 0.75) + build * (calm ? 0.05 : 0.1);
      gateU.uI.value = (build * 0.45 + tunnel * 0.3) * (calm ? 0.4 : 1);
      gateU.uSize.value = 10 + 26 * build;
      su.uVignette.value = build * (1 - flash) * (calm ? 0.06 : 0.18);
      // Reduced motion: a soft brightening instead of a white-out.
      su.uI.value = flash * (calm ? 0.16 : 1.6);
      su.uColor.value.copy(vignetteCol).lerp(flashCol, flash);
    },
    dispose: () => disposeObject(group),
  };
}
