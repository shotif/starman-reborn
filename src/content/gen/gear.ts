import { DAMAGE_MATRIX } from '../rules/balance.ts';
import { ROMAN, roundPrice, roundTo } from '../random.ts';
import { engineScore, gearScore, gunScore, launcherScore, powerScore, shieldScore, targetScore } from '../score.ts';
import type {
  ContentRules,
  DamageType,
  GearFamilyRule,
  GearItem,
  GearStats,
  ManufacturerRule,
  MakerTraits,
  ShieldType,
  Tier,
} from '../types.ts';

/**
 * Equipment generator: every (maker, family, class) the rules list becomes one item. Secondary
 * stats come from the family's base, its per-class drift and the maker's traits; the primary stat
 * is then solved so the item's score hits its class target (docs/PROCGEN.md §4.1).
 */
export function generateGear(rules: ContentRules): GearItem[] {
  const out: GearItem[] = [];
  for (const maker of rules.makers) {
    for (const [familyId, tiers] of Object.entries(maker.gear) as [GearItem['family'], readonly Tier[]][]) {
      const family = rules.families.find((f) => f.id === familyId);
      if (!family) continue; // reported by the validator
      for (const tier of tiers) out.push(makeItem(family, tier, maker, rules));
    }
  }
  return out;
}

export function gearId(family: string, tier: Tier, maker: string): string {
  return `gear.${family}.${tier}.${maker}`;
}

function makeItem(family: GearFamilyRule, tier: Tier, maker: ManufacturerRule, rules: ContentRules): GearItem {
  const target = targetScore(family, tier, rules);
  const stats = solveStats(family, tier, maker.traits, target);
  const line = maker.names.gear[family.id] ?? maker.short;
  return {
    id: gearId(family.id, tier, maker.id),
    family: family.id,
    slot: family.slot,
    maker: maker.id,
    tier,
    name: `${line} Mk ${ROMAN[tier]} ${family.noun}`,
    short: `${line} Mk ${ROMAN[tier]}`,
    price: roundPrice(family.basePrice * family.priceGrowth ** (tier - 1) * (maker.traits.price ?? 1)),
    score: gearScore(stats, family),
    stats,
    description: `${family.flavour} ${describeStats(stats)}`,
  };
}

const t = (traits: MakerTraits, key: keyof MakerTraits): number => traits[key] ?? 1;

/** Damage per shot reads 8.5, 12, 45, 120. */
const roundDamage = (v: number): number => roundTo(v, v < 20 ? 0.5 : v < 100 ? 1 : 5);

function solveStats(f: GearFamilyRule, tier: Tier, traits: MakerTraits, target: number): GearStats {
  const k = tier - 1;
  switch (f.slot) {
    case 'gun': {
      const partial = {
        shotsPerSecond: roundTo(f.base.shotsPerSecond * t(traits, 'fireRate'), 0.05),
        projectileSpeed: roundTo(f.base.projectileSpeed * f.drift.projectileSpeed ** k * t(traits, 'velocity'), 10),
        range: roundTo(f.base.range * f.drift.range ** k, 10),
        energyPerShot: roundTo((f.base.energyPerShot * f.drift.energyPerShot ** k) / t(traits, 'efficiency'), 0.1),
        damageType: f.damageType,
      };
      const perDamage = gunScore({ ...partial, damage: 1 });
      return { slot: 'gun', gun: { ...partial, damage: roundDamage(target / perDamage) } };
    }
    case 'shield': {
      const regenDelay = roundTo(f.base.regenDelay * f.drift.regenDelay ** k, 0.05);
      const regenShare = (f.base.regenPerSecond / f.base.capacity) * t(traits, 'shieldRegen');
      const perCapacity = shieldScore({ capacity: 1, regenPerSecond: regenShare, regenDelay, shieldType: f.shieldType });
      const raw = target / perCapacity;
      const capacity = roundTo(raw, raw < 100 ? 1 : 5);
      return { slot: 'shield', shield: { capacity, regenPerSecond: roundTo(capacity * regenShare, 0.1), regenDelay, shieldType: f.shieldType } };
    }
    case 'launcher': {
      const speed = roundTo(f.base.speed * f.drift.speed ** k * t(traits, 'velocity'), 5);
      const turnRate = roundTo(f.base.turnRate * f.drift.turnRate ** k, 0.05);
      const damage = roundTo(target / launcherScore({ damage: 1, speed, turnRate }), 1);
      return {
        slot: 'launcher',
        launcher: {
          kind: f.kind,
          damage,
          speed,
          turnRate,
          lifetime: f.base.lifetime,
          lockTime: f.base.lockTime,
          maxAmmo: f.base.maxAmmo,
          ammoPrice: roundPrice(f.base.ammoPrice * f.drift.ammoPrice ** k * t(traits, 'price')),
        },
      };
    }
    case 'engine': {
      const cruiseSpeed = roundTo(f.base.cruiseSpeed * f.drift.cruiseSpeed ** k * t(traits, 'cruise'), 5);
      const cruiseChargeTime = roundTo(f.base.cruiseChargeTime * f.drift.cruiseChargeTime ** k, 0.05);
      const rest = engineScore({ cruiseSpeed, cruiseChargeTime, thrust: 1 });
      return { slot: 'engine', engine: { cruiseSpeed, cruiseChargeTime, thrust: roundTo((target / rest) ** 2, 0.01) } };
    }
    case 'thruster': {
      const boostDrain = roundTo(f.base.boostDrain / t(traits, 'efficiency'), 0.5);
      const boostSpeed = roundTo((target * 95) / (28 / boostDrain) ** 0.5, 1);
      return { slot: 'thruster', thruster: { boostSpeed, boostDrain } };
    }
    case 'power': {
      // Efficient plants trade a smaller store for faster regeneration.
      const e = t(traits, 'efficiency');
      const scale = target / powerScore({ energyMax: f.base.energyMax / e, energyRegen: f.base.energyRegen * e });
      return {
        slot: 'power',
        power: { energyMax: roundTo((f.base.energyMax / e) * scale, 1), energyRegen: roundTo(f.base.energyRegen * e * scale, 0.1) },
      };
    }
    case 'utility': {
      const step = f.kind === 'scanner' || f.kind === 'prospector' ? 0.05 : f.kind === 'tractor' ? 10 : f.kind === 'jump-drive' ? 0.1 : 1;
      return { slot: 'utility', utility: { kind: f.kind, amount: roundTo(f.base.amount * target, step), penalty: f.base.penalty } };
    }
  }
}

