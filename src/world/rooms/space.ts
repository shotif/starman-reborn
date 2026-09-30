import * as THREE from 'three';
import { Kit } from '../art/kit.ts';
import { OUTPUT_GLSL } from '../art/noise.ts';
import { createPlanet } from '../art/planets.ts';
import type { PlanetArt } from '../art/planets.ts';
import { rockGeometry } from '../art/rocks.ts';
import { createSkybox } from '../art/skybox.ts';
import type { ArtContext, ArtObject } from '../art/types.ts';
import { byQuality, disposeObject, seededRandom } from '../art/util.ts';
import { BAR_ORIGIN } from './lounge.ts';
import type { OutsideLook } from './styles.ts';
import type { StationInteriorOptions } from './types.ts';

/**
 * What the bay and the lounge windows look out on: the system's skybox, the local star as a glow
 * at infinity, an optional companion star, the nearby planet, and drifting rocks for belt stations.
 * The interior camera uses near 0.2 / far 2e6, so the skybox (radius 9e5) renders unmodified.
 */

const GLOW_VERT = /* glsl */ `
uniform vec3 uDir;
uniform float uSize;
varying vec2 vUv;
void main() {
  vUv = position.xy;
  float d = 40000.0;
  vec3 c = cameraPosition + normalize(uDir) * d;
  vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
  vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
  vec3 p = c + (right * position.x + up * position.y) * uSize * d / 1000.0;
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}
`;

