import * as THREE from 'three';
import { afterEach, describe, expect, it } from 'vitest';
import type { AudioEngine } from '../../src/audio/AudioEngine.ts';
import { defaultSettings } from '../../src/app/settings.ts';
import { assertValidState } from '../../src/app/save/migrate.ts';
import { createNewGame, type GameState } from '../../src/app/state.ts';
import { dockAt } from '../../src/app/rules.ts';
import { LANE_LINES } from '../../src/content/lanes/lines.ts';
import { LANE_KINDS, LANES, type LaneKind, type LaneRules } from '../../src/content/lanes/rules.ts';
import { LAW } from '../../src/content/law/rules.ts';
import { getLocation, SYSTEMS } from '../../src/data/systems.ts';
import type { SystemId } from '../../src/data/types.ts';
import { addCargo, cargoCount } from '../../src/economy/cargo.ts';
import { useWorldLog } from '../../src/economy/events.ts';
import { deliverJob } from '../../src/economy/jobs.ts';
import { laneWorldStats, validateLanes } from '../../src/economy/laneGuards.ts';
import { answerLane, laneChoices, laneEncounter, laneOfferFor, laneSlot, laneWords, lapseLane, oddsText, stageLane, tidyLanes, type LaneOffer } from '../../src/economy/lanes.ts';
import { fineOnRecord } from '../../src/economy/law.ts';
import { passengersAboard } from '../../src/economy/passengers.ts';
import { emptyInput } from '../../src/flight/input/types.ts';
import { FlightSession } from '../../src/world/FlightSession.ts';
import { SystemScene } from '../../src/world/SystemScene.ts';
import { sceneDefFor } from '../../src/world/systems/index.ts';
import { trafficFor } from '../../src/world/traffic/setup.ts';

/**
 * Lane encounters (docs/PROCGEN.md §27): the rules' guardrails, the world's slots, the pilot's gate,
 * each kind's choices and what they bring, the save's records, and the hail in a real flight.
 */

afterEach(() => useWorldLog(null));

/** A pilot past the opening, in flight, with credits, a cabin of three berths and room in the hold. */
function pilot(systemId: SystemId, clock: number): GameState {
  const s = createNewGame(31);
  s.jobs.lifeline = { status: 'complete', objectiveIndex: 4, acceptedAt: 0, completedAt: 1 };
  s.flags.clearance = true;
  s.credits = 20_000;
  s.clock = clock;
  s.location = { systemId, dockedAt: null, flight: null, lastDockId: 'earth-port' };
  s.ship.fittings['utility-1'] = 'gear.cabin.2.halden';
  useWorldLog(s.world);
  return s;
}

/** The first slot, from a start, holding an encounter that matches. */
function find(match: (o: LaneOffer) => boolean, from = 20): LaneOffer {
  for (let slot = from; slot < from + 3_000; slot++) {
    for (const s of SYSTEMS) {
      const o = laneEncounter(s.id, slot);
      if (o && match(o)) return o;
    }
  }
  throw new Error('no such encounter');
}

/** A pilot meeting an encounter: past their first (so traps may come), in its system at its slot. */
function meeting(o: LaneOffer): GameState {
  const s = pilot(o.systemId, o.start + 5);
  s.world.lanes = { 'gj-1061.1': { at: 600, kind: 'trader', systemId: 'gj-1061' as SystemId, pick: 'sell' } };
  return s;
}

