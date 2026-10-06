import { expect, test, type Page } from '@playwright/test';
import { api, isTouch, openFresh, press, waitUntil } from './helpers.ts';

/**
 * Lane encounters (docs/PROCGEN.md §27): a lost trader's hail answered from its banner and a fix
 * sold; a Hollow Wake toll paid, the card naming the risk; the same slot never hailing twice; a
 * customs patrol bribed with contraband aboard; and a real mayday answered with a pad (A on the
 * action, the D-pad to the choice, A to take it), then flown to and paid when reached.
 */

interface Offer {
  id: string;
  systemId: string;
  start: number;
  kind: string;
  trap: boolean;
  toll?: number;
  credits?: number;
}

interface Lanes {
  met: Record<string, { pick?: string }>;
  hail: { id: string; held: boolean } | null;
  /** What the pilot would meet here now. */
  now: string | null;
}

interface State {
  credits: number;
  clock: number;
}

const A = 0;
const DOWN = 13;

interface FakePadApi {
  connect(): void;
  button(index: number, down: boolean): void;
}

/** One fake standard pad, driven through `window.__pad` (as in gamepad.spec.ts). */
async function installFakePad(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const buttons = Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 }));
    const pad = { id: 'Test pad (STANDARD GAMEPAD Vendor: 045e Product: 0b13)', index: 0, connected: true, mapping: 'standard', axes: [0, 0, 0, 0], buttons, timestamp: 0 };
    let pads: (typeof pad)[] = [];
    Object.defineProperty(Navigator.prototype, 'getGamepads', { configurable: true, value: () => pads });
    const control: FakePadApi = {
      connect: () => {
        pads = [pad];
        window.dispatchEvent(Object.assign(new Event('gamepadconnected'), { gamepad: pad }));
      },
      button: (index, down) => {
        buttons[index] = { pressed: down, touched: down, value: down ? 1 : 0 };
      },
    };
    (window as unknown as { __pad: FakePadApi }).__pad = control;
  });
}

async function padCall<K extends keyof FakePadApi>(page: Page, fn: K, ...args: Parameters<FakePadApi[K]>): Promise<void> {
  await page.evaluate(
    ([f, a]) => (window as unknown as { __pad: Record<string, (...v: unknown[]) => void> }).__pad[f]!(...a),
    [fn, args] as const,
  );
}

/** Holds a pad button until `done`, then lets go and waits until the game has drawn two frames (as in gamepad.spec.ts). */
async function hold(page: Page, button: number, label: string, done: () => Promise<boolean>): Promise<void> {
  await padCall(page, 'button', button, true);
  await waitUntil(page, label, done, 20_000);
  await padCall(page, 'button', button, false);
  const at = await api<number>(page, 'framesDrawn');
  await waitUntil(page, 'the release seen', async () => (await api<number>(page, 'framesDrawn')) >= at + 2, 20_000);
}

/** Into the encounter's system at its slot, flying, until it hails. */
async function meet(page: Page, o: Offer): Promise<void> {
  const s = await api<State>(page, 'state');
  await api(page, 'advanceClock', o.start + 5 - s.clock);
  await api(page, 'warp', o.systemId);
  await waitUntil(page, 'in flight', async () => (await api(page, 'mode')) === 'flight');
  if (await page.getByTestId('sheet-close').isVisible().catch(() => false)) await press(page, 'sheet-close');
  await waitUntil(page, `${o.kind} hails`, async () => (await api<Lanes>(page, 'lanes')).hail?.id === o.id, 120_000);
}

