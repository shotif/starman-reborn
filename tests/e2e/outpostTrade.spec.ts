import { expect, test, type Page } from '@playwright/test';
import { api, openFresh, press, waitUntil } from './helpers.ts';

/**
 * Outposts join the trade (docs/PROCGEN.md §38): a refinery chartered in Sol's main belt and its
 * frame built; its Outpost window says who comes next and what the dock fees have paid; hours pass
 * and the haulers' fees come in with the income; the next hauler is seen flying to or from it in
 * flight; a board within reach posts work to it; and the star map's search finds it by name.
 */

type Hooks = { __starman: { completeJobs(ids: string[]): void; dockAt(id: string): void } };
interface TradeState {
  clock: number;
  location: { dockedAt: string | null };
  world: { outposts?: { site: string; name: string; stage: number; fees?: number }[] };
}
interface Haulers {
  next: { id: string; name: string; out: boolean; at: number; depart: number; arrive: number; from: string; to: string; commodity: string; qty: number } | null;
  fees: number;
  earned: number;
  flight: { id: string; name: string; state: string; distance: number }[] | null;
}

const SITE = 'belt.sol-main-belt';
const OUTPOST = `outpost.${SITE}`;
const state = (page: Page) => api<TradeState>(page, 'state');
const haulers = (page: Page) => api<Haulers>(page, 'outpostHaulers');

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
  await page.evaluate((loc) => (window as unknown as Hooks).__starman.dockAt(loc), id);
  await waitUntil(page, `docked at ${id}`, async () => (await state(page)).location.dockedAt === id);
  await hearOut(page);
}

/** Opens a window of a room (the buttons toggle: press only when it is not open already). */
async function openWindow(page: Page, room: string, button: string, content: string): Promise<void> {
  await press(page, room);
  if (!(await page.getByTestId(content).isVisible().catch(() => false))) await press(page, button);
  await expect(page.getByTestId(content)).toBeVisible();
}

test('outposts join the trade: haulers come and go from your refinery and pay dock fees, boards post work to it, and the map finds it', async ({ page }) => {
  await openFresh(page);
  await press(page, 'title-play');
  await press(page, 'intro-ok');
  await page.evaluate(() => (window as unknown as Hooks).__starman.completeJobs(['lifeline']));
  await api(page, 'setCredits', 80_000);

  // A refinery chartered in Sol's main belt from Earth Port, its frame built.
  await dockAt(page, 'earth-port');
  await openWindow(page, 'room-deck', 'station-fleet', 'fleet');
  await press(page, `outpost-charter-${SITE}`);
  const name = await page.getByTestId('outpost-name').inputValue();
  await press(page, 'outpost-charter-confirm');
  await dockAt(page, OUTPOST);
  await api(page, 'setCargo', { 'habitat-modules': 8, metals: 20, machinery: 6 });
  await openWindow(page, 'room-deck', 'station-outpost', 'outpost-window');
  for (const good of ['habitat-modules', 'metals', 'machinery']) await press(page, `outpost-deliver-${good}`);
  await waitUntil(page, 'the outpost open', async () => (await state(page)).world.outposts?.[0]?.stage === 1);

  // Its window: who comes next, and no fees yet.
  await openWindow(page, 'room-deck', 'station-outpost', 'outpost-window');
  await expect(page.getByTestId('outpost-haulers')).toBeVisible();
  await expect(page.getByTestId('outpost-next-hauler')).toContainText(/^(The .+ (sets off|docks) in .+ with \d+ .+|No hauler is due here in the next six hours\.)$/);
  await expect(page.getByTestId('outpost-fees')).toContainText('dock fee of 3% of its cargo’s worth, with the hour’s income: 0 cr so far');

  // Hours pass: the haulers' fees come in with the income.
  for (let i = 0; i < 24 && (await haulers(page)).fees === 0; i++) await api(page, 'advanceClock', 3_600);
  const paid = await haulers(page);
  expect(paid.fees).toBeGreaterThan(0);
  expect(paid.earned).toBeGreaterThan(paid.fees);
  await openWindow(page, 'room-deck', 'station-outpost', 'outpost-window');
  await expect(page.getByTestId('outpost-fees')).toContainText(`${paid.fees.toLocaleString('en-US')} cr so far`);

  // In flight from Earth Port, just before the next hauler's leg in Sol begins: it is seen flying to or from the refinery.
  for (let i = 0; i < 12 && !(await haulers(page)).next; i++) await api(page, 'advanceClock', 3_600);
  const next = (await haulers(page)).next!;
  expect(next).toBeTruthy();
  expect(next.out ? next.from : next.to).toBe(OUTPOST);
  await dockAt(page, 'earth-port');
  // Its leg in Sol: out of the refinery's dock as it sets off, or in from the jump for its last five minutes.
  const legStart = next.out ? next.depart : next.arrive - 300;
  const clock = (await state(page)).clock;
  await api(page, 'advanceClock', Math.max(0, legStart - clock - 20));
  await hearOut(page);
  await press(page, 'dock-launch');
  await waitUntil(page, 'in flight', async () => (await api(page, 'mode')) === 'flight');
  if (await page.getByTestId('controls-sheet').isVisible().catch(() => false)) await press(page, 'sheet-close');
  await waitUntil(
    page,
    'the hauler flying',
    async () => {
      const h = await haulers(page);
      if (h.flight?.some((f) => f.id === next.id)) return true;
      if ((await state(page)).clock < legStart + 5) await api(page, 'advanceClock', 10);
      return false;
    },
    60_000,
  );
  const targets = await api<{ id: string; name: string }[]>(page, 'targets');
  expect(targets.some((t) => t.name === `The ${next.name}`)).toBe(true);

  // Back at Earth Port: within a few time slots its board posts work to the refinery.
  await dockAt(page, 'earth-port');
  let job: { id: string; title: string } | undefined;
  for (let i = 0; i < 30 && !job; i++) {
    job = (await api<{ id: string; title: string }[]>(page, 'board', 'earth-port')).find((c) => c.id.endsWith('.outpost'));
    if (!job) await api(page, 'advanceClock', 1_500);
  }
  expect(job).toBeTruthy();
  expect(job!.title).toContain(name);
  await openWindow(page, 'room-bar', 'station-jobs', 'jobs-window');
  await expect(page.getByTestId(`job-${job!.id}`)).toContainText(name);

  // The star map's search finds it by name.
  await press(page, 'dock-map');
  await expect(page.getByTestId('galaxy-map')).toBeVisible();
  await press(page, 'map-search');
  await page.getByTestId('map-search-input').fill(name.split(' ')[0]!);
  await expect(page.getByTestId('map-search-result-sol')).toContainText(`Your outpost ${name}`);
});
