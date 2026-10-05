import { afterEach, describe, expect, it, vi } from 'vitest';
import { assertValidState, migrateSave } from '../../src/app/save/migrate.ts';
import { createNewGame, markVisited, type GameState, type OutpostRecord } from '../../src/app/state.ts';
import { EVENTS } from '../../src/content/events/rules.ts';
import { OUTPOSTS } from '../../src/content/outposts/rules.ts';
import { beltSiteId, outpostId } from '../../src/content/outposts/sites.ts';
import { getLocation } from '../../src/data/systems.ts';
import { relieveShortage } from '../../src/economy/answers.ts';
import { boardFor, boardEpoch, postedContract } from '../../src/economy/contracts.ts';
import { contractIssues } from '../../src/economy/contractGuards.ts';
import { eventEnd, eventStations, newsAt, stationEventAt, stationEventById, stationEventsBetween, useWorldLog, type WorldEvent } from '../../src/economy/events.ts';
import { fleetNews, settleFleet } from '../../src/economy/fleet.ts';
import { haulById, haulsIn, made, reliefHauls, shortfall } from '../../src/economy/hauls.ts';
import { acceptJob, deliverJob } from '../../src/economy/jobs.ts';
import { marketTables } from '../../src/economy/markets.ts';
import { newsLine, outpostNewsBetween } from '../../src/economy/outpostNews.ts';
import { validateOutpostNews, type NewsRules } from '../../src/economy/outpostNewsGuards.ts';
import { incomeAt, newsFactor } from '../../src/economy/outposts.ts';
import { waysFrom } from '../../src/economy/hauls.ts';
import { ALL_LOCATIONS } from '../../src/data/systems.ts';

/**
 * Outposts have news (docs/PROCGEN.md §39): the world's events at the pilot's outposts, the world's
 * own unchanged, what they do to the income, who answers them (relief haulers, the pilot, boards),
 * the news told, the Outpost window's line, and saves.
 */

afterEach(() => useWorldLog(null));

const HOUR = 3_600;
const MAIN = beltSiteId('sol-main-belt');
const POST = outpostId(MAIN);

/** A pilot at Earth Port with the main belt's refinery open at a stage, opened at `opened`. */
function withOutpost(stage = 3, opened = 0): { s: GameState; o: OutpostRecord } {
  const s = createNewGame(23);
  s.jobs.lifeline = { status: 'complete', objectiveIndex: 4, acceptedAt: 0, completedAt: 1 };
  s.flags.clearance = true;
  s.credits = 100_000;
  s.location = { systemId: 'sol', dockedAt: 'earth-port', flight: null, lastDockId: 'earth-port' };
  markVisited(s, 'sol', 'earth-port');
  const o: OutpostRecord = { site: MAIN, kind: 'refinery', name: 'Copperleaf Stillworks', founded: 0, stage, delivered: {}, since: opened, earned: 0, opened, heard: opened };
  s.world.outposts = [o];
  useWorldLog(s.world);
  return { s, o };
}

/** The first event of a kind at the outpost, from the start of the clock. */
function first(kind: WorldEvent['kind']): WorldEvent {
  const e = stationEventsBetween(POST, 0, 20 * 24 * HOUR).find((x) => x.kind === kind);
  expect(e, `a ${kind} within twenty days`).toBeDefined();
  return e!;
}

describe('guardrails', () => {
  it('the rules and every sampled site’s events pass', () => {
    expect(validateOutpostNews()).toEqual([]);
  });

  it('broken rules are caught', () => {
    const N = OUTPOSTS.news;
    const broken = (patch: Partial<NewsRules>) => validateOutpostNews({ ...N, ...patch }, 1, []);
    expect(broken({ income: { ...N.income, shortage: 1.1 } })).not.toEqual([]);
    expect(broken({ income: { ...N.income, boom: 0.9 } })).not.toEqual([]);
    expect(broken({ income: { ...N.income, strike: 0.2 } })).not.toEqual([]);
    expect(broken({ income: { ...N.income, harvest: 2 } })).not.toEqual([]);
    expect(broken({ maxReports: 0 })).not.toEqual([]);
    expect(broken({ maxReports: 2.5 })).not.toEqual([]);
    expect(broken({})).toEqual([]);
  });
});

