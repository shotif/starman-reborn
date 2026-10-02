/**
 * Turns a raw sky snapshot (scripts/sky-fetch.ts, run on GitHub's runners) into the game's inputs,
 * offline and deterministically. Reads data/snapshot/raw/<date>/ (the latest date, or the one given)
 * and the game's current records (data/provisional/), and writes:
 *
 *   data/snapshot/astrometry-input.json   every star: the game's, verified, and the new systems'
 *   data/snapshot/systems-input.json      new systems, and stars that join existing systems
 *   data/snapshot/exoplanets-input.json   every planet: confirmed, contested (kept) and candidates
 *   data/snapshot/belts-input.json        belts and debris discs, each with the paper that reports it
 *   data/snapshot/solar-elements.json     JPL's Keplerian elements (1800-2050) and Horizons checks
 *   data/snapshot/REPORT.md               what changed, star by star and planet by planet
 *
 * The rules (docs/ASTRONOMY_SOURCES.md):
 *   - Nothing already in the game is removed. A planet no archive confirms stays, marked contested,
 *     with what each archive says about it: this edition of the game keeps it as fiction.
 *   - Stars keep their ids, names and colours; their astrometry comes from Gaia DR3 where it passes
 *     the quality cuts, otherwise from SIMBAD's adopted values, each cited by bibcode.
 *   - New systems are everything SIMBAD lists with a parallax of at least 120 mas that the game lacks:
 *     stars, white dwarfs and brown dwarfs, grouped into systems by SIMBAD's multiple-star links and
 *     by being close together on the sky at the same distance.
 *   - New planets are the NASA Exoplanet Archive's confirmed planets, plus the Encyclopaedia's
 *     candidates (marked candidate). Retracted planets are never added.
 *
 * Usage: node scripts/sky-process.ts [date]   (then npm run data:build && npm run data:validate)
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { equatorialToCartesian, parallaxToLightYears, propagatePosition } from '../src/data/coords.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const rawRoot = resolve(root, 'data/snapshot/raw');
const date = process.argv[2] ?? readdirSync(rawRoot).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort().at(-1);
if (!date) throw new Error('No snapshot in data/snapshot/raw');
const raw = resolve(rawRoot, date);
const TARGET_EPOCH = 2016.0;

type Row = Record<string, unknown>;

// ---------------------------------------------------------------- reading

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : null);
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);
const norm = (id: string) => id.replace(/\s+/g, ' ').trim().toLowerCase();
const slug = (text: string) =>
  text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/'/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

function rowsOf(text: string): Row[] {
  // Gaia source ids (19 digits) do not fit a double: read every long integer as a string.
  const json = JSON.parse(text.replace(/([[,:]\s*)(-?\d{16,})(?=\s*[,\]}])/g, '$1"$2"')) as { metadata?: { name: string }[]; columns?: { name: string }[]; data?: unknown[][] } | Row[];
  if (Array.isArray(json)) return json;
  const cols = (json.metadata ?? json.columns ?? []).map((m) => m.name);
  return (json.data ?? []).map((r) => Object.fromEntries(cols.map((c, i) => [c, r[i]])));
}

interface ManifestEntry {
  label: string;
  ok: boolean;
  rows?: number;
  error?: string;
  file: string;
  query: string;
}
const manifest = JSON.parse(readFileSync(resolve(raw, 'manifest.json'), 'utf8')) as { retrieved: string; queries: ManifestEntry[] };
const retrieved = manifest.retrieved;

/** The rows of one query, or of every numbered part of it (label-0, label-1, ...). Failed queries give nothing. */
function load(label: string): Row[] {
  const entries = manifest.queries.filter((q) => q.ok && (q.label === label || new RegExp(`^${label}-\\d+$`).test(q.label)));
  return entries.flatMap((q) => rowsOf(readFileSync(resolve(raw, q.file), 'utf8')));
}
const worked = (label: string) => manifest.queries.some((q) => q.ok && q.label === label);

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(resolve(root, path), 'utf8')) as T;
}

// ---------------------------------------------------------------- SIMBAD

const basic = new Map<number, Row>();
for (const r of [...load('simbad-neighbourhood'), ...load('simbad-system-members'), ...load('simbad-game-stars')]) {
  const oid = num(r.oid);
  if (oid !== null && !basic.has(oid)) basic.set(oid, r);
}
const neighbourhood = new Set(load('simbad-neighbourhood').map((r) => num(r.oid)!));

const identsOf = new Map<number, string[]>();
const byIdent = new Map<string, Set<number>>();
for (const r of load('simbad-idents')) {
  const oid = num(r.oidref);
  const id = str(r.id);
  if (oid === null || !id) continue;
  identsOf.set(oid, [...(identsOf.get(oid) ?? []), id]);
  const key = norm(id);
  if (!byIdent.has(key)) byIdent.set(key, new Set());
  byIdent.get(key)!.add(oid);
}
const idsOf = (oid: number) => identsOf.get(oid) ?? [];

const parentOtype = new Map<number, { otype: string; mainId: string }>();
for (const r of load('simbad-parents')) parentOtype.set(num(r.oid)!, { otype: String(r.otype ?? '').trim(), mainId: String(r.main_id ?? '') });
/** Multiple-star parents (otype **) of each object, and the members of each. */
const starParents = new Map<number, Set<number>>();
const members = new Map<number, Set<number>>();
for (const r of [...load('simbad-h-link-up'), ...load('simbad-h-link-down')]) {
  const parent = num(r.parent);
  const child = num(r.child);
  if (parent === null || child === null) continue;
  const p = parentOtype.get(parent) ?? (basic.has(parent) ? { otype: String(basic.get(parent)!.otype ?? '').trim(), mainId: '' } : undefined);
  if (p?.otype !== '**') continue;
  if (!starParents.has(child)) starParents.set(child, new Set());
  starParents.get(child)!.add(parent);
  if (!members.has(parent)) members.set(parent, new Set());
  members.get(parent)!.add(child);
}
/** Any hierarchy link (a binary's SB* parent too): objects that contain other stars are never stars of their own. */
const containers = new Set<number>();
const isPlanetType = (t: string) => t === 'Pl' || t === 'Pl?';
for (const r of load('simbad-h-link-up')) {
  const parent = num(r.parent);
  const child = num(r.child);
  // SIMBAD also links planets to their star: a planet's host is not a container.
  if (parent !== null && child !== null && basic.has(parent) && basic.has(child) && !isPlanetType(String(basic.get(child)!.otype ?? '').trim())) containers.add(parent);
}
for (const [parent, set] of members) if ([...set].some((c) => basic.has(c) && !isPlanetType(String(basic.get(c)!.otype ?? '').trim()))) containers.add(parent);

const fluxes = new Map<number, Record<string, number>>();
for (const r of load('simbad-fluxes')) {
  const oid = num(r.oidref);
  const f = str(r.filter);
  const v = num(r.flux);
  if (oid === null || !f || v === null) continue;
  fluxes.set(oid, { ...(fluxes.get(oid) ?? {}), [f]: v });
}
/** Brightness for ordering a system's stars (smaller is brighter). */
const magnitude = (oid: number) => {
  const f = fluxes.get(oid) ?? {};
  return f.G ?? f.V ?? (f.J !== undefined ? f.J + 2 : undefined) ?? (f.K !== undefined ? f.K + 3 : undefined) ?? 99;
};

const gaia = new Map<string, Row>();
for (const r of load('gaia-dr3-by-id')) gaia.set(String(r.source_id), r);

const discRefs = new Map<number, { bibcode: string; title: string; year: number | null; journal: string | null }[]>();
for (const r of load('simbad-disc-refs')) {
  const oid = num(r.oidref);
  const bibcode = str(r.bibcode);
  if (oid === null || !bibcode) continue;
  const list = discRefs.get(oid) ?? [];
  if (!list.some((x) => x.bibcode === bibcode)) list.push({ bibcode, title: String(r.title ?? '').replace(/\s+/g, ' ').trim(), year: num(r.year), journal: str(r.journal) });
  discRefs.set(oid, list);
}

const simbadUrl = (mainId: string) => `https://simbad.cds.unistra.fr/simbad/sim-id?Ident=${encodeURIComponent(mainId.replace(/\s+/g, ' ').trim())}`;
const adsUrl = (bibcode: string) => `https://ui.adsabs.harvard.edu/abs/${encodeURIComponent(bibcode)}`;
const mainIdOf = (oid: number) => String(basic.get(oid)?.main_id ?? parentOtype.get(oid)?.mainId ?? '').replace(/\s+/g, ' ').trim();
const otypeOf = (oid: number) => String(basic.get(oid)?.otype ?? parentOtype.get(oid)?.otype ?? '').trim();

/** The label a bibcode is known by, for the citations shown in the game. */
function bibLabel(bibcode: string): string {
  const known: Record<string, string> = {
    '2020yCat.1350....0G': 'Gaia EDR3 (Gaia Collaboration 2020)',
    '2018yCat.1345....0G': 'Gaia DR2 (Gaia Collaboration 2018)',
    '2022yCat.1355....0G': 'Gaia DR3 (Gaia Collaboration 2022)',
    '2007A&A...474..653V': 'Hipparcos, new reduction (van Leeuwen 2007)',
    '1997A&A...323L..49P': 'Hipparcos (Perryman et al. 1997)',
  };
  return known[bibcode] ?? bibcode;
}

// ---------------------------------------------------------------- the game's stars

interface SourceRef {
  label: string;
  url: string;
  recordId?: string;
  retrieved?: string;
  bibcode?: string;
}

/** A star as scripts/build-dataset.ts reads it. */
interface StarInput {
  id: string;
  name: string;
  systemId: string;
  role: 'primary' | 'companion';
  parentId?: string;
  catalogIds: { gaiaDr3?: string; hip?: string; simbad?: string; gliese?: string };
  spectralType: string;
  raDegrees: number;
  decDegrees: number;
  epoch: number;
  pmRaMasYr: number;
  pmDecMasYr: number;
  parallaxMas: number;
  parallaxErrorMas?: number;
  positionSource: SourceRef;
  parallaxSource: SourceRef;
  spectralTypeSource: SourceRef;
  positionNote?: string;
  colorHex: string;
}

const curatedInput = readJson<{ stars: StarInput[] }>('data/provisional/astrometry-input.json');
const catalogInput = readJson<{ stars: StarInput[] }>('data/provisional/catalog-astrometry-input.json');
const gameStars: StarInput[] = [...curatedInput.stars, ...catalogInput.stars];

