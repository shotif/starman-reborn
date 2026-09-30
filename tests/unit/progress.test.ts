import { describe, expect, it } from 'vitest';
import { migrateSave } from '../../src/app/save/migrate.ts';
import { createNewGame, type GameState } from '../../src/app/state.ts';
import { CODEX_GRANT, MILESTONES, RATINGS, SURVEY_SALE } from '../../src/content/progress/rules.ts';
import { ALL_LOCATIONS, SYSTEMS } from '../../src/data/systems.ts';
import { whatNext } from '../../src/economy/advisor.ts';
import {
  buysSurveys,
  catalogue,
  checkMilestones,
  codexEntries,
  codexProgress,
  rating,
  sellSurvey,
  surveysForSale,
  surveyValue,
  systemSurveyed,
} from '../../src/economy/progress.ts';
import { sceneDefFor } from '../../src/world/systems/index.ts';

/** Goals (docs/PROCGEN.md §13): the codex of the real sky, survey sales, ratings, milestones, what next. */

function pilot(): GameState {
  const s = createNewGame(31);
  s.jobs.lifeline = { status: 'complete', objectiveIndex: 4, acceptedAt: 0, completedAt: 1 };
  return s;
}

describe('the codex of the real sky', () => {
  it('lists every catalogued star, confirmed planet and the Solar System’s bodies, each one scannable in its scene', () => {
    const entries = codexEntries();
    const stars = SYSTEMS.reduce((n, s) => n + s.componentIds.length, 0);
    const planets = SYSTEMS.reduce((n, s) => n + s.confirmedBodies.length, 0);
    expect(entries.filter((e) => e.kind === 'star')).toHaveLength(stars);
    expect(entries.filter((e) => e.kind === 'planet' && e.systemId !== 'sol')).toHaveLength(planets);
    expect(entries.filter((e) => e.systemId === 'sol').map((e) => e.id)).toEqual(expect.arrayContaining(['sun', 'earth', 'mars', 'jupiter', 'moon']));
    expect(new Set(entries.map((e) => e.id)).size).toBe(entries.length);
    for (const s of SYSTEMS) {
      const def = sceneDefFor(s.id);
      const scannable = new Set([...def.stars.map((x) => x.id), ...def.planets.map((p) => p.id)]);
      for (const e of entries.filter((x) => x.systemId === s.id)) expect(scannable.has(e.id), `${e.id} in ${s.id}`).toBe(true);
    }
  });

  it('records a scan once, ignores anything off the catalogue, and counts progress', () => {
    const s = pilot();
    const first = codexEntries()[0]!;
    expect(catalogue(s, first.id)).toBe(true);
    expect(catalogue(s, first.id)).toBe(false);
    expect(catalogue(s, 'sirius-b-close')).toBe(false);
    expect(codexProgress(s)).toEqual({ done: 1, total: codexEntries().length });
  });

  it('research stations buy a completed survey once', () => {
    const s = pilot();
    const system = SYSTEMS.find((x) => x.id !== 'sol' && x.confirmedBodies.length > 0)!;
    const lab = ALL_LOCATIONS.find((l) => buysSurveys(l.id))!;
    const other = ALL_LOCATIONS.find((l) => !buysSurveys(l.id) && l.dockable !== false)!;
    expect(systemSurveyed(s, system.id)).toBe(false);
    for (const e of codexEntries().filter((x) => x.systemId === system.id)) catalogue(s, e.id);
    expect(systemSurveyed(s, system.id)).toBe(true);
    expect(surveysForSale(s)).toContain(system.id);
    expect(surveyValue(system.id)).toBeGreaterThanOrEqual(SURVEY_SALE.min);
    expect(sellSurvey(s, system.id, other.id).ok).toBe(false);
    const before = s.credits;
    expect(sellSurvey(s, system.id, lab.id)).toMatchObject({ ok: true });
    expect(s.credits).toBe(before + surveyValue(system.id));
    expect(sellSurvey(s, system.id, lab.id).ok).toBe(false);
    expect(surveysForSale(s)).not.toContain(system.id);
  });
});

describe('ratings and milestones', () => {
  it('ranks follow the career record', () => {
    const s = pilot();
    expect(rating(s, 'combat')).toMatchObject({ rank: RATINGS.combat.ranks[0]![0], index: 0 });
    s.stats.kills = 25;
    expect(rating(s, 'combat').rank).toBe('Hardened');
    s.stats.rewards = 1_000;
    s.stats.sales = 4_000;
    expect(rating(s, 'trade')).toMatchObject({ score: 2_000, rank: 'Dealer' });
    s.stats.kills = 10_000;
    expect(rating(s, 'combat').next).toBeNull();
  });

  it('milestones are earned once, and cataloguing the whole sky pays the grant', () => {
    const s = pilot();
    s.stats.deliveries = 1;
    expect(checkMilestones(s).map((m) => m.id)).toContain('first-contract');
    expect(checkMilestones(s)).toEqual([]);
    for (const e of codexEntries()) catalogue(s, e.id);
    const before = s.credits;
    const earned = checkMilestones(s).map((m) => m.id);
    expect(earned).toEqual(expect.arrayContaining(['codex-half', 'codex-all', 'planets-10']));
    expect(s.credits).toBe(before + CODEX_GRANT);
    expect(MILESTONES.every((m) => m.title.trim().length > 0)).toBe(true);
  });
});

describe('what next', () => {
  it('suggests one thing to do: fines first, then the hold, the codex, a route, a job board', () => {
    const s = pilot();
    s.location = { systemId: 'tau-ceti', dockedAt: null, flight: null, lastDockId: 'earth-port' };
    s.law.fines.frontier = 300;
    expect(whatNext(s)).toMatch(/fines/);
    delete s.law.fines.frontier;
    expect(whatNext(s)).toMatch(/^Catalogue /);
    for (const e of codexEntries().filter((x) => x.systemId === 'tau-ceti')) catalogue(s, e.id);
    expect(whatNext(s)).toMatch(/job board|Trade idea/);
  });
});

describe('progress saves', () => {
  it('a v6 save starts its codex from the planets already scanned', () => {
    const { law: _l, codex: _c, surveysSold: _s, milestones: _m, ...rest } = createNewGame(5);
    const planet = SYSTEMS.find((x) => x.confirmedBodies.length)!.confirmedBodies[0]!.id;
    const v6 = { ...structuredClone(rest), version: 6, discoveredBodies: [planet, 'sirius-b-close'], stats: { kills: 2, jumps: 1, deliveries: 1, deaths: 0 } };
    const s = migrateSave(v6);
    expect(s.codex).toEqual([planet]);
    expect(s.milestones).toEqual({});
    expect(s.stats).toMatchObject({ kills: 2, sales: 0, rewards: 0 });
  });
});
