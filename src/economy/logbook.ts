import type { GameState, LogEntry, Logbook } from '../app/state.ts';
import { shipModel } from '../content/catalog.ts';
import { outpostSite } from '../content/outposts/sites.ts';
import { LOG_LINES, LOGBOOK } from '../content/progress/logbook.ts';
import { MILESTONES } from '../content/progress/rules.ts';
import { ARC_JOBS, ARCS } from '../content/story/arcs.ts';
import type { ArcId } from '../content/story/types.ts';
import { asteroidOf } from '../data/asteroids.ts';
import { cometOf } from '../data/comets.ts';
import { gameJulianDate } from '../data/solar.ts';
import { getLocation, getPlanet, getSystem, isInventedSystem } from '../data/systems.ts';
import type { FactionId, SystemId } from '../data/types.ts';
import type { RouteHop } from '../galaxy/routing.ts';
import { dateText } from './binaries.ts';
import { FACTIONS } from './factions.ts';
import { courseById, courseName } from './racing.ts';
import { rankName } from './ranks.ts';

/**
 * The pilot's logbook (docs/PROCGEN.md §46): written as the career goes, through the game's own
 * functions (a jump, a ship bought, a finale, a promotion, a milestone, a race, a charter, a tow home,
 * a comet, planet or asteroid scanned), with the pilot's bests.
 */

/** Where the pilot is: the dock, or the system. */
const here = (state: GameState): string => state.location.dockedAt ?? state.location.systemId;

/**
 * The save's logbook. A save from before it begins one (§46.5) with what it can date: milestones,
 * promotions, finished stories and stations of its own, each at its own time, and an entry saying how
 * many systems had been visited before.
 */
export function logbookOf(state: GameState): Logbook {
  if (state.logbook) return state.logbook;
  const entries: LogEntry[] = [];
  for (const m of MILESTONES) {
    const at = state.milestones[m.id];
    if (at !== undefined) entries.push({ at, kind: 'milestone', id: m.id });
  }
  for (const [f, r] of Object.entries(state.ranks ?? {})) if (r && !r.fell) entries.push({ at: r.at, kind: 'rank', id: f, x: r.rank, where: r.where });
  for (const j of ARC_JOBS) {
    const p = state.jobs[j.id];
    if (j.story?.finale && p?.status === 'complete') entries.push({ at: p.completedAt ?? state.clock, kind: 'story', id: j.story.arc });
  }
  for (const o of state.world.outposts ?? []) {
    const site = outpostSite(o.site);
    entries.push({ at: o.founded, kind: 'outpost', id: o.site, x: o.name, ...(site ? { where: site.systemId } : {}) });
  }
  entries.sort((a, b) => a.at - b.at);
  entries.push({ at: state.clock, kind: 'begun', x: state.visitedSystems.length, where: here(state) });
  state.logbook = { entries, bests: {}, comets: [], ships: [...new Set([state.ship.model, ...state.fleet.ships.map((s) => s.ship.model)])] };
  trim(state.logbook);
  return state.logbook;
}

/** Past `LOGBOOK.keep` entries the oldest go, but never the first. */
function trim(book: Logbook): void {
  if (book.entries.length > LOGBOOK.keep) book.entries.splice(1, book.entries.length - LOGBOOK.keep);
}

/** Writes an entry now. */
export function logWrite(state: GameState, e: Omit<LogEntry, 'at'>): void {
  const book = logbookOf(state);
  book.entries.push({ at: state.clock, ...e });
  trim(book);
}

/** A jump done (§46.1, §46.2): the systems reached for the first time, and the longest hop. */
export function noteJump(state: GameState, firsts: readonly SystemId[], hops: readonly RouteHop[]): void {
  for (const id of firsts) logWrite(state, { kind: 'visit', id, where: id });
  const book = logbookOf(state);
  for (const h of hops) if (h.distanceLy > (book.bests.jump?.ly ?? 0)) book.bests.jump = { ly: h.distanceLy, from: h.from, to: h.to, at: state.clock };
}

/** A ship bought: traded in for, or bought and the old one kept. */
export function noteShip(state: GameState, model: string, how: 'traded' | 'kept', locationId: string): void {
  logWrite(state, { kind: 'ship', id: model, x: how, where: locationId });
  const book = logbookOf(state);
  if (!book.ships.includes(model)) book.ships.push(model);
}

/** A job paid: the biggest pay, and an arc's finale. */
export function notePaid(state: GameState, paid: number, title: string, arc?: ArcId): void {
  const book = logbookOf(state);
  if (paid > (book.bests.pay?.n ?? 0)) book.bests.pay = { n: paid, title, at: state.clock };
  if (arc) logWrite(state, { kind: 'story', id: arc, where: here(state) });
}

/** The most credits held, sampled whenever the game saves. */
export function notePeak(state: GameState): void {
  const book = logbookOf(state);
  if (state.credits > (book.bests.credits?.n ?? 0)) book.bests.credits = { n: state.credits, at: state.clock, where: here(state) };
}

/** A comet scanned: true the first time (§45). */
export function noteComet(state: GameState, cometId: string): boolean {
  const book = logbookOf(state);
  if (!cometOf(cometId) || book.comets.includes(cometId)) return false;
  book.comets.push(cometId);
  logWrite(state, { kind: 'comet', id: cometId, where: 'sol' });
  return true;
}

