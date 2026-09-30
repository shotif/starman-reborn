import { expect, test, type Page } from '@playwright/test';
import { api, isTouch, openFresh, press, waitUntil } from './helpers.ts';

/**
 * Mining in the real belts (docs/PROCGEN.md §19): a mining laser fitted, Sol's main belt scanned for
 * its source, a rock mined with the Mine action (B on the keyboard, the amber action button on
 * touch) and ore in the hold, then the beam stopped the same way.
 */

interface Mining {
  beam: string | null;
  cut: number;
  pods: number;
  rocks: { id: string; left: number; scanned: boolean; distance: number }[];
}

interface Hud {
  context: { label: string; action: string } | null;
  mining: { active: boolean; ready: boolean; status: string | null } | null;
}

/** The Mine action on the device in use: the B key, or the action button on touch. */
async function mine(page: Page, touch: boolean): Promise<void> {
  if (touch) {
    const btn = page.getByTestId('touch-context');
    await expect(btn).toHaveAttribute('data-action', 'mine');
    await btn.tap();
  } else {
    await page.keyboard.press('KeyB');
  }
}

test('a mining laser in Sol’s main belt: scan the belt, mine a rock, ore in the hold', async ({ page }) => {
  await openFresh(page);
  await press(page, 'title-play');
  await press(page, 'intro-ok');
  const touch = await isTouch(page);
  expect(await api<boolean>(page, 'fit', 'gear.mining-laser.1.eridani')).toBe(true);
  await api(page, 'warp', 'sol');
  await waitUntil(page, 'in flight', async () => (await api<string>(page, 'mode')) === 'flight', 60_000);

  // Into the belt: it is a target, and at it the action button scans it for its source.
  expect(await api<boolean>(page, 'placeNear', { id: 'belt:sol-main-belt', distance: 0 })).toBe(true);
  await api(page, 'selectTarget', 'belt:sol-main-belt');
  await waitUntil(page, 'Scan offered at the belt', async () => (await api<Hud>(page, 'hud'))?.context?.action === 'scan', 30_000);
  await press(page, touch ? 'touch-context' : 'hud-context');
  await expect(page.getByTestId('belt-card')).toContainText('NASA: Asteroids');
  await expect(page.getByTestId('belt-card')).toContainText('2.2–3.2 au');
  await expect(page.getByTestId('belt-card')).toContainText('Placed schematically');
  await press(page, 'sheet-close');

  // The nearest rock, 300 m off.
  await waitUntil(page, 'rocks near the player', async () => ((await api<Mining | null>(page, 'mining'))?.rocks.length ?? 0) > 0, 60_000);
  const rock = [...(await api<Mining>(page, 'mining')).rocks].sort((a, b) => a.distance - b.distance)[0]!;
  await api(page, 'selectTarget', rock.id);
  expect(await api<boolean>(page, 'placeNear', { id: rock.id, distance: 300 })).toBe(true);
  await waitUntil(page, 'Mine offered', async () => (await api<Hud>(page, 'hud'))?.context?.action === 'mine', 30_000);
  if (!touch) await expect(page.getByTestId('hud-context')).toContainText('Mine');
  else await expect(page.getByTestId('touch-context')).toContainText('Mine');

  // Mine: the beam runs, the HUD says so, and ore comes into the hold.
  await mine(page, touch);
  await waitUntil(page, 'the beam cuts', async () => (await api<Mining>(page, 'mining')).beam === rock.id, 20_000);
  await expect(page.getByTestId('hud-mining')).toContainText('Mining Rock');
  await api(page, 'setTimeScale', 4);
  await waitUntil(
    page,
    'ore in the hold',
    async () => ((await api<{ ship: { cargo: Record<string, number> } }>(page, 'state')).ship.cargo.ore ?? 0) > 0,
    180_000,
  );
  expect((await api<Mining>(page, 'mining')).rocks.find((r) => r.id === rock.id)?.scanned).toBe(true);

  // The same action stops it.
  await api(page, 'setTimeScale', 1);
  await waitUntil(page, 'Stop mining offered', async () => (await api<Hud>(page, 'hud'))?.context?.label === 'Stop mining', 20_000);
  await mine(page, touch);
  await waitUntil(page, 'the beam stops', async () => (await api<Mining>(page, 'mining')).beam === null, 20_000);
  await expect(page.getByTestId('hud-mining')).toBeHidden();
});
