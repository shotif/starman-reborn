import { expect, test, type Page } from '@playwright/test';
import { api, isTouch, openFresh, press, waitUntil, type PlayerInfo } from './helpers.ts';

/**
 * The nine-step prototype journey from the spec (section 3), on desktop (mouse + keyboard) and on
 * a touch viewport. Travel uses the in-game autopilot at an accelerated test time scale; combat on
 * desktop is flown with the real mouse-aim path (cursor on the lead marker, right button held).
 */

interface GameStateLite {
  credits: number;
  location: { systemId: string; dockedAt: string | null };
  ship: { cargo: Record<string, number>; fittings: Record<string, string>; hull: number };
  jobs: Record<string, { status: string; objectiveIndex: number }>;
  pirateOutcome: string;
  reputation: Record<string, number>;
  discoveredBodies: string[];
  visitedSystems: string[];
  flags: Record<string, boolean>;
}

interface HudLite {
  encounterActive: boolean;
  context: { label: string } | null;
  target: { id: string; hostile: boolean; lead: { x: number; y: number } | null; shield?: number; hull?: number } | null;
  markers: { id: string; x: number; y: number; onScreen: boolean; edgeAngle: number }[];
  reticle: { x: number; y: number };
}

const state = (page: Page) => api<GameStateLite>(page, 'state');
const mode = (page: Page) => api<string>(page, 'mode');

async function goToSelected(page: Page): Promise<void> {
  if (await isTouch(page)) {
    await waitUntil(page, 'context action offers Go to', async () => {
      const ctx = (await api<HudLite>(page, 'hud'))?.context;
      return !!ctx && /Go to/.test(ctx.label);
    }, 20_000);
    await press(page, 'touch-context');
  } else {
    await page.keyboard.press('KeyG');
  }
}

async function selectMarker(page: Page, id: string): Promise<void> {
  const marker = page.locator(`.marker:not([hidden])[data-id="${id}"]`);
  await expect(marker).toHaveCount(1);
  // Markers move every frame; dispatch the pointerdown directly on the element.
  await marker.dispatchEvent('pointerdown', { button: 0, pointerType: (await isTouch(page)) ? 'touch' : 'mouse' });
  await waitUntil(page, `target ${id} selected`, async () => (await api<HudLite>(page, 'hud'))?.target?.id === id, 10_000);
}

async function launch(page: Page): Promise<void> {
  await press(page, 'dock-launch');
  await waitUntil(page, 'in flight', async () => (await mode(page)) === 'flight');
  if (await page.getByTestId('controls-sheet').isVisible().catch(() => false)) await press(page, 'sheet-close');
  await waitUntil(page, 'undocked', async () => (await api<PlayerInfo | null>(page, 'player'))?.autopilot === 'none');
}

async function openMap(page: Page): Promise<void> {
  if (await isTouch(page)) await press(page, 'hud-map');
  else await page.keyboard.press('Tab');
  await expect(page.getByTestId('galaxy-map')).toBeVisible();
}

async function jumpTo(page: Page, systemId: string, name: RegExp): Promise<void> {
  await openMap(page);
  await press(page, `map-system-${systemId}`);
  await expect(page.getByTestId('galaxy-map').locator('.gmap-card-sub')).toContainText(name);
  await expect(page.getByTestId('map-jump')).toBeEnabled();
  await press(page, 'map-jump');
  await expect(page.getByTestId('jump-overlay')).toBeVisible();
  await waitUntil(page, `arrived in ${systemId}`, async () => (await mode(page)) === 'flight' && (await state(page)).location.systemId === systemId, 60_000);
}

/** Desktop dogfight: keep the cursor on the lead marker and hold the right mouse button. */
async function fightWithMouse(page: Page, seconds: number): Promise<boolean> {
  const vp = page.viewportSize()!;
  const start = Date.now();
  let down = false;
  while (Date.now() - start < seconds * 1000) {
    const hud = await api<HudLite | null>(page, 'hud');
    if (!hud || !hud.encounterActive) break;
    let t = hud.target;
    if (!t || !t.hostile) {
      await page.keyboard.press('KeyH');
      await page.waitForTimeout(150);
      continue;
    }
    const m = hud.markers.find((x) => x.id === t!.id);
    const aim = t.lead ?? (m && m.onScreen ? { x: m.x, y: m.y } : null);
    if (aim) {
      await page.mouse.move(aim.x, aim.y);
      if (!down) {
        await page.mouse.down({ button: 'right' });
        down = true;
      }
    } else if (m) {
      if (down) {
        await page.mouse.up({ button: 'right' });
        down = false;
      }
      await page.mouse.move(vp.width / 2 + Math.cos(m.edgeAngle) * vp.width * 0.35, vp.height / 2 + Math.sin(m.edgeAngle) * vp.height * 0.35);
    }
    await page.waitForTimeout(120);
    t = null;
  }
  if (down) await page.mouse.up({ button: 'right' });
  return !((await api<HudLite | null>(page, 'hud'))?.encounterActive ?? false);
}

