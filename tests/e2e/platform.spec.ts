import { expect, test, type Page } from '@playwright/test';
import { api, isTouch, newGameAndLaunch, openFresh, press, waitUntil, type PlayerInfo } from './helpers.ts';

interface TouchInfo {
  visible: boolean;
  steer: boolean;
  aim: boolean;
  steerVector: { x: number; y: number };
  aimVector: { x: number; y: number };
}

async function zoneCenter(page: Page, testId: string): Promise<{ x: number; y: number }> {
  const box = (await page.getByTestId(testId).boundingBox())!;
  return { x: box.x + box.width * 0.5, y: box.y + box.height * 0.6 };
}

test.describe('platform behaviour', () => {
  test('falls back to the 2D star map and science notes without WebGL 2', async ({ page }) => {
    await page.goto('/?nowebgl=1');
    await expect(page.getByTestId('compat-screen')).toBeVisible();
    await expect(page.getByText('did not provide WebGL 2')).toBeVisible();
    await expect(page.getByTestId('compat-map')).toBeVisible();
    await expect(page.getByTestId('compat-map').getByText(/Alpha Centauri/).first()).toBeVisible();
    await press(page, 'compat-about');
    await expect(page.getByText(/About the science/i).first()).toBeVisible();
  });

  test('taking over the controls cancels docking (and the free flight command does too)', async ({ page }) => {
    await openFresh(page);
    await newGameAndLaunch(page, 6);
    const autopilot = async () => (await api<PlayerInfo | null>(page, 'player'))?.autopilot;
    const startDocking = async () => {
      await api(page, 'selectTarget', 'station:earth-port');
      await waitUntil(page, 'dock offered', async () => (await api<{ context: { label: string } | null }>(page, 'hud'))?.context?.label === 'Dock', 10_000);
      if (await isTouch(page)) await press(page, 'touch-context');
      else await page.keyboard.press('KeyE');
      await waitUntil(page, 'docking autopilot running', async () => (await autopilot()) === 'dock', 10_000);
    };

    await startDocking();
    if (await isTouch(page)) {
      // Push the steering stick: that is taking over the controls.
      const c = await zoneCenter(page, 'touch-steer');
      const cdp = await page.context().newCDPSession(page);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: c.x, y: c.y, id: 7 }] });
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: c.x + 60, y: c.y - 30, id: 7 }] });
      await waitUntil(page, 'autopilot off after steering', async () => (await autopilot()) === 'none', 5_000);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    } else {
      await page.keyboard.down('KeyW');
      await waitUntil(page, 'autopilot off after throttle', async () => (await autopilot()) === 'none', 5_000);
      await page.keyboard.up('KeyW');
      // The Free flight command on the rail cancels a second docking attempt.
      await startDocking();
      await press(page, 'hud-cmd-cancel-autopilot');
      await waitUntil(page, 'autopilot off after free flight', async () => (await autopilot()) === 'none', 5_000);
    }
    await page.waitForTimeout(4000);
    expect(await api(page, 'mode')).toBe('flight');
    expect(await autopilot()).toBe('none');
  });

  test('buys a ship at the shipyard: it waits on the pad and flies with its own loadout', async ({ page }) => {
    await openFresh(page);
    await press(page, 'title-play');
    await press(page, 'intro-ok');
    await press(page, 'room-deck');
    await api(page, 'setCredits', 20_000);
    await press(page, 'station-ships');
    await press(page, 'buy-ship-ship.freighter.2.halden');
    await press(page, 'ship-confirm');
    const s = await api<{ credits: number; ship: { model: string; ammo: Record<string, number> } }>(page, 'state');
    expect(s.ship.model).toBe('ship.freighter.2.halden');
    expect(s.ship.ammo['launcher-1']).toBe(6);
    expect(s.credits).toBeLessThan(20_000);
    await press(page, 'window-close');
    await expect(page.getByTestId('ship-status')).toContainText('Halden Shearwater');
    await press(page, 'dock-launch');
    await press(page, 'sheet-close');
    await waitUntil(page, 'undocked', async () => (await api<PlayerInfo | null>(page, 'player'))?.autopilot === 'none');
    const hud = await api<{ weapon: string; missiles: number; launcher: string | null }>(page, 'hud');
    expect(hud).toMatchObject({ weapon: '2× Kestrel Mk II', missiles: 6, launcher: 'Seekers' });
  });

  test('starts audio only after a user gesture', async ({ page }) => {
    await openFresh(page);
    expect(await api(page, 'audioState')).toBe('locked');
    await press(page, 'title-controls');
    await waitUntil(page, 'audio running', async () => (await api(page, 'audioState')) !== 'locked', 10_000);
    expect(['running', 'unavailable']).toContain(await api(page, 'audioState'));
  });

  test('reload resumes a mid-flight save at the same place', async ({ page }) => {
    await openFresh(page);
    await newGameAndLaunch(page, 6);
    await api(page, 'setTimeScale', 4);
    await page.waitForTimeout(3000);
    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await api(page, 'flush');
    const before = (await api<PlayerInfo>(page, 'player'))!;
    await page.reload();
    await press(page, 'title-continue');
    await waitUntil(page, 'flying again', async () => (await api(page, 'mode')) === 'flight');
    const after = (await api<PlayerInfo>(page, 'player'))!;
    const moved = Math.hypot(...after.position.map((v, i) => v - before.position[i]!));
    expect(moved).toBeLessThan(400);
    const state = await api<{ ship: { cargo: Record<string, number> }; jobs: Record<string, unknown> }>(page, 'state');
    expect(state.ship.cargo.medical).toBe(6);
    expect(state.jobs.lifeline).toBeTruthy();
  });

  test('pauses simulation while hidden and does not teleport on resume', async ({ page }) => {
    await openFresh(page);
    await newGameAndLaunch(page, 6);
    // Fly forward at full throttle.
    if (await isTouch(page)) {
      const track = (await page.getByTestId('touch-throttle').boundingBox())!;
      await page.touchscreen.tap(track.x + track.width / 2, track.y + 4);
    } else {
      await page.keyboard.down('KeyW');
      await page.waitForTimeout(1500);
      await page.keyboard.up('KeyW');
    }
    await page.waitForTimeout(1500);
    const hide = (hidden: boolean) =>
      page.evaluate((h) => {
        Object.defineProperty(document, 'visibilityState', { value: h ? 'hidden' : 'visible', configurable: true });
        document.dispatchEvent(new Event('visibilitychange'));
      }, hidden);
    await hide(true);
    const atHide = (await api<PlayerInfo>(page, 'player'))!;
    await page.waitForTimeout(3000);
    const whileHidden = (await api<PlayerInfo>(page, 'player'))!;
    expect(whileHidden.position).toEqual(atHide.position);
    await hide(false);
    await page.waitForTimeout(300);
    const resumed = (await api<PlayerInfo>(page, 'player'))!;
    const jump = Math.hypot(...resumed.position.map((v, i) => v - atHide.position[i]!));
    // At ~110 m/s a few frames of motion is fine; 3 s of catch-up (~330 m) would fail.
    expect(jump).toBeLessThan(120);
  });

  test('safe-area insets keep HUD and controls clear of notches and home bars', async ({ page }) => {
    await openFresh(page);
    await page.addStyleTag({ content: ':root{--safe-top:44px!important;--safe-bottom:34px!important;--safe-left:30px!important;--safe-right:30px!important}' });
    await newGameAndLaunch(page, 6);
    const vp = page.viewportSize()!;
    const status = (await page.getByTestId('hud-status').boundingBox())!;
    expect(status.y).toBeGreaterThanOrEqual(44);
    expect(status.x).toBeGreaterThanOrEqual(30);
    const pause = (await page.getByTestId('hud-pause').boundingBox())!;
    expect(pause.x + pause.width).toBeLessThanOrEqual(vp.width - 30);
    if (await isTouch(page)) {
      for (const id of ['touch-throttle', 'touch-boost', 'touch-cruise', 'touch-context']) {
        const b = (await page.getByTestId(id).boundingBox())!;
        expect(b.y + b.height, id).toBeLessThanOrEqual(vp.height - 34);
        expect(b.x, id).toBeGreaterThanOrEqual(0);
      }
    }
  });
});

