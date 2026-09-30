/**
 * Fetches a dated archive snapshot of the real sky around Sol (docs/ASTRONOMY_SOURCES.md). This is
 * the only step that needs the network; it runs on GitHub's runners (.github/workflows/sky-snapshot.yml)
 * because the development container cannot reach the archives. It only saves raw responses:
 *
 *   data/snapshot/raw/<date>/<label>.json|.txt   one file per query, exactly as the archive sent it
 *   data/snapshot/raw/<date>/manifest.json       what was asked, of whom, and whether it worked
 *
 * scripts/sky-process.ts turns them into the game's inputs offline.
 *
 * What is asked:
 *   - SIMBAD: every star in the game by its catalogue identifiers (HIP, Gliese, Gaia DR3, names);
 *     everything with a parallax of at least 120 mas (within about 27 light-years), with its
 *     identifiers, fluxes and place in multiple systems (h_link).
 *   - ESA Gaia DR3: astrometry by source_id for every Gaia DR3 identifier SIMBAD gives, and cone
 *     searches around the brightest stars (which lack usable Gaia DR3 astrometry).
 *   - VizieR I/311/hip2 (Hipparcos, new reduction): by HIP number, and every star with Plx >= 120 mas.
 *   - NASA Exoplanet Archive: every confirmed planet (pscomppars) within 8.3 pc.
 *   - JPL: the Keplerian elements for approximate planet positions (1800-2050), and Horizons
 *     heliocentric vectors for the eight planets at three dates, to test the elements against.
 *
 * Usage: node scripts/sky-fetch.ts   (then node scripts/sky-process.ts)
 * Behind an HTTPS proxy, run with NODE_USE_ENV_PROXY=1 so Node's fetch honours HTTPS_PROXY.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const today = new Date().toISOString().slice(0, 10);
const rawDir = resolve(root, 'data/snapshot/raw', today);
mkdirSync(rawDir, { recursive: true });

const TAP = {
  gaia: 'https://gea.esac.esa.int/tap-server/tap',
  simbad: 'https://simbad.cds.unistra.fr/simbad/sim-tap',
  vizier: 'https://tapvizier.cds.unistra.fr/TAPVizieR/tap',
  nasa: 'https://exoplanetarchive.ipac.caltech.edu/TAP',
} as const;

/** Parallax floor for the neighbourhood (mas): 120 mas is about 27.2 light-years. */
const NEIGHBOURHOOD_PLX = 120;
/** Distance ceiling for planets (pc): 8.3 pc is about 27.1 light-years. */
const PLANET_DIST_PC = 8.3;

type Row = Record<string, unknown>;

interface ManifestEntry {
  label: string;
  service: string;
  query: string;
  ok: boolean;
  rows?: number;
  error?: string;
  file: string;
  ms: number;
}
const manifest: ManifestEntry[] = [];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function rowsOf(text: string): Row[] {
  const json = JSON.parse(text) as { metadata?: { name: string }[]; data?: unknown[][] } | Row[];
  if (Array.isArray(json)) return json;
  const cols = (json.metadata ?? []).map((m) => m.name);
  return (json.data ?? []).map((r) => Object.fromEntries(cols.map((c, i) => [c, r[i]])));
}

async function httpText(url: string, init?: RequestInit, attempts = 3): Promise<{ status: number; text: string; headers: Headers }> {
  let last: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url, { ...init, signal: AbortSignal.timeout(180_000) });
      return { status: res.status, text: await res.text(), headers: res.headers };
    } catch (err) {
      last = err;
      await sleep(2_000 * 2 ** i);
    }
  }
  throw last instanceof Error ? last : new Error(String(last));
}

/** A synchronous TAP query; on failure, the same query as an asynchronous job. */
async function tap(service: keyof typeof TAP, query: string, label: string, opts: { nasa?: boolean } = {}): Promise<Row[]> {
  const started = Date.now();
  const file = `${label}.json`;
  const params: Record<string, string> = opts.nasa ? { query, format: 'json' } : { REQUEST: 'doQuery', LANG: 'ADQL', FORMAT: 'json', QUERY: query };
  const entry: ManifestEntry = { label, service, query, ok: false, file, ms: 0 };
  manifest.push(entry);
  try {
    let text: string;
    const sync = await httpText(`${TAP[service]}/sync`, { method: 'POST', body: new URLSearchParams(params), headers: { Accept: 'application/json' } });
    if (sync.status >= 200 && sync.status < 300) text = sync.text;
    else {
      console.log(`  ${label}: sync HTTP ${sync.status}, trying an async job`);
      writeFileSync(resolve(rawDir, `${label}.sync-error.txt`), sync.text);
      text = await tapAsync(service, params, label);
    }
    writeFileSync(resolve(rawDir, file), text);
    const rows = rowsOf(text);
    Object.assign(entry, { ok: true, rows: rows.length, ms: Date.now() - started });
    console.log(`  ${label}: ${rows.length} rows (${Date.now() - started} ms)`);
    return rows;
  } catch (err) {
    Object.assign(entry, { error: err instanceof Error ? err.message : String(err), ms: Date.now() - started });
    console.log(`  ${label}: FAILED ${entry.error}`);
    return [];
  } finally {
    await sleep(400);
  }
}

