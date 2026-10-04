import * as THREE from 'three';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { AudioEngine } from '../../src/audio/AudioEngine.ts';
import { defaultSettings } from '../../src/app/settings.ts';
import { assertValidState } from '../../src/app/save/migrate.ts';
import { createNewGame, type BattleRecord, type GameState } from '../../src/app/state.ts';
import { BATTLE_FICTION, BATTLE_OPEN } from '../../src/content/border/battleLines.ts';
import { BATTLES } from '../../src/content/border/battles.ts';
import { BORDER } from '../../src/content/border/rules.ts';
import { LAW } from '../../src/content/law/rules.ts';
import type { SystemId } from '../../src/data/types.ts';
import { SYSTEMS, WORLD } from '../../src/data/systems.ts';
import { jumpsFrom } from '../../src/content/world/network.ts';
import { battleNews, battlesDue, battlesSeen, clashAt, cycleOf, settleBattle, turningAt, type BattlePlan, type BattleResult } from '../../src/economy/battles.ts';
import { validateBattles } from '../../src/economy/battleGuards.ts';
import { FRONTS, frontState, getFront } from '../../src/economy/border.ts';
import { useWorldLog } from '../../src/economy/events.ts';
import { emptyInput } from '../../src/flight/input/types.ts';
import type { BattleEvent } from '../../src/world/BorderBattle.ts';
import { FlightSession, type NpcShip, type TrafficSetup } from '../../src/world/FlightSession.ts';
import { SystemScene } from '../../src/world/SystemScene.ts';
import { sceneDefFor } from '../../src/world/systems/index.ts';

/**
 * The border in sight (docs/PROCGEN.md §35): clashes off the beacon while a front fights, turning
 * battles as its station is about to fall or be retaken, what a battle won with the pilot's part
 * does, and the battles flown in a real flight.
 */

afterEach(() => useWorldLog(null));

const H = 3_600;
const ROSS = getFront('wolf-1061~ross-154')!;
const LACAILLE = FRONTS.filter((f) => f.lawSystem === 'lacaille-9352');

function pilot(clock = 0): GameState {
  const s = createNewGame(29);
  s.jobs.lifeline = { status: 'complete', objectiveIndex: 4, acceptedAt: 0, completedAt: 1 };
  s.flags.clearance = true;
  s.credits = 10_000;
  s.clock = clock;
  useWorldLog(s.world);
  return s;
}

/** The first clock from `from` at which a turning battle of a kind is due on a front. */
function windowOf(front: typeof ROSS, kind: 'assault' | 'retake', from = 0): number {
  for (let t = from; t < from + 96 * H; t += 60) if (turningAt(front, t, null)?.kind === kind) return t + 120;
  throw new Error(`no ${kind} on ${front.id}`);
}

function planAt(systemId: SystemId, clock: number, kind: BattlePlan['kind'], log: GameState['world']['border'] | null = null): BattlePlan {
  const plan = battlesDue(systemId, clock, 2 * H, false, log).find((p) => p.kind === kind);
  if (!plan) throw new Error(`no ${kind} due in ${systemId}`);
  return plan;
}

describe('border battles: the rules', () => {
  it('pass their guardrails', { timeout: 120_000 }, () => {
    expect(validateBattles()).toEqual([]);
  });

  it('catch broken rules and words', { timeout: 120_000 }, () => {
    const subjects = (patch: object) => validateBattles({ ...BATTLES, ...patch } as unknown as typeof BATTLES).map((i) => i.subject);
    expect(subjects({ clash: { ...BATTLES.clash, ships: 5 } })).toContain('ships');
    expect(subjects({ clash: { ...BATTLES.clash, low: 3 } })).toContain('low');
    expect(subjects({ purse: { ...BATTLES.purse, turning: 1_500 } })).toContain('purse');
    expect(subjects({ deed: { turning: 30, clash: 6 } })).toContain('deed');
    expect(subjects({ turning: { ...BATTLES.turning, brink: 2 } })).toEqual(expect.arrayContaining(['turning', 'window']));
    expect(subjects({ line: { ...BATTLES.line, denClear: 2_000 } })).toContain('line');
    expect(subjects({ aim: 0.9 })).toContain('aim');
    expect(subjects({ clash: { ...BATTLES.clash, chance: { ...BATTLES.clash.chance, skirmish: 1 } } })).toContain('chance');
    const open = BATTLE_OPEN.clash as Record<string, string>;
    const was = open.law!;
    open.law = 'She sends 3 wings.';
    try {
      const words = validateBattles().filter((i) => i.rule === 'lines').map((i) => i.message);
      expect(words.some((m) => m.includes('number'))).toBe(true);
      expect(words.some((m) => m.includes('he or she'))).toBe(true);
    } finally {
      open.law = was;
    }
  });
});

