import type { FactionId, SystemId } from '../data/types.ts';

/**
 * Types for the rule-driven content catalogue (ships and equipment). Rules live in
 * src/content/rules/, generators in src/content/gen/, guardrails in src/content/validate.ts.
 * See docs/PROCGEN.md.
 */

export type ManufacturerId = 'halden' | 'ares' | 'toliman' | 'horizon' | 'eridani' | 'wake';
export type ShipClassId = 'courier' | 'light-fighter' | 'heavy-fighter' | 'gunship' | 'freighter' | 'surveyor';
/** Equipment class (1–5) or ship model tier (Mk I–V). */
export type Tier = 1 | 2 | 3 | 4 | 5;
export type DamageType = 'energy' | 'kinetic' | 'plasma' | 'ion';
export type ShieldType = 'deflector' | 'diffuser' | 'balanced';
export type SlotType = 'gun' | 'launcher' | 'shield' | 'engine' | 'thruster' | 'power' | 'utility';
export type LauncherKind = 'rocket' | 'seeker' | 'torpedo';
export type UtilityKind = 'armor' | 'cargo-pod' | 'cabin' | 'scanner' | 'tractor' | 'jump-drive' | 'mining-laser' | 'prospector';

export type GearFamilyId =
  | 'pulse'
  | 'mass-driver'
  | 'plasma'
  | 'ion'
  | 'rocket-pod'
  | 'seeker'
  | 'torpedo'
  | 'shield-deflector'
  | 'shield-diffuser'
  | 'shield-balanced'
  | 'engine'
  | 'thruster'
  | 'power'
  | 'armor'
  | 'cargo-pod'
  | 'cabin'
  | 'scanner'
  | 'tractor'
  | 'jump-drive'
  | 'mining-laser'
  | 'prospector';

// ---------------------------------------------------------------- rules

/** Visual language handed to the ship art generator. */
export interface ShipStyle {
  /** Main hull, secondary panels, accent stripes, engine glow (sRGB hex). */
  palette: { hull: string; panel: string; accent: string; glow: string };
  /** Overall silhouette family. */
  silhouette: 'wedge' | 'blade' | 'block' | 'pod' | 'ring' | 'splice';
  /** 0 = smooth, 1 = heavily plated. */
  greeble: number;
  /** Wing or fin arrangement. */
  wings: 'delta' | 'swept' | 'straight' | 'twin-boom' | 'none' | 'asymmetric';
  /** Short description for designers. */
  note: string;
}

/**
 * A maker's tendencies, as multipliers (1 = neutral). The generator trades each one against the
 * item's primary stat, so a tendency changes an item's character but never its power budget.
 */
export interface MakerTraits {
  // Ships: traded against hull points.
  hull?: number;
  /** Turn rate and turn response. */
  agility?: number;
  /** Top speed. */
  speed?: number;
  cargo?: number;
  /** Size of the capacitor bank (multiplies the fitted power plant). */
  power?: number;
  // Equipment: traded against the item's primary stat (gun damage, shield capacity, ...).
  /** Guns: shots per second (damage per shot compensates). */
  fireRate?: number;
  /** Guns and launchers: projectile speed. */
  velocity?: number;
  /** Guns: less energy per shot. Power plants: faster regeneration. Thrusters: less drain. */
  efficiency?: number;
  /** Shields: regeneration rate (capacity compensates). */
  shieldRegen?: number;
  /** Engines: cruise speed (acceleration compensates). */
  cruise?: number;
  /** Everything they sell. */
  price?: number;
}

export interface NamePools {
  /** Words ships are named after (one per model, never reused). */
  ships: readonly string[];
  /** Product-line words for the equipment families this maker builds. */
  gear: Partial<Record<GearFamilyId, string>>;
}

export interface ManufacturerRule {
  id: ManufacturerId;
  name: string;
  /** Prefix of ship names ("Halden Petrel"). */
  short: string;
  homeSystem: SystemId;
  /** Home station where the full range is sold (null = not sold to the player yet). */
  homeLocation: string | null;
  factionId: FactionId;
  /** Design philosophy (fiction), shown in the shipyard. */
  blurb: string;
  /** A few words on how its ships feel; ends ship descriptions ("Armoured and hard-hitting"). */
  tendency: string;
  traits: MakerTraits;
  /** Ship classes built, with the model tiers offered. */
  ships: Partial<Record<ShipClassId, readonly Tier[]>>;
  /**
   * Equipment families built, with the classes offered. Order matters: a maker's first gun and
   * shield families are what its ships come fitted with.
   */
  gear: Partial<Record<GearFamilyId, readonly Tier[]>>;
  names: NamePools;
  style: ShipStyle;
}