async function tapAsync(service: keyof typeof TAP, params: Record<string, string>, label: string): Promise<string> {
  const submit = await fetch(`${TAP[service]}/async`, { method: 'POST', body: new URLSearchParams({ ...params, PHASE: 'RUN' }), redirect: 'manual' });
  const job = submit.headers.get('location');
  if (!job) throw new Error(`${label}: async submit gave HTTP ${submit.status} and no job URL`);
  const jobUrl = new URL(job, TAP[service]).toString();
  for (let i = 0; i < 90; i++) {
    await sleep(Math.min(10_000, 1_000 * (i + 1)));
    const phase = (await httpText(`${jobUrl}/phase`)).text.trim();
    if (phase === 'COMPLETED') return (await httpText(`${jobUrl}/results/result`)).text;
    if (phase === 'ERROR' || phase === 'ABORTED') throw new Error(`${label}: async job ${phase}: ${(await httpText(`${jobUrl}/error`)).text.slice(0, 400)}`);
  }
  throw new Error(`${label}: async job did not finish`);
}

async function getText(url: string, label: string, ext = 'txt'): Promise<string | null> {
  const started = Date.now();
  const file = `${label}.${ext}`;
  const entry: ManifestEntry = { label, service: new URL(url).host, query: url, ok: false, file, ms: 0 };
  manifest.push(entry);
  try {
    const res = await httpText(url);
    writeFileSync(resolve(rawDir, file), res.text);
    if (res.status < 200 || res.status >= 300) throw new Error(`HTTP ${res.status}: ${res.text.slice(0, 200)}`);
    Object.assign(entry, { ok: true, ms: Date.now() - started });
    console.log(`  ${label}: ${res.text.length} bytes`);
    return res.text;
  } catch (err) {
    Object.assign(entry, { error: err instanceof Error ? err.message : String(err), ms: Date.now() - started });
    console.log(`  ${label}: FAILED ${entry.error}`);
    return null;
  } finally {
    await sleep(300);
  }
}

const quote = (ids: Iterable<string>) => [...ids].map((id) => `'${id.replace(/'/g, "''")}'`).join(', ');
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : null);
const chunks = <T>(list: T[], size: number): T[][] => Array.from({ length: Math.ceil(list.length / size) }, (_, i) => list.slice(i * size, (i + 1) * size));

// ---------------------------------------------------------------- the game's stars

interface GameStar {
  id: string;
  name: string;
  catalogIds: { hip?: string; gliese?: string; gaiaDr3?: string; simbad?: string };
}

function gameStars(): GameStar[] {
  const out: GameStar[] = [];
  for (const file of ['data/provisional/astrometry-input.json', 'data/provisional/catalog-astrometry-input.json']) {
    const path = resolve(root, file);
    if (!existsSync(path)) continue;
    for (const s of (JSON.parse(readFileSync(path, 'utf8')) as { stars: GameStar[] }).stars) out.push(s);
  }
  return out;
}

/** SIMBAD identifiers to try for a star: its HIP and Gliese numbers in SIMBAD's spelling, its Gaia id and names. */
function candidateIds(s: GameStar): string[] {
  const ids = new Set<string>();
  const c = s.catalogIds;
  if (c.hip) ids.add(c.hip.replace(/^HIP\s*/, 'HIP '));
  if (c.gaiaDr3) ids.add(c.gaiaDr3.replace(/^Gaia DR3\s*/, 'Gaia DR3 '));
  if (c.gliese) {
    const m = /^(?:Gl|GJ)\s*([0-9.]+)\s*([A-Z]?)$/i.exec(c.gliese.trim());
    if (m) {
      ids.add(m[2] ? `GJ ${m[1]} ${m[2]}` : `GJ ${m[1]}`);
      ids.add(m[2] ? `GJ ${m[1]}${m[2]}` : `GJ ${m[1]}`);
      if (m[2]) ids.add(`GJ ${m[1]}`);
    }
  }
  if (c.simbad) {
    ids.add(c.simbad);
    ids.add(`* ${c.simbad}`);
    ids.add(`NAME ${c.simbad}`);
  }
  ids.add(s.name);
  ids.add(`NAME ${s.name}`);
  return [...ids];
}

