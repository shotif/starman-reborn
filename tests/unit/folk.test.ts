import { afterEach, describe, expect, it } from 'vitest';
import { assertValidState, migrateSave } from '../../src/app/save/migrate.ts';
import { createNewGame, markVisited, type FolkAsk, type GameState, type OutpostRecord } from '../../src/app/state.ts';
import { FOLK, FOLK_FIRST, FOLK_LAST } from '../../src/content/outposts/folk.ts';
import { beltSiteId, outpostId } from '../../src/content/outposts/sites.ts';
import { getLocation } from '../../src/data/systems.ts';
import { repairQuote } from '../../src/economy/equipment.ts';
import { marketEffect, useWorldLog } from '../../src/economy/events.ts';
import { fleetNews, settleFleet } from '../../src/economy/fleet.ts';
import {
  advanceFolk,
  askLine,
  askShort,
  bandOf,
  completeAsk,
  dockFolk,
  ensureFolk,
  fetchStations,
  folkFactor,
  folkPeople,
  handOverAsk,
  leaveFolk,
  nextAskAt,
  peopleCount,
  raidFolk,
  repairCut,
  residentTrades,
  scanBodies,
  scanFolk,
  spiritAt,
  spiritFactor,
  visitFolk,
  workGood,
  worksIncome,
} from '../../src/economy/folk.ts';
import { validateFolk, type FolkRules } from '../../src/economy/folkGuards.ts';
import { hullMax } from '../../src/economy/loadout.ts';
import { incomeAt } from '../../src/economy/outposts.ts';
import { sampleSites } from '../../src/economy/outpostTradeGuards.ts';

/**
 * People at your outposts (docs/PROCGEN.md §41): who lives there, their asks (made, done, lapsed),
 * what each leaves, the spirit and what it does to the income, the works in the market and the
 * repairs, what is said on docking and reported away, settling the same however often, and saves.
 */

afterEach(() => useWorldLog(null));

const HOUR = 3_600;
const DAY = 24 * HOUR;
const MAIN = beltSiteId('sol-main-belt');
const POST = outpostId(MAIN);

/** A pilot docked at Earth Port with the main belt's refinery open at a stage from the start of the clock, its people come. */
function withOutpost(stage = 3, seed = 23): { s: GameState; o: OutpostRecord } {
  const s = createNewGame(seed);
  s.jobs.lifeline = { status: 'complete', objectiveIndex: 4, acceptedAt: 0, completedAt: 1 };
  s.flags.clearance = true;
  s.location = { systemId: 'sol', dockedAt: 'earth-port', flight: null, lastDockId: 'earth-port' };
  markVisited(s, 'sol', 'earth-port');
  const o: OutpostRecord = { site: MAIN, kind: 'refinery', name: 'Copperleaf Stillworks', founded: 0, stage, delivered: {}, since: 0, earned: 0, opened: 0, heard: 0 };
  s.world.outposts = [o];
  useWorldLog(s.world);
  ensureFolk(o, 0);
  return { s, o };
}

/** The ask open now, of a kind (set by hand: which kind comes is drawn). */
function setAsk(o: OutpostRecord, ask: Partial<FolkAsk> & Pick<FolkAsk, 'kind'>, at = 0): FolkAsk {
  const f = o.folk!;
  const a: FolkAsk = { n: f.asked, slot: 0, story: true, made: at, until: at + FOLK.asks.lasts, ...ask };
  f.asked += 1;
  f.ask = a;
  return a;
}

const docked = (s: GameState, id: string) => (s.location = { systemId: getLocation(id).systemId, dockedAt: id, flight: null, lastDockId: id });

