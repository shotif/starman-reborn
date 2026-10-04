import { applyCredits, type BattleRecord, type BorderLog, type GameState } from '../app/state.ts';
import { BATTLE_NEWS, BATTLE_NOTES, BATTLE_TITLES } from '../content/border/battleLines.ts';
import { BATTLES, type BattleKind, type BattleSide } from '../content/border/battles.ts';
import { BORDER } from '../content/border/rules.ts';
import { rng } from '../content/random.ts';
import { jumpsFrom } from '../content/world/network.ts';
import { WORLD_SEED } from '../content/world/rules.ts';
import { ALL_LOCATIONS, getLocation, getSystem, WORLD } from '../data/systems.ts';
import type { SystemId } from '../data/types.ts';
import { FRONTS, frontsAt, frontState, getFront, pushFront, type Front, type FrontState } from './border.ts';
import { activeBorderLog } from './events.ts';
import { adjustReputation, FACTIONS } from './factions.ts';

/**
 * The border in sight (docs/PROCGEN.md §35): which battles a front's systems hold and when (clashes
 * by slot, turning battles in the pressure's window before the station falls or is freed), and what
 * a battle seen to its end does: the deed, the purse and standing, the record, the News. A function
 * of the seed, the clock and the save's border log; the flight fights them (src/world/BorderBattle.ts).
 */

type Log = Record<string, BorderLog> | null;

/** A battle due in a system, as the flight stages it. */
export interface BattlePlan {
  /** `<kind>:<front>:<key>`. */
  id: string;
  kind: BattleKind;
  frontId: string;
  systemId: SystemId;
  /** The clash's slot, or the turning battle's tide cycle. */
  key: number;
  /** The clock it opens at, and after which it is no longer due. */
  opens: number;
  until: number;
  /** A clash's line runs from the jump beacon toward this station; a turning battle is fought off it. */
  toward: string;
  /** Whose system it is fought in: the lawful side's or the den's. */
  lawSystem: boolean;
  /** Who attacks a turning battle (null: a clash, both sides come to the line). */
  attacker: BattleSide | null;
  /** Ships on each side (a turning battle's attackers: a wave). */
  law: number;
  wake: number;
  waves: number;
  level: 1 | 2 | 3;
  /** How long it may last before it ends undecided. */
  lasts: number;
  title: string;
}

const fill = (t: string, v: Record<string, string>) => t.replace(/\{(\w+)\}/g, (_, k: string) => v[k] ?? `{${k}}`);

/** The tide cycle a moment falls in (the tide repeats once a cycle). */
export function cycleOf(front: Front, clock: number): number {
  return Math.floor(clock / BORDER.tide.periodSeconds + front.phase0);
}

/** How fast the pressure is moving now (per second): the tide's swing, and the player's deeds fading. */
export function pressureTrend(s: FrontState, clock: number): number {
  const P = BORDER.tide.periodSeconds;
  const tide = ((BORDER.tide.amplitude * 2 * Math.PI) / P) * Math.cos(2 * Math.PI * (clock / P + s.front.phase0));
  return tide - s.deeds / BORDER.fadeSeconds;
}

/** What a clash's line runs toward in a system of a front: the exposed station (else the faction's first with repairs), or the den. */
export function lineToward(front: Front, systemId: SystemId): string {
  if (systemId === front.wakeSystem) return front.denId;
  if (front.exposedId) return front.exposedId;
  const own = ALL_LOCATIONS.filter((l) => l.systemId === systemId && l.status === 'functional' && l.dockable !== false && l.services.includes('repair')).sort((a, b) => (a.id < b.id ? -1 : 1));
  return (own.find((l) => l.factionId === front.faction) ?? own[0])!.id;
}

function titleOf(kind: BattleKind, front: Front, systemId: SystemId): string {
  return fill(BATTLE_TITLES[kind], { system: getSystem(systemId).displayName, station: front.exposedId ? getLocation(front.exposedId).name : '' });
}

/** Whether a battle has been seen to its end already. */
export function battleSeen(log: Log, frontId: string, kind: BattleKind, key: number): boolean {
  return !!log?.[frontId]?.battles?.some((b) => b.kind === kind && b.key === key);
}

