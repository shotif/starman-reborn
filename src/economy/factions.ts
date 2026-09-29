import type { FactionId } from '../data/types.ts';

/** Original factions. Entirely fictional. */
export interface Faction {
  id: FactionId;
  name: string;
  shortName: string;
  description: string;
  /** Always hostile regardless of standing. */
  alwaysHostile: boolean;
  /** Bracket colour; UI also shows shape + text so colour is never the only cue. */
  color: string;
}

export const FACTIONS: Record<FactionId, Faction> = {
  sta: {
    id: 'sta',
    name: 'Sol Transit Authority',
    shortName: 'Transit Authority',
    description: 'The civil authority that runs Sol’s ports and lanes and clears interstellar departures.',
    alwaysHostile: false,
    color: '#62e39a',
  },
  frontier: {
    id: 'frontier',
    name: 'Frontier Cooperative',
    shortName: 'Frontier Co-op',
    description: 'A union of settlers, miners and researchers running the first outposts beyond Sol.',
    alwaysHostile: false,
    color: '#5cc8ff',
  },
  'hollow-wake': {
    id: 'hollow-wake',
    name: 'Hollow Wake',
    shortName: 'Hollow Wake',
    description: 'Raider crews that prey on lane traffic at the edges of patrolled space.',
    alwaysHostile: true,
    color: '#ff5f5f',
  },
};

export type StandingTier = 'hostile' | 'wary' | 'neutral' | 'friendly' | 'trusted';

export function standingTier(value: number): StandingTier {
  if (value <= -30) return 'hostile';
  if (value < -5) return 'wary';
  if (value < 10) return 'neutral';
  if (value < 40) return 'friendly';
  return 'trusted';
}

export const TIER_LABEL: Record<StandingTier, string> = {
  hostile: 'Hostile',
  wary: 'Wary',
  neutral: 'Neutral',
  friendly: 'Friendly',
  trusted: 'Trusted',
};

/** Reputation is clamped to [-100, 100]. Returns the applied change. */
export function adjustReputation(rep: Record<FactionId, number>, faction: FactionId, delta: number): number {
  const before = rep[faction] ?? 0;
  const after = Math.max(-100, Math.min(100, before + delta));
  rep[faction] = after;
  return after - before;
}

/**
 * Price multiplier from standing: friendly docks give a better deal (buy cheaper, sell dearer).
 * Returned as { buy, sell } multipliers.
 */
export function standingPriceModifier(value: number): { buy: number; sell: number } {
  switch (standingTier(value)) {
    case 'trusted':
      return { buy: 0.88, sell: 1.12 };
    case 'friendly':
      return { buy: 0.93, sell: 1.07 };
    case 'wary':
      return { buy: 1.08, sell: 0.94 };
    case 'hostile':
      return { buy: 1.2, sell: 0.85 };
    default:
      return { buy: 1, sell: 1 };
  }
}

/** Repair discount from standing with the dock's faction. */
export function repairDiscount(value: number): number {
  const tier = standingTier(value);
  if (tier === 'trusted') return 0.4;
  if (tier === 'friendly') return 0.25;
  return 0;
}