describe('guardrails', () => {
  it('the rules, the words and every sampled site pass', { timeout: 60_000 }, () => {
    expect(validateFolk()).toEqual([]);
  });

  it('broken rules are caught', () => {
    const broken = (patch: (r: { -readonly [K in keyof FolkRules]: any }) => void) => {
      const r = structuredClone(FOLK) as unknown as { -readonly [K in keyof FolkRules]: any };
      patch(r);
      return validateFolk(r as FolkRules, 1, []).map((x) => x.subject);
    };
    expect(broken(() => {})).toEqual([]);
    expect(broken((r) => (r.people = [2, 2, 4]))).toContain('people');
    expect(broken((r) => (r.people = [1, 3, 2]))).toContain('people');
    expect(broken((r) => (r.spirit.income = [0.9, 1.05]))).toContain('spirit.income');
    expect(broken((r) => (r.spirit.lapsed = 4))).toContain('spirit');
    expect(broken((r) => (r.spirit.bands = { low: 80, glad: 70 }))).toContain('spirit.bands');
    expect(broken((r) => (r.asks.lasts = 6 * HOUR))).toContain('asks');
    expect(broken((r) => (r.firstIncome = 0.1))).toContain('firstIncome');
    expect(broken((r) => (r.trades.engineer.work.cut = 0.6))).toContain('engineer');
    expect(broken((r) => (r.trades.grower.work.price = 0.5))).toContain('grower');
    expect(broken((r) => (r.trades.broker.goods = ['weapons']))).toContain('broker');
    expect(broken((r) => (r.trades.quartermaster.work.income = 0.2))).toContain('quartermaster');
    expect(broken((r) => (r.residents = ['quartermaster', 'engineer', 'grower', 'medic']))).toContain('residents');
  });
});

describe('who lives there', () => {
  it('a quartermaster from the opening, a resident more as a station, two more as a port: named, the same every time', () => {
    const { s, o } = withOutpost(3);
    expect([0, 1, 2, 3].map((stage) => peopleCount({ ...o, stage }))).toEqual([0, 1, 2, 4]);
    const people = folkPeople(s, o);
    expect(people.map((p) => p.slot)).toEqual([0, 1, 2, 3]);
    expect(people[0]!.trade).toBe('quartermaster');
    const trades = people.slice(1).map((p) => p.trade);
    expect(new Set(trades).size).toBe(3);
    expect(trades.every((t) => (FOLK.residents as readonly string[]).includes(t))).toBe(true);
    expect(new Set(people.map((p) => p.name)).size).toBe(4);
    for (const p of people) {
      const [first, ...last] = p.name.split(' ');
      expect(FOLK_FIRST).toContain(first);
      expect(FOLK_LAST).toContain(last.join(' '));
    }
    expect(folkPeople(s, o)).toEqual(people);
    expect(folkPeople(s, { ...o, stage: 2 })).toEqual(people.slice(0, 2));
    // Chartered again (a new founding): new people.
    expect(folkPeople(s, { ...o, founded: 99 }).map((p) => p.name)).not.toEqual(people.map((p) => p.name));
  });

  it('trades likelier where they fit, and never one whose work the market cannot carry', () => {
    const { s, o } = withOutpost(3);
    let engineers = 0;
    for (let seed = 0; seed < 200; seed++) if (residentTrades(seed, o)[0] === 'engineer') engineers++;
    // An engineer is three times as likely as any other at a refinery: first about half the time.
    expect(engineers).toBeGreaterThan(70);
    for (const { site, kind } of sampleSites()) {
      const x: OutpostRecord = { ...o, site: site.id, kind, folk: undefined };
      s.world.outposts = [x];
      useWorldLog(s.world);
      const drawn = residentTrades(s.seed, x);
      for (const t of FOLK.residents) if (workGood(s.seed, x, t) === null) expect(drawn).not.toContain(t);
    }
  });
});

