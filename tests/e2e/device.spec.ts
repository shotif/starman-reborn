import { expect, test, type Page } from '@playwright/test';
import { api, isTouch, newGameAndLaunch, openFresh, press, waitUntil } from './helpers.ts';

/**
 * The device report in Settings (docs/TEST_RECORD.md, the real-device checklist): what this device
 * and its browser tell the game, copied with one tap, and the frame rate of the last flight.
 */

async function reportText(page: Page): Promise<string> {
  const report = page.getByTestId('device-report');
  await expect(report).toHaveValue(/^Starman Reborn device report/);
  return report.inputValue();
}

test('the device report: this device, the load and the last flight, copied with one tap', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await openFresh(page);
  // A phone with a notch: the report reads the insets the layout keeps clear of.
  await page.addStyleTag({ content: ':root{--safe-top:44px!important;--safe-bottom:34px!important;--safe-left:0px!important;--safe-right:0px!important}' });
  await press(page, 'title-settings');
  const text = await reportText(page);
  expect(text).toMatch(/^Build: \S+$/m);
  expect(text).toMatch(/^Load: title showed at \d+\.\d s, Play at \d+\.\d s after opening the page/m);
  expect(text).toMatch(/^Graphics: WebGL 2, .+; textures up to \d+ px$/m);
  expect(text).toContain('Safe areas: top 44, right 0, bottom 34, left 0');
  expect(text).toMatch((await isTouch(page)) ? /^Input: touch \(\d+ points?\)/m : /^Input: no touch, fine pointer, hover/m);
  expect(text).toContain('Frame rate, last flight: no flight yet');
  // Test runs never register the service worker (tests/e2e/offline.spec.ts covers it).
  expect(text).toContain('Offline play: off in test runs');

  await press(page, 'device-report-copy');
  await expect(page.getByTestId('device-report-status')).toContainText('Copied');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(text);
  await press(page, 'sheet-close');

  // Fly a little, then the report has the flight's frame rate.
  await newGameAndLaunch(page, 6);
  const from = await api<number>(page, 'framesDrawn');
  await waitUntil(page, 'a few seconds of flight', async () => (await api<number>(page, 'framesDrawn')) > from + 60);
  await press(page, 'hud-pause');
  await press(page, 'pause-settings');
  expect(await reportText(page)).toMatch(/^Frame rate, last flight: \d+ fps on average, \d+ in the slowest second \(\d+ s\)$/m);
});
