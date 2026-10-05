import { applyCredits, type CommodityId, type GameState, type OutpostDefence, type OutpostGuard, type OutpostRaid, type OutpostRecord } from '../app/state.ts';
import { COMMODITIES } from '../content/economy/goods.ts';
import { DENS } from '../content/dens/rules.ts';
import { EVENTS } from '../content/events/rules.ts';
import { LAW } from '../content/law/rules.ts';
import { RAID_FICTION, RAID_NEWS, RAID_NOTES, RAID_WATCH } from '../content/outposts/raidLines.ts';
import { OUTPOST_RAIDS, type RaidBand } from '../content/outposts/raids.ts';
import { outpostId, outpostSite } from '../content/outposts/sites.ts';
import { hashString, rng } from '../content/random.ts';
import { jumpsFrom } from '../content/world/network.ts';
import { ALL_LOCATIONS, getSystem, WORLD } from '../data/systems.ts';
import type { SystemId } from '../data/types.ts';
import { FLEETS } from '../world/traffic/plan.ts';
import { trafficFor } from '../world/traffic/setup.ts';
import { cargoCount, removeCargo } from './cargo.ts';
import { WING_FIRST, WING_LAST } from './combat.ts';
import { boardEpoch } from './contracts.ts';
import { raidFolk } from './folk.ts';
import { activeOutposts, systemEventAt } from './events.ts';
import { standingTier } from './factions.ts';
import { advanceJobs, failJob, type JobDef, type JobEvent } from './jobs.ts';
import { outpostOdds } from './ranks.ts';
import { isLawful, totalFines, wakeFriendly } from './law.ts';
import { marketTables } from './markets.ts';
import { riskOf } from './tradeComputer.ts';

/**
 * Raids on the player's outposts (docs/PROCGEN.md §29; rules in src/content/outposts/raids.ts), each
 * on its own. An outpost's time is cut into windows; each holds at most one raid, worked out from the save's seed,
 * the site and the window, at odds set by its system's band and the outpost's stage. A raid warned
 * of is a job (*Defend …*); it is fought in flight when the player is there, and otherwise decided
 * by the defence the outpost had (turrets, guards, patrols, standing) against the raiders'
 * strength. A raid lost cuts the income for a while, leaves the market short of a good, takes a
 * share of what is stored there and knocks a turret out; it never touches the player's credits.
 * Raids are settled with the fleet (economy/fleet.ts settleFleet), in time order with the income.
 */

const R = OUTPOST_RAIDS;
const W = R.window;
const HOUR = 3_600;

const security = (systemId: SystemId) => WORLD.profiles.get(systemId)?.security ?? 1;
const fill = (text: string, values: Record<string, string | number>) => text.replace(/\{(\w+)\}/g, (_, k: string) => String(values[k] ?? ''));
const pick = <T>(list: readonly T[], key: string): T => rng(0x5ead, 'outpost-line', key).pick(list);
const goodName = (c: CommodityId) => COMMODITIES[c].name.toLowerCase();
/** The player's outpost docked at, if any. */
const dockedOutpost = (state: GameState) => (state.world.outposts ?? []).find((o) => state.location.dockedAt === outpostId(o.site));

/** The outpost's system. */
export function outpostSystem(o: OutpostRecord): SystemId {
  return outpostSite(o.site)!.systemId;
}

/** The band raids reckon by: the system's security, as the trade computer reckons routes. */
export function raidBand(o: OutpostRecord): RaidBand {
  return riskOf(security(outpostSystem(o)));
}

/** The outpost's defences and raid record, made when first needed. */
export function defenceOf(o: OutpostRecord): OutpostDefence {
  return (o.defence ??= { turrets: 0, delivered: {}, down: [], guards: [], raids: [], settled: firstWindow(o) });
}

// ---------------------------------------------------------------- the windows

