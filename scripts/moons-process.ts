/**
 * Turns the moons the sky snapshot fetched (scripts/sky-fetch.ts: data/snapshot/orbits/<date>/) into
 * the game's moons of the giant planets, offline and deterministically (docs/ASTRONOMY_SOURCES.md,
 * *Moons of the giant planets*). Reads the latest dated folder holding Horizons' moon records, or the
 * one given.
 *
 * For each moon: Horizons' record gives its name, mean radius, density and geometric albedo, and its
 * planet's equatorial radius; Horizons' positions of it from its planet's centre, every three and a
 * half days for two years before the snapshot's day and four after, are split in two. From every
 * other one its motion is reckoned (the plane it orbits in, its mean distance, mean motion and
 * longitude, and the eccentricity and direction of its orbit's long axis, to first order); the rest
 * are kept apart for the tests to check that motion against. Its osculating mean motion on the day
 * only seeds the count of its turns between positions.
 *
 *   src/data/generated/moons.json        what the game uses
 *   src/data/generated/moon-checks.json  Horizons' positions not used in the reckoning, for the tests
 *
 * Usage: node scripts/moons-process.ts [date]
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const orbitsRoot = resolve(root, 'data/snapshot/orbits');
const date = process.argv[2] ?? readdirSync(orbitsRoot).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d) && existsSync(resolve(orbitsRoot, d, 'jpl-horizons-moon-elements-501.json'))).sort().at(-1);
if (!date) throw new Error('No Horizons moon records in data/snapshot/orbits');
const dir = resolve(orbitsRoot, date);
const manifest = JSON.parse(readFileSync(resolve(dir, 'manifest.json'), 'utf8')) as { moons: [string, string][] };

/** The game's id of each planet by its Horizons id. */
const PLANETS: Record<string, string> = { '599': 'jupiter', '699': 'saturn' };

type V = [number, number, number];
const dot = (a: V, b: V) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V, b: V): V => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a: V) => Math.hypot(...a);
const unit = (a: V): V => {
  const n = norm(a);
  return [a[0] / n, a[1] / n, a[2] / n];
};
const round = (x: number, d: number) => Number(x.toFixed(d));

/** A Horizons answer: its header and the rows of its table (between $$SOE and $$EOE), keyed by column. */
function horizons(file: string): { header: string; rows: Record<string, string>[] } {
  const result = (JSON.parse(readFileSync(resolve(dir, file), 'utf8')) as { result: string }).result;
  const start = result.indexOf('$$SOE');
  const end = result.indexOf('$$EOE');
  if (start < 0 || end < 0) throw new Error(`${file}: no table`);
  const before = result.slice(0, start).trimEnd().split('\n');
  const names = before
    .filter((l) => l.includes('JDTDB'))
    .at(-1)!
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);
  const rows = result
    .slice(start + 5, end)
    .trim()
    .split('\n')
    .map((l) => l.split(',').map((x) => x.trim()))
    .map((cells) => Object.fromEntries(names.map((n, i) => [n, cells[i]!])));
  return { header: result.slice(0, start), rows };
}

/** A number after a label in Horizons' header (`Mean radius (km) = 1821.49`), or null. */
function headerNumber(header: string, label: RegExp): number | null {
  const m = new RegExp(`${label.source}\\s*=\\s*~?\\s*([-+]?[\\d.]+)`, 'i').exec(header);
  return m ? Number(m[1]) : null;
}

/** The axis the positions spread least along: the normal of the plane they lie in (towards the ecliptic's north). */
function planeNormal(X: V[]): V {
  const C = [0, 1, 2].map(() => [0, 0, 0]);
  for (const r of X) for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) C[i]![j]! += r[i]! * r[j]!;
  const m = (i: number, j: number) => C[i]![j]!;
  const det = m(0, 0) * (m(1, 1) * m(2, 2) - m(1, 2) * m(2, 1)) - m(0, 1) * (m(1, 0) * m(2, 2) - m(1, 2) * m(2, 0)) + m(0, 2) * (m(1, 0) * m(2, 1) - m(1, 1) * m(2, 0));
  const inv = [0, 1, 2].map((i) =>
    [0, 1, 2].map((j) => {
      const r = [0, 1, 2].filter((k) => k !== j);
      const c = [0, 1, 2].filter((k) => k !== i);
      return (((i + j) % 2 ? -1 : 1) * (m(r[0]!, c[0]!) * m(r[1]!, c[1]!) - m(r[0]!, c[1]!) * m(r[1]!, c[0]!))) / det;
    }),
  );
  // Inverse iteration: towards the eigenvector of the smallest eigenvalue.
  let x: V = [0, 0, 1];
  for (let k = 0; k < 60; k++) x = unit([dot(inv[0] as V, x), dot(inv[1] as V, x), dot(inv[2] as V, x)]);
  return x[2] < 0 ? [-x[0], -x[1], -x[2]] : x;
}

