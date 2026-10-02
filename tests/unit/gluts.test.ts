import { afterEach, describe, expect, it } from 'vitest';
import { dockAt } from '../../src/app/rules.ts';
import { assertValidState } from '../../src/app/save/migrate.ts';
import { createNewGame, markVisited, type GameState } from '../../src/app/state.ts';
import { CONTRACTS } from '../../src/content/contracts/rules.ts';
import { HAULS } from '../../src/content/economy/hauls.ts';
import { EVENTS } from '../../src/content/events/rules.ts';
import { ALL_LOCATIONS, getLocation } from '../../src/data/systems.ts';
import { clearGlut } from '../../src/economy/answers.ts';
import { boardEpoch, boardFor, postedContracts } from '../../src/economy/contracts.ts';
import { contractIssues } from '../../src/economy/contractGuards.ts';
import { eventEnd, eventsAt, stationEventAt, stationEventsBetween, useWorldLog, type WorldEvent } from '../../src/economy/events.ts';
import { validateHauls } from '../../src/economy/haulGuards.ts';
import {
  eventHauls,
  haulById,
  haulFate,
  haulsIn,
  haulStock,
  raidsOnWay,
  reliefDelivered,
  reliefHauls,
  reliefNews,
  shipments,
  shipOutEnd,
  shippedOut,
  shipsOut,
  surplus,
  takersOf,
  type Haul,
} from '../../src/economy/hauls.ts';
import { abandonJob, acceptJob, escortArrived, escortLost, jobLockReason, type JobDef } from '../../src/economy/jobs.ts';
import { marketTables } from '../../src/economy/markets.ts';

/**
 * Gluts that ship out (docs/PROCGEN.md §21.6–21.7): a glut's shipments to the stations that take its
 * good, clearing it as they set off or as the player buys it up, the stock they move at both ends,
 * the News; and escorts for relief and shipments bound through raided lanes.
 */

afterEach(() => useWorldLog(null));

/** A pilot past the opening, docked at a station, with credits, its world log in use. */
function pilotAt(locationId: string, clock: number): GameState {
  const s = createNewGame(11);
  s.jobs.lifeline = { status: 'complete', objectiveIndex: 4, acceptedAt: 0, completedAt: 1 };
  s.flags.clearance = true;
  s.credits = 200_000;
  s.clock = clock;
  const loc = getLocation(locationId);
  s.location = { systemId: loc.systemId, dockedAt: locationId, flight: null, lastDockId: locationId };
  markVisited(s, loc.systemId, locationId);
  useWorldLog(s.world);
  return s;
}

/** The first glut (hour by hour) with two shipments to two stations, safe on their way, that between them clear it. */
function shippingGlut(): { e: WorldEvent; hauls: readonly Haul[] } {
  for (let clock = 3_600; clock < 300 * 3_600; clock += 3_600) {
    for (const e of eventsAt(clock)) {
      if (e.kind !== 'glut') continue;
      const hauls = shipments(e);
      if (hauls.length !== 2 || hauls[0]!.to === hauls[1]!.to || !hauls.every((h) => haulFate(h).delivered && !raidsOnWay(h).length)) continue;
      const last = Math.max(...hauls.map((h) => h.depart));
      if (shipOutEnd(e) === last && last < e.end - 600 && hauls[0]!.depart !== hauls[1]!.depart) return { e, hauls };
    }
  }
  throw new Error('no glut shipping out');
}

/** The first relief haul or shipment (hour by hour) through a raid, within an escort's reach, from a station with a board. */
function escortable(): { e: WorldEvent; h: Haul } {
  for (let clock = 3_600; clock < 300 * 3_600; clock += 3_600) {
    for (const e of eventsAt(clock)) {
      for (const h of eventHauls(e)) {
        if (h.path.length - 1 <= CONTRACTS.maxJumps.escort && getLocation(h.from).services.includes('contracts') && raidsOnWay(h).length && h.depart - e.start > 120) return { e, h };
      }
    }
  }
  throw new Error('no haul through a raid');
}

