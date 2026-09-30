/**
 * What the neighborhood map plots, derived once from the bundled dataset (pure, no DOM).
 * Every star component is plotted at its own catalog position; labels group components that
 * coincide at map scale (Alpha Centauri A/B, Sirius A/B) but keep Proxima Centauri separate.
 */
import { distance3 } from '../data/coords.ts';
import { ASTROMETRY, SYSTEMS, getSystem, isNewSystem } from '../data/systems.ts';
import type { SystemId, Vec3Tuple } from '../data/types.ts';
import { equatorialToMap, type Vec3 } from './mapMath.ts';

/** Display colour of the Sun on the map (artistic, like every star colour). */
export const SUN_COLOR = '#fff1d6';

/** Components closer than this (light-years) share one label and one drop line. */
export const COINCIDENT_LY = 0.01;

/** Distance rings on the equatorial grid, light-years from Sol. */
export const RING_RADII_LY: readonly number[] = [2, 4, 6, 8, 10, 12];

export interface MapStar {
  /** Component id, or 'sun'. */
  key: string;
  systemId: SystemId;
  name: string;
  spectralType: string | null;
  /** Equatorial Cartesian position, light-years from Sol (observed data). */
  eq: Vec3Tuple;
  /** Map position (three.js axes; see mapMath.ts). */
  pos: Vec3;
  colorHex: string;
  /** Glow diameter in CSS pixels (illustrative, loosely by spectral class). */
  glowPx: number;
  /** Label group this star belongs to. */
  labelKey: string;
}

export interface MapLabel {
  key: string;
  systemId: SystemId;
  name: string;
  /** Real distance from Sol, or null for Sol itself. */
  distanceLy: number | null;
  /** Height above (+) or below (-) the celestial equator plane, light-years. */
  heightLy: number;
  eq: Vec3Tuple;
  pos: Vec3;
  starKeys: string[];
  /** The system's main label (Sirius, Alpha Centauri A/B...) as opposed to a secondary star. */
  primary: boolean;
  /** Largest glow among the grouped stars (label clearance). */
  glowPx: number;
}

export interface MapLink {
  a: SystemId;
  b: SystemId;
  /** Real straight-line distance between the systems' reference positions. */
  distanceLy: number;
}

export function glowPxForSpectralType(spectralType: string | null): number {
  switch ((spectralType ?? 'G').trim().charAt(0).toUpperCase()) {
    case 'O':
    case 'B':
    case 'A':
      return 38;
    case 'F':
      return 34;
    case 'G':
      return 31;
    case 'K':
      return 27;
    case 'M':
      return 21;
    case 'D':
      return 13;
    default:
      return 26;
  }
}

function buildStars(): MapStar[] {
  const stars: MapStar[] = [
    {
      key: 'sun',
      systemId: 'sol',
      name: 'Sun',
      spectralType: null,
      eq: [0, 0, 0],
      pos: [0, 0, 0],
      colorHex: SUN_COLOR,
      glowPx: glowPxForSpectralType('G'),
      labelKey: 'sol',
    },
  ];
  for (const c of ASTROMETRY.stars) {
    stars.push({
      key: c.id,
      systemId: c.systemId,
      name: c.name,
      spectralType: c.spectralType,
      eq: c.positionLy,
      pos: equatorialToMap(c.positionLy),
      colorHex: c.colorHex,
      glowPx: glowPxForSpectralType(c.spectralType),
      labelKey: c.id,
    });
  }
  return stars;
}

/** "Alpha Centauri A" + "Alpha Centauri B" -> "Alpha Centauri A/B". */
export function groupName(names: readonly string[]): string {
  if (names.length === 1) return names[0]!;
  const parts = names.map((n) => n.split(' '));
  const first = parts[0]!;
  let common = 0;
  while (common < first.length - 1 && parts.every((p) => p.length > common + 1 && p[common] === first[common])) common++;
  if (common === 0) return names.join(' / ');
  const prefix = first.slice(0, common).join(' ');
  return `${prefix} ${parts.map((p) => p.slice(common).join(' ')).join('/')}`;
}

function buildLabels(stars: MapStar[]): MapLabel[] {
  const labels: MapLabel[] = [];
  for (const system of SYSTEMS) {
    const members = stars.filter((s) => s.systemId === system.id);
    const groups: MapStar[][] = [];
    for (const star of members) {
      const group = groups.find((g) => distance3(g[0]!.eq, star.eq) < COINCIDENT_LY);
      if (group) group.push(star);
      else groups.push([star]);
    }
    groups.forEach((group, index) => {
      const lead = group[0]!;
      const key = index === 0 ? system.id : `${system.id}:${lead.key}`;
      for (const s of group) s.labelKey = key;
      const component = ASTROMETRY.stars.find((c) => c.id === lead.key);
      // A system's main label is the system's name, unless it groups several stars (Alpha Centauri A/B).
      const alone = group.length === 1 && index === 0 && lead.name.startsWith(`${system.displayName} `);
      labels.push({
        key,
        systemId: system.id,
        name: groups.length === 1 || alone ? system.displayName : groupName(group.map((s) => s.name)),
        distanceLy: system.id === 'sol' ? null : (component?.distanceLightYears ?? system.distanceLightYears),
        heightLy: lead.eq[2],
        eq: lead.eq,
        pos: lead.pos,
        starKeys: group.map((s) => s.key),
        primary: index === 0,
        glowPx: Math.max(...group.map((s) => s.glowPx)),
      });
    });
  }
  return labels;
}

