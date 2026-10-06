/**
 * Turns the orbits the sky snapshot fetched (scripts/sky-fetch.ts: data/snapshot/orbits/<date>/) into
 * the game's binary orbits, offline and deterministically (docs/ASTRONOMY_SOURCES.md, *Binary
 * orbits*). Reads the latest dated folder, or the one given.
 *
 * The Sixth Catalog of Orbits of Visual Binary Stars (ORB6) is read in full; the game takes the
 * orbits of the pairs listed below (its own two stars, by the catalogue's WDS designation and
 * name), with every element and its published error as the catalogue gives it, converted only in
 * units (periods to years, semi-major axes to arcseconds, times of periastron to Julian dates), and
 * the catalogue's own ephemeris for each, which the game's reckoning is tested against. A pair the
 * catalogue grades worse than 4 (preliminary), or whose elements imply a total mass no pair of these
 * stars could have, is left out, and said so in the output.
 *
 *   src/data/generated/orbits.json        what the game uses
 *   src/data/generated/orbit-checks.json  the catalogue's own ephemeris, for the guardrails only
 *
 * Usage: node scripts/orbits-process.ts [date]
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const orbitsRoot = resolve(root, 'data/snapshot/orbits');
const date = process.argv[2] ?? readdirSync(orbitsRoot).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d) && existsSync(resolve(orbitsRoot, d, 'orb6-orbits.txt'))).sort().at(-1);
if (!date) throw new Error('No ORB6 in data/snapshot/orbits');
const dir = resolve(orbitsRoot, date);

/**
 * The game's pairs with catalogued orbits: its two stars (the secondary's place is reckoned
 * relative to the primary) and the catalogue's WDS designation and name. `flip`: the game names
 * the pair the other way round from the catalogue (its primary is the catalogue's secondary).
 */
const PAIRS: readonly { primary: string; secondary: string; wds: string; name: string; flip?: true }[] = [
  { primary: 'alpha-centauri-a', secondary: 'alpha-centauri-b', wds: '14396-6050', name: 'RHD   1AB' },
  { primary: 'sirius-a', secondary: 'sirius-b', wds: '06451-1643', name: 'AGC   1AB' },
  { primary: 'bl-ceti', secondary: 'uv-ceti', wds: '01388-1758', name: 'LDS 838' },
  { primary: '61-cygni-a', secondary: '61-cygni-b', wds: '21069+3845', name: 'STF2758AB' },
  { primary: 'procyon-a', secondary: 'procyon-b', wds: '07393+0514', name: 'SHB   1AB' },
  { primary: 'struve-2398-a', secondary: 'struve-2398-b', wds: '18428+5938', name: 'STF2398AB' },
  { primary: 'kruger-60-a', secondary: 'kruger-60-b', wds: '22280+5742', name: 'KR   60AB' },
  { primary: 'ross-614-a', secondary: 'ross-614-b', wds: '06293-0248', name: 'B  2601AB' },
  { primary: '40-eridani-b', secondary: '40-eridani-c', wds: '04153-0739', name: 'STF 518BC' },
  { primary: '70-ophiuchi-a', secondary: '70-ophiuchi-b', wds: '18055+0230', name: 'STF2272AB' },
  { primary: 'achird-a', secondary: 'achird-b', wds: '00491+5749', name: 'STF  60AB' },
  { primary: 'gj-338-a', secondary: 'gj-338-b', wds: '09144+5241', name: 'STF1321AB' },
  { primary: 'xi-bootis-a', secondary: 'xi-bootis-b', wds: '14514+1906', name: 'STF1888AB' },
  { primary: 'gj-667-a', secondary: 'gj-667-b', wds: '17190-3459', name: 'MLO   4AB' },
  { primary: '36-ophiuchi-a', secondary: '36-ophiuchi-b', wds: '17153-2636', name: 'SHJ 243AB' },
  // The game's gj-66-a is the catalogue's B (GJ 66 B), and its gj-66-b the catalogue's A.
  { primary: 'gj-66-a', secondary: 'gj-66-b', wds: '01398-5612', name: 'DUN   5', flip: true },
  { primary: 'luhman-16-a', secondary: 'luhman-16-b', wds: '10493-5319', name: 'LUH  16' },
  { primary: 'ei-cancri-a', secondary: 'ei-cancri-b', wds: '08582+1945', name: 'LDS3836' },
  { primary: 'scholzs-star-a', secondary: 'scholzs-star-b', wds: '07200-0847', name: 'BUG  17' },
  { primary: 'mu2-herculis-a', secondary: 'mu2-herculis-b', wds: '17465+2743', name: 'AC    7BC' },
  { primary: 'fl-virginis-a', secondary: 'fl-virginis-b', wds: '12335+0901', name: 'REU   1' },
  { primary: 'gj-2005-b', secondary: 'gj-2005-c', wds: '00247-2653', name: 'LEI   1BC' },
  { primary: 'gj-896-a', secondary: 'gj-896-b', wds: '23317+1956', name: 'WIR   1AB' },
];

