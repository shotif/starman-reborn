/**
 * The border war (docs/PROCGEN.md §20). Where lawful space meets a Hollow Wake den, the two sides
 * push each other back and forth: a tide on the game clock, plus what the player does there. All
 * of it is fiction, and all of it is a function of the seed, the clock and the save's world log.
 */
export const BORDER = {
  /** The tide of the war: amplitude × sin(2π (clock / period + phase)), + for the law, − for the Wake. */
  tide: { amplitude: 70, periodSeconds: 172_800 },
  /** A deed's weight fades with this time constant (game seconds). */
  fadeSeconds: 86_400,
  /** Pressure at or above which the law has pushed the Wake back; below which it is a skirmish, a blockade, a station fallen. */
  phases: { pushedBack: 35, blockade: -30, fallen: -60 },
  /** What the player's deeds weigh on the front where they happen. */
  deeds: { warContract: 18, raiderKill: 2, patrolKill: -3, piracy: -3 },
  /** The Long Border's endings hold its front at this pressure for good. */
  ending: { law: 70, wake: -80, truce: 0 },
  /** Deeds kept per front (the oldest drop off; by then they weigh little). */
  keep: 24,
  /** News of a front reaches this many jumps. */
  newsJumps: 3,
  /** Traffic: a skirmish brings a patrol wing and a raider pack more to each side; a blockade more packs. */
  traffic: { skirmishWings: 1, skirmishPacks: 1, blockadePacks: 2 },
  /**
   * Fronts that end (§20.7). Once the player's own deeds on a front come to `momentum` one side's
   * way (two or three war contracts close together; they fade like any deed), that side offers its
   * decisive operation; done, it settles the front for good. A front a story settles is left to it.
   */
  campaign: {
    momentum: 40,
    /** The law's: knock out the den across the line, with a wing of the front's faction. */
    law: { pay: 3_200, wakeStanding: -20, maxJumps: 2 },
    /** The Wake's: hold the den against the faction's last sweep, this many of its ships destroyed. */
    wake: { sweep: 5, pay: 2_800, wakeStanding: 20 },
  },
  /** What a front settled for good leaves on the stations around it (lasting marks, §14.7). */
  settled: {
    /** The law holds it: the lawful system's own stations ship more of what they make, and post a run of it. */
    law: { price: 0.9, stock: 1.4, premium: 1.1, goods: 3 },
    /** The Wake holds it: the lawful system's supplies come rarely, and the den is full of plunder. */
    wake: { scarcePrice: 1.15, scarceStock: 0.7, plunderPrice: 0.85, plunderStock: 1.6, goods: 3 },
  },
} as const;
