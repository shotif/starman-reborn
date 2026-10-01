import { getCatalog } from '../content/catalog.ts';
import { ACE_NAMES, CONTRACTS, CONVOY_NAMES } from '../content/contracts/rules.ts';
import { COMMODITIES } from '../content/economy/goods.ts';
import { HAULER_NAMES } from '../content/economy/hauls.ts';
import { FIRST_NAMES, LAST_NAMES } from '../content/people/lines.ts';
import { AMENDS, GREET, NEWS, RADIO, REFUSE, ROUND, TIP } from '../content/rivals/lines.ts';
import { RIVALS, ROSTER, type RivalDef } from '../content/rivals/rules.ts';
import { CHARACTERS } from '../content/story/arcs.ts';
import type { Issue } from '../content/validate.ts';
import { jumpsFrom } from '../content/world/network.ts';
import { ALL_LOCATIONS, getLocation, WORLD } from '../data/systems.ts';
import { marketTables } from './markets.ts';
import { patchOf, runOf, turnStart, type RivalRun } from './rivals.ts';

/** The rules a guardrail checks (the real ones, or a broken copy in the tests). */
export type RivalRules = typeof RIVALS;

/**
 * Rival guardrails (docs/PROCGEN.md §24.7): the rules make sense; the six are distinct, named unlike
 * anyone else in the game, at home at an open station with a patch to work, in a ship of the
 * catalogue; no line holds a number of its own; and every run of a sample of their careers adds up
 * (lawful cargo from a station that sells it to one that takes it, a bounty from a board of the
 * patch, a race to a shortage of the patch, real lanes, over before the next turn).
 */
