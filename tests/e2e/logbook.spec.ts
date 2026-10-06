import { expect, test, type Page } from '@playwright/test';
import { api, isTouch, openFresh, press, waitUntil } from './helpers.ts';

/**
 * The pilot's logbook (docs/PROCGEN.md §46): a new pilot signs on; out in Sol a comet scanned for
 * the first time, then a jump to a star never visited; back at a dock, the journal's Logbook gives
 * the bests and the latest entries, and the logbook itself lists them all, filtered by kind.
 */

interface State {
  credits: number;
  location: { dockedAt: string | null; systemId: string };
  logbook?: { entries: { kind: string }[] };
}
interface Hud {
  context: { label: string } | null;
}

const state = (page: Page) => api<State>(page, 'state');
const mode = (page: Page) => api<string>(page, 'mode');

async function dismissDiscovery(page: Page): Promise<void> {
  const ok = page.getByTestId('discovery-ok').last();
  if (await ok.isVisible().catch(() => false)) await ok.click({ timeout: 2_000 }).catch(() => {});
}

test('a pilot’s logbook: signed on, a comet’s first scan, a first arrival, the bests, and every entry filtered by kind', async ({ page }) => {
  await openFresh(page);
  await press(page, 'title-play');
  await press(page, 'intro-ok');
  await api(page, 'completeJobs', ['lifeline']);
  const touch = await isTouch(page);
  expect((await state(page)).logbook?.entries[0]?.kind).toBe('signed');

  // Out in Sol: Encke scanned for the first time.
  await api(page, 'dockAt', 'earth-port');
  await waitUntil(page, 'docked', async () => (await state(page)).location.dockedAt === 'earth-port');
  await press(page, 'dock-launch');
  await waitUntil(page, 'in flight', async () => (await mode(page)) === 'flight');
  if (await page.getByTestId('controls-sheet').isVisible().catch(() => false)) await press(page, 'sheet-close');
  await waitUntil(page, 'undocked', async () => (await dismissDiscovery(page), (await api<{ autopilot: string } | null>(page, 'player'))?.autopilot === 'none'), 60_000);
  await api(page, 'selectTarget', 'comet:comet-2p');
  expect(await api<boolean>(page, 'placeNear', { id: 'comet:comet-2p', distance: 6_000 })).toBe(true);
  await waitUntil(page, 'Scan offered', async () => (await dismissDiscovery(page), (await api<Hud | null>(page, 'hud'))?.context?.label === 'Scan'), 30_000);
  await press(page, touch ? 'touch-context' : 'hud-context');
  await expect(page.getByTestId('science-comet')).toBeVisible();
  await press(page, 'sheet-close');
  await waitUntil(page, 'the comet in the logbook', async () => (await state(page)).logbook?.entries.some((e) => e.kind === 'comet') ?? false);

  // A jump to Alpha Centauri, never visited.
  if (touch) await press(page, 'hud-map');
  else await page.keyboard.press('Tab');
  await expect(page.getByTestId('galaxy-map')).toBeVisible();
  await press(page, 'map-system-alpha-centauri');
  await expect(page.getByTestId('map-jump')).toBeEnabled();
  await press(page, 'map-jump');
  await waitUntil(page, 'arrived in Alpha Centauri', async () => (await mode(page)) === 'flight' && (await state(page)).location.systemId === 'alpha-centauri', 60_000);

  // Back at a dock: the journal's Logbook.
  await api(page, 'dockAt', 'earth-port');
  await waitUntil(page, 'docked again', async () => (await state(page)).location.dockedAt === 'earth-port');
  await press(page, 'station-journal');
  const short = page.getByTestId('journal-logbook');
  await short.scrollIntoViewIfNeeded();
  await expect(short).toContainText('First arrival in Alpha Centauri.');
  await expect(short).toContainText('First scan of 2P/Encke.');
  await expect(short).toContainText('Longest jump');
  await press(page, 'logbook-open');

  // The logbook: every entry, newest first, filtered by kind.
  const book = page.getByTestId('logbook');
  await expect(book).toBeVisible();
  await expect(book.getByTestId('logbook-bests')).toContainText('Systems visited');
  const entries = book.getByTestId('logbook-entry');
  await expect(entries.first()).toContainText('First arrival in Alpha Centauri.');
  await expect(entries.last()).toContainText('Signed on at');
  await press(page, 'logbook-filter-sky');
  await expect(entries).toHaveCount(1);
  await expect(entries.first()).toContainText('First scan of 2P/Encke.');
  await press(page, 'logbook-filter-places');
  await expect(entries.first()).toContainText('First arrival in Alpha Centauri.');
  await expect(book.locator('[data-kind="comet"]')).toHaveCount(0);
  await press(page, 'logbook-filter-all');
  await press(page, 'sheet-close');
  await expect(book).toBeHidden();
});
