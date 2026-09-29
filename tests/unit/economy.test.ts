import { describe, expect, it } from 'vitest';
import { createNewGame } from '../../src/app/state.ts';
import { addCargo, CARGO_CAPACITY, cargoFree, cargoUsed, itemsThatFit, removeCargo } from '../../src/economy/cargo.ts';
import { buyShopItem, repairHull, repairQuote, SHIELDS } from '../../src/economy/equipment.ts';
import { adjustReputation, standingTier } from '../../src/economy/factions.ts';
import { baseQuote, quote } from '../../src/economy/markets.ts';
import {
  buyCommodity,
  maxBuyable,
  recordMarketVisit,
  routeOpportunities,
  sellCommodity,
} from '../../src/economy/trade.ts';
import { welcomeText } from '../../src/economy/dockText.ts';

describe('cargo bounds', () => {
  it('counts unit sizes and refuses overflow', () => {
    const cargo = {};
    addCargo(cargo, 'deuterium', 3); // 9 units
    addCargo(cargo, 'fabricators', 2); // 4 units
    expect(cargoUsed(cargo)).toBe(13);
    expect(cargoFree(cargo)).toBe(CARGO_CAPACITY - 13);
    expect(itemsThatFit(cargo, 'deuterium')).toBe(2);
    expect(() => addCargo(cargo, 'deuterium', 3)).toThrow(RangeError);
    expect(() => addCargo(cargo, 'medical', 0)).toThrow(RangeError);
    expect(() => addCargo(cargo, 'medical', 1.5)).toThrow(RangeError);
    addCargo(cargo, 'medical', 7);
    expect(cargoFree(cargo)).toBe(0);
  });

  it('refuses to remove more than carried and deletes empty entries', () => {
    const cargo: Record<string, number> = {};
    addCargo(cargo, 'medical', 2);
    expect(() => removeCargo(cargo, 'medical', 3)).toThrow(RangeError);
    removeCargo(cargo, 'medical', 2);
    expect(cargo).toEqual({});
  });
});

describe('trade arithmetic', () => {
  it('buys and sells with exact credit changes', () => {
    const s = createNewGame(1);
    const price = quote('earth-port', 'medical', s.reputation).buy!;
    const r = buyCommodity(s, 'earth-port', 'medical', 10);
    expect(r).toEqual({ ok: true, qty: 10, unitPrice: price, total: price * 10 });
    expect(s.credits).toBe(800 - price * 10);
    expect(s.ship.cargo.medical).toBe(10);
    const sellPrice = quote('mars-depot', 'medical', s.reputation).sell!;
    const r2 = sellCommodity(s, 'mars-depot', 'medical', 4);
    expect(r2.ok && r2.total).toBe(sellPrice * 4);
    expect(s.credits).toBe(800 - price * 10 + sellPrice * 4);
    expect(s.ship.cargo.medical).toBe(6);
  });

  it('rejects unaffordable, oversized, untraded and invalid orders without changing state', () => {
    const s = createNewGame(1);
    s.credits = 100;
    const before = structuredClone(s);
    expect(buyCommodity(s, 'earth-port', 'medical', 3)).toMatchObject({ ok: false, error: 'insufficient-credits' });
    s.credits = 100_000;
    expect(buyCommodity(s, 'earth-port', 'medical', CARGO_CAPACITY + 1)).toMatchObject({
      ok: false,
      error: 'insufficient-space',
    });
    expect(buyCommodity(s, 'earth-port', 'deuterium', 1)).toMatchObject({ ok: false, error: 'not-traded' });
    expect(buyCommodity(s, 'earth-port', 'medical', -2)).toMatchObject({ ok: false, error: 'invalid-quantity' });
    expect(sellCommodity(s, 'mars-depot', 'medical', 1)).toMatchObject({ ok: false, error: 'insufficient-cargo' });
    expect(s.ship.cargo).toEqual(before.ship.cargo);
  });

  it('limits max buyable by credits and by hold space', () => {
    const s = createNewGame(1);
    s.credits = 5 * 38 + 10;
    expect(maxBuyable(s, 'earth-port', 'medical')).toBe(5);
    s.credits = 1_000_000;
    expect(maxBuyable(s, 'earth-port', 'medical')).toBe(CARGO_CAPACITY);
    expect(maxBuyable(s, 'earth-port', 'fabricators')).toBe(CARGO_CAPACITY / 2);
  });

  it('never lets a dock buy back above its selling price', () => {
    const rep = { sta: 100, frontier: 100, 'hollow-wake': 0 };
    for (const loc of ['earth-port', 'mars-depot', 'sirius-platform', 'eridani-hub']) {
      for (const c of ['medical', 'fabricators', 'deuterium'] as const) {
        const q = quote(loc, c, rep);
        if (q.buy !== null && q.sell !== null) expect(q.buy).toBeGreaterThan(q.sell);
      }
    }
  });

  it('makes Earth -> Mars -> Proxima clearly profitable after fees and repairs', () => {
    const buy = baseQuote('earth-port', 'medical').buy!;
    const marsSell = baseQuote('mars-depot', 'medical').sell!;
    const proximaSell = baseQuote('meridian-outpost', 'medical').sell!;
    expect(marsSell).toBeGreaterThan(buy);
    expect(proximaSell - buy).toBeGreaterThan(50);
    // Full hold of medical supplies, typical repair bill of 120 cr and the full jump fee.
    const profit = (proximaSell - buy) * CARGO_CAPACITY - 120 - 80;
    expect(profit).toBeGreaterThan(800);
  });
});

