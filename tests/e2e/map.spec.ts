import { expect, test, type Page } from '@playwright/test';
import { api, isTouch, openFresh, press } from './helpers.ts';

/**
 * Finding your way on the star map: the missions list, search by name, and zoom that follows the
 * fingers (a pinch) or the cursor (the wheel).
 */

interface MapView {
  moving: boolean;
  distance: number;
  origin: { x: number; y: number };
  centre: { x: number; y: number };
  stars: { id: string; x: number; y: number; depth: number; visible: boolean }[];
}

async function openJobs(page: Page): Promise<void> {
  await press(page, 'room-bar');
  if (!(await page.getByTestId('jobs-window').isVisible().catch(() => false))) await press(page, 'station-jobs');
}

async function newGame(page: Page): Promise<void> {
  await openFresh(page);
  await press(page, 'title-play');
  await press(page, 'intro-ok');
}

async function openMap(page: Page): Promise<void> {
  await press(page, 'dock-map');
  await expect(page.getByTestId('galaxy-map')).toBeVisible();
}

/** The map view once it is drawn and still (the opening move and any easing done). */
async function settledView(page: Page): Promise<MapView> {
  for (let i = 0; i < 200; i++) {
    await page.waitForTimeout(150);
    const now = await api<MapView | null>(page, 'mapView');
    if (now && !now.moving && now.stars.some((s) => s.visible)) return now;
  }
  throw new Error('the map view never settled');
}

/** A plotted star in the open stage, `min`–`max` px from the projection centre, well in front of the camera. */
function starOffCentre(view: MapView, min: number, max: number): number {
  const i = view.stars.findIndex((s) => {
    const off = Math.hypot(s.x - view.centre.x, s.y - view.centre.y);
    return s.visible && off >= min && off <= max && s.depth > view.distance * 0.9;
  });
  expect(i, 'a star off the centre of the view').toBeGreaterThanOrEqual(0);
  return i;
}

async function cardTitle(page: Page): Promise<string> {
  return (await page.getByTestId('galaxy-map').locator('.gmap-card-title').textContent())?.trim() ?? '';
}

test('the missions list finds the systems your missions send you to', async ({ page }) => {
  await newGame(page);
  await api(page, 'completeJobs', ['lifeline']);
  await openJobs(page);
  await press(page, 'accept-arc.sta.1');
  await openMap(page);
  await expect(page.getByTestId('map-missions')).toHaveAttribute('aria-label', 'Missions: 1 system');
  await press(page, 'map-missions');
  const row = page.getByTestId('map-mission-barnard');
  // The first step of Clean Manifests: what it is called and what to do there.
  await expect(row).toContainText('A quiet audit');
  await expect(row).toContainText('Barnard Transit Relay');
  await expect(row).toContainText(/\d jumps? · 6\.0 ly/);
  await press(page, 'map-mission-barnard');
  await expect(page.getByTestId('map-missions-dialog')).toBeHidden();
  await expect.poll(() => cardTitle(page)).toMatch(/Barnard/);
  // Brought to the middle of the view.
  const view = await settledView(page);
  const barnard = view.stars.find((s) => s.id === 'barnard')!;
  expect(Math.hypot(barnard.x - view.centre.x, barnard.y - view.centre.y)).toBeLessThan(40);
});

test('the missions list says so when there are none', async ({ page }) => {
  await newGame(page);
  await api(page, 'completeJobs', ['lifeline']);
  await openMap(page);
  await expect(page.getByTestId('map-missions')).toHaveAttribute('aria-label', 'Missions: none active');
  await press(page, 'map-missions');
  await expect(page.getByTestId('map-missions-empty')).toContainText('job board');
  await press(page, 'map-missions-dialog-close');
  await expect(page.getByTestId('map-missions-dialog')).toBeHidden();
  await expect(page.getByTestId('galaxy-map')).toBeVisible();
});

