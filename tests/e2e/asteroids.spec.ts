import { expect, test, type Page } from '@playwright/test';
import { api, isTouch, openFresh, press, waitUntil } from './helpers.ts';

/**
 * Named asteroids in Sol (docs/PROCGEN.md §47): three weeks before Apophis passes Earth, Ledger
 * Institute wants it tracked; Earth Port's News tells of the pass; out in Sol the asteroids stand where
 * they really are, and Apophis scanned, its card gives its orbit, its pass and the orbit the pass will
 * leave it on; Sol's card on the star map lists it; the positions are paid for back at the institute;
 * and at the pass, Apophis is drawn by Earth, nearer than the Moon.
 */

interface State {
  credits: number;
  clock: number;
  createdAt: string;
  jobs: Record<string, { status: string; objectiveIndex: number } | undefined>;
  contracts: Record<string, { reward: number } | undefined>;
  location: { dockedAt: string | null; systemId: string };
  logbook?: { asteroids?: string[] };
}
interface Hud {
  context: { label: string } | null;
}
interface AsteroidView {
  id: string;
  position: [number, number, number];
  radius: number;
  near: boolean;
}

const DOCK = 'ledger-institute';
const APOPHIS = 'asteroid-99942';
/** JPL's time of the pass: 13 April 2029, 21:46 TDB (as a Julian date). */
const PASS_JD = 2_462_240.407091969;
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

async function launch(page: Page): Promise<void> {
  await press(page, 'dock-launch');
  await waitUntil(page, 'in flight', async () => (await api(page, 'mode')) === 'flight');
  if (await page.getByTestId('controls-sheet').isVisible().catch(() => false)) await press(page, 'sheet-close');
  await waitUntil(page, 'undocked', async () => (await dismissDiscovery(page), (await api<{ autopilot: string } | null>(page, 'player'))?.autopilot === 'none'), 60_000);
}

test('an asteroid tracked: Apophis’s pass in the News, flown to in Sol, its card, Sol’s map card, paid, and the pass itself', async ({ page }) => {
  await openFresh(page);
  await press(page, 'title-play');
  await press(page, 'intro-ok');
  await api(page, 'completeJobs', ['lifeline']);
  const touch = await isTouch(page);

  // The game's date: three weeks before Apophis passes Earth; then the first slot the institute wants it tracked.
  expect(await api<boolean>(page, 'startedOn', '2029-03-20T00:00:00Z')).toBe(true);
  const m = (await api<{ start: number; asteroid: string; pass: boolean } | null>(page, 'trackJob', { locationId: DOCK }))!;
  expect(m).toMatchObject({ asteroid: APOPHIS, pass: true });
  await api(page, 'advanceClock', Math.max(0, m.start + 30 - (await state(page)).clock));
  await dockAt(page, DOCK);

  // At the bar: the tracking, taken on.
  await openWindow(page, 'room-bar', 'station-jobs', 'jobs-window');
  const card = page.locator(`[data-testid^="job-c.${DOCK}."][data-testid$=".asteroid-99942"]`);
  await expect(card).toContainText('Track Apophis');
  const id = (await card.getAttribute('data-testid'))!.slice('job-'.length);
  const head = card.locator('.job-head');
  if (touch) await head.tap();
  else await head.click();
  await expect(card).toContainText('passes Earth on 13 April 2029');
  await press(page, `accept-${id}`);
  await waitUntil(page, 'the tracking taken', async () => (await state(page)).jobs[id]?.status === 'active', 10_000);
  const reward = (await state(page)).contracts[id]!.reward;

  // At Earth Port, in Sol: the News tells of the pass.
  await dockAt(page, 'earth-port');
  await openWindow(page, 'room-bar', 'station-news', 'news-window');
  const news = page.getByTestId(`news-${APOPHIS}`);
  await expect(news).toContainText('Apophis passes Earth');
  await expect(news).toContainText('Apophis passes 38,000 km from Earth’s centre on 13 April 2029, at 7.4 km/s.');

  // Out in Sol: fifteen asteroids where they are; Apophis, weeks from its pass, still out among the planets.
  await launch(page);
  const asteroids = (await api<AsteroidView[] | null>(page, 'asteroids'))!;
  expect(asteroids).toHaveLength(15);
  expect(asteroids.find((a) => a.id === APOPHIS)!.near).toBe(false);
  await api(page, 'selectTarget', `asteroid:${APOPHIS}`);
  // Beyond it from Earth Port, so the dock's own offer does not come first.
  expect(await api<boolean>(page, 'placeNear', { id: `asteroid:${APOPHIS}`, distance: 3_000, awayFrom: 'station:earth-port' })).toBe(true);
  await waitUntil(page, 'Scan offered', async () => (await dismissDiscovery(page), (await api<Hud | null>(page, 'hud'))?.context?.label === 'Scan'), 30_000);
  await press(page, touch ? 'touch-context' : 'hud-context');
  const sci = page.getByTestId('science-asteroid');
  await expect(sci).toContainText('Apophis goes round the Sun once every 0.89 years.');
  await expect(sci).toContainText('Aten asteroid');
  await expect(sci).toContainText('About 340 m across');
  await expect(sci).toContainText('Next close pass of Earth');
  await expect(sci).toContainText('13 April 2029: 38,000 km from Earth’s centre, at 7.4 km/s');
  await expect(sci.getByTestId('asteroid-change')).toContainText('from then on it will be an Apollo asteroid');
  await expect(sci.getByTestId('asteroid-hazardous')).toContainText('not that it will hit');
  await expect(sci).toContainText('In flight it is drawn far larger than life');
  await waitUntil(page, 'the positions taken', async () => (await state(page)).jobs[id]?.objectiveIndex === 1, 30_000);
  expect((await state(page)).logbook?.asteroids).toEqual([APOPHIS]);
  await press(page, 'sheet-close');

  // Sol's card on the star map lists its asteroids.
  if (touch) await press(page, 'hud-map');
  else await page.keyboard.press('Tab');
  await expect(page.getByTestId('galaxy-map')).toBeVisible();
  await press(page, 'map-system-sol');
  await expect(page.getByTestId('asteroid-99942')).toContainText('99942 Apophis');
  await expect(page.getByTestId('asteroid-99942')).toContainText('Next close pass of Earth');
  await expect(page.getByTestId('asteroid-4')).toContainText('4 Vesta');
  await press(page, 'map-close');

  // Back at the institute: paid in full.
  const before = (await state(page)).credits;
  await dockAt(page, DOCK);
  await waitUntil(page, 'the job complete', async () => (await state(page)).jobs[id]?.status === 'complete');
  expect((await state(page)).credits - before).toBe(reward);

  // The pass itself: minutes before its nearest, out from Earth Port, Apophis is by Earth, nearer than the Moon.
  const s = await state(page);
  const passAt = (PASS_JD - 2_440_587.5) * 86_400 - Date.parse(s.createdAt) / 1_000;
  await api(page, 'advanceClock', Math.max(0, passAt - 300 - s.clock));
  await dockAt(page, 'earth-port');
  await launch(page);
  const now = (await api<AsteroidView[] | null>(page, 'asteroids'))!;
  const apophis = now.find((a) => a.id === APOPHIS)!;
  expect(apophis.near).toBe(true);
  const planets = (await api<{ id: string; position: [number, number, number] }[] | null>(page, 'planets'))!;
  const at = (pid: string) => planets.find((p) => p.id === pid)!.position;
  const dist = (a: [number, number, number], b: [number, number, number]) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  expect(dist(apophis.position, at('earth'))).toBeLessThan(dist(at('moon'), at('earth')));
});
