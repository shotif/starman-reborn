/**
 * Extracts more nearby star systems from two public catalogues into provisional dataset inputs:
 *
 * - HYG star database v4.0 (Hipparcos, Yale Bright Star and Gliese catalogues combined), by David
 *   Nash / astronexus, CC BY-SA 4.0: positions (J2000), proper motions, distances, spectral types.
 * - Open Exoplanet Catalogue (Hanno Rein and contributors), MIT licence: planets on its
 *   "Confirmed planets" list only (controversial and retracted entries are skipped).
 *
 * Nothing is invented: every value comes from these files, and every record keeps its source.
 * The output is flagged "provisional" in the game until the archive snapshot
 * (scripts/fetch-astro-snapshot.ts) can verify it against Gaia DR3, SIMBAD and the NASA
 * Exoplanet Archive.
 *
 * Inputs (not committed; download once):
 *   mkdir -p data/raw
 *   curl -L -o data/raw/hygdata_v40.csv.gz https://raw.githubusercontent.com/astronexus/HYG-Database/main/hyg/CURRENT/hygdata_v40.csv.gz
 *   gunzip data/raw/hygdata_v40.csv.gz
 *   curl -L -o data/raw/oec-systems.xml.gz https://raw.githubusercontent.com/OpenExoplanetCatalogue/oec_gzip/master/systems.xml.gz
 *   gunzip data/raw/oec-systems.xml.gz
 *
 * Usage: node scripts/extract-catalogs.ts   (then: npm run data:build && npm run data:validate)
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const HYG_FILE = resolve(root, 'data/raw/hygdata_v40.csv');
const OEC_FILE = resolve(root, 'data/raw/oec-systems.xml');
const HYG_URL = 'https://github.com/astronexus/HYG-Database/tree/main/hyg/CURRENT';
const OEC_URL = 'https://github.com/OpenExoplanetCatalogue/open_exoplanet_catalogue';
const JUPITER_IN_EARTH_MASSES = 317.828;

/**
 * The systems to add, by Gliese designation of each component (as HYG spells it), nearest first.
 * Names are the common catalogue names; component names only where HYG has none.
 */
const PICKS: { id: string; name: string; components: { gl: string; name?: string }[] }[] = [
  { id: 'wolf-359', name: 'Wolf 359', components: [{ gl: 'Gl 406', name: 'Wolf 359' }] },
  { id: 'lalande-21185', name: 'Lalande 21185', components: [{ gl: 'Gl 411', name: 'Lalande 21185' }] },
  { id: 'luyten-726-8', name: 'Luyten 726-8', components: [{ gl: 'Gl 65A', name: 'BL Ceti' }, { gl: 'Gl 65B', name: 'UV Ceti' }] },
  { id: 'ross-154', name: 'Ross 154', components: [{ gl: 'Gl 729', name: 'Ross 154' }] },
  { id: 'ross-248', name: 'Ross 248', components: [{ gl: 'Gl 905', name: 'Ross 248' }] },
  { id: 'lacaille-9352', name: 'Lacaille 9352', components: [{ gl: 'Gl 887', name: 'Lacaille 9352' }] },
  { id: 'ross-128', name: 'Ross 128', components: [{ gl: 'Gl 447', name: 'Ross 128' }] },
  { id: 'ez-aquarii', name: 'EZ Aquarii', components: [{ gl: 'Gl 866A', name: 'EZ Aquarii A' }] },
  { id: '61-cygni', name: '61 Cygni', components: [{ gl: 'Gl 820A', name: '61 Cygni A' }, { gl: 'Gl 820B', name: '61 Cygni B' }] },
  { id: 'procyon', name: 'Procyon', components: [{ gl: 'Gl 280A', name: 'Procyon A' }, { gl: 'Gl 280B', name: 'Procyon B' }] },
  { id: 'struve-2398', name: 'Struve 2398', components: [{ gl: 'Gl 725A', name: 'Struve 2398 A' }, { gl: 'Gl 725B', name: 'Struve 2398 B' }] },
  { id: 'groombridge-34', name: 'Groombridge 34', components: [{ gl: 'Gl 15A', name: 'Groombridge 34 A' }, { gl: 'Gl 15B', name: 'Groombridge 34 B' }] },
  { id: 'epsilon-indi', name: 'Epsilon Indi', components: [{ gl: 'Gl 845', name: 'Epsilon Indi A' }] },
  { id: 'tau-ceti', name: 'Tau Ceti', components: [{ gl: 'Gl 71', name: 'Tau Ceti' }] },
  { id: 'yz-ceti', name: 'YZ Ceti', components: [{ gl: 'Gl 54.1', name: 'YZ Ceti' }] },
  { id: 'luytens-star', name: "Luyten's Star", components: [{ gl: 'Gl 273', name: "Luyten's Star" }] },
  { id: 'kapteyns-star', name: "Kapteyn's Star", components: [{ gl: 'Gl 191', name: "Kapteyn's Star" }] },
  { id: 'lacaille-8760', name: 'Lacaille 8760', components: [{ gl: 'Gl 825', name: 'Lacaille 8760' }] },
  { id: 'kruger-60', name: 'Kruger 60', components: [{ gl: 'Gl 860A', name: 'Kruger 60 A' }, { gl: 'Gl 860B', name: 'Kruger 60 B' }] },
  { id: 'ross-614', name: 'Ross 614', components: [{ gl: 'Gl 234A', name: 'Ross 614 A' }, { gl: 'Gl 234B', name: 'Ross 614 B' }] },
  { id: 'van-maanens-star', name: "Van Maanen's Star", components: [{ gl: 'Gl 35', name: "Van Maanen's Star" }] },
  { id: 'wolf-1061', name: 'Wolf 1061', components: [{ gl: 'Gl 628', name: 'Wolf 1061' }] },
  { id: 'gj-1061', name: 'GJ 1061', components: [{ gl: 'GJ 1061', name: 'GJ 1061' }] },
  { id: 'gliese-876', name: 'Gliese 876', components: [{ gl: 'Gl 876', name: 'Gliese 876' }] },
  { id: '40-eridani', name: '40 Eridani', components: [{ gl: 'Gl 166A', name: '40 Eridani A' }, { gl: 'Gl 166B', name: '40 Eridani B' }, { gl: 'Gl 166C', name: '40 Eridani C' }] },
  { id: '70-ophiuchi', name: '70 Ophiuchi', components: [{ gl: 'Gl 702A', name: '70 Ophiuchi A' }, { gl: 'Gl 702B', name: '70 Ophiuchi B' }] },
  { id: 'altair', name: 'Altair', components: [{ gl: 'Gl 768', name: 'Altair' }] },
];

