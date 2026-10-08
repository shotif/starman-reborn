import { expect, test, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { api, clearCentreAudit, newGameAndLaunch, openFresh, press, waitUntil } from './helpers.ts';

/**
 * Captures every required layout (spec section 10), from the loading title on, and audits for
 * common layout failures: page scroll capture, buttons clipped off-screen, content cut off inside a
 * box, unreadably small text, undersized touch targets, overlapping HUD panels and, in touch flight,
 * anything that stays on screen in the middle of the view (the clear centre, docs/PROCGEN.md §52).
 * Screenshots go to docs/screenshots/.
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
  /** Touch flight: what stays on screen in the clear centre, and HUD buttons out of a thumb's reach. */
  clearCentre: string[];
}

async function audit(page: Page, touch: boolean): Promise<AuditResult> {
  const found = await layoutAudit(page, touch);
  // In touch flight with nothing open over it, the middle of the view stays clear (docs/PROCGEN.md §52).
  const flying =
    touch &&
    (await page.evaluate(() => {
      const controls = document.querySelector('[data-testid="touch-controls"]');
      return !!controls && !controls.hasAttribute('hidden') && !document.querySelector('.modal-backdrop, .sheet-backdrop, .gmap-dialog-backdrop');
    }));
  if (!flying) return { ...found, clearCentre: [] };
  const centre = await clearCentreAudit(page);
  return { ...found, clearCentre: [...centre.into, ...centre.covered.map((name) => `${name} (out of reach)`)] };
}

