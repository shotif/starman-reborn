import { describe, expect, it } from 'vitest';
import { bootFiles, offlineFiles, systemCount, type BundleLike } from '../../scripts/bootFiles.ts';
import { LOAD_BUDGET, overBudget, total, type LoadReport } from '../../scripts/load-budget.ts';
import { downloadAll, parseBootFiles, type BootFile } from '../../src/app/download.ts';
import { SYSTEMS } from '../../src/data/systems.ts';

/** A fetch that answers each URL with its bytes, in chunks of `chunk`. */
function fakeFetch(sizes: Record<string, number>, opts: { chunk?: number; status?: Record<string, number>; noBody?: boolean } = {}): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = String(input);
    const status = opts.status?.[url] ?? 200;
    const size = sizes[url] ?? 0;
    if (opts.noBody) return new Response(null, { status });
    const chunk = opts.chunk ?? 1000;
    let sent = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (sent >= size) {
          controller.close();
          return;
        }
        const n = Math.min(chunk, size - sent);
        sent += n;
        controller.enqueue(new Uint8Array(n));
      },
    });
    return new Response(status === 200 ? body : null, { status });
  }) as typeof fetch;
}

describe('the first load: the loading title and the files behind it', () => {
  it('counts the systems the way the game does, before the sky has arrived', () => {
    expect(systemCount()).toBe(SYSTEMS.length);
  });

  it('reads the build’s list of files, and nothing else', () => {
    const list = [
      { url: './assets/boot-a.js', bytes: 1200 },
      { url: './assets/three-b.js', bytes: 600 },
    ];
    expect(parseBootFiles(JSON.stringify(list))).toEqual(list);
    expect(parseBootFiles(null)).toEqual([]);
    expect(parseBootFiles('')).toEqual([]);
    expect(parseBootFiles('{not json')).toEqual([]);
    expect(parseBootFiles('{"url":"x"}')).toEqual([]);
    expect(parseBootFiles(JSON.stringify([...list, { url: '', bytes: 5 }, { url: 'x.js', bytes: -1 }, { url: 'y.js' }, 'z']))).toEqual(list);
  });

  it('reports the share of every file’s bytes that has arrived, rising to exactly 1', async () => {
    const files: BootFile[] = [
      { url: 'a.js', bytes: 25_000 },
      { url: 'b.js', bytes: 9_000 },
      { url: 'c.css', bytes: 500 },
    ];
    const seen: number[] = [];
    await downloadAll(files, (f) => seen.push(f), fakeFetch({ 'a.js': 25_000, 'b.js': 9_000, 'c.css': 500 }));
    expect(seen.length).toBeGreaterThan(20);
    expect(seen).toEqual([...seen].sort((a, b) => a - b));
    expect(seen.at(-1)).toBe(1);
    expect(Math.max(...seen)).toBe(1);
  });

  it('still ends at exactly 1 when the list is out of date, and never goes past it', async () => {
    const files: BootFile[] = [
      { url: 'big.js', bytes: 5_000 },
      { url: 'small.js', bytes: 5_000 },
    ];
    const seen: number[] = [];
    // One file is larger than listed and one smaller.
    await downloadAll(files, (f) => seen.push(f), fakeFetch({ 'big.js': 8_000, 'small.js': 2_000 }));
    expect(seen).toEqual([...seen].sort((a, b) => a - b));
    expect(seen.at(-1)).toBe(1);
    expect(Math.max(...seen)).toBe(1);
  });

  it('counts a file that comes without a readable body once it is read', async () => {
    const seen: number[] = [];
    await downloadAll([{ url: 'a.js', bytes: 100 }], (f) => seen.push(f), fakeFetch({ 'a.js': 100 }, { noBody: true }));
    expect(seen).toEqual([1]);
  });

  it('fails when a file does not arrive, so the title can offer to try again', async () => {
    const files: BootFile[] = [
      { url: 'a.js', bytes: 100 },
      { url: 'gone.js', bytes: 100 },
    ];
    await expect(downloadAll(files, () => {}, fakeFetch({ 'a.js': 100 }, { status: { 'gone.js': 404 } }))).rejects.toThrow(/gone\.js: HTTP 404/);
  });

  it('has nothing to fetch, and reports nothing, without a list (the dev server)', async () => {
    const seen: number[] = [];
    await downloadAll([], (f) => seen.push(f), fakeFetch({}));
    expect(seen).toEqual([]);
  });
});