describe('events at your outposts', () => {
  it('the world’s kinds from when it opened, Sol’s too, found by id and in the News', () => {
    withOutpost(3, 10 * HOUR);
    const events = stationEventsBetween(POST, 0, 10 * 24 * HOUR);
    expect(events.length).toBeGreaterThan(20);
    expect(events.every((e) => e.start >= 10 * HOUR)).toBe(true);
    expect(new Set(events.map((e) => e.kind))).toEqual(new Set(['shortage', 'glut', 'boom', 'strike']));
    const e = events[0]!;
    expect(e.id).toMatch(/^e\.outpost\.belt\.sol-main-belt\.\d+$/);
    expect(stationEventById(e.id)).toEqual(e);
    expect(e.headline).toContain('Copperleaf Stillworks');
    expect(eventStations()).toContain(POST);
    const mid = (e.start + eventEnd(e)) / 2;
    expect(newsAt('sol', mid).some((n) => n.event.id === e.id && n.active)).toBe(true);
    // Its market feels it, as any station's does.
    expect(stationEventAt(POST, mid)?.id).toBe(e.id);
  });

  it('none while it is built, nor once it is gone', () => {
    withOutpost(0);
    expect(stationEventsBetween(POST, 0, 5 * 24 * HOUR)).toEqual([]);
    expect(eventStations()).not.toContain(POST);
    useWorldLog(null);
    expect(stationEventsBetween(POST, 0, 5 * 24 * HOUR)).toEqual([]);
  });

  it('the world’s own events are the same with outposts or without', async () => {
    const events = async (withPost: boolean) => {
      vi.resetModules();
      const ev = await import('../../src/economy/events.ts');
      const st = await import('../../src/app/state.ts');
      const s = st.createNewGame(1);
      if (withPost) s.world.outposts = [{ site: MAIN, kind: 'refinery', name: 'Copperleaf Stillworks', founded: 0, stage: 3, delivered: {}, since: 0, earned: 0, opened: 0 }];
      ev.useWorldLog(s.world);
      const out: string[] = [];
      for (let t = 0; t < 100 * HOUR; t += HOUR) out.push(...ev.eventsAt(t).filter((e) => !e.locationId?.startsWith('outpost.')).map((e) => `${e.id}:${e.kind}:${e.goods.join('+')}:${e.start}`));
      ev.useWorldLog(null);
      return out.join('|');
    };
    expect(await events(true)).toBe(await events(false));
  });
});

describe('the income', () => {
  it('moved while one is under way, by its kind’s factor (Sol has no raids or sweeps)', () => {
    const { o } = withOutpost(3);
    for (const kind of ['shortage', 'boom', 'glut', 'strike'] as const) {
      const e = first(kind);
      const mid = (e.start + eventEnd(e)) / 2;
      expect(newsFactor(o, mid)).toBe(OUTPOSTS.news.income[kind]);
      expect(incomeAt(o, mid)).toBe(Math.round(1_600 * OUTPOSTS.news.income[kind]));
    }
    // Quiet: the plain rate.
    const quiet = Array.from({ length: 48 }, (_, i) => i * HOUR + 1_800).find((t) => !stationEventAt(POST, t))!;
    expect(incomeAt(o, quiet)).toBe(1_600);
  });

  it('a shortage the pilot relieves ends the cut, with no bonus and no standing', () => {
    const { s, o } = withOutpost(3);
    const e = first('shortage');
    s.clock = e.start + 60;
    const deficit = shortfall(e) * EVENTS.react.relief;
    expect(incomeAt(o, s.clock)).toBe(Math.round(1_600 * 0.85));
    const credits = s.credits;
    const rep = structuredClone(s.reputation);
    const r = relieveShortage(s, POST, e.goods[0]!, Math.ceil(deficit));
    expect(r).toEqual({ paid: 0, text: 'Shortage relieved: Copperleaf Stillworks is supplied again, and its income is back to normal.' });
    expect(s.credits).toBe(credits);
    expect(s.reputation).toEqual(rep);
    expect(stationEventAt(POST, s.clock + 1)).toBeNull();
    expect(incomeAt(o, s.clock + 1)).toBe(1_600);
  });
});

