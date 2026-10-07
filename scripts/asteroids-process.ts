/**
 * Turns the asteroids the sky snapshot fetched (scripts/sky-fetch.ts: data/snapshot/orbits/<date>/)
 * into the game's asteroids, offline and deterministically (docs/ASTRONOMY_SOURCES.md, *Asteroids*).
 * Reads the latest dated folder holding Horizons' asteroid elements, or the one given.
 *
 * For each asteroid: JPL's Small-Body Database record gives its name, orbit class, whether it is a
 * near-Earth asteroid and a potentially hazardous one, its size and shape, rotation, albedo,
 * spectral types and magnitude parameters, each measured one with the reference JPL gives; JPL
 * Horizons gives its osculating elements on the snapshot's day (heliocentric, J2000 ecliptic), and
 * again after a close pass of Earth that changes its orbit, taken as they are and converted only in
 * units; JPL's close-approach data gives its passes of Earth within 0.05 AU. Round a pass nearer than
 * `PATH_AU`, Horizons' path from Earth's centre is kept (hourly while nearer than `HOURLY_AU`, six-
 * hourly beyond). Horizons' heliocentric positions every 30 days around the snapshot's day are kept
 * apart for the tests to check the game's reckoning against.
 *
 *   src/data/generated/asteroids.json        what the game uses
 *   src/data/generated/asteroid-checks.json  Horizons' positions, for the guardrails only
 *
 * Usage: node scripts/asteroids-process.ts [date]
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const orbitsRoot = resolve(root, 'data/snapshot/orbits');
const date = process.argv[2] ?? readdirSync(orbitsRoot).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d) && existsSync(resolve(orbitsRoot, d, 'jpl-horizons-elements-a1.json'))).sort().at(-1);
if (!date) throw new Error('No Horizons asteroid elements in data/snapshot/orbits');
const dir = resolve(orbitsRoot, date);
const manifest = JSON.parse(readFileSync(resolve(dir, 'manifest.json'), 'utf8')) as { asteroids: string[]; asteroidAfter: Record<string, string[]> };

/** A pass of Earth nearer than this (AU) keeps Horizons' path from Earth's centre; while nearer than `HOURLY_AU`, every hour of it. */
const PATH_AU = 0.01;
const HOURLY_AU = 0.002;

interface SbdbRecord {
  object: { des: string; fullname: string; orbit_class: { code: string; name: string }; neo: boolean; pha: boolean };
  phys_par?: { name: string; value: string | null; ref: string | null }[];
}

