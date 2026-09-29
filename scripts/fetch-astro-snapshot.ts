/**
 * Captures a dated astronomy snapshot from primary archives and writes the normalized inputs
 * consumed by scripts/build-dataset.ts:
 *
 *   data/snapshot/raw/<date>/*.json     raw archive responses (provenance)
 *   data/snapshot/astrometry-input.json
 *   data/snapshot/exoplanets-input.json
 *
 * Sources (matched by catalog identifier, never by a bare common name):
 *   - ESA Gaia DR3 (gaiadr3.gaia_source) by source_id, plus cone searches that document why the
 *     brightest stars (Alpha Cen A/B, Sirius A/B) have no usable Gaia DR3 astrometry.
 *   - SIMBAD (basic + ident) by HIP / Gaia DR3 identifiers, for stars without usable Gaia DR3
 *     astrometry; SIMBAD's per-value bibcodes are recorded so the primary publication is cited.
 *   - VizieR I/311/hip2 (Hipparcos, new reduction, van Leeuwen 2007) as a cross-check.
 *   - NASA Exoplanet Archive pscomppars (confirmed planets only), by HIP name or host name.
 *
 * Usage: npm run data:snapshot            (then npm run data:build && npm run data:validate)
 * Behind an HTTPS proxy, run with NODE_USE_ENV_PROXY=1 so Node's fetch honours HTTPS_PROXY.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { propagatePosition } from '../src/data/coords.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const today = new Date().toISOString().slice(0, 10);
const rawDir = resolve(root, 'data/snapshot/raw', today);
mkdirSync(rawDir, { recursive: true });

const GAIA_TAP = 'https://gea.esac.esa.int/tap-server/tap/sync';
const SIMBAD_TAP = 'https://simbad.cds.unistra.fr/simbad/sim-tap/sync';
const VIZIER_TAP = 'https://tapvizier.cds.unistra.fr/TAPVizieR/tap/sync';
const EXO_TAP = 'https://exoplanetarchive.ipac.caltech.edu/TAP/sync';
const TARGET_EPOCH = 2016.0;

interface Target {
  id: string;
  name: string;
  systemId: string;
  role: 'primary' | 'companion';
  parentId?: string;
  hip?: number;
  gaiaDr3?: string;
  /** SIMBAD identifiers to try, most specific first. */
  simbadIds: string[];
  colorHex: string;
  /** Approximate J2016 position for a Gaia cone search (degrees). */
  cone: [number, number];
}

const TARGETS: Target[] = [
  { id: 'alpha-centauri-a', name: 'Alpha Centauri A', systemId: 'alpha-centauri', role: 'primary', hip: 71683, simbadIds: ['HIP 71683', '* alf Cen A'], colorHex: '#fff3e2', cone: [219.8685, -60.8319] },
  { id: 'alpha-centauri-b', name: 'Alpha Centauri B', systemId: 'alpha-centauri', role: 'companion', parentId: 'alpha-centauri-a', hip: 71681, simbadIds: ['HIP 71681', '* alf Cen B'], colorHex: '#ffd6a8', cone: [219.8627, -60.8340] },
  { id: 'proxima-centauri', name: 'Proxima Centauri', systemId: 'alpha-centauri', role: 'companion', parentId: 'alpha-centauri-a', hip: 70890, gaiaDr3: '5853498713190525696', simbadIds: ['HIP 70890', 'NAME Proxima Centauri'], colorHex: '#ff8f66', cone: [217.3923, -62.6761] },
  { id: 'barnards-star', name: "Barnard's Star", systemId: 'barnard', role: 'primary', hip: 87937, gaiaDr3: '4472832130942575872', simbadIds: ['HIP 87937', "NAME Barnard's Star"], colorHex: '#ff9a6b', cone: [269.4485, 4.7394] },
  { id: 'sirius-a', name: 'Sirius A', systemId: 'sirius', role: 'primary', hip: 32349, simbadIds: ['HIP 32349', '* alf CMa A', '* alf CMa'], colorHex: '#d4e0ff', cone: [101.2846, -16.7216] },
  { id: 'sirius-b', name: 'Sirius B', systemId: 'sirius', role: 'companion', parentId: 'sirius-a', simbadIds: ['* alf CMa B', 'NAME Sirius B'], colorHex: '#eef2ff', cone: [101.2846, -16.7216] },
  { id: 'epsilon-eridani', name: 'Epsilon Eridani', systemId: 'epsilon-eridani', role: 'primary', hip: 16537, gaiaDr3: '5164707970261890560', simbadIds: ['HIP 16537', '* eps Eri'], colorHex: '#ffcb94', cone: [53.2283, -9.4582] },
];

