import { racingScore } from './racing.ts';
import { applyCredits, type GameState } from '../app/state.ts';
import { CODEX_GRANT, MILESTONES, RATINGS, SURVEY_SALE, type MilestoneId, type RatingKind } from '../content/progress/rules.ts';
import { ARC_JOBS } from '../content/story/arcs.ts';
import type { ArcId } from '../content/story/types.ts';
import { getComponent, getLocation, getSystem, isFrontier, SOLAR_BODIES, SYSTEMS } from '../data/systems.ts';
import type { SystemId } from '../data/types.ts';
import { standingTier } from './factions.ts';
import { wakeFriendly } from './law.ts';

/**
 * Progress (docs/PROCGEN.md §13): pilot ratings from the career record, the codex of the real sky
 * (every catalogued star and confirmed planet, filled in as the player scans them), survey sales to
 * research stations, and milestones.
 */

// ---------------------------------------------------------------- the codex

export interface CodexEntry {
  id: string;
  systemId: SystemId;
  kind: 'star' | 'planet' | 'moon';
  name: string;
}

let entries: CodexEntry[] | null = null;

/** Every catalogued star and confirmed planet of the neighbourhood, and the Solar System's own planets and Moon (real data only). */
export function codexEntries(): readonly CodexEntry[] {
  entries ??= SYSTEMS.flatMap((s) => [
    ...s.componentIds.map((id) => ({ id, systemId: s.id, kind: 'star' as const, name: getComponent(id)?.name ?? id })),
    ...s.confirmedBodies.map((p) => ({ id: p.id, systemId: s.id, kind: 'planet' as const, name: p.displayName })),
    ...(s.id === 'sol'
      ? SOLAR_BODIES.filter((b) => b.kind !== 'star').map((b) => ({ id: b.id, systemId: s.id, kind: b.kind === 'moon' ? ('moon' as const) : ('planet' as const), name: b.name }))
      : []),
  ]);
  return entries;
}

const entryIds = () => new Set(codexEntries().map((e) => e.id));

/** Records a scan in the codex; true the first time. Bodies outside the catalogue are ignored. */
export function catalogue(state: GameState, bodyId: string): boolean {
  if (state.codex.includes(bodyId) || !entryIds().has(bodyId)) return false;
  state.codex.push(bodyId);
  return true;
}

export function codexProgress(state: GameState): { done: number; total: number } {
  const ids = entryIds();
  return { done: state.codex.filter((id) => ids.has(id)).length, total: ids.size };
}

/** Every catalogued body of a system has been scanned. */
export function systemSurveyed(state: GameState, systemId: SystemId): boolean {
  const here = codexEntries().filter((e) => e.systemId === systemId);
  return here.length > 0 && here.every((e) => state.codex.includes(e.id));
}

export function surveyValue(systemId: SystemId): number {
  const bodies = codexEntries().filter((e) => e.systemId === systemId).length;
  return Math.max(SURVEY_SALE.min, bodies * SURVEY_SALE.perBody);
}

/** Research stations (and the hand-made research outposts) buy completed surveys. */
export function buysSurveys(locationId: string): boolean {
  const loc = getLocation(locationId);
  return loc.stationType === 'research-station' || locationId === 'meridian-outpost' || locationId === 'sirius-platform';
}

/** Completed surveys not yet sold. */
export function surveysForSale(state: GameState): SystemId[] {
  return SYSTEMS.filter((s) => systemSurveyed(state, s.id) && !state.surveysSold.includes(s.id)).map((s) => s.id);
}

export function sellSurvey(state: GameState, systemId: SystemId, locationId: string): { ok: boolean; message: string } {
  if (!buysSurveys(locationId)) return { ok: false, message: 'This station does not buy survey data.' };
  if (!surveysForSale(state).includes(systemId)) return { ok: false, message: 'No completed survey of that system to sell.' };
  const value = surveyValue(systemId);
  state.surveysSold.push(systemId);
  applyCredits(state, value, 'reward', `Survey of ${getSystem(systemId).displayName}`);
  state.stats.rewards += value;
  return { ok: true, message: `Sold the survey of ${getSystem(systemId).displayName}: +${value} cr.` };
}

// ---------------------------------------------------------------- ratings

