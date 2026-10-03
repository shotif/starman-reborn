import { expect, test, type Page } from '@playwright/test';
import { api, isTouch, openFresh, press, waitUntil } from './helpers.ts';

/**
 * Wrecks to fly to (docs/PROCGEN.md §31): a wreck beacon's hail answered and the wreck marked on the
 * HUD; its log scanned from a little way off, the first log's lead followed; its pods tractored in
 * for their salvage; the trail flown to its find and its ending, and paid; an old beacon's derelict
 * boarded by holding steady alongside; and a planet's scan picking up a faint return, marked too.
 */

interface Offer {
  id: string;
  systemId: string;
  start: number;
  kind: string;
}

interface Sites {
  log: { sites: Record<string, { ended?: { how: string }; read?: true; boarded?: true }> } | null;
  flight: { id: string; kind: string; pods: number; boarding: number | null; ended: boolean }[];
}

interface Mystery {
  id: string;
  places: { find: string; end: string };
}

interface State {
  credits: number;
  clock: number;
  jobs: Record<string, { status: string }>;
}

/** A discovery card in the way (scanning in a system with exoplanets) is put away. */
async function dismissDiscovery(page: Page): Promise<void> {
  const ok = page.getByTestId('discovery-ok').last();
  if (await ok.isVisible().catch(() => false)) await ok.click().catch(() => {});
}

/** Presses a button that a discovery card (a planet nearby, scanned as the ship passes) may come up over: the card put away, it is pressed again. */
async function pressPast(page: Page, testId: string): Promise<void> {
  const touch = await isTouch(page);
  for (let i = 0; i < 10; i++) {
    await dismissDiscovery(page);
    const el = page.getByTestId(testId);
    try {
      if (touch) await el.tap({ timeout: 3_000 });
      else await el.click({ timeout: 3_000 });
      return;
    } catch {
      // A card came up over it: put it away and press again.
    }
  }
  throw new Error(`${testId} could not be pressed`);
}

/** Into the encounter's system at its slot, flying, until it hails; then its card, and Mark it and go. */
async function goTo(page: Page, o: Offer): Promise<string> {
  const s = await api<State>(page, 'state');
  await api(page, 'advanceClock', o.start + 5 - s.clock);
  await api(page, 'warp', o.systemId);
  await waitUntil(page, 'in flight', async () => (await api(page, 'mode')) === 'flight');
  if (await page.getByTestId('sheet-close').isVisible().catch(() => false)) await press(page, 'sheet-close');
  await waitUntil(page, `${o.kind} hails`, async () => (await dismissDiscovery(page), (await api<{ hail: { id: string } | null }>(page, 'lanes')).hail?.id === o.id), 60_000);
  await press(page, (await isTouch(page)) ? 'touch-context' : 'hail-answer');
  await expect(page.getByTestId('lane-dialog')).toBeVisible();
  await press(page, 'lane-go');
  await expect(page.getByTestId('lane-dialog')).toBeHidden();
  const siteId = `lane.${o.id}`;
  await waitUntil(page, 'the site in the scene', async () => (await api<Sites>(page, 'sites')).flight.some((x) => x.id === siteId), 20_000);
  return siteId;
}

