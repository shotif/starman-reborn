/**
 * Turns the spacecraft the sky snapshot fetched (scripts/sky-fetch.ts: data/snapshot/orbits/<date>/)
 * into the game's spacecraft out in Sol, offline and deterministically (docs/ASTRONOMY_SOURCES.md,
 * *Spacecraft*). Reads the latest dated folder holding Horizons' spacecraft records, or the one given.
 *
 * For each craft: its name as Horizons gives it, and the span Horizons has it for within two years
 * before the snapshot's day and four after. Where it is from the Sun is a run of two-body arcs: each
 * from Horizons' position and velocity on one of the days four days apart (its osculating elements,
 * the Sun's pull alone), its mean motion set so it passes where Horizons has the craft on the day it
 * ends (unless that would move it by more than `PIN_MOST`), and as long as it stays within `ARC` of
 * every one of Horizons' places between (and spans no more than two of its own turns round the Sun).
 * Near Earth (within `PATH_AU`), where it is from Earth's centre is kept as Horizons gives it (hourly
 * round a pass, by the minute round its nearest hour, four-daily for a craft that never leaves Earth's
 * neighbourhood), thinned where a straight line between the kept points stays within `PATH` of the
 * rest; and each pass's nearest point is found. Horizons' places, the full paths and
 * the text of Horizons' record and of NSSDCA's page on each craft are kept apart for the tests.
 *
 *   src/data/generated/spacecraft.json        what the game uses
 *   src/data/generated/spacecraft-checks.json Horizons' places and the sources' text, for the tests
 *
 * Usage: node scripts/spacecraft-process.ts [date]
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const orbitsRoot = resolve(root, 'data/snapshot/orbits');
const date = process.argv[2] ?? readdirSync(orbitsRoot).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d) && existsSync(resolve(orbitsRoot, d, 'jpl-horizons-craft-earth.json'))).sort().at(-1);
if (!date) throw new Error('No Horizons spacecraft records in data/snapshot/orbits');
const dir = resolve(orbitsRoot, date);
const manifest = JSON.parse(readFileSync(resolve(dir, 'manifest.json'), 'utf8')) as { spacecraft: [string, string][] };
const epochJd = Date.parse(`${date}T00:00:00Z`) / 86_400_000 + 2_440_587.5;

/** The Sun's GM (au³/day², the Gaussian constant squared), as Horizons reckons osculating elements about the Sun. */
const GM = 0.01720209895 ** 2;
/** How near each arc must stay to Horizons' places it spans: the angle seen from the Sun (degrees) and the distance (fraction). */
const ARC = { deg: 0.05, fraction: 0.001 } as const;
/** An arc's mean motion is set to meet its end only if that moves it less than this (a fraction of the osculating motion). */
const PIN_MOST = 0.1;
/** Within this of Earth (AU) a craft's path from Earth's centre is kept; thinned while a straight line stays within this angle (degrees, seen from Earth) and fraction of its distance. */
const PATH_AU = 0.02;
const PATH = { deg: 0.25, fraction: 0.01 } as const;
/** For a craft that never leaves Earth's neighbourhood (the James Webb Space Telescope, round the Sun–Earth L2 point), looser: its path is long and smooth. */
const PATH_WHOLE = { deg: 1, fraction: 0.02 } as const;

type V = [number, number, number];
type State = { jd: number; r: V; v: V };
const dot = (a: V, b: V) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V, b: V): V => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a: V) => Math.hypot(...a);
const angle = (a: V, b: V) => (Math.acos(Math.min(1, Math.max(-1, dot(a, b) / (norm(a) * norm(b))))) * 180) / Math.PI;
const round = (x: number, d: number) => Number(x.toFixed(d));
const DEG = Math.PI / 180;

/** A Horizons answer's text and the rows of its table (Julian date, then the numbers after the calendar date). */
function horizons(file: string): { result: string; rows: number[][] } {
  const result = (JSON.parse(readFileSync(resolve(dir, file), 'utf8')) as { result?: string }).result ?? '';
  const start = result.indexOf('$$SOE');
  const end = result.indexOf('$$EOE');
  if (start < 0 || end < 0) return { result, rows: [] };
  const rows = result
    .slice(start + 5, end)
    .trim()
    .split('\n')
    .map((l) => l.split(',').map((x) => x.trim()))
    .map((c) => [Number(c[0]), ...c.slice(2).filter((x) => x !== '').map(Number)]);
  return { result, rows };
}

