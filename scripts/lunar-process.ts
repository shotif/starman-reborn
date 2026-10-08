/**
 * Turns Earth's Moon as the sky snapshot fetched it (scripts/sky-fetch.ts: data/snapshot/orbits/<date>/)
 * into the game's Moon, offline and deterministically (docs/PROCGEN.md §51; docs/ASTRONOMY_SOURCES.md,
 * *Earth's Moon*). Reads the latest dated folder holding Horizons' positions of the Moon, or the one given.
 *
 * Where the Moon is from Earth's centre (J2000 ecliptic) is reckoned from JPL Horizons' positions of
 * it every six hours from two years before the snapshot's day to four after, split in two: from every
 * other one the motion is reckoned, and the rest are kept for the tests to check it against, with
 * Horizons' positions every ten days for ten years after (to check it beyond). The motion is the
 * Moon's mean longitude and the four arguments it is reckoned in (the mean elongation from the Sun D,
 * the Sun's mean anomaly M, the Moon's own M′ and its argument of latitude F, as the IERS Conventions
 * give them from Simon et al. 1994), with a series of periodic terms in each of longitude, latitude
 * and distance whose arguments are whole multiples of those four: chosen one at a time, each the one
 * that would explain most of what is still unexplained (scored exactly, against the terms already
 * taken; the simpler argument first where two would explain alike), until every position is matched
 * within `TOLERANCE`. Only terms that turn at least `TURNS` times over the span are offered, and only
 * the longitude has a drift (the latitude and distance have none to have), so no term can stand in
 * for a slow change and the series holds beyond the span. Each term's size is then fitted by least
 * squares.
 *
 * And NASA's eclipses of the Sun and the Moon (Fred Espenak's decade tables), from two years before
 * the snapshot's day, each as the table gives it; Horizons' fraction of the Moon lit, daily, and the
 * US Naval Observatory's times of its phases, for the tests.
 *
 *   src/data/generated/lunar.json         what the game uses
 *   src/data/generated/lunar-checks.json  Horizons' positions and lit fractions, USNO's phases and
 *                                          NASA's tables' text, for the tests
 *
 * Usage: node scripts/lunar-process.ts [date]
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const orbitsRoot = resolve(root, 'data/snapshot/orbits');
const date = process.argv[2] ?? readdirSync(orbitsRoot).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d) && existsSync(resolve(orbitsRoot, d, 'jpl-horizons-luna-vectors.json'))).sort().at(-1);
if (!date) throw new Error('No Horizons positions of the Moon in data/snapshot/orbits');
const dir = resolve(orbitsRoot, date);
const manifest = JSON.parse(readFileSync(resolve(dir, 'manifest.json'), 'utf8')) as { eclipseDecades?: number[] };
const epochJd = Date.parse(`${date}T00:00:00Z`) / 86_400_000 + 2_440_587.5;

/** How near every one of Horizons' positions the series must come: longitude and latitude (degrees), distance (km). */
const TOLERANCE = { lon: 0.01, lat: 0.01, dist: 20 } as const;
/** At most this many periodic terms in each series. */
const MOST_TERMS = 60;
/** A term is offered only if it turns at least this many times over the positions' span (so none can stand in for the constant or the drift). */
const TURNS = 0.9;
/** Where two terms would explain alike, the simpler argument (the fewer multiples in all) is taken: each multiple counts against a term by this fraction. */
const SIMPLER = 0.01;
/** The multiples of D, M, M′ and F a term's argument may take. */
const MULTIPLES = { D: 4, M: 2, Mp: 4, F: 4 } as const;

/**
 * The fundamental arguments (arcseconds; T in Julian centuries of TDB from J2000): IERS Conventions
 * (2010), eq. 5.43, from Simon et al. (1994): the Moon's mean anomaly (M′), the Sun's (M), the
 * Moon's argument of latitude (F), its mean elongation from the Sun (D) and the longitude of its
 * ascending node (Ω). The Moon's mean longitude is F + Ω.
 */
