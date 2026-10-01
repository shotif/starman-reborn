import { expect, test, type Page } from '@playwright/test';
import { press } from './helpers.ts';
import { servePages, type PagesServer } from './pagesServer.ts';

/**
 * The first load on a slow phone network (docs/TEST_RECORD.md): the production build served the
 * way GitHub Pages serves it (gzip, ten-minute cache) through Chromium's network throttling at
 * Lighthouse's "slow 4G" (1.6 Mbit/s down, 750 kbit/s up, 150 ms latency). The CPU is the test
 * machine's, so the times are for comparing builds, not a promise about any phone.
 */
const SLOW_4G = { offline: false, latency: 150, downloadThroughput: (1.6e6 / 8) * 0.9, uploadThroughput: (750e3 / 8) * 0.9 };

/** The loading title must be up well before the game: measured at about 0.45 s on slow 4G. */
const FIRST_SCREEN_BUDGET_MS = 1500;

let server: PagesServer;
test.beforeAll(async () => {
  server = await servePages();
});
test.afterAll(async () => {
  await server.close();
});

interface Marks {
  /** When anything of the title first showed (the loading title, or the title itself). */
  firstScreen: number | null;
  /** When the title with Play showed. */
  title: number | null;
  /** Every value the progress bar showed, in order. */
  progress: number[];
  /** Whether it said "Starting" once everything had arrived. */
  starting: boolean;
}

/** Notes, in page time, when the loading title and the title first appear, and the bar's values. */
async function watchMarks(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const marks: Marks = { firstScreen: null, title: null, progress: [], starting: false };
    (window as unknown as { __loadMarks: Marks }).__loadMarks = marks;
    const shown = (sel: string) => {
      const el = document.querySelector<HTMLElement>(sel);
      return !!el && el.getBoundingClientRect().height > 0;
    };
    const look = () => {
      if (marks.firstScreen === null && (shown('[data-testid="title-loading"]') || shown('[data-testid="title-screen"]'))) {
        marks.firstScreen = performance.now();
      }
      if (marks.title === null && shown('[data-testid="title-screen"]')) marks.title = performance.now();
      if (marks.title === null) requestAnimationFrame(look);
    };
    requestAnimationFrame(look);
    new MutationObserver(() => {
      const meter = document.querySelector('[data-testid="title-progress"]');
      const value = meter?.getAttribute('aria-valuenow');
      if (value !== null && value !== undefined && Number(value) !== marks.progress.at(-1)) marks.progress.push(Number(value));
      if (meter?.getAttribute('aria-valuetext') === 'Starting' && meter.textContent?.includes('Starting')) marks.starting = true;
    }).observe(document, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['aria-valuenow', 'aria-valuetext'] });
  });
}

test('the first load on a slow phone network', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'One network measurement is enough; the touch project would repeat it.');
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.emulateNetworkConditions', SLOW_4G);
  const urls = new Map<string, string>();
  const bytes = new Map<string, number>();
  cdp.on('Network.requestWillBeSent', (e: { requestId: string; request: { url: string } }) => {
    urls.set(e.requestId, e.request.url);
  });
  cdp.on('Network.loadingFinished', (e: { requestId: string; encodedDataLength: number }) => {
    bytes.set(e.requestId, e.encodedDataLength);
  });
  await watchMarks(page);
  await page.goto(server.url + '/');
  await expect(page.getByTestId('title-screen')).toBeVisible({ timeout: 120_000 });
  await expect(page.getByTestId('title-loading')).toHaveCount(0);
  const marks = await page.evaluate(() => (window as unknown as { __loadMarks: Marks }).__loadMarks);

  // Over the network, per file: the game's files arrive once, then come from the cache.
  const perUrl = new Map<string, number[]>();
  let total = 0;
  for (const [id, n] of bytes) {
    total += n;
    const url = urls.get(id) ?? id;
    perUrl.set(url, [...(perUrl.get(url) ?? []), n]);
  }
  const listed = await page.evaluate(() => JSON.parse(document.getElementById('boot-files')?.textContent ?? '[]') as { url: string; bytes: number }[]);
  const report = {
    firstScreenMs: Math.round(marks.firstScreen ?? -1),
    titleMs: Math.round(marks.title ?? -1),
    transferredKB: Math.round(total / 1024),
    requests: bytes.size,
    progressSteps: marks.progress.length,
  };
  console.log('slow 4G load:', JSON.stringify(report));
  if (process.env.LOAD_DETAIL) {
    const timing = await page.evaluate(() =>
      performance.getEntriesByType('resource').map((e) => {
        const r = e as PerformanceResourceTiming;
        return `${Math.round(r.startTime)}–${Math.round(r.responseEnd)} ${Math.round(r.encodedBodySize / 1024)}KB ${r.name.split('/').pop()}`;
      }),
    );
    console.log(timing.join('\n'));
  }
  info.annotations.push({ type: 'slow 4G load', description: JSON.stringify(report) });

  expect(marks.firstScreen, 'the loading title shows').not.toBeNull();
  expect(marks.firstScreen!).toBeLessThan(FIRST_SCREEN_BUDGET_MS);
  expect(marks.title!).toBeGreaterThan(marks.firstScreen!);
  // The bar moves forward in many steps and reaches the end.
  expect(marks.progress.length).toBeGreaterThan(5);
  expect(marks.progress).toEqual([...marks.progress].sort((a, b) => a - b));
  expect(marks.progress.at(-1)).toBe(100);
  // Then, while the game starts up, it says so rather than sitting at 100%.
  expect(marks.starting).toBe(true);
  // Every listed file came over the network once: the game's own import of it found it in the
  // cache (a transfer of a few hundred bytes of headers at most), not a second download.
  expect(listed.length).toBeGreaterThan(0);
  for (const file of listed) {
    const transfers = perUrl.get(new URL(file.url, server.url + '/').href) ?? [];
    expect(transfers.filter((n) => n > 2048), `${file.url} downloaded once`).toHaveLength(1);
  }
});

test('a download that fails offers to try again', async ({ page }) => {
  let failures = 0;
  // The game's largest file fails once, as on a dropped connection.
  await page.route(/\/assets\/boot-[^/]+\.js$/, async (route) => {
    if (failures === 0) {
      failures++;
      await route.abort('internetdisconnected');
    } else {
      await route.continue();
    }
  });
  await page.goto('/?test=1');
  await expect(page.getByTestId('title-load-error')).toBeVisible();
  await expect(page.getByTestId('title-load-error')).toContainText('did not finish loading');
  await expect(page.getByTestId('title-progress')).toBeHidden();
  await press(page, 'title-retry');
  await expect(page.getByTestId('title-screen')).toBeVisible();
  await expect(page.getByTestId('title-play')).toBeEnabled();
  expect(failures).toBe(1);
});