/** SIMBAD identifiers a game star may go by, most specific first (component designations before HIP). */
function candidateIdents(s: StarInput): string[] {
  const out: string[] = [];
  const c = s.catalogIds;
  if (c.gliese) {
    const m = /^(?:Gl|GJ)\s*([0-9.]+)\s*([A-Z]?)$/i.exec(c.gliese.trim());
    if (m) out.push(m[2] ? `GJ ${m[1]} ${m[2].toUpperCase()}` : `GJ ${m[1]}`);
  }
  out.push(`NAME ${s.name}`);
  if (c.simbad) out.push(c.simbad, `* ${c.simbad}`, `NAME ${c.simbad}`);
  if (c.gaiaDr3) out.push(c.gaiaDr3);
  if (c.hip) out.push(c.hip);
  return out;
}

/** Each game star's SIMBAD object: the most specific match that is not a parent of another match. */
const gameOid = new Map<string, number>();
{
  const all = gameStars.map((s) => ({ s, oids: candidateIdents(s).flatMap((id) => [...(byIdent.get(norm(id)) ?? [])]) }));
  const chosen = new Set(all.flatMap((x) => x.oids));
  for (const { s, oids } of all) {
    const own = [...new Set(oids)].filter((o) => !(containers.has(o) && [...chosen].some((c) => c !== o && (starParents.get(c)?.has(o) || members.get(o)?.has(c)))));
    const pick = own.find((o) => otypeOf(o) !== '**') ?? own[0] ?? oids[0];
    if (pick === undefined) throw new Error(`SIMBAD has no object for ${s.name} (${candidateIdents(s).join(' / ')})`);
    gameOid.set(s.id, pick);
  }
}
const gameByOid = new Map([...gameOid].map(([id, oid]) => [oid, id]));

// ---------------------------------------------------------------- astrometry

const GAIA_CUTS = { ruwe: 1.4, snr: 100 };

interface Astrometry {
  raDegrees: number;
  decDegrees: number;
  epoch: number;
  pmRaMasYr: number;
  pmDecMasYr: number;
  parallaxMas: number;
  parallaxErrorMas?: number;
  positionSource: SourceRef;
  parallaxSource: SourceRef;
  gaiaId?: string;
  notes: string[];
}

function gaiaIdOf(oid: number): string | undefined {
  return idsOf(oid)
    .map((id) => /^Gaia DR3 (\d+)$/.exec(id.replace(/\s+/g, ' '))?.[1])
    .find((x) => !!x);
}

/** Gaia DR3 when its five- or six-parameter solution passes the cuts; otherwise SIMBAD's adopted values. */
function astrometryOf(oid: number): Astrometry | null {
  const b = basic.get(oid);
  const gid = gaiaIdOf(oid);
  const g = gid ? gaia.get(gid) : undefined;
  const notes: string[] = [];
  if (g) {
    const plx = num(g.parallax);
    const err = num(g.parallax_error);
    const ruwe = num(g.ruwe);
    const params = num(g.astrometric_params_solved);
    const usable = plx !== null && err !== null && plx > 0 && (params === 31 || params === 95) && ruwe !== null && ruwe < GAIA_CUTS.ruwe && plx / err > GAIA_CUTS.snr;
    if (usable) {
      const src: SourceRef = {
        label: 'Gaia DR3',
        url: `https://gea.esac.esa.int/tap-server/tap/sync?REQUEST=doQuery&LANG=ADQL&FORMAT=csv&QUERY=${encodeURIComponent(`SELECT * FROM gaiadr3.gaia_source WHERE source_id = ${gid}`)}`,
        recordId: `Gaia DR3 ${gid}`,
        retrieved,
      };
      return { raDegrees: num(g.ra)!, decDegrees: num(g.dec)!, epoch: num(g.ref_epoch) ?? 2016, pmRaMasYr: num(g.pmra) ?? 0, pmDecMasYr: num(g.pmdec) ?? 0, parallaxMas: plx!, parallaxErrorMas: err!, positionSource: src, parallaxSource: src, gaiaId: gid, notes };
    }
    notes.push(
      params !== 31 && params !== 95
        ? `Gaia DR3 ${gid} has only a two-parameter solution (no parallax of its own)`
        : `Gaia DR3 ${gid} fails the quality cuts (RUWE ${ruwe?.toFixed(2)}, parallax/error ${plx && err ? Math.round(plx / err) : '?'})`,
    );
  }
  if (!b) return null;
  const ra = num(b.ra);
  const dec = num(b.dec);
  const plx = num(b.plx_value);
  if (ra === null || dec === null || plx === null || plx <= 0) return null;
  const main = mainIdOf(oid);
  const plxBib = str(b.plx_bibcode);
  const cooBib = str(b.coo_bibcode);
  return {
    raDegrees: ra,
    decDegrees: dec,
    epoch: 2000,
    pmRaMasYr: num(b.pmra) ?? 0,
    pmDecMasYr: num(b.pmdec) ?? 0,
    parallaxMas: plx,
    ...(num(b.plx_err) !== null ? { parallaxErrorMas: num(b.plx_err)! } : {}),
    positionSource: { label: 'SIMBAD', url: simbadUrl(main), recordId: main, retrieved, ...(cooBib ? { bibcode: cooBib } : {}) },
    parallaxSource: plxBib
      ? { label: `SIMBAD: ${bibLabel(plxBib)}`, url: adsUrl(plxBib), bibcode: plxBib, recordId: main, retrieved }
      : { label: 'SIMBAD', url: simbadUrl(main), recordId: main, retrieved },
    ...(gid ? { gaiaId: gid } : {}),
    notes,
  };
}

/** SIMBAD's spectral type, cited, or null. */
function spectralOf(oid: number): { type: string; source: SourceRef } | null {
  const b = basic.get(oid);
  const sp = str(b?.sp_type);
  if (!sp) return null;
  const main = mainIdOf(oid);
  const bib = str(b?.sp_bibcode);
  return { type: sp, source: { label: bib ? `SIMBAD: ${bib}` : 'SIMBAD', url: bib ? adsUrl(bib) : simbadUrl(main), recordId: main, retrieved, ...(bib ? { bibcode: bib } : {}) } };
}

const hipOf = (oid: number) => idsOf(oid).find((id) => /^HIP \d+$/.test(id.replace(/\s+/g, ' ')))?.replace(/\s+/g, ' ');
const gjOf = (oid: number) => idsOf(oid).find((id) => /^GJ\s+\d/.test(id))?.replace(/\s+/g, ' ');

/** Display colour inspired by the spectral class (an artistic choice, labelled estimated in the game). */
function colourFor(spect: string): string {
  const s = spect.trim().toUpperCase();
  if (/^D[ABCOQZX]/.test(s) || s === 'DG' || /^WD/.test(s)) return '#e8efff';
  const c = s.replace(/^(SD|D)(?=[OBAFGKMLTY])/, '')[0] ?? 'M';
  return ({ O: '#b8c8ff', B: '#c8d6ff', A: '#eef2ff', F: '#fff6e6', G: '#fff1d6', K: '#ffd9a8', M: '#ffb27a', L: '#e0785a', T: '#c0587a', Y: '#9a4f86' } as Record<string, string>)[c] ?? '#ffb27a';
}

interface StarChange {
  id: string;
  name: string;
  source: string;
  oldLy: number;
  newLy: number;
  shiftLy: number;
  notes: string[];
}
const starChanges: StarChange[] = [];

const positionOf = (s: Pick<StarInput, 'raDegrees' | 'decDegrees' | 'pmRaMasYr' | 'pmDecMasYr' | 'epoch' | 'parallaxMas'>) => {
  const p = propagatePosition(s.raDegrees, s.decDegrees, s.pmRaMasYr, s.pmDecMasYr, s.epoch, TARGET_EPOCH);
  return equatorialToCartesian(p.raDeg, p.decDeg, parallaxToLightYears(s.parallaxMas));
};
const dist3 = (a: number[], b: number[]) => Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!);

/** Verified records for the game's stars: ids, names, roles and colours kept; astrometry from the archives. */
const verifiedStars: StarInput[] = gameStars.map((s) => {
  const oid = gameOid.get(s.id)!;
  const a = astrometryOf(oid);
  const sp = spectralOf(oid);
  const main = mainIdOf(oid);
  const gid = a?.gaiaId;
  const hip = hipOf(oid) ?? s.catalogIds.hip;
  const out: StarInput = {
    ...s,
    catalogIds: { ...s.catalogIds, simbad: main, ...(gid ? { gaiaDr3: `Gaia DR3 ${gid}` } : {}), ...(hip ? { hip } : {}) },
    spectralType: sp?.type ?? s.spectralType,
    spectralTypeSource: sp?.source ?? s.spectralTypeSource,
  };
  if (a) {
    Object.assign(out, {
      raDegrees: a.raDegrees,
      decDegrees: a.decDegrees,
      epoch: a.epoch,
      pmRaMasYr: a.pmRaMasYr,
      pmDecMasYr: a.pmDecMasYr,
      parallaxMas: a.parallaxMas,
      positionSource: a.positionSource,
      parallaxSource: a.parallaxSource,
    });
    if (a.parallaxErrorMas !== undefined) out.parallaxErrorMas = a.parallaxErrorMas;
    else delete out.parallaxErrorMas;
    delete out.positionNote;
  }
  (out as StarInput & { notes?: string[] }).notes = a?.notes ?? [`SIMBAD gives no parallax for ${main}`];
  return out;
});

/** A companion without a usable parallax of its own (or a far less precise one) is plotted at its primary's. */
function settleCompanions(stars: StarInput[]): void {
  const byId = new Map(stars.map((s) => [s.id, s]));
  for (const s of stars) {
    if (s.role !== 'companion' || !s.parentId) continue;
    const parent = byId.get(s.parentId);
    if (!parent) continue;
    const notes = (s as StarInput & { notes?: string[] }).notes ?? [];
    const noOwn = !Number.isFinite(s.parallaxMas) || s.parallaxMas <= 0 || notes.some((n) => n.startsWith('SIMBAD gives no parallax'));
    const loose = s.parallaxErrorMas !== undefined && parent.parallaxErrorMas !== undefined && s.parallaxErrorMas / s.parallaxMas > 0.02 && parent.parallaxErrorMas < s.parallaxErrorMas;
    const far = Number.isFinite(s.parallaxMas) && Math.abs(s.parallaxMas - parent.parallaxMas) / parent.parallaxMas > 0.15;
    // Its own Gaia solution failed the cuts (glare from a bright primary) while the primary's is sound.
    const soundParent = parent.positionSource.label === 'Gaia DR3' || parent.parallaxSource.bibcode === '2007A&A...474..653V';
    const flawed = notes.some((n) => n.includes('fails the quality cuts')) && soundParent;
    if (!noOwn && !loose && !far && !flawed) continue;
    s.positionNote = noOwn
      ? `No parallax of its own in the archives; plotted at ${parent.name}'s distance as a bound companion.`
      : flawed
        ? `Its own Gaia DR3 parallax (${s.parallaxMas.toFixed(2)} mas) fails the quality cuts; plotted at ${parent.name}'s distance as a bound companion.`
        : `Own parallax (${s.parallaxMas.toFixed(2)}${s.parallaxErrorMas !== undefined ? ` ± ${s.parallaxErrorMas.toFixed(2)}` : ''} mas) is ${far ? 'far from' : 'less precise than'} ${parent.name}'s; plotted at its distance as a bound companion.`;
    s.parallaxMas = parent.parallaxMas;
    if (parent.parallaxErrorMas !== undefined) s.parallaxErrorMas = parent.parallaxErrorMas;
    else delete s.parallaxErrorMas;
    s.parallaxSource = parent.parallaxSource;
    if (noOwn) {
      // Nothing of its own to place it by: the primary's motion too.
      if (!s.pmRaMasYr && !s.pmDecMasYr) {
        s.pmRaMasYr = parent.pmRaMasYr;
        s.pmDecMasYr = parent.pmDecMasYr;
      }
    }
  }
}
settleCompanions(verifiedStars);

