import * as THREE from 'three';
import { rockGeometry } from './rocks.ts';
import type { ArtContext, ArtObject } from './types.ts';
import { disposeObject } from './util.ts';

/**
 * A comet in Sol (docs/PROCGEN.md §45.3), drawn far larger than life: a dark, lumpy nucleus; near
 * the Sun, a glowing coma round it and two tails, the gas tail straight away from the Sun (bluish)
 * and the dust tail bent back along its path (pale gold), each a soft streak that turns to face the
 * viewer about its own length.
 */

export interface CometArtOptions {
  /** The nucleus's drawn radius, the coma's radius and the tails' length (0: none). */
  radius: number;
  coma: number;
  tail: number;
  /** Unit directions of the gas and dust tails, in the scene's frame. */
  gasDir: THREE.Vector3;
  dustDir: THREE.Vector3;
  seed: number;
}

const QUAD_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const COMA_FRAG = /* glsl */ `
uniform vec3 uColor;
varying vec2 vUv;
void main() {
  float r = length(vUv - 0.5) * 2.0;
  float a = (exp(-r * r * 5.0) + 0.6 * exp(-r * r * 40.0)) * (1.0 - smoothstep(0.85, 1.0, r));
  gl_FragColor = vec4(uColor * a, 1.0);
}
`;

// u runs from the head (0) to the tail's end (1); v across it. It widens and fades along its length.
const TAIL_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uSpread;
varying vec2 vUv;
void main() {
  float u = vUv.x;
  float width = mix(0.12, 1.0, pow(u, uSpread));
  float v = abs(vUv.y - 0.5) * 2.0 / width;
  float a = (1.0 - smoothstep(0.0, 1.0, v)) * pow(1.0 - u, 1.1) * smoothstep(0.0, 0.03, u);
  gl_FragColor = vec4(uColor * a * 0.85, 1.0);
}
`;

function glow(frag: string, uniforms: Record<string, THREE.IUniform>): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({ uniforms, vertexShader: QUAD_VERT, fragmentShader: frag, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
}

export function createComet(opts: CometArtOptions, ctx: ArtContext): ArtObject<THREE.Group> {
  const group = new THREE.Group();
  group.name = 'comet';

  const nucleus = new THREE.Mesh(
    rockGeometry(opts.seed, { detail: ctx.quality === 'low' ? 1 : 2, stretch: [1.35, 0.85, 1], rough: 0.38, craters: 5, ice: 0.08, color: '#5d554c' }),
    // Faintly lit by its own coma, so the dark side is not black.
    new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 1, metalness: 0, emissive: new THREE.Color('#3b4650'), emissiveIntensity: opts.coma > 0 ? 0.9 : 0.25 }),
  );
  nucleus.scale.setScalar(opts.radius);
  group.add(nucleus);

  // The coma: a camera-facing glow round the nucleus.
  let coma: THREE.Mesh | null = null;
  if (opts.coma > 0) {
    coma = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), glow(COMA_FRAG, { uColor: { value: new THREE.Color('#bfe6ff') } }));
    coma.scale.setScalar(opts.coma);
    coma.renderOrder = 12;
    coma.frustumCulled = false;
    group.add(coma);
  }

  // The tails: a quad from the head out along each direction, turned about its length to face the viewer.
  const tails: { mesh: THREE.Mesh; dir: THREE.Vector3; length: number }[] = [];
  if (opts.tail > 0) {
    const add = (dir: THREE.Vector3, length: number, width: number, color: string, spread: number) => {
      const geo = new THREE.PlaneGeometry(1, 1);
      geo.translate(0.5, 0, 0);
      const mesh = new THREE.Mesh(geo, glow(TAIL_FRAG, { uColor: { value: new THREE.Color(color) }, uSpread: { value: spread } }));
      mesh.scale.set(length, width, 1);
      mesh.renderOrder = 11;
      mesh.frustumCulled = false;
      group.add(mesh);
      tails.push({ mesh, dir: dir.clone().normalize(), length });
    };
    add(opts.gasDir, opts.tail, Math.max(opts.coma * 0.9, opts.tail * 0.06), '#8fc4ff', 0.6);
    add(opts.dustDir, opts.tail * 0.8, Math.max(opts.coma * 1.4, opts.tail * 0.16), '#fff0c8', 0.8);
  }

  const toCam = new THREE.Vector3();
  const side = new THREE.Vector3();
  const normal = new THREE.Vector3();
  const basis = new THREE.Matrix4();
  const world = new THREE.Vector3();
  const spin = ctx.reducedMotion ? 0 : 0.02;

  return {
    object: group,
    update(dt, _time, camera) {
      nucleus.rotation.y += dt * spin;
      group.getWorldPosition(world);
      if (coma) {
        // Facing the viewer, a little in front of the nucleus: the inner coma glows over it.
        coma.quaternion.copy(camera.quaternion);
        coma.position.copy(camera.position).sub(world).normalize().multiplyScalar(opts.radius * 1.6);
      }
      if (!tails.length) return;
      for (const t of tails) {
        // Face the viewer about the tail's own length.
        toCam.copy(camera.position).sub(world);
        normal.copy(toCam).addScaledVector(t.dir, -toCam.dot(t.dir));
        if (normal.lengthSq() < 1e-6) normal.set(0, 1, 0).addScaledVector(t.dir, -t.dir.y);
        normal.normalize();
        side.crossVectors(normal, t.dir).normalize();
        basis.makeBasis(t.dir, side, normal);
        t.mesh.quaternion.setFromRotationMatrix(basis);
      }
    },
    dispose() {
      disposeObject(group);
    },
  };
}
