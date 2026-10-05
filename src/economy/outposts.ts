import { applyCredits, type CommodityId, type GameState, type OutpostRecord } from '../app/state.ts';
import { COMMODITIES } from '../content/economy/goods.ts';
import { FLEET } from '../content/fleet/rules.ts';
import { OUTPOSTS } from '../content/outposts/rules.ts';
import { kindWord, outpostId, outpostNames, outpostSite, sitePlace, sitesIn, type OutpostSite } from '../content/outposts/sites.ts';
import type { StationType } from '../content/world/types.ts';
import { getLocation, getSystem } from '../data/systems.ts';
import type { SystemId } from '../data/types.ts';
import { cargoCount, removeCargo } from './cargo.ts';
import type { Result } from './equipment.ts';
import { refreshSaveStations, stationEventAt, systemEventAt } from './events.ts';
import { ensureFolk, folkFactor } from './folk.ts';
import { dockFees } from './hauls.ts';
import { dockAccess } from './law.ts';
import { hurtFactor, upkeep } from './outpostRaids.ts';

/**
 * Stations of your own (docs/PROCGEN.md §22, §36; rules in src/content/outposts/rules.ts): the
 * player charters a site in orbit of a confirmed planet or in a cited belt, at a station in its
 * system; brings the materials for each stage to it; and once its frame is up it opens, trades and
 * pays an income by the hour, worked out from the game clock with the fleet (settleFleet). Up to
 * three, at most one in a system. The outposts live in the save's world log (`world.outposts`), and
 * the world finds them by their ids (economy/events.ts refreshSaveStations).
 */

const HOUR = 3_600;

const goodName = (c: CommodityId) => COMMODITIES[c].name.toLowerCase();

/** The player's outposts, in the order they were chartered. */
export function outpostsOf(state: GameState): readonly OutpostRecord[] {
  return state.world.outposts ?? [];
}

/** The player's outpost whose station this is, if any. */
export function outpostAt(state: GameState, locationId: string | null | undefined): OutpostRecord | undefined {
  return locationId ? outpostsOf(state).find((o) => outpostId(o.site) === locationId) : undefined;
}

/** The player's outpost in a system, if any (at most one, §36.2). */
export function outpostIn(state: GameState, systemId: SystemId): OutpostRecord | undefined {
  return outpostsOf(state).find((o) => outpostSite(o.site)?.systemId === systemId);
}

/** The stage being built next (null when all are done). */
export function nextStage(o: OutpostRecord): (typeof OUTPOSTS.stages)[number] | null {
  return OUTPOSTS.stages[o.stage] ?? null;
}

/** Whether the outpost is open (its frame is up). */
export const isOpen = (o: OutpostRecord): boolean => o.stage > 0;

/** What the next stage still needs, good by good. */
export function stillNeeded(o: OutpostRecord): { commodity: CommodityId; need: number; delivered: number; left: number }[] {
  const stage = nextStage(o);
  if (!stage) return [];
  return (Object.entries(stage.needs) as [CommodityId, number][]).map(([commodity, need]) => {
    const delivered = Math.min(need, o.delivered[commodity] ?? 0);
    return { commodity, need, delivered, left: need - delivered };
  });
}

/** The income an hour, by the stages done (before what happens in its system). */
export function baseIncome(o: OutpostRecord): number {
  return o.stage > 0 ? OUTPOSTS.stages[Math.min(o.stage, OUTPOSTS.stages.length) - 1]!.income : 0;
}

/**
 * This hour's income: moved by a raid or sweep in its system, as stakes' dividends are
 * (FLEET.stakes.events), and by an event of its own under way by its own rules (`news.income`,
 * docs/PROCGEN.md §39.2), cut while a raid it lost still hurts, moved by its people's spirit and
 * what their asks done have made (§41.3), less its turrets' upkeep (§29).
 */
export function incomeAt(o: OutpostRecord, clock: number): number {
  if (o.stage <= 0) return 0;
  const site = outpostSite(o.site);
  const system = site ? systemEventAt(site.systemId, clock) : null;
  const sys = system ? FLEET.stakes.events[system.kind] : 1;
  return Math.max(0, Math.round(baseIncome(o) * sys * newsFactor(o, clock) * hurtFactor(o, clock) * folkFactor(o, clock)) - upkeep(o));
}