const ARGUMENTS = {
  Mp: [485868.249036, 1717915923.2178, 31.8792, 0.051635, -0.0002447],
  M: [1287104.793048, 129596581.0481, -0.5532, 0.000136, -0.00001149],
  F: [335779.526232, 1739527262.8478, -12.7512, -0.001037, 0.00000417],
  D: [1072260.703692, 1602961601.209, -6.3706, 0.006593, -0.00003169],
  Omega: [450160.398036, -6962890.5431, 7.4722, 0.007702, -0.00005939],
} as const;
const ARCSEC = Math.PI / 180 / 3600;
const TURN = 1_296_000;
const argument = (c: readonly number[], T: number) => ((c[0]! + T * (c[1]! + T * (c[2]! + T * (c[3]! + T * c[4]!)))) % TURN) * ARCSEC;
/** Degrees a day each argument turns. */
const RATE = { D: ARGUMENTS.D[1] / 3600 / 36525, M: ARGUMENTS.M[1] / 3600 / 36525, Mp: ARGUMENTS.Mp[1] / 3600 / 36525, F: ARGUMENTS.F[1] / 3600 / 36525 };

const round = (x: number, d: number) => Number(x.toFixed(d));
const DEG = 180 / Math.PI;

/** A Horizons answer's text and the rows of its table (Julian date, then the numbers after the calendar date). */
function horizons(file: string): { result: string; rows: number[][] } {
  const result = (JSON.parse(readFileSync(resolve(dir, file), 'utf8')) as { result?: string }).result ?? '';
  const start = result.indexOf('$$SOE');
  const end = result.indexOf('$$EOE');
  if (start < 0 || end < 0) throw new Error(`${file}: no table in Horizons' answer`);
  const rows = result
    .slice(start + 5, end)
    .trim()
    .split('\n')
    .map((l) => l.split(',').map((x) => x.trim()))
    .map((c) => [Number(c[0]), ...c.slice(2).filter((x) => x !== '').map(Number)]);
  return { result, rows };
}

/** A number after a label in Horizons' record of a body (`Earth/Moon mass ratio = 81.3005690769`). */
function recordNumber(text: string, label: RegExp): number {
  const m = new RegExp(`${label.source}\\s*=\\s*([-+]?[\\d.]+)`).exec(text);
  if (!m) throw new Error(`No ${label.source} in Horizons' record of the Moon`);
  return Number(m[1]);
}

/** Text with its markup and runs of space taken out, so a quotation can be found in it. */
function plainText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;|&#xa0;/gi, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

// ---------------------------------------------------------------- the motion

interface Sample { jd: number; T: number; t: number; args: Record<'D' | 'M' | 'Mp' | 'F', number>; dLon: number; lat: number; dist: number }
type Multiples = [number, number, number, number];

const vectors = horizons('jpl-horizons-luna-vectors.json');
const record = vectors.result.slice(0, vectors.result.indexOf('$$SOE'));
const massRatio = recordNumber(record, /Earth\/Moon mass ratio/);
const radiusKm = recordNumber(record, /Radius \(IAU\), km/);
function sample(row: number[]): Sample {
  const [jd, x, y, z] = row as [number, number, number, number];
  const T = (jd - 2_451_545) / 36_525;
  const args = { D: argument(ARGUMENTS.D, T), M: argument(ARGUMENTS.M, T), Mp: argument(ARGUMENTS.Mp, T), F: argument(ARGUMENTS.F, T) };
  const mean = args.F + argument(ARGUMENTS.Omega, T);
  const dist = Math.hypot(x, y, z);
  const d = Math.atan2(y, x) - mean;
  return { jd, T, t: (jd - epochJd) / 36_525, args, dLon: Math.atan2(Math.sin(d), Math.cos(d)) * DEG, lat: Math.asin(z / dist) * DEG, dist };
}
const all = vectors.rows.map(sample);
const fit = all.filter((_, i) => i % 2 === 0);
const kept = vectors.rows.filter((_, i) => i % 2 === 1);
const spanDays = all.at(-1)!.jd - all[0]!.jd;

const theta = (s: Sample, k: Multiples) => k[0] * s.args.D + k[1] * s.args.M + k[2] * s.args.Mp + k[3] * s.args.F;
const frequency = (k: Multiples) => Math.abs(k[0] * RATE.D + k[1] * RATE.M + k[2] * RATE.Mp + k[3] * RATE.F);
/** Every argument a term may have: F's multiple even in longitude and distance, odd in latitude; one of each ± pair. */
function candidates(oddF: boolean): Multiples[] {
  const out: Multiples[] = [];
  const seen = new Set<string>();
  for (let a = -MULTIPLES.D; a <= MULTIPLES.D; a++)
    for (let b = -MULTIPLES.M; b <= MULTIPLES.M; b++)
      for (let c = -MULTIPLES.Mp; c <= MULTIPLES.Mp; c++)
        for (let e = -MULTIPLES.F; e <= MULTIPLES.F; e++) {
          if (Math.abs(e) % 2 !== (oddF ? 1 : 0)) continue;
          let k: Multiples = [a, b, c, e];
          const first = k.find((x) => x !== 0);
          if (first === undefined) continue;
          if (first < 0) k = k.map((x) => -x) as Multiples;
          const key = k.join(',');
          if (seen.has(key)) continue;
          seen.add(key);
          out.push(k);
        }
  return out;
}

