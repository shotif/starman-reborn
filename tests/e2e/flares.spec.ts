import { expect, test, type Page } from '@playwright/test';
import { api, isTouch, openFresh, press, waitUntil } from './helpers.ts';

/**
 * Flare stars (docs/PROCGEN.md §43): Wolf 359 flares. The News at Ledger Institute, in its system,
 * tells of it (the star real, its flaring fiction) and the institute posts flare watch; out in the
 * system the radio and the HUD say so, shields and scanners are cut and the star glows; scanned while
 * it flares, its card gives its variable-star name; the star map says so too; when it settles the
 * radio says that; and the readings are paid for at the institute.
 */

interface State {
  credits: number;
  clock: number;
  jobs: Record<string, { status: string; objectiveIndex: number } | undefined>;
  contracts: Record<string, { reward: number } | undefined>;
  location: { dockedAt: string | null };
}
interface Flare {
  id: string;
  star: string;
  kind: string;
  start: number;
  end: number;
}
interface FlightFlare {
  id: string;
  kind: string;
  shields: number;
  scanner: number;
  glow: number;
  subtitle: string;
}
interface Hud {
  context: { label: string } | null;
  flare: string | null;
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

/** Closes a discovery card if one is up (it pauses the flight). */
async function dismissDiscovery(page: Page): Promise<void> {
  const ok = page.getByTestId('discovery-ok').last();
  if (await ok.isVisible().catch(() => false)) await ok.click({ timeout: 2_000 }).catch(() => {});
}

async function openWindow(page: Page, room: string, action: string, windowId: string): Promise<void> {
  await press(page, room);
  if (!(await page.getByTestId(windowId).isVisible().catch(() => false))) await press(page, action);
  await expect(page.getByTestId(windowId)).toBeVisible();
}

test('a flare on Wolf 359: told in the News, flare watch taken, felt in its system, the star scanned while it flares, and paid', async ({ page }) => {
  await openFresh(page);
  await press(page, 'title-play');
  await press(page, 'intro-ok');
  await api(page, 'completeJobs', ['lifeline']);
  const touch = await isTouch(page);

  // Wolf 359's next strong flare; two minutes into it, dock at Ledger Institute, in its system.
  const f = (await api<Flare | null>(page, 'nextFlare', { systemId: 'wolf-359', kind: 'strong' }))!;
  expect(f).not.toBeNull();
  await api(page, 'advanceClock', f.start + 120 - (await state(page)).clock);
  await dockAt(page, DOCK);

  // The News tells of it: the star real, its flaring the game's.
  await openWindow(page, 'room-bar', 'station-news', 'news-window');
  const news = page.getByTestId(`news-${f.id}`);
  await expect(news).toContainText('Strong flare on Wolf 359');
  await expect(news).toContainText('shields in Wolf 359 recharge at 45%');
  await expect(news).toContainText('Fiction: when Wolf 359 flares, and what it does to ships, is the game’s.');
  await expect(news).toContainText('the variable star CN Leo');

  // The institute wants it watched: take the job on.
  await openWindow(page, 'room-bar', 'station-jobs', 'jobs-window');
  const card = page.locator(`[data-testid^="job-c.${DOCK}."][data-testid*=".flare-wolf-359-"]`);
  await expect(card).toContainText('Flare watch: Wolf 359');
  const id = (await card.getAttribute('data-testid'))!.slice('job-'.length);
  const head = card.locator('.job-head');
  if (touch) await head.tap();
  else await head.click();
  await press(page, `accept-${id}`);
  await waitUntil(page, 'flare watch taken', async () => (await state(page)).jobs[id]?.status === 'active', 10_000);
  const reward = (await state(page)).contracts[id]!.reward;

  // Out into the system: the radio and the HUD say so; shields and scanners are cut; the star glows.
  await press(page, 'dock-launch');
  await waitUntil(page, 'in flight', async () => (await api(page, 'mode')) === 'flight');
  if (await page.getByTestId('controls-sheet').isVisible().catch(() => false)) await press(page, 'sheet-close');
  await waitUntil(page, 'undocked', async () => (await dismissDiscovery(page), (await api<{ autopilot: string } | null>(page, 'player'))?.autopilot === 'none'), 60_000);
  await waitUntil(page, 'the radio says so', async () => (await api<string[]>(page, 'comms')).some((t) => t.includes('Wolf 359 is flaring: shields recharge at 45%')), 30_000);
  const fx = (await api<FlightFlare | null>(page, 'flare'))!;
  expect(fx).toMatchObject({ id: f.id, kind: 'strong', shields: 0.45, scanner: 0.6, subtitle: 'Flare star · flaring now' });
  expect(fx.glow).toBeGreaterThan(0);
  await expect(page.getByTestId('hud-flare')).toContainText('Strong flare on Wolf 359 · shields 45% · scanners 60%');

  // The star says so too; scanned while it flares, from within the cut reach, its card names it.
  await api(page, 'selectTarget', 'star:wolf-359');
  await expect(page.getByTestId('hud-target')).toContainText('Flare star · flaring now');
  expect(await api<boolean>(page, 'placeNear', { id: 'star:wolf-359', distance: 10_000 })).toBe(true);
  await waitUntil(page, 'Scan offered', async () => (await api<Hud | null>(page, 'hud'))?.context?.label === 'Scan', 30_000);
  await press(page, touch ? 'touch-context' : 'hud-context');
  await expect(page.getByTestId('science-variable')).toHaveText('CN Leo');
  await expect(page.getByTestId('science-flare-star')).toContainText('Wolf 359 is a flare star');
  await expect(page.getByTestId('science-flaring')).toContainText('It is flaring now: a strong flare');
  await waitUntil(page, 'the reading taken', async () => (await state(page)).jobs[id]?.objectiveIndex === 1, 30_000);
  await press(page, 'sheet-close');

  // The star map's card: a flare star, flaring now.
  if (touch) await press(page, 'hud-map');
  else await page.keyboard.press('Tab');
  await expect(page.getByTestId('galaxy-map')).toBeVisible();
  await press(page, 'map-system-wolf-359');
  await expect(page.getByTestId('gmap-flare-star')).toHaveText('Flare star: Wolf 359 (CN Leo)');
  await expect(page.getByTestId('gmap-flare')).toContainText('Strong flare under way');
  await press(page, 'map-close');

  // It settles: the radio says so, and the HUD line goes.
  await api(page, 'advanceClock', f.end + 5 - (await state(page)).clock);
  await waitUntil(page, 'settled', async () => (await api<string[]>(page, 'comms')).some((t) => t.includes('Wolf 359 has settled')), 30_000);
  await expect(page.getByTestId('hud-flare')).toBeHidden();
  expect(await api(page, 'flare')).toBeNull();

  // Back at the institute with the readings: paid in full.
  const before = (await state(page)).credits;
  await dockAt(page, DOCK);
  await waitUntil(page, 'the job complete', async () => (await state(page)).jobs[id]?.status === 'complete');
  expect((await state(page)).credits - before).toBe(reward);
});
