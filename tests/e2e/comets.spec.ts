import { expect, test, type Page } from '@playwright/test';
import { api, isTouch, openFresh, press, waitUntil } from './helpers.ts';

/**
 * Comets in Sol (docs/PROCGEN.md §45): three weeks before 2P/Encke passes the Sun, Ledger Institute
 * wants it imaged; Earth Port's News tells of it; out in Sol it stands where it really is, its tails
 * streaming away from the Sun, and scanned, its card gives its orbit and when it passes the Sun; Sol's
 * card on the star map lists it; and the images are paid for back at the institute.
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
interface CometView {
  id: string;
  position: [number, number, number];
  tail: number;
  coma: number;
  gasDir: [number, number, number];
}

const DOCK = 'ledger-institute';
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

test('a comet imaged: Encke near the Sun in the News, flown to in Sol with its tails, its card, Sol’s map card, and paid', async ({ page }) => {
  await openFresh(page);
  await press(page, 'title-play');
  await press(page, 'intro-ok');
  await api(page, 'completeJobs', ['lifeline']);
  const touch = await isTouch(page);

  // The game's date: three weeks before Encke passes the Sun; then the first slot the institute wants it imaged.
  expect(await api<boolean>(page, 'startedOn', '2027-01-20T00:00:00Z')).toBe(true);
  const m = (await api<{ start: number; comet: string } | null>(page, 'imageJob', { locationId: DOCK, comet: 'comet-2p' }))!;
  expect(m).toMatchObject({ comet: 'comet-2p' });
  await api(page, 'advanceClock', Math.max(0, m.start + 30 - (await state(page)).clock));
  await dockAt(page, DOCK);

  // At the bar: the imaging, taken on.
  await openWindow(page, 'room-bar', 'station-jobs', 'jobs-window');
  const card = page.locator(`[data-testid^="job-c.${DOCK}."][data-testid$=".comet-2p"]`);
  await expect(card).toContainText('Image 2P/Encke');
  const id = (await card.getAttribute('data-testid'))!.slice('job-'.length);
  const head = card.locator('.job-head');
  if (touch) await head.tap();
  else await head.click();
  await press(page, `accept-${id}`);
  await waitUntil(page, 'the imaging taken', async () => (await state(page)).jobs[id]?.status === 'active', 10_000);
  const reward = (await state(page)).contracts[id]!.reward;

  // At Earth Port, in Sol: the News tells of Encke nearing the Sun.
  await dockAt(page, 'earth-port');
  await openWindow(page, 'room-bar', 'station-news', 'news-window');
  const news = page.getByTestId('news-comet-2p');
  await expect(news).toContainText('2P/Encke nears the Sun');
  await expect(news).toContainText('2P/Encke passes closest to the Sun on 10 February 2027');

  // Out in Sol: Encke where it is, its tails away from the Sun; scanned from near it.
  await press(page, 'dock-launch');
  await waitUntil(page, 'in flight', async () => (await api(page, 'mode')) === 'flight');
  if (await page.getByTestId('controls-sheet').isVisible().catch(() => false)) await press(page, 'sheet-close');
  await waitUntil(page, 'undocked', async () => (await dismissDiscovery(page), (await api<{ autopilot: string } | null>(page, 'player'))?.autopilot === 'none'), 60_000);
  const comets = (await api<CometView[] | null>(page, 'comets'))!;
  expect(comets).toHaveLength(14);
  const encke = comets.find((c) => c.id === 'comet-2p')!;
  expect(encke.tail).toBeGreaterThan(0);
  const len = Math.hypot(...encke.position);
  const dot = encke.position.reduce((s, x, i) => s + (x / len) * encke.gasDir[i]!, 0);
  expect(dot).toBeGreaterThan(0.9999);
  expect(comets.find((c) => c.id === 'comet-1p')!.tail).toBe(0);
  await api(page, 'selectTarget', 'comet:comet-2p');
  expect(await api<boolean>(page, 'placeNear', { id: 'comet:comet-2p', distance: 6_000 })).toBe(true);
  await waitUntil(page, 'Scan offered', async () => (await dismissDiscovery(page), (await api<Hud | null>(page, 'hud'))?.context?.label === 'Scan'), 30_000);
  await press(page, touch ? 'touch-context' : 'hud-context');
  const sci = page.getByTestId('science-comet');
  await expect(sci).toContainText('2P/Encke comes round once every 3.30 years.');
  await expect(sci).toContainText('Encke-type comet');
  await expect(sci).toContainText('Next at the Sun');
  await expect(sci).toContainText('10 February 2027');
  await expect(sci).toContainText('AU from Earth');
  await expect(sci).toContainText('In flight it is drawn far larger than life');
  await waitUntil(page, 'the images taken', async () => (await state(page)).jobs[id]?.objectiveIndex === 1, 30_000);
  await press(page, 'sheet-close');

  // Sol's card on the star map lists its comets.
  if (touch) await press(page, 'hud-map');
  else await page.keyboard.press('Tab');
  await expect(page.getByTestId('galaxy-map')).toBeVisible();
  await press(page, 'map-system-sol');
  await expect(page.getByTestId('comet-2p')).toContainText('2P/Encke');
  await expect(page.getByTestId('comet-2p')).toContainText('Next at the Sun');
  await press(page, 'map-close');

  // Back at the institute: paid in full.
  const before = (await state(page)).credits;
  await dockAt(page, DOCK);
  await waitUntil(page, 'the job complete', async () => (await state(page)).jobs[id]?.status === 'complete');
  expect((await state(page)).credits - before).toBe(reward);
});
