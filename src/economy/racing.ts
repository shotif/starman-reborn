import type { GameState, ShipState } from '../app/state.ts';
import { applyCredits } from '../app/state.ts';
import { getCatalog, shipModel } from '../content/catalog.ts';
import { FIRST_NAMES, LAST_NAMES } from '../content/people/lines.ts';
import { CLASS_NAMES, CLUB_NAMES, COURSE_NAMES, KIND_NAMES, RACE_CARD, RACE_NEWS } from '../content/racing/lines.ts';
import { jumpsFrom } from '../content/world/network.ts';
import { COURSE_KINDS, RACE_CLASSES, RACING, type CourseKind, type RaceClass } from '../content/racing/rules.ts';
import { rng, roundTo } from '../content/random.ts';
import { ROSTER, type RivalDef } from '../content/rivals/rules.ts';
import { WORLD_SEED } from '../content/world/rules.ts';
import { ALL_LOCATIONS, getLocation, SYSTEMS, WORLD } from '../data/systems.ts';
import type { FactionId, FictionalLocation, SystemId } from '../data/types.ts';
import type { ShipParams } from '../flight/ShipBody.ts';
import { courseLine, type CourseLine } from '../world/courses.ts';
import { simulateRun, skillFor, type PilotSkill } from '../world/racingPilot.ts';
import { sceneDefFor } from '../world/systems/index.ts';
import { FACTIONS, standingTier } from './factions.ts';
import { dockAccess, isLawful } from './law.ts';
import { performanceOf } from './loadout.ts';
import { patchOf, rivalTier, rivalWhere, shift, standingWith } from './rivals.ts';
import { logWrite } from './logbook.ts';

/**
 * Races on the lanes (docs/PROCGEN.md §33): where the clubs are, their courses and members, each
 * heat's field, par and records, and what a pilot's entries and results do to the save. Everything
 * but the pilot's own racing is worked out from the world seed, the same for every player.
 */

// ---------------------------------------------------------------- clubs and courses

export interface Venue {
  locationId: string;
  systemId: SystemId;
  club: string;
  level: 1 | 2 | 3;
  courses: Record<CourseKind, CourseLine>;
}

const openHere = (systemId: SystemId): FictionalLocation[] =>
  ALL_LOCATIONS.filter(
    (l) => l.systemId === systemId && l.status === 'functional' && l.dockable !== false && l.stationType !== 'pirate-den' && l.services.length > 0 && (!l.factionId || isLawful(l.factionId)),
  );

/** A system's host: its hand-made station, else its first open station by the clubs' preference. */
function hostOf(systemId: SystemId): FictionalLocation | undefined {
  const rank = (l: FictionalLocation) => (l.stationType ? RACING.venues.prefer.indexOf(l.stationType) : -1);
  return openHere(systemId)
    .filter((l) => !l.stationType || RACING.venues.prefer.includes(l.stationType))
    .sort((a, b) => rank(a) - rank(b) || a.id.localeCompare(b.id))[0];
}

let venueList: Venue[] | null = null;

/** Every racing club (cached): in each well-policed system with a host and room for both its courses. */
export function venues(): readonly Venue[] {
  if (venueList) return venueList;
  const out: Venue[] = [];
  for (const s of SYSTEMS) {
    if (s.id === 'pyre' || (WORLD.profiles.get(s.id)?.security ?? 1) < RACING.venues.minSecurity) continue;
    const host = hostOf(s.id);
    if (!host) continue;
    const lines = COURSE_KINDS.map((kind) => courseLine({ id: `race.${host.id}.${kind}`, kind, systemId: s.id, hostId: host.id }));
    if (lines.some((l) => !l)) continue;
    const level = s.id === 'sol' ? 1 : (rng(WORLD_SEED, 'club-level', host.id).int(1, 3) as 1 | 2 | 3);
    out.push({ locationId: host.id, systemId: s.id, club: CLUB_NAMES[out.length % CLUB_NAMES.length]!, level, courses: { sprint: lines[0]!, run: lines[1]! } });
  }
  venueList = out;
  return out;
}

