import type { Cargo, CommodityId } from '../app/state.ts';
import { COMMODITIES } from '../content/economy/goods.ts';
import { beltGoods, COMPOSITION, MINED_GOODS, MINING, securityBand, type BeltKind, type MinedGood } from '../content/mining/rules.ts';
import { rng } from '../content/random.ts';
import { jumpsFrom } from '../content/world/network.ts';
import { WORLD_SEED } from '../content/world/rules.ts';
import { getLocation, WORLD } from '../data/systems.ts';
import type { BeltRecord, SystemId } from '../data/types.ts';
import { addCargo, itemsThatFit } from './cargo.ts';
import { expectedTrip, routeFeeBetween } from './contracts.ts';
import { marketTables, orderTotal } from './markets.ts';

/**
 * Mining in the real belts (docs/PROCGEN.md §19): the rocks, what the beam cuts from them, where the
 * cut goes, the raiders who hunt miners and what a pilot earns. Pure functions of the rules, the
 * belt records, the game clock and the markets: nothing runs in the background and nothing is saved
 * but what the player carries.
 */

/** Shares of each good in a rock (they add up to one). */
export type Composition = Partial<Record<MinedGood, number>>;

/** A minable rock: where it sits in its stretch of belt, how big it is and, this time round, what it holds. */
export interface RockSpec {
  /** `<ring>.<sector>.<index>`: the same rock every time the player comes by. */
  id: string;
  /** The belt record it belongs to (the citation). */
  beltId: string;
  sector: number;
  index: number;
  /** Place in its stretch: `u` 0–1 along the ring, `radial` and `height` −1–1 across it. */
  u: number;
  radial: number;
  height: number;
  /** Radius in metres. */
  radius: number;
  /** Which growth of the rock this is: a spent rock comes back as the next one. */
  generation: number;
  /** Rock units it holds when whole. */
  amount: number;
  composition: Composition;
}

export { beltGoods };

/** A rock's shares for its kind of belt, drawn from the rules' ranges and scaled to add up to one. */
export function composition(kind: BeltKind, draw: () => number): Composition {
  const ranges = COMPOSITION[kind];
  const weights = MINED_GOODS.flatMap((g) => {
    const r = ranges[g];
    return r ? [[g, r[0] + draw() * (r[1] - r[0])] as const] : [];
  });
  const total = weights.reduce((s, [, w]) => s + w, 0);
  const out: Composition = {};
  for (const [g, w] of weights) out[g] = w / total;
  return out;
}

/**
 * Rock `index` of stretch `sector` of a ring (`ringId`, one of the belt's rings in flight). Where it
 * sits never changes; what it holds is drawn afresh for each generation, and each rock's generations
 * turn over at their own time on the game clock.
 */
export function rockSpec(ringId: string, belt: Pick<BeltRecord, 'id' | 'kind'>, sector: number, index: number, clock: number): RockSpec {
  const r = MINING.rocks;
  const place = rng(WORLD_SEED, 'rock', ringId, sector, index);
  const u = (index + 0.15 + place.next() * 0.7) / r.perSector;
  const radial = (place.next() * 2 - 1) * r.spread.radial;
  const height = (place.next() * 2 - 1) * r.spread.height;
  const radius = Math.round(place.range(r.radius[0], r.radius[1]));
  const phase = place.next() * r.regrowSeconds;
  const generation = Math.floor((Math.max(0, clock) + phase) / r.regrowSeconds);
  const grown = rng(WORLD_SEED, 'rock-yield', ringId, sector, index, generation);
  return {
    id: `${ringId}.${sector}.${index}`,
    beltId: belt.id,
    sector,
    index,
    u,
    radial,
    height,
    radius,
    generation,
    amount: grown.int(r.amount[0], r.amount[1]),
    composition: composition(belt.kind, grown.next),
  };
}

/** The rocks of one stretch of a ring. */
export function rocksInSector(ringId: string, belt: Pick<BeltRecord, 'id' | 'kind'>, sector: number, clock: number): RockSpec[] {
  return Array.from({ length: MINING.rocks.perSector }, (_, i) => rockSpec(ringId, belt, sector, i, clock));
}

/** Stretches a ring is cut into (about `sectorArc` metres of its middle circle each). */
export function sectorCount(midRadius: number): number {
  return Math.max(8, Math.round((2 * Math.PI * midRadius) / MINING.rocks.sectorArc));
}

/** What is left of a rock being cut: rock units, and the part of a unit of each good already cut. */
export interface RockLeft {
  left: number;
  acc: Partial<Record<MinedGood, number>>;
}

/**
 * Runs the beam on a rock for `seconds`: it cuts `ratePerMinute` units of rock a minute (the mining
 * lasers' rate) until the rock is spent, and each unit of rock gives `prospect` units of goods (a
 * prospecting scanner reads the seams) in the rock's shares. Returns the whole units cut, in order.
 */
