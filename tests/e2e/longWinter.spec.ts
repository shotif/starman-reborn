import { expect, test, type Page } from '@playwright/test';
import { api, isTouch, openFresh, press, waitUntil } from './helpers.ts';

/**
 * The Long Winter (docs/PROCGEN.md §40): Tamsin Rook at Deimos Depot sends the pilot out to the
 * Kuiper Belt to listen for a cutter gone quiet; the Long Winter found adrift in the ice and her drive
 * coupling handed over alongside; then, the crews' way chosen, a stand with their cutters at their
 * rocks against two waves of claim-jumpers, and how it changes Deimos Depot for good.
 */

type Hooks = { __starman: { completeJobs(ids: string[]): void; dockAt(id: string): void; warp(id: string): void } };
type JobsState = {
  jobs: Record<string, { status: string; objectiveIndex: number; stood?: true }>;
  ship: { cargo: Record<string, number> };
  story: { choices: Record<string, string> };
  world: { marks?: Record<string, number> };
};
interface Stand {
  jobId: string;
  state: string;
  cutters: number;
  jumpers: number;
  distance: number;
}
interface Npc {
  id: string;
  stand: 'cutter' | 'jumper' | null;
  hull: number;
}

const state = (page: Page) => api<JobsState>(page, 'state');

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

/** Waits for a line said on the radio in flight. */
async function heard(page: Page, words: string): Promise<void> {
  await waitUntil(page, `“${words}” on the radio`, async () => (await api<string[]>(page, 'comms')).some((l) => l.includes(words)), 30_000);
}

async function launchInSol(page: Page): Promise<void> {
  await page.evaluate(() => (window as unknown as Hooks).__starman.warp('sol'));
  await waitUntil(page, 'in flight', async () => (await api<string>(page, 'mode')) === 'flight', 60_000);
}

test('The Long Winter: a cutter gone quiet in the Kuiper dark, heard on a scan and found adrift in the ice', async ({ page }) => {
  await openFresh(page);
  await press(page, 'title-play');
  await press(page, 'intro-ok');
  await page.evaluate(() => (window as unknown as Hooks).__starman.completeJobs(['lifeline']));
  const touch = await isTouch(page);

  // Deimos Depot: Tamsin Rook, for the belt crews, asks no standing.
  await dockAt(page, 'mars-depot');
  await hearOut(page);
  await openJobs(page);
  await expect(page.getByTestId('job-arc.kuiper.1')).toContainText('Gone quiet');
  await press(page, 'accept-arc.kuiper.1');
  await hearOut(page);

  // Out to the Kuiper Belt: scanned from within the scanner's range, the beacon is heard.
  await launchInSol(page);
  expect(await api<boolean>(page, 'placeNear', { id: 'belt:sol-kuiper-belt', distance: 0 })).toBe(true);
  await api(page, 'selectTarget', 'belt:sol-kuiper-belt');
  await waitUntil(page, 'Scan offered at the belt', async () => (await api<{ context?: { action: string } } | null>(page, 'hud'))?.context?.action === 'scan', 30_000);
  await press(page, touch ? 'touch-context' : 'hud-context');
  await waitUntil(page, 'the belt scanned', async () => (await state(page)).jobs['arc.kuiper.1']?.objectiveIndex === 1, 30_000);
  await heard(page, 'Drive dead, air for four days');
  if (await page.getByTestId('sheet-close').isVisible().catch(() => false)) await press(page, 'sheet-close');

  // Back at Deimos: the step done, and the parts for the rescue handed over on acceptance.
  await dockAt(page, 'mars-depot');
  await expect(page.getByTestId('story-dialog')).toContainText('nobody waits for the Authority');
  await hearOut(page);
  expect((await state(page)).jobs['arc.kuiper.1']?.status).toBe('complete');
  await openJobs(page);
  await press(page, 'accept-arc.kuiper.2');
  await hearOut(page);
  expect((await state(page)).ship.cargo['ship-parts']).toBe(3);

  // The Long Winter adrift in the ice itself; alongside her, the coupling goes aboard.
  await launchInSol(page);
  await waitUntil(page, 'the Long Winter in sight', async () => (await api<{ id: string }[]>(page, 'targets')).some((t) => t.id === 'stranded:arc.kuiper.2'), 60_000);
  await expect(page.getByTestId('hud-objective')).toContainText('Bring 3 ship components to the Long Winter');
  expect(await api<boolean>(page, 'placeNear', { id: 'stranded:arc.kuiper.2', distance: 150 })).toBe(true);
  await waitUntil(page, 'the parts handed over', async () => (await state(page)).jobs['arc.kuiper.2']?.objectiveIndex === 1, 30_000);
  expect((await state(page)).ship.cargo['ship-parts'] ?? 0).toBe(0);
  await heard(page, 'the coupling’s in and the drive’s turning');
  await expect(page.getByTestId('hud-objective')).toContainText('Deimos Depot');

  // Home: Ashdown shows the sheared coupling, and the journal keeps the story.
  await dockAt(page, 'mars-depot');
  await expect(page.getByTestId('story-dialog')).toContainText('sheared clean through');
  await hearOut(page);
  expect((await state(page)).jobs['arc.kuiper.2']?.status).toBe('complete');
  await press(page, 'station-journal');
  await expect(page.getByTestId('arc-kuiper')).toContainText('The Long Winter');
});