describe('asks', () => {
  it('the first comes some hours after it opens, made of the asker’s kinds and possible; it lapses after two days, lowering the spirit', () => {
    const { s, o } = withOutpost(3);
    expect(nextAskAt(s.seed, o)).toBe(FOLK.asks.first);
    expect(advanceFolk(s, o, FOLK.asks.first - 1)).toEqual([]);
    const made = advanceFolk(s, o, FOLK.asks.first);
    const ask = o.folk!.ask!;
    expect(made).toEqual([{ at: FOLK.asks.first, text: `At Copperleaf Stillworks, ${folkPeople(s, o)[0]!.name} asks: ${askShort(ask)}.`, tone: 'info' }]);
    expect(ask).toMatchObject({ n: 0, slot: 0, story: true, made: FOLK.asks.first, until: FOLK.asks.first + FOLK.asks.lasts });
    expect((FOLK.trades.quartermaster.asks as readonly string[]).includes(ask.kind)).toBe(true);
    if (ask.kind === 'goods') expect(ask.qty).toBeGreaterThanOrEqual(FOLK.asks.qty[0]);
    if (ask.kind === 'fetch') expect(fetchStations('sol')).toContain(ask.stationId);
    expect(askLine(s, o, ask).text).not.toMatch(/\{\w+\}/);
    // Not done: it lapses, the spirit falls by the lapse and the time away.
    const lapsed = advanceFolk(s, o, ask.until);
    expect(lapsed[0]).toMatchObject({ at: ask.until, tone: 'bad' });
    expect(lapsed[0]!.text).toMatch(/ask has lapsed/);
    expect(o.folk!.ask).toBeUndefined();
    expect(o.folk!.ended).toEqual({ at: ask.until, how: 'lapsed', slot: 0 });
    const away = ((ask.until - FOLK.spirit.away.grace) / FOLK.spirit.away.step) * FOLK.spirit.away.by;
    expect(spiritAt(o, ask.until)).toBeCloseTo(FOLK.spirit.start + FOLK.spirit.lapsed - away, 5);
    // The next comes 12–36 hours later, from someone else as few asks done.
    const next = nextAskAt(s.seed, o)!;
    expect(next - ask.until).toBeGreaterThanOrEqual(FOLK.asks.gap[0]);
    expect(next - ask.until).toBeLessThanOrEqual(FOLK.asks.gap[1]);
    advanceFolk(s, o, next);
    expect(o.folk!.ask!.slot).toBe(1);
  });

  it('goods handed over at the outpost: the spirit lifts, the first ask adds income, the second builds the work; then supplies', () => {
    const { s, o } = withOutpost(3);
    docked(s, POST);
    const ask = setAsk(o, { kind: 'goods', good: 'machinery', qty: 6 });
    expect(handOverAsk(s).ok).toBe(false);
    s.ship.cargo = { machinery: 6 };
    s.location.dockedAt = 'earth-port';
    expect(handOverAsk(s).ok).toBe(false);
    s.location.dockedAt = POST;
    const r = handOverAsk(s);
    expect(r.ok).toBe(true);
    expect(r.line?.text).toBe('That will see us through. People noticed you came.');
    expect(s.ship.cargo.machinery ?? 0).toBe(0);
    expect(o.folk!.steps[0]).toBe(1);
    expect(spiritAt(o, 0)).toBe(FOLK.spirit.start + FOLK.spirit.done);
    expect(o.folk!.ended).toEqual({ at: ask.made, how: 'done', slot: 0 });
    expect(worksIncome(o)).toBeCloseTo(1 + FOLK.firstIncome, 10);
    // The second: the quartermaster's proper stores.
    setAsk(o, { kind: 'goods', good: 'machinery', qty: 6 });
    s.ship.cargo = { machinery: 6 };
    const w = handOverAsk(s);
    expect(w.work).toMatchObject({ slot: 0, trade: 'quartermaster' });
    expect(w.line?.text).toMatch(/Proper stores at last/);
    expect(worksIncome(o)).toBeCloseTo(1 + FOLK.firstIncome + FOLK.trades.quartermaster.work.income, 10);
    // Every story told: the quartermaster's supplies, which change nothing but the spirit.
    for (const slot of [1, 2, 3]) o.folk!.steps[slot] = FOLK.asks.story;
    o.folk!.ended = { at: 0, how: 'done', slot: 0 };
    advanceFolk(s, o, 10 * DAY);
    expect(o.folk!.ask).toMatchObject({ kind: 'goods', story: false, slot: 0 });
  });

  it('fetch: the one waiting comes aboard where they wait, and docking at the outpost brings them home', () => {
    const { s, o } = withOutpost(3);
    const station = fetchStations('sol')[0]!;
    setAsk(o, { kind: 'fetch', who: 'Edda Carrow', relation: 'cousin', stationId: station, slot: 1 });
    expect(dockFolk(s, 'earth-port').toasts).toEqual([]);
    const at = dockFolk(s, station);
    expect(at.toasts).toEqual(['Edda Carrow comes aboard for Copperleaf Stillworks.']);
    expect(o.folk!.ask!.aboard).toBe(true);
    s.clock = 2 * HOUR;
    const home = dockFolk(s, POST);
    expect(home.lines[0]).toMatchObject({ slot: 1, text: expect.any(String) });
    expect(o.folk!.ask).toBeUndefined();
    expect(o.folk!.steps[1]).toBe(1);
  });

  it('scan: a body of its system scanned in that system, then told at the outpost', () => {
    const { s, o } = withOutpost(3);
    const body = scanBodies('sol').find((b) => b.id === 'sol-main-belt') ?? scanBodies('sol')[0]!;
    setAsk(o, { kind: 'scan', bodyId: body.id, slot: 2 });
    s.location.systemId = 'alpha-centauri';
    expect(scanFolk(s, body.id)).toEqual([]);
    s.location.systemId = 'sol';
    expect(scanFolk(s, 'not-a-body')).toEqual([]);
    expect(scanFolk(s, body.id)[0]).toMatch(new RegExp(`Scanned ${body.name} for`));
    expect(o.folk!.ask!.scanned).toBe(true);
    expect(dockFolk(s, POST).lines[0]!.slot).toBe(2);
    expect(o.folk!.steps[2]).toBe(1);
  });
});

