import { expect, test, type Page } from '@playwright/test';
import { api, openFresh, press, waitUntil } from './helpers.ts';

/**
 * Your captains on the lanes (docs/PROCGEN.md §18.6): a captain hired in the Fleet window flies
 * the run where the player can meet it, marked as theirs; raiders who destroy it in sight lose the
 * ship there and then, insurance pays, and its cargo spills.
 */

type Hooks = { __starman: { completeJobs(ids: string[]): void; dockAt(id: string): void } };
interface Npc {
  id: string;
  name: string;
  captain: string | null;
  subtitle: string;
}
interface FleetState {
  credits: number;
  fleet: {
    ships: { id: string; hauler?: { captain: string; leg: string; route: { to: string; commodity: string } }; ship: { cargo: Record<string, number> } }[];
    reports: { kind: string; text: string; amount: number }[];
  };
}

const FREIGHTER = 'ship.freighter.1.halden';

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
  await waitUntil(page, `docked at ${id}`, async () => (await api<{ location: { dockedAt: string | null } }>(page, 'state')).location.dockedAt === id);
  await hearOut(page);
}

async function openFleet(page: Page): Promise<void> {
  await press(page, 'room-deck');
  // The window button toggles: press it only when the Fleet window is not open already.
  if (!(await page.getByTestId('fleet').isVisible().catch(() => false))) await press(page, 'station-fleet');
  await expect(page.getByTestId('fleet')).toBeVisible();
}

test('your captain on the lanes: hired at the dock, met in flight as yours, and lost to raiders there', async ({ page }) => {
  await openFresh(page);
  await press(page, 'title-play');
  await press(page, 'intro-ok');
  await page.evaluate(() => (window as unknown as Hooks).__starman.completeJobs(['lifeline']));
  await api(page, 'setCredits', 30_000);
  // Deimos Depot's prices, seen there; then home to Halcyon Ring.
  await dockAt(page, 'mars-depot');
  await dockAt(page, 'earth-port');

  // A freighter bought at Halcyon Ring, the courier kept and parked there.
  await press(page, 'room-deck');
  await press(page, 'station-ships');
  await press(page, `buy-ship-${FREIGHTER}`);
  await press(page, `shipyard-keep-${FREIGHTER}`);

  // A captain for the courier: electronics to Deimos Depot, insured.
  await openFleet(page);
  await press(page, 'fleet-hire-ship-1');
  await expect(page.getByTestId('fleet-hire-dialog')).toBeVisible();
  await page.getByTestId('fleet-dest').selectOption('mars-depot');
  await page.getByTestId('fleet-good').selectOption('electronics');
  await page.getByTestId('fleet-insure').check();
  await expect(page.getByTestId('fleet-hire-net')).toContainText('a run');
  await press(page, 'fleet-hire-confirm');
  let s = await api<FleetState>(page, 'state');
  const ship = s.fleet.ships.find((o) => o.id === 'ship-1')!;
  expect(ship.hauler).toMatchObject({ leg: 'out', route: { to: 'mars-depot', commodity: 'electronics' } });
  const qty = ship.ship.cargo['electronics']!;
  expect(qty).toBeGreaterThan(0);
  await expect(page.getByTestId('fleet-hauler-ship-1')).toContainText(`Loading ${qty} electronics at Halcyon Ring`);

  // Out into Sol: once loaded, the captain flies the lane to Deimos Depot, named as the player's own.
  await press(page, 'dock-launch');
  await waitUntil(page, 'in flight', async () => (await api(page, 'mode')) === 'flight');
  if (await page.getByTestId('controls-sheet').isVisible().catch(() => false)) await press(page, 'sheet-close');
  await waitUntil(page, 'undocked', async () => (await api<{ autopilot: string } | null>(page, 'player'))?.autopilot === 'none', 60_000);
  await api(page, 'advanceClock', 200);
  let mine: Npc | undefined;
  await waitUntil(page, 'the captain on the lanes', async () => {
    mine = (await api<Npc[]>(page, 'npcs')).find((n) => n.captain === 'ship-1');
    return !!mine;
  }, 60_000);
  expect(mine!.subtitle).toBe(`Captain ${ship.hauler!.captain} · ${qty} electronics for Deimos Depot`);
  const targets = await api<{ id: string; name: string; kind: string }[]>(page, 'targets');
  const target = targets.find((t) => t.name === `Your ${mine!.name}`)!;
  expect(target).toBeDefined();
  await api(page, 'selectTarget', target.id);
  await expect(page.locator('.target-name')).toHaveText(`Your ${mine!.name}`);
  await expect(page.locator('.badge-own')).toHaveText('■ Yours');

  // Raiders destroy it in sight: the ship is lost there and then, insured, and its cargo spills.
  const before = s.credits;
  expect(await api<boolean>(page, 'destroyNpc', { id: mine!.id, byPlayer: false })).toBe(true);
  s = await api<FleetState>(page, 'state');
  expect(s.fleet.ships.some((o) => o.id === 'ship-1')).toBe(false);
  const lost = s.fleet.reports.at(-1)!;
  expect(lost.kind).toBe('lost');
  expect(lost.text).toMatch(new RegExp(`^Raiders destroyed your ${mine!.name} in Sol on the way to Deimos Depot, with ${qty} electronics\\. .* got away in a pod\\. Insurance paid \\d+ cr\\.$`));
  expect(s.credits).toBeGreaterThan(before);
  await expect(page.getByText(lost.text)).toBeVisible();
  await waitUntil(page, 'cargo adrift', async () => (await api<{ kind: string }[]>(page, 'targets')).some((t) => t.kind === 'loot'));

  // Docked again, the Fleet window keeps the report.
  await dockAt(page, 'earth-port');
  await openFleet(page);
  await expect(page.getByTestId('fleet-reports')).toContainText(`Raiders destroyed your ${mine!.name} in Sol`);
});
