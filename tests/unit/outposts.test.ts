import { afterEach, describe, expect, it } from 'vitest';
import { assertValidState } from '../../src/app/save/migrate.ts';
import { createNewGame, markVisited, type GameState } from '../../src/app/state.ts';
import { dockAt } from '../../src/app/rules.ts';
import { gearForSale } from '../../src/content/catalog.ts';
import { OUTPOSTS } from '../../src/content/outposts/rules.ts';
import { outpostId, outpostSites, sitesIn } from '../../src/content/outposts/sites.ts';
import { ALL_LOCATIONS, getLocation, getPlanet, saveLocations, WORLD_SEEDS } from '../../src/data/systems.ts';
import { hasOutfitter, repairKitOffer } from '../../src/economy/equipment.ts';
import { systemEventAt, useWorldLog } from '../../src/economy/events.ts';
import { haulDestinations, settleFleet } from '../../src/economy/fleet.ts';
import { dockFees } from '../../src/economy/hauls.ts';
import { postedContracts } from '../../src/economy/contracts.ts';
import { hasMarket, marketTables, quote } from '../../src/economy/markets.ts';
import { validateOutposts, type OutpostRules } from '../../src/economy/outpostGuards.ts';
import { charterOffers, charterOutpost, deliverable, deliverToOutpost, incomeAt, outpostStatus, stillNeeded } from '../../src/economy/outposts.ts';
import { stationRooms } from '../../src/ui/station/StationHub.ts';
import { SystemScene } from '../../src/world/SystemScene.ts';
import { sceneDefFor } from '../../src/world/systems/index.ts';

/**
 * A station of your own (docs/PROCGEN.md §22): the sites, the charter, building it stage by stage,
 * its market, board and outfitter, its income, the scene, and the save; and nothing of anyone
 * else's changing.
 */

afterEach(() => useWorldLog(null));

const NEUTRAL = { sta: 0, frontier: 0, 'hollow-wake': 0 };
/** Lalande 21185, two jumps from Sol: two confirmed planets, and a research station to charter from. */
const SYSTEM = 'lalande-21185';
const PLANET = 'gj-411-b';
const DOCK = 'wayfarer-array';

function pilotAt(locationId: string, credits = 200_000): GameState {
  const s = createNewGame(17);
  s.jobs.lifeline = { status: 'complete', objectiveIndex: 4, acceptedAt: 0, completedAt: 1 };
  s.flags.clearance = true;
  s.credits = credits;
  const loc = getLocation(locationId);
  s.location = { systemId: loc.systemId, dockedAt: locationId, flight: null, lastDockId: locationId };
  markVisited(s, loc.systemId, locationId);
  useWorldLog(s.world);
  return s;
}

/** A pilot with an outpost chartered at PLANET, of the first kind offered, docked there. */
function chartered(kind?: string): GameState {
  const s = pilotAt(DOCK);
  const offer = charterOffers(s).find((x) => x.site.planetId === PLANET)!;
  const k = offer.kinds.find((x) => x.kind === kind) ?? offer.kinds[0]!;
  expect(charterOutpost(s, PLANET, k.kind, k.names[0]!).ok).toBe(true);
  dockAt(s, outpostId(PLANET));
  return s;
}

/** Puts the goods a stage needs in the hold (as if bought) and hands them all over. */
function build(s: GameState, stages: number): void {
  for (let i = 0; i < stages; i++) {
    for (const x of stillNeeded(s.world.outposts![0]!)) {
      s.ship.cargo = { [x.commodity]: x.left };
      expect(deliverToOutpost(s, x.commodity, x.left).ok).toBe(true);
    }
  }
}

describe('outpost sites', () => {
  it('pass their guardrails, and broken rules are caught', () => {
    expect(validateOutposts()).toEqual([]);
    const broken = (patch: (r: OutpostRules) => void) => {
      const r = structuredClone(OUTPOSTS) as OutpostRules;
      patch(r);
      return validateOutposts(r).map((i) => i.rule);
    };
    expect(broken((r) => ((r.stages[1]!.needs as Record<string, number>).stims = 5))).toContain('rules');
    expect(broken((r) => ((r.stages[2] as { income: number }).income = 500))).toContain('rules');
    expect(broken((r) => ((r.stages[1] as { services: string[] }).services = ['contracts']))).toContain('rules');
    expect(broken((r) => ((r.stages[0] as { income: number }).income = 5))).toContain('balance');
    expect(broken((r) => ((r.nameWords as string[])[0] = 'Halcyon'))).toContain('names');
    const site = outpostSites()[0]!;
    expect(validateOutposts(OUTPOSTS, [{ ...site, planetId: 'proxima-cen-b', systemId: 'alpha-centauri' }]).map((i) => i.rule)).toContain('sites');
    expect(validateOutposts(OUTPOSTS, [{ ...site, kinds: ['military-base'] }]).map((i) => i.rule)).toContain('sites');
  });

  it('one at each confirmed planet of the generated systems, none in Sol or the other hand-made systems', () => {
    const sites = outpostSites().filter((s) => s.planetId);
    expect(sites.length).toBeGreaterThan(50);
    expect(new Set(sites.map((s) => s.planetId)).size).toBe(sites.length);
    for (const s of sites) {
      expect(s.id).toBe(s.planetId);
      expect(getPlanet(s.planetId!)?.status).toBe('confirmed');
      expect(WORLD_SEEDS.find((x) => x.id === s.systemId)?.curated).toBeUndefined();
    }
    // Sol's and Proxima's sites are in their belts (docs/PROCGEN.md §36).
    expect(sitesIn('sol').every((s) => s.beltId)).toBe(true);
    expect(sitesIn('alpha-centauri').every((s) => s.beltId)).toBe(true);
    expect(sitesIn(SYSTEM).map((s) => s.planetId)).toContain(PLANET);
  });
});