describe('the spirit', () => {
  it('starts steady; away for more than a day it falls; being there stops it; a medic’s clinic halves it; raids move it', () => {
    const { s, o } = withOutpost(3);
    expect(spiritAt(o, 0)).toBe(50);
    expect(bandOf(50)).toBe('steady');
    expect(spiritFactor(50)).toBe(1);
    expect(spiritFactor(0)).toBeCloseTo(0.95, 10);
    expect(spiritFactor(100)).toBeCloseTo(1.05, 10);
    expect(spiritAt(o, DAY)).toBe(50);
    expect(spiritAt(o, DAY + 6 * HOUR)).toBeCloseTo(49, 10);
    expect(spiritAt(o, 3 * DAY)).toBeCloseTo(42, 10);
    // There on day three: the falling done stays, then a day's grace again.
    visitFolk(o, 3 * DAY);
    expect(spiritAt(o, 4 * DAY)).toBeCloseTo(42, 10);
    expect(spiritAt(o, 4 * DAY + 12 * HOUR)).toBeCloseTo(40, 10);
    s.location.dockedAt = POST;
    leaveFolk(s, POST);
    // With the clinic, half as fast.
    o.folk!.works.push({ slot: 1, trade: 'medic', at: 3 * DAY });
    expect(spiritAt(o, 4 * DAY + 12 * HOUR)).toBeCloseTo(41, 10);
    raidFolk(o, 5 * DAY, 'held');
    const held = spiritAt(o, 5 * DAY);
    raidFolk(o, 5 * DAY, 'lost');
    expect(spiritAt(o, 5 * DAY)).toBeCloseTo(held + FOLK.spirit.lost, 10);
    // Never out of 0–100.
    for (let i = 0; i < 20; i++) raidFolk(o, 5 * DAY, 'lost');
    expect(spiritAt(o, 5 * DAY)).toBe(0);
    for (let i = 0; i < 30; i++) raidFolk(o, 5 * DAY, 'held');
    expect(spiritAt(o, 5 * DAY)).toBe(100);
  });

  it('moves the hour’s income with what the asks made, settled the same however often', () => {
    const { o } = withOutpost(3);
    const plain = incomeAt({ ...o, folk: undefined }, HOUR / 2);
    o.folk!.spirit = 100;
    o.folk!.steps = [2, 1, 0, 0];
    o.folk!.works.push({ slot: 0, trade: 'quartermaster', at: 0 });
    expect(folkFactor(o, HOUR / 2)).toBeCloseTo(1.05 * (1 + 2 * FOLK.firstIncome + FOLK.trades.quartermaster.work.income), 10);
    expect(incomeAt(o, HOUR / 2)).toBeGreaterThan(plain);
    // Away sixty hours (within the dock fees' reach, docs/PROCGEN.md §38.2), an ask made and lapsed,
    // hours paid: once, or every quarter of an hour.
    const a = withOutpost(3);
    const once = structuredClone(a.s);
    const end = 60 * HOUR;
    a.s.clock = end;
    const r = settleFleet(a.s);
    expect(r.folk?.length).toBeGreaterThan(0);
    expect(r.folk!.length).toBeLessThanOrEqual(FOLK.reports);
    expect(a.s.fleet.reports.filter((x) => x.kind === 'folk').length).toBe(r.folk!.length);
    expect(fleetNews(r).some((n) => /asks:|lapsed/.test(n.text))).toBe(true);
    useWorldLog(once.world);
    for (let t = 900; t <= end; t += 900) {
      once.clock = t;
      settleFleet(once);
    }
    expect(once.world.outposts![0]!.folk).toEqual(a.s.world.outposts![0]!.folk);
    expect(once.world.outposts![0]!.earned).toBe(a.s.world.outposts![0]!.earned);
  });
});

