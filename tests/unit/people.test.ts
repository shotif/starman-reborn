import { describe, expect, it } from 'vitest';
import { migrateSave } from '../../src/app/save/migrate.ts';
import { createNewGame, type GameState } from '../../src/app/state.ts';
import { PEOPLE } from '../../src/content/people/rules.ts';
import { CHARACTERS } from '../../src/content/story/arcs.ts';
import { ALL_LOCATIONS, getLocation, getSystem } from '../../src/data/systems.ts';
import { COMMODITIES, COMMODITY_IDS } from '../../src/economy/commodities.ts';
import { expectedTrip, routeFeeBetween } from '../../src/economy/contracts.ts';
import { eventsStarting } from '../../src/economy/events.ts';
import { moveStock } from '../../src/economy/markets.ts';
import { barKind, buyDrink, peopleAt, regularsAt, rumourFor, shiftAt } from '../../src/economy/people.ts';
import { liveQuote, recordMarketVisit } from '../../src/economy/trade.ts';
import { toggleWatch, tradeRoutes, watchOnDock } from '../../src/economy/tradeComputer.ts';
import { hasMarket } from '../../src/economy/markets.ts';

/** People in the bars, rumours, the price watch and the trade computer (docs/PROCGEN.md §16). */

function pilot(): GameState {
  const s = createNewGame(31);
  s.jobs.lifeline = { status: 'complete', objectiveIndex: 4, acceptedAt: 0, completedAt: 1 };
  s.credits = 5_000;
  return s;
}

const bars = ALL_LOCATIONS.filter((l) => l.status === 'functional' && l.dockable !== false && barKind(l.id));

describe('people in the bars', () => {
  it('every dock has a bar of regulars, the same for everyone in a shift and different in the next', () => {
    for (const l of bars) {
      const a = regularsAt(l.id, 10_000);
      expect(a.length).toBeGreaterThanOrEqual(PEOPLE.count[0]);
      expect(a.length).toBeLessThanOrEqual(PEOPLE.count[1]);
      expect(regularsAt(l.id, 10_000)).toEqual(a);
      for (const p of a) {
        expect(PEOPLE.regulars[barKind(l.id)!]).toContain(p.role);
        expect(p.name).toMatch(/^\S+ \S+$/);
        expect(p.greeting.length).toBeGreaterThan(10);
      }
    }
    const port = bars.find((l) => barKind(l.id) === 'trade-port')!;
    const next = 10_000 + PEOPLE.shift * 1_500 * 3;
    expect(shiftAt(next)).not.toBe(shiftAt(10_000));
    expect(regularsAt(port.id, next).map((p) => p.name)).not.toEqual(regularsAt(port.id, 10_000).map((p) => p.name));
  });

  it('story characters sit in their own bars, and pilots for hire are people too', () => {
    const s = pilot();
    for (const c of Object.values(CHARACTERS)) {
      expect(peopleAt(s, c.locationId).some((p) => p.story === c.id && p.name === c.name)).toBe(true);
    }
    const base = ALL_LOCATIONS.find((l) => l.stationType === 'military-base' && l.status === 'functional')!;
    expect(peopleAt(s, base.id).some((p) => p.pilot)).toBe(true);
  });
});

