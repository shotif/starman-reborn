import { describe, expect, it } from 'vitest';
import { migrateSave, SaveFormatError } from '../../src/app/save/migrate.ts';
import { createNewGame, type GameState } from '../../src/app/state.ts';
import { dockAt, discoverBody } from '../../src/app/rules.ts';
import { CONTRACTS } from '../../src/content/contracts/rules.ts';
import { formatIssues } from '../../src/content/validate.ts';
import { getLocation, WORLD } from '../../src/data/systems.ts';
import { cargoCount } from '../../src/economy/cargo.ts';
import { validateContracts } from '../../src/economy/contractGuards.ts';
import { boardEpoch, boardFor, postedContract, postedContracts } from '../../src/economy/contracts.ts';
import { acceptJob, advanceJobs, contractPacksIn, deliverJob, describeObjective, getJob, jobsAt, type JobDef } from '../../src/economy/jobs.ts';

/**
 * Generated contracts (docs/PROCGEN.md §10): guardrails over many time slots, and each kind played
 * through the job system: accepting, cargo and deposits, progress, pay and the save.
 */

const GENERATED = WORLD.stations.filter((s) => s.dockable && s.services.includes('contracts')).map((s) => s.id);

/** A pilot docked at `locationId` with plenty of credits and a big hold. */
function pilotAt(locationId: string, clock = 0): GameState {
  const s = createNewGame(11);
  const loc = getLocation(locationId);
  s.location = { systemId: loc.systemId, dockedAt: locationId, flight: null, lastDockId: locationId };
  s.credits = 50_000;
  s.clock = clock;
  s.ship.model = 'ship.freighter.3.eridani';
  s.ship.cargo = {};
  s.jobs.lifeline = { status: 'complete', objectiveIndex: 4, acceptedAt: 0, completedAt: 1 };
  return s;
}

/** The first posted contract of a kind anywhere, with the time slot it was posted in. */
function findPosted(kind: NonNullable<JobDef['contract']>['kind']): { job: JobDef; epoch: number } {
  for (let epoch = 0; epoch < 30; epoch++) {
    for (const id of GENERATED) {
      const job = boardFor(id, epoch).find((c) => c.contract?.kind === kind && !c.requires);
      if (job) return { job, epoch };
    }
  }
  throw new Error(`no ${kind} contract posted`);
}

describe('contract boards', () => {
  it('pass every guardrail at every station over forty time slots', () => {
    expect(formatIssues(validateContracts(40))).toBe('');
  });

  it('are the same every time for a station and time slot, and change with the clock', () => {
    const id = GENERATED[0]!;
    expect(boardFor(id, 3)).toBe(boardFor(id, 3));
    const a = boardFor(id, 3).map((c) => c.id);
    const b = boardFor(id, 4).map((c) => c.id);
    expect(a.some((x) => b.includes(x))).toBe(false);
    for (const c of boardFor(id, 3)) expect(postedContract(c.id)).toEqual(c);
    expect(postedContract('c.nowhere.3.0')).toBeNull();
    expect(boardEpoch(CONTRACTS.epochSeconds * 2 + 5)).toBe(2);
  });

  it('post on generated stations right away and on the hand-made ones after the first delivery', () => {
    const fresh = createNewGame(1);
    expect(postedContracts(fresh, 'earth-port')).toEqual([]);
    expect(jobsAt(fresh, 'earth-port').every((o) => !o.job.contract)).toBe(true);
    const s = pilotAt('earth-port');
    expect(postedContracts(s, 'earth-port').length).toBeGreaterThan(0);
    const generated = WORLD.stations.find((st) => st.type === 'trade-port')!.id;
    expect(postedContracts(fresh, generated).length).toBeGreaterThan(0);
  });
});

