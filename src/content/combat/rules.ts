/**
 * Combat depth (docs/PROCGEN.md §15): enemy seekers and the decoys that fool them, mines, damage to
 * a ship's systems, loot beyond credits, wingmen for hire and the chatter of a fight. The numbers
 * are game balance, not fact; the names are invented for this game.
 */
export const COMBAT = {
  /** Raider seekers: heavy fighters, aces and bounty hunters carry them. */
  seekers: {
    classes: ['heavy-fighter'] as readonly string[],
    /** Seconds before a carrier's first launch, and between launches. */
    first: [6, 12] as const,
    every: [16, 26] as const,
    /** A launch needs the player in this band (m) and roughly ahead (radians). */
    range: [450, 1_700] as const,
    cone: 0.6,
    damage: 24,
    speed: 330,
    turnRate: 1.5,
    lifetime: 9,
  },
  /** Decoy flares: a consumable, like repair kits. */
  decoys: {
    name: 'Decoy flares',
    price: 45,
    max: 6,
    /** New ships come with this many. */
    starting: 2,
    /** Chance each seeker homing on the player within `range` goes for the flare instead. */
    chance: 0.8,
    range: 2_200,
    /** Seconds a flare burns, and between launches. */
    lifetime: 4,
    cooldown: 1.2,
  },
  /** Mines: raiders dump them when they break off; dens under attack have a few. */
  mines: {
    dropChance: 0.5,
    /** Seconds before a mine arms, and how long it lasts. */
    arm: 2,
    life: 150,
    /** It goes off when a ship comes this close (m); the blast reaches `blast` m. */
    trigger: 90,
    blast: 150,
    damage: 55,
    /** Hull: one or two bolts set it off. */
    hull: 12,
    /** Around a den's reactor. */
    atDens: 3,
  },
  /** Damage to the player's systems (engines, guns, shields) when the hull is hit. */
  systems: {
    /** Chance per point of hull damage that a system is hit, and how badly (0–1, adding up). */
    chancePerPoint: 0.012,
    severity: [0.3, 0.6] as const,
    /** At full damage: engines lose this share of speed, guns of fire rate, shields of recharge and capacity. */
    engines: 0.4,
    guns: 0.5,
    shields: { regen: 0.7, capacity: 0.4 },
    /** Dock repairs: credits per whole system at full damage (before standing discounts). */
    repairCost: 180,
  },
  /** Loot beyond credits: cargo pods and salvaged equipment from raiders. */
  loot: {
    podChance: 0.3,
    podGoods: ['salvage', 'weapons', 'stims', 'ship-parts', 'electronics'] as readonly string[],
    podQty: [2, 5] as const,
    /** Chance of an equipment crate, by raider threat level; aces always carry one. */
    gearChance: { 1: 0.04, 2: 0.08, 3: 0.14 } as Record<1 | 2 | 3, number>,
    /** Salvaged equipment the player can keep aboard until fitted or sold. */
    stash: 4,
  },
  /** Wingmen for hire in the bars. */
  wingmen: {
    max: 2,
    /** Fee per jump by ship class tier; hiring costs one fee up front. */
    fee: { 1: 180, 2: 320 } as Record<1 | 2, number>,
    /** Station types that have pilots looking for work (and how many). */
    where: { 'military-base': 2, 'trade-port': 1, freeport: 1, shipyard: 1 } as Record<string, number>,
    /** Their guns hit this hard (like other NPCs), by skill. */
    skill: { steady: 0.3, sharp: 0.38 } as Record<'steady' | 'sharp', number>,
  },
  /** Radio chatter: at most one line this often (seconds). */
  chatterEvery: 7,
} as const;
