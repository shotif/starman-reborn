import { afterEach, describe, expect, it, vi } from 'vitest';
import { assertValidState, migrateSave } from '../../src/app/save/migrate.ts';
import { createNewGame, markVisited, type GameState, type OutpostRecord } from '../../src/app/state.ts';
import { COMMODITIES } from '../../src/content/economy/goods.ts';
import { HAULS } from '../../src/content/economy/hauls.ts';
import { OUTPOSTS } from '../../src/content/outposts/rules.ts';
import { beltSiteId, outpostId, outpostSite } from '../../src/content/outposts/sites.ts';
import { ALL_LOCATIONS, getLocation, saveLocations } from '../../src/data/systems.ts';
import { boardFor, postedContract } from '../../src/economy/contracts.ts';
import { systemEventAt, useWorldLog } from '../../src/economy/events.ts';
import { settleFleet } from '../../src/economy/fleet.ts';
import { dockFee, dockFees, haulById, haulFate, haulSenders, haulsIn, haulStock, made, outpostDockings, outpostHaul, tradeHaul, waysFrom } from '../../src/economy/hauls.ts';
import { acceptJob, deliverJob, describeObjective } from '../../src/economy/jobs.ts';
import { marketTables, moveStock, spillNeighbours, stockAvailable } from '../../src/economy/markets.ts';
import { incomeAt } from '../../src/economy/outposts.ts';
import { giveUpBlock, haulerLines, nextHauler } from '../../src/economy/outpostTrade.ts';
import { sampleSites, validateOutpostTrade, type TradeRules } from '../../src/economy/outpostTradeGuards.ts';
import { outpostEntries, searchIndex, searchSystems } from '../../src/galaxy/mapSearch.ts';

/**
 * Outposts join the trade (docs/PROCGEN.md §38): the outposts' own haulers on the timetable, the
 * world's own unchanged, dock fees paid with the income, work on the boards within reach, the
 * spill between neighbours, the star map's search, the calls gone, and saves.
 */

afterEach(() => useWorldLog(null));

const HOUR = 3_600;
const MAIN = beltSiteId('sol-main-belt');
const POST = outpostId(MAIN);

/** A pilot at Earth Port with an outpost open at a stage (its record made directly, opened at `opened`). */
function withOutpost(stage = 1, site = MAIN, opened = 0): { s: GameState; o: OutpostRecord } {
  const s = createNewGame(23);
  s.jobs.lifeline = { status: 'complete', objectiveIndex: 4, acceptedAt: 0, completedAt: 1 };
  s.flags.clearance = true;
  s.credits = 100_000;
  s.location = { systemId: 'sol', dockedAt: 'earth-port', flight: null, lastDockId: 'earth-port' };
  markVisited(s, 'sol', 'earth-port');
  const kind = outpostSite(site)!.kinds[0]!;
  const o: OutpostRecord = { site, kind, name: 'Copperleaf Stillworks', founded: 0, stage, delivered: {}, since: opened, earned: 0, opened };
  s.world.outposts = [o];
  useWorldLog(s.world);
  return { s, o };
}

describe('guardrails', () => {
  it('the rules and every sampled site’s haulers pass', () => {
    expect(sampleSites().length).toBeGreaterThan(9);
    expect(validateOutpostTrade()).toEqual([]);
  });

  it('broken rules are caught', () => {
    const T = OUTPOSTS.trade;
    const broken = (patch: Partial<TradeRules>) => validateOutpostTrade({ ...T, ...patch }, 1, []);
    expect(broken({ send: [0.1, 0.2] })).not.toEqual([]);
    expect(broken({ draw: [0.1, 0.6, 0.7] })).not.toEqual([]);
    expect(broken({ send: [0.2, 0.1, 0.3] })).not.toEqual([]);
    expect(broken({ fee: 0 })).not.toEqual([]);
    expect(broken({ fee: 0.2 })).not.toEqual([]);
    expect(broken({ feeHours: 10 })).not.toEqual([]);
    expect(broken({ feeHours: 72.5 })).not.toEqual([]);
    expect(broken({ feeHours: OUTPOSTS.maxHoursPerSettle + 1 })).not.toEqual([]);
    expect(broken({ board: { ...T.board, chance: 1.5 } })).not.toEqual([]);
    expect(broken({ board: { ...T.board, passage: -0.1 } })).not.toEqual([]);
    expect(broken({ board: { ...T.board, jumps: 4 } })).not.toEqual([]);
    expect(broken({})).toEqual([]);
  });
});