/** A named asteroid scanned: true the first time (§47.6). */
export function noteAsteroid(state: GameState, asteroidId: string): boolean {
  const book = logbookOf(state);
  const seen = (book.asteroids ??= []);
  if (!asteroidOf(asteroidId) || seen.includes(asteroidId)) return false;
  seen.push(asteroidId);
  logWrite(state, { kind: 'asteroid', id: asteroidId, where: 'sol' });
  return true;
}

/** The farthest real star visited (ly from Sol), and which: Pyre, invented, is left out. */
export function farthestVisited(state: GameState): { systemId: SystemId; ly: number } | null {
  let best: { systemId: SystemId; ly: number } | null = null;
  for (const id of state.visitedSystems) {
    if (isInventedSystem(id)) continue;
    const ly = getSystem(id).distanceLightYears;
    if (!best || ly > best.ly) best = { systemId: id, ly };
  }
  return best;
}

// ---------------------------------------------------------------- what is said

/** A place's name: a dock, or a system. */
export function placeName(where: string | undefined): string {
  if (!where) return '';
  try {
    return getLocation(where).name;
  } catch {
    try {
      return getSystem(where as SystemId).displayName;
    } catch {
      return where;
    }
  }
}

const systemName = (id: string | undefined) => (id ? placeName(id) : '');
/** A named asteroid's number and name (`99942 Apophis`). */
const asteroidName = (id: string | undefined) => {
  const a = id ? asteroidOf(id) : undefined;
  return a ? `${a.number} ${a.name}` : '';
};

/** An entry, said. */
export function logText(e: LogEntry): string {
  const fill = (text: string, values: Record<string, string>) => text.replace(/\{(\w+)\}/g, (_, k: string) => values[k] ?? '');
  const place = placeName(e.where);
  switch (e.kind) {
    case 'signed':
      return fill(LOG_LINES.signed, { place });
    case 'begun':
      return fill(LOG_LINES.begun, { count: String(e.x ?? 0) });
    case 'visit':
      return fill(LOG_LINES.visit, { system: systemName(e.id) });
    case 'ship':
      return fill(e.x === 'kept' ? LOG_LINES.ship.kept : LOG_LINES.ship.traded, { ship: e.id ? shipModel(e.id).name : '' });
    case 'story':
      return fill(LOG_LINES.story, { arc: ARCS[e.id as ArcId]?.title ?? e.id ?? '' });
    case 'rank':
      return fill(LOG_LINES.rank, { rank: rankName(e.id as FactionId, Number(e.x)) ?? '', faction: FACTIONS[e.id as FactionId]?.name ?? e.id ?? '' });
    case 'milestone':
      return fill(LOG_LINES.milestone, { milestone: MILESTONES.find((m) => m.id === e.id)?.title ?? e.id ?? '' });
    case 'race': {
      const found = e.id ? courseById(e.id) : undefined;
      return fill(e.x === 'record' ? LOG_LINES.race.record : LOG_LINES.race.won, { course: found ? courseName(found.line) : (e.id ?? '') });
    }
    case 'outpost':
      return fill(LOG_LINES.outpost, { station: String(e.x ?? '') });
    case 'towed':
      return fill(LOG_LINES.towed, { system: systemName(e.id), place });
    case 'comet':
      return fill(LOG_LINES.comet, { comet: (e.id && cometOf(e.id)?.name) || '' });
    case 'planet':
      return fill(LOG_LINES.planet, { planet: (e.id && getPlanet(e.id)?.displayName) || '' });
    case 'asteroid':
      return fill(LOG_LINES.asteroid, { asteroid: asteroidName(e.id) });
  }
}

/** An entry's day, on the game's calendar (when the save began, plus the time played). */
export function logDate(state: GameState, at: number): string {
  const jd = gameJulianDate(state.createdAt, at);
  return jd === null ? '' : dateText(jd);
}

/** The bests (§46.2), said: a heading, a value and a note. */
export function logBests(state: GameState): { key: string; value: string; note: string }[] {
  const book = logbookOf(state);
  const b = book.bests;
  const out: { key: string; value: string; note: string }[] = [];
  const cr = (n: number) => `${n.toLocaleString('en-GB')} cr`;
  if (b.credits) out.push({ key: 'credits', value: cr(b.credits.n), note: `${logDate(state, b.credits.at)}, ${placeName(b.credits.where)}` });
  if (b.jump) out.push({ key: 'jump', value: `${b.jump.ly.toFixed(1)} ly`, note: `${placeName(b.jump.from)} to ${placeName(b.jump.to)}, ${logDate(state, b.jump.at)}` });
  if (b.pay) out.push({ key: 'pay', value: cr(b.pay.n), note: `${b.pay.title}, ${logDate(state, b.pay.at)}` });
  const far = farthestVisited(state);
  if (far && far.systemId !== 'sol') out.push({ key: 'far', value: `${far.ly.toFixed(1)} ly`, note: placeName(far.systemId) });
  out.push({ key: 'systems', value: String(state.visitedSystems.length), note: '' });
  out.push({ key: 'ships', value: String(book.ships.length), note: '' });
  if (book.comets.length) out.push({ key: 'comets', value: String(book.comets.length), note: '' });
  if (book.asteroids?.length) out.push({ key: 'asteroids', value: String(book.asteroids.length), note: '' });
  return out;
}
