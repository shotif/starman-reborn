import { describe, expect, it } from 'vitest';
import { dockAt, discoverBody, performJump, rescueAfterDefeat, routeFee } from '../../src/app/rules.ts';
import { assertValidState } from '../../src/app/save/migrate.ts';
import { createNewGame, markVisited, type GameState } from '../../src/app/state.ts';
import { LOG_FILTERS, LOG_KINDS, LOG_LINES, LOGBOOK } from '../../src/content/progress/logbook.ts';
import { ARC_JOBS } from '../../src/content/story/arcs.ts';
import { COMET_DATA } from '../../src/data/comets.ts';
import { ALL_LOCATIONS, EXOPLANETS, getLocation, SYSTEMS } from '../../src/data/systems.ts';
import { gearForSale, shipsForSale } from '../../src/content/catalog.ts';
import type { SystemId } from '../../src/data/types.ts';
import { buyShip, shipOffers } from '../../src/economy/equipment.ts';
import { useWorldLog } from '../../src/economy/events.ts';
import { buyAndKeep, keepOffer } from '../../src/economy/fleet.ts';
import { advanceJobs } from '../../src/economy/jobs.ts';
import { farthestVisited, logBests, logbookOf, logDate, logText, logWrite, noteComet } from '../../src/economy/logbook.ts';
import { hopLengths, validateLogbook, type LogbookRules } from '../../src/economy/logbookGuards.ts';
import { charterOffers, charterOutpost } from '../../src/economy/outposts.ts';
import { checkMilestones } from '../../src/economy/progress.ts';
import { clubRecord, enterRace, finishRace } from '../../src/economy/racing.ts';
import { findRoute } from '../../src/galaxy/routing.ts';

/**
 * The pilot's logbook (docs/PROCGEN.md §46): its guardrails, every kind of entry written through the
 * game's own functions, the bests, the milestones drawn from it, a logbook begun for an old save, and
 * the record kept within its size.
 */

function pilot(seed = 3): GameState {
  const s = createNewGame(seed, new Date('2026-10-06T00:00:00Z'));
  s.jobs.lifeline = { status: 'complete', objectiveIndex: 4, acceptedAt: 0, completedAt: 1 };
  s.flags.clearance = true;
  s.credits = 500_000;
  s.clock = 10_000;
  useWorldLog(s.world);
  return s;
}

const kinds = (s: GameState) => logbookOf(s).entries.map((e) => e.kind);

describe('the rules', () => {
  it('pass their guardrails', () => {
    expect(validateLogbook()).toEqual([]);
  });

  it('catch broken ones: a jump no hop reaches, a star farther than the map, a kind with no filter, a line with a number', () => {
    const rules = (change: (m: { jumpLy: number; farLy: number; comets: number }) => void) => {
      const r = structuredClone(LOGBOOK) as unknown as { milestones: { jumpLy: number; farLy: number; comets: number } };
      change(r.milestones);
      return validateLogbook(r as unknown as LogbookRules).map((i) => i.rule);
    };
    expect(rules((m) => (m.jumpLy = 40))).toContain('milestones');
    expect(rules((m) => (m.jumpLy = 1))).toContain('milestones');
    expect(rules((m) => (m.farLy = 300))).toContain('milestones');
    expect(rules((m) => (m.comets = COMET_DATA.comets.length + 1))).toContain('milestones');
    const lines = { ...LOG_LINES, visit: 'First arrival in {system}, 3 days out.' };
    expect(validateLogbook(LOGBOOK, lines).map((i) => i.rule)).toContain('lines');
    const filters = LOG_FILTERS as unknown as { kinds: string[] }[];
    const was = filters[0]!.kinds;
    try {
      filters[0]!.kinds = was.filter((k) => k !== 'visit');
      expect(validateLogbook().map((i) => i.rule)).toContain('filters');
    } finally {
      filters[0]!.kinds = was;
    }
    // The thresholds as the map has them.
    const hops = hopLengths();
    expect(LOGBOOK.milestones.jumpLy).toBeLessThan(hops.at(-1)!);
    expect(LOG_KINDS.every((k) => k in LOG_LINES)).toBe(true);
  });
});