describe('the outposts’ haulers', () => {
  it('sent and drawn from the outpost’s own stream, more as it grows, none before it opened', () => {
    const counts: number[] = [];
    for (let stage = 1; stage <= 3; stage++) {
      withOutpost(stage, MAIN, 10 * HOUR);
      const d = outpostDockings(POST, 0, 58 * HOUR);
      expect(d.every((x) => x.haul.depart >= 10 * HOUR)).toBe(true);
      const sent = d.filter((x) => x.haul.from === POST);
      const drawn = d.filter((x) => x.haul.to === POST);
      expect(sent.length).toBeGreaterThan(0);
      expect(drawn.length).toBeGreaterThan(0);
      for (const { haul: h, at } of sent) {
        expect(made(POST)).toContain(h.commodity);
        expect(h.faction).toBe('independent');
        expect(at).toBe(h.depart);
        expect(h.id).toBe(`h.${POST}.${Math.floor(h.depart / HAULS.slotSeconds)}`);
        expect(getLocation(h.to).fictional).toBe(true);
        expect(ALL_LOCATIONS.some((l) => l.id === h.to)).toBe(true);
      }
      for (const { haul: h, at } of drawn) {
        expect(made(h.from)).toContain(h.commodity);
        expect(marketTables().get(POST)!.entries.get(h.commodity)!.role).not.toBe('produce');
        expect(at).toBe(haulFate(h).at);
        expect(h.id).toMatch(/^h\.in\.outpost\./);
      }
      for (const { haul: h } of d) expect(haulById(h.id)).toEqual(h);
      counts.push(d.length / 48);
    }
    // About one an hour at a frame, two at a station, three at a port.
    expect(counts[0]).toBeGreaterThan(0.4);
    expect(counts[0]).toBeLessThan(1.6);
    expect(counts[1]).toBeGreaterThan(counts[0]!);
    expect(counts[2]).toBeGreaterThan(counts[1]!);
    expect(counts[2]).toBeLessThan(4.5);
  });

  it('none while it is being built, nor once it is given up', () => {
    withOutpost(0);
    expect(outpostDockings(POST, 0, 24 * HOUR)).toEqual([]);
    useWorldLog(null);
    expect(outpostHaul(POST, 3, 'out')).toBeNull();
    expect(haulById(`h.in.${POST}.3`)).toBeNull();
  });

  it('the world’s own timetable is the same with outposts or without', async () => {
    const near = haulSenders().filter((l) => (waysFrom('sol').get(l.systemId)?.length ?? 99) - 1 <= HAULS.maxJumps);
    const timetable = async (withPost: boolean) => {
      vi.resetModules();
      const ev = await import('../../src/economy/events.ts');
      const h = await import('../../src/economy/hauls.ts');
      const st = await import('../../src/app/state.ts');
      const s = st.createNewGame(1);
      if (withPost) s.world.outposts = [{ site: MAIN, kind: 'refinery', name: 'Copperleaf Stillworks', founded: 0, stage: 3, delivered: {}, since: 0, earned: 0, opened: 0 }];
      ev.useWorldLog(s.world);
      const out = near.flatMap((l) => Array.from({ length: 24 }, (_, slot) => h.tradeHaul(l.id, 7_000 + slot)));
      ev.useWorldLog(null);
      return JSON.stringify(out);
    };
    const without = await timetable(false);
    expect(await timetable(true)).toBe(without);
    expect(without).not.toContain('"outpost.');
    expect(without).not.toContain('h.outpost.');
  });

  it('seen in flight: flying in the systems of their way', () => {
    withOutpost(3);
    const d = outpostDockings(POST, 0, 12 * HOUR);
    const h = d.find((x) => x.haul.from === POST)!.haul;
    const leg = h.legs[0]!;
    const here = haulsIn('sol', (leg.start + leg.end) / 2);
    expect(here.some((x) => x.haul.id === h.id && x.leg.kind === leg.kind)).toBe(true);
    // Shown before the rest of the trade (after relief and shipments) when the scene has room for only so many.
    const order = here.map((x) => (x.haul.kind !== 'trade' ? 0 : x.haul.from === POST || x.haul.to === POST ? 1 : 2));
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(order.filter((x) => x === 2).length).toBeGreaterThan(0);
    // A world station's haul in a slot is still served by its id.
    const world = tradeHaul('earth-port', 7_001);
    if (world) expect(haulById(world.id)).toEqual(world);
  });

  it('nobody sets off into or out of a raid; one lost on its way in is missed by the outpost’s market', () => {
    const site = beltSiteId('fomalhaut-debris-disc');
    const id = outpostId(site);
    withOutpost(3, site);
    let lost = null as ReturnType<typeof outpostHaul>;
    for (let day = 0; day < 40 && !lost; day++) {
      for (let slot = day * 288; slot < (day + 1) * 288; slot++) {
        for (const dir of ['out', 'in'] as const) {
          const h = outpostHaul(id, slot, dir);
          if (!h) continue;
          expect(systemEventAt(getLocation(h.from).systemId, h.depart)?.kind).not.toBe('raid');
          expect(systemEventAt(getLocation(h.to).systemId, h.depart)?.kind).not.toBe('raid');
          if (dir === 'in' && !lost && !haulFate(h).delivered) lost = h;
        }
      }
    }
    expect(lost).not.toBeNull();
    expect(haulStock(id, lost!.commodity, lost!.arrive + 60)).toBeLessThan(0);
    expect(outpostDockings(id, lost!.depart, lost!.arrive + 60).some((x) => x.haul.id === lost!.id)).toBe(false);
  });
});

