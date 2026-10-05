import { expect, test, type Page } from '@playwright/test';
import { api, openFresh, press, waitUntil } from './helpers.ts';

/**
 * Captains supply outposts (docs/PROCGEN.md §37): at Earth Port a captain is hired to supply a
 * refinery chartered in Sol's main belt and delivers what Earth Port sells of its frame; the rest
 * brought by hand, the refinery opens; a second ship, with a mining laser, is hired to mine for it,
 * is seen at work in the belt with its beam on its rock, has its loads refined and paid, and is
 * recalled home.
 */

type Hooks = { __starman: { completeJobs(ids: string[]): void; dockAt(id: string): void } };
interface WorkState {
  credits: number;
  clock: number;
  location: { dockedAt: string | null };
  world: { outposts?: { site: string; stage: number; delivered: Record<string, number>; refined?: { units: number } }[] };
  fleet: { ships: { id: string; hauler?: { work?: string; leg: string; phase?: string } }[]; reports: { kind: string; text: string; amount: number }[] };
}
interface Workers {
  ships: { id: string; hauler: { leg: string; phase?: string; since: number } }[];
  flight: { shipId: string; phase: string; distance: number; beam: boolean }[] | null;
}

const SITE = 'belt.sol-main-belt';
const OUTPOST = `outpost.${SITE}`;
const state = (page: Page) => api<WorkState>(page, 'state');

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

async function openDeckWindow(page: Page, button: string, content: string): Promise<void> {
  await press(page, 'room-deck');
  if (!(await page.getByTestId(content).isVisible().catch(() => false))) await press(page, button);
  await expect(page.getByTestId(content)).toBeVisible();
}

test('captains supply outposts: a supply captain delivers a refinery’s frame goods, and a mining captain works its belt', async ({ page }) => {
  await openFresh(page);
  await press(page, 'title-play');
  await press(page, 'intro-ok');
  await page.evaluate(() => (window as unknown as Hooks).__starman.completeJobs(['lifeline']));
  await api(page, 'setCredits', 200_000);

  // A refinery chartered in Sol's main belt, from Earth Port.
  await dockAt(page, 'earth-port');
  await openDeckWindow(page, 'station-fleet', 'fleet');
  await press(page, `outpost-charter-${SITE}`);
  await press(page, 'outpost-charter-confirm');
  await expect.poll(async () => (await state(page)).world.outposts?.length).toBe(1);

  // A freighter parked here, hired to supply it: what Earth Port sells of the frame (machinery) goes.
  const freighter = await api<string>(page, 'parkShip', { model: 'ship.freighter.1.halden' });
  await openDeckWindow(page, 'station-fleet', 'fleet');
  await press(page, `fleet-hire-${freighter}`);
  await expect(page.getByTestId('fleet-hire-dialog')).toBeVisible();
  await page.getByTestId('fleet-work').selectOption('supply');
  await expect(page.getByTestId('fleet-hire-supply')).toBeVisible();
  await expect(page.getByTestId('fleet-hire-haul')).toBeHidden();
  await expect(page.getByTestId('fleet-supply-summary')).toContainText('bought here');
  await expect(page.getByTestId('fleet-supply-cost')).toContainText('paid as it sets out');
  await press(page, 'fleet-hire-confirm');
  await expect(page.getByText(/takes your .*: loading 6 machinery for /)).toBeVisible();
  await expect(page.getByTestId(`fleet-status-${freighter}`)).toContainText('machinery');
  await api(page, 'advanceClock', 3_600);
  await waitUntil(page, 'the machinery delivered', async () => ((await state(page)).world.outposts![0]!.delivered.machinery ?? 0) === 6);
  expect((await state(page)).fleet.reports.some((r) => r.kind === 'supply' && /delivered 6 machinery/.test(r.text))).toBe(true);

  // The rest by hand at the refinery: it opens.
  await dockAt(page, OUTPOST);
  await api(page, 'setCargo', { 'habitat-modules': 8, metals: 20 });
  await openDeckWindow(page, 'station-outpost', 'outpost-window');
  for (const good of ['habitat-modules', 'metals']) await press(page, `outpost-deliver-${good}`);
  await waitUntil(page, 'the refinery open', async () => (await state(page)).world.outposts![0]!.stage === 1);

  // A courier with a mining laser, hired at Earth Port to mine for it.
  await dockAt(page, 'earth-port');
  const miner = await api<string>(page, 'parkShip', { model: 'ship.courier.1.halden', fittings: { 'utility-1': 'gear.mining-laser.1.eridani' } });
  await openDeckWindow(page, 'station-fleet', 'fleet');
  await press(page, `fleet-hire-${miner}`);
  await page.getByTestId('fleet-work').selectOption('mine');
  await expect(page.getByTestId('fleet-mine-summary')).toContainText('units an hour');
  await expect(page.getByTestId('fleet-mine-pay')).toContainText(/about \+[\d,]+ cr an hour/);
  await press(page, 'fleet-hire-confirm');
  await expect(page.getByText(/setting out to mine for /)).toBeVisible();

  // Out in Sol, at work: seen cutting in the belt, the beam on its rock.
  await press(page, 'dock-launch');
  await waitUntil(page, 'in flight', async () => (await api(page, 'mode')) === 'flight');
  if (await page.getByTestId('controls-sheet').isVisible().catch(() => false)) await press(page, 'sheet-close');
  await waitUntil(page, 'the miner cutting', async () => {
    const w = (await api<Workers>(page, 'workers'))!;
    const h = w.ships.find((x) => x.id === miner)?.hauler;
    if (h && h.phase !== 'cutting') await api(page, 'advanceClock', 30);
    return !!w.flight?.some((m) => m.shipId === miner && m.phase === 'cutting' && m.beam);
  }, 120_000);
  const targets = await api<{ id: string; name: string }[]>(page, 'targets');
  expect(targets.some((t) => t.name === 'Your Halden Courier' || /^Your /.test(t.name))).toBe(true);
  // Its loads refined and paid, within the refinery's hour (the supply captain buys for the next stage meanwhile).
  await api(page, 'advanceClock', 1_800);
  await waitUntil(page, 'a load refined', async () => (await state(page)).fleet.reports.some((r) => r.kind === 'mine'));
  const s = await state(page);
  const load = s.fleet.reports.find((r) => r.kind === 'mine')!;
  expect(load.amount).toBeGreaterThan(0);
  expect(load.text).toMatch(/handed .*metal ore.* to .*: \+[\d,]+ cr\./);
  expect(s.world.outposts![0]!.refined?.units ?? 0).toBeGreaterThan(0);

  // Recalled at a dock: it hands over what it has and flies home.
  await dockAt(page, 'earth-port');
  await openDeckWindow(page, 'station-fleet', 'fleet');
  await press(page, `fleet-recall-${miner}`);
  await api(page, 'advanceClock', 3 * 3_600);
  await waitUntil(page, 'the miner home', async () => !(await state(page)).fleet.ships.find((x) => x.id === miner)?.hauler);
  expect((await state(page)).fleet.reports.some((r) => /signed off/.test(r.text))).toBe(true);
});