describe('the battle schedule', () => {
  it('holds clashes by slot where a front fights, the same every time, at most one a system', () => {
    let seen = 0;
    for (let slot = 0; slot < 288; slot++) {
      const c = clashAt('ross-154', slot, false, null);
      expect(c).toEqual(clashAt('ross-154', slot, false, null));
      if (!c) continue;
      seen++;
      const s = frontState(ROSS, c.opens, null);
      expect(['skirmish', 'blockade', 'fallen']).toContain(s.phase);
      expect(c.opens).toBe(slot * BATTLES.clash.slotSeconds + BATTLES.clash.opens);
      expect(c.toward).toBe('regent-concourse');
      expect(c.law).toBe(BATTLES.clash.ships + (s.tide >= BATTLES.clash.favour ? 1 : 0));
      expect(c.wake).toBe(BATTLES.clash.ships + (s.tide <= -BATTLES.clash.favour ? 1 : 0));
      expect(c.level).toBe(BATTLES.clash.level.sta);
      // Fewer ships on the Low preset.
      expect(clashAt('ross-154', slot, true, null)!.law).toBe(BATTLES.clash.low + (s.tide >= BATTLES.clash.favour ? 1 : 0));
    }
    expect(seen).toBeGreaterThan(40);
    // Lacaille 9352 is on two fronts: one clash a slot between them, each front its share.
    const by = new Map<string, number>();
    for (let slot = 0; slot < 288; slot++) {
      const c = clashAt('lacaille-9352', slot, false, null);
      if (c) by.set(c.frontId, (by.get(c.frontId) ?? 0) + 1);
    }
    expect([...by.keys()].sort()).toEqual(LACAILLE.map((f) => f.id).sort());
  });

  it('holds none on a front settled for good', () => {
    const s = pilot();
    s.world.border[ROSS.id] = { deeds: [], ending: 'truce' };
    for (let slot = 0; slot < 144; slot++) expect(clashAt('ross-154', slot, false, s.world.border)).toBeNull();
    expect(battlesDue('ross-154', windowOf(ROSS, 'assault'), H, false, s.world.border)).toEqual([]);
  });

  it('stages a turning battle in the pressure’s window before the station falls or is freed, once a turn of the tide', () => {
    const t = windowOf(ROSS, 'assault');
    const s = frontState(ROSS, t, null);
    expect(s.pressure).toBeGreaterThan(BORDER.phases.fallen);
    expect(s.pressure).toBeLessThanOrEqual(BORDER.phases.fallen + BATTLES.turning.brink);
    const plan = planAt('ross-154', t, 'assault');
    expect(plan).toMatchObject({ toward: 'regent-concourse', attacker: 'wake', wake: BATTLES.turning.wave, law: BATTLES.turning.defenders, key: cycleOf(ROSS, t), level: BATTLES.turning.level.sta });
    expect(plan.until - plan.opens).toBeGreaterThan(30 * 60);
    const r = windowOf(ROSS, 'retake');
    expect(frontState(ROSS, r, null).phase).toBe('fallen');
    expect(planAt('ross-154', r, 'retake')).toMatchObject({ attacker: 'law', law: BATTLES.turning.wave, wake: BATTLES.turning.defenders });
    // Seen to its end, not again this turn; due again the next.
    const log = { [ROSS.id]: { deeds: [], battles: [{ kind: 'assault', key: plan.key, at: t, winner: 'wake', side: 'law', part: false } as BattleRecord] } };
    expect(battlesDue('ross-154', t, H, false, log).some((p) => p.kind === 'assault')).toBe(false);
    const next = windowOf(ROSS, 'assault', t + 24 * H);
    expect(planAt('ross-154', next, 'assault', log).key).toBe(plan.key + 1);
    // A front with no station that can fall has none.
    const wise = FRONTS.find((f) => !f.exposedId)!;
    for (let x = 0; x < 48 * H; x += 600) expect(turningAt(wise, x, null)).toBeNull();
  });
});