for (const s of verifiedStars) {
  const old = gameStars.find((x) => x.id === s.id)!;
  const before = positionOf(old);
  const after = positionOf(s);
  starChanges.push({
    id: s.id,
    name: s.name,
    source: s.positionSource.label === 'Gaia DR3' ? 'Gaia DR3' : `SIMBAD (${s.parallaxSource.bibcode ? bibLabel(s.parallaxSource.bibcode) : 'no bibcode'})`,
    oldLy: parallaxToLightYears(old.parallaxMas),
    newLy: parallaxToLightYears(s.parallaxMas),
    shiftLy: dist3(before, after),
    notes: [...((s as StarInput & { notes?: string[] }).notes ?? []), ...(s.positionNote ? [s.positionNote] : [])],
  });
  delete (s as StarInput & { notes?: string[] }).notes;
}

// ---------------------------------------------------------------- names

/** IAU constellation abbreviations and their genitives. */
const GENITIVE: Record<string, string> = {
  And: 'Andromedae', Ant: 'Antliae', Aps: 'Apodis', Aqr: 'Aquarii', Aql: 'Aquilae', Ara: 'Arae', Ari: 'Arietis', Aur: 'Aurigae',
  Boo: 'Boötis', Cae: 'Caeli', Cam: 'Camelopardalis', Cnc: 'Cancri', CVn: 'Canum Venaticorum', CMa: 'Canis Majoris', CMi: 'Canis Minoris',
  Cap: 'Capricorni', Car: 'Carinae', Cas: 'Cassiopeiae', Cen: 'Centauri', Cep: 'Cephei', Cet: 'Ceti', Cha: 'Chamaeleontis', Cir: 'Circini',
  Col: 'Columbae', Com: 'Comae Berenices', CrA: 'Coronae Australis', CrB: 'Coronae Borealis', Crv: 'Corvi', Crt: 'Crateris', Cru: 'Crucis',
  Cyg: 'Cygni', Del: 'Delphini', Dor: 'Doradus', Dra: 'Draconis', Equ: 'Equulei', Eri: 'Eridani', For: 'Fornacis', Gem: 'Geminorum',
  Gru: 'Gruis', Her: 'Herculis', Hor: 'Horologii', Hya: 'Hydrae', Hyi: 'Hydri', Ind: 'Indi', Lac: 'Lacertae', Leo: 'Leonis',
  LMi: 'Leonis Minoris', Lep: 'Leporis', Lib: 'Librae', Lup: 'Lupi', Lyn: 'Lyncis', Lyr: 'Lyrae', Men: 'Mensae', Mic: 'Microscopii',
  Mon: 'Monocerotis', Mus: 'Muscae', Nor: 'Normae', Oct: 'Octantis', Oph: 'Ophiuchi', Ori: 'Orionis', Pav: 'Pavonis', Peg: 'Pegasi',
  Per: 'Persei', Phe: 'Phoenicis', Pic: 'Pictoris', Psc: 'Piscium', PsA: 'Piscis Austrini', Pup: 'Puppis', Pyx: 'Pyxidis', Ret: 'Reticuli',
  Sge: 'Sagittae', Sgr: 'Sagittarii', Sco: 'Scorpii', Scl: 'Sculptoris', Sct: 'Scuti', Ser: 'Serpentis', Sex: 'Sextantis', Tau: 'Tauri',
  Tel: 'Telescopii', Tri: 'Trianguli', TrA: 'Trianguli Australis', Tuc: 'Tucanae', UMa: 'Ursae Majoris', UMi: 'Ursae Minoris', Vel: 'Velorum',
  Vir: 'Virginis', Vol: 'Volantis', Vul: 'Vulpeculae',
};
const GREEK: Record<string, string> = {
  alf: 'Alpha', bet: 'Beta', gam: 'Gamma', del: 'Delta', eps: 'Epsilon', zet: 'Zeta', eta: 'Eta', tet: 'Theta', iot: 'Iota', kap: 'Kappa',
  lam: 'Lambda', 'mu.': 'Mu', 'nu.': 'Nu', ksi: 'Xi', omi: 'Omicron', 'pi.': 'Pi', rho: 'Rho', sig: 'Sigma', tau: 'Tau', ups: 'Upsilon',
  phi: 'Phi', chi: 'Chi', psi: 'Psi', ome: 'Omega',
};
/** Catalogue prefixes: a SIMBAD "NAME" made of one of these is a designation, not a proper name. */
const CATALOGUE = /^(HD|HIP|HR|GJ|Gl|Gliese|LHS|LP|LTT|NLTT|L|G|BD|CD|CPD|Wolf|Ross|LAWD|WD|2MASS|WISE|WISEA|DENIS|SCR|UCAC4|TYC|PM|LSPM|SO|APMPM|TVLM|LEHPM|Luhman|Gaia)\b/;

/** Proper names SIMBAD gives an object ("NAME Teegarden's Star"), not designations or planet names. */
function properName(oid: number): string | undefined {
  return idsOf(oid)
    .map((id) => /^NAME\s+(.+)$/.exec(id.replace(/\s+/g, ' '))?.[1])
    .filter((n): n is string => !!n && !/\s[b-i]$/.test(n) && !/\b(Ab|Bb|Cb|BC|AB)$/.test(n))
    .sort((a, b) => Number(CATALOGUE.test(a)) - Number(CATALOGUE.test(b)) || a.length - b.length)[0];
}

/** "* alf PsA" → "Alpha Piscis Austrini"; "* 82 Eri" → "82 Eridani"; "V* AD Leo" → "AD Leonis". */
function starDesignation(oid: number, kind: 'greek' | 'flamsteed' | 'variable'): string | undefined {
  for (const raw of idsOf(oid)) {
    const id = raw.replace(/\s+/g, ' ').trim();
    if (kind === 'greek') {
      const m = /^\* ([a-z]{2,3}\.?)(\d{0,2}) ([A-Z][A-Za-z]{1,2})( [A-C])?$/.exec(id);
      if (m && GREEK[m[1]!] && GENITIVE[m[3]!]) return `${GREEK[m[1]!]}${m[2] ? Number(m[2]) : ''} ${GENITIVE[m[3]!]}${m[4] ?? ''}`;
    } else if (kind === 'flamsteed') {
      const m = /^\* (\d+) ([A-Z][A-Za-z]{1,2})( [A-C])?$/.exec(id);
      if (m && GENITIVE[m[2]!]) return `${m[1]} ${GENITIVE[m[2]!]}${m[3] ?? ''}`;
    } else {
      const m = /^V\* ([A-Z]{1,2}) ([A-Z][A-Za-z]{1,2})( [A-C])?$/.exec(id);
      if (m && GENITIVE[m[2]!]) return `${m[1]} ${GENITIVE[m[2]!]}${m[3] ?? ''}`;
    }
  }
  return undefined;
}

/** Survey designations shortened the way papers write them: "WISEA J085510.74-071442.5" → "WISE 0855−0714". */
function shortSurvey(id: string): string {
  const m = /^(WISEA?|WISEPC?|WISEU|WISE|2MASS|2MASSW|2MASSI|DENIS|DENIS-P|SDSS|ULAS|UGPS|PSO|CWISE|CWISEP|SSSPM|SCR|LSPM|SIMP|SIPS) J(\d{4})\d*(?:\.\d+)?([+-])(\d{4})\d*(?:\.\d+)?( ?[A-C])?$/.exec(id);
  if (m) return `${m[1]!.replace(/^(WISEA|WISEPC?|WISEU)$/, 'WISE').replace(/^CWISEP$/, 'CWISE').replace(/^2MASS[WI]$/, '2MASS').replace(/^DENIS-P$/, 'DENIS')} ${m[2]}${m[3] === '-' ? '−' : '+'}${m[4]}${m[5] ? ` ${m[5].trim()}` : ''}`;
  return id;
}

/** The designation to show for a star with no name: its GJ number, then its SIMBAD main id tidied. */
function designation(oid: number): string {
  const gj = gjOf(oid);
  if (gj) return gj;
  const main = mainIdOf(oid).replace(/^(\*|V\*|\*\*|EM\*|NAME) /, '');
  return shortSurvey(main);
}

/** The old catalogues nearby stars are best known by ("Wolf 424", "Groombridge 1618", "Stein 2051"). */
const HISTORIC = /^(Wolf|Ross|Lalande|Lacaille|Luyten|Kapteyn|Kruger|Struve|STF|Groombridge|Van Maanen|Stein|Van Biesbroeck|VB|Barnard|Innes|Gould|Scholz|Teegarden|Luhman)\b/;
function historicName(oid: number): string | undefined {
  return idsOf(oid)
    .map((id) => id.replace(/\s+/g, ' ').replace(/^(NAME|\*\*|\*) /, '').trim())
    .filter((id) => HISTORIC.test(id))
    .sort((a, b) => a.length - b.length)[0];
}

/**
 * A system's name, the way it is best known: a proper name; a Bayer or Flamsteed name; for a
 * planet host, the name the planet archive uses; a variable-star name; an old catalogue name; a
 * designation.
 */
function systemNameOf(oids: readonly number[], nasaHost: string | undefined): string {
  const everyone = [...oids, ...oids.flatMap((o) => [...(starParents.get(o) ?? [])])];
  const bare = (n: string) => n.replace(/ ?[A-C]$/, '').replace(/^Gl /, 'GJ ');
  for (const o of everyone) {
    const n = properName(o);
    if (n && !CATALOGUE.test(n)) return n;
  }
  for (const kind of ['greek', 'flamsteed'] as const) {
    for (const o of everyone) {
      const n = starDesignation(o, kind);
      if (n) return bare(n);
    }
  }
  if (nasaHost) return bare(nasaHost);
  for (const o of everyone) {
    const n = starDesignation(o, 'variable');
    if (n) return bare(n);
  }
  for (const o of everyone) {
    const n = historicName(o) ?? properName(o);
    if (n) return bare(n);
  }
  return bare(designation(oids[0]!));
}

// ---------------------------------------------------------------- planet hosts