/** Each site's windows are shifted, so outposts are not all raided on the same beat. */
const phase = (site: string) => hashString(`outpost-raid|${site}`) % W;
export const windowStart = (o: OutpostRecord, n: number) => phase(o.site) + n * W;
export const windowOf = (o: OutpostRecord, t: number) => Math.floor((t - phase(o.site)) / W);
/** The first window a raid may strike in: once the outpost has been open for the grace. */
export const firstWindow = (o: OutpostRecord) => Math.max(0, windowOf(o, (o.opened ?? o.founded) + R.grace));

/** A raid as a window holds it: when it strikes, when the outpost's watch sees it coming, how strong. */
export interface RaidPlan {
  window: number;
  at: number;
  warnAt: number;
  threat: 1 | 2 | 3;
  ships: number;
  /** The first raid on the outpost: a probe. */
  probe: boolean;
  /** The chance this window held a raid. */
  odds: number;
}

/** When window `n`'s raid would strike, if it holds one (the first draw of its luck). */
function strikeAt(state: GameState, o: OutpostRecord, n: number): { at: number; luck: () => number } {
  const r = rng(state.seed, 'outpost-raid', o.site, o.founded, n);
  const [s0, s1] = R.strike;
  return { at: Math.round(windowStart(o, n) + W * (s0 + (s1 - s0) * r.next())), luck: () => r.next() };
}

/** The window the probe comes in, in thin or lawless space: the first whose strike is past the grace. */
function probeWindow(state: GameState, o: OutpostRecord): number {
  const n = firstWindow(o);
  return strikeAt(state, o, n).at >= (o.opened ?? o.founded) + R.grace ? n : n + 1;
}

/** Whether a raider den of the system is dark at a moment (knocked out: no raids from it). */
function denDark(state: GameState, systemId: SystemId, t: number): boolean {
  return ALL_LOCATIONS.some((l) => l.systemId === systemId && l.stationType === 'pirate-den' && state.dens[l.id] !== undefined && t >= state.dens[l.id]! && t < state.dens[l.id]! + DENS.downSeconds);
}

/** The raid window `n` holds, if any: none in secure space, during a sweep or with the system's den dark. */
export function raidIn(state: GameState, o: OutpostRecord, n: number): RaidPlan | null {
  if (o.stage <= 0 || n < firstWindow(o)) return null;
  const sys = outpostSystem(o);
  if (security(sys) >= R.maxSecurity) return null;
  const { at, luck } = strikeAt(state, o, n);
  if (at < (o.opened ?? o.founded) + R.grace) return null;
  const event = systemEventAt(sys, at);
  if (event?.kind === 'sweep' || denDark(state, sys, at)) return null;
  const band = raidBand(o);
  const probe = !o.defence?.raids.length;
  let odds = R.odds[band] * (R.stage[Math.min(o.stage, R.stage.length) - 1] ?? 1);
  if (event?.kind === 'raid') odds = Math.min(R.raidEvent.max, odds * R.raidEvent.odds);
  if (wakeFriendly(state)) odds *= R.trusted;
  // A pilot of rank with the Wake sees its raids less often still (docs/PROCGEN.md §32.3).
  odds *= outpostOdds(state);
  // The probe: in thin or lawless space, the first window once the grace is over always holds it.
  const sure = probe && band !== 'patrolled' && n === probeWindow(state, o) && !wakeFriendly(state);
  if (!sure && luck() >= odds) return null;
  const threat = probe ? 1 : (Math.max(1, Math.min(3, R.threat[band] + (event?.kind === 'raid' ? R.raidEvent.threat : 0) - (o.stage === 1 ? 1 : 0))) as 1 | 2 | 3);
  return { window: n, at, warnAt: at - (probe ? R.probe.warning : R.warning), threat, ships: threat + 1, probe, odds: sure ? 1 : odds };
}

