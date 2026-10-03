import * as THREE from 'three';
import { shipModel } from '../content/catalog.ts';
import { RACE_LINES } from '../content/racing/lines.ts';
import { RACING, type RaceClass } from '../content/racing/rules.ts';
import { performanceOf } from '../economy/loadout.ts';
import type { Racer, Standing } from '../economy/racing.ts';
import { neutralControls, type ShipBody, type ShipControls } from '../flight/ShipBody.ts';
import type { HudRace } from '../ui/hud/hudModel.ts';
import { createRaceGate, type RaceGateArt } from './art/raceGate.ts';
import type { ShipArt } from './art/ships.ts';
import { createCatalogShipArt } from './art/shipgen/index.ts';
import type { ArtContext } from './art/types.ts';
import { crossesGate, missedGate, type CourseLine } from './courses.ts';
import { cloneBody, clonePilotState, flyOn, newPilotState, PILOT_STEP, racerOnLine, stepRacer, type Obstruction, type PilotState } from './racingPilot.ts';
import type { Target } from './targets.ts';

/**
 * A race under way in the flight scene (docs/PROCGEN.md §33.4): the course's gates, the racers on
 * the line and flying it on their own fixed step, the pilot's start, gates and finish, and what the
 * HUD shows. Racers never see the pilot or the frame, so a heat's times are the same on any device.
 * Course positions are relative to the body it rounds (`origin` in the scene).
 */

/** What a flight needs to stage a race: the entry's course, heat and field, and the pilot's references. */
export interface RaceSetup {
  courseId: string;
  name: string;
  club: string;
  cls: RaceClass;
  /** The heat's window on the game clock. */
  opens: number;
  closes: number;
  racers: readonly Racer[];
  grid: number;
  /** The pilot's par splits and finish, and their best, for the split shown. */
  par: { splits: readonly number[]; finish: number } | null;
  best: number | null;
  /** Seconds after the start the marshals close the course. */
  cutoff: number;
}

export type RacePhase = 'approach' | 'wait' | 'ready' | 'countdown' | 'on' | 'done';

export type RaceEvent =
  | { kind: 'false-start' }
  | { kind: 'go' }
  | { kind: 'count'; n: number }
  | { kind: 'gate'; n: number }
  | { kind: 'missed'; n: number }
  | { kind: 'finish'; raw: number; field: Standing[] }
  | { kind: 'cut'; field: Standing[] }
  | { kind: 'retired'; field: Standing[] }
  | { kind: 'lost'; field: Standing[] }
  | { kind: 'lapsed' };

interface RacerHere {
  racer: Racer;
  body: ShipBody;
  st: PilotState;
  art: ShipArt;
  target: Target;
  controls: ShipControls;
  /** Seconds since it crossed the finish (it is gone after `RACING.ease.after`). */
  past: number;
  gone: boolean;
}

const Z = new THREE.Vector3(0, 0, 1);
const tmp = new THREE.Vector3();
const tmp2 = new THREE.Vector3();
const bankQ = new THREE.Quaternion();
const Z_AXIS = new THREE.Vector3(0, 0, 1);

export class RaceRun {
  phase: RacePhase = 'approach';
  /** Seconds since the start (the pilot's clock). */
  clock = 0;
  private countdown = 0;
  private acc = 0;
  /** The next gate the pilot must pass (0: the start line), and the pilot's split at each gate. */
  private gate = 0;
  private readonly splits: number[] = [];
  finish: number | null = null;
  private stillFor = 0;
  private missedAt = -99;
  private readonly gates: RaceGateArt[] = [];
  private readonly racers: RacerHere[] = [];
  private readonly gateTargets: Target[] = [];
  private readonly boxTarget: Target;
  private readonly obstructions: Obstruction[];

  readonly setup: RaceSetup;
  readonly line: CourseLine;
  readonly origin: THREE.Vector3;
  private readonly scene: THREE.Scene;