/** The rows of a Horizons table (between $$SOE and $$EOE), keyed by its column names. */
function horizonsTable(file: string): { solution: string; rows: Record<string, string>[] } {
  const result = (JSON.parse(readFileSync(resolve(dir, file), 'utf8')) as { result: string }).result;
  const start = result.indexOf('$$SOE');
  const end = result.indexOf('$$EOE');
  if (start < 0 || end < 0) throw new Error(`${file}: no table`);
  const before = result.slice(0, start).trimEnd().split('\n');
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

const elementsOf = (r: Record<string, string>) => ({
  e: Number(r.EC),
  qAu: Number(r.QR),
  aAu: Number(r.A),
  inclinationDeg: Number(r.IN),
  nodeDeg: Number(r.OM),
  periDeg: Number(r.W),
  perihelionJd: Number(r.Tp),
  motionDegPerDay: Number(r.N),
  periodDays: Number(r.PR),
});

const asteroids = [];
const checks: Record<string, [number, number, number, number][]> = {};
let epochJd: number | null = null;
for (const n of manifest.asteroids) {
  const sbdb = JSON.parse(readFileSync(resolve(dir, `jpl-sbdb-a${n}.json`), 'utf8')) as SbdbRecord;
  const phys = new Map((sbdb.phys_par ?? []).map((p) => [p.name, p]));
  const measured = (name: string) => {
    const p = phys.get(name);
    return p?.value != null && p.value.trim() !== '' ? { value: p.value.trim(), ref: p.ref?.trim() ?? null } : null;
  };
  const el = horizonsTable(`jpl-horizons-elements-a${n}.json`);
  const at = Number(el.rows[0]!.JDTDB);
  epochJd ??= at;
  if (at !== epochJd) throw new Error(`${n}: elements on ${at}, not ${epochJd}`);
  const vec = horizonsTable(`jpl-horizons-vectors-a${n}.json`);
  if (vec.solution !== el.solution) throw new Error(`${n}: elements from ${el.solution}, positions from ${vec.solution}`);
  checks[n] = vec.rows.map((r) => [Number(r.JDTDB), round(Number(r.X), 8), round(Number(r.Y), 8), round(Number(r.Z), 8)]);

  // JPL's close approaches to Earth (within 0.05 AU), and round the nearest ones Horizons' path from Earth's centre.
  const cad = JSON.parse(readFileSync(resolve(dir, `jpl-cad-a${n}.json`), 'utf8')) as { fields?: string[]; data?: string[][] };
  const col = (name: string) => cad.fields?.indexOf(name) ?? -1;
  const approaches = (cad.data ?? []).map((row) => {
    const jd = Number(row[col('jd')]);
    const distAu = Number(row[col('dist')]);
    const pass = {
      jd,
      /** JPL's own date and time of the pass (TDB), as it gives it. */
      when: row[col('cd')]!,
      distAu,
      distMinAu: Number(row[col('dist_min')]),
      distMaxAu: Number(row[col('dist_max')]),
      vRelKms: Number(row[col('v_rel')]),
    };
    if (distAu >= PATH_AU) return pass;
    const file = `jpl-horizons-geo-a${n}-${Math.round(jd)}.json`;
    if (!existsSync(resolve(dir, file))) throw new Error(`${n}: a pass ${distAu} AU from Earth, but no path from Earth's centre (${file})`);
    const geo = horizonsTable(file);
    if (geo.solution !== el.solution) throw new Error(`${n}: elements from ${el.solution}, the pass from ${geo.solution}`);
    const path = geo.rows
      .map((r) => [Number(r.JDTDB), Number(r.X), Number(r.Y), Number(r.Z)] as [number, number, number, number])
      .filter(([, x, y, z]) => Math.hypot(x, y, z) < PATH_AU)
      .filter(([t, x, y, z]) => Math.hypot(x, y, z) < HOURLY_AU || Math.round((t - jd) * 24) % 6 === 0)
      .map(([t, x, y, z]) => [round(t, 6), round(x, 10), round(y, 10), round(z, 10)]);
    return { ...pass, path };
  });

  // After a pass that changes its orbit, Horizons' elements again, from the pass on.
  const later = (manifest.asteroidAfter[n] ?? []).map((on) => {
    const after = horizonsTable(`jpl-horizons-elements-a${n}-${on}.json`);
    const onJd = Number(after.rows[0]!.JDTDB);
    const pass = approaches.filter((a) => a.jd < onJd).at(-1);
    if (!pass) throw new Error(`${n}: elements after ${on}, but no close pass before it`);
    return { fromJd: pass.jd, solution: after.solution, elements: elementsOf(after.rows[0]!) };
  });

  const fullname = sbdb.object.fullname.trim();
  const named = /^(\d+)\s+(.+?)(?:\s+\(([^)]+)\))?$/.exec(fullname);
  if (!named || named[1] !== n) throw new Error(`${n}: not a numbered asteroid (${fullname})`);
  const diameter = measured('diameter');
  asteroids.push({
    id: `asteroid-${n}`,
    number: n,
    name: named[2]!,
    fullname,
    orbitClass: { code: sbdb.object.orbit_class.code, name: sbdb.object.orbit_class.name },
    neo: sbdb.object.neo,
    pha: sbdb.object.pha,
    solution: el.solution,
    elements: elementsOf(el.rows[0]!),
    later,
    diameterKm: diameter ? Number(diameter.value) : null,
    diameterRef: diameter?.ref ?? null,
    extentKm: measured('extent')?.value.replace(/\s*x\s*/g, ' × ') ?? null,
    rotationHours: num(measured('rot_per')?.value),
    albedo: num(measured('albedo')?.value),
    spectral: { tholen: measured('spec_T')?.value ?? null, smass: measured('spec_B')?.value ?? null },
    h: num(measured('H')?.value),
    g: num(measured('G')?.value),
    approaches,
  });
}

const sources = {
  sbdb: { label: 'JPL Small-Body Database', url: 'https://ssd.jpl.nasa.gov/tools/sbdb_lookup.html', retrieved: date },
  horizons: { label: 'JPL Horizons', url: 'https://ssd.jpl.nasa.gov/horizons/', retrieved: date },
  cad: { label: 'JPL close-approach data', url: 'https://cneos.jpl.nasa.gov/ca/', retrieved: date },
};
writeFileSync(
  resolve(root, 'src/data/generated/asteroids.json'),
  JSON.stringify(
    {
      generatedBy: 'scripts/asteroids-process.ts',
      retrieved: date,
      epochJd,
      sources,
      description:
        'Named asteroids: names, orbit classes, near-Earth and potentially hazardous flags, diameters (km, with the reference), shapes, rotation periods (hours), albedos, spectral types (Tholen and SMASSII) and magnitude parameters H and G from the JPL Small-Body Database; osculating elements on the snapshot’s day, and after a close pass that changes the orbit, from JPL Horizons (heliocentric, J2000 ecliptic: e, q and a in au, i, Ω and ω in degrees, Tp as a Julian date, n in degrees a day, the period in days); passes of Earth within 0.05 AU from JPL’s close-approach data (Julian date, JPL’s date and time in TDB, nominal, least and greatest distance in au, speed relative to Earth in km/s), with, for a pass nearer than 0.01 AU, Horizons’ path from Earth’s centre (J2000 ecliptic, au: [Julian date, x, y, z]).',
      asteroids,
    },
    null,
    2,
  ) + '\n',
);
writeFileSync(
  resolve(root, 'src/data/generated/asteroid-checks.json'),
  JSON.stringify({ generatedBy: 'scripts/asteroids-process.ts', retrieved: date, source: sources.horizons, description: 'JPL Horizons’ heliocentric positions of the asteroids (J2000 ecliptic, au) every 30 days around the snapshot: [Julian date, x, y, z].', positions: checks }) + '\n',
);
const passes = asteroids.flatMap((a) => a.approaches);
console.log(
  `Asteroids ${date}: ${asteroids.length} asteroids, elements on JD ${epochJd}, ${passes.length} close passes of Earth (${passes.filter((p) => 'path' in p).length} with a path from Earth's centre), ${Object.values(checks).reduce((k, c) => k + c.length, 0)} Horizons positions to test against.`,
);