/** Least squares by the normal equations (a handful of unknowns), solved with partial pivoting. */
function leastSquares(rows: number[][], y: number[]): number[] {
  const n = rows[0]!.length;
  const A = Array.from({ length: n }, () => new Array<number>(n + 1).fill(0));
  rows.forEach((f, r) => {
    for (let i = 0; i < n; i++) {
      A[i]![n]! += f[i]! * y[r]!;
      for (let j = 0; j < n; j++) A[i]![j]! += f[i]! * f[j]!;
    }
  });
  for (let i = 0; i < n; i++) {
    let p = i;
    for (let j = i + 1; j < n; j++) if (Math.abs(A[j]![i]!) > Math.abs(A[p]![i]!)) p = j;
    [A[i], A[p]] = [A[p]!, A[i]!];
    for (let j = i + 1; j < n; j++) {
      const f = A[j]![i]! / A[i]![i]!;
      for (let k = i; k <= n; k++) A[j]![k]! -= f * A[i]![k]!;
    }
  }
  const x = new Array<number>(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    let s = A[i]![n]!;
    for (let k = i + 1; k < n; k++) s -= A[i]![k]! * x[k]!;
    x[i] = s / A[i]![i]!;
  }
  return x;
}

interface Series { mean: [number, number]; terms: [number, number, number, number, number, number][] }

const dotOf = (a: Float64Array, b: Float64Array) => {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += a[i]! * b[i]!;
  return sum;
};

/**
 * A series fitted to what `y` gives of each sample: a constant (and a drift, in longitude only), then
 * terms one at a time, each the one that would explain most of what is left beyond the terms already
 * taken (scored exactly, against them), the simpler argument first where two would explain alike
 * (`SIMPLER`); only terms that turn at least `TURNS` times over the positions' span are offered.
 */
function series(y: (s: Sample) => number, oddF: boolean, tolerance: number, drift: boolean): Series {
  const n = fit.length;
  const column = (f: (s: Sample) => number) => Float64Array.from(fit, f);
  const target = column(y);
  // An orthonormal basis of the columns taken so far, and what is left of the target outside it.
  const basis: Float64Array[] = [];
  const left = Float64Array.from(target);
  const take = (c: Float64Array) => {
    const v = Float64Array.from(c);
    for (let pass = 0; pass < 2; pass++)
      for (const q of basis) {
        const k = dotOf(q, v);
        for (let i = 0; i < n; i++) v[i]! -= k * q[i]!;
      }
    const norm = Math.sqrt(dotOf(v, v));
    if (norm < 1e-9) return;
    for (let i = 0; i < n; i++) v[i]! /= norm;
    basis.push(v);
    const k = dotOf(v, left);
    for (let i = 0; i < n; i++) left[i]! -= k * v[i]!;
  };
  const columns: Float64Array[] = [column(() => 1), ...(drift ? [column((s) => s.t)] : [])];
  columns.forEach(take);
  const chosen: Multiples[] = [];
  const pool = candidates(oddF).filter((k) => frequency(k) * spanDays >= 360 * TURNS);
  const worst = () => Math.max(...Array.from(left, Math.abs));
  while (chosen.length < MOST_TERMS && worst() >= tolerance) {
    // A first look at every candidate, then the best few scored exactly against the basis.
    const looks = pool
      .filter((k) => !chosen.includes(k))
      .map((k) => {
        const sn = column((s) => Math.sin(theta(s, k)));
        const cs = column((s) => Math.cos(theta(s, k)));
        const a = dotOf(sn, left);
        const b = dotOf(cs, left);
        return { k, sn, cs, a, b, rough: (a * a) / dotOf(sn, sn) + (b * b) / dotOf(cs, cs) };
      })
      .sort((p, q) => q.rough - p.rough)
      .slice(0, 40);
    let best: (typeof looks)[number] | null = null;
    let bestGain = -1;
    for (const c of looks) {
      const ps = basis.map((q) => dotOf(q, c.sn));
      const pc = basis.map((q) => dotOf(q, c.cs));
      const ss = dotOf(c.sn, c.sn) - ps.reduce((t, v) => t + v * v, 0);
      const cc = dotOf(c.cs, c.cs) - pc.reduce((t, v) => t + v * v, 0);
      const sc = dotOf(c.sn, c.cs) - ps.reduce((t, v, i) => t + v * pc[i]!, 0);
      const det = ss * cc - sc * sc;
      if (!(det > 1e-12 * ss * cc)) continue;
      const x = (cc * c.a - sc * c.b) / det;
      const z = (ss * c.b - sc * c.a) / det;
      const gain = (x * c.a + z * c.b) * (1 - SIMPLER * c.k.reduce((t, v) => t + Math.abs(v), 0));
      if (gain > bestGain) [best, bestGain] = [c, gain];
    }
    if (!best) break;
    chosen.push(best.k);
    columns.push(best.sn, best.cs);
    take(best.sn);
    take(best.cs);
  }
  if (worst() >= tolerance) throw new Error(`A series came within ${worst()} of Horizons' positions, not ${tolerance}`);
  // The sizes, by least squares on the columns taken.
  const coef = leastSquares(
    fit.map((_, i) => columns.map((c) => c[i]!)),
    Array.from(target),
  );
  const base = drift ? 2 : 1;
  const digits = tolerance >= 1 ? 4 : 8;
  return {
    mean: [round(coef[0]!, digits), drift ? round(coef[1]!, digits) : 0],
    terms: chosen.map((k, i) => [...k, round(coef[base + 2 * i]!, digits), round(coef[base + 1 + 2 * i]!, digits)] as [number, number, number, number, number, number]),
  };
}

