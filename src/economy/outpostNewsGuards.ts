import { createNewGame } from '../app/state.ts';
import { EVENTS, type StationEventKind } from '../content/events/rules.ts';
import { OUTPOSTS } from '../content/outposts/rules.ts';
import { outpostId } from '../content/outposts/sites.ts';
import type { Issue } from '../content/validate.ts';
import { getLocation } from '../data/systems.ts';
import { stationEventsBetween, useWorldLog } from './events.ts';
import { makersNear, reliefHauls } from './hauls.ts';
import { marketTables } from './markets.ts';
import { newsFactor } from './outposts.ts';
import { sampleSites } from './outpostTradeGuards.ts';

/** The rules a guardrail checks (the real ones, or a broken copy in the tests). */
export interface NewsRules {
  readonly income: Readonly<Record<StationEventKind, number>>;
  readonly maxReports: number;
}

const HOUR = 3_600;
const BELOW: readonly StationEventKind[] = ['shortage', 'glut', 'strike'];
const ABOVE: readonly StationEventKind[] = ['boom', 'harvest', 'survey'];
/** The roles of the goods each kind of event concerns at a station. */
const ROLES: Record<StationEventKind, readonly string[]> = {
  shortage: ['consume'],
  glut: ['produce'],
  strike: ['produce'],
  harvest: ['produce'],
  survey: ['consume'],
  boom: ['consume', 'trade'],
};

/**
 * Guardrails for the outposts' news (docs/PROCGEN.md §39.6): the rules make sense (a factor for every
 * kind of station event, from a half to one and a half; below one for shortages, gluts and strikes,
 * above it for booms, harvests and survey seasons; a whole number of reports, one to ten); and over
 * `days` at every sampled site, with the outpost a port: no event starts before it opened or overlaps
 * another; each concerns goods its market deals in the right way; a shortage's relief comes from
 * makers within reach; and the events move its income by a tenth at most, on average over the days.
 */
export function validateOutpostNews(rules: NewsRules = OUTPOSTS.news, days = 10, sites = sampleSites()): Issue[] {
  const issues: Issue[] = [];
  const report = (rule: string, subject: string, message: string) => issues.push({ rule, subject, message });

  for (const kind of Object.keys(EVENTS.stationOdds) as StationEventKind[]) {
    const f = rules.income[kind];
    if (!(f >= 0.5 && f <= 1.5)) report('rules', kind, `an income factor of ${f} (a half to one and a half)`);
    else if (BELOW.includes(kind) && f > 1) report('rules', kind, 'raises the income');
    else if (ABOVE.includes(kind) && f < 1) report('rules', kind, 'cuts the income');
  }
  if (!Number.isInteger(rules.maxReports) || rules.maxReports < 1 || rules.maxReports > 10) report('rules', 'maxReports', 'not a whole number from one to ten');
  if (issues.length) return issues;

  const opened = 6 * HOUR;
  for (const { site, kind } of sites) {
    const id = outpostId(site.id);
    const state = createNewGame(1);
    const o = { site: site.id, kind, name: 'Guardrail Exchange', founded: 0, stage: OUTPOSTS.stages.length, delivered: {}, since: opened, earned: 0, opened };
    state.world.outposts = [o];
    useWorldLog(state.world);
    try {
      const events = stationEventsBetween(id, 0, days * 24 * HOUR);
      let last = -Infinity;
      for (const e of events) {
        const at = `${site.id}: ${e.id}`;
        if (e.start < opened) report('events', at, 'starts before the outpost opened');
        if (e.start < last) report('events', at, 'overlaps the event before it');
        last = e.end;
        const table = marketTables().get(id);
        for (const g of e.goods) {
          const role = table?.entries.get(g)?.role;
          if (!role || !ROLES[e.kind as StationEventKind].includes(role)) report('events', at, `${g}: not a good its market ${ROLES[e.kind as StationEventKind].join(' or ')}s`);
        }
        if (e.kind === 'shortage') {
          const makers = new Set(makersNear(getLocation(id), e.goods[0]!, 3).map((l) => l.id));
          for (const h of reliefHauls(e)) if (!makers.has(h.from) || h.to !== id) report('events', at, `relief from ${h.from}, not a maker within reach`);
        }
      }
      // What the events do to its income, on average over the days (its system's raids and sweeps move it besides, §22.4).
      let sum = 0;
      const hours = days * 24 - opened / HOUR;
      for (let k = 0; k < hours; k++) sum += newsFactor(o, opened + k * HOUR + HOUR / 2);
      if (Math.abs(sum / hours - 1) > 0.1) report('income', site.id, `the events move its income by ${Math.round((sum / hours - 1) * 100)}% on average`);
    } finally {
      useWorldLog(null);
    }
  }
  return issues;
}