type Row = Record<string, unknown>;

async function tapJson(url: string, params: Record<string, string>, label: string): Promise<Row[]> {
  const body = new URLSearchParams(params);
  const res = await fetch(url, { method: 'POST', body, headers: { Accept: 'application/json' } });
  const text = await res.text();
  writeFileSync(resolve(rawDir, `${label}.json`), text);
  if (!res.ok) throw new Error(`${label}: HTTP ${res.status} ${text.slice(0, 300)}`);
  const json = JSON.parse(text) as { metadata?: { name: string }[]; data?: unknown[][] } | Row[];
  if (Array.isArray(json)) return json;
  const cols = (json.metadata ?? []).map((m) => m.name);
  return (json.data ?? []).map((r) => Object.fromEntries(cols.map((c, i) => [c, r[i]])));
}

const adql = (query: string) => ({ REQUEST: 'doQuery', LANG: 'ADQL', FORMAT: 'json', QUERY: query });
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : null);
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);

async function main(): Promise<void> {
  console.log(`Snapshot ${today} → ${rawDir}`);

  // ---- Gaia DR3 by source id ----
  const gaiaIds = TARGETS.flatMap((t) => (t.gaiaDr3 ? [t.gaiaDr3] : []));
  const gaiaRows = await tapJson(
    GAIA_TAP,
    adql(
      `SELECT source_id, ra, dec, parallax, parallax_error, pmra, pmdec, ref_epoch, phot_g_mean_mag, ruwe, astrometric_params_solved FROM gaiadr3.gaia_source WHERE source_id IN (${gaiaIds.join(',')})`,
    ),
    'gaia-dr3-by-id',
  );
  const gaiaById = new Map(gaiaRows.map((r) => [String(r.source_id), r]));

  // ---- Gaia DR3 cone searches for the bright stars (documents missing/unsuitable entries) ----
  const cones: Record<string, Row[]> = {};
  for (const t of TARGETS.filter((x) => !x.gaiaDr3)) {
    cones[t.id] = await tapJson(
      GAIA_TAP,
      adql(
        `SELECT source_id, ra, dec, parallax, parallax_error, phot_g_mean_mag, astrometric_params_solved, ruwe FROM gaiadr3.gaia_source WHERE 1=CONTAINS(POINT('ICRS', ra, dec), CIRCLE('ICRS', ${t.cone[0]}, ${t.cone[1]}, 0.03))`,
      ),
      `gaia-dr3-cone-${t.id}`,
    );
  }

  // ---- SIMBAD basic data by identifier ----
  const allIds = TARGETS.flatMap((t) => t.simbadIds);
  const quoted = allIds.map((id) => `'${id.replace(/'/g, "''")}'`).join(', ');
  const simbadRows = await tapJson(
    SIMBAD_TAP,
    adql(
      `SELECT i.id AS query_id, b.oid, b.main_id, b.ra, b.dec, b.coo_bibcode, b.plx_value, b.plx_err, b.plx_bibcode, b.pmra, b.pmdec, b.pm_bibcode, b.sp_type, b.sp_bibcode FROM ident AS i JOIN basic AS b ON i.oidref = b.oid WHERE i.id IN (${quoted})`,
    ),
    'simbad-basic',
  );
  const simbadFor = (t: Target): Row | undefined => {
    for (const id of t.simbadIds) {
      const row = simbadRows.find((r) => r.query_id === id);
      if (row) return row;
    }
    return undefined;
  };
  // Cross-identifiers: confirm the Gaia DR3 id SIMBAD attaches to each object.
  const oids = [...new Set(simbadRows.map((r) => num(r.oid)).filter((x): x is number => x !== null))];
  const crossRows = oids.length
    ? await tapJson(SIMBAD_TAP, adql(`SELECT oidref, id FROM ident WHERE oidref IN (${oids.join(',')}) AND (id LIKE 'Gaia DR3%' OR id LIKE 'HIP %')`), 'simbad-cross-ids')
    : [];

  // ---- Hipparcos new reduction (cross-check) ----
  const hips = TARGETS.flatMap((t) => (t.hip ? [t.hip] : []));
  const hipRows = await tapJson(
    VIZIER_TAP,
    adql(`SELECT HIP, RArad, DErad, Plx, e_Plx, pmRA, pmDE FROM "I/311/hip2" WHERE HIP IN (${hips.join(',')})`),
    'vizier-hip2',
  );
  const hipById = new Map(hipRows.map((r) => [num(r.HIP), r]));

  // ---- Choose astrometry per star ----
  const notes: string[] = [];
  const stars = TARGETS.map((t) => {
    const simbad = simbadFor(t);
    if (!simbad) throw new Error(`SIMBAD returned nothing for ${t.name} (${t.simbadIds.join(' / ')})`);
    const simbadUrl = `https://simbad.cds.unistra.fr/simbad/sim-id?Ident=${encodeURIComponent(String(simbad.main_id))}`;
    const oid = num(simbad.oid);
    const crossGaia = crossRows.find((r) => num(r.oidref) === oid && String(r.id).startsWith('Gaia DR3'));
    if (t.gaiaDr3 && crossGaia && !String(crossGaia.id).endsWith(t.gaiaDr3)) {
      throw new Error(`Gaia DR3 id mismatch for ${t.name}: SIMBAD says ${String(crossGaia.id)}`);
    }
    const gaia = t.gaiaDr3 ? gaiaById.get(t.gaiaDr3) : undefined;
    const gaiaUsable =
      gaia && num(gaia.parallax) !== null && (num(gaia.ruwe) ?? 99) < 1.4 && num(gaia.parallax)! / (num(gaia.parallax_error) ?? 1) > 100;
    const spType = str(simbad.sp_type) ?? 'unknown';
    const spSource = { label: 'SIMBAD', url: simbadUrl, recordId: String(simbad.main_id), ...(str(simbad.sp_bibcode) ? { bibcode: str(simbad.sp_bibcode)! } : {}) };
    if (gaia && gaiaUsable) {
      const gaiaUrl = `${GAIA_TAP}?REQUEST=doQuery&LANG=ADQL&FORMAT=csv&QUERY=${encodeURIComponent(`SELECT * FROM gaiadr3.gaia_source WHERE source_id = ${t.gaiaDr3}`)}`;
      const src = { label: 'Gaia DR3', url: gaiaUrl, recordId: `Gaia DR3 ${t.gaiaDr3}` };
      return {
        id: t.id, name: t.name, systemId: t.systemId, role: t.role, ...(t.parentId ? { parentId: t.parentId } : {}),
        catalogIds: { gaiaDr3: `Gaia DR3 ${t.gaiaDr3}`, ...(t.hip ? { hip: `HIP ${t.hip}` } : {}), simbad: String(simbad.main_id) },
        spectralType: spType,
        raDegrees: num(gaia.ra)!, decDegrees: num(gaia.dec)!, epoch: num(gaia.ref_epoch) ?? 2016.0,
        pmRaMasYr: num(gaia.pmra)!, pmDecMasYr: num(gaia.pmdec)!,
        parallaxMas: num(gaia.parallax)!, parallaxErrorMas: num(gaia.parallax_error)!,
        positionSource: src, parallaxSource: src, spectralTypeSource: spSource, colorHex: t.colorHex,
      };
    }
    // No usable Gaia DR3 astrometry: SIMBAD's adopted values, each cited by bibcode.
    const plx = num(simbad.plx_value);
    const plxErr = num(simbad.plx_err);
    if (plx === null || plxErr === null) throw new Error(`No parallax for ${t.name} in SIMBAD`);
    const hip = t.hip ? hipById.get(t.hip) : undefined;
    const cone = cones[t.id] ?? [];
    notes.push(
      `${t.name}: Gaia DR3 cone search returned ${cone.length} source(s)` +
        (cone.length ? ` (${cone.map((c) => `${c.source_id} G=${Number(c.phot_g_mean_mag).toFixed(2)} params=${c.astrometric_params_solved}`).join('; ')})` : '') +
        `; adopted SIMBAD values (parallax ${plx} ± ${plxErr} mas, ${String(simbad.plx_bibcode)})` +
        (hip ? `; Hipparcos 2007 parallax ${num(hip.Plx)} ± ${num(hip.e_Plx)} mas for comparison` : ''),
    );
    return {
      id: t.id, name: t.name, systemId: t.systemId, role: t.role, ...(t.parentId ? { parentId: t.parentId } : {}),
      catalogIds: { ...(t.hip ? { hip: `HIP ${t.hip}` } : {}), simbad: String(simbad.main_id) },
      spectralType: spType,
      raDegrees: num(simbad.ra)!, decDegrees: num(simbad.dec)!, epoch: 2000.0,
      pmRaMasYr: num(simbad.pmra) ?? 0, pmDecMasYr: num(simbad.pmdec) ?? 0,
      parallaxMas: plx, parallaxErrorMas: plxErr,
      positionSource: { label: 'SIMBAD', url: simbadUrl, recordId: String(simbad.main_id), ...(str(simbad.coo_bibcode) ? { bibcode: str(simbad.coo_bibcode)! } : {}) },
      parallaxSource: {
        label: `SIMBAD adopted parallax${str(simbad.plx_bibcode) ? ` (${str(simbad.plx_bibcode)})` : ''}`,
        url: str(simbad.plx_bibcode) ? `https://ui.adsabs.harvard.edu/abs/${encodeURIComponent(str(simbad.plx_bibcode)!)}` : simbadUrl,
        ...(str(simbad.plx_bibcode) ? { bibcode: str(simbad.plx_bibcode)! } : {}),
      },
      spectralTypeSource: spSource,
      colorHex: t.colorHex,
    };
  });

  // Sanity: a companion whose parallax is far less precise than its primary's adopts the primary's
  // parallax (bound pair at one distance); recorded as a position note.
  for (const s of stars) {
    if (s.role !== 'companion' || !s.parentId || s.id === 'proxima-centauri') continue;
    const parent = stars.find((p) => p.id === s.parentId)!;
    if (s.parallaxErrorMas / s.parallaxMas > 0.02 && parent.parallaxErrorMas < s.parallaxErrorMas) {
      (s as Record<string, unknown>).positionNote = `Own parallax (${s.parallaxMas} ± ${s.parallaxErrorMas} mas) is imprecise; plotted at ${parent.name}'s parallax as a bound pair.`;
      s.parallaxMas = parent.parallaxMas;
      s.parallaxErrorMas = parent.parallaxErrorMas;
      s.parallaxSource = parent.parallaxSource;
    }
  }
  for (const s of stars) {
    const p = propagatePosition(s.raDegrees, s.decDegrees, s.pmRaMasYr, s.pmDecMasYr, s.epoch, TARGET_EPOCH);
    console.log(`  ${s.name.padEnd(18)} ${s.positionSource.label.padEnd(8)} plx ${s.parallaxMas} ± ${s.parallaxErrorMas}  → J${TARGET_EPOCH}: ${p.raDeg.toFixed(5)}, ${p.decDeg.toFixed(5)}`);
  }

  writeFileSync(
    resolve(root, 'data/snapshot/astrometry-input.json'),
    JSON.stringify(
      {
        kind: 'snapshot',
        retrieved: today,
        description: `Archive snapshot retrieved ${today} by scripts/fetch-astro-snapshot.ts. Gaia DR3 five-parameter solutions (RUWE < 1.4, parallax/error > 100) where available; otherwise SIMBAD adopted values with their bibcodes. Positions propagated to J${TARGET_EPOCH.toFixed(1)}. Notes: ${notes.join(' | ')}`,
        targetEpoch: TARGET_EPOCH,
        stars,
      },
      null,
      2,
    ) + '\n',
  );

  // ---- NASA Exoplanet Archive: confirmed planets ----
  const hipByHost = new Map(TARGETS.filter((t) => t.hip).map((t) => [`HIP ${t.hip}`, t.id]));
  const exoRows = await tapJson(
    EXO_TAP,
    {
      query: `select pl_name, hostname, hip_name, gaia_id, disc_year, discoverymethod, pl_controv_flag, pl_orbper, pl_orbpererr1, pl_orbsmax, pl_orbsmaxerr1, pl_bmasse, pl_bmasseerr1, pl_bmassprov, pl_rade, pl_radeerr1, rowupdate from pscomppars where hip_name in (${[...hipByHost.keys()].map((h) => `'${h}'`).join(',')}) or hostname in ('Proxima Cen','Barnard''s star','eps Eri','alf Cen A','alf Cen B')`,
      format: 'json',
    },
    'nasa-exoplanet-archive-pscomppars',
  );
  const hostIdFor = (r: Row): string | undefined => {
    const hip = str(r.hip_name);
    if (hip && hipByHost.has(hip)) return hipByHost.get(hip);
    const host = String(r.hostname ?? '').toLowerCase();
    if (host.startsWith('proxima')) return 'proxima-centauri';
    if (host.startsWith('barnard')) return 'barnards-star';
    if (host === 'eps eri') return 'epsilon-eridani';
    if (host === 'alf cen a') return 'alpha-centauri-a';
    if (host === 'alf cen b') return 'alpha-centauri-b';
    return undefined;
  };
  const planets = exoRows
    .map((r) => {
      const hostId = hostIdFor(r);
      if (!hostId) return null;
      const mass = num(r.pl_bmasse);
      return {
        archiveName: String(r.pl_name),
        hostId,
        ...(num(r.disc_year) ? { discoveryYear: num(r.disc_year)! } : {}),
        ...(str(r.discoverymethod) ? { discoveryMethod: str(r.discoverymethod)! } : {}),
        controversial: num(r.pl_controv_flag) === 1,
        ...(num(r.pl_orbper) !== null ? { orbitalPeriodDays: { value: num(r.pl_orbper)!, ...(num(r.pl_orbpererr1) !== null ? { error: num(r.pl_orbpererr1)! } : {}) } } : {}),
        ...(num(r.pl_orbsmax) !== null ? { semiMajorAxisAu: { value: num(r.pl_orbsmax)!, ...(num(r.pl_orbsmaxerr1) !== null ? { error: num(r.pl_orbsmaxerr1)! } : {}) } } : {}),
        ...(mass !== null
          ? {
              massEarth: {
                value: mass,
                ...(num(r.pl_bmasseerr1) !== null ? { error: num(r.pl_bmasseerr1)! } : {}),
                ...(String(r.pl_bmassprov ?? '').toLowerCase().includes('sin') ? { qualifier: 'minimum mass, M sin i' } : {}),
              },
            }
          : {}),
        ...(num(r.pl_rade) !== null ? { radiusEarth: { value: num(r.pl_rade)!, ...(num(r.pl_radeerr1) !== null ? { error: num(r.pl_radeerr1)! } : {}) } } : {}),
        ...(str(r.rowupdate) ? { rowUpdate: str(r.rowupdate)! } : {}),
      };
    })
    .filter((p): p is NonNullable<typeof p> => p !== null)
    .sort((a, b) => a.archiveName.localeCompare(b.archiveName));
  for (const p of planets) console.log(`  planet ${p.archiveName} (${p.hostId})${p.controversial ? ' [controversial]' : ''}`);
  writeFileSync(
    resolve(root, 'data/snapshot/exoplanets-input.json'),
    JSON.stringify(
      {
        kind: 'snapshot',
        retrieved: today,
        description: `NASA Exoplanet Archive Planetary Systems Composite Parameters (pscomppars, confirmed planets only), retrieved ${today}.`,
        source: { label: 'NASA Exoplanet Archive (pscomppars)', url: 'https://exoplanetarchive.ipac.caltech.edu/' },
        planets,
      },
      null,
      2,
    ) + '\n',
  );
  console.log('Done. Next: npm run data:build && npm run data:validate');
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