/** The clash a system holds in a slot, if any (at most one; a front settled or at a truce holds none). */
export function clashAt(systemId: SystemId, slot: number, low = false, log: Log = activeBorderLog()): BattlePlan | null {
  const C = BATTLES.clash;
  const fronts = frontsAt(systemId);
  if (!fronts.length) return null;
  const opens = slot * C.slotSeconds + C.opens;
  // Two fronts through a system take turns at first claim on a slot.
  for (let i = 0; i < fronts.length; i++) {
    const f = fronts[(slot + i) % fronts.length]!;
    const s = frontState(f, opens, log);
    if (s.ending) continue;
    const law = f.lawSystem === systemId;
    const chance =
      s.phase === 'skirmish' ? C.chance.skirmish : law && s.phase === 'blockade' ? C.chance.blockade : law && s.phase === 'fallen' ? C.chance.fallen : !law && s.phase === 'pushed-back' ? C.chance.pushedBack : 0;
    if (!chance || rng(WORLD_SEED, 'clash', f.id, systemId, slot).next() >= chance) continue;
    const base = low ? C.low : C.ships;
    return {
      id: `clash:${f.id}:${slot}`,
      kind: 'clash',
      frontId: f.id,
      systemId,
      key: slot,
      opens,
      until: (slot + 1) * C.slotSeconds,
      toward: lineToward(f, systemId),
      lawSystem: law,
      attacker: null,
      law: base + (s.tide >= C.favour ? 1 : 0),
      wake: base + (s.tide <= -C.favour ? 1 : 0),
      waves: 1,
      level: C.level[f.faction],
      lasts: C.lasts,
      title: titleOf('clash', f, systemId),
    };
  }
  return null;
}

/** The turning battle due on a front at a moment, if any: the Wake's assault as its station is about to fall, the law's retaking as it is about to be freed. */
export function turningAt(front: Front, clock: number, log: Log = activeBorderLog()): { kind: 'assault' | 'retake'; key: number } | null {
  if (!front.exposedId) return null;
  const s = frontState(front, clock, log);
  if (s.ending) return null;
  const fall = BORDER.phases.fallen;
  const trend = pressureTrend(s, clock);
  const brink = BATTLES.turning.brink;
  if (s.phase !== 'fallen' && s.pressure > fall && s.pressure <= fall + brink && trend < 0) return { kind: 'assault', key: cycleOf(front, clock) };
  if (s.phase === 'fallen' && s.pressure >= fall - brink && trend > 0) return { kind: 'retake', key: cycleOf(front, clock) };
  return null;
}

/** The step a turning battle's window is searched in. */
const STEP = 60;

function turningPlan(front: Front, kind: 'assault' | 'retake', key: number, opens: number, log: Log, low: boolean): BattlePlan {
  // Due until the window closes (searched ahead, at most three hours).
  let until = opens;
  while (until < opens + 3 * 3_600) {
    const t = turningAt(front, until + STEP, log);
    if (!t || t.kind !== kind) break;
    until += STEP;
  }
  const T = BATTLES.turning;
  const attacker: BattleSide = kind === 'assault' ? 'wake' : 'law';
  const wave = low ? T.waveLow : T.wave;
  const hold = low ? T.defendersLow : T.defenders;
  return {
    id: `${kind}:${front.id}:${key}`,
    kind,
    frontId: front.id,
    systemId: front.lawSystem,
    key,
    opens,
    until: until + STEP,
    toward: front.exposedId!,
    lawSystem: true,
    attacker,
    law: attacker === 'law' ? wave : hold,
    wake: attacker === 'wake' ? wave : hold,
    waves: T.waves,
    level: T.level[front.faction],
    lasts: T.lasts,
    title: titleOf(kind, front, front.lawSystem),
  };
}

/**
 * The battles due in a system from `from` for `horizon` seconds, soonest first, leaving out those the
 * pilot has seen to their end: a turning battle in its window, and the clashes of each slot.
 */
export function battlesDue(systemId: SystemId, from: number, horizon = 3_600, low = false, log: Log = activeBorderLog()): BattlePlan[] {
  const out: BattlePlan[] = [];
  for (const f of frontsAt(systemId)) {
    if (f.lawSystem !== systemId) continue;
    for (let t = from; t <= from + horizon; t += STEP) {
      const due = turningAt(f, t, log);
      if (due && !battleSeen(log, f.id, due.kind, due.key)) {
        out.push(turningPlan(f, due.kind, due.key, t, log, low));
        break;
      }
    }
  }
  const S = BATTLES.clash.slotSeconds;
  for (let slot = Math.floor(from / S); slot * S <= from + horizon; slot++) {
    const c = clashAt(systemId, slot, low, log);
    if (c && c.until > from && !battleSeen(log, c.frontId, 'clash', slot)) out.push(c);
  }
  return out.sort((a, b) => a.opens - b.opens || (a.id < b.id ? -1 : 1));
}

// ---------------------------------------------------------------- the outcome

/** How a battle ended, as the flight saw it. */
export interface BattleResult {
  plan: BattlePlan;
  winner: BattleSide | 'draw';
  /** The pilot's side, and whether they (or their wing) downed a ship of the other side. */
  side: BattleSide;
  part: boolean;
}