test('lane encounters: a trader helped, a toll paid, a slot met once, a bribe, and a mayday answered with a pad', async ({ page }) => {
  await installFakePad(page);
  await openFresh(page);
  await press(page, 'title-play');
  await press(page, 'intro-ok');
  await api(page, 'completeJobs', ['lifeline']);
  // Lane encounters are off in browser tests unless one wants them.
  await api(page, 'meetLanes', true);
  const touch = await isTouch(page);

  // A lost trader (the first encounter is never a trap): the banner, the card, a fix sold.
  let s = await api<State>(page, 'state');
  const trader = (await api<Offer | null>(page, 'findLane', { from: s.clock + 600, kind: 'trader' }))!;
  await meet(page, trader);
  const banner = page.getByTestId('hail-banner');
  await expect(banner).toContainText('Lost trader');
  // The action button reads Answer; on touch it is the way to answer (the HUD lies under the thumb zones).
  await expect(page.getByTestId(touch ? 'touch-context' : 'hud-context')).toContainText('Answer');
  await press(page, touch ? 'touch-context' : 'hail-answer');
  const card = page.getByTestId('lane-dialog');
  await expect(card).toBeVisible();
  await expect(card).toContainText('Fiction: the people, ships and events of the lanes are fiction.');
  expect(await api<boolean>(page, 'paused')).toBe(true);
  const before = (await api<State>(page, 'state')).credits;
  await press(page, 'lane-sell');
  await expect(card).toBeHidden();
  await waitUntil(page, 'paid for the fix', async () => (await api<State>(page, 'state')).credits === before + 60, 10_000);
  await expect(banner).toBeHidden();

  // A Hollow Wake toll at the beacon: the card names the risk; paid.
  s = await api<State>(page, 'state');
  const toll = (await api<Offer | null>(page, 'findLane', { from: s.clock + 1_200, kind: 'toll' }))!;
  await meet(page, toll);
  await expect(banner).toContainText('Hollow Wake');
  await press(page, touch ? 'touch-context' : 'hail-answer');
  await expect(page.getByTestId('lane-risk')).toContainText('they attack');
  const credits = (await api<State>(page, 'state')).credits;
  await press(page, 'lane-pay');
  await waitUntil(page, 'the toll paid', async () => (await api<Lanes>(page, 'lanes')).met[toll.id]?.pick === 'pay', 10_000);
  expect(credits - (await api<State>(page, 'state')).credits).toBe(toll.toll);

  // The same slot never hails twice: back into the system, it has nothing more to offer.
  await api(page, 'warp', toll.systemId);
  await waitUntil(page, 'in flight', async () => (await api(page, 'mode')) === 'flight');
  const again = await api<Lanes>(page, 'lanes');
  expect(again.now).toBeNull();
  expect(again.hail).toBeNull();

  // A customs patrol hails a hold with contraband in it: a bribe, and they look away.
  s = await api<State>(page, 'state');
  const customs = (await api<Offer | null>(page, 'findLane', { from: s.clock + 1_200, kind: 'customs', trap: false }))!;
  await api(page, 'setCargo', { stims: 2 });
  await meet(page, customs);
  await expect(banner).toContainText('Customs patrol');
  await press(page, touch ? 'touch-context' : 'hail-answer');
  await expect(page.getByTestId('lane-risk')).toContainText('sting');
  await press(page, 'lane-bribe');
  await waitUntil(page, 'the bribe taken', async () => (await api<Lanes>(page, 'lanes')).met[customs.id]?.pick === 'bribe', 10_000);
  const cargo = await api<{ ship: { cargo: Record<string, number> } }>(page, 'state');
  expect(cargo.ship.cargo.stims).toBe(2);

  // A real mayday, answered with a pad: A on the action, the D-pad down to the first choice, A to take it.
  s = await api<State>(page, 'state');
  const mayday = (await api<Offer | null>(page, 'findLane', { from: s.clock + 1_200, kind: 'mayday', trap: false }))!;
  await meet(page, mayday);
  await padCall(page, 'connect');
  await expect(page.getByText('Gamepad connected')).toBeVisible();
  const idle = await api<number>(page, 'framesDrawn');
  await waitUntil(page, 'a few frames with the pad idle', async () => (await api<number>(page, 'framesDrawn')) >= idle + 3, 20_000);
  const reward = (await api<State>(page, 'state')).credits;
  await waitUntil(page, 'Answer on the action', async () => (await api<{ context: { label: string } | null } | null>(page, 'hud'))?.context?.label === 'Answer', 20_000);
  await hold(page, A, 'the card open', async () => card.isVisible());
  await hold(page, DOWN, 'the first choice in focus', async () => page.getByTestId('lane-help').evaluate((el) => el === document.activeElement));
  await hold(page, A, 'went to them', async () => (await api<Lanes>(page, 'lanes')).met[mayday.id]?.pick === 'help');
  // The ship is marked on the HUD (docs/PROCGEN.md §31): flown alongside, its pilot pays.
  expect((await api<State>(page, 'state')).credits).toBe(reward);
  const site = `lane.${mayday.id}`;
  await waitUntil(page, 'the ship in the scene', async () => (await api<{ flight: { id: string }[] }>(page, 'sites')).flight.some((x) => x.id === site), 20_000);
  await api(page, 'placeNear', { id: `site:${site}`, distance: 150 });
  await waitUntil(page, 'paid when reached', async () => (await api<State>(page, 'state')).credits - reward === mayday.credits, 20_000);
});
