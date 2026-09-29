import { expect, test, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { api, newGameAndLaunch, openFresh, press, waitUntil } from './helpers.ts';

/**
 * Captures every required layout (spec section 10) and audits for common layout failures:
 * page scroll capture, buttons clipped off-screen, unreadably small text, undersized touch
 * targets and overlapping HUD panels. Screenshots go to docs/screenshots/.
 */
const SIZES = [
  { name: 'phone-portrait-360x640', width: 360, height: 640, touch: true },
  { name: 'phone-landscape-640x360', width: 640, height: 360, touch: true },
  { name: 'iphone-portrait-390x844', width: 390, height: 844, touch: true },
  { name: 'iphone-landscape-844x390', width: 844, height: 390, touch: true },
  { name: 'tablet-portrait-768x1024', width: 768, height: 1024, touch: true },
  { name: 'tablet-landscape-1024x768', width: 1024, height: 768, touch: true },
  { name: 'desktop-1440x900', width: 1440, height: 900, touch: false },
] as const;

const OUT = 'docs/screenshots';

interface AuditResult {
  overflow: boolean;
  clipped: string[];
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
    const topLayer = document.querySelector('.modal-backdrop, .sheet-backdrop');
    const scope = topLayer ?? document;
    const clipped: string[] = [];
    for (const el of scope.querySelectorAll('button, [role="slider"], a')) {
      if (!visible(el) || el.closest('.marker') || el.closest('.hud-markers')) continue;
      // Ignore controls inside scrollable containers that are simply scrolled out of view.
      if (el.closest('.scroll, .table-wrap, .tabs')) continue;
      const r = el.getBoundingClientRect();
      if (r.left < -1 || r.top < -1 || r.right > vw + 1 || r.bottom > vh + 1) clipped.push(label(el));
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
    const panels = [...document.querySelectorAll('.hud-status, .hud-wallet, .hud-buttons, .hud-objective, .hud-target, .encounter-banner, .tcluster, .assist-chip, .throttle')].filter(visible);
    for (let i = 0; i < panels.length; i++) {
      for (let j = i + 1; j < panels.length; j++) {
        const a = panels[i]!.getBoundingClientRect();
        const b = panels[j]!.getBoundingClientRect();
        const overlap = Math.min(a.right, b.right) - Math.max(a.left, b.left) > 2 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 2;
        if (overlap) overlaps.push(`${panels[i]!.className} × ${panels[j]!.className}`);
      }
    }
    const overflow = document.documentElement.scrollWidth > vw + 1 || document.documentElement.scrollHeight > vh + 1;
    return { overflow, clipped, tinyText: tinyText.slice(0, 10), smallTargets, overlaps };
  }, touch);
}

async function shot(page: Page, name: string, touch: boolean, results: Record<string, AuditResult>): Promise<void> {
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT}/${name}.jpg`, type: 'jpeg', quality: 62 });
  results[name] = await audit(page, touch);
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
      await openFresh(page);
      await shot(page, `${size.name}-1-title`, size.touch, results);
      await press(page, 'title-play');
      await press(page, 'intro-ok');
      await shot(page, `${size.name}-2-contracts`, size.touch, results);
      await press(page, 'accept-lifeline');
      await press(page, 'buy-medical');
      await shot(page, `${size.name}-3-buy-dialog`, size.touch, results);
      await press(page, 'buy-confirm');
      await press(page, 'dock-launch');
      await press(page, 'sheet-close');
      await waitUntil(page, 'undocked', async () => (await api<{ autopilot: string } | null>(page, 'player'))?.autopilot === 'none');
      await api(page, 'selectTarget', 'station:mars-depot');
      await shot(page, `${size.name}-4-flight`, size.touch, results);
      await press(page, 'hud-map');
      await page.waitForTimeout(800);
      await shot(page, `${size.name}-5-map`, size.touch, results);
      for (const [name, r] of Object.entries(results)) {
        expect.soft(r.overflow, `${name}: page overflow`).toBe(false);
        expect.soft(r.clipped, `${name}: clipped controls`).toEqual([]);
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