describe('a battle seen to its end', () => {
  const result = (plan: BattlePlan, winner: BattleResult['winner'], side: BattleResult['side'], part: boolean): BattleResult => ({ plan, winner, side, part });

  it('won with the pilot’s part on the law’s side: the deed, the purse and standing, and the station held for that turn', () => {
    const t = windowOf(ROSS, 'assault');
    const s = pilot(t);
    const plan = planAt('ross-154', t, 'assault');
    const credits = s.credits;
    const sta = s.reputation.sta ?? 0;
    expect(settleBattle(s, result(plan, 'law', 'law', true)).map((n) => n.text)).toEqual([
      'Battle won: the Transit Authority pays you 900 cr.',
      'The front moves your side’s way.',
      'Regent Concourse holds for now.',
    ]);
    expect(s.credits).toBe(credits + BATTLES.purse.turning);
    expect(s.reputation.sta).toBe(sta + BATTLES.standing.turning);
    expect(s.world.border[ROSS.id]!.deeds.at(-1)).toEqual([t, BATTLES.deed.turning]);
    // The station does not fall this turn of the tide.
    for (let x = t; x < t + 12 * H; x += 600) expect(frontState(ROSS, x, s.world.border).phase).not.toBe('fallen');
    // Settling the same battle again changes nothing.
    expect(settleBattle(s, result(plan, 'law', 'law', true))).toEqual([]);
    expect(s.credits).toBe(credits + BATTLES.purse.turning);
    expect(battlesSeen(s)).toEqual([{ title: 'The Wake assaults Regent Concourse', record: { kind: 'assault', key: plan.key, at: t, winner: 'law', side: 'law', part: true } }]);
  });

  it('a retaking won frees the station at once; the Wake’s side wins its standing and takes the station early', () => {
    const r = windowOf(ROSS, 'retake');
    const s = pilot(r);
    expect(settleBattle(s, result(planAt('ross-154', r, 'retake'), 'law', 'law', true)).map((n) => n.text)).toContain('Regent Concourse is the law’s again.');
    expect(frontState(ROSS, r, s.world.border).phase).not.toBe('fallen');
    const t = windowOf(ROSS, 'assault');
    const w = pilot(t);
    const wake = w.reputation['hollow-wake'] ?? 0;
    const notes = settleBattle(w, result(planAt('ross-154', t, 'assault'), 'wake', 'wake', true));
    expect(notes.map((n) => n.text)).toEqual(['Battle won: the Hollow Wake pays you 900 cr.', 'The front moves your side’s way.', 'Regent Concourse falls to the Wake.']);
    expect(w.reputation['hollow-wake']).toBe(wake + BATTLES.standing.turning);
    expect(frontState(ROSS, t, w.world.border).phase).toBe('fallen');
  });

  it('a clash won pays less; won without the pilot’s part, lost or drawn, nothing beyond the record', () => {
    const plans = battlesDue('ross-154', 0, 48 * H, false, null).filter((p) => p.kind === 'clash');
    const s = pilot(plans[0]!.opens + 120);
    const credits = s.credits;
    expect(settleBattle(s, result(plans[0]!, 'law', 'law', true))[0]!.text).toBe('Battle won: the Transit Authority pays you 300 cr.');
    expect(s.credits).toBe(credits + BATTLES.purse.clash);
    expect(s.world.border[ROSS.id]!.deeds.at(-1)![1]).toBeCloseTo(BATTLES.deed.clash);
    s.clock = plans[1]!.opens + 120;
    expect(settleBattle(s, result(plans[1]!, 'law', 'law', false))).toEqual([{ text: 'Your side won without you downing a ship of theirs: no purse.', tone: 'info' }]);
    s.clock = plans[2]!.opens + 120;
    expect(settleBattle(s, result(plans[2]!, 'wake', 'law', true))).toEqual([{ text: 'The battle is lost.', tone: 'bad' }]);
    s.clock = plans[3]!.opens + 120;
    expect(settleBattle(s, result(plans[3]!, 'draw', 'law', true))).toEqual([{ text: 'Both sides pulled back.', tone: 'info' }]);
    expect(s.credits).toBe(credits + BATTLES.purse.clash);
    expect(s.world.border[ROSS.id]!.deeds).toHaveLength(1);
    expect(s.world.border[ROSS.id]!.battles).toHaveLength(4);
    assertValidState(s);
  });

  it('a turning battle won with the pilot is in the News within reach for two hours; a clash is not', () => {
    const t = windowOf(ROSS, 'assault');
    const s = pilot(t);
    settleBattle(s, result(planAt('ross-154', t, 'assault'), 'law', 'law', true));
    expect(battleNews('ross-154', t + 60, s.world.border)).toEqual([
      { headline: 'A pilot helps beat off the Wake’s assault on Regent Concourse', detail: 'Lawful wings and a pilot flying with them broke the raiders on the station’s approach.', at: t },
    ]);
    expect(battleNews('ross-154', t + BATTLES.newsSeconds + 1, s.world.border)).toEqual([]);
    // Out of reach: more than three jumps from both ends of the line.
    const near = jumpsFrom(WORLD.links, 'ross-154');
    const den = jumpsFrom(WORLD.links, 'wolf-1061');
    const far = SYSTEMS.find((x) => (near.get(x.id) ?? 99) > BORDER.newsJumps && (den.get(x.id) ?? 99) > BORDER.newsJumps)!;
    expect(battleNews(far.id, t + 60, s.world.border)).toEqual([]);
    expect(battleNews('ross-154', t + 60, s.world.border)).toHaveLength(1);
  });

  it('keeps so many on the save, and refuses damaged records', () => {
    const plans = battlesDue('ross-154', 0, 48 * H, false, null).filter((p) => p.kind === 'clash');
    const s = pilot();
    for (const p of plans.slice(0, BATTLES.keep + 2)) {
      s.clock = p.opens + 100;
      settleBattle(s, { plan: p, winner: 'draw', side: 'law', part: false });
    }
    expect(s.world.border[ROSS.id]!.battles).toHaveLength(BATTLES.keep);
    assertValidState(s);
    const bad = (patch: (b: BattleRecord[]) => void) => {
      const x = structuredClone(s);
      patch(x.world.border[ROSS.id]!.battles!);
      return () => assertValidState(x);
    };
    expect(bad((b) => (b[0]!.kind = 'siege' as never))).toThrow(/border battles/);
    expect(bad((b) => (b[0]!.key = b[0]!.key + 5))).toThrow(/border battles/);
    expect(bad((b) => (b[0]!.at = s.clock + 999))).toThrow(/border battles/);
    expect(bad((b) => (b[0]!.side = 'pirate' as never))).toThrow(/border battles/);
    expect(bad((b) => (b[1] = { ...b[0]! }))).toThrow(/border battles/);
    expect(bad((b) => b.push({ ...b[0]!, key: b[0]!.key - 50, at: (b[0]!.key - 50) * BATTLES.clash.slotSeconds }))).toThrow(/border battles/);
    expect(bad((b) => (b[0]!.den = true))).not.toThrow();
    const x = structuredClone(s);
    x.world.border['nowhere~else'] = { deeds: [], battles: [] };
    expect(() => assertValidState(x)).toThrow(/border battles/);
  });
});

