import type { GameState, RankRecord } from '../app/state.ts';
import { CONTRACTS } from '../content/contracts/rules.ts';
import { RATINGS } from '../content/progress/rules.ts';
import { PERK_WORDS, RANK_LINES, RANK_NOTES } from '../content/ranks/lines.ts';
import { RANKS, type RankLevel } from '../content/ranks/rules.ts';
import type { ManufacturerId } from '../content/types.ts';
import { jumpsFrom } from '../content/world/network.ts';
import { getLocation, WORLD } from '../data/systems.ts';
import type { FactionId } from '../data/types.ts';
import { occupied } from './border.ts';
import { FACTIONS } from './factions.ts';
import { dockAccess, huntedBy, isLawful } from './law.ts';
import { rating } from './progress.ts';
import { logWrite } from './logbook.ts';

/**
 * Ranks that open doors (docs/PROCGEN.md §32; rules in src/content/ranks/rules.ts): a rank with each
 * lawful faction and with the Hollow Wake, earned by standing and a record in either of two ratings,
 * promoted at the pilot's next dock of theirs; held while standing stays near what earned it; and
 * what each rank opens. The save keeps only each rank given or fallen to; everything else is worked
 * out from it.
 */

export const RANK_FACTIONS: readonly FactionId[] = ['sta', 'frontier', 'hollow-wake'];

const fill = (text: string, values: Record<string, string>) => text.replace(/\{(\w+)\}/g, (_, k: string) => values[k] ?? '');
const percent = (x: number) => `${Math.round(x * 100)}%`;

/** A rank's name (rank 1–3), or null for none. */
export function rankName(f: FactionId, r: number): string | null {
  return r >= 1 && r <= 3 ? RANKS.ladders[f].names[r - 1]! : null;
}

/** The better rating index of the two a faction values. */
export function recordFor(state: GameState, f: FactionId): number {
  const [a, b] = RANKS.ladders[f].record;
  return Math.max(rating(state, a).index, rating(state, b).index);
}

/** The highest rank the pilot's standing and record earn with a faction now. */
export function earnedRank(state: GameState, f: FactionId): RankLevel {
  const L = RANKS.ladders[f];
  const standing = state.reputation[f] ?? 0;
  const record = recordFor(state, f);
  let r = 0;
  for (let i = 0; i < 3; i++) if (standing >= L.standing[i]! && record >= RANKS.record[i]!) r = i + 1;
  return r as RankLevel;
}

/** The highest rank the pilot's standing still holds (within the margin below what earned it); ratings never fall. */
export function keptRank(state: GameState, f: FactionId): RankLevel {
  const L = RANKS.ladders[f];
  const standing = state.reputation[f] ?? 0;
  let r = 0;
  for (let i = 0; i < 3; i++) if (standing >= L.standing[i]! - RANKS.keepMargin) r = i + 1;
  return r as RankLevel;
}

/** The rank held now: the one given, or less if standing has since fallen (the save follows at the next dock). */
export function heldRank(state: GameState, f: FactionId): RankLevel {
  return Math.min(state.ranks?.[f]?.rank ?? 0, keptRank(state, f)) as RankLevel;
}

/** The rank whose perks count now: none while a lawful faction hunts the pilot (the rank is kept). */
export function perkRank(state: GameState, f: FactionId, systemId = state.location.systemId): RankLevel {
  return isLawful(f) && huntedBy(state, f, systemId) ? 0 : heldRank(state, f);
}

/** Where a faction promotes: its own open stations (not one the Wake holds), or, for the Wake, a den that takes the pilot in. */
export function promotesAt(state: GameState, f: FactionId, locationId: string): boolean {
  const loc = getLocation(locationId);
  if (dockAccess(state, locationId) !== 'full') return false;
  if (f === 'hollow-wake') return loc.stationType === 'pirate-den';
  return loc.factionId === f && loc.stationType !== 'pirate-den' && !occupied(locationId, state.clock, state.world.border);
}

/** What a rank opens, in words, everything up to it. */
export function perksOf(f: FactionId, r: number): string[] {
  if (r < 1) return [];
  const P = RANKS.perks;
  const yard = percent(P.yard[Math.min(r, 3) - 1]!);
  const wake = f === 'hollow-wake';
  const out = [wake ? PERK_WORDS.workWake : PERK_WORDS.work, fill(wake ? PERK_WORDS.yardWake : PERK_WORDS.yard, { percent: yard }), PERK_WORDS.news];
  if (!wake && r >= P.coverFrom) out.push(PERK_WORDS.cover);
  if (wake && r >= P.outpost.from) out.push(PERK_WORDS.outpost);
  if (r >= P.extraActive.from) out.push(PERK_WORDS.extra);
  return out;
}