describe('playing generated contracts', () => {
  it('freight: loads the cargo against a deposit and pays both back on delivery', () => {
    const { job, epoch } = findPosted('freight');
    const s = pilotAt(job.giverLocationId, epoch * CONTRACTS.epochSeconds);
    const { cargo, deposit } = job.contract!;
    const before = s.credits;
    expect(acceptJob(s, job.id)).toMatchObject({ ok: true });
    expect(s.credits).toBe(before - deposit!);
    expect(cargoCount(s.ship.cargo, cargo!.commodity)).toBe(cargo!.qty);
    expect(getJob(job.id, s)).toEqual(job);
    expect(acceptJob(s, job.id).ok).toBe(false);
    // Fly to the destination and turn it in.
    const dest = getLocation(job.destinationLocationId);
    s.location = { ...s.location, systemId: dest.systemId, dockedAt: dest.id };
    const r = deliverJob(s, job.id, dest.id);
    expect(r).toMatchObject({ ok: true, reward: job.reward });
    expect(s.credits).toBe(before + job.reward);
    expect(cargoCount(s.ship.cargo, cargo!.commodity)).toBe(0);
    expect(s.jobs[job.id]!.status).toBe('complete');
  });

  it('freight: refuses without hold space or credits for the deposit', () => {
    const { job, epoch } = findPosted('freight');
    const s = pilotAt(job.giverLocationId, epoch * CONTRACTS.epochSeconds);
    s.ship.model = 'ship.courier.1.halden';
    s.ship.cargo = { water: 6 };
    expect(acceptJob(s, job.id)).toMatchObject({ ok: false, message: expect.stringMatching(/hold units/) });
    s.ship.cargo = {};
    s.credits = 1;
    expect(acceptJob(s, job.id)).toMatchObject({ ok: false, message: expect.stringMatching(/deposit/) });
    expect(s.contracts).toEqual({});
  });

  it('parcel: completes and pays on docking at the destination', () => {
    const { job, epoch } = findPosted('parcel');
    const s = pilotAt(job.giverLocationId, epoch * CONTRACTS.epochSeconds);
    acceptJob(s, job.id);
    const dest = getLocation(job.destinationLocationId);
    s.location = { ...s.location, systemId: dest.systemId, dockedAt: null };
    const before = s.credits;
    const events = dockAt(s, dest.id).jobEvents;
    expect(events).toEqual([expect.objectContaining({ jobId: job.id, kind: 'complete' })]);
    expect(s.credits).toBe(before + job.reward);
  });

  it('supply run: asks for the goods, names where to buy them, and pays on delivery', () => {
    const { job, epoch } = findPosted('supply');
    const s = pilotAt(job.giverLocationId, epoch * CONTRACTS.epochSeconds);
    acceptJob(s, job.id);
    const o = job.objectives[0]!;
    if (o.kind !== 'deliver') throw new Error('supply runs deliver');
    expect(describeObjective(s, job.id)!.text).toMatch(/^Acquire/);
    expect(s.knownMarkets[job.briefingPrices!.locationId]?.source).toBe('briefing');
    s.ship.cargo = { [o.commodity]: o.qty };
    expect(deliverJob(s, job.id, job.giverLocationId)).toMatchObject({ ok: true, reward: job.reward });
  });

  it('bounty: counts raiders of the contract pack and pays when the last goes down', () => {
    const { job, epoch } = findPosted('bounty');
    const s = pilotAt(job.giverLocationId, epoch * CONTRACTS.epochSeconds);
    acceptJob(s, job.id);
    const o = job.objectives[0]!;
    if (o.kind !== 'bounty') throw new Error('bounties hunt');
    expect(contractPacksIn(s, o.systemId)).toEqual([{ jobId: job.id, locationId: o.locationId, count: o.count, level: o.level }]);
    expect(contractPacksIn(s, 'sol')).toEqual([]);
    const before = s.credits;
    for (let k = 1; k <= o.count; k++) {
      s.jobs[job.id]!.kills = k;
      const events = advanceJobs(s, { dockedAt: null, systemId: o.systemId });
      expect(events.length).toBe(k === o.count ? 1 : 0);
      if (k < o.count) expect(contractPacksIn(s, o.systemId)[0]!.count).toBe(o.count - k);
    }
    expect(s.credits).toBe(before + job.reward);
    expect(s.reputation['hollow-wake']).toBeLessThan(createNewGame(1).reputation['hollow-wake']);
  });

  it('survey: completes on scanning the planet, and is not offered once it is scanned', () => {
    const { job, epoch } = findPosted('survey');
    const s = pilotAt(job.giverLocationId, epoch * CONTRACTS.epochSeconds);
    const o = job.objectives[0]!;
    if (o.kind !== 'scan') throw new Error('surveys scan');
    const other = pilotAt(job.giverLocationId, epoch * CONTRACTS.epochSeconds);
    other.discoveredBodies.push(o.bodyId);
    expect(postedContracts(other, job.giverLocationId).some((c) => c.id === job.id)).toBe(false);
    acceptJob(s, job.id);
    expect(discoverBody(s, o.bodyId).jobEvents).toEqual([expect.objectContaining({ jobId: job.id, kind: 'complete' })]);
  });

  it('limits contracts in progress and keeps accepted ones in the save through later time slots', () => {
    const s = pilotAt(GENERATED[0]!);
    let accepted = 0;
    for (let epoch = 0; epoch < 40 && accepted < CONTRACTS.maxActive + 2; epoch++) {
      s.clock = epoch * CONTRACTS.epochSeconds;
      for (const id of GENERATED) {
        for (const c of boardFor(id, epoch)) {
          if (c.contract?.kind !== 'parcel' || c.requires) continue;
          s.location = { ...s.location, dockedAt: id, systemId: getLocation(id).systemId };
          const r = acceptJob(s, c.id);
          if (r.ok) accepted++;
          else if (accepted >= CONTRACTS.maxActive) expect(r.message).toMatch(/already have/);
        }
      }
    }
    expect(accepted).toBe(CONTRACTS.maxActive);
    const kept = Object.keys(s.contracts);
    expect(kept.length).toBe(CONTRACTS.maxActive);
    // Much later, the boards have moved on but the accepted contracts are still there.
    s.clock += CONTRACTS.epochSeconds * 100;
    for (const id of kept) expect(getJob(id, s).id).toBe(id);
    const saved = migrateSave(structuredClone(s));
    expect(Object.keys(saved.contracts)).toEqual(kept);
  });
});

describe('contract saves', () => {
  it('upgrades a v4 save with no contracts and rejects damaged contracts', () => {
    const { contracts: _drop, ...rest } = createNewGame(3);
    const v4 = { ...structuredClone(rest), version: 4 };
    const s = migrateSave(v4);
    expect(s.contracts).toEqual({});
    const { job } = findPosted('parcel');
    expect(() => migrateSave({ ...s, contracts: { [job.id]: { ...job, id: 'other' } } })).toThrow(SaveFormatError);
    expect(() => migrateSave({ ...s, contracts: { [job.id]: { ...job, objectives: [] } } })).toThrow(SaveFormatError);
    expect(migrateSave({ ...s, contracts: { [job.id]: job } }).contracts[job.id]).toEqual(job);
  });
});
