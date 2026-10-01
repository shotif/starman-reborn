import * as THREE from 'three';
import { afterEach, describe, expect, it } from 'vitest';
import type { AudioEngine } from '../../src/audio/AudioEngine.ts';
import { defaultSettings } from '../../src/app/settings.ts';
import { assertValidState } from '../../src/app/save/migrate.ts';
import { createNewGame, markVisited, type GameState } from '../../src/app/state.ts';
import { PEOPLE } from '../../src/content/people/rules.ts';
import { GREET } from '../../src/content/rivals/lines.ts';
import { RIVALS, ROSTER, type RivalDef } from '../../src/content/rivals/rules.ts';
import { getLocation, WORLD } from '../../src/data/systems.ts';
import type { SystemId } from '../../src/data/types.ts';
import { emptyInput } from '../../src/flight/input/types.ts';
import { FlightSession } from '../../src/world/FlightSession.ts';
import { SystemScene } from '../../src/world/SystemScene.ts';
import { sceneDefFor } from '../../src/world/systems/index.ts';
import { boardEpoch, postedContracts } from '../../src/economy/contracts.ts';
import { eventEnd, useWorldLog } from '../../src/economy/events.ts';
import { haulReliefEnd, reliefEnd } from '../../src/economy/hauls.ts';
import { marketEntry, stockNow } from '../../src/economy/markets.ts';
import { sampleRuns, validateRivals, type RivalRules } from '../../src/economy/rivalGuards.ts';
import {
  buyClaim,
  buyRivalRound,
  claimFor,
  claimsAt,
  makeAmends,
  rivalById,
  rivalDestroyed,
  rivalGreeting,
  rivalNews,
  rivalShot,
  rivalStock,
  rivalTier,
  rivalWhere,
  rivalsDockedAt,
  roundBlock,
  runOf,
  standingWith,
  turnOf,
  turnStart,
  type RivalRun,
} from '../../src/economy/rivals.ts';

/**
 * Rival pilots (docs/PROCGEN.md §24): the six and their guardrails, careers on the clock, the
 * markets they move, the bounties they take and the claims bought back, the shortages they race to,
 * standing, knock-outs, the News, and saves.
 */

afterEach(() => useWorldLog(null));

const rival = (id: string): RivalDef => rivalById(id)!;
const firstRun = (id: string, kind: RivalRun['kind'], from = 0): RivalRun => {
  for (let n = from; n < 400; n++) {
    const run = runOf(rival(id), n);
    if (run?.kind === kind) return run;
  }
  throw new Error(`no ${kind} for ${id}`);
};

/** A pilot past the opening, docked at a station, its world log in use. */
function pilotAt(locationId: string, clock: number): GameState {
  const s = createNewGame(5);
  s.jobs.lifeline = { status: 'complete', objectiveIndex: 4, acceptedAt: 0, completedAt: 1 };
  s.flags.clearance = true;
  s.credits = 20_000;
  s.clock = clock;
  const loc = getLocation(locationId);
  s.location = { systemId: loc.systemId, dockedAt: locationId, flight: null, lastDockId: locationId };
  markVisited(s, loc.systemId, locationId);
  useWorldLog(s.world);
  return s;
}

describe('the six', () => {
  it('pass their guardrails over two days of careers, every style among them', () => {
    expect(validateRivals()).toEqual([]);
    const runs = sampleRuns();
    for (const kind of ['trade', 'hunt', 'race'] as const) expect(runs.some((r) => r.kind === kind)).toBe(true);
    expect(new Set(ROSTER.map((r) => r.style))).toEqual(new Set(['trader', 'hunter', 'runner']));
  });

  it('catch broken ones: a turn too short, a name the bars use, a line with a number, a run that overruns', () => {
    const broken = (patch: (r: RivalRules) => void) => {
      const r = structuredClone(RIVALS) as RivalRules;
      patch(r);
      return validateRivals(r, ROSTER, []).map((i) => i.rule);
    };
    expect(broken((r) => ((r as { turnSeconds: number }).turnSeconds = 1_000))).toContain('rules');
    expect(broken((r) => ((r.standing as { shot: number }).shot = 5))).toContain('rules');
    const named = validateRivals(RIVALS, [...ROSTER.slice(1), { ...ROSTER[0]!, last: 'Vance' }], []);
    expect(named.map((i) => i.rule)).toContain('roster');
    expect(validateRivals(RIVALS, [...ROSTER.slice(1), { ...ROSTER[0]!, home: 'earth-port' }], []).map((i) => i.rule)).toContain('roster');
    const lines = GREET.dry.neutral as string[];
    const keep = lines[0]!;
    lines[0] = 'Back in 5 minutes.';
    expect(validateRivals(RIVALS, ROSTER, []).map((i) => i.rule)).toContain('lines');
    lines[0] = keep;
    const run = firstRun('quickstep', 'trade');
    expect(validateRivals(RIVALS, ROSTER, [{ ...run, arrive: turnStart(run.turn + 2) }]).map((i) => i.rule)).toContain('runs');
    expect(validateRivals(RIVALS, ROSTER, [{ ...run, commodity: 'stims' }]).map((i) => i.rule)).toContain('runs');
  });
});

