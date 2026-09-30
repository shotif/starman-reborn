import { expect, test, type Page } from '@playwright/test';
import { api, openFresh, press } from './helpers.ts';

/**
 * A fleet of your own (docs/PROCGEN.md §18): buy a ship and keep the old one, switch back, lease
 * storage and move cargo into it, buy a stake in the station's trade and collect its dividends,
 * and find it all again after a reload.
 */

interface FleetState {
  credits: number;
  ship: { model: string; cargo: Record<string, number> };
  fleet: {
    ships: { id: string; locationId: string; ship: { model: string } }[];
    storage: Record<string, Record<string, number>>;
    stakes: { locationId: string; percent: number; earned: number }[];
  };
}

const COURIER = 'ship.courier.1.halden';
const FREIGHTER = 'ship.freighter.1.halden';

async function openFleet(page: Page): Promise<void> {
  await press(page, 'room-deck');
  if (!(await page.getByTestId('fleet-window').isVisible().catch(() => false))) await press(page, 'station-fleet');
  await expect(page.getByTestId('fleet')).toBeVisible();
}

test('buy and keep, switch back, lease storage, move cargo and buy a stake', async ({ page }) => {
  await openFresh(page);
  await press(page, 'title-play');
  await press(page, 'intro-ok');
  await api(page, 'setCredits', 30_000);

  // Buy a freighter at Halcyon Ring's shipyard and keep the courier.
  await press(page, 'room-deck');
  await press(page, 'station-ships');
  await press(page, `buy-ship-${FREIGHTER}`);
  await expect(page.getByTestId('shipyard-keep-note')).toContainText('Buy and keep');
  await press(page, `shipyard-keep-${FREIGHTER}`);
  let s = await api<FleetState>(page, 'state');
  expect(s.ship.model).toBe(FREIGHTER);
  expect(s.fleet.ships).toHaveLength(1);
  expect(s.fleet.ships[0]).toMatchObject({ id: 'ship-1', locationId: 'earth-port', ship: { model: COURIER } });
  expect(s.credits).toBe(30_000 - 4_120);

  // The Fleet window lists it; switch back to the courier.
  await openFleet(page);
  await expect(page.getByTestId('fleet-ship-ship-1')).toContainText('Gannet');
  await press(page, 'fleet-switch-ship-1');
  s = await api<FleetState>(page, 'state');
  expect(s.ship.model).toBe(COURIER);
  expect(s.fleet.ships[0]!.ship.model).toBe(FREIGHTER);
  await expect(page.getByTestId('fleet-ship-ship-1')).toContainText('Petrel');

  // Lease a hold here, buy some cargo and store most of it.
  await press(page, 'storage-lease');
  s = await api<FleetState>(page, 'state');
  expect(s.fleet.storage['earth-port']).toEqual({});
  await press(page, 'room-trader');
  if (!(await page.getByTestId('trader-window').isVisible().catch(() => false))) await press(page, 'station-trade');
  await press(page, 'buy-medical');
  await expect(page.getByTestId('buy-qty')).toHaveText('6');
  await press(page, 'buy-confirm');
  await openFleet(page);
  await press(page, 'storage-store-medical');
  await expect(page.getByTestId('storage-qty')).toHaveText('6');
  await press(page, 'storage-minus');
  await press(page, 'storage-confirm');
  s = await api<FleetState>(page, 'state');
  expect(s.fleet.storage['earth-port']).toEqual({ medical: 5 });
  expect(s.ship.cargo).toEqual({ medical: 1 });
  await expect(page.getByTestId('storage-row-medical')).toContainText('stored 5');

  // Three per-cent of Halcyon Ring's trade, and two hours of dividends.
  const before = s.credits;
  await press(page, 'stake-plus');
  await press(page, 'stake-plus');
  await expect(page.getByTestId('stake-pct')).toHaveText('3%');
  await press(page, 'stake-buy');
  s = await api<FleetState>(page, 'state');
  expect(s.fleet.stakes).toMatchObject([{ locationId: 'earth-port', percent: 3, earned: 0 }]);
  expect(s.credits).toBe(before - 3 * 900);
  await api(page, 'advanceClock', 2 * 3_600);
  s = await api<FleetState>(page, 'state');
  const hourly = Math.round(0.012 * 3 * 900);
  expect(s.fleet.stakes[0]!.earned).toBe(2 * hourly);
  expect(s.credits).toBe(before - 3 * 900 + 2 * hourly);
  await expect(page.getByTestId('stake-earth-port')).toContainText(`earned ${2 * hourly} cr`);

  // Everything is still there after a reload.
  await api(page, 'flush');
  await page.reload();
  await press(page, 'title-continue');
  await expect(page.getByTestId('dock-screen')).toBeVisible();
  const again = await api<FleetState>(page, 'state');
  expect(again.fleet).toEqual(s.fleet);
  expect(again.ship.model).toBe(COURIER);
  await openFleet(page);
  await expect(page.getByTestId('fleet-ship-ship-1')).toBeVisible();
  await expect(page.getByTestId('stake-earth-port')).toBeVisible();
});
