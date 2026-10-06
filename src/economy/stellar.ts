import type { GameState } from '../app/state.ts';
import { OBSERVE_LINES, SKY_COMMS, SKY_NEWS, SKY_SPEAKER, type SkyNewsKind } from '../content/stellar/lines.ts';
import { STELLAR } from '../content/stellar/rules.ts';
import { FAR_STARS, getLocation, getSystem } from '../data/systems.ts';
import type { CommodityId } from '../content/economy/goods.ts';
import type { FarStar, SystemId } from '../data/types.ts';
import { activeSkyFrom } from './events.ts';

/**
 * Stellar death, as fiction (docs/PROCGEN.md §25). Betelgeuse and Antares are real stars far
 * beyond the map, in every system's sky in their true direction; in each save, once the opening
 * delivery is done, Betelgeuse explodes and, later, Antares collapses into a black hole and goes
 * out. That is the game's fiction. The timeline is a function of one number in the save's world
 * log (when the first neutrino alert comes) and the clock; how bright the supernova gets follows
 * from the star's real distance and a typical supernova's peak.
 */

export function farStar(id: string): FarStar | undefined {
  return FAR_STARS.stars.find((s) => s.id === id);
}

const parsecs = (f: FarStar) => 1000 / f.parallaxMas;

/** The supernova's peak apparent magnitude, seen from the Sun: a typical Type II-P supernova's peak at the star's real distance. */
export function peakMagnitude(f: FarStar = farStar(STELLAR.supernova.star)!): number {
  return STELLAR.supernova.peakAbsoluteMagnitude + 5 * Math.log10(parsecs(f) / 10);
}

// ---------------------------------------------------------------- the timeline

export interface SkyTimeline {
  /** Betelgeuse: the neutrino alert, its light arriving, its peak, the peak's end, fading done. */
  alert: number;
  light: number;
  peak: number;
  peakEnd: number;
  fadeEnd: number;
  /** Antares: its neutrino burst, its brightening, the hold's end, gone. */
  bhAlert: number;
  bhLight: number;
  bhHoldEnd: number;
  bhGone: number;
}

export function skyTimeline(from: number): SkyTimeline {
  const S = STELLAR.supernova;
  const B = STELLAR.blackHole;
  const light = from + S.lightAfterAlert;
  const peak = light + S.rise;
  const peakEnd = peak + S.plateau;
  const bhAlert = light + B.alertAfterSupernova;
  const bhLight = bhAlert + B.lightAfterAlert;
  const bhHoldEnd = bhLight + B.hold;
  return { alert: from, light, peak, peakEnd, fadeEnd: peakEnd + S.fade, bhAlert, bhLight, bhHoldEnd, bhGone: bhHoldEnd + B.fade };
}

/**
 * Sets the save's timeline once the opening delivery is done: the first alert comes
 * STELLAR.alertAfterOpening after it, or STELLAR.alertAfterLoad from now for a save already past
 * it. True when it was set now.
 */
export function scheduleSky(state: GameState): boolean {
  if (state.world.sky) return false;
  const opening = state.jobs.lifeline;
  if (opening?.status !== 'complete') return false;
  const done = opening.completedAt ?? state.clock;
  state.world.sky = { from: Math.round(Math.max(done + STELLAR.alertAfterOpening, state.clock + STELLAR.alertAfterLoad)) };
  return true;
}

// ---------------------------------------------------------------- how the far stars look

export interface FarStarLook {
  /** Apparent magnitude (Infinity: gone). */
  magnitude: number;
  colour: string;
}

const lerp = (a: number, b: number, k: number) => a + (b - a) * Math.min(1, Math.max(0, k));

function mixColour(a: string, b: string, k: number): string {
  const p = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const [x, y] = [p(a), p(b)];
  return `#${x.map((v, i) => Math.round(lerp(v, y[i]!, k)).toString(16).padStart(2, '0')).join('')}`;
}

