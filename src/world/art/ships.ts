import * as THREE from 'three';
import type { ArtContext, ArtObject } from './types.ts';
import { Kit, latheZ, loft, mirrored, rod, slab, tank } from './kit.ts';
import type { LoftSection, V3 } from './kit.ts';
import { createLightPoints } from './lights.ts';
import type { LightSpec } from './lights.ts';
import { standardSet } from './materials.ts';
import { NOISE_GLSL, OUTPUT_GLSL, getNoiseVolume } from './noise.ts';
import { approach, byQuality, disposeObject, seededRandom } from './util.ts';

export interface ShipArt extends ArtObject<THREE.Group> {
  /** Approximate bounding radius used for hits and collisions. */
  readonly radius: number;
  /** Gun muzzle positions in ship-local space (ship faces -Z). */
  readonly muzzles: readonly THREE.Vector3[];
  /** 0..1 main engine output (drives exhaust glow length/brightness). */
  setThrottle(value: number): void;
  setBoost(on: boolean): void;
  setCruise(on: boolean): void;
  /** Brief shield shimmer when hit; strength 0..1. */
  flashShield(strength: number): void;
}

/* ------------------------------------------------------------------------------------------------
 * Exhaust plumes: nested soft cones (hot core + coloured sheath) per nozzle, one draw call.
 * ---------------------------------------------------------------------------------------------- */

const PLUME_VERT = /* glsl */ `
attribute vec3 aNozzle;
attribute float aLayer;
uniform float uLength;
uniform float uWidth;
varying float vT;
varying float vLayer;
varying vec3 vN;
varying vec3 vV;
void main() {
  float t = position.z;
  float len = uLength * mix(0.5, 1.0, aLayer);
  vec3 p = aNozzle + vec3(position.xy * mix(1.0, uWidth, t), t * len);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  vN = normalize(normalMatrix * normal);
  vV = -mv.xyz;
  vT = t;
  vLayer = aLayer;
  gl_Position = projectionMatrix * mv;
}
`;

const PLUME_FRAG = /* glsl */ `
uniform vec3 uCore;
uniform vec3 uColor;
uniform float uIntensity;
uniform float uTime;
uniform float uFlicker;
varying float vT;
varying float vLayer;
varying vec3 vN;
varying vec3 vV;
void main() {
  float facing = abs(dot(normalize(vN), normalize(vV)));
  float soft = pow(facing, 1.4);
  float fade = pow(1.0 - vT, mix(1.1, 2.0, vLayer)) * smoothstep(0.0, 0.06, vT + 0.02);
  float fl = 1.0 + uFlicker * (0.1 * sin(uTime * 47.0 + vT * 19.0) + 0.06 * sin(uTime * 83.0 - vT * 7.0));
  float diamonds = 1.0 + (1.0 - vLayer) * 0.18 * cos(vT * 34.0 - uTime * 6.0 * uFlicker);
  vec3 col = mix(uColor, uCore, (1.0 - vT) * (1.0 - vLayer * 0.75));
  float a = soft * fade * fl * diamonds * mix(1.25, 0.5, vLayer);
  gl_FragColor = vec4(col * a * uIntensity, 1.0);
  ${OUTPUT_GLSL}
}
`;