// ---------------------------------------------------------------- HYG

type Row = Record<string, string>;

/** Minimal CSV reader for HYG (quoted fields without embedded quotes or newlines). */
function readCsv(path: string): Row[] {
  const lines = readFileSync(path, 'utf8').split(/\r?\n/).filter(Boolean);
  const split = (line: string) => {
    const out: string[] = [];
    let cur = '';
    let quoted = false;
    for (const ch of line) {
      if (ch === '"') quoted = !quoted;
      else if (ch === ',' && !quoted) {
        out.push(cur);
        cur = '';
      } else cur += ch;
    }
    out.push(cur);
    return out;
  };
  const head = split(lines[0]!);
  return lines.slice(1).map((l) => {
    const cells = split(l);
    return Object.fromEntries(head.map((h, i) => [h, cells[i] ?? '']));
  });
}

const norm = (gl: string) => gl.replace(/\s+/g, ' ').trim();

/** Display colour inspired by the spectral class (an artistic choice, labelled estimated in the game). */
function colourFor(spect: string): string {
  const s = spect.trim().toUpperCase();
  // White dwarfs: DA, DB, DC, DQ, DZ, DX, and the old "DG".
  if (/^D[ABCOQZX]/.test(s) || s === 'DG') return '#e8efff';
  // "dM5.5e" (dwarf) and "sdM4" (subdwarf) prefixes.
  const c = s.replace(/^(SD|D)(?=[OBAFGKM])/, '')[0] ?? 'M';
  return ({ O: '#b8c8ff', B: '#c8d6ff', A: '#eef2ff', F: '#fff6e6', G: '#fff1d6', K: '#ffd9a8', M: '#ffb27a' } as Record<string, string>)[c] ?? '#ffb27a';
}