// ---------------------------------------------------------------- descriptions

const DAMAGE_LABEL: Record<DamageType, string> = { energy: 'energy', kinetic: 'kinetic', plasma: 'plasma', ion: 'ion' };
const SHIELD_LABEL: Record<ShieldType, string> = { deflector: 'deflector', diffuser: 'diffuser', balanced: 'balanced' };

/** "Strong against deflector shields; weak against diffusers." from the damage matrix. */
export function counterText(type: DamageType): string {
  const row = DAMAGE_MATRIX[type];
  const strong = (['deflector', 'diffuser', 'balanced'] as const).filter((s) => row[s] >= 1.2).map((s) => `${SHIELD_LABEL[s]}`);
  const weak = (['deflector', 'diffuser', 'balanced'] as const).filter((s) => row[s] <= 0.8).map((s) => `${SHIELD_LABEL[s]}`);
  const parts: string[] = [];
  if (strong.length) parts.push(`Strong against ${list(strong)} shields`);
  if (weak.length) parts.push(`weak against ${list(weak)} shields`);
  if (row.hull >= 1.15) parts.push('hits hulls hard');
  else if (row.hull <= 0.5) parts.push('barely scratches hulls');
  if (!parts.length) return '';
  const text = parts.join('; ');
  return `${text[0]!.toUpperCase()}${text.slice(1)}.`;
}

/** What a shield type resists and what gets through. */
export function resistText(type: ShieldType): string {
  const resists = (['energy', 'kinetic', 'plasma'] as const).filter((d) => DAMAGE_MATRIX[d][type] <= 0.8).map((d) => DAMAGE_LABEL[d]);
  const weak = (['energy', 'kinetic', 'plasma'] as const).filter((d) => DAMAGE_MATRIX[d][type] >= 1.2).map((d) => DAMAGE_LABEL[d]);
  if (!resists.length && !weak.length) return 'No strengths or weaknesses.';
  return [resists.length ? `Resists ${list(resists)}` : '', weak.length ? `${resists.length ? 'weak' : 'Weak'} against ${list(weak)}` : '']
    .filter(Boolean)
    .join('; ')
    .concat('.');
}

function list(words: readonly string[]): string {
  return words.length <= 1 ? (words[0] ?? '') : `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`;
}

const pct = (v: number): string => `${Math.round(v * 100)}%`;

/** Facts generated from the stats (never hand-written, so they cannot drift from the numbers). */
export function describeStats(stats: GearStats): string {
  switch (stats.slot) {
    case 'gun': {
      const g = stats.gun;
      return `${g.damage} ${DAMAGE_LABEL[g.damageType]} damage per shot, ${g.shotsPerSecond} shots/s, ${g.range} m range, ${g.energyPerShot} energy per shot. ${counterText(g.damageType)}`.trim();
    }
    case 'shield': {
      const s = stats.shield;
      return `${s.capacity} capacity, recharges ${s.regenPerSecond}/s after ${s.regenDelay} s. ${resistText(s.shieldType)}`;
    }
    case 'launcher': {
      const l = stats.launcher;
      const guide = l.turnRate > 0 ? `locks on in ${l.lockTime} s` : 'unguided';
      return `${l.damage} damage per hit, ${guide}, carries ${l.maxAmmo} at ${l.ammoPrice} cr each.`;
    }
    case 'engine': {
      const e = stats.engine;
      return `Cruise ${e.cruiseSpeed} m/s after a ${e.cruiseChargeTime} s spin-up; acceleration ×${e.thrust}.`;
    }
    case 'thruster': {
      const th = stats.thruster;
      return `Boost +${th.boostSpeed} m/s for ${th.boostDrain} energy per second.`;
    }
    case 'power': {
      const p = stats.power;
      return `${p.energyMax} energy stored, ${p.energyRegen} regenerated per second.`;
    }
    case 'utility': {
      const u = stats.utility;
      switch (u.kind) {
        case 'armor':
          return `+${u.amount} hull; turning −${pct(u.penalty)}.`;
        case 'cargo-pod':
          return `+${u.amount} cargo; top speed −${pct(u.penalty)}.`;
        case 'cabin':
          return `${u.amount} passenger berths; top speed −${pct(u.penalty)}.`;
        case 'scanner':
          return `Scan range ×${u.amount}.`;
        case 'tractor':
          return `Pulls in loose cargo from ${u.amount} m.`;
        case 'jump-drive':
          return `Jumps frontier lanes up to ${u.amount} ly long.`;
        case 'mining-laser':
          return `Cuts ${u.amount} units of ore or ice a minute from rock.`;
        case 'prospector':
          return `Rocks yield ×${u.amount}.`;
      }
    }
  }
}
