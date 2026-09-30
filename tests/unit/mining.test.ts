import * as THREE from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import type { AudioEngine } from '../../src/audio/AudioEngine.ts';
import { defaultSettings } from '../../src/app/settings.ts';
import { createNewGame, type GameState } from '../../src/app/state.ts';
import { CONTRACTS } from '../../src/content/contracts/rules.ts';
import { COMMODITIES } from '../../src/content/economy/goods.ts';
import { beltGoods, COMPOSITION, MINING } from '../../src/content/mining/rules.ts';
import { jumpsFrom } from '../../src/content/world/network.ts';
import { ALL_LOCATIONS, BELTS, beltsOf, componentsOf, findBelt, getBelt, getLocation, getSystem, SYSTEMS, WORLD } from '../../src/data/systems.ts';
import type { SystemId } from '../../src/data/types.ts';
import { addCargo, cargoUsed } from '../../src/economy/cargo.ts';
import { contractIssues } from '../../src/economy/contractGuards.ts';
import { boardFor, postsClaims } from '../../src/economy/contracts.ts';
import { acceptJob, countMined, currentObjective, deliverJob, describeObjective, type JobDef } from '../../src/economy/jobs.ts';
import { cargoCapacity, newShipState, performanceOf } from '../../src/economy/loadout.ts';
import { allQuotes, marketTables } from '../../src/economy/markets.ts';
import { bestMiningIncome, cutRock, miningEstimates, minerHunt, rockSpec, rocksInSector, stowUnit } from '../../src/economy/mining.ts';
import { liveQuote, sellCommodity } from '../../src/economy/trade.ts';
import { tradeRoutes } from '../../src/economy/tradeComputer.ts';
import { PRICE_BAND } from '../../src/content/economy/goods.ts';
import { emptyInput, type FlightAction } from '../../src/flight/input/types.ts';
import { FlightSession, type FlightCallbacks, type TrafficSetup } from '../../src/world/FlightSession.ts';
import type { MiningLedger } from '../../src/world/MiningField.ts';
import { SystemScene } from '../../src/world/SystemScene.ts';
import { sceneDefFor } from '../../src/world/systems/index.ts';
import type { TrafficPlan } from '../../src/world/traffic/plan.ts';

/**
 * Mining in the real belts (docs/PROCGEN.md §19): belts only where a cited source reports one, rocks
 * and what they yield, the mining laser and the prospecting scanner, the hold then pods, prices in
 * their bands, what a miner earns against a hauler, claim contracts and the raiders who hunt miners.
 */

/** A game date for Sol's real-date layout (2026). */
const JD = 2_461_000;

