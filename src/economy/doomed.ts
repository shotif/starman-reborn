import type { GameState } from '../app/state.ts';
import type { CommodityId } from '../content/economy/goods.ts';
import { DOOMED } from '../content/stellar/doomed.ts';
import { EDGE_COMMS, EDGE_JOBS, EDGE_NEWS, EDGE_SPEAKER, EDGE_WELCOME, type EdgeNewsKind } from '../content/stellar/doomedLines.ts';
import { STELLAR } from '../content/stellar/rules.ts';
import { EVENTS } from '../content/events/rules.ts';
import { jumpsFrom } from '../content/world/network.ts';
import { ALL_LOCATIONS, getLocation, getSystem, SYSTEMS, WORLD } from '../data/systems.ts';
import type { SystemId } from '../data/types.ts';
import { activeEdge } from './events.ts';
import type { ObserveObjective } from './stellar.ts';
import { apparentAt, lyFromPyre, pyreAbsoluteMagnitude } from './pyrePhysics.ts';
import { magnitudeText, skyTimeline } from './stellar.ts';

/**
 * Stellar death II, a doomed star at the edge (docs/PROCGEN.md §26). Pyre is invented: a red
 * supergiant beyond the map's edge, in every system's sky in its direction, that explodes in each
 * save once the player has reached the frontier, its light sweeping across the map a light-year a
 * minute, and leaves a black hole. Everything here is a function of the rules, the bundled real
 * positions, one number in the save's world log (when its warning comes) and the clock.
 */

const PC_LY = 3.261563777;

// Pyre's physics lives on its own (no game state), so scenes can use it as they load.
export { apparentAt, horizonKm, lyFromPyre, PYRE_HOLE_ID, pyreAbsoluteMagnitude, pyrePosition, pyreRadiusSolar, tidalLimitKm } from './pyrePhysics.ts';

// ---------------------------------------------------------------- the timeline

export interface EdgeTimeline {
  /** Pre-supernova neutrinos: the observatory evacuates. */
  warning: number;
  /** The core collapses: the lane closes to arrivals and the observatory closes. */
  collapse: number;
  /** The shock breaks out of the surface: the light leaves Pyre. */
  breakout: number;
  /** The lane opens again, and the remnant station opens. */
  laneOpens: number;
  stationOpens: number;
}

export function edgeTimeline(edge: number): EdgeTimeline {
  const T = DOOMED.timeline;
  const collapse = edge + T.collapseAfterWarning;
  const breakout = collapse + T.breakoutAfterCollapse;
  return { warning: edge, collapse, breakout, laneOpens: breakout + T.laneOpensAfterBreakout, stationOpens: breakout + T.stationOpensAfterBreakout };
}

/** When Pyre's light reaches a system (the moment it leaves, in its own). */
export function lightArrives(systemId: SystemId | 'pyre', edge: number): number {
  const t = edgeTimeline(edge);
  return systemId === DOOMED.star.id ? t.breakout : t.breakout + DOOMED.timeline.secondsPerLy * lyFromPyre(systemId as SystemId);
}

/** When the supernova has faded in a system's sky (to the remnant's glow). */
export function fadedIn(systemId: SystemId | 'pyre', edge: number): number {
  const S = STELLAR.supernova;
  return lightArrives(systemId, edge) + S.rise + S.plateau + S.fade;
}

/**
 * Sets the save's warning once the far stars' story is under way and the player has reached the
 * frontier: an hour after Antares has gone, two hours after the frontier, or half an hour from now
 * for a save already past both. True when it was set now.
 */
export function scheduleEdge(state: GameState): boolean {
  const sky = state.world.sky;
  const frontier = state.milestones['frontier-first'];
  if (!sky || sky.edge !== undefined || frontier === undefined) return false;
  const S = DOOMED.schedule;
  sky.edge = Math.round(Math.max(skyTimeline(sky.from).bhGone + S.afterAntares, frontier + S.afterFrontier, state.clock + S.afterLoad));
  return true;
}

/** Whether the lane to Pyre takes arrivals: closed from the collapse until the debris has thinned. */
export function laneOpen(clock: number, edge: number | null = activeEdge()): boolean {
  if (edge === null) return true;
  const t = edgeTimeline(edge);
  return clock < t.collapse || clock >= t.laneOpens;
}