const slug = (text: string) =>
  text
    .toLowerCase()
    .replace(/'/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

// ---------------------------------------------------------------- OEC

interface OecValue {
  value: number;
  error?: number;
  type?: string;
}

interface OecPlanet {
  names: string[];
  lists: string[];
  period?: OecValue;
  semimajoraxis?: OecValue;
  mass?: OecValue;
  radius?: OecValue;
  discoverymethod?: string;
  discoveryyear?: number;
}

interface OecStar {
  names: string[];
  planets: OecPlanet[];
}

interface OecSystem {
  names: string[];
  stars: OecStar[];
}

const tagText = (block: string, tag: string): string[] =>
  [...block.matchAll(new RegExp(`<${tag}(?:\\s[^>]*)?>([^<]*)</${tag}>`, 'g'))].map((m) => m[1]!.trim());

function tagValue(block: string, tag: string): OecValue | undefined {
  const m = block.match(new RegExp(`<${tag}((?:\\s[^>]*)?)>([^<]+)</${tag}>`));
  if (!m) return undefined;
  const value = Number(m[2]);
  if (!Number.isFinite(value)) return undefined;
  const attrs = m[1] ?? '';
  const minus = Number(attrs.match(/errorminus="([^"]+)"/)?.[1]);
  const plus = Number(attrs.match(/errorplus="([^"]+)"/)?.[1]);
  const type = attrs.match(/type="([^"]+)"/)?.[1];
  const error = Number.isFinite(minus) && Number.isFinite(plus) ? (minus + plus) / 2 : undefined;
  return { value, ...(error !== undefined ? { error } : {}), ...(type ? { type } : {}) };
}

/** Top-level children with a given tag, keeping nesting straight (planets sit inside stars). */
function children(block: string, tag: string): string[] {
  const out: string[] = [];
  const open = new RegExp(`<${tag}>`, 'g');
  let m: RegExpExecArray | null;
  while ((m = open.exec(block))) {
    let depth = 1;
    let i = m.index + m[0].length;
    const re = new RegExp(`<(/?)${tag}>`, 'g');
    re.lastIndex = i;
    let n: RegExpExecArray | null;
    while (depth > 0 && (n = re.exec(block))) {
      depth += n[1] ? -1 : 1;
      i = n.index + n[0].length;
    }
    out.push(block.slice(m.index, i));
    open.lastIndex = i;
  }
  return out;
}

function readOec(path: string): OecSystem[] {
  const xml = readFileSync(path, 'utf8');
  return children(xml, 'system').map((sys) => {
    const starBlocks = children(sys, 'star');
    let head = sys;
    for (const b of starBlocks) head = head.replace(b, '');
    return {
      names: tagText(head, 'name'),
      stars: starBlocks.map((star) => {
        const planetBlocks = children(star, 'planet');
        let starHead = star;
        for (const b of planetBlocks) starHead = starHead.replace(b, '');
        return {
          names: tagText(starHead, 'name'),
          planets: planetBlocks.map((p) => {
            const year = Number(tagText(p, 'discoveryyear')[0]);
            return {
              names: tagText(p, 'name'),
              lists: tagText(p, 'list'),
              period: tagValue(p, 'period'),
              semimajoraxis: tagValue(p, 'semimajoraxis'),
              mass: tagValue(p, 'mass'),
              radius: tagValue(p, 'radius'),
              discoverymethod: tagText(p, 'discoverymethod')[0],
              ...(Number.isFinite(year) ? { discoveryyear: year } : {}),
            };
          }),
        };
      }),
    };
  });
}

/** Names a Gliese star goes by in OEC ("GJ 876", "Gliese 876", "Gl 876 A", "HIP 113020"). */
function aliases(gl: string, hip: string): Set<string> {
  const m = norm(gl).match(/^(?:Gl|GJ)\s+([0-9.]+)\s*([A-C])?$/);
  const out = new Set<string>();
  if (hip) out.add(`HIP ${hip}`);
  if (!m) return out;
  const [, num, letter] = m;
  for (const p of ['GJ', 'Gliese', 'Gl']) {
    if (letter) {
      out.add(`${p} ${num} ${letter}`);
      out.add(`${p} ${num}${letter}`);
      if (letter === 'A') out.add(`${p} ${num}`);
    } else out.add(`${p} ${num}`);
  }
  return out;
}

// ---------------------------------------------------------------- build