test('The Long Winter, the crews’ way: a stand with their cutters against claim-jumpers, and Deimos Depot changed for good', async ({ page }) => {
  await openFresh(page);
  await press(page, 'title-play');
  await press(page, 'intro-ok');
  // The arc flown to its reckoning (the flight is the test above's and longWinter.test.ts's).
  await page.evaluate(() => (window as unknown as Hooks).__starman.completeJobs(['lifeline', 'arc.kuiper.1', 'arc.kuiper.2', 'arc.kuiper.3']));

  // The reckoning at Deimos: the crews settle it themselves.
  await dockAt(page, 'mars-depot');
  await hearOut(page);
  await openJobs(page);
  await press(page, 'accept-arc.kuiper.4');
  await waitUntil(page, 'the choice', async () => {
    if (await page.getByTestId('choice-dialog').isVisible().catch(() => false)) return true;
    const next = page.getByTestId('story-continue');
    if (await next.isVisible().catch(() => false)) await next.click().catch(() => {});
    return false;
  }, 30_000);
  await expect(page.getByTestId('choice-bury')).toContainText('Take Hale’s money');
  await press(page, 'choice-crews');
  await expect(page.getByTestId('story-dialog')).toContainText('We fit our own');
  await hearOut(page);
  expect((await state(page)).story.choices['kuiper.reckoning']).toBe('crews');

  // The finale: out to the crews' rocks in the Kuiper Belt.
  await openJobs(page);
  await expect(page.getByTestId('job-arc.kuiper.5.crews')).toContainText('A stand in the ice');
  await press(page, 'accept-arc.kuiper.5.crews');
  await hearOut(page);
  await launchInSol(page);
  await waitUntil(page, 'the cutters at their rocks', async () => (await api<Stand | null>(page, 'stand'))?.cutters === 3, 60_000);
  await expect(page.getByTestId('hud-objective')).toContainText('Stand with the crews’ cutters');
  expect((await api<Stand>(page, 'stand')).state).toBe('waiting');

  // Close by, the stand begins: claim-jumpers out of the dark, wave after wave, all brought down.
  expect(await api<boolean>(page, 'placeNear', { id: 'stand:arc.kuiper.5.crews', distance: 1_500 })).toBe(true);
  await waitUntil(page, 'the first wave', async () => (await api<Stand>(page, 'stand')).jumpers > 0, 60_000);
  await expect(page.getByText(/claim-jumpers out of the dark/).first()).toBeVisible();
  for (let i = 0; i < 4 && (await api<Stand>(page, 'stand')).state === 'on'; i++) {
    for (const n of (await api<Npc[]>(page, 'npcs')).filter((x) => x.stand === 'jumper' && x.hull > 0)) await api(page, 'destroyNpc', { id: n.id, byPlayer: true });
    await waitUntil(page, 'the next wave or the end', async () => {
      const s = await api<Stand>(page, 'stand');
      return s.state !== 'on' || s.jumpers > 0;
    }, 60_000);
  }
  expect((await api<Stand>(page, 'stand')).state).toBe('won');
  await waitUntil(page, 'the stand won', async () => (await state(page)).jobs['arc.kuiper.5.crews']?.stood === true, 30_000);

  // Done there and then: the pay, the debrief on the radio, and Deimos Depot changed for good.
  const s = await state(page);
  expect(s.jobs['arc.kuiper.5.crews']?.status).toBe('complete');
  expect(Object.keys(s.world.marks ?? {})).toEqual(['kuiper.crews']);
  await heard(page, 'Not one beam went off');
  await dockAt(page, 'mars-depot');
  await hearOut(page);
  await press(page, 'room-bar');
  if (!(await page.getByTestId('news-window').isVisible().catch(() => false))) await press(page, 'station-news');
  await expect(page.getByTestId('mark-kuiper.crews')).toContainText('For good');
});
