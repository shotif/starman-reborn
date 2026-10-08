import { expect, test, type Page } from '@playwright/test';
import { api, isTouch, openFresh, press, waitUntil } from './helpers.ts';

/**
 * Earth's Moon for real (docs/PROCGEN.md §51): a fortnight before the total eclipse of the Sun of
 * 2 August 2027, Earth Port's News tells of it, and of the Moon's eclipse after; out in Sol the Moon
 * stands in its real direction from Earth on the game's date; scanned, its card gives its phase, how
 * much of it is lit, when it is next new and full and the eclipses to come; Sol's card on the star map
 * gives its phase and the next eclipse.
 */

interface State {
  location: { dockedAt: string | null; systemId: string };
}
interface Hud {
  context: { label: string } | null;
}
interface Luna {
  offset: [number, number, number];
  real: [number, number, number];
  turned: boolean;
}

const state = (page: Page) => api<State>(page, 'state');

async function dismissDiscovery(page: Page): Promise<void> {
  const ok = page.getByTestId('discovery-ok').last();
  if (await ok.isVisible().catch(() => false)) await ok.click({ timeout: 2_000 }).catch(() => {});
}

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

test('Earth’s Moon: the eclipses in the News, the Moon where it really is, its card with its phase and eclipses, and Sol’s map card', async ({ page }) => {
  await openFresh(page);
  await press(page, 'title-play');
  await press(page, 'intro-ok');
  await api(page, 'completeJobs', ['lifeline']);
  const touch = await isTouch(page);

  // The game's date: a fortnight before the total eclipse of the Sun of 2 August 2027, the day after a full Moon.
  expect(await api<boolean>(page, 'startedOn', '2027-07-19T00:00:00Z')).toBe(true);
  await api(page, 'dockAt', 'earth-port');
  await waitUntil(page, 'docked', async () => (await state(page)).location.dockedAt === 'earth-port');
  await hearOut(page);
  await press(page, 'room-bar');
  if (!(await page.getByTestId('news-window').isVisible().catch(() => false))) await press(page, 'station-news');
  const sun = page.getByTestId('news-eclipse-solar-2027-08-02');
  await expect(sun).toContainText('A total eclipse of the Sun on 2 August 2027: seen whole along a path across Morocco, Spain, Algeria, Libya, Egypt, Saudi Arabia, Yemen and Somalia, for up to 6 minutes 23 seconds');
  await expect(sun).toContainText('in 14 days');
  await expect(page.getByTestId('news-eclipse-lunar-2027-08-17')).toContainText('A penumbral eclipse of the Moon on 17 August 2027, seen from the Pacific and the Americas');

  await press(page, 'dock-launch');
  await waitUntil(page, 'in flight', async () => (await api(page, 'mode')) === 'flight');
  if (await page.getByTestId('controls-sheet').isVisible().catch(() => false)) await press(page, 'sheet-close');
  await waitUntil(page, 'undocked', async () => (await dismissDiscovery(page), (await api<{ autopilot: string } | null>(page, 'player'))?.autopilot === 'none'), 60_000);

  // The Moon in its real direction from Earth on the game's date (it is not turned off it on this day).
  const luna = (await api<Luna | null>(page, 'luna'))!;
  expect(luna.turned).toBe(false);
  const [o, r] = [luna.offset, luna.real];
  const cos = (o[0] * r[0] + o[1] * r[1] + o[2] * r[2]) / Math.hypot(...o);
  expect(Math.acos(Math.min(1, cos))).toBeLessThan(0.01);

  // Scanned: its card.
  await api(page, 'selectTarget', 'planet:moon');
  expect(await api<boolean>(page, 'placeNear', { id: 'planet:moon', distance: 2_000 })).toBe(true);
  await waitUntil(page, 'Scan offered', async () => (await dismissDiscovery(page), (await api<Hud | null>(page, 'hud'))?.context?.label === 'Scan'), 30_000);
  await press(page, touch ? 'touch-context' : 'hud-context');
  const sci = page.getByTestId('science-moon-earth');
  await expect(sci).toContainText('The Moon is full, 99% lit.');
  await expect(sci).toContainText('406,100 km from Earth’s centre');
  await expect(sci).toContainText('Next new Moon');
  await expect(sci).toContainText('2 August 2027');
  await expect(sci.getByTestId('eclipse-solar-2027-08-02')).toContainText('A total eclipse of the Sun on 2 August 2027');
  await expect(sci).toContainText('In flight it stands in its real direction from Earth on the game’s date');
  await press(page, 'sheet-close');
  await dismissDiscovery(page);

  // Sol's card on the star map: its phase, and the next eclipse.
  if (touch) await press(page, 'hud-map');
  else await page.keyboard.press('Tab');
  await expect(page.getByTestId('galaxy-map')).toBeVisible();
  await press(page, 'map-system-sol');
  await expect(page.getByTestId('science-lunar')).toContainText('The Moon is full, 99% lit.');
  await expect(page.getByTestId('lunar-next-eclipse')).toContainText('Next eclipse: A total eclipse of the Sun on 2 August 2027');
  await press(page, 'map-close');
});