function main(): void {
  const hyg = readCsv(HYG_FILE);
  const byGl = new Map(hyg.filter((r) => r.gl).map((r) => [norm(r.gl!), r]));
  const oec = readOec(OEC_FILE);

  const stars: unknown[] = [];
  const planets: unknown[] = [];
  const systems: unknown[] = [];

  for (const pick of PICKS) {
    const componentIds: string[] = [];
    let primaryId = '';
    for (const [i, c] of pick.components.entries()) {
      const row = byGl.get(norm(c.gl));
      if (!row) throw new Error(`HYG has no ${c.gl}`);
      const id = pick.components.length === 1 ? pick.id : slug(c.name ?? `${pick.name} ${String.fromCharCode(65 + i)}`);
      if (i === 0) primaryId = id;
      componentIds.push(id);
      const distPc = Number(row.dist);
      const record = `HYG ${row.id} (${norm(c.gl)}${row.hip ? `, HIP ${row.hip}` : ''})`;
      const source = { label: 'HYG v4.0', url: HYG_URL, recordId: record };
      stars.push({
        id,
        name: c.name ?? (row.proper || norm(c.gl)),
        systemId: pick.id,
        role: i === 0 ? 'primary' : 'companion',
        ...(i > 0 ? { parentId: primaryId } : {}),
        catalogIds: { ...(row.hip ? { hip: `HIP ${row.hip}` } : {}), gliese: norm(c.gl) },
        spectralType: row.spect?.trim() || 'unknown',
        raDegrees: Number(row.ra) * 15,
        decDegrees: Number(row.dec),
        epoch: 2000,
        pmRaMasYr: Number(row.pmra),
        pmDecMasYr: Number(row.pmdec),
        parallaxMas: 1000 / distPc,
        positionSource: source,
        parallaxSource: { ...source, label: 'HYG v4.0 (Hipparcos / Gliese distance)' },
        spectralTypeSource: source,
        colorHex: colourFor(row.spect ?? ''),
      });

      // Planets: OEC stars whose names match this component.
      const names = aliases(c.gl, row.hip ?? '');
      for (const sys of oec) {
        for (const star of sys.stars) {
          if (!star.names.some((n) => names.has(n))) continue;
          for (const p of star.planets) {
            if (!p.lists.includes('Confirmed planets')) continue;
            const name = p.names[0]!;
            const mass = p.mass;
            planets.push({
              archiveName: name,
              // "Lalande 21185 b" reads better than the archive's "GJ 411 b".
              displayName: `${c.name ?? pick.name} ${name.split(' ').pop()}`,
              hostId: id,
              controversial: false,
              ...(p.discoveryyear ? { discoveryYear: p.discoveryyear } : {}),
              ...(p.discoverymethod ? { discoveryMethod: p.discoverymethod } : {}),
              ...(p.period ? { orbitalPeriodDays: { value: p.period.value, ...(p.period.error !== undefined ? { error: p.period.error } : {}) } } : {}),
              ...(p.semimajoraxis
                ? { semiMajorAxisAu: { value: p.semimajoraxis.value, ...(p.semimajoraxis.error !== undefined ? { error: p.semimajoraxis.error } : {}) } }
                : {}),
              ...(mass
                ? {
                    massEarth: {
                      value: Number((mass.value * JUPITER_IN_EARTH_MASSES).toPrecision(4)),
                      ...(mass.error !== undefined ? { error: Number((mass.error * JUPITER_IN_EARTH_MASSES).toPrecision(3)) } : {}),
                      ...(mass.type === 'msini' ? { qualifier: 'minimum mass (M sin i)' } : {}),
                    },
                  }
                : {}),
              source: { label: 'Open Exoplanet Catalogue', url: `${OEC_URL}/blob/master/systems/${encodeURIComponent(sys.names[0]!)}.xml` },
            });
          }
        }
      }
    }
    systems.push({ id: pick.id, displayName: pick.name, referenceComponentId: primaryId, componentIds });
  }

  const note = 'Extracted by scripts/extract-catalogs.ts; provisional until the archive snapshot verifies it.';
  writeFileSync(
    resolve(root, 'data/provisional/catalog-astrometry-input.json'),
    `${JSON.stringify({ kind: 'provisional', retrieved: null, description: `Positions (J2000), proper motions, distances and spectral types from the HYG star database v4.0 (CC BY-SA 4.0). ${note}`, targetEpoch: 2016, stars }, null, 2)}\n`,
  );
  writeFileSync(
    resolve(root, 'data/provisional/catalog-exoplanets-input.json'),
    `${JSON.stringify({ kind: 'provisional', retrieved: null, description: `Planets on the Open Exoplanet Catalogue's "Confirmed planets" list (MIT licence). ${note}`, source: { label: 'Open Exoplanet Catalogue', url: OEC_URL }, planets }, null, 2)}\n`,
  );
  writeFileSync(resolve(root, 'data/provisional/catalog-systems.json'), `${JSON.stringify({ description: note, systems }, null, 2)}\n`);
  console.log(`${systems.length} systems, ${stars.length} stars, ${planets.length} confirmed planets`);
}

main();
