import { createNewGame, type CrewMember } from '../app/state.ts';
import { COMBAT } from '../content/combat/rules.ts';
import { ACE_NAMES } from '../content/contracts/rules.ts';
import { CREW_FICTION, CREW_FIRST, CREW_GREETING, CREW_LAST, CREW_NOTES, CREW_RADIO, CREW_SAYS, CREW_STORY, HEART_CARES } from '../content/crew/lines.ts';
import { CREW, CREW_DEEDS, CREW_HEARTS, CREW_ROLES, type CrewRules } from '../content/crew/rules.ts';
import { EVENTS } from '../content/events/rules.ts';
import { LANE_LINES } from '../content/lanes/lines.ts';
import { OUTPOST_RAIDS } from '../content/outposts/raids.ts';
import { FIRST_NAMES, LAST_NAMES } from '../content/people/lines.ts';
import { PEOPLE } from '../content/people/rules.ts';
import { ROSTER } from '../content/rivals/rules.ts';
import { CHARACTERS } from '../content/story/arcs.ts';
import type { Issue } from '../content/validate.ts';
import type { StationType } from '../content/world/types.ts';
import { ALL_LOCATIONS, SYSTEMS } from '../data/systems.ts';
import { WING_FIRST, WING_LAST } from './combat.ts';
import { MAX_REWARD } from './contractGuards.ts';
import { favourPlace } from './crew.ts';
import { FACTIONS } from './factions.ts';

const GENDERED = /\b(he|she|him|her|his|hers|himself|herself)\b/i;
const rising = (xs: readonly number[]) => xs.every((x, i) => x > 0 && (i === 0 || x > xs[i - 1]!));

/** What each note may fill in. */
const NOTE_FIELDS: Record<keyof typeof CREW_NOTES, readonly string[]> = {
  hired: ['name', 'role'],
  notice: ['name'],
  stays: ['name'],
  leaves: ['name', 'station'],
  letGo: ['name', 'station'],
  unpaid: ['name'],
  paid: ['credits'],
  hurt: ['name'],
  mended: ['name'],
  treated: ['name'],
  tale: ['name'],
  favour: ['name'],
  done: ['name'],
  graded: ['name', 'grade', 'role'],
  failed: ['name'],
  lapsed: ['name'],
};

/**
 * Guardrails for your crew (docs/PROCGEN.md §30): the bonuses rise with grade and stay modest at their
 * best (under a class step of guns and shields, a quarter off fees at most, half again the scan
 * range, half the lock time), morale's bands and factors in order, wages under a sharp outpost guard's,
 * hurts that mend and a medic no dearer than a system's repair, quarters by size (fighters one,
 * freighters and gunships three); every heart likes and hates something, never the same deed, and
 * every deed matters to some heart; every role can be hired at five open stations or more, one in
 * Sol; every favour has somewhere to go from most docks, time to get there and pay under the
 * contracts' ceiling; the names are their own; and the words hold no number, no he or she, no star,
 * and fit.
 */