/** How a far star looks at a moment (its catalogue magnitude, until the fiction of its death begins). */
export function farStarLook(id: string, clock: number, from: number | null = activeSkyFrom()): FarStarLook | null {
  const f = farStar(id);
  if (!f) return null;
  const base = { magnitude: f.magnitudeV, colour: f.colorHex };
  if (from === null) return base;
  const t = skyTimeline(from);
  if (id === STELLAR.supernova.star) {
    const S = STELLAR.supernova;
    const peak = peakMagnitude(f);
    if (clock < t.light) return base;
    if (clock < t.peak) {
      const k = (clock - t.light) / S.rise;
      return { magnitude: lerp(f.magnitudeV, peak, k), colour: mixColour(f.colorHex, S.peakColour, k) };
    }
    // A Type II-P supernova holds near its peak for a while, slowly dimming (here, half a magnitude).
    if (clock < t.peakEnd) return { magnitude: peak + 0.5 * ((clock - t.peak) / S.plateau), colour: S.peakColour };
    if (clock < t.fadeEnd) {
      const k = (clock - t.peakEnd) / S.fade;
      return { magnitude: lerp(peak + 0.5, S.remnantMagnitude, k), colour: mixColour(S.peakColour, S.remnantColour, k) };
    }
    return { magnitude: S.remnantMagnitude, colour: S.remnantColour };
  }
  if (id === STELLAR.blackHole.star) {
    const B = STELLAR.blackHole;
    if (clock < t.bhLight) return base;
    if (clock < t.bhHoldEnd) return { magnitude: f.magnitudeV - B.brighten * Math.min(1, (clock - t.bhLight) / 120), colour: f.colorHex };
    if (clock < t.bhGone) return { magnitude: lerp(f.magnitudeV - B.brighten, STELLAR.nakedEye + 1, (clock - t.bhHoldEnd) / B.fade), colour: f.colorHex };
    return { magnitude: Infinity, colour: f.colorHex };
  }
  return base;
}

/** Whether a far star's death is under way at a moment (from its light until it has faded or gone). */
export function dying(id: string, clock: number, from: number | null = activeSkyFrom()): boolean {
  return skyPhase(id, clock, from) === 'dying';
}

/** Where a far star is in the fiction: as the catalogue has it, dying (from its light until it has faded or gone), or after. */
export function skyPhase(id: string, clock: number, from: number | null = activeSkyFrom()): 'catalogue' | 'dying' | 'after' {
  if (from === null) return 'catalogue';
  const t = skyTimeline(from);
  const [start, end] = id === STELLAR.supernova.star ? [t.light, t.fadeEnd] : id === STELLAR.blackHole.star ? [t.bhLight, t.bhGone] : [Infinity, Infinity];
  return clock < start ? 'catalogue' : clock < end ? 'dying' : 'after';
}

const OBLIQUITY = (23.4392911 * Math.PI) / 180;

/**
 * The direction from a system to a far star, in the flight scene's frame: the ecliptic, +x toward
 * the March equinox and +y toward the ecliptic's north, the frame Sol's planets are placed in
 * (scene angle = −longitude). Every system's sky uses it, from the system's real position.
 */
export function skyDirection(systemId: SystemId, starId: string): [number, number, number] {
  return skyDirectionTo(systemId, farStar(starId)!.positionLy);
}

/** The direction from a system to a place (light-years from the Sun, in the map's frame), in the flight scene's frame. */
export function skyDirectionTo(systemId: SystemId, positionLy: readonly [number, number, number]): [number, number, number] {
  const sys = getSystem(systemId);
  let [x, y, z] = [0, 1, 2].map((i) => positionLy[i]! - sys.positionLy[i]!) as [number, number, number];
  const n = Math.hypot(x, y, z);
  [x, y, z] = [x / n, y / n, z / n];
  const ye = y * Math.cos(OBLIQUITY) + z * Math.sin(OBLIQUITY);
  const ze = -y * Math.sin(OBLIQUITY) + z * Math.cos(OBLIQUITY);
  return [x, ze, -ye];
}

// ---------------------------------------------------------------- what is said

