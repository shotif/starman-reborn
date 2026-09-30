import { afterEach, describe, expect, it } from 'vitest';
import { assertValidState, migrateSave } from '../../src/app/save/migrate.ts';
import { createNewGame, markVisited, type GameState, type OwnedShip } from '../../src/app/state.ts';
import { dockAt } from '../../src/app/rules.ts';
import { shipModel } from '../../src/content/catalog.ts';
import { FLEET } from '../../src/content/fleet/rules.ts';
import { ALL_LOCATIONS, getLocation } from '../../src/data/systems.ts';
import { cargoUsed } from '../../src/economy/cargo.ts';
import { hasShipyard, shipTradeIn, tradeInValue } from '../../src/economy/equipment.ts';
import { eventsAt, useWorldLog } from '../../src/economy/events.ts';
import {
  buyAndKeep,
  buyStake,
  dividendFactor,
  dividendPerHour,
  fleetNews,
  haulDestinations,
  haulerNext,
  haulEstimate,
  haulGoods,
  haulRisk,
  haulTimes,
  hireHauler,
  insurancePayout,
  keepOffer,
  leaseStorage,
  moveCargo,
  recallHauler,
  runLuck,
  sellShip,
  sellStake,
  settleFleet,
  stakeOffer,
  stakePrice,
  switchShip,
} from '../../src/economy/fleet.ts';
import { cargoCapacity, newShipState, shieldCapacity } from '../../src/economy/loadout.ts';
import { hasMarket, moveStock } from '../../src/economy/markets.ts';
import { liveQuote, recordMarketVisit } from '../../src/economy/trade.ts';
import { tradeRoutes } from '../../src/economy/tradeComputer.ts';

/** A fleet of your own (docs/PROCGEN.md §18): the hangar, haulers, storage and stakes. */

const FREIGHTER = 'ship.freighter.1.halden';

function dock(s: GameState, locationId: string): void {
  const loc = getLocation(locationId);
  s.location = { systemId: loc.systemId, dockedAt: locationId, flight: null, lastDockId: locationId };
  markVisited(s, loc.systemId, locationId);
  if (hasMarket(locationId)) recordMarketVisit(s, locationId);
}

function pilotAt(locationId: string, credits = 100_000): GameState {
  const s = createNewGame(17);
  s.jobs.lifeline = { status: 'complete', objectiveIndex: 4, acceptedAt: 0, completedAt: 1 };
  s.flags.clearance = true;
  s.credits = credits;
  dock(s, locationId);
  return s;
}

/** A pilot at `from` with a freighter parked there, who knows the prices at `to`. */
function withParked(from: string, to: string, credits = 100_000): { s: GameState; o: OwnedShip } {
  const s = pilotAt(to, credits);
  dock(s, from);
  const o: OwnedShip = { id: 'ship-1', ship: newShipState(FREIGHTER), locationId: from };
  s.fleet.ships.push(o);
  return { s, o };
}

afterEach(() => useWorldLog(null));

