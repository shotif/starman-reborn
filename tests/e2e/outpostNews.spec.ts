import { expect, test, type Page } from '@playwright/test';
import { api, openFresh, press, waitUntil } from './helpers.ts';

/**
 * Outposts have news (docs/PROCGEN.md §39): a refinery chartered in Sol's main belt and its frame
 * built; its Outpost window's News says all is quiet; when a shortage comes, a toast says so and
 * what it does to the income, the Fleet window's reports keep it, the Outpost window and the bar's
 * News show it; the pilot sells the goods there and the shortage is relieved, with no bonus.
 */

type Hooks = { __starman: { completeJobs(ids: string[]): void; dockAt(id: string): void } };
interface NewsState {
  clock: number;
  credits: number;
  location: { dockedAt: string | null };
  world: { outposts?: { site: string; name: string; stage: number }[] };
  fleet: { reports: { kind: string; text: string }[] };
}
interface OutpostEvent {
  id: string;
  kind: string;
  start: number;
  end: number;
  goods: string[];
  headline: string;
  deficit: number;
}

const SITE = 'belt.sol-main-belt';
const OUTPOST = `outpost.${SITE}`;
const state = (page: Page) => api<NewsState>(page, 'state');

/** Clicks through whatever is said, until nothing more comes for a second. */
async function hearOut(page: Page): Promise<void> {
  const next = page.getByTestId('story-continue');
  for (let quiet = 0, i = 0; quiet < 3 && i < 40; i++) {
    if (await next.isVisible().catch(() => false)) {
      quiet = 0;
      await next.click().catch(() => {});
    } else quiet++;
    await page.waitForTimeout(300);
  }
}

async function dockAt(page: Page, id: string): Promise<void> {
  await page.evaluate((loc) => (window as unknown as Hooks).__starman.dockAt(loc), id);
  await waitUntil(page, `docked at ${id}`, async () => (await state(page)).location.dockedAt === id);
  await hearOut(page);
}

/** Opens a window of a room (the buttons toggle: press only when it is not open already). */
async function openWindow(page: Page, room: string, button: string, content: string): Promise<void> {
  await press(page, room);
  if (!(await page.getByTestId(content).isVisible().catch(() => false))) await press(page, button);
  await expect(page.getByTestId(content)).toBeVisible();
}

test('outposts have news: a shortage at your refinery is told, cuts its income, and is relieved by your sales', async ({ page }) => {
  await openFresh(page);
  await press(page, 'title-play');
  await press(page, 'intro-ok');
  await page.evaluate(() => (window as unknown as Hooks).__starman.completeJobs(['lifeline']));
  await api(page, 'setCredits', 80_000);

  // A refinery chartered in Sol's main belt from Earth Port, its frame built.
  await dockAt(page, 'earth-port');
  await openWindow(page, 'room-deck', 'station-fleet', 'fleet');
  await press(page, `outpost-charter-${SITE}`);
  const name = await page.getByTestId('outpost-name').inputValue();
  await press(page, 'outpost-charter-confirm');
  await dockAt(page, OUTPOST);
  await api(page, 'setCargo', { 'habitat-modules': 8, metals: 20, machinery: 6 });
  await openWindow(page, 'room-deck', 'station-outpost', 'outpost-window');
  for (const good of ['habitat-modules', 'metals', 'machinery']) await press(page, `outpost-deliver-${good}`);
  await waitUntil(page, 'the outpost open', async () => (await state(page)).world.outposts?.[0]?.stage === 1);
  await openWindow(page, 'room-deck', 'station-outpost', 'outpost-window');
  await expect(page.getByTestId('outpost-news')).toBeVisible();

  // The next shortage there: when it comes, a toast says so and what it does to the income.
  const e = (await api<OutpostEvent | null>(page, 'outpostEvent', { kind: 'shortage' }))!;
  expect(e).toBeTruthy();
  expect(e.headline).toContain(name);
  const clock = (await state(page)).clock;
  await api(page, 'advanceClock', e.start - clock + 60);
  const line = `${e.headline}: its income down 15% while it lasts.`;
  await expect(page.getByText(line).first()).toBeVisible();
  expect((await state(page)).fleet.reports.some((r) => r.kind === 'news' && r.text === line)).toBe(true);

  // The Outpost window's News, the Fleet window's reports, and the bar's News.
  await openWindow(page, 'room-deck', 'station-outpost', 'outpost-window');
  await expect(page.getByTestId('outpost-news-headline')).toHaveText(e.headline);
  await expect(page.getByTestId('outpost-news-detail')).toContainText('Its income down 15% while it lasts; due to end in');
  await openWindow(page, 'room-deck', 'station-fleet', 'fleet');
  await expect(page.getByTestId('fleet-reports')).toContainText(line);
  await openWindow(page, 'room-bar', 'station-news', 'news-window');
  await expect(page.getByTestId('news-window')).toContainText(e.headline);

  // The pilot sells the goods there: the shortage is relieved, with no bonus at one's own outpost.
  expect(e.deficit).toBeGreaterThan(0);
  expect(e.deficit).toBeLessThanOrEqual(18);
  const good = e.goods[0]!;
  await api(page, 'setCargo', { [good]: e.deficit });
  await press(page, 'room-trader');
  await press(page, `sell-${good}`);
  await expect(page.getByTestId('sell-qty')).toHaveText(String(e.deficit));
  await press(page, 'sell-confirm');
  await expect(page.getByText(`Shortage relieved: ${name} is supplied again, and its income is back to normal.`).first()).toBeVisible();
  await openWindow(page, 'room-deck', 'station-outpost', 'outpost-window');
  await expect(page.getByTestId('outpost-news-headline')).toHaveText('All quiet');
});