// ---------------------------------------------------------------- in flight

function installCanvasStub(): void {
  if ((globalThis as { document?: unknown }).document) return;
  const stub = (): unknown =>
    new Proxy(function () {}, {
      get(_t, prop) {
        if (prop === 'getImageData' || prop === 'createImageData') {
          return (_x: number, _y: number, w: number, h: number) => ({ data: new Uint8ClampedArray(Math.max(4, w * h * 4)), width: w, height: h });
        }
        return stub();
      },
      apply() {
        return stub();
      },
      set() {
        return true;
      },
    });
  (globalThis as { document?: unknown }).document = {
    createElement: () => ({ width: 0, height: 0, style: {}, getContext: () => stub() }),
  };
}

type Inner = { npcs: NpcShip[]; damageNpc(n: unknown, amount: number, at: THREE.Vector3, type: undefined, byPlayer: boolean): void };

function battleFlight(systemId: SystemId, plan: BattlePlan, setup: (s: GameState) => void = () => {}, traffic: Partial<TrafficSetup> = {}) {
  const state = pilot(plan.opens - 25);
  state.location = { systemId, dockedAt: null, flight: null, lastDockId: state.location.lastDockId };
  setup(state);
  const events: BattleEvent[] = [];
  const comms: string[] = [];
  const nothing = () => {};
  const flight = new FlightSession({
    system: new SystemScene(sceneDefFor(systemId), { quality: 'low', reducedMotion: true }),
    camera: new THREE.PerspectiveCamera(),
    state,
    settings: defaultSettings(),
    ctx: { quality: 'low', reducedMotion: true },
    audio: { play() {}, setCombatIntensity() {}, setEngine() {} } as unknown as AudioEngine,
    callbacks: {
      onDocked: nothing,
      onPlayerDestroyed: nothing,
      onDiscovery: nothing,
      onScanInfo: nothing,
      onEncounterStart: nothing,
      onEncounterEnd: nothing,
      onLoot: nothing,
      onBounty: nothing,
      onContractKill: nothing,
      onMessage: nothing,
      onComm: (who, text) => comms.push(`${who}: ${text}`),
      onBattle: (e) => events.push(e),
    },
    traffic: { plan: { traders: 0, patrolWings: 0, wingSize: 2, packs: null }, owner: null, battles: [plan], ...traffic },
  });
  flight.start({ kind: 'arrival' });
  const inner = flight as unknown as Inner;
  const run = (seconds: number, until?: () => boolean) => {
    for (let t = 0; t < seconds; t += 1 / 20) {
      state.clock += 1 / 20;
      flight.update(1 / 20, emptyInput());
      if (until?.()) return true;
    }
    return false;
  };
  const ended = () => events.find((e): e is Extract<BattleEvent, { kind: 'ended' }> => e.kind === 'ended')?.result ?? null;
  const ships = (side: 'law' | 'wake') => inner.npcs.filter((n) => n.battle?.side === side && n.durability.hull > 0 && !n.battle.over);
  return { state, flight, inner, run, events, comms, ended, ships };
}

