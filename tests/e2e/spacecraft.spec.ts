import { expect, test, type Page } from '@playwright/test';
import { api, isTouch, openFresh, press, waitUntil } from './helpers.ts';

/**
 * Spacecraft out in Sol (docs/PROCGEN.md §49): a fortnight before Europa Clipper swings past Earth,
 * Earth Port's News tells of it; out in Sol the eleven craft stand where JPL Horizons has them, Webb
 * by Earth and Voyager 1 far beyond Neptune; Voyager 1 scanned, its card gives where it is, how long
 * its light takes to reach Earth, that it is leaving the Solar System and its mission's dated facts,
 * and its first scan goes in the logbook; Sol's card on the star map lists the craft.
 */

interface State {
  location: { dockedAt: string | null; systemId: string };
  logbook?: { craft?: string[] };
}
interface Hud {
  context: { label: string } | null;
}
interface CraftView {
  id: string;
  position: [number, number, number];
  near: boolean;
}
interface Body {
  id: string;
  position: [number, number, number];
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

test('spacecraft in Sol: Europa Clipper’s flyby in the News, the craft where Horizons has them, Voyager 1 scanned with its card and logbook, and Sol’s map card', async ({ page }) => {
  await openFresh(page);
  await press(page, 'title-play');
  await press(page, 'intro-ok');
  await api(page, 'completeJobs', ['lifeline']);
  const touch = await isTouch(page);

  // The game's date: a fortnight before Europa Clipper passes Earth on 3 December 2026.
  expect(await api<boolean>(page, 'startedOn', '2026-11-19T00:00:00Z')).toBe(true);
  await api(page, 'dockAt', 'earth-port');
  await waitUntil(page, 'docked', async () => (await state(page)).location.dockedAt === 'earth-port');
  await hearOut(page);
  await press(page, 'room-bar');
  if (!(await page.getByTestId('news-window').isVisible().catch(() => false))) await press(page, 'station-news');
  await expect(page.getByTestId('news-craft-europa-clipper')).toContainText('Europa Clipper passes Earth on 3 December 2026, 9,600 km from its centre');
  await expect(page.getByTestId('news-craft-europa-clipper')).toContainText('nearest Earth in 15 days');

  await press(page, 'dock-launch');
  await waitUntil(page, 'in flight', async () => (await api(page, 'mode')) === 'flight');
  if (await page.getByTestId('controls-sheet').isVisible().catch(() => false)) await press(page, 'sheet-close');
  await waitUntil(page, 'undocked', async () => (await dismissDiscovery(page), (await api<{ autopilot: string } | null>(page, 'player'))?.autopilot === 'none'), 60_000);

  // The eleven where Horizons has them: Webb by Earth, Voyager 1 far beyond Neptune.
  const craft = (await api<CraftView[] | null>(page, 'craft'))!;
  expect(craft).toHaveLength(11);
  expect(craft.find((c) => c.id === 'james-webb-space-telescope')!.near).toBe(true);
  const neptune = (await api<Body[] | null>(page, 'planets'))!.find((p) => p.id === 'neptune')!;
  const length = (v: [number, number, number]) => Math.hypot(...v);
  expect(length(craft.find((c) => c.id === 'voyager-1')!.position)).toBeGreaterThan(length(neptune.position) * 1.4);

  // Voyager 1 scanned: its card, and the logbook.
  await api(page, 'selectTarget', 'craft:voyager-1');
  expect(await api<boolean>(page, 'placeNear', { id: 'craft:voyager-1', distance: 3_000 })).toBe(true);
  await waitUntil(page, 'Scan offered', async () => (await dismissDiscovery(page), (await api<Hud | null>(page, 'hud'))?.context?.label === 'Scan'), 30_000);
  await press(page, touch ? 'touch-context' : 'hud-context');
  const sci = page.getByTestId('science-craft');
  await expect(sci).toContainText('Voyager 1 is 172 AU from the Sun.');
  await expect(sci).toContainText('Spacecraft · NASA');
  await expect(sci).toContainText('5 September 1977');
  await expect(sci).toContainText('it is leaving the Solar System');
  // Voyager 1 passes a light-day from Earth in November 2026.
  await expect(sci.getByTestId('craft-light')).toContainText('Light from Voyager 1 takes 24 hours');
  await expect(sci.getByTestId('craft-done')).toContainText('5 March 1979 Flew past Jupiter');
  await expect(sci).toContainText('drawn far larger than life');
  await waitUntil(page, 'Voyager 1 in the logbook', async () => (await state(page)).logbook?.craft?.includes('voyager-1') ?? false);
  await press(page, 'sheet-close');
  await dismissDiscovery(page);

  // Sol's card on the star map lists the craft.
  if (touch) await press(page, 'hud-map');
  else await page.keyboard.press('Tab');
  await expect(page.getByTestId('galaxy-map')).toBeVisible();
  await press(page, 'map-system-sol');
  await expect(page.getByTestId('craft-voyager-1')).toContainText('Voyager 1');
  await expect(page.getByTestId('craft-europa-clipper')).toContainText('3 December 2026, 9,600 km from Earth’s centre');
  await press(page, 'map-close');
});