function buildLinks(): MapLink[] {
  const links: MapLink[] = [];
  const seen = new Set<string>();
  for (const s of SYSTEMS) {
    for (const other of s.jumpLinks) {
      const [a, b] = s.id < other ? [s.id, other] : [other, s.id];
      const key = `${a}|${b}`;
      if (seen.has(key)) continue;
      seen.add(key);
      links.push({ a, b, distanceLy: distance3(getSystem(a).positionLy, getSystem(b).positionLy) });
    }
  }
  return links;
}

export const MAP_STARS: readonly MapStar[] = buildStars();
export const MAP_LABELS: readonly MapLabel[] = buildLabels(MAP_STARS as MapStar[]);
export const MAP_LINKS: readonly MapLink[] = buildLinks();

const anchorCache = new Map<SystemId, Vec3>();

/** Map position of a system's reference star (Sol at the origin). */
export function systemAnchor(id: SystemId): Readonly<Vec3> {
  let v = anchorCache.get(id);
  if (!v) {
    v = equatorialToMap(getSystem(id).positionLy);
    anchorCache.set(id, v);
  }
  return v;
}

export function labelsOf(id: SystemId): MapLabel[] {
  return MAP_LABELS.filter((l) => l.systemId === id);
}

/** Camera focus for a system: centre between its label groups, close enough to separate them. */
export function systemFocus(id: SystemId): { target: Vec3; distance: number } {
  const groups = labelsOf(id);
  const target: Vec3 = [0, 0, 0];
  for (const g of groups) {
    target[0] += g.pos[0] / groups.length;
    target[1] += g.pos[1] / groups.length;
    target[2] += g.pos[2] / groups.length;
  }
  let spread = 0;
  for (const g of groups) spread = Math.max(spread, distance3(g.pos, target));
  return { target, distance: spread > 0 ? Math.max(0.6, spread * 5) : 3.2 };
}

/** Centre and radius of a sphere holding every plotted star of the first catalogue (the far shell lies beyond). */
export function mapBounds(): { center: Vec3; radius: number } {
  const lo: Vec3 = [Infinity, Infinity, Infinity];
  const hi: Vec3 = [-Infinity, -Infinity, -Infinity];
  const core = MAP_STARS.filter((s) => !isNewSystem(s.systemId));
  for (const s of core) {
    for (let i = 0; i < 3; i++) {
      lo[i] = Math.min(lo[i]!, s.pos[i]!);
      hi[i] = Math.max(hi[i]!, s.pos[i]!);
    }
  }
  const center: Vec3 = [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2];
  let radius = 0;
  for (const s of core) radius = Math.max(radius, distance3(s.pos, center));
  return { center, radius };
}

// ---------- Formatting ----------

export function formatLy(value: number, digits = 2): string {
  return `${value.toFixed(digits)} ly`;
}

/** Short plane-height text for labels, e.g. "3.79 ly below". */
export function formatHeightShort(heightLy: number): string {
  if (Math.abs(heightLy) < 0.005) return 'in plane';
  return `${Math.abs(heightLy).toFixed(2)} ly ${heightLy > 0 ? 'above' : 'below'}`;
}

/** Full plane-height text, e.g. "3.79 light-years below the celestial equator plane". */
export function formatHeightLong(heightLy: number): string {
  if (Math.abs(heightLy) < 0.005) return 'in the celestial equator plane';
  return `${Math.abs(heightLy).toFixed(2)} light-years ${heightLy > 0 ? 'above' : 'below'} the celestial equator plane`;
}

// ---------- Top-down 2D projection (equatorial plane seen from the north celestial pole) ----------

export interface Projection2D {
  /** False: RA 0h to the right, RA 6h up. True: rotated 90° clockwise (RA 6h right), for wide areas. */
  rotate: boolean;
  /** CSS pixels per light-year. */
  scale: number;
  cx: number;
  cy: number;
  /** Plane coordinates shown at (cx, cy). */
  ou: number;
  ov: number;
}

/** Plane coordinates (u right, v up) of an equatorial position; the height z is dropped. */
export function planarUV(eq: Readonly<Vec3Tuple>, rotate: boolean, out: [number, number] = [0, 0]): [number, number] {
  if (rotate) {
    out[0] = eq[1];
    out[1] = -eq[0];
  } else {
    out[0] = eq[0];
    out[1] = eq[1];
  }
  return out;
}

/** Fits every plotted star into width x height minus margins, centred. */
export function fitProjection2D(
  width: number,
  height: number,
  rotate: boolean,
  marginX: number,
  marginY: number,
): Projection2D {
  let minU = Infinity;
  let maxU = -Infinity;
  let minV = Infinity;
  let maxV = -Infinity;
  const uv: [number, number] = [0, 0];
  for (const s of MAP_STARS) {
    planarUV(s.eq, rotate, uv);
    minU = Math.min(minU, uv[0]);
    maxU = Math.max(maxU, uv[0]);
    minV = Math.min(minV, uv[1]);
    maxV = Math.max(maxV, uv[1]);
  }
  const du = Math.max(1, maxU - minU);
  const dv = Math.max(1, maxV - minV);
  const scale = Math.max(1, Math.min((width - 2 * marginX) / du, (height - 2 * marginY) / dv));
  return { rotate, scale, cx: width / 2, cy: height / 2, ou: (minU + maxU) / 2, ov: (minV + maxV) / 2 };
}

export function project2D(p: Projection2D, eq: Readonly<Vec3Tuple>, out: [number, number] = [0, 0]): [number, number] {
  planarUV(eq, p.rotate, out);
  const u = out[0];
  const v = out[1];
  out[0] = p.cx + (u - p.ou) * p.scale;
  out[1] = p.cy - (v - p.ov) * p.scale;
  return out;
}