test('wrecks: a wreck salvaged, its trail followed and paid, a derelict boarded, a scan’s find', async ({ page }) => {
  test.setTimeout(300_000);
  await openFresh(page);
  await press(page, 'title-play');
  await press(page, 'intro-ok');
  await api(page, 'completeJobs', ['lifeline']);
  // Hails and scan finds are off in browser tests unless one wants them.
  await api(page, 'meetLanes', true);
  const touch = await isTouch(page);
  const context = touch ? 'touch-context' : 'hud-context';

  // A wreck beacon (secure space: nobody picks it over): marked and on the HUD.
  let s = await api<State>(page, 'state');
  const wreck = (await api<Offer | null>(page, 'findLane', { from: s.clock + 600, kind: 'wreck', trap: false, quiet: true }))!;
  const siteId = await goTo(page, wreck);
  const target = `site:${siteId}`;
  await expect(page.getByTestId('hud-objective')).toContainText('Salvage the wreck of the');

  // From a little way off, its log scanned: the first log holds a lead, followed.
  expect(await api(page, 'placeNear', { id: target, distance: 900 })).toBe(true);
  await api(page, 'selectTarget', target);
  await waitUntil(page, 'Scan on the action', async () => (await api<{ context: { label: string } | null } | null>(page, 'hud'))?.context?.label === 'Scan', 10_000);
  await press(page, context);
  const card = page.getByTestId('site-dialog');
  await expect(card).toBeVisible();
  await expect(card).toContainText('Fiction: wrecks, derelicts, their ships, people and logs are invented for this game.');
  await expect(page.getByTestId('site-lead')).toBeVisible();
  expect(await api<boolean>(page, 'paused')).toBe(true);
  await press(page, 'site-follow');
  await expect(card).toBeHidden();
  const mystery = (await api<Mystery | null>(page, 'mystery'))!;
  expect(mystery).not.toBeNull();

  // Flown in close, its pods come in on the tractor, and it is done.
  const before = (await api<State>(page, 'state')).credits;
  await api(page, 'placeNear', { id: target, distance: 20 });
  await waitUntil(page, 'the wreck salvaged', async () => (await api<Sites>(page, 'sites')).log?.sites[siteId]?.ended?.how === 'done', 30_000);
  expect((await api<State>(page, 'state')).credits).toBeGreaterThan(before);
  expect((await api<State>(page, 'state')).jobs[`c.lane.${wreck.id}`]?.status).toBe('complete');

  // The trail: its find tractored in where it leads, then its ending docked at, and paid.
  await api(page, 'warp', mystery.places.find);
  await waitUntil(page, 'in flight at the find', async () => (await api(page, 'mode')) === 'flight');
  const findId = `mys.${mystery.id}.1`;
  await waitUntil(page, 'the find in the scene', async () => (await dismissDiscovery(page), (await api<Sites>(page, 'sites')).flight.some((x) => x.id === findId)), 20_000);
  if (mystery.id === 'tender') {
    await api(page, 'placeNear', { id: `site:${findId}`, distance: 20 });
  } else {
    await api(page, 'placeNear', { id: `site:${findId}`, distance: 100 });
    await waitUntil(page, 'Board on the action', async () => (await dismissDiscovery(page), (await api<{ context: { label: string } | null } | null>(page, 'hud'))?.context?.label === 'Board'), 10_000);
    await pressPast(page, context);
  }
  await waitUntil(page, 'the find’s card', async () => (await dismissDiscovery(page), await card.isVisible()), 30_000);
  await press(page, 'site-close');
  const paid = (await api<State>(page, 'state')).credits;
  await api(page, 'dockAt', mystery.places.end);
  await waitUntil(page, 'the trail’s end', async () => (await api<State>(page, 'state')).jobs[`mys.${mystery.id}`]?.status === 'complete', 20_000);
  expect((await api<State>(page, 'state')).credits).toBeGreaterThan(paid);
  if (!(await page.getByTestId('journal').isVisible().catch(() => false))) await press(page, 'station-journal');
  await expect(page.getByTestId(`mystery-${mystery.id}`)).toBeVisible();
  await expect(page.getByTestId('wrecks-record')).toContainText('done');

  // An old beacon: the derelict boarded by holding steady alongside.
  s = await api<State>(page, 'state');
  const old = (await api<Offer | null>(page, 'findLane', { from: s.clock + 600, kind: 'derelict', trap: false, quiet: true }))!;
  const hulk = await goTo(page, old);
  await api(page, 'placeNear', { id: `site:${hulk}`, distance: 100 });
  await waitUntil(page, 'Board on the action', async () => (await dismissDiscovery(page), (await api<{ context: { label: string } | null } | null>(page, 'hud'))?.context?.label === 'Board'), 10_000);
  await api(page, 'setTimeScale', 4);
  await pressPast(page, context);
  await waitUntil(page, 'boarding', async () => (await dismissDiscovery(page), (await api<Sites>(page, 'sites')).flight.some((x) => x.id === hulk && (x.boarding !== null || x.ended))), 10_000);
  await waitUntil(page, 'the derelict’s card', async () => (await dismissDiscovery(page), await card.isVisible()), 30_000);
  await api(page, 'setTimeScale', 1);
  await expect(page.getByTestId('site-found')).toContainText('You find');
  await press(page, 'site-close');
  expect((await api<Sites>(page, 'sites')).log?.sites[hulk]?.boarded).toBe(true);

  // A scan of a planet or star in a slot holding a find: a faint return, marked.
  s = await api<State>(page, 'state');
  const find = (await api<{ id: string; systemId: string; at: number; kind: string } | null>(page, 'findScanFind', { from: s.clock + 600, kind: 'wreck', guard: false }))!;
  await api(page, 'advanceClock', find.at + 5 - s.clock);
  await api(page, 'warp', find.systemId);
  await waitUntil(page, 'in flight', async () => (await api(page, 'mode')) === 'flight');
  const body = (await api<{ id: string; kind: string }[]>(page, 'targets')).find((t) => t.kind === 'planet' || t.kind === 'star')!;
  await api(page, 'placeNear', { id: body.id, distance: 2_000 });
  await api(page, 'selectTarget', body.id);
  await waitUntil(page, 'Scan on the action', async () => (await dismissDiscovery(page), (await api<{ context: { label: string } | null } | null>(page, 'hud'))?.context?.label === 'Scan'), 10_000);
  await pressPast(page, context);
  await waitUntil(page, 'the find marked', async () => (await dismissDiscovery(page), (await api<Sites>(page, 'sites')).flight.some((x) => x.id === find.id)), 20_000);
  await expect(page.getByText('Your scan picked up a faint return near')).toBeVisible();
});