describe('the build’s list of what the game needs beyond the loading title', () => {
  const chunk = (fileName: string, size: number, imports: string[], extra: { isEntry?: boolean; facade?: string; css?: string[] } = {}) => ({
    type: 'chunk' as const,
    fileName,
    code: 'x'.repeat(size),
    isEntry: extra.isEntry ?? false,
    facadeModuleId: extra.facade ?? null,
    imports,
    viteMetadata: { importedCss: new Set(extra.css ?? []) },
  });
  const asset = (fileName: string, size: number) => ({ type: 'asset' as const, fileName, source: 'y'.repeat(size) });
  const bundle: BundleLike = {
    'assets/index-1.js': chunk('assets/index-1.js', 20, [], { isEntry: true, facade: '/repo/index.html', css: ['assets/index-1.css'] }),
    'assets/index-1.css': asset('assets/index-1.css', 7),
    'assets/boot-2.js': chunk('assets/boot-2.js', 1500, ['assets/index-1.js', 'assets/three-3.js', 'assets/addons-4.js'], {
      facade: '/repo/src/app/boot.ts',
      css: ['assets/boot-2.css'],
    }),
    'assets/boot-2.css': asset('assets/boot-2.css', 44),
    'assets/three-3.js': chunk('assets/three-3.js', 600, []),
    'assets/addons-4.js': chunk('assets/addons-4.js', 25, ['assets/three-3.js']),
    // Loaded on demand later (the star map): not part of the first load.
    'assets/map-5.js': chunk('assets/map-5.js', 70, ['assets/three-3.js'], { facade: '/repo/src/galaxy/GalaxyMapView.ts' }),
  };
  const isBoot = (id: string) => id.endsWith('src/app/boot.ts');

  it('lists the boot chunk, its imports and its CSS, largest first, with their sizes', () => {
    expect(bootFiles(bundle, isBoot)).toEqual([
      { url: './assets/boot-2.js', bytes: 1500 },
      { url: './assets/three-3.js', bytes: 600 },
      { url: './assets/boot-2.css', bytes: 44 },
      { url: './assets/addons-4.js', bytes: 25 },
    ]);
  });

  it('leaves out what the page has already loaded and what loads on demand', () => {
    const urls = bootFiles(bundle, isBoot).map((f) => f.url);
    expect(urls).not.toContain('./assets/index-1.js');
    expect(urls).not.toContain('./assets/index-1.css');
    expect(urls).not.toContain('./assets/map-5.js');
  });

  it('refuses a bundle without the boot chunk', () => {
    expect(() => bootFiles(bundle, () => false)).toThrow(/no entry or no boot chunk/);
  });

  it('lists every script, style and font for the offline cache, the on-demand ones too, and no source maps', () => {
    const withExtras: BundleLike = {
      ...bundle,
      'assets/font-6.woff2': asset('assets/font-6.woff2', 18),
      'assets/font-6.woff': asset('assets/font-6.woff', 15),
      'assets/boot-2.js.map': asset('assets/boot-2.js.map', 4000),
    };
    expect(offlineFiles(withExtras)).toEqual([
      './assets/addons-4.js',
      './assets/boot-2.css',
      './assets/boot-2.js',
      './assets/font-6.woff2',
      './assets/index-1.css',
      './assets/index-1.js',
      './assets/map-5.js',
      './assets/three-3.js',
    ]);
  });
});

describe('the first-load budget (docs/PROCGEN.md §4.6)', () => {
  const file = (name: string, kb: number) => ({ file: name, raw: kb * 4096, gzip: kb * 1024 });
  const report = (first: number, game: number): LoadReport => ({
    firstScreen: [file('index.html', 1), file('assets/index.js', first - 1)],
    game: game > 0 ? [file('assets/boot.js', game)] : [],
    fonts: [file('assets/font.woff2', 70)],
    onDemand: [file('assets/map.js', 30)],
  });

  it('passes a build within it, whatever the fonts and the files loaded on demand weigh', () => {
    expect(overBudget(report(15, 594))).toEqual([]);
    expect(total(report(15, 594).firstScreen)).toBe(15 * 1024);
  });

  it('catches a first screen that has grown, say by pulling three.js into the loading title', () => {
    expect(overBudget(report(LOAD_BUDGET.firstScreenKB + 150, 450))).toEqual([expect.stringMatching(/first screen is 182\.0 KB/)]);
  });

  it('catches a first load over budget, and a page that lists no game files', () => {
    expect(overBudget(report(15, LOAD_BUDGET.firstLoadKB))).toEqual([expect.stringMatching(/first load .* over its 700 KB budget/)]);
    expect(overBudget(report(15, 0))).toEqual([expect.stringMatching(/lists no game files/)]);
  });
});