test('the prototype journey: Earth → Mars → Alpha Centauri → free exploration, with resume', async ({ page }) => {
  const touch = await isTouch(page);

  // 1. Title: Play, Controls, About the science. Audio waits for a gesture.
  await openFresh(page);
  expect(await api(page, 'audioState')).toBe('locked');
  await press(page, 'title-controls');
  await expect(page.getByTestId('controls-sheet')).toBeVisible();
  await press(page, 'sheet-close');
  await press(page, 'title-about');
  await expect(page.getByTestId('encyclopedia')).toBeVisible();
  await expect(page.getByTestId('encyclopedia').getByText(/Proxima/).first()).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('encyclopedia')).toBeHidden();

  // 2. New game docked at Earth with a tutorial hook and an optional contract.
  await press(page, 'title-play');
  await press(page, 'intro-ok');
  await expect(page.getByTestId('dock-screen')).toBeVisible();
  const job = page.getByTestId('job-lifeline');
  await expect(job).toContainText('1,000 cr');
  await expect(job).toContainText('Meridian Outpost');
  await expect(job).toContainText('Raider activity');
  await press(page, 'accept-lifeline');

  // 3. Buy medical supplies, seeing capacity, price and destination before confirming.
  await press(page, 'buy-medical');
  const dialog = page.getByTestId('buy-dialog');
  await expect(dialog).toContainText('Unit price');
  await expect(dialog).toContainText('Cargo after');
  await expect(dialog).toContainText('Meridian Outpost buys at 96');
  for (let i = 6; i < 10; i++) await press(page, 'buy-plus');
  await expect(page.getByTestId('buy-qty')).toHaveText('10');
  await press(page, 'buy-confirm');
  expect((await state(page)).ship.cargo.medical).toBe(10);
  expect((await state(page)).credits).toBe(800 - 10 * 38);

  // 4. Launch into Sol, steer, target a waypoint, take the trade lane toward Mars.
  await launch(page);
  expect((await state(page)).location.systemId).toBe('sol');
  const before = (await api<PlayerInfo & { quaternion: number[] }>(page, 'player'))!;
  if (touch) {
    const box = (await page.getByTestId('touch-steer').boundingBox())!;
    const client = await page.context().newCDPSession(page);
    const x = box.x + box.width / 2;
    const y = box.y + box.height * 0.6;
    await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }] });
    await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + 50, y: y - 20, id: 1 }] });
    await page.waitForTimeout(1200);
    await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  } else {
    const vp = page.viewportSize()!;
    await page.mouse.move(vp.width * 0.8, vp.height * 0.35);
    await page.waitForTimeout(1200);
    await page.mouse.move(vp.width / 2, vp.height / 2);
  }
  const turned = (await api<PlayerInfo & { quaternion: number[] }>(page, 'player'))!;
  expect(turned.quaternion.some((v, i) => Math.abs(v - before.quaternion[i]!) > 0.01)).toBe(true);
  await selectMarker(page, 'station:mars-depot');
  await api(page, 'setTimeScale', 6);
  await goToSelected(page);
  let sawLane = false;
  await waitUntil(page, 'raider encounter near Mars', async () => {
    if ((await api<PlayerInfo>(page, 'player'))?.autopilot === 'lane') sawLane = true;
    return (await api<HudLite>(page, 'hud'))?.encounterActive ?? false;
  }, 240_000);
  expect(sawLane).toBe(true);
  await api(page, 'setTimeScale', 1);

  // 5. One readable fight (desktop) or the one-click avoid-combat route (touch).
  await expect(page.getByTestId('encounter-banner')).toBeVisible();
  let fought = false;
  if (!touch) fought = await fightWithMouse(page, 150);
  if (!fought) await press(page, 'avoid-combat');
  await waitUntil(page, 'encounter resolved', async () => (await state(page)).pirateOutcome !== 'none', 120_000);
  const outcome = (await state(page)).pirateOutcome;
  if (!touch) expect(['destroyed', 'escaped', 'bypassed']).toContain(outcome);
  else expect(outcome).toBe('bypassed');
  await api(page, 'setTimeScale', 6);
  if ((await mode(page)) === 'flight' && (await api<PlayerInfo>(page, 'player'))?.autopilot === 'none') {
    await selectMarker(page, 'station:mars-depot');
    await goToSelected(page);
  }
  await waitUntil(page, 'docked at Mars', async () => (await mode(page)) === 'docked', 240_000);
  await api(page, 'setTimeScale', 1);

  // 6. Mars: clearance, sell goods, faction reaction, upgrade, autosave.
  let s = await state(page);
  expect(s.location.dockedAt).toBe('mars-depot');
  expect(s.flags.clearance).toBe(true);
  await expect(page.getByTestId('dock-welcome')).toBeVisible();
  if (outcome === 'destroyed') {
    expect(s.reputation.sta).toBeGreaterThanOrEqual(15);
    await expect(page.getByTestId('dock-welcome')).toContainText('Good shooting');
  }
  await expect(page.getByTestId('voyage-report')).toBeVisible();
  await press(page, 'room-trader');
  await press(page, 'sell-medical');
  for (let i = 0; i < 6; i++) await page.locator('.modal .qty-row button').first().click();
  await expect(page.getByTestId('sell-qty')).toHaveText('4');
  await press(page, 'sell-confirm');
  expect((await state(page)).ship.cargo.medical).toBe(6);
  await press(page, 'room-outfitter');
  await press(page, 'slot-shield');
  await press(page, 'buy-gear.shield-balanced.2.halden');
  await press(page, 'shop-confirm');
  s = await state(page);
  expect(s.ship.fittings.shield).toBe('gear.shield-balanced.2.halden');
  await api(page, 'flush');

  // 7. Star map: Alpha Centauri with its real distance, a route and a fictional fee; jump.
  await launch(page);
  await openMap(page);
  await press(page, 'map-system-alpha-centauri');
  const map = page.getByTestId('galaxy-map');
  const card = map.locator('.gmap-card');
  await expect(card.locator('.gmap-card-sub')).toContainText(/4\.3\d ly from Sol/);
  await expect(card).toContainText(/covered/i);
  await expect(map).toContainText('Star positions and distances based on astronomical data');
  await press(page, 'map-jump');
  await expect(page.getByTestId('jump-overlay')).toContainText('Alpha Centauri');
  await waitUntil(page, 'arrived at Alpha Centauri', async () => (await mode(page)) === 'flight' && (await state(page)).location.systemId === 'alpha-centauri', 60_000);

  // 8. Alpha Centauri: A/B and Proxima are distinct targets; discover Proxima b; deliver at Meridian.
  const targets = await api<{ id: string }[]>(page, 'targets');
  const ids = targets.map((t) => t.id);
  expect(ids).toEqual(expect.arrayContaining(['star:alpha-centauri-a', 'star:alpha-centauri-b', 'star:proxima-centauri', 'planet:proxima-cen-b']));
  await api(page, 'setTimeScale', 6);
  await goToSelected(page);
  await expect(page.getByTestId('discovery-dialog')).toBeVisible({ timeout: 240_000 });
  await expect(page.getByTestId('discovery-dialog')).toContainText('Proxima Centauri b');
  await expect(page.getByTestId('discovery-dialog')).toContainText('Confirmed');
  await expect(page.getByTestId('discovery-dialog').getByRole('link', { name: /NASA Exoplanet Archive/ })).toBeVisible();
  await press(page, 'discovery-ok');
  await waitUntil(page, 'objective moves to Meridian', async () => (await api<HudLite>(page, 'hud'))?.target?.id === 'station:meridian-outpost', 20_000);
  await goToSelected(page);
  await waitUntil(page, 'docked at Meridian', async () => (await mode(page)) === 'docked', 240_000);
  await api(page, 'setTimeScale', 1);
  await press(page, 'deliver-lifeline');
  const done = page.getByTestId('delivery-dialog');
  await expect(done).toContainText('First interstellar delivery complete');
  await expect(done).toContainText('Frontier Cooperative');
  await expect(done.getByTestId('voyage-summary')).toContainText('Net profit');
  await press(page, 'delivery-ok');
  s = await state(page);
  expect(s.jobs.lifeline?.status).toBe('complete');
  expect(s.discoveredBodies).toContain('proxima-cen-b');
  expect(s.credits).toBeGreaterThan(800);

  // 9. Free exploration: Barnard's Star, refresh and resume, then Sirius and Epsilon Eridani.
  await launch(page);
  await jumpTo(page, 'barnard', /5\.9\d ly/);
  await api(page, 'flush');
  await page.reload();
  await press(page, 'title-continue');
  await waitUntil(page, 'resumed in flight at Barnard', async () => (await mode(page)) === 'flight');
  expect((await state(page)).location.systemId).toBe('barnard');
  await jumpTo(page, 'sirius', /8\.6\d ly/);
  await jumpTo(page, 'epsilon-eridani', /10\.\d\d ly/);
  s = await state(page);
  expect([...s.visitedSystems].sort()).toEqual(['alpha-centauri', 'barnard', 'epsilon-eridani', 'sirius', 'sol']);
});
