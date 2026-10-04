import { expect, test, type Page } from '@playwright/test';
import { api, openFresh, press, waitUntil } from './helpers.ts';

/**
 * A station of your own (docs/PROCGEN.md §22): a site chartered in the Fleet window at Lalande
 * 21185, the frame's materials handed over at the site in the Outpost window, the outpost open with
 * a market, paying by the hour, and in the system's scene to fly from and back to.
 */

type Hooks = { __starman: { completeJobs(ids: string[]): void; dockAt(id: string): void } };
interface OutpostState {
  credits: number;
  world: { outposts?: { site: string; name: string; stage: number; earned: number }[] };
}

const DOCK = 'wayfarer-array';
const PLANET = 'gj-411-b';
const OUTPOST = `outpost.${PLANET}`;

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
  await waitUntil(page, `docked at ${id}`, async () => (await api<{ location: { dockedAt: string | null } }>(page, 'state')).location.dockedAt === id);
  await hearOut(page);
}

/** Opens a deck window (the buttons toggle: press only when it is not open already). */
async function openDeckWindow(page: Page, button: string, content: string): Promise<void> {
  await press(page, 'room-deck');
  if (!(await page.getByTestId(content).isVisible().catch(() => false))) await press(page, button);
  await expect(page.getByTestId(content)).toBeVisible();
}

test('your own outpost: chartered, built and opened at Lalande 21185, paying its way', async ({ page }) => {
  await openFresh(page);
  await press(page, 'title-play');
  await press(page, 'intro-ok');
  await page.evaluate(() => (window as unknown as Hooks).__starman.completeJobs(['lifeline']));
  await api(page, 'setCredits', 50_000);

  // At Wayfarer Array, the Fleet window offers the sites of Lalande 21185: charter one.
  await dockAt(page, DOCK);
  await openDeckWindow(page, 'station-fleet', 'fleet');
  await expect(page.getByTestId('outpost-sites')).toContainText('Found an outpost');
  await press(page, `outpost-charter-${PLANET}`);
  await expect(page.getByTestId('outpost-charter-dialog')).toBeVisible();
  const name = await page.getByTestId('outpost-name').inputValue();
  await press(page, 'outpost-charter-confirm');
  let s = await api<OutpostState>(page, 'state');
  expect(s.world.outposts?.[0]).toMatchObject({ site: PLANET, name, stage: 0 });
  expect(s.credits).toBe(50_000 - 8_000);
  await expect(page.getByTestId('outpost-status')).toContainText('Its frame is going up');

  // At the site, the Outpost window takes the frame's materials from the hold.
  await dockAt(page, OUTPOST);
  await openDeckWindow(page, 'station-outpost', 'outpost-window');
  await expect(page.getByTestId('room-trader')).toHaveCount(0);
  await api(page, 'setCargo', { 'habitat-modules': 8, metals: 20, machinery: 6 });
  await openDeckWindow(page, 'station-outpost', 'outpost-window');
  for (const good of ['habitat-modules', 'metals', 'machinery']) await press(page, `outpost-deliver-${good}`);

  // Its frame is up: it is open, with a market, and its window says what the station needs next.
  await waitUntil(page, 'the outpost open', async () => (await api<OutpostState>(page, 'state')).world.outposts?.[0]?.stage === 1);
  await expect(page.getByTestId('outpost-window-status')).toContainText('Open, a frame');
  await expect(page.getByTestId('room-trader')).toBeVisible();

  // It pays by the hour, and the toast says so.
  await api(page, 'advanceClock', 3_600);
  s = await api<OutpostState>(page, 'state');
  expect(s.world.outposts![0]!.earned).toBeGreaterThan(0);
  await expect(page.getByText(/Income from your outpost: \+\d+ cr\./)).toBeVisible();

  // Out in Lalande 21185, it is a station of the system, to fly back to.
  await press(page, 'dock-launch');
  await waitUntil(page, 'in flight', async () => (await api(page, 'mode')) === 'flight');
  if (await page.getByTestId('controls-sheet').isVisible().catch(() => false)) await press(page, 'sheet-close');
  const targets = await api<{ id: string; name: string }[]>(page, 'targets');
  expect(targets).toContainEqual(expect.objectContaining({ id: `station:${OUTPOST}`, name }));
});