/** The raid a flight fought, as its window holds it (or as the flight had it, should the window no longer hold it). */
export function foughtPlan(state: GameState, o: OutpostRecord, f: { window: number; at: number; threat: 1 | 2 | 3; ships: number }): RaidPlan {
  return raidIn(state, o, f.window) ?? { window: f.window, at: f.at, warnAt: f.at - R.warning, threat: f.threat, ships: f.ships, probe: false, odds: 0 };
}

/** The next raid not yet settled: from the window settled to, through the present and `ahead` windows on; or null. */
export function nextRaid(state: GameState, o: OutpostRecord, ahead = 2): RaidPlan | null {
  if (o.stage <= 0) return null;
  const from = o.defence?.settled ?? firstWindow(o);
  const to = windowOf(o, state.clock) + ahead;
  for (let n = from; n <= to; n++) {
    const plan = raidIn(state, o, n);
    if (plan) return plan;
  }
  return null;
}

/** Past windows that held no raid are settled as they are (so the next look starts after them). */
export function skipQuietWindows(state: GameState, o: OutpostRecord): void {
  if (o.stage <= 0) return;
  const d = defenceOf(o);
  const now = windowOf(o, state.clock);
  while (d.settled < now && !raidIn(state, o, d.settled)) d.settled++;
}

// ---------------------------------------------------------------- the defence

export interface Defence {
  /** Turrets up, guards on post, the system's patrol wings, and friendly standing with its owner. */
  turrets: number;
  guards: OutpostGuard[];
  wings: number;
  friendly: boolean;
  /** All told, as the rules weigh it against the raiders' strength. */
  value: number;
}

/** Turrets up at a moment (built, and not knocked out). */
export function turretsUp(o: OutpostRecord, t: number): number {
  const d = o.defence;
  if (!d) return 0;
  let n = 0;
  for (let i = 0; i < d.turrets; i++) if (!((d.down[i] ?? 0) > t)) n++;
  return n;
}

/** Guards on post at a moment. */
export function guardsOnPost(o: OutpostRecord, t: number): OutpostGuard[] {
  return (o.defence?.guards ?? []).filter((g) => g.from <= t && t < g.until);
}

/** What defends the outpost at a moment. */
export function defenceAt(state: GameState, o: OutpostRecord, t: number): Defence {
  const sys = outpostSystem(o);
  const turrets = turretsUp(o, t);
  const guards = guardsOnPost(o, t);
  const wings = trafficFor(sys, 'high', t).plan.patrolWings;
  const owner = WORLD.profiles.get(sys)?.owner ?? null;
  const friendly = isLawful(owner) && ['friendly', 'trusted'].includes(standingTier(state.reputation[owner] ?? 0));
  const D = R.defence;
  const value = turrets * D.turret + guards.reduce((sum, g) => sum + D.guard[g.skill], 0) + wings * D.patrolWing + (friendly ? D.friendly : 0);
  return { turrets, guards, wings, friendly, value };
}

/** The chance of holding a raid of a threat with a defence (interpolated from the rules' table, at most the last row's). */
export function holdOdds(value: number, threat: 1 | 2 | 3, downed = 0, ships = threat + 1): number {
  const strength = R.strength[threat] * Math.max(0, 1 - downed / Math.max(1, ships));
  if (strength <= 0) return 1;
  const x = value / strength;
  const table = R.hold;
  if (x <= table[0]![0]) return table[0]![1];
  for (let i = 1; i < table.length; i++) {
    const [x0, y0] = table[i - 1]!;
    const [x1, y1] = table[i]!;
    if (x <= x1) return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
  }
  return table.at(-1)![1];
}

/** The odds in words, for the watch and the Outpost window. */
export function oddsWord(p: number): string {
  const pc = Math.round(p * 100);
  if (p >= 0.85) return `Your defences should hold (${pc}%).`;
  if (p >= 0.6) return `Your defences will probably hold (${pc}%).`;
  if (p >= 0.4) return `It could go either way (${pc}%).`;
  if (p > 0) return `Your defences will probably fall (${pc}%).`;
  return 'Nothing defends it.';
}

// ---------------------------------------------------------------- settling a raid

