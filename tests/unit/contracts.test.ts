import { describe, expect, it } from 'vitest';
import { migrateSave, SaveFormatError } from '../../src/app/save/migrate.ts';
import { createNewGame, voyageTotals, type GameState } from '../../src/app/state.ts';
import { dockAt, discoverBody, jumpReadiness, performJump } from '../../src/app/rules.ts';
import { CONTRACTS } from '../../src/content/contracts/rules.ts';
import { formatIssues } from '../../src/content/validate.ts';
import { ALL_LOCATIONS, getLocation, getSystem, WORLD } from '../../src/data/systems.ts';
import { cargoCount } from '../../src/economy/cargo.ts';
import { contractIssues, validateContracts } from '../../src/economy/contractGuards.ts';
import { boardEpoch, boardFor, followUpFor, postedContract, postedContracts } from '../../src/economy/contracts.ts';
import {
  abandonJob,
  acceptJob,
  advanceJobs,
  contractPacksIn,
  deliverJob,
  describeObjective,
  escortArrived,
  escortLost,
  escortsFollowing,
  escortsIn,
  failJob,
  getJob,
  jobsAt,
  wreckTargetId,
  wrecksIn,
  type JobDef,
} from '../../src/economy/jobs.ts';
import { findRoute } from '../../src/galaxy/routing.ts';
import { SYSTEMS } from '../../src/data/systems.ts';

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

/** The first posted contract of a kind anywhere (plain unless `match` says otherwise), with the time slot it was posted in. */
function findPosted(kind: NonNullable<JobDef['contract']>['kind'], match: (c: JobDef) => boolean = (c) => !c.contract?.urgent && !c.requires): { job: JobDef; epoch: number } {
  for (let epoch = 0; epoch < 60; epoch++) {
    for (const id of GENERATED) {
      const job = boardFor(id, epoch).find((c) => c.contract?.kind === kind && match(c));
      if (job) return { job, epoch };
    }
  }
  throw new Error(`no ${kind} contract posted`);
}

describe('contract boards', () => {
  it('pass every guardrail at every station over forty time slots', () => {
    expect(formatIssues(validateContracts(40))).toBe('');
  }, 120_000);

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
    expect(events[0]).toEqual(expect.objectContaining({ jobId: job.id, kind: 'complete' }));
    expect(events.slice(1).every((e) => e.kind === 'offer')).toBe(true);
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

  it('abandoning forfeits the deposit, keeps the cargo, costs a little standing and cannot be undone', () => {
    const { job, epoch } = findPosted('freight');
    const s = pilotAt(job.giverLocationId, epoch * CONTRACTS.epochSeconds);
    const { cargo, deposit } = job.contract!;
    const faction = job.factionId!;
    s.reputation[faction] = 20;
    const before = voyageTotals(s, 0);
    acceptJob(s, job.id);
    expect(abandonJob(s, job.id)).toMatchObject({ ok: true, message: expect.stringContaining(`deposit of ${deposit} cr forfeit`) });
    expect(s.jobs[job.id]!.status).toBe('abandoned');
    expect(cargoCount(s.ship.cargo, cargo!.commodity)).toBe(cargo!.qty);
    expect(s.reputation[faction]).toBe(20 - CONTRACTS.abandonStanding);
    // The deposit counts against contract money, not jump fees.
    const after = voyageTotals(s, 0);
    expect(after.rewards - before.rewards).toBe(-deposit!);
    expect(after.fees).toBe(before.fees);
    // It stays on its board as abandoned: no second try, no delivery, no second abandon.
    expect(jobsAt(s, job.giverLocationId).find((o) => o.job.id === job.id)?.status).toBe('abandoned');
    expect(acceptJob(s, job.id).ok).toBe(false);
    const dest = getLocation(job.destinationLocationId);
    s.location = { ...s.location, systemId: dest.systemId, dockedAt: dest.id };
    expect(deliverJob(s, job.id, dest.id).ok).toBe(false);
    expect(abandonJob(s, job.id).ok).toBe(false);
    expect(migrateSave(structuredClone(s)).jobs[job.id]!.status).toBe('abandoned');
    // The hand-made story jobs cannot be dropped.
    const story = createNewGame(2);
    expect(acceptJob(story, 'lifeline').ok).toBe(true);
    expect(abandonJob(story, 'lifeline').ok).toBe(false);
    expect(story.jobs.lifeline!.status).toBe('active');
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
    // Abandoning one frees its slot.
    const first = kept[0]!;
    const blocked = boardFor(GENERATED[0]!, 99).find((c) => !c.requires && !c.contract?.cargo && !c.contract?.deposit)!;
    s.clock = 99 * CONTRACTS.epochSeconds;
    s.location = { ...s.location, dockedAt: GENERATED[0]!, systemId: getLocation(GENERATED[0]!).systemId };
    expect(acceptJob(s, blocked.id).message).toMatch(/already have/);
    abandonJob(s, first);
    expect(acceptJob(s, blocked.id).ok).toBe(true);
    abandonJob(s, blocked.id);
    // Much later, the boards have moved on but the accepted contracts are still there.
    const all = Object.keys(s.contracts);
    expect(all).toEqual([...kept, blocked.id]);
    s.clock += CONTRACTS.epochSeconds * 100;
    for (const id of all) expect(getJob(id, s).id).toBe(id);
    const saved = migrateSave(structuredClone(s));
    expect(Object.keys(saved.contracts)).toEqual(all);
  }, 60_000);
});

