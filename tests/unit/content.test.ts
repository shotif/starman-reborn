import { describe, expect, it } from 'vitest';
import { gearForSale, getCatalog, shipsForSale } from '../../src/content/catalog.ts';
import { buildCatalog } from '../../src/content/gen/catalog.ts';
import { combatRating, duelSeconds, shipPerformance } from '../../src/content/loadout.ts';
import { hashString, rng, roundPrice, roundTo } from '../../src/content/random.ts';
import { CATALOG_SEED, RULES, STARTER_SHIP_ID } from '../../src/content/rules/index.ts';
import type { ContentRules, GearItem, ShipModel } from '../../src/content/types.ts';
import { formatIssues, validateCatalog } from '../../src/content/validate.ts';
import { PLAYER_SHIP } from '../../src/flight/ShipBody.ts';

const catalog = getCatalog();
/** The original player ship's fittings (before the catalogue), which the starter must reproduce. */
const ORIGINAL = {
  shield: { capacity: 60, regenPerSecond: 6, regenDelay: 3 },
  gun: { damage: 9, shotsPerSecond: 5.5, projectileSpeed: 760, range: 950, energyPerShot: 5 },
  missile: { damage: 55, speed: 280, turnRate: 2.6, lifetime: 9, maxAmmo: 6 },
};
const stock = (s: ShipModel) => shipPerformance(s, s.stock, catalog.gearById);

describe('seeded randomness', () => {
  it('derives independent, repeatable streams per key', () => {
    const a = rng(1, 'names', 'halden');
    const b = rng(1, 'names', 'halden');
    const c = rng(1, 'names', 'ares');
    const seqA = [a.next(), a.next(), a.next()];
    expect([b.next(), b.next(), b.next()]).toEqual(seqA);
    expect([c.next(), c.next(), c.next()]).not.toEqual(seqA);
    expect(hashString('abc')).toBe(hashString('abc'));
    expect(rng(7, 'x').shuffle([1, 2, 3, 4, 5]).sort()).toEqual([1, 2, 3, 4, 5]);
  });

  it('rounds to designed-looking values', () => {
    expect(roundTo(0.1 + 0.2, 0.1)).toBe(0.3);
    expect(roundTo(2.7499, 0.05)).toBe(2.75);
    expect(roundPrice(187.4)).toBe(187);
    expect(roundPrice(1234)).toBe(1235);
    expect(roundPrice(23_456)).toBe(23_500);
  });
});

describe('ship and equipment catalogue', () => {
  it('passes every guardrail', () => {
    const issues = validateCatalog(catalog, RULES);
    expect(formatIssues(issues)).toBe('');
  });

  it('is deterministic: same rules and seed, same catalogue', () => {
    const again = buildCatalog(RULES, CATALOG_SEED);
    expect(again.ships).toEqual(catalog.ships);
    expect(again.gear).toEqual(catalog.gear);
  });

  it('keeps ids and stats when only the seed changes (names may move)', () => {
    const other = buildCatalog(RULES, CATALOG_SEED + 1);
    expect(other.ships.map((s) => s.id)).toEqual(catalog.ships.map((s) => s.id));
    expect(other.gear).toEqual(catalog.gear);
    expect(other.ships.map((s) => ({ ...s, name: '' }))).toEqual(catalog.ships.map((s) => ({ ...s, name: '' })));
    expect(validateCatalog(other, RULES)).toEqual([]);
  });

  it('offers several classes, each built by several makers, and a wide range of equipment', () => {
    const buyable = catalog.ships.filter((s) => s.maker !== 'wake');
    const classes = new Set(buyable.map((s) => s.class));
    expect(classes.size).toBe(6);
    for (const cls of classes) {
      expect(new Set(buyable.filter((s) => s.class === cls).map((s) => s.maker)).size, cls).toBeGreaterThanOrEqual(2);
    }
    expect(buyable.length).toBeGreaterThanOrEqual(35);
    expect(catalog.gear.length).toBeGreaterThanOrEqual(100);
    expect(new Set(catalog.gear.map((g) => g.family)).size).toBe(20);
  });

  it('builds fast enough for a phone', () => {
    const times: number[] = [];
    for (let i = 0; i < 5; i++) {
      const t0 = performance.now();
      buildCatalog(RULES, CATALOG_SEED);
      times.push(performance.now() - t0);
    }
    times.sort((a, b) => a - b);
    expect(times[2]).toBeLessThan(20);
  });
});

describe('the starting ship', () => {
  const starter = catalog.shipById.get(STARTER_SHIP_ID)!;

  it('is the Halden courier Mk I and flies exactly like the original player ship', () => {
    expect(starter.class).toBe('courier');
    expect(stock(starter).flight).toEqual(PLAYER_SHIP);
    expect(stock(starter).hullMax).toBe(100);
    expect(stock(starter).cargo).toBe(20);
  });

  it('carries the original shield, guns and missiles', () => {
    const perf = stock(starter);
    expect(perf.shield).toMatchObject(ORIGINAL.shield);
    // Two gun mounts share the old single gun's rate of fire.
    const gun = ORIGINAL.gun;
    expect(perf.guns).toHaveLength(2);
    for (const g of perf.guns) {
      expect(g).toMatchObject({ damage: gun.damage, projectileSpeed: gun.projectileSpeed, range: gun.range, energyPerShot: gun.energyPerShot });
      expect(g.shotsPerSecond * 2).toBe(gun.shotsPerSecond);
    }
    expect(perf.launchers[0]).toMatchObject(ORIGINAL.missile);
  });
});