/** What an event under way at the outpost does to its income (1 without one, docs/PROCGEN.md §39). */
export function newsFactor(o: OutpostRecord, clock: number): number {
  const e = o.stage > 0 ? stationEventAt(outpostId(o.site), clock) : null;
  return e ? OUTPOSTS.news.income[e.kind as keyof typeof OUTPOSTS.news.income] : 1;
}

// ---------------------------------------------------------------- the charter

export interface CharterOffer {
  site: OutpostSite;
  /** The kinds it can be, and the names offered for each. */
  kinds: { kind: StationType; names: string[] }[];
  price: number;
  /** Why it cannot be chartered now (null: it can). */
  blocked: string | null;
}

/** The sites the player can charter from the station they are docked at: those of its system. */
export function charterOffers(state: GameState): CharterOffer[] {
  const here = state.location.dockedAt;
  if (!here) return [];
  const block = charterBlock(state, here);
  return sitesIn(getLocation(here).systemId).map((site) => ({
    site,
    kinds: site.kinds.map((kind) => ({ kind, names: outpostNames(site.id, kind) })),
    price: OUTPOSTS.charter,
    blocked: block,
  }));
}

function charterBlock(state: GameState, here: string): string | null {
  const own = outpostsOf(state);
  if (own.length >= OUTPOSTS.max) return `You run ${OUTPOSTS.max} outposts already, as many as a pilot can`;
  const there = outpostIn(state, getLocation(here).systemId);
  if (there) return `${there.name} is yours in this system already: one outpost to a system`;
  if (dockAccess(state, here) !== 'full') return 'Emergency docking only: no business here';
  if (state.credits < OUTPOSTS.charter) return 'Not enough credits';
  return null;
}

/** Charters a site of this system for an outpost of a kind, with one of the names offered: its frame is to be built. */
export function charterOutpost(state: GameState, siteId: string, kind: StationType, name: string): Result {
  const here = state.location.dockedAt;
  if (!here) return { ok: false, message: 'Dock in the system first.' };
  const offer = charterOffers(state).find((x) => x.site.id === siteId);
  if (!offer) return { ok: false, message: 'Charter a site from a station in its own system.' };
  if (offer.blocked) return { ok: false, message: `${offer.blocked}.` };
  const k = offer.kinds.find((x) => x.kind === kind);
  if (!k) return { ok: false, message: `No ${kindWord(kind)} can be built there.` };
  if (!k.names.includes(name)) return { ok: false, message: 'Choose one of the names offered.' };
  (state.world.outposts ??= []).push({ site: siteId, kind, name, founded: state.clock, stage: 0, delivered: {}, since: state.clock, earned: 0, heard: state.clock });
  applyCredits(state, -OUTPOSTS.charter, 'fleet', `Charter for ${name}`);
  refreshSaveStations();
  return { ok: true, message: `${name} is chartered ${siteWhere(offer.site)}. Bring the materials for its frame there.` };
}

// ---------------------------------------------------------------- building

/** How many of a good the player can hand over here now (docked at their outpost, toward the next stage). */
export function deliverable(state: GameState, c: CommodityId): number {
  const o = outpostAt(state, state.location.dockedAt);
  if (!o) return 0;
  const left = stillNeeded(o).find((x) => x.commodity === c)?.left ?? 0;
  return Math.min(left, cargoCount(state.ship.cargo, c));
}

/** Hands over materials from the hold toward the next stage; when all are in, the stage is done. */
export function deliverToOutpost(state: GameState, c: CommodityId, qty: number): Result & { stageDone?: string } {
  const o = outpostAt(state, state.location.dockedAt);
  if (!o) return { ok: false, message: 'Dock at your outpost first.' };
  const stage = nextStage(o);
  if (!stage) return { ok: false, message: `${o.name} is complete.` };
  if (!Number.isInteger(qty) || qty <= 0) return { ok: false, message: 'Choose at least one unit.' };
  if (qty > deliverable(state, c)) return { ok: false, message: stage.needs[c] ? 'More than it needs, or than you carry.' : `The ${stage.name.toLowerCase()} needs no ${goodName(c)}.` };
  removeCargo(state.ship.cargo, c, qty);
  const done = handOver(o, c, qty, state.clock);
  if (!done) return { ok: true, message: `Delivered ${qty} ${goodName(c)} for the ${stage.name.toLowerCase()}.` };
  return { ok: true, message: `Delivered ${qty} ${goodName(c)}. ${stageLine(o)}.`, stageDone: done };
}

/**
 * Takes materials toward the next stage (the player's, or a supply captain's, docs/PROCGEN.md
 * §37.1), no more than it still needs; when all are in, the stage is done: the outpost grows (and
 * opens, after its frame). Returns the stage done, if one was.
 */
