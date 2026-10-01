import { describe, expect, it } from 'vitest';
import { migrateSave } from '../../src/app/save/migrate.ts';
import { createNewGame, type GameState } from '../../src/app/state.ts';
import { CODEX_GRANT, MILESTONES, RATINGS, SURVEY_SALE } from '../../src/content/progress/rules.ts';
import { ALL_LOCATIONS, SYSTEMS } from '../../src/data/systems.ts';
import { whatNext } from '../../src/economy/advisor.ts';
import { gearForSale, shipsForSale } from '../../src/content/catalog.ts';
import { HINT } from '../../src/content/progress/rules.ts';
import { hasOutfitter, hasShipyard } from '../../src/economy/equipment.ts';
import { hullMax } from '../../src/economy/loadout.ts';
import { FACTIONS } from '../../src/economy/factions.ts';
import { dockAccess } from '../../src/economy/law.ts';
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
  it('suggests one thing to do: fines first, then the hold, a story, the codex, a route, a job board', () => {
    const s = pilot();
    s.location = { systemId: 'tau-ceti', dockedAt: null, flight: null, lastDockId: 'earth-port' };
    s.law.fines.frontier = 300;
    expect(whatNext(s)).toMatch(/fines/);
    delete s.law.fines.frontier;
    expect(whatNext(s)).toMatch(/Rhea Castell at Halcyon Ring \(Sol\) has work for you: “Clean Manifests”/);
    // With a story mission under way, the hint moves on.
    s.jobs['arc.frontier.1'] = { status: 'active', objectiveIndex: 0, acceptedAt: 0 };
    expect(whatNext(s)).toMatch(/^Catalogue /);
    for (const e of codexEntries().filter((x) => x.systemId === 'tau-ceti')) catalogue(s, e.id);
    expect(whatNext(s)).toMatch(/job board|Trade idea/);
  });

  it('puts a badly damaged ship’s repairs before anything but fines, with where and what they cost', () => {
    const s = pilot();
    s.jobs['arc.sta.1'] = { status: 'active', objectiveIndex: 0, acceptedAt: 0 };
    s.location = { systemId: 'sol', dockedAt: null, flight: null, lastDockId: 'earth-port' };
    s.ship.hull = Math.floor(hullMax(s.ship) * 0.3);
    expect(whatNext(s)).toMatch(/^Repairs first: your hull is at 3\d%\. The mechanic at .+ charges about \d+ cr\.$/);
    s.ship.hull = hullMax(s.ship);
    s.ship.systems = { engines: 0, guns: 0, shields: 0.6 };
    expect(whatNext(s)).toMatch(/^Repairs first: your shield generator is damaged\./);
    s.law.fines.sta = 200;
    expect(whatNext(s)).toMatch(/fines/);
  });

  it('suggests a ship or the long-range drive the player can afford where they have seen it, leaving money in hand', () => {
    const s = pilot();
    s.jobs['arc.sta.1'] = { status: 'active', objectiveIndex: 0, acceptedAt: 0 };
    s.location = { systemId: 'tau-ceti', dockedAt: null, flight: null, lastDockId: 'earth-port' };
    for (const e of codexEntries().filter((x) => x.systemId === 'tau-ceti')) catalogue(s, e.id);
    const yard = ALL_LOCATIONS.find((l) => hasShipyard(l.id) && l.systemId !== 'sol' && shipsForSale(l.id).length > 1)!;
    s.visitedLocations.push(yard.id);
    s.credits = 200_000;
    expect(whatNext(s)).toMatch(new RegExp(`^An upgrade you can afford: the .+ at ${yard.name} \\(.+\\) costs \\d+ cr after trading in your ship, with room for \\d+ units \\(yours: \\d+\\)\\.$`));
    // Not with only the reserve to spend.
    s.credits = HINT.reserve;
    expect(whatNext(s)).not.toMatch(/upgrade/);
    // The drive: once the player has travelled, at an outfitter they know, until the frontier.
    const outfitter = ALL_LOCATIONS.find((l) => hasOutfitter(l.id) && !hasShipyard(l.id) && dockAccess(s, l.id) === 'full' && gearForSale(l.id).some((g) => g.family === 'jump-drive'))!;
    s.visitedLocations = [outfitter.id];
    s.credits = 20_000;
    s.stats.jumps = HINT.driveAfterJumps - 1;
    expect(whatNext(s) ?? '').not.toMatch(/long-range/);
    s.stats.jumps = HINT.driveAfterJumps;
    expect(whatNext(s)).toMatch(new RegExp(`^The frontier past 17\\.5 light-years needs a long-range jump drive: ${outfitter.name} \\(.+\\) sells one for \\d+ cr\\.$`));
    s.milestones['frontier-first'] = 1;
    expect(whatNext(s) ?? '').not.toMatch(/long-range/);
  });

  it('says how much standing makes a lawful faction Friendly, when it is close', () => {
    const s = pilot();
    s.jobs['arc.sta.1'] = { status: 'active', objectiveIndex: 0, acceptedAt: 0 };
    s.location = { systemId: 'tau-ceti', dockedAt: null, flight: null, lastDockId: 'earth-port' };
    for (const e of codexEntries().filter((x) => x.systemId === 'tau-ceti')) catalogue(s, e.id);
    s.reputation = { sta: 7, frontier: 0, 'hollow-wake': 0 };
    expect(whatNext(s)).toBe(`3 more standing with the ${FACTIONS.sta.name} makes you Friendly: its boards then offer their hardest, best-paid work.`);
    s.reputation.sta = 10;
    expect(whatNext(s) ?? '').not.toMatch(/standing/);
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
