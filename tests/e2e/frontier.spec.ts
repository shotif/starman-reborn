import { expect, test, type Page } from '@playwright/test';
import { api, openFresh, press, waitUntil } from './helpers.ts';

/**
 * The frontier's own story (docs/PROCGEN.md §14.6): First Harvest from Squall Relay, at the core's
 * edge, out to Harrow Farmstead, then the Wrenna, a hauler stranded far from any dock in Achird,
 * rescued in flight by handing her drive parts over alongside; and how the arc's ending changes Harrow
 * Farmstead for good (§14.7).
 */

type Hooks = { __starman: { completeJobs(ids: string[]): void; dockAt(id: string): void; warp(id: string): void } };
type JobsState = { jobs: Record<string, { status: string; objectiveIndex: number }>; ship: { cargo: Record<string, number> } };

async function openJobs(page: Page): Promise<void> {
  await press(page, 'room-bar');
  if (!(await page.getByTestId('jobs-window').isVisible().catch(() => false))) await press(page, 'station-jobs');
}

/** Clicks through whatever is said, until nothing more comes for a second. */
async function hearOut(page: Page): Promise<void> {
  const next = page.getByTestId('story-continue');
  for (let quiet = 0, i = 0; quiet < 3 && i < 40; i++) {
    if (await next.isVisible().catch(() => false)) {
      quiet = 0;
      await next.click().catch(() => {});
    } else quiet++;
    await page.waitForTimeout(400);
  }
}

async function dockAt(page: Page, id: string): Promise<void> {
  await page.evaluate((loc) => (window as unknown as Hooks).__starman.dockAt(loc), id);
  await waitUntil(page, `docked at ${id}`, async () => (await api<{ location: { dockedAt: string | null } }>(page, 'state')).location.dockedAt === id);
}

test('First Harvest: the call from the far farms, and the Wrenna rescued far from any dock', async ({ page }) => {
  await openFresh(page);
  await press(page, 'title-play');
  await press(page, 'intro-ok');
  await page.evaluate(() => (window as unknown as Hooks).__starman.completeJobs(['lifeline']));

  // Squall Relay, at the edge of the core: Ines Halloway passes on Harrow's calls.
  await dockAt(page, 'squall-relay');
  await hearOut(page);
  await openJobs(page);
  await expect(page.getByTestId('job-arc.harvest.1')).toContainText('The far farms');
  await press(page, 'accept-arc.harvest.1');
  await hearOut(page);

  // Harrow Farmstead: Orla Fenwick, and the hauler adrift with next year's seed.
  await dockAt(page, 'harrow-farmstead');
  await expect(page.getByTestId('story-dialog')).toContainText('there’s soup');
  await hearOut(page);
  await openJobs(page);
  await press(page, 'accept-arc.harvest.2');
  await hearOut(page);
  expect((await api<JobsState>(page, 'state')).ship.cargo['ship-parts']).toBe(4);

  // Achird: the Wrenna drifts far from any dock; the objective steers to her.
  await page.evaluate(() => (window as unknown as Hooks).__starman.warp('achird'));
  await waitUntil(page, 'the Wrenna in sight', async () => (await api<{ id: string }[]>(page, 'targets')).some((t) => t.id === 'stranded:arc.harvest.2'), 60_000);
  await expect(page.getByTestId('hud-objective')).toContainText('Bring 4 ship components to the Wrenna');
  // Alongside her, the parts go aboard and her drive comes back.
  expect(await api<boolean>(page, 'placeNear', { id: 'stranded:arc.harvest.2', distance: 150 })).toBe(true);
  await waitUntil(page, 'the parts handed over', async () => (await api<JobsState>(page, 'state')).jobs['arc.harvest.2']?.objectiveIndex === 1, 30_000);
  expect((await api<JobsState>(page, 'state')).ship.cargo['ship-parts'] ?? 0).toBe(0);
  await expect(page.getByTestId('hud-objective')).toContainText('Report to Orla Fenwick');

  // Back at Harrow: the seed is in the store, and the step is done.
  await dockAt(page, 'harrow-farmstead');
  await expect(page.getByTestId('story-dialog')).toContainText('seed’s in the store');
  await hearOut(page);
  expect((await api<JobsState>(page, 'state')).jobs['arc.harvest.2']?.status).toBe('complete');
  await press(page, 'station-journal');
  await expect(page.getByTestId('arc-harvest')).toContainText('First Harvest');
});

test('First Harvest’s ending changes Harrow Farmstead for good: in the news, and a harvest run on its board', async ({ page }) => {
  await openFresh(page);
  await press(page, 'title-play');
  await press(page, 'intro-ok');
  // The arc flown to its end at Doppler Freeport (the flight itself is the test above's and story.test.ts's).
  await page.evaluate(() =>
    (window as unknown as Hooks).__starman.completeJobs(['lifeline', 'arc.harvest.1', 'arc.harvest.2', 'arc.harvest.3', 'arc.harvest.4', 'arc.harvest.5.freeport']),
  );
  expect(Object.keys((await api<{ world: { marks?: Record<string, number> } }>(page, 'state')).world.marks ?? {})).toEqual(['harvest.freeport']);

  await dockAt(page, 'harrow-farmstead');
  await hearOut(page);
  await press(page, 'room-bar');
  if (!(await page.getByTestId('news-window').isVisible().catch(() => false))) await press(page, 'station-news');
  await expect(page.getByTestId('mark-harvest.freeport')).toContainText('Harrow Farmstead farms for two harvests');
  await expect(page.getByTestId('mark-harvest.freeport')).toContainText('For good');
  await openJobs(page);
  await expect(page.getByTestId('jobs-window')).toContainText(/Harvest run: \d+ fine food to Doppler Freeport/);
});