describe('dock fees', () => {
  it('a few per cent of each cargo, paid with the hour’s income, the same however often settled', () => {
    const { s, o } = withOutpost(2);
    const expected = Array.from({ length: 24 }, (_, i) => incomeAt(o, i * HOUR + HOUR / 2)).reduce((a, b) => a + b, 0);
    const fees = dockFees(POST, 0, 24 * HOUR);
    expect(fees).toBeGreaterThan(0);
    expect(fees).toBe(outpostDockings(POST, 0, 24 * HOUR).reduce((sum, d) => sum + Math.round(0.03 * d.haul.qty * COMMODITIES[d.haul.commodity].basePrice), 0));
    s.clock = 24 * HOUR;
    const before = s.credits;
    expect(settleFleet(s).outpost).toBe(expected + fees);
    expect(o.fees).toBe(fees);
    expect(o.earned).toBe(expected + fees);
    expect(s.credits - before).toBe(expected + fees);
    // Hour by hour, the same.
    const { s: t, o: p } = withOutpost(2);
    for (let h = 1; h <= 24; h++) {
      t.clock = h * HOUR - 1;
      settleFleet(t);
      t.clock = h * HOUR;
      settleFleet(t);
    }
    expect(p.fees).toBe(fees);
    expect(p.earned).toBe(expected + fees);
    // Typically some tens of credits an hour: within a quarter of the income.
    expect(fees / 24).toBeLessThan(OUTPOSTS.stages[1]!.income / 4);
  });

  it('away very long, only the last fee hours count their fees', () => {
    const { s, o } = withOutpost(1);
    s.clock = 100 * HOUR;
    settleFleet(s);
    expect(o.fees).toBe(dockFees(POST, (100 - OUTPOSTS.trade.feeHours) * HOUR, 100 * HOUR));
  });

  it('the Outpost window: who comes next, and the fees so far', () => {
    const { o } = withOutpost(3);
    o.fees = 1_234;
    const n = nextHauler(o, 5 * HOUR)!;
    expect(n.at).toBeGreaterThanOrEqual(5 * HOUR);
    const lines = haulerLines(o, 5 * HOUR);
    const cargo = `${n.haul.qty} ${COMMODITIES[n.haul.commodity].name.toLowerCase()}`;
    expect(lines.next).toContain(n.out ? `The ${n.haul.name} sets off in` : `The ${n.haul.name} docks in`);
    expect(lines.next).toContain(cargo);
    expect(lines.fees).toBe('Every hauler pays a dock fee of 3% of its cargo’s worth, with the hour’s income: 1,234 cr so far.');
    expect(dockFee({ commodity: 'metals', qty: 20 })).toBe(Math.round(0.03 * 20 * COMMODITIES.metals.basePrice));
    o.stage = 0;
    expect(nextHauler(o, 5 * HOUR)).toBeNull();
  });
});

