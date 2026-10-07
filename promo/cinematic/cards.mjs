// Draws the cinematic cut's on-screen text into promo/out/cinematic/cards/: a lower-third "stamp"
// for each place the edit names, and the end card's layers.
//
//   node promo/cinematic/cards.mjs
//
// A stamp is a place's name and, beside it, the game's own REAL or FICTION badge: the very element
// the HUD shows (dataBadge in src/ui/components.ts), made by the game's code in the game's page.
// The end card is the Steam cut's (../cards.mjs): the title screen's logotype, its line, the call to action.
import { chromium } from 'playwright-core';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { CSS as TITLE_CSS, titleLayers } from '../cards.mjs';
import { BASE, HEIGHT, OUT, WIDTH, chromePath, ensureServer } from '../lib/harness.mjs';

export const CARDS = join(OUT, 'cinematic', 'cards');

const CSS = `
  ${TITLE_CSS}
  #promo-card .stamp { position: absolute; left: 6.2%; bottom: 12.5%; padding: 4px 0 6px 26px; border-left: 4px solid var(--kind); }
  #promo-card .stamp.right { left: auto; right: 6.2%; padding: 4px 26px 6px 0; border-left: 0; border-right: 4px solid var(--kind); text-align: right; }
  #promo-card .stamp::before { content: ''; position: absolute; inset: -46px -150px -46px -70px; background: radial-gradient(closest-side, rgba(4, 6, 11, 0.72), rgba(4, 6, 11, 0.45) 60%, rgba(4, 6, 11, 0)); z-index: -1; }
  #promo-card .stamp-name {
    margin: 0; font-family: var(--font-ui); font-weight: 700; font-size: 58px; line-height: 1.05; letter-spacing: 0.14em; text-transform: uppercase; white-space: nowrap;
    background: linear-gradient(180deg, #ffffff 0%, #dce9f8 42%, #7b94b8 52%, #c7d8ee 70%, #f4f8ff 100%);
    -webkit-background-clip: text; background-clip: text; color: transparent;
    filter: drop-shadow(0 2px 0 rgba(0, 0, 0, 0.75)) drop-shadow(0 0 16px rgba(110, 190, 255, 0.3));
  }
  #promo-card .stamp-row { display: flex; align-items: center; gap: 20px; margin-top: 14px; }
  #promo-card .stamp.right .stamp-row { justify-content: flex-end; }
  #promo-card .stamp .badge { font-size: 27px; padding: 0.16em 0.62em; text-transform: uppercase; border-width: 2px; background-color: rgba(4, 6, 11, 0.6); }
  #promo-card .stamp-note { font-family: 'Saira Semi Condensed', var(--font-ui); font-weight: 600; font-size: 29px; letter-spacing: 0.18em; text-transform: uppercase; white-space: nowrap; color: var(--text); text-shadow: 0 2px 0 rgba(0, 0, 0, 0.8), 0 0 12px rgba(4, 6, 11, 1); }
`;

export async function renderCards(edl) {
  const server = await ensureServer();
  const browser = await chromium.launch({ headless: true, executablePath: chromePath() });
  rmSync(CARDS, { recursive: true, force: true });
  mkdirSync(CARDS, { recursive: true });
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
    const shoot = async (name) => {
      await page.evaluate(() => Promise.all([...document.fonts].map((f) => f.load())).then(() => document.fonts.ready));
      const out = await page.evaluate(([w, h]) => [...document.querySelectorAll('#promo-card .stamp-name, #promo-card .stamp-row, #promo-card .game-title, #promo-card .tagline, #promo-card .cta')].filter((el) => getComputedStyle(el).visibility !== 'hidden').map((el) => el.getBoundingClientRect()).filter((r) => r.left < w * 0.05 || r.right > w * 0.95 || r.top < h * 0.05 || r.bottom > h * 0.95).length, [WIDTH, HEIGHT]);
      if (out) throw new Error(`${name}: text outside the title-safe area`);
      const path = join(CARDS, `${name}.png`);
      await page.screenshot({ path, omitBackground: true, clip: { x: 0, y: 0, width: WIDTH, height: HEIGHT } });
      made.push(path);
    };
    for (const [i, s] of (edl.stamps ?? []).entries()) {
      await page.evaluate(async (stamp) => {
        const { dataBadge } = await import('/src/ui/components.ts');
        const card = document.getElementById('promo-card');
        card.innerHTML = '';
        const el = document.createElement('div');
        el.className = `stamp${stamp.side === 'right' ? ' right' : ''}`;
        el.style.setProperty('--kind', stamp.kind === 'fictional' ? 'var(--fiction)' : 'var(--observed)');
        const name = document.createElement('p');
        name.className = 'stamp-name';
        name.textContent = stamp.name;
        const row = document.createElement('div');
        row.className = 'stamp-row';
        // The game's own badge, with the word its HUD uses.
        row.appendChild(dataBadge(stamp.kind, stamp.kind === 'fictional' ? 'Fiction' : 'Real'));
        if (stamp.note) {
          const note = document.createElement('span');
          note.className = 'stamp-note';
          note.textContent = stamp.note;
          if (stamp.side === 'right') row.prepend(note);
          else row.appendChild(note);
        }
        el.append(name, row);
        card.appendChild(el);
      }, s);
      await shoot(`stamp-${String(i).padStart(2, '0')}`);
    }
    if (edl.endCard) {
      for (const [name, html] of Object.entries(titleLayers(edl.endCard))) {
        await page.evaluate((h) => (document.getElementById('promo-card').innerHTML = h), html);
        await shoot(`title-${name}`);
      }
    }
  } finally {
    await browser.close();
    server?.kill();
  }
  return made;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { loadCut } = await import('./build.mjs');
  console.log(`${(await renderCards(loadCut())).length} cards in ${CARDS}`);
}
