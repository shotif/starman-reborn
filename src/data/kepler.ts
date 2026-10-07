/**
 * The two-body reckoning shared by Sol's small bodies (docs/PROCGEN.md §45.2, §47.2): where a body
 * stands on a date from its osculating elements, as if only the Sun pulled on it.
 */

export interface OrbitElements {
  e: number;
  /** Perihelion distance, semi-major axis (au). */
  qAu: number;
  aAu: number;
  inclinationDeg: number;
  nodeDeg: number;
  periDeg: number;
  /** Time of perihelion (Julian date) nearest the elements' day. */
  perihelionJd: number;
  motionDegPerDay: number;
  periodDays: number;
}

export interface OrbitPlace {
  /** Heliocentric position, J2000 ecliptic (au). */
  xyz: [number, number, number];
  /** Distance from the Sun (au). */
  r: number;
}

const DEG = Math.PI / 180;

/** Where a body on these elements stands on a date (heliocentric, J2000 ecliptic). */
export function twoBodyAt(el: OrbitElements, jd: number): OrbitPlace {
  const e = el.e;
  // Mean anomaly in (-π, π].
  let M = (el.motionDegPerDay * (jd - el.perihelionJd) * DEG) % (2 * Math.PI);
  if (M > Math.PI) M -= 2 * Math.PI;
  if (M <= -Math.PI) M += 2 * Math.PI;
  // Kepler's equation by Newton's method, from Danby's start (it converges for any eccentricity below one).
  let E = M + 0.85 * e * (Math.sin(M) < 0 ? -1 : 1);
  for (let i = 0; i < 60; i++) {
    const dE = (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
    E -= dE;
    if (Math.abs(dE) < 1e-13) break;
  }
  const a = el.aAu;
  const xp = a * (Math.cos(E) - e);
  const yp = a * Math.sqrt(1 - e * e) * Math.sin(E);
  const w = el.periDeg * DEG;
  const O = el.nodeDeg * DEG;
  const I = el.inclinationDeg * DEG;
  const [cw, sw, cO, sO, cI, sI] = [Math.cos(w), Math.sin(w), Math.cos(O), Math.sin(O), Math.cos(I), Math.sin(I)];
  const x = (cw * cO - sw * sO * cI) * xp + (-sw * cO - cw * sO * cI) * yp;
  const y = (cw * sO + sw * cO * cI) * xp + (-sw * sO + cw * cO * cI) * yp;
  const z = sw * sI * xp + cw * sI * yp;
  return { xyz: [x, y, z], r: Math.hypot(x, y, z) };
}

/** Which way a body is moving on a date (a unit vector, J2000 ecliptic), from where it stands half a day either side. */
export function headingOf(at: (jd: number) => OrbitPlace, jd: number): [number, number, number] {
  const a = at(jd - 0.5).xyz;
  const b = at(jd + 0.5).xyz;
  const d: [number, number, number] = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const n = Math.hypot(...d) || 1;
  return [d[0] / n, d[1] / n, d[2] / n];
}
