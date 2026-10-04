import { afterEach, describe, expect, it } from 'vitest';
import { assertValidState, migrateSave } from '../../src/app/save/migrate.ts';
import { createNewGame, markVisited, type GameState, type OutpostRecord } from '../../src/app/state.ts';
import { dockAt } from '../../src/app/rules.ts';
import { COMMODITIES, type CommodityId } from '../../src/content/economy/goods.ts';
import { OUTPOSTS } from '../../src/content/outposts/rules.ts';
import { beltSiteId, outpostId, outpostSite, outpostSites, sitesIn } from '../../src/content/outposts/sites.ts';
import { BELTS, getLocation } from '../../src/data/systems.ts';
import { useWorldLog } from '../../src/economy/events.ts';
import { fleetNews, settleFleet } from '../../src/economy/fleet.ts';
import { stockAvailable } from '../../src/economy/markets.ts';
import { beltSiteIssues, validateBeltOutposts } from '../../src/economy/beltOutpostGuards.ts';
import type { OutpostRules } from '../../src/economy/outpostGuards.ts';
import { nextRaid } from '../../src/economy/outpostRaids.ts';
import { charterOffers, charterOutpost, deliverToOutpost, outpostAt, outpostIn, outpostsOf, stillNeeded } from '../../src/economy/outposts.ts';
import { giveUpBlock, giveUpOutpost, nearestDock, outpostCost, refinable, refineAllowance, refineAtOutpost, refinePay, saleValue } from '../../src/economy/outpostTrade.ts';
import { SystemScene } from '../../src/world/SystemScene.ts';
import { sceneDefFor } from '../../src/world/systems/index.ts';

/**
 * Outposts in the belts (docs/PROCGEN.md §36): the sites, up to three outposts and one a system,
 * the scene, refining, selling and abandoning, income and raids, and the save (the haulers at an
 * outpost are the timetable's, tests/unit/outpostTrade.test.ts).
 */

afterEach(() => useWorldLog(null));

const MAIN = beltSiteId('sol-main-belt');
const KUIPER = beltSiteId('sol-kuiper-belt');
const TAU = beltSiteId('tau-ceti-debris-disc');
const FOMALHAUT = beltSiteId('fomalhaut-debris-disc');
const HOUR = 3_600;

function pilotAt(locationId: string, credits = 500_000): GameState {
  const s = createNewGame(23);
  s.jobs.lifeline = { status: 'complete', objectiveIndex: 4, acceptedAt: 0, completedAt: 1 };
  s.flags.clearance = true;
  s.credits = credits;
  moveTo(s, locationId);
  useWorldLog(s.world);
  return s;
}

/** Puts the pilot at a station (as if they had flown there). */
function moveTo(s: GameState, locationId: string): void {
  const loc = getLocation(locationId);
  s.location = { systemId: loc.systemId, dockedAt: locationId, flight: null, lastDockId: locationId };
  markVisited(s, loc.systemId, locationId);
}

/** Charters a site from where the pilot is docked, as the first kind and name offered. */
function charter(s: GameState, siteId: string): ReturnType<typeof charterOutpost> {
  const offer = charterOffers(s).find((x) => x.site.id === siteId);
  if (!offer) return { ok: false, message: 'not offered here' };
  return charterOutpost(s, siteId, offer.kinds[0]!.kind, offer.kinds[0]!.names[0]!);
}

/** Docks at an outpost and builds its stages, the goods put in the hold as if bought. */
function build(s: GameState, siteId: string, stages: number): OutpostRecord {
  dockAt(s, outpostId(siteId));
  const o = outpostAt(s, outpostId(siteId))!;
  for (let i = 0; i < stages; i++) {
    for (const x of stillNeeded(o)) {
      s.ship.cargo = { [x.commodity]: x.left };
      expect(deliverToOutpost(s, x.commodity, x.left).ok).toBe(true);
    }
  }
  return o;
}