describe('careers on the clock', () => {
  it('start once the opening is over, the same in every save, each run from where the last one ended', () => {
    const r = rival('quickstep');
    expect(rivalWhere(r, RIVALS.from - 1)).toEqual({ kind: 'docked', locationId: r.home });
    expect(runOf(r, -1)).toBeNull();
    for (let n = 1; n < 30; n++) {
      const run = runOf(r, n);
      if (!run) continue;
      let back = n - 1;
      while (back >= 0 && !runOf(r, back)) back--;
      expect(run.from).toBe(back >= 0 ? runOf(r, back)!.to : r.home);
    }
    useWorldLog(createNewGame(99).world);
    expect(runOf(r, 7)).toEqual(runOf(r, 7));
  });

  it('rest in the bar, fly their legs (docked at the maker while a runner loads), and dock where they were going', () => {
    const run = firstRun('quickstep', 'trade');
    const r = run.rival;
    expect(rivalWhere(r, run.depart - 1)).toEqual({ kind: 'docked', locationId: run.from });
    expect(rivalsDockedAt(run.from, run.depart - 1)).toContain(r);
    const mid = (run.legs[0]!.start + run.legs[0]!.end) / 2;
    expect(rivalWhere(r, mid)).toMatchObject({ kind: 'flying', leg: run.legs[0], progress: 0.5 });
    expect(rivalWhere(r, run.arrive + 1)).toEqual({ kind: 'docked', locationId: run.to });
    const race = firstRun('halfpenny', 'race');
    const reached = race.legs.findLast((l) => l.to === race.via);
    if (reached) expect(rivalWhere(race.rival, reached.end + 1)).toEqual({ kind: 'docked', locationId: race.via });
  });
});

describe('markets', () => {
  it('feel a trade run: its cargo leaves where it loads and comes in where it sells, fading as the markets recover', () => {
    const run = firstRun('tally', 'trade', 2);
    const c = run.commodity!;
    // Other runs may be fading out at either end: what this one adds is the change across its moments.
    expect(rivalStock(run.from, c, run.depart + 1) - rivalStock(run.from, c, run.depart - 1)).toBeCloseTo(-run.qty, 0);
    expect(rivalStock(run.to, c, run.arrive + 1) - rivalStock(run.to, c, run.arrive - 1)).toBeCloseTo(run.qty, 0);
    const entry = marketEntry(run.to, c)!;
    const ctx = { clock: run.arrive + 1, markets: {} };
    expect(stockNow(run.to, entry, ctx)).toBeGreaterThan(stockNow(run.to, entry, { ...ctx, clock: run.arrive - 1 }));
  });
});

describe('bounty hunters', () => {
  it('take a bounty off a board as they set off; bought back, it is the player’s to take, and the hunter thinks less of them', () => {
    const run = firstRun('lantern', 'hunt');
    const claim = run.claim!;
    const before = pilotAt(claim.giver, claim.at - 1);
    expect(postedContracts(before, claim.giver).some((c) => c.id === claim.contract.id)).toBe(true);
    const s = pilotAt(claim.giver, claim.at + 1);
    expect(boardEpoch(s.clock)).toBe(boardEpoch(claim.at));
    expect(postedContracts(s, claim.giver).some((c) => c.id === claim.contract.id)).toBe(false);
    const held = claimsAt(s, claim.giver).find((c) => c.contract.id === claim.contract.id)!;
    expect(held.rival.id).toBe('lantern');
    expect(held.price).toBe(Math.round(claim.contract.reward * RIVALS.hunt.claim));
    const credits = s.credits;
    expect(buyClaim(s, claim.giver, claim.contract.id).ok).toBe(true);
    expect(s.credits).toBe(credits - held.price);
    expect(postedContracts(s, claim.giver).some((c) => c.id === claim.contract.id)).toBe(true);
    expect(claimsAt(s, claim.giver)).toEqual([]);
    expect(standingWith(s, 'lantern')).toBe(RIVALS.standing.outbid);
  });

  it('never take one the player holds, and a hostile hunter will not sell', () => {
    const run = firstRun('lantern', 'hunt');
    const claim = run.claim!;
    const s = pilotAt(claim.giver, claim.at + 1);
    s.rivals = { lantern: { standing: -50 } };
    expect(buyClaim(s, claim.giver, claim.contract.id).ok).toBe(false);
    s.jobs[claim.contract.id] = { status: 'active', objectiveIndex: 0, acceptedAt: claim.at - 10 };
    expect(claimsAt(s, claim.giver)).toEqual([]);
    expect(claimFor(rival('quickstep'), run.turn)).toBeNull();
  });
});