const STAR_OF: Record<SkyNewsKind, string> = {
  alert: STELLAR.supernova.star,
  light: STELLAR.supernova.star,
  fading: STELLAR.supernova.star,
  remnant: STELLAR.supernova.star,
  'bh-alert': STELLAR.blackHole.star,
  'bh-light': STELLAR.blackHole.star,
  'bh-gone': STELLAR.blackHole.star,
};

function moments(t: SkyTimeline): [SkyNewsKind, number][] {
  return [
    ['alert', t.alert],
    ['light', t.light],
    ['fading', t.peakEnd],
    ['remnant', t.fadeEnd],
    ['bh-alert', t.bhAlert],
    ['bh-light', t.bhLight],
    ['bh-gone', t.bhGone],
  ];
}

/** A magnitude as astronomers write it, with a true minus sign. */
export const magnitudeText = (m: number) => `${m < 0 ? '−' : ''}${Math.abs(m).toFixed(1)}`;

/** Fills a line from a far star's record and the rules (every number comes from the data). */
export function fillSky(text: string, f: FarStar): string {
  const ly = f.distanceLightYears;
  const values: Record<string, string> = {
    star: f.name,
    designation: f.designation,
    distance: Math.round(ly).toLocaleString('en-GB'),
    years: (Math.round(ly / 10) * 10).toLocaleString('en-GB'),
    peak: magnitudeText(peakMagnitude(f)),
    baseline: String(STELLAR.observe.baselineLy),
    shift: ((STELLAR.observe.baselineLy / ly) * (180 / Math.PI)).toFixed(1),
  };
  return text.replace(/\{(\w+)\}/g, (_, k: string) => values[k] ?? '');
}

export interface SkyNews {
  kind: SkyNewsKind;
  star: FarStar;
  at: number;
  headline: string;
  detail: string;
}

/** How long a star's death stays in the News after it is over (game seconds). */
const NEWS_AFTER = 6 * 3_600;

/** The News of the dying stars so far, newest first (the same in every station: the sky is everyone's). */
export function skyNews(clock: number, from: number | null = activeSkyFrom()): SkyNews[] {
  if (from === null) return [];
  const t = skyTimeline(from);
  return moments(t)
    .filter(([kind, at]) => at <= clock && clock - (kind.startsWith('bh') ? t.bhGone : t.fadeEnd) < NEWS_AFTER)
    .map(([kind, at]) => {
      const star = farStar(STAR_OF[kind])!;
      return { kind, star, at, headline: fillSky(SKY_NEWS[kind].headline, star), detail: fillSky(SKY_NEWS[kind].detail, star) };
    })
    .sort((a, b) => b.at - a.at);
}

/** The latest moment reached (for the stations' word as it comes), or null before any. */
export function skyMoment(clock: number, from: number | null = activeSkyFrom()): SkyNewsKind | null {
  if (from === null) return null;
  let last: SkyNewsKind | null = null;
  for (const [kind, at] of moments(skyTimeline(from))) if (at <= clock) last = kind;
  return last;
}

/** What the research stations say when a moment comes, if anything. */
export function skyComm(kind: SkyNewsKind): { speaker: string; text: string } | null {
  const line = SKY_COMMS[kind];
  return line ? { speaker: SKY_SPEAKER, text: fillSky(line, farStar(STAR_OF[kind])!) } : null;
}

// ---------------------------------------------------------------- markets

/** How a dying star moves a good's price at a station (1 without an effect): research stations want data and instruments. */
export function skyPrice(locationId: string, commodity: CommodityId, clock: number, from: number | null = activeSkyFrom()): number {
  if (from === null || !STELLAR.market.goods.includes(commodity) || getLocation(locationId).stationType !== 'research-station') return 1;
  const t = skyTimeline(from);
  const on = (clock >= t.alert && clock < t.fadeEnd) || (clock >= t.bhAlert && clock < t.bhGone);
  return on ? STELLAR.market.price : 1;
}

// ---------------------------------------------------------------- observations

export type ObserveKind = keyof typeof OBSERVE_LINES;

