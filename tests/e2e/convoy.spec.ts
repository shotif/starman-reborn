import { expect, test, type Page } from '@playwright/test';
import { api, isTouch, openFresh, press, waitUntil } from './helpers.ts';

/**
 * Convoys across jumps (docs/PROCGEN.md §10.2, §20.5): The Long Border's truce finale flown in the
 * browser. The envoys set off with the player in Ross 154, keep with them, jump with them over the
 * line, and raiders are waiting for them at the Wolf 1061 beacon.
 */

type Hooks = { __starman: { completeJobs(ids: string[]): void; dockAt(id: string): void } };

interface ShipInfo {
  name: string;
  side: 'lawful' | 'raider';
  escort: string | null;
  following: boolean;
  prey: string | null;
  hull: number;
  distance: number;
}

const ENVOYS = ['Kettering Line II', 'Garrison cutter', 'Roost launch'];
const ships = (page: Page) => api<ShipInfo[]>(page, 'npcs');

async function openJobs(page: Page): Promise<void> {
  await press(page, 'room-bar');
  if (!(await page.getByTestId('jobs-window').isVisible().catch(() => false))) await press(page, 'station-jobs');
}

/** Clicks through whatever Kettering has to say, until nothing more comes for a second. */
async function hearOut(page: Page): Promise<void> {
  const next = page.getByTestId('story-continue');
  for (let quiet = 0, i = 0; quiet < 3 && i < 40; i++) {
    if (await next.isVisible().catch(() => false)) {
      quiet = 0;
      await next.click().catch(() => {});
    } else quiet++;
    await page.waitForTimeout(400);
  }
}

test('the truce envoys keep with you, cross the line with you, and are ambushed at the beacon', async ({ page }) => {
  await openFresh(page);
  await press(page, 'title-play');
  await press(page, 'intro-ok');
  await page.evaluate(() => (window as unknown as Hooks).__starman.completeJobs(['lifeline', 'arc.border.1', 'arc.border.2']));
  await page.evaluate(() => (window as unknown as Hooks).__starman.dockAt('waymark-waypoint'));
  await waitUntil(page, 'at Waymark Waypoint', async () => (await api<{ location: { dockedAt: string | null } }>(page, 'state')).location.dockedAt === 'waymark-waypoint');
  // Kettering recalls the steps already flown.
  await hearOut(page);

  // The truce: Kettering's letters, then the envoys.
  await openJobs(page);
  await press(page, 'accept-arc.border.3');
  await waitUntil(page, 'the choice', async () => {
    if (await page.getByTestId('choice-dialog').isVisible().catch(() => false)) return true;
    const next = page.getByTestId('story-continue');
    if (await next.isVisible().catch(() => false)) await next.click().catch(() => {});
    return false;
  }, 30_000);
  await press(page, 'choice-truce');
  await hearOut(page);
  await page.evaluate(() => (window as unknown as Hooks).__starman.completeJobs(['arc.border.4.truce']));
  await openJobs(page);
  await expect(page.getByTestId('job-arc.border.5.truce')).toContainText('Flotsam Diggings');
  await press(page, 'accept-arc.border.5.truce');
  await hearOut(page);

  // Launch: the three envoys keep with the player instead of heading for a dock.
  await press(page, 'dock-launch');
  if (await page.getByTestId('controls-sheet').isVisible().catch(() => false)) await press(page, 'sheet-close');
  await waitUntil(page, 'undocked', async () => (await api<{ autopilot: string } | null>(page, 'player'))?.autopilot === 'none', 60_000);
  await waitUntil(page, 'the envoys alongside', async () => (await ships(page)).filter((s) => s.escort === 'arc.border.5.truce').length === 3, 60_000);
  const before = (await ships(page)).filter((s) => s.escort === 'arc.border.5.truce');
  expect(before.map((s) => s.name)).toEqual(ENVOYS);
  expect(before.every((s) => s.following)).toBe(true);
  await expect(page.getByTestId('hud-objective')).toContainText('jump to Wolf 1061 with the convoy within 2.5 km');

  // Jump to Wolf 1061 from the map's Missions list, with the envoys close.
  await waitUntil(page, 'the envoys close', async () => (await ships(page)).filter((s) => s.escort).every((s) => s.distance < 2_000), 60_000);
  if (await isTouch(page)) await press(page, 'hud-map');
  else await page.keyboard.press('Tab');
  await expect(page.getByTestId('galaxy-map')).toBeVisible();
  await press(page, 'map-missions');
  await press(page, 'map-mission-wolf-1061');
  await expect(page.getByTestId('map-jump')).toBeEnabled();
  await press(page, 'map-jump');
  await expect(page.getByTestId('jump-overlay')).toContainText('Wolf 1061');
  await waitUntil(page, 'over the line', async () => (await api(page, 'mode')) === 'flight' && (await api<{ location: { systemId: string } }>(page, 'state')).location.systemId === 'wolf-1061', 60_000);
  const crossed = await api<{ jobs: Record<string, { status: string; escortAt?: string }> }>(page, 'state');
  expect(crossed.jobs['arc.border.5.truce']).toMatchObject({ status: 'active', escortAt: 'wolf-1061' });

  // Over the line: the envoys came through with the player, now bound for Flotsam Diggings, and
  // the raiders waiting at the beacon go for them.
  await waitUntil(page, 'the envoys through the jump', async () => (await ships(page)).filter((s) => s.escort === 'arc.border.5.truce').length === 3, 30_000);
  const after = (await ships(page)).filter((s) => s.escort === 'arc.border.5.truce');
  expect(after.every((s) => !s.following)).toBe(true);
  await waitUntil(page, 'the ambush at the beacon', async () => (await ships(page)).some((s) => s.side === 'raider' && s.prey !== null && ENVOYS.includes(s.prey)), 30_000);
  await expect(page.getByTestId('hud-objective')).toContainText('Escort the envoys across the line to Flotsam Diggings');
  await expect(page.getByTestId('hud-objective')).toContainText('2 of 3 must arrive');
});