const nasaRows = worked('nasa-pscomppars-neighbourhood') ? load('nasa-pscomppars-neighbourhood') : load('nasa-pscomppars-neighbourhood-all');

/** The SIMBAD object an archive names a host by (Gaia DR3 id, HIP, HD, or its name). */
function resolveHost(names: readonly (string | null | undefined)[]): number | undefined {
  for (const raw of names) {
    const name = raw?.replace(/\s+/g, ' ').trim();
    if (!name) continue;
    const forms = [name, `NAME ${name}`, `* ${name}`, `V* ${name}`, name.replace(/^Gl /, 'GJ '), name.replace(/^Gliese /, 'GJ '), name.replace(/ ([A-C])$/, '$1'), name.replace(/^(HIP \d+) [A-C]$/, '$1')];
    for (const f of forms) {
      const hits = [...(byIdent.get(norm(f)) ?? [])];
      const pick = hits.find((o) => otypeOf(o) !== '**') ?? hits[0];
      if (pick !== undefined) return pick;
    }
  }
  return undefined;
}

const nasaHost = new Map<Row, number>();
for (const r of nasaRows) {
  const oid = resolveHost([str(r.gaia_dr3_id), str(r.hip_name), str(r.hd_name), str(r.hostname)]);
  if (oid !== undefined) nasaHost.set(r, oid);
}
/** The NASA archive's host name for an object, when it hosts planets there. */
const nasaHostName = (oid: number) => {
  const r = nasaRows.find((x) => nasaHost.get(x) === oid);
  return r ? str(r.hostname) ?? undefined : undefined;
};

// ---------------------------------------------------------------- new systems

const PLANETISH = new Set(['Pl', 'Pl?', 'err']);
/** Stars, white dwarfs and brown dwarfs the neighbourhood holds that the game does not. */
const pool = [...basic.keys()].filter((oid) => {
  if (gameByOid.has(oid) || containers.has(oid)) return false;
  const t = otypeOf(oid);
  if (PLANETISH.has(t) || t.endsWith('?')) return false;
  // Neighbourhood objects, and members of a multiple system with one in the neighbourhood.
  return neighbourhood.has(oid) || [...(starParents.get(oid) ?? [])].some((p) => [...(members.get(p) ?? [])].some((m) => neighbourhood.has(m)));
});

const unit = (oid: number) => {
  const b = basic.get(oid)!;
  const ra = (num(b.ra)! * Math.PI) / 180;
  const dec = (num(b.dec)! * Math.PI) / 180;
  return [Math.cos(dec) * Math.cos(ra), Math.cos(dec) * Math.sin(ra), Math.sin(dec)];
};
const plxOf = (oid: number) => astrometryOf(oid)?.parallaxMas ?? null;

/** Bound together: shared multiple-star parent, or close on the sky at the same distance. */
const GROUPING = { projectedLy: 0.25, depthLy: 0.4, closeArcsec: 60, closeDepthLy: 1.5 };
const parentOf = new Map<number, number>();
const find = (x: number): number => {
  let r = x;
  while ((parentOf.get(r) ?? r) !== r) r = parentOf.get(r)!;
  parentOf.set(x, r);
  return r;
};
const union = (a: number, b: number) => {
  const ra = find(a);
  const rb = find(b);
  if (ra === rb) return;
  // A game star stays the root, so its system is found from any member.
  if (gameByOid.has(rb) && !gameByOid.has(ra)) parentOf.set(ra, rb);
  else parentOf.set(rb, ra);
};
const nodes = [...pool, ...gameByOid.keys()].filter((o) => basic.has(o) && num(basic.get(o)!.ra) !== null);
for (const o of pool) {
  for (const p of starParents.get(o) ?? []) for (const m of members.get(p) ?? []) if (m !== o && nodes.includes(m)) union(o, m);
}
for (const a of pool) {
  const pa = plxOf(a);
  if (pa === null || !basic.has(a)) continue;
  const ua = unit(a);
  for (const b of nodes) {
    if (a === b) continue;
    const pb = plxOf(b) ?? (gameByOid.has(b) ? verifiedStars.find((s) => s.id === gameByOid.get(b))!.parallaxMas : null);
    if (pb === null) continue;
    const ub = unit(b);
    const angle = Math.acos(Math.min(1, ua[0]! * ub[0]! + ua[1]! * ub[1]! + ua[2]! * ub[2]!));
    const da = parallaxToLightYears(pa);
    const db = parallaxToLightYears(pb);
    const arcsec = (angle * 180 * 3600) / Math.PI;
    // Within an arcminute of each other, a pair is bound even when one parallax is poor (SCR 1845-6357 B, GJ 667 AB).
    const depth = arcsec < GROUPING.closeArcsec ? GROUPING.closeDepthLy : GROUPING.depthLy;
    if (angle * (da + db) * 0.5 < GROUPING.projectedLy && Math.abs(da - db) < depth) union(a, b);
  }
}
const groups = new Map<number, number[]>();
for (const o of nodes) {
  const r = find(o);
  groups.set(r, [...(groups.get(r) ?? []), o]);
}

interface SystemEntry {
  id: string;
  displayName: string;
  referenceComponentId: string;
  componentIds: string[];
  addedBy: string;
}
const ADDED_BY = `sky snapshot ${retrieved}`;
const newStars: StarInput[] = [];
const newSystems: SystemEntry[] = [];
const additions = new Map<string, string[]>();
const oidOfStar = new Map<string, number>([...gameOid]);
const skipped: string[] = [];

const gameSystems = new Map<string, { name: string; componentIds: string[] }>();
{
  const catalogSystems = readJson<{ systems: SystemEntry[] }>('data/provisional/catalog-systems.json').systems;
  const curatedNames: Record<string, string> = { sol: 'Sol', 'alpha-centauri': 'Alpha Centauri', barnard: 'Barnard’s Star', sirius: 'Sirius', 'epsilon-eridani': 'Epsilon Eridani' };
  for (const s of verifiedStars) {
    const e = gameSystems.get(s.systemId) ?? { name: curatedNames[s.systemId] ?? catalogSystems.find((c) => c.id === s.systemId)?.displayName ?? s.systemId, componentIds: [] };
    e.componentIds.push(s.id);
    gameSystems.set(s.systemId, e);
  }
}
const usedStarIds = new Set(verifiedStars.map((s) => s.id));
const usedSystemIds = new Set(['sol', ...gameSystems.keys()]);
const unique = (base: string, used: Set<string>) => {
  let id = base || 'star';
  for (let i = 2; used.has(id); i++) id = `${base}-${i}`;
  used.add(id);
  return id;
};

/** The component letter SIMBAD's main id ends with ("Wolf 424 A" → "A"), if any. */
const letterOf = (oid: number) => /(?:\s|\d)([A-C])$/.exec(mainIdOf(oid))?.[1];

/** One object whose combined spectral type lists two or three stars ("L7.5+T0.5"), split into them. */
function splitPair(oid: number): string[] | null {
  const sp = str(basic.get(oid)?.sp_type);
  if (!sp || members.has(oid)) return null;
  const parts = sp.split('+').map((p) => p.trim());
  if (parts.length < 2 || parts.length > 3 || !parts.every((p) => /^(sd|d)?[OBAFGKMLTY]\d|^D[ABCOQZX]/i.test(p))) return null;
  return parts;
}

/** A member's spectral type from its multiple-star parent's combined one ("M5.5Ve+M7Ve" for Wolf 424 A and B). */
function spectralFromParent(oid: number): string | undefined {
  const letter = letterOf(oid);
  if (!letter) return undefined;
  for (const p of starParents.get(oid) ?? []) {
    const parts = (str(basic.get(p)?.sp_type) ?? '').split('+').map((x) => x.trim()).filter(Boolean);
    const i = letter.charCodeAt(0) - 65;
    if (parts.length >= 2 && parts[i] && /^(sd|d)?[OBAFGKMLTY]\d|^D[ABCOQZX]/i.test(parts[i]!)) return parts[i];
  }
  return undefined;
}

function makeStar(oid: number, name: string, systemId: string, role: StarInput['role'], parentId: string | undefined, spOverride?: string, noteExtra?: string): StarInput | null {
  const a = astrometryOf(oid);
  const sp = spectralOf(oid);
  spOverride ??= sp ? undefined : spectralFromParent(oid);
  const main = mainIdOf(oid);
  const spectralType = spOverride ?? sp?.type ?? 'unknown';
  const id = unique(slug(name), usedStarIds);
  const hip = hipOf(oid);
  const gj = gjOf(oid);
  const star: StarInput = {
    id,
    name,
    systemId,
    role,
    ...(parentId ? { parentId } : {}),
    catalogIds: { simbad: main, ...(a?.gaiaId ? { gaiaDr3: `Gaia DR3 ${a.gaiaId}` } : {}), ...(hip ? { hip } : {}), ...(gj ? { gliese: gj } : {}) },
    spectralType,
    spectralTypeSource: sp?.source ?? { label: 'SIMBAD', url: simbadUrl(main), recordId: main, retrieved },
    raDegrees: a?.raDegrees ?? num(basic.get(oid)?.ra) ?? 0,
    decDegrees: a?.decDegrees ?? num(basic.get(oid)?.dec) ?? 0,
    epoch: a?.epoch ?? 2000,
    pmRaMasYr: a?.pmRaMasYr ?? num(basic.get(oid)?.pmra) ?? 0,
    pmDecMasYr: a?.pmDecMasYr ?? num(basic.get(oid)?.pmdec) ?? 0,
    parallaxMas: a?.parallaxMas ?? NaN,
    ...(a?.parallaxErrorMas !== undefined ? { parallaxErrorMas: a.parallaxErrorMas } : {}),
    positionSource: a?.positionSource ?? { label: 'SIMBAD', url: simbadUrl(main), recordId: main, retrieved },
    parallaxSource: a?.parallaxSource ?? { label: 'SIMBAD', url: simbadUrl(main), recordId: main, retrieved },
    ...(noteExtra ? { positionNote: noteExtra } : {}),
    colorHex: colourFor(spectralType),
  };
  if (!a && role === 'primary') return null;
  (star as StarInput & { notes?: string[] }).notes = a ? a.notes : [`SIMBAD gives no parallax for ${main}`];
  oidOfStar.set(id, oid);
  return star;
}

/** The stars one SIMBAD object stands for: itself, or the two halves of a catalogued pair. */
function starsFor(oid: number, name: string, systemId: string, role: StarInput['role'], parentId: string | undefined): StarInput[] {
  const halves = splitPair(oid);
  if (!halves) {
    const s = makeStar(oid, name, systemId, role, parentId);
    return s ? [s] : [];
  }
  const suffix = /[A-C]$/.test(name) ? ['a', 'b', 'c'] : [' A', ' B', ' C'];
  const note = `One of the ${halves.length === 2 ? 'pair' : 'triple'} SIMBAD lists as ${mainIdOf(oid)} (${String(basic.get(oid)?.sp_type)}); plotted at its position.`;
  const first = makeStar(oid, `${name}${suffix[0]}`, systemId, role, parentId, halves[0], note);
  if (!first) return [];
  const rest = halves.slice(1).map((sp, i) => makeStar(oid, `${name}${suffix[i + 1]}`, systemId, 'companion', first.id, sp, note));
  return [first, ...rest.filter((x): x is StarInput => !!x)];
}

