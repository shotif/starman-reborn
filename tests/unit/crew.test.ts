import * as THREE from 'three';
import { afterEach, describe, expect, it } from 'vitest';
import type { AudioEngine } from '../../src/audio/AudioEngine.ts';
import { dockAt, rescueAfterDefeat, routeFee } from '../../src/app/rules.ts';
import { defaultSettings } from '../../src/app/settings.ts';
import { assertValidState } from '../../src/app/save/migrate.ts';
import { createNewGame, markVisited, type CrewMember, type GameState } from '../../src/app/state.ts';
import { CREW_RADIO } from '../../src/content/crew/lines.ts';
import { CREW, type CrewRole } from '../../src/content/crew/rules.ts';
import { ALL_LOCATIONS, getLocation, WORLD } from '../../src/data/systems.ts';
import { cargoCount } from '../../src/economy/cargo.ts';
import { aboardOf, buyCrewRound, crewEffects, crewOffers, crewShipLost, handsAt, hireCrew, hurtCrew, letGo, settleCrew, takeFavour, treatCrew, treatQuote, wagesOwed } from '../../src/economy/crew.ts';
import { crewDeed } from '../../src/economy/crewDeeds.ts';
import { validateCrew } from '../../src/economy/crewGuards.ts';
import { quartersOf } from '../../src/economy/crewQuarters.ts';
import { shipOffers } from '../../src/economy/equipment.ts';
import { useWorldLog } from '../../src/economy/events.ts';
import { switchShip } from '../../src/economy/fleet.ts';
import { newShipState } from '../../src/economy/loadout.ts';
import { berths } from '../../src/economy/passengers.ts';
import { emptyInput } from '../../src/flight/input/types.ts';
import type { Route } from '../../src/galaxy/routing.ts';
import { FlightSession } from '../../src/world/FlightSession.ts';
import { SystemScene } from '../../src/world/SystemScene.ts';
import { sceneDefFor } from '../../src/world/systems/index.ts';

afterEach(() => useWorldLog(null));

const HOUR = 3_600;

function pilotAt(locationId: string, clock = 10_000, seed = 23): GameState {
  const s = createNewGame(seed);
  s.jobs.lifeline = { status: 'complete', objectiveIndex: 4, acceptedAt: 0, completedAt: 1 };
  s.flags.clearance = true;
  s.credits = 50_000;
  s.clock = clock;
  const loc = getLocation(locationId);
  s.location = { systemId: loc.systemId, dockedAt: locationId, flight: null, lastDockId: locationId };
  markVisited(s, loc.systemId, locationId);
  useWorldLog(s.world);
  return s;
}

/** Someone of the crew, put aboard as hired now. */
function member(s: GameState, role: CrewRole, more: Partial<CrewMember> = {}): CrewMember {
  const a = aboardOf(s);
  const m: CrewMember = { id: `crew.test.${role}`, name: `Test ${role}`, role, heart: 'soft-hearted', grade: 2, hired: s.clock, paidTo: s.clock, morale: CREW.morale.start, ...more };
  a.members.push(m);
  return m;
}

/** The next dock, `seconds` of flight on (at the same station unless one is given). */
function nextDock(s: GameState, seconds: number, at = s.location.dockedAt!) {
  s.clock += seconds;
  s.location.systemId = getLocation(at).systemId;
  return dockAt(s, at);
}

const station = (type: string) => ALL_LOCATIONS.find((l) => l.status === 'functional' && l.stationType === type)!;
/** An open shipyard: two engineers at its tables, ships for sale, a medic. */
const YARDS = station('shipyard').id;

