import { applyCredits, type CrewLog, type CrewMember, type GameState } from '../app/state.ts';
import { COMMODITIES } from '../content/economy/goods.ts';
import { CREW_FICTION, CREW_FIRST, CREW_GREETING, CREW_LAST, CREW_NOTES, CREW_SAYS, CREW_STORY, GRADE_WORD, MORALE_WORD, ROLE_WORD } from '../content/crew/lines.ts';
import { CREW, CREW_HEARTS, CREW_ROLES, type CrewDeed, type CrewGrade, type CrewHeart, type CrewRole, type FavourKind, type MoraleBand } from '../content/crew/rules.ts';
import { PEOPLE } from '../content/people/rules.ts';
import { hashString, rng } from '../content/random.ts';
import { jumpsFrom } from '../content/world/network.ts';
import type { StationType } from '../content/world/types.ts';
import { ALL_LOCATIONS, getLocation, getSystem, WORLD } from '../data/systems.ts';
import type { SystemId } from '../data/types.ts';
import { addCargo, itemsThatFit } from './cargo.ts';
import { quartersOf } from './crewQuarters.ts';
import { boardEpoch } from './contracts.ts';
import { adjustReputation } from './factions.ts';
import { advanceJobs, failJob, type JobDef, type JobEvent } from './jobs.ts';
import { dockAccess, wakeFriendly } from './law.ts';
import { cargoCapacity } from './loadout.ts';

/**
 * Your crew (docs/PROCGEN.md §30; rules in src/content/crew/rules.ts): who sits at a bar's tables
 * looking for a berth, hiring and letting go, what the crew aboard do for the ship, their wages,
 * morale, hurts and stories. Settled at each dock from the clock and the deeds counted since the
 * last (economy/crewDeeds.ts), in time with the fleet and rivals' stories; settling twice at one
 * dock changes nothing.
 */

const C = CREW;
const HOUR = 3_600;
const fill = (text: string, values: Record<string, string | number>) => text.replace(/\{(\w+)\}/g, (_, k: string) => String(values[k] ?? ''));
const clamp = (m: number) => Math.max(0, Math.min(100, Math.round(m)));
const line = (list: readonly string[], key: string) => list[hashString(key) % list.length]!;

/** The crew log, made when first needed (settled from now). */
export function aboardOf(state: GameState): CrewLog {
  return (state.aboard ??= { members: [], since: state.clock, kills: state.stats.kills, deeds: {} });
}

export const crewAboard = (state: GameState): CrewMember[] => state.aboard?.members ?? [];
export const crewMember = (state: GameState, id: string): CrewMember | undefined => crewAboard(state).find((m) => m.id === id);
export const isHurt = (m: CrewMember, clock: number): boolean => !!m.hurt && clock < m.hurt.until;

export function moraleBand(morale: number): MoraleBand {
  return morale < C.morale.low ? 'low' : morale >= C.morale.high ? 'high' : 'steady';
}
export const moraleWord = (m: CrewMember) => MORALE_WORD[moraleBand(m.morale)];
export const roleWord = (role: CrewRole) => ROLE_WORD[role];
/** "Seasoned gunner". */
export const gradeRole = (m: Pick<CrewMember, 'grade' | 'role'>) => `${GRADE_WORD[m.grade]} ${ROLE_WORD[m.role].toLowerCase()}`;

// ---------------------------------------------------------------- hands looking for a berth

export interface CrewOffer {
  id: string;
  name: string;
  role: CrewRole;
  heart: CrewHeart;
  grade: CrewGrade;
  /** Credits a game hour, and to sign on. */
  wage: number;
  fee: number;
  greeting: string;
}

const CREW_SEED = 0xc4e3;

/** The station type a bar is like (the hand-made stations map to the nearest type). */
function barTypeOf(locationId: string): StationType | null {
  return getLocation(locationId).stationType ?? PEOPLE.curated[locationId] ?? null;
}