describe('the hangar', () => {
  it('buy and keep parks the ship you fly, as it is, and moves your cargo to the new one', () => {
    const s = pilotAt('earth-port', 20_000);
    s.ship.cargo = { medical: 5 };
    s.ship.repairKits = 2;
    const courier = structuredClone(s.ship);
    const offer = keepOffer(s, 'earth-port', FREIGHTER)!;
    expect(offer).toMatchObject({ price: shipModel(FREIGHTER).price, blocked: null, cargoMoves: true });
    expect(buyAndKeep(s, 'earth-port', FREIGHTER).ok).toBe(true);
    expect(s.credits).toBe(20_000 - shipModel(FREIGHTER).price);
    expect(s.ship.model).toBe(FREIGHTER);
    expect(s.ship.cargo).toEqual({ medical: 5 });
    expect(s.ship.repairKits).toBe(0);
    expect(s.fleet.ships).toHaveLength(1);
    expect(s.fleet.ships[0]).toMatchObject({ id: 'ship-1', locationId: 'earth-port' });
    expect(s.fleet.ships[0]!.ship).toEqual({ ...courier, cargo: {} });
    expect(s.ledger.at(-1)).toMatchObject({ kind: 'equipment', amount: -shipModel(FREIGHTER).price });
    expect(() => assertValidState(s)).not.toThrow();
  });

  it('keeps at most FLEET.hangar.max ships besides the one you fly, and needs the full price', () => {
    const s = pilotAt('earth-port', 1_000_000);
    for (let i = 0; i < FLEET.hangar.max; i++) expect(buyAndKeep(s, 'earth-port', 'ship.courier.1.halden').ok).toBe(true);
    expect(new Set(s.fleet.ships.map((o) => o.id)).size).toBe(FLEET.hangar.max);
    expect(keepOffer(s, 'earth-port', FREIGHTER)!.blocked).toMatch(/Hangar full/);
    expect(buyAndKeep(s, 'earth-port', FREIGHTER).ok).toBe(false);
    const poor = pilotAt('earth-port', shipModel(FREIGHTER).price - 1);
    expect(keepOffer(poor, 'earth-port', FREIGHTER)!.blocked).toBe('Not enough credits');
    // A hold too big for the new ship stays aboard the old one.
    const full = pilotAt('earth-port', 50_000);
    full.ship = newShipState(FREIGHTER);
    full.ship.cargo = { food: 20 };
    expect(buyAndKeep(full, 'earth-port', 'ship.light-fighter.1.halden').ok).toBe(true);
    expect(full.ship.cargo).toEqual({});
    expect(full.fleet.ships[0]!.ship.cargo).toEqual({ food: 20 });
  });

  it('switching swaps the ship you fly with one parked here; each keeps its own cargo and gear', () => {
    const s = pilotAt('earth-port', 20_000);
    buyAndKeep(s, 'earth-port', FREIGHTER);
    s.ship.cargo = { water: 10 };
    s.ship.hull -= 30;
    s.ship.shield = 0;
    const freighter = structuredClone(s.ship);
    const courier = structuredClone(s.fleet.ships[0]!.ship);
    expect(switchShip(s, 'ship-1').ok).toBe(true);
    expect(s.ship).toEqual({ ...courier, shield: shieldCapacity(s.ship) });
    expect(s.fleet.ships[0]!.ship).toEqual(freighter);
    expect(s.fleet.ships[0]!.locationId).toBe('earth-port');
    // The flown ship is always a valid one: the save checks pass and round-trip.
    expect(migrateSave(structuredClone(s))).toEqual(s);
    // And back again.
    expect(switchShip(s, 'ship-1').ok).toBe(true);
    expect(s.ship.cargo).toEqual({ water: 10 });
    expect(s.ship.hull).toBe(freighter.hull);
    expect(cargoCapacity(s.ship)).toBe(56);
  });

  it('only switches to a ship parked where you are docked, and not while a captain flies it', () => {
    const s = pilotAt('earth-port', 20_000);
    buyAndKeep(s, 'earth-port', FREIGHTER);
    dock(s, 'mars-depot');
    expect(switchShip(s, 'ship-1')).toMatchObject({ ok: false, message: 'That ship is not parked here.' });
    dock(s, 'earth-port');
    s.fleet.ships[0]!.hauler = {
      captain: 'Ines Holt',
      route: { from: 'earth-port', to: 'mars-depot', commodity: 'electronics' },
      insured: false,
      hired: 0,
      leg: 'out',
      since: 0,
      cost: 100,
      waiting: null,
      waits: 0,
      recalled: false,
      runs: 0,
      earned: 0,
    };
    expect(switchShip(s, 'ship-1').message).toMatch(/recall the captain/);
    expect(s.ship.model).toBe(FREIGHTER);
  });

  it('a new ship never takes the id of a lost or sold one that a report still names', () => {
    const s = pilotAt('earth-port', 100_000);
    s.fleet.reports.push({ at: 0, kind: 'lost', text: 'Raiders destroyed your Petrel.', amount: -500, shipId: 'ship-3' });
    buyAndKeep(s, 'earth-port', FREIGHTER);
    expect(s.fleet.ships[0]!.id).toBe('ship-4');
  });

  it('parked ships sell at a shipyard for the trade-in the yard pays, with an empty hold', () => {
    const s = pilotAt('earth-port', 20_000);
    buyAndKeep(s, 'earth-port', FREIGHTER);
    const parked = s.fleet.ships[0]!;
    parked.ship.hull -= 40;
    const value = shipTradeIn(parked.ship);
    // The same share the yard pays for the ship you fly.
    expect(value).toBe(tradeInValue({ ...s, ship: parked.ship }));
    parked.ship.cargo = { food: 1 };
    expect(sellShip(s, 'ship-1').ok).toBe(false);
    parked.ship.cargo = {};
    const before = s.credits;
    expect(sellShip(s, 'ship-1').ok).toBe(true);
    expect(s.credits).toBe(before + value);
    expect(s.fleet.ships).toEqual([]);
    // Nowhere but a shipyard.
    const t = pilotAt('barnard-relay', 20_000);
    expect(hasShipyard('barnard-relay')).toBe(false);
    t.fleet.ships.push({ id: 'ship-1', ship: newShipState(FREIGHTER), locationId: 'barnard-relay' });
    expect(sellShip(t, 'ship-1').message).toMatch(/Only a shipyard/);
  });
});

