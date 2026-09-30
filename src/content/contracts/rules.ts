import type { StationType } from '../world/types.ts';

/**
 * Contract rules (docs/PROCGEN.md §10): which kinds of contract each kind of station posts, how
 * often boards change and how rewards scale. The generator (src/economy/contracts.ts) is a pure
 * function of these rules, the world, the market tables and the board's time slot.
 */

export type ContractKind = 'freight' | 'parcel' | 'supply' | 'bounty' | 'survey';

/** Relative weights of contract kinds on a station's board. */
export type KindWeights = Partial<Record<ContractKind, number>>;

export const BOARD_KINDS: Record<Exclude<StationType, 'pirate-den'>, KindWeights> = {
  'trade-port': { freight: 3, parcel: 2, supply: 2, bounty: 1 },
  'customs-depot': { parcel: 2, bounty: 3, freight: 1 },
  shipyard: { supply: 3, freight: 1, parcel: 1 },
  'mining-outpost': { freight: 2, supply: 2, bounty: 1 },
  refinery: { freight: 2, supply: 2, parcel: 1 },
  factory: { freight: 3, supply: 2 },
  'agri-station': { freight: 3, supply: 1, parcel: 1 },
  'research-station': { survey: 3, parcel: 2, supply: 1 },
  relay: { parcel: 3, bounty: 1 },
  'military-base': { bounty: 4, parcel: 1 },
  freeport: { freight: 2, parcel: 2, supply: 1, bounty: 1 },
};

/** The hand-made stations post generated contracts too, once the opening delivery is done. */
export const CURATED_BOARD_KINDS: Record<string, KindWeights> = {
  'earth-port': BOARD_KINDS['trade-port'],
  'mars-depot': { bounty: 2, parcel: 2, freight: 2, supply: 1 },
  'meridian-outpost': BOARD_KINDS['research-station'],
  'barnard-relay': BOARD_KINDS.relay,
  'sirius-platform': { survey: 2, freight: 2, supply: 1, parcel: 1 },
  'eridani-hub': { freight: 2, supply: 2, bounty: 1 },
};

export const CONTRACTS = {
  /** Boards change every this many seconds of play (the game clock). */
  epochSeconds: 1_500,
  /** Contracts on a board: 2, plus one for large stations and one for busy trade and military hubs. */
  board: { base: 2, largeAbove: 0.6, busy: ['trade-port', 'military-base'] as readonly StationType[], max: 4 },
  /** At most this many generated contracts in progress at once. */
  maxActive: 5,
  /** How far contracts send you, in jumps. */
  maxJumps: { freight: 3, parcel: 4, supply: 3, bounty: 2, survey: 3 } satisfies Record<ContractKind, number>,
  /** Hold units a freight or supply contract asks for (before the good's unit size). */
  cargoUnits: [8, 30] as const,
  /** Most the cargo may be worth at base prices (keeps deposits and purchases within a young pilot's reach). */
  cargoValueCap: { freight: 900, supply: 1_400 },
  /** Pay varies a little from one posting to the next. */
  payVariation: [0.92, 1.1] as const,
  /**
   * Rewards: the jump fees there and back with a margin (`perFee` times the one-way fees, always
   * paid in full), plus a part that varies a little per posting: a base, `danger` times
   * (1 − destination security) and the kind's own part (a share of the cargo's value, the goods'
   * markup on a supply run, so much per raider on a bounty).
   */
  reward: {
    perFee: 2.5,
    freight: { base: 150, danger: 220, cargoShare: 0.15 },
    parcel: { base: 150, danger: 200 },
    supply: { base: 110, goodsMarkup: 1.35 },
    bounty: { base: 200, perRaider: 150 },
    survey: { base: 180, danger: 160 },
  },
  /** Difficulty 3 contracts need Friendly standing with the station's owner. */
  gatedDifficulty: 3,
  gateStanding: 10,
  /** Standing gained with the station's owner by difficulty (1, 2, 3). */
  repReward: [2, 4, 6] as const,
  /** Standing lost with the station's owner for abandoning a contract (any deposit is forfeit). */
  abandonStanding: 3,
};
