import { expect, test, type Page } from '@playwright/test';
import { api, openFresh, press, waitUntil } from './helpers.ts';

/**
 * Rival pilots (docs/PROCGEN.md §24): a bounty hunter takes a bounty off a board as it sets off; the
 * board shows it taken, and the player buys the claim back and has the job again; the News says
 * what the hunter did; later the hunter sits in the bar where its run ended, thinks less of the
 * player for the claim, and warms up with a round; and out in flight the player meets a rival on
 * its way, named, with what it carries.
 */

interface Claim {
  rival: string;
  giver: string;
  contract: string;
  title: string;
  at: number;
}
interface RivalNow {
  where: 'docked' | 'flying' | 'jumping' | 'down';
  at: string | null;
  run: { id: string; kind: string; from: string; to: string; depart: number; arrive: number; legs: { systemId: string; kind: string; start: number; end: number }[] } | null;
}
interface RivalState {
  clock: number;
  credits: number;
  rivals?: Record<string, { standing: number }>;
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
  await waitUntil(page, `docked at ${id}`, async () => (await api<{ location: { dockedAt: string | null } }>(page, 'state')).location.dockedAt === id);
  await hearOut(page);
}

async function openWindow(page: Page, room: string, action: string, windowId: string): Promise<void> {
  await press(page, room);
  if (!(await page.getByTestId(windowId).isVisible().catch(() => false))) await press(page, action);
  await expect(page.getByTestId(windowId)).toBeVisible();
}

async function advanceTo(page: Page, clock: number): Promise<void> {
  const now = (await api<RivalState>(page, 'state')).clock;
  await api(page, 'advanceClock', Math.max(0, clock - now));
}

test('rival pilots: a claim bought back from a hunter, the News, the hunter in a bar, and a rival met in flight', async ({ page }) => {
  await openFresh(page);
  await press(page, 'title-play');
  await press(page, 'intro-ok');
  await api(page, 'completeJobs', ['lifeline']);
  await api(page, 'setCredits', 20_000);

  // A hunter takes a bounty off a board as it sets off.
  const claim = (await api<Claim | null>(page, 'findRivalClaim', 7_200))!;
  expect(claim).not.toBeNull();
  await advanceTo(page, claim.at + 5);
  await dockAt(page, claim.giver);
  await openWindow(page, 'room-bar', 'station-jobs', 'jobs-window');
  const taken = page.getByTestId(`claim-${claim.contract}`);
  await expect(taken).toContainText(claim.title);
  await expect(taken).toContainText('Taken by');
  await expect(page.getByTestId(`job-${claim.contract}`)).toHaveCount(0);

  // Bought back, the job is on the board again, and the hunter thinks less of the player.
  const before = (await api<RivalState>(page, 'state')).credits;
  await press(page, `claim-buy-${claim.contract}`);
  await expect(page.getByTestId(`job-${claim.contract}`)).toBeVisible();
  await expect(page.getByTestId(`claim-${claim.contract}`)).toHaveCount(0);
  let s = await api<RivalState>(page, 'state');
  expect(s.credits).toBeLessThan(before);
  expect(s.rivals?.[claim.rival]?.standing).toBeLessThan(0);

  // The News says what the hunter did.
  await press(page, 'room-bar');
  if (!(await page.getByTestId('news-window').isVisible().catch(() => false))) await press(page, 'station-news');
  await expect(page.getByTestId('rival-news')).toContainText('took the bounty');

  // Where the hunter's run ends, it sits in the bar: wary of the player, warmer after a round.
  const hunter = (await api<RivalNow>(page, 'rival', claim.rival))!;
  expect(hunter.run).not.toBeNull();
  await advanceTo(page, hunter.run!.arrive + 5);
  await dockAt(page, hunter.run!.to);
  await openWindow(page, 'room-bar', 'station-people', 'people-window');
  const card = page.getByTestId(`rival-${claim.rival}`);
  await expect(card).toContainText('Rival');
  await expect(card).toContainText('Wary');
  await press(page, `rival-${claim.rival}`);
  await expect(page.getByTestId('rival-dialog')).toBeVisible();
  await expect(page.getByTestId('rival-speech')).not.toBeEmpty();
  await press(page, 'rival-drink');
  await expect(page.getByTestId('rival-standing')).toContainText('Neutral');
  s = await api<RivalState>(page, 'state');
  expect(s.rivals?.[claim.rival]?.standing).toBeGreaterThan(-5);
  await press(page, 'rival-close');

  // Out in flight: a trader rival on its way, named, with what it carries.
  // Its next leg into a dock (from the arrival point: the beacon is often close by, so a ship passing
  // through is soon gone), waiting a turn for one if need be.
  let leg: { systemId: string; kind: string; start: number; end: number } | undefined;
  for (let i = 0; i < 6 && !leg; i++) {
    const now = (await api<RivalState>(page, 'state')).clock;
    const trader = (await api<RivalNow>(page, 'rival', 'quickstep'))!;
    leg = trader.run?.legs.find((l) => l.kind === 'in' && l.start > now);
    if (!leg) await advanceTo(page, Math.max(now, trader.run?.arrive ?? now) + 1_800);
  }
  expect(leg).toBeDefined();
  if (!leg) return;
  await advanceTo(page, leg.start + (leg.end - leg.start) * 0.3);
  await api(page, 'warp', leg.systemId);
  await waitUntil(page, 'in flight', async () => (await api(page, 'mode')) === 'flight', 60_000);
  if (await page.getByTestId('controls-sheet').isVisible().catch(() => false)) await press(page, 'sheet-close');
  let rival: { id: string; name: string; subtitle: string } | undefined;
  await waitUntil(
    page,
    'the rival in the scene',
    async () => {
      rival = (await api<{ id: string; name: string; subtitle: string; rival: string | null }[]>(page, 'npcs')).find((n) => n.rival === 'quickstep');
      return !!rival;
    },
    60_000,
  );
  expect(rival!.name).toBe('Mara “Quickstep” Venn');
  expect(rival!.subtitle).toMatch(/^Rival · Merry Dancer · /);
  await api(page, 'selectTarget', `ship:${rival!.id}`);
  await expect(page.getByTestId('hud-target')).toContainText('Quickstep');
});
