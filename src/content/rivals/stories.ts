import type { RivalStyle } from './rules.ts';

/**
 * Rival stories (docs/PROCGEN.md §28): one story per rival per save, along one of two paths by how
 * the player stands with them. A friend's: a loan asked at their table, then a deed (flying escort
 * on their run, or bringing parts when their drive fails on one), and from then on an ally who will
 * fly on the player's wing now and then. An enemy's: an opening (customs tipped off, or hired guns
 * waiting in lawless space), then a duel, one on one, each pilot in their own ship as it is fitted.
 * While a story holds a rival (waiting for the escort, adrift, on the wing, lying in wait, at the
 * duel), their career pauses, and picks up again from where the story left them. The numbers are
 * game balance, not fact; the people and their words are fiction.
 */

export type StoryDeed = 'escort' | 'rescue';
export type StoryOpening = 'tipoff' | 'ambush';

export const RIVAL_STORY = {
  friend: {
    /** A friend's story opens at their table at this standing, once the player has known them this long (game seconds). */
    standing: 20,
    knownSeconds: 7_200,
    /** The loan they ask for, by style (credits): paid back with `interest` when their next run docks; lending it is worth `standing`. */
    loan: { amount: { trader: 1_500, hunter: 1_200, runner: 900 } satisfies Record<RivalStyle, number>, interest: 0.2, standing: 10 },
    /**
     * Flying escort on their next run, asked at their table once the loan is back: the pay, the threat
     * of the raiders who come for it, and how long they wait for the player to fly it before going alone.
     */
    escort: { reward: 800, level: 2 as 1 | 2 | 3, wait: 10_800, letDown: -10 },
    /**
     * A rescue: their drive fails on the first run that sets off at least `after` once the loan is
     * back (the leg's `at` share of the way along); `qty` ship components to bring, paid at their base
     * price plus `reward`; unanswered for `giveUp`, they are towed home, and think less of the player.
     */
    rescue: { after: 1_800, at: 0.4, qty: 4, reward: 400, giveUp: 7_200, towed: -15 },
    /** A deed done is worth this. */
    deedStanding: 15,
    /**
     * An ally, once the deed is done, at this standing (rounds bought for them go up to it): asked at
     * their table at most once in `every`, they fly on the player's wing in their own ship until the
     * player next docks.
     */
    ally: { standing: 40, every: 10_800 },
  },
  enemy: {
    /** A feud: the opening comes at the first turn of their career at least `after` the act that made them hostile, `sinceMet` after the player met them, and once they are back in a ship. */
    after: 3_600,
    sinceMet: 7_200,
    /** Customs tipped off: for `seconds`, in lawful systems within `jumps` of the rival's home, the next patrol in range scans the player, and so does any lawful dock; the first scan spends it. */
    tipoff: { seconds: 7_200, jumps: 2 },
    /**
     * Hired guns: for `seconds`, the first flight in a lawless system within `jumps` of the rival's home
     * meets `guns` raiders of threat `level`, `delay` seconds in (a bounty hunter hires `hunterGuns` and
     * flies with them). They pay no bounty and leave no salvage.
     */
    ambush: { seconds: 10_800, jumps: 2, guns: 2, hunterGuns: 1, level: 2 as 1 | 2 | 3, delay: [20, 40] as const },
    /**
     * The duel: posted at the first turn of their career at least `postedAfter` the opening is over, and
     * open for `open`, `offBeacon` metres off the jump beacon of the lawless system nearest the rival's
     * home. One on one: wings hold fire and no raiders come. It starts when the player is within
     * `startWithin` m with at least `minHull` of their hull; each side yields at `yieldAt` of its hull.
     * Won: the `purse`, and standing back to `wonStanding`. Lost, or forfeit (more than `forfeitRange`
     * m off, docking or jumping once it has started): the `stake`, and standing at `lostStanding`.
     * Missed: nothing settled, and they stay hostile.
     */
    duel: { postedAfter: 1_800, open: 7_200, offBeacon: 6_000, startWithin: 1_500, minHull: 0.8, yieldAt: 0.35, forfeitRange: 5_000, purse: 1_000, stake: 500, wonStanding: 0, lostStanding: -10 },
  },
  /** Each rival's story: the deed of a friend's, the opening of an enemy's. */
  paths: {
    quickstep: { deed: 'escort', opening: 'tipoff' },
    tally: { deed: 'rescue', opening: 'tipoff' },
    lantern: { deed: 'rescue', opening: 'ambush' },
    'two-bells': { deed: 'escort', opening: 'ambush' },
    halfpenny: { deed: 'escort', opening: 'tipoff' },
    sundown: { deed: 'rescue', opening: 'ambush' },
  } as Record<string, { deed: StoryDeed; opening: StoryOpening }>,
};

export type RivalStoryRules = typeof RIVAL_STORY;