describe('storage', () => {
  it('a leased hold at a station takes 60 units of cargo, moved while docked there', () => {
    const s = pilotAt('earth-port', 5_000);
    s.ship = newShipState(FREIGHTER);
    s.ship.cargo = { water: 18, medical: 10 };
    expect(moveCargo(s, 'earth-port', 'water', 1, 'store').message).toMatch(/Lease a hold/);
    expect(leaseStorage(s, 'earth-port').ok).toBe(true);
    expect(s.credits).toBe(5_000 - FLEET.storage.lease);
    expect(leaseStorage(s, 'earth-port').ok).toBe(false);
    // Water takes three units an item: 20 fill the hold.
    expect(moveCargo(s, 'earth-port', 'water', 18, 'store').ok).toBe(true);
    expect(moveCargo(s, 'earth-port', 'medical', 7, 'store').message).toBe('Not enough room in storage.');
    expect(moveCargo(s, 'earth-port', 'medical', 6, 'store').ok).toBe(true);
    expect(cargoUsed(s.fleet.storage['earth-port']!)).toBe(FLEET.storage.capacity);
    expect(moveCargo(s, 'earth-port', 'medical', 5, 'store').message).toBe('You do not carry that many.');
    // Taking it back is limited by the ship's hold.
    s.ship.cargo = { metals: 26 };
    expect(moveCargo(s, 'earth-port', 'water', 2, 'take').message).toBe('Not enough room in your hold.');
    expect(moveCargo(s, 'earth-port', 'medical', 4, 'take').ok).toBe(true);
    expect(s.ship.cargo).toEqual({ metals: 26, medical: 4 });
    expect(moveCargo(s, 'earth-port', 'medical', 3, 'take').message).toBe('Not that many in storage.');
    // Only while docked there.
    dock(s, 'mars-depot');
    expect(moveCargo(s, 'earth-port', 'medical', 1, 'take').ok).toBe(false);
    expect(() => assertValidState(s)).not.toThrow();
  });
});