describe('your crew: the rules', () => {
  it('pass their guardrails', { timeout: 60_000 }, () => {
    expect(validateCrew()).toEqual([]);
  });

  it('catch broken rules and words', { timeout: 60_000 }, () => {
    const subjects = (rules: unknown) => validateCrew(rules as typeof CREW).map((i) => i.subject);
    expect(subjects({ ...CREW, effects: { ...CREW.effects, gunner: { ...CREW.effects.gunner, damage: [0.1, 0.08, 0.12] } } })).toContain('gunner.damage');
    expect(subjects({ ...CREW, wage: { 1: 30, 2: 45, 3: 90 } })).toContain('wage');
    expect(subjects({ ...CREW, hearts: { ...CREW.hearts, 'ex-patrol': { likes: ['raider'], hates: ['raider'] } } })).toContain('ex-patrol');
    expect(subjects({ ...CREW, quarters: { ...CREW.quarters, 'light-fighter': 2 } })).toContain('quarters');
    expect(subjects({ ...CREW, effects: { ...CREW.effects, gunner: { ...CREW.effects.gunner, damage: [0.1, 0.15, 0.2] } } })).toContain('bonus');
    const lines = CREW_RADIO.hurt as string[];
    lines.push('She took a hit in 3 places.');
    try {
      const words = validateCrew().filter((i) => i.rule === 'lines').map((i) => i.message);
      expect(words.some((m) => m.includes('number'))).toBe(true);
      expect(words.some((m) => m.includes('he or she'))).toBe(true);
    } finally {
      lines.pop();
    }
  });
});

describe('hands looking for a berth', () => {
  it('sit at a bar by its kind, the same for every pilot within a shift, and none for a wanted pilot', () => {
    expect(handsAt(YARDS, 10_000).map((o) => o.role)).toEqual(['engineer', 'engineer']);
    expect(handsAt(station('military-base').id, 10_000).every((o) => o.role === 'gunner')).toBe(true);
    expect(handsAt(station('relay').id, 10_000).map((o) => o.role)).toEqual(['navigator']);
    expect(handsAt(station('agri-station').id, 10_000)).toEqual([]);
    // A station not yet open has nobody at its tables.
    expect(handsAt('ganymede-yards', 10_000)).toEqual([]);
    expect(handsAt(YARDS, 10_000)).toEqual(handsAt(YARDS, 10_100));
    expect(crewOffers(pilotAt(YARDS, 10_000, 1), YARDS)).toEqual(crewOffers(pilotAt(YARDS, 10_000, 99), YARDS));
    const hunted = pilotAt(YARDS);
    hunted.law.fines[getLocation(YARDS).factionId!] = 99_999;
    expect(crewOffers(hunted, YARDS)).toEqual([]);
  });

  it('sign on for two hours’ wages: one of each role, as many as the ship has quarters for', () => {
    const s = pilotAt(YARDS);
    const [eng] = crewOffers(s, YARDS);
    const before = s.credits;
    expect(hireCrew(s, YARDS, eng!.id)).toMatchObject({ ok: true });
    expect(s.credits).toBe(before - eng!.wage * 2);
    expect(aboardOf(s).members).toMatchObject([{ id: eng!.id, role: 'engineer', morale: CREW.morale.start, hired: s.clock, paidTo: s.clock }]);
    // Hired, they leave the tables; another engineer is refused.
    expect(crewOffers(s, YARDS).some((o) => o.id === eng!.id)).toBe(false);
    const other = crewOffers(s, YARDS)[0]!;
    expect(hireCrew(s, YARDS, other.id).message).toMatch(/engineer aboard already/);
    // The courier has quarters for two.
    expect(quartersOf(s.ship.model)).toBe(2);
    member(s, 'gunner');
    const relay = station('relay');
    const nav = handsAt(relay.id, s.clock)[0]!;
    s.location = { ...s.location, systemId: relay.systemId, dockedAt: relay.id };
    expect(hireCrew(s, relay.id, nav.id).message).toMatch(/No quarters free/);
    // Passengers' berths are their own.
    expect(berths(s)).toEqual(berths(pilotAt(YARDS)));
  });

  it('need quarters in any ship the pilot takes', () => {
    const s = pilotAt(YARDS);
    member(s, 'engineer');
    member(s, 'gunner');
    const offers = shipOffers(s, YARDS);
    const fighter = offers.find((o) => o.model.class === 'light-fighter' || o.model.class === 'heavy-fighter');
    const big = offers.find((o) => o.model.class === 'freighter' || o.model.class === 'gunship');
    expect(fighter || big).toBeTruthy();
    if (fighter) expect(fighter.blocked).toMatch(/2 crew need quarters/);
    if (big) expect(big.blocked ?? '').not.toMatch(/quarters/);
    s.fleet.ships.push({ id: 'ship.2', ship: newShipState('ship.light-fighter.1.halden'), locationId: YARDS });
    expect(switchShip(s, 'ship.2')).toMatchObject({ ok: false, message: expect.stringMatching(/need quarters/) });
  });
});

