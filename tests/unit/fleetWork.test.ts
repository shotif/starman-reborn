import { afterEach, describe, expect, it } from 'vitest';
import { assertValidState, migrateSave } from '../../src/app/save/migrate.ts';
import { createNewGame, markVisited, type GameState, type OutpostRecord, type OwnedShip } from '../../src/app/state.ts';
import { dockAt } from '../../src/app/rules.ts';
import { FLEET } from '../../src/content/fleet/rules.ts';
import { COMMODITIES, type CommodityId } from '../../src/content/economy/goods.ts';
import { OUTPOSTS } from '../../src/content/outposts/rules.ts';
import { beltSiteId, outpostId } from '../../src/content/outposts/sites.ts';
import { getLocation } from '../../src/data/systems.ts';
import { useWorldLog } from '../../src/economy/events.ts';
import { fleetNews, haulerNext, haulerStatus, hireWorker, recallHauler, runRaid, settleFleet, supplyPlan } from '../../src/economy/fleet.ts';
import { cutSeconds, meanShares, mineLoad, minersIn, phaseEnd } from '../../src/economy/fleetWork.ts';
import { stockAvailable } from '../../src/economy/markets.ts';
import { newShipState } from '../../src/economy/loadout.ts';
import { charterOffers, charterOutpost, deliverToOutpost, outpostAt, stillNeeded } from '../../src/economy/outposts.ts';
import { giveUpBlock, refineAllowance, refinePay, refineRoom, refinedThisHour } from '../../src/economy/outpostTrade.ts';
import { recordMarketVisit } from '../../src/economy/trade.ts';

/**
 * Captains supply outposts (docs/PROCGEN.md §37): supply runs (the hold, storage, then the market;
 * the share; stages done by a captain; waiting; signing off), mining captains (cycles, the load,
 * the allowance shared and waited out, the cut, recall), never raided, settling the same however
 * often, and saves.
 */

afterEach(() => useWorldLog(null));

const MAIN = beltSiteId('sol-main-belt');
const HOUR = 3_600;
const FREIGHTER = 'ship.freighter.1.halden';
const LASER = 'gear.mining-laser.1.eridani';

function dock(s: GameState, locationId: string): void {
  const loc = getLocation(locationId);
  s.location = { systemId: loc.systemId, dockedAt: locationId, flight: null, lastDockId: locationId };
  markVisited(s, loc.systemId, locationId);
  recordMarketVisit(s, locationId);
}

/** A pilot at Earth Port with a freighter parked there and an outpost chartered in Sol's main belt. */
function setUp(credits = 200_000): { s: GameState; o: OwnedShip; post: OutpostRecord } {
  const s = createNewGame(29);
  s.jobs.lifeline = { status: 'complete', objectiveIndex: 4, acceptedAt: 0, completedAt: 1 };
  s.flags.clearance = true;
  s.credits = credits;
  dock(s, 'earth-port');
  useWorldLog(s.world);
  const offer = charterOffers(s).find((x) => x.site.id === MAIN)!;
  expect(charterOutpost(s, MAIN, offer.kinds[0]!.kind, offer.kinds[0]!.names[0]!).ok).toBe(true);
  const o: OwnedShip = { id: 'ship-1', ship: newShipState(FREIGHTER), locationId: 'earth-port' };
  s.fleet.ships.push(o);
  return { s, o, post: s.world.outposts![0]! };
}

/** Builds the outpost's next stages by hand (docked there), then docks back at Earth Port. */
function build(s: GameState, post: OutpostRecord, stages: number): void {
  dockAt(s, outpostId(post.site));
  for (let i = 0; i < stages; i++) {
    for (const x of stillNeeded(post)) {
      s.ship.cargo = { [x.commodity]: x.left };
      expect(deliverToOutpost(s, x.commodity, x.left).ok).toBe(true);
    }
  }
  dock(s, 'earth-port');
}

/** Runs the clock on, settling the fleet every `step` seconds. */
function runFor(s: GameState, seconds: number, step = 60): ReturnType<typeof settleFleet>[] {
  const out = [];
  const end = s.clock + seconds;
  while (s.clock < end) {
    s.clock = Math.min(end, s.clock + step);
    out.push(settleFleet(s));
  }
  return out;
}