test.describe('touch controls', () => {
  test.skip(({ isMobile }) => !isMobile, 'touch-only');

  test('two thumbs steer and aim/fire independently (multi-touch)', async ({ page }) => {
    await openFresh(page);
    await newGameAndLaunch(page, 6);
    const client = await page.context().newCDPSession(page);
    const steer = await zoneCenter(page, 'touch-steer');
    const aim = await zoneCenter(page, 'touch-aim');
    const before = (await api<PlayerInfo & { quaternion: number[]; energy: number }>(page, 'player'))!;
    await client.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [
        { x: steer.x, y: steer.y, id: 1 },
        { x: aim.x, y: aim.y, id: 2 },
      ],
    });
    for (let i = 1; i <= 6; i++) {
      await client.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [
          { x: steer.x + i * 10, y: steer.y - i * 6, id: 1 },
          { x: aim.x - i * 8, y: aim.y - i * 9, id: 2 },
        ],
      });
      await page.waitForTimeout(60);
    }
    const t = await api<TouchInfo>(page, 'touchState');
    expect(t.steer).toBe(true);
    expect(t.aim).toBe(true);
    expect(t.steerVector.x).toBeGreaterThan(0.3);
    expect(t.aimVector.x).toBeLessThan(-0.2);
    await page.waitForTimeout(1500);
    const during = (await api<PlayerInfo & { quaternion: number[]; energy: number }>(page, 'player'))!;
    const turned = during.quaternion.some((v, i) => Math.abs(v - before.quaternion[i]!) > 0.02);
    expect(turned).toBe(true);
    // Holding the aim pad fires, which spends weapon energy.
    expect(during.energy).toBeLessThan(before.energy - 5);
    // Lifting only the steering thumb leaves the aim thumb in control. (Chromium's CDP lifts
    // exactly the fingers listed in a touchEnd event.)
    await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [{ x: steer.x + 60, y: steer.y - 36, id: 1 }] });
    const afterLift = await api<TouchInfo>(page, 'touchState');
    expect(afterLift.steer).toBe(false);
    expect(afterLift.aim).toBe(true);
    await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    const released = await api<TouchInfo>(page, 'touchState');
    expect(released.aim).toBe(false);
  });

  test('pointercancel releases both sticks', async ({ page }) => {
    await openFresh(page);
    await newGameAndLaunch(page, 6);
    const client = await page.context().newCDPSession(page);
    const steer = await zoneCenter(page, 'touch-steer');
    const aim = await zoneCenter(page, 'touch-aim');
    await client.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [
        { x: steer.x, y: steer.y, id: 1 },
        { x: aim.x, y: aim.y, id: 2 },
      ],
    });
    await client.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [
        { x: steer.x + 40, y: steer.y, id: 1 },
        { x: aim.x, y: aim.y - 40, id: 2 },
      ],
    });
    expect((await api<TouchInfo>(page, 'touchState')).steer).toBe(true);
    await client.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
    await page.waitForTimeout(100);
    const t = await api<TouchInfo>(page, 'touchState');
    expect(t.steer).toBe(false);
    expect(t.aim).toBe(false);
    expect(t.steerVector).toEqual({ x: 0, y: 0 });
  });

  test('rotating mid-flight keeps the ship and re-lays out the controls', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openFresh(page);
    await newGameAndLaunch(page, 6);
    const before = (await api<PlayerInfo>(page, 'player'))!;
    await page.setViewportSize({ width: 844, height: 390 });
    await page.waitForTimeout(800);
    expect(await api(page, 'mode')).toBe('flight');
    const after = (await api<PlayerInfo>(page, 'player'))!;
    const moved = Math.hypot(...after.position.map((v, i) => v - before.position[i]!));
    expect(moved).toBeLessThan(300);
    const vp = page.viewportSize()!;
    for (const id of ['touch-steer', 'touch-aim', 'touch-boost', 'touch-cruise', 'touch-context', 'touch-throttle', 'hud-pause']) {
      const b = (await page.getByTestId(id).boundingBox())!;
      expect(b.x, id).toBeGreaterThanOrEqual(0);
      expect(b.y, id).toBeGreaterThanOrEqual(0);
      expect(b.x + b.width, id).toBeLessThanOrEqual(vp.width + 1);
      expect(b.y + b.height, id).toBeLessThanOrEqual(vp.height + 1);
    }
  });
});

