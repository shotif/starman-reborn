import { DAMAGE_MATRIX, REFERENCE_FAMILY, SHIELD_SHARE, SHIP_WEIGHTS } from './rules/balance.ts';
import type {
  ContentRules,
  DamageType,
  EngineStats,
  GearFamilyRule,
  GearStats,
  GunStats,
  LauncherStats,
  PowerStats,
  ShieldStats,
  ShieldType,
  ShipClassRule,
  ShipModel,
  Tier,
  ThrusterStats,
  UtilityStats,
} from './types.ts';

/**
 * Power scores: one number per item that the generator budgets and the guardrails check
 * (docs/PROCGEN.md §4.1). Scores compare items within a slot; they mean nothing across slots.
 */

export const TIERS: readonly Tier[] = [1, 2, 3, 4, 5];
export const SHIELD_TYPES: readonly ShieldType[] = ['deflector', 'diffuser', 'balanced'];
/** Damage types that trade blows with shields (ion is the specialist). */
export const MAIN_DAMAGE_TYPES: readonly DamageType[] = ['energy', 'kinetic', 'plasma'];

/** Average damage multiplier of a damage type in a typical fight (shields first, then hull). */
export function damageEffectiveness(type: DamageType): number {
  const m = DAMAGE_MATRIX[type];
  const shields = (m.deflector + m.diffuser + m.balanced) / 3;
  return SHIELD_SHARE * shields + (1 - SHIELD_SHARE) * m.hull;
}

/** Average damage multiplier a shield type takes from the main damage types (lower is better). */
export function shieldExposure(type: ShieldType): number {
  return MAIN_DAMAGE_TYPES.reduce((sum, d) => sum + DAMAGE_MATRIX[d][type], 0) / MAIN_DAMAGE_TYPES.length;
}

/** Damage per second, weighted by accuracy (bolt speed), reach and energy economy. */
export function gunScore(g: GunStats): number {
  const energyPerSecond = g.energyPerShot * g.shotsPerSecond;
  return (
    g.damage *
    g.shotsPerSecond *
    damageEffectiveness(g.damageType) *
    (g.projectileSpeed / 800) ** 0.35 *
    (g.range / 1000) ** 0.25 *
    (14 / energyPerSecond) ** 0.25
  );
}

/** Effective capacity, with credit for fast recharge. */
export function shieldScore(s: ShieldStats): number {
  return (s.capacity / shieldExposure(s.shieldType)) * ((10 * s.regenPerSecond) / s.capacity) ** 0.3 * (3 / s.regenDelay) ** 0.2;
}

/** Damage per missile, with credit for guidance and speed. */
export function launcherScore(l: Pick<LauncherStats, 'damage' | 'speed' | 'turnRate'>): number {
  return l.damage * (1 + 0.1 * l.turnRate) * (l.speed / 300) ** 0.3;
}

export function engineScore(e: EngineStats): number {
  return (e.cruiseSpeed / 620) * e.thrust ** 0.5 * (1.8 / e.cruiseChargeTime) ** 0.25;
}

export function thrusterScore(t: ThrusterStats): number {
  return (t.boostSpeed / 95) * (28 / t.boostDrain) ** 0.5;
}

export function powerScore(p: PowerStats): number {
  return (p.energyMax / 100) ** 0.4 * (p.energyRegen / 20) ** 0.6;
}

export function utilityScore(u: Pick<UtilityStats, 'amount'>, baseAmount: number): number {
  return u.amount / baseAmount;
}

export function gearScore(stats: GearStats, family: GearFamilyRule): number {
  switch (stats.slot) {
    case 'gun':
      return gunScore(stats.gun);
    case 'shield':
      return shieldScore(stats.shield);
    case 'launcher':
      return launcherScore(stats.launcher);
    case 'engine':
      return engineScore(stats.engine);
    case 'thruster':
      return thrusterScore(stats.thruster);
    case 'power':
      return powerScore(stats.power);
    case 'utility':
      return utilityScore(stats.utility, family.slot === 'utility' ? family.base.amount : 1);
  }
}

/** Score of a family's class 1 item with neutral traits. */
export function baseScore(f: GearFamilyRule): number {
  switch (f.slot) {
    case 'gun':
      return gunScore({ ...f.base, damageType: f.damageType });
    case 'shield':
      return shieldScore({ ...f.base, shieldType: f.shieldType });
    case 'launcher':
      return launcherScore(f.base);
    case 'engine':
      return engineScore(f.base);
    case 'thruster':
      return thrusterScore(f.base);
    case 'power':
      return powerScore(f.base);
    case 'utility':
      return 1;
  }
}

/** The family whose class curve a family is held to: itself, or its slot's reference family. */
export function budgetFamily(f: GearFamilyRule, rules: ContentRules): GearFamilyRule {
  const refId = REFERENCE_FAMILY[f.slot];
  return (refId && rules.families.find((x) => x.id === refId)) || f;
}

/** Target score of a family's item of class `tier`. */
export function targetScore(f: GearFamilyRule, tier: Tier, rules: ContentRules): number {
  const ref = budgetFamily(f, rules);
  return baseScore(ref) * ref.growth ** (tier - 1);
}

/** A ship's frame budget: stats relative to its class's Mk I baseline, as a weighted geometric mean. */
export function shipFrameScore(ship: Pick<ShipModel, 'hull' | 'turnRate' | 'maxSpeed' | 'cargo' | 'power'>, cls: ShipClassRule): number {
  const b = cls.base;
  const w = SHIP_WEIGHTS;
  return (
    (ship.hull / b.hull) ** w.hull *
    (ship.turnRate / b.turnRate) ** w.agility *
    (ship.maxSpeed / b.maxSpeed) ** w.speed *
    (ship.cargo / b.cargo) ** w.cargo *
    (ship.power / b.power) ** w.power
  );
}

export function shipFrameTarget(cls: ShipClassRule, tier: Tier): number {
  const g = cls.growth;
  const w = SHIP_WEIGHTS;
  return (g.hull ** w.hull * g.handling ** (w.agility + w.speed) * g.cargo ** w.cargo * g.power ** w.power) ** (tier - 1);
}
