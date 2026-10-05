import { expect, test, type Page } from '@playwright/test';
import { api, openFresh, press, waitUntil } from './helpers.ts';

/**
 * Defending your outpost (docs/PROCGEN.md §29): at Lalande 21185 the outpost's frame goes up and
 * a turret is built from hauled materials; a guard is hired by the hour; the watch sees the first
 * raid coming (a job to defend it, the odds in the Outpost window); out in flight the raiders
 * strike at its time, the turret and the guard by it, and downed to the last, the raid is held.
 */

interface Plan {
  window: number;
  at: number;
  warnAt: number;
  ships: number;
  probe: boolean;
}
interface RaidNow {
  next: Plan | null;
  warned: number | null;
  raids: { window: number; result: string; where: string }[];
  turrets: number;
  flight: { window: number; state: string; downed: number } | null;
}
interface S {
  clock: number;
  credits: number;
  jobs: Record<string, { status: string } | undefined>;
  world: { outposts?: { stage: number; defence?: { guards: { id: string }[] } }[] };
}

const DOCK = 'wayfarer-array';
const PLANET = 'gj-411-b';
const OUTPOST = `outpost.${PLANET}`;

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

async function dockAt(page: Page, id: string): Promise<void> {
  await api(page, 'dockAt', id);
  await waitUntil(page, `docked at ${id}`, async () => (await api<{ location: { dockedAt: string | null } }>(page, 'state')).location.dockedAt === id);
  await hearOut(page);
}

/** Closes a discovery card if one is up (it pauses the flight); several may come, the newest on top. */
async function dismissDiscovery(page: Page): Promise<void> {
  const ok = page.getByTestId('discovery-ok').last();
  if (await ok.isVisible().catch(() => false)) await ok.click({ timeout: 2_000 }).catch(() => {});
}

async function openDeckWindow(page: Page, button: string, content: string): Promise<void> {
  await press(page, 'room-deck');
  if (!(await page.getByTestId(content).isVisible().catch(() => false))) await press(page, button);
  await expect(page.getByTestId(content)).toBeVisible();
}

async function advanceTo(page: Page, clock: number): Promise<void> {
  const now = (await api<S>(page, 'state')).clock;
  await api(page, 'advanceClock', Math.max(0, clock - now));
}