/** The bar shift (the regulars' seats change with it). */
export const crewShift = (clock: number) => Math.floor(boardEpoch(clock) / PEOPLE.shift);

/** Hands looking for a berth at a bar this shift (the same for every pilot), before anyone is hired. */
export function handsAt(locationId: string, clock: number): CrewOffer[] {
  if (getLocation(locationId).status !== 'functional') return [];
  const kind = barTypeOf(locationId);
  const roles = kind ? C.offers.where[kind] : undefined;
  if (!roles?.length) return [];
  const shift = crewShift(clock);
  const r = rng(CREW_SEED, 'crew', locationId, shift);
  return roles.map((x, i) => {
    const role: CrewRole = x === 'any' ? r.pick(CREW_ROLES) : x;
    const roll = r.next();
    const [g1, g2] = C.offers.grade;
    const grade: CrewGrade = roll < g1 ? 1 : roll < g1 + g2 ? 2 : 3;
    const heart: CrewHeart = kind === 'pirate-den' ? C.offers.denHeart : r.pick(CREW_HEARTS);
    const id = `crew.${locationId}.${shift}.${i}`;
    return { id, name: `${r.pick(CREW_FIRST)} ${r.pick(CREW_LAST)}`, role, heart, grade, wage: C.wage[grade], fee: C.wage[grade] * C.signOnHours, greeting: line(CREW_GREETING[heart], id) };
  });
}

/** Hands at a bar the player may sit down with: a full-service bar (a den's only for a pilot the Wake trusts), those not aboard already. */
export function crewOffers(state: GameState, locationId: string): CrewOffer[] {
  if (dockAccess(state, locationId) !== 'full') return [];
  if (getLocation(locationId).stationType === 'pirate-den' && !wakeFriendly(state)) return [];
  return handsAt(locationId, state.clock).filter((o) => !crewMember(state, o.id));
}

/** Why a hand cannot sign on now (null: they can). */
export function hireBlock(state: GameState, locationId: string, offer: CrewOffer): string | null {
  const crew = crewAboard(state);
  if (state.location.dockedAt !== locationId) return 'Dock first.';
  if (dockAccess(state, locationId) !== 'full') return 'Nobody here will sign on with a wanted pilot.';
  if (crewMember(state, offer.id)) return `${offer.name} is aboard already.`;
  if (crew.some((m) => m.role === offer.role)) return `You have ${ROLE_WORD[offer.role].toLowerCase() === 'engineer' ? 'an' : 'a'} ${ROLE_WORD[offer.role].toLowerCase()} aboard already.`;
  const q = quartersOf(state.ship.model);
  if (crew.length >= Math.min(C.max, q)) return `No quarters free: your ship has room for ${q} crew.`;
  if (state.credits < offer.fee) return `Signing on costs ${offer.fee} cr.`;
  return null;
}

export interface CrewAct {
  ok: boolean;
  message: string;
  /** What the crew member says. */
  line?: string;
}

/** Hires a hand: two hours' wages to sign on, paid from then on. */
export function hireCrew(state: GameState, locationId: string, offerId: string): CrewAct {
  const offer = crewOffers(state, locationId).find((o) => o.id === offerId);
  if (!offer) return { ok: false, message: 'They have found another ship.' };
  const block = hireBlock(state, locationId, offer);
  if (block) return { ok: false, message: block };
  const a = aboardOf(state);
  // With nobody aboard until now, the deeds count from now.
  if (!a.members.length) {
    a.since = state.clock;
    a.kills = state.stats.kills;
    a.deeds = {};
  }
  applyCredits(state, -offer.fee, 'fee', `Signed on ${offer.name}`);
  const said = line(CREW_SAYS.hired, offer.id);
  a.members.push({ id: offer.id, name: offer.name, role: offer.role, heart: offer.heart, grade: offer.grade, hired: state.clock, paidTo: state.clock, morale: C.morale.start, said });
  return { ok: true, message: fill(CREW_NOTES.hired, { name: offer.name, role: ROLE_WORD[offer.role].toLowerCase() }), line: said };
}