describe('the charter', () => {
  it('only from a station of the site’s system, for the charter fee, one to a pilot; it is chartered with a name offered', () => {
    expect(charterOffers(pilotAt('earth-port')).filter((x) => x.site.planetId)).toEqual([]);
    const s = pilotAt(DOCK);
    const offer = charterOffers(s).find((x) => x.site.planetId === PLANET)!;
    expect(offer.blocked).toBeNull();
    const { kind, names } = offer.kinds[0]!;
    expect(charterOutpost(s, PLANET, kind, 'Anything Else').ok).toBe(false);
    const before = s.credits;
    const r = charterOutpost(s, PLANET, kind, names[1]!);
    expect(r.ok).toBe(true);
    expect(s.credits).toBe(before - OUTPOSTS.charter);
    expect(s.world.outposts).toHaveLength(1);
    expect(s.world.outposts![0]).toMatchObject({ site: PLANET, kind, name: names[1], stage: 0, delivered: {} });
    expect(charterOffers(s)[0]!.blocked).toMatch(/already/);
    expect(charterOutpost(s, 'gj-411-c', kind, names[0]!).ok).toBe(false);
    const poor = pilotAt(DOCK, 100);
    expect(charterOffers(poor)[0]!.blocked).toMatch(/credits/);
  });

  it('is a station of the save only: found by its id and in its system’s scene, never among the world’s stations', () => {
    const s = chartered();
    const id = outpostId(PLANET);
    expect(getLocation(id)).toMatchObject({ name: s.world.outposts![0]!.name, systemId: SYSTEM, services: [], nearBodyId: PLANET });
    expect(ALL_LOCATIONS.some((l) => l.id === id)).toBe(false);
    expect(saveLocations(SYSTEM).map((l) => l.id)).toEqual([id]);
    const def = sceneDefFor(SYSTEM);
    const dock = def.stations.find((x) => x.locationId === id)!;
    const planet = def.planets.find((p) => p.id === PLANET)!;
    expect(dock.position.distanceTo(planet.position)).toBeGreaterThan(planet.radius + OUTPOSTS.orbit.distance[0] - 1);
    // The scene builds it as a dock the player can fly to, being built (a shipyard's frames) or open.
    installCanvasStub();
    const scene = new SystemScene(def, { quality: 'low', reducedMotion: true });
    expect(scene.docks.find((d) => d.def.locationId === id)).toMatchObject({ dockable: true });
    expect(dock.look).toMatchObject({ type: OUTPOSTS.building.look, size: OUTPOSTS.building.size, owner: 'independent' });
    scene.dispose();
    // Another save has none.
    useWorldLog(createNewGame(3).world);
    expect(() => getLocation(id)).toThrow();
    expect(sceneDefFor(SYSTEM).stations.some((x) => x.locationId === id)).toBe(false);
  });
});

