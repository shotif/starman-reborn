// Draws the trailer's on-screen text: one transparent 1920×1080 PNG per caption in the EDL, and the
// end card's layers, into promo/out/cards/.
//
//   node promo/cards.mjs
//
// The text is set in the game's own page, with the game's own stylesheet and fonts (Saira Condensed
// from @fontsource), so the logotype is the title screen's (.game-title in src/ui/styles/screens.css)
// and the colours are its tokens (--text, --accent, --amber, --bg).
import { chromium } from 'playwright-core';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { BASE, HEIGHT, OUT, WIDTH, chromePath, ensureServer } from './lib/harness.mjs';
import { loadEdl } from './lib/timeline.mjs';

const DIR = join(OUT, 'cards');

/** Where a caption sits: clear of the HUD's corner panels and of the ship in the middle of the frame. */
const PLACES = {
  upper: 'top: 23%; left: 0; right: 0; text-align: center;',
  centre: 'top: 50%; left: 0; right: 0; text-align: center; translate: 0 -50%;',
  lower: 'bottom: 21%; left: 0; right: 0; text-align: center;',
  bottom: 'bottom: 11%; left: 0; right: 0; text-align: center;',
  left: 'top: 31%; left: 6.5%; text-align: left;',
  right: 'top: 31%; right: 6.5%; text-align: right;',
};

const CSS = `
  html, body { background: transparent !important; }
  #app, #ui, canvas { display: none !important; }
  #promo-card { position: fixed; inset: 0; width: ${WIDTH}px; height: ${HEIGHT}px; overflow: hidden; font-family: var(--font-ui); }
  #promo-card .block { position: absolute; }
  /* A soft pool of the game's background colour behind the words, so they read over a bright sky. */
  #promo-card .scrim { position: absolute; inset: -70px -220px; background: radial-gradient(closest-side, rgba(4, 6, 11, 0.78), rgba(4, 6, 11, 0.5) 55%, rgba(4, 6, 11, 0)); }
  #promo-card .words { position: relative; display: inline-block; }
  #promo-card .line {
    margin: 0; font-weight: 700; font-size: 104px; line-height: 1; letter-spacing: 0.13em; margin-right: -0.13em; text-transform: uppercase; white-space: nowrap;
    background: linear-gradient(180deg, #ffffff 0%, #dce9f8 42%, #7b94b8 52%, #c7d8ee 70%, #f4f8ff 100%);
    -webkit-background-clip: text; background-clip: text; color: transparent;
    filter: drop-shadow(0 3px 0 rgba(0, 0, 0, 0.75)) drop-shadow(0 0 22px rgba(110, 190, 255, 0.35));
  }
  #promo-card .line + .line { margin-top: 10px; }
  #promo-card .line.big { font-size: 168px; letter-spacing: 0.2em; margin-right: -0.2em; }
  #promo-card .left .line, #promo-card .left .sub, #promo-card .right .line, #promo-card .right .sub { margin-right: 0; }
  #promo-card .left .scrim, #promo-card .right .scrim { inset: -80px -160px; }
  #promo-card .sub {
    margin: 20px 0 0; font-family: 'Saira Semi Condensed', var(--font-ui); font-weight: 600; font-size: 44px; letter-spacing: 0.24em; margin-right: -0.24em; text-transform: uppercase; white-space: nowrap;
    color: var(--accent-strong, #9be0ff); text-shadow: 0 2px 0 rgba(0, 0, 0, 0.85), 0 0 14px rgba(4, 6, 11, 1), 0 0 28px rgba(4, 6, 11, 0.9);
  }
  #promo-card .rule { height: 3px; width: 120px; margin: 0 auto 22px; background: linear-gradient(90deg, transparent, var(--amber), transparent); }
  #promo-card .left .rule, #promo-card .right .rule { display: none; }

  /* The end card: the title screen's logotype and eyebrow, larger, and the call to action. */
  #promo-card .title-block { position: absolute; left: 59%; top: 50%; translate: 0 -50%; }
  #promo-card .title-scrim { position: absolute; inset: 0; background: linear-gradient(270deg, rgba(2, 4, 10, 0.8), rgba(2, 4, 10, 0.55) 40%, rgba(2, 4, 10, 0) 58%); }
  #promo-card .game-title { font-size: 146px; }
  #promo-card .tagline { margin: 44px 0 0; font-family: var(--font-ui); font-weight: 500; font-size: 36px; letter-spacing: 0.3em; text-transform: uppercase; color: var(--edge-hi, #c9e8ff); text-shadow: 0 2px 0 rgba(0, 0, 0, 0.7); white-space: nowrap; }
  #promo-card .cta {
    display: inline-block; margin: 56px 0 0; padding: 20px 44px 18px; font-family: var(--font-ui); font-weight: 700; font-size: 60px; line-height: 1; letter-spacing: 0.2em; text-transform: uppercase; white-space: nowrap;
    color: var(--amber); border: 3px solid var(--amber); background: rgba(4, 6, 11, 0.55); box-shadow: 0 0 34px rgba(255, 216, 74, 0.22), inset 0 0 24px rgba(255, 216, 74, 0.08);
    clip-path: polygon(18px 0, 100% 0, 100% calc(100% - 18px), calc(100% - 18px) 100%, 0 100%, 0 18px);
  }
`;

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');

