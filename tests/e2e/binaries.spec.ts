import { expect, test, type Page } from '@playwright/test';
import { api, isTouch, openFresh, press, waitUntil } from './helpers.ts';

/**
 * Binary orbits (docs/PROCGEN.md §44): at Dawnfield Institute, which orbits Procyon B, the board
 * wants the pair measured; out in flight Procyon B stands where its catalogued orbit had it, and
 * scanned, its card gives the orbit and where the pair stands on the game's date; the star map's card
 * says so too; and the reading is paid for back at the institute.
 */

interface State {
  credits: number;
  clock: number;
  jobs: Record<string, { status: string; objectiveIndex: number } | undefined>;
  contracts: Record<string, { reward: number } | undefined>;
  location: { dockedAt: string | null; systemId: string };
}
interface Hud {
  context: { label: string } | null;
}

const DOCK = 'dawnfield-institute';
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
  await hearOut(page);
}

async function dismissDiscovery(page: Page): Promise<void> {
  const ok = page.getByTestId('discovery-ok').last();
  if (await ok.isVisible().catch(() => false)) await ok.click({ timeout: 2_000 }).catch(() => {});
}

async function openWindow(page: Page, room: string, action: string, windowId: string): Promise<void> {
  await press(page, room);
  if (!(await page.getByTestId(windowId).isVisible().catch(() => false))) await press(page, action);
  await expect(page.getByTestId(windowId)).toBeVisible();
}

test('a pair measured: Procyon B where its orbit had it, its card with the orbit, the star map’s card, and paid', async ({ page }) => {
  await openFresh(page);
  await press(page, 'title-play');
  await press(page, 'intro-ok');
  await api(page, 'completeJobs', ['lifeline']);
  const touch = await isTouch(page);

  // The first time slot in which the institute wants the pair measured.
  const m = (await api<{ start: number; secondary: string; systemId: string } | null>(page, 'measureJob', { locationId: DOCK, secondary: 'procyon-b' }))!;
  expect(m).toMatchObject({ secondary: 'procyon-b', systemId: 'procyon' });
  await api(page, 'advanceClock', Math.max(0, m.start + 30 - (await state(page)).clock));
  await dockAt(page, DOCK);

  // At the bar: the measurement, taken on.
  await openWindow(page, 'room-bar', 'station-jobs', 'jobs-window');
  const card = page.locator(`[data-testid^="job-c.${DOCK}."][data-testid$=".pair-procyon-b"]`);
  await expect(card).toContainText('Measure Procyon B');
  const id = (await card.getAttribute('data-testid'))!.slice('job-'.length);
  const head = card.locator('.job-head');
  if (touch) await head.tap();
  else await head.click();
  await press(page, `accept-${id}`);
  await waitUntil(page, 'the measurement taken', async () => (await state(page)).jobs[id]?.status === 'active', 10_000);
  const reward = (await state(page)).contracts[id]!.reward;

  // Out in flight: Procyon B, scanned from near it.
  await press(page, 'dock-launch');
  await waitUntil(page, 'in flight', async () => (await api(page, 'mode')) === 'flight');
  if (await page.getByTestId('controls-sheet').isVisible().catch(() => false)) await press(page, 'sheet-close');
  await waitUntil(page, 'undocked', async () => (await dismissDiscovery(page), (await api<{ autopilot: string } | null>(page, 'player'))?.autopilot === 'none'), 60_000);
  await api(page, 'selectTarget', 'star:procyon-b');
  expect(await api<boolean>(page, 'placeNear', { id: 'star:procyon-b', distance: 6_000 })).toBe(true);
  await waitUntil(page, 'Scan offered', async () => (await dismissDiscovery(page), (await api<Hud | null>(page, 'hud'))?.context?.label === 'Scan'), 30_000);
  await press(page, touch ? 'touch-context' : 'hud-context');
  const orbit = page.getByTestId('science-orbit');
  await expect(orbit).toContainText('Procyon B orbits Procyon A once every 40.8 years.');
  await expect(orbit).toContainText('Eccentricity');
  await expect(orbit).toContainText(/On \d{1,2} \w+ \d{4}/);
  await expect(orbit).toContainText('apart on the sky at position angle');
  await expect(orbit).toContainText('In flight the pair stands as it did on 6 October 2026');
  await waitUntil(page, 'the reading taken', async () => (await state(page)).jobs[id]?.objectiveIndex === 1, 30_000);
  await press(page, 'sheet-close');

  // The star map's card gives the orbit too.
  if (touch) await press(page, 'hud-map');
  else await page.keyboard.press('Tab');
  await expect(page.getByTestId('galaxy-map')).toBeVisible();
  await press(page, 'map-system-procyon');
  await expect(page.getByTestId('orbit-procyon-b')).toContainText('Procyon B orbits Procyon A once every 40.8 years.');
  await press(page, 'map-close');

  // Back at the institute: paid in full.
  const before = (await state(page)).credits;
  await dockAt(page, DOCK);
  await waitUntil(page, 'the job complete', async () => (await state(page)).jobs[id]?.status === 'complete');
  expect((await state(page)).credits - before).toBe(reward);
});