/** The job a warned raid is: hold the outpost. */
export const raidJobId = (o: OutpostRecord, window: number) => `op.${o.site}.${window}`;

/**
 * Decides a raid: fought in flight (`result` given), or away, by the defence it had against the
 * raiders' strength (less the ones the player downed before leaving). A raid lost hurts the outpost.
 */
export function settleRaid(state: GameState, o: OutpostRecord, plan: RaidPlan, where: 'away' | 'flight', fought?: { result?: 'held' | 'lost'; downed?: number }): { raid: OutpostRaid; events: JobEvent[] } {
  const d = defenceOf(o);
  let result = fought?.result;
  if (!result) {
    const p = holdOdds(defenceAt(state, o, plan.at).value, plan.threat, fought?.downed ?? 0, plan.ships);
    result = rng(state.seed, 'outpost-raid-luck', o.site, o.founded, plan.window).next() < p ? 'held' : 'lost';
  }
  const raid: OutpostRaid = { window: plan.window, at: plan.at, threat: plan.threat, result, where };
  // Its people remember it (docs/PROCGEN.md §41.3).
  raidFolk(o, plan.at, result);
  if (result === 'lost') {
    const took = hurt(state, o, plan);
    if (took) raid.took = took;
  }
  d.raids.push(raid);
  if (d.raids.length > R.keep) d.raids.splice(0, d.raids.length - R.keep);
  d.settled = Math.max(d.settled, plan.window + 1);
  // Guards whose term is over are let go.
  d.guards = d.guards.filter((g) => g.until > state.clock);
  const events: JobEvent[] = [];
  const job = raidJobId(o, plan.window);
  if (state.jobs[job]?.status === 'active') {
    if (result === 'held') {
      state.jobs[job]!.outpost = 'held';
      events.push(...advanceJobs(state, { dockedAt: state.location.dockedAt, systemId: state.location.systemId }));
    } else {
      const ev = failJob(state, job, 'the raiders got into the stores');
      if (ev) events.push(ev);
    }
  }
  return { raid, events };
}

/** A raid lost: the income cut, the market short of a good, a share of what is stored taken, a turret knocked out. What storage lost, in words. */
function hurt(state: GameState, o: OutpostRecord, plan: RaidPlan): string | undefined {
  const d = defenceOf(o);
  const L = R.lost;
  const id = outpostId(o.site);
  const goods = [...(marketTables().get(id)?.entries.keys() ?? [])].sort();
  const good = goods.length ? rng(state.seed, 'outpost-raid-good', o.site, plan.window).pick(goods) : 'food';
  d.hurt = { from: plan.at, until: plan.at + L.hours[plan.threat] * HOUR, good };
  // The last turret standing takes the brunt.
  for (let i = d.turrets - 1; i >= 0; i--) {
    if ((d.down[i] ?? 0) > plan.at) continue;
    d.down[i] = plan.at + R.turrets.downSeconds;
    break;
  }
  const hold = state.fleet.storage[id];
  if (!hold) return undefined;
  const taken: string[] = [];
  for (const c of Object.keys(hold).sort() as CommodityId[]) {
    const n = Math.floor(cargoCount(hold, c) * L.stored);
    if (n <= 0) continue;
    removeCargo(hold, c, n);
    taken.push(`${n} ${goodName(c)}`);
  }
  return taken.length ? taken.join(', ') : undefined;
}

/** What the game says of a raid settled: the notice, and the watch's line. */
export function raidNote(o: OutpostRecord, raid: OutpostRaid): { text: string; tone: 'good' | 'bad'; watch: string } {
  const d = o.defence!;
  if (raid.result === 'held') return { text: fill(RAID_NOTES.held, { outpost: o.name }), tone: 'good', watch: pick(RAID_WATCH.held, `${o.site}|${raid.window}`) };
  const turret = d.down.some((t) => t === raid.at + R.turrets.downSeconds) ? RAID_NOTES.turretDown : '';
  const text = fill(RAID_NOTES.lost, { outpost: o.name, hours: R.lost.hours[raid.threat], good: d.hurt ? goodName(d.hurt.good) : 'goods', took: raid.took ? `; they took ${raid.took} from your storage` : '' }) + turret;
  return { text, tone: 'bad', watch: pick(RAID_WATCH.lost, `${o.site}|${raid.window}`) };
}