describe('balance', () => {
  const byId = (id: string) => catalog.shipById.get(id)!;

  it('makes damage types counter shield types', () => {
    const find = (family: string) => catalog.gear.find((g) => g.family === family && g.tier === 2)!;
    const shieldOf = (family: string) => {
      const s = find(family).stats;
      return s.slot === 'shield' ? s.shield : null;
    };
    expect(shieldOf('shield-deflector')?.shieldType).toBe('deflector');
    expect(find('pulse').description).toMatch(/Strong against deflector shields; weak against diffuser shields/);
    expect(find('mass-driver').description).toMatch(/Weak against deflector shields; hits hulls hard/);
    expect(find('ion').description).toMatch(/barely scratches hulls/);
  });

  it('trades maker tendencies against each other instead of adding power', () => {
    const ares = byId('ship.heavy-fighter.2.ares');
    const horizon = byId('ship.heavy-fighter.2.horizon');
    expect(ares.hull).toBeGreaterThan(horizon.hull);
    expect(horizon.turnRate).toBeGreaterThan(ares.turnRate);
    expect(horizon.maxSpeed).toBeGreaterThan(ares.maxSpeed);
    const ratio = combatRating(stock(ares)) / combatRating(stock(horizon));
    expect(ratio).toBeGreaterThan(0.8);
    expect(ratio).toBeLessThan(1.25);
  });

  it('makes tier-matched fights last and higher tiers decisive', () => {
    const mk1 = stock(byId('ship.courier.1.halden'));
    const mk3 = stock(byId('ship.courier.3.halden'));
    const mirror = duelSeconds(mk1, mk1, RULES.balance.hitRate);
    expect(mirror).toBeGreaterThan(RULES.balance.duelSeconds.min);
    expect(duelSeconds(mk3, mk1, RULES.balance.hitRate) * 2).toBeLessThan(duelSeconds(mk1, mk3, RULES.balance.hitRate));
  });
});

describe('shops', () => {
  it('sells class 1 equipment for every slot and starter ships at the Halcyon Ring', () => {
    const gear = gearForSale('earth-port');
    for (const slot of ['gun', 'launcher', 'shield', 'engine', 'thruster', 'power', 'utility']) {
      expect(gear.some((g: GearItem) => g.slot === slot && g.tier === 1), slot).toBe(true);
    }
    expect(shipsForSale('earth-port').map((s) => s.id)).toContain(STARTER_SHIP_ID);
  });

  it("sells a maker's full range at its home station, and no raider hulls anywhere", () => {
    expect(gearForSale('mars-depot').some((g) => g.maker === 'ares' && g.tier === 5)).toBe(true);
    expect(gearForSale('sirius-platform').some((g) => g.maker === 'horizon' && g.tier === 5)).toBe(true);
    for (const shop of RULES.shops) expect(shipsForSale(shop.locationId).some((s) => s.maker === 'wake')).toBe(false);
    expect(gearForSale('barnard-relay')).toEqual([]);
  });
});

describe('guardrails catch broken rules', () => {
  const tweak = (edit: (rules: ContentRules) => ContentRules) => {
    const rules = edit(structuredClone(RULES) as ContentRules);
    return validateCatalog(buildCatalog(rules, CATALOG_SEED), rules).map((i) => i.rule);
  };

  it('flags an out-of-range maker trait', () => {
    expect(tweak((r) => ({ ...r, makers: r.makers.map((m) => (m.id === 'ares' ? { ...m, traits: { ...m.traits, agility: 1.6 } } : m)) }))).toContain('traits');
  });

  it('flags gear that is not sold anywhere', () => {
    expect(tweak((r) => ({ ...r, shops: r.shops.map((s) => (s.locationId === 'sirius-platform' ? { ...s, maxClass: 3 as const } : s)) }))).toContain('availability');
  });

  it('flags a name that collides with a place', () => {
    expect(
      tweak((r) => ({
        ...r,
        makers: r.makers.map((m) => (m.id === 'halden' ? { ...m, names: { ...m.names, gear: { ...m.names.gear, pulse: 'Deimos' } } } : m)),
      })),
    ).toContain('names');
  });

  it('flags a ship left without guns', () => {
    expect(
      tweak((r) => ({ ...r, classes: r.classes.map((c) => (c.id === 'courier' ? { ...c, slots: { ...c.slots, gun: [0, 0, 0, 0, 0] } } : c)) })),
    ).toContain('fittings');
  });

  it('flags a freighter that stops out-carrying the fighters', () => {
    expect(
      tweak((r) => ({ ...r, classes: r.classes.map((c) => (c.id === 'freighter' ? { ...c, base: { ...c.base, cargo: 10 } } : c)) })),
    ).toContain('trade-offs');
  });
});

describe('catalogue summary', () => {
  it('matches the reviewed balance table (update with `vitest -u` when tuning on purpose)', () => {
    const ships = catalog.ships.map((s) => {
      const p = stock(s);
      return [
        s.id.padEnd(30),
        s.name.padEnd(20),
        String(s.price).padStart(6),
        `hull ${p.hullMax}`.padEnd(9),
        `cargo ${p.cargo}`.padEnd(10),
        `v ${p.flight.maxSpeed}`.padEnd(8),
        `turn ${p.flight.maxTurnRate}`.padEnd(10),
        `guns ${p.guns.length}`.padEnd(7),
        `rating ${combatRating(p).toFixed(1)}`.padEnd(12),
        `mirror ${duelSeconds(p, p, RULES.balance.hitRate).toFixed(1)} s`,
      ].join(' ');
    });
    const gear = catalog.gear.map((g) => `${g.id.padEnd(34)} ${g.name.padEnd(34)} ${String(g.price).padStart(5)}  ${g.description}`);
    expect(['SHIPS', ...ships, '', 'EQUIPMENT', ...gear].join('\n')).toMatchSnapshot();
  });
});
