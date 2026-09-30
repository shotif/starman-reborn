import { ALL_LOCATIONS, getLocation, SYSTEMS } from '../data/systems.ts';
import { FACTIONS } from '../economy/factions.ts';
import { combatRating, duelSeconds, shipPerformance, type ShipPerformance } from './loadout.ts';
import { DAMAGE_MATRIX, REFERENCE_FAMILY } from './rules/balance.ts';
import { gearScore, gunScore, MAIN_DAMAGE_TYPES, SHIELD_TYPES, shipFrameScore, shipFrameTarget, targetScore, TIERS } from './score.ts';
import type { Catalog, ContentRules, GearItem, ShipModel, SlotType, Tier } from './types.ts';

/**
 * Guardrails (docs/PROCGEN.md §4). Every generated catalogue must pass all of them; the unit tests
 * run them, so a rule change that breaks one fails CI with a readable list of issues.
 */
export interface Issue {
  /** Which guardrail. */
  rule: string;
  /** The rule, item or ship it concerns. */
  subject: string;
  message: string;
}

type Report = (rule: string, subject: string, message: string) => void;

export function validateCatalog(catalog: Catalog, rules: ContentRules): Issue[] {
  const issues: Issue[] = [];
  const report: Report = (rule, subject, message) => issues.push({ rule, subject, message });
  checkRules(rules, report);
  checkGear(catalog, rules, report);
  checkShips(catalog, rules, report);
  checkCombat(catalog, rules, report);
  checkAvailability(catalog, rules, report);
  checkNames(catalog, rules, report);
  checkDescriptions(catalog, report);
  return issues;
}

export function formatIssues(issues: readonly Issue[]): string {
  return issues.map((i) => `[${i.rule}] ${i.subject}: ${i.message}`).join('\n');
}

const pct = (x: number): string => `${x >= 0 ? '+' : ''}${Math.round(x * 100)}%`;
const fmt = (x: number): string => (Math.abs(x) >= 100 ? x.toFixed(0) : x.toFixed(2));

function groupBy<T>(items: readonly T[], key: (item: T) => string): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const it of items) {
    const k = key(it);
    const list = out.get(k);
    if (list) list.push(it);
    else out.set(k, [it]);
  }
  return out;
}

