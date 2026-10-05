import { createNewGame, type OutpostRecord } from '../app/state.ts';
import { COMMODITIES } from '../content/economy/goods.ts';
import { ACE_NAMES } from '../content/contracts/rules.ts';
import { CREW_FIRST, CREW_LAST } from '../content/crew/lines.ts';
import { ASK_LINES, DONE_LINES, FOLK, FOLK_FIRST, FOLK_LAST, FOLK_RELATIONS, FOLK_SAYS, LAPSE_LINES, SPIRIT_LINES, WORK_WORDS, type AskKind, type FolkTrade } from '../content/outposts/folk.ts';
import { outpostId } from '../content/outposts/sites.ts';
import { FIRST_NAMES, LAST_NAMES } from '../content/people/lines.ts';
import { ROSTER } from '../content/rivals/rules.ts';
import { CHARACTERS } from '../content/story/arcs.ts';
import { MARK_LIMITS } from '../content/story/marks.ts';
import type { Issue } from '../content/validate.ts';
import { jumpsFrom } from '../content/world/network.ts';
import { ALL_LOCATIONS, SYSTEMS, WORLD } from '../data/systems.ts';
import { WING_FIRST, WING_LAST } from './combat.ts';
import { useWorldLog } from './events.ts';
import { FACTIONS } from './factions.ts';
import { advanceFolk, askGoods, completeAsk, ensureFolk, fetchStations, folkPeople, peopleCount, scanBodies, workGood } from './folk.ts';
import { marketTables } from './markets.ts';
import { sampleSites } from './outpostTradeGuards.ts';

/** The rules a guardrail checks (the real ones, or a broken copy in the tests). */
export type FolkRules = typeof FOLK;

const HOUR = 3_600;
const GENDERED = /\b(he|she|him|her|his|hers|himself|herself)\b/i;
/** The bars' portrait looks (§16). */
const LOOKS = ['trader', 'pilot', 'fixer', 'officer', 'miner', 'scientist', 'colonist'];
/** What each kind of line may fill in. */
const ASK_KEYS = ['good', 'who', 'relation', 'station', 'system', 'body', 'outpost'];
const SAYS_KEYS = ['name', 'outpost', 'who', 'station', 'body', 'ask'];

/**
 * Guardrails for the people at the outposts (docs/PROCGEN.md §41.6). The rules: people growing with
 * the stages, the quartermaster first; the spirit's start, steps and bands in order, its income
 * within ±5%; the works within the marks' limits (§14.7), a repair cut of at most a half, the income
 * they add a tenth at most each and the asks' times and sizes sensible. The trades: each asks its
 * own kinds with words for each, wants no restricted good, has a bar's look. The words: only
 * placeholders they can fill, no numbers, no he or she, not too long; names unique and clear of
 * every other pool and place. And over `days` at every sampled site (a port, its asks done as they
 * come): people drawn at every stage, every ask possible (its good made within reach, its station
 * open and one or two jumps off, its body in the system), and every work's good traded there.
 */