async function layoutAudit(page: Page, touch: boolean): Promise<Omit<AuditResult, 'clearCentre'>> {
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
    const panels = [...document.querySelectorAll('.hud-status, .hud-wallet, .hud-buttons, .hud-objective, .hud-race, .hud-battle, .hud-target, .hail-banner, .encounter-banner, .tbtn, .assist-chip, .wing-chip, .avoid-chip, .throttle-track, .zone-hint, .toast')].filter(visible);
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
      // One journey through every screen: at the largest size, drawn in software, it takes about a quarter of an hour.
      test.setTimeout(25 * 60_000);
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
      /** Clicks through whatever is said (a story's lines, the people of an outpost on docking, §41.4) until nothing more comes. */
      const quiet = async () => {
        for (let q = 0, i = 0; q < 3 && i < 30; i++) {
          const next = page.getByTestId('story-continue').or(page.getByTestId('folk-continue')).first();
          if (await next.isVisible().catch(() => false)) {
            q = 0;
            await next.click().catch(() => {});
          } else q++;
          await page.waitForTimeout(250);
        }
      };
      const docked = async (id: string) => {
        await api(page, 'dockAt', id);
        await waitUntil(page, `docked at ${id}`, async () => (await api<{ location: { dockedAt: string | null } }>(page, 'state')).location.dockedAt === id);
        await quiet();
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
      // Stellar death, as fiction (docs/PROCGEN.md §25): Betelgeuse's supernova in the News at Ledger Institute, a job
      // there to watch it, and the supernova in flight, picked out and marked as fiction.
      const skyNow = (await api<{ clock: number }>(page, 'state')).clock;
      await api(page, 'skyFrom', skyNow - 1_200);
      await docked('ledger-institute');
      await press(page, 'room-bar');
      if (!(await page.getByTestId('jobs-window').isVisible().catch(() => false))) await press(page, 'station-jobs');
      const watch = page.locator('[data-testid^="job-c.ledger-institute."][data-testid$=".sky-first"]');
      const watchId = (await watch.getAttribute('data-testid'))!.slice('job-'.length);
      if (size.touch) await watch.locator('.job-head').tap();
      else await watch.locator('.job-head').click();
      await press(page, `accept-${watchId}`);
      await press(page, 'station-news');
      await page.getByTestId('sky-news').evaluate((el) => el.scrollIntoView({ block: 'start' }));
      await expect(page.locator('.toast')).toHaveCount(0, { timeout: 15_000 });
      await shot(page, `${size.name}-10-sky-news`, size.touch, results);
      const sky = (await api<{ timeline: { peak: number } }>(page, 'sky'))!;
      await api(page, 'advanceClock', sky.timeline.peak + 60 - (await api<{ clock: number }>(page, 'state')).clock);
      await press(page, 'dock-launch');
      if (await page.getByTestId('sheet-close').isVisible().catch(() => false)) await press(page, 'sheet-close');
      await waitUntil(page, 'undocked', async () => {
        const ok = page.getByTestId('discovery-ok').last();
        if (await ok.isVisible().catch(() => false)) await ok.click({ timeout: 2_000 }).catch(() => {});
        return (await api<{ autopilot: string } | null>(page, 'player'))?.autopilot === 'none';
      });
      await api(page, 'selectTarget', 'sky:betelgeuse');
      await expect(page.locator('.toast')).toHaveCount(0, { timeout: 20_000 });
      // Nose a little under the star, so it shows above the ship (less on short screens, under the target panel).
      expect(await api<boolean>(page, 'face', { id: 'sky:betelgeuse', below: size.height < 500 ? 4 : 9 })).toBe(true);
      await shot(page, `${size.name}-10b-supernova`, size.touch, results);
      // Gluts that ship out (docs/PROCGEN.md §21.6): the News at a station with a glut, its shipments loading.
      const glutFrom = (await api<{ clock: number }>(page, 'state')).clock + 600;
      const glut = (await api<{ eventId: string; at: string; start: number } | null>(page, 'findGlut', glutFrom))!;
      expect(glut, 'a glut that ships out').not.toBeNull();
      await api(page, 'advanceClock', glut.start + 60 - (await api<{ clock: number }>(page, 'state')).clock);
      await docked(glut.at);
      await press(page, 'room-bar');
      if (!(await page.getByTestId('news-window').isVisible().catch(() => false))) await press(page, 'station-news');
      await page.getByTestId(`news-${glut.eventId}`).evaluate((el) => el.scrollIntoView({ block: 'start' }));
      await expect(page.locator('.toast')).toHaveCount(0, { timeout: 15_000 });
      await shot(page, `${size.name}-11-glut-news`, size.touch, results);
      // Pyre, the invented star (docs/PROCGEN.md §26): its alarm in the News at its observatory, the star in flight
      // marked as invented, the ship carried out when it explodes, its black hole, and its card on the star map.
      const sky2 = (await api<{ timeline: { bhGone: number } }>(page, 'sky'))!;
      const edgeNow = (await api<{ clock: number }>(page, 'state')).clock;
      expect(await api<boolean>(page, 'edgeAt', Math.max(edgeNow, sky2.timeline.bhGone) + 60)).toBe(true);
      const pyre = (await api<{ timeline: { warning: number; breakout: number; laneOpens: number }; holeId: string }>(page, 'pyre'))!;
      await api(page, 'advanceClock', pyre.timeline.warning + 90 - edgeNow);
      await docked('pyre-observatory');
      await press(page, 'room-bar');
      if (!(await page.getByTestId('news-window').isVisible().catch(() => false))) await press(page, 'station-news');
      await page.getByTestId('edge-news').evaluate((el) => el.scrollIntoView({ block: 'start' }));
      await expect(page.locator('.toast')).toHaveCount(0, { timeout: 15_000 });
      await shot(page, `${size.name}-12-pyre-news`, size.touch, results);
      await press(page, 'dock-launch');
      if (await page.getByTestId('sheet-close').isVisible().catch(() => false)) await press(page, 'sheet-close');
      await waitUntil(page, 'undocked', async () => {
        const ok = page.getByTestId('discovery-ok').last();
        if (await ok.isVisible().catch(() => false)) await ok.click({ timeout: 2_000 }).catch(() => {});
        return (await api<{ autopilot: string } | null>(page, 'player'))?.autopilot === 'none';
      });
      await api(page, 'selectTarget', 'star:pyre');
      await expect(page.locator('.toast')).toHaveCount(0, { timeout: 20_000 });
      expect(await api<boolean>(page, 'face', { id: 'star:pyre', below: size.height < 500 ? 4 : 9 })).toBe(true);
      await shot(page, `${size.name}-12b-pyre-flight`, size.touch, results);
      await api(page, 'advanceClock', pyre.timeline.breakout + 2 - (await api<{ clock: number }>(page, 'state')).clock);
      await expect(page.getByTestId('pyre-rescue-dialog')).toBeVisible();
      // The radio may speak between the shot and its audit: then it is taken again in a quiet moment.
      const rescueShot = `${size.name}-12c-pyre-rescue`;
      for (let i = 0; i < 5; i++) {
        await expect(page.locator('.toast')).toHaveCount(0, { timeout: 20_000 });
        await shot(page, rescueShot, size.touch, results);
        if (!results[rescueShot]!.overlaps.some((o) => o.includes('toast'))) break;
      }
      await press(page, 'pyre-rescue-ok');
      await waitUntil(page, 'carried out', async () => (await api(page, 'mode')) === 'docked');
      for (let i = 0; i < 6 && (await page.getByTestId('story-continue').isVisible().catch(() => false)); i++) await press(page, 'story-continue');
      await api(page, 'advanceClock', pyre.timeline.laneOpens + 60 - (await api<{ clock: number }>(page, 'state')).clock);
      await api(page, 'warp', 'pyre');
      await waitUntil(page, 'at Pyre', async () => (await api(page, 'mode')) === 'flight');
      if (await page.getByTestId('sheet-close').isVisible().catch(() => false)) await press(page, 'sheet-close');
      await api(page, 'selectTarget', `hole:${pyre.holeId}`);
      // The radio is busy as Pyre's lane opens: the shot is taken again in a quiet moment if it speaks over it.
      const holeShot = `${size.name}-12d-black-hole`;
      for (let i = 0; i < 5; i++) {
        await expect(page.locator('.toast')).toHaveCount(0, { timeout: 20_000 });
        expect(await api<boolean>(page, 'face', { id: `hole:${pyre.holeId}`, below: size.height < 500 ? 3 : 6 })).toBe(true);
        await shot(page, holeShot, size.touch, results);
        if (!results[holeShot]!.overlaps.some((o) => o.includes('toast'))) break;
      }
      await press(page, 'hud-map');
      await press(page, 'map-search');
      await page.getByTestId('map-search-input').fill('pyre');
      await press(page, 'map-search-result-pyre');
      await expect(page.locator('.gmap-card-title')).toHaveText('Pyre');
      await expect(page.getByTestId('gmap-invented')).toBeAttached();
      await page.waitForTimeout(800);
      await shot(page, `${size.name}-12e-pyre-map`, size.touch, results);
      await press(page, 'map-close');
      // Lane encounters (docs/PROCGEN.md §27): a mayday's hail on the HUD, and its card once answered.
      await api(page, 'meetLanes', true);
      const laneFrom = (await api<{ clock: number }>(page, 'state')).clock + 1_200;
      const hail = (await api<{ id: string; systemId: string; start: number } | null>(page, 'findLane', { from: laneFrom, kind: 'mayday', trap: false }))!;
      expect(hail, 'a mayday').not.toBeNull();
      await api(page, 'advanceClock', hail.start + 5 - (await api<{ clock: number }>(page, 'state')).clock);
      await api(page, 'warp', hail.systemId);
      await waitUntil(page, 'flying there', async () => (await api(page, 'mode')) === 'flight');
      if (await page.getByTestId('sheet-close').isVisible().catch(() => false)) await press(page, 'sheet-close');
      await waitUntil(page, 'a hail', async () => (await api<{ hail: { id: string } | null }>(page, 'lanes')).hail?.id === hail.id, 120_000);
      await expect(page.locator('.toast')).toHaveCount(0, { timeout: 20_000 });
      await shot(page, `${size.name}-13-hail`, size.touch, results);
      await press(page, size.touch ? 'touch-context' : 'hail-answer');
      await expect(page.getByTestId('lane-dialog')).toBeVisible();
      await shot(page, `${size.name}-13b-lane-card`, size.touch, results);
      await press(page, 'lane-later');
      await api(page, 'meetLanes', false);
      // Rival stories (docs/PROCGEN.md §28): a friend's loan asked at their table, the journal following two
      // stories, and a rival waiting off a lawless beacon for a duel.
      await api(page, 'setCredits', 20_000);
      await api(page, 'setRival', { id: 'tally', standing: 20, metAgo: 7_200 });
      const table = (await api<{ at: number; locationId: string } | null>(page, 'findRivalDocked', { id: 'tally', from: (await api<{ clock: number }>(page, 'state')).clock + 60 }))!;
      expect(table, 'Tally docked somewhere').not.toBeNull();
      await api(page, 'advanceClock', table.at - (await api<{ clock: number }>(page, 'state')).clock);
      await docked(table.locationId);
      await press(page, 'room-bar');
      if (!(await page.getByTestId('people-window').isVisible().catch(() => false))) await press(page, 'station-people');
      await press(page, 'rival-tally');
      await expect(page.getByTestId('rival-offer')).toBeVisible();
      await expect(page.locator('.toast')).toHaveCount(0, { timeout: 15_000 });
      await shot(page, `${size.name}-14-rival-loan`, size.touch, results);
      await press(page, 'rival-lend');
      await press(page, 'rival-close');
      await api(page, 'setRival', { id: 'lantern', standing: -40, metAgo: 7_200 });
      const feud = (await api<{ holds: { kind: string; from: number; systemId: string | null }[] }>(page, 'rivalStory', 'lantern'))!;
      const duel = feud.holds.find((x) => x.kind === 'duel')!;
      await api(page, 'advanceClock', duel.from + 5 - (await api<{ clock: number }>(page, 'state')).clock);
      await press(page, 'station-journal');
      await page.getByTestId('rivals-record').evaluate((el) => el.scrollIntoView({ block: 'start' }));
      await expect(page.locator('.toast')).toHaveCount(0, { timeout: 20_000 });
      await shot(page, `${size.name}-14b-rival-journal`, size.touch, results);
      await api(page, 'warp', duel.systemId!);
      await waitUntil(page, 'at the duel', async () => (await api(page, 'mode')) === 'flight');
      if (await page.getByTestId('sheet-close').isVisible().catch(() => false)) await press(page, 'sheet-close');
      await waitUntil(page, 'the rival waiting', async () => (await api<{ duel: string | null }[]>(page, 'npcs')).some((n) => n.duel === 'waiting'), 30_000);
      // Off its range, so it waits: the target, and the duel as the objective.
      await api(page, 'placeNear', { id: 'duel:rs.lantern.duel', distance: 2_500 });
      await api(page, 'selectTarget', 'duel:rs.lantern.duel');
      await expect(page.locator('.toast')).toHaveCount(0, { timeout: 20_000 });
      expect(await api<boolean>(page, 'face', { id: 'duel:rs.lantern.duel', below: size.height < 500 ? 2 : 4 })).toBe(true);
      await shot(page, `${size.name}-14c-duel`, size.touch, results);
      // Defending your outpost (docs/PROCGEN.md §29): the frame finished at the site chartered earlier, a turret
      // built, a guard's hire, the Outpost window's defences with the first raid seen coming, and the raid in flight.
      await docked('outpost.gj-411-b');
      await api(page, 'setCargo', { 'habitat-modules': 8, metals: 20 });
      await press(page, 'room-deck');
      if (!(await page.getByTestId('outpost-window').isVisible().catch(() => false))) await press(page, 'station-outpost');
      for (const good of ['habitat-modules', 'metals']) await press(page, `outpost-deliver-${good}`);
      await waitUntil(page, 'the outpost open', async () => ((await api<{ world: { outposts?: { stage: number }[] } }>(page, 'state')).world.outposts?.[0]?.stage ?? 0) >= 1);
      await api(page, 'setCargo', { 'ship-parts': 4, machinery: 2, electronics: 3 });
      await press(page, 'room-deck');
      if (!(await page.getByTestId('outpost-window').isVisible().catch(() => false))) await press(page, 'station-outpost');
      for (const good of ['ship-parts', 'machinery', 'electronics']) await press(page, `outpost-turret-deliver-${good}`);
      await press(page, 'outpost-hire-guards');
      await expect(page.getByTestId('guard-hire-dialog')).toBeVisible();
      await expect(page.locator('.toast')).toHaveCount(0, { timeout: 20_000 });
      await shot(page, `${size.name}-15b-guard-hire`, size.touch, results);
      await press(page, 'guard-confirm');
      const raid = (await api<{ next: { warnAt: number; at: number; window: number } | null }>(page, 'outpostRaid'))!;
      expect(raid.next, 'a raid coming').not.toBeNull();
      await api(page, 'advanceClock', raid.next!.warnAt + 5 - (await api<{ clock: number }>(page, 'state')).clock);
      await press(page, 'room-deck');
      if (!(await page.getByTestId('outpost-window').isVisible().catch(() => false))) await press(page, 'station-outpost');
      await page.getByTestId('outpost-defences').evaluate((el) => el.scrollIntoView({ block: 'start' }));
      await expect(page.locator('.toast')).toHaveCount(0, { timeout: 20_000 });
      await shot(page, `${size.name}-15-outpost-defence`, size.touch, results);
      await press(page, 'dock-launch');
      if (await page.getByTestId('sheet-close').isVisible().catch(() => false)) await press(page, 'sheet-close');
      // The outpost's planet may bring a discovery card, which pauses the flight.
      const dismissDiscovery = async () => {
        const ok = page.getByTestId('discovery-ok').last();
        if (await ok.isVisible().catch(() => false)) await ok.click({ timeout: 2_000 }).catch(() => {});
      };
      await waitUntil(page, 'undocked', async () => (await dismissDiscovery(), (await api<{ autopilot: string } | null>(page, 'player'))?.autopilot === 'none'));
      await api(page, 'advanceClock', raid.next!.at - 1 - (await api<{ clock: number }>(page, 'state')).clock);
      await waitUntil(page, 'the raid struck', async () => (await dismissDiscovery(), (await api<{ flight: { state: string } | null }>(page, 'outpostRaid'))!.flight?.state === 'on'), 60_000);
      await dismissDiscovery();
      await api(page, 'selectTarget', 'station:outpost.gj-411-b');
      // A raid under way keeps the radio busy: a toast may come between the shot and its audit, so
      // the shot is taken again in a quiet moment (the audit still fails if none comes).
      const raidShot = `${size.name}-15c-outpost-raid`;
      for (let i = 0; i < 5; i++) {
        await expect(page.locator('.toast')).toHaveCount(0, { timeout: 30_000 });
        expect(await api<boolean>(page, 'face', { id: 'station:outpost.gj-411-b', below: size.height < 500 ? 2 : 4 })).toBe(true);
        await shot(page, raidShot, size.touch, results);
        if (!results[raidShot]!.overlaps.some((o) => o.includes('toast'))) break;
      }
      // Outposts in the belts (docs/PROCGEN.md §36): a refinery chartered in Sol's main belt (the Fleet
      // window listing both outposts), refining the ore in the hold, and the dialog to give it up.
      await api(page, 'setCredits', 80_000);
      await docked('earth-port');
      await press(page, 'room-deck');
      if (!(await page.getByTestId('fleet').isVisible().catch(() => false))) await press(page, 'station-fleet');
      await press(page, 'outpost-charter-belt.sol-main-belt');
      await expect(page.getByTestId('outpost-charter-belt')).toBeVisible();
      await press(page, 'outpost-charter-confirm');
      await expect(page.locator('.toast')).toHaveCount(0, { timeout: 20_000 });
      await page.getByTestId('outpost').evaluate((el) => el.scrollIntoView({ block: 'start' }));
      await shot(page, `${size.name}-15d-outposts`, size.touch, results);
      await docked('outpost.belt.sol-main-belt');
      await api(page, 'setCargo', { 'habitat-modules': 8, metals: 20, machinery: 6 });
      const openOutpost = async () => {
        await press(page, 'room-deck');
        if (!(await page.getByTestId('outpost-window').isVisible().catch(() => false))) await press(page, 'station-outpost');
      };
      await openOutpost();
      for (const good of ['habitat-modules', 'metals', 'machinery']) await press(page, `outpost-deliver-${good}`);
      await waitUntil(page, 'the refinery open', async () => ((await api<{ world: { outposts?: { site: string; stage: number }[] } }>(page, 'state')).world.outposts?.find((o) => o.site === 'belt.sol-main-belt')?.stage ?? 0) >= 1);
      await api(page, 'setCargo', { ore: 4, water: 2 });
      await openOutpost();
      await press(page, 'outpost-refine-ore');
      await expect(page.getByTestId('outpost-refined')).toHaveText('4/40 this hour');
      await page.getByTestId('outpost-refining').evaluate((el) => el.scrollIntoView({ block: 'start' }));
      await expect(page.locator('.toast')).toHaveCount(0, { timeout: 20_000 });
      await shot(page, `${size.name}-15e-refinery`, size.touch, results);
      // Outposts join the trade (docs/PROCGEN.md §38): the Outpost window's haulers and dock fees.
      await page.getByTestId('outpost-haulers').evaluate((el) => el.scrollIntoView({ block: 'start' }));
      await expect(page.getByTestId('outpost-next-hauler')).toBeVisible();
      await shot(page, `${size.name}-15i-haulers`, size.touch, results);
      await page.getByTestId('outpost-give-up-section').evaluate((el) => el.scrollIntoView({ block: 'start' }));
      await press(page, 'outpost-give-up');
      await expect(page.getByTestId('outpost-give-up-dialog')).toBeVisible();
      await shot(page, `${size.name}-15f-give-up`, size.touch, results);
      await press(page, 'outpost-give-up-cancel');
      // The star map's search finds the refinery by name (§38.4).
      const refinery = (await api<{ world: { outposts?: { site: string; name: string }[] } }>(page, 'state')).world.outposts!.find((o) => o.site === 'belt.sol-main-belt')!.name;
      await press(page, 'dock-map');
      await expect(page.getByTestId('galaxy-map')).toBeVisible();
      await press(page, 'map-search');
      await page.getByTestId('map-search-input').fill(refinery.split(' ')[0]!);
      await expect(page.getByTestId('map-search-result-sol')).toContainText(`Your outpost ${refinery}`);
      await shot(page, `${size.name}-15j-map-outpost`, size.touch, results);
      await page.getByTestId('map-search-input').press('Escape');
      await expect(page.getByTestId('map-search-dialog')).toBeHidden();
      await press(page, 'map-close');
      // Captains supply outposts (docs/PROCGEN.md §37): a ship with a mining laser hired to mine for the
      // refinery (the dialog's estimate), a freighter to supply an outpost, and the Fleet window's captains at
      // work; both recalled at once, so they spend nothing later in the journey.
      await docked('earth-port');
      const minerShip = await api<string>(page, 'parkShip', { model: 'ship.courier.1.halden', fittings: { 'utility-1': 'gear.mining-laser.1.eridani' } });
      const supplyShip = await api<string>(page, 'parkShip', { model: 'ship.freighter.1.halden' });
      await press(page, 'room-deck');
      if (!(await page.getByTestId('fleet').isVisible().catch(() => false))) await press(page, 'station-fleet');
      await press(page, `fleet-hire-${minerShip}`);
      await page.getByTestId('fleet-work').selectOption('mine');
      await expect(page.getByTestId('fleet-mine-pay')).toBeVisible();
      await expect(page.locator('.toast')).toHaveCount(0, { timeout: 20_000 });
      await shot(page, `${size.name}-15g-hire-miner`, size.touch, results);
      await press(page, 'fleet-hire-confirm');
      await press(page, `fleet-hire-${supplyShip}`);
      await page.getByTestId('fleet-work').selectOption('supply');
      await press(page, 'fleet-hire-confirm');
      await page.getByTestId(`fleet-hauler-${minerShip}`).evaluate((el) => el.scrollIntoView({ block: 'start' }));
      await expect(page.locator('.toast')).toHaveCount(0, { timeout: 20_000 });
      await shot(page, `${size.name}-15h-captains`, size.touch, results);
      await press(page, `fleet-recall-${minerShip}`);
      await press(page, `fleet-recall-${supplyShip}`);
      // Your crew (docs/PROCGEN.md §30): a hand looking for a berth at a bar's table, the crew in the
      // bar (hurt and giving notice, a favour to ask), and the favour in their dialog.
      const hand = (await api<{ locationId: string; offerId: string } | null>(page, 'findCrew', { role: 'engineer', heart: 'soft-hearted' }))!;
      expect(hand, 'a soft-hearted engineer looking for a berth').not.toBeNull();
      await docked(hand.locationId);
      const openPeople = async () => {
        await press(page, 'room-bar');
        if (!(await page.getByTestId('people-window').isVisible().catch(() => false))) await press(page, 'station-people');
      };
      await openPeople();
      await press(page, `hand-${hand.offerId}`);
      await expect(page.getByTestId('hand-dialog')).toBeVisible();
      await expect(page.locator('.toast')).toHaveCount(0, { timeout: 20_000 });
      await shot(page, `${size.name}-16-crew-hire`, size.touch, results);
      await press(page, 'hand-hire');
      await api(page, 'crewDeed', { deed: 'rescue', n: 2 });
      await api(page, 'advanceClock', 600);
      await docked(hand.locationId);
      await api(page, 'advanceClock', 3_700);
      await docked(hand.locationId);
      await api(page, 'hurtCrew', 'engineer');
      await api(page, 'setCrew', { role: 'engineer', morale: 20 });
      await api(page, 'advanceClock', 600);
      await docked(hand.locationId);
      await openPeople();
      await expect(page.getByTestId('crew-tag-engineer-notice')).toBeVisible();
      await page.getByTestId('your-crew').evaluate((el) => el.scrollIntoView({ block: 'start' }));
      await expect(page.locator('.toast')).toHaveCount(0, { timeout: 20_000 });
      await shot(page, `${size.name}-16b-crew`, size.touch, results);
      await press(page, 'crew-engineer');
      await expect(page.getByTestId('crew-favour')).toBeVisible();
      // The favour and its buttons in view, on a short screen too.
      await page.getByTestId('crew-favour').evaluate((el) => el.scrollIntoView({ block: 'end' }));
      await shot(page, `${size.name}-16c-crew-favour`, size.touch, results);
      await press(page, 'crew-close');
      // Wrecks to fly to (docs/PROCGEN.md §31): a wreck beacon's site in flight, its log scanned (the
      // first log's lead and its choices), an old derelict's card once boarded, and the journal's trails.
      await api(page, 'meetLanes', true);
      const putAway = async () => {
        const ok = page.getByTestId('discovery-ok').last();
        if (await ok.isVisible().catch(() => false)) await ok.click({ timeout: 2_000 }).catch(() => {});
      };
      const action = size.touch ? 'touch-context' : 'hud-context';
      // A planet near a site may bring a discovery card over the action button: put away, pressed again.
      const pressPast = async (testId: string) => {
        for (let i = 0; i < 10; i++) {
          await putAway();
          const el = page.getByTestId(testId);
          try {
            if (size.touch) await el.tap({ timeout: 3_000 });
            else await el.click({ timeout: 3_000 });
            return;
          } catch {
            // A card came up over it.
          }
        }
        throw new Error(`${testId} could not be pressed`);
      };
      const markSite = async (kind: 'wreck' | 'derelict') => {
        const from = (await api<{ clock: number }>(page, 'state')).clock + 1_200;
        const o = (await api<{ id: string; systemId: string; start: number } | null>(page, 'findLane', { from, kind, trap: false, quiet: true }))!;
        expect(o, `a ${kind} hail`).not.toBeNull();
        await api(page, 'advanceClock', o.start + 5 - (await api<{ clock: number }>(page, 'state')).clock);
        await api(page, 'warp', o.systemId);
        await waitUntil(page, 'flying there', async () => (await api(page, 'mode')) === 'flight');
        if (await page.getByTestId('sheet-close').isVisible().catch(() => false)) await press(page, 'sheet-close');
        await waitUntil(page, `the ${kind} hail`, async () => (await putAway(), (await api<{ hail: { id: string } | null }>(page, 'lanes')).hail?.id === o.id), 120_000);
        await press(page, size.touch ? 'touch-context' : 'hail-answer');
        await press(page, 'lane-go');
        const target = `site:lane.${o.id}`;
        await waitUntil(page, 'the site in the scene', async () => (await api<{ id: string }[]>(page, 'targets')).some((t) => t.id === target), 20_000);
        return target;
      };
      const wreckTarget = await markSite('wreck');
      await api(page, 'placeNear', { id: wreckTarget, distance: 900 });
      await api(page, 'selectTarget', wreckTarget);
      await expect(page.locator('.toast')).toHaveCount(0, { timeout: 20_000 });
      expect(await api<boolean>(page, 'face', { id: wreckTarget, below: size.height < 500 ? 2 : 4 })).toBe(true);
      await shot(page, `${size.name}-17-wreck`, size.touch, results);
      await waitUntil(page, 'Scan', async () => (await putAway(), (await api<{ context: { label: string } | null } | null>(page, 'hud'))?.context?.label === 'Scan'), 20_000);
      await pressPast(action);
      await waitUntil(page, 'the log’s card', async () => (await putAway(), await page.getByTestId('site-dialog').isVisible()), 30_000);
      await expect(page.getByTestId('site-lead')).toBeVisible();
      await expect(page.locator('.toast')).toHaveCount(0, { timeout: 20_000 });
      await shot(page, `${size.name}-17b-site-card`, size.touch, results);
      await press(page, 'site-leave');
      const hulk = await markSite('derelict');
      await api(page, 'placeNear', { id: hulk, distance: 100 });
      await waitUntil(page, 'Board', async () => (await putAway(), (await api<{ context: { label: string } | null } | null>(page, 'hud'))?.context?.label === 'Board'), 20_000);
      await api(page, 'setTimeScale', 4);
      await pressPast(action);
      await waitUntil(page, 'the derelict’s card', async () => (await putAway(), await page.getByTestId('site-dialog').isVisible()), 30_000);
      await api(page, 'setTimeScale', 1);
      await expect(page.locator('.toast')).toHaveCount(0, { timeout: 20_000 });
      await shot(page, `${size.name}-17c-derelict-card`, size.touch, results);
      await press(page, (await page.getByTestId('site-follow').isVisible()) ? 'site-follow' : 'site-close');
      await api(page, 'meetLanes', false);
      await docked('wayfarer-array');
      await press(page, 'station-journal');
      await page.getByTestId('wrecks-record').evaluate((el) => el.scrollIntoView({ block: 'start' }));
      await expect(page.locator('.toast')).toHaveCount(0, { timeout: 20_000 });
      await shot(page, `${size.name}-17d-journal-wrecks`, size.touch, results);
      // Ranks that open doors (docs/PROCGEN.md §32): the promotion card at Lane Officer, the journal's ranks,
      // a commission on the board with its tag, the yard's discount with the rank on the deck, and the News.
      await page.evaluate(() => (window as unknown as { __starman: { setReputation(f: string, v: number): void } }).__starman.setReputation('sta', 45));
      await api(page, 'setRecord', { kills: 25 });
      const rankFrom = (await api<{ clock: number }>(page, 'state')).clock;
      const work = (await api<{ id: string; at: number } | null>(page, 'findCommission', { at: 'earth-port', from: rankFrom, rank: 2 }))!;
      expect(work, 'a commission at Halcyon Ring').not.toBeNull();
      await api(page, 'advanceClock', work.at + 60 - rankFrom);
      await docked('earth-port');
      await expect(page.getByTestId('rank-dialog')).toBeVisible({ timeout: 30_000 });
      await expect(page.locator('.toast')).toHaveCount(0, { timeout: 20_000 });
      await shot(page, `${size.name}-18-rank-card`, size.touch, results);
      await press(page, 'rank-continue');
      if (!(await page.getByTestId('journal').isVisible().catch(() => false))) await press(page, 'station-journal');
      await page.getByTestId('ranks').evaluate((el) => el.scrollIntoView({ block: 'start' }));
      await expect(page.locator('.toast')).toHaveCount(0, { timeout: 20_000 });
      await shot(page, `${size.name}-18b-rank-journal`, size.touch, results);
      await press(page, 'room-bar');
      if (!(await page.getByTestId('jobs-window').isVisible().catch(() => false))) await press(page, 'station-jobs');
      const commission = page.getByTestId(`job-${work.id}`);
      if (!(await page.getByTestId(`accept-${work.id}`).isVisible().catch(() => false))) await commission.locator('.job-head').click();
      await commission.evaluate((el) => el.scrollIntoView({ block: 'start' }));
      await shot(page, `${size.name}-18c-rank-board`, size.touch, results);
      await press(page, 'room-deck');
      if (!(await page.getByTestId('yard-discount').isVisible().catch(() => false))) await press(page, 'station-ships');
      await expect(page.getByTestId('yard-discount')).toBeVisible();
      await shot(page, `${size.name}-18d-rank-yard`, size.touch, results);
      await press(page, 'room-bar');
      if (!(await page.getByTestId('news-window').isVisible().catch(() => false))) await press(page, 'station-news');
      await page.getByTestId('rank-news').evaluate((el) => el.scrollIntoView({ block: 'start' }));
      await shot(page, `${size.name}-18e-rank-news`, size.touch, results);
      // Races on the lanes (docs/PROCGEN.md §33): Halcyon Ring's club, waiting in the start box with the
      // racers on the line, mid-run with the race strip, the result card, the record board, the ratings.
      const raceState = async () => (await api<{ status: { phase: string; gate: number; finish: number | null; racers: { gate: number }[] } | null; record: number | null }>(page, 'race'))!;
      if (!(await page.getByTestId('races-window').isVisible().catch(() => false))) await press(page, 'station-races');
      await expect(page.getByTestId('race-par-sprint')).not.toContainText('…', { timeout: 60_000 });
      await expect(page.locator('.toast')).toHaveCount(0, { timeout: 20_000 });
      await shot(page, `${size.name}-19-race-club`, size.touch, results);
      await expect(page.getByTestId('race-enter-sprint'), (await page.getByTestId('race-lock-sprint').textContent({ timeout: 1_000 }).catch(() => null)) ?? 'entry open').toBeVisible();
      await press(page, 'race-enter-sprint');
      await press(page, 'dock-launch');
      await waitUntil(page, 'undocked', async () => (await api<{ autopilot: string } | null>(page, 'player'))?.autopilot === 'none', 60_000);
      await api(page, 'raceAt', { gate: -1 });
      await waitUntil(page, 'Start on the action', async () => (await api<{ context: { label: string } | null } | null>(page, 'hud'))?.context?.label === 'Start', 15_000);
      await expect(page.locator('.toast')).toHaveCount(0, { timeout: 20_000 });
      await shot(page, `${size.name}-19b-race-start`, size.touch, results);
      await press(page, size.touch ? 'touch-context' : 'hud-context');
      await api(page, 'setTimeScale', 8);
      await waitUntil(page, 'under way', async () => (await raceState()).status?.phase === 'on', 15_000);
      await waitUntil(page, 'the leader a gate on', async () => (await raceState()).status!.racers.some((r) => r.gate >= 2), 60_000);
      await api(page, 'setTimeScale', 1);
      const raceField = await api<{ time: number | null }[]>(page, 'raceField');
      const raceTarget = Math.min(...raceField.map((f) => f.time ?? Infinity), (await raceState()).record ?? Infinity) - 2;
      const through = async (gate: number, at: number) => {
        await api(page, 'raceAt', { gate, at });
        await waitUntil(page, `gate ${gate}`, async () => ((await raceState()).status?.gate ?? 0) > gate || (await raceState()).status?.finish !== null, 15_000);
      };
      await through(0, 0.5);
      await through(1, raceTarget / 6 - 1.2);
      await through(2, (raceTarget * 2) / 6 - 1.2);
      await expect(page.getByTestId('hud-race-split')).not.toBeEmpty();
      await expect(page.locator('.toast')).toHaveCount(0, { timeout: 20_000 });
      await shot(page, `${size.name}-19c-race-gate`, size.touch, results);
      for (let g = 3; g < 6; g++) await through(g, (raceTarget * g) / 6 - 1.2);
      await expect(page.getByTestId('race-dialog')).toBeVisible({ timeout: 15_000 });
      await expect(page.locator('.toast')).toHaveCount(0, { timeout: 20_000 });
      await shot(page, `${size.name}-19d-race-result`, size.touch, results);
      await press(page, 'race-continue');
      await docked('earth-port');
      await press(page, 'room-bar');
      if (!(await page.getByTestId('races-window').isVisible().catch(() => false))) await press(page, 'station-races');
      await page.getByTestId('race-board').evaluate((el) => el.scrollIntoView({ block: 'start' }));
      await expect(page.locator('.toast')).toHaveCount(0, { timeout: 20_000 });
      await shot(page, `${size.name}-19e-race-board`, size.touch, results);
      await press(page, 'station-journal');
      await page.getByTestId('rating-racing').evaluate((el) => el.scrollIntoView({ block: 'center' }));
      await expect(page.locator('.toast')).toHaveCount(0, { timeout: 20_000 });
      await shot(page, `${size.name}-19f-race-rating`, size.touch, results);
      // Wing command (docs/PROCGEN.md §34): the order card in flight, the HUD with a wingman hurt, the
      // wing in the bar (a loyal Seasoned wing, a wary one hurt and giving notice), a word with a
      // wingman, and the journal's wing with one who flew before.
      await api(page, 'setCredits', 50_000);
      const hirePilot = async () => {
        await openPeople();
        await page.locator('[data-testid^="person-w."]').first().click();
        await press(page, (await page.locator('[data-testid^="hire-"]').first().getAttribute('data-testid'))!);
      };
      await hirePilot();
      await docked('mars-depot');
      await hirePilot();
      await docked('earth-port');
      const wingIds = (await api<{ crew: { id: string }[] }>(page, 'wing')).crew.map((w) => w.id);
      expect(wingIds, 'two pilots hired').toHaveLength(2);
      await api(page, 'setWing', { id: wingIds[0], fights: 9, downs: 4, trust: 80 });
      await api(page, 'setWing', { id: wingIds[1], trust: 25, hurt: 'hit' });
      await press(page, 'dock-launch');
      await waitUntil(page, 'undocked', async () => (await api<{ autopilot: string } | null>(page, 'player'))?.autopilot === 'none', 60_000);
      await waitUntil(page, 'the wing out', async () => (await api<{ wing: { count: number } | null }>(page, 'hud'))?.wing?.count === 2, 30_000);
      await expect(page.locator('.toast')).toHaveCount(0, { timeout: 20_000 });
      if (size.touch) await press(page, 'touch-wing');
      else await page.keyboard.press('v');
      await expect(page.getByTestId('wing-orders')).toBeVisible();
      await shot(page, `${size.name}-20-wing-card`, size.touch, results);
      await press(page, 'wing-order-hold');
      await expect(page.getByTestId('wing-orders')).toBeHidden();
      await expect(page.locator('.toast')).toHaveCount(0, { timeout: 20_000 });
      await shot(page, `${size.name}-20b-wing-hud`, size.touch, results);
      await api(page, 'advanceClock', 600);
      await docked('earth-port');
      await openPeople();
      await expect(page.getByTestId(`wing-tag-${wingIds[1]}-notice`)).toBeVisible();
      await page.getByTestId('your-wing').evaluate((el) => el.scrollIntoView({ block: 'start' }));
      await expect(page.locator('.toast')).toHaveCount(0, { timeout: 20_000 });
      await shot(page, `${size.name}-20c-wing-bar`, size.touch, results);
      await press(page, `wing-talk-${wingIds[0]}`);
      await expect(page.getByTestId('wing-dialog')).toBeVisible();
      await shot(page, `${size.name}-20d-wing-dialog`, size.touch, results);
      await press(page, 'wing-close');
      await press(page, `dismiss-${wingIds[1]}`);
      await press(page, 'station-journal');
      await page.getByTestId('wing-record').evaluate((el) => el.scrollIntoView({ block: 'start' }));
      await expect(page.locator('.toast')).toHaveCount(0, { timeout: 20_000 });
      await shot(page, `${size.name}-20e-wing-journal`, size.touch, results);
      // The border in sight (docs/PROCGEN.md §35): a clash at Ross 154's beacon line with its strip and
      // the battle line selected, the Wake's assault on Regent Concourse, the News of it beaten off, and
      // the journal's battles.
      await api(page, 'meetBattles', true);
      await api(page, 'quietPacks', true);
      const nowClock = async () => (await api<{ clock: number }>(page, 'state')).clock;
      const battleNow = async () => (await api<{ flight: { active: string | null; wave: number } | null; seen: { title: string }[] }>(page, 'battle'))!;
      const toBattle = async (kind: 'clash' | 'assault') => {
        const found = (await api<{ id: string; opens: number; title: string } | null>(page, 'findBattle', { system: 'ross-154', kind, from: await nowClock() }))!;
        expect(found, `a ${kind} at Ross 154`).not.toBeNull();
        await api(page, 'advanceClock', found.opens - (await nowClock()) - 40);
        await docked('waymark-waypoint');
        if (await page.getByTestId('rank-dialog').isVisible({ timeout: 3_000 }).catch(() => false)) await press(page, 'rank-continue');
        await press(page, 'dock-launch');
        await waitUntil(page, 'undocked', async () => (await api<{ autopilot: string } | null>(page, 'player'))?.autopilot === 'none', 60_000);
        await api(page, 'setTimeScale', 4);
        // A battle of its kind opens (a clash from the slot before may come first).
        try {
          await waitUntil(page, `the ${kind} opens`, async () => !!(await battleNow()).flight?.active?.startsWith(`${kind}:`), 60_000);
        } catch (e) {
          const why = JSON.stringify({ found, clock: await nowClock(), battle: await api(page, 'battle'), log: (await api<{ world: { border: unknown } }>(page, 'state')).world.border });
          throw new Error(`${(e as Error).message}: ${why}`);
        }
        await api(page, 'setTimeScale', 1);
        return found;
      };
      const winBattle = async (title: string) => {
        let first = true;
        await waitUntil(page, 'the battle won', async () => {
          const b = await battleNow();
          if (b.seen.some((x) => x.title === title)) return true;
          if (b.flight?.active) {
            await api(page, 'downBattleShip', { side: 'wake', byPlayer: first });
            first = false;
          }
          return false;
        }, 60_000);
      };
      const clashFound = await toBattle('clash');
      await api(page, 'selectTarget', 'battle-line');
      await expect(page.getByTestId('hud-battle')).toBeVisible();
      await expect(page.locator('.toast')).toHaveCount(0, { timeout: 20_000 });
      await shot(page, `${size.name}-21-battle-clash`, size.touch, results);
      await winBattle(clashFound.title);
      const assaultFound = await toBattle('assault');
      await expect(page.getByTestId('hud-battle-name')).toHaveText(assaultFound.title);
      await expect(page.locator('.toast')).toHaveCount(0, { timeout: 20_000 });
      await shot(page, `${size.name}-21b-battle-assault`, size.touch, results);
      await winBattle(assaultFound.title);
      await docked('waymark-waypoint');
      if (await page.getByTestId('rank-dialog').isVisible({ timeout: 3_000 }).catch(() => false)) await press(page, 'rank-continue');
      await press(page, 'room-bar');
      if (!(await page.getByTestId('news-window').isVisible().catch(() => false))) await press(page, 'station-news');
      await page.getByTestId('battle-news-0').evaluate((el) => el.scrollIntoView({ block: 'start' }));
      await expect(page.locator('.toast')).toHaveCount(0, { timeout: 20_000 });
      await shot(page, `${size.name}-21c-battle-news`, size.touch, results);
      await press(page, 'station-journal');
      await page.getByTestId('battles-record').evaluate((el) => el.scrollIntoView({ block: 'start' }));
      await expect(page.locator('.toast')).toHaveCount(0, { timeout: 20_000 });
      await shot(page, `${size.name}-21d-battle-journal`, size.touch, results);
      // Outposts have news (docs/PROCGEN.md §39): the next event at the main belt's refinery, under way,
      // in its window. Last of all, as it moves the clock on.
      await docked('outpost.belt.sol-main-belt');
      const news = (await api<{ start: number } | null>(page, 'outpostEvent', { site: 'belt.sol-main-belt' }))!;
      await api(page, 'advanceClock', news.start - (await nowClock()) + 60);
      await quiet();
      await openOutpost();
      await page.getByTestId('outpost-news').evaluate((el) => el.scrollIntoView({ block: 'start' }));
      await expect(page.getByTestId('outpost-news-headline')).not.toHaveText('All quiet');
      await expect(page.locator('.toast')).toHaveCount(0, { timeout: 20_000 });
      await shot(page, `${size.name}-15k-outpost-news`, size.touch, results);
      // The Long Winter (docs/PROCGEN.md §40): its reckoning at Deimos Depot, then the crews' stand in
      // the Kuiper Belt as the claim-jumpers come out of the dark.
      await api(page, 'completeJobs', ['arc.kuiper.1', 'arc.kuiper.2', 'arc.kuiper.3']);
      await docked('mars-depot');
      await press(page, 'room-bar');
      if (!(await page.getByTestId('jobs-window').isVisible().catch(() => false))) await press(page, 'station-jobs');
      await press(page, 'accept-arc.kuiper.4');
      await waitUntil(page, 'the reckoning', async () => {
        if (await page.getByTestId('choice-dialog').isVisible().catch(() => false)) return true;
        const next = page.getByTestId('story-continue');
        if (await next.isVisible().catch(() => false)) await next.click().catch(() => {});
        return false;
      }, 30_000);
      await expect(page.locator('.toast')).toHaveCount(0, { timeout: 20_000 });
      await shot(page, `${size.name}-22-arc-choice`, size.touch, results);
      await press(page, 'choice-crews');
      for (let i = 0; i < 6 && (await page.getByTestId('story-continue').isVisible({ timeout: 1_000 }).catch(() => false)); i++) await press(page, 'story-continue');
      if (!(await page.getByTestId('jobs-window').isVisible().catch(() => false))) await press(page, 'station-jobs');
      await press(page, 'accept-arc.kuiper.5.crews');
      for (let i = 0; i < 6 && (await page.getByTestId('story-continue').isVisible({ timeout: 1_000 }).catch(() => false)); i++) await press(page, 'story-continue');
      await api(page, 'warp', 'sol');
      await waitUntil(page, 'flying there', async () => (await api(page, 'mode')) === 'flight');
      if (await page.getByTestId('sheet-close').isVisible().catch(() => false)) await press(page, 'sheet-close');
      await waitUntil(page, 'the cutters at their rocks', async () => (await api<{ cutters: number } | null>(page, 'stand'))?.cutters === 3, 60_000);
      expect(await api<boolean>(page, 'placeNear', { id: 'stand:arc.kuiper.5.crews', distance: 500 })).toBe(true);
      await api(page, 'selectTarget', 'stand:arc.kuiper.5.crews');
      await waitUntil(page, 'the claim-jumpers', async () => ((await api<{ jumpers: number } | null>(page, 'stand'))?.jumpers ?? 0) > 0, 60_000);
      await expect(page.locator('.toast')).toHaveCount(0, { timeout: 20_000 });
      // The crews' rocks just above the ship, not hidden behind it (the mouse centred, so the ship holds still).
      if (!size.touch) await page.mouse.move(size.width / 2, size.height / 2);
      expect(await api<boolean>(page, 'face', { id: 'stand:arc.kuiper.5.crews', below: size.height < 500 ? 4 : 9 })).toBe(true);
      await shot(page, `${size.name}-22b-stand`, size.touch, results);
      // People at your outposts (docs/PROCGEN.md §41): at the main belt's refinery, an ask said as the
      // pilot docks, then the Outpost window's People.
      type FolkNow = { next: number | null; record: { told: number; ask?: { made: number } } } | null;
      for (let i = 0; i < 20; i++) {
        const f = await api<FolkNow>(page, 'folk', 'belt.sol-main-belt');
        if (f?.record.ask && f.record.ask.made > f.record.told) break;
        await api(page, 'advanceClock', f?.next ? f.next - (await nowClock()) + 3_660 : 6 * 3_600);
      }
      await api(page, 'dockAt', 'outpost.belt.sol-main-belt');
      await waitUntil(page, 'a word on docking', async () => {
        if (await page.getByTestId('folk-dialog').isVisible().catch(() => false)) return true;
        const next = page.getByTestId('story-continue');
        if (await next.isVisible().catch(() => false)) await next.click().catch(() => {});
        return false;
      }, 30_000);
      await expect(page.locator('.toast')).toHaveCount(0, { timeout: 20_000 });
      await shot(page, `${size.name}-23-folk-greeting`, size.touch, results);
      await press(page, 'folk-continue');
      for (let i = 0; i < 6 && (await page.getByTestId('story-continue').isVisible({ timeout: 1_000 }).catch(() => false)); i++) await press(page, 'story-continue');
      await openOutpost();
      await page.getByTestId('outpost-people').evaluate((el) => el.scrollIntoView({ block: 'start' }));
      await expect(page.locator('.toast')).toHaveCount(0, { timeout: 20_000 });
      await shot(page, `${size.name}-23b-outpost-people`, size.touch, results);
      for (const [name, r] of Object.entries(results)) {
        expect.soft(r.overflow, `${name}: page overflow`).toBe(false);
        expect.soft(r.clipped, `${name}: clipped controls`).toEqual([]);
        expect.soft(r.cutOff, `${name}: content cut off inside a box`).toEqual([]);
        expect.soft(r.tinyText, `${name}: text below 10px`).toEqual([]);
        expect.soft(r.smallTargets, `${name}: touch targets below 40px`).toEqual([]);
        expect.soft(r.overlaps, `${name}: overlapping HUD panels`).toEqual([]);
        expect.soft(r.clearCentre, `${name}: in the clear centre`).toEqual([]);
      }
    });

    // Last Light at Pyre (docs/PROCGEN.md §42): Pyre is gone by the journey's end, so its last hour is
    // shot on its own: the choice at its observatory, then the lifeboats as it dies.
    test(`Pyre's last hour at ${size.name}`, async ({ page }) => {
      test.setTimeout(10 * 60_000);
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
      const hearAll = async () => {
        for (let q = 0, i = 0; q < 3 && i < 30; i++) {
          const next = page.getByTestId('story-continue').or(page.getByTestId('folk-continue')).first();
          if (await next.isVisible().catch(() => false)) {
            q = 0;
            await next.click().catch(() => {});
          } else q++;
          await page.waitForTimeout(250);
        }
      };
      const clock = async () => (await api<{ clock: number }>(page, 'state')).clock;
      const docked = async (id: string) => {
        await api(page, 'dockAt', id);
        await waitUntil(page, `docked at ${id}`, async () => (await api<{ location: { dockedAt: string | null } }>(page, 'state')).location.dockedAt === id);
        await hearAll();
      };
      await openFresh(page);
      await press(page, 'title-play');
      await press(page, 'intro-ok');
      await api(page, 'completeJobs', ['lifeline']);
      await api(page, 'skyFrom', 0);
      const sky = (await api<{ timeline: { bhGone: number } }>(page, 'sky'))!;
      await api(page, 'advanceClock', sky.timeline.bhGone + 600 - (await clock()));
      await docked('gj-915-freeport');
      await api(page, 'completeJobs', ['arc.embers.1', 'arc.embers.2', 'arc.embers.3']);
      await docked('pyre-observatory');
      await press(page, 'room-bar');
      if (!(await page.getByTestId('jobs-window').isVisible().catch(() => false))) await press(page, 'station-jobs');
      await press(page, 'accept-arc.embers.4');
      await waitUntil(page, 'the last berths', async () => {
        if (await page.getByTestId('choice-dialog').isVisible().catch(() => false)) return true;
        const next = page.getByTestId('story-continue');
        if (await next.isVisible().catch(() => false)) await next.click().catch(() => {});
        return false;
      }, 30_000);
      await expect(page.locator('.toast')).toHaveCount(0, { timeout: 20_000 });
      await shot(page, `${size.name}-24-pyre-choice`, size.touch, results);
      await press(page, 'choice-stay');
      await hearAll();
      if (!(await page.getByTestId('jobs-window').isVisible().catch(() => false))) await press(page, 'station-jobs');
      await press(page, 'accept-arc.embers.5.stay');
      await hearAll();
      await press(page, 'dock-launch');
      if (await page.getByTestId('controls-sheet').isVisible().catch(() => false)) await press(page, 'sheet-close');
      await waitUntil(page, 'undocked', async () => (await api<{ autopilot: string } | null>(page, 'player'))?.autopilot === 'none', 60_000);
      const edge = (await api<{ world: { sky: { edge: number } } }>(page, 'state')).world.sky.edge;
      await api(page, 'advanceClock', edge + 1_500 + 20 - (await clock()));
      await waitUntil(page, 'the lifeboats away', async () => (await api<{ out: number } | null>(page, 'lifeboats'))?.out === 6, 30_000);
      const boat = (await api<{ id: string }[]>(page, 'targets')).find((t) => t.id.startsWith('lifeboat:'))!;
      expect(await api<boolean>(page, 'placeNear', { id: boat.id, distance: 900 })).toBe(true);
      await api(page, 'selectTarget', boat.id);
      // The lifeboat just above the ship, the mouse centred so the ship holds still. The evacuation
      // keeps the radio busy: a toast may come between the shot and its audit, so the shot is taken
      // again in a quiet moment (the audit still fails if none comes).
      const boatShot = `${size.name}-24b-lifeboats`;
      for (let i = 0; i < 5; i++) {
        await expect(page.locator('.toast')).toHaveCount(0, { timeout: 20_000 });
        if (!size.touch) await page.mouse.move(size.width / 2, size.height / 2);
        expect(await api<boolean>(page, 'face', { id: boat.id, below: size.height < 500 ? 4 : 9 })).toBe(true);
        await shot(page, boatShot, size.touch, results);
        if (!results[boatShot]!.overlaps.some((o) => o.includes('toast'))) break;
      }
      for (const [name, r] of Object.entries(results)) {
        expect.soft(r.overflow, `${name}: page overflow`).toBe(false);
        expect.soft(r.clipped, `${name}: clipped controls`).toEqual([]);
        expect.soft(r.cutOff, `${name}: content cut off inside a box`).toEqual([]);
        expect.soft(r.tinyText, `${name}: text below 10px`).toEqual([]);
        expect.soft(r.smallTargets, `${name}: touch targets below 40px`).toEqual([]);
        expect.soft(r.overlaps, `${name}: overlapping HUD panels`).toEqual([]);
        expect.soft(r.clearCentre, `${name}: in the clear centre`).toEqual([]);
      }
    });

    // Binary orbits (docs/PROCGEN.md §44): Procyon B scanned, its card with its orbit; then the star map's card.
    test(`A pair's orbit at ${size.name}`, async ({ page }) => {
      test.setTimeout(10 * 60_000);
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
      await press(page, 'title-play');
      await press(page, 'intro-ok');
      await api(page, 'completeJobs', ['lifeline']);
      await api(page, 'dockAt', 'dawnfield-institute');
      await waitUntil(page, 'docked at Dawnfield Institute', async () => (await api<{ location: { dockedAt: string | null } }>(page, 'state')).location.dockedAt === 'dawnfield-institute');
      for (let q = 0, i = 0; q < 3 && i < 30; i++) {
        const next = page.getByTestId('story-continue').or(page.getByTestId('folk-continue')).first();
        if (await next.isVisible().catch(() => false)) {
          q = 0;
          await next.click().catch(() => {});
        } else q++;
        await page.waitForTimeout(250);
      }
      await press(page, 'dock-launch');
      if (await page.getByTestId('controls-sheet').isVisible().catch(() => false)) await press(page, 'sheet-close');
      await waitUntil(page, 'undocked', async () => (await api<{ autopilot: string } | null>(page, 'player'))?.autopilot === 'none', 60_000);
      await api(page, 'selectTarget', 'star:procyon-b');
      expect(await api<boolean>(page, 'placeNear', { id: 'star:procyon-b', distance: 6_000 })).toBe(true);
      await waitUntil(page, 'Scan offered', async () => {
        const ok = page.getByTestId('discovery-ok').last();
        if (await ok.isVisible().catch(() => false)) await ok.click({ timeout: 2_000 }).catch(() => {});
        return (await api<{ context: { label: string } | null } | null>(page, 'hud'))?.context?.label === 'Scan';
      }, 30_000);
      await press(page, size.touch ? 'touch-context' : 'hud-context');
      await page.getByTestId('science-orbit').scrollIntoViewIfNeeded();
      await expect(page.locator('.toast')).toHaveCount(0, { timeout: 20_000 });
      await shot(page, `${size.name}-26-orbit-card`, size.touch, results);
      await press(page, 'sheet-close');
      if (size.touch) await press(page, 'hud-map');
      else await page.keyboard.press('Tab');
      await expect(page.getByTestId('galaxy-map')).toBeVisible();
      await press(page, 'map-system-procyon');
      // On a narrow screen the card is a bottom sheet, opened by Details.
      const details = page.getByTestId('map-card-toggle');
      if ((await details.isVisible().catch(() => false)) && (await details.getAttribute('aria-expanded')) === 'false') await press(page, 'map-card-toggle');
      await page.getByTestId('orbit-procyon-b').scrollIntoViewIfNeeded();
      await shot(page, `${size.name}-26b-orbit-map`, size.touch, results);
      for (const [name, r] of Object.entries(results)) {
        expect.soft(r.overflow, `${name}: page overflow`).toBe(false);
        expect.soft(r.clipped, `${name}: clipped controls`).toEqual([]);
        expect.soft(r.cutOff, `${name}: content cut off inside a box`).toEqual([]);
        expect.soft(r.tinyText, `${name}: text below 10px`).toEqual([]);
        expect.soft(r.smallTargets, `${name}: touch targets below 40px`).toEqual([]);
        expect.soft(r.overlaps, `${name}: overlapping HUD panels`).toEqual([]);
        expect.soft(r.clearCentre, `${name}: in the clear centre`).toEqual([]);
      }
    });

    // Comets in Sol (docs/PROCGEN.md §45): three weeks before Encke passes the Sun, its coma and tails
    // seen from beside them; then scanned, its card.
    test(`A comet at ${size.name}`, async ({ page }) => {
      test.setTimeout(10 * 60_000);
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
      await press(page, 'title-play');
      await press(page, 'intro-ok');
      await api(page, 'completeJobs', ['lifeline']);
      expect(await api<boolean>(page, 'startedOn', '2027-01-20T00:00:00Z')).toBe(true);
      await api(page, 'dockAt', 'earth-port');
      await waitUntil(page, 'docked at Earth Port', async () => (await api<{ location: { dockedAt: string | null } }>(page, 'state')).location.dockedAt === 'earth-port');
      for (let q = 0, i = 0; q < 3 && i < 30; i++) {
        const next = page.getByTestId('story-continue').or(page.getByTestId('folk-continue')).first();
        if (await next.isVisible().catch(() => false)) {
          q = 0;
          await next.click().catch(() => {});
        } else q++;
        await page.waitForTimeout(250);
      }
      await press(page, 'dock-launch');
      if (await page.getByTestId('controls-sheet').isVisible().catch(() => false)) await press(page, 'sheet-close');
      await waitUntil(page, 'undocked', async () => (await api<{ autopilot: string } | null>(page, 'player'))?.autopilot === 'none', 60_000);
      await api(page, 'selectTarget', 'comet:comet-2p');
      expect(await api<boolean>(page, 'viewComet', { id: 'comet-2p', distance: 15_000 })).toBe(true);
      await expect(page.locator('.toast')).toHaveCount(0, { timeout: 20_000 });
      await page.waitForTimeout(800);
      await shot(page, `${size.name}-27-comet`, size.touch, results);
      expect(await api<boolean>(page, 'placeNear', { id: 'comet:comet-2p', distance: 6_000 })).toBe(true);
      await waitUntil(page, 'Scan offered', async () => {
        const ok = page.getByTestId('discovery-ok').last();
        if (await ok.isVisible().catch(() => false)) await ok.click({ timeout: 2_000 }).catch(() => {});
        return (await api<{ context: { label: string } | null } | null>(page, 'hud'))?.context?.label === 'Scan';
      }, 30_000);
      await press(page, size.touch ? 'touch-context' : 'hud-context');
      await expect(page.getByTestId('science-comet')).toBeVisible();
      await expect(page.locator('.toast')).toHaveCount(0, { timeout: 20_000 });
      await shot(page, `${size.name}-27b-comet-card`, size.touch, results);
      for (const [name, r] of Object.entries(results)) {
        expect.soft(r.overflow, `${name}: page overflow`).toBe(false);
        expect.soft(r.clipped, `${name}: clipped controls`).toEqual([]);
        expect.soft(r.cutOff, `${name}: content cut off inside a box`).toEqual([]);
        expect.soft(r.tinyText, `${name}: text below 10px`).toEqual([]);
        expect.soft(r.smallTargets, `${name}: touch targets below 40px`).toEqual([]);
        expect.soft(r.overlaps, `${name}: overlapping HUD panels`).toEqual([]);
        expect.soft(r.clearCentre, `${name}: in the clear centre`).toEqual([]);
      }
    });

    // The pilot's logbook (docs/PROCGEN.md §46): a few weeks of a career; the journal's Logbook, then the logbook itself.
    test(`A logbook at ${size.name}`, async ({ page }) => {
      test.setTimeout(10 * 60_000);
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
      await press(page, 'title-play');
      await press(page, 'intro-ok');
      await api(page, 'completeJobs', ['lifeline']);
      expect(await api<boolean>(page, 'logbookSample')).toBe(true);
      await api(page, 'dockAt', 'earth-port');
      await waitUntil(page, 'docked at Earth Port', async () => (await api<{ location: { dockedAt: string | null } }>(page, 'state')).location.dockedAt === 'earth-port');
      for (let q = 0, i = 0; q < 3 && i < 30; i++) {
        const next = page.getByTestId('story-continue').or(page.getByTestId('folk-continue')).first();
        if (await next.isVisible().catch(() => false)) {
          q = 0;
          await next.click().catch(() => {});
        } else q++;
        await page.waitForTimeout(250);
      }
      await press(page, 'station-journal');
      await page.getByTestId('journal-logbook').evaluate((el) => el.scrollIntoView({ block: 'start' }));
      await expect(page.locator('.toast')).toHaveCount(0, { timeout: 20_000 });
      await shot(page, `${size.name}-28-logbook-journal`, size.touch, results);
      await press(page, 'logbook-open');
      await expect(page.getByTestId('logbook')).toBeVisible();
      await shot(page, `${size.name}-28b-logbook`, size.touch, results);
      for (const [name, r] of Object.entries(results)) {
        expect.soft(r.overflow, `${name}: page overflow`).toBe(false);
        expect.soft(r.clipped, `${name}: clipped controls`).toEqual([]);
        expect.soft(r.cutOff, `${name}: content cut off inside a box`).toEqual([]);
        expect.soft(r.tinyText, `${name}: text below 10px`).toEqual([]);
        expect.soft(r.smallTargets, `${name}: touch targets below 40px`).toEqual([]);
        expect.soft(r.overlaps, `${name}: overlapping HUD panels`).toEqual([]);
        expect.soft(r.clearCentre, `${name}: in the clear centre`).toEqual([]);
      }
    });

    // Named asteroids (docs/PROCGEN.md §47): minutes before Apophis's nearest on 13 April 2029, Earth
    // Port's News tells of the pass; out in Sol it is drawn by Earth, and scanned, its card.
    test(`An asteroid at ${size.name}`, async ({ page }) => {
      test.setTimeout(10 * 60_000);
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
      await press(page, 'title-play');
      await press(page, 'intro-ok');
      await api(page, 'completeJobs', ['lifeline']);
      // The game's date: minutes before Apophis's nearest (21:46 on 13 April 2029).
      const clock = (await api<{ clock: number }>(page, 'state')).clock;
      expect(await api<boolean>(page, 'startedOn', new Date(Date.parse('2029-04-13T21:41:00Z') - clock * 1_000).toISOString())).toBe(true);
      await api(page, 'dockAt', 'earth-port');
      await waitUntil(page, 'docked at Earth Port', async () => (await api<{ location: { dockedAt: string | null } }>(page, 'state')).location.dockedAt === 'earth-port');
      for (let q = 0, i = 0; q < 3 && i < 30; i++) {
        const next = page.getByTestId('story-continue').or(page.getByTestId('folk-continue')).first();
        if (await next.isVisible().catch(() => false)) {
          q = 0;
          await next.click().catch(() => {});
        } else q++;
        await page.waitForTimeout(250);
      }
      await press(page, 'room-bar');
      if (!(await page.getByTestId('news-window').isVisible().catch(() => false))) await press(page, 'station-news');
      const news = page.getByTestId('news-asteroid-99942');
      await expect(news).toContainText('Apophis passes Earth');
      await news.evaluate((el) => el.scrollIntoView({ block: 'center' }));
      await expect(page.locator('.toast')).toHaveCount(0, { timeout: 20_000 });
      await shot(page, `${size.name}-29-asteroid-news`, size.touch, results);
      await press(page, 'dock-launch');
      if (await page.getByTestId('controls-sheet').isVisible().catch(() => false)) await press(page, 'sheet-close');
      await waitUntil(page, 'undocked', async () => (await api<{ autopilot: string } | null>(page, 'player'))?.autopilot === 'none', 60_000);
      await api(page, 'selectTarget', 'asteroid:asteroid-99942');
      expect(await api<boolean>(page, 'viewAsteroid', { id: 'asteroid-99942', distance: 1_400 })).toBe(true);
      await expect(page.locator('.toast')).toHaveCount(0, { timeout: 20_000 });
      await page.waitForTimeout(800);
      await shot(page, `${size.name}-29b-apophis`, size.touch, results);
      expect(await api<boolean>(page, 'placeNear', { id: 'asteroid:asteroid-99942', distance: 3_000, awayFrom: 'station:earth-port' })).toBe(true);
      await waitUntil(page, 'Scan offered', async () => {
        const ok = page.getByTestId('discovery-ok').last();
        if (await ok.isVisible().catch(() => false)) await ok.click({ timeout: 2_000 }).catch(() => {});
        return (await api<{ context: { label: string } | null } | null>(page, 'hud'))?.context?.label === 'Scan';
      }, 30_000);
      await press(page, size.touch ? 'touch-context' : 'hud-context');
      await expect(page.getByTestId('science-asteroid')).toBeVisible();
      await expect(page.locator('.toast')).toHaveCount(0, { timeout: 20_000 });
      await shot(page, `${size.name}-29c-asteroid-card`, size.touch, results);
      for (const [name, r] of Object.entries(results)) {
        expect.soft(r.overflow, `${name}: page overflow`).toBe(false);
        expect.soft(r.clipped, `${name}: clipped controls`).toEqual([]);
        expect.soft(r.cutOff, `${name}: content cut off inside a box`).toEqual([]);
        expect.soft(r.tinyText, `${name}: text below 10px`).toEqual([]);
        expect.soft(r.smallTargets, `${name}: touch targets below 40px`).toEqual([]);
        expect.soft(r.overlaps, `${name}: overlapping HUD panels`).toEqual([]);
        expect.soft(r.clearCentre, `${name}: in the clear centre`).toEqual([]);
      }
    });

    // The giant planets' moons (docs/PROCGEN.md §48): Io with Jupiter behind it, and Io's card.
    test(`A moon at ${size.name}`, async ({ page }) => {
      test.setTimeout(10 * 60_000);
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
      await press(page, 'title-play');
      await press(page, 'intro-ok');
      await api(page, 'completeJobs', ['lifeline']);
      await api(page, 'dockAt', 'earth-port');
      await waitUntil(page, 'docked at Earth Port', async () => (await api<{ location: { dockedAt: string | null } }>(page, 'state')).location.dockedAt === 'earth-port');
      for (let q = 0, i = 0; q < 3 && i < 30; i++) {
        const next = page.getByTestId('story-continue').or(page.getByTestId('folk-continue')).first();
        if (await next.isVisible().catch(() => false)) {
          q = 0;
          await next.click().catch(() => {});
        } else q++;
        await page.waitForTimeout(250);
      }
      await press(page, 'dock-launch');
      if (await page.getByTestId('controls-sheet').isVisible().catch(() => false)) await press(page, 'sheet-close');
      await waitUntil(page, 'undocked', async () => (await api<{ autopilot: string } | null>(page, 'player'))?.autopilot === 'none', 60_000);
      await api(page, 'selectTarget', 'planet:io');
      expect(await api<boolean>(page, 'viewMoon', { id: 'io', planet: 'jupiter', distance: 1_800 })).toBe(true);
      await expect(page.locator('.toast')).toHaveCount(0, { timeout: 20_000 });
      await page.waitForTimeout(800);
      await shot(page, `${size.name}-30-moon`, size.touch, results);
      expect(await api<boolean>(page, 'placeNear', { id: 'planet:io', distance: 3_000 })).toBe(true);
      await waitUntil(page, 'Scan offered', async () => {
        const ok = page.getByTestId('discovery-ok').last();
        if (await ok.isVisible().catch(() => false)) await ok.click({ timeout: 2_000 }).catch(() => {});
        return (await api<{ context: { label: string } | null } | null>(page, 'hud'))?.context?.label === 'Scan';
      }, 30_000);
      await press(page, size.touch ? 'touch-context' : 'hud-context');
      await expect(page.getByTestId('science-moon')).toBeVisible();
      await expect(page.locator('.toast')).toHaveCount(0, { timeout: 20_000 });
      await shot(page, `${size.name}-30b-moon-card`, size.touch, results);
      for (const [name, r] of Object.entries(results)) {
        expect.soft(r.overflow, `${name}: page overflow`).toBe(false);
        expect.soft(r.clipped, `${name}: clipped controls`).toEqual([]);
        expect.soft(r.cutOff, `${name}: content cut off inside a box`).toEqual([]);
        expect.soft(r.tinyText, `${name}: text below 10px`).toEqual([]);
        expect.soft(r.smallTargets, `${name}: touch targets below 40px`).toEqual([]);
        expect.soft(r.overlaps, `${name}: overlapping HUD panels`).toEqual([]);
        expect.soft(r.clearCentre, `${name}: in the clear centre`).toEqual([]);
      }
    });

    // Spacecraft out in Sol (docs/PROCGEN.md §49): the James Webb Space Telescope out past the Moon, Earth
    // behind it, then scanned, its card.
    test(`A spacecraft at ${size.name}`, async ({ page }) => {
      test.setTimeout(10 * 60_000);
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
      await press(page, 'title-play');
      await press(page, 'intro-ok');
      await api(page, 'completeJobs', ['lifeline']);
      await api(page, 'dockAt', 'earth-port');
      await waitUntil(page, 'docked at Earth Port', async () => (await api<{ location: { dockedAt: string | null } }>(page, 'state')).location.dockedAt === 'earth-port');
      for (let q = 0, i = 0; q < 3 && i < 30; i++) {
        const next = page.getByTestId('story-continue').or(page.getByTestId('folk-continue')).first();
        if (await next.isVisible().catch(() => false)) {
          q = 0;
          await next.click().catch(() => {});
        } else q++;
        await page.waitForTimeout(250);
      }
      await press(page, 'dock-launch');
      if (await page.getByTestId('controls-sheet').isVisible().catch(() => false)) await press(page, 'sheet-close');
      await waitUntil(page, 'undocked', async () => (await api<{ autopilot: string } | null>(page, 'player'))?.autopilot === 'none', 60_000);
      const webb = 'james-webb-space-telescope';
      await api(page, 'selectTarget', `craft:${webb}`);
      expect(await api<boolean>(page, 'viewCraft', { id: webb, distance: 420 })).toBe(true);
      await expect(page.locator('.toast')).toHaveCount(0, { timeout: 20_000 });
      await page.waitForTimeout(800);
      await shot(page, `${size.name}-31-craft`, size.touch, results);
      expect(await api<boolean>(page, 'placeNear', { id: `craft:${webb}`, distance: 3_000, awayFrom: 'station:earth-port' })).toBe(true);
      await waitUntil(page, 'Scan offered', async () => {
        const ok = page.getByTestId('discovery-ok').last();
        if (await ok.isVisible().catch(() => false)) await ok.click({ timeout: 2_000 }).catch(() => {});
        return (await api<{ context: { label: string } | null } | null>(page, 'hud'))?.context?.label === 'Scan';
      }, 30_000);
      await press(page, size.touch ? 'touch-context' : 'hud-context');
      await expect(page.getByTestId('science-craft')).toBeVisible();
      await expect(page.locator('.toast')).toHaveCount(0, { timeout: 20_000 });
      await shot(page, `${size.name}-31b-craft-card`, size.touch, results);
      for (const [name, r] of Object.entries(results)) {
        expect.soft(r.overflow, `${name}: page overflow`).toBe(false);
        expect.soft(r.clipped, `${name}: clipped controls`).toEqual([]);
        expect.soft(r.cutOff, `${name}: content cut off inside a box`).toEqual([]);
        expect.soft(r.tinyText, `${name}: text below 10px`).toEqual([]);
        expect.soft(r.smallTargets, `${name}: touch targets below 40px`).toEqual([]);
        expect.soft(r.overlaps, `${name}: overlapping HUD panels`).toEqual([]);
        expect.soft(r.clearCentre, `${name}: in the clear centre`).toEqual([]);
      }
    });

    // Earth's Moon (docs/PROCGEN.md §51): a waxing gibbous, 72% lit, seen from just above Earth on
    // its side, and its card with its phase and the eclipses to come.
    test(`Earth's Moon at ${size.name}`, async ({ page }) => {
      test.setTimeout(10 * 60_000);
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
      await press(page, 'title-play');
      await press(page, 'intro-ok');
      await api(page, 'completeJobs', ['lifeline']);
      expect(await api<boolean>(page, 'startedOn', '2026-10-21T00:00:00Z')).toBe(true);
      await api(page, 'dockAt', 'earth-port');
      await waitUntil(page, 'docked at Earth Port', async () => (await api<{ location: { dockedAt: string | null } }>(page, 'state')).location.dockedAt === 'earth-port');
      for (let q = 0, i = 0; q < 3 && i < 30; i++) {
        const next = page.getByTestId('story-continue').or(page.getByTestId('folk-continue')).first();
        if (await next.isVisible().catch(() => false)) {
          q = 0;
          await next.click().catch(() => {});
        } else q++;
        await page.waitForTimeout(250);
      }
      await press(page, 'dock-launch');
      if (await page.getByTestId('controls-sheet').isVisible().catch(() => false)) await press(page, 'sheet-close');
      await waitUntil(page, 'undocked', async () => (await api<{ autopilot: string } | null>(page, 'player'))?.autopilot === 'none', 60_000);
      await api(page, 'selectTarget', 'planet:moon');
      expect(await api<boolean>(page, 'viewMoon', { id: 'moon', planet: 'earth', distance: 2_100, near: true })).toBe(true);
      // Looking a little under it, so the Moon stands above the ship.
      expect(await api<boolean>(page, 'face', { id: 'planet:moon', below: 14 })).toBe(true);
      await expect(page.locator('.toast')).toHaveCount(0, { timeout: 20_000 });
      await page.waitForTimeout(800);
      await shot(page, `${size.name}-32-moon`, size.touch, results);
      expect(await api<boolean>(page, 'placeNear', { id: 'planet:moon', distance: 2_000 })).toBe(true);
      await waitUntil(page, 'Scan offered', async () => {
        const ok = page.getByTestId('discovery-ok').last();
        if (await ok.isVisible().catch(() => false)) await ok.click({ timeout: 2_000 }).catch(() => {});
        return (await api<{ context: { label: string } | null } | null>(page, 'hud'))?.context?.label === 'Scan';
      }, 30_000);
      await press(page, size.touch ? 'touch-context' : 'hud-context');
      await expect(page.getByTestId('science-moon-earth')).toBeVisible();
      await expect(page.locator('.toast')).toHaveCount(0, { timeout: 20_000 });
      await shot(page, `${size.name}-32b-moon-card`, size.touch, results);
      for (const [name, r] of Object.entries(results)) {
        expect.soft(r.overflow, `${name}: page overflow`).toBe(false);
        expect.soft(r.clipped, `${name}: clipped controls`).toEqual([]);
        expect.soft(r.cutOff, `${name}: content cut off inside a box`).toEqual([]);
        expect.soft(r.tinyText, `${name}: text below 10px`).toEqual([]);
        expect.soft(r.smallTargets, `${name}: touch targets below 40px`).toEqual([]);
        expect.soft(r.overlaps, `${name}: overlapping HUD panels`).toEqual([]);
      }
    });

    // Flare stars (docs/PROCGEN.md §43): Wolf 359 in a strong flare, told in Ledger Institute's News,
    // then flown in, the star glowing and the HUD saying so.
    test(`A flare at ${size.name}`, async ({ page }) => {
      test.setTimeout(10 * 60_000);
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
      await press(page, 'title-play');
      await press(page, 'intro-ok');
      await api(page, 'completeJobs', ['lifeline']);
      const f = (await api<{ id: string; start: number } | null>(page, 'nextFlare', { systemId: 'wolf-359', kind: 'strong' }))!;
      await api(page, 'advanceClock', f.start + 180 - (await api<{ clock: number }>(page, 'state')).clock);
      await api(page, 'dockAt', 'ledger-institute');
      await waitUntil(page, 'docked at Ledger Institute', async () => (await api<{ location: { dockedAt: string | null } }>(page, 'state')).location.dockedAt === 'ledger-institute');
      for (let q = 0, i = 0; q < 3 && i < 30; i++) {
        const next = page.getByTestId('story-continue').or(page.getByTestId('folk-continue')).first();
        if (await next.isVisible().catch(() => false)) {
          q = 0;
          await next.click().catch(() => {});
        } else q++;
        await page.waitForTimeout(250);
      }
      await press(page, 'room-bar');
      if (!(await page.getByTestId('news-window').isVisible().catch(() => false))) await press(page, 'station-news');
      await page.getByTestId(`news-${f.id}`).scrollIntoViewIfNeeded();
      await expect(page.locator('.toast')).toHaveCount(0, { timeout: 20_000 });
      await shot(page, `${size.name}-25-flare-news`, size.touch, results);
      await press(page, 'dock-launch');
      if (await page.getByTestId('controls-sheet').isVisible().catch(() => false)) await press(page, 'sheet-close');
      await waitUntil(page, 'undocked', async () => (await api<{ autopilot: string } | null>(page, 'player'))?.autopilot === 'none', 60_000);
      expect(await api<boolean>(page, 'placeNear', { id: 'star:wolf-359', distance: 9_000 })).toBe(true);
      // Its target saying so where its panel sits in a corner (on touch it would hide the star).
      if (!size.touch) await api(page, 'selectTarget', 'star:wolf-359');
      await expect(page.getByTestId('hud-flare')).toBeVisible();
      await expect(page.locator('.toast')).toHaveCount(0, { timeout: 20_000 });
      // The star just above the ship, the mouse centred so the ship holds still.
      if (!size.touch) await page.mouse.move(size.width / 2, size.height / 2);
      expect(await api<boolean>(page, 'face', { id: 'star:wolf-359', below: size.height < 500 ? 6 : 12 })).toBe(true);
      await shot(page, `${size.name}-25b-flare`, size.touch, results);
      for (const [name, r] of Object.entries(results)) {
        expect.soft(r.overflow, `${name}: page overflow`).toBe(false);
        expect.soft(r.clipped, `${name}: clipped controls`).toEqual([]);
        expect.soft(r.cutOff, `${name}: content cut off inside a box`).toEqual([]);
        expect.soft(r.tinyText, `${name}: text below 10px`).toEqual([]);
        expect.soft(r.smallTargets, `${name}: touch targets below 40px`).toEqual([]);
        expect.soft(r.overlaps, `${name}: overlapping HUD panels`).toEqual([]);
        expect.soft(r.clearCentre, `${name}: in the clear centre`).toEqual([]);
      }
    });
  });
}

test('newGameAndLaunch helper is exercised by the journey spec', async () => {
  expect(typeof newGameAndLaunch).toBe('function');
});