function median(values: readonly number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

// ---------------------------------------------------------------- rules

function checkRules(rules: ContentRules, report: Report): void {
  const { traitRange } = rules.balance;
  const ids = new Set<string>();
  for (const m of rules.makers) {
    if (ids.has(m.id)) report('ids', m.id, 'duplicate maker id');
    ids.add(m.id);
    for (const [trait, value] of Object.entries(m.traits)) {
      if (value < traitRange.min || value > traitRange.max) {
        report('traits', m.id, `${trait} ${value} is outside ${traitRange.min}–${traitRange.max}`);
      }
    }
    for (const [family, tiers] of Object.entries(m.gear)) {
      if (!rules.families.some((f) => f.id === family)) report('ids', m.id, `unknown equipment family ${family}`);
      if (!m.names.gear[family as keyof typeof m.names.gear]) report('names', m.id, `no product-line name for ${family}`);
      checkTierList(tiers, `${m.id} ${family}`, report);
    }
    for (const [cls, tiers] of Object.entries(m.ships)) {
      if (!rules.classes.some((c) => c.id === cls)) report('ids', m.id, `unknown ship class ${cls}`);
      checkTierList(tiers, `${m.id} ${cls}`, report);
    }
    if (m.homeLocation !== null) {
      const loc = ALL_LOCATIONS.find((l) => l.id === m.homeLocation);
      if (!loc) report('ids', m.id, `unknown home station ${m.homeLocation}`);
      else if (loc.systemId !== m.homeSystem) report('ids', m.id, `home station ${loc.id} is not in ${m.homeSystem}`);
    }
  }
  for (const f of rules.families) {
    const refId = REFERENCE_FAMILY[f.slot];
    const ref = refId ? rules.families.find((x) => x.id === refId) : undefined;
    if (refId && !ref) report('ids', f.id, `reference family ${refId} is missing`);
    if (ref && ref.growth !== f.growth) report('gear-band', f.id, `shares the ${f.slot} budget but grows ${f.growth} per class, not ${ref.growth}`);
  }
  for (const shop of rules.shops) {
    const loc = ALL_LOCATIONS.find((l) => l.id === shop.locationId);
    if (!loc) {
      report('availability', shop.locationId, 'shop at an unknown station');
      continue;
    }
    if (loc.status !== 'functional') report('availability', shop.locationId, 'shop at a station that is not open');
    if (shop.makers.length && !loc.services.includes('equipment')) report('availability', shop.locationId, 'sells equipment but has no outfitter service');
    for (const maker of shop.makers) if (!ids.has(maker)) report('ids', shop.locationId, `unknown maker ${maker}`);
  }
  if (!(rules.balance.resale < 1)) report('economy', 'balance', 'resale must stay below the purchase price');
}

function checkTierList(tiers: readonly number[], subject: string, report: Report): void {
  if (!tiers.length) report('ids', subject, 'empty tier list');
  tiers.forEach((t, i) => {
    if (!TIERS.includes(t as Tier)) report('ids', subject, `tier ${t} is not 1–5`);
    if (i > 0 && t <= tiers[i - 1]!) report('ids', subject, 'tiers must be listed in increasing order');
  });
}

// ---------------------------------------------------------------- equipment

function checkGear(catalog: Catalog, rules: ContentRules, report: Report): void {
  const { gearBand, priceBand } = rules.balance;
  const family = (it: GearItem) => rules.families.find((f) => f.id === it.family)!;
  const seen = new Set<string>();
  for (const it of catalog.gear) {
    if (seen.has(it.id)) report('ids', it.id, 'duplicate id');
    seen.add(it.id);
    if (it.id !== `gear.${it.family}.${it.tier}.${it.maker}`) report('ids', it.id, 'id does not follow gear.<family>.<class>.<maker>');
    const f = family(it);
    const score = gearScore(it.stats, f);
    const target = targetScore(f, it.tier, rules);
    if (Math.abs(score / target - 1) > gearBand) report('gear-band', it.id, `score ${fmt(score)} is ${pct(score / target - 1)} from the class ${it.tier} target ${fmt(target)}`);
    const s = it.stats;
    if (s.slot === 'thruster' && s.thruster.boostSpeed > rules.limits.boostSpeed.max) report('flight-envelope', it.id, `boost ${s.thruster.boostSpeed} m/s is over the limit`);
    if (s.slot === 'engine' && s.engine.cruiseSpeed > rules.limits.cruiseSpeed.max) report('flight-envelope', it.id, `cruise ${s.engine.cruiseSpeed} m/s is over the limit`);
    if (s.slot === 'utility' && (s.utility.kind === 'armor' || s.utility.kind === 'cargo-pod') && !(s.utility.penalty > 0)) {
      report('trade-offs', it.id, `${s.utility.kind} must cost ${s.utility.kind === 'armor' ? 'agility' : 'speed'}`);
    }
    if (!(it.price > 0)) report('economy', it.id, 'price must be positive');
  }

  // Classes step up clearly, and prices rise with them, inside each maker's line.
  for (const [line, items] of groupBy(catalog.gear, (it) => `${it.maker} ${it.family}`)) {
    const sorted = [...items].sort((a, b) => a.tier - b.tier);
    for (let i = 1; i < sorted.length; i++) {
      const lo = sorted[i - 1]!;
      const hi = sorted[i]!;
      const step = (1 + family(hi).minTierStep) ** (hi.tier - lo.tier);
      if (hi.score < lo.score * step) report('tier-step', line, `class ${hi.tier} is only ${pct(hi.score / lo.score - 1)} over class ${lo.tier}`);
      if (hi.price <= lo.price) report('economy', line, `class ${hi.tier} does not cost more than class ${lo.tier}`);
    }
  }

  // Same-class items of a family cost about the same.
  for (const [key, items] of groupBy(catalog.gear, (it) => `${it.family} class ${it.tier}`)) {
    const mid = median(items.map((it) => it.price));
    for (const it of items) {
      if (Math.abs(it.price / mid - 1) > priceBand) report('economy', it.id, `price ${it.price} is ${pct(it.price / mid - 1)} from the ${key} median ${mid}`);
    }
  }

  // Damage types have counters, and none dominates.
  for (const tier of TIERS) {
    const byType = MAIN_DAMAGE_TYPES.map((type) => {
      const guns = catalog.gear.filter((it) => it.tier === tier && it.stats.slot === 'gun' && it.stats.gun.damageType === type);
      return guns.length ? guns.reduce((sum, it) => sum + (it.stats.slot === 'gun' ? gunScore(it.stats.gun) : 0), 0) / guns.length : null;
    }).filter((v): v is number => v !== null);
    if (byType.length >= 2 && Math.max(...byType) / Math.min(...byType) > 1.1) {
      report('damage-counters', `class ${tier} guns`, `one damage type is ${pct(Math.max(...byType) / Math.min(...byType) - 1)} stronger than another`);
    }
  }
  for (const shield of SHIELD_TYPES) {
    const row = MAIN_DAMAGE_TYPES.map((d) => DAMAGE_MATRIX[d][shield]);
    if (shield === 'balanced') {
      if (row.some((v) => v !== 1)) report('damage-counters', shield, 'a balanced shield must have no strengths or weaknesses');
    } else if (!row.some((v) => v <= 0.8) || !row.some((v) => v >= 1.2)) {
      report('damage-counters', shield, 'a typed shield must resist one damage type and be weak to another');
    }
  }
}

// ---------------------------------------------------------------- ships

const CORE_SLOTS: readonly SlotType[] = ['gun', 'shield', 'engine', 'thruster', 'power'];

function checkShips(catalog: Catalog, rules: ContentRules, report: Report): void {
  const { shipBand } = rules.balance;
  const lim = rules.limits;
  const seen = new Set<string>();
  for (const ship of catalog.ships) {
    if (seen.has(ship.id)) report('ids', ship.id, 'duplicate id');
    seen.add(ship.id);
    if (ship.id !== `ship.${ship.class}.${ship.tier}.${ship.maker}`) report('ids', ship.id, 'id does not follow ship.<class>.<tier>.<maker>');
    const cls = rules.classes.find((c) => c.id === ship.class)!;
    const score = shipFrameScore(ship, cls);
    const target = shipFrameTarget(cls, ship.tier);
    if (Math.abs(score / target - 1) > shipBand) report('ship-band', ship.id, `frame score is ${pct(score / target - 1)} from the Mk ${ship.tier} target`);

    const within = (what: string, v: number, range: { min?: number; max: number }) => {
      if (v > range.max || (range.min !== undefined && v < range.min)) report('flight-envelope', ship.id, `${what} ${v} is outside ${range.min ?? 0}–${range.max}`);
    };
    within('top speed', ship.maxSpeed, lim.maxSpeed);
    within('turn rate', ship.turnRate, lim.turnRate);
    within('turn response', ship.angularResponse, lim.angularResponse);
    within('radius', ship.radius, lim.radius);

    // Stock fittings fit, and every core slot is filled.
    for (const [slotId, gearId] of Object.entries(ship.stock)) {
      const slot = ship.slots.find((s) => s.id === slotId);
      const item = catalog.gearById.get(gearId);
      if (!slot) report('fittings', ship.id, `stock item in unknown slot ${slotId}`);
      else if (!item) report('fittings', ship.id, `stock item ${gearId} does not exist`);
      else if (item.slot !== slot.type) report('fittings', ship.id, `${item.id} does not go in a ${slot.type} slot`);
      else if (item.tier > slot.maxClass) report('fittings', ship.id, `${item.id} is over the class ${slot.maxClass} limit of ${slotId}`);
    }
    for (const type of CORE_SLOTS) {
      if (!ship.slots.some((s) => s.type === type && ship.stock[s.id])) report('fittings', ship.id, `no stock ${type}`);
    }
    const perf = shipPerformance(ship, ship.stock, catalog.gearById);
    within('stock top speed', perf.flight.maxSpeed, lim.maxSpeed);
    within('stock turn rate', perf.flight.maxTurnRate, lim.turnRate);
  }
  for (const [line, ships] of groupBy(catalog.ships, (s) => `${s.maker} ${s.class}`)) {
    const sorted = [...ships].sort((a, b) => a.tier - b.tier);
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i]!.hullPrice <= sorted[i - 1]!.hullPrice) report('economy', line, `Mk ${sorted[i]!.tier} does not cost more than Mk ${sorted[i - 1]!.tier}`);
    }
  }
}