function captionHtml(c) {
  const place = c.place ?? 'upper';
  const size = c.size ? ` style="font-size: ${c.size}px"` : '';
  const lines = c.text.split('\n').map((line) => `<p class="line${c.big ? ' big' : ''}"${size}>${esc(line)}</p>`).join('');
  // Over a busy picture (the star map) the pool behind the words is made darker.
  const k = c.scrim ?? 0.78;
  const scrim = `background: radial-gradient(closest-side, rgba(4, 6, 11, ${k}), rgba(4, 6, 11, ${(k * 0.72).toFixed(2)}) 60%, rgba(4, 6, 11, 0));`;
  return `<div class="block ${place}" style="${PLACES[place]}"><span class="words"><span class="scrim" style="${scrim}"></span><div class="rule"></div>${lines}${c.sub ? `<p class="sub">${esc(c.sub)}</p>` : ''}</span></div>`;
}

/** The end card as layers, so the edit can bring them on one after another. */
function titleLayers(card) {
  const hide = (shown) => (name) => (shown.includes(name) ? '' : 'visibility: hidden;');
  const block = (shown) => {
    const v = hide(shown);
    return `<div class="title-block"><h1 class="game-title" style="${v('logo')}">${esc(card.title[0])}<span> ${esc(card.title[1])}</span></h1><p class="tagline" style="${v('tagline')}">${esc(card.tagline)}</p><div class="cta" style="${v('cta')}">${esc(card.cta)}</div></div>`;
  };
  return { scrim: '<div class="title-scrim"></div>', logo: block(['logo']), tagline: block(['tagline']), cta: block(['cta']) };
}

export async function renderCards(edl = loadEdl()) {
  const server = await ensureServer();
  const browser = await chromium.launch({ headless: true, executablePath: chromePath() });
  rmSync(DIR, { recursive: true, force: true });
  mkdirSync(DIR, { recursive: true });
  const made = [];
  try {
    const page = await (await browser.newContext({ viewport: { width: WIDTH, height: HEIGHT }, deviceScaleFactor: 1 })).newPage();
    await page.goto(`${BASE}/?test=1`);
    await page.getByTestId('title-screen').waitFor();
    await page.addStyleTag({ content: CSS });
    await page.evaluate(() => {
      const el = document.createElement('div');
      el.id = 'promo-card';
      document.body.appendChild(el);
    });
    await page.evaluate(() => document.fonts.ready);
    const draw = async (name, html) => {
      await page.evaluate((h) => (document.getElementById('promo-card').innerHTML = h), html);
      await page.evaluate(() => Promise.all([...document.fonts].map((f) => f.load())).then(() => document.fonts.ready));
      const path = join(DIR, `${name}.png`);
      await page.screenshot({ path, omitBackground: true, clip: { x: 0, y: 0, width: WIDTH, height: HEIGHT } });
      // Every word inside the 90% title-safe area.
      const out = await page.evaluate(([w, h]) => [...document.querySelectorAll('#promo-card .line, #promo-card .sub, #promo-card .game-title, #promo-card .tagline, #promo-card .cta')].filter((el) => getComputedStyle(el).visibility !== 'hidden').map((el) => el.getBoundingClientRect()).filter((r) => r.left < w * 0.05 || r.right > w * 0.95 || r.top < h * 0.05 || r.bottom > h * 0.95).length, [WIDTH, HEIGHT]);
      if (out) {
        const rects = await page.evaluate(() => [...document.querySelectorAll('#promo-card .line, #promo-card .sub, #promo-card .game-title, #promo-card .tagline, #promo-card .cta')].filter((el) => getComputedStyle(el).visibility !== 'hidden').map((el) => { const r = el.getBoundingClientRect(); return `${el.className} ${Math.round(r.left)}–${Math.round(r.right)} × ${Math.round(r.top)}–${Math.round(r.bottom)}`; }));
        throw new Error(`${name}: text outside the title-safe area (${rects.join('; ')})`);
      }
      made.push(path);
      return path;
    };
    for (const [i, c] of edl.captions.entries()) await draw(`caption-${String(i).padStart(2, '0')}`, captionHtml(c));
    if (edl.endCard) for (const [name, html] of Object.entries(titleLayers(edl.endCard))) await draw(`title-${name}`, html);
  } finally {
    await browser.close();
    server?.kill();
  }
  return made;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const made = await renderCards();
  console.log(`${made.length} cards in ${DIR}`);
}