  constructor(setup: RaceSetup, line: CourseLine, origin: THREE.Vector3, scene: THREE.Scene, ctx: ArtContext, bodies: readonly { centre: THREE.Vector3; radius: number }[]) {
    this.setup = setup;
    this.line = line;
    this.origin = origin;
    this.scene = scene;
    // Bodies relative to the course: a racer that ever got inside one would be out (the guardrails see it never does).
    this.obstructions = bodies.map((b) => ({ centre: b.centre.clone().sub(origin), radius: b.radius }));
    const last = line.gates.length - 1;
    line.gates.forEach((g, i) => {
      const art = createRaceGate(g.radius, i === last, ctx);
      art.object.position.copy(g.pos).add(origin);
      art.object.quaternion.setFromUnitVectors(Z, g.normal);
      art.setLook(i === 0 ? 'next' : i === 1 ? 'after' : 'later');
      scene.add(art.object);
      this.gates.push(art);
      this.gateTargets.push({
        id: `race-gate:${i}`,
        name: i === 0 ? `${setup.name}: start line` : i === last ? `${setup.name}: finish line` : `${setup.name}: gate ${i} of ${last}`,
        kind: 'gate',
        position: art.object.position,
        radius: g.radius,
        subtitle: 'Race gate · fiction',
        dataClass: 'fictional',
        hostile: false,
        alive: true,
        cycle: false,
      });
    });
    const g0 = line.gates[0]!;
    this.boxTarget = {
      id: 'race-box',
      name: `${setup.name}: start box`,
      kind: 'gate',
      position: g0.pos.clone().addScaledVector(g0.normal, -RACING.start.line.back - 50).add(origin),
      radius: 20,
      subtitle: 'Wait here for the start · fiction',
      dataClass: 'fictional',
      hostile: false,
      alive: true,
      cycle: true,
    };
    for (const r of setup.racers) {
      const flight = performanceOf({ model: r.model, fittings: { ...shipModel(r.model).stock } }).flight;
      const body = racerOnLine(flight, line, r.slot, setup.grid);
      const art = createCatalogShipArt(shipModel(r.model), ctx);
      art.setThrottle(0.1);
      scene.add(art.object);
      const position = new THREE.Vector3();
      const target: Target = {
        id: `racer:${r.id}`,
        name: r.name,
        kind: 'ship',
        position,
        velocity: new THREE.Vector3(),
        radius: art.radius,
        subtitle: `Racer · ${shipModel(r.model).name} · ${r.rival ? 'rival pilot' : setup.club}`,
        dataClass: 'fictional',
        hostile: false,
        alive: true,
        cycle: true,
      };
      this.racers.push({ racer: r, body, st: newPilotState(), art, target, controls: neutralControls(), past: 0, gone: false });
    }
    this.syncArt();
  }

  /** Under way: guns sealed, the autopilot, lanes and docks closed. */
  get closed(): boolean {
    return this.phase === 'countdown' || this.phase === 'on';
  }

  get sealedCruise(): boolean {
    return this.closed && !this.line.cruise;
  }

  canStart(): boolean {
    return this.phase === 'ready';
  }

  canRetire(): boolean {
    return this.phase === 'on' && this.stillFor >= RACING.retire.seconds;
  }

  start(): void {
    if (this.phase !== 'ready') return;
    this.phase = 'countdown';
    this.countdown = RACING.start.countdown;
  }

