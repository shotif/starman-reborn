import { describe, expect, it } from 'vitest';
import { migrateSave, SaveFormatError } from '../../src/app/save/migrate.ts';
import { createNewGame, type GameState } from '../../src/app/state.ts';
import { dockAt } from '../../src/app/rules.ts';
import { CONTRACTS } from '../../src/content/contracts/rules.ts';
import { COMMODITIES } from '../../src/content/economy/goods.ts';
import { LAW } from '../../src/content/law/rules.ts';
import { formatIssues } from '../../src/content/validate.ts';
import { ALL_LOCATIONS, getLocation, WORLD } from '../../src/data/systems.ts';
import { cargoCount } from '../../src/economy/cargo.ts';
import { boardFor, postedContracts } from '../../src/economy/contracts.ts';
import { repairQuote } from '../../src/economy/equipment.ts';
import { acceptJob, countPiracy, deliverJob, jobLockReason, jobsAt, type JobDef } from '../../src/economy/jobs.ts';
import { commitCrime, customsScan, dockAccess, huntedBy, lawIn, pardonCost, payFines, scansOnDocking, wakeFriendly } from '../../src/economy/law.ts';
import { validateLaw } from '../../src/economy/lawGuards.ts';

/** The law and the outlaw path (docs/PROCGEN.md §12). */

const lawfulSystem = WORLD.profiles.get('sol')!.owner === 'sta' ? 'sol' : 'barnard';
const unclaimed = [...WORLD.profiles].find(([, p]) => p.owner === null)![0];
const den = ALL_LOCATIONS.find((l) => l.stationType === 'pirate-den' && l.status === 'functional')!;
const staStation = ALL_LOCATIONS.find((l) => l.factionId === 'sta' && l.dockable !== false && l.services.includes('repair') && l.stationType)!;

function pilot(): GameState {
  const s = createNewGame(21);
  s.credits = 20_000;
  s.ship.model = 'ship.freighter.3.eridani';
  s.ship.cargo = {};
  s.jobs.lifeline = { status: 'complete', objectiveIndex: 4, acceptedAt: 0, completedAt: 1 };
  return s;
}

function dockedAt(s: GameState, locationId: string): GameState {
  const loc = getLocation(locationId);
  s.location = { systemId: loc.systemId, dockedAt: locationId, flight: null, lastDockId: locationId };
  return s;
}