/** Someone leaves the ship (let go, or too unhappy to stay): remembered in the journal; an open favour goes with them. */
function leave(state: GameState, m: CrewMember, locationId: string, why: 'let-go' | 'unhappy'): JobEvent | null {
  const a = aboardOf(state);
  a.members = a.members.filter((x) => x.id !== m.id);
  const former = (a.former ??= []);
  former.push({ name: m.name, role: m.role, at: state.clock, locationId, why });
  if (former.length > C.former) former.splice(0, former.length - C.former);
  const job = m.story?.favour?.job;
  return job && state.jobs[job]?.status === 'active' ? failJob(state, job, `${m.name} has left your crew`) : null;
}

/** Lets someone go at a dock, their wages paid to now. */
export function letGo(state: GameState, memberId: string): CrewAct & { events: JobEvent[] } {
  const at = state.location.dockedAt;
  const m = crewMember(state, memberId);
  if (!at || !m) return { ok: false, message: 'Dock first.', events: [] };
  payWages(state);
  const ev = leave(state, m, at, 'let-go');
  return { ok: true, message: fill(CREW_NOTES.letGo, { name: m.name, station: getLocation(at).name }), line: line(CREW_SAYS.letGo, m.id), events: ev ? [ev] : [] };
}

// ---------------------------------------------------------------- what they do aboard

/** What the crew do for the ship now (docs/PROCGEN.md §30.2): each well member's bonus by grade, scaled by morale. */
export interface CrewEffects {
  /** Engineer: a damaged system mended by this much (0–1) a second, while no hostile is within `quiet` m, down to `floor` (0–1). */
  mend: number;
  floor: number;
  quiet: number;
  /** Shield recharge, gun damage: fractions more. Lock times, jump fees: fractions less. Scan range: a fraction more. */
  shieldRegen: number;
  gunDamage: number;
  lock: number;
  fee: number;
  scan: number;
}

export function crewEffects(state: GameState, clock = state.clock): CrewEffects {
  const E = C.effects;
  const e: CrewEffects = { mend: 0, floor: E.engineer.floor / 100, quiet: E.engineer.quiet, shieldRegen: 0, gunDamage: 0, lock: 0, fee: 0, scan: 0 };
  for (const m of crewAboard(state)) {
    if (isHurt(m, clock)) continue;
    const f = C.morale.factor[moraleBand(m.morale)];
    const g = m.grade - 1;
    if (m.role === 'engineer') {
      e.mend = (E.engineer.mend[g]! * f) / 100 / 60;
      e.shieldRegen = E.engineer.shieldRegen[g]! * f;
    } else if (m.role === 'gunner') {
      e.gunDamage = E.gunner.damage[g]! * f;
      e.lock = E.gunner.lock[g]! * f;
    } else {
      e.fee = E.navigator.fee[g]! * f;
      e.scan = E.navigator.scan[g]! * f;
    }
  }
  return e;
}

/** A jump's fee with the navigator's discount (whole credits). */
export function crewFee(state: GameState, fee: number): number {
  const cut = crewEffects(state).fee;
  return cut > 0 ? Math.round(fee * (1 - cut)) : fee;
}

/** What one crew member does, in words (their card and dialog). */
export function effectWords(m: Pick<CrewMember, 'role' | 'grade'>, band: MoraleBand = 'steady'): string {
  const f = C.morale.factor[band];
  const g = m.grade - 1;
  const pc = (x: number) => `${Math.round(x * f * 100)}%`;
  const E = C.effects;
  if (m.role === 'engineer') return `Mends damaged systems in flight (${Math.round(E.engineer.mend[g]! * f)} points a minute, down to ${E.engineer.floor}%) when no hostile is near, and the shield recharges ${pc(E.engineer.shieldRegen[g]!)} faster.`;
  if (m.role === 'gunner') return `Guns hit ${pc(E.gunner.damage[g]!)} harder, and seekers and torpedoes lock on ${pc(E.gunner.lock[g]!)} sooner.`;
  return `Jump fees ${pc(E.navigator.fee[g]!)} lower, and scans reach ${pc(E.navigator.scan[g]!)} further.`;
}