const moons = [];
const checks: Record<string, [number, number, number, number][]> = {};
let epochJd: number | null = null;
for (const [hid, planetHid] of manifest.moons) {
  const planet = PLANETS[planetHid];
  if (!planet) throw new Error(`${hid}: round an unknown planet ${planetHid}`);
  const el = horizons(`jpl-horizons-moon-elements-${hid}.json`);
  const day = Number(el.rows[0]!.JDTDB);
  epochJd ??= day;
  if (day !== epochJd) throw new Error(`${hid}: elements on ${day}, not ${epochJd}`);
  const name = /Target body name:\s*([^(]+?)\s*\(/.exec(el.header)?.[1]?.trim();
  const planetRadiusKm = Number(/Center radii\s*:\s*([\d.]+)/.exec(el.header)?.[1]);
  const radiusKm = headerNumber(el.header, /Mean radius \(km\)/);
  const density = headerNumber(el.header, /Density \(g ?(?:cm\^-3|\/cm\^3)\)/);
  const albedo = headerNumber(el.header, /Geometric Albedo/);
  if (!name || !(planetRadiusKm > 0) || radiusKm === null) throw new Error(`${hid}: no name, size or planet's size in its record`);
  const n0 = (Number(el.rows[0]!.N) * Math.PI) / 180;

  const vec = horizons(`jpl-horizons-moon-vectors-${hid}.json`);
  const all = vec.rows.map((r) => ({ t: Number(r.JDTDB), x: [Number(r.X), Number(r.Y), Number(r.Z)] as V }));
  const fit = all.filter((_, i) => i % 2 === 0);
  checks[hid] = all.filter((_, i) => i % 2 === 1).map((p) => [p.t, round(p.x[0], 1), round(p.x[1], 1), round(p.x[2], 1)]);

  // The plane, and in it a reference direction: where it meets the ecliptic's x axis, projected.
  const normal = planeNormal(fit.map((p) => p.x));
  const u = unit([1 - normal[0] * normal[0], -normal[0] * normal[1], -normal[0] * normal[2]]);
  const w = cross(normal, u);
  const t0 = epochJd;
  // Its angle in the plane at each position, counted in whole turns from the one before, the turns seeded by the osculating motion.
  const angles = fit.map((p) => Math.atan2(dot(p.x, w), dot(p.x, u)));
  const unwrapped: number[] = [];
  angles.forEach((a, k) => {
    const predicted = k === 0 ? a : unwrapped[k - 1]! + n0 * (fit[k]!.t - fit[k - 1]!.t);
    unwrapped.push(a + 2 * Math.PI * Math.round((predicted - a) / (2 * Math.PI)));
  });
  // Mean longitude, in a straight line through time (least squares).
  const xs = fit.map((p) => p.t - t0);
  const mx = xs.reduce((s, x) => s + x, 0) / xs.length;
  const my = unwrapped.reduce((s, y) => s + y, 0) / unwrapped.length;
  const n = xs.reduce((s, x, k) => s + (x - mx) * (unwrapped[k]! - my), 0) / xs.reduce((s, x) => s + (x - mx) ** 2, 0);
  const lambda0 = my - n * mx;
  // To first order in the eccentricity: true minus mean longitude = 2e sin(λ − ϖ) (least squares on what is left).
  let saa = 0;
  let sab = 0;
  let sbb = 0;
  let say = 0;
  let sby = 0;
  fit.forEach((p, k) => {
    const L = lambda0 + n * (p.t - t0);
    const y = unwrapped[k]! - L;
    const f1 = Math.sin(L);
    const f2 = -Math.cos(L);
    saa += f1 * f1;
    sab += f1 * f2;
    sbb += f2 * f2;
    say += f1 * y;
    sby += f2 * y;
  });
  const det = saa * sbb - sab * sab;
  const A = (say * sbb - sby * sab) / det;
  const B = (sby * saa - say * sab) / det;
  const e = Math.hypot(A, B) / 2;
  const peri = Math.atan2(B, A);
  const aKm = fit.reduce((s, p) => s + norm(p.x), 0) / fit.length;
  const deg = (r: number) => (((r * 180) / Math.PI) % 360 + 360) % 360;

  moons.push({
    id: name.toLowerCase(),
    horizonsId: hid,
    name,
    planet,
    planetRadiusKm,
    radiusKm,
    densityGcm3: density,
    albedo,
    motion: {
      /** Unit vectors in the J2000 ecliptic: the orbit's normal, and the direction its longitudes count from. */
      normal: normal.map((x) => round(x, 8)),
      from: u.map((x) => round(x, 8)),
      aKm: round(aKm, 1),
      lambdaDeg: round(deg(lambda0), 6),
      motionDegPerDay: round((n * 180) / Math.PI, 8),
      periodDays: round((2 * Math.PI) / n, 6),
      e: round(e, 6),
      periDeg: round(deg(peri), 4),
    },
  });
}

const source = { label: 'JPL Horizons', url: 'https://ssd.jpl.nasa.gov/horizons/', retrieved: date };
writeFileSync(
  resolve(root, 'src/data/generated/moons.json'),
  JSON.stringify(
    {
      generatedBy: 'scripts/moons-process.ts',
      retrieved: date,
      epochJd,
      source,
      description:
        'The large moons of Jupiter and Saturn: names, mean radii (km), densities (g/cm³) and geometric albedos from JPL Horizons, with their planets’ equatorial radii (km); and each one’s motion round its planet reckoned from Horizons’ positions of it every seven days from two years before the snapshot to four after (J2000 ecliptic): the normal of the plane it orbits in and the direction longitudes count from, its mean distance (km), its mean longitude on the snapshot’s day and mean motion (degrees, degrees a day), its period (days), and to first order its orbit’s eccentricity and the longitude of its nearest point to the planet.',
      moons,
    },
    null,
    2,
  ) + '\n',
);
writeFileSync(
  resolve(root, 'src/data/generated/moon-checks.json'),
  JSON.stringify({ generatedBy: 'scripts/moons-process.ts', retrieved: date, source, description: 'JPL Horizons’ positions of the moons from their planets’ centres (J2000 ecliptic, km) every seven days, half a week from those the motion is reckoned from: [Julian date, x, y, z].', positions: checks }) + '\n',
);
console.log(`Moons ${date}: ${moons.map((m) => `${m.name} (${m.motion.periodDays.toFixed(3)} d)`).join(', ')}; ${Object.values(checks).reduce((k, c) => k + c.length, 0)} Horizons positions kept to test against.`);
