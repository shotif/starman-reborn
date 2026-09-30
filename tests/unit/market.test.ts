import { describe, expect, it } from 'vitest';
import { createNewGame } from '../../src/app/state.ts';
import { COMMODITIES, COMMODITY_IDS, PRICE_BAND } from '../../src/content/economy/goods.ts';
import { buildMarkets, type MarketStationInput } from '../../src/content/economy/markets.ts';
import { validateEconomy } from '../../src/content/economy/validate.ts';
import { rng } from '../../src/content/random.ts';
import { formatIssues } from '../../src/content/validate.ts';
import { generateWorld } from '../../src/content/world/generate.ts';
import { ALL_LOCATIONS, CORE_SEEDS, GROWTH_SEEDS, WORLD } from '../../src/data/systems.ts';
import { baseQuote, marketTables, quote, stockNow } from '../../src/economy/markets.ts';
import { buyCommodity, liveQuote, maxBuyable, sellCommodity } from '../../src/economy/trade.ts';

/**
 * The economy (docs/PROCGEN.md §8): guardrails on the equilibrium tables for the real world and
 * other seeds, and properties of live pricing over many market states.
 */

const REPS = [-100, -30, 0, 12, 30, 100].map((v) => ({ sta: v, frontier: v, 'hollow-wake': v }));

describe('economy guardrails', () => {
  it('pass for the world every player flies', () => {
    expect(formatIssues(validateEconomy(marketTables(), WORLD.links))).toBe('');
  });

  it('pass for other world seeds too', () => {
    const generated = new Set(WORLD.stations.map((s) => s.id));
    const curated: MarketStationInput[] = ALL_LOCATIONS.filter((l) => !generated.has(l.id) && l.status === 'functional' && l.services.includes('market')).map((l) => ({
      id: l.id,
      systemId: l.systemId,
      type: null,
      size: 0.8,
      security: 1,
    }));
    for (const seed of [11, 4242, 90_001, 123_457]) {
      const world = generateWorld(CORE_SEEDS, seed, GROWTH_SEEDS);
      const stations: MarketStationInput[] = [
        ...curated,
        ...world.stations
          .filter((s) => s.dockable && s.services.includes('market'))
          .map((s) => ({ id: s.id, systemId: s.systemId, type: s.type, size: s.look.size, security: world.profiles.get(s.systemId)!.security })),
      ];
      const markets = buildMarkets(stations, world.links, seed);
      expect(formatIssues(validateEconomy(markets, world.links)), `seed ${seed}`).toBe('');
    }
  });

  it('gives every station with a market service a market of several goods', () => {
    for (const l of ALL_LOCATIONS.filter((x) => x.status === 'functional' && x.services.includes('market') && x.dockable !== false)) {
      const m = marketTables().get(l.id);
      expect(m, l.id).toBeDefined();
      expect(m!.entries.size, l.id).toBeGreaterThanOrEqual(3);
    }
    expect(COMMODITY_IDS.length).toBeGreaterThanOrEqual(20);
  });

  it('keeps the designed opening prices of the first contracts', () => {
    expect(baseQuote('earth-port', 'medical')).toEqual({ buy: 38, sell: 32 });
    expect(baseQuote('mars-depot', 'medical')).toEqual({ buy: 60, sell: 54 });
    expect(baseQuote('meridian-outpost', 'medical')).toEqual({ buy: null, sell: 96 });
    expect(baseQuote('eridani-hub', 'deuterium')).toEqual({ buy: 48, sell: 40 });
  });
});

describe('live prices', () => {
  const tables = [...marketTables().values()];

  it('stay inside the bands and never let a dock buy back above its selling price', () => {
    const r = rng(7, 'live-prices');
    for (let i = 0; i < 1_500; i++) {
      const m = r.pick(tables);
      const entry = r.pick([...m.entries.values()]);
      const clock = r.range(0, 200_000);
      const stock = r.pick([0, 1, entry.target * 0.3, entry.target, entry.target * 4]);
      const ctx = { clock, markets: { [m.locationId]: { t: clock, stock: { [entry.commodity]: stock } } } };
      const q = quote(m.locationId, entry.commodity, r.pick(REPS), ctx);
      const base = COMMODITIES[entry.commodity].basePrice;
      for (const p of [q.buy, q.sell]) {
        if (p === null) continue;
        expect(p).toBeGreaterThanOrEqual(Math.floor(base * PRICE_BAND[0]));
        expect(p).toBeLessThanOrEqual(Math.ceil(base * PRICE_BAND[1]));
      }
      if (q.buy !== null && q.sell !== null) expect(q.buy).toBeGreaterThan(q.sell);
      expect(q.buy === null).toBe(entry.role === 'consume');
    }
  });

  it('never pays out a buy-and-sell-back round trip at one dock, at any standing', () => {
    for (const m of tables) {
      for (const entry of m.entries.values()) {
        if (entry.role === 'consume') continue;
        for (const value of [0, 100]) {
          const s = createNewGame(3);
          s.credits = 10_000_000;
          s.ship.cargo = {};
          s.ship.model = 'ship.freighter.3.eridani';
          s.reputation = { sta: value, frontier: value, 'hollow-wake': value };
          s.location.dockedAt = m.locationId;
          const qty = Math.min(12, maxBuyable(s, m.locationId, entry.commodity));
          if (qty <= 0) continue;
          const before = s.credits;
          expect(buyCommodity(s, m.locationId, entry.commodity, qty).ok).toBe(true);
          expect(sellCommodity(s, m.locationId, entry.commodity, qty).ok).toBe(true);
          expect(s.credits, `${m.locationId}/${entry.commodity}`).toBeLessThan(before);
        }
      }
    }
  });

  it('moves with stock and recovers toward normal over time', () => {
    const s = createNewGame(4);
    s.credits = 100_000;
    const entry = marketTables().get('earth-port')!.entries.get('electronics')!;
    const fresh = liveQuote(s, 'earth-port', 'electronics').buy!;
    buyCommodity(s, 'earth-port', 'electronics', 15);
    const after = liveQuote(s, 'earth-port', 'electronics').buy!;
    expect(after).toBeGreaterThan(fresh);
    const drained = stockNow('earth-port', entry, { clock: s.clock, markets: s.markets });
    expect(drained).toBeCloseTo(entry.target - 15, 5);
    const later = stockNow('earth-port', entry, { clock: s.clock + 1_800, markets: s.markets });
    expect(later).toBeGreaterThan(drained);
    expect(entry.target - later).toBeCloseTo(15 * Math.exp(-1), 1);
  });

  it('drifts slowly with the game clock, starting from the designed price', () => {
    const q0 = quote('earth-port', 'electronics', REPS[2]!).buy!;
    const seen = new Set<number>();
    for (let t = 0; t <= 20_000; t += 1_000) seen.add(quote('earth-port', 'electronics', REPS[2]!, { clock: t, markets: {} }).buy!);
    expect(seen.size).toBeGreaterThan(3);
    for (const p of seen) expect(Math.abs(p - q0) / q0).toBeLessThan(0.15);
  });
});