/** A pilot with a belt outpost in Sol's main belt, its frame up, docked there. */
function mainBelt(stages = 1): { s: GameState; o: OutpostRecord } {
  const s = pilotAt('earth-port');
  expect(charter(s, MAIN).ok).toBe(true);
  return { s, o: build(s, MAIN, stages) };
}

describe('belt sites', () => {
  it('one in each cited belt, Sol’s included: nine in eight systems, always a refinery', () => {
    const belts = outpostSites().filter((s) => s.beltId);
    expect(belts).toHaveLength(BELTS.length);
    expect(belts).toHaveLength(9);
    expect(new Set(belts.map((s) => s.systemId)).size).toBe(8);
    for (const b of BELTS) expect(outpostSite(beltSiteId(b.id))).toMatchObject({ beltId: b.id, systemId: b.systemId, kinds: ['refinery'] });
    expect(sitesIn('sol').map((s) => s.id)).toEqual([MAIN, KUIPER]);
  });

  it('pass the guardrails, which catch rules and places broken', () => {
    expect(validateBeltOutposts()).toEqual([]);
    const broken = (patch: (r: OutpostRules) => void) => {
      const r = structuredClone(OUTPOSTS) as OutpostRules;
      patch(r);
      return validateBeltOutposts(r).map((i) => i.rule);
    };
    expect(broken((r) => ((r.refining as { pay: number }).pay = 1.5))).toContain('refining');
    expect(broken((r) => ((r.refining as unknown as { perHour: number[] }).perHour = [40, 40, 80]))).toContain('refining');
    expect(broken((r) => ((r.refining as { per: number }).per = 3))).toContain('refining');
    expect(broken((r) => ((r.refining.goods as Record<string, string>).ore = 'food'))).toContain('refining');
    expect(broken((r) => ((r.belts as unknown as { kinds: string[] }).kinds = ['factory']))).toContain('rules');
    expect(broken((r) => ((r as { max: number }).max = 9))).toContain('rules');
    expect(broken((r) => ((r as { sale: number }).sale = 1.2))).toContain('rules');
    expect(broken((r) => ((r.belts.angle as Record<string, number>)['no-such-belt'] = 10))).toContain('belts');
    // A belt without its site, and a site that could be something else.
    expect(validateBeltOutposts(OUTPOSTS, outpostSites().filter((s) => s.id !== TAU)).map((i) => i.subject)).toContain('tau-ceti-debris-disc');
    expect(validateBeltOutposts(OUTPOSTS, outpostSites().map((s) => (s.id === TAU ? { ...s, kinds: ['refinery', 'factory'] } : s))).map((i) => i.subject)).toContain(TAU);
    // A station or a lane where the site is.
    const def = sceneDefFor('tau-ceti');
    const site = outpostSite(TAU)!;
    expect(beltSiteIssues(def, site)).toEqual([]);
    const at = sceneDefFor('tau-ceti').stations[0]!;
    const crowded = { ...def, stations: [{ ...at, position: ringPoint(def, site) }] };
    expect(beltSiteIssues(crowded, site).join()).toMatch(/near/);
    const laned = { ...def, lanes: [{ ...(sceneDefFor('sol').lanes[0]!), from: ringPoint(def, site).add({ x: 0, y: 0, z: -5_000 } as never), to: ringPoint(def, site).add({ x: 0, y: 0, z: 5_000 } as never) }] };
    expect(beltSiteIssues(laned, site).join()).toMatch(/on the lane/);
  });

  it('stand in their ring in the scene, bays facing out, with no rock in the way', () => {
    const { s } = mainBelt(0);
    const id = outpostId(MAIN);
    const def = sceneDefFor('sol');
    const dock = def.stations.find((x) => x.locationId === id)!;
    const ring = def.belts.find((b) => b.beltId === 'sol-main-belt')!;
    const radial = Math.hypot(dock.position.x - ring.center.x, dock.position.z - ring.center.z);
    expect(radial).toBeCloseTo((ring.innerRadius + ring.outerRadius) / 2, 0);
    expect(dock.position.y).toBeCloseTo(ring.center.y, 0);
    const out = dock.position.clone().sub(ring.center).setY(0).normalize();
    expect(dock.approach.dot(out)).toBeGreaterThan(0.95);
    expect(getLocation(id)).toMatchObject({ systemId: 'sol', stationType: 'refinery', fictional: true });
    expect(getLocation(id).nearBodyId).toBeUndefined();
    expect(getLocation(id).description).toMatch(/in the Main asteroid belt/);
    installCanvasStub();
    const scene = new SystemScene(def, { quality: 'high', reducedMotion: true });
    const site = scene.docks.find((d) => d.def.locationId === id)!;
    expect(site.dockable).toBe(true);
    expect(scene.asteroidsNear(dock.position, site.radius + 600, [])).toBe(0);
    // The Eridani Mining Hub, in its belt, keeps rock off it the same way.
    const eri = new SystemScene(sceneDefFor('epsilon-eridani'), { quality: 'high', reducedMotion: true });
    const hub = eri.docks.find((d) => d.def.locationId === 'eridani-hub')!;
    expect(eri.asteroidsNear(hub.def.position, hub.radius + 600, [])).toBe(0);
    expect(s.world.outposts).toHaveLength(1);
  });
});