describe('what they do aboard', () => {
  it('a bonus by grade, scaled by morale; nothing while hurt; the navigator’s cheaper jumps', () => {
    const s = pilotAt(YARDS);
    const eng = member(s, 'engineer', { grade: 2 });
    expect(crewEffects(s)).toMatchObject({ mend: 5 / 100 / 60, shieldRegen: 0.09, gunDamage: 0, fee: 0 });
    eng.morale = 20;
    expect(crewEffects(s).shieldRegen).toBeCloseTo(0.045);
    eng.morale = 90;
    expect(crewEffects(s).shieldRegen).toBeCloseTo(0.1125);
    hurtCrew(s, 'engineer');
    expect(crewEffects(s)).toMatchObject({ mend: 0, shieldRegen: 0 });
    member(s, 'navigator', { grade: 3 });
    const route = { from: 'sol', to: 'alpha-centauri', totalFee: 1_000, hops: [{}], path: ['sol', 'alpha-centauri'] } as unknown as Route;
    expect(routeFee(s, route)).toBe(840);
  });
});

describe('morale, wages and notice', () => {
  it('each heart weighs the deeds since the last dock, at most so much a dock; rest; a round once a shift', () => {
    const s = pilotAt(YARDS);
    const soft = member(s, 'engineer', { heart: 'soft-hearted' });
    const bender = member(s, 'gunner', { heart: 'rule-bender', id: 'crew.test.b' });
    crewDeed(s, 'rescue');
    crewDeed(s, 'crime', 3);
    nextDock(s, 20 * 60);
    // Soft-hearted: +6 for the rescue, −24 for the attacks, held to −15; rested +3.
    expect(soft.morale).toBe(CREW.morale.start - 15 + 3);
    // The rule-bender hates attacks too.
    expect(bender.morale).toBe(CREW.morale.start - 15 + 3);
    expect(aboardOf(s).deeds).toEqual({});
    expect(buyCrewRound(s).ok).toBe(true);
    expect(soft.morale).toBe(CREW.morale.start - 15 + 3 + 5);
    expect(buyCrewRound(s)).toMatchObject({ ok: false, message: expect.stringMatching(/this shift already/) });
  });

  it('wages are paid at each dock for the clock flown; an unpaid hand is owed, and unhappy', () => {
    const s = pilotAt(YARDS);
    const m = member(s, 'engineer', { grade: 2 });
    const before = s.credits;
    const out = nextDock(s, 2 * HOUR);
    expect(before - s.credits).toBe(90);
    expect(out.crew.notes.some((n) => n.text === 'Crew wages: 90 cr.')).toBe(true);
    expect(m.paidTo).toBe(s.clock);
    s.credits = 0;
    nextDock(s, HOUR);
    expect(m.paidTo).toBe(s.clock - HOUR);
    expect(wagesOwed(s)).toBe(45);
    expect(m.morale).toBeLessThan(CREW.morale.start - 20);
  });

  it('unhappy at a dock, they give notice; still unhappy at the next, they leave; happier, they stay', () => {
    const s = pilotAt(YARDS);
    const m = member(s, 'engineer', { morale: 20 });
    let out = nextDock(s, 5 * 60);
    expect(m.notice).toBe(s.clock);
    expect(out.crew.notes.map((n) => n.text).join(' ')).toMatch(/has given notice/);
    nextDock(s, 5 * 60);
    expect(aboardOf(s).members).toEqual([]);
    expect(aboardOf(s).former).toMatchObject([{ name: m.name, why: 'unhappy', locationId: YARDS }]);
    const t = pilotAt(YARDS);
    const n = member(t, 'gunner', { morale: 20 });
    nextDock(t, 5 * 60);
    n.morale = 60;
    out = nextDock(t, 5 * 60);
    expect(n.notice).toBeUndefined();
    expect(out.crew.notes.some((x) => /taken back their notice/.test(x.text))).toBe(true);
    // Letting someone go: paid to now, and remembered.
    expect(letGo(t, n.id).ok).toBe(true);
    expect(aboardOf(t).former!.at(-1)).toMatchObject({ why: 'let-go' });
  });

  it('settling twice at one dock changes nothing', () => {
    const s = pilotAt(YARDS);
    member(s, 'engineer', { morale: 30 });
    crewDeed(s, 'rescue', 2);
    nextDock(s, HOUR);
    const snap = structuredClone(s.aboard);
    const credits = s.credits;
    expect(settleCrew(s, YARDS)).toEqual({ notes: [], jobs: [] });
    expect(s.aboard).toEqual(snap);
    expect(s.credits).toBe(credits);
  });
});