test.describe('desktop aiming', () => {
  test.skip(({ isMobile }) => !!isMobile, 'desktop-only');

  test('bolts follow the visible cursor: hits a target away from screen centre during a turn', async ({ page }) => {
    await openFresh(page);
    await newGameAndLaunch(page, 6);
    await api(page, 'selectTarget', 'drone:0');
    const vp = page.viewportSize()!;
    const cx = vp.width / 2;
    const cy = vp.height / 2;
    let offCentreTurningHits = 0;
    let lastHits = 0;
    let lastQ: number[] | null = null;
    let down = false;
    await page.keyboard.down('KeyW');
    const start = Date.now();
    while (Date.now() - start < 90_000 && offCentreTurningHits === 0) {
      const hud = await api<{ target: { id: string; lead: { x: number; y: number } | null; distance: number } | null; markers: { id: string; x: number; y: number; onScreen: boolean; edgeAngle: number }[] } | null>(page, 'hud');
      const player = (await api<PlayerInfo & { quaternion: number[] }>(page, 'player'))!;
      const t = hud?.target;
      if (!t) {
        await api(page, 'selectTarget', 'drone:1');
        continue;
      }
      if (t.distance < 450) await page.keyboard.up('KeyW');
      const m = hud!.markers.find((x) => x.id === t.id);
      const aim = t.lead ?? (m && m.onScreen ? { x: m.x, y: m.y } : { x: cx + Math.cos(m?.edgeAngle ?? 0) * 300, y: cy + Math.sin(m?.edgeAngle ?? 0) * 200 });
      await page.mouse.move(aim.x, aim.y);
      if (!down && t.lead && t.distance < 900) {
        await page.mouse.down({ button: 'right' });
        down = true;
      }
      await page.waitForTimeout(100);
      const hits = await api<number>(page, 'dronesHit');
      const turning = lastQ ? lastQ.some((v, i) => Math.abs(v - player.quaternion[i]!) > 0.002) : false;
      const offCentre = Math.hypot(aim.x - cx, aim.y - cy) > 80;
      if (hits > lastHits && turning && offCentre) offCentreTurningHits += hits - lastHits;
      lastHits = hits;
      lastQ = player.quaternion;
    }
    if (down) await page.mouse.up({ button: 'right' });
    await page.keyboard.up('KeyW');
    expect(offCentreTurningHits).toBeGreaterThan(0);
  });
});