describe('lane encounters: the rules', () => {
  it('pass their guardrails, and meet a touring pilot every 15–25 minutes', () => {
    expect(validateLanes()).toEqual([]);
    const stats = laneWorldStats();
    expect(stats.tourMinutes).toBeGreaterThanOrEqual(15);
    expect(stats.tourMinutes).toBeLessThanOrEqual(25);
    for (const k of LANE_KINDS) expect(stats.kinds[k] ?? 0).toBeGreaterThan(0);
  });

  it('catch broken rules: chances that fall with lawlessness, bait in secure space, tolls that fall, a number in a line', () => {
    const broken = (patch: (r: LaneRules) => void) => {
      const r = structuredClone(LANES) as LaneRules;
      patch(r);
      return validateLanes(r).map((i) => i.rule);
    };
    expect(broken((r) => ((r.chance as { lawless: number }).lawless = 0.1))).toContain('rules');
    expect(broken((r) => ((r.kinds.mayday.bait as { secure: number }).secure = 0.2))).toContain('rules');
    expect(broken((r) => ((r.kinds.toll.toll as Record<number, number>)[3] = 10))).toContain('rules');
    expect(broken((r) => ((r as { hailSeconds: number }).hailSeconds = 5))).toContain('rules');
    const hail = LANE_LINES.mayday.hail;
    (LANE_LINES.mayday as { hail: string }).hail = 'Mayday, 3 souls aboard';
    try {
      expect(validateLanes(structuredClone(LANES) as LaneRules).map((i) => i.rule)).toContain('lines');
    } finally {
      (LANE_LINES.mayday as { hail: string }).hail = hail;
    }
  });

  it('give odds in words', () => {
    expect(oddsText(0.25)).toBe('about one in four');
    expect(oddsText(0.2)).toBe('about one in five');
    expect(oddsText(0.5)).toBe('about one in two');
    expect(oddsText(0)).toBe('never');
  });
});

describe('the world’s slots', () => {
  it('hold the same encounter every time, never in Sol or at Pyre, each fitting its system', () => {
    for (const id of ['sol', 'pyre'] as SystemId[]) for (let slot = 0; slot < 200; slot++) expect(laneEncounter(id, slot)).toBeNull();
    const o = find((x) => x.kind === 'mayday');
    expect(laneEncounter(o.systemId, o.slot)).toEqual(o);
    expect(o.id).toBe(`${o.systemId}.${o.slot}`);
    expect(laneSlot(o.start)).toBe(o.slot);
    const toll = find((x) => x.kind === 'toll');
    expect(trafficFor(toll.systemId, 'high').plan.packs?.level).toBe(toll.level);
    expect(toll.toll).toBe(LANES.kinds.toll.toll[toll.level!]);
  });
});

describe('the pilot’s gate', () => {
  it('opens after the opening, once a slot, once a cooldown; the first is gentle; customs need contraband, the Wake tolls no friend', () => {
    const o = find((x) => x.kind === 'mayday' && !x.trap);
    const s = pilot(o.systemId, o.start + 5);
    expect(laneOfferFor(s, o.systemId)?.id).toBe(o.id);
    s.jobs.lifeline = { status: 'active', objectiveIndex: 0, acceptedAt: 0 };
    expect(laneOfferFor(s, o.systemId)).toBeNull();
    s.jobs.lifeline = { status: 'complete', objectiveIndex: 4, acceptedAt: 0, completedAt: 1 };
    stageLane(s, o);
    expect(laneOfferFor(s, o.systemId)).toBeNull();
    // The next slot's encounter waits for the cooldown.
    const next = find((x) => x.systemId === o.systemId && x.slot > o.slot, o.slot + 1);
    s.clock = next.start + 1;
    if (next.start - s.world.lanes![o.id]!.at < LANES.cooldown) expect(laneOfferFor(s, o.systemId)).toBeNull();
    // A first encounter is never a toll, a customs patrol or a trap.
    const toll = find((x) => x.kind === 'toll');
    expect(laneOfferFor(pilot(toll.systemId, toll.start + 5), toll.systemId)).toBeNull();
    const t = meeting(toll);
    expect(laneOfferFor(t, toll.systemId)?.kind).toBe('toll');
    t.reputation['hollow-wake'] = 100;
    expect(laneOfferFor(t, toll.systemId)).toBeNull();
    const customs = find((x) => x.kind === 'customs');
    const c = meeting(customs);
    expect(laneOfferFor(c, customs.systemId)).toBeNull();
    addCargo(c.ship.cargo, LAW.contraband[0]!, 2);
    expect(laneOfferFor(c, customs.systemId)?.kind).toBe('customs');
  });
});

