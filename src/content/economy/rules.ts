import type { StationType } from '../world/types.ts';
import type { CommodityId } from './goods.ts';

/**
 * Economy rules (docs/PROCGEN.md §8): what each kind of station makes and needs, and the numbers
 * that turn that into prices. The market tables (markets.ts) are a pure function of these rules
 * and the generated world; the guardrails live in validate.ts.
 */

/** What a station does with a good: makes it (sells cheap), needs it (buys dear) or trades it both ways. */
export type MarketRole = 'produce' | 'consume' | 'trade';

export interface MarketProfile {
  produce: readonly CommodityId[];
  consume: readonly CommodityId[];
  trade: readonly CommodityId[];
}

export const STATION_MARKETS: Record<StationType, MarketProfile> = {
  'trade-port': {
    produce: ['consumer-goods', 'luxuries', 'electronics'],
    consume: ['food', 'fine-food', 'water', 'medical', 'research-samples', 'data-cores', 'spoofers'],
    trade: ['polymers', 'machinery', 'deuterium'],
  },
  'customs-depot': { produce: ['deuterium'], consume: ['food', 'ship-parts', 'medical', 'weapons'], trade: ['electronics', 'consumer-goods'] },
  shipyard: { produce: ['ship-parts', 'habitat-modules', 'salvage'], consume: ['metals', 'machinery', 'electronics', 'polymers', 'deuterium', 'spoofers'], trade: [] },
  'mining-outpost': { produce: ['ore', 'water', 'gases'], consume: ['food', 'medical', 'machinery', 'consumer-goods', 'deuterium', 'habitat-modules', 'luxuries', 'stims'], trade: [] },
  refinery: { produce: ['metals', 'deuterium', 'polymers', 'helium-3'], consume: ['ore', 'water', 'gases', 'machinery', 'food', 'salvage', 'stims'], trade: [] },
  factory: { produce: ['machinery', 'electronics', 'fabricators', 'consumer-goods', 'weapons'], consume: ['metals', 'polymers', 'deuterium', 'food', 'helium-3'], trade: [] },
  'agri-station': { produce: ['food', 'fine-food', 'medical'], consume: ['water', 'gases', 'machinery', 'polymers', 'fabricators'], trade: [] },
  'research-station': { produce: ['research-samples', 'data-cores', 'medical'], consume: ['electronics', 'food', 'fine-food', 'fabricators', 'helium-3'], trade: [] },
  relay: { produce: [], consume: ['food', 'medical', 'electronics'], trade: ['deuterium', 'helium-3', 'data-cores'] },
  'military-base': { produce: ['salvage'], consume: ['weapons', 'ship-parts', 'deuterium', 'food', 'medical', 'data-cores'], trade: [] },
  freeport: {
    produce: ['salvage', 'weapons', 'stims', 'spoofers'],
    consume: ['luxuries', 'fine-food', 'medical', 'consumer-goods', 'electronics'],
    trade: ['food', 'deuterium', 'metals', 'ore', 'data-cores'],
  },
  /** Raider dens: a black market for pilots the Hollow Wake trusts (docs/PROCGEN.md §12). */
  'pirate-den': {
    produce: ['stims', 'spoofers', 'weapons', 'salvage'],
    consume: ['luxuries', 'fine-food', 'medical', 'electronics', 'ship-parts', 'consumer-goods'],
    trade: ['deuterium', 'food'],
  },
};

/**
 * The hand-authored stations: their own profiles, and fixed prices for the three goods of the
 * opening contracts (so the first runs play exactly as designed). Other goods follow the rules.
 */
export const CURATED_MARKETS: Record<string, MarketProfile & { anchors: Partial<Record<CommodityId, { buy: number | null; sell: number | null }>> }> = {
  'earth-port': {
    produce: ['medical', 'fabricators', 'electronics', 'consumer-goods', 'luxuries', 'fine-food'],
    consume: ['deuterium', 'water', 'research-samples', 'helium-3', 'data-cores'],
    trade: ['food', 'polymers', 'machinery'],
    anchors: { medical: { buy: 38, sell: 32 }, fabricators: { buy: 150, sell: 128 }, deuterium: { buy: null, sell: 98 } },
  },
  'mars-depot': {
    produce: ['deuterium', 'metals', 'ship-parts', 'machinery', 'weapons'],
    consume: ['fabricators', 'food', 'water', 'electronics'],
    trade: ['medical', 'polymers', 'gases'],
    anchors: { medical: { buy: 60, sell: 54 }, fabricators: { buy: null, sell: 176 }, deuterium: { buy: 66, sell: 58 } },
  },
  'meridian-outpost': {
    produce: ['research-samples', 'data-cores'],
    consume: ['medical', 'fabricators', 'deuterium', 'food', 'fine-food', 'electronics', 'polymers', 'habitat-modules'],
    trade: [],
    anchors: { medical: { buy: null, sell: 96 }, fabricators: { buy: null, sell: 238 }, deuterium: { buy: null, sell: 118 } },
  },
  'barnard-relay': {
    produce: ['data-cores'],
    consume: ['medical', 'fabricators', 'deuterium', 'food', 'consumer-goods', 'helium-3'],
    trade: [],
    anchors: { medical: { buy: null, sell: 78 }, fabricators: { buy: null, sell: 205 }, deuterium: { buy: null, sell: 124 } },
  },
  'sirius-platform': {
    produce: ['fabricators', 'electronics', 'research-samples', 'data-cores'],
    consume: ['medical', 'deuterium', 'metals', 'polymers', 'food', 'helium-3'],
    trade: [],
    anchors: { medical: { buy: null, sell: 88 }, fabricators: { buy: 136, sell: 118 }, deuterium: { buy: null, sell: 112 } },
  },
  'eridani-hub': {
    produce: ['deuterium', 'ore', 'metals', 'water', 'helium-3'],
    consume: ['medical', 'fabricators', 'food', 'machinery', 'consumer-goods', 'fine-food'],
    trade: [],
    anchors: { medical: { buy: null, sell: 92 }, fabricators: { buy: null, sell: 228 }, deuterium: { buy: 48, sell: 40 } },
  },
};

export const ECONOMY = {
  /** Equilibrium price as a multiple of base: makers sell cheap, traders at par. */
  produceFactor: 0.72,
  tradeFactor: 1,
  /** Stations that need a good pay more the further away its nearest maker is (per jump, up to `maxJumps`). */
  consumeFactor: 1.16,
  perJump: 0.06,
  maxJumps: 5,
  /** Lawless stations pay extra for what they need (deliveries are dangerous): × (1 + riskPremium × (1 − security)). */
  riskPremium: 0.25,
  /** Station-to-station variation of equilibrium prices (±). */
  variation: 0.06,
  /** Buy/sell spread by role (fraction of the mid price). */
  spread: { produce: 0.1, trade: 0.14, consume: 0.1 } satisfies Record<MarketRole, number>,
  /** Normal stock, scaled by station size: makers hold plenty, buyers only what they need. */
  stock: { produce: [140, 260], trade: [60, 110], consume: [30, 60] } satisfies Record<MarketRole, readonly [number, number]>,
  /** Price = mid × (normal stock / stock)^elasticity, clamped to `stockClamp`. */
  elasticity: 0.35,
  stockClamp: [0.62, 1.6] as const,
  /** Stock returns to normal with this time constant (game-clock seconds of play). */
  recoverySeconds: 1_800,
  /** Slow drift of every price: ± amplitude over a period (seconds of play), per station and good. */
  drift: { amplitude: 0.06, period: [2_400, 7_200] as const },
};
