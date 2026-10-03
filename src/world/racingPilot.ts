import * as THREE from 'three';
import { RACING } from '../content/racing/rules.ts';
import type { Rng } from '../content/random.ts';
import { aimErrors } from '../flight/autopilot.ts';
import { lookRotation, neutralControls, ShipBody, type ShipControls, type ShipParams } from '../flight/ShipBody.ts';
import { crossesGate, type CourseLine } from './courses.ts';

/**
 * The racing pilot (docs/PROCGEN.md §33.4): what flies every racer, on its own fixed step of 1/60 s
 * so a heat comes out the same on every device, at any frame rate. It reads nothing but its own ship
 * and the course: not the pilot, not the frame. Positions are relative to the course's body.
 */

export const PILOT_STEP = RACING.pilot.step;

/** How a racer flies one heat, drawn before the start: nothing random happens in flight. */
export interface PilotSkill {
  s: number;
  /** Seconds off the line. */
  reaction: number;
  throttle: number;
  /** The stick's reach. */
  steer: number;
  /** Toward the next gate through each gate, a share of its radius. */
  lead: number;
  /** Where it aims through each gate, in shares of the radius across the gate's plane. */
  offsets: readonly (readonly [number, number])[];
  boostFrom: number;
  cruiseExit: number;
  /** A moment off the throttle after passing a gate. */
  slips: readonly { gate: number; seconds: number }[];
}

const lerp = (pair: readonly [number, number], s: number) => pair[0] + (pair[1] - pair[0]) * Math.min(1, Math.max(0, (s - 0.8) / 0.25));

/**
 * A racer's flying for a heat at skill `s` (0.8–1.05): `lane` keeps racers on lines of their own
 * across the gates (a share of the radius); errors and slips drawn from `r`, none when `clean`.
 */
export function skillFor(s: number, r: Rng | null, gates: number, lane = 0): PilotSkill {
  const P = RACING.pilot;
  const err = r ? P.offset * Math.min(1, Math.max(0, (1.05 - s) / 0.25)) : 0;
  const offsets = Array.from({ length: gates }, () => {
    const a = r ? r.range(0, Math.PI * 2) : 0;
    const m = r ? r.next() * err : 0;
    const u = Math.max(-0.7, Math.min(0.7, lane + Math.cos(a) * m));
    return [u, Math.max(-0.7, Math.min(0.7, Math.sin(a) * m))] as const;
  });
  const chance = lerp(P.slip.chance, s);
  const slips = r ? Array.from({ length: gates }, (_, gate) => ({ gate, roll: r.next(), seconds: r.range(P.slip.seconds[0], P.slip.seconds[1]) })).filter((x) => x.roll < chance).map(({ gate, seconds }) => ({ gate, seconds })) : [];
  return { s, reaction: lerp(P.reaction, s), throttle: lerp(P.throttle, s), steer: lerp(P.steer, s), lead: lerp(P.lead, s), offsets, boostFrom: lerp(P.boostFrom, s), cruiseExit: lerp(P.cruiseExit, s), slips };
}

/** A racer's progress through a heat: plain numbers, so it copies exactly. */
export interface PilotState {
  /** The next gate to pass (0: the start line). */
  gate: number;
  /** Fixed steps since the start. */
  tick: number;
  slipLeft: number;
  /** Turning back for a gate passed by. */
  recovering: boolean;
  /** Seconds from the start to the finish line, once crossed. */
  finish: number | null;
  /** Out of the heat (flown into a body: never on a course the guardrails pass). */
  out: boolean;
  /** Seconds from the start at each gate passed. */
  splits: number[];
}

export const newPilotState = (): PilotState => ({ gate: 0, tick: 0, slipLeft: 0, recovering: false, finish: null, out: false, splits: [] });

export const clonePilotState = (st: PilotState): PilotState => ({ ...st, splits: [...st.splits] });

/** A body the course keeps clear of, relative to the course's body. */
export interface Obstruction {
  centre: THREE.Vector3;
  radius: number;
}

const aim = new THREE.Vector3();
const across = new THREE.Vector3();
const e1 = new THREE.Vector3();
const e2 = new THREE.Vector3();
const before = new THREE.Vector3();
const AXIS = new THREE.Vector3(0, 1, 0);
const ALT = new THREE.Vector3(1, 0, 0);

/** Where the racer steers for its next gate: through its own spot, leaning toward the gate after, or round behind a gate it overshot. */
function aimPoint(body: ShipBody, line: CourseLine, skill: PilotSkill, st: PilotState): THREE.Vector3 {
  const g = line.gates[st.gate]!;
  const side = body.position.clone().sub(g.pos).dot(g.normal);
  if (side > -30 && !st.recovering) st.recovering = body.position.distanceTo(g.pos) > g.radius * 0.8;
  if (st.recovering && side < -300) st.recovering = false;
  if (st.recovering) return aim.copy(g.pos).addScaledVector(g.normal, -600);
  e1.crossVectors(g.normal, Math.abs(g.normal.y) > 0.9 ? ALT : AXIS).normalize();
  e2.crossVectors(g.normal, e1).normalize();
  const [u, v] = skill.offsets[st.gate] ?? [0, 0];
  aim.copy(g.pos).addScaledVector(e1, u * g.radius).addScaledVector(e2, v * g.radius);
  const next = line.gates[st.gate + 1];
  if (next) {
    across.copy(next.pos).sub(g.pos);
    across.addScaledVector(g.normal, -across.dot(g.normal));
    if (across.lengthSq() > 1) aim.addScaledVector(across.normalize(), skill.lead * g.radius);
  }
  // Well short of the gate, aim at a point on its axis behind it, so the ship comes through square.
  const d = body.position.distanceTo(aim);
  if (d > g.radius * 4 && side < 0) aim.addScaledVector(g.normal, -Math.min(d * 0.25, g.radius * 3));
  return aim;
}

