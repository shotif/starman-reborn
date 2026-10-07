import craftFile from './generated/spacecraft.json' with { type: 'json' };
import { AU_KM } from './asteroids.ts';
import { twoBodyAt, type OrbitElements, type OrbitPlace } from './kepler.ts';
import { hasSolarElements, heliocentric } from './solar.ts';
import type { SourceRef } from './types.ts';

/**
 * Spacecraft out in Sol (docs/PROCGEN.md §49): eleven craft as JPL Horizons has them (read by
 * scripts/spacecraft-process.ts from the sky snapshot), and where one is on a date: from the Sun, on
 * the two-body arc the date falls in (each from Horizons' own position and velocity of it); near
 * Earth, from Horizons' own path of it from Earth's centre. Outside the span Horizons has it for,
 * it is nowhere the game can say.
 */

/** A two-body arc: [from (Julian date), e, a (au), i, Ω, ω (degrees, J2000 ecliptic), perihelion (Julian date), mean motion (degrees a day)]. */
export type CraftArc = [number, number, number, number, number, number, number, number];
/** A place on a path from Earth's centre: [Julian date, x, y, z] (au, J2000 ecliptic). */
export type CraftPathPoint = [number, number, number, number];

/** A pass of Earth: when it is nearest (Julian date) and how near (au, from Earth's centre). */
export interface CraftPass {
  jd: number;
  au: number;
}

export interface Spacecraft {
  /** The game's id (`voyager-1`), Horizons' (`-31`) and NSSDCA's (COSPAR, `1977-084A`). */
  id: string;
  horizonsId: string;
  cospar: string;
  /** Its name as Horizons gives it, and Horizons' trajectory solution for it. */
  name: string;
  solution: string;
  /** The span Horizons has it for within the snapshot's window (Julian dates). */
  from: number;
  to: number;
  arcs: CraftArc[];
  /** Its paths from Earth's centre while near Earth (the whole span for one that never leaves). */
  paths: CraftPathPoint[][];
  passes: CraftPass[];
  /** Whether NSSDCA has a page on it. */
  nssdca: boolean;
}

export interface SpacecraftDataset {
  generatedBy: string;
  retrieved: string;
  epochJd: number;
  sources: { horizons: SourceRef; nssdca: SourceRef };
  description: string;
  spacecraft: readonly Spacecraft[];
}

export const CRAFT_DATA = craftFile as unknown as SpacecraftDataset;
export const CRAFT_EPOCH_JD = CRAFT_DATA.epochJd;

const BY_ID = new Map(CRAFT_DATA.spacecraft.map((c) => [c.id, c]));

/** A spacecraft by the game's id. */
export function craftOf(id: string): Spacecraft | undefined {
  return BY_ID.get(id);
}

/** The Sun's GM (au³/day²), as Horizons reckons osculating elements about the Sun. */
export const SUN_GM = 0.01720209895 ** 2;
/** The speed of light (km/s). */
export const LIGHT_KMS = 299_792.458;

/** Whether Horizons has the craft on a date. */
export function craftOn(craft: Spacecraft, jd: number): boolean {
  return jd >= craft.from && jd <= craft.to;
}

/** An arc as the reckoning's elements. */
export function arcElements(a: CraftArc): OrbitElements {
  const [, e, aAu, inclinationDeg, nodeDeg, periDeg, perihelionJd, motionDegPerDay] = a;
  return { e, qAu: aAu * (1 - e), aAu, inclinationDeg, nodeDeg, periDeg, perihelionJd, motionDegPerDay, periodDays: e < 1 ? 360 / motionDegPerDay : Infinity };
}

/** The arc a date falls in (the last to begin by then), or null outside the span or for a craft placed by its path alone. */
export function arcOn(craft: Spacecraft, jd: number): OrbitElements | null {
  if (!craftOn(craft, jd) || !craft.arcs.length) return null;
  let found = craft.arcs[0]!;
  for (const a of craft.arcs) if (a[0] <= jd) found = a;
  return arcElements(found);
}

/** Where it is from Earth's centre on a path that covers the date (au; between points, in a straight line), or null. */
export function craftOnPath(craft: Spacecraft, jd: number): [number, number, number] | null {
  if (!craftOn(craft, jd)) return null;
  for (const p of craft.paths) {
    if (!p.length || jd < p[0]![0] || jd > p.at(-1)![0]) continue;
    const i = Math.max(1, p.findIndex((r) => r[0] >= jd));
    const [t0, x0, y0, z0] = p[i - 1]!;
    const [t1, x1, y1, z1] = p[i]!;
    const f = t1 > t0 ? (jd - t0) / (t1 - t0) : 0;
    return [x0 + (x1 - x0) * f, y0 + (y1 - y0) * f, z0 + (z1 - z0) * f];
  }
  return null;
}

/** Where it is from the Sun on a date (au, J2000 ecliptic): on its arc, or on a path from Earth's centre added to where the game has Earth; null where Horizons has no place for it. */
export function craftAt(craft: Spacecraft, jd: number): OrbitPlace | null {
  const geo = craftOnPath(craft, jd);
  if (geo && hasSolarElements(jd)) {
    const e = heliocentric('earth', jd);
    const xyz: [number, number, number] = [e[0] + geo[0], e[1] + geo[1], e[2] + geo[2]];
    return { xyz, r: Math.hypot(...xyz) };
  }
  const el = arcOn(craft, jd);
  return el ? twoBodyAt(el, jd) : null;
}

/** Where it is from Earth's centre on a date (au): on a path, else reckoned from where the game has Earth; or null. */
export function craftFromEarth(craft: Spacecraft, jd: number): [number, number, number] | null {
  const geo = craftOnPath(craft, jd);
  if (geo) return geo;
  if (!hasSolarElements(jd)) return null;
  const at = craftAt(craft, jd);
  if (!at) return null;
  const e = heliocentric('earth', jd);
  return [at.xyz[0] - e[0], at.xyz[1] - e[1], at.xyz[2] - e[2]];
}

/** How fast it moves relative to the Sun on a date (km/s): on an arc by the vis-viva law; on a path from where it is an hour either side. */
export function craftSpeedKms(craft: Spacecraft, jd: number): number | null {
  if (!craftOnPath(craft, jd)) {
    const el = arcOn(craft, jd);
    const at = el && twoBodyAt(el, jd);
    if (!el || !at) return null;
    return (Math.sqrt(SUN_GM * (2 / at.r - 1 / el.aAu)) * AU_KM) / 86_400;
  }
  const h = 1 / 24;
  const a = craftAt(craft, jd - h);
  const b = craftAt(craft, jd + h);
  if (!a || !b) return null;
  return (Math.hypot(b.xyz[0] - a.xyz[0], b.xyz[1] - a.xyz[1], b.xyz[2] - a.xyz[2]) * AU_KM) / (2 * h * 86_400);
}

/** Whether the Sun cannot hold it: its arc on the date is a hyperbola (it is leaving the Solar System). */
export function craftLeaving(craft: Spacecraft, jd: number): boolean {
  return (arcOn(craft, jd)?.e ?? 0) >= 1;
}

/** Its next pass of Earth on or after a date (passes nearer than 0.05 AU that Horizons has), or null. */
export function nextCraftPass(craft: Spacecraft, jd: number): CraftPass | null {
  return craft.passes.find((p) => p.jd >= jd) ?? null;
}