describe('the law', () => {
  it('passes its guardrails: no dead ends, smuggling possible, dens worth reaching, no crime in the story', () => {
    expect(formatIssues(validateLaw())).toBe('');
  });

  it('fines crimes against lawful ships and remembers them; the Wake approves of a kill', () => {
    const s = pilot();
    const wake = s.reputation['hollow-wake'];
    const attack = commitCrime(s, 'attack', 'sta', lawfulSystem);
    expect(attack).toMatchObject({ faction: 'sta', fine: LAW.crimes.attack.fine });
    expect(s.law.fines.sta).toBe(LAW.crimes.attack.fine);
    expect(s.reputation.sta).toBe(LAW.crimes.attack.standing);
    commitCrime(s, 'destroy', 'sta', lawfulSystem);
    expect(s.law.fines.sta).toBe(LAW.crimes.attack.fine + LAW.crimes.destroy.fine);
    expect(s.reputation['hollow-wake']).toBe(wake + LAW.crimes.destroy.wake);
    expect(huntedBy(s, 'sta')).toBe(true);
    expect(huntedBy(s, 'frontier')).toBe(false);
    // An independent hauler's loss in unclaimed space goes unpunished.
    const t = pilot();
    expect(commitCrime(t, 'destroy', 'independent', unclaimed)).toMatchObject({ faction: null, fine: 0 });
    expect(t.law.fines).toEqual({});
  });

  it('hostile standing alone makes patrols hunt you', () => {
    const s = pilot();
    s.reputation.frontier = -40;
    expect(huntedBy(s, 'frontier')).toBe(true);
  });

  it('confiscates contraband at a scan and fines it; a clean hold passes', () => {
    const s = pilot();
    expect(customsScan(s, 'sta')).toMatchObject({ found: [], fine: 0 });
    s.ship.cargo = { stims: 5, food: 3 };
    const r = customsScan(s, 'sta');
    expect(r.found).toEqual([{ commodity: 'stims', qty: 5 }]);
    expect(r.fine).toBe(5 * COMMODITIES.stims.basePrice * LAW.crimes.contraband.fineFactor);
    expect(cargoCount(s.ship.cargo, 'stims')).toBe(0);
    expect(cargoCount(s.ship.cargo, 'food')).toBe(3);
    expect(s.law.fines.sta).toBe(r.fine);
  });

  it('a pardon: paying the fines (and for the bad blood) clears the hunt and lifts standing to Wary at worst', () => {
    const s = pilot();
    s.reputation.sta = -60;
    s.law.fines.sta = 1_500;
    const cost = pardonCost(s, 'sta');
    expect(cost).toBe(1_500 + (LAW.pardonFloor + 60) * LAW.pardonPerStanding);
    s.credits = 1_000;
    expect(payFines(s, 'sta').ok).toBe(false);
    s.credits = 5_000;
    expect(payFines(s, 'sta')).toMatchObject({ ok: true });
    expect(s.credits).toBe(5_000 - cost);
    expect(s.law.fines.sta).toBeUndefined();
    expect(s.reputation.sta).toBe(LAW.pardonFloor);
    expect(huntedBy(s, 'sta')).toBe(false);
    // Hostile without fines: a pardon still has a price, so there is always a way back.
    const t = pilot();
    t.reputation.frontier = -45;
    expect(pardonCost(t, 'frontier')).toBe((LAW.pardonFloor + 45) * LAW.pardonPerStanding);
    expect(payFines(t, 'frontier').ok).toBe(true);
    expect(huntedBy(t, 'frontier')).toBe(false);
    expect(pardonCost(t, 'frontier')).toBe(0);
  });

  it('hunted pilots get emergency docking only: repairs at a surcharge, no contracts; dens only open to Wake friends', () => {
    const s = dockedAt(pilot(), staStation.id);
    s.ship.hull = 10;
    const usual = repairQuote(s, staStation.id).cost;
    expect(dockAccess(s, staStation.id)).toBe('full');
    s.law.fines.sta = 500;
    expect(dockAccess(s, staStation.id)).toBe('emergency');
    expect(repairQuote(s, staStation.id).cost).toBeGreaterThan(usual);
    expect(postedContracts(s, staStation.id)).toEqual([]);
    expect(dockAccess(s, den.id)).toBe('refused');
    s.reputation['hollow-wake'] = LAW.wakeFriendly;
    expect(wakeFriendly(s)).toBe(true);
    expect(dockAccess(s, den.id)).toBe('full');
    expect(scansOnDocking(den.id)).toBeNull();
  });

  it('a wary faction trusts you with easy work only', () => {
    const s = dockedAt(pilot(), staStation.id);
    let hard: JobDef | undefined;
    for (let epoch = 0; epoch < 40 && !hard; epoch++) hard = boardFor(staStation.id, epoch).find((c) => c.difficulty === 2 && c.factionId === 'sta');
    s.reputation.sta = -10;
    expect(jobLockReason(s, hard!)).toMatch(/wary/);
    s.reputation.sta = 0;
    expect(jobLockReason(s, hard!) ?? '').not.toMatch(/wary/);
  });
});