export const venueAt = (locationId: string): Venue | undefined => venues().find((v) => v.locationId === locationId);
export const venueIn = (systemId: SystemId): Venue | undefined => venues().find((v) => v.systemId === systemId);

/** A course by id (`race.<host>.<kind>`) with its venue. */
export function courseById(id: string): { venue: Venue; line: CourseLine } | undefined {
  const m = /^race\.(.+)\.(sprint|run)$/.exec(id);
  const venue = m ? venueAt(m[1]!) : undefined;
  return venue ? { venue, line: venue.courses[m![2] as CourseKind] } : undefined;
}

/** A course's name: "Moon Loop", "Halcyon Ring to Deimos Depot", "Meridian Outpost Run". */
export function courseName(line: CourseLine): string {
  const host = getLocation(line.id.split('.')[1]!).name;
  if (line.kind === 'sprint') {
    const def = sceneDefFor(line.systemId);
    const body = def.planets.find((p) => p.id === line.bodyId)?.name ?? def.stars.find((s) => s.id === line.bodyId)?.name ?? line.bodyId;
    return COURSE_NAMES.sprint.replace('{body}', body);
  }
  return line.finishAt ? COURSE_NAMES.run.replace('{from}', host).replace('{to}', getLocation(line.finishAt).name) : COURSE_NAMES.out.replace('{from}', host);
}

/** Which class a hull races in. */
export function raceClass(model: string): RaceClass {
  const c = shipModel(model).class;
  return RACING.classes.light.hulls.includes(c) ? 'light' : 'heavy';
}

export const heatOf = (clock: number) => Math.floor(clock / RACING.heatSeconds);
export const heatStart = (heat: number) => heat * RACING.heatSeconds;

/** The fee and purse at a club: a level-3 club's, scaled by its level's share. */
export function feeOf(venue: Venue, kind: CourseKind): number {
  return roundTo(RACING.pay.fee[kind] * RACING.levels.purse[venue.level - 1]!, 5);
}
export function purseOf(venue: Venue, kind: CourseKind): number {
  return roundTo(RACING.pay.purse[kind] * RACING.levels.purse[venue.level - 1]!, 5);
}
export function prizeFor(venue: Venue, kind: CourseKind, place: number): number {
  const share = RACING.pay.places[place - 1];
  return share ? roundTo(purseOf(venue, kind) * share, 5) : 0;
}

// ---------------------------------------------------------------- members and fields

export interface Member {
  id: string;
  name: string;
  model: string;
  /** Their skill before a heat's form. */
  skill: number;
}

const membersCache = new Map<string, Member[]>();

/** A club's racers in a class: names from the bars' pools, hulls of the class sold at lawful yards, at the club's tiers. */
export function membersOf(venue: Venue, cls: RaceClass): readonly Member[] {
  const key = `${venue.locationId}|${cls}`;
  let list = membersCache.get(key);
  if (!list) {
    const r = rng(WORLD_SEED, 'club', venue.locationId, cls);
    const [t0, t1] = RACING.levels.tiers[venue.level - 1]!;
    const [s0, s1] = RACING.levels.skill[venue.level - 1]!;
    const hulls = getCatalog().ships.filter((m) => RACING.classes[cls].hulls.includes(m.class) && m.maker !== 'wake' && m.tier >= t0 && m.tier <= t1);
    const names = new Set<string>();
    list = Array.from({ length: RACING.field.members }, (_, i) => {
      let name = '';
      for (let k = 0; k < 20 && (!name || names.has(name)); k++) name = `${r.pick(FIRST_NAMES)} ${r.pick(LAST_NAMES)}`;
      names.add(name);
      return { id: `${venue.locationId}.${cls}.${i}`, name, model: r.pick(hulls).id, skill: Math.round(r.range(s0, s1) * 1000) / 1000 };
    });
    membersCache.set(key, list);
  }
  return list;
}