/** The observation contracts a research station posts while a star dies, and when each wants watching. */
export function skyOffers(clock0: number, clock1: number, from: number | null = activeSkyFrom()): { kind: ObserveKind; star: string; from: number; to: number; baselineLy?: number }[] {
  if (from === null) return [];
  const t = skyTimeline(from);
  const out: { kind: ObserveKind; star: string; from: number; to: number; baselineLy?: number }[] = [];
  const overlaps = (a: number, b: number) => clock1 > a && clock0 < b;
  const sn = STELLAR.supernova.star;
  if (overlaps(t.alert, t.peakEnd)) out.push({ kind: 'first', star: sn, from: t.light, to: t.peakEnd });
  if (overlaps(t.peakEnd, t.fadeEnd)) out.push({ kind: 'fading', star: sn, from: t.peakEnd, to: t.fadeEnd });
  if (overlaps(t.alert, t.fadeEnd - 3_600)) out.push({ kind: 'parallax', star: sn, from: t.light, to: t.fadeEnd, baselineLy: STELLAR.observe.baselineLy });
  if (overlaps(t.bhAlert, t.bhGone)) out.push({ kind: 'vanish', star: STELLAR.blackHole.star, from: t.bhLight, to: t.bhGone });
  return out;
}

/** An observe objective, as jobs.ts holds it. */
export interface ObserveObjective {
  kind: 'observe';
  /** A far star's id; or Pyre's, or its black hole's (docs/PROCGEN.md §26.5). */
  star: string;
  from: number;
  to: number;
  baselineLy?: number;
  /** Pyre's first light (§26.5): each reading counts only within this many seconds of its light arriving where it was made. */
  firstLight?: number;
  /** ...from two systems, the second at least this many light-years farther from Pyre. */
  aheadLy?: number;
  /** A star read where it is, in its own system: a flaring star (docs/PROCGEN.md §43.5). */
  systemId?: SystemId;
  text: string;
}

const lyBetween = (a: SystemId, b: SystemId) => {
  const [p, q] = [getSystem(a).positionLy, getSystem(b).positionLy];
  return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
};

/** Whether the observations made meet the objective: one in its window, or (parallax) two in it from systems far enough apart. */
export function observeDone(o: ObserveObjective, observed: readonly { at: number; systemId: SystemId }[]): boolean {
  const inside = observed.filter((x) => x.at >= o.from && x.at <= o.to && (!o.systemId || x.systemId === o.systemId));
  if (!o.baselineLy) return inside.length > 0;
  return inside.some((a) => inside.some((b) => lyBetween(a.systemId, b.systemId) >= o.baselineLy!));
}

/** The longest baseline among the observations in the window so far (for the objective's progress). */
export function observeBaseline(o: ObserveObjective, observed: readonly { at: number; systemId: SystemId }[]): number {
  const inside = observed.filter((x) => x.at >= o.from && x.at <= o.to);
  let best = 0;
  for (const a of inside) for (const b of inside) best = Math.max(best, lyBetween(a.systemId, b.systemId));
  return best;
}

/** The active contracts whose current objective wants an observation of a far star now (window open). */
export function observationsWanted(state: GameState, starId: string, clock = state.clock): string[] {
  const out: string[] = [];
  for (const [id, p] of Object.entries(state.jobs)) {
    if (p.status !== 'active') continue;
    const o = state.contracts[id]?.objectives[p.objectiveIndex];
    if (o?.kind === 'observe' && o.star === starId && clock >= o.from && clock <= o.to) out.push(id);
  }
  return out.sort();
}

/** Records an observation of a far star, from a system, for every contract that wants one now; the contracts it counted for. */
export function recordObservation(state: GameState, starId: string, systemId: SystemId): string[] {
  const jobs = observationsWanted(state, starId);
  for (const id of jobs) {
    const p = state.jobs[id]!;
    const list = (p.observed ??= []);
    // One reading a system a minute is plenty.
    if (!list.some((x) => x.systemId === systemId && state.clock - x.at < 60)) list.push({ at: state.clock, systemId });
  }
  return jobs;
}