describe('the outlaw path', () => {
  /** A smuggling run posted at a free port. */
  function smuggling(): { job: JobDef; epoch: number } {
    for (let epoch = 0; epoch < 60; epoch++) {
      for (const st of WORLD.stations.filter((x) => x.type === 'freeport')) {
        const job = boardFor(st.id, epoch).find((c) => c.contract?.kind === 'smuggle' && !c.requires);
        if (job) return { job, epoch };
      }
    }
    throw new Error('no smuggling run posted');
  }

  it('smuggling: contraband loaded against a deposit, delivered into claimed space for pay and the Wake’s regard', () => {
    const { job, epoch } = smuggling();
    const s = dockedAt(pilot(), job.giverLocationId);
    s.clock = epoch * CONTRACTS.epochSeconds;
    const o = job.objectives[0]!;
    if (o.kind !== 'deliver') throw new Error('smuggling delivers');
    expect(LAW.contraband).toContain(o.commodity);
    expect(lawIn(getLocation(o.locationId).systemId)).not.toBeNull();
    expect(scansOnDocking(o.locationId)).toBeNull();
    const wake = s.reputation['hollow-wake'];
    expect(acceptJob(s, job.id)).toMatchObject({ ok: true });
    expect(cargoCount(s.ship.cargo, o.commodity)).toBe(o.qty);
    dockedAt(s, o.locationId);
    expect(deliverJob(s, job.id, o.locationId)).toMatchObject({ ok: true });
    expect(s.reputation['hollow-wake']).toBe(wake + CONTRACTS.outlawWake.smuggle);
    // Caught on the way: the goods are gone and the run cannot be finished.
    const t = dockedAt(pilot(), job.giverLocationId);
    t.clock = epoch * CONTRACTS.epochSeconds;
    acceptJob(t, job.id);
    customsScan(t, lawIn(getLocation(o.locationId).systemId)!);
    dockedAt(t, o.locationId);
    expect(deliverJob(t, job.id, o.locationId).ok).toBe(false);
  });

  it('dens post piracy for pilots the Wake trusts, and count the haulers you bring down', () => {
    const s = dockedAt(pilot(), den.id);
    expect(postedContracts(s, den.id)).toEqual([]);
    s.reputation['hollow-wake'] = LAW.wakeFriendly;
    let job: JobDef | undefined;
    let epoch = 0;
    for (; epoch < 60 && !job; epoch++) job = boardFor(den.id, epoch).find((c) => c.contract?.kind === 'piracy');
    s.clock = (epoch - 1) * CONTRACTS.epochSeconds;
    expect(jobsAt(s, den.id).some((o) => o.job.id === job!.id)).toBe(true);
    expect(acceptJob(s, job!.id)).toMatchObject({ ok: true });
    const o = job!.objectives[0]!;
    if (o.kind !== 'piracy') throw new Error('piracy');
    expect(countPiracy(s, o.systemId, o.faction === 'sta' ? 'frontier' : 'sta')).toEqual([]);
    for (let k = 1; k <= o.count; k++) {
      const events = countPiracy(s, o.systemId, o.faction);
      expect(events.length).toBe(k === o.count ? 1 : 0);
    }
    expect(s.jobs[job!.id]!.status).toBe('complete');
  });

  it('docking at a customs depot scans the hold', () => {
    const depot = ALL_LOCATIONS.find((l) => l.stationType === 'customs-depot' && scansOnDocking(l.id))!;
    expect(scansOnDocking(depot.id)).toBe(depot.factionId);
    const s = pilot();
    s.location = { systemId: depot.systemId, dockedAt: null, flight: null, lastDockId: depot.id };
    dockAt(s, depot.id);
    expect(s.location.dockedAt).toBe(depot.id);
  });
});

describe('law saves', () => {
  it('upgrades a v6 save with a clean record and rejects damaged fines', () => {
    const { law: _drop, ...rest } = createNewGame(8);
    const s = migrateSave({ ...structuredClone(rest), version: 6 });
    expect(s.law).toEqual({ fines: {} });
    expect(() => migrateSave({ ...s, law: { fines: { sta: -5 } } })).toThrow(SaveFormatError);
    expect(() => migrateSave({ ...s, law: null })).toThrow(SaveFormatError);
    expect(migrateSave({ ...s, law: { fines: { sta: 400 } } }).law.fines.sta).toBe(400);
  });
});