describe('choices and what they bring', () => {
  it('a mayday: a reward when it is real, raiders when it is bait; the card names the risk out of secure space', () => {
    const real = find((x) => x.kind === 'mayday' && !x.trap);
    const s = meeting(real);
    const credits = s.credits;
    const out = answerLane(s, real, 'help')!;
    expect(out.ambush).toBeUndefined();
    expect(s.credits - credits).toBe(real.credits);
    expect(s.world.lanes![real.id]!.pick).toBe('help');
    const bait = find((x) => x.kind === 'mayday' && x.trap);
    const b = meeting(bait);
    const before = b.credits;
    const words = laneWords(b, bait);
    expect(words.risk).toMatch(/sometimes bait: about one in/);
    const trap = answerLane(b, bait, 'help')!;
    expect(trap.ambush).toBe(bait.level);
    expect(b.credits).toBe(before);
    expect(trap.text).toMatch(/bait/);
  });

  it('a lifepod: its survivor aboard for a fare, needing a berth', () => {
    const o = find((x) => x.kind === 'lifepod');
    const s = meeting(o);
    expect(laneChoices(s, o).find((c) => c.id === 'aboard')!.lock).toBeNull();
    const out = answerLane(s, o, 'aboard')!;
    expect(out.jobId).toBe(`c.lane.${o.id}`);
    expect(passengersAboard(s)).toBe(1);
    expect(s.jobs[out.jobId!]?.status).toBe('active');
    const before = s.credits;
    dockAt(s, o.stationId!);
    expect(s.jobs[out.jobId!]?.status).toBe('complete');
    expect(s.credits - before).toBe(o.fare);
    const none = meeting(o);
    delete none.ship.fittings['utility-1'];
    expect(laneChoices(none, o).find((c) => c.id === 'aboard')!.lock).toMatch(/berth/);
    expect(answerLane(none, o, 'aboard')).toBeNull();
  });

  it('a toll: paid, the Wake lets you be; refused or let lapse, they attack; closed to a pilot who cannot pay', () => {
    const o = find((x) => x.kind === 'toll');
    const s = meeting(o);
    const before = s.credits;
    expect(answerLane(s, o, 'pay')).toMatchObject({ pass: true });
    expect(before - s.credits).toBe(o.toll);
    expect(answerLane(meeting(o), o, 'refuse')).toMatchObject({ ambush: o.level });
    expect(lapseLane(meeting(o), o)).toMatchObject({ ambush: o.level });
    const broke = meeting(o);
    broke.credits = 10;
    expect(laneChoices(broke, o).find((c) => c.id === 'pay')!.lock).toMatch(/You have/);
  });

  it('customs: declared, half the fine; a bribe looked away or a sting; dumped, standing lost; ignored, a full scan', () => {
    const o = find((x) => x.kind === 'customs' && !x.trap);
    const good = LAW.contraband[0]!;
    const loaded = () => {
      const s = meeting(o);
      addCargo(s.ship.cargo, good, 3);
      return s;
    };
    const d = loaded();
    answerLane(d, o, 'declare');
    expect(cargoCount(d.ship.cargo, good)).toBe(0);
    expect(fineOnRecord(d, o.owner!) + d.law.pending.reduce((a, c) => a + c.amount, 0)).toBeGreaterThan(0);
    const b = loaded();
    const credits = b.credits;
    expect(answerLane(b, o, 'bribe')!.tone).toBe('good');
    expect(cargoCount(b.ship.cargo, good)).toBe(3);
    expect(b.credits).toBeLessThan(credits);
    const sting = find((x) => x.kind === 'customs' && x.trap);
    const st = meeting(sting);
    addCargo(st.ship.cargo, good, 3);
    const standing = st.reputation[sting.owner!] ?? 0;
    expect(answerLane(st, sting, 'bribe')!.text).toMatch(/sting/);
    expect(cargoCount(st.ship.cargo, good)).toBe(0);
    expect((st.reputation[sting.owner!] ?? 0) - standing).toBe(LANES.kinds.customs.stingStanding);
    expect(st.law.pending.some((c) => c.amount === LANES.kinds.customs.stingFine)).toBe(true);
    const dump = loaded();
    const before = dump.reputation[o.owner!] ?? 0;
    answerLane(dump, o, 'dump');
    expect(cargoCount(dump.ship.cargo, good)).toBe(0);
    expect((dump.reputation[o.owner!] ?? 0) - before).toBe(LANES.kinds.customs.dumpStanding);
    const ignored = loaded();
    expect(lapseLane(ignored, o).text).toMatch(/scans you anyway/);
    expect(cargoCount(ignored.ship.cargo, good)).toBe(0);
  });

  it('a stranded scientist: a berth to a research station and a data core; fuel for helium-3 aboard; or a tow', () => {
    const o = find((x) => x.kind === 'scientist');
    expect(getLocation(o.stationId!).stationType).toBe('research-station');
    const s = meeting(o);
    const out = answerLane(s, o, 'berth')!;
    expect(s.jobs[out.jobId!]?.status).toBe('active');
    expect(cargoCount(s.ship.cargo, 'data-cores')).toBe(1);
    const f = meeting(o);
    expect(laneChoices(f, o).find((c) => c.id === 'fuel')!.lock).toMatch(/aboard/);
    addCargo(f.ship.cargo, 'helium-3', 1);
    const credits = f.credits;
    answerLane(f, o, 'fuel');
    expect(cargoCount(f.ship.cargo, 'helium-3')).toBe(0);
    expect(f.credits - credits).toBe(o.credits);
  });

  it('cargo adrift: returned for pay, or kept; bait brings raiders and nothing aboard', () => {
    const o = find((x) => x.kind === 'cargo' && !x.trap);
    const s = meeting(o);
    const out = answerLane(s, o, 'return')!;
    expect(cargoCount(s.ship.cargo, o.good!)).toBe(o.qty);
    const dest = getLocation(o.stationId!);
    s.location = { ...s.location, systemId: dest.systemId, dockedAt: dest.id };
    const before = s.credits;
    expect(deliverJob(s, out.jobId!, dest.id)).toMatchObject({ ok: true });
    expect(s.credits - before).toBe(o.credits);
    const k = meeting(o);
    answerLane(k, o, 'keep');
    expect(cargoCount(k.ship.cargo, o.good!)).toBe(o.qty);
    const bait = find((x) => x.kind === 'cargo' && x.trap);
    const b = meeting(bait);
    expect(answerLane(b, bait, 'keep')).toMatchObject({ ambush: bait.level });
    expect(cargoCount(b.ship.cargo, bait.good!)).toBe(0);
  });

  it('a lost trader: a fix sold, or charts shared for what they know', () => {
    const o = find((x) => x.kind === 'trader');
    const s = meeting(o);
    const credits = s.credits;
    answerLane(s, o, 'sell');
    expect(s.credits - credits).toBe(LANES.kinds.trader.fix);
    const c = meeting(o);
    const out = answerLane(c, o, 'charts')!;
    expect(out.text).toMatch(/thanks you/);
  });

  it('every card’s words are filled, with no number written in, and a choice for each line', () => {
    const kinds = new Set<LaneKind>();
    for (let slot = 30; slot < 400 && kinds.size < LANE_KINDS.length; slot += 3) {
      for (const sys of SYSTEMS) {
        const o = laneEncounter(sys.id, slot);
        if (!o) continue;
        kinds.add(o.kind);
        const s = meeting(o);
        const w = laneWords(s, o);
        for (const text of [w.hail, w.scene, w.risk ?? '']) expect(text).not.toMatch(/\{|\}|undefined|NaN/);
        expect(laneChoices(s, o).map((c) => c.id)).toEqual(Object.keys(LANE_LINES[o.kind].options));
      }
    }
    expect(kinds.size).toBe(LANE_KINDS.length);
  });
});

