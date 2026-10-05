import { expect, test, type Page } from '@playwright/test';
import { api, openFresh, press, waitUntil } from './helpers.ts';

/**
 * People at your outposts (docs/PROCGEN.md §41): a refinery chartered in Sol's main belt and its
 * frame built, its quartermaster comes; the Outpost window's People shows them and the spirit; the
 * first ask comes some hours on, told in a toast and the Fleet window's line; done (goods handed
 * over, or someone fetched home), the quartermaster says so and the spirit and income rise; the next
 * ask is said in a word as the pilot docks.
 */

type Hooks = { __starman: { completeJobs(ids: string[]): void; dockAt(id: string): void } };
interface Ask {
  n: number;
  slot: number;
  kind: 'goods' | 'fetch' | 'scan';
  good?: string;
  qty?: number;
  who?: string;
  stationId?: string;
  made: number;
}
interface Folk {
  people: { slot: number; trade: string; name: string }[];
  record: { spirit: number; steps: number[]; asked: number; ask?: Ask; told: number };
  next: number | null;
  spirit: number;
  income: number;
}
interface FolkState {
  clock: number;
  location: { dockedAt: string | null };
  world: { outposts?: { stage: number }[] };
}

const SITE = 'belt.sol-main-belt';
const OUTPOST = `outpost.${SITE}`;
const state = (page: Page) => api<FolkState>(page, 'state');
const folk = (page: Page) => api<Folk | null>(page, 'folk');

/** Clicks through whatever is said, until nothing more comes for a second. */
async function hearOut(page: Page): Promise<void> {
  const next = page.getByTestId('story-continue').or(page.getByTestId('folk-continue')).first();
  for (let quiet = 0, i = 0; quiet < 3 && i < 40; i++) {
    if (await next.isVisible().catch(() => false)) {
      quiet = 0;
      await next.click().catch(() => {});
    } else quiet++;
    await page.waitForTimeout(300);
  }
}

async function dockAt(page: Page, id: string, listen = false): Promise<void> {
  await page.evaluate((loc) => (window as unknown as Hooks).__starman.dockAt(loc), id);
  await waitUntil(page, `docked at ${id}`, async () => (await state(page)).location.dockedAt === id);
  if (!listen) await hearOut(page);
}

/** Opens a window of a room (the buttons toggle: press only when it is not open already). */
async function openWindow(page: Page, room: string, button: string, content: string): Promise<void> {
  await press(page, room);
  if (!(await page.getByTestId(content).isVisible().catch(() => false))) await press(page, button);
  await expect(page.getByTestId(content)).toBeVisible();
}

/** Moves the clock on past the next ask (an hour on: what comes late in an hour waits for it to be paid, §41.3). */
async function toNextAsk(page: Page): Promise<Ask> {
  const f = (await folk(page))!;
  expect(f.next).not.toBeNull();
  await api(page, 'advanceClock', f.next! - (await state(page)).clock + 3_660);
  await waitUntil(page, 'an ask', async () => !!(await folk(page))?.record.ask);
  return (await folk(page))!.record.ask!;
}

test('people at your outpost: its quartermaster asks, the ask is done, the spirit rises, and the next ask is said on docking', async ({ page }) => {
  await openFresh(page);
  await press(page, 'title-play');
  await press(page, 'intro-ok');
  await page.evaluate(() => (window as unknown as Hooks).__starman.completeJobs(['lifeline']));
  await api(page, 'setCredits', 80_000);

  // A refinery chartered in Sol's main belt from Earth Port, its frame built: its quartermaster comes.
  await dockAt(page, 'earth-port');
  await openWindow(page, 'room-deck', 'station-fleet', 'fleet');
  await press(page, `outpost-charter-${SITE}`);
  const name = await page.getByTestId('outpost-name').inputValue();
  await press(page, 'outpost-charter-confirm');
  await dockAt(page, OUTPOST);
  await api(page, 'setCargo', { 'habitat-modules': 8, metals: 20, machinery: 6 });
  await openWindow(page, 'room-deck', 'station-outpost', 'outpost-window');
  for (const good of ['habitat-modules', 'metals', 'machinery']) await press(page, `outpost-deliver-${good}`);
  await waitUntil(page, 'the outpost open', async () => (await state(page)).world.outposts?.[0]?.stage === 1);
  await openWindow(page, 'room-deck', 'station-outpost', 'outpost-window');
  const f0 = (await folk(page))!;
  expect(f0.people).toHaveLength(1);
  expect(f0.people[0]!.trade).toBe('quartermaster');
  const qm = f0.people[0]!.name;
  await expect(page.getByTestId('outpost-people')).toBeVisible();
  await expect(page.getByTestId('folk-person-0')).toContainText(qm);
  await expect(page.getByTestId('folk-person-0')).toContainText('Quartermaster');
  await expect(page.getByTestId('folk-band')).toHaveText('Steady');
  await expect(page.getByTestId('folk-spirit')).toContainText('Spirit steady (50): income +0%');
  await expect(page.getByTestId('folk-no-ask')).toBeVisible();

  // Some hours on, the first ask: a toast, and the Outpost window says what it needs.
  const ask = await toNextAsk(page);
  expect(ask.slot).toBe(0);
  await expect(page.getByText(new RegExp(`At ${name}, ${qm} asks:`)).first()).toBeVisible();
  await openWindow(page, 'room-deck', 'station-outpost', 'outpost-window');
  await expect(page.getByTestId('folk-ask')).toContainText(`${qm} asks`);
  await expect(page.getByTestId('folk-ask-needs')).not.toBeEmpty();

  // Done: goods handed over from the hold, or the one waiting fetched home.
  if (ask.kind === 'goods') {
    await expect(page.getByTestId('folk-hand-over')).toBeDisabled();
    await api(page, 'setCargo', { [ask.good!]: ask.qty! });
    await openWindow(page, 'room-deck', 'station-outpost', 'outpost-window');
    await press(page, 'folk-hand-over');
  } else {
    expect(ask.kind).toBe('fetch');
    await dockAt(page, ask.stationId!);
    await expect(page.getByText(`${ask.who} comes aboard for ${name}.`).first()).toBeVisible();
    await dockAt(page, OUTPOST, true);
  }
  await expect(page.getByTestId('folk-dialog')).toBeVisible();
  await expect(page.getByTestId('folk-line-0')).toContainText(qm);
  await press(page, 'folk-continue');
  await hearOut(page);
  const f1 = (await folk(page))!;
  expect(f1.record.steps[0]).toBe(1);
  expect(f1.record.ask).toBeUndefined();
  expect(f1.spirit).toBeGreaterThan(f0.spirit);
  await openWindow(page, 'room-deck', 'station-outpost', 'outpost-window');
  await expect(page.getByTestId('folk-person-0')).toContainText('1 of 2 asks done');
  await expect(page.getByTestId('folk-spirit')).toContainText('from what they have made');

  // The next ask is said in a word as the pilot docks; the Fleet window's line names it.
  await dockAt(page, 'earth-port');
  const next = await toNextAsk(page);
  await openWindow(page, 'room-deck', 'station-fleet', 'fleet');
  await expect(page.getByTestId('outpost-folk-line')).toContainText('asking for');
  await dockAt(page, OUTPOST, true);
  await expect(page.getByTestId('folk-dialog')).toBeVisible();
  await expect(page.getByTestId(`folk-line-${next.slot}`)).toBeVisible();
  await press(page, 'folk-continue');
  expect((await folk(page))!.record.told).toBe((await state(page)).clock);
});
