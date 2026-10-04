import { expect, test, type Page } from '@playwright/test';
import { api, isTouch, openFresh, press, waitUntil } from './helpers.ts';

/**
 * Wing command (docs/PROCGEN.md §34): a wingman hired in the bar; in flight the order card (V on a
 * keyboard, the Wing chip on touch, Back held on a pad) pauses the game, locks what cannot be given
 * and gives the rest, and the HUD shows the order; shot down, the wingman rejoins at the next dock
 * hurt and with a raise for their grade; a medic sees to them; a word in the bar, the journal's wing,
 * and the journal remembers them once let go.
 */

interface WingNow {
  crew: { id: string; name: string; fee: number; fights?: number; downs?: number; trust?: number; memory?: string; hurt?: { hard?: boolean; down?: boolean } }[];
  former: { id: string; name: string; why: string }[];
  flight: { order: string; ward: string | null; hold: number[] | null } | null;
  carry: string;
}

async function wing(page: Page): Promise<WingNow> {
  return (await api<WingNow>(page, 'wing'))!;
}

async function openPeople(page: Page): Promise<void> {
  await press(page, 'room-bar');
  if (!(await page.getByTestId('people-window').isVisible().catch(() => false))) await press(page, 'station-people');
  await expect(page.getByTestId('people-window')).toBeVisible();
}

async function openJournal(page: Page): Promise<void> {
  const journal = page.getByRole('region', { name: 'Journal' });
  if (!(await journal.isVisible().catch(() => false))) await press(page, 'station-journal');
  await expect(journal).toBeVisible();
}

/** Opens the order card as the player would on this device. */
async function openCard(page: Page): Promise<void> {
  if (await isTouch(page)) await press(page, 'touch-wing');
  else await page.keyboard.press('v');
  await expect(page.getByTestId('wing-orders')).toBeVisible();
}

/** Gives an order from the open card: its number key on a keyboard, a tap on touch. */
async function order(page: Page, which: string, key: string): Promise<void> {
  if (await isTouch(page)) await press(page, `wing-order-${which}`);
  else await page.keyboard.press(key);
  await expect(page.getByTestId('wing-orders')).toBeHidden();
}