describe('who answers', () => {
  it('relief haulers from makers within reach, flying in Sol, found by id', () => {
    withOutpost(3);
    const e = first('shortage');
    const relief = reliefHauls(e);
    expect(relief).toHaveLength(2);
    for (const h of relief) {
      expect(h.to).toBe(POST);
      expect(made(h.from)).toContain(e.goods[0]);
      expect(haulById(h.id)).toEqual(h);
    }
    const leg = relief[0]!.legs.at(-1)!;
    expect(haulsIn('sol', (leg.start + leg.end) / 2).some((x) => x.haul.id === relief[0]!.id)).toBe(true);
  });

  it('its own board’s jobs can be taken, and it posts work into its own event', () => {
    const { s } = withOutpost(2);
    const epoch = 3;
    const board = boardFor(POST, epoch);
    expect(board.length).toBeGreaterThan(0);
    for (const c of board) expect(postedContract(c.id)).toEqual(c);
    s.location = { systemId: 'sol', dockedAt: POST, flight: null, lastDockId: POST };
    s.clock = epoch * 1_500 + 10;
    expect(acceptJob(s, board[0]!.id).message).not.toMatch(/no longer posted/);
    // During a shortage or boom of its own, some slot's board answers it.
    const events = stationEventsBetween(POST, 0, 10 * 24 * HOUR).filter((x) => x.kind === 'shortage' || x.kind === 'boom');
    const answered = events.some((x) => {
      for (let ep = boardEpoch(x.start); ep <= boardEpoch(eventEnd(x)); ep++) if (boardFor(POST, ep).some((c) => c.contract?.event === x.id)) return true;
      return false;
    });
    expect(answered).toBe(true);
  });

  it('boards within reach post shortage runs to it, which pass the guardrails and deliver there', () => {
    const { s } = withOutpost(3);
    const givers = ALL_LOCATIONS.filter((l) => l.services.includes('contracts') && l.stationType !== 'pirate-den' && l.status === 'functional' && (waysFrom('sol').get(l.systemId)?.length ?? 99) - 1 <= 2).slice(0, 10);
    let found: { job: NonNullable<ReturnType<typeof postedContract>>; clock: number; e: WorldEvent } | null = null;
    for (const e of stationEventsBetween(POST, 0, 10 * 24 * HOUR).filter((x) => x.kind === 'shortage' || x.kind === 'boom')) {
      for (let ep = boardEpoch(e.start); ep <= boardEpoch(eventEnd(e)) && !found; ep++) {
        const clock = ep * 1_500;
        if (stationEventAt(POST, clock)?.id !== e.id) continue;
        for (const g of givers) {
          const job = boardFor(g.id, ep).find((c) => c.id.endsWith('.outpost') && c.contract?.kind === 'supply');
          if (job) {
            found = { job, clock, e };
            break;
          }
        }
      }
      if (found) break;
    }
    expect(found).not.toBeNull();
    const { job, clock, e } = found!;
    expect(job.title).toMatch(/^(Shortage run|Boom supplies) for Copperleaf Stillworks: \d+ /);
    expect(job.destinationLocationId).toBe(POST);
    expect(job.contract?.event).toBe(e.id);
    const o = job.objectives[0]!;
    expect(o.kind === 'deliver' && o.locationId === POST && e.goods.includes(o.commodity)).toBe(true);
    expect(contractIssues(job, clock)).toEqual([]);
    // Taken and delivered there, it pays.
    s.contracts[job.id] = job;
    s.jobs[job.id] = { status: 'active', objectiveIndex: 0, acceptedAt: clock };
    if (o.kind === 'deliver') s.ship.cargo = { [o.commodity]: o.qty };
    s.location = { systemId: 'sol', dockedAt: POST, flight: null, lastDockId: POST };
    const before = s.credits;
    expect(deliverJob(s, job.id, POST).ok).toBe(true);
    expect(s.credits).toBeGreaterThan(before);
  });
});

describe('telling', () => {
  it('a report and a toast as one starts and ends, told once', () => {
    const { s } = withOutpost(3);
    const e = first('shortage');
    s.clock = e.start + 30;
    const started = settleFleet(s);
    const line = `${e.headline}: its income down 15% while it lasts.`;
    expect(started.news?.map((n) => n.text)).toEqual([line]);
    expect(s.fleet.reports.at(-1)).toMatchObject({ kind: 'news', text: line, amount: 0, at: e.start });
    expect(fleetNews(started)).toContainEqual({ text: line, tone: 'bad' });
    s.clock += 30;
    expect(settleFleet(s).news).toBeUndefined();
    s.clock = eventEnd(e) + 30;
    const ended = settleFleet(s);
    expect(ended.news?.some((n) => /^The shortage at Copperleaf Stillworks is over/.test(n.text))).toBe(true);
  });

  it('away for long, only the latest three are told; an older save starts from now', () => {
    const { s, o } = withOutpost(3);
    s.clock = 10 * 24 * HOUR;
    const all = outpostNewsBetween(o, 0, s.clock);
    expect(all.length).toBeGreaterThan(OUTPOSTS.news.maxReports);
    expect(settleFleet(s).news).toEqual(all.slice(-OUTPOSTS.news.maxReports));
    delete o.heard;
    s.clock += 24 * HOUR;
    expect(settleFleet(s).news).toBeUndefined();
    expect(o.heard).toBe(s.clock);
  });

  it('the Outpost window: the event under way and what it does, or all quiet', () => {
    const { o } = withOutpost(3);
    const e = first('boom');
    const line = newsLine(o, e.start + 60);
    expect(line.headline).toBe(e.headline);
    expect(line.detail).toContain(e.detail);
    expect(line.detail).toMatch(/Its income up 20% while it lasts; due to end in \d+ min\.$/);
    const quiet = Array.from({ length: 48 }, (_, i) => i * HOUR + 1_800).find((t) => !stationEventAt(POST, t))!;
    expect(newsLine(o, quiet).headline).toBe('All quiet');
  });
});

describe('saves', () => {
  it('keep how far the news is told, and the reports; refuse a time before the founding', () => {
    const { s, o } = withOutpost(3);
    s.clock = 3 * 24 * HOUR;
    settleFleet(s);
    expect(s.fleet.reports.some((r) => r.kind === 'news')).toBe(true);
    const back = migrateSave(JSON.parse(JSON.stringify(s)));
    expect(back.world.outposts![0]!.heard).toBe(o.heard);
    const bad = structuredClone(s);
    bad.world.outposts![0]!.heard = -5;
    expect(() => assertValidState(bad)).toThrow();
    expect(getLocation(POST).name).toBe('Copperleaf Stillworks');
    expect(marketTables().has(POST)).toBe(true);
  });
});
