import { expect, test, type Page } from '@playwright/test';
import { api, isTouch, openFresh, press, waitUntil } from './helpers.ts';

/**
 * Stellar death II, a doomed star at the edge (docs/PROCGEN.md §26): Pyre, the one invented star.
 * Its neutrino alarm in the News at its observatory, marked as fiction; its last observers taken
 * aboard; the ship still in its system when it explodes, carried out to GJ 915 Freeport (said to be
 * fiction), where the observers are paid for; the light reaching GJ 915 in its News; then, once the
 * lane is open again, its black hole read for an institute near it, from outside its tides, which
 * strain the hull of a ship that goes inside them.
 */

interface State {
  credits: number;
  clock: number;
  jobs: Record<string, { status: string; objectiveIndex: number } | undefined>;
  contracts: Record<string, { reward: number; contract?: { party?: string[] } } | undefined>;
  location: { systemId: string; dockedAt: string | null };
}

interface Pyre {
  edge: number;
  timeline: { warning: number; collapse: number; breakout: number; laneOpens: number; stationOpens: number };
  stage: string;
  refuge: string;
  holeId: string;
}

interface Hud {
  context: { label: string } | null;
}

const OBSERVATORY = 'pyre-observatory';
/** An institute near Pyre's anchor, which wants its black hole read. */
const INSTITUTE = 'gj-884-institute';

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
  await waitUntil(page, `docked at ${id}`, async () => (await api<State>(page, 'state')).location.dockedAt === id);
  await hearOut(page);
}

/** Closes a discovery card if one is up (it pauses the flight); the top one first, never waiting on a covered one. */
async function dismissDiscovery(page: Page): Promise<void> {
  const ok = page.getByTestId('discovery-ok').last();
  if (await ok.isVisible().catch(() => false)) await ok.click({ timeout: 2_000 }).catch(() => {});
}

async function openWindow(page: Page, room: string, action: string, windowId: string): Promise<void> {
  await press(page, room);
  if (!(await page.getByTestId(windowId).isVisible().catch(() => false))) await press(page, action);
  await expect(page.getByTestId(windowId)).toBeVisible();
}

async function take(page: Page, touch: boolean, at: string, kind: string, title: string): Promise<string> {
  await openWindow(page, 'room-bar', 'station-jobs', 'jobs-window');
  const card = page.locator(`[data-testid^="job-c.${at}."][data-testid$=".pyre-${kind}"]`);
  await expect(card).toContainText(title);
  const id = (await card.getAttribute('data-testid'))!.slice('job-'.length);
  const head = card.locator('.job-head');
  if (touch) await head.tap();
  else await head.click();
  await press(page, `accept-${id}`);
  await waitUntil(page, `${kind} taken`, async () => (await api<State>(page, 'state')).jobs[id]?.status === 'active', 10_000);
  return id;
}

async function launch(page: Page): Promise<void> {
  await press(page, 'dock-launch');
  await waitUntil(page, 'in flight', async () => (await api(page, 'mode')) === 'flight');
  if (await page.getByTestId('controls-sheet').isVisible().catch(() => false)) await press(page, 'sheet-close');
  await waitUntil(page, 'undocked', async () => (await dismissDiscovery(page), (await api<{ autopilot: string } | null>(page, 'player'))?.autopilot === 'none'), 60_000);
}

