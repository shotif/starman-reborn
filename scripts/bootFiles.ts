import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Plugin } from 'vite';

/**
 * Build-time pieces of the first load (docs/TEST_RECORD.md): the system count the loading title
 * shows before the sky has arrived, and the list of files the game needs beyond the loading title,
 * written into index.html so the loading title can show how much of them has arrived.
 */

/** The hand-made systems come first in src/data/systems.ts; a unit test holds this to SYSTEMS. */
export const HAND_MADE_SYSTEMS = 5;

export function systemCount(root = '.'): number {
  const file = resolve(root, 'src/data/generated/catalog-systems.json');
  const catalog = JSON.parse(readFileSync(file, 'utf8')) as { systems: unknown[] };
  return HAND_MADE_SYSTEMS + catalog.systems.length;
}

/** The parts of a Rollup/Rolldown output bundle this needs. */
interface ChunkLike {
  type: 'chunk';
  fileName: string;
  code: string;
  isEntry: boolean;
  facadeModuleId: string | null;
  imports: readonly string[];
  viteMetadata?: { importedCss: Set<string> };
}
interface AssetLike {
  type: 'asset';
  fileName: string;
  source: string | Uint8Array;
}
export type BundleLike = Record<string, ChunkLike | AssetLike>;

export interface BootFileEntry {
  url: string;
  bytes: number;
}

function size(item: ChunkLike | AssetLike): number {
  if (item.type === 'chunk') return Buffer.byteLength(item.code);
  return typeof item.source === 'string' ? Buffer.byteLength(item.source) : item.source.byteLength;
}

/** A chunk with every chunk it imports statically, and their CSS. */
function closure(bundle: BundleLike, start: string): Set<string> {
  const seen = new Set<string>();
  const visit = (fileName: string) => {
    if (seen.has(fileName)) return;
    seen.add(fileName);
    const item = bundle[fileName];
    if (item?.type !== 'chunk') return;
    for (const css of item.viteMetadata?.importedCss ?? []) seen.add(css);
    for (const dep of item.imports) visit(dep);
  };
  visit(start);
  return seen;
}

/**
 * The files the boot module needs that the page's entry has not already loaded, largest first,
 * with their sizes before compression and paths relative to the page (the build's base is './').
 */
export function bootFiles(bundle: BundleLike, isBoot: (moduleId: string) => boolean): BootFileEntry[] {
  const chunks = Object.values(bundle).filter((b): b is ChunkLike => b.type === 'chunk');
  const entry = chunks.find((c) => c.isEntry);
  const boot = chunks.find((c) => c.facadeModuleId !== null && isBoot(c.facadeModuleId));
  if (!entry || !boot) throw new Error('bootFiles: the bundle has no entry or no boot chunk');
  const loaded = closure(bundle, entry.fileName);
  return [...closure(bundle, boot.fileName)]
    .filter((f) => !loaded.has(f) && bundle[f])
    .map((f) => ({ url: `./${f}`, bytes: size(bundle[f]!) }))
    .sort((a, b) => b.bytes - a.bytes);
}

const LIST = /(<script type="application\/json" id="boot-files">)([^<]*)(<\/script>)/;

/** Corrects the listed sizes to the files as written (Vite rewrites some imports after the page is made). */
export function measureBootFiles(outDir: string): void {
  const page = resolve(outDir, 'index.html');
  const html = readFileSync(page, 'utf8');
  const match = LIST.exec(html);
  if (!match) throw new Error('bootFiles: index.html has no boot-files list');
  const files = (JSON.parse(match[2]!) as BootFileEntry[]).map((f) => ({ url: f.url, bytes: statSync(resolve(outDir, f.url)).size }));
  writeFileSync(page, html.replace(LIST, (_all, open: string, _list, close: string) => open + JSON.stringify(files) + close));
}

/**
 * Every file of the build a player can need (scripts, styles and the fonts the browser uses),
 * for the offline cache to keep after one visit (public/sw.js).
 */
export function offlineFiles(bundle: BundleLike): string[] {
  return Object.values(bundle)
    .map((b) => b.fileName)
    .filter((f) => /\.(js|css|woff2)$/.test(f))
    .map((f) => `./${f}`)
    .sort();
}

/**
 * Writes the boot files into index.html as `<script type="application/json" id="boot-files">`,
 * and the offline files as `id="offline-files"`.
 */
export function bootFilesPlugin(bootModule = 'src/app/boot.ts'): Plugin {
  const isBoot = (id: string) => id.replaceAll('\\', '/').endsWith(bootModule);
  let outDir = 'dist';
  return {
    name: 'starman-boot-files',
    apply: 'build',
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir);
    },
    writeBundle() {
      measureBootFiles(outDir);
    },
    transformIndexHtml: {
      order: 'post',
      handler(html, ctx) {
        if (!ctx.bundle) return html;
        const bundle = ctx.bundle as unknown as BundleLike;
        const list = (id: string, value: unknown) => ({
          tag: 'script',
          attrs: { type: 'application/json', id },
          children: JSON.stringify(value),
          injectTo: 'head' as const,
        });
        return { html, tags: [list('boot-files', bootFiles(bundle, isBoot)), list('offline-files', offlineFiles(bundle))] };
      },
    },
  };
}