export interface ShipClassRule {
  id: ShipClassId;
  name: string;
  role: string;
  /** Baseline stats of a Mk I model; higher tiers scale them (see `growth`). */
  base: {
    hull: number;
    cargo: number;
    /** Collision radius and rough size. */
    radius: number;
    maxSpeed: number;
    turnRate: number;
    angularResponse: number;
    linearResponse: number;
    /** Capacitor bank: multiplies the fitted power plant's capacity and regeneration. */
    power: number;
  };
  /** Per-tier multipliers. */
  growth: { hull: number; cargo: number; power: number; handling: number };
  /** Number of slots per model tier (index 0 = Mk I). */
  slots: {
    gun: readonly number[];
    launcher: readonly number[];
    utility: readonly number[];
  };
  /** Highest equipment class a Mk I model's slots take; every tier above adds one (max 5). */
  maxClass: Partial<Record<SlotType, Tier>> & { default: Tier };
  /** Launcher the stock loadout prefers. */
  stockLauncher: LauncherKind;
  /** Utility fittings of the stock loadout, in slot order (extra slots stay empty). */
  stockUtility: readonly UtilityKind[];
  /** Hull price of a Mk I model before the maker's price trait. */
  basePrice: number;
}

interface FamilyCommon {
  id: GearFamilyId;
  /** Noun used in item names ("pulse cannon"). */
  noun: string;
  /** Score multiplier per class (the tier target grows by this). */
  growth: number;
  /** Smallest score step allowed between consecutive classes of one maker's line (guardrail). */
  minTierStep: number;
  /** Price of a class-1 item before the maker's price trait. */
  basePrice: number;
  /** Price multiplier per class. */
  priceGrowth: number;
  /** One line of flavour placed before the generated facts. */
  flavour: string;
}

export interface GunFamilyRule extends FamilyCommon {
  slot: 'gun';
  damageType: DamageType;
  base: { damage: number; shotsPerSecond: number; projectileSpeed: number; range: number; energyPerShot: number };
  /** Per-class multipliers for secondary stats (damage is solved from the budget). */
  drift: { projectileSpeed: number; range: number; energyPerShot: number };
}

export interface ShieldFamilyRule extends FamilyCommon {
  slot: 'shield';
  shieldType: ShieldType;
  base: { capacity: number; regenPerSecond: number; regenDelay: number };
  drift: { regenDelay: number };
}

export interface LauncherFamilyRule extends FamilyCommon {
  slot: 'launcher';
  kind: LauncherKind;
  base: { damage: number; speed: number; turnRate: number; lifetime: number; lockTime: number; maxAmmo: number; ammoPrice: number };
  drift: { speed: number; turnRate: number; ammoPrice: number };
}

export interface EngineFamilyRule extends FamilyCommon {
  slot: 'engine';
  base: { cruiseSpeed: number; cruiseChargeTime: number; thrust: number };
  drift: { cruiseSpeed: number; cruiseChargeTime: number };
}

export interface ThrusterFamilyRule extends FamilyCommon {
  slot: 'thruster';
  base: { boostSpeed: number; boostDrain: number };
}

export interface PowerFamilyRule extends FamilyCommon {
  slot: 'power';
  base: { energyMax: number; energyRegen: number };
}

export interface UtilityFamilyRule extends FamilyCommon {
  slot: 'utility';
  kind: UtilityKind;
  base: { amount: number; penalty: number };
}

export type GearFamilyRule =
  | GunFamilyRule
  | ShieldFamilyRule
  | LauncherFamilyRule
  | EngineFamilyRule
  | ThrusterFamilyRule
  | PowerFamilyRule
  | UtilityFamilyRule;

/** What a station's dealers carry. */
export interface ShopRule {
  locationId: string;
  /** Makers whose equipment the outfitter sells (empty = consumables only). */
  makers: readonly ManufacturerId[];
  /** Highest equipment class on sale. */
  maxClass: Tier;
  /** Ship classes the shipyard sells (from the makers above); empty = no shipyard. */
  shipyard: readonly ShipClassId[];
  maxShipTier: Tier;
}

