import { BOARD_KINDS } from '../content/contracts/rules.ts';
import { COMMODITIES, type CommodityId } from '../content/economy/goods.ts';
import { STATION_MARKETS } from '../content/economy/rules.ts';
import { OUTPOSTS } from '../content/outposts/rules.ts';
import { outpostLocation, outpostNames, outpostSites, type OutpostSite } from '../content/outposts/sites.ts';
import type { Issue } from '../content/validate.ts';
import { GIANT_EARTH_MASSES } from '../content/world/generate.ts';
import { STATION_TYPES } from '../content/world/rules.ts';
import { ALL_LOCATIONS, getPlanet, SYSTEMS, WORLD, WORLD_SEEDS } from '../data/systems.ts';
import { marketTables } from './markets.ts';

/** The rules a guardrail checks (the real ones, or a broken copy in the tests). */
export type OutpostRules = typeof OUTPOSTS;

/**
 * Outpost guardrails (docs/PROCGEN.md §22.5): the rules make sense (stages that need lawful goods
 * someone makes, grow in size and income, keep the services they had, and pay for themselves in a
 * sensible time); every site orbits a confirmed planet of a generated system and allows only kinds
 * the world's rules allow there; and the names offered never clash with a station's.
 */
export function validateOutposts(rules: OutpostRules = OUTPOSTS, sites: readonly OutpostSite[] = outpostSites()): Issue[] {
  const issues: Issue[] = [];
  const report = (rule: string, subject: string, message: string) => issues.push({ rule, subject, message });

  // The rules.
  if (rules.max < 1 || rules.charter <= 0) report('rules', 'charter', 'no outpost can be founded');
  const made = new Set([...marketTables().values()].flatMap((t) => [...t.entries.values()].filter((e) => e.role === 'produce').map((e) => e.commodity)));
  let cost = rules.charter;
  rules.stages.forEach((stage, i) => {
    const before = rules.stages[i - 1];
    const needs = Object.entries(stage.needs) as [CommodityId, number][];
    if (!needs.length) report('rules', stage.id, 'a stage that needs nothing');
    for (const [c, q] of needs) {
      if (!Number.isInteger(q) || q <= 0) report('rules', stage.id, `${q} ${c}: not a positive whole number`);
      if (COMMODITIES[c].category === 'contraband' || c === 'weapons') report('rules', stage.id, `${c}: not lawful cargo`);
      if (!made.has(c)) report('rules', stage.id, `${c}: nobody makes it`);
    }
    if (stage.size <= 0 || stage.size > 1 || (before && stage.size <= before.size)) report('rules', stage.id, 'its size does not grow within 0–1');
    if (stage.income <= 0 || (before && stage.income <= before.income)) report('rules', stage.id, 'its income does not grow');
    if (before && !before.services.every((s) => stage.services.includes(s))) report('rules', stage.id, 'it loses a service the stage before had');
    if (i === 0 && !stage.services.includes('market')) report('rules', stage.id, 'the first stage does not open a market');
    // It pays for itself (at the goods' galaxy-wide prices, the charter with the frame) in a sensible time: not at once, not never.
    const goods = needs.reduce((sum, [c, q]) => sum + q * COMMODITIES[c].basePrice, 0);
    cost += goods;
    const hours = (goods + (i === 0 ? rules.charter : 0)) / (stage.income - (before?.income ?? 0));
    if (hours < 8 || hours > 60) report('balance', stage.id, `pays for itself in ${hours.toFixed(1)} hours (8–60 allowed)`);
  });
  const all = cost / rules.stages.at(-1)!.income;
  if (all < 10 || all > 60) report('balance', 'outpost', `the whole outpost pays for itself in ${all.toFixed(1)} hours at full income (10–60 allowed)`);

  // The kinds: each one a station of the world's kinds, with a market, a board and a bar.
  for (const k of rules.kinds) {
    if (!STATION_TYPES.some((t) => t.type === k) || !STATION_MARKETS[k] || !(k in BOARD_KINDS)) report('rules', k, 'not a kind with a market, a board and a bar');
  }

  // The names: distinct, and never a station's first word or a system's name.
  const words = new Set(rules.nameWords);
  if (words.size !== rules.nameWords.length) report('names', 'nameWords', 'a word twice');
  const taken = new Set([...ALL_LOCATIONS.map((l) => l.name.split(' ')[0]!.toLowerCase()), ...SYSTEMS.map((s) => s.displayName.toLowerCase())]);
  for (const w of rules.nameWords) if (taken.has(w.toLowerCase())) report('names', w, 'already a station’s or a system’s name');

  // The sites.
  const ids = new Set<string>();
  for (const site of sites) {
    const subject = site.planetId;
    const planet = getPlanet(site.planetId);
    const seed = WORLD_SEEDS.find((s) => s.id === site.systemId);
    if (ids.has(subject)) report('sites', subject, 'two sites at one planet');
    ids.add(subject);
    if (!planet || planet.status !== 'confirmed' || !seed?.planets.some((p) => p.id === site.planetId)) report('sites', subject, 'not a confirmed planet of its system');
    if (!seed || seed.curated) report('sites', subject, 'in a hand-made system');
    const [d0, d1] = rules.orbit.distance;
    if (site.orbit.distance < d0 || site.orbit.distance > d1 || Math.abs(site.orbit.height) > rules.orbit.height[1]) report('sites', subject, 'an orbit out of bounds');
    if (!site.kinds.length) report('sites', subject, 'nothing can be built');
    const security = WORLD.profiles.get(site.systemId)?.security ?? 1;
    const small = (seed?.planets.find((p) => p.id === site.planetId)?.massEarth ?? 0) <= GIANT_EARTH_MASSES;
    for (const k of site.kinds) {
      const band = STATION_TYPES.find((t) => t.type === k)?.security;
      if (!rules.kinds.includes(k as (typeof rules.kinds)[number]) || !band || security < band[0] || security > band[1]) report('sites', subject, `${k}: not allowed at its security`);
      if (k === 'mining-outpost' && !small) report('sites', subject, 'a mine round a giant planet');
      const names = outpostNames(site.planetId, k);
      if (new Set(names).size !== 3) report('names', subject, `${k}: fewer than three names offered`);
      const loc = outpostLocation({ site: site.planetId, kind: k, name: names[0]!, founded: 0, stage: 1, delivered: {}, since: 0, earned: 0 });
      if (!loc || ALL_LOCATIONS.some((l) => l.id === loc.id || l.name === loc.name)) report('sites', subject, 'its outpost would clash with a station');
    }
  }
  return issues;
}
