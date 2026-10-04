import * as THREE from 'three';
import { BATTLE_END, BATTLE_OPEN, BATTLE_VOICES } from '../content/border/battleLines.ts';
import { BATTLES, type BattleSide } from '../content/border/battles.ts';
import { getLocation } from '../data/systems.ts';
import { getFront } from '../economy/border.ts';
import { payerOf, type BattlePlan, type BattleResult } from '../economy/battles.ts';
import type { BattleSite } from './battleSite.ts';
import type { NpcShip } from './FlightSession.ts';
import type { Target } from './targets.ts';

/**
 * A border battle in flight (docs/PROCGEN.md §35): which battle of those due is staged and when, its
 * waves, when a side is beaten (or time runs out), whose side the pilot is on and whether they took
 * part, the radio as it opens and ends, the battle strip and the battle line's marker. The flight
 * spawns and flies the ships; this draws no random numbers.
 */

/** A ship's place in a battle. */
export interface BattleMark {
  id: string;
  side: BattleSide;
  /** Fired on by the pilot: it treats the pilot as an enemy for the rest of the battle. */
  turned?: true;
  /** The battle is over: the winners hold, the beaten run. */
  over?: 'hold' | 'run';
  /** Where a defender holds, or where it forms up. */
  post: THREE.Vector3;
}

/** What the battle needs of the flight each frame. */
export interface BattleView {
  clock: number;
  time: number;
  /** The pilot can be drawn into a battle now (alive, not docking or in a lane, no race or duel staged). */
  ready: boolean;
  npcs: readonly NpcShip[];
}

/** What the battle asks of the flight. */
export interface BattleHooks {
  /** Where the battle is fought in this scene (null: nowhere it can be). */
  site(plan: BattlePlan): BattleSite | null;
  /** The pilot's side, by standing (fixed for the battle). */
  sideOf(plan: BattlePlan): BattleSide;
  /** Brings in ships of a side at a point. */
  spawn(plan: BattlePlan, side: BattleSide, count: number, from: THREE.Vector3, post: THREE.Vector3): void;
  comm(speaker: string, text: string): void;
}

export type BattleEvent = { kind: 'opened'; plan: BattlePlan } | { kind: 'ended'; result: BattleResult };

interface Active {
  plan: BattlePlan;
  site: BattleSite;
  side: BattleSide;
  since: number;
  wave: number;
  part: boolean;
  downed: { law: number; wake: number };
}

/** A clash does not open this close (seconds) before a turning battle is due. */
const TURNING_FIRST = 120;

const fill = (t: string, v: Record<string, string>) => t.replace(/\{(\w+)\}/g, (_, k: string) => v[k] ?? `{${k}}`);

export class BorderBattle {
  private readonly plans: readonly BattlePlan[];
  /** The clock when the pilot arrived (or launched): a battle opens no sooner than a moment after. */
  private readonly arrived: number;
  private readonly done = new Set<string>();
  private active: Active | null = null;
  private readonly lineTarget: Target;

  constructor(plans: readonly BattlePlan[], arrived: number) {
    this.plans = plans;
    this.arrived = arrived;
    this.lineTarget = {
      id: 'battle-line',
      name: 'Battle line',
      kind: 'battle',
      position: new THREE.Vector3(),
      radius: 300,
      subtitle: 'Border battle · fiction',
      dataClass: 'fictional',
      alive: false,
      cycle: true,
    };
  }

  /** The battle under way, if any. */
  get plan(): BattlePlan | null {
    return this.active?.plan ?? null;
  }

  /** The pilot's side in the battle under way. */
  get side(): BattleSide | null {
    return this.active?.side ?? null;
  }

  /** Whether a battle ship treats the pilot as an enemy: the other side's, or one the pilot fired on. */
  enemyOfPilot(n: NpcShip): boolean {
    const b = n.battle;
    if (!b) return false;
    const side = b.id === this.active?.plan.id ? this.active.side : null;
    return !!b.turned || (side !== null && b.side !== side);
  }

  /** Once a frame: open a battle that is due, bring in its next wave, and end it when a side is beaten or time is up. */
  update(view: BattleView, hooks: BattleHooks): BattleEvent[] {
    const a = this.active;
    if (!a) return this.open(view, hooks);
    const alive = (side: BattleSide) => view.npcs.filter((n) => n.battle?.id === a.plan.id && n.battle.side === side && n.durability.hull > 0 && !n.battle.over && n.brain.state !== 'flee' && n.brain.state !== 'escaped').length;
    const law = alive('law');
    const wake = alive('wake');
    // The attackers' next wave, when the last is down to a ship or so.
    const attacker = a.plan.attacker;
    if (attacker && a.wave < a.plan.waves && (attacker === 'law' ? law : wake) <= BATTLES.turning.next) {
      a.wave++;
      hooks.spawn(a.plan, attacker, attacker === 'law' ? a.plan.law : a.plan.wake, attacker === 'law' ? a.site.lawFrom : a.site.wakeFrom, a.site.at);
      return [];
    }
    const lawGone = law === 0 && !(attacker === 'law' && a.wave < a.plan.waves);
    const wakeGone = wake === 0 && !(attacker === 'wake' && a.wave < a.plan.waves);
    let winner: BattleSide | 'draw' | null = null;
    if (lawGone && wakeGone) winner = 'draw';
    else if (lawGone) winner = 'wake';
    else if (wakeGone) winner = 'law';
    else if (view.time - a.since > a.plan.lasts) winner = attacker ? (attacker === 'law' ? 'wake' : 'law') : 'draw';
    if (!winner) return [];
    return [this.end(a, winner, view, hooks)];
  }

