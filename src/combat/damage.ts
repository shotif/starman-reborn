import { DAMAGE_MATRIX } from '../content/rules/balance.ts';
import type { DamageType, ShieldType } from '../content/types.ts';

/** Shield + hull damage model shared by the player and NPC ships. */
export interface Durability {
  hull: number;
  hullMax: number;
  shield: number;
  shieldMax: number;
  shieldRegen: number;
  shieldDelay: number;
  /** How the shield reacts to damage types (balanced when absent). */
  shieldType?: ShieldType;
  /** Seconds since the last hit (drives shield regeneration). */
  sinceHit: number;
}

export interface DamageResult {
  absorbedByShield: number;
  hullDamage: number;
  shieldBroke: boolean;
  destroyed: boolean;
}

/**
 * Shields absorb damage first; the remainder hits the non-regenerating hull. With a damage type,
 * the damage matrix scales what the shield takes and what reaches the hull.
 */
export function applyDamage(d: Durability, amount: number, type?: DamageType): DamageResult {
  const row = type ? DAMAGE_MATRIX[type] : null;
  const onShield = row ? row[d.shieldType ?? 'balanced'] : 1;
  const onHull = row ? row.hull : 1;
  const before = d.shield;
  const absorbed = Math.min(d.shield, amount * onShield);
  d.shield -= absorbed;
  // The part of the hit the shield did not stop reaches the hull.
  const unabsorbed = onShield > 0 ? amount - absorbed / onShield : amount;
  const hullDamage = unabsorbed * onHull;
  d.hull = Math.max(0, d.hull - hullDamage);
  d.sinceHit = 0;
  return {
    absorbedByShield: absorbed,
    hullDamage,
    shieldBroke: before > 0 && d.shield <= 0,
    destroyed: d.hull <= 0,
  };
}

/** Regenerates shields after the delay. Hull never regenerates. */
export function regenerate(d: Durability, dt: number): void {
  d.sinceHit += dt;
  if (d.hull <= 0) return;
  if (d.sinceHit >= d.shieldDelay && d.shield < d.shieldMax) {
    d.shield = Math.min(d.shieldMax, d.shield + d.shieldRegen * dt);
  }
}
