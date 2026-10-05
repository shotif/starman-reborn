import { expect, test, type Page } from '@playwright/test';
import { api, isTouch, openFresh, press, waitUntil } from './helpers.ts';

/**
 * Passengers and sightseers (docs/PROCGEN.md §23): a passenger cabin bought and fitted at Meridian
 * Outpost's outfitter, a sightseer taken on at its bar to see Proxima Centauri d, the planet seen
 * from close by in flight (the passenger says so, from the archive's record), and home again to be
 * paid in full.
 */

interface PassengerState {
  credits: number;
  clock: number;
  ship: { fittings: Record<string, string> };
  jobs: Record<string, { status: string; objectiveIndex: number; seen?: boolean } | undefined>;
  contracts: Record<string, { reward: number; contract?: { party?: string[] } } | undefined>;
}

const DOCK = 'meridian-outpost';
const CABIN = 'gear.cabin.1.toliman';
/** Meridian's board from the second posting (game time 1,500 s): a party of one to see Proxima Centauri d. */
const TOUR = 'c.meridian-outpost.1.1';
const SIGHT = 'planet:proxima-cen-d';

/** Clicks through whatever is said, until nothing more comes for a second. */
async function hearOut(page: Page): Promise<void> {
  const next = page.getByTestId('story-continue').or(page.getByTestId('folk-continue')).first();
  for (let quiet = 0, i = 0; quiet < 3 && i < 40; i++) {
    if (await next.isVisible().catch(() => false)) {
      quiet = 0;
      await next.click().catch(() => {});
    } else quiet++;
    await page.waitForTimeout(300);
  }
}

async function dockAt(page: Page, id: string): Promise<void> {
  await api(page, 'dockAt', id);
  await waitUntil(page, `docked at ${id}`, async () => (await api<{ location: { dockedAt: string | null } }>(page, 'state')).location.dockedAt === id);
  await hearOut(page);
}

/** Closes a discovery card if one is up (it pauses the flight). */
async function dismissDiscovery(page: Page): Promise<void> {
  const ok = page.getByTestId('discovery-ok');
  if (await ok.isVisible().catch(() => false)) await ok.click().catch(() => {});
}

async function openWindow(page: Page, room: string, action: string, windowId: string): Promise<void> {
  await press(page, room);
  if (!(await page.getByTestId(windowId).isVisible().catch(() => false))) await press(page, action);
  await expect(page.getByTestId(windowId)).toBeVisible();
}

test('sightseers: a cabin fitted, a tour taken at the bar, Proxima Centauri d seen up close, and paid at home', async ({ page }) => {
  await openFresh(page);
  await press(page, 'title-play');
  await press(page, 'intro-ok');
  await api(page, 'completeJobs', ['lifeline']);
  await api(page, 'setCredits', 20_000);
  const start = await api<PassengerState>(page, 'state');
  await api(page, 'advanceClock', 1_560 - start.clock);
  await dockAt(page, DOCK);

  // The outfitter sells passenger cabins for the utility mount: buy one and fit it.
  await openWindow(page, 'room-outfitter', 'station-equip', 'outfitter-window');
  await press(page, 'slot-utility-1');
  await press(page, `buy-${CABIN}`);
  await press(page, 'shop-confirm');
  await waitUntil(page, 'the cabin fitted', async () => (await api<PassengerState>(page, 'state')).ship.fittings['utility-1'] === CABIN);

  // At the bar the tour names its party and the berths it needs; take it on.
  await openWindow(page, 'room-bar', 'station-jobs', 'jobs-window');
  const card = page.getByTestId(`job-${TOUR}`);
  await expect(card).toContainText('Sightseers to Proxima Centauri d');
  const head = card.locator('.job-head');
  if (await isTouch(page)) await head.tap();
  else await head.click();
  await expect(page.getByTestId(`job-party-${TOUR}`)).toContainText('1 berth (you have 2 free)');
  await press(page, `accept-${TOUR}`);
  let s = await api<PassengerState>(page, 'state');
  expect(s.jobs[TOUR]?.status).toBe('active');
  const lead = s.contracts[TOUR]!.contract!.party![0]!;
  const reward = s.contracts[TOUR]!.reward;

  // Out to the planet: close enough for a good look, the passenger says so, and the tour turns for home.
  await press(page, 'dock-launch');
  await waitUntil(page, 'in flight', async () => (await api(page, 'mode')) === 'flight');
  if (await page.getByTestId('controls-sheet').isVisible().catch(() => false)) await press(page, 'sheet-close');
  // Proxima Centauri b is in the scanner from the dock: a discovery card may pause the flight.
  await waitUntil(page, 'undocked', async () => (await dismissDiscovery(page), (await api<{ autopilot: string } | null>(page, 'player'))?.autopilot === 'none'), 60_000);
  expect(await api<boolean>(page, 'placeNear', { id: SIGHT, distance: 3_000 })).toBe(true);
  await waitUntil(page, 'the sight seen', async () => (await dismissDiscovery(page), (await api<PassengerState>(page, 'state')).jobs[TOUR]?.objectiveIndex === 1));
  await expect(page.locator('.toast.comm', { hasText: lead })).toContainText('Proxima Centauri d');
  expect((await api<PassengerState>(page, 'state')).jobs[TOUR]?.seen).toBe(true);

  // Home to Meridian Outpost: paid in full, no rough trip.
  const before = (await api<PassengerState>(page, 'state')).credits;
  await dockAt(page, DOCK);
  await waitUntil(page, 'the tour complete', async () => (await api<PassengerState>(page, 'state')).jobs[TOUR]?.status === 'complete');
  s = await api<PassengerState>(page, 'state');
  expect(s.credits - before).toBe(reward);
});