export interface Racer {
  /** A member's id, or a rival's. */
  id: string;
  name: string;
  model: string;
  rival?: string;
  /** Where on the line (the pilot's spot is left in the middle). */
  slot: number;
  skill: PilotSkill;
}

const SKILL: Record<RivalDef['style'], readonly [number, number]> = RACING.rivalSkill;

/** The rivals racing a heat in a class: docked in the club's system at the heat's start, of the class, not out for the pilot. */
export function rivalsInHeat(state: GameState | null, venue: Venue, cls: RaceClass, heat: number): RivalDef[] {
  const at = heatStart(heat);
  return ROSTER.filter((r) => {
    const w = rivalWhere(r, at);
    return w.kind === 'docked' && getLocation(w.locationId).systemId === venue.systemId && raceClass(r.ship) === cls && (!state || rivalTier(state, r.id) !== 'hostile');
  }).slice(0, RACING.field.rivals);
}

/** A heat's field in a class (the pilot not counted): the same for every player, but for rivals out for the pilot. */
export function lineUp(state: GameState | null, courseId: string, cls: RaceClass, heat: number): Racer[] {
  const found = courseById(courseId);
  if (!found) return [];
  const { venue, line } = found;
  const r = rng(WORLD_SEED, 'heat', courseId, cls, heat);
  const rivals = rivalsInHeat(state, venue, cls, heat);
  const members = r.shuffle(membersOf(venue, cls)).slice(0, RACING.field.size - rivals.length);
  const n = members.length + rivals.length;
  const slotOf = (i: number) => (i < Math.floor((n + 1) / 2) ? i : i + 1);
  const lanes = (i: number) => (n > 1 ? -0.35 + (0.7 * i) / (n - 1) : 0);
  const out: Racer[] = [];
  members.forEach((m, i) => {
    const s = Math.min(1.05, Math.max(0.8, m.skill + r.range(-RACING.field.jitter, RACING.field.jitter)));
    out.push({ id: m.id, name: m.name, model: m.model, slot: slotOf(i), skill: skillFor(s, rng(WORLD_SEED, 'heat', courseId, cls, heat, m.id), line.gates.length, lanes(i)) });
  });
  rivals.forEach((rv, j) => {
    const i = members.length + j;
    const [lo, hi] = SKILL[rv.style];
    const s = r.range(lo, hi);
    out.push({ id: rv.id, name: `${rv.first} “${rv.nick}” ${rv.last}`, model: rv.ship, rival: rv.id, slot: slotOf(i), skill: skillFor(s, rng(WORLD_SEED, 'heat', courseId, cls, heat, rv.id), line.gates.length, lanes(i)) });
  });
  return out;
}

/** How many on the line, the pilot's spot included. */
export const gridOf = (racers: readonly Racer[]) => racers.length + 1;

// ---------------------------------------------------------------- par and records

const flightOf = (ship: Pick<ShipState, 'model' | 'fittings'>): ShipParams => performanceOf(ship).flight;
const stockFlight = (model: string): ShipParams => flightOf({ model, fittings: { ...shipModel(model).stock } });
const timeCache = new Map<string, number | null>();

/** The racing pilot's time round a course, flown clean at skill `s` in a hull (cached). */
export function cleanTime(line: CourseLine, flight: ShipParams, s: number, key: string): number | null {
  const k = `${line.id}|${key}|${s}`;
  if (!timeCache.has(k)) timeCache.set(k, simulateRun(line, flight, skillFor(s, null, line.gates.length), 1_200).finish);
  return timeCache.get(k)!;
}

/** Whether a time is already worked out (the window shows a dash until it is). */
export const cleanTimeKnown = (line: CourseLine, key: string, s: number) => timeCache.has(`${line.id}|${key}|${s}`);

/** A class's par on a course: the racing pilot at skill 1 in the class's reference hull. */
export function classPar(line: CourseLine, cls: RaceClass): number {
  const ref = RACING.classes[cls].ref;
  return cleanTime(line, stockFlight(ref), 1, ref) ?? Infinity;
}