describe('what is written', () => {
  it('a new pilot signs on at Earth Port, dated on the game’s calendar', () => {
    const s = createNewGame(1, new Date('2026-10-06T00:00:00Z'));
    expect(s.logbook!.entries).toEqual([{ at: 0, kind: 'signed', where: 'earth-port' }]);
    expect(logText(s.logbook!.entries[0]!)).toBe(`Signed on at ${getLocation('earth-port').name}.`);
    expect(logDate(s, 0)).toBe('6 October 2026');
    expect(logDate(s, 86_400 * 3)).toBe('9 October 2026');
    assertValidState(s);
  });

  it('every kind, through the game’s own functions: a jump, ships, a finale, a promotion, a milestone, a race, a charter, a tow home, a comet and a planet', () => {
    const s = pilot();
    // A jump: the systems reached for the first time, and the longest hop.
    const route = findRoute(SYSTEMS, 'sol', 'alpha-centauri')!;
    performJump(s, route, routeFee(s, route));
    const visit = logbookOf(s).entries.at(-1)!;
    expect(visit).toMatchObject({ kind: 'visit', id: 'alpha-centauri', at: s.clock });
    expect(logText(visit)).toBe('First arrival in Alpha Centauri.');
    expect(logbookOf(s).bests.jump).toMatchObject({ from: 'sol', to: 'alpha-centauri' });
    // Again: no second first arrival.
    const back = findRoute(SYSTEMS, 'alpha-centauri', 'sol')!;
    performJump(s, back, routeFee(s, back));
    expect(kinds(s).filter((k) => k === 'visit')).toHaveLength(1);

    // Ships: one traded in for, one bought and the old kept.
    s.location = { systemId: 'sol', dockedAt: 'earth-port', flight: null, lastDockId: 'earth-port' };
    const offer = shipOffers(s, 'earth-port').find((o) => !o.blocked)!;
    expect(buyShip(s, 'earth-port', offer.model.id).ok).toBe(true);
    expect(logText(logbookOf(s).entries.at(-1)!)).toBe(`Took the ${offer.model.name}, trading in the old ship.`);
    const other = shipOffers(s, 'earth-port').find((o) => !o.blocked && o.model.id !== offer.model.id && keepOffer(s, 'earth-port', o.model.id) && !keepOffer(s, 'earth-port', o.model.id)!.blocked)!;
    expect(buyAndKeep(s, 'earth-port', other.model.id).ok).toBe(true);
    expect(logbookOf(s).entries.at(-1)).toMatchObject({ kind: 'ship', id: other.model.id, x: 'kept', where: 'earth-port' });
    expect(logbookOf(s).ships).toEqual(expect.arrayContaining([offer.model.id, other.model.id]));

    // A finale flown to its end: the story, and the biggest pay.
    const finale = ARC_JOBS.find((j) => j.story?.finale && j.objectives[0]!.kind === 'bounty')!;
    const hunt = finale.objectives[0] as { systemId: SystemId; count: number };
    s.jobs[finale.id] = { status: 'active', objectiveIndex: 0, acceptedAt: s.clock, kills: hunt.count };
    s.location = { systemId: hunt.systemId, dockedAt: null, flight: null, lastDockId: 'earth-port' };
    advanceJobs(s, { dockedAt: null, systemId: hunt.systemId });
    expect(s.jobs[finale.id]!.status).toBe('complete');
    expect(logbookOf(s).entries.find((e) => e.kind === 'story')).toMatchObject({ id: finale.story!.arc });
    expect(logbookOf(s).bests.pay).toMatchObject({ title: finale.title });

    // A promotion at the Authority's dock.
    s.reputation.sta = 45;
    s.stats.kills = 25;
    s.stats.rewards = 50_000;
    const yard = ALL_LOCATIONS.find((l) => l.factionId === 'sta' && l.status === 'functional' && l.dockable !== false && l.systemId !== 'sol' && shipsForSale(l.id).length > 0 && gearForSale(l.id).length > 0)!;
    s.location = { systemId: yard.systemId, dockedAt: null, flight: null, lastDockId: yard.id };
    const promoted = dockAt(s, yard.id).ranks.filter((n) => n.kind === 'promoted');
    expect(promoted.map((n) => n.faction)).toEqual(['sta']);
    const rank = logbookOf(s).entries.find((e) => e.kind === 'rank')!;
    expect(rank).toMatchObject({ id: 'sta', x: promoted[0]!.rank, where: yard.id });
    expect(logText(rank)).toMatch(/^Promoted to .+ with .+\.$/);

    // A milestone, at the next save.
    expect(checkMilestones(s).length).toBeGreaterThan(0);
    expect(kinds(s)).toContain('milestone');

    // A race won, with the course record.
    s.clock += 86_400;
    s.location = { systemId: 'sol', dockedAt: 'earth-port', flight: null, lastDockId: 'earth-port' };
    s.ship.model = 'ship.courier.1.halden';
    expect(enterRace(s, 'race.earth-port.sprint').ok).toBe(true);
    const rec = clubRecord('race.earth-port.sprint', 'light')!;
    expect(finishRace(s, rec.time - 1, [])!.place).toBe(1);
    const races = logbookOf(s).entries.filter((e) => e.kind === 'race');
    expect(races.map((e) => e.x)).toEqual(['won', 'record']);
    expect(logText(races[0]!)).toMatch(/^Won a race on .+\.$/);

    // A station of your own chartered.
    const dock = 'wayfarer-array';
    s.location = { systemId: getLocation(dock).systemId, dockedAt: dock, flight: null, lastDockId: dock };
    markVisited(s, getLocation(dock).systemId, dock);
    const site = charterOffers(s).find((x) => !x.blocked)!;
    const { kind, names } = site.kinds[0]!;
    expect(charterOutpost(s, site.site.id, kind, names[0]!).ok).toBe(true);
    expect(logText(logbookOf(s).entries.at(-1)!)).toBe(`Chartered ${names[0]}.`);

    // Lost, and towed home.
    rescueAfterDefeat(s);
    expect(logbookOf(s).entries.at(-1)).toMatchObject({ kind: 'towed', id: getLocation(dock).systemId });

    // A comet's first scan (once), and a planet discovered.
    expect(noteComet(s, 'comet-2p')).toBe(true);
    expect(noteComet(s, 'comet-2p')).toBe(false);
    expect(logText(logbookOf(s).entries.at(-1)!)).toBe('First scan of 2P/Encke.');
    const planet = EXOPLANETS.planets[0]!;
    expect(discoverBody(s, planet.id).first).toBe(true);
    expect(logText(logbookOf(s).entries.at(-1)!)).toBe(`Discovered ${planet.displayName}.`);

    // Every kind said, in time order, and the save sound.
    for (const e of logbookOf(s).entries) expect(logText(e), e.kind).not.toMatch(/\{|undefined/);
    const ats = logbookOf(s).entries.map((e) => e.at);
    expect([...ats].sort((a, b) => a - b)).toEqual(ats);
    assertValidState(s);
  });
});

describe('the bests and the milestones', () => {
  it('keeps the most credits, the longest jump, the biggest pay and the farthest star, and earns the four new milestones', () => {
    const s = pilot();
    checkMilestones(s);
    expect(logbookOf(s).bests.credits).toMatchObject({ n: 500_000 });
    // The longest hop on the map; a real star twenty-five light-years out.
    let longest: { from: SystemId; to: SystemId; ly: number } | null = null;
    for (const sys of SYSTEMS) for (const t of sys.jumpLinks) {
      const r = findRoute(SYSTEMS, sys.id, t)!;
      if (r.hops.length === 1 && (!longest || r.hops[0]!.distanceLy > longest.ly)) longest = { from: sys.id, to: t, ly: r.hops[0]!.distanceLy };
    }
    s.location = { systemId: longest!.from, dockedAt: null, flight: null, lastDockId: 'earth-port' };
    markVisited(s, longest!.from);
    const r = findRoute(SYSTEMS, longest!.from, longest!.to)!;
    performJump(s, r, 0);
    expect(logbookOf(s).bests.jump!.ly).toBeGreaterThanOrEqual(LOGBOOK.milestones.jumpLy);
    const far = SYSTEMS.find((x) => x.distanceLightYears >= LOGBOOK.milestones.farLy && x.id !== 'pyre')!;
    markVisited(s, far.id);
    expect(farthestVisited(s)!.ly).toBeGreaterThanOrEqual(LOGBOOK.milestones.farLy);
    for (const c of COMET_DATA.comets.slice(0, LOGBOOK.milestones.comets)) noteComet(s, c.id);
    logbookOf(s).ships.push('ship.courier.2.halden', 'ship.freighter.1.halden', 'ship.courier.3.halden', 'ship.freighter.2.halden');
    const earned = checkMilestones(s).map((m) => m.id);
    expect(earned).toEqual(expect.arrayContaining(['jump-long', 'far-out', 'comets-five', 'ships-five']));
    const shown = logBests(s).map((b) => b.key);
    expect(shown).toEqual(expect.arrayContaining(['credits', 'jump', 'far', 'systems', 'ships', 'comets']));
  });
});

describe('one save’s own', () => {
  it('a save from before it begins a logbook with what it can date, and the record stays within its size', () => {
    const s = pilot();
    delete s.logbook;
    s.milestones['first-contract'] = 2_000;
    s.ranks = { sta: { rank: 1, at: 4_000, where: 'earth-port' } };
    s.visitedSystems.push('alpha-centauri', 'barnard');
    const book = logbookOf(s);
    expect(book.entries.map((e) => [e.kind, e.at])).toEqual([
      ['milestone', 2_000],
      ['rank', 4_000],
      ['begun', s.clock],
    ]);
    expect(logText(book.entries.at(-1)!)).toBe('The logbook begins, 3 systems already visited.');
    expect(book.ships).toEqual([s.ship.model]);
    assertValidState(s);
    // Past its size the oldest go, but never the first.
    for (let i = 0; i < LOGBOOK.keep + 30; i++) logWrite(s, { kind: 'milestone', id: 'first-contract' });
    expect(book.entries).toHaveLength(LOGBOOK.keep);
    expect(book.entries[0]).toMatchObject({ kind: 'milestone', at: 2_000 });
    assertValidState(s);
    // A damaged record is caught.
    book.entries.push({ at: s.clock + 50, kind: 'visit', id: 'sol' });
    expect(() => assertValidState(s)).toThrow(/logbook/);
    book.entries.pop();
    book.entries.push({ at: s.clock, kind: 'visit', id: 'nowhere' });
    expect(() => assertValidState(s)).toThrow(/logbook/);
  });
});
