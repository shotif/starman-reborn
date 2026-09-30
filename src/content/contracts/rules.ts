import type { StationType } from '../world/types.ts';

/**
 * Contract rules (docs/PROCGEN.md §10): which kinds of contract each kind of station posts, how
 * often boards change and how rewards scale. The generator (src/economy/contracts.ts) is a pure
 * function of these rules, the world, the market tables and the board's time slot.
 */

export type ContractKind = 'freight' | 'parcel' | 'supply' | 'bounty' | 'survey' | 'escort' | 'ace' | 'recovery' | 'smuggle' | 'piracy' | 'den';

/** Relative weights of contract kinds on a station's board. */
export type KindWeights = Partial<Record<ContractKind, number>>;

export const BOARD_KINDS: Record<Exclude<StationType, 'pirate-den'>, KindWeights> = {
  'trade-port': { freight: 3, parcel: 2, supply: 2, bounty: 1, escort: 1 },
  'customs-depot': { parcel: 2, bounty: 3, freight: 1, ace: 1, recovery: 1, den: 1 },
  shipyard: { supply: 3, freight: 1, parcel: 1, recovery: 1 },
  'mining-outpost': { freight: 2, supply: 2, bounty: 1, escort: 1 },
  refinery: { freight: 2, supply: 2, parcel: 1, escort: 1 },
  factory: { freight: 3, supply: 2, escort: 1 },
  'agri-station': { freight: 3, supply: 1, parcel: 1, escort: 1 },
  'research-station': { survey: 3, parcel: 2, supply: 1, recovery: 2 },
  relay: { parcel: 3, bounty: 1, recovery: 1 },
  'military-base': { bounty: 4, parcel: 1, ace: 2, den: 1 },
  freeport: { freight: 2, parcel: 2, supply: 1, bounty: 1, recovery: 1, escort: 1, ace: 1, smuggle: 2 },
};

/** Frontier boards want the new systems surveyed for the codex: this much extra survey weight. */
export const FRONTIER_SURVEY_WEIGHT = 2;

/** Raider dens post work for pilots the Hollow Wake trusts (docs/PROCGEN.md §12). */
export const DEN_BOARD_KINDS: KindWeights = { smuggle: 3, piracy: 2, parcel: 1 };

/** The hand-made stations post generated contracts too, once the opening delivery is done. */
export const CURATED_BOARD_KINDS: Record<string, KindWeights> = {
  'earth-port': BOARD_KINDS['trade-port'],
  'mars-depot': { bounty: 2, parcel: 2, freight: 2, supply: 1, escort: 1, ace: 1, den: 1 },
  'meridian-outpost': BOARD_KINDS['research-station'],
  'barnard-relay': BOARD_KINDS.relay,
  'sirius-platform': { survey: 2, freight: 2, supply: 1, parcel: 1, recovery: 1 },
  'eridani-hub': { freight: 2, supply: 2, bounty: 1, escort: 1 },
};