test('Pyre: its alarm, its observers carried out as it explodes, and its black hole read', async ({ page }) => {
  await openFresh(page);
  await press(page, 'title-play');
  await press(page, 'intro-ok');
  await api(page, 'completeJobs', ['lifeline']);
  const touch = await isTouch(page);

  // In this save the far stars' story is long over by Pyre's alarm, which comes now. A cabin for the observers.
  await api(page, 'skyFrom', 0);
  const sky = (await api<{ timeline: { bhGone: number } }>(page, 'sky'))!;
  await api(page, 'edgeAt', sky.timeline.bhGone + 600);
  const pyre = (await api<Pyre>(page, 'pyre'))!;
  let s = await api<State>(page, 'state');
  await api(page, 'advanceClock', pyre.timeline.warning + 60 - s.clock);
  expect(await api(page, 'fit', 'gear.cabin.2.halden')).toBe(true);
  await dockAt(page, OBSERVATORY);

  // The News tells of the alarm, as fiction, about a star that does not exist.
  await openWindow(page, 'room-bar', 'station-news', 'news-window');
  const news = page.getByTestId('edge-news');
  await expect(news).toContainText('Neutrino alarm at Pyre');
  await expect(news).toContainText('Fiction: there is no star called Pyre.');

  // The observatory's last observers want carrying out: take them on.
  const evacuate = await take(page, touch, OBSERVATORY, 'evacuate', 'Out of Pyre’s reach');
  s = await api<State>(page, 'state');
  const fare = s.contracts[evacuate]!.reward;
  expect(s.contracts[evacuate]!.contract?.party?.length).toBeGreaterThanOrEqual(2);

  // Out in its system: Pyre itself, marked as invented.
  await launch(page);
  await api(page, 'selectTarget', 'star:pyre');
  const panel = page.getByTestId('hud-target');
  await expect(panel).toContainText('Pyre');
  await expect(panel).toContainText('Invented red supergiant');
  await expect(panel).toContainText('Fiction');

  // Still there when it explodes: the ship is carried out to GJ 915 Freeport, observers and all.
  s = await api<State>(page, 'state');
  await api(page, 'advanceClock', pyre.timeline.breakout + 2 - s.clock);
  const rescue = page.getByTestId('pyre-rescue-dialog');
  await expect(rescue).toBeVisible();
  await expect(rescue).toContainText('GJ 915 Freeport');
  await expect(rescue).toContainText('Fiction');
  const before = (await api<State>(page, 'state')).credits;
  await press(page, 'pyre-rescue-ok');
  await waitUntil(page, 'carried out', async () => (await api<State>(page, 'state')).location.dockedAt === pyre.refuge);
  await hearOut(page);
  s = await api<State>(page, 'state');
  expect(s.jobs[evacuate]?.status).toBe('complete');
  // Paid the fare, less the emergency repairs.
  expect(s.credits - before).toBeGreaterThanOrEqual(fare - 150);
  expect(s.credits - before).toBeLessThanOrEqual(fare);

  // Its light reaches GJ 915 a little later: the News says so.
  await api(page, 'advanceClock', pyre.timeline.breakout + 600 - s.clock);
  await openWindow(page, 'room-bar', 'station-news', 'news-window');
  await expect(page.getByTestId('edge-news')).toContainText('The light of Pyre reaches GJ 915');

  // Once the lane is open again, an institute near it wants its black hole read.
  s = await api<State>(page, 'state');
  await api(page, 'advanceClock', pyre.timeline.laneOpens + 60 - s.clock);
  await dockAt(page, INSTITUTE);
  const hole = await take(page, touch, INSTITUTE, 'hole', 'Read the black hole');
  const reward = (await api<State>(page, 'state')).contracts[hole]!.reward;

  // At Pyre: no star, a black hole, marked as invented.
  await api(page, 'warp', 'pyre');
  await waitUntil(page, 'at Pyre', async () => (await api(page, 'mode')) === 'flight');
  if (await page.getByTestId('controls-sheet').isVisible().catch(() => false)) await press(page, 'sheet-close');
  const holeTarget = `hole:${pyre.holeId}`;
  await api(page, 'selectTarget', holeTarget);
  await expect(panel).toContainText('black hole');
  await expect(panel).toContainText('Invented black hole');

  // Inside its tides the hull strains; the pilot turns back.
  const hull = (await api<{ hullValue: number } | null>(page, 'hud'))!.hullValue;
  await api(page, 'placeNear', { id: holeTarget, distance: 17_000 });
  await expect(page.locator('.toast', { hasText: 'Tidal zone' })).toBeVisible();
  await waitUntil(page, 'hull strained', async () => ((await api<{ hullValue: number } | null>(page, 'hud'))?.hullValue ?? hull) < hull, 30_000);
  await api(page, 'placeNear', { id: holeTarget, distance: 26_000 });

  // Read from outside its tides with the action button.
  await waitUntil(page, 'Scan offered', async () => (await api<Hud | null>(page, 'hud'))?.context?.label === 'Scan', 30_000);
  await press(page, touch ? 'touch-context' : 'hud-context');
  await expect(page.getByTestId('pyre-hole-card')).toBeVisible();
  await expect(page.getByTestId('pyre-hole-card')).toContainText('Event horizon');
  await expect(page.getByTestId('pyre-hole-card')).toContainText('Fiction: there is no star called Pyre.');
  await waitUntil(page, 'the reading taken', async () => (await api<State>(page, 'state')).jobs[hole]?.objectiveIndex === 1, 30_000);
  await press(page, 'sheet-close');

  // Back at the institute: paid in full.
  const paidFrom = (await api<State>(page, 'state')).credits;
  await dockAt(page, INSTITUTE);
  await waitUntil(page, 'the job complete', async () => (await api<State>(page, 'state')).jobs[hole]?.status === 'complete');
  expect((await api<State>(page, 'state')).credits - paidFrom).toBe(reward);
});