/** A system's stars in order: those with a parallax, by their SIMBAD letter (A, B, C) when they have one, else brightest first. */
const byBrightness = (list: readonly number[]) =>
  [...list].sort((a, b) => {
    const la = letterOf(a);
    const lb = letterOf(b);
    return Number(plxOf(b) !== null) - Number(plxOf(a) !== null) || (la && lb ? la.localeCompare(lb) : 0) || magnitude(a) - magnitude(b) || a - b;
  });

for (const [, list] of [...groups].sort((x, y) => x[0] - y[0])) {
  const gameMembers = list.filter((o) => gameByOid.has(o));
  const fresh = byBrightness(list.filter((o) => !gameByOid.has(o)));
  if (!fresh.length) continue;
  if (gameMembers.length) {
    // New stars of a system the game has: they join it.
    const systemId = verifiedStars.find((s) => s.id === gameByOid.get(gameMembers[0]!))!.systemId;
    const sys = gameSystems.get(systemId)!;
    const primary = verifiedStars.find((s) => sys.componentIds.includes(s.id) && s.role === 'primary') ?? verifiedStars.find((s) => s.id === sys.componentIds[0])!;
    const taken = new Set(sys.componentIds.map((id) => verifiedStars.find((s) => s.id === id)!.name.slice(-1)));
    for (const oid of fresh) {
      const own = properName(oid);
      let letter = letterOf(oid);
      if (!letter || taken.has(letter)) letter = ['B', 'C', 'D', 'E'].find((l) => !taken.has(l)) ?? 'E';
      taken.add(letter);
      const name = own && !CATALOGUE.test(own) ? own : `${sys.name} ${letter}`;
      const stars = starsFor(oid, name, systemId, 'companion', primary.id);
      newStars.push(...stars);
      additions.set(systemId, [...(additions.get(systemId) ?? []), ...stars.map((s) => s.id)]);
    }
    continue;
  }
  const primaryOid = fresh[0]!;
  if (plxOf(primaryOid) === null) {
    skipped.push(`${mainIdOf(primaryOid)}: no parallax in SIMBAD or Gaia DR3`);
    continue;
  }
  const host = fresh.map((o) => nasaHostName(o)).find((n) => !!n);
  const displayName = systemNameOf(fresh, host);
  const systemId = unique(slug(displayName), usedSystemIds);
  const stars: StarInput[] = [];
  // Letters SIMBAD gives are kept; the others take the next free ones, a split pair one each.
  const letters = new Set(fresh.map((o) => letterOf(o)).filter((l): l is string => !!l));
  const nextLetter = () => {
    const l = ['A', 'B', 'C', 'D', 'E', 'F'].find((x) => !letters.has(x))!;
    letters.add(l);
    return l;
  };
  const single = fresh.length === 1 && !splitPair(fresh[0]!);
  for (const [i, oid] of fresh.entries()) {
    const own = properName(oid);
    const role = i === 0 ? 'primary' : 'companion';
    const parent = i === 0 ? undefined : stars[0]?.id;
    if (single) {
      stars.push(...starsFor(oid, displayName, systemId, role, parent));
      continue;
    }
    if (own && !CATALOGUE.test(own) && own !== displayName && !splitPair(oid)) {
      stars.push(...starsFor(oid, own, systemId, role, parent));
      continue;
    }
    const letter = letterOf(oid);
    const halves = splitPair(oid);
    if (halves && !letter) {
      // An unlettered pair: its stars are A and B (and C) of the system.
      const names = halves.map(() => `${displayName} ${nextLetter()}`);
      const note = `One of the ${halves.length === 2 ? 'pair' : 'triple'} SIMBAD lists as ${mainIdOf(oid)} (${String(basic.get(oid)?.sp_type)}); plotted at its position.`;
      const first = makeStar(oid, names[0]!, systemId, role, parent, halves[0], note);
      if (!first) continue;
      stars.push(first);
      for (const [k, sp] of halves.slice(1).entries()) {
        const x = makeStar(oid, names[k + 1]!, systemId, 'companion', stars[0]!.id, sp, note);
        if (x) stars.push(x);
      }
      continue;
    }
    stars.push(...starsFor(oid, `${displayName} ${letter ?? nextLetter()}`, systemId, role, parent));
  }
  if (!stars.length) {
    skipped.push(`${mainIdOf(primaryOid)}: no usable astrometry`);
    continue;
  }
  newStars.push(...stars);
  newSystems.push({ id: systemId, displayName, referenceComponentId: stars[0]!.id, componentIds: stars.map((s) => s.id), addedBy: ADDED_BY });
}
settleCompanions([...verifiedStars, ...newStars]);
for (const s of newStars) delete (s as StarInput & { notes?: string[] }).notes;

// ---------------------------------------------------------------- planets

interface Measured {
  value: number;
  error?: number;
  qualifier?: string;
}
type PlanetStatus = 'confirmed' | 'contested' | 'candidate';
/** A planet as scripts/build-dataset.ts reads it. */
interface PlanetInput {
  id?: string;
  archiveName: string;
  hostId: string;
  displayName?: string;
  discoveryYear?: number;
  discoveryMethod?: string;
  controversial: boolean;
  status?: PlanetStatus;
  statusNote?: string;
  orbitalPeriodDays?: Measured;
  semiMajorAxisAu?: Measured;
  massEarth?: Measured;
  radiusEarth?: Measured;
  source?: SourceRef;
}

const planetSlug = (archiveName: string) => slug(archiveName);
const gamePlanets: PlanetInput[] = [
  ...readJson<{ planets: PlanetInput[] }>('data/provisional/exoplanets-input.json').planets,
  ...readJson<{ planets: PlanetInput[] }>('data/provisional/catalog-exoplanets-input.json').planets,
];
const allStars = [...verifiedStars, ...newStars];
const starById = new Map(allStars.map((s) => [s.id, s]));
const starOfOid = new Map([...oidOfStar].map(([id, oid]) => [oid, id]));
const letterOfPlanet = (name: string) => /\s([b-z])$/.exec(name.trim())?.[1];
const close = (a: number | undefined, b: number | undefined, tol: number) => a !== undefined && b !== undefined && Math.abs(a - b) / Math.max(a, b) <= tol;

/** The Encyclopaedia's rows, with their host resolved (by name, or by position when the name fails). */
const euRows = worked('exoplanet-eu-neighbourhood') ? load('exoplanet-eu-neighbourhood') : load('exoplanet-eu-neighbourhood-http');
const pick = (r: Row, keys: readonly string[]) => keys.map((k) => r[k]).find((v) => v !== null && v !== undefined && v !== '');
interface EuPlanet {
  name: string;
  /** Its status when the service gives one (the EPN-TAP table lists only the planets it accepts). */
  status: string;
  /** Jupiter masses (true or minimum), to tell brown dwarfs from planets. */
  jupiterMasses?: number;
  hostStarId?: string;
  period?: number;
  sma?: number;
  massEarth?: number;
  msini?: boolean;
  radiusEarth?: number;
  year?: number;
  method?: string;
  url?: string;
}
const JUPITER_EARTH_MASSES = 317.8284;
const JUPITER_EARTH_RADII = 11.2089;
const euPlanets: EuPlanet[] = euRows.map((r) => {
  const starName = str(pick(r, ['star_name', 'host_name', 'star']));
  let oid = resolveHost([starName, str(pick(r, ['star_alt_names', 'star_alternate_names']))?.split(',')[0]]);
  const ra = num(pick(r, ['ra', 's_ra']));
  const dec = num(pick(r, ['dec', 's_dec']));
  if (oid === undefined && ra !== null && dec !== null) {
    let best = Infinity;
    for (const [o, b] of basic) {
      if (!starOfOid.has(o)) continue;
      const d = Math.hypot((num(b.ra)! - ra) * Math.cos((dec * Math.PI) / 180), num(b.dec)! - dec) * 3600;
      if (d < 60 && d < best) {
        best = d;
        oid = o;
      }
    }
  }
  const mass = num(pick(r, ['mass']));
  const msini = num(pick(r, ['mass_sin_i']));
  const radius = num(pick(r, ['radius']));
  return {
    name: String(pick(r, ['target_name', 'planet_name', 'name']) ?? '').trim(),
    status: String(pick(r, ['planet_status', 'status']) ?? '').trim(),
    ...(mass !== null || msini !== null ? { jupiterMasses: (mass ?? msini)! } : {}),
    ...(oid !== undefined && starOfOid.has(oid) ? { hostStarId: starOfOid.get(oid)! } : {}),
    ...(num(pick(r, ['period', 'orbital_period'])) !== null ? { period: num(pick(r, ['period', 'orbital_period']))! } : {}),
    ...(num(pick(r, ['semi_major_axis'])) !== null ? { sma: num(pick(r, ['semi_major_axis']))! } : {}),
    ...(mass !== null ? { massEarth: mass * JUPITER_EARTH_MASSES } : msini !== null ? { massEarth: msini * JUPITER_EARTH_MASSES, msini: true } : {}),
    ...(radius !== null ? { radiusEarth: radius * JUPITER_EARTH_RADII } : {}),
    ...(num(pick(r, ['discovered', 'discovery_year'])) !== null ? { year: num(pick(r, ['discovered', 'discovery_year']))! } : {}),
    ...(str(pick(r, ['detection_type', 'detection_method'])) ? { method: str(pick(r, ['detection_type', 'detection_method']))! } : {}),
    // The Encyclopaedia serves its pages over HTTPS too.
    ...(str(pick(r, ['external_link', 'url'])) ? { url: str(pick(r, ['external_link', 'url']))!.replace(/^http:\/\/exoplanet\.eu/, 'https://exoplanet.eu') } : {}),
  };
});

interface NasaPlanet {
  row: Row;
  name: string;
  letter: string;
  hostStarId?: string;
  period?: number;
  controversial: boolean;
}
const nasaPlanets: NasaPlanet[] = nasaRows.map((r) => {
  const oid = nasaHost.get(r);
  return {
    row: r,
    name: String(r.pl_name),
    letter: String(r.pl_letter ?? letterOfPlanet(String(r.pl_name)) ?? ''),
    ...(oid !== undefined && starOfOid.has(oid) ? { hostStarId: starOfOid.get(oid)! } : {}),
    ...(num(r.pl_orbper) !== null ? { period: num(r.pl_orbper)! } : {}),
    controversial: num(r.pl_controv_flag) === 1,
  };
});