describe('belts in the real sky (the citation guardrail)', () => {
  it('every belt record belongs to a system of the game, circles one of its stars and cites a source', () => {
    expect(BELTS.length).toBeGreaterThanOrEqual(9);
    for (const b of BELTS) {
      const system = getSystem(b.systemId);
      const stars = b.systemId === 'sol' ? ['sun'] : [...system.componentIds, ...componentsOf(b.systemId).map((c) => c.id)];
      expect(stars, b.id).toContain(b.hostId);
      expect(b.sources.length, b.id).toBeGreaterThan(0);
      for (const s of b.sources) expect(s.url, b.id).toMatch(/^https:\/\//);
      expect(b.name.trim() && b.note.trim(), b.id).toBeTruthy();
      // Extents only where the source gives them: the Solar System's, from NASA.
      if (b.innerAu !== undefined || b.outerAu !== undefined) expect(b.systemId).toBe('sol');
    }
    expect(BELTS.map((b) => b.id)).toEqual(expect.arrayContaining(['sol-main-belt', 'sol-kuiper-belt', 'epsilon-eridani-debris-disc', 'alpha-centauri-debris-disc', 'tau-ceti-debris-disc']));
  });

  it('draws rings only for belt records, and every belt record in its own system', () => {
    let rings = 0;
    for (const s of SYSTEMS) {
      const def = sceneDefFor(s.id, s.id === 'sol' ? JD : null);
      for (const ring of def.belts) {
        rings++;
        const belt = findBelt(ring.beltId);
        expect(belt, `${s.id}: ${ring.id}`).toBeDefined();
        expect(belt!.systemId, ring.id).toBe(s.id);
        expect(ring.outerRadius).toBeGreaterThan(ring.innerRadius);
      }
      const drawn = new Set(def.belts.map((r) => r.beltId));
      for (const b of beltsOf(s.id)) expect(drawn.has(b.id), `${b.id} is not drawn`).toBe(true);
      // No belt without a citation: systems without a record have no rings.
      if (!beltsOf(s.id).length) expect(def.belts, s.id).toEqual([]);
    }
    expect(rings).toBeGreaterThanOrEqual(BELTS.length);
  });

  it('puts Sol’s main belt between Mars and Jupiter and the Kuiper Belt beyond Neptune, on any date', () => {
    for (const jd of [null, JD, 2_451_545]) {
      const def = sceneDefFor('sol', jd);
      const orbit = (id: string) => def.planets.find((p) => p.id === id)!.position.length();
      const main = def.belts.find((b) => b.beltId === 'sol-main-belt')!;
      const kuiper = def.belts.find((b) => b.beltId === 'sol-kuiper-belt')!;
      expect(main.innerRadius).toBeGreaterThan(orbit('mars') + 900);
      expect(main.outerRadius).toBeLessThan(orbit('jupiter') - 5_200);
      expect(kuiper.innerRadius).toBeGreaterThan(orbit('neptune') + 2_300);
      // Stations and the arrival point stay clear of the rocks.
      for (const p of [...def.stations.map((st) => st.position), def.arrival.position]) {
        const r = Math.hypot(p.x, p.z);
        expect(r < main.innerRadius || r > main.outerRadius).toBe(true);
      }
    }
  });

  it('keeps stations and arrival points out of the rings (the Eridani Mining Hub sits in its belt by design)', () => {
    for (const b of BELTS.filter((x) => x.systemId !== 'epsilon-eridani')) {
      const def = sceneDefFor(b.systemId, b.systemId === 'sol' ? JD : null);
      for (const ring of def.belts.filter((r) => r.beltId === b.id)) {
        const radial = (p: { x: number; z: number }) => Math.hypot(p.x - ring.center.x, p.z - ring.center.z);
        for (const p of [...def.stations.map((st) => st.position), def.arrival.position]) {
          const r = radial(p);
          expect(r < ring.innerRadius - 500 || r > ring.outerRadius + 500, `${ring.id}: ${Math.round(r)}`).toBe(true);
        }
      }
    }
  });
});

// ---------------------------------------------------------------- rocks, yields and the beam

const MAIN = getBelt('sol-main-belt');
const KUIPER = getBelt('sol-kuiper-belt');
const ERIDANI = getBelt('epsilon-eridani-debris-disc');

describe('rocks and what they yield', () => {
  it('are the same rocks whenever the player comes by, with shares by kind of belt', () => {
    const a = rocksInSector('sol-main-belt', MAIN, 12, 100);
    expect(rocksInSector('sol-main-belt', MAIN, 12, 100)).toEqual(a);
    expect(a).toHaveLength(MINING.rocks.perSector);
    expect(rocksInSector('sol-main-belt', MAIN, 13, 100)).not.toEqual(a);
    for (const belt of [MAIN, KUIPER, ERIDANI]) {
      for (let s = 0; s < 40; s++) {
        for (const r of rocksInSector(`${belt.id}-ring`, belt, s, 0)) {
          expect(Object.values(r.composition).reduce((x, y) => x + y, 0)).toBeCloseTo(1, 9);
          expect(Object.keys(r.composition).sort()).toEqual(Object.keys(COMPOSITION[belt.kind]).sort());
          expect(r.radius).toBeGreaterThanOrEqual(MINING.rocks.radius[0]);
          expect(r.radius).toBeLessThanOrEqual(MINING.rocks.radius[1]);
          expect(r.amount).toBeGreaterThanOrEqual(MINING.rocks.amount[0]);
          expect(r.amount).toBeLessThanOrEqual(MINING.rocks.amount[1]);
          // Main belt: mostly ore, some water. Kuiper: mostly water ice, with volatiles. Discs: mixed.
          if (belt.kind === 'asteroid-belt') expect(r.composition.ore!).toBeGreaterThanOrEqual(0.55);
          if (belt.kind === 'kuiper-belt') expect(r.composition.water!).toBeGreaterThanOrEqual(0.5);
          if (belt.kind === 'debris-disc') expect(Object.keys(r.composition)).toHaveLength(3);
        }
      }
    }
  });

  it('come back after they are spent: a new growth on the game clock, in the same place', () => {
    const now = rockSpec('sol-main-belt', MAIN, 5, 2, 1_000);
    const later = rockSpec('sol-main-belt', MAIN, 5, 2, 1_000 + MINING.rocks.regrowSeconds);
    expect(later.generation).toBe(now.generation + 1);
    expect({ u: later.u, radial: later.radial, height: later.height, radius: later.radius }).toEqual({ u: now.u, radial: now.radial, height: now.height, radius: now.radius });
    // Rocks do not all turn over at once.
    const turned = rocksInSector('sol-main-belt', MAIN, 5, 1_000).map((r) => rockSpec('sol-main-belt', MAIN, 5, r.index, 1_000 + MINING.rocks.regrowSeconds / 2).generation - r.generation);
    expect(new Set(turned).size).toBeGreaterThan(1);
  });

  it('cut at the lasers’ rate, in the rock’s shares, the same in one step or many', () => {
    const comp = { ore: 0.7, water: 0.3 };
    const one = { left: 100, acc: {} };
    const units = cutRock(one, comp, 60, 6);
    expect(100 - one.left).toBeCloseTo(6, 9);
    expect(units.filter((g) => g === 'ore')).toHaveLength(4);
    expect(units.filter((g) => g === 'water')).toHaveLength(1);
    const many = { left: 100, acc: {} };
    const stepped: string[] = [];
    for (let t = 0; t < 600; t++) stepped.push(...cutRock(many, comp, 0.1, 6));
    expect(many.left).toBeCloseTo(one.left, 6);
    expect(stepped.filter((g) => g === 'ore')).toHaveLength(4);
    expect(stepped.filter((g) => g === 'water')).toHaveLength(1);
    // Rate is units of rock a minute: a class 3 laser cuts 10.
    const fast = { left: 100, acc: {} };
    cutRock(fast, comp, 60, 10);
    expect(100 - fast.left).toBeCloseTo(10, 9);
  });

  it('give more to a prospecting scanner: each unit of rock yields its multiplier in goods', () => {
    const comp = { ore: 0.7, water: 0.3 };
    const plain = { left: 1_000, acc: {} };
    const read = { left: 1_000, acc: {} };
    const a = cutRock(plain, comp, 600, 6).length;
    const b = cutRock(read, comp, 600, 6, 1.2).length;
    // Ten minutes at 6 a minute: 60 units of rock, 42 ore and 18 water; ×1.2: 50 ore and 21 water.
    expect(plain.left).toBe(read.left);
    expect(a).toBe(60);
    expect(b).toBe(71);
  });

  it('are spent after their amount: nothing more comes off, and the total is the amount in shares', () => {
    const rock = { left: 20, acc: {} };
    const comp = { water: 0.6, gases: 0.4 };
    const out: string[] = [];
    for (let t = 0; t < 400; t++) out.push(...cutRock(rock, comp, 1, 6));
    expect(rock.left).toBe(0);
    expect(out.filter((g) => g === 'water')).toHaveLength(12);
    expect(out.filter((g) => g === 'gases')).toHaveLength(8);
    expect(cutRock(rock, comp, 60, 6)).toEqual([]);
  });

  it('go into the hold while there is room, then out in pods', () => {
    const cargo = {};
    const where = Array.from({ length: 9 }, () => stowUnit(cargo, 20, 'ore'));
    // Ore takes 3 hold units: six fit in a 20-unit hold.
    expect(where.filter((w) => w === 'hold')).toHaveLength(6);
    expect(where.slice(6)).toEqual(['pod', 'pod', 'pod']);
    expect(cargoUsed(cargo)).toBe(18);
    // Volatiles take 2: one more fits in the last two units.
    expect(stowUnit(cargo, 20, 'gases')).toBe('hold');
    expect(stowUnit(cargo, 20, 'gases')).toBe('pod');
  });
});

describe('raiders who hunt miners', () => {
  it('come often to lawless belts, sometimes to thinly patrolled ones, rarely to patrolled ones', () => {
    const lawless = minerHunt(0.1, null);
    const thin = minerHunt(0.5, null);
    const patrolled = minerHunt(1, null);
    expect(lawless.chance).toBeGreaterThan(thin.chance);
    expect(thin.chance).toBeGreaterThan(patrolled.chance);
    expect(patrolled.chance).toBeLessThanOrEqual(0.02);
    // Over ten minutes of beam: a patrolled belt rarely sends anyone, a lawless one nearly always.
    const tenMinutes = (c: number) => 1 - (1 - c) ** ((10 * 60) / MINING.hunt.every);
    expect(tenMinutes(patrolled.chance)).toBeLessThan(0.25);
    expect(tenMinutes(lawless.chance)).toBeGreaterThan(0.9);
    // The system's own packs set the threat when it has any; a hunting pack is small.
    expect(minerHunt(0.1, 3).level).toBe(3);
    expect(lawless.size[1]).toBeLessThanOrEqual(2);
  });
});

// ---------------------------------------------------------------- the economy's guardrails

describe('mined goods in the markets', () => {
  beforeAll(installCanvasStub);

  it('sell through the normal markets, stock and all, and prices stay inside their bands', () => {
    let checked = 0;
    for (const belt of BELTS) {
      const near = jumpsFrom(WORLD.links, belt.systemId);
      for (const good of beltGoods(belt.kind)) {
        const lo = Math.ceil(COMMODITIES[good].basePrice * PRICE_BAND[0]);
        const hi = Math.floor(COMMODITIES[good].basePrice * PRICE_BAND[1]);
        const buyers = [...marketTables().values()].filter((m) => (near.get(m.systemId) ?? 99) <= 1 && m.entries.get(good) && m.entries.get(good)!.role !== 'produce' && getLocation(m.locationId).stationType !== 'pirate-den');
        for (const m of buyers.slice(0, 3)) {
          // A miner who never stops: load after load into one dock.
          const state = createNewGame(5);
          state.location = { ...state.location, systemId: m.systemId, dockedAt: m.locationId };
          const before = liveQuote(state, m.locationId, good).sell!;
          for (let load = 0; load < 30; load++) {
            state.ship.cargo = { [good]: 20 };
            const r = sellCommodity(state, m.locationId, good, 20);
            expect(r.ok).toBe(true);
            if (r.ok) {
              expect(r.unitPrice).toBeGreaterThanOrEqual(lo);
              expect(r.unitPrice).toBeLessThanOrEqual(hi);
            }
            const q = liveQuote(state, m.locationId, good).sell!;
            expect(q).toBeGreaterThanOrEqual(lo);
            expect(q).toBeLessThanOrEqual(hi);
            state.clock += 60;
          }
          // The dock felt it: stock recorded through the market, and a lower price.
          expect(state.markets[m.locationId]?.stock[good]).toBeGreaterThan(m.entries.get(good)!.target);
          expect(liveQuote(state, m.locationId, good).sell!).toBeLessThan(before);
          checked++;
        }
      }
    }
    expect(checked).toBeGreaterThan(10);
  });

  it('come from the hold, never from thin air: mining leaves the markets alone', () => {
    const f = flightIn('sol', withLaser());
    f.atRock('belt:sol-main-belt');
    f.run(0.1, ['mine']);
    f.run(60);
    expect(held(f.state)).toBeGreaterThan(0);
    expect(f.state.markets).toEqual({});
  });
});

/** What hauling pays a ship: the trade computer's routes between every market within three jumps of `around`, per hour. */
function haulingPerHour(model: string, around: SystemId): number[] {
  const state = createNewGame(1);
  state.ship = newShipState(model);
  state.credits = 1_000_000;
  const jumps = jumpsFrom(WORLD.links, around);
  const rep = { sta: 0, frontier: 0, 'hollow-wake': 0 };
  for (const [id, m] of marketTables()) {
    if ((jumps.get(m.systemId) ?? 99) <= 3 && getLocation(id).stationType !== 'pirate-den') state.knownMarkets[id] = { source: 'visited', observedAt: 0, prices: allQuotes(id, rep) };
  }
  return tradeRoutes(state, null, { limit: 100_000 })
    .map((r) => r.perMinute * 60)
    .sort((a, b) => a - b);
}

const quantile = (sorted: readonly number[], p: number) => sorted[Math.floor(p * (sorted.length - 1))]!;

describe('what a miner earns', () => {
  const rigs: { name: string; model: string; fittings: Record<string, string> }[] = [
    { name: 'the starter courier with a class 1 laser', model: 'ship.courier.1.halden', fittings: { 'utility-1': LASER } },
    { name: 'a class 1 freighter with a class 1 laser and prospector', model: 'ship.freighter.1.eridani', fittings: { 'utility-1': LASER, 'utility-2': PROSPECTOR } },
  ];

  it('is in the range of a modest trade route with a class 1 laser, and never above the best hauling route', { timeout: 60_000 }, () => {
    for (const rig of rigs) {
      const ship = { ...newShipState(rig.model), fittings: { ...newShipState(rig.model).fittings, ...rig.fittings } };
      const perf = performanceOf(ship);
      expect(perf.miningRate).toBe(6);
      const hauling = haulingPerHour(rig.model, 'sol');
      const best = hauling.at(-1)!;
      const incomes = BELTS.map((b) => ({ belt: b, perHour: bestMiningIncome(b, perf) }));
      // Never above the best hauling route, anywhere.
      for (const { belt, perHour } of incomes) expect(perHour, `${rig.name} in ${belt.id}`).toBeLessThan(best);
      // A modest trade route: the typical belt of the core pays within the middle half of the routes a hauler flies.
      const core = incomes.filter(({ belt }) => ['sol', 'alpha-centauri', 'epsilon-eridani', 'tau-ceti'].includes(belt.systemId)).map((x) => x.perHour).sort((a, b) => a - b);
      const typical = quantile(core, 0.5);
      expect(typical, rig.name).toBeGreaterThanOrEqual(quantile(hauling, 0.25));
      expect(typical, rig.name).toBeLessThanOrEqual(quantile(hauling, 0.75));
      // Mining pays something in every core belt.
      for (const x of core) expect(x).toBeGreaterThan(0);
    }
  });

  it('stays below the best hauling route near each belt, even with two class 3 lasers', { timeout: 60_000 }, () => {
    const model = 'ship.freighter.1.eridani';
    const perf = performanceOf({ model, fittings: { ...newShipState(model).fittings, 'utility-1': 'gear.mining-laser.3.eridani', 'utility-2': 'gear.mining-laser.3.eridani' } });
    expect(perf.miningRate).toBe(20);
    const bestNearSol = haulingPerHour(model, 'sol').at(-1)!;
    for (const belt of BELTS) {
      const mining = bestMiningIncome(belt, perf);
      expect(mining, belt.id).toBeLessThan(bestNearSol);
      if (belt.systemId === 'tau-ceti' || belt.systemId === 'epsilon-eridani') expect(mining, belt.id).toBeLessThan(haulingPerHour(model, belt.systemId).at(-1)!);
    }
    // The estimate is a round of cutting a full hold, flying to the buyer and back.
    const est = miningEstimates(getBelt('tau-ceti-debris-disc'), perf)[0]!;
    expect(est.buyer).toBe('larkspur-stillworks');
    expect(est.seconds).toBeGreaterThan(est.items / (perf.miningRate / 60));
  });
});

// ---------------------------------------------------------------- claim contracts

const EPOCHS = 40;
let claimCache: { job: JobDef; epoch: number }[] | null = null;
/** Every claim posted over forty time slots. */
function allClaims(): { job: JobDef; epoch: number }[] {
  claimCache ??= ALL_LOCATIONS.filter((l) => postsClaims(l)).flatMap((l) =>
    Array.from({ length: EPOCHS }, (_, epoch) => boardFor(l.id, epoch).filter((c) => c.contract?.kind === 'claim').map((job) => ({ job, epoch }))).flat(),
  );
  return claimCache;
}

describe('mining claims', () => {
  it('are posted by mining outposts, refineries and the Eridani Mining Hub within three jumps of a cited belt, and pass the guardrails', () => {
    const claims = allClaims();
    expect(claims.length).toBeGreaterThan(100);
    expect(new Set(claims.map(({ job }) => (job.objectives[0] as { beltId: string }).beltId)).size).toBeGreaterThanOrEqual(5);
    for (const { job, epoch } of claims) {
      const giver = getLocation(job.giverLocationId);
      expect(giver.stationType === 'mining-outpost' || giver.stationType === 'refinery' || giver.id === 'eridani-hub', giver.id).toBe(true);
      expect(contractIssues(job, epoch * CONTRACTS.epochSeconds), job.id).toEqual([]);
      const [mine, deliver] = job.objectives;
      if (mine?.kind !== 'mine' || deliver?.kind !== 'deliver') throw new Error(`${job.id}: a claim mines, then delivers`);
      const belt = getBelt(mine.beltId);
      expect(belt.sources.length).toBeGreaterThan(0);
      expect(beltGoods(belt.kind)).toContain(mine.commodity);
      expect(jumpsFrom(WORLD.links, giver.systemId).get(belt.systemId)).toBeLessThanOrEqual(CONTRACTS.maxJumps.claim);
      expect(mine.text).toBe(`Mine ${mine.qty} ${COMMODITIES[mine.commodity].name.toLowerCase()} in the ${belt.name} (${getSystem(belt.systemId).displayName})`);
      expect(deliver).toMatchObject({ commodity: mine.commodity, qty: mine.qty, locationId: giver.id });
      // The load fits a young pilot's hold, and the claim pays more than any market would for it.
      expect(mine.qty * COMMODITIES[mine.commodity].unitSize).toBeLessThanOrEqual(18);
      expect(job.reward).toBeGreaterThan(mine.qty * COMMODITIES[mine.commodity].basePrice * 2.2);
    }
    // Nobody else posts them.
    for (const l of ALL_LOCATIONS.filter((x) => !postsClaims(x)).slice(0, 60)) {
      for (let epoch = 0; epoch < 10; epoch++) expect(boardFor(l.id, epoch).some((c) => c.contract?.kind === 'claim')).toBe(false);
    }
  });

  it('count what the laser cuts in their belt, point the map and the flight at it, and pay on delivery', () => {
    const { job, epoch } = allClaims().find(({ job }) => job.difficulty === 1 && (job.objectives[0] as { beltId: string }).beltId === 'sol-main-belt')!;
    const mine = job.objectives[0] as Extract<JobDef['objectives'][number], { kind: 'mine' }>;
    const giver = getLocation(job.giverLocationId);
    const state = createNewGame(3);
    state.clock = epoch * CONTRACTS.epochSeconds;
    state.location = { ...state.location, systemId: giver.systemId, dockedAt: giver.id };
    expect(acceptJob(state, job.id)).toMatchObject({ ok: true });
    // Elsewhere, the objective names the belt's system (the star map marks it).
    const away = describeObjective(state, job.id)!;
    expect(away.targetSystemId).toBe('sol');
    if (giver.systemId !== 'sol') expect(away.text).toMatch(/^Jump to Sol/);
    // In Sol, it points the flight at the belt.
    state.location = { ...state.location, systemId: 'sol', dockedAt: null };
    expect(describeObjective(state, job.id)).toMatchObject({ targetSystemId: 'sol', targetId: 'belt:sol-main-belt' });
    // Only that belt and that good count.
    const other = beltGoods(MAIN.kind).find((g) => g !== mine.commodity)!;
    expect(countMined(state, 'sol-kuiper-belt', mine.commodity)).toEqual([]);
    expect(countMined(state, 'sol-main-belt', other)).toEqual([]);
    expect(state.jobs[job.id]!.mined).toBeUndefined();
    for (let i = 1; i < mine.qty; i++) expect(countMined(state, 'sol-main-belt', mine.commodity)).toEqual([]);
    expect(describeObjective(state, job.id)!.text).toBe(`${mine.text}: ${mine.qty - 1} of ${mine.qty} cut (select a rock and mine it)`);
    const done = countMined(state, 'sol-main-belt', mine.commodity);
    expect(done).toMatchObject([{ jobId: job.id, kind: 'objective', text: mine.text }]);
    expect(currentObjective(state, job.id)?.kind).toBe('deliver');
    // Bring the load in.
    state.location = { ...state.location, systemId: giver.systemId, dockedAt: giver.id };
    addCargo(state.ship.cargo, mine.commodity, mine.qty, cargoCapacity(state.ship));
    const credits = state.credits;
    expect(deliverJob(state, job.id, giver.id)).toMatchObject({ ok: true, reward: job.reward });
    expect(state.credits).toBe(credits + job.reward);
    expect(state.ship.cargo[mine.commodity]).toBeUndefined();
    expect(state.jobs[job.id]!.status).toBe('complete');
  });
});

// ---------------------------------------------------------------- in flight

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

const QUIET: TrafficPlan = { traders: 0, traderInterval: [60, 60], patrolWings: 0, wingSize: 2, packs: null };
const LASER = 'gear.mining-laser.1.eridani';
const PROSPECTOR = 'gear.prospector.1.eridani';

function flightIn(systemId: SystemId, setup: (s: GameState) => void = () => {}, ledger?: MiningLedger, clock = 0) {
  const scene = new SystemScene(sceneDefFor(systemId), { quality: 'low', reducedMotion: true });
  const state = createNewGame(11);
  state.location = { systemId, dockedAt: null, flight: null, lastDockId: state.location.lastDockId };
  state.clock = clock;
  setup(state);
  const log: string[] = [];
  const mined: [string, string, string][] = [];
  const scans: string[] = [];
  const noop = () => {};
  const callbacks: FlightCallbacks = {
    onDocked: noop,
    onPlayerDestroyed: noop,
    onDiscovery: noop,
    onScanInfo: (t) => scans.push(t.bodyId ?? t.id),
    onEncounterStart: noop,
    onEncounterEnd: noop,
    onLoot: noop,
    onBounty: noop,
    onContractKill: noop,
    onMined: (belt, good, into) => mined.push([belt, good, into]),
    onMessage: (text) => log.push(text),
  };
  const audio = { play() {}, setCombatIntensity() {}, setEngine() {} } as unknown as AudioEngine;
  const traffic: TrafficSetup = { plan: QUIET, owner: null };
  const flight = new FlightSession({
    system: scene,
    camera: new THREE.PerspectiveCamera(),
    state,
    settings: defaultSettings(),
    ctx: { quality: 'low', reducedMotion: true },
    audio,
    callbacks,
    traffic,
    ...(ledger ? { minedRocks: ledger } : {}),
  });
  flight.start({ kind: 'arrival' });
  const run = (seconds: number, actions: FlightAction[] = [], until?: () => boolean) => {
    for (let t = 0; t < seconds; t += 1 / 20) {
      const input = emptyInput();
      for (const a of actions) input.actions.add(a);
      actions = [];
      state.clock += 1 / 20;
      flight.update(1 / 20, input);
      if (until?.()) return true;
    }
    return false;
  };
  /** Flies into the belt, then parks `distance` metres off its nearest rock, selected. */
  const atRock = (beltTarget: string, distance = 300) => {
    expect(flight.placeNear(beltTarget, 0)).toBe(true);
    run(0.6);
    const rock = flight
      .allTargets()
      .filter((t) => t.kind === 'rock')
      .sort((x, y) => x.position.distanceTo(flight.player.position) - y.position.distanceTo(flight.player.position))[0]!;
    expect(rock).toBeDefined();
    expect(flight.placeNear(rock.id, distance)).toBe(true);
    flight.selectTarget(rock.id);
    run(0.1);
    return rock;
  };
  return { flight, state, log, mined, scans, run, atRock };
}

const withLaser =
  (gear = LASER) =>
  (s: GameState) => {
    s.ship.fittings['utility-1'] = gear;
  };

const held = (s: GameState) => (s.ship.cargo.ore ?? 0) + (s.ship.cargo.water ?? 0);

describe('mining in flight', () => {
  beforeAll(installCanvasStub);

  it('shows each belt as a target, scannable for its sources, and a few rocks near the player in it', () => {
    const f = flightIn('sol', withLaser());
    const belts = f.flight.allTargets().filter((t) => t.kind === 'belt');
    expect(belts.map((t) => t.id).sort()).toEqual(['belt:sol-kuiper-belt', 'belt:sol-main-belt']);
    // No belt record, no belt and no rocks.
    const barnard = flightIn('barnard', withLaser());
    barnard.run(1);
    expect(barnard.flight.allTargets().some((t) => t.kind === 'belt' || t.kind === 'rock')).toBe(false);
    f.atRock('belt:sol-main-belt');
    const rocks = f.flight.allTargets().filter((t) => t.kind === 'rock');
    expect(rocks).toHaveLength(2 * MINING.rocks.perSector);
    expect(rocks[0]!.name).toMatch(/^Rock \d+\.\d+$/);
    f.flight.selectTarget('belt:sol-main-belt');
    f.run(0.1, ['scan']);
    expect(f.scans).toEqual(['sol-main-belt']);
    expect(f.flight.hud.target?.distance).toBe(0);
    // Its distance is to the band of rock: 5 km above the plane is well clear of its 2.4 km thickness.
    f.flight.player.position.y += 5_000;
    f.run(0.1);
    expect(f.flight.hud.target?.distance).toBeGreaterThan(3_000);
    expect(f.flight.hud.target?.distance).toBeLessThan(5_000);
  });

  it('mines the selected rock within 600 m: units into the hold, and the Mine action to stop', () => {
    const f = flightIn('sol', withLaser());
    const rock = f.atRock('belt:sol-main-belt');
    expect(f.flight.contextAction()).toMatchObject({ label: 'Mine', action: 'mine' });
    expect(f.flight.hud.mining).toMatchObject({ rate: 6, prospect: 1, active: false, ready: true });
    f.run(0.1, ['mine']);
    expect(f.flight.contextAction()).toMatchObject({ label: 'Stop mining', action: 'mine' });
    f.run(30);
    // 30 s at 6 a minute: 3 units of rock, whole units in its shares.
    const got = held(f.state);
    expect(got).toBeGreaterThanOrEqual(2);
    expect(got).toBeLessThanOrEqual(3);
    expect(f.mined).toHaveLength(got);
    expect(f.mined.every(([belt, , into]) => belt === 'sol-main-belt' && into === 'hold')).toBe(true);
    expect(f.flight.hud.mining?.status).toMatch(new RegExp(`^Mining ${rock.name.replace('.', '\\.')}`));
    expect(f.flight.debugMining().rocks.find((r) => r.id === rock.id)!.scanned).toBe(true);
    f.run(0.1, ['mine']);
    expect(f.flight.debugMining().beam).toBeNull();
    const after = held(f.state);
    f.run(20);
    expect(held(f.state)).toBe(after);
  });

  it('needs a laser, a rock and the beam’s reach, and stops when the target is lost or out of reach', () => {
    const bare = flightIn('sol');
    bare.atRock('belt:sol-main-belt');
    expect(bare.flight.contextAction()?.action).not.toBe('mine');
    bare.run(0.1, ['mine']);
    expect(bare.log.at(-1)).toMatch(/No mining laser/);
    expect(bare.flight.hud.mining).toBeNull();

    const f = flightIn('sol', withLaser());
    const rock = f.atRock('belt:sol-main-belt', MINING.range + 200);
    // Out of the beam's reach: read it first (a pad scans through the action button), then go to it.
    expect(f.flight.contextAction()).toMatchObject({ label: 'Scan', action: 'scan' });
    f.run(0.1, ['scan']);
    expect(f.flight.contextAction()).toMatchObject({ label: 'Go to', action: 'goto' });
    f.run(0.1, ['mine']);
    expect(f.log.at(-1)).toMatch(/Out of the beam’s reach/);
    f.flight.placeNear(rock.id, 300);
    f.run(0.1, ['mine']);
    expect(f.flight.debugMining().beam).toBe(rock.id);
    // Target lost.
    f.flight.selectTarget('belt:sol-main-belt');
    f.run(0.1);
    expect(f.flight.debugMining().beam).toBeNull();
    expect(f.log.at(-1)).toMatch(/target lost/);
    // Out of reach.
    f.flight.selectTarget(rock.id);
    f.run(0.1, ['mine']);
    expect(f.flight.debugMining().beam).toBe(rock.id);
    f.flight.placeNear(rock.id, MINING.range + 100);
    f.run(0.1);
    expect(f.flight.debugMining().beam).toBeNull();
    expect(f.log.at(-1)).toMatch(/out of the beam’s reach/);
  });

  it('reads a rock with a scan, and cuts more with a prospecting scanner fitted', () => {
    const cut = (gear: string[]) => {
      const f = flightIn('sol', (s) => {
        s.ship.model = 'ship.freighter.1.eridani';
        s.ship.fittings = { 'utility-1': gear[0]!, ...(gear[1] ? { 'utility-2': gear[1] } : {}) };
      });
      const rock = f.atRock('belt:sol-main-belt');
      f.run(0.1, ['scan']);
      expect(f.flight.debugMining().rocks.find((r) => r.id === rock.id)!.scanned).toBe(true);
      expect(f.log.at(-1)).toMatch(/Metal ore \d+% · Water ice \d+%/);
      expect(f.flight.hud.target?.amount).toBe(1);
      f.run(0.1, ['mine']);
      f.run(100);
      return held(f.state);
    };
    const plain = cut([LASER]);
    const read = cut([LASER, PROSPECTOR]);
    expect(plain).toBeGreaterThanOrEqual(8);
    expect(read).toBeGreaterThan(plain);
  });

  it('fills the hold, then releases cargo pods, and stops when the hold and the pods are full', () => {
    const f = flightIn('sol', withLaser());
    f.atRock('belt:sol-main-belt');
    const room = cargoCapacity(f.state.ship);
    f.run(0.1, ['mine']);
    expect(f.run(400, [], () => f.flight.debugMining().beam === null)).toBe(true);
    expect(cargoUsed(f.state.ship.cargo)).toBeGreaterThan(room - 3);
    expect(f.flight.debugMining().pods).toBe(MINING.pods);
    const pods = f.flight.allTargets().filter((t) => t.kind === 'loot');
    expect(pods).toHaveLength(MINING.pods);
    expect(pods.every((p) => p.name === 'Cargo pod')).toBe(true);
    expect(f.mined.filter(([, , into]) => into === 'pod')).toHaveLength(MINING.pods);
    expect(f.log.some((m) => m.startsWith('Hold full'))).toBe(true);
    expect(f.log.at(-1)).toMatch(/the hold is full and 6 pods are adrift/);
    // The pods wait: the tractor does not pull in what the hold cannot take.
    f.run(10);
    expect(f.flight.allTargets().filter((t) => t.kind === 'loot')).toHaveLength(MINING.pods);
  });

  it('spends a rock, which grows back in its own time (the cut is remembered between flights)', () => {
    const ledger: MiningLedger = new Map();
    const rig = (s: GameState) => {
      s.ship.model = 'ship.freighter.1.eridani';
      s.ship.fittings = { 'utility-1': 'gear.mining-laser.3.eridani', 'utility-2': 'gear.mining-laser.3.eridani' };
    };
    const f = flightIn('sol', rig, ledger);
    const rock = f.atRock('belt:sol-main-belt');
    const left = f.flight.debugMining().rocks.find((r) => r.id === rock.id)!.left;
    f.run(0.1, ['mine']);
    // Two class 3 lasers cut 20 units of rock a minute; the hold (and pods) run out first, so empty the hold as it fills.
    const spent = f.run(left * 3 + 30, [], () => {
      f.state.ship.cargo = {};
      return !f.flight.allTargets().some((t) => t.id === rock.id);
    });
    expect(spent).toBe(true);
    expect(f.log.some((m) => m.includes('is spent'))).toBe(true);
    expect([...ledger.values()]).toContain(0);
    // A new flight at the same time: still spent. A growth later: back.
    const again = flightIn('sol', rig, ledger, f.state.clock);
    again.flight.placeNear('belt:sol-main-belt', 0);
    again.run(0.6);
    expect(again.flight.allTargets().some((t) => t.id === rock.id)).toBe(false);
    const later = flightIn('sol', rig, ledger, f.state.clock + MINING.rocks.regrowSeconds);
    later.flight.placeNear('belt:sol-main-belt', 0);
    later.run(0.6);
    expect(later.flight.allTargets().some((t) => t.id === rock.id)).toBe(true);
  });

  it('guides a claim to its belt: the belt is the objective, and Go to flies into it', () => {
    const f = flightIn('sol', withLaser());
    f.flight.setObjective(null, null, 'belt:sol-main-belt');
    f.run(0.1);
    // The new objective is selected, and the action button flies there.
    expect(f.flight.selectedTarget?.id).toBe('belt:sol-main-belt');
    expect(f.flight.contextAction()).toMatchObject({ label: 'Go to', action: 'goto' });
    expect(f.flight.hud.markers.find((m) => m.id === 'belt:sol-main-belt')?.objective).toBe(true);
    f.run(0.1, ['goto']);
    expect(f.run(240, [], () => f.flight.hud.target?.id === 'belt:sol-main-belt' && f.flight.autopilotMode === 'none')).toBe(true);
    expect(f.flight.hud.target?.distance).toBe(0);
    expect(f.flight.allTargets().some((t) => t.kind === 'rock')).toBe(true);
  });

  it('draws raiders to a miner in a lawless belt', () => {
    const chance = MINING.hunt.chance.lawless;
    MINING.hunt.chance.lawless = 1;
    try {
      const f = flightIn('vega', withLaser());
      f.atRock('belt:vega-debris-disc');
      f.run(0.1, ['mine']);
      expect(f.run(MINING.hunt.every + 2, [], () => f.flight.debugMining().minerPack)).toBe(true);
      expect(f.log.some((m) => m.startsWith('Raiders have seen your beam'))).toBe(true);
    } finally {
      MINING.hunt.chance.lawless = chance;
    }
  });
});