/** Text with its markup and runs of space taken out, so a quotation can be found in it. */
function plainText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;|&#xa0;/gi, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

interface Elements {
  e: number;
  aAu: number;
  inclinationDeg: number;
  nodeDeg: number;
  periDeg: number;
  perihelionJd: number;
  motionDegPerDay: number;
}

/** Osculating elements about the Sun from a position and velocity (au, au/day), ellipse or hyperbola. */
function elementsOf({ jd, r, v }: State): Elements {
  const rn = norm(r);
  const h = cross(r, v);
  const ev = cross(v, h).map((x, i) => x / GM - r[i]! / rn) as V;
  const e = norm(ev);
  const a = -GM / (2 * (dot(v, v) / 2 - GM / rn));
  const node: V = [-h[1], h[0], 0];
  let O = Math.atan2(node[1], node[0]);
  if (O < 0) O += 2 * Math.PI;
  let w = Math.acos(Math.max(-1, Math.min(1, dot(node, ev) / (norm(node) * e))));
  if (ev[2] < 0) w = 2 * Math.PI - w;
  let nu = Math.acos(Math.max(-1, Math.min(1, dot(ev, r) / (e * rn))));
  if (dot(r, v) < 0) nu = 2 * Math.PI - nu;
  const n = Math.sqrt(GM / Math.abs(a) ** 3);
  return { e, aAu: a, inclinationDeg: Math.acos(h[2] / norm(h)) / DEG, nodeDeg: O / DEG, periDeg: w / DEG, perihelionJd: jd - meanAnomaly(e, nu) / n, motionDegPerDay: n / DEG };
}

/** The mean anomaly at a true anomaly (radians), on an ellipse or a hyperbola, in (−π, π] on an ellipse. */
function meanAnomaly(e: number, nu: number): number {
  const t = Math.tan(nu / 2);
  if (e < 1) {
    const E = 2 * Math.atan(Math.sqrt((1 - e) / (1 + e)) * t);
    return E - e * Math.sin(E);
  }
  const H = 2 * Math.atanh(Math.sqrt((e - 1) / (e + 1)) * t);
  return e * Math.sinh(H) - H;
}

/** Where elements put a body on a date (au): the same reckoning as the game's (src/data/kepler.ts). */
function placeOn(el: Elements, jd: number): V {
  const e = el.e;
  const M = el.motionDegPerDay * DEG * (jd - el.perihelionJd);
  let xp: number;
  let yp: number;
  if (e < 1) {
    let m = M % (2 * Math.PI);
    if (m > Math.PI) m -= 2 * Math.PI;
    if (m <= -Math.PI) m += 2 * Math.PI;
    let E = m + 0.85 * e * (Math.sin(m) < 0 ? -1 : 1);
    for (let i = 0; i < 60; i++) {
      const d = (E - e * Math.sin(E) - m) / (1 - e * Math.cos(E));
      E -= d;
      if (Math.abs(d) < 1e-13) break;
    }
    xp = el.aAu * (Math.cos(E) - e);
    yp = el.aAu * Math.sqrt(1 - e * e) * Math.sin(E);
  } else {
    let H = Math.asinh(M / e);
    for (let i = 0; i < 60; i++) {
      const d = (e * Math.sinh(H) - H - M) / (e * Math.cosh(H) - 1);
      H -= d;
      if (Math.abs(d) < 1e-13) break;
    }
    const a = Math.abs(el.aAu);
    xp = a * (e - Math.cosh(H));
    yp = a * Math.sqrt(e * e - 1) * Math.sinh(H);
  }
  const [w, O, I] = [el.periDeg * DEG, el.nodeDeg * DEG, el.inclinationDeg * DEG];
  const [cw, sw, cO, sO, cI, sI] = [Math.cos(w), Math.sin(w), Math.cos(O), Math.sin(O), Math.cos(I), Math.sin(I)];
  return [(cw * cO - sw * sO * cI) * xp + (-sw * cO - cw * sO * cI) * yp, (cw * sO + sw * cO * cI) * xp + (-sw * sO + cw * cO * cI) * yp, sw * sI * xp + cw * sI * yp];
}