/** The same planet in two lists: same host star (or system), and the same letter or orbital period. */
function samePlanet(hostA: string | undefined, letterA: string | undefined, periodA: number | undefined, hostB: string | undefined, letterB: string | undefined, periodB: number | undefined): boolean {
  if (!hostA || !hostB) return false;
  const sysA = starById.get(hostA)?.systemId;
  const sysB = starById.get(hostB)?.systemId;
  if (hostA !== hostB && !(sysA && sysA === sysB)) return false;
  // A planet's letter is its name at its star: the same letter is the same planet, even with a revised orbit.
  if (letterA && letterA === letterB && hostA === hostB) return true;
  return close(periodA, periodB, 0.1);
}

const nasaMeasured = (r: Row, v: string, e: string, unit?: 'mass'): Measured | undefined => {
  const value = num(r[v]);
  if (value === null) return undefined;
  const err = num(r[e]);
  return {
    value,
    ...(err !== null ? { error: Math.abs(err) } : {}),
    ...(unit === 'mass' && String(r.pl_bmassprov ?? '').toLowerCase().includes('sin') ? { qualifier: 'minimum mass (M sin i)' } : {}),
  };
};
const fromNasa = (r: Row) => ({
  ...(num(r.disc_year) !== null ? { discoveryYear: num(r.disc_year)! } : {}),
  ...(str(r.discoverymethod) ? { discoveryMethod: str(r.discoverymethod)! } : {}),
  ...(nasaMeasured(r, 'pl_orbper', 'pl_orbpererr1') ? { orbitalPeriodDays: nasaMeasured(r, 'pl_orbper', 'pl_orbpererr1')! } : {}),
  ...(nasaMeasured(r, 'pl_orbsmax', 'pl_orbsmaxerr1') ? { semiMajorAxisAu: nasaMeasured(r, 'pl_orbsmax', 'pl_orbsmaxerr1')! } : {}),
  ...(nasaMeasured(r, 'pl_bmasse', 'pl_bmasseerr1', 'mass') ? { massEarth: nasaMeasured(r, 'pl_bmasse', 'pl_bmasseerr1', 'mass')! } : {}),
  ...(nasaMeasured(r, 'pl_rade', 'pl_radeerr1') ? { radiusEarth: nasaMeasured(r, 'pl_rade', 'pl_radeerr1')! } : {}),
});
const nasaSource = (name: string): SourceRef => ({ label: 'NASA Exoplanet Archive', url: `https://exoplanetarchive.ipac.caltech.edu/overview/${encodeURIComponent(name)}`, recordId: name, retrieved });
const euSource = (p: EuPlanet): SourceRef => ({ label: 'The Extrasolar Planets Encyclopaedia', url: p.url ?? 'https://exoplanet.eu/catalog/', recordId: p.name, retrieved });
const euWords = (status: string) => status.toLowerCase();

const planets: PlanetInput[] = [];
/** Planet ids share one namespace with star ids (the codex keys bodies by id). */
const usedPlanetIds = new Set<string>(allStars.map((s) => s.id));
const usedNasa = new Set<NasaPlanet>();
const usedEu = new Set<EuPlanet>();
interface PlanetChange {
  name: string;
  host: string;
  what: string;
}
const planetChanges: PlanetChange[] = [];

// 1. Every planet the game has stays, checked against both archives.
for (const p of gamePlanets) {
  const id = p.id ?? planetSlug(p.archiveName);
  usedPlanetIds.add(id);
  const letter = letterOfPlanet(p.archiveName);
  const period = p.orbitalPeriodDays?.value;
  const nasa = nasaPlanets.find((n) => !usedNasa.has(n) && samePlanet(p.hostId, letter, period, n.hostStarId, n.letter, n.period));
  const eu = euPlanets.find((e) => !usedEu.has(e) && samePlanet(p.hostId, letter, period, e.hostStarId, letterOfPlanet(e.name), e.period));
  if (eu) usedEu.add(eu);
  // The game says "Proxima Centauri b", not the archive's "Proxima Cen b": its host star's name and the letter.
  const displayName = p.displayName ?? `${starById.get(p.hostId)?.name ?? p.archiveName.replace(/ [a-z]$/, '')} ${letter}`;
  if (nasa) {
    usedNasa.add(nasa);
    const status: PlanetStatus = nasa.controversial ? 'contested' : 'confirmed';
    planets.push({
      id,
      archiveName: nasa.name,
      hostId: p.hostId,
      displayName,
      controversial: nasa.controversial,
      status,
      ...(nasa.controversial ? { statusNote: `The NASA Exoplanet Archive lists ${nasa.name} but flags it as controversial${eu ? `; the Encyclopaedia calls it ${euWords(eu.status)}` : ''}. This edition of the game keeps it.` } : {}),
      ...fromNasa(nasa.row),
      source: nasaSource(nasa.name),
    });
    planetChanges.push({ name: displayName, host: p.hostId, what: nasa.controversial ? `confirmed by NASA as ${nasa.name}, flagged controversial` : `confirmed by NASA as ${nasa.name}` });
    continue;
  }
  const note = eu
    ? /retract/i.test(eu.status)
      ? `The NASA Exoplanet Archive does not list it, and the Encyclopaedia marks ${eu.name} as retracted: later work found no planet. This edition of the game keeps it.`
      : `The NASA Exoplanet Archive does not list it; the Extrasolar Planets Encyclopaedia lists it as ${eu.name}${eu.status ? ` (${euWords(eu.status)})` : ''}. This edition of the game keeps it.`
    : `Neither the NASA Exoplanet Archive nor the Encyclopaedia lists it on ${retrieved}. This edition of the game keeps it.`;
  planets.push({ ...p, id, controversial: true, status: 'contested', statusNote: note });
  planetChanges.push({ name: displayName, host: p.hostId, what: `contested: ${note}` });
}

// 2. Confirmed planets the game lacks, from the NASA archive.
const nameFor = (hostId: string, letter: string) => `${starById.get(hostId)!.name} ${letter}`;
for (const n of nasaPlanets) {
  if (usedNasa.has(n)) continue;
  if (!n.hostStarId) {
    planetChanges.push({ name: n.name, host: String(n.row.hostname), what: 'not added: its host is not among the stars within reach' });
    continue;
  }
  usedNasa.add(n);
  const eu = euPlanets.find((e) => !usedEu.has(e) && samePlanet(n.hostStarId, n.letter, n.period, e.hostStarId, letterOfPlanet(e.name), e.period));
  if (eu) usedEu.add(eu);
  const displayName = nameFor(n.hostStarId, n.letter || 'b');
  const id = unique(slug(displayName), usedPlanetIds);
  planets.push({
    id,
    archiveName: n.name,
    hostId: n.hostStarId,
    displayName,
    controversial: n.controversial,
    status: n.controversial ? 'contested' : 'confirmed',
    ...(n.controversial ? { statusNote: `The NASA Exoplanet Archive lists ${n.name} but flags it as controversial. This edition of the game keeps it.` } : {}),
    ...fromNasa(n.row),
    source: nasaSource(n.name),
  });
  planetChanges.push({ name: displayName, host: n.hostStarId, what: `new: ${n.controversial ? 'listed (controversial)' : 'confirmed'} by NASA as ${n.name}` });
}

// 3. The Encyclopaedia's planets neither the game nor NASA has: candidates and its own confirmations.
/** Above this many Jupiter masses a companion burns deuterium: a brown dwarf, not a planet. */
const BROWN_DWARF_MJ = 13;
for (const e of euPlanets) {
  if (usedEu.has(e) || !e.name) continue;
  if ((e.jupiterMasses ?? 0) > BROWN_DWARF_MJ) {
    planetChanges.push({ name: e.name, host: e.hostStarId ?? '?', what: `not added as a planet: ${e.jupiterMasses!.toFixed(0)} Jupiter masses is a brown dwarf (the game shows brown dwarfs as stars)` });
    continue;
  }
  if (/retract/i.test(e.status)) {
    planetChanges.push({ name: e.name, host: e.hostStarId ?? '?', what: 'not added: retracted' });
    continue;
  }
  if (!e.hostStarId) {
    planetChanges.push({ name: e.name, host: '?', what: 'not added: its host is not among the stars within reach' });
    continue;
  }
  const letter = letterOfPlanet(e.name) ?? 'b';
  const displayName = nameFor(e.hostStarId, letter);
  // The same letter at the same star is the same planet, whatever its orbit fits say.
  if (planets.some((p) => p.hostId === e.hostStarId && (letterOfPlanet(p.archiveName) === letter || letterOfPlanet(p.displayName ?? '') === letter))) continue;
  const id = unique(slug(displayName), usedPlanetIds);
  const candidate = /candidate|unconfirmed/i.test(e.status);
  const statusNote = candidate
    ? `A candidate planet in the Encyclopaedia (${e.name}); not confirmed. This edition of the game includes it.`
    : `The Extrasolar Planets Encyclopaedia lists ${e.name}${e.status ? ` (${euWords(e.status)})` : ''}; the NASA Exoplanet Archive does not confirm it. This edition of the game includes it.`;
  planets.push({
    id,
    archiveName: e.name,
    hostId: e.hostStarId,
    displayName,
    controversial: true,
    status: candidate ? 'candidate' : 'contested',
    statusNote,
    ...(e.year ? { discoveryYear: e.year } : {}),
    ...(e.method ? { discoveryMethod: e.method } : {}),
    ...(e.period !== undefined ? { orbitalPeriodDays: { value: e.period } } : {}),
    ...(e.sma !== undefined ? { semiMajorAxisAu: { value: e.sma } } : {}),
    ...(e.massEarth !== undefined ? { massEarth: { value: Math.round(e.massEarth * 1000) / 1000, ...(e.msini ? { qualifier: 'minimum mass (M sin i)' } : {}) } } : {}),
    ...(e.radiusEarth !== undefined ? { radiusEarth: { value: Math.round(e.radiusEarth * 1000) / 1000 } } : {}),
    source: euSource(e),
  });
  planetChanges.push({ name: displayName, host: e.hostStarId, what: `new ${candidate ? 'candidate' : 'contested planet'} from the Encyclopaedia (${e.name}${e.status ? `, ${e.status}` : ''})` });
}

// ---------------------------------------------------------------- belts and debris discs

interface BeltInput {
  id: string;
  systemId: string;
  /** The star it circles. */
  hostId: string;
  name: string;
  kind: 'asteroid-belt' | 'kuiper-belt' | 'debris-disc';
  /** Only when the cited source gives the extent. */
  innerAu?: number;
  outerAu?: number;
  sources: SourceRef[];
  note: string;
}

const NASA_ASTEROIDS: SourceRef = { label: 'NASA: Asteroids', url: 'https://science.nasa.gov/solar-system/asteroids/' };
const NASA_KUIPER: SourceRef = { label: 'NASA: Kuiper Belt', url: 'https://science.nasa.gov/solar-system/kuiper-belt/' };
const NASA_EPS_ERI: SourceRef = { label: 'NASA: SOFIA observations of Epsilon Eridani', url: 'https://science.nasa.gov/universe/exoplanets/sofia-confirms-nearby-planetary-system-is-similar-to-our-own/' };