export const CONTRACTS = {
  /** Boards change every this many seconds of play (the game clock). */
  epochSeconds: 1_500,
  /** Contracts on a board: 2, plus one for large stations and one for busy trade and military hubs. */
  board: { base: 2, largeAbove: 0.6, busy: ['trade-port', 'military-base'] as readonly StationType[], max: 4 },
  /** At most this many generated contracts in progress at once. */
  maxActive: 5,
  /** How far contracts send you, in jumps (escorts stay in the posting station's system). */
  maxJumps: { freight: 3, parcel: 4, supply: 3, bounty: 2, survey: 3, escort: 0, ace: 3, recovery: 3, smuggle: 3, piracy: 2, den: 3 } satisfies Record<ContractKind, number>,
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
   * markup on a supply run, so much per raider on a bounty or escort).
   */
  reward: {
    perFee: 2.5,
    freight: { base: 150, danger: 220, cargoShare: 0.15 },
    parcel: { base: 150, danger: 200 },
    supply: { base: 110, goodsMarkup: 1.35, urgentMarkup: 1.6 },
    bounty: { base: 200, perRaider: 150 },
    /** Surveys pay more out in the frontier (the long-range drive, the long lanes). */
    survey: { base: 180, danger: 160, frontier: 1.5 },
    escort: { base: 260, perLevel: 180 },
    ace: { base: 900 },
    recovery: { base: 220, danger: 180, perGuard: 150 },
    smuggle: { base: 300, danger: 150, contrabandShare: 0.3 },
    piracy: { base: 350, perShip: 220 },
    /** Knocking out a raider den (docs/PROCGEN.md §15), with a wing of the poster's. */
    den: { base: 2_400 },
  },
  /** Standing with the Hollow Wake for outlaw work (smuggling, piracy); the law's standing is not touched unless you are caught. */
  outlawWake: { smuggle: 6, piracy: 10 },
  /**
   * Work answering a world event (docs/PROCGEN.md §11): a supply run into a shortage or boom at the
   * posting station, a haul out of its glut, or a bounty on a raid within reach. One per board at
   * most; its varying pay is this much higher.
   */
  eventPremium: 1.3,
  /**
   * Urgent jobs: some freight and parcels pay a bonus for arriving within a time limit (from
   * acceptance, on the game clock). Late deliveries still pay, without the bonus, and cost a
   * little standing. The limit is `margin` times the expected trip, at least `minSeconds`.
   */
  urgent: {
    chance: 0.3,
    bonus: 0.4,
    margin: 2.5,
    minSeconds: 480,
    /** Expected trip on the game clock: undock and fly out, each jump (lane transit included), dock. */
    trip: { depart: 45, perJump: 165, arrive: 30 },
    lateStanding: 2,
  },
  /**
   * Chains: a delivered parcel or haul sometimes leads to a follow-up offered at its destination
   * (up to `maxSteps` in all), each step paying `stepPay` times more. The offer lapses after
   * `offerEpochs` board changes.
   */
  chain: { chance: 0.45, maxSteps: 3, stepPay: 1.25, offerEpochs: 2 },
  /** Aces: a named raider in a better ship (tougher by `toughness`, deadlier by `damage`) with two guards. */
  ace: { model: 'ship.heavy-fighter.2.wake', guards: 2, toughness: 1.8, damage: 1.3, loot: [500, 900] as const },
  /** Escorts: the ambush comes when the escorted ship is this far along its route. */
  escort: { ambushAt: [0.25, 0.45] as const },
  /** Difficulty 3 contracts need Friendly standing with the station's owner. */
  gatedDifficulty: 3,
  gateStanding: 10,
  /** Standing gained with the station's owner by difficulty (1, 2, 3). */
  repReward: [2, 4, 6] as const,
  /** Standing lost with the station's owner for abandoning a contract (any deposit is forfeit). */
  abandonStanding: 3,
  /** Standing lost for failing one (an escorted ship lost or left behind). */
  failStanding: 3,
};

/** First names, family names and nicknames for aces (all invented). */
export const ACE_NAMES = {
  first: ['Ilse', 'Dorran', 'Kesh', 'Wren', 'Tamsin', 'Oskar', 'Nadia', 'Brannoc', 'Sefa', 'Juno', 'Corvin', 'Maeve', 'Rook', 'Talia'],
  last: ['Vell', 'Harrow', 'Quint', 'Sable', 'Marrick', 'Tolland', 'Crane', 'Voss', 'Ashby', 'Kestrel', 'Draygo', 'Lusk'],
  nick: ['the Knife', 'Blackwake', 'Grin', 'the Collector', 'Six-Guns', 'Cinder', 'Old Teeth', 'the Widow', 'Longshot', 'Hollowpoint'],
};

/** What a wreck may carry home (recovery contracts). */
export const RECOVERY_ITEMS: readonly { item: string; why: string }[] = [
  { item: 'flight recorder', why: 'A courier went dark near {place}. Its flight recorder may say why' },
  { item: 'sealed cargo pod', why: 'A hauler broke up near {place}; one sealed pod belongs to us' },
  { item: 'survey drone', why: 'Our survey drone lost power near {place}' },
  { item: 'data vault', why: 'A research tender was lost near {place}, with its data vault aboard' },
  { item: 'courier strongbox', why: 'A courier’s strongbox is drifting in the wreckage near {place}' },
];