const GLOW_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uIntensity;
uniform float uRays;
uniform float uTime;
varying vec2 vUv;
void main() {
  vec2 p = vUv;
  float r = length(p);
  float core = smoothstep(0.075, 0.035, r) * 3.0;
  float inner = exp(-r * r * 60.0) * 1.6;
  float halo = exp(-r * 5.0) * 0.55 + exp(-r * r * 3.0) * 0.12;
  float a = atan(p.y, p.x);
  float rays = pow(abs(cos(a * 2.0 + 0.3)), 60.0) * exp(-r * 3.2) * 0.9 + pow(abs(cos(a * 3.0 + 1.1 + uTime * 0.01)), 30.0) * exp(-r * 4.5) * 0.35;
  float edge = smoothstep(1.0, 0.7, r);
  // Only the disc and its inner glow get the star's full HDR intensity; the wide halo stays near
  // the bloom threshold so a bright star never swallows the ship in front of it.
  float wide = min(uIntensity, 1.25);
  vec3 c = uColor * (inner * uIntensity + (halo + rays * uRays) * wide) * edge + vec3(1.0) * core * uIntensity;
  gl_FragColor = vec4(c, 1.0);
  ${OUTPUT_GLSL}
}
`;

/** Roughly where the room cameras sit (deck, trader, outfitter, bar): rocks keep off the star from each. */
const EYES: THREE.Vector3[] = [
  new THREE.Vector3(7, 11, 23),
  new THREE.Vector3(25, 9, 14),
  new THREE.Vector3(-23, 8, 13),
  new THREE.Vector3(BAR_ORIGIN[0], BAR_ORIGIN[1] + 3.6, BAR_ORIGIN[2] + 7.5),
];

export interface Backdrop {
  readonly object: THREE.Group;
  /** Unit vector towards the star. */
  readonly starDir: THREE.Vector3;
  readonly starColor: THREE.Color;
  update(dt: number, time: number, camera: THREE.Camera): void;
  dispose(): void;
}

function starGlow(dir: THREE.Vector3, color: THREE.Color, size: number, intensity: number, rays: number, name: string): THREE.Mesh {
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uDir: { value: dir.clone() },
      uSize: { value: size },
      uColor: { value: color.clone() },
      uIntensity: { value: intensity },
      uRays: { value: rays },
      uTime: { value: 0 },
    },
    vertexShader: GLOW_VERT,
    fragmentShader: GLOW_FRAG,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = -900;
  mesh.name = name;
  return mesh;
}

export function createBackdrop(opts: StationInteriorOptions, look: OutsideLook, ctx: ArtContext): Backdrop {
  const group = new THREE.Group();
  group.name = 'backdrop';
  const arts: ArtObject[] = [];

  const sky = createSkybox(opts.skybox, ctx);
  group.add(sky.object);
  arts.push(sky);

  const starDir = new THREE.Vector3(...look.starDir).normalize();
  const starColor = new THREE.Color(opts.starColor);
  const glow = starGlow(starDir, starColor, look.starSize, look.starIntensity, 1, 'star-glow');
  group.add(glow);
  if (look.companion) {
    const c = look.companion;
    group.add(starGlow(new THREE.Vector3(...c.dir).normalize(), new THREE.Color(c.color), c.size, 1.4, 0.6, 'companion-glow'));
  }

  let planet: PlanetArt | null = null;
  if (look.planet) {
    const p = look.planet;
    // Light the planet from the side the star is on (as seen on the sky), turned towards the
    // viewer by `frontLight` so it shows a lit face rather than the thin crescent of a backlit world.
    const toPlanet = new THREE.Vector3(...p.dir).normalize();
    const side = starDir.clone().addScaledVector(toPlanet, -starDir.dot(toPlanet));
    if (side.lengthSq() < 1e-6) side.set(0, 1, 0);
    const lightDir = side.normalize().addScaledVector(toPlanet, -p.frontLight).normalize();
    planet = createPlanet(
      {
        radius: p.radius,
        style: p.style,
        seed: p.seed,
        lightPosition: lightDir.multiplyScalar(1e7),
        lightColor: starColor,
        tilt: p.tilt ?? 0,
        spinSpeed: ctx.reducedMotion ? 0.002 : 0.004,
      },
      ctx,
    );
    planet.object.position.copy(new THREE.Vector3(...p.dir).normalize().multiplyScalar(p.distance));
    planet.object.name = 'planet';
    group.add(planet.object);
    arts.push(planet);
  }

  let rocks: THREE.Group | null = null;
  if (look.rocks > 0) {
    rocks = new THREE.Group();
    rocks.name = 'rocks';
    const kit = new Kit(8);
    const rand = seededRandom(opts.seed * 31 + 7);
    const n = byQuality(ctx.quality, Math.ceil(look.rocks * 0.5), Math.ceil(look.rocks * 0.8), look.rocks);
    const pos = new THREE.Vector3();
    const toRock = new THREE.Vector3();
    for (let i = 0; i < n; i++) {
      // Scatter in a wide cone beyond the bay (towards -Z), mostly off to the sides and below. A
      // backlit rock over the star reads as a hole in the sky, so redraw any that would cover it.
      let size = 0;
      for (let tries = 0; tries < 12; tries++) {
        const dist = 180 + rand() * 1400;
        const ax = (rand() - 0.5) * 1.9;
        const ay = (rand() - 0.62) * 0.8;
        const dir = new THREE.Vector3(Math.sin(ax), ay, -Math.cos(ax)).normalize();
        size = (3 + rand() * rand() * 28) * (0.5 + dist / 900);
        pos.set(dir.x * dist, dir.y * dist - 40, dir.z * dist - 30);
        const clear = EYES.every((eye) => {
          toRock.subVectors(pos, eye);
          return toRock.angleTo(starDir) > Math.asin(Math.min(1, (size * 1.6) / toRock.length())) + 0.05;
        });
        if (clear) break;
      }
      const g = rockGeometry(i * 13 + 5, {
        detail: ctx.quality === 'high' && size > 30 ? 2 : 1,
        rough: 0.3 + rand() * 0.15,
        craters: 3,
        stretch: [1 + rand() * 0.5, 0.7 + rand() * 0.3, 1 + rand() * 0.3],
        color: rand() < 0.5 ? '#8c7a68' : '#6e655c',
      });
      kit.add('rock', g, {
        position: [pos.x, pos.y, pos.z],
        rotation: [rand() * 6, rand() * 6, rand() * 6],
        scale: size,
        color: undefined,
      });
    }
    // Rocks are lit by the star alone (baked into vertex colours, unlit material), so the
    // hangar's lamps and ambient never flatten them.
    const litMat = new THREE.MeshBasicMaterial({ vertexColors: true, fog: false });
    const [mesh] = kit.build(rocks, { rock: litMat });
    if (mesh) {
      const g = mesh.geometry;
      const n = g.attributes.normal!;
      const c = g.attributes.color!;
      const tint = starColor.clone();
      for (let i = 0; i < n.count; i++) {
        const d = n.getX(i) * starDir.x + n.getY(i) * starDir.y + n.getZ(i) * starDir.z;
        const k = 0.035 + Math.max(0, d) * 1.25;
        c.setXYZ(i, c.getX(i) * k * tint.r, c.getY(i) * k * tint.g, c.getZ(i) * k * tint.b);
      }
      c.needsUpdate = true;
    }
    group.add(rocks);
  }

  const uniforms = [glow.material as THREE.ShaderMaterial];
  const rockSpin = ctx.reducedMotion ? 0.0004 : 0.0012;
  return {
    object: group,
    starDir,
    starColor,
    update(dt, time, camera) {
      for (const a of arts) a.update?.(dt, time, camera);
      for (const m of uniforms) m.uniforms.uTime!.value = time;
      if (rocks) rocks.rotation.y = Math.sin(time * rockSpin) * 0.4;
    },
    dispose() {
      for (const a of arts) a.dispose();
      disposeObject(group);
    },
  };
}
