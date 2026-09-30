import type { SystemId } from '../../data/types.ts';
import { rng } from '../random.ts';
import type { StationType } from '../world/types.ts';
import { COMMODITIES, type CommodityId } from './goods.ts';
import { CURATED_MARKETS, ECONOMY, STATION_MARKETS, type MarketProfile, type MarketRole } from './rules.ts';

/**
 * Market tables (docs/PROCGEN.md §8): for every station with a market, what it does with each good
 * it trades and at what equilibrium price and stock. A pure function of the economy rules, the
 * stations and the jump network; the live price then follows stock and drift (economy/markets.ts).
 */

export interface MarketEntry {
  commodity: CommodityId;
  role: MarketRole;
  /** Equilibrium mid price (credits) at normal stock and no drift. */
  mid: number;
  /** Buy/sell spread as a fraction of the mid price. */
  spread: number;
  /** Normal stock the station returns to. */
  target: number;
  /** Price drift: period (seconds of play) and phase (radians). */
  period: number;
  phase: number;
  /** Jumps to the nearest station that makes this good (0 = this system; null = nowhere). */
  jumpsToMaker: number | null;
}

export interface StationMarket {
  locationId: string;
  systemId: SystemId;
  entries: ReadonlyMap<CommodityId, MarketEntry>;
}

export interface MarketStationInput {
  id: string;
  systemId: SystemId;
  /** Generated station type; null for hand-authored stations (they have their own profiles). */
  type: StationType | null;
  /** 0 = small outpost … 1 = large port. */
  size: number;
  security: number;
}

export function profileOf(station: MarketStationInput): MarketProfile | null {
  const curated = CURATED_MARKETS[station.id];
  if (curated) return curated;
  if (!station.type || station.type === 'pirate-den') return null;
  return STATION_MARKETS[station.type];
}

export function buildMarkets(stations: readonly MarketStationInput[], links: ReadonlyMap<SystemId, readonly SystemId[]>, seed: number): Map<string, StationMarket> {
  // Where each good is made, and how many jumps every system is from its nearest maker.
  const makers = new Map<CommodityId, Set<SystemId>>();
  for (const st of stations) {
    for (const c of profileOf(st)?.produce ?? []) makers.set(c, (makers.get(c) ?? new Set()).add(st.systemId));
  }
  const jumpsToMaker = new Map<CommodityId, Map<SystemId, number>>();
  for (const [c, systems] of makers) jumpsToMaker.set(c, multiSourceJumps(links, systems));

  const out = new Map<string, StationMarket>();
  for (const st of stations) {
    const profile = profileOf(st);
    if (!profile) continue;
    const anchors = CURATED_MARKETS[st.id]?.anchors ?? {};
    const entries = new Map<CommodityId, MarketEntry>();
    const roles: [MarketRole, readonly CommodityId[]][] = [
      ['produce', profile.produce],
      ['trade', profile.trade],
      ['consume', profile.consume],
    ];
    for (const [role, list] of roles) {
      for (const c of list) {
        if (entries.has(c)) continue;
        const r = rng(seed, 'market', st.id, c);
        const jumps = jumpsToMaker.get(c)?.get(st.systemId) ?? null;
        const anchor = anchors[c];
        let mid: number;
        let spread: number = ECONOMY.spread[role];
        if (anchor && anchor.buy !== null && anchor.sell !== null) {
          mid = (anchor.buy + anchor.sell) / 2;
          spread = (anchor.buy - anchor.sell) / mid;
        } else if (anchor && anchor.sell !== null) {
          mid = anchor.sell / (1 - spread / 2);
        } else if (anchor && anchor.buy !== null) {
          mid = anchor.buy / (1 + spread / 2);
        } else {
          const base = COMMODITIES[c].basePrice;
          const vary = 1 + ECONOMY.variation * (r.next() * 2 - 1);
          const factor =
            role === 'produce'
              ? ECONOMY.produceFactor
              : role === 'trade'
                ? ECONOMY.tradeFactor + ECONOMY.perJump * Math.min(jumps ?? ECONOMY.maxJumps, ECONOMY.maxJumps) * 0.5
                : (ECONOMY.consumeFactor + ECONOMY.perJump * Math.min(jumps ?? ECONOMY.maxJumps, ECONOMY.maxJumps)) * (1 + ECONOMY.riskPremium * (1 - st.security));
          mid = base * factor * vary;
        }
        const [lo, hi] = ECONOMY.stock[role];
        entries.set(c, {
          commodity: c,
          role,
          mid,
          spread,
          target: Math.round(lo + (hi - lo) * Math.min(1, Math.max(0, st.size))),
          period: Math.round(ECONOMY.drift.period[0] + (ECONOMY.drift.period[1] - ECONOMY.drift.period[0]) * r.next()),
          phase: r.next() * Math.PI * 2,
          jumpsToMaker: jumps,
        });
      }
    }
    out.set(st.id, { locationId: st.id, systemId: st.systemId, entries });
  }
  return out;
}

/** Jumps from the nearest of `sources` to every system (breadth first). */
function multiSourceJumps(links: ReadonlyMap<SystemId, readonly SystemId[]>, sources: ReadonlySet<SystemId>): Map<SystemId, number> {
  const out = new Map<SystemId, number>();
  const queue: SystemId[] = [];
  for (const s of sources) {
    out.set(s, 0);
    queue.push(s);
  }
  while (queue.length) {
    const cur = queue.shift()!;
    for (const next of links.get(cur) ?? []) {
      if (!out.has(next)) {
        out.set(next, out.get(cur)! + 1);
        queue.push(next);
      }
    }
  }
  return out;
}
