import { expect, test, type Page } from '@playwright/test';
import { api, openFresh, press, waitUntil } from './helpers.ts';

/**
 * A faction arc in the browser (docs/PROCGEN.md §14): the first step of Clean Manifests flown for
 * real (words at the relay, the debrief at Halcyon Ring), then its choice, and the journal's record.
 */

type Hooks = { __starman: { completeJobs(ids: string[]): void; warp(id: string): void } };

async function flyAndDock(page: Page, system: string, station: string): Promise<void> {
  await page.evaluate((id) => (window as unknown as Hooks).__starman.warp(id), system);
  await waitUntil(page, 'in flight', async () => (await api(page, 'mode')) === 'flight', 60_000);
  await api(page, 'setTimeScale', 8);
  await api(page, 'goTo', `station:${station}`);
  await waitUntil(page, `docked at ${station}`, async () => {
    const ok = page.getByTestId('discovery-ok');
    if (await ok.isVisible().catch(() => false)) await ok.click().catch(() => {});
    return (await api(page, 'mode')) === 'docked';
  });
}

async function openJobs(page: Page): Promise<void> {
  await press(page, 'room-bar');
  if (!(await page.getByTestId('jobs-window').isVisible().catch(() => false))) await press(page, 'station-jobs');
}

test('Clean Manifests: an audit flown for real, then the choice about Oren Vail', async ({ page }) => {
  await openFresh(page);
  await press(page, 'title-play');
  await press(page, 'intro-ok');
  await page.evaluate(() => (window as unknown as Hooks).__starman.completeJobs(['lifeline']));
  await openJobs(page);
  await expect(page.getByTestId('job-arc.sta.1')).toContainText('Clean Manifests');
  await press(page, 'accept-arc.sta.1');

  // At the relay: the manifests, told once.
  await flyAndDock(page, 'barnard', 'barnard-relay');
  await expect(page.getByTestId('story-dialog')).toContainText('Kettering Line');
  await press(page, 'story-continue');
  // Back at Halcyon Ring: the debrief, and the pay.
  await flyAndDock(page, 'sol', 'earth-port');
  await expect(page.getByTestId('story-dialog')).toContainText('Oren Vail');
  await press(page, 'story-continue');
  const s1 = await api<{ jobs: Record<string, { status: string }>; credits: number }>(page, 'state');
  expect(s1.jobs['arc.sta.1']?.status).toBe('complete');

  // Later in the arc: the decision.
  await page.evaluate(() => (window as unknown as Hooks).__starman.completeJobs(['arc.sta.2', 'arc.sta.3']));
  await openJobs(page);
  await press(page, 'accept-arc.sta.4');
  await waitUntil(page, 'the choice', async () => {
    if (await page.getByTestId('choice-dialog').isVisible().catch(() => false)) return true;
    const next = page.getByTestId('story-continue');
    if (await next.isVisible().catch(() => false)) await next.click().catch(() => {});
    return false;
  }, 30_000);
  await press(page, 'choice-internal');
  await expect(page.getByTestId('story-dialog')).toContainText('quietly removed');
  await press(page, 'story-continue');
  const s2 = await api<{ story: { choices: Record<string, string> }; jobs: Record<string, { status: string }> }>(page, 'state');
  expect(s2.story.choices['sta.vail']).toBe('internal');
  expect(s2.jobs['arc.sta.4']?.status).toBe('complete');

  // The journal keeps the story, and the finale waits on the board.
  await press(page, 'station-journal');
  await expect(page.getByTestId('arc-sta')).toContainText('Step 5 of 5');
  await expect(page.getByTestId('arc-sta')).toContainText('Keep it inside the Authority');
});