describe('up to three outposts', () => {
  it('at most one in a system and three in all, any mix of planet and belt sites', () => {
    const s = pilotAt('earth-port');
    const offers = charterOffers(s);
    expect(offers.map((x) => x.site.id)).toEqual([MAIN, KUIPER]);
    expect(offers[0]!.kinds).toEqual([{ kind: 'refinery', names: expect.any(Array) }]);
    expect(charter(s, MAIN).ok).toBe(true);
    // One in a system.
    expect(charterOffers(s)[0]!.blocked).toMatch(/one outpost to a system/);
    expect(charter(s, KUIPER).ok).toBe(false);
    // A planet's elsewhere, and another belt's.
    moveTo(s, 'wayfarer-array');
    expect(charter(s, 'gj-411-b').ok).toBe(true);
    moveTo(s, 'larkspur-stillworks');
    expect(charter(s, TAU).ok).toBe(true);
    expect(outpostsOf(s).map((o) => o.site)).toEqual([MAIN, 'gj-411-b', TAU]);
    expect(outpostIn(s, 'tau-ceti')?.site).toBe(TAU);
    // Three in all.
    moveTo(s, 'vega-signal');
    expect(charterOffers(s)[0]!.blocked).toMatch(/as many as a pilot can/);
    expect(charter(s, beltSiteId('vega-debris-disc')).ok).toBe(false);
    assertValidState(s);
  });

  it('each pays its own income, settled together', () => {
    const s = pilotAt('earth-port');
    charter(s, MAIN);
    build(s, MAIN, 1);
    moveTo(s, 'wayfarer-array');
    charter(s, 'gj-411-b');
    build(s, 'gj-411-b', 1);
    const credits = s.credits;
    s.clock += 3 * HOUR;
    const r = settleFleet(s);
    expect(r.outposts).toBe(2);
    expect(r.outpost).toBeGreaterThan(0);
    expect(s.credits - credits).toBe(r.outpost);
    expect(outpostsOf(s).every((o) => o.earned > 0)).toBe(true);
    expect(fleetNews(r).map((n) => n.text).join()).toMatch(/Income from your outposts: \+/);
  });

  it('are raided by their system’s rules: none in secure Sol, the probe in lawless Fomalhaut', () => {
    const { s, o } = mainBelt(1);
    expect(nextRaid(s, o, 40)).toBeNull();
    moveTo(s, 'fomalhaut-freeport');
    expect(charter(s, FOMALHAUT).ok).toBe(true);
    const f = build(s, FOMALHAUT, 1);
    expect(nextRaid(s, f, 6)).toMatchObject({ probe: true });
  });
});