describe('stakes', () => {
  it('1 to 10 per-cent of a station’s trade, in at most five stations, never at military bases or dens', () => {
    const s = pilotAt('earth-port', 1_000_000);
    const per = FLEET.stakes.pricePerPercent['trade-port'];
    expect(stakePrice('earth-port')).toBe(per);
    expect(buyStake(s, 'earth-port', 0).ok).toBe(false);
    expect(buyStake(s, 'earth-port', 11).ok).toBe(false);
    expect(buyStake(s, 'earth-port', 4).ok).toBe(true);
    expect(buyStake(s, 'earth-port', 7).ok).toBe(false);
    expect(buyStake(s, 'earth-port', 6).ok).toBe(true);
    expect(s.fleet.stakes).toEqual([{ locationId: 'earth-port', percent: 10, paid: 10 * per, since: 0, earned: 0 }]);
    expect(stakeOffer(s, 'earth-port')!.blocked).toMatch(/most anyone may/);
    const open = ALL_LOCATIONS.filter((l) => l.status === 'functional' && l.id !== 'earth-port' && stakePrice(l.id) > 0);
    for (const l of open.slice(0, FLEET.stakes.maxStations - 1)) {
      dock(s, l.id);
      expect(buyStake(s, l.id, 1).ok).toBe(true);
    }
    const sixth = open[FLEET.stakes.maxStations - 1]!;
    dock(s, sixth.id);
    expect(buyStake(s, sixth.id, 1).ok).toBe(false);
    expect(stakeOffer(s, sixth.id)!.blocked).toMatch(/5 stations/);
    for (const kind of ['military-base', 'pirate-den']) {
      const l = ALL_LOCATIONS.find((x) => x.stationType === kind && x.status === 'functional')!;
      expect(stakePrice(l.id)).toBe(0);
    }
    expect(() => assertValidState(s)).not.toThrow();
  });

  it('pays dividends by the hour from the clock, moved by the station’s events, and sells back at 85%', () => {
    const s = pilotAt('earth-port', 100_000);
    buyStake(s, 'earth-port', 10);
    const hourly = Math.round(FLEET.stakes.dividendPerHour * 10 * FLEET.stakes.pricePerPercent['trade-port']);
    s.clock = 10 * 3_600 + 1_799;
    const before = s.credits;
    // Sol has no events: ten plain hours, and the eleventh not yet due.
    expect(settleFleet(s).dividends).toBe(10 * hourly);
    expect(s.credits).toBe(before + 10 * hourly);
    expect(s.fleet.stakes[0]).toMatchObject({ earned: 10 * hourly, since: 10 * 3_600 });
    const value = Math.round(10 * FLEET.stakes.pricePerPercent['trade-port'] * FLEET.stakes.sellBack);
    expect(sellStake(s, 'earth-port').message).toContain(`${value} cr`);
    // Selling pays the part of the hour under way too.
    expect(s.credits).toBe(before + 10 * hourly + Math.round((hourly * 1_799) / 3_600) + value);
    expect(s.fleet.stakes).toEqual([]);
    // A boom helps; a strike hurts.
    for (const [kind, factor] of [['boom', FLEET.stakes.events.boom], ['strike', FLEET.stakes.events.strike]] as const) {
      let e = null;
      for (let t = 0; !e && t < 500_000; t += 600) e = eventsAt(t).find((x) => x.kind === kind && x.locationId && stakePrice(x.locationId) > 0) ?? null;
      const mid = (e!.start + e!.end) / 2;
      const f = dividendFactor(e!.locationId!, mid);
      expect(f.events.map((x) => x.kind)).toContain(kind);
      expect(f.factor).toBeCloseTo(factor * (f.events.length > 1 ? FLEET.stakes.events[f.events[1]!.kind] : 1), 6);
      expect(dividendPerHour(e!.locationId!, 10, mid)).toBe(Math.round(FLEET.stakes.dividendPerHour * 10 * stakePrice(e!.locationId!) * f.factor));
    }
  });
});

describe('stakes change hands fairly', () => {
  it('a stake bought up or sold mid-hour pays that part of the hour first, at the stake it was', () => {
    const s = pilotAt('earth-port', 100_000);
    const per = FLEET.stakes.pricePerPercent['trade-port'];
    buyStake(s, 'earth-port', 1);
    s.clock = 3_000;
    const before = s.credits;
    expect(buyStake(s, 'earth-port', 9).ok).toBe(true);
    const part = Math.round((Math.round(FLEET.stakes.dividendPerHour * per) * 3_000) / 3_600);
    expect(s.credits).toBe(before + part - 9 * per);
    expect(s.fleet.stakes[0]).toMatchObject({ percent: 10, since: 3_000, earned: part });
    // The first full hour of the larger stake is due an hour after the top-up, not at 3,600.
    s.clock = 3_600;
    expect(settleFleet(s).dividends).toBe(0);
    s.clock = 6_600;
    expect(settleFleet(s).dividends).toBe(Math.round(FLEET.stakes.dividendPerHour * 10 * per));
    s.clock = 8_400;
    const held = s.credits;
    sellStake(s, 'earth-port');
    const half = Math.round(FLEET.stakes.dividendPerHour * 10 * per / 2);
    expect(s.credits).toBe(held + half + Math.round(10 * per * FLEET.stakes.sellBack));
  });
});