  private open(view: BattleView, hooks: BattleHooks): BattleEvent[] {
    if (!view.ready) return [];
    const C = BATTLES.clash;
    const open = (p: BattlePlan) => !this.done.has(p.id) && view.clock < p.until;
    // A turning battle comes first: no clash opens while one is due, or about to be.
    const turning = this.plans.find((p) => p.kind !== 'clash' && open(p) && view.clock >= p.opens - TURNING_FIRST);
    const plan = turning
      ? view.clock >= Math.max(turning.opens, this.arrived + C.arrive)
        ? turning
        : undefined
      : this.plans.find((p) => open(p) && view.clock >= Math.max(p.opens, this.arrived + C.arrive));
    if (!plan) return [];
    this.done.add(plan.id);
    const site = hooks.site(plan);
    if (!site) return [];
    const side = hooks.sideOf(plan);
    this.active = { plan, site, side, since: view.time, wave: 1, part: false, downed: { law: 0, wake: 0 } };
    hooks.spawn(plan, 'law', plan.law, site.lawFrom, site.at);
    hooks.spawn(plan, 'wake', plan.wake, site.wakeFrom, site.at);
    this.lineTarget.position.copy(site.at);
    this.lineTarget.alive = true;
    this.lineTarget.name = plan.kind === 'clash' ? 'Battle line' : 'Battle';
    hooks.comm(this.voice(plan, side), fill(BATTLE_OPEN[plan.kind][side], this.words(plan)));
    return [{ kind: 'opened', plan }];
  }

  private end(a: Active, winner: BattleSide | 'draw', view: BattleView, hooks: BattleHooks): BattleEvent {
    for (const n of view.npcs) {
      if (n.battle?.id !== a.plan.id || n.durability.hull <= 0) continue;
      n.battle.over = winner === 'draw' || n.battle.side !== winner ? 'run' : 'hold';
    }
    this.active = null;
    this.lineTarget.alive = false;
    hooks.comm(this.voice(a.plan, winner === 'draw' ? a.side : winner), fill(BATTLE_END[a.plan.kind][winner], this.words(a.plan)));
    return { kind: 'ended', result: { plan: a.plan, winner, side: a.side, part: a.part } };
  }

  /** A battle ship went down: one of the other side's, downed by the pilot or their wing, is the pilot's part in it. */
  downed(n: NpcShip, byPilot: boolean): void {
    const a = this.active;
    if (!a || n.battle?.id !== a.plan.id) return;
    a.downed[n.battle.side]++;
    if (byPilot && n.battle.side !== a.side) a.part = true;
  }

  private voice(plan: BattlePlan, side: BattleSide): string {
    const front = getFront(plan.frontId);
    return fill(BATTLE_VOICES[side], { payer: front ? payerOf(front, 'law') : '' });
  }

  private words(plan: BattlePlan): Record<string, string> {
    return { station: getLocation(plan.toward).name };
  }

  /** The battle strip: its title, the ships still flying on each side, and the pilot's side. */
  hud(npcs: readonly NpcShip[]): { title: string; law: number; wake: number; side: BattleSide; lawName: string } | null {
    const a = this.active;
    if (!a) return null;
    const count = (side: BattleSide) => npcs.filter((n) => n.battle?.id === a.plan.id && n.battle.side === side && n.durability.hull > 0 && n.brain.state !== 'flee' && n.brain.state !== 'escaped').length;
    const front = getFront(a.plan.frontId);
    return { title: a.plan.title, law: count('law'), wake: count('wake'), side: a.side, lawName: front ? payerOf(front, 'law') : 'Law' };
  }

  /** The battle line's marker while a battle is under way. */
  targets(): Target[] {
    return this.lineTarget.alive ? [this.lineTarget] : [];
  }

  /** Test hook: the battles due, the one under way and the pilot's part. */
  status(): { due: string[]; active: string | null; side: BattleSide | null; part: boolean; wave: number; downed: { law: number; wake: number } | null; done: string[] } {
    const a = this.active;
    return { due: this.plans.map((p) => p.id), active: a?.plan.id ?? null, side: a?.side ?? null, part: a?.part ?? false, wave: a?.wave ?? 0, downed: a ? { ...a.downed } : null, done: [...this.done] };
  }
}
