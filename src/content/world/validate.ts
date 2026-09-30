import type { SystemId } from '../../data/types.ts';
import { RULES } from '../rules/index.ts';
import type { ContentRules } from '../types.ts';
import type { Issue } from '../validate.ts';
import { distance, jumpsFrom } from './network.ts';
import { GROWTH, GROWTH_NAME_WORDS, NAME_WORDS, NETWORK, PIRATE_DEN, STATION_COUNT, STATION_TYPES as TYPE_RULES, TERRITORY } from './rules.ts';
import { STATION_TYPES, type GeneratedStation, type StationOwner, type SystemSeed, type WorldResult } from './types.ts';

/**
 * World guardrails (docs/PROCGEN.md §7.5). The generated world must pass all of them; the unit
 * tests run them for the real catalogue and for other seeds, so a rule change that breaks one fails
 * CI with a readable list.
 */

/** A hand-placed station in a curated system (its id and name are taken too). */
export interface CuratedStation {
  id: string;
  name: string;
  systemId: SystemId;
  /** Dockable with at least one service. */
  open: boolean;
}

export interface WorldContext {
  curated: readonly CuratedStation[];
  /** Names of systems, factions and anything else a station word must not repeat. */
  reservedNames: readonly string[];
  rules?: ContentRules;
  /** Systems the world grew into after the core (§7.6): their lanes may reach farther, their names come from the growth pools. */
  growth?: ReadonlySet<SystemId>;
}

type Report = (rule: string, subject: string, message: string) => void;

export function validateWorld(seeds: readonly SystemSeed[], world: WorldResult, ctx: WorldContext): Issue[] {
  const issues: Issue[] = [];
  const report: Report = (rule, subject, message) => issues.push({ rule, subject, message });
  const growth = ctx.growth ?? new Set<SystemId>();
  checkNetwork(seeds, world, growth, report);
  checkTerritory(seeds, world, report);
  checkStations(seeds, world, ctx, report);
  checkNames(seeds, world, ctx, growth, report);
  checkShops(world, ctx.rules ?? RULES, report);
  return issues;
}

// ---------------------------------------------------------------- jump network

function checkNetwork(seeds: readonly SystemSeed[], world: WorldResult, growth: ReadonlySet<SystemId>, report: Report): void {
  const byId = new Map(seeds.map((s) => [s.id, s]));
  for (const s of seeds) {
    const links = world.links.get(s.id);
    if (!links) {
      report('network', s.id, 'has no entry in the jump network');
      continue;
    }
    if (links.length > NETWORK.maxLinks) report('network', s.id, `${links.length} links (at most ${NETWORK.maxLinks})`);
    for (const to of links) {
      const other = byId.get(to);
      if (!other) {
        report('network', s.id, `links to unknown system ${to}`);
        continue;
      }
      if (to === s.id) report('network', s.id, 'links to itself');
      if (!world.links.get(to)?.includes(s.id)) report('network', `${s.id}→${to}`, 'link is one-way');
      const d = distance(s.positionLy, other.positionLy);
      const handAuthored = !!s.curated?.links.includes(to) || !!other.curated?.links.includes(s.id);
      const grown = growth.has(s.id) || growth.has(to);
      const limit = grown ? GROWTH.maxLinkLy : NETWORK.maxLinkLy;
      if (!handAuthored && d > limit) report('network', `${s.id}→${to}`, `${d.toFixed(1)} ly is longer than ${limit} ly`);
    }
    // A dead end is fine only when no neighbour within reach has room for another lane.
    if (links.length < NETWORK.minLinks) {
      const spare = seeds.find((o) => {
        if (o.id === s.id || links.includes(o.id) || (world.links.get(o.id)?.length ?? 0) >= NETWORK.maxLinks) return false;
        const grown = growth.has(s.id) || growth.has(o.id);
        // Once the world has grown, core systems gain lanes only to new systems.
        if (!grown && growth.size) return false;
        return distance(s.positionLy, o.positionLy) <= (grown ? GROWTH.maxExtraLinkLy : NETWORK.maxExtraLinkLy);
      });
      if (spare) report('network', s.id, `only ${links.length} link(s) although ${spare.id} is in reach`);
    }
  }
  const reach = jumpsFrom(world.links, 'sol');
  for (const s of seeds) if (!reach.has(s.id)) report('network', s.id, 'cannot be reached from Sol');
}

// ---------------------------------------------------------------- territory

