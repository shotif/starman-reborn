/**
 * Haulers on the lanes (docs/PROCGEN.md §21): the freight the stations send each other, as ships
 * with names, cargo and a timetable. Like the world's events, every haul is a function of the seed,
 * the game clock and the save's world log: nothing runs in the background. The haulers, their
 * names and their owners are fiction; the stars they fly between are real.
 */
export const HAULS = {
  /** Each open station that makes goods may send one haul per slot (game seconds). */
  slotSeconds: 300,
  /** Chance a station sends a haul in a slot: `base` + `perSecurity` × its system's security (lawless lanes are quiet). */
  send: { base: 0.3, perSecurity: 0.5 },
  /** A haul goes at most this many jumps. */
  maxJumps: 2,
  /** What a haul carries: this share of its destination's normal stock of the good, within `min`–`max` units. */
  load: { share: 0.25, min: 8, max: 40 },
  /**
   * Flight time of each leg, game seconds: between a station and the jump beacon (`dock`), across a
   * system on the way (`transit`), and between two stations of one system (`local`). Jumps take
   * EVENTS.jumpSeconds a hop, as the player's do.
   */
  legs: { dock: 300, transit: 180, local: 360 },
  /**
   * A shortage draws relief: `hauls` hauls from the nearest stations that make the good, within
   * `maxJumps`, each carrying `share` of what the station lacks, sent `dispatch` seconds after it
   * starts. All of them arriving relieves it (EVENTS.react.relief of what it lacks).
   */
  relief: { hauls: 2, share: 0.3, maxJumps: 3, dispatch: [240, 900] as const },
  /**
   * A glut, or a frontier harvest, ships its surplus out (docs/PROCGEN.md §21.6): `hauls` hauls to
   * the nearest stations within `maxJumps` that use or trade the good (a different one each, while
   * there are), each carrying `share` of the surplus, sent `dispatch` seconds after it starts (none
   * after it was due to end). Its cargo leaves the station as it sets off: all of them gone clears
   * the glut (EVENTS.react.relief of its surplus), as does the player buying up the rest.
   */
  shipOut: { hauls: 2, share: 0.3, dispatch: [900, 2_700] as const },
  /** A haul in a raided system's lanes, where the player is not, is lost with this chance by the raid's threat level. */
  raidLoss: { 1: 0.2, 2: 0.35, 3: 0.5 } as Record<1 | 2 | 3, number>,
  /** No station sends a trade haul out of a raided system, or into one. */
  avoidRaids: true,
  /** The world log keeps what became of the hauls the player saw for this long (game seconds). */
  keepSeconds: 10_800,
  /** A hauler the player kept alive through a raiders' attack sends thanks: credits per unit it carries (at least `min`), and standing. */
  thanks: { perUnit: 6, min: 80, standing: 1 },
  /** A hauler destroyed spills this share of its cargo, in pods of this many units. */
  spill: { share: 0.5, pod: [4, 9] as const },
  /** News of hauls lost to raiders reaches this many jumps, for this long (game seconds). */
  news: { jumps: 2, recent: 1_800, max: 3 },
} as const;

/** Haulers' names (all invented). */
export const HAULER_NAMES: readonly string[] = [
  'Snapdragon', 'Thistle', 'Bramble', 'Kestrel', 'Bullfinch', 'Firecrest', 'Juniper', 'Tern', 'Saffron', 'Clementine',
  'Stonechat', 'Rosehip', 'Fieldfare', 'Coriander', 'Mayfly', 'Hawthorn', 'Bluebell', 'Sandpiper', 'Damson', 'Redwing',
  'Teasel', 'Meadow Queen', 'Gannet', 'Honeydew', 'Ironweed', 'Kingfisher', 'Waxwing', 'Mallow', 'Nettle', 'Oxbow',
  'Pennyroyal', 'Quince', 'Redstart', 'Samphire', 'Tamarind', 'Umber', 'Vetch', 'Nightjar', 'Evening Star', 'Zinnia',
  'Good Measure', 'Long Haul', 'Fair Wind', 'Steady Hand', 'Second Chance', 'Old Faithful', 'Brass Lantern', 'Copper Kettle',
];