describe('contracts II', () => {
  it('urgent jobs pay a bonus in time, and cost a little standing when late', () => {
    const { job, epoch } = findPosted('parcel', (c) => !!c.contract?.urgent && !c.requires && c.factionId !== null);
    const urgent = job.contract!.urgent!;
    expect(job.title).toMatch(/^Urgent: /);
    expect(urgent.seconds).toBeGreaterThanOrEqual(CONTRACTS.urgent.minSeconds);
    const dest = getLocation(job.destinationLocationId);
    // In time.
    const a = pilotAt(job.giverLocationId, epoch * CONTRACTS.epochSeconds);
    acceptJob(a, job.id);
    expect(describeObjective(a, job.id)!.text).toMatch(/left for the bonus/);
    a.clock += urgent.seconds - 5;
    a.location = { ...a.location, systemId: dest.systemId, dockedAt: null };
    const beforeA = a.credits;
    const events = dockAt(a, dest.id).jobEvents;
    expect(events[0]!.text).toMatch(/on-time bonus/);
    expect(a.credits).toBe(beforeA + job.reward + urgent.bonus);
    // Late.
    const b = pilotAt(job.giverLocationId, epoch * CONTRACTS.epochSeconds);
    b.reputation[job.factionId!] = 20;
    acceptJob(b, job.id);
    b.clock += urgent.seconds + 5;
    expect(describeObjective(b, job.id)!.text).toMatch(/late: no bonus/);
    b.location = { ...b.location, systemId: dest.systemId, dockedAt: null };
    const beforeB = b.credits;
    dockAt(b, dest.id);
    expect(b.credits).toBe(beforeB + job.reward);
    expect(b.reputation[job.factionId!]).toBe(20 + job.repReward[job.factionId!]! - CONTRACTS.urgent.lateStanding);
  });

  it('a delivery can lead to a follow-up at its destination, paying more, which lapses if left', () => {
    let found: { job: JobDef; epoch: number; next: JobDef } | null = null;
    for (let epoch = 0; epoch < 60 && !found; epoch++) {
      for (const id of GENERATED) {
        const job = boardFor(id, epoch).find((c) => c.contract?.kind === 'parcel' && !c.requires && !c.contract.urgent);
        const next = job ? followUpFor(job, epoch * CONTRACTS.epochSeconds) : null;
        if (job && next) {
          found = { job, epoch, next };
          break;
        }
      }
    }
    const { job, epoch, next } = found!;
    expect(next.title).toMatch(/^Follow-up: /);
    expect(next.giverLocationId).toBe(job.destinationLocationId);
    expect(next.contract!.chain).toMatchObject({ step: 2, parent: job.id });
    const s = pilotAt(job.giverLocationId, epoch * CONTRACTS.epochSeconds);
    acceptJob(s, job.id);
    const dest = getLocation(job.destinationLocationId);
    s.location = { ...s.location, systemId: dest.systemId, dockedAt: null };
    const events = dockAt(s, dest.id).jobEvents;
    const offer = events.find((e) => e.kind === 'offer')!;
    expect(offer.jobId).toBe(next.id);
    // Offered at the destination, where the player now is.
    const offered = jobsAt(s, dest.id).find((o) => o.job.id === next.id)!;
    expect(offered.status).toBe('available');
    expect(acceptJob(s, next.id)).toMatchObject({ ok: true });
    expect(getJob(next.id, s).title).toBe(next.title);
    // Another pilot leaves it: it lapses.
    const t = pilotAt(job.giverLocationId, epoch * CONTRACTS.epochSeconds);
    acceptJob(t, job.id);
    t.location = { ...t.location, systemId: dest.systemId, dockedAt: null };
    dockAt(t, dest.id);
    t.clock = next.contract!.chain!.expires + 1;
    expect(jobsAt(t, dest.id).some((o) => o.job.id === next.id)).toBe(false);
    expect(acceptJob(t, next.id).ok).toBe(false);
    // Chains end after the last step.
    const last = { ...next, id: 'c.x.0.0', contract: { ...next.contract!, chain: { step: CONTRACTS.chain.maxSteps, parent: 'p', expires: 0 } } };
    expect(followUpFor(last, 0)).toBeNull();
  });

  it('escorts: the ship flies with you; docking safely pays, losing it or leaving it behind fails', () => {
    const local = (c: JobDef) => c.objectives[0]?.kind === 'escort' && c.objectives[0].systemId === getLocation(c.giverLocationId).systemId;
    const { job, epoch } = findPosted('escort', (c) => !c.requires && c.factionId !== null && local(c));
    const o = job.objectives[0]!;
    if (o.kind !== 'escort') throw new Error('escorts escort');
    expect(getLocation(o.locationId).systemId).toBe(o.systemId);
    const s = pilotAt(job.giverLocationId, epoch * CONTRACTS.epochSeconds);
    acceptJob(s, job.id);
    expect(escortsIn(s, o.systemId)).toEqual([{ jobId: job.id, from: o.fromLocationId, to: o.locationId, model: o.model, name: o.shipName, level: o.level }]);
    const before = s.credits;
    s.jobs[job.id]!.escort = 'arrived';
    expect(advanceJobs(s, { dockedAt: null, systemId: o.systemId })[0]).toMatchObject({ jobId: job.id, kind: 'complete' });
    expect(s.credits).toBe(before + job.reward);
    // Lost.
    const lost = pilotAt(job.giverLocationId, epoch * CONTRACTS.epochSeconds);
    lost.reputation[job.factionId!] = 20;
    acceptJob(lost, job.id);
    expect(failJob(lost, job.id, 'the ship was destroyed')).toMatchObject({ kind: 'failed' });
    expect(lost.jobs[job.id]!.status).toBe('failed');
    expect(lost.reputation[job.factionId!]).toBe(20 - CONTRACTS.failStanding);
    expect(escortsIn(lost, o.systemId)).toEqual([]);
    // Left behind.
    const left = pilotAt(job.giverLocationId, epoch * CONTRACTS.epochSeconds);
    acceptJob(left, job.id);
    left.location = { ...left.location, dockedAt: null };
    left.flags.clearance = true;
    const away = SYSTEMS.find((x) => x.id !== o.systemId && findRoute(SYSTEMS, o.systemId, x.id)?.hops.length === 1)!;
    const route = findRoute(SYSTEMS, o.systemId, away.id)!;
    const events = performJump(left, route, route.totalFee);
    expect(events[0]).toMatchObject({ jobId: job.id, kind: 'failed', text: expect.stringMatching(/left the .* behind/) });
  });

  it('escorts across jumps: the ship keeps with you, jumps with you only when close, and is seen in at the far end', () => {
    const across = (c: JobDef) => c.objectives[0]?.kind === 'escort' && !c.objectives[0].convoy && c.objectives[0].systemId !== getLocation(c.giverLocationId).systemId;
    const { job, epoch } = findPosted('escort', (c) => !c.requires && across(c));
    const o = job.objectives[0]!;
    if (o.kind !== 'escort') throw new Error('escorts escort');
    const home = getLocation(job.giverLocationId).systemId;
    expect(job.briefing).toMatch(/jumps with you/);
    expect(job.difficultyNote).toMatch(/raiders wait at the beacon/);
    const s = pilotAt(job.giverLocationId, epoch * CONTRACTS.epochSeconds);
    s.flags.clearance = true;
    acceptJob(s, job.id);
    // It sets off here and keeps with the player, to jump with them; none is waiting at the far end yet.
    const setup = { jobId: job.id, from: o.fromLocationId, to: o.locationId, model: o.model, name: o.shipName, level: o.level, follow: true };
    expect(escortsIn(s, home)).toEqual([expect.objectContaining(setup)]);
    expect(escortsFollowing(s, home).map((e) => e.jobId)).toEqual([job.id]);
    expect(escortsIn(s, o.systemId)).toEqual([]);
    s.location = { ...s.location, dockedAt: null };
    expect(describeObjective(s, job.id)?.text).toMatch(new RegExp(`jump to ${getSystem(o.systemId).displayName} with it within 2.5 km`));
    expect(describeObjective(s, job.id)?.targetSystemId).toBe(o.systemId);
    // Too far away, it holds the jump.
    const readiness = jumpReadiness(s, { hostilesNearby: false, inLaneOrAutopilot: false, escortBehind: o.shipName });
    expect(readiness).toEqual({ canJump: false, reason: expect.stringMatching(new RegExp(`The ${o.shipName} is too far away to jump with you`)) });
    expect(jumpReadiness(s, { hostilesNearby: false, inLaneOrAutopilot: false, escortBehind: null }).canJump).toBe(true);
    // Close by, it jumps with the player: nothing fails, and it is at the far end, with raiders at the beacon.
    const route = findRoute(SYSTEMS, home, o.systemId)!;
    expect(performJump(s, route, route.totalFee).filter((e) => e.kind === 'failed')).toEqual([]);
    expect(s.jobs[job.id]!.escortAt).toBe(o.systemId);
    expect(escortsIn(s, home)).toEqual([]);
    const there = escortsIn(s, o.systemId)[0]!;
    expect(there).toMatchObject({ jobId: job.id, to: o.locationId, beacon: true });
    expect(there.follow).toBeUndefined();
    expect(describeObjective(s, job.id)?.text).toBe(`${o.text}: stay close and keep it alive`);
    // Seen in, it pays.
    const before = s.credits;
    expect(escortArrived(s, job.id)[0]).toMatchObject({ jobId: job.id, kind: 'complete' });
    expect(s.credits).toBe(before + job.reward);
    expect(escortsIn(s, o.systemId)).toEqual([]);
    // In its destination's system it is not left: jumping away there fails it.
    const t = pilotAt(job.giverLocationId, epoch * CONTRACTS.epochSeconds);
    t.flags.clearance = true;
    acceptJob(t, job.id);
    t.location = { ...t.location, dockedAt: null };
    performJump(t, route, route.totalFee);
    const back = findRoute(SYSTEMS, o.systemId, home)!;
    expect(performJump(t, back, back.totalFee)[0]).toMatchObject({ jobId: job.id, kind: 'failed', text: expect.stringMatching(/left the .* behind/) });
    // Disabled on the way and towed home, the player finds it waiting where it was.
    const u = pilotAt(job.giverLocationId, epoch * CONTRACTS.epochSeconds);
    acceptJob(u, job.id);
    u.jobs[job.id]!.escortAt = route.path[1]!;
    if (route.path[1] !== o.systemId) {
      expect(describeObjective(u, job.id)?.text).toMatch(/it is waiting for you there/);
      expect(describeObjective(u, job.id)?.targetSystemId).toBe(route.path[1]);
    }
  });

  it('convoys across jumps: three ships of one hull, two of which must arrive', () => {
    const { job, epoch } = findPosted('escort', (c) => !c.requires && c.objectives[0]?.kind === 'escort' && !!c.objectives[0].convoy);
    const o = job.objectives[0]!;
    if (o.kind !== 'escort' || !o.convoy) throw new Error('a convoy');
    expect(o.convoy.names).toHaveLength(3);
    expect(o.convoy.need).toBe(2);
    expect(o.shipName).toMatch(/^convoy from /);
    expect(job.briefing).toMatch(/2 of the 3 must arrive/);
    const s = pilotAt(job.giverLocationId, epoch * CONTRACTS.epochSeconds);
    acceptJob(s, job.id);
    s.jobs[job.id]!.escortAt = o.systemId;
    expect(escortsIn(s, o.systemId)[0]!.convoy).toEqual({ names: o.convoy.names, waves: o.convoy.waves });
    expect(escortLost(s, job.id)[0]).toMatchObject({ kind: 'objective', text: expect.stringMatching(/1 of 1 you can spare/) });
    escortArrived(s, job.id);
    const before = s.credits;
    expect(escortArrived(s, job.id).some((e) => e.kind === 'complete')).toBe(true);
    expect(s.credits).toBe(before + job.reward);
    // Losing two fails it.
    const t = pilotAt(job.giverLocationId, epoch * CONTRACTS.epochSeconds);
    acceptJob(t, job.id);
    escortLost(t, job.id);
    expect(escortLost(t, job.id)[0]).toMatchObject({ kind: 'failed' });
  });

  it('guardrails catch an escort with nothing to fear, a convoy that is not three, and a difficulty that ignores the trip', () => {
    const { job, epoch } = findPosted('escort', (c) => c.objectives[0]?.kind === 'escort' && !!c.objectives[0].convoy);
    const o = job.objectives[0]!;
    if (o.kind !== 'escort' || !o.convoy) throw new Error('a convoy');
    const clock = epoch * CONTRACTS.epochSeconds;
    expect(contractIssues(job, clock)).toEqual([]);
    const safe = ALL_LOCATIONS.find((l) => l.systemId === 'sol' && l.id !== job.giverLocationId && l.dockable !== false && l.status === 'functional')!;
    const rules = (c: JobDef) => contractIssues(c, clock).map((i) => i.rule);
    expect(rules({ ...job, objectives: [{ ...o, systemId: 'sol', locationId: safe.id }] })).toContain('escort');
    expect(rules({ ...job, objectives: [{ ...o, convoy: { ...o.convoy, names: o.convoy.names.slice(0, 2) } }] })).toContain('escort');
    expect(rules({ ...job, difficulty: job.difficulty === 3 ? 2 : 3, requires: undefined })).toContain('escort');
  });

  it('old saves: an escort without a record of where its ships are is where it set off; a damaged one is refused', () => {
    const { job, epoch } = findPosted('escort', (c) => !c.requires && c.objectives[0]?.kind === 'escort' && c.objectives[0].systemId !== getLocation(c.giverLocationId).systemId);
    const s = pilotAt(job.giverLocationId, epoch * CONTRACTS.epochSeconds);
    acceptJob(s, job.id);
    const loaded = migrateSave(structuredClone(s));
    expect(escortsIn(loaded, getLocation(job.giverLocationId).systemId).map((e) => e.jobId)).toEqual([job.id]);
    const bad = structuredClone(s);
    (bad.jobs[job.id] as unknown as { escortAt: string }).escortAt = 'nowhere';
    expect(() => migrateSave(bad)).toThrow(SaveFormatError);
  });

  it('aces: one named target with guards, paid when the ace goes down', () => {
    const { job, epoch } = findPosted('ace', () => true);
    const o = job.objectives[0]!;
    if (o.kind !== 'bounty' || !o.ace) throw new Error('aces are named bounties');
    expect(job.difficulty).toBe(3);
    const s = pilotAt(job.giverLocationId, epoch * CONTRACTS.epochSeconds);
    if (job.factionId) s.reputation[job.factionId] = CONTRACTS.gateStanding;
    expect(acceptJob(s, job.id).ok).toBe(false);
    s.stats.kills = 25;
    expect(acceptJob(s, job.id)).toMatchObject({ ok: true });
    expect(contractPacksIn(s, o.systemId)).toEqual([{ jobId: job.id, locationId: o.locationId, count: 1, level: 3, ace: o.ace }]);
    expect(describeObjective(s, job.id)!.text).not.toMatch(/\(0\/1\)/);
    s.jobs[job.id]!.kills = 1;
    expect(advanceJobs(s, { dockedAt: null, systemId: o.systemId })[0]).toMatchObject({ kind: 'complete' });
  });

  it('recoveries: find the wreck, tractor the item aboard, bring it back', () => {
    const { job, epoch } = findPosted('recovery');
    const [o, back] = job.objectives;
    if (o?.kind !== 'recover' || back?.kind !== 'visit') throw new Error('recoveries find and return');
    const s = pilotAt(job.giverLocationId, epoch * CONTRACTS.epochSeconds);
    acceptJob(s, job.id);
    expect(wrecksIn(s, o.systemId)).toEqual([{ jobId: job.id, locationId: o.locationId, item: o.item, guard: o.guard }]);
    s.location = { ...s.location, systemId: o.systemId, dockedAt: null };
    expect(describeObjective(s, job.id)).toMatchObject({ targetId: wreckTargetId(job.id), targetSystemId: o.systemId });
    s.jobs[job.id]!.recovered = true;
    expect(advanceJobs(s, { dockedAt: null, systemId: o.systemId })[0]).toMatchObject({ kind: 'objective' });
    expect(wrecksIn(s, o.systemId)).toEqual([]);
    const giver = getLocation(job.giverLocationId);
    s.location = { ...s.location, systemId: giver.systemId, dockedAt: null };
    const before = s.credits;
    expect(dockAt(s, giver.id).jobEvents[0]).toMatchObject({ kind: 'complete' });
    expect(s.credits).toBe(before + job.reward);
  });
});

describe('contract saves', () => {
  it('upgrades a v5 save as it is', () => {
    const s = createNewGame(4);
    const v5 = { ...structuredClone(s), version: 5 };
    expect(migrateSave(v5)).toEqual(s);
  });

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