/** The income an hour is cut to by a raid lost (1: not cut). */
export function hurtFactor(o: OutpostRecord, t: number): number {
  const h = o.defence?.hurt;
  return h && t >= h.from && t < h.until ? R.lost.income : 1;
}

/** What the turrets cost an hour, out of the income. */
export function upkeep(o: OutpostRecord): number {
  return (o.defence?.turrets ?? 0) * R.turrets.upkeep;
}

// ---------------------------------------------------------------- the watch

/** A raid's warning: the job posted, and what is said (once a raid). */
export interface RaidWarning {
  plan: RaidPlan;
  text: string;
  watch: string;
  speaker: string;
  jobId: string;
}

/** The watch sees a raid coming: once, from its warning on, until it strikes. */
export function raidWarning(state: GameState, o: OutpostRecord): RaidWarning | null {
  const plan = nextRaid(state, o, 2);
  if (!plan || state.clock < plan.warnAt || state.clock >= plan.at) return null;
  const d = defenceOf(o);
  if (d.warned === plan.window) return null;
  d.warned = plan.window;
  const minutes = Math.max(1, Math.round((plan.at - state.clock) / 60));
  const p = holdOdds(defenceAt(state, o, plan.at).value, plan.threat);
  const jobId = raidJobId(o, plan.window);
  postRaidJob(state, o, plan, jobId);
  return {
    plan,
    jobId,
    speaker: `${o.name} watch`,
    text: fill(RAID_NOTES.warning, { outpost: o.name, ships: plan.ships, minutes, odds: oddsWord(p) }),
    watch: fill(pick(plan.probe ? RAID_WATCH.probe : RAID_WATCH.warning, `${o.site}|${plan.window}`), { ships: plan.ships, minutes }),
  };
}

function postRaidJob(state: GameState, o: OutpostRecord, plan: RaidPlan, id: string): void {
  // Only the latest raid's job is kept: older ones go once settled.
  for (const old of Object.keys(state.jobs)) {
    if (old.startsWith(`op.${o.site}.`) && old !== id && state.jobs[old]!.status !== 'active') {
      delete state.jobs[old];
      delete state.contracts[old];
    }
  }
  const sys = outpostSystem(o);
  const job: JobDef = {
    id,
    title: `Defend ${o.name}`,
    giverLocationId: outpostId(o.site),
    factionId: null,
    briefing: `${o.name}’s watch has seen ${plan.ships} raiders coming. Fly there and help its turrets and guards beat them off, or trust its defences to hold without you. ${RAID_FICTION}`,
    objectives: [{ kind: 'outpost', systemId: sys, locationId: outpostId(o.site), window: plan.window, at: plan.at, text: `Defend ${o.name} against ${plan.ships} raiders` }],
    reward: 0,
    repReward: {},
    difficulty: plan.threat,
    difficultyNote: `Threat ${plan.threat}`,
    destinationLocationId: outpostId(o.site),
    contract: { kind: 'bounty' },
  };
  state.contracts[id] = job;
  state.jobs[id] = { status: 'active', objectiveIndex: 0, acceptedAt: state.clock };
}

// ---------------------------------------------------------------- turrets

/** Turrets the outpost can have now: one for each stage built, three at most. */
export const turretCap = (o: OutpostRecord) => Math.min(o.stage, R.turrets.needs.length);