test('search finds a system by any of its names, typos and all', async ({ page }) => {
  await newGame(page);
  await openMap(page);
  const map = page.getByTestId('galaxy-map');

  // A planet's name finds its system; Enter takes the first match.
  await press(page, 'map-search');
  const input = page.getByTestId('map-search-input');
  await expect(input).toBeFocused();
  await expect(page.getByTestId('map-search-dialog').locator('.gmap-result')).toHaveCount(8);
  await input.fill('proxima b');
  await expect(page.getByTestId('map-search-result-alpha-centauri')).toContainText('Proxima Centauri b');
  await input.press('Enter');
  await expect(page.getByTestId('map-search-dialog')).toBeHidden();
  await expect.poll(() => cardTitle(page)).toBe('Alpha Centauri');

  // A typo still finds it; choosing a row by touch or click works too.
  await press(page, 'map-search');
  await input.fill('barnrd');
  await press(page, 'map-search-result-barnard');
  await expect.poll(() => cardTitle(page)).toMatch(/Barnard/);

  // Nothing found says so; Escape closes the search and leaves the map open.
  await press(page, 'map-search');
  await input.fill('zzqx');
  await expect(page.getByTestId('map-search-dialog')).toContainText('Nothing called “zzqx”');
  await input.press('Escape');
  await expect(page.getByTestId('map-search-dialog')).toBeHidden();
  await expect(map).toBeVisible();

  if (!(await isTouch(page))) {
    // On a keyboard, / opens it and the arrow keys choose.
    await page.keyboard.press('/');
    await expect(input).toBeFocused();
    await input.fill('ross 1');
    await input.press('ArrowDown');
    const second = await page.getByTestId('map-search-dialog').locator('.gmap-result[aria-selected="true"]').getAttribute('data-system-id');
    await input.press('Enter');
    await expect.poll(async () => (await map.locator('.gmap-sys[aria-pressed="true"]').getAttribute('data-system-id')) ?? '').toBe(second!);
  }
});

test('the 2D map zooms about the fingers or the cursor, pans and resets', async ({ page }) => {
  const touch = await isTouch(page);
  const activate = async (name: string) => {
    const b = page.getByRole('button', { name, exact: true });
    if (touch) await b.tap();
    else await b.click();
  };
  await newGame(page);
  await openMap(page);
  await activate('2D view');
  const star = (id: string) => page.locator(`.map2d-sys[data-system-id="${id}"] .map2d-star`).first();
  const at = async (id: string) => {
    const b = (await star(id).boundingBox())!;
    return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  };
  const sol0 = await at('sol');
  const ac0 = await at('alpha-centauri');
  const spread0 = Math.hypot(sol0.x - ac0.x, sol0.y - ac0.y);
  if (touch) {
    const client = await page.context().newCDPSession(page);
    const fingers = (sp: number) => [
      { x: sol0.x - sp, y: sol0.y, id: 1 },
      { x: sol0.x + sp, y: sol0.y, id: 2 },
    ];
    await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: fingers(20) });
    for (let sp = 25; sp <= 60; sp += 5) {
      await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: fingers(sp) });
      await page.waitForTimeout(30);
    }
    await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  } else {
    await page.mouse.move(sol0.x, sol0.y);
    for (let k = 0; k < 3; k++) await page.mouse.wheel(0, -300);
  }
  await page.waitForTimeout(500);
  const sol1 = await at('sol');
  const ac1 = await at('alpha-centauri');
  // Zoomed in about Sol: it stayed put while its neighbour moved away.
  expect(Math.hypot(sol1.x - sol0.x, sol1.y - sol0.y)).toBeLessThan(6);
  expect(Math.hypot(sol1.x - ac1.x, sol1.y - ac1.y)).toBeGreaterThan(spread0 * 2);

  // A drag moves the map and selects nothing.
  const stage = (await page.locator('.gmap-2d').boundingBox())!;
  const from = { x: stage.x + stage.width * 0.55, y: stage.y + stage.height * 0.5 };
  if (touch) {
    const client = await page.context().newCDPSession(page);
    await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...from, id: 3 }] });
    for (let k = 1; k <= 8; k++) {
      await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: from.x - k * 10, y: from.y, id: 3 }] });
      await page.waitForTimeout(20);
    }
    await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  } else {
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    for (let k = 1; k <= 8; k++) await page.mouse.move(from.x - k * 10, from.y);
    await page.mouse.up();
  }
  await page.waitForTimeout(300);
  const sol2 = await at('sol');
  const ac2 = await at('alpha-centauri');
  expect(sol2.x - sol1.x).toBeLessThan(-60);
  expect(await cardTitle(page)).toBe('Sol');

  // The zoom buttons work here too, and Reset shows the whole map again.
  await activate('Zoom out');
  const sol3 = await at('sol');
  const ac3 = await at('alpha-centauri');
  expect(Math.hypot(sol3.x - ac3.x, sol3.y - ac3.y)).toBeLessThan(Math.hypot(sol2.x - ac2.x, sol2.y - ac2.y) * 0.9);
  await activate('Reset view');
  const sol4 = await at('sol');
  expect(Math.hypot(sol4.x - sol0.x, sol4.y - sol0.y)).toBeLessThan(2);
});