describe('runners', () => {
  it('race relief to a shortage of their patch, which ends it sooner; beaten to it by the player, they sell nothing', () => {
    const run = firstRun('halfpenny', 'race');
    const e = run.shortage!;
    useWorldLog(createNewGame(3).world);
    expect(reliefEnd(e)).toBeLessThanOrEqual(haulReliefEnd(e));
    if (reliefEnd(e) < Infinity) expect(eventEnd(e)).toBeLessThanOrEqual(run.arrive);
    // The player ends it before the runner gets there: the runner sets off anyway (it left before) and sells nothing.
    const s = pilotAt(e.locationId!, run.depart + 1);
    s.world.ended[e.id] = run.depart + 1;
    expect(rivalStock(e.locationId!, run.commodity!, run.arrive + 1)).toBe(0);
    expect(rivalNews(getLocation(e.locationId!).systemId, run.arrive + 1).some((n) => n.rival.id === 'halfpenny' && /already over/.test(n.text))).toBe(true);
  });
});

describe('standing', () => {
  it('rises with a round a shift (up to a cap), falls with a shot once a flight and a claim bought; hostile, amends', () => {
    const r = rival('tally');
    const s = pilotAt(r.home, turnStart(3));
    expect(rivalTier(s, r.id)).toBe('neutral');
    const credits = s.credits;
    expect(buyRivalRound(s, r).ok).toBe(true);
    expect(s.credits).toBe(credits - PEOPLE.drink);
    expect(standingWith(s, r.id)).toBe(RIVALS.standing.round);
    expect(roundBlock(s, r)).toMatch(/already/);
    for (let i = 0; i < 20; i++) {
      s.clock += PEOPLE.shift * 1_500;
      buyRivalRound(s, r);
    }
    expect(standingWith(s, r.id)).toBe(RIVALS.standing.roundsUpTo);
    expect(rivalTier(s, r.id)).toBe('friendly');
    expect(rivalGreeting(s, r).tip).toBeTruthy();
    expect(rivalShot(s, r, 1)).toBeTruthy();
    expect(rivalShot(s, r, 1)).toBeNull();
    expect(standingWith(s, r.id)).toBe(RIVALS.standing.roundsUpTo + RIVALS.standing.shot);
    rivalShot(s, r, 2);
    rivalShot(s, r, 3);
    expect(rivalTier(s, r.id)).toBe('hostile');
    expect(buyRivalRound(s, r).ok).toBe(false);
    expect(makeAmends(s, r).ok).toBe(true);
    expect(standingWith(s, r.id)).toBe(RIVALS.standing.amendsTo);
    expect(rivalTier(s, r.id)).toBe('wary');
  });
});

