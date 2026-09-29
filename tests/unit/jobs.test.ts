import { describe, expect, it } from 'vitest';
import { dockAt, discoverBody, jumpReadiness, performJump, rescueAfterDefeat, routeFee, undock } from '../../src/app/rules.ts';
import { createNewGame, type GameState } from '../../src/app/state.ts';
import { SYSTEMS } from '../../src/data/systems.ts';
import {
  acceptJob,
  activeFeeCoverage,
  canDeliver,
  currentObjective,
  deliverJob,
  describeObjective,
  jobsAt,
  LIFELINE_ID,
  primaryObjective,
} from '../../src/economy/jobs.ts';
import { buyCommodity, sellCommodity } from '../../src/economy/trade.ts';
import { findRoute } from '../../src/galaxy/routing.ts';

const NOT_BUSY = { hostilesNearby: false, inLaneOrAutopilot: false };

function jump(s: GameState, to: Parameters<typeof findRoute>[2]) {
  const route = findRoute(SYSTEMS, s.location.systemId, to)!;
  return performJump(s, route, routeFee(s, route));
}

describe('first delivery job chain', () => {
  it('is offered at Earth and records the briefed Proxima price', () => {
    const s = createNewGame(7);
    const offer = jobsAt(s, 'earth-port').find((o) => o.job.id === LIFELINE_ID)!;
    expect(offer.status).toBe('available');
    expect(offer.job.reward).toBeGreaterThan(0);
    expect(offer.job.difficulty).toBe(2);
    expect(acceptJob(s, LIFELINE_ID).ok).toBe(true);
    expect(s.knownMarkets['meridian-outpost']?.source).toBe('briefing');
    expect(acceptJob(s, LIFELINE_ID).ok).toBe(false);
  });

  it('progresses through buy -> Mars clearance -> jump -> scan -> deliver with rewards and reputation', () => {
    const s = createNewGame(7);
    acceptJob(s, LIFELINE_ID);
    expect(currentObjective(s, LIFELINE_ID)?.kind).toBe('have-cargo');
    buyCommodity(s, 'earth-port', 'medical', 8);
    dockAt(s, 'earth-port'); // re-evaluate while docked
    expect(currentObjective(s, LIFELINE_ID)?.kind).toBe('dock');

    // Cannot jump before clearance.
    undock(s);
    expect(jumpReadiness(s, NOT_BUSY)).toMatchObject({ canJump: false });

    const mars = dockAt(s, 'mars-depot');
    expect(mars.clearanceGranted).toBe(true);
    expect(currentObjective(s, LIFELINE_ID)?.kind).toBe('scan');
    undock(s);
    expect(jumpReadiness(s, NOT_BUSY).canJump).toBe(true);
    expect(jumpReadiness(s, { hostilesNearby: true, inLaneOrAutopilot: false }).canJump).toBe(false);

    // The contract covers the jump fee to Alpha Centauri.
    expect(activeFeeCoverage(s)?.systemId).toBe('alpha-centauri');
    const credits = s.credits;
    jump(s, 'alpha-centauri');
    expect(s.credits).toBe(credits);
    expect(s.location.systemId).toBe('alpha-centauri');

    discoverBody(s, 'proxima-cen-b');
    expect(currentObjective(s, LIFELINE_ID)?.kind).toBe('deliver');
    dockAt(s, 'meridian-outpost');
    expect(canDeliver(s, LIFELINE_ID, 'meridian-outpost')).toBe(true);
    const repBefore = { ...s.reputation };
    const before = s.credits;
    const result = deliverJob(s, LIFELINE_ID, 'meridian-outpost');
    expect(result.ok).toBe(true);
    expect(s.credits).toBe(before + 1000);
    expect(s.ship.cargo.medical).toBe(2);
    expect(s.reputation.frontier).toBeGreaterThan(repBefore.frontier);
    expect(s.jobs[LIFELINE_ID]?.status).toBe('complete');
    expect(primaryObjective(s)).toBeNull();
    // Completing the chain unlocks a follow-up contract.
    expect(jobsAt(s, 'meridian-outpost').find((o) => o.job.id === 'eridani-spares')?.status).toBe('available');
  });

  it('survives detours: other systems, selling the cargo and re-buying', () => {
    const s = createNewGame(7);
    acceptJob(s, LIFELINE_ID);
    buyCommodity(s, 'earth-port', 'medical', 6);
    dockAt(s, 'earth-port');
    dockAt(s, 'mars-depot');
    undock(s);
    // Detour to Barnard's Star and back through Sol: job state unchanged.
    s.credits = 5000;
    jump(s, 'barnard');
    expect(s.location.systemId).toBe('barnard');
    expect(currentObjective(s, LIFELINE_ID)?.kind).toBe('scan');
    expect(describeObjective(s, LIFELINE_ID)?.text).toMatch(/^Jump to Alpha Centauri/);
    dockAt(s, 'barnard-relay');
    // Sell the medical supplies on the way; the objective asks to acquire them again.
    sellCommodity(s, 'barnard-relay', 'medical', 4);
    undock(s);
    jump(s, 'alpha-centauri');
    discoverBody(s, 'proxima-cen-b');
    dockAt(s, 'meridian-outpost');
    expect(canDeliver(s, LIFELINE_ID, 'meridian-outpost')).toBe(false);
    expect(describeObjective(s, LIFELINE_ID)?.text).toMatch(/Acquire 4 more medical supplies/);
    undock(s);
    jump(s, 'sol');
    dockAt(s, 'mars-depot');
    buyCommodity(s, 'mars-depot', 'medical', 4);
    undock(s);
    jump(s, 'alpha-centauri');
    dockAt(s, 'meridian-outpost');
    expect(deliverJob(s, LIFELINE_ID, 'meridian-outpost').ok).toBe(true);
    expect(s.jobs[LIFELINE_ID]?.status).toBe('complete');
  });

  it('scanning Proxima b early still counts once the player reaches that objective', () => {
    const s = createNewGame(3);
    s.flags.clearance = true;
    acceptJob(s, LIFELINE_ID);
    discoverBody(s, 'proxima-cen-b');
    buyCommodity(s, 'earth-port', 'medical', 6);
    dockAt(s, 'earth-port');
    dockAt(s, 'mars-depot');
    expect(currentObjective(s, LIFELINE_ID)?.kind).toBe('deliver');
  });

  it('gates the Sirius survey on Frontier standing', () => {
    const s = createNewGame(3);
    const locked = jobsAt(s, 'sirius-platform').find((o) => o.job.id === 'horizon-survey')!;
    expect(locked.status).toBe('locked');
    expect(locked.lockReason).toMatch(/Friendly/);
    s.reputation.frontier = 12;
    expect(jobsAt(s, 'sirius-platform').find((o) => o.job.id === 'horizon-survey')!.status).toBe('available');
  });

  it('a visit-only courier job completes and pays on docking', () => {
    const s = createNewGame(3);
    s.location.systemId = 'barnard';
    dockAt(s, 'barnard-relay');
    acceptJob(s, 'relay-courier');
    s.location.systemId = 'sol';
    const credits = s.credits;
    const out = dockAt(s, 'mars-depot');
    expect(out.jobEvents.some((e) => e.kind === 'complete')).toBe(true);
    expect(s.credits).toBe(credits + 320);
  });
});

describe('defeat and rescue', () => {
  it('returns the pilot to the last dock with a capped fee and keeps cargo', () => {
    const s = createNewGame(3);
    buyCommodity(s, 'earth-port', 'medical', 6);
    dockAt(s, 'mars-depot');
    undock(s);
    s.ship.hull = 0;
    s.credits = 90;
    const r = rescueAfterDefeat(s);
    expect(r.fee).toBe(90);
    expect(r.dockId).toBe('mars-depot');
    expect(s.location.dockedAt).toBe('mars-depot');
    expect(s.ship.hull).toBe(100);
    expect(s.ship.cargo.medical).toBe(6);
    expect(s.credits).toBe(0);
  });
});
