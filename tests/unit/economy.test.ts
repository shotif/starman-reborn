import { describe, expect, it } from 'vitest';
import { createNewGame } from '../../src/app/state.ts';
import { addCargo, CARGO_CAPACITY, cargoFree, cargoUsed, itemsThatFit, removeCargo } from '../../src/economy/cargo.ts';
import { findGear, shipModel } from '../../src/content/catalog.ts';
import {
  ammoOffers,
  buyAmmo,
  buyGear,
  buyRepairKit,
  buyShip,
  gearOffer,
  gearOffers,
  repairHull,
  repairQuote,
  sellGear,
  sellQuote,
  shipOffers,
  tradeInValue,
} from '../../src/economy/equipment.ts';
import { cargoCapacity, hullMax, performanceOf, shieldCapacity } from '../../src/economy/loadout.ts';
import { adjustReputation, standingTier } from '../../src/economy/factions.ts';
import { baseQuote, marketEntry, quote } from '../../src/economy/markets.ts';
import {
  buyCommodity,
  liveQuote,
  maxBuyable,
  orderPrice,
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
  it('buys and sells with exact credit changes, each unit priced at the stock it leaves', () => {
    const s = createNewGame(1);
    const price = quote('earth-port', 'medical', s.reputation).buy!;
    const total = orderPrice(s, 'earth-port', 'medical', 10, 'buy')!;
    expect(total).toBeGreaterThanOrEqual(price * 10);
    expect(total).toBeLessThan(price * 10 * 1.05);
    const r = buyCommodity(s, 'earth-port', 'medical', 10);
    expect(r).toEqual({ ok: true, qty: 10, unitPrice: Math.round(total / 10), total });
    expect(s.credits).toBe(800 - total);
    expect(s.ship.cargo.medical).toBe(10);
    // The station has less stock now, so the next unit is no cheaper; it recovers with time.
    expect(liveQuote(s, 'earth-port', 'medical').buy!).toBeGreaterThanOrEqual(price);
    expect(s.markets['earth-port']!.stock.medical).toBeLessThan(marketEntry('earth-port', 'medical')!.target);
    const sellTotal = orderPrice(s, 'mars-depot', 'medical', 4, 'sell')!;
    const r2 = sellCommodity(s, 'mars-depot', 'medical', 4);
    expect(r2.ok && r2.total).toBe(sellTotal);
    expect(s.credits).toBe(800 - total + sellTotal);
    expect(s.ship.cargo.medical).toBe(6);
  });

  it('lets stock recover and never pays out a round trip at one dock', () => {
    const s = createNewGame(1);
    s.credits = 1_000_000;
    s.ship.cargo = {};
    const before = s.credits;
    const bought = buyCommodity(s, 'earth-port', 'medical', 20);
    expect(bought.ok).toBe(true);
    const sold = sellCommodity(s, 'earth-port', 'medical', 20);
    expect(sold.ok).toBe(true);
    expect(s.credits).toBeLessThan(before);
    // Dumping cargo lowers the price; an hour later the market has mostly recovered.
    const fresh = liveQuote(s, 'mars-depot', 'fabricators').sell!;
    s.ship.cargo = { fabricators: 10 };
    sellCommodity(s, 'mars-depot', 'fabricators', 10);
    const dumped = liveQuote(s, 'mars-depot', 'fabricators').sell!;
    expect(dumped).toBeLessThan(fresh);
    s.clock += 3_600 * 3;
    expect(Math.abs(liveQuote(s, 'mars-depot', 'fabricators').sell! - fresh) / fresh).toBeLessThan(0.15);
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
  it('replaces a shield, crediting the old one at 70%', () => {
    const s = createNewGame(1);
    const id = 'gear.shield-balanced.2.halden';
    const offer = gearOffer(s, 'mars-depot', id, 'shield')!;
    expect(offer.tradeIn).toBe(Math.floor(findGear('gear.shield-balanced.1.halden')!.price * 0.7));
    expect(buyGear(s, 'mars-depot', id, 'shield').ok).toBe(true);
    expect(s.ship.fittings.shield).toBe(id);
    expect(s.ship.shield).toBe(shieldCapacity(s.ship));
    expect(shieldCapacity(s.ship)).toBeGreaterThan(60);
    expect(s.credits).toBe(800 - offer.net);
    expect(buyGear(s, 'mars-depot', id, 'shield')).toMatchObject({ ok: false, message: 'Fitted' });
    expect(buyGear(s, 'earth-port', 'gear.mass-driver.1.ares', 'gun-1').ok).toBe(false); // Ares gear is not sold at Earth
    expect(buyGear(s, 'mars-depot', 'gear.mass-driver.1.ares', 'shield').ok).toBe(false); // wrong mount
  });

  it('holds back high classes by mount size and standing', () => {
    const s = createNewGame(1);
    s.credits = 50_000;
    // The courier Mk I's guns take class 3 at most; class 4 and 5 also need friendly standing.
    const offers = gearOffers(s, 'mars-depot', 'gun-1');
    expect(offers.find((o) => o.item.id === 'gear.mass-driver.3.ares')?.blocked).toBeNull();
    expect(offers.find((o) => o.item.id === 'gear.mass-driver.4.ares')?.blocked).toMatch(/class 3/);
    buyShip(s, 'mars-depot', 'ship.heavy-fighter.2.ares');
    expect(gearOffers(s, 'mars-depot', 'gun-1').find((o) => o.item.id === 'gear.mass-driver.4.ares')?.blocked).toMatch(/standing/);
    adjustReputation(s.reputation, 'sta', 12);
    expect(gearOffers(s, 'mars-depot', 'gun-1').find((o) => o.item.id === 'gear.mass-driver.4.ares')?.blocked).toBeNull();
  });

  it('sells guns and utility items, never the core systems', () => {
    const s = createNewGame(1);
    expect(sellQuote(s, 'earth-port', 'engine')?.blocked).toMatch(/every ship needs one/);
    const credits = s.credits;
    const quote = sellQuote(s, 'earth-port', 'gun-2')!;
    expect(sellGear(s, 'earth-port', 'gun-2').ok).toBe(true);
    expect(s.ship.fittings['gun-2']).toBeUndefined();
    expect(s.credits).toBe(credits + quote.value);
    expect(performanceOf(s.ship).guns).toHaveLength(1);
  });

  it('armour arrives intact and cargo pods grow the hold', () => {
    const s = createNewGame(1);
    s.credits = 5_000;
    expect(buyGear(s, 'earth-port', 'gear.cargo-pod.1.halden', 'utility-1').ok).toBe(true);
    expect(cargoCapacity(s.ship)).toBe(28);
    expect(performanceOf(s.ship).flight.maxSpeed).toBeLessThan(110);
    // Removing the pod is refused while the cargo would not fit.
    s.ship.cargo = { medical: 25 };
    expect(sellQuote(s, 'earth-port', 'utility-1')?.blocked).toMatch(/cargo/);
    s.ship.cargo = {};
    buyShip(s, 'mars-depot', 'ship.heavy-fighter.1.ares');
    expect(s.ship.hull).toBe(hullMax(s.ship)); // stock armour plate included
    expect(hullMax(s.ship)).toBeGreaterThan(shipModel('ship.heavy-fighter.1.ares').hull);
  });

  it('sells rounds for the fitted launcher and repair kits', () => {
    const s = createNewGame(1);
    const [seekers] = ammoOffers(s, 'earth-port');
    expect(seekers).toMatchObject({ id: 'launcher-1', have: 4, max: 6, price: 35 });
    expect(buyAmmo(s, 'earth-port', 'launcher-1', 5).ok).toBe(true);
    expect(s.ship.ammo['launcher-1']).toBe(6);
    expect(s.credits).toBe(800 - 2 * 35);
    expect(buyAmmo(s, 'earth-port', 'launcher-1').ok).toBe(false);
    expect(ammoOffers(s, 'barnard-relay')).toEqual([]); // no equipment dealer
    expect(buyRepairKit(s, 'barnard-relay').ok).toBe(true);
    expect(s.ship.repairKits).toBe(2);
  });

  it('trades in the ship and its fittings at 70%, so a round trip always costs money', () => {
    const s = createNewGame(1);
    s.credits = 20_000;
    s.ship.cargo = { medical: 10 };
    const tradeIn = tradeInValue(s);
    const offer = shipOffers(s, 'earth-port').find((o) => o.model.id === 'ship.freighter.1.halden')!;
    expect(offer.net).toBe(offer.model.price - tradeIn);
    expect(buyShip(s, 'earth-port', 'ship.freighter.1.halden').ok).toBe(true);
    expect(s.ship.model).toBe('ship.freighter.1.halden');
    expect(s.ship.cargo).toEqual({ medical: 10 });
    expect(cargoCapacity(s.ship)).toBeGreaterThan(50);
    expect(s.ship.ammo['launcher-1']).toBe(6); // full racks
    expect(buyShip(s, 'earth-port', 'ship.courier.1.halden').ok).toBe(true);
    expect(s.credits).toBeLessThan(20_000);
    // Damage comes off the trade-in at the repair rate.
    const intact = tradeInValue(s);
    s.ship.hull -= 30;
    expect(tradeInValue(s)).toBe(intact - 60);
    // A small hold cannot take a big cargo.
    s.ship.cargo = { medical: 21 };
    expect(shipOffers(s, 'earth-port').find((o) => o.model.id === 'ship.light-fighter.1.halden')?.blocked).toMatch(/Sell cargo/);
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