/** What the next rank with a faction needs, with the pilot's own numbers (null at the top). */
export function nextRankNeeds(state: GameState, f: FactionId): { name: string; standing: number; have: number; record: string; met: boolean } | null {
  const held = heldRank(state, f);
  if (held >= 3) return null;
  const r = held as 0 | 1 | 2;
  const L = RANKS.ladders[f];
  const need = RANKS.record[r];
  const [a, b] = L.record;
  const record = `${RATINGS[a].ranks[need]![0]} ${RATINGS[a].label.toLowerCase()} or ${RATINGS[b].ranks[need]![0]} ${RATINGS[b].label.toLowerCase()}`;
  return { name: L.names[r], standing: L.standing[r], have: state.reputation[f] ?? 0, record, met: recordFor(state, f) >= need };
}

// ---------------------------------------------------------------- promotions and falls

export interface RankNote {
  faction: FactionId;
  kind: 'promoted' | 'fell';
  rank: RankLevel;
  from: RankLevel;
  /** The card's title and words (a promotion), or the notice (a fall). */
  title: string;
  text: string;
  perks: string[];
}

/**
 * At a dock (docs/PROCGEN.md §32.2): a rank whose standing has fallen too far falls, at any dock; a
 * rank earned is given at the faction's own dock, straight to the highest earned. Twice at one dock
 * changes nothing.
 */
export function settleRanks(state: GameState, locationId: string): RankNote[] {
  const notes: RankNote[] = [];
  for (const f of RANK_FACTIONS) {
    const saved = (state.ranks?.[f]?.rank ?? 0) as RankLevel;
    const kept = keptRank(state, f);
    const faction = FACTIONS[f].name;
    if (saved > kept) {
      const ranks = (state.ranks ??= {});
      if (kept === 0) delete ranks[f];
      else ranks[f] = { rank: kept as RankRecord['rank'], at: state.clock, where: locationId, fell: true };
      const now = kept ? fill(RANK_NOTES.fellTo, { now: rankName(f, kept)! }) : RANK_NOTES.fellOut;
      notes.push({ faction: f, kind: 'fell', rank: kept, from: saved, title: faction, text: fill(RANK_NOTES.fell, { faction, rank: rankName(f, saved)!, now }), perks: [] });
      continue;
    }
    if (!promotesAt(state, f, locationId)) continue;
    const earned = earnedRank(state, f);
    if (earned <= saved) continue;
    (state.ranks ??= {})[f] = { rank: earned as RankRecord['rank'], at: state.clock, where: locationId };
    logWrite(state, { kind: 'rank', id: f, x: earned, where: locationId });
    const rank = rankName(f, earned)!;
    notes.push({ faction: f, kind: 'promoted', rank: earned, from: saved, title: fill(RANK_NOTES.title, { rank, faction }), text: fill(RANK_LINES[f].ceremony, { rank }), perks: perksOf(f, earned) });
  }
  return notes;
}

// ---------------------------------------------------------------- what ranks open

/**
 * The share off ships and equipment at a station's yard: a lawful rank at that faction's own open
 * station; a Wake rank on Wake Salvage's own gear and hulls at a free port or a den. The better of
 * the two where both apply.
 */
export function yardDiscount(state: GameState, locationId: string, maker: ManufacturerId): number {
  const loc = getLocation(locationId);
  const Y = RANKS.perks.yard;
  let d = 0;
  const f = loc.factionId;
  if (isLawful(f) && loc.stationType !== 'pirate-den' && dockAccess(state, locationId) === 'full' && !occupied(locationId, state.clock, state.world.border)) {
    const r = perkRank(state, f, loc.systemId);
    if (r) d = Y[r - 1]!;
  }
  if (maker === 'wake' && (loc.stationType === 'freeport' || loc.stationType === 'pirate-den')) {
    const r = heldRank(state, 'hollow-wake');
    if (r) d = Math.max(d, Y[r - 1]!);
  }
  return d;
}

/** A price after a discount, to the credit. */
export const discounted = (price: number, d: number) => Math.round(price * (1 - d));

/** What the shipyard and outfitter say of a rank's discount here, if any. */
export function yardNote(state: GameState, locationId: string): string | null {
  const loc = getLocation(locationId);
  const f = loc.factionId;
  const lawful = isLawful(f) ? yardDiscount(state, locationId, 'halden') : 0;
  if (lawful && isLawful(f)) return fill(RANK_NOTES.yard, { rank: rankName(f, perkRank(state, f, loc.systemId))!, faction: FACTIONS[f].name, percent: percent(lawful) });
  const wake = yardDiscount(state, locationId, 'wake');
  if (wake) return fill(RANK_NOTES.yardWake, { rank: rankName('hollow-wake', heldRank(state, 'hollow-wake'))!, percent: percent(wake) });
  return null;
}