describe('haulers', () => {
  it('fly only to docks you have been to, with lawful goods, from where the ship is parked', () => {
    const { s, o } = withParked('meridian-outpost', 'earth-port');
    expect(haulDestinations(s, 'meridian-outpost')).toContain('earth-port');
    expect(haulDestinations(s, 'meridian-outpost')).not.toContain('sirius-platform');
    const goods = haulGoods(s, 'meridian-outpost', 'earth-port');
    expect(goods).toContain('data-cores');
    expect(goods.every((c) => c !== 'weapons' && c !== 'stims' && c !== 'spoofers')).toBe(true);
    expect(hireHauler(s, o.id, 'sirius-platform', 'data-cores', false).ok).toBe(false);
    o.ship.cargo = { food: 1 };
    expect(hireHauler(s, o.id, 'earth-port', 'data-cores', false).message).toMatch(/hold must be empty/);
    o.ship.cargo = {};
    dock(s, 'earth-port');
    expect(hireHauler(s, o.id, 'earth-port', 'data-cores', false).ok).toBe(false);
  });

  it('a run loads at once, sells at the far end on arrival and comes home; its trades move both markets', () => {
    const { s, o } = withParked('meridian-outpost', 'earth-port');
    const est = haulEstimate(s, o, 'earth-port', 'data-cores', false)!;
    expect(est.net).toBeGreaterThan(FLEET.haulers.minProfit);
    const credits = s.credits;
    const r = hireHauler(s, o.id, 'earth-port', 'data-cores', false);
    expect(r.ok).toBe(true);
    const h = o.hauler!;
    expect(h).toMatchObject({ leg: 'out', since: 0, runs: 0, route: { from: 'meridian-outpost', to: 'earth-port', commodity: 'data-cores' } });
    expect(o.ship.cargo['data-cores']).toBeGreaterThan(0);
    expect(s.credits).toBe(credits - h.cost);
    expect(s.markets['meridian-outpost']!.stock['data-cores']).toBeDefined();
    const { load, oneWay, run } = haulTimes('meridian-outpost', 'earth-port');
    expect(run).toBe(load + 2 * oneWay);
    s.clock = load + oneWay - 1;
    expect(settleFleet(s).runs).toBe(0);
    s.clock = load + oneWay;
    const sold = settleFleet(s);
    expect(sold.runs).toBe(1);
    expect(h.leg).toBe('back');
    expect(o.ship.cargo).toEqual({});
    expect(s.markets['earth-port']!.stock['data-cores']).toBeDefined();
    expect(sold.reports[0]).toMatchObject({ kind: 'run', shipId: o.id });
    expect(s.credits - credits).toBe(h.earned);
    s.clock = run;
    settleFleet(s);
    // Home and straight out again on the next run.
    expect(h.runs).toBe(1);
    expect(h.leg === 'out' || h.waiting !== null).toBe(true);
  });

  it('a captain waits while a run does not pay or cannot be paid for, reporting it once; credits never go below zero', () => {
    const { s, o } = withParked('meridian-outpost', 'earth-port');
    hireHauler(s, o.id, 'earth-port', 'data-cores', false);
    const h = o.hauler!;
    // Flood the far end: nothing pays for a while.
    moveStock(s.markets, 'earth-port', 'data-cores', 600, s.clock);
    s.clock = haulTimes('meridian-outpost', 'earth-port').run + FLEET.haulers.recheck * (FLEET.haulers.reportAfter + 2);
    const r = settleFleet(s);
    expect(h).toMatchObject({ leg: 'home', waiting: 'unprofitable' });
    expect(r.reports.filter((x) => x.kind === 'wait')).toHaveLength(1);
    // Back in business once the market recovers.
    s.clock += 6 * 3_600;
    settleFleet(s);
    expect(h.runs).toBeGreaterThan(1);
    // A load the player cannot pay for waits too, and is reported at once.
    const { s: t, o: p } = withParked('meridian-outpost', 'earth-port');
    hireHauler(t, p.id, 'earth-port', 'data-cores', false);
    const q = p.hauler!;
    const home = q.since + haulTimes('meridian-outpost', 'earth-port').run;
    t.clock = home - 1;
    settleFleet(t);
    t.credits = 10;
    t.clock = home;
    const w = settleFleet(t);
    expect(q).toMatchObject({ leg: 'home', waiting: 'credits' });
    expect(w.reports).toMatchObject([{ kind: 'wait', text: expect.stringMatching(/cannot pay for a load/) }]);
    expect(t.credits).toBe(10);
    t.clock += 5 * FLEET.haulers.recheck;
    expect(settleFleet(t).reports).toEqual([]);
    expect(t.credits).toBe(10);
    t.credits = 100_000;
    t.clock += FLEET.haulers.recheck;
    settleFleet(t);
    expect(q.leg).toBe('out');
  });

  it('a recalled captain finishes the run and parks the ship at home; at home it parks at once', () => {
    const { s, o } = withParked('meridian-outpost', 'earth-port');
    hireHauler(s, o.id, 'earth-port', 'data-cores', true);
    expect(recallHauler(s, o.id).message).toMatch(/after this run/);
    s.clock = haulTimes('meridian-outpost', 'earth-port').run;
    const r = settleFleet(s);
    expect(o.hauler).toBeUndefined();
    expect(o.locationId).toBe('meridian-outpost');
    expect(o.ship.cargo).toEqual({});
    expect(r.reports.map((x) => x.kind)).toEqual(['run', 'home']);
    expect(switchShip(s, o.id).ok).toBe(true);
    // Waiting at home: parked straight away.
    const { s: t, o: p } = withParked('meridian-outpost', 'earth-port', 0);
    t.credits = 100_000;
    hireHauler(t, p.id, 'earth-port', 'data-cores', false);
    p.hauler = { ...p.hauler!, leg: 'home', since: t.clock + 600, waiting: 'credits', waits: 1 };
    p.ship.cargo = {};
    expect(recallHauler(t, p.id).ok).toBe(true);
    expect(p.hauler).toBeUndefined();
  });

  it('works out a very long absence quickly: at most FLEET.haulers.maxLooksPerSettle looks a hauler, running or waiting', () => {
    const { s, o } = withParked('meridian-outpost', 'earth-port', 10_000_000);
    hireHauler(s, o.id, 'earth-port', 'data-cores', true);
    buyStake(s, 'meridian-outpost', 5);
    s.clock = 1e8;
    const start = performance.now();
    const r = settleFleet(s);
    expect(performance.now() - start).toBeLessThan(5_000);
    expect(r.runs).toBeLessThanOrEqual(FLEET.haulers.maxLooksPerSettle);
    if (o.hauler) expect(haulerNext(o.hauler)).toBeGreaterThanOrEqual(s.clock);
    expect(s.fleet.stakes[0]!.since).toBeGreaterThan(s.clock - 3_600);
    expect(() => assertValidState(s)).not.toThrow();
    // A captain who only waits (nobody can pay for a load) is capped too.
    const { s: t, o: p } = withParked('meridian-outpost', 'earth-port');
    hireHauler(t, p.id, 'earth-port', 'data-cores', false);
    t.credits = 0;
    t.clock = 1e8;
    const w = settleFleet(t);
    expect(w.steps).toBeLessThan(3 * FLEET.haulers.maxLooksPerSettle + 10);
    expect(p.hauler!.since).toBeGreaterThanOrEqual(t.clock);
    expect(settleFleet(t).steps).toBeLessThanOrEqual(1);
  });
});

