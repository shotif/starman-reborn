import { describe, expect, it } from 'vitest';
import { performJump } from '../../src/app/rules.ts';
import { createNewGame } from '../../src/app/state.ts';
import { CONTRACTS } from '../../src/content/contracts/rules.ts';
import { EVENTS } from '../../src/content/events/rules.ts';
import { formatIssues } from '../../src/content/validate.ts';
import { getLocation, SYSTEMS } from '../../src/data/systems.ts';
import { boardFor } from '../../src/economy/contracts.ts';
import { validateEvents } from '../../src/economy/eventGuards.ts';
import { baseThreat, eventsAt, eventStations, marketEffect, newsAt, stationEventAt, systemEventAt, type WorldEvent } from '../../src/economy/events.ts';
import { marketEntry, marketTables, moveStock, normalStock, quote, stockNow, traderDelivery } from '../../src/economy/markets.ts';
import { findRoute } from '../../src/galaxy/routing.ts';
import { trafficFor } from '../../src/world/traffic/setup.ts';

/** World events (docs/PROCGEN.md §11): guardrails, markets, traffic, news and the work they create. */

const REP = { sta: 0, frontier: 0, 'hollow-wake': 0 };

/** The first event of a kind, scanning the clock minute by minute from `from`. */
function first(kind: WorldEvent['kind'], from = 0, match: (e: WorldEvent) => boolean = () => true): WorldEvent {
  for (let clock = from; clock < from + 200 * 3_600; clock += 300) {
    const e = eventsAt(clock).find((x) => x.kind === kind && match(x));
    if (e) return e;
  }
  throw new Error(`no ${kind} in 200 hours`);
}