// ---------------------------------------------------------------- hurt, and mending

/** A hit hurts whoever works the system (docs/PROCGEN.md §30.5): out of action until mended. The one hurt, or null. */
export function hurtCrew(state: GameState, role: CrewRole): CrewMember | null {
  const m = crewAboard(state).find((x) => x.role === role);
  if (!m || isHurt(m, state.clock)) return null;
  m.hurt = { at: state.clock, until: state.clock + C.hurt.mend, docks: 0 };
  m.morale = clamp(m.morale + C.morale.hurt);
  return m;
}

/** The ship lost: everyone aboard is hurt and shaken. */
export function crewShipLost(state: GameState): CrewMember[] {
  const crew = crewAboard(state);
  for (const m of crew) {
    if (!isHurt(m, state.clock)) m.hurt = { at: state.clock, until: state.clock + C.hurt.mend, docks: 0 };
    m.morale = clamp(m.morale + C.morale.shipLost);
    m.said = line(CREW_SAYS.shipLost, m.id);
  }
  return crew;
}

/** A dock's medic (any dock that repairs ships): what treating everyone hurt costs (0: nobody to treat, or no medic). */
export function treatQuote(state: GameState, locationId: string): number {
  if (!getLocation(locationId).services.includes('repair')) return 0;
  return crewAboard(state).filter((m) => isHurt(m, state.clock)).length * C.hurt.treat;
}

export function treatCrew(state: GameState, locationId: string): CrewAct {
  const cost = treatQuote(state, locationId);
  if (state.location.dockedAt !== locationId || cost <= 0) return { ok: false, message: 'Nobody here to treat.' };
  if (state.credits < cost) return { ok: false, message: `Treatment costs ${cost} cr.` };
  applyCredits(state, -cost, 'repair', 'Treatment for your crew');
  const names: string[] = [];
  for (const m of crewAboard(state)) {
    if (!isHurt(m, state.clock)) continue;
    delete m.hurt;
    m.morale = clamp(m.morale + C.morale.treated);
    m.said = line(CREW_SAYS.treated, m.id);
    names.push(m.name);
  }
  return { ok: true, message: names.map((name) => fill(CREW_NOTES.treated, { name })).join(' ') };
}

/** A round for the crew in the bar (once a shift). Why not now, or null. */
export function roundBlock(state: GameState): string | null {
  const crew = crewAboard(state);
  if (!crew.length) return 'Nobody aboard to stand a round for.';
  if (state.aboard?.round === crewShift(state.clock)) return 'You stood them a round this shift already.';
  if (state.credits < crew.length * C.morale.round.price) return `A round costs ${crew.length * C.morale.round.price} cr.`;
  return null;
}

export function buyCrewRound(state: GameState): CrewAct {
  const block = roundBlock(state);
  if (block) return { ok: false, message: block };
  const crew = crewAboard(state);
  applyCredits(state, -crew.length * C.morale.round.price, 'fee', 'A round for the crew');
  for (const m of crew) {
    m.morale = clamp(m.morale + C.morale.round.gain);
    m.said = line(CREW_SAYS.round, `${m.id}|${state.clock}`);
  }
  aboardOf(state).round = crewShift(state.clock);
  return { ok: true, message: 'A round for the crew. Spirits lift.' };
}

// ---------------------------------------------------------------- wages

/** Wages owed now (hours since each was paid, by grade). */
export function wagesOwed(state: GameState): number {
  return crewAboard(state).reduce((sum, m) => sum + Math.round((C.wage[m.grade] * Math.max(0, state.clock - m.paidTo)) / HOUR), 0);
}