// ---------------------------------------------------------------- main

async function main(): Promise<void> {
  console.log(`Sky snapshot ${today} → ${rawDir}`);
  const stars = gameStars();
  console.log(`The game has ${stars.length} stars.`);

  // SIMBAD: the game's stars by identifier.
  const gameIds = stars.flatMap(candidateIds);
  const gameRows = await tap(
    'simbad',
    `SELECT i.id AS query_id, b.oid, b.main_id, b.otype, b.ra, b.dec, b.coo_bibcode, b.plx_value, b.plx_err, b.plx_bibcode, b.pmra, b.pmdec, b.pm_bibcode, b.rvz_radvel, b.sp_type, b.sp_bibcode FROM ident AS i JOIN basic AS b ON i.oidref = b.oid WHERE i.id IN (${quote(gameIds)})`,
    'simbad-game-stars',
  );

  // SIMBAD: the neighbourhood.
  const near = await tap(
    'simbad',
    `SELECT b.oid, b.main_id, b.otype, b.ra, b.dec, b.coo_bibcode, b.plx_value, b.plx_err, b.plx_bibcode, b.pmra, b.pmdec, b.pm_bibcode, b.rvz_radvel, b.sp_type, b.sp_bibcode FROM basic AS b WHERE b.plx_value >= ${NEIGHBOURHOOD_PLX}`,
    'simbad-neighbourhood',
  );
  const oids = new Set<number>([...near, ...gameRows].map((r) => num(r.oid)).filter((x): x is number => x !== null));
  console.log(`Neighbourhood: ${near.length} SIMBAD objects; ${oids.size} with the game's stars.`);

  // Hierarchy: parents (multiple systems) and their other members.
  const oidList = [...oids];
  const links: Row[] = [];
  for (const [i, part] of chunks(oidList, 400).entries()) links.push(...(await tap('simbad', `SELECT parent, child, membership FROM h_link WHERE child IN (${part.join(',')})`, `simbad-h-link-up-${i}`)));
  const parents = [...new Set(links.map((l) => num(l.parent)).filter((x): x is number => x !== null))];
  const down: Row[] = [];
  for (const [i, part] of chunks(parents, 400).entries()) down.push(...(await tap('simbad', `SELECT parent, child, membership FROM h_link WHERE parent IN (${part.join(',')})`, `simbad-h-link-down-${i}`)));
  const extra = [...new Set([...parents, ...down.map((l) => num(l.child)).filter((x): x is number => x !== null)])].filter((o) => !oids.has(o));
  for (const [i, part] of chunks(extra, 400).entries()) {
    await tap(
      'simbad',
      `SELECT b.oid, b.main_id, b.otype, b.ra, b.dec, b.coo_bibcode, b.plx_value, b.plx_err, b.plx_bibcode, b.pmra, b.pmdec, b.pm_bibcode, b.rvz_radvel, b.sp_type, b.sp_bibcode FROM basic AS b WHERE b.oid IN (${part.join(',')})`,
      `simbad-system-members-${i}`,
    );
  }
  const everyone = [...oids, ...extra];

  // Identifiers and fluxes for everyone.
  const idents: Row[] = [];
  for (const [i, part] of chunks(everyone, 300).entries()) idents.push(...(await tap('simbad', `SELECT oidref, id FROM ident WHERE oidref IN (${part.join(',')})`, `simbad-idents-${i}`)));
  for (const [i, part] of chunks(everyone, 400).entries()) {
    await tap('simbad', `SELECT oidref, filter, flux, flux_err, bibcode FROM flux WHERE oidref IN (${part.join(',')}) AND filter IN ('V', 'G', 'J', 'K')`, `simbad-fluxes-${i}`);
  }

  // Gaia DR3 by source id, for every Gaia DR3 identifier found.
  const gaiaIds = new Set<string>();
  const hips = new Set<number>();
  for (const s of stars) {
    if (s.catalogIds.gaiaDr3) gaiaIds.add(s.catalogIds.gaiaDr3.replace(/\D/g, ''));
    if (s.catalogIds.hip) hips.add(Number(s.catalogIds.hip.replace(/\D/g, '')));
  }
  for (const r of idents) {
    const id = String(r.id ?? '');
    const g = /^Gaia DR3 (\d+)$/.exec(id);
    if (g) gaiaIds.add(g[1]!);
    const h = /^HIP (\d+)$/.exec(id);
    if (h) hips.add(Number(h[1]));
  }
  for (const [i, part] of chunks([...gaiaIds], 300).entries()) {
    await tap(
      'gaia',
      `SELECT source_id, ra, dec, parallax, parallax_error, pmra, pmdec, ref_epoch, phot_g_mean_mag, bp_rp, ruwe, astrometric_params_solved, radial_velocity FROM gaiadr3.gaia_source WHERE source_id IN (${part.join(',')})`,
      `gaia-dr3-by-id-${i}`,
    );
  }
  // The brightest stars have no usable Gaia DR3 astrometry; the cones record what Gaia DR3 holds there.
  const cones: [string, number, number][] = [
    ['alpha-centauri-a', 219.8685, -60.8319],
    ['alpha-centauri-b', 219.8627, -60.834],
    ['sirius', 101.2846, -16.7216],
  ];
  for (const [id, ra, dec] of cones) {
    await tap(
      'gaia',
      `SELECT source_id, ra, dec, parallax, parallax_error, phot_g_mean_mag, astrometric_params_solved, ruwe FROM gaiadr3.gaia_source WHERE 1=CONTAINS(POINT('ICRS', ra, dec), CIRCLE('ICRS', ${ra}, ${dec}, 0.03))`,
      `gaia-dr3-cone-${id}`,
    );
  }

  // Hipparcos, new reduction: by HIP number, and every star it measured within the neighbourhood.
  await tap('vizier', `SELECT HIP, RArad, DErad, Plx, e_Plx, pmRA, pmDE, Hpmag FROM "I/311/hip2" WHERE HIP IN (${[...hips].join(',')})`, 'vizier-hip2-by-hip');
  await tap('vizier', `SELECT HIP, RArad, DErad, Plx, e_Plx, pmRA, pmDE, Hpmag FROM "I/311/hip2" WHERE Plx >= ${NEIGHBOURHOOD_PLX}`, 'vizier-hip2-neighbourhood');

  // NASA Exoplanet Archive: every confirmed planet within reach.
  await tap('nasa', `select * from pscomppars where sy_dist < ${PLANET_DIST_PC}`, 'nasa-pscomppars-neighbourhood', { nasa: true });

  // JPL: Keplerian elements (1800-2050) and Horizons vectors to test them against.
  await getText('https://ssd.jpl.nasa.gov/txt/p_elem_t1.txt', 'jpl-keplerian-elements-1800-2050');
  const bodies: [string, string][] = [
    ['199', 'mercury'],
    ['299', 'venus'],
    ['3', 'earth-moon-barycenter'],
    ['499', 'mars'],
    ['599', 'jupiter'],
    ['699', 'saturn'],
    ['799', 'uranus'],
    ['899', 'neptune'],
  ];
  const dates = ['2451545.0', '2460676.5', '2462502.5'];
  for (const [command, name] of bodies) {
    for (const jd of dates) {
      const q = new URLSearchParams({
        format: 'json',
        COMMAND: `'${command}'`,
        OBJ_DATA: "'NO'",
        MAKE_EPHEM: "'YES'",
        EPHEM_TYPE: "'VECTORS'",
        CENTER: "'500@10'",
        REF_PLANE: "'ECLIPTIC'",
        REF_SYSTEM: "'ICRF'",
        VEC_TABLE: "'1'",
        OUT_UNITS: "'AU-D'",
        CSV_FORMAT: "'YES'",
        START_TIME: `'JD${jd}'`,
        STOP_TIME: `'JD${Number(jd) + 1}'`,
        STEP_SIZE: "'1 d'",
      });
      await getText(`https://ssd.jpl.nasa.gov/api/horizons.api?${q.toString()}`, `jpl-horizons-${name}-${jd}`, 'json');
    }
  }

  writeFileSync(resolve(rawDir, 'manifest.json'), JSON.stringify({ retrieved: today, neighbourhoodParallaxMas: NEIGHBOURHOOD_PLX, planetDistancePc: PLANET_DIST_PC, queries: manifest }, null, 2) + '\n');
  const failed = manifest.filter((m) => !m.ok);
  console.log(`${manifest.length - failed.length} of ${manifest.length} queries worked.`);
  for (const f of failed) console.log(`  failed: ${f.label}: ${f.error}`);
  // The essentials: the game's stars, the neighbourhood and the planets.
  const essential = ['simbad-game-stars', 'simbad-neighbourhood', 'nasa-pscomppars-neighbourhood'];
  if (failed.some((f) => essential.includes(f.label))) process.exit(1);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.stack : err);
  process.exit(1);
});