test.describe('zoom follows the fingers', () => {
  test.skip(({ isMobile }) => !isMobile, 'touch-only');

  test('a pinch zooms in toward the fingers, not the middle of the screen', async ({ page }) => {
    await newGame(page);
    await openMap(page);
    const before = await settledView(page);
    const i = starOffCentre(before, 50, 140);
    const star = before.stars[i]!;
    const mid = { x: before.origin.x + star.x, y: before.origin.y + star.y };
    const client = await page.context().newCDPSession(page);
    const fingers = (spread: number) => [
      { x: mid.x - spread, y: mid.y, id: 1 },
      { x: mid.x + spread, y: mid.y, id: 2 },
    ];
    await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: fingers(20) });
    for (let s = 25; s <= 60; s += 5) {
      await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: fingers(s) });
      await page.waitForTimeout(30);
    }
    await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    const after = await settledView(page);
    expect(after.distance).toBeLessThan(before.distance * 0.45);
    const moved = Math.hypot(after.stars[i]!.x - star.x, after.stars[i]!.y - star.y);
    // About the middle it would have been pushed out to three times its distance from it.
    expect(moved).toBeLessThan(6);
  });

  test('a lost touch does not turn the next drag into a pinch', async ({ page }) => {
    await newGame(page);
    await openMap(page);
    const before = await settledView(page);
    const x = before.origin.x + before.centre.x;
    const y = before.origin.y + before.centre.y;
    // A finger whose lift never arrived.
    await page.evaluate(
      ([px, py]) => {
        const canvas = document.getElementById('scene')!;
        canvas.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 77, pointerType: 'touch', isPrimary: true, clientX: px! - 90, clientY: py!, bubbles: true }));
      },
      [x, y],
    );
    const client = await page.context().newCDPSession(page);
    await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }] });
    for (let k = 1; k <= 6; k++) {
      await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + k * 12, y, id: 1 }] });
      await page.waitForTimeout(30);
    }
    await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    const after = await settledView(page);
    // One finger turns the view; it does not zoom.
    expect(after.distance).toBeCloseTo(before.distance, 6);
    expect(after.stars.some((s, j) => Math.abs(s.x - before.stars[j]!.x) > 3)).toBe(true);
  });
});

test.describe('zoom follows the cursor', () => {
  test.skip(({ isMobile }) => isMobile, 'mouse-only');

  test('the wheel zooms in toward the cursor', async ({ page }) => {
    await newGame(page);
    await openMap(page);
    const before = await settledView(page);
    const i = starOffCentre(before, 60, 220);
    const star = before.stars[i]!;
    await page.mouse.move(before.origin.x + star.x, before.origin.y + star.y);
    for (let k = 0; k < 4; k++) await page.mouse.wheel(0, -240);
    const after = await settledView(page);
    expect(after.distance).toBeLessThan(before.distance * 0.6);
    expect(Math.hypot(after.stars[i]!.x - star.x, after.stars[i]!.y - star.y)).toBeLessThan(6);
  });
});
