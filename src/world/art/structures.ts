import * as THREE from 'three';
import type { ArtContext, ArtObject } from './types.ts';
import { Kit, latheZ, rod, slab } from './kit.ts';
import { createLightPoints } from './lights.ts';
import type { LightSpec } from './lights.ts';
import { standardSet } from './materials.ts';
import { NOISE_GLSL, OUTPUT_GLSL, getNoiseVolume } from './noise.ts';
import { approach, byQuality, disposeObject } from './util.ts';

export interface LaneRingArt extends ArtObject<THREE.Group> {
  /** Inner opening radius; the lane axis runs along the ring's local Z. */
  readonly radius: number;
  /** Lit when a ship is travelling through the lane. */
  setActive(on: boolean): void;
}

const FIELD_VERT = /* glsl */ `
varying vec3 vLocal;
void main() {
  vLocal = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

// Disc across the opening: ripples converging on the axis plus a bright rim.
const DISC_FRAG = /* glsl */ `
uniform float uTime;
uniform float uActive;
uniform float uRadius;
uniform vec3 uColor;
varying vec3 vLocal;
${NOISE_GLSL}
void main() {
  vec2 p = vLocal.xy / uRadius;
  float r = length(p);
  float a = atan(p.y, p.x);
  float n = snoise(vec3(p * 2.5, uTime * 0.35));
  // Ripples converge on the axis; the middle stays clear so ships read through the field.
  float rings = pow(0.5 + 0.5 * sin(r * 20.0 + uTime * 3.0 + n * 1.5), 5.0);
  float swirl = pow(0.5 + 0.5 * sin(a * 3.0 + r * 6.0 - uTime * 0.6 + n), 4.0);
  float rim = smoothstep(0.72, 1.0, r) * (1.0 - smoothstep(0.97, 1.0, r));
  float body = (rings * 0.16 + swirl * 0.05) * smoothstep(0.15, 0.9, r) + rim * 0.55 + 0.015;
  float idle = 0.06 * (0.6 + 0.4 * n) * smoothstep(0.6, 1.0, r);
  float I = mix(idle, body, uActive) * (1.0 - smoothstep(0.98, 1.0, r));
  gl_FragColor = vec4(uColor * I, 1.0);
  ${OUTPUT_GLSL}
}
`;

// Short sleeve along the lane axis: streaks streaming through the ring.
const SLEEVE_FRAG = /* glsl */ `
uniform float uTime;
uniform float uActive;
uniform float uLength;
uniform vec3 uColor;
varying vec3 vLocal;
${NOISE_GLSL}
void main() {
  float a = atan(vLocal.y, vLocal.x);
  float z = vLocal.z / uLength;
  float s = snoise(vec3(cos(a) * 3.0, sin(a) * 3.0, vLocal.z * 0.06 - uTime * 1.6));
  float streak = pow(max(s, 0.0) * 1.8, 3.0);
  float fade = 1.0 - smoothstep(0.2, 0.5, abs(z));
  gl_FragColor = vec4(uColor * streak * fade * uActive * 0.8, 1.0);
  ${OUTPUT_GLSL}
}
`;

/** Fictional trade-lane ring, ~70 units across. */
export function createLaneRing(ctx: ArtContext): LaneRingArt {
  const group = new THREE.Group();
  group.name = 'lane-ring';
  const kit = new Kit(4);
  const R = 30.5;
  const inner = 26;
  const segs = 8;
  const gap = 0.12;
  const tub = byQuality(ctx.quality, 4, 6, 8);
  const lights: LightSpec[] = [];
  for (let i = 0; i < segs; i++) {
    const a0 = (i / segs) * Math.PI * 2 + gap / 2;
    const arc = (Math.PI * 2) / segs - gap;
    // Faceted arc (hexagonal section) with a lighter outer cap band.
    kit.add('metal', new THREE.TorusGeometry(R, 4.2, 6, tub, arc), { rotation: [0, 0, a0], color: '#4a5058' });
    kit.add('hull', new THREE.TorusGeometry(R + 3.2, 1.6, 4, tub, arc * 0.8), { rotation: [0, 0, a0 + arc * 0.1], color: '#b9c0c8' });
    const mid = a0 + arc / 2;
    const c = Math.cos(mid);
    const s = Math.sin(mid);
    // Emitter pod on the inner face.
    kit.add('hull', new THREE.BoxGeometry(3.4, 4.2, 6.5), { position: [c * (inner + 1.2), s * (inner + 1.2), 0], rotation: [0, 0, mid], color: '#8e969f' });
    kit.add('dark', new THREE.BoxGeometry(1.0, 3.0, 5.0), { position: [c * (inner - 0.5), s * (inner - 0.5), 0], rotation: [0, 0, mid] });
    lights.push({ p: [c * (inner - 1.2), s * (inner - 1.2), 0], color: '#5ff4ff', size: 5, intensity: 1 });
    // Joint collars at the gaps.
    const ja = a0 - gap / 2;
    kit.add('metal', new THREE.BoxGeometry(5.4, 2.2, 10), { position: [Math.cos(ja) * R, Math.sin(ja) * R, 0], rotation: [0, 0, ja], color: '#2e3339' });
  }
  // Four outrigger fins with nav lights.
  const navLights: LightSpec[] = [];
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const c = Math.cos(a);
    const s = Math.sin(a);
    kit.add('hull', slab([[0, -4], [0, 4], [6, 2], [6, -1]], 0.8, 0.2), {
      position: [c * (R + 3.5), s * (R + 3.5), 0],
      rotation: [Math.PI / 2, 0, a],
      color: '#9aa2ab',
    });
    navLights.push({ p: [c * (R + 10), s * (R + 10), 0], color: '#ffb347', size: 2.5, intensity: 1.6, blink: 0.5, phase: i * 0.25, duty: 0.2, min: 0.1 });
  }
  kit.build(group, standardSet(ctx.quality));

  const emit = createLightPoints(lights, ctx);
  emit.points.name = 'emitters';
  group.add(emit.points);
  const nav = createLightPoints(navLights, ctx);
  group.add(nav.points);

  const noise = getNoiseVolume();
  const color = new THREE.Color(0.35, 0.95, 1.25);
  const discU = {
    uNoise: { value: noise },
    uTime: { value: 0 },
    uActive: { value: 0 },
    uRadius: { value: inner },
    uColor: { value: color },
  };
  const disc = new THREE.Mesh(
    new THREE.CircleGeometry(inner, byQuality(ctx.quality, 32, 48, 64)),
    new THREE.ShaderMaterial({
      uniforms: discU,
      vertexShader: FIELD_VERT,
      fragmentShader: DISC_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    }),
  );
  disc.name = 'field';
  disc.renderOrder = 4;
  group.add(disc);
  const sleeveLen = 60;
  const sleeveGeo = new THREE.CylinderGeometry(inner - 1, inner - 1, sleeveLen, byQuality(ctx.quality, 24, 32, 48), 1, true);
  sleeveGeo.rotateX(Math.PI / 2);
  const sleeveU = {
    uNoise: { value: noise },
    uTime: { value: 0 },
    uActive: { value: 0 },
    uLength: { value: sleeveLen },
    uColor: { value: color },
  };
  const sleeve = new THREE.Mesh(
    sleeveGeo,
    new THREE.ShaderMaterial({
      uniforms: sleeveU,
      vertexShader: FIELD_VERT,
      fragmentShader: SLEEVE_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    }),
  );
  sleeve.name = 'sleeve';
  sleeve.renderOrder = 4;
  sleeve.visible = false;
  group.add(sleeve);

  let active = 0;
  let target = 0;
  const flow = ctx.reducedMotion ? 0.3 : 1;
  return {
    object: group,
    radius: inner,
    setActive(on) {
      target = on ? 1 : 0;
    },
    update(dt, time) {
      active = approach(active, target, 3, dt);
      const t = time * flow;
      discU.uTime.value = t;
      discU.uActive.value = active;
      sleeveU.uTime.value = t;
      sleeveU.uActive.value = active;
      sleeve.visible = active > 0.02;
      emit.uniforms.uIntensity.value = 0.35 + 1.4 * active;
      emit.uniforms.uSize.value = 0.8 + 0.5 * active;
      emit.uniforms.uTime.value = time;
      nav.uniforms.uTime.value = time;
    },
    dispose: () => disposeObject(group),
  };
}

/* ------------------------------------------------------------------------------------------------
 * Jump beacon: tall spire with a pulsing violet ring.
 * ---------------------------------------------------------------------------------------------- */

const RING_FRAG = /* glsl */ `
uniform float uPulse;
uniform vec3 uColor;
varying vec3 vN;
varying vec3 vV;
void main() {
  float f = 1.0 - abs(dot(normalize(vN), normalize(vV)));
  float I = (0.55 + 0.9 * f * f) * uPulse;
  gl_FragColor = vec4(uColor * I, 1.0);
  ${OUTPUT_GLSL}
}
`;

const RING_VERT = /* glsl */ `
varying vec3 vN;
varying vec3 vV;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vN = normalize(normalMatrix * normal);
  vV = -mv.xyz;
  gl_Position = projectionMatrix * mv;
}
`;

/** Jump arrival/departure beacon (fictional), ~40 units tall. */
export function createJumpBeacon(ctx: ArtContext): ArtObject {
  const group = new THREE.Group();
  group.name = 'jump-beacon';
  const kit = new Kit(3);
  const seg = byQuality(ctx.quality, 8, 12, 16);
  const toY = new THREE.Euler(-Math.PI / 2, 0, 0);
  const rot: [number, number, number] = [toY.x, toY.y, toY.z];
  // Spire (profile along Z, turned to +Y).
  kit.add('hull', latheZ([[5.5, 0], [4.2, 3], [2.6, 10], [3.4, 18], [3.4, 22], [2.0, 27], [1.1, 34], [0.25, 42]], seg), { rotation: rot, color: '#7d858f' });
  kit.add('metal', latheZ([[5.6, 0.2], [5.6, 1.4], [4.6, 2.4]], seg), { rotation: rot, color: '#2e3339' });
  // Violet accent strips running up the spire.
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    rod(kit, 'emissive', [Math.cos(a) * 2.75, 10.5, Math.sin(a) * 2.75], [Math.cos(a) * 3.45, 17.5, Math.sin(a) * 3.45], 0.14, '#9a6cff', 4, { intensity: 1.4 });
    rod(kit, 'emissive', [Math.cos(a) * 1.95, 27.5, Math.sin(a) * 1.95], [Math.cos(a) * 1.15, 33.5, Math.sin(a) * 1.15], 0.1, '#9a6cff', 4, { intensity: 1.4 });
  }
  kit.add('emissive', latheZ([[3.45, 18.5], [3.45, 21.5]], seg), { rotation: rot, color: '#b07aff', intensity: 2.2 });
  kit.add('emissive', latheZ([[1.9, 27.5], [1.6, 29]], seg), { rotation: rot, color: '#b07aff', intensity: 1.8 });
  // Tripod of swept fins at the base, each with a violet edge light.
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    const finGeo = slab([[2, -2], [9.5, -4], [10, -2.6], [3.5, 9]], 0.8, 0.2);
    finGeo.rotateX(-Math.PI / 2);
    kit.add('hull', finGeo, { rotation: [0, -a, 0], color: '#8a929c' });
    rod(kit, 'emissive', [Math.cos(a) * 9.6, -3.6, Math.sin(a) * 9.6], [Math.cos(a) * 3.6, 8.6, Math.sin(a) * 3.6], 0.18, '#b07aff', 5, { intensity: 1.6 });
  }
  kit.build(group, standardSet(ctx.quality));

  // Pulsing violet rings (floating, slowly turning).
  const ringU = { uPulse: { value: 1 }, uColor: { value: new THREE.Color(0.75, 0.42, 1.6) } };
  const ringMat = new THREE.ShaderMaterial({
    uniforms: ringU,
    vertexShader: RING_VERT,
    fragmentShader: RING_FRAG,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const ringGroup = new THREE.Group();
  ringGroup.position.y = 24;
  group.add(ringGroup);
  const ring1 = new THREE.Mesh(new THREE.TorusGeometry(12, 0.7, 8, byQuality(ctx.quality, 48, 64, 96)), ringMat);
  ring1.rotation.x = Math.PI / 2 + 0.22;
  ringGroup.add(ring1);
  const ring2 = new THREE.Mesh(new THREE.TorusGeometry(8.5, 0.4, 6, byQuality(ctx.quality, 40, 48, 72)), ringMat);
  ring2.rotation.x = Math.PI / 2 - 0.3;
  ring2.position.y = 5;
  ringGroup.add(ring2);
  const lights: LightSpec[] = [];
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    lights.push({ p: [Math.cos(a) * 12, 0, Math.sin(a) * 12], color: '#c89bff', size: 3.2, intensity: 1.4, blink: 0.5, phase: i / 12, duty: 0.35, min: 0.25 });
  }
  const ringLights = createLightPoints(lights, ctx);
  ringGroup.add(ringLights.points);
  const tip = createLightPoints(
    [
      { p: [0, 43, 0], color: '#d6b8ff', size: 9, intensity: 1.8 },
      { p: [0, 20, 0], color: '#a070ff', size: 16, intensity: 0.35 },
    ],
    ctx,
    4,
  );
  group.add(tip.points);

  const calm = ctx.reducedMotion;
  return {
    object: group,
    update(_dt, time) {
      const pulse = calm ? 0.8 + 0.2 * Math.sin(time * 0.9) : 0.65 + 0.35 * Math.pow(0.5 + 0.5 * Math.sin(time * 2.4), 2);
      ringU.uPulse.value = pulse;
      ringGroup.rotation.y = time * (calm ? 0.1 : 0.22);
      ring2.rotation.z = -time * (calm ? 0.15 : 0.35);
      ringGroup.position.y = 24 + Math.sin(time * 0.6) * (calm ? 0.3 : 0.8);
      ringLights.uniforms.uTime.value = time;
      ringLights.uniforms.uIntensity.value = pulse;
      tip.uniforms.uTime.value = time;
      tip.uniforms.uIntensity.value = 0.7 + 0.3 * pulse;
    },
    dispose: () => disposeObject(group),
  };
}

/* ------------------------------------------------------------------------------------------------
 * Nav buoy: small finned body with a coloured light.
 * ---------------------------------------------------------------------------------------------- */

/** Small navigation buoy with a coloured light. */
export function createNavBuoy(color: THREE.ColorRepresentation, ctx: ArtContext): ArtObject {
  const group = new THREE.Group();
  group.name = 'nav-buoy';
  const kit = new Kit(1.5);
  const seg = byQuality(ctx.quality, 6, 8, 10);
  kit.add('hull', new THREE.OctahedronGeometry(1.6, 0), { scale: [1, 1.5, 1], color: '#8f979f' });
  kit.add('emissive', new THREE.CylinderGeometry(1.25, 1.25, 0.35, seg, 1, true), { color, intensity: 1.8 });
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    kit.add('metal', new THREE.BoxGeometry(0.15, 1.8, 1.4), { position: [Math.cos(a) * 1.3, -1.2, Math.sin(a) * 1.3], rotation: [0, -a, 0], color: '#3a4047' });
  }
  rod(kit, 'metal', [0, 2.2, 0], [0, 3.6, 0], 0.08, '#3a4047', 5);
  kit.build(group, standardSet(ctx.quality));
  const light = createLightPoints(
    [
      { p: [0, 3.8, 0], color, size: 2.4, intensity: 2, blink: 0.5, duty: 0.3, min: 0.3 },
      { p: [0, 0, 0], color, size: 5, intensity: 0.25 },
    ],
    ctx,
    3,
  );
  group.add(light.points);
  return {
    object: group,
    update(_dt, time) {
      light.uniforms.uTime.value = time;
      group.rotation.y = time * 0.15;
    },
    dispose: () => disposeObject(group),
  };
}
