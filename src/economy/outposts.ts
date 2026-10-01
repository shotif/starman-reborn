import { applyCredits, type CommodityId, type GameState, type OutpostRecord } from '../app/state.ts';
import { COMMODITIES } from '../content/economy/goods.ts';
import { OUTPOSTS } from '../content/outposts/rules.ts';
import { kindWord, outpostId, outpostNames, outpostSite, sitesIn, type OutpostSite } from '../content/outposts/sites.ts';
import type { StationType } from '../content/world/types.ts';
import { getLocation, getPlanet, getSystem } from '../data/systems.ts';
import { cargoCount, removeCargo } from './cargo.ts';
import type { Result } from './equipment.ts';
import { refreshSaveStations } from './events.ts';
import { dividendFactor } from './fleet.ts';
import { dockAccess } from './law.ts';

/**
 * A station of your own (docs/PROCGEN.md §22; rules in src/content/outposts/rules.ts): the player
 * charters a site in orbit of a confirmed planet, at a station in its system; brings the materials
 * for each stage to it; and once its frame is up it opens, trades and pays an income by the hour,
 * worked out from the game clock with the fleet (settleFleet). The outpost lives in the save's world
 * log (`world.outpost`), and the world finds it by its id (economy/events.ts refreshSaveStations).
 */

const HOUR = 3_600;

const goodName = (c: CommodityId) => COMMODITIES[c].name.toLowerCase();

export function outpostOf(state: GameState): OutpostRecord | undefined {
  return state.world.outpost;
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

/** This hour's income: moved by a raid or sweep in its system, as stakes' dividends are (FLEET.stakes.events). */
export function incomeAt(o: OutpostRecord, clock: number): number {
  return Math.round(baseIncome(o) * dividendFactor(outpostId(o.site), clock).factor);
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
    kinds: site.kinds.map((kind) => ({ kind, names: outpostNames(site.planetId, kind) })),
    price: OUTPOSTS.charter,
    blocked: block,
  }));
}

function charterBlock(state: GameState, here: string): string | null {
  if (state.world.outpost) return `You run an outpost already (at most ${OUTPOSTS.max})`;
  if (dockAccess(state, here) !== 'full') return 'Emergency docking only: no business here';
  if (state.credits < OUTPOSTS.charter) return 'Not enough credits';
  return null;
}

/** Charters a site of this system for an outpost of a kind, with one of the names offered: its frame is to be built. */
export function charterOutpost(state: GameState, planetId: string, kind: StationType, name: string): Result {
  const here = state.location.dockedAt;
  if (!here) return { ok: false, message: 'Dock in the system first.' };
  const offer = charterOffers(state).find((x) => x.site.planetId === planetId);
  if (!offer) return { ok: false, message: 'Charter a site from a station in its own system.' };
  if (offer.blocked) return { ok: false, message: `${offer.blocked}.` };
  const k = offer.kinds.find((x) => x.kind === kind);
  if (!k) return { ok: false, message: `No ${kindWord(kind)} can be built there.` };
  if (!k.names.includes(name)) return { ok: false, message: 'Choose one of the names offered.' };
  state.world.outpost = { site: planetId, kind, name, founded: state.clock, stage: 0, delivered: {}, since: state.clock, earned: 0 };
  applyCredits(state, -OUTPOSTS.charter, 'fleet', `Charter for ${name}`);
  refreshSaveStations();
  const planet = getPlanet(planetId)!.displayName;
  return { ok: true, message: `${name} is chartered in orbit of ${planet}. Bring the materials for its frame there.` };
}

// ---------------------------------------------------------------- building

/** How many of a good the player can hand over here now (docked at their outpost, toward the next stage). */
export function deliverable(state: GameState, c: CommodityId): number {
  const o = state.world.outpost;
  if (!o || state.location.dockedAt !== outpostId(o.site)) return 0;
  const left = stillNeeded(o).find((x) => x.commodity === c)?.left ?? 0;
  return Math.min(left, cargoCount(state.ship.cargo, c));
}

/** Hands over materials from the hold toward the next stage; when all are in, the stage is done. */
export function deliverToOutpost(state: GameState, c: CommodityId, qty: number): Result & { stageDone?: string } {
  const o = state.world.outpost;
  if (!o || state.location.dockedAt !== outpostId(o.site)) return { ok: false, message: 'Dock at your outpost first.' };
  const stage = nextStage(o);
  if (!stage) return { ok: false, message: `${o.name} is complete.` };
  if (!Number.isInteger(qty) || qty <= 0) return { ok: false, message: 'Choose at least one unit.' };
  if (qty > deliverable(state, c)) return { ok: false, message: stage.needs[c] ? 'More than it needs, or than you carry.' : `The ${stage.name.toLowerCase()} needs no ${goodName(c)}.` };
  removeCargo(state.ship.cargo, c, qty);
  o.delivered[c] = (o.delivered[c] ?? 0) + qty;
  if (stillNeeded(o).some((x) => x.left > 0)) return { ok: true, message: `Delivered ${qty} ${goodName(c)} for the ${stage.name.toLowerCase()}.` };
  // The stage is done: the outpost grows (and opens, after its frame).
  const opened = o.stage === 0;
  o.stage += 1;
  o.delivered = {};
  if (opened) o.since = state.clock;
  refreshSaveStations();
  const what = opened ? `${o.name} is open: its market and repairs are working` : `${o.name} is now a ${stage.name.toLowerCase()}`;
  return { ok: true, message: `Delivered ${qty} ${goodName(c)}. ${what}.`, stageDone: stage.id };
}

// ---------------------------------------------------------------- income (with the fleet, economy/fleet.ts settleFleet)

/** When the outpost's next hour of income is due (Infinity while it is being built). */
export function outpostNext(o: OutpostRecord): number {
  return o.stage > 0 ? o.since + HOUR : Infinity;
}

/** Pays one hour of income, at the middle of the hour (what happened in its system then). */
export function payOutpostHour(o: OutpostRecord): number {
  const pay = incomeAt(o, o.since + HOUR / 2);
  o.since += HOUR;
  o.earned += pay;
  return pay;
}

/** Away for very long: the oldest hours are paid at the plain rate, in one sum (how many hours, and the sum). */
export function payOldHours(o: OutpostRecord, now: number): { hours: number; pay: number } {
  if (o.stage <= 0) return { hours: 0, pay: 0 };
  const hours = Math.floor((now - o.since) / HOUR) - OUTPOSTS.maxHoursPerSettle;
  if (hours <= 0) return { hours: 0, pay: 0 };
  const pay = hours * baseIncome(o);
  o.since += hours * HOUR;
  o.earned += pay;
  return { hours, pay };
}

// ---------------------------------------------------------------- what the player sees

/** Where the outpost is: its planet and system. */
export function outpostPlace(o: OutpostRecord): string {
  const site = outpostSite(o.site);
  const planet = getPlanet(o.site)?.displayName ?? o.site;
  return site ? `${planet}, ${getSystem(site.systemId).displayName}` : planet;
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
