import { expect, type Page } from '@playwright/test';
import { clearCentre, intrusions } from '../../src/ui/touch/clearCentre.ts';

type Api = Record<string, (arg?: unknown) => unknown>;

/** Calls a `window.__starman` test hook (enabled by ?test=1). */
export async function api<T = unknown>(page: Page, fn: string, arg?: unknown): Promise<T> {
  return page.evaluate(
    ([f, a]) => (window as unknown as { __starman: Api }).__starman[f as string]!(a) as T,
    [fn, arg] as const,
  ) as Promise<T>;
}

export async function waitUntil(page: Page, label: string, check: () => Promise<boolean>, timeout = 180_000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (await check()) return;
    await page.waitForTimeout(400);
  }
  throw new Error(`Timed out waiting for: ${label}`);
}

export async function isTouch(page: Page): Promise<boolean> {
  return page.evaluate(() => navigator.maxTouchPoints > 0 || matchMedia('(pointer: coarse)').matches);
}

/** Activates a control with a tap on touch projects and a click on desktop. */
export async function press(page: Page, testId: string): Promise<void> {
  const el = page.getByTestId(testId);
  await expect(el).toBeVisible();
  if (await isTouch(page)) await el.tap();
  else await el.click();
}

export async function openFresh(page: Page, query = ''): Promise<void> {
  await page.goto(`/?test=1${query}`);
  await page.evaluate(async () => {
    // Clean slate: delete saves from earlier tests in this browser context.
    await new Promise<void>((resolve) => {
      const req = indexedDB.deleteDatabase('starman-reborn');
      req.onsuccess = req.onerror = req.onblocked = () => resolve();
    });
    localStorage.clear();
  });
  await page.goto(`/?test=1${query}`);
  await expect(page.getByTestId('title-screen')).toBeVisible();
}

/** New game → contract accepted → medical supplies bought → launched and flight school closed. */
export async function newGameAndLaunch(page: Page, medical = 10): Promise<void> {
  await press(page, 'title-play');
  await press(page, 'intro-ok');
  await press(page, 'accept-lifeline');
  await press(page, 'buy-medical');
  const qty = page.getByTestId('buy-qty');
  await expect(page.getByTestId('buy-dialog')).toBeVisible();
  // The dialog opens at 6 for the contract; add the rest for trade.
  for (let i = Number(await qty.textContent()); i < medical; i++) await press(page, 'buy-plus');
  await press(page, 'buy-confirm');
  await press(page, 'dock-launch');
  await press(page, 'sheet-close');
  await waitUntil(page, 'undock finished', async () => (await api<{ autopilot: string } | null>(page, 'player'))?.autopilot === 'none');
}

export interface PlayerInfo {
  position: [number, number, number];
  speed: number;
  alive: boolean;
  autopilot: string;
}

/**
 * What stays on screen in touch flight (docs/PROCGEN.md §52): the panels along the top, the dock's
 * buttons and chips, the throttle and the sticks' hints. Messages that come and go are not in it.
 */
export const STEADY_HUD = '.hud-status, .hud-wallet, .hud-buttons, .hud-objective, .hud-race, .hud-battle, .hud-target, .tbtn, .throttle, .assist-chip, .wing-chip, .avoid-chip, .zone-hint';

/**
 * The clear centre at the page's size (src/ui/touch/clearCentre.ts): what of the touch HUD that stays
 * on screen reaches into it, and which of the HUD's buttons a touch at its middle would not reach
 * because the touch controls lie over it (the sticks' zones and the dock lie over the HUD).
 */
export async function clearCentreAudit(page: Page): Promise<{ into: string[]; covered: string[] }> {
  const vp = page.viewportSize()!;
  const found = await page.evaluate((steady) => {
    const visible = (el: Element) => {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && Number(cs.opacity) > 0.05;
    };
    const name = (el: Element) => (el.getAttribute('data-testid') ?? el.getAttribute('class') ?? el.tagName).slice(0, 40);
    const items = [...document.querySelectorAll(steady)].filter(visible).map((el) => {
      const r = el.getBoundingClientRect();
      return { name: name(el), box: { left: r.left, top: r.top, right: r.right, bottom: r.bottom } };
    });
    const covered = [...document.querySelectorAll('.hud button:not(.marker)')]
      .filter(visible)
      .filter((el) => {
        const r = el.getBoundingClientRect();
        const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        return !!hit?.closest('[data-testid="touch-controls"]');
      })
      .map(name);
    return { items, covered };
  }, STEADY_HUD);
  return { into: intrusions(clearCentre(vp.width, vp.height), found.items), covered: found.covered };
}
