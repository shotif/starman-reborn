import { expect, test, type Page } from '@playwright/test';
import { api, openFresh, press, waitUntil } from './helpers.ts';

/**
 * Combat depth at the docks and in flight (docs/PROCGEN.md §15): salvaged equipment fitted from the
 * stash, damaged systems repaired, decoys bought, and a wingman hired who launches with the player.
 */

type Hooks = { __starman: { setCombat(p: unknown): void } };

async function openWindow(page: Page, room: string, action: string, windowId: string): Promise<void> {
  await press(page, room);
  if (!(await page.getByTestId(windowId).isVisible().catch(() => false))) await press(page, action);
}

test('salvage fitted, systems repaired, decoys bought, and a wingman who flies with you', async ({ page }) => {
  await openFresh(page);
  await press(page, 'title-play');
  await press(page, 'intro-ok');
  await api(page, 'setCredits', 9_000);
  await page.evaluate(() =>
    (window as unknown as Hooks).__starman.setCombat({ systems: { engines: 0.5, guns: 0.3, shields: 0 }, decoys: 1, stash: ['gear.pulse.2.halden'] }),
  );

  await openWindow(page, 'room-outfitter', 'station-equip', 'outfitter-window');
  await expect(page.getByTestId('systems-damage')).toContainText('engines 50%');
  await press(page, 'stash-fit-0');
  await press(page, 'dock-repair-systems');
  await press(page, 'buy-decoy');
  const s = await api<{ stash: string[]; ship: { systems: Record<string, number>; decoys: number; fittings: Record<string, string> } }>(page, 'state');
  expect(s.stash).toEqual([]);
  expect(Object.values(s.ship.fittings)).toContain('gear.pulse.2.halden');
  expect(s.ship.systems).toEqual({ engines: 0, guns: 0, shields: 0 });
  expect(s.ship.decoys).toBe(2);

  await openWindow(page, 'room-bar', 'station-jobs', 'jobs-window');
  const hire = page.locator('[data-testid^="hire-"]').first();
  await expect(hire).toBeVisible();
  await hire.click();
  const crew = await api<{ crew: { name: string }[] }>(page, 'state');
  expect(crew.crew).toHaveLength(1);

  await press(page, 'dock-launch');
  await press(page, 'sheet-close');
  await api(page, 'setTimeScale', 4);
  const name = crew.crew[0]!.name;
  await waitUntil(page, 'the wingman forms up', async () => {
    const targets = await api<{ name: string; hostile: boolean }[]>(page, 'targets');
    return targets.some((t) => t.name === name && !t.hostile);
  }, 60_000);
  expect((await api<{ decoys: number }>(page, 'hud')).decoys).toBe(2);
});