/** Whether Pyre Observatory takes ships (until the collapse), and whether the remnant station has opened. */
export function observatoryOpen(clock: number, edge: number | null = activeEdge()): boolean {
  return edge === null || clock < edgeTimeline(edge).collapse;
}

export function remnantStationOpen(clock: number, edge: number | null = activeEdge()): boolean {
  return edge !== null && clock >= edgeTimeline(edge).stationOpens;
}

/** Whether a station takes ships at a moment: Pyre's observatory until the collapse, its remnant station once open; any other, always. */
export function pyreStationOpen(locationId: string, clock: number, edge: number | null = activeEdge()): boolean {
  if (locationId === DOOMED.stations.observatory.id) return observatoryOpen(clock, edge);
  if (locationId === DOOMED.stations.remnant.id) return remnantStationOpen(clock, edge);
  return true;
}

/** Why docking at one of Pyre's stations is refused now (evacuated, or not open yet), or null. */
export function pyreDockRefusal(locationId: string, clock: number, edge: number | null = activeEdge()): string | null {
  if (pyreStationOpen(locationId, clock, edge)) return null;
  const name = getLocation(locationId).name;
  return locationId === DOOMED.stations.observatory.id ? `${name} has been evacuated.` : `${name} is not open yet.`;
}

/**
 * Why a jump to Pyre is refused, or null: its lane takes no arrivals from the collapse until the
 * debris has thinned, so neither a jump made then nor one that would arrive then (`hops` lanes on,
 * each taking the jump's time) is let through.
 */
export function laneClosedReason(clock: number, hops: number, edge: number | null = activeEdge()): string | null {
  if (edge === null) return null;
  const name = DOOMED.star.name;
  if (!laneOpen(clock, edge)) return `The lane to ${name} is closed until the debris of its explosion has thinned.`;
  if (!laneOpen(clock + Math.max(1, hops) * EVENTS.jumpSeconds, edge)) return `The lane to ${name} closes before you would arrive: its core is about to collapse.`;
  return null;
}

/** How many lanes a jump from a system to Pyre takes (through its anchor). */
export function hopsToPyre(from: SystemId): number {
  if (from === DOOMED.star.id) return 0;
  return (jumpsFrom(WORLD.links, from).get(DOOMED.star.anchor as SystemId) ?? 0) + 1;
}

/** How things stand at Pyre now, in a line (the star map's card). */
export function pyreStatus(clock: number, edge: number | null = activeEdge()): string {
  const stage = pyreStage(clock, edge);
  const name = DOOMED.star.name;
  if (stage === 'alive') return `${name} burns on, a red supergiant near the end of its life. Its observatory watches it.`;
  if (stage === 'warned') return `${name}’s core is about to collapse: its observatory is evacuating.`;
  if (stage === 'collapsed') return `${name}’s core has collapsed, and the lane is closed. The light of its explosion is minutes away.`;
  if (!laneOpen(clock, edge)) return `${name} has exploded. The lane is closed until the debris has thinned.`;
  return `${name} has exploded: a black hole is all that is left of it.${remnantStationOpen(clock, edge) ? ` ${DOOMED.stations.remnant.name} is open.` : ''}`;
}

/** Where Pyre is in its story: alive (before or after the warning), collapsed (its light not yet out), or gone (a black hole). */
export function pyreStage(clock: number, edge: number | null = activeEdge()): 'alive' | 'warned' | 'collapsed' | 'gone' {
  if (edge === null || clock < edge) return 'alive';
  const t = edgeTimeline(edge);
  return clock < t.collapse ? 'warned' : clock < t.breakout ? 'collapsed' : 'gone';
}

// ---------------------------------------------------------------- its black hole, in flight

/** How brightly the gas falling back into the black hole glows at a moment, 0–1: full when the lane opens, fading as t^−5/3. */
export function fallbackGlow(clock: number, edge: number | null = activeEdge()): number {
  if (edge === null) return 0;
  const since = clock - edgeTimeline(edge).breakout;
  if (since <= 0) return 0;
  return Math.min(1, (DOOMED.timeline.laneOpensAfterBreakout / since) ** DOOMED.blackHole.fallbackDecay);
}

/** Hull lost a second to the black hole's tides at a distance from it (scene units), with the zone drawn this far out: none outside. */
export function tidalStrain(distance: number, zone: number): number {
  if (distance >= zone) return 0;
  return DOOMED.blackHole.hullStrainPerSecond * (zone / Math.max(distance, zone * 0.05)) ** 3;
}