const longitude = series((s) => s.dLon, false, TOLERANCE.lon, true);
const latitude = series((s) => s.lat, true, TOLERANCE.lat, false);
const distance = series((s) => s.dist, false, TOLERANCE.dist, false);

// ---------------------------------------------------------------- eclipses (NASA)

interface Eclipse {
  kind: 'solar' | 'lunar';
  /** The date and Terrestrial Dynamical Time of greatest eclipse, as the table writes them, and its Julian date (TD). */
  date: string;
  td: string;
  jd: number;
  type: string;
  saros: number;
  magnitude: number;
  /** The table's durations as it writes them (`06m23s`; a lunar eclipse's partial phases, then its totality), or null. */
  duration: string | null;
  /** Where it is seen, and for a central eclipse of the Sun the path's countries (`Total: Mexico, c US, e Canada`), as the table writes them. */
  regions: string;
  path: string | null;
  source: string;
}
const MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const cells = (row: string) =>
  [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((m) =>
    m[1]!
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&amp;/g, '&')
      .replace(/[ \t]+/g, ' ')
      .trim(),
  );
const eclipses: Eclipse[] = [];
const pages: Record<string, string> = {};
const decades = manifest.eclipseDecades ?? [];
if (!decades.length) throw new Error('No eclipse decades in the manifest');
for (const decade of decades) {
  for (const kind of ['solar', 'lunar'] as const) {
    const file = `nasa-eclipses-${kind}-${decade}.html`;
    const html = readFileSync(resolve(dir, file), 'utf8');
    const url = `https://eclipse.gsfc.nasa.gov/${kind === 'solar' ? 'SE' : 'LE'}decade/${kind === 'solar' ? 'SE' : 'LE'}decade${decade}.html`;
    pages[url] = plainText(html);
    for (const chunk of html.split(/<tr[^>]*>/i).slice(1)) {
      const c = cells(chunk.split(/<\/tr>/i)[0]!);
      const d = /^(\d{4}) ([A-Z][a-z]{2}) (\d{2})$/.exec(c[0] ?? '');
      const t = /^(\d{2}):(\d{2}):(\d{2})$/.exec(c[1] ?? '');
      if (!d || !t || c.length < 7) continue;
      const month = MONTH.indexOf(d[2]!);
      // The table's own time, read as written (one gives 60 seconds: the minute after).
      const jd = Date.UTC(Number(d[1]), month, Number(d[3]), Number(t[1]), Number(t[2]), Number(t[3])) / 86_400_000 + 2_440_587.5;
      if (jd < epochJd - 730) continue;
      const [regions, ...rest] = c[6]!.split('\n').map((x) => x.trim()).filter(Boolean);
      const path = /^\[(.*)\]$/.exec(rest.join(' '))?.[1]?.trim() ?? null;
      eclipses.push({
        kind,
        date: `${d[1]}-${String(month + 1).padStart(2, '0')}-${d[3]}`,
        td: c[1]!,
        jd: round(jd, 6),
        type: c[2]!,
        saros: Number(c[3]),
        magnitude: Number(c[4]),
        duration: c[5] === '-' ? null : c[5]!.replace(/\s+/g, ' '),
        regions: regions!,
        path,
        source: url,
      });
    }
  }
}
eclipses.sort((a, b) => a.jd - b.jd);