describe('route returns use only known market data', () => {
  it('shows nothing until a destination market is visited or briefed', () => {
    const s = createNewGame(1);
    recordMarketVisit(s, 'earth-port');
    expect(routeOpportunities(s, 'earth-port', () => 80)).toEqual([]);
    recordMarketVisit(s, 'mars-depot');
    const opps = routeOpportunities(s, 'earth-port', () => 80);
    expect(opps.length).toBeGreaterThan(0);
    const med = opps.find((o) => o.commodity === 'medical' && o.destinationId === 'mars-depot')!;
    expect(med.profitPerItem).toBe(54 - 38);
    expect(med.travelCost).toBe(0); // same system
    expect(med.items).toBe(Math.min(Math.floor(800 / 38), CARGO_CAPACITY));
    expect(med.netProfit).toBe(med.profitPerItem * med.items);
  });

  it('subtracts jump fees for destinations in other systems', () => {
    const s = createNewGame(1);
    s.knownMarkets['meridian-outpost'] = { source: 'briefing', observedAt: 0, prices: { medical: { buy: null, sell: 96 } } };
    const [top] = routeOpportunities(s, 'earth-port', () => 83);
    expect(top!.destinationId).toBe('meridian-outpost');
    expect(top!.travelCost).toBe(83);
    expect(top!.netProfit).toBe((96 - 38) * top!.items - 83);
    expect(top!.source).toBe('briefing');
  });
});

describe('equipment, repairs and reputation effects', () => {
  it('installs the shield upgrade with a real capacity change', () => {
    const s = createNewGame(1);
    const r = buyShopItem(s, 'mars-depot', 'shield-mk2');
    expect(r.ok).toBe(true);
    expect(s.ship.shieldGenerator).toBe('shield-mk2');
    expect(s.ship.shield).toBe(SHIELDS['shield-mk2'].capacity);
    expect(SHIELDS['shield-mk2'].capacity).toBeGreaterThan(SHIELDS['shield-mk1'].capacity);
    expect(s.credits).toBe(800 - SHIELDS['shield-mk2'].price);
    expect(buyShopItem(s, 'mars-depot', 'shield-mk2').ok).toBe(false);
    expect(buyShopItem(s, 'earth-port', 'pulse-mk2').ok).toBe(false); // not sold at Earth
  });

  it('repairs only what the player can afford', () => {
    const s = createNewGame(1);
    s.ship.hull = 40;
    s.credits = 50;
    const r = repairHull(s, 'earth-port');
    expect(r.points).toBe(25);
    expect(s.ship.hull).toBe(65);
    expect(s.credits).toBe(0);
  });

  it('friendly Transit Authority standing discounts repairs and changes welcome text', () => {
    const s = createNewGame(1);
    s.ship.hull = 50;
    const neutral = repairQuote(s, 'mars-depot');
    const neutralText = welcomeText(s, 'mars-depot');
    adjustReputation(s.reputation, 'sta', 15);
    expect(standingTier(s.reputation.sta)).toBe('friendly');
    const friendly = repairQuote(s, 'mars-depot');
    expect(friendly.cost).toBeLessThan(neutral.cost);
    expect(welcomeText(s, 'mars-depot').text).not.toBe(neutralText.text);
    expect(welcomeText(s, 'mars-depot').improved).toBe(true);
  });

  it('friendly Frontier standing improves prices at Meridian Outpost', () => {
    const s = createNewGame(1);
    const before = quote('meridian-outpost', 'medical', s.reputation).sell!;
    adjustReputation(s.reputation, 'frontier', 20);
    expect(quote('meridian-outpost', 'medical', s.reputation).sell!).toBeGreaterThan(before);
  });

  it('clamps reputation to [-100, 100]', () => {
    const rep = { sta: 95, frontier: -95, 'hollow-wake': 0 };
    expect(adjustReputation(rep, 'sta', 20)).toBe(5);
    expect(adjustReputation(rep, 'frontier', -20)).toBe(-5);
  });
});