/** The pilot's par: the racing pilot at skill 1 in the pilot's own ship as fitted. */
export function ownPar(line: CourseLine, ship: Pick<ShipState, 'model' | 'fittings'>): number | null {
  return cleanTime(line, flightOf(ship), 1, fitKey(ship));
}

const parRuns = new Map<string, { finish: number; splits: readonly number[] } | null>();
const fitKey = (ship: Pick<ShipState, 'model' | 'fittings'>) =>
  `${ship.model}|${Object.entries(ship.fittings)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([s, g]) => `${s}=${g}`)
    .join(',')}`;

/** The pilot's par run in their ship as fitted, with its split at each gate (for the HUD's split). */
export function ownParRun(line: CourseLine, ship: Pick<ShipState, 'model' | 'fittings'>): { finish: number; splits: readonly number[] } | null {
  const k = `${line.id}|${fitKey(ship)}`;
  if (!parRuns.has(k)) {
    const run = simulateRun(line, flightOf(ship), skillFor(1, null, line.gates.length), 1_200);
    parRuns.set(k, run.finish === null ? null : { finish: run.finish, splits: run.state.splits });
    timeCache.set(`${line.id}|${fitKey(ship)}|1`, run.finish);
  }
  return parRuns.get(k)!;
}

export interface ClubRecord {
  time: number;
  /** Who holds it: a member, or a rival pilot who races there. */
  holder: { id: string; name: string; model: string };
}

/** Rival pilots who may race a club's heats in a class: of the class, with a dock of their patch in its system. */
export function rivalsOfClub(venue: Venue, cls: RaceClass): RivalDef[] {
  return ROSTER.filter((r) => raceClass(r.ship) === cls && patchOf(r).some((l) => l.systemId === venue.systemId));
}

/**
 * A course's record in a class: the best its members, or rivals who race there, could fly it, clean
 * at their very best, a little bettered; so no racer in a heat ever beats it, and the pilot can.
 */
export function clubRecord(courseId: string, cls: RaceClass): ClubRecord | null {
  const found = courseById(courseId);
  if (!found) return null;
  let best: ClubRecord | null = null;
  const consider = (holder: ClubRecord['holder'], s: number) => {
    const t = cleanTime(found.line, stockFlight(holder.model), Math.round(Math.min(1.05, s) * 1000) / 1000, holder.model);
    if (t !== null && (!best || t < best.time)) best = { time: t, holder };
  };
  for (const m of membersOf(found.venue, cls)) consider(m, m.skill + RACING.field.jitter);
  for (const r of rivalsOfClub(found.venue, cls)) consider({ id: r.id, name: `${r.first} “${r.nick}” ${r.last}`, model: r.ship }, SKILL[r.style][1]);
  if (!best) return null;
  const b: ClubRecord = best;
  const [lo, hi] = RACING.record;
  return { time: Math.floor(b.time * rng(WORLD_SEED, 'race-record', courseId, cls).range(lo, hi) * 100) / 100, holder: b.holder };
}

/** The record a board shows for a course and class: the club's, or the pilot's once they have beaten it. */
export function boardRecord(state: GameState, courseId: string, cls: RaceClass): { time: number; holder: string; you: boolean } | null {
  const club = clubRecord(courseId, cls);
  const best = racingLog(state)?.courses[courseKey(courseId, cls)]?.best;
  if (best && (!club || best.raw < club.time)) return { time: best.raw, holder: 'You', you: true };
  return club ? { time: club.time, holder: club.holder.name, you: false } : null;
}

/** Whether a club's records and the pilot's par there are worked out yet (the screens show a dash until they are). */
export function clubTimesKnown(venue: Venue, ship: Pick<ShipState, 'model' | 'fittings'>): boolean {
  return clubTimeJobs(venue, ship).length === 0;
}