export function validateRivals(rules: RivalRules = RIVALS, roster: readonly RivalDef[] = ROSTER, runs: readonly RivalRun[] = sampleRuns()): Issue[] {
  const issues: Issue[] = [];
  const report = (rule: string, subject: string, message: string) => issues.push({ rule, subject, message });

  // The rules.
  if (rules.turnSeconds <= CONTRACTS.epochSeconds) report('rules', 'turnSeconds', 'a turn no longer than a board’s posting: a hunter could claim twice from one');
  if (rules.rest[0] <= 0 || rules.rest[1] < rules.rest[0] || rules.rest[1] >= rules.turnSeconds) report('rules', 'rest', 'a rest out of order');
  if (rules.trade.load[0] < 1 || rules.trade.load[1] < rules.trade.load[0]) report('rules', 'trade', 'a load out of order');
  if (rules.hunt.claim <= 0 || rules.hunt.claim >= 1 || rules.friendly.claim <= 0 || rules.friendly.claim > 1) report('rules', 'hunt', 'a claim’s price out of 0–1 of the reward');
  if (rules.race.share <= 0 || rules.race.share > 1) report('rules', 'race', 'a share out of 0–1');
  const S = rules.standing;
  if (S.round <= 0 || S.roundsUpTo <= 0 || S.outbid >= 0 || S.shot >= 0 || S.destroyed >= S.shot || S.amends <= 0) report('rules', 'standing', 'standing that moves the wrong way');
  if (S.amendsTo <= -30 || S.amendsTo >= 0) report('rules', 'standing', 'amends that leave a rival hostile, or friendly');
  if (rules.downSeconds < rules.turnSeconds) report('rules', 'downSeconds', 'a knock-out shorter than a turn');

  // The six.
  const taken = new Set<string>([...FIRST_NAMES, ...LAST_NAMES, ...ACE_NAMES.first, ...ACE_NAMES.last, ...ACE_NAMES.nick].map((n) => n.toLowerCase()));
  const people = new Set(Object.values(CHARACTERS).map((c) => c.name.toLowerCase()));
  const ships = new Set([...HAULER_NAMES, ...CONVOY_NAMES].map((n) => n.toLowerCase()));
  const seen = new Set<string>();
  const ids = new Set<string>();
  const styles = new Set<string>();
  const hunted = new Map<string, string>();
  for (const r of roster) {
    if (ids.has(r.id)) report('roster', r.id, 'an id twice');
    ids.add(r.id);
    for (const key of [r.first, r.nick, r.last, r.shipName]) {
      if (seen.has(key.toLowerCase())) report('roster', r.id, `${key} twice`);
      seen.add(key.toLowerCase());
    }
    for (const n of [r.first, r.last, r.nick]) if (taken.has(n.toLowerCase())) report('roster', r.id, `${n}: a name the bars, the aces or the wingmen use`);
    if (people.has(`${r.first} ${r.last}`.toLowerCase())) report('roster', r.id, 'a story character’s name');
    if (ships.has(r.shipName.toLowerCase())) report('roster', r.id, `${r.shipName}: a hauler’s name`);
    const home = ALL_LOCATIONS.find((l) => l.id === r.home);
    if (!home || home.status !== 'functional' || home.dockable === false || home.stationType === 'pirate-den' || !marketTables().has(home.id) || rules.patch.avoid.includes(home.systemId)) report('roster', r.id, `${r.home}: not an open station with a market a rival may work`);
    if (!getCatalog().ships.some((s) => s.id === r.ship)) report('roster', r.id, `${r.ship}: not a ship of the catalogue`);
    if (patchOf(r).length < 3) report('roster', r.id, 'a patch of fewer than three stations');
    if (patchOf(r).some((l) => rules.patch.avoid.includes(l.systemId))) report('roster', r.id, 'a patch in a system rivals avoid');
    styles.add(r.style);
    if (r.style === 'hunter') {
      for (const l of patchOf(r)) {
        if (hunted.has(l.id)) report('roster', r.id, `${l.id}: hunted by ${hunted.get(l.id)} too`);
        hunted.set(l.id, r.id);
      }
    }
  }
  for (const style of ['trader', 'hunter', 'runner']) if (!styles.has(style)) report('roster', style, 'no rival of this style');

  // The lines: no digits; placeholders the line can fill.
  const check = (subject: string, text: string, allowed: readonly string[]) => {
    if (/\d/.test(text)) report('lines', subject, `a number written into the line: “${text}”`);
    for (const [, key] of text.matchAll(/\{(\w+)\}/g)) if (!allowed.includes(key!)) report('lines', subject, `{${key}} it cannot fill`);
  };
  for (const v of Object.keys(GREET) as (keyof typeof GREET)[]) {
    for (const lines of Object.values(GREET[v])) for (const t of lines) check(`greet.${v}`, t, []);
    for (const t of [...ROUND[v], ...REFUSE[v], ...AMENDS[v], ...Object.values(RADIO[v]).flat()]) check(v, t, []);
    for (const t of TIP[v]) check(`tip.${v}`, t, ['doing']);
  }
  const fields = { trade: ['rival', 'good', 'from', 'to'], tradeOn: ['rival', 'good', 'from', 'to'], hunt: ['rival', 'target', 'where'], race: ['rival', 'good', 'to'], raced: ['rival', 'good', 'to'], beaten: ['rival', 'good', 'to'], down: ['rival', 'ship', 'system', 'home'] } as const;
  for (const [k, lines] of Object.entries(NEWS)) for (const t of lines) check(`news.${k}`, t, fields[k as keyof typeof fields]);

  // The runs.
  const tables = marketTables();
  for (const run of runs) {
    const subject = run.id;
    const r = run.rival;
    if (run.arrive > turnStart(run.turn + 1) + rules.rest[0]) report('runs', subject, 'it is not over before the next turn sets off');
    if (run.legs[0]!.start !== run.depart || run.legs.some((l, i) => i > 0 && l.start < run.legs[i - 1]!.end)) report('runs', subject, 'legs out of order');
    for (let i = 1; i < run.legs.length; i++) {
      const a = run.legs[i - 1]!.systemId;
      const b = run.legs[i]!.systemId;
      if (a !== b && !WORLD.links.get(a)?.includes(b)) report('runs', subject, `${a} → ${b} is not a lane`);
    }
    if (run.commodity) {
      const c = COMMODITIES[run.commodity];
      const buy = tables.get(run.via ?? run.from)?.entries.get(run.commodity);
      const sell = tables.get(run.to)?.entries.get(run.commodity);
      if (c.category === 'contraband' || !buy || buy.role === 'consume' || !sell || sell.role === 'produce') report('runs', subject, `${run.commodity}: not lawful cargo its two stations trade that way`);
      if (run.qty < 1) report('runs', subject, 'an empty hold');
    }
    if (run.kind === 'hunt') {
      const c = run.claim!.contract;
      const o = c.objectives[0];
      const home = jumpsFrom(WORLD.links, getLocation(r.home).systemId);
      if (!patchOf(r).some((l) => l.id === run.claim!.giver) || (c.contract?.kind !== 'bounty' && c.contract?.kind !== 'ace')) report('runs', subject, 'a claim that is not a bounty posted in its patch');
      if (o?.kind !== 'bounty' || (home.get(o.systemId) ?? 99) > rules.hunt.reach) report('runs', subject, 'a pack out of reach');
    }
    if (run.kind === 'race') {
      const e = run.shortage!;
      if (e.kind !== 'shortage' || !patchOf(r).some((l) => l.id === e.locationId) || run.to !== e.locationId) report('runs', subject, 'a race to no shortage of its patch');
      const near = jumpsFrom(WORLD.links, getLocation(run.to).systemId);
      if (!run.via || (near.get(getLocation(run.via).systemId) ?? 99) > rules.race.makerJumps) report('runs', subject, 'a maker out of reach');
    }
  }
  return issues;
}

/** Every rival's runs over the first two days of careers. */
export function sampleRuns(turns = 48): RivalRun[] {
  const out: RivalRun[] = [];
  for (const r of ROSTER) for (let n = 0; n < turns; n++) {
    const run = runOf(r, n);
    if (run) out.push(run);
  }
  return out;
}
