import { expect, test, type Page } from '@playwright/test';
import { api, openFresh, press } from './helpers.ts';

/**
 * People and information (docs/PROCGEN.md §16): a round in the bar buys something true, the
 * journal keeps it, the trade computer ranks what the player knows, and a price can be watched.
 */

async function openWindow(page: Page, room: string, action: string, windowId: string): Promise<void> {
  await press(page, room);
  if (!(await page.getByTestId(windowId).isVisible().catch(() => false))) await press(page, action);
}

test('a round in the bar, the journal, the trade computer and a watched price', async ({ page }) => {
  await openFresh(page);
  await press(page, 'title-play');
  await press(page, 'intro-ok');
  await api(page, 'setCredits', 5_000);

  // Everyone in Halcyon Ring's bar: Rhea Castell among them, regulars and a pilot for hire.
  await openWindow(page, 'room-bar', 'station-people', 'people-window');
  await expect(page.getByTestId('person-story.castell')).toBeVisible();
  const regulars = page.locator('[data-testid^="person-p."]');
  expect(await regulars.count()).toBeGreaterThanOrEqual(2);

  // Buy rounds until someone has something to tell (a round with nothing to tell is free).
  let told = false;
  for (let i = 0; i < (await regulars.count()) && !told; i++) {
    await regulars.nth(i).click();
    await expect(page.getByTestId('person-dialog')).toBeVisible();
    const before = await api<{ credits: number }>(page, 'state');
    await press(page, 'person-drink');
    const after = await api<{ credits: number; rumours: { text: string }[] }>(page, 'state');
    if (after.credits < before.credits) {
      told = true;
      await expect(page.getByTestId('person-speech')).toHaveText(after.rumours.at(-1)!.text);
    }
    await press(page, 'person-close');
  }
  expect(told).toBe(true);

  // The journal keeps what was heard.
  await press(page, 'station-journal');
  await expect(page.getByTestId('heard')).toBeVisible();

  // Watch a price at the trader, and find it in the trade computer.
  await openWindow(page, 'room-trader', 'station-trade', 'trader-window');
  await page.locator('[data-testid^="buy-"]:not([disabled])').first().click();
  await page.locator('[data-testid^="watch-here-"]').click();
  await page.keyboard.press('Escape');
  await press(page, 'station-computer');
  await expect(page.getByTestId('computer')).toBeVisible();
  await expect(page.getByTestId('price-watch')).toBeVisible();
  const s = await api<{ priceWatch: unknown[] }>(page, 'state');
  expect(s.priceWatch).toHaveLength(1);
});