/** The clean runs a club's window still needs: its records in both classes, and the pilot's par on both courses. */
function clubTimeJobs(venue: Venue, ship: Pick<ShipState, 'model' | 'fittings'>): (() => void)[] {
  const jobs: (() => void)[] = [];
  for (const kind of COURSE_KINDS) {
    const line = venue.courses[kind];
    if (!parRuns.has(`${line.id}|${fitKey(ship)}`)) jobs.push(() => ownParRun(line, ship));
    for (const cls of RACE_CLASSES) {
      const holders = [
        ...membersOf(venue, cls).map((m) => ({ model: m.model, s: Math.min(1.05, m.skill + RACING.field.jitter) })),
        ...rivalsOfClub(venue, cls).map((r) => ({ model: r.ship, s: SKILL[r.style][1] })),
      ];
      for (const h of holders) {
        const s = Math.round(Math.min(1.05, h.s) * 1000) / 1000;
        if (!cleanTimeKnown(line, h.model, s)) jobs.push(() => cleanTime(line, stockFlight(h.model), s, h.model));
      }
    }
  }
  return jobs;
}

/** Works out a club's times a run at a time between frames, then calls `done` (never if all were known). */
export function warmClubTimes(venue: Venue, ship: Pick<ShipState, 'model' | 'fittings'>, done: () => void): void {
  const jobs = clubTimeJobs(venue, ship);
  if (!jobs.length) return;
  const next = () => {
    const job = jobs.shift();
    if (!job) return done();
    job();
    setTimeout(next, 0);
  };
  setTimeout(next, 0);
}

/** Times on the clock: "1:23.45". */
export function raceTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds - m * 60;
  return `${m}:${s < 10 ? '0' : ''}${s.toFixed(2)}`;
}

// ---------------------------------------------------------------- the pilot's racing

export interface RaceEntry {
  course: string;
  cls: RaceClass;
  heat: number;
  at: number;
  fee: number;
}

export interface RaceCourseLog {
  runs: number;
  finished: number;
  podiums: number;
  wins: number;
  best?: { raw: number; ship: string; at: number };
  /** When the club paid for the course record in this class. */
  record?: number;
}

export type RaceEnd = 'retired' | 'cut' | 'lost' | 'lapsed' | 'voided';

export interface RaceResult {
  course: string;
  cls: RaceClass;
  heat: number;
  at: number;
  /** 0: did not finish. */
  place: number;
  of: number;
  raw?: number;
  prize: number;
  /** Who won it (a member's id, a rival's, or `pilot`). */
  first?: string;
  how?: RaceEnd;
}

export interface RacingLog {
  entry?: RaceEntry;
  /** The last heat the pilot raced (one a heat, anywhere). */
  ran?: number;
  /** By course and class: `<course>.<class>`. */
  courses: Record<string, RaceCourseLog>;
  results: RaceResult[];
}

export const racingLog = (state: GameState): RacingLog | undefined => state.world.racing;
const logOf = (state: GameState): RacingLog => (state.world.racing ??= { courses: {}, results: [] });
export const courseKey = (course: string, cls: RaceClass) => `${course}.${cls}`;

/** The heat an entry made now is for: this one, if enough of it is left, else the next. */
export function entryHeat(clock: number): number {
  const h = heatOf(clock);
  return heatStart(h + 1) - clock >= RACING.start.earlyClose ? h : h + 1;
}

/** Why the pilot cannot enter a course now, or null. */
export function entryBlock(state: GameState, courseId: string): string | null {
  const found = courseById(courseId);
  if (!found) return RACE_CARD.lockClass;
  const { venue, line } = found;
  const log = racingLog(state);
  if (state.jobs.lifeline?.status !== 'complete') return RACE_CARD.lockOpening;
  if (log?.entry) return RACE_CARD.lockEntered;
  if (log?.ran !== undefined && log.ran >= entryHeat(state.clock)) return RACE_CARD.lockRaced;
  const owner = getLocation(venue.locationId).factionId as FactionId | undefined;
  if (owner && (state.law.fines[owner] ?? 0) > 0) return RACE_CARD.lockFines.replace('{faction}', FACTIONS[owner].name);
  if (owner && isLawful(owner) && (['hostile', 'wary'].includes(standingTier(state.reputation[owner] ?? 0)) || dockAccess(state, venue.locationId) !== 'full')) return RACE_CARD.lockStanding.replace('{faction}', FACTIONS[owner].name);
  if (state.credits < feeOf(venue, line.kind)) return RACE_CARD.lockFee;
  return null;
}