export interface BattleNote {
  text: string;
  tone: 'good' | 'bad' | 'info';
}

/** Who pays the pilot's side. */
export function payerOf(front: Front, side: BattleSide): string {
  return side === 'law' ? FACTIONS[front.faction].shortName : FACTIONS['hollow-wake'].shortName;
}

/**
 * A battle seen to its end (docs/PROCGEN.md §35.4): recorded once; won with the pilot's part, a deed
 * its way on the front, the side's purse and standing. Settling the same battle twice changes nothing.
 */
export function settleBattle(state: GameState, r: BattleResult): BattleNote[] {
  const front = getFront(r.plan.frontId);
  const { kind, key } = r.plan;
  if (!front || battleSeen(state.world.border, front.id, kind, key)) return [];
  const log = state.world.border;
  const before = frontState(front, state.clock, log);
  const entry = (log[front.id] ??= { deeds: [] });
  const record: BattleRecord = { kind, key, at: state.clock, winner: r.winner, side: r.side, part: r.part, ...(r.plan.lawSystem ? {} : { den: true as const }) };
  entry.battles = [...(entry.battles ?? []), record].slice(-BATTLES.keep);
  if (r.winner === 'draw') return [{ text: BATTLE_NOTES.drawn, tone: 'info' }];
  if (r.winner !== r.side) return [{ text: BATTLE_NOTES.lost, tone: 'bad' }];
  if (!r.part) return [{ text: BATTLE_NOTES.noPart, tone: 'info' }];
  const turning = kind !== 'clash';
  const weight = turning ? BATTLES.deed.turning : BATTLES.deed.clash;
  pushFront(state, front.id, r.side === 'law' ? weight : -weight);
  const purse = turning ? BATTLES.purse.turning : BATTLES.purse.clash;
  const payer = payerOf(front, r.side);
  applyCredits(state, purse, 'reward', `Border battle: ${r.plan.title}`);
  adjustReputation(state.reputation, r.side === 'law' ? front.faction : 'hollow-wake', turning ? BATTLES.standing.turning : BATTLES.standing.clash);
  const notes: BattleNote[] = [
    { text: fill(BATTLE_NOTES.won, { payer: `the ${payer}`, purse: `${purse} cr` }), tone: 'good' },
    { text: BATTLE_NOTES.moved, tone: 'info' },
  ];
  if (front.exposedId) {
    const after = frontState(front, state.clock, log);
    const station = getLocation(front.exposedId).name;
    if (before.phase !== 'fallen' && after.phase === 'fallen') notes.push({ text: fill(BATTLE_NOTES.fallen, { station }), tone: r.side === 'wake' ? 'good' : 'bad' });
    else if (before.phase === 'fallen' && after.phase !== 'fallen') notes.push({ text: fill(BATTLE_NOTES.freed, { station }), tone: 'good' });
    else if (kind === 'assault' && r.side === 'law') notes.push({ text: fill(BATTLE_NOTES.held, { station }), tone: 'good' });
  }
  return notes;
}

/** The News of turning battles the pilot fought in and won, on fronts within reach, for a while after. */
export function battleNews(systemId: SystemId, clock: number, log: Log = activeBorderLog()): { headline: string; detail: string; at: number }[] {
  const jumps = jumpsFrom(WORLD.links, systemId);
  const out: { headline: string; detail: string; at: number }[] = [];
  for (const f of FRONTS) {
    const j = Math.min(jumps.get(f.lawSystem) ?? 99, jumps.get(f.wakeSystem) ?? 99);
    if (j > BORDER.newsJumps || !f.exposedId) continue;
    const station = getLocation(f.exposedId).name;
    for (const b of log?.[f.id]?.battles ?? []) {
      if (b.kind === 'clash' || !b.part || b.winner !== b.side || b.at > clock || clock - b.at > BATTLES.newsSeconds) continue;
      const words = BATTLE_NEWS[b.kind][b.side];
      out.push({ headline: fill(words.headline, { station }), detail: fill(words.detail, { station }), at: b.at });
    }
  }
  return out.sort((a, b) => b.at - a.at);
}

/** The battles the pilot has seen to an end, newest first, for the journal. */
export function battlesSeen(state: GameState): { title: string; record: BattleRecord }[] {
  const out: { title: string; record: BattleRecord }[] = [];
  for (const f of FRONTS) {
    for (const b of state.world.border[f.id]?.battles ?? []) out.push({ title: titleOf(b.kind, f, b.den ? f.wakeSystem : f.lawSystem), record: b });
  }
  return out.sort((a, b) => b.record.at - a.record.at);
}