function plumeGeometry(nozzles: V3[], radius: number, segments: number): THREE.BufferGeometry {
  const rings = [0, 0.08, 0.25, 0.5, 0.75, 1];
  const positions: number[] = [];
  const normals: number[] = [];
  const nozzleAttr: number[] = [];
  const layers: number[] = [];
  const indices: number[] = [];
  let base = 0;
  for (const nz of nozzles) {
    for (let layer = 0; layer < 2; layer++) {
      const r0 = radius * (layer === 0 ? 0.55 : 0.95);
      for (const t of rings) {
        // Slight bulge after the nozzle, tapering to a point.
        const r = r0 * (1 + 0.25 * Math.sin(Math.min(1, t * 2.2) * Math.PI)) * (1 - t * 0.9);
        for (let s = 0; s <= segments; s++) {
          const a = (s / segments) * Math.PI * 2;
          positions.push(Math.cos(a) * r, Math.sin(a) * r, t);
          normals.push(Math.cos(a), Math.sin(a), 0);
          nozzleAttr.push(nz[0], nz[1], nz[2]);
          layers.push(layer);
        }
      }
      for (let i = 0; i < rings.length - 1; i++) {
        for (let s = 0; s < segments; s++) {
          const a = base + i * (segments + 1) + s;
          const b = a + segments + 1;
          indices.push(a, b, a + 1, a + 1, b, b + 1);
        }
      }
      base += rings.length * (segments + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  g.setAttribute('aNozzle', new THREE.Float32BufferAttribute(nozzleAttr, 3));
  g.setAttribute('aLayer', new THREE.Float32BufferAttribute(layers, 1));
  g.setIndex(indices);
  return g;
}

/* ------------------------------------------------------------------------------------------------
 * Shield bubble: Fresnel shell with a drifting noise shimmer, only visible while flashing.
 * ---------------------------------------------------------------------------------------------- */

const SHIELD_VERT = /* glsl */ `
varying vec3 vObj;
varying vec3 vN;
varying vec3 vV;
void main() {
  vObj = position;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vN = normalize(normalMatrix * normal);
  vV = -mv.xyz;
  gl_Position = projectionMatrix * mv;
}
`;

const SHIELD_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uStrength;
uniform float uTime;
varying vec3 vObj;
varying vec3 vN;
varying vec3 vV;
${NOISE_GLSL}
void main() {
  float f = 1.0 - abs(dot(normalize(vN), normalize(vV)));
  float fres = pow(f, 3.0);
  vec3 q = normalize(vObj) * 3.0;
  float n = snoise(q * 1.7 + vec3(0.0, uTime * 1.3, uTime * 0.7));
  float cells = smoothstep(0.55, 0.95, ridged(q * 1.2 + vec3(uTime * 0.4), 2));
  float shimmer = 0.55 + 0.45 * n + cells * 0.6;
  float a = (fres * 0.95 + 0.025) * shimmer * uStrength;
  gl_FragColor = vec4(uColor * a, 1.0);
  ${OUTPUT_GLSL}
}
`;

/* ------------------------------------------------------------------------------------------------
 * Shared ship assembly.
 * ---------------------------------------------------------------------------------------------- */

interface EngineLook {
  nozzles: V3[];
  /** Nozzle exit radius. */
  radius: number;
  /** Full-throttle plume length. */
  length: number;
  core: THREE.ColorRepresentation;
  color: THREE.ColorRepresentation;
  boostCore: THREE.ColorRepresentation;
  boostColor: THREE.ColorRepresentation;
  cruiseColor: THREE.ColorRepresentation;
}

interface ShipBuild {
  kit: Kit;
  engine: EngineLook;
  lights: LightSpec[];
  shield: V3;
  shieldColor: THREE.ColorRepresentation;
  radius: number;
  muzzles: V3[];
  name: string;
}

function assembleShip(b: ShipBuild, ctx: ArtContext): ShipArt {
  const group = new THREE.Group();
  group.name = b.name;
  b.kit.build(group, standardSet(ctx.quality));

  const e = b.engine;
  // Plumes.
  const plumeU = {
    uLength: { value: e.length * 0.3 },
    uWidth: { value: 1 },
    uCore: { value: new THREE.Color(e.core) },
    uColor: { value: new THREE.Color(e.color) },
    uIntensity: { value: 1 },
    uTime: { value: 0 },
    uFlicker: { value: ctx.reducedMotion ? 0.25 : 1 },
  };
  const plume = new THREE.Mesh(
    plumeGeometry(e.nozzles, e.radius, byQuality(ctx.quality, 8, 10, 14)),
    new THREE.ShaderMaterial({
      uniforms: plumeU,
      vertexShader: PLUME_VERT,
      fragmentShader: PLUME_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    }),
  );
  plume.name = 'plumes';
  plume.frustumCulled = false;
  plume.renderOrder = 6;
  group.add(plume);

  // Nozzle glows (read from behind, where the plume cones are end-on).
  const glow = createLightPoints(
    e.nozzles.map((p) => ({ p: [p[0], p[1], p[2] + e.radius * 0.3] as V3, color: e.color, size: e.radius * 5, intensity: 1 })),
    ctx,
    3,
  );
  glow.points.name = 'engine-glow';
  group.add(glow.points);

  // Navigation / running lights.
  const lights = createLightPoints(b.lights, ctx);
  group.add(lights.points);

  // Shield bubble.
  const shieldU = {
    uNoise: { value: getNoiseVolume() },
    uColor: { value: new THREE.Color(b.shieldColor) },
    uStrength: { value: 0 },
    uTime: { value: 0 },
  };
  const shield = new THREE.Mesh(
    new THREE.SphereGeometry(1, byQuality(ctx.quality, 20, 28, 36), byQuality(ctx.quality, 14, 18, 24)),
    new THREE.ShaderMaterial({
      uniforms: shieldU,
      vertexShader: SHIELD_VERT,
      fragmentShader: SHIELD_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }),
  );
  shield.scale.set(...b.shield);
  shield.visible = false;
  shield.name = 'shield';
  shield.renderOrder = 7;
  group.add(shield);

  let throttle = 0;
  let throttleT = 0;
  let boost = 0;
  let boostT = 0;
  let cruise = 0;
  let cruiseT = 0;
  const cCore = new THREE.Color(e.core);
  const cColor = new THREE.Color(e.color);
  const cBoostCore = new THREE.Color(e.boostCore);
  const cBoost = new THREE.Color(e.boostColor);
  const cCruise = new THREE.Color(e.cruiseColor);
  const shieldDecay = ctx.reducedMotion ? 1.6 : 3.2;
  const shieldPeak = ctx.reducedMotion ? 0.55 : 1;

  return {
    object: group,
    radius: b.radius,
    muzzles: b.muzzles.map((m) => new THREE.Vector3(...m)),
    setThrottle(v) {
      throttleT = Math.max(0, Math.min(1, v));
    },
    setBoost(on) {
      boostT = on ? 1 : 0;
    },
    setCruise(on) {
      cruiseT = on ? 1 : 0;
    },
    flashShield(strength) {
      shieldU.uStrength.value = Math.max(shieldU.uStrength.value, Math.max(0, Math.min(1, strength)) * shieldPeak);
      shield.visible = true;
    },
    update(dt, time) {
      throttle = approach(throttle, throttleT, 6, dt);
      boost = approach(boost, boostT, 5, dt);
      cruise = approach(cruise, cruiseT, 2.5, dt);
      const out = Math.max(throttle, cruise * 0.9);
      plumeU.uLength.value = e.length * (0.12 + 0.88 * out) * (1 + 0.8 * boost + 1.2 * cruise);
      plumeU.uWidth.value = 1 - 0.3 * cruise;
      plumeU.uIntensity.value = (0.35 + 0.9 * out) * (1 + 0.6 * boost + 0.2 * cruise);
      plumeU.uCore.value.copy(cCore).lerp(cBoostCore, boost);
      plumeU.uColor.value.copy(cColor).lerp(cBoost, boost).lerp(cCruise, cruise);
      plumeU.uFlicker.value = (ctx.reducedMotion ? 0.25 : 1) * (1 - 0.8 * cruise);
      plumeU.uTime.value = time;
      glow.uniforms.uIntensity.value = 0.45 + 0.9 * out + 0.6 * boost;
      glow.uniforms.uSize.value = 0.8 + 0.5 * out + 0.4 * boost + 0.3 * cruise;
      glow.uniforms.uTime.value = time;
      lights.uniforms.uTime.value = time;
      if (shield.visible) {
        shieldU.uStrength.value = Math.max(0, shieldU.uStrength.value - dt * shieldDecay * Math.max(0.35, shieldU.uStrength.value));
        shieldU.uTime.value = time;
        if (shieldU.uStrength.value <= 0.005) shield.visible = false;
      }
    },
    dispose: () => disposeObject(group),
  };
}

/* ------------------------------------------------------------------------------------------------
 * Kite courier (player), ~14 units long.
 * ---------------------------------------------------------------------------------------------- */

const KITE = {
  hull: '#c9d0d8',
  hullLight: '#dfe4ea',
  hullDark: '#7a838e',
  trim: '#3c434c',
  metal: '#50565e',
  accent: '#2466e0',
  cargo: '#5d6570',
  hazard: '#d9a53a',
};

function kiteSection(z: number, w: number, t: number, b: number): LoftSection {
  return {
    z,
    pts: mirrored([
      [0, t],
      [0.45 * w, 0.92 * t],
      [0.85 * w, 0.45 * t],
      [w, 0.05 * t],
      [0.8 * w, -0.55 * b],
      [0.35 * w, -b],
      [0, -b],
    ]),
  };
}

function ellipseSection(z: number, w: number, h: number, y0: number, n = 10): LoftSection {
  const pts: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    pts.push([Math.cos(a) * w, y0 + Math.sin(a) * h]);
  }
  return { z, pts };
}

/** Vertical fin from an (height, z) planform, standing on +Y. */
function fin(planform: [number, number][], thickness: number, bevel = 0.03): THREE.BufferGeometry {
  const g = slab(planform, thickness, bevel);
  g.rotateZ(Math.PI / 2);
  return g;
}

function mirrorX(planform: [number, number][]): [number, number][] {
  return planform.map(([x, z]) => [-x, z] as [number, number]).reverse();
}

/** Player's "Kite" courier, ~14 units long. */
export function createPlayerShip(ctx: ArtContext): ShipArt {
  const kit = new Kit(3);
  const seg = byQuality(ctx.quality, 10, 14, 18);

  // Hull: arrow-head wedge with a sharp side chine and a blue accent stripe.
  const sections = [
    kiteSection(-7.0, 0.06, 0.05, 0.05),
    kiteSection(-6.1, 0.5, 0.26, 0.2),
    kiteSection(-4.8, 1.0, 0.55, 0.38),
    kiteSection(-2.8, 1.42, 0.82, 0.52),
    kiteSection(-0.5, 1.72, 0.95, 0.6),
    kiteSection(2.0, 1.88, 0.92, 0.62),
    kiteSection(4.3, 1.84, 0.8, 0.58),
    kiteSection(6.1, 1.58, 0.66, 0.5),
    kiteSection(6.8, 1.35, 0.55, 0.42),
  ];
  kit.add(
    'hull',
    loft(sections, {
      capEnd: true,
      baseColor: KITE.hull,
      faceColor: (s, edge) => {
        if (edge === -1) return KITE.trim;
        if (s === 0) return KITE.trim;
        if ((edge === 2 || edge === 9) && s >= 2 && s <= 6) return KITE.accent;
        if (edge >= 4 && edge <= 7) return KITE.hullDark;
        if (edge === 0 || edge === 11) return KITE.hullLight;
        return null;
      },
    }),
    { color: undefined },
  );

  // Canopy.
  kit.add(
    'glass',
    loft(
      [
        ellipseSection(-4.7, 0.1, 0.05, 0.5),
        ellipseSection(-4.0, 0.46, 0.27, 0.6),
        ellipseSection(-3.1, 0.68, 0.43, 0.72),
        ellipseSection(-2.1, 0.66, 0.41, 0.83),
        ellipseSection(-1.2, 0.38, 0.22, 0.9),
        ellipseSection(-0.7, 0.1, 0.06, 0.93),
      ],
      { baseColor: '#ffffff' },
    ),
  );
  // Canopy frame spine.
  kit.add('metal', new THREE.BoxGeometry(0.08, 0.06, 3.2), { position: [0, 1.16, -2.6], rotation: [-0.08, 0, 0], color: KITE.trim });

  // Wings with slight anhedral and blue tip bands.
  const wing: [number, number][] = [
    [1.45, -1.6],
    [6.1, 3.3],
    [6.5, 3.6],
    [6.5, 5.1],
    [1.45, 5.7],
  ];
  const tipBand: [number, number][] = [
    [5.3, 2.4],
    [6.1, 3.3],
    [6.5, 3.6],
    [6.5, 5.1],
    [5.3, 5.25],
  ];
  for (const side of [1, -1]) {
    const pf = side > 0 ? wing : mirrorX(wing);
    const band = side > 0 ? tipBand : mirrorX(tipBand);
    kit.add('hull', slab(pf, 0.24, 0.06), { position: [0, -0.15, 0], rotation: [0, 0, -0.08 * side], color: KITE.hull });
    kit.add('hull', slab(band, 0.26, 0.05), { position: [0, -0.15, 0], rotation: [0, 0, -0.08 * side], color: KITE.accent });
    // Wingtip fins.
    kit.add('hull', fin([[0, 3.5], [0, 5.1], [0.8, 5.35], [0.95, 4.6]], 0.12), {
      position: [side * 6.45, -0.6, 0],
      color: KITE.hullLight,
    });
    // Engine nacelles.
    const nx = side * 3.0;
    kit.add('metal', latheZ([[0.001, 0.35], [0.36, 0.1], [0.48, 0.0], [0.58, 0.3]], seg), { position: [nx, 0.1, 0.6], color: KITE.trim });
    kit.add('hull', latheZ([[0.58, 0.3], [0.63, 0.9], [0.63, 4.4], [0.57, 5.3]], seg), { position: [nx, 0.1, 0.6], color: KITE.hull });
    kit.add('metal', latheZ([[0.57, 5.3], [0.5, 5.85], [0.56, 6.3], [0.46, 6.32], [0.3, 6.1]], seg), {
      position: [nx, 0.1, 0.6],
      color: KITE.metal,
    });
    kit.add('hull', new THREE.CylinderGeometry(0.645, 0.645, 0.35, seg, 1, true), {
      position: [nx, 0.1, 1.9],
      rotation: [Math.PI / 2, 0, 0],
      color: KITE.accent,
    });
    const disc = new THREE.CircleGeometry(0.44, seg);
    kit.add('emissive', disc, { position: [nx, 0.1, 6.72], color: '#7fd8ff', intensity: 2.2 });
    // Running light strip along the nacelle flank.
    kit.add('emissive', new THREE.BoxGeometry(0.05, 0.05, 2.6), { position: [nx + side * 0.63, 0.1, 3.4], color: '#6fd0ff', intensity: 1.6 });
    // Guns under the wing roots.
    kit.add('metal', new THREE.BoxGeometry(0.4, 0.32, 1.3), { position: [side * 2.1, -0.36, -0.95], color: KITE.trim });
    rod(kit, 'metal', [side * 2.1, -0.36, -1.5], [side * 2.1, -0.36, -3.3], 0.085, KITE.metal, 8);
    rod(kit, 'emissive', [side * 2.1, -0.36, -3.3], [side * 2.1, -0.36, -3.36], 0.06, '#9fe8ff', 8, { intensity: 1.5 });
    // Hull side light strip beneath the stripe.
    kit.add('emissive', new THREE.BoxGeometry(0.04, 0.04, 3.2), { position: [side * 1.83, -0.06, 1.2], rotation: [0, side * 0.035, 0], color: '#9fdcff', intensity: 1.2 });
  }

  // Dorsal fin with a blue tip.
  kit.add('hull', fin([[0, 2.2], [0, 5.6], [1.35, 6.35], [1.45, 5.7]], 0.16), { position: [0, 0.82, 0], color: KITE.hullLight });
  kit.add('hull', fin([[1.1, 5.2], [1.1, 6.2], [1.35, 6.35], [1.45, 5.7]], 0.18), { position: [0, 0.82, 0], color: KITE.accent });

  // Small cargo pod under the rear hull with hazard bands.
  kit.add('hull', new THREE.BoxGeometry(1.6, 0.7, 3.4), { position: [0, -0.9, 2.8], color: KITE.cargo });
  kit.add('hull', new THREE.BoxGeometry(1.64, 0.74, 0.22), { position: [0, -0.9, 1.6], color: KITE.hazard });
  kit.add('hull', new THREE.BoxGeometry(1.64, 0.74, 0.22), { position: [0, -0.9, 4.0], color: KITE.hazard });
  // Tail engine bay details.
  kit.add('metal', new THREE.BoxGeometry(1.6, 0.5, 0.3), { position: [0, 0.05, 6.85], color: KITE.trim });
  tank(kit, 'metal', [0.9, -0.2, 6.2], 'z', 0.18, 1.4, KITE.metal, 8);
  tank(kit, 'metal', [-0.9, -0.2, 6.2], 'z', 0.18, 1.4, KITE.metal, 8);

  return assembleShip(
    {
      name: 'kite',
      kit,
      engine: {
        nozzles: [
          [3.0, 0.1, 6.9],
          [-3.0, 0.1, 6.9],
        ],
        radius: 0.46,
        length: 7,
        core: '#e8fbff',
        color: '#3fb8ff',
        boostCore: '#ffffff',
        boostColor: '#8fd0ff',
        cruiseColor: '#6f8dff',
      },
      lights: [
        { p: [-6.62, -0.66, 4.4], color: '#ff2a20', size: 0.9, intensity: 1.6 },
        { p: [6.62, -0.66, 4.4], color: '#22ff5a', size: 0.9, intensity: 1.6 },
        { p: [0, 2.32, 6.05], color: '#ffffff', size: 1.1, intensity: 2.2, blink: 1.0, duty: 0.08 },
        { p: [0, 0.35, 7.05], color: '#ffffff', size: 0.6, intensity: 1.0 },
        { p: [0.35, -0.38, -5.4], color: '#dff1ff', size: 0.5, intensity: 0.8 },
        { p: [-0.35, -0.38, -5.4], color: '#dff1ff', size: 0.5, intensity: 0.8 },
        { p: [-6.45, 0.42, 4.75], color: '#ff2a20', size: 0.5, intensity: 1.0, blink: 0.5, duty: 0.5, min: 0.3 },
        { p: [6.45, 0.42, 4.75], color: '#22ff5a', size: 0.5, intensity: 1.0, blink: 0.5, duty: 0.5, min: 0.3 },
      ],
      shield: [7.4, 3.8, 8.3],
      shieldColor: '#5cc8ff',
      radius: 7.6,
      muzzles: [
        [2.1, -0.36, -3.45],
        [-2.1, -0.36, -3.45],
      ],
    },
    ctx,
  );
}

/* ------------------------------------------------------------------------------------------------
 * Pirate raider, ~11 units long: split-wing, twin-prong nose, gunmetal with rust-red and red slits.
 * ---------------------------------------------------------------------------------------------- */

const RAIDER = {
  hull: '#454b53',
  dark: '#2b2f35',
  rust: '#8f3322',
  rust2: '#a84a2c',
  metal: '#3a3e44',
  slit: '#ff3a1c',
};

function raiderSection(z: number, w: number, t: number, b: number): LoftSection {
  return {
    z,
    pts: mirrored([
      [0, t],
      [0.55 * w, 0.72 * t],
      [w, 0],
      [0.5 * w, -0.8 * b],
      [0, -b],
    ]),
  };
}

function diamond(z: number, xo: number, w: number, h: number): LoftSection {
  return {
    z,
    pts: [
      [xo, h],
      [xo + w, 0],
      [xo, -h],
      [xo - w, 0],
    ],
  };
}

/** Hostile raider fighter, ~11 units long, visibly different silhouette. */
export function createPirateShip(ctx: ArtContext): ShipArt {
  const kit = new Kit(2.5);
  const seg = byQuality(ctx.quality, 8, 12, 14);
  const rand = seededRandom(66);

  kit.add(
    'hull',
    loft(
      [
        raiderSection(-3.8, 0.2, 0.16, 0.12),
        raiderSection(-2.6, 0.56, 0.46, 0.32),
        raiderSection(-0.8, 0.86, 0.7, 0.48),
        raiderSection(1.5, 0.96, 0.74, 0.52),
        raiderSection(3.8, 0.9, 0.6, 0.48),
        raiderSection(5.0, 0.72, 0.5, 0.4),
        raiderSection(5.4, 0.62, 0.42, 0.34),
      ],
      {
        capEnd: true,
        baseColor: RAIDER.hull,
        faceColor: (s, edge) => {
          if (edge === -1) return RAIDER.dark;
          if ((edge === 0 || edge === 7) && s >= 1 && s <= 3) return RAIDER.rust;
          if (edge >= 3 && edge <= 4) return RAIDER.dark;
          return null;
        },
      },
    ),
  );

  // Twin forward prongs (the "mandibles"), guns at the tips.
  for (const side of [1, -1]) {
    kit.add(
      'hull',
      loft(
        [
          diamond(-0.4, side * 0.98, 0.3, 0.34),
          diamond(-2.8, side * 0.92, 0.25, 0.3),
          diamond(-4.6, side * 0.78, 0.17, 0.21),
          diamond(-5.6, side * 0.68, 0.04, 0.05),
        ],
        {
          baseColor: RAIDER.hull,
          faceColor: (s, edge) => {
            const outer = side > 0 ? edge === 0 || edge === 1 : edge === 2 || edge === 3;
            if (s === 2 && outer) return RAIDER.rust2;
            if (edge === 1 || edge === 2) return RAIDER.dark;
            return null;
          },
        },
      ),
    );
    // Red slit on the inner face of each prong and the menacing "eye" slits on the nose.
    kit.add('emissive', new THREE.BoxGeometry(0.05, 0.06, 2.6), {
      position: [side * 0.66, 0.06, -3.0],
      rotation: [0, side * -0.05, 0],
      color: RAIDER.slit,
      intensity: 2.8,
    });
    kit.add('emissive', new THREE.BoxGeometry(0.42, 0.05, 0.06), {
      position: [side * 0.42, 0.32, -2.42],
      rotation: [0.5, 0, side * -0.35],
      color: RAIDER.slit,
      intensity: 3.2,
    });
    rod(kit, 'metal', [side * 0.68, 0, -4.9], [side * 0.68, 0, -5.9], 0.06, RAIDER.metal, 6);

    // Main wings: forward-swept, angular, with drooping rust talons.
    const main: [number, number][] = [
      [0.8, 1.0],
      [4.6, -1.6],
      [5.0, -1.2],
      [4.9, -0.2],
      [3.1, 2.2],
      [2.7, 3.3],
      [0.8, 3.8],
    ];
    kit.add('hull', slab(side > 0 ? main : mirrorX(main), 0.2, 0.05), { position: [0, -0.05, 0], color: RAIDER.hull });
    const talon = fin([[0, -1.6], [0, -0.3], [1.5, 0.3], [1.8, -0.5]], 0.14);
    talon.rotateZ(Math.PI);
    kit.add('hull', talon, { position: [side * 4.8, -0.05, 0], rotation: [0, 0, side * 0.3], color: RAIDER.rust });
    // Upper split wings: short, swept back, canted up.
    const upper: [number, number][] = [
      [0.5, 1.9],
      [0.5, 4.5],
      [3.3, 5.2],
      [3.5, 4.4],
    ];
    kit.add('hull', slab(side > 0 ? upper : mirrorX(upper), 0.14, 0.03), {
      position: [side * 0.2, 0.55, 0],
      rotation: [0, 0, side * 0.62],
      color: RAIDER.hull,
    });
    kit.add('hull', slab(side > 0 ? [[2.7, 4.3], [2.7, 5.05], [3.3, 5.2], [3.5, 4.4]] : mirrorX([[2.7, 4.3], [2.7, 5.05], [3.3, 5.2], [3.5, 4.4]]), 0.16, 0.03), {
      position: [side * 0.2, 0.55, 0],
      rotation: [0, 0, side * 0.62],
      color: RAIDER.rust2,
    });
    // Wing-root engines.
    const ex = side * 1.25;
    kit.add('metal', latheZ([[0.001, 0.1], [0.3, 0.0], [0.36, 0.5], [0.36, 2.6], [0.3, 3.2], [0.33, 3.5], [0.22, 3.45]], seg), {
      position: [ex, -0.18, 1.9],
      color: RAIDER.metal,
    });
    kit.add('emissive', new THREE.CircleGeometry(0.24, seg), { position: [ex, -0.18, 5.36], color: '#ff6a2a', intensity: 2.4 });
    // Slits along the wing leading edges.
    kit.add('emissive', new THREE.BoxGeometry(1.6, 0.04, 0.05), {
      position: [side * 2.0, 0.07, 0.25],
      rotation: [0, side * 0.6, 0],
      color: RAIDER.slit,
      intensity: 2.2,
    });
  }

  // Slim dark-red canopy slit.
  kit.add(
    'glassRed',
    loft([diamond(-2.7, 0, 0.05, 0.03), diamond(-2.2, 0, 0.26, 0.12), diamond(-1.2, 0, 0.3, 0.15), diamond(-0.5, 0, 0.05, 0.03)].map((s) => ({
      z: s.z,
      pts: s.pts.map(([x, y]) => [x, y + 0.66 - (s.z + 2.7) * 0.03] as [number, number]),
    }))),
  );

  // Central main engine.
  kit.add('metal', latheZ([[0.72, 0.0], [0.64, 0.5], [0.55, 1.0], [0.62, 1.45], [0.45, 1.5], [0.2, 1.3]], seg), {
    position: [0, 0.02, 4.4],
    color: RAIDER.metal,
  });
  kit.add('emissive', new THREE.CircleGeometry(0.46, seg), { position: [0, 0.02, 5.72], color: '#ff5a24', intensity: 2.6 });
  // Spine vanes and greebles.
  for (let i = 0; i < 3; i++) {
    kit.add('hull', new THREE.BoxGeometry(0.08, 0.28 + rand() * 0.1, 0.8), { position: [0, 0.78, 0.2 + i * 1.3], color: RAIDER.dark });
  }
  kit.add('emissive', new THREE.BoxGeometry(0.06, 0.05, 2.2), { position: [0, 0.74, 1.6], color: RAIDER.slit, intensity: 1.6 });

  return assembleShip(
    {
      name: 'raider',
      kit,
      engine: {
        nozzles: [
          [0, 0.02, 5.85],
          [1.25, -0.18, 5.4],
          [-1.25, -0.18, 5.4],
        ],
        radius: 0.4,
        length: 5.5,
        core: '#fff0c8',
        color: '#ff4a1a',
        boostCore: '#ffffff',
        boostColor: '#ff8a3a',
        cruiseColor: '#ff6a4a',
      },
      lights: [
        { p: [-5.0, -0.2, -1.4], color: '#ff2a1a', size: 0.7, intensity: 1.4 },
        { p: [5.0, -0.2, -1.4], color: '#ff2a1a', size: 0.7, intensity: 1.4 },
        { p: [0, 0.98, 1.0], color: '#ff3a1a', size: 0.9, intensity: 1.6, blink: 0.8, duty: 0.3, min: 0.15 },
        { p: [0.66, 0.02, -5.95], color: '#ff4a2a', size: 0.35, intensity: 1.2 },
        { p: [-0.66, 0.02, -5.95], color: '#ff4a2a', size: 0.35, intensity: 1.2 },
      ],
      shield: [5.8, 3.2, 6.6],
      shieldColor: '#ff6a4a',
      radius: 6.2,
      muzzles: [
        [0.68, 0, -6.0],
        [-0.68, 0, -6.0],
      ],
    },
    ctx,
  );
}

/* ------------------------------------------------------------------------------------------------
 * Civilian hauler, ~40 units long: command module, container spine, big engine block.
 * ---------------------------------------------------------------------------------------------- */

const HAULER = {
  hull: '#d2d6da',
  stripe: '#e06a1e',
  spine: '#687079',
  engine: '#8a9098',
  dark: '#33383e',
};

const CONTAINER_COLORS = ['#b5562c', '#2e7d7a', '#8b949c', '#c9a13a', '#34507a', '#cfd4d8', '#7a3b2e', '#4f6b3a'];

function chamferSection(z: number, w: number, h: number, c: number): LoftSection {
  return {
    z,
    pts: mirrored([
      [0, h],
      [w - c, h],
      [w, h - c],
      [w, -h + c],
      [w - c, -h],
      [0, -h],
    ]),
  };
}

/** Civilian hauler for ambient traffic, ~40 units long. */
export function createHaulerShip(ctx: ArtContext): ShipArt {
  const kit = new Kit(4);
  const rand = seededRandom(1234);
  const seg = byQuality(ctx.quality, 10, 14, 16);

  // Command module.
  kit.add(
    'hull',
    loft(
      [chamferSection(-20.5, 2.2, 1.6, 0.6), chamferSection(-19.6, 3.0, 2.4, 0.8), chamferSection(-16, 3.3, 2.7, 0.9), chamferSection(-13, 3.0, 2.4, 0.8)],
      {
        capStart: true,
        capEnd: true,
        baseColor: HAULER.hull,
        faceColor: (s, edge) => {
          if (edge === -1) return HAULER.dark;
          if ((edge === 3 || edge === 6) && s >= 1) return HAULER.stripe;
          return null;
        },
      },
    ),
  );
  kit.add('glass', new THREE.BoxGeometry(4.6, 0.9, 0.12), { position: [0, 1.25, -20.02], rotation: [-0.72, 0, 0] });
  kit.add('windows', new THREE.BoxGeometry(4.3, 0.5, 0.14), { position: [0, 1.25, -20.04], rotation: [-0.72, 0, 0], uv: 2.2 });
  kit.add('hull', new THREE.BoxGeometry(3.6, 1.2, 0.3), { position: [0, -0.6, -20.55], color: HAULER.stripe });
  for (const side of [1, -1]) {
    kit.add('windows', new THREE.BoxGeometry(0.1, 0.4, 3.4), { position: [side * 3.32, 1.0, -16.6], uv: 4 });
  }
  // Turret + sensor mast on the command module.
  kit.add('metal', new THREE.CylinderGeometry(0.8, 0.95, 0.6, seg), { position: [0, 2.95, -16.2], color: HAULER.dark });
  rod(kit, 'metal', [0.25, 3.15, -16.6], [0.25, 3.15, -18.6], 0.09, HAULER.dark, 6);
  rod(kit, 'metal', [-0.25, 3.15, -16.6], [-0.25, 3.15, -18.6], 0.09, HAULER.dark, 6);
  rod(kit, 'metal', [1.6, 2.4, -14.5], [1.6, 4.8, -14.5], 0.07, HAULER.spine, 6);

  // Spine and container racks.
  kit.add('metal', new THREE.BoxGeometry(1.4, 1.4, 27), { position: [0, 0, 0], color: HAULER.spine });
  for (let r = 0; r < 4; r++) {
    const z = -9.6 + r * 6.1;
    kit.add('metal', new THREE.BoxGeometry(6.6, 0.35, 0.35), { position: [0, 0, z - 2.95], color: HAULER.spine });
    kit.add('metal', new THREE.BoxGeometry(0.35, 6.6, 0.35), { position: [0, 0, z - 2.95], color: HAULER.spine });
    for (const [x, y] of [
      [1.95, 1.95],
      [-1.95, 1.95],
      [1.95, -1.95],
      [-1.95, -1.95],
    ] as const) {
      if (rand() < 0.14) continue;
      const c = CONTAINER_COLORS[Math.floor(rand() * CONTAINER_COLORS.length)]!;
      kit.add('hull', new THREE.BoxGeometry(2.5, 2.5, 5.4), { position: [x, y, z], color: c, uv: 3 });
    }
  }

  // Engine block with four nozzles and radiator fins.
  kit.add(
    'hull',
    loft([chamferSection(13, 3.2, 2.6, 0.7), chamferSection(14.2, 4.0, 3.3, 0.9), chamferSection(18.6, 4.0, 3.3, 0.9), chamferSection(19.0, 3.6, 3.0, 0.8)], {
      capStart: true,
      capEnd: true,
      baseColor: HAULER.engine,
      faceColor: (s, edge) => (edge === -1 ? HAULER.dark : (edge === 3 || edge === 6) && s === 1 ? HAULER.stripe : null),
    }),
  );
  const nozzles: V3[] = [];
  for (const x of [-1.9, 1.9]) {
    for (const y of [-1.45, 1.45]) {
      kit.add('metal', latheZ([[1.0, 0.0], [0.9, 0.5], [1.05, 1.6], [0.95, 1.65], [0.5, 1.2]], seg), {
        position: [x, y, 19.0],
        color: HAULER.dark,
      });
      kit.add('emissive', new THREE.CircleGeometry(0.88, seg), { position: [x, y, 20.2], color: '#9fd4ff', intensity: 2.0 });
      nozzles.push([x, y, 20.55]);
    }
  }
  for (const side of [1, -1]) {
    kit.add('radiator', new THREE.BoxGeometry(0.2, 3.4, 5.2), { position: [side * 4.5, 0, 16.2], uv: 3 });
    kit.add('metal', new THREE.BoxGeometry(0.5, 0.5, 5.4), { position: [side * 4.25, 0, 16.2], color: HAULER.dark });
  }
  // Spine lights (amber) and service lamps.
  kit.add('emissive', new THREE.BoxGeometry(0.1, 0.1, 24), { position: [0, 0.72, 0], color: '#ffb347', intensity: 0.9 });

  const lights: LightSpec[] = [
    { p: [-1.4, -0.6, -20.8], color: '#f4f8ff', size: 1.4, intensity: 1.3 },
    { p: [1.4, -0.6, -20.8], color: '#f4f8ff', size: 1.4, intensity: 1.3 },
    { p: [-3.45, 0, -17.5], color: '#ff2a20', size: 1.6, intensity: 1.5 },
    { p: [3.45, 0, -17.5], color: '#22ff5a', size: 1.6, intensity: 1.5 },
    { p: [0, 3.6, 16.5], color: '#ffffff', size: 2.0, intensity: 2.0, blink: 0.8, duty: 0.08 },
    { p: [0, -3.5, 16.5], color: '#ffffff', size: 2.0, intensity: 2.0, blink: 0.8, duty: 0.08, phase: 0.5 },
  ];
  for (let i = 0; i < 6; i++) {
    lights.push({ p: [0, 0.95, -12 + i * 4.8], color: '#ffb347', size: 1.0, intensity: 1.2, blink: 0.6, phase: i / 6, duty: 0.25, min: 0.2 });
  }

  return assembleShip(
    {
      name: 'hauler',
      kit,
      engine: {
        nozzles,
        radius: 0.9,
        length: 16,
        core: '#f2fbff',
        color: '#4aa8ff',
        boostCore: '#ffffff',
        boostColor: '#9ad0ff',
        cruiseColor: '#7a90ff',
      },
      lights,
      shield: [7.2, 6.2, 22.5],
      shieldColor: '#7fd4ff',
      radius: 21.5,
      muzzles: [
        [0.25, 3.15, -18.7],
        [-0.25, 3.15, -18.7],
      ],
    },
    ctx,
  );
}