/**
 * One fixed step of a racer: its controls, its ship, and the gates it passed. Before the start
 * (`started` false) it holds still on the line.
 */
export function stepRacer(body: ShipBody, line: CourseLine, skill: PilotSkill, st: PilotState, controls: ShipControls, obstructions: readonly Obstruction[] = []): void {
  if (st.out) return;
  const dt = PILOT_STEP;
  const c = controls;
  Object.assign(c, neutralControls());
  st.tick++;
  const t = st.tick * dt;
  if (st.finish === null && t > skill.reaction) {
    const point = aimPoint(body, line, skill, st);
    const e = aimErrors(body, point);
    c.steerX = Math.max(-skill.steer, Math.min(skill.steer, e.yaw * 2.2));
    c.steerY = Math.max(-skill.steer, Math.min(skill.steer, e.pitch * 2.2));
    const slipping = st.slipLeft > 0;
    if (slipping) st.slipLeft = Math.max(0, st.slipLeft - dt);
    c.throttle = slipping ? 0 : skill.throttle * (e.angle < 1.2 ? 1 : 0.6);
    const p = body.params;
    if (line.cruise) {
      const exit = skill.cruiseExit * (p.cruiseSpeed * 1.25 + 400);
      if (body.cruise === 'off' && e.distance > exit + p.cruiseSpeed * p.cruiseChargeTime * 0.5 && e.angle < 0.12 && !slipping && !st.recovering) body.requestCruise(true);
      else if (body.cruise !== 'off' && (e.distance < exit || e.angle > 0.5 || slipping)) body.requestCruise(false);
    }
    c.boost = body.cruise === 'off' && !slipping && e.angle < 0.3 && body.energy > skill.boostFrom * p.energyMax;
  } else if (st.finish !== null) {
    // Past the line: easing off.
    if (body.cruise !== 'off') body.requestCruise(false);
    c.throttle = 0.3;
  }
  before.copy(body.position);
  body.step(c, dt);
  if (st.finish === null) {
    const g = line.gates[st.gate]!;
    const f = crossesGate(before, body.position, g);
    if (f !== null) {
      st.splits.push((st.tick - 1 + f) * dt);
      if (st.gate === line.gates.length - 1) st.finish = (st.tick - 1 + f) * dt;
      else {
        const slip = skill.slips.find((x) => x.gate === st.gate);
        if (slip) st.slipLeft = slip.seconds;
        st.gate++;
        st.recovering = false;
      }
    }
  }
  for (const o of obstructions) if (body.position.distanceTo(o.centre) < o.radius) st.out = true;
}

/** Where racer `slot` of `of` waits on the line: behind the start line, abreast, facing through it. */
export function gridSpot(line: CourseLine, slot: number, of: number): { position: THREE.Vector3; quaternion: THREE.Quaternion } {
  const g = line.gates[0]!;
  const side = new THREE.Vector3().crossVectors(g.normal, Math.abs(g.normal.y) > 0.9 ? ALT : AXIS).normalize();
  const position = g.pos
    .clone()
    .addScaledVector(g.normal, -RACING.start.line.back)
    .addScaledVector(side, (slot - (of - 1) / 2) * RACING.start.line.apart);
  return { position, quaternion: lookRotation(g.normal) };
}

/** A racer's ship waiting on the line. */
export function racerOnLine(params: ShipParams, line: CourseLine, slot: number, of: number): ShipBody {
  const body = new ShipBody(params);
  const spot = gridSpot(line, slot, of);
  body.position.copy(spot.position);
  body.quaternion.copy(spot.quaternion);
  return body;
}

/** A racer's ship copied exactly (to fly it on ahead of time). */
export function cloneBody(b: ShipBody): ShipBody {
  const c = new ShipBody(b.params);
  c.position.copy(b.position);
  c.velocity.copy(b.velocity);
  c.quaternion.copy(b.quaternion);
  c.angularVelocity.copy(b.angularVelocity);
  c.throttle = b.throttle;
  c.energy = b.energy;
  c.boosting = b.boosting;
  c.cruise = b.cruise;
  c.cruiseCharge = b.cruiseCharge;
  return c;
}

/**
 * Flies a racer on to the finish (or `maxTicks` steps in all), headless: what par, the guardrails and
 * a heat's results ahead of time use. The same steps as in flight, so the same times.
 */
export function flyOn(body: ShipBody, line: CourseLine, skill: PilotSkill, st: PilotState, maxTicks: number, obstructions: readonly Obstruction[] = []): PilotState {
  const c = neutralControls();
  while (st.finish === null && !st.out && st.tick < maxTicks) stepRacer(body, line, skill, st, c, obstructions);
  return st;
}

/** A whole run from the line, headless: seconds to the finish, or null if it never got there in `maxSeconds`. */
export function simulateRun(line: CourseLine, params: ShipParams, skill: PilotSkill, maxSeconds: number, obstructions: readonly Obstruction[] = []): { finish: number | null; state: PilotState; body: ShipBody } {
  const body = racerOnLine(params, line, 0, 1);
  const state = flyOn(body, line, skill, newPilotState(), Math.ceil(maxSeconds / PILOT_STEP), obstructions);
  return { finish: state.finish, state, body };
}
