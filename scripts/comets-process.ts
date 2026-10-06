/**
 * Turns the comets the sky snapshot fetched (scripts/sky-fetch.ts: data/snapshot/orbits/<date>/) into
 * the game's comets, offline and deterministically (docs/ASTRONOMY_SOURCES.md, *Comets*). Reads the
 * latest dated folder holding Horizons' elements, or the one given.
 *
 * For each comet: JPL's Small-Body Database record gives its name, orbit class, nucleus size (where
 * measured, with the reference) and magnitude parameters; JPL Horizons gives its osculating elements
 * on the snapshot's day (heliocentric, J2000 ecliptic), taken as they are and converted only in
 * units, and its positions every 30 days around that day, kept apart for the tests to check the
 * game's reckoning against.
 *
 *   src/data/generated/comets.json        what the game uses
 *   src/data/generated/comet-checks.json  Horizons' positions, for the guardrails only
 *
 * Usage: node scripts/comets-process.ts [date]
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const orbitsRoot = resolve(root, 'data/snapshot/orbits');
const date = process.argv[2] ?? readdirSync(orbitsRoot).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d) && existsSync(resolve(orbitsRoot, d, 'jpl-horizons-elements-1P.json'))).sort().at(-1);
if (!date) throw new Error('No Horizons comet elements in data/snapshot/orbits');
const dir = resolve(orbitsRoot, date);
const manifest = JSON.parse(readFileSync(resolve(dir, 'manifest.json'), 'utf8')) as { comets: string[] };

interface SbdbRecord {
  object: { des: string; fullname: string; orbit_class: { name: string } };
  phys_par?: { name: string; value: string | null; ref: string | null }[];
}

/** The rows of a Horizons table (between $$SOE and $$EOE), keyed by its column names. */
function horizonsTable(file: string): { solution: string; rows: Record<string, string>[] } {
  const result = (JSON.parse(readFileSync(resolve(dir, file), 'utf8')) as { result: string }).result;
  const start = result.indexOf('$$SOE');
  const end = result.indexOf('$$EOE');
  if (start < 0 || end < 0) throw new Error(`${file}: no table`);
  const before = result.slice(0, start).trimEnd().split('\n');
  // The column names are the last line before the stars that open the table.
  const header = before.filter((l) => l.includes('JDTDB')).at(-1)!;
  const names = header.split(',').map((x) => x.trim()).filter(Boolean);
  const rows = result
    .slice(start + 5, end)
    .trim()
    .split('\n')
    .map((l) => l.split(',').map((x) => x.trim()))
    .map((cells) => Object.fromEntries(names.map((n, i) => [n, cells[i]!])));
  const solution = /Target body name:.*\{source:\s*([^}]+)\}/.exec(result)?.[1]?.trim() ?? '';
  return { solution, rows };
}

const num = (x: string | null | undefined): number | null => (x === null || x === undefined || x.trim() === '' || !Number.isFinite(Number(x)) ? null : Number(x));
const round = (x: number, d: number) => Number(x.toFixed(d));

const comets = [];
const checks: Record<string, [number, number, number, number][]> = {};
let epochJd: number | null = null;
for (const des of manifest.comets) {
  const sbdb = JSON.parse(readFileSync(resolve(dir, `jpl-sbdb-${des}.json`), 'utf8')) as SbdbRecord;
  const phys = new Map((sbdb.phys_par ?? []).map((p) => [p.name, p]));
  const el = horizonsTable(`jpl-horizons-elements-${des}.json`);
  const e0 = el.rows[0]!;
  const at = Number(e0.JDTDB);
  epochJd ??= at;
  if (at !== epochJd) throw new Error(`${des}: elements on ${at}, not ${epochJd}`);
  const vec = horizonsTable(`jpl-horizons-vectors-${des}.json`);
  if (vec.solution !== el.solution) throw new Error(`${des}: elements from ${el.solution}, positions from ${vec.solution}`);
  checks[des] = vec.rows.map((r) => [Number(r.JDTDB), round(Number(r.X), 8), round(Number(r.Y), 8), round(Number(r.Z), 8)]);
  const diameter = phys.get('diameter');
  comets.push({
    id: `comet-${des.toLowerCase()}`,
    designation: des,
    name: sbdb.object.fullname.trim(),
    // JPL's class, in sentence case (its trailing * marks a class assigned by the Tisserand parameter).
    orbitClass: sbdb.object.orbit_class.name.replace(/\*$/, '').replace(/ Comet$/, ' comet'),
    solution: el.solution,
    elements: {
      e: Number(e0.EC),
      qAu: Number(e0.QR),
      aAu: Number(e0.A),
      inclinationDeg: Number(e0.IN),
      nodeDeg: Number(e0.OM),
      periDeg: Number(e0.W),
      perihelionJd: Number(e0.Tp),
      motionDegPerDay: Number(e0.N),
      periodDays: Number(e0.PR),
    },
    diameterKm: num(diameter?.value),
    diameterRef: num(diameter?.value) !== null ? (diameter?.ref ?? null) : null,
    m1: num(phys.get('M1')?.value),
    k1: num(phys.get('K1')?.value),
  });
}

const sources = {
  sbdb: { label: 'JPL Small-Body Database', url: 'https://ssd.jpl.nasa.gov/tools/sbdb_lookup.html', retrieved: date },
  horizons: { label: 'JPL Horizons', url: 'https://ssd.jpl.nasa.gov/horizons/', retrieved: date },
};
writeFileSync(
  resolve(root, 'src/data/generated/comets.json'),
  JSON.stringify(
    {
      generatedBy: 'scripts/comets-process.ts',
      retrieved: date,
      epochJd,
      sources,
      description:
        'Periodic comets: names, orbit classes, nucleus diameters (km, with the reference) and total-magnitude parameters M1 and K1 from the JPL Small-Body Database; osculating elements on the snapshot’s day from JPL Horizons (heliocentric, J2000 ecliptic: e, q and a in au, i, Ω and ω in degrees, Tp as a Julian date, n in degrees a day, the period in days).',
      comets,
    },
    null,
    2,
  ) + '\n',
);
writeFileSync(
  resolve(root, 'src/data/generated/comet-checks.json'),
  JSON.stringify({ generatedBy: 'scripts/comets-process.ts', retrieved: date, source: sources.horizons, description: 'JPL Horizons’ heliocentric positions of the comets (J2000 ecliptic, au) every 30 days around the snapshot: [Julian date, x, y, z].', positions: checks }) + '\n',
);
console.log(`Comets ${date}: ${comets.length} comets, elements on JD ${epochJd}, ${Object.values(checks).reduce((n, c) => n + c.length, 0)} Horizons positions to test against.`);