describe('guardrails', () => {
  it('a hauler earns well below what flying the route yourself earns (the trade computer’s estimate)', () => {
    const docks = ALL_LOCATIONS.filter((l) => l.status === 'functional' && l.dockable !== false && hasMarket(l.id));
    let routes = 0;
    let earning = 0;
    for (const home of docks.filter((l) => hasShipyard(l.id))) {
      const s = pilotAt(home.id, 1_000_000);
      for (const d of docks) dock(s, d.id);
      dock(s, home.id);
      s.ship = newShipState(FREIGHTER);
      const best = tradeRoutes(s, home.id, { fromHere: true, limit: 12 }).filter((r) => getLocation(r.to).systemId !== home.systemId && haulGoods(s, home.id, r.to).includes(r.commodity))[0];
      if (!best) continue;
      s.fleet.ships.push({ id: 'ship-1', ship: newShipState(FREIGHTER), locationId: home.id });
      if (!hireHauler(s, 'ship-1', best.to, best.commodity, true).ok) continue;
      const credits = s.credits;
      s.clock += 10 * 3_600;
      settleFleet(s);
      const perHour = (s.credits - credits) / 10;
      const yours = best.perMinute * 60;
      routes++;
      if (perHour > 0) earning++;
      expect(perHour, `${home.id} → ${best.to} (${best.commodity})`).toBeLessThan(0.2 * yours);
    }
    expect(routes).toBeGreaterThan(10);
    expect(earning).toBeGreaterThan(routes * 0.7);
  });

  it('the worst a run can do is lose one cargo and one ship; insurance pays part of the ship back', () => {
    // A lawless route, and a hire whose first run meets raiders and loses the ship.
    const from = 'regent-concourse';
    const to = 'flotsam-diggings';
    const { s: probe } = withParked(from, to);
    const c = haulGoods(probe, from, to).find((x) => (haulEstimate(probe, probe.fleet.ships[0]!, to, x, true)?.net ?? 0) > 200)!;
    expect(c).toBeDefined();
    let hired = 0;
    for (; hired < 20_000; hired++) {
      const luck = runLuck(probe.seed, 'ship-1', hired, 0);
      if (luck.raid < haulRisk(from, to, hired + FLEET.haulers.loadSeconds).raided && luck.loss < FLEET.risk.shipLost) break;
    }
    for (const insured of [false, true]) {
      const { s, o } = withParked(from, to);
      s.clock = hired;
      const before = s.credits;
      expect(hireHauler(s, o.id, to, c, insured).ok).toBe(true);
      const cost = o.hauler!.cost;
      expect(before - s.credits).toBe(cost);
      s.clock += haulTimes(from, to).run * 3;
      const r = settleFleet(s);
      expect(r.reports[0]!.kind).toBe('lost');
      expect(s.fleet.ships).toEqual([]);
      const payout = insured ? insurancePayout(o.ship) : 0;
      expect(s.credits).toBe(before - cost + payout);
      expect(r.hauled).toBe(payout - cost);
      expect(payout).toBe(insured ? Math.round(FLEET.risk.payout * shipModel(FREIGHTER).price) : 0);
    }
    // Over many runs, no run costs more than what it set out with.
    const { s, o } = withParked(from, to, 5_000_000);
    hireHauler(s, o.id, to, c, false);
    let worst = 0;
    for (let i = 0; i < 400 && o.hauler; i++) {
      const cost = o.hauler.leg === 'out' ? o.hauler.cost : 0;
      s.clock = haulerNext(o.hauler);
      for (const r of settleFleet(s).reports) {
        expect(r.amount).toBeGreaterThanOrEqual(-Math.max(cost, 1));
        worst = Math.min(worst, r.amount);
      }
    }
    expect(worst).toBeLessThan(0);
  });

  it('settling is deterministic and does not depend on how often it happens', () => {
    const { s } = withParked('meridian-outpost', 'earth-port', 60_000);
    dock(s, 'regent-concourse');
    dock(s, 'flotsam-diggings');
    dock(s, 'regent-concourse');
    s.fleet.ships.push({ id: 'ship-2', ship: newShipState(FREIGHTER), locationId: 'regent-concourse' });
    const c = haulGoods(s, 'regent-concourse', 'flotsam-diggings').find((x) => (haulEstimate(s, s.fleet.ships[1]!, 'flotsam-diggings', x, false)?.net ?? 0) > 200)!;
    expect(hireHauler(s, 'ship-2', 'flotsam-diggings', c, false).ok).toBe(true);
    buyStake(s, 'regent-concourse', 3);
    dock(s, 'meridian-outpost');
    expect(hireHauler(s, 'ship-1', 'earth-port', 'data-cores', true).ok).toBe(true);
    buyStake(s, 'meridian-outpost', 2);
    const once = structuredClone(s);
    const twice = structuredClone(s);
    const often = structuredClone(s);
    once.clock = 30_000;
    settleFleet(once);
    twice.clock = 15_000;
    settleFleet(twice);
    twice.clock = 30_000;
    settleFleet(twice);
    for (let t = 700; t <= 30_000; t += 700) {
      often.clock = t;
      settleFleet(often);
    }
    often.clock = 30_000;
    settleFleet(often);
    expect(once.fleet.reports.length).toBeGreaterThan(5);
    expect(twice).toEqual(once);
    expect(often).toEqual(once);
    // Another device with the same save.
    const other = structuredClone(s);
    other.clock = 30_000;
    settleFleet(other);
    expect(other).toEqual(once);
  });
});

