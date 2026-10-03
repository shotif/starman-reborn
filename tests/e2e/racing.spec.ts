import { expect, test, type Page } from '@playwright/test';
import { api, isTouch, openFresh, press, waitUntil } from './helpers.ts';

/**
 * Races on the lanes (docs/PROCGEN.md §33): at Halcyon Ring's racing club the pilot enters the Moon
 * Loop in the light class; launches, waits in the start box and presses Start; the real racers fly
 * the gates on their own fixed step; a gate taken out of order does not count; the pilot finishes
 * ahead of every racer's worked-out time and of the record, and the card, the prize, the record
 * purse and the rating follow; the racers then really finish in exactly the times worked out; the
 * journal keeps it.
 */

interface Status {
  phase: string;
  gate: number;
  clock: number;
  finish: number | null;
  racers: { id: string; gate: number; tick: number; finish: number | null; gone: boolean }[];
}

interface Race {
  log: { entry?: { course: string; cls: string }; courses: Record<string, { wins: number; record?: number; best?: { raw: number } }> } | null;
  status: Status | null;
  record: number | null;
}

const race = (page: Page) => api<Race>(page, 'race');
const credits = async (page: Page) => (await api<{ credits: number }>(page, 'state')).credits;

/** Clicks through whatever card comes up (a discovery), until nothing does for a moment. */
async function clearCards(page: Page): Promise<void> {
  const ok = page.getByTestId('discovery-ok').last();
  if (await ok.isVisible().catch(() => false)) await ok.click().catch(() => {});
}

test('racing: entered at a club, started from the box, gates in order, a win and a record, the racers’ real times, the journal', async ({ page }) => {
  test.setTimeout(300_000);
  await openFresh(page);
  await press(page, 'title-play');
  await press(page, 'intro-ok');
  await api(page, 'completeJobs', ['lifeline']);
  await api(page, 'setCredits', 5_000);
  const venue = (await api<{ locationId: string; sprint: string; level: number } | null>(page, 'findRaceVenue', { system: 'sol' }))!;
  expect(venue.locationId).toBe('earth-port');

  // The club's window in the bar: the light class's field, par worked out, the Sprint entered.
  await press(page, 'room-bar');
  await press(page, 'station-races');
  await expect(page.getByTestId('races-window')).toBeVisible();
  await expect(page.getByTestId('race-class')).toContainText('light class');
  await expect(page.getByTestId('race-field-sprint').locator('li')).toHaveCount(5);
  await expect(page.getByTestId('race-par-sprint')).not.toContainText('…', { timeout: 30_000 });
  await expect(page.getByTestId('race-record-sprint')).not.toContainText('…');
  const before = await credits(page);
  await press(page, 'race-enter-sprint');
  await expect(page.getByTestId('race-entry')).toContainText('Moon Loop');
  expect(await credits(page)).toBe(before - 30);

  // Launch, into the start box, Start.
  await press(page, 'dock-launch');
  await page.getByTestId('sheet-close').click({ timeout: 5_000 }).catch(() => {});
  await waitUntil(page, 'undocked', async () => (await api<{ autopilot: string } | null>(page, 'player'))?.autopilot === 'none', 60_000);
  expect((await race(page)).status?.phase).toBe('approach');
  await expect(page.getByTestId('hud-race')).toContainText('To the start');
  await api(page, 'raceAt', { gate: -1 });
  const context = (await isTouch(page)) ? 'touch-context' : 'hud-context';
  await waitUntil(page, 'Start on the action', async () => (await api<{ context: { label: string } | null } | null>(page, 'hud'))?.context?.label === 'Start', 15_000);
  await press(page, context);
  await api(page, 'setTimeScale', 8);
  await waitUntil(page, 'the race under way', async () => (await race(page)).status?.phase === 'on', 15_000);
  if (await isTouch(page)) await expect(page.getByTestId('touch-cruise')).toHaveAttribute('data-state', 'sealed');

  // The racers fly for real: once the leader is two gates on, every finish is worked out ahead.
  await waitUntil(page, 'the leader two gates on', async () => (await race(page)).status!.racers.some((r) => r.gate >= 3), 60_000);
  await api(page, 'setTimeScale', 1);
  const field = await api<{ id: string; time: number | null }[]>(page, 'raceField');
  const record = (await race(page)).record!;
  const fastest = Math.min(...field.map((f) => f.time ?? Infinity));
  const target = Math.min(fastest, record) - 2;
  const gates = 6;

  // The start line, then gate 2 before gate 1 (it does not count), then every gate in order.
  const through = async (gate: number, at: number) => {
    await api(page, 'raceAt', { gate, at });
    await waitUntil(page, `gate ${gate} passed`, async () => (await clearCards(page), ((await race(page)).status?.gate ?? 0) > gate || (await race(page)).status?.finish !== null), 15_000);
  };
  await through(0, 0.5);
  await api(page, 'raceAt', { gate: 2, at: target * 0.3 });
  await page.waitForTimeout(2_500);
  expect((await race(page)).status?.gate).toBe(1);
  for (let g = 1; g < gates; g++) await through(g, (target * g) / gates - 1.2);

  // The card: first, the prize and the record purse, the rating.
  const card = page.getByTestId('race-dialog');
  await expect(card).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('race-place')).toContainText('You win the heat.');
  await expect(page.getByTestId('race-record-prize')).toBeVisible();
  await expect(page.getByTestId('race-points')).toContainText('+');
  const won = await race(page);
  expect(won.log?.courses[`${venue.sprint}.light`]?.wins).toBe(1);
  expect(won.log?.courses[`${venue.sprint}.light`]?.record).toBeDefined();
  expect(await credits(page)).toBe(before - 30 + 225 + 300);
  await press(page, 'race-continue');

  // The racers really finish, in exactly the times worked out for them.
  await api(page, 'setTimeScale', 8);
  await waitUntil(page, 'every racer home', async () => ((await race(page)).status?.racers ?? []).every((r) => r.finish !== null || r.gone), 120_000);
  await api(page, 'setTimeScale', 1);
  const home = (await race(page)).status!.racers;
  for (const f of field) {
    const r = home.find((x) => x.id === f.id)!;
    expect(r.finish, `${f.id}'s time`).not.toBeNull();
    expect(Math.abs(r.finish! - f.time!)).toBeLessThan(0.002);
  }

  // Docked again: the journal's racing record and the Racing rating.
  await api(page, 'dockAt', 'earth-port');
  await waitUntil(page, 'docked', async () => (await api<{ location: { dockedAt: string | null } }>(page, 'state')).location.dockedAt === 'earth-port', 30_000);
  await clearCards(page);
  await press(page, 'station-journal');
  await expect(page.getByTestId('races-record')).toContainText('Moon Loop');
  await expect(page.getByTestId('rating-racing')).not.toContainText('Onlooker');
});
