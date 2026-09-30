import * as THREE from 'three';
import type { V3 } from '../art/kit.ts';
import { seededRandom } from '../art/util.ts';
import type { RoomBuilder } from './builder.ts';
import { MOTION } from './motion.ts';
import type { Motion } from './motion.ts';
import type { HatKind, Outfit } from './styles.ts';

/**
 * Procedural low-poly people. Each figure is built from tapered limbs, a two-part torso, an
 * icosphere head, hair or a hat, and outfit details (coat skirts, aprons, vests, reflective
 * stripes). Proportions, skin, hair and clothing shades are seeded. Hands are placed with a small
 * two-bone IK (on counters, tables, drinks, tablets). Idle motion (breathing sway about the hips,
 * look-arounds about the neck, a bartender wiping the counter) runs in the vertex shader, so a whole
 * crowd is one draw call.
 */

export type PoseKind = 'stand' | 'hip' | 'drink' | 'crossed' | 'tablet' | 'sit' | 'sitTable' | 'sitDrink' | 'lean' | 'bartender' | 'work';

export interface PersonSpec {
  id: string;
  label: string;
  outfit: Outfit;
  /** Floor point under the pelvis. */
  pos: V3;
  /** Facing direction (radians, 0 faces +Z). */
  yaw: number;
  pose: PoseKind;
  /** Seat height (sitting poses). */
  seat?: number;
  /** Counter / table / bench height the hands rest on. */
  surface?: number;
  /** Horizontal distance from the pelvis to the surface edge. */
  reach?: number;
  seed: number;
}

export interface PersonPalette {
  skin: readonly string[];
  hair: readonly string[];
}

const UP = new THREE.Vector3(0, 1, 0);

function shade(hex: string, k: number): THREE.Color {
  return new THREE.Color(hex).multiplyScalar(k);
}

/** Two-bone IK: elbow/knee position for a limb from `a` towards `target`, bending towards `pole`. */
function solveJoint(a: THREE.Vector3, target: THREE.Vector3, l1: number, l2: number, pole: THREE.Vector3): { mid: THREE.Vector3; end: THREE.Vector3 } {
  const d = target.clone().sub(a);
  let len = d.length();
  const maxLen = (l1 + l2) * 0.995;
  const minLen = Math.abs(l1 - l2) + 0.02;
  if (len > maxLen) len = maxLen;
  if (len < minLen) len = minLen;
  const dir = d.lengthSq() > 1e-8 ? d.normalize() : new THREE.Vector3(0, -1, 0);
  const end = a.clone().addScaledVector(dir, len);
  const cosA = THREE.MathUtils.clamp((l1 * l1 + len * len - l2 * l2) / (2 * l1 * len), -1, 1);
  const ang = Math.acos(cosA);
  const perp = pole.clone().sub(dir.clone().multiplyScalar(pole.dot(dir)));
  if (perp.lengthSq() < 1e-6) perp.set(0, 0, 1).sub(dir.clone().multiplyScalar(dir.z));
  perp.normalize();
  const mid = a.clone().addScaledVector(dir, Math.cos(ang) * l1).addScaledVector(perp, Math.sin(ang) * l1);
  return { mid, end };
}

interface Ctx {
  b: RoomBuilder;
  placement: THREE.Matrix4;
  upper: THREE.Matrix4;
  seg: number;
  sway: Motion;
  look: Motion;
}

/** Tapered limb segment between two local points. */
function limb(c: Ctx, a: THREE.Vector3, e: THREE.Vector3, ra: number, re: number, color: THREE.Color, upper: boolean, bm?: Motion): void {
  const d = e.clone().sub(a);
  const len = d.length();
  if (len < 1e-4) return;
  const g = new THREE.CylinderGeometry(re, ra, len, c.seg, 1, false);
  const q = new THREE.Quaternion().setFromUnitVectors(UP, d.normalize());
  const mid = a.clone().add(e).multiplyScalar(0.5);
  c.b.addMotion('people', g, {
    position: [mid.x, mid.y, mid.z],
    quaternion: q,
    color,
    uv: 1,
    matrix: c.placement,
    a: upper ? c.sway : undefined,
    b: bm,
  });
}

