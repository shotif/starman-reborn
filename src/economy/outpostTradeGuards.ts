import { createNewGame, type OutpostRecord } from '../app/state.ts';
import { COMMODITIES } from '../content/economy/goods.ts';
import { HAULS } from '../content/economy/hauls.ts';
import { CONTRACTS } from '../content/contracts/rules.ts';
import { OUTPOSTS } from '../content/outposts/rules.ts';
import { outpostId, outpostSites, type OutpostSite } from '../content/outposts/sites.ts';
import type { Issue } from '../content/validate.ts';
import { getLocation, WORLD } from '../data/systems.ts';
import { useWorldLog } from './events.ts';
import { dockFee, haulById, made, outpostDockings } from './hauls.ts';
import { marketTables } from './markets.ts';

/** The rules a guardrail checks (the real ones, or a broken copy in the tests). */
export interface TradeRules {
  readonly send: readonly number[];
  readonly draw: readonly number[];
  readonly fee: number;
  readonly feeHours: number;
  readonly board: { readonly jumps: number; readonly chance: number; readonly passage: number };
}

const HOUR = 3_600;

/** The sites the guardrail samples: every belt site, and the first planet site that allows each kind. */
export function sampleSites(sites: readonly OutpostSite[] = outpostSites()): { site: OutpostSite; kind: OutpostRecord['kind'] }[] {
  const out: { site: OutpostSite; kind: OutpostRecord['kind'] }[] = sites.filter((s) => s.beltId).map((site) => ({ site, kind: site.kinds[0]! }));
  for (const kind of OUTPOSTS.kinds) {
    const site = sites.find((s) => !s.beltId && s.kinds.includes(kind));
    if (site) out.push({ site, kind });
  }
  return out;
}

/**
 * Guardrails for the outposts' trade (docs/PROCGEN.md §38.7): the rules make sense (a chance for
 * each stage, from nothing to a half, never falling as it grows; the fee above nothing and a tenth
 * at most; the fee hours whole, a day at least and no more than the income settles hour by hour;
 * the board's chance and share from nothing to one, its reach one to three jumps and within the
 * freight's and passages'); and over `hours` at every sampled site, with the outpost open at each
 * stage, every haul from or to it goes from a station that makes its cargo to one that takes it,
 * within reach over real lanes, its load within bounds, its id found again, and the fees an hour
 * a quarter of the stage's income at most.
 */
export function validateOutpostTrade(rules: TradeRules = OUTPOSTS.trade, hours = 24, sites = sampleSites()): Issue[] {
  const issues: Issue[] = [];
  const report = (rule: string, subject: string, message: string) => issues.push({ rule, subject, message });

  for (const k of ['send', 'draw'] as const) {
    const c = rules[k];
    if (c.length !== OUTPOSTS.stages.length) report('rules', k, `${c.length} chances for ${OUTPOSTS.stages.length} stages`);
    c.forEach((x, i) => {
      if (!(x >= 0 && x <= 0.5)) report('rules', k, `stage ${i + 1}: a chance of ${x} (nothing to a half)`);
      if (i > 0 && x < c[i - 1]!) report('rules', k, `stage ${i + 1}: fewer haulers than the stage before`);
    });
  }
  if (!(rules.fee > 0 && rules.fee <= 0.1)) report('rules', 'fee', `a fee of ${rules.fee} (above nothing, a tenth at most)`);
  if (!Number.isInteger(rules.feeHours) || rules.feeHours < 24 || rules.feeHours > OUTPOSTS.maxHoursPerSettle) report('rules', 'feeHours', 'not a whole number of hours from a day to what the income settles hour by hour');
  const B = rules.board;
  if (!(B.chance >= 0 && B.chance <= 1)) report('rules', 'board', `a chance of ${B.chance}`);
  if (!(B.passage >= 0 && B.passage <= 1)) report('rules', 'board', `a passage share of ${B.passage}`);
  if (!Number.isInteger(B.jumps) || B.jumps < 1 || B.jumps > 3 || B.jumps > CONTRACTS.maxJumps.freight || B.jumps > CONTRACTS.maxJumps.passage) report('rules', 'board', `a reach of ${B.jumps} jumps`);
  if (issues.length) return issues;

  for (const { site, kind } of sites) {
    const id = outpostId(site.id);
    for (let stage = 1; stage <= OUTPOSTS.stages.length; stage++) {
      const state = createNewGame(1);
      state.world.outposts = [{ site: site.id, kind, name: 'Guardrail Exchange', founded: 0, stage, delivered: {}, since: 0, earned: 0, opened: 0 }];
      useWorldLog(state.world);
      try {
        const at = `${site.id} at stage ${stage}`;
        const dockings = outpostDockings(id, 0, hours * HOUR);
        for (const { haul: h } of dockings) {
          const bad = (message: string) => report('hauls', at, `${h.id}: ${message}`);
          if (h.from !== id && h.to !== id) bad('neither from the outpost nor to it');
          if (COMMODITIES[h.commodity].category === 'contraband') bad('contraband');
          if (!made(h.from).includes(h.commodity)) bad(`${h.from} does not make ${h.commodity}`);
          const takes = marketTables().get(h.to)?.entries.get(h.commodity);
          if (!takes || takes.role === 'produce') bad(`${h.to} does not take ${h.commodity}`);
          if (h.path.length - 1 > HAULS.maxJumps) bad('beyond reach');
          if (h.path[0] !== getLocation(h.from).systemId || h.path.at(-1) !== getLocation(h.to).systemId) bad('a way that does not join its ends');
          for (let i = 1; i < h.path.length; i++) if (!WORLD.links.get(h.path[i - 1]!)?.includes(h.path[i]!)) bad(`no lane ${h.path[i - 1]}–${h.path[i]}`);
          if (h.qty < HAULS.load.min || h.qty > HAULS.load.max) bad(`a load of ${h.qty}`);
          if (JSON.stringify(haulById(h.id)) !== JSON.stringify(h)) bad('not found again by its id');
        }
        const perHour = dockings.reduce((sum, d) => sum + dockFee(d.haul), 0) / hours;
        const income = OUTPOSTS.stages[stage - 1]!.income;
        if (perHour > income / 4) report('fees', at, `${Math.round(perHour)} cr an hour in fees (at most ${income / 4})`);
      } finally {
        useWorldLog(null);
      }
    }
  }
  return issues;
}