describe('refining', () => {
  it('pays above any market for the raw goods, so many an hour by the stages, and stocks its market with half in refined goods', () => {
    const { s, o } = mainBelt(1);
    const id = outpostId(MAIN);
    expect(refineAllowance(o)).toBe(OUTPOSTS.refining.perHour[0]);
    s.clock = 10 * HOUR + 100;
    s.ship.cargo = { ore: 30, gases: 30, food: 5 };
    const metals = stockAvailable(id, 'metals', s);
    const credits = s.credits;
    expect(refinable(s, 'food')).toBe(0);
    expect(refineAtOutpost(s, 'food' as CommodityId, 5).ok).toBe(false);
    const r = refineAtOutpost(s, 'ore', 30);
    expect(r).toMatchObject({ ok: true, paid: 30 * refinePay('ore') });
    expect(refinePay('ore')).toBe(Math.round(COMMODITIES.ore.basePrice * OUTPOSTS.refining.pay));
    expect(s.credits).toBe(credits + 30 * refinePay('ore'));
    expect(s.ship.cargo.ore ?? 0).toBe(0);
    expect(stockAvailable(id, 'metals', s)).toBe(metals + 15);
    // The hour's allowance: 40 at the frame, ten left.
    expect(refinable(s, 'gases')).toBe(10);
    expect(refineAtOutpost(s, 'gases', 20).ok).toBe(false);
    expect(refineAtOutpost(s, 'gases', 10).ok).toBe(true);
    expect(o.refined).toEqual({ hour: 10, units: 40 });
    expect(refineAtOutpost(s, 'gases', 1).message).toMatch(/all it can this hour/);
    assertValidState(s);
    // The next hour, room again (and no carry-over).
    s.clock = 11 * HOUR;
    expect(refinable(s, 'gases')).toBe(20);
    // Grown to a port, it takes more.
    build(s, MAIN, 2);
    expect(refineAllowance(o)).toBe(OUTPOSTS.refining.perHour[2]);
  });

  it('only at a belt outpost of the pilot’s, once its frame is up', () => {
    const s = pilotAt('wayfarer-array');
    charter(s, 'gj-411-b');
    build(s, 'gj-411-b', 1);
    s.ship.cargo = { ore: 10 };
    expect(refinable(s, 'ore')).toBe(0);
    expect(refineAtOutpost(s, 'ore', 10).ok).toBe(false);
    const b = mainBelt(0).s;
    b.ship.cargo = { ore: 10 };
    expect(refineAtOutpost(b, 'ore', 10).message).toMatch(/once its frame is up/);
  });
});

