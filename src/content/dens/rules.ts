/**
 * Raider dens under fire (docs/PROCGEN.md §14.3): the defences of a den under assault, the wing
 * that flies with the player, and the sweep that comes for a den. The numbers are game balance,
 * not fact.
 */
export const DENS = {
  /** A den whose reactor went down stays dark this long (game-clock seconds), then the Wake rebuilds it. */
  downSeconds: 6 * 3600,
  /** Gun turrets around a den under assault: each must go before the reactor can be hit. */
  turrets: 3,
  turret: { hull: 240, shield: 90, range: 1_500, damage: 5, shotsPerSecond: 1.6, projectileSpeed: 820 },
  /** Turrets stand this far out from the den's surface. */
  turretStandoff: 260,
  reactor: { hull: 900 },
  /** Raiders defending a den under assault (pack threat level and size). */
  guards: { level: 2 as const, count: 2 },
  /** Lawful ships flying with the player on an assault (the Transit Authority's wing). */
  wing: { count: 3, model: 'ship.light-fighter.1.halden' },
  /** A den wakes its defences when a pilot it does not trust comes this close (m). */
  alert: 6_000,
  /** Knocking a den out on your own: the nearest lawful faction pays this and thinks better of you; the Wake does not. */
  bounty: 2_500,
  bountyStanding: 8,
  wakeStanding: -15,
  /** Each turret destroyed pays a bounty too. */
  turretBounty: 150,
  /** A sweep coming for a den: waves of lawful ships from the jump beacon. */
  sweep: { waves: 2, models: ['ship.light-fighter.1.halden', 'ship.heavy-fighter.1.ares'], defenders: 2 },
} as const;