function checkTerritory(seeds: readonly SystemSeed[], world: WorldResult, report: Report): void {
  const [lo, hi] = TERRITORY.securityRange;
  for (const s of seeds) {
    const p = world.profiles.get(s.id);
    if (!p) {
      report('territory', s.id, 'has no profile');
      continue;
    }
    if (!(p.security >= lo && p.security <= hi)) report('territory', s.id, `security ${p.security} outside ${lo}–${hi}`);
    if (p.owner && p.security < TERRITORY.lawlessBelow) report('territory', s.id, `claimed by ${p.owner} yet lawless (security ${p.security})`);
    const curated = s.curated?.owner;
    if (curated !== undefined && (curated === 'independent' ? null : curated) !== p.owner) report('territory', s.id, `owner ${p.owner} differs from the hand-authored ${curated}`);
    if (!s.curated && !p.fiction.trim()) report('territory', s.id, 'has no fiction line');
  }
  const sol = world.profiles.get('sol');
  if (sol && (sol.owner !== 'sta' || sol.security < 0.99)) report('territory', 'sol', 'Sol must be Transit Authority core space');
}

// ---------------------------------------------------------------- stations

const HEX = /^#[0-9a-f]{6}$/i;

function checkStations(seeds: readonly SystemSeed[], world: WorldResult, ctx: WorldContext, report: Report): void {
  const byId = new Map(seeds.map((s) => [s.id, s]));
  const jumps = jumpsFrom(world.links, 'sol');
  const ruleOf = new Map(TYPE_RULES.map((r) => [r.type, r]));
  const ids = new Map<string, number>();
  for (const id of [...ctx.curated.map((c) => c.id), ...world.stations.map((s) => s.id)]) ids.set(id, (ids.get(id) ?? 0) + 1);
  for (const [id, n] of ids) if (n > 1) report('stations', id, `station id used ${n} times`);

  for (const st of world.stations) {
    const s = byId.get(st.systemId);
    const p = world.profiles.get(st.systemId);
    if (!s || !p) {
      report('stations', st.id, `in unknown system ${st.systemId}`);
      continue;
    }
    if (s.curated) report('stations', st.id, `generated inside hand-authored ${s.id}`);
    if (!STATION_TYPES.includes(st.type)) report('stations', st.id, `unknown type ${st.type}`);
    const onBody = s.stars.some((x) => x.id === st.anchorId) || s.planets.some((x) => x.id === st.anchorId);
    if (!onBody) report('stations', st.id, `anchor ${st.anchorId} is not a catalogued star or planet of ${s.id}`);
    const { distance: d, angle, height } = st.orbit;
    if (!(d >= 1_000 && d <= 25_000) || !(angle >= 0 && angle <= 360) || Math.abs(height) > 1_000) report('stations', st.id, `orbit ${d}/${angle}/${height} out of range`);
    const { look } = st;
    if (look.type !== st.type || look.owner !== st.owner) report('stations', st.id, 'look disagrees with type or owner');
    if (!Number.isInteger(look.seed) || look.seed < 0 || !(look.size >= 0 && look.size <= 1) || !(look.wear >= 0 && look.wear <= 1) || !HEX.test(look.starColor)) {
      report('stations', st.id, 'look values out of range');
    }
    if (!st.description.trim() || /[{}]/.test(st.description)) report('stations', st.id, 'description missing or unfilled');

    if (st.type === 'pirate-den') {
      if (st.dockable || st.services.length) report('stations', st.id, 'pirate dens are never open to lawful pilots');
      if (st.owner !== 'hollow-wake') report('stations', st.id, 'pirate dens belong to the Hollow Wake');
      if (p.security >= TERRITORY.lawlessBelow || p.owner) report('stations', st.id, `pirate den in policed space (security ${p.security}, owner ${p.owner})`);
      if ((jumps.get(s.id) ?? 0) < PIRATE_DEN.minJumpsFromSol) report('stations', st.id, 'pirate den too close to Sol');
      continue;
    }
    const rule = ruleOf.get(st.type);
    if (!rule) continue;
    if (!st.dockable || !st.services.length) report('stations', st.id, 'lawful stations are open and offer services');
    if (!(p.security >= rule.security[0] && p.security <= rule.security[1])) report('stations', st.id, `${st.type} at security ${p.security} (allowed ${rule.security[0]}–${rule.security[1]})`);
    const owner: StationOwner = rule.owner === 'territory' ? (p.owner ?? 'independent') : rule.owner;
    if (st.owner !== owner) report('stations', st.id, `owner ${st.owner}, expected ${owner}`);
  }

  // Every system has somewhere to dock; no system is overbuilt.
  for (const s of seeds) {
    const own = world.stations.filter((st) => st.systemId === s.id);
    const open = own.filter((st) => st.dockable && st.services.length).length + ctx.curated.filter((c) => c.systemId === s.id && c.open).length;
    if (!open) report('stations', s.id, 'no open station');
    if (!s.curated && own.filter((st) => st.dockable).length > STATION_COUNT.max) report('stations', s.id, `${own.length} stations (at most ${STATION_COUNT.max})`);
  }
  // Every kind of station exists somewhere (each has its own look and interior).
  for (const type of STATION_TYPES) if (!world.stations.some((st) => st.type === type)) report('coverage', type, 'no station of this type anywhere');
}