export function handOver(o: OutpostRecord, c: CommodityId, qty: number, clock: number): string | undefined {
  const stage = nextStage(o);
  const left = stillNeeded(o).find((x) => x.commodity === c)?.left ?? 0;
  const n = Math.min(qty, left);
  if (!stage || n <= 0) return undefined;
  o.delivered[c] = (o.delivered[c] ?? 0) + n;
  if (stillNeeded(o).some((x) => x.left > 0)) return undefined;
  const opened = o.stage === 0;
  o.stage += 1;
  o.delivered = {};
  if (opened) {
    o.since = clock;
    o.opened = clock;
    // Its people come (docs/PROCGEN.md §41.1).
    ensureFolk(o, clock);
  }
  refreshSaveStations();
  return stage.id;
}

/** What a stage just done made of the outpost, in words. */
export function stageLine(o: OutpostRecord): string {
  const now = OUTPOSTS.stages[o.stage - 1]!;
  return o.stage === 1 ? `${o.name} is open: its market and repairs are working` : `${o.name} is now a ${now.name.toLowerCase()}`;
}

// ---------------------------------------------------------------- income (with the fleet, economy/fleet.ts settleFleet)

/** When the outpost's next hour of income is due (Infinity while it is being built). */
export function outpostNext(o: OutpostRecord): number {
  return o.stage > 0 ? o.since + HOUR : Infinity;
}

/**
 * Pays one hour of income, at the middle of the hour (what happened in its system then), with the
 * dock fees of the haulers that hour (docs/PROCGEN.md §38.2) when it is within `trade.feeHours` of now.
 */
export function payOutpostHour(o: OutpostRecord, now: number): number {
  const fees = now - o.since <= OUTPOSTS.trade.feeHours * HOUR ? dockFees(outpostId(o.site), o.since, o.since + HOUR) : 0;
  const pay = incomeAt(o, o.since + HOUR / 2) + fees;
  o.since += HOUR;
  o.earned += pay;
  if (fees > 0) o.fees = (o.fees ?? 0) + fees;
  return pay;
}

/** Away for very long: the oldest hours are paid at the plain rate, in one sum (how many hours, and the sum). */
export function payOldHours(o: OutpostRecord, now: number): { hours: number; pay: number } {
  if (o.stage <= 0) return { hours: 0, pay: 0 };
  const hours = Math.floor((now - o.since) / HOUR) - OUTPOSTS.maxHoursPerSettle;
  if (hours <= 0) return { hours: 0, pay: 0 };
  const pay = hours * Math.max(0, baseIncome(o) - upkeep(o));
  o.since += hours * HOUR;
  o.earned += pay;
  return { hours, pay };
}

// ---------------------------------------------------------------- what the player sees

/** Where the outpost is: its planet or belt, and its system. */
export function outpostPlace(o: OutpostRecord): string {
  const site = outpostSite(o.site);
  return site ? `${sitePlace(site)}, ${getSystem(site.systemId).displayName}` : o.site;
}

/** Where the outpost is, as a sentence ends: "in orbit of Kepler-1 b, Kepler-1", "in the Kuiper Belt, Sol". */
export function outpostWhere(o: OutpostRecord): string {
  const site = outpostSite(o.site);
  return site ? `${siteWhere(site)}, ${getSystem(site.systemId).displayName}` : o.site;
}

/** Where a site is, as a sentence ends: "in orbit of Kepler-1 b", "in the Kuiper Belt". */
export function siteWhere(site: OutpostSite): string {
  return site.planetId ? `in orbit of ${sitePlace(site)}` : `in the ${sitePlace(site)}`;
}

/** One line on how it stands: being built (what is still needed), or open (its stage and income). */
export function outpostStatus(state: GameState, o: OutpostRecord): string {
  const stage = nextStage(o);
  const needs = stillNeeded(o).filter((x) => x.left > 0).map((x) => `${x.left} ${goodName(x.commodity)}`).join(', ');
  if (!isOpen(o)) return `Its frame is going up: it still needs ${needs}.`;
  const income = `${incomeAt(o, state.clock).toLocaleString('en-US')} cr an hour`;
  const now = OUTPOSTS.stages[o.stage - 1]!.name.toLowerCase();
  return stage ? `Open, a ${now}: ${income}. The ${stage.name.toLowerCase()} needs ${needs}.` : `Open, a ${now}, complete: ${income}.`;
}
