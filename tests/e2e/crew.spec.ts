import { expect, test, type Page } from '@playwright/test';
import { api, openFresh, press, waitUntil } from './helpers.ts';

/**
 * Your crew (docs/PROCGEN.md §30): a soft-hearted engineer signed on at a bar's table mends the
 * ship's damaged engines in flight; hurt, they are treated at the next dock; two rescues bring their
 * story, an hour on their favour, a letter carried brings them a grade; a reload keeps them; and,
 * unhappy, they give notice at a dock and leave at the next.
 */

interface Member {
  id: string;
  name: string;
  role: string;
  grade: number;
  morale: number;
  hurt?: { until: number };
  notice?: number;
  story?: { told?: number; favour?: { to: string; job?: string }; ended?: { how: string } };
}
interface CrewNow {
  members: Member[];
  effects: { mend: number };
  former: { name: string; why: string }[];
  systems: { engines: number; guns: number; shields: number };
}
interface Hand {
  locationId: string;
  offerId: string;
  name: string;
  heart: string;
  grade: number;
}

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

/** Docks at a station (`after` seconds of clock on), and hears out whatever is said. */
async function dockAt(page: Page, id: string, after = 0): Promise<void> {
  if (after) await api(page, 'advanceClock', after);
  await api(page, 'dockAt', id);
  await waitUntil(page, `docked at ${id}`, async () => (await api<{ location: { dockedAt: string | null } }>(page, 'state')).location.dockedAt === id);
  await hearOut(page);
}

async function openPeople(page: Page): Promise<void> {
  await press(page, 'room-bar');
  if (!(await page.getByTestId('people-window').isVisible().catch(() => false))) await press(page, 'station-people');
  await expect(page.getByTestId('people-window')).toBeVisible();
}

/** Closes a discovery card if one is up (it pauses the flight). */
async function dismissDiscovery(page: Page): Promise<void> {
  const ok = page.getByTestId('discovery-ok').last();
  if (await ok.isVisible().catch(() => false)) await ok.click({ timeout: 2_000 }).catch(() => {});
}

const crew = (page: Page) => api<CrewNow>(page, 'crew');

test('your crew: an engineer signed on mends the ship in flight, is hurt and treated; their story, a favour and a grade; unhappy, they leave', async ({ page }) => {
  await openFresh(page);
  await press(page, 'title-play');
  await press(page, 'intro-ok');
  await api(page, 'completeJobs', ['lifeline']);
  await api(page, 'setCredits', 20_000);

  // A soft-hearted engineer looking for a berth: sit down, hear their terms, sign them on.
  const hand = (await api<Hand | null>(page, 'findCrew', { role: 'engineer', heart: 'soft-hearted' }))!;
  expect(hand).not.toBeNull();
  await dockAt(page, hand.locationId);
  await openPeople(page);
  await press(page, `hand-${hand.offerId}`);
  await expect(page.getByTestId('hand-dialog')).toContainText('Mends damaged systems in flight');
  await expect(page.getByTestId('hand-terms')).toContainText('crew quarters for 2');
  await press(page, 'hand-hire');
  await expect(page.getByTestId('crew-engineer')).toBeVisible();
  const [m] = (await crew(page)).members;
  expect(m).toMatchObject({ id: hand.offerId, name: hand.name, role: 'engineer' });
  await press(page, 'room-deck');
  await expect(page.getByTestId('ship-crew')).toContainText('1 aboard');

  // In flight with damaged engines: the engineer mends them while no hostile is near.
  await api(page, 'setCombat', { systems: { engines: 0.6, guns: 0, shields: 0 } });
  await press(page, 'dock-launch');
  await waitUntil(page, 'in flight', async () => (await api(page, 'mode')) === 'flight', 60_000);
  if (await page.getByTestId('sheet-close').isVisible().catch(() => false)) await press(page, 'sheet-close');
  await waitUntil(page, 'undocked', async () => (await dismissDiscovery(page), (await api<{ autopilot: string } | null>(page, 'player'))?.autopilot === 'none'), 60_000);
  await waitUntil(page, 'mending', async () => (await dismissDiscovery(page), (await crew(page)).systems.engines < 0.595), 60_000);
  await expect(page.locator('.hud-warning')).toContainText('(mending)');

  // A hit hurts them: out of action until treated at the next dock.
  await api(page, 'hurtCrew', 'engineer');
  expect((await crew(page)).effects.mend).toBe(0);
  await dockAt(page, hand.locationId, 600);
  await press(page, 'room-deck');
  await press(page, 'dock-treat-crew');
  await waitUntil(page, 'treated', async () => !(await crew(page)).members[0]!.hurt);

  // Two rescues: their story at the next dock; an hour on, their favour, a letter to carry.
  await api(page, 'crewDeed', { deed: 'rescue', n: 2 });
  await dockAt(page, hand.locationId, 600);
  expect((await crew(page)).members[0]!.story?.told).toBeDefined();
  await dockAt(page, hand.locationId, 3_700);
  const favour = (await crew(page)).members[0]!.story!.favour!;
  expect(favour).toBeDefined();
  await openPeople(page);
  await press(page, 'crew-engineer');
  await expect(page.getByTestId('crew-favour')).toBeVisible();
  await press(page, 'crew-favour-take');
  await waitUntil(page, 'favour taken', async () => !!(await crew(page)).members[0]!.story?.favour?.job);
  await press(page, 'crew-close');
  const grade = (await crew(page)).members[0]!.grade;
  await dockAt(page, favour.to, 900);
  await waitUntil(page, 'favour done', async () => (await crew(page)).members[0]!.story?.ended?.how === 'done');
  expect((await crew(page)).members[0]!.grade).toBe(Math.min(3, grade + 1));
  await press(page, 'room-bar');
  if (!(await page.getByTestId('journal').isVisible().catch(() => false))) await press(page, 'station-journal');
  await expect(page.getByTestId('crew-record')).toContainText('their favour done');

  // A reload keeps them aboard.
  await api(page, 'flush');
  await page.reload();
  await press(page, 'title-continue');
  await expect(page.getByTestId('dock-screen')).toBeVisible();
  expect((await crew(page)).members).toHaveLength(1);

  // Unhappy: notice at one dock, gone at the next.
  await api(page, 'setCrew', { role: 'engineer', morale: 10 });
  await dockAt(page, favour.to, 600);
  await openPeople(page);
  await expect(page.getByTestId('crew-tag-engineer-notice')).toBeVisible();
  await dockAt(page, favour.to, 600);
  await waitUntil(page, 'gone', async () => (await crew(page)).members.length === 0);
  expect((await crew(page)).former.at(-1)).toMatchObject({ name: hand.name, why: 'unhappy' });
});
