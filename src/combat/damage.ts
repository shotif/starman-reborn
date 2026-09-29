/** Shield + hull damage model shared by the player and NPC ships. */
export interface Durability {
  hull: number;
  hullMax: number;
  shield: number;
  shieldMax: number;
  shieldRegen: number;
  shieldDelay: number;
  /** Seconds since the last hit (drives shield regeneration). */
  sinceHit: number;
}

export interface DamageResult {
  absorbedByShield: number;
  hullDamage: number;
  shieldBroke: boolean;
  destroyed: boolean;
}

/** Shields absorb damage first; the remainder hits the non-regenerating hull. */
export function applyDamage(d: Durability, amount: number): DamageResult {
  const before = d.shield;
  const absorbed = Math.min(d.shield, amount);
  d.shield -= absorbed;
  const hullDamage = amount - absorbed;
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