/** Box part in the upper-body frame (leans with the torso). */
function part(c: Ctx, geo: THREE.BufferGeometry, pos: V3, color: THREE.Color, rot: V3 = [0, 0, 0], head = false, upper = true): void {
  const m = upper ? c.placement.clone().multiply(c.upper) : c.placement;
  c.b.addMotion('people', geo, {
    position: pos,
    rotation: rot,
    color,
    uv: 1,
    matrix: m,
    a: upper ? c.sway : undefined,
    b: head ? c.look : undefined,
  });
}

/**
 * Adds one person to the room's motion kit and returns the anchor point (upper chest, world space)
 * used for UI hotspots.
 */
export function addPerson(b: RoomBuilder, spec: PersonSpec, palette: PersonPalette): THREE.Vector3 {
  const rand = seededRandom(spec.seed * 7919 + 17);
  const H = 1.64 + rand() * 0.26;
  const build = 0.9 + rand() * 0.22;
  const o = spec.outfit;
  const jit = (): number => 0.88 + rand() * 0.22;
  const skin = new THREE.Color(palette.skin[Math.floor(rand() * palette.skin.length)]!);
  const hairCol = new THREE.Color(palette.hair[Math.floor(rand() * palette.hair.length)]!);
  const top = shade(o.top, jit());
  const bottom = shade(o.bottom, jit());
  const accent = new THREE.Color(o.accent);
  const shoes = shade('#1d1b1a', 0.8 + rand() * 0.6);
  const seg = b.low ? 5 : 6;

  const sitting = spec.pose === 'sit' || spec.pose === 'sitTable' || spec.pose === 'sitDrink';
  const hipY = sitting ? (spec.seat ?? 0.46) + 0.08 : 0.52 * H;
  const hipX = 0.056 * H * build;
  const shoulderY = hipY + 0.29 * H;
  const shoulderX = 0.118 * H * build;
  const chestY = hipY + 0.19 * H;
  const neckY = shoulderY + 0.025 * H;
  const headY = shoulderY + 0.105 * H;

  const placement = new THREE.Matrix4().compose(
    new THREE.Vector3(...spec.pos),
    new THREE.Quaternion().setFromAxisAngle(UP, spec.yaw),
    new THREE.Vector3(1, 1, 1),
  );
  // Torso lean (about the hip joint line).
  const lean = spec.pose === 'lean' ? 0.22 : spec.pose === 'work' ? 0.32 : spec.pose === 'bartender' ? 0.12 : spec.pose === 'sitTable' ? 0.1 : sitting ? -0.05 : 0;
  const upper = new THREE.Matrix4()
    .makeTranslation(0, hipY, 0)
    .multiply(new THREE.Matrix4().makeRotationX(lean))
    .multiply(new THREE.Matrix4().makeTranslation(0, -hipY, 0));
  const phase = rand() * 20;
  const sway: Motion = {
    type: MOTION.sway,
    pivot: [0, hipY, 0],
    speed: 1.25 + rand() * 0.45,
    amp: sitting ? 0.022 : spec.pose === 'work' ? 0.05 : 0.034,
    phase,
  };
  // Head parts go through the lean matrix, which also carries this pivot.
  const look: Motion = {
    type: MOTION.look,
    pivot: [0, neckY, 0],
    speed: 0.1 + rand() * 0.1,
    amp: spec.pose === 'work' || spec.pose === 'tablet' ? 0.22 : 0.55,
    phase: rand() * 30,
  };
  const c: Ctx = { b, placement, upper, seg, sway, look };

  /* Legs (static). */
  const thighR = 0.046 * H * build;
  const shinR = 0.034 * H * build;
  const thighL = 0.245 * H;
  const shinL = 0.235 * H;
  const legCol = o.kind === 'coverall' ? top : bottom;
  for (const side of [-1, 1]) {
    const hip = new THREE.Vector3(side * hipX, hipY, 0);
    let knee: THREE.Vector3;
    let ankle: THREE.Vector3;
    if (sitting) {
      knee = hip.clone().add(new THREE.Vector3(side * 0.02 * H, -0.02 * H, thighL));
      ankle = knee.clone().add(new THREE.Vector3(side * 0.01 * H, -shinL, 0.04 * H));
      if (ankle.y < 0.05 * H) {
        const drop = knee.y - 0.05 * H;
        const fwd = Math.sqrt(Math.max(0, shinL * shinL - drop * drop));
        ankle = knee.clone().add(new THREE.Vector3(side * 0.01 * H, -drop, fwd));
      }
    } else {
      const foot = new THREE.Vector3(side * (hipX + 0.012 * H), 0.05 * H, spec.pose === 'lean' ? -0.03 * H : 0.01 * H);
      const s = solveJoint(hip, foot, thighL, shinL, new THREE.Vector3(0, 0, 1));
      knee = s.mid;
      ankle = s.end;
    }
    limb(c, hip, knee, thighR, thighR * 0.8, legCol, false);
    limb(c, knee, ankle, shinR, shinR * 0.78, legCol, false);
    // Boot.
    part(c, new THREE.BoxGeometry(0.075 * H * build, 0.05 * H, 0.14 * H), [ankle.x, ankle.y - 0.022 * H, ankle.z + 0.035 * H], shoes, [0, 0, 0], false, false);
    if (o.kind === 'coverall' && !b.low) {
      const mid = knee.clone().lerp(ankle, 0.35);
      part(c, new THREE.CylinderGeometry(shinR * 1.08, shinR * 1.08, 0.022 * H, seg), [mid.x, mid.y, mid.z], shade('#d8dcd8', 1.1), [0, 0, 0], false, false);
    }
  }
  if (o.kind === 'coat' && !sitting) {
    // Coat skirt down to the knees.
    part(c, new THREE.CylinderGeometry(0.105 * H * build, 0.125 * H * build, 0.25 * H, seg + 2), [0, hipY - 0.07 * H, -0.004 * H], top, [0, 0, 0], false, false);
  }

  /* Torso. */
  part(c, new THREE.BoxGeometry(2 * hipX + 0.075 * H, 0.1 * H, 0.105 * H), [0, hipY + 0.02 * H, 0], o.kind === 'coverall' ? top : bottom);
  const abdomen = new THREE.CylinderGeometry(1.14, 1, chestY - (hipY + 0.05 * H), seg + 2);
  abdomen.scale(0.083 * H * build, 1, 0.056 * H);
  part(c, abdomen, [0, (chestY + hipY + 0.05 * H) / 2, 0], top);
  const chest = new THREE.CylinderGeometry(1.2, 1, shoulderY - chestY, seg + 2);
  chest.scale(0.095 * H * build, 1, 0.062 * H);
  part(c, chest, [0, (chestY + shoulderY) / 2, 0.002 * H], o.kind === 'vest' ? accent : top);
  part(c, new THREE.BoxGeometry(2 * shoulderX + 0.02 * H, 0.05 * H, 0.105 * H), [0, shoulderY - 0.012 * H, 0], o.kind === 'vest' ? accent : top);
  // Outfit details.
  switch (o.kind) {
    case 'vest':
      part(c, new THREE.BoxGeometry(0.17 * H * build, 0.2 * H, 0.02 * H), [0, chestY - 0.01 * H, 0.06 * H], top);
      part(c, new THREE.BoxGeometry(0.2 * H * build, 0.1 * H, 0.118 * H), [0, hipY + 0.1 * H, 0], top);
      break;
    case 'apron':
      part(c, new THREE.BoxGeometry(0.16 * H, 0.36 * H, 0.012 * H), [0, hipY + 0.02 * H, 0.068 * H], accent);
      break;
    case 'suit':
      part(c, new THREE.BoxGeometry(0.018 * H, 0.14 * H, 0.012 * H), [0, chestY + 0.02 * H, 0.066 * H], accent);
      part(c, new THREE.BoxGeometry(0.06 * H, 0.16 * H, 0.012 * H), [0, chestY + 0.02 * H, 0.063 * H], shade('#e8e8e8', 0.9));
      break;
    case 'uniform':
      for (const side of [-1, 1]) part(c, new THREE.BoxGeometry(0.06 * H, 0.012 * H, 0.08 * H), [side * shoulderX * 0.85, shoulderY + 0.013 * H, 0], accent);
      part(c, new THREE.BoxGeometry(2 * hipX + 0.08 * H, 0.02 * H, 0.11 * H), [0, hipY + 0.07 * H, 0], accent);
      break;
    case 'coverall':
      if (!b.low) {
        const band = new THREE.CylinderGeometry(1.2, 1.2, 0.022 * H, seg + 2);
        band.scale(0.096 * H * build, 1, 0.064 * H);
        part(c, band, [0, chestY + 0.04 * H, 0.002 * H], shade('#d8dcd8', 1.1));
      }
      part(c, new THREE.BoxGeometry(2 * hipX + 0.08 * H, 0.02 * H, 0.11 * H), [0, hipY + 0.07 * H, 0], accent);
      break;
    case 'jacket':
      part(c, new THREE.BoxGeometry(2 * hipX + 0.078 * H, 0.03 * H, 0.108 * H), [0, hipY + 0.075 * H, 0], shade(o.top, 0.7));
      part(c, new THREE.BoxGeometry(0.015 * H, 0.2 * H, 0.012 * H), [0.012 * H, chestY - 0.005 * H, 0.063 * H], accent);
      break;
    case 'coat':
      part(c, new THREE.BoxGeometry(0.05 * H, 0.22 * H, 0.012 * H), [0, chestY - 0.03 * H, 0.062 * H], shade(o.bottom, 1));
      break;
  }
  // Collar.
  part(c, new THREE.BoxGeometry(0.1 * H, 0.025 * H, 0.08 * H), [0, shoulderY + 0.01 * H, 0.004 * H], accent);

  /* Arms. */
  const upperL = 0.182 * H;
  const foreL = 0.152 * H;
  const upperR = 0.031 * H * build;
  const foreR = 0.026 * H * build;
  const sleeve = o.kind === 'vest' ? accent : top;
  const surf = spec.surface ?? (sitting ? hipY + 0.2 : 1.05);
  const reach = spec.reach ?? 0.3;
  for (const side of [-1, 1]) {
    const sh = new THREE.Vector3(side * shoulderX, shoulderY - 0.02 * H, 0).applyMatrix4(upper);
    let target: THREE.Vector3;
    let pole = new THREE.Vector3(side * 0.4, -1, -0.5);
    let wipe: Motion | undefined;
    switch (spec.pose) {
      case 'hip':
        target = side > 0 ? new THREE.Vector3(side * (shoulderX + 0.012 * H), hipY + 0.07 * H, 0.0) : new THREE.Vector3(side * (shoulderX + 0.02 * H), hipY - 0.03 * H, 0.03 * H);
        if (side > 0) pole = new THREE.Vector3(1, -0.2, -0.6);
        break;
      case 'drink':
      case 'sitDrink':
        target = side > 0 ? new THREE.Vector3(side * (shoulderX - 0.035 * H), chestY - 0.03 * H, 0.16 * H) : sitting ? new THREE.Vector3(side * 0.1 * H, hipY + 0.06 * H, 0.14 * H) : new THREE.Vector3(side * (shoulderX + 0.02 * H), hipY - 0.03 * H, 0.03 * H);
        break;
      case 'crossed':
        target = new THREE.Vector3(-side * 0.055 * H, chestY - 0.035 * H, 0.085 * H);
        pole = new THREE.Vector3(side * 0.6, -1, 0.2);
        break;
      case 'tablet':
        target = new THREE.Vector3(side * 0.065 * H, chestY - 0.06 * H, 0.2 * H);
        break;
      case 'sit':
        target = new THREE.Vector3(side * 0.09 * H, hipY + 0.05 * H, 0.16 * H);
        break;
      case 'sitTable':
      case 'lean':
      case 'bartender':
      case 'work':
        target = new THREE.Vector3(side * (0.09 + (spec.pose === 'work' ? 0.04 : 0)) * H, surf + 0.03, reach + (side > 0 ? 0.02 : 0.06) * H);
        pole = new THREE.Vector3(side * 0.8, -1, -0.2);
        if (spec.pose === 'bartender' && side > 0) wipe = undefined;
        break;
      default:
        target = new THREE.Vector3(side * (shoulderX + 0.02 * H), hipY - 0.03 * H, 0.03 * H);
    }
    const s = solveJoint(sh, target, upperL, foreL, pole);
    if (spec.pose === 'bartender' && side > 0) {
      wipe = { type: MOTION.swingY, pivot: [s.mid.x, s.mid.y, s.mid.z], speed: 1.7, amp: 0.3, phase: phase };
    }
    limb(c, sh, s.mid, upperR, upperR * 0.9, sleeve, true);
    limb(c, s.mid, s.end, foreR, foreR * 0.85, sleeve, true, wipe);
    // Hand.
    const dir = s.end.clone().sub(s.mid).normalize();
    const hand = s.end.clone().addScaledVector(dir, 0.04 * H);
    const hq = new THREE.Quaternion().setFromUnitVectors(UP, dir);
    c.b.addMotion('people', new THREE.BoxGeometry(0.045 * H, 0.085 * H, 0.028 * H), {
      position: [hand.x, hand.y, hand.z],
      quaternion: hq,
      color: skin,
      uv: 1,
      matrix: placement,
      a: sway,
      b: wipe,
    });
    // Held things.
    if (side > 0 && (spec.pose === 'drink' || spec.pose === 'sitDrink')) {
      c.b.addMotion('people', new THREE.CylinderGeometry(0.035, 0.03, 0.12, 6), {
        position: [hand.x, hand.y + 0.05, hand.z + 0.01],
        color: shade('#d8a860', 1.2),
        uv: 1,
        matrix: placement,
        a: sway,
      });
    }
    if (side > 0 && spec.pose === 'tablet') {
      c.b.addMotion('people', new THREE.BoxGeometry(0.22 * H * 0.8, 0.012, 0.14), {
        position: [0, hand.y + 0.03, hand.z],
        rotation: [0.5, 0, 0],
        color: shade('#6ab8ff', 1.4),
        uv: 1,
        matrix: placement,
        a: sway,
      });
    }
  }

  /* Neck and head. */
  part(c, new THREE.CylinderGeometry(0.026 * H, 0.03 * H, 0.06 * H, seg), [0, neckY + 0.015 * H, 0.004 * H], skin, [0, 0, 0], true);
  const head = new THREE.IcosahedronGeometry(1, 1);
  head.scale(0.05 * H, 0.064 * H, 0.058 * H);
  part(c, head, [0, headY, 0.006 * H], skin, [0, 0, 0], true);
  // Jaw/face plane hint: a slightly darker lower band reads as a chin in silhouette.
  const hat: HatKind = o.hat ?? 'none';
  const hairStyle = rand();
  if (hat === 'helmet') {
    const g = new THREE.SphereGeometry(1, 8, 5, 0, Math.PI * 2, 0, Math.PI * 0.55);
    g.scale(0.058 * H, 0.06 * H, 0.066 * H);
    part(c, g, [0, headY + 0.01 * H, 0.002 * H], shade(o.hatColor ?? o.accent, 1), [0, 0, 0], true);
    part(c, new THREE.BoxGeometry(0.09 * H, 0.012 * H, 0.03 * H), [0, headY + 0.018 * H, 0.06 * H], shade('#2a2c30', 1), [0, 0, 0], true);
  } else if (hat === 'cap') {
    part(c, new THREE.CylinderGeometry(0.052 * H, 0.055 * H, 0.035 * H, seg + 2), [0, headY + 0.045 * H, 0], shade(o.top, 0.9), [0, 0, 0], true);
    part(c, new THREE.BoxGeometry(0.07 * H, 0.008 * H, 0.05 * H), [0, headY + 0.03 * H, 0.06 * H], shade(o.top, 0.6), [0, 0, 0], true);
  } else if (hat === 'beanie') {
    const g = new THREE.SphereGeometry(1, 7, 4, 0, Math.PI * 2, 0, Math.PI * 0.5);
    g.scale(0.054 * H, 0.068 * H, 0.062 * H);
    part(c, g, [0, headY + 0.012 * H, 0.002 * H], shade(o.accent, 0.8), [0, 0, 0], true);
  } else if (hairStyle > 0.1) {
    const g = new THREE.SphereGeometry(1, 8, 4, 0, Math.PI * 2, 0, Math.PI * 0.52);
    g.scale(0.054 * H, 0.066 * H, 0.063 * H);
    part(c, g, [0, headY + 0.008 * H, -0.003 * H], hairCol, [-0.25, 0, 0], true);
    if (hairStyle > 0.62) {
      // Longer hair down the back.
      part(c, new THREE.BoxGeometry(0.09 * H, 0.1 * H, 0.03 * H), [0, headY - 0.04 * H, -0.045 * H], hairCol, [0, 0, 0], true);
    } else if (hairStyle > 0.5) {
      const bun = new THREE.IcosahedronGeometry(0.025 * H, 0);
      part(c, bun, [0, headY + 0.03 * H, -0.06 * H], hairCol, [0, 0, 0], true);
    }
  }

  const anchor = new THREE.Vector3(0, chestY + 0.03 * H, 0.05 * H).applyMatrix4(upper).applyMatrix4(placement);
  return anchor;
}