/** The station a ship goes to when it must leave Pyre's system in a hurry: the first open one at its anchor. */
export function pyreRefugeId(): string {
  const refuge = ALL_LOCATIONS.find((l) => l.systemId === DOOMED.star.anchor && l.status === 'functional' && l.dockable !== false && l.stationType !== 'pirate-den');
  if (!refuge) throw new Error(`No refuge station at ${DOOMED.star.anchor}`);
  return refuge.id;
}

/** The last dock a rescued ship is brought back to, unless it is one of Pyre's stations that is shut now: then Pyre's refuge. */
export function rescueDockId(lastDockId: string, clock: number, edge: number | null = activeEdge()): string {
  return pyreStationOpen(lastDockId, clock, edge) ? lastDockId : pyreRefugeId();
}

// ---------------------------------------------------------------- how it looks

export interface PyreLook {
  /** Apparent magnitude. */
  magnitude: number;
  colour: string;
  /** 'alive' until its light arrives, then the supernova, then the remnant. */
  phase: 'alive' | 'supernova' | 'remnant';
}

const lerp = (a: number, b: number, k: number) => a + (b - a) * Math.min(1, Math.max(0, k));

function mixColour(a: string, b: string, k: number): string {
  const p = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const [x, y] = [p(a), p(b)];
  return `#${x.map((v, i) => Math.round(lerp(v, y[i]!, k)).toString(16).padStart(2, '0')).join('')}`;
}

/** How Pyre looks from a real system at a moment: as it lives, then (once its light arrives) the supernova, then its remnant. */
export function pyreLook(systemId: SystemId, clock: number, edge: number | null = activeEdge()): PyreLook {
  const ly = lyFromPyre(systemId);
  const alive: PyreLook = { magnitude: apparentAt(pyreAbsoluteMagnitude(), ly), colour: DOOMED.star.colorHex, phase: 'alive' };
  if (edge === null) return alive;
  const arrive = lightArrives(systemId, edge);
  if (clock < arrive) return alive;
  const S = STELLAR.supernova;
  const peak = apparentAt(S.peakAbsoluteMagnitude, ly);
  const remnant = apparentAt(DOOMED.timeline.remnantAbsoluteMagnitude, ly);
  const t = clock - arrive;
  if (t < S.rise) return { magnitude: lerp(alive.magnitude, peak, t / S.rise), colour: mixColour(DOOMED.star.colorHex, S.peakColour, t / S.rise), phase: 'supernova' };
  if (t < S.rise + S.plateau) return { magnitude: peak + 0.5 * ((t - S.rise) / S.plateau), colour: S.peakColour, phase: 'supernova' };
  if (t < S.rise + S.plateau + S.fade) {
    const k = (t - S.rise - S.plateau) / S.fade;
    return { magnitude: lerp(peak + 0.5, remnant, k), colour: mixColour(S.peakColour, S.remnantColour, k), phase: 'supernova' };
  }
  return { magnitude: remnant, colour: S.remnantColour, phase: 'remnant' };
}

// ---------------------------------------------------------------- what is said

export interface EdgeNews {
  kind: EdgeNewsKind;
  at: number;
  headline: string;
  detail: string;
}

/** Fills a line from the rules and the place it is told (every number comes from the data). */
export function fillEdge(text: string, systemId?: SystemId): string {
  const values: Record<string, string> = {
    star: DOOMED.star.name,
    distance: Math.round(DOOMED.star.distanceLy).toLocaleString('en-GB'),
    brightness: magnitudeText(apparentAt(pyreAbsoluteMagnitude(), DOOMED.star.distanceLy)),
    peak: magnitudeText(apparentAt(STELLAR.supernova.peakAbsoluteMagnitude, DOOMED.star.distanceLy)),
    anchor: getSystem(DOOMED.star.anchor).displayName,
    ozoneNear: Math.round(DOOMED.earth.ozoneNearPc * PC_LY).toLocaleString('en-GB'),
    ozoneFar: Math.round(DOOMED.earth.ozoneFarPc * PC_LY).toLocaleString('en-GB'),
    ...(systemId
      ? {
          system: getSystem(systemId).displayName,
          here: Math.round(lyFromPyre(systemId)).toLocaleString('en-GB'),
          herePeak: magnitudeText(apparentAt(STELLAR.supernova.peakAbsoluteMagnitude, lyFromPyre(systemId))),
        }
      : {}),
  };
  return text.replace(/\{(\w+)\}/g, (_, k: string) => values[k] ?? '');
}