describe('selling and abandoning', () => {
  it('sells for half of what went in, frees the site, and leaves nothing that names its station', () => {
    const { s, o } = mainBelt(1);
    const id = outpostId(MAIN);
    // Things that name it: a parked captain on a route there, an empty lease, a watch, a rumour, a job of its board, a raid job.
    s.fleet.storage[id] = {};
    s.priceWatch.push({ locationId: id, commodity: 'metals' });
    s.rumours.push({ key: 'barkeep.1', kind: 'price', at: s.clock, locationId: id, text: 'Heard at your refinery.' });
    s.ship.cargo = { ore: 4 };
    refineAtOutpost(s, 'ore', 4);
    s.contracts['board.done'] = { id: 'board.done', title: 'A job from its board', giverLocationId: id, destinationLocationId: 'mars-depot' } as never;
    s.jobs['board.done'] = { status: 'complete', objectiveIndex: 1, acceptedAt: 0, completedAt: 1 };
    s.jobs[`op.${MAIN}.3`] = { status: 'active', objectiveIndex: 0, acceptedAt: 0 };
    s.contracts[`op.${MAIN}.3`] = { id: `op.${MAIN}.3`, title: 'Defend it', giverLocationId: id, destinationLocationId: id } as never;
    const half = Math.round(outpostCost(o) * OUTPOSTS.sale);
    const goods = (Object.entries(OUTPOSTS.stages[0]!.needs) as [CommodityId, number][]).reduce((sum, [c, q]) => sum + q * COMMODITIES[c].basePrice, 0);
    expect(outpostCost(o)).toBe(OUTPOSTS.charter + goods);
    expect(saleValue(o)).toBe(half);
    expect(giveUpBlock(s, o)).toBeNull();
    const credits = s.credits;
    const r = giveUpOutpost(s, MAIN, 'sold');
    expect(r).toMatchObject({ ok: true, paid: half, movedTo: nearestDock(o) });
    expect(r.message).toMatch(/sold to the Sol Transit Authority/);
    expect(s.credits).toBe(credits + half);
    expect(s.location.dockedAt).toBe(nearestDock(o));
    expect(['earth-port', 'mars-depot']).toContain(s.location.dockedAt);
    expect(outpostsOf(s)).toEqual([]);
    expect(s.world.outpostsFormer).toEqual([{ site: MAIN, name: o.name, kind: 'refinery', stage: 1, founded: o.founded, ended: s.clock, how: 'sold', paid: half }]);
    const saved = JSON.stringify(s);
    expect(saved).not.toContain(`"${id}"`);
    expect(saved).not.toContain(`op.${MAIN}.`);
    expect(() => getLocation(id)).toThrow();
    // The site is free again, and the save is whole.
    expect(charterOffers(s).find((x) => x.site.id === MAIN)?.blocked).toBeNull();
    assertValidState(s);
    expect(migrateSave(structuredClone(s))).toEqual(s);
  });

  it('abandons for nothing, from a station of its system too; not while goods, a run or a job hold it', () => {
    const { s, o } = mainBelt(1);
    const id = outpostId(MAIN);
    dockAt(s, 'earth-port');
    s.fleet.storage[id] = { ore: 3 };
    expect(giveUpBlock(s, o)).toMatch(/Take what you stored/);
    s.fleet.storage[id] = {};
    s.fleet.ships.push({ id: 'ship-1', locationId: 'earth-port', ship: structuredClone(s.ship), hauler: { captain: 'Ines Holt', route: { from: 'earth-port', to: id, commodity: 'water' }, insured: false, hired: 0, leg: 'out', since: 0, cost: 100, waiting: null, waits: 0, recalled: false, runs: 0, earned: 0 } });
    expect(giveUpBlock(s, o)).toMatch(/Captain Ines Holt is on a run there/);
    s.fleet.ships[0]!.hauler!.leg = 'home';
    s.contracts['x.1'] = { id: 'x.1', title: 'Ore for the refinery', giverLocationId: 'earth-port', destinationLocationId: id } as never;
    s.jobs['x.1'] = { status: 'active', objectiveIndex: 0, acceptedAt: 0 };
    expect(giveUpBlock(s, o)).toMatch(/Finish or drop the job Ore for the refinery/);
    delete s.jobs['x.1'];
    delete s.contracts['x.1'];
    // From another system, never.
    moveTo(s, 'wayfarer-array');
    expect(giveUpBlock(s, o)).toMatch(/a station of its system/);
    moveTo(s, 'mars-depot');
    const credits = s.credits;
    const r = giveUpOutpost(s, MAIN, 'abandoned');
    expect(r.ok).toBe(true);
    expect(r.movedTo).toBeUndefined();
    expect(s.credits).toBe(credits);
    expect(s.location.dockedAt).toBe('mars-depot');
    // The parked captain is stood down at their ship's dock; the respawn dock is a real one.
    expect(s.fleet.ships[0]!.hauler).toBeUndefined();
    expect(s.location.lastDockId).not.toBe(id);
    expect(s.world.outpostsFormer?.[0]).toMatchObject({ how: 'abandoned', paid: 0 });
    assertValidState(s);
  });

  it('the journal keeps the last six given up', () => {
    const s = pilotAt('earth-port');
    for (let i = 0; i < 8; i++) {
      s.clock += HOUR;
      expect(charter(s, i % 2 ? KUIPER : MAIN).ok).toBe(true);
      expect(giveUpOutpost(s, i % 2 ? KUIPER : MAIN, 'abandoned').ok).toBe(true);
    }
    expect(s.world.outpostsFormer).toHaveLength(OUTPOSTS.former);
    expect(s.world.outpostsFormer!.at(-1)!.ended).toBe(s.clock);
    assertValidState(s);
  });
});