/** A lawful station clears this pilot in under fire (their rank with its owner, not hunted, the station theirs). */
export function coveredAt(state: GameState, locationId: string): boolean {
  const loc = getLocation(locationId);
  const f = loc.factionId;
  if (!isLawful(f) || loc.stationType === 'pirate-den' || dockAccess(state, locationId) !== 'full' || occupied(locationId, state.clock, state.world.border)) return false;
  return perkRank(state, f, loc.systemId) >= RANKS.perks.coverFrom;
}

/** What traffic control says as it clears a ranked pilot in under fire. */
export function coverLine(state: GameState, locationId: string): { speaker: string; text: string } | null {
  const loc = getLocation(locationId);
  const f = loc.factionId;
  if (!isLawful(f) || !coveredAt(state, locationId)) return null;
  return { speaker: `${loc.name} traffic`, text: fill(RANK_LINES[f].cover, { station: loc.name, rank: rankName(f, perkRank(state, f, loc.systemId))! }) };
}

/** Contracts in progress at once: one more for a pilot at the top rank with any faction. */
export function activeLimit(state: GameState): number {
  const top = RANK_FACTIONS.some((f) => heldRank(state, f) >= RANKS.perks.extraActive.from);
  return CONTRACTS.maxActive + (top ? RANKS.perks.extraActive.slots : 0);
}

/** How much less often raids come for the pilot's outpost (a Wake rank). */
export function outpostOdds(state: GameState): number {
  return heldRank(state, 'hollow-wake') >= RANKS.perks.outpost.from ? RANKS.perks.outpost.odds : 1;
}

/** Why the pilot cannot take a commission (its rank), or null. */
export function rankLock(state: GameState, need: { faction: FactionId; rank: number } | undefined): string | null {
  if (!need || heldRank(state, need.faction) >= need.rank) return null;
  return fill(RANK_NOTES.locked, { rank: rankName(need.faction, need.rank) ?? '', faction: FACTIONS[need.faction].name });
}

/** The greeting at a dock for a ranked pilot: their rank with the station's owner (or the Wake, at a den). */
export function rankGreeting(state: GameState, locationId: string): string | null {
  const loc = getLocation(locationId);
  const f: FactionId | null = loc.stationType === 'pirate-den' ? 'hollow-wake' : isLawful(loc.factionId) ? loc.factionId : null;
  if (!f) return null;
  const r = f === 'hollow-wake' ? heldRank(state, f) : perkRank(state, f, loc.systemId);
  return r ? fill(RANK_LINES[f].greet, { rank: rankName(f, r)! }) : null;
}

/** The rank the deck names: the station owner's (or the Wake's at a den). */
export function rankHere(state: GameState, locationId: string): string | null {
  const loc = getLocation(locationId);
  const f: FactionId | null = loc.stationType === 'pirate-den' ? 'hollow-wake' : isLawful(loc.factionId) ? loc.factionId : null;
  return f ? rankName(f, heldRank(state, f)) : null;
}

// ---------------------------------------------------------------- the News

export interface RankNews {
  faction: FactionId;
  rank: string;
  headline: string;
  text: string;
  at: number;
}

/**
 * Promotions told in the News (docs/PROCGEN.md §32.5): for two hours, at stations within two jumps
 * of where they were given; the Wake's only at dens and free ports. Falls go untold.
 */
export function rankNews(state: GameState, locationId: string): RankNews[] {
  const here = getLocation(locationId);
  const N = RANKS.news;
  const out: RankNews[] = [];
  for (const f of RANK_FACTIONS) {
    const rec = state.ranks?.[f];
    if (!rec || rec.fell || state.clock - rec.at > N.seconds || state.clock < rec.at) continue;
    if (f === 'hollow-wake' && here.stationType !== 'pirate-den' && here.stationType !== 'freeport') continue;
    const from = getLocation(rec.where).systemId;
    if ((jumpsFrom(WORLD.links, from).get(here.systemId) ?? 99) > N.jumps) continue;
    const rank = rankName(f, rec.rank)!;
    out.push({ faction: f, rank, headline: fill(RANK_LINES[f].headline, { rank }), text: fill(RANK_LINES[f].news, { rank }), at: rec.at });
  }
  return out;
}