describe('work on the boards', () => {
  /** Lawful boards within reach of the main belt, and their outpost jobs over many time slots. */
  function jobs(epochs: number) {
    const givers = ALL_LOCATIONS.filter((l) => l.services.includes('contracts') && l.stationType !== 'pirate-den' && l.status === 'functional' && (waysFrom('sol').get(l.systemId)?.length ?? 99) - 1 <= 2);
    const out: { giver: string; epoch: number; job: NonNullable<ReturnType<typeof postedContract>> }[] = [];
    let boards = 0;
    for (const g of givers.slice(0, 8)) {
      for (let epoch = 0; epoch < epochs; epoch++) {
        boards++;
        const job = boardFor(g.id, epoch).find((c) => c.id.endsWith('.outpost'));
        if (job) out.push({ giver: g.id, epoch, job });
      }
    }
    return { out, boards };
  }

  it('freight and passages to an outpost within reach, from their own stream', () => {
    withOutpost(2);
    const { out, boards } = jobs(40);
    expect(out.length / boards).toBeGreaterThan(0.2);
    expect(out.length / boards).toBeLessThan(0.5);
    const passages = out.filter((x) => x.job.contract?.kind === 'passage');
    const freight = out.filter((x) => x.job.contract?.kind === 'freight');
    expect(passages.length).toBeGreaterThan(0);
    expect(freight.length).toBeGreaterThan(0);
    for (const { giver, epoch, job } of out) {
      expect(job.destinationLocationId).toBe(POST);
      expect(job.id).toBe(`c.${giver}.${epoch}.outpost`);
      expect(job.briefing).toContain('is your own outpost');
      expect(postedContract(job.id)).toEqual(job);
      if (job.contract?.kind === 'freight') {
        const c = job.contract.cargo!.commodity;
        expect(made(giver)).toContain(c);
        expect(marketTables().get(POST)!.entries.get(c)!.role).not.toBe('produce');
      }
    }
    // The rest of each board is as it would be without the outpost.
    const { out: again } = jobs(4);
    useWorldLog(null);
    for (const { giver, epoch } of again) {
      const without = boardFor(giver, epoch);
      expect(without.some((c) => c.id.endsWith('.outpost'))).toBe(false);
      const { s } = withOutpost(2);
      void s;
      expect(boardFor(giver, epoch).filter((c) => !c.id.endsWith('.outpost'))).toEqual(without);
      useWorldLog(null);
    }
  });

  it('none to an outpost still being built, and none from a den', () => {
    withOutpost(0);
    expect(jobs(10).out).toEqual([]);
    withOutpost(2);
    const den = ALL_LOCATIONS.find((l) => l.stationType === 'pirate-den' && l.status === 'functional')!;
    for (let epoch = 0; epoch < 20; epoch++) expect(boardFor(den.id, epoch).some((c) => c.id.endsWith('.outpost'))).toBe(false);
  });

  it('a job bound for it under way keeps it from being given up', () => {
    const { s, o } = withOutpost(2);
    const { out } = jobs(40);
    const job = out.find((x) => x.job.contract?.kind === 'freight' && !x.job.requires)!;
    s.location = { systemId: getLocation(job.giver).systemId, dockedAt: job.giver, flight: null, lastDockId: job.giver };
    s.ship.cargo = {};
    s.credits = 1_000_000;
    const r = acceptJob(s, job.job.id);
    expect(r.message).not.toMatch(/no longer posted/);
    // Whether or not this ship could take it, a job bound for the outpost under way blocks it.
    s.contracts[job.job.id] = job.job;
    s.jobs[job.job.id] = { status: 'active', objectiveIndex: 0, acceptedAt: 0 };
    expect(giveUpBlock(s, o)).toMatch(/job/);
    // The waypoint leads there, and docked there with the cargo it is delivered and paid.
    expect(describeObjective(s, job.job.id)).toMatchObject({ targetSystemId: 'sol', targetLocationId: POST });
    const cargo = job.job.contract!.cargo!;
    s.ship.cargo = { [cargo.commodity]: cargo.qty };
    s.location = { systemId: 'sol', dockedAt: POST, flight: null, lastDockId: POST };
    const before = s.credits;
    const done = deliverJob(s, job.job.id, POST);
    expect(done.ok).toBe(true);
    expect(s.credits).toBeGreaterThan(before);
    expect(giveUpBlock(s, o)).toBeNull();
  });
});