const belts: BeltInput[] = [
  {
    id: 'sol-main-belt',
    systemId: 'sol',
    hostId: 'sun',
    name: 'Main asteroid belt',
    kind: 'asteroid-belt',
    innerAu: 2.2,
    outerAu: 3.2,
    sources: [NASA_ASTEROIDS],
    note: 'The main asteroid belt lies between the orbits of Mars and Jupiter.',
  },
  {
    id: 'sol-kuiper-belt',
    systemId: 'sol',
    hostId: 'sun',
    name: 'Kuiper Belt',
    kind: 'kuiper-belt',
    innerAu: 30,
    outerAu: 50,
    sources: [NASA_KUIPER],
    note: 'A ring of icy bodies beyond the orbit of Neptune.',
  },
];

const GREEK_WORDS: Record<string, string> = { α: 'alpha', β: 'beta', γ: 'gamma', δ: 'delta', ε: 'epsilon', ζ: 'zeta', η: 'eta', θ: 'theta', ι: 'iota', κ: 'kappa', λ: 'lambda', μ: 'mu', ν: 'nu', ξ: 'xi', ο: 'omicron', π: 'pi', ρ: 'rho', σ: 'sigma', τ: 'tau', υ: 'upsilon', φ: 'phi', χ: 'chi', ψ: 'psi', ω: 'omega' };
/** Titles as plain words: LaTeX and Greek letters spelled out, abbreviations expanded. */
function plain(text: string): string {
  let t = text.replace(/\\?\$|\\|[{}]/g, ' ');
  for (const [g, w] of Object.entries(GREEK_WORDS)) t = t.split(g).join(` ${w} `);
  t = t.replace(/\b(varepsilon|epsilon|eps)\b/gi, 'epsilon');
  for (const [abbr, word] of Object.entries(GREEK)) t = t.replace(new RegExp(`\\b${abbr.replace('.', '\\.?')}(?=\\s)`, 'g'), word.toLowerCase());
  for (const [abbr, gen] of Object.entries(GENITIVE)) t = t.replace(new RegExp(`\\b${abbr}\\b`, 'g'), gen);
  return t.toLowerCase().replace(/[^a-z0-9+\- ]+/g, ' ').replace(/\s+/g, ' ').trim();
}
const DISC_WORDS = /\b(debris (disk|disc|ring|belt)s?|dust (ring|belt|disk|disc)s?|kuiper belt|exo-kuiper|planetesimal belt|exozodiacal|cold dust|warm dust|infrared excess)\b/;
const NEGATIVE = /\b(search(es)? for|upper limits?|limits on|constraints on|presence of|no evidence|non-detection|absence of|lack of|survey of)\b/;

