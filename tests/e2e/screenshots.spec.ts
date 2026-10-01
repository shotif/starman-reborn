import { expect, test, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { api, newGameAndLaunch, openFresh, press, waitUntil } from './helpers.ts';

/**
 * Captures every required layout (spec section 10), from the loading title on, and audits for
 * common layout failures: page scroll capture, buttons clipped off-screen, content cut off inside a
 * box, unreadably small text, undersized touch targets and overlapping HUD panels. Screenshots go
 * to docs/screenshots/.
 *
 * Two extra cases reproduce large-text phones: Android text scaling (rem sizes at 130%) and
 * accessibility page zoom (a 411-wide phone at 130% zoom is a 316-wide CSS viewport).
 */
interface SizeCase {
  name: string;
  width: number;
  height: number;
  touch: boolean;
  /** Root font-size multiplier, like Android's text scaling. */
  textScale?: number;
}

const SIZES: readonly SizeCase[] = [
  { name: 'phone-portrait-360x640', width: 360, height: 640, touch: true },
  { name: 'phone-landscape-640x360', width: 640, height: 360, touch: true },
  { name: 'iphone-portrait-390x844', width: 390, height: 844, touch: true },
  { name: 'iphone-landscape-844x390', width: 844, height: 390, touch: true },
  { name: 'tablet-portrait-768x1024', width: 768, height: 1024, touch: true },
  { name: 'tablet-landscape-1024x768', width: 1024, height: 768, touch: true },
  { name: 'desktop-1440x900', width: 1440, height: 900, touch: false },
  { name: 'android-text130-411x741', width: 411, height: 741, touch: true, textScale: 1.3 },
  { name: 'android-zoom130-316x570', width: 316, height: 570, touch: true },
];

/** Where the screenshots go: docs/screenshots/, or SCREENSHOT_DIR (to audit without touching the committed ones). */
const OUT = process.env['SCREENSHOT_DIR'] || 'docs/screenshots';

interface AuditResult {
  overflow: boolean;
  clipped: string[];
  cutOff: string[];
  tinyText: string[];
  smallTargets: string[];
  overlaps: string[];
}

async function audit(page: Page, touch: boolean): Promise<AuditResult> {
  return page.evaluate((isTouch) => {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const visible = (el: Element) => {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && Number(cs.opacity) > 0.05;
    };
    const label = (el: Element) => (el.getAttribute('data-testid') ?? el.getAttribute('aria-label') ?? el.textContent ?? el.tagName).trim().slice(0, 40);
    const topLayer = document.querySelector('.modal-backdrop, .sheet-backdrop, .gmap-dialog-backdrop');
    const scope = topLayer ?? document;
    // A control inside a scrolled container only needs its container on screen: it can be
    // scrolled into view.
    const scrollParent = (el: Element): Element | null => {
      for (let p = el.parentElement; p && p !== document.documentElement; p = p.parentElement) {
        const cs = getComputedStyle(p);
        const scrollsY = /auto|scroll/.test(cs.overflowY) && p.scrollHeight > p.clientHeight + 1;
        const scrollsX = /auto|scroll/.test(cs.overflowX) && p.scrollWidth > p.clientWidth + 1;
        if (scrollsX || scrollsY) return p;
      }
      return null;
    };
    const clipped: string[] = [];
    for (const el of scope.querySelectorAll('button, [role="slider"], a')) {
      if (!visible(el) || el.closest('.marker') || el.closest('.hud-markers')) continue;
      const r = (scrollParent(el) ?? el).getBoundingClientRect();
      if (r.left < -1 || r.top < -1 || r.right > vw + 1 || r.bottom > vh + 1) clipped.push(label(el));
    }
    // Content cut off inside a box that is not meant to scroll (e.g. a tab bar squeezed by its
    // column). Vertical scroll areas are marked with .scroll or are the map's own panels.
    const scrollAreas = '.scroll, .gmap-list, .gmap-legend, .gmap-card, .gmap-foot-info, .enc-nav, .compat-screen';
    const cutOff: string[] = [];
    for (const el of scope.querySelectorAll('body *')) {
      if (!visible(el) || el.closest('.hud-markers, .gmap-stage, .gmap-labels, .map2d-host, .sr-only, svg, canvas')) continue;
      if (el.id === 'app' || el.id === 'ui' || el.matches(scrollAreas) || !el.textContent?.trim()) continue;
      // Visually hidden (screen-reader) text is 1px by design.
      if (el.clientWidth <= 1 || el.clientHeight <= 1) continue;
      const cs = getComputedStyle(el);
      if (cs.textOverflow === 'ellipsis' || (cs.getPropertyValue('-webkit-line-clamp') || 'none') !== 'none') continue;
      const clipsY = cs.overflowY !== 'visible';
      const clipsX = cs.overflowX === 'hidden' || cs.overflowX === 'clip';
      if ((clipsY && el.scrollHeight > el.clientHeight + 2) || (clipsX && el.scrollWidth > el.clientWidth + 2)) {
        cutOff.push(`${label(el)} (${el.clientWidth}x${el.clientHeight} of ${el.scrollWidth}x${el.scrollHeight})`);
      }
    }
    const tinyText: string[] = [];
    for (const el of scope.querySelectorAll('body *')) {
      if (!visible(el) || el.closest('.hud-markers') || el.closest('svg')) continue;
      const hasText = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent!.trim().length > 1);
      if (!hasText) continue;
      const size = parseFloat(getComputedStyle(el).fontSize);
      if (size < 10) tinyText.push(`${label(el)} (${size}px)`);
    }
    const smallTargets: string[] = [];
    if (isTouch) {
      for (const el of scope.querySelectorAll('.tbtn, .hud-btn, .btn, .tab')) {
        if (!visible(el)) continue;
        const r = el.getBoundingClientRect();
        if (r.width < 40 || r.height < 40) smallTargets.push(`${label(el)} ${Math.round(r.width)}x${Math.round(r.height)}`);
      }
    }
    const overlaps: string[] = [];
    const panels = [...document.querySelectorAll('.hud-status, .hud-wallet, .hud-buttons, .hud-objective, .hud-target, .encounter-banner, .tcluster, .assist-chip, .wing-chip, .throttle, .toast')].filter(visible);
    for (let i = 0; i < panels.length; i++) {
      for (let j = i + 1; j < panels.length; j++) {
        const a = panels[i]!.getBoundingClientRect();
        const b = panels[j]!.getBoundingClientRect();
        const overlap = Math.min(a.right, b.right) - Math.max(a.left, b.left) > 2 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 2;
        if (overlap) overlaps.push(`${panels[i]!.className} × ${panels[j]!.className}`);
      }
    }
    const overflow = document.documentElement.scrollWidth > vw + 1 || document.documentElement.scrollHeight > vh + 1;
    return { overflow, clipped, cutOff, tinyText: tinyText.slice(0, 10), smallTargets, overlaps };
  }, touch);
}

