import * as THREE from 'three';
import type { CraftLook } from '../../content/stellar/spacecraft.ts';
import type { ArtContext, ArtObject } from './types.ts';
import { disposeObject } from './util.ts';

/**
 * A spacecraft in Sol (docs/PROCGEN.md §49.3), drawn far larger than life as a schematic of its kind,
 * not its true shape: a dish on a body with booms (the Voyagers, the Pioneers, New Horizons), a heat
 * shield before a body (Parker Solar Probe), a mirror over a layered sunshield (the James Webb Space
 * Telescope), round arrays (Lucy) or long ones (Psyche, Europa Clipper, JUICE). It turns slowly.
 */
export interface SpacecraftArtOptions {
  look: CraftLook;
  /** The drawn radius (scene units). */
  radius: number;
  seed: number;
}

const FOIL = '#c9a24a';
const WHITE = '#e6e6e2';
const PANEL = '#1f3157';
const SHIELD = '#b8b2c8';
const GOLD = '#e0b440';

function material(color: string, glow = 0.18): THREE.MeshStandardMaterial {
  // Faintly lit on its dark side, so it never reads as a hole in the sky.
  return new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0.35, emissive: new THREE.Color(color), emissiveIntensity: glow, side: THREE.DoubleSide });
}

/** A rod from one point to another (unit scale). */
function rod(from: THREE.Vector3, to: THREE.Vector3, thick: number, mat: THREE.Material): THREE.Mesh {
  const len = from.distanceTo(to);
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(thick, thick, len, 6), mat);
  mesh.position.copy(from).add(to).multiplyScalar(0.5);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), to.clone().sub(from).normalize());
  return mesh;
}

/** A shallow dish, opening upward, of a radius (unit scale). */
function dish(radius: number, mat: THREE.Material): THREE.Mesh {
  const points = Array.from({ length: 7 }, (_, i) => {
    const x = (radius * i) / 6;
    return new THREE.Vector2(x, (x * x) / (radius * 2.6));
  });
  return new THREE.Mesh(new THREE.LatheGeometry(points, 20), mat);
}

/** A flat array panel (unit scale). */
function panel(w: number, d: number, mat: THREE.Material): THREE.Mesh {
  return new THREE.Mesh(new THREE.BoxGeometry(w, 0.02, d), mat);
}

function build(look: CraftLook): THREE.Group {
  const g = new THREE.Group();
  const foil = material(FOIL);
  const white = material(WHITE, 0.1);
  const dark = material(PANEL, 0.25);
  switch (look) {
    case 'dish': {
      const bus = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.24, 0.14, 10), foil);
      g.add(bus);
      const d = dish(0.62, white);
      d.position.y = 0.08;
      g.add(d);
      g.add(rod(new THREE.Vector3(0.2, 0, 0), new THREE.Vector3(1.0, -0.05, 0.1), 0.012, white));
      g.add(rod(new THREE.Vector3(-0.2, 0, 0), new THREE.Vector3(-0.75, -0.08, -0.3), 0.015, white));
      const rtg = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.22, 8), foil);
      rtg.position.set(-0.8, -0.08, -0.32);
      rtg.rotation.z = Math.PI / 2;
      g.add(rtg);
      break;
    }
    case 'shield': {
      const shield = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 0.06, 24), white);
      shield.position.y = 0.45;
      g.add(shield);
      const body = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.6, 6), foil);
      g.add(body);
      for (const s of [-1, 1]) {
        const p = panel(0.36, 0.2, dark);
        p.position.set(s * 0.38, 0.05, 0);
        p.rotation.z = s * 0.5;
        g.add(p);
      }
      g.add(rod(new THREE.Vector3(0, -0.3, 0), new THREE.Vector3(0, -0.85, 0), 0.012, white));
      break;
    }
    case 'sunshield': {
      // Five thin layers, a long six-sided kite each, a little apart.
      const shape = new THREE.Shape([new THREE.Vector2(-1, 0), new THREE.Vector2(-0.55, -0.36), new THREE.Vector2(0.55, -0.36), new THREE.Vector2(1, 0), new THREE.Vector2(0.55, 0.36), new THREE.Vector2(-0.55, 0.36)]);
      const layer = new THREE.ShapeGeometry(shape);
      const shieldMat = material(SHIELD, 0.3);
      for (let i = 0; i < 5; i++) {
        const m = new THREE.Mesh(layer, shieldMat);
        m.rotation.x = -Math.PI / 2;
        m.position.y = i * 0.025;
        g.add(m);
      }
      // The mirror: gold hexagons in a honeycomb, tilted up off the shield.
      const mirror = new THREE.Group();
      const hex = new THREE.CylinderGeometry(0.11, 0.11, 0.02, 6);
      const gold = material(GOLD, 0.3);
      const cells: [number, number][] = [[0, 0]];
      for (let k = 0; k < 6; k++) cells.push([Math.cos((k * Math.PI) / 3) * 0.2, Math.sin((k * Math.PI) / 3) * 0.2]);
      for (const [x, z] of cells) {
        const c = new THREE.Mesh(hex, gold);
        c.position.set(x, 0, z);
        mirror.add(c);
      }
      mirror.rotation.x = Math.PI / 2.4;
      mirror.position.set(0, 0.45, 0);
      g.add(mirror);
      g.add(rod(new THREE.Vector3(0, 0.12, 0), new THREE.Vector3(0, 0.38, 0.05), 0.03, foil));
      break;
    }
    case 'discs': {
      const bus = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.4, 0.28), foil);
      g.add(bus);
      for (const s of [-1, 1]) {
        const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.46, 0.46, 0.02, 24), dark);
        disc.rotation.z = Math.PI / 2;
        disc.position.x = s * 0.68;
        g.add(disc);
        g.add(rod(new THREE.Vector3(s * 0.14, 0, 0), new THREE.Vector3(s * 0.68, 0, 0), 0.015, white));
      }
      const d = dish(0.2, white);
      d.position.set(0, 0.22, 0);
      g.add(d);
      break;
    }
    case 'wings': {
      const bus = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.36, 0.3), foil);
      g.add(bus);
      for (const s of [-1, 1])
        for (let k = 0; k < 4; k++) {
          const p = panel(0.24, 0.3, dark);
          p.position.set(s * (0.3 + k * 0.26), 0, 0);
          g.add(p);
        }
      const d = dish(0.26, white);
      d.position.set(0, 0.2, 0);
      g.add(d);
      break;
    }
  }
  return g;
}

export function createSpacecraft(opts: SpacecraftArtOptions, ctx: ArtContext): ArtObject<THREE.Group> {
  const group = new THREE.Group();
  group.name = 'spacecraft';
  const craft = build(opts.look);
  craft.scale.setScalar(opts.radius);
  // A tilt of its own, so they do not all sit alike.
  craft.rotation.set(((opts.seed % 7) / 7) * 0.9, ((opts.seed % 11) / 11) * Math.PI, ((opts.seed % 5) / 5) * 0.5);
  group.add(craft);
  const spin = ctx.reducedMotion ? 0 : 0.12;
  return {
    object: group,
    update(dt) {
      craft.rotateY(dt * spin);
    },
    dispose() {
      disposeObject(group);
    },
  };
}