/** Enters the pilot in a course's next heat, in their ship's class: the fee is paid now. */
export function enterRace(state: GameState, courseId: string): { ok: boolean; message: string } {
  const block = entryBlock(state, courseId);
  if (block) return { ok: false, message: block };
  const { venue, line } = courseById(courseId)!;
  const fee = feeOf(venue, line.kind);
  const cls = raceClass(state.ship.model);
  applyCredits(state, -fee, 'fee', `Race entry: ${courseName(line)}`);
  logOf(state).entry = { course: courseId, cls, heat: entryHeat(state.clock), at: state.clock, fee };
  return { ok: true, message: `Entered the ${courseName(line)}, ${CLASS_NAMES[cls].toLowerCase()} class: fly to the start line.` };
}

function record(state: GameState, r: RaceResult): void {
  const log = logOf(state);
  log.results.push(r);
  if (log.results.length > RACING.keep.results) log.results.splice(0, log.results.length - RACING.keep.results);
  log.ran = r.heat;
  delete log.entry;
}

/** An entry ends without a finish: retired, cut off, the ship lost, the heat closed before a start, or the wrong class of hull. */
export function endEntry(state: GameState, how: RaceEnd, first?: string, of = 0): RaceResult | null {
  const e = racingLog(state)?.entry;
  if (!e) return null;
  const started = how === 'retired' || how === 'cut' || how === 'lost';
  if (started) {
    const c = (logOf(state).courses[courseKey(e.course, e.cls)] ??= { runs: 0, finished: 0, podiums: 0, wins: 0 });
    c.runs++;
  }
  const r: RaceResult = { course: e.course, cls: e.cls, heat: e.heat, at: state.clock, place: 0, of, prize: 0, how, ...(first ? { first } : {}) };
  record(state, r);
  return r;
}

/** An entry whose heat has closed without a start lapses (its fee kept). */
export function settleRacing(state: GameState, racing: boolean): RaceResult | null {
  const e = racingLog(state)?.entry;
  if (!e || racing) return null;
  if (state.clock >= heatStart(e.heat + 1)) return endEntry(state, 'lapsed');
  return null;
}

export interface Standing {
  id: string;
  name: string;
  model: string;
  rival?: string;
  /** Seconds, or null for one who did not finish. */
  time: number | null;
}

export interface RaceCard {
  course: string;
  name: string;
  cls: RaceClass;
  place: number;
  of: number;
  raw: number;
  prize: number;
  recordPrize: number;
  best: boolean;
  points: number;
  rows: (Standing & { you?: true })[];
}

/** Racing rating points a result is worth at a club. */
function pointsFor(venue: Venue, place: number, record: boolean): number {
  const P = RACING.points;
  return venue.level * (P.finish + (place <= 3 ? P.podium : 0) + (place === 1 ? P.win : 0) + (record ? P.record : 0));
}

