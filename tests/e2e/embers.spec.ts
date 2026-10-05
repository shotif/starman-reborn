import { expect, test, type Page } from '@playwright/test';
import { api, isTouch, openFresh, press, waitUntil } from './helpers.ts';

/**
 * Last Light at Pyre (docs/PROCGEN.md §42): offered at GJ 915 Freeport before Pyre warns, and
 * holding its warning once taken; the choice made at Pyre Observatory, Pyre's warning coming a minute
 * later; then, staying for the light, the observatory's lifeboats launched as it dies, gathered in
 * flight, and taken out through the lane to GJ 915 before the collapse, leaving the Pyre Archive there.
 */

interface State {
  clock: number;
  jobs: Record<string, { status: string; gathered?: number; clear?: true } | undefined>;
  location: { systemId: string; dockedAt: string | null };
  world: { marks?: Record<string, number>; sky?: { from: number; edge?: number } };
}
interface Boats {
  launched: boolean;
  out: number;
  aboard: number;
  launch: number;
  collapse: number;
}

const OBSERVATORY = 'pyre-observatory';
const FREEPORT = 'gj-915-freeport';
const state = (page: Page) => api<State>(page, 'state');

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
  await waitUntil(page, `docked at ${id}`, async () => (await state(page)).location.dockedAt === id);
}

async function openJobs(page: Page): Promise<void> {
  await press(page, 'room-bar');
  if (!(await page.getByTestId('jobs-window').isVisible().catch(() => false))) await press(page, 'station-jobs');
}

test('Last Light at Pyre: held, then started by the choice; six stay for the light, and come out in lifeboats', async ({ page }) => {
  await openFresh(page);
  await press(page, 'title-play');
  await press(page, 'intro-ok');
  await api(page, 'completeJobs', ['lifeline']);
  expect(await api(page, 'fit', 'gear.jump-drive.1.horizon')).toBe(true);
  // The far stars' story long over (Antares gone, §25), Pyre not yet warned.
  await api(page, 'skyFrom', 0);
  const sky = (await api<{ timeline: { bhGone: number } }>(page, 'sky'))!;
  await api(page, 'advanceClock', sky.timeline.bhGone + 600 - (await state(page)).clock);

  // GJ 915 Freeport, at the frontier: Neve Oduya's call. Taken, it holds Pyre's warning.
  await dockAt(page, FREEPORT);
  await hearOut(page);
  await openJobs(page);
  await expect(page.getByTestId('job-arc.embers.1')).toContainText('A short fuse');
  await press(page, 'accept-arc.embers.1');
  await hearOut(page);
  expect((await state(page)).world.sky?.edge).toBeUndefined();

  // The steps to the choice flown (the unit tests fly them): at Pyre Observatory, the last berths.
  await api(page, 'completeJobs', ['arc.embers.1', 'arc.embers.2', 'arc.embers.3']);
  await api(page, 'advanceClock', 4 * 3_600);
  expect((await state(page)).world.sky?.edge).toBeUndefined();
  await dockAt(page, OBSERVATORY);
  await hearOut(page);
  await openJobs(page);
  await press(page, 'accept-arc.embers.4');
  await waitUntil(page, 'the choice', async () => {
    if (await page.getByTestId('choice-dialog').isVisible().catch(() => false)) return true;
    const next = page.getByTestId('story-continue');
    if (await next.isVisible().catch(() => false)) await next.click().catch(() => {});
    return false;
  }, 30_000);
  await expect(page.getByTestId('choice-law')).toContainText('Call the Authority');
  await press(page, 'choice-stay');
  await expect(page.getByTestId('story-dialog')).toContainText('Six of us stay and watch');
  await hearOut(page);
  const chose = await state(page);
  expect(chose.world.sky?.edge).toBe(chose.clock + 60);

  // The last six: launched from the observatory as Pyre dies.
  await openJobs(page);
  await press(page, 'accept-arc.embers.5.stay');
  await hearOut(page);
  await press(page, 'dock-launch');
  if (await page.getByTestId('controls-sheet').isVisible().catch(() => false)) await press(page, 'sheet-close');
  await waitUntil(page, 'undocked', async () => (await api<{ autopilot: string } | null>(page, 'player'))?.autopilot === 'none', 60_000);
  const edge = (await state(page)).world.sky!.edge!;
  await api(page, 'advanceClock', edge + 1_500 + 20 - (await state(page)).clock);
  await waitUntil(page, 'the lifeboats away', async () => (await api<Boats | null>(page, 'lifeboats'))?.out === 6, 30_000);
  await expect(page.getByTestId('hud-objective')).toContainText('(0 of 5 aboard)');

  // Five gathered, one by one.
  for (let n = 1; n <= 5; n++) {
    const boat = (await api<{ id: string }[]>(page, 'targets')).find((t) => t.id.startsWith('lifeboat:arc.embers.5.stay#'))!;
    expect(await api<boolean>(page, 'placeNear', { id: boat.id, distance: 80 })).toBe(true);
    await waitUntil(page, `lifeboat ${n} aboard`, async () => (await api<Boats>(page, 'lifeboats')).aboard === n, 20_000);
  }
  expect((await state(page)).jobs['arc.embers.5.stay']?.gathered).toBe(5);
  await expect(page.getByTestId('hud-objective')).toContainText('get clear through the lane');

  // Out through the lane to GJ 915, before the collapse: done, and the Pyre Archive for good.
  if (await isTouch(page)) await press(page, 'hud-map');
  else await page.keyboard.press('Tab');
  await expect(page.getByTestId('galaxy-map')).toBeVisible();
  await press(page, 'map-missions');
  await press(page, 'map-mission-gj-915');
  await expect(page.getByTestId('map-jump')).toBeEnabled();
  await press(page, 'map-jump');
  await waitUntil(page, 'through the lane', async () => (await state(page)).location.systemId === 'gj-915' && (await api(page, 'mode')) === 'flight', 90_000);
  const s = await state(page);
  expect(s.clock).toBeLessThan(edge + 2_700);
  expect(s.jobs['arc.embers.5.stay']).toMatchObject({ status: 'complete', gathered: 5, clear: true });
  expect(Object.keys(s.world.marks ?? {})).toEqual(['embers.stay']);
  await dockAt(page, FREEPORT);
  await hearOut(page);
  await press(page, 'room-bar');
  if (!(await page.getByTestId('news-window').isVisible().catch(() => false))) await press(page, 'station-news');
  await expect(page.getByTestId('mark-embers.stay')).toContainText('The Pyre Archive');
});