/** The catalogue's grades (its format notes). */
const GRADES = [1, 2, 3, 4] as const;
/** A pair's total mass from its elements (Kepler's third law), in solar masses, must lie in this range. */
const MASS = [0.03, 6] as const;

/** A fixed-width field, by its 1-based first and last columns. */
const field = (line: string, from: number, to: number) => line.slice(from - 1, to).trim();
const numOrNull = (s: string): number | null => (s === '' || s === '.' ? null : Number.isFinite(Number(s)) ? Number(s) : null);

/** Julian date from a Besselian year. */
const besselToJd = (b: number) => 2415020.31352 + (b - 1900) * 365.242198781;

interface Row {
  wds: string;
  name: string;
  hip: number | null;
  periodYears: number;
  periodError: number | null;
  axisArcsec: number;
  axisError: number | null;
  inclinationDeg: number;
  inclinationError: number | null;
  nodeDeg: number;
  nodeFlag: string;
  nodeError: number | null;
  periastronJd: number;
  periastronError: number | null;
  eccentricity: number;
  eccentricityError: number | null;
  argumentDeg: number;
  argumentFlag: string;
  argumentError: number | null;
  equinox: number | null;
  lastObservation: number | null;
  grade: number;
  reference: string;
}

function parseOrbit(line: string): Row | null {
  const p = numOrNull(field(line, 82, 92));
  const a = numOrNull(field(line, 106, 114));
  const t0 = numOrNull(field(line, 163, 174));
  const e = numOrNull(field(line, 188, 195));
  const i = numOrNull(field(line, 126, 133));
  const node = numOrNull(field(line, 144, 151));
  const w = numOrNull(field(line, 206, 213));
  const grade = numOrNull(field(line, 234, 234));
  if (p === null || a === null || t0 === null || e === null || i === null || node === null || w === null || grade === null) return null;
  const pUnit = line[92] ?? 'y';
  const aUnit = line[114] ?? 'a';
  const tUnit = line[174] ?? 'y';
  const years = (v: number) => (pUnit === 'd' ? v / 365.25 : pUnit === 'c' ? v * 100 : v);
  const arcsec = (v: number) => (aUnit === 'm' ? v / 1000 : aUnit === 'M' ? v * 60 : v);
  const jd = (v: number) => (tUnit === 'd' ? v + 2_400_000 : tUnit === 'm' ? v + 2_400_000.5 : tUnit === 'c' ? besselToJd(v * 100) : besselToJd(v));
  const err = (s: string, f: (v: number) => number) => {
    const v = numOrNull(s);
    return v === null ? null : f(v);
  };
  return {
    wds: field(line, 20, 29),
    name: line.slice(30, 44).trimEnd(),
    hip: numOrNull(field(line, 59, 64)),
    periodYears: years(p),
    periodError: err(field(line, 95, 104), years),
    axisArcsec: arcsec(a),
    axisError: err(field(line, 117, 124), arcsec),
    inclinationDeg: i,
    inclinationError: numOrNull(field(line, 135, 142)),
    nodeDeg: node,
    nodeFlag: field(line, 152, 152),
    nodeError: numOrNull(field(line, 154, 161)),
    periastronJd: jd(t0),
    // An error in T0 in years or centuries is a span of time: in days it is the same span.
    periastronError: err(field(line, 177, 186), (v) => (tUnit === 'd' || tUnit === 'm' ? v : tUnit === 'c' ? v * 100 * 365.25 : v * 365.25)),
    eccentricity: e,
    eccentricityError: numOrNull(field(line, 197, 204)),
    argumentDeg: w,
    argumentFlag: field(line, 214, 214),
    argumentError: numOrNull(field(line, 215, 222)),
    equinox: numOrNull(field(line, 224, 227)),
    lastObservation: numOrNull(field(line, 229, 232)),
    grade,
    reference: field(line, 238, 245),
  };
}