describe('hurt', () => {
  it('a hurt hand mends with time or a medic; untreated docks and a lost ship weigh on them', () => {
    const s = pilotAt(YARDS);
    const m = member(s, 'gunner');
    expect(hurtCrew(s, 'gunner')).toBe(m);
    expect(hurtCrew(s, 'gunner')).toBeNull();
    expect(m.morale).toBe(CREW.morale.start + CREW.morale.hurt);
    nextDock(s, 5 * 60);
    expect(m.hurt?.docks).toBe(1);
    expect(treatQuote(s, YARDS)).toBe(CREW.hurt.treat);
    const morale = m.morale;
    expect(treatCrew(s, YARDS).ok).toBe(true);
    expect(m.hurt).toBeUndefined();
    expect(m.morale).toBe(morale + CREW.morale.treated);
    hurtCrew(s, 'gunner');
    const out = nextDock(s, CREW.hurt.mend + 60);
    expect(m.hurt).toBeUndefined();
    expect(out.crew.notes.some((n) => /is well again/.test(n.text))).toBe(true);
    // The ship lost: everyone hurt and shaken.
    const t = pilotAt(YARDS);
    const a = member(t, 'engineer');
    const b = member(t, 'navigator');
    t.location.dockedAt = null;
    rescueAfterDefeat(t);
    for (const x of [a, b]) expect(x).toMatchObject({ morale: CREW.morale.start + CREW.morale.shipLost, hurt: { docks: 0 } });
    expect(crewShipLost(pilotAt(YARDS))).toEqual([]);
  });
});

