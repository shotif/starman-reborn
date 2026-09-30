import { describe, expect, it } from 'vitest';
import { migrateSave } from '../../src/app/save/migrate.ts';
import { createNewGame, type GameState } from '../../src/app/state.ts';
import { getCatalog, resaleValue } from '../../src/content/catalog.ts';
import { COMBAT } from '../../src/content/combat/rules.ts';
import { DENS } from '../../src/content/dens/rules.ts';
import { ALL_LOCATIONS, getLocation } from '../../src/data/systems.ts';
import { boardFor } from '../../src/economy/contracts.ts';
import {
  buyDecoy,
  decoyOffer,
  denBounty,
  denPayer,
  dismissWingman,
  fitFromStash,
  hireWingman,
  payCrew,
  pilotsFor,
  repairSystems,
  sellFromStash,
  stashGear,
  stashOffers,
  systemsQuote,
  wingmanLost,
} from '../../src/economy/combat.ts';
import { densDownNear, denDown } from '../../src/economy/dens.ts';
import { acceptJob, jobLockReason } from '../../src/economy/jobs.ts';
import { fittedItem, shipSlots } from '../../src/economy/loadout.ts';
import { sellsEquipment } from '../../src/economy/equipment.ts';

/** Combat depth in the economy (docs/PROCGEN.md §15). */

function pilot(): GameState {
  const s = createNewGame(23);
  s.jobs.lifeline = { status: 'complete', objectiveIndex: 4, acceptedAt: 0, completedAt: 1 };
  s.credits = 20_000;
  return s;
}

const dealer = ALL_LOCATIONS.find((l) => l.status === 'functional' && l.dockable !== false && sellsEquipment(l.id) && (l.factionId === 'sta' || l.factionId === 'frontier'))!;

describe('salvaged equipment', () => {
  it('goes into the stash, and once the stash is full it is sold on the spot', () => {
    const s = pilot();
    const gear = getCatalog().gear.find((g) => g.slot === 'gun' && g.tier === 1)!;
    for (let i = 0; i < COMBAT.loot.stash; i++) expect(stashGear(s, gear.id).stored).toBe(true);
    const before = s.credits;
    const r = stashGear(s, gear.id);
    expect(r).toMatchObject({ stored: false, credits: resaleValue(gear.price) });
    expect(s.credits).toBe(before + resaleValue(gear.price));
    expect(s.stash).toHaveLength(COMBAT.loot.stash);
  });

  it('can be fitted (the old item is sold) or sold at an equipment dealer, and nowhere else', () => {
    const s = pilot();
    const gunSlot = shipSlots(s.ship).find((sl) => sl.type === 'gun')!;
    const better = getCatalog().gear.find((g) => g.slot === 'gun' && g.tier <= gunSlot.maxClass && g.id !== fittedItem(s.ship, gunSlot.id)?.id)!;
    stashGear(s, better.id);
    const offers = stashOffers(s, dealer.id);
    expect(offers[0]).toMatchObject({ gearId: better.id, blocked: null });
    expect(offers[0]!.slots.map((x) => x.id)).toContain(gunSlot.id);
    const noDealer = ALL_LOCATIONS.find((l) => l.status === 'functional' && l.dockable !== false && !sellsEquipment(l.id))!;
    expect(fitFromStash(s, noDealer.id, 0, gunSlot.id).ok).toBe(false);
    const old = fittedItem(s.ship, gunSlot.id)!;
    const credits = s.credits;
    expect(fitFromStash(s, dealer.id, 0, gunSlot.id)).toMatchObject({ ok: true });
    expect(s.ship.fittings[gunSlot.id]).toBe(better.id);
    expect(s.credits).toBe(credits + resaleValue(old.price));
    expect(s.stash).toEqual([]);
    stashGear(s, old.id);
    expect(sellFromStash(s, dealer.id, 0)).toMatchObject({ ok: true });
    expect(s.stash).toEqual([]);
  });
});

describe('decoys and repairs', () => {
  it('new ships carry decoys; the outfitter sells more up to the launcher’s capacity', () => {
    const s = pilot();
    expect(s.ship.decoys).toBe(COMBAT.decoys.starting);
    while (s.ship.decoys < COMBAT.decoys.max) expect(buyDecoy(s, dealer.id).ok).toBe(true);
    expect(decoyOffer(s, dealer.id)?.blocked).toBe('Launcher full');
    expect(buyDecoy(s, dealer.id).ok).toBe(false);
  });

  it('damaged systems are repaired at a dock for a price that grows with the damage', () => {
    const s = pilot();
    expect(systemsQuote(s, dealer.id)).toBe(0);
    s.ship.systems = { engines: 0.5, guns: 0, shields: 0 };
    const half = systemsQuote(s, dealer.id);
    s.ship.systems = { engines: 1, guns: 0.5, shields: 0.5 };
    const worse = systemsQuote(s, dealer.id);
    expect(worse).toBeGreaterThan(half);
    const credits = s.credits;
    expect(repairSystems(s, dealer.id)).toMatchObject({ ok: true, cost: worse });
    expect(s.credits).toBe(credits - worse);
    expect(s.ship.systems).toEqual({ engines: 0, guns: 0, shields: 0 });
  });
});