describe('what they make', () => {
  it('the workshop cuts repairs there; the green bay and the trading desk move its market, for good', () => {
    const { s, o } = withOutpost(3);
    s.ship.hull = hullMax(s.ship) - 40;
    const before = repairQuote(s, POST);
    expect(repairCut(s, POST)).toBe(0);
    o.folk!.works.push({ slot: 1, trade: 'engineer', at: 0 });
    expect(repairCut(s, POST)).toBe(FOLK.trades.engineer.work.cut);
    expect(repairCut(s, 'earth-port')).toBe(0);
    expect(repairQuote(s, POST).cost).toBe(Math.round(before.cost * (1 - FOLK.trades.engineer.work.cut)));
    const food = workGood(s.seed, o, 'grower');
    const desk = workGood(s.seed, o, 'broker');
    expect(food).toBeTruthy();
    expect(desk).toBeTruthy();
    expect(desk).not.toBe(food);
    const plain = marketEffect(POST, food!, 0);
    o.folk!.works.push({ slot: 2, trade: 'grower', good: food!, at: 0 }, { slot: 3, trade: 'broker', good: desk!, at: 0 });
    expect(marketEffect(POST, food!, 0).price).toBeCloseTo(plain.price * FOLK.trades.grower.work.price, 10);
    expect(marketEffect(POST, food!, 0).stock).toBeCloseTo(plain.stock * FOLK.trades.grower.work.stock, 10);
    expect(marketEffect(POST, desk!, 0).price).toBeCloseTo(marketEffect(POST, desk!, 0).price, 10);
    expect(marketEffect('earth-port', food!, 0)).toEqual(marketEffect('earth-port', food!, 0));
  });

  it('a work is built at the end of a story, on the good its market trades', () => {
    const { s, o } = withOutpost(3);
    const grower = folkPeople(s, o).find((p) => p.trade === 'grower');
    if (!grower) return;
    o.folk!.steps[grower.slot] = 1;
    setAsk(o, { kind: 'goods', good: 'water', qty: 8, slot: grower.slot });
    const done = completeAsk(s, o, HOUR);
    expect(done.work).toEqual({ slot: grower.slot, trade: 'grower', good: workGood(s.seed, o, 'grower'), at: HOUR });
  });
});

