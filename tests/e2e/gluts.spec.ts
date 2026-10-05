import { expect, test, type Page } from '@playwright/test';
import { api, isTouch, openFresh, press, waitUntil } from './helpers.ts';

/**
 * Gluts that ship out (docs/PROCGEN.md §21.6–21.7): the News at a station with a glut lists the
 * shipments loading its surplus; and a relief hauler (or a shipment) bound through a raid is posted
 * for an escort at its sender's bar, taken on, and sets off with the player, under its own name.
 */

interface GlutState {
  clock: number;
  location: { dockedAt: string | null; systemId: string };
  jobs: Record<string, { status: string } | undefined>;
  world: { hauls?: Record<string, { fate: string } | undefined> };
}

interface Found {
  eventId: string;
  start: number;
  haul: { id: string; name: string; to: string; toName: string; depart: number; qty: number };
}

interface ShipInfo {
  name: string;
  escort: string | null;
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

async function dockAt(page: Page, id: string): Promise<void> {
  await api(page, 'dockAt', id);
  await waitUntil(page, `docked at ${id}`, async () => (await api<GlutState>(page, 'state')).location.dockedAt === id);
  await hearOut(page);
}

/** Closes a discovery card if one is up (it pauses the flight); a new system may bring several, the newest on top. */
async function dismissDiscovery(page: Page): Promise<void> {
  const ok = page.getByTestId('discovery-ok').last();
  if (await ok.isVisible().catch(() => false)) await ok.click({ timeout: 2_000 }).catch(() => {});
}

async function openWindow(page: Page, room: string, action: string, windowId: string): Promise<void> {
  await press(page, room);
  if (!(await page.getByTestId(windowId).isVisible().catch(() => false))) await press(page, action);
  await expect(page.getByTestId(windowId)).toBeVisible();
}

test('a glut ships its surplus out in the News, and a hauler bound through a raid sets off with its escort', async ({ page }) => {
  await openFresh(page);
  await press(page, 'title-play');
  await press(page, 'intro-ok');
  await api(page, 'completeJobs', ['lifeline']);
  await api(page, 'setCredits', 50_000);
  // Standing enough for any escort's terms.
  await page.evaluate(() => {
    const hooks = (window as unknown as { __starman: { setReputation(f: string, v: number): void } }).__starman;
    for (const f of ['sta', 'frontier']) hooks.setReputation(f, 40);
  });
  const touch = await isTouch(page);

  // A glut: a minute after it starts, the News at its station lists the shipments loading.
  let s = await api<GlutState>(page, 'state');
  const glut = (await api<Found & { at: string; commodity: string } | null>(page, 'findGlut', s.clock + 600))!;
  expect(glut, 'a glut that ships out').not.toBeNull();
  await api(page, 'advanceClock', glut.start + 60 - s.clock);
  await dockAt(page, glut.at);
  await openWindow(page, 'room-bar', 'station-news', 'news-window');
  const shipping = page.getByTestId(`shipments-${glut.eventId}`);
  await expect(shipping).toContainText('Shipping out:');
  await expect(shipping).toContainText(`${glut.haul.name} is loading ${glut.haul.qty}`);
  await expect(shipping).toContainText(`for ${glut.haul.toName}`);

  // A hauler bound through a raid: its sender's bar posts an escort for it, under its own name.
  s = await api<GlutState>(page, 'state');
  const esc = (await api<Found & { giver: string; at: number } | null>(page, 'findReliefEscort', s.clock + 600))!;
  expect(esc, 'a haul through a raid').not.toBeNull();
  await api(page, 'advanceClock', esc.at - s.clock);
  await dockAt(page, esc.giver);
  await openWindow(page, 'room-bar', 'station-jobs', 'jobs-window');
  const card = page.locator(`[data-testid^="job-c.${esc.giver}."][data-testid*=".escort-"]`, { hasText: esc.haul.name });
  await expect(card).toContainText(`Escort the ${esc.haul.name} to ${esc.haul.toName}`);
  const id = (await card.getAttribute('data-testid'))!.slice('job-'.length);
  const head = card.locator('.job-head');
  if (touch) await head.tap();
  else await head.click();
  await press(page, `accept-${id}`);
  s = await api<GlutState>(page, 'state');
  expect(s.jobs[id]?.status).toBe('active');
  // The haul waits for the pilot, off its timetable.
  expect(s.world.hauls?.[esc.haul.id]?.fate).toBe('escort');

  // Launched, the hauler sets off with the player, named as the haul.
  await press(page, 'dock-launch');
  if (await page.getByTestId('controls-sheet').isVisible().catch(() => false)) await press(page, 'sheet-close');
  // A new system's bodies may bring discovery cards, which pause the flight.
  await waitUntil(page, 'undocked', async () => (await dismissDiscovery(page), (await api<{ autopilot: string } | null>(page, 'player'))?.autopilot === 'none'), 60_000);
  await waitUntil(page, 'the hauler alongside', async () => (await dismissDiscovery(page), (await api<ShipInfo[]>(page, 'npcs')).some((n) => n.escort === id && n.name === esc.haul.name)), 60_000);
  await expect(page.getByTestId('hud-objective')).toContainText(`Escort the ${esc.haul.name} to ${esc.haul.toName}`);
});