describe('what the player is told', () => {
  it('a lost ship always, a few reports as they are, many as one summary, and dividends', () => {
    const run = (amount: number) => ({ at: 1, kind: 'run' as const, text: `Sold: ${amount}`, amount });
    const one = fleetNews({ reports: [run(100)], runs: 1, hauled: 100, dividends: 0, steps: 3 });
    expect(one).toEqual([{ text: 'Sold: 100', tone: 'good' }]);
    const many = fleetNews({ reports: [run(100), run(50), { at: 2, kind: 'lost', text: 'Lost it', amount: -900 }, run(20), { at: 3, kind: 'raid', text: 'Raided', amount: -300 }], runs: 4, hauled: -1030, dividends: 42, steps: 20 });
    expect(many).toHaveLength(3);
    expect(many[0]).toEqual({ text: 'Lost it', tone: 'bad' });
    expect(many[1]!.text).toMatch(/4 runs, 1 raid \(-130 cr\)/);
    expect(many[2]).toEqual({ text: 'Dividends from your stakes: +42 cr.', tone: 'good' });
  });

  it('docking settles the fleet and brings its news, and the prices seen there include its trades', () => {
    const { s, o } = withParked('meridian-outpost', 'earth-port');
    hireHauler(s, o.id, 'earth-port', 'data-cores', false);
    // Out of sight until the second run loads at home.
    s.clock = haulTimes('meridian-outpost', 'earth-port').run + 1;
    const out = dockAt(s, 'meridian-outpost');
    expect(out.fleet.runs).toBe(1);
    expect(out.fleet.reports[0]!.kind).toBe('run');
    expect(s.knownMarkets['meridian-outpost']!.prices['data-cores']).toEqual(liveQuote(s, 'meridian-outpost', 'data-cores'));
  });
});

