import type { ShipParams } from '../flight/ShipBody.ts';
import { roundTo } from './random.ts';
import { DAMAGE_MATRIX } from './rules/balance.ts';
import { damageEffectiveness, shieldExposure } from './score.ts';
import type { EngineStats, GearItem, GunStats, LauncherStats, PowerStats, ShieldStats, ShipModel, ThrusterStats } from './types.ts';

/** Slot id → fitted gear id; a missing entry is an empty slot. */
export type Fittings = Readonly<Record<string, string | undefined>>;

/** What a ship does with a given set of fittings. */
export interface ShipPerformance {
  flight: ShipParams;
  hullMax: number;
  /** Hold size including cargo pods. */
  cargo: number;
  shield: ShieldStats | null;
  guns: readonly GunStats[];
  launchers: readonly LauncherStats[];
  /** Multiplier on scan and targeting range. */
  scanRange: number;
  /** Loose-cargo pickup range in metres (0 = no tractor beam). */
  tractorRange: number;
  /** Longest frontier lane the ship's long-range jump drive reaches, light-years (0: no drive). */
  jumpReach: number;
  /** Ore or ice cut per minute of mining beam (0: no mining laser). */
  miningRate: number;
  /** Yield multiplier from a prospecting scanner (1: none). */
  prospect: number;
  /** Passenger berths from cabins (docs/PROCGEN.md §23; 0: none). */
  berths: number;
}

/** Items that actually fit: the slot exists, the type matches and the class is within the limit. */
export function fittedItems(ship: ShipModel, fittings: Fittings, gearById: ReadonlyMap<string, GearItem>): { slotId: string; item: GearItem }[] {
  const out: { slotId: string; item: GearItem }[] = [];
  for (const slot of ship.slots) {
    const id = fittings[slot.id];
    const item = id ? gearById.get(id) : undefined;
    if (item && item.slot === slot.type && item.tier <= slot.maxClass) out.push({ slotId: slot.id, item });
  }
  return out;
}

export function shipPerformance(ship: ShipModel, fittings: Fittings, gearById: ReadonlyMap<string, GearItem>): ShipPerformance {
  let engine: EngineStats | null = null;
  let thruster: ThrusterStats | null = null;
  let power: PowerStats | null = null;
  let shield: ShieldStats | null = null;
  const guns: GunStats[] = [];
  const launchers: LauncherStats[] = [];
  let armour = 0;
  let agility = 1;
  let pods = 0;
  let berths = 0;
  let speedFactor = 1;
  let scanRange = 1;
  let tractorRange = 0;
  let jumpReach = 0;
  let miningRate = 0;
  let prospect = 1;
  for (const { item } of fittedItems(ship, fittings, gearById)) {
    const s = item.stats;
    switch (s.slot) {
      case 'gun':
        guns.push(s.gun);
        break;
      case 'launcher':
        launchers.push(s.launcher);
        break;
      case 'shield':
        shield = s.shield;
        break;
      case 'engine':
        engine = s.engine;
        break;
      case 'thruster':
        thruster = s.thruster;
        break;
      case 'power':
        power = s.power;
        break;
      case 'utility': {
        const u = s.utility;
        if (u.kind === 'armor') {
          armour += u.amount;
          agility *= 1 - u.penalty;
        } else if (u.kind === 'cargo-pod') {
          pods += u.amount;
          speedFactor *= 1 - u.penalty;
        } else if (u.kind === 'cabin') {
          berths += u.amount;
          speedFactor *= 1 - u.penalty;
        } else if (u.kind === 'scanner') scanRange = Math.max(scanRange, u.amount);
        else if (u.kind === 'tractor') tractorRange = Math.max(tractorRange, u.amount);
        else if (u.kind === 'jump-drive') jumpReach = Math.max(jumpReach, u.amount);
        else if (u.kind === 'mining-laser') miningRate += u.amount;
        else if (u.kind === 'prospector') prospect = Math.max(prospect, u.amount);
        break;
      }
    }
  }
  const maxSpeed = roundTo(ship.maxSpeed * speedFactor, 0.1);
  const turnRate = roundTo(ship.turnRate * agility, 0.01);
  const flight: ShipParams = {
    maxSpeed,
    reverseSpeed: Math.round(maxSpeed * 0.32),
    // No thruster: no boost. No engine: no cruise worth having.
    boostSpeed: thruster?.boostSpeed ?? 0,
    strafeSpeed: Math.round(maxSpeed * 0.41),
    cruiseSpeed: engine?.cruiseSpeed ?? maxSpeed,
    cruiseChargeTime: engine?.cruiseChargeTime ?? 3,
    linearResponse: roundTo(ship.linearResponse * (engine?.thrust ?? 0.8), 0.01),
    cruiseResponse: 0.8,
    maxTurnRate: turnRate,
    cruiseTurnRate: roundTo(turnRate * 0.355, 0.01),
    angularResponse: roundTo(ship.angularResponse * agility, 0.1),
    autoLevelRate: 1.4,
    energyMax: Math.round((power?.energyMax ?? 0) * ship.power),
    energyRegen: roundTo((power?.energyRegen ?? 0) * ship.power, 0.1),
    boostDrain: thruster?.boostDrain ?? 0,
    radius: ship.radius,
  };
  return { flight, hullMax: ship.hull + armour, cargo: ship.cargo + pods, shield, guns, launchers, scanRange, tractorRange, jumpReach, miningRate, prospect, berths };
}

/** Share of the time the guns can fire over a fight of `seconds`: full until energy runs dry, then what regeneration allows. */
export function sustainedFire(p: ShipPerformance, seconds: number): number {
  const drain = p.guns.reduce((sum, g) => sum + g.energyPerShot * g.shotsPerSecond, 0);
  if (drain <= 0) return 1;
  return Math.min(1, (p.flight.energyRegen + p.flight.energyMax / seconds) / drain);
}

/**
 * Seconds `attacker` needs to destroy `defender` with guns alone at `hitRate`: shields first, then
 * hull, with each damage type's multipliers. Shield regeneration and missiles are ignored.
 */
export function duelSeconds(attacker: ShipPerformance, defender: ShipPerformance, hitRate: number): number {
  let seconds = 20;
  for (let i = 0; i < 4; i++) {
    const fire = sustainedFire(attacker, seconds) * hitRate;
    let vsShield = 0;
    let vsHull = 0;
    for (const g of attacker.guns) {
      const dps = g.damage * g.shotsPerSecond * fire;
      if (defender.shield) vsShield += dps * DAMAGE_MATRIX[g.damageType][defender.shield.shieldType];
      vsHull += dps * DAMAGE_MATRIX[g.damageType].hull;
    }
    if (vsHull <= 0 || (defender.shield && vsShield <= 0)) return Infinity;
    seconds = (defender.shield ? defender.shield.capacity / vsShield : 0) + defender.hullMax / vsHull;
  }
  return seconds;
}

/** One number for fighting strength: √(sustained damage × toughness), scaled by agility. */
export function combatRating(p: ShipPerformance): number {
  const dps = p.guns.reduce((sum, g) => sum + g.damage * g.shotsPerSecond * damageEffectiveness(g.damageType), 0) * sustainedFire(p, 20);
  const toughness = p.hullMax + (p.shield ? p.shield.capacity / shieldExposure(p.shield.shieldType) : 0);
  return Math.sqrt(dps * toughness) * Math.sqrt(p.flight.maxTurnRate / 1.55);
}
