import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';
import { gzipSync } from 'node:zlib';

/**
 * Serves the production build the way GitHub Pages does, so load timings mean something:
 * gzip for text, `Cache-Control: max-age=600` and an ETag (the preview server sends files
 * uncompressed and uncached). Test-only; it does not try to be a general web server.
 */
const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.map': 'application/json',
};
const COMPRESS = new Set(['.html', '.js', '.css', '.json', '.webmanifest', '.svg', '.map']);

export interface PagesServer {
  url: string;
  close(): Promise<void>;
  /** Requests seen so far, by path. */
  requests: Map<string, number>;
}

export interface PagesOptions {
  /** The first request for a path matching this fails (503), as a download does when a phone loses signal. */
  failOnce?: RegExp;
}

/** `host` 'localhost' gives an origin where the service worker registers (src/main.ts). */
export async function servePages(root = 'dist', port = 0, host: '127.0.0.1' | 'localhost' = '127.0.0.1', opts: PagesOptions = {}): Promise<PagesServer> {
  const base = resolve(root);
  const cache = new Map<string, { body: Buffer; gz: Buffer | null; etag: string }>();
  const requests = new Map<string, number>();
  const server: Server = createServer((req, res) => {
    void (async () => {
      const path = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname);
      const seen = (requests.get(path) ?? 0) + 1;
      requests.set(path, seen);
      if (opts.failOnce?.test(path) && seen === 1) {
        res.writeHead(503).end();
        return;
      }
      let file = normalize(join(base, path));
      if (!file.startsWith(base)) {
        res.writeHead(403).end();
        return;
      }
      if (path.endsWith('/')) file = join(file, 'index.html');
      try {
        if (!(await stat(file)).isFile()) throw new Error('not a file');
      } catch {
        res.writeHead(404).end();
        return;
      }
      let entry = cache.get(file);
      if (!entry) {
        const body = await readFile(file);
        const ext = extname(file);
        entry = {
          body,
          gz: COMPRESS.has(ext) ? gzipSync(body, { level: 9 }) : null,
          etag: `"${createHash('sha1').update(body).digest('hex').slice(0, 16)}"`,
        };
        cache.set(file, entry);
      }
      const headers: Record<string, string> = {
        'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream',
        'Cache-Control': 'max-age=600',
        ETag: entry.etag,
        Vary: 'Accept-Encoding',
      };
      if (req.headers['if-none-match'] === entry.etag) {
        res.writeHead(304, headers).end();
        return;
      }
      const gzip = entry.gz && /\bgzip\b/.test(String(req.headers['accept-encoding'] ?? ''));
      const body = gzip ? entry.gz! : entry.body;
      if (gzip) headers['Content-Encoding'] = 'gzip';
      headers['Content-Length'] = String(body.length);
      res.writeHead(200, headers).end(body);
    })();
  });
  await new Promise<void>((done) => server.listen(port, '127.0.0.1', done));
  const address = server.address();
  const actual = typeof address === 'object' && address ? address.port : port;
  let closed: Promise<void> | null = null;
  return {
    url: `http://${host}:${actual}`,
    requests,
    // Kept-alive connections go too, so nothing more can be served once it returns.
    close: () =>
      (closed ??= new Promise<void>((done) => {
        server.close(() => done());
        server.closeAllConnections();
      })),
  };
}
