import { LOG_FILTERS, LOG_KINDS, LOG_LINES, LOGBOOK } from '../content/progress/logbook.ts';
import { MILESTONES } from '../content/progress/rules.ts';
import type { Issue } from '../content/validate.ts';
import { COMET_DATA } from '../data/comets.ts';
import { isInventedSystem, SYSTEMS, systemDistance } from '../data/systems.ts';

/** The rules a guardrail checks (the real ones, or a broken copy in the tests). */
export type LogbookRules = typeof LOGBOOK;

/** The map's single hops (ly), shortest first. */
export function hopLengths(): number[] {
  return SYSTEMS.flatMap((s) => s.jumpLinks.map((t) => systemDistance(s.id, t))).sort((a, b) => a - b);
}

/**
 * Logbook guardrails (docs/PROCGEN.md §46.6): something kept and some shown; the milestones drawn
 * from it reachable on the map and not already covered (a jump longer than the median hop and no
 * longer than the longest, a distance a real star on the map reaches, no more comets than Sol has);
 * every kind of entry with a line and in exactly one filter; and no line with a number of its own or
 * a field it cannot fill.
 */
export function validateLogbook(rules: LogbookRules = LOGBOOK, lines: Readonly<Record<string, string | Readonly<Record<string, string>>>> = LOG_LINES): Issue[] {
  const issues: Issue[] = [];
  const report = (rule: string, subject: string, message: string) => issues.push({ rule, subject, message });
  if (!(rules.keep >= 50 && rules.keep <= 1_000 && rules.latest >= 1 && rules.latest < rules.keep)) report('keep', 'keep', 'too little or too much kept, or shown');
  const hops = hopLengths();
  const median = hops[Math.floor(hops.length / 2)]!;
  const m = rules.milestones;
  if (!(m.jumpLy > median && m.jumpLy <= hops.at(-1)!)) report('milestones', 'jumpLy', `a jump of ${m.jumpLy} ly: the median hop is ${median.toFixed(1)}, the longest ${hops.at(-1)!.toFixed(1)}`);
  const farthest = Math.max(...SYSTEMS.filter((s) => !isInventedSystem(s.id)).map((s) => s.distanceLightYears));
  if (!(m.farLy > 0 && m.farLy <= farthest)) report('milestones', 'farLy', `${m.farLy} ly from Sol: no real star on the map is so far`);
  if (!(m.comets >= 1 && m.comets <= COMET_DATA.comets.length)) report('milestones', 'comets', `${m.comets} comets: Sol has ${COMET_DATA.comets.length}`);
  if (!(m.ships >= 2)) report('milestones', 'ships', 'a milestone every pilot has from the start');
  for (const id of ['jump-long', 'far-out', 'comets-five', 'ships-five']) if (!MILESTONES.some((x) => x.id === id)) report('milestones', id, 'not among the milestones');

  // Every kind with a line, and in exactly one filter.
  for (const k of LOG_KINDS) {
    if (!(k in lines)) report('lines', k, 'no line');
    const n = LOG_FILTERS.filter((f) => f.kinds.includes(k)).length;
    if (n !== 1) report('filters', k, `in ${n} filters`);
  }
  const fields: Record<string, readonly string[]> = {
    signed: ['place'],
    begun: ['count'],
    visit: ['system'],
    ship: ['ship'],
    story: ['arc'],
    rank: ['rank', 'faction'],
    milestone: ['milestone'],
    race: ['course'],
    outpost: ['station'],
    towed: ['system', 'place'],
    comet: ['comet'],
    planet: ['planet'],
  };
  for (const [k, v] of Object.entries(lines)) {
    for (const text of typeof v === 'string' ? [v] : Object.values(v)) {
      if (/\d/.test(text)) report('lines', k, `a number written into the line: “${text}”`);
      for (const [, key] of text.matchAll(/\{(\w+)\}/g)) if (!fields[k]?.includes(key!)) report('lines', k, `{${key}} it cannot fill`);
    }
  }
  return issues;
}
