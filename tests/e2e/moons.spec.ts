import { expect, test, type Page } from '@playwright/test';
import { api, isTouch, openFresh, press, waitUntil } from './helpers.ts';

/**
 * The large moons of the giant planets (docs/PROCGEN.md §48): out from Earth Port, Io and Titan are
 * drawn by their planets in their real directions; Io scanned, its card gives its period, distance,
 * size and density from JPL Horizons, and it goes in the codex; Sol's card on the star map lists the
 * moons.
 */

interface State {
  codex: string[];
  location: { dockedAt: string | null; systemId: string };
}
interface Hud {
  context: { label: string } | null;
}
interface Body {
  id: string;
  position: [number, number, number];
  radius: number;
}

const state = (page: Page) => api<State>(page, 'state');

async function dismissDiscovery(page: Page): Promise<void> {
  const ok = page.getByTestId('discovery-ok').last();
  if (await ok.isVisible().catch(() => false)) await ok.click({ timeout: 2_000 }).catch(() => {});
}

test('the giant planets’ moons: drawn by Jupiter and Saturn, Io scanned into the codex with its card, and Sol’s map card', async ({ page }) => {
  await openFresh(page);
  await press(page, 'title-play');
  await press(page, 'intro-ok');
  await api(page, 'completeJobs', ['lifeline']);
  const touch = await isTouch(page);

  await api(page, 'dockAt', 'earth-port');
  await waitUntil(page, 'docked', async () => (await state(page)).location.dockedAt === 'earth-port');
  await press(page, 'dock-launch');
  await waitUntil(page, 'in flight', async () => (await api(page, 'mode')) === 'flight');
  if (await page.getByTestId('controls-sheet').isVisible().catch(() => false)) await press(page, 'sheet-close');
  await waitUntil(page, 'undocked', async () => (await dismissDiscovery(page), (await api<{ autopilot: string } | null>(page, 'player'))?.autopilot === 'none'), 60_000);

  // The moons by their planets: Jupiter's four outside Jupiter, Titan outside Saturn's rings.
  const planets = (await api<Body[] | null>(page, 'planets'))!;
  const at = (id: string) => planets.find((p) => p.id === id)!;
  const dist = (a: [number, number, number], b: [number, number, number]) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  for (const id of ['io', 'europa', 'ganymede', 'callisto']) expect(dist(at(id).position, at('jupiter').position)).toBeGreaterThan(at('jupiter').radius + at(id).radius);
  expect(dist(at('titan').position, at('saturn').position)).toBeGreaterThan(at('saturn').radius * 2);

  // Io scanned: its card, and the codex.
  const before = (await state(page)).codex.length;
  await api(page, 'selectTarget', 'planet:io');
  expect(await api<boolean>(page, 'placeNear', { id: 'planet:io', distance: 3_000 })).toBe(true);
  await waitUntil(page, 'Scan offered', async () => (await dismissDiscovery(page), (await api<Hud | null>(page, 'hud'))?.context?.label === 'Scan'), 30_000);
  await press(page, touch ? 'touch-context' : 'hud-context');
  const sci = page.getByTestId('science-moon');
  await expect(sci).toContainText('Io goes round Jupiter once every 1.77 days.');
  await expect(sci).toContainText('Moon of Jupiter');
  await expect(sci).toContainText('422,000 km from Jupiter’s centre (5.9 of its radii)');
  await expect(sci).toContainText('3,643 km across');
  await expect(sci).toContainText('3.53 g/cm³');
  await expect(sci).toContainText('In flight it stands in its real direction from Jupiter');
  await waitUntil(page, 'Io in the codex', async () => (await state(page)).codex.includes('io'));
  expect((await state(page)).codex.length).toBe(before + 1);
  await press(page, 'sheet-close');
  await dismissDiscovery(page);

  // Sol's card on the star map lists the moons.
  if (touch) await press(page, 'hud-map');
  else await page.keyboard.press('Tab');
  await expect(page.getByTestId('galaxy-map')).toBeVisible();
  await press(page, 'map-system-sol');
  await expect(page.getByTestId('moon-io')).toContainText('Io');
  await expect(page.getByTestId('moon-io')).toContainText('Goes round in');
  await expect(page.getByTestId('moon-titan')).toContainText('Titan');
  await press(page, 'map-close');
});