describe('building it', () => {
  it('takes what the next stage needs from the hold, at the outpost only; its frame done, it opens with a market and repairs', () => {
    const s = chartered();
    const id = outpostId(PLANET);
    expect(hasMarket(id)).toBe(false);
    expect(stationRooms(id)).toEqual(['deck', 'bar']);
    s.ship.cargo = { metals: 30, food: 5 };
    expect(deliverable(s, 'metals')).toBe(OUTPOSTS.stages[0]!.needs.metals);
    expect(deliverToOutpost(s, 'food', 5).ok).toBe(false);
    expect(deliverToOutpost(s, 'metals', 25).ok).toBe(false);
    expect(deliverToOutpost(s, 'metals', 12).ok).toBe(true);
    expect(s.ship.cargo).toEqual({ metals: 18, food: 5 });
    expect(outpostStatus(s, s.world.outposts![0]!)).toMatch(/^Its frame is going up: it still needs /);
    // Away from it, nothing can be handed over.
    const away = structuredClone(s);
    away.location.dockedAt = DOCK;
    expect(deliverToOutpost(away, 'metals', 1).ok).toBe(false);
    build(s, 1);
    expect(s.world.outposts![0]!.stage).toBe(1);
    expect(getLocation(id).services).toEqual(['market', 'repair']);
    expect(hasMarket(id)).toBe(true);
    expect(stationRooms(id)).toContain('trader');
    expect(quote(id, [...marketTables().get(id)!.entries.keys()][0]!, NEUTRAL, { clock: s.clock, markets: s.markets }).sell).toBeGreaterThan(0);
    expect(postedContracts(s, id)).toEqual([]);
  });

  it('as a station posts work on its board, and as a port sells consumables at its outfitter', () => {
    const s = chartered();
    const id = outpostId(PLANET);
    build(s, 2);
    expect(getLocation(id).services).toContain('contracts');
    expect(postedContracts(s, id).length).toBeGreaterThan(0);
    expect(hasOutfitter(id)).toBe(false);
    build(s, 1);
    expect(s.world.outposts![0]!.stage).toBe(OUTPOSTS.stages.length);
    // Consumables only: repair kits (and rounds for what is fitted), no maker's equipment.
    expect(hasOutfitter(id)).toBe(true);
    expect(gearForSale(id)).toEqual([]);
    expect(repairKitOffer(s, id)).not.toBeNull();
    expect(outpostStatus(s, s.world.outposts![0]!)).toMatch(/complete/);
  });

  it('changes nobody else’s prices, board or the world’s list of markets', () => {
    const s = pilotAt(DOCK);
    const keys = [...marketTables().keys()];
    const neighbour = marketTables().get('beacon-quarry')!;
    const prices = [...neighbour.entries.values()].map((e) => e.mid);
    const board = postedContracts(s, 'beacon-quarry').map((c) => c.id);
    const t = chartered('trade-port');
    build(t, 2);
    expect([...marketTables().keys()]).toEqual(keys);
    expect([...marketTables().get('beacon-quarry')!.entries.values()].map((e) => e.mid)).toEqual(prices);
    expect(postedContracts(t, 'beacon-quarry').map((c) => c.id)).toEqual(board);
  });
});

describe('its income', () => {
  it('pays by the hour once open, moved by raids in its system, settled with the fleet however often', () => {
    const s = chartered();
    s.clock += 7_200;
    expect(settleFleet(s).outpost).toBe(0);
    build(s, 1);
    const opened = s.clock;
    const before = s.credits;
    s.clock = opened + 3 * 3_600 + 10;
    const once = structuredClone(s);
    const r = settleFleet(s);
    const hours = [0, 1, 2].map((h) => incomeAt(s.world.outposts![0]!, opened + h * 3_600 + 1_800));
    // With the dock fees of its haulers those hours (docs/PROCGEN.md §38.2).
    const fees = dockFees(outpostId(PLANET), opened, opened + 3 * 3_600);
    expect(s.world.outposts![0]!.fees ?? 0).toBe(fees);
    expect(r.outpost).toBe(hours.reduce((a, b) => a + b, 0) + fees);
    expect(s.credits).toBe(before + r.outpost);
    expect(s.world.outposts![0]!.earned).toBe(r.outpost);
    expect(hours.every((x) => x === OUTPOSTS.stages[0]!.income || x === Math.round(OUTPOSTS.stages[0]!.income * 0.6))).toBe(true);
    useWorldLog(once.world);
    for (let t = opened + 900; t <= s.clock; t += 900) {
      once.clock = t;
      settleFleet(once);
    }
    once.clock = s.clock;
    settleFleet(once);
    expect(once.world.outposts).toEqual(s.world.outposts);
    // A raid in its system cuts that hour's income.
    for (let t = 0; t < 400 * 3_600; t += 1_800) {
      if (systemEventAt(SYSTEM, t)?.kind !== 'raid') continue;
      expect(incomeAt(s.world.outposts![0]!, t)).toBe(Math.round(OUTPOSTS.stages[0]!.income * 0.6));
      break;
    }
  });

  it('is a dock the player’s captains can be hired to, once it trades', () => {
    const s = chartered();
    const id = outpostId(PLANET);
    expect(haulDestinations(s, DOCK)).not.toContain(id);
    build(s, 1);
    dockAt(s, id);
    s.location.dockedAt = DOCK;
    expect(haulDestinations(s, DOCK)).toContain(id);
  });
});

describe('saves', () => {
  it('keep the outpost, docked there or not, and refuse a damaged one', () => {
    const s = chartered();
    build(s, 1);
    expect(s.location.dockedAt).toBe(outpostId(PLANET));
    assertValidState(s);
    const bad = (patch: (x: GameState) => void) => {
      const x = structuredClone(s);
      patch(x);
      return () => assertValidState(x);
    };
    expect(bad((x) => (x.world.outposts![0]!.site = 'proxima-cen-b'))).toThrow(/outpost/);
    expect(bad((x) => (x.world.outposts![0]!.kind = 'military-base'))).toThrow(/outpost/);
    expect(bad((x) => (x.world.outposts![0]!.stage = 9))).toThrow(/outpost/);
    expect(bad((x) => (x.world.outposts![0]!.delivered = { stims: -1 } as never))).toThrow(/outpost/);
    // Docked at an outpost the save does not have.
    expect(bad((x) => delete x.world.outposts)).toThrow(/unknown dock/);
    // A save without an outpost is as it was.
    assertValidState(pilotAt(DOCK));
  });
});

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