// ---------------------------------------------------------------- combat

const FIGHTERS = new Set(['light-fighter', 'heavy-fighter', 'gunship']);

function checkCombat(catalog: Catalog, rules: ContentRules, report: Report): void {
  const { hitRate, duelSeconds: range, tierGapAdvantage } = rules.balance;
  const perf = new Map<string, ShipPerformance>(catalog.ships.map((s) => [s.id, shipPerformance(s, s.stock, catalog.gearById)]));
  const p = (s: ShipModel) => perf.get(s.id)!;

  // Tier-matched duels of one class last a while, whoever built the ships.
  for (const [key, ships] of groupBy(catalog.ships, (s) => `${s.class} Mk ${s.tier}`)) {
    for (const a of ships) {
      for (const b of ships) {
        const t = duelSeconds(p(a), p(b), hitRate);
        if (t < range.min || t > range.max) report('time-to-kill', key, `${a.name} kills ${b.name} in ${t.toFixed(1)} s (allowed ${range.min}–${range.max} s)`);
      }
    }
  }
  // Two tiers up is decisive.
  for (const [line, ships] of groupBy(catalog.ships, (s) => `${s.maker} ${s.class}`)) {
    for (const lo of ships) {
      const hi = ships.find((s) => s.tier === lo.tier + 2);
      if (!hi) continue;
      const up = duelSeconds(p(hi), p(lo), hitRate);
      const down = duelSeconds(p(lo), p(hi), hitRate);
      if (up * tierGapAdvantage > down) report('time-to-kill', line, `Mk ${hi.tier} kills Mk ${lo.tier} in ${up.toFixed(1)} s but dies in ${down.toFixed(1)} s`);
    }
  }
  // Freighters out-carry every other class; fighters out-fight freighters of the same price.
  const freighters = catalog.ships.filter((s) => s.class === 'freighter');
  const others = catalog.ships.filter((s) => s.class !== 'freighter');
  if (freighters.length && others.length) {
    const minHold = Math.min(...freighters.map((s) => p(s).cargo));
    const biggest = others.reduce((a, b) => (p(b).cargo > p(a).cargo ? b : a));
    if (p(biggest).cargo >= minHold) report('trade-offs', biggest.id, `carries ${p(biggest).cargo}, as much as a freighter (${minHold})`);
  }
  for (const f of freighters) {
    for (const x of catalog.ships.filter((s) => FIGHTERS.has(s.class) && Math.abs(s.price / f.price - 1) <= 0.2)) {
      if (combatRating(p(x)) <= combatRating(p(f))) report('trade-offs', x.id, `does not out-fight the similarly priced ${f.name}`);
    }
  }
}

