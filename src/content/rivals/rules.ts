import type { SystemId } from '../../data/types.ts';

/**
 * Rival pilots (docs/PROCGEN.md §24): six named pilots with careers of their own. Like the haulers'
 * timetable, a career is a function of the seed, the game clock and the save's world log: each turn
 * a rival rests in a bar, then flies a run to the next station of its patch, trading the best
 * cargo between them, taking a bounty off a board or racing relief to a shortage. The rivals, their
 * names, their ships' names and their words are fiction; the stations and stars are the world's.
 */

export type RivalStyle = 'trader' | 'hunter' | 'runner';
export type RivalVoice = 'brash' | 'dry' | 'warm';

export interface RivalDef {
  id: string;
  first: string;
  nick: string;
  last: string;
  style: RivalStyle;
  /** The station a career starts from and comes back to between runs when it has been knocked out. */
  home: string;
  /** Catalogue ship id. */
  ship: string;
  shipName: string;
  voice: RivalVoice;
}

export const RIVALS = {
  /** Careers start this long into a game (game seconds), once the player has found their feet: the opening's prices stay the designed ones. */
  from: 7_200,
  /**
   * A turn of a career (game seconds): a rest in a bar, then a run to the next station. Longer than a
   * job board's posting (CONTRACTS.epochSeconds), so a hunter never claims twice from one board.
   */
  turnSeconds: 3_600,
  /** How long a rival sits in the bar at the start of a turn before setting off (game seconds). */
  rest: [300, 600] as const,
  /** A rival works the open stations within this many jumps of home, never in these systems (Sol's prices are the opening's). */
  patch: { jumps: 1, avoid: ['sol'] as readonly SystemId[] },
  /** A trade run carries the best lawful cargo between its two stations: this many units (by the rival's hold). */
  trade: { load: [16, 32] as const },
  /**
   * A bounty hunter takes one bounty or ace posted in its patch each turn, on a pack within `reach`
   * jumps of home; the player can buy the claim back for `claim` of the reward.
   */
  hunt: { claim: 0.35, reach: 2 },
  /**
   * A runner races to a shortage that began in its patch in the turn before (still on, and not
   * relieved by the player or the haulers), loading `share` of what it lacks at the nearest maker
   * within `makerJumps` of it (`loadSeconds` there). Its cargo counts toward the relief that ends it.
   */
  race: { share: 0.5, loadSeconds: 240, makerJumps: 1 },
  /**
   * Standing with a rival, −100 to 100, from 0: a round bought in a bar (once a shift, only while it
   * is below `roundsUpTo`), a claim bought back from a hunter, the player's first shot at them in a
   * flight, and their ship destroyed. Amends cost `amends` credits and bring a hostile rival to `amendsTo`.
   */
  standing: { round: 5, roundsUpTo: 30, outbid: -6, shot: -25, destroyed: -60, amends: 1_500, amendsTo: -10 },
  /**
   * Standing tiers are the factions' (economy/factions.ts): friendly rivals say what they are doing
   * next and sell a claim for `claim` of its price; hostile ones refuse a round, keep their claims,
   * and come for the player where security is below `lawless`.
   */
  friendly: { claim: 0.5 },
  hostile: { lawless: 0.5 },
  /** A rival whose ship the player destroyed is out of the game this long, refitting at home (game seconds). */
  downSeconds: 10_800,
  /** What a destroyed rival's hold spills: this share of its cargo, in pods of this many units. */
  spill: { share: 0.5, pod: [4, 9] as const },
  /** News of rivals reaches this many jumps, and remembers this long (game seconds). */
  news: { jumps: 2, recent: 3_600 },
} as const;

/** The six (all invented). */
export const ROSTER: readonly RivalDef[] = [
  { id: 'quickstep', first: 'Mara', nick: 'Quickstep', last: 'Venn', style: 'trader', home: 'sirius-platform', ship: 'ship.freighter.2.toliman', shipName: 'Merry Dancer', voice: 'brash' },
  { id: 'tally', first: 'Bastian', nick: 'Tally', last: 'Okonjo', style: 'trader', home: 'dogwood-port', ship: 'ship.freighter.3.eridani', shipName: 'Fair Exchange', voice: 'dry' },
  { id: 'lantern', first: 'Ione', nick: 'Lantern', last: 'Sallow', style: 'hunter', home: 'regent-concourse', ship: 'ship.heavy-fighter.2.horizon', shipName: 'Long Night', voice: 'dry' },
  { id: 'two-bells', first: 'Dax', nick: 'Two Bells', last: 'Corrigan', style: 'hunter', home: 'ledger-institute', ship: 'ship.gunship.2.eridani', shipName: 'Last Orders', voice: 'brash' },
  { id: 'halfpenny', first: 'Pell', nick: 'Halfpenny', last: 'Arkwright', style: 'runner', home: 'dawnfield-institute', ship: 'ship.courier.3.horizon', shipName: 'Spare Change', voice: 'warm' },
  { id: 'sundown', first: 'Saoirse', nick: 'Sundown', last: 'Kalu', style: 'runner', home: 'millstone-relay', ship: 'ship.courier.2.horizon', shipName: 'Late Light', voice: 'warm' },
];

/** What a rival's style is called, under its name. */
export const STYLE_LABEL: Record<RivalStyle, string> = { trader: 'Trader', hunter: 'Bounty hunter', runner: 'Runner' };