describe('rumours are true', () => {
  it('whatever anyone says in any bar, at any time, holds in the game', { timeout: 60_000 }, () => {
    const s = pilot();
    let told = 0;
    for (const clock of [5_000, 40_000, 90_000]) {
      s.clock = clock;
      for (const l of bars) {
        for (const p of regularsAt(l.id, clock)) {
          const fact = rumourFor(s, l.id, p);
          if (!fact) continue;
          told++;
          expect(fact.text).not.toMatch(/\{\w+\}/);
          if (fact.kind === 'price') {
            const q = liveQuote(s, fact.price!.locationId, fact.price!.commodity);
            const loc = getLocation(fact.price!.locationId);
            expect(fact.text).toContain(loc.name);
            expect(fact.text).toContain(COMMODITIES[fact.price!.commodity].name.toLowerCase());
            expect([q.buy, q.sell].some((v) => v !== null && fact.text.includes(`${v} cr`))).toBe(true);
          }
          if (fact.kind === 'event') {
            const soon = eventsStarting(clock, clock + PEOPLE.rumour.soon);
            expect(soon.some((e) => fact.text.includes(e.headline.slice(1)))).toBe(true);
          }
          if (fact.kind === 'den') expect(ALL_LOCATIONS.some((d) => d.stationType === 'pirate-den' && fact.text.includes(d.name))).toBe(true);
          if (fact.kind === 'ace' || fact.kind === 'wreck') expect(ALL_LOCATIONS.some((d) => fact.text.includes(d.name))).toBe(true);
        }
      }
    }
    expect(told).toBeGreaterThan(20);
  });

  it('a price tip is worth more than the round it costs', () => {
    const s = pilot();
    s.clock = 40_000;
    let tips = 0;
    for (const l of bars) {
      for (const p of regularsAt(l.id, s.clock)) {
        const fact = rumourFor(s, l.id, p);
        if (fact?.kind !== 'price') continue;
        tips++;
        expect(fact.price!.value).toBeGreaterThanOrEqual(PEOPLE.rumour.minTipDrinks * PEOPLE.drink);
      }
    }
    expect(tips).toBeGreaterThan(0);
  });

  it('a round buys one true thing a shift: charged once, the price learned, then nothing new', () => {
    const s = pilot();
    s.clock = 40_000;
    let done = false;
    for (const l of bars) {
      for (const p of regularsAt(l.id, s.clock)) {
        const fact = rumourFor(s, l.id, p);
        if (fact?.kind !== 'price') continue;
        s.location.dockedAt = l.id;
        const credits = s.credits;
        const r = buyDrink(s, l.id, p.id);
        expect(r).toMatchObject({ ok: true, cost: PEOPLE.drink });
        expect(s.credits).toBe(credits - PEOPLE.drink);
        const known = s.knownMarkets[fact.price!.locationId]!;
        expect(known.prices[fact.price!.commodity]).toEqual(liveQuote(s, fact.price!.locationId, fact.price!.commodity));
        expect(s.rumours.at(-1)).toMatchObject({ kind: 'price', locationId: l.id });
        const again = buyDrink(s, l.id, p.id);
        expect(again.ok).toBe(false);
        expect(s.credits).toBe(credits - PEOPLE.drink);
        done = true;
        break;
      }
      if (done) break;
    }
    expect(done).toBe(true);
  });

  it('nothing worth telling costs nothing', () => {
    const s = pilot();
    s.clock = 40_000;
    for (const l of bars) {
      for (const p of regularsAt(l.id, s.clock)) {
        if (rumourFor(s, l.id, p)) continue;
        const credits = s.credits;
        expect(buyDrink(s, l.id, p.id)).toMatchObject({ ok: true, cost: 0, rumour: null });
        expect(s.credits).toBe(credits);
        return;
      }
    }
  });
});