// ---------------------------------------------------------------- names

const DENYLIST = ['nazi', 'slave', 'rape', 'terror', 'jihad', 'genocide', 'holocaust', 'lynch', 'suicide'];
const FILLER = new Set(['of', 'the', 'and', 'a', 'star', 'b', 'c']);

function checkNames(seeds: readonly SystemSeed[], world: WorldResult, ctx: WorldContext, growth: ReadonlySet<SystemId>, report: Report): void {
  const rules = ctx.rules ?? RULES;
  const words = (text: string) => text.toLowerCase().split(/[\s'-]+/).filter((w) => w && !FILLER.has(w));
  const reserved = new Set([
    ...rules.makers.flatMap((m) => [...words(m.name), ...words(m.short), ...m.names.ships.flatMap(words), ...Object.values(m.names.gear).flatMap((g) => words(g ?? ''))]),
    ...ctx.reservedNames.flatMap(words),
    ...ctx.curated.flatMap((c) => words(c.name)),
  ]);
  // The pools themselves (the core's and the growth pools: no word in two of them).
  const seen = new Map<string, string>();
  for (const [kind, pools] of [
    ['', NAME_WORDS],
    ['growth ', GROWTH_NAME_WORDS],
  ] as const) {
    for (const [owner, pool] of Object.entries(pools) as [StationOwner, readonly string[]][]) {
      for (const word of pool) {
        const key = word.toLowerCase();
        if (seen.has(key)) report('names', word, `in both the ${seen.get(key)} and ${kind}${owner} pools`);
        seen.set(key, `${kind}${owner}`);
        if (reserved.has(key)) report('names', word, 'already a ship, equipment, maker, faction or place name');
        if (DENYLIST.some((bad) => key.includes(bad))) report('names', word, 'not allowed');
      }
    }
  }
  const systemName = new Map(seeds.map((s) => [s.id, s.name]));
  const names = new Map<string, GeneratedStation[]>();
  for (const st of world.stations) {
    const key = st.name.toLowerCase();
    names.set(key, [...(names.get(key) ?? []), st]);
    const first = st.name.split(' ')[0]!;
    const grown = growth.has(st.systemId);
    // A grown system's station may be named after its system once its pool has run out.
    const ok = grown ? GROWTH_NAME_WORDS[st.owner].includes(first) || st.name.startsWith(`${systemName.get(st.systemId)} `) : NAME_WORDS[st.owner].includes(first);
    if (!ok) report('names', st.id, `"${st.name}" is not from the ${grown ? 'growth ' : ''}${st.owner} pool (pool exhausted?)`);
  }
  for (const c of ctx.curated) {
    const key = c.name.toLowerCase();
    if (names.has(key)) report('names', c.id, `"${c.name}" is also a generated station`);
  }
  for (const [name, list] of names) if (list.length > 1) report('names', list.map((s) => s.id).join(', '), `"${name}" is used more than once`);
}

// ---------------------------------------------------------------- shops

function checkShops(world: WorldResult, rules: ContentRules, report: Report): void {
  const makers = new Map(rules.makers.map((m) => [m.id, m]));
  for (const st of world.stations) {
    const shop = st.shop;
    const sells = st.services.includes('equipment');
    if (!shop) {
      if (sells || st.services.includes('repair')) report('shops', st.id, 'offers repairs or equipment but has no outfitter');
      continue;
    }
    if (sells !== shop.makers.length > 0) report('shops', st.id, sells ? 'sells equipment but stocks no maker' : 'stocks makers without the equipment service');
    for (const m of shop.makers) if (!makers.has(m)) report('shops', st.id, `unknown maker ${m}`);
    if (shop.shipyard.length) {
      const sold = shop.makers.some((m) => shop.shipyard.some((c) => (makers.get(m)?.ships[c] ?? []).some((t) => t <= shop.maxShipTier)));
      if (!sold) report('shops', st.id, 'shipyard has nothing to sell');
    }
  }
}