/** What the next turret still needs, good by good (none when no more can be built yet). */
export function turretNeeds(o: OutpostRecord): { commodity: CommodityId; need: number; delivered: number; left: number }[] {
  const d = o.defence;
  const built = d?.turrets ?? 0;
  if (built >= turretCap(o)) return [];
  const needs = R.turrets.needs[built]!;
  return (Object.entries(needs) as [CommodityId, number][]).map(([commodity, need]) => {
    const delivered = Math.min(need, d?.delivered[commodity] ?? 0);
    return { commodity, need, delivered, left: need - delivered };
  });
}

/** Hands over materials from the hold toward the next turret (docked at the outpost); all in, it is built. */
export function deliverForTurret(state: GameState, c: CommodityId, qty: number): { ok: boolean; message: string; built?: boolean } {
  const o = dockedOutpost(state);
  if (!o) return { ok: false, message: 'Dock at your outpost first.' };
  const left = turretNeeds(o).find((x) => x.commodity === c)?.left ?? 0;
  if (!left) return { ok: false, message: turretNeeds(o).length ? `The turret needs no ${goodName(c)}.` : 'No more turrets can be built until the outpost grows.' };
  const n = Math.min(qty, left, cargoCount(state.ship.cargo, c));
  if (n <= 0) return { ok: false, message: `None in your hold.` };
  const d = defenceOf(o);
  removeCargo(state.ship.cargo, c, n);
  d.delivered[c] = (d.delivered[c] ?? 0) + n;
  if (turretNeeds(o).some((x) => x.left > 0)) return { ok: true, message: `Delivered ${n} ${goodName(c)} for the turret.` };
  d.turrets += 1;
  d.delivered = {};
  d.down[d.turrets - 1] = 0;
  return { ok: true, message: `Delivered ${n} ${goodName(c)}. Turret ${d.turrets} is up at ${o.name}.`, built: true };
}

/** Repairs a turret a raid knocked out (docked at the outpost). */
export function repairTurret(state: GameState, index: number): { ok: boolean; message: string } {
  const o = dockedOutpost(state);
  if (!o) return { ok: false, message: 'Dock at your outpost first.' };
  const d = o.defence;
  if (!d || index >= d.turrets || !((d.down[index] ?? 0) > state.clock)) return { ok: false, message: 'That turret is not down.' };
  if (state.credits < R.turrets.repair) return { ok: false, message: `Repairs cost ${R.turrets.repair} cr.` };
  applyCredits(state, -R.turrets.repair, 'repair', `Turret repair at ${o.name}`);
  d.down[index] = 0;
  return { ok: true, message: `Turret ${index + 1} is back up.` };
}

// ---------------------------------------------------------------- guards

export interface GuardOffer {
  id: string;
  name: string;
  model: string;
  skill: 'steady' | 'sharp';
  /** Credits an hour. */
  perHour: number;
}

const WORLD_SEED_GUARDS = 0x9a4d;

/** Pilots looking for guard work this posting (two, the same for every pilot), in the patrol fighters of the outpost's system's owner. */
export function guardOffers(state: GameState, o: OutpostRecord): GuardOffer[] {
  const epoch = boardEpoch(state.clock);
  const r = rng(WORLD_SEED_GUARDS, 'outpost-guard', o.site, epoch);
  const owner = WORLD.profiles.get(outpostSystem(o))?.owner;
  const fleet = owner === 'sta' || owner === 'frontier' ? FLEETS[owner].patrols : FLEETS.sta.patrols;
  return Array.from({ length: R.guards.offers }, (_, i) => {
    const skill: GuardOffer['skill'] = r.next() < 0.35 ? 'sharp' : 'steady';
    return { id: `g.${o.site}.${epoch}.${i}`, name: `${r.pick(WING_FIRST)} ${r.pick(WING_LAST)}`, model: r.pick(fleet), skill, perHour: R.guards.perHour[skill] };
  });
}

/**
 * Where guards can be hired from: the outpost itself, or a full-service dock's Fleet window (one
 * with repairs, a market and a job board). Why not here, or null.
 */