/** The escort posted for a haul on its sender's board in a time slot. */
function escortFor(h: Haul, epoch: number): JobDef | undefined {
  return boardFor(h.from, epoch).find((c) => c.contract?.haul === h.id);
}

describe('a glut ships its surplus out', () => {
  it('to the nearest stations that take its good, a share of the surplus each, in its time, on the timetable', () => {
    const { e, hauls } = shippingGlut();
    expect(shipsOut(e)).toBe(true);
    const takers = takersOf(getLocation(e.locationId!), e.goods[0]!).map((l) => l.id);
    hauls.forEach((h, k) => {
      expect(h.id).toBe(`h.${e.id}.${k}`);
      expect(h.kind).toBe('shipment');
      expect(h.glut).toBe(e.id);
      expect(h.from).toBe(e.locationId);
      expect(h.commodity).toBe(e.goods[0]);
      expect(takers.slice(0, HAULS.shipOut.hauls)).toContain(h.to);
      expect(h.qty).toBe(Math.max(HAULS.load.min, Math.round(surplus(e) * HAULS.shipOut.share)));
      expect(h.depart).toBeGreaterThanOrEqual(e.start + HAULS.shipOut.dispatch[0]);
      expect(h.depart).toBeLessThanOrEqual(e.start + HAULS.shipOut.dispatch[1]);
      expect(haulById(h.id)).toBe(h);
    });
    expect(validateHauls(hauls)).toEqual([]);
    expect(surplus(e)).toBeCloseTo((marketTables().get(e.locationId!)!.entries.get(e.goods[0]!)!.target) * (EVENTS.effects.glut.stock - 1), 6);
  });

  it('clears the glut once they have gone (their cargo leaves as each sets off)', () => {
    const { e, hauls } = shippingGlut();
    const [first, last] = [...hauls].sort((a, b) => a.depart - b.depart);
    expect(shippedOut(e, first!.depart - 1)).toBe(0);
    expect(shippedOut(e, first!.depart)).toBe(first!.qty);
    expect(eventEnd(e)).toBe(last!.depart);
    expect(stationEventAt(e.locationId!, last!.depart - 1)?.id).toBe(e.id);
    expect(stationEventAt(e.locationId!, last!.depart)?.id).not.toBe(e.id);
  });

  it('is cleared sooner by the player buying it up, with what has been shipped', () => {
    const { e, hauls } = shippingGlut();
    const first = [...hauls].sort((a, b) => a.depart - b.depart)[0]!;
    const s = pilotAt(e.locationId!, first.depart + 5);
    const need = surplus(e) * EVENTS.react.relief - shippedOut(e, s.clock);
    expect(clearGlut(s, e.locationId!, e.goods[0]!, Math.floor(need / 2))).toBeNull();
    // Another good does not count.
    const other = [...marketTables().get(e.locationId!)!.entries.keys()].find((c) => c !== e.goods[0])!;
    expect(clearGlut(s, e.locationId!, other, 500)).toBeNull();
    const done = clearGlut(s, e.locationId!, e.goods[0]!, Math.ceil(need / 2) + 1)!;
    expect(done.text).toMatch(/^Glut cleared: /);
    expect(done.paid).toBe(0);
    expect(s.world.ended[e.id]).toBe(s.clock);
    expect(stationEventAt(e.locationId!, s.clock + 1)?.id).not.toBe(e.id);
    expect(clearGlut(s, e.locationId!, e.goods[0]!, 10)).toBeNull();
  });

  it('moves stock: its cargo off the glut station as it sets off, and into the station it is bound for as it arrives', () => {
    const { e, hauls } = shippingGlut();
    const [first] = [...hauls].sort((a, b) => a.depart - b.depart);
    const good = e.goods[0]!;
    const before = haulStock(e.locationId!, good, first!.depart - 1);
    expect(haulStock(e.locationId!, good, first!.depart + 1) - before).toBeCloseTo(-first!.qty, 0);
    // Once the glut is over, its normal stock is back.
    expect(haulStock(e.locationId!, good, eventEnd(e) + 1)).toBeCloseTo(0, 6);
    const at = first!.to;
    const was = haulStock(at, good, first!.arrive - 1);
    expect(haulStock(at, good, first!.arrive + 1) - was).toBeCloseTo(first!.qty, 0);
  });

  it('is told in the News, each shipment as it goes, and the haulers fly the lanes', () => {
    const { e, hauls } = shippingGlut();
    const h = [...hauls].sort((a, b) => a.depart - b.depart)[0]!;
    expect(reliefNews(e).map((n) => n.haul.id)).toEqual(hauls.map((x) => x.id));
    const out = h.legs[0]!;
    const mid = (out.start + out.end) / 2;
    expect(haulsIn(out.systemId, mid).some((x) => x.haul.id === h.id)).toBe(true);
  });

  it('includes a frontier harvest, which ships out its first good; and nothing goes to or from a raider den', () => {
    let harvest: WorldEvent | null = null;
    for (let clock = 3_600; clock < 400 * 3_600 && !harvest; clock += 3_600) {
      for (const e of eventsAt(clock)) if (!harvest && e.kind === 'harvest' && shipments(e).length) harvest = e;
    }
    const den = ALL_LOCATIONS.filter((l) => l.stationType === 'pirate-den')
      .flatMap((l) => stationEventsBetween(l.id, 0, 400 * 3_600))
      .find((e) => e.kind === 'shortage');
    expect(harvest).not.toBeNull();
    expect(shipments(harvest!).every((h) => h.commodity === harvest!.goods[0])).toBe(true);
    expect(surplus(harvest!)).toBeGreaterThan(0);
    expect(den).toBeDefined();
    expect(reliefHauls(den!)).toEqual([]);
  });

  it('keeps to its guardrails, and broken shipments are caught', () => {
    const { hauls } = shippingGlut();
    const h = hauls[0]!;
    const rules = (x: Haul) => validateHauls([x]).map((i) => i.rule);
    expect(rules({ ...h, glut: 'e.nowhere.1' })).toContain('shipment');
    expect(rules({ ...h, depart: h.depart - HAULS.shipOut.dispatch[1], legs: h.legs.map((l) => ({ ...l, start: l.start - HAULS.shipOut.dispatch[1], end: l.end - HAULS.shipOut.dispatch[1] })), arrive: h.arrive - HAULS.shipOut.dispatch[1] })).toContain('shipment');
    expect(rules({ ...h, qty: 2 })).toContain('cargo');
  });
});