describe('saves', () => {
  it('a v9 save gets an empty fleet', () => {
    const { world: _w, law: _l, fleet: _f, ...rest } = createNewGame(8);
    const s = migrateSave({ ...structuredClone(rest), law: { fines: {} }, version: 9 });
    expect(s.fleet).toEqual({ ships: [], storage: {}, stakes: [], reports: [] });
  });

  it('a fleet round-trips, and damaged fleet data is rejected', () => {
    const { s, o } = withParked('meridian-outpost', 'earth-port');
    hireHauler(s, o.id, 'earth-port', 'data-cores', true);
    buyStake(s, 'meridian-outpost', 3);
    leaseStorage(s, 'meridian-outpost');
    s.fleet.ships.push({ id: 'ship-2', ship: newShipState('ship.courier.1.halden'), locationId: 'meridian-outpost' });
    s.clock = 2 * 3_600;
    settleFleet(s);
    const good = structuredClone(s);
    expect(migrateSave(structuredClone(good))).toEqual(good);
    const bad = (patch: (x: GameState) => void) => {
      const x = structuredClone(good);
      patch(x);
      return () => migrateSave(x);
    };
    expect(bad((x) => (x.fleet.ships[1]!.ship.model = 'ship.yacht.1.nobody'))).toThrow(/fleet ship/);
    expect(bad((x) => (x.fleet.ships[1]!.ship.fittings['gun-1'] = 'gear.shield-balanced.1.halden'))).toThrow(/fleet ship/);
    expect(bad((x) => (x.fleet.ships[1]!.ship.cargo = { unobtainium: 2 } as never))).toThrow(/fleet ship/);
    expect(bad((x) => (x.fleet.ships[1]!.id = x.fleet.ships[0]!.id))).toThrow(/fleet ship/);
    expect(bad((x) => (x.fleet.ships[1]!.locationId = 'nowhere'))).toThrow(/fleet ship/);
    expect(bad((x) => (x.fleet.ships[0]!.hauler!.leg = 'lost' as never))).toThrow(/hauler/);
    expect(bad((x) => (x.fleet.ships[0]!.hauler!.route.from = 'earth-port'))).toThrow(/hauler/);
    expect(bad((x) => (x.fleet.ships[0]!.hauler!.route.commodity = 'gold' as never))).toThrow(/hauler/);
    expect(bad((x) => (x.fleet.ships[0]!.hauler!.since = Number.NaN))).toThrow(/hauler/);
    expect(bad((x) => (x.fleet.storage['meridian-outpost'] = { water: 21 }))).toThrow(/storage/);
    expect(bad((x) => (x.fleet.storage.nowhere = {}))).toThrow(/storage/);
    expect(bad((x) => (x.fleet.stakes[0]!.percent = FLEET.stakes.maxPercent + 1))).toThrow(/stakes/);
    expect(bad((x) => x.fleet.stakes.push({ ...x.fleet.stakes[0]! }))).toThrow(/stakes/);
    expect(bad((x) => (x.fleet.reports = [{ at: 0, kind: 'rumour' as never, text: '', amount: 0 }]))).toThrow(/fleet reports/);
    expect(
      bad((x) => {
        for (let i = 3; i <= FLEET.hangar.max + 1; i++) x.fleet.ships.push({ id: `ship-${i}`, ship: newShipState('ship.courier.1.halden'), locationId: 'meridian-outpost' });
      }),
    ).toThrow(/too many/);
    expect(bad((x) => ((x as { fleet: unknown }).fleet = { ships: [] }))).toThrow(/fleet/);
  });
});