/** Elements from the state at an arc's start, the mean motion set so the arc passes where the craft is at its end. */
function pinned(a: State, b: State): Elements {
  const el = elementsOf(a);
  const [w, O, I] = [el.periDeg * DEG, el.nodeDeg * DEG, el.inclinationDeg * DEG];
  const P: V = [Math.cos(w) * Math.cos(O) - Math.sin(w) * Math.sin(O) * Math.cos(I), Math.cos(w) * Math.sin(O) + Math.sin(w) * Math.cos(O) * Math.cos(I), Math.sin(w) * Math.sin(I)];
  const Q: V = [-Math.sin(w) * Math.cos(O) - Math.cos(w) * Math.sin(O) * Math.cos(I), -Math.sin(w) * Math.sin(O) + Math.cos(w) * Math.cos(O) * Math.cos(I), Math.cos(w) * Math.sin(I)];
  const Mb = meanAnomaly(el.e, Math.atan2(dot(b.r, Q), dot(b.r, P)));
  const n0 = el.motionDegPerDay * DEG;
  const Ma = n0 * (a.jd - el.perihelionJd);
  // On an ellipse, the turns between are counted from the osculating motion.
  const k = el.e < 1 ? Math.round((Ma + n0 * (b.jd - a.jd) - Mb) / (2 * Math.PI)) : 0;
  const n = (Mb + 2 * Math.PI * k - Ma) / (b.jd - a.jd);
  // Across a flyby, a burn or a seam in Horizons' trajectory files, meeting the end would take a motion
  // far off the craft's own: there the osculating motion stands.
  if (!(n > 0) || Math.abs(n - n0) / n0 > PIN_MOST) return el;
  return { ...el, motionDegPerDay: n / DEG, perihelionJd: a.jd - Ma / n };
}

/** How far elements put a craft from where Horizons has it: the angle seen from the Sun (degrees) and the fraction of its distance. */
function missOf(el: Elements, s: { jd: number; r: V }): { deg: number; fraction: number } {
  const p = placeOn(el, s.jd);
  return { deg: angle(p, s.r), fraction: Math.abs(norm(p) - norm(s.r)) / norm(s.r) };
}

/** Elements as the game keeps them: [from (Julian date), e, a (au), i, Ω, ω (degrees), perihelion (Julian date), mean motion (degrees a day)]. */
type Arc = [number, number, number, number, number, number, number, number];
const packed = (from: number, el: Elements): Arc => [
  round(from, 4),
  round(el.e, 10),
  Number(el.aAu.toPrecision(11)),
  round(el.inclinationDeg, 8),
  round(el.nodeDeg, 8),
  round(el.periDeg, 8),
  round(el.perihelionJd, 6),
  Number(el.motionDegPerDay.toPrecision(11)),
];
const unpacked = (a: Arc): Elements => ({ e: a[1], aAu: a[2], inclinationDeg: a[3], nodeDeg: a[4], periDeg: a[5], perihelionJd: a[6], motionDegPerDay: a[7] });

/** The arcs over a craft's places: each as long as it stays within ARC of every place it spans (as stored), and two of its own turns. */
function arcsOver(states: State[]): Arc[] {
  const arcs: Arc[] = [];
  let i = 0;
  while (i < states.length - 1) {
    let best = i + 1;
    let bestArc = packed(states[i]!.jd, pinned(states[i]!, states[i + 1]!));
    for (let j = i + 2; j < states.length; j++) {
      const arc = packed(states[i]!.jd, pinned(states[i]!, states[j]!));
      const el = unpacked(arc);
      if (el.e < 1 && states[j]!.jd - states[i]!.jd > (2 * 360) / el.motionDegPerDay) break;
      let ok = true;
      for (let k = i; k <= j && ok; k++) {
        const m = missOf(el, states[k]!);
        ok = m.deg <= ARC.deg && m.fraction <= ARC.fraction;
      }
      if (!ok) break;
      [best, bestArc] = [j, arc];
    }
    arcs.push(bestArc);
    i = best;
  }
  return arcs;
}