describe('supply captains', () => {
  it('load from the hold, then storage, then the market, for a share of the goods, and the stage is done as if the pilot brought it', () => {
    const { s, o, post } = setUp();
    s.fleet.storage['earth-port'] = { metals: 12 };
    o.ship.cargo = { machinery: 2 };
    const plan = supplyPlan(s, o, outpostId(MAIN))!;
    expect(plan.aboard).toEqual({ machinery: 2 });
    expect(plan.stored).toEqual({ metals: 12 });
    // What storage does not have is bought here, as far as the hold takes it.
    expect(Object.keys(plan.bought).length).toBeGreaterThan(0);
    const loaded = { ...plan.bought, metals: (plan.bought.metals ?? 0) + 12 } as Record<CommodityId, number>;
    const value = (Object.entries(loaded) as [CommodityId, number][]).reduce((sum, [c, q]) => sum + q * COMMODITIES[c].basePrice, 0);
    expect(plan.share).toBe(Math.round(value * FLEET.work.share));
    expect(plan.cost).toBe(plan.goods + plan.share + plan.fees);
    // A hold with goods aboard is not hired out; empty, it is.
    expect(hireWorker(s, o.id, 'supply', outpostId(MAIN)).message).toMatch(/hold must be empty/);
    o.ship.cargo = {};
    const credits = s.credits;
    const r = hireWorker(s, o.id, 'supply', outpostId(MAIN));
    expect(r.ok).toBe(true);
    expect(r.message).toMatch(/loading .* for /);
    const h = o.hauler!;
    expect(h).toMatchObject({ work: 'supply', leg: 'out' });
    expect(s.fleet.storage['earth-port']!.metals ?? 0).toBe(0);
    expect(s.credits).toBe(credits - h.cost);
    // Never raided, wherever it goes.
    expect(runRaid(s.seed, o)).toBeNull();
    // Delivered at the outpost: the frame's goods it carried are in.
    s.clock = phaseEndOf(o);
    const out = settleFleet(s);
    expect(out.reports.some((x) => x.kind === 'supply' && /delivered/.test(x.text))).toBe(true);
    expect(o.hauler!.leg).toBe('back');
    expect(post.delivered.metals).toBeGreaterThanOrEqual(12);
  });

  it('waits, said once, when nothing the stage needs is stored or sold at home', () => {
    // Earth Port sells machinery, but not habitat modules or refined metals.
    const { s, o, post } = setUp();
    expect(hireWorker(s, o.id, 'supply', outpostId(MAIN)).ok).toBe(true);
    const all = runFor(s, 6 * HOUR, 300);
    expect(post.delivered.machinery).toBe(OUTPOSTS.stages[0]!.needs.machinery);
    expect(o.hauler).toMatchObject({ leg: 'home', waiting: 'supplies' });
    expect(all.flatMap((x) => x.reports).filter((x) => x.kind === 'wait')).toHaveLength(1);
    expect(haulerStatus(s, o)).toMatch(/nothing .* needs is stored or sold here/);
    // Stored at home, the rest goes, and the frame is up: the outpost opens by the captain's hand.
    s.fleet.storage['earth-port'] = { 'habitat-modules': 8, metals: 6 };
    runFor(s, 3 * HOUR, 300);
    expect(post.delivered['habitat-modules']).toBe(8);
    assertValidState(s);
  });

  it('runs stage after stage until the outpost is complete, then signs off', () => {
    const { s, o, post } = setUp(5_000_000);
    // A station already, its port's habitat modules and ship parts in: what is left Earth Port sells.
    post.stage = 2;
    post.opened = 0;
    post.delivered = { 'habitat-modules': 16, 'ship-parts': 15 };
    expect(hireWorker(s, o.id, 'supply', outpostId(MAIN)).ok).toBe(true);
    const reports = runFor(s, 12 * HOUR, 300).flatMap((x) => x.reports);
    expect(post.stage).toBe(OUTPOSTS.stages.length);
    expect(reports.some((x) => x.kind === 'supply' && /is now a port/.test(x.text))).toBe(true);
    expect(o.hauler).toBeUndefined();
    expect(reports.at(-1)!.text).toMatch(/signed off: .* is complete/);
    assertValidState(s);
  });
});