/** Pays each crew member to now if the credits allow; who could not be paid. */
function payWages(state: GameState): { paid: number; unpaid: CrewMember[] } {
  let paid = 0;
  const unpaid: CrewMember[] = [];
  for (const m of crewAboard(state)) {
    const due = Math.round((C.wage[m.grade] * Math.max(0, state.clock - m.paidTo)) / HOUR);
    if (due <= 0) {
      m.paidTo = state.clock;
      continue;
    }
    if (state.credits < due) {
      unpaid.push(m);
      continue;
    }
    applyCredits(state, -due, 'fee', `Wages: ${m.name}`);
    m.paidTo = state.clock;
    paid += due;
  }
  return { paid, unpaid };
}

// ---------------------------------------------------------------- their stories

/** Where a favour goes from a dock (docs/PROCGEN.md §30.6): the nearest place of its kind within reach, ties by the save's luck; or null. */
export function favourPlace(state: GameState, m: CrewMember, from: string): { to: string; systemId?: SystemId } | null {
  const rule = C.stories.favours[m.heart];
  const jumps = jumpsFrom(WORLD.links, getLocation(from).systemId);
  const tie = rng(state.seed, 'crew-story', m.id);
  const order = new Map<string, number>();
  const key = (id: string) => (order.has(id) ? order.get(id)! : (order.set(id, tie.next()), order.get(id)!));
  if (rule.kind === 'pack') {
    // A station (not a den) of the nearest lawless system within reach: the pack lurks by it.
    const places = ALL_LOCATIONS.filter((l) => l.status === 'functional' && l.stationType !== 'pirate-den' && (WORLD.profiles.get(l.systemId)?.security ?? 1) < rule.lawless! && (jumps.get(l.systemId) ?? 99) <= rule.reach)
      .map((l) => ({ id: l.id, systemId: l.systemId, d: jumps.get(l.systemId)! }))
      .sort((a, b) => a.d - b.d || key(a.id) - key(b.id));
    const p = places[0];
    return p ? { to: p.id, systemId: p.systemId } : null;
  }
  const places = ALL_LOCATIONS.filter((l) => l.id !== from && l.status === 'functional' && rule.to.includes((barTypeOf(l.id) ?? '') as StationType) && (jumps.get(l.systemId) ?? 99) <= rule.reach)
    .map((l) => ({ id: l.id, d: jumps.get(l.systemId)! }))
    .sort((a, b) => a.d - b.d || key(a.id) - key(b.id));
  return places[0] ? { to: places[0].id } : null;
}

export const favourJobId = (m: CrewMember) => `cs.${m.id}`;

/** A favour asked and not yet taken or done: what it is. */
export interface FavourOffer {
  kind: FavourKind;
  /** What they say, filled in. */
  ask: string;
  to: string;
  pay: number;
  /** Why it cannot be taken now (a full hold for the crate), or null. */
  lock: string | null;
}

export function favourOffer(state: GameState, m: CrewMember): FavourOffer | null {
  const f = m.story?.favour;
  if (!f || f.job || m.story?.ended || state.clock > f.until) return null;
  const rule = C.stories.favours[m.heart];
  const station = getLocation(f.to);
  const ask = fill(CREW_STORY[m.heart].ask, { station: station.name, system: getSystem(station.systemId).displayName, count: rule.count ?? 0 });
  let lock: string | null = null;
  if (rule.cargo && itemsThatFit(state.ship.cargo, rule.cargo.commodity, cargoCapacity(state.ship)) < rule.cargo.qty) lock = `No room in the hold for the crate (${rule.cargo.qty} ${COMMODITIES[rule.cargo.commodity].name.toLowerCase()}).`;
  return { kind: rule.kind, ask, to: f.to, pay: rule.pay, lock };
}