/** The moments of Pyre's story as told in a system, oldest first (at Pyre itself, no light arriving or fading: it is where it left). */
function moments(systemId: SystemId, edge: number): [EdgeNewsKind, number][] {
  const t = edgeTimeline(edge);
  const S = STELLAR.supernova;
  const arrive = lightArrives(systemId, edge);
  const own = systemId === DOOMED.star.id;
  return (
    [
      ['warning', t.warning],
      ['collapse', t.collapse],
      ...(own ? [] : [['light', arrive], ['fading', arrive + S.rise + S.plateau]]),
      ['lane', t.laneOpens],
      ['station', t.stationOpens],
    ] as [EdgeNewsKind, number][]
  ).sort((a, b) => a[1] - b[1]);
}

/** How long the News keeps Pyre's story after its last moment in a system. */
const NEWS_AFTER = 6 * 3_600;

/** Pyre's story in a system's News at a moment, newest first (none before the warning, nor long after it is over). */
export function edgeNews(systemId: SystemId, clock: number, edge: number | null = activeEdge()): EdgeNews[] {
  if (edge === null) return [];
  const all = moments(systemId, edge);
  if (clock - Math.max(...all.map(([, at]) => at)) >= NEWS_AFTER) return [];
  return all
    .filter(([, at]) => at <= clock)
    .map(([kind, at]) => ({ kind, at, headline: fillEdge(EDGE_NEWS[kind].headline, systemId), detail: fillEdge(EDGE_NEWS[kind].detail, systemId) }))
    .reverse();
}

/** The latest moment of Pyre's story reached in a system (for the radio as it comes), or null. */
export function edgeMoment(systemId: SystemId, clock: number, edge: number | null = activeEdge()): EdgeNewsKind | null {
  if (edge === null) return null;
  let last: EdgeNewsKind | null = null;
  for (const [kind, at] of moments(systemId, edge)) if (at <= clock) last = kind;
  return last;
}

/** What one of Pyre's stations says as a ship docks, as the star's story stands; null for any other station. */
export function pyreWelcome(locationId: string, clock: number, edge: number | null = activeEdge()): string | null {
  const isObservatory = locationId === DOOMED.stations.observatory.id;
  if (!isObservatory && locationId !== DOOMED.stations.remnant.id) return null;
  const line = !isObservatory ? EDGE_WELCOME.remnant : pyreStage(clock, edge) === 'alive' ? EDGE_WELCOME.observatory : EDGE_WELCOME.evacuating;
  return `${getLocation(locationId).name}: ${fillEdge(line)}`;
}

/** What the stations say over the radio when a moment comes, if anything. */
export function edgeComm(kind: EdgeNewsKind, systemId: SystemId): { speaker: string; text: string } | null {
  const line = EDGE_COMMS[kind];
  return line ? { speaker: EDGE_SPEAKER, text: fillEdge(line, systemId) } : null;
}

// ---------------------------------------------------------------- markets

/** How Pyre's death moves a good's price at a station (1 without an effect): research stations want data and instruments. */
export function edgePrice(locationId: string, commodity: CommodityId, clock: number, edge: number | null = activeEdge()): number {
  if (edge === null || !DOOMED.market.goods.includes(commodity)) return 1;
  const loc = getLocation(locationId);
  if (loc.stationType !== 'research-station' || !SYSTEMS.some((s) => s.id === loc.systemId)) return 1;
  return clock >= edge && clock < fadedIn(loc.systemId, edge) ? DOOMED.market.price : 1;
}

// ---------------------------------------------------------------- its work

export type PyreJobKind = keyof typeof EDGE_JOBS;

/** One piece of Pyre's work on offer at a station: posted from `posted` until `until`, its observation window `from`–`to`. */
export interface PyreOffer {
  kind: PyreJobKind;
  posted: number;
  until: number;
  /** The observation window (not for the evacuation). */
  from: number;
  to: number;
}

/** When the gas falling into the black hole has faded below the hole job's threshold. */
export function holeReadUntil(edge: number): number {
  const B = edgeTimeline(edge).breakout;
  return B + DOOMED.timeline.laneOpensAfterBreakout * DOOMED.jobs.hole.glowAbove ** (-1 / DOOMED.blackHole.fallbackDecay);
}

