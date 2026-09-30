import { maker, shipClass } from '../../content/catalog.ts';
import type { ShipPerformance } from '../../content/loadout.ts';
import { ROMAN } from '../../content/random.ts';
import type { GearItem, ShipModel, ShipSlot } from '../../content/types.ts';
import type { GlyphName } from '../glyphs.ts';

/** Short labels and one-line stat summaries for ships and equipment in the dealer windows. */

const SLOT_NAME: Record<ShipSlot['type'], string> = {
  gun: 'Gun mount',
  launcher: 'Launcher',
  shield: 'Shield',
  engine: 'Engine',
  thruster: 'Thruster',
  power: 'Power plant',
  utility: 'Utility bay',
};

/** "Gun mount 2", "Shield", "Utility bay 1". */
export function slotLabel(slot: ShipSlot, slots: readonly ShipSlot[]): string {
  const same = slots.filter((s) => s.type === slot.type);
  if (same.length <= 1 && slot.type !== 'gun' && slot.type !== 'utility') return SLOT_NAME[slot.type];
  return `${SLOT_NAME[slot.type]} ${same.indexOf(slot) + 1}`;
}

export function slotGlyph(slot: ShipSlot, item?: GearItem): GlyphName {
  if (item) return gearGlyph(item);
  switch (slot.type) {
    case 'gun':
      return 'gun';
    case 'launcher':
      return 'missile';
    case 'shield':
      return 'shieldgen';
    case 'engine':
      return 'engine';
    case 'thruster':
      return 'thruster';
    case 'power':
      return 'power';
    case 'utility':
      return 'outfitter';
  }
}

export function gearGlyph(item: GearItem): GlyphName {
  const s = item.stats;
  switch (s.slot) {
    case 'gun':
      return 'gun';
    case 'launcher':
      return 'missile';
    case 'shield':
      return 'shieldgen';
    case 'engine':
      return 'engine';
    case 'thruster':
      return 'thruster';
    case 'power':
      return 'power';
    case 'utility':
      return s.utility.kind === 'cargo-pod' ? 'cargopod' : s.utility.kind;
  }
}

const TYPE_LABEL = { energy: 'energy', kinetic: 'kinetic', plasma: 'plasma', ion: 'ion' } as const;

/** The numbers that matter for comparing items of one slot, in a few words. */
export function gearStats(item: GearItem): string {
  const s = item.stats;
  switch (s.slot) {
    case 'gun':
      return `${s.gun.damage} ${TYPE_LABEL[s.gun.damageType]} × ${s.gun.shotsPerSecond}/s · ${s.gun.range} m`;
    case 'shield':
      return `${s.shield.capacity} ${s.shield.shieldType} · +${s.shield.regenPerSecond}/s`;
    case 'launcher':
      return `${s.launcher.damage} dmg · ${s.launcher.turnRate > 0 ? 'guided' : 'unguided'} · ${s.launcher.maxAmmo} rounds`;
    case 'engine':
      return `cruise ${s.engine.cruiseSpeed} m/s · accel ×${s.engine.thrust}`;
    case 'thruster':
      return `boost +${s.thruster.boostSpeed} m/s · ${s.thruster.boostDrain} energy/s`;
    case 'power':
      return `${s.power.energyMax} energy · +${s.power.energyRegen}/s`;
    case 'utility': {
      const u = s.utility;
      if (u.kind === 'armor') return `+${u.amount} hull · turning −${Math.round(u.penalty * 100)}%`;
      if (u.kind === 'cargo-pod') return `+${u.amount} cargo · speed −${Math.round(u.penalty * 100)}%`;
      if (u.kind === 'scanner') return `scan range ×${u.amount}`;
      if (u.kind === 'jump-drive') return `frontier lanes to ${u.amount} ly`;
      if (u.kind === 'mining-laser') return `cuts ${u.amount}/min`;
      if (u.kind === 'prospector') return `yield ×${u.amount}`;
      return `pulls cargo from ${u.amount} m`;
    }
  }
}

/** "Halden · class 2 · 11.5 energy × 2.75/s · 970 m" */
export function gearLine(item: GearItem): string {
  return `${maker(item.maker).short} · class ${item.tier} · ${gearStats(item)}`;
}

/** "Courier Mk II" */
export function shipKind(model: ShipModel): string {
  return `${shipClass(model.class).name} Mk ${ROMAN[model.tier]}`;
}

/** "hull 128 · cargo 25 · 2 guns · 112 m/s" */
export function shipStatsLine(perf: ShipPerformance): string {
  const guns = perf.guns.length;
  return `hull ${perf.hullMax} · cargo ${perf.cargo} · ${guns} gun${guns === 1 ? '' : 's'} · ${Math.round(perf.flight.maxSpeed)} m/s`;
}