test('defending your outpost: a turret built, a guard hired, the first raid seen coming, fought off in flight', async ({ page }) => {
  await openFresh(page);
  await press(page, 'title-play');
  await press(page, 'intro-ok');
  // The save's luck decides when raids strike; with an unlucky one (about one in twenty) a sweep
  // falls on the first window and none is due yet. This one brings the probe in the first window.
  await api(page, 'setSeed', 2);
  await api(page, 'completeJobs', ['lifeline']);
  await api(page, 'setCredits', 50_000);

  // Chartered at Wayfarer Array; its frame's materials handed over at the site: it opens.
  await dockAt(page, DOCK);
  await openDeckWindow(page, 'station-fleet', 'fleet');
  await press(page, `outpost-charter-${PLANET}`);
  await expect(page.getByTestId('outpost-charter-dialog')).toContainText('raiders will come for the outpost itself');
  await press(page, 'outpost-charter-confirm');
  await dockAt(page, OUTPOST);
  await api(page, 'setCargo', { 'habitat-modules': 8, metals: 20, machinery: 6 });
  await openDeckWindow(page, 'station-outpost', 'outpost-window');
  for (const good of ['habitat-modules', 'metals', 'machinery']) await press(page, `outpost-deliver-${good}`);
  await waitUntil(page, 'the outpost open', async () => (await api<S>(page, 'state')).world.outposts?.[0]?.stage === 1);

  // Its defences: a turret built from the materials brought, and a guard hired for a few hours.
  await openDeckWindow(page, 'station-outpost', 'outpost-window');
  await expect(page.getByTestId('outpost-defences')).toContainText('0/1 built');
  await api(page, 'setCargo', { 'ship-parts': 4, machinery: 2, electronics: 3 });
  await openDeckWindow(page, 'station-outpost', 'outpost-window');
  for (const good of ['ship-parts', 'machinery', 'electronics']) await press(page, `outpost-turret-deliver-${good}`);
  await expect(page.getByTestId('outpost-turret-0')).toContainText('Up');
  await expect(page.getByTestId('outpost-defences')).toContainText('1/1 built');
  await press(page, 'outpost-hire-guards');
  await expect(page.getByTestId('guard-hire-dialog')).toBeVisible();
  await page.getByTestId('guard-term').selectOption('8');
  const before = (await api<S>(page, 'state')).credits;
  await press(page, 'guard-confirm');
  await waitUntil(page, 'a guard hired', async () => ((await api<S>(page, 'state')).world.outposts?.[0]?.defence?.guards.length ?? 0) === 1);
  expect((await api<S>(page, 'state')).credits).toBeLessThan(before);

  // The watch sees the first raid coming: a probe, a job to defend the outpost, the odds in its window.
  const raid = (await api<RaidNow>(page, 'outpostRaid'))!;
  expect(raid.next).not.toBeNull();
  expect(raid.next!.probe).toBe(true);
  await advanceTo(page, raid.next!.warnAt + 5);
  await waitUntil(page, 'warned', async () => (await api<RaidNow>(page, 'outpostRaid'))!.warned === raid.next!.window);
  const job = `op.${PLANET}.${raid.next!.window}`;
  expect((await api<S>(page, 'state')).jobs[job]?.status).toBe('active');
  expect((await api<string[]>(page, 'comms')).some((c) => /raider is sniffing round the station/.test(c))).toBe(true);
  await openDeckWindow(page, 'station-outpost', 'outpost-window');
  await expect(page.getByTestId('outpost-raid-watch')).toContainText('Raiders expected in about');

  // Out in flight by the outpost: the turret and the guard stand by it; the raiders strike at their time.
  await press(page, 'dock-launch');
  await waitUntil(page, 'in flight', async () => (await api(page, 'mode')) === 'flight', 60_000);
  if (await page.getByTestId('sheet-close').isVisible().catch(() => false)) await press(page, 'sheet-close');
  // The outpost's planet may bring a discovery card, which pauses the flight.
  await waitUntil(page, 'undocked', async () => (await dismissDiscovery(page), (await api<{ autopilot: string } | null>(page, 'player'))?.autopilot === 'none'), 60_000);
  await waitUntil(page, 'the defences out', async () => (await dismissDiscovery(page), (await api<{ own: string | null }[]>(page, 'npcs')).filter((n) => n.own).length >= 2), 60_000);
  expect((await api<{ own: string | null; name: string }[]>(page, 'npcs')).filter((n) => n.own).map((n) => n.own).sort()).toEqual(['guard', 'turret']);
  await expect(page.getByTestId('hud-objective')).toContainText('Defend');
  await advanceTo(page, raid.next!.at - 2);
  await waitUntil(page, 'the raid struck', async () => (await dismissDiscovery(page), (await api<RaidNow>(page, 'outpostRaid'))!.flight?.state === 'on'), 60_000);
  const raiders = (await api<{ id: string; outpostRaid: number | null }[]>(page, 'npcs')).filter((n) => n.outpostRaid === raid.next!.window);
  expect(raiders).toHaveLength(raid.next!.ships);

  // Downed to the last: the raid is held, with the player there, and the job done.
  for (const r of raiders) await api(page, 'destroyNpc', { id: r.id, byPlayer: true });
  await waitUntil(page, 'held', async () => (await dismissDiscovery(page), (await api<RaidNow>(page, 'outpostRaid'))!.raids.some((x) => x.window === raid.next!.window)), 60_000);
  const after = (await api<RaidNow>(page, 'outpostRaid'))!;
  expect(after.raids.at(-1)).toMatchObject({ window: raid.next!.window, result: 'held', where: 'flight' });
  expect((await api<S>(page, 'state')).jobs[job]?.status).toBe('complete');
  expect((await api<string[]>(page, 'comms')).some((c) => /We held!|Stores are safe/.test(c))).toBe(true);
});