// ---------------------------------------------------------------- availability

function checkAvailability(catalog: Catalog, rules: ContentRules, report: Report): void {
  const makerById = new Map(rules.makers.map((m) => [m.id, m]));
  for (const it of catalog.gear) {
    if (makerById.get(it.maker)?.homeLocation === null) continue; // raider gear: flown, not sold
    if (!rules.shops.some((s) => s.makers.includes(it.maker) && it.tier <= s.maxClass)) report('availability', it.id, 'not sold anywhere');
  }
  for (const ship of catalog.ships) {
    if (makerById.get(ship.maker)?.homeLocation === null) continue;
    const sold = rules.shops.some((s) => s.makers.includes(ship.maker) && s.shipyard.includes(ship.class) && ship.tier <= s.maxShipTier);
    if (!sold) report('availability', ship.id, 'not sold at any shipyard');
  }
  for (const m of rules.makers) {
    if (m.homeLocation === null) continue;
    if (!rules.shops.some((s) => s.locationId === m.homeLocation && s.makers.includes(m.id))) report('availability', m.id, 'its home station does not sell its range');
  }
  // Every slot can be filled from the start: a class 1 item of each slot type is sold in Sol, ungated.
  const solShops = rules.shops.filter((s) => ALL_LOCATIONS.some((l) => l.id === s.locationId) && getLocation(s.locationId).systemId === 'sol');
  const open = rules.balance.standingForClass[1] <= 0;
  const slots: SlotType[] = ['gun', 'launcher', 'shield', 'engine', 'thruster', 'power', 'utility'];
  for (const slot of slots) {
    const ok = open && catalog.gear.some((it) => it.slot === slot && it.tier === 1 && solShops.some((s) => s.makers.includes(it.maker)));
    if (!ok) report('availability', slot, 'no class 1 item for this slot is sold in Sol');
  }
}

