import { expect, test, type Page } from '@playwright/test';
import { api, openFresh, press, waitUntil } from './helpers.ts';

/**
 * The border in sight (docs/PROCGEN.md §35): at Ross 154 a clash opens at the beacon line a moment
 * after launch, the battle strip counts each side and names the pilot's, the pilot downs one of the
 * Wake's and their side wins: the purse paid, the journal keeps it. Then, as Regent Concourse is about
 * to fall, the Wake's assault on it in two waves, beaten off with the pilot: the station holds, and
 * the News tells it.
 */

interface Found {
  id: string;
  opens: number;
  until: number;
  law: number;
  wake: number;
  title: string;
}
interface BattleNow {
  flight: { active: string | null; side: string | null; part: boolean; wave: number; ships: { side: string; over: string | null }[] } | null;
  seen: { title: string; record: { kind: string; winner: string; side: string; part: boolean } }[];
}

const clock = async (page: Page) => (await api<{ clock: number }>(page, 'state')).clock;
const credits = async (page: Page) => (await api<{ credits: number }>(page, 'state')).credits;
const battle = async (page: Page) => (await api<BattleNow>(page, 'battle'))!;

/** Docks at Waymark Waypoint (Ross 154's dock that never falls) just before a battle, and launches. */
async function launchBefore(page: Page, found: Found): Promise<void> {
  await api(page, 'advanceClock', found.opens - (await clock(page)) - 40);
  await api(page, 'dockAt', 'waymark-waypoint');
  await waitUntil(page, 'docked', async () => (await api<{ location: { dockedAt: string | null } }>(page, 'state')).location.dockedAt === 'waymark-waypoint');
  await press(page, 'dock-launch');
  // The first flight's Flight school sheet opens once the scene is built (seconds under SwiftShader)
  // and holds the game while it is open: close it once in flight, not after a guessed wait.
  await waitUntil(page, 'in flight', async () => (await api(page, 'mode')) === 'flight');
  if (await page.getByTestId('controls-sheet').isVisible().catch(() => false)) await press(page, 'sheet-close');
  await waitUntil(page, 'undocked', async () => (await api<{ autopilot: string } | null>(page, 'player'))?.autopilot === 'none', 60_000);
  await api(page, 'setTimeScale', 4);
  // A battle of its kind opens (a clash from the slot before may come first: one is as good as another).
  const kind = found.id.split(':')[0]!;
  await waitUntil(page, 'the battle opens', async () => !!(await battle(page)).flight?.active?.startsWith(`${kind}:`), 60_000);
}

/** Downs the other side's ships in the battle under way, the first by the pilot's guns, until it ends. */
async function winFor(page: Page, title: string): Promise<void> {
  let first = true;
  await waitUntil(
    page,
    'the battle won',
    async () => {
      const b = await battle(page);
      if (b.seen.some((x) => x.title === title)) return true;
      if (b.flight?.active) {
        await api(page, 'downBattleShip', { side: 'wake', byPlayer: first });
        first = false;
      }
      return false;
    },
    60_000,
  );
}

test('border battles: a clash at the beacon line and an assault on Regent Concourse, won with the pilot', async ({ page }) => {
  test.setTimeout(480_000);
  await openFresh(page);
  await press(page, 'title-play');
  await press(page, 'intro-ok');
  await api(page, 'completeJobs', ['lifeline']);
  await api(page, 'setCredits', 5_000);
  await api(page, 'meetBattles', true);
  // The pilot waits in flight for each battle: Ross 154's raider packs are kept away meanwhile.
  await api(page, 'quietPacks', true);

  // A clash: the strip, the marker, the pilot's side; one of the Wake's downed by the pilot, the rest by the law.
  const clash = (await api<Found | null>(page, 'findBattle', { system: 'ross-154', kind: 'clash', from: await clock(page) }))!;
  expect(clash.title).toBe('Clash at the Ross 154 beacon line');
  await launchBefore(page, clash);
  await expect(page.getByTestId('hud-battle')).toBeVisible();
  await expect(page.getByTestId('hud-battle-name')).toHaveText(clash.title);
  await expect(page.getByTestId('hud-battle-law')).toContainText('Transit Authority');
  await expect(page.getByTestId('hud-battle-law')).toContainText('you');
  await expect(page.getByTestId('hud-battle')).toContainText('Fiction');
  expect((await api<{ id: string; hostile: boolean }[]>(page, 'targets')).some((t) => t.id === 'battle-line')).toBe(true);
  expect((await battle(page)).flight?.side).toBe('law');
  const before = await credits(page);
  await winFor(page, clash.title);
  expect((await battle(page)).seen[0]!.record).toMatchObject({ kind: 'clash', winner: 'law', side: 'law', part: true });
  // The purse, on top of the downed raider's bounty.
  expect(await credits(page)).toBeGreaterThanOrEqual(before + 300);

  // The assault on Regent Concourse: two waves, beaten off with the pilot; the station holds.
  const assault = (await api<Found | null>(page, 'findBattle', { system: 'ross-154', kind: 'assault', from: await clock(page) }))!;
  expect(assault.title).toBe('The Wake assaults Regent Concourse');
  await launchBefore(page, assault);
  await expect(page.getByTestId('hud-battle-name')).toHaveText(assault.title);
  await waitUntil(
    page,
    'the second wave',
    async () => {
      const b = await battle(page);
      if ((b.flight?.wave ?? 0) >= 2) return true;
      await api(page, 'downBattleShip', { side: 'wake', byPlayer: true });
      return false;
    },
    60_000,
  );
  await winFor(page, assault.title);
  expect((await battle(page)).seen[0]!.record).toMatchObject({ kind: 'assault', winner: 'law', side: 'law', part: true });

  // Docked: the standing earned brings a rank's card; the News tells the battle, the journal keeps both.
  await api(page, 'dockAt', 'waymark-waypoint');
  await waitUntil(page, 'docked', async () => (await api<{ location: { dockedAt: string | null } }>(page, 'state')).location.dockedAt === 'waymark-waypoint');
  if (await page.getByTestId('rank-dialog').isVisible({ timeout: 3_000 }).catch(() => false)) await press(page, 'rank-continue');
  await press(page, 'room-bar');
  if (!(await page.getByTestId('news-window').isVisible().catch(() => false))) await press(page, 'station-news');
  await expect(page.getByTestId('battle-news-0')).toContainText('A pilot helps beat off the Wake’s assault on Regent Concourse');
  const journal = page.getByRole('region', { name: 'Journal' });
  if (!(await journal.isVisible().catch(() => false))) await press(page, 'station-journal');
  await expect(page.getByTestId('battles-record')).toContainText('The Wake assaults Regent Concourse · won, with your part · your side: Law');
  await expect(page.getByTestId('battles-record')).toContainText(`${clash.title} · won, with your part`);
});