export function validateCrew(rules: CrewRules = CREW): Issue[] {
  const issues: Issue[] = [];
  const report = (rule: string, subject: string, message: string) => issues.push({ rule, subject, message });
  const E = rules.effects;
  const best = rules.morale.factor.high;

  // What they do.
  for (const [role, list] of [
    ['engineer.mend', E.engineer.mend],
    ['engineer.shieldRegen', E.engineer.shieldRegen],
    ['gunner.damage', E.gunner.damage],
    ['gunner.lock', E.gunner.lock],
    ['navigator.fee', E.navigator.fee],
    ['navigator.scan', E.navigator.scan],
  ] as const) {
    if (list.length !== 3 || !rising(list)) report('rules', role, 'a bonus not rising with grade');
  }
  const step = 0.18;
  if (E.gunner.damage[2]! * best >= step || E.engineer.shieldRegen[2]! * best >= step) report('balance', 'bonus', 'a veteran in high spirits worth a class step of gear or more');
  if (E.navigator.fee[2]! * best > 0.25) report('balance', 'fee', 'a navigator taking more than a quarter off fees');
  if (E.navigator.scan[2]! * best > 0.5) report('balance', 'scan', 'a navigator adding more than half the scan range');
  if (E.gunner.lock[2]! * best > 0.5) report('balance', 'lock', 'a gunner more than halving lock times');
  if (!(E.engineer.floor > 0 && E.engineer.floor < 100 && E.engineer.quiet > 0)) report('rules', 'engineer', 'mending with no floor (docks would not matter) or no quiet');

  // Morale.
  const M = rules.morale;
  if (!(M.low > 0 && M.low < M.start && M.start < M.high && M.high <= 100)) report('rules', 'morale', 'morale bands out of order, or a start outside Steady');
  if (!(M.factor.low < M.factor.steady && M.factor.steady <= M.factor.high && M.factor.low > 0)) report('rules', 'morale', 'morale factors out of order');
  if (!(M.liked > 0 && M.hated < 0 && M.cap > 0 && M.unpaid < 0 && M.shipLost < 0 && M.hurt < 0 && M.untreated < 0 && M.treated > 0 && M.round.gain > 0 && M.rest.upTo <= M.high)) report('rules', 'morale', 'a morale change the wrong way');

  // Wages, quarters, hurts.
  if (!rising([rules.wage[1], rules.wage[2], rules.wage[3]]) || rules.wage[3] > OUTPOST_RAIDS.guards.perHour.sharp) report('rules', 'wage', 'wages not rising with grade, or dearer than a sharp guard');
  const q = rules.quarters;
  if (q['light-fighter'] !== 1 || q['heavy-fighter'] !== 1 || q.gunship !== 3 || q.freighter !== 3 || Object.values(q).some((n) => !(Number.isInteger(n) && n >= 1 && n <= rules.max))) report('rules', 'quarters', 'quarters not by size (fighters one, freighters and gunships three)');
  const H = rules.hurt;
  if (Object.values(H.odds).some((p) => !(p > 0 && p < 1)) || !(H.navigatorHit > 0 && H.navigatorHit < 1)) report('rules', 'hurt', 'hurt odds out of range');
  if (!(H.mend >= 1_800 && H.mend <= 21_600) || !(H.treat > 0 && H.treat <= COMBAT.systems.repairCost)) report('rules', 'hurt', 'mending too quick or slow, or a medic dearer than a system’s repair');

  // Hearts.
  const covered = new Set<string>();
  for (const heart of CREW_HEARTS) {
    const h = rules.hearts[heart];
    if (!h.likes.length || !h.hates.length) report('hearts', heart, 'a heart that likes or hates nothing');
    if (h.likes.some((d) => h.hates.includes(d))) report('hearts', heart, 'a deed both liked and hated');
    for (const d of [...h.likes, ...h.hates]) covered.add(d);
  }
  for (const d of CREW_DEEDS) if (!covered.has(d)) report('hearts', d, 'a deed no heart cares about');
  for (const [key, deed] of Object.entries(rules.laneDeeds)) {
    const [kind, pick] = key.split('.') as [keyof typeof LANE_LINES, string];
    if (!LANE_LINES[kind] || (pick !== 'lapsed' && !LANE_LINES[kind].options[pick]) || !CREW_DEEDS.includes(deed)) report('hearts', key, 'a lane deed for an encounter or choice that does not exist');
  }

  // Hiring: every role at five open stations or more, one of them in Sol.
  if (rules === CREW) {
    for (const role of CREW_ROLES) {
      const at = ALL_LOCATIONS.filter((l) => l.status === 'functional' && l.stationType !== 'pirate-den' && (rules.offers.where[(l.stationType ?? PEOPLE.curated[l.id] ?? '') as StationType] ?? []).some((r) => r === role || r === 'any'));
      if (at.length < 5 || !at.some((l) => l.systemId === 'sol')) report('hiring', role, `offered at ${at.length} open stations, ${at.filter((l) => l.systemId === 'sol').length} in Sol (five at least, one in Sol)`);
    }
  }

  // Favours: somewhere to go from most docks, time to get there, pay under the ceiling.
  const trip = (reach: number) => reach * (EVENTS.jumpSeconds + 900);
  for (const heart of CREW_HEARTS) {
    const f = rules.stories.favours[heart];
    if (!(f.pay > 0 && f.pay <= MAX_REWARD)) report('favours', heart, 'a favour’s pay out of range');
    if (rules.stories.do < 1.5 * trip(f.reach) || rules.stories.take < rules.stories.favourAfter) report('favours', heart, 'too little time to take or do a favour');
    if (rules === CREW) {
      const state = createNewGame(11);
      const m: CrewMember = { id: `guard.${heart}`, name: 'Test', role: 'engineer', heart, grade: 1, hired: 0, paidTo: 0, morale: 55 };
      const docks = ALL_LOCATIONS.filter((l) => l.status === 'functional' && l.stationType !== 'pirate-den');
      const reached = docks.filter((l) => favourPlace(state, m, l.id)).length;
      if (reached < docks.length * 0.5) report('favours', heart, `somewhere to go from ${reached} of ${docks.length} docks (half at least)`);
    }
  }

  // The names: unique, and clear of every other pool and every place.
  const names = [...CREW_FIRST, ...CREW_LAST];
  if (new Set(names).size !== names.length || CREW_FIRST.length < 16 || CREW_LAST.length < 16) report('names', 'crew', 'crew names repeated, or too few');
  const taken = new Set<string>([
    ...FIRST_NAMES,
    ...LAST_NAMES,
    ...WING_FIRST,
    ...WING_LAST,
    ...ACE_NAMES.first,
    ...ACE_NAMES.last,
    ...ROSTER.flatMap((r) => [r.first, r.nick, r.last]),
    ...Object.values(CHARACTERS).flatMap((c) => c.name.split(' ')),
  ]);
  const places = new Set<string>([...ALL_LOCATIONS.flatMap((l) => l.name.split(/\s+/)), ...SYSTEMS.flatMap((s) => s.displayName.split(/\s+/)), ...Object.values(FACTIONS).flatMap((f) => f.name.split(/\s+/))]);
  for (const n of names) if (taken.has(n) || places.has(n)) report('names', n, 'a crew name another pool or a place uses');

  // The words.
  const stars = SYSTEMS.map((s) => s.displayName.split(' ')[0]!).filter((w) => w.length > 3);
  const check = (subject: string, text: string, allowed: readonly string[], max = 300) => {
    if (/\d/.test(text)) report('lines', subject, `a number written into the line: “${text}”`);
    if (GENDERED.test(text)) report('lines', subject, `he or she in the line: “${text}”`);
    if (text.length > max) report('lines', subject, `${text.length} characters (at most ${max})`);
    for (const [, key] of text.matchAll(/\{(\w+)\}/g)) if (!allowed.includes(key!)) report('lines', subject, `{${key}} it cannot fill`);
    for (const s of stars) if (new RegExp(`\\b${s}\\b`).test(text)) report('lines', subject, `a star written into the line (${s})`);
  };
  for (const [heart, list] of Object.entries(CREW_GREETING)) for (const t of list) check(`greeting.${heart}`, t, []);
  for (const [k, list] of Object.entries(CREW_RADIO)) for (const t of list) check(`radio.${k}`, t, [], 160);
  for (const [k, list] of Object.entries(CREW_SAYS)) for (const t of list) check(`says.${k}`, t, []);
  for (const [heart, beats] of Object.entries(CREW_STORY)) for (const [k, t] of Object.entries(beats)) check(`story.${heart}.${k}`, t, k === 'ask' ? ['station', 'system', 'count'] : []);
  for (const [k, t] of Object.entries(CREW_NOTES)) check(`note.${k}`, t, NOTE_FIELDS[k as keyof typeof CREW_NOTES]);
  for (const [heart, c] of Object.entries(HEART_CARES)) for (const t of [c.likes, c.hates]) check(`cares.${heart}`, t, []);
  if (/\d/.test(CREW_FICTION) || !CREW_FICTION.startsWith('Fiction:')) report('lines', 'fiction', 'the fiction line');
  return issues;
}
