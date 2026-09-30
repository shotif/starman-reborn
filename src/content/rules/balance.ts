import type { BalanceRules, DamageType, FlightLimits, GearFamilyId, ShieldType, SlotType } from '../types.ts';

/**
 * Balance knobs shared by the generators and the guardrails (docs/PROCGEN.md §4). Tune the game
 * here; the unit tests re-run every guardrail over the whole catalogue.
 */

/**
 * Damage multiplier by damage type against each shield type and against bare hull. Every typed
 * shield is strong against one damage type and weak against another; ion strips shields but barely
 * scratches hulls.
 */
export const DAMAGE_MATRIX: Readonly<Record<DamageType, Readonly<Record<ShieldType | 'hull', number>>>> = {
  energy: { deflector: 1.3, diffuser: 0.7, balanced: 1, hull: 0.9 },
  kinetic: { deflector: 0.7, diffuser: 1, balanced: 1, hull: 1.2 },
  plasma: { deflector: 0.9, diffuser: 1.3, balanced: 1, hull: 1 },
  ion: { deflector: 1.6, diffuser: 1.6, balanced: 1.5, hull: 0.25 },
};

/** Share of a typical fight's damage that lands on shields; the rest reaches the hull. */
export const SHIELD_SHARE = 0.4;

/** Weights of the ship budget (a geometric mean of stats relative to the class baseline). */
export const SHIP_WEIGHTS = { hull: 0.4, agility: 0.25, speed: 0.2, cargo: 0.1, power: 0.05 } as const;

/** Slots whose families compete head to head, so every family's class 1 matches this family. */
export const REFERENCE_FAMILY: Partial<Record<SlotType, GearFamilyId>> = {
  gun: 'pulse',
  shield: 'shield-balanced',
};

export const BALANCE: BalanceRules = {
  gearBand: 0.1,
  shipBand: 0.12,
  priceBand: 0.25,
  resale: 0.7,
  hitRate: 0.3,
  // Mirror matches sit around 10–15 s; hard counters (plasma on a diffuser) may be quicker.
  duelSeconds: { min: 4.5, max: 45 },
  tierGapAdvantage: 2,
  traitRange: { min: 0.8, max: 1.25 },
  // Standing with the station's faction ("friendly" starts at 10).
  standingForClass: { 1: -100, 2: -100, 3: -100, 4: 10, 5: 25 },
  standingForShipTier: { 1: -100, 2: -100, 3: 10, 4: 10, 5: 25 },
  shipPriceGrowth: 2.2,
};

/** The envelope the flight model, autopilot, docking and collisions are tuned for. */
export const FLIGHT_LIMITS: FlightLimits = {
  maxSpeed: { min: 80, max: 135 },
  turnRate: { min: 0.9, max: 2 },
  angularResponse: { min: 3.5, max: 8 },
  boostSpeed: { max: 140 },
  cruiseSpeed: { max: 800 },
  radius: { max: 13 },
};