// ---------------------------------------------------------------- for the tests

const beyond = horizons('jpl-horizons-luna-beyond.json').rows;
const lit = horizons('jpl-horizons-luna-lit.json').rows.map((r) => [r[0]!, r[1]!]);
const phases: [number, string][] = [];
for (const f of readdirSync(dir).filter((n) => /^usno-moon-phases-\d{4}\.json$/.test(n)).sort()) {
  const data = JSON.parse(readFileSync(resolve(dir, f), 'utf8')) as { phasedata?: { year: number; month: number; day: number; time: string; phase: string }[] };
  for (const p of data.phasedata ?? []) {
    const [h, m] = p.time.split(':').map(Number);
    phases.push([round(Date.UTC(p.year, p.month - 1, p.day, h!, m!) / 86_400_000 + 2_440_587.5, 6), p.phase]);
  }
}
if (!phases.length) throw new Error("No USNO phases in the snapshot");

const sources = {
  horizons: { label: 'JPL Horizons', url: 'https://ssd.jpl.nasa.gov/horizons/', retrieved: date },
  arguments: { label: 'IERS Conventions (2010), from Simon et al. (1994)', url: 'https://iers-conventions.obspm.fr/' },
  eclipses: { label: 'NASA Eclipse Web Site (Fred Espenak, NASA GSFC)', url: 'https://eclipse.gsfc.nasa.gov/eclipse.html', retrieved: date },
};
writeFileSync(
  resolve(root, 'src/data/generated/lunar.json'),
  JSON.stringify(
    {
      generatedBy: 'scripts/lunar-process.ts',
      retrieved: date,
      epochJd,
      span: [all[0]!.jd, all.at(-1)!.jd],
      sources,
      description:
        'Earth’s Moon: where it is from Earth’s centre (J2000 ecliptic), reckoned from JPL Horizons’ positions of it every twelve hours from two years before the snapshot to four after: its mean longitude (F + Ω) and the four fundamental arguments D, M, M′ and F (IERS Conventions 2010, from Simon et al. 1994; arcseconds, T in Julian centuries of TDB from J2000), and in longitude, latitude (degrees) and distance (km) a constant and a drift (per Julian century from the snapshot’s day) and periodic terms, each [multiples of D, M, M′, F, sine, cosine]; with Horizons’ Earth/Moon mass ratio and the Moon’s radius (km). And NASA’s eclipses of the Sun and the Moon from two years before the snapshot, as Fred Espenak’s decade tables give them (dates and times are Terrestrial Dynamical Time).',
      earthMoonMassRatio: massRatio,
      radiusKm,
      arguments: ARGUMENTS,
      longitude,
      latitude,
      distance,
      eclipses,
    },
    null,
    1,
  ) + '\n',
);
writeFileSync(
  resolve(root, 'src/data/generated/lunar-checks.json'),
  JSON.stringify({
    generatedBy: 'scripts/lunar-process.ts',
    retrieved: date,
    description:
      'For the tests: JPL Horizons’ positions of the Moon from Earth’s centre (J2000 ecliptic, km; [Julian date TDB, x, y, z]) every twelve hours between those reckoned from, and every ten days for ten years after them; Horizons’ percentage of the Moon lit, daily ([Julian date UT, %]); the US Naval Observatory’s times of the Moon’s phases ([Julian date UT, phase]); and the text of NASA’s eclipse tables, by page.',
    positions: kept.map((r) => [r[0], round(r[1]!, 1), round(r[2]!, 1), round(r[3]!, 1)]),
    beyond: beyond.map((r) => [r[0], round(r[1]!, 1), round(r[2]!, 1), round(r[3]!, 1)]),
    lit,
    phases,
    pages,
  }) + '\n',
);
console.log(
  `Moon ${date}: ${longitude.terms.length} terms in longitude, ${latitude.terms.length} in latitude, ${distance.terms.length} in distance, from ${fit.length} of Horizons' positions; ${eclipses.filter((e) => e.kind === 'solar').length} eclipses of the Sun and ${eclipses.filter((e) => e.kind === 'lunar').length} of the Moon; ${phases.length} USNO phases and ${lit.length} lit fractions kept to test against.`,
);
