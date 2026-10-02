import { expect, test, type Page } from '@playwright/test';
import { api, openFresh, press, waitUntil } from './helpers.ts';

/**
 * Rival stories (docs/PROCGEN.md §28): a friend, known a while, asks for a loan at their table,
 * which comes back with interest when their next run docks; then asks the player to fly escort on
 * their next run, and once it is seen in is an ally who flies on the player's wing in their own
 * ship. An enemy, made hostile, calls the player out to a duel off a lawless beacon: it starts when
 * the player comes close, the wing holds its fire, and it ends when the rival yields.
 */

interface StoryNow {
  story: { path: string; began: number; loan?: { amount: number; repaid?: number }; ended?: { how: string } } | null;
  status: string | null;
  offer: { kind: string; lock: string | null } | null;
  holds: { kind: string; from: number; to: number | null; systemId: string | null }[];
  standing: number;
  duel: { jobId: string; rivalId: string; state: string } | null;
}
interface Docked {
  at: number;
  locationId: string;
  to: string;
}
interface S {
  clock: number;
  credits: number;
  crew: { id: string; ally?: string }[];
  jobs: Record<string, { status: string } | undefined>;
}
interface Npc {
  id: string;
  name: string;
  subtitle: string;
  rival: string | null;
  duel: string | null;
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

async function advanceTo(page: Page, clock: number): Promise<void> {
  const now = (await api<S>(page, 'state')).clock;
  await api(page, 'advanceClock', Math.max(0, clock - now));
}

const story = (page: Page, id: string) => api<StoryNow>(page, 'rivalStory', id);

/** Docks where a rival sits with a run of its own to fly next, and sits down at their table. */
async function sitWith(page: Page, id: string): Promise<Docked> {
  const now = (await api<S>(page, 'state')).clock;
  const d = (await api<Docked | null>(page, 'findRivalDocked', { id, from: now + 60 }))!;
  expect(d).not.toBeNull();
  await advanceTo(page, d.at);
  await api(page, 'dockAt', d.locationId);
  await waitUntil(page, `docked at ${d.locationId}`, async () => (await api<{ location: { dockedAt: string | null } }>(page, 'state')).location.dockedAt === d.locationId);
  await hearOut(page);
  await press(page, 'room-bar');
  if (!(await page.getByTestId('people-window').isVisible().catch(() => false))) await press(page, 'station-people');
  await press(page, `rival-${id}`);
  await expect(page.getByTestId('rival-dialog')).toBeVisible();
  return d;
}

test('rival stories: a friend’s loan, an escort and an ally on the wing; an enemy’s duel, fought until the rival yields', async ({ page }) => {
  await openFresh(page);
  await press(page, 'title-play');
  await press(page, 'intro-ok');
  await api(page, 'completeJobs', ['lifeline']);
  await api(page, 'setCredits', 20_000);
  await advanceTo(page, 4 * 3_600);

  // A friend, known a while: at their table, a loan.
  await api(page, 'setRival', { id: 'quickstep', standing: 20, metAgo: 7_200 });
  await sitWith(page, 'quickstep');
  const offer = page.getByTestId('rival-offer');
  await expect(offer).toHaveAttribute('data-kind', 'loan');
  await expect(offer).toContainText('1,500 cr');
  const before = (await api<S>(page, 'state')).credits;
  await press(page, 'rival-lend');
  await expect(page.getByTestId('rival-story-status')).toContainText('Owes you 1,800 cr');
  await expect(offer).toHaveCount(0);
  expect((await api<S>(page, 'state')).credits).toBe(before - 1_500);
  await press(page, 'rival-close');

  // It comes back with interest when their next run docks.
  for (let i = 0; i < 16 && (await story(page, 'quickstep')).story?.loan?.repaid === undefined; i++) await api(page, 'advanceClock', 900);
  expect((await story(page, 'quickstep')).story?.loan?.repaid).toBeDefined();
  expect((await api<S>(page, 'state')).credits).toBe(before + 300);
  expect(await api<string[]>(page, 'comms')).toContain('Told you I was good for it. 1,800 cr, with my thanks.');

  // Then: fly escort on their next run.
  const there = await sitWith(page, 'quickstep');
  await expect(offer).toHaveAttribute('data-kind', 'escort');
  await press(page, 'rival-escort');
  await expect(page.getByTestId('rival-dialog')).toBeHidden();
  expect((await api<S>(page, 'state')).jobs['rs.quickstep.escort']?.status).toBe('active');
  expect((await story(page, 'quickstep')).holds.map((h) => h.kind)).toEqual(['escort']);
  // Waiting at their ship: out of the bar.
  await expect(page.getByTestId('rival-quickstep')).toHaveCount(0);
  await press(page, 'station-journal');
  await expect(page.getByTestId('rivals-record')).toContainText('Waiting for you to fly escort to');

  // Seen in (as the escort tests fly it), they are a friend, and fly on the wing when asked.
  await api(page, 'completeJobs', ['rs.quickstep.escort']);
  await api(page, 'advanceClock', 60);
  let q = await story(page, 'quickstep');
  expect(q.story?.ended?.how).toBe('friends');
  expect(q.standing).toBe(45);
  await sitWith(page, 'quickstep');
  await expect(offer).toHaveAttribute('data-kind', 'ally');
  await press(page, 'rival-ally');
  await expect(page.getByTestId('rival-offer-lock')).toContainText('on your wing');
  await press(page, 'rival-close');
  expect((await api<S>(page, 'state')).crew).toEqual([expect.objectContaining({ id: 'ally.quickstep', ally: 'quickstep' })]);
  await expect(page.getByTestId('your-wing')).toContainText('Your ally');
  expect(there.locationId).toBeTruthy();

  // Out in flight, the ally keeps station on the wing in their own ship.
  await press(page, 'dock-launch');
  await waitUntil(page, 'in flight', async () => (await api(page, 'mode')) === 'flight', 60_000);
  if (await page.getByTestId('sheet-close').isVisible().catch(() => false)) await press(page, 'sheet-close');
  await waitUntil(page, 'the ally on the wing', async () => (await api<Npc[]>(page, 'npcs')).some((n) => n.rival === 'quickstep' && n.subtitle === 'Your ally · the Merry Dancer'), 30_000);

  // An enemy: made hostile, a feud; once its opening has passed, a duel is posted off a lawless beacon.
  await api(page, 'setRival', { id: 'lantern', standing: -40, metAgo: 7_200 });
  let l = await story(page, 'lantern');
  expect(l.story?.path).toBe('enemy');
  const posted = l.holds.find((h) => h.kind === 'duel')!;
  await advanceTo(page, posted.from + 5);
  l = await story(page, 'lantern');
  expect((await api<S>(page, 'state')).jobs['rs.lantern.duel']?.status).toBe('active');
  expect(l.status).toMatch(/^Waiting for you at the beacon in /);
  expect((await api<string[]>(page, 'comms')).some((c) => c.startsWith('I propose we settle this. The beacon in '))).toBe(true);

  // To the beacon: it waits off it; close in, and the duel is on, one on one.
  await api(page, 'warp', posted.systemId);
  await waitUntil(page, 'in flight there', async () => (await api(page, 'mode')) === 'flight' && (await api<{ location: { systemId: string } }>(page, 'state')).location.systemId === posted.systemId, 60_000);
  if (await page.getByTestId('sheet-close').isVisible().catch(() => false)) await press(page, 'sheet-close');
  await waitUntil(page, 'the rival waiting', async () => (await api<Npc[]>(page, 'npcs')).some((n) => n.duel === 'waiting'), 30_000);
  await expect(page.getByTestId('hud-objective')).toContainText('for the duel');
  const purse = (await api<S>(page, 'state')).credits;
  await api(page, 'placeNear', { id: 'duel:rs.lantern.duel', distance: 1_000 });
  await waitUntil(page, 'the duel on', async () => (await story(page, 'lantern')).duel?.state === 'on', 20_000);
  expect(await api<string[]>(page, 'comms')).toContain('Begin.');

  // Brought to the yield, the rival gives up: the purse, and the feud is over.
  const duelist = (await api<Npc[]>(page, 'npcs')).find((n) => n.duel === 'on')!;
  await api(page, 'destroyNpc', { id: duelist.id, byPlayer: true });
  await waitUntil(page, 'the rival yields', async () => (await story(page, 'lantern')).story?.ended?.how === 'won', 10_000);
  l = await story(page, 'lantern');
  expect(l.standing).toBe(0);
  expect(l.duel?.state).toBe('yielded');
  expect((await api<S>(page, 'state')).credits).toBe(purse + 1_000);
  expect(await api<string[]>(page, 'comms')).toContain('I yield. Well fought.');
  q = await story(page, 'quickstep');
  expect(q.story?.ended?.how).toBe('friends');
});