const ROSS_CLASH = () => battlesDue('ross-154', 0, 48 * H, false, null).find((p) => p.kind === 'clash' && p.law === p.wake)!;

describe('a battle in flight', () => {
  beforeAll(installCanvasStub);

  it('a clash opens at the beacon line a moment after arrival; the strip counts each side; the pilot’s part counts once', () => {
    const plan = ROSS_CLASH();
    const f = battleFlight('ross-154', plan);
    expect(f.run(30, () => f.events.length > 0)).toBe(true);
    expect(f.events[0]).toEqual({ kind: 'opened', plan });
    expect(f.comms).toContain(`Transit Authority wing: ${BATTLE_OPEN.clash.law}`);
    f.run(0.1);
    expect(f.flight.hud.battle).toEqual({ title: plan.title, law: plan.law, wake: plan.wake, side: 'law', lawName: 'Transit Authority' });
    const line = f.flight.allTargets().find((t) => t.id === 'battle-line')!;
    expect(line).toMatchObject({ kind: 'battle', dataClass: 'fictional' });
    expect(line.position.distanceTo(f.flight.player.position)).toBeGreaterThan(BATTLES.line.min - 1_000);
    expect(f.ships('wake').every((n) => n.target.hostile)).toBe(true);
    expect(f.ships('law').every((n) => !n.target.hostile)).toBe(true);
    // The pilot downs one, a ship of theirs goes down to the law's guns.
    const [first, ...rest] = f.ships('wake');
    f.flight.debugDestroy(first!.id, true);
    expect(f.flight.battleStatus().part).toBe(true);
    for (const n of rest) f.flight.debugDestroy(n.id, false);
    expect(f.run(1, () => !!f.ended())).toBe(true);
    expect(f.ended()).toEqual({ plan, winner: 'law', side: 'law', part: true });
    expect(f.flight.hud.battle).toBeNull();
    // The winners hold; the battle is not staged twice.
    f.run(2);
    expect(f.events.filter((e) => e.kind === 'opened')).toHaveLength(1);
    expect(settleBattle(f.state, f.ended()!)[0]!.text).toBe('Battle won: the Transit Authority pays you 300 cr.');
  });

  it('on the Wake’s side for a pilot it trusts: the law’s ships are the enemy, and the wing holds its fire on the battle', () => {
    const plan = ROSS_CLASH();
    const crew = [{ id: 'w1', name: 'Maren Okoro', model: 'ship.light-fighter.1.halden', skill: 'sharp' as const }];
    const f = battleFlight('ross-154', plan, (s) => (s.reputation['hollow-wake'] = LAW.wakeFriendly + 5), { crew });
    f.run(30, () => f.events.length > 0);
    f.run(0.1);
    expect(f.flight.hud.battle?.side).toBe('wake');
    expect(f.ships('law').every((n) => n.target.hostile)).toBe(true);
    expect(f.ships('wake').every((n) => !n.target.hostile)).toBe(true);
    // Bring the battle to the wing: it does not fire on it.
    const wing = f.inner.npcs.find((n) => n.wingman?.crewId)!;
    for (const n of f.ships('wake')) n.body.position.copy(f.flight.player.position).add(new THREE.Vector3(800, 0, 0));
    f.run(3);
    expect(wing.foe === null || wing.foe === 'player' || !(wing.foe as NpcShip).battle).toBe(true);
  });

  it('a ship of the pilot’s own side fired on turns on them for the rest of the battle', () => {
    const f = battleFlight('ross-154', ROSS_CLASH());
    f.run(30, () => f.events.length > 0);
    const ally = f.ships('law')[0]!;
    f.flight.player.position.copy(ally.body.position).add(new THREE.Vector3(0, 0, 600));
    f.inner.damageNpc(ally, 1, ally.body.position.clone(), undefined, true);
    expect(ally.battle?.turned).toBe(true);
    f.run(0.5);
    expect(ally.target.hostile).toBe(true);
    expect(ally.foe).toBe('player');
  });

  it('an assault comes in two waves, the second when the first is down to a ship', () => {
    const t = windowOf(ROSS, 'assault');
    const plan = planAt('ross-154', t, 'assault');
    const f = battleFlight('ross-154', plan);
    f.run(30, () => f.events.length > 0);
    f.run(0.1);
    expect(f.ships('wake')).toHaveLength(plan.wake);
    expect(f.ships('law')).toHaveLength(plan.law);
    for (const n of f.ships('wake').slice(BATTLES.turning.next)) f.flight.debugDestroy(n.id, false);
    f.run(0.2);
    expect(f.flight.battleStatus().wave).toBe(2);
    expect(f.ships('wake')).toHaveLength(BATTLES.turning.next + plan.wake);
    // Both waves down: the assault is beaten off.
    for (const n of f.ships('wake')) f.flight.debugDestroy(n.id, false);
    expect(f.run(1, () => !!f.ended())).toBe(true);
    expect(f.ended()).toMatchObject({ winner: 'law', part: false });
  });

  it('a turning battle comes before a clash due at the same time', () => {
    const t = windowOf(ROSS, 'assault');
    const plan = planAt('ross-154', t, 'assault');
    const clash = battlesDue('ross-154', plan.opens - 600, H, false, null).find((p) => p.kind === 'clash' && p.until > plan.opens - 40);
    const due = clash ? [clash, plan] : [plan];
    const f = battleFlight('ross-154', plan, () => {}, { battles: due });
    f.state.clock = plan.opens - 40;
    f.run(60, () => f.events.length > 0);
    expect(f.events[0]).toEqual({ kind: 'opened', plan });
  });

  it('a battle left before its end is not recorded, and is staged again while still due', () => {
    const t = windowOf(ROSS, 'assault');
    const plan = planAt('ross-154', t, 'assault');
    const f = battleFlight('ross-154', plan);
    f.run(30, () => f.events.length > 0);
    expect(f.ended()).toBeNull();
    expect(f.state.world.border[ROSS.id]?.battles ?? []).toEqual([]);
    expect(battlesDue('ross-154', f.state.clock, H, false, f.state.world.border).some((p) => p.id === plan.id)).toBe(true);
  });

  it('left to themselves, both sides win some clashes', { timeout: 120_000 }, () => {
    const winners = new Set<string>();
    const systems: SystemId[] = ['ross-154', 'yz-ceti', 'lacaille-9352', 'wise-0722-0540'];
    for (let k = 0; k < 8 && winners.size < 2; k++) {
      const sys = systems[k % systems.length]!;
      const plan = battlesDue(sys, 0, 48 * H, false, null).filter((p) => p.kind === 'clash')[k * 2]!;
      const f = battleFlight(sys, plan);
      f.run(BATTLES.clash.lasts + 60, () => !!f.ended());
      const r = f.ended();
      if (r && r.winner !== 'draw') winners.add(r.winner);
    }
    expect([...winners].sort()).toEqual(['law', 'wake']);
  });

  it('says it is fiction', () => {
    expect(BATTLE_FICTION.startsWith('Fiction:')).toBe(true);
  });
});