/** Takes on a crew member's favour: an ordinary job (a letter's visit, a crate's delivery, a pack's bounty), open for the rules' time. */
export function takeFavour(state: GameState, memberId: string): CrewAct & { jobId?: string } {
  const m = crewMember(state, memberId);
  const offer = m ? favourOffer(state, m) : null;
  if (!m || !offer) return { ok: false, message: 'There is no favour to take.' };
  if (offer.lock) return { ok: false, message: offer.lock };
  const rule = C.stories.favours[m.heart];
  const at = state.location.dockedAt ?? offer.to;
  const dest = getLocation(offer.to);
  const id = favourJobId(m);
  const base = { id, giverLocationId: at, factionId: null, reward: rule.pay, repReward: {}, destinationLocationId: dest.id, briefing: `${offer.ask} ${CREW_FICTION}` } as const;
  let job: JobDef;
  if (rule.kind === 'letter') {
    job = { ...base, title: `${m.name}’s letter`, objectives: [{ kind: 'visit', locationId: dest.id, text: `Carry ${m.name}’s letter to ${dest.name}` }], difficulty: 1, difficultyNote: 'A favour for your crew', contract: { kind: 'parcel', crew: m.id } };
  } else if (rule.kind === 'crate') {
    const c = rule.cargo!;
    addCargo(state.ship.cargo, c.commodity, c.qty, cargoCapacity(state.ship));
    job = { ...base, title: `${m.name}’s crate`, objectives: [{ kind: 'deliver', commodity: c.commodity, qty: c.qty, locationId: dest.id, text: `Deliver ${m.name}’s sealed crate to ${dest.name}` }], difficulty: 2, difficultyNote: 'Contraband: a scan will find it', contract: { kind: 'smuggle', crew: m.id, cargo: { ...c } } };
  } else {
    job = { ...base, title: `${m.name}’s old quarry`, objectives: [{ kind: 'bounty', systemId: dest.systemId, locationId: dest.id, count: rule.count!, level: rule.level!, text: `Destroy the Wake pack lurking near ${dest.name}` }], difficulty: rule.level!, difficultyNote: 'A favour for your crew', contract: { kind: 'bounty', crew: m.id } };
  }
  state.contracts[id] = job;
  state.jobs[id] = { status: 'active', objectiveIndex: 0, acceptedAt: state.clock };
  m.story!.favour!.job = id;
  m.story!.favour!.until = state.clock + C.stories.do;
  return { ok: true, message: `Taken on: ${job.title}.`, jobId: id };
}

/** Puts a favour aside for now (it stays open until its time is up). */
export const favourWaits = (state: GameState, m: CrewMember) => !!favourOffer(state, m);

// ---------------------------------------------------------------- settling at a dock

export interface CrewNote {
  text: string;
  tone: 'good' | 'bad' | 'info';
  /** Who speaks, and what they say (the radio line or their dialog). */
  name?: string;
  line?: string;
}

/** A favour's job came to an end: done (a grade, cheer), failed or out of time. */
function settleFavour(state: GameState, m: CrewMember, notes: CrewNote[], jobs: JobEvent[]): void {
  const s = m.story;
  const f = s?.favour;
  if (!s || !f || s.ended) return;
  const M = C.morale.story;
  if (!f.job) {
    if (state.clock > f.until) {
      s.ended = { at: state.clock, how: 'lapsed' };
      m.morale = clamp(m.morale + M.lapsed);
      m.said = CREW_STORY[m.heart].lapsed;
      notes.push({ text: fill(CREW_NOTES.lapsed, { name: m.name }), tone: 'info', name: m.name, line: m.said });
    }
    return;
  }
  const status = state.jobs[f.job]?.status;
  if (status === 'active' && state.clock > f.until) {
    const ev = failJob(state, f.job, 'its time ran out');
    if (ev) jobs.push(ev);
  }
  const now = state.jobs[f.job]?.status;
  if (now === 'complete') {
    s.ended = { at: state.clock, how: 'done' };
    m.morale = clamp(m.morale + M.done);
    m.said = CREW_STORY[m.heart].thanks;
    notes.push({ text: fill(CREW_NOTES.done, { name: m.name }), tone: 'good', name: m.name, line: m.said });
    const rule = C.stories.favours[m.heart];
    if (rule.standing) {
      const owner = getLocation(f.to).factionId;
      if (owner) adjustReputation(state.reputation, owner, rule.standing);
    }
    if (m.grade < 3) {
      m.grade = (m.grade + 1) as CrewGrade;
      notes.push({ text: fill(CREW_NOTES.graded, { name: m.name, grade: GRADE_WORD[m.grade].toLowerCase(), role: ROLE_WORD[m.role].toLowerCase() }), tone: 'good' });
    }
  } else if (now === 'failed' || now === undefined) {
    s.ended = { at: state.clock, how: 'failed' };
    m.morale = clamp(m.morale + M.failed);
    m.said = CREW_STORY[m.heart].failed;
    notes.push({ text: fill(CREW_NOTES.failed, { name: m.name }), tone: 'bad', name: m.name, line: m.said });
  }
}