/** The pilot crossed the finish line in `raw` seconds: places, the prize, the record, the save. */
export function finishRace(state: GameState, raw: number, field: readonly Standing[]): RaceCard | null {
  const e = racingLog(state)?.entry;
  const found = e ? courseById(e.course) : undefined;
  if (!e || !found) return null;
  const { venue, line } = found;
  const time = Math.round(raw * 100) / 100;
  const ahead = field.filter((f) => f.time !== null && f.time < time).length;
  const place = ahead + 1;
  const of = field.length + 1;
  const prize = prizeFor(venue, line.kind, place);
  const c = (logOf(state).courses[courseKey(e.course, e.cls)] ??= { runs: 0, finished: 0, podiums: 0, wins: 0 });
  c.runs++;
  c.finished++;
  if (place <= 3) c.podiums++;
  if (place === 1) c.wins++;
  const best = !c.best || time < c.best.raw;
  if (best) c.best = { raw: time, ship: state.ship.model, at: state.clock };
  const club = clubRecord(e.course, e.cls);
  const isRecord = !c.record && !!club && time < club.time;
  if (isRecord) c.record = state.clock;
  // The logbook (docs/PROCGEN.md §46.1): a race won, a course record.
  if (place === 1) logWrite(state, { kind: 'race', id: e.course, x: 'won', where: state.location.systemId });
  if (isRecord) logWrite(state, { kind: 'race', id: e.course, x: 'record', where: state.location.systemId });
  const recordPrize = isRecord ? RACING.pay.record : 0;
  const name = courseName(line);
  if (prize + recordPrize > 0) applyCredits(state, prize + recordPrize, 'reward', `Race prize: ${name}`);
  for (const f of field) if (f.rival && standingWith(state, f.rival) < RACING.standing.upTo) shift(state, f.rival, Math.min(RACING.standing.raced, RACING.standing.upTo - standingWith(state, f.rival)));
  const rows: RaceCard['rows'] = [...field, { id: 'pilot', name: 'You', model: state.ship.model, time, you: true as const }].sort((a, b) => (a.time ?? Infinity) - (b.time ?? Infinity));
  record(state, { course: e.course, cls: e.cls, heat: e.heat, at: state.clock, place, of, raw: time, prize: prize + recordPrize, first: rows[0]!.id });
  return { course: e.course, name, cls: e.cls, place, of, raw: time, prize, recordPrize, best, points: pointsFor(venue, place, isRecord), rows };
}

/** The Racing rating's score: its points over every course and class raced (docs/PROCGEN.md §33.9). */
export function racingScore(state: GameState): number {
  const log = racingLog(state);
  if (!log) return 0;
  const P = RACING.points;
  let score = 0;
  for (const [key, c] of Object.entries(log.courses)) {
    const venue = courseById(key.replace(/\.(light|heavy)$/, ''))?.venue;
    if (!venue) continue;
    score += venue.level * (c.finished * P.finish + c.podiums * P.podium + c.wins * P.win + (c.record ? P.record : 0));
  }
  return score;
}

export interface RacingNews {
  id: string;
  at: number;
  headline: string;
  text: string;
}

/** The pilot's wins and records told in the News within reach of a system, newest first (docs/PROCGEN.md §33.6). */
export function racingNews(state: GameState, systemId: SystemId, clock: number): RacingNews[] {
  const log = racingLog(state);
  if (!log) return [];
  const jumps = jumpsFrom(WORLD.links, systemId);
  const out: RacingNews[] = [];
  for (const r of log.results) {
    const found = courseById(r.course);
    if (!found || clock - r.at > RACING.news.seconds || clock < r.at || (jumps.get(found.venue.systemId) ?? Infinity) > RACING.news.jumps || r.raw === undefined) continue;
    const fill = (t: string) =>
      t
        .replace('{club}', found.venue.club)
        .replace('{course}', courseName(found.line))
        .replace('{station}', getLocation(found.venue.locationId).name)
        .replace('{time}', raceTime(r.raw!))
        .replace('{class}', CLASS_NAMES[r.cls].toLowerCase());
    const record = log.courses[courseKey(r.course, r.cls)]?.record === r.at;
    if (record) out.push({ id: `${r.course}.${r.heat}.record`, at: r.at, headline: fill(RACE_NEWS.record.headline), text: fill(RACE_NEWS.record.text) });
    else if (r.place === 1) out.push({ id: `${r.course}.${r.heat}.won`, at: r.at, headline: fill(RACE_NEWS.won.headline), text: fill(RACE_NEWS.won.text) });
  }
  return out.reverse();
}

/** Courses, classes and kinds, for the screens. */
export { COURSE_KINDS, RACE_CLASSES, KIND_NAMES };