describe('wingmen for hire', () => {
  const base = ALL_LOCATIONS.find((l) => l.stationType === 'military-base' && l.status === 'functional')!;

  it('are posted at military bases and busy ports, the same for everyone in a time slot', () => {
    const pilots = pilotsFor(base.id, 0);
    expect(pilots).toHaveLength(COMBAT.wingmen.where['military-base']!);
    expect(pilotsFor(base.id, 0)).toEqual(pilots);
    for (const p of pilots) {
      expect(p.name).toMatch(/^\S+ \S+$/);
      expect(p.fee).toBeGreaterThan(0);
    }
    const quiet = ALL_LOCATIONS.find((l) => l.stationType === 'research-station')!;
    expect(pilotsFor(quiet.id, 0)).toEqual([]);
  });

  it('hiring costs one fee; each jump pays the wing; a pilot you cannot pay, or whose ship is lost, leaves', () => {
    const s = pilot();
    const [a, b] = pilotsFor(base.id, 0);
    const credits = s.credits;
    expect(hireWingman(s, base.id, a!.id).ok).toBe(true);
    expect(s.credits).toBe(credits - a!.fee);
    expect(hireWingman(s, base.id, a!.id).ok).toBe(false);
    expect(hireWingman(s, base.id, b!.id).ok).toBe(true);
    const port = ALL_LOCATIONS.find((l) => l.stationType === 'trade-port' && l.status === 'functional')!;
    expect(hireWingman(s, port.id, pilotsFor(port.id, 0)[0]!.id)).toMatchObject({ ok: false, message: expect.stringMatching(/full/) });
    const before = s.credits;
    expect(payCrew(s, 2)).toMatchObject({ paid: 2 * (a!.fee + b!.fee), notes: [] });
    expect(s.credits).toBe(before - 2 * (a!.fee + b!.fee));
    s.credits = a!.fee;
    const r = payCrew(s, 1);
    expect(r.notes).toHaveLength(1);
    expect(s.crew).toHaveLength(1);
    wingmanLost(s, s.crew[0]!.id);
    expect(s.crew).toEqual([]);
    expect(dismissWingman(s, 'nobody').ok).toBe(false);
  });

  it('nobody flies with a wanted pilot', () => {
    const s = pilot();
    s.law.fines[base.factionId as 'sta' | 'frontier'] = 500;
    expect(hireWingman(s, base.id, pilotsFor(base.id, 0)[0]!.id).ok).toBe(false);
  });
});

describe('raider dens knocked out', () => {
  const den = ALL_LOCATIONS.find((l) => l.stationType === 'pirate-den' && l.status === 'functional')!;

  it('on the player’s own account: dark for a while, paid by the nearest law, resented by the Wake', () => {
    const s = pilot();
    const payer = denPayer(den.systemId);
    const standing = s.reputation[payer];
    const wake = s.reputation['hollow-wake'];
    const credits = s.credits;
    denBounty(s, den.id);
    expect(denDown(s, den.id)).toBe(true);
    expect(s.credits).toBe(credits + DENS.bounty);
    expect(s.reputation[payer]).toBe(standing + DENS.bountyStanding);
    expect(s.reputation['hollow-wake']).toBe(Math.max(-100, wake + DENS.wakeStanding));
    expect(densDownNear(s, den.systemId).map((d) => d.locationId)).toContain(den.id);
    s.clock += DENS.downSeconds;
    expect(densDownNear(s, den.systemId)).toEqual([]);
  });

  it('den assault contracts are posted by the law within reach, pass their guardrails, need a record, and not for a dark den', () => {
    const posted = ALL_LOCATIONS.filter((l) => l.status === 'functional').flatMap((l) => Array.from({ length: 30 }, (_, e) => boardFor(l.id, e)).flat()).filter((c) => c.contract?.kind === 'den');
    expect(posted.length).toBeGreaterThan(0);
    // (Every board, den assaults included, passes the contract guardrails in contracts.test.ts.)
    for (const c of posted) expect(['sta', 'frontier']).toContain(getLocation(c.giverLocationId).factionId);
    const job = posted[0]!;
    const s = pilot();
    // Top-difficulty work asks for Friendly standing with the poster, and den assaults for a record.
    s.reputation[job.factionId!] = 20;
    expect(jobLockReason(s, job)).toMatch(/combat rating/);
    s.stats.kills = 30;
    expect(jobLockReason(s, job)).toBeNull();
    const o = job.objectives[0]!;
    if (o.kind !== 'assault') throw new Error('not an assault');
    s.dens[o.locationId] = s.clock;
    expect(jobLockReason(s, job)).toMatch(/already dark/);
    delete s.dens[o.locationId];
    s.location.dockedAt = job.giverLocationId;
    s.location.systemId = getLocation(job.giverLocationId).systemId;
    expect(acceptJob(s, job.id).ok).toBe(true);
  });
});

describe('combat saves', () => {
  it('a v7 save gets decoys, intact systems, an empty stash and no wing; damaged combat data is rejected', () => {
    const { story: _s, dens: _d, stash: _st, crew: _c, ...rest } = createNewGame(5);
    const { decoys: _dc, systems: _sy, ...ship } = rest.ship;
    const s = migrateSave({ ...structuredClone(rest), ship, version: 7 });
    expect(s.ship.decoys).toBe(COMBAT.decoys.starting);
    expect(s.ship.systems).toEqual({ engines: 0, guns: 0, shields: 0 });
    expect(s.stash).toEqual([]);
    expect(s.crew).toEqual([]);
    expect(() => migrateSave({ ...structuredClone(s), stash: ['gear.nothing'] })).toThrow();
    expect(() => migrateSave({ ...structuredClone(s), ship: { ...s.ship, systems: { engines: 2, guns: 0, shields: 0 } } })).toThrow();
    expect(() => migrateSave({ ...structuredClone(s), crew: [{ id: 'x', name: 'X', model: 'ship.nothing', fee: 10, skill: 'steady' }] })).toThrow();
  });
});