/**
 * Settles the crew (docs/PROCGEN.md §30): favours done, failed or out of time whenever it is called;
 * and, docked at `at` with clock passed since the last dock, the mending, the deeds since then as each
 * heart weighs them, rest, wages, the stories' beats, and notice given or served. Running it twice
 * changes nothing.
 */
export function settleCrew(state: GameState, at: string | null): { notes: CrewNote[]; jobs: JobEvent[] } {
  const notes: CrewNote[] = [];
  const jobs: JobEvent[] = [];
  const a = state.aboard;
  if (!a) return { notes, jobs };
  for (const m of a.members) settleFavour(state, m, notes, jobs);
  if (!at || state.clock <= a.since) return { notes, jobs };
  if (!a.members.length) {
    a.since = state.clock;
    a.kills = state.stats.kills;
    a.deeds = {};
    return { notes, jobs };
  }
  const M = C.morale;
  const deeds: Partial<Record<CrewDeed, number>> = { ...a.deeds, raider: (a.deeds.raider ?? 0) + Math.max(0, state.stats.kills - a.kills) };
  const rested = state.clock - a.since >= M.rest.after;
  for (const m of [...a.members]) {
    // Mending: well again with time; still hurt, a dock passed untreated.
    if (m.hurt && state.clock >= m.hurt.until) {
      delete m.hurt;
      notes.push({ text: fill(CREW_NOTES.mended, { name: m.name }), tone: 'good' });
    } else if (m.hurt) {
      m.hurt.docks += 1;
      m.morale = clamp(m.morale + M.untreated);
    }
    // Their heart: the deeds since the last dock, at most so much either way.
    const heart = C.hearts[m.heart];
    let d = 0;
    let liked = 0;
    for (const deed of heart.likes) liked += deeds[deed] ?? 0;
    d += liked * M.liked;
    for (const deed of heart.hates) d += (deeds[deed] ?? 0) * M.hated;
    m.morale = clamp(m.morale + Math.max(-M.cap, Math.min(M.cap, d)));
    if (rested && m.morale < M.rest.upTo) m.morale = Math.min(M.rest.upTo, m.morale + M.rest.gain);
    // Their story's first beats.
    const s = (m.story ??= { seen: 0 });
    if (!s.ended) s.seen += liked;
    const need = m.heart === 'ex-patrol' ? C.stories.raiders : C.stories.tale;
    if (s.told === undefined && s.seen >= need) {
      s.told = state.clock;
      m.morale = clamp(m.morale + M.story.told);
      m.said = CREW_STORY[m.heart].tale;
      notes.push({ text: fill(CREW_NOTES.tale, { name: m.name }), tone: 'info', name: m.name });
    } else if (s.told !== undefined && !s.favour && !s.ended && state.clock - s.told >= C.stories.favourAfter) {
      const place = favourPlace(state, m, at);
      if (place) {
        s.favour = { asked: state.clock, to: place.to, ...(place.systemId ? { systemId: place.systemId } : {}), until: state.clock + C.stories.take };
        m.said = favourOffer(state, m)?.ask ?? m.said;
        notes.push({ text: fill(CREW_NOTES.favour, { name: m.name }), tone: 'info', name: m.name });
      }
    }
  }
  // Wages, to now.
  const { paid, unpaid } = payWages(state);
  if (paid > 0) notes.push({ text: fill(CREW_NOTES.paid, { credits: `${paid} cr` }), tone: 'info' });
  for (const m of unpaid) {
    m.morale = clamp(m.morale + M.unpaid);
    m.said = line(CREW_SAYS.unpaid, m.id);
    notes.push({ text: fill(CREW_NOTES.unpaid, { name: m.name }), tone: 'bad', name: m.name, line: m.said });
  }
  // Notice: given when unhappy at a dock, served at the next if still unhappy, taken back if not.
  for (const m of [...a.members]) {
    if (moraleBand(m.morale) === 'low') {
      if (m.notice !== undefined) {
        const ev = leave(state, m, at, 'unhappy');
        if (ev) jobs.push(ev);
        notes.push({ text: fill(CREW_NOTES.leaves, { name: m.name, station: getLocation(at).name }), tone: 'bad', name: m.name, line: line(CREW_SAYS.leaves, m.id) });
      } else {
        m.notice = state.clock;
        m.said = line(CREW_SAYS.notice, m.id);
        notes.push({ text: fill(CREW_NOTES.notice, { name: m.name }), tone: 'bad', name: m.name, line: m.said });
      }
    } else if (m.notice !== undefined) {
      delete m.notice;
      m.said = line(CREW_SAYS.stays, m.id);
      notes.push({ text: fill(CREW_NOTES.stays, { name: m.name }), tone: 'good', name: m.name, line: m.said });
    }
  }
  a.since = state.clock;
  a.kills = state.stats.kills;
  a.deeds = {};
  return { notes, jobs };
}