describe('mining captains', () => {
  it('cut loads in the belt’s shares, hand them to the refinery within its hourly allowance shared with the pilot, and take a cut', () => {
    const { s, o, post } = setUp();
    build(s, post, 1);
    expect(hireWorker(s, o.id, 'mine', outpostId(MAIN)).message).toMatch(/mining laser/);
    o.ship.fittings['utility-1'] = LASER;
    const load = mineLoad(o.ship, MAIN);
    const shares = meanShares('asteroid-belt');
    expect(shares.ore).toBeCloseTo(0.7, 5);
    expect(Object.keys(load).sort()).toEqual(['ore', 'water']);
    const units = (load.ore ?? 0) + (load.water ?? 0);
    expect((load.ore ?? 0) / units).toBeCloseTo(0.7, 1);
    expect(cutSeconds(o.ship, units)).toBeGreaterThan(60);
    expect(hireWorker(s, o.id, 'mine', outpostId(MAIN)).ok).toBe(true);
    const h = o.hauler!;
    expect(h).toMatchObject({ work: 'mine', leg: 'out' });
    expect(runRaid(s.seed, o)).toBeNull();
    // At the refinery's system, the cycle.
    s.clock = phaseEndOf(o);
    settleFleet(s);
    expect(h).toMatchObject({ leg: 'work', phase: 'to-rocks' });
    s.clock = phaseEndOf(o);
    settleFleet(s);
    expect(h.phase).toBe('cutting');
    expect(minersIn(s, 'sol', s.clock)).toEqual([expect.objectContaining({ phase: 'cutting', dockId: outpostId(MAIN) })]);
    s.clock = phaseEndOf(o);
    settleFleet(s);
    expect(h.phase).toBe('to-dock');
    expect(o.ship.cargo).toEqual(load);
    // The pilot has refined most of this hour's allowance: the captain hands over what is left, and waits for the next hour.
    s.clock = phaseEndOf(o);
    const hour = Math.floor(s.clock / HOUR);
    post.refined = { hour, units: refineAllowance(post) - 5 };
    const credits = s.credits;
    const out = settleFleet(s);
    expect(refinedThisHour(post, s.clock)).toBe(refineAllowance(post));
    const pay = 5 * refinePay('ore');
    expect(s.credits - credits).toBe(pay - Math.round(pay * FLEET.work.cut));
    expect(out.reports).toEqual([expect.objectContaining({ kind: 'mine', amount: pay - Math.round(pay * FLEET.work.cut) })]);
    expect(h.phase).toBe('handing');
    expect(phaseEnd(o, h)).toBe((hour + 1) * HOUR);
    expect(haulerStatus(s, o)).toMatch(/Waiting at .* for its next hour/);
    // The next hour, the rest goes in, and it goes out again.
    s.clock = (hour + 1) * HOUR;
    settleFleet(s);
    expect(o.ship.cargo).toEqual({});
    expect(h.phase).toBe('to-rocks');
    // Its refinery cannot be given up while it works there.
    expect(giveUpBlock(s, post)).toMatch(/mines for it/);
    assertValidState(s);
    expect(migrateSave(structuredClone(s))).toEqual(s);
    // Recalled: it hands over what it has, then flies home and parks.
    expect(recallHauler(s, o.id).ok).toBe(true);
    runFor(s, 3 * HOUR, 120);
    expect(o.hauler).toBeUndefined();
    expect(o.ship.cargo).toEqual({});
    expect(s.fleet.reports.at(-1)!.text).toMatch(/signed off/);
  });

  it('settle the same however often, and never take more than the allowance an hour', () => {
    const a = setUp();
    build(a.s, a.post, 3);
    a.o.ship.fittings['utility-1'] = LASER;
    expect(hireWorker(a.s, a.o.id, 'mine', outpostId(MAIN)).ok).toBe(true);
    const b = structuredClone(a);
    useWorldLog(a.s.world);
    runFor(a.s, 12 * HOUR, 30);
    useWorldLog(b.s.world);
    b.s.clock += 12 * HOUR;
    settleFleet(b.s);
    expect(b.s.credits).toBe(a.s.credits);
    expect(b.s.fleet.ships).toEqual(a.s.fleet.ships);
    expect(b.s.world.outposts).toEqual(a.s.world.outposts);
    expect(refineRoom(b.post, b.s.clock)).toBeGreaterThanOrEqual(0);
    // At a port, 80 an hour at most: what it earned in 12 hours is within that.
    const earned = b.s.fleet.ships[0]!.hauler!.earned;
    expect(earned).toBeGreaterThan(0);
    expect(earned).toBeLessThanOrEqual(12 * OUTPOSTS.refining.perHour[2] * refinePay('gases'));
    expect(fleetNews({ reports: b.s.fleet.reports.slice(-5), runs: 0, hauled: 0, dividends: 0, outpost: 0, steps: 1, raids: [], raidJobs: [] })[0]!.text).toMatch(/loads? refined/);
    // The refinery's market has the refined goods.
    expect(stockAvailable(outpostId(MAIN), 'metals', b.s)).toBeGreaterThan(0);
    expect(outpostAt(b.s, outpostId(MAIN))).toBeDefined();
  });
});

/** When the captain's current step comes due. */
function phaseEndOf(o: OwnedShip): number {
  const h = o.hauler!;
  return h.leg === 'work' ? phaseEnd(o, h) : haulerNext(h);
}
