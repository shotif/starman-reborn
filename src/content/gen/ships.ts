import { SHIP_WEIGHTS } from '../rules/balance.ts';
import { ROMAN, rng, roundPrice, roundTo } from '../random.ts';
import type {
  ContentRules,
  GearFamilyId,
  GearItem,
  ManufacturerRule,
  ShipClassRule,
  ShipModel,
  ShipSlot,
  SlotType,
  Tier,
} from '../types.ts';

/**
 * Ship generator: every (maker, class, tier) the rules list becomes one model. Stats start from
 * the class baseline grown to the tier; maker traits bend them, and hull pays for the rest so each
 * model stays inside its budget. Each model comes with a stock loadout of tier-matched equipment.
 */
export function generateShips(rules: ContentRules, gear: readonly GearItem[], seed: number): ShipModel[] {
  const out: ShipModel[] = [];
  const gearById = new Map(gear.map((it) => [it.id, it]));
  for (const maker of rules.makers) {
    const pool = rng(seed, 'ship-names', maker.id).shuffle(maker.names.ships);
    let nextName = 0;
    // Canonical order (class order of the rules, then tier), so names are stable for a given rule set.
    for (const cls of rules.classes) {
      for (const tier of maker.ships[cls.id] ?? []) {
        const word = pool[nextName++];
        out.push(makeShip(cls, tier, maker, word, rules, gear, gearById));
      }
    }
  }
  return out;
}

export function shipId(cls: string, tier: Tier, maker: string): string {
  return `ship.${cls}.${tier}.${maker}`;
}

function makeShip(
  cls: ShipClassRule,
  tier: Tier,
  maker: ManufacturerRule,
  word: string | undefined,
  rules: ContentRules,
  gear: readonly GearItem[],
  gearById: ReadonlyMap<string, GearItem>,
): ShipModel {
  const k = tier - 1;
  const b = cls.base;
  const g = cls.growth;
  const tr = maker.traits;
  const w = SHIP_WEIGHTS;
  const hullT = tr.hull ?? 1;
  const agility = tr.agility ?? 1;
  const speed = tr.speed ?? 1;
  const cargo = tr.cargo ?? 1;
  const power = tr.power ?? 1;
  // How far the traits push the frame over (or under) budget; hull absorbs the difference.
  const budget = hullT ** w.hull * agility ** w.agility * speed ** w.speed * cargo ** w.cargo * power ** w.power;
  const handling = g.handling ** k;
  const hull = (b.hull * g.hull ** k * hullT) / budget ** (1 / w.hull);

  const slots = makeSlots(cls, tier);
  const stock = stockLoadout(cls, tier, maker, slots, rules, gear);
  const hullPrice = roundPrice(cls.basePrice * rules.balance.shipPriceGrowth ** k * (tr.price ?? 1));
  const stockPrice = Object.values(stock).reduce((sum, id) => sum + (gearById.get(id)?.price ?? 0), 0);

  return {
    id: shipId(cls.id, tier, maker.id),
    class: cls.id,
    maker: maker.id,
    tier,
    // Pool exhausted: a plain fallback the name guardrail reports.
    name: word ? `${maker.short} ${word}` : `${maker.short} ${cls.name} ${ROMAN[tier]}`,
    hullPrice,
    price: hullPrice + stockPrice,
    hull: roundTo(hull, hull >= 200 ? 5 : 1),
    cargo: roundTo(b.cargo * g.cargo ** k * cargo, 1),
    radius: b.radius,
    maxSpeed: roundTo(b.maxSpeed * handling * speed, 1),
    turnRate: roundTo(b.turnRate * handling * agility, 0.01),
    angularResponse: roundTo(b.angularResponse * handling * agility, 0.1),
    linearResponse: roundTo(b.linearResponse * handling, 0.05),
    power: roundTo(b.power * g.power ** k * power, 0.01),
    slots,
    stock,
    description: `${cls.name} for ${cls.role}. ${maker.tendency}.`,
  };
}