/** When Pyre's light has crossed the whole map. */
function lightCrossed(edge: number): number {
  return edgeTimeline(edge).breakout + DOOMED.timeline.secondsPerLy * Math.max(...SYSTEMS.map((s) => lyFromPyre(s.id)));
}

/** Whether a station is near enough Pyre's anchor to post the work that sends pilots to it. */
export function nearPyre(locationId: string): boolean {
  const loc = getLocation(locationId);
  if (loc.systemId === DOOMED.star.id) return true;
  return (jumpsFrom(WORLD.links, DOOMED.star.anchor as SystemId).get(loc.systemId) ?? Infinity) <= DOOMED.jobs.twice.reach;
}

/**
 * Pyre's work a station posts between two moments (docs/PROCGEN.md §26.5): every research station
 * wants its last record; its observatory, its observers carried out; research stations near its
 * anchor, its first light seen twice and its black hole read; its remnant station, the hole read.
 */
export function pyreOffers(locationId: string, start: number, end: number, edge: number | null = activeEdge()): PyreOffer[] {
  if (edge === null) return [];
  const loc = getLocation(locationId);
  const t = edgeTimeline(edge);
  const out: PyreOffer[] = [];
  const add = (o: PyreOffer) => {
    if (o.posted < end && o.until > start) out.push(o);
  };
  const research = loc.stationType === 'research-station' && loc.status === 'functional';
  if (locationId === DOOMED.stations.observatory.id) {
    add({ kind: 'evacuate', posted: t.warning, until: t.collapse, from: t.warning, to: t.collapse });
    return out;
  }
  if (locationId === DOOMED.stations.remnant.id) {
    add({ kind: 'hole', posted: t.stationOpens, until: holeReadUntil(edge), from: t.laneOpens, to: holeReadUntil(edge) });
    return out;
  }
  if (!research || loc.dockable === false) return out;
  add({ kind: 'record', posted: t.warning, until: t.breakout, from: t.warning, to: t.breakout });
  if (nearPyre(locationId)) {
    add({ kind: 'twice', posted: t.warning, until: t.breakout + DOOMED.timeline.secondsPerLy * lyFromPyre(loc.systemId), from: t.breakout, to: lightCrossed(edge) });
    add({ kind: 'hole', posted: t.laneOpens, until: holeReadUntil(edge), from: t.laneOpens, to: holeReadUntil(edge) });
  }
  return out;
}

/** The readings an observation of Pyre's first light counts: within the rules' minutes of its light arriving where it was made. */
function firstLightReadings(o: ObserveObjective, observed: readonly { at: number; systemId: SystemId }[], edge: number): { at: number; systemId: SystemId; ly: number }[] {
  return observed
    .filter((x) => x.systemId !== DOOMED.star.id && x.at >= o.from && x.at <= o.to)
    .filter((x) => {
      const since = x.at - lightArrives(x.systemId, edge);
      return since >= 0 && since <= (o.firstLight ?? 0);
    })
    .map((x) => ({ ...x, ly: lyFromPyre(x.systemId) }));
}

/** How many systems the first light has been seen from so far that count (1 at most until a second one far enough out). */
export function firstLightSeen(o: ObserveObjective, observed: readonly { at: number; systemId: SystemId }[], edge: number | null = activeEdge()): number {
  if (edge === null) return 0;
  const seen = firstLightReadings(o, observed, edge);
  if (!seen.length) return 0;
  return seen.some((a) => seen.some((b) => b.ly - a.ly >= (o.aheadLy ?? 0) && b.systemId !== a.systemId)) ? 2 : 1;
}

/** Fills one of Pyre's job lines. */
export function fillPyreJob(text: string, values: { giver: string; refuge?: string; party?: string }): string {
  const fields: Record<string, string> = {
    star: DOOMED.star.name,
    anchor: getSystem(DOOMED.star.anchor).displayName,
    refuge: values.refuge ?? getLocation(pyreRefugeId()).name,
    party: values.party ?? '',
    giver: values.giver,
    firstLight: String(Math.round(DOOMED.jobs.twice.firstLight / 60)),
    ahead: String(DOOMED.jobs.twice.aheadLy),
  };
  return text.replace(/\{(\w+)\}/g, (_, k: string) => fields[k] ?? '');
}