export function cutRock(rock: RockLeft, comp: Composition, seconds: number, ratePerMinute: number, prospect = 1): MinedGood[] {
  if (rock.left <= 0 || seconds <= 0 || ratePerMinute <= 0) return [];
  const cut = Math.min(rock.left, (ratePerMinute * seconds) / 60);
  rock.left = Math.max(0, rock.left - cut);
  const out: MinedGood[] = [];
  for (const g of MINED_GOODS) {
    const share = comp[g];
    if (!share) continue;
    let acc = (rock.acc[g] ?? 0) + cut * share * Math.max(1, prospect);
    while (acc >= 1 - 1e-9) {
      out.push(g);
      acc -= 1;
    }
    rock.acc[g] = Math.max(0, acc);
  }
  return out;
}

/** Where a unit just cut goes: into the hold when it fits, otherwise out in a cargo pod. */
export function stowUnit(cargo: Cargo, capacity: number, good: CommodityId): 'hold' | 'pod' {
  if (itemsThatFit(cargo, good, capacity) < 1) return 'pod';
  addCargo(cargo, good, 1, capacity);
  return 'hold';
}

/** Raiders who hunt miners: the chance a pack comes at each check, its threat and its size. */
export function minerHunt(security: number, packLevel: 1 | 2 | 3 | null): { chance: number; level: 1 | 2 | 3; size: readonly [number, number] } {
  const band = securityBand(security);
  const h = MINING.hunt;
  return { chance: h.chance[band], level: packLevel ?? h.level[band], size: h.size };
}

/** The security of a system (1 where nobody keeps records). */
export function securityOf(systemId: SystemId): number {
  return WORLD.profiles.get(systemId)?.security ?? 1;
}

// ---------------------------------------------------------------- what a miner earns

/** What a ship brings to mining: its hold, the lasers' rate and the prospecting scanner. */
export interface MiningRig {
  cargo: number;
  miningRate: number;
  prospect: number;
}

export interface MiningEstimate {
  commodity: MinedGood;
  /** The station that buys it, and how many jumps away. */
  buyer: string;
  jumps: number;
  /** Items in a full hold, and what they fetch there (after the jump fees both ways). */
  items: number;
  revenue: number;
  /** Seconds for one round: cutting a full hold, flying to the buyer and back. */
  seconds: number;
  perHour: number;
}

const NEUTRAL = { sta: 0, frontier: 0, 'hollow-wake': 0 };

/**
 * Credits an hour from mining one of a belt's goods and selling it at a station within `maxJumps`,
 * as if every rock were that good alone (an upper bound: real rocks are mixed). One round: cut a
 * full hold, fly to the buyer (the contracts' trip estimate plus the flight out to the rocks), sell
 * through the market (each unit priced at the stock it leaves, from normal stock) and fly back.
 */
export function miningEstimates(belt: Pick<BeltRecord, 'systemId' | 'kind'>, rig: MiningRig, maxJumps = 3): MiningEstimate[] {
  if (rig.miningRate <= 0) return [];
  const jumps = jumpsFrom(WORLD.links, belt.systemId);
  const out: MiningEstimate[] = [];
  for (const g of beltGoods(belt.kind)) {
    const items = Math.floor(rig.cargo / COMMODITIES[g].unitSize);
    if (items <= 0) continue;
    const cutting = (items / (rig.miningRate * Math.max(1, rig.prospect))) * 60;
    for (const [id, market] of marketTables()) {
      const entry = market.entries.get(g);
      if (!entry || entry.role === 'produce' || getLocation(id).stationType === 'pirate-den') continue;
      const j = jumps.get(market.systemId);
      if (j === undefined || j > maxJumps) continue;
      const trip = expectedTrip(belt.systemId, market.systemId);
      if (!Number.isFinite(trip)) continue;
      const fees = 2 * routeFeeBetween(belt.systemId, market.systemId);
      const takings = orderTotal(id, g, items, 'sell', NEUTRAL, { clock: 0, markets: {} }) ?? 0;
      const seconds = cutting + 2 * (trip + MINING.income.transit);
      const revenue = takings - fees;
      out.push({ commodity: g, buyer: id, jumps: j, items, revenue, seconds, perHour: Math.round((revenue / seconds) * 3600) });
    }
  }
  return out.sort((a, b) => b.perHour - a.perHour);
}

/** The best a miner can do in a belt with this rig (credits an hour; 0 when nothing pays). */
export function bestMiningIncome(belt: Pick<BeltRecord, 'systemId' | 'kind'>, rig: MiningRig, maxJumps = 3): number {
  return Math.max(0, miningEstimates(belt, rig, maxJumps)[0]?.perHour ?? 0);
}
