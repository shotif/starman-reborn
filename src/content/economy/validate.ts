import type { SystemId } from '../../data/types.ts';
import type { Issue } from '../validate.ts';
import { jumpsFrom } from '../world/network.ts';
import { COMMODITIES, COMMODITY_IDS, PRICE_BAND, type CommodityId } from './goods.ts';
import type { StationMarket } from './markets.ts';
import { CURATED_MARKETS } from './rules.ts';

/**
 * Economy guardrails (docs/PROCGEN.md §8.4), checked on the equilibrium tables: every good is made
 * and wanted somewhere, prices sit well inside their bands, every market offers a route worth
 * flying and none offers an absurd one. The live pricing (stock, drift, standing) is checked by
 * the unit tests over many states.
 */

type Report = (rule: string, subject: string, message: string) => void;

/** A route must beat this margin (sell there ÷ buy here) to count as worth flying. */
export const VIABLE_MARGIN = 1.12;
/** No route at equilibrium may pay more than this (the hand-set opening routes pay about ×2.5). */
export const MAX_MARGIN = 2.8;
/** How far a trader is expected to look for a buyer. */
export const ROUTE_JUMPS = 4;

export interface EquilibriumRoute {
  commodity: CommodityId;
  from: string;
  to: string;
  jumps: number;
  buy: number;
  sell: number;
  margin: number;
}

const buyAt = (m: StationMarket, c: CommodityId) => {
  const e = m.entries.get(c);
  return e && e.role !== 'consume' ? e.mid * (1 + e.spread / 2) : null;
};
const sellAt = (m: StationMarket, c: CommodityId) => {
  const e = m.entries.get(c);
  return e ? e.mid * (1 - e.spread / 2) : null;
};

/** Every buy-here, sell-there pair within `maxJumps` at equilibrium prices, best margin first. */
export function equilibriumRoutes(markets: ReadonlyMap<string, StationMarket>, links: ReadonlyMap<SystemId, readonly SystemId[]>, maxJumps = ROUTE_JUMPS): EquilibriumRoute[] {
  const jumpCache = new Map<SystemId, Map<SystemId, number>>();
  const jumps = (a: SystemId, b: SystemId) => {
    if (!jumpCache.has(a)) jumpCache.set(a, jumpsFrom(links, a));
    return jumpCache.get(a)!.get(b) ?? Infinity;
  };
  const out: EquilibriumRoute[] = [];
  for (const from of markets.values()) {
    for (const c of from.entries.keys()) {
      const buy = buyAt(from, c);
      if (buy === null) continue;
      for (const to of markets.values()) {
        if (to === from) continue;
        const sell = sellAt(to, c);
        const j = jumps(from.systemId, to.systemId);
        if (sell === null || j > maxJumps) continue;
        out.push({ commodity: c, from: from.locationId, to: to.locationId, jumps: j, buy, sell, margin: sell / buy });
      }
    }
  }
  return out.sort((a, b) => b.margin - a.margin);
}

export function validateEconomy(markets: ReadonlyMap<string, StationMarket>, links: ReadonlyMap<SystemId, readonly SystemId[]>, startLocation = 'earth-port'): Issue[] {
  const issues: Issue[] = [];
  const report: Report = (rule, subject, message) => issues.push({ rule, subject, message });

  // Goods themselves.
  for (const c of COMMODITY_IDS) {
    const g = COMMODITIES[c];
    if (!(g.basePrice > 0) || !Number.isInteger(g.unitSize) || g.unitSize < 1 || g.unitSize > 4) report('goods', c, 'price or unit size out of range');
    if (!g.description.trim() || !/^[A-Z][A-Za-z0-9 -]*$/.test(g.name)) report('goods', c, 'needs a plain name and a description');
  }

  // Every good is made somewhere and wanted somewhere.
  for (const c of COMMODITY_IDS) {
    const roles = [...markets.values()].map((m) => m.entries.get(c)?.role);
    if (!roles.includes('produce')) report('coverage', c, 'no station makes it');
    if (!roles.includes('consume')) report('coverage', c, 'no station wants it');
  }

  // Equilibrium prices well inside the bands (stock, drift and standing are clamped to the band live).
  for (const m of markets.values()) {
    for (const e of m.entries.values()) {
      const base = COMMODITIES[e.commodity].basePrice;
      if (e.mid < base * PRICE_BAND[0] || e.mid > base * 2) report('bands', `${m.locationId}/${e.commodity}`, `equilibrium ${e.mid.toFixed(0)} cr is far from base ${base} cr`);
      if (!(e.spread >= 0.04 && e.spread <= 0.3)) report('bands', `${m.locationId}/${e.commodity}`, `spread ${e.spread.toFixed(2)} out of range`);
      if (!(e.target > 0)) report('bands', `${m.locationId}/${e.commodity}`, 'no normal stock');
    }
  }

  // Hand-authored opening prices reproduce exactly.
  for (const [id, cm] of Object.entries(CURATED_MARKETS)) {
    const m = markets.get(id);
    if (!m) {
      report('anchors', id, 'hand-authored market missing');
      continue;
    }
    for (const [c, q] of Object.entries(cm.anchors) as [CommodityId, { buy: number | null; sell: number | null }][]) {
      const b = buyAt(m, c);
      const s = sellAt(m, c);
      if ((q.buy === null) !== (b === null) || (q.buy !== null && Math.round(b!) !== q.buy) || (q.sell !== null && Math.round(s!) !== q.sell)) {
        report('anchors', `${id}/${c}`, `opening quote ${q.buy}/${q.sell} not reproduced`);
      }
    }
  }

  // Trade is worth it everywhere, and nowhere absurd.
  const routes = equilibriumRoutes(markets, links);
  for (const m of markets.values()) {
    const buys = [...m.entries.values()].some((e) => e.role !== 'consume');
    if (buys && !routes.some((r) => r.from === m.locationId && r.margin >= VIABLE_MARGIN)) report('routes', m.locationId, `nothing bought here sells for ${Math.round((VIABLE_MARGIN - 1) * 100)}% more within ${ROUTE_JUMPS} jumps`);
  }
  for (const r of routes) {
    if (r.margin > MAX_MARGIN) report('routes', `${r.commodity} ${r.from}→${r.to}`, `pays ×${r.margin.toFixed(2)} (at most ×${MAX_MARGIN})`);
  }
  const opening = new Set(routes.filter((r) => r.from === startLocation && r.jumps <= 2 && r.margin >= VIABLE_MARGIN).map((r) => r.commodity));
  if (opening.size < 3) report('routes', startLocation, `only ${opening.size} good(s) worth hauling within two jumps of the start`);
  return issues;
}