test('wing command: the order card in flight, a wingman picked up and treated, a word in the bar, the journal', async ({ page }) => {
  await page.addInitScript(() => {
    // One fake standard pad, connected from the start, that the test holds Back on.
    const buttons = Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 }));
    const pad = { id: 'Test pad (STANDARD GAMEPAD Vendor: 045e Product: 0b13)', index: 0, connected: true, mapping: 'standard', axes: [0, 0, 0, 0], buttons, timestamp: 0 };
    Object.defineProperty(Navigator.prototype, 'getGamepads', { configurable: true, value: () => [pad] });
    (window as unknown as { __back: (down: boolean) => void }).__back = (down) => {
      buttons[8] = { pressed: down, touched: down, value: down ? 1 : 0 };
    };
  });
  await openFresh(page);
  await press(page, 'title-play');
  await press(page, 'intro-ok');
  await api(page, 'setCredits', 9_000);
  const home = (await api<{ location: { lastDockId: string } }>(page, 'state')).location.lastDockId;

  // A pilot for hire in the bar joins the wing, a steady hand or a sharp shot.
  await openPeople(page);
  await page.locator('[data-testid^="person-w."]').first().click();
  await press(page, (await page.locator('[data-testid^="hire-"]').first().getAttribute('data-testid'))!);
  const [hired] = (await wing(page)).crew;
  expect(hired).toBeDefined();
  await expect(page.getByTestId(`pilot-${hired!.id}`)).toContainText(/Steady hand|Sharp shot/);

  await press(page, 'dock-launch');
  await press(page, 'sheet-close');
  await api(page, 'setTimeScale', 4);
  await waitUntil(page, 'the wing forms up', async () => (await api<{ wing: { count: number } | null }>(page, 'hud'))?.wing?.count === 1, 60_000);

  // The card: paused, Defend and Cover locked with why, Hold given.
  await openCard(page);
  expect(await api<boolean>(page, 'paused')).toBe(true);
  await expect(page.getByTestId('wing-card')).toContainText(hired!.name);
  await expect(page.getByTestId('wing-order-defend')).toBeDisabled();
  await expect(page.getByTestId('wing-order-defend')).toContainText('Select a friendly ship first.');
  await expect(page.getByTestId('wing-order-cover')).toBeDisabled();
  await expect(page.getByTestId('wing-order-cover')).toContainText('No hauler here to cover.');
  await order(page, 'hold', '5');
  expect(await api<boolean>(page, 'paused')).toBe(false);
  expect(await api<string[]>(page, 'comms')).toContain('Copy. Holding here.');
  expect((await wing(page)).flight).toMatchObject({ order: 'hold' });
  if (await isTouch(page)) await expect(page.getByTestId('touch-wing')).toHaveText('Wing · Hold');
  else await expect(page.locator('.hud-loadout')).toContainText('Wing 1 · Hold');

  // Not now changes nothing; Form up is given.
  await openCard(page);
  await press(page, 'wing-later');
  await expect(page.getByTestId('wing-orders')).toBeHidden();
  expect((await wing(page)).flight?.order).toBe('hold');
  await openCard(page);
  await order(page, 'form', '6');
  expect((await wing(page)).flight?.order).toBe('form');

  // On a pad, Back held opens the card.
  await page.evaluate(() => (window as unknown as { __back: (down: boolean) => void }).__back(true));
  await expect(page.getByTestId('wing-orders')).toBeVisible();
  await page.evaluate(() => (window as unknown as { __back: (down: boolean) => void }).__back(false));
  await press(page, 'wing-later');
  await expect(page.getByTestId('wing-orders')).toBeHidden();
  expect(await api<string>(page, 'mode')).toBe('flight');

  // Shot down after a good run of fights: picked up, they rejoin at the next dock, hurt, with a raise.
  await api(page, 'setWing', { fights: 8, downs: 4, trust: 50, hurt: 'down' });
  await api(page, 'dockAt', home);
  await waitUntil(page, 'docked', async () => (await api<{ location: { dockedAt: string | null } }>(page, 'state')).location.dockedAt === home);
  let now = (await wing(page)).crew[0]!;
  expect(now.hurt).toMatchObject({ hard: true });
  expect(now.hurt?.down).toBeUndefined();
  expect(now.memory).toBe('raise');
  expect(now.fee).toBeGreaterThan(hired!.fee);
  await openPeople(page);
  await expect(page.getByTestId(`pilot-${hired!.id}`)).toContainText('Seasoned wing');
  await expect(page.getByTestId(`wing-tag-${hired!.id}-hurt`)).toBeVisible();

  // A medic sees to them.
  await press(page, 'room-deck');
  const credits = (await api<{ credits: number }>(page, 'state')).credits;
  await press(page, 'dock-treat-wing');
  expect((await api<{ credits: number }>(page, 'state')).credits).toBe(credits - 300);
  now = (await wing(page)).crew[0]!;
  expect(now.hurt).toBeUndefined();
  expect(now.memory).toBe('treated');
  await expect(page.getByTestId('dock-treat-wing')).toHaveCount(0);

  // A word in the bar: what they say, their record and how they feel.
  await openPeople(page);
  await press(page, `wing-talk-${hired!.id}`);
  await expect(page.getByTestId('wing-dialog')).toBeVisible();
  await expect(page.getByTestId('wing-says')).toHaveText('Thanks for seeing to me. Good as new.');
  await expect(page.getByTestId('wing-grade')).toContainText('Seasoned wing: 8 fights beside you, 4 raiders downed.');
  await expect(page.getByTestId('wing-trust')).toContainText('Easy');
  await press(page, 'wing-close');

  // A reload keeps the record.
  await api(page, 'flush');
  await page.reload();
  await press(page, 'title-continue');
  await expect(page.getByTestId('dock-screen')).toBeVisible();
  expect((await wing(page)).crew[0]).toMatchObject({ fights: 8, downs: 4, memory: 'treated' });

  // The journal's wing; let go, the journal remembers them.
  await openJournal(page);
  await expect(page.getByTestId('wing-record')).toContainText(`${hired!.name} · Seasoned wing`);
  await openPeople(page);
  await press(page, `dismiss-${hired!.id}`);
  expect((await wing(page)).former).toEqual([expect.objectContaining({ id: hired!.id, why: 'let-go' })]);
  await openJournal(page);
  await expect(page.getByTestId('wing-former')).toContainText(`Flew with you: ${hired!.name} · Seasoned wing · let go`);
});