/** A path thinned: kept points such that a straight line between two holds every point between within PATH. */
function thinned(path: [number, number, number, number][], within: { deg: number; fraction: number } = PATH): [number, number, number, number][] {
  if (path.length < 3) return path;
  const kept = [path[0]!];
  let i = 0;
  while (i < path.length - 1) {
    let best = i + 1;
    for (let j = i + 2; j < path.length; j++) {
      const [a, b] = [path[i]!, path[j]!];
      let ok = true;
      for (let k = i + 1; k < j && ok; k++) {
        const p = path[k]!;
        const f = (p[0] - a[0]) / (b[0] - a[0]);
        const q: V = [a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f, a[3] + (b[3] - a[3]) * f];
        const t: V = [p[1], p[2], p[3]];
        ok = angle(q, t) <= within.deg && Math.abs(norm(q) - norm(t)) / norm(t) <= within.fraction;
      }
      if (!ok) break;
      best = j;
    }
    kept.push(path[best]!);
    i = best;
  }
  return kept;
}

/** The nearest point of a run of places from Earth: the time and distance (au), from a parabola through the nearest three. */
function nearest(path: [number, number, number, number][]): { jd: number; au: number } {
  const d = path.map((p) => Math.hypot(p[1], p[2], p[3]));
  let i = d.indexOf(Math.min(...d));
  i = Math.min(Math.max(i, 1), path.length - 2);
  const [t0, t1] = [path[i - 1]![0], path[i]![0]];
  const [d0, d1, d2] = [d[i - 1]!, d[i]!, d[i + 1]!];
  const h = t1 - t0;
  const den = d0 - 2 * d1 + d2;
  const x = den > 0 ? (0.5 * (d0 - d2)) / den : 0;
  return { jd: t1 + x * h, au: d1 - 0.25 * (d0 - d2) * x };
}

/** The game's id for a craft: its name in lower case, words joined by hyphens. */
const idOf = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

const craft: object[] = [];
const checks: Record<string, { places: [number, number, number, number][]; path: [number, number, number, number][]; record: string; nssdca: string | null }> = {};
for (const [horizonsId, cospar] of manifest.spacecraft) {
  const n = horizonsId.slice(1);
  const sun = horizons(`jpl-horizons-craft-sun-${n}.json`);
  const name = /Target body name:\s*(.+?)\s*\(spacecraft\)/i.exec(sun.result)?.[1]?.trim();
  if (!name || sun.rows.length < 2) throw new Error(`${horizonsId}: no name or no places from Horizons`);
  const states: State[] = sun.rows.map((r) => ({ jd: r[0]!, r: [r[1]!, r[2]!, r[3]!], v: [r[4]!, r[5]!, r[6]!] }));
  const solution = /Target body name:.*\{source:\s*([^}]+)\}/.exec(sun.result)?.[1]?.trim() ?? '';
  // From Earth's centre: every file Horizons answered for the craft near Earth, each pass's minutes round
  // its nearest hour put in place of those hours.
  const geoFiles = readdirSync(dir).filter((f) => f === `jpl-horizons-craft-geo-${n}.json` || f.startsWith(`jpl-horizons-craft-geo-${n}-`));
  const whole = geoFiles.includes(`jpl-horizons-craft-geo-${n}.json`);
  const rowsOf = (f: string) => horizons(f).rows.map((r): [number, number, number, number] => [r[0]!, r[1]!, r[2]!, r[3]!]);
  const runs = geoFiles
    .filter((f) => !f.endsWith('-nearest.json'))
    .sort()
    .map((f) => {
      const hours = rowsOf(f);
      const near = geoFiles.includes(f.replace('.json', '-nearest.json')) ? rowsOf(f.replace('.json', '-nearest.json')) : [];
      if (!near.length) return hours;
      return [...hours.filter((r) => r[0] < near[0]![0] - 1e-6), ...near, ...hours.filter((r) => r[0] > near.at(-1)![0] + 1e-6)];
    })
    .filter((rows) => rows.length);
  const paths: [number, number, number, number][][] = [];
  const passes: { jd: number; au: number }[] = [];
  for (const rows of runs) {
    // The stretch within PATH_AU, and one place either side of it.
    const inside = rows.map((p) => whole || Math.hypot(p[1], p[2], p[3]) < PATH_AU);
    const first = inside.indexOf(true);
    if (first < 0) continue;
    const last = inside.lastIndexOf(true);
    const stretch = rows.slice(Math.max(0, first - 1), Math.min(rows.length, last + 2));
    paths.push(thinned(stretch, whole ? PATH_WHOLE : PATH).map((p) => [round(p[0], 5), Number(p[1].toPrecision(7)), Number(p[2].toPrecision(7)), Number(p[3].toPrecision(7))]));
    // A pass is a nearest point between its ends: not the start of a craft's span, as it leaves Earth after launch.
    const d = rows.map((p) => Math.hypot(p[1], p[2], p[3]));
    const least = d.indexOf(Math.min(...d));
    if (!whole && least > 0 && least < rows.length - 1) {
      const pass = nearest(rows);
      passes.push({ jd: round(pass.jd, 5), au: Number(pass.au.toPrecision(6)) });
    }
  }
  const record = horizons(`jpl-horizons-craft-record-${n}.json`).result;
  const nssdcaFile = resolve(dir, `nssdca-${cospar}.html`);
  const nssdcaText = existsSync(nssdcaFile) ? plainText(readFileSync(nssdcaFile, 'utf8')) : '';
  const nssdca = /NSSDCA\/COSPAR ID:\s*\S+/.test(nssdcaText) && /Facts in Brief/.test(nssdcaText) ? nssdcaText : null;
  craft.push({
    id: idOf(name),
    horizonsId,
    cospar,
    name,
    solution,
    from: states[0]!.jd,
    to: states.at(-1)!.jd,
    // A craft that never leaves Earth's neighbourhood is placed from its path alone.
    arcs: whole ? [] : arcsOver(states),
    paths,
    passes,
    nssdca: nssdca !== null,
  });
  checks[idOf(name)] = {
    places: states.map((s) => [s.jd, Number(s.r[0].toPrecision(10)), Number(s.r[1].toPrecision(10)), Number(s.r[2].toPrecision(10))]),
    path: runs.flat().map((p) => [p[0], Number(p[1].toPrecision(9)), Number(p[2].toPrecision(9)), Number(p[3].toPrecision(9))]),
    record: plainText(record),
    nssdca,
  };
}