export function ratingScore(state: GameState, kind: RatingKind): number {
  if (kind === 'combat') return state.stats.kills;
  if (kind === 'trade') return Math.round(state.stats.rewards + state.stats.sales / 4);
  if (kind === 'racing') return racingScore(state);
  return state.visitedSystems.length * 3 + codexProgress(state).done;
}

export interface Rating {
  kind: RatingKind;
  rank: string;
  index: number;
  score: number;
  next: { rank: string; at: number } | null;
}

export function rating(state: GameState, kind: RatingKind): Rating {
  const ranks = RATINGS[kind].ranks;
  const score = ratingScore(state, kind);
  let index = 0;
  for (let i = 0; i < ranks.length; i++) if (score >= ranks[i]![1]) index = i;
  const next = ranks[index + 1];
  return { kind, rank: ranks[index]![0], index, score, next: next ? { rank: next[0], at: next[1] } : null };
}

// ---------------------------------------------------------------- milestones

function earned(state: GameState, id: MilestoneId): boolean {
  const tier = Number(state.ship.model.split('.')[2] ?? 1);
  const codex = codexProgress(state);
  switch (id) {
    case 'first-contract':
      return state.stats.deliveries >= 1;
    case 'contracts-25':
      return state.stats.deliveries >= 25;
    case 'credits-10k':
      return state.credits >= 10_000;
    case 'credits-50k':
      return state.credits >= 50_000;
    case 'ship-mk2':
      return tier >= 2;
    case 'ship-mk3':
      return tier >= 3;
    case 'systems-10':
      return state.visitedSystems.length >= 10;
    case 'systems-all':
      return SYSTEMS.every((s) => state.visitedSystems.includes(s.id));
    case 'frontier-first':
      return state.visitedSystems.some(isFrontier);
    case 'frontier-25':
      return state.visitedSystems.filter(isFrontier).length >= 25;
    case 'planets-10':
      return codexEntries().filter((e) => e.kind === 'planet' && state.codex.includes(e.id)).length >= 10;
    case 'codex-half':
      return codex.done * 2 >= codex.total;
    case 'codex-all':
      return codex.done >= codex.total;
    case 'kills-10':
      return state.stats.kills >= 10;
    case 'kills-50':
      return state.stats.kills >= 50;
    case 'friend-sta':
      return standingTier(state.reputation.sta ?? 0) === 'friendly' || standingTier(state.reputation.sta ?? 0) === 'trusted';
    case 'friend-frontier':
      return standingTier(state.reputation.frontier ?? 0) === 'friendly' || standingTier(state.reputation.frontier ?? 0) === 'trusted';
    case 'friend-wake':
      return wakeFriendly(state);
    case 'rank-top':
      return (Object.keys(RATINGS) as RatingKind[]).some((k) => rating(state, k).next === null);
    case 'story-sta':
      return finaleDone(state, 'sta');
    case 'story-frontier':
      return finaleDone(state, 'frontier');
    case 'story-wake':
      return finaleDone(state, 'wake');
    case 'story-border':
      return finaleDone(state, 'border');
    case 'story-harvest':
      return finaleDone(state, 'harvest');
    case 'race-won':
      return Object.values(state.world.racing?.courses ?? {}).some((c) => c.wins > 0);
    case 'course-record':
      return Object.values(state.world.racing?.courses ?? {}).some((c) => c.record !== undefined);
  }
}

/** An arc's finale flown to the end. */
function finaleDone(state: GameState, arc: ArcId): boolean {
  return ARC_JOBS.some((j) => j.story?.arc === arc && j.story.finale && state.jobs[j.id]?.status === 'complete');
}

/**
 * Newly earned milestones (recorded with the clock). Cataloguing the whole sky also pays the
 * Frontier Cooperative's grant.
 */
export function checkMilestones(state: GameState): { id: MilestoneId; title: string }[] {
  const out: { id: MilestoneId; title: string }[] = [];
  for (const m of MILESTONES) {
    if (state.milestones[m.id] !== undefined || !earned(state, m.id)) continue;
    state.milestones[m.id] = state.clock;
    if (m.id === 'codex-all') applyCredits(state, CODEX_GRANT, 'reward', 'Frontier Cooperative grant: the whole sky catalogued');
    out.push(m);
  }
  return out;
}
