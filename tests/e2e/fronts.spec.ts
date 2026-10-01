import { expect, test, type Page } from '@playwright/test';
import { api, openFresh, press, waitUntil } from './helpers.ts';

/**
 * Fronts that end (docs/PROCGEN.md §20.7): war work for the Frontier Cooperative on the YZ Ceti –
 * GJ 1 line earns its decisive operation; done, the line is the Cooperative's for good, the news
 * says so, and the lanes around it change for good.
 */

type Hooks = { __starman: { completeJobs(ids: string[]): void; dockAt(id: string): void; borderDeed(front: string, amount: number): void } };
type World = { world: { border: Record<string, { ending?: string }>; marks?: Record<string, number> } };
const FRONT = 'gj-1~yz-ceti';

async function dockAt(page: Page, id: string): Promise<void> {
  await page.evaluate((loc) => (window as unknown as Hooks).__starman.dockAt(loc), id);
  await waitUntil(page, `docked at ${id}`, async () => (await api<{ location: { dockedAt: string | null } }>(page, 'state')).location.dockedAt === id);
}

async function openWindow(page: Page, room: string, button: string, window: string): Promise<void> {
  await press(page, room);
  if (!(await page.getByTestId(window).isVisible().catch(() => false))) await press(page, button);
}

test('war work earns the decisive operation; done, the YZ Ceti line is the Cooperative’s for good', async ({ page }) => {
  await openFresh(page);
  await press(page, 'title-play');
  await press(page, 'intro-ok');
  await page.evaluate(() => (window as unknown as Hooks).__starman.completeJobs(['lifeline']));
  // Three war contracts' worth for the Cooperative, then the next time slot's boards.
  for (let i = 0; i < 3; i++) await page.evaluate((f) => (window as unknown as Hooks).__starman.borderDeed(f, 18), FRONT);
  await api(page, 'advanceClock', 1_500);

  await dockAt(page, 'heather-smelter');
  await openWindow(page, 'room-bar', 'station-jobs', 'jobs-window');
  const op = page.locator('[data-testid^="job-c.heather-smelter."]', { hasText: 'End it at Cutlass Nest' });
  await expect(op).toBeVisible();
  await expect(op).toContainText('Settles the front for good');
  await op.locator('.job-head').click();
  await expect(op).toContainText('The decisive fight for the YZ Ceti – GJ 1 line');
  const id = (await op.getAttribute('data-testid'))!.slice('job-'.length);

  // Flown (the den assault itself is the combat tests' and the flight tests'): the line is settled.
  await page.evaluate((ids) => (window as unknown as Hooks).__starman.completeJobs(ids), [id]);
  const state = await api<World>(page, 'state');
  expect(state.world.border[FRONT]?.ending).toBe('law');
  expect(Object.keys(state.world.marks ?? {}).sort()).toEqual(['front.law.hearthstone-works', 'front.law.heather-smelter', 'front.law.hitching-freeport']);

  // The news says so, for good, and the board carries the reopened lanes.
  await openWindow(page, 'room-bar', 'station-news', 'news-window');
  await expect(page.getByTestId(`border-${FRONT}`)).toContainText('holds the YZ Ceti – GJ 1 line');
  await expect(page.getByTestId('mark-front.law.heather-smelter')).toContainText('Safe lanes at Heather Smelter');
  await openWindow(page, 'room-bar', 'station-jobs', 'jobs-window');
  await expect(page.getByTestId('jobs-window')).toContainText(/Reopened lanes: \d+ refined metals to /);
});
