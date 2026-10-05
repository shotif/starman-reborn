import { expect, test, type Page } from '@playwright/test';
import { api, openFresh, press, waitUntil } from './helpers.ts';

/**
 * Ranks that open doors (docs/PROCGEN.md §32): standing and a record earn the Transit Authority's
 * first rank at the next of its docks, with a card saying what it opens; the deck names it, the News
 * tells it; a commission on its board is open to the rank and taken; its yard takes its discount off;
 * a higher rank comes with more, and falls a step when standing drops; and the Wake gives its own
 * rank at a den.
 */

interface Ranks {
  held: Record<string, number>;
  records: Record<string, { rank: number; fell?: true }>;
  limit: number;
}

interface S {
  clock: number;
  jobs: Record<string, { status: string }>;
}

/** Clicks through whatever story is told, until nothing more comes for a moment. */
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

/** Standing with a faction (the hook takes two arguments, so it is called directly). */
async function setStanding(page: Page, faction: string, value: number): Promise<void> {
  await page.evaluate(([f, v]) => (window as unknown as { __starman: { setReputation(f: string, v: number): void } }).__starman.setReputation(f as string, v as number), [faction, value] as const);
}

async function openWindow(page: Page, room: string, action: string, windowId: string): Promise<void> {
  await press(page, room);
  if (!(await page.getByTestId(windowId).isVisible().catch(() => false))) await press(page, action);
  await expect(page.getByTestId(windowId)).toBeVisible();
}

test('ranks: promoted at a dock of theirs, the deck and the News, a commission taken, a yard discount, a fall, and the Wake’s own', async ({ page }) => {
  test.setTimeout(240_000);
  await openFresh(page);
  await press(page, 'title-play');
  await press(page, 'intro-ok');
  await api(page, 'completeJobs', ['lifeline']);
  await api(page, 'setCredits', 200_000);

  // Standing with the Authority and three raiders downed: a Bonded Carrier at the next Authority dock.
  await setStanding(page, 'sta', 16);
  await api(page, 'setRecord', { kills: 3 });
  const s = await api<S>(page, 'state');
  const work = (await api<{ id: string; title: string; at: number } | null>(page, 'findCommission', { at: 'earth-port', from: s.clock, rank: 1 }))!;
  expect(work, 'a commission at Halcyon Ring').not.toBeNull();
  await api(page, 'advanceClock', work.at + 60 - s.clock);
  await dockAt(page, 'earth-port');
  const card = page.getByTestId('rank-dialog');
  await expect(card).toBeVisible();
  await expect(card).toContainText('Bonded Carrier of the Sol Transit Authority');
  await expect(page.getByTestId('rank-perks')).toContainText('4% off ships and equipment at their yards');
  await expect(card).toContainText('Fiction: the factions, their ranks and ceremonies are invented for this game.');
  await press(page, 'rank-continue');
  await expect(card).toBeHidden();
  expect((await api<Ranks>(page, 'ranks')).held.sta).toBe(1);
  await expect(page.getByTestId('dock-rank')).toContainText('Bonded Carrier');

  // The News tells it; the board's commission is open to the rank, and taken.
  await openWindow(page, 'room-bar', 'station-news', 'news-window');
  await expect(page.getByTestId('rank-news-sta')).toContainText('names a new Bonded Carrier');
  await openWindow(page, 'room-bar', 'station-jobs', 'jobs-window');
  const job = page.getByTestId(`job-${work.id}`);
  await expect(job.getByTestId('rank-tag')).toContainText('Bonded Carrier and up');
  // Opened, its Accept button shows.
  if (!(await page.getByTestId(`accept-${work.id}`).isVisible().catch(() => false))) await job.locator('.job-head').click();
  await press(page, `accept-${work.id}`);
  await waitUntil(page, 'the commission taken', async () => (await api<S>(page, 'state')).jobs[work.id]?.status === 'active', 10_000);

  // The Authority's yard takes the rank's discount off.
  await press(page, 'room-deck');
  await press(page, 'station-ships');
  await expect(page.getByTestId('yard-discount')).toContainText('Bonded Carrier of the Sol Transit Authority: 4% off ships and equipment here.');

  // More standing and a harder record: a Lane Officer at Deimos Depot.
  await setStanding(page, 'sta', 41);
  await api(page, 'setRecord', { kills: 25 });
  await dockAt(page, 'mars-depot');
  await expect(card).toContainText('Lane Officer');
  await expect(page.getByTestId('rank-perks')).toContainText('Their docks clear you in even with raiders near');
  await press(page, 'rank-continue');

  // Standing falls more than ten below what earned it: the rank falls a step at the next dock.
  await setStanding(page, 'sta', 25);
  await dockAt(page, 'earth-port');
  await expect(page.getByText('The Sol Transit Authority no longer counts you a Lane Officer. You are a Bonded Carrier.')).toBeVisible();
  expect((await api<Ranks>(page, 'ranks')).records.sta).toMatchObject({ rank: 1, fell: true });

  // The Wake gives its own rank, at a den that takes the pilot in.
  await setStanding(page, 'hollow-wake', 21);
  const den = (await api<string | null>(page, 'den'))!;
  await dockAt(page, den);
  await expect(card).toContainText('Cold Hand of the Hollow Wake');
  await press(page, 'rank-continue');
  expect((await api<Ranks>(page, 'ranks')).held['hollow-wake']).toBe(1);
});