describe('their stories', () => {
  it('soft-hearted: two rescues bring the tale, an hour on the favour, a letter carried brings a grade', () => {
    const s = pilotAt(YARDS);
    const m = member(s, 'engineer', { heart: 'soft-hearted', grade: 2 });
    crewDeed(s, 'rescue', 2);
    let out = nextDock(s, 10 * 60);
    expect(m.story?.told).toBe(s.clock);
    expect(out.crew.notes.some((n) => /story to tell/.test(n.text))).toBe(true);
    nextDock(s, CREW.stories.favourAfter);
    expect(m.story?.favour).toMatchObject({ asked: s.clock, until: s.clock + CREW.stories.take });
    const to = m.story!.favour!.to;
    const taken = takeFavour(s, m.id);
    expect(taken.ok).toBe(true);
    const job = s.contracts[taken.jobId!]!;
    expect(job).toMatchObject({ contract: { kind: 'parcel', crew: m.id }, objectives: [{ kind: 'visit', locationId: to }] });
    const owner = getLocation(to).factionId;
    const standing = owner ? s.reputation[owner] : 0;
    out = nextDock(s, HOUR, to);
    expect(s.jobs[job.id]?.status).toBe('complete');
    expect(m.story?.ended?.how).toBe('done');
    expect(m.grade).toBe(3);
    if (owner) expect(s.reputation[owner]).toBe(standing + 5);
    expect(out.crew.notes.map((n) => n.text).join(' ')).toMatch(/favour is done.*now a veteran engineer/);
  });

  it('rule-bender: a sealed crate for a free port, loaded when taken; refused with no room in the hold', () => {
    const s = pilotAt(YARDS);
    const m = member(s, 'gunner', { heart: 'rule-bender' });
    m.story = { seen: 2, told: s.clock - 2 * HOUR };
    nextDock(s, 10 * 60);
    expect(m.story.favour).toBeDefined();
    expect(getLocation(m.story.favour!.to).stationType).toBe('freeport');
    s.ship.cargo = { metals: 20 };
    expect(takeFavour(s, m.id)).toMatchObject({ ok: false, message: expect.stringMatching(/No room in the hold/) });
    s.ship.cargo = {};
    const taken = takeFavour(s, m.id);
    expect(s.contracts[taken.jobId!]).toMatchObject({ contract: { kind: 'smuggle', crew: m.id }, objectives: [{ kind: 'deliver', commodity: 'spoofers', qty: 2 }] });
    expect(cargoCount(s.ship.cargo, 'spoofers')).toBe(2);
  });

  it('ex-patrol: three raiders down bring the tale; the favour is a pack in a lawless system near by', () => {
    const s = pilotAt(YARDS);
    const m = member(s, 'gunner', { heart: 'ex-patrol' });
    s.stats.kills += 3;
    nextDock(s, 10 * 60);
    expect(m.story?.told).toBe(s.clock);
    nextDock(s, CREW.stories.favourAfter);
    const f = m.story!.favour!;
    expect(WORLD.profiles.get(f.systemId!)!.security).toBeLessThan(0.35);
    const taken = takeFavour(s, m.id);
    expect(s.contracts[taken.jobId!]).toMatchObject({ contract: { kind: 'bounty', crew: m.id }, objectives: [{ kind: 'bounty', systemId: f.systemId, count: 3, level: 2 }] });
  });

  it('a favour left untaken lapses; one taken and not done in time fails', () => {
    const s = pilotAt(YARDS);
    const m = member(s, 'engineer', { story: { seen: 2, told: 0 } });
    nextDock(s, 10 * 60);
    expect(m.story?.favour).toBeDefined();
    nextDock(s, CREW.stories.take + 60);
    expect(m.story?.ended?.how).toBe('lapsed');
    const t = pilotAt(YARDS);
    const n = member(t, 'engineer', { story: { seen: 2, told: 0 } });
    nextDock(t, 10 * 60);
    const taken = takeFavour(t, n.id);
    nextDock(t, CREW.stories.do + 60);
    expect(t.jobs[taken.jobId!]?.status).toBe('failed');
    expect(n.story?.ended?.how).toBe('failed');
  });
});

