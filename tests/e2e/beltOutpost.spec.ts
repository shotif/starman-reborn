import { expect, test, type Page } from '@playwright/test';
import { api, openFresh, press, waitUntil } from './helpers.ts';

/**
 * Outposts in the belts (docs/PROCGEN.md §36): a refinery chartered in Sol's main belt from Earth
 * Port, its frame built, the ore in the hold refined there (paid above any market, so much an
 * hour), the refinery a station to fly back to in flight, and the outpost sold back for half of what
 * went in, the pilot riding out to the nearest dock and the journal keeping it. (Its haulers and
 * their dock fees are tests/e2e/outpostTrade.spec.ts's.)
 */

type Hooks = { __starman: { completeJobs(ids: string[]): void; dockAt(id: string): void } };
interface BeltState {
  credits: number;
  location: { dockedAt: string | null };
  world: { outposts?: { site: string; name: string; stage: number; refined?: { hour: number; units: number } }[]; outpostsFormer?: { site: string; how: string; paid: number }[] };
}

const SITE = 'belt.sol-main-belt';
const OUTPOST = `outpost.${SITE}`;

/** Clicks through whatever is said, until nothing more comes for a second. */
async function hearOut(page: Page): Promise<void> {
  const next = page.getByTestId('story-continue');
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
  await waitUntil(page, `docked at ${id}`, async () => (await api<BeltState>(page, 'state')).location.dockedAt === id);
  await hearOut(page);
}

/** Opens a deck window (the buttons toggle: press only when it is not open already). */
async function openDeckWindow(page: Page, button: string, content: string): Promise<void> {
  await press(page, 'room-deck');
  if (!(await page.getByTestId(content).isVisible().catch(() => false))) await press(page, button);
  await expect(page.getByTestId(content)).toBeVisible();
}

test('an outpost in the belts: a refinery in Sol’s main belt, refining the ore you bring, sold back', async ({ page }) => {
  await openFresh(page);
  await press(page, 'title-play');
  await press(page, 'intro-ok');
  await page.evaluate(() => (window as unknown as Hooks).__starman.completeJobs(['lifeline']));
  await api(page, 'setCredits', 80_000);

  // At Earth Port, the Fleet window offers Sol's two belts: charter the main belt's refinery.
  await dockAt(page, 'earth-port');
  await openDeckWindow(page, 'station-fleet', 'fleet');
  await expect(page.getByTestId(`outpost-site-${SITE}`)).toContainText('In the Main asteroid belt');
  await expect(page.getByTestId('outpost-site-belt.sol-kuiper-belt')).toBeVisible();
  await press(page, `outpost-charter-${SITE}`);
  await expect(page.getByTestId('outpost-charter-dialog')).toBeVisible();
  await expect(page.getByTestId('outpost-charter-belt')).toContainText('always a refinery');
  const name = await page.getByTestId('outpost-name').inputValue();
  await press(page, 'outpost-charter-confirm');
  let s = await api<BeltState>(page, 'state');
  expect(s.world.outposts?.[0]).toMatchObject({ site: SITE, name, stage: 0 });
  // One to a system: Sol's other belt waits for another time.
  await expect(page.getByTestId('outpost-sites-block')).toContainText('one to a system');

  // At the site, the frame's materials; then it is open and refines.
  await dockAt(page, OUTPOST);
  await api(page, 'setCargo', { 'habitat-modules': 8, metals: 20, machinery: 6 });
  await openDeckWindow(page, 'station-outpost', 'outpost-window');
  await expect(page.getByTestId('outpost-refining')).toContainText('Once its frame is up');
  for (const good of ['habitat-modules', 'metals', 'machinery']) await press(page, `outpost-deliver-${good}`);
  await waitUntil(page, 'the outpost open', async () => (await api<BeltState>(page, 'state')).world.outposts?.[0]?.stage === 1);

  // Ore from the hold: 40 an hour at the frame, paid at once, above any market's price.
  await api(page, 'setCargo', { ore: 50 });
  await openDeckWindow(page, 'station-outpost', 'outpost-window');
  const before = (await api<BeltState>(page, 'state')).credits;
  await expect(page.getByTestId('outpost-refine-ore')).toHaveText('Refine 40');
  await press(page, 'outpost-refine-ore');
  await expect(page.getByTestId('outpost-refined')).toHaveText('40/40 this hour');
  await expect(page.getByTestId('outpost-refine-ore')).toBeDisabled();
  s = await api<BeltState>(page, 'state');
  expect(s.credits - before).toBe(40 * 48);
  expect(s.world.outposts![0]!.refined?.units).toBe(40);

  // Out in Sol: the refinery is a station to fly back to.
  await hearOut(page);
  await press(page, 'dock-launch');
  await waitUntil(page, 'in flight', async () => (await api(page, 'mode')) === 'flight');
  if (await page.getByTestId('controls-sheet').isVisible().catch(() => false)) await press(page, 'sheet-close');
  const targets = await api<{ id: string; name: string }[]>(page, 'targets');
  expect(targets).toContainEqual(expect.objectContaining({ id: `station:${OUTPOST}`, name }));

  // Back at the refinery: sell it. Half of what went in; the pilot rides out to the nearest dock.
  await dockAt(page, OUTPOST);
  await openDeckWindow(page, 'station-outpost', 'outpost-window');
  await page.getByTestId('outpost-give-up-section').evaluate((el) => el.scrollIntoView({ block: 'start' }));
  const credits = (await api<BeltState>(page, 'state')).credits;
  await press(page, 'outpost-give-up');
  await expect(page.getByTestId('outpost-give-up-dialog')).toContainText('the Sol Transit Authority');
  await press(page, 'outpost-sell');
  await waitUntil(page, 'moved off the outpost', async () => ['earth-port', 'mars-depot'].includes((await api<BeltState>(page, 'state')).location.dockedAt ?? ''));
  await hearOut(page);
  s = await api<BeltState>(page, 'state');
  expect(s.world.outposts ?? []).toEqual([]);
  expect(s.world.outpostsFormer).toEqual([expect.objectContaining({ site: SITE, how: 'sold' })]);
  expect(s.credits - credits).toBe(s.world.outpostsFormer![0]!.paid);
  expect(s.world.outpostsFormer![0]!.paid).toBeGreaterThan(4_000);
  await expect(page.getByText(/is sold to the Sol Transit Authority for/)).toBeVisible();

  // The journal keeps it; the Fleet window offers the site again.
  await openDeckWindow(page, 'station-journal', 'journal-window');
  await expect(page.getByTestId('outposts-former')).toContainText(`${name} (refinery), Main asteroid belt, Sol: a frame, sold for`);
  await openDeckWindow(page, 'station-fleet', 'fleet');
  await expect(page.getByTestId(`outpost-charter-${SITE}`)).toBeEnabled();
});