describe('the save', () => {
  it('keeps what was met, tidily, and refuses a damaged record', () => {
    const o = find((x) => x.kind === 'trader');
    const s = meeting(o);
    stageLane(s, o);
    answerLane(s, o, 'sell');
    assertValidState(s);
    for (let i = 0; i < 60; i++) s.world.lanes![`gj-1061.${i}`] = { at: i * LANES.slotSeconds, kind: 'trader', systemId: 'gj-1061' as SystemId };
    tidyLanes(s);
    expect(Object.keys(s.world.lanes!).length).toBeLessThanOrEqual(LANES.keep.records);
    const bad = structuredClone(s);
    bad.world.lanes = { 'x.1': { at: 1, kind: 'mayday', systemId: 'nowhere' as SystemId } };
    expect(() => assertValidState(bad)).toThrow(/world/);
    const wrong = structuredClone(s);
    wrong.world.lanes = { [`${o.systemId}.999999`]: { at: o.start, kind: o.kind, systemId: o.systemId } };
    expect(() => assertValidState(wrong)).toThrow(/world/);
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

function fly(o: LaneOffer, more: Record<string, unknown> = {}): { s: GameState; flight: FlightSession; run: (seconds: number) => void } {
  installCanvasStub();
  const s = meeting(o);
  s.clock = o.start + 1;
  const nothing = () => {};
  const flight = new FlightSession({
    system: new SystemScene(sceneDefFor(o.systemId, null, s.clock), { quality: 'low', reducedMotion: true }),
    camera: new THREE.PerspectiveCamera(),
    state: s,
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
      onComm: nothing,
      ...more,
    },
    traffic: { ...trafficFor(o.systemId, 'low', s.clock), plan: { ...trafficFor(o.systemId, 'low', s.clock).plan, packs: null } },
  });
  flight.start({ kind: 'arrival' });
  const run = (seconds: number) => {
    for (let t = 0; t < seconds; t += 1 / 10) {
      s.clock += 1 / 10;
      flight.update(1 / 10, emptyInput());
    }
  };
  return { s, flight, run };
}

describe('in flight', () => {
  it('hails once the ship is flying quietly, written into the save; answered, the card; let be, it lapses', () => {
    const o = find((x) => x.kind === 'trader');
    const answered: string[] = [];
    const lapsed: string[] = [];
    const { s, flight, run } = fly(o, { onAnswerHail: (x: LaneOffer) => answered.push(x.id), onHailLapsed: (x: LaneOffer) => lapsed.push(x.id) });
    run(LANES.grace.afterArrival - 2);
    expect(flight.hailState).toBeNull();
    run(4);
    expect(flight.hailState?.id).toBe(o.id);
    expect(s.world.lanes?.[o.id]).toBeDefined();
    expect(flight.hud.hail?.from).toBe(LANE_LINES.trader.speaker);
    expect(flight.contextAction()?.label).toBe('Answer');
    flight.answerHail();
    expect(answered).toEqual([o.id]);
    run(LANES.hailSeconds + 2);
    expect(lapsed).toEqual([o.id]);
    expect(flight.hailState).toBeNull();
    flight.dispose();
  });

  it('a refused toll brings raiders out of the dark; a paid one, a pack that lets the ship be', () => {
    const o = find((x) => x.kind === 'toll');
    const { flight, run } = fly(o);
    const before = flight.allTargets().filter((t) => t.hostile).length;
    flight.laneOutcome(o.id, { text: '', tone: 'bad', ambush: o.level });
    run(0.5);
    expect(flight.allTargets().filter((t) => t.hostile).length).toBeGreaterThan(before);
    flight.dispose();
    const paid = fly(o);
    paid.flight.laneOutcome(o.id, { text: '', tone: 'info', pass: true });
    paid.flight.laneOutcome(o.id, { text: '', tone: 'bad', ambush: o.level });
    paid.run(0.5);
    expect(paid.flight.hostilesNearby(20_000)).toBe(false);
    paid.flight.dispose();
  });
});
