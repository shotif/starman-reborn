import { expect, test, type Page } from '@playwright/test';
import { api, openFresh, press, waitUntil } from './helpers.ts';

/**
 * Haulers on the lanes (docs/PROCGEN.md §21): a shortage's relief in the News, the hauler itself in
 * flight with its name and cargo, and, robbed, its cargo adrift and the shortage left to run on.
 */

type Hooks = { __starman: { completeJobs(ids: string[]): void; dockAt(id: string): void; warp(id: string): void } };
interface Relief {
  eventId: string;
  at: string;
  haul: { id: string; name: string; from: string; fromName: string; to: string; path: string[]; depart: number; arrive: number; qty: number };
}
interface Npc {
  id: string;
  name: string;
  haul: string | null;
  subtitle: string;
}

/** Words as the News says them (the first of a list starts with a capital). */
const said = (text: string) => new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');

/** Clicks through whatever is said, until nothing more comes for a second. */
async function hearOut(page: Page): Promise<void> {
  const next = page.getByTestId('story-continue');
  for (let quiet = 0, i = 0; quiet < 3 && i < 40; i++) {
    if (await next.isVisible().catch(() => false)) {
      quiet = 0;
      await next.click().catch(() => {});
    } else quiet++;
    await page.waitForTimeout(300);
  }
}

async function dockAt(page: Page, id: string): Promise<void> {
  await page.evaluate((loc) => (window as unknown as Hooks).__starman.dockAt(loc), id);
  await waitUntil(page, `docked at ${id}`, async () => (await api<{ location: { dockedAt: string | null } }>(page, 'state')).location.dockedAt === id);
  await hearOut(page);
}

async function openNews(page: Page): Promise<void> {
  await press(page, 'room-bar');
  if (!(await page.getByTestId('news-window').isVisible().catch(() => false))) await press(page, 'station-news');
}

test('a shortage’s relief hauler: in the News, in flight with its cargo, and robbed, the shortage runs on', async ({ page }) => {
  await openFresh(page);
  await press(page, 'title-play');
  await press(page, 'intro-ok');
  await page.evaluate(() => (window as unknown as Hooks).__starman.completeJobs(['lifeline']));
  const clock = (await api<{ clock: number }>(page, 'state')).clock;
  const r = (await api<Relief | null>(page, 'findRelief', clock + 3_600))!;
  expect(r).not.toBeNull();
  // A little after the hauler sets off.
  await api(page, 'advanceClock', r.haul.depart + 40 - clock);

  // At the station that is short: the News names the hauler on its way, with what it brings.
  await dockAt(page, r.at);
  await openNews(page);
  await expect(page.getByTestId(`news-${r.eventId}`)).toBeVisible();
  await expect(page.getByTestId(`relief-${r.eventId}`)).toContainText(said(`the ${r.haul.name} is on its way from ${r.haul.fromName} with ${r.haul.qty} `));

  // In the system it sets off from, the hauler flies, named, with its cargo and where it is going.
  await page.evaluate((id) => (window as unknown as Hooks).__starman.warp(id), r.haul.path[0]!);
  await waitUntil(page, 'in flight', async () => (await api(page, 'mode')) === 'flight', 60_000);
  let ship: Npc | undefined;
  await waitUntil(page, 'the hauler in the lanes', async () => {
    ship = (await api<Npc[]>(page, 'npcs')).find((n) => n.haul === r.haul.id);
    return !!ship;
  }, 60_000);
  expect(ship!.subtitle).toContain(`The ${r.haul.name}`);
  expect(ship!.subtitle).toContain(`${r.haul.qty} `);
  const targets = await api<{ name: string; kind: string }[]>(page, 'targets');
  expect(targets.some((t) => t.name === `The ${r.haul.name}`)).toBe(true);

  // Robbed: destroyed by the player's guns, it spills its cargo, and the save remembers it lost.
  expect(await api<boolean>(page, 'destroyNpc', { id: ship!.id, byPlayer: true })).toBe(true);
  const s = await api<{ world: { hauls?: Record<string, { fate: string; by?: string }> } }>(page, 'state');
  expect(s.world.hauls?.[r.haul.id]).toMatchObject({ fate: 'lost', by: 'player' });
  await waitUntil(page, 'cargo adrift', async () => (await api<{ kind: string }[]>(page, 'targets')).some((t) => t.kind === 'loot'));

  // Back at the station that is short: its relief was lost, and the shortage runs on.
  await dockAt(page, r.at);
  await openNews(page);
  await expect(page.getByTestId(`relief-${r.eventId}`)).toContainText(said(`the ${r.haul.name} (${r.haul.qty} `));
  await expect(page.getByTestId(`relief-${r.eventId}`)).toContainText('was lost to a pirate');
  await expect(page.getByTestId(`news-${r.eventId}`)).not.toHaveClass(/over/);
});