describe('saves', () => {
  it('a save from before keeps its one outpost as the first', () => {
    const { s } = mainBelt(1);
    const old = structuredClone(s) as unknown as { world: Record<string, unknown> };
    old.world.outpost = (old.world.outposts as unknown[])[0];
    delete old.world.outposts;
    const back = migrateSave(old);
    expect(back.world.outposts).toEqual(s.world.outposts);
    expect('outpost' in back.world).toBe(false);
  });

  it('refuse more than three, two in a system, a belt outpost of another kind, refining over the allowance, and too many former ones', () => {
    const s = pilotAt('earth-port');
    charter(s, MAIN);
    build(s, MAIN, 1);
    moveTo(s, 'earth-port');
    assertValidState(s);
    const bad = (patch: (x: GameState) => void) => {
      const x = structuredClone(s);
      patch(x);
      return () => assertValidState(x);
    };
    const o = s.world.outposts![0]!;
    const other = (site: string): OutpostRecord => ({ ...structuredClone(o), site, kind: outpostSite(site)!.kinds[0]! });
    expect(bad((x) => x.world.outposts!.push(other('gj-411-b'), other(TAU), other(FOMALHAUT)))).toThrow(/outposts/);
    expect(bad((x) => x.world.outposts!.push(other(KUIPER)))).toThrow(/two outposts in one system/);
    expect(bad((x) => (x.world.outposts![0]!.kind = 'factory'))).toThrow(/outpost/);
    expect(bad((x) => (x.world.outposts![0]!.refined = { hour: 3, units: OUTPOSTS.refining.perHour[0] + 1 }))).toThrow(/outpost/);
    expect(bad((x) => x.world.outposts!.push({ ...other('gj-411-b'), refined: { hour: 3, units: 1 } }))).toThrow(/outpost/);
    const former = { site: KUIPER, name: 'Old Works', kind: 'refinery' as const, stage: 0, founded: 0, ended: 10, how: 'abandoned' as const, paid: 0 };
    expect(bad((x) => (x.world.outpostsFormer = Array.from({ length: OUTPOSTS.former + 1 }, () => ({ ...former }))))).toThrow(/former outposts/);
    expect(bad((x) => (x.world.outpostsFormer = [{ ...former, paid: 500 }]))).toThrow(/former outposts/);
    expect(bad((x) => (x.world.outpostsFormer = [{ ...former, site: 'nowhere' }]))).toThrow(/former outposts/);
    expect(bad((x) => (x.world.outpostsFormer = [former]))).not.toThrow();
  });
});

/** The middle of a belt site's ring in a scene, at its angle. */
function ringPoint(def: ReturnType<typeof sceneDefFor>, site: NonNullable<ReturnType<typeof outpostSite>>) {
  const ring = def.belts.find((b) => b.beltId === site.beltId)!;
  const r = (ring.innerRadius + ring.outerRadius) / 2;
  const a = (site.ring!.angle * Math.PI) / 180;
  return ring.center.clone().add({ x: Math.cos(a) * r, y: 0, z: Math.sin(a) * r } as never);
}

function installCanvasStub(): void {
  if ((globalThis as { document?: unknown }).document) return;
  const stub = (): unknown =>
    new Proxy(function () {}, {
      get(_t, prop) {
        if (prop === 'getImageData' || prop === 'createImageData') {
          return (_x: number, _y: number, w: number, h: number) => ({ data: new Uint8ClampedArray(Math.max(4, w * h * 4)), width: w, height: h });
        }
        return stub();
      },
      apply() {
        return stub();
      },
      set() {
        return true;
      },
    });
  (globalThis as { document?: unknown }).document = {
    createElement: () => ({ width: 0, height: 0, style: {}, getContext: () => stub() }),
  };
}