/** Favours whose jobs came to an end in flight or at a dock's counter: settled at once (the dock part waits for the next dock). */
export function settleFavours(state: GameState): { notes: CrewNote[]; jobs: JobEvent[] } {
  return settleCrew(state, null);
}

// ---------------------------------------------------------------- in words

/** A crew member's state in a few words: their tags. */
export function crewTags(state: GameState, m: CrewMember): ('Hurt' | 'Notice' | 'Story' | 'Favour')[] {
  const tags: ('Hurt' | 'Notice' | 'Story' | 'Favour')[] = [];
  if (isHurt(m, state.clock)) tags.push('Hurt');
  if (m.notice !== undefined) tags.push('Notice');
  if (favourOffer(state, m) || (m.story?.favour?.job && state.jobs[m.story.favour.job]?.status === 'active')) tags.push('Favour');
  else if (m.story?.told !== undefined && !m.story.ended) tags.push('Story');
  return tags;
}

/** The deck's crew line: "3 aboard · Steady · the gunner hurt, well in 1 h". */
export function crewLine(state: GameState): string {
  const crew = crewAboard(state);
  if (!crew.length) return '';
  const avg = crew.reduce((s, m) => s + m.morale, 0) / crew.length;
  const hurt = crew.filter((m) => isHurt(m, state.clock));
  const parts = [`${crew.length} aboard`, MORALE_WORD[moraleBand(avg)]];
  for (const m of hurt) parts.push(`the ${ROLE_WORD[m.role].toLowerCase()} hurt, well in ${Math.max(1, Math.ceil((m.hurt!.until - state.clock) / HOUR))} h`);
  const notice = crew.filter((m) => m.notice !== undefined);
  if (notice.length) parts.push(`${notice.map((m) => m.name).join(' and ')} giving notice`);
  return parts.join(' · ');
}

/** Advances jobs after a favour is taken where it may already be satisfied (e.g. docked at its station). */
export function advanceAfterFavour(state: GameState): JobEvent[] {
  return advanceJobs(state, { dockedAt: state.location.dockedAt, systemId: state.location.systemId });
}