describe('the trade computer', () => {
  const sol = ALL_LOCATIONS.filter((l) => l.systemId === 'sol' && hasMarket(l.id) && l.dockable !== false);

  it('knows nothing it has not been told', () => {
    const s = pilot();
    expect(tradeRoutes(s, null)).toEqual([]);
    s.location.dockedAt = sol[0]!.id;
    // Docked with no other market known: nothing to sell anywhere.
    expect(tradeRoutes(s, sol[0]!.id)).toEqual([]);
  });

  it('ranks routes between prices seen, by profit per minute, with fees, trip time and ages', () => {
    const s = pilot();
    for (const l of ALL_LOCATIONS.filter((x) => hasMarket(x.id) && x.dockable !== false).slice(0, 12)) {
      s.clock += 600;
      recordMarketVisit(s, l.id);
    }
    const routes = tradeRoutes(s, null, { limit: 50 });
    expect(routes.length).toBeGreaterThan(0);
    for (let i = 1; i < routes.length; i++) expect(routes[i - 1]!.perMinute).toBeGreaterThanOrEqual(routes[i]!.perMinute);
    for (const r of routes) {
      expect(s.knownMarkets[r.from]!.prices[r.commodity]!.buy).toBe(r.buy);
      expect(s.knownMarkets[r.to]!.prices[r.commodity]!.sell).toBe(r.sell);
      const a = getLocation(r.from).systemId;
      const b = getLocation(r.to).systemId;
      expect(r.fees).toBeGreaterThanOrEqual(routeFeeBetween(a, b));
      expect(r.minutes).toBeGreaterThanOrEqual(Math.round(expectedTrip(a, b) / 60));
      expect(r.profit).toBe(r.items * (r.sell - r.buy) - r.fees);
      expect(r.items * COMMODITIES[r.commodity].unitSize).toBeLessThanOrEqual(80);
    }
    // Docked: routes from here use the live price.
    const here = routes[0]!.from;
    s.location.dockedAt = here;
    s.location.systemId = getLocation(here).systemId;
    const fromHere = tradeRoutes(s, here, { fromHere: true });
    for (const r of fromHere) {
      expect(r.from).toBe(here);
      expect(r.buyAge).toBe(0);
    }
  });
});

describe('the price watch', () => {
  it('watches up to its limit, and docking within reach brings the price, reporting a real move', () => {
    const s = pilot();
    const watched = ALL_LOCATIONS.find((l) => l.systemId === 'sol' && hasMarket(l.id) && l.id !== 'earth-port' && l.dockable !== false)!;
    const c = COMMODITY_IDS.find((x) => liveQuote(s, watched.id, x).sell !== null && liveQuote(s, watched.id, x).buy !== null)!;
    recordMarketVisit(s, watched.id);
    expect(toggleWatch(s, watched.id, c)).toMatchObject({ ok: true, watching: true });
    // A big sale there lowers what it pays.
    s.clock += 60;
    moveStock(s.markets, watched.id, c, 400, s.clock);
    const notes = watchOnDock(s, 'earth-port');
    expect(notes).toHaveLength(1);
    expect(notes[0]!.text).toContain(watched.name);
    expect(s.knownMarkets[watched.id]!.goodsAt?.[c]).toEqual({ t: s.clock, via: 'watch' });
    // Far away, nothing comes.
    const far = ALL_LOCATIONS.find((l) => l.status === 'functional' && l.dockable !== false && getSystem(l.systemId).distanceLightYears > 12)!;
    const before = structuredClone(s.knownMarkets[watched.id]);
    s.clock += 60;
    watchOnDock(s, far.id);
    expect(s.knownMarkets[watched.id]).toEqual(before);
    expect(toggleWatch(s, watched.id, c)).toMatchObject({ ok: true, watching: false });
    for (const x of COMMODITY_IDS.slice(0, PEOPLE.watch.max)) toggleWatch(s, watched.id, x);
    expect(toggleWatch(s, watched.id, COMMODITY_IDS[PEOPLE.watch.max]!).ok).toBe(false);
  });
});

describe('saves', () => {
  it('a v8 save gets an empty watch and nothing heard; damaged records are rejected', () => {
    const { priceWatch: _w, rumours: _r, ...rest } = createNewGame(3);
    const s = migrateSave({ ...structuredClone(rest), version: 8 });
    expect(s.priceWatch).toEqual([]);
    expect(s.rumours).toEqual([]);
    expect(() => migrateSave({ ...structuredClone(s), priceWatch: [{ locationId: 'nowhere', commodity: 'water' }] })).toThrow();
    expect(() => migrateSave({ ...structuredClone(s), rumours: [{ key: 'x', kind: 'gossip', text: 'x', at: 0, locationId: 'earth-port' }] })).toThrow();
  });
});
