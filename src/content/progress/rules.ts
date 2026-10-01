/**
 * Progress rules (docs/PROCGEN.md §13): pilot ratings, milestones, the codex of the real sky and
 * what research stations pay for a completed survey. The names are invented for this game.
 */

export type RatingKind = 'combat' | 'trade' | 'exploration';

/** Rank names and the score each needs (combat: raiders and hunters destroyed; trade: contract pay plus a quarter of sales; exploration: three per system visited plus one per body catalogued). */
export const RATINGS: Record<RatingKind, { label: string; ranks: readonly (readonly [string, number])[] }> = {
  combat: {
    label: 'Combat',
    ranks: [
      ['Green', 0],
      ['Blooded', 3],
      ['Steady', 10],
      ['Hardened', 25],
      ['Veteran', 50],
      ['Ace', 100],
      ['Legend', 200],
    ],
  },
  trade: {
    label: 'Trade',
    ranks: [
      ['Hauler', 0],
      ['Dealer', 2_000],
      ['Merchant', 8_000],
      ['Broker', 20_000],
      ['Magnate', 50_000],
      ['Tycoon', 120_000],
    ],
  },
  exploration: {
    label: 'Exploration',
    ranks: [
      ['Stay-at-home', 0],
      ['Drifter', 10],
      ['Wayfarer', 30],
      ['Pathfinder', 60],
      ['Surveyor', 100],
      ['Cartographer', 150],
    ],
  },
};

/** Ace hunts need at least this combat rank (index into RATINGS.combat.ranks: Hardened). */
export const ACE_COMBAT_RANK = 3;

/** Research stations buy each completed system survey once: so much per catalogued body, at least `min`. */
export const SURVEY_SALE = { perBody: 120, min: 240 };
/** The Frontier Cooperative's grant for cataloguing the whole sky (it grew with the sky snapshot). */
export const CODEX_GRANT = 25_000;

/**
 * The what-next hint (docs/PROCGEN.md §13.4): when the ship needs a mechanic first, when an
 * upgrade is worth a word, and what a suggestion to spend leaves in hand.
 */
export const HINT = {
  /** Repairs come first below this share of the hull, or with a system at least this damaged. */
  repairBelow: 0.5,
  systemsFrom: 0.4,
  /** A suggestion to spend leaves this much for fees and repairs. */
  reserve: 1_000,
  /** A ship is worth suggesting with this much more hold than the one flown, or a higher tier. */
  upgradeHold: 1.5,
  /** The long-range drive is suggested after this many jumps, until the frontier is reached. */
  driveAfterJumps: 6,
  /** Standing this close below Friendly is worth a word. */
  friendlyWithin: 5,
};

export type MilestoneId =
  | 'first-contract'
  | 'contracts-25'
  | 'credits-10k'
  | 'credits-50k'
  | 'ship-mk2'
  | 'ship-mk3'
  | 'systems-10'
  | 'systems-all'
  | 'frontier-first'
  | 'frontier-25'
  | 'planets-10'
  | 'codex-half'
  | 'codex-all'
  | 'kills-10'
  | 'kills-50'
  | 'friend-sta'
  | 'friend-frontier'
  | 'friend-wake'
  | 'rank-top'
  | 'story-sta'
  | 'story-frontier'
  | 'story-wake'
  | 'story-border'
  | 'story-harvest';

export const MILESTONES: readonly { id: MilestoneId; title: string }[] = [
  { id: 'first-contract', title: 'First contract completed' },
  { id: 'contracts-25', title: 'Twenty-five contracts completed' },
  { id: 'credits-10k', title: '10,000 credits in hand' },
  { id: 'credits-50k', title: '50,000 credits in hand' },
  { id: 'ship-mk2', title: 'Flying a Mk II ship' },
  { id: 'ship-mk3', title: 'Flying a Mk III ship' },
  { id: 'systems-10', title: 'Ten systems visited' },
  { id: 'systems-all', title: 'Every system in the neighbourhood visited' },
  { id: 'frontier-first', title: 'Into the frontier' },
  { id: 'frontier-25', title: 'Twenty-five frontier systems visited' },
  { id: 'planets-10', title: 'Ten confirmed planets scanned' },
  { id: 'codex-half', title: 'Half the sky catalogued' },
  { id: 'codex-all', title: 'The whole sky catalogued' },
  { id: 'kills-10', title: 'Ten raiders down' },
  { id: 'kills-50', title: 'Fifty raiders down' },
  { id: 'friend-sta', title: 'Friendly with the Transit Authority' },
  { id: 'friend-frontier', title: 'Friendly with the Frontier Cooperative' },
  { id: 'friend-wake', title: 'Trusted by the Hollow Wake' },
  { id: 'rank-top', title: 'Top rank in a rating' },
  { id: 'story-sta', title: 'Clean Manifests: the Transit Authority’s story finished' },
  { id: 'story-frontier', title: 'The Stonecrop Blight: the Frontier Cooperative’s story finished' },
  { id: 'story-wake', title: 'Salt’s Crew: the Hollow Wake’s story finished' },
  { id: 'story-border', title: 'The Long Border: the Ross 154 line settled' },
  { id: 'story-harvest', title: 'First Harvest: Harrow Farmstead’s harvest brought in' },
];