// ---------------------------------------------------------------- names

/** Words that must never appear in generated names. */
export const NAME_DENYLIST: readonly string[] = ['nazi', 'slave', 'rape', 'terror', 'jihad', 'genocide', 'holocaust', 'lynch', 'suicide'];

const NAME_PATTERN = /^[A-Z][A-Za-z'-]*( [A-Za-z][A-Za-z'-]*)*$/;
const FILLER = new Set(['of', 'the', 'and', 'a', 'mk', 'star']);

function checkNames(catalog: Catalog, rules: ContentRules, report: Report): void {
  // Words of places and factions, except the ones makers are deliberately named after.
  const makerWords = new Set(rules.makers.flatMap((m) => `${m.name} ${m.short}`.toLowerCase().split(/[\s'-]+/)));
  const reserved = new Set(
    [...ALL_LOCATIONS.map((l) => l.name), ...SYSTEMS.map((s) => s.displayName), ...Object.values(FACTIONS).flatMap((f) => [f.name, f.shortName])]
      .flatMap((n) => n.toLowerCase().split(/[\s'-]+/))
      .filter((w) => w && !FILLER.has(w) && !makerWords.has(w)),
  );
  const checkWords = (kind: string, subject: string, name: string, own: string) => {
    if (!NAME_PATTERN.test(name)) report('names', subject, `${kind} name "${name}" is not plain words`);
    for (const word of own.toLowerCase().split(/[\s'-]+/)) {
      if (reserved.has(word)) report('names', subject, `"${word}" is already a place or faction name`);
      if (NAME_DENYLIST.some((bad) => word.includes(bad))) report('names', subject, `"${word}" is not allowed`);
    }
  };
  const unique = (kind: string, names: readonly { id: string; name: string }[]) => {
    for (const [name, list] of groupBy(names, (n) => n.name.toLowerCase())) {
      if (list.length > 1) report('names', list.map((n) => n.id).join(', '), `${kind} name "${name}" is used more than once`);
    }
  };
  unique('ship', catalog.ships);
  unique('equipment', catalog.gear);
  for (const ship of catalog.ships) {
    const maker = rules.makers.find((m) => m.id === ship.maker)!;
    const word = ship.name.slice(maker.short.length + 1);
    if (!ship.name.startsWith(`${maker.short} `) || !maker.names.ships.includes(word)) report('names', ship.id, `"${ship.name}" is not from ${maker.short}'s name pool (pool too small?)`);
    checkWords('ship', ship.id, ship.name, word);
  }
  for (const it of catalog.gear) {
    const maker = rules.makers.find((m) => m.id === it.maker)!;
    checkWords('equipment', it.id, it.name, maker.names.gear[it.family] ?? '');
  }
}

// ---------------------------------------------------------------- descriptions

/** Every number in a description must be one of the item's stats: text never invents facts. */
function checkDescriptions(catalog: Catalog, report: Report): void {
  for (const it of catalog.gear) {
    const allowed = new Set<number>();
    const collect = (value: unknown) => {
      if (typeof value === 'number') {
        allowed.add(value);
        allowed.add(Math.round(value * 100)); // penalties are written as percentages
      } else if (value && typeof value === 'object') Object.values(value).forEach(collect);
    };
    collect(it.stats);
    for (const match of it.description.matchAll(/\d+(?:\.\d+)?/g)) {
      if (!allowed.has(Number(match[0]))) report('descriptions', it.id, `"${match[0]}" in the description is not one of its stats`);
    }
    if (!it.description.trim()) report('descriptions', it.id, 'empty description');
  }
  for (const ship of catalog.ships) {
    if (/\d/.test(ship.description)) report('descriptions', ship.id, 'ship descriptions must not quote numbers (the UI shows the stats)');
  }
}
