import { expect, test, type Page } from '@playwright/test';
import { api, newGameAndLaunch, openFresh, waitUntil, type PlayerInfo } from './helpers.ts';

/** Standard-layout button indices (W3C Gamepad API). */
const A = 0;
const B = 1;
const RT = 7;
const START = 9;

interface FakePadApi {
  connect(): void;
  disconnect(): void;
  button(index: number, down: boolean): void;
}

/** Replaces the browser's pads with one fake standard pad that the test drives through `window.__pad`. */
async function installFakePad(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const buttons = Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 }));
    const pad = { id: 'Test pad (STANDARD GAMEPAD Vendor: 045e Product: 0b13)', index: 0, connected: true, mapping: 'standard', axes: [0, 0, 0, 0], buttons, timestamp: 0 };
    let pads: (typeof pad)[] = [];
    Object.defineProperty(Navigator.prototype, 'getGamepads', { configurable: true, value: () => pads });
    const announce = (type: string) => window.dispatchEvent(Object.assign(new Event(type), { gamepad: pad }));
    const control: FakePadApi = {
      connect: () => {
        pads = [pad];
        announce('gamepadconnected');
      },
      disconnect: () => {
        pads = [];
        announce('gamepaddisconnected');
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
    ([f, a]) => {
      const pad = (window as unknown as { __pad: Record<string, (...v: unknown[]) => void> }).__pad;
      pad[f]!(...a);
    },
    [fn, args] as const,
  );
}

/** Holds a pad button until `done` is true, then lets go and gives the game a frame to see it. */
async function hold(page: Page, button: number, label: string, done: () => Promise<boolean>): Promise<void> {
  await padCall(page, 'button', button, true);
  await waitUntil(page, label, done, 20_000);
  await padCall(page, 'button', button, false);
  await page.waitForTimeout(300);
}

test('a gamepad flies alongside the mouse or touch, pauses with Start and hands back when unplugged', async ({ page }) => {
  await installFakePad(page);
  await openFresh(page);
  await newGameAndLaunch(page, 6);
  const before = await api<string>(page, 'scheme');
  expect(['desktop', 'touch']).toContain(before);

  // Plugging it in changes nothing until it is used.
  await padCall(page, 'connect');
  await expect(page.getByText('Gamepad connected')).toBeVisible();
  await page.waitForTimeout(400);
  expect(await api<string>(page, 'scheme')).toBe(before);

  // A takes the HUD's context action (dock) and hands the HUD to the pad; B takes the controls back.
  const autopilot = async () => (await api<PlayerInfo | null>(page, 'player'))?.autopilot;
  await api(page, 'selectTarget', 'station:earth-port');
  await waitUntil(page, 'dock offered', async () => (await api<{ context: { label: string } | null }>(page, 'hud'))?.context?.label === 'Dock', 10_000);
  await hold(page, A, 'docking autopilot running', async () => (await autopilot()) === 'dock');
  await hold(page, B, 'autopilot off', async () => (await autopilot()) === 'none');
  expect(await api<string>(page, 'scheme')).toBe('gamepad');
  // The HUD names the pad's button, and the touch sticks hide.
  await expect(page.getByTestId('hud-context')).toContainText('[A]');
  await expect(page.getByTestId('touch-controls')).toBeHidden();

  // Holding RT fires, spending weapon energy.
  const energy = async () => (await api<PlayerInfo & { energy: number }>(page, 'player'))!.energy;
  const full = await energy();
  await hold(page, RT, 'guns firing from the pad', async () => (await energy()) < full - 5);

  // Start pauses, and closes the pause menu again.
  await hold(page, START, 'paused', async () => (await api<boolean>(page, 'paused')) === true);
  await expect(page.getByTestId('pause-menu')).toBeVisible();
  await hold(page, START, 'resumed', async () => (await api<boolean>(page, 'paused')) === false);
  await expect(page.getByTestId('pause-menu')).toBeHidden();

  // Unplugged mid-flight: the HUD returns to the mouse or touch, and the game pauses.
  await padCall(page, 'disconnect');
  await expect(page.getByText('Gamepad disconnected')).toBeVisible();
  expect(await api<string>(page, 'scheme')).toBe(before);
  expect(await api<boolean>(page, 'paused')).toBe(true);
});