  private local(p: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 {
    return out.copy(p).sub(this.origin);
  }

  /** In the box behind the start line, slow. */
  private inBox(p: THREE.Vector3, speed: number): boolean {
    const g = this.line.gates[0]!;
    const l = this.local(p, tmp);
    const side = tmp2.copy(l).sub(g.pos).dot(g.normal);
    const centre = tmp2.copy(g.pos).addScaledVector(g.normal, -RACING.start.line.back - 50);
    return side < 0 && l.distanceTo(centre) <= RACING.start.box && speed < RACING.start.maxSpeed;
  }

  /**
   * One frame: the pilot moved from `p0` to `p1` (scene positions) at `speed`; `clock` is the game
   * clock. Returns what happened, for the flight to tell.
   */
  update(dt: number, p0: THREE.Vector3, p1: THREE.Vector3, speed: number, clock: number, camera: THREE.Camera, time: number): RaceEvent[] {
    const out: RaceEvent[] = [];
    const g0 = this.line.gates[0]!;
    const a = this.local(p0, new THREE.Vector3());
    const b = this.local(p1, new THREE.Vector3());
    if (this.phase === 'approach' || this.phase === 'wait' || this.phase === 'ready') {
      if (clock >= this.setup.closes) {
        this.phase = 'done';
        out.push({ kind: 'lapsed' });
        this.clear();
        return out;
      }
      this.phase = !this.inBox(p1, speed) ? 'approach' : clock < this.setup.opens ? 'wait' : 'ready';
    } else if (this.phase === 'countdown') {
      const crossed = a.clone().sub(g0.pos).dot(g0.normal) < 0 && b.clone().sub(g0.pos).dot(g0.normal) >= 0;
      if (crossed) {
        this.phase = 'approach';
        out.push({ kind: 'false-start' });
      } else {
        const before = Math.ceil(this.countdown);
        this.countdown -= dt;
        if (this.countdown <= 0) {
          this.phase = 'on';
          this.clock = -this.countdown;
          this.acc = -this.countdown;
          out.push({ kind: 'go' });
          this.stepRacers();
        } else if (Math.ceil(this.countdown) < before) out.push({ kind: 'count', n: Math.ceil(this.countdown) });
      }
    } else if (this.phase === 'on') {
      const at = this.clock;
      this.clock += dt;
      this.acc += dt;
      this.stepRacers();
      // The pilot's gates, in order.
      const g = this.line.gates[this.gate]!;
      const f = crossesGate(a, b, g);
      if (f !== null) {
        const t = at + f * dt;
        this.splits.push(t);
        if (this.gate === this.line.gates.length - 1) {
          this.finish = Math.round(t * 1000) / 1000;
          this.phase = 'done';
          out.push({ kind: 'finish', raw: this.finish, field: this.field() });
        } else {
          this.gates[this.gate]!.setLook('passed');
          this.gate++;
          this.gates[this.gate]!.setLook('next');
          this.gates[this.gate + 1]?.setLook('after');
          if (this.gate > 1) out.push({ kind: 'gate', n: this.gate - 1 });
        }
      } else if (missedGate(a, b, g) && time - this.missedAt > 3) {
        this.missedAt = time;
        out.push({ kind: 'missed', n: this.gate });
      }
      this.stillFor = speed < RACING.retire.speed ? this.stillFor + dt : 0;
      if (this.phase === 'on' && this.clock > this.setup.cutoff) {
        this.phase = 'done';
        out.push({ kind: 'cut', field: this.field() });
      }
    } else if (this.phase === 'done') {
      this.acc += dt;
      this.stepRacers();
    }
    this.syncArt(camera, time, dt);
    return out;
  }

  /** The racers' fixed steps due: never more than the frame has given them. */
  private stepRacers(): void {
    while (this.acc >= PILOT_STEP) {
      this.acc -= PILOT_STEP;
      for (const r of this.racers) {
        if (r.gone) continue;
        stepRacer(r.body, this.line, r.racer.skill, r.st, r.controls, this.obstructions);
        if (r.st.finish !== null) r.past += PILOT_STEP;
        if (r.st.out || r.past > RACING.ease.after) this.removeRacer(r);
      }
    }
  }

  private removeRacer(r: RacerHere): void {
    if (r.gone) return;
    r.gone = true;
    r.target.alive = false;
    this.scene.remove(r.art.object);
  }

  private syncArt(camera?: THREE.Camera, time = 0, dt = 0): void {
    for (const r of this.racers) {
      if (r.gone) continue;
      r.art.object.position.copy(r.body.position).add(this.origin);
      const bank = THREE.MathUtils.clamp(-r.body.angularVelocity.y * 0.5, -0.7, 0.7);
      bankQ.setFromAxisAngle(Z_AXIS, bank);
      r.art.object.quaternion.copy(r.body.quaternion).multiply(bankQ);
      r.art.setThrottle(Math.max(0.1, r.controls.throttle));
      r.art.setBoost(r.body.boosting);
      r.art.setCruise(r.body.cruise === 'on');
      if (camera) r.art.update?.(dt, time, camera);
      r.target.position.copy(r.art.object.position);
      r.target.velocity!.copy(r.body.velocity);
    }
    if (camera) for (const g of this.gates) g.update?.(dt, time, camera);
  }

  /**
   * Every racer's final time: those finished, and the rest flown on ahead of time from exactly where
   * they are (the same steps they will fly, so the same times).
   */
  field(): Standing[] {
    const maxTicks = Math.ceil(this.setup.cutoff / PILOT_STEP);
    return this.racers.map((r) => {
      let time = r.st.finish;
      if (time === null && !r.st.out && !r.gone) time = flyOn(cloneBody(r.body), this.line, r.racer.skill, clonePilotState(r.st), maxTicks, this.obstructions).finish;
      return { id: r.racer.id, name: r.racer.name, model: r.racer.model, ...(r.racer.rival ? { rival: r.racer.rival } : {}), time: time === null ? null : Math.round(time * 1000) / 1000 };
    });
  }

  /** How far along the course: gates passed, and the way to the next. */
  private progress(gate: number, p: THREE.Vector3): number {
    const gates = this.line.gates;
    if (gate >= gates.length) return gates.length;
    const g = gates[gate]!;
    const leg = gate > 0 ? g.pos.distanceTo(gates[gate - 1]!.pos) : 400;
    return gate + 1 - Math.min(1, p.distanceTo(g.pos) / leg);
  }

  /** The pilot's place on the road now. */
  private place(pilot: THREE.Vector3): number {
    const mine = this.finish !== null ? Infinity : this.progress(this.gate, this.local(pilot, tmp));
    const ahead = this.racers.filter((r) =>
      r.st.finish !== null ? this.finish === null || r.st.finish < this.finish : !r.gone && this.progress(r.st.gate, r.body.position) > mine,
    ).length;
    return ahead + 1;
  }

  /** The gates and racers to mark: the next gate and the one after; on a narrow screen only the racers just ahead and behind. */
  targets(narrow: boolean, pilot: THREE.Vector3): Target[] {
    const out: Target[] = [];
    if (this.phase === 'approach' || this.phase === 'wait' || this.phase === 'ready') out.push(this.boxTarget);
    if (this.phase !== 'done') for (const i of [this.gate, this.gate + 1]) if (this.gateTargets[i]) out.push(this.gateTargets[i]!);
    const live = this.racers.filter((r) => !r.gone);
    if (!narrow || this.phase !== 'on') return [...out, ...live.map((r) => r.target)];
    const mine = this.progress(this.gate, this.local(pilot, tmp));
    const prog = (r: RacerHere) => (r.st.finish !== null ? Infinity : this.progress(r.st.gate, r.body.position));
    const ahead = live.filter((r) => prog(r) > mine).sort((x, y) => prog(x) - prog(y))[0];
    const behind = live.filter((r) => prog(r) <= mine).sort((x, y) => prog(y) - prog(x))[0];
    return [...out, ...[ahead, behind].filter((r): r is RacerHere => !!r).map((r) => r.target)];
  }

  /** Every racer's target (for selection by id). */
  allTargets(): Target[] {
    return [this.boxTarget, ...this.gateTargets, ...this.racers.filter((r) => !r.gone).map((r) => r.target)];
  }

  /** What the flight's objective marks: the start box before the start, then the next gate. */
  objectiveId(): string | null {
    if (this.phase === 'approach' || this.phase === 'wait' || this.phase === 'ready') return this.boxTarget.id;
    if (this.phase === 'countdown' || this.phase === 'on') return `race-gate:${this.gate}`;
    return null;
  }

  /** The objective line. */
  objective(): string {
    const O = RACE_LINES.objective;
    const n = this.line.gates.length - 1;
    const text =
      this.phase === 'approach'
        ? O.approach
        : this.phase === 'wait'
          ? O.wait
          : this.phase === 'ready'
            ? O.ready
            : this.gate >= n
              ? O.finish
              : O.on.replace('{n}', String(Math.max(1, this.gate))).replace('{of}', String(n));
    return text.replace('{course}', this.setup.name);
  }

  /** The HUD's race strip. */
  hud(pilot: THREE.Vector3): HudRace {
    const n = this.line.gates.length - 1;
    const last = this.splits.length - 1;
    let split: number | null = null;
    if (last >= 1 && this.setup.par) {
      const ref = this.setup.par.splits[last];
      const scale = this.setup.best ? this.setup.best / this.setup.par.finish : 1;
      if (ref !== undefined) split = Math.round((this.splits[last]! - ref * scale) * 100) / 100;
    }
    return {
      name: this.setup.name,
      phase: this.phase,
      gate: Math.max(0, this.splits.length - 1),
      gates: n,
      time: this.phase === 'on' || this.phase === 'done' ? (this.finish ?? this.clock) : 0,
      split,
      count: this.phase === 'countdown' ? RACE_LINES.countdown[Math.max(0, RACING.start.countdown - Math.ceil(this.countdown))] ?? null : null,
      place: this.place(pilot),
      of: this.racers.length + 1,
      sealedCruise: this.sealedCruise,
    };
  }

  /** Test-only: the pilot's clock set on to `at` seconds (the pilot then flies the gate themselves). */
  setClock(at: number): void {
    if (this.phase === 'on') this.clock = at;
  }

  /** Test-only: a gate's place in the scene and its way through. */
  gateAt(i: number): { position: THREE.Vector3; normal: THREE.Vector3 } | null {
    const g = this.line.gates[i];
    return g ? { position: g.pos.clone().add(this.origin), normal: g.normal.clone() } : null;
  }

  /** Test-only: where things stand. */
  status(): { phase: RacePhase; gate: number; clock: number; finish: number | null; racers: { id: string; gate: number; tick: number; finish: number | null; gone: boolean }[] } {
    return {
      phase: this.phase,
      gate: this.gate,
      clock: this.clock,
      finish: this.finish,
      racers: this.racers.map((r) => ({ id: r.racer.id, gate: r.st.gate, tick: r.st.tick, finish: r.st.finish, gone: r.gone })),
    };
  }

  /** The race leaves the scene (a lapse, a retire, the flight's end). */
  clear(): void {
    for (const r of this.racers) this.removeRacer(r);
    for (const g of this.gates) this.scene.remove(g.object);
    for (const t of this.gateTargets) t.alive = false;
    this.boxTarget.alive = false;
  }

  dispose(): void {
    this.clear();
    for (const r of this.racers) r.art.dispose();
    for (const g of this.gates) g.dispose();
  }
}