describe('meeting them', () => {
  it('on docking: a new ask, an ask lapsed, the spirit’s band changed; said once; at most three lines', () => {
    const { s, o } = withOutpost(3);
    advanceFolk(s, o, FOLK.asks.first);
    s.clock = FOLK.asks.first + HOUR;
    const first = dockFolk(s, POST);
    expect(first.outpost).toBe(o);
    expect(first.lines.map((l) => l.slot)).toEqual([o.folk!.ask!.slot]);
    expect(first.lines[0]!.text).toBe(askLine(s, o, o.folk!.ask!).text);
    expect(dockFolk(s, POST).lines).toEqual([]);
    // Away long: it lapses and the spirit falls into another band.
    s.clock = 9 * DAY;
    advanceFolk(s, o, s.clock);
    const back = dockFolk(s, POST);
    expect(back.lines.length).toBeGreaterThan(0);
    expect(back.lines.length).toBeLessThanOrEqual(FOLK.greet.max);
    expect(o.folk!.told).toBe(s.clock);
    expect(o.folk!.band).toBe(bandOf(spiritAt(o, s.clock)));
  });

  it('an outpost from an older save gets its people when first settled, the first ask some hours on', () => {
    const { s, o } = withOutpost(3);
    delete o.folk;
    s.clock = 10 * DAY;
    settleFleet(s);
    expect(o.folk).toMatchObject({ start: 10 * DAY, spirit: FOLK.spirit.start, asked: 0 });
    expect(nextAskAt(s.seed, o)).toBe(10 * DAY + FOLK.asks.first);
    // While its frame is built, nobody yet.
    const b = withOutpost(0);
    expect(b.o.folk).toBeUndefined();
    expect(folkPeople(b.s, b.o)).toEqual([]);
  });
});

describe('saves', () => {
  it('keep the people’s record, and refuse what cannot be', () => {
    const { s, o } = withOutpost(3);
    advanceFolk(s, o, FOLK.asks.first);
    s.clock = FOLK.asks.first;
    assertValidState(s);
    expect(migrateSave(structuredClone(s)).world.outposts![0]!.folk).toEqual(o.folk);
    const bad = (patch: (f: NonNullable<OutpostRecord['folk']>, o: OutpostRecord) => void) => {
      const t = structuredClone(s);
      patch(t.world.outposts![0]!.folk!, t.world.outposts![0]!);
      return () => assertValidState(t);
    };
    expect(bad((f) => (f.spirit = 120))).toThrow();
    expect(bad((f) => (f.steps[0] = 3))).toThrow();
    expect(bad((f, x) => ((x.stage = 1), (f.steps[2] = 1)))).toThrow();
    expect(bad((f) => (f.ask!.slot = 9))).toThrow();
    expect(bad((f) => ((f.ask as { kind: string }).kind = 'party'))).toThrow();
    expect(bad((f) => (f.ask!.until = f.ask!.made + 1))).toThrow();
    expect(bad((f) => ((f.ask!.kind = 'goods'), (f.ask!.good = 'unobtainium' as never), (f.ask!.qty = 4)))).toThrow();
    expect(bad((f) => ((f.ask!.kind = 'scan'), (f.ask!.bodyId = 'nowhere')))).toThrow();
    expect(bad((f) => ((f.ask!.kind = 'goods'), (f.ask!.good = 'machinery'), (f.ask!.qty = 4), (f.ask!.aboard = true)))).toThrow();
    expect(bad((f) => (f.works = [{ slot: 0, trade: 'quartermaster', at: 0 }, { slot: 1, trade: 'quartermaster', at: 0 }]))).toThrow();
    expect(bad((_, x) => (x.stage = 0))).toThrow();
  });
});