export function validateFolk(rules: FolkRules = FOLK, days = 30, sites = sampleSites()): Issue[] {
  const issues: Issue[] = [];
  const report = (rule: string, subject: string, message: string) => issues.push({ rule, subject, message });
  const within = (x: number, [lo, hi]: readonly [number, number]) => Number.isFinite(x) && x >= lo && x <= hi;

  // The rules.
  const P = rules.people;
  if (P.length !== 3 || P[0] !== 1 || !P.every((n, i) => Number.isInteger(n) && (i === 0 || n >= P[i - 1]!)) || P[2]! > 1 + rules.residents.length) report('rules', 'people', 'people not growing from one with the stages, or more than the trades');
  const S = rules.spirit;
  if (!within(S.start, [0, 100]) || !(S.done > 0) || !(S.supplies > 0 && S.supplies <= S.done) || !(S.lapsed < 0) || !(S.held > 0) || !(S.lost < 0)) report('rules', 'spirit', 'a start out of 0–100, or a step the wrong way');
  if (!(S.away.grace >= 0 && S.away.step > 0 && S.away.by > 0)) report('rules', 'spirit.away', 'the time away not falling');
  if (!(S.income[0] >= 0.95 && S.income[0] <= 1 && S.income[1] >= 1 && S.income[1] <= 1.05)) report('rules', 'spirit.income', 'moves the income more than 5% either way');
  if (!(S.bands.low > 0 && S.bands.low < S.bands.glad && S.bands.glad < 100)) report('rules', 'spirit.bands', 'bands out of order');
  const A = rules.asks;
  if (!(A.first > 0 && A.gap[0] > 0 && A.gap[0] <= A.gap[1] && A.lasts >= 24 * HOUR)) report('rules', 'asks', 'asks coming at once, or lasting less than a day');
  if (!(Number.isInteger(A.story) && A.story >= 1 && A.story <= 3)) report('rules', 'asks.story', 'a story of no asks, or too long');
  if (!(A.value[0] > 0 && A.value[0] <= A.value[1] && Number.isInteger(A.qty[0]) && A.qty[0] >= 1 && A.qty[0] <= A.qty[1])) report('rules', 'asks.goods', 'a goods ask of nothing');
  if (!(Number.isInteger(A.jumps) && A.jumps >= 0 && A.jumps <= 3 && A.fetch[0] >= 1 && A.fetch[0] <= A.fetch[1] && A.fetch[1] <= 3)) report('rules', 'asks.reach', 'asks out of reach');
  if (!(rules.firstIncome > 0 && rules.firstIncome <= 0.05)) report('rules', 'firstIncome', 'a first ask worth nothing, or more than 5%');
  if (!(Number.isInteger(rules.greet.max) && rules.greet.max >= 1 && rules.greet.max <= 5 && Number.isInteger(rules.reports) && rules.reports >= 1 && rules.reports <= 10)) report('rules', 'telling', 'lines on docking or reports out of range');
  if ((rules.residents as readonly string[]).includes('quartermaster') || new Set(rules.residents).size !== rules.residents.length) report('rules', 'residents', 'the quartermaster among the residents, or a trade twice');
  let added = rules.firstIncome * P[2]!;
  for (const [trade, t] of Object.entries(rules.trades) as [FolkTrade, (typeof rules.trades)[FolkTrade]][]) {
    if (!LOOKS.includes(t.look)) report('trades', trade, `no bar's look ${t.look}`);
    if (!t.asks.length) report('trades', trade, 'asks nothing');
    if (t.goods.some((g) => !COMMODITIES[g] || COMMODITIES[g].category === 'restricted' || COMMODITIES[g].category === 'contraband')) report('trades', trade, 'wants a restricted good');
    for (const kind of t.asks as readonly AskKind[]) if (!ASK_LINES[trade][kind]) report('words', trade, `no words for a ${kind} ask`);
    const w = t.work;
    if (w.kind === 'income') {
      if (!(w.income > 0 && w.income <= 0.1)) report('trades', trade, 'a work worth more than a tenth of the income');
      added += w.income;
    }
    if (w.kind === 'repair' && !(w.cut > 0 && w.cut <= 0.5)) report('trades', trade, 'a repair cut of more than a half');
    if (w.kind === 'market' && (!within(w.price, MARK_LIMITS.price) || !within(w.stock, MARK_LIMITS.stock) || w.price >= 1 || w.stock <= 1)) report('trades', trade, 'a market work out of the marks’ limits, or no better');
    if (w.kind === 'steady' && !(w.drift > 0 && w.drift < 1)) report('trades', trade, 'a clinic that does nothing');
    if (!WORK_WORDS[trade]?.name) report('words', trade, 'no name for its work');
  }
  if (added > 0.15) report('rules', 'works', `asks done add ${Math.round(added * 100)}% to the income (15% at most)`);
  if (issues.length) return issues;

  // The words.
  const check = (subject: string, text: string, allowed: readonly string[], max = 220) => {
    if (/\d/.test(text)) report('lines', subject, `a number written into the line: “${text}”`);
    if (GENDERED.test(text)) report('lines', subject, `he or she in the line: “${text}”`);
    if (text.length > max) report('lines', subject, `${text.length} characters (at most ${max})`);
    for (const [, key] of text.matchAll(/\{(\w+)\}/g)) if (!allowed.includes(key!)) report('lines', subject, `{${key}} it cannot fill`);
  };
  for (const [trade, kinds] of Object.entries(ASK_LINES)) {
    if (typeof kinds === 'string') check('ask.supplies', kinds, ['good']);
    else for (const [kind, l] of Object.entries(kinds)) for (const [step, text] of Object.entries(l!)) check(`ask.${trade}.${kind}.${step}`, text, ASK_KEYS);
  }
  for (const [trade, l] of Object.entries(DONE_LINES)) {
    if (typeof l === 'string') check('done.supplies', l, []);
    else for (const [step, text] of Object.entries(l)) check(`done.${trade}.${step}`, text, []);
  }
  for (const text of LAPSE_LINES) check('lapse', text, []);
  for (const [band, lines] of Object.entries(SPIRIT_LINES)) for (const text of lines) check(`spirit.${band}`, text, []);
  for (const [key, text] of Object.entries(FOLK_SAYS)) check(`says.${key}`, text, SAYS_KEYS);
  for (const [trade, w] of Object.entries(WORK_WORDS)) check(`work.${trade}`, `${w.name}: ${w.what}`, []);
  for (const r of FOLK_RELATIONS) check('relation', r, []);

  // The names: unique, and clear of every other pool and every place.
  const names = [...FOLK_FIRST, ...FOLK_LAST];
  if (new Set(names).size !== names.length || FOLK_FIRST.length < 16 || FOLK_LAST.length < 16) report('names', 'folk', 'names repeated, or too few');
  const taken = new Set<string>([
    ...FIRST_NAMES,
    ...LAST_NAMES,
    ...CREW_FIRST,
    ...CREW_LAST,
    ...WING_FIRST,
    ...WING_LAST,
    ...ACE_NAMES.first,
    ...ACE_NAMES.last,
    ...ROSTER.flatMap((r) => [r.first, r.nick, r.last]),
    ...Object.values(CHARACTERS).flatMap((c) => c.name.split(' ')),
  ]);
  const places = new Set<string>([...ALL_LOCATIONS.flatMap((l) => l.name.split(/\s+/)), ...SYSTEMS.flatMap((s) => s.displayName.split(/\s+/)), ...Object.values(FACTIONS).flatMap((f) => f.name.split(/\s+/))]);
  for (const n of names) if (taken.has(n) || places.has(n)) report('names', n, 'a name another pool or a place uses');

  // Every sampled site, over the days, its asks done as they come.
  for (const { site, kind } of sites) {
    const state = createNewGame(1);
    const o: OutpostRecord = { site: site.id, kind, name: 'Guardrail Exchange', founded: 0, stage: 3, delivered: {}, since: 0, earned: 0, opened: 0 };
    state.world.outposts = [o];
    useWorldLog(state.world);
    try {
      const at = site.id;
      for (let stage = 1; stage <= 3; stage++) {
        const n = folkPeople(state, { ...o, stage }).length;
        if (n !== peopleCount({ ...o, stage })) report('people', at, `${n} people at stage ${stage}, not ${peopleCount({ ...o, stage })}`);
      }
      const systemId = site.systemId;
      const jumps = jumpsFrom(WORLD.links, systemId);
      const traded = new Set(marketTables().get(outpostId(site.id))?.entries.keys() ?? []);
      ensureFolk(o, 0);
      for (let t = 0; t < days * 24 * HOUR; t += 6 * HOUR) {
        advanceFolk(state, o, t);
        const ask = o.folk!.ask;
        if (!ask) continue;
        const where = `${at}: ask ${ask.n}`;
        if (ask.kind === 'goods' && (!ask.good || !askGoods(systemId, [ask.good]).length || !within(ask.qty ?? 0, A.qty))) report('asks', where, `${ask.qty} ${ask.good}: not made within reach, or too many`);
        if (ask.kind === 'fetch') {
          const l = ALL_LOCATIONS.find((x) => x.id === ask.stationId);
          const j = l ? (jumps.get(l.systemId) ?? 99) : 99;
          if (!l || !fetchStations(systemId).includes(l.id) || j < A.fetch[0] || j > A.fetch[1] || l.stationType === 'pirate-den') report('asks', where, `fetch from ${ask.stationId}: not an open station one or two jumps off`);
        }
        if (ask.kind === 'scan' && !scanBodies(systemId).some((b) => b.id === ask.bodyId)) report('asks', where, `scan of ${ask.bodyId}: not in the system`);
        completeAsk(state, o, t);
      }
      for (const w of o.folk!.works) if (w.good && !traded.has(w.good)) report('works', `${at}: ${w.trade}`, `${w.good}: not traded there`);
      if (o.folk!.works.length < peopleCount(o)) report('works', at, `only ${o.folk!.works.length} works made in ${days} days of asks done`);
      for (const tr of FOLK.residents) {
        const g = workGood(state.seed, o, tr);
        if (g && !traded.has(g)) report('works', `${at}: ${tr}`, `${g}: not traded there`);
      }
    } finally {
      useWorldLog(null);
    }
  }
  return issues;
}
