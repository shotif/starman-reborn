import { expect, test, type Page } from '@playwright/test';
import { api, isTouch, openFresh, press, waitUntil } from './helpers.ts';

/**
 * Stellar death, as fiction (docs/PROCGEN.md §25): Betelgeuse's neutrino alert in the News, a job
 * at Ledger Institute's bar to catch its first light, the supernova picked out in flight (a real
 * star, its death marked as fiction), observed with the action button, and the readings brought
 * back to the institute and paid for.
 */

interface SkyState {
  credits: number;
  clock: number;
  jobs: Record<string, { status: string; objectiveIndex: number } | undefined>;
  contracts: Record<string, { reward: number } | undefined>;
  location: { dockedAt: string | null };
}

interface Sky {
  from: number;
  timeline: { alert: number; light: number; peak: number; peakEnd: number; fadeEnd: number };
  betelgeuse: { magnitude: number };
}

interface Hud {
  context: { label: string; action: string } | null;
}

const DOCK = 'ledger-institute';

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
  await waitUntil(page, `docked at ${id}`, async () => (await api<SkyState>(page, 'state')).location.dockedAt === id);
  await hearOut(page);
}

/** Closes a discovery card if one is up (it pauses the flight): the top one, never waiting on a covered one. */
async function dismissDiscovery(page: Page): Promise<void> {
  const ok = page.getByTestId('discovery-ok').last();
  if (await ok.isVisible().catch(() => false)) await ok.click({ timeout: 2_000 }).catch(() => {});
}

async function openWindow(page: Page, room: string, action: string, windowId: string): Promise<void> {
  await press(page, room);
  if (!(await page.getByTestId(windowId).isVisible().catch(() => false))) await press(page, action);
  await expect(page.getByTestId(windowId)).toBeVisible();
}

test('a supernova: the alert in the News, a job to catch its first light, Betelgeuse observed in flight, and paid at the institute', async ({ page }) => {
  await openFresh(page);
  await press(page, 'title-play');
  await press(page, 'intro-ok');
  await api(page, 'completeJobs', ['lifeline']);
  const touch = await isTouch(page);

  // In this save the neutrino alert comes a minute from now; two minutes on, dock at Ledger Institute.
  const start = await api<SkyState>(page, 'state');
  await api(page, 'skyFrom', start.clock + 60);
  const sky = (await api<Sky>(page, 'sky'))!;
  await api(page, 'advanceClock', 120);
  await dockAt(page, DOCK);

  // The News tells of the burst, and says the event is fiction.
  await openWindow(page, 'room-bar', 'station-news', 'news-window');
  const news = page.getByTestId('sky-news');
  await expect(news).toContainText('Neutrino burst from Betelgeuse');
  await expect(news).toContainText('Fiction');
  await expect(news).toContainText('has not exploded');

  // At the bar the institute wants the first light watched: take the job on.
  await openWindow(page, 'room-bar', 'station-jobs', 'jobs-window');
  const card = page.locator(`[data-testid^="job-c.${DOCK}."][data-testid$=".sky-first"]`);
  await expect(card).toContainText('Catch the first light of Betelgeuse');
  const id = (await card.getAttribute('data-testid'))!.slice('job-'.length);
  const head = card.locator('.job-head');
  if (touch) await head.tap();
  else await head.click();
  await press(page, `accept-${id}`);
  let s = await api<SkyState>(page, 'state');
  expect(s.jobs[id]?.status).toBe('active');
  const reward = s.contracts[id]!.reward;

  // Its light comes; out into open space, where the stations say so.
  await api(page, 'advanceClock', sky.timeline.light + 30 - s.clock);
  await press(page, 'dock-launch');
  await waitUntil(page, 'in flight', async () => (await api(page, 'mode')) === 'flight');
  if (await page.getByTestId('controls-sheet').isVisible().catch(() => false)) await press(page, 'sheet-close');
  await waitUntil(page, 'undocked', async () => (await dismissDiscovery(page), (await api<{ autopilot: string } | null>(page, 'player'))?.autopilot === 'none'), 60_000);
  // What the radio said (its toast may have come and gone while the ship undocked).
  await waitUntil(page, 'the stations say so', async () => (await api<string[]>(page, 'comms')).some((t) => t.includes('Betelgeuse has exploded')), 30_000);

  // Betelgeuse is a target: a real star 498 light-years away, its supernova marked as fiction.
  await api(page, 'selectTarget', 'sky:betelgeuse');
  const panel = page.getByTestId('hud-target');
  await expect(panel).toContainText('Betelgeuse');
  await expect(panel).toContainText('Fiction');
  await expect(panel).toContainText('Supernova · magnitude −');
  await expect(panel).toContainText('498 ly');

  // Observe it with the action button.
  await waitUntil(page, 'Observe offered', async () => (await api<Hud | null>(page, 'hud'))?.context?.label === 'Observe', 30_000);
  await expect(page.getByTestId(touch ? 'touch-context' : 'hud-context')).toContainText('Observe');
  await press(page, touch ? 'touch-context' : 'hud-context');
  await waitUntil(page, 'the reading taken', async () => (await api<SkyState>(page, 'state')).jobs[id]?.objectiveIndex === 1, 30_000);
  await expect(page.locator('.toast', { hasText: 'readings recorded' })).toBeVisible();

  // Back to the institute with the readings: paid in full.
  const before = (await api<SkyState>(page, 'state')).credits;
  await dockAt(page, DOCK);
  await waitUntil(page, 'the job complete', async () => (await api<SkyState>(page, 'state')).jobs[id]?.status === 'complete');
  s = await api<SkyState>(page, 'state');
  expect(s.credits - before).toBe(reward);
});