describe('knocked out', () => {
  it('a rival whose ship the player destroys is out, its run lost, in the News, then back at work from home', () => {
    const run = firstRun('quickstep', 'trade', 3);
    const r = run.rival;
    const leg = run.legs[0]!;
    const s = pilotAt(run.from, (leg.start + leg.end) / 2);
    s.location = { ...s.location, systemId: leg.systemId, dockedAt: null };
    expect(rivalDestroyed(s, r, leg.systemId)).toBeTruthy();
    expect(standingWith(s, r.id)).toBe(RIVALS.standing.destroyed);
    expect(rivalWhere(r, s.clock + 10)).toMatchObject({ kind: 'down' });
    expect(runOf(r, run.turn)!.lostAt).toBe(s.clock);
    expect(rivalStock(run.to, run.commodity!, run.arrive + 1)).toBeLessThanOrEqual(0);
    expect(rivalNews(leg.systemId, s.clock + 10).some((n) => n.rival.id === r.id && /destroyed/.test(n.text))).toBe(true);
    const back = turnOf(s.clock + RIVALS.downSeconds) + 1;
    expect(runOf(r, back - 1)).toBeNull();
    let n = back;
    while (!runOf(r, n)) n++;
    expect(runOf(r, n)!.from).toBe(r.home);
    assertValidState(s);
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

/** A flight in a system at a moment, recording what the scene tells the game about rivals and crimes. */
function flightAt(state: GameState, systemId: SystemId, clock: number) {
  installCanvasStub();
  state.location = { ...state.location, systemId, dockedAt: null, flight: null };
  state.clock = clock;
  useWorldLog(state.world);
  const rivals: unknown[][] = [];
  const crimes: unknown[][] = [];
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
      onCrime: (...a) => crimes.push(a),
      onMessage: nothing,
      onComm: nothing,
      onRival: (...a) => rivals.push(a),
    },
    traffic: { plan: { traders: 0, patrolWings: 0, wingSize: 2, packs: null }, owner: null },
  });
  flight.start({ kind: 'arrival' });
  const run = (seconds: number) => {
    for (let t = 0; t < seconds; t += 1 / 20) {
      state.clock += 1 / 20;
      flight.update(1 / 20, emptyInput());
    }
  };
  const npcs = () => flight.debugNpcs().filter((n) => n.rival);
  return { flight, rivals, crimes, run, npcs };
}

/** A rival's run with a leg flown in a system matching `where`, and a moment well into that leg. */
function legIn(where: (systemId: SystemId) => boolean, ids = ROSTER.map((r) => r.id)): { run: RivalRun; systemId: SystemId; at: number } {
  for (let n = 0; n < 200; n++) {
    for (const id of ids) {
      const run = runOf(rival(id), n);
      const leg = run?.legs.find((l) => where(l.systemId) && l.kind !== 'local' && l.end - l.start >= 300);
      if (run && leg) return { run, systemId: leg.systemId, at: leg.start + (leg.end - leg.start) * 0.4 };
    }
  }
  throw new Error('no such leg');
}

describe('rivals in flight', () => {
  it('fly their legs where the player is, named, with what they carry; a shot costs standing once a flight, and destroyed, they are knocked out', () => {
    const { run, systemId, at } = legIn(() => true, ['quickstep', 'tally']);
    const s = pilotAt(run.from, at);
    const f = flightAt(s, systemId, at);
    f.run(0.5);
    const n = f.npcs()[0]!;
    expect(n).toBeDefined();
    expect(n.rival).toBe(run.rival.id);
    expect(n.name).toBe(`${run.rival.first} “${run.rival.nick}” ${run.rival.last}`);
    expect(n.subtitle).toMatch(new RegExp(`^Rival · ${run.rival.shipName} · `));
    expect(n.side).toBe('lawful');
    expect(f.rivals[0]).toEqual([run.rival.id, 'met', { hostile: false }]);
    expect(f.flight.debugDestroy(n.id, true)).toBe(true);
    expect(f.rivals.map((x) => x[1])).toEqual(['met', 'shot', 'destroyed']);
    expect(f.rivals.at(-1)).toEqual([run.rival.id, 'destroyed', { by: 'player' }]);
    expect(f.crimes.map((c) => c[0])).toEqual(['attack', 'destroy']);
  });

  it('come for the player in lawless space when hostile, as raiders that pay no bounty', () => {
    const lawless = (sys: SystemId) => (WORLD.profiles.get(sys)?.security ?? 1) < RIVALS.hostile.lawless;
    const { run, systemId, at } = legIn(lawless);
    const s = pilotAt(run.from, at);
    s.rivals = { [run.rival.id]: { standing: -60 } };
    const f = flightAt(s, systemId, at);
    f.run(0.5);
    const n = f.npcs()[0]!;
    expect(n.side).toBe('raider');
    expect(n.subtitle).toMatch(/out for you$/);
    expect(f.rivals[0]).toEqual([run.rival.id, 'met', { hostile: true }]);
    f.flight.debugDestroy(n.id, true);
    expect(f.crimes).toEqual([]);
  });
});

describe('saves', () => {
  it('keep standing, knock-outs and claims bought, and refuse damaged ones', () => {
    const s = pilotAt('sirius-platform', turnStart(2));
    s.rivals = { quickstep: { standing: 12, round: 3, shot: 40 } };
    s.world.rivals = { down: { tally: { at: 100, systemId: 'sirius' } }, bought: { 'c.sirius-platform.4.1': 50 } };
    assertValidState(s);
    const bad = (patch: (x: GameState) => void) => {
      const x = structuredClone(s);
      patch(x);
      return () => assertValidState(x);
    };
    expect(bad((x) => (x.rivals!.quickstep!.standing = 400))).toThrow(/rival/);
    expect(bad((x) => (x.rivals = { nobody: { standing: 0 } }))).toThrow(/rival/);
    expect(bad((x) => (x.world.rivals!.down.tally!.systemId = 'nowhere' as never))).toThrow(/world/);
    expect(bad((x) => (x.world.rivals!.bought['c.x'] = Number.NaN))).toThrow(/world/);
  });
});
