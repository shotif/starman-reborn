import { expect, test } from '@playwright/test';
import { press } from './helpers.ts';
import { servePages, type PagesServer } from './pagesServer.ts';

/**
 * Offline play after one visit (the README; the real-device checklist's last step). The build is
 * served from `localhost`, where the service worker registers (it never does in `?test=1` runs),
 * and then the server is switched off for real, so nothing can come from the network.
 */
let server: PagesServer;
test.beforeEach(async () => {
  server = await servePages('dist', 0, 'localhost');
});
test.afterEach(async () => {
  await server.close();
});

test('after one visit the game starts and the star map opens with no network', async ({ page, context }, info) => {
  test.skip(info.project.name !== 'desktop', 'The service worker is the same on every device; once is enough.');
  await page.goto(server.url + '/');
  await expect(page.getByTestId('title-screen')).toBeVisible();
  // The first visit leaves the page and every file of the build in the offline cache.
  const wanted = await page.evaluate(() => JSON.parse(document.getElementById('offline-files')?.textContent ?? '[]') as string[]);
  expect(wanted.length).toBeGreaterThan(5);
  await expect
    .poll(
      () =>
        page.evaluate(async (files) => {
          const names = await caches.keys();
          if (names.length === 0) return files.length + 1;
          const cache = await caches.open(names[0]!);
          const urls = [new URL('./', location.href).href, ...files.map((f) => new URL(f, location.href).href)];
          let missing = 0;
          for (const url of urls) if (!(await cache.match(url))) missing++;
          return missing;
        }, wanted),
      { timeout: 60_000 },
    )
    .toBe(0);
  // The device report says so.
  await press(page, 'title-settings');
  await expect(page.getByTestId('device-report')).toHaveValue(new RegExp(`^Offline play: ready: all ${wanted.length} files kept$`, 'm'));
  await press(page, 'sheet-close');

  // No network at all: the server is gone and the browser is offline.
  await server.close();
  await context.setOffline(true);
  const reached = await page.evaluate(() =>
    fetch(`./never-cached-${Date.now()}.txt`).then(
      () => true,
      () => false,
    ),
  );
  expect(reached, 'nothing is reachable over the network').toBe(false);

  await page.reload();
  await expect(page.getByTestId('title-screen')).toBeVisible();
  await expect(page.getByTestId('title-load-error')).toHaveCount(0);
  await press(page, 'title-play');
  await press(page, 'intro-ok');
  // The star map is loaded on demand: it has to come from the cache too.
  await press(page, 'dock-map');
  await expect(page.getByTestId('galaxy-map')).toBeVisible();
});

test('a download that fails while the game is kept for offline play is tried again', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'The service worker is the same on every device; once is enough.');
  // The science notes load only on demand, so only the worker asks for them: that first time fails.
  await server.close();
  server = await servePages('dist', 0, 'localhost', { failOnce: /\/assets\/encyclopedia-[^/]+\.js$/ });
  await page.goto(server.url + '/');
  await expect(page.getByTestId('title-screen')).toBeVisible();
  const wanted = await page.evaluate(() => (JSON.parse(document.getElementById('offline-files')?.textContent ?? '[]') as string[]).length);
  await press(page, 'title-settings');
  // Ready once the second try has got it (the report is made each time Settings opens).
  await expect
    .poll(
      async () => {
        await press(page, 'sheet-close');
        await press(page, 'title-settings');
        await expect(page.getByTestId('device-report')).toHaveValue(/^Starman Reborn device report/);
        return page.getByTestId('device-report').inputValue();
      },
      { timeout: 60_000, intervals: [2_000] },
    )
    .toMatch(new RegExp(`^Offline play: ready: all ${wanted} files kept$`, 'm'));
  const tries = [...server.requests].find(([path]) => /\/assets\/encyclopedia-/.test(path))?.[1];
  expect(tries, 'failed once, then fetched again').toBe(2);
});