/** Numbers the generators and guardrails share (rules/balance.ts). */
export interface BalanceRules {
  /** Allowed distance of an item's score from its tier target (0.1 = ±10%). */
  gearBand: number;
  shipBand: number;
  /** Same-tier items of one family cost within this fraction of the family-tier median. */
  priceBand: number;
  /** Share of purchase value paid back when selling ships or equipment. */
  resale: number;
  /** Hit rate assumed by the time-to-kill guardrail. */
  hitRate: number;
  /** Seconds a stock, tier-matched duel of one class may last. */
  duelSeconds: { min: number; max: number };
  /** A ship two tiers up must kill at least this many times faster than it dies. */
  tierGapAdvantage: number;
  /** Largest and smallest allowed maker trait. */
  traitRange: { min: number; max: number };
  /** Standing needed with the station's faction to buy equipment of a class / ships of a tier. */
  standingForClass: Record<Tier, number>;
  standingForShipTier: Record<Tier, number>;
  /** Hull price multiplier per ship tier. */
  shipPriceGrowth: number;
}

/** Envelope the flight model, autopilot and docking are tuned for. */
export interface FlightLimits {
  maxSpeed: { min: number; max: number };
  turnRate: { min: number; max: number };
  angularResponse: { min: number; max: number };
  boostSpeed: { max: number };
  cruiseSpeed: { max: number };
  radius: { max: number };
}

export interface ContentRules {
  makers: readonly ManufacturerRule[];
  classes: readonly ShipClassRule[];
  families: readonly GearFamilyRule[];
  shops: readonly ShopRule[];
  balance: BalanceRules;
  limits: FlightLimits;
}

// ---------------------------------------------------------------- generated catalogue

export interface GunStats {
  damage: number;
  shotsPerSecond: number;
  projectileSpeed: number;
  range: number;
  energyPerShot: number;
  damageType: DamageType;
}

export interface ShieldStats {
  capacity: number;
  regenPerSecond: number;
  regenDelay: number;
  shieldType: ShieldType;
}

export interface LauncherStats {
  kind: LauncherKind;
  damage: number;
  speed: number;
  /** 0 = unguided. */
  turnRate: number;
  lifetime: number;
  /** Seconds on target before a guided launcher can fire (0 = unguided). */
  lockTime: number;
  maxAmmo: number;
  ammoPrice: number;
}

export interface EngineStats {
  cruiseSpeed: number;
  cruiseChargeTime: number;
  /** Multiplier on the hull's linear response (acceleration). */
  thrust: number;
}

export interface ThrusterStats {
  boostSpeed: number;
  boostDrain: number;
}

export interface PowerStats {
  energyMax: number;
  energyRegen: number;
}

export interface UtilityStats {
  kind: UtilityKind;
  /** armor: hull points; cargo-pod: cargo units; cabin: passenger berths; scanner: scan range multiplier; tractor: metres. */
  amount: number;
  /** Fractional agility (armour) or top-speed (cargo pod, cabin) penalty. */
  penalty: number;
}

export type GearStats =
  | { slot: 'gun'; gun: GunStats }
  | { slot: 'shield'; shield: ShieldStats }
  | { slot: 'launcher'; launcher: LauncherStats }
  | { slot: 'engine'; engine: EngineStats }
  | { slot: 'thruster'; thruster: ThrusterStats }
  | { slot: 'power'; power: PowerStats }
  | { slot: 'utility'; utility: UtilityStats };

export interface GearItem {
  /** `gear.<family>.<class>.<maker>` */
  id: string;
  family: GearFamilyId;
  slot: SlotType;
  maker: ManufacturerId;
  tier: Tier;
  name: string;
  /** Name without the noun, for tight spaces ("Kestrel Mk I"). */
  short: string;
  price: number;
  /** Balance score used by the guardrails. */
  score: number;
  stats: GearStats;
  description: string;
}

export interface ShipSlot {
  /** `gun-1`, `shield`, `utility-2`, ... */
  id: string;
  type: SlotType;
  maxClass: Tier;
}

export interface ShipModel {
  /** `ship.<class>.<tier>.<maker>` */
  id: string;
  class: ShipClassId;
  maker: ManufacturerId;
  tier: Tier;
  name: string;
  /** Hull alone. */
  hullPrice: number;
  /** Hull plus stock fittings: what the shipyard charges. */
  price: number;
  hull: number;
  cargo: number;
  radius: number;
  maxSpeed: number;
  turnRate: number;
  angularResponse: number;
  linearResponse: number;
  /** Capacitor bank multiplier on the fitted power plant. */
  power: number;
  slots: readonly ShipSlot[];
  /** Stock fittings: slot id → gear id. */
  stock: Readonly<Record<string, string>>;
  description: string;
}

export interface Catalog {
  seed: number;
  ships: readonly ShipModel[];
  gear: readonly GearItem[];
  shipById: ReadonlyMap<string, ShipModel>;
  gearById: ReadonlyMap<string, GearItem>;
}
