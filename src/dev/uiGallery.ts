/**
 * Dev-only gallery for the framed-glass design system (dev/ui.html). Shows rails, windows, lists,
 * buttons and every glyph over a busy backdrop so contrast and shapes can be judged at any size.
 */
import '../ui/styles/base.css';
import { button } from '../ui/components.ts';
import { h } from '../ui/dom.ts';
import { glyph, GLYPH_NAMES, type GlyphName } from '../ui/glyphs.ts';

const ui = document.getElementById('ui')!;
document.body.style.background =
  'radial-gradient(ellipse at 30% 60%, #3a2412 0%, transparent 45%), radial-gradient(ellipse at 70% 30%, #16324f 0%, transparent 50%), linear-gradient(180deg, #0a0d16, #1c1410)';

const railBtn = (name: GlyphName, label: string, current = false) =>
  h('button', { type: 'button', class: 'rail-btn', 'aria-current': current ? 'page' : undefined }, glyph(name), h('span', null, label));

const topRail = h(
  'div',
  { style: 'position:absolute;top:0;left:50%;transform:translateX(-50%);display:flex;flex-direction:column;align-items:center' },
  h('nav', { class: 'rail frame attach-top', 'aria-label': 'Rooms' }, railBtn('deck', 'Deck', true), railBtn('bar', 'Bar'), railBtn('trader', 'Trader'), railBtn('outfitter', 'Outfitter'), railBtn('shipyard', 'Shipyard')),
  h('div', { class: 'rail-tab frame attach-top', style: '--ctl:0px;--ctr:0px' }, button('Launch', { icon: 'launch', variant: 'primary' })),
);
const globalRail = h(
  'nav',
  { class: 'rail frame attach-top', style: 'position:absolute;top:0;right:0;--ctr:0px;padding-right:0.6rem', 'aria-label': 'Global' },
  ...(['map', 'journal', 'science', 'menu'] as GlyphName[]).map((n) =>
    h('button', { type: 'button', class: 'rail-btn rail-btn-sm', 'aria-label': n }, glyph(n)),
  ),
);

const row = (g: GlyphName, name: string, sub: string, value: string, selected = false) =>
  h('li', null, h('button', { type: 'button', class: 'list-row', 'aria-selected': String(selected) }, glyph(g), h('span', null, h('span', { class: 'row-name' }, name), h('span', { class: 'row-sub' }, sub)), h('span', { class: 'row-value' }, value)));

const win = h(
  'section',
  { class: 'window frame', style: 'position:absolute;left:50%;top:9.5rem;transform:translateX(-50%);width:min(46rem,94vw);max-height:calc(100% - 11rem)' },
  h('header', { class: 'window-head' }, h('h2', { class: 'window-title' }, 'Trader', h('small', null, 'Halcyon Ring')), button('', { icon: 'close', ariaLabel: 'Close', size: 'sm' })),
  h(
    'div',
    { class: 'window-body scroll', style: 'display:grid;grid-template-columns:repeat(auto-fit,minmax(15rem,1fr));gap:1rem' },
    h('div', null, h('div', { class: 'list-head' }, h('span', null, 'For sale'), h('span', null, 'Price')), h('ul', { class: 'list' }, row('trader', 'Medical supplies', '1 unit each · best 96 at Meridian', '38 cr', true), row('outfitter', 'Fabricators', '2 units each', '120 cr'), row('science', 'Deuterium', '3 units each', '64 cr'))),
    h(
      'div',
      null,
      h('div', { class: 'list-head' }, h('span', null, 'Your hold'), h('span', null, '6/20')),
      h('ul', { class: 'list' }, row('trader', 'Medical supplies', '6 held · sells for 32', '×6')),
      h('div', { class: 'stack', style: 'margin-top:1rem' }, h('div', { class: 'statbar' }, 'Shield', h('div', { class: 'segbar', style: '--fill:0.8' }), '48'), h('div', { class: 'statbar' }, 'Hull', h('div', { class: 'segbar', style: '--fill:0.55;--seg-color:var(--hull)' }), '55'), h('div', { class: 'statbar' }, 'Danger', h('span', { class: 'pips' }, h('span', { class: 'on' }), h('span', { class: 'on' }), h('span', null)), '')),
    ),
  ),
  h('footer', { class: 'window-foot' }, button('Sell', {}), button('Buy 6', { variant: 'primary' })),
);

const buttons = h(
  'div',
  { class: 'frame', style: 'position:absolute;left:1rem;bottom:1rem;padding:0.8rem;display:flex;flex-wrap:wrap;gap:0.5rem;max-width:min(40rem,92vw)' },
  button('Default', {}),
  button('Primary', { variant: 'primary' }),
  button('Danger', { variant: 'danger' }),
  button('Ghost', { variant: 'ghost' }),
  button('Small', { size: 'sm' }),
  button('Large', { size: 'lg', icon: 'launch' }),
  button('Disabled', { disabled: true }),
);

const sheet = h(
  'div',
  { class: 'frame', style: 'position:absolute;right:1rem;bottom:1rem;padding:0.6rem;display:grid;grid-template-columns:repeat(6,auto);gap:0.4rem;max-width:92vw' },
  ...GLYPH_NAMES.flatMap((n) => [
    h('div', { class: 'rail-btn', title: n }, glyph(n), h('span', null, n)),
  ]),
  ...(['deck', 'bar', 'map', 'freeflight', 'goto', 'dock'] as GlyphName[]).map((n) => h('div', { class: 'rail-btn', 'aria-current': 'page' }, glyph(n), h('span', null, `${n} on`))),
);

const params = new URLSearchParams(location.search);
const show = (params.get('show') ?? 'all').split(',');
if (show.includes('all') || show.includes('rails')) ui.append(topRail, globalRail);
if (show.includes('all') || show.includes('window')) ui.append(win);
if (show.includes('all') || show.includes('buttons')) ui.append(buttons);
if (show.includes('glyphs')) ui.append(sheet);
if (show.includes('title')) ui.append(h('div', { class: 'name-card', style: 'position:absolute;left:0;right:0;top:40%' }, h('span', { class: 'name-main' }, 'Halcyon Ring'), h('span', { class: 'name-sub' }, 'Sol · Transit Authority')));
