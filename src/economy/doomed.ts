import type { GameState } from '../app/state.ts';
import type { CommodityId } from '../content/economy/goods.ts';
import { DOOMED } from '../content/stellar/doomed.ts';
import { EDGE_COMMS, EDGE_NEWS, EDGE_SPEAKER, type EdgeNewsKind } from '../content/stellar/doomedLines.ts';
import { STELLAR } from '../content/stellar/rules.ts';
import { equatorialToCartesian } from '../data/coords.ts';
import { getLocation, getSystem, SYSTEMS } from '../data/systems.ts';
import type { SystemId, Vec3Tuple } from '../data/types.ts';
import { activeEdge } from './events.ts';
import { magnitudeText, skyTimeline } from './stellar.ts';

/**
 * Stellar death II, a doomed star at the edge (docs/PROCGEN.md §26). Pyre is invented: a red
 * supergiant beyond the map's edge, in every system's sky in its direction, that explodes in each
 * save once the player has reached the frontier, its light sweeping across the map a light-year a
 * minute, and leaves a black hole. Everything here is a function of the rules, the bundled real
 * positions, one number in the save's world log (when its warning comes) and the clock.
 */

const PC_LY = 3.261563777;
const SUN_TEMPERATURE_K = 5_772;
const SUN_BOLOMETRIC = 4.74;
/** The Sun's mass parameter GM (m³/s²) and the speed of light (m/s). */
const GM_SUN = 1.327_124_400_18e20;
const C = 299_792_458;
const G0 = 9.806_65;

/** Pyre's invented place in the map's frame, light-years from the Sun. */
export function pyrePosition(): Vec3Tuple {
  return equatorialToCartesian(DOOMED.star.raDegrees, DOOMED.star.decDegrees, DOOMED.star.distanceLy) as Vec3Tuple;
}

/** Light-years from Pyre to a real system. */
export function lyFromPyre(systemId: SystemId): number {
  const p = pyrePosition();
  const q = getSystem(systemId).positionLy;
  return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
}

/** Pyre's absolute visual magnitude, from its luminosity and bolometric correction. */
export function pyreAbsoluteMagnitude(): number {
  return SUN_BOLOMETRIC - 2.5 * DOOMED.star.logLuminosity - DOOMED.star.bolometricCorrectionV;
}

/** Pyre's radius in solar radii, from its luminosity and temperature (L ∝ R²T⁴). */
export function pyreRadiusSolar(): number {
  return Math.sqrt(10 ** DOOMED.star.logLuminosity) * (SUN_TEMPERATURE_K / DOOMED.star.temperatureK) ** 2;
}

/** An absolute magnitude seen from this many light-years away. */
export const apparentAt = (absolute: number, ly: number): number => absolute + 5 * Math.log10(ly / PC_LY / 10);

/** The black hole's Schwarzschild radius, km. */
export function horizonKm(): number {
  return (2 * GM_SUN * DOOMED.blackHole.massSolar) / C ** 2 / 1_000;
}

/** How close a ship of the rules' length can come before the black hole's tides pull it apart at the rules' limit, km. */
export function tidalLimitKm(): number {
  const T = DOOMED.blackHole.tides;
  return Math.cbrt((2 * GM_SUN * DOOMED.blackHole.massSolar * T.shipLengthM) / (T.limitG * G0)) / 1_000;
}

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

/** Where Pyre is in its story: alive (before or after the warning), collapsed (its light not yet out), or gone (a black hole). */
export function pyreStage(clock: number, edge: number | null = activeEdge()): 'alive' | 'warned' | 'collapsed' | 'gone' {
  if (edge === null || clock < edge) return 'alive';
  const t = edgeTimeline(edge);
  return clock < t.collapse ? 'warned' : clock < t.breakout ? 'collapsed' : 'gone';
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

/** The moments of Pyre's story as told in a system, oldest first. */
function moments(systemId: SystemId, edge: number): [EdgeNewsKind, number][] {
  const t = edgeTimeline(edge);
  const S = STELLAR.supernova;
  const arrive = lightArrives(systemId, edge);
  return (
    [
      ['warning', t.warning],
      ['collapse', t.collapse],
      ['light', arrive],
      ['fading', arrive + S.rise + S.plateau],
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
