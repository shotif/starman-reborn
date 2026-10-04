import * as THREE from 'three';
import { sitesIn } from '../content/outposts/sites.ts';
import { RACING, type CourseKind, type CourseShape } from '../content/racing/rules.ts';
import { rng } from '../content/random.ts';
import { WORLD_SEED } from '../content/world/rules.ts';
import type { SystemId } from '../data/types.ts';
import type { SystemSceneDef } from './sceneTypes.ts';
import { sceneDefFor } from './systems/index.ts';
import { siteDock } from './siteDock.ts';

/**
 * A race course in a system's scene (docs/PROCGEN.md §33.1): gates in order from the start line to
 * the finish line, laid round a real body's place in the scene and kept clear of every star's and
 * planet's surface, every station, lane and belt. Pure: worked out from the course's id and the
 * scene, the same for every player. Gate positions are relative to the body the course rounds, so
 * Sol's course keeps its shape as Earth goes round the Sun (the Moon keeps its place by Earth).
 */

export interface RaceGate {
  /** Relative to the course's body. */
  readonly pos: THREE.Vector3;
  /** The way through: a gate is passed crossing its plane this way, inside its radius. */
  readonly normal: THREE.Vector3;
  readonly radius: number;
}

export interface CourseLine {
  readonly id: string;
  readonly kind: CourseKind;
  readonly systemId: SystemId;
  /** The real body the course rounds (its gates are relative to it). */
  readonly bodyId: string;
  /** The start line first, the finish line last. */
  readonly gates: readonly RaceGate[];
  readonly cruise: boolean;
  /** Start line to finish line along the gates, metres. */
  readonly length: number;
  /** A Run between docks: the dock it finishes off (none when out and back). */
  readonly finishAt?: string;
}

/** What a course is laid from: its id, kind, system and host dock. */
export interface CourseSpec {
  id: string;
  kind: CourseKind;
  systemId: SystemId;
  hostId: string;
}

interface Body {
  id: string;
  position: THREE.Vector3;
  /** The surface the course keeps off (a star's counted at 1.3 radii, as everywhere). */
  surface: number;
  star: boolean;
}

const UP = new THREE.Vector3(0, 1, 0);

function bodiesOf(def: SystemSceneDef): Body[] {
  return [
    ...def.planets.map((p) => ({ id: p.id, position: p.position, surface: p.radius, star: false })),
    ...def.stars.map((s) => ({ id: s.id, position: s.position, surface: s.radius * 1.3, star: true })),
  ];
}

/** Every dock a course keeps clear of: the scene's stations and every outpost a pilot might build there. */
function docksOf(def: SystemSceneDef): THREE.Vector3[] {
  return [...def.stations.map((s) => s.position), ...sitesIn(def.systemId).flatMap((site) => siteDock(def, site)?.position ?? [])];
}