/** Every name a star goes by in titles: its game name, SIMBAD identifiers and their spelled-out forms. */
function titleNames(starIds: readonly string[], systemName: string): string[] {
  const names = new Set<string>([plain(systemName)]);
  for (const id of starIds) {
    const s = starById.get(id);
    if (s) names.add(plain(s.name));
    const oid = oidOfStar.get(id);
    if (oid === undefined) continue;
    for (const raw of idsOf(oid)) {
      const clean = raw.replace(/\s+/g, ' ').replace(/^(\*|V\*|NAME|\*\*) /, '');
      if (/^(Gaia|TIC|2MASS|WISE|UCAC|TYC|USNO|PPM|AG|UBV|GEN#|\[|LSPM|NLTT|ASCC|PLX|CSI|GCRV|IRAS|RX|1RXS|2RE|RE|EUVE|2EUVE|JP11|Zkh|GAT|IDS|CCDM|WDS|LFT|LTT|Ci 20|BD|CD|CPD|SAO|FK5|N30|PM|APASS|GALEX|SKY#|8pc|CNS)/.test(clean)) continue;
      if (clean.length >= 4) names.add(plain(clean));
    }
  }
  return [...names].filter((n) => n.length >= 3);
}

const allSystems: { id: string; name: string; starIds: string[] }[] = [
  ...[...gameSystems].map(([id, s]) => ({ id, name: s.name, starIds: [...s.componentIds, ...(additions.get(id) ?? [])] })),
  ...newSystems.map((s) => ({ id: s.id, name: s.displayName, starIds: s.componentIds })),
];
const discFinds: { system: string; papers: { bibcode: string; title: string; year: number | null }[] }[] = [];
for (const sys of allSystems) {
  const names = titleNames(sys.starIds, sys.name);
  const papers = new Map<string, { bibcode: string; title: string; year: number | null; host: string }>();
  for (const starId of sys.starIds) {
    const oid = oidOfStar.get(starId);
    if (oid === undefined) continue;
    for (const ref of discRefs.get(oid) ?? []) {
      const t = ` ${plain(ref.title)} `;
      if (!DISC_WORDS.test(t) || NEGATIVE.test(t)) continue;
      if (!names.some((n) => t.includes(` ${n} `))) continue;
      if (!papers.has(ref.bibcode)) papers.set(ref.bibcode, { ...ref, host: starId });
    }
  }
  if (!papers.size) continue;
  const list = [...papers.values()].sort((a, b) => (a.year ?? 9999) - (b.year ?? 9999) || a.bibcode.localeCompare(b.bibcode));
  discFinds.push({ system: sys.name, papers: list });
  if (sys.id === 'sol') continue;
  const first = list[0]!;
  const latest = list.at(-1)!;
  const cite = (p: typeof first): SourceRef => ({ label: `${p.title.replace(/\.$/, '')} (${p.year ?? 'n.d.'})`, url: adsUrl(p.bibcode), bibcode: p.bibcode, retrieved });
  belts.push({
    id: `${sys.id}-debris-disc`,
    systemId: sys.id,
    hostId: first.host,
    // Named for the star it circles when the system has more than one ("Proxima Centauri debris disc").
    name: sys.id === 'epsilon-eridani' ? 'Epsilon Eridani belts' : `${sys.starIds.length > 1 ? (starById.get(first.host)?.name ?? sys.name) : sys.name} debris disc`,
    kind: 'debris-disc',
    sources: [...(sys.id === 'epsilon-eridani' ? [NASA_EPS_ERI] : []), cite(first), ...(latest !== first ? [cite(latest)] : [])],
    note: `${list.length} paper${list.length === 1 ? '' : 's'} linked to this star in SIMBAD report${list.length === 1 ? 's' : ''} dust around it; the belt's place in the game is schematic.`,
  });
}

// ---------------------------------------------------------------- the Solar System on the real date

interface Elements {
  a: [number, number];
  e: [number, number];
  I: [number, number];
  L: [number, number];
  varpi: [number, number];
  Omega: [number, number];
}
const JPL_BODIES: Record<string, string> = { Mercury: 'mercury', Venus: 'venus', 'EM Bary': 'earth', Mars: 'mars', Jupiter: 'jupiter', Saturn: 'saturn', Uranus: 'uranus', Neptune: 'neptune' };
let solar: { source: SourceRef; validYears: [number, number]; frame: string; elements: Record<string, Elements>; accuracy: Record<string, { lonArcsec: number; latArcsec: number; distKm: number }>; checks: { body: string; jd: number; xyzAu: [number, number, number] }[] } | null = null;
{
  const page = manifest.queries.find((q) => q.label === 'jpl-approx-pos-page' && q.ok);
  if (page) {
    const html = readFileSync(resolve(raw, page.file), 'utf8');
    const text = html.replace(/<[^>]+>/g, ' ').replace(/&[a-z]+;|&#\d+;/g, ' ');
    const t1 = text.indexOf('Table 1');
    const t2 = text.indexOf('Table 2a', t1);
    const block = text.slice(t1, t2);
    const elements: Record<string, Elements> = {};
    for (const [label, body] of Object.entries(JPL_BODIES)) {
      const m = new RegExp(`${label.replace(' ', '\\s+')}\\s+${'(-?[\\d.]+)\\s+'.repeat(12)}`).exec(block + ' ');
      if (!m) continue;
      const v = m.slice(1, 13).map(Number);
      elements[body] = { a: [v[0]!, v[6]!], e: [v[1]!, v[7]!], I: [v[2]!, v[8]!], L: [v[3]!, v[9]!], varpi: [v[4]!, v[10]!], Omega: [v[5]!, v[11]!] };
    }
    const accuracy: Record<string, { lonArcsec: number; latArcsec: number; distKm: number }> = {};
    const acc = text.slice(text.indexOf('Accuracy'), text.indexOf('Formulae'));
    for (const [label, body] of Object.entries(JPL_BODIES)) {
      const m = new RegExp(`${label.replace(' ', '\\s+')}[^\\d]*?(\\d+)\\s+(\\d+)\\s+(\\d+)`).exec(acc);
      if (m) accuracy[body] = { lonArcsec: Number(m[1]), latArcsec: Number(m[2]), distKm: Number(m[3]) * 1000 };
    }
    const checks: { body: string; jd: number; xyzAu: [number, number, number] }[] = [];
    for (const q of manifest.queries.filter((x) => x.ok && x.label.startsWith('jpl-horizons-'))) {
      const m = /^jpl-horizons-(.+)-(\d+\.\d+)$/.exec(q.label);
      if (!m) continue;
      const result = String((JSON.parse(readFileSync(resolve(raw, q.file), 'utf8')) as { result?: string }).result ?? '');
      const row = result.slice(result.indexOf('$$SOE') + 5).trim().split('\n')[0]!.split(',').map((c) => c.trim());
      const xyz = row.slice(2, 5).map(Number);
      if (xyz.length === 3 && xyz.every(Number.isFinite)) checks.push({ body: m[1] === 'earth-moon-barycenter' ? 'earth' : m[1]!, jd: Number(row[0]), xyzAu: xyz as [number, number, number] });
    }
    if (Object.keys(elements).length === 8) {
      solar = {
        source: { label: 'JPL Solar System Dynamics: Approximate Positions of the Planets (Standish & Williams)', url: 'https://ssd.jpl.nasa.gov/planets/approx_pos.html', retrieved },
        validYears: [1800, 2050],
        frame: 'mean ecliptic and equinox of J2000; a in au, angles in degrees, rates per Julian century from J2000.0',
        elements,
        accuracy,
        checks: checks.sort((a, b) => a.body.localeCompare(b.body) || a.jd - b.jd),
      };
    }
  }
}

// ---------------------------------------------------------------- far stars (docs/ASTRONOMY_SOURCES.md, *Far stars*)

/** A far star as scripts/build-dataset.ts reads it. */
interface FarStarInput {
  id: string;
  name: string;
  designation: string;
  catalogIds: { hip?: string; simbad?: string; gaiaDr3?: string };
  spectralType: string;
  raDegrees: number;
  decDegrees: number;
  epoch: number;
  pmRaMasYr: number;
  pmDecMasYr: number;
  parallaxMas: number;
  parallaxErrorMas?: number;
  magnitudeV: number;
  positionSource: SourceRef;
  parallaxSource: SourceRef;
  spectralTypeSource: SourceRef;
  magnitudeSource: SourceRef;
  colorHex: string;
}

const farPath = resolve(root, 'data/provisional/far-stars-input.json');
const farProvisional = existsSync(farPath) ? readJson<{ stars: FarStarInput[] }>('data/provisional/far-stars-input.json').stars : [];
const farOid = (f: FarStarInput) => {
  const oids = candidateIdents(f as unknown as StarInput).flatMap((id) => [...(byIdent.get(norm(id)) ?? [])]);
  return oids.find((o) => otypeOf(o) !== '**') ?? oids[0];
};
/**
 * A snapshot from before the far stars were asked for leaves their provisional values in place. So
 * does one where SIMBAD gave nothing usable for any of them (the file's kind says whether all its
 * stars are verified, so it is all of them or none), and the report says which.
 */
const farAsked = farProvisional.length > 0 && farProvisional.some((f) => farOid(f) !== undefined);
const farMissing = farProvisional.filter((f) => {
  const oid = farOid(f);
  return oid === undefined || !astrometryOf(oid);
});
const farVerified: FarStarInput[] = [];
const farNotes: string[] = [];
if (farAsked && !farMissing.length) {
  for (const f of farProvisional) {
    const oid = farOid(f)!;
    const astro = astrometryOf(oid)!;
    const sp = spectralOf(oid);
    const vFlux = load('simbad-fluxes').find((r) => num(r.oidref) === oid && str(r.filter) === 'V' && num(r.flux) !== null);
    const vBib = vFlux ? str(vFlux.bibcode) : null;
    const main = mainIdOf(oid);
    const verified: FarStarInput = {
      ...f,
      raDegrees: astro.raDegrees,
      decDegrees: astro.decDegrees,
      epoch: astro.epoch,
      pmRaMasYr: astro.pmRaMasYr,
      pmDecMasYr: astro.pmDecMasYr,
      parallaxMas: astro.parallaxMas,
      ...(astro.parallaxErrorMas !== undefined ? { parallaxErrorMas: astro.parallaxErrorMas } : {}),
      positionSource: astro.positionSource,
      parallaxSource: astro.parallaxSource,
      ...(sp ? { spectralType: sp.type, spectralTypeSource: sp.source } : {}),
      ...(vFlux
        ? { magnitudeV: num(vFlux.flux)!, magnitudeSource: { label: vBib ? `SIMBAD: ${bibLabel(vBib)}` : 'SIMBAD', url: vBib ? adsUrl(vBib) : simbadUrl(main), recordId: main, retrieved, ...(vBib ? { bibcode: vBib } : {}) } }
        : {}),
    };
    farVerified.push(verified);
    farNotes.push(`${f.name} (${main}): ${parallaxToLightYears(f.parallaxMas).toFixed(1)} → ${parallaxToLightYears(astro.parallaxMas).toFixed(1)} ly; ${astro.positionSource.label}${astro.notes.length ? `; ${astro.notes.join('; ')}` : ''}`);
  }
}

// ---------------------------------------------------------------- writing

const write = (name: string, data: unknown) => writeFileSync(resolve(root, 'data/snapshot', name), typeof data === 'string' ? data : JSON.stringify(data, null, 2) + '\n');

const usedGaia = allStars.filter((s) => s.positionSource.label === 'Gaia DR3').length;
write('astrometry-input.json', {
  kind: 'snapshot',
  retrieved,
  description: `Archive snapshot retrieved ${retrieved} (scripts/sky-fetch.ts on GitHub's runners, processed by scripts/sky-process.ts). Gaia DR3 five- or six-parameter solutions with RUWE < ${GAIA_CUTS.ruwe} and parallax/error > ${GAIA_CUTS.snr} for ${usedGaia} of ${allStars.length} stars; otherwise SIMBAD's adopted values, each cited by bibcode. Positions propagated to J${TARGET_EPOCH.toFixed(1)}.`,
  targetEpoch: TARGET_EPOCH,
  stars: allStars,
});
write('systems-input.json', {
  retrieved,
  description: `Systems the sky snapshot of ${retrieved} adds (every star SIMBAD lists with a parallax of at least 120 mas that the game lacked), and stars that join systems the game has.`,
  systems: newSystems,
  additions: Object.fromEntries(additions),
});
write('exoplanets-input.json', {
  kind: 'snapshot',
  retrieved,
  description: `Planets checked against the NASA Exoplanet Archive (pscomppars, confirmed planets) and the Extrasolar Planets Encyclopaedia on ${retrieved}. Nothing the game had is removed: planets neither archive confirms are kept and marked contested; the Encyclopaedia's candidates are added and marked candidate.`,
  source: { label: 'NASA Exoplanet Archive (pscomppars)', url: 'https://exoplanetarchive.ipac.caltech.edu/' },
  planets,
});
write('belts-input.json', {
  retrieved,
  description: `Belts and debris discs: the Solar System's from NASA; elsewhere, stars SIMBAD links to papers about their dust (${retrieved}). Extents only where the cited source gives them; otherwise the belt's place in the game is schematic.`,
  belts,
});
if (solar) write('solar-elements.json', { retrieved, ...solar });
if (farVerified.length) {
  write('far-stars-input.json', {
    kind: 'snapshot',
    retrieved,
    description: `Far stars beyond the map checked against SIMBAD on ${retrieved} (scripts/sky-fetch.ts on GitHub's runners, processed by scripts/sky-process.ts): Gaia DR3 when its solution passes the cuts, otherwise SIMBAD's adopted values, each cited.`,
    targetEpoch: TARGET_EPOCH,
    stars: farVerified,
  });
}

// ---------------------------------------------------------------- the report

const ly = (v: number) => v.toFixed(2);
const lines: string[] = [];
lines.push(`# Sky snapshot ${retrieved}`, '');
lines.push(`Processed by \`scripts/sky-process.ts\` from \`data/snapshot/raw/${date}/\`. Nothing the game had was removed.`, '');
const failed = manifest.queries.filter((q) => !q.ok);
lines.push('## Queries', '', `${manifest.queries.length - failed.length} of ${manifest.queries.length} archive queries worked.${failed.length ? ' Failed:' : ''}`, '');
for (const f of failed) lines.push(`- \`${f.label}\`: ${(f.error ?? '').split('\n')[0]!.slice(0, 160)}`);
lines.push('', '## The game\'s stars', '', `All ${verifiedStars.length} matched a SIMBAD object; ${verifiedStars.filter((s) => s.positionSource.label === 'Gaia DR3').length} use Gaia DR3 astrometry.`, '');
lines.push('| Star | Source | Distance before → after (ly) | Moved (ly) | Notes |', '|---|---|---|---|---|');
for (const c of [...starChanges].sort((a, b) => b.shiftLy - a.shiftLy)) lines.push(`| ${c.name} | ${c.source} | ${ly(c.oldLy)} → ${ly(c.newLy)} | ${c.shiftLy.toFixed(3)} | ${c.notes.join('; ')} |`);
const moved = starChanges.filter((c) => c.shiftLy > 0.25);
lines.push('', moved.length ? `Moved by more than 0.25 ly: ${moved.map((c) => `${c.name} (${c.shiftLy.toFixed(2)} ly)`).join(', ')}. The frozen core world (content/world/core-seeds.json) keeps its lanes and stations; only the map positions change.` : 'No star moved by more than 0.25 ly.', '');
lines.push('## Planets', '');
const count = (st: PlanetStatus) => planets.filter((p) => p.status === st).length;
lines.push(`${planets.length} planets: ${count('confirmed')} confirmed, ${count('contested')} contested (kept), ${count('candidate')} candidates.`, '');
for (const c of planetChanges) lines.push(`- **${c.name}** (${c.host}): ${c.what}`);
lines.push('', '## New systems', '', `${newSystems.length} systems added; ${[...additions.values()].flat().length} stars join systems the game had.`, '');
lines.push('| System | Distance (ly) | Stars | Planets |', '|---|---|---|---|');
for (const s of [...newSystems].sort((a, b) => parallaxToLightYears(starById.get(a.referenceComponentId)!.parallaxMas) - parallaxToLightYears(starById.get(b.referenceComponentId)!.parallaxMas))) {
  const stars = s.componentIds.map((id) => starById.get(id)!);
  const pl = planets.filter((p) => s.componentIds.includes(p.hostId));
  lines.push(`| ${s.displayName} | ${ly(parallaxToLightYears(stars[0]!.parallaxMas))} | ${stars.map((x) => `${x.name} (${x.spectralType})`).join(', ')} | ${pl.map((p) => `${p.displayName}${p.status !== 'confirmed' ? ` (${p.status})` : ''}`).join(', ') || '–'} |`);
}
for (const [sys, ids] of additions) lines.push('', `Joining ${gameSystems.get(sys)!.name}: ${ids.map((id) => `${starById.get(id)!.name} (${starById.get(id)!.spectralType})`).join(', ')}.`);
if (skipped.length) lines.push('', 'Not added:', '', ...skipped.map((x) => `- ${x}`));
lines.push('', '## Belts and debris discs', '');
for (const b of belts) lines.push(`- **${b.name}** (${b.systemId}): ${b.sources.map((s) => (s.bibcode ? `[${s.bibcode}](${s.url})` : `[${s.label}](${s.url})`)).join(', ')}`);
lines.push('', '## Far stars', '');
if (farVerified.length) for (const n of farNotes) lines.push(`- ${n}`);
else if (farAsked) lines.push(`SIMBAD gave no usable astrometry for ${farMissing.map((f) => f.name).join(' and ')}: every far star keeps its provisional values (HYG v4.0) until that is put right.`);
else lines.push('Not asked for in this snapshot: their provisional values (HYG v4.0) stay until the next one.');
lines.push('', '## The Solar System', '');
if (solar) {
  lines.push(`JPL's Keplerian elements for 1800–2050 parsed for ${Object.keys(solar.elements).length} planets; ${solar.checks.length} Horizons positions to test them against (tests/unit/solar.test.ts).`);
} else lines.push('No JPL elements in this snapshot; the Solar System keeps its schematic layout.');
write('REPORT.md', lines.join('\n') + '\n');

console.log(`Stars: ${verifiedStars.length} verified (${usedGaia} of ${allStars.length} on Gaia DR3), ${newStars.length} new in ${newSystems.length} new systems.`);
console.log(`Planets: ${planets.length} (${count('confirmed')} confirmed, ${count('contested')} contested, ${count('candidate')} candidates).`);
console.log(`Belts: ${belts.length}. Solar elements: ${solar ? 'yes' : 'no'}. Report: data/snapshot/REPORT.md`);