describe('neighbours and the map', () => {
  it('an outpost’s market is a neighbour both ways, and the spill reaches it', () => {
    withOutpost(1);
    // A good both trade.
    const c = [...marketTables().get(POST)!.entries.keys()].find((x) => marketTables().get('earth-port')!.entries.has(x))!;
    expect(c).toBeDefined();
    expect(spillNeighbours('earth-port', c)).toContain(POST);
    expect(spillNeighbours(POST, c)).toContain('earth-port');
    useWorldLog(null);
    expect(spillNeighbours('earth-port', c)).not.toContain(POST);
    // A glut the pilot leaves at Earth Port drifts to the outpost half an hour on.
    const { s } = withOutpost(1);
    const entry = marketTables().get('earth-port')!.entries.get(c)!;
    const quiet = stockAvailable(POST, c, { clock: 1_800, markets: s.markets });
    moveStock(s.markets, 'earth-port', c, entry.target * 2, 0);
    expect(stockAvailable(POST, c, { clock: 1_800, markets: s.markets })).toBeGreaterThan(quiet);
  });

  it('the star map’s search finds the pilot’s outposts by name', () => {
    withOutpost(1);
    const hits = searchSystems('Copperleaf', {}, [...searchIndex(), ...outpostEntries(saveLocations())]);
    expect(hits[0]).toMatchObject({ systemId: 'sol', kind: 'outpost', name: 'Copperleaf Stillworks' });
    expect(searchSystems('Copperleaf').some((h) => h.kind === 'outpost')).toBe(false);
  });
});

describe('the calls go, and saves', () => {
  it('no calls left in the rules', () => {
    expect('calls' in OUTPOSTS).toBe(false);
  });

  it('a save keeps the fees, and refuses broken ones', () => {
    const { s, o } = withOutpost(1);
    s.clock = 6 * HOUR;
    settleFleet(s);
    expect(o.fees).toBeGreaterThan(0);
    const back = migrateSave(JSON.parse(JSON.stringify(s)));
    expect(back.world.outposts![0]!.fees).toBe(o.fees);
    for (const fees of [-1, 1.5, o.earned + 1]) {
      const bad = structuredClone(s);
      bad.world.outposts![0]!.fees = fees;
      expect(() => assertValidState(bad)).toThrow();
    }
  });
});