describe('saves', () => {
  it('keep the crew and refuse damaged records', () => {
    const s = pilotAt(YARDS);
    member(s, 'engineer', { hurt: { at: 1, until: 9_000, docks: 1 }, notice: 5, story: { seen: 2, told: 3, favour: { asked: 4, to: 'earth-port', until: 99 } } });
    member(s, 'gunner');
    aboardOf(s).former = [{ name: 'Gone', role: 'navigator', at: 2, locationId: YARDS, why: 'let-go' }];
    aboardOf(s).deeds = { rescue: 2 };
    assertValidState(s);
    const bad = (patch: (x: GameState) => void) => {
      const x = structuredClone(s);
      patch(x);
      return () => assertValidState(x);
    };
    expect(bad((x) => (x.aboard!.members[1]!.role = 'engineer'))).toThrow(/crew member/);
    expect(bad((x) => (x.aboard!.members[0]!.morale = 120))).toThrow(/crew member/);
    expect(bad((x) => (x.aboard!.members[0]!.heart = 'cruel' as never))).toThrow(/crew member/);
    expect(bad((x) => (x.aboard!.members[0]!.story!.favour!.to = 'nowhere'))).toThrow(/crew story/);
    expect(bad((x) => (x.aboard!.deeds = { murder: 1 } as never))).toThrow(/crew deeds/);
    expect(bad((x) => x.aboard!.members.push({ ...x.aboard!.members[0]!, id: 'a', role: 'navigator' }, { ...x.aboard!.members[0]!, id: 'b', role: 'navigator' }))).toThrow(/crew/);
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

/** A flight in quiet space (no traffic) with the crew given aboard. */
function crewFlight(crew: Partial<CrewMember>[]) {
  installCanvasStub();
  const s = pilotAt('earth-port');
  for (const c of crew) member(s, c.role!, c);
  s.location = { ...s.location, dockedAt: null, flight: null };
  const comms: [string, string][] = [];
  const nothing = () => {};
  const flight = new FlightSession({
    system: new SystemScene(sceneDefFor('sol'), { quality: 'low', reducedMotion: true }),
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
      onComm: (who, text) => comms.push([who, text]),
    },
    traffic: { plan: { traders: 0, patrolWings: 0, wingSize: 2, packs: null }, owner: 'sta' },
  });
  flight.start({ kind: 'arrival' });
  const run = (seconds: number) => {
    for (let t = 0; t < seconds; t += 1 / 20) {
      s.clock += 1 / 20;
      flight.update(1 / 20, emptyInput());
    }
  };
  const raw = flight as unknown as { guns: { profile: { damage: number } }[]; lockTimeNeeded(): number; scanner(): number; maybeHurtCrew(role: CrewRole): void; playerDurability: { shieldRegen: number } };
  return { s, flight, run, raw, comms };
}

describe('in flight', () => {
  it('a gunner’s guns hit harder and lock sooner; a navigator’s scans reach further; an engineer’s shield recharges faster', () => {
    const bare = crewFlight([]);
    const crew = crewFlight([{ role: 'gunner', grade: 3, morale: 90 }, { role: 'navigator', grade: 1 }, { role: 'engineer', grade: 2 }]);
    expect(crew.raw.guns[0]!.profile.damage / bare.raw.guns[0]!.profile.damage).toBeCloseTo(1 + 0.12 * 1.25);
    expect(bare.raw.lockTimeNeeded()).toBeGreaterThan(0);
    expect(crew.raw.lockTimeNeeded() / bare.raw.lockTimeNeeded()).toBeCloseTo(1 - 0.4 * 1.25);
    expect(crew.raw.scanner() / bare.raw.scanner()).toBeCloseTo(1.1);
    expect(crew.raw.playerDurability.shieldRegen / bare.raw.playerDurability.shieldRegen).toBeCloseTo(1.09);
  });

  it('an engineer mends damaged systems down to the floor when no hostile is near, and says so', { timeout: 60_000 }, () => {
    const f = crewFlight([{ role: 'engineer', grade: 3, name: 'Kirra Nyberg' }]);
    f.s.ship.systems = { engines: 0.6, guns: 0.1, shields: 0 };
    f.run(60);
    // Seven points a minute: from 60% to 53%.
    expect(f.s.ship.systems.engines).toBeCloseTo(0.53, 2);
    expect(f.s.ship.systems.guns).toBe(0.1);
    f.run(6 * 60);
    expect(f.s.ship.systems.engines).toBe(CREW.effects.engineer.floor / 100);
    expect(f.comms.filter(([who]) => who === 'Kirra Nyberg').map(([, t]) => CREW_RADIO.mended.includes(t))).toEqual([true]);
  });

  it('a hit hurts whoever works it at the rules’ rate, from the crew’s own luck', () => {
    const f = crewFlight([{ role: 'gunner' }]);
    let hurt = 0;
    for (let i = 0; i < 400; i++) {
      f.raw.maybeHurtCrew('gunner');
      const m = f.s.aboard!.members[0]!;
      if (m.hurt) {
        hurt++;
        delete m.hurt;
        m.morale = 55;
      }
    }
    expect(hurt / 400).toBeGreaterThan(CREW.hurt.odds.gunner - 0.08);
    expect(hurt / 400).toBeLessThan(CREW.hurt.odds.gunner + 0.08);
    // Nobody of that role aboard: nobody hurt.
    f.raw.maybeHurtCrew('navigator');
    expect(f.s.aboard!.members).toHaveLength(1);
  });
});
