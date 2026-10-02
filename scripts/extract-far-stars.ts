/**
 * Extracts the far stars (docs/ASTRONOMY_SOURCES.md, *Far stars*) from the HYG star database v4.0
 * by David Nash / astronexus (CC BY-SA 4.0) into a provisional dataset input: two red supergiants
 * hundreds of light-years beyond the map, seen in every system's sky, whose deaths are the game's
 * fiction (docs/PROCGEN.md §25). Nothing is invented: every value comes from HYG and keeps its
 * source, and the record stays provisional until the archive snapshot (scripts/sky-fetch.ts, then
 * scripts/sky-process.ts) verifies it against SIMBAD.
 *
 * Input (not committed; download once):
 *   mkdir -p data/raw
 *   curl -L -o data/raw/hygdata_v40.csv.gz https://raw.githubusercontent.com/astronexus/HYG-Database/main/hyg/CURRENT/hygdata_v40.csv.gz
 *   gunzip data/raw/hygdata_v40.csv.gz
 *
 * Usage: node scripts/extract-far-stars.ts   (then: npm run data:build && npm run data:validate)
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const HYG_FILE = process.argv[2] ? resolve(process.argv[2]) : resolve(root, 'data/raw/hygdata_v40.csv');
const HYG_URL = 'https://github.com/astronexus/HYG-Database/tree/main/hyg/CURRENT';

/** The far stars, picked by HIP number (a fixed list, so they never shift with a catalogue update). */
const PICKS: { id: string; name: string; hip: number; designation: string; simbad: string }[] = [
  { id: 'betelgeuse', name: 'Betelgeuse', hip: 27989, designation: 'Alpha Orionis', simbad: 'alf Ori' },
  { id: 'antares', name: 'Antares', hip: 80763, designation: 'Alpha Scorpii', simbad: 'alf Sco' },
];

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

/** Display colour inspired by the spectral class (an artistic choice, like every star colour in the game). */
function colourFor(spect: string): string {
  const c = spect.trim().toUpperCase()[0] ?? 'M';
  return ({ O: '#b8c8ff', B: '#c8d6ff', A: '#eef2ff', F: '#fff6e6', G: '#fff1d6', K: '#ffd9a8', M: '#ffb27a' } as Record<string, string>)[c] ?? '#ffb27a';
}

function main(): void {
  const rows = readCsv(HYG_FILE);
  const stars = PICKS.map((p) => {
    const row = rows.find((r) => r.hip === String(p.hip));
    if (!row) throw new Error(`HIP ${p.hip} (${p.name}) is not in ${HYG_FILE}`);
    const dist = Number(row.dist);
    const source = { label: 'HYG v4.0', url: HYG_URL, recordId: `HYG ${row.id} (HIP ${p.hip})` };
    return {
      id: p.id,
      name: p.name,
      designation: p.designation,
      catalogIds: { hip: `HIP ${p.hip}`, simbad: p.simbad },
      spectralType: row.spect,
      raDegrees: Number((Number(row.ra) * 15).toFixed(6)),
      decDegrees: Number(row.dec),
      epoch: 2000,
      pmRaMasYr: Number(row.pmra),
      pmDecMasYr: Number(row.pmdec),
      parallaxMas: 1000 / dist,
      magnitudeV: Number(row.mag),
      positionSource: source,
      parallaxSource: { ...source, label: 'HYG v4.0 (Hipparcos distance)' },
      spectralTypeSource: source,
      magnitudeSource: source,
      colorHex: colourFor(row.spect),
    };
  });
  const out = {
    kind: 'provisional',
    retrieved: null,
    description:
      'Far stars beyond the map (positions J2000, proper motions, distances, spectral types and visual magnitudes) from the HYG star database v4.0 (CC BY-SA 4.0). Extracted by scripts/extract-far-stars.ts; provisional until the archive snapshot verifies it.',
    targetEpoch: 2016,
    stars,
  };
  writeFileSync(resolve(root, 'data/provisional/far-stars-input.json'), `${JSON.stringify(out, null, 2)}\n`);
  for (const s of stars) console.log(`${s.name}: ${s.spectralType}, ${(1000 / s.parallaxMas).toFixed(1)} pc, V ${s.magnitudeV}`);
}

main();