/** Highest class a slot of this type takes on a model of this tier. */
export function slotMaxClass(cls: ShipClassRule, type: SlotType, tier: Tier): Tier {
  return Math.min(5, (cls.maxClass[type] ?? cls.maxClass.default) + (tier - 1)) as Tier;
}

function makeSlots(cls: ShipClassRule, tier: Tier): ShipSlot[] {
  const slots: ShipSlot[] = [];
  const add = (type: SlotType, count: number, numbered: boolean) => {
    for (let i = 1; i <= count; i++) slots.push({ id: numbered ? `${type}-${i}` : type, type, maxClass: slotMaxClass(cls, type, tier) });
  };
  add('gun', cls.slots.gun[tier - 1] ?? 0, true);
  add('launcher', cls.slots.launcher[tier - 1] ?? 0, true);
  add('shield', 1, false);
  add('engine', 1, false);
  add('thruster', 1, false);
  add('power', 1, false);
  add('utility', cls.slots.utility[tier - 1] ?? 0, true);
  return slots;
}

const LAUNCHER_FAMILY = { rocket: 'rocket-pod', seeker: 'seeker', torpedo: 'torpedo' } as const satisfies Record<string, GearFamilyId>;
const UTILITY_FAMILY = {
  armor: 'armor',
  'cargo-pod': 'cargo-pod',
  scanner: 'scanner',
  tractor: 'tractor',
  'jump-drive': 'jump-drive',
  'mining-laser': 'mining-laser',
  prospector: 'prospector',
} as const satisfies Record<
  string,
  GearFamilyId
>;

/** The family a maker fits in a slot: its own first family for the slot, else a sensible default. */
function preferredFamily(slot: ShipSlot, utilityIndex: number, cls: ShipClassRule, maker: ManufacturerRule, rules: ContentRules): GearFamilyId | null {
  const own = (Object.keys(maker.gear) as GearFamilyId[]).find((id) => rules.families.find((f) => f.id === id)?.slot === slot.type);
  switch (slot.type) {
    case 'gun':
      return own ?? 'pulse';
    case 'shield':
      return own ?? 'shield-balanced';
    case 'launcher':
      return LAUNCHER_FAMILY[cls.stockLauncher];
    case 'utility': {
      const kind = cls.stockUtility[utilityIndex];
      return kind ? UTILITY_FAMILY[kind] : null;
    }
    default:
      return slot.type;
  }
}

/**
 * Stock fittings: for each slot, the preferred family at the ship's tier (or the best lower class
 * available), from the ship's own maker first, then makers of the same faction, then anyone.
 * Raider gear (makers without a home station) only goes on raider ships.
 */
function stockLoadout(
  cls: ShipClassRule,
  tier: Tier,
  maker: ManufacturerRule,
  slots: readonly ShipSlot[],
  rules: ContentRules,
  gear: readonly GearItem[],
): Record<string, string> {
  const stock: Record<string, string> = {};
  const makerById = new Map(rules.makers.map((m) => [m.id, m]));
  let utilityIndex = 0;
  for (const slot of slots) {
    const family = preferredFamily(slot, slot.type === 'utility' ? utilityIndex++ : 0, cls, maker, rules);
    if (!family) continue;
    const limit = Math.min(tier, slot.maxClass);
    const rank = (it: GearItem): number => {
      if (it.maker === maker.id) return 0;
      return makerById.get(it.maker)?.factionId === maker.factionId ? 1 : 2;
    };
    const candidates = gear
      .filter((it) => it.family === family && it.tier <= limit)
      .filter((it) => it.maker === maker.id || makerById.get(it.maker)?.homeLocation !== null || maker.homeLocation === null)
      .sort((a, b) => b.tier - a.tier || rank(a) - rank(b) || (a.id < b.id ? -1 : 1));
    const pick = candidates[0];
    if (pick) stock[slot.id] = pick.id;
  }
  return stock;
}
