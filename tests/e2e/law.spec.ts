import { expect, test } from '@playwright/test';
import { api, newGameAndLaunch, openFresh, press, waitUntil } from './helpers.ts';

/**
 * The law and goals in the browser (docs/PROCGEN.md §12–13): a wanted pilot sees it on the HUD,
 * gets emergency docking only, buys a pardon at the customs desk and has the station back; the
 * journal keeps the pilot record.
 */
test('a wanted pilot docks for repairs only, buys a pardon and gets full service back', async ({ page }) => {
  await openFresh(page);
  await newGameAndLaunch(page, 6);
  await page.evaluate(() => (window as unknown as { __starman: { setFines(f: string, n: number): void } }).__starman.setFines('sta', 1_200));
  await expect(page.getByTestId('hud-wanted')).toContainText('1,200');

  // Back to Halcyon Ring: its owner's customs take the pilot in for repairs and the pardon only.
  await api(page, 'setTimeScale', 8);
  await api(page, 'goTo', 'station:earth-port');
  await waitUntil(page, 'docked', async () => {
    const ok = page.getByTestId('discovery-ok');
    if (await ok.isVisible().catch(() => false)) await ok.click().catch(() => {});
    return (await api(page, 'mode')) === 'docked';
  });
  await expect(page.getByTestId('customs-desk')).toBeVisible();
  await expect(page.getByTestId('room-bar')).toBeVisible();
  await expect(page.getByTestId('room-trader')).toHaveCount(0);

  await api(page, 'setCredits', 5_000);
  await press(page, 'pay-fines');
  await expect(page.getByTestId('room-trader')).toBeVisible();
  const s = await api<{ credits: number; law: { fines: Record<string, number> } }>(page, 'state');
  expect(s.law.fines).toEqual({});
  expect(s.credits).toBe(5_000 - 1_200);

  // The journal's pilot record: three ratings, the codex and milestones.
  await press(page, 'station-journal');
  await expect(page.getByTestId('pilot-record')).toBeVisible();
  await expect(page.getByTestId('rating-combat')).toContainText('Green');
  await expect(page.getByTestId('rating-trade')).toBeVisible();
  await expect(page.getByTestId('rating-exploration')).toBeVisible();
  await expect(page.getByTestId('pilot-record')).toContainText('Codex of the real sky');
});