export function guardHireBlock(state: GameState, o: OutpostRecord): string | null {
  const here = state.location.dockedAt;
  if (!here) return 'Dock first.';
  if (o.stage <= 0) return `${o.name} opens first.`;
  if (totalFines(state) >= LAW.hunters.fines) return 'Nobody will guard an outpost for a pilot with a price on their head.';
  const active = (o.defence?.guards ?? []).filter((g) => g.until > state.clock);
  if (active.length >= R.guards.max) return `${o.name} has all the guards it can use (${R.guards.max}).`;
  if (here === outpostId(o.site)) return null;
  const loc = ALL_LOCATIONS.find((l) => l.id === here);
  const full = !!loc && ['market', 'repair', 'contracts'].every((s) => loc.services.includes(s as never));
  return full ? null : 'Hire guards at your outpost, or at a dock with a market, repairs and a job board.';
}

/** Hires a guard for an outpost (by its site) for a term (hours), paid up front: on post there 15 minutes on. */
export function hireGuard(state: GameState, site: string, offerId: string, hours: number): { ok: boolean; message: string } {
  const o = (state.world.outposts ?? []).find((x) => x.site === site);
  if (!o) return { ok: false, message: 'You have no outpost there.' };
  const block = guardHireBlock(state, o);
  if (block) return { ok: false, message: block };
  const offer = guardOffers(state, o).find((x) => x.id === offerId);
  if (!offer) return { ok: false, message: 'That pilot has moved on.' };
  if (!R.guards.terms.includes(hours)) return { ok: false, message: 'Choose a term.' };
  if ((o.defence?.guards ?? []).some((g) => g.id === offerId && g.until > state.clock)) return { ok: false, message: `${offer.name} is guarding ${o.name} already.` };
  const cost = offer.perHour * hours;
  if (state.credits < cost) return { ok: false, message: `${hours} hours cost ${cost} cr.` };
  applyCredits(state, -cost, 'fee', `Guard for ${o.name}: ${offer.name}`);
  const from = state.clock + R.guards.delay;
  const d = defenceOf(o);
  d.guards = d.guards.filter((g) => g.until > state.clock);
  d.guards.push({ id: offer.id, name: offer.name, model: offer.model, skill: offer.skill, from, until: from + hours * HOUR });
  return { ok: true, message: `${offer.name} will guard ${o.name} for ${hours} hours, on post in ${Math.round(R.guards.delay / 60)} minutes.` };
}

// ---------------------------------------------------------------- the News

/** Raids on the player's outposts within news reach, over the last hour (the save the game points at). */
export function outpostRaidNews(systemId: SystemId, clock: number): { text: string; at: number; jumps: number }[] {
  const reach = jumpsFrom(WORLD.links, systemId);
  return activeOutposts().flatMap((o) => {
    if (!o.defence) return [];
    const sys = outpostSystem(o);
    const jumps = reach.get(sys) ?? 99;
    if (jumps > EVENTS.newsJumps) return [];
    return o.defence.raids
      .filter((r) => r.at <= clock && clock - r.at < HOUR)
      .map((r) => ({ at: r.at, jumps, text: fill(pick(RAID_NEWS[r.result], `${o.site}|${r.window}`), { outpost: o.name, system: getSystem(sys).displayName }) }));
  });
}

/** How the outpost stands against raids, in a line (the Fleet window, the Outpost window). */
export function defenceLine(state: GameState, o: OutpostRecord): string {
  if (o.stage <= 0) return '';
  if (security(outpostSystem(o)) >= R.maxSecurity) return 'Secure space: no raids come here.';
  const d = defenceAt(state, o, state.clock);
  const parts = [`${d.turrets} of ${o.defence?.turrets ?? 0} turrets up`, `${d.guards.length} guard${d.guards.length === 1 ? '' : 's'} on post`];
  if (d.wings) parts.push(`${d.wings} patrol wing${d.wings === 1 ? '' : 's'}`);
  return `Defences: ${parts.join(', ')}.`;
}