const orbitLines = readFileSync(resolve(dir, 'orb6-orbits.txt'), 'latin1').split(/\r?\n/);
const ephemLines = existsSync(resolve(dir, 'orb6-ephem.txt')) ? readFileSync(resolve(dir, 'orb6-ephem.txt'), 'latin1').split(/\r?\n/) : [];
const epochHeader = ephemLines.find((l) => /^\s+\d{4}\.0\s+\d{4}\.0/.test(l));
const ephemEpochs = epochHeader ? (epochHeader.match(/\d{4}\.0/g) ?? []).map(Number) : [];

const astrometry = JSON.parse(readFileSync(resolve(root, 'src/data/generated/astrometry.json'), 'utf8')) as { stars: { id: string; systemId: string; parallaxMas: number }[] };
const starOf = new Map(astrometry.stars.map((s) => [s.id, s]));

const pairs: unknown[] = [];
const checks: Record<string, { year: number; thetaDeg: number; rhoArcsec: number }[]> = {};
const left: { pair: string; why: string }[] = [];
for (const want of PAIRS) {
  const label = `${want.primary}/${want.secondary}`;
  const line = orbitLines.find((l) => field(l, 20, 29) === want.wds && l.slice(30, 44).trimEnd() === want.name);
  const row = line ? parseOrbit(line) : null;
  const a = starOf.get(want.primary);
  const b = starOf.get(want.secondary);
  if (!row) {
    left.push({ pair: label, why: `no orbit for ${want.wds} ${want.name} in the catalogue` });
    continue;
  }
  if (!a || !b || a.systemId !== b.systemId) {
    left.push({ pair: label, why: 'not two stars of one system in the game' });
    continue;
  }
  if (!(GRADES as readonly number[]).includes(row.grade)) {
    left.push({ pair: label, why: `graded ${row.grade} (the game takes 1 to 4)` });
    continue;
  }
  const axisAu = row.axisArcsec / (a.parallaxMas / 1000);
  const mass = axisAu ** 3 / row.periodYears ** 2;
  if (!(mass >= MASS[0] && mass <= MASS[1])) {
    left.push({ pair: label, why: `its elements imply ${mass.toFixed(2)} solar masses in all, which no pair of these stars has` });
    continue;
  }
  const ephem = ephemLines.find((l) => l.slice(0, 10).trim() === want.wds && l.slice(11, 25).trimEnd() === want.name);
  const predicted = ephem
    ? (() => {
        const parts = ephem.slice(25).trim().split(/\s+/);
        const values = parts.slice(2, 12).map(Number);
        return ephemEpochs.map((year, k) => ({ year, thetaDeg: values[2 * k]!, rhoArcsec: values[2 * k + 1]! })).filter((x) => Number.isFinite(x.thetaDeg) && Number.isFinite(x.rhoArcsec));
      })()
    : [];
  pairs.push({ primary: want.primary, secondary: want.secondary, systemId: a.systemId, ...(want.flip ? { flip: true } : {}), ...row });
  checks[want.secondary] = predicted;
}

const out = {
  generatedBy: 'scripts/orbits-process.ts',
  retrieved: date,
  source: {
    label: 'Sixth Catalog of Orbits of Visual Binary Stars (ORB6)',
    url: 'http://www.astro.gsu.edu/wds/orb6.html',
    retrieved: date,
  },
  description:
    'Binary orbits from ORB6 for the game’s pairs, as the catalogue gives them: P in years, a in arcseconds, i, Ω and ω in degrees, T (periastron) as a Julian date, with published errors where the catalogue has them. The catalogue’s own ephemeris is in orbit-checks.json.',
  pairs,
  left,
};
writeFileSync(resolve(root, 'src/data/generated/orbits.json'), JSON.stringify(out, null, 2) + '\n');
writeFileSync(
  resolve(root, 'src/data/generated/orbit-checks.json'),
  JSON.stringify({ generatedBy: 'scripts/orbits-process.ts', retrieved: date, source: out.source, description: 'The catalogue’s own ephemeris for each pair, by its secondary: position angle (degrees) and separation (arcseconds) for the years listed.', ephemeris: checks }, null, 2) + '\n',
);
console.log(`ORB6 ${date}: ${pairs.length} pairs, ${left.length} left out.`);
for (const l of left) console.log(`  left out: ${l.pair}: ${l.why}`);