const sources = {
  horizons: { label: 'JPL Horizons', url: 'https://ssd.jpl.nasa.gov/horizons/', retrieved: date },
  nssdca: { label: 'NASA Space Science Data Coordinated Archive', url: 'https://nssdc.gsfc.nasa.gov/nmc/SpacecraftQuery.jsp', retrieved: date },
};
writeFileSync(
  resolve(root, 'src/data/generated/spacecraft.json'),
  JSON.stringify(
    {
      generatedBy: 'scripts/spacecraft-process.ts',
      retrieved: date,
      epochJd,
      sources,
      description:
        'Spacecraft in Sol as JPL Horizons has them: each one’s name, Horizons and NSSDCA/COSPAR ids and trajectory solution, the span Horizons has it for within two years before the snapshot and four after (Julian dates), where it is from the Sun as two-body arcs from Horizons’ positions and velocities every four days ([from (Julian date), e, a (au), i, Ω, ω (degrees, J2000 ecliptic), perihelion (Julian date), mean motion (degrees a day)], each holding until the next begins), where it is from Earth’s centre while near Earth ([Julian date, x, y, z] in au, J2000 ecliptic), and its nearest passes of Earth (Julian date, au).',
      spacecraft: craft,
    },
    null,
    2,
  ).replace(/\[\s+([-\d.e+,\s]+?)\s+\]/g, (_, inner: string) => `[${inner.split(/,\s*/).join(', ')}]`) + '\n',
);
writeFileSync(
  resolve(root, 'src/data/generated/spacecraft-checks.json'),
  JSON.stringify({
    generatedBy: 'scripts/spacecraft-process.ts',
    retrieved: date,
    sources,
    description: 'For the tests: JPL Horizons’ places of each craft from the Sun every four days and its full paths from Earth’s centre ([Julian date, x, y, z] in au, J2000 ecliptic), and the text of Horizons’ record of it and of NSSDCA’s page on it (markup taken out), which every fact the game gives is quoted from.',
    craft: checks,
  }) + '\n',
);
console.log(
  `Spacecraft ${date}: ${(craft as { name: string; arcs: unknown[]; paths: unknown[][]; passes: { jd: number; au: number }[] }[])
    .map((c) => `${c.name} (${c.arcs.length} arcs${c.paths.length ? `, ${c.paths.reduce((k, p) => k + p.length, 0)} path points` : ''}${c.passes.length ? `, passes ${c.passes.map((p) => `${p.jd.toFixed(1)} at ${p.au.toFixed(5)} AU`).join(' and ')}` : ''})`)
    .join('; ')}.`,
);