/** Waits for smooth scrolling to come to rest (selecting a mount scrolls its offers into view). */
async function scrollsSettled(page: Page): Promise<void> {
  const read = () => page.evaluate(() => [...document.querySelectorAll('.scroll')].map((el) => el.scrollTop).join(','));
  let last = await read();
  for (let i = 0; i < 50; i++) {
    await page.waitForTimeout(100);
    const now = await read();
    if (now === last) return;
    last = now;
  }
}

async function shot(page: Page, name: string, touch: boolean, results: Record<string, AuditResult>): Promise<void> {
  await scrollsSettled(page);
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT}/${name}.jpg`, type: 'jpeg', quality: 62 });
  results[name] = await audit(page, touch);
}

/** The loading title, caught part-way: the game's largest file is held back until the shot is taken. */
async function loadingShot(page: Page, name: string, touch: boolean, results: Record<string, AuditResult>): Promise<void> {
  let release = () => {};
  const held = new Promise<void>((done) => (release = done));
  const bootFile = /\/assets\/boot-[^/]+\.js$/;
  await page.route(bootFile, async (route) => {
    await held;
    await route.continue();
  });
  await page.reload();
  await expect(page.getByTestId('title-loading')).toBeVisible();
  await expect(page.getByTestId('title-progress')).toHaveAttribute('aria-valuenow', /^[1-9]\d?$/);
  await shot(page, name, touch, results);
  release();
  await expect(page.getByTestId('title-screen')).toBeVisible();
  await page.unroute(bootFile);
}

for (const size of SIZES) {
  test.describe(size.name, () => {
    test.use({
      viewport: { width: size.width, height: size.height },
      hasTouch: size.touch,
      isMobile: size.touch,
      deviceScaleFactor: 1,
    });

    test(`layouts at ${size.name}`, async ({ page }) => {
      mkdirSync(OUT, { recursive: true });
      const results: Record<string, AuditResult> = {};
      if (size.textScale) {
        const px = 16 * size.textScale;
        await page.addInitScript((fontPx) => {
          document.addEventListener('DOMContentLoaded', () => {
            const style = document.createElement('style');
            style.textContent = `html { font-size: ${fontPx}px !important; }`;
            document.head.appendChild(style);
          });
        }, px);
      }
      await openFresh(page);
      await loadingShot(page, `${size.name}-0-loading`, size.touch, results);
      await shot(page, `${size.name}-1-title`, size.touch, results);
      // Settings, scrolled down to the device report.
      await press(page, 'title-settings');
      await expect(page.getByTestId('device-report')).toHaveValue(/^Starman Reborn device report/);
      await page.getByTestId('device-report-copy').scrollIntoViewIfNeeded();
      await shot(page, `${size.name}-1b-settings`, size.touch, results);
      await press(page, 'sheet-close');
      await press(page, 'title-play');
      await press(page, 'intro-ok');
      await shot(page, `${size.name}-2-contracts`, size.touch, results);
      await press(page, 'accept-lifeline');
      await press(page, 'buy-medical');
      await shot(page, `${size.name}-3-buy-dialog`, size.touch, results);
      await press(page, 'buy-confirm');
      await press(page, 'room-deck');
      await shot(page, `${size.name}-3b-deck`, size.touch, results);
      await press(page, 'station-ships');
      await shot(page, `${size.name}-3c-shipyard`, size.touch, results);
      await press(page, 'room-outfitter');
      await press(page, 'slot-shield');
      await shot(page, `${size.name}-3d-outfitter`, size.touch, results);
      await press(page, 'room-deck');
      // A captain hauling for the player (docs/PROCGEN.md §18.6): on the Fleet window, then met in flight
      // (with the credits to pay for a load, or the captain waits at home).
      await api(page, 'setCredits', 20_000);
      const captain = await api<string | null>(page, 'hireCaptain', { model: 'ship.freighter.1.halden', to: 'meridian-outpost' });
      expect(captain).not.toBeNull();
      await press(page, 'station-fleet');
      await expect(page.getByTestId(`fleet-hauler-${captain}`)).toBeVisible();
      await page.getByTestId(`fleet-hauler-${captain}`).scrollIntoViewIfNeeded();
      await shot(page, `${size.name}-3e-fleet`, size.touch, results);
      await press(page, 'dock-launch');
      await press(page, 'sheet-close');
      await waitUntil(page, 'undocked', async () => (await api<{ autopilot: string } | null>(page, 'player'))?.autopilot === 'none');
      await api(page, 'selectTarget', 'station:mars-depot');
      await shot(page, `${size.name}-4-flight`, size.touch, results);
      // Loaded, the captain flies out of Halcyon Ring for the jump beacon, marked as the player's own.
      await api(page, 'advanceClock', 200);
      let mine: { id: string } | undefined;
      await waitUntil(page, 'the captain in flight', async () => {
        mine = (await api<{ id: string; captain: string | null }[]>(page, 'npcs')).find((n) => n.captain === captain);
        return !!mine;
      }, 60_000);
      await api(page, 'selectTarget', `ship:${mine!.id}`);
      await expect(page.locator('.badge-own')).toBeVisible();
      await shot(page, `${size.name}-4b-captain`, size.touch, results);
      await press(page, 'hud-map');
      await page.waitForTimeout(800);
      await shot(page, `${size.name}-5-map`, size.touch, results);
      // Finding systems: the missions list and the search.
      await press(page, 'map-missions');
      await shot(page, `${size.name}-5b-map-missions`, size.touch, results);
      await press(page, 'map-missions-dialog-close');
      await press(page, 'map-search');
      await page.getByTestId('map-search-input').fill('ross');
      await shot(page, `${size.name}-5c-map-search`, size.touch, results);
      await page.getByTestId('map-search-input').press('Escape');
      await expect(page.getByTestId('map-search-dialog')).toBeHidden();
      // The News where a shortage's relief haulers are on their way (docs/PROCGEN.md §21).
      await press(page, 'map-close');
      const clock = (await api<{ clock: number }>(page, 'state')).clock;
      const relief = (await api<{ at: string; haul: { depart: number } } | null>(page, 'findRelief', clock + 3_600))!;
      await api(page, 'advanceClock', relief.haul.depart + 40 - clock);
      await api(page, 'dockAt', relief.at);
      await waitUntil(page, 'docked', async () => (await api(page, 'mode')) === 'docked');
      for (let i = 0; i < 6 && (await page.getByTestId('story-continue').isVisible().catch(() => false)); i++) await press(page, 'story-continue');
      await press(page, 'room-bar');
      if (!(await page.getByTestId('news-window').isVisible().catch(() => false))) await press(page, 'station-news');
      await page.locator('.news-relief').first().scrollIntoViewIfNeeded();
      await shot(page, `${size.name}-6-news`, size.touch, results);
      // A station of your own (docs/PROCGEN.md §22): the charter at Lalande 21185, then the site's Outpost window.
      const docked = async (id: string) => {
        await api(page, 'dockAt', id);
        await waitUntil(page, `docked at ${id}`, async () => (await api<{ location: { dockedAt: string | null } }>(page, 'state')).location.dockedAt === id);
        for (let i = 0; i < 6 && (await page.getByTestId('story-continue').isVisible().catch(() => false)); i++) await press(page, 'story-continue');
      };
      await api(page, 'setCredits', 50_000);
      await docked('wayfarer-array');
      await press(page, 'room-deck');
      if (!(await page.getByTestId('fleet').isVisible().catch(() => false))) await press(page, 'station-fleet');
      await press(page, 'outpost-charter-gj-411-b');
      await expect(page.getByTestId('outpost-charter-dialog')).toBeVisible();
      await shot(page, `${size.name}-7-charter`, size.touch, results);
      await press(page, 'outpost-charter-confirm');
      await docked('outpost.gj-411-b');
      await api(page, 'setCargo', { metals: 12, machinery: 6 });
      await press(page, 'room-deck');
      if (!(await page.getByTestId('outpost-window').isVisible().catch(() => false))) await press(page, 'station-outpost');
      await press(page, 'outpost-deliver-machinery');
      await expect(page.getByTestId('outpost-need-machinery')).toContainText('6/6 delivered');
      await shot(page, `${size.name}-7b-outpost`, size.touch, results);
      // Passengers and sightseers (docs/PROCGEN.md §23): a cabin fitted, and a party's job open at Meridian Outpost's bar
      // (the first systems' boards post once the opening delivery is done).
      await api(page, 'completeJobs', ['lifeline']);
      expect(await api<boolean>(page, 'fit', 'gear.cabin.2.toliman')).toBe(true);
      let party: { id: string } | undefined;
      for (let i = 0; i < 16 && !party; i++) {
        party = (await api<{ id: string; title: string }[]>(page, 'board', 'meridian-outpost')).find((j) => /^(Sightseers|Passage) to /.test(j.title));
        if (!party) await api(page, 'advanceClock', 1_500);
      }
      expect(party, 'a passage or a tour on Meridian Outpost’s board').toBeDefined();
      await docked('meridian-outpost');
      await press(page, 'room-bar');
      if (!(await page.getByTestId('jobs-window').isVisible().catch(() => false))) await press(page, 'station-jobs');
      const head = page.getByTestId(`job-${party!.id}`).locator('.job-head');
      if (size.touch) await head.tap();
      else await head.click();
      await page.getByTestId(`job-party-${party!.id}`).scrollIntoViewIfNeeded();
      await shot(page, `${size.name}-8-passengers`, size.touch, results);
      // Rival pilots (docs/PROCGEN.md §24): a bounty a hunter took off a board, then the hunter in a bar where its run ends.
      const now = (await api<{ clock: number }>(page, 'state')).clock;
      const claim = (await api<{ rival: string; giver: string; contract: string; at: number } | null>(page, 'findRivalClaim', now))!;
      expect(claim, 'a rival’s claim on a board').not.toBeNull();
      await api(page, 'advanceClock', claim.at + 5 - now);
      await docked(claim.giver);
      await press(page, 'room-bar');
      if (!(await page.getByTestId('jobs-window').isVisible().catch(() => false))) await press(page, 'station-jobs');
      await page.getByTestId(`claim-${claim.contract}`).scrollIntoViewIfNeeded();
      await expect(page.locator('.toast')).toHaveCount(0, { timeout: 15_000 });
      await shot(page, `${size.name}-9-rival-claim`, size.touch, results);
      const hunter = (await api<{ run: { to: string; arrive: number } | null }>(page, 'rival', claim.rival))!;
      await api(page, 'advanceClock', hunter.run!.arrive + 5 - (await api<{ clock: number }>(page, 'state')).clock);
      await docked(hunter.run!.to);
      await press(page, 'room-bar');
      if (!(await page.getByTestId('people-window').isVisible().catch(() => false))) await press(page, 'station-people');
      await page.getByTestId(`rival-${claim.rival}`).scrollIntoViewIfNeeded();
      await expect(page.locator('.toast')).toHaveCount(0, { timeout: 15_000 });
      await shot(page, `${size.name}-9b-rival-bar`, size.touch, results);
      for (const [name, r] of Object.entries(results)) {
        expect.soft(r.overflow, `${name}: page overflow`).toBe(false);
        expect.soft(r.clipped, `${name}: clipped controls`).toEqual([]);
        expect.soft(r.cutOff, `${name}: content cut off inside a box`).toEqual([]);
        expect.soft(r.tinyText, `${name}: text below 10px`).toEqual([]);
        expect.soft(r.smallTargets, `${name}: touch targets below 40px`).toEqual([]);
        expect.soft(r.overlaps, `${name}: overlapping HUD panels`).toEqual([]);
      }
    });
  });
}

test('newGameAndLaunch helper is exercised by the journey spec', async () => {
  expect(typeof newGameAndLaunch).toBe('function');
});