/** Distance from a point to the segment a–b. */
export function segmentDistance(p: THREE.Vector3, a: THREE.Vector3, b: THREE.Vector3): number {
  const abx = b.x - a.x, aby = b.y - a.y, abz = b.z - a.z;
  const len2 = abx * abx + aby * aby + abz * abz;
  let t = len2 > 0 ? ((p.x - a.x) * abx + (p.y - a.y) * aby + (p.z - a.z) * abz) / len2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const dx = a.x + abx * t - p.x, dy = a.y + aby * t - p.y, dz = a.z + abz * t - p.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/**
 * What is wrong with a course's gates (world positions, `origin` added) in a scene: each problem in
 * words, none when it is clear. Used to lay courses and by the guardrails.
 */
export function courseIssues(def: SystemSceneDef, gates: readonly RaceGate[], origin: THREE.Vector3, shape: CourseShape): string[] {
  const C = RACING.clear;
  const out: string[] = [];
  const at = gates.map((g) => g.pos.clone().add(origin));
  const bodies = bodiesOf(def);
  const docks = docksOf(def);
  for (let i = 0; i < at.length; i++) {
    const p = at[i]!;
    for (const b of bodies) if (b.position.distanceTo(p) < b.surface + C.body) out.push(`gate ${i} near ${b.id}`);
    if (docks.some((d) => d.distanceTo(p) < C.dock)) out.push(`gate ${i} near a dock`);
    for (const l of def.lanes) if (segmentDistance(p, l.from, l.to) < C.lane + gates[i]!.radius) out.push(`gate ${i} on lane ${l.id}`);
    for (const belt of def.belts) {
      const radial = Math.hypot(p.x - belt.center.x, p.z - belt.center.z);
      if (radial > belt.innerRadius - C.belt && radial < belt.outerRadius + C.belt && Math.abs(p.y - belt.center.y) < belt.thickness / 2 + C.belt) out.push(`gate ${i} in belt ${belt.id}`);
    }
    for (let j = 0; j < i; j++) if (at[j]!.distanceTo(p) < C.apart) out.push(`gates ${j} and ${i} too close`);
    if (i > 0) {
      const a = at[i - 1]!;
      const leg = a.distanceTo(p);
      if (leg < shape.leg[0] || leg > shape.leg[1]) out.push(`leg ${i} of ${Math.round(leg)} m`);
      for (const b of bodies) if (segmentDistance(b.position, a, p) < b.surface + C.leg) out.push(`leg ${i} through ${b.id}`);
    }
    if (i > 0 && i < at.length - 1) {
      const turn = at[i]!.clone().sub(at[i - 1]!).angleTo(at[i + 1]!.clone().sub(at[i]!));
      if (turn > RACING.maxTurn) out.push(`turn at gate ${i}`);
    }
  }
  const length = at.reduce((s, p, i) => (i ? s + p.distanceTo(at[i - 1]!) : 0), 0);
  if (length < shape.length[0] || length > shape.length[1]) out.push(`length ${Math.round(length)} m`);
  if (at.length < shape.gates[0] || at.length > shape.gates[1]) out.push(`${at.length} gates`);
  return out;
}

/** Each gate's way through: along the course (the start's toward the next gate, the finish's from the last). */
function withNormals(points: readonly THREE.Vector3[], radius: number): RaceGate[] {
  return points.map((pos, i) => {
    const into = i > 0 ? pos.clone().sub(points[i - 1]!).normalize() : null;
    const out = i < points.length - 1 ? points[i + 1]!.clone().sub(pos).normalize() : null;
    const normal = into && out ? into.add(out).normalize() : (into ?? out)!;
    return { pos, normal, radius };
  });
}

/** A ring round a centre in a plane: tilted `tilt` about a level axis at `azimuth`, lifted `lift` along its normal. */
interface Ring {
  centre: THREE.Vector3;
  radius: number;
  e1: THREE.Vector3;
  e2: THREE.Vector3;
  normal: THREE.Vector3;
}

function ringAround(centre: THREE.Vector3, radius: number, tilt: number, azimuth: number, lift: number): Ring {
  const axis = new THREE.Vector3(Math.cos(azimuth), 0, Math.sin(azimuth));
  const normal = UP.clone().applyAxisAngle(axis, tilt);
  const e1 = axis.clone();
  const e2 = new THREE.Vector3().crossVectors(normal, e1).normalize();
  return { centre: centre.clone().addScaledVector(normal, lift), radius, e1, e2, normal };
}

function onRing(r: Ring, angle: number, rise = 0): THREE.Vector3 {
  return r.centre
    .clone()
    .addScaledVector(r.e1, r.radius * Math.cos(angle))
    .addScaledVector(r.e2, r.radius * Math.sin(angle))
    .addScaledVector(r.normal, rise);
}

/** The ring angle nearest a point. */
function angleOf(r: Ring, p: THREE.Vector3): number {
  const d = p.clone().sub(r.centre);
  return Math.atan2(d.dot(r.e2), d.dot(r.e1));
}

/** Points along a straight leg so no leg is longer than `max`. */
function fill(a: THREE.Vector3, b: THREE.Vector3, max: number): THREE.Vector3[] {
  const n = Math.ceil(a.distanceTo(b) / max);
  return Array.from({ length: Math.max(0, n - 1) }, (_, i) => a.clone().lerp(b, (i + 1) / n));
}

/** Systems whose scenes move with the game date (Sol): a course there is checked across a whole Earth–Mars cycle. */
const MOVING: readonly SystemId[] = ['sol'];
const SWEEP_FROM = 2_461_000;
const SWEEP_DAYS = 800;
const SWEEP_STEPS = 72;
let solSweep: SystemSceneDef[] | null = null;

/** The scenes a course must be clear in: the system's own, and Sol's across a whole cycle of the planets. */
function scenesFor(systemId: SystemId): SystemSceneDef[] {
  if (!MOVING.includes(systemId)) return [];
  solSweep ??= Array.from({ length: SWEEP_STEPS }, (_, i) => sceneDefFor('sol', SWEEP_FROM + (i * SWEEP_DAYS) / SWEEP_STEPS));
  return solSweep;
}

/** A body's place in a scene. */
export function bodyPosition(def: SystemSceneDef, bodyId: string): THREE.Vector3 | null {
  return (def.planets.find((p) => p.id === bodyId) ?? def.stars.find((s) => s.id === bodyId))?.position ?? null;
}

const lines = new Map<string, CourseLine | null>();

/** A course's line (cached), or null when nothing clear can be laid. */
export function courseLine(spec: CourseSpec): CourseLine | null {
  if (!lines.has(spec.id)) lines.set(spec.id, layCourse(spec));
  return lines.get(spec.id)!;
}

/**
 * Lays a course: a Sprint on a ring round the real body nearest its host dock (the start and finish
 * on the ring, on the side toward the dock); a Run from off its host dock round a body to off the
 * system's farthest other dock, or out and back where there is none (in Sol, on a ring above Earth,
 * since its docks move with the planets). Tries ring sizes, tilts and starting angles in an order
 * drawn from the course's id until every gate and leg is clear, in every scene it must be clear in.
 */
export function layCourse(spec: CourseSpec, why?: string[]): CourseLine | null {
  const def = sceneDefFor(spec.systemId);
  const host = def.stations.find((s) => s.locationId === spec.hostId);
  if (!host) return null;
  const shape: CourseShape = RACING[spec.kind];
  const r = rng(WORLD_SEED, 'course', spec.id);
  const bodies = bodiesOf(def);
  const moving = MOVING.includes(spec.systemId);
  const sweeps = scenesFor(spec.systemId);
  const tilts = r.shuffle([0, 0.35, 0.7, 1.05, Math.PI / 2]);
  const lifts = [0, 0.6, -0.6, 0.9, -0.9];
  const others = def.stations.filter((s) => s !== host && !s.hostile).sort((a, b) => b.position.distanceTo(host.position) - a.position.distanceTo(host.position));
  const far = !moving && spec.kind === 'run' ? others[0] : undefined;

  // Bodies to round: a Sprint the nearest to its dock first; a Run the nearest to the middle of its way.
  const mid = far ? host.position.clone().lerp(far.position, 0.5) : host.position;
  const candidates = [...bodies].sort((a, b) => a.position.distanceTo(mid) - a.surface - (b.position.distanceTo(mid) - b.surface));
  if (moving) candidates.sort((a, b) => Number(b.id === (spec.kind === 'sprint' ? 'moon' : 'earth')) - Number(a.id === (spec.kind === 'sprint' ? 'moon' : 'earth')));

  for (const body of candidates.slice(0, 6)) {
    for (let attempt = 0; attempt < 60; attempt++) {
      const ringOff = r.range(shape.ring[0], shape.ring[1]);
      const radius = body.surface + ringOff;
      const tilt = tilts[attempt % tilts.length]!;
      const lift = moving && spec.kind === 'run' ? lifts[1 + (attempt % 4)]! * radius : attempt < 20 ? 0 : lifts[attempt % lifts.length]! * radius * 0.5;
      const ring = ringAround(body.position, radius, tilt, r.range(0, Math.PI * 2), lift);
      const dir = r.next() < 0.5 ? 1 : -1;
      const rise = () => r.range(-0.08, 0.08) * radius;
      let points: THREE.Vector3[];
      if (spec.kind === 'sprint' || moving) {
        // On the ring: the start toward the host dock (in Sol, anywhere: its dock moves).
        const span = THREE.MathUtils.degToRad(r.range(shape.arc[0], shape.arc[1]));
        const a0 = (moving ? r.range(0, Math.PI * 2) : angleOf(ring, host.position)) - (dir * span) / 2 + Math.PI + r.range(-0.4, 0.4);
        const n = Math.min(shape.gates[1], Math.max(shape.gates[0], Math.ceil((radius * span) / (shape.leg[1] * 0.85)) + 1));
        points = Array.from({ length: n }, (_, i) => onRing(ring, a0 + (dir * i * span) / (n - 1), i && i < n - 1 ? rise() : 0));
      } else {
        // From off the host dock, round the body the long way, to off the far dock (or back by the host).
        const off = RACING.clear.startOff[attempt % RACING.clear.startOff.length]!;
        const start = host.position.clone().addScaledVector(host.approach, off);
        const side = new THREE.Vector3().crossVectors(host.approach, UP).normalize();
        const finish = far ? far.position.clone().addScaledVector(far.approach, off) : start.clone().addScaledVector(side.lengthSq() > 0 ? side : new THREE.Vector3(1, 0, 0), RACING.clear.apart + 300);
        let a1 = angleOf(ring, start);
        let span = far ? ((((angleOf(ring, finish) - a1) * dir) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2) : 0;
        if (!far || span < THREE.MathUtils.degToRad(shape.arc[0]) || span > THREE.MathUtils.degToRad(shape.arc[1])) {
          // Out and back (or between docks close together): round the far side of the body, the gap toward the docks.
          span = THREE.MathUtils.degToRad(r.range(Math.max(shape.arc[0], 200), shape.arc[1]));
          a1 = angleOf(ring, start.clone().lerp(finish, 0.5)) + Math.PI - (dir * span) / 2;
        }
        const m = Math.max(2, Math.ceil((radius * span) / (shape.leg[1] * 0.7)) + 1);
        const arc = Array.from({ length: m }, (_, i) => onRing(ring, a1 + (dir * i * span) / (m - 1), rise()));
        points = [start, ...fill(start, arc[0]!, shape.leg[1] * 0.9), ...arc, ...fill(arc[m - 1]!, finish, shape.leg[1] * 0.9), finish];
      }
      const gates = withNormals(
        points.map((p) => p.sub(body.position)),
        shape.gate,
      );
      const issues = courseIssues(def, gates, body.position, shape);
      if (issues.length) {
        why?.push(`${body.id}: ${issues.join(', ')}`);
        continue;
      }
      if (sweeps.some((d) => courseIssues(d, gates, bodyPosition(d, body.id)!, shape).length)) continue;
      const length = gates.reduce((s, g, i) => (i ? s + g.pos.distanceTo(gates[i - 1]!.pos) : 0), 0);
      return { id: spec.id, kind: spec.kind, systemId: spec.systemId, bodyId: body.id, gates, cruise: shape.cruise, length, ...(far && spec.kind === 'run' ? { finishAt: far.locationId } : {}) };
    }
  }
  return null;
}

/**
 * Where a step from `p0` to `p1` crosses a gate's plane the right way, as a fraction of the step,
 * when it does so inside the gate (positions relative to the course's body); null otherwise.
 */
export function crossesGate(p0: THREE.Vector3, p1: THREE.Vector3, g: RaceGate): number | null {
  const s0 = (p0.x - g.pos.x) * g.normal.x + (p0.y - g.pos.y) * g.normal.y + (p0.z - g.pos.z) * g.normal.z;
  const s1 = (p1.x - g.pos.x) * g.normal.x + (p1.y - g.pos.y) * g.normal.y + (p1.z - g.pos.z) * g.normal.z;
  if (!(s0 < 0 && s1 >= 0)) return null;
  const t = s0 / (s0 - s1);
  const x = p0.x + (p1.x - p0.x) * t - g.pos.x;
  const y = p0.y + (p1.y - p0.y) * t - g.pos.y;
  const z = p0.z + (p1.z - p0.z) * t - g.pos.z;
  return x * x + y * y + z * z <= g.radius * g.radius ? t : null;
}

/** Whether a step crossed a gate's plane the right way outside it but near (within three radii): a missed gate. */
export function missedGate(p0: THREE.Vector3, p1: THREE.Vector3, g: RaceGate): boolean {
  const s0 = p0.clone().sub(g.pos).dot(g.normal);
  const s1 = p1.clone().sub(g.pos).dot(g.normal);
  if (!(s0 < 0 && s1 >= 0)) return false;
  const t = s0 / (s0 - s1);
  const d = p0.clone().lerp(p1, t).distanceTo(g.pos);
  return d > g.radius && d <= g.radius * 3;
}