describe('escorts for relief and shipments through raided lanes', () => {
  it('are posted by the sender from when the event begins until the haul is due to set off, and pass the contract guardrails', () => {
    const { e, h } = escortable();
    const epoch = boardEpoch(Math.max(e.start, h.depart - 60));
    const c = escortFor(h, epoch)!;
    expect(c).toBeDefined();
    expect(c.id).toBe(`c.${h.from}.${epoch}.escort-${h.id.replace(/\./g, '-')}`);
    expect(c.title).toBe(`Escort the ${h.name} to ${getLocation(h.to).name}`);
    expect(c.contract).toMatchObject({ kind: 'escort', event: e.id, haul: h.id, until: h.depart });
    const o = c.objectives[0]!;
    expect(o).toMatchObject({ kind: 'escort', fromLocationId: h.from, locationId: h.to, model: h.model, shipName: h.name, haul: h.id, level: raidsOnWay(h)[0]!.level });
    expect(c.briefing).toContain(h.name);
    expect(contractIssues(c, Math.max(e.start, h.depart - 60))).toEqual([]);
    // Not before the event, nor after the haul has set off.
    expect(escortFor(h, boardEpoch(h.depart) + 1)).toBeUndefined();
    if (boardEpoch(e.start) > 0) expect(escortFor(h, boardEpoch(e.start) - 1)).toBeUndefined();
  });

  it('once taken, hold the haul for the pilot: off its timetable, posted no more, delivered when the escort sees it docked', () => {
    const { e, h } = escortable();
    const clock = Math.max(e.start + 1, h.depart - 60);
    const s = pilotAt(h.from, clock);
    const c = postedContracts(s, h.from).find((x) => x.contract?.haul === h.id)!;
    expect(c).toBeDefined();
    expect(acceptJob(s, c.id).ok).toBe(true);
    expect(s.world.hauls?.[h.id]?.fate).toBe('escort');
    expect(haulFate(h)).toMatchObject({ escort: true, delivered: true, at: Infinity });
    // Its timetable copy does not fly while it waits for the pilot.
    for (const leg of h.legs) expect(haulsIn(leg.systemId, (leg.start + leg.end) / 2).some((x) => x.haul.id === h.id)).toBe(false);
    // Another posting for it (a later time slot's) is gone, and could not be taken.
    s.clock = h.depart + 30;
    expect(postedContracts(s, h.from).some((x) => x.contract?.haul === h.id && x.id !== c.id)).toBe(false);
    expect(jobLockReason(s, { ...c, id: `${c.id}-again` })).toMatch(/already has an escort|set off without an escort/);
    // Arrived with the pilot: in, with its cargo, from then.
    s.clock = h.arrive + 900;
    s.jobs[c.id]!.escortAt = h.path.at(-1)!;
    s.location = { systemId: getLocation(h.to).systemId, dockedAt: null, flight: null, lastDockId: h.from };
    escortArrived(s, c.id);
    expect(s.world.hauls?.[h.id]?.fate).toBe('arrived');
    expect(haulFate(h)).toEqual({ delivered: true, at: s.clock });
    if (h.kind === 'relief') expect(reliefDelivered(e, s.clock)).toBeGreaterThanOrEqual(h.qty);
    dockAt(s, h.to);
    expect(s.jobs[c.id]!.status).toBe('complete');
    assertValidState(s);
  });

  it('lose the haul with the escort, and give it back to its timetable when the job is given up', () => {
    const { e, h } = escortable();
    const clock = Math.max(e.start + 1, h.depart - 60);
    const lost = pilotAt(h.from, clock);
    const c = postedContracts(lost, h.from).find((x) => x.contract?.haul === h.id)!;
    expect(acceptJob(lost, c.id).ok).toBe(true);
    lost.location = { ...lost.location, dockedAt: null };
    escortLost(lost, c.id);
    expect(lost.jobs[c.id]!.status).toBe('failed');
    expect(haulFate(h)).toMatchObject({ delivered: false, by: 'raiders' });
    const given = pilotAt(h.from, clock);
    expect(acceptJob(given, c.id).ok).toBe(true);
    expect(abandonJob(given, c.id).ok).toBe(true);
    expect(given.world.hauls?.[h.id]).toBeUndefined();
    expect(haulFate(h).escort).toBeUndefined();
  });

  it('go once the haul has set off alone', () => {
    const { e, h } = escortable();
    const s = pilotAt(h.from, Math.max(e.start + 1, h.depart - 60));
    const c = postedContracts(s, h.from).find((x) => x.contract?.haul === h.id)!;
    s.clock = h.depart;
    expect(postedContracts(s, h.from).some((x) => x.id === c.id)).toBe(false);
    expect(jobLockReason(s, c)).toBe(`The ${h.name} has set off without an escort`);
  });

  it('keep saves that hold an escorted haul, and refuse a damaged record', () => {
    const { e, h } = escortable();
    const s = pilotAt(h.from, Math.max(e.start + 1, h.depart - 60));
    const c = postedContracts(s, h.from).find((x) => x.contract?.haul === h.id)!;
    acceptJob(s, c.id);
    assertValidState(s);
    const bad = structuredClone(s);
    bad.world.hauls![h.id]!.fate = 'waiting' as 'escort';
    expect(() => assertValidState(bad)).toThrow(/world/);
  });
});