describe('world events', () => {
  it('pass every guardrail over three hundred hours of play', () => {
    expect(formatIssues(validateEvents(300))).toBe('');
  });

  it('are a pure function of the clock, one at a time per place, and never touch Sol', () => {
    const a = eventsAt(12_345).map((e) => e.id);
    expect(eventsAt(12_345).map((e) => e.id)).toEqual(a);
    const e = first('shortage');
    expect(stationEventAt(e.locationId!, e.start)).toEqual(e);
    expect(stationEventAt(e.locationId!, e.end)).not.toEqual(e);
    expect(eventStations().some((id) => getLocation(id).systemId === 'sol')).toBe(false);
    for (let clock = 0; clock < 50 * 3_600; clock += 900) {
      for (const x of eventsAt(clock)) expect(x.systemId).not.toBe('sol');
    }
  });

  it('move prices: a shortage raises what the station pays, a glut lowers what it asks', () => {
    const s = first('shortage');
    const g = s.goods[0]!;
    const during = quote(s.locationId!, g, REP, { clock: s.start + 1, markets: {} }).sell!;
    const before = quote(s.locationId!, g, REP, { clock: s.start - 1, markets: {} }).sell!;
    expect(during).toBeGreaterThan(before * 1.25);
    const e = marketEntry(s.locationId!, g)!;
    expect(stockNow(s.locationId!, e, { clock: s.start + 1, markets: {} })).toBeCloseTo(e.target * EVENTS.effects.shortage.stock, 5);
    const glut = first('glut');
    const cheap = quote(glut.locationId!, glut.goods[0]!, REP, { clock: glut.start + 1, markets: {} }).buy!;
    const usual = quote(glut.locationId!, glut.goods[0]!, REP, { clock: glut.start - 1, markets: {} }).buy!;
    expect(cheap).toBeLessThan(usual * 0.8);
    expect(marketEffect(glut.locationId!, glut.goods[0]!, glut.end + 1)).toEqual({ price: 1, stock: 1 });
  });

  it('let stock the player moved recover toward the event-adjusted normal stock', () => {
    const s = first('shortage');
    const g = s.goods[0]!;
    const e = marketEntry(s.locationId!, g)!;
    const markets = {};
    moveStock(markets, s.locationId!, g, 40, s.start + 10);
    const soon = stockNow(s.locationId!, e, { clock: s.start + 20, markets });
    const later = stockNow(s.locationId!, e, { clock: s.start + 1_200, markets });
    expect(soon).toBeGreaterThan(later);
    expect(later).toBeGreaterThan(e.target * EVENTS.effects.shortage.stock);
  });

  it('raids bring nastier packs and fewer traders; sweeps clear the packs out', () => {
    const raid = first('raid');
    const calm = trafficFor(raid.systemId, 'high').plan;
    const during = trafficFor(raid.systemId, 'high', raid.start + 1).plan;
    expect(during.packs!.level).toBe(raid.level);
    expect(raid.level).toBe(Math.min(3, (baseThreat(raid.systemId) ?? 0) + 1));
    expect(during.packs!.max).toBe((calm.packs?.max ?? 0) + 1);
    expect(during.traders).toBeLessThanOrEqual(calm.traders);
    if (!systemEventAt(raid.systemId, raid.end + 1)) expect(trafficFor(raid.systemId, 'high', raid.end + 1).plan).toEqual(calm);
    const sweep = first('sweep');
    expect(trafficFor(sweep.systemId, 'high').plan.packs).not.toBeNull();
    const swept = trafficFor(sweep.systemId, 'high', sweep.start + 1).plan;
    expect(swept.packs).toBeNull();
    expect(swept.patrolWings).toBeGreaterThan(0);
  });

  it('make the news within two jumps, nearest first, and keep recent ones for a while', () => {
    const e = first('shortage');
    const news = newsAt(e.systemId, e.start + 60);
    expect(news.find((n) => n.event.id === e.id)).toMatchObject({ jumps: 0, active: true });
    for (let i = 1; i < news.length; i++) expect(Number(news[i - 1]!.active) * 10 - news[i - 1]!.jumps).toBeGreaterThanOrEqual(Number(news[i]!.active) * 10 - news[i]!.jumps);
    expect(news.every((n) => n.jumps <= EVENTS.newsJumps)).toBe(true);
    const after = newsAt(e.systemId, e.end + 60).find((n) => n.event.id === e.id);
    expect(after).toMatchObject({ active: false });
    expect(newsAt(e.systemId, e.end + EVENTS.newsRecent + 60).some((n) => n.event.id === e.id)).toBe(false);
    const far = SYSTEMS.find((s) => !newsAt(s.id, e.start + 60).some((n) => n.event.id === e.id));
    expect(far).toBeDefined();
  });

  it('post work that answers them: a shortage run, a surplus haul, a raid response', () => {
    const found = new Set<string>();
    for (let epoch = 0; epoch < 60 && found.size < 3; epoch++) {
      const clock = epoch * CONTRACTS.epochSeconds;
      for (const id of eventStations()) {
        for (const c of boardFor(id, epoch)) {
          const ev = c.contract?.event;
          if (!ev) continue;
          if (c.contract!.kind === 'bounty') {
            const o = c.objectives[0]!;
            if (o.kind !== 'bounty') throw new Error('raid work hunts raiders');
            const raid = systemEventAt(o.systemId, clock)!;
            expect(raid.id).toBe(ev);
            expect(o.level).toBe(raid.level);
            expect(c.title).toMatch(/^Raid response/);
          } else {
            expect(stationEventAt(id, clock)?.id).toBe(ev);
          }
          found.add(c.contract!.kind);
        }
      }
    }
    expect([...found].sort()).toEqual(['bounty', 'freight', 'supply']);
  });

  it('have traders top short stock up without flooding a market or emptying a maker', () => {
    const tables = marketTables();
    const [to, table] = [...tables].find(([, t]) => [...t.entries.values()].some((e) => e.role === 'consume'))!;
    const markets = {};
    let delivered = 0;
    for (let i = 0; i < 40; i++) {
      const flow = traderDelivery(null, to, `ship-${i}`, markets, 100 + i);
      if (!flow) continue;
      const e = table.entries.get(flow.commodity)!;
      expect(e.role).not.toBe('produce');
      moveStock(markets, to, flow.commodity, flow.qty, 100 + i);
      expect(stockNow(to, e, { clock: 100 + i, markets })).toBeLessThanOrEqual(normalStock(to, e, 100 + i) * 1.2 + 0.01);
      delivered++;
    }
    expect(delivered).toBeGreaterThan(0);
    // From a station, only what it makes, and never below most of its normal stock.
    const pair = [...tables].flatMap(([from, t]) =>
      [...tables].filter(([dest]) => dest !== from).map(([dest, d]) => ({ from, dest, ok: [...d.entries.values()].some((e) => e.role !== 'produce' && t.entries.get(e.commodity)?.role === 'produce') })),
    ).find((x) => x.ok)!;
    const flow = traderDelivery(pair.from, pair.dest, 'ship-x', {}, 50)!;
    expect(tables.get(pair.from)!.entries.get(flow.commodity)!.role).toBe('produce');
  });

  it('let time pass in the lanes: each jump moves the clock on', () => {
    const s = createNewGame(5);
    s.flags.clearance = true;
    s.credits = 10_000;
    const route = findRoute(SYSTEMS, 'sol', 'epsilon-eridani')!;
    const before = s.clock;
    performJump(s, route, route.totalFee);
    expect(s.clock - before).toBe(route.hops.length * EVENTS.jumpSeconds);
  });
});
