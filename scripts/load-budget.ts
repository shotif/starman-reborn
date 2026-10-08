/**
 * What the production build asks a phone to download, against the first-load budget
 * (docs/PROCGEN.md §4.6). Usage, after `npm run build`: node scripts/load-budget.ts
 * (exit code 1 when over budget).
 *
 * - First screen: the page, its entry script and stylesheet: everything the loading title needs.
 * - The game: the files the loading title fetches before Play (the page's boot-files list).
 * - Fonts (already compressed) and files loaded on demand (the star map, the science notes,
 *   bloom) are reported, not budgeted.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { gzipSync } from 'node:zlib';

/**
 * Gzipped kilobytes (of 1,024 bytes). On 1 October 2026 the first screen was 15 KB and the first
 * load 609 KB: the budgets leave room to grow, and make a big jump a decision rather than an accident.
 * The owner raised the first load's from 700 KB to 800 on 2 October 2026, when Your crew took it to
 * 704 KB, and to 850 on 7 October 2026, when binary orbits, comets and the logbook took it to 798 KB.
 */
export const LOAD_BUDGET = {
  firstScreenKB: 32,
  firstLoadKB: 850,
} as const;

export interface LoadFile {
  file: string;
  raw: number;
  gzip: number;
}

export interface LoadReport {
  firstScreen: LoadFile[];
  game: LoadFile[];
  fonts: LoadFile[];
  onDemand: LoadFile[];
}

const kb = (bytes: number) => bytes / 1024;
export const total = (files: readonly LoadFile[]) => files.reduce((sum, f) => sum + f.gzip, 0);

function measureFile(dist: string, file: string): LoadFile {
  const body = readFileSync(resolve(dist, file));
  const compressed = /\.(woff2?|png|jpe?g)$/.test(file) ? body.length : gzipSync(body, { level: 9 }).length;
  return { file, raw: body.length, gzip: compressed };
}

export function measureBuild(dist = 'dist'): LoadReport {
  const html = readFileSync(resolve(dist, 'index.html'), 'utf8');
  const refs = (re: RegExp) => [...html.matchAll(re)].map((m) => m[1]!.replace(/^\.\//, ''));
  const firstScreen = [
    'index.html',
    ...refs(/<script type="module"[^>]*\ssrc="([^"]+)"/g),
    ...refs(/<link rel="(?:stylesheet|modulepreload)"[^>]*\shref="([^"]+)"/g).filter((f) => f.startsWith('assets/')),
  ];
  const list = /<script type="application\/json" id="boot-files">([^<]*)<\/script>/.exec(html);
  if (!list) throw new Error('index.html has no boot-files list: was it built with scripts/bootFiles.ts?');
  const game = (JSON.parse(list[1]!) as { url: string }[]).map((f) => f.url.replace(/^\.\//, ''));
  const assets = readdirSync(resolve(dist, 'assets')).map((f) => `assets/${f}`);
  const css = firstScreen.filter((f) => f.endsWith('.css')).map((f) => readFileSync(resolve(dist, f), 'utf8'));
  const fonts = assets.filter((f) => f.endsWith('.woff2') && css.some((c) => c.includes(basename(f))));
  const counted = new Set([...firstScreen, ...game]);
  const onDemand = assets.filter((f) => /\.(js|css)$/.test(f) && !counted.has(f));
  return {
    firstScreen: firstScreen.map((f) => measureFile(dist, f)),
    game: game.map((f) => measureFile(dist, f)),
    fonts: fonts.map((f) => measureFile(dist, f)),
    onDemand: onDemand.map((f) => measureFile(dist, f)),
  };
}

/** What is over budget, in words (empty when within it). */
export function overBudget(report: LoadReport, budget: typeof LOAD_BUDGET = LOAD_BUDGET): string[] {
  const problems: string[] = [];
  const first = kb(total(report.firstScreen));
  const all = kb(total(report.firstScreen) + total(report.game));
  if (report.game.length === 0) problems.push('The page lists no game files to load behind the loading title.');
  if (first > budget.firstScreenKB) {
    problems.push(`The first screen is ${first.toFixed(1)} KB gzipped, over its ${budget.firstScreenKB} KB budget.`);
  }
  if (all > budget.firstLoadKB) {
    problems.push(`The first load (first screen and game) is ${all.toFixed(1)} KB gzipped, over its ${budget.firstLoadKB} KB budget.`);
  }
  return problems;
}

/**
 * Sol's real sky (docs/PROCGEN.md §50) is fetched on demand, behind the loading title: its data must
 * not be in the first load. What marks a file as holding it: the processing script each part of it
 * names as its maker.
 */
export const SKY_MARKS = ['scripts/comets-process.ts', 'scripts/asteroids-process.ts', 'scripts/moons-process.ts', 'scripts/spacecraft-process.ts', 'scripts/lunar-process.ts'] as const;

/** What is wrong with where Sol's sky is, in words: a first-load file holding it, or no file on demand holding all of it. */
export function skyMisplaced(report: LoadReport, read: (file: string) => string): string[] {
  const problems: string[] = [];
  const holds = (file: string, mark: string) => read(file).includes(mark);
  for (const f of [...report.firstScreen, ...report.game])
    for (const mark of SKY_MARKS) if (holds(f.file, mark)) problems.push(`${f.file}, in the first load, holds Sol's sky (made by ${mark}).`);
  if (!report.onDemand.some((f) => SKY_MARKS.every((mark) => holds(f.file, mark)))) problems.push("No file loaded on demand holds the whole of Sol's sky.");
  return problems;
}

function print(report: LoadReport): void {
  const section = (title: string, files: readonly LoadFile[], note = '') => {
    console.log(`${title}: ${kb(total(files)).toFixed(1)} KB gzipped${note}`);
    for (const f of files) console.log(`  ${kb(f.gzip).toFixed(1).padStart(7)} KB  (${kb(f.raw).toFixed(1)} KB raw)  ${f.file}`);
  };
  section('First screen (the loading title)', report.firstScreen, `, budget ${LOAD_BUDGET.firstScreenKB} KB`);
  section('The game, loaded behind it', report.game);
  console.log(
    `First load in all: ${kb(total(report.firstScreen) + total(report.game)).toFixed(1)} KB gzipped, budget ${LOAD_BUDGET.firstLoadKB} KB`,
  );
  section('Fonts (already compressed)', report.fonts);
  section('On demand', report.onDemand);
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  const report = measureBuild(process.argv[2] ?? 'dist');
  print(report);
  const dist = process.argv[2] ?? 'dist';
  const problems = overBudget(report);
  for (const p of problems) console.log(`  OVER BUDGET: ${p}`);
  const sky = skyMisplaced(report, (f) => readFileSync(resolve(dist, f), 'utf8'));
  for (const p of sky) console.log(`  SKY: ${p}`);
  if (problems.length || sky.length) process.exit(1);
  console.log("\nWithin the first-load budget, with Sol's sky loaded on demand.");
}
