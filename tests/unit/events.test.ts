import { describe, expect, it } from 'vitest';
import { performJump } from '../../src/app/rules.ts';
import { createNewGame } from '../../src/app/state.ts';
import { CONTRACTS } from '../../src/content/contracts/rules.ts';
import { createHash } from 'node:crypto';
import { EVENTS, STRANDED_NAMES, type EventKind } from '../../src/content/events/rules.ts';
import { formatIssues } from '../../src/content/validate.ts';
import { getLocation, getSystem, isFrontier, SYSTEMS } from '../../src/data/systems.ts';
import { boardFor } from '../../src/economy/contracts.ts';
import { validateEvents } from '../../src/economy/eventGuards.ts';
import { baseThreat, eventsAt, eventStations, marketEffect, newsAt, stationEventAt, stationEventsBetween, surveyPlanets, systemEventAt, systemEventsBetween, type WorldEvent } from '../../src/economy/events.ts';
import { marketEntry, moveStock, quote, stockNow } from '../../src/economy/markets.ts';
import { findRoute } from '../../src/galaxy/routing.ts';
import { trafficFor } from '../../src/world/traffic/setup.ts';

/** World events (docs/PROCGEN.md §11): guardrails, markets, traffic, news and the work they create. */

const REP = { sta: 0, frontier: 0, 'hollow-wake': 0 };

/** The frontier's own events (increment 14), and the fingerprint of every other event before they came. */
const FRONTIER_KINDS: readonly EventKind[] = ['harvest', 'survey', 'stranded'];
const OLD_EVENTS = 'aaf473f61b3f2d41';

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
  }, 60_000);

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
    const wanted = ['bounty', 'freight', 'supply'];
    for (let epoch = 0; epoch < 60 && !wanted.every((k) => found.has(k)); epoch++) {
      const clock = epoch * CONTRACTS.epochSeconds;
      for (const id of eventStations()) {
        for (const c of boardFor(id, epoch)) {
          const ev = c.contract?.event;
          // An escort for a haul answers its haul's event, often at another station (checked in gluts.test.ts).
          if (!ev || c.contract!.haul) continue;
          if (c.contract!.kind === 'bounty') {
            const o = c.objectives[0]!;
            if (o.kind !== 'bounty') throw new Error('raid work hunts raiders');
            const raid = systemEventAt(o.systemId, clock)!;
            expect(raid.id).toBe(ev);
            expect(o.level).toBe(raid.level);
            expect(c.title).toMatch(/^Raid response/);
          } else if (c.contract!.kind !== 'rescue') {
            expect(stationEventAt(id, clock)?.id).toBe(ev);
          }
          found.add(c.contract!.kind);
        }
      }
    }
    expect([...found]).toEqual(expect.arrayContaining(wanted));
  });

  it('leave every event there was before the frontier’s own exactly as it was (100 hours, fingerprinted)', () => {
    const h = createHash('sha256');
    const seen = new Set<string>();
    // As scheduled: a shortage its relief hauls end early (§21) is still the event it was.
    const scheduledAt = (clock: number) =>
      [...eventStations().flatMap((id) => stationEventsBetween(id, clock, clock)), ...SYSTEMS.flatMap((x) => systemEventsBetween(x.id, clock, clock))].filter((e) => e.start <= clock && clock < e.end);
    for (let clock = 0; clock < 100 * 3_600; clock += 900) {
      for (const e of scheduledAt(clock)) {
        if (FRONTIER_KINDS.includes(e.kind) || seen.has(e.id)) continue;
        seen.add(e.id);
        h.update(JSON.stringify([e.id, e.kind, e.start, e.end, e.goods, e.price, e.stock, e.level]));
      }
    }
    expect([seen.size, h.digest('hex').slice(0, 16)]).toEqual([6_555, OLD_EVENTS]);
  });
});

describe('the frontier’s own events (docs/PROCGEN.md §11)', () => {
  it('a harvest comes in only at a frontier farm: its food floods the market and wants hauling', () => {
    const e = first('harvest');
    const farm = getLocation(e.locationId!);
    expect(isFrontier(farm.systemId)).toBe(true);
    expect(farm.stationType).toBe('agri-station');
    expect(e.headline).toBe(`Harvest in at ${farm.name}`);
    const g = e.goods[0]!;
    expect(['food', 'fine-food']).toContain(g);
    const cheap = quote(farm.id, g, REP, { clock: e.start + 1, markets: {} }).buy!;
    const usual = quote(farm.id, g, REP, { clock: e.start - 1, markets: {} }).buy!;
    expect(cheap).toBeLessThan(usual * 0.8);
    const epoch = Math.ceil(e.start / CONTRACTS.epochSeconds);
    if (epoch * CONTRACTS.epochSeconds < e.end) {
      const haul = boardFor(farm.id, epoch).find((c) => c.contract?.event === e.id);
      expect(haul?.title).toMatch(/^Harvest haul: /);
      expect(haul?.contract?.cargo?.commodity).toBe(g);
    }
  });

  it('a survey season at a frontier research post studies a real planet nearby, and never settles a contested one', () => {
    const e = first('survey', 0, (x) => surveyPlanets(x.locationId!).some((p) => p.contested));
    const post = getLocation(e.locationId!);
    expect(isFrontier(post.systemId)).toBe(true);
    expect(post.stationType).toBe('research-station');
    const planet = surveyPlanets(post.id).find((p) => p.id === e.bodyId)!;
    expect(planet.contested).toBe(true);
    expect(getSystem(planet.systemId).confirmedBodies.find((p) => p.id === planet.id)?.status).not.toBe('confirmed');
    expect(e.detail).toContain(`${planet.name}, a planet the archives disagree about`);
    expect(e.detail).toMatch(/settle nothing the archives do not/);
    // Its board wants that planet surveyed, and says the readings settle nothing.
    for (let epoch = Math.ceil(e.start / CONTRACTS.epochSeconds); epoch * CONTRACTS.epochSeconds < e.end; epoch++) {
      const work = boardFor(post.id, epoch).find((c) => c.contract?.event === e.id);
      if (!work) continue;
      expect(work.title).toBe(`Survey season: ${planet.name}`);
      expect(work.objectives[0]).toMatchObject({ kind: 'scan', bodyId: planet.id });
      expect(work.briefing).toMatch(/only the archives can settle it/);
      return;
    }
  });

  it('a drive failure strands a named colony hauler in a frontier system, far from any dock', () => {
    const e = first('stranded');
    expect(isFrontier(e.systemId)).toBe(true);
    expect(e.locationId).toBeNull();
    expect(STRANDED_NAMES).toContain(e.ship);
    expect(e.headline).toBe(`Drive failure in ${getSystem(e.systemId).displayName}`);
    expect(e.detail).toContain(`The ${e.ship}, a colony hauler`);
    // It moves no prices and no traffic.
    expect(trafficFor(e.systemId, 'high', e.start + 1).plan).toEqual(trafficFor(e.systemId, 'high', e.start - 1).plan);
  });

  it('happen nowhere else', () => {
    for (let clock = 0; clock < 100 * 3_600; clock += 1_800) {
      for (const e of eventsAt(clock)) if (FRONTIER_KINDS.includes(e.kind)) expect(isFrontier(e.systemId), e.id).toBe(true);
    }
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
